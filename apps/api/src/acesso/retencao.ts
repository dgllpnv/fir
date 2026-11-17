import type { Relogio } from '@fir/domain'
import { SISTEMA } from '../banco/ator'
import type { BancoService } from '../banco/banco.service'
import { type ClinicaId, clinicaIdDeFonteConfiavel } from '../banco/clinica-id'

/** O lote de cada `DELETE`: transação curta, e o job repete até voltar zero. */
export const LOTE_DA_RETENCAO = 1000

export type PurgaDoAcesso = { readonly links: number; readonly eventos: number }

/**
 * **A RETENÇÃO DO ACESSO POR E-MAIL** (LGPD L5 e L6; `retencao.md`, migration
 * 0111): `links_de_acesso` 30 dias depois do último entre prazo, uso e
 * invalidação; `eventos_de_acesso` com 1 ano.
 *
 * Os prazos e o `DELETE` moram na função `purgar_acesso_vencido`, no banco:
 * `fir_app` não tem `DELETE` nessas tabelas (0097), e a função de
 * `fir_migrate` só apaga o que venceu, só da clínica fixada nesta transação.
 * A `auditoria` não é tocada (D9 é decisão à parte).
 *
 * Reentrante por construção: apagar o que já não existe apaga zero.
 */
export async function purgarAcessoDaClinica(
  banco: BancoService,
  clinicaId: ClinicaId,
  agora: Date,
  lote: number = LOTE_DA_RETENCAO,
): Promise<PurgaDoAcesso> {
  let links = 0
  let eventos = 0
  for (;;) {
    // Uma transação POR lote: a trilha de cada link apagado entra junto, e
    // nenhum lock fica aberto enquanto a clínica inteira é varrida.
    const r = await banco.naClinica(clinicaId, SISTEMA, (c) =>
      c.query<{ links: number; eventos: number }>('SELECT links, eventos FROM purgar_acesso_vencido($1, $2)', [
        agora,
        lote,
      ]),
    )
    const l = r.rows[0]
    if (l === undefined) break
    links += l.links
    eventos += l.eventos
    if (l.links < lote && l.eventos < lote) break
  }
  return { links, eventos }
}

/**
 * O job diário: toda clínica, ativa ou não (o prazo de retenção não para
 * quando a clínica sai). Uma falha numa clínica não segura as outras; o
 * resumo leva só contagens e ids (regra 21).
 */
export async function executarRetencaoDoAcesso(
  banco: BancoService,
  relogio: Relogio,
): Promise<{ clinicas: number; links: number; eventos: number; falhas: string[] }> {
  const clinicas = await banco.semIsolamentoDeClinica<{ id: string }>('SELECT id FROM clinicas')
  const agora = relogio.agora()
  let links = 0
  let eventos = 0
  const falhas: string[] = []
  for (const cl of clinicas.rows) {
    try {
      const r = await purgarAcessoDaClinica(banco, clinicaIdDeFonteConfiavel(cl.id), agora)
      links += r.links
      eventos += r.eventos
    } catch {
      falhas.push(cl.id)
    }
  }
  return { clinicas: clinicas.rows.length, links, eventos, falhas }
}
