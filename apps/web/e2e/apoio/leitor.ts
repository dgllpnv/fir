/**
 * O que os testes de navegador do leitor de código têm em comum: a ORIGEM
 * vigiada, as faixas da câmera contadas, a entrada na clínica e a API vista
 * pelo navegador.
 *
 * ## A origem vigiada (S-16, AB-A4-1)
 *
 * Toda requisição que sai da página passa por `vigiaDaOrigem`, um fixture
 * AUTOMÁTICO: o que não for da origem da aplicação é **bloqueado** (o leitor
 * precisa funcionar sem rede externa — AB-A4-1) e **anotado**, e o teste
 * reprova no fim se a lista não estiver vazia (S-16). Bloquear sem reprovar
 * esconderia o defeito: a tela até funcionaria com a fonte embutida, e o CDN
 * passaria despercebido até o dia em que o servidor dele mudar o arquivo.
 * WebSocket entra na mesma regra.
 */
import { type BrowserContext, expect, type Page, test as base } from '@playwright/test'

export const ORIGEM = new URL(process.env['FIR_E2E_URL'] || 'http://127.0.0.1:4810').origin

/** A clínica de demonstração do `pnpm db:seed` — só existe no banco local. */
const CLINICA = process.env['FIR_E2E_CLINICA'] || 'demo'
const USUARIO = process.env['FIR_E2E_USUARIO'] || 'helena'
const SENHA = process.env['FIR_E2E_SENHA'] || 'quatro-pedras-no-caminho'

/** `true` quando a URL sai da origem. `data:` e `blob:` não saem da página. */
function foraDaOrigem(url: string): boolean {
  const u = new URL(url)
  if (u.protocol === 'data:' || u.protocol === 'blob:') return false
  const origem = new URL(ORIGEM)
  const mesma =
    (u.protocol === 'ws:' || u.protocol === 'wss:'
      ? `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`
      : u.origin) === origem.origin
  return !mesma
}

async function vigiar(ctx: BrowserContext, externas: string[]): Promise<void> {
  await ctx.route('**/*', (rota) => {
    const url = rota.request().url()
    if (foraDaOrigem(url)) {
      externas.push(url)
      return rota.abort('blockedbyclient')
    }
    return rota.continue()
  })
  await ctx.routeWebSocket(/.*/, (ws) => {
    if (foraDaOrigem(ws.url())) {
      externas.push(ws.url())
      void ws.close()
      return
    }
    ws.connectToServer()
  })
}

type Opcoes = {
  /** A câmera recusada pela pessoa (`NotAllowedError`). */
  negarCamera: boolean
}

type Fixtures = {
  /** Requisições que tentaram sair da origem — o fixture reprova se houver. */
  vigiaDaOrigem: string[]
  /** Erros de console e exceções da página — o fixture reprova se houver. */
  errosDaPagina: string[]
}

export const test = base.extend<Opcoes & Fixtures>({
  negarCamera: [false, { option: true }],

  vigiaDaOrigem: [
    async ({ context }, usar) => {
      const externas: string[] = []
      await vigiar(context, externas)
      await usar(externas)
      expect(externas, 'requisição para fora da origem da aplicação (S-16)').toEqual([])
    },
    { auto: true },
  ],

  context: async ({ context, negarCamera }, usar) => {
    // Cada `getUserMedia` da página é guardado: é assim que o teste conta as
    // faixas que ficaram vivas (AB-A4-2) sem depender da luz da câmera.
    await context.addInitScript((negar: boolean) => {
      const w = window as unknown as { __streams: MediaStream[] }
      w.__streams = []
      const md = navigator.mediaDevices
      if (md?.getUserMedia === undefined) return
      const original = md.getUserMedia.bind(md)
      md.getUserMedia = async (c?: MediaStreamConstraints) => {
        if (negar) throw new DOMException('negada no teste', 'NotAllowedError')
        const s = await original(c)
        w.__streams.push(s)
        return s
      }
    }, negarCamera)
    await usar(context)
  },

  errosDaPagina: [
    async ({ page }, usar) => {
      const erros: string[] = []
      page.on('console', (m) => {
        if (m.type() !== 'error') return
        const onde = m.location().url
        // A aplicação inteira não tem favicon (anterior ao leitor): 404 conhecido.
        if (onde.endsWith('/favicon.ico')) return
        // O bloqueio da vigia gera o próprio erro de rede; ele já reprova lá.
        if (m.text().includes('ERR_BLOCKED_BY_CLIENT')) return
        erros.push(`${m.text()} @ ${onde}`)
      })
      page.on('pageerror', (e) => erros.push(String(e)))
      await usar(erros)
      expect(erros, 'erro de console na página').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** Entra na clínica de demonstração e para em `/estoque`. */
export async function entrarNoEstoque(page: Page): Promise<void> {
  await page.goto('/entrar')
  const clinica = page.getByLabel('Clínica', { exact: true })
  if (await clinica.isVisible().catch(() => false)) await clinica.fill(CLINICA)
  await page.getByLabel('Usuário').fill(USUARIO)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'))
  await page.goto('/estoque')
  await page.getByRole('button', { name: 'Ler código' }).first().waitFor()
}

/** A API como o navegador a chama: mesma origem, cookie da sessão. */
export async function api<T = unknown>(
  page: Page,
  caminho: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; corpo: T }> {
  return page.evaluate(
    async ({ caminho, init }) => {
      const r = await fetch(`/api/${caminho}`, {
        method: init.method ?? 'GET',
        credentials: 'same-origin',
        ...(init.body === undefined
          ? {}
          : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
      })
      return { status: r.status, corpo: await r.json().catch(() => null) }
    },
    { caminho, init },
  ) as Promise<{ status: number; corpo: T }>
}

type ItemDaLista = { id: string; nome: string; gtin: string }

export const itensDoEstoque = async (page: Page): Promise<ItemDaLista[]> => {
  const r = await api<{ itens: ItemDaLista[] }>(page, 'v1/estoque')
  expect(r.status).toBe(200)
  return r.corpo.itens
}

/** Exclui do catálogo os itens cujo nome começa com o prefixo do teste. */
export async function apagarItensDeTeste(page: Page, prefixo: string): Promise<void> {
  for (const i of (await itensDoEstoque(page)).filter((i) => i.nome.startsWith(prefixo))) {
    const r = await api(page, `v1/estoque/${i.id}`, { method: 'DELETE' })
    expect([200, 204]).toContain(r.status)
  }
}

/** Faixas de câmera com `readyState === 'live'` em toda a vida da página. */
export const faixasVivas = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      (window as unknown as { __streams: MediaStream[] }).__streams
        .flatMap((s) => s.getTracks())
        .filter((t) => t.readyState === 'live').length,
  )

/** Quantas vezes a página pediu a câmera. */
export const aberturasDaCamera = (page: Page): Promise<number> =>
  page.evaluate(() => (window as unknown as { __streams: MediaStream[] }).__streams.length)
