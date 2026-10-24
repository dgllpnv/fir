import { describe, expect, it } from 'vitest'
// Import relativo cruzando para apps/api: `redigir` não é exportado por
// `@fir/api` (o pacote não tem `exports` nem `main` — não foi desenhado para
// ser consumido por outro pacote do workspace) e esta tarefa não pode
// alterar nada fora de `teste/` e `pnpm-workspace.yaml`. O caminho relativo
// aponta direto para o arquivo fonte, sem extensão, seguindo a mesma
// convenção da ADR 0001 (moduleResolution "Bundler" resolve `.ts` sem
// precisar de `.js` no especificador).
import { redigir } from '../apps/api/src/comum/redacao.interceptor'

/**
 * Achado da Task 14: `redigir` só desce em objeto simples — instância de
 * classe tem protótipo próprio (`ehObjetoSimples` devolve false) e volta
 * INTOCADA, campo monetário incluído. Hoje isto é seguro porque todo
 * controlador devolve objeto literal — o contrato é Zod sobre JSON, não uma
 * classe — mas nada no tipo impede um controlador de devolver uma instância
 * no futuro. Este teste prova o comportamento real e documenta o risco; ele
 * não é (e não pretende ser) uma garantia de que nenhuma rota jamais
 * devolverá uma instância de classe. Essa garantia real só existe quando
 * houver uma rota devolvendo DTO de classe de verdade — aí o teste certo é
 * um teste de integração contra ESSA rota, não este aqui.
 */
class RotaComSalario {
  constructor(public readonly salario: string) {}
}

describe('redigir ignora instância de classe — risco documentado (Task 14)', () => {
  it('não redige campo monetário dentro de uma instância de classe', () => {
    const semPermissao = () => false
    const instancia = new RotaComSalario('500000')
    const resultado = redigir(instancia, semPermissao)
    // O MESMO objeto volta, intocado — inclusive o campo que deveria sumir.
    expect(resultado).toBe(instancia)
    expect((resultado as RotaComSalario).salario).toBe('500000')
  })
})
