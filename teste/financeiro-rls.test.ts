import { randomUUID } from 'node:crypto'
import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * O esquema do financeiro, cobrado no BANCO — não no serviço.
 *
 * Três regras vivem aqui e em nenhum `if`: um fechamento de caixa por dia, a
 * conta da série nascendo uma vez por mês, e o mesmo `requisicao_id` não
 * criando dois recebimentos. As três perdem a corrida entre duas abas quando
 * escritas em TypeScript, e nenhuma delas alcança o `psql` às duas da manhã.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP =
  process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
let app: pg.Client

const marca = `fin-${Date.now()}`
let clinica: string
let outra: string
let pessoa: string
let pessoaDaOutra: string
let paciente: string

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

const criarClinica = (codigo: string): Promise<string> =>
  umId(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Financeiro') RETURNING id`, [codigo])

async function criarPessoa(clinicaId: string): Promise<string> {
  const perfil = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_fin', 'Financeiro', ARRAY['valores']) RETURNING id`,
    [clinicaId],
  )
  return umId(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
     VALUES ($1, 'Rita', $2, 'x', $3) RETURNING id`,
    [clinicaId, `rita-${clinicaId}@teste.local`, perfil],
  )
}

type ContaCrua = {
  clinicaId?: string
  descricao?: string
  categoria?: string
  valor?: bigint
  vencimento?: string
  serieId?: string | null
  diaVencimento?: number | null
  pagoEm?: string | null
  valorPago?: bigint | null
  pagoPor?: string | null
}

const inserirConta = (c: ContaCrua = {}): Promise<string> =>
  umId(
    `INSERT INTO contas_a_pagar
       (clinica_id, descricao, categoria, valor, vencimento, responsavel_id,
        serie_id, dia_vencimento, pago_em, valor_pago, pago_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      c.clinicaId ?? clinica,
      c.descricao ?? 'Aluguel da sala',
      c.categoria ?? 'Ocupação',
      (c.valor ?? 650_000n).toString(),
      c.vencimento ?? '2027-01-31',
      c.clinicaId === outra ? pessoaDaOutra : pessoa,
      c.serieId === undefined ? null : c.serieId,
      c.diaVencimento === undefined ? null : c.diaVencimento,
      c.pagoEm ?? null,
      c.valorPago === undefined || c.valorPago === null ? null : c.valorPago.toString(),
      c.pagoPor === undefined ? null : c.pagoPor,
    ],
  )

const fecharDireto = (clinicaId: string, dia: string): Promise<string> =>
  umId(
    `INSERT INTO caixas_do_dia (clinica_id, dia, fechado_por) VALUES ($1, $2, $3) RETURNING id`,
    [clinicaId, dia, clinicaId === outra ? pessoaDaOutra : pessoa],
  )

const inserirRecebimento = (r: { requisicaoId?: string | null; valor?: bigint } = {}): Promise<string> =>
  umId(
    `INSERT INTO recebimentos
       (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por, requisicao_id)
     VALUES ($1, $2, 'Pagamento de consulta', $3, 'Pix', now(), $4, $5) RETURNING id`,
    [clinica, paciente, (r.valor ?? 45_000n).toString(), pessoa, r.requisicaoId ?? null],
  )

const inserirTarefaComMarcador = (marcador: string | null, prazo: string): Promise<string> =>
  umId(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, marcador)
     VALUES ($1, $2, $2, 'Fechar o mês', $3, $4) RETURNING id`,
    [clinica, pessoa, prazo, marcador],
  )

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[financeiro-rls] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  app = new pg.Client({ connectionString: URL_APP })
  app.on('error', (e) => console.error('[financeiro-rls] app:', e.message))
  await app.connect()

  clinica = await criarClinica(marca)
  outra = await criarClinica(`${marca}-b`)
  pessoa = await criarPessoa(clinica)
  pessoaDaOutra = await criarPessoa(outra)
  paciente = await umId(
    'INSERT INTO pacientes (clinica_id, nome, telefone) VALUES ($1, $2, $3) RETURNING id',
    [clinica, 'Ana Financeiro', ''],
  )
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outra)
  await migrate.end()
  await app.end()
})

describe('caixa do dia — um fechamento por dia', () => {
  it('o caixa do dia é único por clínica e por dia — o segundo fechamento é recusado pelo BANCO', async () => {
    await fecharDireto(clinica, '2026-10-24')
    await expect(fecharDireto(clinica, '2026-10-24')).rejects.toThrow(/caixa_por_dia/i)
  })

  it('o mesmo dia em OUTRA clínica é permitido', async () => {
    await fecharDireto(clinica, '2026-10-25')
    await expect(fecharDireto(outra, '2026-10-25')).resolves.toBeDefined()
  })

  it('a linha por forma recusa uma forma que não está na gaveta', async () => {
    const caixa = await fecharDireto(clinica, '2026-10-26')
    await expect(
      migrate.query(
        `INSERT INTO caixa_por_forma (caixa_id, clinica_id, forma, esperado, contado)
         VALUES ($1, $2, 'Nota promissória', 0, 0)`,
        [caixa, clinica],
      ),
    ).rejects.toThrow(/forma/i)
  })

  it('a mesma forma não entra duas vezes no mesmo caixa', async () => {
    const caixa = await fecharDireto(clinica, '2026-10-27')
    const linha = (forma: string) =>
      migrate.query(
        `INSERT INTO caixa_por_forma (caixa_id, clinica_id, forma, esperado, contado)
         VALUES ($1, $2, $3, 45000, 45000)`,
        [caixa, clinica, forma],
      )
    await linha('Pix')
    await expect(linha('Pix')).rejects.toThrow(/caixa_por_forma_unica/i)
  })
})

describe('contas a pagar — a série e a âncora', () => {
  it('a conta do mês seguinte nasce uma vez — o banco recusa a segunda', async () => {
    const serie = randomUUID()
    await inserirConta({ serieId: serie, vencimento: '2027-01-31', diaVencimento: 31 })
    await expect(
      inserirConta({ serieId: serie, vencimento: '2027-01-31', diaVencimento: 31 }),
    ).rejects.toThrow(/conta_da_serie_por_mes/i)
  })

  it('a MESMA série em outro mês passa — é assim que a série anda', async () => {
    const serie = randomUUID()
    await inserirConta({ serieId: serie, vencimento: '2027-03-31', diaVencimento: 31 })
    await expect(
      inserirConta({ serieId: serie, vencimento: '2027-04-30', diaVencimento: 31 }),
    ).resolves.toBeDefined()
  })

  it('série sem âncora é recusada — uma conta mensal sem dia de vencimento não existe', async () => {
    await expect(inserirConta({ serieId: randomUUID(), diaVencimento: null })).rejects.toThrow(
      /serie_tem_ancora/i,
    )
  })

  it('âncora sem série também é recusada — a restrição vale nos dois sentidos', async () => {
    await expect(inserirConta({ serieId: null, diaVencimento: 31 })).rejects.toThrow(
      /serie_tem_ancora/i,
    )
  })

  it('âncora fora de 1–31 é recusada', async () => {
    await expect(inserirConta({ serieId: randomUUID(), diaVencimento: 32 })).rejects.toThrow(
      /dia_vencimento/i,
    )
  })

  it('conta paga sem valor pago é recusada', async () => {
    await expect(inserirConta({ pagoEm: '2026-10-24', valorPago: null })).rejects.toThrow(
      /pagamento_completo/i,
    )
  })

  it('valor pago sem data de pagamento também é recusado', async () => {
    await expect(inserirConta({ pagoEm: null, valorPago: 100_000n })).rejects.toThrow(
      /pagamento_completo/i,
    )
  })

  it('conta com valor zero ou negativo é recusada', async () => {
    await expect(inserirConta({ valor: 0n })).rejects.toThrow(/valor/i)
    await expect(inserirConta({ valor: -1n })).rejects.toThrow(/valor/i)
  })
})

describe('recebimento — a idempotência do POST', () => {
  it('o mesmo `requisicaoId` não cria dois recebimentos', async () => {
    const req = randomUUID()
    await inserirRecebimento({ requisicaoId: req, valor: 45_000n })
    await expect(inserirRecebimento({ requisicaoId: req, valor: 45_000n })).rejects.toThrow(
      /recebimento_por_requisicao/i,
    )
  })

  it('dois recebimentos SEM `requisicaoId` convivem — o índice é parcial', async () => {
    // O dinheiro do épico 2 (pagamento embutido) não tem requisição, e dois
    // pagamentos legítimos da mesma paciente não podem colidir num NULL.
    await expect(inserirRecebimento({ requisicaoId: null })).resolves.toBeDefined()
    await expect(inserirRecebimento({ requisicaoId: null })).resolves.toBeDefined()
  })
})

describe('marcador de rotina', () => {
  it('a mesma rotina no mesmo prazo nasce uma vez só', async () => {
    await inserirTarefaComMarcador('fechamento-do-mes', '2026-10-31')
    await expect(inserirTarefaComMarcador('fechamento-do-mes', '2026-10-31')).rejects.toThrow(
      /tarefa_de_rotina/i,
    )
  })

  it('a mesma rotina em outro prazo passa — são os doze meses do ano', async () => {
    await inserirTarefaComMarcador('fechamento-do-mes', '2026-11-30')
    await expect(inserirTarefaComMarcador('fechamento-do-mes', '2026-12-31')).resolves.toBeDefined()
  })

  it('tarefa sem marcador não colide com nenhuma outra sem marcador', async () => {
    await inserirTarefaComMarcador(null, '2026-10-31')
    await expect(inserirTarefaComMarcador(null, '2026-10-31')).resolves.toBeDefined()
  })
})

describe('RLS nas tabelas novas', () => {
  const TABELAS = [
    'contas_a_pagar',
    'caixas_do_dia',
    'caixa_por_forma',
    'cobrancas',
    'metas_do_mes',
    'configuracao_financeira',
  ] as const

  it('todas têm RLS habilitada E forçada — `FORCE` é o que alcança o dono da tabela', async () => {
    const r = await migrate.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname = ANY($1) AND relkind = 'r'`,
      [[...TABELAS]],
    )
    expect(r.rows).toHaveLength(TABELAS.length)
    for (const linha of r.rows) {
      expect(linha.relrowsecurity, `${linha.relname} sem ENABLE`).toBe(true)
      expect(linha.relforcerowsecurity, `${linha.relname} sem FORCE`).toBe(true)
    }
  })

  it('`fir_app` não enxerga a conta de outra clínica', async () => {
    const daOutra = await inserirConta({ clinicaId: outra, descricao: 'Pró-labore' })
    await app.query('BEGIN')
    try {
      await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
      await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', 'sistema'])
      const r = await app.query('SELECT id FROM contas_a_pagar WHERE id = $1', [daOutra])
      expect(r.rowCount).toBe(0)
    } finally {
      await app.query('ROLLBACK')
    }
  })

  it('`fir_app` não GRAVA conta em outra clínica — o WITH CHECK recusa', async () => {
    await app.query('BEGIN')
    try {
      await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
      await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', 'sistema'])
      await expect(
        app.query(
          `INSERT INTO contas_a_pagar (clinica_id, descricao, categoria, valor, vencimento, responsavel_id)
           VALUES ($1, 'invasão', 'Pessoal', 1, '2026-10-24', $2)`,
          [outra, pessoaDaOutra],
        ),
      ).rejects.toThrow(/row-level security|política|policy/i)
    } finally {
      await app.query('ROLLBACK')
    }
  })

  it('toda tabela nova tem o gatilho da trilha — e é o `registrar_auditoria`', async () => {
    const r = await migrate.query<{ relname: string }>(
      `SELECT c.relname FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE c.relname = ANY($1) AND p.proname = 'registrar_auditoria' AND NOT t.tgisinternal`,
      [[...TABELAS]],
    )
    expect(r.rows.map((x) => x.relname).sort()).toEqual([...TABELAS].sort())
  })
})
