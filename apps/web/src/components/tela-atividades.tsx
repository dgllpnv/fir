'use client'

import type { AtividadeDaClinica, AtividadesDaClinica, ListaDePessoas } from '@fir/contracts'
import { useCallback, useEffect, useState } from 'react'
import {
  ACOES,
  assuntoLegivel,
  ASSUNTOS,
  campoLegivel,
  quandoNaClinica,
  QUEM,
} from '@/app/gestao/atividades/rotulos'
import { chamar, ErroDaApi } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { idCurto } from '@/lib/motivo-de-suporte'
import { Carregando, Vazio } from './estados'

/**
 * **ATIVIDADES** — o que a equipe fez NESTA clínica, para quem administra.
 *
 * Vem da trilha de auditoria (regra 20). Mostra quem, quando e o que mudou —
 * e os NOMES dos campos, nunca os valores: dinheiro, salário e dose não passam
 * por aqui. A clínica é a da sessão; não há como ver a de outra.
 */
type Filtros = { pessoaId: string; quem: string; acao: string; assunto: string; de: string; ate: string }
const SEM_FILTRO: Filtros = { pessoaId: '', quem: '', acao: '', assunto: '', de: '', ate: '' }

const consulta = (f: Filtros, antes: string | null): string => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v !== '') p.set(k, v)
  if (antes) p.set('antes', antes)
  const s = p.toString()
  return s ? `?${s}` : ''
}

const QUEM_NA_CLINICA: Readonly<Record<string, string>> = { ...QUEM, superadmin: 'Suporte Firmare' }

export function TelaAtividades({ fuso }: { fuso: string }) {
  const [f, setF] = useState<Filtros>(SEM_FILTRO)
  const [itens, setItens] = useState<AtividadeDaClinica[] | null>(null)
  const [proximo, setProximo] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const pessoas = useDados<ListaDePessoas>('v1/pessoas')

  useEffect(() => {
    let valeu = true
    setErro('')
    setItens(null)
    setProximo(null)
    chamar<AtividadesDaClinica>(`v1/atividades${consulta(f, null)}`)
      .then((r) => {
        if (!valeu) return
        setItens(r.itens)
        setProximo(r.proximo)
      })
      .catch((x: unknown) => {
        if (valeu) setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      })
    return () => {
      valeu = false
    }
  }, [f, tentativa])

  const maisAntigas = useCallback(async () => {
    if (proximo === null) return
    setCarregandoMais(true)
    try {
      const r = await chamar<AtividadesDaClinica>(`v1/atividades${consulta(f, proximo)}`)
      setItens((a) => [...(a ?? []), ...r.itens])
      setProximo(r.proximo)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setCarregandoMais(false)
    }
  }, [f, proximo])

  const mudar = (p: Partial<Filtros>) => setF((a) => ({ ...a, ...p }))
  const filtrado = Object.values(f).some((v) => v !== '')

  return (
    <section>
      <div className="titulo">
        <h2>Atividades</h2>
      </div>
      <p className="nota">
        Tudo o que a equipe fez nesta clínica, do mais recente para o mais antigo. Aparece quem fez,
        quando e o que mudou — os valores e os dados dos pacientes não aparecem aqui.
      </p>

      <form className="superadmin-filtros" onSubmit={(e) => e.preventDefault()} aria-label="Filtros">
        <label className="campo">
          Pessoa
          <select value={f.pessoaId} onChange={(e) => mudar({ pessoaId: e.target.value })}>
            <option value="">Todas</option>
            {(pessoas.dados?.pessoas ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Ação
          <select value={f.acao} onChange={(e) => mudar({ acao: e.target.value })}>
            <option value="">Todas</option>
            {Object.entries(ACOES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Assunto
          <select value={f.assunto} onChange={(e) => mudar({ assunto: e.target.value })}>
            <option value="">Todos</option>
            {Object.keys(ASSUNTOS)
              .sort((a, b) => assuntoLegivel(a).localeCompare(assuntoLegivel(b), 'pt-BR'))
              .map((k) => (
                <option key={k} value={k}>
                  {assuntoLegivel(k)}
                </option>
              ))}
          </select>
        </label>
        <label className="campo">
          De
          <input type="date" value={f.de} max={f.ate || undefined} onChange={(e) => mudar({ de: e.target.value })} />
        </label>
        <label className="campo">
          Até
          <input type="date" value={f.ate} min={f.de || undefined} onChange={(e) => mudar({ ate: e.target.value })} />
        </label>
        {filtrado && (
          <button type="button" className="btn ghost" onClick={() => setF(SEM_FILTRO)}>
            Limpar filtros
          </button>
        )}
      </form>

      {erro !== '' ? (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>{' '}
          <button type="button" className="btn ghost" onClick={() => setTentativa((n) => n + 1)}>
            Tentar de novo
          </button>
        </p>
      ) : itens === null ? (
        <Carregando linhas={5} fino />
      ) : itens.length === 0 ? (
        <Vazio>
          <b>Nenhuma atividade{filtrado ? ' com esses filtros' : ' ainda'}.</b>
        </Vazio>
      ) : (
        <>
          <table className="superadmin-lista superadmin-atividades">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>O que fez</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((a) => (
                <tr key={a.chave}>
                  <td data-rotulo="Quando" className="num">
                    {quandoNaClinica(a.em, fuso)}
                  </td>
                  <td data-rotulo="Quem">
                    {a.quem.nome ?? (a.quem.tipo === 'equipe' ? 'Cadastro removido' : QUEM_NA_CLINICA[a.quem.tipo])}
                    {(a.quem.nome !== null || a.quem.tipo === 'equipe') && (
                      <span className="muted">{QUEM_NA_CLINICA[a.quem.tipo]}</span>
                    )}
                  </td>
                  <td data-rotulo="O que fez">
                    <b>{ACOES[a.acao]}</b> · {assuntoLegivel(a.assunto)}
                    {a.campos.length > 0 && (
                      <span className="muted">Mudou: {a.campos.map(campoLegivel).join(', ')}</span>
                    )}
                    {a.quem.tipo === 'superadmin' && idCurto(a.entidadeId) !== null && (
                      <span className="muted">
                        Registro: <span className="num">{idCurto(a.entidadeId)}</span>
                      </span>
                    )}
                    {a.quem.tipo === 'superadmin' && a.motivo !== null && a.motivo !== '' && (
                      <span className="muted">Motivo: {a.motivo}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {proximo !== null && (
            <div className="superadmin-acoes-topo">
              <button type="button" className="btn ghost" disabled={carregandoMais} onClick={() => void maisAntigas()}>
                {carregandoMais ? 'Carregando…' : 'Ver mais antigas'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
