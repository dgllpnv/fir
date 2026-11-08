import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { BancoService } from '../../banco/banco.service'
import { declararAtorSistema } from '../../banco/limpeza-de-teste'
import { registrarCookie } from '../../main'
import { type Antivirus, AntivirusIndisponivel, ClamdPorTcp } from './antivirus'
import { ArmazenamentoCifradoEmDisco, segredoDeAnexosDoAmbiente } from './armazenamento-de-anexos'
import { VarreduraDeAnexos } from './varredura-de-anexos'

/**
 * ANEXOS DE ARQUIVO (G8 4C, gate appsec A-13) — app inteiro, Postgres real,
 * volume num diretório temporário, e o antivírus pelo seam `Antivirus`
 * (o fluxo `pendente → limpo|infectado` é o mesmo do clamd; o protocolo do
 * clamd tem teste próprio em `antivirus.test.ts`).
 */

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'lapis-verde-na-gaveta-sete'
const sufixo = randomBytes(4).toString('hex')

/** O "vírus" de teste: o antivírus de mentira acusa qualquer arquivo com esta marca. */
const MARCA_DE_VIRUS = 'FIR-TESTE-DE-VIRUS-NAO-E-VIRUS'
let antivirusFora = false
const antivirusDeTeste: Antivirus = {
  varrer: async (conteudo) => {
    if (antivirusFora) throw new AntivirusIndisponivel('fora do ar no teste')
    return conteudo.includes(MARCA_DE_VIRUS)
      ? { situacao: 'infectado', assinatura: 'Fir.Teste' }
      : { situacao: 'limpo' }
  },
}

let app: NestFastifyApplication
let migrate: pg.Client
let banco: BancoService
let varredura: VarreduraDeAnexos
let diretorio: string

let grupoA: string
let grupoB: string
let clienteA: string
let clienteA2: string
let clienteB: string
let reuniaoA: string
let reuniaoA2: string
let reuniaoB: string
let documentoA: string
let gestaoA: string
let gestaoB: string
let portalA: string
let portalA2: string
let cookieA: string
let cookieB: string
let cookiePortalA: string
let cookiePortalA2: string

const http = () => request(app.getHttpServer())
const paresDe = (r: { headers: Record<string, unknown> }): string => {
  const v = r.headers['set-cookie']
  const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
  return lista.map((c) => c.split(';')[0]!).join('; ')
}

const PDF = Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\nconteudo-secreto-${sufixo}\n%%EOF\n`, 'latin1')

const enviar = (
  cookie: string,
  donoTipo: string,
  donoId: string,
  conteudo: Buffer,
  nome: string,
  contentType = 'application/octet-stream',
) =>
  http()
    .post('/v1/carteira/anexos')
    .set('Cookie', cookie)
    .field('donoTipo', donoTipo)
    .field('donoId', donoId)
    .attach('arquivo', conteudo, { filename: nome, contentType })

const linhaDe = async (id: string) =>
  (
    await migrate.query<{ situacao_varredura: string; chave_armazenamento: string; removido_em: Date | null }>(
      'SELECT situacao_varredura, chave_armazenamento, removido_em FROM anexos_carteira WHERE id = $1',
      [id],
    )
  ).rows[0]!

const existeNoDisco = async (chave: string): Promise<boolean> => (await readdir(diretorio)).includes(chave)

beforeAll(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'fir-anexos-e2e-'))
  process.env['DIRETORIO_ANEXOS'] = diretorio

  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  const um = async <T = string>(sql: string, p: unknown[] = []): Promise<T> =>
    (await migrate.query<{ id: T }>(sql, p)).rows[0]!.id

  grupoA = await um(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Anexos A ${sufixo}`])
  grupoB = await um(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Anexos B ${sufixo}`])
  clienteA = await um(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto) VALUES ($1, 'Cliente A', 'Consultoria') RETURNING id`,
    [grupoA],
  )
  clienteA2 = await um(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto) VALUES ($1, 'Cliente A2', 'Consultoria') RETURNING id`,
    [grupoA],
  )
  clienteB = await um(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto) VALUES ($1, 'Cliente B', 'Consultoria') RETURNING id`,
    [grupoB],
  )

  const novaGestao = async (usuario: string, grupo: string) =>
    um(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id)
       VALUES ($1, 'Gestora', $2, 'grupo', $3) RETURNING id`,
      [usuario, await hashDeSenha(SENHA), grupo],
    )
  gestaoA = await novaGestao(`anexos.a.${sufixo}`, grupoA)
  gestaoB = await novaGestao(`anexos.b.${sufixo}`, grupoB)

  const novaReuniao = (cliente: string, grupo: string, por: string) =>
    um(
      `INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, por_usuario_gestao_id)
       VALUES ($1, $2, '2026-11-01', 'Reunião mensal', $3) RETURNING id`,
      [cliente, grupo, por],
    )
  reuniaoA = await novaReuniao(clienteA, grupoA, gestaoA)
  reuniaoA2 = await novaReuniao(clienteA2, grupoA, gestaoA)
  reuniaoB = await novaReuniao(clienteB, grupoB, gestaoB)
  documentoA = await um(
    `INSERT INTO documentos_carteira (cliente_carteira_id, grupo_id, titulo, categoria, link, data, visivel_portal, criado_por)
     VALUES ($1, $2, 'Contrato', 'Contrato', 'https://exemplo.com/c', '2026-11-01', false, $3) RETURNING id`,
    [clienteA, grupoA, gestaoA],
  )

  const novoPortal = async (usuario: string, cliente: string) =>
    um(
      `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo, cliente_carteira_id)
       VALUES ($1, 'Cliente', $2, 'cliente', $3) RETURNING id`,
      [usuario, await hashDeSenha(SENHA), cliente],
    )
  portalA = await novoPortal(`portal.anexos.a.${sufixo}`, clienteA)
  portalA2 = await novoPortal(`portal.anexos.a2.${sufixo}`, clienteA2)

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()

  banco = new BancoService()
  varredura = new VarreduraDeAnexos(
    banco,
    new ArmazenamentoCifradoEmDisco(diretorio, segredoDeAnexosDoAmbiente()),
    antivirusDeTeste,
  )

  const entrarCarteira = async (usuario: string) =>
    paresDe(await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200))
  const entrarPortal = async (usuario: string) =>
    paresDe(await http().post('/v1/portal/entrar').send({ usuario, senha: SENHA }).expect(200))
  cookieA = await entrarCarteira(`anexos.a.${sufixo}`)
  cookieB = await entrarCarteira(`anexos.b.${sufixo}`)
  cookiePortalA = await entrarPortal(`portal.anexos.a.${sufixo}`)
  cookiePortalA2 = await entrarPortal(`portal.anexos.a2.${sufixo}`)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const grupos = [grupoA, grupoB]
  await migrate.query('DELETE FROM anexos_carteira WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM reunioes_comerciais WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM documentos_carteira WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM sessoes_do_portal WHERE usuario_portal_id = ANY($1)', [[portalA, portalA2]])
  await migrate.query('DELETE FROM usuarios_do_portal WHERE id = ANY($1)', [[portalA, portalA2]])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [[gestaoA, gestaoB]])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [[gestaoA, gestaoB]])
  await migrate.query('DELETE FROM clientes_carteira WHERE grupo_id = ANY($1)', [grupos])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [grupos])
  await migrate.end()
  await banco.onModuleDestroy()
  await app.close()
  await rm(diretorio, { recursive: true, force: true })
})

describe('POST /v1/carteira/anexos — envio', () => {
  it('grava pendente, com o tipo dos BYTES, e o arquivo no disco é cifrado (bytes ≠ original)', async () => {
    const r = await enviar(cookieA, 'reuniao', reuniaoA, PDF, 'ata.txt', 'text/plain').expect(201)
    expect(r.body).toMatchObject({
      jaExistia: false,
      anexo: { donoTipo: 'reuniao', donoId: reuniaoA, tipo: 'application/pdf', situacao: 'pendente', tamanho: PDF.length },
    })
    // A extensão vira a do tipo real: o "ata.txt" que é PDF baixa como PDF.
    expect(r.body.anexo.nome).toBe('ata.txt.pdf')

    const linha = await linhaDe(r.body.anexo.id)
    expect(linha.situacao_varredura).toBe('pendente')
    // O nome no disco é a chave UUID, nunca o nome do usuário.
    const noDisco = await readFile(join(diretorio, linha.chave_armazenamento))
    expect(noDisco.equals(PDF)).toBe(false)
    expect(noDisco.includes(Buffer.from(`conteudo-secreto-${sufixo}`))).toBe(false)
    expect(noDisco.includes(Buffer.from('%PDF'))).toBe(false)
    expect((await readdir(diretorio)).some((n) => n.includes('ata'))).toBe(false)
  })

  it('reenviar o mesmo arquivo ao mesmo dono devolve o MESMO anexo e não deixa arquivo a mais (A-20)', async () => {
    const conteudo = Buffer.from(`%PDF-1.4\nduplicado-${sufixo}\n`, 'latin1')
    const primeiro = await enviar(cookieA, 'reuniao', reuniaoA, conteudo, 'dup.pdf').expect(201)
    const arquivosAntes = (await readdir(diretorio)).length
    const segundo = await enviar(cookieA, 'reuniao', reuniaoA, conteudo, 'dup.pdf').expect(201)
    const terceiro = await enviar(cookieA, 'reuniao', reuniaoA, conteudo, 'dup.pdf').expect(201)
    expect(segundo.body.jaExistia).toBe(true)
    expect(terceiro.body.anexo.id).toBe(primeiro.body.anexo.id)
    expect((await readdir(diretorio)).length).toBe(arquivosAntes)
    const n = await migrate.query('SELECT 1 FROM anexos_carteira WHERE dono_id = $1 AND tamanho = $2', [
      reuniaoA,
      conteudo.length,
    ])
    expect(n.rowCount).toBe(1)
  })

  it.each([
    ['SVG com nome e Content-Type de PNG', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'foto.png', 'image/png'],
    ['HTML com nome de texto', '<!doctype html><html><body><script>fetch("/api")</script></body></html>', 'nota.txt', 'text/plain'],
    ['HTML com Content-Type de PDF', '<html><img src=x onerror=alert(1)>', 'contrato.pdf', 'application/pdf'],
  ])('%s → 415, nada gravado', async (_rotulo, conteudo, nome, tipo) => {
    const antes = (await readdir(diretorio)).length
    const r = await enviar(cookieA, 'reuniao', reuniaoA, Buffer.from(conteudo, 'utf8'), nome, tipo).expect(415)
    expect(r.body.codigo).toBe('ANEXO_TIPO_NAO_ACEITO')
    expect((await readdir(diretorio)).length).toBe(antes)
  })

  it('executável com nome de PDF → 415', async () => {
    const pe = Buffer.alloc(256)
    pe.write('MZ', 0, 'latin1')
    const r = await enviar(cookieA, 'reuniao', reuniaoA, pe, 'relatorio.pdf', 'application/pdf').expect(415)
    expect(r.body.codigo).toBe('ANEXO_TIPO_NAO_ACEITO')
  })

  /** Monta o corpo multipart à mão, para mandar pelo `inject` sem socket. */
  const corpoMultipart = (fronteira: string, conteudo: Buffer): Buffer =>
    Buffer.concat([
      Buffer.from(
        `--${fronteira}\r\nContent-Disposition: form-data; name="donoTipo"\r\n\r\nreuniao\r\n` +
          `--${fronteira}\r\nContent-Disposition: form-data; name="donoId"\r\n\r\n${reuniaoA}\r\n` +
          `--${fronteira}\r\nContent-Disposition: form-data; name="arquivo"; filename="grande.pdf"\r\n` +
          `Content-Type: application/pdf\r\n\r\n`,
      ),
      conteudo,
      Buffer.from(`\r\n--${fronteira}--\r\n`),
    ])

  it('mais de 20 MB declarado no Content-Length → 413 antes de ler o corpo', async () => {
    const fronteira = `fir${sufixo}`
    const grande = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20 * 1024 * 1024 + 10, 0x41)])
    const r = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/carteira/anexos',
      headers: { cookie: cookieA, 'content-type': `multipart/form-data; boundary=${fronteira}` },
      payload: corpoMultipart(fronteira, grande),
    })
    expect(r.statusCode).toBe(413)
    expect(r.json()).toMatchObject({ codigo: 'ANEXO_GRANDE_DEMAIS' })
  })

  it('mais de 20 MB SEM Content-Length (chunked) → 413 pela contagem no stream, nada gravado', async () => {
    const fronteira = `fir${sufixo}c`
    const antes = (await readdir(diretorio)).length
    const grande = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20 * 1024 * 1024 + 10, 0x41)])
    const r = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/carteira/anexos',
      headers: {
        cookie: cookieA,
        'content-type': `multipart/form-data; boundary=${fronteira}`,
        'transfer-encoding': 'chunked',
      },
      payload: Readable.from([corpoMultipart(fronteira, grande)]),
    })
    expect(r.statusCode).toBe(413)
    expect(r.json()).toMatchObject({ codigo: 'ANEXO_GRANDE_DEMAIS' })
    expect((await readdir(diretorio)).length).toBe(antes)
  })

  it('exatamente 20 MB passa', async () => {
    const vinte = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(20 * 1024 * 1024 - 9, 0x42)])
    expect(vinte.length).toBe(20 * 1024 * 1024)
    const r = await enviar(cookieA, 'documento', documentoA, vinte, 'vinte.pdf').expect(201)
    expect(r.body.anexo.tamanho).toBe(20 * 1024 * 1024)
  })

  it('dono de OUTRO grupo → 404, e nada é gravado', async () => {
    const antes = (await readdir(diretorio)).length
    await enviar(cookieA, 'reuniao', reuniaoB, PDF, 'x.pdf').expect(404)
    await enviar(cookieB, 'reuniao', reuniaoA, PDF, 'x.pdf').expect(404)
    expect((await readdir(diretorio)).length).toBe(antes)
  })

  it('sem sessão de carteira → 404 (não confirma que a rota existe)', async () => {
    await http().post('/v1/carteira/anexos').field('donoTipo', 'reuniao').field('donoId', reuniaoA).expect(404)
    await http().post('/v1/carteira/anexos').set('Cookie', cookiePortalA).expect(404)
  })

  it('campos depois do arquivo, ou ausentes → 400', async () => {
    await http()
      .post('/v1/carteira/anexos')
      .set('Cookie', cookieA)
      .attach('arquivo', PDF, 'a.pdf')
      .field('donoTipo', 'reuniao')
      .field('donoId', reuniaoA)
      .expect(400)
  })
})

describe('varredura → download pela equipe', () => {
  it('pendente não é servido nem à equipe (falha fechada); depois de limpo, é — com os cabeçalhos do A-13 e o acesso registrado', async () => {
    const conteudo = Buffer.from(`%PDF-1.5\nvarredura-${sufixo}\n`, 'latin1')
    const { body } = await enviar(cookieA, 'reuniao', reuniaoA, conteudo, 'Relatório "final"; v2.pdf').expect(201)
    const id: string = body.anexo.id

    const pendente = await http().get(`/v1/carteira/anexos/${id}/conteudo`).set('Cookie', cookieA).expect(409)
    expect(pendente.body.codigo).toBe('ANEXO_EM_VERIFICACAO')

    const resumo = await varredura.executar()
    expect(resumo.limpos).toBeGreaterThanOrEqual(1)
    expect((await linhaDe(id)).situacao_varredura).toBe('limpo')

    const r = await http()
      .get(`/v1/carteira/anexos/${id}/conteudo`)
      .set('Cookie', cookieA)
      .buffer(true)
      .parse((res, fim) => {
        const partes: Buffer[] = []
        res.on('data', (d: Buffer) => partes.push(d))
        res.on('end', () => fim(null, Buffer.concat(partes)))
      })
      .expect(200)
    expect((r.body as Buffer).equals(conteudo)).toBe(true)
    expect(r.headers['content-type']).toBe('application/pdf')
    expect(r.headers['content-disposition']).toBe(
      `attachment; filename="Relatorio _final__ v2.pdf"; filename*=UTF-8''Relat%C3%B3rio%20%22final%22%3B%20v2.pdf`,
    )
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['content-security-policy']).toMatch(/^sandbox/)
    expect(r.headers['cache-control']).toBe('private, no-store')

    const acesso = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria_do_painel
        WHERE acao = 'acessou' AND entidade = 'anexos_carteira' AND entidade_id = $1`,
      [id],
    )
    expect(acesso.rows).toEqual([{ ator_tipo: 'usuario_gestao', ator_id: gestaoA }])
  })

  it('infectado: a linha fica (trilha), o arquivo some do disco, e ninguém baixa', async () => {
    const { body } = await enviar(
      cookieA,
      'reuniao',
      reuniaoA,
      Buffer.from(`relatorio\n${MARCA_DE_VIRUS}\n`, 'utf8'),
      'virus.txt',
    ).expect(201)
    const id: string = body.anexo.id
    const chave = (await linhaDe(id)).chave_armazenamento
    expect(await existeNoDisco(chave)).toBe(true)

    await varredura.executar()
    expect((await linhaDe(id)).situacao_varredura).toBe('infectado')
    expect(await existeNoDisco(chave)).toBe(false)

    const r = await http().get(`/v1/carteira/anexos/${id}/conteudo`).set('Cookie', cookieA).expect(409)
    expect(r.body.codigo).toBe('ANEXO_RECUSADO_PELO_ANTIVIRUS')

    // A trilha do resultado: trigger em auditoria_do_painel, ator sistema.
    const trilha = await migrate.query<{ ator_tipo: string; para: { situacao_varredura?: string } }>(
      `SELECT ator_tipo, para FROM auditoria_do_painel
        WHERE entidade = 'anexos_carteira' AND entidade_id = $1 AND acao = 'alterou'`,
      [id],
    )
    expect(trilha.rows).toEqual([{ ator_tipo: 'sistema', para: { situacao_varredura: 'infectado' } }])
  })

  it('antivírus fora do ar: a rodada falha, o anexo continua pendente e não é servido', async () => {
    const { body } = await enviar(
      cookieA,
      'reuniao',
      reuniaoA,
      Buffer.from(`%PDF-1.3\nsem-antivirus-${sufixo}\n`, 'latin1'),
      'x.pdf',
    ).expect(201)
    antivirusFora = true
    try {
      await expect(varredura.executar()).rejects.toBeInstanceOf(AntivirusIndisponivel)
    } finally {
      antivirusFora = false
    }
    expect((await linhaDe(body.anexo.id)).situacao_varredura).toBe('pendente')
    await http().get(`/v1/carteira/anexos/${body.anexo.id}/conteudo`).set('Cookie', cookieA).expect(409)
    // Reentrante: a próxima rodada termina o serviço, uma vez só.
    await varredura.executar()
    await varredura.executar()
    expect((await linhaDe(body.anexo.id)).situacao_varredura).toBe('limpo')
  })

  it('outro grupo: lista vazia, download 404, remover 404', async () => {
    const { body } = await enviar(cookieA, 'reuniao', reuniaoA, Buffer.from(`%PDF-1.2\nisolado-${sufixo}`), 'i.pdf').expect(201)
    await varredura.executar()
    const lista = await http()
      .get('/v1/carteira/anexos')
      .query({ donoTipo: 'reuniao', donoId: reuniaoA })
      .set('Cookie', cookieB)
      .expect(200)
    expect(lista.body.anexos).toEqual([])
    await http().get(`/v1/carteira/anexos/${body.anexo.id}/conteudo`).set('Cookie', cookieB).expect(404)
    await http().delete(`/v1/carteira/anexos/${body.anexo.id}`).set('Cookie', cookieB).expect(404)
    expect((await linhaDe(body.anexo.id)).removido_em).toBeNull()
  })

  it('remover é estado: some da lista e do download, a linha fica, e remover de novo é 204', async () => {
    const { body } = await enviar(cookieA, 'reuniao', reuniaoA, Buffer.from(`%PDF-1.2\nremover-${sufixo}`), 'r.pdf').expect(201)
    await varredura.executar()
    await http().delete(`/v1/carteira/anexos/${body.anexo.id}`).set('Cookie', cookieA).expect(204)
    await http().delete(`/v1/carteira/anexos/${body.anexo.id}`).set('Cookie', cookieA).expect(204)
    expect((await linhaDe(body.anexo.id)).removido_em).not.toBeNull()
    const lista = await http()
      .get('/v1/carteira/anexos')
      .query({ donoTipo: 'reuniao', donoId: reuniaoA })
      .set('Cookie', cookieA)
      .expect(200)
    expect(lista.body.anexos.map((a: { id: string }) => a.id)).not.toContain(body.anexo.id)
    await http().get(`/v1/carteira/anexos/${body.anexo.id}/conteudo`).set('Cookie', cookieA).expect(404)
    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string }>(
      `SELECT ator_tipo, ator_id FROM auditoria_do_painel
        WHERE entidade = 'anexos_carteira' AND entidade_id = $1 AND acao = 'alterou'
          AND para ? 'removido_em'`,
      [body.anexo.id],
    )
    expect(trilha.rows).toEqual([{ ator_tipo: 'usuario_gestao', ator_id: gestaoA }])
  })
})

describe('portal: só anexo limpo de dono compartilhado', () => {
  const baixarNoPortal = (cookie: string, id: string) =>
    http().get(`/v1/portal/anexos/${id}/conteudo`).set('Cookie', cookie)
  const listarNoPortal = (cookie: string, donoTipo: string, donoId: string) =>
    http().get('/v1/portal/anexos').query({ donoTipo, donoId }).set('Cookie', cookie)

  it('reunião não compartilhada → não aparece; compartilhada → baixa, com cabeçalhos e acesso registrado; descompartilhada → some', async () => {
    const conteudo = Buffer.from(`%PDF-1.6\nportal-${sufixo}\n`, 'latin1')
    const { body } = await enviar(cookieA, 'reuniao', reuniaoA, conteudo, 'ata-portal.pdf').expect(201)
    const id: string = body.anexo.id
    await varredura.executar()

    await baixarNoPortal(cookiePortalA, id).expect(404)
    expect((await listarNoPortal(cookiePortalA, 'reuniao', reuniaoA).expect(200)).body.anexos).toEqual([])

    await migrate.query('UPDATE reunioes_comerciais SET compartilhada = true, compartilhada_em = now() WHERE id = $1', [reuniaoA])
    try {
      const lista = await listarNoPortal(cookiePortalA, 'reuniao', reuniaoA).expect(200)
      expect(lista.body.anexos.map((a: { id: string }) => a.id)).toContain(id)
      // Lista branca: nem situação, nem quem enviou, nem hash.
      expect(Object.keys(lista.body.anexos[0]).sort()).toEqual(['criadoEm', 'id', 'nome', 'tamanho', 'tipo'])

      const r = await baixarNoPortal(cookiePortalA, id)
        .buffer(true)
        .parse((res, fim) => {
          const partes: Buffer[] = []
          res.on('data', (d: Buffer) => partes.push(d))
          res.on('end', () => fim(null, Buffer.concat(partes)))
        })
        .expect(200)
      expect((r.body as Buffer).equals(conteudo)).toBe(true)
      expect(r.headers['content-disposition']).toMatch(/^attachment; /)
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      expect(r.headers['content-security-policy']).toMatch(/^sandbox/)

      const acesso = await migrate.query<{ ator_tipo: string; ator_id: string }>(
        `SELECT ator_tipo, ator_id FROM auditoria_do_painel
          WHERE acao = 'acessou' AND entidade = 'anexos_carteira' AND entidade_id = $1`,
        [id],
      )
      expect(acesso.rows).toEqual([{ ator_tipo: 'usuario_portal', ator_id: portalA }])

      // Outro cliente do MESMO grupo não vê.
      await baixarNoPortal(cookiePortalA2, id).expect(404)
    } finally {
      await migrate.query('UPDATE reunioes_comerciais SET compartilhada = false WHERE id = $1', [reuniaoA])
    }
    await baixarNoPortal(cookiePortalA, id).expect(404)
  })

  it('em reunião compartilhada, pendente, infectado e removido continuam 404', async () => {
    await migrate.query('UPDATE reunioes_comerciais SET compartilhada = true, compartilhada_em = now() WHERE id = $1', [reuniaoA2])
    try {
      const pendente = await enviar(cookieA, 'reuniao', reuniaoA2, Buffer.from(`%PDF-1.1\np-${sufixo}`), 'p.pdf').expect(201)
      await baixarNoPortal(cookiePortalA2, pendente.body.anexo.id).expect(404)
      expect((await listarNoPortal(cookiePortalA2, 'reuniao', reuniaoA2).expect(200)).body.anexos).toEqual([])

      const infectado = await enviar(
        cookieA,
        'reuniao',
        reuniaoA2,
        Buffer.from(`x ${MARCA_DE_VIRUS} ${sufixo}`),
        'v.txt',
      ).expect(201)
      const removido = await enviar(cookieA, 'reuniao', reuniaoA2, Buffer.from(`%PDF-1.1\nr-${sufixo}`), 'r.pdf').expect(201)
      await varredura.executar()
      await http().delete(`/v1/carteira/anexos/${removido.body.anexo.id}`).set('Cookie', cookieA).expect(204)

      await baixarNoPortal(cookiePortalA2, pendente.body.anexo.id).expect(200)
      await baixarNoPortal(cookiePortalA2, infectado.body.anexo.id).expect(404)
      await baixarNoPortal(cookiePortalA2, removido.body.anexo.id).expect(404)
    } finally {
      await migrate.query('UPDATE reunioes_comerciais SET compartilhada = false WHERE id = $1', [reuniaoA2])
    }
  })

  it('documento com visivel_portal = false não entrega o anexo', async () => {
    const { body } = await enviar(cookieA, 'documento', documentoA, Buffer.from(`%PDF-1.1\nd-${sufixo}`), 'd.pdf').expect(201)
    await varredura.executar()
    await baixarNoPortal(cookiePortalA, body.anexo.id).expect(404)
    await migrate.query('UPDATE documentos_carteira SET visivel_portal = true WHERE id = $1', [documentoA])
    try {
      await baixarNoPortal(cookiePortalA, body.anexo.id).expect(200)
    } finally {
      await migrate.query('UPDATE documentos_carteira SET visivel_portal = false WHERE id = $1', [documentoA])
    }
  })

  it('a sessão de carteira não abre a rota do portal, e vice-versa', async () => {
    await http().get('/v1/portal/anexos').query({ donoTipo: 'reuniao', donoId: reuniaoA }).set('Cookie', cookieA).expect(404)
    await http().get('/v1/carteira/anexos').query({ donoTipo: 'reuniao', donoId: reuniaoA }).set('Cookie', cookiePortalA).expect(404)
  })
})

describe('no banco: o que nenhuma rota consegue fazer', () => {
  it('um Usuário de Gestão não marca limpo (só o ator sistema muda a situação)', async () => {
    const { body } = await enviar(cookieA, 'reuniao', reuniaoA, Buffer.from(`%PDF-1.1\ntrigger-${sufixo}`), 't.pdf').expect(201)
    await expect(
      banco.nasTabelasDaCarteiraComoUsuarioDeGestao({ id: gestaoA, escopo: 'grupo', grupoId: grupoA }, (c) =>
        c.query(`UPDATE anexos_carteira SET situacao_varredura = 'limpo' WHERE id = $1`, [body.anexo.id]),
      ),
    ).rejects.toThrow(/só o worker de varredura/)
    expect((await linhaDe(body.anexo.id)).situacao_varredura).toBe('pendente')
  })

  it('infectado não volta a limpo nem pelo worker; removido não "desremove"', async () => {
    const r = await migrate.query<{ id: string }>(
      `SELECT id FROM anexos_carteira WHERE grupo_id = $1 AND situacao_varredura = 'infectado' LIMIT 1`,
      [grupoA],
    )
    await expect(
      banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
        c.query(`UPDATE anexos_carteira SET situacao_varredura = 'limpo' WHERE id = $1`, [r.rows[0]!.id]),
      ),
    ).rejects.toThrow(/varredura já terminou/)
    const removido = await migrate.query<{ id: string }>(
      `SELECT id FROM anexos_carteira WHERE grupo_id = $1 AND removido_em IS NOT NULL LIMIT 1`,
      [grupoA],
    )
    await expect(
      banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
        c.query(`UPDATE anexos_carteira SET removido_em = NULL WHERE id = $1`, [removido.rows[0]!.id]),
      ),
    ).rejects.toThrow()
  })

  it('anexo pendurado em reunião de OUTRO cliente é recusado pelo banco', async () => {
    await expect(
      banco.nasTabelasDaCarteiraComoUsuarioDeGestao({ id: gestaoA, escopo: 'grupo', grupoId: grupoA }, (c) =>
        c.query(
          `INSERT INTO anexos_carteira (grupo_id, cliente_carteira_id, dono_tipo, dono_id, nome_original,
                                        tipo_mime, tamanho, sha256, chave_armazenamento, criado_por)
           VALUES ($1, $2, 'reuniao', $3, 'x.pdf', 'application/pdf', 1, repeat('a', 64), gen_random_uuid(), $4)`,
          [grupoA, clienteA, reuniaoA2, gestaoA],
        ),
      ),
    ).rejects.toThrow(/não existe neste cliente e grupo/)
  })

  it('RLS forçada, policies com TO explícito, portal sem verbo de escrita e sem as colunas internas', async () => {
    const rls = await migrate.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'anexos_carteira'`,
    )
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })

    const pol = await migrate.query<{ policyname: string; roles: string[]; qual: string }>(
      `SELECT policyname, roles::text[] AS roles, qual FROM pg_policies WHERE tablename = 'anexos_carteira' ORDER BY 1`,
    )
    expect(pol.rows.map((p) => [p.policyname, p.roles])).toEqual([
      ['anexos_carteira_carteira', ['fir_carteira']],
      ['anexos_carteira_portal', ['fir_portal']],
    ])
    for (const p of pol.rows) expect(p.qual.toUpperCase()).not.toMatch(/\bOR\b/)

    const escrita = await migrate.query(
      `SELECT privilege_type FROM information_schema.table_privileges
        WHERE table_name = 'anexos_carteira' AND grantee IN ('fir_portal', 'fir_app')`,
    )
    expect(escrita.rows).toEqual([])
    const colunas = await migrate.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE table_name = 'anexos_carteira' AND grantee = 'fir_portal' AND privilege_type = 'SELECT'`,
    )
    const vistas = colunas.rows.map((c) => c.column_name)
    expect(vistas).not.toContain('criado_por')
    expect(vistas).not.toContain('sha256')
    const delecao = await migrate.query(
      `SELECT 1 FROM information_schema.table_privileges
        WHERE table_name = 'anexos_carteira' AND grantee = 'fir_carteira' AND privilege_type = 'DELETE'`,
    )
    expect(delecao.rowCount).toBe(0)
  })
})

/** O clamd local (`fir infra`, 4833) está no ar? Sem ele, este bloco é pulado — o seam acima cobre o fluxo. */
const clamdLocal = ClamdPorTcp.doAmbiente()
const clamdNoAr = await clamdLocal.varrer(Buffer.from('ping')).then(
  () => true,
  () => false,
)

describe.skipIf(!clamdNoAr)('ponta a ponta com o clamd de verdade', () => {
  it('a string EICAR enviada como texto termina infectada, sem arquivo no disco; um PDF termina limpo', async () => {
    const real = new VarreduraDeAnexos(
      banco,
      new ArmazenamentoCifradoEmDisco(diretorio, segredoDeAnexosDoAmbiente()),
      clamdLocal,
    )
    // A string de teste EICAR — padrão da indústria, inofensiva.
    const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
    const infectado = await enviar(cookieA, 'reuniao', reuniaoA, Buffer.from(eicar, 'latin1'), 'eicar.txt').expect(201)
    const limpo = await enviar(cookieA, 'reuniao', reuniaoA, Buffer.from(`%PDF-1.4\nclamd-${sufixo}\n`), 'ok.pdf').expect(201)
    const chave = (await linhaDe(infectado.body.anexo.id)).chave_armazenamento

    await real.executar()

    expect((await linhaDe(infectado.body.anexo.id)).situacao_varredura).toBe('infectado')
    expect(await existeNoDisco(chave)).toBe(false)
    expect((await linhaDe(limpo.body.anexo.id)).situacao_varredura).toBe('limpo')
  })
})
