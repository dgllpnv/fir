/**
 * **"Lugar único" e as prioridades do trimestre** (revisão S6 e P1).
 *
 * - Equipe › Metas do mês e cada campanha (lista e detalhe) mostram
 *   "Acompanhar em Indicadores & Insights" quando a clínica acompanha o KPI
 *   correspondente — o id vem do servidor (`kpiDoAtingimentoId`,
 *   `kpiDoResultadoId`), e o link abre o detalhe daquele KPI.
 * - O resumo da faixa "Prioridades do trimestre" é o `prioridades` do
 *   servidor, sem média refeita no navegador.
 *
 * O que o teste cria é arquivado (KPI) ou excluído (campanha) no fim.
 */
import { expect, type Page, test } from '@playwright/test'

const CLINICA = process.env['FIR_E2E_CLINICA'] || 'demo'
const USUARIO = process.env['FIR_E2E_USUARIO'] || 'helena'
const SENHA = process.env['FIR_E2E_SENHA'] || 'quatro-pedras-no-caminho'
const ATALHO = /Acompanhar em Indicadores/

async function entrar(page: Page): Promise<void> {
  // A clínica no link, e a espera pela forma recolhida: só existe depois da hidratação.
  await page.goto(`/entrar?clinica=${encodeURIComponent(CLINICA)}`)
  await expect(page.locator('.clinica-do-link')).toContainText(CLINICA, { timeout: 30_000 })
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

test('Metas do mês: o atalho leva ao KPI "Atingimento das metas individuais"', async ({ page }) => {
  await entrar(page)
  const cat = await api(page, 'v1/indicadores/catalogo')
  const item = (cat.corpo as { itens: { chave: string; kpiId: string | null }[] }).itens.find((i) => i.chave === 'atingimento_metas_individuais')
  let kpiId = item?.kpiId ?? null
  const criado = kpiId === null
  if (criado) {
    const r = await api(page, 'v1/indicadores/kpis', {
      method: 'POST',
      body: { origem: 'catalogo', chave: 'atingimento_metas_individuais', frequencia: 'mensal', responsavelId: null },
    })
    expect(r.status, JSON.stringify(r.corpo)).toBeLessThan(300)
    kpiId = (r.corpo as { id: string }).id
  }
  try {
    await page.goto('/equipe')
    await page.getByRole('button', { name: 'Metas do mês' }).or(page.getByRole('tab', { name: 'Metas do mês' })).first().click()
    const atalho = page.getByRole('link', { name: ATALHO })
    await expect(atalho).toHaveAttribute('href', `/indicadores/${kpiId}`)
    expect(await semRolagemDeLado(page)).toBe(true)
  } finally {
    if (criado && kpiId !== null) await api(page, `v1/indicadores/kpis/${kpiId}/arquivar`, { method: 'POST', body: {} })
  }
  // Sem o KPI acompanhado, o servidor manda `null`, e não há link.
  if (criado) {
    await page.reload()
    await page.getByRole('button', { name: 'Metas do mês' }).or(page.getByRole('tab', { name: 'Metas do mês' })).first().click()
    await expect(page.getByText(/Defina as metas do mês/)).toBeVisible()
    await expect(page.getByRole('link', { name: ATALHO })).toHaveCount(0)
  }
})

test('Campanhas: o atalho da campanha leva ao KPI do resultado dela, na lista e no detalhe', async ({ page }) => {
  await entrar(page)
  const eu = await api(page, 'v1/indicadores/okrs')
  const hoje = (eu.corpo as { hoje: string }).hoje
  const nome = `Campanha E2E ${Date.now()}`
  const c = await api(page, 'v1/campanhas', {
    method: 'POST',
    body: { nome, inicio: hoje, fim: hoje, metrica: 'convertidos', metaEmNumero: 10 },
  })
  expect(c.status, JSON.stringify(c.corpo)).toBeLessThan(300)
  const campanhaId = (c.corpo as { campanhas: { id: string; nome: string }[] }).campanhas.find((x) => x.nome === nome)?.id
  expect(campanhaId).toBeDefined()
  let kpiId: string | undefined
  try {
    const k = await api(page, 'v1/indicadores/kpis', {
      method: 'POST',
      body: { origem: 'catalogo', chave: 'resultado_de_campanha', frequencia: 'mensal', responsavelId: null, parametros: { campanhaId } },
    })
    expect(k.status, JSON.stringify(k.corpo)).toBeLessThan(300)
    kpiId = (k.corpo as { id: string }).id

    await page.goto('/campanhas')
    const naLista = page.getByRole('link', { name: ATALHO })
    await expect(naLista).toHaveCount(1)
    await expect(naLista).toHaveAttribute('href', `/indicadores/${kpiId}`)
    expect(await semRolagemDeLado(page)).toBe(true)

    await page.goto(`/campanhas/${campanhaId}`)
    await expect(page.getByRole('heading', { name: nome })).toBeVisible()
    await expect(page.getByRole('link', { name: ATALHO })).toHaveAttribute('href', `/indicadores/${kpiId}`)
    await page.getByRole('link', { name: ATALHO }).click()
    await page.waitForURL(`**/indicadores/${kpiId}`)
  } finally {
    if (kpiId !== undefined) await api(page, `v1/indicadores/kpis/${kpiId}/arquivar`, { method: 'POST', body: {} })
    if (campanhaId !== undefined) await api(page, `v1/campanhas/${campanhaId}`, { method: 'DELETE' })
  }
})

test('Prioridades do trimestre: o resumo é o `prioridades` do servidor', async ({ page }) => {
  await entrar(page)
  await page.goto('/indicadores')
  const okrs = await api(page, 'v1/indicadores/okrs')
  const p = (okrs.corpo as { prioridades: { quantos: number; media: number | null } }).prioridades
  const cabeca = page.locator('.ii-faixa-cabeca').first()
  await expect(cabeca.getByRole('heading', { name: 'Prioridades do trimestre' })).toBeVisible()
  if (p.quantos === 0) {
    await expect(cabeca.locator('.ii-resumo')).toHaveCount(0)
  } else {
    await expect(cabeca.locator('.ii-resumo')).toHaveText(`${p.quantos} em andamento${p.media === null ? '' : ` · média ${p.media}%`}`)
  }
})
