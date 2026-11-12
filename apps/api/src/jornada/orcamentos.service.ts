import type { OrcamentosDeUmaPessoa, RespostaDeOrcamentos } from '@fir/contracts'
import type { ConsultaDeOrcamentos } from '@fir/contracts'
import { diaCivil, janela, type Relogio } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { bordasDoPeriodo } from '../tarefas/consulta.service'

/**
 * **ORÇAMENTOS POR ATENDENTE.**
 *
 * "Atendente" é o RESPONSÁVEL pelo atendimento. Três contagens, todas de
 * cartões vivos e no período do funil (janela `[de, ate+1dia)` no fuso da
 * clínica, regras 22 e 23):
 *
 *  * lançados — eventos `registrarOrcamento` com `em` na janela;
 *  * fechados — eventos `fechar` na janela, de cartões que CONTINUAM
 *    fechados (um estorno devolve o cartão e o fechamento deixa de contar),
 *    classificados por `situacaoDoFechamento`: valor fechado menor que o
 *    oferecido é parcial.
 *
 * Só contagem. Nenhum valor sai daqui, e por isso não há redação a fazer.
 */
@Injectable()
export class OrcamentosService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async abrir(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    consulta: ConsultaDeOrcamentos,
  ): Promise<RespostaDeOrcamentos> {
    const hoje = diaCivil(this.relogio.agora(), fuso)
    const bordas = bordasDoPeriodo(consulta, hoje) ?? { de: hoje, ate: hoje }
    const j = janela(bordas.de, bordas.ate, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      // `valor_fechado < valor_orcamento` é a MESMA regra de
      // `situacaoDoFechamento` do domínio, em SQL, porque a contagem precisa
      // agrupar no banco; o teste de e2e cobre as duas pontas.
      const r = await c.query<{
        pessoa: string
        nome: string
        lancados: string
        completos: string
        parciais: string
        sem: string
      }>(
        `SELECT t.responsavel_id::text AS pessoa, p.nome,
                count(*) FILTER (WHERE ev->>'acao' = 'registrarOrcamento')::text AS lancados,
                count(*) FILTER (
                  WHERE ev->>'acao' = 'fechar' AND t.etapa = 'fechado'
                    AND t.valor_fechado IS NOT NULL
                    AND NOT (t.valor_orcamento IS NOT NULL AND t.valor_fechado < t.valor_orcamento)
                )::text AS completos,
                count(*) FILTER (
                  WHERE ev->>'acao' = 'fechar' AND t.etapa = 'fechado'
                    AND t.valor_orcamento IS NOT NULL AND t.valor_fechado < t.valor_orcamento
                )::text AS parciais,
                count(*) FILTER (
                  WHERE ev->>'acao' = 'fechar' AND t.etapa = 'fechado' AND t.valor_fechado IS NULL
                )::text AS sem
           FROM tarefas t
           JOIN pessoas p ON p.id = t.responsavel_id AND p.clinica_id = t.clinica_id
           CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev
          WHERE t.clinica_id = $1
            AND t.excluida_em IS NULL
            AND ev->>'acao' = ANY($2)
            AND (ev->>'em')::timestamptz >= $3
            AND (ev->>'em')::timestamptz <  $4
          GROUP BY t.responsavel_id, p.nome
          ORDER BY p.nome`,
        [clinicaId, ['registrarOrcamento', 'fechar'], j.de, j.ate],
      )
      const itens: OrcamentosDeUmaPessoa[] = r.rows.map((x) => ({
        pessoaId: x.pessoa,
        nome: x.nome,
        lancados: Number(x.lancados),
        fechadosCompletos: Number(x.completos),
        fechadosParciais: Number(x.parciais),
        fechadosSemClassificacao: Number(x.sem),
      }))
      return { de: bordas.de, ate: bordas.ate, itens }
    })
  }
}
