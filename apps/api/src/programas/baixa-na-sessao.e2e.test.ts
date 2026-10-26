import { erro, erroDe, ok, Quantidade, type Result } from '@fir/domain'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  limparProgramas,
  montarCenario,
  postar,
  recebimentosDe,
} from '../tarefas/__tests__/cenario'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'
import {
  BaixaDeInsumos,
  type MotivoDeDesfazer,
  type PedidoDeBaixa,
} from './baixa-de-insumos'

/**
 * **O SEAM DO ESTOQUE, PELA ROTA.**
 *
 * `BaixaInerte` é o provider de produção até o épico 6, e ela não falha nem
 * registra nada — então o que se pode provar aqui é exatamente o que o épico 6
 * vai herdar: **com que pedido a baixa é chamada**, **que ela é chamada dentro
 * da transação** (uma falha dela desfaz a conclusão inteira), e **que reabrir
 * chama o desfazer com o motivo certo**.
 *
 * O espião substitui o provider no contêiner. Isso é deliberado e está contido:
 * é a única porta para medir uma chamada a um seam inerte, e a alternativa
 * seria esperar o épico 6 — que é quando o erro custaria dez vezes mais.
 */

type Chamada = { readonly pedido: PedidoDeBaixa }
type Desfeita = { readonly tarefaId: string; readonly motivo: MotivoDeDesfazer }

class BaixaEspia extends BaixaDeInsumos {
  readonly baixas: Chamada[] = []
  readonly desfeitas: Desfeita[] = []
  /** Quando `true`, a baixa recusa — é o épico 6 sem saldo para a dose. */
  falhar = false

  async baixar(_tx: Transacao, pedido: PedidoDeBaixa): Promise<Result<void>> {
    this.baixas.push({ pedido })
    if (this.falhar) {
      return erro(erroDe('SEM_SALDO', 'Não há saldo suficiente de Tirzepatida ampola.'))
    }
    return ok(undefined)
  }

  async desfazer(
    _tx: Transacao,
    _clinicaId: ClinicaId,
    tarefaId: string,
    motivo: MotivoDeDesfazer,
  ): Promise<Result<void>> {
    this.desfeitas.push({ tarefaId, motivo })
    return ok(undefined)
  }

  limpar(): void {
    this.baixas.length = 0
    this.desfeitas.length = 0
    this.falhar = false
  }
}

const espia = new BaixaEspia()

let c: Cenario
let tirze: string

/** Os uuids do épico 6 — ainda sem tabela por trás, e sem FK (dívida (b)). */
const AMPOLA = '11111111-1111-4111-8111-111111111111'
const SERINGA = '22222222-2222-4222-8222-222222222222'
const AGULHA = '33333333-3333-4333-8333-333333333333'

const montar = (corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer()).post('/v1/programas').set('Cookie', c.cookies[quem]!).send(corpo)

const concluirSessao = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  postar(c, `/v1/programas/sessoes/${id}/concluir`, corpo, quem)

const umaSessao = async (
  item: Record<string, unknown> = {},
): Promise<{ id: string; sessaoId: string }> => {
  const r = await montar({
    pacienteId: c.pacientes['ana'],
    inicio: '2026-10-20',
    itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 1, intervaloDias: 7, ...item }],
  })
  expect(r.statusCode, JSON.stringify(r.body)).toBe(201)
  const s = await c.migrate.query<{ id: string }>(
    `SELECT id FROM tarefas WHERE programa_id = $1 AND tipo = 'Sessão de plano'`,
    [r.body.id],
  )
  return { id: r.body.id as string, sessaoId: s.rows[0]!.id }
}

beforeAll(async () => {
  c = await montarCenario('baixa', [{ token: BaixaDeInsumos, valor: espia }])
  const p = await c.migrate.query<{ id: string }>(
    `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
    [c.clinica],
  )
  tirze = p.rows[0]!.id
  // Dois descartáveis fixos no procedimento, como o cadastro do protótipo tem.
  for (const [i, item] of [SERINGA, AGULHA].entries()) {
    await c.migrate.query(
      `INSERT INTO insumos_do_procedimento
         (clinica_id, procedimento_id, item_id, milesimos, unidade, ordem)
       VALUES ($1,$2,$3,1000,'un',$4)`,
      [c.clinica, tirze, item, i],
    )
  }
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparProgramas(c)
  espia.limpar()
})

describe('concluir chama a baixa', () => {
  it('com a DOSE DO ITEM e os descartáveis do procedimento, na ordem', async () => {
    const p = await umaSessao({
      dose: '2,5 mg',
      insumo: { itemId: AMPOLA, quantidade: '2500', unidade: 'mg' },
    })
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)

    expect(espia.baixas).toHaveLength(1)
    const pedido = espia.baixas[0]!.pedido
    expect(
      pedido.insumos.map((x) => ({
        itemId: x.itemId,
        milesimos: x.quantidade.milesimos,
        unidade: x.quantidade.unidade,
        principal: x.principal,
      })),
    ).toEqual([
      // A dose, em MILÉSIMOS INTEIROS e com a unidade junto (regras 8 e 10).
      { itemId: AMPOLA, milesimos: 2500n, unidade: 'mg', principal: true },
      // Descartável NUNCA é principal: seringa não tem sobra de frasco aberto.
      { itemId: SERINGA, milesimos: 1000n, unidade: 'un', principal: false },
      { itemId: AGULHA, milesimos: 1000n, unidade: 'un', principal: false },
    ])
    expect(pedido).toMatchObject({
      tarefaId: p.sessaoId,
      programaId: p.id,
      itemChave: 'i1',
      pacienteId: c.pacientes['ana'],
      procedimentoId: tirze,
      em: '2026-10-20',
    })
  })

  it('a dose DO ITEM vence a do procedimento — é a dose DAQUELA paciente', async () => {
    // O cadastro traz 5 mg; a paciente está na escalada de 2,5 mg. Usar a do
    // catálogo aplicaria o dobro.
    await c.migrate.query(
      `UPDATE procedimentos
          SET insumo_padrao_id = $2, insumo_padrao_milesimos = 5000, insumo_padrao_unidade = 'mg'
        WHERE id = $1`,
      [tirze, AMPOLA],
    )
    try {
      const p = await umaSessao({
        insumo: { itemId: AMPOLA, quantidade: '2500', unidade: 'mg' },
      })
      await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
      const principal = espia.baixas[0]!.pedido.insumos.find((x) => x.principal)!
      expect(principal.quantidade.milesimos).toBe(2500n)
    } finally {
      await c.migrate.query(
        `UPDATE procedimentos SET insumo_padrao_id = NULL, insumo_padrao_milesimos = NULL,
                                  insumo_padrao_unidade = NULL WHERE id = $1`,
        [tirze],
      )
    }
  })

  it('SEM insumo no item, cai no PADRÃO do procedimento', async () => {
    await c.migrate.query(
      `UPDATE procedimentos
          SET insumo_padrao_id = $2, insumo_padrao_milesimos = 5000, insumo_padrao_unidade = 'mg'
        WHERE id = $1`,
      [tirze, AMPOLA],
    )
    try {
      const p = await umaSessao()
      await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
      const principal = espia.baixas[0]!.pedido.insumos.find((x) => x.principal)!
      expect(principal.quantidade.milesimos).toBe(5000n)
      expect(principal.itemId).toBe(AMPOLA)
    } finally {
      await c.migrate.query(
        `UPDATE procedimentos SET insumo_padrao_id = NULL, insumo_padrao_milesimos = NULL,
                                  insumo_padrao_unidade = NULL WHERE id = $1`,
        [tirze],
      )
    }
  })

  it('sem insumo em lugar nenhum, a baixa é chamada só com os descartáveis', async () => {
    const p = await umaSessao()
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    expect(espia.baixas[0]!.pedido.insumos.every((x) => !x.principal)).toBe(true)
  })
})

describe('a baixa está DENTRO da transação', () => {
  it('a baixa que FALHA desfaz a conclusão inteira', async () => {
    /**
     * O épico 6 vai falhar aqui quando o saldo não cobrir a dose. Quando isso
     * acontecer, a sessão **não pode ficar concluída**: a enfermagem precisa
     * saber que o frasco acabou ANTES de registrar que aplicou — e o
     * recebimento que a mesma chamada lançou tem de voltar atrás.
     *
     * É por isso que a baixa é a ÚLTIMA escrita da transação: ela é a única
     * que pode falhar por motivo do mundo, e falhar depois de tudo escrito é o
     * que torna o rollback significativo.
     */
    const p = await umaSessao({
      insumo: { itemId: AMPOLA, quantidade: '2500', unidade: 'mg' },
    })
    espia.falhar = true
    const r = await concluirSessao(p.sessaoId, {
      em: '2026-10-20',
      reprogramar: false,
      pagamento: { valor: '30000', forma: 'Pix' },
    })
    expect(r.statusCode, JSON.stringify(r.body)).toBe(409)
    expect(String(r.body.message)).toContain('saldo suficiente')

    const s = await c.migrate.query<{ status: string }>('SELECT status FROM tarefas WHERE id = $1', [
      p.sessaoId,
    ])
    expect(s.rows[0]!.status).toBe('aberta')
    // Nem vivo, nem estornado: o recebimento nunca existiu.
    expect(await recebimentosDe(c, p.sessaoId)).toHaveLength(0)
  })

  it('a baixa INERTE não impede nada — a clínica sem estoque usa programas', async () => {
    // O espião devolve `ok` quando `falhar` é falso, igual à `BaixaInerte` de
    // produção. Uma recusa aqui transformaria "o estoque não entrou ainda" em
    // "a enfermagem não consegue registrar a aplicação".
    const p = await umaSessao()
    expect(
      (await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false })).statusCode,
    ).toBe(200)
  })
})

describe('reabrir chama o desfazer', () => {
  it('com o `tarefaId` e o motivo `sessao-reaberta`', async () => {
    const p = await umaSessao({
      insumo: { itemId: AMPOLA, quantidade: '2500', unidade: 'mg' },
    })
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    await postar(c, `/v1/programas/sessoes/${p.sessaoId}/reabrir`, {}, 'beatriz').expect(200)

    expect(espia.desfeitas).toEqual([{ tarefaId: p.sessaoId, motivo: 'sessao-reaberta' }])
  })

  it('a ida-e-volta chama baixar e desfazer na ORDEM, uma vez cada', async () => {
    const p = await umaSessao({
      insumo: { itemId: AMPOLA, quantidade: '2500', unidade: 'mg' },
    })
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    await postar(c, `/v1/programas/sessoes/${p.sessaoId}/reabrir`, {}, 'beatriz').expect(200)
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    await postar(c, `/v1/programas/sessoes/${p.sessaoId}/reabrir`, {}, 'beatriz').expect(200)

    expect(espia.baixas).toHaveLength(2)
    expect(espia.desfeitas).toHaveLength(2)
    // A mesma quantidade e o mesmo item nas duas idas: é o que torna a
    // idempotência de `desfazer` exigível do épico 6.
    expect(espia.baixas[0]!.pedido.insumos.map((x) => x.quantidade.milesimos)).toEqual(
      espia.baixas[1]!.pedido.insumos.map((x) => x.quantidade.milesimos),
    )
  })

  it('a dose chega como `Quantidade`, nunca como número solto', async () => {
    // Regra 10: a dose anda COM a unidade, sempre. `Quantidade` a carrega no
    // tipo, e um `number` perto de dose não tem como ser escrito aqui.
    const p = await umaSessao({
      insumo: { itemId: AMPOLA, quantidade: '2500', unidade: 'mg' },
    })
    await concluirSessao(p.sessaoId, { em: '2026-10-20', reprogramar: false }).expect(200)
    const q = espia.baixas[0]!.pedido.insumos[0]!.quantidade
    expect(q).toBeInstanceOf(Quantidade)
    expect(typeof q.milesimos).toBe('bigint')
  })
})
