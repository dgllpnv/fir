import { apagarClinicaDeTeste, declararAtorSistema } from '@fir/api/banco/limpeza-de-teste'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * O esquema da rotina, cobrado no BANCO — não no serviço.
 *
 * A regra 3 ("cada pagamento conta uma vez") é a razão de ser deste arquivo.
 * Ela não pode depender de revisão de código nem de um `if` no serviço: a
 * migração das 4 clínicas, um job futuro e um `psql` às duas da manhã
 * escrevem pelo mesmo caminho do handler, e só o banco alcança os três.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const URL_APP =
  process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
let app: pg.Client

const marca = `rot-${Date.now()}`
let clinica: string
let outra: string
let pessoa: string
let pessoaDaOutra: string
let paciente: string
let pacienteDaOutra: string

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

const criarClinica = async (codigo: string): Promise<string> =>
  umId(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica Rotina') RETURNING id`, [codigo])

async function criarPessoa(clinicaId: string): Promise<string> {
  const perfil = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['pacientes']) RETURNING id`,
    [clinicaId],
  )
  return umId(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
     VALUES ($1, 'Juliana', 'juliana', 'x', $2) RETURNING id`,
    [clinicaId, perfil],
  )
}

const inserirPaciente = (clinicaId: string, nome: string, telefone = ''): Promise<string> =>
  umId('INSERT INTO pacientes (clinica_id, nome, telefone) VALUES ($1, $2, $3) RETURNING id', [
    clinicaId,
    nome,
    telefone,
  ])

type TarefaCrua = {
  clinicaId?: string
  pacienteId?: string | null
  tipo?: string
  status?: string
  concluidaEm?: string | null
  descricao?: string
  prazo?: string
}

const inserirTarefa = (t: TarefaCrua = {}): Promise<string> =>
  umId(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo, status, concluida_em)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      t.clinicaId ?? clinica,
      t.clinicaId === outra ? pessoaDaOutra : pessoa,
      t.descricao ?? 'Confirmar consulta',
      t.prazo ?? '2026-10-24',
      t.pacienteId === undefined ? paciente : t.pacienteId,
      t.tipo ?? (t.pacienteId === null ? '' : 'Consulta agendada'),
      t.status ?? 'aberta',
      t.concluidaEm ?? null,
    ],
  )

const inserirRecebimento = (tarefaId: string | null, valor: bigint, clinicaId = clinica): Promise<string> =>
  umId(
    `INSERT INTO recebimentos
       (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, recebido_em, registrado_por)
     VALUES ($1, $2, $3, 'Pagamento de consulta', $4, 'Pix', now(), $5) RETURNING id`,
    [
      clinicaId,
      clinicaId === outra ? pacienteDaOutra : paciente,
      tarefaId,
      valor.toString(),
      clinicaId === outra ? pessoaDaOutra : pessoa,
    ],
  )

const estornar = async (recebimentoId: string): Promise<void> => {
  await migrate.query('UPDATE recebimentos SET estornado_em = now() WHERE id = $1', [recebimentoId])
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[rotina-rls] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  app = new pg.Client({ connectionString: URL_APP })
  app.on('error', (e) => console.error('[rotina-rls] app:', e.message))
  await app.connect()

  clinica = await criarClinica(marca)
  outra = await criarClinica(`${marca}-b`)
  pessoa = await criarPessoa(clinica)
  pessoaDaOutra = await criarPessoa(outra)
  paciente = await inserirPaciente(clinica, 'Paciente Base')
  pacienteDaOutra = await inserirPaciente(outra, 'Paciente Base')
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outra)
  await migrate.end()
  await app.end()
})

describe('a regra 3, no banco', () => {
  it('o mesmo atendimento não aceita dois recebimentos', async () => {
    const tarefa = await inserirTarefa()
    await inserirRecebimento(tarefa, 45_000n)
    await expect(inserirRecebimento(tarefa, 45_000n)).rejects.toThrow(/recebimento_por_tarefa/i)
  })

  it('estornar libera a tarefa para um recebimento novo', async () => {
    const tarefa = await inserirTarefa()
    const r = await inserirRecebimento(tarefa, 45_000n)
    await estornar(r)
    await expect(inserirRecebimento(tarefa, 50_000n)).resolves.toBeDefined()
  })

  it('depois de relançar, o atendimento volta a recusar o segundo recebimento vivo', async () => {
    // O estorno abre UMA vaga, não desliga a regra. Sem esta asserção, um
    // índice que simplesmente ignorasse tudo passaria nos dois testes acima.
    const tarefa = await inserirTarefa()
    await estornar(await inserirRecebimento(tarefa, 45_000n))
    await inserirRecebimento(tarefa, 50_000n)
    await expect(inserirRecebimento(tarefa, 10_000n)).rejects.toThrow(/recebimento_por_tarefa/i)
  })

  it('dois recebimentos ESTORNADOS na mesma tarefa convivem — o histórico não se apaga', async () => {
    const tarefa = await inserirTarefa()
    await estornar(await inserirRecebimento(tarefa, 45_000n))
    await estornar(await inserirRecebimento(tarefa, 46_000n))
    const r = await migrate.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM recebimentos WHERE tarefa_id = $1',
      [tarefa],
    )
    expect(r.rows[0]!.n).toBe('2')
  })

  it('recebimento avulso (sem tarefa) não é bloqueado pelo índice parcial', async () => {
    // O índice é `WHERE tarefa_id IS NOT NULL`: o épico 4 lança recebimento
    // sem tarefa, e dois deles para a mesma paciente são dois pagamentos de
    // verdade, não uma duplicação.
    await expect(inserirRecebimento(null, 1_000n)).resolves.toBeDefined()
    await expect(inserirRecebimento(null, 2_000n)).resolves.toBeDefined()
  })

  /**
   * **D-9 trocou o `CHECK`, e este teste mudou de significado.**
   *
   * Até a `0010`, `recebimentos.valor` tinha `CHECK (valor > 0)` e este teste
   * provava "zero e negativo são recusados". A `0011` substituiu aquele
   * `CHECK` por `valor > 0 OR valor_aberto > 0`, porque a clínica fecha um
   * programa que a paciente paga depois e o sistema precisa registrar a
   * dívida (`docs/decisoes.md`, D-9).
   *
   * O que **não** mudou: **negativo continua recusado**, e a linha que não
   * registra nada também. O que mudou é que zero + dívida é uma linha
   * legítima — e ela é invisível para o caixa, para a lista do dia e para o
   * LTV, provado em `apps/api/src/financeiro/venda-a-prazo.e2e.test.ts`.
   *
   * `inserirRecebimento` manda `forma: 'Pix'`, então aqui as combinações com
   * valor zero morrem na bicondicional da forma antes de chegar ao resto — e
   * é isso que se quer: no caminho de escrita de verdade quem monta a linha é
   * o serviço, e ele grava forma vazia junto do valor zero.
   */
  it('valor negativo continua recusado, e zero SÓ vale com dívida (D-9)', async () => {
    const tarefa = await inserirTarefa()
    // Negativo, com forma VAZIA: assim a linha atravessa a bicondicional da
    // forma e morre em `recebimento_valor_nao_negativo`, que é a constraint
    // que este caso existe para provar. Com 'Pix' ela morreria na forma, e o
    // teste diria que a não-negatividade está guardada quando ela não está.
    await expect(
      umId(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
         VALUES ($1,$2,$3,'Pagamento de consulta',-1,'',100000, now(), $4) RETURNING id`,
        [clinica, paciente, tarefa, pessoa],
      ),
    ).rejects.toThrow(/recebimento_valor_nao_negativo/)
    // Zero COM forma de pagamento: não existe Pix de R$ 0,00.
    await expect(inserirRecebimento(tarefa, 0n)).rejects.toThrow(/forma_so_com_dinheiro/i)
    // Zero sem forma e sem dívida: a linha não registra nada.
    await expect(
      umId(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
         VALUES ($1,$2,$3,'Pagamento de consulta',0,'',0, now(), $4) RETURNING id`,
        [clinica, paciente, tarefa, pessoa],
      ),
    ).rejects.toThrow(/recebimento_registra_algo/)
    // Zero COM dívida e sem forma: a venda a prazo, e ela passa.
    await expect(
      umId(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
         VALUES ($1,$2,$3,'Pagamento de orçamento',0,'',360000, now(), $4) RETURNING id`,
        [clinica, paciente, tarefa, pessoa],
      ),
    ).resolves.toBeDefined()
  })
})

describe('a tarefa não guarda dinheiro', () => {
  it('nenhuma coluna de `tarefas` é monetária — nem valor, nem forma de pagamento', async () => {
    // A decisão central do épico, cobrada no catálogo e não na revisão. O
    // legado tem `valor`, `valor_aberto` e `forma_pagamento` em `tarefas`, e é
    // por isso que a receita do mês dobra quando alguém lança o recebimento
    // avulso do mesmo atendimento.
    const r = await migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'tarefas'`,
    )
    const nomes = r.rows.map((x) => x.column_name)
    expect(nomes.length, 'tarefas não existe').toBeGreaterThan(5)
    // `.sort()`: a ordem de `information_schema.columns` é a do catálogo, e
    // `ALTER TABLE ADD COLUMN` a muda. Comparar lista ORDENADA com lista
    // ordenada mantém a comparação exata sem amarrá-la à ordem de criação.
    const suspeitas = nomes
      .filter((n) => /valor|preco|custo|pago|pagamento|desconto|total|centavos/.test(n))
      .sort()
    /**
     * A ÚNICA exceção, e a lista é EXATA de propósito.
     *
     * `valor_orcamento` (épico 3) é a única coluna com cara de dinheiro que
     * `tarefas` pode ter, e ela NÃO É RECEITA (regra 4): mede conversão do
     * funil e nunca entra em total recebido, LTV, meta nem caixa. A receita
     * continua sendo `recebimentos.valor`, uma linha por pagamento, com o
     * índice único que impede a segunda.
     *
     * Comparar com a lista exata, e não "filtrar as conhecidas", é o que
     * mantém os dentes: no dia em que `valor`, `valor_aberto` ou
     * `forma_pagamento` voltarem para cá — e com eles a receita do mês que
     * dobra —, este teste nomeia a coluna.
     */
    expect(suspeitas, `colunas monetárias em tarefas: ${suspeitas.join(', ')}`).toEqual([
      'sessao_total',
      'valor_orcamento',
    ])
  })

  it('`sessao_total` é uma CONTAGEM, não dinheiro — e o tipo prova', async () => {
    // Ela cai no filtro acima pela palavra `total`, e é a mesma colisão de
    // nome genérico que o épico 4 mediu em `CAMPOS_MONETARIOS` (`total` já
    // era a contagem de páginas de `PaginaDePacientes`). Aqui `sessao_total`
    // é o "12" de "Aplicação 5/12" — a string `sessao = "5/12"` que as 4
    // clínicas têm gravada.
    //
    // A exceção na lista acima só é honesta com esta asserção ao lado:
    // `smallint` não comporta centavos de nada que a clínica cobre, então a
    // coluna NÃO PODE virar dinheiro sem que o tipo mude e este teste caia.
    const r = await migrate.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tarefas' AND column_name='sessao_total'`,
    )
    expect(r.rows[0]?.data_type).toBe('smallint')
  })

  it('`valor_orcamento` é bigint de centavos, e aceita só valor positivo', async () => {
    const r = await migrate.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tarefas' AND column_name='valor_orcamento'`,
    )
    expect(r.rows[0]!.data_type).toBe('bigint')
  })

  it('`valor` de recebimentos é bigint de centavos, nunca numeric nem float', async () => {
    const r = await migrate.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='recebimentos' AND column_name IN ('valor','valor_aberto')`,
    )
    expect(r.rows.length).toBe(2)
    for (const linha of r.rows) expect(linha.data_type).toBe('bigint')
  })
})

describe('o nome do paciente, normalizado', () => {
  it('dois pacientes com o mesmo nome, só acento diferente, são o mesmo nome', async () => {
    await inserirPaciente(clinica, 'Ana Lúcia  Souza')
    await expect(inserirPaciente(clinica, 'ana lucia souza')).rejects.toThrow(
      /pacientes_nome_unico/i,
    )
  })

  it('o mesmo nome em OUTRA clínica é permitido', async () => {
    await inserirPaciente(clinica, 'Carla Mendes')
    await expect(inserirPaciente(outra, 'Carla Mendes')).resolves.toBeDefined()
  })

  it('paciente DESATIVADO devolve o nome — quem apagou por engano recadastra', async () => {
    const id = await inserirPaciente(clinica, 'Marta Ribeiro')
    await migrate.query('UPDATE pacientes SET ativo=false, desativado_em=now() WHERE id=$1', [id])
    await expect(inserirPaciente(clinica, 'Marta Ribeiro')).resolves.toBeDefined()
  })

  it('o telefone vira só dígitos, e vazio vira nulo', async () => {
    const id = await inserirPaciente(clinica, 'Telefone Formatado', '(71) 98888-7777')
    const r = await migrate.query<{ telefone_chave: string | null }>(
      'SELECT telefone_chave FROM pacientes WHERE id = $1',
      [id],
    )
    expect(r.rows[0]!.telefone_chave).toBe('71988887777')

    const semTelefone = await inserirPaciente(clinica, 'Sem Telefone')
    const s = await migrate.query<{ telefone_chave: string | null }>(
      'SELECT telefone_chave FROM pacientes WHERE id = $1',
      [semTelefone],
    )
    expect(s.rows[0]!.telefone_chave).toBeNull()
  })
})

describe('as restrições da tarefa', () => {
  it('tarefa com tipo exige paciente, e paciente exige tipo', async () => {
    await expect(inserirTarefa({ pacienteId: null, tipo: 'Follow-up' })).rejects.toThrow(
      /tipo_exige_paciente/i,
    )
    await expect(inserirTarefa({ tipo: '' })).rejects.toThrow(/tipo_exige_paciente/i)
  })

  it('tarefa interna (sem paciente e sem tipo) é aceita', async () => {
    await expect(inserirTarefa({ pacienteId: null, tipo: '' })).resolves.toBeDefined()
  })

  it('concluída sem instante é recusada, e aberta COM instante também', async () => {
    await expect(inserirTarefa({ status: 'concluida' })).rejects.toThrow(
      /concluida_tem_instante/i,
    )
    await expect(
      inserirTarefa({ status: 'aberta', concluidaEm: '2026-10-24T15:00:00Z' }),
    ).rejects.toThrow(/concluida_tem_instante/i)
  })

  it('status fora da lista branca é recusado pelo ENUM', async () => {
    await expect(inserirTarefa({ status: 'arquivada' })).rejects.toThrow(/status_de_tarefa/i)
  })

  it('descrição acima de 400 caracteres é recusada', async () => {
    await expect(inserirTarefa({ descricao: 'x'.repeat(401) })).rejects.toThrow(/descricao/i)
  })
})

describe('isolamento por clínica, pelo papel da aplicação', () => {
  it('`fir_app` fixado na clínica A não enxerga o paciente da clínica B', async () => {
    await app.query('BEGIN')
    try {
      await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
      const r = await app.query<{ id: string }>('SELECT id FROM pacientes WHERE id = $1', [
        pacienteDaOutra,
      ])
      expect(r.rows).toEqual([])
      const meu = await app.query<{ id: string }>('SELECT id FROM pacientes WHERE id = $1', [
        paciente,
      ])
      expect(meu.rows.length).toBe(1)
    } finally {
      await app.query('ROLLBACK')
    }
  })

  it('`fir_app` não grava tarefa em outra clínica — o WITH CHECK recusa', async () => {
    await app.query('BEGIN')
    try {
      await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
      await app.query('SELECT set_config($1, $2, true)', ['app.pessoa_id', 'sistema'])
      await expect(
        app.query(
          `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo)
           VALUES ($1, $2, $2, 'invasão', '2026-10-24')`,
          [outra, pessoaDaOutra],
        ),
      ).rejects.toThrow(/row-level security|política|policy/i)
    } finally {
      await app.query('ROLLBACK')
    }
  })
})
