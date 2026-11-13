import type { Relogio } from '@fir/domain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import {
  AGORA,
  AMANHA,
  type Cenario,
  desmontarCenario,
  FUSO,
  HOJE,
  montarCenario,
  postar,
} from '../tarefas/__tests__/cenario'
import { PEDIDO_DE_SINCRONIZACAO } from './agenda-externa.service'
import { FalhaAoBaixar } from './baixar-feed'
import { SincronizacaoDaAgenda } from './sincronizacao'

/**
 * A sincronização da agenda contra Postgres REAL (ADR 0019).
 *
 * O feed é de mentira (o baixador devolve o texto que o teste manda); o resto
 * é o caminho de produção inteiro: RLS, trigger de auditoria, transação,
 * tabela de transições. AGORA = 25/10 02:00Z = 24/10 23:00 na Bahia, então
 * "amanhã 14:00" é 25/10 17:00Z.
 */
let c: Cenario
let banco: BancoService
let feed: string | Error
const relogio: { instante: Date } & Relogio = {
  instante: AGORA,
  agora() {
    return this.instante
  },
}
const pedidos: string[] = []
let sinc: SincronizacaoDaAgenda

const URL_SECRETA = 'https://calendar.google.com/calendar/ical/x%40group/private-TOKEN-SECRETO-9f3a/basic.ics'

const cal = (...eventos: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//teste//PT', ...eventos, 'END:VCALENDAR'].join('\r\n')
const ev = (uid: string, inicio: string, titulo: string, extra: string[] = []) =>
  ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${inicio}`, `SUMMARY:${titulo}`, ...extra, 'END:VEVENT'].join('\r\n')

/** Amanhã (25/10) 14:00 na Bahia. */
const AMANHA_14H = '20261025T170000Z'
const AMANHA_15H30 = '20261025T183000Z'
const DEPOIS_16H = '20261027T190000Z'

const rodar = () => sinc.sincronizarClinica(c.clinica as ClinicaId, FUSO)

type Linha = {
  id: string
  paciente_id: string
  etapa: string
  status: string
  prazo: string
  hora: string | null
  tipo: string
  responsavel_id: string
  unidade_id: string | null
  proximo_passo_em: string | null
  excluida_em: Date | null
  historico: { acao: string; porId: string; nota?: string }[]
}
const tarefas = async (): Promise<Linha[]> =>
  (
    await c.migrate.query<Linha>(
      `SELECT id, paciente_id, etapa::text AS etapa, status, prazo::text AS prazo, left(hora::text,5) AS hora,
              tipo, responsavel_id, unidade_id, proximo_passo_em::text AS proximo_passo_em, excluida_em, historico
         FROM tarefas WHERE clinica_id = $1 ORDER BY criada_em`,
      [c.clinica],
    )
  ).rows

beforeAll(async () => {
  c = await montarCenario('agenda', [
    { token: PEDIDO_DE_SINCRONIZACAO, valor: { pedir: async (id: string) => void pedidos.push(id) } },
  ])
  banco = new BancoService()
  sinc = new SincronizacaoDaAgenda(banco, relogio, async () => {
    if (feed instanceof Error) throw feed
    return feed
  })
})
afterAll(async () => {
  await c.migrate.query('DELETE FROM compromissos_externos WHERE clinica_id = ANY($1)', [[c.clinica, c.outraClinica]])
  await c.migrate.query('DELETE FROM agendas_externas WHERE clinica_id = ANY($1)', [[c.clinica, c.outraClinica]])
  await banco.onModuleDestroy()
  await desmontarCenario(c)
})
beforeEach(async () => {
  relogio.instante = AGORA
  feed = cal()
  pedidos.length = 0
  await c.migrate.query('DELETE FROM compromissos_externos WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM recebimentos WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM tarefas WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM agendas_externas WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM pacientes WHERE clinica_id = $1 AND NOT (id = ANY($2))', [
    c.clinica,
    [c.pacientes['ana'], c.pacientes['bruna']],
  ])
  await c.migrate.query('UPDATE pacientes SET conferir_cadastro = false WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query(
    `INSERT INTO agendas_externas (clinica_id, url_secreta, responsavel_id) VALUES ($1, $2, $3)`,
    [c.clinica, URL_SECRETA, c.pessoas['juliana']],
  )
})

describe('compromisso novo', () => {
  it('cria o cartão agendado, com dia e hora no fuso da clínica, ligado pelo nome exato', async () => {
    feed = cal(ev('a1', AMANHA_14H, 'ana lucia souza - Consulta'))
    const r = await rodar()
    expect(r).toMatchObject({ tipo: 'ok', resumo: { criados: 1, pacientesNovos: 0 } })
    const [t, ...resto] = await tarefas()
    expect(resto).toHaveLength(0)
    expect(t).toMatchObject({
      paciente_id: c.pacientes['ana'],
      etapa: 'agendado',
      status: 'aberta',
      prazo: AMANHA,
      hora: '14:00',
      tipo: 'Consulta agendada',
      responsavel_id: c.pessoas['juliana'],
      // A unidade principal da paciente, como na criação manual.
      unidade_id: c.unidades['pituba'],
    })
    // Decisão do dono: não conta na meta de ninguém.
    expect(t!.historico).toEqual([expect.objectContaining({ acao: 'agendar', porId: 'sistema' })])
  })

  it('o telefone vence o nome: "Ana" com o telefone da Ana Lúcia é a Ana Lúcia', async () => {
    feed = cal(ev('a2', AMANHA_14H, 'Ana - Retorno', ['DESCRIPTION:Telefone: +55 71 98888-7777']))
    await rodar()
    expect((await tarefas())[0]!.paciente_id).toBe(c.pacientes['ana'])
  })

  it('paciente desconhecida é cadastrada com nome e telefone, e marcada para conferir', async () => {
    feed = cal(ev('a3', AMANHA_14H, 'Carla Nova (71) 97777-1111 - Procedimento'))
    const r = await rodar()
    expect(r).toMatchObject({ tipo: 'ok', resumo: { criados: 1, pacientesNovos: 1 } })
    const t = (await tarefas())[0]!
    expect(t.tipo).toBe('Procedimento agendado')
    const p = await c.migrate.query('SELECT nome, telefone, conferir_cadastro FROM pacientes WHERE id = $1', [
      t.paciente_id,
    ])
    expect(p.rows[0]).toEqual({ nome: 'Carla Nova', telefone: '71977771111', conferir_cadastro: true })
  })

  it('isolamento: a homônima da clínica vizinha NÃO é usada — a RLS não a mostra', async () => {
    feed = cal(ev('a4', AMANHA_14H, 'Vizinha Secreta'))
    await rodar()
    const t = (await tarefas())[0]!
    expect(t.paciente_id).not.toBe(c.pacienteDaOutra)
    const p = await c.migrate.query('SELECT clinica_id FROM pacientes WHERE id = $1', [t.paciente_id])
    expect(p.rows[0]!.clinica_id).toBe(c.clinica)
  })

  it('ignora almoço, dia inteiro, compromisso passado e cancelado que nunca existiu', async () => {
    feed = cal(
      ev('i1', AMANHA_14H, 'ALMOÇO'),
      ['BEGIN:VEVENT', 'UID:i2', 'DTSTART;VALUE=DATE:20261026', 'SUMMARY:Bruna Martins', 'END:VEVENT'].join('\r\n'),
      ev('i3', '20261020T170000Z', 'Bruna Martins'),
      ev('i4', AMANHA_14H, 'Bruna Martins', ['STATUS:CANCELLED']),
    )
    const r = await rodar()
    expect(r).toMatchObject({ tipo: 'ok', resumo: { criados: 0, ignorados: 2 } })
    expect(await tarefas()).toHaveLength(0)
  })

  it('idempotente: o mesmo feed três vezes cria um cartão só', async () => {
    feed = cal(ev('a5', AMANHA_14H, 'Bruna Martins'), ev('a6', DEPOIS_16H, 'Carla Nova 71977771111'))
    await rodar()
    await rodar()
    const r = await rodar()
    expect(r).toMatchObject({ tipo: 'ok', resumo: { criados: 0, reagendados: 0, desmarcados: 0, vistos: 2 } })
    expect(await tarefas()).toHaveLength(2)
    const n = await c.migrate.query('SELECT count(*)::int AS n FROM pacientes WHERE clinica_id = $1', [c.clinica])
    expect(n.rows[0]!.n).toBe(3)
  })
})

describe('compromisso que muda', () => {
  it('hora mudou: o MESMO cartão é reagendado, e um confirmado volta a agendado', async () => {
    feed = cal(ev('m1', AMANHA_14H, 'Bruna Martins'))
    await rodar()
    const id = (await tarefas())[0]!.id
    const conf = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'confirmar' }, 'juliana')
    expect(conf.statusCode, JSON.stringify(conf.body)).toBe(200)

    feed = cal(ev('m1', AMANHA_15H30, 'Bruna Martins'))
    const r = await rodar()
    expect(r).toMatchObject({ tipo: 'ok', resumo: { reagendados: 1 } })
    const [t, ...resto] = await tarefas()
    expect(resto).toHaveLength(0)
    expect(t).toMatchObject({ id, etapa: 'agendado', prazo: AMANHA, hora: '15:30' })
    expect(t!.historico.at(-1)).toMatchObject({ acao: 'reagendar', porId: 'sistema' })
    expect(t!.historico.at(-1)!.nota).toContain('14:00')
  })

  it('removido da agenda: vai para desmarcou e entra em Recontatar hoje', async () => {
    feed = cal(ev('r1', AMANHA_14H, 'Bruna Martins'), ev('r2', DEPOIS_16H, 'Ana Lúcia Souza'))
    await rodar()
    feed = cal(ev('r2', DEPOIS_16H, 'Ana Lúcia Souza'))
    const r = await rodar()
    expect(r).toMatchObject({ tipo: 'ok', resumo: { desmarcados: 1 } })
    const bruna = (await tarefas()).find((t) => t.paciente_id === c.pacientes['bruna'])!
    expect(bruna).toMatchObject({ etapa: 'desmarcou', status: 'aberta', proximo_passo_em: HOJE })
    expect(bruna.historico.at(-1)).toMatchObject({ acao: 'desmarcar', porId: 'sistema' })
    // E a rodada seguinte não desmarca de novo.
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { desmarcados: 0 } })
  })

  it('cancelado na agenda: desmarcou também', async () => {
    feed = cal(ev('k1', AMANHA_14H, 'Bruna Martins'))
    await rodar()
    feed = cal(ev('k1', AMANHA_14H, 'Bruna Martins', ['STATUS:CANCELLED']))
    await rodar()
    expect((await tarefas())[0]!.etapa).toBe('desmarcou')
  })
})

describe('cartão de orçamento com itens (CHECK itens_so_com_etapa)', () => {
  it('a agenda reagenda ou remove o compromisso: o cartão em orçamento fica como está, sem 500', async () => {
    feed = cal(ev('o1', AMANHA_14H, 'Bruna Martins'))
    await rodar()
    const id = (await tarefas())[0]!.id
    const proc = await c.migrate.query<{ id: string }>(
      'SELECT id FROM procedimentos WHERE clinica_id = $1 LIMIT 1',
      [c.clinica],
    )
    await c.migrate.query(
      `UPDATE tarefas SET etapa = 'orcamento', status = 'concluida', concluida_em = now(),
              valor_orcamento = 100000,
              itens_orcamento = $2::jsonb
        WHERE id = $1`,
      [id, JSON.stringify([{ chave: 'a', procedimentoId: proc.rows[0]!.id, valor: '100000' }])],
    )

    feed = cal(ev('o1', AMANHA_15H30, 'Bruna Martins'))
    expect(await rodar()).toMatchObject({ tipo: 'ok' })
    feed = cal(ev('o1', AMANHA_15H30, 'Bruna Martins', ['STATUS:CANCELLED']))
    expect(await rodar()).toMatchObject({ tipo: 'ok' })
    feed = cal(ev('outro-o1', DEPOIS_16H, 'Ana Lúcia Souza'))
    expect(await rodar()).toMatchObject({ tipo: 'ok' })

    const depois = await c.migrate.query<{ etapa: string; itens: unknown }>(
      'SELECT etapa::text AS etapa, itens_orcamento AS itens FROM tarefas WHERE id = $1',
      [id],
    )
    expect(depois.rows[0]!.etapa).toBe('orcamento')
    expect(depois.rows[0]!.itens).toHaveLength(1)
  })
})

describe('o que a recepção fez à mão vence', () => {
  it('no-show marcado à mão não é desfeito por uma mudança de horário', async () => {
    feed = cal(ev('n1', AMANHA_14H, 'Bruna Martins'))
    await rodar()
    const id = (await tarefas())[0]!.id
    const ns = await postar(c, `/v1/tarefas/${id}/jornada`, { acao: 'noshow' }, 'juliana')
    expect(ns.statusCode, JSON.stringify(ns.body)).toBe(200)

    feed = cal(ev('n1', AMANHA_15H30, 'Bruna Martins'))
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { reagendados: 0 } })
    feed = cal(ev('outro', DEPOIS_16H, 'Ana Lúcia Souza'))
    expect(await rodar()).toMatchObject({ tipo: 'ok', resumo: { desmarcados: 0 } })
    expect((await tarefas()).find((t) => t.id === id)).toMatchObject({ etapa: 'faltou', hora: '14:00' })
  })

  it('cartão excluído à mão nunca é recriado', async () => {
    feed = cal(ev('x1', AMANHA_14H, 'Bruna Martins'))
    await rodar()
    const id = (await tarefas())[0]!.id
    const ex = await c.app.inject({
      method: 'DELETE',
      url: `/v1/tarefas/${id}`,
      cookies: Object.fromEntries(
        c.cookies['beatriz']!.map((k) => k.split(';')[0]!.split('=') as [string, string]),
      ),
    })
    expect(ex.statusCode, ex.body).toBeLessThan(300)
    await rodar()
    await rodar()
    const vivas = (await tarefas()).filter((t) => t.excluida_em === null)
    expect(vivas).toHaveLength(0)
  })
})

describe('salvaguardas', () => {
  it('feed vazio com compromisso futuro conhecido: aborta, não desmarca, e a tela vê o erro', async () => {
    feed = cal(ev('v1', AMANHA_14H, 'Bruna Martins'))
    await rodar()
    feed = cal()
    const r = await rodar()
    expect(r.tipo).toBe('falhou')
    expect((await tarefas())[0]!.etapa).toBe('agendado')
    const a = await c.migrate.query('SELECT ultimo_erro FROM agendas_externas WHERE clinica_id = $1', [c.clinica])
    expect(a.rows[0]!.ultimo_erro).toContain('vazio')
  })

  it('link que falha não muda nada e registra a mensagem — sem o link', async () => {
    feed = cal(ev('f1', AMANHA_14H, 'Bruna Martins'))
    await rodar()
    feed = new FalhaAoBaixar('O link da agenda respondeu 404: confira se ele ainda é válido.')
    expect((await rodar()).tipo).toBe('falhou')
    expect((await tarefas())[0]!.etapa).toBe('agendado')
    const a = await c.migrate.query('SELECT ultimo_erro FROM agendas_externas WHERE clinica_id = $1', [c.clinica])
    expect(a.rows[0]!.ultimo_erro).toContain('404')
    expect(a.rows[0]!.ultimo_erro).not.toContain('TOKEN')
  })

  it('a trilha de auditoria nunca guarda o link', async () => {
    const r = await c.migrate.query<{ txt: string }>(
      `SELECT coalesce(de::text,'') || coalesce(para::text,'') AS txt FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'agendas_externas'`,
      [c.clinica],
    )
    expect(r.rows.length).toBeGreaterThan(0)
    for (const l of r.rows) expect(l.txt).not.toContain('TOKEN-SECRETO')
  })

  it('agenda desligada: nada acontece', async () => {
    await c.migrate.query('UPDATE agendas_externas SET ativa = false WHERE clinica_id = $1', [c.clinica])
    feed = cal(ev('d1', AMANHA_14H, 'Bruna Martins'))
    expect((await rodar()).tipo).toBe('sem-agenda')
    expect(await tarefas()).toHaveLength(0)
  })
})

describe('conferir cadastro', () => {
  it('a marca aparece na lista de pacientes e no cartão, e salvar a ficha a limpa', async () => {
    feed = cal(ev('c1', AMANHA_14H, 'Carla Nova 71977771111'))
    await rodar()
    const t = (await tarefas())[0]!
    const hoje = await c.app.inject({
      method: 'GET',
      url: `/v1/tarefas?escopo=equipe&de=${HOJE}&ate=${AMANHA}`,
      cookies: Object.fromEntries(c.cookies['beatriz']!.map((k) => k.split(';')[0]!.split('=') as [string, string])),
    })
    expect(hoje.body).toContain('"pacienteConferirCadastro":true')

    const salvar = await c.app.inject({
      method: 'PATCH',
      url: `/v1/pacientes/${t.paciente_id}`,
      payload: { telefone: '(71) 97777-1111' },
      cookies: Object.fromEntries(c.cookies['beatriz']!.map((k) => k.split(';')[0]!.split('=') as [string, string])),
    })
    expect(salvar.statusCode, salvar.body).toBe(200)
    expect(JSON.parse(salvar.body)).toMatchObject({ conferirCadastro: false })
  })
})

describe('rotas de configuração', () => {
  const pedir = (method: 'GET' | 'PUT' | 'POST', url: string, quem: string, payload?: object) =>
    c.app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload }),
      cookies: Object.fromEntries(c.cookies[quem]!.map((k) => k.split(';')[0]!.split('=') as [string, string])),
    })

  it('sem `config`, 403 nas três', async () => {
    expect((await pedir('GET', '/v1/agenda-externa', 'juliana')).statusCode).toBe(403)
    expect((await pedir('PUT', '/v1/agenda-externa', 'juliana', { responsavelId: c.pessoas['juliana'], ativa: true })).statusCode).toBe(403)
    expect((await pedir('POST', '/v1/agenda-externa/sincronizar', 'juliana')).statusCode).toBe(403)
  })

  it('o link nunca volta inteiro, e trocar só o responsável mantém o link', async () => {
    const g = await pedir('GET', '/v1/agenda-externa', 'beatriz')
    expect(g.statusCode).toBe(200)
    expect(g.body).not.toContain('TOKEN-SECRETO')
    expect(JSON.parse(g.body)).toMatchObject({ configurada: true, urlMascarada: 'https://calendar.google.com/….ics' })

    const p = await pedir('PUT', '/v1/agenda-externa', 'beatriz', { responsavelId: c.pessoas['beatriz'], ativa: true })
    expect(p.statusCode, p.body).toBe(200)
    expect(p.body).not.toContain('TOKEN-SECRETO')
    const url = await c.migrate.query('SELECT url_secreta FROM agendas_externas WHERE clinica_id = $1', [c.clinica])
    expect(url.rows[0]!.url_secreta).toBe(URL_SECRETA)
  })

  it('webcal vira https; http e responsável de outra clínica são recusados', async () => {
    const ok = await pedir('PUT', '/v1/agenda-externa', 'beatriz', {
      url: 'webcal://agenda.exemplo.com/novo.ics',
      responsavelId: c.pessoas['juliana'],
      ativa: true,
    })
    expect(ok.statusCode, ok.body).toBe(200)
    const url = await c.migrate.query('SELECT url_secreta FROM agendas_externas WHERE clinica_id = $1', [c.clinica])
    expect(url.rows[0]!.url_secreta).toBe('https://agenda.exemplo.com/novo.ics')

    const http = await pedir('PUT', '/v1/agenda-externa', 'beatriz', {
      url: 'http://agenda.exemplo.com/x.ics',
      responsavelId: c.pessoas['juliana'],
      ativa: true,
    })
    expect(http.statusCode).toBe(400)
    const outra = await c.migrate.query<{ id: string }>('SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1', [
      c.outraClinica,
    ])
    if (outra.rows[0] !== undefined) {
      const viz = await pedir('PUT', '/v1/agenda-externa', 'beatriz', { responsavelId: outra.rows[0].id, ativa: true })
      expect(viz.statusCode).toBe(400)
    }
  })

  it('Sincronizar agora enfileira a clínica da SESSÃO', async () => {
    const r = await pedir('POST', '/v1/agenda-externa/sincronizar', 'beatriz')
    expect(r.statusCode, r.body).toBe(202)
    expect(pedidos).toEqual([c.clinica])
  })
})
