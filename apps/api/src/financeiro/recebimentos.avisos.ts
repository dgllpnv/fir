import {
  AVISOS_DE_CONFIRMACAO,
  CODIGO_CONFIRMACAO_NECESSARIA,
  type ConfirmacaoNecessaria,
  type ConfirmacoesDoRecebimento,
} from '@fir/contracts'
import { avisosDoRecebimento, diaCivil, Dinheiro, janela } from '@fir/domain'
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
 */
export async function conferirAvisosDoRecebimento(
  c: pg.PoolClient,
  x: {
    readonly clinicaId: string
    readonly pacienteId: string
    readonly valor: bigint
    readonly forma: string
    readonly recebidoEm: Date
    readonly fuso: string
    readonly confirmacoes: ConfirmacoesDoRecebimento
  },
): Promise<void> {
  // Valor zero (a venda a prazo) não vai à gaveta e não é duplicidade de
  // dinheiro nenhum: o domínio diria "nada a avisar" — poupa-se a ida ao banco.
  if (x.valor <= 0n) return

  const dia = diaCivil(x.recebidoEm, x.fuso)
  const j = janela(dia, dia, x.fuso)
  const r = await c.query<{ caixa_fechado: boolean; ha_igual: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM caixas_do_dia
                WHERE clinica_id = $1 AND dia = $2::date) AS caixa_fechado,
       EXISTS (SELECT 1 FROM recebimentos r
                 LEFT JOIN tarefas t ON t.id = r.tarefa_id
                WHERE r.clinica_id = $1 AND r.paciente_id = $3
                  AND r.valor = $4::bigint
                  AND ${DINHEIRO_QUE_ENTROU}
                  AND r.estornado_em IS NULL
                  AND (t.id IS NULL OR t.excluida_em IS NULL)
                  AND r.recebido_em >= $5 AND r.recebido_em < $6) AS ha_igual`,
    [x.clinicaId, dia, x.pacienteId, x.valor.toString(), j.de, j.ate],
  )
  const fatos = r.rows[0]!

  const avisos = avisosDoRecebimento({
    forma: x.forma,
    valor: Dinheiro.deCentavos(x.valor),
    caixaFechado: fatos.caixa_fechado,
    haRecebimentoIgual: fatos.ha_igual,
    confirmarCaixaFechado: x.confirmacoes.confirmarCaixaFechado === true,
    confirmarDuplicidade: x.confirmacoes.confirmarDuplicidade === true,
  })
  if (avisos.length === 0) return

  const corpo: ConfirmacaoNecessaria = {
    statusCode: HttpStatus.CONFLICT,
    codigo: CODIGO_CONFIRMACAO_NECESSARIA,
    // A ordem é a do contrato, não a de chegada: a tela pergunta sempre na
    // mesma sequência.
    avisos: AVISOS_DE_CONFIRMACAO.filter((a) => (avisos as readonly string[]).includes(a)),
    message: 'Confirme antes de lançar este recebimento.',
  }
  throw new HttpException(corpo, HttpStatus.CONFLICT)
}

/** Separa as confirmações do resto do corpo — os seis contratos as têm no topo. */
export const confirmacoesDe = (dados: ConfirmacoesDoRecebimento): ConfirmacoesDoRecebimento => ({
  confirmarCaixaFechado: dados.confirmarCaixaFechado,
  confirmarDuplicidade: dados.confirmarDuplicidade,
  confirmarAcimaDaDivida: dados.confirmarAcimaDaDivida,
})
