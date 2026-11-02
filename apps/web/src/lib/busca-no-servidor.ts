import { cookies } from 'next/headers'

const API = process.env.FIR_API_URL || 'http://127.0.0.1:4811'

/**
 * Busca na API **a partir do servidor do Next**, repassando o cookie da pessoa.
 *
 * **Por que isto existe, e é medição, não gosto.** A VPS fica em Boston e o
 * ida-e-volta até o Brasil é de **137 ms** (D-11). Uma tela que recebe o HTML
 * e só então pede o dado pelo navegador paga esse custo **duas vezes** antes
 * de mostrar qualquer coisa — e a tela Hoje é a que a clínica deixa aberta o
 * dia inteiro.
 *
 * Buscando aqui, o pedido sai de dentro da VPS: o salto até a API é local, e
 * a recepcionista paga 137 ms uma vez só, já com a lista pronta no HTML.
 *
 * **Devolve `null` em vez de lançar.** Uma tela que falha ao buscar o dado
 * inicial ainda tem caminho: o cliente tenta de novo e mostra o estado de
 * erro que `useDados` já sabe desenhar. Derrubar a página inteira por causa
 * de um bloco trocaria um erro recuperável por uma tela branca.
 */
export async function buscarNoServidor<T>(caminho: string): Promise<T | null> {
  try {
    const cabecalho = (await cookies()).toString()
    const r = await fetch(`${API}/${caminho.replace(/^\//, '')}`, {
      headers: { cookie: cabecalho },
      cache: 'no-store',
    })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}
