import { describe, expect, it } from 'vitest'
import { diaCivil } from './relogio'
import { ehErro, ehOk, exigir, type Result } from './resultado'
import {
  instanteDaConclusao,
  podeCancelar,
  podeConcluir,
  podeEditar,
  podeExcluir,
  type Autor,
  type TarefaParaAutorizar,
} from './tarefa'

/**
 * `r.erro.codigo` direto não compila: `Result` é união, e o ramo `ok` não tem
 * `erro`. O ajudante estreita uma vez, aqui, em vez de espalhar `ehErro(r) &&`
 * por trinta asserções — e devolve `'OK'` para que um teste que esperava erro
 * e recebeu sucesso falhe dizendo o que houve.
 */
const codigoDe = (r: Result<unknown>): string => (ehErro(r) ? r.erro.codigo : 'OK')

const ABERTA: TarefaParaAutorizar = {
  solicitanteId: 'ana',
  responsavelId: 'bia',
  status: 'aberta',
}

const ana: Autor = { id: 'ana', podeEquipe: false }
const bia: Autor = { id: 'bia', podeEquipe: false }
const cao: Autor = { id: 'cao', podeEquipe: false }
const sup: Autor = { id: 'sup', podeEquipe: true }

describe('Concluir × Editar — as quatro autorizações', () => {
  it('qualquer um conclui — concluir é registrar que foi feito', () => {
    for (const a of [ana, bia, cao, sup]) expect(ehOk(podeConcluir(ABERTA, a))).toBe(true)
  })

  it('o responsável EDITA mas NÃO EXCLUI', () => {
    expect(ehOk(podeEditar(ABERTA, bia))).toBe(true)
    expect(codigoDe(podeExcluir(ABERTA, bia))).toBe('SO_QUEM_SOLICITOU')
  })

  it('quem não tem nada a ver com a tarefa não edita, não cancela, não exclui', () => {
    expect(codigoDe(podeEditar(ABERTA, cao))).toBe('SEM_ACESSO_A_TAREFA')
    expect(codigoDe(podeCancelar(ABERTA, cao))).toBe('SO_QUEM_SOLICITOU')
    expect(codigoDe(podeExcluir(ABERTA, cao))).toBe('SO_QUEM_SOLICITOU')
  })

  it('quem solicitou faz as quatro', () => {
    for (const f of [podeConcluir, podeCancelar, podeEditar, podeExcluir]) {
      expect(ehOk(f(ABERTA, ana))).toBe(true)
    }
  })

  it('tarefas.equipe faz as quatro', () => {
    for (const f of [podeConcluir, podeCancelar, podeEditar, podeExcluir]) {
      expect(ehOk(f(ABERTA, sup))).toBe(true)
    }
  })

  it('tarefa cancelada não se conclui — e a mensagem diz o que fazer', () => {
    const r = podeConcluir({ ...ABERTA, status: 'cancelada' }, ana)
    expect(codigoDe(r)).toBe('TAREFA_CANCELADA')
    expect(ehErro(r) && r.erro.mensagem).toContain('Reabra')
  })

  it('tarefa já concluída não se conclui de novo nem se cancela', () => {
    const concluida = { ...ABERTA, status: 'concluida' } as const
    expect(codigoDe(podeConcluir(concluida, ana))).toBe('TAREFA_JA_CONCLUIDA')
    expect(codigoDe(podeCancelar(concluida, ana))).toBe('TAREFA_JA_CONCLUIDA')
  })

  it('editar a concluída é permitido — é como se corrige a data de realização', () => {
    // A v20 edita tarefa concluída para acertar data de realização e
    // resultado. Bloquear aqui tiraria da recepção o único jeito de
    // consertar um lançamento retroativo com a data errada.
    expect(ehOk(podeEditar({ ...ABERTA, status: 'concluida' }, bia))).toBe(true)
  })
})

const FUSO = 'America/Bahia'

describe('o instante da conclusão', () => {
  it('concluir HOJE carimba o instante de agora', () => {
    const agora = new Date('2026-10-24T13:05:00Z')
    const r = instanteDaConclusao('2026-10-24', '2026-10-24', FUSO, agora)
    expect(exigir(r)).toEqual(agora)
  })

  it('concluir RETROATIVO cai dentro do dia civil pedido, no fuso da clínica', () => {
    const r = instanteDaConclusao('2026-10-20', '2026-10-24', FUSO, new Date())
    expect(diaCivil(exigir(r), FUSO)).toBe('2026-10-20')
  })

  it('data de realização no FUTURO é recusada', () => {
    const r = instanteDaConclusao('2026-10-25', '2026-10-24', FUSO, new Date())
    expect(codigoDe(r)).toBe('DATA_NO_FUTURO')
  })

  it('o dia civil da clínica é a autoridade, não o UTC', () => {
    // 02:00 UTC de 25/10 ainda é 23:00 de 24/10 em America/Bahia. Concluir
    // "hoje" nesse instante não pode virar um registro do dia 25.
    const agora = new Date('2026-10-25T02:00:00Z')
    expect(diaCivil(agora, FUSO)).toBe('2026-10-24')
    const r = instanteDaConclusao('2026-10-24', diaCivil(agora, FUSO), FUSO, agora)
    expect(ehOk(r)).toBe(true)
  })

  it('o carimbo retroativo sobrevive a um erro de UMA HORA no fuso da clínica', () => {
    // A razão de ser do meio-dia, e o único teste que a separa da meia-noite.
    //
    // Com meia-noite o carimbo encosta na borda: o mesmo instante lido uma
    // hora a oeste já é o dia anterior. Isso não é hipótese — o fuso é
    // propriedade da clínica e pode ser corrigido depois de meses de uso, e
    // uma clínica cadastrada em America/Bahia que na verdade é Manaus veria
    // TODO o histórico retroativo recuar um dia. Meio-dia dá onze horas de
    // folga para cada lado.
    const r = exigir(instanteDaConclusao('2026-10-20', '2026-10-24', FUSO, new Date()))
    for (const vizinho of ['America/Manaus', 'America/Sao_Paulo', 'America/Noronha']) {
      expect(diaCivil(r, vizinho), `lido em ${vizinho}`).toBe('2026-10-20')
    }
  })

  it('o retroativo cai dentro do dia em TODO fuso da federação, e na virada do ano', () => {
    // Meia-noite colocaria o registro no dia vizinho em qualquer fuso a
    // oeste; é por isso que o carimbo é meio-dia e não o começo do dia.
    for (const fuso of ['America/Bahia', 'America/Sao_Paulo', 'America/Manaus', 'America/Rio_Branco']) {
      for (const dia of ['2026-01-01', '2026-02-28', '2026-10-18', '2026-12-31']) {
        const r = instanteDaConclusao(dia, '2027-01-02', fuso, new Date())
        expect(diaCivil(exigir(r), fuso), `${fuso} ${dia}`).toBe(dia)
      }
    }
  })
})
