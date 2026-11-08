'use client'

import type { ComparativoDeCampanhasSaida } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { Carregando } from '@/components/estados'
import {
  AvisoDeSupressao,
  PERIODO_INICIAL,
  consultaDoPeriodo,
  dinheiro,
  legendaDoInvestimento,
  mesCurto,
  mesPorExtenso,
  rotuloDoPeriodo,
  rotuloEmMinuscula,
  type EscolhaDePeriodo,
} from '@/components/carteira/campanhas-pecas'
import { chamar, ErroDaApi } from '@/lib/api'
import { instanteEmTexto } from '@/lib/instante'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'
import { FiltroSegmentado } from './filtro-segmentado'

/**
 * **CAMPANHAS — o comparativo de todas as clientes** (K1, `vCampanhas`,
 * `index.html` L1963-2001). D-25: igual ao protótipo — mesma ordem, mesmos
 * textos, quatro indicadores numa linha com o primeiro escuro, blocos em
 * cartão branco, tabelas cliente × meses com cabeçalho em caixa alta.
 *
 * Em 390 px a TABELA rola dentro do próprio cartão, como no protótipo; a
 * página nunca (`scrollWidth == innerWidth`, medido).
 *
 * "Atualizar agora" não existe: no protótipo ele só aparece no modo de
 * demonstração (L1972, `MODE==="live"?""`), e aqui não há rota que dispare a
 * leitura — ela roda sozinha todo dia (`worker-campanhas.ts`). No lugar do
 * botão fica a frase que diz isso.
 *
 * Divergências de gate, todas do servidor: "Continuado" aparece como "—" (ADR
 * 0013 §5, LGPD A26 — não existe na fonte); campanha com menos de 5 pagamentos
 * no mês não tem valor em lugar nenhum (LGPD A21–A23); sem `valores` os campos
 * em R$ chegam `null` e viram "—". Nada disso é decidido aqui.
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
    <header className="fcamp-cabeca">
      <div>
        <p className="fcamp-sobretitulo">Todas as clientes</p>
        <h1 className="fcamp-titulo">Campanhas</h1>
        <p className="fcamp-sub">Quanto cada campanha trouxe de resultado real para as clínicas.</p>
      </div>
      <p className="fcamp-acoes">A atualização roda sozinha todos os dias</p>
    </header>
  )

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return (
      <Moldura>
        {cabeca}
        <Carregando linhas={5} />
      </Moldura>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <Moldura>
        {cabeca}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </Moldura>
    )
  }

  const d = estado.dados
  const anterior = d.kpis.mesAnterior
  const meses = d.periodo.meses
  const maior = maiorValor(d.porCliente.flatMap((c) => c.meses.map((m) => m.valorGerado)))

  return (
    <Moldura>
      {cabeca}
      <FiltroSegmentado escolha={escolha} periodo={d.periodo} aoMudar={setEscolha} />

      <div className="fcamp-kpis">
        <div className="fcamp-kpi">
          <span>Valor gerado em {mesPorExtenso(d.periodo.mesAtual)}</span>
          <b>{dinheiro(d.kpis.mesAtual.valorGerado)}</b>
          <small>
            parcial · {anterior === null ? 'sem mês anterior' : `mês anterior ${dinheiro(anterior.valorGerado)}`}
          </small>
        </div>
        <div className="fcamp-kpi">
          <span>Total no período</span>
          <b>{dinheiro(d.kpis.periodo.valorGerado)}</b>
          <small>{dinheiro(d.kpis.periodo.valorGerado)} no mês · continuado indisponível</small>
        </div>
        <div className="fcamp-kpi">
          <span>Retorno sobre o investimento</span>
          <b>{d.kpis.periodo.retornoSobreInvestimento ?? '—'}</b>
          <small>{legendaDoInvestimento(d.kpis.periodo.investimento)}</small>
        </div>
        <div className="fcamp-kpi">
          <span>Campanhas ativas</span>
          <b>{d.kpis.ativas}</b>
          <small>
            {d.kpis.clientesAtualizandoSozinhos}{' '}
            {d.kpis.clientesAtualizandoSozinhos === 1 ? 'cliente atualizando sozinha' : 'clientes atualizando sozinhas'}
          </small>
        </div>
      </div>

      <AvisoDeSupressao quantidade={d.outras.quantidade} />

      <section className="fcamp-painel" aria-labelledby="fcamp-por-cliente">
        <div className="fcamp-ph">
          <h2 id="fcamp-por-cliente">Valor gerado por cliente</h2>
          <span className="fcamp-ph-nota">Meses: valor gerado no próprio mês. Continuado: ainda não lido da clínica</span>
        </div>
        <div className="fcamp-tabela">
          <table>
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                {meses.map((m) => (
                  <th key={m} scope="col" className="fcamp-num">
                    {mesCurto(m)}
                  </th>
                ))}
                <th scope="col" className="fcamp-num">
                  Continuado
                </th>
                <th scope="col" className="fcamp-num">
                  Total
                </th>
                <th scope="col" className="fcamp-num">
                  Retorno
                </th>
                <th scope="col">Campanha que mais gerou</th>
              </tr>
            </thead>
            <tbody>
              {d.porCliente.length === 0 ? (
                <tr>
                  <td colSpan={meses.length + 5} className="fcamp-vazio">
                    Nenhuma campanha registrada.
                  </td>
                </tr>
              ) : (
                d.porCliente.map((c) => (
                  <tr key={c.clienteCarteiraId}>
                    <td>
                      <Link className="fcamp-nm fcamp-nm-link" href={`/carteira/campanhas/${c.clienteCarteiraId}`}>
                        {c.nome}
                      </Link>
                      <div className="fcamp-sm">{c.ligadoAClinica ? 'Atualiza sozinha' : 'Lançamento manual'}</div>
                    </td>
                    {c.meses.map((m) => (
                      <td key={m.mes} className="fcamp-num">
                        <Barra valor={m.valorGerado} maior={maior} />
                        <Valor centavos={m.valorGerado} />
                      </td>
                    ))}
                    <td className="fcamp-num">
                      <span className="fcamp-traco">—</span>
                    </td>
                    <td className="fcamp-num">
                      <b>{dinheiro(c.valorGerado)}</b>
                    </td>
                    <td className="fcamp-num">{c.retornoSobreInvestimento ?? '—'}</td>
                    <td>
                      {c.melhor === null ? (
                        '—'
                      ) : (
                        <>
                          {c.melhor.nome}
                          <div className="fcamp-sm">
                            {dinheiro(c.melhor.valorGerado)} · {mesCurto(c.melhor.mes)}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="fcamp-grid2">
        <section className="fcamp-painel" aria-labelledby="fcamp-top">
          <div className="fcamp-ph">
            <h2 id="fcamp-top">Campanhas que mais geraram valor</h2>
            <span className="fcamp-ph-nota">{rotuloDoPeriodo(d.periodo)}</span>
          </div>
          {d.maisGeraram.length === 0 ? (
            <p className="fcamp-vazio">Sem valores lançados.</p>
          ) : (
            <ol className="fcamp-rows">
              {d.maisGeraram.map((x, i) => (
                <li key={x.id} className="fcamp-row fcamp-row-rk">
                  <span className={i < 3 ? 'fcamp-rk fcamp-rk-ouro' : 'fcamp-rk'}>{i + 1}</span>
                  <span className="fcamp-t">
                    {x.nome}{' '}
                    <span className="fcamp-t-mudo">
                      · {x.nomeDoCliente} · {mesCurto(x.mes)}
                    </span>
                  </span>
                  <b className="fcamp-valor">{dinheiro(x.valorGerado)}</b>
                  <span className="fcamp-d fcamp-d-rk">
                    {dinheiro(x.valorGerado)} no mês ·{' '}
                    {x.resultadoEmDinheiro !== null ? dinheiro(x.resultadoEmDinheiro) : (x.resultadoEmNumero ?? '—')}{' '}
                    {rotuloEmMinuscula(x.rotuloDaMetrica)}
                    {x.retornoSobreInvestimento !== null ? ` · retorno ${x.retornoSobreInvestimento}` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="fcamp-painel" aria-labelledby="fcamp-tipos">
          <div className="fcamp-ph">
            <h2 id="fcamp-tipos">Por tipo de campanha</h2>
            <span className="fcamp-ph-nota">Valor gerado somando todas as clientes</span>
          </div>
          {d.porTipo.length === 0 ? (
            <p className="fcamp-vazio">Sem valores lançados.</p>
          ) : (
            <div className="fcamp-tabela">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Tipo</th>
                    {meses.map((m) => (
                      <th key={m} scope="col" className="fcamp-num">
                        {mesCurto(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.porTipo.map((t) => (
                    <tr key={t.tipo}>
                      <td>
                        <div className="fcamp-nm">{t.tipo}</div>
                        <div className="fcamp-sm">
                          {t.clientes} {t.clientes > 1 ? 'clientes' : 'cliente'}
                        </div>
                      </td>
                      {t.meses.map((m) => (
                        <td key={m.mes} className="fcamp-num">
                          <Valor centavos={m.valorGerado} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="fcamp-painel" aria-labelledby="fcamp-auto">
        <div className="fcamp-ph">
          <h2 id="fcamp-auto">Atualização automática pela Gestão de Rotina</h2>
          <span className="fcamp-ph-nota">
            As campanhas, os resultados e os valores pagos já são registrados pela equipe de cada clínica
          </span>
        </div>
        {d.atualizacao.length === 0 ? (
          <p className="fcamp-vazio">Nenhuma cliente ativa ou em implantação.</p>
        ) : (
          <ul className="fcamp-rows">
            {d.atualizacao.map((c) => (
              <li key={c.clienteCarteiraId} className="fcamp-row">
                <span className="fcamp-t">{c.nome}</span>
                {c.ligadoAClinica ? (
                  <>
                    <span className="fcamp-chip fcamp-chip-bom">Ligada à Gestão de Rotina</span>
                    <span className="fcamp-d">
                      Última atualização:{' '}
                      {c.sincronizadoEm === null
                        ? 'nunca'
                        : (instanteEmTexto(c.sincronizadoEm, d.periodo.fuso, d.periodo.hoje) ?? 'nunca')}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="fcamp-chip">Lançamento manual</span>
                    <span className="fcamp-d">Sem clínica ligada. Resultados lançados à mão.</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="fcamp-ph-nota">
          Regra da leitura: o valor no mês soma os pagamentos registrados nas tarefas vinculadas à campanha, no mês
          em que foram pagos. O valor continuado ainda não é lido da clínica.
        </p>
        <p className="fcamp-aviso">
          A atualização roda sozinha todos os dias, direto da Gestão de Rotina de cada clínica, sem lançamento manual.
        </p>
      </section>
    </Moldura>
  )
}

function Moldura({ children }: { children: ReactNode }) {
  return (
    <>
      <NavDaCarteira atual="/carteira/campanhas" />
      <div className="carteira-pagina-larga">
        <section className="fcamp">{children}</section>
      </div>
    </>
  )
}

/** Célula de valor: "—" apagado quando zero ou quando o servidor redigiu o campo (`null`). */
function Valor({ centavos }: { centavos: string | null }) {
  if (centavos === null || centavos === '0') return <span className="fcamp-traco">—</span>
  return <>{dinheiro(centavos)}</>
}

/** O maior valor mensal da tabela — só a ESCALA das barras, nenhum total. `null` (redigido) fica de fora. */
function maiorValor(valores: (string | null)[]): bigint {
  let maior = 0n
  for (const v of valores) {
    if (v === null) continue
    const n = BigInt(v)
    if (n > maior) maior = n
  }
  return maior
}

/**
 * A barrinha sobre cada mês (`.vbar`, L1985). É desenho, não número: a largura
 * em pontos percentuais inteiros sai de `bigint`, sem ponto flutuante perto do
 * dinheiro. Sem valor (redigido ou tabela zerada), a trilha aparece vazia.
 */
function Barra({ valor, maior }: { valor: string | null; maior: bigint }) {
  const pct = valor === null || maior === 0n ? 0 : Number((BigInt(valor) * 100n) / maior)
  return <progress className="fcamp-vbar" max={100} value={pct} aria-hidden="true" />
}
