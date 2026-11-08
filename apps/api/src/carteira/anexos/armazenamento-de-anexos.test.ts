import fc from 'fast-check'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AnexoGrandeDemais, lerAteOLimite } from './anexos.service'
import {
  ArmazenamentoCifradoEmDisco,
  ArquivoDeAnexoAdulterado,
  ArquivoDeAnexoAusente,
  chaveDeCifra,
  cifrar,
  decifrar,
  segredoDeAnexosDoAmbiente,
} from './armazenamento-de-anexos'

let dir: string
let armazem: ArmazenamentoCifradoEmDisco
const SEGREDO = 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres'

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fir-armazem-'))
  armazem = new ArmazenamentoCifradoEmDisco(dir, SEGREDO)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('cifra AES-256-GCM por arquivo', () => {
  it('propriedade: decifrar(cifrar(x)) = x, e o cifrado nunca contém o original', () => {
    const k = chaveDeCifra(SEGREDO)
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 2048 }), fc.uuid(), (bytes, aad) => {
        const original = Buffer.from(bytes)
        const c = cifrar(k, aad, original)
        return decifrar(k, aad, c).equals(original) && !c.includes(original)
      }),
    )
  })

  it('AAD diferente (arquivo de um anexo trocado pelo de outro) não decifra', () => {
    const k = chaveDeCifra(SEGREDO)
    const c = cifrar(k, randomUUID(), Buffer.from('conteudo'))
    expect(() => decifrar(k, randomUUID(), c)).toThrow(ArquivoDeAnexoAdulterado)
  })

  it('chave diferente não decifra', () => {
    const aad = randomUUID()
    const c = cifrar(chaveDeCifra(SEGREDO), aad, Buffer.from('conteudo'))
    expect(() => decifrar(chaveDeCifra(`${SEGREDO}-outra`), aad, c)).toThrow(ArquivoDeAnexoAdulterado)
  })

  it('um byte adulterado em qualquer posição é recusado', () => {
    const k = chaveDeCifra(SEGREDO)
    const aad = randomUUID()
    const c = cifrar(k, aad, Buffer.from('um conteudo qualquer de teste'))
    fc.assert(
      fc.property(fc.integer({ min: 0, max: c.length - 1 }), fc.integer({ min: 1, max: 255 }), (i, x) => {
        const mexido = Buffer.from(c)
        mexido[i] = mexido[i]! ^ x
        try {
          decifrar(k, aad, mexido)
          return false
        } catch (e) {
          return e instanceof ArquivoDeAnexoAdulterado
        }
      }),
    )
  })
})

describe('ArmazenamentoCifradoEmDisco', () => {
  it('grava com o nome = chave, ida e volta, e apaga de forma idempotente', async () => {
    const chave = randomUUID()
    await armazem.gravar(chave, Buffer.from('%PDF-1.4 teste'))
    expect(await readdir(dir)).toContain(chave)
    expect((await readFile(join(dir, chave))).includes(Buffer.from('%PDF'))).toBe(false)
    expect((await armazem.ler(chave)).toString()).toBe('%PDF-1.4 teste')
    await armazem.apagar(chave)
    await armazem.apagar(chave)
    await expect(armazem.ler(chave)).rejects.toBeInstanceOf(ArquivoDeAnexoAusente)
  })

  it('renomear o arquivo de um anexo para a chave de outro não entrega o conteúdo', async () => {
    const a = randomUUID()
    const b = randomUUID()
    await armazem.gravar(a, Buffer.from('de A'))
    await rename(join(dir, a), join(dir, b))
    await expect(armazem.ler(b)).rejects.toBeInstanceOf(ArquivoDeAnexoAdulterado)
  })

  it('chave que não é UUID nunca vira caminho (nada de ../)', async () => {
    await expect(armazem.gravar('../fora', Buffer.from('x'))).rejects.toThrow(/inválida/)
    await expect(armazem.ler('..\\..\\x')).rejects.toThrow(/inválida/)
  })

  it('lixo no lugar do arquivo é adulterado, não conteúdo', async () => {
    const chave = randomUUID()
    await writeFile(join(dir, chave), 'texto em claro')
    await expect(armazem.ler(chave)).rejects.toBeInstanceOf(ArquivoDeAnexoAdulterado)
  })
})

describe('CHAVE_ANEXOS', () => {
  it('em produção, ausente ou curta é erro; fora, há uma chave de desenvolvimento', () => {
    expect(() => segredoDeAnexosDoAmbiente({ NODE_ENV: 'production' })).toThrow(/CHAVE_ANEXOS/)
    expect(() => segredoDeAnexosDoAmbiente({ NODE_ENV: 'production', CHAVE_ANEXOS: 'curta' })).toThrow()
    expect(segredoDeAnexosDoAmbiente({ NODE_ENV: 'production', CHAVE_ANEXOS: SEGREDO })).toBe(SEGREDO)
    expect(segredoDeAnexosDoAmbiente({})).toMatch(/desenvolvimento/)
  })
})

describe('lerAteOLimite — o teto contado no stream', () => {
  it('corta no primeiro byte acima do limite', async () => {
    const stream = Readable.from([Buffer.alloc(600), Buffer.alloc(500)])
    await expect(lerAteOLimite(stream, 1000)).rejects.toBeInstanceOf(AnexoGrandeDemais)
  })

  it('exatamente no limite passa, inteiro', async () => {
    const r = await lerAteOLimite(Readable.from([Buffer.alloc(600, 1), Buffer.alloc(400, 2)]), 1000)
    expect(r.length).toBe(1000)
    expect(r[999]).toBe(2)
  })
})
