'use client'

import type { AnaliseDoEstoque } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { diaEmTexto } from '@/lib/formato'
import { Carregando, Erro, Vazio } from '../estados'
import { Diferenca } from './aba-contagens'

/**
 * A ANÁLISE — *"o que saiu sem registro"*, item a item.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELA MOSTRA O ESPERADO, E ISSO É CORRETO
 *
 * A regra 14 proíbe o esperado de atravessar **antes do fechamento** da
 * contagem em que alguém vai contar. Aqui tudo já foi contado: a análise
 * compara duas contagens CONCLUÍDAS, e uma contagem fechada não pode mais ser
 * influenciada. É a mesma classificação de "Últimos fechamentos" no caixa.
 *
 * As duas bordas vêm do SERVIDOR, no fuso da clínica (regra 24), e **são
 * contagens, não datas**: o esperado precisa de um ponto de partida que
 * alguém viu na prateleira. Sem duas contagens no período, a linha diz "sem
 * contagens" em vez de mostrar uma diferença que não significa nada.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function AbaAnalise({ hoje }: { hoje: string }) {
  const [de, setDe] = useState(primeiroDoMes(hoje))
  const [ate, setAte] = useState(hoje)
  const analise = useDados<AnaliseDoEstoque>(`v1/estoque/analise${consultaEmTexto({ de, ate })}`)

  return (
    <>
      <div className="par" style={{ marginBottom: 14 }}>
        <label className="campo">
          De
          <input type="date" max={ate} value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="campo">
          Até
          <input
            type="date"
            min={de}
            max={hoje}
            value={ate}
            onChange={(e) => setAte(e.target.value)}
          />
        </label>
      </div>

      {analise.carregando ? (
        <Carregando linhas={4} />
      ) : analise.erro !== null ? (
        <Erro mensagem={analise.erro} recarregar={analise.recarregar} />
      ) : analise.dados === null ? null : (
        <Conteudo a={analise.dados} />
      )}
    </>
  )
}

function Conteudo({ a }: { a: AnaliseDoEstoque }) {
  const comparaveis = a.itens.filter((i) => i.esperadoEmEstoque !== null)
  return (
    <>
      <div className="indicadores">
        <div className="indicador">
          <span className="rotulo">Itens abaixo do esperado</span>
          <b className="numero num">{a.itensComFalta}</b>
          <span className="rotulo">de {comparaveis.length} comparáveis</span>
        </div>
        {a.valorDaFalta !== null ? (
          <div className="indicador">
            <span className="rotulo">O que a falta vale</span>
            <b className="numero num">{formatarDinheiro(BigInt(a.valorDaFalta))}</b>
            <span className="rotulo">pelo custo cadastrado</span>
          </div>
        ) : null}
        <div className="indicador">
          <span className="rotulo">Sem duas contagens</span>
          <b className="numero num">{a.itensSemContagens}</b>
          <span className="rotulo">a análise não os alcança</span>
        </div>
      </div>

      {comparaveis.length === 0 ? (
        <Vazio>
          Nenhum item tem duas contagens neste período. A análise compara a contagem do começo com a
          do fim — gere uma lista de contagem em Contagens, e a próxima já poderá ser comparada.
        </Vazio>
      ) : (
        <div className="tabela-rolavel">
          <table className="lista conferencia-de-contagem">
            <thead>
              <tr>
                <th>Item</th>
                <th className="direita">Contagem inicial</th>
                <th className="direita">Entradas</th>
                <th className="direita">Saídas registradas</th>
                <th className="direita">Saldo esperado</th>
                <th className="direita">Contagem final</th>
                <th className="direita">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {comparaveis.map((i) => (
                <tr key={i.itemId}>
                  <td data-rotulo="Item">
                    <b>{i.nome}</b>
                    <small>
                      {i.deDia === null ? '' : `${diaEmTexto(i.deDia)} → `}
                      {i.ateDia === null ? '' : diaEmTexto(i.ateDia)}
                    </small>
                  </td>
                  <td className="direita" data-rotulo="Contagem inicial">
                    {i.inicialEmEstoque?.texto ?? '—'}
                  </td>
                  <td className="direita" data-rotulo="Entradas">
                    {i.entradasEmEstoque === null || i.entradasEmEstoque.milesimos === '0'
                      ? '—'
                      : `+${i.entradasEmEstoque.texto}`}
                  </td>
                  <td className="direita" data-rotulo="Saídas registradas">
                    {i.saidasEmEstoque === null || i.saidasEmEstoque.milesimos === '0'
                      ? '—'
                      : `−${i.saidasEmEstoque.texto}`}
                  </td>
                  <td className="direita" data-rotulo="Saldo esperado">
                    {i.esperadoEmEstoque?.texto ?? '—'}
                  </td>
                  <td className="direita" data-rotulo="Contagem final">
                    <b>{i.finalEmEstoque?.texto ?? '—'}</b>
                  </td>
                  <td className="direita" data-rotulo="Diferença">
                    <Diferenca q={i.diferencaEmEstoque} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="nota">
        Diferença em vermelho é <b>falta</b> (desperdício, desvio ou uso não registrado); em amarelo
        é <b>sobra</b>, que costuma ser entrada não lançada. Ela é relatada, nunca corrigida — para
        acertar o saldo, lance um ajuste com motivo.
      </p>
    </>
  )
}

/** O primeiro dia do mês do `hoje` DO SERVIDOR — nunca de `new Date()`. */
const primeiroDoMes = (hoje: string): string => `${hoje.slice(0, 7)}-01`
