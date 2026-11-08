import type { UsuarioDeGestaoPublico } from '@fir/contracts'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BancoService } from '../../banco/banco.service'
import { apagarClinicaDeTeste, declararAtorSistema } from '../../banco/limpeza-de-teste'
import { BeneficiosDeIndicacaoService, ClienteCarteiraNaoEncontradoParaBeneficio } from './beneficios.service'
import { perfilPadraoDoBanco } from '../perfil-do-usuario-de-gestao'

/**
 * **G3 — `BeneficiosDeIndicacaoService`, contra Postgres real.**
 *
 * O gap do code-review: `CriarBeneficioDeIndicacaoEntrada`/
 * `BeneficioDeIndicacaoNaLista`/`BeneficioDeIndicacaoCriadoSaida` já existiam
 * em `packages/contracts`, mas só eram usados via SQL cru nos testes do job
 * (`gerar-cobrancas.e2e.test.ts`). Este arquivo prova a CRIAÇÃO (gap do
 * code-review): grava a linha e a trilha (`auditoria_da_carteira`,
 * `acao='criar'`).
 *
 * **O CONSUMO (achado 3, ADR 0015) — um Benefício criado por este service
 * sendo pego pelo job de geração — está em `gerar-cobrancas.e2e.test.ts`,
 * não aqui**, de propósito: aquele teste cria um `Cliente Firmare` com
 * `status = 'ativo'` durante a chamada a `executarGeracaoDeCobrancas`, que
 * varre TODO cliente ativo do banco, globalmente, sem filtrar por
 * grupo/arquivo. Um cliente ativo deste arquivo, rodando em paralelo
 * (Vitest roda arquivos de `apps/api` em paralelo por padrão — ver o
 * comentário em `banco.service.test.ts`), seria varrido pela idempotência
 * ESTRITA (`toBe(0)`) que `gerar-cobrancas.e2e.test.ts` já exige de si mesmo
 * — e quebraria aquele teste com um `geradas` vindo de um cliente que não é
 * dele. Medido ao vivo nesta máquina. Manter os dois testes do MESMO job no
 * MESMO arquivo os torna sequenciais entre si (describes de um arquivo não
 * rodam em paralelo) sem exigir `fileParallelism: false` para o pacote
 * inteiro.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const codigo = `beneficios-${Date.now()}`

let migrate: pg.Client
let banco: BancoService
let servico: BeneficiosDeIndicacaoService
let grupo: string
let clinica: string
let cliente: string
let usuario: UsuarioDeGestaoPublico

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
  await declararAtorSistema(migrate)
  banco = new BancoService()
  servico = new BeneficiosDeIndicacaoService(banco)

  grupo = (await migrate.query<{ id: string }>(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id`, [
    `Grupo ${codigo}`,
  ])).rows[0]!.id
  clinica = (
    await migrate.query<{ id: string }>(`INSERT INTO clinicas (codigo, nome) VALUES ($1, $2) RETURNING id`, [
      codigo,
      'Clínica de teste',
    ])
  ).rows[0]!.id
  // SEM `status` (fica `onboarding`, o default) — este arquivo nunca chama
  // `executarGeracaoDeCobrancas`, então nunca precisa de um `Cliente Firmare`
  // ATIVO, e um ativo aqui seria varrido pelo job de OUTRO arquivo em
  // paralelo (ver o comentário do topo).
  cliente = (
    await migrate.query<{ id: string }>(
      `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, mensalidade_centavos)
       VALUES ($1, $2, 'Cliente', 'Consultoria', 185033) RETURNING id`,
      [grupo, clinica],
    )
  ).rows[0]!.id
  const usuarioGestaoId = (
    await migrate.query<{ id: string }>(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, grupo_id) VALUES ($1, 'Teste', 'x', 'grupo', $2) RETURNING id`,
      [`ben.${codigo}`, grupo],
    )
  ).rows[0]!.id
  usuario = {
    id: usuarioGestaoId,
    usuario: `ben.${codigo}`,
    nome: 'Teste',
    escopo: 'grupo',
    grupoId: grupo,
    senhaProvisoria: false,
    ...perfilPadraoDoBanco('grupo'),
  }
})

afterAll(async () => {
  await declararAtorSistema(migrate)
  await migrate.query('DELETE FROM auditoria_da_carteira WHERE grupo_id = $1', [grupo])
  await migrate.query('DELETE FROM beneficios_de_indicacao WHERE cliente_carteira_id = $1', [cliente])
  await migrate.query('DELETE FROM usuarios_gestao WHERE id = $1', [usuario.id])
  await migrate.query('DELETE FROM clientes_carteira WHERE id = $1', [cliente])
  await migrate.query('DELETE FROM grupos WHERE id = $1', [grupo])
  await apagarClinicaDeTeste(migrate, clinica)
  await migrate.end()
  await banco.onModuleDestroy()
})

describe('BeneficiosDeIndicacaoService.criar', () => {
  it('cria o Benefício e grava a trilha (acao=criar) em auditoria_da_carteira', async () => {
    const beneficio = await servico.criar(usuario, {
      clienteCarteiraId: cliente,
      percentualCentesimos: 1000n,
      motivo: 'indicação de teste',
    })

    expect(beneficio.clienteCarteiraId).toBe(cliente)
    expect(beneficio.percentualCentesimos).toBe('1000')
    expect(beneficio.consumidoEm).toBeNull()
    expect(beneficio.cobrancaId).toBeNull()

    const auditoria = await migrate.query<{ usuario_gestao_id: string; acao: string }>(
      `SELECT usuario_gestao_id, acao FROM auditoria_da_carteira
        WHERE tabela = 'beneficios_de_indicacao' AND registro_id = $1`,
      [beneficio.id],
    )
    expect(auditoria.rows).toEqual([{ usuario_gestao_id: usuario.id, acao: 'criar' }])
  })

  it('cliente inexistente lança ClienteCarteiraNaoEncontradoParaBeneficio', async () => {
    await expect(
      servico.criar(usuario, {
        clienteCarteiraId: '00000000-0000-0000-0000-000000000000',
        percentualCentesimos: 1000n,
        motivo: null,
      }),
    ).rejects.toThrow(ClienteCarteiraNaoEncontradoParaBeneficio)
  })
})
