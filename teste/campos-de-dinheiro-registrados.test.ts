import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CAMPOS_MONETARIOS } from '@fir/domain'
import { describe, expect, it } from 'vitest'

/**
 * A varredura que impede um campo monetário de nascer com nome que o
 * `RedacaoInterceptor` não conhece.
 *
 * O interceptor apaga por **nome de chave**, contra `CAMPOS_MONETARIOS`. Um
 * campo novo chamado `montante` atravessaria inteiro para quem não tem
 * `valores`, sem erro de tipo, sem revisão que o pegasse — e seria o endpoint
 * número quarenta, não o primeiro.
 *
 * Varredura de FONTE, e não de runtime, porque os schemas de Zod não guardam
 * de onde cada campo veio: `z.string()` com regex de centavos é
 * indistinguível de `z.string()` com regex de CEP depois de construído. A
 * fonte guarda.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const PASTA = join(AQUI, '..', 'packages', 'contracts', 'src')

/** As duas raízes: entrada (`dinheiroEmTexto`) e saída (`centavosNaSaida`). */
const RAIZES = ['dinheiroEmTexto', 'centavosNaSaida']

type Arquivo = { readonly nome: string; readonly fonte: string }

function arquivosDeContrato(): readonly Arquivo[] {
  return readdirSync(PASTA)
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
    .map((nome) => ({ nome, fonte: readFileSync(join(PASTA, nome), 'utf8') }))
}

export function fonteDosContratos(): string {
  return arquivosDeContrato()
    .map((a) => a.fonte)
    .join('\n')
}

/**
 * Os identificadores que CARREGAM dinheiro, seguindo os apelidos.
 *
 * `valorRecebido`, `valorEmAberto`, `valorDeOrcamento` e `valorDeItem` são
 * `dinheiroEmTexto` com um `refine` em cima, e os campos usam o apelido, não
 * a raiz. Uma varredura que procurasse só pelas duas raízes acharia **zero**
 * campos de entrada neste repositório — ou seja, passaria verde por estar
 * cega, que é o modo de falha que este arquivo inteiro existe para evitar.
 */
function identificadoresDeDinheiro(fonte: string): Set<string> {
  const conhecidos = new Set(RAIZES)
  const linhas = fonte.split('\n')
  let mudou = true
  while (mudou) {
    mudou = false
    for (let i = 0; i < linhas.length; i++) {
      const decl = /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/.exec(linhas[i] ?? '')
      if (!decl) continue
      const nome = decl[1]!
      if (conhecidos.has(nome)) continue
      // O corpo da declaração vai até a próxima declaração de topo.
      let corpo = linhas[i]!
      for (let j = i + 1; j < linhas.length; j++) {
        if (/^\s*(?:export\s+)?(const|function|type|interface|class)\s/.test(linhas[j] ?? '')) break
        corpo += `\n${linhas[j]}`
      }
      // Só apelidos ESCALARES. `PagamentoEmbutido = z.object({ valor: … })`
      // também "contém" dinheiro, mas o campo que o usa (`pagamento`) não é
      // monetário: o interceptor desce no objeto e acha o `valor` lá dentro.
      // Tratá-lo como monetário acusaria `pagamento`, `tarefa` e `quando` —
      // cinco falsos positivos, medidos — e um teste que acusa o que está
      // certo é um teste que alguém desliga.
      // O `\s*` entre `z` e o ponto não é zelo: o repositório escreve
      // `const PagamentoEmbutido = z\n  .object({…})`, e um `z\.` colado não
      // casa com isso — medido, três falsos positivos sobreviveram ao
      // primeiro filtro por causa da quebra de linha.
      if (/\bz\s*\.\s*(object|array|record|lazy|discriminatedUnion|intersection)\s*\(/.test(corpo)) {
        continue
      }
      if ([...conhecidos].some((k) => new RegExp(`\\b${k}\\b`).test(corpo))) {
        conhecidos.add(nome)
        mudou = true
      }
    }
  }
  return conhecidos
}

export function camposDeDinheiroDosContratos(): readonly { campo: string; arquivo: string }[] {
  const fonte = fonteDosContratos()
  const ids = [...identificadoresDeDinheiro(fonte)]
  const padrao = new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*(?:${ids.join('|')})\\b`, 'g')

  const achados: { campo: string; arquivo: string }[] = []
  for (const a of arquivosDeContrato()) {
    for (const m of a.fonte.matchAll(padrao)) achados.push({ campo: m[1]!, arquivo: a.nome })
  }
  return achados
}

describe('todo campo monetário tem nome que o interceptor conhece', () => {
  it('a varredura ENXERGA os campos de dinheiro que já existem', () => {
    // Sem esta asserção, uma varredura quebrada (regex que não casa, pasta
    // errada) devolveria lista vazia e o teste abaixo passaria verde para
    // sempre. Teste de varredura precisa provar que a varredura varre.
    const campos = camposDeDinheiroDosContratos().map((x) => x.campo)
    expect(campos.length).toBeGreaterThan(8)
    for (const esperado of ['valor', 'valorAberto', 'valorOrcamento', 'ltv', 'saldo']) {
      expect(campos, `a varredura não achou \`${esperado}\``).toContain(esperado)
    }
  })

  it('todo campo monetário dos contratos tem nome que o interceptor conhece', () => {
    const lista: readonly string[] = CAMPOS_MONETARIOS
    const fora = [...new Set(camposDeDinheiroDosContratos().filter((x) => !lista.includes(x.campo)).map((x) => `${x.campo} (${x.arquivo})`))]
    expect(fora, `campos monetários fora de CAMPOS_MONETARIOS: ${fora.join(', ')}`).toEqual([])
  })

  it('nenhum contrato põe dinheiro como VALOR de um mapa', () => {
    // `z.record(z.string(), dinheiroEmTexto)` é a forma que o interceptor não
    // alcança: ele redige por NOME DE CHAVE, e a chave aqui é dado.
    //
    //   VAZA     { porForma: { Pix: '45000' } }
    //   NÃO VAZA { porForma: [ { forma: 'Pix', valor: '45000' } ] }
    //
    // Mapa de forma de pagamento, de categoria de despesa ou de programa vira
    // ARRAY de objetos, sempre, e o campo chama-se `valor`.
    const fonte = fonteDosContratos()
    const ids = [...identificadoresDeDinheiro(fonte)]
    const padrao = new RegExp(`z\\.record\\([^)]*(?:${ids.join('|')})`, 'g')
    expect([...fonte.matchAll(padrao)].map((m) => m[0])).toEqual([])
  })
})
