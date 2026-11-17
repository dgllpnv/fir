/**
 * **Indicadores fora da aba e o Modo reunião (T7, backlog 1.9 A, F e H).**
 *
 * - Modo reunião: abre pelo botão da aba, em tela cheia e fundo creme;
 *   navega pelas setas do teclado e pelos botões ‹ ›, com o "1 de N"; sai
 *   pelo Esc e pelo ✕. Sem `valores` (emDinheiro apagado), nenhum R$.
 * - Hoje: o bloco "Indicadores da semana" com os cartões e o "Ver todos".
 * - Menu: o contador vermelho, que some no zero.
 *
 * 390 px (o padrão da configuração), e nenhuma rolagem horizontal. As
 * respostas de `da-semana` e `contador` são fixadas por `page.route` quando o
 * teste precisa de um estado (a clínica de demonstração pode não ter meta em
 * vermelho); o Modo reunião usa a resposta real. Rodar como diz
 * `playwright.config.ts`.
 */
import { expect, type Page, test } from '@playwright/test'

const CLINICA = process.env['FIR_E2E_CLINICA'] || 'demo'
const USUARIO = process.env['FIR_E2E_USUARIO'] || 'helena'
const SENHA = process.env['FIR_E2E_SENHA'] || 'quatro-pedras-no-caminho'

async function entrar(page: Page): Promise<void> {
  await page.goto('/entrar')
  // Espera o formulário inteiro: o campo "Clínica" pode aparecer depois do
  // "Usuário", e perguntar antes deixa a clínica em branco.
  await page.getByRole('button', { name: 'Entrar' }).waitFor()
  await page.waitForLoadState('load')
  const clinica = page.getByLabel('Clínica', { exact: true })
  if (await clinica.isVisible().catch(() => false)) await clinica.fill(CLINICA)
  await page.getByLabel('Usuário').fill(USUARIO)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'))
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

function apagarDinheiro(o: unknown): void {
  if (Array.isArray(o)) o.forEach(apagarDinheiro)
  else if (o !== null && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'emDinheiro') Reflect.set(o, k, null)
      else apagarDinheiro(v)
    }
  }
}

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const pct = (emNumero: string, percentualDaMeta: number) => ({
  unidade: 'percentual' as const,
  emDinheiro: null,
  emNumero,
  percentualDaMeta,
  escala: null,
})
const DA_SEMANA = {
  hoje: '2026-11-17',
  itens: [
    {
      kpi: { id: UUID(1), nome: 'Conversão de orçamentos', unidade: 'percentual' },
      okrId: null,
      metaDoKpi: {
        id: UUID(11),
        kpiId: UUID(1),
        tipo: 'mes',
        inicio: '2026-11-01',
        prazo: '2026-11-30',
        alvo: pct('4000', 100),
        partida: pct('0', 0),
        medidaPor: 'fir',
        responsavelId: null,
        atual: pct('1800', 45),
        ritmo: pct('2300', 58),
        situacao: 'abaixo',
        progresso: 45,
        projecao: null,
        motivoSemProjecao: null,
      },
    },
  ],
}

/**
 * Em `next dev`, o botão das ferramentas do Next fica no canto inferior
 * esquerdo, em cima do "‹". Em produção ele não existe; aqui ele sai do caminho.
 */
const semFerramentasDoNext = (page: Page) =>
  page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style')
      s.textContent = 'nextjs-portal { display: none !important; }'
      document.head.append(s)
    })
  })

test('Modo reunião: abre, navega pelas setas e pelos botões, e sai pelo Esc e pelo ✕', async ({ page }) => {
  await entrar(page)
  await semFerramentasDoNext(page)
  await page.goto('/indicadores')
  await page.getByRole('link', { name: 'Modo reunião' }).click()
  await page.waitForURL('**/indicadores/reuniao')

  const modo = page.getByRole('region', { name: 'Modo reunião' })
  await expect(modo).toBeVisible()
  // Tela cheia de verdade: o casco (lateral, topo) fica por baixo.
  const caixa = await modo.boundingBox()
  expect(caixa?.width).toBe(390)
  // Fundo creme (1.10, item 13): o `--bg` do tema claro.
  expect(await modo.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(249, 247, 242)')

  const contador = page.locator('.rn-contador')
  await expect(contador).toHaveText(/^1 de \d+$/)
  const total = Number((await contador.innerText()).split(' de ')[1])
  expect(total).toBeGreaterThanOrEqual(2) // a capa e os planos, no mínimo
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await semRolagemDeLado(page)).toBe(true)

  await page.keyboard.press('ArrowRight')
  await expect(contador).toHaveText(`2 de ${total}`)
  await page.keyboard.press('ArrowLeft')
  await expect(contador).toHaveText(`1 de ${total}`)
  await page.getByRole('button', { name: 'Próximo slide' }).click()
  await expect(contador).toHaveText(`2 de ${total}`)
  await page.getByRole('button', { name: 'Slide anterior' }).click()
  await expect(contador).toHaveText(`1 de ${total}`)
  await expect(page.getByRole('button', { name: 'Slide anterior' })).toBeDisabled()

  // O último slide é sempre "Planos de ação da semana".
  await page.keyboard.press('End')
  await expect(contador).toHaveText(`${total} de ${total}`)
  await expect(page.getByRole('heading', { name: 'Planos de ação da semana' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Próximo slide' })).toBeDisabled()
  expect(await semRolagemDeLado(page)).toBe(true)

  await page.keyboard.press('Escape')
  await page.waitForURL((u) => u.pathname === '/indicadores')

  await page.goto('/indicadores/reuniao')
  await expect(page.locator('.rn-contador')).toHaveText(/^1 de \d+$/)
  await page.getByRole('button', { name: 'Sair do Modo reunião' }).click()
  await page.waitForURL((u) => u.pathname === '/indicadores')
})

test('Modo reunião sem `valores`: nenhum R$ em nenhum slide', async ({ page }) => {
  await entrar(page)
  await page.route(/\/api\/v1\/indicadores\/reuniao/, async (route) => {
    const r = await route.fetch()
    const j: unknown = await r.json().catch(() => null)
    if (j === null) return route.fulfill({ response: r })
    apagarDinheiro(j)
    return route.fulfill({ response: r, json: j })
  })
  await page.goto('/indicadores/reuniao')
  const contador = page.locator('.rn-contador')
  await expect(contador).toHaveText(/^1 de \d+$/)
  const total = Number((await contador.innerText()).split(' de ')[1])
  for (let i = 1; i <= total; i++) {
    await expect(contador).toHaveText(`${i} de ${total}`)
    expect(await page.locator('.rn-palco').innerText()).not.toMatch(/R\$/)
    await page.keyboard.press('ArrowRight')
  }
})

test('Hoje: "Indicadores da semana" com os cartões e o "Ver todos"', async ({ page }) => {
  await entrar(page)
  await page.route(/\/api\/v1\/indicadores\/da-semana/, (route) => route.fulfill({ json: DA_SEMANA }))
  await page.goto('/hoje')
  const bloco = page.getByRole('region', { name: 'Indicadores da semana' })
  await expect(bloco).toBeVisible()
  const cartao = bloco.getByRole('link', { name: /Conversão de orçamentos/ })
  await expect(cartao).toHaveAttribute('href', `/indicadores/${UUID(1)}`)
  await expect(cartao).toContainText('Abaixo do ritmo')
  await expect(bloco.getByRole('link', { name: 'Ver todos' })).toHaveAttribute('href', '/indicadores')
  expect(await semRolagemDeLado(page)).toBe(true)
})

test('Hoje: sem meta em alerta, o bloco diz isso', async ({ page }) => {
  await entrar(page)
  await page.route(/\/api\/v1\/indicadores\/da-semana/, (route) => route.fulfill({ json: { hoje: '2026-11-17', itens: [] } }))
  await page.goto('/hoje')
  const bloco = page.getByRole('region', { name: 'Indicadores da semana' })
  await expect(bloco).toContainText('Nenhuma meta abaixo do ritmo ou em atenção esta semana.')
})

test('menu: o contador vermelho aparece com metas abaixo e some no zero', async ({ page }) => {
  await entrar(page)
  let abaixo = 3
  await page.route(/\/api\/v1\/indicadores\/contador/, (route) => route.fulfill({ json: { abaixo } }))
  await page.goto('/hoje')
  await page.getByRole('button', { name: 'Menu' }).click()
  const item = page.getByRole('link', { name: /Indicadores & Insights/ }).first()
  await expect(item.locator('[data-contador="indicadores"]')).toHaveText(/3/)
  await expect(item).toHaveAccessibleName(/3 metas abaixo do ritmo/)

  abaixo = 0
  const respondeu = page.waitForResponse(/\/api\/v1\/indicadores\/contador/)
  await page.reload()
  await respondeu
  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('link', { name: /Indicadores & Insights/ }).first()).toBeVisible()
  await expect(page.locator('[data-contador="indicadores"]')).toHaveCount(0)
})
