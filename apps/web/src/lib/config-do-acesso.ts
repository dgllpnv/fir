import { ConfigDoAcesso } from '@fir/contracts'

const API = process.env.FIR_API_URL || 'http://127.0.0.1:4811'

/**
 * `GET /v1/acesso/config`, do SERVIDOR do web — para o layout decidir a faixa
 * "Cadastre seu e-mail" antes do primeiro render.
 *
 * Falha vira `false`: sem resposta, a faixa não aparece, e nada mais muda. Um
 * aviso que some quando a API soluça é melhor que uma tela inteira que não
 * abre por causa dele.
 */
export async function envioDeEmailLigado(): Promise<boolean> {
  try {
    const r = await fetch(`${API}/v1/acesso/config`, { cache: 'no-store' })
    if (!r.ok) return false
    const c = ConfigDoAcesso.safeParse(await r.json().catch(() => null))
    return c.success && c.data.envioDeEmail
  } catch {
    return false
  }
}
