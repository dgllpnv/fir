'use client'

import type { ItemNaLista } from '@fir/contracts'
import { useState } from 'react'

/**
 * As ETIQUETAS para colar na prateleira.
 *
 * *"Imprima e cole na prateleira, na gaveta ou na geladeira onde o item fica.
 * Na entrada e na saída, basta ler a etiqueta."* (MANUAL cap. 12)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA ETIQUETA TEM, E O QUE FALTA
 *
 * Ela tem o **código em texto** (`FRMEST:clinica:item`), que o leitor de
 * código de barras USB e o campo "Ler código" aceitam hoje. O **desenho do QR**
 * exige um codificador, e nenhuma biblioteca entrou como dependência nesta
 * fatia — o protótipo carrega `qrcode-generator` de um CDN, e script de
 * terceiro na página que mostra dado de saúde é decisão, não detalhe.
 *
 * A dívida está em `docs/dividas.md`, com o gatilho escrito: a clínica que for
 * ler pela CÂMERA do celular precisa da imagem; a que lê por leitor USB não.
 *
 * **O conteúdo do código vem do SERVIDOR** (`item.codigoQr`). Montado aqui,
 * imprimir no desktop e ler no celular dependeria de duas implementações
 * concordarem — e a que não concordasse imprimiria etiqueta que a câmera não
 * reconhece, numa folha já colada na geladeira.
 */
export function ListaDeEtiquetas({
  itens,
  aoFechar,
}: {
  itens: ItemNaLista[]
  aoFechar: () => void
}) {
  const [escolhidos, setEscolhidos] = useState<string[]>(itens.map((i) => i.id))

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
              <b>{i.nome}</b>
              <span>{i.local ?? 'Sem local definido'}</span>
              <code className="num">{i.codigoQr}</code>
              {i.gtin === '' ? null : <small className="num">caixa {i.gtin}</small>}
            </div>
          ))}
      </div>

      <div className="botoes">
        <button
          type="button"
          className="btn"
          disabled={escolhidos.length === 0}
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
