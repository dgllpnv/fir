'use client'

import type { ItemNaLista, NotaLida, ResultadoDaEntradaPelaNota } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { milesimosDoTexto, textoDeMilesimos } from '@/lib/quantidade'
import { diaEmTexto } from '@/lib/formato'

/**
 * **Entrada pela nota** — pelo XML da NF-e, ou digitada.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O XML É LIDO NO SERVIDOR, e isso não é arbitrário
 *
 * O protótipo o lê no navegador, com `DOMParser`. Duas razões para o servidor,
 * e as duas são regras:
 *
 *  1. **O casamento depende de dado do servidor** — os vínculos salvos de
 *     `(CNPJ, código do produto)` e o catálogo inteiro. Feito aqui, seria a
 *     segunda implementação da mesma regra.
 *  2. **O custo unitário é dinheiro**, e ele atravessa redigido (regra 17).
 *     Lido no navegador, chegaria inteiro a quem não tem `valores`.
 *
 * A leitura **não grava nada** (regra 27: conciliação sugere, nunca
 * sobrescreve). Quem confirma é a pessoa, e é a confirmação dela que vira
 * vínculo para a próxima nota.
 * ────────────────────────────────────────────────────────────────────────────
 */

type LinhaConferida = NotaLida['linhas'][number] & { fatorDigitado: string }

export function EntradaPelaNota({
  itens,
  hoje,
  aoFechar,
  aoRegistrar,
}: {
  itens: ItemNaLista[]
  hoje: string
  aoFechar: () => void
  aoRegistrar: (recado: string) => void
}) {
  const [modo, setModo] = useState<'xml' | 'manual'>('xml')
  const [lida, setLida] = useState<NotaLida | null>(null)
  const [linhas, setLinhas] = useState<LinhaConferida[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function ler(arquivo: File): Promise<void> {
    setErro(null)
    setOcupado(true)
    try {
      const xml = await arquivo.text()
      const r = await chamar<NotaLida>('v1/estoque/notas/ler', {
        method: 'POST',
        body: JSON.stringify({ xml }),
      })
      setLida(r)
      setLinhas(r.linhas.map((l) => ({ ...l, fatorDigitado: textoDeMilesimos(l.fator) })))
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui ler o arquivo.')
    } finally {
      setOcupado(false)
    }
  }

  async function registrar(): Promise<void> {
    if (lida === null) return
    setErro(null)
    const vao = linhas.filter((l) => l.itemId !== null)
    if (vao.length === 0) {
      setErro('Ligue ao menos um item da nota ao estoque.')
      return
    }

    const corpo = {
      nota: {
        chave: lida.nota.chave,
        numero: lida.nota.numero,
        fornecedor: lida.nota.fornecedor,
        cnpj: lida.nota.cnpj,
        dia: lida.nota.dia,
      },
      linhas: vao.map((l) => {
        const fator = milesimosDoTexto(l.fatorDigitado) ?? 1000n
        return {
          como: 'nota' as const,
          itemId: l.itemId,
          quantidade: l.quantidadeNaNota,
          unidadeDaNota: l.unidadeDaNota === '' ? 'un.' : l.unidadeDaNota,
          fator: fator.toString(),
          codigo: l.codigo,
          descricao: l.descricao.slice(0, 80),
          lote: l.validade,
          // O custo por unidade da NOTA; o servidor divide pelo fator. `null`
          // quando a redação o apagou — quem não vê custo não o reenvia.
          custoDaNota: l.valorUnitario,
        }
      }),
    }

    setOcupado(true)
    try {
      const r = await chamar<ResultadoDaEntradaPelaNota>('v1/estoque/notas', {
        method: 'POST',
        body: JSON.stringify(corpo),
      })
      aoRegistrar(
        [
          r.jaRegistrada
            ? 'Esta nota já estava lançada — nada foi criado de novo.'
            : `${r.movimentos.length} ${r.movimentos.length === 1 ? 'entrada registrada' : 'entradas registradas'}.`,
          r.custoSubiu.length === 0
            ? ''
            : `Custo subiu 10% ou mais: ${r.custoSubiu.join(', ')}.`,
        ]
          .filter((x) => x !== '')
          .join(' '),
      )
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setOcupado(false)
    }
  }

  if (lida === null) {
    return (
      <div className="cartao" style={{ display: 'grid', gap: 12 }}>
        <h3>Entrada pela nota</h3>
        {modo === 'xml' ? (
          <>
            <p className="nota" style={{ margin: 0 }}>
              Para quem tem o <b>arquivo XML da NF-e</b> (o fornecedor envia, normalmente ao
              financeiro). A ferramenta lê fornecedor, itens, quantidades, custos e, nos
              medicamentos, lote e validade.
            </p>
            <label className="campo">
              Arquivo XML da nota
              <input
                type="file"
                accept=".xml,text/xml,application/xml"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f !== undefined) void ler(f)
                }}
              />
            </label>
            {erro !== null ? (
              <p className="erro" role="alert">
                {erro}
              </p>
            ) : null}
            <div className="botoes">
              <button type="button" className="btn ghost" onClick={() => setModo('manual')}>
                Não tenho o XML
              </button>
              <button type="button" className="btn ghost" onClick={aoFechar}>
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <NotaDigitada
            itens={itens}
            hoje={hoje}
            aoVoltar={() => setModo('xml')}
            aoFechar={aoFechar}
            aoRegistrar={aoRegistrar}
          />
        )}
      </div>
    )
  }

  const item = (id: string | null) => itens.find((i) => i.id === id) ?? null

  return (
    <div className="cartao" style={{ display: 'grid', gap: 12 }}>
      <h3>
        Conferir nota {lida.nota.numero} · {lida.nota.fornecedor}
      </h3>
      <p className="nota" style={{ margin: 0 }}>
        Emitida em {diaEmTexto(lida.nota.dia)}
        {lida.nota.cnpj === '' ? '' : ` · CNPJ ${lida.nota.cnpj}`}. Confira a qual item do estoque
        cada produto corresponde e quantas unidades do estoque vêm em cada unidade da nota (ex.: 1
        CX = 10 ampolas). A ferramenta guarda essa ligação para as próximas notas desse fornecedor.
      </p>

      {lida.jaRegistrada ? (
        <div className="aviso-forte">
          <b>Esta nota já foi registrada.</b>
          <span>
            Registrar de novo não cria nada: a ferramenta devolve os mesmos movimentos. A chave da
            nota é a chave de acesso da NF-e.
          </span>
        </div>
      ) : null}

      <div className="linhas">
        {linhas.map((l, k) => (
          <div key={`${l.codigo}-${k}`} className="linha-da-nota">
            <div className="info">
              <b>{l.descricao}</b>
              <small>
                cód. {l.codigo} · {textoDeMilesimos(l.quantidadeNaNota)} {l.unidadeDaNota}
                {l.valorUnitario === null
                  ? ''
                  : ` · ${formatarDinheiro(BigInt(l.valorUnitario))}/${l.unidadeDaNota}`}
                {l.loteDoFabricante === '' ? '' : ` · lote ${l.loteDoFabricante}`}
                {l.validade === null ? '' : ` · validade ${diaEmTexto(l.validade)}`}
              </small>
              <span className={`pill ${l.casamento === 'sem' ? '' : l.casamento === 'sugestao' ? 'alerta' : 'bom'}`}>
                {ROTULO_DO_CASAMENTO[l.casamento]}
              </span>
            </div>
            <div className="controles-da-linha">
              <label className="campo">
                Item do estoque
                <select
                  value={l.itemId ?? ''}
                  onChange={(e) =>
                    setLinhas((atual) =>
                      atual.map((x, j) =>
                        // A escolha vale para TODAS as linhas do mesmo produto:
                        // uma nota com três lotes do mesmo frasco são três
                        // linhas, e escolher o item três vezes é trabalho que a
                        // ferramenta pode poupar.
                        x.codigo === l.codigo && x.descricao === l.descricao
                          ? {
                              ...x,
                              itemId: e.target.value === '' ? null : e.target.value,
                              casamento: e.target.value === '' ? 'sem' : 'vinculo',
                            }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="">Ignorar (não é item de estoque)</option>
                  {itens.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nome}
                    </option>
                  ))}
                </select>
              </label>
              {l.itemId !== null ? (
                <label className="campo">
                  1 {l.unidadeDaNota} = quantas {item(l.itemId)?.medida ?? 'un.'}
                  <input
                    type="text"
                    inputMode="decimal"
                    className="num"
                    value={l.fatorDigitado}
                    onChange={(e) =>
                      setLinhas((atual) =>
                        atual.map((x, j) =>
                          x.codigo === l.codigo && x.descricao === l.descricao
                            ? { ...x, fatorDigitado: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                  <small>O que você confirmar fica salvo para as próximas notas.</small>
                </label>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {erro !== null ? (
        <p className="erro" role="alert">
          {erro}
        </p>
      ) : null}

      <div className="botoes">
        <button type="button" className="btn" disabled={ocupado} onClick={() => void registrar()}>
          {ocupado ? 'Registrando…' : 'Registrar entradas'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

const ROTULO_DO_CASAMENTO: Record<NotaLida['linhas'][number]['casamento'], string> = {
  vinculo: 'vínculo salvo',
  codigo: 'código igual',
  nome: 'nome parecido',
  sugestao: 'sugestão: confira',
  sem: 'não entra no estoque',
}

/* --------------------------------------------------------- nota digitada */

/**
 * A nota digitada — para quem tem a nota em papel.
 *
 * Ela também é **idempotente**: a chave é emissor + número (regra 26). O
 * protótipo não dedupa este caminho, e lançar a nota duas vezes dobra o
 * estoque de um item caro sem nenhum aviso.
 */
function NotaDigitada({
  itens,
  hoje,
  aoVoltar,
  aoFechar,
  aoRegistrar,
}: {
  itens: ItemNaLista[]
  hoje: string
  aoVoltar: () => void
  aoFechar: () => void
  aoRegistrar: (recado: string) => void
}) {
  const [fornecedor, setFornecedor] = useState('')
  const [numero, setNumero] = useState('')
  const [dia, setDia] = useState(hoje)
  const [linhas, setLinhas] = useState([
    { itemId: '', quantidade: '', unidade: '', lote: '', custo: '' },
  ])
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const item = (id: string) => itens.find((i) => i.id === id) ?? null

  async function registrar(): Promise<void> {
    setErro(null)
    const corpo: { nota: Record<string, unknown>; linhas: Record<string, unknown>[] } = {
      nota: { chave: null, numero: numero.trim(), fornecedor: fornecedor.trim(), cnpj: '', dia },
      linhas: [],
    }
    for (const l of linhas) {
      if (l.itemId === '' && l.quantidade.trim() === '') continue
      const it = item(l.itemId)
      if (it === null) {
        setErro('Escolha o item em todas as linhas.')
        return
      }
      const q = milesimosDoTexto(l.quantidade)
      if (q === null || q <= 0n) {
        setErro(`Informe a quantidade de "${it.nome}".`)
        return
      }
      const c = l.custo.trim() === '' ? null : centavosDoTexto(l.custo)
      if (l.custo.trim() !== '' && c === null) {
        setErro(`O custo de "${it.nome}" está num formato que eu não reconheço.`)
        return
      }
      corpo.linhas.push({
        como: 'cadastro',
        itemId: it.id,
        quantidade: q.toString(),
        // A unidade é uma das DECLARADAS no cadastro — quem converte é o
        // servidor, pelos fatores do item (regra 9).
        unidade: l.unidade === '' ? it.medida : l.unidade,
        lote: it.controlaValidade && l.lote !== '' ? l.lote : null,
        custo: c === null ? null : c.toString(),
      })
    }
    if (corpo.linhas.length === 0) {
      setErro('Informe pelo menos um item.')
      return
    }

    setOcupado(true)
    try {
      const r = await chamar<ResultadoDaEntradaPelaNota>('v1/estoque/notas', {
        method: 'POST',
        body: JSON.stringify(corpo),
      })
      aoRegistrar(
        r.jaRegistrada
          ? 'Esta nota já estava lançada — nada foi criado de novo.'
          : `${r.movimentos.length} ${r.movimentos.length === 1 ? 'entrada registrada' : 'entradas registradas'}.`,
      )
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <p className="nota" style={{ margin: 0 }}>
        Com a nota em mãos, lance todos os itens de uma vez. Nos itens com unidade de compra
        cadastrada, escolha se a quantidade está em caixas (como na nota) ou na unidade do estoque:
        a ferramenta converte sozinha.
      </p>
      <div className="par">
        <label className="campo">
          Fornecedor
          <input
            type="text"
            maxLength={80}
            value={fornecedor}
            onChange={(e) => setFornecedor(e.target.value)}
          />
        </label>
        <div className="par">
          <label className="campo">
            Nº da nota
            <input
              type="text"
              maxLength={20}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
            />
          </label>
          <label className="campo">
            Data
            <input type="date" max={hoje} value={dia} onChange={(e) => setDia(e.target.value)} />
          </label>
        </div>
      </div>

      {linhas.map((l, k) => {
        const it = item(l.itemId)
        const unidades = it === null ? [] : [it.medida, ...(it.compra === null ? [] : [it.compra.unidade])]
        const trocar = (campo: string, valor: string) =>
          setLinhas((atual) => atual.map((x, j) => (j === k ? { ...x, [campo]: valor } : x)))
        return (
          <div key={k} className="linha-da-nota-digitada">
            <label className="campo">
              Item
              <select value={l.itemId} onChange={(e) => trocar('itemId', e.target.value)}>
                <option value="">Selecione</option>
                {itens.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              Quantidade
              <input
                type="text"
                inputMode="decimal"
                className="num"
                value={l.quantidade}
                onChange={(e) => trocar('quantidade', e.target.value)}
              />
            </label>
            <label className="campo">
              Unidade
              <select
                value={l.unidade === '' ? (unidades[0] ?? '') : l.unidade}
                onChange={(e) => trocar('unidade', e.target.value)}
                disabled={unidades.length <= 1}
              >
                {unidades.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
            {it === null || it.controlaValidade ? (
              <label className="campo">
                Validade
                <input type="date" value={l.lote} onChange={(e) => trocar('lote', e.target.value)} />
              </label>
            ) : (
              <div />
            )}
            <label className="campo">
              Custo unit. (R$)
              <input
                type="text"
                inputMode="decimal"
                className="num"
                value={l.custo}
                onChange={(e) => trocar('custo', e.target.value)}
              />
            </label>
          </div>
        )
      })}

      <div>
        <button
          type="button"
          className="link"
          onClick={() =>
            setLinhas((a) => [...a, { itemId: '', quantidade: '', unidade: '', lote: '', custo: '' }])
          }
        >
          + outro item da nota
        </button>
      </div>

      {erro !== null ? (
        <p className="erro" role="alert">
          {erro}
        </p>
      ) : null}

      <div className="botoes">
        <button type="button" className="btn" disabled={ocupado} onClick={() => void registrar()}>
          {ocupado ? 'Registrando…' : 'Registrar entradas'}
        </button>
        <button type="button" className="btn ghost" onClick={aoVoltar}>
          Tenho o XML
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </>
  )
}
