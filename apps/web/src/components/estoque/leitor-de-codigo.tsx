'use client'

import type { ItemNaLista } from '@fir/contracts'
import { type CodigoLido, gtinCanonico } from '@fir/domain'
import { useEffect, useRef, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { CapturaDeCodigo } from './captura-de-codigo'
import {
  etiquetaDeOutraClinica,
  FRASE_DE_OUTRA_CLINICA,
  gtinParaExibir,
  itemDoCodigo,
} from './item-do-codigo'

/** O que a pessoa escolhe fazer com o item lido — os três botões do protótipo. */
export type AcaoDoCodigo = 'consumo' | 'entrada' | 'descarte'

/**
 * **Ler o código** no topo do Estoque — a etiqueta da ferramenta, ou a caixa
 * do medicamento.
 *
 * A captura (câmera ao vivo, foto ou digitação/leitor USB) é a
 * {@link CapturaDeCodigo}; a interpretação é do domínio (`interpretarCodigo`),
 * com teste próprio — inclusive a regra do GS1 em que o dia `00` significa o
 * último dia do mês, que o protótipo traduz para `28`.
 *
 * Depois de ler, como no protótipo (`qrEscolhaHtml`): o item achado pergunta
 * **Uso em paciente · Entrada · Descarte**, com a validade lida já indo para o
 * formulário. O código da caixa que ainda não é de nenhum item pede, uma vez,
 * a qual item ele pertence (`ligarCodigoItem`) — e **nunca cria item novo
 * sozinho**.
 */
export function LeitorDeCodigo({
  itens,
  aoFechar,
  aoAgir,
  aoLigar,
}: {
  itens: ItemNaLista[]
  aoFechar: () => void
  /** `lote` é a VALIDADE lida (o lote no nosso modelo); `loteDoFabricante`, o texto impresso. */
  aoAgir: (
    item: ItemNaLista,
    acao: AcaoDoCodigo,
    lote: string | null,
    loteDoFabricante: string,
  ) => void
  /** O item com o código recém-ligado, para a lista trocar em memória. */
  aoLigar: (item: ItemNaLista) => void
}) {
  const [capturando, setCapturando] = useState(true)
  const [lido, setLido] = useState<CodigoLido | null>(null)
  const [ligado, setLigado] = useState<ItemNaLista | null>(null)
  const [paraLigar, setParaLigar] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const cartao = useRef<HTMLDivElement>(null)

  // O resultado nasce abaixo dos botões do topo — em 390 px, fora da vista.
  // Rolar até ele é o `focoForm` do protótipo: sem isso a pessoa lê o código,
  // o leitor fecha, e nada parece ter acontecido.
  useEffect(() => {
    if (!capturando) cartao.current?.scrollIntoView({ block: 'start' })
  }, [capturando, ligado])

  if (capturando) {
    return (
      <CapturaDeCodigo
        titulo="Ler código do produto"
        aoFechar={aoFechar}
        aoLer={(c) => {
          setLido(c)
          setLigado(null)
          setErro(null)
          setCapturando(false)
        }}
      />
    )
  }
  if (lido === null) return null

  const item = ligado ?? itemDoCodigo(itens, lido)
  const lote = lido.tipo === 'medicamento' ? lido.validade : null
  const doFabricante = lido.tipo === 'medicamento' ? lido.lote : ''
  const lerOutro = () => setCapturando(true)

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
      aoLigar(r)
      setLigado(r)
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    }
  }

  return (
    <div ref={cartao} className="cartao" style={{ display: 'grid', gap: 12 }}>
      {lido.tipo === 'desconhecido' ? (
        <>
          <div className="eyebrow">Código lido</div>
          <p className="nota" style={{ margin: 0 }}>
            Este código não é de um item do estoque: <code>{lido.texto}</code>
          </p>
          <div className="botoes">
            <button type="button" className="btn" onClick={lerOutro}>
              Ler outro
            </button>
            <button type="button" className="btn ghost" onClick={aoFechar}>
              Fechar
            </button>
          </div>
        </>
      ) : item !== null ? (
        <>
          <div className="info">
            <div className="eyebrow">{ligado === null ? 'Código lido' : 'Código ligado'}</div>
            <b>{item.nome}</b>
            <small className="num">
              Em estoque: {item.semContagem ? 'sem contagem' : item.saldoEmEstoque.texto}
              {lote === null ? '' : ` · validade lida: ${mesAno(lote)}`}
              {lido.tipo === 'medicamento' && lido.lote !== '' ? ` · lote ${lido.lote}` : ''}
            </small>
            {ligado === null ? null : (
              <small>Nas próximas leituras a ferramenta reconhece este código sozinha.</small>
            )}
          </div>
          <div className="botoes">
            <button type="button" className="btn" onClick={() => aoAgir(item, 'consumo', lote, doFabricante)}>
              Uso em paciente
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => aoAgir(item, 'entrada', lote, doFabricante)}
            >
              Entrada
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => aoAgir(item, 'descarte', lote, doFabricante)}
            >
              Descarte
            </button>
            <button type="button" className="link" onClick={aoFechar}>
              Cancelar
            </button>
          </div>
        </>
      ) : lido.tipo === 'etiqueta' ? (
        <>
          <div className="eyebrow">Código lido</div>
          <p className="nota" style={{ margin: 0 }}>
            {etiquetaDeOutraClinica(itens, lido)
              ? FRASE_DE_OUTRA_CLINICA
              : 'Esta etiqueta é de um item que não está mais no catálogo desta clínica.'}
          </p>
          <div className="botoes">
            <button type="button" className="btn" onClick={lerOutro}>
              Ler outro
            </button>
            <button type="button" className="btn ghost" onClick={aoFechar}>
              Fechar
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="info">
            <div className="eyebrow">Código novo</div>
            <b>
              {lido.tipo === 'medicamento' ? 'Código da caixa do medicamento' : 'Código de barras'}{' '}
              ainda não ligado a um item
            </b>
            <small className="num">
              Código {gtinParaExibir(gtinCanonico(lido.gtin))}
              {lote === null ? '' : ` · validade ${mesAno(lote)}`}
              {lido.tipo === 'medicamento' && lido.lote !== '' ? ` · lote ${lido.lote}` : ''}.
              Escolha o item uma vez: nas próximas leituras a ferramenta reconhece sozinha.
            </small>
          </div>
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
            <button type="button" className="btn ghost" onClick={lerOutro}>
              Ler outro
            </button>
            <button type="button" className="link" onClick={aoFechar}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** `aaaa-mm-dd` → `mm/aaaa`. A validade se lê por mês, como no frasco. */
const mesAno = (dia: string): string => `${dia.slice(5, 7)}/${dia.slice(0, 4)}`
