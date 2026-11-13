'use client'

import type {
  CampanhaDetalhe,
  RascunhoDeCampanha,
  RecorteDaCampanha,
  TarefasDaCampanha,
} from '@fir/contracts'
import { METRICAS_DE_CAMPANHA } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useAcoesDeTarefa } from '@/lib/acoes-de-tarefa'
import { chamar } from '@/lib/api'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { centavos } from '@/lib/financeiro'
import { diaCurto, plural } from '@/lib/formato'
import { CartaoDeTarefa } from './cartao-de-tarefa'
import { Carregando, Erro, Toast } from './estados'
import { PainelDeEdicao } from './painel-de-edicao'
import {
  BarraDaMeta,
  type CorpoDaCampanha,
  Formulario,
  Importar,
  naEscala,
} from './tela-campanhas'

/**
 * **O detalhe da campanha** (`vCampanha` do protótipo) — o que a cliente
 * perdeu: "quando clicávamos na aba campanha e selecionávamos uma campanha, ela
 * abria e apareciam todas as tarefas dali".
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NÃO FAZ
 *
 *  1. **Não conta.** O funil, o "faltam X", o "% do planejado", a situação, a
 *     soma do drill-down e o histórico vêm prontos de `GET /v1/campanhas/:id` —
 *     o mesmo `montar` da lista, então o cartão e o detalhe nunca discordam.
 *  2. **Não escolhe quais tarefas mostrar por permissão.** São TODAS as da
 *     campanha, para quem tem `campanhas` (ADR 2026-11-13); o `escopo` de
 *     "Tarefas" não se aplica aqui. Quem decide se um cartão pode ser editado é
 *     o servidor, em cada ação.
 *  3. **Não decide quem vê valor.** Sem `valores` o servidor apaga
 *     `receita`, `valor`, `valorTotal`, `faltaEmDinheiro`; a tela só não
 *     desenha o que chegou `null`. A coluna "Valor" e o cartão de receita somem
 *     porque o dado não veio, não porque a tela perguntou a permissão.
 *  4. **Não mostra telefone sem `pacientes`.** O servidor o manda `null`.
 *
 * Tabelas viram blocos abaixo de 620 px (`table.painel`): nada rola na
 * horizontal a 390 px.
 * ────────────────────────────────────────────────────────────────────────────
 */

const PAGINA = 50

type Situacao = 'tudo' | 'abertas' | 'concluidas'
const SITUACOES: readonly { chave: Situacao; rotulo: string }[] = [
  { chave: 'tudo', rotulo: 'Tudo' },
  { chave: 'abertas', rotulo: 'Em aberto' },
  { chave: 'concluidas', rotulo: 'Concluídas' },
]

/** Um recorte aberto (o `drill` do protótipo). */
type Aberto = {
  readonly chave: string
  readonly titulo: string
  readonly recorte: RecorteDaCampanha
  readonly tipo?: string
  readonly pessoaId?: string
}

export function TelaCampanha({
  id,
  mesDaLista,
  eu,
  podeGerir,
  podeEquipe,
  podeReceber,
  podeValores,
  podePacientes,
}: {
  id: string
  /** Os recortes da lista de onde a pessoa veio, para o "← Campanhas" voltar a ela. */
  mesDaLista: string | undefined
  eu: string
  podeGerir: boolean
  podeEquipe: boolean
  podeReceber: boolean
  podeValores: boolean
  podePacientes: boolean
}) {
  const router = useRouter()
  const [situacao, setSituacao] = useState<Situacao>('tudo')
  const [limite, setLimite] = useState(PAGINA)
  const [aberto, setAberto] = useState<Aberto | null>(null)
  const [limiteDoDrill, setLimiteDoDrill] = useState(PAGINA)
  const [formulario, setFormulario] = useState<'editar' | 'repetir' | null>(null)
  const [rascunho, setRascunho] = useState<RascunhoDeCampanha | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [recadoDaTela, setRecadoDaTela] = useState<string | null>(null)

  const detalhe = useDados<CampanhaDetalhe>(`v1/campanhas/${id}`)
  const lista = useDados<TarefasDaCampanha>(
    `v1/campanhas/${id}/tarefas${consultaEmTexto({ situacao, limite })}`,
  )
  const drill = useDados<TarefasDaCampanha>(
    aberto === null
      ? null
      : `v1/campanhas/${id}/tarefas${consultaEmTexto({
          recorte: aberto.recorte,
          tipo: aberto.tipo,
          pessoaId: aberto.pessoaId,
          limite: limiteDoDrill,
        })}`,
  )

  /** Concluir/cancelar/reabrir mexem no funil, nas tabelas e nas duas listas. */
  const recarregarTudo = () => {
    detalhe.recarregar()
    lista.recarregar()
    if (aberto !== null) drill.recarregar()
  }
  const { acoes, mover, emEdicao, fecharEdicao, recado, setRecado, aoSalvarEdicao } =
    useAcoesDeTarefa(recarregarTudo, {
      podeVerValores: podeValores,
      hoje: lista.dados?.hoje ?? detalhe.dados?.hoje ?? null,
      autor: { id: eu, podeEquipe },
    })

  const d = detalhe.dados
  if (detalhe.erro !== null) {
    return (
      <section>
        <Link href="/campanhas" className="link">
          ← Campanhas
        </Link>
        <Erro mensagem={detalhe.erro} recarregar={detalhe.recarregar} />
      </section>
    )
  }
  if (d === null) {
    return (
      <section>
        <Carregando linhas={4} />
      </section>
    )
  }
  const c = d.campanha

  /**
   * O mês da lista a que o "voltar" leva (a regra do protótipo): o atual, se a
   * campanha toca o mês de hoje; senão o mês em que ela começa. Só escolha de
   * rótulo — o servidor é quem filtra.
   */
  const mesAtual = d.hoje.slice(0, 7)
  const tocaOMesAtual = c.inicio.slice(0, 7) <= mesAtual && c.fim.slice(0, 7) >= mesAtual
  const mesDeVolta = mesDaLista ?? (tocaOMesAtual ? mesAtual : c.inicio.slice(0, 7))

  const dinheiroOculto = c.metrica === 'receita' && c.metaEmDinheiro === null
  const faltaTexto = (): string => {
    const f = centavos(d.faltaEmDinheiro)
    if (f !== null) return formatarDinheiro(f)
    return String(d.faltaEmNumero ?? 0)
  }
  const ajudaDaMetrica = METRICAS_DE_CAMPANHA.find((m) => m.chave === c.metrica)?.ajuda ?? ''
  const receita = centavos(d.funil.receita)
  // Sem `valores` a coluna chega toda `null` e some — o dado não veio.
  const temValor = d.porTipo.some((l) => l.valor !== null)

  const abrir = (a: Aberto) => {
    setLimiteDoDrill(PAGINA)
    // Tocar de novo no mesmo número fecha, como no protótipo.
    setAberto((atual) => (atual?.chave === a.chave ? null : a))
  }

  const salvar = async (corpo: CorpoDaCampanha) => {
    setSalvando(true)
    try {
      if (formulario === 'repetir') {
        await chamar('v1/campanhas', { method: 'POST', body: JSON.stringify(corpo) })
        // Como no protótipo: depois de criar a cópia, a lista abre no mês dela.
        router.push(`/campanhas${consultaEmTexto({ mes: corpo.inicio.slice(0, 7) })}`)
        return
      }
      await chamar(`v1/campanhas/${id}`, { method: 'PUT', body: JSON.stringify(corpo) })
      setFormulario(null)
      recarregarTudo()
      setRecadoDaTela('Campanha salva.')
    } catch (e: unknown) {
      setRecadoDaTela(e instanceof Error ? e.message : 'Não consegui salvar.')
    } finally {
      setSalvando(false)
    }
  }

  const repetir = async () => {
    try {
      setRascunho(await chamar<RascunhoDeCampanha>(`v1/campanhas/${id}/proximo-mes`))
      setFormulario('repetir')
    } catch (e: unknown) {
      setRecadoDaTela(e instanceof Error ? e.message : 'Não consegui preparar a cópia.')
    }
  }

  const excluir = async () => {
    setSalvando(true)
    try {
      await chamar(`v1/campanhas/${id}`, { method: 'DELETE' })
      router.push(`/campanhas${consultaEmTexto({ mes: mesDeVolta })}`)
    } catch (e: unknown) {
      setRecadoDaTela(e instanceof Error ? e.message : 'Não consegui excluir.')
      setSalvando(false)
    }
  }

  const cartoes = (r: TarefasDaCampanha) =>
    r.tarefas.map((t) => (
      <CartaoDeTarefa
        key={t.id}
        tarefa={t}
        hoje={r.hoje}
        eu={eu}
        podeEquipe={podeEquipe}
        podePacientes={podePacientes}
        podeReceber={podeReceber}
        podeValores={podeValores}
        acoes={{ ...acoes, mover }}
      />
    ))

  /** Os registros que um número abriu, logo abaixo da tabela de onde ele veio. */
  const zona = (zonaDoDrill: 'funil' | 'tabelas') =>
    aberto === null || zonaDa(aberto.recorte) !== zonaDoDrill ? null : (
      <div className="drill" id={`drill-${zonaDoDrill}`}>
        <div className="drill-topo">
          <b>{aberto.titulo}</b>
          <span className="num contagem">{drill.dados?.total ?? '…'}</span>
          {/* `valorTotal` é redigido sem `valores`; `0` não é mostrado. */}
          {drill.dados?.valorTotal == null || BigInt(drill.dados.valorTotal) === 0n ? null : (
            <span className="num valor">{formatarDinheiro(BigInt(drill.dados.valorTotal))}</span>
          )}
          <button type="button" className="link" onClick={() => setAberto(null)}>
            Fechar
          </button>
        </div>
        {drill.erro !== null ? (
          <Erro mensagem={drill.erro} recarregar={drill.recarregar} />
        ) : drill.dados === null ? (
          <Carregando linhas={2} />
        ) : drill.dados.tarefas.length === 0 ? (
          <div className="vazio">Nenhum registro.</div>
        ) : (
          <>
            {cartoes(drill.dados)}
            {drill.dados.tarefas.length < drill.dados.total && limiteDoDrill < 200 ? (
              <div className="botoes">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setLimiteDoDrill((n) => Math.min(200, n + PAGINA))}
                >
                  Ver mais
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    )

  const numero = (a: Aberto, n: number) =>
    n === 0 ? (
      <span className="muted">0</span>
    ) : (
      <button
        type="button"
        className="numero-abre num"
        aria-label={`Ver ${n} registros`}
        aria-pressed={aberto?.chave === a.chave}
        onClick={() => abrir(a)}
      >
        {n}
      </button>
    )

  const kpiAbre = (a: Aberto, rotulo: string, valor: number, sub: string) => (
    <button
      type="button"
      className="kpi kpi-abre"
      aria-pressed={aberto?.chave === a.chave}
      onClick={() => abrir(a)}
    >
      <span>{rotulo}</span>
      <b className="num">{valor}</b>
      <span>{sub}</span>
      <span className="ver">Ver registros</span>
    </button>
  )

  const r = lista.dados

  return (
    <section className="detalhe-da-campanha">
      <Link href={`/campanhas${consultaEmTexto({ mes: mesDeVolta })}`} className="link">
        ← Campanhas
      </Link>

      <div className="cabeca-da-campanha">
        <div className="eyebrow">
          Campanha · <span className="num">{diaCurto(c.inicio)} a {diaCurto(c.fim)}</span>
        </div>
        <h2>{c.nome}</h2>
        <div className="pilulas">
          <span className="pill paciente">
            {c.categoria}
            {c.foco === '' ? '' : ` · ${c.foco}`}
          </span>
          <span className={`pill ${c.situacao === 'andamento' ? 'dourado' : ''}`}>
            {c.rotuloDaSituacao}
          </span>
        </div>
        {c.objetivo === '' ? null : <p className="nota">{c.objetivo}</p>}
      </div>

      <div className="acoes-de-tela" style={{ marginBottom: 12 }}>
        <Link href={`/nova?campanhaId=${c.id}&voltar=campanha`} className="btn">
          Nova tarefa nesta campanha
        </Link>
        {podeGerir && formulario === null ? (
          <>
            <Importar podeValores={podeValores} campanha={c} avisar={setRecadoDaTela} aoImportar={recarregarTudo} />
            <button type="button" className="btn ghost" onClick={() => setFormulario('editar')}>
              Editar campanha
            </button>
            <button type="button" className="btn ghost" onClick={() => void repetir()}>
              Repetir no próximo mês
            </button>
          </>
        ) : null}
      </div>

      {podeGerir && formulario !== null ? (
        <Formulario
          {...((formulario === 'repetir' ? rascunho : c) === null
            ? {}
            : { campanha: (formulario === 'repetir' ? rascunho : c)! })}
          repetindo={formulario === 'repetir'}
          categorias={[c.categoria]}
          salvando={salvando}
          semValores={!podeValores}
          aoCancelar={() => setFormulario(null)}
          aoSalvar={salvar}
        />
      ) : null}

      <div className="campanha cartao-de-meta">
        <div className="eyebrow">Meta · {c.rotuloDaMeta}</div>
        {dinheiroOculto ? (
          <p className="nota">
            O resultado desta campanha é em R$ e fica visível para o administrativo. Abaixo, o
            andamento das ações.
          </p>
        ) : (
          <>
            <div className="numero-da-meta">
              <button
                type="button"
                className="numero-abre grande num"
                onClick={() =>
                  abrir({ chave: 'res', titulo: `Resultado: ${c.rotuloDaMeta}`, recorte: 'resultado' })
                }
              >
                {naEscala(c, 'resultado')}
              </button>
              <span className="num">de {naEscala(c, 'meta')}</span>
              <b className="num">{c.percentualDaMeta === null ? '—' : `${c.percentualDaMeta}%`}</b>
            </div>
            <BarraDaMeta percentual={c.percentualDaMeta} />
            <p className="nota">
              {d.metaAtingida ? 'Meta atingida.' : `Faltam ${faltaTexto()} para a meta.`}{' '}
              {ajudaDaMetrica}
            </p>
          </>
        )}
      </div>

      <h3>Funil da campanha</h3>
      <div className="kpis funil-da-campanha">
        {kpiAbre(
          { chave: 'plan', titulo: 'Ações planejadas', recorte: 'planejadas' },
          'Ações planejadas',
          d.funil.planejadas,
          `${d.funil.emAberto} em aberto`,
        )}
        {kpiAbre(
          { chave: 'feitas', titulo: 'Ações realizadas', recorte: 'realizadas' },
          'Ações realizadas',
          d.funil.realizadas,
          `${d.funil.percentualRealizado}% do planejado`,
        )}
        {kpiAbre(
          { chave: 'alc', titulo: 'Contatos com pacientes', recorte: 'alcancadas' },
          'Pacientes alcançados',
          d.funil.alcancados,
          'com contato concluído',
        )}
        {kpiAbre(
          { chave: 'conv', titulo: 'Conversões (pagamentos)', recorte: 'conversoes' },
          'Pacientes convertidos',
          d.funil.convertidos,
          d.funil.taxaDeConversao === null ? '—' : `conversão ${d.funil.taxaDeConversao}%`,
        )}
        {receita === null ? null : (
          <div className="kpi destaque">
            <span>Receita da campanha</span>
            <b className="num">{formatarDinheiro(receita)}</b>
            <span>{plural(d.funil.conversoes, 'pagamento', 'pagamentos')}</span>
          </div>
        )}
      </div>
      {zona('funil')}

      <h3>Ações por tipo</h3>
      {d.porTipo.length === 0 ? (
        <p className="nota">Nenhuma tarefa vinculada ainda.</p>
      ) : (
        <div className="tabela">
          <table className="painel">
            <thead>
              <tr>
                <th>Tipo</th>
                <th className="direita">Planejadas</th>
                <th className="direita">Realizadas</th>
                {temValor ? <th className="direita">Valor</th> : null}
              </tr>
            </thead>
            <tbody>
              {d.porTipo.map((l) => {
                const v = centavos(l.valor)
                return (
                  <tr key={l.tipo}>
                    <td data-rotulo="Tipo">{l.rotulo}</td>
                    <td className="direita" data-rotulo="Planejadas">
                      {numero(
                        {
                          chave: `tp:p:${l.tipo}`,
                          titulo: `${l.rotulo} · planejadas`,
                          recorte: 'tipo-planejadas',
                          tipo: l.tipo === '' ? '__interna' : l.tipo,
                        },
                        l.planejadas,
                      )}
                    </td>
                    <td className="direita" data-rotulo="Realizadas">
                      {numero(
                        {
                          chave: `tp:f:${l.tipo}`,
                          titulo: `${l.rotulo} · realizadas`,
                          recorte: 'tipo-realizadas',
                          tipo: l.tipo === '' ? '__interna' : l.tipo,
                        },
                        l.realizadas,
                      )}
                    </td>
                    {temValor ? (
                      <td className="direita" data-rotulo="Valor">
                        {v === null || v === 0n ? '—' : formatarDinheiro(v)}
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <h3>Quem executou</h3>
      {d.porPessoa.length === 0 ? (
        <p className="nota">Nenhuma tarefa vinculada ainda.</p>
      ) : (
        <div className="tabela">
          <table className="painel">
            <thead>
              <tr>
                <th>Pessoa</th>
                <th className="direita">Planejadas</th>
                <th className="direita">Realizadas</th>
              </tr>
            </thead>
            <tbody>
              {d.porPessoa.map((p) => (
                <tr key={p.pessoaId}>
                  <td data-rotulo="Pessoa">{p.nome}</td>
                  <td className="direita" data-rotulo="Planejadas">
                    {numero(
                      {
                        chave: `rs:p:${p.pessoaId}`,
                        titulo: `${p.nome} · ações planejadas`,
                        recorte: 'pessoa-planejadas',
                        pessoaId: p.pessoaId,
                      },
                      p.planejadas,
                    )}
                  </td>
                  <td className="direita" data-rotulo="Realizadas">
                    {numero(
                      {
                        chave: `rs:f:${p.pessoaId}`,
                        titulo: `${p.nome} · ações realizadas`,
                        recorte: 'pessoa-realizadas',
                        pessoaId: p.pessoaId,
                      },
                      p.realizadas,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {zona('tabelas')}

      {d.historico.length === 0 ? null : (
        <>
          <h3>Histórico · {d.tituloDoHistorico}</h3>
          <p className="nota">Campanhas do mesmo tipo em outros meses, para comparar resultados.</p>
          <div className="tabela">
            <table className="painel">
              <thead>
                <tr>
                  <th>Período</th>
                  <th>Campanha</th>
                  <th className="direita">Resultado</th>
                  <th className="direita">%</th>
                  {d.historico.some((h) => h.receita !== null) ? (
                    <th className="direita">Receita</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {d.historico.map((h) => {
                  const rec = centavos(h.receita)
                  const oculto = h.metrica === 'receita' && h.metaEmDinheiro === null
                  return (
                    <tr key={h.id} className={h.id === c.id ? 'atual' : undefined}>
                      <td className="direita" data-rotulo="Período">
                        {diaCurto(h.inicio)} a {diaCurto(h.fim)} · {h.inicio.slice(0, 4)}
                      </td>
                      <td data-rotulo="Campanha">
                        {h.id === c.id ? (
                          <b>{h.nome}</b>
                        ) : (
                          <Link
                            href={`/campanhas/${h.id}${consultaEmTexto({ mes: mesDaLista })}`}
                            className="link"
                          >
                            {h.nome}
                          </Link>
                        )}
                        <span className="muted">{h.rotuloDaMeta}</span>
                      </td>
                      <td className="direita" data-rotulo="Resultado">
                        {oculto ? '—' : `${naEscala(h, 'resultado')} de ${naEscala(h, 'meta')}`}
                      </td>
                      <td className="direita" data-rotulo="%">
                        <b className={h.percentualDaMeta !== null && h.percentualDaMeta >= 100 ? 'ok' : undefined}>
                          {oculto || h.percentualDaMeta === null ? '—' : `${h.percentualDaMeta}%`}
                        </b>
                      </td>
                      {d.historico.some((x) => x.receita !== null) ? (
                        <td className="direita" data-rotulo="Receita">
                          {rec === null ? '—' : formatarDinheiro(rec)}
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 id="tarefas-da-campanha">
        Tarefas da campanha <span className="num contagem">{r?.total ?? '…'}</span>
      </h3>
      <div className="chips" role="group" aria-label="Tarefas">
        {SITUACOES.map((s) => (
          <button
            key={s.chave}
            type="button"
            aria-pressed={situacao === s.chave}
            onClick={() => {
              setSituacao(s.chave)
              setLimite(PAGINA)
            }}
          >
            {s.rotulo}
          </button>
        ))}
      </div>
      {lista.erro !== null ? (
        <Erro mensagem={lista.erro} recarregar={lista.recarregar} />
      ) : r === null ? (
        <Carregando linhas={3} />
      ) : r.tarefas.length === 0 ? (
        <div className="vazio">
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Nenhuma tarefa vinculada. Crie tarefas aqui ou escolha esta campanha ao criar ou
            editar uma tarefa.
          </p>
        </div>
      ) : (
        <>
          {cartoes(r)}
          {r.tarefas.length < r.total ? (
            <div className="botoes" style={{ marginTop: 12 }}>
              {limite < 200 ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setLimite((n) => Math.min(200, n + PAGINA))}
                >
                  Ver mais
                </button>
              ) : null}
              <p className="nota" style={{ alignSelf: 'center' }}>
                Mostrando <span className="num">{r.tarefas.length}</span> de{' '}
                <span className="num">{r.total}</span>.
              </p>
            </div>
          ) : null}
        </>
      )}

      {podeGerir ? (
        <div className="acoes-de-tela" style={{ marginTop: 24 }}>
          {confirmando ? (
            <>
              <button
                type="button"
                className="link perigo"
                onClick={() => void excluir()}
                disabled={salvando}
              >
                Confirmar exclusão
              </button>
              <button type="button" className="link" onClick={() => setConfirmando(false)}>
                Cancelar
              </button>
              <p className="nota">
                A campanha some das escolhas e <b>as tarefas continuam ligadas a ela</b> — o
                histórico do período não muda.
              </p>
            </>
          ) : (
            <button
              type="button"
              className="link perigo"
              onClick={() => setConfirmando(true)}
              disabled={salvando}
            >
              Excluir campanha
            </button>
          )}
        </div>
      ) : null}

      {emEdicao === null ? null : (
        <PainelDeEdicao
          tarefa={emEdicao}
          hoje={r?.hoje ?? d.hoje}
          aoFechar={fecharEdicao}
          aoSalvar={aoSalvarEdicao}
        />
      )}

      <Toast recado={recadoDaTela ?? recado} aoFechar={() => (recadoDaTela === null ? setRecado(null) : setRecadoDaTela(null))} />
    </section>
  )
}

/** Funil e resultado abrem junto do funil; tipo e pessoa, junto das tabelas. */
function zonaDa(recorte: RecorteDaCampanha): 'funil' | 'tabelas' {
  return recorte.startsWith('tipo-') || recorte.startsWith('pessoa-') ? 'tabelas' : 'funil'
}
