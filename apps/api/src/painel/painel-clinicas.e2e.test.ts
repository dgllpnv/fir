import { perfisPadrao } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import {
  apagarClinicaDeTeste,
  apagarOperadorDeTeste,
  declararAtorSistema,
} from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA_OP = 'quatro-pedras-no-caminho'
const PROVISORIA = /^[a-z]+(-[a-z]+){3}$/

let app: NestFastifyApplication
let migrate: pg.Client
let operador: string
let painel: string
/** Toda clínica criada por este arquivo, para o `afterAll` desfazer. */
const criadas: string[] = []

/**
 * Sufixo ALEATÓRIO, não `Date.now()`.
 *
 * `operadores.usuario` é único GLOBALMENTE — o operador não pertence a
 * clínica nenhuma, então não há `clinica_id` para separar fixtures. Com
 * `Date.now() % 1e6`, dois arquivos de teste que começam no mesmo
 * milissegundo (e eles rodam em paralelo) produzem o MESMO usuário, e o
 * segundo morre em `duplicate key value violates unique constraint`. Medido:
 * 2 de 6 execuções seguidas.
 */
const sufixo = randomBytes(4).toString('hex')
const USUARIO_OP = `dono.${sufixo}`

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')

let proximo = 0
const novoCodigo = () => `pcl${sufixo}x${proximo++}`

const http = () => request(app.getHttpServer())

/** Toda chave do corpo, em qualquer profundidade. Para o teste do mínimo. */
const chavesProfundas = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.flatMap(chavesProfundas)
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [k, ...chavesProfundas(x)])
  }
  return []
}

const criarClinica = (corpo: Record<string, unknown> = {}, cookie = painel) =>
  http()
    .post('/v1/superadmin/clinicas')
    .set('Cookie', cookie)
    .send({
      codigo: novoCodigo(),
      nome: 'Clínica Nova',
      fuso: 'America/Bahia',
      admin: { nome: 'Dra. Helena', usuario: 'helena' },
      ...corpo,
    })

/** Cria e registra para limpeza. Falha alto se a criação não deu 201. */
const criarClinicaOk = async (corpo: Record<string, unknown> = {}) => {
  const r = await criarClinica(corpo).expect(201)
  criadas.push(r.body.id)
  return r.body as {
    id: string
    codigo: string
    admin: { id: string; senhaProvisoria: string }
  }
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  operador = (
    await migrate.query<{ id: string }>(
      `INSERT INTO operadores (usuario, nome, senha_hash)
       VALUES ($1, 'Dono', $2) RETURNING id`,
      [USUARIO_OP, await hashDeSenha(SENHA_OP)],
    )
  ).rows[0]!.id

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  painel = paresDe(
    cookies(
      await http()
        .post('/v1/superadmin/entrar')
        .send({ usuario: USUARIO_OP, senha: SENHA_OP })
        .expect(200),
    ),
  )
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  for (const id of criadas) await apagarClinicaDeTeste(migrate, id)
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = $1', [USUARIO_OP])
  await apagarOperadorDeTeste(migrate, operador)
  await migrate.end()
  await app.close()
})

describe('POST /v1/superadmin/clinicas: entra no grupo Firmare (0067)', () => {
  it('a clínica criada pelo painel já nasce com histórico de grupo e Cliente Firmare no grupo padrão', async () => {
    const c = await criarClinicaOk({ nome: 'Clínica do Dr. Teste' })
    const padrao = (await migrate.query<{ id: string }>('SELECT id FROM grupos WHERE padrao')).rows[0]!.id

    const cliente = await migrate.query<{ grupo_id: string; nome: string; produto: string; status: string }>(
      'SELECT grupo_id, nome, produto, status FROM clientes_carteira WHERE clinica_id = $1',
      [c.id],
    )
    expect(cliente.rows).toEqual([
      { grupo_id: padrao, nome: 'Clínica do Dr. Teste', produto: 'FIR Clinic', status: 'onboarding' },
    ])

    const hist = await migrate.query<{ grupo_novo_id: string; motivo: string }>(
      'SELECT grupo_novo_id, motivo FROM historico_grupo_da_clinica WHERE clinica_id = $1',
      [c.id],
    )
    expect(hist.rows).toEqual([{ grupo_novo_id: padrao, motivo: 'clínica nova' }])
  })

  it('código repetido é 409 e não deixa cliente a mais', async () => {
    const c = await criarClinicaOk()
    // Nome único: o banco é compartilhado com arquivos que rodam em paralelo,
    // então contar a tabela toda mediria o vizinho, não este teste.
    const nome = `Clínica repetida ${Date.now()}`
    await criarClinica({ codigo: c.codigo, nome }).expect(409)
    expect((await migrate.query('SELECT 1 FROM clientes_carteira WHERE nome = $1', [nome])).rowCount).toBe(0)
  })
})

describe('POST /v1/superadmin/clinicas', () => {
  it('entrega clínica + perfis padrão + admin com provisória, numa chamada', async () => {
    const codigo = novoCodigo()
    const r = await criarClinica({ codigo }).expect(201)
    criadas.push(r.body.id)

    expect(r.body.codigo).toBe(codigo)
    expect(r.body.admin.senhaProvisoria).toMatch(PROVISORIA)
    expect(r.body.admin.admin).toBe(true)
    expect(r.body.admin.perfilId).toBeNull()

    const perfis = await migrate.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM perfis WHERE clinica_id = $1',
      [r.body.id],
    )
    expect(perfis.rows[0]!.n).toBe(perfisPadrao().length)

    // E a clínica está USÁVEL: a admin entra e cai na troca obrigatória.
    const e = await http()
      .post('/v1/entrar')
      .send({ clinica: codigo, usuario: 'helena', senha: r.body.admin.senhaProvisoria })
      .expect(200)
    const sessao = paresDe(cookies(e))
    const hoje = await http().get('/v1/hoje').set('Cookie', sessao)
    expect(hoje.status).toBe(409)
    expect(hoje.body.codigo).toBe('SENHA_PROVISORIA')
  })

  it('tudo ou nada: se a admin falhar, a clínica NÃO nasce', async () => {
    const codigo = novoCodigo()
    await criarClinica({ codigo, admin: { nome: 'A', usuario: 'NÃO VALE' } }).expect(400)
    const existe = await migrate.query('SELECT 1 FROM clinicas WHERE codigo = $1', [codigo])
    expect(existe.rowCount, 'meia criação: a clínica nasceu sem administradora').toBe(0)
  })

  it('A CLÍNICA VÊ quem a criou, desde a primeira linha da trilha dela', async () => {
    // D-10: "o acesso é total; o registro é obrigatório". Esta é a prova.
    const nova = await criarClinicaOk()
    const t = await migrate.query<{ ator_tipo: string; ator_id: string; entidade: string }>(
      `SELECT ator_tipo, ator_id, entidade FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pessoas'`,
      [nova.id],
    )
    expect(t.rows.length).toBeGreaterThan(0)
    for (const linha of t.rows) {
      expect(linha.ator_tipo).toBe('operador')
      expect(linha.ator_id).toBe(operador)
    }
  })

  it('o operador fixa app.clinica_id da clínica NOVA — não escapa da RLS', async () => {
    const nova = await criarClinicaOk()
    // Medido pelo que a transação FIXOU, não pelo que o código diz fixar:
    // toda linha de trilha escrita por esta criação pertence à clínica nova.
    const linhas = await migrate.query<{ clinica_id: string }>(
      `SELECT DISTINCT clinica_id FROM auditoria
        WHERE ator_id = $1 AND ator_tipo = 'operador' AND entidade IN ('pessoas', 'perfis')`,
      [operador],
    )
    for (const l of linhas.rows) expect(criadas).toContain(l.clinica_id)
  })

  it('código repetido é 409, e o repetido é CANÔNICO', async () => {
    const codigo = novoCodigo()
    await criarClinicaOk({ codigo })
    const maiusculo = await criarClinica({ codigo: codigo.toUpperCase() })
    expect(maiusculo.status).toBe(409)
    const comEspaco = await criarClinica({ codigo: `  ${codigo}  ` })
    expect(comEspaco.status).toBe(409)
  })

  it('o fuso é obrigatório e validado contra a lista IANA', async () => {
    await criarClinica({ fuso: 'America/Bahiaa' }).expect(400)
    await criarClinica({ fuso: '' }).expect(400)
    const r = await criarClinica({ fuso: 'America/Sao_Paulo' }).expect(201)
    criadas.push(r.body.id)
    expect(r.body.fuso).toBe('America/Sao_Paulo')
  })

  it('o corpo é estrito: nem a clínica nem a admin aceitam campo de senha', async () => {
    await criarClinica({ senha: 'escolhida-por-mim' }).expect(400)
    await criarClinica({
      admin: { nome: 'A B', usuario: 'ab.cd', senha: 'escolhida-por-mim' },
    }).expect(400)
  })

  it('a provisória da admin não aparece em trilha nenhuma das duas tabelas', async () => {
    const nova = await criarClinicaOk()
    const prov = nova.admin.senhaProvisoria
    expect(prov).toMatch(PROVISORIA)

    const daClinica = await migrate.query(
      'SELECT de, para FROM auditoria WHERE clinica_id = $1',
      [nova.id],
    )
    expect(JSON.stringify(daClinica.rows)).not.toContain(prov)
    expect(JSON.stringify(daClinica.rows)).toContain('[oculto]')

    const doPainel = await migrate.query('SELECT de, para FROM auditoria_do_painel')
    expect(JSON.stringify(doPainel.rows)).not.toContain(prov)
  })

  it('a criação da clínica fica registrada em auditoria_do_painel', async () => {
    // `clinicas` não tem trigger (e não pode ter: ela é a raiz do tenancy,
    // sem clinica_id próprio para a trilha). Então esta linha é escrita à mão.
    const nova = await criarClinicaOk()
    const t = await migrate.query<{ acao: string; entidade: string; entidade_id: string }>(
      `SELECT acao, entidade, entidade_id FROM auditoria_do_painel
        WHERE entidade = 'clinicas' AND entidade_id = $1`,
      [nova.id],
    )
    expect(t.rows[0]).toMatchObject({ acao: 'criou', entidade: 'clinicas' })
  })

  it('sem sessão de painel, 404 — e nada é criado', async () => {
    const codigo = novoCodigo()
    await criarClinica({ codigo }, '').expect(404)
    const existe = await migrate.query('SELECT 1 FROM clinicas WHERE codigo = $1', [codigo])
    expect(existe.rowCount).toBe(0)
  })
})

describe('GET /v1/superadmin/clinicas', () => {
  it('lista as clínicas, sem campo monetário nenhum', async () => {
    const nova = await criarClinicaOk()
    const r = await http().get('/v1/superadmin/clinicas').set('Cookie', painel).expect(200)
    expect(r.body.itens.map((c: { id: string }) => c.id)).toContain(nova.id)
    expect(JSON.stringify(r.body)).not.toMatch(/\$argon2/)
  })

  /**
   * **O TESTE DO MÍNIMO** — é ele que impede alguém de "só acrescentar o
   * número de pacientes" daqui a seis meses.
   *
   * Esta lista é a fonte do seletor de clínicas do painel. Ela diz **quais**
   * clínicas existem, e isso é inevitável: é o painel. O que ela não pode
   * dizer é **quanto** cada uma tem. Quantidade de pacientes, de pessoas, de
   * tarefas, receita, data de criação — qualquer um desses transforma a lista
   * num mapa comercial dos clientes do produto, e o painel é o lugar onde
   * esse acréscimo pareceria inofensivo ("é só para eu ver").
   *
   * A lista de chaves é **literal aqui**, de propósito, e não derivada de
   * `ClinicaNaLista`: derivada do contrato, acrescentar o campo ao contrato
   * também acrescentaria à expectativa, e o teste passaria verde exatamente
   * na mudança que ele existe para barrar.
   */
  const CHAVES_PERMITIDAS = [
    'id', // navegar até a clínica no painel
    'codigo', // o que o seletor mostra, e o que vai em /entrar?clinica=
    'nome', // o que o seletor mostra
    'fuso', // coluna da tela de clínicas (regra 22: é propriedade da clínica)
    'ativa', // coluna da tela de clínicas (estado, nunca exclusão)
  ] as const

  /**
   * Nomes que denunciam **tamanho**. Rede independente da lista acima: pega o
   * campo mesmo que quem o acrescentou tenha editado `CHAVES_PERMITIDAS`
   * junto, e pega em qualquer profundidade porque varre o JSON cru.
   */
  const SINAIS_DE_TAMANHO =
    /pacientes|pessoas|usuarios|tarefas|quantidade|qtd|total|receita|faturamento|criada|criado|ultimo|acesso/i

  it('devolve o MÍNIMO: nenhuma chave além das cinco, nenhum sinal de tamanho', async () => {
    await criarClinicaOk()
    const r = await http().get('/v1/superadmin/clinicas').set('Cookie', painel).expect(200)

    const itens = r.body.itens as Record<string, unknown>[]
    expect(itens.length, 'lista vazia — o teste não verificou nada').toBeGreaterThan(0)

    const aMais = [...new Set(itens.flatMap((c) => Object.keys(c)))].filter(
      (k) => !(CHAVES_PERMITIDAS as readonly string[]).includes(k),
    )
    expect(
      aMais,
      `chave(s) a mais na lista de clínicas do painel: ${aMais.join(', ')}. ` +
        'Esta lista diz QUAIS clínicas existem; ela não pode dizer QUANTO cada uma tem. ' +
        'Contagem de pacientes, de pessoas ou data de criação viram um mapa comercial dos ' +
        'clientes. Se o campo é mesmo necessário, ele vai numa rota própria, com a razão escrita.',
    ).toEqual([])

    // E o mínimo também é um PISO: sem código e nome não há seletor.
    for (const c of itens) {
      expect(typeof c['codigo']).toBe('string')
      expect(typeof c['nome']).toBe('string')
    }

    // Varredura das chaves do corpo cru, em QUALQUER profundidade: um
    // `resumo: { pacientes: 12 }` cai aqui mesmo que `resumo` tenha sido
    // acrescentado à lista permitida. Só as CHAVES — o nome de uma clínica de
    // verdade pode conter qualquer palavra, e isso não é sinal de nada.
    const suspeitas = chavesProfundas(r.body).filter((k) => SINAIS_DE_TAMANHO.test(k))
    expect(
      suspeitas,
      `chave(s) de TAMANHO na lista de clínicas do painel: ${suspeitas.join(', ')}`,
    ).toEqual([])
  })
})

describe('PATCH /v1/superadmin/clinicas/:id', () => {
  it('edita nome, fuso e estado, e a trilha registra de → para', async () => {
    const criada = await criarClinicaOk({ nome: 'Antes Da Edição' })

    const r = await http()
      .patch(`/v1/superadmin/clinicas/${criada.id}`)
      .set('Cookie', painel)
      .send({ nome: 'Depois Da Edição', fuso: 'America/Sao_Paulo', ativa: true })
      .expect(200)
    expect(r.body).toMatchObject({
      id: criada.id,
      codigo: criada.codigo,
      nome: 'Depois Da Edição',
      fuso: 'America/Sao_Paulo',
      ativa: true,
    })

    const l = await http().get('/v1/superadmin/clinicas').set('Cookie', painel).expect(200)
    const linha = l.body.itens.find((c: { id: string }) => c.id === criada.id)
    expect(linha).toMatchObject({ nome: 'Depois Da Edição', fuso: 'America/Sao_Paulo' })

    const t = await migrate.query(
      `SELECT acao, de, para FROM auditoria_do_painel WHERE entidade = 'clinicas' AND entidade_id = $1 ORDER BY id DESC LIMIT 1`,
      [criada.id],
    )
    expect(t.rows[0]).toMatchObject({ acao: 'alterou' })
    expect(t.rows[0].de).toMatchObject({ nome: 'Antes Da Edição' })
    expect(t.rows[0].para).toMatchObject({ nome: 'Depois Da Edição' })
  })

  it('`codigo` no corpo é 400 — a chave de login não se edita por aqui', async () => {
    const criada = await criarClinicaOk()
    await http()
      .patch(`/v1/superadmin/clinicas/${criada.id}`)
      .set('Cookie', painel)
      .send({ codigo: 'tentando-mudar', nome: 'Nome Válido', fuso: 'America/Bahia', ativa: true })
      .expect(400)
  })

  it('fuso inválido é 400, igual à criação', async () => {
    const criada = await criarClinicaOk()
    await http()
      .patch(`/v1/superadmin/clinicas/${criada.id}`)
      .set('Cookie', painel)
      .send({ nome: 'Nome Válido', fuso: 'Nao/Existe', ativa: true })
      .expect(400)
  })

  it('clínica inexistente é 404; malformada também', async () => {
    await http()
      .patch('/v1/superadmin/clinicas/00000000-0000-4000-8000-000000000000')
      .set('Cookie', painel)
      .send({ nome: 'Nome Válido', fuso: 'America/Bahia', ativa: true })
      .expect(404)
    await http()
      .patch('/v1/superadmin/clinicas/nao-e-uuid')
      .set('Cookie', painel)
      .send({ nome: 'Nome Válido', fuso: 'America/Bahia', ativa: true })
      .expect(404)
  })

  it('sem sessão de painel, 404', async () => {
    const criada = await criarClinicaOk()
    await http()
      .patch(`/v1/superadmin/clinicas/${criada.id}`)
      .send({ nome: 'Nome Válido', fuso: 'America/Bahia', ativa: true })
      .expect(404)
  })
})

describe('o superadmin alcança as pessoas de QUALQUER clínica', () => {
  it('cria qualquer perfil, e também a administradora', async () => {
    const nova = await criarClinicaOk()
    const perfis = await migrate.query<{ id: string }>(
      'SELECT id FROM perfis WHERE clinica_id = $1',
      [nova.id],
    )
    let i = 0
    for (const p of perfis.rows) {
      const r = await http()
        .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
        .set('Cookie', painel)
        .send({ nome: `Pessoa ${i}`, usuario: `pessoa.${i}`, perfilId: p.id })
      expect(r.status, JSON.stringify(r.body)).toBe(201)
      expect(r.body.senhaProvisoria).toMatch(PROVISORIA)
      i++
    }
    // E a SEGUNDA administradora — o elo que o admin da clínica não tem.
    const admin = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Segunda Admin', usuario: 'segunda.admin', perfilId: null })
      .expect(201)
    expect(admin.body.admin).toBe(true)
  })

  it('redefinir a senha do ADMIN da clínica é o elo seguinte da cadeia', async () => {
    const nova = await criarClinicaOk()
    // A admin troca a provisória e passa a ter sessão viva.
    const entrada = await http()
      .post('/v1/entrar')
      .send({ clinica: nova.codigo, usuario: 'helena', senha: nova.admin.senhaProvisoria })
      .expect(200)
    const sessaoDaAdmin = paresDe(cookies(entrada))
    await http()
      .post('/v1/eu/senha')
      .set('Cookie', sessaoDaAdmin)
      .send({ atual: nova.admin.senhaProvisoria, nova: 'sete-telhados-de-barro' })
      .expect(204)
    await http().get('/v1/eu').set('Cookie', sessaoDaAdmin).expect(200)

    const r = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}/senha`)
      .set('Cookie', painel)
      .expect(200)
    expect(r.body.senhaProvisoria).toMatch(PROVISORIA)
    // A sessão viva CAI: quem redefine o faz porque desconfia.
    await http().get('/v1/eu').set('Cookie', sessaoDaAdmin).expect(401)
    // E a nova provisória entra.
    await http()
      .post('/v1/entrar')
      .send({ clinica: nova.codigo, usuario: 'helena', senha: r.body.senhaProvisoria })
      .expect(200)
  })

  it('o superadmin pode ESCOLHER a senha — e ela não volta na resposta', async () => {
    // Decisão do dono em 2026-11-04: a gerada se perdia (aparece uma vez, e
    // quem fechou o modal antes de anotar não tinha como recuperá-la). A
    // escolhida continua provisória, com as mesmas 72 h: quem a digitou passa
    // a conhecê-la, então ela é bilhete de entrada, não a senha da pessoa.
    const nova = await criarClinicaOk()
    const r = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}/senha`)
      .set('Cookie', painel)
      .send({ senha: 'pergaminho-azulejo-bussola' })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
    expect(r.body.senhaProvisoria, 'a escolhida não deve voltar na resposta').toBeNull()
    expect(JSON.stringify(r.body)).not.toContain('pergaminho-azulejo-bussola')

    // A metade que importa: ela AUTENTICA de verdade.
    await http()
      .post('/v1/entrar')
      .send({ clinica: nova.codigo, usuario: 'helena', senha: 'pergaminho-azulejo-bussola' })
      .expect(200)

    // E continua provisória, cobrada pelo guard.
    const l = await migrate.query<{ p: boolean }>(
      'SELECT senha_provisoria AS p FROM pessoas WHERE id = $1',
      [nova.admin.id],
    )
    expect(l.rows[0]!.p).toBe(true)
  })

  it('senha fraca pelo painel é 422, e a anterior continua valendo', async () => {
    const nova = await criarClinicaOk()
    const r = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}/senha`)
      .set('Cookie', painel)
      .send({ senha: '12345678' })
    expect(r.status, JSON.stringify(r.body)).toBe(422)

    // Um 422 que ainda assim tivesse gravado o hash seria pior que um 200.
    await http()
      .post('/v1/entrar')
      .send({ clinica: nova.codigo, usuario: 'helena', senha: nova.admin.senhaProvisoria })
      .expect(200)
  })

  it('a clínica vê TODA ação do operador dentro dela, com ator_tipo operador', async () => {
    const nova = await criarClinicaOk()
    const antes = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1 AND ator_tipo = 'operador'`,
      [nova.id],
    )
    const perfil = await migrate.query<{ id: string }>(
      'SELECT id FROM perfis WHERE clinica_id = $1 LIMIT 1',
      [nova.id],
    )
    await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Mais Uma', usuario: 'mais.uma', perfilId: perfil.rows[0]!.id })
      .expect(201)
    await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}/senha`)
      .set('Cookie', painel)
      .expect(200)

    // Exatamente DUAS linhas novas, e as duas com o id DESTE operador. Um
    // `>` passaria com uma só, e passaria também se metade das ações
    // tivesse sido atribuída ao sistema.
    const depois = await migrate.query<{ ator_id: string; acao: string; entidade: string }>(
      `SELECT ator_id, acao, entidade FROM auditoria
        WHERE clinica_id = $1 AND ator_tipo = 'operador'
        ORDER BY em DESC, id DESC LIMIT 2`,
      [nova.id],
    )
    const total = await migrate.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1 AND ator_tipo = 'operador'`,
      [nova.id],
    )
    expect(total.rows[0]!.n).toBe(antes.rows[0]!.n + 2)
    for (const linha of depois.rows) {
      expect(linha.ator_id, 'a clínica vê a ação, mas não vê QUEM a fez').toBe(operador)
      expect(linha.entidade).toBe('pessoas')
    }
    expect(depois.rows.map((l) => l.acao).sort()).toEqual(['alterou', 'criou'])
  })

  it('NENHUMA ação do painel sobre a clínica B escreve na trilha da clínica A', async () => {
    const a = await criarClinicaOk()
    const b = await criarClinicaOk()
    const antesDeA = await migrate.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1',
      [a.id],
    )
    const perfilB = await migrate.query<{ id: string }>(
      'SELECT id FROM perfis WHERE clinica_id = $1 LIMIT 1',
      [b.id],
    )
    await http()
      .post(`/v1/superadmin/clinicas/${b.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Da B', usuario: 'da.b', perfilId: perfilB.rows[0]!.id })
      .expect(201)
    const depoisDeA = await migrate.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM auditoria WHERE clinica_id = $1',
      [a.id],
    )
    expect(depoisDeA.rows[0]!.n).toBe(antesDeA.rows[0]!.n)
  })

  it('o perfil de OUTRA clínica não serve — a RLS responde, não um if', async () => {
    const a = await criarClinicaOk()
    const b = await criarClinicaOk()
    const perfilDeB = await migrate.query<{ id: string }>(
      'SELECT id FROM perfis WHERE clinica_id = $1 LIMIT 1',
      [b.id],
    )
    const r = await http()
      .post(`/v1/superadmin/clinicas/${a.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Cruzada', usuario: 'cruzada', perfilId: perfilDeB.rows[0]!.id })
    expect(r.status, 'o painel criou pessoa com o perfil da clínica vizinha').toBe(400)
  })

  it('a pessoa de OUTRA clínica não é alcançável pela rota desta', async () => {
    const a = await criarClinicaOk()
    const b = await criarClinicaOk()
    const pessoaDeB = await migrate.query<{ id: string }>(
      'SELECT id FROM pessoas WHERE clinica_id = $1 LIMIT 1',
      [b.id],
    )
    await http()
      .post(`/v1/superadmin/clinicas/${a.id}/pessoas/${pessoaDeB.rows[0]!.id}/senha`)
      .set('Cookie', painel)
      .expect(404)
    await http()
      .get(`/v1/superadmin/clinicas/${a.id}/pessoas/${pessoaDeB.rows[0]!.id}`)
      .set('Cookie', painel)
      .expect(404)
  })

  it('o id da clínica vem da ROTA e é validado contra `clinicas`', async () => {
    // A única fonte NOVA de `ClinicaId` deste plano, e ela passa pelo banco:
    // um uuid inventado na URL não pode virar `SET LOCAL app.clinica_id`.
    const inventado = '00000000-0000-4000-8000-000000000000'
    await http()
      .post(`/v1/superadmin/clinicas/${inventado}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Fantasma', usuario: 'fantasma', perfilId: null })
      .expect(404)
    await http().get(`/v1/superadmin/clinicas/${inventado}/pessoas`).set('Cookie', painel).expect(404)
  })

  it('id de clínica malformado é 404, nunca 400', async () => {
    // 400 para uuid inválido e 404 para uuid válido inexistente distingue os
    // dois para quem sonda.
    await http().get('/v1/superadmin/clinicas/nao-e-uuid/pessoas').set('Cookie', painel).expect(404)
  })

  it('clínica DESATIVADA não aceita criação pelo painel', async () => {
    const nova = await criarClinicaOk()
    await migrate.query('UPDATE clinicas SET ativa = false WHERE id = $1', [nova.id])
    try {
      const r = await http()
        .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
        .set('Cookie', painel)
        .send({ nome: 'Tarde Demais', usuario: 'tarde.demais', perfilId: null })
      expect(r.status).toBe(409)
    } finally {
      await migrate.query('UPDATE clinicas SET ativa = true WHERE id = $1', [nova.id])
    }
  })

  it('o superadmin NUNCA lê a senha de ninguém — nem redefinindo', async () => {
    const nova = await criarClinicaOk()
    const r = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}/senha`)
      .set('Cookie', painel)
      .expect(200)
    // Ele vê a provisória que ACABOU de ser gerada, uma vez. Nunca a anterior.
    const ficha = await http()
      .get(`/v1/superadmin/clinicas/${nova.id}/pessoas/${nova.admin.id}`)
      .set('Cookie', painel)
      .expect(200)
    expect(JSON.stringify(ficha.body)).not.toMatch(/\$argon2|senhaProvisoria/)
    expect(JSON.stringify(ficha.body)).not.toContain(r.body.senhaProvisoria)

    const lista = await http()
      .get(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
      .set('Cookie', painel)
      .expect(200)
    expect(JSON.stringify(lista.body)).not.toMatch(/\$argon2/)
    expect(JSON.stringify(lista.body)).not.toContain(r.body.senhaProvisoria)
  })

  it('usuário repetido na mesma clínica é 409, com mensagem útil', async () => {
    const nova = await criarClinicaOk()
    const r = await http()
      .post(`/v1/superadmin/clinicas/${nova.id}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Outra Helena', usuario: 'helena', perfilId: null })
    expect(r.status).toBe(409)
    expect(r.body.message).toMatch(/já existe/i)
  })

  it('operador INATIVO não faz nada, mesmo com cookie válido', async () => {
    await migrate.query('UPDATE operadores SET ativo = false WHERE id = $1', [operador])
    try {
      await http().get('/v1/superadmin/clinicas').set('Cookie', painel).expect(404)
    } finally {
      await migrate.query('UPDATE operadores SET ativo = true WHERE id = $1', [operador])
    }
  })
})


/* ======================================================================
 * EDITAR e EXCLUIR pessoa PELO PAINEL
 *
 * O painel criava administradora e redefinia senha, e nada mais. A falta
 * aparecia no caso que ele existe para resolver: a clínica trancada — sem
 * administradora ativa — não consegue corrigir nem o nome de quem está lá
 * dentro.
 *
 * O que estes testes cobram é que o acesso total do operador **não escapa do
 * domínio**: a clínica não fica sem administradora ativa nem pela mão dele,
 * porque isso a tranca, e destrancá-la é o que ele viria fazer.
 * ====================================================================== */

describe('o painel edita e exclui pessoa, com as invariantes da clínica', () => {
  let clinicaId: string
  let codigoDaClinica: string
  let adminId: string
  let equipeId: string
  let perfilId: string

  beforeEach(async () => {
    const c = await criarClinicaOk()
    clinicaId = c.id
    codigoDaClinica = c.codigo
    adminId = c.admin.id

    const ps = await http()
      .get(`/v1/superadmin/clinicas/${clinicaId}/pessoas`)
      .set('Cookie', painel)
      .expect(200)
    // A clínica nova nasce com os cinco perfis padrão e UMA administradora.
    expect((ps.body.itens as { id: string }[]).length).toBe(1)

    const perfis = await migrate.query<{ id: string }>(
      `SELECT id FROM perfis WHERE clinica_id = $1 AND chave = 'pf_rec'`,
      [clinicaId],
    )
    perfilId = perfis.rows[0]!.id

    const nova = await http()
      .post(`/v1/superadmin/clinicas/${clinicaId}/pessoas`)
      .set('Cookie', painel)
      .send({ nome: 'Juliana Santos', usuario: 'juliana', perfilId })
      .expect(201)
    equipeId = nova.body.id
  })

  const editar = (pessoaId: string, corpo: Record<string, unknown>) =>
    http()
      .patch(`/v1/superadmin/clinicas/${clinicaId}/pessoas/${pessoaId}`)
      .set('Cookie', painel)
      .send(corpo)

  const excluir = (pessoaId: string) =>
    http()
      .delete(`/v1/superadmin/clinicas/${clinicaId}/pessoas/${pessoaId}`)
      .set('Cookie', painel)

  it('edita nome, função e acesso', async () => {
    const r = await editar(equipeId, {
      nome: 'Juliana Costa',
      funcao: 'Recepção',
      acesso: { admin: true },
    }).expect(200)
    expect(r.body.nome).toBe('Juliana Costa')
    expect(r.body.funcao).toBe('Recepção')
    expect(r.body.admin).toBe(true)
    expect(r.body.perfilId).toBeNull()
    // O USUÁRIO não muda, e não está no contrato: ele é ditado por telefone e
    // é a chave de `tentativas_login.identificador`.
    expect(r.body.usuario).toBe('juliana')
  })

  it('campo a mais no corpo é 400 — inclusive `usuario`', async () => {
    await editar(equipeId, { usuario: 'juliana.costa' }).expect(400)
  })

  it('corpo VAZIO é 400: não há nada a alterar', async () => {
    await editar(equipeId, {}).expect(400)
  })

  it('desativar DERRUBA a sessão viva dela', async () => {
    // A senha provisória autentica, e a sessão criada por ela é real.
    const prov = await migrate.query<{ id: string }>(
      'SELECT id FROM pessoas WHERE id = $1',
      [equipeId],
    )
    expect(prov.rows).toHaveLength(1)
    await migrate.query(
      `INSERT INTO sessoes (clinica_id, pessoa_id, token_hash, expira_em)
       VALUES ($1, $2, $3, now() + interval '1 day')`,
      [clinicaId, equipeId, `sessao-de-${equipeId}`],
    )

    await editar(equipeId, { ativo: false }).expect(200)

    const viva = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sessoes
        WHERE pessoa_id = $1 AND revogada_em IS NULL`,
      [equipeId],
    )
    expect(viva.rows[0]!.n, 'a sessão dela sobreviveu à desativação').toBe('0')
  })

  it('NEM O OPERADOR deixa a clínica sem administradora ativa — ao desativar', async () => {
    const r = await editar(adminId, { ativo: false }).expect(422)
    expect(r.body.codigo).toBe('UltimaAdministradoraAtiva')
  })

  it('NEM O OPERADOR deixa a clínica sem administradora ativa — ao rebaixar', async () => {
    const r = await editar(adminId, { acesso: { admin: false, perfilId } }).expect(422)
    expect(r.body.codigo).toBe('UltimaAdministradoraAtiva')
  })

  it('NEM O OPERADOR deixa a clínica sem administradora ativa — ao EXCLUIR', async () => {
    /**
     * MUTAÇÃO: tire `exigirDominio(podeExcluirPessoa(...))` de
     * `PainelPessoasService.excluir` e este teste fica vermelho. O painel
     * passaria a ser o caminho pelo qual a clínica fica trancada — pela mão de
     * quem viria destrancá-la.
     */
    const r = await excluir(adminId).expect(422)
    expect(r.body.codigo).toBe('UltimaAdministradoraAtiva')
    const l = await migrate.query<{ excluida_em: Date | null }>(
      'SELECT excluida_em FROM pessoas WHERE id = $1',
      [adminId],
    )
    expect(l.rows[0]!.excluida_em).toBeNull()
  })

  it('exclui quem NÃO é a última administradora, e a LINHA FICA', async () => {
    await excluir(equipeId).expect(204)
    const l = await migrate.query<{ nome: string; ativo: boolean; excluida_em: Date | null }>(
      'SELECT nome, ativo, excluida_em FROM pessoas WHERE id = $1',
      [equipeId],
    )
    expect(l.rows, 'a pessoa foi APAGADA: o passado da clínica mudou').toHaveLength(1)
    expect(l.rows[0]!.nome).toBe('Juliana Santos')
    expect(l.rows[0]!.ativo).toBe(false)
    expect(l.rows[0]!.excluida_em).not.toBeNull()
  })

  it('a excluída sai da LISTA do painel — ele não é a porta dos fundos', async () => {
    await excluir(equipeId).expect(204)
    const r = await http()
      .get(`/v1/superadmin/clinicas/${clinicaId}/pessoas`)
      .set('Cookie', painel)
      .expect(200)
    expect((r.body.itens as { id: string }[]).map((p) => p.id)).not.toContain(equipeId)
  })

  it('a excluída não é mais ALVO: ficha, editar, senha e excluir dão 404', async () => {
    await excluir(equipeId).expect(204)
    await http()
      .get(`/v1/superadmin/clinicas/${clinicaId}/pessoas/${equipeId}`)
      .set('Cookie', painel)
      .expect(404)
    await editar(equipeId, { nome: 'Outro Nome' }).expect(404)
    await http()
      .post(`/v1/superadmin/clinicas/${clinicaId}/pessoas/${equipeId}/senha`)
      .set('Cookie', painel)
      .expect(404)
    await excluir(equipeId).expect(404)
  })

  it('a escrita do operador cai na trilha DA CLÍNICA como `operador`', async () => {
    await excluir(equipeId).expect(204)
    const r = await migrate.query<{ ator_tipo: string; ator_id: string | null }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pessoas' AND entidade_id = $2
          AND para -> 'excluida_em' IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [clinicaId, equipeId],
    )
    expect(r.rows, `nenhuma linha de trilha em ${codigoDaClinica}`).toHaveLength(1)
    expect(r.rows[0]!.ator_tipo).toBe('operador')
    expect(r.rows[0]!.ator_id).toBe(operador)
  })

  it('sem cookie de painel é 404, nos dois verbos', async () => {
    await http()
      .patch(`/v1/superadmin/clinicas/${clinicaId}/pessoas/${equipeId}`)
      .send({ nome: 'X' })
      .expect(404)
    await http()
      .delete(`/v1/superadmin/clinicas/${clinicaId}/pessoas/${equipeId}`)
      .expect(404)
  })
})
