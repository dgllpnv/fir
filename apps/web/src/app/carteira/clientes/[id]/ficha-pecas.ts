import type { ReuniaoNaLista, StatusDoClienteFirmare } from '@fir/contracts'

/**
 * As abas da ficha, nas chaves, na ordem e com os rótulos do protótipo
 * (`vCliente`, `index.html` L1393). A chave vai na URL (`?aba=reunioes`):
 * aba é rota, para o "voltar" do celular voltar de aba (inventário V1).
 */
export const ABAS = [
  { chave: 'visao', rotulo: 'Visão geral' },
  { chave: 'diagnostico', rotulo: 'Briefing' },
  { chave: 'checklist', rotulo: 'Checklist do contrato' },
  { chave: 'plano', rotulo: 'Metas e plano de ação' },
  { chave: 'campanhas', rotulo: 'Campanhas' },
  { chave: 'indicadores', rotulo: 'Indicadores' },
  { chave: 'uso', rotulo: 'Uso da FIR Clinic' },
  { chave: 'documentos', rotulo: 'Documentos' },
  { chave: 'reunioes', rotulo: 'Reuniões' },
] as const

export type Aba = (typeof ABAS)[number]['chave']

/** Uma chave desconhecida na URL cai na visão geral — nunca numa tela vazia. */
export const abaDaUrl = (valor: string | null): Aba => ABAS.find((a) => a.chave === valor)?.chave ?? 'visao'

/** `SAUDE` do protótipo (L510). */
export const ROTULO_DA_SAUDE: Record<NonNullable<ReuniaoNaLista['saudeRegistrada']>, string> = {
  bom: 'Bom',
  atencao: 'Atenção',
  critico: 'Crítico',
}

/** `STATUS_CLI` do protótipo (L511). */
export const ROTULO_DO_STATUS: Record<StatusDoClienteFirmare, string> = {
  onboarding: 'Onboarding',
  ativo: 'Ativo',
  pausado: 'Pausado',
  encerrado: 'Encerrado',
}

/** `TIPO_REU` do protótipo (L1646). */
export const ROTULO_DO_TIPO_DE_REUNIAO: Record<ReuniaoNaLista['tipo'], string> = {
  semanal: 'Semanal',
  mensal: 'Mensal',
  diagnostico: 'Diagnóstico',
  extra: 'Avulsa',
  importada: 'Do Asana',
}
