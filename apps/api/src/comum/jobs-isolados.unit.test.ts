import { describe, expect, it } from 'vitest'
import { codigoDoErro, rodarJobsIsolados } from './jobs-isolados'

describe('rodarJobsIsolados (revisão appsec M1)', () => {
  it('a falha de um job não impede os seguintes; o log leva nome e código, nunca a mensagem', async () => {
    const rodaram: string[] = []
    const log: string[] = []
    const erroDoBanco = Object.assign(new Error('Key (email)=(rita@sol.com) already exists'), { code: '23505' })
    const falharam = await rodarJobsIsolados(
      [
        { nome: 'carteira:uso-diario', rodar: () => Promise.reject(erroDoBanco) },
        {
          nome: 'indicadores-do-dia',
          rodar: async () => {
            rodaram.push('indicadores')
            throw new TypeError('valor 1234,56 do paciente Fulano')
          },
        },
        { nome: 'retencao-do-acesso', rodar: async () => void rodaram.push('retencao') },
      ],
      (l) => log.push(l),
    )
    expect(rodaram).toEqual(['indicadores', 'retencao'])
    expect(falharam).toEqual(['carteira:uso-diario', 'indicadores-do-dia'])
    expect(log).toEqual(['[carteira:uso-diario] falhou: 23505', '[indicadores-do-dia] falhou: TypeError'])
    expect(log.join('\n')).not.toMatch(/rita@sol\.com|1234|Fulano/)
  })

  it('código estranho ou ausente não vaza: só o formato curto passa', () => {
    expect(codigoDoErro({ code: 'a b (rita@sol.com)' })).toBe('desconhecido')
    expect(codigoDoErro('texto solto')).toBe('desconhecido')
    expect(codigoDoErro(new RangeError('x'))).toBe('RangeError')
  })
})
