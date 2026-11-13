/**
 * Abertura da aba do sistema da clínica pela sessão de suporte.
 *
 * Mora fora da tela para ser testável sem DOM. O defeito que isto corrige:
 * `window.open(url, '_blank', 'noopener')` devolve `null` POR ESPECIFICAÇÃO,
 * então a tela tomava toda abertura como pop-up bloqueado e escrevia uma frase
 * longa dentro da célula da tabela. A aba é aberta SEM `noopener` e o vínculo
 * é cortado à mão (`opener = null`) — o mesmo isolamento. Só `null` é bloqueio.
 */
export type AbaAberta = { opener: unknown }

export function abrirAbaDeSuporte(
  abrir: () => AbaAberta | null,
): 'aberta' | 'bloqueada' {
  const aba = abrir()
  if (aba === null) return 'bloqueada'
  aba.opener = null
  return 'aberta'
}

export const TEXTO_SUPORTE_ABERTO = (codigo: string) =>
  `Sessão de suporte aberta em ${codigo} por 30 min.`

export const TEXTO_SUPORTE_BLOQUEADO = (codigo: string) =>
  `A sessão de ${codigo} está aberta, mas o navegador bloqueou a aba nova.`
