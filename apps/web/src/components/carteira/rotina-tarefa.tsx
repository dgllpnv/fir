'use client'

import type { ClienteCarteiraNaLista, TarefaCarteira, TarefaCarteiraSaida } from '@fir/contracts'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaMes, nomeDaPessoa, type Pessoa } from './rotina-pecas'

const RECORRENCIA: Record<TarefaCarteira['recorrencia'], string> = {
  nenhuma: '',
  diaria: 'todo dia',
  semanal: 'toda semana',
  mensal: 'todo mês',
}

const TIPO: Record<TarefaCarteira['tipo'], string | null> = {
  checklist: 'Checklist',
  rotina: 'Rotina',
  reuniao: 'Reunião',
  avulsa: null,
}

/**
 * Uma tarefa (`tarefaHTML`, L1889): o círculo conclui e reabre; o título abre
 * a edição; Transferir e Excluir ficam na linha de baixo. Os subitens (R5)
 * aparecem como caixas de marcar — marcar o último conclui no servidor.
 */
export function CartaoDeTarefa({
  tarefa,
  pessoas,
  aoMudar,
  aoAvisar,
  aoEditar,
}: {
  tarefa: TarefaCarteira
  pessoas: readonly Pessoa[]
  aoMudar: (tarefa: TarefaCarteira, proxima: TarefaCarteira | null) => void
  aoAvisar: (recado: string) => void
  aoEditar: (tarefa: TarefaCarteira) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [painel, setPainel] = useState<'nenhum' | 'transferir' | 'excluir'>('nenhum')
  const [para, setPara] = useState('')
  const feita = tarefa.status === 'concluida'

  async function enviar(caminho: string, corpo: unknown, recado: (r: TarefaCarteiraSaida) => string) {
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<TarefaCarteiraSaida>(caminho, { method: 'POST', body: JSON.stringify(corpo) })
      aoMudar(r.tarefa, r.proxima)
      aoAvisar(recado(r))
      setPainel('nenhum')
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível atualizar a tarefa.')
    } finally {
      setEnviando(false)
    }
  }

  const alternar = () =>
    void enviar(`v1/carteira/tarefas-internas/${tarefa.id}/status`, { status: feita ? 'pendente' : 'concluida' }, (r) =>
      feita ? 'Tarefa reaberta' : r.proxima !== null ? 'Concluída. Próxima criada' : 'Tarefa concluída',
    )

  const itensFeitos = tarefa.itens.filter((i) => i.feito).length
  const tipo = TIPO[tarefa.tipo]

  return (
    <div className={feita ? 'rot-int-tarefa rot-int-tarefa-feita' : 'rot-int-tarefa'}>
      <button
        type="button"
        className={feita ? 'rot-int-check rot-int-check-feito' : 'rot-int-check'}
        aria-label={feita ? `Reabrir: ${tarefa.titulo}` : `Concluir: ${tarefa.titulo}`}
        aria-pressed={feita}
        disabled={enviando}
        onClick={alternar}
      />
      <div className="rot-int-corpo">
        <button type="button" className="rot-int-titulo" onClick={() => aoEditar(tarefa)}>
          {tarefa.titulo}
        </button>
        <div className="rot-int-meta">
          <span>{tarefa.clienteNome ?? 'Interno'}</span>
          <span>{tarefa.responsavelNome ?? nomeDaPessoa(pessoas, tarefa.responsavelUsuarioGestaoId)}</span>
          {tipo !== null ? <span className="rot-int-ouro">{tipo}</span> : null}
          {tarefa.itens.length > 0 ? (
            <span className="num">
              {itensFeitos}/{tarefa.itens.length} {tarefa.itens.some((i) => i.frente !== null) ? 'frentes' : 'clientes'}
            </span>
          ) : null}
          {tarefa.recorrencia !== 'nenhuma' ? <span>Repete {RECORRENCIA[tarefa.recorrencia]}</span> : null}
          {tarefa.prioridade === 'alta' ? <span className="rot-int-alta">alta</span> : null}
          {tarefa.pagoAntes ? <span className="rot-int-ok">pago antes do lembrete</span> : null}
          {tarefa.transferidaDeUsuarioGestaoId !== null && !feita ? (
            <span>de {nomeDaPessoa(pessoas, tarefa.transferidaDeUsuarioGestaoId)}</span>
          ) : null}
          {!feita ? (
            <>
              <button type="button" className="link rot-int-mini" onClick={() => setPainel(painel === 'transferir' ? 'nenhum' : 'transferir')}>
                Transferir
              </button>
              <button type="button" className="link rot-int-mini" onClick={() => setPainel(painel === 'excluir' ? 'nenhum' : 'excluir')}>
                Excluir
              </button>
            </>
          ) : null}
        </div>

        {!feita && tarefa.itens.length > 0 ? (
          <div className="rot-int-itens">
            {tarefa.itens.map((i) => (
              <label key={i.id} className="rot-int-item">
                <input
                  type="checkbox"
                  checked={i.feito}
                  disabled={enviando}
                  onChange={(e) =>
                    void enviar(`v1/carteira/tarefas-internas/${tarefa.id}/itens/${i.id}`, { feito: e.target.checked }, (r) =>
                      r.tarefa.status === 'concluida' ? 'Todos conferidos. Tarefa concluída' : 'Marcado',
                    )
                  }
                />
                <span>{i.rotulo}</span>
              </label>
            ))}
          </div>
        ) : null}

        {painel === 'transferir' ? (
          <div className="rot-int-painel">
            <label className="campo">
              Passar para
              <select value={para} onChange={(e) => setPara(e.target.value)}>
                <option value="" disabled>
                  Escolha a pessoa
                </option>
                {pessoas
                  .filter((p) => p.id !== tarefa.responsavelUsuarioGestaoId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
              </select>
            </label>
            <div className="carteira-acoes">
              <button
                type="button"
                className="btn"
                disabled={enviando || para === ''}
                onClick={() =>
                  void enviar(`v1/carteira/tarefas-internas/${tarefa.id}/responsavel`, { responsavelUsuarioGestaoId: para }, () =>
                    `Tarefa passada para ${nomeDaPessoa(pessoas, para)}`,
                  )
                }
              >
                Transferir
              </button>
              <button type="button" className="link" onClick={() => setPainel('nenhum')}>
                Voltar
              </button>
            </div>
          </div>
        ) : null}

        {painel === 'excluir' ? (
          <div className="rot-int-painel carteira-confirmar">
            Excluir esta tarefa? Ela fica no histórico como cancelada.
            <button
              type="button"
              className="btn ghost"
              disabled={enviando}
              onClick={() => void enviar(`v1/carteira/tarefas-internas/${tarefa.id}/status`, { status: 'cancelada' }, () => 'Tarefa excluída')}
            >
              Excluir
            </button>
            <button type="button" className="link" onClick={() => setPainel('nenhum')}>
              Voltar
            </button>
          </div>
        ) : null}

        <p role="alert" aria-live="polite" className="erro">
          {erro}
        </p>
      </div>
      <div className={tarefa.secao === 'vencidas' ? 'rot-int-quando rot-int-atrasada num' : 'rot-int-quando num'}>
        {diaMes(tarefa.prazo)}
      </div>
    </div>
  )
}

type FormTarefa = {
  titulo: string
  clienteCarteiraId: string
  responsavelUsuarioGestaoId: string
  solicitanteUsuarioGestaoId: string
  prazo: string
  prioridade: TarefaCarteira['prioridade']
  recorrencia: TarefaCarteira['recorrencia']
  descricao: string
}

/**
 * Nova tarefa / Editar tarefa (`fTarefa`, L2769). O caminho curto é título,
 * cliente, responsável e prazo; solicitante, repetir e descrição ficam em
 * "+ Mais opções". O prazo padrão é o hoje do SERVIDOR (veio na lista).
 */
export function FormularioDeTarefa({
  tarefa,
  hoje,
  eu,
  pessoas,
  clientes,
  aoSalvar,
  aoFechar,
}: {
  tarefa: TarefaCarteira | null
  hoje: string
  eu: string
  pessoas: readonly Pessoa[]
  clientes: readonly ClienteCarteiraNaLista[]
  aoSalvar: (tarefa: TarefaCarteira, criada: boolean) => void
  aoFechar: () => void
}) {
  const [form, setForm] = useState<FormTarefa>(() => ({
    titulo: tarefa?.titulo ?? '',
    clienteCarteiraId: tarefa?.clienteCarteiraId ?? '',
    responsavelUsuarioGestaoId: tarefa?.responsavelUsuarioGestaoId ?? eu,
    solicitanteUsuarioGestaoId: tarefa?.solicitanteUsuarioGestaoId ?? eu,
    prazo: tarefa?.prazo ?? hoje,
    prioridade: tarefa?.prioridade ?? 'normal',
    recorrencia: tarefa?.recorrencia ?? 'nenhuma',
    descricao: tarefa?.descricao ?? '',
  }))
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const corpo = {
        titulo: form.titulo,
        clienteCarteiraId: form.clienteCarteiraId || null,
        responsavelUsuarioGestaoId: form.responsavelUsuarioGestaoId || null,
        solicitanteUsuarioGestaoId: form.solicitanteUsuarioGestaoId || null,
        leadComercialId: tarefa?.leadComercialId ?? null,
        prazo: form.prazo,
        prioridade: form.prioridade,
        recorrencia: form.recorrencia,
        descricao: form.descricao.trim() === '' ? null : form.descricao,
      }
      const r = await chamar<TarefaCarteiraSaida>(
        tarefa === null ? 'v1/carteira/tarefas-internas' : `v1/carteira/tarefas-internas/${tarefa.id}`,
        { method: tarefa === null ? 'POST' : 'PUT', body: JSON.stringify(corpo) },
      )
      aoSalvar(r.tarefa, tarefa === null)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="rot-int-formulario" aria-label={tarefa === null ? 'Nova tarefa' : 'Editar tarefa'}>
      <h2 className="carteira-secao-titulo">{tarefa === null ? 'Nova tarefa' : 'Editar tarefa'}</h2>
      <form className="carteira-form" onSubmit={salvar}>
        <label className="campo">
          Tarefa
          <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required maxLength={160} />
        </label>
        <label className="campo">
          Cliente
          <select value={form.clienteCarteiraId} onChange={(e) => setForm({ ...form, clienteCarteiraId: e.target.value })}>
            <option value="">Interno</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <div className="rot-int-duas">
          <label className="campo">
            Responsável
            <select
              value={form.responsavelUsuarioGestaoId}
              onChange={(e) => setForm({ ...form, responsavelUsuarioGestaoId: e.target.value })}
            >
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Prazo
            <input type="date" value={form.prazo} onChange={(e) => setForm({ ...form, prazo: e.target.value })} required />
          </label>
        </div>
        <label className="campo">
          Prioridade
          <select value={form.prioridade} onChange={(e) => setForm({ ...form, prioridade: e.target.value as FormTarefa['prioridade'] })}>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
            <option value="baixa">Baixa</option>
          </select>
        </label>
        <details className="carteira-dobra carteira-dobra-mini" open={tarefa !== null && (tarefa.recorrencia !== 'nenhuma' || tarefa.descricao !== null)}>
          <summary>+ Mais opções</summary>
          <div className="carteira-form">
            <label className="campo">
              Solicitante
              <select
                value={form.solicitanteUsuarioGestaoId}
                onChange={(e) => setForm({ ...form, solicitanteUsuarioGestaoId: e.target.value })}
              >
                {pessoas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              Repetir
              <select
                value={form.recorrencia}
                onChange={(e) => setForm({ ...form, recorrencia: e.target.value as FormTarefa['recorrencia'] })}
              >
                <option value="nenhuma">Não repetir</option>
                <option value="diaria">Todo dia</option>
                <option value="semanal">Toda semana</option>
                <option value="mensal">Todo mês</option>
              </select>
            </label>
            <label className="campo">
              Descrição
              <textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={3} maxLength={2000} />
            </label>
          </div>
        </details>
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
        </div>
      </form>
    </section>
  )
}

/** "O que você quer criar?" (R6, L2980): dois toques até o formulário certo. */
export function EscolhaTarefaOuRotina({ aoEscolher, aoFechar }: { aoEscolher: (o: 'tarefa' | 'rotina') => void; aoFechar: () => void }) {
  return (
    <section className="rot-int-escolha" aria-label="O que criar">
      <h2 className="carteira-secao-titulo">O que você quer criar?</h2>
      <button type="button" className="rot-int-opcao" onClick={() => aoEscolher('tarefa')}>
        <b>Tarefa única</b>
        <span>Algo para fazer uma vez, com prazo. Ex.: enviar proposta para um cliente.</span>
      </button>
      <button type="button" className="rot-int-opcao" onClick={() => aoEscolher('rotina')}>
        <b>Rotina</b>
        <span>Algo que se repete. Ex.: todo início de mês preparar a DRE, toda sexta enviar o formulário.</span>
      </button>
      <button type="button" className="link" onClick={aoFechar}>
        Cancelar
      </button>
    </section>
  )
}
