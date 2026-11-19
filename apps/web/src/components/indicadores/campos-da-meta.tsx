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
 * Os tipos são os três da D.3: "Do mês", "Até uma data" e "Todo mês
 * (recorrente)". A recorrente (I-24) é uma série: o mês escolhido é o
 * primeiro, cada mês é um mês civil inteiro com o mesmo alvo, e cada um parte
 * do zero — a rota recusa partida (422), então o campo fica travado em 0 e a
 * partida não vai no corpo. Os meses seguintes o servidor cria sozinho.
 */

export type EstadoDaMeta = {
  readonly tipo: TipoDaMetaNaTela
  /** `aaaa-mm`, nos tipos "Do mês" e "Todo mês" (o primeiro mês da série). */
  readonly mes: string
  readonly inicio: string
  readonly prazo: string
  readonly alvo: string
  readonly partida: string
  readonly responsavelId: string
}

/**
 * O que os campos precisam saber do KPI. `id` é `null` no D.1, antes de o
 * KPI existir: aí a prévia é pedida pela `chave` do catálogo (o servidor
 * mede o atual como na linha do catálogo) ou, no manual — e no catálogo com
 * parâmetro, que a prévia não mede —, só pela unidade, e traz só o ritmo.
 */
export type KpiDaMeta = Pick<KpiNaLista, 'unidade' | 'agregacao' | 'responsavelId'> & {
  readonly id: string | null
  /** A chave do catálogo do KPI que ainda vai nascer; sem ela, a prévia vai pela unidade. */
  readonly chave?: KpiNaLista['chave'] | undefined
  readonly atual: KpiNaLista['atual'] | null
}

export type TipoDaMetaNaTela = 'mes' | 'ate_data' | 'recorrente'

/** Mês civil inteiro: "Do mês" e "Todo mês" escolhem o mês, não as datas. */
export const tipoPorMes = (tipo: TipoDaMetaNaTela): boolean => tipo === 'mes' || tipo === 'recorrente'

export const OPCOES_DE_TIPO_DA_META: readonly (readonly [TipoDaMetaNaTela, string])[] = [
  ['mes', 'Do mês'],
  ['ate_data', 'Até uma data'],
  ['recorrente', 'Todo mês (recorrente)'],
]

export type ErrosDaMeta = Partial<Record<'tipo' | 'alvo' | 'partida' | 'prazo' | 'mes', string>>

/**
 * O campo de cada recusa da meta que vem do servidor (422), pelo CÓDIGO do
 * domínio (`validarMeta`) — nunca pelo texto. É o que põe o erro em vermelho
 * embaixo do campo (1.9 D), e não no fim do formulário. Código sem campo
 * (ou erro sem código) fica de fora: cai no rodapé.
 */
const CAMPO_DO_CODIGO_DA_META: Readonly<Record<string, keyof ErrosDaMeta>> = {
  DataInvalida: 'prazo',
  PrazoAntesDoInicio: 'prazo',
  MetaDoMesForaDoMes: 'mes',
  ResultadoDoMesSoMesCivil: 'tipo',
  UnidadeDaMetaDiferente: 'alvo',
  ValorForaDoDominio: 'alvo',
  AlvoPiorQueAPartida: 'alvo',
  PartidaDaSomaNaoEZero: 'partida',
  PartidaNaRecorrente: 'partida',
}

/**
 * A recusa do servidor no campo da meta, ou `null` se ela não é de campo.
 * "Do mês" e "Todo mês" não mostram início e prazo — mostram o mês —, e o
 * erro de data vai para ele.
 */
export function erroDaMetaNoCampo(codigo: string | undefined, mensagem: string, tipo: TipoDaMetaNaTela): ErrosDaMeta | null {
  const campo = codigo === undefined ? undefined : CAMPO_DO_CODIGO_DA_META[codigo]
  if (campo === undefined) return null
  return { [campo === 'prazo' && tipoPorMes(tipo) ? 'mes' : campo]: mensagem }
}

/** Soma começa do zero, sempre (I-17): o campo de partida fica travado. */
export const partidaTravada = (k: Pick<KpiNaLista, 'agregacao'>): boolean => k.agregacao === 'soma'

/** A partida que a tela manda: nenhuma quando é soma (I-17) ou série (I-24, cada mês parte do zero). */
const semPartida = (k: Pick<KpiNaLista, 'agregacao'>, e: Pick<EstadoDaMeta, 'tipo'>): boolean =>
  partidaTravada(k) || e.tipo === 'recorrente'

export function estadoInicialDaMeta(kpi: KpiDaMeta | null, meta: MetaDeKpiNaSaida | null, hoje: string): EstadoDaMeta {
  if (meta !== null) {
    return {
      tipo: meta.tipo,
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
  if (tipoPorMes(e.tipo)) return { inicio: `${e.mes}-01`, prazo: fimDoMes(e.mes) }
  return { inicio: e.inicio, prazo: e.prazo }
}

export function validarEstadoDaMeta(e: EstadoDaMeta, kpi: KpiDaMeta, editando = false): ErrosDaMeta {
  const erros: ErrosDaMeta = {}
  if (tipoPorMes(e.tipo) && !/^\d{4}-\d{2}$/.test(e.mes)) erros.mes = 'Escolha o mês.'
  if (e.tipo === 'ate_data') {
    if (e.inicio === '' || e.prazo === '') erros.prazo = 'Escolha o início e o prazo.'
    else if (e.prazo < e.inicio) erros.prazo = 'O prazo é antes do início.'
  }
  // Na edição, o alvo em branco fica como está (a rota só troca o que vem).
  const alvoEmBrancoNaEdicao = editando && e.alvo.trim() === ''
  if (!alvoEmBrancoNaEdicao && menorUnidadeDoTexto(kpi.unidade, e.alvo) === null) erros.alvo = 'Escreva o valor-alvo, só com números.'
  if (!semPartida(kpi, e) && e.partida.trim() !== '' && menorUnidadeDoTexto(kpi.unidade, e.partida) === null) {
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
            {OPCOES_DE_TIPO_DA_META.map(([valor, rotulo]) => (
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
          <ErroDoCampo id={`${id}-tipo`} mensagem={erros.tipo} />
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

      {tipoPorMes(estado.tipo) ? (
        <label className="campo">
          {estado.tipo === 'recorrente' ? 'A partir de' : 'Mês'}
          <input
            type="month"
            value={estado.mes}
            disabled={editando}
            aria-invalid={erros.mes !== undefined}
            onChange={(e) => mudar('mes', e.target.value)}
          />
          {estado.tipo === 'recorrente' ? (
            <small>{editando ? 'Vale só para este mês; os outros meses da série seguem o alvo dela.' : 'Os meses seguintes nascem sozinhos, com o mesmo alvo.'}</small>
          ) : null}
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
        {semPartida(kpi, estado) ? (
          <>
            <input value="0" disabled readOnly />
            <small>
              {estado.tipo === 'recorrente'
                ? 'Cada mês da série começa do zero.'
                : 'Este indicador soma no período: começa sempre do zero.'}
            </small>
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
            <small>{estado.partida.trim() === '' ? 'Em branco, parte do valor de hoje.' : 'Vem com o valor de hoje; pode mudar.'}</small>
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
  const partida = semPartida(kpi, estado) ? null : menorUnidadeDoTexto(kpi.unidade, estado.partida)
  const { inicio, prazo } = janelaDoEstado(estado)
  const pronto = alvo !== null && /^\d{4}-\d{2}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}-\d{2}$/.test(prazo) && prazo >= inicio
  // Um dos três, nesta ordem: o KPI que existe, a chave do catálogo, a unidade (D.1).
  const doKpi =
    kpi.id !== null
      ? { kpiId: kpi.id }
      : kpi.chave !== null && kpi.chave !== undefined
        ? { chave: kpi.chave }
        : { unidade: kpi.unidade }
  const caminho =
    pronto
    ? `v1/indicadores/metas/previa${consultaEmTexto({
        ...doKpi,
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
  const partida = semPartida(kpi, e) ? null : menorUnidadeDoTexto(kpi.unidade, e.partida)
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
  const partida = semPartida(kpi, e) ? null : menorUnidadeDoTexto(kpi.unidade, e.partida)
  return {
    ...(alvo === null ? {} : { alvo: alvo.toString() }),
    ...(partida === null ? {} : { partida: partida.toString() }),
    prazo,
    responsavelId: e.responsavelId === '' ? null : e.responsavelId,
  }
}
