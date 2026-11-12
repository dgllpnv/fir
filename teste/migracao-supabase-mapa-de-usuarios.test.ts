import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { executarCarga } from '../infra/migracao-supabase/banco'
import { aplicarMapaDeUsuarios, conferirAlvoDaSegundaPassadaEmProducao, relatorioDoMapaDeUsuarios } from '../infra/migracao-supabase/mapa-de-usuarios'
import { idDe, lerDumpDeTexto, type Dump } from '../infra/migracao-supabase/nucleo'

/**
 * Segunda passada da migração: mapa de usuários. Postgres LOCAL real, dado 100% SINTÉTICO.
 * O repositório é público; as sentinelas só provam que nenhum dado vaza na saída.
 */
const URL_MIG = process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'
const p = randomBytes(4).toString('hex')
const S = (x: string): string => `Sentinela ${x} ${p}`

const reg = (colecao: string, id: string, data: Record<string, unknown>, cliente_id: string | null = null) => ({
  id, colecao, cliente_id, atualizado_em: '2026-11-01T00:00:00Z', atualizado_por: 'x', data,
})
const csvDe = (dado: unknown): string => `dump\r\n"${JSON.stringify(dado).replace(/"/g, '""')}"`

const c1 = `${p}-c1`
const tarefa = (n: number, extra: Record<string, unknown>, cliente: string | null): ReturnType<typeof reg> =>
  reg('tarefas', `${p}-t${n}`, { titulo: S(`Tarefa ${n}`), descricao: '', cliente_id: cliente ?? '', prazo: '2026-11-09', status: 'pendente', prioridade: 'normal', recorrencia: 'nenhuma', concluida_em: '', ...extra }, cliente)

function dumpSintetico(): Dump {
  const docs = [
    reg('clientes', c1, { nome: S('Cliente 1'), produto: 'Gestão por Assinatura', status: 'ativo', colaboradora_id: 'u1' }),
    reg('rotinas', `${p}-r1`, { titulo: S('Rotina mensal'), frequencia: 'mensal', dia_util: 3, inicio: '2026-11-03', prioridade: 'normal', por_cliente: 'nao', frentes: 'nao', envio: 'nao', passos: ['a'], responsavel_id: 'u2', antecedencia: 0, dia_semana: '' }),
    tarefa(1, { responsavel_id: 'u1', solicitante_id: 'u1' }, null),
    tarefa(2, { responsavel_id: 'u3', solicitante_id: 'u1' }, c1),
    tarefa(3, { responsavel_id: 'u2', solicitante_id: '' }, c1),
    tarefa(4, { responsavel_id: '', solicitante_id: '' }, null),
  ]
  const json = JSON.stringify({ registros: docs, historico: [], acessos_cliente: [], auth_users: [], storage_objects: [] })
  return lerDumpDeTexto(`dump\r\n"${json.replace(/"/g, '""')}"`)
}

let migrate: pg.Client
let grupoId: string
let grupoOutroId: string
let cargaId: string
let userA: string
let userB: string
let userC: string
let dump: Dump
const saidas: string[] = []

const q = async <T = Record<string, unknown>>(sql: string, v: unknown[] = []): Promise<T[]> => (await migrate.query(sql, v)).rows as T[]
const resp = async (tabela: string, coluna: string, colecao: string, idOrigem: string): Promise<string | null> => {
  const r = await q<{ v: string | null }>(`SELECT "${coluna}"::text AS v FROM ${tabela} WHERE id = $1`, [idDe(colecao, idOrigem)])
  return r[0]!.v
}
const novoUsuario = async (rotulo: string, ativo = true): Promise<string> =>
  (await q<{ id: string }>(`INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, ativo) VALUES ($1, $2, '!', 'geral', $3) RETURNING id::text AS id`, [`${rotulo}.${p}`, `Pessoa ${rotulo}`, ativo]))[0]!.id

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', () => undefined)
  await migrate.connect()
  await migrate.query(`SELECT set_config('app.pessoa_id', 'sistema', false)`)
  grupoId = (await q<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id::text AS id`, [`Grupo mapa-usuarios ${p}`]))[0]!.id
  grupoOutroId = (await q<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id::text AS id`, [`Grupo mapa-usuarios outro ${p}`]))[0]!.id
  cargaId = (await q<{ id: string }>(`INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, ativo) VALUES ($1, 'Carga do sistema anterior', '!', 'geral', false) RETURNING id::text AS id`, [`carga.${p}`]))[0]!.id
  userA = await novoUsuario('a')
  userB = await novoUsuario('b')
  userC = await novoUsuario('c')
  dump = dumpSintetico()
  // a carga roda SEM mapa: responsável e solicitante entram NULL, como em produção
  const r = await executarCarga(migrate, dump, { grupoId, usuarioCargaId: cargaId })
  expect(r.commitado).toBe(true)
})

afterAll(async () => {
  if (!migrate) return
  const apagar = async (sql: string, v: unknown[]): Promise<void> => {
    await migrate.query(sql, v).catch(() => undefined)
  }
  for (const t of ['itens_de_tarefa_interna', 'tarefas_internas', 'rotinas_internas', 'clientes_carteira']) await apagar(`DELETE FROM ${t} WHERE grupo_id = $1`, [grupoId])
  for (const u of [cargaId, userA, userB, userC]) await apagar('DELETE FROM usuarios_gestao WHERE id = $1', [u])
  await apagar('DELETE FROM grupos WHERE id = ANY($1::uuid[])', [[grupoId, grupoOutroId]])
  await migrate.end()
})

const col = (r: Awaited<ReturnType<typeof aplicarMapaDeUsuarios>>, nome: string) => r.colunas.find((c) => c.coluna.endsWith(nome))!

describe('segunda passada: mapa de usuários', () => {
  it('estado de partida: a carga sem mapa deixou os campos de usuário NULL', async () => {
    expect(await resp('clientes_carteira', 'responsavel_usuario_gestao_id', 'clientes', c1)).toBeNull()
    expect(await resp('tarefas_internas', 'responsavel_usuario_gestao_id', 'tarefas', `${p}-t1`)).toBeNull()
  })

  it('simulação: mesma conferência, mas sempre ROLLBACK (nada muda)', async () => {
    const r = await aplicarMapaDeUsuarios(migrate, dump, { grupoId, mapaUsuarios: { u1: userA, u2: userB }, simular: true })
    expect(r.simulacao).toBe(true)
    expect(r.commitado).toBe(false)
    expect(r.atualizacoes).toBeGreaterThan(0)
    expect(r.colunas.every((c) => c.ok)).toBe(true)
    expect(await resp('tarefas_internas', 'responsavel_usuario_gestao_id', 'tarefas', `${p}-t1`)).toBeNull()
  })

  it('preenche só NULL, não sobrescreve quem já tem, e relata o que não tem correspondência (mapa incompleto: u3)', async () => {
    // alguém já atribuiu a tarefa 3 ao usuário C na clínica: o mapa (u2 -> B) NÃO pode sobrescrever
    await q(`UPDATE tarefas_internas SET responsavel_usuario_gestao_id = $1 WHERE id = $2`, [userC, idDe('tarefas', `${p}-t3`)])
    const r = await aplicarMapaDeUsuarios(migrate, dump, { grupoId, mapaUsuarios: { u1: userA, u2: userB, u9: userC }, simular: false })
    saidas.push(relatorioDoMapaDeUsuarios(r).join('\n'))
    expect(r.commitado).toBe(true)
    expect(r.colunas.every((c) => c.ok)).toBe(true)

    const cli = col(r, 'clientes_carteira.responsavel_usuario_gestao_id')
    expect(cli).toMatchObject({ referenciasNaOrigem: 1, nulosAntes: 1, preenchidos: 1, semMapa: 0, nulosDepois: 0 })
    const rot = col(r, 'rotinas_internas.responsavel_usuario_gestao_id')
    expect(rot).toMatchObject({ referenciasNaOrigem: 1, preenchidos: 1, semMapa: 0 })
    const tr = col(r, 'tarefas_internas.responsavel_usuario_gestao_id')
    // t1 (u1) preenchida; t2 (u3) sem mapa; t3 já tinha dono: preservada, difere do mapa; t4 sem referência
    expect(tr).toMatchObject({ referenciasNaOrigem: 3, nulosAntes: 2, jaPreenchidos: 1, preenchidos: 1, semMapa: 1, preservadosDiferentesDoMapa: 1, nulosDepois: 1 })
    const so = col(r, 'tarefas_internas.solicitante_usuario_gestao_id')
    expect(so).toMatchObject({ referenciasNaOrigem: 2, preenchidos: 2, semMapa: 0 })
    expect(r.origensSemMapa).toEqual([{ ordinal: 3, referencias: 1 }])
    expect(r.chavesDoMapaSemUso).toBe(1) // u9

    expect(await resp('clientes_carteira', 'responsavel_usuario_gestao_id', 'clientes', c1)).toBe(userA)
    expect(await resp('rotinas_internas', 'responsavel_usuario_gestao_id', 'rotinas', `${p}-r1`)).toBe(userB)
    expect(await resp('tarefas_internas', 'responsavel_usuario_gestao_id', 'tarefas', `${p}-t1`)).toBe(userA)
    expect(await resp('tarefas_internas', 'responsavel_usuario_gestao_id', 'tarefas', `${p}-t2`)).toBeNull() // não adivinhado
    expect(await resp('tarefas_internas', 'responsavel_usuario_gestao_id', 'tarefas', `${p}-t3`)).toBe(userC) // não sobrescrito
    expect(await resp('tarefas_internas', 'solicitante_usuario_gestao_id', 'tarefas', `${p}-t2`)).toBe(userA)
    expect(await resp('tarefas_internas', 'solicitante_usuario_gestao_id', 'tarefas', `${p}-t3`)).toBeNull() // origem vazia
  })

  it('idempotente: a 2ª e a 3ª execução atualizam 0 linhas e o estado não muda', async () => {
    const foto = async (): Promise<string> => JSON.stringify(await q(`SELECT id::text, responsavel_usuario_gestao_id::text, solicitante_usuario_gestao_id::text FROM tarefas_internas WHERE grupo_id = $1 ORDER BY id`, [grupoId]))
    const antes = await foto()
    for (let i = 0; i < 2; i++) {
      const r = await aplicarMapaDeUsuarios(migrate, dump, { grupoId, mapaUsuarios: { u1: userA, u2: userB } })
      saidas.push(relatorioDoMapaDeUsuarios(r).join('\n'))
      expect(r.atualizacoes).toBe(0)
      expect(r.commitado).toBe(true)
      expect(r.colunas.every((c) => c.preenchidos === 0 && c.ok)).toBe(true)
    }
    expect(await foto()).toBe(antes)
  })

  it('completar o mapa depois preenche o que ficou sem correspondência, e só isso', async () => {
    const r = await aplicarMapaDeUsuarios(migrate, dump, { grupoId, mapaUsuarios: { u1: userA, u2: userB, u3: userC } })
    expect(r.atualizacoes).toBe(1)
    expect(await resp('tarefas_internas', 'responsavel_usuario_gestao_id', 'tarefas', `${p}-t2`)).toBe(userC)
    expect(await resp('tarefas_internas', 'responsavel_usuario_gestao_id', 'tarefas', `${p}-t3`)).toBe(userC)
    expect(r.origensSemMapa).toEqual([])
  })

  it('nunca cria conta, linha ou registro de carga: contagens iguais antes e depois', async () => {
    const n = async (): Promise<string> => JSON.stringify(await q(`SELECT (SELECT count(*) FROM usuarios_gestao)::int AS u, (SELECT count(*) FROM tarefas_internas WHERE grupo_id = $1)::int AS t, (SELECT count(*) FROM clientes_carteira WHERE grupo_id = $1)::int AS c`, [grupoId]))
    const antes = await n()
    await aplicarMapaDeUsuarios(migrate, dump, { grupoId, mapaUsuarios: { u1: userA } })
    expect(await n()).toBe(antes)
  })

  it('a saída só tem contagens e códigos: nenhuma sentinela de dado, nenhum id de origem ou de usuário', () => {
    const t = saidas.join('\n')
    expect(t.length).toBeGreaterThan(0)
    for (const s of [p, 'Sentinela', userA, userB, userC, 'Pessoa', 'u1', 'u2', 'u3']) expect(t).not.toContain(s)
    expect(t).toMatch(/origem#3 sem correspondencia no mapa: 1 referencias/)
  })

  it('recusas antes de tocar em qualquer linha, só com códigos', async () => {
    const f = async (mapa: Record<string, string>, g = grupoId): Promise<string> => {
      try {
        await aplicarMapaDeUsuarios(migrate, dump, { grupoId: g, mapaUsuarios: mapa })
        return 'passou'
      } catch (e) {
        return e instanceof Error ? e.message : 'x'
      }
    }
    expect(await f({})).toBe('erro_de_carga:mapa_de_usuarios_vazio')
    expect(await f({ u1: 'nao-e-uuid' })).toBe('erro_de_carga:mapa_usuarios_com_destino_que_nao_e_uuid')
    expect(await f({ u1: '00000000-0000-4000-8000-000000000000' })).toBe('erro_de_carga:mapa_usuarios_aponta_para_usuario_inexistente')
    const inativo = await novoUsuario('inativo', false)
    expect(await f({ u1: inativo })).toBe('erro_de_carga:mapa_usuarios_destino_inativo_ou_de_outro_grupo')
    await q('DELETE FROM usuarios_gestao WHERE id = $1', [inativo])
    expect(await f({ u1: userA }, '00000000-0000-4000-8000-000000000000')).toBe('erro_de_carga:grupo_inexistente_ou_inativo')
  })

  it('não toca linha de outro grupo, mesmo com o mesmo id de origem', async () => {
    const r = await aplicarMapaDeUsuarios(migrate, dump, { grupoId: grupoOutroId, mapaUsuarios: { u1: userA } })
    expect(r.atualizacoes).toBe(0)
    expect(r.colunas.every((c) => c.semLinhaNoDestino === c.referenciasNaOrigem && c.ok)).toBe(true)
  })

  it('divergência desfaz tudo: um UPDATE que o banco aceita mas que a conferência não explica dá ROLLBACK', async () => {
    // cliente que, entre a leitura e a escrita, ganha dono por outra via, simulado por um cliente SQL que o faz no UPDATE
    await q(`UPDATE tarefas_internas SET responsavel_usuario_gestao_id = NULL WHERE id = $1`, [idDe('tarefas', `${p}-t1`)])
    const adulterado = {
      query: async (texto: string, valores?: readonly unknown[]) => {
        if (texto.startsWith('UPDATE tarefas_internas') && texto.includes('responsavel_usuario_gestao_id')) {
          await migrate.query(texto, valores as unknown[])
          return { rows: [], rowCount: 0 } // mente: o conferido não bate com o gravado
        }
        return migrate.query(texto, valores as unknown[])
      },
    }
    const r = await aplicarMapaDeUsuarios(adulterado, dump, { grupoId, mapaUsuarios: { u1: userA, u2: userB, u3: userC } })
    expect(r.commitado).toBe(false)
    expect(r.colunas.some((c) => !c.ok)).toBe(true)
    expect(await resp('tarefas_internas', 'responsavel_usuario_gestao_id', 'tarefas', `${p}-t1`)).toBeNull()
  })
})

describe('travas do modo de produção', () => {
  it('exige o nome do banco repetido e recusa o papel de carga (que não tem UPDATE e não deve ganhar)', () => {
    const codigo = (a: Parameters<typeof conferirAlvoDaSegundaPassadaEmProducao>[0]): string => {
      try {
        conferirAlvoDaSegundaPassadaEmProducao(a)
        return 'passou'
      } catch (e) {
        return e instanceof Error ? e.message : 'x'
      }
    }
    expect(codigo({ banco: 'fir', usuario: 'fir_migrate', confirmaBanco: undefined })).toBe('erro_de_carga:producao_sem_confirmar_o_nome_do_banco')
    expect(codigo({ banco: 'fir', usuario: 'fir_migrate', confirmaBanco: 'outro' })).toBe('erro_de_carga:producao_sem_confirmar_o_nome_do_banco')
    expect(codigo({ banco: 'fir', usuario: 'migracao_carteira', confirmaBanco: 'fir' })).toBe('erro_de_carga:segunda_passada_exige_o_dono_do_esquema_nao_o_papel_de_carga')
    expect(codigo({ banco: 'fir', usuario: 'fir_migrate', confirmaBanco: 'fir' })).toBe('passou')
  })
})
