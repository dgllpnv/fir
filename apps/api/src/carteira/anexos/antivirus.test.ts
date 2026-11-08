import { type AddressInfo, createServer, type Server, Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { AntivirusIndisponivel, ClamdPorTcp } from './antivirus'

/**
 * O protocolo INSTREAM do clamd contra um servidor TCP de mentira — o que o
 * cliente MANDA (blocos com tamanho big-endian e o bloco zero no fim) e como
 * ele LÊ cada resposta. O clamd de verdade entra no teste de baixo, só quando
 * está no ar (`CLAMD_HOST`/`CLAMD_PORTA`, ou o container local em 4833).
 */

let servidor: Server | null = null
afterEach(async () => {
  await new Promise<void>((r) => (servidor ? servidor.close(() => r()) : r()))
  servidor = null
})

/** Um "clamd" que remonta o stream recebido e responde o que `responder` decidir. */
async function clamdFalso(responder: (recebido: Buffer) => string): Promise<number> {
  servidor = createServer((s) => {
    const partes: Buffer[] = []
    s.on('data', (d: Buffer) => partes.push(d))
    s.on('end', () => {
      const tudo = Buffer.concat(partes)
      const comando = 'zINSTREAM\0'
      expect(tudo.subarray(0, comando.length).toString('latin1')).toBe(comando)
      const blocos: Buffer[] = []
      let p = comando.length
      for (;;) {
        const n = tudo.readUInt32BE(p)
        p += 4
        if (n === 0) break
        blocos.push(tudo.subarray(p, p + n))
        p += n
      }
      expect(p).toBe(tudo.length)
      s.end(`${responder(Buffer.concat(blocos))}\0`)
    })
  })
  await new Promise<void>((r) => servidor!.listen(0, '127.0.0.1', () => r()))
  return (servidor!.address() as AddressInfo).port
}

describe('ClamdPorTcp', () => {
  it('stream: OK → limpo, e o conteúdo chega íntegro mesmo em vários blocos', async () => {
    const conteudo = Buffer.alloc(200 * 1024, 7)
    let recebido: Buffer = Buffer.alloc(0)
    const porta = await clamdFalso((r) => {
      recebido = r
      return 'stream: OK'
    })
    await expect(new ClamdPorTcp('127.0.0.1', porta).varrer(conteudo)).resolves.toEqual({ situacao: 'limpo' })
    expect(recebido.equals(conteudo)).toBe(true)
  })

  it('FOUND → infectado, com a assinatura', async () => {
    const porta = await clamdFalso(() => 'stream: Eicar-Test-Signature FOUND')
    await expect(new ClamdPorTcp('127.0.0.1', porta).varrer(Buffer.from('x'))).resolves.toEqual({
      situacao: 'infectado',
      assinatura: 'Eicar-Test-Signature',
    })
  })

  it('ERROR (inclusive "size limit exceeded") é indisponível, nunca limpo', async () => {
    const porta = await clamdFalso(() => 'INSTREAM size limit exceeded. ERROR')
    await expect(new ClamdPorTcp('127.0.0.1', porta).varrer(Buffer.from('x'))).rejects.toBeInstanceOf(
      AntivirusIndisponivel,
    )
  })

  it('ninguém escutando → indisponível', async () => {
    const porta = await clamdFalso(() => 'stream: OK')
    await new Promise<void>((r) => servidor!.close(() => r()))
    servidor = null
    await expect(new ClamdPorTcp('127.0.0.1', porta, 2000).varrer(Buffer.from('x'))).rejects.toBeInstanceOf(
      AntivirusIndisponivel,
    )
  })

  it('servidor que não responde → indisponível no prazo', async () => {
    const presas: Socket[] = []
    // Mudo: lê e descarta, nunca responde.
    servidor = createServer((s) => {
      presas.push(s)
      s.resume()
    })
    await new Promise<void>((r) => servidor!.listen(0, '127.0.0.1', () => r()))
    const porta = (servidor.address() as AddressInfo).port
    await expect(new ClamdPorTcp('127.0.0.1', porta, 300).varrer(Buffer.from('x'))).rejects.toBeInstanceOf(
      AntivirusIndisponivel,
    )
    // Fecha as conexões presas para o `close` do afterEach não esperar.
    for (const s of presas) s.destroy()
  })
})

/** O clamd local (`fir infra`, porta 4833) está no ar? */
async function clamdNoAr(host: string, porta: number): Promise<boolean> {
  return new Promise((r) => {
    const s = new Socket()
    s.setTimeout(500)
    s.once('error', () => r(false))
    s.once('timeout', () => {
      s.destroy()
      r(false)
    })
    s.connect(porta, host, () => {
      s.end('zPING\0')
      s.once('data', (d: Buffer) => r(d.toString().startsWith('PONG')))
    })
  })
}

const HOST = process.env['CLAMD_HOST'] ?? '127.0.0.1'
const PORTA = Number(process.env['CLAMD_PORTA'] ?? 4833)
const disponivel = await clamdNoAr(HOST, PORTA)

describe.skipIf(!disponivel)('ClamdPorTcp contra o clamd de verdade', () => {
  // A string EICAR — padrão da indústria para testar antivírus; inofensiva.
  const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

  it('EICAR é infectado; um PDF qualquer é limpo', async () => {
    const clamd = new ClamdPorTcp(HOST, PORTA)
    const r = await clamd.varrer(Buffer.from(EICAR, 'latin1'))
    expect(r.situacao).toBe('infectado')
    await expect(clamd.varrer(Buffer.from('%PDF-1.4\nnada aqui\n'))).resolves.toEqual({ situacao: 'limpo' })
  })
})
