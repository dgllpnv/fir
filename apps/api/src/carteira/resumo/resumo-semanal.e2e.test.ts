import type { ResumoSemanalSaida } from '@fir/contracts'
import { Dinheiro, RelogioFixo } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { RELOGIO } from '../../comum/relogio'
import { registrarCookie } from '../../main'

/**
 * **G8 3C — `GET /v1/carteira/resumo/semanal`, pela HTTP, contra Postgres real.**
 *
 *  1. Sem sessão, 404. Sem o módulo `resumo`, 403. `escopo = 'grupo'`, 403
 *     (a chave é "só escopo geral", A-5) — o isolamento por grupo começa aqui.
 *  2. "Só a minha carteira" (A-3): cada pessoa vê só os clientes dela, e as
 *     ações, campanhas e tarefas desses clientes (ajuste 35).
 *  3. Redação na MONTAGEM (A-14, T-20): sem `valores`, nenhum "R$" e nenhum
 *     valor monetário do cenário no texto — nem a mensalidade, nem o MRR, nem
 *     o resultado ou a meta da campanha de receita.
 *  4. A semana no fuso da carteira (regras 22-23): conclusão às 23:59 de
 *     domingo, hora da Bahia, fica fora; às 00:00 de segunda, dentro.
 *  5. Três leituras devolvem o mesmo texto e não escrevem nada de negócio;
 *     cada uma registra o acesso à ata citada (regra 18).
 *
 * O banco é compartilhado com os outros e2e: as contagens exatas são feitas
 * por usuários com `carteira = 'minha'`, que só enxergam o próprio cenário.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

// Quinta-feira, 05/11/2026, 12:00 na Bahia. A semana é 02/11 a 08/11.
const AGORA = new Date('2026-11-05T15:00:00Z')
const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')
const MENSALIDADE_SECRETA = 123456n // R$ 1.234,56
const RECEITA_SECRETA = 987654n // R$ 9.876,54
const META_SECRETA = 1500000n // R$ 15.000,00

let app: NestFastifyApplication
let migrate: pg.Client
let grupoA: string
let grupoB: string
const usuarios: Record<string, string> = {}
const clientes: Record<string, string> = {}
const cookies: Record<string, string> = {}

const http = () => request(app.getHttpServer())

const cookieDe = (r: { headers: Record<string, string> }): string => {
  const v = r.headers['set-cookie'] as unknown
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  return lista.map((c) => c.split(';')[0]!).join('; ')
}

const novoUsuario = async (
  chave: string,
  nome: string,
  extra: { escopo?: 'geral' | 'grupo'; grupo?: string | null; valores?: boolean; carteira?: 'minha' | 'todos'; modulos?: string[] },
) => {
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, valores, carteira, modulos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, coalesce($8::text[], ARRAY['painel','rotina','clientes','firclinic','metas','campanhas','resumo','prospeccao','cadastros']))
       RETURNING id`,
      [
        `resumo.${chave}.${sufixo}`,
        nome,
        await hashDeSenha(SENHA),
        extra.escopo ?? 'geral',
        extra.grupo ?? null,
        extra.valores ?? false,
        extra.carteira ?? 'todos',
        extra.modulos ?? null,
      ],
    )
  ).rows[0]!.id
  usuarios[chave] = id
  return id
}

const novoCliente = async (chave: string, grupo: string, nome: string, responsavel: string, mensalidade: bigint, status = 'ativo') => {
  clientes[chave] = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, nome, produto, status, responsavel_usuario_gestao_id, mensalidade_centavos)
       VALUES ($1, $2, 'Consultoria', $3, $4, $5) RETURNING id`,
      [grupo, nome, status, responsavel, mensalidade.toString()],
    )
  ).rows[0]!.id
  return clientes[chave]
}

const reuniao = (cliente: string, grupo: string, por: string, data: string, resumo: string, enc: string | null, saude: string) =>
  migrate.query(
    `INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, encaminhamentos, saude_registrada, por_usuario_gestao_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [cliente, grupo, data, resumo, enc, saude, por],
  )

const acao = (cliente: string, grupo: string, por: string, status: string, prazo: string | null, concluidaEm: string | null) =>
  migrate.query(
    `INSERT INTO acoes_do_plano (cliente_carteira_id, grupo_id, titulo, status, prazo, concluida_em, criado_por)
     VALUES ($1, $2, 'Ação', $3, $4, $5, $6)`,
    [cliente, grupo, status, prazo, concluidaEm, por],
  )

const entrar = async (chave: string) => {
  cookies[chave] = cookieDe(
    await http().post('/v1/carteira/entrar').send({ usuario: `resumo.${chave}.${sufixo}`, senha: SENHA }).expect(200),
  )
}

const resumo = async (chave: string): Promise<ResumoSemanalSaida> =>
  (await http().get('/v1/carteira/resumo/semanal').set('Cookie', cookies[chave]!).expect(200)).body as ResumoSemanalSaida

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupoA = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Resumo A ${sufixo}`])).rows[0]!.id
  grupoB = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Resumo B ${sufixo}`])).rows[0]!.id

  const marta = await novoUsuario('marta', `Marta ${sufixo}`, { valores: true, carteira: 'minha' })
  const nina = await novoUsuario('nina', `Nina ${sufixo}`, { valores: false, carteira: 'minha' })
  await novoUsuario('geral', `Geral ${sufixo}`, { valores: true, carteira: 'todos' })
  await novoUsuario('dogrupo', `Do grupo ${sufixo}`, { escopo: 'grupo', grupo: grupoA, valores: true })
  await novoUsuario('semmodulo', `Sem módulo ${sufixo}`, { modulos: ['clientes', 'rotina'] })

  // Marta: um crítico com ata, um bom com mensalidade, um pausado com ação atrasada.
  const sol = await novoCliente('sol', grupoA, `Sol ${sufixo}`, marta, 150000n)
  const lua = await novoCliente('lua', grupoA, `Lua ${sufixo}`, marta, 99999n)
  const pausa = await novoCliente('pausa', grupoA, `Pausa ${sufixo}`, marta, 0n, 'pausado')
  await reuniao(sol, grupoA, marta, '2026-10-01', 'Ata antiga', 'Nada', 'bom')
  await reuniao(sol, grupoA, marta, '2026-10-29', `Agenda vazia ${sufixo}.`, 'Rever preços', 'critico')
  await reuniao(lua, grupoA, marta, '2026-10-30', 'Tudo em dia.', null, 'bom')
  // Duas ações atrasadas no Sol, uma no pausado.
  await acao(sol, grupoA, marta, 'pendente', '2026-11-01', null)
  await acao(sol, grupoA, marta, 'em_andamento', '2026-11-04', null)
  await acao(pausa, grupoA, marta, 'pendente', '2026-10-20', null)
  // Bordas da semana no fuso da Bahia (UTC−3): 01/11 23:59 fica fora; 02/11 00:00 entra.
  await acao(lua, grupoA, marta, 'concluida', null, '2026-11-02T02:59:00Z')
  await acao(lua, grupoA, marta, 'concluida', null, '2026-11-02T03:00:00Z')
  await acao(lua, grupoA, marta, 'concluida', null, '2026-11-04T18:00:00Z')
  // Arquivada não conta.
  await migrate.query(
    `INSERT INTO acoes_do_plano (cliente_carteira_id, grupo_id, titulo, status, prazo, criado_por, arquivada_em)
     VALUES ($1, $2, 'Arquivada', 'pendente', '2026-10-01', $3, now())`,
    [sol, grupoA, marta],
  )
  // Campanha de contagem, visível (9 pagamentos), e uma pequena, suprimida.
  await migrate.query(
    `INSERT INTO campanhas_carteira
       (cliente_carteira_id, grupo_id, origem, nome, periodo_inicio, periodo_fim, metrica, meta, resultado,
        orcamentos_pagos, status, rotulo_da_metrica)
     VALUES ($1, $2, 'manual', 'Aniversariantes', '2026-11-01', '2026-11-30', 'convertidos', 20, 12, 9, 'ativa', 'Convertidos'),
            ($1, $2, 'manual', 'Campanha secreta ${sufixo}', '2026-11-01', '2026-11-30', 'convertidos', 10, 3, 2, 'ativa', 'Convertidos')`,
    [lua, grupoA],
  )
  // Tarefas da Marta: uma vencida, uma no prazo, uma concluída (não conta).
  await migrate.query(
    `INSERT INTO tarefas_internas (titulo, grupo_id, cliente_carteira_id, responsavel_usuario_gestao_id, prazo, status)
     VALUES ('T1', $1, $2, $3, '2026-11-03', 'pendente'),
            ('T2', $1, $2, $3, '2026-11-20', 'pendente'),
            ('T3', $1, $2, $3, '2026-11-01', 'concluida')`,
    [grupoA, sol, marta],
  )
  await migrate.query(`UPDATE tarefas_internas SET concluida_em = now() WHERE titulo = 'T3' AND cliente_carteira_id = $1`, [sol])

  // Nina, no OUTRO grupo, sem `valores`: mensalidade e campanha de receita com números reconhecíveis.
  const mar = await novoCliente('mar', grupoB, `Mar ${sufixo}`, nina, MENSALIDADE_SECRETA)
  await reuniao(mar, grupoB, nina, '2026-10-28', 'Atenção ao caixa.', 'Planilha', 'atencao')
  await migrate.query(
    `INSERT INTO campanhas_carteira
       (cliente_carteira_id, grupo_id, origem, nome, periodo_inicio, periodo_fim, metrica, meta, resultado,
        receita_centavos, orcamentos_pagos, status, rotulo_da_metrica)
     VALUES ($1, $2, 'manual', 'Botox', '2026-11-01', '2026-11-30', 'receita', $3, $4, $4, 30, 'ativa', 'Receita')`,
    [mar, grupoB, META_SECRETA.toString(), RECEITA_SECRETA.toString()],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RELOGIO)
    .useValue(new RelogioFixo(AGORA))
    .compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  for (const chave of Object.keys(usuarios)) await entrar(chave)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const ids = Object.values(clientes)
  const us = Object.values(usuarios)
  await migrate.query('DELETE FROM tarefas_internas WHERE cliente_carteira_id = ANY($1)', [ids])
  await migrate.query('DELETE FROM campanhas_carteira WHERE cliente_carteira_id = ANY($1)', [ids])
  await migrate.query('DELETE FROM acoes_do_plano WHERE cliente_carteira_id = ANY($1)', [ids])
  await migrate.query('DELETE FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1)', [ids])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [ids])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [us])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1', [`resumo.%.${sufixo}`])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [us])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await migrate.end()
  await app.close()
})

describe('GET /v1/carteira/resumo/semanal — acesso', () => {
  it('sem sessão: 404', async () => {
    await http().get('/v1/carteira/resumo/semanal').expect(404)
  })

  it('sem o módulo `resumo`: 403', async () => {
    await http().get('/v1/carteira/resumo/semanal').set('Cookie', cookies['semmodulo']!).expect(403)
  })

  it('escopo de grupo: 403, mesmo com todos os módulos (A-5)', async () => {
    await http().get('/v1/carteira/resumo/semanal').set('Cookie', cookies['dogrupo']!).expect(403)
  })
})

describe('GET /v1/carteira/resumo/semanal — o texto da Marta (minha carteira, com valores)', () => {
  it('o texto inteiro, conferido à mão', async () => {
    const r = await resumo('marta')
    expect(r.semana).toEqual({ inicio: '2026-11-02', ultimoDia: '2026-11-08', fimExclusivo: '2026-11-09' })
    expect(r.fuso).toBe('America/Bahia')
    expect(r.comValores).toBe(true)
    expect(r.texto).toBe(
      [
        'RESUMO SEMANAL · semana de 02/11 a 08/11',
        '',
        'CARTEIRA',
        '2 clientes ativos: 1 em bom, 0 em atenção, 1 crítico.',
        `Receita recorrente mensal: ${Dinheiro.deCentavos(249999n).formatar()}.`,
        '',
        'EM RISCO',
        `• Sol ${sufixo} (crítico): Agenda vazia ${sufixo}. 2 ações atrasadas. Encaminhamento: Rever preços`,
        '',
        'PLANO DE AÇÃO',
        `Foram concluídas 2 ações nesta semana. Permanecem 3 ações atrasadas, concentradas em: Pausa ${sufixo}, Sol ${sufixo}.`,
        '',
        'CAMPANHAS ATIVAS',
        `• Lua ${sufixo} · Aniversariantes: 12 de 20 convertidos (60%)`,
        '• Mais 1 campanha ativa sem detalhe (poucos pagamentos para exibir).',
        '',
        'EQUIPE',
        `• Marta ${sufixo}: 2 tarefas pendentes, 1 vencida.`,
        '',
        'PRIORIDADE DA SEMANA',
        `Atuar nos clientes em risco (Sol ${sufixo}) e zerar as ações e tarefas atrasadas.`,
      ].join('\n'),
    )
  })

  it('isolamento: nada do cliente da Nina, do outro grupo', async () => {
    const r = await resumo('marta')
    expect(r.texto).not.toContain(`Mar ${sufixo}`)
    expect(r.texto).not.toContain('Botox')
    expect(r.texto).not.toContain(`Nina ${sufixo}`)
    expect(r.texto).not.toContain(`Campanha secreta ${sufixo}`)
  })
})

describe('GET /v1/carteira/resumo/semanal — a Nina (sem valores)', () => {
  it('nenhum "R$" e nenhum valor monetário do cenário no texto (T-20)', async () => {
    const r = await resumo('nina')
    expect(r.comValores).toBe(false)
    expect(r.texto).not.toContain('R$')
    expect(r.texto).not.toContain('Receita recorrente')
    for (const v of [MENSALIDADE_SECRETA, RECEITA_SECRETA, META_SECRETA]) {
      expect(r.texto).not.toContain(v.toString())
      expect(r.texto).not.toContain(Dinheiro.deCentavos(v).formatar().replace('R$ ', ''))
    }
    expect(r.texto).toContain(`• Mar ${sufixo} · Botox: 66% da meta de receita`)
    expect(r.texto).toContain(`• Mar ${sufixo} (atenção): Atenção ao caixa. Encaminhamento: Planilha`)
    expect(r.texto).not.toContain(`Sol ${sufixo}`)
    expect(r.texto).toContain(`• Nina ${sufixo}: 0 tarefas pendentes, nenhuma vencida.`)
  })

  it('a resposta inteira não carrega número monetário em campo nenhum', async () => {
    const corpo = JSON.stringify(await resumo('nina'))
    for (const v of [MENSALIDADE_SECRETA, RECEITA_SECRETA, META_SECRETA]) expect(corpo).not.toContain(v.toString())
  })
})

describe('GET /v1/carteira/resumo/semanal — escopo geral, todas as clientes', () => {
  it('vê os dois grupos e formata a receita da campanha pelo formatador central', async () => {
    const r = await resumo('geral')
    expect(r.texto).toContain(`Sol ${sufixo}`)
    expect(r.texto).toContain(`Mar ${sufixo}`)
    expect(r.texto).toContain(
      `• Mar ${sufixo} · Botox: ${Dinheiro.deCentavos(RECEITA_SECRETA).formatar()} de ${Dinheiro.deCentavos(META_SECRETA).formatar()} receita (66%)`,
    )
    expect(r.texto).not.toContain(`Campanha secreta ${sufixo}`)
  })
})

describe('GET /v1/carteira/resumo/semanal — três leituras', () => {
  it('o mesmo texto, nada de negócio escrito, um registro de acesso por ata citada por leitura', async () => {
    const contar = async () =>
      (
        await migrate.query<{ acoes: number; tarefas: number; reunioes: number; campanhas: number }>(
          `SELECT (SELECT count(*)::int FROM acoes_do_plano WHERE cliente_carteira_id = ANY($1)) AS acoes,
                  (SELECT count(*)::int FROM tarefas_internas WHERE cliente_carteira_id = ANY($1)) AS tarefas,
                  (SELECT count(*)::int FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1)) AS reunioes,
                  (SELECT count(*)::int FROM campanhas_carteira WHERE cliente_carteira_id = ANY($1)) AS campanhas`,
          [Object.values(clientes)],
        )
      ).rows[0]!
    const acessos = async () =>
      (
        await migrate.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM auditoria_do_painel
            WHERE ator_tipo = 'usuario_gestao' AND ator_id = $1 AND acao = 'acessou'
              AND entidade = 'reunioes_comerciais' AND entidade_id = $2`,
          [usuarios['marta'], clientes['sol']],
        )
      ).rows[0]!.n

    const antes = await contar()
    const acessosAntes = await acessos()
    const textos = []
    for (let i = 0; i < 3; i++) textos.push((await resumo('marta')).texto)
    expect(new Set(textos).size).toBe(1)
    expect(await contar()).toEqual(antes)
    expect((await acessos()) - acessosAntes).toBe(3)
  })
})
