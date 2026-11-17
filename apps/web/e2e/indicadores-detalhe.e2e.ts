/**
 * **Indicadores & Insights — o detalhe do KPI (T6, backlog 1.9 E).**
 *
 * Os critérios de aceite da 1.10 que este ticket fecha:
 * - os três botões (3 meses, Período da meta, 12 meses) trocam o gráfico;
 * - "Personalizado" de junho a novembro dá 6 barras, uma por mês;
 * - de 01/11 a hoje dá o faturamento dia a dia;
 * - KPI sem meta, em "Período da meta", mostra o aviso.
 *
 * E as condições de gate desenhadas na tela:
 * - dia aguardando fechamento, em qualquer KPI em reais, é barra clara sem
 *   valor (números c.10);
 * - em `perda_de_estoque`, "as barras não somam o total" (números B4);
 * - sem a permissão da composição, "Sem acesso ao detalhe" (LGPD L-IN-3);
 * - sem `valores`, nenhum "R$" na tela.
 *
 * 390 px (o padrão da configuração), sem rolagem de lado. O "+ Plano de ação"
 * vai contra o contrato `kpiId` em `POST /v1/tarefas`. Rodar como diz
 * `playwright.config.ts`.
 */
import { expect, type Page, test } from '@playwright/test'

const CLINICA = process.env['FIR_E2E_CLINICA'] || 'demo'
const USUARIO = process.env['FIR_E2E_USUARIO'] || 'helena'
const SENHA = process.env['FIR_E2E_SENHA'] || 'quatro-pedras-no-caminho'

async function entrar(page: Page): Promise<void> {
  // A clínica vai no link, e o teste espera ela RECOLHER: isso só acontece no
  // efeito de montagem, depois da hidratação. Perguntar antes ("o campo
  // Clínica está visível?") lia o HTML do servidor; no `next dev` a hidratação
  // demora, o campo sumia no meio do `fill` e o que já fora digitado era
  // apagado — "juliana não sai de /entrar" sem nenhuma tentativa falha.
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

type Kpi = { id: string; chave: string | null; nome: string; metaVigente: unknown; frequencia: string }

/** O KPI de catálogo da chave, criado se a clínica ainda não o acompanha. */
async function kpiDaChave(page: Page, chave: string): Promise<{ id: string; criado: boolean }> {
  const lista = (await api(page, 'v1/indicadores')).corpo as { itens: Kpi[] }
  const existente = lista.itens.find((k) => k.chave === chave)
  if (existente !== undefined) return { id: existente.id, criado: false }
  const r = await api(page, 'v1/indicadores/kpis', { method: 'POST', body: { origem: 'catalogo', chave, frequencia: 'mensal' } })
  expect(r.status, JSON.stringify(r.corpo)).toBeLessThan(300)
  return { id: (r.corpo as { id: string }).id, criado: true }
}

/** Os pontos do gráfico de barras: um por mês, semana ou dia (o mês "sem dado" conta e fica vazio). */
const barras = (page: Page) => page.locator('.kd-rotulos > span')

async function personalizado(page: Page, de: string, ate: string): Promise<void> {
  await page.getByRole('button', { name: 'Personalizado', exact: true }).click()
  await page.getByLabel('De', { exact: true }).fill(de)
  await page.getByLabel('Até', { exact: true }).fill(ate)
  await page.getByRole('button', { name: 'Aplicar' }).click()
}

test('os três botões, junho–novembro em 6 barras e 01/11–hoje dia a dia', async ({ page }) => {
  await entrar(page)
  const { id, criado } = await kpiDaChave(page, 'faturamento_conferido')
  try {
    const hoje = ((await api(page, 'v1/indicadores')).corpo as { hoje: string }).hoje
    await page.goto(`/indicadores/${id}`)
    await expect(page.getByRole('heading', { name: 'Faturamento conferido' })).toBeVisible()
    await expect(page.getByRole('link', { name: '← Indicadores & Insights' })).toBeVisible()
    for (const n of ['Valor atual', 'Meta e prazo', 'Onde deveria estar hoje', 'Projeção no prazo']) {
      await expect(page.getByText(n, { exact: true })).toBeVisible()
    }
    // Abre em "Período da meta".
    await expect(page.getByRole('button', { name: 'Período da meta' })).toHaveAttribute('aria-pressed', 'true')
    expect(await semRolagemDeLado(page)).toBe(true)

    // 3 meses → 3 barras, mês a mês, o corrente "parcial".
    await page.getByRole('button', { name: '3 meses' }).click()
    await expect(page.locator('.kd-etiqueta')).toHaveText('Mês a mês')
    await expect(barras(page)).toHaveCount(3)
    await expect(page.locator('.kd-svg rect[data-tipo="parcial"]')).toHaveCount(1)

    // 12 meses → 12 barras.
    await page.getByRole('button', { name: '12 meses' }).click()
    await expect(barras(page)).toHaveCount(12)

    // Período da meta → as quatro linhas (com meta) ou o aviso (sem).
    await page.getByRole('button', { name: 'Período da meta' }).click()
    const temMeta = (((await api(page, `v1/indicadores/kpis/${id}`)).corpo as Kpi).metaVigente ?? null) !== null
    if (temMeta) {
      await expect(page.locator('.kd-svg .kd-linha-alvo')).toHaveCount(1)
      await expect(page.locator('.kd-svg .kd-linha-ritmo')).toHaveCount(1)
    } else {
      await expect(page.getByText('Este indicador ainda não tem meta', { exact: false })).toBeVisible()
    }

    // Personalizado: junho a novembro → 6 barras, uma por mês.
    await personalizado(page, `${hoje.slice(0, 4)}-06-01`, hoje)
    await expect(page.locator('.kd-etiqueta')).toHaveText('Mês a mês')
    await expect(barras(page)).toHaveCount(6)

    // 01/11 a hoje → dia a dia, uma barra por dia, com a linha do ritmo diário da meta.
    await personalizado(page, `${hoje.slice(0, 7)}-01`, hoje)
    await expect(page.locator('.kd-etiqueta')).toHaveText('Dia a dia')
    await expect(barras(page)).toHaveCount(Number(hoje.slice(8, 10)))
    if (temMeta) {
      await expect(page.locator('.kd-svg .kd-linha-ritmo-diario')).toHaveCount(1)
      await expect(page.locator('.kd-legenda')).toContainText('Ritmo diário da meta')
    }

    // "De onde vem o número": os grupos da composição e o relatório filtrado —
    // ou, com o faturamento medido pelo MedX (a semente), o aviso no lugar.
    type Composicao = { disponivel: boolean; motivoIndisponivel: string | null; blocos: { por: string }[]; relatorio: unknown }
    const comp = (await api(page, `v1/indicadores/kpis/${id}/composicao`)).corpo as Composicao
    if (comp.disponivel && comp.blocos.some((x) => x.por === 'forma')) {
      await expect(page.getByRole('region', { name: 'Por forma de pagamento' })).toBeVisible()
    } else if (comp.motivoIndisponivel === 'medido_pelo_medx') {
      await expect(page.getByText('medido pelo MedX', { exact: false })).toBeVisible()
    }
    if (comp.relatorio !== null) {
      await expect(page.getByRole('link', { name: 'Ver recebimentos' })).toHaveAttribute(
        'href',
        /\/indicadores\/relatorios\?relatorio=recebimentos&de=\d{4}-\d{2}-\d{2}&ate=/,
      )
    }

    // Data inicial depois da final: o erro em vermelho, embaixo.
    await page.getByLabel('De', { exact: true }).fill(hoje)
    await page.getByLabel('Até', { exact: true }).fill(`${hoje.slice(0, 7)}-01`)
    await page.getByRole('button', { name: 'Aplicar' }).click()
    await expect(page.locator('.kd-erro')).toHaveText('A data inicial está depois da final.')
    expect(await semRolagemDeLado(page)).toBe(true)
  } finally {
    if (criado) await api(page, `v1/indicadores/kpis/${id}/arquivar`, { method: 'POST', body: {} })
  }
})

test('dia aguardando em qualquer KPI em reais: barra clara, sem valor', async ({ page }) => {
  await entrar(page)
  const { id, criado } = await kpiDaChave(page, 'ticket_medio')
  try {
    const hoje = ((await api(page, 'v1/indicadores')).corpo as { hoje: string }).hoje
    // O dia de hoje ainda sem caixa fechado chega assim do servidor (I-29, c.10).
    await page.route(/\/api\/v1\/indicadores\/kpis\/[^/]+\/serie/, async (route) => {
      const r = await route.fetch()
      const j = (await r.json()) as { agrupamento: string; pontos: { inicio: string; diaAguardando: boolean }[] }
      if (j.agrupamento === 'dia' && !j.pontos.some((p) => p.diaAguardando)) {
        const ultimo = j.pontos.at(-1)
        if (ultimo !== undefined) {
          ultimo.diaAguardando = true
          Reflect.set(ultimo, 'numero', { unidade: 'reais', emDinheiro: null, emNumero: null, percentualDaMeta: null, escala: null })
        }
      }
      return route.fulfill({ response: r, json: j })
    })
    await page.goto(`/indicadores/${id}`)
    await personalizado(page, `${hoje.slice(0, 7)}-01`, hoje)
    await expect(page.locator('.kd-etiqueta')).toHaveText('Dia a dia')
    const aguardando = page.locator('.kd-svg rect[data-tipo="aguardando"]')
    await expect(aguardando.first()).toBeVisible()
    await expect(page.locator('.kd-legenda')).toContainText('Aguardando fechamento do caixa')
    // Tocar a barra lê a data, e nenhum valor.
    const area = page.locator('.kd-area[role="group"]')
    const caixa = await area.boundingBox()
    await area.click({ position: { x: (caixa?.width ?? 2) - 2, y: (caixa?.height ?? 2) / 2 } })
    await expect(page.locator('.kd-leitura')).toContainText('aguardando fechamento do caixa')
    await expect(page.locator('.kd-leitura')).not.toContainText('R$')
  } finally {
    if (criado) await api(page, `v1/indicadores/kpis/${id}/arquivar`, { method: 'POST', body: {} })
  }
})

test('perda de estoque avisa que as barras não somam o total', async ({ page }) => {
  await entrar(page)
  const { id, criado } = await kpiDaChave(page, 'perda_de_estoque')
  try {
    await page.goto(`/indicadores/${id}`)
    await page.getByRole('button', { name: '3 meses' }).click()
    await expect(page.getByText('As barras não somam o total do período.')).toBeVisible()
  } finally {
    if (criado) await api(page, `v1/indicadores/kpis/${id}/arquivar`, { method: 'POST', body: {} })
  }
})

test('composição por grupo: novos pacientes por origem, com o relatório filtrado', async ({ page }) => {
  await entrar(page)
  const { id, criado } = await kpiDaChave(page, 'novos_pacientes')
  try {
    await page.goto(`/indicadores/${id}`)
    const bloco = page.getByRole('region', { name: 'Por origem' })
    await expect(bloco).toBeVisible()
    await expect(bloco.locator('.kd-grupos li').first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ver no relatório' })).toHaveAttribute(
      'href',
      /\/indicadores\/relatorios\?relatorio=pacientes-por-origem-e-campanha&de=\d{4}-\d{2}-\d{2}&ate=\d{4}-\d{2}-\d{2}$/,
    )
    expect(await semRolagemDeLado(page)).toBe(true)
  } finally {
    if (criado) await api(page, `v1/indicadores/kpis/${id}/arquivar`, { method: 'POST', body: {} })
  }
})

test('KPI sem meta: "Período da meta" mostra os 3 meses com o aviso', async ({ page }) => {
  await entrar(page)
  const nome = `Sem meta E2E ${Date.now()}`
  const r = await api(page, 'v1/indicadores/kpis', {
    method: 'POST',
    body: { origem: 'manual', nome, pilar: 'Processos', unidade: 'quantidade', direcao: 'maior', frequencia: 'mensal', diaDeLancamento: 5 },
  })
  const id = (r.corpo as { id: string }).id
  try {
    await page.goto(`/indicadores/${id}`)
    await expect(page.getByRole('heading', { name: nome })).toBeVisible()
    await expect(page.getByText('Este indicador ainda não tem meta', { exact: false })).toBeVisible()
    await expect(page.locator('.kd-etiqueta')).toHaveText('Mês a mês')
    // KPI manual: "Lançar valor" no topo e a tabela de lançamentos embaixo.
    await expect(page.getByRole('button', { name: 'Lançar valor' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'De onde vem o número' })).toBeVisible()
    await expect(page.getByText('Nenhum lançamento ainda.')).toBeVisible()
    const hoje = ((await api(page, 'v1/indicadores')).corpo as { hoje: string }).hoje
    const lancou = await api(page, `v1/indicadores/kpis/${id}/lancamentos/${hoje.slice(0, 7)}-01`, {
      method: 'PUT',
      body: { valor: '1200', comentario: 'conferido no fechamento' },
    })
    expect(lancou.status, JSON.stringify(lancou.corpo)).toBeLessThan(300)
    await page.reload()
    const tabela = page.locator('.kd-tabela')
    await expect(tabela).toContainText('12')
    await expect(tabela).toContainText(`01/${hoje.slice(5, 7)}/${hoje.slice(0, 4)}`)
    expect(await semRolagemDeLado(page)).toBe(true)
  } finally {
    await api(page, `v1/indicadores/kpis/${id}/arquivar`, { method: 'POST', body: {} })
  }
})

test('+ Plano de ação manda o kpiId e a tarefa aparece na lista do KPI', async ({ page }) => {
  await entrar(page)
  const { id, criado } = await kpiDaChave(page, 'faturamento_conferido')
  const descricao = `Plano E2E ${Date.now()}`
  let corpo: Record<string, unknown> | null = null
  let tarefaId: string | null = null
  page.on('request', (req) => {
    if (req.method() === 'POST' && /\/api\/v1\/tarefas$/.test(req.url())) corpo = req.postDataJSON() as Record<string, unknown>
  })
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' && /\/api\/v1\/tarefas$/.test(res.url()) && res.ok()) {
      tarefaId = ((await res.json()) as { tarefa: { id: string } }).tarefa.id
    }
  })
  try {
    await page.goto(`/indicadores/${id}`)
    await page.getByRole('button', { name: '+ Plano de ação' }).click()
    await page.getByLabel('Descrição').fill(descricao)
    await page.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('status')).toContainText('Plano de ação criado.')
    expect(corpo).toMatchObject({ vinculo: 'interna', kpiId: id, descricao, quando: { modo: 'agendada' } })
    await expect(page.locator('.kd-planos')).toContainText(descricao)
    const lista = await api(page, `v1/tarefas?kpiId=${id}&situacao=todas&escopo=equipe`)
    expect((lista.corpo as { tarefas: { descricao: string }[] }).tarefas.some((t) => t.descricao === descricao)).toBe(true)
  } finally {
    if (tarefaId !== null) await api(page, `v1/tarefas/${tarefaId}/cancelar`, { method: 'POST', body: {} })
    if (criado) await api(page, `v1/indicadores/kpis/${id}/arquivar`, { method: 'POST', body: {} })
  }
})

test('sem `valores` nem a permissão da composição: sem R$ e "Sem acesso ao detalhe"', async ({ page, browser }) => {
  // Enfermagem (camila) não tem `valores`, `finmes` nem `jornada`. O teste dá
  // a ela só `indicadores`, pela matriz de perfis, e devolve a matriz no fim.
  await entrar(page)
  const comparecimento = await kpiDaChave(page, 'comparecimento')
  const fat = await kpiDaChave(page, 'faturamento_conferido')
  type Perfil = { id: string; nome: string; perms: string[]; chave?: string }
  const antes = ((await api(page, 'v1/pessoas/perfis')).corpo as { perfis: Perfil[] }).perfis
  const matriz = (perfis: Perfil[]) => ({ perfis: perfis.map((p) => ({ id: p.id, nome: p.nome, perms: p.perms })) })
  const enf = antes.find((p) => p.chave === 'pf_enf' || p.nome === 'Enfermagem')
  expect(enf, 'o perfil de Enfermagem da semente').toBeDefined()
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const r = await api(page, 'v1/pessoas/perfis', {
      method: 'PUT',
      body: matriz(antes.map((p) => (p.id === enf?.id ? { ...p, perms: [...p.perms, 'indicadores'] } : p))),
    })
    expect(r.status, JSON.stringify(r.corpo)).toBeLessThan(300)

    const outra = await ctx.newPage()
    await outra.goto('/entrar')
    const clinica = outra.getByLabel('Clínica', { exact: true })
    if (await clinica.isVisible().catch(() => false)) await clinica.fill(CLINICA)
    await outra.getByLabel('Usuário').fill('camila')
    await outra.getByLabel('Senha', { exact: true }).fill(SENHA)
    await outra.getByRole('button', { name: 'Entrar' }).click()
    await outra.waitForURL((u) => !u.pathname.startsWith('/entrar'))

    await outra.goto(`/indicadores/${fat.id}`)
    await expect(outra.getByRole('heading', { name: 'Faturamento conferido' })).toBeVisible()
    for (const b of ['Período da meta', '3 meses', '12 meses']) {
      await outra.getByRole('button', { name: b, exact: true }).click()
      await outra.waitForLoadState('networkidle')
      expect(await outra.locator('section.kd').innerText()).not.toMatch(/R\$/)
    }
    await expect(outra.getByText('Sem acesso ao detalhe')).toBeVisible()

    await outra.goto(`/indicadores/${comparecimento.id}`)
    await expect(outra.getByRole('heading', { name: 'Comparecimento' })).toBeVisible()
    await expect(outra.getByText('Sem acesso ao detalhe')).toBeVisible()
    expect(await semRolagemDeLado(outra)).toBe(true)
  } finally {
    await ctx.close()
    await api(page, 'v1/pessoas/perfis', { method: 'PUT', body: matriz(antes) })
    if (comparecimento.criado) await api(page, `v1/indicadores/kpis/${comparecimento.id}/arquivar`, { method: 'POST', body: {} })
    if (fat.criado) await api(page, `v1/indicadores/kpis/${fat.id}/arquivar`, { method: 'POST', body: {} })
  }
})
