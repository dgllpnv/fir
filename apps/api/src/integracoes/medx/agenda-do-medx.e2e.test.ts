import type { Relogio } from '@fir/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SincronizacaoDaAgenda } from '../../agenda/sincronizacao'
import { BancoService } from '../../banco/banco.service'
import type { ClinicaId } from '../../banco/clinica-id'
import { PEDIDO_DE_SINCRONIZACAO } from '../../agenda/agenda-externa.service'
import {
  AGORA,
  AMANHA,
  botar,
  type Cenario,
  desmontarCenario,
  FUSO,
  montarCenario,
  pegar,
  postar,
} from '../../tarefas/__tests__/cenario'
import { AberturaDeIntegracoes, SeloDeIntegracoes } from '../cofre-de-integracoes'
import { AgendaDoMedx } from './agenda-do-medx'
import { ErroDoMedx } from './erros'
import { LeitorDoMedx } from './leitor-do-medx'
import type { Pedido, Transporte } from './transporte'

/**
 * A agenda do MedX → cartões (spec integracao-medx B; ticket T4), contra
 * Postgres REAL e um MedX falso em memória. O caminho é o de produção: o
 * `AgendaDoMedx` lê, a conciliação comum (a mesma do iCal) decide.
 *
 * AGORA = 25/10 02:00Z = 24/10 23:00 no relógio do MedX (-03:00).
 */
type Ag = { inicio: string; paciente: number | null; nome?: string; procedimentoId?: number | null; status?: number }

const CHAVE = 'medx_chave_da_agenda_0123456789abcdef'
let c: Cenario
let banco: BancoService
let clinica: ClinicaId
const relogio: { instante: Date } & Relogio = {
  instante: AGORA,
  agora() {
    return this.instante
  },
}

let medx: {
  agenda: Map<number, Ag>
  contatos: Map<number, { celular?: string; telefoneResidencial?: string }>
  porPagina: number
  falharPagina?: number
  falharPorId?: boolean
}
const pedidos: Pedido[] = []
const pedidosDeSincronizacao: string[] = []

const paginaDe = (p: Pedido): string => {
  const de = p.query?.['Inicio'] ?? ''
  const ate = p.query?.['Fim'] ?? ''
  const todos = [...medx.agenda.entries()]
    .filter(([, a]) => a.inicio >= de && a.inicio < ate)
    .sort(([x], [y]) => x - y)
  const n = Number((p.query?.['Cursor'] ?? 'p0').slice(1))
  if (medx.falharPagina !== undefined && n + 1 === medx.falharPagina) throw new ErroDoMedx('indisponivel')
  const fatia = todos.slice(n * medx.porPagina, (n + 1) * medx.porPagina)
  const hasMore = (n + 1) * medx.porPagina < todos.length
  return JSON.stringify({
    items: fatia.map(([id, a]) => ({
      id,
      inicio: a.inicio,
      fim: a.inicio,
      paciente: a.paciente === null ? null : { id: a.paciente, nome: a.nome ?? `Paciente ${a.paciente}` },
      procedimentoId: a.procedimentoId ?? null,
      status: { id: a.status ?? 1, nome: 'Agendado' },
      // Campos que a FIR NUNCA guarda (B.0): se vazarem, os testes acham.
      descricao: 'Botox na testa — paciente ansiosa',
      setor: { id: 3, nome: 'Sala Secreta' },
      profissional: { id: 9, nome: 'Dra. Fulana' },
      versao: 'v-123',
    })),
    page: { limit: medx.porPagina, hasMore, nextCursor: hasMore ? `p${n + 1}` : null },
  })
}

const transporte: Transporte = async (p) => {
  pedidos.push(p)
  if (p.metodo === 'POST' && p.caminho === '/token') {
    return JSON.stringify({ accessToken: 'jwt', expiresInSeconds: 900, scope: 'agenda:read contatos:details:read financas:read' })
  }
  if (p.caminho === '/agenda/agendamentos/detalhes') return paginaDe(p)
  const porId = /^\/agenda\/agendamentos\/(-?\d+)$/.exec(p.caminho)
  if (porId) {
    if (medx.falharPorId) throw new ErroDoMedx('indisponivel')
    const a = medx.agenda.get(Number(porId[1]))
    if (a === undefined) throw new ErroDoMedx('nao_encontrado')
    return JSON.stringify({ id: Number(porId[1]), inicio: a.inicio, status: { id: a.status ?? 1 }, descricao: 'x' })
  }
  const contato = /^\/contatos\/(-?\d+)$/.exec(p.caminho)
  if (contato) {
    const ct = medx.contatos.get(Number(contato[1]))
    if (ct === undefined) throw new ErroDoMedx('nao_encontrado')
    return JSON.stringify({ id: Number(contato[1]), dados: { ...ct, email: 'x@y.z', cpfCnpj: '000' } })
  }
  throw new Error(`rota inesperada ${p.caminho}`)
}

const abertura = AberturaDeIntegracoes.doAmbiente()
const novaSinc = () =>
  new SincronizacaoDaAgenda(banco, relogio, async () => '', new AgendaDoMedx(banco, abertura, new LeitorDoMedx(transporte)))
let sinc: SincronizacaoDaAgenda
const rodar = () => sinc.sincronizarClinica(clinica, FUSO)

const tarefas = async () =>
  (
    await c.migrate.query<{
      id: string
      paciente_id: string
      etapa: string
      prazo: string
      hora: string
      tipo: string
      proximo_passo_em: string | null
      historico: unknown
    }>(
      `SELECT id, paciente_id, etapa::text AS etapa, prazo::text AS prazo, left(hora::text,5) AS hora, tipo,
              proximo_passo_em::text AS proximo_passo_em, historico
         FROM tarefas WHERE clinica_id = $1 ORDER BY criada_em`,
      [c.clinica],
    )
  ).rows
const contar = async (tabela: string) =>
  Number((await c.migrate.query(`SELECT count(*) FROM ${tabela} WHERE clinica_id = $1`, [c.clinica])).rows[0].count)
const chamadas = (prefixo: string) => pedidos.filter((p) => p.caminho.startsWith(prefixo)).length

beforeAll(async () => {
  c = await montarCenario('medx-agenda', [
    { token: PEDIDO_DE_SINCRONIZACAO, valor: { pedir: async (id: string) => void pedidosDeSincronizacao.push(id) } },
  ])
  banco = new BancoService()
  clinica = c.clinica as ClinicaId
})
afterAll(async () => {
  for (const t of ['ciclos_da_agenda_externa', 'pacientes_externos', 'compromissos_externos', 'agendas_externas', 'integracoes_da_clinica']) {
    await c.migrate.query(`DELETE FROM ${t} WHERE clinica_id = ANY($1)`, [[c.clinica, c.outraClinica]])
  }
  await banco.onModuleDestroy()
  await desmontarCenario(c)
})
beforeEach(async () => {
  relogio.instante = AGORA
  sinc = novaSinc()
  pedidos.length = 0
  pedidosDeSincronizacao.length = 0
  medx = { agenda: new Map(), contatos: new Map(), porPagina: 50 }
  for (const t of ['ciclos_da_agenda_externa', 'pacientes_externos', 'compromissos_externos']) {
    await c.migrate.query(`DELETE FROM ${t} WHERE clinica_id = $1`, [c.clinica])
  }
  await c.migrate.query('DELETE FROM recebimentos WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM tarefas WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM agendas_externas WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM integracoes_da_clinica WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM pacientes WHERE clinica_id = $1 AND NOT (id = ANY($2))', [
    c.clinica,
    [c.pacientes['ana'], c.pacientes['bruna']],
  ])
  await c.migrate.query(
    `UPDATE pacientes SET conferir_cadastro = false, ativo = true, desativado_em = NULL, motivo_desativacao = NULL
      WHERE clinica_id = $1`,
    [c.clinica],
  )
  const selo = SeloDeIntegracoes.doAmbiente()
  const s = selo.selar(c.clinica, 'medx', CHAVE)
  await c.migrate.query(
    `INSERT INTO integracoes_da_clinica
       (clinica_id, provedor, segredo_cifrado, segredo_versao, final_da_chave, impressao_da_chave,
        termo_assinado_em, termo_assinado_por, termo_versao, verificacao, verificada_em, conta_externa_id,
        escopos, unidades_externas, agenda_ligada, status_de_cancelado)
     VALUES ($1, 'medx', $2, $3, 'cdef', $4, '2026-10-01', 'Dra. X', 'v1', 'ok', now(), $5,
             '{agenda:read,contatos:details:read,financas:read}', 1, true, '{6}')`,
    [c.clinica, s.cifrado, s.versao, selo.impressao('medx', CHAVE), `conta-${c.clinica}`],
  )
  await c.migrate.query(
    `INSERT INTO agendas_externas (clinica_id, provedor, url_secreta, responsavel_id) VALUES ($1, 'medx', NULL, $2)`,
    [c.clinica, c.pessoas['juliana']],
  )
})

describe('consulta nova', () => {
  it('cria o cartão, cadastra o paciente com o telefone do contato e guarda só HMAC', async () => {
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: 501, nome: 'Carla Nova', procedimentoId: 77 })
    medx.contatos.set(501, { celular: '(71) 97777-1111' })
    const r = await rodar()
    expect(r).toMatchObject({ tipo: 'ok', resumo: { criados: 1, pacientesNovos: 1 } })
    const [t, ...resto] = await tarefas()
    expect(resto).toHaveLength(0)
    expect(t).toMatchObject({ etapa: 'agendado', prazo: AMANHA, hora: '14:00', tipo: 'Procedimento agendado' })
    const p = await c.migrate.query('SELECT nome, telefone, conferir_cadastro FROM pacientes WHERE id = $1', [t!.paciente_id])
    expect(p.rows[0]).toMatchObject({ nome: 'Carla Nova', conferir_cadastro: true })
    expect(p.rows[0].telefone).toMatch(/97777/)

    // Só HMAC e a referência selada: nem o id 1001 nem o 501 em claro.
    const ce = await c.migrate.query('SELECT uid_externo, referencia_cifrada FROM compromissos_externos WHERE clinica_id = $1', [c.clinica])
    expect(ce.rows[0].uid_externo).toMatch(/^h:[0-9a-f]{64}$/)
    expect(ce.rows[0].referencia_cifrada.toString('utf8')).not.toContain('1001')
    const pe = await c.migrate.query('SELECT id_externo_hmac, paciente_id FROM pacientes_externos WHERE clinica_id = $1', [c.clinica])
    expect(pe.rows).toEqual([{ id_externo_hmac: expect.stringMatching(/^h:[0-9a-f]{64}$/), paciente_id: t!.paciente_id }])

    // Lista branca (B.0): descrição, setor e profissional nunca chegam ao banco, nem à trilha.
    const tudo = JSON.stringify([
      await tarefas(),
      (await c.migrate.query('SELECT de, para FROM auditoria WHERE clinica_id = $1', [c.clinica])).rows,
    ])
    for (const proibido of ['Botox', 'Sala Secreta', 'Fulana', 'v-123', '"1001"', '"501"']) expect(tudo).not.toContain(proibido)
  })

  it('paciente já vinculado pelo id do MedX: zero chamadas a /contatos', async () => {
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: 501, nome: 'Carla Nova' })
    medx.contatos.set(501, { celular: '(71) 97777-1111' })
    await rodar()
    expect(chamadas('/contatos')).toBe(1)
    pedidos.length = 0
    medx.agenda.set(1002, { inicio: '2026-10-27T09:00:00', paciente: 501, nome: 'Carla N.' })
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { criados: 1, pacientesNovos: 0 } })
    expect(chamadas('/contatos')).toBe(0)
    const ts = await tarefas()
    expect(ts[1]!.paciente_id).toBe(ts[0]!.paciente_id)
    expect(ts[1]!.tipo).toBe('Consulta agendada')
  })

  it('paciente da FIR encontrado pelo telefone do contato: liga, não cadastra outro', async () => {
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: 777, nome: 'Ana L. Souza' })
    medx.contatos.set(777, { telefoneResidencial: '71 98888-7777' })
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { criados: 1, pacientesNovos: 0 } })
    expect((await tarefas())[0]!.paciente_id).toBe(c.pacientes['ana'])
    // O nome do MedX nunca substitui o da ficha.
    const p = await c.migrate.query('SELECT nome FROM pacientes WHERE id = $1', [c.pacientes['ana']])
    expect(p.rows[0].nome).toBe('Ana Lúcia Souza')
  })

  it('três leituras iguais não criam nada novo (idempotência, B.5)', async () => {
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: 501, nome: 'Carla Nova' })
    medx.agenda.set(1002, { inicio: '2026-11-30T10:00:00', paciente: 502, nome: 'Dora Lima' })
    for (let i = 0; i < 3; i++) expect(await rodar()).toMatchObject({ tipo: 'ok' })
    expect(await tarefas()).toHaveLength(2)
    expect(await contar('compromissos_externos')).toBe(2)
    expect(await contar('pacientes_externos')).toBe(2)
    expect(await contar('ciclos_da_agenda_externa')).toBe(3)
  })

  it('agendamento sem paciente (bloqueio) não vira cartão', async () => {
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: null })
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { criados: 0, ignorados: 1 } })
  })
})

describe('mudanças na agenda', () => {
  const comCartao = async () => {
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: 501, nome: 'Carla Nova' })
    await rodar()
    pedidos.length = 0
  }

  it('remarcou dentro da janela: reagenda o cartão', async () => {
    await comCartao()
    medx.agenda.set(1001, { inicio: '2026-10-28T16:30:00', paciente: 501, nome: 'Carla Nova' })
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { reagendados: 1, desmarcados: 0 } })
    expect((await tarefas())[0]).toMatchObject({ prazo: '2026-10-28', hora: '16:30', etapa: 'agendado' })
  })

  it('remarcou para +75 dias: confirma pelo id e REAGENDA, não desmarca (B.4)', async () => {
    await comCartao()
    medx.agenda.set(1001, { inicio: '2027-01-08T10:00:00', paciente: 501, nome: 'Carla Nova' })
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { reagendados: 1, desmarcados: 0 } })
    expect((await tarefas())[0]).toMatchObject({ prazo: '2027-01-08', hora: '10:00', etapa: 'agendado' })
    expect(chamadas('/agenda/agendamentos/1001')).toBe(1)
    // No ciclo seguinte está fora da janela e não é pedido de novo.
    pedidos.length = 0
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { desmarcados: 0 } })
    expect(chamadas('/agenda/agendamentos/1001')).toBe(0)
  })

  it('cancelou (status configurado): o cartão vai para Recontatar, nunca cancelado', async () => {
    await comCartao()
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: 501, nome: 'Carla Nova', status: 6 })
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { desmarcados: 1 } })
    const t = (await tarefas())[0]!
    expect(t.etapa).not.toBe('cancelado')
    expect(t.proximo_passo_em).not.toBeNull()
  })

  it('sumiu da lista e o id responde 404: desmarca como removido', async () => {
    await comCartao()
    medx.agenda.set(2000, { inicio: '2026-10-26T08:00:00', paciente: 600, nome: 'Outra' })
    medx.agenda.delete(1001)
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { desmarcados: 1 } })
    expect(chamadas('/agenda/agendamentos/1001')).toBe(1)
  })

  it('sumiu, mas a confirmação por id falhou: não decide, fica para o próximo ciclo', async () => {
    await comCartao()
    medx.agenda.set(2000, { inicio: '2026-10-26T08:00:00', paciente: 600, nome: 'Outra' })
    medx.agenda.delete(1001)
    medx.falharPorId = true
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { desmarcados: 0 } })
    expect((await tarefas())[0]!.etapa).toBe('agendado')
  })

  it('janela vazia e o id responde 404: é MedX quebrado — aborta, nada desmarcado (B.2)', async () => {
    await comCartao()
    medx.agenda.clear()
    const r = await rodar()
    expect(r).toMatchObject({ tipo: 'falhou' })
    expect(r.tipo === 'falhou' && r.erro).toMatch(/vazia/)
    expect((await tarefas())[0]!.etapa).toBe('agendado')
    const ce = await c.migrate.query('SELECT removido_em FROM compromissos_externos WHERE clinica_id = $1', [c.clinica])
    expect(ce.rows[0].removido_em).toBeNull()
  })

  it('a página 3 de 5 falha: nenhum cartão, e o ciclo fica registrado como falha (B.2, B.12)', async () => {
    medx.porPagina = 1
    for (let i = 0; i < 5; i++) medx.agenda.set(3000 + i, { inicio: `2026-10-2${5 + i}T10:00:00`, paciente: 700 + i })
    medx.falharPagina = 3
    expect(await rodar()).toMatchObject({ tipo: 'falhou' })
    expect(await tarefas()).toHaveLength(0)
    expect(await contar('pacientes')).toBe(2)
    const ciclo = await c.migrate.query('SELECT resultado, paginas FROM ciclos_da_agenda_externa WHERE clinica_id = $1', [c.clinica])
    expect(ciclo.rows).toEqual([{ resultado: 'falhou', paginas: 2 }])
    const ag = await c.migrate.query('SELECT ultimo_erro FROM agendas_externas WHERE clinica_id = $1', [c.clinica])
    expect(ag.rows[0].ultimo_erro).toMatch(/fora do ar/)
  })
})

describe('paciente desativado (B.7, D-L1)', () => {
  it('desativado não volta: nem pelo id do MedX, nem pelo telefone, nem pelo nome — três leituras', async () => {
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: 501, nome: 'Carla Nova' })
    medx.contatos.set(501, { celular: '(71) 97777-1111' })
    await rodar()
    const carla = (await tarefas())[0]!.paciente_id
    await c.migrate.query(
      `UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'pediu-para-sair' WHERE id = $1`,
      [carla],
    )
    const antes = { tarefas: (await tarefas()).length, pacientes: await contar('pacientes') }

    medx.agenda.set(1002, { inicio: '2026-10-27T09:00:00', paciente: 501, nome: 'Carla Nova' }) // mesmo id
    medx.agenda.set(1003, { inicio: '2026-10-28T09:00:00', paciente: 9501, nome: 'C. Nova' }) // outro id, mesmo telefone
    medx.contatos.set(9501, { celular: '71 97777-1111' })
    medx.agenda.set(1004, { inicio: '2026-10-29T09:00:00', paciente: 9502, nome: 'Carla Nova' }) // outro id, mesmo nome
    for (let i = 0; i < 3; i++) {
      expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { criados: 0, pacienteDesativado: 3 } })
    }
    expect((await tarefas()).length).toBe(antes.tarefas)
    expect(await contar('pacientes')).toBe(antes.pacientes)
    const reativada = await c.migrate.query('SELECT ativo FROM pacientes WHERE id = $1', [carla])
    expect(reativada.rows[0].ativo).toBe(false)
  })

  it('a supressão (vínculo sem paciente) também bloqueia', async () => {
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: 501, nome: 'Carla Nova' })
    await rodar()
    await c.migrate.query(
      `UPDATE pacientes_externos SET paciente_id = NULL, suprimido_em = now() WHERE clinica_id = $1`,
      [c.clinica],
    )
    medx.agenda.set(1002, { inicio: '2026-10-27T09:00:00', paciente: 501, nome: 'Carla Nova' })
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { criados: 0, pacienteDesativado: 1 } })
  })
})

describe('tetos, registro e liga/desliga', () => {
  it('no máximo 50 chamadas a /contatos por ciclo; o resto entra no ciclo seguinte (B.0)', async () => {
    for (let i = 0; i < 55; i++) {
      medx.agenda.set(5000 + i, { inicio: '2026-10-26T10:00:00', paciente: 8000 + i, nome: `Pessoa Numero ${i}` })
    }
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { criados: 50 } })
    expect(chamadas('/contatos')).toBe(50)
    pedidos.length = 0
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { criados: 5, desmarcados: 0 } })
    expect(chamadas('/contatos')).toBe(5)
  })

  it('o registro do ciclo tem janela e contagens, e nada de id nem nome (B.12)', async () => {
    medx.agenda.set(1001, { inicio: '2026-10-25T14:00:00', paciente: 501, nome: 'Carla Nova' })
    await rodar()
    const r = await c.migrate.query(
      `SELECT agendamentos_lidos, paginas, chamadas_de_contato, confirmacoes_por_id, resultado,
              janela_ate - janela_de AS dias
         FROM ciclos_da_agenda_externa WHERE clinica_id = $1`,
      [c.clinica],
    )
    expect(r.rows).toEqual([
      { agendamentos_lidos: 1, paginas: 2, chamadas_de_contato: 1, confirmacoes_por_id: 0, resultado: 'ok', dias: { days: 60 } },
    ])
    // Duas janelas, nenhuma acima de 31 dias, no relógio do MedX (B.1).
    const janelas = pedidos.filter((p) => p.caminho === '/agenda/agendamentos/detalhes').map((p) => [p.query?.['Inicio'], p.query?.['Fim']])
    expect(janelas).toEqual([
      ['2026-10-24T00:00:00', '2026-11-24T00:00:00'],
      ['2026-11-24T00:00:00', '2026-12-23T00:00:00'],
    ])
  })

  it('integração desligada no painel: a agenda do MedX não é lida', async () => {
    await c.migrate.query('UPDATE integracoes_da_clinica SET agenda_ligada = false WHERE clinica_id = $1', [c.clinica])
    expect(await rodar()).toEqual({ tipo: 'sem-agenda' })
    expect(pedidos).toHaveLength(0)
  })
})

describe('a tela da clínica com o MedX (B.9, B.10, D.1)', () => {
  it('lê "MedX", sem link; e o link iCal é recusado enquanto o MedX estiver ligado', async () => {
    const r = await pegar(c, '/v1/agenda-externa', {}, 'beatriz')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ configurada: true, provedor: 'medx', ativa: true, urlMascarada: '' })
    const put = await botar(c, '/v1/agenda-externa', {
      url: 'https://exemplo.test/agenda.ics',
      responsavelId: c.pessoas['juliana'],
      ativa: true,
    }, 'beatriz')
    expect(put.status).toBe(409)
    expect(put.body.message).toMatch(/MedX/)
    const ag = await c.migrate.query('SELECT provedor, url_secreta FROM agendas_externas WHERE clinica_id = $1', [c.clinica])
    expect(ag.rows[0]).toEqual({ provedor: 'medx', url_secreta: null })
  })

  it('a clínica vê os ciclos do MedX, o mais recente primeiro, só em contagens (D.1)', async () => {
    await c.migrate.query('DELETE FROM ciclos_da_agenda_externa WHERE clinica_id = $1', [c.clinica])
    for (let h = 0; h < 12; h++) {
      await c.migrate.query(
        `INSERT INTO ciclos_da_agenda_externa
           (clinica_id, provedor, janela_de, janela_ate, agendamentos_lidos, paginas, chamadas_de_contato,
            confirmacoes_por_id, resultado, em)
         VALUES ($1, 'medx', '2026-11-16T03:00:00Z', '2027-01-15T03:00:00Z', $2, 1, 0, 0, 'ok',
                 '2026-11-16T00:00:00Z'::timestamptz + make_interval(hours => $2))`,
        [c.clinica, h],
      )
    }
    const r = await pegar(c, '/v1/agenda-externa', {}, 'beatriz')
    expect(r.body.ciclos).toHaveLength(10)
    expect(r.body.ciclos[0]).toEqual({
      em: '2026-11-16T11:00:00.000Z',
      janelaDe: '2026-11-16T03:00:00.000Z',
      janelaAte: '2027-01-15T03:00:00.000Z',
      agendamentosLidos: 11,
      paginas: 1,
      chamadasDeContato: 0,
      confirmacoesPorId: 0,
      resultado: 'ok',
    })
  })

  it('"Sincronizar agora" do MedX: 1 a cada 2 minutos por clínica, no servidor (S-12)', async () => {
    expect((await postar(c, '/v1/agenda-externa/sincronizar', {}, 'beatriz')).status).toBe(202)
    const segundo = await postar(c, '/v1/agenda-externa/sincronizar', {}, 'beatriz')
    expect(segundo.status).toBe(429)
    expect(pedidosDeSincronizacao).toHaveLength(1)
    await c.migrate.query(
      `UPDATE agendas_externas SET sincronizacao_pedida_em = now() - interval '3 minutes' WHERE clinica_id = $1`,
      [c.clinica],
    )
    expect((await postar(c, '/v1/agenda-externa/sincronizar', {}, 'beatriz')).status).toBe(202)
  })

  it('MedX desligado no painel: a tela mostra desligada, e a clínica pode voltar ao iCal com o link', async () => {
    await c.migrate.query(
      `UPDATE integracoes_da_clinica SET agenda_ligada = false WHERE clinica_id = $1`,
      [c.clinica],
    )
    expect((await pegar(c, '/v1/agenda-externa', {}, 'beatriz')).body).toMatchObject({ provedor: 'medx', ativa: false })
    const semLink = await botar(c, '/v1/agenda-externa', { responsavelId: c.pessoas['juliana'], ativa: true }, 'beatriz')
    expect(semLink.status).toBe(400)
    const put = await botar(c, '/v1/agenda-externa', {
      url: 'https://exemplo.test/agenda.ics',
      responsavelId: c.pessoas['juliana'],
      ativa: true,
    }, 'beatriz')
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({ provedor: 'ical', ativa: true })
  })
})
