import { Dinheiro, type Relogio, aplicarDesconto } from '@fir/domain'
import { BancoService } from '../../banco/banco.service'

/**
 * **G3 — O JOB QUE GERA `cobrancas_do_cliente_firmare`.** Spec
 * `docs/superpowers/plans/g3-spec-metas-e-lancamentos.md` §2.2; ADR 0015.
 *
 * Uma linha por `Cliente Firmare` `status = 'ativo'`, por competência (mês).
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

type ClienteAtivo = { id: string; grupo_id: string; mensalidade_centavos: string }
type BeneficioCandidato = { id: string; percentual_centesimos: string }

/** `yyyy-MM-01` do mês em que o instante cai, em UTC — a competência é um rótulo de calendário da Firmare, não um conceito por-fuso-de-clínica (regra 22/23 não se aplica: isto não é janela de atendimento de uma clínica). */
function competenciaDoMes(instante: Date): string {
  const ano = instante.getUTCFullYear()
  const mes = String(instante.getUTCMonth() + 1).padStart(2, '0')
  return `${ano}-${mes}-01`
}

/**
 * O vencimento da competência — dia 10 do mesmo mês. Decisão do engenheiro
 * (não há regra no spec/ADR 0015 sobre o DIA do vencimento, só sobre o VALOR):
 * escolhido por ser o prazo mais comum de boleto B2B recorrente; ajustável
 * sem quebrar idempotência, porque `vencimento` não faz parte da chave
 * `UNIQUE (cliente_carteira_id, competencia)`.
 */
function vencimentoDaCompetencia(competencia: string): string {
  const [ano, mes] = competencia.split('-').map(Number)
  const d = new Date(Date.UTC(ano ?? 1970, (mes ?? 1) - 1, 10))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * `competenciaAlvo`, se informado, SUBSTITUI a competência calculada do
 * relógio — existe para reprocessar um mês específico e para o teste, que não
 * pode esperar a virada real do mês para provar idempotência. Em produção, o
 * agendador nunca o informa.
 */
export async function executarGeracaoDeCobrancas(
  banco: BancoService,
  relogio: Relogio,
  competenciaAlvo?: string,
): Promise<ResumoDaGeracaoDeCobrancas> {
  const competencia = competenciaAlvo ?? competenciaDoMes(relogio.agora())
  const vencimento = vencimentoDaCompetencia(competencia)

  const clientes = await banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
    c.query<ClienteAtivo>(
      `SELECT id, grupo_id, mensalidade_centavos::text AS mensalidade_centavos
         FROM clientes_carteira
        WHERE status = 'ativo' AND excluido_em IS NULL`,
    ),
  )

  let geradas = 0
  const falhas: FalhaDaGeracaoDeCobranca[] = []

  for (const cliente of clientes.rows) {
    try {
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
            candidato?.id ?? null,
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
        if (candidato) {
          await c.query(
            `UPDATE beneficios_de_indicacao
                SET consumido_em = now(), cobranca_id = $2
              WHERE id = $1 AND consumido_em IS NULL`,
            [candidato.id, nova.id],
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
