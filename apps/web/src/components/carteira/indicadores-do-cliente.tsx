'use client'

import type {
  IndicadorDoCliente,
  IndicadoresDoClienteSaida,
  SemanaDosIndicadoresLancadaSaida,
  SentidoDeIndicador,
  UnidadeDeIndicadorCarteira,
} from '@fir/contracts'
import { formatarDinheiro, formatarPercentual } from '@fir/ui'
import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaCurto } from '@/lib/formato'
import { lerDigitado } from './meta-pecas'

/**
 * **V10 — INDICADORES MANUAIS DA CLIENTE** (`cIndicadoresManual`,
 * `novoIndicador`, `lancar` — protótipo `index.html` L1520-1530, L2970-2973,
 * `F.indicador` L2763, `spark` L1483).
 *
 * Painel "Indicadores · Últimas 8 semanas · linha tracejada é a meta", com
 * "Novo indicador" e "Lançar semana", e um cartão por indicador: último
 * valor, "Na meta"/"Abaixo", meta semanal, variação na semana, a segunda do
 * último lançamento e o gráfico das últimas 8 semanas.
 *
 * **Nada é calculado aqui.** "Na meta", a variação (em décimos de ponto,
 * contra a segunda IMEDIATAMENTE anterior — gate de números, ajuste 22) e a
 * série chegam prontas de `GET /v1/carteira/clientes/:id/indicadores`. A tela
 * formata. O único número feito aqui é a GEOMETRIA do gráfico (onde cada
 * ponto cai no SVG), que não vira texto em lugar nenhum.
 *
 * **Valor.** Sem `valores`, o servidor já apagou a meta e os pontos em R$
 * (`valorMeta`, `valor`): o texto sai "—" e o gráfico de um indicador em R$
 * simplesmente não tem pontos para desenhar. Nenhum `if` de permissão.
 */
export function IndicadoresDoCliente({
  clienteId,
  dados,
  aoMudar,
}: {
  clienteId: string
  dados: IndicadoresDoClienteSaida
  aoMudar: (recado: string) => void
}) {
  const [aberto, setAberto] = useState<'novo' | 'lancar' | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const abrirLancamento = () => {
    // L2971: sem indicador não há o que lançar — o protótipo avisa e não abre.
    if (dados.indicadores.length === 0) {
      setAviso('Cadastre um indicador primeiro.')
      return
    }
    setAviso(null)
    setAberto('lancar')
  }

  return (
    <section className="ficha-painel" aria-labelledby="ind-titulo">
      <div className="ficha-painel-cabeca">
        <h2 id="ind-titulo">Indicadores</h2>
        <span className="ind-sub">Últimas 8 semanas · linha tracejada é a meta</span>
        <div className="ind-cabeca-acoes">
          <button type="button" className="btn ghost" onClick={() => setAberto('novo')}>
            Novo indicador
          </button>
          <button type="button" className="btn" onClick={abrirLancamento}>
            Lançar semana
          </button>
        </div>
      </div>
      {aviso !== null ? (
        <p className="ind-aviso" role="status" aria-live="polite">
          {aviso}
        </p>
      ) : null}

      {dados.indicadores.length === 0 ? (
        <p className="ficha-vazio">Nenhum indicador. Cadastre os indicadores da área de foco para acompanhar semana a semana.</p>
      ) : (
        <ul className="ind-grade">
          {dados.indicadores.map((i) => (
            <CartaoDoIndicador key={i.id} indicador={i} />
          ))}
        </ul>
      )}

      {aberto === 'novo' ? (
        <NovoIndicador
          clienteId={clienteId}
          aoFechar={() => setAberto(null)}
          aoSalvar={(r) => {
            setAberto(null)
            setAviso(null)
            aoMudar(r)
          }}
        />
      ) : null}
      {aberto === 'lancar' ? (
        <LancarSemana
          clienteId={clienteId}
          dados={dados}
          aoFechar={() => setAberto(null)}
          aoSalvar={(r) => {
            setAberto(null)
            aoMudar(r)
          }}
        />
      ) : null}
    </section>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * Formatação — só de tela
 * ────────────────────────────────────────────────────────────────────────── */

const agrupar = (n: bigint): string => n.toLocaleString('pt-BR')

/** Um inteiro em DÉCIMOS com uma casa sempre: `125` → `12,5`, `-40` → `-4,0` (o `toFixed(1)` do protótipo, L1527, sem float). */
export function decimosComUmaCasa(n: bigint): string {
  const negativo = n < 0n
  const abs = negativo ? -n : n
  return `${negativo ? '-' : ''}${agrupar(abs / 10n)},${abs % 10n}`
}

/** A variação que o servidor mandou, como o protótipo escreve: "+12,5% na semana". */
export function variacaoNaSemana(decimos: bigint | null): string | null {
  if (decimos === null) return null
  return `${decimos >= 0n ? '+' : ''}${decimosComUmaCasa(decimos)}% na semana`
}

/** O número do cartão e, à parte, a unidade em letra miúda (`un`, `dias` — L1526). */
function numeroDoIndicador(
  unidade: UnidadeDeIndicadorCarteira,
  centavos: string | null,
  inteiro: string | null,
): { numero: string; unidade: string | null } {
  if (unidade === 'R$') return { numero: formatarDinheiro(centavos === null ? null : BigInt(centavos)), unidade: null }
  if (inteiro === null) return { numero: '—', unidade: null }
  if (unidade === '%') return { numero: formatarPercentual(BigInt(inteiro)), unidade: null }
  return { numero: agrupar(BigInt(inteiro)), unidade }
}

function textoDaMeta(i: IndicadorDoCliente): string {
  const n = numeroDoIndicador(i.unidade, i.valorMeta, i.valorMetaInteiro)
  return n.unidade === null || n.numero === '—' ? n.numero : `${n.numero} ${n.unidade}`
}

function CartaoDoIndicador({ indicador: i }: { indicador: IndicadorDoCliente }) {
  const ultimo = i.ultimo
  const valor = ultimo === null ? { numero: '—', unidade: null } : numeroDoIndicador(i.unidade, ultimo.valor, ultimo.valorInteiro)
  const variacao =
    variacaoNaSemana(i.variacaoEmDecimos === null ? null : BigInt(i.variacaoEmDecimos)) ??
    (i.semVariacao === 'anterior_zero' ? 'variação indefinida (semana anterior em zero)' : 'sem semana anterior')
  const pontos = i.serie.flatMap((p) => {
    const t = i.unidade === 'R$' ? p.valor : p.valorInteiro
    return t === null ? [] : [BigInt(t)]
  })
  const metaTexto = i.unidade === 'R$' ? i.valorMeta : i.valorMetaInteiro

  return (
    <li className="ind-cartao">
      <div className="ind-cartao-topo">
        <b className="ind-nome">{i.nome}</b>
        {i.naMeta === null ? null : (
          <span className={`ind-chip ${i.naMeta ? 'ind-chip-bom' : 'ind-chip-atencao'}`}>{i.naMeta ? 'Na meta' : 'Abaixo'}</span>
        )}
      </div>
      <div className="ind-valor num">
        {valor.numero}
        {valor.unidade !== null && valor.numero !== '—' ? <span className="ind-un"> {valor.unidade}</span> : null}
      </div>
      <div className="ind-linha num">
        Meta {textoDaMeta(i)} · {variacao}
        {ultimo !== null ? ` · semana de ${diaCurto(ultimo.referencia)}` : ''}
      </div>
      <Faisca
        valores={pontos}
        meta={metaTexto === null ? null : BigInt(metaTexto)}
        tom={i.naMeta === null ? 'neutro' : i.naMeta ? 'bom' : 'mau'}
      />
    </li>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * O gráfico (`spark`, L1483-1493)
 * ────────────────────────────────────────────────────────────────────────── */

const W = 240
const H = 44
const P = 4

/**
 * A linha das últimas semanas, a área sob ela, a meta tracejada e o ponto
 * final na cor de "na meta" / "abaixo". SVG puro, sem `style=` e sem
 * biblioteca; as cores moram no CSS (`.ind-faisca-*`), então o tema escuro
 * vem de graça.
 *
 * A escala é GEOMETRIA de desenho, não número de negócio: a posição vertical
 * é `(v − mín) / amplitude` da série, feita em `bigint` (milésimos de pixel)
 * para que um faturamento em centavos não passe por ponto flutuante antes de
 * virar coordenada. Nada daqui vai para o texto.
 *
 * Sem meta, o ponto final fica no dourado (`tom: 'neutro'`) — o protótipo o
 * pintava de "abaixo" comparando com `undefined` (ajuste 22).
 */
export function Faisca({
  valores,
  meta,
  tom,
}: {
  valores: readonly bigint[]
  meta: bigint | null
  tom: 'bom' | 'mau' | 'neutro'
}) {
  const primeiro = valores[0]
  if (primeiro === undefined) return null
  let mn = primeiro
  let mx = primeiro
  for (const v of meta === null ? valores : [...valores, meta]) {
    if (v < mn) mn = v
    if (v > mx) mx = v
  }
  const amplitude = mx - mn === 0n ? 1n : mx - mn
  const alturaUtil = BigInt((H - 2 * P) * 1000)
  const y = (v: bigint): number => H - P - Number(((v - mn) * alturaUtil) / amplitude) / 1000
  const x = (i: number): number => P + (i * (W - 2 * P)) / Math.max(1, valores.length - 1)
  const ultimoI = valores.length - 1
  const pts = valores.map((v, i) => `${x(i)},${y(v)}`).join(' ')

  return (
    <svg className="ind-faisca" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {meta !== null ? (
        <line className="ind-faisca-meta" x1={P} x2={W - P} y1={y(meta)} y2={y(meta)} vectorEffect="non-scaling-stroke" />
      ) : null}
      <polygon className="ind-faisca-area" points={`${P},${H} ${pts} ${x(ultimoI)},${H}`} />
      <polyline className="ind-faisca-linha" points={pts} vectorEffect="non-scaling-stroke" />
      <circle className={`ind-faisca-ponto ind-faisca-ponto-${tom}`} cx={x(ultimoI)} cy={y(valores[ultimoI]!)} r="3.2" />
    </svg>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
 * "Novo indicador" (`F.indicador`, L2763) e "Lançar semana" (L2971-2973)
 * ────────────────────────────────────────────────────────────────────────── */

const UNIDADES: readonly UnidadeDeIndicadorCarteira[] = ['R$', '%', 'un', 'dias']

const dicaDaDigitacao = (u: UnidadeDeIndicadorCarteira): string =>
  u === 'R$' || u === '%' ? '0,00' : '0'

function NovoIndicador({
  clienteId,
  aoFechar,
  aoSalvar,
}: {
  clienteId: string
  aoFechar: () => void
  aoSalvar: (recado: string) => void
}) {
  const [nome, setNome] = useState('')
  const [unidade, setUnidade] = useState<UnidadeDeIndicadorCarteira>('R$')
  const [meta, setMeta] = useState('')
  const [sentido, setSentido] = useState<SentidoDeIndicador>('maior_melhor')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    let metaNoCorpo: { valorMeta?: string; valorMetaInteiro?: string } = {}
    if (meta.trim() !== '') {
      const lido = lerDigitado(meta, unidade)
      if (lido === null) {
        setErro('Revise a meta semanal.')
        return
      }
      metaNoCorpo = lido.valor !== undefined ? { valorMeta: lido.valor } : { valorMetaInteiro: lido.valorInteiro ?? '' }
    }
    setEnviando(true)
    setErro(null)
    try {
      const r = await chamar<{ indicador: IndicadorDoCliente }>(`v1/carteira/clientes/${clienteId}/indicadores`, {
        method: 'POST',
        body: JSON.stringify({ nome, unidade, sentido, ...metaNoCorpo }),
      })
      aoSalvar(`Indicador "${r.indicador.nome}" criado.`)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor. Tente de novo.')
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Novo indicador" aoFechar={aoFechar}>
      <form className="ind-form" onSubmit={enviar}>
        <label className="campo">
          Indicador
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} required />
        </label>
        <div className="ind-form-par">
          <label className="campo">
            Unidade
            <select value={unidade} onChange={(e) => setUnidade(e.target.value as UnidadeDeIndicadorCarteira)}>
              {UNIDADES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Meta semanal
            <input
              className="num"
              inputMode={unidade === 'R$' || unidade === '%' ? 'decimal' : 'numeric'}
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              placeholder={dicaDaDigitacao(unidade)}
            />
          </label>
        </div>
        <label className="campo">
          Melhor quando
          <select value={sentido} onChange={(e) => setSentido(e.target.value as SentidoDeIndicador)}>
            <option value="maior_melhor">Maior</option>
            <option value="menor_melhor">Menor</option>
          </select>
        </label>
        <p className="erro" role="alert" aria-live="polite">
          {erro}
        </p>
        <div className="ind-form-acoes">
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * "Lançar valores da semana": a segunda de referência (padrão, a desta
 * semana, que vem do servidor — regra 24) e um campo por indicador. Campo em
 * branco é "não lançar este". O servidor recusa referência que não seja
 * segunda (ajuste 17); o `step` de 7 dias a partir de uma segunda faz o
 * próprio seletor de data oferecer só segundas.
 */
function LancarSemana({
  clienteId,
  dados,
  aoFechar,
  aoSalvar,
}: {
  clienteId: string
  dados: IndicadoresDoClienteSaida
  aoFechar: () => void
  aoSalvar: (recado: string) => void
}) {
  const [referencia, setReferencia] = useState(dados.semanaAtual)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const lista: { indicadorId: string; valor?: string; valorInteiro?: string }[] = []
    for (const i of dados.indicadores) {
      const t = valores[i.id] ?? ''
      if (t.trim() === '') continue
      const v = lerDigitado(t, i.unidade)
      if (v === null) {
        setErro(`Revise o valor de "${i.nome}".`)
        return
      }
      lista.push({ indicadorId: i.id, ...v })
    }
    if (lista.length === 0) {
      setErro('Preencha ao menos um indicador.')
      return
    }
    setEnviando(true)
    setErro(null)
    try {
      const r = await chamar<SemanaDosIndicadoresLancadaSaida>(`v1/carteira/clientes/${clienteId}/lancamentos`, {
        method: 'POST',
        body: JSON.stringify({ referencia, valores: lista }),
      })
      aoSalvar(
        `${r.lancados} ${r.lancados === 1 ? 'indicador lançado' : 'indicadores lançados'} na semana de ${diaCurto(referencia)}.`,
      )
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor. Tente de novo.')
      setEnviando(false)
    }
  }

  return (
    <Modal titulo="Lançar valores da semana" aoFechar={aoFechar}>
      <form className="ind-form" onSubmit={enviar}>
        <label className="campo">
          Semana de referência (segunda)
          <input
            type="date"
            className="num"
            value={referencia}
            min="2020-01-06"
            step={7}
            onChange={(e) => setReferencia(e.target.value)}
            required
          />
        </label>
        {dados.indicadores.map((i) => (
          <label key={i.id} className="campo">
            {i.nome} ({i.unidade})
            <input
              className="num"
              inputMode={i.unidade === 'R$' || i.unidade === '%' ? 'decimal' : 'numeric'}
              value={valores[i.id] ?? ''}
              onChange={(e) => setValores({ ...valores, [i.id]: e.target.value })}
              placeholder={dicaDaDigitacao(i.unidade)}
            />
          </label>
        ))}
        <p className="erro" role="alert" aria-live="polite">
          {erro}
        </p>
        <div className="ind-form-acoes">
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Lançando…' : 'Lançar'}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar}>
            Cancelar
          </button>
        </div>
      </form>
    </Modal>
  )
}
