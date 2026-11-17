/**
 * **Relatórios — um filtro raro em "+ Mais opções"** (backlog 1.8; revisão da
 * branch, S2; docs/design.md: campo raro fica recolhido).
 *
 * No relatório 15, a situação do prazo mora em "+ Mais opções": fechada, ela
 * não aparece; aberta, a escolha vai no CORPO da execução (nunca na URL,
 * appsec C15), o servidor responde 200 e toda linha da tabela é da situação
 * escolhida. 390 px, sem rolagem de lado. Rodar como diz `playwright.config.ts`.
 */
import { expect, type Page, test } from '@playwright/test'

const CLINICA = process.env['FIR_E2E_CLINICA'] || 'demo'
const USUARIO = process.env['FIR_E2E_USUARIO'] || 'helena'
const SENHA = process.env['FIR_E2E_SENHA'] || 'quatro-pedras-no-caminho'

async function entrar(page: Page): Promise<void> {
  await page.goto('/entrar')
  const clinica = page.getByLabel('Clínica', { exact: true })
  if (await clinica.isVisible().catch(() => false)) await clinica.fill(CLINICA)
  await page.getByLabel('Usuário').fill(USUARIO)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'))
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('filtro em "+ Mais opções": a situação do relatório 15 vai no corpo e estreita a tabela', async ({ page }) => {
  await entrar(page)
  await page.goto('/indicadores/relatorios')
  await page.getByRole('button', { name: /^Tarefas da equipe/ }).click()

  // Recolhido: a situação não está na tela até abrir "+ Mais opções".
  await expect(page.getByRole('combobox', { name: 'Situação', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '+ Mais opções' }).click()
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('atrasada')

  const execucao = page.waitForRequest((r) => /\/api\/v1\/relatorios\/tarefas-da-equipe\/execucoes$/.test(r.url()))
  const resposta = page.waitForResponse((r) => /\/api\/v1\/relatorios\/tarefas-da-equipe\/execucoes$/.test(r.url()))
  await page.getByRole('button', { name: 'Gerar' }).click()
  const pedido = await execucao
  expect(pedido.url()).not.toContain('atrasada')
  expect((pedido.postDataJSON() as { filtros: Record<string, unknown> }).filtros).toMatchObject({ situacao: 'atrasada' })
  expect((await resposta).status()).toBe(200)

  await expect(page.locator('.rel-resumo')).toBeVisible()
  const situacoes = await page.locator('.rel-tabela tbody tr td').filter({ hasText: /^(No prazo|Com atraso|Atrasada|A vencer)$/ }).allInnerTexts()
  for (const s of situacoes) expect(s).toBe('Atrasada')
  expect(await semRolagemDeLado(page)).toBe(true)
})
