/**
 * O cenário que os cinco arquivos de teste de tarefa compartilham.
 *
 * Mora em `__tests__/` e não em `tarefas/` porque ele importa
 * `limpeza-de-teste`, e `teste/apoio-de-teste-fora-de-producao.test.ts`
 * reprova qualquer arquivo de PRODUÇÃO que o importe — a varredura trata
 * `__tests__/` como teste, por definição. O `include` do vitest é
 * `src/**-/*.test.ts`, então este arquivo não é coletado como suíte.
 *
 * Por que um cenário só, e não um `beforeAll` por arquivo: montar clínica,
 * perfis, quatro pessoas com Argon2, pacientes e unidades são oitenta linhas,
 * e a quinta cópia é onde o perfil de uma delas deixa de ter `tarefas.equipe`
 * sem ninguém notar — e aí o teste de 403 passa por acidente.
 */
import { RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { RELOGIO } from '../../comum/relogio'
import { registrarCookie } from '../../main'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'senha-de-teste-tarefas'

export const FUSO = 'America/Bahia'

/**
 * 25/10/2026 às 02:00 UTC. Em America/Bahia (UTC−3) ainda são **23:00 de
 * 24/10**.
 *
 * Um instante só, escolhido para servir a três perguntas de uma vez:
 *
 *  - o dia de negócio vem do SERVIDOR, no fuso da CLÍNICA — com UTC, "hoje"
 *    seria 25/10 e todo lançamento do dia 24 viraria retroativo;
 *  - "amanhã" (25/10) é recusado no lançamento retroativo, e é justamente o
 *    dia que o relógio UTC diria ser hoje;
 *  - 24/10/2026 é um SÁBADO, então a semana que o contém começa na segunda,
 *    19/10, e termina em 25/10 — a janela que a tela Hoje desenha.
 */
export const AGORA = new Date('2026-10-25T02:00:00Z')
export const HOJE = '2026-10-24'
export const AMANHA = '2026-10-25'
export const ONTEM = '2026-10-23'
export const SEGUNDA_DA_SEMANA = '2026-10-19'

export type Cenario = {
  readonly app: NestFastifyApplication
  readonly migrate: pg.Client
  readonly clinica: string
  readonly outraClinica: string
  /**
   * `juliana` recepção (`jornada`, SEM `valores` e SEM `receber`) ·
   * `beatriz` supervisão (`tarefas.equipe`, `jornada`, `valores`, `receber` e
   * TODO o financeiro) · `camila` comercial (`valores`, SEM `jornada`, SEM
   * `caixa`, SEM `cobrancas`) · `rita` balcão (`receber` SEM `valores`) ·
   * `sonia` caixa (`caixa`, `contas`, `cobrancas`, SEM `valores` e SEM
   * `contas.gerir`) · `nara` enfermagem (`programas`, SEM `valores`, SEM
   * `receber` e SEM `config`) · `marta` inativa.
   */
  readonly pessoas: Record<string, string>
  readonly cookies: Record<string, string[]>
  readonly pacientes: Record<string, string>
  readonly unidades: Record<string, string>
  readonly tarefaDaOutra: string
  readonly pacienteDaOutra: string
}

type Corpo = Record<string, unknown>

export async function montarCenario(prefixo: string): Promise<Cenario> {
  const codigo = `${prefixo}-${Date.now()}`
  const migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error(`[${prefixo}] migrate:`, e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  const umId = async (sql: string, params: unknown[]): Promise<string> =>
    (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

  const clinica = await umId(
    `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica Tarefas', $2) RETURNING id`,
    [codigo, FUSO],
  )
  const outraClinica = await umId(
    `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica Vizinha', $2) RETURNING id`,
    [`${codigo}-v`, FUSO],
  )

  // `pf_rec` tem `jornada` e NÃO tem `tarefas.equipe`, `valores` nem
  // `receber`: é a persona que prova os 403 de escopo/cancelamento, a redação
  // de dinheiro e — no épico 3 — que mover o cartão não exige ver valores.
  const rec = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada','pacientes']) RETURNING id`,
    [clinica],
  )
  // A Supervisão pode TUDO no financeiro, e isso é deliberado: ela é o
  // principal mais forte que importa em `transporte-as-cegas.test.ts`. Um
  // teste de regra 6 feito com usuário fraco provaria a regra 17 — a redação —
  // e não a cegueira da conferência, que vale inclusive para quem vê valores.
  const sup = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_sup', 'Supervisão',
             ARRAY['tarefas.equipe','jornada','pacientes','pacientes.gerir','valores','receber',
                   'caixa','contas','contas.gerir','cobrancas','finmes',
                   -- O épico 5: ela vê o catálogo, edita o catálogo, monta,
                   -- encerra e exclui programa. É o principal mais FORTE, e
                   -- por isso é com ela que se prova o que vale mesmo para
                   -- quem pode tudo.
                   'programas','programas.gerir','config'])
     RETURNING id`,
    [clinica],
  )
  // `pf_ter` vê valores mas não acompanha a equipe NEM a jornada: é quem "não
  // tem nada a ver com a tarefa" nos testes de autorização, sem que o 403
  // possa ser confundido com falta de permissão de dinheiro.
  const ter = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_ter', 'Comercial', ARRAY['pacientes','valores']) RETURNING id`,
    [clinica],
  )

  /**
   * `pf_bal` REGISTRA dinheiro e NÃO O VÊ: `receber` sem `valores`.
   *
   * É a persona que o épico 4 precisa e que nenhuma das três anteriores
   * cobre — `juliana` não tem `receber` (403 em tudo) e `beatriz` tem
   * `valores` (a redação nunca aparece). Sem ela, "a lista traz paciente,
   * forma e data, e o valor vem `null`" não teria com quem ser testado, e o
   * perfil que a clínica de verdade dá ao balcão ficaria sem cobertura.
   */
  const bal = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_bal', 'Balcão', ARRAY['pacientes','receber']) RETURNING id`,
    [clinica],
  )

  /**
   * `pf_cxa` FECHA O CAIXA e NÃO VÊ VALOR: `caixa`, `contas` e `cobrancas`
   * sem `valores`, e sem `contas.gerir`.
   *
   * É a pessoa que o desenho do épico 4 pressupõe como responsável pelo caixa
   * (ver "O que a regra 6 alcança, e o que não"): para ela a conferência é
   * cega de ponta a ponta porque ela não vê valor em tela nenhuma. Ela também
   * é o único principal que prova os DOIS alcances de contas — vê e paga as
   * dela, não cadastra e não alcança a conta de outra pessoa.
   */
  const cxa = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_cxa', 'Caixa', ARRAY['pacientes','receber','caixa','contas','cobrancas'])
     RETURNING id`,
    [clinica],
  )

  /**
   * `pf_enf` MONTA PROGRAMA e NÃO VÊ VALOR: `programas` sem `valores`, sem
   * `receber` e sem `config`.
   *
   * É a persona do épico 5, e nenhuma das cinco anteriores a cobre. Ela é a
   * enfermagem de verdade: monta a adesão, conclui a sessão, e o pagamento
   * vai pela tela Recebimentos. Sem ela, "SEM `receber`, o corpo COM dinheiro
   * é 403" e "LISTAR o catálogo com `programas` é 200" não teriam com quem
   * ser testados — e a decisão de gatear a rota que cria dinheiro ficaria sem
   * prova.
   */
  const enf = await umId(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_enf', 'Enfermagem', ARRAY['pacientes','programas']) RETURNING id`,
    [clinica],
  )

  const hash = await hashDeSenha(SENHA)
  const pessoa = async (nome: string, perfil: string, ativo = true): Promise<string> =>
    umId(
      `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id, ativo)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [clinica, nome, `${nome.toLowerCase()}@${codigo}.local`, hash, perfil, ativo],
    )

  const pessoas: Record<string, string> = {
    juliana: await pessoa('Juliana', rec),
    beatriz: await pessoa('Beatriz', sup),
    camila: await pessoa('Camila', ter),
    // Balcão: registra recebimento e não vê valor nenhum.
    rita: await pessoa('Rita', bal),
    // Caixa: fecha o caixa, paga as contas dela e cobra — sem ver um valor.
    sonia: await pessoa('Sonia', cxa),
    // Enfermagem: monta programa e conclui sessão, sem ver nem lançar valor.
    nara: await pessoa('Nara', enf),
    // Saiu da clínica: tarefa atribuída a ela não aparece no "Para mim" de
    // ninguém (`Code.gs:355`).
    marta: await pessoa('Marta', rec, false),
  }

  const unidades: Record<string, string> = {
    principal: await umId(
      `INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Unidade Centro') RETURNING id`,
      [clinica],
    ),
    pituba: await umId(
      `INSERT INTO unidades (clinica_id, nome) VALUES ($1, 'Unidade Pituba') RETURNING id`,
      [clinica],
    ),
  }

  const pacientes: Record<string, string> = {
    // Ana tem unidade principal: é por ela que a tarefa herda a unidade quando
    // não vier explícita (`Code.gs:373`).
    ana: await umId(
      `INSERT INTO pacientes (clinica_id, nome, telefone, unidade_id, aniversario)
       VALUES ($1, 'Ana Lúcia Souza', '(71) 98888-7777', $2, '1990-10-24') RETURNING id`,
      [clinica, unidades['pituba']],
    ),
    bruna: await umId(
      `INSERT INTO pacientes (clinica_id, nome, telefone) VALUES ($1, 'Bruna Martins', '') RETURNING id`,
      [clinica],
    ),
  }

  await migrate.query(
    `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_rec', 'Recepção', ARRAY['pacientes'])`,
    [outraClinica],
  )
  const pessoaDaOutra = await umId(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, admin)
     VALUES ($1, 'Vizinha', $2, $3, true) RETURNING id`,
    [outraClinica, `vizinha@${codigo}.local`, hash],
  )
  const pacienteDaOutra = await umId(
    `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, 'Vizinha Secreta') RETURNING id`,
    [outraClinica],
  )
  const tarefaDaOutra = await umId(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo)
     VALUES ($1, $2, $2, 'Tarefa da vizinha', $3) RETURNING id`,
    [outraClinica, pessoaDaOutra, HOJE],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(new RelogioFixo(AGORA))
    .compile()
  const app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const cookies: Record<string, string[]> = {}
  for (const quem of ['juliana', 'beatriz', 'camila', 'rita', 'sonia', 'nara']) {
    const r = await request(app.getHttpServer())
      .post('/v1/entrar')
      .send({ clinica: codigo, email: `${quem}@${codigo}.local`, senha: SENHA })
      .expect(200)
    const v = r.headers['set-cookie'] as unknown
    cookies[quem] = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  }

  return {
    app,
    migrate,
    clinica,
    outraClinica,
    pessoas,
    cookies,
    pacientes,
    unidades,
    tarefaDaOutra,
    pacienteDaOutra,
  }
}

export async function desmontarCenario(c: Cenario): Promise<void> {
  await c.app.close()
  await apagarClinicaDeTeste(c.migrate, c.clinica)
  await apagarClinicaDeTeste(c.migrate, c.outraClinica)
  await c.migrate.end()
}

/**
 * Apaga tarefas e recebimentos entre um `it` e outro, preservando pacientes e
 * pessoas. Sem isto, a contagem de "tarefas do dia" de um teste depende do
 * teste anterior, e a suíte passa a depender da ordem.
 */
export async function limparTarefas(c: Cenario): Promise<void> {
  await c.migrate.query('DELETE FROM recebimentos WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query('DELETE FROM tarefas WHERE clinica_id = $1', [c.clinica])
}

/**
 * Apaga o que o épico 4 escreve fora de `recebimentos`.
 *
 * Separado de `limparTarefas` porque as suítes do épico 2 não conhecem estas
 * tabelas, e acrescentar cinco `DELETE` à função que elas chamam entre cada
 * `it` cobraria o custo delas sem motivo. A ordem é a de
 * `limpeza-de-teste.ts`: filho antes de pai.
 */
export async function limparFinanceiro(c: Cenario): Promise<void> {
  for (const tabela of [
    'caixa_por_forma',
    'caixas_do_dia',
    'cobrancas',
    'contas_a_pagar',
    'metas_do_mes',
    'configuracao_financeira',
  ]) {
    // As DUAS clínicas: os testes de isolamento escrevem na vizinha, e o
    // índice `caixa_por_dia` é por clínica — deixar o resíduo lá faz o
    // segundo `it` do arquivo colidir com o primeiro.
    await c.migrate.query(`DELETE FROM ${tabela} WHERE clinica_id = ANY($1::uuid[])`, [
      [c.clinica, c.outraClinica],
    ])
  }
}

/**
 * Apaga o que o épico 5 escreve, preservando o CATÁLOGO semeado.
 *
 * A ordem desfaz o CICLO `tarefas` ↔ `programas` antes de apagar qualquer um
 * dos dois — a mesma razão (e a mesma ordem) de `limpeza-de-teste.ts`.
 *
 * `procedimentos` NÃO é apagada: os cinco modelos nascem por trigger quando a
 * clínica é criada, e apagá-los entre dois `it` deixaria o segundo sem
 * catálogo para montar. Os procedimentos que um teste CRIA são problema dele.
 */
export async function limparProgramas(c: Cenario): Promise<void> {
  const clinicas = [c.clinica, c.outraClinica]
  await c.migrate.query(
    'UPDATE programas SET tarefa_de_origem_id = NULL WHERE clinica_id = ANY($1::uuid[])',
    [clinicas],
  )
  for (const tabela of ['itens_do_programa', 'recebimentos', 'tarefas', 'programas']) {
    await c.migrate.query(`DELETE FROM ${tabela} WHERE clinica_id = ANY($1::uuid[])`, [clinicas])
  }
}

/* ---------------------------------------------------------------- chamadas */

export const postar = (c: Cenario, caminho: string, corpo: Corpo, quem = 'juliana') =>
  request(c.app.getHttpServer()).post(caminho).set('Cookie', c.cookies[quem]!).send(corpo)

export const pegar = (
  c: Cenario,
  caminho: string,
  consulta: Record<string, string> = {},
  quem = 'juliana',
) => {
  const pedido = request(c.app.getHttpServer()).get(caminho).query(consulta)
  // `quem` desconhecido = SEM cookie. É assim que se pede sem sessão, e é o
  // que prova que a rota responde 401 em vez de entregar dado de clínica.
  const cookie = c.cookies[quem]
  return cookie === undefined ? pedido : pedido.set('Cookie', cookie)
}

export const remendar = (c: Cenario, caminho: string, corpo: Corpo, quem = 'juliana') =>
  request(c.app.getHttpServer()).patch(caminho).set('Cookie', c.cookies[quem]!).send(corpo)

/** `PUT` — a meta do mês é idempotente, e por isso é `PUT` e não `POST`. */
export const botar = (c: Cenario, caminho: string, corpo: Corpo, quem = 'juliana') =>
  request(c.app.getHttpServer()).put(caminho).set('Cookie', c.cookies[quem]!).send(corpo)

export const apagar = (
  c: Cenario,
  caminho: string,
  consulta: Record<string, string> = {},
  quem = 'juliana',
) =>
  request(c.app.getHttpServer()).delete(caminho).query(consulta).set('Cookie', c.cookies[quem]!)

/* ------------------------------------------------------------- conferência */

/** A receita viva do dia civil da clínica, somada DIRETO no banco. */
export async function receitaDoDia(c: Cenario, dia = HOJE): Promise<bigint> {
  const r = await c.migrate.query<{ total: string }>(
    `SELECT coalesce(sum(valor), 0)::text AS total FROM recebimentos
      WHERE clinica_id = $1 AND estornado_em IS NULL AND (recebido_em AT TIME ZONE $2)::date = $3`,
    [c.clinica, FUSO, dia],
  )
  return BigInt(r.rows[0]!.total)
}

export async function recebimentosDe(
  c: Cenario,
  tarefaId: string,
): Promise<{ id: string; valor: string; valor_aberto: string; estornado_em: Date | null }[]> {
  const r = await c.migrate.query<{
    id: string
    valor: string
    valor_aberto: string
    estornado_em: Date | null
  }>(
    `SELECT id, valor::text AS valor, valor_aberto::text AS valor_aberto, estornado_em
       FROM recebimentos WHERE tarefa_id = $1 ORDER BY criado_em`,
    [tarefaId],
  )
  return r.rows
}

export const vivosDe = async (c: Cenario, tarefaId: string) =>
  (await recebimentosDe(c, tarefaId)).filter((r) => r.estornado_em === null)

/** Insere um recebimento DIRETO no banco — para provar que o índice recusa. */
export async function inserirRecebimento(
  c: Cenario,
  tarefaId: string,
  pacienteId: string,
  valor: bigint,
): Promise<void> {
  await c.migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, recebido_em, registrado_por)
     VALUES ($1,$2,$3,'Consulta realizada',$4,'Pix', now(), $5)`,
    [c.clinica, pacienteId, tarefaId, valor.toString(), c.pessoas['juliana']],
  )
}

export async function tarefaCrua(
  c: Cenario,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const r = await c.migrate.query<Record<string, unknown>>(
    `SELECT id, status, prazo::text AS prazo, hora::text AS hora, tipo, descricao, etapa::text AS etapa,
            historico, concluida_em, excluida_em, serie_id, recorrencia, unidade_id, paciente_id,
            responsavel_id, solicitante_id, resultado, obs, prioridade,
            valor_orcamento::text AS valor_orcamento, programa_orcado, motivo_perda_id,
            proximo_passo_em::text AS proximo_passo_em, confirmacao_enviada_em
       FROM tarefas WHERE id = $1`,
    [id],
  )
  return r.rows[0]
}
