import type { LancamentoDeKpiNaSaida, LancarKpi } from '@fir/contracts'
import {
  diaCivil,
  type FrequenciaDeKpi,
  NumeroDoKpi,
  podeLancar,
  type UnidadeDeKpi,
  validarLancamento,
  valorNaTela,
} from '@fir/domain'
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { type Ator, pessoaDoAtor } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { lerAtorDeAcesso, lerPerfisDoDominio } from '../pessoas/acesso-do-ator'

export type ContextoDoLancamento = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
}

type LinhaDoKpi = {
  id: string
  origem: 'catalogo' | 'manual'
  unidade: UnidadeDeKpi | null
  frequencia: FrequenciaDeKpi
  responsavel_id: string | null
  arquivado: boolean
}

type LinhaDoLancamento = {
  referencia: string
  valor_centavos: string | null
  valor_numero: string | null
  comentario: string
  lancado_em: Date
}

/** O par XOR de `ValorNaTela`, sem meta nem escala (appsec C2): só pelo construtor do domínio. */
function valorDoLancamento(unidade: UnidadeDeKpi, n: NumeroDoKpi): LancamentoDeKpiNaSaida['lancado'] {
  const v = valorNaTela(unidade, n)
  return { emDinheiro: v.emDinheiro, emNumero: v.emNumero }
}

const numeroDaLinha = (unidade: UnidadeDeKpi, l: LinhaDoLancamento): NumeroDoKpi =>
  NumeroDoKpi.de(unidade, BigInt((unidade === 'reais' ? l.valor_centavos : l.valor_numero) ?? '0'))

/**
 * **LANÇAR O VALOR DE UM KPI MANUAL** (spec I-31) — a exceção nomeada da
 * matriz de acesso (appsec C4): a rota não tem `@Exige`, e a decisão é de
 * `podeLancar`, a mesma função do domínio que a tela usa.
 *
 * Tudo numa transação só (appsec C1):
 *  1. o KPI é lido `FOR UPDATE` — e com ele `responsavel_id`, lido AQUI, na
 *     transação que grava: trocar a responsável no meio não deixa a antiga
 *     lançar;
 *  2. a pessoa e os perfis são relidos do banco, não do guard;
 *  3. o lançamento é UPSERT por `(kpi_id, referencia)` — relançar corrige a
 *     mesma linha, e a trilha (`registrar_auditoria`) guarda de → para (C.2);
 *  4. a tarefa aberta da referência é concluída.
 *
 * A resposta é SÓ o lançamento (appsec C2). O comentário e o nome do KPI
 * nunca vão para log nem para mensagem de erro (appsec C29).
 */
@Injectable()
export class LancamentosDeKpiService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async lancar(
    ctx: ContextoDoLancamento,
    kpiId: string,
    referencia: string,
    dados: LancarKpi,
  ): Promise<LancamentoDeKpiNaSaida> {
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDoKpi>(
        `SELECT id, origem, unidade, frequencia, responsavel_id, arquivado_em IS NOT NULL AS arquivado
           FROM kpis WHERE clinica_id = $1 AND id = $2 FOR UPDATE`,
        [ctx.clinicaId, kpiId],
      )
      // De outra clínica, a RLS o esconde (e o filtro também): 404, como "não existe".
      const k = r.rows[0]
      if (k === undefined) throw new NotFoundException('Indicador não encontrado.')

      const ator = await lerAtorDeAcesso(c, ctx.ator)
      const pessoa = pessoaDoAtor(ctx.ator)
      const usuario =
        ator.tipo === 'pessoa' && pessoa !== null
          ? { admin: ator.admin, perfilId: ator.perfilId ?? '', pessoaId: pessoa }
          : null
      const decisao = podeLancar(usuario, await lerPerfisDoDominio(c), {
        origem: k.origem,
        arquivado: k.arquivado,
        responsavelId: k.responsavel_id,
      })
      if (decisao === 'kpi_de_catalogo') {
        throw new UnprocessableEntityException('Este indicador é calculado pelo sistema; não se lança à mão.')
      }
      if (decisao === 'kpi_arquivado') throw new ConflictException('Este indicador foi arquivado.')
      if (decisao !== 'pode' || pessoa === null) throw new ForbiddenException('Sem acesso a esta ação.')

      // `unidade` é NOT NULL no KPI manual (CHECK `kpi_origem_coerente`).
      const unidade = k.unidade!
      const v = validarLancamento({ frequencia: k.frequencia, unidade }, referencia, BigInt(dados.valor), hoje)
      if (v.tipo === 'erro') throw new UnprocessableEntityException(v.erro.mensagem)
      const valor = v.valor.emMenorUnidade.toString()
      const emReais = unidade === 'reais'

      const antes = await c.query<LinhaDoLancamento>(
        `SELECT referencia::text AS referencia, valor_centavos::text AS valor_centavos,
                valor_numero::text AS valor_numero, comentario, lancado_em
           FROM lancamentos_de_kpi WHERE clinica_id = $1 AND kpi_id = $2 AND referencia = $3::date
            FOR UPDATE`,
        [ctx.clinicaId, k.id, referencia],
      )
      const anterior = antes.rows[0]
      const gravado = await c.query<LinhaDoLancamento>(
        `INSERT INTO lancamentos_de_kpi (clinica_id, kpi_id, referencia, valor_centavos, valor_numero,
                                         comentario, lancado_por, lancado_em)
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
         ON CONFLICT (kpi_id, referencia) DO UPDATE
           SET valor_centavos = EXCLUDED.valor_centavos, valor_numero = EXCLUDED.valor_numero,
               comentario = EXCLUDED.comentario, lancado_por = EXCLUDED.lancado_por,
               lancado_em = EXCLUDED.lancado_em
         RETURNING referencia::text AS referencia, valor_centavos::text AS valor_centavos,
                   valor_numero::text AS valor_numero, comentario, lancado_em`,
        [ctx.clinicaId, k.id, referencia, emReais ? valor : null, emReais ? null : valor, dados.comentario, pessoa, agora],
      )
      const l = gravado.rows[0]!

      // A tarefa da referência, se ainda aberta. `executar` registra quem concluiu.
      const t = await c.query<{ id: string }>(
        `UPDATE tarefas
            SET status = 'concluida', concluida_em = $5,
                historico = historico || jsonb_build_array(jsonb_build_object(
                  'acao', 'executar', 'em', $6::text, 'porId', $4::text,
                  'de', CASE WHEN responsavel_id IS NULL THEN NULL
                             ELSE jsonb_build_object('tipo', 'pessoa', 'id', responsavel_id) END,
                  'para', NULL))
          WHERE clinica_id = $1 AND kpi_id = $2 AND kpi_referencia = $3::date
            AND status = 'aberta' AND excluida_em IS NULL
          RETURNING id`,
        [ctx.clinicaId, k.id, referencia, pessoa, agora, agora.toISOString()],
      )

      return {
        kpiId: k.id,
        referencia: l.referencia,
        unidade,
        lancado: valorDoLancamento(unidade, numeroDaLinha(unidade, l)),
        anterior: anterior === undefined ? null : valorDoLancamento(unidade, numeroDaLinha(unidade, anterior)),
        comentario: l.comentario,
        lancadoEm: l.lancado_em.toISOString(),
        tarefaConcluidaId: t.rows[0]?.id ?? null,
      }
    })
  }
}
