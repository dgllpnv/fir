/**
 * Onde o painel está, lido do ENDEREÇO.
 *
 * **Por que o endereço e não um estado:** a faixa do painel afirma, em toda
 * tela e a todo momento, em qual clínica se está agindo. Uma afirmação dessas
 * só é confiável se a fonte dela for a mesma coisa que o navegador mostra na
 * barra — um `useState` guardado por uma tela anterior continuaria dizendo
 * "Dra Suzana Lima" depois de o operador voltar para a lista, e no painel
 * "a clínica errada" é a clínica de outra pessoa.
 *
 * Nada aqui calcula nem decide: é leitura de caminho. Puro, e por isso testado
 * sem navegador.
 */

/** O prefixo do painel. `superadmin`, nunca `painel` — ver `CONTEXT.md`. */
const CLINICAS = '/gestao/clinicas'

/**
 * O id da clínica em que a tela atual age, ou `null` quando nenhuma.
 *
 * `/gestao/clinicas` é a LISTA: ela não age em clínica nenhuma, e devolver
 * a primeira da lista ali seria a pior resposta possível.
 */
export function clinicaDaRota(caminho: string): string | null {
  if (!caminho.startsWith(`${CLINICAS}/`)) return null
  const bruto = caminho.slice(CLINICAS.length + 1).split('/')[0] ?? ''
  if (bruto === '') return null
  try {
    return decodeURIComponent(bruto)
  } catch {
    // `%` solto não é escape válido. "Não sei qual clínica" é uma resposta;
    // derrubar a faixa por causa de um endereço torto não é.
    return null
  }
}

/**
 * As PORTAS do painel — entrar e trocar a senha provisória.
 *
 * Elas não têm faixa, e a razão não é estética: antes de entrar não há
 * operador nem clínica para nomear, e uma faixa que dissesse "nenhuma clínica"
 * na tela de senha ensinaria a ignorá-la. Cada uma carrega o selo
 * `PAINEL INTERNO` no próprio corpo (ver `.superadmin-porta`), que é o mesmo
 * sinal com o espaço que a tela de porta tem para dar.
 */
export const PORTAS: readonly string[] = ['/gestao/entrar', '/gestao/trocar-senha']

export const ehPortaDoPainel = (caminho: string): boolean =>
  PORTAS.includes(caminho.replace(/\/$/, ''))
