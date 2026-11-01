'use client'

import type { ItemNaLista } from '@fir/contracts'
import { type CodigoLido, gtinCanonico, interpretarCodigo } from '@fir/domain'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaEmTexto } from '@/lib/formato'

/**
 * **Ler o código** — a etiqueta da ferramenta, ou a caixa do medicamento.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA FAZ, E O QUE AINDA NÃO FAZ
 *
 * Ela interpreta o código: etiqueta `FRMEST:`, DataMatrix GS1 (produto, lote e
 * validade) e código de barras. **A interpretação é do domínio**
 * (`interpretarCodigo`), com teste próprio — inclusive a regra do GS1 em que o
 * dia `00` significa o último dia do mês, que o protótipo traduz para `28`.
 *
 * A entrada do código vem de dois lugares, e os dois funcionam hoje:
 *
 *  1. **leitor de código de barras USB** — ele digita no campo e dá Enter, que
 *     é como a maioria das clínicas já lê caixa;
 *  2. **digitado à mão**, lendo o número embaixo do código de barras.
 *
 * **A CÂMERA não está nesta fatia, e isso é deliberado.** O protótipo carrega
 * `html5-qrcode` de um CDN — script de terceiro na página que mostra dado de
 * saúde é decisão de segurança, não detalhe de implementação, e ela não foi
 * tomada. Escrever o caminho da câmera sem poder testá-lo aqui seria pior que
 * a ausência: código de navegador não exercitado é código que ninguém sabe se
 * funciona. A dívida está em `docs/dividas.md` (D-E6 e D-E7) com o gatilho
 * escrito — a primeira clínica que quiser ler pela câmera.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function LeitorDeCodigo({
  itens,
  aoFechar,
  aoAchar,
  aoEntrar,
  aoLigar,
}: {
  itens: ItemNaLista[]
  aoFechar: () => void
  aoAchar: (item: ItemNaLista, lote: string | null) => void
  aoEntrar: (item: ItemNaLista, lote: string | null) => void
  aoLigar: (recado: string) => void
}) {
  const [texto, setTexto] = useState('')
  const [lido, setLido] = useState<CodigoLido | null>(null)
  const [paraLigar, setParaLigar] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  const achar = (c: CodigoLido): ItemNaLista | null => {
    if (c.tipo === 'etiqueta') return itens.find((i) => i.id === c.itemId) ?? null
    if (c.tipo === 'medicamento' || c.tipo === 'barras') {
      const alvo = gtinCanonico(c.gtin)
      return itens.find((i) => i.gtin !== '' && i.gtin === alvo) ?? null
    }
    return null
  }

  const item = lido === null ? null : achar(lido)
  const lote = lido?.tipo === 'medicamento' ? lido.validade : null

  async function ligar(): Promise<void> {
    if (lido === null || lido.tipo === 'desconhecido' || lido.tipo === 'etiqueta') return
    if (paraLigar === '') {
      setErro('Escolha o item.')
      return
    }
    setErro(null)
    try {
      const r = await chamar<ItemNaLista>(`v1/estoque/${paraLigar}/codigo`, {
        method: 'POST',
        body: JSON.stringify({ gtin: lido.gtin }),
      })
      aoLigar(`Código ligado a "${r.nome}". Nas próximas leituras a ferramenta reconhece sozinha.`)
      setLido(null)
      aoFechar()
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    }
  }

  return (
    <div className="cartao" style={{ display: 'grid', gap: 12 }}>
      <h3>Ler código</h3>

      {lido === null ? (
        <>
          <p className="nota" style={{ margin: 0 }}>
            Passe o leitor na etiqueta da prateleira ou na caixa do medicamento — ele digita aqui
            sozinho. Ou digite o número embaixo do código de barras.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setErro(null)
              setLido(interpretarCodigo(texto))
            }}
          >
            <label className="campo">
              Código
              <input
                type="text"
                autoFocus
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                placeholder="Ex.: 7891234567895"
              />
            </label>
            <div className="botoes" style={{ marginTop: 10 }}>
              <button type="submit" className="btn">
                Usar código
              </button>
              <button type="button" className="btn ghost" onClick={aoFechar}>
                Cancelar
              </button>
            </div>
          </form>
        </>
      ) : lido.tipo === 'desconhecido' ? (
        <>
          <p className="nota" style={{ margin: 0 }}>
            Não reconheci este código: <code>{lido.texto}</code>
          </p>
          <div className="botoes">
            <button type="button" className="btn" onClick={() => setLido(null)}>
              Tentar outro
            </button>
            <button type="button" className="btn ghost" onClick={aoFechar}>
              Fechar
            </button>
          </div>
        </>
      ) : item !== null ? (
        <>
          <div className="info">
            <b>{item.nome}</b>
            <small>
              Em estoque: {item.semContagem ? 'sem contagem' : item.saldoEmEstoque.texto}
              {lote === null ? '' : ` · validade lida: ${diaEmTexto(lote)}`}
              {lido.tipo === 'medicamento' && lido.lote !== ''
                ? ` · lote ${lido.lote}`
                : ''}
            </small>
          </div>
          <div className="botoes">
            <button type="button" className="btn" onClick={() => aoAchar(item, lote)}>
              Registrar saída
            </button>
            <button type="button" className="btn ghost" onClick={() => aoEntrar(item, lote)}>
              Registrar entrada
            </button>
            <button type="button" className="btn ghost" onClick={aoFechar}>
              Fechar
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="info">
            <b>Código ainda não ligado a um item</b>
            <small>
              Código {lido.tipo === 'etiqueta' ? lido.itemId : gtinCanonico(lido.gtin)}
              {lote === null ? '' : ` · validade ${diaEmTexto(lote)}`}. Escolha o item uma vez: nas
              próximas leituras a ferramenta reconhece sozinha.
            </small>
          </div>
          {lido.tipo === 'etiqueta' ? (
            <p className="nota" style={{ margin: 0 }}>
              Esta etiqueta é de um item que não está mais no catálogo desta clínica.
            </p>
          ) : (
            <>
              <label className="campo">
                Item do estoque
                <select value={paraLigar} onChange={(e) => setParaLigar(e.target.value)}>
                  <option value="">Escolha o item</option>
                  {itens
                    .filter((i) => i.ativo)
                    .map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nome}
                      </option>
                    ))}
                </select>
              </label>
              {erro !== null ? (
                <p className="erro" role="alert">
                  {erro}
                </p>
              ) : null}
              <div className="botoes">
                <button type="button" className="btn" onClick={() => void ligar()}>
                  Ligar código
                </button>
                <button type="button" className="btn ghost" onClick={aoFechar}>
                  Cancelar
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
