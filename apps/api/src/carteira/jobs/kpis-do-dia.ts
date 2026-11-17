import type { KpiNaLista } from '@fir/contracts'
import { type ChaveDePermissao, type ChaveDoCatalogo, permissaoDoValor, type Relogio } from '@fir/domain'
import { SISTEMA } from '../../banco/ator'
import type { BancoService } from '../../banco/banco.service'
import type { ClinicaId } from '../../banco/clinica-id'
import { CampanhasService } from '../../campanhas/campanhas.service'
import { VisaoDoMesService } from '../../financeiro/visao-do-mes.service'
import { FontesDosKpis } from '../../indicadores/fontes'
import { IndicadoresService } from '../../indicadores/indicadores.service'
import { MetasService } from '../../pessoas/metas.service'

/**
 * **T10 — os KPIs da clínica, fotografados para a carteira** (`kpis_na_carteira`,
 * spec I-47, appsec C5/C26/C28, LGPD L-IN-18, emenda da ADR 0013).
 *
 * O número vem da MESMA calculadora da tela Indicadores
 * (`IndicadoresService.listar`), montada aqui sem Nest — os serviços dela só
 * dependem de banco e relógio. Nenhuma conta paralela.
 *
 * **Quem o job finge ser.** `listar` decide o que sai por `ctx.pode`, e o job
 * responde só `valores`: os reais são gravados, e a redação é na LEITURA, pelo
 * espaço `carteira` do `RedacaoInterceptor`. `pessoas.gerir` é negada, então os
 * três KPIs de RH não saem da calculadora (C5, o ponto único `kpisVisiveis`).
 * A tabela tem um CHECK que os recusa, por garantia.
 *
 * **Dentro da clínica.** `listar` abre `banco.naClinica` como `fir_app` (C26);
 * a RLS de `clinica_id` isola, e o SQL da calculadora também filtra.
 */
export type KpiParaACarteira = {
  readonly kpiRef: string
  readonly chave: ChaveDoCatalogo | null
  readonly nome: string
  readonly pilar: KpiNaLista['pilar']
  readonly unidade: KpiNaLista['unidade']
  readonly valor: string | null
  readonly alvo: string | null
  readonly prazo: string | null
  readonly situacao: string | null
  readonly percentualDaMeta: number | null
}

/** A permissão que o job tem: só `valores`. Nunca `pessoas.gerir` (C5). */
const PODE_DO_JOB = (chave: ChaveDePermissao): boolean => chave === 'valores'

/**
 * Onde só a situação e o percentual atravessam: o pilar Pessoas (L-IN-18:
 * numa clínica de duas fichas, "a equipe" é uma pessoa) e o resultado de
 * campanha (ADR 0013 §4: receita de campanha pequena é a de um paciente).
 */
export const semValorNaCarteira = (k: Pick<KpiParaACarteira, 'pilar' | 'chave'>): boolean =>
  k.pilar === 'Pessoas' || k.chave === 'resultado_de_campanha'

/** Um KPI cuja `permissaoDoValor` é `pessoas.gerir` nunca atravessa, nem que a calculadora mude. */
const ehDeRh = (chave: ChaveDoCatalogo | null): boolean => permissaoDoValor(chave) === 'pessoas.gerir'

const emTexto = (v: { emDinheiro: string | null; emNumero: string | null } | null | undefined): string | null =>
  v === null || v === undefined ? null : (v.emDinheiro ?? v.emNumero)

export function calculadoraDoJob(banco: BancoService, relogio: Relogio): IndicadoresService {
  const visao = new VisaoDoMesService(banco, relogio)
  const fontes = new FontesDosKpis(visao, new MetasService(banco, relogio), new CampanhasService(banco, relogio))
  return new IndicadoresService(banco, relogio, fontes, visao)
}

/** Os KPIs vivos da clínica, como a carteira os recebe. `hoje` é o dia da clínica no instante. */
export async function kpisParaACarteira(
  calculadora: IndicadoresService,
  clinicaId: ClinicaId,
  fuso: string,
): Promise<{ hoje: string; kpis: KpiParaACarteira[] }> {
  const lista = await calculadora.listar({ clinicaId, ator: SISTEMA, fuso, pode: PODE_DO_JOB }, {})
  const kpis: KpiParaACarteira[] = []
  for (const k of lista.itens) {
    if (ehDeRh(k.chave)) continue
    const meta = k.metaVigente
    const base = { pilar: k.pilar, chave: k.chave }
    const semValor = semValorNaCarteira(base)
    kpis.push({
      kpiRef: k.id,
      chave: k.chave,
      nome: k.nome,
      pilar: k.pilar,
      unidade: k.unidade,
      valor: semValor ? null : emTexto(k.atual),
      alvo: semValor || meta === null ? null : emTexto(meta.alvo),
      prazo: meta?.prazo ?? null,
      situacao: meta?.situacao ?? null,
      percentualDaMeta: meta?.atual.percentualDaMeta ?? null,
    })
  }
  return { hoje: lista.hoje, kpis }
}

/**
 * Grava a fotografia do dia, por UPSERT na chave `(cliente, kpi, dia)` — rodar
 * três vezes escreve a mesma linha (regra 26). O `INSERT … SELECT … WHERE
 * EXISTS` é a segunda trava do vínculo: sem participação ativa da clínica no
 * grupo do cliente, nenhuma linha nasce, mesmo que o filtro do job falhe.
 * Devolve quantas linhas foram escritas.
 */
export async function gravarKpisNaCarteira(
  banco: BancoService,
  cliente: { readonly id: string; readonly clinica_id: string; readonly grupo_id: string },
  hoje: string,
  kpis: readonly KpiParaACarteira[],
): Promise<number> {
  if (kpis.length === 0) return 0
  return banco.nasTabelasDaCarteiraComEscopo('geral', null, async (c) => {
    let gravadas = 0
    for (const k of kpis) {
      const reais = k.unidade === 'reais'
      const r = await c.query(
        `INSERT INTO kpis_na_carteira (
           cliente_carteira_id, grupo_id, kpi_ref, dia, chave_catalogo, nome, pilar, unidade,
           valor_centavos, valor_numero, alvo_centavos, alvo_numero, prazo, situacao, percentual_da_meta)
         SELECT $1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14, $15
          WHERE EXISTS (SELECT 1 FROM participacao_clinica_grupo p
                         WHERE p.clinica_id = $16 AND p.grupo_id = $2 AND p.ate IS NULL)
         ON CONFLICT (cliente_carteira_id, kpi_ref, dia) DO UPDATE SET
           chave_catalogo     = EXCLUDED.chave_catalogo,
           nome               = EXCLUDED.nome,
           pilar              = EXCLUDED.pilar,
           unidade            = EXCLUDED.unidade,
           valor_centavos     = EXCLUDED.valor_centavos,
           valor_numero       = EXCLUDED.valor_numero,
           alvo_centavos      = EXCLUDED.alvo_centavos,
           alvo_numero        = EXCLUDED.alvo_numero,
           prazo              = EXCLUDED.prazo,
           situacao           = EXCLUDED.situacao,
           percentual_da_meta = EXCLUDED.percentual_da_meta,
           atualizado_em      = now()`,
        [
          cliente.id,
          cliente.grupo_id,
          k.kpiRef,
          hoje,
          k.chave,
          k.nome,
          k.pilar,
          k.unidade,
          reais ? k.valor : null,
          reais ? null : k.valor,
          reais ? k.alvo : null,
          reais ? null : k.alvo,
          k.prazo,
          k.situacao,
          k.percentualDaMeta,
          cliente.clinica_id,
        ],
      )
      gravadas += r.rowCount ?? 0
    }
    return gravadas
  })
}
