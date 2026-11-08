import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **DESFAZER PAGAMENTO NA TELA** (D-21, item 4).
 *
 * Varredura sobre a FONTE, como `excluir-pessoa.test.ts`: não há Testing
 * Library nesta árvore (dívida registrada). O que se segura aqui é o que a
 * tela não pode esquecer: a ação só com `contas.gerir`, o texto que diz que a
 * conta volta a ficar em aberto, e a segunda confirmação do mês anterior
 * casada pelo CÓDIGO e reenviando o mesmo corpo com a confirmação.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const fonte = readFileSync(join(AQUI, 'tela-contas.tsx'), 'utf8')
const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

describe('desfazer pagamento na tela de contas', () => {
  it('a ação só aparece com `contas.gerir` e só na conta paga', () => {
    expect(codigo).toMatch(/podeGerir && c\.pagoEm !== null \?/)
    expect(codigo).toContain('Desfazer pagamento')
  })

  it('o motivo é obrigatório antes de chamar o servidor', () => {
    expect(codigo).toMatch(/motivo\.trim\(\)\.length < 3/)
  })

  it('diz que a conta volta a ficar em aberto', () => {
    expect(codigo).toContain('A conta volta a ficar em aberto')
  })

  it('o mês anterior é casado pelo CÓDIGO e reenviado com a confirmação', () => {
    expect(codigo).toContain("e.codigo === 'CONFIRMACAO_NECESSARIA'")
    expect(codigo).toContain('confirmarMesAnterior: true')
    expect(codigo).toMatch(/Desfazer vai mudar a Visão do mês de/)
  })

  it('o valor na tela sai do formatador central — nunca toFixed', () => {
    expect(codigo).not.toMatch(/toFixed\(/)
  })
})
