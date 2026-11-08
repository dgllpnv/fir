import { RelogioFixo } from '@fir/domain'
import { generateKeyPairSync, verify } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ESCOPO_SOMENTE_LEITURA, LeitorGoogleSheets, URL_DO_TOKEN, contaDeServicoDoAmbiente } from './leitor-google-sheets'

/**
 * O adaptador do Google, com o `fetch` trocado por um falso. Prova o que a
 * fixture do seam não pode provar: o JWT da conta de serviço, os hosts
 * tocados, a conversão de célula, e que a CHAVE nunca sai — nem em erro, nem
 * em log, nem quando o Google devolve um corpo que ecoa o pedido.
 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const EMAIL = 'fir-planilhas@projeto-teste.iam.gserviceaccount.com'
const JSON_DA_CONTA = JSON.stringify({ type: 'service_account', client_email: EMAIL, private_key: PEM, token_uri: 'https://evil.example/token' })
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'
const AGORA = new Date('2026-11-11T18:00:00Z')

type Chamada = { url: string; init: RequestInit }
const resposta = (status: number, corpo: unknown): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

function falso(roteiro: (url: string, init: RequestInit) => Response) {
  const chamadas: Chamada[] = []
  const busca = async (url: string, init: RequestInit): Promise<Response> => {
    chamadas.push({ url, init })
    return roteiro(url, init)
  }
  return { chamadas, busca }
}

const corpoDoToken = (init: RequestInit): URLSearchParams => new URLSearchParams(String(init.body))

afterEach(() => vi.restoreAllMocks())

describe('LeitorGoogleSheets', () => {
  it('assina o JWT RS256 com escopo só leitura e fala SÓ com oauth2/sheets.googleapis.com', async () => {
    const { chamadas, busca } = falso((url) => {
      if (url === URL_DO_TOKEN) return resposta(200, { access_token: 'tok-1', expires_in: 3600 })
      if (url.includes('values:batchGet')) {
        return resposta(200, {
          valueRanges: [{ values: [['Carimbo de data/hora', 'Faturamento da semana (R$)'], [46335.5, 42000.5], [46342.5, 1e21]] }],
        })
      }
      return resposta(200, { properties: { timeZone: 'America/Sao_Paulo' }, sheets: [{ properties: { title: 'Financeiro' } }] })
    })
    const leitor = new LeitorGoogleSheets(contaDeServicoDoAmbiente(JSON_DA_CONTA), new RelogioFixo(AGORA), busca)

    const estrutura = await leitor.lerEstrutura(ID)
    expect(estrutura).toEqual({ tipo: 'ok', valor: { fuso: 'America/Sao_Paulo', abas: ['Financeiro'] } })
    const abas = await leitor.lerAbas(ID, ['Financeiro'])
    expect(abas).toEqual({
      tipo: 'ok',
      valor: [
        {
          titulo: 'Financeiro',
          linhas: [
            ['Carimbo de data/hora', 'Faturamento da semana (R$)'],
            [{ numeroDecimal: '46335.5' }, { numeroDecimal: '42000.5' }],
            [{ numeroDecimal: '46342.5' }, '1e+21'],
          ],
        },
      ],
    })

    // Um token só para as duas leituras (cache).
    const tokens = chamadas.filter((c) => c.url === URL_DO_TOKEN)
    expect(tokens).toHaveLength(1)
    // O `token_uri` do JSON é IGNORADO: a URL do token é fixa.
    expect(chamadas.every((c) => ['oauth2.googleapis.com', 'sheets.googleapis.com'].includes(new URL(c.url).hostname))).toBe(true)
    expect(chamadas.every((c) => c.init.redirect === 'error')).toBe(true)

    const assertion = corpoDoToken(tokens[0]!.init).get('assertion')!
    const [h, d, s] = assertion.split('.')
    expect(verify('RSA-SHA256', Buffer.from(`${h}.${d}`), publicKey, Buffer.from(s!, 'base64url'))).toBe(true)
    expect(JSON.parse(Buffer.from(d!, 'base64url').toString())).toEqual({
      iss: EMAIL,
      scope: ESCOPO_SOMENTE_LEITURA,
      aud: URL_DO_TOKEN,
      iat: AGORA.getTime() / 1000,
      exp: AGORA.getTime() / 1000 + 3600,
    })
    const leitura = chamadas.find((c) => c.url.includes('values:batchGet'))!
    expect(decodeURIComponent(leitura.url)).toContain("ranges='Financeiro'!A1:AZ5000")
    expect(leitura.url).toContain('valueRenderOption=UNFORMATTED_VALUE')
    expect((leitura.init.headers as Record<string, string>)['authorization']).toBe('Bearer tok-1')
  })

  it('a chave NUNCA sai: nem no erro, nem no log, nem quando o Google ecoa o pedido', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { busca } = falso((url, init) =>
      // O corpo do erro ecoa o pedido inteiro, assertion incluída.
      url === URL_DO_TOKEN ? resposta(400, { error: 'invalid_grant', eco: String(init.body), chave: PEM }) : resposta(500, {}),
    )
    const leitor = new LeitorGoogleSheets(contaDeServicoDoAmbiente(JSON_DA_CONTA), new RelogioFixo(AGORA), busca)
    const r = await leitor.lerEstrutura(ID)
    expect(r.tipo).toBe('erro')
    const tudo = JSON.stringify(r) + JSON.stringify(log.mock.calls) + JSON.stringify(err.mock.calls) + JSON.stringify(leitor)
    expect(tudo).not.toContain('PRIVATE KEY')
    expect(tudo).not.toContain(PEM.split('\n')[1]!)
    expect(tudo).not.toContain('assertion')
    expect(tudo).not.toContain('invalid_grant')
    expect(r).toEqual({ tipo: 'erro', erro: { codigo: 'autenticacao', mensagem: expect.stringMatching(/recusou a conta de serviço/) } })
  })

  it('sem acesso, inexistente, limite e rede fora viram frases fechadas', async () => {
    const caso = async (status: number | 'rede') => {
      const { busca } = falso((url) => {
        if (url === URL_DO_TOKEN) return resposta(200, { access_token: 't', expires_in: 3600 })
        if (status === 'rede') throw new TypeError('fetch failed')
        return resposta(status, { error: { message: 'detalhe interno do Google' } })
      })
      const r = await new LeitorGoogleSheets(contaDeServicoDoAmbiente(JSON_DA_CONTA), new RelogioFixo(AGORA), busca).lerEstrutura(ID)
      return r.tipo === 'erro' ? r.erro.codigo : 'ok'
    }
    expect(await caso(403)).toBe('sem_acesso')
    expect(await caso(404)).toBe('nao_encontrada')
    expect(await caso(429)).toBe('limite')
    expect(await caso(503)).toBe('indisponivel')
    expect(await caso('rede')).toBe('indisponivel')
  })

  it('sem conta configurada, "não configurado" — e nenhum pedido sai', async () => {
    const { chamadas, busca } = falso(() => resposta(200, {}))
    expect(contaDeServicoDoAmbiente(undefined)).toBeNull()
    expect(contaDeServicoDoAmbiente('{"client_email":"x@y.com","private_key":"nao-e-pem"}')).toBeNull()
    const r = await new LeitorGoogleSheets(null, new RelogioFixo(AGORA), busca).lerEstrutura(ID)
    expect(r).toMatchObject({ tipo: 'erro', erro: { codigo: 'nao_configurado' } })
    expect(chamadas).toHaveLength(0)
  })

  it('id fora do formato não vira pedido (nada de caminho injetado na URL)', async () => {
    const { chamadas, busca } = falso(() => resposta(200, {}))
    const leitor = new LeitorGoogleSheets(contaDeServicoDoAmbiente(JSON_DA_CONTA), new RelogioFixo(AGORA), busca)
    expect((await leitor.lerEstrutura('../../../outra-coisa')).tipo).toBe('erro')
    expect(chamadas).toHaveLength(0)
  })
})
