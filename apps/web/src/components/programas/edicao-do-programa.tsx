'use client'

import type { ItemNaFicha, ListaDaEquipe, ProgramaEditadoNaSaida } from '@fir/contracts'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { plural } from '@/lib/formato'

/**
 * **Editar o programa — a fatia que não move dinheiro nem estoque** (D-15 b).
 *
 * Pedido da PO, decidido pelo dono. O protótipo **não responde** a este: ele
 * tem criar, encerrar e excluir adesão, e não tem editar. Então a tela precisa
 * dizer, por escrito, onde está a fronteira — senão a recepção abre a caixa
 * procurando o valor, não encontra, e conclui que a ferramenta está quebrada.
 *
 * **O que a caixa oferece.** A observação do programa, o rótulo da sessão e o
 * responsável de cada item. Trocar o responsável reaponta as sessões **em
 * aberto**, e a tela diz o número de volta: um "salvo" mudo deixaria a
 * recepção sem saber se as nove aplicações futuras mudaram de dono.
 *
 * **O que ela não oferece, e explica.** Valor, número de sessões, dose e
 * insumo. A frase na tela não é desculpa — ela aponta o caminho que existe
 * (encerrar e montar de novo), porque a usuária que não sabe o que fazer
 * depois do "não" acaba editando o que não devia em outro lugar.
 *
 * **A data de uma sessão não está aqui de propósito.** Ela é uma tarefa, e se
 * edita no cartão da sessão — pôr uma segunda forma de mexer na mesma data
 * criaria duas telas que discordam sobre a série.
 */
export function EdicaoDoPrograma({
  id,
  itens,
  observacao,
  aoMudar,
}: {
  id: string
  itens: readonly ItemNaFicha[]
  observacao: string
  aoMudar: (aviso: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [obs, setObs] = useState(observacao)
  /** `chave → { rotuloSessao, responsavelId }`, só do que a pessoa mexeu. */
  const [mexidos, setMexidos] = useState<Record<string, { rotulo: string; resp: string }>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const equipe = useDados<ListaDaEquipe>(aberto ? 'v1/equipe' : null)

  const campo = (i: ItemNaFicha) =>
    mexidos[i.chave] ?? { rotulo: i.rotuloSessao, resp: i.responsavelId }

  const mexer = (chave: string, parte: Partial<{ rotulo: string; resp: string }>) => {
    const atual = campo(itens.find((x) => x.chave === chave)!)
    setMexidos({ ...mexidos, [chave]: { ...atual, ...parte } })
  }

  function abrir() {
    // Reabrir descarta o rascunho e relê da ficha: um rascunho guardado entre
    // aberturas mostraria um valor que o servidor já não tem, se alguém salvou
    // na outra aba.
    setObs(observacao)
    setMexidos({})
    setErro(null)
    setAberto(true)
  }

  async function salvar() {
    setErro(null)

    // Só o que MUDOU entra no corpo. Mandar todo item em todo salvamento faria
    // um `UPDATE` em linhas que ninguém tocou — e cada um deles vira uma linha
    // na trilha de auditoria, que passaria a registrar edições que não houve.
    const alterados = itens
      .filter((i) => {
        const c = campo(i)
        return c.rotulo !== i.rotuloSessao || c.resp !== i.responsavelId
      })
      .map((i) => {
        const c = campo(i)
        return {
          chave: i.chave,
          ...(c.rotulo === i.rotuloSessao ? {} : { rotuloSessao: c.rotulo.trim() }),
          ...(c.resp === i.responsavelId ? {} : { responsavelId: c.resp }),
        }
      })

    const corpo = {
      ...(obs.trim() === observacao ? {} : { observacao: obs.trim() }),
      ...(alterados.length === 0 ? {} : { itens: alterados }),
    }
    if (Object.keys(corpo).length === 0) {
      setAberto(false)
      return
    }

    setOcupado(true)
    try {
      const r = await chamar<ProgramaEditadoNaSaida>(`v1/programas/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(corpo),
      })
      setAberto(false)
      aoMudar(
        r.sessoesRepontadas === 0
          ? 'Programa atualizado.'
          : `Programa atualizado · ${plural(
              r.sessoesRepontadas,
              'sessão em aberto passou',
              'sessões em aberto passaram',
            )} para o novo responsável.`,
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui salvar o programa.')
    } finally {
      setOcupado(false)
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="btn ghost" onClick={abrir}>
        Editar programa
      </button>
    )
  }

  return (
    <div className="painel" role="group" aria-label="Editar programa">
      <b>Editar programa</b>
      <p className="nota" style={{ marginTop: 4 }}>
        Aqui se corrige o que <b>não mexe em dinheiro nem em estoque</b>: a observação, o rótulo da
        sessão e quem é o responsável. Valor, número de sessões, dose e insumo não se editam — eles
        mudariam o saldo da paciente e o que já foi baixado do estoque. Para esses, encerre o
        programa e monte outro. A <b>data de uma sessão</b> se ajusta no cartão dela.
      </p>

      <label className="campo">
        Observação do programa <small>(opcional)</small>
        <textarea
          rows={2}
          maxLength={300}
          value={obs}
          placeholder="Ex.: dose reduzida a pedido da médica; viaja em janeiro"
          onChange={(e) => setObs(e.target.value)}
        />
      </label>

      {itens.map((i) => (
        <div key={i.chave} className="par">
          <label className="campo">
            Rótulo da sessão <small>({i.procedimentoNome})</small>
            <input
              type="text"
              maxLength={40}
              value={campo(i).rotulo}
              onChange={(e) => mexer(i.chave, { rotulo: e.target.value })}
            />
          </label>
          <label className="campo">
            Responsável
            <select
              value={campo(i).resp}
              onChange={(e) => mexer(i.chave, { resp: e.target.value })}
            >
              {/*
                A lista vem da equipe ATIVA. O responsável atual entra à força
                quando ele já saiu da clínica: sem isso o `select` mostraria
                outra pessoa como se fosse a de hoje, e salvar sem querer
                trocaria o dono de nove sessões.
              */}
              {(equipe.dados?.equipe ?? []).some((p) => p.id === i.responsavelId) ? null : (
                <option value={i.responsavelId}>{i.responsavelNome} (fora da equipe)</option>
              )}
              {(equipe.dados?.equipe ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={ocupado}>
          {ocupado ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => setAberto(false)}
          disabled={ocupado}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
