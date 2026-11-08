import type { LookupAddress } from 'node:dns'
import { describe, expect, it } from 'vitest'
import { criarBaixador, enderecoPublico, FalhaAoBaixar, lookupSoPublico } from './baixar-feed'

describe('enderecoPublico', () => {
  it.each([
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.5', false],
    ['192.168.0.10', false],
    ['169.254.169.254', false],
    ['100.64.1.1', false],
    ['0.0.0.0', false],
    ['::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:10.0.0.1', false],
    ['8.8.8.8', true],
    ['142.250.78.14', true],
    ['2800:3f0:4001:80d::200e', true],
    ['nao-e-ip', false],
  ])('%s → %s', (ip, publico) => {
    expect(enderecoPublico(ip)).toBe(publico)
  })
})

/** Um DNS de mentira: devolve o que o teste mandar, como o rebinding faria. */
const dnsFalso =
  (enderecos: LookupAddress[]) =>
  (_h: string, _o: unknown, cb: (e: Error | null, a: LookupAddress[]) => void) =>
    cb(null, enderecos)

describe('lookupSoPublico', () => {
  const perguntar = (enderecos: LookupAddress[]) =>
    new Promise<{ erro: NodeJS.ErrnoException | null; endereco: unknown }>((resolver) => {
      // `as never`: o DNS falso só implementa a sobrecarga que o lookup usa.
      const l = lookupSoPublico(dnsFalso(enderecos) as never)
      ;(l as unknown as (h: string, o: object, cb: (e: NodeJS.ErrnoException | null, a: unknown) => void) => void)(
        'agenda.exemplo',
        {},
        (erro, endereco) => resolver({ erro, endereco }),
      )
    })

  it('recusa se QUALQUER resposta for privada', async () => {
    const r = await perguntar([
      { address: '8.8.8.8', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])
    expect(r.erro?.code).toBe('ENDERECO_PROIBIDO')
  })

  it('aceita resposta toda pública', async () => {
    const r = await perguntar([{ address: '8.8.8.8', family: 4 }])
    expect(r.erro).toBeNull()
    expect(r.endereco).toBe('8.8.8.8')
  })
})

describe('criarBaixador', () => {
  const baixar = criarBaixador()
  const recusa = async (url: string, trecho: string) => {
    const e = await baixar(url).then(
      () => null,
      (x: unknown) => x,
    )
    expect(e).toBeInstanceOf(FalhaAoBaixar)
    expect((e as Error).message).toContain(trecho)
    // A mensagem vai para a tela: nunca carrega o link, que é segredo.
    expect((e as Error).message).not.toContain('SEGREDO')
  }

  it('só https, porta 443, sem credencial e sem IP interno', async () => {
    await recusa('http://agenda.exemplo/SEGREDO.ics', 'https://')
    await recusa('https://agenda.exemplo:8443/SEGREDO.ics', 'porta')
    await recusa('https://u:p@agenda.exemplo/SEGREDO.ics', 'usuário')
    await recusa('https://127.0.0.1/SEGREDO.ics', 'endereço interno')
    await recusa('https://[::1]/SEGREDO.ics', 'endereço interno')
    await recusa('https://169.254.169.254/SEGREDO', 'endereço interno')
    await recusa('não é url', 'endereço válido')
  })

  it('nome que resolve para loopback é recusado na conexão', async () => {
    await recusa('https://localhost/SEGREDO.ics', 'endereço interno')
  })
})
