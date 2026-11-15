import {
  LIMITE_DO_CONSUMO,
  type LinhaDeConsumo,
  type RespostaDoConsumo,
} from '@fir/contracts'
import { Quantidade, deMedidaParaExibicao, ehOk, podeEditar } from '@fir/domain'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import type { LeitorDaRequisicao } from '../tarefas/leitura'
import { quantidadeNaSaida } from './movimentos.repositorio'

type Linha = {
  id: string
  dia: string
  item_nome: string
  medida: string
  unid_compra: string | null
  fator_compra: string | null
  unid_uso: string | null
  fator_uso: string | null
  aproveita_sobra: boolean
  milesimos: string
  lote: string | null
  quem: string | null
  item_chave: string | null
  tarefa_id: string | null
  compensa_id: string | null
  estornado: boolean
  t_solicitante: string | null
  t_responsavel: string | null
  t_status: 'aberta' | 'concluida' | 'cancelada' | null
}

/**
 * **A ABA "CONSUMO" DA FICHA** — o que foi aplicado em UM paciente.
 *
 * Dado pessoal sensível de saúde (regra 18): a rota é `@DadoSensivel('pacientes')`
 * e o que sai daqui é só o que a aba mostra.
 *
 * O QUE ENTRA: os movimentos com `paciente_id` deste paciente (o consumo da
 * dose) e as COMPENSAÇÕES deles. A compensação não carrega `paciente_id` (o
 * `desfazer` a monta da origem sem copiá-lo), então ela entra pela ORIGEM
 * (`compensa_id`): nunca por um filtro que pudesse alcançar outro paciente.
 * O descarte da sobra de frasco NÃO entra — não foi aplicado em ninguém
 * (`baixa-relacional.ts`).
 *
 * O QUE NÃO SAI: custo (a consulta nem o lê), outro paciente, "outros do lote",
 * e `tarefaId` de quem não enxerga a tarefa — a regra é a de `podeEditar`, a
 * mesma de `GET /v1/tarefas/:id`, e não uma segunda regra de visibilidade.
 *
 * Paginado com limite FIXO no servidor.
 */
@Injectable()
export class ConsumoDoPacienteService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listar(
    clinicaId: ClinicaId,
    ator: Ator,
    leitor: LeitorDaRequisicao,
    pacienteId: string,
    pagina: number,
  ): Promise<RespostaDoConsumo> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      // 404 para paciente inexistente OU de outra clínica: a RLS a esconde, e a
      // resposta é a mesma — não confirma que o id existe em outra clínica.
      const existe = await c.query('SELECT 1 FROM pacientes WHERE id = $1', [pacienteId])
      if (existe.rowCount !== 1) throw new NotFoundException('Paciente não encontrada.')

      const r = await c.query<Linha>(
        `SELECT m.id, to_char(m.dia, 'YYYY-MM-DD') AS dia, i.nome AS item_nome, i.medida,
                i.unid_compra, i.fator_compra::text AS fator_compra,
                i.unid_uso, i.fator_uso::text AS fator_uso, i.aproveita_sobra,
                m.milesimos::text AS milesimos, to_char(m.lote, 'YYYY-MM-DD') AS lote,
                p.nome AS quem, m.item_chave, m.tarefa_id, m.compensa_id,
                EXISTS (SELECT 1 FROM movimentos_de_estoque x
                         WHERE x.compensa_id = m.id) AS estornado,
                t.solicitante_id AS t_solicitante, t.responsavel_id AS t_responsavel,
                t.status AS t_status
           FROM movimentos_de_estoque m
           JOIN itens_de_estoque i ON i.id = m.item_id
           LEFT JOIN pessoas p ON p.id = coalesce(m.aplicado_por_id, m.criado_por)
           LEFT JOIN tarefas t ON t.id = m.tarefa_id AND t.excluida_em IS NULL
          WHERE (m.paciente_id = $1 AND m.compensa_id IS NULL AND m.tipo = 'consumo')
             OR m.compensa_id IN (SELECT o.id FROM movimentos_de_estoque o
                                   WHERE o.paciente_id = $1 AND o.compensa_id IS NULL)
          ORDER BY m.dia DESC, m.em DESC, m.sequencia DESC
          LIMIT $2 OFFSET $3`,
        [pacienteId, LIMITE_DO_CONSUMO + 1, (pagina - 1) * LIMITE_DO_CONSUMO],
      )

      const temMais = r.rows.length > LIMITE_DO_CONSUMO
      const itens = r.rows.slice(0, LIMITE_DO_CONSUMO).map((l): LinhaDeConsumo => {
        const bruto = BigInt(l.milesimos)
        // A saída é sempre em módulo: o sinal é do movimento, e o que a tela
        // mostra é "quanto", com a marca de estorno ao lado.
        const q = Quantidade.deMilesimos(bruto < 0n ? -bruto : bruto, l.medida)
        const emUso =
          l.unid_uso === null
            ? null
            : deMedidaParaExibicao(
                q,
                {
                  medida: l.medida,
                  unidCompra: l.unid_compra,
                  fatorCompra: l.fator_compra === null ? null : BigInt(l.fator_compra),
                  unidUso: l.unid_uso,
                  fatorUso: l.fator_uso === null ? null : BigInt(l.fator_uso),
                  aproveitaSobra: l.aproveita_sobra,
                },
                'uso',
              )
        const veTarefa =
          l.tarefa_id !== null &&
          l.t_status !== null &&
          l.t_solicitante !== null &&
          l.t_responsavel !== null &&
          ehOk(
            podeEditar(
              {
                solicitanteId: l.t_solicitante,
                responsavelId: l.t_responsavel,
                status: l.t_status,
              },
              leitor,
            ),
          )
        return {
          id: l.id,
          dia: l.dia,
          item: l.item_nome,
          quantidade: quantidadeNaSaida(q),
          quantidadeEmUso: emUso !== null && ehOk(emUso) ? quantidadeNaSaida(emUso.valor) : null,
          lote: l.lote,
          quem: l.quem,
          origem: l.item_chave === null ? 'atendimento' : 'sessao',
          tarefaId: veTarefa ? l.tarefa_id : null,
          estorno: l.compensa_id !== null,
          estornaId: l.compensa_id,
          estornado: l.estornado,
        }
      })

      // O LÍQUIDO: consumo (negativo) + estorno (positivo) = −soma. Sobre o
      // histórico inteiro, no servidor, para a tela não somar errado.
      const liq = await c.query<{ item_nome: string; medida: string; soma: string }>(
        `SELECT i.nome AS item_nome, i.medida, sum(m.milesimos)::text AS soma
           FROM movimentos_de_estoque m
           JOIN itens_de_estoque i ON i.id = m.item_id
          WHERE (m.paciente_id = $1 AND m.compensa_id IS NULL AND m.tipo = 'consumo')
             OR m.compensa_id IN (SELECT o.id FROM movimentos_de_estoque o
                                   WHERE o.paciente_id = $1 AND o.compensa_id IS NULL)
          GROUP BY i.id, i.nome, i.medida
          ORDER BY i.nome`,
        [pacienteId],
      )
      const liquidoPorItem = liq.rows.map((x) => ({
        item: x.item_nome,
        quantidade: quantidadeNaSaida(Quantidade.deMilesimos(-BigInt(x.soma), x.medida)),
      }))

      return { itens, liquidoPorItem, pagina, limite: LIMITE_DO_CONSUMO, temMais }
    })
  }
}
