import { EditarItemDoPrograma, EditarPrograma, EncerrarPrograma } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { primeiroErro } from './tarefas.controller'

/**
 * `primeiroErro` é a frase que **a usuária lê** quando o corpo não passa.
 *
 * Ela sai de 76 chamadas. Duas coisas têm de valer em todas: estar em
 * português, e **não carregar o valor que causou o erro** — nome de paciente,
 * descrição de atendimento e dinheiro não atravessam para a resposta (regra
 * 21), que é de onde vão para o log do proxy e do navegador.
 *
 * Os schemas vêm de `@fir/contracts`, não de um `z.object` escrito aqui: um
 * schema local provaria que a função formata o erro de um schema de teste, e
 * o que importa é que ela formata o erro dos contratos de verdade.
 */
describe('a recusa de campo desconhecido fala português', () => {
  it('um campo: diz qual, e por que não passou', () => {
    const r = EditarItemDoPrograma.safeParse({ chave: 'i1', valor: '50000' })
    expect(r.success).toBe(false)
    if (r.success) return
    // Medido em produção antes desta tradução: `"Unrecognized key(s) in
    // object: 'valor'"`. Inglês, numa tela em português.
    expect(primeiroErro(r.error)).toBe('O campo "valor" não se altera por aqui.')
  })

  it('vários campos: plural, e todos nomeados', () => {
    const r = EditarItemDoPrograma.safeParse({ chave: 'i1', valor: '1', sessoes: 8 })
    expect(r.success).toBe(false)
    if (r.success) return
    const frase = primeiroErro(r.error)
    expect(frase.startsWith('Os campos')).toBe(true)
    expect(frase).toContain('"valor"')
    expect(frase).toContain('"sessoes"')
  })

  it('NOMEIA o campo, e não o VALOR dele', () => {
    // A metade que dá dentes: uma tradução que ecoasse o valor recusado
    // mandaria dinheiro e nome de paciente para a resposta e para o log.
    const r = EditarPrograma.safeParse({
      observacao: 'ok',
      pacienteNome: 'Maria Souza',
      valorTotal: '38000',
    })
    expect(r.success).toBe(false)
    if (r.success) return
    const frase = primeiroErro(r.error)
    expect(frase).not.toContain('Maria Souza')
    expect(frase).not.toContain('38000')
    expect(frase).toContain('"pacienteNome"')
  })

  it('outro tipo de erro continua vindo do contrato, sem reescrita', () => {
    // A tradução vale SÓ para `unrecognized_keys`. As outras mensagens são
    // escritas nos contratos, em português, e sequestrá-las aqui criaria a
    // segunda versão de cada regra.
    const r = EncerrarPrograma.safeParse({ motivo: '' })
    expect(r.success).toBe(false)
    if (r.success) return
    const frase = primeiroErro(r.error)
    expect(frase).not.toContain('não se altera por aqui')
  })

  it('a recusa de "nada a alterar" não é confundida com campo desconhecido', () => {
    const r = EditarPrograma.safeParse({})
    expect(r.success).toBe(false)
    if (r.success) return
    expect(primeiroErro(r.error)).toBe('Nada a alterar.')
  })

  it('sem nenhuma issue, ainda há uma frase — nunca `undefined` na resposta', () => {
    expect(primeiroErro({ issues: [] })).toBe('Confira os campos da tarefa.')
  })
})
