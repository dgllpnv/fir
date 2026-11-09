'use client'

import type { ItemNaLista } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { gtinParaExibir } from './item-do-codigo'

/**
 * As ETIQUETAS para colar na prateleira.
 *
 * *"Imprima e cole na prateleira, na gaveta ou na geladeira onde o item fica.
 * Na entrada e na saída, basta ler a etiqueta."* (MANUAL cap. 12)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA ETIQUETA TEM
 *
 * O **QR** que a câmera do "Ler código" lê, e embaixo dele o **código em
 * texto** (`FRMEST:clinica:item`), que o leitor USB e a digitação aceitam. O
 * QR é desenhado pelo `qrcode` — empacotado no projeto (o mesmo do segundo
 * fator da carteira), nunca o CDN do protótipo — e o desenho é um `<path>` do
 * React a partir da matriz de módulos: nenhum SVG de texto injetado na página.
 * A biblioteca só desce quando a lista de etiquetas abre (D-E6, fechada).
 *
 * **O conteúdo do código vem do SERVIDOR** (`item.codigoQr`). Montado aqui,
 * imprimir no desktop e ler no celular dependeria de duas implementações
 * concordarem — e a que não concordasse imprimiria etiqueta que a câmera não
 * reconhece, numa folha já colada na geladeira.
 */
export function ListaDeEtiquetas({
  itens,
  escolhidosIniciais,
  aoFechar,
}: {
  itens: ItemNaLista[]
  /** "Etiqueta QR" no detalhe do item: a lista abre com só ele marcado. */
  escolhidosIniciais?: string[]
  aoFechar: () => void
}) {
  const [escolhidos, setEscolhidos] = useState<string[]>(
    escolhidosIniciais ?? itens.map((i) => i.id),
  )
  const desenhos = useDesenhosDoQr(itens.map((i) => i.codigoQr))

  return (
    <div className="cartao" style={{ display: 'grid', gap: 10 }}>
      <h3>Etiquetas do estoque</h3>
      <p className="nota" style={{ margin: 0 }}>
        Imprima e cole na prateleira, na gaveta ou na geladeira onde o item fica. Na entrada e na
        saída, basta ler a etiqueta com o leitor de código de barras. Medicamentos industrializados
        também podem ser lidos pelo código da própria caixa.
      </p>

      <div className="botoes">
        <button type="button" className="link" onClick={() => setEscolhidos(itens.map((i) => i.id))}>
          Marcar todos
        </button>
        <button type="button" className="link" onClick={() => setEscolhidos([])}>
          Desmarcar todos
        </button>
      </div>

      <div className="escolha-de-etiquetas">
        {itens.map((i) => (
          <label key={i.id} className="caixa">
            <input
              type="checkbox"
              checked={escolhidos.includes(i.id)}
              onChange={(e) =>
                setEscolhidos((a) => (e.target.checked ? [...a, i.id] : a.filter((x) => x !== i.id)))
              }
            />{' '}
            {i.nome}
            {i.local === null ? '' : ` · ${i.local}`}
          </label>
        ))}
      </div>

      {/* A área de impressão: `@media print` esconde o resto da tela. */}
      <div className="folha-de-etiquetas">
        {itens
          .filter((i) => escolhidos.includes(i.id))
          .map((i) => (
            <div key={i.id} className="etiqueta">
              <DesenhoDoQr desenho={desenhos.get(i.codigoQr)} />
              <b>{i.nome}</b>
              <span>{i.local ?? 'Sem local definido'}</span>
              <code className="num">{i.codigoQr}</code>
              {i.gtin === '' ? null : (
                <small className="num">caixa {gtinParaExibir(i.gtin)}</small>
              )}
            </div>
          ))}
      </div>

      <div className="botoes">
        <button
          type="button"
          className="btn"
          disabled={escolhidos.length === 0 || desenhos.size === 0}
          onClick={() => window.print()}
        >
          Imprimir {escolhidos.length === 1 ? 'etiqueta' : `${escolhidos.length} etiquetas`}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Fechar
        </button>
      </div>
    </div>
  )
}

/** Os módulos do QR como um caminho SVG: um quadrado por módulo escuro. */
type Desenho = { readonly tamanho: number; readonly caminho: string }

/**
 * Os desenhos dos QR, gerados quando a lista abre.
 *
 * Todos de uma vez (são dezenas, e cada um leva microssegundos): marcar e
 * desmarcar itens não refaz nada, e "Imprimir" fica desabilitado só até o
 * primeiro desenho existir — imprimir antes sairia a folha sem os QR.
 */
function useDesenhosDoQr(textos: readonly string[]): ReadonlyMap<string, Desenho> {
  const [desenhos, setDesenhos] = useState<ReadonlyMap<string, Desenho>>(new Map())
  const chave = textos.join('\n')
  useEffect(() => {
    let vivo = true
    void import('qrcode').then((m) => {
      if (!vivo) return
      const qr = m.default ?? m
      const novos = new Map<string, Desenho>()
      for (const t of chave === '' ? [] : chave.split('\n')) {
        // `M` (15% de recuperação): a etiqueta da geladeira molha e risca.
        const { modules } = qr.create(t, { errorCorrectionLevel: 'M' })
        let caminho = ''
        for (let l = 0; l < modules.size; l++) {
          for (let c = 0; c < modules.size; c++) {
            if (modules.get(l, c) === 1) caminho += `M${c} ${l}h1v1h-1z`
          }
        }
        novos.set(t, { tamanho: modules.size, caminho })
      }
      setDesenhos(novos)
    })
    return () => {
      vivo = false
    }
  }, [chave])
  return desenhos
}

function DesenhoDoQr({ desenho }: { desenho: Desenho | undefined }) {
  if (desenho === undefined) return null
  // A zona de silêncio de 2 módulos em volta: sem ela, a borda da etiqueta
  // encosta no código e a câmera não acha os três quadrados de posição.
  const m = 2
  const lado = desenho.tamanho + m * 2
  return (
    <svg
      className="qr-da-etiqueta"
      viewBox={`${-m} ${-m} ${lado} ${lado}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Código QR da etiqueta"
    >
      <rect x={-m} y={-m} width={lado} height={lado} fill="#fff" />
      <path d={desenho.caminho} fill="#000" />
    </svg>
  )
}
