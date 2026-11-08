'use client'

import type { RotinaCarteira, RotinaCarteiraSalvaSaida } from '@fir/contracts'
import { ROTINAS_PADRAO, textoDaFrequencia } from '@fir/domain'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import type { Pessoa } from './rotina-pecas'

/*
 * Os `as` nos `onChange` dos `<select>` estreitam `e.target.value` às opções
 * escritas logo abaixo, no mesmo componente; o servidor revalida tudo com o
 * contrato (`RotinaCarteiraEntrada`).
 */

type Frequencia = RotinaCarteira['frequencia']
type Formato = RotinaCarteira['escopoAplicacao']
type Servico = NonNullable<RotinaCarteira['servico']>
type Mensagem = NonNullable<RotinaCarteira['mensagem']>

type Form = {
  titulo: string
  responsavelUsuarioGestaoId: string
  prioridade: RotinaCarteira['prioridade']
  frequencia: Frequencia
  diaSemana: string
  diaUtil: string
  antecedencia: string
  escopoAplicacao: Formato
  servico: Servico | ''
  quemExecuta: RotinaCarteira['quemExecuta']
  mensagem: Mensagem | ''
  frentes: boolean
  envio: boolean
  passos: string
  ativa: boolean
}

const FREQUENCIAS: readonly [Frequencia, string][] = [
  ['semanal', 'Toda semana'],
  ['mensal', 'Todo mês'],
  ['diaria', 'Todo dia útil'],
  ['vencimento', 'Antes do vencimento de cada cliente'],
  ['reuniao', 'No dia da reunião fixa de cada cliente'],
]
const DIAS: readonly [string, string][] = [
  ['1', 'segunda'],
  ['2', 'terça'],
  ['3', 'quarta'],
  ['4', 'quinta'],
  ['5', 'sexta'],
]
const SERVICOS: readonly [Servico | '', string][] = [
  ['', 'Todos os clientes ativos'],
  ['semanal', 'Clientes com relatório semanal'],
  ['fluxo', 'Clientes com fluxo de caixa'],
  ['dre', 'Clientes com DRE'],
  ['pagamento', 'Clientes com mensalidade e vencimento'],
  ['metas', 'Clientes com metas em andamento'],
]
const MENSAGENS: readonly [Mensagem | '', string][] = [
  ['', 'Nenhuma'],
  ['pagamento', 'Lembrete de pagamento'],
  ['fluxo', 'Fluxo de caixa disponível'],
  ['dre', 'DRE atualizada'],
  ['formulario', 'Formulário semanal para o parceiro'],
  ['cobranca', 'Cobrança do formulário ao parceiro'],
  ['acessos', 'Acessos da cliente'],
  ['semanal', 'Relatório semanal atualizado'],
]

const daRotina = (r: RotinaCarteira | null, eu: string): Form => ({
  titulo: r?.titulo ?? '',
  responsavelUsuarioGestaoId: r?.responsavelUsuarioGestaoId ?? eu,
  prioridade: r?.prioridade ?? 'normal',
  frequencia: r?.frequencia ?? 'semanal',
  diaSemana: String(r?.diaSemana ?? 1),
  diaUtil: String(r?.diaUtil ?? 1),
  antecedencia: String(r?.antecedencia ?? 3),
  escopoAplicacao: r?.escopoAplicacao ?? 'global',
  servico: r?.servico ?? '',
  quemExecuta: r?.quemExecuta ?? 'responsavel_da_rotina',
  mensagem: r?.mensagem ?? '',
  frentes: r?.frentes ?? false,
  envio: r?.envio ?? false,
  passos: (r?.passos ?? []).join('\n'),
  ativa: r?.ativa ?? true,
})

/** Vencimento e reunião só existem uma por cliente (o servidor recusa o resto). */
const exigePorCliente = (f: Form): boolean => f.frequencia === 'vencimento' || f.frequencia === 'reuniao' || f.frentes || f.envio

const paraCorpo = (f: Form) => ({
  titulo: f.titulo,
  responsavelUsuarioGestaoId: f.responsavelUsuarioGestaoId || null,
  prioridade: f.prioridade,
  frequencia: f.frequencia,
  diaSemana: f.frequencia === 'semanal' ? Number(f.diaSemana) : null,
  diaUtil: f.frequencia === 'mensal' ? Number(f.diaUtil) : null,
  antecedencia: f.frequencia === 'vencimento' ? Number(f.antecedencia) : null,
  escopoAplicacao: exigePorCliente(f) ? 'por_cliente' : f.escopoAplicacao,
  servico: f.servico === '' ? null : f.servico,
  quemExecuta: f.quemExecuta,
  mensagem: f.mensagem === '' ? null : f.mensagem,
  frentes: f.frentes,
  envio: f.envio,
  passos: f.passos
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p !== ''),
  ativa: f.ativa,
})

/**
 * Nova rotina / Editar rotina (`fRotina`, L2776). Os campos que não valem
 * para a frequência escolhida somem (dia da semana só para semanal, dia útil
 * só para mensal, antecedência só para vencimento). O raro — mensagem, envio,
 * frentes, passos, quem executa — fica em "+ Mais opções".
 *
 * "Começar de um modelo" preenche com uma das seis rotinas padrão do
 * protótipo (R12, `rotinasPadrao` L848). Editar avisa que as tarefas futuras
 * abertas saem e voltam com os parâmetros novos (L2853).
 */
export function FormularioDeRotina({
  rotina,
  eu,
  pessoas,
  aoSalvar,
  aoExcluir,
  aoFechar,
}: {
  rotina: RotinaCarteira | null
  eu: string
  pessoas: readonly Pessoa[]
  aoSalvar: (r: RotinaCarteiraSalvaSaida, criada: boolean) => void
  aoExcluir: () => void
  aoFechar: () => void
}) {
  const [form, setForm] = useState<Form>(() => daRotina(rotina, eu))
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  function usarModelo(chave: string) {
    const m = ROTINAS_PADRAO.find((x) => x.chave === chave)
    if (m === undefined) return
    setForm({
      ...form,
      titulo: m.titulo,
      prioridade: m.prioridade,
      frequencia: m.frequencia,
      diaSemana: String(m.diaSemana ?? 1),
      diaUtil: String(m.diaUtil ?? 1),
      antecedencia: String(m.antecedencia ?? 3),
      escopoAplicacao: m.escopoAplicacao,
      servico: m.servico ?? '',
      mensagem: m.mensagem ?? '',
      frentes: m.frentes,
      envio: m.envio,
      passos: m.passos.join('\n'),
    })
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<RotinaCarteiraSalvaSaida>(
        rotina === null ? 'v1/carteira/rotinas-internas' : `v1/carteira/rotinas-internas/${rotina.id}`,
        { method: rotina === null ? 'POST' : 'PUT', body: JSON.stringify(paraCorpo(form)) },
      )
      aoSalvar(r, rotina === null)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  async function excluir() {
    if (rotina === null) return
    setErro('')
    setEnviando(true)
    try {
      await chamar<void>(`v1/carteira/rotinas-internas/${rotina.id}/excluir`, { method: 'POST' })
      aoExcluir()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  const porCliente = exigePorCliente(form) || form.escopoAplicacao === 'por_cliente'
  const previa = textoDaFrequencia({
    frequencia: form.frequencia,
    diaSemana: Number(form.diaSemana),
    diaUtil: Number(form.diaUtil),
    antecedencia: Number(form.antecedencia),
  })

  return (
    <section className="rot-int-formulario" aria-label={rotina === null ? 'Nova rotina' : 'Editar rotina'}>
      <h2 className="carteira-secao-titulo">{rotina === null ? 'Nova rotina' : 'Editar rotina'}</h2>
      <form className="carteira-form" onSubmit={salvar}>
        {rotina === null ? (
          <label className="campo">
            Começar de um modelo
            <select defaultValue="" onChange={(e) => usarModelo(e.target.value)}>
              <option value="">Em branco</option>
              {ROTINAS_PADRAO.map((m) => (
                <option key={m.chave} value={m.chave}>
                  {m.titulo}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="campo">
          O que fazer
          <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required maxLength={160} />
        </label>
        <div className="rot-int-duas">
          <label className="campo">
            Responsável
            <select value={form.responsavelUsuarioGestaoId} onChange={(e) => setForm({ ...form, responsavelUsuarioGestaoId: e.target.value })}>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Prioridade
            <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as Form['prioridade'] })}>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
            </select>
          </label>
        </div>
        <label className="campo">
          Frequência
          <select value={form.frequencia} onChange={(e) => setForm({ ...form, frequencia: e.target.value as Frequencia })}>
            {FREQUENCIAS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {form.frequencia === 'semanal' ? (
          <label className="campo">
            Dia da semana
            <select value={form.diaSemana} onChange={(e) => setForm({ ...form, diaSemana: e.target.value })}>
              {DIAS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {form.frequencia === 'mensal' ? (
          <label className="campo">
            Dia útil do mês
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={23}
              className="num"
              value={form.diaUtil}
              onChange={(e) => setForm({ ...form, diaUtil: e.target.value })}
              required
            />
            <span className="nota">1 = primeiro dia útil, 3 = terceiro dia útil</span>
          </label>
        ) : null}
        {form.frequencia === 'vencimento' ? (
          <label className="campo">
            Dias antes do vencimento
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={31}
              className="num"
              value={form.antecedencia}
              onChange={(e) => setForm({ ...form, antecedencia: e.target.value })}
              required
            />
          </label>
        ) : null}
        {exigePorCliente(form) ? (
          <p className="nota">Formato: uma tarefa para cada cliente.</p>
        ) : (
          <label className="campo">
            Formato
            <select value={form.escopoAplicacao} onChange={(e) => setForm({ ...form, escopoAplicacao: e.target.value as Formato })}>
              <option value="global">Tarefa simples</option>
              <option value="lista">Uma tarefa com a lista de clientes para marcar</option>
              <option value="por_cliente">Uma tarefa para cada cliente</option>
            </select>
          </label>
        )}
        {porCliente || form.escopoAplicacao === 'lista' ? (
          <label className="campo">
            Para quais clientes
            <select value={form.servico} onChange={(e) => setForm({ ...form, servico: e.target.value as Servico | '' })}>
              {SERVICOS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="nota rot-int-previa">{previa}</p>

        <details className="carteira-dobra carteira-dobra-mini" open={rotina !== null && (rotina.passos.length > 0 || rotina.mensagem !== null)}>
          <summary>+ Mais opções</summary>
          <div className="carteira-form">
            {porCliente ? (
              <label className="campo">
                Quem executa
                <select value={form.quemExecuta} onChange={(e) => setForm({ ...form, quemExecuta: e.target.value as Form['quemExecuta'] })}>
                  <option value="responsavel_da_rotina">A responsável da rotina</option>
                  <option value="responsavel_do_cliente">A responsável Firmare de cada cliente</option>
                </select>
              </label>
            ) : null}
            <label className="campo">
              Mensagem ao concluir
              <select value={form.mensagem} onChange={(e) => setForm({ ...form, mensagem: e.target.value as Mensagem | '' })}>
                {MENSAGENS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="check-marcar">
              <input type="checkbox" checked={form.envio} onChange={(e) => setForm({ ...form, envio: e.target.checked })} />
              Envio aos parceiros: um por parceiro de cada frente
            </label>
            <label className="check-marcar">
              <input type="checkbox" checked={form.frentes} onChange={(e) => setForm({ ...form, frentes: e.target.checked })} />
              Marcar frentes do relatório (financeiro, comercial, tráfego pago e marketing)
            </label>
            <label className="campo">
              Passo a passo (um por linha)
              <textarea value={form.passos} onChange={(e) => setForm({ ...form, passos: e.target.value })} rows={4} />
            </label>
            <label className="check-marcar">
              <input type="checkbox" checked={!form.ativa} onChange={(e) => setForm({ ...form, ativa: !e.target.checked })} />
              Pausada
            </label>
          </div>
        </details>

        {rotina !== null ? <p className="nota">Ao salvar, as tarefas futuras ainda abertas desta rotina saem e voltam com os dados novos.</p> : null}
        <p role="alert" aria-live="polite" className="erro">
          {erro}
        </p>
        <div className="carteira-acoes">
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="link" onClick={aoFechar}>
            Cancelar
          </button>
          {rotina !== null ? (
            excluindo ? (
              <span className="carteira-confirmar">
                Excluir a rotina e as tarefas abertas dela?
                <button type="button" className="btn ghost" disabled={enviando} onClick={() => void excluir()}>
                  Excluir
                </button>
                <button type="button" className="link" onClick={() => setExcluindo(false)}>
                  Voltar
                </button>
              </span>
            ) : (
              <button type="button" className="link rot-int-perigo" onClick={() => setExcluindo(true)}>
                Excluir rotina
              </button>
            )
          ) : null}
        </div>
      </form>
    </section>
  )
}
