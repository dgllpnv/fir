import { ChaveDeRelatorio, ExportarRelatorio } from '@fir/contracts'

/**
 * **Como a janela de impressão recebe o que imprimir** (LGPD L-IN-15; appsec C15).
 *
 * Os filtros NÃO vão na URL — a URL é o que o histórico e o proxy guardam —, e
 * nada vai para `sessionStorage`. A aba Relatórios abre a janela e espera ela
 * dizer que está pronta; então manda o pedido (chave, filtros, telefone,
 * finalidade) por `postMessage`, para a MESMA origem. A janela busca as
 * próprias linhas pelo `POST …/exportacoes` com `formato: 'impressao'`, o que
 * já registra a exportação. As linhas nunca atravessam de uma janela para a
 * outra, e recarregar a janela não as traz de volta.
 */
export const CAMINHO_DA_IMPRESSAO = '/indicadores/relatorios/imprimir'

export const JANELA_PRONTA = 'fir-impressao-pronta'
const PEDIDO = 'fir-pedido-de-impressao'

export type PedidoDeImpressao = { readonly chave: ChaveDeRelatorio; readonly pedido: ExportarRelatorio }

export const mensagemDoPedido = (p: PedidoDeImpressao) => ({ tipo: PEDIDO, chave: p.chave, pedido: p.pedido })

export const ehJanelaPronta = (d: unknown): boolean =>
  typeof d === 'object' && d !== null && (d as { tipo?: unknown }).tipo === JANELA_PRONTA

/** O pedido, lido pelo MESMO schema que o servidor usa — nada além dele passa. */
export function lerPedido(d: unknown): PedidoDeImpressao | null {
  if (typeof d !== 'object' || d === null) return null
  const m = d as { tipo?: unknown; chave?: unknown; pedido?: unknown }
  if (m.tipo !== PEDIDO) return null
  const chave = ChaveDeRelatorio.safeParse(m.chave)
  const pedido = ExportarRelatorio.safeParse(m.pedido)
  if (!chave.success || !pedido.success || pedido.data.formato !== 'impressao') return null
  return { chave: chave.data, pedido: pedido.data }
}
