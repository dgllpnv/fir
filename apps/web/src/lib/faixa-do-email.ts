/**
 * O "Agora não" da faixa **Cadastre seu e-mail** (spec 2, fluxo 6).
 *
 * `sessionStorage`, e não `localStorage`: o adiamento vale **até a próxima
 * entrada**, não para sempre — uma faixa adiada para sempre é uma faixa que
 * não existe, e a pessoa fica sem como redefinir a senha sozinha. A tela de
 * entrada esquece o adiamento a cada entrada, e fechar o navegador também.
 *
 * Tudo em `try/catch`: janela anônima com armazenamento bloqueado lança, e a
 * faixa não pode ser o motivo de o sistema não abrir. Sem armazenamento, a
 * faixa simplesmente volta a cada carregamento.
 */
export const CHAVE_DO_ADIAMENTO = 'fir.faixa-do-email.adiada'

type Armazenamento = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const sessao = (): Armazenamento | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function faixaAdiada(a: Armazenamento | null = sessao()): boolean {
  try {
    return a?.getItem(CHAVE_DO_ADIAMENTO) === '1'
  } catch {
    return false
  }
}

export function adiarFaixa(a: Armazenamento | null = sessao()): void {
  try {
    a?.setItem(CHAVE_DO_ADIAMENTO, '1')
  } catch {
    // Some agora e volta no próximo carregamento. Melhor que não sumir.
  }
}

export function esquecerAdiamento(a: Armazenamento | null = sessao()): void {
  try {
    a?.removeItem(CHAVE_DO_ADIAMENTO)
  } catch {
    // Nada a fazer: sem armazenamento, não havia adiamento guardado.
  }
}

/**
 * Quem vê a faixa: uma PESSOA (nunca a sessão de suporte do operador), sem
 * e-mail confirmado, numa instalação com o envio de e-mail ligado. Com o envio
 * desligado o pedido responderia 503 — a faixa pediria uma coisa que a
 * instalação não consegue fazer.
 */
export const mostraFaixaDoEmail = (
  pessoa: { readonly emailConfirmado: boolean } | null,
  envioDeEmail: boolean,
): boolean => pessoa !== null && !pessoa.emailConfirmado && envioDeEmail
