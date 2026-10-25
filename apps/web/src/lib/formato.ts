/**
 * Formatação de TELA — e só de tela.
 *
 * O front formata; o front não calcula. Nada aqui soma, subtrai ou decide
 * nada: `atrasada`, `total`, `abertas` e `pagamento` já chegam prontos do
 * servidor. Dinheiro sai de `formatarDinheiro` (`@fir/ui`), nunca daqui.
 */

/** `aaaa-mm-dd` → `dd/mm/aaaa`, sem passar por `Date`. */
export const diaEmTexto = (dia: string): string =>
  `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`

/** `aaaa-mm-dd` → `dd/mm`, para a faixa e para as listas apertadas. */
export const diaCurto = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

const DIAS_DA_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const
const DIAS_POR_EXTENSO = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const

/**
 * O dia da semana de um dia civil, SEM fuso.
 *
 * `new Date('2026-10-24')` é meia-noite UTC, e em `America/Bahia` isso é 21h
 * do dia 23 — o nome do dia sairia errado para metade do planeta. `Date.UTC`
 * com as partes separadas mantém a data de calendário como ela é.
 */
function indiceDoDia(dia: string): number {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
}

export const abreviacaoDoDia = (dia: string): string => DIAS_DA_SEMANA[indiceDoDia(dia)] ?? ''
export const nomeDoDia = (dia: string): string => DIAS_POR_EXTENSO[indiceDoDia(dia)] ?? ''

/** O número do dia, para a faixa da semana. */
export const numeroDoDia = (dia: string): string => dia.slice(8, 10)

/**
 * "Hoje", "Ontem", "Amanhã" ou o dia da semana com a data.
 *
 * `hoje` é PARÂMETRO e vem do servidor: o relógio do navegador não decide que
 * dia é hoje (regra 24). A recepção que abre a ferramenta às 23h55 e a vê
 * virar o dia antes da clínica é a confusão que isso evita.
 */
export function rotuloDoDia(dia: string, hoje: string): string {
  if (dia === hoje) return 'Hoje'
  const ontem = somarDiasNaTela(hoje, -1)
  const amanha = somarDiasNaTela(hoje, 1)
  if (dia === ontem) return 'Ontem'
  if (dia === amanha) return 'Amanhã'
  return `${nomeDoDia(dia)}, ${diaEmTexto(dia)}`
}

/**
 * Soma dias a um dia civil — aritmética de CALENDÁRIO, para rótulo e
 * navegação de semana.
 *
 * Existe aqui e não em `@fir/domain` porque este é o único uso de tela, e
 * importar o pacote de domínio inteiro no cliente só por isto traria consigo
 * `Dinheiro`, `Quantidade` e a tabela de permissões para o navegador. A
 * aritmética é a mesma, e o teste ao lado compara as duas.
 */
export function somarDiasNaTela(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  const t = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) + n))
  const dois = (x: number) => String(x).padStart(2, '0')
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`
}

/**
 * O link de conversa a partir do telefone cadastrado.
 *
 * Acrescenta o 55 quando o número tem só DDD + 8 ou 9 dígitos, como o
 * `waLink` do protótipo. Abaixo de 10 dígitos não há link: um ramal anotado
 * no lugar do celular abriria uma conversa com quem não é a paciente.
 */
export function linkDeWhatsApp(telefone: string | null): string | null {
  const digitos = (telefone ?? '').replace(/\D/g, '')
  if (digitos.length < 10) return null
  return `https://wa.me/${digitos.length <= 11 ? '55' : ''}${digitos}`
}

/** "1 tarefa" / "3 tarefas", sem o "(s)" que ninguém escreve à mão. */
export const plural = (n: number, um: string, varios: string): string =>
  `${n} ${n === 1 ? um : varios}`
