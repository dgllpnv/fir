'use client'

import type { KpiNaLista, PessoaDaEquipe } from '@fir/contracts'
import { useCallback, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import {
  CamposDaMeta,
  corpoDaMetaEditada,
  corpoDaMetaNova,
  erroDaMetaNoCampo,
  type ErrosDaMeta,
  estadoInicialDaMeta,
  validarEstadoDaMeta,
} from './campos-da-meta'
import { PainelLateral } from './painel-lateral'

/**
 * **D.3 — Nova meta** (ou "Definir meta" a partir do cartão). Com o KPI já
 * escolhido quando vem do cartão; com a meta vigente, edita-a (`PUT`): o
 * tipo e o início ficam como estão.
 */
export function FormularioDeMeta({
  kpis,
  kpiInicial,
  hoje,
  equipe,
  aoFechar,
  aoSalvo,
}: {
  kpis: readonly KpiNaLista[]
  kpiInicial: KpiNaLista | null
  hoje: string
  equipe: readonly PessoaDaEquipe[]
  aoFechar: () => void
  aoSalvo: (recado: string) => void
}) {
  const [kpiId, setKpiId] = useState(kpiInicial?.id ?? '')
  const kpi = kpis.find((k) => k.id === kpiId) ?? null
  const meta = kpi?.metaVigente ?? null
  const [estado, setEstado] = useState(() => estadoInicialDaMeta(kpiInicial, kpiInicial?.metaVigente ?? null, hoje))
  const [erros, setErros] = useState<ErrosDaMeta>({})
  const [erroDoKpi, setErroDoKpi] = useState<string | null>(null)
  const [erroGeral, setErroGeral] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const escolher = (id: string) => {
    setKpiId(id)
    const k = kpis.find((x) => x.id === id) ?? null
    setEstado(estadoInicialDaMeta(k, k?.metaVigente ?? null, hoje))
    setErros({})
    setErroDoKpi(null)
  }

  const salvar = useCallback(async () => {
    if (kpi === null) {
      setErroDoKpi('Escolha o indicador.')
      return
    }
    const e = validarEstadoDaMeta(estado, kpi, meta !== null)
    setErros(e)
    if (Object.keys(e).length > 0) return
    setSalvando(true)
    setErroGeral(null)
    try {
      if (meta === null) {
        await chamar('v1/indicadores/metas', { method: 'POST', body: JSON.stringify(corpoDaMetaNova(kpi, estado)) })
        aoSalvo('Meta criada.')
      } else {
        await chamar(`v1/indicadores/metas/${meta.id}`, { method: 'PUT', body: JSON.stringify(corpoDaMetaEditada(kpi, estado)) })
        aoSalvo('Meta atualizada.')
      }
    } catch (x) {
      // A recusa de um campo vai embaixo dele (1.9 D); só a que não é de campo fica no rodapé.
      const noCampo = x instanceof ErroDaApi ? erroDaMetaNoCampo(x.codigo, x.message, estado.tipo) : null
      if (noCampo !== null) setErros(noCampo)
      else setErroGeral(x instanceof ErroDaApi ? x.message : 'Não consegui salvar a meta. Confira a conexão.')
    } finally {
      setSalvando(false)
    }
  }, [kpi, meta, estado, aoSalvo])

  return (
    <PainelLateral
      titulo={meta === null ? 'Nova meta' : 'Editar meta'}
      aoFechar={aoFechar}
      aoSalvar={() => void salvar()}
      salvando={salvando}
    >
      <label className="campo">
        Indicador
        <select value={kpiId} aria-invalid={erroDoKpi !== null} onChange={(e) => escolher(e.target.value)}>
          <option value="">Escolha o indicador</option>
          {kpis.map((k) => (
            <option key={k.id} value={k.id}>
              {k.nome}
            </option>
          ))}
        </select>
        {erroDoKpi === null ? null : (
          <span className="erro" role="alert">
            {erroDoKpi}
          </span>
        )}
      </label>

      {kpi === null ? null : (
        <CamposDaMeta kpi={kpi} estado={estado} aoMudar={setEstado} erros={erros} equipe={equipe} editando={meta !== null} />
      )}

      {erroGeral === null ? null : (
        <p className="erro" role="alert" style={{ color: 'var(--bad)', margin: 0 }}>
          {erroGeral}
        </p>
      )}
    </PainelLateral>
  )
}
