import { canonizarUsuario, ehErro, validarUsuario } from '@fir/domain'

/**
 * A clínica da tela de entrada — **que vem do LINK, não do teclado**.
 *
 * É assim que as quatro clínicas em uso entram hoje. O `GUIA-INSTALACAO.md`
 * da v20 dá a cada uma o próprio endereço (`?clinica=institutorp`,
 * `?clinica=drasuzanalima`, `?clinica=drajoicefraga`), e o protótipo lê o
 * parâmetro e **lembra a clínica neste aparelho** para quem abrir sem o final
 * do link. A recepcionista nunca digita o código: ela abre o favorito dela.
 *
 * **Não existe, e não vai existir, rota pública que liste as clínicas.** Era a
 * alternativa — um menu com as clínicas cadastradas na tela de entrada — e foi
 * recusada pelo dono (D-12): a rota responderia antes de qualquer
 * autenticação, publicaria a lista de clientes do produto e tiraria um dos
 * dois desconhecidos da credencial, que hoje é clínica + usuário + senha. É a
 * mesma classe do `equipePublica` da v20, que removemos de propósito. O
 * seletor com a lista mora no painel do superadmin, que é autenticado e só
 * abre do IP do escritório. Cobrado por `teste/rotas-protegidas.test.ts`.
 */

/** A chave no `localStorage`. Trocá-la faz as quatro clínicas esquecerem a sua. */
export const CHAVE_DA_CLINICA = 'fir.clinica'

/**
 * O código que a tela oferece quando não há link nem memória.
 *
 * `demo` é a clínica de desenvolvimento e de demonstração. Ela não é palpite
 * sobre a clínica de ninguém: numa máquina de desenvolvimento é sempre a
 * certa, e em produção quem tem o link nunca chega aqui.
 */
export const CLINICA_DE_DESENVOLVIMENTO = 'demo'

/**
 * O código canônico, ou `''` quando o que veio não é um código de clínica.
 *
 * A canonização é a **do domínio** (`canonizarUsuario`), e a forma é cobrada
 * por `validarUsuario` — as mesmas duas funções que o contrato
 * `CodigoDeClinica` usa na criação da clínica. Escrever uma segunda
 * normalização aqui seria a segunda verdade sobre o que é um código, e a que
 * ninguém revisasse ficaria para trás.
 *
 * Fora da forma, o parâmetro é **ignorado** em vez de pré-selecionado: um
 * código que o banco não aceitaria viraria "Usuário ou senha incorretos" sem
 * ninguém entender por quê, e a recepcionista jura que abriu o link certo.
 */
export const codigoDeClinicaOuVazio = (bruto: string | null | undefined): string => {
  if (typeof bruto !== 'string') return ''
  const canonico = canonizarUsuario(bruto)
  return ehErro(validarUsuario(canonico)) ? '' : canonico
}

/**
 * Lê `?clinica=` de uma query string. Aceita com e sem `?` na frente porque
 * `location.search` entrega com, e teste e chamador futuro entregam sem.
 */
export function clinicaDoParametro(busca: string): string {
  try {
    const p = new URLSearchParams(busca.startsWith('?') ? busca.slice(1) : busca)
    return codigoDeClinicaOuVazio(p.get('clinica'))
  } catch {
    // `URLSearchParams` não lança para string nenhuma hoje, mas uma query
    // malformada não pode ser o motivo de a tela de entrada não abrir.
    return ''
  }
}

/**
 * Qual clínica a tela abre: **o link vence a memória, e a memória vence o
 * padrão**.
 *
 * O link é intenção — quem abriu o endereço de outra clínica quis a outra
 * clínica. A memória é conveniência, para quem salvou o favorito sem o final
 * do link ou digitou o código uma vez.
 */
export function clinicaInicial(busca: string, guardada: string | null): string {
  return (
    clinicaDoParametro(busca) || codigoDeClinicaOuVazio(guardada) || CLINICA_DE_DESENVOLVIMENTO
  )
}

/** Lê a clínica lembrada neste aparelho. */
export function clinicaGuardada(): string | null {
  try {
    return localStorage.getItem(CHAVE_DA_CLINICA)
  } catch {
    // Janela anônima com cookies de terceiros bloqueados: `localStorage`
    // lança. Não lembrar a clínica é pior que não abrir a tela de entrada.
    return null
  }
}

/** Lembra a clínica neste aparelho. Código fora da forma não é gravado. */
export function lembrarClinica(codigo: string): void {
  const canonico = codigoDeClinicaOuVazio(codigo)
  if (canonico === '') return
  try {
    localStorage.setItem(CHAVE_DA_CLINICA, canonico)
  } catch {
    // Vale para esta sessão e não persiste. Melhor que recusar a entrada.
  }
}
