/**
 * **O oráculo de tempo, medido COM O PISO DESLIGADO.**
 *
 * Por que este arquivo existe, e por que ele não é duplicata do e2e:
 *
 * `PISO_DE_RESPOSTA_MS` (100 ms) fecha a classe inteira — toda saída de
 * `entrar` custa pelo menos o mesmo — e `autenticacao.e2e.test.ts` prova
 * isso. Mas, ao fechar a classe, o piso **cega** as asserções que mediam as
 * duas defesas por baixo dele. Provado por mutação em 2026-10-28: apagando
 * `HASH_FALSO` do caminho de usuário inexistente, e apagando-o do caminho de
 * clínica inexistente, a suíte inteira continuava verde. As duas defesas
 * existiam sem nenhum teste que as segurasse.
 *
 * É o MESMO defeito que o comentário de `autenticacao.e2e.test.ts` descreve
 * para o oráculo de clínica — uma asserção que o próprio remédio tornou
 * impossível de falhar — só que do outro lado.
 *
 * Em defesa em profundidade, a camada de baixo também precisa de teste: no
 * dia em que alguém baixar o piso para caber numa VPS mais lenta, é
 * `HASH_FALSO` que continua segurando o oráculo.
 *
 * ---
 *
 * **A ASSERÇÃO NÃO É UMA RAZÃO ENTRE DOIS CAMINHOS**, e a primeira versão
 * deste arquivo errou nisso. Comparar "clínica existente" com "clínica
 * inexistente" parece natural e é frágil: os dois caminhos fazem números
 * DIFERENTES de idas ao banco, e sob a carga da suíte inteira a ida ao banco
 * infla muito mais que o Argon2 — a razão desaba sem defeito nenhum. Foi
 * exatamente o que aconteceu: verde sozinho, vermelho na suíte completa.
 *
 * A referência certa é o **custo de UM Argon2**, medido neste mesmo processo
 * e nas mesmas condições. A pergunta que o teste faz é binária e é a única
 * que importa: *esta resposta incluiu um Argon2, ou não?* Toda saída 401 de
 * `entrar` tem de incluir um. Carga só faz a medida subir, que é a direção
 * segura.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ANTES de qualquer import do serviço: `PISO_DE_RESPOSTA_MS` é lido do
// ambiente no carregamento do módulo. Por isso o `AppModule` entra por
// `await import(...)` dentro do `beforeAll`, e não por `import` no topo.
process.env['PISO_RESPOSTA_ENTRAR_MS'] = '0'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'montanha-de-vidro-aberta'

/**
 * Que fração de um Argon2 a resposta precisa custar.
 *
 * Com `HASH_FALSO` a resposta custa **um Argon2mais** as idas ao banco, logo
 * a razão real fica acima de 1. Sem ele, sobra só a ida ao banco — uma
 * fração pequena. `0.6` fica largo o bastante para o jitter de medição e
 * para a suíte inteira competindo por CPU, e estreito o bastante para que
 * "o Argon2 não rodou" não caiba embaixo.
 */
const FRACAO_DE_UM_ARGON2 = 0.6

/** Abaixo disto a própria referência é ruído e não há o que comparar. */
const CUSTO_MINIMO_DO_ARGON2_MS = 5

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let piso: number
let custoDeUmArgon2: number
const codigo = `orac-${Date.now()}`

const entrar = (usuario: string, senha: string, cod = codigo) =>
  request(app.getHttpServer()).post('/v1/entrar').send({ clinica: cod, usuario, senha })

const mediana = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

const medir = async (usuario: string, senha: string, cod = codigo): Promise<number> => {
  const tempos: number[] = []
  // Cinco amostras e a MEDIANA: a primeira de cada processo carrega o
  // aquecimento do binding nativo do Argon2.
  for (let i = 0; i < 5; i++) {
    const inicio = performance.now()
    await entrar(usuario, senha, cod).expect(401)
    tempos.push(performance.now() - inicio)
  }
  return mediana(tempos)
}

beforeAll(async () => {
  const [{ AppModule }, { registrarCookie }, senhaMod, { PISO_DE_RESPOSTA_MS }, limpeza] =
    await Promise.all([
      import('../app.module'),
      import('../main'),
      import('./senha'),
      import('./autenticacao.service'),
      import('../banco/limpeza-de-teste'),
    ])
  piso = PISO_DE_RESPOSTA_MS

  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await limpeza.declararAtorSistema(migrate)
  const c = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica do Oráculo') RETURNING id`,
    [codigo],
  )
  clinica = c.rows[0]!.id
  const hash = await senhaMod.hashDeSenha(SENHA)
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
     VALUES ($1, 'Existe Um', 'existe.um', $2, true),
            ($1, 'Existe Dois', 'existe.dois', $2, true)`,
    [clinica, hash],
  )

  const { FastifyAdapter } = await import('@nestjs/platform-fastify')
  const { Test } = await import('@nestjs/testing')
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  // A REFERÊNCIA: um Argon2 de verdade, com os parâmetros de produção, neste
  // processo e nestas condições. Seis amostras, a primeira descartada pelo
  // aquecimento do binding nativo.
  const amostras: number[] = []
  for (let i = 0; i < 6; i++) {
    const inicio = performance.now()
    await senhaMod.conferirSenha('chute-errado-aqui', hash)
    amostras.push(performance.now() - inicio)
  }
  custoDeUmArgon2 = mediana(amostras.slice(1))
})

afterAll(async () => {
  const { apagarClinicaDeTeste } = await import('../banco/limpeza-de-teste')
  if (clinica) await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.close()
})

describe('toda saída 401 de entrar inclui um Argon2', () => {
  it('o piso ESTÁ desligado — senão este arquivo mede a mesma coisa que o outro', () => {
    // A sanidade que impede este arquivo de virar cópia: com o piso ligado,
    // toda asserção abaixo passaria sem provar nada sobre `HASH_FALSO`.
    expect(
      piso,
      'PISO_RESPOSTA_ENTRAR_MS não ficou em 0 — este arquivo deixou de medir o que diz medir',
    ).toBe(0)
  })

  it('a referência de Argon2 é um custo de verdade, não ruído', () => {
    expect(
      custoDeUmArgon2,
      `um Argon2 custou ${custoDeUmArgon2} ms nesta máquina — abaixo do ruído de medição, e toda comparação abaixo seria vazia`,
    ).toBeGreaterThan(CUSTO_MINIMO_DO_ARGON2_MS)
  })

  /**
   * ESTE caso compara os DOIS CAMINHOS, e não contra a referência de Argon2 —
   * e a escolha é medida, não estética.
   *
   * "Conta existe, senha errada" e "conta não existe" fazem **exatamente** as
   * mesmas idas ao banco: a consulta da clínica, a transação do limite e a
   * transação que grava a tentativa. A ÚNICA diferença entre os dois é um
   * Argon2. Isso faz da razão entre eles o instrumento certo: a carga da
   * suíte infla os dois igualmente e a razão não se move.
   *
   * Contra a referência de Argon2 este caso NÃO funciona, e isso foi medido:
   * com `HASH_FALSO` removido, as três idas ao banco deste caminho custam
   * ~16 ms nesta máquina, mais de 0,6 de um Argon2 (26 ms) — o teste passava
   * com o defeito dentro. A referência serve ao caso da clínica, que faz um
   * número de consultas DIFERENTE, e não a este.
   */
  it('o usuário que NÃO existe gasta o mesmo Argon2 que a senha errada', async () => {
    const existe = await medir('existe.um', 'chute-errado-aqui')
    const naoExiste = await medir('nao.existe.aqui', 'chute-errado-aqui')

    // Sanidade: se o caminho REAL também é instantâneo, as duas medidas são
    // ruído e a razão não significa nada.
    expect(
      existe,
      `senha errada em conta existente custou ${existe} ms — Argon2 não rodou, e a razão abaixo seria entre dois ruídos`,
    ).toBeGreaterThanOrEqual(custoDeUmArgon2 * FRACAO_DE_UM_ARGON2)

    expect(
      naoExiste,
      `usuário inexistente respondeu em ${naoExiste} ms contra ${existe} ms do existente ` +
        `(um Argon2 custa ${custoDeUmArgon2} ms aqui) — o relógio diz quais contas existem ` +
        'nesta clínica. Confira HASH_FALSO em autenticacao.service.ts.',
    ).toBeGreaterThanOrEqual(existe * 0.7)
  })

  it('a clínica que NÃO existe gasta o mesmo Argon2 que a clínica existente', async () => {
    const piso401 = custoDeUmArgon2 * FRACAO_DE_UM_ARGON2
    const naoExiste = await medir('existe.dois', 'chute-errado-aqui', `nao-existe-${Date.now()}`)

    expect(
      naoExiste,
      `clínica inexistente custou ${naoExiste} ms, menos de ${FRACAO_DE_UM_ARGON2} de um Argon2 ` +
        `(${custoDeUmArgon2} ms) — uma requisição por código enumera os tenants da instalação, ` +
        'e sem deixar rastro, porque nem tentativa é gravada.',
    ).toBeGreaterThanOrEqual(piso401)
  })
})
