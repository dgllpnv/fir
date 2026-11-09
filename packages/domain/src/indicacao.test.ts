import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decidirIndicacao, MENSAGEM_AUTOINDICACAO } from './indicacao'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('decidirIndicacao — "indicado por" liga a uma paciente (B2)', () => {
  it('recusa a autoindicação, sem nome na mensagem (L-B2-9)', () => {
    const r = decidirIndicacao(A, { indicadoPorId: A })
    expect(r).toEqual({
      tipo: 'erro',
      erro: { codigo: 'AUTOINDICACAO', mensagem: MENSAGEM_AUTOINDICACAO },
    })
    expect(MENSAGEM_AUTOINDICACAO).toBe('Uma paciente não pode indicar a si mesma.')
  })

  it('com a indicadora ligada pelo id, o texto vai vazio (L-B2-3), mesmo que tenha vindo', () => {
    expect(decidirIndicacao(A, { indicadoPorId: B, indicadoPor: 'Fulana' })).toEqual({
      tipo: 'ok',
      valor: { indicadoPorId: B, indicadoPor: '' },
    })
    // No cadastro a paciente ainda não tem id: não há como indicar a si mesma.
    expect(decidirIndicacao(null, { indicadoPorId: B })).toEqual({
      tipo: 'ok',
      valor: { indicadoPorId: B, indicadoPor: '' },
    })
  })

  it('texto livre preenchido solta o vínculo: quem indicou não é paciente', () => {
    expect(decidirIndicacao(A, { indicadoPor: 'Dona Lurdes da padaria' })).toEqual({
      tipo: 'ok',
      valor: { indicadoPorId: null, indicadoPor: 'Dona Lurdes da padaria' },
    })
  })

  it('ausente mantém; `null` remove', () => {
    // Nada pedido sobre a indicação: nada muda (a edição que só troca o telefone).
    expect(decidirIndicacao(A, {})).toEqual({ tipo: 'ok', valor: {} })
    // Texto vazio sem id: não decide o vínculo — quem tem vínculo já tem texto ''.
    expect(decidirIndicacao(A, { indicadoPor: '' })).toEqual({
      tipo: 'ok',
      valor: { indicadoPor: '' },
    })
    expect(decidirIndicacao(A, { indicadoPorId: null })).toEqual({
      tipo: 'ok',
      valor: { indicadoPorId: null },
    })
  })

  it('propriedade: nunca sai id e texto não vazio juntos, e nunca o próprio id', () => {
    const id = fc.constantFrom(A, B)
    fc.assert(
      fc.property(
        fc.option(id, { nil: null }),
        fc.option(fc.option(id, { nil: null }), { nil: undefined }),
        fc.option(fc.string({ maxLength: 10 }), { nil: undefined }),
        (proprio, indicadoPorId, indicadoPor) => {
          const pedido = {
            ...(indicadoPorId === undefined ? {} : { indicadoPorId }),
            ...(indicadoPor === undefined ? {} : { indicadoPor }),
          }
          const r = decidirIndicacao(proprio, pedido)
          if (r.tipo === 'erro') {
            expect(proprio).not.toBeNull()
            expect(indicadoPorId).toBe(proprio)
            return
          }
          const v = r.valor
          if (typeof v.indicadoPorId === 'string') {
            expect(v.indicadoPor).toBe('')
            expect(v.indicadoPorId).not.toBe(proprio)
          }
          if (v.indicadoPor !== undefined && v.indicadoPor !== '') {
            expect(v.indicadoPorId).toBeNull()
          }
        },
      ),
    )
  })
})
