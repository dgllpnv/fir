import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **CICLO DE IMPORTAÇÃO ENTRE CONTRATOS — a falha que o teste não vê e o
 * `node` vê.**
 *
 * Nasceu de um defeito MEDIDO, e o que o torna caro é onde ele aparece.
 * `autenticacao.ts` passou a importar `OperadorPublico` de `superadmin.ts`
 * (a sessão de suporte, D-13), e `superadmin.ts` passou a importar
 * `EditarPessoa` de `pessoas.ts`, que importa `PerfilPublico` de
 * `autenticacao.ts`. O ciclo fechou, e a API **não subiu**:
 *
 *   ReferenceError: Cannot access 'PerfilPublico' before initialization
 *       packages/contracts/src/pessoas.ts:211
 *
 * O que ela diz é literal: num ciclo, um dos módulos roda com o outro ainda
 * pela metade, e `z.object({ … PerfilPublico })` no corpo do módulo lê uma
 * `const` que ainda não existe. **Nenhum dos 2.371 testes quebrou** — o
 * `vitest` usa outro grafo de módulos e outra ordem de avaliação, e nele o
 * mesmo código funciona. Quem reprovou foi `tsx src/main.ts`, isto é, o
 * produto subindo.
 *
 * Por isso a varredura é ESTÁTICA: ela não depende de qual carregador roda, e
 * pega o ciclo no momento em que ele é escrito, em vez de no primeiro `pnpm
 * dev` de quem não o escreveu.
 *
 * `index.ts` fica FORA do grafo de propósito: ele é o barril e importa todos,
 * então ele aparece em todo caminho sem fechar ciclo nenhum.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))

const ARQUIVOS = readdirSync(AQUI)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'index.ts')
  .map((f) => f.replace(/\.ts$/, ''))

/** As importações RELATIVAS de cada módulo. `zod` e `@fir/domain` não entram. */
const grafo = new Map<string, string[]>(
  ARQUIVOS.map((nome) => {
    const texto = readFileSync(join(AQUI, `${nome}.ts`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const vizinhos = [...texto.matchAll(/from\s+'\.\/([\w-]+)'/g)].map((m) => m[1]!)
    return [nome, [...new Set(vizinhos)]]
  }),
)

/** O primeiro ciclo achado, como caminho legível. `null` quando não há. */
function acharCiclo(): string | null {
  const estado = new Map<string, 'visitando' | 'pronto'>()
  const caminho: string[] = []

  const descer = (no: string): string | null => {
    estado.set(no, 'visitando')
    caminho.push(no)
    for (const vizinho of grafo.get(no) ?? []) {
      if (estado.get(vizinho) === 'pronto') continue
      if (estado.get(vizinho) === 'visitando') {
        const inicio = caminho.indexOf(vizinho)
        return [...caminho.slice(inicio), vizinho].join(' → ')
      }
      const achou = descer(vizinho)
      if (achou !== null) return achou
    }
    caminho.pop()
    estado.set(no, 'pronto')
    return null
  }

  for (const no of grafo.keys()) {
    if (estado.get(no) === 'pronto') continue
    const achou = descer(no)
    if (achou !== null) return achou
  }
  return null
}

describe('os contratos não têm ciclo de importação', () => {
  it('a varredura leu os arquivos — senão ela não verificou nada', () => {
    expect(ARQUIVOS.length).toBeGreaterThan(8)
    const arestas = [...grafo.values()].flat().length
    expect(arestas, 'nenhuma importação relativa encontrada').toBeGreaterThan(5)
  })

  it('nenhum ciclo', () => {
    expect(
      acharCiclo(),
      'ciclo de importação entre contratos: no `node`, um dos módulos roda com o outro pela ' +
        'metade e um `z.object({ … })` no corpo do módulo estoura com ' +
        '"Cannot access X before initialization" — a API não sobe. O vitest NÃO pega isso. ' +
        'Quebre o ciclo movendo o schema compartilhado para o módulo que já é folha.',
    ).toBeNull()
  })
})
