import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes, randomUUID } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { registrarCookie } from '../../main'

/**
 * **G8 3D — o espaço da cliente (O2, O4, O5, O8), a prévia (O9), os acessos
 * (V7, O10) e a regra do benefício (T5, L12)**, contra Postgres real e pelo
 * HTTP de verdade (AppModule inteiro: guards, interceptor de redação).
 *
 * O portal lê com o papel `fir_portal` de verdade (`nasTabelasDaCarteiraComo
 * Portal`): o que este arquivo prova sobre "a cliente não vê" vale para a RLS
 * e para os GRANTs de coluna da 0059, não só para o `WHERE` da aplicação.
 *
 * Mapa dos clientes:
 *  - grupo A: X (com clínica, programa Financeiro, decisora, consultora,
 *    ciclo com fim) e Y (sem clínica, programa Comercial);
 *  - grupo B: Z (programa Gestão) — isolamento cruzando grupos.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const SENHA = 'quatro-pedras-no-caminho'
const sufixo = randomBytes(4).toString('hex')

let app: NestFastifyApplication
let migrate: pg.Client
let grupoA: string
let grupoB: string
let clinicaX: string
let clienteX: string
let clienteY: string
let clienteZ: string
let consultora: string
let gestaoA: string // grupo A, sem `valores`
let gestaoValores: string // geral, com `valores` e `carteira.administrar`
let gestaoB: string // grupo B
let gestaoGeralSemAdministrar: string
let titularX: string
let segundaX: string
let portalY: string
let portalGrupoA: string
let portalZ: string
const usuariosDoPortal: string[] = []
const materiaisBiblioteca: string[] = []

const USUARIO = (n: string) => `p3d.${n}.${sufixo}`
const cookies = (r: { headers: Record<string, string> }): string[] => {
  const v = r.headers['set-cookie'] as unknown
  return Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
}
const paresDe = (lista: string[]): string => lista.map((c) => c.split(';')[0]!).join('; ')
const http = () => request(app.getHttpServer())

const umId = async (sql: string, params: unknown[]): Promise<string> =>
  (await migrate.query<{ id: string }>(sql, params)).rows[0]!.id

const entrarNoPortal = async (usuario: string): Promise<string> =>
  paresDe(cookies(await http().post('/v1/portal/entrar').send({ usuario, senha: SENHA }).expect(200)))
const entrarNaCarteira = async (usuario: string): Promise<string> =>
  paresDe(cookies(await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200)))

type Secao = Record<string, unknown> & {
  id: string
  nome: string
  materiais: { titulo: string; personalizado: boolean; texto: string | null }[]
  documentos: { titulo: string; arquivos: { nome: string }[] }[]
  reunioes: { resumo: string; links: { nome: string; url: string }[]; arquivos: { nome: string }[] }[]
  campanhas: { tipo: string; nome?: string; quantidade?: number; resultadoEmDinheiro: string | null }[]
  resumoDeCampanhas: { receita: string | null; soDasExibidas: boolean }
  cobrancas: { valor: string | null; mensalidade: string | null }[]
  metas: { titulo: string; prazo: string | null; valorMeta: string | null; avaliacao: { percentual: number | null }; ultimasSemanas: { valor: string | null; altura: number }[] }[]
}

/** A biblioteca é GLOBAL (há material de demonstração no banco): as asserções olham os deste arquivo e os personalizados. */
const meus = (ms: { titulo: string; personalizado: boolean }[]): string[] =>
  ms.filter((m) => m.personalizado || m.titulo.endsWith(sufixo)).map((m) => m.titulo)

const lerPortal = async (usuario: string): Promise<Secao[]> => {
  // O cookie ANTES de montar a requisição: o supertest fecha o servidor efêmero ao fim de cada uma.
  const cookie = await entrarNoPortal(usuario)
  const r = await http().get('/v1/portal/clientes').set('Cookie', cookie).expect(200)
  return r.body.clientes as Secao[]
}

const segundaAtras = (semanas: number): string => {
  const d = new Date()
  const dow = (d.getUTCDay() + 6) % 7 // 0 = segunda
  d.setUTCDate(d.getUTCDate() - dow - 7 * semanas)
  return d.toISOString().slice(0, 10)
}
const mesAtras = (meses: number): string => {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - meses, 1)).toISOString().slice(0, 10)
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)

  grupoA = await umId(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Grupo 3D A ${sufixo}`])
  grupoB = await umId(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [`Grupo 3D B ${sufixo}`])
  clinicaX = await umId(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica 3D X') RETURNING id`, [`p3dx-${sufixo}`])

  const hash = await hashDeSenha(SENHA)
  const novoGestao = async (nome: string, escopo: 'geral' | 'grupo', grupo: string | null, extra: { valores?: boolean; administrar?: boolean } = {}) =>
    umId(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, valores, administrar)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [USUARIO(nome), `Pessoa ${nome}`, hash, escopo, grupo, extra.valores ?? false, extra.administrar ?? null],
    )
  consultora = await umId(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id, telefone)
     VALUES ($1, 'Marina Consultora', $2, 'grupo', $3, '71999990000') RETURNING id`,
    [USUARIO('consultora'), hash, grupoA],
  )
  gestaoA = await novoGestao('a', 'grupo', grupoA)
  gestaoB = await novoGestao('b', 'grupo', grupoB)
  gestaoValores = await novoGestao('valores', 'geral', null, { valores: true, administrar: true })
  gestaoGeralSemAdministrar = await novoGestao('geral', 'geral', null, { administrar: false })

  clienteX = await umId(
    `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status, decisor, area_foco, data_inicio, data_fim,
                                    reuniao_dia_semana, reuniao_hora, responsavel_usuario_gestao_id, observacoes, pagador)
     VALUES ($1, $2, 'Clínica Bela Vista 3D', 'Acelerador FIR', 'ativo', 'Dra. Cristina Albuquerque', 'Financeiro',
             $3, $4, 2, '10:00', $5, 'Observação interna nunca vai ao portal', 'Pagador Terceiro')
     RETURNING id`,
    [grupoA, clinicaX, mesAtras(2), mesAtras(-4), consultora],
  )
  clienteY = await umId(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto, status) VALUES ($1, 'Clínica Yara 3D', 'Consultoria', 'onboarding') RETURNING id`,
    [grupoA],
  )
  clienteZ = await umId(
    `INSERT INTO clientes_carteira (grupo_id, nome, produto, status, area_foco) VALUES ($1, 'Clínica Zeta 3D', 'Gestão FIR', 'ativo', 'Gestão') RETURNING id`,
    [grupoB],
  )

  const novoPortal = async (nome: string, escopo: 'cliente' | 'grupo', alvo: string, veValores: boolean) => {
    const coluna = escopo === 'cliente' ? 'cliente_carteira_id' : 'grupo_id'
    const id = await umId(
      `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo, ${coluna}, ve_valores)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [USUARIO(nome), `Portal ${nome}`, hash, escopo, alvo, veValores],
    )
    usuariosDoPortal.push(id)
    return id
  }
  titularX = await novoPortal('titularx', 'cliente', clienteX, true)
  segundaX = await novoPortal('segundax', 'cliente', clienteX, false)
  portalY = await novoPortal('y', 'cliente', clienteY, true)
  portalGrupoA = await novoPortal('grupoa', 'grupo', grupoA, true)
  portalZ = await novoPortal('z', 'cliente', clienteZ, true)

  // ── Materiais da biblioteca geral ───────────────────────────────────────
  const novoMaterial = async (titulo: string, programas: string[], usoInterno: boolean, arquivado = false) => {
    const id = await umId(
      `INSERT INTO materiais_da_biblioteca (titulo, tipo, uso_interno, programas, link, texto, criado_por, arquivado_em)
       VALUES ($1, 'Planilha', $2, $3, 'https://docs.google.com/x/copy', 'Texto do material', $4, $5) RETURNING id`,
      [`${titulo} ${sufixo}`, usoInterno, programas, gestaoValores, arquivado ? new Date() : null],
    )
    materiaisBiblioteca.push(id)
    return id
  }
  await novoMaterial('Fluxo de caixa', ['Financeiro'], false)
  await novoMaterial('Para todos', ['Todos'], false)
  await novoMaterial('Script comercial', ['Comercial'], false)
  await novoMaterial('Roteiro de gestão', ['Gestão'], false)
  await novoMaterial('Interno financeiro', ['Financeiro'], true)
  await novoMaterial('Arquivado financeiro', ['Financeiro'], false, true)

  // ── Personalizados ──────────────────────────────────────────────────────
  await migrate.query(
    `INSERT INTO materiais_carteira (cliente_carteira_id, grupo_id, titulo, tipo, visivel_portal, texto, criado_por, arquivado_em)
     VALUES ($1, $2, 'Feito para X', 'Script', true, 'Olá X', $3, NULL),
            ($1, $2, 'Interno de X', 'Script', false, NULL, $3, NULL),
            ($1, $2, 'Arquivado de X', 'Script', true, NULL, $3, now()),
            ($4, $2, 'Feito para Y', 'Script', true, NULL, $3, NULL)`,
    [clienteX, grupoA, gestaoA, clienteY],
  )

  // ── Documentos e reuniões ───────────────────────────────────────────────
  const docVisivel = await umId(
    `INSERT INTO documentos_carteira (cliente_carteira_id, grupo_id, titulo, categoria, link, data, visivel_portal, criado_por)
     VALUES ($1, $2, 'Plano de ação', 'Plano de ação', 'https://drive.google.com/a', '2026-10-01', true, $3) RETURNING id`,
    [clienteX, grupoA, gestaoA],
  )
  await migrate.query(
    `INSERT INTO documentos_carteira (cliente_carteira_id, grupo_id, titulo, categoria, link, data, visivel_portal, criado_por, arquivado_em)
     VALUES ($1, $2, 'Diagnóstico interno', 'Diagnóstico', 'https://drive.google.com/b', '2026-10-02', false, $3, NULL),
            ($1, $2, 'Documento arquivado', 'Relatório', 'https://drive.google.com/c', '2026-10-03', true, $3, now())`,
    [clienteX, grupoA, gestaoA],
  )
  const ataCompartilhada = await umId(
    `INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, encaminhamentos, anexos, por_usuario_gestao_id, compartilhada, notas_internas)
     VALUES ($1, $2, '2026-10-08', 'Ata compartilhada 3D', 'Revisar roteiro',
             $3::jsonb, $4, true, 'Nota interna da ata 3D') RETURNING id`,
    [
      clienteX,
      grupoA,
      JSON.stringify([
        { nome: 'Gravação', url: 'https://drive.google.com/gravacao' },
        { nome: 'Inseguro', url: 'http://exemplo.com/x' },
      ]),
      gestaoA,
    ],
  )
  await migrate.query(
    `INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, por_usuario_gestao_id, compartilhada, arquivada_em)
     VALUES ($1, $2, '2026-10-01', 'Ata não compartilhada 3D', $3, false, NULL),
            ($1, $2, '2026-09-01', 'Ata arquivada 3D', $3, true, now())`,
    [clienteX, grupoA, gestaoA],
  )
  const anexo = (dono: string, tipo: 'reuniao' | 'documento', nome: string, situacao: string) =>
    migrate.query(
      `INSERT INTO anexos_carteira (grupo_id, cliente_carteira_id, dono_tipo, dono_id, nome_original, tipo_mime, tamanho,
                                    sha256, chave_armazenamento, situacao_varredura, criado_por)
       VALUES ($1, $2, $3, $4, $5, 'application/pdf', 1000, $6, $7, $8, $9)`,
      [grupoA, clienteX, tipo, dono, nome, randomBytes(32).toString('hex'), randomUUID(), situacao, gestaoA],
    )
  await anexo(ataCompartilhada, 'reuniao', 'ata-limpa.pdf', 'limpo')
  await anexo(ataCompartilhada, 'reuniao', 'ata-pendente.pdf', 'pendente')
  await anexo(docVisivel, 'documento', 'doc-limpo.pdf', 'limpo')

  // ── Campanhas: uma grande (12 pagamentos) e uma pequena (3) neste mês ───
  const mes = mesAtras(0)
  await migrate.query(
    `INSERT INTO campanhas_carteira
       (cliente_carteira_id, grupo_id, origem, nome, periodo_inicio, periodo_fim, metrica, meta, resultado,
        orcamentos_pagos, mes_referencia, receita_centavos, status)
     VALUES ($1, $2, 'manual', 'Campanha Grande 3D', $3, $3, 'receita', 100000, 500000, 12, $3, 500000, 'ativa'),
            ($1, $2, 'manual', 'Botox setembro 3D', $3, $3, 'receita', 10000, 120000, 3, $3, 120000, 'ativa')`,
    [clienteX, grupoA, mes],
  )

  // ── Cobrança e metas (uma mensal SEM prazo, uma com prazo) ──────────────
  await migrate.query(
    `INSERT INTO cobrancas_do_cliente_firmare (cliente_carteira_id, grupo_id, competencia, mensalidade_centavos, desconto_centavos, valor_centavos, vencimento)
     VALUES ($1, $2, $3, 300000, 0, 300000, $3)`,
    [clienteX, grupoA, mes],
  )
  const indicador = await umId(
    `INSERT INTO indicadores_carteira (cliente_carteira_id, grupo_id, nome, unidade, sentido)
     VALUES ($1, $2, 'Faturamento 3D', 'R$', 'maior_melhor') RETURNING id`,
    [clienteX, grupoA],
  )
  await migrate.query(
    `INSERT INTO metas_comerciais (cliente_carteira_id, grupo_id, indicador_id, titulo, sentido, tipo, agregacao,
                                   valor_meta_centavos, inicio, prazo)
     VALUES ($1, $2, $3, 'Faturar no mês 3D', 'maior_melhor', 'mensal', 'soma', 5000000, $4, NULL),
            ($1, $2, $3, 'Meta com prazo 3D', 'maior_melhor', 'prazo', 'soma', 9000000, $4, $5)`,
    [clienteX, grupoA, indicador, mesAtras(1), mesAtras(-3)],
  )
  await migrate.query(
    `INSERT INTO lancamentos_de_indicador (indicador_id, grupo_id, referencia, valor_centavos, lancado_por)
     VALUES ($1, $2, $3, 1000000, $5), ($1, $2, $4, 2500000, $5)`,
    [indicador, grupoA, segundaAtras(1), segundaAtras(0), gestaoA],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const clientes = [clienteX, clienteY, clienteZ]
  const gestao = [consultora, gestaoA, gestaoB, gestaoValores, gestaoGeralSemAdministrar]
  const portal = (await migrate.query<{ id: string }>(`SELECT id FROM usuarios_do_portal WHERE cliente_carteira_id = ANY($1) OR grupo_id = ANY($2)`, [clientes, [grupoA, grupoB]])).rows.map((r) => r.id)
  await migrate.query('DELETE FROM tentativas_do_portal WHERE identificador LIKE $1', [`p3d.%.${sufixo}`])
  await migrate.query('DELETE FROM sessoes_do_portal WHERE usuario_portal_id = ANY($1)', [portal])
  await migrate.query('DELETE FROM usuarios_do_portal WHERE id = ANY($1)', [portal])
  await migrate.query('DELETE FROM anexos_carteira WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM documentos_carteira WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM materiais_carteira WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM materiais_da_biblioteca WHERE id = ANY($1)', [materiaisBiblioteca])
  await migrate.query('DELETE FROM campanhas_carteira WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM lancamentos_de_indicador WHERE grupo_id = ANY($1)', [[grupoA, grupoB]])
  await migrate.query('DELETE FROM metas_comerciais WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM indicadores_carteira WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [gestao])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador LIKE $1', [`p3d.%.${sufixo}`]).catch(() => undefined)
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [gestao])
  await migrate.query('DELETE FROM historico_grupo_da_clinica WHERE clinica_id = $1', [clinicaX]).catch(() => undefined)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]]).catch(() => undefined)
  await apagarClinicaDeTeste(migrate, clinicaX)
  await migrate.end()
  await app.close()
})

describe('o portal nunca vê o que é arquivado, interno ou não compartilhado (fir_portal de verdade)', () => {
  it('materiais: o personalizado visível e os da biblioteca do programa (Financeiro) e de "Todos" — nada interno, arquivado ou de outro programa', async () => {
    const [x] = await lerPortal(USUARIO('titularx'))
    const titulos = meus(x!.materiais)
    expect(titulos).toEqual(['Feito para X', `Fluxo de caixa ${sufixo}`, `Para todos ${sufixo}`])
    expect(x!.materiais[0]).toMatchObject({ personalizado: true, texto: 'Olá X' })
    const tudo = JSON.stringify(x)
    for (const proibido of ['Interno de X', 'Arquivado de X', 'Feito para Y', 'Interno financeiro', 'Arquivado financeiro', 'Script comercial', 'Roteiro de gestão']) {
      expect(tudo).not.toContain(proibido)
    }
  })

  it('documentos: só o visível e não arquivado, com o anexo limpo', async () => {
    const [x] = await lerPortal(USUARIO('titularx'))
    expect(x!.documentos.map((d) => d.titulo)).toEqual(['Plano de ação'])
    expect(x!.documentos[0]!.arquivos.map((a) => a.nome)).toEqual(['doc-limpo.pdf'])
  })

  it('reuniões: só a compartilhada e não arquivada, com os anexos por link https e o arquivo limpo — nunca a nota interna', async () => {
    const [x] = await lerPortal(USUARIO('titularx'))
    expect(x!.reunioes.map((r) => r.resumo)).toEqual(['Ata compartilhada 3D'])
    expect(x!.reunioes[0]!.links).toEqual([{ nome: 'Gravação', url: 'https://drive.google.com/gravacao' }])
    expect(x!.reunioes[0]!.arquivos.map((a) => a.nome)).toEqual(['ata-limpa.pdf'])
    const tudo = JSON.stringify(x)
    for (const proibido of ['Ata não compartilhada', 'Ata arquivada', 'Nota interna da ata', 'ata-pendente', 'http://exemplo.com', 'Observação interna', 'Pagador Terceiro', '71999990000']) {
      expect(tudo).not.toContain(proibido)
    }
  })

  it('O2/O8: saudação da decisora, ciclo com fim e o NOME da consultora com a reunião fixa', async () => {
    const [x] = await lerPortal(USUARIO('titularx'))
    expect(x).toMatchObject({
      saudacao: 'Dra. Cristina',
      programa: 'Financeiro',
      consultora: { nome: 'Marina Consultora', reuniao: { diaDaSemana: 2, hora: '10:00' } },
    })
    expect(x!.ciclo).toMatchObject({ tipo: 'com_fim', mes: 3, total: 6 })
  })

  it('cliente sem clínica nem datas: ciclo "programa", sem consultora — e a leitura não quebra (registro de acesso no painel)', async () => {
    const [y] = await lerPortal(USUARIO('y'))
    expect(y).toMatchObject({ nome: 'Clínica Yara 3D', ciclo: { tipo: 'programa' }, consultora: null, programa: 'Comercial' })
    const trilha = await migrate.query(
      `SELECT 1 FROM auditoria_do_painel WHERE ator_tipo = 'usuario_portal' AND ator_id = $1 AND acao = 'acessou' AND entidade_id = $2`,
      [portalY, clienteY],
    )
    expect(trilha.rows.length).toBeGreaterThan(0)
  })
})

describe('campanhas no portal: supressão k = 5 (CE-3), pela função única do domínio', () => {
  it('a pequena (3 pagamentos) some em "Outras" SEM valor; o total é das exibidas e igual à soma das linhas', async () => {
    const [x] = await lerPortal(USUARIO('titularx'))
    const individuais = x!.campanhas.filter((c) => c.tipo === 'individual')
    expect(individuais.map((c) => c.nome)).toEqual(['Campanha Grande 3D'])
    expect(x!.campanhas.find((c) => c.tipo === 'outras')).toEqual({ tipo: 'outras', quantidade: 1, resultadoEmDinheiro: null })
    expect(JSON.stringify(x!.campanhas)).not.toContain('Botox')
    expect(JSON.stringify(x)).not.toContain('120000')
    expect(x!.resumoDeCampanhas).toEqual(expect.objectContaining({ receita: '500000', soDasExibidas: true }))
    const soma = individuais.reduce((s, c) => s + BigInt(c.resultadoEmDinheiro!), 0n)
    expect(soma.toString()).toBe(x!.resumoDeCampanhas.receita)
  })
})

describe('metas no portal: a mesma avaliação da carteira (O4)', () => {
  it('a meta mensal SEM prazo aparece e não quebra a leitura; a com prazo também', async () => {
    const [x] = await lerPortal(USUARIO('titularx'))
    const porTitulo = new Map(x!.metas.map((m) => [m.titulo, m]))
    expect(porTitulo.get('Faturar no mês 3D')).toMatchObject({ prazo: null, valorMeta: '5000000' })
    expect(porTitulo.get('Meta com prazo 3D')!.prazo).not.toBeNull()
    expect(porTitulo.get('Faturar no mês 3D')!.ultimasSemanas.map((s) => s.valor)).toEqual(['1000000', '2500000'])
    expect(porTitulo.get('Faturar no mês 3D')!.ultimasSemanas.map((s) => s.altura)).toEqual([40, 100])
  })
})

describe('isolamento entre clientes e entre grupos', () => {
  it('escopo=cliente (X) nunca vê Y, do mesmo grupo — nem o personalizado dele', async () => {
    const secoes = await lerPortal(USUARIO('titularx'))
    expect(secoes.map((s) => s.nome)).toEqual(['Clínica Bela Vista 3D'])
  })

  it('escopo=cliente (Y): o programa Comercial traz o "Script comercial" e o "Para todos", nunca o "Fluxo de caixa" de X', async () => {
    const [y] = await lerPortal(USUARIO('y'))
    expect(meus(y!.materiais)).toEqual(['Feito para Y', `Para todos ${sufixo}`, `Script comercial ${sufixo}`])
  })

  it('escopo=grupo (A) vê X e Y, cada um com os materiais do PRÓPRIO programa — nunca Z', async () => {
    const secoes = await lerPortal(USUARIO('grupoa'))
    expect(secoes.map((s) => s.nome).sort()).toEqual(['Clínica Bela Vista 3D', 'Clínica Yara 3D'])
    const y = secoes.find((s) => s.id === clienteY)!
    expect(y.materiais.map((m) => m.titulo)).not.toContain(`Fluxo de caixa ${sufixo}`)
    expect(JSON.stringify(secoes)).not.toContain('Zeta')
    expect(JSON.stringify(secoes)).not.toContain('Roteiro de gestão')
  })

  it('grupo B (Z) vê só o próprio: o material de Gestão, nada do grupo A', async () => {
    const [z, ...resto] = await lerPortal(USUARIO('z'))
    expect(resto).toEqual([])
    expect(meus(z!.materiais)).toEqual([`Para todos ${sufixo}`, `Roteiro de gestão ${sufixo}`])
  })
})

describe('várias contas por cliente: só o titular vê valores (LGPD A52)', () => {
  it('a segunda conta recebe cobrança, campanha e meta em R$ como null — o percentual continua', async () => {
    const [x] = await lerPortal(USUARIO('segundax'))
    expect(x!.cobrancas[0]).toMatchObject({ valor: null, mensalidade: null })
    expect(x!.campanhas.find((c) => c.tipo === 'individual')!.resultadoEmDinheiro).toBeNull()
    expect(x!.resumoDeCampanhas.receita).toBeNull()
    const meta = x!.metas.find((m) => m.titulo === 'Faturar no mês 3D')!
    expect(meta.valorMeta).toBeNull()
    expect(meta.ultimasSemanas.every((s) => s.valor === null)).toBe(true)
    expect(meta.avaliacao.percentual).not.toBeNull()
  })

  it('o titular vê o próprio dinheiro', async () => {
    const [x] = await lerPortal(USUARIO('titularx'))
    expect(x!.cobrancas[0]).toMatchObject({ valor: '300000' })
  })
})

describe('"Ver como a cliente" (O9): rota de carteira, redação da carteira', () => {
  it('a mesma seção do portal; sem `valores`, a cobrança sai null; o acesso fica registrado como usuario_gestao', async () => {
    const cookie = await entrarNaCarteira(USUARIO('a'))
    const r = await http().get(`/v1/carteira/clientes/${clienteX}/previa-do-portal`).set('Cookie', cookie).expect(200)
    const previa = r.body.cliente as Secao
    const [doPortal] = await lerPortal(USUARIO('titularx'))
    expect(previa.materiais).toEqual(doPortal!.materiais)
    expect(previa.reunioes).toEqual(doPortal!.reunioes)
    expect(previa.documentos).toEqual(doPortal!.documentos)
    expect(previa.campanhas.map((c) => c.tipo)).toEqual(doPortal!.campanhas.map((c) => c.tipo))
    expect(previa.cobrancas[0]).toMatchObject({ valor: null })
    const trilha = await migrate.query(
      `SELECT 1 FROM auditoria_do_painel WHERE ator_tipo = 'usuario_gestao' AND ator_id = $1 AND entidade = 'portal_previa' AND entidade_id = $2`,
      [gestaoA, clienteX],
    )
    expect(trilha.rows.length).toBeGreaterThan(0)
  })

  it('com `valores`, a prévia mostra o dinheiro como a cliente titular vê', async () => {
    const cookie = await entrarNaCarteira(USUARIO('valores'))
    const r = await http().get(`/v1/carteira/clientes/${clienteX}/previa-do-portal`).set('Cookie', cookie).expect(200)
    expect(r.body.cliente.cobrancas[0]).toMatchObject({ valor: '300000' })
  })

  it('cliente de outro grupo responde 404, como inexistente', async () => {
    const cookie = await entrarNaCarteira(USUARIO('b'))
    await http().get(`/v1/carteira/clientes/${clienteX}/previa-do-portal`).set('Cookie', cookie).expect(404)
    await http().get(`/v1/carteira/clientes/${randomUUID()}/previa-do-portal`).set('Cookie', cookie).expect(404)
  })

  it('o cookie do portal não abre a prévia (espaços de identidade disjuntos)', async () => {
    const cookie = await entrarNoPortal(USUARIO('titularx'))
    await http().get(`/v1/carteira/clientes/${clienteX}/previa-do-portal`).set('Cookie', cookie).expect(404)
  })
})

describe('os acessos da cliente (V7, O10)', () => {
  it('lista as contas do cliente, nunca o hash, e diz quem vê valores', async () => {
    const cookie = await entrarNaCarteira(USUARIO('a'))
    const r = await http().get(`/v1/carteira/clientes/${clienteX}/acessos-do-portal`).set('Cookie', cookie).expect(200)
    expect(r.body.podeConcederValores).toBe(false)
    const porUsuario = new Map((r.body.acessos as { usuario: string; veValores: boolean }[]).map((a) => [a.usuario, a]))
    expect(porUsuario.get(USUARIO('titularx'))).toMatchObject({ veValores: true })
    expect(porUsuario.get(USUARIO('segundax'))).toMatchObject({ veValores: false })
    expect(JSON.stringify(r.body)).not.toMatch(/argon2|senha_hash|\$/)
  })

  it('a conta nova do cliente que já tem titular nasce sem valores; a primeira de um cliente sem conta nasce com', async () => {
    const cookie = await entrarNaCarteira(USUARIO('a'))
    const nova = await http()
      .post('/v1/carteira/acessos-do-portal/usuarios')
      .set('Cookie', cookie)
      .send({ usuario: USUARIO('terceirax'), nome: 'Gerente da X', clienteCarteiraId: clienteX })
      .expect(201)
    expect(nova.body.usuarioDoPortal).toMatchObject({ veValores: false })
    const trilha = await migrate.query(
      `SELECT para FROM auditoria_do_painel WHERE entidade = 'usuarios_do_portal' AND entidade_id = $1 AND acao = 'criou'`,
      [nova.body.usuarioDoPortal.id],
    )
    expect(JSON.stringify(trilha.rows)).not.toMatch(/senha/i)
  })

  it('"Gerar nova senha" devolve a provisória uma vez e derruba a sessão aberta da conta', async () => {
    const sessaoDaCliente = await entrarNoPortal(USUARIO('segundax'))
    await http().get('/v1/portal/eu').set('Cookie', sessaoDaCliente).expect(200)
    const cookie = await entrarNaCarteira(USUARIO('a'))
    const r = await http()
      .post(`/v1/carteira/clientes/${clienteX}/acessos-do-portal/${segundaX}/nova-senha`)
      .set('Cookie', cookie)
      .expect(200)
    expect(typeof r.body.senhaProvisoria).toBe('string')
    expect(r.body.usuarioDoPortal).toMatchObject({ id: segundaX, senhaProvisoria: true })
    await http().get('/v1/portal/eu').set('Cookie', sessaoDaCliente).expect(404)
    // A provisória nova entra (e a antiga não).
    await http().post('/v1/portal/entrar').send({ usuario: USUARIO('segundax'), senha: SENHA }).expect(401)
    await http().post('/v1/portal/entrar').send({ usuario: USUARIO('segundax'), senha: r.body.senhaProvisoria }).expect(200)
  })

  it('a conta de OUTRO cliente pelo id, na rota deste cliente: 404 — e a de grupo (do Operador) também', async () => {
    const cookie = await entrarNaCarteira(USUARIO('a'))
    await http().post(`/v1/carteira/clientes/${clienteX}/acessos-do-portal/${portalY}/nova-senha`).set('Cookie', cookie).expect(404)
    await http().post(`/v1/carteira/clientes/${clienteX}/acessos-do-portal/${portalGrupoA}/desativar`).set('Cookie', cookie).expect(404)
  })

  it('usuário de outro grupo não gerencia acesso deste cliente', async () => {
    const cookie = await entrarNaCarteira(USUARIO('b'))
    await http().get(`/v1/carteira/clientes/${clienteX}/acessos-do-portal`).set('Cookie', cookie).expect(404)
    await http().post(`/v1/carteira/clientes/${clienteX}/acessos-do-portal/${titularX}/desativar`).set('Cookie', cookie).expect(404)
  })

  it('conceder "vê valores" exige `valores`: sem ela 403; com ela muda e deixa trilha de → para', async () => {
    const semValores = await entrarNaCarteira(USUARIO('a'))
    await http()
      .patch(`/v1/carteira/clientes/${clienteX}/acessos-do-portal/${segundaX}`)
      .set('Cookie', semValores)
      .send({ veValores: true })
      .expect(403)
    const comValores = await entrarNaCarteira(USUARIO('valores'))
    const r = await http()
      .patch(`/v1/carteira/clientes/${clienteX}/acessos-do-portal/${segundaX}`)
      .set('Cookie', comValores)
      .send({ veValores: true })
      .expect(200)
    expect(r.body.acesso).toMatchObject({ veValores: true })
    const trilha = await migrate.query<{ de: unknown; para: unknown }>(
      `SELECT de, para FROM auditoria_do_painel WHERE entidade = 'usuarios_do_portal' AND entidade_id = $1 AND de ? 've_valores'`,
      [segundaX],
    )
    expect(trilha.rows.at(-1)).toEqual({ de: { ve_valores: false }, para: { ve_valores: true } })
  })

  it('"Remover" desativa (estado, nunca exclusão), derruba a sessão e o login passa a falhar', async () => {
    const sessao = await entrarNoPortal(USUARIO('z'))
    const cookie = await entrarNaCarteira(USUARIO('b'))
    await http().post(`/v1/carteira/clientes/${clienteZ}/acessos-do-portal/${portalZ}/desativar`).set('Cookie', cookie).expect(204)
    await http().get('/v1/portal/eu').set('Cookie', sessao).expect(404)
    await http().post('/v1/portal/entrar').send({ usuario: USUARIO('z'), senha: SENHA }).expect(401)
    const linha = await migrate.query(`SELECT ativo FROM usuarios_do_portal WHERE id = $1`, [portalZ])
    expect(linha.rows).toEqual([{ ativo: false }])
    // Desativar de novo: a conta já não está ativa — 404, nunca 500.
    await http().post(`/v1/carteira/clientes/${clienteZ}/acessos-do-portal/${portalZ}/desativar`).set('Cookie', cookie).expect(404)
  })
})

describe('a regra do benefício de indicação (T5, L12)', () => {
  it('lê a regra; quem não administra não altera (403), nem com escopo geral', async () => {
    const semAdministrar = await entrarNaCarteira(USUARIO('geral'))
    const r = await http().get('/v1/carteira/beneficios/regra').set('Cookie', semAdministrar).expect(200)
    expect(r.body).toMatchObject({ podeAlterar: false })
    expect(r.body.percentualCentesimos).toMatch(/^\d+$/)
    await http().put('/v1/carteira/beneficios/regra').set('Cookie', semAdministrar).send({ percentualCentesimos: '1500' }).expect(403)
    const grupo = await entrarNaCarteira(USUARIO('a'))
    await http().put('/v1/carteira/beneficios/regra').set('Cookie', grupo).send({ percentualCentesimos: '1500' }).expect(403)
  })

  it('quem administra grava (o mesmo valor vigente: o teste não muda a regra das outras suítes) e valor fora de 1–10000 é 400', async () => {
    const admin = await entrarNaCarteira(USUARIO('valores'))
    const atual = (await http().get('/v1/carteira/beneficios/regra').set('Cookie', admin).expect(200)).body
    expect(atual.podeAlterar).toBe(true)
    const r = await http()
      .put('/v1/carteira/beneficios/regra')
      .set('Cookie', admin)
      .send({ percentualCentesimos: atual.percentualCentesimos })
      .expect(200)
    expect(r.body).toEqual({ percentualCentesimos: atual.percentualCentesimos, podeAlterar: true })
    await http().put('/v1/carteira/beneficios/regra').set('Cookie', admin).send({ percentualCentesimos: '0' }).expect(400)
    await http().put('/v1/carteira/beneficios/regra').set('Cookie', admin).send({ percentualCentesimos: '10001' }).expect(400)
  })
})
