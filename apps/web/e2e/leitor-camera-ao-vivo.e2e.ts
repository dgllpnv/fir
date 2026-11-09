/**
 * O LEITOR DE CÓDIGO PELA CÂMERA AO VIVO — a câmera falsa do Chromium mostra o
 * EAN-13 da caixa, e a leitura acontece sozinha, como no balcão.
 *
 * Arquivo próprio porque o vídeo da câmera é do NAVEGADOR inteiro
 * (`--use-file-for-fake-video-capture`): aqui ela lê; em
 * `leitor-de-codigo.e2e.ts` ela fica em branco, para que Fechar, Esc e a aba
 * oculta sejam medidos sem a leitura chegar antes.
 */
import { gerarMidia, CAIXA } from './apoio/midia'
import {
  aberturasDaCamera,
  api,
  apagarItensDeTeste,
  entrarNoEstoque,
  expect,
  faixasVivas,
  test,
} from './apoio/leitor'

const midia = gerarMidia()
const PREFIXO = 'E2E-AO-VIVO '

test.use({
  permissions: ['camera'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${midia.cameraComEan}`,
    ],
  },
})

test.afterEach(async ({ page }) => {
  await apagarItensDeTeste(page, PREFIXO)
})

test('AB-A4-1 · sem rede externa, a câmera ao vivo lê o EAN, acha o item e solta a câmera', async ({
  page,
}) => {
  await entrarNoEstoque(page)
  await apagarItensDeTeste(page, PREFIXO)
  const nome = `${PREFIXO}Tirzepatida`
  const r = await api(page, 'v1/estoque', { method: 'POST', body: { nome, gtin: CAIXA } })
  expect(r.status).toBe(201)
  await page.reload()

  // A câmera só abre por ação da pessoa (S-17): ao entrar na tela, nada.
  expect(await aberturasDaCamera(page)).toBe(0)

  await page.getByRole('button', { name: 'Ler código' }).first().click()
  const leitor = page.getByRole('dialog', { name: 'Ler código do produto' })
  await leitor.waitFor()
  // A leitura fecha o leitor sozinha — com toda a rede externa bloqueada pela
  // vigia: o decodificador veio da própria origem.
  await leitor.waitFor({ state: 'detached', timeout: 20_000 })

  expect(await aberturasDaCamera(page)).toBeGreaterThan(0)
  expect(await faixasVivas(page), 'faixa de câmera viva depois de ler (AB-A4-2)').toBe(0)
  await expect(page.getByText('Código lido').first()).toBeVisible()
  await expect(page.getByText(nome).first()).toBeVisible()
})
