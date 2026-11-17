/**
 * **Relatórios T9 — campanha a partir da lista e catálogo por permissão** (spec I-42, I-43).
 *
 *  - O relatório 6 aberto pelo LINK do detalhe do KPI (`?relatorio=&de=&ate=`)
 *    já vem gerado; "Criar campanha com esta lista" cria a campanha nova e
 *    mostra as contagens. A resposta da primeira tentativa é PERDIDA de
 *    propósito (o servidor fez o trabalho, a rede caiu): o segundo toque leva
 *    a MESMA `Idempotency-Key` e volta com `criadas = 0` — nada duplica.
 *  - Sem `valores`, o relatório 3 (maior LTV) não aparece no catálogo, e o
 *    link direto para ele diz que não está liberado.
 *
 * 390 px. Precisa da clínica `demo` semeada com pacientes cadastrados neste
 * ano. O que o teste cria (a campanha) é excluído no fim; o perfil Comercial
 * ganha `indicadores` só durante o segundo teste e volta como estava.
 */
import { expect, type Page, test } from '@playwright/test'

const CLINICA = process.env['FIR_E2E_CLINICA'] || 'demo'
const SENHA = process.env['FIR_E2E_SENHA'] || 'quatro-pedras-no-caminho'

async function entrar(page: Page, usuario: string): Promise<void> {
  await page.goto('/entrar')
  const clinica = page.getByLabel('Clínica', { exact: true })
  if (await clinica.isVisible().catch(() => false)) await clinica.fill(CLINICA)
  await page.getByLabel('Usuário').fill(usuario)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'))
}

async function api<T>(page: Page, metodo: string, caminho: string, corpo?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ([m, c, b]) => {
      const r = await fetch(`/api/${c}`, {
        method: m,
        credentials: 'include',
        ...(b === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }),
      })
      return { status: r.status, json: (await r.json().catch(() => null)) as T }
    },
    [metodo, caminho, corpo] as const,
  )
}

const semRolagemDeLado = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

test('campanha da lista: contagens, e repetir com a mesma chave dá criadas = 0', async ({ page }) => {
  await entrar(page, 'helena')
  const ano = new Date().toISOString().slice(0, 4)
  const hoje = new Date().toISOString().slice(0, 10)
  await page.goto(`/indicadores/relatorios?relatorio=pacientes-por-origem-e-campanha&de=${ano}-01-01&ate=${hoje}`)

  // O link abre o relatório com o período e gera na hora; a consulta sai da URL.
  await expect(page.getByRole('heading', { name: 'Pacientes por origem e campanha' })).toBeVisible()
  await expect(page.getByLabel('De', { exact: true })).toHaveValue(`${ano}-01-01`)
  await expect(page.locator('.rel-resumo-linha').first()).toContainText('paciente')
  expect(new URL(page.url()).search).toBe('')

  await page.getByRole('button', { name: 'Criar campanha com esta lista' }).click()
  const caixa = page.getByRole('dialog', { name: 'Criar campanha com esta lista' })
  await expect(caixa).toBeVisible()

  // A campanha nova pelo formulário da tela Campanhas.
  const nome = `E2E lista ${Date.now()}`
  await caixa.getByLabel('Campanha').selectOption('__nova__')
  const nova = page.getByRole('dialog', { name: 'Nova campanha' })
  await nova.getByLabel('Nome').fill(nome)
  await nova.getByLabel('Termina em').fill(hoje)
  await nova.getByLabel(/^Meta/).fill('10')
  await nova.getByRole('button', { name: 'Criar campanha' }).click()

  await expect(caixa.getByLabel('Campanha')).toHaveValue('__nova__')
  await caixa.getByLabel('Responsável').selectOption({ index: 1 })
  expect(await semRolagemDeLado(page)).toBe(true)

  // 1ª tentativa: o servidor cria, a resposta se perde.
  const chaves: string[] = []
  let primeira: { campanhaId: string; criadas: number } | null = null
  await page.route(/\/api\/v1\/relatorios\/[^/]+\/campanha$/, async (rota) => {
    const pedido = rota.request()
    chaves.push(pedido.headers()['idempotency-key'] ?? '')
    const corpo = pedido.postDataJSON() as Record<string, unknown>
    expect(Object.keys(corpo).sort()).toEqual(['destino', 'filtros', 'tarefa'])
    if (primeira === null) {
      const r = await rota.fetch()
      primeira = (await r.json()) as { campanhaId: string; criadas: number }
      return rota.abort('connectionreset')
    }
    return rota.continue()
  })

  try {
    await caixa.getByRole('button', { name: 'Criar as tarefas' }).click()
    await expect(caixa.getByRole('alert')).toContainText('nada se repete')
    expect(primeira).not.toBeNull()
    expect(primeira!.criadas).toBeGreaterThan(0)

    // 2º toque: a mesma chave, a mesma campanha, nenhuma tarefa nova.
    await caixa.getByRole('button', { name: 'Criar as tarefas' }).click()
    const pronta = page.getByRole('dialog', { name: 'Campanha pronta' })
    await expect(pronta).toContainText(`0 tarefas criadas em "${nome}"`)
    await expect(pronta).toContainText(`${primeira!.criadas} ${primeira!.criadas === 1 ? 'paciente já tinha' : 'pacientes já tinham'}`)
    expect(chaves).toHaveLength(2)
    expect(chaves[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(chaves[1]).toBe(chaves[0])
  } finally {
    await page.unroute(/\/api\/v1\/relatorios\/[^/]+\/campanha$/)
    if (primeira !== null) await api(page, 'DELETE', `v1/campanhas/${(primeira as { campanhaId: string }).campanhaId}`)
  }
})

test('sem valores, o relatório de maior LTV some do catálogo e o link não o abre', async ({ page, browser }) => {
  await entrar(page, 'helena')
  type Perfis = { perfis: { id: string; nome: string; perms: string[]; chave?: string }[] }
  const antes = await api<Perfis>(page, 'GET', 'v1/pessoas/perfis')
  expect(antes.status).toBe(200)
  const comercial = antes.json.perfis.find((p) => p.nome === 'Comercial')
  expect(comercial).toBeDefined()
  expect(comercial!.perms).not.toContain('valores')
  const salvar = (perfis: Perfis['perfis'], extra: string[]) =>
    api(page, 'PUT', 'v1/pessoas/perfis', {
      perfis: perfis.map((p) => ({ id: p.id, nome: p.nome, perms: p.id === comercial!.id ? [...p.perms, ...extra] : p.perms })),
    })

  expect((await salvar(antes.json.perfis, ['indicadores'])).status).toBe(200)
  const outra = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const p = await outra.newPage()
    await entrar(p, 'patricia')
    await p.goto('/indicadores/relatorios')
    await expect(p.getByRole('button', { name: /^Pacientes sem atendimento/ })).toBeVisible()
    await expect(p.getByRole('button', { name: /^Pacientes com maior LTV/ })).toHaveCount(0)
    expect(await semRolagemDeLado(p)).toBe(true)

    await p.goto('/indicadores/relatorios?relatorio=pacientes-maior-ltv')
    await expect(p.getByText('Este relatório não está liberado para o seu acesso.')).toBeVisible()
    await expect(p.getByRole('heading', { name: /maior LTV/ })).toHaveCount(0)
  } finally {
    await outra.close()
    await salvar(antes.json.perfis, [])
  }
})
