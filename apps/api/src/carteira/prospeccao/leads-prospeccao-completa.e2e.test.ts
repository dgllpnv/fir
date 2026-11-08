import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoModule } from '../../banco/banco.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { RedacaoInterceptor } from '../../comum/redacao.interceptor'
import { registrarCookie } from '../../main'
import { CarteiraGuard } from '../carteira.guard'
import { CarteiraModule } from '../carteira.module'
import { BeneficiosDeIndicacaoController } from '../financeiro/beneficios.controller'
import { BeneficiosDeIndicacaoService } from '../financeiro/beneficios.service'
import { hashDoTelefoneParaSupressao } from './leads.supressao'
import { ProspeccaoCarteiraModule } from './prospeccao-carteira.module'

/**
 * G8 1E — prospecção completa, contra Postgres real (RLS não se mocka).
 *
 * O que este arquivo prova, e que a suíte de domínio não alcança:
 *  - isolamento por grupo em TODA rota nova (ficha, edição, contato, perder,
 *    excluir, indicações, benefícios, vincular): o lead de outro grupo
 *    responde como inexistente;
 *  - "registrar contato" com a mesma chave não duplica (A-20);
 *  - `nao_contatar` respeitado no servidor (A37);
 *  - exclusão a pedido anonimiza e suprime o telefone em qualquer grafia;
 *  - a conversão gera o benefício de quem indicou, um só, e o de quem NÃO é
 *    cliente fica GUARDADO até ser ligado a um cliente (D-22 item 11);
 *  - dinheiro da prospecção sai redigido pelo interceptor real (T-19).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let app: NestFastifyApplication
let migrate: pg.Client
let grupoA: string
let grupoB: string
let clienteA: string
let clienteB: string
const usuarios: string[] = []
let cookieGeral: string
let cookieA: string
let cookieB: string
const telefonesSuprimidos: string[] = []

const sufixo = randomBytes(4).toString('hex')
const SENHA = 'quatro-pedras-no-caminho'

const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')
const http = () => request(app.getHttpServer())

type Lead = {
  id: string
  etapa: string
  nome: string
  naoContatar: boolean
  sinal: { nivel: string } | null
  linkDoWhatsApp: string | null
  valorEstimado: string | null
  clienteCarteiraId: string | null
  proximoContato: string | null
  whatsapp: string | null
}

async function criarLead(cookie: string, extra: Record<string, unknown> = {}): Promise<Lead> {
  const r = await http()
    .post('/v1/carteira/leads')
    .set('Cookie', cookie)
    .send({ nome: `Dra. Teste ${randomBytes(2).toString('hex')} ${sufixo}`, origem: 'Indicação pessoal', temperatura: 'morno', ...extra })
  expect(r.status, JSON.stringify(r.body)).toBe(201)
  return r.body.lead as Lead
}

async function entrar(usuario: string): Promise<string> {
  return paresDe(
    cookies(await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)),
  )
}

const contato = (cookie: string, leadId: string, corpo: Record<string, unknown>) =>
  http().post(`/v1/carteira/leads/${leadId}/contato`).set('Cookie', cookie).send(corpo)

const hojeDaResposta = async (cookie: string): Promise<string> =>
  (await http().get('/v1/carteira/leads').set('Cookie', cookie).expect(200)).body.hoje as string

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const novoGrupo = async (nome: string) =>
    (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [nome])).rows[0]!.id
  grupoA = await novoGrupo(`Grupo 1E A ${sufixo}`)
  grupoB = await novoGrupo(`Grupo 1E B ${sufixo}`)

  const novoCliente = async (grupo: string, nome: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clientes_carteira (grupo_id, nome, produto, status) VALUES ($1, $2, 'Acelerador FIR', 'onboarding') RETURNING id`,
        [grupo, nome],
      )
    ).rows[0]!.id
  clienteA = await novoCliente(grupoA, `Clínica Indicadora A ${sufixo}`)
  clienteB = await novoCliente(grupoB, `Clínica Indicadora B ${sufixo}`)

  const hash = await hashDeSenha(SENHA)
  const novoUsuario = async (usuario: string, escopo: 'geral' | 'grupo', grupo: string | null) => {
    const id = (
      await migrate.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [usuario, `Pessoa ${usuario}`, hash, escopo, grupo],
      )
    ).rows[0]!.id
    usuarios.push(id)
  }
  await novoUsuario(`p1e.geral.${sufixo}`, 'geral', null)
  await novoUsuario(`p1e.a.${sufixo}`, 'grupo', grupoA)
  await novoUsuario(`p1e.b.${sufixo}`, 'grupo', grupoB)

  const mod = await Test.createTestingModule({
    imports: [BancoModule, CarteiraModule, ProspeccaoCarteiraModule],
    // Só a fatia de benefícios do módulo financeiro: o resto dele não é deste ticket.
    controllers: [BeneficiosDeIndicacaoController],
    providers: [
      BeneficiosDeIndicacaoService,
      { provide: APP_GUARD, useClass: CarteiraGuard },
      // O interceptor REAL da aplicação — o mesmo ponto único de redação.
      { provide: APP_INTERCEPTOR, useClass: RedacaoInterceptor },
    ],
  }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  cookieGeral = await entrar(`p1e.geral.${sufixo}`)
  cookieA = await entrar(`p1e.a.${sufixo}`)
  cookieB = await entrar(`p1e.b.${sufixo}`)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const leads = (
    await migrate.query<{ id: string }>(
      `SELECT id FROM leads_comerciais WHERE nome LIKE $1 OR grupo_id = ANY($2) OR excluido_a_pedido_em IS NOT NULL AND id IN (SELECT lead_comercial_id FROM interacoes_do_lead WHERE por_usuario_gestao_id = ANY($3))`,
      [`%${sufixo}`, [grupoA, grupoB], usuarios],
    )
  ).rows.map((r) => r.id)
  const clientes = (
    await migrate.query<{ id: string }>(
      `SELECT id FROM clientes_carteira WHERE lead_origem_id = ANY($1) OR grupo_id = ANY($2)`,
      [leads, [grupoA, grupoB]],
    )
  ).rows.map((r) => r.id)
  const gruposDeConversao = (
    await migrate.query<{ id: string }>(`SELECT id FROM grupos WHERE lead_origem_id = ANY($1)`, [leads])
  ).rows.map((r) => r.id)
  await migrate.query(`DELETE FROM beneficios_de_indicacao WHERE lead_comercial_id = ANY($1) OR cliente_carteira_id = ANY($2)`, [
    leads,
    clientes,
  ])
  await migrate.query(`DELETE FROM auditoria_da_carteira WHERE usuario_gestao_id = ANY($1)`, [usuarios])
  await migrate.query(`DELETE FROM interacoes_do_lead WHERE lead_comercial_id = ANY($1)`, [leads])
  await migrate.query(`DELETE FROM leads_comerciais WHERE id = ANY($1)`, [leads])
  await migrate.query(`DELETE FROM clientes_carteira WHERE id = ANY($1)`, [clientes])
  await migrate.query(`DELETE FROM grupos WHERE id = ANY($1)`, [gruposDeConversao])
  await migrate.query(`DELETE FROM supressoes_de_contato WHERE telefone_hash = ANY($1)`, [
    telefonesSuprimidos.map((t) => hashDoTelefoneParaSupressao(t)),
  ])
  await migrate.query(`DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)`, [usuarios])
  await migrate.query(`DELETE FROM usuarios_gestao WHERE id = ANY($1)`, [usuarios])
  await migrate.query(`DELETE FROM grupos WHERE id = ANY($1)`, [[grupoA, grupoB]])
  await migrate.end()
  await app.close()
})

describe('isolamento por grupo em toda rota nova da prospecção', () => {
  it('o lead do grupo B é invisível para o grupo A — leitura, escrita e agregados', async () => {
    const deB = await criarLead(cookieB, { clienteIndicadorId: clienteB })
    const hoje = await hojeDaResposta(cookieA)

    await http().get(`/v1/carteira/leads/${deB.id}`).set('Cookie', cookieA).expect(404)
    await http().patch(`/v1/carteira/leads/${deB.id}`).set('Cookie', cookieA).send({ cidade: 'X' }).expect(404)
    await http().post(`/v1/carteira/leads/${deB.id}/perder`).set('Cookie', cookieA).send({ motivo: 'x' }).expect(404)
    await http().post(`/v1/carteira/leads/${deB.id}/excluir-a-pedido`).set('Cookie', cookieA).expect(404)
    await http().post(`/v1/carteira/leads/${deB.id}/etapa`).set('Cookie', cookieA).send({ etapa: 'ganho' }).expect(404)
    const c = await contato(cookieA, deB.id, {
      chaveIdempotencia: randomUUID(),
      data: hoje,
      canal: 'WhatsApp',
      nota: 'tentativa cruzada',
      etapa: 'contato',
      temperatura: 'morno',
      proximoContato: null,
    })
    expect(c.status).toBe(404)

    const lista = (await http().get('/v1/carteira/leads').set('Cookie', cookieA).expect(200)).body
    expect(lista.leads.some((l: Lead) => l.id === deB.id)).toBe(false)
    const ind = (await http().get('/v1/carteira/indicacoes').set('Cookie', cookieA).expect(200)).body
    expect(JSON.stringify(ind)).not.toContain(deB.id)
    expect(JSON.stringify(ind)).not.toContain(clienteB)

    // Nada mudou no lead de B.
    const r = await migrate.query(`SELECT cidade, etapa FROM leads_comerciais WHERE id = $1`, [deB.id])
    expect(r.rows[0]).toEqual({ cidade: null, etapa: 'novo' })
  })

  it('id que não é UUID responde 404, igual ao de outro grupo', async () => {
    await http().get('/v1/carteira/leads/nao-e-uuid').set('Cookie', cookieA).expect(404)
  })

  it('A-11 item 7: escopo grupo não aponta como indicador um cliente de outro grupo', async () => {
    const r = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Cruzado ${sufixo}`, origem: 'Indicação de cliente', temperatura: 'morno', clienteIndicadorId: clienteB })
    expect(r.status).toBe(400)
  })

  it('benefícios: a lista do grupo A não traz o de B, e vincular o de B responde 404', async () => {
    const deB = await criarLead(cookieB, { indicadoPor: `Pessoa B ${sufixo}` })
    await http().post(`/v1/carteira/leads/${deB.id}/etapa`).set('Cookie', cookieB).send({ etapa: 'ganho' }).expect(201)
    const ben = (await migrate.query<{ id: string }>(`SELECT id FROM beneficios_de_indicacao WHERE lead_comercial_id = $1`, [deB.id]))
      .rows[0]!.id

    const listaA = (await http().get('/v1/carteira/beneficios').set('Cookie', cookieA).expect(200)).body
    expect(listaA.beneficios.some((b: { id: string }) => b.id === ben)).toBe(false)
    await http()
      .post(`/v1/carteira/beneficios/${ben}/vincular`)
      .set('Cookie', cookieA)
      .send({ clienteCarteiraId: clienteA })
      .expect(404)
  })
})

describe('registrar contato (L2559-2565)', () => {
  it('grava interação, etapa, temperatura e próximo contato numa vez só', async () => {
    const lead = await criarLead(cookieA)
    const hoje = await hojeDaResposta(cookieA)
    const r = await contato(cookieA, lead.id, {
      chaveIdempotencia: randomUUID(),
      data: hoje,
      canal: 'Ligação',
      nota: 'Pediu proposta.',
      etapa: 'proposta',
      temperatura: 'quente',
      proximoContato: hoje,
    })
    expect(r.status, JSON.stringify(r.body)).toBe(201)
    expect(r.body.lead).toMatchObject({ etapa: 'proposta', temperatura: 'quente', proximoContato: hoje, ultimoContato: hoje })
    expect(r.body.interacao).toMatchObject({ canal: 'Ligação', nota: 'Pediu proposta.', dataDoContato: hoje })
    expect(r.body.lead.sinal).toMatchObject({ nivel: 'agora', motivo: 'Contato combinado para hoje.' })

    const ficha = (await http().get(`/v1/carteira/leads/${lead.id}`).set('Cookie', cookieA).expect(200)).body
    expect(ficha.interacoes).toHaveLength(1)
    expect(ficha.interacoes[0].porNome).toBe(`Pessoa p1e.a.${sufixo}`)
    expect(ficha.sugestaoDeContato.etapa).toBe('proposta')
  })

  it('A-20: a mesma chave três vezes cria UM contato e aplica a mudança uma vez', async () => {
    const lead = await criarLead(cookieA)
    const hoje = await hojeDaResposta(cookieA)
    const chave = randomUUID()
    const corpo = {
      chaveIdempotencia: chave,
      data: hoje,
      canal: 'WhatsApp',
      nota: 'Mensagem enviada.',
      etapa: 'contato',
      temperatura: 'morno',
      proximoContato: null,
    }
    const respostas = [] as { status: number; body: { interacao: { id: string } } }[]
    for (let i = 0; i < 3; i++) respostas.push(await contato(cookieA, lead.id, corpo))
    for (const r of respostas) expect(r.status).toBe(201)
    expect(new Set(respostas.map((r) => r.body.interacao.id)).size).toBe(1)

    const n = await migrate.query(`SELECT count(*)::int AS n FROM interacoes_do_lead WHERE lead_comercial_id = $1`, [lead.id])
    expect(n.rows[0].n).toBe(1)

    // A mesma chave depois de o lead mudar de etapa NÃO reaplica a mudança antiga.
    await http().post(`/v1/carteira/leads/${lead.id}/etapa`).set('Cookie', cookieA).send({ etapa: 'reuniao' }).expect(201)
    const repetido = await contato(cookieA, lead.id, corpo)
    expect(repetido.body.lead.etapa).toBe('reuniao')
  })

  it('duas requisições SIMULTÂNEAS com a mesma chave também criam um só', async () => {
    const lead = await criarLead(cookieA)
    const hoje = await hojeDaResposta(cookieA)
    const corpo = {
      chaveIdempotencia: randomUUID(),
      data: hoje,
      canal: 'WhatsApp',
      nota: 'Duplo toque.',
      etapa: 'contato',
      temperatura: 'morno',
      proximoContato: null,
    }
    const [a, b] = await Promise.all([contato(cookieA, lead.id, corpo), contato(cookieA, lead.id, corpo)])
    expect([a.status, b.status]).toEqual([201, 201])
    const n = await migrate.query(`SELECT count(*)::int AS n FROM interacoes_do_lead WHERE lead_comercial_id = $1`, [lead.id])
    expect(n.rows[0].n).toBe(1)
  })

  it('recusa data futura, "ganho" e canal fora da lista', async () => {
    const lead = await criarLead(cookieA)
    const hoje = await hojeDaResposta(cookieA)
    const base = { chaveIdempotencia: randomUUID(), data: hoje, canal: 'WhatsApp', nota: 'x', etapa: 'contato', temperatura: 'morno', proximoContato: null }
    expect((await contato(cookieA, lead.id, { ...base, data: '2999-01-01' })).status).toBe(400)
    expect((await contato(cookieA, lead.id, { ...base, chaveIdempotencia: randomUUID(), etapa: 'ganho' })).status).toBe(400)
    expect((await contato(cookieA, lead.id, { ...base, chaveIdempotencia: randomUUID(), canal: 'Registro' })).status).toBe(400)
    const n = await migrate.query(`SELECT count(*)::int AS n FROM interacoes_do_lead WHERE lead_comercial_id = $1`, [lead.id])
    expect(n.rows[0].n).toBe(0)
  })
})

describe('nao_contatar e exclusão a pedido (LGPD A37)', () => {
  it('com oposição registrada: sem WhatsApp, sem sinal, e contato novo recusado no servidor', async () => {
    const lead = await criarLead(cookieA, { whatsapp: '(71) 98888-0001', etapa: 'novo', recebidaEm: '2026-01-01' })
    expect(lead.linkDoWhatsApp).toBe('https://wa.me/5571988880001')
    expect(lead.sinal?.nivel).toBe('agora')

    const r = await http().patch(`/v1/carteira/leads/${lead.id}`).set('Cookie', cookieA).send({ naoContatar: true }).expect(200)
    expect(r.body.lead).toMatchObject({ naoContatar: true, linkDoWhatsApp: null, sinal: null })

    const hoje = await hojeDaResposta(cookieA)
    const c = await contato(cookieA, lead.id, {
      chaveIdempotencia: randomUUID(),
      data: hoje,
      canal: 'WhatsApp',
      nota: 'insistindo',
      etapa: 'contato',
      temperatura: 'morno',
      proximoContato: null,
    })
    expect(c.status).toBe(409)
    await http().post(`/v1/carteira/leads/${lead.id}/interacoes`).set('Cookie', cookieA).send({ canal: 'WhatsApp', nota: 'x' }).expect(409)
    const em = await migrate.query(`SELECT nao_contatar_em FROM leads_comerciais WHERE id = $1`, [lead.id])
    expect(em.rows[0].nao_contatar_em).not.toBeNull()
  })

  it('exclusão a pedido: anonimiza lead e histórico, mantém a etapa, e o telefone não volta em grafia nenhuma', async () => {
    const telefone = `(71) 9${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    telefonesSuprimidos.push(telefone)
    const lead = await criarLead(cookieA, { whatsapp: telefone, cidade: 'Salvador', observacoes: 'dado pessoal' })
    const hoje = await hojeDaResposta(cookieA)
    await contato(cookieA, lead.id, {
      chaveIdempotencia: randomUUID(),
      data: hoje,
      canal: 'WhatsApp',
      nota: 'Conversa com dado pessoal',
      etapa: 'contato',
      temperatura: 'morno',
      proximoContato: null,
    }).expect(201)

    const r = await http().post(`/v1/carteira/leads/${lead.id}/excluir-a-pedido`).set('Cookie', cookieA).expect(201)
    expect(r.body.lead).toMatchObject({
      nome: 'Lead excluído a pedido',
      whatsapp: null,
      cidade: null,
      observacoes: null,
      naoContatar: true,
      excluidoAPedido: true,
      etapa: 'contato',
    })
    expect(r.body.lead.arquivadoEm).not.toBeNull()
    const notas = await migrate.query(`SELECT nota FROM interacoes_do_lead WHERE lead_comercial_id = $1`, [lead.id])
    expect(notas.rows.map((x) => x.nota)).toEqual(['[removido a pedido do titular]'])

    // Só o HMAC ficou: o telefone em claro não está na tabela.
    const sup = await migrate.query(`SELECT telefone_hash FROM supressoes_de_contato WHERE telefone_hash = $1`, [
      hashDoTelefoneParaSupressao(telefone),
    ])
    expect(sup.rowCount).toBe(1)
    expect(sup.rows[0].telefone_hash).not.toContain(telefone.replace(/\D/g, ''))

    // Recadastrar com outra grafia (com +55, sem máscara) é recusado.
    const digitos = telefone.replace(/\D/g, '')
    const novo = await http()
      .post('/v1/carteira/leads')
      .set('Cookie', cookieA)
      .send({ nome: `Outra ${sufixo}`, origem: 'Instagram', temperatura: 'frio', whatsapp: `+55 ${digitos}` })
    expect(novo.status).toBe(409)
    // E também por edição de outro lead.
    const outro = await criarLead(cookieA)
    await http().patch(`/v1/carteira/leads/${outro.id}`).set('Cookie', cookieA).send({ whatsapp: digitos }).expect(409)
    // O anonimizado não se preenche de novo.
    await http().patch(`/v1/carteira/leads/${lead.id}`).set('Cookie', cookieA).send({ cidade: 'Salvador' }).expect(409)
  })

  it('fir_carteira não lê a lista de supressão diretamente', async () => {
    const carteira = new pg.Client({
      connectionString:
        process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir',
    })
    await carteira.connect()
    try {
      await expect(carteira.query('SELECT * FROM supressoes_de_contato')).rejects.toThrow(/permission denied/)
    } finally {
      await carteira.end()
    }
  })

  it('catálogo: supressões com RLS forçada e SEM policy, nenhum privilégio de aplicação; só as duas funções estreitas', async () => {
    const t = await migrate.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
         FROM pg_class c WHERE c.relname = 'supressoes_de_contato'`,
    )
    expect(t.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, policies: 0 })
    for (const papel of ['fir_app', 'fir_carteira', 'fir_portal']) {
      const p = await migrate.query(
        `SELECT has_table_privilege($1, 'supressoes_de_contato', 'SELECT') AS s,
                has_table_privilege($1, 'supressoes_de_contato', 'INSERT') AS i`,
        [papel],
      )
      expect(p.rows[0], papel).toEqual({ s: false, i: false })
    }
    const f = await migrate.query(
      `SELECT proname, prosecdef FROM pg_proc
        WHERE proname IN ('contato_de_lead_suprimido', 'excluir_lead_a_pedido') ORDER BY proname`,
    )
    expect(f.rows).toEqual([
      { proname: 'contato_de_lead_suprimido', prosecdef: true },
      { proname: 'excluir_lead_a_pedido', prosecdef: true },
    ])
  })

  it('escopo grupo não exclui, pela função, lead de outro grupo', async () => {
    const deB = await criarLead(cookieB, { cidade: 'Feira' })
    const carteira = new pg.Client({
      connectionString:
        process.env['DATABASE_URL_CARTEIRA'] ?? 'postgresql://fir_carteira:fir_local_dev@127.0.0.1:4832/fir',
    })
    await carteira.connect()
    try {
      await carteira.query('BEGIN')
      await carteira.query(`SELECT set_config('app.pessoa_id', $1, true)`, [`usuario_gestao:${usuarios[1]}`])
      await carteira.query(`SELECT set_config('app.escopo', 'grupo', true)`)
      await carteira.query(`SELECT set_config('app.grupo_id', $1, true)`, [grupoA])
      await expect(carteira.query(`SELECT excluir_lead_a_pedido($1, NULL)`, [deB.id])).rejects.toThrow(/não encontrado/)
      await carteira.query('ROLLBACK')
    } finally {
      await carteira.end()
    }
    const r = await migrate.query(`SELECT cidade FROM leads_comerciais WHERE id = $1`, [deB.id])
    expect(r.rows[0].cidade).toBe('Feira')
  })
})

describe('marcar perdido com "tentar de novo em" (L2960)', () => {
  it('com data vai para Em espera com o próximo contato; sem data, perdido — os dois no histórico', async () => {
    const a = await criarLead(cookieA)
    const r1 = await http()
      .post(`/v1/carteira/leads/${a.id}/perder`)
      .set('Cookie', cookieA)
      .send({ motivo: 'Sem orçamento agora.', tentarDeNovoEm: '2999-03-01' })
      .expect(201)
    expect(r1.body.lead).toMatchObject({ etapa: 'espera', proximoContato: '2999-03-01' })

    const b = await criarLead(cookieA)
    const r2 = await http().post(`/v1/carteira/leads/${b.id}/perder`).set('Cookie', cookieA).send({ motivo: 'Fechou com outro.' }).expect(201)
    expect(r2.body.lead).toMatchObject({ etapa: 'perdido', motivoPerda: 'Fechou com outro.', proximoContato: null })

    const h = await migrate.query(
      `SELECT canal, nota FROM interacoes_do_lead WHERE lead_comercial_id = ANY($1) ORDER BY nota`,
      [[a.id, b.id]],
    )
    expect(h.rows).toEqual([
      { canal: 'Registro', nota: 'Perdido: Fechou com outro.' },
      { canal: 'Registro', nota: 'Perdido: Sem orçamento agora.' },
    ])
  })
})

describe('benefício de indicação na conversão (L2962; D-22 item 11)', () => {
  it('indicado por cliente da carteira: benefício pendente desse cliente, um só mesmo com conversão repetida', async () => {
    const lead = await criarLead(cookieA, { clienteIndicadorId: clienteA, origem: 'Indicação de cliente' })
    for (let i = 0; i < 3; i++) {
      await http().post(`/v1/carteira/leads/${lead.id}/etapa`).set('Cookie', cookieA).send({ etapa: 'ganho' }).expect(201)
    }
    const bs = await migrate.query(
      `SELECT cliente_carteira_id, grupo_id, percentual_centesimos::text AS p FROM beneficios_de_indicacao WHERE lead_comercial_id = $1`,
      [lead.id],
    )
    expect(bs.rows).toEqual([{ cliente_carteira_id: clienteA, grupo_id: grupoA, p: '1000' }])

    const ficha = (await http().get(`/v1/carteira/leads/${lead.id}`).set('Cookie', cookieA).expect(200)).body
    expect(ficha.beneficio).toMatchObject({ situacao: 'pendente', clienteCarteiraId: clienteA, percentualCentesimos: '1000' })
    expect(ficha.interacoes.map((i: { nota: string }) => i.nota)).toContain('Contrato fechado.')

    const trilha = await migrate.query(
      `SELECT acao FROM auditoria_da_carteira WHERE tabela = 'beneficios_de_indicacao' AND registro_id = $1`,
      [ficha.beneficio.id],
    )
    expect(trilha.rows).toEqual([{ acao: 'criar' }])

    const rank = (await http().get('/v1/carteira/indicacoes').set('Cookie', cookieA).expect(200)).body.ranking
    const linha = rank.find((x: { clienteCarteiraId: string | null }) => x.clienteCarteiraId === clienteA)
    expect(linha).toMatchObject({ viraramClientes: 1, beneficiosPendentes: 1 })
  })

  it('indicado por quem NÃO é cliente: o benefício fica GUARDADO, fora de qualquer cobrança, até ser ligado', async () => {
    const quem = `Doutor Parceiro ${sufixo}`
    const lead = await criarLead(cookieGeral, { indicadoPor: quem, origem: 'Indicação de parceiro' })
    await http().post(`/v1/carteira/leads/${lead.id}/etapa`).set('Cookie', cookieGeral).send({ etapa: 'ganho' }).expect(201)

    const lista = (await http().get('/v1/carteira/beneficios').set('Cookie', cookieGeral).expect(200)).body
    const guardado = lista.beneficios.find((b: { leadComercialId: string }) => b.leadComercialId === lead.id)
    expect(guardado).toMatchObject({ situacao: 'guardado', clienteCarteiraId: null, indicadorNome: quem, beneficiario: quem })
    expect(lista.regraPercentualCentesimos).toBe('1000')

    // O job de cobrança reivindica por `cliente_carteira_id = $1`: sem cliente, nunca é candidato.
    // E o banco recusa consumi-lo mesmo à mão.
    await expect(
      migrate.query(
        `UPDATE beneficios_de_indicacao SET consumido_em = now(), cobranca_id = gen_random_uuid() WHERE id = $1`,
        [guardado.id],
      ),
    ).rejects.toThrow()

    // A pessoa vira cliente: um cliente com o nome dela aparece como SUGESTÃO, nunca ligado sozinho.
    const virouCliente = (
      await migrate.query<{ id: string }>(
        `INSERT INTO clientes_carteira (grupo_id, nome, produto, status) VALUES ($1, $2, 'Consultoria', 'onboarding') RETURNING id`,
        [grupoA, quem],
      )
    ).rows[0]!.id
    const depois = (await http().get('/v1/carteira/beneficios').set('Cookie', cookieGeral).expect(200)).body
    const sugerido = depois.beneficios.find((b: { id: string }) => b.id === guardado.id)
    expect(sugerido.situacao).toBe('guardado')
    expect(sugerido.sugestoesDeCliente).toEqual([{ id: virouCliente, nome: quem }])

    const ligado = await http()
      .post(`/v1/carteira/beneficios/${guardado.id}/vincular`)
      .set('Cookie', cookieGeral)
      .send({ clienteCarteiraId: virouCliente })
      .expect(201)
    expect(ligado.body.beneficio).toMatchObject({ situacao: 'pendente', clienteCarteiraId: virouCliente })
    const linha = await migrate.query(`SELECT grupo_id, vinculado_em FROM beneficios_de_indicacao WHERE id = $1`, [guardado.id])
    expect(linha.rows[0].grupo_id).toBe(grupoA)
    expect(linha.rows[0].vinculado_em).not.toBeNull()

    // Agora é candidato da cobrança do cliente — a mesma consulta do job.
    const candidato = await migrate.query(
      `SELECT id FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1 AND consumido_em IS NULL`,
      [virouCliente],
    )
    expect(candidato.rows.map((x) => x.id)).toEqual([guardado.id])

    // Ligar de novo ao mesmo é idempotente; a outro cliente, recusado.
    await http().post(`/v1/carteira/beneficios/${guardado.id}/vincular`).set('Cookie', cookieGeral).send({ clienteCarteiraId: virouCliente }).expect(201)
    await http().post(`/v1/carteira/beneficios/${guardado.id}/vincular`).set('Cookie', cookieGeral).send({ clienteCarteiraId: clienteA }).expect(409)
  })

  it('lead sem indicação não gera benefício', async () => {
    const lead = await criarLead(cookieA, { origem: 'Instagram' })
    await http().post(`/v1/carteira/leads/${lead.id}/etapa`).set('Cookie', cookieA).send({ etapa: 'ganho' }).expect(201)
    const n = await migrate.query(`SELECT count(*)::int AS n FROM beneficios_de_indicacao WHERE lead_comercial_id = $1`, [lead.id])
    expect(n.rows[0].n).toBe(0)
  })
})

describe('dinheiro da prospecção e trilha de acesso', () => {
  it('T-19: potencial e valorEstimado saem null pelo interceptor real; escrever valor sem `valores` é recusado', async () => {
    const lead = await criarLead(cookieA)
    await migrate.query(`UPDATE leads_comerciais SET valor_estimado_centavos = 280000 WHERE id = $1`, [lead.id])
    const lista = (await http().get('/v1/carteira/leads').set('Cookie', cookieA).expect(200)).body
    expect(lista.podeVerValores).toBe(false)
    expect(lista.resumo.potencial).toBeNull()
    const doLead = lista.leads.find((l: Lead) => l.id === lead.id)
    expect(doLead.valorEstimado).toBeNull()
    expect(JSON.stringify(lista)).not.toContain('280000')
    const ficha = (await http().get(`/v1/carteira/leads/${lead.id}`).set('Cookie', cookieA).expect(200)).body
    expect(ficha.lead.valorEstimado).toBeNull()

    await http().patch(`/v1/carteira/leads/${lead.id}`).set('Cookie', cookieA).send({ valorEstimado: '100' }).expect(403)
  })

  it('o resumo traz as contagens e a conversão das encerradas, calculadas no servidor', async () => {
    const lista = (await http().get('/v1/carteira/leads').set('Cookie', cookieB).expect(200)).body
    const total = lista.resumo.porEtapa.reduce((s: number, x: { quantidade: number }) => s + x.quantidade, 0)
    expect(total).toBe(lista.leads.length)
    const ganhos = lista.leads.filter((l: Lead) => l.etapa === 'ganho').length
    const perdidos = lista.leads.filter((l: Lead) => l.etapa === 'perdido').length
    expect(lista.resumo.conversaoDasEncerradas).toBe(ganhos + perdidos === 0 ? null : Math.round((ganhos * 100) / (ganhos + perdidos)))
  })

  it('abrir a ficha grava o acesso (LGPD A53) com o Usuário de Gestão real', async () => {
    const lead = await criarLead(cookieA)
    await http().get(`/v1/carteira/leads/${lead.id}`).set('Cookie', cookieA).expect(200)
    const r = await migrate.query(
      `SELECT ator_tipo, ator_id FROM auditoria_do_painel WHERE acao = 'acessou' AND entidade = 'leads_comerciais' AND entidade_id = $1`,
      [lead.id],
    )
    expect(r.rows).toEqual([{ ator_tipo: 'usuario_gestao', ator_id: usuarios[1] }])
  })
})
