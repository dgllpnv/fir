/**
 * **Indicadores & Insights — o fluxo principal da tela (T5, backlog 1.9 A–D).**
 *
 * Menu → a tela → "+ Novo" → KPI manual → "Definir meta" → "Lançar valor" →
 * "+ Novo" → OKR com esse KPI: o cartão sai da "Saúde da clínica" e entra em
 * "Prioridades do trimestre". Depois, a tela com a resposta SEM `valores`
 * (`emDinheiro` apagado, como o `RedacaoInterceptor` a entrega): o cartão em
 * reais mostra só o percentual, e a prévia D.3 não tem "R$".
 *
 * 390 px (o padrão da configuração), e nenhuma rolagem horizontal. O que o
 * teste cria é arquivado no fim. Rodar como diz `playwright.config.ts`.
 */
import { expect, type Page, test } from '@playwright/test'

const CLINICA = process.env['FIR_E2E_CLINICA'] || 'demo'
const USUARIO = process.env['FIR_E2E_USUARIO'] || 'helena'
const SENHA = process.env['FIR_E2E_SENHA'] || 'quatro-pedras-no-caminho'
const NOME = `NPS E2E ${Date.now()}`
const OBJETIVO = `Agenda previsível E2E ${Date.now()}`

async function entrar(page: Page): Promise<void> {
  await page.goto('/entrar')
  const clinica = page.getByLabel('Clínica', { exact: true })
  if (await clinica.isVisible().catch(() => false)) await clinica.fill(CLINICA)
  await page.getByLabel('Usuário').fill(USUARIO)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'))
}

const api = (page: Page, caminho: string, init: { method?: string; body?: unknown } = {}) =>
  page.evaluate(
    async ({ caminho, init }) => {
      const r = await fetch(`/api/${caminho}`, {
        method: init.method ?? 'GET',
        credentials: 'same-origin',
        ...(init.body === undefined
          ? {}
          : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
      })
      return { status: r.status, corpo: (await r.json().catch(() => null)) as unknown }
    },
    { caminho, init },
  )

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

/** Apaga todo `emDinheiro` da resposta — o que a redação faz para quem não tem `valores`. */
function apagarDinheiro(o: unknown): void {
  if (Array.isArray(o)) o.forEach(apagarDinheiro)
  else if (o !== null && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'emDinheiro') Reflect.set(o, k, null)
      else apagarDinheiro(v)
    }
  }
}

test('KPI manual, meta, lançamento e OKR, em 390 px', async ({ page }) => {
  await entrar(page)
  const ids: { kpi?: string; okr?: string } = {}
  try {
    await page.goto('/hoje')
    // Em 390 px o menu é a gaveta: abre pelo botão "Menu".
    await page.getByRole('button', { name: 'Menu' }).click()
    await page.getByRole('link', { name: 'Indicadores & Insights' }).first().click()
    await expect(page.getByRole('heading', { name: 'Indicadores & Insights' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Prioridades do trimestre' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Saúde da clínica' })).toBeVisible()
    expect(await semRolagemDeLado(page)).toBe(true)
    // Filtro Unidade (1.9 B): só aparece com mais de uma unidade ativa na clínica.
    await expect(page.locator('.ii-filtros').getByLabel('Unidade')).toHaveCount(((await api(page, 'v1/unidades')).corpo as { unidades: { ativa: boolean }[] }).unidades.filter((u) => u.ativa).length > 1 ? 1 : 0)

    // D.1 — manual, com o aviso do nome (LGPD L-IN-18)
    await page.getByRole('button', { name: '+ Novo' }).click()
    await page.getByRole('menuitem', { name: 'Novo KPI' }).click()
    await page.getByRole('button', { name: /Criar indicador \(manual\)/ }).click()
    await expect(page.getByText('Não use nome de pessoa nem de paciente.')).toBeVisible()
    await page.getByLabel('Nome do indicador').fill(NOME)
    await page.getByRole('dialog').getByLabel('Unidade').selectOption('nota')
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status')).toContainText('Indicador criado.')
    const cartao = page.getByRole('article', { name: NOME })
    await expect(cartao).toBeVisible()
    const lista = await api(page, 'v1/indicadores')
    ids.kpi = (lista.corpo as { itens: { id: string; nome: string }[] }).itens.find((k) => k.nome === NOME)?.id

    // D.3 — a meta a partir do cartão
    await cartao.getByRole('button', { name: 'Definir meta' }).click()
    await page.getByLabel(/Valor-alvo/).fill('9')
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status')).toContainText('Meta criada.')

    // D.4 — lançar. Com o dia de lançar já chegado, o botão é o "Lançar agora" da faixa pendente (C.1).
    await page.getByRole('article', { name: NOME }).getByRole('button', { name: /^Lançar (valor|agora)$/ }).click()
    await page.getByLabel(/^Valor/).fill('8,5')
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status')).toContainText('Valor lançado.')

    // D.2 — o OKR com esse KPI: ele sai da Saúde e entra no OKR
    await page.getByRole('button', { name: '+ Novo' }).click()
    await page.getByRole('menuitem', { name: 'Novo OKR' }).click()
    await page.getByLabel('Objetivo').fill(OBJETIVO)
    await page.getByLabel('Indicador 1').selectOption({ label: NOME })
    await page.getByLabel(/Valor-alvo/).fill('9,5')
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status')).toContainText('OKR criado.')
    const okr = page.getByRole('article', { name: OBJETIVO })
    await expect(okr.getByRole('article', { name: NOME })).toBeVisible()
    const okrs = await api(page, 'v1/indicadores/okrs')
    ids.okr = (okrs.corpo as { itens: { id: string; objetivo: string }[] }).itens.find((o) => o.objetivo === OBJETIVO)?.id
    expect(await semRolagemDeLado(page)).toBe(true)
  } finally {
    if (ids.okr !== undefined) await api(page, `v1/indicadores/okrs/${ids.okr}/arquivar`, { method: 'POST', body: {} })
    if (ids.kpi !== undefined) await api(page, `v1/indicadores/kpis/${ids.kpi}/arquivar`, { method: 'POST', body: {} })
  }
})

test('sem `valores`: o cartão mostra só o percentual e a prévia não tem R$', async ({ page }) => {
  await entrar(page)
  await page.route(/\/api\/v1\/indicadores/, async (route) => {
    const r = await route.fetch()
    const j: unknown = await r.json().catch(() => null)
    if (j === null) return route.fulfill({ response: r })
    apagarDinheiro(j)
    return route.fulfill({ response: r, json: j })
  })
  await page.goto('/indicadores')
  await expect(page.getByRole('heading', { name: 'Saúde da clínica' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const tela = await page.locator('section').first().innerText()
  expect(tela).not.toMatch(/R\$/)

  // A meta de faturamento (migrada da Visão do mês) é em reais: o cartão dela fica no percentual.
  const fat = page.getByRole('article', { name: 'Faturamento conferido' })
  if ((await fat.count()) > 0 && (await fat.getByText(/% da meta/).count()) > 0) {
    await expect(fat.getByText(/% da meta/)).toBeVisible()
    await fat.getByRole('button', { name: /Definir meta|Editar meta/ }).click()
    await page.getByLabel(/Valor-alvo/).fill('120.000,00')
    await expect(page.locator('.ii-previa')).toBeVisible()
    await expect(page.locator('.ii-previa')).not.toContainText('R$')
  }
})
