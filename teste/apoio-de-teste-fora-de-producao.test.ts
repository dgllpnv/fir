import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `apps/api/src/banco/limpeza-de-teste.ts` é apoio de FIXTURE morando num
 * pacote de produção, e exportado por ele (`apps/api/package.json`).
 *
 * Por que ele mora ali: dois pacotes precisam dele — `apps/api` (os `*.e2e`)
 * e `@fir/teste` — e a alternativa seria duplicá-lo em cinco arquivos, que é
 * exatamente como a ordem dos `DELETE` fica errada em quatro deles. Um
 * pacote novo só para um arquivo de fixture é cerimônia que ninguém mantém.
 *
 * O que ele faz é o que torna isso perigoso: desliga o trigger de
 * append-only e apaga linhas de `auditoria`. Um `import` desse arquivo a
 * partir de código de produção não é cheiro — é a porta que destrói a trilha
 * de uma clínica, com a aparência inocente de uma função de limpeza. E o
 * `DELETE FROM clinicas` ao final contradiz a regra 20, que manda desativar
 * e nunca apagar.
 *
 * Então: fica onde está, e isto cobra que ninguém de produção o importe.
 * Mesmo espírito das outras varreduras deste pacote — a verificação olha o
 * código de verdade, não uma promessa num comentário.
 *
 * ALCANCE, dito sem exagero: pega o import DIRETO. Um arquivo de produção que
 * importasse um `*.test.ts` que por sua vez importa a limpeza escaparia — mas
 * esse arquivo intermediário também seria um teste em produção, e é um
 * problema maior e mais visível que este.
 */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Onde mora código que vai para o ar. `teste/` fica de fora por definição. */
const AREAS_DE_PRODUCAO = ['apps/api/src', 'apps/web/src', 'packages']

const PROIBIDO = /limpeza-de-teste/

const ehTeste = (caminho: string): boolean =>
  caminho.endsWith('.test.ts') || caminho.endsWith('.test.tsx') || caminho.includes(`${sep}__tests__${sep}`)

function arquivosDe(raiz: string): string[] {
  let entradas: string[]
  try {
    entradas = readdirSync(raiz)
  } catch {
    return []
  }
  const achados: string[] = []
  for (const nome of entradas) {
    if (nome === 'node_modules' || nome === '.turbo' || nome === '.next' || nome === 'dist') continue
    const caminho = join(raiz, nome)
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivosDe(caminho))
    } else if (/\.tsx?$/.test(nome)) {
      achados.push(caminho)
    }
  }
  return achados
}

describe('apoio de teste não é importado por código de produção', () => {
  const todos = AREAS_DE_PRODUCAO.flatMap((area) => arquivosDe(join(RAIZ, area)))
  const deProducao = todos.filter((c) => !ehTeste(c))

  it('a varredura encontrou código de produção — senão ela não verificou nada', () => {
    // O piso. Sem ele, um `AREAS_DE_PRODUCAO` com um caminho errado de digitação
    // faria o `it` abaixo passar varrendo zero arquivo.
    expect(
      deProducao.length,
      'nenhum arquivo de produção encontrado — a varredura não verificou nada',
    ).toBeGreaterThan(50)
  })

  it('nenhum arquivo de produção importa limpeza-de-teste', () => {
    const culpados = deProducao.filter((caminho) => {
      const fonte = readFileSync(caminho, 'utf8')
      // Só linhas de `import`/`export … from`: a menção num comentário é
      // documentação, e proibir o NOME em vez do IMPORT faria este arquivo
      // reprovar a si mesmo.
      return fonte
        .split('\n')
        .some((l) => /^\s*(import|export)\b/.test(l) && PROIBIDO.test(l))
    })

    expect(
      culpados.map((c) => relative(RAIZ, c).split(sep).join('/')),
      'código de produção importando apoio de teste. `limpeza-de-teste.ts` desliga o trigger de ' +
        'append-only e apaga linhas de `auditoria` — em produção a clínica se DESATIVA, e a ' +
        'trilha dela continua sendo a resposta a "o que aconteceu aqui" (regra 20).',
    ).toEqual([])
  })
})
