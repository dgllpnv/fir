'use client'

import type { KpiNaLista, MetaDeKpiNaSaida, PessoaDaEquipe, PreviaDaMeta } from '@fir/contracts'
import { fimDoMes, trimestreDe } from '@fir/domain'
import { useEffect, useId, useState } from 'react'
import { chamar } from '@/lib/api'
import { consultaEmTexto, useEspera } from '@/lib/dados'
import { ErroDoCampo } from './painel-lateral'
import { EXEMPLO_DA_UNIDADE, fraseDaPrevia, menorUnidadeDoTexto, ROTULO_DA_UNIDADE, textoDoCampo } from './na-tela'

/**
 * **D.3 — os campos da meta**, usados pela "Nova meta" e pela caixa "Definir
 * meta agora" do D.1. Tipo, valor-alvo, início e prazo, valor de partida e
 * responsável — e a prévia ao vivo, cuja frase é montada aqui (appsec C8).
 *
 * Os tipos são "Do mês" e "Até uma data": são os dois que a rota de meta
 * aceita hoje (`CriarMetaDeKpi.tipo`). A meta recorrente existe no banco
 * (`series_de_meta`), mas ainda não tem rota de escrita.
 */

export type EstadoDaMeta = {
  readonly tipo: 'mes' | 'ate_data'
  /** `aaaa-mm`, no tipo "Do mês". */
  readonly mes: string
  readonly inicio: string
  readonly prazo: string
  readonly alvo: string
  readonly partida: string
  readonly responsavelId: string
}

/**
 * O que os campos precisam saber do KPI. `id` é `null` no D.1, antes de o
 * KPI existir: aí não há prévia (ela é medida pelo servidor sobre o KPI).
 */
export type KpiDaMeta = Pick<KpiNaLista, 'unidade' | 'agregacao' | 'responsavelId'> & {
  readonly id: string | null
  readonly atual: KpiNaLista['atual'] | null
}

export type ErrosDaMeta = Partial<Record<'alvo' | 'partida' | 'prazo' | 'mes', string>>

/** Soma começa do zero, sempre (I-17): o campo de partida fica travado. */
export const partidaTravada = (k: Pick<KpiNaLista, 'agregacao'>): boolean => k.agregacao === 'soma'

export function estadoInicialDaMeta(kpi: KpiDaMeta | null, meta: MetaDeKpiNaSaida | null, hoje: string): EstadoDaMeta {
  if (meta !== null) {
    return {
      tipo: meta.tipo === 'ate_data' ? 'ate_data' : 'mes',
      mes: meta.inicio.slice(0, 7),
      inicio: meta.inicio,
      prazo: meta.prazo,
      alvo: textoDoCampo(meta.alvo),
      partida: textoDoCampo(meta.partida),
      responsavelId: meta.responsavelId ?? '',
    }
  }
  return {
    tipo: 'mes',
    mes: hoje.slice(0, 7),
    inicio: hoje,
    prazo: trimestreDe(hoje).fim,
    alvo: '',
    partida: kpi === null || kpi.atual === null || partidaTravada(kpi) ? '' : textoDoCampo(kpi.atual),
    responsavelId: kpi?.responsavelId ?? '',
  }
}

/** Início e prazo como a rota os quer: "Do mês" é o mês civil inteiro. */
export function janelaDoEstado(e: EstadoDaMeta): { inicio: string; prazo: string } {
  if (e.tipo === 'mes') return { inicio: `${e.mes}-01`, prazo: fimDoMes(e.mes) }
  return { inicio: e.inicio, prazo: e.prazo }
}

export function validarEstadoDaMeta(e: EstadoDaMeta, kpi: KpiDaMeta, editando = false): ErrosDaMeta {
  const erros: ErrosDaMeta = {}
  if (e.tipo === 'mes' && !/^\d{4}-\d{2}$/.test(e.mes)) erros.mes = 'Escolha o mês.'
  if (e.tipo === 'ate_data') {
    if (e.inicio === '' || e.prazo === '') erros.prazo = 'Escolha o início e o prazo.'
    else if (e.prazo < e.inicio) erros.prazo = 'O prazo é antes do início.'
  }
  // Na edição, o alvo em branco fica como está (a rota só troca o que vem).
  const alvoEmBrancoNaEdicao = editando && e.alvo.trim() === ''
  if (!alvoEmBrancoNaEdicao && menorUnidadeDoTexto(kpi.unidade, e.alvo) === null) erros.alvo = 'Escreva o valor-alvo, só com números.'
  if (!partidaTravada(kpi) && e.partida.trim() !== '' && menorUnidadeDoTexto(kpi.unidade, e.partida) === null) {
    erros.partida = 'Escreva o valor de partida, só com números.'
  }
  return erros
}

export function CamposDaMeta({
  kpi,
  estado,
  aoMudar,
  erros,
  equipe,
  editando,
}: {
  kpi: KpiDaMeta
  estado: EstadoDaMeta
  aoMudar: (e: EstadoDaMeta) => void
  erros: ErrosDaMeta
  equipe: readonly PessoaDaEquipe[]
  /** Editando uma meta que existe: o tipo e o início não mudam (`EditarMetaDeKpi`). */
  editando: boolean
}) {
  const id = useId()
  const mudar = <K extends keyof EstadoDaMeta>(campo: K, valor: EstadoDaMeta[K]) => aoMudar({ ...estado, [campo]: valor })
  const unidade = ROTULO_DA_UNIDADE[kpi.unidade]

  return (
    <>
      {editando ? null : (
        <fieldset className="ii-grupo">
          <legend>Tipo</legend>
          <div className="ii-opcoes">
            {(
              [
                ['mes', 'Do mês'],
                ['ate_data', 'Até uma data'],
              ] as const
            ).map(([valor, rotulo]) => (
              <label key={valor}>
                <input
                  type="radio"
                  name={`${id}-tipo`}
                  checked={estado.tipo === valor}
                  onChange={() => mudar('tipo', valor)}
                />
                {rotulo}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="campo">
        Valor-alvo <small>({unidade})</small>
        <input
          inputMode="decimal"
          value={estado.alvo}
          placeholder={EXEMPLO_DA_UNIDADE[kpi.unidade]}
          aria-invalid={erros.alvo !== undefined}
          aria-describedby={erros.alvo === undefined ? undefined : `${id}-alvo`}
          onChange={(e) => mudar('alvo', e.target.value)}
        />
        <ErroDoCampo id={`${id}-alvo`} mensagem={erros.alvo} />
      </label>

      {estado.tipo === 'mes' ? (
        <label className="campo">
          Mês
          <input
            type="month"
            value={estado.mes}
            disabled={editando}
            aria-invalid={erros.mes !== undefined}
            onChange={(e) => mudar('mes', e.target.value)}
          />
          <ErroDoCampo id={`${id}-mes`} mensagem={erros.mes} />
        </label>
      ) : (
        <div className="par">
          <label className="campo">
            Início
            <input type="date" value={estado.inicio} disabled={editando} onChange={(e) => mudar('inicio', e.target.value)} />
          </label>
          <label className="campo">
            Prazo
            <input
              type="date"
              value={estado.prazo}
              aria-invalid={erros.prazo !== undefined}
              onChange={(e) => mudar('prazo', e.target.value)}
            />
            <ErroDoCampo id={`${id}-prazo`} mensagem={erros.prazo} />
          </label>
        </div>
      )}

      <label className="campo">
        Valor de partida
        {partidaTravada(kpi) ? (
          <>
            <input value="0" disabled readOnly />
            <small>Este indicador soma no período: começa sempre do zero.</small>
          </>
        ) : (
          <>
            <input
              inputMode="decimal"
              value={estado.partida}
              placeholder={EXEMPLO_DA_UNIDADE[kpi.unidade]}
              aria-invalid={erros.partida !== undefined}
              onChange={(e) => mudar('partida', e.target.value)}
            />
            <small>Vem com o valor de hoje; pode mudar.</small>
            <ErroDoCampo id={`${id}-partida`} mensagem={erros.partida} />
          </>
        )}
      </label>

      <label className="campo">
        Responsável
        <select value={estado.responsavelId} onChange={(e) => mudar('responsavelId', e.target.value)}>
          <option value="">Sem responsável</option>
          {equipe
            .filter((p) => p.ativo || p.id === estado.responsavelId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
        </select>
      </label>

      <PreviaAoVivo kpi={kpi} estado={estado} />
    </>
  )
}

/**
 * A prévia ao vivo (D.3, I-23). Pede ao servidor só os NÚMEROS — ritmo por
 * dia útil e o atual por dia útil — depois que a pessoa para de digitar, e
 * monta a frase com o formatador central. Sem o alvo legível, não pergunta
 * nada; com erro (inclusive 403 de quem não escreve em reais), cala.
 */
function PreviaAoVivo({ kpi, estado }: { kpi: KpiDaMeta; estado: EstadoDaMeta }) {
  const alvo = menorUnidadeDoTexto(kpi.unidade, estado.alvo)
  const partida = partidaTravada(kpi) ? null : menorUnidadeDoTexto(kpi.unidade, estado.partida)
  const { inicio, prazo } = janelaDoEstado(estado)
  const pronto = alvo !== null && /^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(prazo) && prazo >= inicio
  const caminho =
    pronto && kpi.id !== null
    ? `v1/indicadores/metas/previa${consultaEmTexto({
        kpiId: kpi.id,
        inicio,
        prazo,
        alvo: alvo.toString(),
        partida: partida === null ? undefined : partida.toString(),
      })}`
    : null
  const esperado = useEspera(caminho, 400)
  const [previa, setPrevia] = useState<{ caminho: string; dados: PreviaDaMeta } | null>(null)

  useEffect(() => {
    if (esperado === null) return
    let valeu = true
    chamar<PreviaDaMeta>(esperado)
      .then((r) => {
        if (valeu) setPrevia({ caminho: esperado, dados: r })
      })
      .catch(() => {
        if (valeu) setPrevia(null)
      })
    return () => {
      valeu = false
    }
  }, [esperado])

  if (caminho === null || previa === null || previa.caminho !== caminho || alvo === null) return null
  return (
    <p className="ii-previa" aria-live="polite">
      {fraseDaPrevia(previa.dados, { unidade: kpi.unidade, valor: alvo })}
    </p>
  )
}

/** O corpo de `POST /v1/indicadores/metas`. */
export function corpoDaMetaNova(kpi: Pick<KpiNaLista, 'id' | 'unidade' | 'agregacao'>, e: EstadoDaMeta) {
  const { inicio, prazo } = janelaDoEstado(e)
  const alvo = menorUnidadeDoTexto(kpi.unidade, e.alvo)
  const partida = partidaTravada(kpi) ? null : menorUnidadeDoTexto(kpi.unidade, e.partida)
  return {
    kpiId: kpi.id,
    tipo: e.tipo,
    inicio,
    prazo,
    alvo: (alvo ?? 0n).toString(),
    ...(partida === null ? {} : { partida: partida.toString() }),
    responsavelId: e.responsavelId === '' ? null : e.responsavelId,
  }
}

/** O corpo de `PUT /v1/indicadores/metas/:id`. */
export function corpoDaMetaEditada(kpi: Pick<KpiNaLista, 'unidade' | 'agregacao'>, e: EstadoDaMeta) {
  const { prazo } = janelaDoEstado(e)
  const alvo = menorUnidadeDoTexto(kpi.unidade, e.alvo)
  const partida = partidaTravada(kpi) ? null : menorUnidadeDoTexto(kpi.unidade, e.partida)
  return {
    ...(alvo === null ? {} : { alvo: alvo.toString() }),
    ...(partida === null ? {} : { partida: partida.toString() }),
    prazo,
    responsavelId: e.responsavelId === '' ? null : e.responsavelId,
  }
}
