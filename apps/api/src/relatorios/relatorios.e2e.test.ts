import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarOperadorDeTeste, apagarPacientesDaExportacaoDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparEstoque,
  limparFinanceiro,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
  botar,
} from '../tarefas/__tests__/cenario'
import { LIMITES_DO_MOTOR, LIMITES_PADRAO, type LimitesDoMotor } from './limites'

/**
 * T8 — o motor de relatórios, sobre Postgres real (seam HTTP da API).
 *
 * HOJE = sábado 24/10/2026 (America/Bahia); o relógio do servidor marca
 * 23:00 de hoje na clínica. `beatriz` (supervisão) vê tudo e tem `jornada`;
 * `juliana` (recepção) tem `pacientes` e `jornada`, sem `valores`; `camila`
 * (comercial) tem `valores` e ganha `estoque.gerir`, sem `jornada`; `sonia`
 * (caixa) é a persona do limite por hora. Todas ganham `indicadores`.
 */
let c: Cenario
// Mutável de propósito: o teste do 503 encurta o `statement_timeout`.
const limites: { -readonly [K in keyof LimitesDoMotor]: LimitesDoMotor[K] } = { ...LIMITES_PADRAO }

const URL_MIG = process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const executar = (chave: string, filtros: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/execucoes`, { filtros }, quem)
const exportar = (chave: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/relatorios/${chave}/exportacoes`, corpo, quem)

/** O limite por hora e o registro são da própria trilha: cada `it` começa do zero. */
async function zerarRegistros(): Promise<void> {
  await apagarPacientesDaExportacaoDeTeste(c.migrate, c.clinica)
  await c.migrate.query('DELETE FROM tentativas_de_relatorio WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('BEGIN')
  try {
    await c.migrate.query('ALTER TABLE auditoria DISABLE TRIGGER auditoria_sem_update')
    await c.migrate.query(
      `DELETE FROM auditoria WHERE clinica_id = $1 AND entidade IN ('relatorio', 'exportacao_de_relatorio')`,
      [c.clinica],
    )
    await c.migrate.query('ALTER TABLE auditoria ENABLE TRIGGER auditoria_sem_update')
    await c.migrate.query('COMMIT')
  } catch (e) {
    await c.migrate.query('ROLLBACK')
    throw e
  }
}

async function registros(entidade: string) {
  const r = await c.migrate.query<{ acao: string; entidade_id: string; para: Record<string, unknown>; ator_tipo: string; id: string }>(
    `SELECT id::text AS id, acao, entidade_id, para, ator_tipo FROM auditoria
      WHERE clinica_id = $1 AND entidade = $2 ORDER BY id`,
    [c.clinica, entidade],
  )
  return r.rows
}

/** Um recebimento direto, com as partes dele. `em` é instante UTC. */
async function receber(
  em: string,
  partes: readonly (readonly [string, number])[],
  paciente: string,
  extra: { tarefaId?: string; tipo?: string } = {},
): Promise<string> {
  const valor = partes.reduce((s, [, v]) => s + v, 0)
  await c.migrate.query('BEGIN')
  try {
    const r = await c.migrate.query<{ id: string }>(
      `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, recebido_em, registrado_por)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8) RETURNING id`,
      [
        c.clinica,
        paciente,
        extra.tarefaId ?? null,
        extra.tipo ?? 'Consulta realizada',
        valor,
        partes.length === 1 ? partes[0]![0] : '',
        em,
        c.pessoas['juliana'],
      ],
    )
    const id = r.rows[0]!.id
    if (partes.length > 1) {
      for (const [i, [forma, v]] of partes.entries()) {
        await c.migrate.query(
          `INSERT INTO recebimento_partes (clinica_id, recebimento_id, forma, valor, ordem) VALUES ($1, $2, $3, $4, $5)`,
          [c.clinica, id, forma, v, i],
        )
      }
    }
    await c.migrate.query('COMMIT')
    return id
  } catch (e) {
    await c.migrate.query('ROLLBACK')
    throw e
  }
}

const fecharCaixa = (dia: string) =>
  c.migrate.query(`INSERT INTO caixas_do_dia (clinica_id, dia, obs, fechado_por) VALUES ($1, $2::date, '', $3)`, [
    c.clinica,
    dia,
    c.pessoas['beatriz'],
  ])

/** Captura TUDO o que o processo escreve: Nest Logger (stdout/stderr) e console. */
async function capturar<T>(fn: () => Promise<T>): Promise<{ saida: string; valor: T }> {
  const pedacos: string[] = []
  const out = process.stdout.write.bind(process.stdout)
  const err = process.stderr.write.bind(process.stderr)
  const originais = { log: console.log, error: console.error, warn: console.warn, info: console.info, debug: console.debug }
  const guardar = (...a: unknown[]) => {
    pedacos.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))
  }
  process.stdout.write = ((s: string | Uint8Array, ...r: unknown[]) => {
    pedacos.push(String(s))
    return out(s, ...(r as []))
  }) as typeof process.stdout.write
  process.stderr.write = ((s: string | Uint8Array, ...r: unknown[]) => {
    pedacos.push(String(s))
    return err(s, ...(r as []))
  }) as typeof process.stderr.write
  console.log = console.error = console.warn = console.info = console.debug = guardar
  try {
    const valor = await fn()
    return { saida: pedacos.join('\n'), valor }
  } finally {
    process.stdout.write = out
    process.stderr.write = err
    Object.assign(console, originais)
  }
}

let procedimento: { id: string; nome: string }

beforeAll(async () => {
  c = await montarCenario('relatorios', [{ token: LIMITES_DO_MOTOR, valor: limites }])
  await c.migrate.query(
    `UPDATE perfis SET perms = perms || ARRAY['indicadores']
      WHERE clinica_id = $1 AND chave IN ('pf_sup', 'pf_rec', 'pf_ter', 'pf_cxa')`,
    [c.clinica],
  )
  await c.migrate.query(`UPDATE perfis SET perms = perms || ARRAY['estoque.gerir'] WHERE clinica_id = $1 AND chave = 'pf_ter'`, [
    c.clinica,
  ])
  const p = await c.migrate.query<{ id: string; nome: string }>(
    'SELECT id, nome FROM procedimentos WHERE clinica_id = $1 ORDER BY nome LIMIT 1',
    [c.clinica],
  )
  procedimento = p.rows[0]!
})
afterAll(async () => {
  await zerarRegistros()
  await limparEstoque(c)
  await limparFinanceiro(c)
  await limparTarefas(c)
  await c.migrate.query('DELETE FROM relatorios_favoritos WHERE clinica_id = $1', [c.clinica])
  await desmontarCenario(c)
})
beforeEach(async () => {
  Object.assign(limites, LIMITES_PADRAO)
  await zerarRegistros()
  await limparEstoque(c)
  await limparFinanceiro(c)
  await limparTarefas(c)
  await c.migrate.query('DELETE FROM relatorios_favoritos WHERE clinica_id = $1', [c.clinica])
})

/* ------------------------------------------------------------------ fixtures */

/** Ana comprou em jan e mar (LTV 700,00); Bruna comprou ontem. */
async function cenarioDeCompras(): Promise<void> {
  const t = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, tipo, paciente_id, procedimento_id, status, concluida_em)
     VALUES ($1, $2, $2, 'Procedimento', '2026-03-10', 'Procedimento agendado', $3, $4, 'concluida', '2026-03-10T15:00:00Z')
     RETURNING id`,
    [c.clinica, c.pessoas['beatriz'], c.pacientes['ana'], procedimento.id],
  )
  await receber('2026-01-10T15:00:00Z', [['Pix', 20000]], c.pacientes['ana']!)
  await receber('2026-03-10T15:00:00Z', [['Pix', 50000]], c.pacientes['ana']!, { tarefaId: t.rows[0]!.id })
  await receber('2026-10-23T15:00:00Z', [['Pix', 9000]], c.pacientes['bruna']!)
}

/**
 * Outubro: 05 (Pix 100,00, caixa fechado) · 06 (Dinheiro 200,00 + Pix 30,00
 * num recebimento só, e uma nota promissória de 50,00; caixa fechado) · 07
 * (Cartão 70,00, SEM caixa) · hoje (Dinheiro 33,33, caixa aberto).
 */
async function cenarioDeOutubro(): Promise<void> {
  await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-10-01' WHERE id = $1`, [c.clinica])
  await receber('2026-10-05T12:00:00Z', [['Pix', 10000]], c.pacientes['ana']!)
  await receber('2026-10-06T12:00:00Z', [['Dinheiro', 20000], ['Pix', 3000]], c.pacientes['bruna']!)
  await receber('2026-10-06T13:00:00Z', [['Nota promissória', 5000]], c.pacientes['ana']!)
  await receber('2026-10-07T12:00:00Z', [['Cartão de crédito', 7000]], c.pacientes['ana']!)
  await receber('2026-10-24T15:00:00Z', [['Dinheiro', 3333]], c.pacientes['bruna']!)
  await fecharCaixa('2026-10-05')
  await fecharCaixa('2026-10-06')
}

const OUTUBRO = { de: '2026-10-01', ate: '2026-10-31' }

/* ============================================================== números */

describe('relatório 8 — recebimentos (números c.10, c.15; appsec C11)', () => {
  it('relatorio-8-dia-aberto-sem-forma: o dia sem caixa e hoje saem sem valor e sem forma, também nos totais', async () => {
    await cenarioDeOutubro()
    const r = await executar('recebimentos', OUTUBRO)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const linhas = r.body.linhas as { data: string; forma: string | null; valor: string | null }[]
    expect(linhas).toHaveLength(6)
    const abertos = linhas.filter((x) => x.data === '2026-10-07' || x.data === HOJE)
    expect(abertos).toHaveLength(2)
    for (const l of abertos) expect(l).toMatchObject({ forma: null, valor: null })
    expect(r.body.resumo.porForma).toEqual([
      { rotulo: 'Dinheiro', valor: expect.objectContaining({ emDinheiro: '20000' }) },
      { rotulo: 'Nota promissória', valor: expect.objectContaining({ emDinheiro: '5000' }) },
      { rotulo: 'Pix', valor: expect.objectContaining({ emDinheiro: '13000' }) },
    ])
    expect(r.body.resumo.total.emDinheiro).toBe('38000')
    // O aguardando é UM total, sem o hoje (regra 6), nunca por dia nem por forma.
    expect(r.body.resumo.aguardandoFechamento).toBe('7000')
    // Transporte (c.10): o dinheiro de hoje não atravessa sob nome nenhum.
    expect(r.text).not.toContain('3333')
    expect(r.text).not.toContain('23333')
  })

  it('relatorio-8-hoje-aguardando-a-parte: os dias ANTERIORES têm contagem e valor; hoje é só um sinal, sem valor', async () => {
    // Defeito de produção (17/11/2026): com só hoje aguardando, a tela dizia
    // "Mais R$ 0,00 em 1 dia" — a contagem incluía hoje e o valor não.
    await cenarioDeOutubro()
    const r = await executar('recebimentos', OUTUBRO)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.resumo).toMatchObject({ aguardandoFechamento: '7000', diasAnterioresAguardando: 1, hojeAguardando: true })
    expect(r.body.resumo).not.toHaveProperty('diasAguardando')

    // Só hoje aguardando: nenhum dia anterior, nenhum valor, e o sinal de hoje.
    await fecharCaixa('2026-10-07')
    const soHoje = await executar('recebimentos', OUTUBRO)
    expect(soHoje.body.resumo).toMatchObject({ aguardandoFechamento: '0', diasAnterioresAguardando: 0, hojeAguardando: true })
    expect(soHoje.text).not.toContain('3333')


    // Caixa de hoje fechado: hoje conta, e não aguarda mais.
    await fecharCaixa(HOJE)
    const fechado = await executar('recebimentos', OUTUBRO)
    expect(fechado.body.resumo).toMatchObject({ aguardandoFechamento: '0', diasAnterioresAguardando: 0, hojeAguardando: false })
  })

  it('relatorio-8-hoje-aguardando-sem-pagamento: o sinal de hoje não depende de haver pagamento hoje (C11)', async () => {
    await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-10-01' WHERE id = $1`, [c.clinica])
    await receber('2026-10-05T12:00:00Z', [['Pix', 10000]], c.pacientes['ana']!)
    await fecharCaixa('2026-10-05')
    const r = await executar('recebimentos', OUTUBRO)
    expect(r.body.resumo).toMatchObject({ diasAnterioresAguardando: 0, hojeAguardando: true })
    // Período que não chega a hoje: hoje não é assunto.
    const setembro = await executar('recebimentos', { de: '2026-09-01', ate: '2026-09-30' })
    expect(setembro.body.resumo).toMatchObject({ diasAnterioresAguardando: 0, hojeAguardando: false })
  })

  it('relatorio-8-bate-com-visao-com-promissoria: Σ linhas = `recebido` da Visão do mês, centavo a centavo', async () => {
    await cenarioDeOutubro()
    await fecharCaixa('2026-10-07')
    await fecharCaixa(HOJE)
    const r = await executar('recebimentos', OUTUBRO)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const soma = (r.body.linhas as { valor: string }[]).reduce((s, l) => s + BigInt(l.valor), 0n)
    const v = await pegar(c, '/v1/visao-do-mes', { mes: '2026-10' }, 'beatriz')
    expect(v.statusCode).toBe(200)
    expect(soma.toString()).toBe(v.body.recebido)
    expect(soma).toBe(48333n)
    expect(r.body.resumo.total.emDinheiro).toBe('48333')
    // A promissória está nas linhas: receita fora da gaveta, e ainda receita.
    expect((r.body.linhas as { forma: string }[]).some((l) => l.forma === 'Nota promissória')).toBe(true)
    expect(r.body.resumo.aguardandoFechamento).toBe('0')
  })

  it('mês passado espelha a Visão daquele mês: o dia sem caixa conta (ADR chaves-em-reais-e-os-dias-de-caixa)', async () => {
    await c.migrate.query(`UPDATE clinicas SET conferencia_desde = '2026-09-01' WHERE id = $1`, [c.clinica])
    await receber('2026-09-10T12:00:00Z', [['Pix', 4100]], c.pacientes['ana']!)
    await receber('2026-09-11T12:00:00Z', [['Dinheiro', 900]], c.pacientes['bruna']!)
    await fecharCaixa('2026-09-11')
    const r = await executar('recebimentos', { de: '2026-09-01', ate: '2026-09-30' })
    const soma = (r.body.linhas as { valor: string }[]).reduce((s, l) => s + BigInt(l.valor), 0n)
    const v = await pegar(c, '/v1/visao-do-mes', { mes: '2026-09' }, 'beatriz')
    expect(soma.toString()).toBe(v.body.recebido)
    expect(r.body.resumo).toMatchObject({ aguardandoFechamento: '0', diasAnterioresAguardando: 0, hojeAguardando: false, recebimentos: 2 })
  })

  it('relatorio-8-contagem-distinta: "N recebimentos" conta recebimento, não parte', async () => {
    await cenarioDeOutubro()
    const r = await executar('recebimentos', OUTUBRO)
    const contam = (r.body.linhas as { valor: string | null }[]).filter((l) => l.valor !== null)
    // Quatro partes que contam (Pix · Dinheiro + Pix · promissória), três recebimentos.
    expect(contam).toHaveLength(4)
    expect(r.body.resumo.recebimentos).toBe(3)
  })

  it('sem `finmes`, o 8 é 403; e a data de período maior que 24 meses é 422', async () => {
    expect((await executar('recebimentos', OUTUBRO, 'juliana')).statusCode).toBe(403)
    expect((await executar('recebimentos', { de: '2024-01-01', ate: '2026-10-31' })).statusCode).toBe(422)
  })
})

describe('relatório 11 — saídas de estoque (números B8)', () => {
  let item: string

  /**
   * Frasco a R$ 100,00. Contagem 5 em 01/10 · dose 0,8 em 05/10 (Ana) · a
   * sessão REABERTA em 06/10 (compensação +0,8) e concluída de novo (−0,8) ·
   * sobra de frasco descartada (−0,2) · contagem 3 em 20/10.
   */
  async function cenarioDoFrasco(): Promise<void> {
    item = (
      await c.migrate.query<{ id: string }>(
        `INSERT INTO itens_de_estoque (clinica_id, nome, medida, custo, aproveita_sobra) VALUES ($1, 'Frasco relatorio', 'frasco', 10000, false) RETURNING id`,
        [c.clinica],
      )
    ).rows[0]!.id
    const mov = async (tipo: string, milesimos: number, dia: string, extra: { paciente?: boolean; motivo?: string; compensa?: string } = {}) =>
      (
        await c.migrate.query<{ id: string }>(
          `INSERT INTO movimentos_de_estoque (clinica_id, item_id, tipo, milesimos, dia, paciente_id, motivo, compensa_id, compensa_motivo, criado_por)
           VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10) RETURNING id`,
          [
            c.clinica,
            item,
            tipo,
            milesimos,
            dia,
            extra.paciente === true ? c.pacientes['ana'] : null,
            extra.motivo ?? '',
            extra.compensa ?? null,
            extra.compensa === undefined ? '' : 'sessao-reaberta',
            c.pessoas['nara'],
          ],
        )
      ).rows[0]!.id
    await mov('contagem', 5000, '2026-10-01')
    const dose = await mov('consumo', -800, '2026-10-05', { paciente: true })
    await mov('consumo', 800, '2026-10-06', { compensa: dose })
    await mov('consumo', -800, '2026-10-06', { paciente: true })
    await mov('descarte', -200, '2026-10-06', { motivo: 'Sobra de frasco aberto' })
    await mov('entrada', 1000, '2026-10-10')
    await mov('contagem', 3000, '2026-10-20')
  }

  it('saidas-batem-com-analise-reabertura: por item, Σ das linhas = `saidasEmEstoque` da Análise, e a reabertura soma uma vez', async () => {
    await cenarioDoFrasco()
    const r = await executar('saidas-de-estoque', { modo: 'analise', ...OUTUBRO })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const linhas = r.body.linhas as { itemId: string; quantidadeEmEstoque: { milesimos: string }; custo: string; motivo: string }[]
    expect(linhas).toHaveLength(4)
    // A compensação é uma linha NEGATIVA, e a entrada não aparece.
    expect(linhas.map((l) => l.quantidadeEmEstoque.milesimos)).toEqual(['800', '-800', '800', '200'])
    const soma = linhas.reduce((s, l) => s + BigInt(l.quantidadeEmEstoque.milesimos), 0n)

    const a = await pegar(c, '/v1/estoque/analise', OUTUBRO, 'beatriz')
    expect(a.statusCode).toBe(200)
    const daAnalise = (a.body.itens as { itemId: string; saidasEmEstoque: { milesimos: string } }[]).find((i) => i.itemId === item)!
    expect(soma.toString()).toBe(daAnalise.saidasEmEstoque.milesimos)
    // Custo por linha meio-para-cima, e o total é a soma das linhas.
    expect(linhas.map((l) => l.custo)).toEqual(['8000', '-8000', '8000', '2000'])
    expect(r.body.resumo.custo).toBe('10000')
    expect(linhas[1]!.motivo).toContain('Compensação')
  })

  it('sobra-de-frasco-dose-mais-descarte: item sem aproveitamento dá dose + descarte = 1 unidade', async () => {
    await cenarioDoFrasco()
    const r = await executar('saidas-de-estoque', { modo: 'calendario', de: '2026-10-06', ate: '2026-10-06' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const linhas = r.body.linhas as { quantidadeEmEstoque: { milesimos: string }; motivo: string }[]
    const dose = linhas.find((l) => l.motivo === 'Consumo')!
    const sobra = linhas.find((l) => l.motivo.includes('Sobra de frasco aberto'))!
    expect(BigInt(dose.quantidadeEmEstoque.milesimos) + BigInt(sobra.quantidadeEmEstoque.milesimos)).toBe(1000n)
    // O modo calendário não tem a contagem de 01/10: só as saídas do dia.
    expect(linhas).toHaveLength(3)
  })

  it('saude-exige-jornada (11): com `jornada`, a coluna de paciente e a classe saude; sem, o relatório segue sem a coluna', async () => {
    await cenarioDoFrasco()
    const com = await executar('saidas-de-estoque', { modo: 'analise', ...OUTUBRO, incluirPaciente: true })
    expect(com.body.classe).toBe('saude')
    expect((com.body.colunas as { chave: string }[]).map((x) => x.chave)).toContain('paciente')
    expect(com.text).toContain('Ana Lúcia Souza')

    const sem = await executar('saidas-de-estoque', { modo: 'analise', ...OUTUBRO, incluirPaciente: true }, 'camila')
    expect(sem.statusCode, JSON.stringify(sem.body)).toBe(200)
    expect(sem.body.classe).toBe('nenhuma')
    expect((sem.body.colunas as { chave: string }[]).map((x) => x.chave)).not.toContain('paciente')
    expect(sem.text).not.toContain('Ana Lúcia')
    expect(sem.text).not.toContain(c.pacientes['ana']!)
  })
})

describe('relatório 15 — tarefas da equipe', () => {
  it('o resumo do 15 é igual ao bloco `prazos` do Painel, e a tarefa de paciente sai sem o nome dela', async () => {
    const t = (descricao: string, prazo: string, concluidaEm: string | null, paciente: string | null = null) =>
      c.migrate.query(
        `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em, tipo, paciente_id)
         VALUES ($1, $2, $2, $3, $4::date,
                 CASE WHEN $5::timestamptz IS NULL THEN 'aberta' ELSE 'concluida' END::status_de_tarefa, $5::timestamptz,
                 CASE WHEN $6::uuid IS NULL THEN '' ELSE 'Procedimento agendado' END, $6::uuid)`,
        [c.clinica, c.pessoas['beatriz'], descricao, prazo, concluidaEm, paciente],
      )
    await t('No prazo', '2026-10-10', '2026-10-09T15:00:00Z')
    await t('Com atraso', '2026-10-10', '2026-10-12T15:00:00Z')
    await t('Atrasada', '2026-10-20', null)
    await t('A vencer', '2026-10-28', null)
    await t('Retorno da Ana Lúcia · Tirzepatida', '2026-10-21', null, c.pacientes['ana']!)

    const r = await executar('tarefas-da-equipe', OUTUBRO)
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const p = await pegar(c, '/v1/painel', { periodo: 'per', ...OUTUBRO }, 'beatriz')
    expect(p.statusCode, JSON.stringify(p.body)).toBe(200)
    expect(r.body.resumo.prazos).toEqual(p.body.prazos)
    expect(r.body.linhas).toHaveLength(r.body.resumo.prazos.total)
    expect(r.text).not.toContain('Ana Lúcia')
    expect(r.text).not.toContain('Tirzepatida')
    expect((r.body.linhas as { tarefa: string }[]).map((l) => l.tarefa)).toContain('Procedimento agendado')

    // Filtrado por responsável: o recorte por pessoa do Painel; id de fora é 422.
    const dela = await executar('tarefas-da-equipe', { ...OUTUBRO, responsavelId: c.pessoas['beatriz'] })
    expect(dela.body.resumo.prazos).toEqual(p.body.prazos)
    expect((await executar('tarefas-da-equipe', { ...OUTUBRO, responsavelId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(422)
  })
})

/* ============================================================ relatório 1 */

describe('relatório 1 — pacientes sem compra', () => {
  it('lista quem não compra há X meses, com o LTV da ficha; sem `valores`, sem as colunas de dinheiro', async () => {
    await cenarioDeCompras()
    const r = await executar('pacientes-sem-compra', { semCompraHaMeses: 3 })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.linhas).toEqual([
      { pacienteId: c.pacientes['ana'], nome: 'Ana Lúcia Souza', ultimaCompra: '2026-03-10', valorDaUltimaCompra: '50000', ltv: '70000' },
    ])
    const ficha = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}`, {}, 'beatriz')
    expect(JSON.stringify(ficha.body)).toContain('"ltv":"70000"')

    const j = await executar('pacientes-sem-compra', { semCompraHaMeses: 3 }, 'juliana')
    expect(j.statusCode).toBe(200)
    expect((j.body.colunas as { tipo: string }[]).some((x) => x.tipo === 'dinheiro')).toBe(false)
    expect(j.body.linhas[0]).toMatchObject({ ltv: null, valorDaUltimaCompra: null })
    expect(j.text).not.toContain('70000')
  })

  it('o filtro de procedimento: só quem comprou, a coluna aparece, e a classe sobe para saude', async () => {
    await cenarioDeCompras()
    await receber('2026-02-01T15:00:00Z', [['Pix', 1000]], c.pacientes['bruna']!)
    await c.migrate.query(`UPDATE recebimentos SET recebido_em = '2026-02-01T15:00:00Z' WHERE paciente_id = $1`, [c.pacientes['bruna']])
    const r = await executar('pacientes-sem-compra', { semCompraHaMeses: 3, procedimentoId: procedimento.id })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.classe).toBe('saude')
    expect((r.body.linhas as { nome: string; procedimento: string }[]).map((l) => [l.nome, l.procedimento])).toEqual([
      ['Ana Lúcia Souza', procedimento.nome],
    ])
    expect(r.body.cabecalho.filtrosEmTexto).toContain(`Procedimento: ${procedimento.nome}`)
  })

  it('saude-exige-jornada (1): o 1 filtrado por procedimento sem `jornada` é 403; sem o filtro, 200', async () => {
    await cenarioDeCompras()
    expect((await executar('pacientes-sem-compra', { semCompraHaMeses: 3, procedimentoId: procedimento.id }, 'camila')).statusCode).toBe(403)
    expect((await executar('pacientes-sem-compra', { semCompraHaMeses: 3 }, 'camila')).statusCode).toBe(200)
  })
})

/* ====================================================== execução segura */

describe('execução segura (appsec C12–C15; LGPD L-IN-8, L-IN-16)', () => {
  it('relatorio-filtro-desconhecido-422: chave extra, tipo errado e relatório inexistente', async () => {
    expect((await executar('pacientes-sem-compra', { semCompraHaMeses: 3, nome: 'Ana' })).statusCode).toBe(422)
    expect((await executar('pacientes-sem-compra', { semCompraHaMeses: '3' })).statusCode).toBe(422)
    expect((await postar(c, '/v1/relatorios/recebimentos/execucoes', { filtros: OUTUBRO, ordenarPor: 'valor' }, 'beatriz')).statusCode).toBe(422)
    expect((await executar('nao-existe', {})).statusCode).toBe(404)
    // Erro não grava (L-IN-8).
    expect(await registros('relatorio')).toEqual([])
  })

  it('relatorio-pg-sleep-inerte: SQL no filtro não chega ao banco', async () => {
    const antes = Date.now()
    const r = await executar('pacientes-sem-compra', {
      semCompraHaMeses: 3,
      procedimentoId: "00000000-0000-4000-8000-000000000000'; SELECT pg_sleep(5)--",
    })
    expect(r.statusCode).toBe(422)
    expect(Date.now() - antes).toBeLessThan(2000)
    const s = await executar("pacientes-sem-compra';SELECT pg_sleep(5)--", { semCompraHaMeses: 3 })
    expect(s.statusCode).toBe(404)
  })

  it('geracao-registrada-com-contagem: `acessou` + `relatorio`, com filtros, classe e quantidade de linhas', async () => {
    await cenarioDeCompras()
    const r = await executar('pacientes-sem-compra', { semCompraHaMeses: 3 })
    expect(r.statusCode).toBe(200)
    const [linha, ...resto] = await registros('relatorio')
    expect(resto).toEqual([])
    expect(linha).toMatchObject({
      acao: 'acessou',
      entidade_id: 'pacientes-sem-compra',
      para: { relatorio: 'pacientes-sem-compra', filtros: { semCompraHaMeses: 3 }, classe: 'pessoal', linhas: 1 },
    })
    // Nenhum nome, telefone nem valor no detalhe.
    expect(JSON.stringify(linha!.para)).not.toMatch(/Ana|70000|98888/)
  })

  it('relatorio-61-execucao-429: 60 por pessoa por hora; a 61ª é 429', async () => {
    for (let i = 0; i < 59; i++) {
      await c.migrate.query(
        `INSERT INTO tentativas_de_relatorio (clinica_id, ator_id) VALUES ($1, $2)`,
        [c.clinica, c.pessoas['sonia']],
      )
    }
    expect((await executar('pacientes-sem-compra', { semCompraHaMeses: 3 }, 'sonia')).statusCode).toBe(200)
    const r = await executar('pacientes-sem-compra', { semCompraHaMeses: 3 }, 'sonia')
    expect(r.statusCode).toBe(429)
    // O limite é da PESSOA: a supervisão continua rodando.
    expect((await executar('pacientes-sem-compra', { semCompraHaMeses: 3 }, 'beatriz')).statusCode).toBe(200)
  })

  it('relatorio-timeout-503: a consulta que estoura o tempo é 503, sem linha e sem registro', async () => {
    limites.tempoMaximoMs = 400
    const trava = new pg.Client({ connectionString: URL_MIG })
    await trava.connect()
    try {
      await trava.query('BEGIN')
      await trava.query('LOCK TABLE itens_de_estoque IN ACCESS EXCLUSIVE MODE')
      const r = await executar('saidas-de-estoque', { modo: 'analise', ...OUTUBRO })
      expect(r.statusCode).toBe(503)
      expect(r.body.linhas).toBeUndefined()
    } finally {
      await trava.query('ROLLBACK')
      await trava.end()
    }
    expect(await registros('relatorio')).toEqual([])
  })

  it('registro-de-acesso-falha-fechado e relatorio-filtros-fora-do-log: sem registro, nenhuma linha sai — e o log não leva conteúdo', async () => {
    await cenarioDeCompras()
    const sufixo = randomBytes(4).toString('hex')
    await c.migrate.query(
      `CREATE FUNCTION recusa_registro_${sufixo}() RETURNS trigger LANGUAGE plpgsql AS $f$
       BEGIN RAISE EXCEPTION 'registro recusado Ana Lúcia Souza 70000'; END $f$`,
    )
    await c.migrate.query(
      `CREATE TRIGGER recusa_registro_${sufixo} BEFORE INSERT ON auditoria FOR EACH ROW
         WHEN (NEW.clinica_id = '${c.clinica}'::uuid AND NEW.entidade = 'relatorio')
         EXECUTE FUNCTION recusa_registro_${sufixo}()`,
    )
    try {
      const { saida, valor: r } = await capturar(() =>
        executar('pacientes-sem-compra', { semCompraHaMeses: 3, procedimentoId: procedimento.id }),
      )
      expect(r.statusCode).toBe(500)
      expect(r.text).not.toContain('Ana')
      expect(r.text).not.toContain('70000')
      expect(r.body.linhas).toBeUndefined()
      // O log: nem o filtro, nem a mensagem do Postgres, nem linha.
      expect(saida).not.toContain(procedimento.id)
      expect(saida).not.toContain('Ana')
      expect(saida).not.toContain('70000')
      expect(saida).not.toContain('semCompraHaMeses')
    } finally {
      await c.migrate.query(`DROP TRIGGER recusa_registro_${sufixo} ON auditoria`)
      await c.migrate.query(`DROP FUNCTION recusa_registro_${sufixo}()`)
    }
    expect(await registros('relatorio')).toEqual([])
  })

  it('log-sem-conteudo-relatorios: geração, exportação e 422 não escrevem filtro, paciente nem valor', async () => {
    await cenarioDeCompras()
    const { saida } = await capturar(async () => {
      await executar('pacientes-sem-compra', { semCompraHaMeses: 3, procedimentoId: procedimento.id })
      await exportar('pacientes-sem-compra', {
        filtros: { semCompraHaMeses: 3, procedimentoId: procedimento.id },
        formato: 'csv',
        incluirTelefone: true,
        finalidade: 'conferencia-interna',
      })
      await executar('pacientes-sem-compra', { semCompraHaMeses: 3, segredo: 'SEGREDO-NO-FILTRO' })
    })
    for (const proibido of [procedimento.id, 'Ana Lúcia', '98888', '70000', 'SEGREDO-NO-FILTRO']) {
      expect(saida).not.toContain(proibido)
    }
  })
})

/* ============================================================ exportação */

describe('exportação (LGPD L-IN-5, L-IN-6, L-IN-9 a L-IN-12; appsec C8)', () => {
  it('exportacao-sem-telefone-por-padrao: o telefone só sai com "Incluir telefone", e só no relatório que o tem', async () => {
    await cenarioDeCompras()
    const sem = await exportar('pacientes-sem-compra', { filtros: { semCompraHaMeses: 3 }, formato: 'csv' })
    expect(sem.statusCode, JSON.stringify(sem.body)).toBe(200)
    expect(Object.keys(sem.body.resultado.linhas[0])).not.toContain('telefone')
    expect(sem.text).not.toContain('98888')
    const com = await exportar('pacientes-sem-compra', { filtros: { semCompraHaMeses: 3 }, formato: 'csv', incluirTelefone: true })
    expect(com.body.resultado.linhas[0].telefone).toBe('(71) 98888-7777')
    expect((com.body.resultado.colunas as { chave: string }[]).map((x) => x.chave)).toContain('telefone')
    expect((await exportar('tarefas-da-equipe', { filtros: OUTUBRO, formato: 'csv', incluirTelefone: true })).statusCode).toBe(422)
  })

  it('codigo-da-exportacao-bate-com-auditoria: o código do arquivo é a linha `exportou` da trilha', async () => {
    await cenarioDeCompras()
    const r = await exportar('pacientes-sem-compra', { filtros: { semCompraHaMeses: 3 }, formato: 'xlsx' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    const { codigo, nomeDoArquivo, cabecalho } = r.body.exportacao
    expect(nomeDoArquivo).toBe(`fir-pacientes-sem-compra-20261024-${codigo}.xlsx`)
    expect(cabecalho).toMatchObject({
      clinica: 'Clínica Tarefas',
      relatorio: 'Pacientes sem compra',
      geradoEm: '24/10/2026 23:00',
      exportadoPor: 'Beatriz',
      codigo,
      finalidade: null,
    })
    expect(cabecalho.aviso).toContain('Contém dados pessoais de pacientes de Clínica Tarefas')
    const [linha] = await registros('exportacao_de_relatorio')
    expect(linha).toMatchObject({
      acao: 'exportou',
      entidade_id: codigo,
      para: { relatorio: 'pacientes-sem-compra', formato: 'xlsx', classe: 'pessoal', linhas: 1, optIn: [], finalidade: null },
    })
    // A exportação NÃO é também uma geração: uma linha só por pedido.
    expect(await registros('relatorio')).toEqual([])
    // R-b: o filtro "Exportações" de Atividades é a ação.
    const at = await pegar(c, '/v1/atividades', { acao: 'exportou' }, 'beatriz')
    expect(at.statusCode, JSON.stringify(at.body)).toBe(200)
    expect(at.body.itens).toEqual([expect.objectContaining({ acao: 'exportou', assunto: 'exportacao_de_relatorio' })])
  })

  it('exportacao-saude-sem-finalidade-422: classe saude pede finalidade enumerada, e ela vai para o aviso e para a trilha', async () => {
    await cenarioDeCompras()
    const filtros = { semCompraHaMeses: 3, procedimentoId: procedimento.id }
    expect((await exportar('pacientes-sem-compra', { filtros, formato: 'csv' })).statusCode).toBe(422)
    expect((await exportar('pacientes-sem-compra', { filtros, formato: 'csv', finalidade: 'curiosidade' })).statusCode).toBe(422)
    const r = await exportar('pacientes-sem-compra', { filtros, formato: 'impressao', finalidade: 'recall-de-lote' })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(200)
    expect(r.body.exportacao.nomeDoArquivo).toMatch(/\.pdf$/)
    expect(r.body.exportacao.cabecalho.aviso).toBe(
      'Contém dados pessoais sensíveis de saúde (LGPD, art. 11). Uso restrito a: Recall de lote. Não encaminhe, não imprima sem necessidade e apague o arquivo ao terminar.',
    )
    expect((await registros('exportacao_de_relatorio'))[0]!.para).toMatchObject({ classe: 'saude', finalidade: 'recall-de-lote' })
  })

  it('pacientes-da-exportacao-n-linhas: um id por paciente do arquivo, nunca nome', async () => {
    await cenarioDeCompras()
    for (let i = 1; i <= 4; i++) {
      const p = await c.migrate.query<{ id: string }>(
        `INSERT INTO pacientes (clinica_id, nome, telefone) VALUES ($1, $2, '') RETURNING id`,
        [c.clinica, `Paciente Export ${i}`],
      )
      await receber('2026-02-0' + i + 'T15:00:00Z', [['Pix', 1000 * i]], p.rows[0]!.id)
    }
    const r = await exportar('pacientes-sem-compra', { filtros: { semCompraHaMeses: 3 }, formato: 'csv' })
    expect(r.statusCode).toBe(200)
    const ids = (r.body.resultado.linhas as { pacienteId: string }[]).map((l) => l.pacienteId).sort()
    expect(ids).toHaveLength(5)
    const [linha] = await registros('exportacao_de_relatorio')
    const gravados = await c.migrate.query<{ paciente_id: string }>(
      'SELECT paciente_id FROM pacientes_da_exportacao WHERE clinica_id = $1 AND exportacao_id = $2 ORDER BY paciente_id',
      [c.clinica, linha!.id],
    )
    expect(gravados.rows.map((x) => x.paciente_id).sort()).toEqual(ids)
    const colunas = await c.migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'pacientes_da_exportacao' ORDER BY column_name`,
    )
    expect(colunas.rows.map((x) => x.column_name)).toEqual(['clinica_id', 'criado_em', 'exportacao_id', 'id', 'paciente_id'])
  })

  it('pacientes-da-exportacao-so-insert: fir_app só lê e insere; o dono esbarra na trigger', async () => {
    const priv = await c.migrate.query<{ p: string; ok: boolean }>(
      `SELECT p, has_table_privilege('fir_app', 'pacientes_da_exportacao', p) AS ok
         FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p`,
    )
    expect(Object.fromEntries(priv.rows.map((x) => [x.p, x.ok]))).toEqual({
      SELECT: true,
      INSERT: true,
      UPDATE: false,
      DELETE: false,
      TRUNCATE: false,
    })
    await expect(c.migrate.query('UPDATE pacientes_da_exportacao SET criado_em = now() WHERE clinica_id = $1', [c.clinica])).rejects.toThrow(
      /append-only/,
    )
    await expect(c.migrate.query('DELETE FROM pacientes_da_exportacao WHERE clinica_id = $1', [c.clinica])).rejects.toThrow(/append-only/)
  })

  it('nenhuma-string-com-dinheiro: cabeçalho, filtros em texto e resumo não carregam valor', async () => {
    await cenarioDeCompras()
    await cenarioDeOutubro()
    const um = await exportar('pacientes-sem-compra', {
      filtros: { semCompraHaMeses: 3, valorMinimo: '12345', valorMaximo: '99999999' },
      formato: 'csv',
    })
    expect(um.statusCode, JSON.stringify(um.body)).toBe(200)
    expect(um.body.exportacao.cabecalho.filtrosEmTexto).toContain('Faixa de valor aplicada')
    const oito = await exportar('recebimentos', { filtros: OUTUBRO, formato: 'csv' })
    expect(oito.statusCode).toBe(200)
    const strings: string[] = []
    const juntar = (x: unknown): void => {
      if (typeof x === 'string') strings.push(x)
      else if (Array.isArray(x)) x.forEach(juntar)
      else if (x !== null && typeof x === 'object') {
        for (const [k, v] of Object.entries(x)) {
          // Os campos monetários TIPADOS (centavos em texto) são a forma certa; o que se proíbe é o texto.
          if (['emDinheiro', 'aguardandoFechamento', 'custo'].includes(k)) continue
          juntar(v)
        }
      }
    }
    for (const r of [um, oito]) {
      juntar(r.body.exportacao.cabecalho)
      juntar(r.body.resultado.cabecalho)
      juntar(r.body.resultado.resumo)
    }
    for (const s of strings) {
      expect(s, s).not.toMatch(/R\$|12345|99999999|123,45|\d+,\d{2}\b/)
    }
  })

  it('suporte-nao-exporta-pessoal-nem-saude: o operador vê (registrado) e exporta só a classe nenhuma', async () => {
    const sufixo = randomBytes(4).toString('hex')
    const usuario = `rel.${sufixo}`
    const senha = 'doze-pedras-no-caminho'
    const http = () => request(c.app.getHttpServer())
    const pares = (r: { headers: Record<string, string> }): string => {
      const v = r.headers['set-cookie'] as unknown
      const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
      return lista.map((x) => x.split(';')[0]!).join('; ')
    }
    const operadorId = (
      await c.migrate.query<{ id: string }>(`INSERT INTO operadores (usuario, nome, senha_hash) VALUES ($1, 'Dono do Painel', $2) RETURNING id`, [
        usuario,
        await hashDeSenha(senha),
      ])
    ).rows[0]!.id
    try {
      const painel = pares(await http().post('/v1/superadmin/entrar').send({ usuario, senha }).expect(200))
      const suporte = pares(await http().post(`/v1/superadmin/clinicas/${c.clinica}/sessao-de-suporte`).set('Cookie', painel).expect(201))
      const como = (url: string, corpo: Record<string, unknown>) => http().post(url).set('Cookie', suporte).send(corpo)

      await cenarioDeCompras()
      const ver = await como('/v1/relatorios/pacientes-sem-compra/execucoes', { filtros: { semCompraHaMeses: 3 } })
      expect(ver.statusCode, JSON.stringify(ver.body)).toBe(200)
      expect((await registros('relatorio'))[0]).toMatchObject({ ator_tipo: 'operador' })
      const pessoal = await como('/v1/relatorios/pacientes-sem-compra/exportacoes', { filtros: { semCompraHaMeses: 3 }, formato: 'csv' })
      expect(pessoal.statusCode).toBe(403)
      const saude = await como('/v1/relatorios/saidas-de-estoque/exportacoes', {
        filtros: { modo: 'analise', ...OUTUBRO, incluirPaciente: true },
        formato: 'csv',
        finalidade: 'recall-de-lote',
      })
      expect(saude.statusCode).toBe(403)
      const nenhuma = await como('/v1/relatorios/tarefas-da-equipe/exportacoes', { filtros: OUTUBRO, formato: 'csv' })
      expect(nenhuma.statusCode, JSON.stringify(nenhuma.body)).toBe(200)
      expect(nenhuma.body.exportacao.cabecalho.exportadoPor).toBe('Dono do Painel')
      // O favorito é de uma pessoa da clínica: o suporte não escreve.
      expect((await como('/v1/relatorios/favoritos', { chave: 'tarefas-da-equipe', nome: 'Suporte', filtros: OUTUBRO })).statusCode).toBe(403)
    } finally {
      await declararAtorSistema(c.migrate)
      await zerarRegistros()
      await c.migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [usuario])
      await c.migrate.query('DELETE FROM sessoes WHERE operador_id = $1', [operadorId])
      const m = new pg.Client({ connectionString: URL_MIG })
      await m.connect()
      await declararAtorSistema(m)
      await apagarOperadorDeTeste(m, operadorId)
      await m.end()
    }
  })
})

/* ============================================================== favoritos */

describe('favoritos (appsec C9, C19; LGPD L-IN-17)', () => {
  it('favorito-chave-extra-422: o filtro passa pelo schema do relatório na escrita', async () => {
    const r = await postar(c, '/v1/relatorios/favoritos', { chave: 'recebimentos', nome: 'Mês', filtros: { ...OUTUBRO, paciente: 'Ana' } }, 'beatriz')
    expect(r.statusCode).toBe(422)
    const nome = await postar(c, '/v1/relatorios/favoritos', { chave: 'recebimentos', nome: 'x'.repeat(81), filtros: OUTUBRO }, 'beatriz')
    expect(nome.statusCode).toBe(422)
    const ok = await postar(c, '/v1/relatorios/favoritos', { chave: 'recebimentos', nome: 'Outubro', filtros: OUTUBRO }, 'beatriz')
    expect(ok.statusCode, JSON.stringify(ok.body)).toBe(201)
    expect(ok.body).toMatchObject({ chave: 'recebimentos', nome: 'Outubro', filtros: OUTUBRO, desatualizado: false })
    const repetido = await postar(c, '/v1/relatorios/favoritos', { chave: 'recebimentos', nome: ' outubro ', filtros: OUTUBRO }, 'beatriz')
    expect(repetido.statusCode).toBe(409)
    // Edita e arquiva; o arquivado libera o nome.
    expect((await botar(c, `/v1/relatorios/favoritos/${ok.body.id}`, { nome: 'Outubro 2026' }, 'beatriz')).body.nome).toBe('Outubro 2026')
    expect((await botar(c, `/v1/relatorios/favoritos/${ok.body.id}`, { filtros: { de: 'x' } }, 'beatriz')).statusCode).toBe(422)
    expect((await postar(c, `/v1/relatorios/favoritos/${ok.body.id}/arquivar`, {}, 'beatriz')).statusCode).toBe(204)
    const lista = await pegar(c, '/v1/relatorios', {}, 'beatriz')
    expect(lista.body.favoritos).toEqual([])
  })

  it('favorito-faixa-de-valor-redigido-e-403: sem `valores`, a faixa sai null e rodar dá 403', async () => {
    await cenarioDeCompras()
    const salvo = await postar(
      c,
      '/v1/relatorios/favoritos',
      { chave: 'pacientes-sem-compra', nome: 'LTV alto', filtros: { semCompraHaMeses: 3, valorMinimo: '60000' } },
      'beatriz',
    )
    expect(salvo.statusCode, JSON.stringify(salvo.body)).toBe(201)
    const daBeatriz = (await pegar(c, '/v1/relatorios', {}, 'beatriz')).body.favoritos[0]
    expect(daBeatriz.filtros).toEqual({ semCompraHaMeses: 3, valorMinimo: '60000' })

    const lista = await pegar(c, '/v1/relatorios', {}, 'juliana')
    const daJuliana = lista.body.favoritos[0]
    expect(daJuliana.filtros).toEqual({ semCompraHaMeses: 3, valorMinimo: null })
    expect(lista.text).not.toContain('60000')
    expect((await executar('pacientes-sem-compra', daJuliana.filtros, 'juliana')).statusCode).toBe(403)
    // E ela também não grava uma faixa.
    const dela = await postar(
      c,
      '/v1/relatorios/favoritos',
      { chave: 'pacientes-sem-compra', nome: 'Faixa', filtros: { semCompraHaMeses: 3, valorMaximo: '1' } },
      'juliana',
    )
    expect(dela.statusCode).toBe(403)
  })

  it('favorito-de-relatorio-sem-permissao-nao-aparece: nem o relatório, nem o favorito, nem a edição', async () => {
    const salvo = await postar(c, '/v1/relatorios/favoritos', { chave: 'recebimentos', nome: 'Caixa do mês', filtros: OUTUBRO }, 'beatriz')
    expect(salvo.statusCode).toBe(201)
    const lista = await pegar(c, '/v1/relatorios', {}, 'juliana')
    expect(lista.statusCode).toBe(200)
    const abertos = (lista.body.relatorios as { chave: string }[]).map((r) => r.chave)
    // O T9 acrescenta relatórios ao catálogo: a prova é o 8 (finmes) FORA e o 1 (pacientes) DENTRO.
    expect(abertos).toContain('pacientes-sem-compra')
    expect(abertos).not.toContain('recebimentos')
    expect(lista.body.favoritos).toEqual([])
    expect((await botar(c, `/v1/relatorios/favoritos/${salvo.body.id}`, { nome: 'Meu' }, 'juliana')).statusCode).toBe(404)
    expect((await postar(c, `/v1/relatorios/favoritos/${salvo.body.id}/arquivar`, {}, 'juliana')).statusCode).toBe(404)
    // E a gravação de favorito de relatório que ela não abre é 403.
    expect((await postar(c, '/v1/relatorios/favoritos', { chave: 'recebimentos', nome: 'X', filtros: OUTUBRO }, 'juliana')).statusCode).toBe(403)
  })

  it('o filtro que deixou de passar aparece como desatualizado, sem os filtros', async () => {
    await c.migrate.query(
      `INSERT INTO relatorios_favoritos (clinica_id, chave_relatorio, nome, filtros, criado_por) VALUES ($1, 'pacientes-sem-compra', 'Antigo', '{"semCompraHaMeses": 99}', $2)`,
      [c.clinica, c.pessoas['beatriz']],
    )
    const f = (await pegar(c, '/v1/relatorios', {}, 'beatriz')).body.favoritos[0]
    expect(f).toMatchObject({ nome: 'Antigo', filtros: null, desatualizado: true })
  })
})
