import type { OperadorPublico } from '@fir/contracts'
import { avaliarSenha, ehErro, type ErroDeDominio } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { HASH_FALSO, PISO_DE_RESPOSTA_MS } from '../autenticacao/autenticacao.service'
import { semaforoArgon2 } from '../autenticacao/concorrencia'
import { conferirSenha, hashDeSenha } from '../autenticacao/senha'
import { hashDoToken, limiteExcedido, novoToken } from '../autenticacao/sessao'
import { SISTEMA, operadorIdDeFonteConfiavel, type OperadorId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import type { ContextoDoPainel } from './contexto-do-painel'
import { DURACAO_SESSAO_PAINEL_MS } from './painel.guard'

export class CredencialDeOperadorInvalida extends Error {}
export class LimiteDeTentativasDoOperador extends Error {}

type LinhaOperador = {
  id: string
  usuario: string
  nome: string
  senha_hash: string
  ativo: boolean
  senha_provisoria: boolean
  senha_provisoria_expira_em: Date | null
}

/** As colunas de `operadores` que a sessão precisa. Uma lista só, nunca duas. */
const colunas = (prefixo = ''): string =>
  ['id', 'usuario', 'nome', 'senha_hash', 'ativo', 'senha_provisoria', 'senha_provisoria_expira_em']
    .map((c) => `${prefixo}${c}`)
    .join(', ')

const operadorPublico = (o: LinhaOperador): OperadorPublico => ({
  id: o.id,
  usuario: o.usuario,
  nome: o.nome,
  senhaProvisoria: o.senha_provisoria,
})

/**
 * A identidade do superadmin — **disjunta da do produto**.
 *
 * Nada aqui toca `pessoas`, `sessoes` ou `tentativas_login`, e nada lá toca
 * `operadores`. Se os dois espaços se cruzarem um dia, o superadmin virou uma
 * pessoa de alguma clínica e a D-5 restrição 1 caiu.
 *
 * O que é REUSADO do produto é o que não pode divergir: `semaforoArgon2`,
 * `conferirSenha`, `HASH_FALSO`, `PISO_DE_RESPOSTA_MS`, `novoToken` e
 * `limiteExcedido`. Escrever uma segunda versão de qualquer um deles é como a
 * segunda fica com parâmetros velhos — e esta é a credencial mais valiosa do
 * produto, a que cria clínica e administradora em QUALQUER clínica.
 */
@Injectable()
export class PainelService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * Entra no painel. Mesmo desenho de `AutenticacaoService.entrar`, e as
   * mesmas razões, medidas lá:
   *
   *  - **piso de tempo no `finally`**, valendo para o sucesso também — senão
   *    o relógio passa a dizer "esta senha estava certa";
   *  - **Argon2 fora de transação**, para não segurar uma das três conexões
   *    do pool do painel durante ~25 ms de hash;
   *  - **`HASH_FALSO` quando o operador não existe**, pelo MESMO semáforo —
   *    sem passar por ele, quem testa usuários inexistentes contorna o teto
   *    de concorrência inteiro.
   *
   * O painel tem **um** usuário conhecido e a credencial mais valiosa do
   * produto. É a rota que mais precisa destes três, não a que menos precisa.
   */
  async entrar(usuario: string, senha: string): Promise<{ operador: OperadorPublico; token: string }> {
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
  ): Promise<{ operador: OperadorPublico; token: string }> {
    // --- TRANSAÇÃO 1 (curta): o limite por conta e o operador. Nenhum Argon2.
    //
    // `SISTEMA`: aqui ninguém provou identidade nenhuma — quem teclou o
    // usuário apenas afirmou ser alguém.
    const etapa1 = await this.banco.nasTabelasDoPainel(SISTEMA, async (c) => {
      const tentativas = await c.query<{ em: Date; sucesso: boolean }>(
        `SELECT em, sucesso FROM tentativas_de_operador
          WHERE identificador = $1 AND em > now() - interval '15 minutes'`,
        [usuario],
      )
      if (limiteExcedido(tentativas.rows, this.relogio.agora())) return { tipo: 'limite' as const }

      // `normalizar_nome($1)` sobre o PARÂMETRO, nunca sobre a coluna: do
      // outro jeito o índice único vira enfeite. Mesma razão da 0012.
      const o = await c.query<LinhaOperador>(
        `SELECT ${colunas()} FROM operadores WHERE usuario = normalizar_nome($1) AND ativo`,
        [usuario],
      )
      return { tipo: 'segue' as const, operador: o.rows[0] ?? null }
    })
    if (etapa1.tipo === 'limite') throw new LimiteDeTentativasDoOperador()
    const operador = etapa1.operador

    // --- FORA DE TRANSAÇÃO: o semáforo e o Argon2.
    const senhaConfere = operador
      ? await semaforoArgon2.executar(() => conferirSenha(senha, operador.senha_hash))
      : await semaforoArgon2.executar(() => conferirSenha(senha, HASH_FALSO)).then(() => false)

    /**
     * Provisória vencida não autentica, e a frase de erro é a de sempre. O
     * Argon2 JÁ RODOU acima, e tem de ter rodado: pular a verificação aqui
     * devolveria o caminho rápido que `HASH_FALSO` e o piso existem para
     * fechar, justamente para a conta recém-criada pela VPS.
     */
    const vencida =
      operador?.senha_provisoria === true &&
      operador.senha_provisoria_expira_em !== null &&
      operador.senha_provisoria_expira_em.getTime() <= this.relogio.agora().getTime()

    const ok = senhaConfere && !vencida

    // --- TRANSAÇÃO 2 (curta): a tentativa, a sessão e a trilha do painel.
    const ator = senhaConfere && operador ? operadorIdDeFonteConfiavel(operador.id) : SISTEMA
    const resultado = await this.banco.nasTabelasDoPainel(ator, async (c) => {
      // Releitura do limite, pela mesma corrida descrita em
      // `autenticacao.service.ts`: entre as duas transações passam ~25 ms de
      // Argon2, e outras requisições da mesma conta podem ter gravado
      // tentativas nesse intervalo.
      const tentativas = await c.query<{ em: Date; sucesso: boolean }>(
        `SELECT em, sucesso FROM tentativas_de_operador
          WHERE identificador = $1 AND em > now() - interval '15 minutes'`,
        [usuario],
      )
      const excedido = limiteExcedido(tentativas.rows, this.relogio.agora())

      // `ok && !excedido`, nunca só `ok`: gravar sucesso numa tentativa que
      // FOI RECUSADA zeraria a contagem de falhas, e o atacante destravaria a
      // conta acertando a senha uma vez durante o bloqueio.
      await c.query(
        'INSERT INTO tentativas_de_operador (identificador, sucesso) VALUES ($1, $2)',
        [usuario, ok && !excedido],
      )
      if (excedido) return { tipo: 'limite' as const }
      if (!ok || !operador) return { tipo: 'invalida' as const }

      const { token, hash } = novoToken()
      await c.query(
        `INSERT INTO sessoes_de_operador (operador_id, token_hash, expira_em)
         VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
        [operador.id, hash, String(DURACAO_SESSAO_PAINEL_MS)],
      )

      // "O operador entrou" é SOBRE operadores, e por isso vai para cá e não
      // para a `auditoria` de clínica nenhuma — é a regra de repartição da
      // D-10, emenda 2.
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: operador.id,
        acao: 'entrou',
        entidade: 'operadores',
        entidadeId: operador.id,
      })

      return { tipo: 'ok' as const, token, operador: operadorPublico(operador) }
    })

    if (resultado.tipo === 'limite') throw new LimiteDeTentativasDoOperador()
    if (resultado.tipo === 'invalida') throw new CredencialDeOperadorInvalida()
    return { operador: resultado.operador, token: resultado.token }
  }

  /**
   * Resolve o cookie do painel em contexto. `null` quando a sessão não vale.
   *
   * O operador é relido do BANCO a cada requisição, e `ativo` é conferido
   * aqui: desativar um operador precisa derrubá-lo **agora**, não quando a
   * sessão de oito horas vencer.
   */
  async contextoDoToken(token: string): Promise<ContextoDoPainel | null> {
    const hash = hashDoToken(token)
    return this.banco.nasTabelasDoPainel(SISTEMA, async (c) => {
      const r = await c.query<LinhaOperador>(
        `SELECT ${colunas('o.')}
           FROM sessoes_de_operador s
           JOIN operadores o ON o.id = s.operador_id
          WHERE s.token_hash = $1
            AND s.revogada_em IS NULL
            AND s.expira_em > now()
            AND o.ativo`,
        [hash],
      )
      const operador = r.rows[0]
      if (!operador) return null
      return {
        // A ÚNICA fonte confiável de `OperadorId`: ele vem do HASH do cookie
        // `__Host-fir-painel`, que é opaco e `HttpOnly`. Quem o apresenta não
        // escolhe o operador que ele resolve.
        ator: operadorIdDeFonteConfiavel(operador.id),
        operador: operadorPublico(operador),
      } satisfies ContextoDoPainel
    })
  }

  /**
   * O operador troca a PRÓPRIA senha — e esta é a saída obrigatória da
   * provisória gerada pelo break-glass da VPS.
   *
   * **Sem esta rota, o primeiro operador nasceria trancado**: o break-glass
   * cria a conta com senha provisória de 72 h, e o painel não tem outro
   * caminho para trocá-la. O painel ficaria fechado três dias depois de ser
   * aberto, e o remédio seria voltar ao SSH.
   *
   * Mesmo molde de `AutenticacaoService.trocarAPropriaSenha`, e as mesmas
   * razões medidas lá: Argon2 fora de transação, **a regra ANTES do hash**
   * (hashear primeiro entregaria ao atacante com sessão válida um jeito de
   * consumir o semáforo com senhas que nunca seriam aceitas), e revogação das
   * OUTRAS sessões.
   *
   * O contexto da regra monta-se AQUI, a partir da sessão, e nunca do corpo —
   * um contexto vindo do cliente seria um contexto vazio escolhido por ele.
   */
  async trocarAPropriaSenha(
    contexto: ContextoDoPainel,
    tokenDaSessao: string,
    atual: string,
    nova: string,
  ): Promise<'ok' | 'atual-invalida' | ErroDeDominio> {
    const linha = await this.banco.nasTabelasDoPainel(contexto.ator, async (c) => {
      const r = await c.query<{ senha_hash: string }>(
        'SELECT senha_hash FROM operadores WHERE id = $1 AND ativo',
        [contexto.operador.id],
      )
      return r.rows[0] ?? null
    })
    if (!linha) return 'atual-invalida'

    const confere = await semaforoArgon2.executar(() => conferirSenha(atual, linha.senha_hash))
    if (!confere) return 'atual-invalida'

    const juizo = avaliarSenha(nova, {
      contexto: [contexto.operador.usuario, contexto.operador.nome],
    })
    if (ehErro(juizo)) return juizo.erro

    const hash = await semaforoArgon2.executar(() => hashDeSenha(nova))
    const hashDaSessaoAtual = hashDoToken(tokenDaSessao)

    await this.banco.nasTabelasDoPainel(contexto.ator, async (c) => {
      await c.query(
        `UPDATE operadores
            SET senha_hash = $1, senha_provisoria = false, senha_provisoria_expira_em = NULL
          WHERE id = $2`,
        [hash, contexto.operador.id],
      )
      // As OUTRAS sessões caem; esta sobrevive, porque derrubá-la devolveria
      // o operador à tela de entrada logo depois de fazer a coisa certa.
      await c.query(
        `UPDATE sessoes_de_operador SET revogada_em = now()
          WHERE operador_id = $1 AND token_hash <> $2 AND revogada_em IS NULL`,
        [contexto.operador.id, hashDaSessaoAtual],
      )
      // A troca é SOBRE operadores: vai para a trilha do painel. O hash não
      // atravessa — `auditoria_sem_segredos` o esconderia de qualquer forma,
      // e aqui ele nem é passado.
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: contexto.operador.id,
        acao: 'alterou',
        entidade: 'operadores',
        entidadeId: contexto.operador.id,
        para: { senha_hash: '(trocada pelo próprio operador)' },
      })
    })

    return 'ok'
  }

  /** Revoga a sessão do painel. Token desconhecido não é erro: nada a fazer. */
  async sair(token: string): Promise<void> {
    const hash = hashDoToken(token)
    await this.banco.nasTabelasDoPainel(SISTEMA, async (c) => {
      await c.query(
        'UPDATE sessoes_de_operador SET revogada_em = now() WHERE token_hash = $1',
        [hash],
      )
    })
  }
}

/**
 * A linha de `auditoria_do_painel`, escrita à mão — não há trigger aqui, e
 * não pode haver: a trigger de auditoria exige `clinica_id`, e nenhuma destas
 * tabelas tem uma.
 *
 * Exportada porque três serviços a usam (entrar, clínicas, pessoas) e três
 * `INSERT` escritos à mão é como um deles esquece o `entidade_id`.
 */
export async function registrarNoPainel(
  c: pg.PoolClient,
  linha: {
    atorTipo: 'operador' | 'vps' | 'sistema'
    atorId: string | null
    acao: 'criou' | 'alterou' | 'removeu' | 'acessou' | 'entrou'
    entidade: string
    entidadeId: string
    de?: unknown
    para?: unknown
    motivo?: string
  },
): Promise<void> {
  await c.query(
    `INSERT INTO auditoria_do_painel
       (ator_tipo, ator_id, acao, entidade, entidade_id, de, para, motivo)
     VALUES ($1, $2, $3, $4, $5, auditoria_sem_segredos($6), auditoria_sem_segredos($7), $8)`,
    [
      linha.atorTipo,
      linha.atorId,
      linha.acao,
      linha.entidade,
      linha.entidadeId,
      linha.de === undefined ? null : JSON.stringify(linha.de),
      linha.para === undefined ? null : JSON.stringify(linha.para),
      linha.motivo ?? null,
    ],
  )
}
