'use client'

import type { ItemNaLista, TPacienteEncontrado } from '@fir/contracts'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { milesimosDoTexto } from '@/lib/quantidade'
import { SeletorDePaciente } from '../seletor-de-paciente'

/**
 * `movEstoque` pela tela — entrada e saída.
 *
 * **A SAÍDA tem quatro tipos, e a tela obriga a escolher um**: uso em
 * paciente, descarte, uso interno e ajuste. "Baixa" sozinha esconde qual dos
 * três, e é o termo proibido do `CONTEXT.md`.
 *
 * **A unidade é escolhida entre as DECLARADAS no cadastro** — nunca digitada.
 * Uma unidade que o item não declarou é 422 no servidor (regra 10), e oferecer
 * um campo de texto aqui seria convidar o erro que o servidor vai recusar.
 */

type Sub = 'entrada' | 'saida'
type TipoDeSaida = 'consumo' | 'descarte' | 'interno' | 'ajuste'

const ROTULO_DA_SAIDA: Record<TipoDeSaida, string> = {
  consumo: 'Uso em paciente',
  descarte: 'Descarte',
  interno: 'Uso interno ou cortesia',
  ajuste: 'Ajuste de estoque',
}

const MOTIVOS_DE_DESCARTE = ['Vencido', 'Avaria ou quebra', 'Sobra de frasco aberto', 'Outro']

export function FormularioDeMovimento({
  sub,
  itens,
  itemInicial,
  loteInicial,
  hoje,
  podeGerir,
  aoFechar,
  aoSalvar,
}: {
  sub: Sub
  itens: ItemNaLista[]
  itemInicial: ItemNaLista | null
  loteInicial: string | null
  hoje: string
  podeGerir: boolean
  aoFechar: () => void
  aoSalvar: (recado: string) => void
}) {
  const [itemId, setItemId] = useState(itemInicial?.id ?? '')
  const [tipo, setTipo] = useState<TipoDeSaida>('consumo')
  const [quantidade, setQuantidade] = useState('')
  const [unidade, setUnidade] = useState('')
  const [dia, setDia] = useState(hoje)
  const [lote, setLote] = useState(loteInicial ?? '')
  const [custo, setCusto] = useState('')
  const [motivo, setMotivo] = useState('Vencido')
  const [sentido, setSentido] = useState<'faltou' | 'sobrou'>('faltou')
  const [paciente, setPaciente] = useState<TPacienteEncontrado | null>(null)
  const [obs, setObs] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const item = itens.find((i) => i.id === itemId) ?? null
  // As unidades que o item DECLAROU, e só elas. A `medida` sempre; a de compra
  // na entrada (a nota vem em caixas); a de uso na saída (a dose vem em mg).
  const unidades = item === null
    ? []
    : [
        item.medida,
        ...(sub === 'entrada' && item.compra !== null ? [item.compra.unidade] : []),
        ...(sub === 'saida' && item.uso !== null ? [item.uso.unidade] : []),
      ]
  const unidadeEscolhida = unidades.includes(unidade) ? unidade : (unidades[0] ?? '')

  async function enviar(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setErro(null)
    if (item === null) {
      setErro('Escolha o item.')
      return
    }
    const q = milesimosDoTexto(quantidade)
    if (q === null || q <= 0n) {
      setErro('Informe a quantidade, maior que zero.')
      return
    }
    if (sub === 'saida' && tipo === 'consumo' && paciente === null) {
      // "Uso interno ou cortesia" é o tipo `interno`, que existe justamente
      // para a saída sem paciente — então um consumo sem paciente é lançamento
      // no tipo errado, não um caso de uso.
      setErro('Escolha a paciente, ou lance como uso interno.')
      return
    }

    const base = {
      itemId: item.id,
      quantidade: q.toString(),
      unidade: unidadeEscolhida,
      dia,
      obs: obs.trim(),
      ...(item.controlaValidade && lote !== '' ? { lote } : {}),
    }

    let corpo: Record<string, unknown>
    if (sub === 'entrada') {
      const c = custo.trim() === '' ? null : centavosDoTexto(custo)
      if (custo.trim() !== '' && c === null) {
        setErro('O custo está num formato que eu não reconheço. Use 450,00.')
        return
      }
      corpo = { ...base, tipo: 'entrada', ...(c === null ? {} : { custo: c.toString() }) }
    } else if (tipo === 'consumo') {
      corpo = { ...base, tipo: 'consumo', pacienteId: paciente?.id }
    } else if (tipo === 'ajuste') {
      corpo = { ...base, tipo: 'ajuste', sentido, motivo: motivo.trim() }
    } else {
      corpo = { ...base, tipo, motivo: motivo.trim() }
    }

    setSalvando(true)
    try {
      const r = await chamar<{ movimentos: { quantidade: { texto: string } }[] }>(
        'v1/estoque/movimentos',
        { method: 'POST', body: JSON.stringify(corpo) },
      )
      // DOIS movimentos quando o frasco aberto não aproveita a sobra (regra
      // 15): a confirmação diz os dois, senão a pessoa vê o estoque cair mais
      // do que a dose que ela lançou e não entende.
      aoSalvar(
        r.movimentos.length > 1
          ? `Registrado: ${r.movimentos.map((m) => m.quantidade.texto).join(' e ')} (a sobra do frasco foi descartada).`
          : `Registrado: ${r.movimentos[0]?.quantidade.texto ?? ''}.`,
      )
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form className="cartao" onSubmit={enviar} style={{ display: 'grid', gap: 12 }}>
      <h3>{sub === 'entrada' ? 'Registrar entrada' : 'Registrar saída'}</h3>

      <label className="campo">
        Item
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} required>
          <option value="">Selecione</option>
          {itens.map((i) => (
            <option key={i.id} value={i.id}>
              {i.nome}
            </option>
          ))}
        </select>
      </label>

      {sub === 'saida' ? (
        <div className="chips" role="group" aria-label="Tipo de saída">
          {(Object.keys(ROTULO_DA_SAIDA) as TipoDeSaida[])
            // O AJUSTE é da gestão: ele reescreve o saldo, e a regra 13 exige
            // motivo e `estoque.gerir`. O servidor recusa de novo.
            .filter((t) => t !== 'ajuste' || podeGerir)
            .map((t) => (
              <button key={t} type="button" aria-pressed={tipo === t} onClick={() => setTipo(t)}>
                {ROTULO_DA_SAIDA[t]}
              </button>
            ))}
        </div>
      ) : null}

      <div className="par">
        <label className="campo">
          Quantidade
          <input
            type="text"
            inputMode="decimal"
            required
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
          />
        </label>
        <label className="campo">
          Unidade
          <select
            value={unidadeEscolhida}
            onChange={(e) => setUnidade(e.target.value)}
            disabled={unidades.length <= 1}
          >
            {unidades.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <small>Só as unidades que este item declarou no cadastro.</small>
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Data
          <input
            type="date"
            max={hoje}
            required
            value={dia}
            onChange={(e) => setDia(e.target.value)}
          />
        </label>
        {item?.controlaValidade === true ? (
          <label className="campo">
            Validade (lote)
            <input type="date" value={lote} onChange={(e) => setLote(e.target.value)} />
            <small>
              {sub === 'entrada'
                ? 'Obrigatória na entrada: o FIFO não adivinha a validade do que chegou.'
                : 'Vazio = o que vence primeiro.'}
            </small>
          </label>
        ) : (
          <div />
        )}
      </div>

      {sub === 'entrada' && podeGerir ? (
        <label className="campo">
          Custo por {item?.medida ?? 'unidade'} (R$)
          <input
            type="text"
            inputMode="decimal"
            value={custo}
            onChange={(e) => setCusto(e.target.value)}
          />
        </label>
      ) : null}

      {sub === 'saida' && tipo === 'consumo' ? (
        <SeletorDePaciente escolhido={paciente} aoEscolher={setPaciente} />
      ) : null}

      {sub === 'saida' && tipo === 'descarte' ? (
        <label className="campo">
          Motivo
          <select value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            {MOTIVOS_DE_DESCARTE.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {sub === 'saida' && (tipo === 'interno' || tipo === 'ajuste') ? (
        <>
          {tipo === 'ajuste' ? (
            <div className="chips" role="group" aria-label="Sentido do ajuste">
              <button
                type="button"
                aria-pressed={sentido === 'faltou'}
                onClick={() => setSentido('faltou')}
              >
                Faltou no estoque
              </button>
              <button
                type="button"
                aria-pressed={sentido === 'sobrou'}
                onClick={() => setSentido('sobrou')}
              >
                Sobrou no estoque
              </button>
            </div>
          ) : null}
          <label className="campo">
            Motivo
            <input
              type="text"
              maxLength={40}
              required
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={tipo === 'ajuste' ? 'Ex.: erro de lançamento' : 'Ex.: amostra'}
            />
            <small>Obrigatório: sem ele, a diferença da análise deixa de ser explicável.</small>
          </label>
        </>
      ) : null}

      <label className="campo">
        Observação
        <input
          type="text"
          maxLength={120}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
        />
      </label>

      {erro !== null ? (
        <p className="erro" role="alert">
          {erro}
        </p>
      ) : null}

      <div className="botoes">
        <button type="submit" className="btn" disabled={salvando}>
          {salvando ? 'Registrando…' : 'Registrar'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
