import type { ClienteCarteiraNaLista, UsuarioDeGestaoPublico } from '@fir/contracts'
import { avaliarSenha, ehErro, type ErroDeDominio } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { HASH_FALSO, PISO_DE_RESPOSTA_MS } from '../autenticacao/autenticacao.service'
import { semaforoArgon2 } from '../autenticacao/concorrencia'
import { conferirSenha, hashDeSenha } from '../autenticacao/senha'
import { hashDoToken, limiteExcedido, novoToken } from '../autenticacao/sessao'
import { SISTEMA } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { registrarNoPainel } from '../painel/painel.service'
import type { ContextoDaCarteira } from './contexto-da-carteira'
import { DURACAO_SESSAO_CARTEIRA_MS } from './carteira.guard'

export class CredencialDaCarteiraInvalida extends Error {}
export class LimiteDeTentativasDaCarteira extends Error {}

/**
 * O que a senha nova não pode conter: o usuário e o nome de quem a escolhe.
 * A tela adianta a mesma recusa com os mesmos dois campos de
 * `GET /v1/carteira/eu` — a lista é esta, e só esta, dos dois lados.
 */
const contextoDaSenhaDaCarteira = (u: UsuarioDeGestaoPublico): string[] => [u.usuario, u.nome]

type LinhaUsuarioDeGestao = {
  id: string
  usuario: string
  nome: string
  senha_hash: string
  escopo: 'geral' | 'grupo'
  grupo_id: string | null
  ativo: boolean
  senha_provisoria: boolean
  senha_provisoria_expira_em: Date | null
}

const colunas = (prefixo = ''): string =>
  [
    'id',
    'usuario',
    'nome',
    'senha_hash',
    'escopo',
    'grupo_id',
    'ativo',
    'senha_provisoria',
    'senha_provisoria_expira_em',
  ]
    .map((c) => `${prefixo}${c}`)
    .join(', ')

const usuarioDeGestaoPublico = (u: LinhaUsuarioDeGestao): UsuarioDeGestaoPublico => ({
  id: u.id,
  usuario: u.usuario,
  nome: u.nome,
  escopo: u.escopo,
  grupoId: u.grupo_id,
  senhaProvisoria: u.senha_provisoria,
})

/**
 * A identidade da carteira comercial — disjunta da do produto e da do
 * painel. Nada aqui toca `pessoas`/`operadores`, e nada lá toca
 * `usuarios_gestao`.
 *
 * Reusa `semaforoArgon2`, `conferirSenha`, `HASH_FALSO`, `PISO_DE_RESPOSTA_MS`,
 * `novoToken` e `limiteExcedido` — os mesmos do produto e do painel. Uma
 * segunda implementação destes seis é como a segunda fica com parâmetros
 * velhos, numa credencial que lê dado agregado de várias clínicas.
 */
@Injectable()
export class CarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async entrar(
    usuario: string,
    senha: string,
  ): Promise<{ usuarioDeGestao: UsuarioDeGestaoPublico; token: string }> {
    const inicio = performance.now()
    try {
      return await this.entrarSemPiso(usuario, senha)
    } finally {
      const falta = PISO_DE_RESPOSTA_MS - (performance.now() - inicio)
      if (falta > 0) await new Promise((r) => setTimeout(r, falta))
    }
  }

  private async entrarSemPiso(
    usuario: string,
    senha: string,
  ): Promise<{ usuarioDeGestao: UsuarioDeGestaoPublico; token: string }> {
    // --- TRANSAÇÃO 1 (curta): limite por conta e o usuário. Nenhum Argon2.
    const etapa1 = await this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const tentativas = await c.query<{ em: Date; sucesso: boolean }>(
        `SELECT em, sucesso FROM tentativas_de_carteira
          WHERE identificador = $1 AND em > now() - interval '15 minutes'`,
        [usuario],
      )
      if (limiteExcedido(tentativas.rows, this.relogio.agora())) return { tipo: 'limite' as const }

      const u = await c.query<LinhaUsuarioDeGestao>(
        `SELECT ${colunas()} FROM usuarios_gestao WHERE usuario = normalizar_nome($1) AND ativo`,
        [usuario],
      )
      return { tipo: 'segue' as const, usuarioDeGestao: u.rows[0] ?? null }
    })
    if (etapa1.tipo === 'limite') throw new LimiteDeTentativasDaCarteira()
    const usuarioDeGestao = etapa1.usuarioDeGestao

    // --- FORA DE TRANSAÇÃO: semáforo e Argon2.
    const senhaConfere = usuarioDeGestao
      ? await semaforoArgon2.executar(() => conferirSenha(senha, usuarioDeGestao.senha_hash))
      : await semaforoArgon2.executar(() => conferirSenha(senha, HASH_FALSO)).then(() => false)

    const vencida =
      usuarioDeGestao?.senha_provisoria === true &&
      usuarioDeGestao.senha_provisoria_expira_em !== null &&
      usuarioDeGestao.senha_provisoria_expira_em.getTime() <= this.relogio.agora().getTime()

    const ok = senhaConfere && !vencida

    // --- TRANSAÇÃO 2 (curta): a tentativa e a sessão.
    const resultado = await this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const tentativas = await c.query<{ em: Date; sucesso: boolean }>(
        `SELECT em, sucesso FROM tentativas_de_carteira
          WHERE identificador = $1 AND em > now() - interval '15 minutes'`,
        [usuario],
      )
      const excedido = limiteExcedido(tentativas.rows, this.relogio.agora())

      await c.query('INSERT INTO tentativas_de_carteira (identificador, sucesso) VALUES ($1, $2)', [
        usuario,
        ok && !excedido,
      ])
      if (excedido) return { tipo: 'limite' as const }
      if (!ok || !usuarioDeGestao) return { tipo: 'invalida' as const }

      const { token, hash } = novoToken()
      await c.query(
        `INSERT INTO sessoes_de_carteira (usuario_gestao_id, token_hash, expira_em)
         VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
        [usuarioDeGestao.id, hash, String(DURACAO_SESSAO_CARTEIRA_MS)],
      )

      return {
        tipo: 'ok' as const,
        token,
        usuarioDeGestao: usuarioDeGestaoPublico(usuarioDeGestao),
      }
    })

    if (resultado.tipo === 'limite') throw new LimiteDeTentativasDaCarteira()
    if (resultado.tipo === 'invalida') throw new CredencialDaCarteiraInvalida()
    return { usuarioDeGestao: resultado.usuarioDeGestao, token: resultado.token }
  }

  /**
   * Resolve o cookie da carteira em contexto. `null` quando a sessão não
   * vale — `ativo` é conferido AQUI, a cada requisição (P-12): desativar um
   * Usuário de Gestão precisa derrubá-lo agora, não quando a sessão de doze
   * horas vencer.
   */
  async contextoDoToken(token: string): Promise<ContextoDaCarteira | null> {
    const hash = hashDoToken(token)
    return this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const r = await c.query<LinhaUsuarioDeGestao>(
        `SELECT ${colunas('u.')}
           FROM sessoes_de_carteira s
           JOIN usuarios_gestao u ON u.id = s.usuario_gestao_id
          WHERE s.token_hash = $1
            AND s.revogada_em IS NULL
            AND s.expira_em > now()
            AND u.ativo`,
        [hash],
      )
      const usuarioDeGestao = r.rows[0]
      if (!usuarioDeGestao) return null
      return { usuarioDeGestao: usuarioDeGestaoPublico(usuarioDeGestao) } satisfies ContextoDaCarteira
    })
  }

  async sair(token: string): Promise<void> {
    const hash = hashDoToken(token)
    await this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      await c.query('UPDATE sessoes_de_carteira SET revogada_em = now() WHERE token_hash = $1', [hash])
    })
  }

  /**
   * O `Usuário de Gestão` troca a PRÓPRIA senha. Espelho de
   * `AutenticacaoService.trocarAPropriaSenha` e `PainelService.trocarAPropriaSenha`
   * — mesma ordem, mesmas duas transações curtas, mesmo Argon2 atrás do
   * mesmo semáforo. Uma terceira forma de trocar senha é como a terceira
   * esquece a regra de força ou a revogação das outras sessões.
   *
   * É a saída da provisória: sem ela, o usuário criado pelo superadmin ficava
   * trancado 72 h depois (defeito de produção, 2026-11-08).
   */
  async trocarAPropriaSenha(
    contexto: ContextoDaCarteira,
    tokenDaSessao: string,
    atual: string,
    nova: string,
  ): Promise<'ok' | 'atual-invalida' | ErroDeDominio> {
    const eu = contexto.usuarioDeGestao

    // --- TRANSAÇÃO 1 (curta): só o hash guardado. Nenhum Argon2.
    const linha = await this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const r = await c.query<{ senha_hash: string }>(
        'SELECT senha_hash FROM usuarios_gestao WHERE id = $1 AND ativo',
        [eu.id],
      )
      return r.rows[0] ?? null
    })
    if (!linha) return 'atual-invalida'

    // --- FORA DE TRANSAÇÃO: o semáforo e o Argon2.
    const confere = await semaforoArgon2.executar(() => conferirSenha(atual, linha.senha_hash))
    if (!confere) return 'atual-invalida'

    // A REGRA ANTES DO HASH — a mesma invariante do produto: hashear primeiro
    // entregaria a quem tem sessão um jeito de esgotar o semáforo com senhas
    // que nunca seriam aceitas.
    const juizo = avaliarSenha(nova, { contexto: contextoDaSenhaDaCarteira(eu) })
    if (ehErro(juizo)) return juizo.erro

    const hash = await semaforoArgon2.executar(() => hashDeSenha(nova))
    const hashDaSessaoAtual = hashDoToken(tokenDaSessao)

    // --- TRANSAÇÃO 2 (curta): a senha, o fim da provisória, as outras sessões
    // e a trilha. `ComoUsuarioDeGestao` para que `app.pessoa_id` seja ESTE
    // usuário, e não `sistema`.
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(eu, async (c) => {
      await c.query(
        `UPDATE usuarios_gestao
            SET senha_hash = $1, senha_provisoria = false, senha_provisoria_expira_em = NULL
          WHERE id = $2`,
        [hash, eu.id],
      )
      // As OUTRAS sessões caem; esta sobrevive — derrubá-la devolveria a
      // pessoa à entrada logo depois de fazer a coisa certa. Quem troca a
      // senha o faz, metade das vezes, porque desconfia de que alguém a sabe.
      await c.query(
        `UPDATE sessoes_de_carteira SET revogada_em = now()
          WHERE usuario_gestao_id = $1 AND token_hash <> $2 AND revogada_em IS NULL`,
        [eu.id, hashDaSessaoAtual],
      )
      // A mesma trilha das outras escritas de identidade da carteira
      // (`PainelCarteiraService`, sobre `usuarios_gestao`). O hash não
      // atravessa — nem é passado.
      await registrarNoPainel(c, {
        atorTipo: 'usuario_gestao',
        atorId: eu.id,
        acao: 'alterou',
        entidade: 'usuarios_gestao',
        entidadeId: eu.id,
        para: { senha_hash: '(trocada pelo próprio usuário de gestão)' },
      })
    })

    return 'ok'
  }

  /**
   * Os `Cliente Firmare` visíveis para ESTE `Usuário de Gestão` — a RLS
   * (`app_pode_ver_grupo`, ADR 0012) já filtrou antes de a linha chegar aqui.
   * Nenhum `WHERE grupo_id` no código: se houvesse, seria o filtro de
   * aplicação que a ADR 0012 recusa como único controle.
   */
  async clientes(usuarioDeGestao: UsuarioDeGestaoPublico): Promise<ClienteCarteiraNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComEscopo(
      usuarioDeGestao.escopo,
      usuarioDeGestao.grupoId,
      (c) =>
        c.query<{
          id: string
          grupo_id: string
          clinica_id: string
          nome: string
          produto: string
          status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado'
          link_painel: string | null
          link_dash_ind: string | null
          link_dash_fin: string | null
          link_rotina: string | null
        }>(
          `SELECT id, grupo_id, clinica_id, nome, produto, status,
                  link_painel, link_dash_ind, link_dash_fin, link_rotina
             FROM clientes_carteira
            WHERE excluido_em IS NULL
            ORDER BY nome`,
        ),
    )
    return r.rows.map((x) => ({
      id: x.id,
      grupoId: x.grupo_id,
      clinicaId: x.clinica_id,
      nome: x.nome,
      produto: x.produto,
      status: x.status,
      linkPainel: x.link_painel,
      linkDashInd: x.link_dash_ind,
      linkDashFin: x.link_dash_fin,
      linkRotina: x.link_rotina,
    }))
  }
}
