import { COLUNAS, perfisPadrao } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SISTEMA } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { LeitorDePlanilha } from './leitor-de-planilha'
import { MigracaoReprovada, Migrador } from './migrador.service'
import { type AbaDeTeste, type CelulaDeTeste, escreverXlsx } from './xlsx-de-teste'

/**
 * **A MIGRAÇÃO, CONTRA POSTGRES DE VERDADE.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TODO DADO AQUI É INVENTADO
 *
 * Nenhum nome, telefone, valor ou id vem das planilhas das clínicas (regra
 * 21). O que se reproduz é a **forma** dos problemas que o dado real tem:
 * data como serial do Excel, data-hora com espaço em vez de `T`, telefone em
 * notação científica, `valor > 0` com forma de pagamento VAZIA, responsável de
 * tarefa que não está na aba `Equipe`, `Planos` com nome repetido, aba de
 * backup da v15 presente.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CONTRA O BANCO, E NÃO CONTRA MOCK
 *
 * A RLS não se mocka, o `CHECK` não se mocka e o índice único não se mocka — e
 * são os três que fazem a migração segura. Um mock aqui provaria que o
 * migrador escreve os `INSERT` que ele escreve.
 *
 * Cada `it` marcado com **MUTAÇÃO** diz qual mudança no código ele mata.
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SEM_SENHA = '$argon2id$v=19$m=0,t=0,p=0$dGVzdGU$00000000000000000000000000000000'

let migrate: pg.Client
let banco: BancoService
let migrador: Migrador
let clinica: string
let vizinha: string

const t = (texto: string): CelulaDeTeste => ({ texto })
const n = (numero: string): CelulaDeTeste => ({ numero })

type Aba = keyof typeof COLUNAS

/** Monta o `.xlsx` com as abas da v20, pelas colunas de `COLUNAS`. */
function montarXlsx(
  conteudo: Partial<Record<Aba, Record<string, CelulaDeTeste>[]>>,
  extras: readonly string[] = [],
): Buffer {
  const nomes = Object.keys(COLUNAS) as Aba[]
  const abas: AbaDeTeste[] = nomes.map((nome) => ({
    nome,
    linhas: [
      COLUNAS[nome].map((c) => t(c)),
      ...(conteudo[nome] ?? []).map((o) => COLUNAS[nome].map((c) => o[c] ?? null)),
    ],
  }))
  return escreverXlsx([
    ...abas,
    // A aba OCULTA de controle e a de BACKUP, como as planilhas reais as têm.
    { nome: 'Config', linhas: [[t('chave'), t('valor')], [t('modelosPlanos'), n('1.0')]] },
    ...extras.map((nome) => ({
      nome,
      linhas: [COLUNAS.Tarefas.map((c) => t(c)), COLUNAS.Tarefas.map(() => t('x'))],
    })),
  ])
}

const EQUIPE = [
  { id: t('u1'), nome: t('Ana Beatriz'), funcao: t('Gestão'), admin: t('SIM'), ativo: t('SIM') },
  { id: t('u2'), nome: t('Carla Dias'), funcao: t('Recepção'), admin: t('NÃO'), ativo: t('SIM') },
  { id: t('u3'), nome: t('Diana Reis'), funcao: t('Enfermagem'), admin: t('NÃO'), ativo: t('NÃO') },
]

const PACIENTES = [
  // `aniversario` como SERIAL do Excel e `criadoEm` como data-hora com ESPAÇO.
  { id: t('p1'), nome: t('Paciente Um'), telefone: t('(71) 90000-0001'), aniversario: n('33000'), criadoEm: t('2026-01-02 08:00') },
  // Telefone em notação CIENTÍFICA e nome com ESPAÇO DUPLO.
  { id: t('p2'), nome: t('Paciente  Dois'), telefone: n('7.1900000002E10'), criadoEm: t('2026-01-03T08:00') },
  { id: t('p3'), nome: t('Paciente Três'), telefone: t(''), criadoEm: n('46023.5416666667') },
]

const PLANOS = [
  { id: t('pl1'), nome: t('Procedimento Alfa'), sessoes: n('4.0'), intervaloDias: n('7.0'), rotuloSessao: t('Aplicação'), ativo: t('SIM'), valor: n('300.0'), antecedencia: n('0') },
  // HOMÔNIMO, sem adesão: a escolha automática é defensável.
  { id: t('pl2'), nome: t('procedimento alfa'), sessoes: n('8.0'), intervaloDias: n('7.0'), rotuloSessao: t('Aplicação'), ativo: t('SIM') },
  // Um dos cinco MODELOS que a trigger da 0010 semeia com a clínica: ele tem
  // de ser RECONCILIADO por `nome_chave`, não inserido de novo.
  { id: t('pl3'), nome: t('Tirzepatida'), sessoes: n('12.0'), intervaloDias: n('7.0'), rotuloSessao: t('Aplicação'), ativo: t('SIM') },
]

const ADESOES = [
  { id: t('a1'), pacienteId: t('p1'), planoId: t('pl1'), inicio: n('46023'), sessoes: n('4.0'), intervaloDias: n('7.0'), rotuloSessao: t('Aplicação'), responsavelId: t('u1'), modo: t('saldo'), status: t('ativo') },
]

const tarefa = (o: Record<string, CelulaDeTeste>): Record<string, CelulaDeTeste> => ({
  criadaEm: t('2026-01-02 08:00'),
  solicitanteId: t('u1'),
  responsavelId: t('u1'),
  descricao: t('Linha inventada'),
  prazo: t('2026-01-02'),
  prioridade: t('normal'),
  status: t('concluida'),
  concluidaEm: t('2026-01-02T09:00'),
  ...o,
})

const TAREFAS = [
  // Pagamento COM forma.
  tarefa({ id: t('t1'), pacienteId: t('p1'), tipo: t('Pagamento de orçamento'), valor: n('0.0'), valorAberto: n('1200.0'), adesaoId: t('a1') }),
  // **A FORMA DE PAGAMENTO VAZIA COM VALOR > 0** — a forma do dado real que a
  // migration 0021 existe para aceitar.
  tarefa({ id: t('t2'), pacienteId: t('p1'), tipo: t('Pagamento de saldo em aberto'), valor: n('500.0') }),
  // Sessões do programa em modo `saldo`: abatem.
  tarefa({ id: t('t3'), pacienteId: t('p1'), tipo: t('Sessão de plano'), valor: n('300.0'), adesaoId: t('a1'), sessao: t('1/4'), formaPagamento: t('Pix') }),
  tarefa({ id: t('t4'), pacienteId: t('p1'), tipo: t('Sessão de plano'), adesaoId: t('a1'), sessao: t('2/4'), status: t('aberta'), concluidaEm: t('') }),
  // Tipo ANTIGO, traduzido por `TIPO_ANTIGO`.
  tarefa({ id: t('t5'), pacienteId: t('p2'), tipo: t('Orçamento pago'), valor: n('750.5'), formaPagamento: t('Cartão de crédito'), campanhaId: t('c1') }),
  // ORÇAMENTO: valor na coluna `valor`, e NÃO é receita (regra 4).
  tarefa({ id: t('t6'), pacienteId: t('p2'), tipo: t('Orçamento enviado'), valor: n('9000.0') }),
  // **RESPONSÁVEL QUE NÃO ESTÁ NA ABA `Equipe`** — a v20 apagou a linha e
  // copiou o nome para dentro da tarefa.
  tarefa({ id: t('t7'), pacienteId: t('p3'), tipo: t('Follow-up'), responsavelId: t('u9'), responsavel: t('Elisa Prado') }),
  // Tarefa interna: sem paciente E sem tipo (`tipo_exige_paciente`).
  tarefa({ id: t('t8'), descricao: t('Conferir estoque'), status: t('aberta'), concluidaEm: t('') }),
  // Agendada e aberta: `etapaDerivada` dá `agendado`.
  tarefa({ id: t('t9'), pacienteId: t('p3'), tipo: t('Consulta agendada'), status: t('aberta'), concluidaEm: t(''), hora: t('14:30') }),
]

const CAMPANHAS = [
  { id: t('c1'), nome: t('Campanha Um'), inicio: t('2026-01-01'), fim: t('2026-01-31'), metrica: t('receita'), meta: n('5000.0') },
  { id: t('c2'), nome: t('Campanha Dois'), inicio: n('46023'), fim: n('46053'), metrica: t('contatos'), meta: n('20.0') },
]

const PLANILHA = () =>
  montarXlsx(
    { Equipe: EQUIPE, Pacientes: PACIENTES, Planos: PLANOS, Adesoes: ADESOES, Campanhas: CAMPANHAS, Tarefas: TAREFAS },
    ['Tarefas (cópia v15)'],
  )

const DECISOES = {
  perfilPorPessoa: new Map([
    ['u2', 'pf_rec'],
    ['u3', 'pf_enf'],
  ]),
}

async function criarClinica(codigo: string, fuso: string): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    'INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, $2, $3) RETURNING id',
    [codigo, codigo, fuso],
  )
  const id = r.rows[0]!.id
  for (const p of perfisPadrao()) {
    await migrate.query('INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1,$2,$3,$4)', [
      id,
      p.id,
      p.nome,
      [...p.perms],
    ])
  }
  return id
}

const marca = `mig-${Date.now()}`

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[migracao.e2e] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  migrador = new Migrador(banco)
  vizinha = await criarClinica(`${marca}-vizinha`, 'America/Bahia')
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, vizinha)
  if (clinica !== undefined) await apagarClinicaDeTeste(migrate, clinica)
  await banco.onModuleDestroy()
  await migrate.end()
})

beforeEach(async () => {
  if (clinica !== undefined) await apagarClinicaDeTeste(migrate, clinica)
  clinica = await criarClinica(`${marca}-${Math.random().toString(36).slice(2, 10)}`, 'America/Bahia')
})

const migrar = (buf: Buffer, decisoes = DECISOES, ensaio = false) =>
  migrador.migrar(clinicaIdDeFonteConfiavel(clinica), new LeitorDePlanilha().ler(buf), decisoes, {
    ensaio,
  })

describe('o relatório de conferência FECHA, e é ele que libera o corte', () => {
  it('os seis totais batem exatamente, com o dado torto do mundo real', async () => {
    const r = await migrar(PLANILHA())
    expect(r.relatorio.fechado).toBe(true)
    for (const l of r.relatorio.linhas) {
      expect(l.divergencias, `${l.nome}: ${l.origem} × ${l.destino}`).toEqual([])
    }
    // Receita: 500 (saldo, sem forma) + 300 (sessão) + 750,50 (orçamento pago).
    // O orçamento ENVIADO de 9.000 e o aberto de 1.200 ficam FORA.
    expect(r.relatorio.linhas.find((l) => l.nome === 'Receita total')).toMatchObject({
      origem: '155050',
      destino: '155050',
      bate: true,
    })
    expect(r.relatorio.arredondamentos).toBe(0)
  })

  it('o relatório traz os SEIS nomes que a regra 28 exige', async () => {
    const r = await migrar(PLANILHA())
    const nomes = r.relatorio.linhas.map((l) => l.nome)
    expect(nomes).toContain('Tarefas → tarefas')
    expect(nomes).toContain('Receita total')
    expect(nomes).toContain('LTV por paciente')
    expect(nomes).toContain('Saldo em aberto por paciente')
    expect(nomes).toContain('Saldo em aberto por adesão')
    expect(nomes).toContain('Receita por campanha')
  })

  /**
   * **MUTAÇÃO:** criar um recebimento também para a tarefa de "Orçamento
   * enviado".
   *
   * A receita do mês dobraria para a clínica que orça muito, e ninguém
   * perceberia até o fechamento — é o erro clássico da regra 3. Este teste o
   * mata por dois caminhos: a receita total e o `valor_orcamento`.
   */
  it('MUTAÇÃO · o orçamento NÃO vira recebimento, e o valor dele vai para `valor_orcamento`', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ valor_orcamento: string; etapa: string; n: string }>(
      `SELECT t.valor_orcamento, t.etapa::text AS etapa,
              (SELECT count(*)::text FROM recebimentos r WHERE r.tarefa_id = t.id) AS n
         FROM tarefas t
         JOIN origens_da_v20 o ON o.id_interno = t.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Tarefas' AND o.id_externo = 't6'`,
      [clinica],
    )
    expect(r.rows[0]).toMatchObject({ valor_orcamento: '900000', etapa: 'orcamento', n: '0' })
  })

  /**
   * **MUTAÇÃO:** migrar a aba `Tarefas (cópia v15)` junto com `Tarefas`.
   *
   * As duas têm o cabeçalho IDÊNTICO e a cópia tem os valores de ANTES da
   * conversão da v16 — migrá-la dobra a receita de meses inteiros sem erro
   * nenhum. A aba está nas três planilhas reais.
   */
  it('MUTAÇÃO · a aba de backup da v15 não entra, e aparece nas observações', async () => {
    const r = await migrar(PLANILHA())
    expect(r.criados['Tarefas']).toBe(TAREFAS.length)
    expect(r.relatorio.observacoes.map((o) => o.codigo)).toContain('AbaDeBackupIgnorada')
  })

  /**
   * **MUTAÇÃO:** largar o `AND o.entidade = $2` do `count` da conferência 1.
   *
   * `novoId()` não tem prefixo em `Pacientes`, `Adesoes` e `Campanhas`, então
   * um id de paciente pode colidir com um de adesão. Sem a entidade na chave, a
   * contagem somaria linhas de outra tabela e "bateria" por acidente.
   */
  it('MUTAÇÃO · a contagem por entidade é por ENTIDADE, não por id', async () => {
    const r = await migrar(PLANILHA())
    const porNome = new Map(r.relatorio.linhas.map((l) => [l.nome, l]))
    expect(porNome.get('Pacientes → pacientes')!.destino).toBe(String(PACIENTES.length))
    expect(porNome.get('Adesoes → programas')!.destino).toBe(String(ADESOES.length))
    expect(porNome.get('Campanhas → campanhas')!.destino).toBe(String(CAMPANHAS.length))
  })
})

describe('idempotência (regra 26) — TRÊS vezes, e é assim que se testa', () => {
  it('a segunda e a terceira importação não criam NADA', async () => {
    const primeira = await migrar(PLANILHA())
    expect(primeira.escreveu).toBe(true)

    const contar = async () => {
      const r = await migrate.query<{ t: string; p: string; r: string; g: string; i: string; o: string }>(
        `SELECT (SELECT count(*)::text FROM tarefas       WHERE clinica_id = $1) AS t,
                (SELECT count(*)::text FROM pacientes     WHERE clinica_id = $1) AS p,
                (SELECT count(*)::text FROM recebimentos  WHERE clinica_id = $1) AS r,
                (SELECT count(*)::text FROM programas     WHERE clinica_id = $1) AS g,
                (SELECT count(*)::text FROM itens_do_programa WHERE clinica_id = $1) AS i,
                (SELECT count(*)::text FROM origens_da_v20    WHERE clinica_id = $1) AS o`,
        [clinica],
      )
      return r.rows[0]!
    }
    const depoisDaPrimeira = await contar()

    const segunda = await migrar(PLANILHA())
    expect(segunda.escreveu).toBe(false)
    expect(segunda.criados).toEqual({})
    expect(await contar()).toEqual(depoisDaPrimeira)
    expect(segunda.relatorio.fechado).toBe(true)

    const terceira = await migrar(PLANILHA())
    expect(terceira.escreveu).toBe(false)
    expect(await contar()).toEqual(depoisDaPrimeira)
    expect(terceira.relatorio.fechado).toBe(true)
  })

  /**
   * **MUTAÇÃO:** decidir se insere por um `SELECT` na tabela de destino ("já
   * existe paciente com este nome?") em vez de por `origens_da_v20`.
   *
   * Seria deduplicação por semelhança no meio de uma migração, e é assim que
   * duas pessoas viram uma. A chave é de ESQUEMA, e o teste prova que ela é a
   * que manda: os ids do destino são os MESMOS nas três execuções.
   */
  it('MUTAÇÃO · os ids do destino são estáveis entre execuções', async () => {
    await migrar(PLANILHA())
    const ids = async () => {
      const r = await migrate.query<{ id_externo: string; id_interno: string }>(
        'SELECT id_externo, id_interno FROM origens_da_v20 WHERE clinica_id = $1 ORDER BY entidade, id_externo',
        [clinica],
      )
      return r.rows
    }
    const antes = await ids()
    await migrar(PLANILHA())
    expect(await ids()).toEqual(antes)
  })
})

describe('as conversões que o épico declarou', () => {
  it('adesão sem `itens` vira programa de UM item `i1`, com os derivados recalculados', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{
      chave: string
      sessoes: number
      intervalo_dias: number
      rotulo_sessao: string
      procedimento_nome: string
      inicio: Date
      valor: string
      modo: string
    }>(
      `SELECT i.chave, i.sessoes, i.intervalo_dias, i.rotulo_sessao, i.procedimento_nome,
              i.inicio, i.valor, g.modo_de_cobranca AS modo
         FROM itens_do_programa i
         JOIN programas g ON g.id = i.programa_id
        WHERE i.clinica_id = $1`,
      [clinica],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({
      chave: 'i1',
      sessoes: 4,
      intervalo_dias: 7,
      rotulo_sessao: 'Aplicação',
      procedimento_nome: 'Procedimento Alfa',
      // 300,00 por sessão × 4 sessões — e `Σ itens.valor` é o total.
      valor: '120000',
      modo: 'saldo',
    })
  })

  it('tarefa de agenda sem `etapa` recebe a etapa DERIVADA pela função do domínio', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ id_externo: string; etapa: string | null; status: string }>(
      `SELECT o.id_externo, t.etapa::text AS etapa, t.status::text AS status
         FROM tarefas t JOIN origens_da_v20 o ON o.id_interno = t.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Tarefas'
        ORDER BY o.id_externo`,
      [clinica],
    )
    const porId = new Map(r.rows.map((x) => [x.id_externo, x]))
    // Agenda aberta → `agendado`.
    expect(porId.get('t9')).toMatchObject({ etapa: 'agendado', status: 'aberta' })
    // Contato não é da jornada → etapa nula.
    expect(porId.get('t7')!.etapa).toBeNull()
    // Tarefa interna, sem paciente → etapa nula.
    expect(porId.get('t8')!.etapa).toBeNull()
  })

  it('tipo antigo é gravado com o nome ATUAL', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ tipo: string }>(
      `SELECT t.tipo FROM tarefas t JOIN origens_da_v20 o ON o.id_interno = t.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Tarefas' AND o.id_externo = 't5'`,
      [clinica],
    )
    expect(r.rows[0]!.tipo).toBe('Pagamento de orçamento')
  })

  /**
   * **MUTAÇÃO:** usar `America/Bahia` fixo, como o `const TZ` da v20.
   *
   * A clínica de outro estado teria o histórico inteiro deslocado, e o
   * deslocamento muda o DIA de tudo o que foi lançado nas primeiras horas
   * (regra 22). O fuso é propriedade da clínica.
   */
  it('MUTAÇÃO · o instante sai do relógio de parede + o fuso DA CLÍNICA', async () => {
    await migrar(PLANILHA())
    const naBahia = await migrate.query<{ em: Date }>(
      `SELECT t.concluida_em AS em FROM tarefas t JOIN origens_da_v20 o ON o.id_interno = t.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Tarefas' AND o.id_externo = 't3'`,
      [clinica],
    )
    // 09:00 em America/Bahia (UTC−3) = 12:00 UTC.
    expect(naBahia.rows[0]!.em.toISOString()).toBe('2026-01-02T12:00:00.000Z')

    // A MESMA planilha, numa clínica de fuso diferente, dá outro instante.
    const noronha = await criarClinica(`${marca}-noronha`, 'America/Noronha')
    try {
      await migrador.migrar(
        clinicaIdDeFonteConfiavel(noronha),
        new LeitorDePlanilha().ler(PLANILHA()),
        DECISOES,
        { ensaio: false },
      )
      const r = await migrate.query<{ em: Date }>(
        `SELECT t.concluida_em AS em FROM tarefas t JOIN origens_da_v20 o ON o.id_interno = t.id
          WHERE o.clinica_id = $1 AND o.entidade = 'Tarefas' AND o.id_externo = 't3'`,
        [noronha],
      )
      // 09:00 em America/Noronha (UTC−2) = 11:00 UTC.
      expect(r.rows[0]!.em.toISOString()).toBe('2026-01-02T11:00:00.000Z')
    } finally {
      await apagarClinicaDeTeste(migrate, noronha)
    }
  })

  it('serial do Excel, data-hora com espaço e telefone científico atravessam certos', async () => {
    await migrar(PLANILHA())
    // `aniversario::text` e não a `Date` do driver: `date` volta como meia-noite
    // LOCAL, e `toISOString()` sobre ela muda de dia conforme o fuso da máquina
    // que roda o teste. O teste tem de medir a COLUNA, não o fuso do CI.
    const r = await migrate.query<{
      id_externo: string
      aniversario: string | null
      telefone: string
      criado_em: Date
    }>(
      `SELECT o.id_externo, p.aniversario::text AS aniversario, p.telefone, p.criado_em
         FROM pacientes p JOIN origens_da_v20 o ON o.id_interno = p.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Pacientes' ORDER BY o.id_externo`,
      [clinica],
    )
    const porId = new Map(r.rows.map((x) => [x.id_externo, x]))
    // 33000 dias de 1899-12-30.
    expect(porId.get('p1')!.aniversario).toBe('1990-05-07')
    // Só os dígitos, com a notação científica expandida sem perder nenhum.
    expect(porId.get('p2')!.telefone).toBe('71900000002')
    expect(porId.get('p1')!.telefone).toBe('71900000001')
    // 46023.5416666667 → 2026-01-01 13:00 na Bahia = 16:00 UTC.
    expect(porId.get('p3')!.criado_em.toISOString()).toBe('2026-01-01T16:00:00.000Z')
  })

  it('o nome com ESPAÇO DUPLO entra colapsado — e não cria uma segunda paciente', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ nome: string }>(
      `SELECT p.nome FROM pacientes p JOIN origens_da_v20 o ON o.id_interno = p.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Pacientes' AND o.id_externo = 'p2'`,
      [clinica],
    )
    expect(r.rows[0]!.nome).toBe('Paciente Dois')
  })

  /**
   * **MUTAÇÃO:** `INSERT` cego em `procedimentos`.
   *
   * A trigger da 0010 semeia os cinco `MODELOS_PLANOS` em TODA clínica nova, e
   * as três planilhas reais têm esses mesmos nomes na aba `Planos`. Um
   * `INSERT` cego colide com `procedimentos_nome_unico` e a migração morre na
   * primeira linha — depois de já ter escrito pessoas e pacientes.
   */
  it('MUTAÇÃO · o procedimento semeado é RECONCILIADO por nome, não duplicado', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ n: string; semOrigem: string }>(
      `SELECT (SELECT count(*)::text FROM procedimentos WHERE clinica_id = $1
                 AND nome_chave = 'tirzepatida') AS n,
              (SELECT count(*)::text FROM procedimentos d WHERE d.clinica_id = $1
                 AND NOT EXISTS (SELECT 1 FROM origens_da_v20 o
                                  WHERE o.clinica_id = d.clinica_id AND o.id_interno = d.id)) AS "semOrigem"`,
      [clinica],
    )
    expect(r.rows[0]!.n).toBe('1')
    // Os outros quatro modelos semeados ficam, desativados e RELATADOS.
    expect(Number(r.rows[0]!.semOrigem)).toBe(4)
  })

  it('o homônimo de `Planos` fica DESATIVADO, nunca apagado nem fundido', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ id_externo: string; ativo: boolean }>(
      `SELECT o.id_externo, d.ativo FROM procedimentos d JOIN origens_da_v20 o ON o.id_interno = d.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Planos' AND d.nome_chave = 'procedimento alfa'
        ORDER BY o.id_externo`,
      [clinica],
    )
    expect(r.rows).toEqual([
      { id_externo: 'pl1', ativo: true },
      { id_externo: 'pl2', ativo: false },
    ])
  })

  it('a meta da campanha vem na escala da MÉTRICA: centavos em receita, contagem nas outras', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ id_externo: string; metrica: string; meta: string }>(
      `SELECT o.id_externo, c.metrica, c.meta::text AS meta
         FROM campanhas c JOIN origens_da_v20 o ON o.id_interno = c.id
        WHERE o.clinica_id = $1 ORDER BY o.id_externo`,
      [clinica],
    )
    expect(r.rows).toEqual([
      { id_externo: 'c1', metrica: 'receita', meta: '500000' },
      { id_externo: 'c2', metrica: 'contatos', meta: '20' },
    ])
  })
})

describe('a pessoa que a v20 APAGOU', () => {
  /**
   * **MUTAÇÃO:** jogar as tarefas órfãs no primeiro administrador.
   *
   * O nome da pessoa está na própria tarefa (`tarefas.responsavel`) — a v20 o
   * copia justamente porque apaga a linha da aba. Atribuí-las a outra pessoa
   * reescreve quem fez o trabalho, e é dado de desempenho de equipe.
   */
  it('MUTAÇÃO · é RECONSTRUÍDA pelo nome da tarefa, INATIVA e sem permissão', async () => {
    const r = await migrar(PLANILHA())
    expect(r.relatorio.observacoes.map((o) => o.codigo)).toContain('PessoaReconstruida')

    const q = await migrate.query<{ nome: string; ativo: boolean; perms: string[] }>(
      `SELECT ps.nome, ps.ativo, pf.perms
         FROM pessoas ps
         JOIN origens_da_v20 o ON o.id_interno = ps.id
         JOIN perfis pf ON pf.id = ps.perfil_id
        WHERE o.clinica_id = $1 AND o.entidade = 'EquipeApagada'`,
      [clinica],
    )
    expect(q.rows).toHaveLength(1)
    expect(q.rows[0]).toMatchObject({ nome: 'Elisa Prado', ativo: false, perms: [] })
  })

  it('ela NÃO entra na contagem da aba `Equipe` — a conferência continua exata', async () => {
    const r = await migrar(PLANILHA())
    const linha = r.relatorio.linhas.find((l) => l.nome === 'Equipe → pessoas')!
    expect(linha).toMatchObject({ origem: '3', destino: '3', bate: true })
    expect(r.relatorio.observacoes.some((o) => o.codigo === 'LinhaSemOrigem' && o.aba === 'Equipe')).toBe(
      false,
    )
  })

  it('a pessoa INATIVA da aba entra inativa, com o instante que o CHECK exige', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ ativo: boolean; desativada_em: Date | null }>(
      `SELECT ps.ativo, ps.desativada_em FROM pessoas ps
         JOIN origens_da_v20 o ON o.id_interno = ps.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Equipe' AND o.id_externo = 'u3'`,
      [clinica],
    )
    expect(r.rows[0]!.ativo).toBe(false)
    expect(r.rows[0]!.desativada_em).not.toBeNull()
  })

  /**
   * **MUTAÇÃO:** copiar o PIN da v20 para `senha_hash`, ou gerar uma senha
   * provisória.
   *
   * O PIN de quatro dígitos em texto puro é o defeito D-0, e o administrativo
   * da v20 **vê o PIN de cada pessoa**. Migrá-lo migraria o defeito. A pessoa
   * entra sem credencial usável, e a administradora redefine o acesso pelo
   * caminho normal.
   */
  it('MUTAÇÃO · nenhuma pessoa migrada nasce com senha usável nem provisória', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ senha_hash: string; provisoria: boolean }>(
      `SELECT ps.senha_hash, ps.senha_provisoria AS provisoria FROM pessoas ps
         JOIN origens_da_v20 o ON o.id_interno = ps.id WHERE o.clinica_id = $1`,
      [clinica],
    )
    expect(r.rows.length).toBeGreaterThan(0)
    for (const linha of r.rows) {
      expect(linha.provisoria).toBe(false)
      // Um hash de Argon2 com parâmetros impossíveis: nenhuma senha casa.
      expect(linha.senha_hash).toContain('m=0,t=0,p=0')
    }
  })
})

describe('a forma de pagamento que a v20 não registrou (migration 0021)', () => {
  /**
   * **MUTAÇÃO:** manter `CHECK ((valor > 0) = (forma <> ''))`.
   *
   * O `INSERT` de 64 recebimentos de uma clínica real morre no banco. E se
   * alguém "resolvesse" inventando uma forma, a conferência de caixa passaria
   * a comparar a gaveta com um Pix que ninguém fez.
   */
  it('MUTAÇÃO · recebimento com valor > 0 e forma VAZIA é aceito, e conta em receita', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ valor: string; forma: string }>(
      `SELECT r.valor::text AS valor, r.forma FROM recebimentos r
         JOIN origens_da_v20 o ON o.id_interno = r.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Recebimento' AND o.id_externo = 't2'`,
      [clinica],
    )
    expect(r.rows[0]).toEqual({ valor: '50000', forma: '' })
  })

  /**
   * **MUTAÇÃO:** usar `DINHEIRO_QUE_ENTROU` (agora `valor > 0`) no caixa do
   * dia, em vez de `NA_GAVETA`.
   *
   * Um pagamento sem forma entraria no esperado do caixa num grupo de nome
   * vazio, e a conferência acusaria uma diferença que ninguém causou — a
   * recepcionista procuraria por uma hora um erro que ela não cometeu.
   */
  it('MUTAÇÃO · o pagamento sem forma entra em RECEITA e fica FORA da gaveta', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ receita: string; gaveta: string }>(
      `SELECT (SELECT coalesce(sum(r.valor),0)::text FROM recebimentos r
                WHERE r.clinica_id = $1 AND r.estornado_em IS NULL AND r.valor > 0) AS receita,
              (SELECT coalesce(sum(r.valor),0)::text FROM recebimentos r
                WHERE r.clinica_id = $1 AND r.estornado_em IS NULL
                  AND r.valor > 0 AND r.forma <> '') AS gaveta`,
      [clinica],
    )
    expect(r.rows[0]!.receita).toBe('155050')
    // A gaveta é a receita MENOS os 500,00 sem forma.
    expect(r.rows[0]!.gaveta).toBe('105050')
  })

  it('a venda a prazo continua recusada como "dinheiro que entrou"', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ valor: string; aberto: string; forma: string }>(
      `SELECT r.valor::text AS valor, r.valor_aberto::text AS aberto, r.forma
         FROM recebimentos r JOIN origens_da_v20 o ON o.id_interno = r.id
        WHERE o.clinica_id = $1 AND o.entidade = 'Recebimento' AND o.id_externo = 't1'`,
      [clinica],
    )
    expect(r.rows[0]).toEqual({ valor: '0', aberto: '120000', forma: '' })
  })
})

describe('tudo ou nada: o rollback é o `ROLLBACK`', () => {
  it('o ENSAIO roda a migração inteira e não grava NADA', async () => {
    await expect(migrar(PLANILHA(), DECISOES, true)).rejects.toThrow(MigracaoReprovada)
    const r = await migrate.query<{ n: string }>(
      `SELECT (SELECT count(*) FROM tarefas WHERE clinica_id = $1)
            + (SELECT count(*) FROM pacientes WHERE clinica_id = $1)
            + (SELECT count(*) FROM origens_da_v20 WHERE clinica_id = $1) AS n`,
      [clinica],
    )
    expect(r.rows[0]!.n).toBe('0')
  })

  it('o ensaio devolve o RELATÓRIO, que é a única coisa que sobrevive ao desfazimento', async () => {
    try {
      await migrar(PLANILHA(), DECISOES, true)
      expect.unreachable('o ensaio tem de lançar')
    } catch (e) {
      expect(e).toBeInstanceOf(MigracaoReprovada)
      const r = (e as MigracaoReprovada).relatorio
      expect(r?.fechado).toBe(true)
      expect(r?.linhas.length).toBeGreaterThan(10)
    }
  })

  /**
   * **MUTAÇÃO:** rodar a conferência DEPOIS do commit.
   *
   * Aí "a conferência falhou" deixa de ter resposta: a clínica está metade
   * migrada, e o rollback passa a ser um `DELETE` em quinze tabelas na ordem
   * certa, escrito às duas da manhã.
   */
  it('MUTAÇÃO · conferência que não fecha DESFAZ a migração inteira', async () => {
    // A planilha com um pagamento DUPLICADO: a mesma tarefa com dois ids. A
    // receita da origem já conta os dois, então o que quebra não é a receita —
    // é a INTEGRIDADE: o id repetido é um impedimento.
    const duplicada = montarXlsx({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Planos: PLANOS,
      Tarefas: [
        tarefa({ id: t('t1'), pacienteId: t('p1'), tipo: t('Pagamento de consulta'), valor: n('300.0'), formaPagamento: t('Pix') }),
        tarefa({ id: t('t1'), pacienteId: t('p1'), tipo: t('Pagamento de consulta'), valor: n('300.0'), formaPagamento: t('Pix') }),
      ],
    })
    await expect(migrar(duplicada)).rejects.toThrow(MigracaoReprovada)
    const r = await migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM origens_da_v20 WHERE clinica_id = $1',
      [clinica],
    )
    expect(r.rows[0]!.n).toBe('0')
  })
})

describe('o que REPROVA antes de qualquer escrita', () => {
  const semPerfil = () => montarXlsx({ Equipe: EQUIPE, Pacientes: PACIENTES, Planos: PLANOS })

  it('perfil de não-administrador sem decisão da clínica', async () => {
    const erro = await migrar(semPerfil(), { perfilPorPessoa: new Map() }).catch((e) => e)
    expect(erro).toBeInstanceOf(MigracaoReprovada)
    expect((erro as MigracaoReprovada).motivos.map((m) => m.codigo)).toContain('PerfilNaoRevisado')
  })

  it('colisão de `novoId()` na mesma aba', async () => {
    const buf = montarXlsx({
      Equipe: EQUIPE,
      Pacientes: [...PACIENTES, { id: t('p1'), nome: t('Outra Paciente') }],
      Planos: PLANOS,
    })
    const erro = await migrar(buf).catch((e) => e)
    expect((erro as MigracaoReprovada).motivos.map((m) => m.codigo)).toContain('IdRepetido')
  })

  it('tarefa que aponta para paciente fora da aba, com a LINHA no erro', async () => {
    const buf = montarXlsx({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Planos: PLANOS,
      Tarefas: [tarefa({ id: t('t1'), pacienteId: t('p9'), tipo: t('Follow-up') })],
    })
    const erro = await migrar(buf).catch((e) => e)
    const m = (erro as MigracaoReprovada).motivos.find((x) => x.codigo === 'PacienteOrfao')
    expect(m).toBeDefined()
    expect(m!.linha).toBe(2)
    expect(m!.aba).toBe('Tarefas')
  })

  /**
   * **MUTAÇÃO:** criar um recebimento para qualquer `valor > 0`.
   *
   * O dinheiro de um tipo que não é receita, não abate saldo e não é orçamento
   * não tem coluna no destino — e escolher uma dobraria a receita ou criaria
   * uma proposta que ninguém fez. É o único caminho pelo qual este épico
   * poderia violar a regra 3 em silêncio.
   */
  it('MUTAÇÃO · `valor > 0` num tipo sem lugar no destino REPROVA, nomeando o tipo', async () => {
    const buf = montarXlsx({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Planos: PLANOS,
      Tarefas: [tarefa({ id: t('t1'), pacienteId: t('p1'), tipo: t('Follow-up'), valor: n('400.0') })],
    })
    const erro = await migrar(buf).catch((e) => e)
    const m = (erro as MigracaoReprovada).motivos.find((x) => x.codigo === 'ValorEmTipoSemLugar')
    expect(m).toBeDefined()
    expect(m!.mensagem).toContain('Follow-up')
  })

  it('campanha com meta zero, que o `CHECK (meta > 0)` recusaria no `INSERT`', async () => {
    const buf = montarXlsx({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Planos: PLANOS,
      Campanhas: [{ id: t('c1'), nome: t('Campanha Um'), inicio: t('2026-01-01'), fim: t('2026-01-31'), metrica: t('contatos') }],
    })
    const erro = await migrar(buf).catch((e) => e)
    expect((erro as MigracaoReprovada).motivos.map((m) => m.codigo)).toContain('MetaNaoPositiva')
  })

  it('sessão com `k/n` ilegível', async () => {
    const buf = montarXlsx({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Planos: PLANOS,
      Adesoes: ADESOES,
      Tarefas: [tarefa({ id: t('t1'), pacienteId: t('p1'), tipo: t('Sessão de plano'), adesaoId: t('a1'), sessao: t('5/2') })],
    })
    const erro = await migrar(buf).catch((e) => e)
    expect((erro as MigracaoReprovada).motivos.map((m) => m.codigo)).toContain('SessaoSemNumeracao')
  })
})

describe('RLS e trilha — a migração não escapa de nenhuma das duas', () => {
  /**
   * **MUTAÇÃO:** rodar o migrador por `fir_migrate`.
   *
   * `fir_migrate` tem `BYPASSRLS`. Uma migração que atravessa a RLS pode
   * escrever o histórico de uma clínica dentro de outra **sem o banco
   * recusar** — e é o pior defeito que este épico pode ter. Com `fir_app`, a
   * policy é a segunda assinatura em cada `INSERT`.
   */
  it('MUTAÇÃO · nada do que foi migrado aparece na clínica vizinha', async () => {
    await migrar(PLANILHA())
    const r = await banco.naClinica(clinicaIdDeFonteConfiavel(vizinha), SISTEMA, (c) =>
      c.query<{ n: string }>(
        `SELECT (SELECT count(*) FROM tarefas)
              + (SELECT count(*) FROM pacientes)
              + (SELECT count(*) FROM recebimentos)
              + (SELECT count(*) FROM origens_da_v20) AS n`,
      ),
    )
    expect(r.rows[0]!.n).toBe('0')
  })

  it('toda escrita cai na trilha da clínica, com o ator SISTEMA', async () => {
    await migrar(PLANILHA())
    const r = await migrate.query<{ entidade: string; ator_tipo: string; n: string }>(
      `SELECT entidade, ator_tipo, count(*)::text AS n
         FROM auditoria WHERE clinica_id = $1 GROUP BY entidade, ator_tipo ORDER BY entidade`,
      [clinica],
    )
    expect(r.rows.length).toBeGreaterThan(0)
    expect(new Set(r.rows.map((x) => x.ator_tipo))).toEqual(new Set(['sistema']))
    const entidades = new Set(r.rows.map((x) => x.entidade))
    expect(entidades).toContain('tarefas')
    expect(entidades).toContain('pacientes')
    expect(entidades).toContain('recebimentos')
    expect(entidades).toContain('origens_da_v20')
  })
})
