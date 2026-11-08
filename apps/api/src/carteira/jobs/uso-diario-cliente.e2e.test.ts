import type { Relogio } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoService } from '../../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { executarUsoDiarioCliente } from './uso-diario-cliente'

/**
 * **G4 — O JOB DE `uso_diario_cliente`, contra Postgres real.**
 *
 * O que este arquivo prova:
 *
 *  1. As contagens do dia batem com a fixture, lendo DENTRO da clínica certa
 *     (o job abre `banco.naClinica`, sujeito à RLS de `clinica_id` — regra 19
 *     — como qualquer rota do produto).
 *  2. **IDEMPOTÊNCIA (regra 26):** rodar o job duas vezes para o MESMO dia
 *     escreve a MESMA linha — nunca duplica, nunca distorce.
 *  3. **ISOLAMENTO ENTRE CLIENTES:** duas clínicas, dois `Cliente Firmare`,
 *     dois grupos — a receita de uma não vaza para a linha da outra.
 *  4. Só `Cliente Firmare` com `status = 'ativo'` recebe linha.
 *  5. `receita_registrada` é center de centavos (`bigint`/string), nunca ponto
 *     flutuante.
 *  6. `faltas_recontatadas` (G8 1D): reagendamento no dia de cartão cuja
 *     etapa anterior era `faltou`/`desmarcou` — e só esses.
 *  7. R13: uso crítico vira UMA tarefa interna por (cliente, dia), rodando três
 *     vezes; a cancelada pela equipe não renasce.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `uso-diario-${Date.now()}`

/** O dia alvo do job — fixo, para que a fixture e a asserção concordem. */
const DIA = '2026-11-10'
/** Um instante dentro do dia 10, em `America/Bahia` (UTC-3): 15h UTC = 12h local. */
const EM = `${DIA}T15:00:00.000Z`

let migrate: pg.Client
let banco: BancoService
const relogio: Relogio = { agora: () => new Date(`${DIA}T23:00:00.000Z`) }

let clinicaA: string
let pessoaA: string
let pacienteA: string
let grupoA: string
let clienteA: string

let clinicaB: string
let grupoB: string
let clienteB: string

let clinicaC: string
let clienteOnboarding: string

let clinicaD: string
let clienteD: string

const novaClinica = async (nome: string, fuso = 'America/Bahia'): Promise<string> =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, $2, $3) RETURNING id`,
      [`${codigo}-${nome}`, nome, fuso],
    )
  ).rows[0]!.id

const novoGrupo = async (nome: string): Promise<string> =>
  (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [nome]))
    .rows[0]!.id

const novoClienteCarteira = async (
  grupoId: string,
  clinicaId: string,
  status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado' = 'ativo',
): Promise<string> =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status)
       VALUES ($1, $2, 'Cliente de teste', 'FIR Clinic', $3) RETURNING id`,
      [grupoId, clinicaId, status],
    )
  ).rows[0]!.id

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[uso-diario] migrate:', e.message))
  await migrate.connect()
  // TRAVA COMPARTILHADA com o outro arquivo de job da carteira (D16). Os dois
  // jobs varrem TODO `Cliente Firmare` ativo do banco, e em paralelo cada um
  // escrevia para os clientes do outro: contagem errada e limpeza abortada por
  // FK. A trava é de SESSÃO nesta conexão — o outro arquivo espera aqui até
  // `migrate.end()` soltá-la. Serializa só estes dois, não a suíte inteira.
  await migrate.query("SELECT pg_advisory_lock(hashtext('teste:jobs-da-carteira'))")
  await declararAtorSistema(migrate)
  banco = new BancoService()

  // ----------------------------------------------------------------- Clínica A
  clinicaA = await novaClinica('A — Uso diário')
  const perfilA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_rec', 'Recepção', '{}')
       RETURNING id`,
      [clinicaA],
    )
  ).rows[0]!.id
  pessoaA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id, ativo)
       VALUES ($1, 'Helena', 'helena', 'x', $2, true) RETURNING id`,
      [clinicaA, perfilA],
    )
  ).rows[0]!.id

  // Login no dia — `usuarios_ativos` (decisão do dono, plano §9 Q4).
  await migrate.query(
    `INSERT INTO sessoes (clinica_id, pessoa_id, token_hash, criada_em, expira_em)
     VALUES ($1, $2, $4, $3::timestamptz, $3::timestamptz + interval '1 day')`,
    // Token ÚNICO por execução: `sessoes.token_hash` é UNIQUE, e um valor fixo
    // fazia toda execução seguinte colidir com a linha que uma execução
    // interrompida deixou para trás — a suíte ficava vermelha para sempre.
    [clinicaA, pessoaA, EM, `hash-de-teste-${Date.now()}-${Math.random()}`],
  )

  pacienteA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Paciente de teste') RETURNING id`,
      [clinicaA],
    )
  ).rows[0]!.id

  // Atendimento pagável, concluído com pagamento, COM paciente — conta em
  // `tarefasConcluidas` e em `receitaRegistrada` (atende+pagavel, r.valor > 0,
  // e a receita exige `paciente_id IS NOT NULL`, mesma definição do painel).
  const atendimento = (
    await migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
          criada_em, paciente_id, tipo, historico)
       VALUES ($1, $2, $2, 'fixture', $3::date, 'concluida', $4, $4, $5, 'Consulta realizada', '[]'::jsonb)
       RETURNING id`,
      [clinicaA, pessoaA, DIA, EM, pacienteA],
    )
  ).rows[0]!.id
  await migrate.query(
    `INSERT INTO recebimentos
       (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
     VALUES ($1, $2, $3, 'Consulta realizada', 15000, 'Pix', 0, $4, $5)`,
    [clinicaA, pacienteA, atendimento, EM, pessoaA],
  )

  // Contato com paciente, concluído no dia — `contatosPacientes`.
  await migrate.query(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
        criada_em, paciente_id, tipo, historico)
     VALUES ($1, $2, $2, 'fixture', $3::date, 'concluida', $4, $4, $5, 'Confirmação', '[]'::jsonb)`,
    [clinicaA, pessoaA, DIA, EM, pacienteA],
  )

  // Orçamento enviado e fechado — eventos de jornada por `acao` declarada.
  await migrate.query(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status,
        criada_em, paciente_id, tipo, historico)
     VALUES ($1, $2, $2, 'fixture', $3::date, 'aberta', $4,
             $6, 'Orçamento enviado', $5::jsonb)`,
    [
      clinicaA,
      pessoaA,
      DIA,
      EM,
      JSON.stringify([{ acao: 'registrarOrcamento', etapa: 'orcamento', porId: pessoaA, em: EM }]),
      pacienteA,
    ],
  )
  const orcamentoFechado = (
    await migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
          criada_em, paciente_id, tipo, historico)
       VALUES ($1, $2, $2, 'fixture', $3::date, 'concluida', $4, $4, $6, 'Pagamento de orçamento', $5::jsonb)
       RETURNING id`,
      [
        clinicaA,
        pessoaA,
        DIA,
        EM,
        JSON.stringify([{ acao: 'fechar', etapa: 'fechado', porId: pessoaA, em: EM }]),
        pacienteA,
      ],
    )
  ).rows[0]!.id
  await migrate.query(
    `INSERT INTO recebimentos
       (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
     VALUES ($1, $2, $3, 'Pagamento de orçamento', 32000, 'Pix', 0, $4, $5)`,
    [clinicaA, pacienteA, orcamentoFechado, EM, pessoaA],
  )

  // Vencida, aberta — snapshot do backlog no fim do dia.
  await migrate.query(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, criada_em, paciente_id, tipo, historico)
     VALUES ($1, $2, $2, 'fixture', '2026-11-01'::date, 'aberta', $3, $4, 'Follow-up', '[]'::jsonb)`,
    [clinicaA, pessoaA, EM, pacienteA],
  )

  // Falta — evento `noshow` do histórico da jornada.
  await migrate.query(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, criada_em, paciente_id, tipo, historico)
     VALUES ($1, $2, $2, 'fixture', $3::date, 'aberta', $4, $6, 'Consulta agendada', $5::jsonb)`,
    [clinicaA, pessoaA, DIA, EM, JSON.stringify([{ acao: 'noshow', etapa: 'faltou', porId: pessoaA, em: EM }]), pacienteA],
  )

  // Aberta, com prazo no FUTURO — não é backlog vencido, e prova que o corte
  // de `tarefas_vencidas_abertas` de fato exclui alguma coisa.
  await migrate.query(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, criada_em, paciente_id, tipo, historico)
     VALUES ($1, $2, $2, 'fixture', '2026-12-01'::date, 'aberta', $3, $4, 'Follow-up', '[]'::jsonb)`,
    [clinicaA, pessoaA, EM, pacienteA],
  )

  // ---- Recontatos (G8 1D). Criadas em 05/11, prazo em dezembro: fora de
  // "criadas", "no prazo" e "vencidas" do dia 10; as faltas originais são de
  // dias ANTERIORES, então "faltas" do dia 10 continua 1.
  const ANTES = '2026-11-06T15:00:00.000Z'
  const DEPOIS = '2026-11-11T15:00:00.000Z'
  const cartao = async (historico: object[]): Promise<void> => {
    await migrate.query(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, criada_em, paciente_id, tipo, historico)
       VALUES ($1, $2, $2, 'fixture', '2026-12-01'::date, 'aberta', '2026-11-05T12:00:00Z', $3, 'Consulta agendada', $4::jsonb)`,
      [clinicaA, pessoaA, pacienteA, JSON.stringify(historico)],
    )
  }
  const ev = (acao: string, etapa: string, em: string) => ({ acao, etapa, em, porId: pessoaA })
  // Conta: faltou em 06/11, reagendada em 10/11.
  await cartao([ev('agendar', 'agendado', ANTES), ev('noshow', 'faltou', ANTES), ev('reagendar', 'agendado', EM)])
  // Conta: desmarcou em 06/11, reagendada em 10/11.
  await cartao([ev('agendar', 'agendado', ANTES), ev('desmarcar', 'desmarcou', ANTES), ev('reagendar', 'agendado', EM)])
  // NÃO conta: remarcação de quem nunca faltou (etapa anterior `agendado`).
  await cartao([ev('agendar', 'agendado', ANTES), ev('reagendar', 'agendado', EM)])
  // NÃO conta: o recontato aconteceu em OUTRO dia.
  await cartao([ev('agendar', 'agendado', ANTES), ev('noshow', 'faltou', ANTES), ev('reagendar', 'agendado', ANTES)])
  // NÃO conta: `reagendar` é o PRIMEIRO evento. Sem a guarda `ev.i > 1`, o
  // índice -1 do jsonb leria o ÚLTIMO evento (`faltou`) e contaria.
  await cartao([ev('reagendar', 'agendado', EM), ev('noshow', 'faltou', DEPOIS)])

  grupoA = await novoGrupo(`Grupo A ${codigo}`)
  clienteA = await novoClienteCarteira(grupoA, clinicaA, 'ativo')

  // ----------------------------------------------------------------- Clínica B
  // Isolamento: outra clínica, outro grupo, outro cliente — nenhum número de A
  // pode aparecer na linha de B.
  clinicaB = await novaClinica('B — Isolamento')
  const perfilB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_rec', 'Recepção', '{}')
       RETURNING id`,
      [clinicaB],
    )
  ).rows[0]!.id
  const pessoaB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id, ativo)
       VALUES ($1, 'Juliana', 'juliana', 'x', $2, true) RETURNING id`,
      [clinicaB, perfilB],
    )
  ).rows[0]!.id
  const pacienteB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Paciente B') RETURNING id`,
      [clinicaB],
    )
  ).rows[0]!.id
  const atendimentoB = (
    await migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
          criada_em, paciente_id, tipo, historico)
       VALUES ($1, $2, $2, 'fixture', $3::date, 'concluida', $4, $4, $5, 'Consulta realizada', '[]'::jsonb)
       RETURNING id`,
      [clinicaB, pessoaB, DIA, EM, pacienteB],
    )
  ).rows[0]!.id
  await migrate.query(
    `INSERT INTO recebimentos
       (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
     VALUES ($1, $2, $3, 'Consulta realizada', 7000, 'Dinheiro', 0, $4, $5)`,
    [clinicaB, pacienteB, atendimentoB, EM, pessoaB],
  )

  grupoB = await novoGrupo(`Grupo B ${codigo}`)
  clienteB = await novoClienteCarteira(grupoB, clinicaB, 'ativo')

  // Um Cliente Firmare em onboarding — não deve ganhar linha nenhuma.
  // Clínica PRÓPRIA: `clientes_carteira.clinica_id` é ÚNICO (no máximo um
  // Cliente Firmare por clínica).
  clinicaC = await novaClinica('C — Onboarding')
  clienteOnboarding = await novoClienteCarteira(grupoB, clinicaC, 'onboarding')

  // ----------------------------------------------------------------- Clínica D
  // R13: parada. Linhas de sexta 06/11 e segunda 09/11 sem uso; o job grava a
  // de terça 10/11 (também sem uso, a clínica não tem dado nenhum). "Hoje"
  // do alerta = 11/11, e os três últimos dias úteis (06, 09, 10) estão parados.
  clinicaD = await novaClinica('D — Parada')
  clienteD = await novoClienteCarteira(grupoB, clinicaD, 'ativo')
  for (const dia of ['2026-11-06', '2026-11-09']) {
    await migrate.query(
      `INSERT INTO uso_diario_cliente (cliente_carteira_id, grupo_id, dia, usuarios_cadastrados, faltas_recontatadas)
       VALUES ($1, $2, $3, 2, 0)`,
      [clienteD, grupoB, dia],
    )
  }
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const todos = [clienteA, clienteB, clienteOnboarding, clienteD]
  await migrate.query('DELETE FROM tarefas_internas WHERE cliente_carteira_id = ANY($1)', [todos])
  await migrate.query('DELETE FROM uso_diario_cliente WHERE cliente_carteira_id = ANY($1)', [todos])
  // O job do OUTRO arquivo (rodando em paralelo, D16) também escreve para
  // estes clientes; sem limpar as duas tabelas, a FK aborta a limpeza e o
  // resíduo contamina a próxima execução.
  for (const t of ['uso_diario_cliente', 'cobrancas_do_cliente_firmare']) {
    await migrate.query(`DELETE FROM ${t} WHERE cliente_carteira_id = ANY($1)`, [todos])
  }
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [todos])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await apagarClinicaDeTeste(migrate, clinicaA)
  await apagarClinicaDeTeste(migrate, clinicaB)
  await apagarClinicaDeTeste(migrate, clinicaC)
  await apagarClinicaDeTeste(migrate, clinicaD)
  await migrate.end()
  await banco.onModuleDestroy()
})

type LinhaUsoDiario = {
  cliente_carteira_id: string
  grupo_id: string
  dia: string
  usuarios_cadastrados: number
  usuarios_ativos: number
  tarefas_criadas: number
  tarefas_concluidas: number
  tarefas_no_prazo: number
  tarefas_vencidas_abertas: number
  contatos_pacientes: number
  orcamentos_enviados: number
  orcamentos_pagos: number
  faltas: number
  faltas_recontatadas: number | null
  receita_registrada: string
}

const linhaDe = async (clienteCarteiraId: string): Promise<LinhaUsoDiario | undefined> =>
  (
    await migrate.query<LinhaUsoDiario>(
      `SELECT * FROM uso_diario_cliente WHERE cliente_carteira_id = $1 AND dia = $2`,
      [clienteCarteiraId, DIA],
    )
  ).rows[0]

describe('executarUsoDiarioCliente — G4', () => {
  it('calcula a linha do dia para cada Cliente Firmare ATIVO, e só para eles', async () => {
    const resumo = await executarUsoDiarioCliente(banco, relogio, DIA)
    // Só as falhas DOS clientes deste arquivo: o job varre o banco inteiro, e outro arquivo
    // rodando junto pode apagar um cliente dele no meio da varredura (corrida de FK).
    const meus = [clienteA, clienteB, clienteOnboarding, clienteD]
    expect(resumo.falhas.filter((x) => meus.includes(x.clienteCarteiraId))).toEqual([])
    // Só os 'ativo' entram — o 'onboarding' não. A prova é POR CLIENTE, não
    // pelo `processados` global: o job varre todo `Cliente Firmare` ativo do
    // banco (D16), e o arquivo de cobranças, rodando em paralelo, tem os dele.
    // `toBe(2)` sobre o total falhava com 9 assim que os dois arquivos se
    // cruzavam — medido em 2026-11-08.
    expect(resumo.processados).toBeGreaterThanOrEqual(2)
    expect(await linhaDe(clienteB)).toBeDefined()
    expect(await linhaDe(clienteOnboarding)).toBeUndefined()

    const a = await linhaDe(clienteA)
    expect(a).toBeDefined()
    expect(a!.grupo_id).toBe(grupoA)
    expect(a!.usuarios_cadastrados).toBe(1)
    expect(a!.usuarios_ativos).toBe(1)
    // 7 tarefas criadas no dia — `criada_em` é EM para todas, mesmo as com
    // `prazo` em outro dia (passado ou futuro): `tarefas_criadas` é pela
    // CRIAÇÃO, nunca pelo prazo.
    expect(a!.tarefas_criadas).toBe(7)
    // Concluídas: atendimento + contato + orçamento fechado = 3.
    expect(a!.tarefas_concluidas).toBe(3)
    // No prazo: as 3 concluídas no mesmo dia do prazo. As duas abertas com
    // prazo = hoje caem em "a vencer", fora do numerador — e a de prazo em
    // dezembro fica fora da janela do dia (`prazo BETWEEN dia, dia`).
    expect(a!.tarefas_no_prazo).toBe(3)
    expect(a!.contatos_pacientes).toBe(1)
    expect(a!.orcamentos_enviados).toBe(1)
    expect(a!.orcamentos_pagos).toBe(1)
    // Vencidas e abertas no FIM do dia: a de 1/11, a de orçamento enviado e a
    // da falta — todas com `prazo <= dia`. A de dezembro não vence ainda.
    expect(a!.tarefas_vencidas_abertas).toBe(3)
    expect(a!.faltas).toBe(1)
    // Receita: 15000 (atendimento) + 32000 (orçamento) = 47000 centavos.
    expect(a!.receita_registrada).toBe('47000')
    // G8 1D: a falta de 06/11 e o desmarque de 06/11, reagendados no dia 10.
    expect(a!.faltas_recontatadas).toBe(2)

    const b = await linhaDe(clienteB)
    expect(b).toBeDefined()
    expect(b!.grupo_id).toBe(grupoB)
    // ISOLAMENTO: a receita de B é só a dela, nunca a soma com A.
    expect(b!.receita_registrada).toBe('7000')
    expect(b!.tarefas_concluidas).toBe(1)
    expect(b!.contatos_pacientes).toBe(0)
    // Calculado, e zero — não NULL ("não calculado").
    expect(b!.faltas_recontatadas).toBe(0)

    const onboarding = await linhaDe(clienteOnboarding)
    expect(onboarding).toBeUndefined()
  })

  it('IDEMPOTÊNCIA (regra 26): rodar de novo para o MESMO dia faz UPSERT, nunca duplica', async () => {
    const antes = await linhaDe(clienteA)
    expect(antes).toBeDefined()

    const resumo = await executarUsoDiarioCliente(banco, relogio, DIA)
    expect(resumo.falhas.filter((x) => [clienteA, clienteB, clienteOnboarding, clienteD].includes(x.clienteCarteiraId))).toEqual([])

    const contagem = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM uso_diario_cliente WHERE cliente_carteira_id = $1 AND dia = $2`,
      [clienteA, DIA],
    )
    expect(contagem.rows[0]!.n).toBe('1')

    const depois = await linhaDe(clienteA)
    // Mesma fonte, mesmo resultado — a segunda rodada não distorce nada.
    expect(depois).toEqual(antes)
  })

  it('"ontem no fuso da clínica" é o default quando nenhum dia é informado', async () => {
    // `relogio` está fixado em 2026-11-10T23:00Z, e a clínica é America/Bahia
    // (UTC-3): "hoje" ali é 10/11 às 20h, então "ontem" é 09/11.
    const resumo = await executarUsoDiarioCliente(banco, relogio)
    expect(resumo.falhas.filter((x) => [clienteA, clienteB, clienteOnboarding, clienteD].includes(x.clienteCarteiraId))).toEqual([])
    const r = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM uso_diario_cliente
        WHERE cliente_carteira_id = $1 AND dia = '2026-11-09'`,
      [clienteA],
    )
    expect(r.rows[0]!.n).toBe('1')
    await migrate.query(
      `DELETE FROM uso_diario_cliente WHERE cliente_carteira_id = ANY($1) AND dia = '2026-11-09'`,
      [[clienteA, clienteB]],
    )
  })


  it('R13: uso crítico vira UMA tarefa interna por (cliente, dia), mesmo rodando três vezes', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await executarUsoDiarioCliente(banco, relogio, DIA)
      expect(r.falhas).toEqual([])
    }
    const t = await migrate.query<{ titulo: string; descricao: string; prioridade: string; prazo: string; grupo_id: string }>(
      `SELECT titulo, descricao, prioridade, prazo::text AS prazo, grupo_id FROM tarefas_internas
        WHERE cliente_carteira_id = $1`,
      [clienteD],
    )
    expect(t.rows).toHaveLength(1)
    expect(t.rows[0]).toEqual({
      titulo: 'FIR Clinic sem uso em Cliente de teste: ligar para a recepção',
      descricao: 'Três dias sem uso',
      prioridade: 'alta',
      prazo: '2026-11-11',
      grupo_id: grupoB,
    })
    // As clínicas com uso não ganham alerta.
    const outras = await migrate.query(`SELECT 1 FROM tarefas_internas WHERE cliente_carteira_id = ANY($1)`, [
      [clienteA, clienteB],
    ])
    expect(outras.rows).toHaveLength(0)
  })

  it('R13: a tarefa de alerta que a equipe cancelou não renasce (regra 27)', async () => {
    await migrate.query(`UPDATE tarefas_internas SET status = 'cancelada' WHERE cliente_carteira_id = $1`, [clienteD])
    await executarUsoDiarioCliente(banco, relogio, DIA)
    const t = await migrate.query<{ status: string }>(
      `SELECT status FROM tarefas_internas WHERE cliente_carteira_id = $1`,
      [clienteD],
    )
    expect(t.rows.map((r) => r.status)).toEqual(['cancelada'])
  })
})
