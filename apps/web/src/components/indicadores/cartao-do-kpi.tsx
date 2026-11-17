'use client'

import type { KpiNaLista, MetaDeKpiNaSaida, SerieDoKpi } from '@fir/contracts'
import { Dica } from '@/components/dica'
import { Faisca } from '@/components/graficos/faisca'
import { larguraDaBarra } from '@/lib/financeiro'
import {
  avisoDeUnidade,
  dicaDoKpi,
  faixaDeLancamento,
  fonteDoKpi,
  numeroDoCartao,
  rotuloDaComparacao,
  situacaoDoCartao,
  textoDaMeta,
  textoDaVariacao,
  textoDoSelo,
  TOM_DA_SITUACAO,
  type Tom,
} from './na-tela'

/**
 * **C.1 — o cartão do KPI**, igual nas duas faixas.
 *
 * Nome e selo em cima; o valor grande (serifa, tabular) com "de R$ 120.000"
 * ao lado; a barra da meta com o traço do ritmo esperado; o minigráfico; e o
 * rodapé com a variação e a fonte. O cartão inteiro abre o detalhe.
 *
 * **Sem `valores`** o servidor apagou `emDinheiro`: o número grande vira o
 * percentual da meta que ele deixou ("78% da meta"), a frase "de R$…" some
 * porque o alvo não veio, e nada disso é um `if` de permissão aqui — é o que
 * os `null` da resposta desenham.
 *
 * **KPI manual com lançamento atrasado** (C.1): faixa amarela no topo,
 * "Lançamento da semana pendente", com "Lançar agora" só para a responsável e
 * para quem gerencia (`aoLancarAgora` nulo para os outros). Quem diz que está
 * pendente é o servidor (`lancamentoPendente`).
 */
export function CartaoDoKpi({
  kpi,
  meta,
  atual,
  serie,
  acoes,
  fuso,
  aoLancarAgora = null,
}: {
  kpi: KpiNaLista
  /** A meta mostrada: a vigente do KPI, ou a do resultado-chave dentro do OKR. */
  meta: MetaDeKpiNaSaida | null
  /** O número grande. Dentro do OKR é o medido pela meta do KR. */
  atual: KpiNaLista['atual']
  serie: SerieDoKpi | null
  acoes: readonly { rotulo: string; aoTocar: () => void }[]
  /** O fuso da clínica, para o dia do selo "lançado por … em dd/mm" (regra 22). */
  fuso: string
  /** "Lançar agora" na faixa de pendente; `null` para quem não lança este KPI. */
  aoLancarAgora?: (() => void) | null
}) {
  const pendente = faixaDeLancamento(kpi)
  const situacao = situacaoDoCartao(meta)
  const numero = numeroDoCartao(atual)
  const deMeta = textoDaMeta(meta)
  const variacao = textoDaVariacao(kpi.variacao, kpi.direcao)
  const dica = dicaDoKpi(kpi.chave)
  const nome = (
    <a className="ii-kpi-nome" href={`/indicadores/${kpi.id}`}>
      {kpi.nome}
    </a>
  )

  return (
    <article className="ii-kpi" aria-label={kpi.nome} data-pendente={pendente === null ? undefined : 'sim'}>
      {pendente === null ? null : (
        <div className="ii-kpi-pendente ii-acima">
          <span>{pendente}</span>
          {aoLancarAgora === null ? null : (
            <button type="button" className="link" onClick={aoLancarAgora}>
              Lançar agora
            </button>
          )}
        </div>
      )}
      <div className="ii-kpi-cabeca">
        {dica === null ? (
          nome
        ) : (
          <Dica rotulo={`Como é calculado: ${kpi.nome}`} titulo={nome}>
            <p>{dica}</p>
          </Dica>
        )}
        <Selo tom={TOM_DA_SITUACAO[situacao]} texto={textoDoSelo(situacao, meta === null ? kpi.inicioDaProximaMeta : null)} />
      </div>

      <div className="ii-kpi-valor">
        <strong className={numero.soPercentual ? 'ii-so-percentual' : undefined}>{numero.texto}</strong>
        {deMeta === null ? null : <span>{deMeta}</span>}
      </div>
      {avisoDeUnidade(kpi) === null ? null : <span className="ii-fonte">{avisoDeUnidade(kpi)}</span>}

      {meta === null ? null : (
        <div
          className="ii-barra"
          role="img"
          aria-label={
            meta.atual.percentualDaMeta === null
              ? 'Meta sem medição ainda'
              : `${meta.atual.percentualDaMeta}% da meta${meta.ritmo.percentualDaMeta === null ? '' : `; o ritmo esperado para hoje é ${meta.ritmo.percentualDaMeta}%`}`
          }
        >
          <span style={{ width: larguraDaBarra(meta.atual.percentualDaMeta) }} />
          {meta.ritmo.percentualDaMeta === null ? null : <i style={{ left: larguraDaBarra(meta.ritmo.percentualDaMeta) }} />}
        </div>
      )}

      <Minigrafico serie={serie} tom={TOM_DA_SITUACAO[situacao]} />

      <div className="ii-kpi-rodape">
        <span className={variacao === null ? 'ii-tom-neutro' : `ii-tom-${variacao.tom}`}>
          {variacao === null
            ? kpi.chave === 'resultado_do_mes'
              ? 'comparação no fim do mês'
              : 'sem comparação'
            : `${variacao.texto} ${rotuloDaComparacao(kpi)}`}
        </span>
        <span className="ii-fonte">{fonteDoKpi(kpi, fuso)}</span>
      </div>

      {acoes.length === 0 ? null : (
        <div className="ii-kpi-acoes ii-acima">
          {acoes.map((a) => (
            <button key={a.rotulo} type="button" className="link" onClick={a.aoTocar}>
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

export function Selo({ tom, texto }: { tom: Tom; texto: string }) {
  return <span className={`ii-selo ii-tom-${tom}`}>{texto}</span>
}

/**
 * O minigráfico (6 meses no KPI mensal). A geometria sai dos inteiros que o
 * servidor mandou, em `bigint`; quando a redação apagou o valor em reais, sai
 * da `escala` relativa à própria série (appsec C10), se ela veio. Sem nenhum
 * dos dois, o espaço fica reservado e vazio — a altura do cartão não pula.
 * Ponto de dia aguardando fechamento não entra (números c.10).
 */
function Minigrafico({ serie, tom }: { serie: SerieDoKpi | null; tom: Tom }) {
  const desenho = serieParaDesenho(serie)
  if (desenho === null) return <div className="ii-faisca-vazia" aria-hidden="true" />
  return <Faisca valores={desenho} meta={null} tom={tom === 'ok' ? 'bom' : tom === 'mau' ? 'mau' : 'neutro'} />
}

export function serieParaDesenho(serie: SerieDoKpi | null): bigint[] | null {
  const pontos = (serie?.pontos ?? []).filter((p) => !p.diaAguardando)
  if (pontos.length < 2) return null
  const porValor: bigint[] = []
  const porEscala: bigint[] = []
  let temValor = true
  let temEscala = true
  for (const p of pontos) {
    const t = p.numero.unidade === 'reais' ? p.numero.emDinheiro : p.numero.emNumero
    if (t === null) temValor = false
    else porValor.push(BigInt(t))
    const e = p.numero.escala
    if (e === null || !Number.isInteger(e)) temEscala = false
    else porEscala.push(BigInt(e))
  }
  return temValor ? porValor : temEscala ? porEscala : null
}
