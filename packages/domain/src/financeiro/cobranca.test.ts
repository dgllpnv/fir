import { describe, expect, it } from 'vitest'
import {
  MENSAGEM_DE_COBRANCA_PADRAO,
  montarMensagemDeCobranca,
  primeiroNome,
} from './cobranca'

const BASE = { modelo: '', nome: 'Ana Lúcia Souza', eu: 'Juliana Santos', clinica: 'Clínica Vita' }

describe('a mensagem de cobrança', () => {
  it('usa o primeiro nome da paciente e de quem manda', () => {
    const t = montarMensagemDeCobranca(BASE)
    expect(t).toContain('Olá, Ana!')
    expect(t).toContain('Aqui é Juliana')
    expect(t).toContain('Clínica Vita')
    expect(t).not.toContain('Lúcia')
  })

  it('modelo vazio cai no padrão — e o padrão fala de "valor em aberto", sem o valor', () => {
    expect(montarMensagemDeCobranca({ ...BASE, modelo: '   ' })).toContain('valor em aberto')
    // A garantia estrutural: não há como interpolar um número porque não há
    // número na entrada. Se um dia alguém acrescentar `valor` a
    // `DadosDaCobranca`, este teste continua passando — e é por isso que ele
    // está acompanhado do teste de rota, que olha o corpo HTTP.
    expect(MENSAGEM_DE_COBRANCA_PADRAO).not.toMatch(/\d/)
  })

  it('o modelo da clínica vence o padrão', () => {
    const t = montarMensagemDeCobranca({ ...BASE, modelo: '{nome}, passa aqui. — {eu}' })
    expect(t).toBe('Ana, passa aqui. — Juliana')
  })

  it('a mesma marca repetida é trocada nas DUAS ocorrências', () => {
    // `replace` trocaria só a primeira, e a paciente leria "{nome}" na tela.
    const t = montarMensagemDeCobranca({ ...BASE, modelo: '{nome}! Oi, {nome}.' })
    expect(t).toBe('Ana! Oi, Ana.')
  })

  it('nome vazio não quebra a mensagem', () => {
    expect(primeiroNome('')).toBe('')
    expect(primeiroNome('   ')).toBe('')
    expect(montarMensagemDeCobranca({ ...BASE, nome: '' })).toContain('Olá, !')
  })
})
