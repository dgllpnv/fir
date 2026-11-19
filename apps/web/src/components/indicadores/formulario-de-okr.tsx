'use client'

import {
  AVISO_DO_TEXTO_DO_OKR,
  CODIGO_PRAZO_DO_KR_FORA_DO_PERIODO,
  ErroDePrazoDoKr,
  type KpiNaLista,
  LIMITES_DO_OKR,
  type OkrNaSaida,
  type PessoaDaEquipe,
} from '@fir/contracts'
import { avisoDeKrs, MAXIMO_DE_KRS, trimestreDe } from '@fir/domain'
import { useCallback, useId, useRef, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaCompleto, EXEMPLO_DA_UNIDADE, menorUnidadeDoTexto, ROTULO_DA_UNIDADE, textoDoCampo, trimestresDesde } from './na-tela'
import { ErroDoCampo, PainelLateral } from './painel-lateral'

type LinhaDeKr = {
  readonly chave: number
  readonly id: string | null
  readonly kpiId: string
  readonly alvo: string
  readonly travado: boolean
  /** O prazo digitado. Só vale com `prazoProprio`; sem ele, o campo mostra o fim do período e o acompanha. */
  readonly prazo: string
  readonly prazoProprio: boolean
}

type Erros = Partial<Record<'objetivo' | 'krs' | 'datas', string>> & {
  porKr?: Record<number, string>
  prazoPorKr?: Record<number, string>
}

/**
 * **D.2 — Novo OKR** (e "Editar OKR"). Objetivo, período (trimestre atual por
 * padrão, ou datas livres), responsável, de 1 a 5 resultados-chave com o
 * aviso acima de 4, e o "por que isso importa".
 *
 * O prazo de cada resultado-chave (backlog 1.9 D.2) nasce no fim do período
 * e o acompanha enquanto a pessoa não o mexe; mexido, fica. Quem confere se
 * ele cabe no período é o servidor (422 `PRAZO_DO_KR_FORA_DO_PERIODO`, com a
 * posição do KR), e a mensagem vai embaixo do campo. O progresso do OKR é do
 * servidor, nunca daqui.
 *
 * `objetivo` e `porque` levam o aviso fixo dos textos livres (LGPD R-e).
 */
export function FormularioDeOkr({
  okr,
  kpis,
  hoje,
  equipe,
  aoFechar,
  aoSalvo,
  aoCriarKpi,
  inativo,
}: {
  okr: OkrNaSaida | null
  kpis: readonly KpiNaLista[]
  hoje: string
  equipe: readonly PessoaDaEquipe[]
  aoFechar: () => void
  aoSalvo: (recado: string) => void
  /** "criar KPI": abre o D.1 por cima; o KPI novo entra na lista quando ele fecha. */
  aoCriarKpi: () => void
  /** O D.1 está aberto por cima. */
  inativo: boolean
}) {
  const id = useId()
  const proxima = useRef(0)
  const nova = (kpiId = ''): LinhaDeKr => ({
    chave: proxima.current++,
    id: null,
    kpiId,
    alvo: '',
    travado: false,
    prazo: '',
    prazoProprio: false,
  })

  const trimestres = trimestresDesde(hoje)
  const [objetivo, setObjetivo] = useState(okr?.objetivo ?? '')
  const [porque, setPorque] = useState(okr?.porque ?? '')
  const [tipo, setTipo] = useState<'trimestre' | 'datas'>(okr?.periodo.tipo ?? 'trimestre')
  const [trimestre, setTrimestre] = useState(okr?.periodo.tipo === 'trimestre' ? okr.periodo.inicio : trimestreDe(hoje).inicio)
  const [inicio, setInicio] = useState(okr?.periodo.tipo === 'datas' ? okr.periodo.inicio : hoje)
  const [fim, setFim] = useState(okr?.periodo.tipo === 'datas' ? okr.periodo.fim : trimestreDe(hoje).fim)
  const [responsavelId, setResponsavelId] = useState(okr?.responsavelId ?? '')
  const [krs, setKrs] = useState<readonly LinhaDeKr[]>(() =>
    okr === null
      ? [nova()]
      : okr.resultadosChave.map((kr) => ({
          chave: proxima.current++,
          id: kr.id,
          kpiId: kr.kpi.id,
          alvo: textoDoCampo(kr.metaDoKr.alvo),
          travado: kr.alvoTravado,
          prazo: kr.metaDoKr.prazo,
          // O mesmo critério do servidor: prazo igual ao fim do período é o padrão, e acompanha.
          prazoProprio: kr.metaDoKr.prazo !== okr.periodo.fim,
        })),
  )
  const [erros, setErros] = useState<Erros>({})
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const inicioDoPeriodo = tipo === 'trimestre' ? trimestre : inicio
  const fimDoPeriodo = tipo === 'trimestre' ? trimestreDe(trimestre).fim : fim
  const prazoDe = (kr: LinhaDeKr) => (kr.prazoProprio ? kr.prazo : fimDoPeriodo)
  const opcoesDeTrimestre =
    okr !== null && okr.periodo.tipo === 'trimestre' && !trimestres.some((t) => t.inicio === okr.periodo.inicio)
      ? [{ inicio: okr.periodo.inicio, fim: okr.periodo.fim, rotulo: `${diaCompleto(okr.periodo.inicio)} a ${diaCompleto(okr.periodo.fim)}` }, ...trimestres]
      : trimestres

  const mudarKr = (chave: number, mudanca: Partial<LinhaDeKr>) =>
    setKrs((xs) => xs.map((x) => (x.chave === chave ? { ...x, ...mudanca } : x)))

  const salvar = useCallback(async () => {
    const e: Erros = {}
    const porKr: Record<number, string> = {}
    const prazoPorKr: Record<number, string> = {}
    if (objetivo.trim() === '') e.objetivo = 'Escreva o objetivo.'
    if (tipo === 'datas' && (inicio === '' || fim === '' || fim < inicio)) e.datas = 'Escolha um início e um fim depois dele.'
    if (krs.length === 0) e.krs = 'Um OKR tem pelo menos um resultado-chave.'
    const corpoDosKrs: { id?: string; kpiId: string; alvo?: string; prazo: string }[] = []
    for (const kr of krs) {
      const k = kpis.find((x) => x.id === kr.kpiId)
      if (k === undefined) {
        porKr[kr.chave] = 'Escolha o indicador.'
        continue
      }
      const alvo = kr.travado || k.chave === 'resultado_de_campanha' ? null : menorUnidadeDoTexto(k.unidade, kr.alvo)
      const podeFicarEmBranco = kr.travado || k.chave === 'resultado_de_campanha' || (kr.id !== null && kr.alvo.trim() === '')
      if (alvo === null && !podeFicarEmBranco) porKr[kr.chave] = 'Escreva o valor-alvo, só com números.'
      const prazo = kr.prazoProprio ? kr.prazo : fimDoPeriodo
      if (prazo === '') prazoPorKr[kr.chave] = 'Escolha o prazo.'
      corpoDosKrs.push({ ...(kr.id === null ? {} : { id: kr.id }), kpiId: k.id, ...(alvo === null ? {} : { alvo: alvo.toString() }), prazo })
    }
    if (Object.keys(porKr).length > 0) e.porKr = porKr
    if (Object.keys(prazoPorKr).length > 0) e.prazoPorKr = prazoPorKr
    setErros(e)
    if (Object.keys(e).length > 0) return

    const corpo = {
      objetivo: objetivo.trim(),
      porque,
      periodo: tipo === 'trimestre' ? { tipo: 'trimestre', inicio: trimestre } : { tipo: 'datas', inicio, fim },
      responsavelId: responsavelId === '' ? null : responsavelId,
      resultadosChave: corpoDosKrs,
    }
    setSalvando(true)
    setErroGeral(null)
    try {
      if (okr === null) {
        await chamar('v1/indicadores/okrs', { method: 'POST', body: JSON.stringify(corpo) })
        aoSalvo('OKR criado.')
      } else {
        await chamar(`v1/indicadores/okrs/${okr.id}`, { method: 'PUT', body: JSON.stringify(corpo) })
        aoSalvo('OKR atualizado.')
      }
    } catch (x) {
      // O prazo fora do período vai embaixo do campo do KR: a lista do corpo tem a ordem de `krs`.
      const doPrazo = x instanceof ErroDaApi && x.codigo === CODIGO_PRAZO_DO_KR_FORA_DO_PERIODO ? ErroDePrazoDoKr.safeParse(x.corpo) : null
      const linha = doPrazo?.success === true ? krs[doPrazo.data.indice] : undefined
      if (x instanceof ErroDaApi && linha !== undefined) setErros({ prazoPorKr: { [linha.chave]: x.message } })
      else setErroGeral(x instanceof ErroDaApi ? x.message : 'Não consegui salvar o OKR. Confira a conexão.')
    } finally {
      setSalvando(false)
    }
  }, [objetivo, porque, tipo, trimestre, inicio, fim, responsavelId, krs, kpis, okr, aoSalvo, fimDoPeriodo])

  return (
    <PainelLateral titulo={okr === null ? 'Novo OKR' : 'Editar OKR'} aoFechar={aoFechar} aoSalvar={() => void salvar()} salvando={salvando} inativo={inativo}>
      <label className="campo">
        Objetivo
        <input
          value={objetivo}
          maxLength={LIMITES_DO_OKR.objetivo.max}
          placeholder="ex.: Ter uma agenda previsível"
          aria-invalid={erros.objetivo !== undefined}
          aria-describedby={`${id}-obj-dica`}
          onChange={(e) => setObjetivo(e.target.value)}
        />
        <small id={`${id}-obj-dica`}>Escreva o que a clínica quer conquistar, em linguagem de dono.</small>
        <small className="ii-aviso-texto">{AVISO_DO_TEXTO_DO_OKR}</small>
        <ErroDoCampo id={`${id}-obj`} mensagem={erros.objetivo} />
      </label>

      <fieldset className="ii-grupo">
        <legend>Período</legend>
        <div className="ii-opcoes">
          <label>
            <input type="radio" name={`${id}-per`} checked={tipo === 'trimestre'} onChange={() => setTipo('trimestre')} />
            Trimestre
          </label>
          <label>
            <input type="radio" name={`${id}-per`} checked={tipo === 'datas'} onChange={() => setTipo('datas')} />
            Datas livres
          </label>
        </div>
        {tipo === 'trimestre' ? (
          <label className="campo">
            <span className="sr-apenas">Trimestre</span>
            <select value={trimestre} onChange={(e) => setTrimestre(e.target.value)}>
              {opcoesDeTrimestre.map((t) => (
                <option key={t.inicio} value={t.inicio}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="par">
            <label className="campo">
              Início
              <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            </label>
            <label className="campo">
              Fim
              <input type="date" value={fim} aria-invalid={erros.datas !== undefined} onChange={(e) => setFim(e.target.value)} />
              <ErroDoCampo id={`${id}-datas`} mensagem={erros.datas} />
            </label>
          </div>
        )}
      </fieldset>

      <label className="campo">
        Responsável
        <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
          <option value="">Sem responsável</option>
          {equipe
            .filter((p) => p.ativo || p.id === responsavelId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
        </select>
      </label>

      <fieldset className="ii-grupo">
        <legend>Resultados-chave</legend>
        {krs.map((kr, i) => {
          const k = kpis.find((x) => x.id === kr.kpiId) ?? null
          const travado = kr.travado || k?.chave === 'resultado_de_campanha'
          const usados = new Set(krs.filter((x) => x.chave !== kr.chave).map((x) => x.kpiId))
          return (
            <div key={kr.chave} className="ii-kr">
              <label className="campo">
                Indicador {i + 1}
                <select
                  value={kr.kpiId}
                  disabled={kr.id !== null}
                  onChange={(e) => mudarKr(kr.chave, { kpiId: e.target.value, alvo: '' })}
                >
                  <option value="">Escolha um KPI</option>
                  {kpis
                    .filter((x) => !usados.has(x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.nome}
                      </option>
                    ))}
                </select>
              </label>
              <div className="par">
                <label className="campo">
                  Valor-alvo {k === null ? null : <small>({ROTULO_DA_UNIDADE[k.unidade]})</small>}
                  {travado ? (
                    <input value="a meta da campanha" disabled readOnly />
                  ) : (
                    <input
                      inputMode="decimal"
                      value={kr.alvo}
                      placeholder={k === null ? '' : EXEMPLO_DA_UNIDADE[k.unidade]}
                      aria-invalid={erros.porKr?.[kr.chave] !== undefined}
                      onChange={(e) => mudarKr(kr.chave, { alvo: e.target.value })}
                    />
                  )}
                </label>
                <label className="campo">
                  Prazo
                  <input
                    type="date"
                    value={prazoDe(kr)}
                    min={inicioDoPeriodo}
                    max={fimDoPeriodo}
                    aria-invalid={erros.prazoPorKr?.[kr.chave] !== undefined}
                    aria-describedby={erros.prazoPorKr?.[kr.chave] === undefined ? undefined : `${id}-prazo-${kr.chave}`}
                    onChange={(e) => mudarKr(kr.chave, { prazo: e.target.value, prazoProprio: true })}
                  />
                  <ErroDoCampo id={`${id}-prazo-${kr.chave}`} mensagem={erros.prazoPorKr?.[kr.chave]} />
                </label>
              </div>
              <button
                type="button"
                className="link perigo"
                onClick={() => setKrs((xs) => xs.filter((x) => x.chave !== kr.chave))}
                aria-label={`Remover o resultado-chave ${i + 1}`}
              >
                Remover
              </button>
              <ErroDoCampo id={`${id}-kr-${kr.chave}`} mensagem={erros.porKr?.[kr.chave]} />
            </div>
          )
        })}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px' }}>
          <button
            type="button"
            className="link"
            style={{ minHeight: 44 }}
            disabled={krs.length >= MAXIMO_DE_KRS}
            onClick={() => setKrs((xs) => [...xs, nova()])}
          >
            + Adicionar resultado-chave
          </button>
          <button type="button" className="link" style={{ minHeight: 44 }} onClick={aoCriarKpi}>
            criar KPI
          </button>
        </div>
        {avisoDeKrs(krs.length) ? <p className="ii-aviso-krs">Recomendado: até 4 resultados-chave.</p> : null}
        <ErroDoCampo id={`${id}-krs`} mensagem={erros.krs} />
      </fieldset>

      <label className="campo">
        Por que isso importa <small>(opcional, aparece no Modo reunião)</small>
        <textarea rows={3} value={porque} maxLength={LIMITES_DO_OKR.porque.max} onChange={(e) => setPorque(e.target.value)} />
        <small className="ii-aviso-texto">{AVISO_DO_TEXTO_DO_OKR}</small>
      </label>

      {erroGeral === null ? null : (
        <p role="alert" style={{ color: 'var(--bad)', margin: 0 }}>
          {erroGeral}
        </p>
      )}
    </PainelLateral>
  )
}
