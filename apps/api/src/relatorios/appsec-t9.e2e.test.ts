import { randomUUID } from 'node:crypto'
import { CAMPOS_MONETARIOS, ehCampoMonetario } from '@fir/domain'
import { CATALOGO_DE_RELATORIOS, CHAVES_DE_RELATORIO, type DefinicaoDeRelatorio } from '@fir/contracts'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { apagarPacientesDaExportacaoDeTeste } from '../banco/limpeza-de-teste'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * REVISÃO APPSEC/LGPD DO T9 (substitui o `claude-security:scan` C30).
 *
 * Cada `it` é um ataque. `it.fails` = achado REPRODUZIDO: o teste afirma o
 * comportamento seguro e hoje falha. Quando a correção entrar, ele passa a
 * falhar como `it.fails` — troque para `it`.
 *
 * Veredito em docs/specs/indicadores-e-insights-t9-appsec.md.
 */
let c: Cenario

const criarCampanha = (chave: string, corpo: Record<string, unknown>, opcoes: { quem?: string; idempotencia?: string } = {}) =>
  request(c.app.getHttpServer())
    .post(`/v1/relatorios/${chave}/campanha`)
    .set('Cookie', c.cookies[opcoes.quem ?? 'beatriz']!)
    .set('Idempotency-Key', opcoes.idempotencia ?? randomUUID())
    .send(corpo)

const executar = (chave: string, filtros: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/execucoes`, { filtros }, quem)

const tarefa = (tipo = 'Recaptação') => ({ tipo, descricao: '', prazo: '2026-10-30', responsavelId: c.pessoas['juliana'] })
const nova = (nome = 'Volta pra gente') => ({ nome, inicio: '2026-10-24', fim: '2026-11-30', metrica: 'convertidos', metaEmNumero: 10 })
const SEM_ATENDIMENTO = { semAtendimentoHaMeses: 3 }

const contar = async (sql: string, params: unknown[] = [c.clinica]): Promise<number> =>
  Number((await c.migrate.query<{ n: string }>(sql, params)).rows[0]!.n)

async function paciente(nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const colunas = ['clinica_id', 'nome', ...Object.keys(extra)]
  const valores = [c.clinica, nome, ...Object.values(extra)]
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO pacientes (${colunas.join(', ')}) VALUES (${colunas.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    valores,
  )
  return r.rows[0]!.id
}

async function comPerms<T>(perfil: string, perms: string[], f: () => Promise<T>): Promise<T> {
  await c.migrate.query(`UPDATE perfis SET perms = perms || $3::text[] WHERE clinica_id = $1 AND chave = $2`, [c.clinica, perfil, perms])
  try {
    return await f()
  } finally {
    for (const p of perms) {
      await c.migrate.query(`UPDATE perfis SET perms = array_remove(perms, $3) WHERE clinica_id = $1 AND chave = $2`, [c.clinica, perfil, p])
    }
  }
}

async function limparTudo(): Promise<void> {
  await apagarPacientesDaExportacaoDeTeste(c.migrate, c.clinica)
  await c.migrate.query('DELETE FROM tentativas_de_relatorio WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('BEGIN')
  try {
    await c.migrate.query('ALTER TABLE auditoria DISABLE TRIGGER auditoria_sem_update')
    await c.migrate.query(`DELETE FROM auditoria WHERE clinica_id = $1 AND entidade IN ('relatorio', 'exportacao_de_relatorio')`, [c.clinica])
    await c.migrate.query('ALTER TABLE auditoria ENABLE TRIGGER auditoria_sem_update')
    await c.migrate.query('COMMIT')
  } catch (e) {
    await c.migrate.query('ROLLBACK')
    throw e
  }
  await limparFinanceiro(c)
  await limparProgramas(c)
  await limparTarefas(c)
  await c.migrate.query('DELETE FROM contas_a_pagar WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('UPDATE pacientes SET campanha_id = NULL, indicado_por_id = NULL WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM campanhas WHERE clinica_id = ANY($1::uuid[])', [[c.clinica, c.outraClinica]])
  await c.migrate.query(
    `UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'erro-de-cadastro'
      WHERE clinica_id = $1 AND ativo AND id <> ALL($2::uuid[])`,
    [c.clinica, [c.pacientes['ana'], c.pacientes['bruna']]],
  )
  await c.migrate.query(`UPDATE pacientes SET ultima_consulta = NULL, origem = '' WHERE clinica_id = $1`, [c.clinica])
}

const semAtendimento = () =>
  c.migrate.query(`UPDATE pacientes SET ultima_consulta = '2026-01-10' WHERE id = ANY($1::uuid[])`, [[c.pacientes['ana'], c.pacientes['bruna']]])

beforeAll(async () => {
  c = await montarCenario('appsec-t9')
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec', 'pf_ter', 'pf_cxa', 'pf_enf')`,
    [c.clinica],
  )
})
afterAll(async () => {
  await limparTudo()
  await desmontarCenario(c)
})
beforeEach(limparTudo)

/* ============================================================ idempotência */

describe('ADV-1..4 — Idempotency-Key', () => {
  it('ADV-1 [achado M1]: a mesma chave com OUTRA lista não enxerta pacientes na campanha da primeira', async () => {
    await semAtendimento()
    const chave = randomUUID()
    const a = await criarCampanha('pacientes-sem-atendimento', { filtros: SEM_ATENDIMENTO, destino: { nova: nova('A') }, tarefa: tarefa() }, { idempotencia: chave })
    expect(a.status, a.text).toBe(200)
    // Uma paciente que só entra num recorte DIFERENTE (12 meses).
    const iris = await paciente('Iris Antiga', { ultima_consulta: '2025-01-10' })
    const b = await criarCampanha(
      'pacientes-sem-atendimento',
      { filtros: { semAtendimentoHaMeses: 12 }, destino: { nova: nova('B — outro nome') }, tarefa: tarefa() },
      { idempotencia: chave },
    )
    // Seguro: a repetição com corpo diferente é recusada (422/409) e nada muda.
    const enxertadas = await contar('SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1 AND campanha_id = $2 AND paciente_id = $3', [
      c.clinica,
      a.body.campanhaId,
      iris,
    ])
    console.info(`ADV-1 medido: status=${b.status} mesmaCampanha=${b.body.campanhaId === a.body.campanhaId} enxertadas=${enxertadas} nomeDaB=${await contar('SELECT count(*)::text AS n FROM campanhas WHERE clinica_id = $1 AND nome = $2', [c.clinica, 'B — outro nome'])}`)
    expect({ status: b.status, enxertadas }).toEqual({ status: 422, enxertadas: 0 })
  })

  it('ADV-2: a mesma chave em outra clínica não é reaproveitada nem revelada', async () => {
    await semAtendimento()
    const chave = randomUUID()
    const daOutra = await c.migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta, chave_de_idempotencia)
       VALUES ($1, 'Da vizinha', '2026-10-01', '2026-10-31', 'convertidos', 1, $2) RETURNING id`,
      [c.outraClinica, chave],
    )
    const r = await criarCampanha('pacientes-sem-atendimento', { filtros: SEM_ATENDIMENTO, destino: { nova: nova() }, tarefa: tarefa() }, { idempotencia: chave })
    expect(r.status, r.text).toBe(200)
    expect(r.body.campanhaId).not.toBe(daOutra.rows[0]!.id)
    expect(r.text).not.toContain('vizinha')
    expect(await contar('SELECT count(*)::text AS n FROM tarefas WHERE campanha_id = $1', [daOutra.rows[0]!.id])).toBe(0)
  })

  it('ADV-3: destino de outra clínica e destino excluído dão 422, sem tarefa nenhuma', async () => {
    await semAtendimento()
    const daOutra = await c.migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta) VALUES ($1, 'Vizinha', '2026-10-01', '2026-10-31', 'convertidos', 1) RETURNING id`,
      [c.outraClinica],
    )
    const excluida = await c.migrate.query<{ id: string }>(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta, excluida_em)
       VALUES ($1, 'Excluída', '2026-10-01', '2026-10-31', 'convertidos', 1, now()) RETURNING id`,
      [c.clinica],
    )
    for (const id of [daOutra.rows[0]!.id, excluida.rows[0]!.id]) {
      const r = await criarCampanha('pacientes-sem-atendimento', { filtros: SEM_ATENDIMENTO, destino: { campanhaId: id }, tarefa: tarefa() })
      expect(r.status, r.text).toBe(422)
    }
    expect(await contar('SELECT count(*)::text AS n FROM tarefas WHERE campanha_id IS NOT NULL AND clinica_id = ANY($1::uuid[])', [[c.clinica, c.outraClinica]])).toBe(0)
  })

  it('ADV-4: a chave de uma campanha excluída não a ressuscita (409) e não cria tarefa', async () => {
    await semAtendimento()
    const chave = randomUUID()
    await c.migrate.query(
      `INSERT INTO campanhas (clinica_id, nome, inicio, fim, metrica, meta, chave_de_idempotencia, excluida_em)
       VALUES ($1, 'Morta', '2026-10-01', '2026-10-31', 'convertidos', 1, $2, now())`,
      [c.clinica, chave],
    )
    const r = await criarCampanha('pacientes-sem-atendimento', { filtros: SEM_ATENDIMENTO, destino: { nova: nova() }, tarefa: tarefa() }, { idempotencia: chave })
    expect(r.status, r.text).toBe(409)
    expect(await contar('SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1 AND campanha_id IS NOT NULL')).toBe(0)
  })

  it('ADV-5: dez rodadas de três pedidos concorrentes (mesma chave, mesmo nome) — uma campanha, nenhum 5xx', async () => {
    await semAtendimento()
    const status: number[] = []
    for (let i = 0; i < 10; i++) {
      const chave = randomUUID()
      const corpo = { filtros: SEM_ATENDIMENTO, destino: { nova: nova(`Rodada ${i}`) }, tarefa: tarefa() }
      const rs = await Promise.all([1, 2, 3].map(() => criarCampanha('pacientes-sem-atendimento', corpo, { idempotencia: chave })))
      status.push(...rs.map((r) => r.status))
      expect(await contar(`SELECT count(*)::text AS n FROM campanhas WHERE clinica_id = $1 AND nome = $2`, [c.clinica, `Rodada ${i}`])).toBe(1)
      await c.migrate.query('DELETE FROM tentativas_de_relatorio WHERE clinica_id = $1', [c.clinica])
    }
    expect(status.filter((s) => s >= 500)).toEqual([])
    // Medição (observação O1): quantos 409 "nome repetido" a corrida devolve em vez da mesma campanha.
    console.info(`ADV-5 status: ${JSON.stringify(status.reduce<Record<number, number>>((m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {}))}`)
  })
})

/* ============================================================ permissões */

describe('ADV-6..8 — permissão do relatório dentro de "Criar campanha"', () => {
  it('ADV-6: relatório 9 com faixa de valor sem `valores` — 403 também pela campanha, com o favorito redigido (null)', async () => {
    await c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
       VALUES ($1, $2, 'Consulta realizada', 0, 10000, '', '2026-10-01T12:00:00Z', $3)`,
      [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
    )
    await comPerms('pf_cxa', ['campanhas.gerir'], async () => {
      for (const filtros of [{ valorMinimo: '1' }, { valorMaximo: '999999' }, { valorMinimo: null }]) {
        const r = await criarCampanha('saldos-em-aberto', { filtros, destino: { nova: nova() }, tarefa: tarefa() }, { quem: 'sonia' })
        expect(r.status, `${JSON.stringify(filtros)}: ${r.text}`).toBe(403)
      }
      // Sem faixa, a lista de quem tem saldo (`comSaldo`) é permitida.
      const ok = await criarCampanha('saldos-em-aberto', { filtros: {}, destino: { nova: nova() }, tarefa: tarefa() }, { quem: 'sonia' })
      expect(ok.status, ok.text).toBe(200)
      expect(Object.keys(ok.body).sort()).toEqual(['campanhaId', 'criadas', 'ignoradas', 'pacientes'])
    })
    expect(await contar('SELECT count(*)::text AS n FROM campanhas WHERE clinica_id = $1')).toBe(1)
  })

  it('ADV-7: relatório 3 sem `valores` é 403 por execução, exportação e campanha', async () => {
    await comPerms('pf_rec', ['campanhas.gerir'], async () => {
      expect((await executar('pacientes-maior-ltv', {}, 'juliana')).status).toBe(403)
      expect((await postar(c, '/v1/relatorios/pacientes-maior-ltv/exportacoes', { filtros: {}, formato: 'csv' }, 'juliana')).status).toBe(403)
      expect((await criarCampanha('pacientes-maior-ltv', { filtros: {}, destino: { nova: nova() }, tarefa: tarefa() }, { quem: 'juliana' })).status).toBe(403)
    })
  })

  it('ADV-8: relatório 5 (saúde) sem `jornada` é 403 pela campanha; com, nenhum procedimento na campanha nem nas tarefas', async () => {
    const proc = (await c.migrate.query<{ id: string; nome: string }>('SELECT id, nome FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 1', [c.clinica])).rows[0]!
    const m = await postar(
      c,
      '/v1/programas',
      { pacienteId: c.pacientes['ana'], inicio: HOJE, itens: [{ chave: 'i1', procedimentoId: proc.id, sessoes: 2, intervaloDias: 7 }] },
      'beatriz',
    )
    expect(m.status, m.text).toBe(201)
    await comPerms('pf_enf', ['campanhas.gerir'], async () => {
      const r = await criarCampanha('pacientes-por-procedimento', { filtros: { procedimentoId: proc.id }, destino: { nova: nova() }, tarefa: tarefa() }, { quem: 'nara' })
      expect(r.status).toBe(403)
    })
    const r = await criarCampanha('pacientes-por-procedimento', { filtros: { procedimentoId: proc.id }, destino: { nova: nova('Retorno') }, tarefa: tarefa() })
    expect(r.status, r.text).toBe(200)
    const camp = await c.migrate.query('SELECT * FROM campanhas WHERE id = $1', [r.body.campanhaId])
    const tar = await c.migrate.query('SELECT * FROM tarefas WHERE campanha_id = $1', [r.body.campanhaId])
    expect(tar.rows).toHaveLength(1)
    for (const proibido of [proc.nome, proc.id]) {
      expect(JSON.stringify(camp.rows)).not.toContain(proibido)
      expect(JSON.stringify(tar.rows)).not.toContain(proibido)
    }
  })
})

/* ============================================================ titulares */

describe('ADV-9..11 — quem entra na lista', () => {
  it('ADV-9: relatório 4 — a campanha leva só as indicadoras, nunca as indicadas (terceiras)', async () => {
    const carla = await paciente('Carla Indicada', { indicado_por_id: c.pacientes['ana'], criado_em: '2026-10-05T12:00:00Z' })
    const r = await criarCampanha('pacientes-que-indicaram', { filtros: { de: '2026-10-01', ate: '2026-10-31' }, destino: { nova: nova() }, tarefa: tarefa() })
    expect(r.status, r.text).toBe(200)
    const ids = (await c.migrate.query<{ paciente_id: string }>('SELECT paciente_id FROM tarefas WHERE campanha_id = $1', [r.body.campanhaId])).rows.map((x) => x.paciente_id)
    expect(ids).toEqual([c.pacientes['ana']])
    expect(ids).not.toContain(carla)
    const e = await postar(c, '/v1/relatorios/pacientes-que-indicaram/exportacoes', { filtros: { de: '2026-10-01', ate: '2026-10-31' }, formato: 'csv', incluirTelefone: true }, 'beatriz')
    expect(e.status, e.text).toBe(200)
    expect(e.text).not.toContain('Carla')
    expect(e.text).not.toContain(carla)
  })

  it('ADV-10: relatório 14 — paciente que pediu para sair fica sem nome e sem id na linha, e fora da campanha', async () => {
    const saiu = await paciente('Iris Saiu', { telefone: '71977776666' })
    const t = await c.migrate.query<{ id: string }>(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, historico)
       VALUES ($1, $2, $2, 'Consulta', '2026-10-05', 'Consulta agendada', $3, $4::jsonb) RETURNING id`,
      [c.clinica, c.pessoas['beatriz'], saiu, JSON.stringify([{ acao: 'noshow', etapa: 'faltou', em: '2026-10-05T15:00:00Z', porId: c.pessoas['beatriz'] }])],
    )
    await c.migrate.query(`UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'pediu-para-sair' WHERE id = $1`, [saiu])
    const filtros = { de: '2026-10-01', ate: '2026-10-31' }
    const r = await postar(c, '/v1/relatorios/faltas-e-desmarcacoes/exportacoes', { filtros, formato: 'csv', incluirTelefone: true }, 'juliana')
    expect(r.status, r.text).toBe(200)
    const linha = (r.body.resultado.linhas as { tarefaId: string; pacienteId: string | null; nome: string | null }[]).find((l) => l.nome === null)!
    // Depois do M2, a linha anônima também não leva o `tarefaId`.
    expect(linha).toMatchObject({ tarefaId: null, pacienteId: null, nome: null })
    expect(r.text).not.toContain(t.rows[0]!.id)
    expect(r.text).not.toContain('Iris')
    expect(r.text).not.toContain(saiu)
    expect(r.text).not.toContain('977776666')
    // Nem o registro de titulares da exportação a lista.
    expect(await contar('SELECT count(*)::text AS n FROM pacientes_da_exportacao WHERE clinica_id = $1 AND paciente_id = $2', [c.clinica, saiu])).toBe(0)
    const camp = await criarCampanha('faltas-e-desmarcacoes', { filtros, destino: { nova: nova() }, tarefa: tarefa() })
    expect(camp.status).toBe(422) // a lista ficou vazia: nada nasce
    expect(await contar('SELECT count(*)::text AS n FROM tarefas WHERE paciente_id = $1 AND campanha_id IS NOT NULL', [saiu])).toBe(0)
  })

  it('ADV-11 [achado B1]: o `tarefaId` da linha anônima do relatório 14 não reabre a paciente pela rota de tarefa', async () => {
    const saiu = await paciente('Iris Saiu', { telefone: '71977776666' })
    const t = await c.migrate.query<{ id: string }>(
      `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, historico)
       VALUES ($1, $2, $2, 'Consulta', '2026-10-05', 'Consulta agendada', $3, $4::jsonb) RETURNING id`,
      [c.clinica, c.pessoas['beatriz'], saiu, JSON.stringify([{ acao: 'noshow', etapa: 'faltou', em: '2026-10-05T15:00:00Z', porId: c.pessoas['beatriz'] }])],
    )
    await c.migrate.query(`UPDATE pacientes SET ativo = false, desativado_em = now(), motivo_desativacao = 'pediu-para-sair' WHERE id = $1`, [saiu])
    const r = await executar('faltas-e-desmarcacoes', { de: '2026-10-01', ate: '2026-10-31' }, 'beatriz')
    const linha = (r.body.linhas as { tarefaId: string; nome: string | null }[]).find((l) => l.nome === null)!
    const aberta = await pegar(c, `/v1/tarefas/${linha.tarefaId}`, {}, 'beatriz')
    // Medição: o que a rota de tarefa devolve da paciente desativada.
    console.info(`ADV-11 GET tarefa: ${aberta.status} pacienteId=${aberta.text.includes(saiu)} nome=${aberta.text.includes('Iris')}`)
    // Seguro: a linha anônima não carrega um id que devolve o nome e o id dela.
    expect(aberta.text.includes(saiu) || aberta.text.includes('Iris')).toBe(false)
  })
})

/* ============================================================ redação */

describe('ADV-12 — varredura de dinheiro nas 15 rotas, sem `valores`', () => {
  it('nenhum campo monetário preenchido, nenhuma coluna `dinheiro`, nenhum "R$" nem centavos em texto — tela e exportação', async () => {
    // Dinheiro em todo lugar: recebimento, saldo, conta, programa, orçamento.
    await semAtendimento()
    await c.migrate.query(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tipo, valor, valor_aberto, forma, recebido_em, registrado_por)
       VALUES ($1, $2, 'Consulta realizada', 12345, 6789, 'Pix', '2026-10-02T12:00:00Z', $3)`,
      [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
    )
    await c.migrate.query(
      `INSERT INTO contas_a_pagar (clinica_id, descricao, categoria, valor, vencimento, responsavel_id, forma_prevista)
       VALUES ($1, 'Aluguel', 'Ocupação', 250000, '2026-10-10', $2, 'Boleto')`,
      [c.clinica, c.pessoas['beatriz']],
    )
    const proc = (await c.migrate.query<{ id: string }>('SELECT id FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 1', [c.clinica])).rows[0]!
    expect(
      (await postar(c, '/v1/programas', { pacienteId: c.pacientes['bruna'], inicio: HOJE, itens: [{ chave: 'i1', procedimentoId: proc.id, sessoes: 2, intervaloDias: 7 }] }, 'beatriz'))
        .status,
    ).toBe(201)

    const periodo = { de: '2026-10-01', ate: '2026-10-31' }
    const filtrosDe: Record<string, Record<string, unknown>> = {
      'pacientes-sem-compra': { semCompraHaMeses: 1 },
      'pacientes-sem-atendimento': SEM_ATENDIMENTO,
      'pacientes-que-indicaram': periodo,
      'pacientes-por-procedimento': {},
      'pacientes-por-origem-e-campanha': periodo,
      aniversariantes: { mes: 10 },
      recebimentos: periodo,
      'saldos-em-aberto': {},
      contas: periodo,
      'saidas-de-estoque': { modo: 'calendario', ...periodo },
      'entradas-de-estoque': periodo,
      orcamentos: periodo,
      'faltas-e-desmarcacoes': periodo,
      'tarefas-da-equipe': periodo,
    }
    const dinheiroEmTexto = /R\$|\d+,\d{2}\b/
    const vazou = (x: unknown, onde: string): string[] =>
      Array.isArray(x)
        ? x.flatMap((y, i) => vazou(y, `${onde}[${i}]`))
        : typeof x === 'object' && x !== null
          ? Object.entries(x).flatMap(([k, v]) =>
              ehCampoMonetario(k) && v !== null && typeof v !== 'object'
                ? [`${onde}.${k}=${String(v)}`]
                : typeof v === 'string' && dinheiroEmTexto.test(v)
                  ? [`${onde}.${k}="${v}"`]
                  : vazou(v, `${onde}.${k}`),
            )
          : []

    // juliana (recepção, sem `valores`) com TODAS as permissões de relatório.
    const rodados: string[] = []
    await comPerms('pf_rec', ['programas', 'contas.gerir', 'estoque.gerir', 'cobrancas', 'finmes', 'tarefas.equipe'], async () => {
      for (const chave of CHAVES_DE_RELATORIO) {
        const def: DefinicaoDeRelatorio = CATALOGO_DE_RELATORIOS[chave]
        if (def.exigeTambem?.includes('valores')) continue // o 3: 403 (ADV-7)
        if (chave === 'recebimentos') {
          // `finmes` → `valores` (dependência da tabela): sem `valores`, o 8 não abre.
          expect((await executar(chave, periodo, 'juliana')).status).toBe(403)
          rodados.push(chave)
          continue
        }
        const filtros = filtrosDe[chave] ?? periodo
        for (const rota of ['execucoes', 'exportacoes'] as const) {
          const corpo = rota === 'execucoes' ? { filtros } : { filtros, formato: 'csv', finalidade: 'conferencia-interna' }
          const r = await postar(c, `/v1/relatorios/${chave}/${rota}`, corpo, 'juliana')
          expect(r.status, `${chave}/${rota}: ${r.text}`).toBe(200)
          expect(vazou(r.body, `${chave}/${rota}`)).toEqual([])
          const res = rota === 'execucoes' ? r.body : r.body.resultado
          expect((res.colunas as { tipo: string }[]).filter((x) => x.tipo === 'dinheiro'), chave).toEqual([])
          rodados.push(chave)
        }
      }
    })
    expect(new Set(rodados).size).toBe(CHAVES_DE_RELATORIO.length - 1)
  })

  it('toda coluna `dinheiro` do catálogo e todo campo de resumo em centavos tem nome que a redação apaga', () => {
    for (const chave of CHAVES_DE_RELATORIO) {
      for (const col of CATALOGO_DE_RELATORIOS[chave].colunas) {
        if (col.tipo === 'dinheiro') expect(ehCampoMonetario(col.chave), `${chave}.${col.chave}`).toBe(true)
      }
    }
    // Os nomes de dinheiro do T9 que NÃO são coluna (resumo).
    for (const k of ['aReceber', 'valorPago', 'custo', 'valorFechado', 'valor']) expect(CAMPOS_MONETARIOS).toContain(k)
  })
})
