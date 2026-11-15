import {
  AVISOS_DE_CONFIRMACAO,
  CODIGO_CONFIRMACAO_NECESSARIA,
  type ConfirmacaoNecessaria,
  type ConfirmacoesDoRecebimento,
} from '@fir/contracts'
import { avisoDeCaixaFechado, avisoDeDuplicidade, diaCivil, Dinheiro, janela } from '@fir/domain'
import { HttpException, HttpStatus } from '@nestjs/common'
import type pg from 'pg'
import { DINHEIRO_QUE_ENTROU } from './dinheiro-que-entrou'

/**
 * **A CHECAGEM DOS AVISOS DE RECEBIMENTO (D-21) — escrita uma vez.**
 *
 * Toda porta que grava uma linha em `recebimentos` chama esta função, dentro
 * da MESMA transação e antes do `INSERT`:
 *
 *   - avulso (`recebimentos.service.ts`, depois de `porRequisicao`: o reenvio
 *     da mesma requisição devolve a linha existente, nunca 409);
 *   - `registrarPagamento` (`tarefas.service.ts`) — concluir tarefa, criar
 *     tarefa já concluída com pagamento, concluir sessão e fechar na jornada;
 *   - montar programa com entrada (`programas.service.ts`).
 *
 * Exceções declaradas: o migrador da v20 e o seed de teste.
 *
 * `recebidoEm` é o instante FINAL — o que vai ser gravado. A janela do dia é
 * semiaberta `[início, fim)` no fuso da CLÍNICA (regra 23), nunca `::date`:
 * o lançamento retroativo para um dia de caixa fechado é exatamente o caso
 * que este aviso existe para pegar.
 *
 * O 409 não carrega número nenhum: a redação central só alcança respostas de
 * sucesso. A tela escreve o texto com o valor que a pessoa digitou.
 *
 * ## DUAS ETAPAS, E A ORDEM É DE SEGURANÇA (achados F1, F2 e F8)
 *
 * Toda recusa que depende de um valor que a pessoa NÃO vê (a duplicidade, a
 * dívida, a oferta) tem de vir DEPOIS das recusas que não dependem — senão a
 * pessoa provoca uma recusa neutra (caixa fechado, campanha inexistente) e lê,
 * pelo código de resposta, de que lado do valor oculto ela está, sem gravar
 * nada. Por isso o caixa é `conferirCaixaDoRecebimento` (vai junto das
 * validações neutras) e a duplicidade é `conferirDuplicidadeDoRecebimento`
 * (vai no fim). Esta função, que roda as duas em sequência, serve a quem não
 * tem nenhuma outra recusa depois dela. Quem tem as duas pendentes recebe dois
 * 409 seguidos; a tela (`comConfirmacao`) já acumula as confirmações.
 */
export async function conferirAvisosDoRecebimento(
  c: pg.PoolClient,
  x: DadosDoAviso,
): Promise<void> {
  await conferirCaixaDoRecebimento(c, x)
  await conferirDuplicidadeDoRecebimento(c, x)
}

type DadosDoAviso = {
  readonly clinicaId: string
  readonly pacienteId: string
  readonly valor: bigint
  readonly forma: string
  readonly recebidoEm: Date
  readonly fuso: string
  readonly confirmacoes: ConfirmacoesDoRecebimento
}

/** `CAIXA_FECHADO` — não depende de valor oculto: vai entre as validações neutras. */
export async function conferirCaixaDoRecebimento(
  c: pg.PoolClient,
  x: Omit<DadosDoAviso, 'pacienteId'>,
): Promise<void> {
  // Valor zero (a venda a prazo) não vai à gaveta: o domínio diria "nada a
  // avisar" — poupa-se a ida ao banco.
  if (x.valor <= 0n) return
  const dia = diaCivil(x.recebidoEm, x.fuso)
  const r = await c.query<{ fechado: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM caixas_do_dia
                     WHERE clinica_id = $1 AND dia = $2::date) AS fechado`,
    [x.clinicaId, dia],
  )
  exigirConfirmacao(
    avisoDeCaixaFechado({
      forma: x.forma,
      valor: Dinheiro.deCentavos(x.valor),
      caixaFechado: r.rows[0]!.fechado,
      confirmarCaixaFechado: x.confirmacoes.confirmarCaixaFechado === true,
    }),
  )
}

/**
 * `POSSIVEL_DUPLICIDADE` — compara com recebimentos que, sem `valores`, a
 * pessoa vê redigidos. É oráculo de IGUALDADE, e por isso vem depois de toda
 * recusa que não depende de valor. Ainda há recusa DEPOIS dele onde existe
 * comparação com valor oculto (oferta no `fechar`, dívida no `saldo`): de
 * propósito — invertida, a duplicidade viraria a recusa neutra que reabre a
 * bisseção (F1/F2, MEDIUM). O resíduo de igualdade (F8, LOW) está aceito e
 * registrado em `docs/dividas.md`.
 */
export async function conferirDuplicidadeDoRecebimento(
  c: pg.PoolClient,
  x: Omit<DadosDoAviso, 'forma'>,
): Promise<void> {
  if (x.valor <= 0n) return
  const dia = diaCivil(x.recebidoEm, x.fuso)
  const j = janela(dia, dia, x.fuso)
  const r = await c.query<{ ha_igual: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM recebimentos r
                      LEFT JOIN tarefas t ON t.id = r.tarefa_id
                     WHERE r.clinica_id = $1 AND r.paciente_id = $2
                       AND r.valor = $3::bigint
                       AND ${DINHEIRO_QUE_ENTROU}
                       AND r.estornado_em IS NULL
                       AND (t.id IS NULL OR t.excluida_em IS NULL)
                       AND r.recebido_em >= $4 AND r.recebido_em < $5) AS ha_igual`,
    [x.clinicaId, x.pacienteId, x.valor.toString(), j.de, j.ate],
  )
  exigirConfirmacao(
    avisoDeDuplicidade({
      valor: Dinheiro.deCentavos(x.valor),
      haRecebimentoIgual: r.rows[0]!.ha_igual,
      confirmarDuplicidade: x.confirmacoes.confirmarDuplicidade === true,
    }),
  )
}

/**
 * Responde 409 `ConfirmacaoNecessaria` quando há aviso a confirmar. Escrita
 * uma vez e usada também pelas outras entradas (`confirmarCaixaFechado`): o
 * corpo do aviso é sempre o mesmo, e a tela o trata num lugar só.
 */
export function exigirConfirmacao(avisos: readonly string[]): void {
  if (avisos.length === 0) return
  const corpo: ConfirmacaoNecessaria = {
    statusCode: HttpStatus.CONFLICT,
    codigo: CODIGO_CONFIRMACAO_NECESSARIA,
    // A ordem é a do contrato, não a de chegada: a tela pergunta sempre na
    // mesma sequência.
    avisos: AVISOS_DE_CONFIRMACAO.filter((a) => avisos.includes(a)),
    message: 'Confirme antes de lançar este recebimento.',
  }
  throw new HttpException(corpo, HttpStatus.CONFLICT)
}

/** Separa as confirmações do resto do corpo — os seis contratos as têm no topo. */
export const confirmacoesDe = (dados: ConfirmacoesDoRecebimento): ConfirmacoesDoRecebimento => ({
  confirmarCaixaFechado: dados.confirmarCaixaFechado,
  confirmarDuplicidade: dados.confirmarDuplicidade,
})
