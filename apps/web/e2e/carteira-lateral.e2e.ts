/**
 * **A LATERAL DA CARTEIRA**, no navegador — o menu saiu do topo do conteúdo
 * e foi para a barra lateral à esquerda (protótipo do Firmare Gestão,
 * index.html L45, L481–489). O que se cobra aqui é o que nenhum teste de
 * unidade vê:
 *
 *  - nenhuma tela da carteira rola de lado, em 390, 1280 e 1440 px, nos dois
 *    temas (`scrollWidth == innerWidth`) — e a FIR Clinic também em 900 e
 *    960 px, onde a lateral come 232 px de uma janela "larga";
 *  - o item aceso é o da área (`aria-current="page"`), um só;
 *  - o badge é o número do servidor;
 *  - a gaveta de 390 px: o foco entra, Esc fecha e devolve o foco, fechada
 *    ela não fica no caminho do Tab;
 *  - quem abre `/carteira` sem sessão não vê o menu antes do desvio;
 *  - o cabeçalho da Visão geral: título numa linha só no computador, ações à
 *    direita — e o `/gestao`, que usa o MESMO componente, sem rolar.
 *
 * A sessão é a da conta de gestão do OPERADOR do painel: ele entra em
 * `/gestao` e o servidor abre junto a conta de gestão dele (ADR 0024).
 * `FIR_E2E_OPERADOR` e `FIR_E2E_OPERADOR_SENHA` dizem quem; sem elas o arquivo
 * é pulado (a semente da clínica `demo` não cria operador).
 */
import { type Browser, expect, type Page, test } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OPERADOR = process.env['FIR_E2E_OPERADOR'] ?? ''
const SENHA = process.env['FIR_E2E_OPERADOR_SENHA'] ?? ''
const ESTADO = join(tmpdir(), `fir-e2e-carteira-${process.pid}.json`)

test.skip(OPERADOR === '' || SENHA === '', 'defina FIR_E2E_OPERADOR e FIR_E2E_OPERADOR_SENHA')

type Rota = { readonly caminho: string; readonly acesa: string | null }

let rotas: Rota[] = []
let contadores: { tarefasVencidas: number | null; contatosAgora: number | null } = {
  tarefasVencidas: null,
  contatosAgora: null,
}

/**
 * Entra pela PORTA do painel, no navegador: os cookies são `__Host-` e
 * `Secure`, e só o navegador os guarda em `http://127.0.0.1`. A Visão geral
 * do painel abre a conta de gestão do operador quando ela falta.
 */
async function abrirSessao(page: Page): Promise<void> {
  await page.goto('/gestao/entrar')
  await page.getByLabel('Usuário do painel').fill(OPERADOR)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Entrar no painel' }).click()
  await page.waitForURL('**/gestao')
  await expect(page.locator('.visao-cabeca h1')).toBeVisible({ timeout: 20_000 })
}

const lerApi = <T>(page: Page, caminho: string) =>
  page.evaluate(async (c) => (await fetch(`/api/${c}`, { credentials: 'same-origin' })).json(), caminho) as Promise<T>

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await abrirSessao(page)
  const lista = await lerApi<{ clientes: { id: string }[] }>(page, 'v1/carteira/clientes')
  const id = lista.clientes[0]?.id
  expect(id, 'a carteira local precisa de ao menos uma cliente').toBeTruthy()
  contadores = await lerApi<typeof contadores>(page, 'v1/carteira/eu/contadores')
  await ctx.storageState({ path: ESTADO })
  await ctx.close()

  rotas = [
    { caminho: '/carteira', acesa: '/carteira' },
    { caminho: '/carteira/rotina', acesa: '/carteira/rotina' },
    { caminho: '/carteira/rotina/rotinas', acesa: '/carteira/rotina' },
    { caminho: '/carteira/carga', acesa: '/carteira/rotina' },
    { caminho: '/carteira/clientes', acesa: '/carteira/clientes' },
    { caminho: `/carteira/clientes/${id}`, acesa: '/carteira/clientes' },
    { caminho: `/carteira/clientes/${id}/cadastro`, acesa: '/carteira/clientes' },
    { caminho: '/carteira/entrada', acesa: null },
    { caminho: '/carteira/fir-clinic', acesa: '/carteira/fir-clinic' },
    { caminho: '/carteira/metas', acesa: '/carteira/metas' },
    { caminho: '/carteira/campanhas', acesa: '/carteira/campanhas' },
    { caminho: `/carteira/campanhas/${id}`, acesa: '/carteira/campanhas' },
    { caminho: '/carteira/resumo', acesa: '/carteira/resumo' },
    { caminho: '/carteira/mensalidades', acesa: '/carteira/mensalidades' },
    { caminho: '/carteira/leads', acesa: '/carteira/leads' },
    { caminho: '/carteira/leads/indicacoes', acesa: '/carteira/leads' },
    { caminho: '/carteira/metodo/roteiros', acesa: '/carteira/metodo/roteiros' },
    { caminho: '/carteira/metodo/biblioteca', acesa: '/carteira/metodo/biblioteca' },
    { caminho: '/carteira/metodo/checklists', acesa: '/carteira/metodo/checklists' },
    { caminho: '/carteira/metodo/mensagens', acesa: '/carteira/metodo/mensagens' },
  ]
})

const TEMAS = { claro: 'light', escuro: 'dark' } as const

async function comTema(page: Page, tema: keyof typeof TEMAS): Promise<void> {
  await page.addInitScript((t) => localStorage.setItem('fir.tema', t), tema)
}

/** Abre a tela e espera ela ASSENTAR: sem esqueleto e sem rede pendente. */
async function abrir(page: Page, caminho: string): Promise<void> {
  await page.goto(caminho)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.carteira-menu')).toHaveCount(1)
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 })
}

const larguras = (page: Page) =>
  page.evaluate(() => ({ rolagem: document.documentElement.scrollWidth, janela: window.innerWidth }))

for (const largura of [390, 1280, 1440]) {
  for (const tema of ['claro', 'escuro'] as const) {
    test(`nenhuma tela rola de lado — ${largura} px, ${tema}`, async ({ browser }) => {
      test.setTimeout(300_000)
      const ctx = await browser.newContext({ storageState: ESTADO, viewport: { width: largura, height: 900 } })
      const page = await ctx.newPage()
      await comTema(page, tema)
      const falhas: string[] = []
      for (const r of rotas) {
        await abrir(page, r.caminho)
        expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe(TEMAS[tema])
        const { rolagem, janela } = await larguras(page)
        if (rolagem !== janela) falhas.push(`${r.caminho}: scrollWidth ${rolagem} ≠ innerWidth ${janela}`)

        const acesos = page.locator('.carteira-menu a[aria-current="page"]')
        if (r.acesa === null) await expect(acesos, r.caminho).toHaveCount(0)
        else {
          await expect(acesos, r.caminho).toHaveCount(1)
          await expect(acesos, r.caminho).toHaveAttribute('href', r.acesa)
        }
        // O menu é desenhado UMA vez, pela lateral — nunca de novo dentro da tela.
        await expect(page.locator('.carteira-principal nav[aria-label="Áreas da carteira"]'), r.caminho).toHaveCount(0)

        // A lateral é coluna no computador e gaveta fechada em 390.
        const aside = page.locator('aside.carteira-lateral')
        if (largura >= 900) await expect(aside).toBeVisible()
        else await expect(aside).toBeHidden()
      }
      expect(falhas).toEqual([])
      await ctx.close()
    })
  }
}

for (const largura of [900, 960]) {
  for (const tema of ['claro', 'escuro'] as const) {
    test(`a FIR Clinic não rola de lado ao lado da lateral — ${largura} px, ${tema}`, async ({ browser }) => {
      const ctx = await browser.newContext({ storageState: ESTADO, viewport: { width: largura, height: 900 } })
      const page = await ctx.newPage()
      await comTema(page, tema)
      await abrir(page, '/carteira/fir-clinic')
      await expect(page.locator('aside.carteira-lateral')).toBeVisible()
      const { rolagem, janela } = await larguras(page)
      expect(rolagem).toBe(janela)
      await ctx.close()
    })
  }
}

test('o badge do menu é o número do servidor', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: ESTADO, viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await abrir(page, '/carteira/clientes')
  const casos = [
    { href: '/carteira/rotina', n: contadores.tarefasVencidas },
    { href: '/carteira/leads', n: contadores.contatosAgora },
  ]
  for (const c of casos) {
    const badge = page.locator(`.carteira-menu a[href="${c.href}"] .carteira-menu-badge`)
    if (typeof c.n === 'number' && c.n > 0) await expect(badge).toHaveText(String(c.n))
    else await expect(badge).toHaveCount(0)
  }
  await ctx.close()
})

test('390 px: a gaveta recebe o foco, fecha no Esc e, fechada, fica fora do Tab', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: ESTADO, viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await abrir(page, '/carteira/clientes')
  const menu = page.getByRole('button', { name: 'Menu', exact: true })
  const aside = page.locator('aside.carteira-lateral')

  // Fechada: do botão "Menu", vinte Tabs nunca entram na gaveta.
  await menu.focus()
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab')
    const dentro = await page.evaluate(() => document.activeElement?.closest('aside.carteira-lateral') !== null)
    expect(dentro, `Tab ${i + 1} entrou na gaveta fechada`).toBe(false)
  }

  // Abre: o foco vai para o primeiro item.
  await menu.click()
  await expect(aside).toBeVisible()
  await expect(menu).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.carteira-menu-item').first()).toBeFocused()

  // Esc fecha e devolve o foco a quem abriu.
  await page.keyboard.press('Escape')
  await expect(aside).toBeHidden()
  await expect(menu).toBeFocused()
  await expect(menu).toHaveAttribute('aria-expanded', 'false')

  // Tocar um item navega e fecha.
  await menu.click()
  await page.locator('.carteira-menu a[href="/carteira/metas"]').click()
  await page.waitForURL('**/carteira/metas')
  await expect(aside).toBeHidden()
  const { rolagem, janela } = await larguras(page)
  expect(rolagem).toBe(janela)
  await ctx.close()
})

test('sem sessão, o menu não aparece antes do desvio para a entrada', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  let soltar: () => void = () => {}
  const segura = new Promise<void>((r) => {
    soltar = r
  })
  await page.route('**/api/v1/carteira/eu', async (rota) => {
    await segura
    await rota.continue()
  })
  await page.goto('/carteira')
  // A sessão ainda não respondeu: só a marca, nada de menu nem de conteúdo.
  await expect(page.locator('.carteira-marca').first()).toBeVisible()
  await page.waitForTimeout(800)
  await expect(page.locator('.carteira-menu')).toHaveCount(0)
  await expect(page.locator('.carteira-lateral-pe')).toHaveCount(0)
  await expect(page.locator('.visao')).toHaveCount(0)
  soltar()
  await page.waitForURL('**/carteira/entrar')
  await expect(page.locator('.carteira-menu')).toHaveCount(0)
  await ctx.close()
})

/** O título "Olá, …" cabe numa linha: a altura é a de uma linha só. */
const tituloNumaLinha = (page: Page) =>
  page.locator('.visao-cabeca h1').evaluate((h) => {
    const e = getComputedStyle(h)
    const linha = e.lineHeight === 'normal' ? parseFloat(e.fontSize) * 1.35 : parseFloat(e.lineHeight)
    return h.getBoundingClientRect().height < linha * 1.5
  })

for (const largura of [1280, 1440]) {
  test(`Visão geral a ${largura} px: título numa linha, ações à direita sem esticar`, async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ESTADO, viewport: { width: largura, height: 900 } })
    const page = await ctx.newPage()
    // O nome de produção, o mais longo que a revisão de produto mediu.
    await page.route('**/api/v1/carteira/painel', async (rota) => {
      const r = await rota.fetch()
      await rota.fulfill({ response: r, json: { ...(await r.json()), nome: 'Administrador Firmare' } })
    })
    await abrir(page, '/carteira')
    await expect(page.locator('.visao-cabeca h1')).toHaveText('Olá, Administrador Firmare')
    expect(await tituloNumaLinha(page)).toBe(true)
    const caixa = await page.locator('.visao-cabeca').boundingBox()
    const acoes = await page.locator('.visao-cabeca > .visao-atalhos').boundingBox()
    expect(caixa && acoes && Math.abs(caixa.x + caixa.width - (acoes.x + acoes.width)) < 1).toBe(true)
    const id = await page.locator('.visao-identidade').boundingBox()
    expect(id && acoes && acoes.x > id.x + 200).toBe(true)
    await ctx.close()
  })
}

for (const largura of [390, 1280]) {
  test(`o /gestao (mesma Visão geral) segue de pé — ${largura} px`, async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: ESTADO, viewport: { width: largura, height: 900 } })
    const page = await ctx.newPage()
    await page.goto('/gestao')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('.visao-cabeca h1')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('nav.superadmin-nav')).toBeVisible()
    await expect(page.locator('aside.carteira-lateral')).toHaveCount(0)
    const { rolagem, janela } = await larguras(page)
    expect(rolagem).toBe(janela)
    await ctx.close()
  })
}
