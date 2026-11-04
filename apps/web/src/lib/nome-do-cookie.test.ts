import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O nome do cookie de sessão existe em DOIS lugares, e eles têm de concordar.
 *
 * **Por que não é um import.** `apps/web` não pode importar de `apps/api` — a
 * regra de dependência do monorepo proíbe app → app, e com razão: o cliente
 * passaria a arrastar o servidor. E o nome não cabe em `packages/contracts`,
 * que é schema de corpo de requisição, não de transporte.
 *
 * Então há duas cadeias literais. A alternativa a esta varredura seria
 * confiar: e o defeito que ela previne é **silencioso e caro**. Se os nomes
 * divergirem, `sessaoAtual` nunca vê o cookie, conclui "primeira visita" e
 * manda a pessoa para a tela de entrada **sem a explicação** de que o dia
 * encerrou — exatamente o comportamento que P-1 veio corrigir, de volta, e
 * sem nenhum erro aparecendo em lugar nenhum.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..', '..', '..')

const literal = (caminho: string, variavel: string): string => {
  const fonte = readFileSync(join(RAIZ, caminho), 'utf8')
  const m = new RegExp(`${variavel}\\s*=\\s*'([^']+)'`).exec(fonte)
  expect(m, `não achei ${variavel} em ${caminho}`).not.toBeNull()
  return m![1]!
}

describe('o nome do cookie de sessão é o mesmo nos dois lados', () => {
  it('web e api declaram a mesma cadeia', () => {
    const noWeb = literal('apps/web/src/lib/sessao.ts', 'NOME_DO_COOKIE')
    const naApi = literal('apps/api/src/autenticacao/sessao.guard.ts', 'NOME_DO_COOKIE')
    expect(noWeb).toBe(naApi)
  })

  it('e continua com o prefixo `__Host-`, que não é enfeite', () => {
    // `__Host-` obriga Secure e Path=/, e proíbe Domain. Perder o prefixo
    // numa renomeação afrouxaria o cookie sem nenhum teste reclamar.
    expect(literal('apps/api/src/autenticacao/sessao.guard.ts', 'NOME_DO_COOKIE')).toMatch(
      /^__Host-/,
    )
  })
})
