import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Varredura: todo método HTTP escrito à mão é um método HTTP de verdade.
 *
 * **Por que existe, e é medição, não gosto.** O excluir de programa foi
 * entregue com `{ method: '' }`. O `fetch` **recusa** a cadeia vazia —
 * `TypeError: '' is not a valid HTTP method` —, o `catch` da tela traduzia
 * isso para "Não consegui excluir o programa", e o botão vivia quebrado sem
 * nunca chegar ao servidor. Reproduzido pelo dono em produção, relatado pela
 * PO: *"o botão de excluir está dando erro"*.
 *
 * O defeito é invisível à revisão: `method: ''` lê como preenchido. E é
 * invisível ao TypeScript, porque `RequestInit.method` é `string`. Só uma
 * varredura sobre o disco pega a classe inteira — este caso e o próximo.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

const VALIDOS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return arquivos(p)
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
}

type Achado = { arquivo: string; linha: number; metodo: string }

function metodosEscritos(): Achado[] {
  const achados: Achado[] = []
  for (const arquivo of arquivos(SRC)) {
    const linhas = readFileSync(arquivo, 'utf8').split(/\r?\n/)
    linhas.forEach((linha, i) => {
      for (const m of linha.matchAll(/\bmethod:\s*(['"`])([^'"`]*)\1/g)) {
        achados.push({ arquivo: arquivo.slice(SRC.length + 1), linha: i + 1, metodo: m[2] ?? '' })
      }
    })
  }
  return achados
}

describe('nenhum método HTTP literal é inválido', () => {
  it('a varredura encontrou métodos para examinar', () => {
    expect(
      metodosEscritos().length,
      'nenhum `method:` literal no disco — a varredura não verificaria nada',
    ).toBeGreaterThan(10)
  })

  it('todo método literal está entre os verbos que o fetch aceita', () => {
    const invalidos = metodosEscritos().filter((a) => !VALIDOS.has(a.metodo))
    expect(
      invalidos.map((a) => `${a.arquivo}:${a.linha} method: '${a.metodo}'`),
      'o fetch lança TypeError antes de sair da tela: o botão quebra sem chegar ao servidor',
    ).toEqual([])
  })
})
