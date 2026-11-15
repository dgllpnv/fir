import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { ehErro, ehOk, type Result } from './resultado'
import {
  type Autor,
  podeAssumir,
  podeCancelar,
  podeConcluir,
  podeEditar,
  podeExcluir,
  podeTransferir,
  type TarefaParaAutorizar,
} from './tarefa'

const codigoDe = (r: Result<unknown>): string => (ehErro(r) ? r.erro.codigo : 'OK')

const DO_GRUPO: TarefaParaAutorizar = {
  solicitanteId: 'ana',
  responsavelId: null,
  grupoId: 'recepcao',
  status: 'aberta',
}
const DE_PESSOA: TarefaParaAutorizar = {
  solicitanteId: 'ana',
  responsavelId: 'bia',
  grupoId: null,
  status: 'aberta',
}

const membro: Autor = { id: 'mia', podeEquipe: false, grupoIds: ['recepcao', 'outro'] }
const deOutroGrupo: Autor = { id: 'noe', podeEquipe: false, grupoIds: ['enfermagem'] }
const semGrupo: Autor = { id: 'cao', podeEquipe: false }
const solicitante: Autor = { id: 'ana', podeEquipe: false }
const equipe: Autor = { id: 'sup', podeEquipe: true }

describe('tarefa de GRUPO — quem conclui, assume e transfere (S3)', () => {
  it('só membro do grupo ou tarefas.equipe conclui', () => {
    expect(ehOk(podeConcluir(DO_GRUPO, membro))).toBe(true)
    expect(ehOk(podeConcluir(DO_GRUPO, equipe))).toBe(true)
    expect(codigoDe(podeConcluir(DO_GRUPO, deOutroGrupo))).toBe('SO_DO_GRUPO')
    expect(codigoDe(podeConcluir(DO_GRUPO, semGrupo))).toBe('SO_DO_GRUPO')
    // Nem o solicitante: quem pediu para o grupo não é quem fez.
    expect(codigoDe(podeConcluir(DO_GRUPO, solicitante))).toBe('SO_DO_GRUPO')
  })

  it('tarefa de PESSOA continua como era: qualquer um conclui', () => {
    for (const a of [membro, deOutroGrupo, semGrupo, solicitante, equipe]) {
      expect(ehOk(podeConcluir(DE_PESSOA, a))).toBe(true)
    }
  })

  it('assumir: membro ou equipe, só tarefa de grupo e aberta', () => {
    expect(ehOk(podeAssumir(DO_GRUPO, membro))).toBe(true)
    expect(ehOk(podeAssumir(DO_GRUPO, equipe))).toBe(true)
    expect(codigoDe(podeAssumir(DO_GRUPO, deOutroGrupo))).toBe('SO_DO_GRUPO')
    expect(codigoDe(podeAssumir(DE_PESSOA, equipe))).toBe('TAREFA_NAO_E_DE_GRUPO')
    expect(codigoDe(podeAssumir({ ...DO_GRUPO, status: 'concluida' }, membro))).toBe(
      'TAREFA_NAO_ESTA_ABERTA',
    )
  })

  it('transferir: responsável, membro do grupo atual ou equipe; só aberta', () => {
    expect(ehOk(podeTransferir(DE_PESSOA, { id: 'bia', podeEquipe: false }))).toBe(true)
    expect(ehOk(podeTransferir(DO_GRUPO, membro))).toBe(true)
    expect(ehOk(podeTransferir(DE_PESSOA, equipe))).toBe(true)
    // O solicitante de tarefa de pessoa NÃO transfere (o spec diz quem pode).
    expect(codigoDe(podeTransferir(DE_PESSOA, solicitante))).toBe('SO_QUEM_TEM_A_TAREFA')
    expect(codigoDe(podeTransferir(DO_GRUPO, deOutroGrupo))).toBe('SO_QUEM_TEM_A_TAREFA')
    expect(codigoDe(podeTransferir({ ...DE_PESSOA, status: 'cancelada' }, equipe))).toBe(
      'TAREFA_NAO_ESTA_ABERTA',
    )
  })

  it('grupo DESATIVADO: quem criou a tarefa a transfere, e só ele (além da equipe)', () => {
    const presa = { ...DO_GRUPO, grupoAtivo: false }
    expect(ehOk(podeTransferir(presa, solicitante))).toBe(true)
    expect(ehOk(podeTransferir(presa, equipe))).toBe(true)
    expect(codigoDe(podeTransferir(presa, semGrupo))).toBe('SO_QUEM_TEM_A_TAREFA')
    // Com o grupo ATIVO o solicitante não ganha nada por ter criado.
    expect(codigoDe(podeTransferir(DO_GRUPO, solicitante))).toBe('SO_QUEM_TEM_A_TAREFA')
  })

  it('editar: o membro edita a tarefa do seu grupo; o de fora não', () => {
    expect(ehOk(podeEditar(DO_GRUPO, membro))).toBe(true)
    expect(ehOk(podeEditar(DO_GRUPO, solicitante))).toBe(true)
    expect(codigoDe(podeEditar(DO_GRUPO, deOutroGrupo))).toBe('SEM_ACESSO_A_TAREFA')
    expect(codigoDe(podeEditar(DO_GRUPO, semGrupo))).toBe('SEM_ACESSO_A_TAREFA')
  })

  it('membro NÃO cancela nem exclui (solicitante ou equipe)', () => {
    expect(codigoDe(podeCancelar(DO_GRUPO, membro))).toBe('SO_QUEM_SOLICITOU')
    expect(codigoDe(podeExcluir(DO_GRUPO, membro))).toBe('SO_QUEM_SOLICITOU')
    expect(ehOk(podeCancelar(DO_GRUPO, solicitante))).toBe(true)
  })

  it('responsável null nunca casa com um autor (nem com id vazio)', () => {
    const vazio: Autor = { id: '', podeEquipe: false }
    expect(codigoDe(podeEditar(DO_GRUPO, vazio))).toBe('SEM_ACESSO_A_TAREFA')
  })
})

describe('propriedade: pertencer é só do grupo da tarefa', () => {
  const idArb = fc.constantFrom('g1', 'g2', 'g3', 'g4')

  it('conclui a tarefa de grupo ⇔ o grupo dela está nos grupos do autor, ou equipe', () => {
    fc.assert(
      fc.property(
        idArb,
        fc.array(idArb, { maxLength: 4 }),
        fc.boolean(),
        (grupo, grupos, podeEquipe) => {
          const t: TarefaParaAutorizar = {
            solicitanteId: 's',
            responsavelId: null,
            grupoId: grupo,
            status: 'aberta',
          }
          const a: Autor = { id: 'x', podeEquipe, grupoIds: grupos }
          expect(ehOk(podeConcluir(t, a))).toBe(grupos.includes(grupo) || podeEquipe)
          expect(ehOk(podeAssumir(t, a))).toBe(grupos.includes(grupo) || podeEquipe)
        },
      ),
    )
  })

  it('autor sem grupoIds nunca ganha acesso por grupo (falha fechado)', () => {
    fc.assert(
      fc.property(idArb, (grupo) => {
        const t: TarefaParaAutorizar = {
          solicitanteId: 's',
          responsavelId: null,
          grupoId: grupo,
          status: 'aberta',
        }
        const a: Autor = { id: 'x', podeEquipe: false }
        expect(ehErro(podeConcluir(t, a))).toBe(true)
        expect(ehErro(podeEditar(t, a))).toBe(true)
        expect(ehErro(podeTransferir(t, a))).toBe(true)
      }),
    )
  })
})
