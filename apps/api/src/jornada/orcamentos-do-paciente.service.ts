import type { OrcamentoDoPaciente, RespostaDeOrcamentosDoPaciente } from '@fir/contracts'
import {
  type Etapa,
  type EventoDeJornada,
  type ItemDoOrcamentoLido,
  itensDoOrcamentoDe,
  orcamentoVigente,
  resumoDoOrcamento,
} from '@fir/domain'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **A ABA "ORÇAMENTOS" DA FICHA** — `GET /v1/pacientes/:id/orcamentos`.
 *
 * Derivado, nunca gravado: cada orçamento é uma tarefa da jornada que teve um
 * evento `registrarOrcamento`, e o resumo (situação, restante, procedimentos
 * fechados ou não) é `resumoDoOrcamento`, de `packages/domain` — a mesma regra
 * do selo "Orçamento parcialmente fechado" e da coluna da Jornada.
 *
 * O que NÃO sai daqui, de propósito: dose, responsável, sessões. Procedimento
 * por paciente já é dado sensível de saúde (regra 18) — a rota é
 * `@DadoSensivel('pacientes')` e só entrega o que a aba mostra.
 *
 * O dinheiro sai com os nomes registrados em `CAMPOS_MONETARIOS`
 * (`valorOrcamento`, `valorFechado`, `valorRestante`, `valor` do item): a
 * redação é do interceptor, por nome de chave, e não há `if` de permissão
 * aqui. Sem `valores` sobram a situação, a contagem e o nome dos procedimentos.
 *
 * Fechamento direto, sem orçamento enviado antes (o "Fechou" do balcão), não é
 * orçamento criado e não entra na lista.
 */
@Injectable()
export class OrcamentosDoPacienteService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listar(
    clinicaId: ClinicaId,
    ator: Ator,
    pacienteId: string,
  ): Promise<RespostaDeOrcamentosDoPaciente> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const existe = await c.query('SELECT 1 FROM pacientes WHERE id = $1', [pacienteId])
      if (existe.rowCount !== 1) throw new NotFoundException('Paciente não encontrada.')

      const r = await c.query<{
        id: string
        tipo: string
        prazo: string
        etapa: Etapa
        valor_orcamento: string | null
        valor_fechado: string | null
        itens_orcamento: (ItemDoOrcamentoLido & { sessoes?: number })[] | null
        programa_orcado: (ItemDoOrcamentoLido & { sessoes?: number; intervaloDias?: number })[] | null
        historico: EventoDeJornada[]
        proximo_passo_em: string | null
      }>(
        `SELECT t.id, t.tipo, t.prazo::text AS prazo, t.etapa::text AS etapa,
                t.valor_orcamento::text AS valor_orcamento, t.valor_fechado::text AS valor_fechado,
                t.itens_orcamento, t.programa_orcado, t.historico,
                t.proximo_passo_em::text AS proximo_passo_em
           FROM tarefas t
          WHERE t.clinica_id = $1 AND t.paciente_id = $2 AND t.excluida_em IS NULL
            AND t.etapa IN ('orcamento', 'fechado', 'perdido')
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.historico) ev
                         WHERE ev->>'acao' = 'registrarOrcamento')`,
        [clinicaId, pacienteId],
      )

      // Os nomes: do catálogo da clínica (a RLS filtra), inclusive o desativado.
      const ids = [
        ...new Set(
          r.rows.flatMap((l) =>
            (itensDoOrcamentoDe(l.itens_orcamento, l.programa_orcado) ?? []).map(
              (i) => i.procedimentoId,
            ),
          ),
        ),
      ]
      const nomes = new Map<string, string>()
      if (ids.length > 0) {
        const n = await c.query<{ id: string; nome: string }>(
          'SELECT id, nome FROM procedimentos WHERE id = ANY($1)',
          [ids],
        )
        for (const l of n.rows) nomes.set(l.id, l.nome)
      }

      const itens: OrcamentoDoPaciente[] = []
      for (const l of r.rows) {
        const resumo = resumoDoOrcamento({
          etapa: l.etapa,
          valorOrcamento: l.valor_orcamento === null ? null : BigInt(l.valor_orcamento),
          valorFechado: l.valor_fechado === null ? null : BigInt(l.valor_fechado),
          itens: itensDoOrcamentoDe(l.itens_orcamento, l.programa_orcado),
          historico: l.historico,
        })
        if (resumo === null) continue
        // Sessões e intervalo moram em `programa_orcado`, na mesma ordem que
        // `itensDoOrcamentoDe` numera (`i1`, `i2`…). Só o modo lista tem
        // `itens_orcamento`, e ele não tem sessões.
        const doPrograma = new Map<string, { sessoes?: number; intervaloDias?: number }>([
          ...(l.itens_orcamento ?? []).map((p) => [p.chave, p] as const),
          ...(l.programa_orcado ?? []).map((p, n) => [p.chave ?? `i${n + 1}`, p] as const),
        ])
        const registrado = l.historico.find((e) => e.acao === 'registrarOrcamento')
        itens.push({
          tarefaId: l.id,
          tipoDoAtendimento: l.tipo,
          atendimentoEm: l.prazo,
          registradoEm: registrado?.em ?? '',
          situacao: resumo.situacao,
          valorOrcamento: l.valor_orcamento,
          valorFechado: l.valor_fechado,
          valorRestante: resumo.valorRestante === null ? null : resumo.valorRestante.toString(),
          itens: resumo.itens.map((i) => ({
            ...(sessoesDe(doPrograma.get(i.chave))),
            ...(i.sessoesFechadas === undefined ? {} : { sessoesFechadas: i.sessoesFechadas }),
            chave: i.chave,
            procedimentoId: i.procedimentoId,
            procedimento: nomes.get(i.procedimentoId) ?? 'Procedimento',
            ...(i.valor === undefined || i.valor === null ? {} : { valor: i.valor }),
            situacao: i.situacao,
          })),
          itensFechados: resumo.itensFechados,
          itensTotal: resumo.itens.length,
          retomarRestanteEm: resumo.situacao === 'parcial' ? l.proximo_passo_em : null,
          notaDoOrcamento: orcamentoVigente(l.historico)?.nota ?? null,
          notaDoFechamento:
            l.etapa === 'fechado'
              ? ([...l.historico].reverse().find((e) => e.acao === 'fechar')?.nota ?? null)
              : null,
        })
      }
      itens.sort((a, b) =>
        a.registradoEm < b.registradoEm ? 1 : a.registradoEm > b.registradoEm ? -1 : 0,
      )

      const conta = (s: OrcamentoDoPaciente['situacao']): number =>
        itens.filter((i) => i.situacao === s).length
      return {
        totais: {
          orcamentos: itens.length,
          abertos: conta('aberto'),
          fechados: conta('fechado'),
          parciais: conta('parcial'),
          perdidos: conta('perdido'),
        },
        itens,
      }
    })
  }
}

/** Só o que a aba pode mostrar: quantas sessões e a cada quantos dias. Nunca a dose. */
function sessoesDe(p: { sessoes?: number; intervaloDias?: number } | undefined): {
  sessoes?: number
  intervaloDias?: number
} {
  if (p === undefined || typeof p.sessoes !== 'number') return {}
  return {
    sessoes: p.sessoes,
    ...(typeof p.intervaloDias === 'number' && p.intervaloDias > 0
      ? { intervaloDias: p.intervaloDias }
      : {}),
  }
}
