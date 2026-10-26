import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * O CATÁLOGO, O PROGRAMA E A SESSÃO, COBRADOS NO BANCO.
 *
 * As quatro decisões que a `0010` fixa e que este arquivo prova:
 *
 * 1. **FK composta `(id, clinica_id)` em tudo.** A verificação de chave
 *    estrangeira roda PELO SISTEMA e atravessa a RLS — medido no épico 2
 *    (commit `d0d4bb0`), quando a unidade de outra clínica colou num paciente.
 * 2. **Nenhum número derivado em `programas`** (decisão P-2).
 * 3. **A dose nunca é gravada sem a unidade.** "Qtd sem unidade é a origem da
 *    dose errada" (`CONTEXT.md`).
 * 4. **A numeração da sessão é única dentro do item.** Duas `5/12` tornam a
 *    reprogramação ambígua, e o defeito só aparece quando a enfermagem vê
 *    duas aplicações no mesmo dia.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP =
  process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'

const TABELAS = [
  'procedimentos',
  'insumos_do_procedimento',
  'programas',
  'itens_do_programa',
] as const

const MODELOS: readonly [string, number, number, string, number | null, string, number][] = [
  ['Tirzepatida', 12, 7, 'Aplicação', null, 'm', 15],
  ['Semaglutida', 8, 7, 'Aplicação', null, 'm', 15],
  ['Bioestimulador de colágeno', 3, 30, 'Sessão', 12, 'm', 30],
  ['Toxina botulínica', 1, 7, 'Aplicação', 4, 'm', 15],
  ['Implante hormonal', 1, 7, 'Procedimento', 6, 'm', 20],
]

let migrate: pg.Client
let app: pg.Client

const marca = `prg-${Date.now()}`
let clinica: string
let outra: string
let pessoa: string
let pessoaDaOutra: string
let paciente: string
let pacienteDaOutra: string
let procDaOutra: string
let programaDaOutra: string

const umId = async (sql: string, params: unknown[] = []): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

/** Um comando CRU, como `fir_migrate` — o papel que a RLS não filtra. */
const cru = (sql: string, params: unknown[] = []): Promise<unknown> => migrate.query(sql, params)

const criarClinica = (codigo: string): Promise<string> =>
  umId(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Programas') RETURNING id`, [codigo])

async function criarPessoa(clinicaId: string): Promise<string> {
  const perfil = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_enf', 'Enfermagem', ARRAY['programas']) RETURNING id`,
    [clinicaId],
  )
  return umId(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
     VALUES ($1, 'Camila', $2, 'x', $3) RETURNING id`,
    [clinicaId, `camila-${clinicaId}@teste.local`, perfil],
  )
}

type Procedimento = {
  id: string
  nome: string
  sessoes_sugeridas: number
  intervalo_sugerido_dias: number
  rotulo_sessao: string
  retorno_quantidade: number | null
  retorno_unidade: string
  retorno_antecedencia_dias: number
}

const procedimentosDe = async (clinicaId: string): Promise<Procedimento[]> =>
  (
    await migrate.query<Procedimento>(
      `SELECT id, nome, sessoes_sugeridas, intervalo_sugerido_dias, rotulo_sessao,
              retorno_quantidade, retorno_unidade, retorno_antecedencia_dias
         FROM procedimentos WHERE clinica_id = $1 AND excluido_em IS NULL
        ORDER BY nome`,
      [clinicaId],
    )
  ).rows

/**
 * A ORDEM é alfabética, e não a de `MODELOS_PLANOS`, porque é essa que a tela
 * usa: medido no protótipo rodando, a tela Procedimentos lista Bioestimulador,
 * Drenagem, Implante, Semaglutida, Soroterapia, Tirzepatida, Toxina. Os cinco
 * modelos nascem no MESMO instante (uma transação, um `now()`), então não há
 * ordem de criação que os distinga — e inventar uma coluna `ordem` só para o
 * teste seria dado que ninguém lê.
 */
const criarProcedimentoCru = (clinicaId: string, nome: string): Promise<string> =>
  umId(
    `INSERT INTO procedimentos (clinica_id, nome, sessoes_sugeridas, intervalo_sugerido_dias)
     VALUES ($1, $2, 4, 7) RETURNING id`,
    [clinicaId, nome],
  )

const criarPrograma = (clinicaId: string, pacienteId: string): Promise<string> =>
  umId(
    `INSERT INTO programas (clinica_id, paciente_id, inicio) VALUES ($1, $2, '2026-11-02')
     RETURNING id`,
    [clinicaId, pacienteId],
  )

type ItemCru = {
  clinicaId?: string
  programaId?: string
  procedimentoId?: string
  chave?: string
  depoisDe?: string | null
  insumo?: { id: string | null; milesimos: number | null; unidade: string | null }
}

const inserirItemCru = (i: ItemCru = {}): Promise<string> =>
  umId(
    `INSERT INTO itens_do_programa
       (clinica_id, programa_id, chave, procedimento_id, procedimento_nome, rotulo_sessao,
        sessoes, intervalo_dias, inicio, depois_de, responsavel_id,
        insumo_id, insumo_milesimos, insumo_unidade)
     VALUES ($1,$2,$3,$4,'Tirzepatida','Aplicação',4,7,'2026-11-02',$5,$6,$7,$8,$9)
     RETURNING id`,
    [
      i.clinicaId ?? clinica,
      i.programaId ?? programa,
      i.chave ?? 'i1',
      i.procedimentoId ?? tirze,
      i.depoisDe ?? null,
      i.clinicaId === outra ? pessoaDaOutra : pessoa,
      i.insumo?.id ?? null,
      i.insumo?.milesimos ?? null,
      i.insumo?.unidade ?? null,
    ],
  )

type TarefaCrua = {
  clinicaId?: string
  tipo?: string
  programaId?: string | null
  itemChave?: string | null
  indice?: number | null
  total?: number | null
  procedimentoId?: string | null
  excluidaEm?: string | null
}

const inserirTarefaCrua = (t: TarefaCrua = {}): Promise<string> =>
  umId(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo,
        programa_id, item_chave, sessao_indice, sessao_total, procedimento_id, excluida_em)
     VALUES ($1,$2,$2,'Aplicação','2026-11-02',$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id`,
    [
      t.clinicaId ?? clinica,
      t.clinicaId === outra ? pessoaDaOutra : pessoa,
      t.clinicaId === outra ? pacienteDaOutra : paciente,
      t.tipo ?? 'Sessão de plano',
      t.programaId === undefined ? programa : t.programaId,
      t.itemChave === undefined ? 'i1' : t.itemChave,
      t.indice === undefined ? 1 : t.indice,
      t.total === undefined ? 4 : t.total,
      t.procedimentoId ?? null,
      t.excluidaEm ?? null,
    ],
  )

const inserirSessaoCrua = (s: {
  itemChave?: string
  indice: number
  total: number
  excluidaEm?: string | null
}): Promise<string> =>
  inserirTarefaCrua({
    itemChave: s.itemChave ?? 'i1',
    indice: s.indice,
    total: s.total,
    excluidaEm: s.excluidaEm ?? null,
  })

let tirze: string
let programa: string

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  app = new pg.Client({ connectionString: URL_APP })
  migrate.on('error', (e) => console.error('[programas-banco] migrate:', e.message))
  app.on('error', (e) => console.error('[programas-banco] app:', e.message))
  await migrate.connect()
  await app.connect()
  await declararAtorSistema(migrate)

  clinica = await criarClinica(marca)
  outra = await criarClinica(`${marca}-v`)
  pessoa = await criarPessoa(clinica)
  pessoaDaOutra = await criarPessoa(outra)
  paciente = await umId(`INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Ana Lúcia') RETURNING id`, [
    clinica,
  ])
  pacienteDaOutra = await umId(
    `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Vizinha') RETURNING id`,
    [outra],
  )
  procDaOutra = (await procedimentosDe(outra)).find((p) => p.nome === 'Tirzepatida')!.id
  programaDaOutra = await criarPrograma(outra, pacienteDaOutra)
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outra)
  await migrate.end()
  await app.end()
})

beforeEach(async () => {
  // `tarefas` ↔ `programas` é um CICLO de chave estrangeira: a sessão aponta
  // para o programa, e o programa aponta para o orçamento que o montou.
  // Soltar a volta é a única ordem possível (a mesma de `limpeza-de-teste`).
  await migrate.query('UPDATE programas SET tarefa_de_origem_id = NULL WHERE clinica_id = $1', [
    clinica,
  ])
  await migrate.query('DELETE FROM itens_do_programa WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM recebimentos WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM tarefas WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM programas WHERE clinica_id = $1', [clinica])
  tirze = (await procedimentosDe(clinica)).find((p) => p.nome === 'Tirzepatida')!.id
  programa = await criarPrograma(clinica, paciente)
})

/* ------------------------------------------------- a FK composta */

describe('a clínica vizinha não cola em nada', () => {
  it('procedimento de OUTRA clínica não cola num item — FK composta, não simples', async () => {
    // Com `REFERENCES procedimentos(id)` isto PASSA: a FK atravessa a RLS.
    await expect(inserirItemCru({ procedimentoId: procDaOutra })).rejects.toThrow(
      /itens_procedimento_da_clinica/i,
    )
  })

  it('programa de OUTRA clínica não recebe item daqui', async () => {
    await expect(inserirItemCru({ programaId: programaDaOutra })).rejects.toThrow(
      /itens_programa_da_clinica/i,
    )
  })

  it('paciente de OUTRA clínica não cola num programa', async () => {
    await expect(criarPrograma(clinica, pacienteDaOutra)).rejects.toThrow(
      /programas_paciente_da_clinica/i,
    )
  })

  it('tarefa daqui não aponta para programa da vizinha', async () => {
    await expect(inserirTarefaCrua({ programaId: programaDaOutra })).rejects.toThrow(
      /tarefas_programa_da_clinica/i,
    )
  })

  it('tarefa daqui não aponta para procedimento da vizinha', async () => {
    await expect(
      inserirTarefaCrua({ tipo: 'Procedimento realizado', programaId: null, itemChave: null, indice: null, total: null, procedimentoId: procDaOutra }),
    ).rejects.toThrow(/tarefas_procedimento_da_clinica/i)
  })

  it('recebimento daqui não aponta para programa da vizinha', async () => {
    const t = await inserirTarefaCrua({ programaId: null, itemChave: null, indice: null, total: null, tipo: 'Pagamento de orçamento' })
    await expect(
      cru(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, programa_id, recebido_em, registrado_por)
         VALUES ($1,$2,$3,'Pagamento de orçamento',1000,'Pix',$4, now(), $5)`,
        [clinica, paciente, t, programaDaOutra, pessoa],
      ),
    ).rejects.toThrow(/recebimentos_programa_da_clinica/i)
  })
})

/* ------------------------------------------------- a dose e a unidade */

describe('a dose nunca anda sem a unidade', () => {
  it('dose sem unidade é RECUSADA pelo banco', async () => {
    const item = await inserirItemCru()
    await expect(
      cru(`UPDATE itens_do_programa SET insumo_milesimos = 2500 WHERE id = $1`, [item]),
    ).rejects.toThrow(/insumo_tem_unidade/i)
  })

  it('unidade sem insumo também é recusada — o par nasce e morre junto', async () => {
    const item = await inserirItemCru()
    await expect(
      cru(`UPDATE itens_do_programa SET insumo_unidade = 'mg' WHERE id = $1`, [item]),
    ).rejects.toThrow(/insumo_tem_unidade/i)
  })

  it('os TRÊS juntos passam', async () => {
    await expect(
      inserirItemCru({ insumo: { id: paciente, milesimos: 2500, unidade: 'mg' } }),
    ).resolves.toBeDefined()
  })

  it('a dose PADRÃO do procedimento tem a mesma regra', async () => {
    await expect(
      cru(`UPDATE procedimentos SET insumo_padrao_milesimos = 1000 WHERE id = $1`, [tirze]),
    ).rejects.toThrow(/insumo_padrao_tem_unidade/i)
  })

  it('dose zero ou negativa é recusada — não existe aplicação de nada', async () => {
    await expect(
      inserirItemCru({ insumo: { id: paciente, milesimos: 0, unidade: 'mg' } }),
    ).rejects.toThrow(/insumo_milesimos/i)
  })
})

/* ------------------------------------------------- a sessão */

describe('a sessão é de um item de um programa, e é numerada', () => {
  it('sessão sem programa é recusada, e numeração fora de sessão também', async () => {
    await expect(
      inserirTarefaCrua({ tipo: 'Sessão de plano', programaId: null, itemChave: null }),
    ).rejects.toThrow(/sessao_e_do_programa|item_chave_tem_programa/i)

    await expect(
      inserirTarefaCrua({ tipo: 'Follow-up', indice: 3, total: 12, itemChave: null }),
    ).rejects.toThrow(/numeracao_so_em_sessao/i)
  })

  it('índice maior que o total é recusado', async () => {
    await expect(inserirSessaoCrua({ indice: 13, total: 12 })).rejects.toThrow(
      /sessao_e_do_programa/i,
    )
  })

  it('índice zero é recusado — a numeração que a recepção lê começa em 1', async () => {
    await expect(inserirSessaoCrua({ indice: 0, total: 12 })).rejects.toThrow(
      /sessao_e_do_programa/i,
    )
  })

  it('DUAS sessões 5/12 no MESMO item são recusadas', async () => {
    await inserirSessaoCrua({ itemChave: 'i1', indice: 5, total: 12 })
    await expect(inserirSessaoCrua({ itemChave: 'i1', indice: 5, total: 12 })).rejects.toThrow(
      /sessao_unica_no_item/i,
    )
  })

  it('a mesma numeração em OUTRO item do mesmo programa é permitida', async () => {
    // "Aplicação 1/4 · 2,5 mg" e "Aplicação 1/4 · 5 mg" convivem: a numeração
    // é DENTRO do item.
    await inserirSessaoCrua({ itemChave: 'i1', indice: 1, total: 4 })
    await expect(inserirSessaoCrua({ itemChave: 'i2', indice: 1, total: 4 })).resolves.toBeDefined()
  })

  it('sessão EXCLUÍDA libera a numeração', async () => {
    await inserirSessaoCrua({ itemChave: 'i1', indice: 5, total: 12, excluidaEm: '2026-10-25' })
    await expect(inserirSessaoCrua({ itemChave: 'i1', indice: 5, total: 12 })).resolves.toBeDefined()
  })

  it('`item_chave` sem programa é recusado — o contato de retorno também é de um item', async () => {
    await expect(
      inserirTarefaCrua({
        tipo: 'Retorno de procedimento',
        programaId: null,
        itemChave: 'i1',
        indice: null,
        total: null,
      }),
    ).rejects.toThrow(/item_chave_tem_programa/i)
  })

  it('o contato de retorno TEM `item_chave` e NÃO tem numeração', async () => {
    await expect(
      inserirTarefaCrua({
        tipo: 'Retorno de procedimento',
        itemChave: 'i1',
        indice: null,
        total: null,
      }),
    ).resolves.toBeDefined()
  })
})

/* ------------------------------------------------- itens e programas */

describe('as regras de forma do item e do programa', () => {
  it('`depois_de` não aponta para o próprio item', async () => {
    const item = await inserirItemCru()
    await expect(
      cru(`UPDATE itens_do_programa SET depois_de = chave WHERE id = $1`, [item]),
    ).rejects.toThrow(/item_nao_depende_de_si/i)
  })

  it('a chave do item é única DENTRO do programa, e livre fora dele', async () => {
    await inserirItemCru({ chave: 'i1' })
    await expect(inserirItemCru({ chave: 'i1' })).rejects.toThrow()
    const outroPrograma = await criarPrograma(clinica, paciente)
    await expect(
      inserirItemCru({ chave: 'i1', programaId: outroPrograma }),
    ).resolves.toBeDefined()
  })

  it('programa encerrado tem instante; ativo não tem', async () => {
    await expect(
      cru(`UPDATE programas SET situacao = 'encerrado' WHERE id = $1`, [programa]),
    ).rejects.toThrow(/encerrado_tem_instante/i)

    await expect(
      cru(`UPDATE programas SET situacao = 'encerrado', encerrado_em = now() WHERE id = $1`, [
        programa,
      ]),
    ).resolves.toBeDefined()

    await expect(
      cru(`UPDATE programas SET encerrado_em = now() WHERE id = $1`, [
        await criarPrograma(clinica, paciente),
      ]),
    ).rejects.toThrow(/encerrado_tem_instante/i)
  })

  it('PROGRAMAS NÃO TEM NENHUM NÚMERO DERIVADO — decisão P-2', async () => {
    // O legado guarda `sessoes` (a soma), `plano` (os nomes concatenados),
    // `intervaloDias` (o do 1º item) e `rotuloSessao`. Guardar qualquer um é
    // criar um segundo número para a mesma pergunta, e o segundo é o que fica
    // errado.
    const colunas = (
      await migrate.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'programas'`,
      )
    ).rows.map((r) => r.column_name)

    for (const proibida of [
      'sessoes',
      'saldo',
      'recebido',
      'valor_total',
      'valor',
      'plano',
      'nome',
      'intervalo_dias',
      'rotulo_sessao',
    ]) {
      expect(colunas, `programas.${proibida} não pode existir`).not.toContain(proibida)
    }
  })

  it('UM orçamento fechado monta UM programa — o índice por origem', async () => {
    const cartao = await inserirTarefaCrua({
      tipo: 'Orçamento enviado',
      programaId: null,
      itemChave: null,
      indice: null,
      total: null,
    })
    await cru(`UPDATE programas SET tarefa_de_origem_id = $1 WHERE id = $2`, [cartao, programa])
    const segundo = await criarPrograma(clinica, paciente)
    await expect(
      cru(`UPDATE programas SET tarefa_de_origem_id = $1 WHERE id = $2`, [cartao, segundo]),
    ).rejects.toThrow(/programa_por_origem/i)
  })
})

/* ------------------------------------------------- o catálogo semeado */

describe('o catálogo que toda clínica recebe', () => {
  it('TODA CLÍNICA NOVA NASCE COM OS CINCO MODELOS DO `Code.gs`', async () => {
    const nova = await criarClinica(`${marca}-nova`)
    try {
      expect(
        (await procedimentosDe(nova)).map((p) => [
          p.nome,
          p.sessoes_sugeridas,
          p.intervalo_sugerido_dias,
          p.rotulo_sessao,
          p.retorno_quantidade,
          p.retorno_unidade,
          p.retorno_antecedencia_dias,
        ]),
      ).toEqual([...MODELOS].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR')).map((m) => [...m]))
    } finally {
      await apagarClinicaDeTeste(migrate, nova)
    }
  })

  it('o nome do procedimento é único por clínica, ignorando acento e caixa', async () => {
    await expect(criarProcedimentoCru(clinica, 'tirzepatida')).rejects.toThrow(
      /procedimentos_nome_unico/i,
    )
    await expect(criarProcedimentoCru(clinica, 'TOXINA BOTULINICA')).rejects.toThrow(
      /procedimentos_nome_unico/i,
    )
  })

  it('o mesmo nome em OUTRA clínica é permitido', async () => {
    const nova = await criarClinica(`${marca}-n2`)
    try {
      // Já nasce com Tirzepatida pela semeadura, e isso é o caso: o nome é
      // único POR CLÍNICA.
      expect((await procedimentosDe(nova)).some((p) => p.nome === 'Tirzepatida')).toBe(true)
    } finally {
      await apagarClinicaDeTeste(migrate, nova)
    }
  })

  it('procedimento EXCLUÍDO libera o nome; DESATIVADO também', async () => {
    const x = await criarProcedimentoCru(clinica, 'Peeling')
    await cru(`UPDATE procedimentos SET excluido_em = now() WHERE id = $1`, [x])
    const y = await criarProcedimentoCru(clinica, 'Peeling')

    await cru(`UPDATE procedimentos SET ativo = false, desativado_em = now() WHERE id = $1`, [y])
    await expect(criarProcedimentoCru(clinica, 'Peeling')).resolves.toBeDefined()
  })

  it('desativado tem instante, e ativo não tem', async () => {
    await expect(cru(`UPDATE procedimentos SET ativo = false WHERE id = $1`, [tirze])).rejects.toThrow(
      /desativado_tem_instante/i,
    )
  })

  it('retorno em MESES vai até 60; em DIAS até 1825', async () => {
    await expect(
      cru(`UPDATE procedimentos SET retorno_quantidade = 61, retorno_unidade = 'm' WHERE id = $1`, [
        tirze,
      ]),
    ).rejects.toThrow(/retorno_positivo/i)
    await expect(
      cru(`UPDATE procedimentos SET retorno_quantidade = 1825, retorno_unidade = 'd' WHERE id = $1`, [
        tirze,
      ]),
    ).resolves.toBeDefined()
  })

  it('o intervalo SUGERIDO vai até 180; o do ITEM vai até 365', async () => {
    // 180 no catálogo (é sugestão), 365 no item (é o caso real). Os dois
    // limites são do protótipo e não se contradizem.
    await expect(
      cru(`UPDATE procedimentos SET intervalo_sugerido_dias = 181 WHERE id = $1`, [tirze]),
    ).rejects.toThrow(/intervalo_sugerido_dias/i)
    const item = await inserirItemCru()
    await expect(
      cru(`UPDATE itens_do_programa SET intervalo_dias = 365 WHERE id = $1`, [item]),
    ).resolves.toBeDefined()
    await expect(
      cru(`UPDATE itens_do_programa SET intervalo_dias = 366 WHERE id = $1`, [item]),
    ).rejects.toThrow(/intervalo_dias/i)
  })
})

/* ------------------------------------------------- RLS, trilha e o resto */

describe('RLS e trilha nas quatro tabelas novas', () => {
  it('as quatro têm ENABLE e FORCE', async () => {
    const r = await migrate.query<{
      relname: string
      relrowsecurity: boolean
      relforcerowsecurity: boolean
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE relname = ANY($1) AND relnamespace = 'public'::regnamespace`,
      [[...TABELAS]],
    )
    expect(r.rows).toHaveLength(TABELAS.length)
    for (const linha of r.rows) {
      expect(linha.relrowsecurity, `${linha.relname} sem ENABLE`).toBe(true)
      expect(linha.relforcerowsecurity, `${linha.relname} sem FORCE`).toBe(true)
    }
  })

  it('as quatro têm a trigger de auditoria', async () => {
    const r = await migrate.query<{ relname: string }>(
      `SELECT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE NOT t.tgisinternal AND c.relname = ANY($1)
          AND t.tgfoid = 'registrar_auditoria'::regproc`,
      [[...TABELAS]],
    )
    expect(new Set(r.rows.map((x) => x.relname))).toEqual(new Set(TABELAS))
  })

  it('`fir_app` com a clínica fixada NÃO enxerga o programa da vizinha', async () => {
    await app.query('BEGIN')
    try {
      await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
      await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', 'sistema'])
      const r = await app.query('SELECT id FROM programas WHERE id = $1', [programaDaOutra])
      expect(r.rows).toHaveLength(0)
      const p = await app.query('SELECT id FROM procedimentos WHERE id = $1', [procDaOutra])
      expect(p.rows).toHaveLength(0)
    } finally {
      await app.query('ROLLBACK')
    }
  })

  it('`fir_app` não consegue GRAVAR programa de outra clínica', async () => {
    await app.query('BEGIN')
    try {
      await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
      await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', 'sistema'])
      await expect(
        app.query(
          `INSERT INTO programas (clinica_id, paciente_id, inicio) VALUES ($1,$2,'2026-11-02')`,
          [outra, pacienteDaOutra],
        ),
      ).rejects.toThrow(/row-level security|política|policy/i)
    } finally {
      await app.query('ROLLBACK')
    }
  })
})

describe('`recebimentos.programa_id` — o que falta para o saldo agrupar', () => {
  it('aceita NULL: o recebimento fora de programa continua', async () => {
    const t = await inserirTarefaCrua({
      tipo: 'Pagamento de consulta',
      programaId: null,
      itemChave: null,
      indice: null,
      total: null,
    })
    await expect(
      cru(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, recebido_em, registrado_por)
         VALUES ($1,$2,$3,'Pagamento de consulta',45000,'Pix', now(), $4)`,
        [clinica, paciente, t, pessoa],
      ),
    ).resolves.toBeDefined()
  })

  it('aceita o programa DAQUI', async () => {
    const t = await inserirTarefaCrua({
      tipo: 'Pagamento de orçamento',
      programaId: null,
      itemChave: null,
      indice: null,
      total: null,
    })
    await expect(
      cru(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, programa_id, recebido_em, registrado_por)
         VALUES ($1,$2,$3,'Pagamento de orçamento',120000,'Pix',$4, now(), $5)`,
        [clinica, paciente, t, programa, pessoa],
      ),
    ).resolves.toBeDefined()
  })
})
