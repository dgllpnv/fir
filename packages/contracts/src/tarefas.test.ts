import { describe, expect, it } from 'vitest'
import { Cancelar, Concluir, CriarTarefa, EditarTarefa, Quando } from './tarefas'

const UM = '11111111-1111-4111-8111-111111111111'
const OUTRO = '22222222-2222-4222-8222-222222222222'

const INTERNA = {
  vinculo: 'interna',
  responsavelId: UM,
  descricao: 'Conferir estoque',
  quando: { modo: 'agendada', prazo: '2026-10-25' },
}

const COM_PACIENTE = {
  vinculo: 'paciente',
  responsavelId: UM,
  pacienteId: OUTRO,
  tipo: 'Consulta agendada',
  quando: { modo: 'agendada', prazo: '2026-10-25' },
}

const texto = (r: { success: boolean; error?: unknown }): string => JSON.stringify(r.error ?? {})

describe('CriarTarefa — as três formas são exclusivas por construção', () => {
  it('o caminho normal passa, nos dois vínculos', () => {
    expect(CriarTarefa.safeParse(INTERNA).success).toBe(true)
    expect(CriarTarefa.safeParse(COM_PACIENTE).success).toBe(true)
  })

  it('retroativo com série é recusado pelo PARSE, não pelo serviço', () => {
    // O protótipo descobre isso em tempo de execução
    // (`if (t.realizada) return fail("Lançamento retroativo não pode ser
    // recorrente.")`). Aqui a combinação não tem como ser escrita.
    const r = CriarTarefa.safeParse({
      ...INTERNA,
      quando: { modo: 'retroativo', em: '2026-10-20' },
      serie: { freq: 'semanal', ate: '2026-12-01' },
    })
    expect(r.success).toBe(false)
  })

  it('"freq" dentro do ramo retroativo é recusado', () => {
    const r = Quando.safeParse({ modo: 'retroativo', em: '2026-10-20', freq: 'semanal' })
    expect(r.success).toBe(false)
  })

  it('"pagamento" dentro do ramo série é recusado — série não nasce paga', () => {
    const r = Quando.safeParse({
      modo: 'serie',
      inicio: '2026-10-20',
      freq: 'semanal',
      ate: '2026-12-01',
      pagamento: { valor: '45000', forma: 'Pix' },
    })
    expect(r.success).toBe(false)
  })

  it('"a cada X dias" sem o X é recusado, apontando o campo', () => {
    const r = Quando.safeParse({
      modo: 'serie',
      inicio: '2026-10-20',
      freq: 'ndias',
      ate: '2026-12-01',
    })
    expect(r.success).toBe(false)
    expect(texto(r)).toContain('aCadaNDias')
  })

  it('tipo do grupo Pagamentos é recusado ao CRIAR tarefa', () => {
    const r = CriarTarefa.safeParse({ ...COM_PACIENTE, tipo: 'Pagamento de consulta' })
    expect(r.success).toBe(false)
    expect(texto(r)).toContain('Recebimento')
  })

  it('tipo desconhecido é recusado — um acento a menos some com a receita', () => {
    // `Pagamento de orcamento` sem cedilha cairia no fallback de
    // `infoDoTipo`, sem flag nenhuma: a tarefa existiria e o dinheiro não
    // contaria como receita. O parse recusa antes.
    expect(CriarTarefa.safeParse({ ...COM_PACIENTE, tipo: 'Consulta Agendada ' }).success).toBe(
      false,
    )
    expect(CriarTarefa.safeParse({ ...COM_PACIENTE, tipo: 'Qualquer coisa' }).success).toBe(false)
  })

  it('paciente sem tipo de contato é recusado', () => {
    const { tipo: _, ...semTipo } = COM_PACIENTE
    expect(CriarTarefa.safeParse(semTipo).success).toBe(false)
  })

  it('tarefa interna COM tipo ou COM paciente é recusada', () => {
    expect(CriarTarefa.safeParse({ ...INTERNA, tipo: 'Follow-up' }).success).toBe(false)
    expect(CriarTarefa.safeParse({ ...INTERNA, pacienteId: OUTRO }).success).toBe(false)
  })

  it('hora fora de HH:MM é recusada, e 24:00 e 09:60 também', () => {
    for (const hora of ['9:00', '0900', '24:00', '09:60']) {
      const r = CriarTarefa.safeParse({
        ...INTERNA,
        quando: { modo: 'agendada', prazo: '2026-10-25', hora },
      })
      expect(r.success, hora).toBe(false)
    }
    expect(
      CriarTarefa.safeParse({
        ...INTERNA,
        quando: { modo: 'agendada', prazo: '2026-10-25', hora: '09:30' },
      }).success,
    ).toBe(true)
  })

  it('prioridade e observação ganham padrão — a tela não precisa mandá-los', () => {
    const r = CriarTarefa.parse(INTERNA)
    expect(r.prioridade).toBe('normal')
    expect(r.obs).toBe('')
  })
})

describe('Concluir, Cancelar e Editar', () => {
  it('valor do pagamento embutido chega como string de centavos e vira bigint', () => {
    const r = Concluir.parse({ em: '2026-10-24', pagamento: { valor: '45000', forma: 'Pix' } })
    expect(r.pagamento?.valor).toBe(45_000n)
  })

  it('valor com vírgula, ponto ou zero é recusado — nada de float perto de dinheiro', () => {
    for (const valor of ['450,00', '450.00', '0', '-1', '4.5e2']) {
      const r = Concluir.safeParse({ em: '2026-10-24', pagamento: { valor, forma: 'Pix' } })
      expect(r.success, valor).toBe(false)
    }
  })

  it('forma de pagamento fora da lista é recusada', () => {
    const r = Concluir.safeParse({
      em: '2026-10-24',
      pagamento: { valor: '45000', forma: 'Boleto' },
    })
    expect(r.success).toBe(false)
  })

  it('"valor em aberto" aceita zero mas não aceita negativo', () => {
    const base = { em: '2026-10-24', forma: 'Pix' as const }
    expect(
      Concluir.safeParse({
        em: base.em,
        pagamento: { valor: '45000', forma: 'Pix', valorAberto: '0' },
      }).success,
    ).toBe(true)
    expect(
      Concluir.safeParse({
        em: base.em,
        pagamento: { valor: '45000', forma: 'Pix', valorAberto: '-1' },
      }).success,
    ).toBe(false)
  })

  it('editar NÃO conclui: `pagamento` no corpo de edição é recusado', () => {
    const r = EditarTarefa.safeParse({ prazo: '2026-11-05', pagamento: { valor: '1', forma: 'Pix' } })
    expect(r.success).toBe(false)
  })

  it('editar sem `serie` alcança só esta tarefa', () => {
    expect(EditarTarefa.parse({ prazo: '2026-11-05' }).serie).toBe(false)
  })

  it('cancelar aceita só observação — nada de status solto', () => {
    expect(Cancelar.safeParse({ obs: 'paciente desmarcou' }).success).toBe(true)
    expect(Cancelar.safeParse({ status: 'arquivada' }).success).toBe(false)
  })
})
