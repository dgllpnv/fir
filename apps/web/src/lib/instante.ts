import { diaCivil, horaCivil } from '@fir/domain'
import { diaEmTexto, somarDiasNaTela } from './formato'

/**
 * Um instante UTC do servidor em texto de tela, **no fuso da clínica**
 * (regra 22): "hoje às 14:32", "ontem às 09:05", "06/11/2026 às 18:40".
 *
 * O dia e a hora saem de `diaCivil`/`horaCivil` (`@fir/domain`), as mesmas
 * funções que o servidor usa para pôr o compromisso no calendário da clínica —
 * e não do fuso do aparelho, que numa gestora viajando diria outra hora.
 * `hoje` é parâmetro e vem do servidor (regra 24).
 *
 * Instante ilegível devolve `null`: a tela decide o que dizer, e "Invalid
 * Date" não é uma delas.
 */
export function instanteEmTexto(iso: string, fuso: string, hoje: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const dia = diaCivil(d, fuso)
  const hora = horaCivil(d, fuso)
  if (dia === hoje) return `hoje às ${hora}`
  if (dia === somarDiasNaTela(hoje, -1)) return `ontem às ${hora}`
  return `${diaEmTexto(dia)} às ${hora}`
}
