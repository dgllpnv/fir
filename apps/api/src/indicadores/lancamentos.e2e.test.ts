import { LancamentoDeKpiNaSaida, type TarefaNaLista } from '@fir/contracts'
import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { MetadataScanner, ModulesContainer } from '@nestjs/core'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SISTEMA } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import {
  apagar,
  botar,
  remendar,
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'
import { gerarTarefasDeLancamento } from './lancamentos-tarefas'

/**
 * Indicadores & Insights — T3: KPI manual, lançamento e as tarefas que o pedem
 * (spec C, I-30, I-31; appsec C1, C2, C3, C27, C29; LGPD R-e). Postgres REAL
 * e a API inteira.
 *
 * HOJE = sábado 24/10/2026 (America/Bahia): a referência semanal pendente é a
 * segunda 19/10. `beatriz` (pf_sup) ganha `indicadores` e `indicadores.gerir`
 * e tem `valores`; `juliana` (pf_rec) ganha os dois e NÃO tem `valores`.
 * `camila` (pf_ter, com `valores`) e `rita` (pf_bal, sem `valores`) NÃO têm
 * `indicadores`: são as responsáveis da exceção nomeada.
 */
let c: Cenario
let banco: BancoService

const SEGUNDA = '2026-10-19'

type Tarefa = TarefaNaLista

const kpiManual = async (corpo: Record<string, unknown> = {}, quem = 'beatriz'): Promise<string> => {
  const r = await postar(
    c,
    '/v1/indicadores/kpis',
    {
      origem: 'manual',
      nome: 'Leads do Instagram',
      pilar: 'Comercial',
      unidade: 'quantidade',
      direcao: 'maior',
      frequencia: 'semanal',
      diaDeLancamento: 5,
      comoMedir: 'Contar as conversas novas no direct',
      responsavelId: c.pessoas['camila'],
      ...corpo,
    },
    quem,
  )
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  return r.body.id as string
}

const lancar = (kpi: string, ref: string, corpo: Record<string, unknown>, quem: string) =>
  botar(c, `/v1/indicadores/kpis/${kpi}/lancamentos/${ref}`, corpo, quem)

const tarefasDoKpi = async (kpi: string) =>
  (
    await c.migrate.query<{ id: string; prazo: string; status: string; responsavel_id: string; excluida: boolean }>(
      `SELECT id, prazo::text AS prazo, status::text AS status, responsavel_id, excluida_em IS NOT NULL AS excluida
         FROM tarefas WHERE kpi_id = $1 ORDER BY prazo`,
      [kpi],
    )
  ).rows

const rodarJob = (hoje = HOJE) =>
  banco.naClinica(clinicaIdDeFonteConfiavel(c.clinica), SISTEMA, (cx) =>
    gerarTarefasDeLancamento(cx, clinicaIdDeFonteConfiavel(c.clinica), hoje),
  )

/** Todas as rotas GET de `/v1/indicadores*` registradas no Nest — inclusive as que nascerem depois. */
function rotasGetDeIndicadores(): string[] {
  const scanner = new MetadataScanner()
  const caminhos: string[] = []
  for (const [, modulo] of c.app.get(ModulesContainer)) {
    for (const [, w] of modulo.controllers) {
      const classe = w.metatype
      if (typeof classe !== 'function' || w.instance === null || typeof w.instance !== 'object') continue
      const prefixo = (Reflect.getMetadata(PATH_METADATA, classe) as string | undefined) ?? ''
      if (!prefixo.startsWith('v1/indicadores')) continue
      const proto = Object.getPrototypeOf(w.instance) as Record<string, unknown>
      for (const nome of scanner.getAllMethodNames(proto)) {
        const h = proto[nome]
        if (typeof h !== 'function') continue
        if (Reflect.getMetadata(METHOD_METADATA, h) !== RequestMethod.GET) continue
        const sub = (Reflect.getMetadata(PATH_METADATA, h) as string | undefined) ?? ''
        caminhos.push(`/${[prefixo, sub].filter((p) => p !== '' && p !== '/').join('/')}`)
      }
    }
  }
  return caminhos
}

beforeAll(async () => {
  c = await montarCenario('indicadores-t3')
  banco = new BancoService()
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores','indicadores.gerir']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec')`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limparFinanceiro(c)
  await limparTarefas(c)
  await banco.onModuleDestroy()
  await desmontarCenario(c)
})
beforeEach(async () => {
  await limparTarefas(c)
  await limparFinanceiro(c)
})

describe('C.1–C.3 da spec: a tarefa em Hoje, o relançamento e o job', () => {
  it('C.1: a tarefa "Lançar" aparece em Hoje para a responsável SEM `indicadores`, e lançar a conclui (1.10, item 3)', async () => {
    const kpi = await kpiManual()
    const hoje = await pegar(c, '/v1/hoje', {}, 'camila')
    expect(hoje.statusCode).toBe(200)
    const cartoes = [...(hoje.body.pendentes.itens as Tarefa[]), ...(hoje.body.tarefas as Tarefa[])]
    const t = cartoes.find((x) => x.kpi?.id === kpi)
    expect(t, 'a tarefa da semana corrente (prazo sexta 23/10, atrasada) está em Hoje').toBeDefined()
    expect(t!.kpi).toEqual({ id: kpi, nome: 'Leads do Instagram' })
    // Tudo o que a D.4 precisa, pela tarefa (appsec C2).
    expect(t!.lancamentoDeKpi).toEqual({
      kpiId: kpi,
      nome: 'Leads do Instagram',
      unidade: 'quantidade',
      comoMedir: 'Contar as conversas novas no direct',
      referencia: SEGUNDA,
      prazo: '2026-10-23',
    })
    // …e ela não tem como ler o KPI por outra porta.
    expect((await pegar(c, `/v1/indicadores/kpis/${kpi}`, {}, 'camila')).statusCode).toBe(403)

    const r = await lancar(kpi, SEGUNDA, { valor: '1200', comentario: '' }, 'camila')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.tarefaConcluidaId).toBe(t!.id)
    expect(r.body.lancado).toEqual({ emDinheiro: null, emNumero: '1200' })
    expect(r.body.anterior).toBeNull()
    const depois = (await tarefasDoKpi(kpi)).find((x) => x.id === t!.id)!
    expect(depois.status).toBe('concluida')
    // A gestão vê o valor no cartão: o último lançamento do período (I-5).
    const k = await pegar(c, `/v1/indicadores/kpis/${kpi}`, {}, 'beatriz')
    expect(k.body.atual.emNumero).toBe('1200')
  })

  it('C.2: relançar CORRIGE a mesma linha, devolve o anterior e a correção aparece em Atividades', async () => {
    const kpi = await kpiManual()
    expect((await lancar(kpi, SEGUNDA, { valor: '1200' }, 'camila')).statusCode).toBe(200)
    const r = await lancar(kpi, SEGUNDA, { valor: '1350', comentario: 'Contei de novo' }, 'camila')
    expect(r.statusCode).toBe(200)
    expect(r.body.lancado.emNumero).toBe('1350')
    expect(r.body.anterior).toEqual({ emDinheiro: null, emNumero: '1200' })
    expect(r.body.tarefaConcluidaId).toBeNull()
    const linhas = await c.migrate.query('SELECT 1 FROM lancamentos_de_kpi WHERE kpi_id = $1', [kpi])
    expect(linhas.rowCount).toBe(1)
    const at = await pegar(c, '/v1/atividades', { assunto: 'lancamentos_de_kpi' }, 'beatriz')
    expect(at.statusCode).toBe(200)
    const acoes = (at.body.itens as { acao: string; campos: string[]; quem: { id: string } }[]).map((x) => ({
      acao: x.acao,
      quem: x.quem.id,
      valorMudou: x.campos.includes('valor_numero'),
    }))
    expect(acoes).toContainEqual({ acao: 'alterou', quem: c.pessoas['camila'], valorMudou: true })
    // Na trilha deste lançamento: uma criação e uma correção, de 1200 para 1350.
    const trilha = await c.migrate.query<{ acao: string; de: unknown; para: unknown }>(
      `SELECT a.acao, a.de -> 'valor_numero' AS de, a.para -> 'valor_numero' AS para FROM auditoria a
         JOIN lancamentos_de_kpi l ON l.id::text = a.entidade_id::text
        WHERE a.entidade = 'lancamentos_de_kpi' AND l.kpi_id = $1 ORDER BY a.id`,
      [kpi],
    )
    expect(trilha.rows.map((x) => x.acao)).toEqual(['criou', 'alterou'])
    expect(trilha.rows[1]).toMatchObject({ de: 1200, para: 1350 })
  })

  it('C.3: o job três vezes não duplica, e a tarefa excluída não volta', async () => {
    const kpi = await kpiManual()
    const nasceram = (await tarefasDoKpi(kpi)).length
    // 24/10 + 35 = 28/11: as sextas 23/10 a 27/11.
    expect(nasceram).toBe(6)
    for (let i = 0; i < 3; i++) expect(await rodarJob()).toBe(0)
    expect(await tarefasDoKpi(kpi)).toHaveLength(nasceram)

    const alvo = (await tarefasDoKpi(kpi))[2]!
    // A rota genérica não exclui a tarefa do KPI (ver o describe abaixo); a
    // exclusão aqui simula a linha que sumiu por outro caminho (legado, suporte).
    await c.migrate.query('UPDATE tarefas SET excluida_em = now() WHERE id = $1', [alvo.id])
    for (let i = 0; i < 3; i++) await rodarJob()
    // Uma semana depois: nasce a sexta 04/12, e a excluída continua excluída, sem gêmea viva.
    await rodarJob('2026-10-31')
    const vivas = (await tarefasDoKpi(kpi)).filter((x) => !x.excluida)
    expect(vivas.map((x) => x.prazo)).not.toContain(alvo.prazo)
    expect(vivas.map((x) => x.prazo).at(-1)).toBe('2026-12-04')
    expect(vivas).toHaveLength(nasceram)
  })
})

describe('C.4 — as condições do `podeLancar` (appsec C1)', () => {
  it('lancamento-responsavel-trocada: a antiga leva 403, a nova lança, e as tarefas abertas vão com ela', async () => {
    const kpi = await kpiManual()
    const troca = await botar(c, `/v1/indicadores/kpis/${kpi}`, { responsavelId: c.pessoas['rita'] }, 'beatriz')
    expect(troca.statusCode, JSON.stringify(troca.body)).toBe(200)
    expect((await lancar(kpi, SEGUNDA, { valor: '100' }, 'camila')).statusCode).toBe(403)
    expect((await lancar(kpi, SEGUNDA, { valor: '100' }, 'rita')).statusCode).toBe(200)
    const abertas = (await tarefasDoKpi(kpi)).filter((x) => x.status === 'aberta')
    expect(abertas.length).toBeGreaterThan(0)
    expect(new Set(abertas.map((x) => x.responsavel_id))).toEqual(new Set([c.pessoas['rita']]))
  })

  it('lancamento-kpi-de-catalogo-422', async () => {
    const r = await c.migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, chave_catalogo, nome, frequencia, responsavel_id)
       VALUES ($1, 'catalogo', 'novos_pacientes', 'Novos pacientes', 'mensal', $2) RETURNING id`,
      [c.clinica, c.pessoas['camila']],
    )
    expect((await lancar(r.rows[0]!.id, '2026-10-01', { valor: '100' }, 'camila')).statusCode).toBe(422)
  })

  it('lancamento-outra-clinica-404: o KPI da vizinha não existe para cá, nem para a gestão', async () => {
    const r = await c.migrate.query<{ id: string }>(
      `INSERT INTO kpis (clinica_id, origem, nome, pilar, unidade, direcao, frequencia, dia_de_lancamento)
       VALUES ($1, 'manual', 'Da vizinha', 'Comercial', 'quantidade', 'maior', 'semanal', 1) RETURNING id`,
      [c.outraClinica],
    )
    expect((await lancar(r.rows[0]!.id, SEGUNDA, { valor: '100' }, 'camila')).statusCode).toBe(404)
    expect((await lancar(r.rows[0]!.id, SEGUNDA, { valor: '100' }, 'beatriz')).statusCode).toBe(404)
    const nada = await c.migrate.query('SELECT 1 FROM lancamentos_de_kpi WHERE kpi_id = $1', [r.rows[0]!.id])
    expect(nada.rowCount).toBe(0)
  })

  it('lancamento-arquivado-409: e arquivar cancela as tarefas abertas', async () => {
    const kpi = await kpiManual()
    expect((await postar(c, `/v1/indicadores/kpis/${kpi}/arquivar`, {}, 'beatriz')).statusCode).toBe(200)
    expect((await lancar(kpi, SEGUNDA, { valor: '100' }, 'camila')).statusCode).toBe(409)
    expect((await tarefasDoKpi(kpi)).every((x) => x.status === 'cancelada')).toBe(true)
    // E o job não gera mais nada para ele.
    expect(await rodarJob('2026-11-30')).toBe(0)
  })

  it('referência futura e referência que não é segunda: 422', async () => {
    const kpi = await kpiManual()
    expect((await lancar(kpi, '2026-10-26', { valor: '100' }, 'camila')).statusCode).toBe(422)
    expect((await lancar(kpi, '2026-10-20', { valor: '100' }, 'camila')).statusCode).toBe(422)
  })
})

describe('C.5 — a exceção da responsável não abre leitura (appsec C2)', () => {
  it('excecao-da-responsavel-nao-abre-leitura: 403 em todo GET /v1/indicadores*, e o PUT só traz o lançamento', async () => {
    const kpi = await kpiManual()
    const gets = rotasGetDeIndicadores()
    expect(gets.length, 'nenhuma rota GET de indicadores encontrada').toBeGreaterThan(3)
    for (const rota of gets) {
      const r = await pegar(c, rota.replace(/:[a-zA-Z]+/g, kpi), {}, 'camila')
      expect(r.statusCode, `GET ${rota} para a responsável sem indicadores`).toBe(403)
    }
    const r = await lancar(kpi, SEGUNDA, { valor: '700' }, 'camila')
    expect(r.statusCode).toBe(200)
    expect(Object.keys(r.body).sort()).toEqual(Object.keys(LancamentoDeKpiNaSaida.shape).sort())
    expect(LancamentoDeKpiNaSaida.safeParse(r.body).success).toBe(true)
    for (const proibida of ['percentualDaMeta', 'meta', 'metaVigente', 'situacao', 'serie', 'escala', 'composicao']) {
      expect(r.text).not.toContain(`"${proibida}"`)
    }
  })

  it('fora de reais, a responsável sem `valores` vê o número que lançou', async () => {
    const kpi = await kpiManual({ responsavelId: c.pessoas['rita'] })
    const r = await lancar(kpi, SEGUNDA, { valor: '4200' }, 'rita')
    expect(r.statusCode).toBe(200)
    expect(r.body.lancado).toEqual({ emDinheiro: null, emNumero: '4200' })
  })

  it('em reais, o valor e o anterior saem redigidos para a responsável sem `valores` (com mutação)', async () => {
    const kpi = await kpiManual({ nome: 'Venda de cosméticos', unidade: 'reais', responsavelId: c.pessoas['rita'] })
    const a = await lancar(kpi, SEGUNDA, { valor: '150043' }, 'rita')
    expect(a.statusCode).toBe(200)
    expect(a.body.lancado).toEqual({ emDinheiro: null, emNumero: null })
    const b = await lancar(kpi, SEGUNDA, { valor: '160043' }, 'rita')
    expect(b.body.anterior).toEqual({ emDinheiro: null, emNumero: null })
    expect(a.text + b.text).not.toMatch(/1[56]0043/)
    // Mutação: a gestão, com `valores`, vê os dois — o teste enxerga o vazamento quando ele existe.
    const g = await lancar(kpi, SEGUNDA, { valor: '170043' }, 'beatriz')
    expect(g.body.lancado.emDinheiro).toBe('170043')
    expect(g.body.anterior.emDinheiro).toBe('160043')
  })
})

describe('tarefas e unidade (appsec C27, C3)', () => {
  it('marcador-lancamento-forjado-422: POST /v1/tarefas não cria a tarefa "Lançar"', async () => {
    const corpo = {
      vinculo: 'interna',
      responsavelId: c.pessoas['juliana'],
      descricao: 'Lançar Leads',
      quando: { modo: 'agendada', prazo: HOJE },
    }
    for (const marcador of ['lancamento-kpi:6f2c1d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f', '  LANCAMENTO-KPI:x']) {
      const r = await postar(c, '/v1/tarefas', { ...corpo, marcador }, 'beatriz')
      expect(r.statusCode).toBe(422)
    }
    // Outro marcador qualquer continua recusado pelo `.strict()` (400), e nada foi criado.
    expect((await postar(c, '/v1/tarefas', { ...corpo, marcador: 'fechamento-do-mes' }, 'beatriz')).statusCode).toBe(400)
    const n = await c.migrate.query('SELECT 1 FROM tarefas WHERE clinica_id = $1', [c.clinica])
    expect(n.rowCount).toBe(0)
  })

  it('escrever-reais-sem-valores-403: o PUT de KPI manual que muda a unidade para reais', async () => {
    const kpi = await kpiManual()
    expect((await botar(c, `/v1/indicadores/kpis/${kpi}`, { unidade: 'reais' }, 'juliana')).statusCode).toBe(403)
    const ok = await botar(c, `/v1/indicadores/kpis/${kpi}`, { unidade: 'reais' }, 'beatriz')
    expect(ok.statusCode).toBe(200)
    expect(ok.body.unidade).toBe('reais')
    // Com lançamento gravado, trocar de unidade reinterpretaria o número: 409.
    expect((await lancar(kpi, SEGUNDA, { valor: '100' }, 'camila')).statusCode).toBe(200)
    expect((await botar(c, `/v1/indicadores/kpis/${kpi}`, { unidade: 'quantidade' }, 'beatriz')).statusCode).toBe(409)
  })
})

describe('log (appsec C29, LGPD R-e)', () => {
  it('log-sem-conteudo-indicadores: nome do KPI, "como medir", comentário e valor nunca vão para o log', async () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m))
    try {
      const kpi = await kpiManual({ nome: 'Indicador Sigiloso Quixote', comoMedir: 'Conferir com a Dona Zuleica' })
      await lancar(kpi, SEGUNDA, { valor: '98765', comentario: 'Comentario reservado da Ana Lucia' }, 'camila')
      await lancar(kpi, SEGUNDA, { valor: '98766', comentario: 'x'.repeat(281) }, 'camila')
      await rodarJob()
      await rodarJob('2026-11-30')
      const linhas = espioes.flatMap((e) => e.mock.calls.map((x) => x.map(String).join(' '))).join('\n')
      for (const segredo of ['Quixote', 'Zuleica', 'Ana Lucia', '98765', '98766', 'xxxxxxxxxx']) {
        expect(linhas).not.toContain(segredo)
      }
    } finally {
      for (const e of espioes) e.mockRestore()
    }
  })
})

describe('a tarefa "Lançar" pertence ao KPI: as rotas genéricas de tarefa (T3, appsec C1/C27)', () => {
  const tarefaAberta = async (kpi: string) => (await tarefasDoKpi(kpi)).find((x) => x.status === 'aberta' && x.prazo === '2026-10-23')!

  it('concluir pela rota genérica sem o lançamento é 422, e nada muda', async () => {
    const kpi = await kpiManual()
    const t = await tarefaAberta(kpi)
    const r = await postar(c, `/v1/tarefas/${t.id}/concluir`, { em: HOJE }, 'camila')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(422)
    expect(r.body.message).toContain('Lançar')
    expect((await tarefasDoKpi(kpi)).find((x) => x.id === t.id)!.status).toBe('aberta')
  })

  it('com o lançamento da referência já gravado, a rota genérica conclui (a tarefa reaberta, por exemplo)', async () => {
    const kpi = await kpiManual()
    const t = await tarefaAberta(kpi)
    expect((await lancar(kpi, SEGUNDA, { valor: '300' }, 'camila')).body.tarefaConcluidaId).toBe(t.id)
    expect((await postar(c, `/v1/tarefas/${t.id}/reabrir`, {}, 'camila')).statusCode).toBe(200)
    const r = await postar(c, `/v1/tarefas/${t.id}/concluir`, { em: HOJE }, 'camila')
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
  })

  it('cancelar e excluir pela rota genérica são 422: só arquivando o KPI', async () => {
    const kpi = await kpiManual()
    const t = await tarefaAberta(kpi)
    const can = await postar(c, `/v1/tarefas/${t.id}/cancelar`, {}, 'beatriz')
    expect(can.statusCode, JSON.stringify(can.body)).toBe(422)
    expect(can.body.message).toContain('arquive o indicador')
    const del = await apagar(c, `/v1/tarefas/${t.id}`, {}, 'beatriz')
    expect(del.statusCode, JSON.stringify(del.body)).toBe(422)
    const agora = (await tarefasDoKpi(kpi)).find((x) => x.id === t.id)!
    expect(agora).toMatchObject({ status: 'aberta', excluida: false })
  })

  it('editar prazo ou descrição é 422; obs e prioridade passam', async () => {
    const kpi = await kpiManual()
    const t = await tarefaAberta(kpi)
    expect((await remendar(c, `/v1/tarefas/${t.id}`, { prazo: '2026-10-30' }, 'beatriz')).statusCode).toBe(422)
    expect((await remendar(c, `/v1/tarefas/${t.id}`, { descricao: 'Outra coisa' }, 'beatriz')).statusCode).toBe(422)
    const ok = await remendar(c, `/v1/tarefas/${t.id}`, { obs: 'Lembrar na reunião', prioridade: 'urgente' }, 'beatriz')
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200)
    expect((await tarefasDoKpi(kpi)).find((x) => x.id === t.id)!.prazo).toBe('2026-10-23')
  })

  it('reatribuir (editar ou transferir) só para quem `podeLancar` aceita; nunca para grupo', async () => {
    const kpi = await kpiManual()
    const t = await tarefaAberta(kpi)
    // Rita não é a responsável nem gerencia Indicadores.
    expect((await remendar(c, `/v1/tarefas/${t.id}`, { responsavelId: c.pessoas['rita'] }, 'beatriz')).statusCode).toBe(422)
    const tr = await postar(c, `/v1/tarefas/${t.id}/transferir`, { para: { tipo: 'pessoa', id: c.pessoas['rita'] } }, 'beatriz')
    expect(tr.statusCode, JSON.stringify(tr.body)).toBe(422)
    const g = await c.migrate.query<{ id: string }>(
      `INSERT INTO grupos_da_equipe (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
      [c.clinica, `Recepção ${Date.now()}`],
    )
    const gr = await postar(c, `/v1/tarefas/${t.id}/transferir`, { para: { tipo: 'grupo', id: g.rows[0]!.id } }, 'beatriz')
    expect(gr.statusCode, JSON.stringify(gr.body)).toBe(422)
    expect((await tarefasDoKpi(kpi)).find((x) => x.id === t.id)!.responsavel_id).toBe(c.pessoas['camila'])
    // Juliana gerencia Indicadores: `podeLancar` aceita, e ela consegue lançar depois.
    const ok = await remendar(c, `/v1/tarefas/${t.id}`, { responsavelId: c.pessoas['juliana'] }, 'beatriz')
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(200)
    expect((await lancar(kpi, SEGUNDA, { valor: '10' }, 'juliana')).body.tarefaConcluidaId).toBe(t.id)
  })
})
