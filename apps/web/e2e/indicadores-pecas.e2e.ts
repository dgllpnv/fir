/**
 * **Indicadores & Insights — as peças da tela que faltavam** (backlog 1.9 C.1, D.3, D.4 e H).
 *
 * 1. A tarefa "Lançar [KPI]" em Hoje abre a janela D.4 — e a RESPONSÁVEL SEM
 *    `indicadores` (Juliana, Recepção na semente) lança por ali: a exceção
 *    `podeLancar` do T3. O que a janela precisa chega pela tarefa; nenhuma
 *    rota de leitura de indicadores responde a ela.
 * 2. A meta "Todo mês (recorrente)": mês inteiro, partida travada em 0, e o
 *    detalhe do KPI diz "todo mês".
 * 3. A faixa amarela "Lançamento da semana pendente" no cartão do KPI manual,
 *    com "Lançar agora", que some depois do lançamento.
 *
 * 390 px (padrão da configuração), sem rolagem de lado. O que o teste cria é
 * arquivado no fim. Rodar como diz `playwright.config.ts`.
 */
import { expect, type Page, test } from '@playwright/test'

const CLINICA = process.env['FIR_E2E_CLINICA'] || 'demo'
const SENHA = process.env['FIR_E2E_SENHA'] || 'quatro-pedras-no-caminho'
const GESTORA = process.env['FIR_E2E_USUARIO'] || 'helena'
/** Recepção na semente: sem `indicadores`. */
const RECEPCAO = process.env['FIR_E2E_RECEPCAO'] || 'juliana'

async function entrar(page: Page, usuario: string): Promise<void> {
  await page.goto('/entrar')
  const clinica = page.getByLabel('Clínica', { exact: true })
  if (await clinica.isVisible().catch(() => false)) await clinica.fill(CLINICA)
  await page.getByLabel('Usuário').fill(usuario)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'))
}

async function sair(page: Page): Promise<void> {
  await page.context().clearCookies()
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

/** 1 = segunda … 7 = domingo, do dia civil que o SERVIDOR mandou. */
const diaDaSemana = (dia: string): number => {
  const d = new Date(`${dia}T12:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

type Pessoa = { id: string; usuario?: string; nome: string }

async function hojeDoServidor(page: Page): Promise<string> {
  const r = await api(page, 'v1/indicadores/okrs')
  return (r.corpo as { hoje: string }).hoje
}

async function idDe(page: Page, nome: string): Promise<string> {
  const r = await api(page, 'v1/equipe')
  const p = (r.corpo as { equipe: Pessoa[] }).equipe.find((x) => x.nome.startsWith(nome))
  if (p === undefined) throw new Error(`pessoa ${nome} não está na semente`)
  return p.id
}

/** KPI manual semanal com o dia de lançar = hoje: a tarefa nasce para hoje, e o cartão fica pendente. */
async function criarKpiManual(page: Page, nome: string, responsavelId: string): Promise<string> {
  const hoje = await hojeDoServidor(page)
  const r = await api(page, 'v1/indicadores/kpis', {
    method: 'POST',
    body: {
      origem: 'manual',
      nome,
      pilar: 'Comercial',
      unidade: 'nota',
      direcao: 'maior',
      frequencia: 'semanal',
      diaDeLancamento: diaDaSemana(hoje),
      comoMedir: 'Nota média do Google no domingo',
      responsavelId,
    },
  })
  expect(r.status, JSON.stringify(r.corpo)).toBeLessThan(300)
  return (r.corpo as { id: string }).id
}

test('a responsável SEM `indicadores` lança pela tarefa em Hoje', async ({ page }) => {
  const nome = `NPS Hoje E2E ${Date.now()}`
  let kpiId: string | undefined
  await entrar(page, GESTORA)
  try {
    kpiId = await criarKpiManual(page, nome, await idDe(page, 'Juliana'))
    await sair(page)

    await entrar(page, RECEPCAO)
    // A exceção não abre leitura (appsec C2).
    expect((await api(page, 'v1/indicadores')).status).toBe(403)

    await page.goto('/hoje')
    const tarefa = page.getByRole('article').filter({ hasText: `Lançar ${nome}` })
    await expect(tarefa).toBeVisible()
    expect(await semRolagemDeLado(page)).toBe(true)

    await tarefa.getByRole('button', { name: 'Lançar valor' }).click()
    const janela = page.getByRole('dialog')
    await expect(janela.getByRole('heading', { name: `Lançar: ${nome}` })).toBeVisible()
    await expect(janela.getByText('Nota média do Google no domingo')).toBeVisible()
    await janela.getByLabel(/^Valor/).fill('9,1')
    await janela.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status')).toContainText('Valor lançado. A tarefa de lançamento foi concluída.')
    await expect(janela).toBeHidden()

    // A tarefa saiu das abertas e está nas concluídas.
    await expect(page.locator('article[data-situacao="concluida"]').filter({ hasText: `Lançar ${nome}` })).toBeVisible()
    expect(await semRolagemDeLado(page)).toBe(true)
  } finally {
    await sair(page)
    if (kpiId !== undefined) {
      await entrar(page, GESTORA)
      await api(page, `v1/indicadores/kpis/${kpiId}/arquivar`, { method: 'POST', body: {} })
    }
  }
})

test('o cartão pendente mostra a faixa amarela, e "Lançar agora" a tira', async ({ page }) => {
  const nome = `NPS Faixa E2E ${Date.now()}`
  let kpiId: string | undefined
  await entrar(page, GESTORA)
  try {
    kpiId = await criarKpiManual(page, nome, await idDe(page, 'Juliana'))
    await page.goto('/indicadores')
    const cartao = page.getByRole('article', { name: nome })
    await expect(cartao.getByText('Lançamento da semana pendente')).toBeVisible()
    await expect(cartao.getByText('ainda sem lançamento')).toBeVisible()
    expect(await semRolagemDeLado(page)).toBe(true)

    // Quem gerencia também lança (podeLancar).
    await cartao.getByRole('button', { name: 'Lançar agora' }).click()
    await page.getByRole('dialog').getByLabel(/^Valor/).fill('8')
    await page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status')).toContainText('Valor lançado')
    await expect(cartao.getByText('Lançamento da semana pendente')).toBeHidden()
    await expect(cartao.getByText(/^lançado por \S+ em \d{2}\/\d{2}$/)).toBeVisible()
  } finally {
    if (kpiId !== undefined) await api(page, `v1/indicadores/kpis/${kpiId}/arquivar`, { method: 'POST', body: {} })
  }
})

test('a meta "Todo mês (recorrente)": mês inteiro, partida 0, e o detalhe diz "todo mês"', async ({ page }) => {
  const nome = `NPS Série E2E ${Date.now()}`
  let kpiId: string | undefined
  await entrar(page, GESTORA)
  try {
    kpiId = await criarKpiManual(page, nome, await idDe(page, 'Juliana'))
    await page.goto('/indicadores')
    const cartao = page.getByRole('article', { name: nome })
    await cartao.getByRole('button', { name: 'Definir meta' }).click()

    await page.getByLabel('Todo mês (recorrente)').check()
    await expect(page.getByLabel('A partir de')).toBeVisible()
    await expect(page.getByText('Cada mês da série começa do zero.')).toBeVisible()
    await expect(page.getByLabel('Valor de partida')).toBeDisabled()
    await page.getByLabel(/Valor-alvo/).fill('9')
    expect(await semRolagemDeLado(page)).toBe(true)
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status')).toContainText('Meta criada.')

    // O servidor criou a série: este mês e o próximo.
    const d = await api(page, `v1/indicadores/kpis/${kpiId}`)
    const metas = (d.corpo as { metas: { tipo: string; serieId: string | null; inicio: string }[] }).metas
    expect(metas.filter((m) => m.tipo === 'recorrente' && m.serieId !== null).length).toBeGreaterThanOrEqual(2)

    await page.goto(`/indicadores/${kpiId}`)
    await expect(page.getByText(/· todo mês/).first()).toBeVisible()
    await expect(page.getByText(/^em \S+: 9$/)).toBeVisible()
    expect(await semRolagemDeLado(page)).toBe(true)
  } finally {
    if (kpiId !== undefined) await api(page, `v1/indicadores/kpis/${kpiId}/arquivar`, { method: 'POST', body: {} })
  }
})
