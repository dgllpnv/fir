'use client'

import type {
  AtividadeDoPainel,
  AtividadesDoPainel,
  PessoaNoPainel,
  PessoasDoPainel,
} from '@fir/contracts'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Carregando, Vazio } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { usePainel } from '../contexto'
import { ErroDoPainel, NavDoPainel } from '../pecas'
import {
  ACOES,
  assuntoLegivel,
  ASSUNTOS,
  campoLegivel,
  quandoNaClinica,
  QUEM,
} from './rotulos'

/**
 * **ATIVIDADES** — o log do que a equipe fez, em todas as clínicas, com filtro
 * por clínica, pessoa, quem fez, ação, assunto e período.
 *
 * Vem da trilha de auditoria (regra 20), que o banco grava sozinho. A tela
 * mostra QUEM, QUANDO, ONDE e O QUÊ — e os nomes dos campos que mudaram,
 * nunca os valores: dinheiro, salário e dose não passam por aqui.
 */
type Filtros = {
  clinicaId: string
  pessoaId: string
  quem: string
  acao: string
  assunto: string
  de: string
  ate: string
}
const SEM_FILTRO: Filtros = {
  clinicaId: '',
  pessoaId: '',
  quem: '',
  acao: '',
  assunto: '',
  de: '',
  ate: '',
}

const montarConsulta = (f: Filtros, antes: string | null): string => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) if (v !== '') p.set(k, v)
  if (antes) p.set('antes', antes)
  const s = p.toString()
  return s ? `?${s}` : ''
}

const SEM_CONEXAO = 'Sem conexão com o servidor.'

export default function Atividades() {
  const { sessao } = usePainel()
  const clinicas = useMemo(() => (sessao.tag === 'pronta' ? sessao.clinicas : []), [sessao])
  const fusoDe = useMemo(() => new Map(clinicas.map((c) => [c.id, c.fuso])), [clinicas])

  const [f, setF] = useState<Filtros>(SEM_FILTRO)
  const [itens, setItens] = useState<AtividadeDoPainel[] | null>(null)
  const [proximo, setProximo] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [maisCarregando, setMaisCarregando] = useState(false)
  const [tentativa, setTentativa] = useState(0)
  const [pessoas, setPessoas] = useState<PessoaNoPainel[]>([])

  // A lista de pessoas só existe com uma clínica escolhida: "pessoa" sem
  // clínica seria misturar nomes de clínicas diferentes.
  useEffect(() => {
    if (f.clinicaId === '') {
      setPessoas([])
      return
    }
    let valeu = true
    chamar<PessoasDoPainel>(`v1/superadmin/clinicas/${f.clinicaId}/pessoas`)
      .then((r) => {
        if (valeu) setPessoas(r.itens)
      })
      .catch(() => {
        if (valeu) setPessoas([])
      })
    return () => {
      valeu = false
    }
  }, [f.clinicaId])

  useEffect(() => {
    let valeu = true
    setErro('')
    setItens(null)
    setProximo(null)
    chamar<AtividadesDoPainel>(`v1/superadmin/atividades${montarConsulta(f, null)}`)
      .then((r) => {
        if (!valeu) return
        setItens(r.itens)
        setProximo(r.proximo)
      })
      .catch((x: unknown) => {
        if (valeu) setErro(x instanceof ErroDaApi ? x.message : SEM_CONEXAO)
      })
    return () => {
      valeu = false
    }
  }, [f, tentativa])

  const maisAntigas = useCallback(async () => {
    if (proximo === null) return
    setMaisCarregando(true)
    try {
      const r = await chamar<AtividadesDoPainel>(
        `v1/superadmin/atividades${montarConsulta(f, proximo)}`,
      )
      setItens((atual) => [...(atual ?? []), ...r.itens])
      setProximo(r.proximo)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : SEM_CONEXAO)
    } finally {
      setMaisCarregando(false)
    }
  }, [f, proximo])

  const mudar = (parcial: Partial<Filtros>) => setF((a) => ({ ...a, ...parcial }))
  const filtrado = Object.values(f).some((v) => v !== '')

  return (
    <section>
      <NavDoPainel atual="/gestao/atividades" />

      <div className="titulo">
        <h2>Atividades</h2>
      </div>
      <p className="nota">
        Tudo o que a equipe fez nas clínicas, do mais recente para o mais antigo. Aparece quem fez,
        quando, em qual clínica e o que mudou — os valores e os dados dos pacientes não aparecem aqui.
      </p>

      <form className="superadmin-filtros" onSubmit={(e) => e.preventDefault()} aria-label="Filtros">
        <label className="campo">
          Clínica
          <select
            value={f.clinicaId}
            onChange={(e) => mudar({ clinicaId: e.target.value, pessoaId: '' })}
          >
            <option value="">Todas</option>
            {clinicas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Pessoa
          <select
            value={f.pessoaId}
            disabled={f.clinicaId === ''}
            onChange={(e) => mudar({ pessoaId: e.target.value })}
          >
            <option value="">{f.clinicaId === '' ? 'Escolha uma clínica' : 'Todas'}</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Quem fez
          <select value={f.quem} onChange={(e) => mudar({ quem: e.target.value })}>
            <option value="">Todos</option>
            {Object.entries(QUEM).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
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
          <input
            type="date"
            value={f.de}
            max={f.ate || undefined}
            onChange={(e) => mudar({ de: e.target.value })}
          />
        </label>
        <label className="campo">
          Até
          <input
            type="date"
            value={f.ate}
            min={f.de || undefined}
            onChange={(e) => mudar({ ate: e.target.value })}
          />
        </label>
        {filtrado && (
          <button type="button" className="btn ghost" onClick={() => setF(SEM_FILTRO)}>
            Limpar filtros
          </button>
        )}
      </form>

      {erro !== '' ? (
        <ErroDoPainel mensagem={erro} recarregar={() => setTentativa((n) => n + 1)} />
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
                <th>Clínica</th>
                <th>Quem</th>
                <th>O que fez</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((a) => (
                <tr key={a.chave}>
                  <td data-rotulo="Quando" className="num">
                    {quandoNaClinica(a.em, fusoDe.get(a.clinica.id) ?? 'America/Sao_Paulo')}
                  </td>
                  <td data-rotulo="Clínica">{a.clinica.nome}</td>
                  <td data-rotulo="Quem">
                    {a.quem.nome ?? (a.quem.tipo === 'equipe' ? 'Cadastro removido' : QUEM[a.quem.tipo])}
                    {(a.quem.nome !== null || a.quem.tipo === 'equipe') && (
                      <span className="muted">{QUEM[a.quem.tipo]}</span>
                    )}
                  </td>
                  <td data-rotulo="O que fez">
                    <b>{ACOES[a.acao]}</b> · {assuntoLegivel(a.assunto)}
                    {a.campos.length > 0 && (
                      <span className="muted">Mudou: {a.campos.map(campoLegivel).join(', ')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {proximo !== null && (
            <div className="superadmin-acoes-topo">
              <button
                type="button"
                className="btn ghost"
                disabled={maisCarregando}
                onClick={() => void maisAntigas()}
              >
                {maisCarregando ? 'Carregando…' : 'Ver mais antigas'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
