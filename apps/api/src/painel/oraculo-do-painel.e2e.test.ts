import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * O ORÁCULO DE TEMPO DO PAINEL — **com o piso desligado**.
 *
 * ## Por que este arquivo existe separado
 *
 * `PISO_DE_RESPOSTA_MS` (100 ms) fecha a classe inteira: toda saída de
 * `/v1/superadmin/entrar` custa pelo menos o mesmo, qualquer que seja o
 * caminho. Isso é o remédio certo — e é também o que **cega** qualquer
 * asserção sobre a camada de baixo.
 *
 * Foi medido na entrega anterior, no login do produto: removendo `HASH_FALSO`
 * dos dois caminhos de `/v1/entrar`, **55 de 57 testes de autenticação
 * continuavam verdes**. Só os dois escritos com o piso em zero pegaram. Uma
 * rota de entrada nova tem exatamente o mesmo risco, e o remédio é o mesmo:
 * medir com o piso desligado, senão o teste mede o piso e não o controle.
 *
 * ## O instrumento, e por que ele é a RAZÃO e não um limiar absoluto
 *
 * "Operador existe, senha errada" e "operador não existe" fazem **as mesmas**
 * idas ao banco: a transação do limite, a busca do operador e a transação que
 * grava a tentativa. A ÚNICA diferença entre os dois é um Argon2 — contra o
 * hash real num caso, contra `HASH_FALSO` no outro. Isso faz da razão entre
 * eles o instrumento certo: a carga da suíte infla os dois igualmente e a
 * razão não se move.
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

// ANTES de qualquer import do serviço: `PISO_DE_RESPOSTA_MS` é lido do
// ambiente no instante em que o módulo carrega. Por isso todos os imports
// abaixo são dinâmicos, dentro do `beforeAll`.
process.env['PISO_RESPOSTA_ENTRAR_MS'] = '0'
// E o limite por origem precisa sair do caminho: este arquivo dispara dezenas
// de entradas do mesmo loopback de propósito.
process.env['MAX_PAINEL_POR_ORIGEM'] = '5000'

/** Abaixo disto a medição é ruído e toda comparação seria vazia. */
const CUSTO_MINIMO_DO_ARGON2_MS = 3

/** Quanto de um Argon2 a saída precisa custar para que ele tenha rodado. */
const FRACAO_DE_UM_ARGON2 = 0.6

const SENHA = 'quatro-pedras-no-caminho'
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
/**
 * UMA CONTA POR AMOSTRA, e isto é o que torna a medição possível.
 *
 * O limite por identificador é 5 falhas em 15 minutos, e ele vale aqui como
 * vale em produção — não dá para desligá-lo sem desligar o que se quer medir
 * junto. Com uma conta só, a sexta amostra responde **429 em vez de 401** e o
 * teste reprova por um controle que ele não está medindo. Medido: com cinco
 * amostras ele ficava exatamente na borda, e a borda é onde o teste fica
 * não-determinístico.
 *
 * Uma conta por amostra tira o limite do caminho sem tirá-lo do produto.
 */
const AMOSTRAS = 7
const existentes = Array.from({ length: AMOSTRAS }, (_, i) => `oraculo.${sufixo}.${i}`)
const inexistentes = Array.from({ length: AMOSTRAS }, (_, i) => `naoexiste.${sufixo}.${i}`)

let app: NestFastifyApplication
let migrate: pg.Client
let operadores: string[]
let piso: number
let custoDeUmArgon2: number
let apagar: (c: pg.Client, id: string) => Promise<void>

const mediana = (xs: number[]): number => {
  const o = [...xs].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 === 0 ? ((o[m - 1] ?? 0) + (o[m] ?? 0)) / 2 : (o[m] ?? 0)
}

const umaTentativa = async (usuario: string): Promise<number> => {
  const inicio = performance.now()
  await request(app.getHttpServer())
    .post('/v1/superadmin/entrar')
    .send({ usuario, senha: 'chute-errado-aqui' })
    .expect(401)
  return performance.now() - inicio
}

/**
 * Mede os DOIS caminhos **intercalados**, e isto é correção, não estética.
 *
 * A primeira versão media cinco vezes A e depois cinco vezes B. Sob a suíte
 * completa — seis pacotes do turbo em paralelo nesta máquina — uma rajada de
 * carga cai inteira dentro de um dos dois blocos, e a razão entre eles passa
 * a medir **quando o bloco rodou**, não o que ele faz. Medido: verde 4 de 4
 * rodando só `@fir/api`, vermelho 1 de 3 na suíte completa.
 *
 * Intercalado, qualquer oscilação da máquina atinge os dois quase igualmente,
 * e a razão volta a medir a única diferença real entre eles: um Argon2.
 *
 * Teste não-determinístico é pior que teste ausente: ensina a equipe a rodar
 * de novo até passar, e aí o vermelho verdadeiro também vira ruído.
 */
const medirIntercalado = async (
  a: readonly string[],
  b: readonly string[],
): Promise<{ a: number; b: number }> => {
  const temposA: number[] = []
  const temposB: number[] = []
  // A primeira rodada de cada caminho carrega o aquecimento do binding
  // nativo do Argon2 e é descartada pela mediana.
  for (let i = 0; i < AMOSTRAS; i++) {
    temposA.push(await umaTentativa(a[i]!))
    temposB.push(await umaTentativa(b[i]!))
  }
  return { a: mediana(temposA), b: mediana(temposB) }
}

beforeAll(async () => {
  const [{ AppModule }, { registrarCookie }, senhaMod, { PISO_DE_RESPOSTA_MS }, limpeza] =
    await Promise.all([
      import('../app.module'),
      import('../main'),
      import('../autenticacao/senha'),
      import('../autenticacao/autenticacao.service'),
      import('../banco/limpeza-de-teste'),
    ])
  piso = PISO_DE_RESPOSTA_MS
  apagar = limpeza.apagarOperadorDeTeste

  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await limpeza.declararAtorSistema(migrate)

  const hash = await senhaMod.hashDeSenha(SENHA)
  const criados = await migrate.query<{ id: string }>(
    `INSERT INTO operadores (usuario, nome, senha_hash)
     SELECT u, 'Oráculo', $2 FROM unnest($1::text[]) AS u RETURNING id`,
    [existentes, hash],
  )
  operadores = criados.rows.map((r) => r.id)
  expect(operadores.length, 'a fixture não criou as contas da medição').toBe(AMOSTRAS)

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
  await migrate.query('DELETE FROM tentativas_de_operador WHERE identificador = ANY($1)', [
    [...existentes, ...inexistentes],
  ])
  for (const id of operadores ?? []) await apagar(migrate, id)
  await migrate.end()
  await app.close()
})

describe('toda saída 401 do painel inclui um Argon2', () => {
  it('o piso ESTÁ desligado — senão este arquivo mede a mesma coisa que o outro', () => {
    expect(
      piso,
      'PISO_RESPOSTA_ENTRAR_MS não ficou em 0 — este arquivo deixou de medir o que diz medir',
    ).toBe(0)
  })

  it('a referência de Argon2 é um custo de verdade, não ruído', () => {
    expect(
      custoDeUmArgon2,
      `um Argon2 custou ${custoDeUmArgon2} ms nesta máquina — abaixo do ruído de medição, ` +
        'e toda comparação abaixo seria vazia',
    ).toBeGreaterThan(CUSTO_MINIMO_DO_ARGON2_MS)
  })

  it('o operador que NÃO existe gasta o mesmo Argon2 que a senha errada', async () => {
    const { a: existe, b: naoExiste } = await medirIntercalado(existentes, inexistentes)

    // Sanidade: se o caminho REAL também é instantâneo, as duas medidas são
    // ruído e a razão não significa nada.
    expect(
      existe,
      `senha errada em operador existente custou ${existe} ms — Argon2 não rodou, ` +
        'e a razão abaixo seria entre dois ruídos',
    ).toBeGreaterThanOrEqual(custoDeUmArgon2 * FRACAO_DE_UM_ARGON2)

    expect(
      naoExiste,
      `operador inexistente respondeu em ${naoExiste} ms contra ${existe} ms do existente ` +
        `(um Argon2 custa ${custoDeUmArgon2} ms aqui) — o relógio diz quais operadores ` +
        'existem. Confira HASH_FALSO em painel.service.ts.',
    ).toBeGreaterThanOrEqual(existe * 0.7)
  })
})
