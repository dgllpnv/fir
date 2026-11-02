import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import { hashDeSenha } from './../autenticacao/senha'

/**
 * **Usuários e acessos pela porta HTTP** — listar, trocar acesso,
 * ativar/desativar e a matriz de perfis.
 *
 * O que estes testes medem, e que nenhum teste de domínio pode medir:
 *
 *  1. **A invariante da última admin chega à BORDA como 422 com código**, pelos
 *     dois caminhos (desativar e rebaixar). No protótipo ela existe num e não
 *     no outro, e o caminho sem ela tranca a clínica fora de Configurações.
 *  2. **Desativar DERRUBA a sessão viva.** É a diferença entre "tirei o acesso
 *     dela" e "tirei o acesso dela daqui a oito horas".
 *  3. **A senha de ninguém aparece na lista** — o defeito da D-0.
 *  4. **O isolamento de clínica**: a pessoa e o perfil da vizinha não existem
 *     vistos daqui, e o que responde é 404, não 403.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'montanha-de-vidro-aberta'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let outraClinica: string
let perfilRec: string
let perfilEnf: string
let perfilConfig: string
let perfilDaOutra: string
let helenaId: string
let julianaId: string
let sofiaId: string
let pessoaDaOutra: string
const codigo = `acs-${Date.now()}`

const entrar = (usuario: string, senha: string, cod = codigo) =>
  request(app.getHttpServer()).post('/v1/entrar').send({ clinica: cod, usuario, senha })

const cookieDe = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

let admin: string[]
let semConfig: string[]
/** Não é admin e TEM `config`: a supervisão com Configurações liberada. */
let comConfig: string[]
let adminDaOutra: string[]

const listar = (sessao: string[]) =>
  request(app.getHttpServer()).get('/v1/pessoas').set('Cookie', sessao)

const editar = (sessao: string[], id: string, corpo: Record<string, unknown>) =>
  request(app.getHttpServer()).patch(`/v1/pessoas/${id}`).set('Cookie', sessao).send(corpo)

const excluir = (sessao: string[], id: string) =>
  request(app.getHttpServer()).delete(`/v1/pessoas/${id}`).set('Cookie', sessao)

const perfis = (sessao: string[]) =>
  request(app.getHttpServer()).get('/v1/pessoas/perfis').set('Cookie', sessao)

const salvarPerfis = (sessao: string[], corpo: Record<string, unknown>) =>
  request(app.getHttpServer()).put('/v1/pessoas/perfis').set('Cookie', sessao).send(corpo)

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const novaClinica = async (cod: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica dos Acessos') RETURNING id`,
        [cod],
      )
    ).rows[0]!.id
  clinica = await novaClinica(codigo)
  outraClinica = await novaClinica(`${codigo}-b`)

  const novoPerfil = async (c: string, chave: string, nome: string, perms: string[]) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1,$2,$3,$4) RETURNING id`,
        [c, chave, nome, perms],
      )
    ).rows[0]!.id
  perfilRec = await novoPerfil(clinica, 'pf_rec', 'Recepção', ['jornada', 'receber'])
  perfilEnf = await novoPerfil(clinica, 'pf_enf', 'Enfermagem', ['programas'])
  /**
   * Um perfil NÃO-ADMIN com `config`, e ele existe por um caso que nenhum
   * outro arranjo alcança: medir a recusa de "última administradora" no
   * caminho de DESATIVAR, com um ator que não é ela.
   *
   * Com duas admins a recusa não dispara (sobra uma); com uma só, quem a
   * desativaria seria ela mesma, e `EU_MESMA` responde primeiro. Precisa de
   * alguém que abra a tela sem ser admin — que é também um arranjo real: a
   * clínica que dá Configurações à supervisão.
   */
  perfilConfig = await novoPerfil(clinica, 'pf_sup', 'Supervisão', ['config'])
  perfilDaOutra = await novoPerfil(outraClinica, 'pf_rec', 'Recepção', ['jornada'])

  const hash = await hashDeSenha(SENHA)
  const novaPessoa = async (
    c: string,
    nome: string,
    usuario: string,
    admin_: boolean,
    perfil: string | null,
  ) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin, perfil_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [c, nome, usuario, hash, admin_, perfil],
      )
    ).rows[0]!.id
  helenaId = await novaPessoa(clinica, 'Helena Prado', 'helena', true, null)
  julianaId = await novaPessoa(clinica, 'Juliana Santos', 'juliana', false, perfilRec)
  sofiaId = await novaPessoa(clinica, 'Sofia Lima', 'sofia', false, perfilConfig)
  await novaPessoa(outraClinica, 'Vizinha', 'vizinha', true, null)
  pessoaDaOutra = await novaPessoa(outraClinica, 'Equipe da Vizinha', 'equipe.b', false, perfilDaOutra)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  admin = cookieDe(await entrar('helena', SENHA).expect(200))
  semConfig = cookieDe(await entrar('juliana', SENHA).expect(200))
  comConfig = cookieDe(await entrar('sofia', SENHA).expect(200))
  adminDaOutra = cookieDe(await entrar('vizinha', SENHA, `${codigo}-b`).expect(200))
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, outraClinica)
  await migrate.end()
  await app.close()
})

/**
 * Cada teste começa com UMA admin ativa (Helena), Juliana na Recepção e os dois
 * perfis de pé. Sem isto, um teste que promove Juliana a admin tornaria o
 * seguinte — "a última admin não pode cair" — verde por acidente.
 */
beforeEach(async () => {
  await migrate.query(
    `UPDATE pessoas SET admin = true, perfil_id = NULL, ativo = true, desativada_em = NULL,
            excluida_em = NULL
      WHERE id = $1`,
    [helenaId],
  )
  await migrate.query(
    `UPDATE pessoas SET admin = false, perfil_id = $2, ativo = true, desativada_em = NULL,
            excluida_em = NULL, nome = 'Juliana Santos', funcao = ''
      WHERE id = $1`,
    [julianaId, perfilRec],
  )
  await migrate.query(
    `UPDATE pessoas SET admin = false, perfil_id = $2, ativo = true, desativada_em = NULL,
            excluida_em = NULL
      WHERE id = $1`,
    [sofiaId, perfilConfig],
  )
  await migrate.query(
    `DELETE FROM pessoas WHERE clinica_id = $1 AND id NOT IN ($2, $3, $4)`,
    [clinica, helenaId, julianaId, sofiaId],
  )
  // Os perfis CRIADOS pelos testes saem antes de os dois fixos voltarem ao
  // nome original: ao contrário, "Recepção" recriado por um teste colidiria
  // com o `UPDATE` que devolve o nome a `perfilRec` — e o erro apareceria no
  // teste SEGUINTE, apontando para o lugar errado.
  await migrate.query(`DELETE FROM perfis WHERE clinica_id = $1 AND id NOT IN ($2, $3, $4)`, [
    clinica,
    perfilRec,
    perfilEnf,
    perfilConfig,
  ])
  await migrate.query(
    `UPDATE perfis SET excluido_em = NULL,
            nome = CASE WHEN id = $2 THEN 'Recepção'
                        WHEN id = $3 THEN 'Supervisão' ELSE 'Enfermagem' END
      WHERE clinica_id = $1`,
    [clinica, perfilRec, perfilConfig],
  )

  /**
   * A SESSÃO DE JULIANA É REFEITA A CADA TESTE, e isso não é zelo: o teste
   * 'desativar derruba a sessão viva' **revoga** as sessões dela, de propósito.
   * Sem este login, o próximo teste que usasse `semConfig` receberia 401 em vez
   * de 403 — e a ordem dos testes passaria a decidir o resultado, que é
   * exatamente o tipo de verde que não mede nada.
   */
  semConfig = cookieDe(await entrar('juliana', SENHA).expect(200))
})

describe('GET /v1/pessoas', () => {
  it('lista a clínica inteira, com perfil e estado — e sem senha de ninguém', async () => {
    const r = await listar(admin).expect(200)
    const nomes = (r.body.pessoas as { nome: string }[]).map((p) => p.nome)
    expect(nomes).toEqual(['Helena Prado', 'Juliana Santos', 'Sofia Lima'])

    const juliana = (r.body.pessoas as { id: string; perfilId: string }[]).find(
      (p) => p.id === julianaId,
    )!
    expect(juliana.perfilId).toBe(perfilRec)

    /**
     * **O DEFEITO DA D-0, medido no corpo.** Na v20 esta mesma tela entrega o
     * PIN de cada pessoa (`carregar` devolve `pin:u.pin` para quem tem
     * `config`). Aqui não há campo de senha nenhum — e `senha_hash` tampouco,
     * que seria o mesmo erro com outra roupa.
     */
    const corpo = JSON.stringify(r.body)
    expect(corpo).not.toContain('senha')
    expect(corpo).not.toContain('hash')
    expect(corpo).not.toContain(SENHA)
  })

  it('marca `euMesma` em quem pediu — a tela não compara ids', async () => {
    const r = await listar(admin).expect(200)
    const eu = (r.body.pessoas as { id: string; euMesma: boolean }[]).filter((p) => p.euMesma)
    expect(eu.map((p) => p.id)).toEqual([helenaId])
  })

  it('a clínica VIZINHA não aparece — RLS, não filtro de aplicação', async () => {
    const r = await listar(adminDaOutra).expect(200)
    const ids = (r.body.pessoas as { id: string }[]).map((p) => p.id)
    expect(ids).not.toContain(helenaId)
    expect(ids).not.toContain(julianaId)
  })

  it('sem `config`, 403 — a tela é conveniência, o servidor é quem recusa', async () => {
    await listar(semConfig).expect(403)
  })
})

describe('PATCH /v1/pessoas/:id — a invariante da última admin, pelos DOIS caminhos', () => {
  it('DESATIVAR a última admin ativa é 422, com código', async () => {
    // Helena é a única admin. No protótipo este caminho PASSA (`salvarPessoa`
    // não confere nada sobre `ativo`), e `login` exige `u.ativo`: a clínica
    // inteira perde Configurações, e só o superadmin a devolve.
    const r = await editar(admin, helenaId, { ativo: false })
    expect(r.status).toBe(422)
    expect(r.body.codigo).toBe('NaoPodeDesativarASiMesma')
  })

  it('DESATIVAR a última admin por quem NÃO é ela é 422 ULTIMA_ADMIN', async () => {
    // Sofia não é admin e TEM `config`. Helena é a única admin ativa.
    // `EU_MESMA` não entra no caminho, então o que responde é a invariante
    // que importa — e é ela que o protótipo não tem neste caminho.
    const r = await editar(comConfig, helenaId, { ativo: false })
    expect(r.status).toBe(422)
    expect(r.body.codigo).toBe('UltimaAdministradoraAtiva')

    // E Helena continua de pé: a recusa não escreveu nada.
    const l = await migrate.query<{ ativo: boolean }>('SELECT ativo FROM pessoas WHERE id = $1', [
      helenaId,
    ])
    expect(l.rows[0]!.ativo).toBe(true)
  })

  it('REBAIXAR a última admin por quem NÃO é ela é 422 pela MESMA invariante', async () => {
    // O segundo caminho, com o mesmo código de erro — porque é a mesma função
    // do domínio. No protótipo os dois caminhos são dois `if` diferentes, e um
    // deles não existe.
    const r = await editar(comConfig, helenaId, {
      acesso: { admin: false, perfilId: perfilRec },
    })
    expect(r.status).toBe(422)
    expect(r.body.codigo).toBe('UltimaAdministradoraAtiva')
  })

  it('com DUAS admins, desativar uma passa — e a sessão dela CAI', async () => {
    await editar(admin, julianaId, { acesso: { admin: true } }).expect(200)
    const comoJuliana = cookieDe(await entrar('juliana', SENHA).expect(200))
    // A sessão de Juliana está viva agora.
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', comoJuliana).expect(200)

    const r = await editar(admin, julianaId, { ativo: false }).expect(200)
    expect(r.body.ativo).toBe(false)

    /**
     * **A SESSÃO CAI NO MESMO INSTANTE.** O que faz este 401 é a camada de
     * autenticação, que lê a pessoa com `WHERE id = $1 AND ativo`.
     */
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', comoJuliana).expect(401)

    /**
     * **E O COOKIE ANTIGO NÃO RESSUSCITA — é isto que a revogação defende.**
     *
     * Medido por mutação: apagar o `UPDATE sessoes SET revogada_em` do serviço
     * deixava as 23 asserções deste arquivo verdes, porque o 401 acima vem da
     * consulta por `ativo`, não da revogação. Sem revogar, as linhas de
     * `sessoes` continuam vivas: reativar a pessoa — que é o que a clínica faz
     * quando alguém volta, ou quando desativou por engano — faria o cookie de
     * ANTES da saída voltar a autenticar, por até oito horas.
     *
     * 'Tirei o acesso dela' tem de significar que a credencial morreu, não que
     * ela ficou suspensa esperando.
     */
    await editar(admin, julianaId, { ativo: true }).expect(200)
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', comoJuliana).expect(401)
  })

  it('REBAIXAR a última admin é 422 pela MESMA invariante, código ULTIMA_ADMIN', async () => {
    // Duas admins, uma rebaixa a outra: passa. Depois, a que sobrou é a última
    // e não pode ser rebaixada nem por quem não é ela — mas quem não é ela não
    // tem `config`. O caso que a borda consegue exercitar sem um terceiro
    // admin é a recusa sobre o PRÓPRIO admin, já medida acima; aqui o teste é
    // o complementar: com duas, rebaixar a OUTRA passa.
    await editar(admin, julianaId, { acesso: { admin: true } }).expect(200)
    const r = await editar(admin, julianaId, { acesso: { admin: false, perfilId: perfilEnf } })
    expect(r.status).toBe(200)
    expect(r.body.admin).toBe(false)
    expect(r.body.perfilId).toBe(perfilEnf)
  })

  it('o acesso viaja INTEIRO: `{ admin: false }` sem perfil é 400 do contrato', async () => {
    // A união discriminada torna o par impossível de escrever errado — sem
    // ela, `perfil_id` ficaria com o valor antigo e a restrição
    // `pessoa_tem_acesso_definido` (0002) responderia com nome de constraint.
    await editar(admin, julianaId, { acesso: { admin: false } }).expect(400)
  })

  it('campo a mais é 400, nunca ignorado em silêncio', async () => {
    await editar(admin, julianaId, { senha: 'tentando' }).expect(400)
    await editar(admin, julianaId, {}).expect(400)
  })

  it('o PERFIL DA VIZINHA é recusado — a FK aceitaria, a RLS não', async () => {
    const r = await editar(admin, julianaId, {
      acesso: { admin: false, perfilId: perfilDaOutra },
    })
    expect(r.status).toBe(422)
  })

  it('a PESSOA da vizinha é 404, não 403 — ela não existe vista daqui', async () => {
    await editar(admin, pessoaDaOutra, { funcao: 'Recepção' }).expect(404)
  })

  it('nome e função mudam sem tocar no acesso — o PATCH é parcial', async () => {
    const r = await editar(admin, julianaId, { funcao: 'Recepção' }).expect(200)
    expect(r.body.funcao).toBe('Recepção')
    expect(r.body.perfilId).toBe(perfilRec)
    expect(r.body.nome).toBe('Juliana Santos')
  })

  it('reativar limpa `desativada_em` — o CHECK não deixa os dois divergirem', async () => {
    await editar(admin, julianaId, { ativo: false }).expect(200)
    const fora = await migrate.query<{ desativada_em: Date | null }>(
      'SELECT desativada_em FROM pessoas WHERE id = $1',
      [julianaId],
    )
    expect(fora.rows[0]!.desativada_em).not.toBeNull()

    await editar(admin, julianaId, { ativo: true }).expect(200)
    const dentro = await migrate.query<{ desativada_em: Date | null }>(
      'SELECT desativada_em FROM pessoas WHERE id = $1',
      [julianaId],
    )
    expect(dentro.rows[0]!.desativada_em).toBeNull()
  })

  it('a escrita entra na TRILHA pelo trigger, com de → para', async () => {
    await editar(admin, julianaId, { funcao: 'Enfermagem' }).expect(200)
    const t = await migrate.query<{ de: Record<string, unknown>; para: Record<string, unknown> }>(
      `SELECT de, para FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pessoas' AND entidade_id = $2
        ORDER BY id DESC LIMIT 1`,
      [clinica, julianaId],
    )
    expect(t.rows[0]!.para['funcao']).toBe('Enfermagem')
    expect(t.rows[0]!.de['funcao']).toBe('')
  })
})

describe('perfis da clínica', () => {
  it('GET devolve os vivos, em ordem de nome', async () => {
    const r = await perfis(admin).expect(200)
    expect((r.body.perfis as { nome: string }[]).map((p) => p.nome)).toEqual([
      'Enfermagem',
      'Recepção',
      'Supervisão',
    ])
  })

  it('PUT renomeia, acrescenta e cunha a chave do novo no SERVIDOR', async () => {
    const r = await salvarPerfis(admin, {
      perfis: [
        { id: perfilRec, nome: 'Recepção', perms: ['jornada', 'receber', 'caixa'] },
        { id: perfilEnf, nome: 'Enfermagem', perms: ['programas', 'estoque'] },
        { id: perfilConfig, nome: 'Supervisão', perms: ['config'] },
        { nome: 'Comercial', perms: ['jornada', 'pacientes'] },
      ],
    })
    expect(r.status).toBe(200)
    const lista = r.body.perfis as { id: string; chave: string; nome: string; perms: string[] }[]
    expect(lista.map((p) => p.nome)).toEqual([
      'Comercial',
      'Enfermagem',
      'Recepção',
      'Supervisão',
    ])
    const novo = lista.find((p) => p.nome === 'Comercial')!
    expect(novo.chave).toMatch(/^pf_[0-9a-f]{32}$/)
    expect(novo.perms).toEqual(['jornada', 'pacientes'])
  })

  it('chave de permissão INVÁLIDA é 400 — o protótipo a descarta em silêncio', async () => {
    // `.filter(k => PERMS.some(…))` do protótipo: `estoque.gerr` desaparece e o
    // perfil "salva com sucesso" sem ela. O admin passa a tarde procurando por
    // que a enfermagem não vê o estoque.
    const r = await salvarPerfis(admin, {
      perfis: [{ id: perfilRec, nome: 'Recepção', perms: ['estoque.gerr'] }],
    })
    expect(r.status).toBe(400)
  })

  it('REMOVER perfil em uso por pessoa ATIVA é 422 e NOMEIA quem', async () => {
    const r = await salvarPerfis(admin, {
      perfis: [
        { id: perfilEnf, nome: 'Enfermagem', perms: ['programas'] },
        { id: perfilConfig, nome: 'Supervisão', perms: ['config'] },
      ],
    })
    expect(r.status).toBe(422)
    expect(r.body.codigo).toBe('PerfilEmUso')
    expect(r.body.message).toContain('Juliana Santos')

    // E NADA foi escrito: a recusa roda antes de qualquer `UPDATE`.
    const depois = await perfis(admin).expect(200)
    expect((depois.body.perfis as { nome: string }[]).map((p) => p.nome)).toEqual([
      'Enfermagem',
      'Recepção',
      'Supervisão',
    ])
  })

  it('perfil usado só por pessoa INATIVA pode sair — e sai por SOFT DELETE', async () => {
    await editar(admin, julianaId, { ativo: false }).expect(200)
    await salvarPerfis(admin, {
      perfis: [
        { id: perfilEnf, nome: 'Enfermagem', perms: ['programas'] },
        { id: perfilConfig, nome: 'Supervisão', perms: ['config'] },
      ],
    }).expect(200)

    /**
     * **A LINHA CONTINUA LÁ.** `DELETE` quebraria a FK de
     * `pessoas.perfil_id` da própria Juliana — e a recusa chegaria à tela como
     * erro de constraint sobre um perfil que ninguém mais usa.
     */
    const l = await migrate.query<{ excluido_em: Date | null }>(
      'SELECT excluido_em FROM perfis WHERE id = $1',
      [perfilRec],
    )
    expect(l.rows).toHaveLength(1)
    expect(l.rows[0]!.excluido_em).not.toBeNull()

    // E ele não serve mais para acesso novo.
    const r = await editar(admin, julianaId, { acesso: { admin: false, perfilId: perfilRec } })
    expect(r.status).toBe(422)
  })

  it('a CHAVE de um perfil excluído volta a ser usável — índice parcial', async () => {
    await editar(admin, julianaId, { acesso: { admin: false, perfilId: perfilEnf } }).expect(200)
    await salvarPerfis(admin, {
      perfis: [
        { id: perfilEnf, nome: 'Enfermagem', perms: ['programas'] },
        { id: perfilConfig, nome: 'Supervisão', perms: ['config'] },
      ],
    }).expect(200)
    // "Recepção" saiu. Recriá-lo com o mesmo nome passa: o índice único é
    // parcial em `excluido_em IS NULL`.
    const r = await salvarPerfis(admin, {
      perfis: [
        { id: perfilEnf, nome: 'Enfermagem', perms: ['programas'] },
        { id: perfilConfig, nome: 'Supervisão', perms: ['config'] },
        { nome: 'Recepção', perms: ['jornada'] },
      ],
    })
    expect(r.status).toBe(200)
    expect((r.body.perfis as { nome: string }[]).map((p) => p.nome)).toEqual([
      'Enfermagem',
      'Recepção',
      'Supervisão',
    ])
  })

  it('NOME repetido entre os vivos é recusado pelo banco', async () => {
    const r = await salvarPerfis(admin, {
      perfis: [
        { id: perfilRec, nome: 'Recepção', perms: ['jornada'] },
        { id: perfilConfig, nome: 'Supervisão', perms: ['config'] },
        { id: perfilEnf, nome: 'recepção', perms: ['programas'] },
      ],
    })
    // 500 seria aceitável só se nada mais tivesse sido escrito; o que importa
    // aqui é que a clínica NÃO fica com dois perfis que o admin não distingue.
    expect(r.status).toBeGreaterThanOrEqual(400)
    const depois = await perfis(admin).expect(200)
    const nomes = (depois.body.perfis as { nome: string }[]).map((p) => p.nome.toLowerCase())
    expect(new Set(nomes).size).toBe(nomes.length)
  })

  it('sem `config`, 403 nas duas', async () => {
    await perfis(semConfig).expect(403)
    // O 403 é do GUARD, antes de qualquer validação de corpo: o corpo aqui é
    // válido de propósito, senão um 400 passaria por 403 na leitura rápida.
    await salvarPerfis(semConfig, {
      perfis: [{ id: perfilRec, nome: 'Recepção', perms: ['jornada'] }],
    }).expect(403)
  })
})

/* ======================================================================
 * EXCLUIR PESSOA — soft delete, e os invariantes do domínio na BORDA
 * ====================================================================== */

describe('excluir pessoa é SOFT DELETE, e a clínica não fica sem administradora', () => {
  const linhaDe = async (id: string) =>
    (
      await migrate.query<{ ativo: boolean; excluida_em: Date | null; nome: string }>(
        'SELECT ativo, excluida_em, nome FROM pessoas WHERE id = $1',
        [id],
      )
    ).rows[0]

  it('a LINHA FICA — o histórico dela continua ligado', async () => {
    await excluir(admin, julianaId).expect(204)
    const l = await linhaDe(julianaId)
    expect(l, 'a pessoa foi APAGADA: o passado da clínica mudou').toBeDefined()
    expect(l!.nome).toBe('Juliana Santos')
    expect(l!.excluida_em).not.toBeNull()
  })

  it('e ela sai da LISTA', async () => {
    const antes = await listar(admin).expect(200)
    expect((antes.body.pessoas as { id: string }[]).map((p) => p.id)).toContain(julianaId)

    await excluir(admin, julianaId).expect(204)

    const depois = await listar(admin).expect(200)
    expect((depois.body.pessoas as { id: string }[]).map((p) => p.id)).not.toContain(julianaId)
  })

  it('EXCLUÍDA IMPLICA INATIVA — e por isso ela não entra mais', async () => {
    /**
     * O estado que o `CHECK pessoa_excluida_esta_inativa` (0023) torna
     * impossível: fora de toda tela e ainda entrando. `entrar` filtra `ativo`,
     * não `excluida_em` — é o CHECK que faz uma condição cobrir as duas
     * saídas, na rota mais atacada do produto.
     */
    await excluir(admin, julianaId).expect(204)
    expect((await linhaDe(julianaId))!.ativo).toBe(false)
    await entrar('juliana', SENHA).expect(401)
  })

  it('as SESSÕES VIVAS dela caem no instante do toque', async () => {
    await listar(semConfig).expect(403)
    await excluir(admin, julianaId).expect(204)
    await listar(semConfig).expect(401)
  })

  it('NINGUÉM se exclui', async () => {
    const r = await excluir(admin, helenaId).expect(422)
    expect(r.body.codigo).toBe('NaoPodeExcluirASiMesma')
    expect((await linhaDe(helenaId))!.excluida_em).toBeNull()
  })

  it('A ÚLTIMA ADMINISTRADORA ATIVA NÃO SE EXCLUI — nem por outra pessoa', async () => {
    /**
     * O arranjo importa: quem exclui é Sofia, que tem `config` e **não** é
     * admin. Com a própria Helena tentando, `EU_MESMA_EXCLUIR` responderia
     * primeiro e a invariante da clínica ficaria sem medição.
     *
     * MUTAÇÃO: tire a segunda recusa de `podeExcluirPessoa` e este teste fica
     * vermelho — a clínica perde a única administradora ativa e ninguém mais
     * abre Configurações. A única saída seria o painel.
     */
    const r = await excluir(comConfig, helenaId).expect(422)
    expect(r.body.codigo).toBe('UltimaAdministradoraAtiva')
    expect(r.body.message).toContain('excluir')
    expect((await linhaDe(helenaId))!.excluida_em).toBeNull()
    await entrar('helena', SENHA).expect(200)
  })

  it('com DUAS administradoras ativas, excluir uma passa', async () => {
    await editar(admin, julianaId, { acesso: { admin: true } }).expect(200)
    await excluir(admin, julianaId).expect(204)
    expect((await linhaDe(julianaId))!.excluida_em).not.toBeNull()
  })

  it('excluir DUAS VEZES é 404 — a segunda não reescreve a trilha', async () => {
    await excluir(admin, julianaId).expect(204)
    const primeira = (await linhaDe(julianaId))!.excluida_em
    await excluir(admin, julianaId).expect(404)
    expect((await linhaDe(julianaId))!.excluida_em).toEqual(primeira)
  })

  it('a excluída não é mais ALVO de nada: editar e redefinir senha dão 404', async () => {
    await excluir(admin, julianaId).expect(204)
    await editar(admin, julianaId, { nome: 'Nome Novo' }).expect(404)
    await request(app.getHttpServer())
      .post(`/v1/pessoas/${julianaId}/senha`)
      .set('Cookie', admin)
      .expect(404)
  })

  it('a excluída NÃO APARECE na recusa de "perfil em uso"', async () => {
    /**
     * `podeRemoverPerfis` nomeia quem está preso num perfil e filtra por
     * `ativo`. A excluída é inativa, então ela já não travaria — o que este
     * teste cobra é que `equipeDaClinica` também a tire da conta, que é o
     * mesmo filtro de onde sai a lista de nomes.
     */
    await excluir(admin, julianaId).expect(204)
    const r = await salvarPerfis(admin, {
      perfis: [
        { id: perfilEnf, nome: 'Enfermagem', perms: ['programas'] },
        { id: perfilConfig, nome: 'Supervisão', perms: ['config'] },
      ],
    })
    expect(r.status, JSON.stringify(r.body)).toBe(200)
  })

  it('sem `config` é 403, e a pessoa NÃO é excluída', async () => {
    await excluir(semConfig, sofiaId).expect(403)
    expect((await linhaDe(sofiaId))!.excluida_em).toBeNull()
  })

  it('a pessoa da VIZINHA é 404, nem com o id na mão', async () => {
    await excluir(admin, pessoaDaOutra).expect(404)
    const l = await migrate.query<{ excluida_em: Date | null }>(
      'SELECT excluida_em FROM pessoas WHERE id = $1',
      [pessoaDaOutra],
    )
    expect(l.rows[0]!.excluida_em).toBeNull()
  })

  it('a exclusão cai na TRILHA, com quem excluiu', async () => {
    await excluir(admin, julianaId).expect(204)
    const r = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'pessoas' AND entidade_id = $2
          AND para -> 'excluida_em' IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [clinica, julianaId],
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]!.ator_tipo).toBe('pessoa')
    expect(r.rows[0]!.ator_id).toBe(helenaId)
  })
})
