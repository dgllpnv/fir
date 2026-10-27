'use client'

import type { ListaDaEquipe, ListaDeProcedimentos, ProcedimentoNaLista } from '@fir/contracts'
import { ehErro, montarCronograma, type ItemParaCronograma } from '@fir/domain'
import { useState } from 'react'
import { useDados } from '@/lib/dados'
import { diaEmTexto, plural } from '@/lib/formato'
import { Carregando, Erro, Vazio } from '../estados'

/**
 * **O MONTADOR — UM componente, três entradas** (MANUAL cap. 8).
 *
 * `Programas › Nova adesão`, `Recebimento › Procedimento ou programa novo` e a
 * caixa *"É um programa: montar agora"* do `registrarOrcamento` (épico 3) usam
 * **este** componente. Duplicá-lo é como a terceira entrada deixa de aceitar
 * `depoisDe` e ninguém percebe — e `depoisDe` é a escalada de dose, que é a
 * razão de `itens[]` existir.
 *
 * **A PRÉVIA DAS DATAS VEM DE `montarCronograma` (`@fir/domain`)**, a mesma
 * função que o servidor usa para escrever as sessões. Uma segunda
 * implementação aqui é como a tela promete 18/01 e a agenda nasce em 25/01 —
 * formatar é do front; calcular não é. O que esta tela faz com o resultado é
 * **escrever a data em português**, e nada mais.
 *
 * Cada linha, fechada, mostra **três campos**: procedimento, sessões e quando
 * começa. Intervalo, dose, responsável e valor ficam atrás de "Ajustar", porque
 * campo raro numa tela de rotina tem custo e precisa ser pago
 * (`docs/design.md` §1).
 */

/** O limite da MONTAGEM é 12 (a proposta do épico 3 é 10, e é subconjunto). */
const MAXIMO_DE_ITENS = 12

export type ItemNoMontador = {
  readonly chave: string
  readonly procedimentoId: string
  readonly sessoes: number
  readonly intervaloDias: number
  /** `''` = começa no início do programa, ou depois de `depoisDe`. */
  readonly inicio: string
  readonly depoisDe: string
  readonly responsavelId: string
  readonly dose: string
  /** Texto digitado. Vira centavos na borda, nunca aqui. */
  readonly valor: string
}

export type EstadoDoMontador = {
  readonly inicio: string
  readonly itens: readonly ItemNoMontador[]
}

/** A linha nova, já preenchida com o que o CATÁLOGO sugere. */
export function itemDoProcedimento(
  p: ProcedimentoNaLista | undefined,
  chave: string,
): ItemNoMontador {
  return {
    chave,
    procedimentoId: p?.id ?? '',
    sessoes: p?.sessoesSugeridas ?? 1,
    intervaloDias: p?.intervaloSugeridoDias ?? 7,
    inicio: '',
    depoisDe: '',
    responsavelId: p?.responsavelId ?? '',
    dose: '',
    valor: '',
  }
}

export function montadorVazio(hoje: string): EstadoDoMontador {
  return { inicio: hoje, itens: [itemDoProcedimento(undefined, 'i1')] }
}

type Props = {
  readonly estado: EstadoDoMontador
  readonly aoMudar: (e: EstadoDoMontador) => void
  /** `temPerm(…, 'valores')`. Sem ela, o campo de valor do item não aparece. */
  readonly podeValores: boolean
}

/**
 * O montador busca o catálogo **e a equipe** ele mesmo.
 *
 * As três entradas (Nova adesão, Recebimento e o orçamento da jornada) estão em
 * profundidades diferentes da árvore — a do orçamento vive **dentro do cartão
 * de tarefa**, a quatro níveis da página. Passar a equipe por propriedade
 * obrigaria `TelaHoje` e `TelaTarefas` a carregá-la para um formulário que elas
 * não abrem, e a cadeia atravessaria dois componentes que não têm nada a ver
 * com programa.
 *
 * `podeValores` continua propriedade, e a diferença é de natureza: **permissão
 * se resolve na PÁGINA**, com `temPerm` — a mesma função do servidor —, e não
 * dentro de um componente de cliente.
 */
export function Montador({ estado, aoMudar, podeValores }: Props) {
  const catalogo = useDados<ListaDeProcedimentos>('v1/procedimentos')
  const equipeToda = useDados<ListaDaEquipe>('v1/equipe')
  const equipe = (equipeToda.dados?.equipe ?? []).filter((x) => x.ativo)
  const procedimentos = catalogo.dados?.itens ?? []
  // Procedimento DESATIVADO não é oferecido em nova adesão (MANUAL cap. 11:
  // "desmarque Ativo" significa *deixa de ser oferecido*). O que já estava na
  // linha continua lá — a decisão P-7 é sobre a proposta de ontem, não sobre a
  // montagem de hoje.
  const ativos = procedimentos.filter((p) => p.ativo)

  if (catalogo.carregando) return <Carregando linhas={3} />
  if (catalogo.erro !== null) {
    return <Erro mensagem={catalogo.erro} recarregar={catalogo.recarregar} />
  }
  if (ativos.length === 0) {
    return (
      <Vazio>
        <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhum procedimento ativo no catálogo.</p>
        <p className="nota" style={{ margin: 0 }}>
          Cadastre os procedimentos em <b>Configurações › Procedimentos</b> antes de montar
          programas — é de lá que vêm as sessões sugeridas, o intervalo e a dose.
        </p>
      </Vazio>
    )
  }

  const porId = new Map(procedimentos.map((p) => [p.id, p]))

  function trocarItem(k: number, troca: Partial<ItemNoMontador>) {
    aoMudar({
      ...estado,
      itens: estado.itens.map((x, i) => (i === k ? { ...x, ...troca } : x)),
    })
  }

  function acrescentar() {
    if (estado.itens.length >= MAXIMO_DE_ITENS) return
    aoMudar({
      ...estado,
      itens: [...estado.itens, itemDoProcedimento(undefined, `i${estado.itens.length + 1}`)],
    })
  }

  function remover(k: number) {
    if (estado.itens.length === 1) return
    // As chaves são RENUMERADAS, e o `depoisDe` que apontava para a removida é
    // limpo: um `depoisDe` órfão é 400 na borda, e deixar a tela montar um
    // corpo que o servidor recusa é fazer a recepção descobrir no envio.
    const sobraram = estado.itens.filter((_, i) => i !== k)
    const removida = estado.itens[k]!.chave
    aoMudar({
      ...estado,
      itens: sobraram.map((x, i) => ({
        ...x,
        chave: `i${i + 1}`,
        depoisDe: x.depoisDe === removida ? '' : x.depoisDe,
      })),
    })
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label className="campo" style={{ maxWidth: 260 }}>
        Data de início do programa
        <input
          type="date"
          className="num"
          value={estado.inicio}
          onChange={(e) => aoMudar({ ...estado, inicio: e.target.value })}
        />
      </label>

      {estado.itens.map((item, k) => (
        <LinhaDoItem
          key={item.chave}
          item={item}
          indice={k}
          total={estado.itens.length}
          ativos={ativos}
          equipe={equipe}
          podeValores={podeValores}
          aoTrocar={(troca) => trocarItem(k, troca)}
          aoRemover={() => remover(k)}
        />
      ))}

      {estado.itens.length >= MAXIMO_DE_ITENS ? (
        <p className="nota">Até {MAXIMO_DE_ITENS} procedimentos por programa.</p>
      ) : (
        <div>
          <button type="button" className="btn ghost" onClick={acrescentar}>
            + Adicionar procedimento
          </button>
        </div>
      )}

      <Previa estado={estado} porId={porId} />
    </div>
  )
}

function LinhaDoItem({
  item,
  indice,
  total,
  ativos,
  equipe,
  podeValores,
  aoTrocar,
  aoRemover,
}: {
  item: ItemNoMontador
  indice: number
  total: number
  ativos: readonly ProcedimentoNaLista[]
  equipe: readonly { readonly id: string; readonly nome: string }[]
  podeValores: boolean
  aoTrocar: (troca: Partial<ItemNoMontador>) => void
  aoRemover: () => void
}) {
  // `comeca` é derivado do par (`inicio`, `depoisDe`) — não um quarto estado.
  // Guardar um terceiro campo "modo" é como ele diverge dos dois que valem.
  const comeca = item.inicio !== '' ? 'data' : item.depoisDe !== '' ? 'depois' : 'inicio'

  return (
    <div className="item-montado">
      <div className="cabeca">
        <b>{indice + 1}. Procedimento</b>
        {total === 1 ? null : (
          <button type="button" className="link perigo" onClick={aoRemover}>
            Remover
          </button>
        )}
      </div>

      <div className="tres">
        <label className="campo">
          Procedimento
          <select
            value={item.procedimentoId}
            onChange={(e) => {
              // Trocar o procedimento TRAZ as sugestões do catálogo: sessões,
              // intervalo e responsável. É o que o protótipo faz, e é o que
              // torna "um toque" suficiente no caso comum.
              const p = ativos.find((x) => x.id === e.target.value)
              aoTrocar({
                procedimentoId: e.target.value,
                sessoes: p?.sessoesSugeridas ?? item.sessoes,
                intervaloDias: p?.intervaloSugeridoDias ?? item.intervaloDias,
                responsavelId: p?.responsavelId ?? item.responsavelId,
              })
            }}
          >
            <option value="">Escolha o procedimento</option>
            {ativos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="campo">
          Sessões
          <input
            type="number"
            className="num"
            min={1}
            max={104}
            value={item.sessoes}
            onChange={(e) => aoTrocar({ sessoes: Number(e.target.value) })}
          />
        </label>

        <label className="campo">
          Começa
          <select
            value={comeca}
            onChange={(e) => {
              if (e.target.value === 'inicio') aoTrocar({ inicio: '', depoisDe: '' })
              else if (e.target.value === 'depois') aoTrocar({ inicio: '', depoisDe: 'i1' })
              else aoTrocar({ inicio: '', depoisDe: '' })
            }}
          >
            <option value="inicio">Na data de início do programa</option>
            {indice === 0 ? null : <option value="depois">Depois de outro item</option>}
            <option value="data">Em outra data</option>
          </select>
        </label>

        {comeca === 'depois' ? (
          <label className="campo">
            Depois de qual item
            <select
              value={item.depoisDe}
              onChange={(e) => aoTrocar({ depoisDe: e.target.value })}
            >
              {Array.from({ length: indice }, (_, i) => `i${i + 1}`).map((c) => (
                <option key={c} value={c}>
                  Item {c.slice(1)}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {comeca === 'data' ? (
          <label className="campo">
            Data da primeira sessão
            <input
              type="date"
              className="num"
              value={item.inicio}
              onChange={(e) => aoTrocar({ inicio: e.target.value })}
            />
          </label>
        ) : null}
      </div>

      <details>
        <summary>Ajustar intervalo, dose, responsável e valor</summary>
        <div className="ajustes">
          <label className="campo">
            Intervalo entre sessões (dias)
            <input
              type="number"
              className="num"
              min={1}
              max={365}
              value={item.intervaloDias}
              onChange={(e) => aoTrocar({ intervaloDias: Number(e.target.value) })}
            />
          </label>

          {/*
            A DOSE MOSTRA A UNIDADE NO RÓTULO, sempre. Dose sem unidade é a
            origem da dose errada no frasco (regra 10) — e aqui a unidade vem
            do que a pessoa escrever, porque o campo é texto livre ("2,5 mg").
            O insumo de verdade, com a quantidade em milésimos, é do épico 6.
          */}
          <label className="campo">
            Dose por sessão <small>(com a unidade: 2,5 mg)</small>
            <input
              type="text"
              maxLength={60}
              value={item.dose}
              placeholder="Ex.: 2,5 mg"
              onChange={(e) => aoTrocar({ dose: e.target.value })}
            />
          </label>

          <label className="campo">
            Responsável pelas sessões
            <select
              value={item.responsavelId}
              onChange={(e) => aoTrocar({ responsavelId: e.target.value })}
            >
              <option value="">Padrão do procedimento</option>
              {equipe.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>

          {podeValores ? (
            <label className="campo">
              Valor deste item (R$) <small>(em branco: rateado do total)</small>
              <input
                type="text"
                inputMode="decimal"
                className="num"
                value={item.valor}
                placeholder="Ex.: 3.600,00"
                onChange={(e) => aoTrocar({ valor: e.target.value })}
              />
            </label>
          ) : null}

          <p className="nota" style={{ gridColumn: '1 / -1' }}>
            <b>O estoque entra em breve.</b> A baixa do insumo por sessão será automática quando o
            módulo Estoque existir; até lá a dose fica registrada no item.
          </p>
        </div>
      </details>
    </div>
  )
}

/**
 * **A prévia, calculada pelo DOMÍNIO.**
 *
 * `montarCronograma` é a mesma função que o montador do servidor chama para
 * escrever as sessões. Se ela recusa — ciclo, `depoisDe` órfão —, a prévia diz
 * o motivo **antes do envio**, com a mensagem do domínio. Reimplementar a
 * aritmética aqui faria a tela prometer uma agenda e o servidor escrever outra.
 */
function Previa({
  estado,
  porId,
}: {
  estado: EstadoDoMontador
  porId: ReadonlyMap<string, ProcedimentoNaLista>
}) {
  const completos = estado.itens.filter((x) => x.procedimentoId !== '')
  if (estado.inicio === '' || completos.length === 0) {
    return (
      <p className="previa-do-cronograma">
        Escolha o procedimento e a data de início para ver as sessões programadas.
      </p>
    )
  }

  const paraCronograma: ItemParaCronograma[] = completos.map((x) => ({
    chave: x.chave,
    sessoes: x.sessoes,
    intervaloDias: x.intervaloDias,
    inicio: x.inicio === '' ? null : x.inicio,
    depoisDe: x.depoisDe === '' ? null : x.depoisDe,
  }))

  const r = montarCronograma(estado.inicio, paraCronograma)
  if (ehErro(r)) {
    return (
      <p className="campo erro" role="alert">
        {r.erro.mensagem}
      </p>
    )
  }

  const total = r.valor.length
  return (
    <div className="previa-do-cronograma">
      {/* "12 sessões programadas" — o número já está na frase. O resumo do
          protótipo é exatamente este, e repeti-lo ao lado era ruído meu. */}
      <b>{plural(total, 'sessão programada', 'sessões programadas')}</b>
      {completos.map((x, i) => {
        const doItem = r.valor.filter((s) => s.itemChave === x.chave)
        const primeira = doItem[0]
        const ultima = doItem.at(-1)
        if (primeira === undefined || ultima === undefined) return null
        return (
          <div key={x.chave}>
            {i + 1}. {porId.get(x.procedimentoId)?.nome ?? 'Procedimento'} —{' '}
            {plural(doItem.length, 'sessão', 'sessões')}, de {diaEmTexto(primeira.prazo)} a{' '}
            {diaEmTexto(ultima.prazo)}
          </div>
        )
      })}
    </div>
  )
}
