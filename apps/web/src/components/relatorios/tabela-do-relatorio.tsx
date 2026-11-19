'use client'

import type { ColunaNaSaida, SomaDaColuna } from '@fir/contracts'
import { useMemo, useState } from 'react'
import { celula, type Linha, linhaDeTotais, ordenar, POR_PAGINA, pacienteDaCelula } from './na-tabela'

type Ordem = { readonly chave: string; readonly sentido: 'asc' | 'desc' } | null

/**
 * **A tabela do relatório** (1.9 G, item 4): cabeçalho fixo, ordenação por
 * coluna, 50 linhas por página. A tela ordena e pagina (I-36) — e só isso:
 * as linhas e as colunas chegam prontas, já sem as de dinheiro para quem não
 * tem `valores`.
 *
 * Em 390 px a tabela vira uma lista de blocos, cada célula com o rótulo da
 * coluna ao lado (`data-rotulo`): nove colunas não cabem, e rolar de lado é o
 * que nenhuma tela pode ter. A ordenação, ali, é um seletor.
 *
 * `todas`: a página de impressão mostra todas as linhas, sem paginar.
 * `somas`: as do servidor; viram a linha "Total" no pé, debaixo de cada coluna
 * (de TODAS as linhas, não só da página).
 */
export function TabelaDoRelatorio({
  colunas,
  linhas,
  somas = [],
  todas = false,
  rotulo,
}: {
  colunas: readonly ColunaNaSaida[]
  linhas: readonly Linha[]
  somas?: readonly SomaDaColuna[]
  todas?: boolean
  rotulo: string
}) {
  const totais = linhaDeTotais(colunas, somas)
  const [ordem, setOrdem] = useState<Ordem>(null)
  const [pagina, setPagina] = useState(0)

  const ordenadas = useMemo(() => {
    const col = ordem === null ? undefined : colunas.find((c) => c.chave === ordem.chave)
    return ordem === null || col === undefined ? [...linhas] : ordenar(linhas, col, ordem.sentido)
  }, [linhas, colunas, ordem])

  const paginas = Math.max(1, Math.ceil(ordenadas.length / POR_PAGINA))
  const atual = Math.min(pagina, paginas - 1)
  const visiveis = todas ? ordenadas : ordenadas.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA)

  const ordenarPor = (chave: string) => {
    setPagina(0)
    setOrdem((o) => (o?.chave === chave ? (o.sentido === 'asc' ? { chave, sentido: 'desc' } : null) : { chave, sentido: 'asc' }))
  }

  return (
    <div className="rel-tabela-area">
      {todas ? null : (
        <label className="campo rel-ordem-celular">
          Ordenar por
          <select
            value={ordem === null ? '' : `${ordem.chave}:${ordem.sentido}`}
            onChange={(e) => {
              setPagina(0)
              const [chave, sentido] = e.target.value.split(':')
              setOrdem(chave === undefined || chave === '' ? null : { chave, sentido: sentido === 'desc' ? 'desc' : 'asc' })
            }}
          >
            <option value="">Como veio</option>
            {colunas.flatMap((c) => [
              <option key={`${c.chave}:asc`} value={`${c.chave}:asc`}>
                {c.rotulo} (crescente)
              </option>,
              <option key={`${c.chave}:desc`} value={`${c.chave}:desc`}>
                {c.rotulo} (decrescente)
              </option>,
            ])}
          </select>
        </label>
      )}

      <table className="rel-tabela" aria-label={rotulo}>
        <thead>
          <tr>
            {colunas.map((c) => {
              const sentido = ordem?.chave === c.chave ? ordem.sentido : null
              const numerica = c.tipo === 'dinheiro' || c.tipo === 'quantidade' || c.tipo === 'numero' || c.tipo === 'data'
              return (
                <th
                  key={c.chave}
                  scope="col"
                  className={numerica ? 'rel-num' : undefined}
                  aria-sort={sentido === null ? 'none' : sentido === 'asc' ? 'ascending' : 'descending'}
                >
                  {todas ? (
                    c.rotulo
                  ) : (
                    <button type="button" onClick={() => ordenarPor(c.chave)}>
                      {c.rotulo}
                      <span aria-hidden="true" className="rel-seta">
                        {sentido === 'asc' ? '▲' : sentido === 'desc' ? '▼' : ''}
                      </span>
                    </button>
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {visiveis.map((l, i) => (
            <tr key={chaveDaLinha(l, i)}>
              {colunas.map((c) => {
                const cel = celula(c, l)
                const paciente = todas ? null : pacienteDaCelula(c, l)
                return (
                  <td key={c.chave} data-rotulo={c.rotulo} className={cel.numerica ? 'rel-num' : undefined}>
                    {paciente === null || cel.texto === '—' ? (
                      cel.texto
                    ) : (
                      // Nova aba (1.9 G): a lista fica onde estava, e a ficha se fecha sozinha.
                      <a href={`/pacientes/${paciente}`} target="_blank" rel="noopener">
                        {cel.texto}
                      </a>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
        {totais === null ? null : (
          <tfoot>
            <tr className="rel-total">
              {colunas.map((c, i) => (
                <td key={c.chave} data-rotulo={i === 0 ? undefined : c.rotulo} className={totais[i]?.numerica === true ? 'rel-num' : undefined}>
                  {totais[i]?.texto ?? ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>

      {todas || paginas === 1 ? null : (
        <nav className="rel-paginas" aria-label="Páginas do relatório">
          <button type="button" className="btn ghost" disabled={atual === 0} onClick={() => setPagina(atual - 1)}>
            Anterior
          </button>
          <span className="rel-num">
            {atual * POR_PAGINA + 1}–{Math.min(ordenadas.length, (atual + 1) * POR_PAGINA)} de {ordenadas.length}
          </span>
          <button type="button" className="btn ghost" disabled={atual >= paginas - 1} onClick={() => setPagina(atual + 1)}>
            Próxima
          </button>
        </nav>
      )}
    </div>
  )
}

/**
 * A chave da linha: o id mais específico que o contrato manda, com a posição —
 * o mesmo paciente aparece em várias linhas (um programa, uma adesão por
 * linha), e a falta do 14 pode chegar sem tarefa nem paciente.
 */
function chaveDaLinha(l: Linha, i: number): string {
  for (const k of ['recebimentoId', 'movimentoId', 'contaId', 'tarefaId', 'programaId', 'pacienteId']) {
    const v = l[k]
    if (typeof v === 'string') return `${v}:${i}`
  }
  return String(i)
}
