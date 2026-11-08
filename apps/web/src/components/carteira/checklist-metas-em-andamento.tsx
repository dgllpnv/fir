'use client'

import type { LinhaDeMetaEmAndamento, MetasEmAndamentoSalvasSaida, PassoDaEntradaSaida } from '@fir/contracts'
import { type ChangeEvent, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import {
  type LinhaDigitada,
  type UnidadeDigitada,
  lerMetasDoCsv,
  linhaEmBranco,
  linhaVazia,
  metaDaLinha,
} from './checklist-metas-csv'

/**
 * **"METAS EM ANDAMENTO"** — passo 2 de 3 da entrada de quem já era cliente
 * (C6, `abrirMetasMig` L1762–1769, `migMetasSalvar` L2908, `migMetasDepois`
 * L2906).
 *
 * A tabela editável do protótipo, mais "Importar de CSV": o arquivo é lido
 * AQUI, no navegador (`lerMetasDoCsv`), e preenche a tabela — onde ainda dá
 * para corrigir. O servidor recebe só as linhas já convertidas para o
 * contrato. A chave do lote nasce quando a tela abre: o duplo clique e o
 * retry reenviam a MESMA chave e o servidor devolve o que já gravou (A-20).
 */
const UNIDADES: readonly UnidadeDigitada[] = ['R$', '%', 'un', 'dias']

export function MetasEmAndamento({
  clienteId,
  nomeDoCliente,
  passoAPasso,
  aoTerminar,
}: {
  clienteId: string
  nomeDoCliente: string
  passoAPasso: boolean
  aoTerminar: (recado: string) => void
}) {
  const [linhas, setLinhas] = useState<LinhaDigitada[]>([linhaVazia()])
  const [chave] = useState(() => crypto.randomUUID())
  const [avisos, setAvisos] = useState<string[]>([])
  const [ocupado, setOcupado] = useState(false)

  const mudar = (i: number, campo: keyof LinhaDigitada, valor: string) =>
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)))

  const importar = async (e: ChangeEvent<HTMLInputElement>) => {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    const r = lerMetasDoCsv(await arquivo.text())
    if (r.erro) {
      setAvisos([r.erro])
      return
    }
    setLinhas((ls) => [...ls.filter((l) => !linhaEmBranco(l)), ...r.linhas])
    setAvisos([
      `${r.linhas.length} meta${r.linhas.length === 1 ? '' : 's'} lida${r.linhas.length === 1 ? '' : 's'} do arquivo.`,
      ...r.recusadas.map((x) => `Linha ${x.linha} recusada: ${x.motivo}.`),
    ])
  }

  const salvar = async () => {
    const preenchidas = linhas.map((l, i) => ({ l, i })).filter(({ l }) => !linhaEmBranco(l))
    if (preenchidas.length === 0) {
      setAvisos(['Preencha ao menos uma meta com o nome e o alvo.'])
      return
    }
    const metas: LinhaDeMetaEmAndamento[] = []
    const erros: string[] = []
    for (const { l, i } of preenchidas) {
      const r = metaDaLinha(l)
      if (r.ok) metas.push(r.meta)
      else erros.push(`Meta ${i + 1}: ${r.motivo}.`)
    }
    if (erros.length > 0) {
      setAvisos(erros)
      return
    }
    setOcupado(true)
    try {
      const r = await chamar<MetasEmAndamentoSalvasSaida>(`v1/carteira/clientes/${clienteId}/entrada/metas`, {
        method: 'POST',
        body: JSON.stringify({ chaveIdempotencia: chave, metas }),
      })
      aoTerminar(`${r.criadas} meta${r.criadas === 1 ? '' : 's'} cadastrada${r.criadas === 1 ? '' : 's'}`)
    } catch (e) {
      setAvisos([e instanceof ErroDaApi ? e.message : 'Não foi possível salvar as metas.'])
    } finally {
      setOcupado(false)
    }
  }

  const depois = async () => {
    setOcupado(true)
    try {
      await chamar<PassoDaEntradaSaida>(`v1/carteira/clientes/${clienteId}/entrada/metas/depois`, { method: 'POST' })
      aoTerminar('Ficou uma tarefa para cadastrar as metas')
    } catch (e) {
      setAvisos([e instanceof ErroDaApi ? e.message : 'Não foi possível registrar.'])
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section className="check-painel" aria-labelledby="check-metas-titulo">
      <div>
        <p className="check-sobretitulo">
          {nomeDoCliente}
          {passoAPasso ? ' · passo 2 de 3' : ''}
        </p>
        <h2 id="check-metas-titulo" className="check-titulo">
          Metas em andamento
        </h2>
        <p className="check-mudo">
          As metas que a cliente já persegue. "Quando entrou" é o ponto de partida; "Hoje" é o último resultado conhecido. A
          partir de agora, o resultado é lançado nas reuniões semanais.
        </p>
      </div>

      <div className="check-acoes">
        <label className="btn ghost check-arquivo">
          Importar de CSV
          <input type="file" accept=".csv,text/csv" onChange={(e) => void importar(e)} />
        </label>
        <span className="check-mudo">Colunas: Meta, Indicador, Unidade, Tipo, Quando entrou, Hoje, Alvo, Prazo.</span>
      </div>

      {avisos.length > 0 ? (
        <ul className="check-avisos" aria-live="polite">
          {avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}

      <ol className="check-metas">
        {linhas.map((l, i) => (
          // A linha não tem id próprio antes de ir ao servidor; a posição é a identidade dela na tabela.
          <li key={i} className="check-cartao-meta">
            <label className="campo check-cartao-titulo">
              Meta
              <input
                value={l.titulo}
                placeholder="Ex.: Faturamento mensal de R$ 150 mil"
                maxLength={160}
                onChange={(e) => mudar(i, 'titulo', e.target.value)}
              />
            </label>
            <label className="campo check-cartao-indicador">
              Indicador
              <input value={l.indicador} placeholder="Ex.: Faturamento" maxLength={120} onChange={(e) => mudar(i, 'indicador', e.target.value)} />
            </label>
            <label className="campo">
              Unidade
              <select value={l.unidade} onChange={(e) => mudar(i, 'unidade', e.target.value)}>
                {UNIDADES.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label className="campo">
              Tipo
              <select value={l.tipo} onChange={(e) => mudar(i, 'tipo', e.target.value)}>
                <option value="mensal">Mensal</option>
                <option value="prazo">Com prazo</option>
              </select>
            </label>
            <label className="campo">
              Quando entrou
              <input inputMode="decimal" className="num" value={l.valorInicial} onChange={(e) => mudar(i, 'valorInicial', e.target.value)} />
            </label>
            <label className="campo">
              Hoje
              <input inputMode="decimal" className="num" value={l.valorAtual} onChange={(e) => mudar(i, 'valorAtual', e.target.value)} />
            </label>
            <label className="campo">
              Alvo
              <input inputMode="decimal" className="num" value={l.valorMeta} onChange={(e) => mudar(i, 'valorMeta', e.target.value)} />
            </label>
            <label className="campo">
              Prazo
              <input type="date" className="num" value={l.prazo} onChange={(e) => mudar(i, 'prazo', e.target.value)} />
            </label>
            <button
              type="button"
              className="link check-remover"
              onClick={() => setLinhas((ls) => (ls.length === 1 ? [linhaVazia()] : ls.filter((_, j) => j !== i)))}
            >
              remover
            </button>
          </li>
        ))}
      </ol>
      <div>
        <button type="button" className="btn ghost" onClick={() => setLinhas((ls) => [...ls, linhaVazia()])}>
          Adicionar outra meta
        </button>
      </div>
      <div className="check-rodape">
        <button type="button" className="btn ghost" disabled={ocupado} onClick={() => void depois()}>
          Fazer depois
        </button>
        <button type="button" className="btn" disabled={ocupado} onClick={() => void salvar()}>
          {passoAPasso ? 'Salvar e seguir' : 'Salvar metas'}
        </button>
      </div>
    </section>
  )
}
