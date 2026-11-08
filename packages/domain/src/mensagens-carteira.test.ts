import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  type EntradaDaMensagemDoCliente,
  descricaoDoBeneficio,
  linkDoWhatsAppComTexto,
  montarMensagemDoCliente,
  montarMensagemDoLead,
  origemDoContato,
  preencherMensagem,
  telefoneParaWhatsApp,
  tratamento,
  validarTextoDaMensagem,
  vencimentoAPartirDe,
} from './mensagens-carteira'
import { ehErro, ehOk } from './resultado'

/** `mensagensPadrao` (protótipo L835), o lembrete de pagamento. */
const PAGAMENTO =
  'Olá, {responsavel}! Tudo bem? Aqui é a {remetente}, da Firmare.\nPassando para lembrar que a mensalidade de {mes}, no valor de {valor}, vence no dia {vencimento}.\n\nDados para pagamento:\nPix: {pix}\nFavorecido: {favorecido}\n\nSe o pagamento já foi feito, pode desconsiderar esta mensagem. Obrigada!'

const PIX = 'pix-secreto@firmare.com.br'

const base = (extra: Partial<EntradaDaMensagemDoCliente> = {}): EntradaDaMensagemDoCliente => ({
  modelo: { chave: 'pagamento', texto: PAGAMENTO },
  cliente: {
    nome: 'Clínica Pontes',
    decisor: 'Dra. Raphaella Pontes',
    telefone: '(71) 99999-1201',
    linkPainel: null,
    linkDashFin: 'https://exemplo.com/fin',
    linkDashInd: null,
    linkRotina: null,
  },
  remetente: 'Manu',
  dia: '2026-11-07',
  diaDoVencimento: 10,
  pagamento: { mensalidadeCentavos: 280000n, telefoneCobranca: null, chavePix: PIX },
  favorecido: 'Firmare Gestão Empresarial',
  frente: null,
  parceiro: null,
  pendencias: '',
  ...extra,
})

const exigirOk = <T>(r: { tipo: 'ok'; valor: T } | { tipo: 'erro'; erro: unknown }): T => {
  if (r.tipo !== 'ok') throw new Error('esperava ok')
  return r.valor
}

describe('preencherMensagem — uma passada só (appsec A-14)', () => {
  it('troca as variáveis do modelo e preserva as quebras de linha', () => {
    expect(preencherMensagem('Olá, {a}!\n\nTchau {b}.', { a: 'Ana', b: 'Bia' }, 'modelo')).toBe('Olá, Ana!\n\nTchau Bia.')
  })

  it('um lead chamado {pix} sai {pix}, nunca a chave', () => {
    const t = preencherMensagem('Olá, {nome}! Pix: {pix}', { nome: '{pix}', pix: PIX }, 'roteiro')
    expect(t).toBe(`Olá, {pix}! Pix: ${PIX}`)
    const so = preencherMensagem('Olá, {nome}!', { nome: '{pix}', pix: PIX }, 'roteiro')
    expect(so).toBe('Olá, {pix}!')
    expect(so).not.toContain(PIX)
  })

  it('variável desconhecida e chave do protótipo de Object viram vazio', () => {
    expect(preencherMensagem('a{x}b{constructor}c{toString}', {}, 'modelo')).toBe('abc')
  })

  it('trecho [[…]] some sem a variável e aparece com ela (roteiro)', () => {
    const t = 'Oi.[[ {indicador} indicou.]] Fim.'
    expect(preencherMensagem(t, { indicador: '' }, 'roteiro')).toBe('Oi. Fim.')
    expect(preencherMensagem(t, { indicador: 'Bruna' }, 'roteiro')).toBe('Oi. Bruna indicou. Fim.')
  })

  it('modelo não interpreta [[…]] (preencherMsg do protótipo, L2573)', () => {
    expect(preencherMensagem('[[ {a} ]]', { a: '' }, 'modelo')).toBe('[[ ]]')
  })

  it('PROPRIEDADE: nenhum valor injetado é expandido de novo, em nenhum dos dois modos', () => {
    const pedaco = fc.oneof(
      fc.string(),
      fc.constantFrom('{pix}', '{valor}', '[[', ']]', '[[ {pix} ]]', '{nome}', '{{pix}}', '{constructor}'),
    )
    const valorDoUsuario = fc.array(pedaco, { maxLength: 6 }).map((p) => p.join(''))
    fc.assert(
      fc.property(valorDoUsuario, fc.constantFrom('modelo' as const, 'roteiro' as const), (v, modo) => {
        const segredo = 'SEGREDO-PIX-9f3a'
        const t = preencherMensagem('A {nome} B', { nome: v, pix: segredo, valor: segredo }, modo)
        const esperado =
          modo === 'roteiro'
            ? `A ${v} B`.replace(/\s{2,}/g, ' ').trim()
            : `A ${v} B`.replace(/[ \t]{2,}/g, ' ').trim()
        expect(t).toBe(esperado)
        expect(t.includes(segredo)).toBe(v.includes(segredo))
      }),
      { numRuns: 500 },
    )
  })
})

describe('tratamento (trat, L2421)', () => {
  it.each([
    ['Dra. Larissa Moura', 'Dra. Larissa'],
    ['Dr Henrique Sales', 'Dr Henrique'],
    ['Carol Oliveira', 'Carol'],
    ['  ', ''],
  ])('%s → %s', (n, t) => expect(tratamento(n)).toBe(t))
})

describe('telefone para wa.me (A-14)', () => {
  it('normaliza como o fone() do protótipo', () => {
    expect(telefoneParaWhatsApp('(71) 99999-1201')).toBe('5571999991201')
    expect(telefoneParaWhatsApp('+55 71 99999-1201')).toBe('5571999991201')
  })

  it.each(['71999991201?text=oi', '71 9999/1201', '7199999&1201', 'abc71999991201', '123'])(
    'recusa %s em vez de limpar',
    (t) => expect(telefoneParaWhatsApp(t)).toBeNull(),
  )

  it('codifica o texto inteiro no link', () => {
    expect(linkDoWhatsAppComTexto('71999991201', 'a&b=c?\nd')).toBe(
      'https://wa.me/5571999991201?text=a%26b%3Dc%3F%0Ad',
    )
    expect(linkDoWhatsAppComTexto(null, 'x')).toBeNull()
  })

  it('PROPRIEDADE: o link nunca carrega parâmetro além de text', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (tel, texto) => {
        const l = linkDoWhatsAppComTexto(tel, texto)
        if (l === null) return
        const u = new URL(l)
        expect(u.hostname).toBe('wa.me')
        expect([...u.searchParams.keys()]).toEqual(['text'])
        expect(u.searchParams.get('text')).toBe(texto)
        expect(u.pathname).toMatch(/^\/\d{10,15}$/)
      }),
      { numRuns: 500 },
    )
  })
})

describe('vencimentoAPartirDe (regra 25)', () => {
  it('no mês, ou no seguinte se já passou', () => {
    expect(vencimentoAPartirDe('2026-11-07', 10)).toBe('2026-11-10')
    expect(vencimentoAPartirDe('2026-11-10', 10)).toBe('2026-11-10')
    expect(vencimentoAPartirDe('2026-11-11', 10)).toBe('2026-12-10')
  })
  it('dia 31 cai no último dia do mês curto', () => {
    expect(vencimentoAPartirDe('2027-02-01', 31)).toBe('2027-02-28')
    expect(vencimentoAPartirDe('2028-02-01', 30)).toBe('2028-02-29')
    expect(vencimentoAPartirDe('2026-04-01', 31)).toBe('2026-04-30')
  })
  it('sem dia no cadastro, o próprio dia', () => {
    expect(vencimentoAPartirDe('2026-11-07', null)).toBe('2026-11-07')
  })
})

describe('descricaoDoBeneficio — sem ponto flutuante', () => {
  it.each([
    [1000n, '10% de desconto na mensalidade seguinte'],
    [1050n, '10,5% de desconto na mensalidade seguinte'],
    [1005n, '10,05% de desconto na mensalidade seguinte'],
  ])('%s', (p, t) => expect(descricaoDoBeneficio(p)).toBe(t))
})

describe('montarMensagemDoCliente (msgTarefa, L2574)', () => {
  it('com valores: valor, vencimento, mês, Pix e favorecido', () => {
    const m = exigirOk(montarMensagemDoCliente(base()))
    expect(m.texto).toContain('Olá, Dra. Raphaella! Tudo bem? Aqui é a Manu, da Firmare.')
    expect(m.texto).toContain('mensalidade de novembro, no valor de R$ 2.800,00, vence no dia 10/11.')
    expect(m.texto).toContain(`Pix: ${PIX}`)
    expect(m.texto).toContain('Favorecido: Firmare Gestão Empresarial')
    expect(m.telefone).toBe('5571999991201')
    expect(m.destinatario).toBe('cliente')
    expect(m.restrita).toBe(false)
  })

  it('o lembrete vai para o telefone de cobrança quando houver', () => {
    const m = exigirOk(
      montarMensagemDoCliente(base({ pagamento: { mensalidadeCentavos: 1n, telefoneCobranca: '71 98888-0000', chavePix: PIX } })),
    )
    expect(m.telefone).toBe('5571988880000')
    expect(m.destinatario).toBe('cobranca')
  })

  it('PROPRIEDADE (T-21, LGPD A35): sem valores, nenhum R$ nem chave Pix, e sem telefone', () => {
    // O dado do usuário não traz "R$" nem a chave por conta própria: o que se
    // prova é que a MONTAGEM não os põe lá.
    const nomeDeGente = fc.string().filter((s) => !s.includes('R$') && !s.includes(PIX))
    fc.assert(
      fc.property(nomeDeGente, nomeDeGente, (decisor, nome) => {
        const m = exigirOk(
          montarMensagemDoCliente(
            base({ pagamento: 'restrito', cliente: { ...base().cliente, decisor, nome: `${nome}{valor}{pix}` } }),
          ),
        )
        expect(m.texto).not.toContain('R$')
        expect(m.texto).not.toContain(PIX)
        expect(m.restrita).toBe(true)
        expect(m.telefone).toBeNull()
        expect(m.avisos.some((a) => a.includes('restritos'))).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  it('sem valores, modelo sem dinheiro sai normal', () => {
    const m = exigirOk(
      montarMensagemDoCliente(
        base({ pagamento: 'restrito', modelo: { chave: 'fluxo', texto: 'Olá, {responsavel}! {link_dash_financeiro} de {mes_ref}' } }),
      ),
    )
    expect(m.restrita).toBe(false)
    expect(m.telefone).toBe('5571999991201')
    expect(m.texto).toBe('Olá, Dra. Raphaella! https://exemplo.com/fin de outubro')
  })

  it('avisa o que falta no cadastro', () => {
    const m = exigirOk(
      montarMensagemDoCliente(
        base({
          modelo: { chave: 'acessos', texto: '{link_painel} {pix}' },
          pagamento: { mensalidadeCentavos: null, telefoneCobranca: null, chavePix: null },
          cliente: { ...base().cliente, telefone: null },
        }),
      ),
    )
    expect(m.avisos).toEqual([
      'Falta cadastrar o link "Painel do cliente" no cadastro de Clínica Pontes.',
      'Falta cadastrar a chave Pix da Firmare em Método, na tela Mensagens.',
      'Falta o WhatsApp de Clínica Pontes no cadastro.',
    ])
    expect(m.texto).toBe('(link a cadastrar) (chave Pix a cadastrar)')
    expect(m.telefone).toBeNull()
  })

  it('telefone com ? no cadastro não vira link', () => {
    const m = exigirOk(montarMensagemDoCliente(base({ cliente: { ...base().cliente, telefone: '71999991201?text=x' } })))
    expect(m.telefone).toBeNull()
    expect(m.avisos.at(-1)).toContain('não é um telefone válido')
  })

  it('mensagem ao parceiro usa o WhatsApp e o formulário da frente', () => {
    const m = exigirOk(
      montarMensagemDoCliente(
        base({
          modelo: { chave: 'formulario', texto: 'Olá, {parceiro}! {frente} ({cliente}): {link_form}' },
          frente: 'trafego',
          parceiro: { nome: 'Agência X', whatsapp: '71 97777-0000', linkFormulario: 'https://f.com', naoContatar: false },
        }),
      ),
    )
    expect(m.texto).toBe('Olá, Agência X! tráfego pago (Clínica Pontes): https://f.com')
    expect(m.destinatario).toBe('parceiro')
    expect(m.telefone).toBe('5571977770000')
  })

  it('parceiro com nao_contatar recusa (A37)', () => {
    const r = montarMensagemDoCliente(
      base({ frente: 'comercial', parceiro: { nome: 'P', whatsapp: '71977770000', linkFormulario: null, naoContatar: true } }),
    )
    expect(ehErro(r) && r.erro.codigo).toBe('NAO_CONTATAR')
  })
})

describe('montarMensagemDoLead (msgWA, L2442)', () => {
  const PRIMEIRO =
    'Olá, {nome}! Tudo bem? Aqui é a {remetente}, da Firmare Gestão Empresarial. {origem_do_contato} Qual o melhor dia?'
  const lead = {
    nome: 'Dra. Larissa Moura',
    especialidade: 'Dermatologia',
    produtoInteresse: 'Acelerador FIR',
    origem: 'Indicação de cliente',
    indicador: 'Dra. Raphaella Pontes',
    whatsapp: '(71) 99999-1201',
    naoContatar: false,
  }

  it('primeiro contato diz de onde veio (A39)', () => {
    const m = exigirOk(
      montarMensagemDoLead({ roteiro: { chave: 'primeiro', mensagem: PRIMEIRO }, lead, remetente: 'Clena', beneficio: 'x' }),
    )
    expect(m.texto).toBe(
      'Olá, Dra. Larissa! Tudo bem? Aqui é a Clena, da Firmare Gestão Empresarial. Dra. Raphaella Pontes me passou seu contato e falou muito bem do seu trabalho. Qual o melhor dia?',
    )
    expect(m.telefone).toBe('5571999991201')
    const insta = exigirOk(
      montarMensagemDoLead({
        roteiro: { chave: 'primeiro', mensagem: PRIMEIRO },
        lead: { ...lead, origem: 'Instagram', indicador: null },
        remetente: 'Clena',
        beneficio: 'x',
      }),
    )
    expect(insta.texto).toContain('pelo Instagram')
  })

  it('nao_contatar recusa (A37)', () => {
    const r = montarMensagemDoLead({
      roteiro: { chave: 'primeiro', mensagem: PRIMEIRO },
      lead: { ...lead, naoContatar: true },
      remetente: 'C',
      beneficio: '',
    })
    expect(ehErro(r) && r.erro.codigo).toBe('NAO_CONTATAR')
  })

  it('lead chamado {pix} não expande nada', () => {
    const m = exigirOk(
      montarMensagemDoLead({
        roteiro: { chave: 'agendar', mensagem: 'Olá, {nome}! {beneficio}' },
        lead: { ...lead, nome: '{beneficio}' },
        remetente: 'C',
        beneficio: '10% de desconto',
      }),
    )
    expect(m.texto).toBe('Olá, {beneficio}! 10% de desconto')
  })

  it('origemDoContato sempre devolve uma frase', () => {
    fc.assert(
      fc.property(fc.string(), fc.option(fc.string(), { nil: null }), (o, i) => {
        expect(origemDoContato(o, i).length).toBeGreaterThan(10)
      }),
    )
  })
})

describe('validarTextoDaMensagem', () => {
  it('recusa variável desconhecida sem ecoar o texto', () => {
    const r = validarTextoDaMensagem('Olá {nmoe}', 'roteiro', null)
    expect(ehErro(r) && r.erro.codigo).toBe('VARIAVEL_DESCONHECIDA')
    expect(ehErro(r) && r.erro.mensagem).not.toContain('nmoe')
  })
  it('modelo não aceita variável de roteiro e vice-versa', () => {
    expect(ehErro(validarTextoDaMensagem('{nome}', 'modelo', null))).toBe(true)
    expect(ehErro(validarTextoDaMensagem('{valor}', 'roteiro', null))).toBe(true)
    expect(ehOk(validarTextoDaMensagem('{valor} {pix}', 'modelo', null))).toBe(true)
  })
  it('primeiro contato exige {origem_do_contato} (A39)', () => {
    const r = validarTextoDaMensagem('Olá, {nome}!', 'roteiro', 'primeiro')
    expect(ehErro(r) && r.erro.codigo).toBe('ORIGEM_OBRIGATORIA')
    expect(ehOk(validarTextoDaMensagem('Olá, {nome}! {origem_do_contato}', 'roteiro', 'primeiro'))).toBe(true)
  })
})
