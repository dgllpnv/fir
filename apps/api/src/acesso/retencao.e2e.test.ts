import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashDeSenha } from '../autenticacao/senha'
import { BancoService } from '../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import { apagarClinicaDeTeste, declararAtorSistema } from '../banco/limpeza-de-teste'
import { executarRetencaoDoAcesso, purgarAcessoDaClinica } from './retencao'

/**
 * A RETENÇÃO DO ACESSO POR E-MAIL (LGPD L5 e L6; `retencao.md`), sobre o
 * Postgres real: `links_de_acesso` some 30 dias depois do último entre prazo,
 * uso e invalidação; `eventos_de_acesso`, com 1 ano. A `auditoria` não perde
 * nada.
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const DIA = 86_400_000

let migrate: pg.Client
const banco = new BancoService()
const sufixo = randomBytes(4).toString('hex')
let clinicaA: string
let clinicaB: string
let pessoaA: string
let pessoaB: string

const agora = new Date()
const relogio = { agora: () => agora }
const antes = (dias: number, ms = 0) => new Date(agora.getTime() - dias * DIA - ms)
const hex64 = () => createHash('sha256').update(randomBytes(16)).digest('hex')

/** Um link com os instantes escolhidos; o id volta para o teste conferir. */
async function link(
  clinica: string,
  pessoa: string,
  o: { criado: Date; expira: Date; usado?: Date; invalidado?: Date; finalidade?: string },
): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO links_de_acesso
       (clinica_id, pessoa_id, finalidade, email_hmac, token_hash, criado_em, expira_em, usado_em, invalidado_em)
     VALUES ($1, $2, $9, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      clinica,
      pessoa,
      hex64(),
      hex64(),
      o.criado,
      o.expira,
      o.usado ?? null,
      o.invalidado ?? null,
      // Um link VIVO por pessoa e finalidade (appsec 6): o vencido sem uso
      // ocupa a vaga, e o vivo de verdade vai noutra finalidade.
      o.finalidade ?? 'redefinicao',
    ],
  )
  return r.rows[0]!.id
}

async function evento(clinica: string, pessoa: string, em: Date): Promise<string> {
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO eventos_de_acesso (clinica_id, pessoa_id, evento, em)
     VALUES ($1, $2, 'email_confirmado', $3) RETURNING id`,
    [clinica, pessoa, em],
  )
  return r.rows[0]!.id
}

const existem = async (tabela: 'links_de_acesso' | 'eventos_de_acesso', ids: string[]) =>
  (
    await migrate.query<{ id: string }>(`SELECT id FROM ${tabela} WHERE id = ANY($1::uuid[])`, [ids])
  ).rows
    .map((r) => r.id)
    .sort()

const trilha = async (clinica: string) =>
  Number(
    (await migrate.query<{ n: string }>('SELECT count(*) AS n FROM auditoria WHERE clinica_id = $1', [clinica]))
      .rows[0]!.n,
  )

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  const hash = await hashDeSenha('senha-de-teste-longa')
  for (const lado of ['a', 'b'] as const) {
    const c = (
      await migrate.query<{ id: string }>(
        'INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id',
        [`ret-${lado}-${sufixo}`, `Clínica ${lado}`],
      )
    ).rows[0]!.id
    const p = (
      await migrate.query<{ id: string }>(
        `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, admin)
         VALUES ($1, 'Helena Souza', 'helena', $2, true) RETURNING id`,
        [c, hash],
      )
    ).rows[0]!.id
    if (lado === 'a') {
      clinicaA = c
      pessoaA = p
    } else {
      clinicaB = c
      pessoaB = p
    }
  }
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  for (const id of [clinicaA, clinicaB]) await apagarClinicaDeTeste(migrate, id)
  await migrate.end()
  await banco.onModuleDestroy()
})

describe('purga do acesso por e-mail (LGPD L5, L6)', () => {
  it('apaga o vencido, guarda o recente, a segunda rodada não apaga nada, e a outra clínica não é tocada', async () => {
    const velhos = {
      // Usado há 31 dias: o último instante é o prazo, que era 1 hora depois.
      usado: await link(clinicaA, pessoaA, { criado: antes(32), expira: antes(31), usado: antes(32, -60_000) }),
      invalidado: await link(clinicaA, pessoaA, { criado: antes(40), expira: antes(39), invalidado: antes(39, 1) }),
      // Vencido sem uso nem invalidação também conta (do prazo).
      vencido: await link(clinicaA, pessoaA, { criado: antes(45), expira: antes(44) }),
    }
    const recentes = {
      // Usado há 29 dias: ainda dentro dos 30.
      usado: await link(clinicaA, pessoaA, { criado: antes(30), expira: antes(29), usado: antes(29, 1000) }),
      // Criado há 60 dias, mas invalidado ontem: conta do ÚLTIMO instante.
      invalidadoTarde: await link(clinicaA, pessoaA, {
        criado: antes(60),
        expira: antes(59),
        invalidado: antes(1),
      }),
      // Vivo: prazo no futuro.
      vivo: await link(clinicaA, pessoaA, {
        criado: antes(0, 60_000),
        expira: new Date(agora.getTime() + DIA),
        finalidade: 'confirmacao_de_email',
      }),
    }
    const eventoVelho = await evento(clinicaA, pessoaA, antes(366))
    const eventoRecente = await evento(clinicaA, pessoaA, antes(364))

    // A outra clínica tem o MESMO perfil de linhas velhas.
    const linkDeB = await link(clinicaB, pessoaB, { criado: antes(45), expira: antes(44) })
    const eventoDeB = await evento(clinicaB, pessoaB, antes(400))

    const trilhaDeBAntes = await trilha(clinicaB)
    const trilhaDeAAntes = await trilha(clinicaA)

    const r = await purgarAcessoDaClinica(banco, clinicaIdDeFonteConfiavel(clinicaA), agora)
    expect(r).toEqual({ links: 3, eventos: 1 })

    expect(await existem('links_de_acesso', Object.values(velhos))).toEqual([])
    expect(await existem('links_de_acesso', Object.values(recentes))).toEqual(Object.values(recentes).sort())
    expect(await existem('eventos_de_acesso', [eventoVelho, eventoRecente])).toEqual([eventoRecente])

    // A outra clínica: nada.
    expect(await existem('links_de_acesso', [linkDeB])).toEqual([linkDeB])
    expect(await existem('eventos_de_acesso', [eventoDeB])).toEqual([eventoDeB])
    expect(await trilha(clinicaB)).toBe(trilhaDeBAntes)

    // A trilha não perde linha: ela GANHA o registro de cada link apagado.
    expect(await trilha(clinicaA)).toBe(trilhaDeAAntes + 3)
    const apagados = await migrate.query<{ de: Record<string, unknown> }>(
      `SELECT de FROM auditoria
        WHERE clinica_id = $1 AND entidade = 'links_de_acesso' AND acao = 'removeu' AND entidade_id = ANY($2::text[])`,
      [clinicaA, Object.values(velhos)],
    )
    expect(apagados.rows).toHaveLength(3)
    for (const l of apagados.rows) {
      expect(l.de['token_hash']).toBe('[oculto]')
      expect(l.de['email_hmac']).toBe('[oculto]')
    }

    // Reentrante: a segunda rodada é um no-op.
    expect(await purgarAcessoDaClinica(banco, clinicaIdDeFonteConfiavel(clinicaA), agora)).toEqual({
      links: 0,
      eventos: 0,
    })
    expect(await trilha(clinicaA)).toBe(trilhaDeAAntes + 3)
  })

  it('em lote: com lote 2, cinco linhas velhas saem todas, em três voltas', async () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push(await evento(clinicaA, pessoaA, antes(400 + i)))
    const r = await purgarAcessoDaClinica(banco, clinicaIdDeFonteConfiavel(clinicaA), agora, 2)
    expect(r.eventos).toBe(5)
    expect(await existem('eventos_de_acesso', ids)).toEqual([])
  })

  it('o job percorre todas as clínicas, e roda duas vezes sem efeito na segunda', async () => {
    const deA = await evento(clinicaA, pessoaA, antes(500))
    const deB = await evento(clinicaB, pessoaB, antes(500))
    const linkDeB = await link(clinicaB, pessoaB, { criado: antes(90), expira: antes(89), invalidado: antes(89, 1) })

    const r = await executarRetencaoDoAcesso(banco, relogio)
    expect(r.falhas).toEqual([])
    expect(await existem('eventos_de_acesso', [deA, deB])).toEqual([])
    expect(await existem('links_de_acesso', [linkDeB])).toEqual([])

    const antesDaSegunda = await trilha(clinicaB)
    await executarRetencaoDoAcesso(banco, relogio)
    expect(await trilha(clinicaB)).toBe(antesDaSegunda)
  })

  it('um relógio adiantado não antecipa a purga: o corte é o menor entre ele e o do banco', async () => {
    const recente = await evento(clinicaA, pessoaA, antes(10))
    const futuro = new Date(agora.getTime() + 400 * DIA)
    expect((await purgarAcessoDaClinica(banco, clinicaIdDeFonteConfiavel(clinicaA), futuro)).eventos).toBe(0)
    expect(await existem('eventos_de_acesso', [recente])).toEqual([recente])
  })

  it('banco: fir_app não ganhou DELETE, e a função sem clínica fixada recusa', async () => {
    const r = await migrate.query<{ l: boolean; e: boolean; f: boolean }>(
      `SELECT has_table_privilege('fir_app', 'links_de_acesso', 'DELETE') AS l,
              has_table_privilege('fir_app', 'eventos_de_acesso', 'DELETE') AS e,
              has_function_privilege('public', 'purgar_acesso_vencido(timestamptz, integer)', 'EXECUTE') AS f`,
    )
    expect(r.rows[0]).toEqual({ l: false, e: false, f: false })
    await expect(
      banco.semIsolamentoDeClinica('SELECT * FROM purgar_acesso_vencido(now(), 100)'),
    ).rejects.toThrow(/sem clínica fixada/)
  })
})
