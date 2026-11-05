import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import { BancoService } from '../../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { CobrancaCarteiraNaoEncontrada, CobrancasCarteiraService } from './cobrancas.service'

/**
 * **G3 — `CobrancasCarteiraService`, contra Postgres real.**
 *
 *  1. **Nenhum total colapsado (achado 1, ADR 0015):** `somaValor` é SEMPRE a
 *     soma EXATA das linhas devolvidas na mesma resposta.
 *  2. **Marcar pago é idempotente**, com trilha (quem, quando) em
 *     `auditoria_da_carteira`.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `cobrancas-${Date.now()}`

let migrate: pg.Client
let banco: BancoService
let servico: CobrancasCarteiraService
let grupo: string
let clinica: string
let cliente: string
let usuario: UsuarioDeGestaoPublico
const idsDasCobrancas: string[] = []

const novaCobranca = async (competencia: string, mensalidade: number, desconto = 0) =>
  (
    await migrate.query<{ id: string }>(
      `INSERT INTO cobrancas_do_cliente_firmare
         (cliente_carteira_id, grupo_id, competencia, mensalidade_centavos, desconto_centavos, valor_centavos, vencimento)
       VALUES ($1, $2, $3::date, $4::bigint, $5::bigint, $4::bigint - $5::bigint, $3::date + interval '9 days')
       RETURNING id`,
      [cliente, grupo, competencia, mensalidade, desconto],
    )
  ).rows[0]!.id

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  servico = new CobrancasCarteiraService(banco)

  grupo = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [
    `Grupo ${codigo}`,
  ])).rows[0]!.id
  clinica = (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`, [
      codigo,
      'Clínica de teste',
    ])
  ).rows[0]!.id
  cliente = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, mensalidade_centavos) VALUES ($1, $2, 'Cliente', 'Consultoria', 100000) RETURNING id`,
      [grupo, clinica],
    )
  ).rows[0]!.id
  const usuarioGestaoId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Teste', 'x', 'grupo', $2) RETURNING id`,
      [`cob.${codigo}`, grupo],
    )
  ).rows[0]!.id
  usuario = { id: usuarioGestaoId, usuario: `cob.${codigo}`, nome: 'Teste', escopo: 'grupo', grupoId: grupo, senhaProvisoria: false }

  idsDasCobrancas.push(await novaCobranca('2026-09-01', 100000))
  idsDasCobrancas.push(await novaCobranca('2026-10-01', 100000, 10000))
  idsDasCobrancas.push(await novaCobranca('2026-11-01', 150033))
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = $1', [cliente])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [usuario.id])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [cliente])
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupo])
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await banco.onModuleDestroy()
})

describe('CobrancasCarteiraService.listarPorCliente — nenhum total colapsado (achado 1, ADR 0015)', () => {
  it('somaValor é EXATAMENTE a soma das linhas devolvidas, nunca uma segunda consulta', async () => {
    const r = await servico.listarPorCliente(usuario, cliente)
    expect(r.cobrancas.length).toBe(3)

    const somaDasLinhas = r.cobrancas.reduce((acc, c) => acc + BigInt(c.valor!), 0n)
    expect(BigInt(r.somaValor!)).toBe(somaDasLinhas)
    // 90000 (100000-10000) + 100000 + 150033 = 340033
    expect(r.somaValor).toBe('340033')
  })
})

describe('CobrancasCarteiraService.marcarPago — idempotente, com trilha', () => {
  it('marca como pago, grava a trilha, e marcar de novo não muda pago_em', async () => {
    const id = idsDasCobrancas[0]!
    const primeira = await servico.marcarPago(usuario, id)
    expect(primeira.status).toBe('pago')
    expect(primeira.pagoEm).not.toBeNull()

    const auditoria = await migrate.query(
      `SELECT usuario_gestao_id, acao FROM auditoria_da_carteira WHERE tabela = 'cobrancas_do_cliente_firmare' AND registro_id = $1`,
      [id],
    )
    expect(auditoria.rows).toEqual([{ usuario_gestao_id: usuario.id, acao: 'marcar_pago' }])

    const segunda = await servico.marcarPago(usuario, id)
    expect(segunda.pagoEm).toBe(primeira.pagoEm) // idempotente: não reescreve

    const auditoriaDepois = await migrate.query(
      `SELECT count(*)::text AS n FROM auditoria_da_carteira WHERE tabela = 'cobrancas_do_cliente_firmare' AND registro_id = $1`,
      [id],
    )
    expect(auditoriaDepois.rows[0]!.n).toBe('1') // segunda chamada não grava outra entrada
  })

  it('cobrança inexistente lança CobrancaCarteiraNaoEncontrada', async () => {
    await expect(servico.marcarPago(usuario, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      CobrancaCarteiraNaoEncontrada,
    )
  })
})

describe('CobrancasCarteiraService.desfazerPago — "Desfazer" (critério 2.2.9, spec G3)', () => {
  it('marca pago, desfaz, e confirma o estado revertido com as DUAS linhas de auditoria', async () => {
    const id = idsDasCobrancas[1]!

    const paga = await servico.marcarPago(usuario, id)
    expect(paga.status).toBe('pago')
    expect(paga.pagoEm).not.toBeNull()

    const desfeita = await servico.desfazerPago(usuario, id)
    expect(desfeita.status).toBe('aberto')
    expect(desfeita.pagoEm).toBeNull()
    // Dinheiro nunca muda ao desfazer — só o estado de pagamento.
    expect(desfeita.valor).toBe(paga.valor)

    const auditoria = await migrate.query<{ acao: string }>(
      `SELECT acao FROM auditoria_da_carteira
        WHERE tabela = 'cobrancas_do_cliente_firmare' AND registro_id = $1
        ORDER BY em ASC`,
      [id],
    )
    expect(auditoria.rows.map((r) => r.acao)).toEqual(['marcar_pago', 'desfazer_pago'])

    // Idempotente: desfazer de novo (já aberto) não grava uma TERCEIRA linha.
    const segundaVez = await servico.desfazerPago(usuario, id)
    expect(segundaVez.status).toBe('aberto')
    const auditoriaDepois = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria_da_carteira
        WHERE tabela = 'cobrancas_do_cliente_firmare' AND registro_id = $1`,
      [id],
    )
    expect(auditoriaDepois.rows[0]!.n).toBe('2')
  })

  it('desfazer uma cobrança que nunca foi paga não muda nada e não grava auditoria', async () => {
    const id = idsDasCobrancas[2]!
    const antes = await migrate.query(`SELECT status FROM cobrancas_do_cliente_firmare WHERE id = $1`, [id])
    expect(antes.rows[0]!.status).toBe('aberto')

    const r = await servico.desfazerPago(usuario, id)
    expect(r.status).toBe('aberto')
    expect(r.pagoEm).toBeNull()

    const auditoria = await migrate.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM auditoria_da_carteira
        WHERE tabela = 'cobrancas_do_cliente_firmare' AND registro_id = $1`,
      [id],
    )
    expect(auditoria.rows[0]!.n).toBe('0')
  })

  it('cobrança inexistente lança CobrancaCarteiraNaoEncontrada', async () => {
    await expect(servico.desfazerPago(usuario, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      CobrancaCarteiraNaoEncontrada,
    )
  })
})
