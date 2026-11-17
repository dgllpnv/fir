'use client'

import type { ResultadoDaExportacao } from '@fir/contracts'
import { useEffect, useRef, useState } from 'react'
import { Carregando, Erro } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { JANELA_PRONTA, lerPedido } from './pedido-de-impressao'
import { ResumoDoRelatorio } from './resumo-do-relatorio'
import { TabelaDoRelatorio } from './tabela-do-relatorio'

type Estado =
  | { readonly fase: 'esperando' }
  | { readonly fase: 'sem-pedido' }
  | { readonly fase: 'carregando' }
  | { readonly fase: 'pronto'; readonly exportacao: ResultadoDaExportacao }
  | { readonly fase: 'erro'; readonly mensagem: string }

/**
 * **A impressão do relatório — o "PDF"** (I-39; LGPD L-IN-12, L-IN-15).
 *
 * O PDF é o "Salvar como PDF" do navegador: nada de Chromium na VPS. A página
 * recebe o pedido da aba Relatórios por `postMessage` (nunca pela URL, nunca
 * pelo storage) e busca as PRÓPRIAS linhas pelo `POST …/exportacoes` com
 * `formato: 'impressao'` — é isso que registra a exportação, com o código que
 * vai no cabeçalho. Recarregar a página não traz as linhas de volta.
 *
 * O cabeçalho (clínica, relatório, filtros, data, quem exportou, código,
 * finalidade) e o aviso vêm prontos do servidor, sem dinheiro. Só o escape
 * do React; nenhum `dangerouslySetInnerHTML`.
 */
export function ImpressaoDoRelatorio() {
  const [estado, setEstado] = useState<Estado>({ fase: 'esperando' })
  const pediu = useRef(false)

  useEffect(() => {
    // `as`: `window.opener` é `any` no DOM; é a janela que abriu esta, ou `null`.
    const mae = window.opener as Window | null
    if (mae === null) {
      setEstado({ fase: 'sem-pedido' })
      return
    }
    const ouvir = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== mae || pediu.current) return
      const p = lerPedido(e.data)
      if (p === null) return
      pediu.current = true
      setEstado({ fase: 'carregando' })
      chamar<ResultadoDaExportacao>(`v1/relatorios/${p.chave}/exportacoes`, { method: 'POST', body: JSON.stringify(p.pedido) })
        .then((r) => setEstado({ fase: 'pronto', exportacao: r }))
        .catch((x: unknown) =>
          setEstado({ fase: 'erro', mensagem: x instanceof ErroDaApi ? x.message : 'Não consegui falar com o servidor. Confira a conexão.' }),
        )
    }
    window.addEventListener('message', ouvir)
    mae.postMessage({ tipo: JANELA_PRONTA }, window.location.origin)
    // Sem resposta em alguns segundos: a aba que abriu esta foi fechada ou recarregada.
    const t = setTimeout(() => {
      if (!pediu.current) setEstado({ fase: 'sem-pedido' })
    }, 8000)
    // L-IN-15: sair desta página apaga as linhas da memória.
    const limpar = () => setEstado({ fase: 'sem-pedido' })
    window.addEventListener('pagehide', limpar)
    return () => {
      clearTimeout(t)
      window.removeEventListener('message', ouvir)
      window.removeEventListener('pagehide', limpar)
    }
  }, [])

  // O diálogo de impressão abre sozinho, depois que a tabela pintou.
  const pronto = estado.fase === 'pronto'
  useEffect(() => {
    if (!pronto) return
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [pronto])

  if (estado.fase === 'esperando' || estado.fase === 'carregando') return <Carregando linhas={6} />
  if (estado.fase === 'erro') return <Erro mensagem={estado.mensagem} recarregar={() => window.location.reload()} />
  if (estado.fase === 'sem-pedido') {
    return (
      <div className="vazio">
        <p style={{ margin: 0 }}>
          Esta página imprime um relatório aberto na aba Relatórios. Gere o relatório lá e escolha Exportar › PDF.
        </p>
        <a className="btn" href="/indicadores/relatorios">
          Ir para Relatórios
        </a>
      </div>
    )
  }

  const { exportacao: e, resultado: r } = estado.exportacao
  const c = e.cabecalho
  return (
    <article className="rel-impressao">
      <div className="rel-impressao-acoes">
        <button type="button" className="btn" onClick={() => window.print()}>
          Imprimir ou salvar PDF
        </button>
        <button type="button" className="btn ghost" onClick={() => window.close()}>
          Fechar
        </button>
      </div>

      <header className="rel-impressao-cabeca">
        <div className="rel-impressao-marca">FIR Clinic</div>
        <h1>{c.relatorio}</h1>
        <p className="rel-impressao-clinica">{c.clinica}</p>
        <dl>
          <div>
            <dt>Filtros</dt>
            <dd>{c.filtrosEmTexto.join(' · ')}</dd>
          </div>
          <div>
            <dt>Gerado em</dt>
            <dd className="rel-num">{c.geradoEm}</dd>
          </div>
          <div>
            <dt>Exportado por</dt>
            <dd>{c.exportadoPor}</dd>
          </div>
          <div>
            <dt>Código</dt>
            <dd className="rel-num">{c.codigo}</dd>
          </div>
          {c.finalidade === null ? null : (
            <div>
              <dt>Finalidade</dt>
              <dd>{c.finalidade}</dd>
            </div>
          )}
        </dl>
        {c.aviso === null ? null : (
          <p className="rel-impressao-aviso" role="note">
            {c.aviso}
          </p>
        )}
      </header>

      <ResumoDoRelatorio resultado={r} />
      <TabelaDoRelatorio colunas={r.colunas} linhas={r.linhas} todas rotulo={c.relatorio} />
      <footer className="rel-impressao-rodape">
        <span>{c.clinica}</span>
        <span className="rel-num">
          {e.nomeDoArquivo} · {c.geradoEm}
        </span>
      </footer>
    </article>
  )
}
