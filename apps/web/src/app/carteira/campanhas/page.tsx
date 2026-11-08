'use client'

import type { ComparativoDeCampanhasSaida } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Carregando, Vazio } from '@/components/estados'
import {
  AvisoDeSupressao,
  FiltroDePeriodo,
  PERIODO_INICIAL,
  consultaDoPeriodo,
  dinheiro,
  legendaDoInvestimento,
  mesCurto,
  mesPorExtenso,
  rotuloDoPeriodo,
  rotuloEmMinuscula,
  valorOuTraco,
  type EscolhaDePeriodo,
} from '@/components/carteira/campanhas-pecas'
import { chamar, ErroDaApi } from '@/lib/api'
import { instanteEmTexto } from '@/lib/instante'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **CAMPANHAS — o comparativo de todas as clientes** (K1, `vCampanhas`,
 * `index.html` L1963-2001; período K2, L1458-1476).
 *
 * Mesma ordem do protótipo: filtro de período, quatro indicadores, "Valor
 * gerado por cliente", "Campanhas que mais geraram valor", "Por tipo de
 * campanha" e "Atualização automática pela Gestão de Rotina". O botão
 * "Atualizar agora" do protótipo só existe no modo de demonstração (L1972,
 * `MODE==="live"?""`): aqui a leitura roda sozinha todo dia.
 *
 * As tabelas cliente × meses do protótipo viram LINHAS EMPILHADAS — 390 px é
 * o caso principal e nenhuma tela rola na horizontal (`docs/design.md` §1);
 * doze colunas de mês não cabem nem num tablet.
 *
 * Divergências do protótipo, todas de gate: "Continuado" aparece como
 * indisponível (ADR 0013 §5, LGPD A26 — não existe na fonte); campanha com
 * menos de 5 pagamentos no mês não tem valor em lugar nenhum (LGPD A21–A23)
 * e os totais somam só as exibidas; o retorno é "total ÷ investimento"
 * (D-22 item 9) e some com a receita que o originou.
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; dados: ComparativoDeCampanhasSaida }

export default function CampanhasDaCarteira() {
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [escolha, setEscolha] = useState<EscolhaDePeriodo>(PERIODO_INICIAL)
  const [tentativa, setTentativa] = useState(0)
  const consulta = consultaDoPeriodo(escolha)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void (async () => {
      try {
        const dados = await chamar<ComparativoDeCampanhasSaida>(`v1/carteira/campanhas?${consulta}`)
        if (valeu) setEstado({ tag: 'pronto', dados })
      } catch (e) {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as campanhas.',
          })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, consulta, tentativa])

  const cabeca = (
    <>
      <NavDaCarteira atual="/carteira/campanhas" />
      <p className="camp-sobretitulo">Todas as clientes</p>
      <h1 className="titulo">Campanhas</h1>
      <p className="nota">Quanto cada campanha trouxe de resultado real para as clínicas.</p>
    </>
  )

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return (
      <section className="camp">
        {cabeca}
        <Carregando linhas={5} />
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section className="camp">
        {cabeca}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </section>
    )
  }

  const d = estado.dados
  const anterior = d.kpis.mesAnterior

  return (
    <section className="camp">
      {cabeca}
      <FiltroDePeriodo escolha={escolha} periodo={d.periodo} comCiclo={false} aoMudar={setEscolha} />

      <div className="camp-kpis">
        <div className="camp-kpi">
          <span>Valor gerado em {mesPorExtenso(d.periodo.mesAtual)}</span>
          <b>{dinheiro(d.kpis.mesAtual.valorGerado)}</b>
          <small className="camp-legenda">
            parcial · {anterior === null ? 'sem mês anterior' : `mês anterior ${dinheiro(anterior.valorGerado)}`}
          </small>
        </div>
        <div className="camp-kpi">
          <span>Total no período</span>
          <b>{dinheiro(d.kpis.periodo.valorGerado)}</b>
          <small className="camp-legenda">no mês · continuado indisponível</small>
        </div>
        <div className="camp-kpi">
          <span>Retorno sobre o investimento</span>
          <b>{d.kpis.periodo.retornoSobreInvestimento ?? '—'}</b>
          <small className="camp-legenda">{legendaDoInvestimento(d.kpis.periodo.investimento)}</small>
        </div>
        <div className="camp-kpi">
          <span>Campanhas ativas</span>
          <b>{d.kpis.ativas}</b>
          <small className="camp-legenda">
            {d.kpis.clientesAtualizandoSozinhos}{' '}
            {d.kpis.clientesAtualizandoSozinhos === 1 ? 'cliente atualizando sozinha' : 'clientes atualizando sozinhas'}
          </small>
        </div>
      </div>

      <AvisoDeSupressao quantidade={d.outras.quantidade} />

      <section className="camp-painel" aria-labelledby="camp-por-cliente">
        <header className="camp-painel-cabeca">
          <h2 id="camp-por-cliente">Valor gerado por cliente</h2>
          <span className="nota">Meses: valor gerado no próprio mês. Continuado: ainda não lido da clínica</span>
        </header>
        {d.porCliente.length === 0 ? (
          <Vazio>
            <b>Nenhuma campanha com valor no período.</b>
            <p className="nota">Escolha um período maior, ou lance as campanhas na ficha de cada cliente.</p>
          </Vazio>
        ) : (
          <ul className="camp-linhas">
            {d.porCliente.map((c) => (
              <li key={c.clienteCarteiraId} className="camp-linha">
                <div className="camp-linha-cabeca">
                  <Link className="link camp-nome" href={`/carteira/campanhas/${c.clienteCarteiraId}`}>
                    {c.nome}
                  </Link>
                  <span className="nota">{c.ligadoAClinica ? 'Atualiza sozinha' : 'Lançamento manual'}</span>
                </div>
                <dl className="camp-meses">
                  {c.meses.map((m) => (
                    <div key={m.mes}>
                      <dt>{mesCurto(m.mes)}</dt>
                      <dd>{valorOuTraco(m.valorGerado)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Continuado</dt>
                    <dd className="camp-mudo">—</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>
                      <b>{dinheiro(c.valorGerado)}</b>
                    </dd>
                  </div>
                  <div>
                    <dt>Retorno</dt>
                    <dd>{c.retornoSobreInvestimento ?? '—'}</dd>
                  </div>
                </dl>
                <p className="nota">
                  Campanha que mais gerou:{' '}
                  {c.melhor === null
                    ? '—'
                    : `${c.melhor.nome} · ${dinheiro(c.melhor.valorGerado)} · ${mesCurto(c.melhor.mes)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="camp-duas">
        <section className="camp-painel" aria-labelledby="camp-top">
          <header className="camp-painel-cabeca">
            <h2 id="camp-top">Campanhas que mais geraram valor</h2>
            <span className="nota num">{rotuloDoPeriodo(d.periodo)}</span>
          </header>
          {d.maisGeraram.length === 0 ? (
            <p className="nota">Sem valores lançados.</p>
          ) : (
            <ol className="camp-ranking">
              {d.maisGeraram.map((x, i) => (
                <li key={x.id}>
                  <span className={i < 3 ? 'camp-posicao camp-ouro' : 'camp-posicao'}>{i + 1}</span>
                  <span className="camp-ranking-nome">
                    {x.nome}{' '}
                    <span className="nota">
                      · {x.nomeDoCliente} · {mesCurto(x.mes)}
                    </span>
                  </span>
                  <b className="num">{dinheiro(x.valorGerado)}</b>
                  <span className="nota camp-ranking-detalhe">
                    {dinheiro(x.valorGerado)} no mês ·{' '}
                    {x.resultadoEmDinheiro !== null
                      ? dinheiro(x.resultadoEmDinheiro)
                      : (x.resultadoEmNumero ?? '—')}{' '}
                    {rotuloEmMinuscula(x.rotuloDaMetrica)}
                    {x.retornoSobreInvestimento !== null ? ` · retorno ${x.retornoSobreInvestimento}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="camp-painel" aria-labelledby="camp-tipos">
          <header className="camp-painel-cabeca">
            <h2 id="camp-tipos">Por tipo de campanha</h2>
            <span className="nota">Valor gerado somando todas as clientes</span>
          </header>
          {d.porTipo.length === 0 ? (
            <p className="nota">Sem valores lançados.</p>
          ) : (
            <ul className="camp-linhas">
              {d.porTipo.map((t) => (
                <li key={t.tipo} className="camp-linha">
                  <div className="camp-linha-cabeca">
                    <span className="camp-nome">{t.tipo}</span>
                    <span className="nota">
                      {t.clientes} {t.clientes > 1 ? 'clientes' : 'cliente'}
                    </span>
                  </div>
                  <dl className="camp-meses">
                    {t.meses.map((m) => (
                      <div key={m.mes}>
                        <dt>{mesCurto(m.mes)}</dt>
                        <dd>{valorOuTraco(m.valorGerado)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="camp-painel" aria-labelledby="camp-auto">
        <header className="camp-painel-cabeca">
          <h2 id="camp-auto">Atualização automática pela Gestão de Rotina</h2>
          <span className="nota">
            As campanhas, os resultados e os valores pagos já são registrados pela equipe de cada clínica
          </span>
        </header>
        {d.atualizacao.length === 0 ? (
          <p className="nota">Nenhuma cliente ativa ou em implantação.</p>
        ) : (
          <ul className="camp-linhas">
            {d.atualizacao.map((c) => (
              <li key={c.clienteCarteiraId} className="camp-linha camp-auto">
                <span className="camp-nome">{c.nome}</span>
                {c.ligadoAClinica ? (
                  <>
                    <span className="pill bom">Ligada à Gestão de Rotina</span>
                    <span className="nota">
                      Última atualização:{' '}
                      {c.sincronizadoEm === null
                        ? 'nunca'
                        : (instanteEmTexto(c.sincronizadoEm, d.periodo.fuso, d.periodo.hoje) ?? 'nunca')}
                    </span>
                  </>
                ) : (
                  <span className="nota">Sem clínica ligada. Resultados lançados à mão.</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="nota">
          Regra da leitura: o valor no mês soma os pagamentos registrados nas tarefas vinculadas à campanha, no mês
          em que foram pagos. O valor continuado ainda não é lido da clínica.
        </p>
        <p className="camp-aviso">
          A atualização roda sozinha todos os dias, direto da Gestão de Rotina de cada clínica, sem lançamento manual.
        </p>
      </section>
    </section>
  )
}
