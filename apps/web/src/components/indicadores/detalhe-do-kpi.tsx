'use client'

import type {
  DetalheDoKpi,
  KpiNaLista,
  ListaDaEquipe,
  ListaDeKpis,
  ListaDeOkrs,
  ListaDeTarefas,
  OkrNaSaida,
  TarefaNaLista,
} from '@fir/contracts'
import { type ChaveDePermissao, kpiDoCatalogo } from '@fir/domain'
import { useCallback, useMemo, useState } from 'react'
import { Carregando, Erro, Toast, Vazio } from '@/components/estados'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { Selo } from './cartao-do-kpi'
import { ComposicaoNaTela, LancamentosNaTela } from './detalhe-composicao'
import { GraficoDoDetalhe } from './detalhe-grafico'
import {
  type CorrecaoDoLancamento,
  daSerie,
  metasAnteriores,
  metasFuturas,
  MOTIVO_SEM_PROJECAO,
  numeroOuPercentual,
  periodoDaMeta,
  proximaDaSerie,
  textoDaProjecao,
  textoDaProximaMeta,
  textoDoAlvo,
} from './detalhe-na-tela'
import { PainelDeEdicao, PainelDeEscolherOkr, PainelDoPlanoDeAcao } from './detalhe-paineis'
import { FormularioDeMeta } from './formulario-de-meta'
import { FormularioDeOkr } from './formulario-de-okr'
import { JanelaDeLancamento } from './janela-de-lancamento'
import { ICONE_TRES_PONTOS, MenuSuspenso, type OpcaoDoMenu } from './menu-suspenso'
import {
  alvoDoKpi,
  diaCompleto,
  diaEMes,
  nomeDoMes,
  numeroDoCartao,
  ROTULO_DA_FREQUENCIA,
  ROTULO_DA_SITUACAO,
  situacaoDoCartao,
  TOM_DA_SITUACAO,
} from './na-tela'

type Aberto =
  | { readonly tipo: 'lancar'; readonly correcao: CorrecaoDoLancamento | null }
  | { readonly tipo: 'editar' }
  | { readonly tipo: 'meta' }
  | { readonly tipo: 'escolher-okr' }
  | { readonly tipo: 'okr'; readonly okr: OkrNaSaida }
  | { readonly tipo: 'plano' }
  | { readonly tipo: 'arquivar' }
  | null

/**
 * **`/indicadores/[id]` — o detalhe do KPI (1.9 E).**
 *
 * Topo (voltar, nome, pilar · frequência · responsável · fonte, e as ações),
 * a linha de quatro números, o gráfico grande, "De onde vem o número" ao lado
 * de "Planos de ação", e o rodapé com os OKRs e as metas anteriores.
 *
 * Nada aqui é calculado: os quatro números são `ValorNaTela` do servidor,
 * formatados pelo formatador central. Sem `valores`, o servidor apagou os
 * reais, e cada número mostra o percentual da meta que sobrou.
 *
 * **"Sem acesso ao detalhe"** (LGPD L-IN-3): o bloco "De onde vem o número"
 * exige a permissão da composição do catálogo (`jornada` para os KPIs com
 * paciente). A tela esconde; o servidor recusa do mesmo jeito.
 */
export function DetalheDoKpiNaTela({
  id,
  podeGerir,
  minhaPessoaId,
  permissoes,
}: {
  id: string
  podeGerir: boolean
  minhaPessoaId: string
  /** As chaves que a sessão tem, resolvidas no servidor por `temPerm`. */
  permissoes: readonly ChaveDePermissao[]
}) {
  const detalhe = useDados<DetalheDoKpi>(`v1/indicadores/kpis/${id}`)
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const okrs = useDados<ListaDeOkrs>('v1/indicadores/okrs')
  const [aberto, setAberto] = useState<Aberto>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [arquivando, setArquivando] = useState(false)
  const [versao, setVersao] = useState(0)
  // A lista de KPIs só é pedida quando um formulário que a usa abre.
  const precisaDaLista = aberto?.tipo === 'meta' || aberto?.tipo === 'okr'
  const lista = useDados<ListaDeKpis>(precisaDaLista ? 'v1/indicadores' : null)
  const podeVerEquipe = permissoes.includes('tarefas.equipe')
  const planos = usePlanos(id, podeVerEquipe)

  const pessoas = equipe.dados?.equipe ?? []
  const tem = useCallback((p: ChaveDePermissao | null) => p === null || permissoes.includes(p), [permissoes])

  const recarregarDetalhe = detalhe.recarregar
  const recarregarPlanos = planos.recarregar
  const fechar = useCallback(() => setAberto(null), [])
  const salvo = useCallback(
    (r: string) => {
      setAberto(null)
      setRecado(r)
      recarregarDetalhe()
      recarregarPlanos()
      setVersao((v) => v + 1)
    },
    [recarregarDetalhe, recarregarPlanos],
  )

  if (detalhe.erro !== null) {
    return (
      <section>
        <a className="kd-voltar" href="/indicadores">
          ← Indicadores &amp; Insights
        </a>
        <Erro mensagem={detalhe.erro} recarregar={detalhe.recarregar} />
      </section>
    )
  }
  const k = detalhe.dados
  if (k === null) {
    return (
      <section>
        <a className="kd-voltar" href="/indicadores">
          ← Indicadores &amp; Insights
        </a>
        <Carregando linhas={6} />
      </section>
    )
  }

  const hoje = k.periodo.ate
  const meta = k.metaVigente
  const situacao = situacaoDoCartao(meta)
  const responsavel = k.responsavelId === null ? null : (pessoas.find((p) => p.id === k.responsavelId)?.nome ?? null)
  const podeLancar = k.origem === 'manual' && (podeGerir || (minhaPessoaId !== '' && k.responsavelId === minhaPessoaId))
  const catalogo = k.chave === null ? null : kpiDoCatalogo(k.chave)
  const okrsDoKpi = (okrs.dados?.itens ?? []).filter((o) => k.okrIds.includes(o.id))
  const anteriores = metasAnteriores(k.metas, meta?.id ?? null, hoje)
  const proximaDoMes = proximaDaSerie(k.metas, meta)
  const futuras = metasFuturas(k.metas, hoje)
  // Sem meta agora, a próxima (se houver) aparece no lugar do "sem meta".
  const proximaSemVigente = meta === null ? (futuras[0] ?? null) : null

  const opcoes: OpcaoDoMenu[] = podeGerir
    ? [
        { rotulo: meta === null ? 'Definir meta' : 'Editar meta', aoTocar: () => setAberto({ tipo: 'meta' }) },
        { rotulo: 'Ligar a OKR', aoTocar: () => setAberto({ tipo: 'escolher-okr' }) },
        { rotulo: 'Arquivar indicador', aoTocar: () => setAberto({ tipo: 'arquivar' }), perigo: true },
      ]
    : []

  const arquivar = async () => {
    setArquivando(true)
    try {
      await chamar(`v1/indicadores/kpis/${k.id}/arquivar`, { method: 'POST', body: JSON.stringify({}) })
      window.location.assign('/indicadores')
    } catch (x) {
      setAberto(null)
      setRecado(x instanceof ErroDaApi ? x.message : 'Não consegui arquivar. Confira a conexão.')
    } finally {
      setArquivando(false)
    }
  }

  const numero = numeroDoCartao(k.atual)
  const projecao = meta === null ? { numero: '—', nota: null } : textoDaProjecao(meta)
  const kpiDaLista: KpiNaLista | null = lista.dados?.itens.find((x) => x.id === k.id) ?? null

  return (
    <section className="kd">
      <a className="kd-voltar" href="/indicadores">
        ← Indicadores &amp; Insights
      </a>

      <div className="kd-topo">
        <div style={{ minWidth: 0 }}>
          <h2>{k.nome}</h2>
          <p className="kd-sub">
            {k.pilar} · {ROTULO_DA_FREQUENCIA[k.frequencia]} · {responsavel ?? 'sem responsável'} ·{' '}
            {k.origem === 'catalogo' ? 'automático' : 'lançado pela equipe'}
          </p>
        </div>
        <div className="ii-acoes">
          {podeLancar ? (
            <button type="button" className="btn" onClick={() => setAberto({ tipo: 'lancar', correcao: null })}>
              Lançar valor
            </button>
          ) : null}
          {podeGerir ? (
            <button type="button" className="btn ghost" onClick={() => setAberto({ tipo: 'editar' })}>
              Editar
            </button>
          ) : null}
          {opcoes.length === 0 ? null : (
            <MenuSuspenso rotulo="Mais ações do indicador" classeDoBotao="ii-tres-pontos" conteudoDoBotao={ICONE_TRES_PONTOS} opcoes={opcoes} />
          )}
        </div>
      </div>

      {/* ------------------------------------------------ a linha de 4 números */}
      <dl className="kd-numeros">
        <div>
          <dt>Valor atual</dt>
          <dd className={numero.soPercentual ? 'kd-so-percentual' : undefined}>{numero.texto}</dd>
          <span className="kd-numero-nota">
            {diaEMes(k.periodo.de)} a {diaEMes(k.periodo.ate)}
            {k.diasAguardando > 0
              ? ` · ${k.diasAguardando} ${k.diasAguardando === 1 ? 'dia aguardando' : 'dias aguardando'} fechamento`
              : ''}
          </span>
        </div>
        <div>
          <dt>Meta e prazo</dt>
          <dd>{meta === null ? '—' : textoDoAlvo(meta)}</dd>
          <span className="kd-numero-nota">
            {meta === null ? (proximaSemVigente === null ? 'sem meta' : 'sem meta neste período') : `até ${diaCompleto(meta.prazo)}`}
            {meta !== null && daSerie(meta) ? ' · todo mês' : null}
            {meta === null ? null : (
              <>
                {' · '}
                <Selo tom={TOM_DA_SITUACAO[situacao]} texto={ROTULO_DA_SITUACAO[situacao]} />
              </>
            )}
          </span>
          {proximaDoMes === null ? null : (
            <span className="kd-numero-nota">
              em {nomeDoMes(proximaDoMes.inicio)}: {textoDoAlvo(proximaDoMes)}
            </span>
          )}
          {proximaSemVigente === null ? null : <span className="kd-numero-nota">{textoDaProximaMeta(proximaSemVigente)}</span>}
        </div>
        <div>
          <dt>Onde deveria estar hoje</dt>
          <dd>{meta === null ? '—' : numeroOuPercentual(meta.ritmo)}</dd>
          <span className="kd-numero-nota">{meta === null ? ' ' : 'pelo ritmo esperado'}</span>
        </div>
        <div>
          <dt>Projeção no prazo</dt>
          <dd>{projecao.numero}</dd>
          <span className="kd-numero-nota">
            {meta === null
              ? ' '
              : meta.projecao !== null
                ? (projecao.nota ?? ' ')
                : (MOTIVO_SEM_PROJECAO[meta.motivoSemProjecao ?? ''] ?? 'Sem projeção por enquanto.')}
          </span>
        </div>
      </dl>

      <GraficoDoDetalhe kpi={k} meta={meta} hoje={hoje} />

      {/* ------------------------------------------------ as duas colunas */}
      <div className="kd-colunas">
        <section aria-labelledby="kd-de-onde">
          <h3 id="kd-de-onde">De onde vem o número</h3>
          {k.origem === 'manual' ? (
            <LancamentosNaTela kpi={k} podeLancar={podeLancar} aoLancar={(correcao) => setAberto({ tipo: 'lancar', correcao })} versao={versao} />
          ) : (
            <ComposicaoNaTela kpi={k} temAcesso={catalogo === null || tem(catalogo.permissaoDaComposicao)} />
          )}
        </section>

        <section aria-labelledby="kd-planos">
          <div className="kd-coluna-cabeca">
            <h3 id="kd-planos">Planos de ação</h3>
            <button type="button" className="btn ghost" onClick={() => setAberto({ tipo: 'plano' })}>
              + Plano de ação
            </button>
          </div>
          {planos.carregando && planos.itens === null ? <Carregando linhas={2} fino /> : null}
          {planos.erro === null ? null : <Erro mensagem={planos.erro} recarregar={planos.recarregar} />}
          {planos.itens !== null && planos.itens.length === 0 ? (
            <Vazio>
              <p style={{ margin: 0 }}>Nenhum plano de ação ligado a este indicador.</p>
            </Vazio>
          ) : null}
          {planos.itens === null || planos.itens.length === 0 ? null : (
            <ul className="kd-planos">
              {planos.itens.map((t) => (
                <li key={t.id} data-status={t.status}>
                  <span className="kd-plano-descricao">{t.descricao}</span>
                  <span className="kd-plano-quem">
                    {t.destino.nome} · {t.status === 'aberta' ? `até ${diaEMes(t.prazo)}` : t.status === 'concluida' ? 'concluída' : 'cancelada'}
                    {t.status === 'aberta' && t.atrasada ? ' · atrasada' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ------------------------------------------------ rodapé */}
      <div className="kd-colunas kd-rodape">
        <section aria-labelledby="kd-okrs">
          <h3 id="kd-okrs">OKRs que usam este indicador</h3>
          {k.okrIds.length === 0 ? (
            <p className="nota">Nenhum.</p>
          ) : (
            <ul className="kd-lista-simples">
              {okrsDoKpi.map((o) => (
                <li key={o.id}>
                  <a className="link" href="/indicadores">
                    {o.objetivo}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="kd-metas">
          {futuras.length === 0 ? null : (
            <>
              <h3 id="kd-proximas">Próximas metas</h3>
              <ul className="kd-lista-simples" aria-labelledby="kd-proximas">
                {futuras.map((m) => (
                  <li key={m.id}>
                    <span className="kd-tabular">
                      {periodoDaMeta(m)} · {textoDoAlvo(m)}
                      {daSerie(m) ? ' · todo mês' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h3 id="kd-metas">Metas anteriores</h3>
          {anteriores.length === 0 ? (
            <p className="nota">Nenhuma meta encerrada.</p>
          ) : (
            <ul className="kd-lista-simples">
              {anteriores.map((m) => (
                <li key={m.id}>
                  <span className="kd-tabular">
                    {diaCompleto(m.inicio)} a {diaCompleto(m.prazo)} · {textoDoAlvo(m)}
                    {daSerie(m) ? ' · todo mês' : ''}
                  </span>
                  <Selo
                    tom={m.situacao === 'atingida' ? 'ok' : 'mau'}
                    texto={m.situacao === 'atingida' ? 'Atingida' : 'Não atingida'}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ------------------------------------------------ janelas */}
      {aberto?.tipo === 'lancar' ? (
        <JanelaDeLancamento
          // Uma janela por linha: o estado do formulário nasce da linha clicada.
          key={aberto.correcao?.referencia ?? 'novo'}
          alvo={{ ...alvoDoKpi(k), comoMedir: k.comoMedir }}
          correcao={aberto.correcao}
          aoFechar={fechar}
          aoSalvo={salvo}
        />
      ) : null}
      {aberto?.tipo === 'editar' ? <PainelDeEdicao kpi={k} equipe={pessoas} aoFechar={fechar} aoSalvo={salvo} /> : null}
      {aberto?.tipo === 'meta' ? (
        kpiDaLista === null ? (
          <Modal titulo={meta === null ? 'Definir meta' : 'Editar meta'} aoFechar={fechar}>
            {lista.erro === null ? <Carregando linhas={2} /> : <Erro mensagem={lista.erro} recarregar={lista.recarregar} />}
          </Modal>
        ) : (
          <FormularioDeMeta kpis={[kpiDaLista]} kpiInicial={kpiDaLista} hoje={hoje} equipe={pessoas} aoFechar={fechar} aoSalvo={salvo} />
        )
      ) : null}
      {aberto?.tipo === 'escolher-okr' ? (
        <PainelDeEscolherOkr
          okrs={(okrs.dados?.itens ?? []).filter((o) => o.estado === 'ativo')}
          aoFechar={fechar}
          aoEscolher={(okr) => setAberto({ tipo: 'okr', okr })}
        />
      ) : null}
      {aberto?.tipo === 'okr' ? (
        <FormularioDeOkr
          okr={aberto.okr}
          kpis={lista.dados?.itens ?? []}
          hoje={hoje}
          equipe={pessoas}
          aoFechar={fechar}
          aoSalvo={(r) => {
            salvo(r)
            okrs.recarregar()
          }}
          aoCriarKpi={() => undefined}
          inativo={false}
        />
      ) : null}
      {aberto?.tipo === 'plano' ? (
        <PainelDoPlanoDeAcao kpi={k} hoje={hoje} equipe={pessoas} minhaPessoaId={minhaPessoaId} aoFechar={fechar} aoSalvo={salvo} />
      ) : null}
      {aberto?.tipo === 'arquivar' ? (
        <Modal titulo="Arquivar este indicador?" aoFechar={fechar}>
          <p style={{ margin: 0 }}>
            &quot;{k.nome}&quot; sai da tela e para de ser acompanhado. As metas e os lançamentos ficam guardados.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 18 }}>
            <button type="button" className="link" style={{ minHeight: 44 }} onClick={fechar}>
              Cancelar
            </button>
            <button type="button" className="btn" disabled={arquivando} onClick={() => void arquivar()}>
              {arquivando ? 'Aguarde…' : 'Arquivar'}
            </button>
          </div>
        </Modal>
      ) : null}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * Os planos de ação do KPI: `GET /v1/tarefas?kpiId=` (I-46), abertos
 * primeiro. O filtro é do servidor e age DENTRO do escopo: com
 * `tarefas.equipe`, as da equipe; sem, as minhas e as que eu pedi.
 */
function usePlanos(kpiId: string, podeVerEquipe: boolean) {
  const base = `v1/tarefas?kpiId=${kpiId}&situacao=todas&periodo=qualquer&limite=200`
  const equipe = useDados<ListaDeTarefas>(podeVerEquipe ? `${base}&escopo=equipe` : null)
  const meu = useDados<ListaDeTarefas>(podeVerEquipe ? null : `${base}&escopo=meu`)
  const solicitei = useDados<ListaDeTarefas>(podeVerEquipe ? null : `${base}&escopo=solicitei`)
  const fontes = podeVerEquipe ? [equipe] : [meu, solicitei]
  const erro = fontes.find((f) => f.erro !== null)?.erro ?? null
  const carregando = fontes.some((f) => f.carregando)
  const listaDaEquipe = equipe.dados
  const listaMinha = meu.dados
  const listaPedida = solicitei.dados
  const itens = useMemo<TarefaNaLista[] | null>(() => {
    const listas = podeVerEquipe ? [listaDaEquipe] : [listaMinha, listaPedida]
    if (listas.some((l) => l === null)) return null
    // As duas listas (minhas e pedidas) podem repetir a mesma tarefa.
    const vistos = new Map<string, TarefaNaLista>()
    for (const l of listas) for (const t of l?.tarefas ?? []) vistos.set(t.id, t)
    const ordem = { aberta: 0, concluida: 1, cancelada: 2 } as const
    return [...vistos.values()].sort((a, b) => ordem[a.status] - ordem[b.status] || (a.prazo < b.prazo ? -1 : 1))
  }, [podeVerEquipe, listaDaEquipe, listaMinha, listaPedida])
  const r1 = equipe.recarregar
  const r2 = meu.recarregar
  const r3 = solicitei.recarregar
  const recarregar = useCallback(() => {
    if (podeVerEquipe) r1()
    else {
      r2()
      r3()
    }
  }, [podeVerEquipe, r1, r2, r3])
  return { itens, erro, carregando, recarregar }
}
