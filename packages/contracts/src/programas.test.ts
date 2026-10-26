import { describe, expect, it } from 'vitest'
import {
  ConcluirSessao,
  EncerrarPrograma,
  MontarPrograma,
  MoverEtapa,
  SalvarProcedimento,
} from './index'

const ID = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

const PROC = {
  nome: 'Tirzepatida',
  sessoesSugeridas: 12,
  intervaloSugeridoDias: 7,
} as const

const ITEM = {
  chave: 'i1',
  procedimentoId: ID,
  sessoes: 4,
  intervaloDias: 7,
} as const

const MONTAR = { pacienteId: ID2, inicio: '2026-11-02', itens: [ITEM] } as const

describe('SalvarProcedimento — o catálogo', () => {
  it('procedimento sem nome é recusado pelo PARSE', () => {
    expect(SalvarProcedimento.safeParse({ ...PROC, nome: '  ' }).success).toBe(false)
  })

  it('sessões fora de 1..104 e intervalo fora de 1..180 são recusados', () => {
    // Os limites são os do `Code.gs` E do protótipo — eles concordam.
    expect(SalvarProcedimento.safeParse({ ...PROC, sessoesSugeridas: 105 }).success).toBe(false)
    expect(SalvarProcedimento.safeParse({ ...PROC, sessoesSugeridas: 0 }).success).toBe(false)
    expect(SalvarProcedimento.safeParse({ ...PROC, intervaloSugeridoDias: 181 }).success).toBe(false)
    expect(SalvarProcedimento.safeParse({ ...PROC, intervaloSugeridoDias: 180 }).success).toBe(true)
  })

  it('retorno em MESES vai até 60; em DIAS até 1825', () => {
    expect(
      SalvarProcedimento.safeParse({ ...PROC, retorno: { quantidade: 61, unidade: 'm' } }).success,
    ).toBe(false)
    expect(
      SalvarProcedimento.safeParse({ ...PROC, retorno: { quantidade: 1825, unidade: 'd' } }).success,
    ).toBe(true)
    expect(
      SalvarProcedimento.safeParse({ ...PROC, retorno: { quantidade: 1826, unidade: 'd' } }).success,
    ).toBe(false)
  })

  it('a antecedência do contato é 0..90, e o padrão é 15', () => {
    const r = SalvarProcedimento.parse({ ...PROC, retorno: { quantidade: 4, unidade: 'm' } })
    expect(r.retorno!.antecedenciaDias).toBe(15)
    expect(
      SalvarProcedimento.safeParse({
        ...PROC,
        retorno: { quantidade: 4, unidade: 'm', antecedenciaDias: 91 },
      }).success,
    ).toBe(false)
  })

  it('A DOSE NÃO ATRAVESSA SEM A UNIDADE', () => {
    // Regra 10: `qtd` sem unidade é a origem da dose errada. Aqui ela nem
    // compila — `.strict()` mais `unidade` obrigatória.
    expect(
      SalvarProcedimento.safeParse({ ...PROC, insumoPadrao: { itemId: ID, quantidade: '2500' } })
        .success,
    ).toBe(false)
    expect(
      SalvarProcedimento.safeParse({
        ...PROC,
        insumoPadrao: { itemId: ID, quantidade: '2500', unidade: 'mg' },
      }).success,
    ).toBe(true)
  })

  it('a dose chega em MILÉSIMOS inteiros, nunca float', () => {
    const r = SalvarProcedimento.parse({
      ...PROC,
      insumoPadrao: { itemId: ID, quantidade: '250', unidade: 'ampola' },
    })
    expect(r.insumoPadrao!.quantidade).toBe(250n)
    // `0,25` é o que o protótipo manda (`insumoQtd: 0.25`). Aqui a borda o
    // recusa: milésimos inteiros, como `quantidadeEmTexto` já exige de todo o
    // sistema.
    expect(
      SalvarProcedimento.safeParse({
        ...PROC,
        insumoPadrao: { itemId: ID, quantidade: '0,25', unidade: 'ampola' },
      }).success,
    ).toBe(false)
  })

  it('dose zero ou negativa é recusada — não existe aplicação de nada', () => {
    for (const q of ['0', '-250']) {
      expect(
        SalvarProcedimento.safeParse({ ...PROC, insumoPadrao: { itemId: ID, quantidade: q, unidade: 'mg' } })
          .success,
      ).toBe(false)
    }
  })

  it('o valor por sessão chega em centavos', () => {
    expect(SalvarProcedimento.parse({ ...PROC, valorPorSessao: '30000' }).valorPorSessao).toBe(
      30000n,
    )
    expect(SalvarProcedimento.safeParse({ ...PROC, valorPorSessao: '300.00' }).success).toBe(false)
    expect(SalvarProcedimento.safeParse({ ...PROC, valorPorSessao: '0' }).success).toBe(false)
  })

  it('os descartáveis também exigem a unidade, e são no máximo 10', () => {
    const d = { itemId: ID, quantidade: '1000', unidade: 'un' }
    expect(SalvarProcedimento.safeParse({ ...PROC, descartaveis: [d] }).success).toBe(true)
    expect(
      SalvarProcedimento.safeParse({ ...PROC, descartaveis: [{ itemId: ID, quantidade: '1000' }] })
        .success,
    ).toBe(false)
    expect(
      SalvarProcedimento.safeParse({ ...PROC, descartaveis: Array(11).fill(d) }).success,
    ).toBe(false)
  })

  it('campo desconhecido é recusado, não descartado em silêncio', () => {
    expect(SalvarProcedimento.safeParse({ ...PROC, planoId: ID }).success).toBe(false)
  })

  it('campo desconhecido DENTRO do retorno também é recusado — nos DOIS ramos', () => {
    // A primeira versão usava `discriminatedUnion(...).and(object(...).strict())`
    // e reprovava TODO retorno válido: numa interseção cada lado valida o
    // objeto inteiro, e com `.strict()` cada um recusa as chaves do outro. É a
    // mesma armadilha que o épico 4 mediu em `RegistrarRecebimento`.
    //
    // A saída errada seria tirar o `.strict()`. Este teste existe para que ela
    // não seja possível: sem ele, `antecedencia` (sem o "Dias") passaria,
    // seria descartado em silêncio, e a clínica acharia ter configurado o
    // contato de retorno que não configurou.
    for (const unidade of ['m', 'd'] as const) {
      expect(
        SalvarProcedimento.safeParse({
          ...PROC,
          retorno: { quantidade: 4, unidade, antecedencia: 30 },
        }).success,
        `ramo ${unidade}`,
      ).toBe(false)
      expect(
        SalvarProcedimento.parse({
          ...PROC,
          retorno: { quantidade: 4, unidade, antecedenciaDias: 30 },
        }).retorno!.antecedenciaDias,
      ).toBe(30)
    }
  })

  it('o rótulo da sessão tem padrão `Sessão`', () => {
    expect(SalvarProcedimento.parse(PROC).rotuloSessao).toBe('Sessão')
  })
})

describe('MontarPrograma — o montador em três entradas', () => {
  it('montar programa com 13 itens é recusado — o limite é 12', () => {
    expect(
      MontarPrograma.safeParse({
        ...MONTAR,
        itens: Array.from({ length: 13 }, (_, i) => ({ ...ITEM, chave: `i${i + 1}` })),
      }).success,
    ).toBe(false)
    expect(
      MontarPrograma.safeParse({
        ...MONTAR,
        itens: Array.from({ length: 12 }, (_, i) => ({ ...ITEM, chave: `i${i + 1}` })),
      }).success,
    ).toBe(true)
  })

  it('sem item nenhum é recusado', () => {
    expect(MontarPrograma.safeParse({ ...MONTAR, itens: [] }).success).toBe(false)
  })

  it('`depoisDe` apontando para item que não existe é recusado', () => {
    const r = MontarPrograma.safeParse({
      ...MONTAR,
      itens: [{ ...ITEM, chave: 'i1', depoisDe: 'ix' }],
    })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r)).toContain('ix')
  })

  it('chave repetida é recusada', () => {
    expect(
      MontarPrograma.safeParse({ ...MONTAR, itens: [ITEM, { ...ITEM, chave: 'i1' }] }).success,
    ).toBe(false)
  })

  it('item que depende de si mesmo é recusado', () => {
    expect(
      MontarPrograma.safeParse({ ...MONTAR, itens: [{ ...ITEM, depoisDe: 'i1' }] }).success,
    ).toBe(false)
  })

  it('o intervalo do ITEM vai até 365 — não 180 como o do catálogo', () => {
    // Os dois limites convivem: 180 em `procedimentos` (é sugestão), 365 em
    // `itens_do_programa` (é o caso real). Mesmos números do protótipo.
    expect(
      MontarPrograma.safeParse({ ...MONTAR, itens: [{ ...ITEM, intervaloDias: 365 }] }).success,
    ).toBe(true)
    expect(
      MontarPrograma.safeParse({ ...MONTAR, itens: [{ ...ITEM, intervaloDias: 366 }] }).success,
    ).toBe(false)
  })

  it('o valor total e a entrada chegam em centavos, e entrada > total é recusada', () => {
    expect(
      MontarPrograma.safeParse({
        ...MONTAR,
        pagamento: { valorTotal: '100000', valorEntrada: '150000', forma: 'Pix' },
      }).success,
    ).toBe(false)
    expect(
      MontarPrograma.safeParse({
        ...MONTAR,
        pagamento: { valorTotal: '100000', valorEntrada: '100000', forma: 'Pix' },
      }).success,
    ).toBe(true)
  })

  it('a entrada tem padrão ZERO — o programa cuja adesão não pagou nada hoje', () => {
    const r = MontarPrograma.parse({
      ...MONTAR,
      pagamento: { valorTotal: '360000', forma: 'Pix' },
    })
    expect(r.pagamento!.valorEntrada).toBe(0n)
  })

  it('SEM `pagamento`, o programa não tem total — cada sessão registra o do dia', () => {
    expect(MontarPrograma.parse(MONTAR).pagamento).toBeUndefined()
  })

  it('forma de pagamento inválida é recusada', () => {
    expect(
      MontarPrograma.safeParse({
        ...MONTAR,
        pagamento: { valorTotal: '100000', forma: 'Boleto' },
      }).success,
    ).toBe(false)
  })

  it('a DOSE do item é texto curto; o INSUMO exige unidade', () => {
    expect(MontarPrograma.safeParse({ ...MONTAR, itens: [{ ...ITEM, dose: '2,5 mg' }] }).success).toBe(
      true,
    )
    expect(
      MontarPrograma.safeParse({
        ...MONTAR,
        itens: [{ ...ITEM, insumo: { itemId: ID, quantidade: '1000' } }],
      }).success,
    ).toBe(false)
    expect(
      MontarPrograma.safeParse({
        ...MONTAR,
        itens: [{ ...ITEM, insumo: { itemId: ID, quantidade: '1000', unidade: 'ampola' } }],
      }).success,
    ).toBe(true)
  })

  it('`campanhaId` é aceito e ignorado pelo serviço — a tabela é do épico 8', () => {
    expect(MontarPrograma.safeParse({ ...MONTAR, campanhaId: ID }).success).toBe(true)
  })
})

describe('ConcluirSessao — o padrão silencioso que move doze aplicações', () => {
  it('concluir sessão EXIGE dizer o que fazer com as próximas', () => {
    // Um padrão silencioso aqui move a agenda de doze aplicações sem ninguém
    // ter pedido. O protótipo pergunta; aqui o parse cobra.
    expect(ConcluirSessao.safeParse({ em: '2026-11-13' }).success).toBe(false)
    expect(ConcluirSessao.safeParse({ em: '2026-11-13', reprogramar: true }).success).toBe(true)
    expect(ConcluirSessao.safeParse({ em: '2026-11-13', reprogramar: false }).success).toBe(true)
  })

  it('a data da realização é obrigatória, e no formato do calendário', () => {
    expect(ConcluirSessao.safeParse({ reprogramar: true }).success).toBe(false)
    expect(ConcluirSessao.safeParse({ em: '13/11/2026', reprogramar: true }).success).toBe(false)
  })

  it('aceita o pagamento embutido — o MESMO schema do épico 2', () => {
    const r = ConcluirSessao.parse({
      em: '2026-11-13',
      reprogramar: false,
      pagamento: { valor: '30000', forma: 'Pix' },
    })
    expect(r.pagamento!.valor).toBe(30000n)
  })
})

describe('EncerrarPrograma', () => {
  it('encerrar programa exige motivo', () => {
    expect(EncerrarPrograma.safeParse({}).success).toBe(false)
    expect(EncerrarPrograma.safeParse({ motivo: '  ' }).success).toBe(false)
    expect(EncerrarPrograma.safeParse({ motivo: 'Paciente desistiu' }).success).toBe(true)
  })
})

describe('`fechar` ganha o início do programa', () => {
  const R = { valor: '120000', forma: 'Pix' } as const

  it('`fechar` aceita o início do programa, e ele é opcional', () => {
    const r = MoverEtapa.parse({
      acao: 'fechar',
      recebimento: R,
      inicioDoPrograma: '2026-11-02',
    })
    expect(r).toMatchObject({ acao: 'fechar', inicioDoPrograma: '2026-11-02' })
    expect(MoverEtapa.safeParse({ acao: 'fechar', recebimento: R }).success).toBe(true)
  })

  it('o início mal formatado é recusado', () => {
    expect(
      MoverEtapa.safeParse({ acao: 'fechar', recebimento: R, inicioDoPrograma: '02/11/2026' })
        .success,
    ).toBe(false)
  })

  it('NENHUMA OUTRA AÇÃO aceita `inicioDoPrograma`', () => {
    // `.strict()` em cada ramo. Sem isto, mandá-lo em `confirmar` seria
    // descartado em silêncio e a recepção acharia que configurou algo.
    expect(
      MoverEtapa.safeParse({ acao: 'confirmar', inicioDoPrograma: '2026-11-02' }).success,
    ).toBe(false)
  })
})
