/**
 * **L-A3-11 · Uma leitura por escolha**, no navegador (gate LGPD, teste 4).
 *
 * `GET /v1/pacientes/:id/campanha-sugerida` grava uma linha de acesso com o id
 * da paciente. Escolher a paciente UMA vez na Nova tarefa faz UMA chamada —
 * digitar o nome letra por letra, os re-renders da busca e trocar de modo não
 * fazem nenhuma. O teste conta as requisições que a página faz.
 *
 * A paciente é criada aqui e desativada no fim (a clínica de demonstração não
 * tem paciente semeada). Rodar como diz `playwright.config.ts`.
 */
import { expect, type Page, test } from '@playwright/test'

const CLINICA = process.env['FIR_E2E_CLINICA'] || 'demo'
const USUARIO = process.env['FIR_E2E_USUARIO'] || 'helena'
const SENHA = process.env['FIR_E2E_SENHA'] || 'quatro-pedras-no-caminho'
const NOME = `Paciente E2E Sugestao ${Date.now()}`

async function entrar(page: Page): Promise<void> {
  await page.goto('/entrar')
  const clinica = page.getByLabel('Clínica', { exact: true })
  if (await clinica.isVisible().catch(() => false)) await clinica.fill(CLINICA)
  await page.getByLabel('Usuário').fill(USUARIO)
  await page.getByLabel('Senha', { exact: true }).fill(SENHA)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/entrar'))
}

/** A API como o navegador a chama: mesma origem, cookie da sessão. */
const api = (page: Page, caminho: string, init: { method?: string; body?: unknown } = {}) =>
  page.evaluate(
    async ({ caminho, init }) => {
      const r = await fetch(`/api/${caminho}`, {
        method: init.method ?? 'GET',
        credentials: 'same-origin',
        // `content-type` só com corpo: o Fastify recusa o DELETE vazio que o declara.
        ...(init.body === undefined
          ? {}
          : { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } }),
      })
      return { status: r.status, corpo: (await r.json().catch(() => null)) as unknown }
    },
    { caminho, init },
  )

test('escolher a paciente uma vez na Nova tarefa faz UMA chamada à sugestão', async ({ page }) => {
  await entrar(page)
  const criada = await api(page, 'v1/pacientes', {
    method: 'POST',
    body: { nome: NOME, telefone: '' },
  })
  expect(criada.status, JSON.stringify(criada.corpo)).toBe(201)
  const id = (criada.corpo as { id: string }).id

  const chamadas: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/campanha-sugerida')) chamadas.push(r.url())
  })

  try {
    await page.goto('/nova')
    await page.getByRole('button', { name: 'Vinculada a paciente' }).click()
    const busca = page.getByRole('searchbox', { name: 'Paciente' })
    // Letra por letra: cada tecla re-renderiza e dispara a busca, nunca a sugestão.
    await busca.pressSequentially(NOME, { delay: 15 })
    const opcao = page.getByRole('button', { name: NOME, exact: true })
    await opcao.waitFor()
    expect(chamadas, 'nenhuma leitura da sugestão enquanto digita').toEqual([])

    await opcao.click()
    await expect.poll(() => chamadas.length).toBe(1)
    expect(chamadas[0]).toContain(`/v1/pacientes/${id}/campanha-sugerida`)

    // Trocar de modo e voltar, e mexer em outros campos: re-render, nenhuma leitura nova.
    await page.getByRole('button', { name: 'Tarefa interna' }).click()
    await page.getByRole('button', { name: 'Vinculada a paciente' }).click()
    await page.getByLabel('Horário').fill('10:30')
    await page.waitForTimeout(800)
    expect(chamadas).toHaveLength(1)
  } finally {
    await api(page, `v1/pacientes/${id}`, { method: 'DELETE' })
  }
})
