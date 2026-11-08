import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import type { Relogio } from '@fir/domain'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../../app.module'
import { hashDeSenha } from '../../autenticacao/senha'
import { SISTEMA } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../../banco/clinica-id'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { CampanhasService } from '../../campanhas/campanhas.service'
import { registrarCookie } from '../../main'
import {
  CampanhaCarteiraNaoEncontrada,
  CampanhasCarteiraService,
  CampoDaCampanhaSincronizada,
  ClienteComCampanhasDaClinica,
  ClienteDaCampanhaNaoEncontrado,
} from './campanhas-carteira.service'
import { executarSincronizacaoDeCampanhas } from './sincronizar-campanhas'
import { perfilPadraoDoBanco } from '../perfil-do-usuario-de-gestao'

/**
 * **G8 1C — sincronização das campanhas (K4), leitura com supressão (K1/V9) e
 * lançamento à mão (K3), contra Postgres real.**
 *
 * Os testes que o ticket exige, com os nomes do gate de números:
 *  - T-17 três execuções da sincronização: mesmas linhas, receita igual à do
 *    `CampanhasService`, `Σ meses = total`, investimento intocado;
 *  - T-18 a borda do mês NO FUSO DA CLÍNICA (31/10 23:30 local é outubro,
 *    01/11 00:00 local é novembro);
 *  - a sincronização não toca investimento, observações nem linha manual;
 *  - isolamento por grupo (serviço e HTTP);
 *  - supressão ponta a ponta (campanha pequena sozinha, com complemento e com
 *    derivados) e redação dos campos monetários na rota.
 *
 * A sincronização roda SEMPRE com `clienteIds` recortado nas fixtures deste
 * arquivo: outros arquivos de teste rodam em paralelo no mesmo banco, e a
 * varredura completa gravaria nas fixtures deles (o problema que a trava
 * `teste:jobs-da-carteira` resolve para os outros dois jobs).
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `camp-carteira-${Date.now()}`
const sufixo = randomBytes(4).toString('hex')
const SENHA = 'quatro-pedras-no-caminho'
const FUSO = 'America/Sao_Paulo' // UTC-3, sem horário de verão desde 2019

const relogio: Relogio = { agora: () => new Date('2026-11-08T15:00:00.000Z') }

let migrate: pg.Client
let banco: BancoService
let servico: CampanhasCarteiraService
let app: NestFastifyApplication

let clinica: string
let pessoa: string
let grupoA: string
let grupoB: string
let clienteLigado: string // grupo A, com clínica
let clienteManual: string // grupo A, sem clínica
let clienteDoB: string // grupo B, sem clínica
let usuarioA: UsuarioDeGestaoPublico
let usuarioB: UsuarioDeGestaoPublico
let campanhaRosa: string
let campanhaBotox: string
let recebimentoDeNovembro: string
const pacientes: string[] = []

const RECEITAS_DE_OUTUBRO = [10000n, 20000n, 30000n, 40000n, 50000n]
const RECEITA_DA_BORDA = 60000n // 31/10 23:30 local
const RECEITA_DE_NOVEMBRO = 70000n // 01/11 00:00 local
const RECEITA_DO_BOTOX = 120000n

const ids = () => [clienteLigado, clienteManual, clienteDoB]
const sincronizar = () => executarSincronizacaoDeCampanhas(banco, relogio, { clienteIds: ids() })

async function novoPaciente(nome: string): Promise<string> {
  const id = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pacientes (clinica_id, nome) VALUES ($1, $2) RETURNING id`,
      [clinica, `${nome} ${codigo}`],
    )
  ).rows[0]!.id
  pacientes.push(id)
  return id
}

/** Atendimento concluído, com paciente, ligado à campanha, pago no instante dado. */
async function atendimentoPago(campanha: string, paciente: string, valor: bigint, instante: string): Promise<string> {
  const tarefa = (
    await migrate.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
          criada_em, paciente_id, tipo, historico, campanha_id)
       VALUES ($1, $2, $2, 'fixture', '2026-10-15', 'concluida', $3, $3, $4, 'Consulta realizada', '[]'::jsonb, $5)
       RETURNING id`,
      [clinica, pessoa, instante, paciente, campanha],
    )
  ).rows[0]!.id
  return (
    await migrate.query<{ id: string }>(
      `INSERT INTO recebimentos
         (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
       VALUES ($1, $2, $3, 'Consulta realizada', $4, 'Pix', 0, $5, $6) RETURNING id`,
      [clinica, paciente, tarefa, valor.toString(), instante, pessoa],
    )
  ).rows[0]!.id
}

type LinhaCompleta = Record<string, unknown> & { mes: string; campanha_origem_id: string | null }
const linhasDoBanco = async (cliente: string): Promise<LinhaCompleta[]> =>
  (
    await migrate.query<LinhaCompleta>(
      `SELECT *, mes_referencia::text AS mes FROM campanhas_carteira
        WHERE cliente_carteira_id = $1 ORDER BY campanha_origem_id NULLS LAST, mes_referencia, id`,
      [cliente],
    )
  ).rows

const linhaDe = async (campanha: string, mes: string): Promise<LinhaCompleta> =>
  (await linhasDoBanco(clienteLigado)).find((l) => l.campanha_origem_id === campanha && l.mes === mes)!

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  servico = new CampanhasCarteiraService(banco, relogio)

  clinica = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica das campanhas', $2) RETURNING id`,
      [codigo, FUSO],
    )
  ).rows[0]!.id
  const perfil = (
    await migrate.query<{ id: string }>(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, 'pf_rec', 'Recepção', '{}') RETURNING id`,
      [clinica],
    )
  ).rows[0]!.id
  pessoa = (
    await migrate.query<{ id: string }>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, senha_hash, perfil_id, ativo)
       VALUES ($1, 'Helena', 'helena', 'x', $2, true) RETURNING id`,
      [clinica, perfil],
    )
  ).rows[0]!.id

  const novaCampanha = async (nome: string, metrica: string, meta: number, inicio: string, fim: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO campanhas (clinica_id, categoria, foco, nome, objetivo, inicio, fim, metrica, tipo_metrica, meta, criada_por)
         VALUES ($1, 'Aniversariantes', '', $2, '', $3, $4, $5, '', $6, $7) RETURNING id`,
        [clinica, nome, inicio, fim, metrica, meta, pessoa],
      )
    ).rows[0]!.id
  campanhaRosa = await novaCampanha('Outubro Rosa', 'receita', 100000, '2026-10-01', '2026-11-30')
  campanhaBotox = await novaCampanha('Botox outubro', 'convertidos', 10, '2026-10-01', '2026-10-31')

  // Cinco pacientes pagam em outubro, no meio do mês...
  for (const [i, v] of RECEITAS_DE_OUTUBRO.entries()) {
    await atendimentoPago(campanhaRosa, await novoPaciente(`Rosa ${i}`), v, `2026-10-1${i}T15:00:00.000Z`)
  }
  // ...a sexta paga em 31/10 às 23:30 de São Paulo — já é 01/11 em UTC. É
  // outubro (T-18).
  await atendimentoPago(campanhaRosa, await novoPaciente('Rosa borda'), RECEITA_DA_BORDA, '2026-11-01T02:30:00.000Z')
  // Uma paga em 01/11 à 00:00 de São Paulo: novembro.
  recebimentoDeNovembro = await atendimentoPago(
    campanhaRosa,
    await novoPaciente('Rosa novembro'),
    RECEITA_DE_NOVEMBRO,
    '2026-11-01T03:00:00.000Z',
  )
  // Uma campanha pequena: um paciente, R$ 1.200,00 — o CE-3 do gate.
  await atendimentoPago(campanhaBotox, await novoPaciente('Botox'), RECEITA_DO_BOTOX, '2026-10-20T15:00:00.000Z')

  const novoGrupo = async (nome: string) =>
    (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [nome])).rows[0]!.id
  grupoA = await novoGrupo(`Grupo A ${codigo}`)
  grupoB = await novoGrupo(`Grupo B ${codigo}`)

  const novoCliente = async (grupo: string, clinicaId: string | null, nome: string) =>
    (
      await migrate.query<{ id: string }>(
        `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, status)
         VALUES ($1, $2, $3, 'FIR Clinic', $4) RETURNING id`,
        // Sem clínica, só `onboarding` (CHECK da 0032) até o cadastro completo (0.4).
        [grupo, clinicaId, nome, clinicaId === null ? 'onboarding' : 'ativo'],
      )
    ).rows[0]!.id
  clienteLigado = await novoCliente(grupoA, clinica, 'Clínica Ligada')
  clienteManual = await novoCliente(grupoA, null, 'Consultoria Manual')
  clienteDoB = await novoCliente(grupoB, null, 'Cliente do grupo B')

  const novoUsuario = async (grupo: string, usuario: string): Promise<UsuarioDeGestaoPublico> => {
    const id = (
      await migrate.query<{ id: string }>(
        `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Teste', $2, 'grupo', $3) RETURNING id`,
        [usuario, await hashDeSenha(SENHA), grupo],
      )
    ).rows[0]!.id
    return { id, usuario, nome: 'Teste', escopo: 'grupo', grupoId: grupo, senhaProvisoria: false, ...perfilPadraoDoBanco('grupo') }
  }
  usuarioA = await novoUsuario(grupoA, `campa.${sufixo}`)
  usuarioB = await novoUsuario(grupoB, `campb.${sufixo}`)
})

afterAll(async () => {
  if (usuarioA === undefined || usuarioB === undefined) return
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = ANY($1)', [[grupoA, grupoB]])
  await migrate.query('DELETE FROM campanhas_carteira WHERE cliente_carteira_id = ANY($1)', [ids()])
  await migrate.query('DELETE FROM sincronizacao_campanhas_carteira WHERE cliente_carteira_id = ANY($1)', [ids()])
  await migrate.query('DELETE FROM sessoes_de_carteira WHERE usuario_gestao_id = ANY($1)', [[usuarioA.id, usuarioB.id]])
  await migrate.query('DELETE FROM tentativas_de_carteira WHERE identificador = ANY($1)', [
    [usuarioA.usuario, usuarioB.usuario],
  ])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = ANY($1)', [[usuarioA.id, usuarioB.id]])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = ANY($1)', [ids()])
  await migrate.query('DELETE FROM grupos WHERE id = ANY($1)', [[grupoA, grupoB]])
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await banco.onModuleDestroy()
  if (app !== undefined) await app.close()
})

// ---------------------------------------------------------------------------
// K4 — a sincronização
// ---------------------------------------------------------------------------
describe('sincronização das campanhas (K4)', () => {
  it('T-17: três execuções dão as MESMAS linhas, e a receita bate com o CampanhasService', async () => {
    const primeira = await sincronizar()
    expect(primeira.falhas).toEqual([])
    expect(primeira.processados).toBe(1) // só o cliente ligado; os manuais não têm clínica
    const depoisDaPrimeira = await linhasDoBanco(clienteLigado)

    for (let i = 0; i < 2; i++) {
      const r = await sincronizar()
      expect(r.falhas).toEqual([])
      expect(r.linhasGravadas).toBe(0) // nada mudou, nada reescrito — nem `atualizado_em`
    }
    expect(await linhasDoBanco(clienteLigado)).toEqual(depoisDaPrimeira)

    // Rosa: outubro e novembro. Botox: outubro. Três linhas, nunca seis nem nove.
    expect(depoisDaPrimeira.map((l) => [l.campanha_origem_id, l.mes])).toEqual(
      [
        [campanhaRosa, '2026-10-01'],
        [campanhaRosa, '2026-11-01'],
        [campanhaBotox, '2026-10-01'],
      ].sort((a, b) => a[0]!.localeCompare(b[0]!) || a[1]!.localeCompare(b[1]!)),
    )

    // Contra a FONTE: Σ meses = receita do CampanhasService, exatamente.
    const fonte = await new CampanhasService(banco, relogio).listar({
      clinicaId: clinicaIdDeFonteConfiavel(clinica),
      ator: SISTEMA,
      fuso: FUSO,
    })
    for (const camp of fonte.campanhas) {
      const soma = depoisDaPrimeira
        .filter((l) => l.campanha_origem_id === camp.id)
        .reduce((s, l) => s + BigInt(l['receita_centavos'] as string), 0n)
      expect(soma, camp.nome).toBe(BigInt(camp.receita!))
    }
  })

  it('T-18: 31/10 23:30 de São Paulo é outubro; 01/11 00:00 é novembro — cada um exatamente uma vez', async () => {
    const outubro = await linhaDe(campanhaRosa, '2026-10-01')
    const novembro = await linhaDe(campanhaRosa, '2026-11-01')
    const somaOutubro = RECEITAS_DE_OUTUBRO.reduce((a, b) => a + b, 0n) + RECEITA_DA_BORDA
    expect(BigInt(outubro['receita_centavos'] as string)).toBe(somaOutubro)
    expect(outubro['orcamentos_pagos']).toBe(6)
    expect(BigInt(novembro['receita_centavos'] as string)).toBe(RECEITA_DE_NOVEMBRO)
    expect(novembro['orcamentos_pagos']).toBe(1)
    // Métrica de receita: o resultado da CÉLULA é a receita do mês.
    expect(BigInt(outubro['resultado'] as string)).toBe(somaOutubro)
    expect(outubro['status']).toBe('ativa')
    expect(outubro['categoria']).toBe('Aniversariantes')
  })

  it('ajuste 27: nunca escreve investimento nem observações — lançar, sincronizar 3×, conferir', async () => {
    const outubro = await linhaDe(campanhaRosa, '2026-10-01')
    await servico.atualizar(usuarioA, outubro['id'] as string, {
      investimento: 25000n,
      observacoes: 'Anúncio no Instagram',
    })

    // Um pagamento novo entre as rodadas: a receita TEM de mudar, o
    // investimento não.
    await atendimentoPago(campanhaRosa, await novoPaciente('Rosa tardia'), 5000n, '2026-10-25T15:00:00.000Z')
    for (let i = 0; i < 3; i++) expect((await sincronizar()).falhas).toEqual([])

    const depois = await linhaDe(campanhaRosa, '2026-10-01')
    expect(depois['investimento_centavos']).toBe('25000')
    expect(depois['observacoes']).toBe('Anúncio no Instagram')
    expect(BigInt(depois['receita_centavos'] as string)).toBe(
      RECEITAS_DE_OUTUBRO.reduce((a, b) => a + b, 0n) + RECEITA_DA_BORDA + 5000n,
    )
  })

  it('a sincronização não toca a campanha lançada à mão', async () => {
    const manual = await servico.criar(usuarioA, {
      clienteCarteiraId: clienteManual,
      nome: 'Indicação premiada',
      tipo: 'Indicação',
      mes: '2026-10',
      rotuloDaMetrica: 'Agendamentos',
      metaEmNumero: 20,
      resultadoEmNumero: 12,
      receita: 50000n,
      investimento: 10000n,
      orcamentosPagos: 2,
      status: 'ativa',
      observacoes: '',
    })
    const antes = await linhasDoBanco(clienteManual)
    for (let i = 0; i < 3; i++) await sincronizar()
    expect(await linhasDoBanco(clienteManual)).toEqual(antes)
    expect(antes).toHaveLength(1)
    expect(antes[0]!['id']).toBe(manual.id)
  })

  it('estorno que zera um mês ZERA a linha daquele mês — nunca deixa a receita antiga', async () => {
    await migrate.query(`UPDATE recebimentos SET estornado_em = now() WHERE id = $1`, [recebimentoDeNovembro])
    expect((await sincronizar()).falhas).toEqual([])
    const novembro = await linhaDe(campanhaRosa, '2026-11-01')
    expect(novembro['receita_centavos']).toBe('0')
    expect(novembro['orcamentos_pagos']).toBe(0)
    await migrate.query(`UPDATE recebimentos SET estornado_em = NULL WHERE id = $1`, [recebimentoDeNovembro])
    expect((await sincronizar()).falhas).toEqual([])
    expect((await linhaDe(campanhaRosa, '2026-11-01'))['receita_centavos']).toBe(RECEITA_DE_NOVEMBRO.toString())
  })

  it('marca quando o cliente foi sincronizado ("Última atualização")', async () => {
    const r = await migrate.query<{ sincronizado_em: Date }>(
      `SELECT sincronizado_em FROM sincronizacao_campanhas_carteira WHERE cliente_carteira_id = $1`,
      [clienteLigado],
    )
    expect(r.rows[0]!.sincronizado_em.toISOString()).toBe('2026-11-08T15:00:00.000Z')
  })
})

// ---------------------------------------------------------------------------
// Supressão ponta a ponta (LGPD A21–A23)
// ---------------------------------------------------------------------------
describe('supressão na leitura (V9 e K1)', () => {
  it('V9: a campanha pequena (Botox, 1 pagamento) sai sem valor e sem derivados, e nenhum total a revela', async () => {
    const botox = await linhaDe(campanhaBotox, '2026-10-01')
    // Investimento lançado na suprimida: o retorno dela daria a receita.
    await servico.atualizar(usuarioA, botox['id'] as string, { investimento: 40000n })

    const r = await servico.doCliente(usuarioA, clienteLigado, { periodo: '3m' })
    const json = JSON.stringify(r)
    expect(json).not.toContain(RECEITA_DO_BOTOX.toString())

    const linhaBotox = r.campanhas.find((c) => c.nome === 'Botox outubro')!
    expect(linhaBotox.suprimida).toBe(true)
    expect(linhaBotox.receita).toBeNull()
    expect(linhaBotox.retornoSobreInvestimento).toBeNull()
    expect(linhaBotox.resultadoEmNumero).toBeNull()
    expect(linhaBotox.percentualDaMeta).toBeNull()
    expect(linhaBotox.orcamentosPagos).toBeNull()

    // Rosa outubro: 7 pagantes, exibida, com retorno = total ÷ investimento.
    const rosaOut = r.campanhas.find((c) => c.nome === 'Outubro Rosa' && c.mes === '2026-10-01')!
    expect(rosaOut.suprimida).toBe(false)
    const receitaRosaOut = RECEITAS_DE_OUTUBRO.reduce((a, b) => a + b, 0n) + RECEITA_DA_BORDA + 5000n
    expect(rosaOut.receita).toBe(receitaRosaOut.toString())
    expect(rosaOut.retornoSobreInvestimento).toBe('8,6x') // 215000 / 25000 = 8,6

    // Rosa novembro: 1 pagante — suprimida também (k na CÉLULA, A21), mesmo
    // com a campanha somando 8 no período.
    const rosaNov = r.campanhas.find((c) => c.nome === 'Outubro Rosa' && c.mes === '2026-11-01')!
    expect(rosaNov.suprimida).toBe(true)
    expect(json).not.toContain(RECEITA_DE_NOVEMBRO.toString())

    // Complemento: o total do período é SÓ o das exibidas; o investimento da
    // suprimida fica fora do retorno do período.
    expect(r.kpis.periodo.valorGerado).toBe(receitaRosaOut.toString())
    expect(r.kpis.periodo.investimento).toBe('25000')
    expect(r.outras).toEqual({ quantidade: 2 })
    expect(r.soDasExibidas).toBe(true)
    // "Valor gerado neste mês" (novembro): só tem a suprimida → 0, nunca 70000.
    expect(r.kpis.mesAtual.valorGerado).toBe('0')
  })

  it('campanha pequena SOZINHA (cliente manual com 2 pagamentos): nenhum número a revela', async () => {
    const r = await servico.doCliente(usuarioA, clienteManual, { periodo: '3m' })
    expect(r.campanhas).toHaveLength(1)
    expect(r.campanhas[0]!.suprimida).toBe(true)
    expect(JSON.stringify(r)).not.toContain('50000')
    expect(r.kpis.periodo.valorGerado).toBe('0')
    expect(r.outras).toEqual({ quantidade: 1 })
  })

  it('K1: o comparativo usa só as células exibidas, em todo agregado', async () => {
    const r = await servico.comparativo(usuarioA, { periodo: '3m' })
    const json = JSON.stringify(r)
    for (const escondido of [RECEITA_DO_BOTOX, RECEITA_DE_NOVEMBRO, 50000n]) {
      expect(json).not.toContain(`"${escondido}"`)
    }
    expect(r.porCliente.map((c) => c.nome)).toEqual(['Clínica Ligada'])
    expect(r.maisGeraram.map((c) => c.nome)).toEqual(['Outubro Rosa'])
    expect(r.porTipo.map((t) => t.tipo)).toEqual(['Aniversariantes'])
    expect(r.outras.quantidade).toBe(3)
    expect(r.kpis.clientesAtualizandoSozinhos).toBe(1)
    expect(r.atualizacao.map((a) => a.nome).sort()).toEqual(['Clínica Ligada', 'Consultoria Manual'])
  })
})

// ---------------------------------------------------------------------------
// K3 — lançamento à mão e as regras de escrita
// ---------------------------------------------------------------------------
describe('lançamento à mão (K3)', () => {
  it('cliente ligado à clínica não recebe campanha à mão — as campanhas vêm da clínica', async () => {
    await expect(
      servico.criar(usuarioA, {
        clienteCarteiraId: clienteLigado,
        nome: 'Duplicada',
        tipo: 'Aniversariantes',
        mes: '2026-10',
        rotuloDaMetrica: 'Agendamentos',
        metaEmNumero: null,
        resultadoEmNumero: null,
        receita: null,
        investimento: null,
        orcamentosPagos: null,
        status: 'planejada',
        observacoes: '',
      }),
    ).rejects.toBeInstanceOf(ClienteComCampanhasDaClinica)
  })

  it('linha sincronizada aceita só investimento e observações', async () => {
    const outubro = await linhaDe(campanhaRosa, '2026-10-01')
    await expect(servico.atualizar(usuarioA, outubro['id'] as string, { nome: 'Outro nome' })).rejects.toBeInstanceOf(
      CampoDaCampanhaSincronizada,
    )
  })

  it('A-6: investimento null no PATCH NÃO apaga o valor guardado; "0" zera', async () => {
    const outubro = await linhaDe(campanhaRosa, '2026-10-01')
    const id = outubro['id'] as string
    await servico.atualizar(usuarioA, id, { investimento: null, observacoes: 'Anúncio no Instagram' })
    expect((await linhaDe(campanhaRosa, '2026-10-01'))['investimento_centavos']).toBe('25000')
    await servico.atualizar(usuarioA, id, { investimento: 0n })
    expect((await linhaDe(campanhaRosa, '2026-10-01'))['investimento_centavos']).toBe('0')
    await servico.atualizar(usuarioA, id, { investimento: 25000n })
  })

  it('toda escrita deixa trilha de→para em auditoria_da_carteira, com o autor', async () => {
    const r = await migrate.query<{ acao: string; usuario_gestao_id: string }>(
      `SELECT acao, usuario_gestao_id::text AS usuario_gestao_id FROM auditoria_da_carteira
        WHERE grupo_id = $1 AND tabela = 'campanhas_carteira' ORDER BY em`,
      [grupoA],
    )
    expect(r.rows.map((x) => x.acao)).toContain('criar')
    expect(r.rows.map((x) => x.acao)).toContain('atualizar')
    expect(new Set(r.rows.map((x) => x.usuario_gestao_id))).toEqual(new Set([usuarioA.id]))
  })
})

// ---------------------------------------------------------------------------
// Isolamento por grupo (serviço, com a RLS real)
// ---------------------------------------------------------------------------
describe('isolamento por grupo', () => {
  it('o usuário do grupo B não lê, não edita e não lança nas campanhas do grupo A', async () => {
    await expect(servico.doCliente(usuarioB, clienteLigado, { periodo: '3m' })).rejects.toBeInstanceOf(
      ClienteDaCampanhaNaoEncontrado,
    )
    const outubro = await linhaDe(campanhaRosa, '2026-10-01')
    await expect(servico.atualizar(usuarioB, outubro['id'] as string, { investimento: 1n })).rejects.toBeInstanceOf(
      CampanhaCarteiraNaoEncontrada,
    )
    await expect(
      servico.criar(usuarioB, {
        clienteCarteiraId: clienteManual,
        nome: 'Invasora',
        tipo: 'x',
        mes: '2026-10',
        rotuloDaMetrica: '',
        metaEmNumero: null,
        resultadoEmNumero: null,
        receita: null,
        investimento: null,
        orcamentosPagos: null,
        status: 'planejada',
        observacoes: '',
      }),
    ).rejects.toBeInstanceOf(ClienteDaCampanhaNaoEncontrado)

    const comparativo = await servico.comparativo(usuarioB, { periodo: '3m' })
    const json = JSON.stringify(comparativo)
    expect(json).not.toContain(clienteLigado)
    expect(json).not.toContain(clienteManual)
    expect(json).not.toContain('Outubro Rosa')
    expect((await linhaDe(campanhaRosa, '2026-10-01'))['investimento_centavos']).toBe('25000')
  })
})

// ---------------------------------------------------------------------------
// HTTP — rota real, guard real, redação real
// ---------------------------------------------------------------------------
describe('HTTP', () => {
  const cookies = (r: { headers: Record<string, string> }): string => {
    const v = r.headers['set-cookie'] as unknown
    const lista = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
    return lista.map((c) => c.split(';')[0]!).join('; ')
  }
  const http = () => request(app.getHttpServer())
  const entrar = async (usuario: string) =>
    cookies(await http().post('/v1/carteira/entrar').send({ usuario, senha: SENHA }).expect(200))

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await registrarCookie(app)
    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  it('sem cookie da carteira, 404', async () => {
    await http().get('/v1/carteira/campanhas').expect(404)
  })

  it('a rota entrega a forma completa, e os campos monetários saem null sem `valores` (redação num ponto só)', async () => {
    const sessao = await entrar(usuarioA.usuario)
    const r = await http().get(`/v1/carteira/clientes/${clienteLigado}/campanhas?periodo=3m`).set('Cookie', sessao).expect(200)
    const rosa = (r.body.campanhas as { nome: string; mes: string; receita: unknown; investimento: unknown; retornoSobreInvestimento: unknown; suprimida: boolean }[])
      .find((c) => c.nome === 'Outubro Rosa' && c.mes === '2026-10-01')!
    expect(rosa.suprimida).toBe(false)
    // Hoje nenhum Usuário de Gestão tem `valores` (0.5 ainda não existe), e o
    // interceptor falha fechado: todo valor sai null, inclusive o retorno.
    expect(rosa.receita).toBeNull()
    expect(rosa.investimento).toBeNull()
    expect(rosa.retornoSobreInvestimento).toBeNull()
    expect(r.body.kpis.periodo.valorGerado).toBeNull()

    const k1 = await http().get('/v1/carteira/campanhas?periodo=6m').set('Cookie', sessao).expect(200)
    expect(k1.body.porCliente[0].valorGerado).toBeNull()
    expect(k1.body.periodo.chave).toBe('6m')
  })

  it('cliente de outro grupo responde o mesmo 404 de "não existe"', async () => {
    const sessao = await entrar(usuarioB.usuario)
    await http().get(`/v1/carteira/clientes/${clienteLigado}/campanhas`).set('Cookie', sessao).expect(404)
    await http().get(`/v1/carteira/clientes/00000000-0000-4000-8000-000000000000/campanhas`).set('Cookie', sessao).expect(404)
  })

  it('entrada inválida é 400 na borda (Zod); período escolhido sem as duas pontas também', async () => {
    const sessao = await entrar(usuarioA.usuario)
    await http()
      .post('/v1/carteira/campanhas')
      .set('Cookie', sessao)
      .send({ clienteCarteiraId: clienteManual, nome: '', mes: '2026-13' })
      .expect(400)
    await http()
      .post('/v1/carteira/campanhas')
      .set('Cookie', sessao)
      .send({ clienteCarteiraId: clienteManual, nome: 'X', mes: '2026-10', receita: 10.5 })
      .expect(400)
    await http().get('/v1/carteira/campanhas?periodo=custom&de=2026-01').set('Cookie', sessao).expect(400)
  })
})
