import type { Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'

/**
 * **Comercial › Campanhas** (épico 8).
 *
 * Os três testes que definem este arquivo:
 *
 *  1. **A IMPORTAÇÃO É IDEMPOTENTE TRÊS VEZES** (regra 26) — e a segunda e a
 *     terceira não criam paciente nem tarefa. O protótipo confere com
 *     `some()` antes de empurrar, e duas abas atravessam juntas.
 *  2. **A META TEM ESCALA DECLARADA PELA MÉTRICA** — `receita` em centavos,
 *     as outras três em contagem, e o contrato recusa a troca.
 *  3. **SEM `valores`, A CAMPANHA ENTREGA SÓ O PERCENTUAL** (regra 17), e é
 *     a Recepção quem está nesse caso: ela tem `campanhas` e não tem
 *     `valores` — é o perfil padrão dela.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'seis-janelas-de-madeira-clara'
const codigo = `camp-${Date.now()}`

/** 18/11/2026, 12:00 UTC — 09:00 em `America/Bahia`. */
const INICIO = new Date('2026-11-18T12:00:00.000Z')
let agora = new Date(INICIO)
const relogioDeTeste: Relogio = { agora: () => agora }

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let gestora: string
let recepcao: string
let gestao: string[]
let semValores: string[]

const srv = () => request(app.getHttpServer())
const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

type Campanha = {
  id: string
  nome: string
  metrica: string
  rotuloDaMeta: string
  metaEmDinheiro: string | null
  metaEmNumero: number | null
  resultadoEmDinheiro: string | null
  resultadoEmNumero: number | null
  percentualDaMeta: number | null
  receita: string | null
  situacao: string
  rotuloDaSituacao: string
  tarefas: number
  tarefasConcluidas: number
  tarefasAbertas: number
  contatos: number
  pacientesAlcancados: number
  pacientesConvertidos: number
  taxaDeConversao: number | null
}

const BASE = {
  categoria: 'Sazonal',
  foco: 'Outubro Rosa',
  nome: 'Outubro Rosa 2026',
  objetivo: 'Trazer de volta quem não aparece há 6 meses',
  inicio: '2026-11-01',
  fim: '2026-11-30',
  metrica: 'contatos',
  tipoMetrica: '',
  metaEmDinheiro: null,
  metaEmNumero: 40,
}

const criar = (corpo: Record<string, unknown> = BASE) =>
  srv().post('/v1/campanhas').set('Cookie', gestao).send(corpo)

const listar = async (cookie = gestao): Promise<Campanha[]> => {
  const r = await srv().get('/v1/campanhas').set('Cookie', cookie).expect(200)
  return r.body.campanhas as Campanha[]
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[campanhas] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica das Campanhas') RETURNING id`,
      [codigo],
    )
  ).rows[0]!.id

  const perfil = async (chave: string, nome: string, perms: string[]) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $3, $4) RETURNING id`,
        [clinica, chave, nome, perms],
      )
    ).rows[0]!.id
  const pfGestao = await perfil('pf_sup', 'Supervisão', [
    'campanhas',
    'campanhas.gerir',
    'valores',
    'pacientes',
  ])
  // A RECEPÇÃO: `campanhas` e NADA de `valores`. É o perfil padrão dela.
  const pfRecepcao = await perfil('pf_rec', 'Recepção', ['campanhas'])

  const hash = await hashDeSenha(SENHA)
  const pessoa = async (nome: string, usuario: string, perfilId: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
         VALUES ($1, $2, $3, $4, false, $5) RETURNING id`,
        [clinica, nome, usuario, hash, perfilId],
      )
    ).rows[0]!.id
  gestora = await pessoa('Helena Prado', 'helena', pfGestao)
  recepcao = await pessoa('Juliana Santos', 'juliana', pfRecepcao)

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogioDeTeste)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const entrar = (usuario: string) =>
    srv().post('/v1/entrar').send({ clinica: codigo, usuario, senha: SENHA }).expect(200)
  gestao = cookieDe(await entrar('helena'))
  semValores = cookieDe(await entrar('juliana'))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  agora = new Date(INICIO)
  await migrate.query(`DELETE FROM recebimentos WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM tarefas WHERE clinica_id = $1`, [clinica])
  await migrate.query(`UPDATE pacientes SET campanha_id = NULL WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM pacientes WHERE clinica_id = $1`, [clinica])
  await migrate.query(`DELETE FROM campanhas WHERE clinica_id = $1`, [clinica])
})

// ---------------------------------------------------------------------------
// CADASTRO
// ---------------------------------------------------------------------------

describe('salvarCampanha — a meta tem a escala da MÉTRICA', () => {
  it('a meta de contagem viaja em `metaEmNumero` e nunca em dinheiro', async () => {
    await criar().expect(201)
    const [c] = await listar()
    expect(c!.metaEmNumero).toBe(40)
    expect(c!.metaEmDinheiro).toBeNull()
    expect(c!.rotuloDaMeta).toBe('Contatos realizados')
  })

  it('a meta de RECEITA viaja em centavos, e o inverso é 400', async () => {
    await criar({
      ...BASE,
      nome: 'Protocolo de verão',
      metrica: 'receita',
      metaEmNumero: null,
      metaEmDinheiro: '2000000',
    }).expect(201)
    const c = (await listar()).find((x) => x.nome === 'Protocolo de verão')!
    expect(c.metaEmDinheiro).toBe('2000000')
    expect(c.metaEmNumero).toBeNull()

    // Receita com meta em contagem: 400 no contrato, não um número em reais
    // que o serviço interpreta como centavos.
    const errada = await criar({
      ...BASE,
      nome: 'Errada',
      metrica: 'receita',
      metaEmNumero: 20000,
      metaEmDinheiro: null,
    })
    expect(errada.status).toBe(400)
    // E o contrário: contagem com meta em reais.
    expect(
      (
        await criar({
          ...BASE,
          nome: 'Errada 2',
          metrica: 'contatos',
          metaEmNumero: null,
          metaEmDinheiro: '2000000',
        })
      ).status,
    ).toBe(400)
  })

  /**
   * **O TIPO VIAJA COM A MÉTRICA, OU NÃO VIAJA.** *"Tipo de contato
   * concluído"* sem dizer QUAL tipo é uma meta que conta zero para sempre — e
   * o protótipo aceita exatamente isso, porque o `select` dele nasce com o
   * primeiro tipo selecionado e nada confere.
   */
  it('métrica por tipo exige o tipo, e o tipo sozinho é recusado', async () => {
    expect((await criar({ ...BASE, nome: 'Sem tipo', metrica: 'tipo' })).status).toBe(400)
    expect(
      (await criar({ ...BASE, nome: 'Tipo à toa', metrica: 'contatos', tipoMetrica: 'Follow-up' }))
        .status,
    ).toBe(400)
    // Nome de tipo que não existe na tabela: 400, nunca uma campanha que
    // nunca pontua.
    expect(
      (await criar({ ...BASE, nome: 'Tipo falso', metrica: 'tipo', tipoMetrica: 'Ligação' }))
        .status,
    ).toBe(400)

    await criar({
      ...BASE,
      nome: 'Follow-ups de novembro',
      metrica: 'tipo',
      tipoMetrica: 'Follow-up',
    }).expect(201)
    const c = (await listar()).find((x) => x.nome === 'Follow-ups de novembro')!
    expect(c.rotuloDaMeta).toBe('Follow-up')
  })

  /**
   * **409 NO NOME REPETIDO, PELO ÍNDICE.** O protótipo não confere nada: duas
   * "Outubro Rosa" e o resultado da campanha parte em duas linhas do painel.
   * Quem recusa é `campanha_por_nome`, não um `SELECT` antes do `INSERT` —
   * duas abas atravessam o `SELECT` juntas.
   */
  it('nome repetido é 409, pelo nome NORMALIZADO', async () => {
    await criar().expect(201)
    const r = await criar({ ...BASE, nome: '  outubro   rosa 2026 ' })
    expect(r.status).toBe(409)
    expect(String(r.body.mensagem ?? r.body.message)).toContain('Já existe uma campanha')
  })

  it('a data final antes da inicial é 400', async () => {
    expect(
      (await criar({ ...BASE, nome: 'Invertida', inicio: '2026-11-30', fim: '2026-11-01' })).status,
    ).toBe(400)
  })

  /**
   * A SITUAÇÃO sai do dia do SERVIDOR, no fuso da clínica (regra 24). O
   * protótipo usa `today()` do navegador: o celular adiantado da recepção
   * encerra a campanha um dia antes.
   */
  it('a situação e o rótulo vêm prontos, pelo dia do servidor', async () => {
    await criar().expect(201) // 01/11 a 30/11, e hoje é 18/11.
    await criar({ ...BASE, nome: 'Dezembro', inicio: '2026-12-01', fim: '2026-12-31' }).expect(201)
    await criar({ ...BASE, nome: 'Outubro', inicio: '2026-10-01', fim: '2026-10-31' }).expect(201)
    await criar({ ...BASE, nome: 'Último dia', inicio: '2026-11-01', fim: '2026-11-18' }).expect(201)

    const porNome = new Map((await listar()).map((c) => [c.nome, c]))
    expect(porNome.get('Outubro Rosa 2026')!.situacao).toBe('andamento')
    expect(porNome.get('Outubro Rosa 2026')!.rotuloDaSituacao).toBe(
      'Em andamento · 12 dias restantes',
    )
    expect(porNome.get('Último dia')!.rotuloDaSituacao).toBe('Último dia')
    expect(porNome.get('Dezembro')!.situacao).toBe('futura')
    expect(porNome.get('Dezembro')!.rotuloDaSituacao).toBe('Começa em 01/12')
    expect(porNome.get('Outubro')!.situacao).toBe('encerrada')
  })
})

describe('excluirCampanha — soft delete, e a TAREFA CONTINUA LIGADA', () => {
  /**
   * **DIVERGÊNCIA CONSCIENTE DO PROTÓTIPO.** Ele apaga a campanha **e limpa o
   * `campanhaId` de toda tarefa dela** (`db.tasks.forEach(t => { if
   * (t.campanhaId===b.id) t.campanhaId = "" })`): o trabalho feito perde a
   * atribuição para sempre, e o painel do trimestre passado muda sozinho.
   */
  it('a campanha some da lista, a linha fica, e a tarefa mantém o vínculo', async () => {
    await criar().expect(201)
    const c = (await listar())[0]!
    const paciente = await umPaciente('Marta Alves')
    const tarefa = await umaTarefa(c.id, paciente, 'Follow-up', 'aberta')

    await srv().delete(`/v1/campanhas/${c.id}`).set('Cookie', gestao).expect(200)
    expect(await listar()).toHaveLength(0)

    const linha = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM campanhas WHERE id = $1 AND excluida_em IS NOT NULL`,
      [c.id],
    )
    expect(linha.rows[0]!.n).toBe('1')

    const vinculo = await migrate.query<{ campanha_id: string | null }>(
      `SELECT campanha_id::text AS campanha_id FROM tarefas WHERE id = $1`,
      [tarefa],
    )
    expect(vinculo.rows[0]!.campanha_id).toBe(c.id)

    // E o nome volta a ser usável: o índice é parcial.
    await criar().expect(201)
    // Excluir duas vezes é 404, não um segundo soft delete.
    expect((await srv().delete(`/v1/campanhas/${c.id}`).set('Cookie', gestao)).status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// OS RESULTADOS
// ---------------------------------------------------------------------------

describe('os resultados são CONTAGENS derivadas, nunca coluna', () => {
  /**
   * **`convertidos` conta PACIENTES DISTINTOS, não tarefas.**
   *
   * A paciente que fez consulta E procedimento na mesma campanha é **uma**
   * conversão. Contá-la duas vezes faz a campanha bater a meta sem ter
   * convertido ninguém a mais — e é o que acontece ao trocar
   * `count(DISTINCT paciente_id)` por `count(*)`.
   */
  it('convertidos conta paciente distinto; a mesma paciente duas vezes é UMA', async () => {
    await criar({ ...BASE, nome: 'Conversão', metrica: 'convertidos', metaEmNumero: 4 }).expect(201)
    const c = (await listar())[0]!
    const marta = await umPaciente('Marta Alves')
    const rosa = await umPaciente('Rosa Lima')

    // Marta: DUAS tarefas que atendem, concluídas. Uma conversão.
    await umaTarefa(c.id, marta, 'Consulta realizada', 'concluida')
    await umaTarefa(c.id, marta, 'Procedimento realizado', 'concluida')
    // Rosa: um contato concluído. Alcançada, não convertida.
    await umaTarefa(c.id, rosa, 'Follow-up', 'concluida')
    // E uma tarefa aberta, que não conta em nada de "feito".
    await umaTarefa(c.id, rosa, 'Recaptação', 'aberta')

    const r = (await listar())[0]!
    expect(r.pacientesAlcancados).toBe(2)
    expect(r.pacientesConvertidos).toBe(1)
    expect(r.resultadoEmNumero).toBe(1)
    // 1 de 4 = 25%.
    expect(r.percentualDaMeta).toBe(25)
    // 1 de 2 alcançados = 50%.
    expect(r.taxaDeConversao).toBe(50)
    expect(r.tarefas).toBe(4)
    expect(r.tarefasConcluidas).toBe(3)
    expect(r.tarefasAbertas).toBe(1)
    expect(r.contatos).toBe(1)
  })

  /**
   * **A RECEITA SOMA O QUE ENTROU, NUNCA A VENDA A PRAZO** (D-9).
   *
   * A terceira tarefa é uma venda a prazo: `valor = 0`, `valor_aberto > 0`,
   * forma vazia. A clínica não pode ver R$ 3.000 de receita que ninguém
   * pagou — e aí o painel deixaria de bater com o caixa, que é a primeira
   * coisa que alguém confere.
   *
   * **A MUTAÇÃO QUE ESTE TESTE MATA É UM PAR, e medi-la ensinou algo:**
   * nem largar `DINHEIRO_QUE_ENTROU` do `LEFT JOIN`, nem somar `valor_aberto`
   * **sozinhos** mudam o número. Sem o filtro, a linha entra no `JOIN` mas o
   * que se soma é `valor`, que é zero; somando `valor_aberto` com o filtro
   * no lugar, a linha nem chega ao `JOIN` e o `valor_aberto` é `NULL`.
   *
   * As duas juntas dão `580000` em vez de `280000` — medido. Vale escrever
   * porque a conclusão fácil ("o filtro protege sozinho") é falsa nos dois
   * sentidos, e quem "simplificar" um dos dois achando o outro redundante
   * deixa a porta encostada.
   */
  it('a receita exclui a venda a prazo, e a métrica `receita` usa a mesma soma', async () => {
    await criar({
      ...BASE,
      nome: 'Receita',
      metrica: 'receita',
      metaEmNumero: null,
      metaEmDinheiro: '400000',
    }).expect(201)
    const c = (await listar())[0]!
    const marta = await umPaciente('Marta Alves')

    const t1 = await umaTarefa(c.id, marta, 'Pagamento de orçamento', 'concluida')
    await umRecebimento(t1, marta, 'Pagamento de orçamento', 180000n, 0n, 'Pix')
    const t2 = await umaTarefa(c.id, marta, 'Consulta realizada', 'concluida')
    await umRecebimento(t2, marta, 'Consulta realizada', 100000n, 0n, 'Dinheiro')
    const t3 = await umaTarefa(c.id, marta, 'Pagamento de consulta', 'concluida')
    await umRecebimento(t3, marta, 'Pagamento de consulta', 0n, 300000n, '')

    const r = (await listar())[0]!
    // R$ 1.800 + R$ 1.000 + R$ 0 = R$ 2.800.
    expect(r.receita).toBe('280000')
    expect(r.resultadoEmDinheiro).toBe('280000')
    expect(r.resultadoEmNumero).toBeNull()
    expect(r.percentualDaMeta).toBe(70)
  })

  /**
   * **SEM `valores`, A CAMPANHA ENTREGA SÓ O PERCENTUAL** (regra 17), e o
   * servidor é quem apaga — num ponto único, nunca num `if` da tela.
   *
   * É a Recepção quem está nesse caso: ela tem `campanhas` e não tem
   * `valores`. E o que NÃO é dinheiro atravessa inteiro — esconder "12 de 40
   * contatos" seria esconder o trabalho dela.
   */
  it('a Recepção vê o percentual e as contagens, nunca o valor', async () => {
    await criar({
      ...BASE,
      nome: 'Receita',
      metrica: 'receita',
      metaEmNumero: null,
      metaEmDinheiro: '400000',
    }).expect(201)
    await criar().expect(201) // a de contatos, meta 40
    // **POR NOME, nunca por índice.** A lista sai ordenada por `inicio DESC,
    // nome`, e as duas campanhas começam no mesmo dia — `[0]` é a de
    // CONTATOS, e a primeira versão deste teste pendurou o pagamento nela.
    const dinheiro = (await listar()).find((x) => x.nome === 'Receita')!
    const marta = await umPaciente('Marta Alves')
    const t = await umaTarefa(dinheiro.id, marta, 'Pagamento de orçamento', 'concluida')
    await umRecebimento(t, marta, 'Pagamento de orçamento', 280000n, 0n, 'Pix')

    const porNome = new Map((await listar(semValores)).map((c) => [c.nome, c]))
    const r = porNome.get('Receita')!
    expect(r.metaEmDinheiro).toBeNull()
    expect(r.resultadoEmDinheiro).toBeNull()
    expect(r.receita).toBeNull()
    expect(r.percentualDaMeta).toBe(70)
    // As contagens não são dinheiro e atravessam inteiras.
    expect(r.pacientesAlcancados).toBe(1)
    expect(porNome.get('Outubro Rosa 2026')!.metaEmNumero).toBe(40)
  })

  it('escrever campanha é 403 sem `campanhas.gerir`, e LER é 200', async () => {
    await criar().expect(201)
    const c = (await listar())[0]!
    expect((await srv().post('/v1/campanhas').set('Cookie', semValores).send(BASE)).status).toBe(403)
    expect(
      (await srv().put(`/v1/campanhas/${c.id}`).set('Cookie', semValores).send(BASE)).status,
    ).toBe(403)
    expect((await srv().delete(`/v1/campanhas/${c.id}`).set('Cookie', semValores)).status).toBe(403)
    expect((await srv().get('/v1/campanhas').set('Cookie', semValores)).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// A IMPORTAÇÃO
// ---------------------------------------------------------------------------

describe('importarCampanha — idempotente TRÊS vezes, por esquema', () => {
  const LISTA = {
    tipo: 'Recaptação',
    descricao: '',
    linhas: [
      {
        nome: 'Marta Alves',
        telefone: '71999990000',
        aniversario: '1980-05-12',
        prazo: '2026-11-25',
        responsavelId: '',
        obs: 'Última consulta em maio',
      },
      {
        nome: 'Rosa Lima',
        telefone: '',
        aniversario: '',
        prazo: '2026-11-25',
        responsavelId: '',
        obs: '',
      },
    ],
  }

  type Linha = (typeof LISTA)['linhas'][number]
  const comResponsavel = (extra: { tipo?: string; linhas?: Linha[] } = {}) => ({
    ...LISTA,
    ...extra,
    linhas: (extra.linhas ?? LISTA.linhas).map((l) => ({ ...l, responsavelId: recepcao })),
  })

  const importar = (campanhaId: string, corpo: Record<string, unknown>) =>
    srv().post(`/v1/campanhas/${campanhaId}/importar`).set('Cookie', gestao).send(corpo)

  /**
   * **TRÊS VEZES, como manda a regra 26.** A segunda e a terceira importação
   * do mesmo arquivo devolvem tudo em `ignoradas` — e o que recusa é o índice
   * `tarefa_viva_da_campanha`, não um `SELECT` antes do `INSERT`.
   */
  it('a mesma lista três vezes cria DOIS pacientes e DUAS tarefas, e nada mais', async () => {
    await criar().expect(201)
    const c = (await listar())[0]!

    const um = await importar(c.id, comResponsavel()).expect(200)
    expect(um.body).toMatchObject({ criadas: 2, novosPacientes: 2, ignoradas: 0 })

    for (const vez of [2, 3]) {
      const r = await importar(c.id, comResponsavel()).expect(200)
      expect(r.body.criadas, `vez ${vez}`).toBe(0)
      expect(r.body.novosPacientes, `vez ${vez}`).toBe(0)
      expect(r.body.ignoradas, `vez ${vez}`).toBe(2)
    }

    const pacientes = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pacientes WHERE clinica_id = $1`,
      [clinica],
    )
    expect(pacientes.rows[0]!.n).toBe('2')
    const tarefas = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas WHERE clinica_id = $1 AND campanha_id = $2`,
      [clinica, c.id],
    )
    expect(tarefas.rows[0]!.n).toBe('2')
  })

  /**
   * **COMPLETA O VAZIO, NUNCA SOBRESCREVE** (regra 27). A planilha de origem
   * costuma ser mais velha que o cadastro — e `pacientesCompletados` distingue
   * "completei" de "nada a completar", que é o que faz a terceira importação
   * não dizer que mexeu em 300 pacientes.
   */
  it('o paciente que já existe é reaproveitado, e só o campo VAZIO é completado', async () => {
    await criar().expect(201)
    const c = (await listar())[0]!
    // Marta já existe, com telefone e sem aniversário.
    await migrate.query(
      `INSERT INTO pacientes (clinica_id, nome, telefone) VALUES ($1, 'Marta Alves', '7100000000')`,
      [clinica],
    )

    const r = await importar(c.id, comResponsavel()).expect(200)
    expect(r.body.novosPacientes).toBe(1)
    expect(r.body.pacientesCompletados).toBe(1)
    expect(r.body.criadas).toBe(2)

    const marta = await migrate.query<{ telefone: string; aniversario: string | null }>(
      `SELECT telefone, aniversario::text AS aniversario FROM pacientes
        WHERE clinica_id = $1 AND nome = 'Marta Alves'`,
      [clinica],
    )
    // O telefone NÃO foi sobrescrito; o aniversário vazio foi preenchido.
    expect(marta.rows[0]!.telefone).toBe('7100000000')
    expect(marta.rows[0]!.aniversario).toBe('1980-05-12')
  })

  /**
   * A linha sem nome, com responsável INATIVO, ou repetida no próprio arquivo
   * é ignorada — e a importação continua. Perder o lote por causa de uma
   * célula em branco é o jeito caro de descobrir que a planilha tinha uma
   * célula em branco.
   */
  it('linha sem nome, com responsável inválido ou repetida entra em `ignoradas`', async () => {
    await criar().expect(201)
    const c = (await listar())[0]!
    const r = await importar(c.id, {
      tipo: 'Recaptação',
      descricao: '',
      linhas: [
        { nome: 'Marta Alves', telefone: '', aniversario: '', prazo: '2026-11-25', responsavelId: recepcao, obs: '' },
        // Repetida, com outra grafia: `normalizar_nome` as iguala.
        { nome: '  MARTA   ALVES ', telefone: '', aniversario: '', prazo: '2026-11-25', responsavelId: recepcao, obs: '' },
        { nome: '   ', telefone: '', aniversario: '', prazo: '2026-11-25', responsavelId: recepcao, obs: '' },
        // Responsável de outra clínica (não existe daqui, pela RLS).
        { nome: 'Rosa Lima', telefone: '', aniversario: '', prazo: '2026-11-25', responsavelId: '00000000-0000-0000-0000-000000000000', obs: '' },
      ],
    }).expect(200)
    expect(r.body).toMatchObject({ criadas: 1, novosPacientes: 1, ignoradas: 3 })
  })

  /**
   * **PAGAMENTO NÃO É TAREFA** (regra 3). Uma importação de 300 linhas de
   * "Pagamento de consulta" criaria 300 contagens do mesmo dinheiro — e o
   * contrato recusa com a mesma regra de `POST /v1/tarefas`.
   */
  it('importar com tipo de PAGAMENTO é 400, e tipo desconhecido também', async () => {
    await criar().expect(201)
    const c = (await listar())[0]!
    expect((await importar(c.id, comResponsavel({ tipo: 'Pagamento de consulta' }))).status).toBe(400)
    expect((await importar(c.id, comResponsavel({ tipo: 'Ligação' }))).status).toBe(400)
  })

  it('a descrição vazia vira "Contato da campanha: <nome>", montada no SERVIDOR', async () => {
    await criar().expect(201)
    const c = (await listar())[0]!
    await importar(c.id, comResponsavel()).expect(200)
    const d = await migrate.query<{ descricao: string; obs: string; tipo: string }>(
      `SELECT descricao, obs, tipo FROM tarefas
        WHERE clinica_id = $1 AND campanha_id = $2 ORDER BY obs DESC LIMIT 1`,
      [clinica, c.id],
    )
    expect(d.rows[0]!.descricao).toBe('Contato da campanha: Outubro Rosa 2026')
    expect(d.rows[0]!.tipo).toBe('Recaptação')
    expect(d.rows[0]!.obs).toBe('Última consulta em maio')
  })

  it('importar numa campanha excluída é 404', async () => {
    await criar().expect(201)
    const c = (await listar())[0]!
    await srv().delete(`/v1/campanhas/${c.id}`).set('Cookie', gestao).expect(200)
    expect((await importar(c.id, comResponsavel())).status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// FIXTURE
// ---------------------------------------------------------------------------

async function umPaciente(nome: string): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
    [clinica, nome],
  )
  return r.rows[0]!.id
}

async function umaTarefa(
  campanhaId: string,
  pacienteId: string,
  tipo: string,
  status: 'aberta' | 'concluida',
): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
        paciente_id, tipo, campanha_id)
     VALUES ($1, $2, $2, 'fixture', '2026-11-10'::date, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      clinica,
      gestora,
      status,
      status === 'concluida' ? '2026-11-10T15:00:00.000Z' : null,
      pacienteId,
      tipo,
      campanhaId,
    ],
  )
  return r.rows[0]!.id
}

async function umRecebimento(
  tarefaId: string,
  pacienteId: string,
  tipo: string,
  valor: bigint,
  aberto: bigint,
  forma: string,
): Promise<void> {
  await migrate.query(
    `INSERT INTO recebimentos
       (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto,
        recebido_em, registrado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '2026-11-10T15:00:00.000Z', $8)`,
    [clinica, pacienteId, tarefaId, tipo, valor.toString(), forma, aberto.toString(), gestora],
  )
}
