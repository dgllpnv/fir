import { ImpressaoDoRelatorio } from '@/components/relatorios/impressao-do-relatorio'
import '@/components/relatorios/relatorios.css'

/**
 * `/indicadores/relatorios/imprimir` — a folha que vira o PDF (I-39).
 *
 * Sem filtro na URL (appsec C15): o pedido chega da aba Relatórios por
 * `postMessage`, e as linhas, pelo `POST …/exportacoes` desta própria página.
 */
export default function ImprimirRelatorioPage() {
  return <ImpressaoDoRelatorio />
}
