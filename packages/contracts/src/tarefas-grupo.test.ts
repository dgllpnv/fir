import { describe, expect, it } from 'vitest'
import {
  AssumirTarefa,
  CriarTarefa,
  DefinirGruposDaPessoa,
  EditarGrupoDaEquipe,
  CriarGrupoDaEquipe,
  MAXIMO_DE_GRUPOS_POR_PESSOA,
  NOTA_DO_FLUXO_MAXIMA,
  TransferirTarefa,
} from './index'

const PESSOA = '11111111-1111-4111-8111-111111111111'
const GRUPO = '22222222-2222-4222-8222-222222222222'
const ORIGEM = '33333333-3333-4333-8333-333333333333'

const base = {
  vinculo: 'interna' as const,
  descricao: 'Ligar',
  quando: { modo: 'agendada' as const, prazo: '2026-10-24' },
}

describe('CriarTarefa — destino exclusivo (pessoa OU grupo) e origem', () => {
  it('aceita só pessoa, ou só grupo', () => {
    expect(CriarTarefa.safeParse({ ...base, responsavelId: PESSOA }).success).toBe(true)
    expect(CriarTarefa.safeParse({ ...base, grupoId: GRUPO }).success).toBe(true)
  })

  it('recusa os DOIS e recusa NENHUM, com o caminho do campo', () => {
    const os2 = CriarTarefa.safeParse({ ...base, responsavelId: PESSOA, grupoId: GRUPO })
    expect(os2.success).toBe(false)
    const nenhum = CriarTarefa.safeParse(base)
    expect(nenhum.success).toBe(false)
    if (!nenhum.success) expect(nenhum.error.issues[0]?.path).toEqual(['responsavelId'])
  })

  it('o destino exclusivo vale também no vínculo com paciente', () => {
    const paciente = { ...base, vinculo: 'paciente' as const, pacienteId: PESSOA, tipo: 'Follow-up' }
    expect(CriarTarefa.safeParse({ ...paciente, grupoId: GRUPO }).success).toBe(true)
    expect(CriarTarefa.safeParse({ ...paciente, grupoId: GRUPO, responsavelId: PESSOA }).success).toBe(false)
  })

  it('`tarefaOrigemId` é uuid; lixo é recusado', () => {
    expect(CriarTarefa.safeParse({ ...base, grupoId: GRUPO, tarefaOrigemId: ORIGEM }).success).toBe(true)
    expect(CriarTarefa.safeParse({ ...base, grupoId: GRUPO, tarefaOrigemId: 'nao-e-uuid' }).success).toBe(false)
  })

  it('continua `.strict()`: chave desconhecida não passa em silêncio', () => {
    expect(CriarTarefa.safeParse({ ...base, grupoId: GRUPO, setor: 'x' }).success).toBe(false)
  })
})

describe('Transferir e Assumir', () => {
  it('o destino é uma união discriminada: pessoa OU grupo, nunca os dois campos', () => {
    expect(TransferirTarefa.safeParse({ para: { tipo: 'pessoa', id: PESSOA } }).success).toBe(true)
    expect(TransferirTarefa.safeParse({ para: { tipo: 'grupo', id: GRUPO } }).success).toBe(true)
    expect(TransferirTarefa.safeParse({ para: { tipo: 'grupo', id: GRUPO, extra: 1 } }).success).toBe(false)
    expect(TransferirTarefa.safeParse({ para: { tipo: 'setor', id: GRUPO } }).success).toBe(false)
    expect(TransferirTarefa.safeParse({}).success).toBe(false)
  })

  it('a nota tem até 200 caracteres (e é aparada)', () => {
    const para = { tipo: 'pessoa', id: PESSOA }
    expect(TransferirTarefa.safeParse({ para, nota: 'x'.repeat(NOTA_DO_FLUXO_MAXIMA) }).success).toBe(true)
    expect(TransferirTarefa.safeParse({ para, nota: 'x'.repeat(NOTA_DO_FLUXO_MAXIMA + 1) }).success).toBe(false)
    expect(AssumirTarefa.safeParse({ nota: 'x'.repeat(NOTA_DO_FLUXO_MAXIMA + 1) }).success).toBe(false)
    expect(AssumirTarefa.safeParse({}).success).toBe(true)
    expect(AssumirTarefa.safeParse({ outra: 1 }).success).toBe(false)
  })
})

describe('Grupos de colaboradores — os limites são do contrato', () => {
  it('nome de 2 a 60, aparado', () => {
    expect(CriarGrupoDaEquipe.safeParse({ nome: 'R' }).success).toBe(false)
    expect(CriarGrupoDaEquipe.safeParse({ nome: '  Re  ' }).success).toBe(true)
    expect(CriarGrupoDaEquipe.safeParse({ nome: 'x'.repeat(61) }).success).toBe(false)
  })

  it('editar exige algo para mudar; `confirmar: false` não é confirmação', () => {
    expect(EditarGrupoDaEquipe.safeParse({}).success).toBe(false)
    expect(EditarGrupoDaEquipe.safeParse({ ativo: false }).success).toBe(true)
    expect(EditarGrupoDaEquipe.safeParse({ ativo: false, confirmar: true }).success).toBe(true)
    expect(EditarGrupoDaEquipe.safeParse({ ativo: false, confirmar: false }).success).toBe(false)
  })

  it('o vínculo da pessoa: sem repetidos e no máximo N grupos', () => {
    expect(DefinirGruposDaPessoa.safeParse({ grupoIds: [] }).success).toBe(true)
    expect(DefinirGruposDaPessoa.safeParse({ grupoIds: [GRUPO, GRUPO] }).success).toBe(false)
    const muitos = Array.from({ length: MAXIMO_DE_GRUPOS_POR_PESSOA + 1 }, (_, i) =>
      `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    )
    expect(DefinirGruposDaPessoa.safeParse({ grupoIds: muitos }).success).toBe(false)
  })
})
