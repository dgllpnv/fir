import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'
import { ACOES, ETAPAS } from '@fir/domain'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * A JORNADA, COBRADA NO BANCO.
 *
 * O par `etapa ↔ status` é amarrado por `CHECK`, e é o mesmo movimento do
 * índice único de `recebimentos` no épico 2: a defesa fica onde NENHUM
 * caminho novo consegue contorná-la — nem a migração das 4 clínicas, nem um
 * job, nem um `psql` às duas da manhã.
 *
 * Um cartão `faltou` com `status = 'concluida'` desaparece do Recontatar, e o
 * defeito só aparece semanas depois, quando a clínica percebe que ninguém
 * liga para quem falta. Esse defeito não produz erro nenhum — produz
 * silêncio. Por isso ele é problema do banco, não da revisão de código.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP =
  process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
let app: pg.Client

const marca = `jor-${Date.now()}`
let clinica: string
let outra: string
let pessoa: string
let pessoaDaOutra: string
let paciente: string
let pacienteDaOutra: string
let motivoDaOutra: string

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

const criarClinica = (codigo: string): Promise<string> =>
  umId(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Jornada') RETURNING id`, [codigo])

async function criarPessoa(clinicaId: string): Promise<string> {
  const perfil = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada']) RETURNING id`,
    [clinicaId],
  )
  return umId(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
     VALUES ($1, 'Juliana', $2, 'x', $3) RETURNING id`,
    [clinicaId, `juliana-${clinicaId}@teste.local`, perfil],
  )
}

type TarefaCrua = {
  clinicaId?: string
  pacienteId?: string | null
  etapa?: string | null
  status?: string
  concluidaEm?: string | null
}

const inserirTarefa = (t: TarefaCrua = {}): Promise<string> =>
  umId(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo,
        etapa, status, concluida_em)
     VALUES ($1,$2,$2,'Consulta agendada','2026-10-24',$3,$4,$5::etapa_de_jornada,$6,$7)
     RETURNING id`,
    [
      t.clinicaId ?? clinica,
      t.clinicaId === outra ? pessoaDaOutra : pessoa,
      t.pacienteId === undefined ? (t.clinicaId === outra ? pacienteDaOutra : paciente) : t.pacienteId,
      t.pacienteId === null ? '' : 'Consulta agendada',
      t.etapa ?? 'agendado',
      t.status ?? 'aberta',
      t.concluidaEm ?? null,
    ],
  )

/** Um comando CRU, como `fir_migrate` — o papel que a RLS não filtra. */
const cru = (sql: string, params: unknown[] = []): Promise<unknown> => migrate.query(sql, params)

type Motivo = { id: string; nome: string; nome_chave: string; ordem: number; ativo: boolean }

const motivosDe = async (clinicaId: string): Promise<Motivo[]> =>
  (
    await migrate.query<Motivo>(
      `SELECT id, nome, nome_chave, ordem, ativo FROM motivos_de_perda
        WHERE clinica_id = $1 ORDER BY ordem, nome`,
      [clinicaId],
    )
  ).rows

const criarMotivo = (clinicaId: string, nome: string): Promise<string> =>
  umId('INSERT INTO motivos_de_perda (clinica_id, nome) VALUES ($1, $2) RETURNING id', [
    clinicaId,
    nome,
  ])

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  app = new pg.Client({ connectionString: URL_APP })
  migrate.on('error', (e) => console.error('[jornada-banco] migrate:', e.message))
  app.on('error', (e) => console.error('[jornada-banco] app:', e.message))
  await migrate.connect()
  await app.connect()
  await declararAtorSistema(migrate)

  clinica = await criarClinica(marca)
  outra = await criarClinica(`${marca}-v`)
  pessoa = await criarPessoa(clinica)
  pessoaDaOutra = await criarPessoa(outra)
  paciente = await umId(
    `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Ana Lúcia') RETURNING id`,
    [clinica],
  )
  pacienteDaOutra = await umId(
    `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Vizinha') RETURNING id`,
    [outra],
  )
  motivoDaOutra = (await motivosDe(outra)).find((m) => m.nome === 'Preço')!.id
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outra)
  await migrate.end()
  await app.end()
})

beforeEach(async () => {
  await migrate.query('DELETE FROM tarefas WHERE clinica_id = ANY($1)', [[clinica, outra]])
})

/* ---------------------------------------------------- etapa ↔ status */

describe('o CHECK que torna o estado impossível impossível', () => {
  it('faltou com status concluida é RECUSADO pelo banco', async () => {
    const t = await inserirTarefa({ etapa: 'agendado' })
    // `concluida_em` preenchido de propósito: sem ele a recusa viria de
    // `concluida_tem_instante` (0006), e o teste passaria sem nunca ter
    // exercitado o CHECK deste épico.
    await expect(
      cru(
        `UPDATE tarefas SET etapa='faltou', status='concluida',
                concluida_em='2026-10-24T15:00:00Z' WHERE id=$1`,
        [t],
      ),
    ).rejects.toThrow(/etapa_combina_com_status/i)
  })

  it('desmarcou com status cancelada é RECUSADO — é o invariante do épico', async () => {
    // Era o que o protótipo faz: `encerrar` cancela e deixa a etapa em
    // `desmarcou`. Aqui o cartão encerrado tem etapa própria.
    const t = await inserirTarefa({ etapa: 'agendado' })
    await expect(
      cru(`UPDATE tarefas SET etapa='desmarcou', status='cancelada' WHERE id=$1`, [t]),
    ).rejects.toThrow(/etapa_combina_com_status/i)
  })

  it('orçamento num cartão em aberto é RECUSADO pelo banco', async () => {
    const t = await inserirTarefa({ etapa: 'agendado' })
    await expect(
      cru(`UPDATE tarefas SET etapa='orcamento', status='aberta' WHERE id=$1`, [t]),
    ).rejects.toThrow(/etapa_combina_com_status/i)
  })

  it('encerrado exige cancelada', async () => {
    const t = await inserirTarefa({ etapa: 'agendado' })
    await expect(
      cru(`UPDATE tarefas SET etapa='encerrado', status='aberta' WHERE id=$1`, [t]),
    ).rejects.toThrow(/etapa_combina_com_status/i)
    await expect(
      cru(
        `UPDATE tarefas SET etapa='encerrado', status='concluida',
                concluida_em='2026-10-24T15:00:00Z' WHERE id=$1`,
        [t],
      ),
    ).rejects.toThrow(/etapa_combina_com_status/i)
    await cru(
      `UPDATE tarefas SET etapa='encerrado', status='cancelada', concluida_em=NULL WHERE id=$1`,
      [t],
    )
  })

  it('AS 27 COMBINAÇÕES: 9 etapas × 3 status, e só as 9 da tabela passam', async () => {
    // Uma a uma. "faltou concluida é recusado" prova uma linha; a matriz prova
    // que nenhuma outra escapou — inclusive as que ninguém pensaria em tentar.
    const ESPERADO: Record<string, string> = {
      agendado: 'aberta',
      confirmado: 'aberta',
      faltou: 'aberta',
      desmarcou: 'aberta',
      realizado: 'concluida',
      orcamento: 'concluida',
      fechado: 'concluida',
      perdido: 'concluida',
      encerrado: 'cancelada',
    }
    const t = await inserirTarefa({ etapa: 'agendado' })
    for (const [etapa, bom] of Object.entries(ESPERADO)) {
      for (const status of ['aberta', 'concluida', 'cancelada']) {
        const instante = status === 'concluida' ? `'2026-10-24T15:00:00Z'` : 'NULL'
        const sql = `UPDATE tarefas SET etapa=$2::etapa_de_jornada, status=$3,
                            concluida_em=${instante} WHERE id=$1`
        if (status === bom) {
          await cru(sql, [t, etapa, status])
        } else {
          await expect(cru(sql, [t, etapa, status]), `${etapa}/${status}`).rejects.toThrow(
            /etapa_combina_com_status|concluida_tem_instante/i,
          )
        }
      }
    }
  })

  it('etapa sem paciente é recusada — a jornada é do paciente', async () => {
    await expect(inserirTarefa({ pacienteId: null, etapa: 'agendado' })).rejects.toThrow(
      /etapa_exige_paciente|tipo_exige_paciente/i,
    )
  })
})

/* ------------------------------------------- as colunas do orçamento */

describe('as colunas de orçamento só existem onde há orçamento', () => {
  it('valor de orçamento num cartão agendado é recusado', async () => {
    const t = await inserirTarefa({ etapa: 'agendado' })
    await expect(
      cru(`UPDATE tarefas SET valor_orcamento=360000 WHERE id=$1`, [t]),
    ).rejects.toThrow(/orcamento_so_com_etapa/i)
  })

  it('programa orçado num cartão realizado é recusado', async () => {
    const t = await inserirTarefa({
      etapa: 'realizado',
      status: 'concluida',
      concluidaEm: '2026-10-24T15:00:00Z',
    })
    await expect(
      cru(`UPDATE tarefas SET programa_orcado='[]'::jsonb WHERE id=$1`, [t]),
    ).rejects.toThrow(/orcamento_so_com_etapa/i)
  })

  it('valor de orçamento ZERO é recusado — isso não é proposta', async () => {
    const t = await inserirTarefa({
      etapa: 'orcamento',
      status: 'concluida',
      concluidaEm: '2026-10-24T15:00:00Z',
    })
    await expect(cru(`UPDATE tarefas SET valor_orcamento=0 WHERE id=$1`, [t])).rejects.toThrow(
      /valor_orcamento/i,
    )
    await cru(`UPDATE tarefas SET valor_orcamento=360000 WHERE id=$1`, [t])
  })

  it('o valor do orçamento SOBREVIVE a perder e a fechar', async () => {
    // É ele que mede o perdido e o fechado no funil.
    const t = await inserirTarefa({
      etapa: 'orcamento',
      status: 'concluida',
      concluidaEm: '2026-10-24T15:00:00Z',
    })
    await cru(`UPDATE tarefas SET valor_orcamento=360000 WHERE id=$1`, [t])
    for (const etapa of ['perdido', 'fechado']) {
      await cru(`UPDATE tarefas SET etapa=$2::etapa_de_jornada WHERE id=$1`, [t, etapa])
    }
  })

  it('motivo de perda só em perdido', async () => {
    const motivo = (await motivosDe(clinica)).find((m) => m.nome === 'Preço')!.id
    const t = await inserirTarefa({
      etapa: 'orcamento',
      status: 'concluida',
      concluidaEm: '2026-10-24T15:00:00Z',
    })
    await expect(
      cru(`UPDATE tarefas SET motivo_perda_id=$2 WHERE id=$1`, [t, motivo]),
    ).rejects.toThrow(/motivo_so_em_perdido/i)
    await cru(`UPDATE tarefas SET etapa='perdido', motivo_perda_id=$2 WHERE id=$1`, [t, motivo])
  })

  it('MOTIVO DE OUTRA CLÍNICA É RECUSADO PELO BANCO, não só pelo serviço', async () => {
    // A chave estrangeira comum ATRAVESSA A RLS — foi assim que a unidade da
    // clínica vizinha colou num paciente no épico 2 (commit d0d4bb0), e a
    // única razão de não repetir aqui é a FK COMPOSTA `(motivo_perda_id,
    // clinica_id)`. O plano supunha que "FK + RLS" bastasse; não basta.
    const t = await inserirTarefa({
      etapa: 'perdido',
      status: 'concluida',
      concluidaEm: '2026-10-24T15:00:00Z',
    })
    await expect(
      cru(`UPDATE tarefas SET motivo_perda_id=$2 WHERE id=$1`, [t, motivoDaOutra]),
    ).rejects.toThrow(/tarefas_motivo_da_clinica|foreign key/i)
  })
})

/* ------------------------------------------------- motivos de perda */

describe('motivos_de_perda — dado da clínica, não ENUM do código', () => {
  it('toda clínica nova nasce com os cinco motivos, na ordem', async () => {
    const nova = await criarClinica(`${marca}-n`)
    try {
      expect((await motivosDe(nova)).map((m) => m.nome)).toEqual([
        'Preço',
        'Sem retorno do paciente',
        'Escolheu outro lugar',
        'Não é o momento',
        'Outro',
      ])
    } finally {
      await apagarClinicaDeTeste(migrate, nova)
    }
  })

  it('as clínicas que JÁ EXISTIAM também receberam os cinco', async () => {
    // A semeadura das existentes é um `INSERT ... SELECT` na própria 0007.
    // Sem ele, as 4 clínicas migradas ficariam com a lista vazia e o
    // formulário de perda sem nenhuma opção — e `perder` exige motivo.
    expect((await motivosDe(clinica)).length).toBe(5)
  })

  it('o nome do motivo é único por clínica, ignorando acento e caixa', async () => {
    await expect(criarMotivo(clinica, 'preco')).rejects.toThrow(/motivos_nome_unico/i)
    await expect(criarMotivo(clinica, '  PREÇO  ')).rejects.toThrow(/motivos_nome_unico/i)
  })

  it('o mesmo nome em DUAS clínicas é permitido — o vocabulário é de cada uma', async () => {
    expect((await motivosDe(clinica)).map((m) => m.nome)).toContain('Preço')
    expect((await motivosDe(outra)).map((m) => m.nome)).toContain('Preço')
  })

  it('desativar abre a vaga do nome, e desativar exige o instante', async () => {
    const preco = (await motivosDe(clinica)).find((m) => m.nome === 'Preço')!.id
    await expect(
      cru('UPDATE motivos_de_perda SET ativo = false WHERE id = $1', [preco]),
    ).rejects.toThrow(/desativado_tem_instante/i)
    await cru('UPDATE motivos_de_perda SET ativo = false, desativado_em = now() WHERE id = $1', [
      preco,
    ])
    const novo = await criarMotivo(clinica, 'Preço')
    await cru('DELETE FROM motivos_de_perda WHERE id = $1', [novo])
    await cru('UPDATE motivos_de_perda SET ativo = true, desativado_em = NULL WHERE id = $1', [
      preco,
    ])
  })

  it('a RLS esconde o vocabulário da outra clínica de `fir_app`', async () => {
    await app.query('BEGIN')
    try {
      await app.query('SELECT set_config($1,$2,true)', ['app.clinica_id', clinica])
      const r = await app.query<{ clinica_id: string }>('SELECT clinica_id FROM motivos_de_perda')
      expect(r.rowCount).toBe(5)
      expect(new Set(r.rows.map((x) => x.clinica_id))).toEqual(new Set([clinica]))
    } finally {
      await app.query('ROLLBACK')
    }
  })

  it('`fir_app` não consegue gravar motivo na clínica da vizinha', async () => {
    await app.query('BEGIN')
    try {
      await app.query('SELECT set_config($1,$2,true)', ['app.clinica_id', clinica])
      await app.query('SELECT set_config($1,$2,true)', ['app.pessoa_id', pessoa])
      await expect(
        app.query('INSERT INTO motivos_de_perda (clinica_id, nome) VALUES ($1, $2)', [
          outra,
          'Infiltrado',
        ]),
      ).rejects.toThrow(/row-level security/i)
    } finally {
      await app.query('ROLLBACK')
    }
  })
})

/* ------------------------------------------------------------ índices */

describe('os índices que a tela Hoje usa a cada abertura', () => {
  it('as três consultas da jornada têm índice parcial próprio', async () => {
    const r = await migrate.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'tarefas' AND indexname = ANY($1)`,
      [['tarefas_em_recontato', 'tarefas_para_retomar', 'tarefas_por_etapa', 'tarefas_historico']],
    )
    expect(r.rows.map((x) => x.indexname).sort()).toEqual([
      'tarefas_em_recontato',
      'tarefas_historico',
      'tarefas_para_retomar',
      'tarefas_por_etapa',
    ])
  })
})

/* ------------------------------------------- o histórico, chave por chave */

/* ------------------------------------------- a corrida de duas escritas */

describe('a corrida de duas escritas no mesmo cartão', () => {
  /**
   * Duas conexões, interleave ESCOLHIDO — não esperado.
   *
   * O teste equivalente por HTTP é não-determinístico nesta árvore: medido, com
   * o `FOR UPDATE` removido do serviço, cinco requisições em `Promise.all`
   * passam em 4 de 5 rodadas, porque `resolver_sessao` toma lock na linha da
   * sessão e serializa requisições do mesmo cookie. Aqui as duas transações são
   * conduzidas à mão, e cada asserção vale sempre.
   */
  let a: pg.Client
  let b: pg.Client

  beforeAll(async () => {
    a = new pg.Client({ connectionString: URL_MIG })
    b = new pg.Client({ connectionString: URL_MIG })
    a.on('error', (e) => console.error('[corrida] a:', e.message))
    b.on('error', (e) => console.error('[corrida] b:', e.message))
    await a.connect()
    await b.connect()
    for (const cli of [a, b]) await declararAtorSistema(cli)
  })

  /**
   * Toda transação que sobrar é desfeita entre um `it` e outro.
   *
   * Sem isto, um erro no meio de um dos testes deixa uma transação aberta
   * segurando o lock da linha — e o arquivo INTEIRO trava, com 60 s de timeout
   * por hook, acusando um defeito que não existe. Medido ao escrever a prova
   * por mutação deste bloco.
   */
  afterEach(async () => {
    for (const cli of [a, b]) await cli.query('ROLLBACK').catch(() => undefined)
  })

  afterAll(async () => {
    await a.end()
    await b.end()
  })

  const etapaDe = async (cli: pg.Client, id: string, comLock: boolean): Promise<string> => {
    const r = await cli.query<{ etapa: string }>(
      `SELECT etapa::text AS etapa FROM tarefas WHERE id = $1${comLock ? ' FOR UPDATE' : ''}`,
      [id],
    )
    return r.rows[0]!.etapa
  }

  const EVENTO = (etapa: string) => ({
    acao: etapa === 'confirmado' ? 'confirmar' : 'enviarConfirmacao',
    etapa,
    em: '2026-10-24T12:00:00.000Z',
    porId: pessoa,
  })

  /** A forma do serviço: concatena NO BANCO, no mesmo comando. */
  const anexarConcatenando = (cli: pg.Client, id: string, etapa: string): Promise<unknown> =>
    cli.query(
      `UPDATE tarefas
          SET etapa = $2::etapa_de_jornada, historico = historico || $3::jsonb
        WHERE id = $1`,
      [id, etapa, JSON.stringify([EVENTO(etapa)])],
    )

  /** A forma ERRADA: lê o array, dá push em JavaScript, grava de volta. */
  const anexarLendoAntes = async (
    cli: pg.Client,
    id: string,
    etapa: string,
    lidoAntes: readonly unknown[],
  ): Promise<void> => {
    await cli.query(
      `UPDATE tarefas SET etapa = $2::etapa_de_jornada, historico = $3::jsonb WHERE id = $1`,
      [id, etapa, JSON.stringify([...lidoAntes, EVENTO(etapa)])],
    )
  }

  const anexar = anexarConcatenando

  const lerHistorico = async (cli: pg.Client, id: string): Promise<unknown[]> =>
    (await cli.query<{ h: unknown[] }>('SELECT historico AS h FROM tarefas WHERE id = $1', [id]))
      .rows[0]!.h

  const eventos = async (id: string): Promise<number> =>
    Number(
      (
        await migrate.query<{ n: string }>(
          'SELECT jsonb_array_length(historico)::text AS n FROM tarefas WHERE id = $1',
          [id],
        )
      ).rows[0]!.n,
    )

  it('COM `FOR UPDATE`, a segunda leitura vê o estado JÁ COMMITADO', async () => {
    // É o que faz `transicao()` julgar o estado real. Sem isso, as duas
    // transações leem `agendado`, as duas passam pela tabela, e o cartão
    // recebe dois eventos `confirmar` para uma paciente que confirmou uma vez.
    const id = await inserirTarefa({ etapa: 'agendado' })
    await a.query('BEGIN')
    await b.query('BEGIN')
    expect(await etapaDe(a, id, true)).toBe('agendado')

    // B PEDE o lock e fica preso: o `await` só volta depois do COMMIT de A.
    // Nada de espera por tempo — a ordem é garantida pelo próprio lock.
    const lidoPorB = etapaDe(b, id, true)
    await anexar(a, id, 'confirmado')
    await a.query('COMMIT')
    expect(await lidoPorB).toBe('confirmado')
    await b.query('ROLLBACK')
  })

  it('SEM `FOR UPDATE`, as duas leem `agendado` — a corrida que o lock evita', async () => {
    const id = await inserirTarefa({ etapa: 'agendado' })
    await a.query('BEGIN')
    await b.query('BEGIN')
    expect(await etapaDe(a, id, false)).toBe('agendado')
    expect(await etapaDe(b, id, false)).toBe('agendado')
    await a.query('ROLLBACK')
    await b.query('ROLLBACK')
  })

  /**
   * O mesmo roteiro, duas formas de `UPDATE` — e o resultado diferente.
   *
   * As duas transações leem o MESMO histórico de um evento (o cenário em que
   * alguém tirou o `FOR UPDATE` do serviço) e cada uma acrescenta o seu.
   */
  async function corrida(forma: 'concatena' | 'le-antes'): Promise<number> {
    const id = await inserirTarefa({ etapa: 'agendado' })
    await cru(
      `UPDATE tarefas SET historico = jsonb_build_array(jsonb_build_object(
         'acao','agendar','etapa','agendado','em','2026-10-24T10:00:00.000Z','porId',$2::text))
        WHERE id = $1`,
      [id, pessoa],
    )
    expect(await eventos(id)).toBe(1)

    await a.query('BEGIN')
    await b.query('BEGIN')
    // Os DOIS leem antes de qualquer COMMIT: é o que faz a corrida existir.
    const hA = await lerHistorico(a, id)
    const hB = await lerHistorico(b, id)

    if (forma === 'concatena') await anexarConcatenando(a, id, 'agendado')
    else await anexarLendoAntes(a, id, 'agendado', hA)
    await a.query('COMMIT')

    if (forma === 'concatena') await anexarConcatenando(b, id, 'agendado')
    else await anexarLendoAntes(b, id, 'agendado', hB)
    await b.query('COMMIT')

    return eventos(id)
  }

  it('`historico || evento` não perde evento; `historico = <lido antes>` PERDE', async () => {
    // A segunda defesa do serviço, com o contrafactual dentro do próprio teste
    // — e não fora dele, como uma prova por mutação.
    //
    // Por que o contrafactual mora aqui: com o `FOR UPDATE` no lugar, NENHUM
    // teste de comportamento distingue as duas formas, porque a leitura do
    // serviço já acontece depois do lock e enxerga o estado atual. A diferença
    // só aparece quando as duas leituras são simultâneas — e é exatamente esse
    // interleave que este teste constrói à mão.
    expect(await corrida('concatena')).toBe(3) // os dois eventos sobrevivem
    expect(await corrida('le-antes')).toBe(2) // o evento de A foi sobrescrito
  })
})

describe('o vocabulário do banco é o do domínio', () => {
  it('os nove valores do ENUM `etapa_de_jornada` são exatamente `ETAPAS`', async () => {
    // `paraSaida` (apps/api/src/tarefas/leitura.ts) faz `l.etapa as Etapa`, e
    // o `as` só é honesto enquanto estas duas listas forem a mesma. Sem este
    // teste, um valor novo no ENUM — ou um removido da união — produziria um
    // tipo que mente, e a tela receberia uma etapa sem rótulo e sem ação.
    const r = await migrate.query<{ rotulo: string }>(
      `SELECT e.enumlabel AS rotulo FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'etapa_de_jornada' ORDER BY e.enumsortorder`,
    )
    expect(r.rows.map((x) => x.rotulo).sort()).toEqual([...ETAPAS].sort())
  })

  it('todo evento do banco usa ação e etapa do vocabulário', async () => {
    const r = await migrate.query<{ acao: string; etapa: string }>(
      `SELECT DISTINCT ev->>'acao' AS acao, ev->>'etapa' AS etapa FROM tarefas t
        CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev`,
    )
    for (const linha of r.rows) {
      expect(ACOES, `ação "${linha.acao}"`).toContain(linha.acao)
      expect(ETAPAS, `etapa "${linha.etapa}"`).toContain(linha.etapa)
    }
  })
})

describe('o histórico depois da 0007', () => {
  it('nenhuma tarefa do banco ficou com a chave curta `e` do épico 2', async () => {
    // A 0007 reescreve `{e, por}` para `{acao, etapa, porId}` (decisão D-5).
    // Duas formas de evento no mesmo `jsonb` é como o funil conta metade dos
    // eventos e ninguém descobre por quê.
    const r = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas t
        CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev
        WHERE ev ? 'e' OR ev ? 'por' OR ev ? 'rot'`,
    )
    expect(r.rows[0]!.n).toBe('0')
  })

  it('todo evento do banco tem `acao` e `etapa`', async () => {
    const r = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas t
        CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev
        WHERE NOT (ev ? 'acao') OR NOT (ev ? 'etapa') OR NOT (ev ? 'em')`,
    )
    expect(r.rows[0]!.n).toBe('0')
  })
})
