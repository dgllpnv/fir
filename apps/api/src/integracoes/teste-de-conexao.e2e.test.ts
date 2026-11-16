import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { BancoService } from '../banco/banco.service'
import { type ClinicaId, clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import { type Cenario, desmontarCenario, montarCenario } from '../tarefas/__tests__/cenario'
import { AberturaDeIntegracoes, SeloDeIntegracoes } from './cofre-de-integracoes'
import { ErroDoMedx } from './medx/erros'
import { LeitorDoMedx } from './medx/leitor-do-medx'
import type { Pedido, Transporte } from './medx/transporte'
import { TesteDeConexao } from './teste-de-conexao'

/**
 * O "Testar conexão" que o worker executa (spec A.3–A.5, gate S-1, S-6, B5),
 * contra o Postgres real com o papel `fir_integracoes` e um MedX falso.
 */
const CHAVE = 'medx_chave_de_teste_0123456789abcdef'
let c: Cenario
let banco: BancoService
let clinica: ClinicaId
let outra: ClinicaId
const selo = SeloDeIntegracoes.doAmbiente()

let medx: { escopos: string; usuario: unknown; unidades: unknown[]; falha?: ErroDoMedx }
const pedidos: Pedido[] = []
const transporte: Transporte = async (p) => {
  pedidos.push(p)
  if (medx.falha) throw medx.falha
  if (p.caminho === '/token') return JSON.stringify({ accessToken: 'jwt', expiresInSeconds: 900, scope: medx.escopos })
  if (p.caminho === '/agenda/usuario-atual') return JSON.stringify(medx.usuario)
  if (p.caminho === '/financas/unidades') return JSON.stringify({ unidades: medx.unidades, page: { hasMore: false } })
  throw new Error(`rota inesperada ${p.caminho}`)
}
const executor = () => new TesteDeConexao(banco, AberturaDeIntegracoes.doAmbiente(), new LeitorDoMedx(transporte))

async function gravarChave(clinicaId: ClinicaId, chave = CHAVE, seladaPara: string = clinicaId) {
  const s = selo.selar(seladaPara, 'medx', chave)
  await c.migrate.query(
    `INSERT INTO integracoes_da_clinica
       (clinica_id, provedor, segredo_cifrado, segredo_versao, final_da_chave, impressao_da_chave, verificacao,
        verificacao_pedida_em, termo_assinado_em, termo_assinado_por, termo_versao)
     VALUES ($1, 'medx', $2, $3, $4, $5, 'nao_verificada', now(), '2026-11-16', 'Dra. X', 'v1')
     ON CONFLICT (clinica_id) DO UPDATE SET segredo_cifrado = $2, segredo_versao = $3, final_da_chave = $4,
       impressao_da_chave = $5, verificacao = 'nao_verificada', conta_externa_id = NULL, agenda_ligada = false,
       faturamento_ligado = false, verificacao_pedida_em = now()`,
    [clinicaId, s.cifrado, s.versao, chave.slice(-4), selo.impressao('medx', chave)],
  )
}
const linha = async (clinicaId: ClinicaId) =>
  (
    await c.migrate.query(
      `SELECT verificacao, conta_externa_id, usuario_externo_nome, escopos, unidades_externas, ultimo_erro,
              agenda_ligada, verificada_em IS NOT NULL AND verificada_em >= verificacao_pedida_em AS respondida
         FROM integracoes_da_clinica WHERE clinica_id = $1`,
      [clinicaId],
    )
  ).rows[0]

beforeAll(async () => {
  c = await montarCenario('medx-teste')
  banco = new BancoService()
  clinica = clinicaIdDeFonteConfiavel(c.clinica)
  outra = clinicaIdDeFonteConfiavel(c.outraClinica)
})
afterAll(async () => {
  await c.migrate.query('DELETE FROM integracoes_da_clinica WHERE clinica_id = ANY($1)', [[c.clinica, c.outraClinica]])
  await banco.onModuleDestroy()
  await desmontarCenario(c)
})
beforeEach(async () => {
  await c.migrate.query('DELETE FROM integracoes_da_clinica WHERE clinica_id = ANY($1)', [[c.clinica, c.outraClinica]])
  medx = {
    escopos: 'agenda:read contatos:details:read financas:read',
    usuario: { id: 42, nome: 'Integração FIR', conselho: 'CRM 1/BA' },
    unidades: [{ id: 1, nome: 'Matriz', documento: '00.000.000/0001-00' }],
  }
  pedidos.length = 0
})

describe('Testar conexão, no worker', () => {
  it('verde: grava a conta, o usuário, os escopos e a unidade; só fala com token, usuário e unidades', async () => {
    await gravarChave(clinica)
    expect(await executor().executar(clinica)).toBe('ok')
    expect(await linha(clinica)).toMatchObject({
      verificacao: 'ok',
      conta_externa_id: '42',
      usuario_externo_nome: 'Integração FIR',
      escopos: ['agenda:read', 'contatos:details:read', 'financas:read'],
      unidades_externas: 1,
      ultimo_erro: '',
      respondida: true,
    })
    expect(pedidos.map((p) => p.caminho)).toEqual(['/token', '/agenda/usuario-atual', '/financas/unidades'])
    expect(pedidos[0]?.corpo).toEqual({ integrationToken: CHAVE })
  })

  it('escopo a mais (escrita, prontuário) recusa e diz qual sobra', async () => {
    await gravarChave(clinica)
    medx.escopos += ' agenda:write prontuario:summary:read'
    expect(await executor().executar(clinica)).toBe('recusada')
    const l = await linha(clinica)
    expect(l).toMatchObject({ verificacao: 'recusada', conta_externa_id: null, agenda_ligada: false })
    expect(l.ultimo_erro).toMatch(/agenda:write/)
    expect(l.ultimo_erro).toMatch(/prontuario:summary:read/)
  })

  it('escopo que falta recusa e diz qual falta', async () => {
    await gravarChave(clinica)
    medx.escopos = 'agenda:read'
    expect(await executor().executar(clinica)).toBe('recusada')
    expect((await linha(clinica)).ultimo_erro).toMatch(/contatos:details:read/)
  })

  it('mais de uma unidade recusa', async () => {
    await gravarChave(clinica)
    medx.unidades = [{ id: 1 }, { id: 2 }]
    expect(await executor().executar(clinica)).toBe('recusada')
    expect((await linha(clinica)).ultimo_erro).toMatch(/mais de uma unidade/)
  })

  it('o MedX recusou: mensagem do catálogo, nada do MedX', async () => {
    await gravarChave(clinica)
    medx.falha = new ErroDoMedx('recusada')
    expect(await executor().executar(clinica)).toBe('recusada')
    const l = await linha(clinica)
    expect(l.ultimo_erro).toBe('O MedX recusou a chave. Gere outra no MedX e cole aqui.')
    expect(JSON.stringify(l)).not.toContain(CHAVE)
  })

  it('o selado de outra clínica não abre: chave inválida, sem chamar o MedX', async () => {
    await gravarChave(clinica, CHAVE, c.outraClinica)
    expect(await executor().executar(clinica)).toBe('recusada')
    expect((await linha(clinica)).ultimo_erro).toMatch(/não abre/)
    expect(pedidos).toHaveLength(0)
  })

  it('a mesma conta do MedX em duas clínicas: a segunda é recusada (S-6)', async () => {
    await gravarChave(clinica)
    expect(await executor().executar(clinica)).toBe('ok')
    await gravarChave(outra, 'medx_outra_chave_mesma_conta_999999')
    expect(await executor().executar(outra)).toBe('recusada')
    expect((await linha(outra)).ultimo_erro).toMatch(/outra clínica/)
  })

  it('sem chave, nada acontece', async () => {
    expect(await executor().executar(clinica)).toBe('sem-chave')
    expect(pedidos).toHaveLength(0)
  })

  it('fir_integracoes não reescreve o segredo nem o termo', async () => {
    const cli = new pg.Client({ connectionString: 'postgresql://fir_integracoes:fir_local_dev@127.0.0.1:4832/fir' })
    await cli.connect()
    try {
      await expect(cli.query(`UPDATE integracoes_da_clinica SET segredo_cifrado = NULL`)).rejects.toMatchObject({ code: '42501' })
      await expect(cli.query(`UPDATE integracoes_da_clinica SET termo_versao = 'x'`)).rejects.toMatchObject({ code: '42501' })
    } finally {
      await cli.end()
    }
  })
})
