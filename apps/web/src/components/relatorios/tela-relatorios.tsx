'use client'

import {
  type ChaveDeRelatorio,
  type ExportarRelatorio,
  type FavoritoNaLista,
  type FormatoDeExportacao,
  type ListaDeRelatorios,
  type ResultadoDaExportacao,
  type ResultadoDoRelatorio,
} from '@fir/contracts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Carregando, Erro, Toast, Vazio } from '@/components/estados'
import { MenuSuspenso } from '@/components/indicadores/menu-suspenso'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { baixarArquivo, montarCsv, montarXlsx } from '@/lib/planilha'
import { CampanhaDaLista } from './campanha-da-lista'
import { ConfirmarExportacao, type EscolhaDaExportacao, ROTULO_DO_FORMATO } from './confirmar-exportacao'
import { FiltrosDoRelatorio } from './filtros-do-relatorio'
import {
  type Campos,
  camposIniciais,
  casaComBusca,
  deFiltros,
  fraseDo,
  grupoDoRelatorio,
  GRUPOS,
  paraFiltros,
  type PedidoPorLink,
  RELATORIOS_NA_TELA,
  tabelaDaExportacao,
  temOptInDeTelefone,
} from './na-tabela'
import { CAMINHO_DA_IMPRESSAO, ehJanelaPronta, mensagemDoPedido, type PedidoDeImpressao } from './pedido-de-impressao'
import { ResumoDoRelatorio } from './resumo-do-relatorio'
import { SalvarFavorito } from './salvar-favorito'
import { TabelaDoRelatorio } from './tabela-do-relatorio'

/** O que está na tela: o resultado e os filtros que o geraram (é deles que se exporta). */
type Gerado = { readonly chave: ChaveDeRelatorio; readonly filtros: Record<string, unknown>; readonly resultado: ResultadoDoRelatorio }

const mensagemDe = (x: unknown): string =>
  x instanceof ErroDaApi ? x.message : 'Não consegui falar com o servidor. Confira a conexão.'

/**
 * **Gestão › Indicadores & Insights — a aba "Relatórios"** (backlog 1.9 G; T8).
 *
 * À esquerda (no celular, no topo) o catálogo: busca, "Favoritos" antes de
 * tudo e os grupos. À direita, o relatório escolhido: nome e frase, filtros
 * em linha com "Gerar", a faixa de resumo, a barra de ações (Exportar, Salvar
 * como favorito) e a tabela.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AS LINHAS SÓ MORAM NA MEMÓRIA DESTA TELA (LGPD L-IN-15)
 *
 * `useState`, e nada mais: nem `localStorage`, nem `sessionStorage`, nem
 * IndexedDB, nem cache persistido. Sair do sistema é uma navegação completa
 * (`Shell.sair`), que desmonta tudo; e ao sair da página (`pagehide`), o
 * resultado é apagado também — o bfcache do navegador não devolve a lista
 * de pacientes a quem apertar Voltar depois.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A tela não calcula: linhas, colunas (já sem as de dinheiro para quem não
 * tem `valores`), resumo, cabeçalho e aviso do arquivo chegam do servidor.
 */
export function TelaRelatorios({
  hoje,
  podeJornada,
  sessaoDeSuporte,
  abertos,
  podeCampanhas,
  semValores,
  pedidoDoLink,
}: {
  hoje: string
  podeJornada: boolean
  sessaoDeSuporte: boolean
  /**
   * Os relatórios que esta sessão abre (`podeAbrirRelatorio`, a mesma função
   * do servidor). O servidor já filtra o catálogo; isto só garante que a tela
   * nunca ofereça o que ele recusaria (o 3 sem `valores`, o 5 sem `jornada`).
   */
  abertos: readonly ChaveDeRelatorio[]
  podeCampanhas: boolean
  semValores: boolean
  /** O relatório pedido por link (`?relatorio=&de=&ate=`): abre e gera na hora. */
  pedidoDoLink: PedidoPorLink | null
}) {
  const lista = useDados<ListaDeRelatorios>('v1/relatorios')
  const [busca, setBusca] = useState('')
  const [escolhido, setEscolhido] = useState<ChaveDeRelatorio | null>(null)
  const [catalogoAberto, setCatalogoAberto] = useState(true)
  const [campos, setCampos] = useState<Campos>(() => camposIniciais(hoje))
  const [gerado, setGerado] = useState<Gerado | null>(null)
  const [gerando, setGerando] = useState(false)
  const [erroDosFiltros, setErroDosFiltros] = useState<string | null>(null)
  const [erroDaGeracao, setErroDaGeracao] = useState<string | null>(null)
  const [favoritoAtivo, setFavoritoAtivo] = useState<string | null>(null)
  const [exportar, setExportar] = useState<FormatoDeExportacao | null>(null)
  const [exportando, setExportando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [remover, setRemover] = useState<FavoritoNaLista | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [criandoCampanha, setCriandoCampanha] = useState(false)

  // LGPD L-IN-15: a lista some quando a página sai de cena.
  useEffect(() => {
    const limpar = () => setGerado(null)
    window.addEventListener('pagehide', limpar)
    return () => window.removeEventListener('pagehide', limpar)
  }, [])

  const relatorios = useMemo(
    () => (lista.dados?.relatorios ?? []).filter((r) => RELATORIOS_NA_TELA.has(r.chave) && abertos.includes(r.chave)),
    [lista.dados, abertos],
  )
  const definicao = relatorios.find((r) => r.chave === escolhido) ?? null
  const comValores = definicao?.colunas.some((c) => c.tipo === 'dinheiro') ?? false

  const favoritos = (lista.dados?.favoritos ?? []).filter((f) => {
    const r = relatorios.find((x) => x.chave === f.chave)
    return r !== undefined && casaComBusca(f.chave, `${f.nome} ${r.titulo}`, grupoDoRelatorio(r.numero), busca)
  })

  const gerar = useCallback(async (chave: ChaveDeRelatorio, filtros: Record<string, unknown>) => {
    setGerando(true)
    setErroDaGeracao(null)
    try {
      const resultado = await chamar<ResultadoDoRelatorio>(`v1/relatorios/${chave}/execucoes`, {
        method: 'POST',
        body: JSON.stringify({ filtros }),
      })
      setGerado({ chave, filtros, resultado })
    } catch (x) {
      setGerado(null)
      setErroDaGeracao(mensagemDe(x))
    } finally {
      setGerando(false)
    }
  }, [])

  const escolher = (chave: ChaveDeRelatorio) => {
    if (chave !== escolhido) {
      setGerado(null)
      setErroDaGeracao(null)
      setErroDosFiltros(null)
    }
    setFavoritoAtivo(null)
    setEscolhido(chave)
    setCatalogoAberto(false)
  }

  /** O favorito com UM clique (1.10, item 18): escolhe, preenche e gera. */
  const rodarFavorito = (f: FavoritoNaLista) => {
    if (f.filtros === null) return
    setEscolhido(f.chave)
    setFavoritoAtivo(f.id)
    setCatalogoAberto(false)
    setErroDosFiltros(null)
    setCampos(deFiltros(f.chave, f.filtros, camposIniciais(hoje)))
    void gerar(f.chave, f.filtros)
  }

  /**
   * O link do detalhe do KPI (T6): escolhe o relatório, põe o período e gera,
   * uma vez, quando o catálogo chega. A consulta sai da URL logo em seguida —
   * o filtro não fica no histórico (appsec C15).
   */
  const linkAtendido = useRef(false)
  useEffect(() => {
    if (pedidoDoLink === null || linkAtendido.current || lista.dados === null) return
    linkAtendido.current = true
    window.history.replaceState(null, '', window.location.pathname)
    if (!relatorios.some((r) => r.chave === pedidoDoLink.chave)) {
      setRecado('Este relatório não está liberado para o seu acesso.')
      return
    }
    const base = camposIniciais(hoje)
    const c: Campos = { ...base, de: pedidoDoLink.de ?? base.de, ate: pedidoDoLink.ate ?? base.ate }
    setEscolhido(pedidoDoLink.chave)
    setCatalogoAberto(false)
    setCampos(c)
    const m = paraFiltros(pedidoDoLink.chave, c)
    if ('erro' in m) setErroDosFiltros(m.erro)
    else void gerar(pedidoDoLink.chave, m.filtros)
  }, [pedidoDoLink, lista.dados, relatorios, hoje, gerar])

  const aoGerar = () => {
    if (escolhido === null) return
    const m = paraFiltros(escolhido, campos)
    if ('erro' in m) {
      setErroDosFiltros(m.erro)
      return
    }
    setErroDosFiltros(null)
    setFavoritoAtivo(null)
    void gerar(escolhido, m.filtros)
  }

  const mudar = useCallback((p: Partial<Campos>) => setCampos((c) => ({ ...c, ...p })), [])

  /* ---------------------------------------------------------- exportação */

  // A classe de TEMPO DE EXECUÇÃO que o servidor devolveu (`classeDoRelatorio`,
  // já com a jornada aplicada): é ela que decide se a finalidade é exigida.
  const classe = gerado === null ? null : gerado.resultado.classe
  const suporteBarrado = sessaoDeSuporte && classe !== null && classe !== 'nenhuma'

  const pedirExportacao = (formato: FormatoDeExportacao) => {
    if (gerado === null) return
    // Classe `nenhuma` e sem telefone a escolher: nada a perguntar — o toque exporta.
    if (classe === 'nenhuma' && !temOptInDeTelefone(gerado.chave)) {
      void exportarAgora(formato, { incluirTelefone: false, finalidade: undefined })
      return
    }
    setExportar(formato)
  }

  const exportarAgora = async (formato: FormatoDeExportacao, e: EscolhaDaExportacao) => {
    if (gerado === null) return
    const pedido: ExportarRelatorio = {
      filtros: gerado.filtros,
      formato,
      incluirTelefone: e.incluirTelefone,
      ...(e.finalidade === undefined ? {} : { finalidade: e.finalidade }),
    }
    if (formato === 'impressao') {
      // Abre a janela AGORA, dentro do toque — depois de um `await` o
      // navegador a trataria como pop-up não pedido.
      abrirImpressao({ chave: gerado.chave, pedido }, setRecado)
      setExportar(null)
      return
    }
    setExportando(true)
    try {
      const r = await chamar<ResultadoDaExportacao>(`v1/relatorios/${gerado.chave}/exportacoes`, {
        method: 'POST',
        body: JSON.stringify(pedido),
      })
      const tabela = tabelaDaExportacao(r)
      if (formato === 'csv') baixarArquivo(r.exportacao.nomeDoArquivo, montarCsv(tabela), 'text/csv;charset=utf-8')
      else {
        const bytes = await montarXlsx(tabela)
        baixarArquivo(r.exportacao.nomeDoArquivo, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      }
      setExportar(null)
      setRecado(`Arquivo ${r.exportacao.nomeDoArquivo} baixado. A exportação ficou registrada em Atividades.`)
    } catch (x) {
      setExportar(null)
      setRecado(mensagemDe(x))
    } finally {
      setExportando(false)
    }
  }

  /* ----------------------------------------------------------- favoritos */

  const salvarFavorito = async (nome: string): Promise<string | null> => {
    if (gerado === null) return null
    setSalvando(true)
    try {
      const f = await chamar<FavoritoNaLista>('v1/relatorios/favoritos', {
        method: 'POST',
        body: JSON.stringify({ chave: gerado.chave, nome, filtros: gerado.filtros }),
      })
      lista.trocar((l) => ({ ...l, favoritos: [...l.favoritos, f].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) }))
      setFavoritoAtivo(f.id)
      setRecado(`Favorito "${f.nome}" salvo. Ele fica no topo da lista, para rodar com um toque.`)
      return null
    } catch (x) {
      return mensagemDe(x)
    } finally {
      setSalvando(false)
    }
  }

  const removerFavorito = async () => {
    if (remover === null) return
    try {
      await chamar(`v1/relatorios/favoritos/${remover.id}/arquivar`, { method: 'POST', body: JSON.stringify({}) })
      const id = remover.id
      lista.trocar((l) => ({ ...l, favoritos: l.favoritos.filter((f) => f.id !== id) }))
      if (favoritoAtivo === id) setFavoritoAtivo(null)
      setRecado(`Favorito "${remover.nome}" removido.`)
    } catch (x) {
      setRecado(mensagemDe(x))
    } finally {
      setRemover(null)
    }
  }

  /* ---------------------------------------------------------------- tela */

  const resultado = gerado !== null && gerado.chave === escolhido ? gerado.resultado : null

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
        </div>
      </div>

      <nav className="ii-abas" aria-label="Abas de Indicadores & Insights">
        <a href="/indicadores">OKRs e KPIs</a>
        <a href="/indicadores/relatorios" aria-current="page">
          Relatórios
        </a>
      </nav>

      {lista.erro !== null ? <Erro mensagem={lista.erro} recarregar={lista.recarregar} /> : null}
      {lista.carregando && lista.dados === null ? <Carregando linhas={4} /> : null}

      {lista.dados === null ? null : relatorios.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0 }}>
            Nenhum relatório está liberado para o seu acesso. Quem administra a clínica libera em Usuários e acessos.
          </p>
        </Vazio>
      ) : (
        <div className="rel-corpo" data-escolhido={escolhido !== null}>
          {/* ------------------------------------------------ o catálogo */}
          <aside className="rel-catalogo" data-aberto={catalogoAberto} aria-label="Catálogo de relatórios">
            {escolhido !== null ? (
              <button
                type="button"
                className="btn ghost rel-trocar"
                aria-expanded={catalogoAberto}
                onClick={() => setCatalogoAberto((v) => !v)}
              >
                {catalogoAberto ? 'Fechar a lista' : 'Trocar de relatório'}
              </button>
            ) : null}
            <div className="rel-catalogo-corpo">
              <label className="campo">
                <span className="sr-apenas">Buscar relatório</span>
                <input type="search" placeholder="Buscar relatório" value={busca} onChange={(e) => setBusca(e.target.value)} />
              </label>

              {favoritos.length > 0 ? (
                <div className="rel-grupo">
                  <h3>Favoritos</h3>
                  <ul>
                    {favoritos.map((f) => (
                      <li key={f.id} className="rel-favorito">
                        <button
                          type="button"
                          className="rel-item"
                          aria-current={favoritoAtivo === f.id ? 'true' : undefined}
                          disabled={f.desatualizado || f.filtros === null}
                          onClick={() => rodarFavorito(f)}
                        >
                          <b>{f.nome}</b>
                          <span>
                            {f.desatualizado || f.filtros === null
                              ? 'Filtros desatualizados'
                              : relatorios.find((r) => r.chave === f.chave)?.titulo}
                          </span>
                        </button>
                        <button type="button" className="ii-fechar rel-remover" aria-label={`Remover o favorito ${f.nome}`} onClick={() => setRemover(f)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {GRUPOS.map((g) => {
                const doGrupo = relatorios.filter((r) => grupoDoRelatorio(r.numero) === g && casaComBusca(r.chave, r.titulo, g, busca))
                if (doGrupo.length === 0) return null
                return (
                  <div key={g} className="rel-grupo">
                    <h3>{g}</h3>
                    <ul>
                      {doGrupo.map((r) => (
                        <li key={r.chave}>
                          <button
                            type="button"
                            className="rel-item"
                            aria-current={escolhido === r.chave && favoritoAtivo === null ? 'true' : undefined}
                            onClick={() => escolher(r.chave)}
                          >
                            <b>{r.titulo}</b>
                            <span>{fraseDo(r.chave)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
              {busca.trim() !== '' &&
              favoritos.length === 0 &&
              !relatorios.some((r) => casaComBusca(r.chave, r.titulo, grupoDoRelatorio(r.numero), busca)) ? (
                <p className="nota">Nenhum relatório com &quot;{busca.trim()}&quot;.</p>
              ) : null}
            </div>
          </aside>

          {/* ----------------------------------------- o relatório escolhido */}
          <div className="rel-area">
            {definicao === null ? (
              <div className="rel-escolha">
                <p className="nota">Escolha um relatório na lista. Os favoritos rodam com um toque.</p>
              </div>
            ) : (
              <>
                <header className="rel-cabeca">
                  <h3>{definicao.titulo}</h3>
                  <p className="nota">{fraseDo(definicao.chave)}</p>
                </header>

                <FiltrosDoRelatorio
                  key={`${definicao.chave}:${favoritoAtivo ?? ''}`}
                  chave={definicao.chave}
                  campos={campos}
                  mudar={mudar}
                  aoGerar={aoGerar}
                  gerando={gerando}
                  erro={erroDosFiltros}
                  comValores={comValores}
                  podeJornada={podeJornada}
                />

                {erroDaGeracao === null ? null : <Erro mensagem={erroDaGeracao} recarregar={aoGerar} />}
                {gerando && resultado === null ? <Carregando linhas={5} fino /> : null}

                {resultado === null ? (
                  gerando || erroDaGeracao !== null ? null : (
                    <p className="nota rel-antes">Ajuste os filtros e toque em Gerar.</p>
                  )
                ) : (
                  <div className="rel-resultado" aria-busy={gerando}>
                    <div className="rel-barra">
                      <ResumoDoRelatorio resultado={resultado} />
                      <div className="rel-acoes">
                        {resultado.linhas.length === 0 || suporteBarrado ? (
                          <button type="button" className="btn ghost" disabled title={suporteBarrado ? 'A sessão de suporte não exporta dado de paciente.' : undefined}>
                            Exportar
                          </button>
                        ) : (
                          <MenuSuspenso
                            rotulo="Exportar"
                            classeDoBotao="btn ghost"
                            conteudoDoBotao={exportando ? 'Exportando…' : 'Exportar'}
                            opcoes={(['xlsx', 'csv', 'impressao'] as const).map((f) => ({
                              rotulo: ROTULO_DO_FORMATO[f],
                              aoTocar: () => pedirExportacao(f),
                            }))}
                          />
                        )}
                        {definicao.listaDePacientes && podeCampanhas && resultado.linhas.length > 0 ? (
                          <button type="button" className="btn ghost" onClick={() => setCriandoCampanha(true)}>
                            Criar campanha com esta lista
                          </button>
                        ) : null}
                        <SalvarFavorito ocupado={salvando} aoSalvar={salvarFavorito} />
                      </div>
                    </div>
                    {suporteBarrado ? <p className="nota">A sessão de suporte vê este relatório, mas não o exporta.</p> : null}

                    {resultado.linhas.length === 0 ? (
                      <Vazio>
                        <p style={{ margin: 0 }}>Nada com estes filtros. Tente um período maior ou outro filtro.</p>
                      </Vazio>
                    ) : (
                      <TabelaDoRelatorio key={`${resultado.relatorio}:${JSON.stringify(gerado?.filtros ?? {})}`} colunas={resultado.colunas} linhas={resultado.linhas} rotulo={definicao.titulo} />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {exportar !== null && classe !== null && gerado !== null ? (
        <ConfirmarExportacao
          formato={exportar}
          classe={classe}
          comTelefone={temOptInDeTelefone(gerado.chave)}
          ocupado={exportando}
          aoFechar={() => setExportar(null)}
          aoConfirmar={(e) => void exportarAgora(exportar, e)}
        />
      ) : null}

      {criandoCampanha && gerado !== null && classe !== null ? (
        <CampanhaDaLista
          chave={gerado.chave}
          filtros={gerado.filtros}
          classe={classe}
          hoje={hoje}
          semValores={semValores}
          aoFechar={() => setCriandoCampanha(false)}
          aoCriar={setRecado}
        />
      ) : null}

      {remover === null ? null : (
        <Modal titulo="Remover este favorito?" aoFechar={() => setRemover(null)}>
          <p style={{ margin: 0 }}>&quot;{remover.nome}&quot; sai da lista para toda a clínica. O relatório continua.</p>
          <div className="rel-confirmar-botoes">
            <button type="button" className="link" style={{ minHeight: 44 }} onClick={() => setRemover(null)}>
              Cancelar
            </button>
            <button type="button" className="btn" onClick={() => void removerFavorito()}>
              Remover
            </button>
          </div>
        </Modal>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * Abre a janela de impressão e, quando ela avisar que está pronta, manda o
 * pedido — só para ela, e só na mesma origem (ver `pedido-de-impressao.ts`).
 */
function abrirImpressao(p: PedidoDeImpressao, avisar: (r: string) => void): void {
  const janela = window.open(CAMINHO_DA_IMPRESSAO, '_blank')
  if (janela === null) {
    avisar('O navegador bloqueou a janela de impressão. Permita janelas deste site e tente de novo.')
    return
  }
  const ouvir = (e: MessageEvent) => {
    if (e.origin !== window.location.origin || e.source !== janela || !ehJanelaPronta(e.data)) return
    janela.postMessage(mensagemDoPedido(p), window.location.origin)
    window.removeEventListener('message', ouvir)
  }
  window.addEventListener('message', ouvir)
  // A janela que nunca respondeu (fechada antes de carregar) não deixa o ouvinte para trás.
  setTimeout(() => window.removeEventListener('message', ouvir), 120_000)
  avisar('A impressão abriu em outra aba. Escolha "Salvar como PDF" ou a impressora.')
}
