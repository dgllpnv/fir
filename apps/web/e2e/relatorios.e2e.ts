/**
 * **Relatórios — exportação, storage e favorito (T8; backlog 1.9 G, 1.10 itens 14 e 18).**
 *
 *  - `exportacao-cabecalho-e-aviso`: o relatório 1 filtrado por procedimento é
 *    classe `saude`: a confirmação pede a finalidade (sem ela o botão não
 *    acende), e os TRÊS formatos saem com o cabeçalho do servidor — clínica,
 *    filtros, código — e o aviso de saúde. CSV e XLSX são lidos do arquivo
 *    baixado; o PDF é a página de impressão aberta em outra aba.
 *  - `storage-sem-linhas` (LGPD L-IN-15): depois de gerar e exportar, nenhum
 *    nome de paciente do resultado está em `localStorage`, `sessionStorage`
 *    nem IndexedDB, e a URL não leva filtro.
 *  - O favorito roda com UM clique.
 *
 * 390 px (padrão da configuração), sem rolagem de lado. Precisa da clínica
 * `demo` semeada com ao menos um procedimento (ver `gerarPacientesPorProcedimento`
 * sobre a linha sintética); o que o teste cria (o favorito) é arquivado no fim. Rodar como diz
 * `playwright.config.ts`.
 */
import { readFile } from 'node:fs/promises'
import { expect, type Page, test } from '@playwright/test'
import * as XLSX from 'xlsx'

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

/** O nome da linha sintética — só existe na TELA, nunca no banco. */
const SINTETICO = 'Paciente Sintetico E2E'

/**
 * Abre o relatório 1 filtrado por procedimento (classe `saude`) e gera.
 *
 * A semente local não tem compra com mais de um mês, e o relatório volta
 * vazio. Quando volta, UMA linha sintética é acrescentada à resposta da
 * EXECUÇÃO (a da tela), para que "Exportar" exista. A exportação em si vai ao
 * servidor de verdade: o cabeçalho, o aviso, a finalidade e o código que o
 * teste confere são os dele. Com dado real na base, a linha sintética não
 * entra.
 */
async function gerarPacientesPorProcedimento(page: Page): Promise<string[]> {
  await page.route(/\/api\/v1\/relatorios\/pacientes-sem-compra\/execucoes$/, async (rota) => {
    const r = await rota.fetch()
    const j = (await r.json().catch(() => null)) as { linhas?: unknown[] } | null
    if (j === null || !Array.isArray(j.linhas) || j.linhas.length > 0) return rota.fulfill({ response: r })
    j.linhas.push({
      pacienteId: '00000000-0000-4000-8000-000000000e2e',
      nome: SINTETICO,
      ultimaCompra: '2026-01-02',
      procedimento: 'Procedimento',
      valorDaUltimaCompra: null,
      ltv: null,
    })
    return rota.fulfill({ response: r, json: j })
  })
  await page.goto('/indicadores/relatorios')
  await page.getByRole('button', { name: /^Pacientes sem compra/ }).click()
  await page.getByLabel('Sem compra há').selectOption('outro')
  await page.getByLabel('Quantos meses').fill('1')
  const procedimento = page.getByLabel('Procedimento')
  await expect(procedimento.locator('option').nth(1)).toBeAttached()
  await procedimento.selectOption({ index: 1 })
  await page.getByRole('button', { name: 'Gerar' }).click()
  await expect(page.locator('.rel-tabela tbody tr').first()).toBeVisible()
  return page.locator('.rel-tabela tbody tr td:first-child a, .rel-tabela tbody tr td:first-child').allInnerTexts()
}

/** Exportar › formato › (telefone desligado, finalidade exigida) › Exportar. */
async function exportar(page: Page, formato: 'Excel' | 'CSV' | 'PDF'): Promise<void> {
  await page.getByRole('button', { name: 'Exportar' }).click()
  await page.getByRole('menuitem', { name: formato }).click()
  const dialogo = page.getByRole('dialog')
  await expect(dialogo).toBeVisible()
  // "Incluir telefone" existe e vem DESLIGADO (L-IN-6).
  await expect(dialogo.getByLabel('Incluir telefone')).not.toBeChecked()
  // Classe `saude`: sem finalidade, o botão não acende (L-IN-11).
  await expect(dialogo.getByRole('button', { name: 'Exportar' })).toBeDisabled()
  await dialogo.getByLabel('Recall de lote').check()
  await dialogo.getByRole('button', { name: 'Exportar' }).click()
}

test('exportacao-cabecalho-e-aviso nos três formatos', async ({ page, context }) => {
  await entrar(page)
  await gerarPacientesPorProcedimento(page)
  expect(await semRolagemDeLado(page)).toBe(true)

  // CSV
  const [csv] = await Promise.all([page.waitForEvent('download'), exportar(page, 'CSV')])
  expect(csv.suggestedFilename()).toMatch(/^fir-pacientes-sem-compra-\d{8}-[0-9a-f]{8}\.csv$/)
  const texto = await readFile((await csv.path())!, 'utf8')
  expect(texto.startsWith('﻿')).toBe(true)
  const codigoCsv = /Código da exportação;([0-9a-f]{8})/.exec(texto)?.[1]
  expect(csv.suggestedFilename()).toContain(codigoCsv ?? 'sem-codigo')
  expect(texto).toContain('Clínica;')
  expect(texto).toMatch(/Filtros;.*Procedimento: /)
  expect(texto).toContain('Finalidade;Recall de lote')
  expect(texto).toContain('Contém dados pessoais sensíveis de saúde (LGPD, art. 11). Uso restrito a: Recall de lote.')
  await expect(page.getByRole('status')).toContainText('registrada em Atividades')

  // XLSX
  const [xlsx] = await Promise.all([page.waitForEvent('download'), exportar(page, 'Excel')])
  expect(xlsx.suggestedFilename()).toMatch(/^fir-pacientes-sem-compra-\d{8}-[0-9a-f]{8}\.xlsx$/)
  const livro = XLSX.read(await readFile((await xlsx.path())!), { type: 'buffer', cellFormula: true })
  const folha = livro.Sheets[livro.SheetNames[0]!]!
  const linhas = XLSX.utils.sheet_to_json<string[]>(folha, { header: 1, defval: '' })
  const valor = (rotulo: string) => linhas.find((l) => l[0] === rotulo)?.[1]
  expect(valor('Código da exportação')).toMatch(/^[0-9a-f]{8}$/)
  expect(valor('Relatório')).toBe('Pacientes sem compra')
  expect(valor('Aviso')).toContain('dados pessoais sensíveis de saúde')
  for (const [ref, c] of Object.entries(folha)) {
    if (ref.startsWith('!')) continue
    expect((c as XLSX.CellObject).t, ref).toBe('s')
    expect((c as XLSX.CellObject).f, ref).toBeUndefined()
  }

  // PDF: a página de impressão, em outra aba, busca as próprias linhas.
  const [folhaDeImpressao] = await Promise.all([context.waitForEvent('page'), exportar(page, 'PDF')])
  await folhaDeImpressao.addInitScript(() => {
    window.print = () => undefined
  })
  await expect(folhaDeImpressao.locator('.rel-impressao-cabeca h1')).toHaveText('Pacientes sem compra')
  await expect(folhaDeImpressao.locator('.rel-impressao-aviso')).toContainText('Uso restrito a: Recall de lote')
  await expect(folhaDeImpressao.getByText(/^[0-9a-f]{8}$/).first()).toBeVisible()
  expect(folhaDeImpressao.url()).not.toContain('?')
  await folhaDeImpressao.close()
})

test('storage-sem-linhas', async ({ page }) => {
  await entrar(page)
  const nomes = await gerarPacientesPorProcedimento(page)
  expect(nomes.length).toBeGreaterThan(0)

  const guardado = await page.evaluate(async () => {
    const partes: string[] = []
    for (const s of [localStorage, sessionStorage]) {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i)
        if (k !== null) partes.push(`${k}=${s.getItem(k) ?? ''}`)
      }
    }
    const bancos = 'databases' in indexedDB ? await indexedDB.databases() : []
    return { texto: partes.join('\n'), bancos: bancos.map((b) => b.name ?? '') }
  })
  for (const nome of nomes) expect(guardado.texto).not.toContain(nome.trim())
  expect(guardado.texto).not.toMatch(/procedimentoId|semCompraHaMeses/)
  expect(guardado.bancos).toEqual([])
  expect(page.url()).not.toContain('?')
})

test('o favorito roda com um clique', async ({ page }) => {
  await entrar(page)
  const nome = `Recebimentos E2E ${Date.now()}`
  let id: string | null = null
  try {
    await page.goto('/indicadores/relatorios')
    await page.getByRole('button', { name: /^Recebimentos/ }).click()
    await page.getByRole('button', { name: 'Gerar' }).click()
    await expect(page.locator('.rel-resumo')).toBeVisible()
    await page.getByRole('button', { name: 'Salvar como favorito' }).click()
    await page.getByLabel('Nome do favorito').fill(nome)
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/v1/relatorios/favoritos') && r.request().method() === 'POST'),
      page.getByRole('dialog').getByRole('button', { name: 'Salvar' }).click(),
    ])
    id = ((await resposta.json()) as { id: string }).id

    // Volta do zero: a tela recarregada, sem relatório escolhido.
    await page.reload()
    const execucao = page.waitForResponse((r) => /\/api\/v1\/relatorios\/recebimentos\/execucoes$/.test(r.url()))
    await page.getByRole('button', { name: new RegExp(`^${nome}`) }).click()
    expect((await execucao).status()).toBe(200)
    await expect(page.locator('.rel-resumo')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recebimentos' })).toBeVisible()
    expect(await semRolagemDeLado(page)).toBe(true)
  } finally {
    if (id !== null) {
      await page.evaluate(
        (i) => fetch(`/api/v1/relatorios/favoritos/${i}/arquivar`, { method: 'POST', credentials: 'same-origin', body: '{}', headers: { 'content-type': 'application/json' } }),
        id,
      )
    }
  }
})
