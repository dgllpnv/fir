'use client'

import type { KpiNaLista, ListaDaEquipe, ListaDeKpis, ListaDeOkrs, ListaDeUnidades, OkrNaSaida, SerieDoKpi } from '@fir/contracts'
import { type PilarDeKpi, PILARES_DE_KPI, progressoDoOkr, somarMeses } from '@fir/domain'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Carregando, Erro, Toast, Vazio } from '@/components/estados'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { CartaoDoKpi } from './cartao-do-kpi'
import { CartaoDoOkr } from './cartao-do-okr'
import { FormularioDeKpi } from './formulario-de-kpi'
import { FormularioDeMeta } from './formulario-de-meta'
import { FormularioDeOkr } from './formulario-de-okr'
import { JanelaDeLancamento } from './janela-de-lancamento'
import { MenuSuspenso } from './menu-suspenso'
import {
  agruparPorPilar,
  type AlvoDoLancamento,
  alvoDoKpi,
  emAtencao,
  faixaDeLancamento,
  okrNoPeriodo,
  ordenarPorSituacao,
  situacaoDoCartao,
  trimestresAte,
  unidadesDoFiltro,
} from './na-tela'

type Aberto =
  | { readonly tipo: 'kpi' }
  | { readonly tipo: 'okr'; readonly okr: OkrNaSaida | null }
  | { readonly tipo: 'meta'; readonly kpi: KpiNaLista | null }
  | { readonly tipo: 'lancar'; readonly alvo: AlvoDoLancamento }
  | null

type Pergunta = { readonly titulo: string; readonly texto: string; readonly rotulo: string; readonly acao: () => Promise<void> }

/**
 * **Gestão › Indicadores & Insights — a aba "OKRs e KPIs"** (backlog 1.9 B–D).
 *
 * Topo (sobrescrito, título, "Modo reunião" e "+ Novo"), as abas, os filtros
 * em uma linha (recolhidos num botão no celular) e as duas faixas:
 * "Prioridades do trimestre" (os OKRs, do menor progresso para o maior, como
 * o servidor os ordena) e "Saúde da clínica" (os KPIs fora de OKR, por pilar,
 * do vermelho para o verde).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA TELA NÃO CALCULA NADA QUE O SERVIDOR CALCULA
 *
 * Valor, meta, ritmo, situação, progresso, projeção e variação chegam prontos.
 * O único número feito aqui é a média do resumo da faixa de OKRs, e ele sai
 * da MESMA função do domínio que o servidor usa no progresso de cada OKR
 * (`progressoDoOkr`, média meio-para-cima dos exibidos, números c.12) — e
 * contar cartões ("12 indicadores · 2 em atenção") é contar, não calcular.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Os botões de gestão ("+ Novo", "Editar OKR", "Definir meta") aparecem para
 * quem tem `indicadores.gerir` — conveniência: o servidor recusa do mesmo
 * jeito. Nenhum `if` aqui toca dinheiro: sem `valores`, o servidor já apagou
 * `emDinheiro`, e o cartão desenha o percentual que sobrou.
 */
export function TelaIndicadores({
  podeGerir,
  minhaPessoaId,
  fuso,
}: {
  podeGerir: boolean
  minhaPessoaId: string
  /** O fuso da clínica (da sessão), para o dia do selo "lançado por … em dd/mm". */
  fuso: string
}) {
  const [trimestre, setTrimestre] = useState('')
  const [pilar, setPilar] = useState<PilarDeKpi | ''>('')
  const [responsavel, setResponsavel] = useState('')
  const [unidade, setUnidade] = useState('')
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [aberto, setAberto] = useState<Aberto>(null)
  const [kpiPorCima, setKpiPorCima] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)
  const [pergunta, setPergunta] = useState<Pergunta | null>(null)
  const [respondendo, setRespondendo] = useState(false)

  const okrs = useDados<ListaDeOkrs>('v1/indicadores/okrs')
  const hojeDoServidor = okrs.dados?.hoje ?? null
  const trimestres = useMemo(() => (hojeDoServidor === null ? [] : trimestresAte(hojeDoServidor)), [hojeDoServidor])
  const atual = trimestres[0] ?? null
  const escolhido = trimestres.find((t) => t.inicio === trimestre) ?? atual
  // O trimestre corrente não manda janela: o cartão mostra o período corrente
  // da frequência (o mês, a semana), que é o que a 1.9 compara. Um trimestre
  // passado manda as duas bordas, e o servidor mede a janela inteira.
  const passado = escolhido !== null && atual !== null && escolhido.inicio !== atual.inicio
  const kpis = useDados<ListaDeKpis>(
    hojeDoServidor === null
      ? null
      : `v1/indicadores${consultaEmTexto({
          de: passado ? escolhido.inicio : undefined,
          ate: passado ? escolhido.fim : undefined,
          pilar: pilar === '' ? undefined : pilar,
          responsavel: responsavel === '' ? undefined : responsavel,
          // O filtro Unidade é MEDIDO no servidor (só o KPI `porUnidade` se divide).
          unidade: unidade === '' ? undefined : unidade,
        })}`,
  )
  const unidadesDaClinica = useDados<ListaDeUnidades>('v1/unidades')
  const unidades = useMemo(() => unidadesDoFiltro(unidadesDaClinica.dados?.unidades), [unidadesDaClinica.dados])
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const pessoas = equipe.dados?.equipe ?? []
  const nomeDe = useCallback((id: string | null) => (id === null ? null : (pessoas.find((p) => p.id === id)?.nome ?? null)), [pessoas])

  const series = useSeries(kpis.dados)
  const listaDeKpis = useMemo(() => kpis.dados?.itens ?? [], [kpis.dados])
  const kpisPorId = useMemo(() => new Map(listaDeKpis.map((k) => [k.id, k])), [listaDeKpis])

  const recarregarOkrs = okrs.recarregar
  const recarregarKpis = kpis.recarregar
  const recarregarTudo = useCallback(() => {
    recarregarOkrs()
    recarregarKpis()
  }, [recarregarOkrs, recarregarKpis])

  const fechar = useCallback(() => {
    setAberto(null)
    setKpiPorCima(false)
  }, [])
  const salvo = useCallback(
    (r: string) => {
      setAberto(null)
      setKpiPorCima(false)
      setRecado(r)
      recarregarTudo()
    },
    [recarregarTudo],
  )
  const fecharKpiPorCima = useCallback(() => setKpiPorCima(false), [])
  const kpiCriadoPorCima = useCallback(
    (r: string) => {
      setKpiPorCima(false)
      setRecado(r)
      recarregarKpis()
    },
    [recarregarKpis],
  )
  const fecharPergunta = useCallback(() => setPergunta(null), [])

  // Quem lança: a responsável e quem gerencia (`podeLancar`, T3). Conveniência:
  // o servidor decide do mesmo jeito.
  const lancarDoKpi = useCallback(
    (k: KpiNaLista): (() => void) | null =>
      k.origem === 'manual' && (podeGerir || (minhaPessoaId !== '' && k.responsavelId === minhaPessoaId))
        ? () => setAberto({ tipo: 'lancar', alvo: alvoDoKpi(k) })
        : null,
    [podeGerir, minhaPessoaId],
  )

  const acoesDoKpi = useCallback(
    (k: KpiNaLista, noOkr: boolean) => {
      const acoes: { rotulo: string; aoTocar: () => void }[] = []
      const lancar = lancarDoKpi(k)
      // Com a faixa de pendente, o "Lançar agora" dela é o botão: dois iguais confundem.
      if (lancar !== null && faixaDeLancamento(k) === null) {
        acoes.push({ rotulo: 'Lançar valor', aoTocar: lancar })
      }
      if (podeGerir && !noOkr) {
        acoes.push({
          rotulo: k.metaVigente === null ? 'Definir meta' : 'Editar meta',
          aoTocar: () => setAberto({ tipo: 'meta', kpi: k }),
        })
      }
      return acoes
    },
    [podeGerir, lancarDoKpi],
  )

  const acaoDoOkr = (okr: OkrNaSaida, tipo: 'encerrar' | 'duplicar' | 'arquivar') => {
    const textos = {
      encerrar: { titulo: 'Encerrar este OKR?', texto: `"${okr.objetivo}" deixa de ser acompanhado e não se edita mais. Dá para duplicá-lo depois.`, rotulo: 'Encerrar', recado: 'OKR encerrado.' },
      duplicar: { titulo: 'Duplicar para o próximo trimestre?', texto: `"${okr.objetivo}" ganha uma cópia no próximo período, com os mesmos indicadores e alvos. A partida é medida de novo.`, rotulo: 'Duplicar', recado: 'OKR duplicado para o próximo período.' },
      arquivar: { titulo: 'Excluir este OKR?', texto: `"${okr.objetivo}" sai da tela. Os indicadores continuam, e voltam para "Saúde da clínica".`, rotulo: 'Excluir', recado: 'OKR excluído.' },
    }[tipo]
    setPergunta({
      titulo: textos.titulo,
      texto: textos.texto,
      rotulo: textos.rotulo,
      acao: async () => {
        await chamar(`v1/indicadores/okrs/${okr.id}/${tipo}`, { method: 'POST', body: JSON.stringify({}) })
        setRecado(textos.recado)
        recarregarTudo()
      },
    })
  }

  const responder = async () => {
    if (pergunta === null) return
    setRespondendo(true)
    try {
      await pergunta.acao()
      setPergunta(null)
    } catch (x) {
      setPergunta(null)
      setRecado(x instanceof ErroDaApi ? x.message : 'Não consegui completar a ação. Confira a conexão.')
    } finally {
      setRespondendo(false)
    }
  }

  // ---- faixa 1
  const okrsDoPeriodo = (okrs.dados?.itens ?? []).filter(
    (o) => (escolhido === null || okrNoPeriodo(o, escolhido)) && (responsavel === '' || o.responsavelId === responsavel),
  )
  const media = progressoDoOkr(okrsDoPeriodo.map((o) => o.progresso))
  const okrsAtivos = (okrs.dados?.itens ?? []).filter((o) => o.estado === 'ativo')

  // ---- faixa 2
  const saude = listaDeKpis.filter((k) => k.okrIds.length === 0)
  const emAtencaoNaSaude = saude.filter((k) => emAtencao(situacaoDoCartao(k.metaVigente))).length
  const grupos = agruparPorPilar(ordenarPorSituacao(saude))

  const hoje = hojeDoServidor ?? ''

  return (
    <section>
      <div className="ii-topo">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Gestão</div>
          <h2>Indicadores &amp; Insights</h2>
        </div>
        <div className="ii-acoes">
          <a className="btn ghost" href="/indicadores/reuniao">
            Modo reunião
          </a>
          {podeGerir ? (
            <MenuSuspenso
              rotulo="+ Novo"
              classeDoBotao="btn"
              conteudoDoBotao="+ Novo"
              opcoes={[
                { rotulo: 'Novo OKR', aoTocar: () => setAberto({ tipo: 'okr', okr: null }) },
                { rotulo: 'Novo KPI', aoTocar: () => setAberto({ tipo: 'kpi' }) },
                { rotulo: 'Nova meta', aoTocar: () => setAberto({ tipo: 'meta', kpi: null }) },
              ]}
            />
          ) : null}
        </div>
      </div>

      <nav className="ii-abas" aria-label="Abas de Indicadores & Insights">
        <a href="/indicadores" aria-current="page">
          OKRs e KPIs
        </a>
        <a href="/indicadores/relatorios">Relatórios</a>
      </nav>

      <div className="ii-filtros" data-aberto={filtrosAbertos}>
        <button
          type="button"
          className="btn ghost ii-filtros-botao"
          aria-expanded={filtrosAbertos}
          onClick={() => setFiltrosAbertos((v) => !v)}
        >
          Filtros{pilar !== '' || responsavel !== '' || unidade !== '' || passado ? ' (ativos)' : ''}
        </button>
        <div className="ii-filtros-campos">
          <label className="campo">
            Período
            <select value={escolhido?.inicio ?? ''} onChange={(e) => setTrimestre(e.target.value)} disabled={trimestres.length === 0}>
              {trimestres.map((t) => (
                <option key={t.inicio} value={t.inicio}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Pilar
            <select value={pilar} onChange={(e) => setPilar(PILARES_DE_KPI.find((p) => p === e.target.value) ?? '')}>
              <option value="">Todos</option>
              {(['Comercial', 'Financeiro', 'Processos', 'Pessoas'] as const).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Responsável
            <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
              <option value="">Todos</option>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          {unidades.length === 0 ? null : (
            <label className="campo">
              Unidade
              <select value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                <option value="">Todas</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {/* ---------------------------------------------- Faixa 1: os OKRs */}
      <section className="ii-faixa" aria-labelledby="ii-faixa-okrs">
        <div className="ii-faixa-cabeca">
          <h3 id="ii-faixa-okrs">Prioridades do trimestre</h3>
          {okrs.dados === null || okrsDoPeriodo.length === 0 ? null : (
            <span className="ii-resumo">
              {okrsDoPeriodo.length} {okrsDoPeriodo.length === 1 ? 'objetivo' : 'objetivos'}
              {media === null ? '' : ` · média ${media}%`}
            </span>
          )}
        </div>
        {okrs.carregando && okrs.dados === null ? <Carregando linhas={2} /> : null}
        {okrs.erro === null ? null : <Erro mensagem={okrs.erro} recarregar={okrs.recarregar} />}
        {okrs.dados !== null && okrsDoPeriodo.length === 0 ? (
          <Vazio>
            <p style={{ margin: 0 }}>Nenhuma prioridade definida para este trimestre.</p>
            {podeGerir ? (
              <button type="button" className="btn" onClick={() => setAberto({ tipo: 'okr', okr: null })}>
                Criar OKR
              </button>
            ) : null}
          </Vazio>
        ) : null}
        {okrsDoPeriodo.map((o) => (
          <CartaoDoOkr
            key={o.id}
            okr={o}
            kpis={kpisPorId}
            series={series}
            responsavel={nomeDe(o.responsavelId)}
            podeGerir={podeGerir}
            acoesDoKpi={(k) => acoesDoKpi(k, true)}
            lancarDoKpi={lancarDoKpi}
            fuso={fuso}
            aoEditar={() => setAberto({ tipo: 'okr', okr: o })}
            aoEncerrar={() => acaoDoOkr(o, 'encerrar')}
            aoDuplicar={() => acaoDoOkr(o, 'duplicar')}
            aoExcluir={() => acaoDoOkr(o, 'arquivar')}
          />
        ))}
      </section>

      {/* ---------------------------------------- Faixa 2: saúde da clínica */}
      <section className="ii-faixa" aria-labelledby="ii-faixa-saude">
        <div className="ii-faixa-cabeca">
          <h3 id="ii-faixa-saude">Saúde da clínica</h3>
          {kpis.dados === null || saude.length === 0 ? null : (
            <span className="ii-resumo">
              {saude.length} {saude.length === 1 ? 'indicador' : 'indicadores'} · {emAtencaoNaSaude} em atenção
            </span>
          )}
        </div>
        {(kpis.carregando || hojeDoServidor === null) && kpis.dados === null && okrs.erro === null ? <Carregando linhas={3} /> : null}
        {kpis.erro === null ? null : <Erro mensagem={kpis.erro} recarregar={kpis.recarregar} />}
        {kpis.dados !== null && listaDeKpis.length === 0 ? (
          <Vazio>
            <p style={{ margin: 0 }}>
              {pilar !== '' || responsavel !== ''
                ? 'Nenhum indicador com estes filtros.'
                : 'Escolha os indicadores que a clínica vai acompanhar.'}
            </p>
            {podeGerir && pilar === '' && responsavel === '' ? (
              <button type="button" className="btn" onClick={() => setAberto({ tipo: 'kpi' })}>
                Abrir catálogo
              </button>
            ) : null}
          </Vazio>
        ) : null}
        {kpis.dados !== null && listaDeKpis.length > 0 && saude.length === 0 ? (
          <p className="nota">Todos os indicadores estão dentro de um OKR, na faixa de cima.</p>
        ) : null}
        {grupos.map((g) => (
          <div key={g.pilar} style={{ display: 'grid', gap: 8 }}>
            <h4 className="ii-pilar">{g.pilar}</h4>
            <div className="ii-grade">
              {g.itens.map((k) => (
                <CartaoDoKpi
                  key={k.id}
                  kpi={k}
                  meta={k.metaVigente}
                  atual={k.atual}
                  serie={series.get(k.id) ?? null}
                  acoes={acoesDoKpi(k, false)}
                  fuso={fuso}
                  aoLancarAgora={lancarDoKpi(k)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------- os formulários */}
      {aberto?.tipo === 'kpi' ? (
        <FormularioDeKpi kpis={listaDeKpis} okrs={okrsAtivos} hoje={hoje} equipe={pessoas} aoFechar={fechar} aoSalvo={salvo} />
      ) : null}
      {aberto?.tipo === 'okr' ? (
        <FormularioDeOkr
          okr={aberto.okr}
          kpis={listaDeKpis}
          hoje={hoje}
          equipe={pessoas}
          aoFechar={fechar}
          aoSalvo={salvo}
          aoCriarKpi={() => setKpiPorCima(true)}
          inativo={kpiPorCima}
        />
      ) : null}
      {aberto?.tipo === 'okr' && kpiPorCima ? (
        <FormularioDeKpi
          kpis={listaDeKpis}
          okrs={[]}
          hoje={hoje}
          equipe={pessoas}
          aoFechar={fecharKpiPorCima}
          aoSalvo={kpiCriadoPorCima}
        />
      ) : null}
      {aberto?.tipo === 'meta' ? (
        <FormularioDeMeta
          kpis={listaDeKpis}
          kpiInicial={aberto.kpi}
          hoje={hoje}
          equipe={pessoas}
          aoFechar={fechar}
          aoSalvo={salvo}
        />
      ) : null}
      {aberto?.tipo === 'lancar' ? <JanelaDeLancamento alvo={aberto.alvo} aoFechar={fechar} aoSalvo={salvo} /> : null}

      {pergunta === null ? null : (
        <Modal titulo={pergunta.titulo} aoFechar={fecharPergunta}>
          <p style={{ margin: 0 }}>{pergunta.texto}</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 18 }}>
            <button type="button" className="link" style={{ minHeight: 44 }} onClick={fecharPergunta}>
              Cancelar
            </button>
            <button type="button" className="btn" disabled={respondendo} onClick={() => void responder()}>
              {respondendo ? 'Aguarde…' : pergunta.rotulo}
            </button>
          </div>
        </Modal>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * Os minigráficos: uma série por KPI, pedida depois da lista. KPI mensal pede
 * os últimos 6 meses (C.1); o semanal fica com a janela padrão da rota (os
 * últimos 3 meses, mês a mês) — a rota agrupa por mês toda janela de mais de
 * um mês, e as 8 semanas da 1.9 ainda não têm como sair dela.
 */
function useSeries(lista: ListaDeKpis | null): ReadonlyMap<string, SerieDoKpi> {
  const [series, setSeries] = useState<ReadonlyMap<string, SerieDoKpi>>(new Map())
  useEffect(() => {
    if (lista === null) return
    let valeu = true
    const seisMeses = somarMeses(`${lista.hoje.slice(0, 7)}-01`, -5)
    Promise.allSettled(
      lista.itens.map((k) =>
        chamar<SerieDoKpi>(
          `v1/indicadores/kpis/${k.id}/serie${k.frequencia === 'mensal' ? consultaEmTexto({ de: seisMeses, ate: lista.hoje }) : ''}`,
        ),
      ),
    ).then((rs) => {
      if (!valeu) return
      const m = new Map<string, SerieDoKpi>()
      for (const r of rs) if (r.status === 'fulfilled') m.set(r.value.kpiId, r.value)
      setSeries(m)
    })
    return () => {
      valeu = false
    }
  }, [lista])
  return series
}
