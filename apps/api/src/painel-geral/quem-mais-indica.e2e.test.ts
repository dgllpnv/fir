import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Painel } from '@fir/contracts'
import type { Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import fc from 'fast-check'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { hashDeSenha } from '../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { RELOGIO } from '../comum/relogio'
import { registrarCookie } from '../main'

/**
 * **"Quem mais indica" no Painel** (correções da PO, B3).
 *
 * O que este arquivo fixa, contra Postgres real:
 *  - conta PACIENTES distintas, nunca recebimentos (N-19): a indicada com 12
 *    recebimentos conta 1, e a propriedade vale para qualquer distribuição;
 *  - a janela é a do cadastro, semiaberta, no fuso da clínica (N-20, regra 23);
 *  - desempate fixo, a mesma ordem em 10 leituras (N-21);
 *  - só indicadoras ativas, só o vínculo por id, só a própria clínica
 *    (L-B3-3, S-39, AB-B3-2);
 *  - o nome de uma indicada nunca aparece na resposta (L-B3-3);
 *  - sem `painel`, ou com `painel` sem `valores`: 403 (L-B3-2, AB-B3-1);
 *  - a carteira não lê o bloco (L-B3-5).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'sete-pontes-sobre-o-rio'
const codigo = `qmi-${Date.now()}`
const FUSO = 'America/Sao_Paulo'

/** 05/11/2026 15:00 UTC — 12:00 em São Paulo. */
const INICIO = new Date('2026-11-05T15:00:00.000Z')
let agora = new Date(INICIO)
const relogio: Relogio = { agora: () => agora }

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
let vizinha: string
let helena: string
let gestao: string[]
let gestaoVizinha: string[]
let semPainel: string[]
let painelSemValores: string[]

const srv = () => request(app.getHttpServer())
const ver = async (consulta = 'periodo=mes', cookie = gestao): Promise<Painel> =>
  (await srv().get(`/v1/painel?${consulta}`).set('Cookie', cookie).expect(200)).body as Painel

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

/** Uma paciente, cadastrada em `criadoEm`, indicada (ou não) por `por`. */
const paciente = async (
  nome: string,
  opcoes: { criadoEm?: string; por?: string; clinicaId?: string; texto?: string } = {},
): Promise<string> =>
  umId(
    `INSERT INTO pacientes (clinica_id, nome, origem, indicado_por_id, indicado_por, criado_em)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      opcoes.clinicaId ?? clinica,
      nome,
      opcoes.por !== undefined || opcoes.texto !== undefined ? 'Indicação' : '',
      opcoes.por ?? null,
      opcoes.texto ?? '',
      opcoes.criadoEm ?? '2026-11-03T15:00:00Z',
    ],
  )

/** Uma tarefa concluída com recebimento: é o que N-19 diz que NÃO pode multiplicar. */
const recebimento = async (pacienteId: string, valor: bigint): Promise<void> => {
  const t = await umId(
    `INSERT INTO tarefas (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status,
                          concluida_em, paciente_id, tipo)
     VALUES ($1, $2, $2, 'fixture', '2026-11-04', 'concluida', '2026-11-04T15:00:00Z', $3,
             'Consulta realizada')
     RETURNING id`,
    [clinica, helena, pacienteId],
  )
  await migrate.query(
    `INSERT INTO recebimentos (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto,
                               recebido_em, registrado_por)
     VALUES ($1, $2, $3, 'Consulta realizada', $4, 'Pix', 0, '2026-11-04T15:00:00Z', $5)`,
    [clinica, pacienteId, t, valor.toString(), helena],
  )
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', (e) => console.error('[quem-mais-indica] migrate:', e.message))
  await migrate.connect()
  await declararAtorSistema(migrate)

  const hash = await hashDeSenha(SENHA)
  const montar = async (cod: string) => {
    const id = await umId(
      `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica Indica', $2) RETURNING id`,
      [cod, FUSO],
    )
    const perfil = async (chave: string, perms: string[]) =>
      umId(
        `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $2, $3) RETURNING id`,
        [id, chave, perms],
      )
    const pessoa = async (usuario: string, perfilId: string) =>
      umId(
        `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, admin, perfil_id)
         VALUES ($1, $2, $2, 'Equipe', $3, false, $4) RETURNING id`,
        [id, usuario, hash, perfilId],
      )
    return { id, perfil, pessoa }
  }
  const a = await montar(codigo)
  const b = await montar(`${codigo}-v`)
  clinica = a.id
  vizinha = b.id
  helena = await a.pessoa('helena', await a.perfil('pf_sup', ['painel', 'valores']))
  await a.pessoa('juliana', await a.perfil('pf_rec', ['pacientes', 'valores']))
  await a.pessoa('bruna', await a.perfil('pf_sem_valores', ['painel']))
  await b.pessoa('helena', await b.perfil('pf_sup', ['painel', 'valores']))

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(relogio)
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  const entrar = async (cod: string, u: string) => {
    const r = await srv().post('/v1/entrar').send({ clinica: cod, usuario: u, senha: SENHA }).expect(200)
    const v = r.headers['set-cookie'] as unknown
    return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  }
  gestao = await entrar(codigo, 'helena')
  semPainel = await entrar(codigo, 'juliana')
  painelSemValores = await entrar(codigo, 'bruna')
  gestaoVizinha = await entrar(`${codigo}-v`, 'helena')
})

afterAll(async () => {
  await apagarClinicaDeTeste(migrate, clinica)
  await apagarClinicaDeTeste(migrate, vizinha)
  await migrate.end()
  await app.close()
})

beforeEach(async () => {
  agora = new Date(INICIO)
  for (const c of [clinica, vizinha]) {
    await migrate.query('DELETE FROM recebimentos WHERE clinica_id = $1', [c])
    await migrate.query('DELETE FROM tarefas WHERE clinica_id = $1', [c])
    await migrate.query('DELETE FROM pacientes WHERE clinica_id = $1', [c])
  }
})

describe('quem vê', () => {
  it('sem `painel`: 403 (AB-B3-1)', async () => {
    expect((await srv().get('/v1/painel?periodo=mes').set('Cookie', semPainel)).status).toBe(403)
  })

  it('com `painel` e sem `valores`: 403, porque a dependência mora na tabela (L-B3-2)', async () => {
    expect((await srv().get('/v1/painel?periodo=mes').set('Cookie', painelSemValores)).status).toBe(
      403,
    )
  })
})

describe('o que conta', () => {
  it('uma indicada com 12 recebimentos conta 1 (N-19)', async () => {
    const maria = await paciente('Maria Indicadora', { criadoEm: '2026-01-10T15:00:00Z' })
    const carla = await paciente('Carla Indicada', { por: maria })
    for (let k = 0; k < 12; k++) await recebimento(carla, 10_000n)

    expect((await ver()).quemMaisIndica).toEqual([
      { pacienteId: maria, nome: 'Maria Indicadora', indicadas: 1 },
    ])
  })

  it('propriedade: para qualquer distribuição de recebimentos, conta as indicadas (N-19)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Até 3 indicadoras; cada uma com 0..3 indicadas; cada indicada com 0..3 recebimentos.
        fc.array(fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 3 }), {
          minLength: 1,
          maxLength: 3,
        }),
        async (distribuicao) => {
          await migrate.query('DELETE FROM recebimentos WHERE clinica_id = $1', [clinica])
          await migrate.query('DELETE FROM tarefas WHERE clinica_id = $1', [clinica])
          await migrate.query('DELETE FROM pacientes WHERE clinica_id = $1', [clinica])
          const esperado = new Map<string, number>()
          for (const [i, indicadas] of distribuicao.entries()) {
            const ind = await paciente(`Indicadora ${i}`, { criadoEm: '2026-01-01T15:00:00Z' })
            esperado.set(ind, indicadas.length)
            for (const [k, recebimentos] of indicadas.entries()) {
              const p = await paciente(`Indicada ${i}-${k}`, { por: ind })
              for (let n = 0; n < recebimentos; n++) await recebimento(p, 5_000n)
            }
          }
          const lido = new Map(
            (await ver()).quemMaisIndica.map((l) => [l.pacienteId, l.indicadas] as const),
          )
          for (const [id, n] of esperado) {
            // Quem não indicou ninguém não aparece; quem indicou, com o número exato.
            if (n === 0) expect(lido.has(id)).toBe(false)
            else expect(lido.get(id)).toBe(n)
          }
          expect(lido.size).toBe([...esperado.values()].filter((n) => n > 0).length)
        },
      ),
      { numRuns: 12 },
    )
  })

  it('só o vínculo por id; indicadora desativada sai; indicada desativada conta (L-B3-3, N-20)', async () => {
    const ana = await paciente('Ana Ativa', { criadoEm: '2026-01-10T15:00:00Z' })
    const ida = await paciente('Ida Desativada', { criadoEm: '2026-01-10T15:00:00Z' })
    await paciente('Indicada por texto', { texto: 'Ana Ativa' })
    const desativada = await paciente('Indicada Desativada', { por: ana })
    await paciente('Indicada Ativa', { por: ana })
    await paciente('Indicada da Ida', { por: ida })
    await migrate.query(
      'UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = ANY($1)',
      [[ida, desativada]],
    )

    const lista = (await ver()).quemMaisIndica
    expect(lista).toEqual([{ pacienteId: ana, nome: 'Ana Ativa', indicadas: 2 }])
  })

  it('a resposta não traz o nome de nenhuma indicada (L-B3-3)', async () => {
    const maria = await paciente('Maria Indicadora', { criadoEm: '2026-01-10T15:00:00Z' })
    await paciente('Zenaide Segredo', { por: maria })
    await paciente('Xuxa Segredo', { por: maria })
    const corpo = JSON.stringify(await ver())
    expect(corpo).toContain('Maria Indicadora')
    expect(corpo).not.toContain('Segredo')
  })

  it('cada clínica vê só as suas indicações (AB-B3-2, S-39)', async () => {
    const daqui = await paciente('Indicadora Daqui', { criadoEm: '2026-01-10T15:00:00Z' })
    await paciente('Indicada Daqui', { por: daqui })
    const dela = await paciente('Indicadora Dela', {
      clinicaId: vizinha,
      criadoEm: '2026-01-10T15:00:00Z',
    })
    await paciente('Indicada Dela', { por: dela, clinicaId: vizinha })

    expect((await ver()).quemMaisIndica.map((l) => l.nome)).toEqual(['Indicadora Daqui'])
    expect((await ver('periodo=mes', gestaoVizinha)).quemMaisIndica.map((l) => l.nome)).toEqual([
      'Indicadora Dela',
    ])
  })
})

describe('a janela e a ordem', () => {
  it('bordas semiabertas pelo cadastro, no fuso da clínica (N-20, regra 23)', async () => {
    const maria = await paciente('Maria', { criadoEm: '2026-01-10T15:00:00Z' })
    // 01/11 00:00 em São Paulo = 03:00 UTC: entra.
    await paciente('Borda inicial', { por: maria, criadoEm: '2026-11-01T03:00:00Z' })
    // 31/10 23:59:59 em São Paulo: fica fora.
    await paciente('Antes', { por: maria, criadoEm: '2026-11-01T02:59:59Z' })
    // 10/11 23:59:59 em São Paulo: entra.
    await paciente('Borda final', { por: maria, criadoEm: '2026-11-11T02:59:59Z' })
    // 11/11 00:00 em São Paulo: fica fora.
    await paciente('Depois', { por: maria, criadoEm: '2026-11-11T03:00:00Z' })

    const l = (await ver('periodo=per&de=2026-11-01&ate=2026-11-10')).quemMaisIndica
    expect(l).toEqual([{ pacienteId: maria, nome: 'Maria', indicadas: 2 }])
  })

  it('o relógio do servidor já no dia seguinte em UTC: o "hoje" é o da clínica', async () => {
    // 11/11 01:30 UTC = 10/11 22:30 em São Paulo. "7 dias" termina em 10/11.
    agora = new Date('2026-11-11T01:30:00Z')
    const maria = await paciente('Maria', { criadoEm: '2026-01-10T15:00:00Z' })
    await paciente('Cadastrada às 22h', { por: maria, criadoEm: '2026-11-11T01:00:00Z' })
    const p = await ver('periodo=7d')
    expect(p.periodo.ate).toBe('2026-11-10')
    expect(p.quemMaisIndica).toEqual([{ pacienteId: maria, nome: 'Maria', indicadas: 1 }])
  })

  it('desempate fixo: mais indicadas primeiro, depois o nome; a mesma ordem em 10 leituras (N-21)', async () => {
    // Inseridas FORA da ordem do nome, para que a ordem física não acerte por acaso.
    const nomes = ['Wanda', 'Beatriz', 'Ofélia', 'Ana', 'Lúcia', 'Carmem']
    const ids = new Map<string, string>()
    for (const n of nomes) ids.set(n, await paciente(n, { criadoEm: '2026-01-10T15:00:00Z' }))
    // Ofélia indica 3; as outras, 1 cada.
    for (const n of nomes) {
      const quantas = n === 'Ofélia' ? 3 : 1
      for (let k = 0; k < quantas; k++) await paciente(`${n} indicou ${k}`, { por: ids.get(n)! })
    }
    const esperado = ['Ofélia', 'Ana', 'Beatriz', 'Carmem', 'Lúcia', 'Wanda']
    for (let k = 0; k < 10; k++) {
      expect((await ver()).quemMaisIndica.map((l) => l.nome)).toEqual(esperado)
    }
  })

  it('no máximo 10 (L-B3-3)', async () => {
    for (let i = 0; i < 12; i++) {
      const ind = await paciente(`Indicadora ${String(i).padStart(2, '0')}`, {
        criadoEm: '2026-01-10T15:00:00Z',
      })
      await paciente(`Indicada ${i}`, { por: ind })
    }
    const l = (await ver()).quemMaisIndica
    expect(l).toHaveLength(10)
    expect(l[9]!.nome).toBe('Indicadora 09')
  })
})

describe('sem cópia persistida (L-B3-5)', () => {
  /**
   * O ranking é calculado na leitura. A carteira e o portal leem métricas
   * próprias (`metricas-diarias`, `uso_diario_cliente`), e nenhum arquivo
   * deles pode conhecer o vínculo de indicação nem o bloco.
   */
  it('nenhum código da carteira ou do portal lê `indicado_por_id` ou `quemMaisIndica`', () => {
    const aqui = dirname(fileURLToPath(import.meta.url))
    const arquivos = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n)
        return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.ts') ? [p] : []
      })
    const alvos = [join(aqui, '..', 'carteira'), join(aqui, '..', 'portal')].flatMap((d) => {
      try {
        return arquivos(d)
      } catch {
        return []
      }
    })
    expect(alvos.length).toBeGreaterThan(0)
    for (const f of alvos) {
      const texto = readFileSync(f, 'utf8')
      expect(texto, f).not.toMatch(/indicado_por_id|quemMaisIndica|indicadoPorId/)
    }
  })
})
