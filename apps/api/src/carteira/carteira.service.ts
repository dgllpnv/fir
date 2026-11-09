import type {
  CadastroDoClienteNaSaida,
  ClienteCarteiraNaLista,
  CriarClienteNaCarteiraEntrada,
  EditarCadastroDoClienteEntrada,
  OpcoesDoCadastroSaida,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import {
  avaliarSenha,
  ehErro,
  resolverGrupoDeEscrita,
  responsavelImpostoPeloPerfil,
  temPermCarteira,
  type ErroDeDominio,
} from '@fir/domain'
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
import {
  gravarCampos,
  gravarParceiros,
  inserirCliente,
  lerCadastro,
  reprogramarCobrancasAbertas,
  responsavelServeAoCliente,
} from './cadastro-do-cliente'
import { gravarAuditoriaDaCarteira } from './financeiro/auditoria-da-carteira'
import { COLUNAS_DO_PERFIL, type LinhaDoPerfil, perfilDaLinha } from './perfil-do-usuario-de-gestao'
import { competenciaDoMes } from './financeiro/gerar-cobrancas'
import { criarDesafioDeCarteira } from './segundo-fator/desafio'
import { segundoFatorLigado } from './segundo-fator/ligado'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class CredencialDaCarteiraInvalida extends Error {}

/**
 * O login: a sessão, ou — com TOTP ativo (G8 0.6, A-12) — só o token opaco
 * do DESAFIO, que não abre rota nenhuma. `segundoFatorAtivo` é o estado da
 * CONTA, que pode ser `true` numa sessão aberta só com a senha — é o caso de
 * `SEGUNDO_FATOR_CARTEIRA_LIGADO` desligada (ADR 0023).
 */
export type ResultadoDeEntrarNaCarteira =
  | {
      readonly usuarioDeGestao: UsuarioDeGestaoPublico
      readonly token: string
      readonly segundoFatorAtivo: boolean
    }
  | { readonly desafio: string }
export class LimiteDeTentativasDaCarteira extends Error {}

/** O cliente não existe ou não é visível a esta sessão — a MESMA resposta (404), de propósito. */
export class ClienteDaCarteiraNaoEncontrado extends Error {}
/** Campo de valor no corpo de quem não tem `valores` (appsec A-6) — 403, nunca aceito em silêncio. */
export class SemPermissaoDeValoresNaCarteira extends Error {}
/** Grupo pedido fora do escopo da sessão, inexistente, inativo, ou ausente para `geral`. */
export class GrupoDeCriacaoInvalido extends Error {
  constructor(readonly mensagem: string) {
    super(mensagem)
  }
}
/** `escopo='grupo'` pedindo para criar em OUTRO grupo — 403. */
export class GrupoCruzadoNaCriacao extends Error {}
/** Responsável Firmare de outro grupo, inativo ou inexistente (A-11 item 7). */
export class ResponsavelForaDoGrupo extends Error {}
/** A chave de criação já foi usada por um cliente que esta sessão não enxerga. */
export class ChaveDeCriacaoEmUso extends Error {}
/**
 * Quem vê "só a minha carteira" tentou trocar o responsável (appsec A-3): é
 * escalada de um passo — puxar o cliente alheio para si e passar a vê-lo.
 * Trocar responsável exige `carteira = 'todos'`. 403, nenhuma linha muda.
 */
export class SemPermissaoDeTrocarResponsavel extends Error {}
/**
 * Encerrar um cliente, ou tirá-lo de `encerrado`, sem `carteira.administrar`
 * (A-9, achado do 1A): esconder o botão na ficha não basta — o servidor
 * recusa com 403 e nada é gravado.
 */
export class SemPermissaoDeEncerrar extends Error {}

/**
 * **O PONTO DE EXTENSÃO DO TICKET 0.5.** Quem pode ESCREVER mensalidade e a
 * seção Pagamento pela carteira. Hoje a carteira não tem a chave `valores`
 * (ela nasce com `temPermCarteira`, ticket 0.5), então nenhum `Usuário de
 * Gestão` escreve valor — só o `Operador`, por `PATCH
 * /v1/superadmin/clientes-carteira/:id`. Quando a 0.5 entrar, ESTA função
 * vira `temPermCarteira(u, 'valores')` e nada mais muda: a leitura já é
 * redigida pelo `RedacaoInterceptor` pelo nome do campo.
 */
const podeEscreverValoresDaCarteira = (usuario: UsuarioDeGestaoPublico): boolean => temPermCarteira(usuario, 'valores')

const violouChaveDeCriacao = (e: unknown): boolean => {
  const x = e as { code?: string; constraint?: string }
  return x.code === '23505' && x.constraint === 'clientes_carteira_chave_de_criacao_unica'
}

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
} & LinhaDoPerfil

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
    ...COLUNAS_DO_PERFIL,
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
  ...perfilDaLinha(u),
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

  async entrar(usuario: string, senha: string): Promise<ResultadoDeEntrarNaCarteira> {
    const inicio = performance.now()
    try {
      return await this.entrarSemPiso(usuario, senha)
    } finally {
      const falta = PISO_DE_RESPOSTA_MS - (performance.now() - inicio)
      if (falta > 0) await new Promise((r) => setTimeout(r, falta))
    }
  }

  private async entrarSemPiso(usuario: string, senha: string): Promise<ResultadoDeEntrarNaCarteira> {
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

      // G8 0.6 (A-12): com TOTP ativo, a senha certa entrega um DESAFIO, não
      // uma sessão — a sessão só nasce depois do código
      // (`SegundoFatorDaCarteiraService.concluirDesafio`). Com
      // `SEGUNDO_FATOR_CARTEIRA_LIGADO` desligada (D-23, ADR 0023), a senha
      // basta, inclusive para quem já tem TOTP ativo.
      const totp = await c.query<{ ativo: boolean }>(
        'SELECT ativado_em IS NOT NULL AS ativo FROM segundo_fator_da_carteira WHERE usuario_gestao_id = $1',
        [usuarioDeGestao.id],
      )
      const segundoFatorAtivo = totp.rows[0]?.ativo === true
      if (segundoFatorAtivo && segundoFatorLigado()) {
        return { tipo: 'desafio' as const, desafio: await criarDesafioDeCarteira(c, usuarioDeGestao.id) }
      }

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
        segundoFatorAtivo,
      }
    })

    if (resultado.tipo === 'limite') throw new LimiteDeTentativasDaCarteira()
    if (resultado.tipo === 'invalida') throw new CredencialDaCarteiraInvalida()
    if (resultado.tipo === 'desafio') return { desafio: resultado.desafio }
    return {
      usuarioDeGestao: resultado.usuarioDeGestao,
      token: resultado.token,
      segundoFatorAtivo: resultado.segundoFatorAtivo,
    }
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

  /**
   * D-23 item 6 (ADR 0024): a sessão da `Conta de gestão do operador`, aberta
   * pelo login do PAINEL — nunca por senha (a conta não tem uma). Só a conta
   * VINCULADA a um operador ativo: o `JOIN` é a prova, não o chamador.
   *
   * Pela conexão `fir_carteira`, como todo login da carteira: `fir_painel`
   * não cria sessão de carteira (guarda da 0055 e da 0061).
   *
   * A sessão nasce SEM `segundo_fator_em`. Com
   * `SEGUNDO_FATOR_CARTEIRA_LIGADO`, o `SegundoFatorDaCarteiraGuard` a trata
   * como qualquer sessão sem código e devolve 409 — a entrada única não
   * contorna o segundo fator (ADR 0024 §4).
   */
  /**
   * A conta de gestão é a de um Operador (ADR 0024)? A lateral da carteira usa
   * isto para oferecer "Voltar ao painel" só a quem veio do painel — sem uma
   * segunda chamada a `/v1/superadmin/eu`, que daria 404 (e erro de console) a
   * todo Usuário de Gestão comum. Não diz QUAL operador.
   */
  async ehContaDoOperador(usuarioDeGestaoId: string): Promise<boolean> {
    return this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const r = await c.query(
        'SELECT 1 FROM contas_de_gestao_do_operador WHERE usuario_gestao_id = $1',
        [usuarioDeGestaoId],
      )
      return (r.rowCount ?? 0) > 0
    })
  }

  async abrirSessaoDaContaDoOperador(
    operadorId: string,
    duracaoMs: number,
  ): Promise<{ token: string; usuarioDeGestaoId: string } | null> {
    return this.banco.nasTabelasDaCarteira(SISTEMA, async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT u.id
           FROM contas_de_gestao_do_operador v
           JOIN usuarios_gestao u ON u.id = v.usuario_gestao_id
          WHERE v.operador_id = $1 AND u.ativo`,
        [operadorId],
      )
      const conta = r.rows[0]
      if (!conta) return null
      const { token, hash } = novoToken()
      await c.query(
        `INSERT INTO sessoes_de_carteira (usuario_gestao_id, token_hash, expira_em)
         VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
        [conta.id, hash, String(duracaoMs)],
      )
      return { token, usuarioDeGestaoId: conta.id }
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
    // "Só a minha carteira" (A-3): imposto pela sessão, no SQL. `null` não restringe.
    const responsavel = responsavelImpostoPeloPerfil(usuarioDeGestao)
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
              AND ($1::uuid IS NULL OR responsavel_usuario_gestao_id = $1::uuid)
            ORDER BY nome`,
          [responsavel],
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

  /**
   * "Só a minha carteira" (A-3): o cliente existe, é visível pela RLS desta
   * sessão E é dela? Usado pelo `CarteiraGuard` em toda rota que nomeia um
   * cliente. Id que não é UUID responde `false` (o guard dá o mesmo 404).
   */
  async clienteEstaNaMinhaCarteira(usuarioDeGestao: UsuarioDeGestaoPublico, clienteId: string): Promise<boolean> {
    const responsavel = responsavelImpostoPeloPerfil(usuarioDeGestao)
    if (responsavel === null) return true
    if (!UUID.test(clienteId)) return false
    const r = await this.banco.nasTabelasDaCarteiraComEscopo(usuarioDeGestao.escopo, usuarioDeGestao.grupoId, (c) =>
      c.query('SELECT 1 FROM clientes_carteira WHERE id = $1 AND responsavel_usuario_gestao_id = $2', [
        clienteId,
        responsavel,
      ]),
    )
    return r.rows.length > 0
  }

  // -------------------------------------------------------------------------
  // G8 0.4 — O CADASTRO DO `Cliente Firmare`.
  //
  // Leitura pela RLS da sessão (`app_pode_ver_grupo`): "não existe" e "é de
  // outro grupo" são a mesma resposta. Escrita pela conexão que grava ESTE
  // `Usuário de Gestão` como ator (`app.pessoa_id = usuario_gestao:<id>`): a
  // trilha de `clientes_carteira` (trigger da 0032) e a de
  // `parceiros_do_cliente` (trigger da 0047) registram quem, quando e de →
  // para — regra 20, sem gravação à mão que alguém esqueça.
  // -------------------------------------------------------------------------

  async cadastro(usuarioDeGestao: UsuarioDeGestaoPublico, id: string): Promise<CadastroDoClienteNaSaida> {
    const r = await this.banco.nasTabelasDaCarteiraComEscopo(usuarioDeGestao.escopo, usuarioDeGestao.grupoId, (c) =>
      lerCadastro(c, id),
    )
    if (!r) throw new ClienteDaCarteiraNaoEncontrado()
    return r
  }

  /**
   * `PATCH` do cadastro. `trouxeValor` é a presença das CHAVES de valor no
   * corpo cru (`trazCampoDeValor`), decidida pelo controlador antes do parse:
   * sem `valores`, a presença basta para o 403 — inclusive `null`, que é o
   * formulário reenviando o campo que recebeu redigido (appsec A-6).
   */
  async editarCadastro(
    usuarioDeGestao: UsuarioDeGestaoPublico,
    id: string,
    dados: EditarCadastroDoClienteEntrada,
    trouxeValor: boolean,
  ): Promise<CadastroDoClienteNaSaida> {
    if (trouxeValor && !podeEscreverValoresDaCarteira(usuarioDeGestao)) throw new SemPermissaoDeValoresNaCarteira()
    if (dados.responsavelId !== undefined && responsavelImpostoPeloPerfil(usuarioDeGestao) !== null) {
      throw new SemPermissaoDeTrocarResponsavel()
    }

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuarioDeGestao, async (c) => {
      const atual = await c.query<{ grupo_id: string; dia_vencimento: number | null; status: string }>(
        'SELECT grupo_id, dia_vencimento, status FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL FOR UPDATE',
        [id],
      )
      const linha = atual.rows[0]
      if (!linha) throw new ClienteDaCarteiraNaoEncontrado()
      const mexeNoEncerramento =
        dados.status !== undefined &&
        dados.status !== linha.status &&
        (dados.status === 'encerrado' || linha.status === 'encerrado')
      if (mexeNoEncerramento && !temPermCarteira(usuarioDeGestao, 'carteira.administrar')) {
        throw new SemPermissaoDeEncerrar()
      }

      if (dados.responsavelId && !(await responsavelServeAoCliente(c, dados.responsavelId, linha.grupo_id))) {
        throw new ResponsavelForaDoGrupo()
      }

      const { parceiros, ...campos } = dados
      await gravarCampos(c, id, campos)
      if (parceiros) await gravarParceiros(c, id, linha.grupo_id, parceiros)

      // Gate de números, ajuste 6 (só alcançável com a chave valores, ticket 0.5).
      const diaNovo = dados.pagamentoDaMensalidade?.diaVencimento ?? null
      if (diaNovo !== null && diaNovo !== linha.dia_vencimento) {
        const mudadas = await reprogramarCobrancasAbertas(c, id, diaNovo, competenciaDoMes(this.relogio.agora()))
        for (const m of mudadas) {
          await gravarAuditoriaDaCarteira(c, {
            usuarioGestaoId: usuarioDeGestao.id,
            grupoId: m.grupoId,
            tabela: 'cobrancas_do_cliente_firmare',
            registroId: m.id,
            acao: 'atualizar',
            de: { vencimento: m.de },
            para: { vencimento: m.para },
          })
        }
      }

      return (await lerCadastro(c, id))!
    })
  }

  /**
   * Cria um `Cliente Firmare` do zero, sem clínica (D-22 item 4, appsec
   * A-11 item 5). O grupo NUNCA é tomado do corpo sem validar:
   * `escopo='grupo'` usa o da sessão (outro valor é recusado);
   * `escopo='geral'` exige um grupo existente e ativo.
   *
   * Idempotente pela `chaveDeCriacao` (A-20): o segundo POST com a mesma
   * chave devolve o MESMO cliente, com `criado: false`.
   */
  async criarCliente(
    usuarioDeGestao: UsuarioDeGestaoPublico,
    dados: CriarClienteNaCarteiraEntrada,
    trouxeValor: boolean,
  ): Promise<{ cliente: CadastroDoClienteNaSaida; criado: boolean }> {
    if (trouxeValor && !podeEscreverValoresDaCarteira(usuarioDeGestao)) throw new SemPermissaoDeValoresNaCarteira()

    const grupo = resolverGrupoDeEscrita(usuarioDeGestao, dados.grupoId)
    if (ehErro(grupo)) throw new GrupoCruzadoNaCriacao()
    if (grupo.valor === null) throw new GrupoDeCriacaoInvalido('Escolha o grupo do cliente.')
    const grupoId = grupo.valor

    if (dados.status === 'encerrado' && !temPermCarteira(usuarioDeGestao, 'carteira.administrar')) {
      throw new SemPermissaoDeEncerrar()
    }
    const { chaveDeCriacao, parceiros, grupoId: _ignorado, ...pedidos } = dados
    // "Só a minha carteira" (A-3): o cliente que ela cria nasce dela — outro
    // responsável o tiraria da vista dela no mesmo clique, e escolher outro
    // é a troca de responsável que A-3 reserva a `carteira = 'todos'`.
    const imposto = responsavelImpostoPeloPerfil(usuarioDeGestao)
    if (imposto !== null && pedidos.responsavelId != null && pedidos.responsavelId !== imposto) {
      throw new SemPermissaoDeTrocarResponsavel()
    }
    const campos = imposto === null ? pedidos : { ...pedidos, responsavelId: imposto }
    const tentar = () =>
      this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuarioDeGestao, async (c) => {
        const jaCriado = await c.query<{ id: string }>(
          'SELECT id FROM clientes_carteira WHERE chave_de_criacao = $1',
          [chaveDeCriacao],
        )
        if (jaCriado.rows[0]) return { cliente: (await lerCadastro(c, jaCriado.rows[0].id))!, criado: false }

        const g = await c.query<{ ativo: boolean }>('SELECT ativo FROM grupos WHERE id = $1', [grupoId])
        if (!g.rows[0]?.ativo) throw new GrupoDeCriacaoInvalido('Este grupo não existe ou está desativado.')

        if (campos.responsavelId && !(await responsavelServeAoCliente(c, campos.responsavelId, grupoId))) {
          throw new ResponsavelForaDoGrupo()
        }

        const id = await inserirCliente(c, grupoId, chaveDeCriacao, campos)
        if (parceiros) await gravarParceiros(c, id, grupoId, parceiros)
        return { cliente: (await lerCadastro(c, id))!, criado: true }
      })

    try {
      return await tentar()
    } catch (e) {
      // Duas requisições com a mesma chave ao mesmo tempo: a segunda bate no
      // índice único e relê — devolve o cliente da primeira. Se nem assim o
      // vê, a chave é de um cliente de outro grupo: 409, sem dizer de quem.
      if (!violouChaveDeCriacao(e)) throw e
      try {
        return await tentar()
      } catch (e2) {
        if (violouChaveDeCriacao(e2)) throw new ChaveDeCriacaoEmUso()
        throw e2
      }
    }
  }

  /**
   * As opções dos dois selects do formulário. Responsáveis: ativos do grupo
   * visível ou de `escopo='geral'` (os que o trigger da 0047 aceita).
   * Grupos: os ativos que a sessão pode usar para criar.
   */
  async opcoesDoCadastro(usuarioDeGestao: UsuarioDeGestaoPublico): Promise<OpcoesDoCadastroSaida> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuarioDeGestao.escopo, usuarioDeGestao.grupoId, async (c) => {
      const grupos = await c.query<{ id: string; nome: string }>(
        `SELECT id, nome FROM grupos
          WHERE ativo AND ($1::text = 'geral' OR id = $2::uuid)
          ORDER BY nome`,
        [usuarioDeGestao.escopo, usuarioDeGestao.grupoId],
      )
      const responsaveis = await c.query<{ id: string; nome: string; grupo_id: string | null }>(
        `SELECT id, nome, grupo_id FROM usuarios_gestao
          WHERE ativo AND (escopo = 'geral' OR $1::text = 'geral' OR grupo_id = $2::uuid)
          ORDER BY nome`,
        [usuarioDeGestao.escopo, usuarioDeGestao.grupoId],
      )
      return {
        grupos: grupos.rows,
        responsaveis: responsaveis.rows.map((u) => ({ id: u.id, nome: u.nome, grupoId: u.grupo_id })),
      }
    })
  }
}
