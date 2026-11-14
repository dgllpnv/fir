'use client'

import type { ListaDeProcedimentos } from '@fir/contracts'
import { useDados } from '@/lib/dados'

/**
 * OS PROCEDIMENTOS DO ORÇAMENTO — a lista simples, SEM virar programa.
 *
 * O programa (`Montador`) diz como o tratamento será executado: sessões,
 * intervalo, encadeamento. Esta lista só diz O QUE foi proposto — e é ela que
 * o fechamento parcial pergunta ("quais foram fechados?"). Uma linha por
 * procedimento do catálogo, com o preço opcional: quem não tem `valores` não vê
 * o campo, porque ele é de ENTRADA e o servidor o recusaria (mesma razão do
 * `Montador`).
 */

export type ItemNoEditor = {
  readonly chave: string
  readonly procedimentoId: string
  /** Texto digitado. Vira centavos na borda, nunca aqui. */
  readonly valor: string
  /** Sessões orçadas, texto digitado ("" = não informado). Vira inteiro na borda. */
  readonly sessoes: string
}

const MAXIMO = 10

export const itemVazio = (n: number): ItemNoEditor => ({
  chave: `i${n}`,
  procedimentoId: '',
  valor: '',
  sessoes: '',
})

export function EditorDeItensDoOrcamento({
  itens,
  aoMudar,
  podeValores,
}: {
  itens: readonly ItemNoEditor[]
  aoMudar: (itens: readonly ItemNoEditor[]) => void
  podeValores: boolean
}) {
  const catalogo = useDados<ListaDeProcedimentos>('v1/procedimentos')
  // Procedimento desativado não é oferecido em orçamento novo; o que já estava
  // na linha continua lá (a proposta de ontem não muda por causa do catálogo de hoje).
  const todos = catalogo.dados?.itens ?? []
  const ativos = todos.filter((p) => p.ativo)

  function trocar(k: number, troca: Partial<ItemNoEditor>) {
    aoMudar(itens.map((x, i) => (i === k ? { ...x, ...troca } : x)))
  }

  function remover(k: number) {
    // As chaves são renumeradas: o servidor exige chaves únicas, e a ordem da
    // tela é a do orçamento.
    aoMudar(itens.filter((_, i) => i !== k).map((x, i) => ({ ...x, chave: `i${i + 1}` })))
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {itens.map((item, k) => (
        <div
          key={item.chave}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}
        >
          <label className="campo" style={{ flex: '1 1 200px', margin: 0 }}>
            Procedimento {itens.length > 1 ? k + 1 : ''}
            <select
              value={item.procedimentoId}
              disabled={catalogo.carregando}
              onChange={(e) => trocar(k, { procedimentoId: e.target.value })}
            >
              <option value="">
                {catalogo.erro !== null
                  ? 'Não consegui carregar o catálogo'
                  : catalogo.carregando
                    ? 'Carregando…'
                    : 'Selecione'}
              </option>
              {(item.procedimentoId !== '' && !ativos.some((p) => p.id === item.procedimentoId)
                ? todos.filter((p) => p.id === item.procedimentoId)
                : []
              )
                .concat(ativos)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
            </select>
          </label>
          <label className="campo" style={{ flex: '0 1 100px', margin: 0 }}>
            Sessões <small>(opcional)</small>
            <input
              inputMode="numeric"
              className="num"
              placeholder="Ex.: 10"
              maxLength={2}
              value={item.sessoes}
              onChange={(e) => trocar(k, { sessoes: e.target.value.replace(/\D/g, '') })}
            />
          </label>
          {podeValores ? (
            <label className="campo" style={{ flex: '0 1 140px', margin: 0 }}>
              Valor (R$) <small>(opcional)</small>
              <input
                inputMode="decimal"
                className="num"
                placeholder="Ex.: 1.500,00"
                value={item.valor}
                onChange={(e) => trocar(k, { valor: e.target.value })}
              />
            </label>
          ) : null}
          {itens.length > 1 ? (
            <button
              type="button"
              className="btn ghost"
              aria-label={`Remover o procedimento ${k + 1}`}
              onClick={() => remover(k)}
            >
              Remover
            </button>
          ) : null}
        </div>
      ))}
      {itens.length >= MAXIMO ? (
        <p className="nota">Até {MAXIMO} procedimentos por orçamento.</p>
      ) : (
        <div>
          <button
            type="button"
            className="btn ghost"
            onClick={() => aoMudar([...itens, itemVazio(itens.length + 1)])}
          >
            + Adicionar procedimento
          </button>
        </div>
      )}
    </div>
  )
}
