import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  montarCenario,
  postar,
  remendar,
} from './__tests__/cenario'
import { criarPersona } from './__tests__/persona-extra'

/**
 * F6 (appsec): a RESPOSTA de toda rota de ESCRITA de tarefa também é saída.
 *
 * `lerTarefas` montava o cartão cru, sem `aplicarPermissaoDeJornada`: quem era
 * responsável pela tarefa e não tinha `jornada` recebia de volta o histórico, a
 * dose do programa orçado, os procedimentos do orçamento e o próximo passo — o
 * que as rotas de LEITURA já tiram desde a B1.
 */
let c: Cenario
const PROC = '11111111-1111-4111-8111-111111111111'

beforeAll(async () => {
  c = await montarCenario('escrita-sem-jornada')
  await criarPersona(c, 'semjor', ['pacientes'])
  await criarPersona(c, 'comjor', ['pacientes', 'jornada'])
})
afterAll(async () => {
  await desmontarCenario(c)
})

/** Uma tarefa do paciente com TODA a jornada preenchida, de `quem`. */
async function comJornada(
  quem: string,
  status: 'aberta' | 'concluida',
  comOrcamento = status === 'concluida',
): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, status, concluida_em,
        paciente_id, tipo, etapa, historico, proximo_passo_em, programa_orcado, valor_orcamento)
     VALUES ($1, $2, $2, 'orcamento', $3::date, $4::status_de_tarefa, CASE WHEN $4::status_de_tarefa = 'concluida' THEN now() END,
        $5, $6, $9::etapa_de_jornada, $7::jsonb, '2026-11-20', $8::jsonb, $10::bigint)
     RETURNING id`,
    [
      c.clinica,
      c.pessoas[quem],
      HOJE,
      status,
      c.pacientes['ana'],
      status === 'concluida' ? 'Consulta realizada' : 'Consulta agendada',
      JSON.stringify([
        { acao: 'orcamento', etapa: 'orcamento', em: '2026-10-10T10:00:00Z', nota: 'quer harmonizacao facial' },
      ]),
      // O CHECK `orcamento_so_com_etapa` só deixa a dose e o valor numa tarefa
      // em etapa de orçamento (que é sempre concluída).
      comOrcamento
        ? JSON.stringify([{ procedimentoId: PROC, sessoes: 2, intervaloDias: 30, chave: 'i1', dose: '20 UI' }])
        : null,
      comOrcamento ? 'orcamento' : status === 'concluida' ? 'realizado' : 'agendado',
      comOrcamento ? '100000' : null,
    ],
  )
  return r.rows[0]!.id
}

type Cartao = {
  id: string
  historico: unknown[]
  proximoPassoEm: string | null
  programaOrcado: unknown[] | null
  itensOrcamento: unknown[] | null
}
type Resposta = { statusCode: number; body: { tarefa: Cartao; todas: Cartao[] } }

const ESCRITAS: Record<string, (quem: string) => Promise<{ res: Resposta; id: string }>> = {
  'PATCH /v1/tarefas/:id com {} (orçamento concluído)': async (q) => {
    const id = await comJornada(q, 'concluida', true)
    return { id, res: (await remendar(c, `/v1/tarefas/${id}`, {}, q)) as unknown as Resposta }
  },
  'POST /v1/tarefas/:id/concluir': async (q) => {
    const id = await comJornada(q, 'aberta')
    return {
      id,
      res: (await postar(c, `/v1/tarefas/${id}/concluir`, { em: HOJE }, q)) as unknown as Resposta,
    }
  },
  'POST /v1/tarefas/:id/cancelar': async (q) => {
    const id = await comJornada(q, 'aberta')
    return { id, res: (await postar(c, `/v1/tarefas/${id}/cancelar`, {}, q)) as unknown as Resposta }
  },
  'POST /v1/tarefas/:id/reabrir': async (q) => {
    const id = await comJornada(q, 'concluida')
    return { id, res: (await postar(c, `/v1/tarefas/${id}/reabrir`, {}, q)) as unknown as Resposta }
  },
  'POST /v1/tarefas (criar agendada)': async (q) => {
    const res = (await postar(
      c,
      '/v1/tarefas',
      {
        vinculo: 'paciente',
        pacienteId: c.pacientes['ana'],
        tipo: 'Consulta agendada',
        responsavelId: c.pessoas[q],
        quando: { modo: 'agendada', prazo: HOJE },
      },
      q,
    )) as unknown as Resposta
    return { id: res.body.tarefa?.id ?? '', res }
  },
}

describe('F6 — a resposta da ESCRITA tira a jornada de quem não tem `jornada`', () => {
  for (const [rota, escrever] of Object.entries(ESCRITAS)) {
    it(`${rota}: sem jornada, nada de histórico, dose, procedimentos nem próximo passo`, async () => {
      const { res } = await escrever('semjor')
      expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(300)
      const cartoes = [res.body.tarefa, ...res.body.todas]
      expect(cartoes.length).toBeGreaterThan(0)
      for (const t of cartoes) {
        expect(t.historico, 'historico').toEqual([])
        expect(t.programaOrcado, 'programaOrcado').toBeNull()
        expect(t.itensOrcamento, 'itensOrcamento').toBeNull()
        expect(t.proximoPassoEm, 'proximoPassoEm').toBeNull()
      }
    })

    it(`${rota}: com jornada, o cartão continua inteiro`, async () => {
      const { res, id } = await escrever('comjor')
      expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(300)
      const t = res.body.tarefa
      // Toda escrita deixa AO MENOS o evento que ela mesma gravou, ou o que já havia.
      expect(t.historico.length, 'historico').toBeGreaterThan(0)
      if (rota.startsWith('POST /v1/tarefas (criar')) return
      expect(t.id).toBe(id)
      // Só o PATCH de um orçamento concluído carrega dose e procedimentos.
      if (rota.startsWith('PATCH')) {
        expect(t.programaOrcado, 'programaOrcado').toHaveLength(1)
        expect(t.itensOrcamento, 'itensOrcamento').toHaveLength(1)
      }
      // Reabrir zera o próximo passo (a etapa volta); os demais o preservam.
      if (!rota.includes('reabrir')) expect(t.proximoPassoEm, 'proximoPassoEm').not.toBeNull()
    })
  }
})
