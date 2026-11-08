import type { ImportarDoAsanaEntrada, UsuarioDeGestaoPublico } from '@fir/contracts'
import { LIMITES_DO_ASANA, RelogioFixo } from '@fir/domain'
import { HttpException } from '@nestjs/common'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoService } from '../../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { perfilPadraoDoBanco } from '../perfil-do-usuario-de-gestao'
import { validarImportacaoDoAsana } from './conteudo.controller'
import { NaoEncontrado } from './conteudo-comum'
import { ReunioesCarteiraService } from './reunioes.service'

/**
 * **G8 4B — importar reuniões do Asana, contra Postgres real** (appsec A-15
 * itens 43–48; LGPD A42, A43; regras 26 e 27).
 *
 * A idempotência é a do índice único `(cliente_carteira_id, asana_id)` da
 * 0048 com `ON CONFLICT DO NOTHING` — provada pelo banco, não por um filtro
 * escrito aqui. O portal é lido pelo papel `fir_portal` de verdade.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `asana${Date.now()}`

let migrate: pg.Client
let banco: BancoService
let reunioes: ReunioesCarteiraService
let grupoA: string
let grupoB: string
let clinicaX: string
let clienteX: string
let clienteX2: string
let clienteY: string
let geral: UsuarioDeGestaoPublico
let doA: UsuarioDeGestaoPublico
let doB: UsuarioDeGestaoPublico

async function usuarioDeGestao(nome: string, escopo: 'geral' | 'grupo', grupoId: string | null): Promise<UsuarioDeGestaoPublico> {
  const usuario = `${nome}.${codigo}`
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
    [usuario, nome, escopo, grupoId],
  )
  return { id: r.rows[0]!.id, usuario, nome, escopo, grupoId, senhaProvisoria: false, ...perfilPadraoDoBanco(escopo) }
}

const lote = (prefixo: string, n: number): ImportarDoAsanaEntrada => ({
  linhas: Array.from({ length: n }, (_, i) => ({
    asanaId: `${prefixo}${i + 1}`,
    nome: `Reunião ${i + 1}`,
    notas: i === 0 ? 'Funil, agenda; "metas"\nsegunda linha' : '',
    data: `2026-0${(i % 9) + 1}-10`,
  })),
})

type Linha = { id: string; asana_id: string; tipo: string; compartilhada: boolean; participantes: string | null; resumo: string; arquivada_em: Date | null }
const atasDe = async (cliente: string): Promise<Linha[]> =>
  (
    await migrate.query<Linha>(
      `SELECT id, asana_id, tipo, compartilhada, participantes, resumo, arquivada_em
         FROM reunioes_comerciais WHERE cliente_carteira_id = $1 ORDER BY asana_id`,
      [cliente],
    )
  ).rows

const atasNoPortal = (): Promise<string[]> =>
  banco
    .nasTabelasDaCarteiraComoPortal({ escopo: 'cliente', clienteCarteiraId: clienteX, grupoId: null }, (c) =>
      c.query<{ id: string }>('SELECT id FROM reunioes_comerciais WHERE cliente_carteira_id = $1', [clienteX]),
    )
    .then((r) => r.rows.map((x) => x.id))

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  reunioes = new ReunioesCarteiraService(banco, new RelogioFixo(new Date('2026-11-08T15:00:00Z')))

  const grupo = async (n: string) =>
    (await migrate.query<{ id: string }>('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`${n} ${codigo}`])).rows[0]!.id
  grupoA = await grupo('A')
  grupoB = await grupo('B')
  clinicaX = (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica X') RETURNING id`, [codigo])
  ).rows[0]!.id
  const cliente = async (g: string, clinica: string | null, nome: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, $3, 'Consultoria') RETURNING id`,
        [g, clinica, nome],
      )
    ).rows[0]!.id
  clienteX = await cliente(grupoA, clinicaX, 'Cliente X')
  clienteX2 = await cliente(grupoA, null, 'Cliente X2')
  clienteY = await cliente(grupoB, null, 'Cliente Y')
  geral = await usuarioDeGestao('geral', 'geral', null)
  doA = await usuarioDeGestao('doa', 'grupo', grupoA)
  doB = await usuarioDeGestao('dob', 'grupo', grupoB)
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const clientes = [clienteX, clienteX2, clienteY]
  await migrate.query('DELETE FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [[geral.id, doA.id, doB.id]])
  await apagarClinicaDeTeste(migrate, clinicaX)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await migrate.end()
  await banco.onModuleDestroy()
})

describe('importar do Asana: idempotente por (cliente, asana_id) (regra 26, A43, appsec 43)', () => {
  it('o mesmo lote três vezes: 5 atas na primeira, nenhuma na segunda nem na terceira', async () => {
    const dados = lote('1001', 5)
    const r1 = await reunioes.importarDoAsana(doA, clienteX, dados)
    const r2 = await reunioes.importarDoAsana(doA, clienteX, dados)
    const r3 = await reunioes.importarDoAsana(doA, clienteX, dados)
    expect([r1, r2, r3]).toEqual([
      { importadas: 5, jaExistiam: 0 },
      { importadas: 0, jaExistiam: 5 },
      { importadas: 0, jaExistiam: 5 },
    ])
    expect((await atasDe(clienteX)).filter((a) => a.asana_id.startsWith('1001'))).toHaveLength(5)
  })

  it('o mesmo id repetido dentro do lote vira uma ata só', async () => {
    const linha = lote('2002', 1).linhas[0]!
    const r = await reunioes.importarDoAsana(doA, clienteX, { linhas: [linha, { ...linha, nome: 'outra' }] })
    expect(r).toEqual({ importadas: 1, jaExistiam: 1 })
  })

  it('a ata nasce importada, NÃO compartilhada, sem participantes; o resumo é nome + notas (A42, A40, L2917)', async () => {
    await reunioes.importarDoAsana(doA, clienteX, lote('3003', 2))
    const atas = (await atasDe(clienteX)).filter((a) => a.asana_id.startsWith('3003'))
    expect(atas.map((a) => [a.tipo, a.compartilhada, a.participantes])).toEqual([
      ['importada', false, null],
      ['importada', false, null],
    ])
    expect(atas[0]!.resumo).toBe('Reunião 1\n\nFunil, agenda; "metas"\nsegunda linha')
    const noPortal = await atasNoPortal()
    for (const a of atas) expect(noPortal).not.toContain(a.id)
  })

  it('"Compartilhar todas" deixa as importadas de fora sem a segunda marcação (LGPD A8)', async () => {
    const lista = await reunioes.listar(geral, clienteX)
    expect(lista.pendentesDeCompartilhar.importadas).toBeGreaterThan(0)
    const n = await reunioes.compartilharTodas(geral, clienteX, {
      incluirImportadas: false,
      esperadas: lista.pendentesDeCompartilhar.comuns,
    })
    expect(n).toBe(lista.pendentesDeCompartilhar.comuns)
    expect((await atasDe(clienteX)).every((a) => !a.compartilhada)).toBe(true)
  })
})

describe('nunca sobrescreve, nunca recria (regra 27, appsec 45, A43)', () => {
  it('ata editada à mão: a reimportação não a toca', async () => {
    await reunioes.importarDoAsana(doA, clienteX, lote('4004', 1))
    const ata = (await atasDe(clienteX)).find((a) => a.asana_id === '40041')!
    await reunioes.editar(doA, ata.id, { resumo: 'Corrigido pela equipe' })
    await reunioes.importarDoAsana(doA, clienteX, lote('4004', 1))
    expect((await atasDe(clienteX)).find((a) => a.asana_id === '40041')!.resumo).toBe('Corrigido pela equipe')
  })

  it('ata compartilhada e depois descompartilhada: reimportar não reabre o compartilhamento', async () => {
    await reunioes.importarDoAsana(doA, clienteX, lote('5005', 1))
    const ata = (await atasDe(clienteX)).find((a) => a.asana_id === '50051')!
    await reunioes.mudarCompartilhamento(doA, ata.id, { compartilhada: true })
    await reunioes.mudarCompartilhamento(doA, ata.id, { compartilhada: false })
    const r = await reunioes.importarDoAsana(doA, clienteX, lote('5005', 1))
    expect(r.importadas).toBe(0)
    expect((await atasDe(clienteX)).find((a) => a.asana_id === '50051')!.compartilhada).toBe(false)
  })

  it('ata arquivada (o "excluir"): reimportar não a ressuscita, e a prévia a vê como já importada', async () => {
    await reunioes.importarDoAsana(doA, clienteX, lote('6006', 1))
    const ata = (await atasDe(clienteX)).find((a) => a.asana_id === '60061')!
    await reunioes.arquivar(geral, ata.id)
    const r = await reunioes.importarDoAsana(doA, clienteX, lote('6006', 1))
    expect(r).toEqual({ importadas: 0, jaExistiam: 1 })
    const atas = (await atasDe(clienteX)).filter((a) => a.asana_id === '60061')
    expect(atas).toHaveLength(1)
    expect(atas[0]!.arquivada_em).not.toBeNull()
    expect((await reunioes.idsDoAsanaImportados(doA, clienteX)).asanaIds).toContain('60061')
  })
})

describe('isolamento: o cliente vem da rota, sob RLS (A-3, appsec 44)', () => {
  it('o mesmo asana_id em OUTRO cliente cria a do cliente da rota e não toca a outra', async () => {
    await reunioes.importarDoAsana(doA, clienteX, lote('7007', 1))
    const antes = (await atasDe(clienteX)).find((a) => a.asana_id === '70071')!
    const r = await reunioes.importarDoAsana(doA, clienteX2, { linhas: [{ ...lote('7007', 1).linhas[0]!, nome: 'Outra', notas: '' }] })
    expect(r.importadas).toBe(1)
    expect((await atasDe(clienteX)).find((a) => a.asana_id === '70071')).toEqual(antes)
    expect((await atasDe(clienteX2)).find((a) => a.asana_id === '70071')!.resumo).toBe('Outra')
  })

  it('usuário do grupo B importando no cliente do grupo A: 404 e nada gravado', async () => {
    await expect(reunioes.importarDoAsana(doB, clienteX, lote('8008', 2))).rejects.toBeInstanceOf(NaoEncontrado)
    await expect(reunioes.idsDoAsanaImportados(doB, clienteX)).rejects.toBeInstanceOf(NaoEncontrado)
    expect((await atasDe(clienteX)).some((a) => a.asana_id.startsWith('8008'))).toBe(false)
  })

  it('a lista de ids já importados é só do cliente pedido', async () => {
    await reunioes.importarDoAsana(doB, clienteY, lote('9009', 1))
    expect((await reunioes.idsDoAsanaImportados(doA, clienteX)).asanaIds).not.toContain('90091')
    expect((await reunioes.idsDoAsanaImportados(doB, clienteY)).asanaIds).toEqual(['90091'])
  })
})

describe('tudo ou nada, e a recusa não ecoa o valor (appsec 46, A-15)', () => {
  it('uma linha que o banco recusa derruba o lote inteiro: nenhuma ata parcial', async () => {
    const dados = lote('1110', 3)
    // Fora do contrato de propósito (o Zod recusaria antes): prova a TRANSAÇÃO, não a validação.
    dados.linhas[2] = { ...dados.linhas[2]!, data: '2026-02-30' }
    await expect(reunioes.importarDoAsana(doA, clienteX, dados)).rejects.toThrow()
    expect((await atasDe(clienteX)).some((a) => a.asana_id.startsWith('1110'))).toBe(false)
  })

  const recusa = (corpo: unknown): { status: number; corpo: string } => {
    try {
      validarImportacaoDoAsana(corpo)
    } catch (e) {
      if (e instanceof HttpException) return { status: e.getStatus(), corpo: JSON.stringify(e.getResponse()) }
      throw e
    }
    throw new Error('não recusou')
  }

  it('nome com fórmula: 400, aponta a tarefa e o campo, e não devolve o valor', () => {
    const veneno = '=HYPERLINK("https://mal.exemplo/x","clique")'
    const dados = lote('1212', 3)
    dados.linhas[1] = { ...dados.linhas[1]!, nome: veneno }
    const r = recusa(dados)
    expect(r.status).toBe(400)
    expect(r.corpo).toContain('tarefa 2 (nome)')
    expect(r.corpo).toContain('LINHAS_DO_ASANA_INVALIDAS')
    expect(r.corpo).not.toContain('HYPERLINK')
    expect(r.corpo).not.toContain('mal.exemplo')
  })

  it('id com fórmula, caractere de controle, data inexistente, resumo longo demais: cada um apontado sem o valor', () => {
    const dados = lote('1313', 4)
    dados.linhas[0] = { ...dados.linhas[0]!, asanaId: '=cmd|calc' }
    dados.linhas[1] = { ...dados.linhas[1]!, notas: 'segredo\u0000' }
    dados.linhas[2] = { ...dados.linhas[2]!, data: '2026-02-30' }
    dados.linhas[3] = { ...dados.linhas[3]!, notas: 'paciente Fulana '.repeat(300) }
    const r = recusa(dados)
    expect(r.corpo).toContain('tarefa 1 (asanaId)')
    expect(r.corpo).toContain('tarefa 2 (notas)')
    expect(r.corpo).toContain('tarefa 3 (data)')
    expect(r.corpo).toContain('tarefa 4 (notas)')
    for (const v of ['cmd', 'calc', 'segredo', 'Fulana', '2026-02-30']) expect(r.corpo).not.toContain(v)
  })

  it(`${LIMITES_DO_ASANA.tarefas + 1} linhas, lote vazio ou campo a mais (responsável, compartilhada): 400`, () => {
    expect(recusa(lote('1414', LIMITES_DO_ASANA.tarefas + 1)).status).toBe(400)
    expect(recusa({ linhas: [] }).status).toBe(400)
    const comCompartilhar = { ...lote('1515', 1), compartilhada: true }
    expect(recusa(comCompartilhar).status).toBe(400)
    const comResponsavel = { linhas: [{ ...lote('1616', 1).linhas[0]!, responsavel: 'Fulana' }] }
    const r = recusa(comResponsavel)
    expect(r.status).toBe(400)
    expect(r.corpo).not.toContain('Fulana')
    expect(() => validarImportacaoDoAsana(lote('1717', LIMITES_DO_ASANA.tarefas))).not.toThrow()
  })
})
