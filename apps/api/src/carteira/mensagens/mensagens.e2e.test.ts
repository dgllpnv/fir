import { randomUUID } from 'node:crypto'
import type { DestinoDaMensagem, UsuarioDeGestaoPublico } from '@fir/contracts'
import { RelogioFixo } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoService } from '../../banco/banco.service'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import {
  ChaveReutilizada,
  EntradaInvalida,
  MensagemRestrita,
  NaoContatar,
  NaoEncontrado,
  SemPermissao,
  ninguemVeValoresAinda,
} from './mensagens-comum'
import { MensagensCarteiraService } from './mensagens.service'
import { perfilPadraoDoBanco } from '../perfil-do-usuario-de-gestao'

/**
 * **G8 3A — mensagens prontas e WhatsApp, contra Postgres real.**
 *
 * Duas instâncias do serviço: uma com o provedor de produção
 * (`ninguemVeValoresAinda`, falha fechada até o ticket 0.5) e uma com
 * `valores` ligado — o caminho que a 0.5 vai abrir —, para provar os dois
 * lados da redação. O isolamento é o banco recusando (RLS pela sessão do
 * `Usuário de Gestão`), nunca um filtro escrito aqui.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `mensagens${Date.now()}`
const PIX = `pix-${codigo}@firmare.com.br`

let migrate: pg.Client
let banco: BancoService
let semValores: MensagensCarteiraService
let comValores: MensagensCarteiraService

let grupoA: string
let grupoB: string
let clienteA: string
let clienteA2: string
let leadPix: string
let leadOposto: string
let tarefaA: string
let geral: UsuarioDeGestaoPublico
let doA: UsuarioDeGestaoPublico
let doB: UsuarioDeGestaoPublico
let pixOriginal: { chave_pix: string | null; favorecido: string | null } = { chave_pix: null, favorecido: 'Firmare Gestão Empresarial' }
const roteirosCriados: string[] = []
const modelosCriados: string[] = []

async function usuarioDeGestao(nome: string, escopo: 'geral' | 'grupo', grupoId: string | null) {
  const usuario = `${nome.toLowerCase()}.${codigo}`
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
    [usuario, nome, escopo, grupoId],
  )
  return { id: r.rows[0]!.id, usuario, nome, escopo, grupoId, senhaProvisoria: false, ...perfilPadraoDoBanco(escopo) } satisfies UsuarioDeGestaoPublico
}

const paraCliente = (chave: string, extra: Partial<Extract<DestinoDaMensagem, { para: 'cliente' }>> = {}): DestinoDaMensagem => ({
  para: 'cliente',
  clienteId: clienteA,
  chave,
  ...extra,
})

const contarEnvios = async (): Promise<number> =>
  Number(
    (
      await migrate.query<{ n: string }>(
        `SELECT count(*) AS n FROM envios_de_mensagem WHERE cliente_carteira_id = ANY($1) OR lead_comercial_id = ANY($2)`,
        [
          [clienteA, clienteA2],
          [leadPix, leadOposto],
        ],
      )
    ).rows[0]!.n,
  )

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  const relogio = new RelogioFixo(new Date('2026-11-07T15:00:00Z'))
  semValores = new MensagensCarteiraService(banco, relogio, ninguemVeValoresAinda)
  comValores = new MensagensCarteiraService(banco, relogio, () => true)

  const grupo = async (n: string) =>
    (await migrate.query<{ id: string }>('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`${n} ${codigo}`])).rows[0]!.id
  grupoA = await grupo('A')
  grupoB = await grupo('B')

  const cliente = async (nome: string, telefoneCobranca: string | null) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clientes_carteira
           (grupo_id, nome, produto, decisor, telefone, telefone_cobranca, dia_vencimento, mensalidade_centavos, link_dash_fin)
         VALUES ($1, $2, 'Consultoria', 'Dra. Raphaella Pontes', '(71) 99999-1201', $3, 10, 280000, 'https://exemplo.com/fin')
         RETURNING id`,
        [grupoA, nome, telefoneCobranca],
      )
    ).rows[0]!.id
  clienteA = await cliente('Clínica Pontes', '(71) 98888-0000')
  clienteA2 = await cliente('Clínica Outra', null)

  geral = await usuarioDeGestao('geral', 'geral', null)
  doA = await usuarioDeGestao('Manu', 'grupo', grupoA)
  doB = await usuarioDeGestao('dob', 'grupo', grupoB)

  const lead = async (nome: string, naoContatar: boolean) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO leads_comerciais
           (nome, grupo_id, origem, temperatura, whatsapp, recebida_em, nao_contatar, nao_contatar_em, cliente_indicador_id)
         VALUES ($1, $2, 'Indicação de cliente', 'quente', '(71) 99999-1202', '2026-11-01', $3,
                 CASE WHEN $3 THEN now() END, $4)
         RETURNING id`,
        [nome, grupoA, naoContatar, clienteA],
      )
    ).rows[0]!.id
  leadPix = await lead('{pix} {valor}', false)
  leadOposto = await lead('Dra. Que Pediu Para Sair', true)

  tarefaA = (
    await migrate.query<{ id: string }>(
      `INSERT INTO tarefas_internas (titulo, grupo_id, responsavel_usuario_gestao_id, cliente_carteira_id, prazo)
       VALUES ('Lembrete de mensalidade', $1, $2, $3, '2026-11-07') RETURNING id`,
      [grupoA, doA.id, clienteA],
    )
  ).rows[0]!.id

  await migrate.query(
    `INSERT INTO parceiros_do_cliente (grupo_id, cliente_carteira_id, frente, nome, whatsapp, link_formulario)
     VALUES ($1, $2, 'trafego', 'Agência X', '71 97777-0000', 'https://form.exemplo.com')`,
    [grupoA, clienteA],
  )

  pixOriginal = (
    await migrate.query<{ chave_pix: string | null; favorecido: string | null }>(
      'SELECT chave_pix, favorecido FROM configuracao_da_carteira WHERE unica',
    )
  ).rows[0]!
  await migrate.query('UPDATE configuracao_da_carteira SET chave_pix = $1 WHERE unica', [PIX])
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('UPDATE configuracao_da_carteira SET chave_pix = $1, favorecido = $2 WHERE unica', [
    pixOriginal.chave_pix,
    pixOriginal.favorecido,
  ])
  await migrate.query('DELETE FROM envios_de_mensagem WHERE cliente_carteira_id = ANY($1) OR lead_comercial_id = ANY($2)', [
    [clienteA, clienteA2],
    [leadPix, leadOposto],
  ])
  await migrate.query('DELETE FROM roteiros_comerciais WHERE id = ANY($1)', [roteirosCriados])
  await migrate.query('DELETE FROM mensagens_comerciais WHERE chave = ANY($1)', [modelosCriados])
  await migrate.query('DELETE FROM tarefas_internas WHERE id = $1', [tarefaA])
  await migrate.query('DELETE FROM leads_comerciais WHERE id = ANY($1)', [[leadPix, leadOposto]])
  await migrate.query('DELETE FROM parceiros_do_cliente WHERE cliente_carteira_id = ANY($1)', [[clienteA, clienteA2]])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [[clienteA, clienteA2]])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [[geral.id, doA.id, doB.id]])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await migrate.end()
  await banco.onModuleDestroy()
})

describe('modelos e roteiros padrão (X4, L10, T8)', () => {
  it('os sete modelos do protótipo, na ordem dele; só a diretoria edita', async () => {
    const m = await semValores.listarModelos(doA)
    expect(m.modelos.slice(0, 7).map((x) => x.chave)).toEqual([
      'pagamento',
      'fluxo',
      'dre',
      'formulario',
      'cobranca',
      'acessos',
      'semanal',
    ])
    expect(m.podeEditar).toBe(false)
    expect((await semValores.listarModelos(geral)).podeEditar).toBe(true)
  })

  it('os oito roteiros; o primeiro contato diz de onde veio o contato (A39)', async () => {
    const r = await semValores.listarRoteiros(doA)
    const chaves = r.roteiros.map((x) => x.chave)
    for (const k of ['primeiro', 'agendar', 'confirmacao', 'diagnostico', 'proposta', 'objecoes', 'retomada', 'agradecimento']) {
      expect(chaves).toContain(k)
    }
    expect(r.roteiros.find((x) => x.chave === 'primeiro')!.mensagem).toContain('{origem_do_contato}')
  })

  it('quem é de um grupo não cria modelo — nem pelo serviço, nem direto no banco (RLS A-19)', async () => {
    await expect(semValores.criarModelo(doA, { titulo: 'X', texto: 'Olá {cliente}' })).rejects.toBeInstanceOf(SemPermissao)
    await expect(
      banco.nasTabelasDaCarteiraComoUsuarioDeGestao(doA, (c) =>
        c.query(`INSERT INTO mensagens_comerciais (chave, titulo, texto) VALUES ('m_burla', 'x', 'y')`),
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('a diretoria cria e edita modelo; variável desconhecida recusa', async () => {
    const m = await semValores.criarModelo(geral, { titulo: 'Teste 3A', texto: 'Olá, {responsavel}!' })
    modelosCriados.push(m.chave)
    expect(m.chave).toMatch(/^m_[0-9a-f]{12}$/)
    const e = await semValores.editarModelo(geral, m.chave, { texto: 'Oi, {responsavel}, de {cliente}.' })
    expect(e.texto).toBe('Oi, {responsavel}, de {cliente}.')
    await expect(semValores.editarModelo(geral, m.chave, { texto: '{nome}' })).rejects.toBeInstanceOf(EntradaInvalida)
  })

  it('o primeiro contato não perde a origem: nem pelo serviço, nem pelo banco', async () => {
    const id = (await semValores.listarRoteiros(geral)).roteiros.find((x) => x.chave === 'primeiro')!.id
    await expect(semValores.editarRoteiro(geral, id, { mensagem: 'Olá, {nome}!' })).rejects.toMatchObject({
      codigo: 'ORIGEM_OBRIGATORIA',
    })
    await expect(
      banco.nasTabelasDaCarteiraComoUsuarioDeGestao(geral, (c) =>
        c.query(`UPDATE roteiros_comerciais SET mensagem = 'Olá' WHERE id = $1`, [id]),
      ),
    ).rejects.toThrow(/roteiros_primeiro_contato_diz_a_origem/)
  })

  it('roteiro criado arquiva; o padrão não', async () => {
    const r = await semValores.criarRoteiro(geral, { titulo: 'Pós-evento', quando: '', mensagem: 'Oi, {nome}!', passos: ['Um'] })
    roteirosCriados.push(r.id)
    await semValores.arquivarRoteiro(geral, r.id)
    expect((await semValores.listarRoteiros(geral)).roteiros.map((x) => x.id)).not.toContain(r.id)
    const padrao = (await semValores.listarRoteiros(geral)).roteiros.find((x) => x.chave === 'agendar')!.id
    await expect(semValores.arquivarRoteiro(geral, padrao)).rejects.toMatchObject({ codigo: 'ROTEIRO_PADRAO' })
  })
})

describe('redação antes do preenchimento (A-14, LGPD A35, T-21)', () => {
  it('sem valores: nenhum R$, nenhuma chave Pix, sem telefone, e o envio não conta', async () => {
    const m = await semValores.montar(doA, paraCliente('pagamento'))
    expect(m.texto).not.toContain('R$')
    expect(m.texto).not.toContain(PIX)
    expect(m.texto).toContain('(valor restrito)')
    expect(m.restrita).toBe(true)
    expect(m.telefone).toBeNull()
    expect(m.avisos.join(' ')).toContain('restritos')
    await expect(
      semValores.registrarEnvio(doA, { chaveIdempotencia: randomUUID(), destino: paraCliente('pagamento') }),
    ).rejects.toBeInstanceOf(MensagemRestrita)
  })

  it('a configuração não entrega a chave Pix sem valores, e não deixa gravar', async () => {
    const c = await semValores.lerConfiguracao(geral)
    expect(c.chavePix).toBeNull()
    expect(c.pagamentoVisivel).toBe(false)
    expect(c.beneficio).toBe('10% de desconto na mensalidade seguinte')
    await expect(semValores.editarPagamento(geral, { chavePix: 'x', favorecido: 'y' })).rejects.toBeInstanceOf(SemPermissao)
  })

  it('com valores (o caminho da 0.5): valor exato, Pix, vencimento do cliente e telefone de cobrança', async () => {
    const m = await comValores.montar(doA, paraCliente('pagamento', { tarefaInternaId: tarefaA }))
    expect(m.texto).toContain('mensalidade de novembro, no valor de R$ 2.800,00, vence no dia 10/11.')
    expect(m.texto).toContain(`Pix: ${PIX}`)
    expect(m.texto).toContain('Aqui é a Manu, da Firmare.')
    expect(m.telefone).toBe('5571988880000')
    expect(m.destinatario).toBe('cobranca')
    expect(m.restrita).toBe(false)
  })

  it('com valores, só a diretoria grava os dados de pagamento', async () => {
    await expect(comValores.editarPagamento(doA, { chavePix: 'x', favorecido: 'y' })).rejects.toBeInstanceOf(SemPermissao)
    const c = await comValores.editarPagamento(geral, { chavePix: PIX, favorecido: 'Firmare Gestão Empresarial' })
    expect(c.chavePix).toBe(PIX)
  })
})

describe('preenchimento numa passada só (A-14)', () => {
  it('lead chamado "{pix} {valor}" sai literal, e a primeira mensagem diz quem indicou (A39)', async () => {
    const m = await comValores.montar(doA, { para: 'lead', leadId: leadPix, roteiro: 'primeiro' })
    expect(m.texto).toContain('Olá, {pix}!')
    expect(m.texto).not.toContain(PIX)
    expect(m.texto).toContain('Dra. Raphaella Pontes me passou seu contato')
    expect(m.telefone).toBe('5571999991202')
    expect(m.passos.length).toBeGreaterThan(0)
  })
})

describe('oposição ao contato (LGPD A37)', () => {
  it('lead com nao_contatar: nem monta, nem registra', async () => {
    const destino: DestinoDaMensagem = { para: 'lead', leadId: leadOposto, roteiro: 'agendar' }
    await expect(semValores.montar(doA, destino)).rejects.toBeInstanceOf(NaoContatar)
    await expect(semValores.registrarEnvio(doA, { chaveIdempotencia: randomUUID(), destino })).rejects.toBeInstanceOf(
      NaoContatar,
    )
  })

  it('parceiro com oposição: a mensagem da frente é recusada; sem oposição, sai para ele', async () => {
    const destino = paraCliente('formulario', { frente: 'trafego' })
    const antes = await semValores.montar(doA, destino)
    expect(antes.texto).toContain('Olá, Agência X!')
    expect(antes.texto).toContain('https://form.exemplo.com')
    expect(antes.telefone).toBe('5571977770000')
    expect(antes.destinatario).toBe('parceiro')

    await semValores.marcarOposicaoDoParceiro(doA, clienteA, 'trafego', true)
    await expect(semValores.montar(doA, destino)).rejects.toBeInstanceOf(NaoContatar)
    await semValores.marcarOposicaoDoParceiro(doA, clienteA, 'trafego', false)
    expect((await semValores.montar(doA, destino)).telefone).toBe('5571977770000')
  })
})

describe('marcar como enviada: o fato, confirmado, idempotente (PP-6, LGPD A36, A-14)', () => {
  it('nada é registrado ao montar; só a confirmação grava, e repetir não duplica', async () => {
    const destino = paraCliente('acessos')
    const antes = await contarEnvios()
    const m = await semValores.montar(doA, destino)
    expect(m.ultimoEnvioConfirmado).toBeNull()
    expect(await contarEnvios()).toBe(antes)

    const chave = randomUUID()
    const um = await semValores.registrarEnvio(doA, { chaveIdempotencia: chave, destino })
    const dois = await semValores.registrarEnvio(doA, { chaveIdempotencia: chave, destino })
    const tres = await semValores.registrarEnvio(doA, { chaveIdempotencia: chave, destino })
    expect(um.repetido).toBe(false)
    expect(dois).toEqual({ ...um, repetido: true })
    expect(tres.repetido).toBe(true)
    expect(await contarEnvios()).toBe(antes + 1)
    expect((await semValores.montar(doA, destino)).ultimoEnvioConfirmado).toEqual({
      em: um.envioConfirmadoEm,
      dia: um.envioConfirmadoNoDia,
    })
  })

  it('a mesma chave para outro destino é recusada', async () => {
    const chave = randomUUID()
    await semValores.registrarEnvio(doA, { chaveIdempotencia: chave, destino: paraCliente('fluxo') })
    await expect(
      semValores.registrarEnvio(doA, { chaveIdempotencia: chave, destino: paraCliente('dre') }),
    ).rejects.toBeInstanceOf(ChaveReutilizada)
  })

  it('a tabela não tem onde guardar o texto (A36)', async () => {
    const r = await migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'envios_de_mensagem'`,
    )
    const colunas = r.rows.map((x) => x.column_name)
    expect(colunas).toContain('enviada_em')
    for (const c of colunas) expect(c).not.toMatch(/texto|mensagem|corpo|conteudo/)
  })

  it('envio é append-only para a carteira', async () => {
    await expect(
      banco.nasTabelasDaCarteiraComoUsuarioDeGestao(doA, (c) =>
        c.query(`UPDATE envios_de_mensagem SET chave = 'x' WHERE cliente_carteira_id = $1`, [clienteA]),
      ),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('isolamento por grupo', () => {
  it('outro grupo não monta mensagem de cliente, lead nem tarefa daqui — a mesma resposta de "não existe"', async () => {
    await expect(semValores.montar(doB, paraCliente('acessos'))).rejects.toBeInstanceOf(NaoEncontrado)
    await expect(semValores.montar(doB, { para: 'lead', leadId: leadPix, roteiro: 'agendar' })).rejects.toBeInstanceOf(
      NaoEncontrado,
    )
    await expect(
      semValores.registrarEnvio(doB, { chaveIdempotencia: randomUUID(), destino: paraCliente('acessos') }),
    ).rejects.toBeInstanceOf(NaoEncontrado)
    await expect(semValores.marcarOposicaoDoParceiro(doB, clienteA, 'trafego', true)).rejects.toBeInstanceOf(NaoEncontrado)
  })

  it('outro grupo não enxerga os envios daqui', async () => {
    await semValores.registrarEnvio(doA, { chaveIdempotencia: randomUUID(), destino: paraCliente('semanal') })
    const visto = await banco.nasTabelasDaCarteiraComoUsuarioDeGestao(doB, (c) =>
      c.query('SELECT id FROM envios_de_mensagem WHERE cliente_carteira_id = $1', [clienteA]),
    )
    expect(visto.rows).toEqual([])
  })

  it('a tarefa de um cliente não serve para montar a mensagem de outro', async () => {
    await expect(
      semValores.montar(doA, { para: 'cliente', clienteId: clienteA2, chave: 'acessos', tarefaInternaId: tarefaA }),
    ).rejects.toBeInstanceOf(NaoEncontrado)
  })
})
