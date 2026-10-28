import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { registrarCookie } from '../main'
import { PISO_DE_RESPOSTA_MS } from './autenticacao.service'
import { LimitePorOrigem } from './limite-por-origem'
import { hashDeSenha } from './senha'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
const codigo = `e2e-${Date.now()}`

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  // A trigger `registrar_auditoria` recusa escrita sem ator declarado, e
  // fixture não tem pessoa autenticada por trás: é o sistema criando dado.
  await declararAtorSistema(migrate)

  const c = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica E2E') RETURNING id`,
    [codigo],
  )
  clinica = c.rows[0]!.id

  const p = await migrate.query<{ id: string }>(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada','receber']) RETURNING id`,
    [clinica],
  )
  const perfil = p.rows[0]!.id

  const criar = async (nome: string, usuario: string, senha: string) => {
    await migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [clinica, nome, usuario, await hashDeSenha(senha), perfil],
    )
  }

  await criar('Juliana', 'juliana', 'senha-de-teste')
  // Duas contas A/B dedicadas ao teste de isolamento do limite de
  // tentativas — nunca usadas por outro teste, para que o teste não dependa
  // da ordem de execução dos demais.
  await criar('Conta A', 'conta.a', 'senha-da-conta-a')
  await criar('Conta B', 'conta.b', 'senha-da-conta-b')
  // Conta dedicada à medição de tempo (Rodada de correção 1): precisa
  // existir de verdade, com hash válido, para que o caminho "senha errada"
  // rode Argon2 de produção — comparado contra um usuário que nunca existe.
  await criar('Conta Tempo', 'conta.tempo.existe', 'senha-da-conta-tempo')
  // Conta dedicada à medição do caminho de SUCESSO, para que o piso seja
  // medido nas quatro saídas de `entrar` e não só nas três de erro.
  await criar('Conta Piso', 'conta.piso', 'senha-da-conta-piso')
  // E outra para a saída "senha errada" do mesmo teste: `conta.tempo.existe`
  // já chega lá com cinco falhas gastas pelo teste de oráculo de tempo, e a
  // sexta tentativa responderia 429 em vez de 401.
  await criar('Conta Piso Errada', 'conta.piso.errada', 'senha-da-piso-errada')
  // Conta dedicada ao limite por canônico: cinco grafias da MESMA conta.
  await criar('Conta Grafia', 'grafia', 'senha-da-grafia')

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await app.close()
})

const entrar = (senha: string) =>
  request(app.getHttpServer())
    .post('/v1/entrar')
    .send({ clinica: codigo, usuario: 'juliana', senha })

const entrarComo = (usuario: string, senha: string, clinicaCodigo = codigo) =>
  request(app.getHttpServer())
    .post('/v1/entrar')
    .send({ clinica: clinicaCodigo, usuario, senha })

/**
 * O tipo de `Response.headers` do supertest/superagent não reflete o
 * caso especial de `set-cookie` do Node (sempre um array, mesmo com um só
 * cookie) — a biblioteca o tipa como `string`. Esta função corrige o tipo
 * sem mudar o valor em tempo de execução.
 */
const cookieDaResposta = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}

describe('POST /v1/entrar', () => {
  it('sem sessão, /v1/eu responde 401', async () => {
    await request(app.getHttpServer()).get('/v1/eu').expect(401)
  })

  it('entra com usuário e senha, e devolve usuário, clínica e perfis', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    expect(r.body.usuario.usuario).toBe('juliana')
    expect(r.body.clinica.codigo).toBe(codigo)
    expect(r.body.perfis[0].perms).toContain('jornada')
    expect(cookieDaResposta(r).join()).toMatch(/__Host-fir-sessao=/)
  })

  it('não há e-mail em lugar nenhum da resposta', async () => {
    // D-10: o produto inteiro deixou de coletar e-mail da equipe. Uma linha a
    // menos na avaliação de impacto, e uma a menos em `tentativas_login`.
    const r = await entrar('senha-de-teste').expect(200)
    expect(JSON.stringify(r.body)).not.toMatch(/@/)
    expect(Object.keys(r.body.usuario)).not.toContain('email')
  })

  it('perdoa caixa, acento e espaço nas pontas no campo usuário', async () => {
    // O corretor do tablet maiusculiza a primeira letra, e a colagem traz
    // espaço. Isso não pode custar um chamado de suporte.
    for (const digitado of ['Juliana', '  JULIANA ', 'juliána']) {
      const r = await entrarComo(digitado, 'senha-de-teste')
      expect(r.status, digitado).toBe(200)
    }
  })

  it('o cookie é HttpOnly, Secure, SameSite e de caminho raiz', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const cookie = cookieDaResposta(r).join()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\//)
  })

  it('a resposta NUNCA contém o hash da senha, a senha crua nem o token cru', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const texto = JSON.stringify(r.body)
    expect(texto).not.toMatch(/\$argon2id\$/)
    expect(texto).not.toMatch(/token/i)
    expect(texto).not.toContain('senha-de-teste')
  })

  it('a frase de erro não diz se o usuário existe, e não fala em e-mail', async () => {
    const a = await entrar('senha-errada').expect(401)
    const b = await entrarComo('ninguem', 'senha-de-teste').expect(401)
    // Mensagens diferentes dizem ao atacante quais usuários existem na
    // clínica — e com usuário adivinhável isso é a lista inteira da equipe.
    expect(a.body.message).toBe(b.body.message)
    expect(a.body.message).not.toMatch(/mail/i)
  })

  it('com sessão, /v1/eu devolve usuário, clínica COMPLETA e perfis', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const cookie = cookieDaResposta(r)
    const eu = await request(app.getHttpServer()).get('/v1/eu').set('Cookie', cookie).expect(200)
    expect(eu.body.usuario.nome).toBe('Juliana')
    expect(eu.body.usuario.usuario).toBe('juliana')
    expect(eu.body.usuario.senhaProvisoria).toBe(false)
    // Código e nome vêm preenchidos: a tela monta o cabeçalho com eles, e um
    // campo vazio aqui vira "Firmare" genérico em produção.
    expect(eu.body.clinica.codigo).toBe(codigo)
    expect(eu.body.clinica.nome).toBe('Clínica E2E')
    expect(eu.body.clinica.fuso).toBe('America/Bahia')
    expect(eu.body.perfis[0].chave).toBe('pf_rec')
  })

  it('sair revoga a sessão: o mesmo cookie passa a dar 401', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const cookie = cookieDaResposta(r)
    await request(app.getHttpServer()).post('/v1/sair').set('Cookie', cookie).expect(204)
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', cookie).expect(401)
  })

  it('entrar e sair deixam na trilha o nome de quem agiu, não "sistema"', async () => {
    /**
     * A prova POSITIVA do ator, pelo caminho HTTP de verdade — e a única que
     * distingue "nada ficou sem ator" de "o ator está certo". A suíte inteira
     * ficaria verde com `SISTEMA` em toda chamada de `naClinica`: a trigger
     * aceita, a trilha enche, e cada sessão criada por uma recepcionista
     * apareceria como ação do sistema. Tecnicamente completa, factualmente
     * mentirosa.
     */
    const juliana = (
      await migrate.query<{ id: string }>(
        'SELECT id FROM pessoas WHERE clinica_id = $1 AND usuario = $2',
        [clinica, 'juliana'],
      )
    ).rows[0]!.id
    const desde = (
      await migrate.query<{ ultimo: string }>(
        'SELECT coalesce(max(id), 0)::text AS ultimo FROM auditoria WHERE clinica_id = $1',
        [clinica],
      )
    ).rows[0]!.ultimo

    const r = await entrar('senha-de-teste').expect(200)
    const cookie = cookieDaResposta(r)
    await request(app.getHttpServer()).post('/v1/sair').set('Cookie', cookie).expect(204)

    const t = await migrate.query<{ acao: string; entidade: string; ator_id: string | null }>(
      `SELECT acao, entidade, ator_id FROM auditoria
        WHERE clinica_id = $1 AND id > $2 AND entidade = 'sessoes' ORDER BY id`,
      [clinica, desde],
    )
    // A sessão nasce em nome de quem provou a senha, e é revogada em nome de
    // quem apresentou o cookie — as duas são a MESMA pessoa, e nenhuma é o
    // sistema.
    expect(t.rows.map((x) => x.acao)).toEqual(['criou', 'alterou'])
    for (const linha of t.rows) expect(linha.ator_id).toBe(juliana)
  })

  it('tentativas_login guarda o USUÁRIO, nunca um e-mail', async () => {
    // D-10: menos PII na trilha. É o ganho de graça desta decisão, e vale
    // registrar que ele está de pé.
    await entrarComo('conta.b', 'chute-errado-aqui').expect(401)
    const r = await migrate.query<{ identificador: string }>(
      `SELECT identificador FROM tentativas_login
        WHERE clinica_id = $1 ORDER BY em DESC, id DESC LIMIT 1`,
      [clinica],
    )
    expect(r.rows[0]!.identificador).toBe('conta.b')
    expect(r.rows[0]!.identificador).not.toMatch(/@/)
  })

  it('o limite por conta conta pelo CANÔNICO, não pelo que foi digitado', async () => {
    // Senão `Grafia`, `GRAFIA` e `gráfia` seriam três contas distintas para o
    // limite, e cinco tentativas virariam quinze com três grafias.
    for (const g of ['grafia', 'Grafia', 'GRAFIA', 'gráfia', '  grafia  ']) {
      await entrarComo(g, 'chute-errado-aqui').expect(401)
    }
    await entrarComo('grafia', 'senha-da-grafia').expect(429)
  })

  it('cinco senhas erradas bloqueiam a sexta tentativa, mesmo com a senha certa', async () => {
    for (let i = 0; i < 5; i++) await entrar('senha-errada').expect(401)
    await entrar('senha-de-teste').expect(429)
  })

  it('o limite é por identificador: falhas na conta A não bloqueiam a conta B', async () => {
    // Esgota o limite da conta A, isolada e nunca usada por outro teste.
    for (let i = 0; i < 5; i++) {
      await entrarComo('conta.a', 'senha-errada').expect(401)
    }
    await entrarComo('conta.a', 'senha-da-conta-a').expect(429)

    // A conta B, na MESMA clínica, está longe do teto: a consulta de
    // `limiteExcedido` filtra por `identificador = $1`, então as falhas da
    // conta A não aparecem na janela de tentativas da conta B.
    await entrarComo('conta.b', 'senha-da-conta-b').expect(200)
  })

  /**
   * Rodada de correção 1: o relógio da resposta não pode dizer qual
   * identificador existe. Medido contra a API viva ANTES da correção (hash
   * falso):
   *
   *   existe@t.local      401 em 20 / 68 / 20 ms   (Argon2 roda)
   *   naoexiste@t.local   401 em  8 /  9 /  8 ms   (Argon2 não roda)
   *
   * Três a oito vezes mais rápido. Tempo é ruidoso (a primeira medição de
   * cada processo carrega o aquecimento do binding nativo do Argon2 — por
   * isso 5 medições por caminho e a MEDIANA, não a primeira nem a média).
   * Não afirmamos igualdade: só que o caminho sem pessoa custa pelo menos a
   * metade do caminho com pessoa real — suficiente para pegar a regressão
   * óbvia (hash falso removido), que reabriria a razão de 3x–8x medida acima.
   *
   * **Com o e-mail fora (D-10) este teste vale mais, não menos.** Antes,
   * enumerar contas exigia descobrir o domínio; agora o nome de usuário é
   * `ana`, `recepcao`, `juliana`, e um oráculo de tempo entrega a lista
   * inteira da equipe de uma clínica de seis pessoas em dez minutos.
   */
  it('o tempo de resposta não distingue usuário inexistente de senha errada', async () => {
    const medir = async (usuario: string, senha: string): Promise<number> => {
      const tempos: number[] = []
      for (let i = 0; i < 5; i++) {
        const inicio = performance.now()
        await entrarComo(usuario, senha).expect(401)
        tempos.push(performance.now() - inicio)
      }
      tempos.sort((a, b) => a - b)
      return tempos[2]! // mediana de 5
    }

    const medianaExiste = await medir('conta.tempo.existe', 'senha-errada-tempo')
    const medianaNaoExiste = await medir('conta.tempo.naoexiste', 'senha-de-teste')

    expect(medianaNaoExiste).toBeGreaterThanOrEqual(medianaExiste * 0.5)
  })

  /**
   * Correção final da branch, achado 3: o ORÁCULO DE CÓDIGO DE CLÍNICA.
   *
   * `clinicaPorCodigo` devolvia `null` e a função recusava antes de qualquer
   * Argon2 e sem gravar tentativa. Medido pelo revisor contra a API viva:
   *
   *   clínica existente     29,0 ms
   *   clínica inexistente    2,9 ms
   *
   * Dez vezes — uma requisição por código enumerava todos os tenants da
   * instalação, sem deixar rastro. O remédio é o mesmo do `HASH_FALSO`:
   * rodar a verificação de qualquer forma, pelo mesmo semáforo.
   *
   * Mesma disciplina de medição do teste acima: 5 amostras e a MEDIANA (a
   * primeira de cada processo carrega o aquecimento do binding nativo).
   *
   * Re-revisão (achado 1): a asserção ERA de razão
   * (`medianaNaoExiste >= medianaExiste * 0.5`), e 0,5 é mais FROUXO que o
   * resíduo de 0,65 que o próprio `PISO_DE_RESPOSTA_MS` existe para fechar
   * (15,1 ms contra 23,4 ms, medido em `autenticacao.service.ts`).
   * Provado por mutação: com `PISO_RESPOSTA_ENTRAR_MS=0` a razão sobe para
   * ~1 (as duas latências caem para o mesmo chão sem piso, e ficam tão
   * próximas quanto o piso as deixava distantes) e passava 3/3 — ou seja, o
   * piso podia ser apagado por inteiro sem que esta asserção notasse.
   *
   * A asserção correta é sobre o MECANISMO, não a diferença entre os dois
   * caminhos: todo `/v1/entrar` — com clínica ou sem — tem de levar pelo
   * menos o piso configurado. `* 0.9` é folga de medição (`performance.now`
   * tem jitter de submilissegundo sob carga do runner), não uma concessão ao
   * defeito: nenhuma razão entre os dois caminhos entra na conta.
   *
   * **As QUATRO saídas de `entrar`**, e não duas: a D-10 acrescentou a saída
   * de sucesso à varredura. O piso está num `finally`, logo vale para o
   * sucesso também — e precisa valer, senão o relógio passa a dizer "esta
   * senha estava certa", que é o mesmo oráculo com outra pergunta.
   *
   * Duas partes, de propósito — uma só não basta:
   *
   * 1. SANIDADE DO VALOR CONFIGURADO, contra uma referência FIXA (nunca
   *    `PISO_DE_RESPOSTA_MS` multiplicado por si mesmo): se a comparação
   *    usasse só `medianaX >= PISO_DE_RESPOSTA_MS * 0.9`, mutar
   *    `PISO_RESPOSTA_ENTRAR_MS=0` arrastaria o LIMIAR para 0 junto com a
   *    medida, e `0 >= 0` passa sempre — exatamente o defeito que esta
   *    correção existe para fechar. `50` é fixo porque está ACIMA do jitter
   *    de medição e ABAIXO do caminho SEM clínica desprotegido (~15 ms).
   * 2. MECANISMO: as quatro medianas têm de alcançar o piso que ESTÁ
   *    configurado — pega a regressão de código (`finally` removido) mesmo
   *    com a variável de ambiente correta.
   */
  it('o piso de tempo vale para as QUATRO saídas de entrar', async () => {
    const PISO_MINIMO_SAO_MS = 50

    const medir = async (
      usuario: string,
      senha: string,
      clinicaCodigo: string,
      esperado: number,
    ): Promise<number> => {
      const tempos: number[] = []
      for (let i = 0; i < 5; i++) {
        const inicio = performance.now()
        await entrarComo(usuario, senha, clinicaCodigo).expect(esperado)
        tempos.push(performance.now() - inicio)
      }
      tempos.sort((a, b) => a - b)
      return tempos[2]!
    }

    expect(
      PISO_DE_RESPOSTA_MS,
      `PISO_RESPOSTA_ENTRAR_MS=${PISO_DE_RESPOSTA_MS} está abaixo do mínimo que fecha o resíduo medido ` +
        `(${PISO_MINIMO_SAO_MS} ms) — o oráculo de código de clínica reabre`,
    ).toBeGreaterThanOrEqual(PISO_MINIMO_SAO_MS)

    const saidas: [string, number][] = [
      // Sucesso: a conta existe e a senha confere. Cinco entradas seguidas não
      // esbarram no limite — um sucesso zera a contagem de falhas.
      ['sucesso', await medir('conta.piso', 'senha-da-conta-piso', codigo, 200)],
      // Senha errada numa conta que existe.
      ['senha errada', await medir('conta.piso.errada', 'chute-errado-aqui', codigo, 401)],
      // Usuário que nunca existiu, na clínica que existe.
      ['usuário inexistente', await medir('nao.existe.aqui', 'chute-errado-aqui', codigo, 401)],
      // Clínica que nunca existiu: o caminho que NÃO abre transação nenhuma.
      [
        'clínica inexistente',
        await medir('qualquer', 'chute-errado-aqui', `nao-existe-${Date.now()}`, 401),
      ],
    ]

    const pisoMinimo = PISO_DE_RESPOSTA_MS * 0.9
    for (const [nome, mediana] of saidas) {
      expect(
        mediana,
        `a saída "${nome}" respondeu em ${mediana} ms, abaixo do piso configurado ` +
          `(${PISO_DE_RESPOSTA_MS} ms) — o piso pode ter sido removido ou desligado ` +
          '(ver PISO_RESPOSTA_ENTRAR_MS e o `finally` de `entrar`)',
      ).toBeGreaterThanOrEqual(pisoMinimo)
    }
  })
})

/**
 * O limite por ORIGEM, com um provedor de teto 3 em vez do teto de produção
 * (60 em 5 minutos): o que está sob teste é a rota devolver 429 com
 * `Retry-After`, não o valor do parâmetro — esse é medido em
 * `limite-por-origem.test.ts`.
 */
describe('POST /v1/entrar — limite por origem', () => {
  let appLimitado: NestFastifyApplication

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LimitePorOrigem)
      .useValue(new LimitePorOrigem(3, 60_000))
      .compile()
    appLimitado = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await registrarCookie(appLimitado)
    await appLimitado.init()
    await appLimitado.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await appLimitado.close()
  })

  it('mil usuários distintos NÃO atravessam o limite: a quarta tentativa leva 429', async () => {
    const tentar = (i: number) =>
      request(appLimitado.getHttpServer())
        .post('/v1/entrar')
        .send({
          clinica: codigo,
          // Usuários DISTINTOS de propósito: é assim que o limite por
          // identificador (cinco falhas na mesma conta) é contornado, e é o
          // buraco que este limite tapa.
          usuario: `origem.${i}.${Date.now()}`,
          senha: 'senha-qualquer-longa',
        })

    await tentar(1).expect(401)
    await tentar(2).expect(401)
    await tentar(3).expect(401)
    const r = await tentar(4).expect(429)
    // `Retry-After` existe para o cliente não insistir às cegas — e para que
    // o navegador da recepção não entre em laço de nova tentativa.
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0)
  })
})
