'use client'

import {
  AREAS_DE_FOCO,
  type ChecklistsDoMetodoSaida,
  type ItemDeModeloNaSaida,
  type ItemDeModeloSalvoSaida,
  type ModeloDeChecklistNaSaida,
  PRODUTOS_FIRMARE,
  type QuemExecutaItem,
} from '@fir/contracts'
import { ROTULO_DE_QUEM_EXECUTA } from '@fir/domain'
import { type FormEvent, useEffect, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira } from '../../pecas'

/**
 * **MÉTODO FIRMARE · CHECKLISTS DOS PROGRAMAS** (X3; protótipo
 * `corpoCad('modelos')` L2661–2665, `fItem` L2785, `novoModelo` L2945,
 * edição com propagação L2881–2884).
 *
 * Toda pessoa da carteira lê (é o passo a passo que vira tarefa no contrato
 * dela); só quem pode administrar edita — o servidor diz quem é
 * (`podeAdministrar`) e recusa o resto com 403.
 *
 * A tabela de quatro colunas do protótipo vira linhas empilhadas em 390 px.
 */

const QUEM: readonly QuemExecutaItem[] = ['responsavel', 'admin', 'comercial', 'administrativo', 'financeiro']

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; dados: ChecklistsDoMetodoSaida }
type Edicao =
  | { tag: 'nenhuma' }
  | { tag: 'modelo' }
  | { tag: 'novo-item'; modelo: ModeloDeChecklistNaSaida }
  | { tag: 'item'; modelo: ModeloDeChecklistNaSaida; item: ItemDeModeloNaSaida }

export default function ChecklistsDoMetodo() {
  const { sessao, recarregar } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [edicao, setEdicao] = useState<Edicao>({ tag: 'nenhuma' })
  const [recado, setRecado] = useState<string | null>(null)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void chamar<ChecklistsDoMetodoSaida>('v1/carteira/metodo/checklists')
      .then((dados) => valeu && setEstado({ tag: 'pronto', dados }))
      .catch(
        (e: unknown) =>
          valeu && setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar os checklists.' }),
      )
    return () => {
      valeu = false
    }
  }, [sessao.tag, tentativa])

  const cabeca = (
    <>
      <h1 className="titulo">Checklists dos programas</h1>
      <p className="check-mudo">O passo a passo de cada programa, que vira tarefas quando um contrato é cadastrado.</p>
    </>
  )

  if (sessao.tag === 'erro') {
    return (
      <section>
        {cabeca}
        <ErroDaCarteira mensagem={sessao.mensagem} recarregar={recarregar} />
      </section>
    )
  }
  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return (
      <section>
        {cabeca}
        <Carregando linhas={6} />
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section>
        {cabeca}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </section>
    )
  }

  const { modelos, podeAdministrar } = estado.dados
  const pronto = (texto: string) => {
    setEdicao({ tag: 'nenhuma' })
    setRecado(texto)
    setTentativa((n) => n + 1)
  }

  return (
    <section className="check">
      {cabeca}
      {podeAdministrar ? (
        <div>
          <button type="button" className="btn ghost" onClick={() => setEdicao({ tag: 'modelo' })}>
            Novo checklist (produto e frente)
          </button>
        </div>
      ) : null}
      {edicao.tag === 'modelo' ? <FormDoModelo aoCancelar={() => setEdicao({ tag: 'nenhuma' })} aoSalvar={pronto} /> : null}

      {modelos.length === 0 ? (
        <p className="check-vazio">
          Nenhum checklist cadastrado. Sem checklist, um contrato novo não gera tarefas: crie o do produto acima.
        </p>
      ) : null}

      {modelos.map((m) => (
        <section key={m.id} className="check-painel" aria-label={m.rotulo}>
          <div className="check-cabeca">
            <h2 className="check-titulo">{m.rotulo}</h2>
            <span className="check-mudo num">{m.itens.length} itens</span>
            {podeAdministrar ? (
              <button type="button" className="btn ghost check-direita" onClick={() => setEdicao({ tag: 'novo-item', modelo: m })}>
                Adicionar item
              </button>
            ) : null}
          </div>
          {edicao.tag === 'novo-item' && edicao.modelo.id === m.id ? (
            <FormDoItem modelo={m} item={null} aoCancelar={() => setEdicao({ tag: 'nenhuma' })} aoSalvar={pronto} />
          ) : null}
          {m.itens.length === 0 ? <p className="check-vazio">Nenhum item.</p> : null}
          <ul className="check-modelo">
            {m.itens.map((it) =>
              edicao.tag === 'item' && edicao.item.id === it.id ? (
                <li key={it.id}>
                  <FormDoItem modelo={m} item={it} aoCancelar={() => setEdicao({ tag: 'nenhuma' })} aoSalvar={pronto} />
                </li>
              ) : (
                <li key={it.id} className="check-modelo-item">
                  <span className="check-dias num">D+{it.dias}</span>
                  <span className="check-item-titulo">{it.titulo}</span>
                  <span className="check-meta">
                    {ROTULO_DE_QUEM_EXECUTA[it.quem]}
                    {it.acao === 'diagnostico' ? <span className="conteudo-chip conteudo-chip-ouro">abre o briefing</span> : null}
                  </span>
                  {podeAdministrar ? (
                    <button type="button" className="link check-direita" onClick={() => setEdicao({ tag: 'item', modelo: m, item: it })}>
                      Editar
                    </button>
                  ) : null}
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
      <p className="check-mudo">
        D+5 significa 5 dias após a data de início do contrato. Quando existe um checklist para o produto e a frente (por
        exemplo "Acelerador FIR · Comercial"), ele é usado no lugar do checklist geral do produto. Mudanças valem para os
        próximos clientes; o título editado também atualiza as tarefas ainda abertas.
      </p>
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function FormDoModelo({ aoCancelar, aoSalvar }: { aoCancelar: () => void; aoSalvar: (r: string) => void }) {
  const [produto, setProduto] = useState<string>(PRODUTOS_FIRMARE[0])
  const [frente, setFrente] = useState<string>('')
  const [erro, setErro] = useState<string | null>(null)
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await chamar('v1/carteira/metodo/checklists', {
        method: 'POST',
        body: JSON.stringify({ produto, areaFoco: frente === '' ? null : frente }),
      })
      aoSalvar('Checklist criado. Adicione os itens')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível criar o checklist.')
    }
  }
  return (
    <form className="conteudo-form" onSubmit={(e) => void enviar(e)}>
      <h2 className="check-titulo">Novo checklist</h2>
      <label className="campo">
        Produto
        <select value={produto} onChange={(e) => setProduto(e.target.value)}>
          {PRODUTOS_FIRMARE.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="campo">
        Frente
        <select value={frente} onChange={(e) => setFrente(e.target.value)}>
          <option value="">Geral do produto</option>
          {AREAS_DE_FOCO.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      {erro ? <p className="check-atrasado" role="alert">{erro}</p> : null}
      <div className="check-rodape">
        <button type="button" className="btn ghost" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="btn">
          Criar checklist
        </button>
      </div>
    </form>
  )
}

function FormDoItem({
  modelo,
  item,
  aoCancelar,
  aoSalvar,
}: {
  modelo: ModeloDeChecklistNaSaida
  item: ItemDeModeloNaSaida | null
  aoCancelar: () => void
  aoSalvar: (r: string) => void
}) {
  const [titulo, setTitulo] = useState(item?.titulo ?? '')
  const [dias, setDias] = useState(String(item?.dias ?? 0))
  const [quem, setQuem] = useState<QuemExecutaItem>(item?.quem ?? 'responsavel')
  const [briefing, setBriefing] = useState(item?.acao === 'diagnostico')
  const [erro, setErro] = useState<string | null>(null)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (!/^\d{1,3}$/.test(dias.trim())) {
      setErro('O prazo é um número inteiro de dias, de 0 a 730.')
      return
    }
    const corpo = { titulo, dias: Number(dias.trim()), quem, acao: briefing ? 'diagnostico' : null }
    try {
      if (item === null) {
        await chamar(`v1/carteira/metodo/checklists/${modelo.id}/itens`, { method: 'POST', body: JSON.stringify(corpo) })
        aoSalvar('Item adicionado')
      } else {
        const r = await chamar<ItemDeModeloSalvoSaida>(`v1/carteira/metodo/checklists/itens/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify(corpo),
        })
        aoSalvar(
          r.tarefasAtualizadas > 0
            ? `Item salvo. ${r.tarefasAtualizadas} tarefa${r.tarefasAtualizadas > 1 ? 's' : ''} em aberto atualizada${r.tarefasAtualizadas > 1 ? 's' : ''}`
            : 'Item salvo',
        )
      }
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível salvar o item.')
    }
  }
  const arquivar = async () => {
    if (item === null) return
    try {
      await chamar<void>(`v1/carteira/metodo/checklists/itens/${item.id}/arquivar`, { method: 'POST' })
      aoSalvar('Item removido do checklist. As tarefas já geradas continuam na rotina')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível remover o item.')
    }
  }

  return (
    <form className="conteudo-form" onSubmit={(e) => void enviar(e)}>
      <h3 className="check-titulo">
        {item === null ? 'Novo item' : 'Editar item'} · {modelo.rotulo}
      </h3>
      <label className="campo">
        Item do checklist
        <input value={titulo} required maxLength={300} onChange={(e) => setTitulo(e.target.value)} />
      </label>
      <label className="campo">
        Prazo em dias após o início do contrato
        <input inputMode="numeric" className="num" value={dias} onChange={(e) => setDias(e.target.value)} />
      </label>
      <label className="campo">
        Quem executa
        <select value={quem} onChange={(e) => setQuem(e.target.value as QuemExecutaItem /* valor vem das opções abaixo, todas de QUEM */)}>
          {QUEM.map((q) => (
            <option key={q} value={q}>
              {ROTULO_DE_QUEM_EXECUTA[q]}
            </option>
          ))}
        </select>
      </label>
      <label className="check-marcar">
        <input type="checkbox" checked={briefing} onChange={(e) => setBriefing(e.target.checked)} />
        Este item abre o roteiro de briefing
      </label>
      {erro ? <p className="check-atrasado" role="alert">{erro}</p> : null}
      <div className="check-rodape">
        {item !== null ? (
          <button type="button" className="btn ghost conteudo-perigo" onClick={() => void arquivar()}>
            Remover
          </button>
        ) : null}
        <span className="conteudo-espaco" />
        <button type="button" className="btn ghost" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="btn">
          Salvar
        </button>
      </div>
    </form>
  )
}
