/**
 * O LEITOR DE CÓDIGO DO ESTOQUE, com a câmera falsa EM BRANCO.
 *
 * A câmera liga de verdade (há faixa viva para contar), mas nunca lê: é o que
 * permite medir que Fechar, Esc e a aba oculta a SOLTAM — com a câmera lendo,
 * o leitor fecharia sozinho antes do gesto. A leitura ao vivo está em
 * `leitor-camera-ao-vivo.e2e.ts`.
 *
 * Em todos os testes, a vigia de `apoio/leitor.ts` bloqueia e reprova qualquer
 * requisição fora da origem (S-16, AB-A4-1).
 */
import type { Page } from '@playwright/test'
import { CAIXA, gerarMidia, OUTRA } from './apoio/midia'
import {
  api,
  apagarItensDeTeste,
  entrarNoEstoque,
  expect,
  faixasVivas,
  itensDoEstoque,
  test,
} from './apoio/leitor'

const midia = gerarMidia()
const PREFIXO = 'E2E-LEITOR '

test.use({
  permissions: ['camera'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${midia.cameraEmBranco}`,
    ],
  },
})

test.afterEach(async ({ page }) => {
  await apagarItensDeTeste(page, PREFIXO)
})

async function comecar(page: Page): Promise<void> {
  await entrarNoEstoque(page)
  await apagarItensDeTeste(page, PREFIXO)
}

async function criarItem(page: Page, nome: string, gtin = ''): Promise<string> {
  const r = await api<{ id: string }>(page, 'v1/estoque', {
    method: 'POST',
    body: gtin === '' ? { nome } : { nome, gtin },
  })
  expect(r.status).toBe(201)
  return r.corpo.id
}

/** Abre o leitor do topo e espera a câmera estar AO VIVO (faixa viva). */
async function abrirLeitorDoTopo(page: Page) {
  await page.getByRole('button', { name: 'Ler código' }).first().click()
  const leitor = page.getByRole('dialog', { name: 'Ler código do produto' })
  await leitor.waitFor()
  await expect.poll(() => faixasVivas(page), { message: 'a câmera não ligou' }).toBeGreaterThan(0)
  return leitor
}

/**
 * A aba fica oculta. O Chromium sem tela (headless) não muda
 * `document.visibilityState` ao trocar de aba — medido: com outra aba à
 * frente, a primeira continua `visible` e nenhum `visibilitychange` dispara.
 * Então o teste faz o que o navegador faria: `hidden` passa a `true` e o
 * evento dispara no `document`.
 */
const ocultarAba = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
const mostrarAba = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })

test.describe('a câmera é solta (S-17, AB-A4-2)', () => {
  test('Fechar solta a câmera', async ({ page }) => {
    await comecar(page)
    const leitor = await abrirLeitorDoTopo(page)
    await leitor.getByRole('button', { name: 'Fechar' }).click()
    await leitor.waitFor({ state: 'detached' })
    await expect.poll(() => faixasVivas(page)).toBe(0)
  })

  test('Esc solta a câmera', async ({ page }) => {
    await comecar(page)
    const leitor = await abrirLeitorDoTopo(page)
    await page.keyboard.press('Escape')
    await leitor.waitFor({ state: 'detached' })
    await expect.poll(() => faixasVivas(page)).toBe(0)
  })

  test('a aba oculta solta a câmera, e ela só religa por gesto da pessoa', async ({ page }) => {
    await comecar(page)
    const leitor = await abrirLeitorDoTopo(page)

    await ocultarAba(page)
    await expect.poll(() => faixasVivas(page), { message: 'câmera viva com a aba oculta' }).toBe(0)
    await expect(leitor.getByText('A câmera foi desligada quando esta aba saiu da tela')).toBeVisible()

    // Voltar à aba NÃO religa sozinho.
    await mostrarAba(page)
    await page.waitForTimeout(500)
    expect(await faixasVivas(page)).toBe(0)

    await leitor.getByRole('button', { name: 'Ligar a câmera' }).click()
    await expect.poll(() => faixasVivas(page)).toBeGreaterThan(0)
    await leitor.getByRole('button', { name: 'Fechar' }).click()
    await expect.poll(() => faixasVivas(page)).toBe(0)
  })
})

test('cadastro · "Ler da caixa" pela FOTO do DataMatrix GS1 preenche código, validade e lote', async ({
  page,
}) => {
  await comecar(page)
  const nome = `${PREFIXO}Tirzepatida`
  await page.getByRole('button', { name: 'Cadastrar item' }).click()
  await page.getByLabel('Nome do item').fill(nome)
  await page.getByRole('button', { name: 'Ler da caixa' }).click()
  const leitor = page.getByRole('dialog', { name: 'Ler o código da caixa' })
  await leitor.waitFor()
  await leitor.locator('input[type=file]').setInputFiles(midia.fotoDoDataMatrix)
  await leitor.waitFor({ state: 'detached', timeout: 15_000 })
  await expect.poll(() => faixasVivas(page)).toBe(0)

  await expect(page.getByLabel('Código de barras da caixa')).toHaveValue(CAIXA)
  // Dia 00 do GS1 = último dia do mês.
  await expect(page.getByRole('status').first()).toContainText('validade 06/2027 · lote LT2026A')
  await expect(page.getByLabel('Validade do que foi contado')).toHaveValue('2027-06-30')

  // Sem contagem inicial: o item sai do catálogo sem deixar movimento.
  await page.getByLabel('Validade do que foi contado').fill('')
  await page.getByRole('button', { name: 'Salvar item' }).click()
  await expect(page.getByText(`Item "${nome}" cadastrado.`)).toBeVisible()
  const gravado = (await itensDoEstoque(page)).find((i) => i.nome === nome)
  expect(gravado?.gtin).toBe(`0${CAIXA}`)
})

test('cadastro · o Enter do leitor USB preenche o código e NÃO envia o cadastro', async ({ page }) => {
  await comecar(page)
  let envios = 0
  page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/estoque') envios++
  })
  await page.getByRole('button', { name: 'Cadastrar item' }).click()
  await page.getByLabel('Nome do item').fill(`${PREFIXO}Seringa`)
  await page.getByRole('button', { name: 'Ler da caixa' }).click()
  const leitor = page.getByRole('dialog', { name: 'Ler o código da caixa' })
  const campo = leitor.getByLabel(/Ou digite o código/)
  await campo.fill('12345670')
  await campo.press('Enter')
  await leitor.waitFor({ state: 'detached' })
  await page.waitForTimeout(500)

  expect(envios, 'o Enter do leitor enviou o cadastro').toBe(0)
  await expect(page.getByLabel('Código de barras da caixa')).toHaveValue('0000012345670')
  await expect(page.getByRole('button', { name: 'Salvar item' })).toBeVisible()
  await expect.poll(() => faixasVivas(page)).toBe(0)
})

test('AB-A4-3 · etiqueta de OUTRA clínica: a frase própria, sem nome, e nenhuma requisição com o id', async ({
  page,
}) => {
  await comecar(page)
  // O catálogo precisa ter ao menos um item: é dele que a tela sabe a
  // clínica da sessão (o `codigoQr` que o servidor monta).
  await criarItem(page, `${PREFIXO}Da casa`)
  await page.reload()
  const idAlheio = '6f1c9a52-3d0e-4b8a-9c77-2e5d4b1a0f99'
  const comOId: string[] = []
  page.on('request', (r) => {
    if (r.url().includes(idAlheio)) comOId.push(r.url())
  })

  // Pelo leitor do topo.
  const leitor = await abrirLeitorDoTopo(page)
  await leitor.getByLabel(/Ou digite o código/).fill(`FRMEST:outra-clinica-e2e:${idAlheio}`)
  await leitor.getByRole('button', { name: 'Usar código' }).click()
  await leitor.waitFor({ state: 'detached' })
  await expect(page.getByText('Esta é uma etiqueta de outra clínica.')).toBeVisible()
  await expect(page.getByText(idAlheio)).toHaveCount(0)
  await expect.poll(() => faixasVivas(page)).toBe(0)

  // E pelo leitor ao lado do Item, na saída.
  await page.getByRole('button', { name: 'Fechar' }).click()
  await page.getByRole('button', { name: 'Registrar saída' }).first().click()
  await page.getByRole('button', { name: 'Ler código' }).nth(1).click()
  const daSaida = page.getByRole('dialog', { name: 'Ler código · saída' })
  await daSaida.getByLabel(/Ou digite o código/).fill(`FRMEST:outra-clinica-e2e:${idAlheio}`)
  await daSaida.getByRole('button', { name: 'Usar código' }).click()
  await daSaida.waitFor({ state: 'detached' })
  await expect(page.getByText('Esta é uma etiqueta de outra clínica.')).toBeVisible()

  await page.waitForTimeout(300)
  expect(comOId, 'requisição levando o id da etiqueta alheia').toEqual([])
})

test.describe('câmera negada pela pessoa', () => {
  test.use({ negarCamera: true })

  test('diz o que houve, e a FOTO do EAN acha o item; código desconhecido não vira item', async ({
    page,
  }) => {
    await comecar(page)
    const nome = `${PREFIXO}Tirzepatida`
    const outroNome = `${PREFIXO}Seringa`
    await criarItem(page, nome, CAIXA)
    const outroId = await criarItem(page, outroNome)
    await page.reload()

    await page.getByRole('button', { name: 'Ler código' }).first().click()
    const leitor = page.getByRole('dialog', { name: 'Ler código do produto' })
    await expect(leitor.getByText('A câmera não foi permitida')).toBeVisible()
    await expect(leitor.locator('video')).toHaveCount(0)
    await expect(leitor.getByRole('button', { name: 'Tirar foto do código' })).toBeVisible()
    await leitor.locator('input[type=file]').setInputFiles(midia.fotoDoEan)
    await leitor.waitFor({ state: 'detached', timeout: 15_000 })
    await expect(page.getByText(nome).first()).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar' }).click()

    // Código que nenhum item tem, digitado na entrada: pede para LIGAR,
    // nunca cria item.
    const antes = (await itensDoEstoque(page)).length
    await page.getByRole('button', { name: 'Registrar entrada' }).first().click()
    await page.getByRole('button', { name: 'Ler código' }).nth(1).click()
    const daEntrada = page.getByRole('dialog', { name: 'Ler código · entrada' })
    await daEntrada.getByLabel(/Ou digite o código/).fill(OUTRA)
    await daEntrada.getByRole('button', { name: 'Usar código' }).click()
    await daEntrada.waitFor({ state: 'detached' })
    await expect(page.getByText('ainda não está ligado a um item')).toBeVisible()
    expect((await itensDoEstoque(page)).length).toBe(antes)
    await page.locator('select[required]').first().selectOption({ label: outroNome })
    await page.getByRole('button', { name: 'Ligar código' }).click()
    await expect(page.getByText(`Código ligado a “${outroNome}”`)).toBeVisible()
    const ligado = (await itensDoEstoque(page)).find((i) => i.id === outroId)
    expect(ligado?.gtin).toBe(`0${OUTRA}`)
  })
})

test('D-E6 · a etiqueta QR impressa, fotografada, abre o item certo', async ({ page }) => {
  await comecar(page)
  const nome = `${PREFIXO}Pinça`
  await criarItem(page, nome)
  await page.reload()
  await page.getByRole('button', { name: new RegExp(nome) }).first().click()
  await page.getByRole('button', { name: 'Etiqueta QR' }).click()
  await page.getByRole('button', { name: /Imprimir etiqueta$/ }).waitFor()

  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.etiqueta')).toHaveCount(1)
  const qr = page.locator('.etiqueta svg.qr-da-etiqueta')
  await expect(qr).toHaveCount(1)
  const foto = await qr.screenshot()
  await page.emulateMedia({ media: 'screen' })
  await page.getByRole('button', { name: 'Fechar' }).click()

  const leitor = await abrirLeitorDoTopo(page)
  await leitor
    .locator('input[type=file]')
    .setInputFiles({ name: 'etiqueta.png', mimeType: 'image/png', buffer: foto })
  await leitor.waitFor({ state: 'detached', timeout: 15_000 })
  await expect(page.getByText('Código lido').first()).toBeVisible()
  await expect(page.getByText(nome).first()).toBeVisible()
  await expect.poll(() => faixasVivas(page)).toBe(0)
})
