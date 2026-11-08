import { randomUUID } from 'node:crypto'
import type { RegistrarReuniaoEntrada, UsuarioDeGestaoPublico } from '@fir/contracts'
import { RelogioFixo } from '@fir/domain'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoService } from '../../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import {
  ContagemMudou,
  MotivoObrigatorio,
  NaoEncontrado,
  ResponsavelInvalido,
  SemPermissaoDeAdministrar,
} from './conteudo-comum'
import { DocumentosEMateriaisService } from './documentos-e-materiais.service'
import { ReunioesCarteiraService } from './reunioes.service'
import { perfilPadraoDoBanco } from '../perfil-do-usuario-de-gestao'

/**
 * **G8 1B — reuniões, documentos e materiais, contra Postgres real.**
 *
 * O portal é exercitado pelo PAPEL `fir_portal` de verdade
 * (`nasTabelasDaCarteiraComoPortal`), nunca por um mock: o que prova que a
 * ata não compartilhada é invisível e que as notas internas não chegam lá é
 * o banco recusando — RLS e privilégio de coluna —, não um filtro escrito
 * aqui.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `conteudo${Date.now()}`

let migrate: pg.Client
let banco: BancoService
let reunioes: ReunioesCarteiraService
let conteudo: DocumentosEMateriaisService

let grupoA: string
let grupoB: string
let clinicaX: string
let clienteX: string
let clienteY: string
let portalX: string
let geral: UsuarioDeGestaoPublico
let doA: UsuarioDeGestaoPublico
let doB: UsuarioDeGestaoPublico
const bibliotecaCriada: string[] = []

async function usuarioDeGestao(
  nome: string,
  escopo: 'geral' | 'grupo',
  grupoId: string | null,
): Promise<UsuarioDeGestaoPublico> {
  const usuario = `${nome}.${codigo}`
  const r = await migrate.query<{ id: string }>(
    `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
    [usuario, nome, escopo, grupoId],
  )
  return { id: r.rows[0]!.id, usuario, nome, escopo, grupoId, senhaProvisoria: false, ...perfilPadraoDoBanco(escopo) }
}

const ata = (extra: Partial<RegistrarReuniaoEntrada> = {}): RegistrarReuniaoEntrada => ({
  chaveIdempotencia: randomUUID(),
  data: '2026-11-05',
  tipo: 'semanal',
  participantes: 'Dra. Ana, gerente',
  resumo: 'Revisamos a agenda e o funil.',
  encaminhamentos: null,
  notasInternas: 'Impressão interna: a gerente resiste à rotina.',
  saudeRegistrada: 'atencao',
  anexos: [],
  compartilhada: false,
  tarefas: null,
  ...extra,
})

/** O que o PORTAL do cliente X enxerga de `reunioes_comerciais`, pelo papel `fir_portal`. */
const atasNoPortal = (): Promise<string[]> =>
  banco
    .nasTabelasDaCarteiraComoPortal({ escopo: 'cliente', clienteCarteiraId: clienteX, grupoId: null }, (c) =>
      c.query<{ id: string }>('SELECT id FROM reunioes_comerciais WHERE cliente_carteira_id = $1', [clienteX]),
    )
    .then((r) => r.rows.map((x) => x.id))

const documentosNoPortal = (): Promise<string[]> =>
  banco
    .nasTabelasDaCarteiraComoPortal({ escopo: 'cliente', clienteCarteiraId: clienteX, grupoId: null }, (c) =>
      c.query<{ id: string }>('SELECT id FROM documentos_carteira WHERE cliente_carteira_id = $1', [clienteX]),
    )
    .then((r) => r.rows.map((x) => x.id))

/** Uma leitura do portal do cliente X, como `PortalLeituraService` grava (uma linha na trilha da clínica). */
async function portalLeu(): Promise<void> {
  await migrate.query(
    `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id)
     VALUES ($1, 'usuario_portal', $2, 'acessou', 'carteira_comercial', $3)`,
    [clinicaX, portalX, clienteX],
  )
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  const relogio = new RelogioFixo(new Date('2026-11-08T15:00:00Z'))
  reunioes = new ReunioesCarteiraService(banco, relogio)
  conteudo = new DocumentosEMateriaisService(banco, relogio)

  const grupo = async (n: string) =>
    (await migrate.query<{ id: string }>('INSERT INTO grupos (nome) VALUES ($1) RETURNING id', [`${n} ${codigo}`]))
      .rows[0]!.id
  grupoA = await grupo('A')
  grupoB = await grupo('B')
  clinicaX = (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica X') RETURNING id`, [
      codigo,
    ])
  ).rows[0]!.id
  const cliente = async (g: string, clinica: string | null, nome: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto) VALUES ($1, $2, $3, 'Consultoria') RETURNING id`,
        [g, clinica, nome],
      )
    ).rows[0]!.id
  clienteX = await cliente(grupoA, clinicaX, 'Cliente X')
  clienteY = await cliente(grupoB, null, 'Cliente Y')

  geral = await usuarioDeGestao('geral', 'geral', null)
  doA = await usuarioDeGestao('doa', 'grupo', grupoA)
  doB = await usuarioDeGestao('dob', 'grupo', grupoB)

  portalX = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_do_portal (usuario, nome, senha_hash, escopo, cliente_carteira_id)
       VALUES ($1, 'Portal X', 'x', 'cliente', $2) RETURNING id`,
      [`portal.${codigo}`, clienteX],
    )
  ).rows[0]!.id
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  const clientes = [clienteX, clienteY]
  await migrate.query('DELETE FROM compartilhamentos_revertidos WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query(
    `DELETE FROM encaminhamentos_de_reuniao
      WHERE reuniao_comercial_id IN (SELECT id FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1))`,
    [clientes],
  )
  await migrate.query('DELETE FROM tarefas_internas WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM envios_de_material WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM materiais_carteira WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM documentos_carteira WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM reunioes_comerciais WHERE cliente_carteira_id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM materiais_da_biblioteca WHERE id = ANY($1)', [bibliotecaCriada])
  await migrate.query('DELETE FROM usuarios_do_portal WHERE id = $1', [portalX])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [clientes])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [[geral.id, doA.id, doB.id]])
  await apagarClinicaDeTeste(migrate, clinicaX)
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await migrate.end()
  await banco.onModuleDestroy()
})

describe('reunião: nasce não compartilhada, e o portal só a vê depois de compartilhar (LGPD A6)', () => {
  it('registrada sem compartilhar é invisível ao portal; compartilhada, aparece', async () => {
    const { reuniao } = await reunioes.registrar(doA, clienteX, ata())
    expect(reuniao.compartilhada).toBe(false)
    expect(await atasNoPortal()).not.toContain(reuniao.id)

    await reunioes.mudarCompartilhamento(doA, reuniao.id, { compartilhada: true })
    expect(await atasNoPortal()).toContain(reuniao.id)
  })

  it('as notas internas, os participantes, a saúde e quem registrou NUNCA chegam ao portal — o banco recusa a coluna', async () => {
    const { reuniao } = await reunioes.registrar(doA, clienteX, ata({ compartilhada: true }))
    for (const coluna of ['notas_internas', 'participantes', 'saude_registrada', 'por_usuario_gestao_id', 'tipo']) {
      await expect(
        banco.nasTabelasDaCarteiraComoPortal({ escopo: 'cliente', clienteCarteiraId: clienteX, grupoId: null }, (c) =>
          c.query(`SELECT ${coluna} FROM reunioes_comerciais WHERE id = $1`, [reuniao.id]),
        ),
        coluna,
      ).rejects.toThrow(/permission denied/i)
    }
  })

  it('a ata arquivada some do portal mesmo compartilhada', async () => {
    const { reuniao } = await reunioes.registrar(doA, clienteX, ata({ compartilhada: true }))
    expect(await atasNoPortal()).toContain(reuniao.id)
    await reunioes.arquivar(geral, reuniao.id)
    expect(await atasNoPortal()).not.toContain(reuniao.id)
  })
})

describe('compartilhar e descompartilhar: auditado, e o sinal de incidente (LGPD A8, A10)', () => {
  it('toda mudança de compartilhada vai para auditoria_do_painel, de → para, com o Usuário de Gestão real', async () => {
    const { reuniao } = await reunioes.registrar(doA, clienteX, ata())
    await reunioes.mudarCompartilhamento(doA, reuniao.id, { compartilhada: true })
    await reunioes.mudarCompartilhamento(doA, reuniao.id, { compartilhada: false })
    const trilha = await migrate.query<{ ator_tipo: string; ator_id: string; de: { compartilhada?: boolean }; para: { compartilhada?: boolean } }>(
      `SELECT ator_tipo, ator_id, de, para FROM auditoria_do_painel
        WHERE entidade = 'reunioes_comerciais' AND entidade_id = $1 AND acao = 'alterou' AND para ? 'compartilhada'
        ORDER BY id`,
      [reuniao.id],
    )
    expect(trilha.rows.map((t) => [t.ator_tipo, t.ator_id, t.de.compartilhada, t.para.compartilhada])).toEqual([
      ['usuario_gestao', doA.id, false, true],
      ['usuario_gestao', doA.id, true, false],
    ])
  })

  it('descompartilhar DEPOIS de o portal ter lido exige motivo, e com motivo grava compartilhamentos_revertidos', async () => {
    const { reuniao } = await reunioes.registrar(doA, clienteX, ata({ compartilhada: true }))
    await portalLeu()

    await expect(reunioes.mudarCompartilhamento(doA, reuniao.id, { compartilhada: false })).rejects.toThrow(
      MotivoObrigatorio,
    )
    // Recusado: continua compartilhada (a transação inteira caiu).
    expect(await atasNoPortal()).toContain(reuniao.id)

    const r = await reunioes.mudarCompartilhamento(doA, reuniao.id, {
      compartilhada: false,
      motivo: 'Resumo citava a negociação com o fornecedor',
    })
    expect(r.reversaoAposLeitura).toBe(true)
    expect(r.reuniao.compartilhada).toBe(false)
    expect(await atasNoPortal()).not.toContain(reuniao.id)

    const evento = await migrate.query<{ por_usuario_gestao_id: string; motivo: string }>(
      'SELECT por_usuario_gestao_id, motivo FROM compartilhamentos_revertidos WHERE reuniao_comercial_id = $1',
      [reuniao.id],
    )
    expect(evento.rows).toEqual([
      { por_usuario_gestao_id: doA.id, motivo: 'Resumo citava a negociação com o fornecedor' },
    ])
  })

  it('leitura do portal ANTES do compartilhamento não conta: descompartilha sem motivo e sem evento', async () => {
    await portalLeu()
    // `now()` é o instante da transação: a leitura acima e o compartilhamento
    // abaixo precisam de instantes distintos para a borda ser medida.
    await new Promise((ok) => setTimeout(ok, 20))
    const { reuniao } = await reunioes.registrar(doA, clienteX, ata({ compartilhada: true }))
    const r = await reunioes.mudarCompartilhamento(doA, reuniao.id, { compartilhada: false })
    expect(r.reversaoAposLeitura).toBe(false)
    const evento = await migrate.query('SELECT 1 FROM compartilhamentos_revertidos WHERE reuniao_comercial_id = $1', [
      reuniao.id,
    ])
    expect(evento.rows).toHaveLength(0)
  })

  it('a tabela do evento é append-only para fir_carteira', async () => {
    const p = await migrate.query<{ upd: boolean; del: boolean }>(
      `SELECT has_table_privilege('fir_carteira', 'compartilhamentos_revertidos', 'UPDATE') AS upd,
              has_table_privilege('fir_carteira', 'compartilhamentos_revertidos', 'DELETE') AS del`,
    )
    expect(p.rows[0]).toEqual({ upd: false, del: false })
  })
})

describe('encaminhamentos viram tarefas UMA vez só (appsec A-20)', () => {
  const tarefasDaAta = async (reuniaoId: string) =>
    (
      await migrate.query<{ titulo: string; responsavel_usuario_gestao_id: string; prazo: string; grupo_id: string }>(
        `SELECT t.titulo, t.responsavel_usuario_gestao_id, t.prazo::text AS prazo, t.grupo_id
           FROM encaminhamentos_de_reuniao e JOIN tarefas_internas t ON t.id = e.tarefa_interna_id
          WHERE e.reuniao_comercial_id = $1 ORDER BY e.ordem`,
        [reuniaoId],
      )
    ).rows

  it('o mesmo registro enviado três vezes cria UMA ata e as tarefas uma vez', async () => {
    const entrada = ata({
      encaminhamentos: '• Ligar para a gerente\n2) Mandar a planilha\n\n - Rever metas',
      tarefas: { responsavelUsuarioGestaoId: doA.id },
    })
    const r1 = await reunioes.registrar(doA, clienteX, entrada)
    const r2 = await reunioes.registrar(doA, clienteX, entrada)
    const r3 = await reunioes.registrar(doA, clienteX, entrada)

    expect([r1.jaExistia, r2.jaExistia, r3.jaExistia]).toEqual([false, true, true])
    expect([r1.tarefasCriadas, r2.tarefasCriadas, r3.tarefasCriadas]).toEqual([3, 0, 0])
    expect(new Set([r1.reuniao.id, r2.reuniao.id, r3.reuniao.id]).size).toBe(1)

    const atas = await migrate.query('SELECT 1 FROM reunioes_comerciais WHERE chave_idempotencia = $1', [
      entrada.chaveIdempotencia,
    ])
    expect(atas.rows).toHaveLength(1)

    const tarefas = await tarefasDaAta(r1.reuniao.id)
    expect(tarefas.map((t) => t.titulo)).toEqual(['Ligar para a gerente', 'Mandar a planilha', 'Rever metas'])
    // Prazo padrão: hoje (08/11 no fuso da carteira) + 7, calculado no servidor.
    expect(new Set(tarefas.map((t) => t.prazo))).toEqual(new Set(['2026-11-15']))
    expect(new Set(tarefas.map((t) => t.grupo_id))).toEqual(new Set([grupoA]))
    expect(r3.reuniao.tarefas).toEqual({ total: 3, concluidas: 0 })
  })

  it('três envios SIMULTÂNEOS (duplo clique, retry de rede) também criam uma ata só', async () => {
    const entrada = ata({ encaminhamentos: 'a\nb', tarefas: { responsavelUsuarioGestaoId: doA.id, prazo: '2026-11-20' } })
    const rs = await Promise.all([1, 2, 3].map(() => reunioes.registrar(doA, clienteX, entrada)))
    expect(rs.filter((r) => !r.jaExistia)).toHaveLength(1)
    expect(new Set(rs.map((r) => r.reuniao.id)).size).toBe(1)
    expect(await tarefasDaAta(rs[0]!.reuniao.id)).toHaveLength(2)
  })

  it('"X de Y tarefas concluídas" acompanha a tarefa', async () => {
    const { reuniao } = await reunioes.registrar(
      doA,
      clienteX,
      ata({ encaminhamentos: 'um\ndois', tarefas: { responsavelUsuarioGestaoId: doA.id } }),
    )
    await migrate.query(
      `UPDATE tarefas_internas SET status = 'concluida', concluida_em = now()
        WHERE id = (SELECT tarefa_interna_id FROM encaminhamentos_de_reuniao WHERE reuniao_comercial_id = $1 AND ordem = 1)`,
      [reuniao.id],
    )
    const lista = await reunioes.listar(doA, clienteX)
    expect(lista.reunioes.find((r) => r.id === reuniao.id)?.tarefas).toEqual({ total: 2, concluidas: 1 })
  })

  it('responsável de outro grupo é recusado antes de qualquer escrita', async () => {
    const entrada = ata({ encaminhamentos: 'x', tarefas: { responsavelUsuarioGestaoId: doB.id } })
    await expect(reunioes.registrar(doA, clienteX, entrada)).rejects.toThrow(ResponsavelInvalido)
    const atas = await migrate.query('SELECT 1 FROM reunioes_comerciais WHERE chave_idempotencia = $1', [
      entrada.chaveIdempotencia,
    ])
    expect(atas.rows).toHaveLength(0)
  })
})

describe('isolamento por grupo', () => {
  it('o usuário do grupo B não lê, não edita, não compartilha e não registra nada no cliente do grupo A — 404 igual a "não existe"', async () => {
    const { reuniao } = await reunioes.registrar(doA, clienteX, ata())
    await expect(reunioes.listar(doB, clienteX)).rejects.toThrow(NaoEncontrado)
    await expect(reunioes.registrar(doB, clienteX, ata())).rejects.toThrow(NaoEncontrado)
    await expect(reunioes.editar(doB, reuniao.id, { resumo: 'invadido' })).rejects.toThrow(NaoEncontrado)
    await expect(reunioes.mudarCompartilhamento(doB, reuniao.id, { compartilhada: true })).rejects.toThrow(NaoEncontrado)
    await expect(conteudo.listarDocumentos(doB, clienteX)).rejects.toThrow(NaoEncontrado)
    await expect(conteudo.materiaisDoCliente(doB, clienteX)).rejects.toThrow(NaoEncontrado)
    await expect(
      conteudo.criarDocumento(doB, clienteX, {
        titulo: 'x',
        categoria: 'Contrato',
        link: 'https://exemplo.com/x',
        visivelPortal: true,
      }),
    ).rejects.toThrow(NaoEncontrado)
  })

  it('a lista do grupo B não traz ata do grupo A, e os responsáveis oferecidos são só do grupo dele', async () => {
    await reunioes.registrar(doB, clienteY, ata())
    const lista = await reunioes.listar(doB, clienteY)
    expect(lista.reunioes.every((r) => r.clienteCarteiraId === clienteY)).toBe(true)
    expect(lista.responsaveis.map((p) => p.id)).toEqual([doB.id])
  })

  it('o portal do cliente X nunca vê a ata compartilhada do cliente Y', async () => {
    const { reuniao } = await reunioes.registrar(doB, clienteY, ata({ compartilhada: true }))
    const r = await banco.nasTabelasDaCarteiraComoPortal(
      { escopo: 'cliente', clienteCarteiraId: clienteX, grupoId: null },
      (c) => c.query('SELECT id FROM reunioes_comerciais WHERE id = $1', [reuniao.id]),
    )
    expect(r.rows).toHaveLength(0)
  })

  it('ler as atas grava o acesso do Usuário de Gestão (LGPD A14)', async () => {
    await reunioes.listar(doA, clienteX)
    const r = await migrate.query(
      `SELECT 1 FROM auditoria_do_painel
        WHERE ator_tipo = 'usuario_gestao' AND ator_id = $1 AND acao = 'acessou'
          AND entidade = 'reunioes_comerciais' AND entidade_id = $2`,
      [doA.id, clienteX],
    )
    expect(r.rows.length).toBeGreaterThan(0)
  })
})

describe('"Compartilhar todas" (A-9, A-18, LGPD A8)', () => {
  it('só quem administra; contagem confirmada; importadas só com a segunda marcação; idempotente', async () => {
    const comuns = [
      await reunioes.registrar(doB, clienteY, ata()),
      await reunioes.registrar(doB, clienteY, ata()),
    ].map((r) => r.reuniao.id)
    const importada = (
      await migrate.query<{ id: string }>(
        `INSERT INTO reunioes_comerciais (cliente_carteira_id, grupo_id, data, resumo, tipo, asana_id, por_usuario_gestao_id)
         VALUES ($1, $2, '2026-10-01', 'Notas do Asana', 'importada', $3, $4) RETURNING id`,
        [clienteY, grupoB, `asana-${codigo}`, doB.id],
      )
    ).rows[0]!.id

    await expect(reunioes.compartilharTodas(doB, clienteY, { incluirImportadas: false, esperadas: 2 })).rejects.toThrow(
      SemPermissaoDeAdministrar,
    )

    const { pendentesDeCompartilhar } = await reunioes.listar(geral, clienteY)
    expect(pendentesDeCompartilhar.importadas).toBe(1)
    await expect(
      reunioes.compartilharTodas(geral, clienteY, { incluirImportadas: false, esperadas: 999 }),
    ).rejects.toThrow(ContagemMudou)

    const n = await reunioes.compartilharTodas(geral, clienteY, {
      incluirImportadas: false,
      esperadas: pendentesDeCompartilhar.comuns,
    })
    expect(n).toBe(pendentesDeCompartilhar.comuns)
    const estado = await migrate.query<{ id: string; compartilhada: boolean }>(
      'SELECT id, compartilhada FROM reunioes_comerciais WHERE id = ANY($1)',
      [[...comuns, importada]],
    )
    const por = new Map(estado.rows.map((r) => [r.id, r.compartilhada]))
    expect(comuns.map((id) => por.get(id))).toEqual([true, true])
    expect(por.get(importada)).toBe(false)

    // Segundo clique: nada pendente fora as importadas, devolve 0.
    expect(await reunioes.compartilharTodas(geral, clienteY, { incluirImportadas: false, esperadas: 0 })).toBe(0)
    expect(await reunioes.compartilharTodas(geral, clienteY, { incluirImportadas: true, esperadas: 1 })).toBe(1)
  })
})

describe('documentos: o interno nunca chega ao portal (LGPD A12)', () => {
  it('visível aparece, interno não, e o arquivado sai', async () => {
    const visivel = await conteudo.criarDocumento(doA, clienteX, {
      titulo: 'Contrato assinado',
      categoria: 'Contrato',
      link: 'https://drive.google.com/x',
      visivelPortal: true,
    })
    const interno = await conteudo.criarDocumento(doA, clienteX, {
      titulo: 'Diagnóstico bruto',
      categoria: 'Diagnóstico',
      link: 'https://drive.google.com/y',
      visivelPortal: false,
    })
    expect(visivel.data).toBe('2026-11-08')
    let noPortal = await documentosNoPortal()
    expect(noPortal).toContain(visivel.id)
    expect(noPortal).not.toContain(interno.id)

    await conteudo.editarDocumento(doA, visivel.id, { visivelPortal: false })
    expect(await documentosNoPortal()).not.toContain(visivel.id)
    await conteudo.editarDocumento(doA, visivel.id, { visivelPortal: true })

    await expect(conteudo.arquivarDocumento(doA, visivel.id)).rejects.toThrow(SemPermissaoDeAdministrar)
    await conteudo.arquivarDocumento(geral, visivel.id)
    noPortal = await documentosNoPortal()
    expect(noPortal).not.toContain(visivel.id)
    const lista = await conteudo.listarDocumentos(doA, clienteX)
    expect(lista.documentos.map((d) => d.id)).not.toContain(visivel.id)
  })
})

describe('materiais: biblioteca geral (tabela própria, A-18) e o personalizado do cliente', () => {
  it('só quem administra escreve na biblioteca — e a RLS recusa mesmo sem o serviço', async () => {
    await expect(
      conteudo.criarNaBiblioteca(doA, {
        titulo: 'Planilha de metas',
        tipo: 'Planilha',
        programas: ['Comercial'],
        link: 'https://docs.google.com/x/copy',
        texto: null,
        descricao: null,
        usoInterno: false,
      }),
    ).rejects.toThrow(SemPermissaoDeAdministrar)

    await expect(
      banco.nasTabelasDaCarteiraComoUsuarioDeGestao(doA, (c) =>
        c.query(
          `INSERT INTO materiais_da_biblioteca (titulo, tipo, uso_interno, criado_por) VALUES ('x', 'Script', false, $1)`,
          [doA.id],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })

  it('a ficha mostra o do programa, o de outros programas, esconde o de uso interno, e registra o envio', async () => {
    const criar = async (titulo: string, programas: ('Comercial' | 'Financeiro')[], usoInterno: boolean) => {
      const m = await conteudo.criarNaBiblioteca(geral, {
        titulo: `${titulo} ${codigo}`,
        tipo: 'Script',
        programas,
        link: null,
        texto: 'Olá!',
        descricao: null,
        usoInterno,
      })
      bibliotecaCriada.push(m.id)
      return m
    }
    const doPrograma = await criar('Script comercial', ['Comercial'], false)
    const outro = await criar('Script financeiro', ['Financeiro'], false)
    const interno = await criar('Roteiro interno', ['Comercial'], true)

    const pers = await conteudo.criarMaterialDoCliente(doA, clienteX, {
      titulo: 'Script ajustado',
      tipo: 'Script',
      programas: ['Comercial'],
      link: null,
      texto: 'Oi',
      descricao: null,
      visivelPortal: true,
    })

    const ficha = await conteudo.materiaisDoCliente(doA, clienteX)
    expect(ficha.programa).toBe('Comercial')
    expect(ficha.personalizados.map((m) => m.id)).toEqual([pers.id])
    expect(ficha.doPrograma.map((m) => m.id)).toContain(doPrograma.id)
    expect(ficha.deOutrosProgramas.map((m) => m.id)).toContain(outro.id)
    expect([...ficha.doPrograma, ...ficha.deOutrosProgramas].map((m) => m.id)).not.toContain(interno.id)

    await expect(
      conteudo.registrarEnvio(doA, clienteX, { origem: 'biblioteca', materialId: interno.id }),
    ).rejects.toThrow(NaoEncontrado)
    const envio = await conteudo.registrarEnvio(doA, clienteX, { origem: 'biblioteca', materialId: doPrograma.id })
    const depois = await conteudo.materiaisDoCliente(doA, clienteX)
    expect(depois.doPrograma.find((m) => m.id === doPrograma.id)?.enviadoEm).toBe(envio.enviadoEm)

    // O personalizado de X não serve para registrar envio a Y (outro grupo, e outro cliente).
    await expect(
      conteudo.registrarEnvio(doB, clienteY, { origem: 'personalizado', materialId: pers.id }),
    ).rejects.toThrow(NaoEncontrado)
  })
})
