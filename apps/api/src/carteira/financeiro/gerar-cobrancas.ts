import { Dinheiro, type Relogio, aplicarDesconto, diaCivil, vencimentoDaCompetencia } from '@fir/domain'
import { BancoService } from '../../banco/banco.service'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'

/**
 * **G3 — O JOB QUE GERA `cobrancas_do_cliente_firmare`.** Spec
 * `docs/superpowers/plans/g3-spec-metas-e-lancamentos.md` §2.2; ADR 0015.
 *
 * Uma linha por `Cliente Firmare` `ativo` ou `onboarding`, com
 * `mensalidade_centavos > 0` e `dia_vencimento` informado (PP-4 e ajuste 1
 * do gate de números G8 — o mesmo filtro do protótipo, `aplica`, L880), por
 * competência (mês, no fuso da carteira). Vence no dia de CADA cliente, com a
 * regra 25 (`vencimentoDaCompetencia`, ajuste 4).
 *
 * **Roda TODO DIA** (D-22 item 10, ajuste 5): gera a competência do mês
 * corrente para quem ainda não tem. Assim a primeira cobrança é a do mês de
 * entrada, cheia (ADR 0015 §2, confirmada pela D-22 item 8) — o cliente que
 * entra no dia 12 é cobrado naquele mês, como o protótipo mostra.
 * **IDEMPOTENTE** (regra 26): `INSERT ... ON CONFLICT (cliente_carteira_id,
 * competencia) DO NOTHING`, NUNCA `DO UPDATE` — achado 2 do ADR 0015. Rodar o
 * job três vezes no mesmo dia produz a MESMA linha, com o MESMO valor, mesmo
 * que a mensalidade tenha mudado entre as execuções.
 *
 * **ATOMICIDADE benefício × cobrança** (achado 3 do ADR 0015): dentro da MESMA
 * transação por cliente, (1) reivindica um `Benefício de indicação` não
 * consumido com `SELECT ... FOR UPDATE SKIP LOCKED` — a trava evita que duas
 * execuções concorrentes apliquem o MESMO benefício duas vezes; (2) calcula o
 * desconto (se houver benefício) com `aplicarDesconto`; (3) insere a
 * `Cobrança` com `ON CONFLICT DO NOTHING`; (4) SÓ SE a linha foi de fato
 * inserida (não houve conflito), consome o benefício. Se a cobrança JÁ
 * existia (execução repetida), o benefício reivindicado nesta rodada nunca é
 * marcado como consumido — ele continua disponível para a competência
 * seguinte, exatamente como se esta execução não tivesse acontecido.
 */

export type FalhaDaGeracaoDeCobranca = { readonly clienteCarteiraId: string; readonly erro: string }

export type ResumoDaGeracaoDeCobrancas = {
  /** Quantas `Cobrança` foram de fato CRIADAS nesta execução (não conta as que já existiam). */
  readonly geradas: number
  readonly falhas: readonly FalhaDaGeracaoDeCobranca[]
}

type ClienteAtivo = { id: string; grupo_id: string; mensalidade_centavos: string; dia_vencimento: number }
type BeneficioCandidato = { id: string; percentual_centesimos: string }

/**
 * `yyyy-MM-01` do mês em que o instante cai NO FUSO DA CARTEIRA (gate de
 * números G8, ajuste 3 e T-14). Antes era UTC, e às 21h do último dia do mês
 * em Salvador já era o mês seguinte: o job gerava a competência errada.
 */
export function competenciaDoMes(instante: Date, fuso: string = FUSO_DA_CARTEIRA): string {
  return `${diaCivil(instante, fuso).slice(0, 7)}-01`
}

/**
 * `competenciaAlvo`, se informado, SUBSTITUI a competência calculada do
 * relógio — existe para reprocessar um mês específico e para o teste, que não
 * pode esperar a virada real do mês para provar idempotência. Em produção, o
 * agendador nunca o informa.
 *
 * `soDosGrupos`, se informado, restringe a varredura a esses grupos. Existe
 * SÓ para o teste: a varredura de produção é global, e um teste que a roda
 * global escreve cobranças nos clientes de outro arquivo rodando em paralelo
 * (D16) — desde que `onboarding` também é cobrado, isso alcança quase todo
 * arquivo da carteira. O agendador nunca o informa.
 */
export async function executarGeracaoDeCobrancas(
  banco: BancoService,
  relogio: Relogio,
  competenciaAlvo?: string,
  soDosGrupos?: readonly string[],
): Promise<ResumoDaGeracaoDeCobrancas> {
  const competencia = competenciaAlvo ?? competenciaDoMes(relogio.agora())

  const clientes = await banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
    c.query<ClienteAtivo>(
      `SELECT id, grupo_id, mensalidade_centavos::text AS mensalidade_centavos, dia_vencimento
         FROM clientes_carteira
        WHERE status IN ('ativo', 'onboarding') AND excluido_em IS NULL
          -- CE-1 (gate de números G8): mensalidade 0 não gera cobrança — e,
          -- portanto, não queima o benefício numa cobrança de R$ 0.
          AND mensalidade_centavos > 0
          -- Sem dia de vencimento não há quando cobrar (PP-4, L880).
          AND dia_vencimento IS NOT NULL
          AND ($1::uuid[] IS NULL OR grupo_id = ANY($1::uuid[]))
        ORDER BY id`,
      [soDosGrupos ? [...soDosGrupos] : null],
    ),
  )

  let geradas = 0
  const falhas: FalhaDaGeracaoDeCobranca[] = []

  for (const cliente of clientes.rows) {
    try {
      const vencimento = vencimentoDaCompetencia(competencia, cliente.dia_vencimento)
      const gerou = await banco.nasTabelasDaCarteiraComEscopo('geral', null, async (c) => {
        // (1) Reivindica — SKIP LOCKED: uma execução concorrente que já tenha
        // a linha travada é simplesmente ignorada, nunca esperada.
        const beneficio = await c.query<BeneficioCandidato>(
          `SELECT id, percentual_centesimos::text AS percentual_centesimos
             FROM beneficios_de_indicacao
            WHERE cliente_carteira_id = $1 AND consumido_em IS NULL
            ORDER BY criado_em
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [cliente.id],
        )
        const candidato = beneficio.rows[0] ?? null

        // (2) Calcula — SEMPRE pelo domínio, nunca aritmética solta aqui.
        const mensalidade = Dinheiro.deCentavos(BigInt(cliente.mensalidade_centavos))
        const { desconto, cobranca } = candidato
          ? aplicarDesconto(mensalidade, BigInt(candidato.percentual_centesimos))
          : { desconto: Dinheiro.zero(), cobranca: mensalidade }
        // Defesa em profundidade do CE-1 (ajuste 2 do gate de números G8): o
        // benefício só é APLICADO — gravado na cobrança e consumido — quando
        // o desconto existiu de fato. Um benefício nunca é gasto num desconto 0.
        const aplicado = candidato !== null && desconto.centavos > 0n ? candidato : null

        // (3) Insere — a chave de idempotência é o UNIQUE da migration 0031.
        const inserida = await c.query<{ id: string }>(
          `INSERT INTO cobrancas_do_cliente_firmare
             (cliente_carteira_id, grupo_id, competencia, mensalidade_centavos,
              desconto_centavos, valor_centavos, beneficio_id, vencimento)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (cliente_carteira_id, competencia) DO NOTHING
           RETURNING id`,
          [
            cliente.id,
            cliente.grupo_id,
            competencia,
            mensalidade.centavos.toString(),
            desconto.centavos.toString(),
            cobranca.centavos.toString(),
            aplicado?.id ?? null,
            vencimento,
          ],
        )
        const nova = inserida.rows[0]
        // Conflito: a cobrança já existia de uma execução anterior. NENHUM
        // benefício é consumido nesta rodada — o candidato reivindicado acima
        // (se houver) permanece disponível, como se esta execução não tivesse
        // acontecido. É isto que torna o job idempotente em VALOR, não só em
        // contagem de linhas (achado 2, ADR 0015).
        if (!nova) return false

        // (4) Consome — só agora, e só porque a cobrança É NOVA.
        if (aplicado) {
          await c.query(
            `UPDATE beneficios_de_indicacao
                SET consumido_em = now(), cobranca_id = $2
              WHERE id = $1 AND consumido_em IS NULL`,
            [aplicado.id, nova.id],
          )
        }
        return true
      })
      if (gerou) geradas += 1
    } catch (erro) {
      falhas.push({
        clienteCarteiraId: cliente.id,
        erro: erro instanceof Error ? erro.message : String(erro),
      })
    }
  }

  return { geradas, falhas }
}
