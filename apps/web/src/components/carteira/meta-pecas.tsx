'use client'

import type {
  DetalheDaMetaCarteira,
  IndicadorParaMeta,
  MetaAvaliada,
  MetaDoClienteSalvaSaida,
  MetasDoClienteSaida,
  NumeroDaMeta,
  UnidadeDeIndicadorCarteira,
} from '@fir/contracts'
import { formatarDinheiro, formatarPercentual } from '@fir/ui'
import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'

/**
 * As peças das METAS da carteira (G8 2B) — `metaRow`, `barraMeta`,
 * `abrirLancamentoMetas` e `F.meta` do protótipo (`index.html` L782-805,
 * L2756-2761). Só FORMATAÇÃO e formulário: toda faixa, todo ritmo e todo
 * percentual vêm prontos do servidor (`MetaAvaliada.avaliacao`, decidido em
 * racional exato pelo domínio). Nenhuma divisão aqui.
 *
 * Sem `valores`, o servidor já apagou todo número em R$ (`valor`,
 * `valorMeta`, `valorInicial`): os formatadores mostram "—" e o percentual
 * continua — nenhum `if` de permissão nesta tela.
 */

export const ROTULO_DO_DETALHE: Readonly<Record<DetalheDaMetaCarteira, string>> = {
  atingida: 'Atingida',
  na_meta: 'Na meta',
  prazo_vencido: 'Prazo vencido',
  sem_lancamento: 'Sem lançamento',
  no_ritmo: 'No ritmo',
  atencao: 'Atenção',
  abaixo_do_ritmo: 'Abaixo do ritmo',
  cancelada: 'Cancelada',
}

const CLASSE_DO_ESTADO: Readonly<Record<MetaAvaliada['avaliacao']['estado'], string>> = {
  atingida: 'bom',
  no_ritmo: 'bom',
  atencao: 'alerta',
  critica: 'mau',
  sem_lancamento: '',
  cancelada: '',
}

export const STATUS_DA_META: readonly [MetaAvaliada['status'], string][] = [
  ['em_andamento', 'Em andamento'],
  ['atingida', 'Atingida'],
  ['nao_atingida', 'Não atingida'],
  ['cancelada', 'Cancelada'],
]

const AGREGACAO: Readonly<Record<MetaAvaliada['agregacao'], string>> = {
  soma: 'Soma das semanas',
  media: 'Média das semanas',
  ultimo: 'Último valor lançado',
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MESES_LONGOS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/** `aaaa-mm-dd` → `dd/mm`. */
export const diaCurto = (dia: string | null): string => (dia ? `${dia.slice(8, 10)}/${dia.slice(5, 7)}` : '—')

const agrupar = (n: bigint): string => n.toLocaleString('pt-BR')

/** O sufixo de `un` e `dias` (`un(m)`, L783); R$ e % já trazem o símbolo. */
export const sufixo = (u: UnidadeDeIndicadorCarteira): string => (u === 'un' ? ' un' : u === 'dias' ? ' dias' : '')

/** Um inteiro em DÉCIMOS como texto: `185` → `18,5`, `180` → `18`. */
function decimos(n: bigint): string {
  const negativo = n < 0n
  const abs = negativo ? -n : n
  const resto = abs % 10n
  return `${negativo ? '-' : ''}${agrupar(abs / 10n)}${resto === 0n ? '' : `,${resto}`}`
}

/** Um número da meta na escala de EXIBIÇÃO que o servidor mandou (`NumeroDaMeta`). */
export function textoDoNumero(n: NumeroDaMeta | null, unidade: UnidadeDeIndicadorCarteira): string {
  if (n === null) return '—'
  if (n.escala === 'centavos') return formatarDinheiro(n.valor === null ? null : BigInt(n.valor))
  if (n.numero === null) return '—'
  if (n.escala === 'centesimos') return formatarPercentual(BigInt(n.numero))
  return `${decimos(BigInt(n.numero))}${sufixo(unidade)}`
}

/** Um valor na escala de ARMAZENAMENTO (alvo, inicial, lançamento): centavos ou inteiro. */
export function textoGuardado(centavos: string | null, inteiro: string | null, unidade: UnidadeDeIndicadorCarteira): string {
  if (unidade === 'R$') return formatarDinheiro(centavos === null ? null : BigInt(centavos))
  if (inteiro === null) return '—'
  if (unidade === '%') return formatarPercentual(BigInt(inteiro))
  return `${agrupar(BigInt(inteiro))}${sufixo(unidade)}`
}

export const textoDoAlvo = (m: MetaAvaliada): string => textoGuardado(m.valorMeta, m.valorMetaInteiro, m.unidade)

/**
 * O que a pessoa digitou → o par do contrato. R$ em centavos; `%` em
 * centésimos (aceita "12,5"); `un`/`dias` em inteiro. `null` = recusado.
 */
export function lerDigitado(texto: string, unidade: UnidadeDeIndicadorCarteira): { valor?: string; valorInteiro?: string } | null {
  const t = texto.trim()
  if (t === '') return null
  if (unidade === 'R$') {
    const c = centavosDoTexto(t)
    return c === null ? null : { valor: c.toString() }
  }
  if (unidade === '%') {
    const c = centavosDoTexto(t) // mesma leitura de duas casas: "12,5" → 1250 centésimos
    return c === null ? null : { valorInteiro: c.toString() }
  }
  return /^\d{1,12}$/.test(t) ? { valorInteiro: String(BigInt(t)) } : null
}

/** A barra da meta com o marcador "Esperado para hoje" (`barraMeta`, L782). SVG: sem `style=`. */
export function BarraDaMeta({ avaliacao }: { avaliacao: MetaAvaliada['avaliacao'] }) {
  const p = Math.max(0, Math.min(100, avaliacao.percentual ?? 0))
  const e = Math.max(0, Math.min(100, avaliacao.ritmoEsperado))
  return (
    <svg
      className="meta-barra"
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${avaliacao.percentual === null ? 'Sem progresso' : `${avaliacao.percentual}% do alvo`}; esperado para hoje: ${avaliacao.ritmoEsperado}%`}
    >
      <title>{`Esperado para hoje: ${avaliacao.ritmoEsperado}%`}</title>
      <rect className="meta-barra-fundo" x="0" y="0" width="100" height="8" rx="4" />
      <rect className={`meta-barra-feito meta-barra-${CLASSE_DO_ESTADO[avaliacao.estado] || 'neutra'}`} x="0" y="0" width={p} height="8" rx="4" />
      <rect className="meta-barra-esperado" x={Math.max(0, e - 0.6)} y="0" width="1.2" height="8" />
    </svg>
  )
}

export function ChipDaMeta({ avaliacao, painel = false }: { avaliacao: MetaAvaliada['avaliacao']; painel?: boolean }) {
  // No painel, "Na meta" conta e aparece como "Atingida" (L809).
  const detalhe = painel && avaliacao.detalhe === 'na_meta' ? 'atingida' : avaliacao.detalhe
  const classe = CLASSE_DO_ESTADO[avaliacao.estado]
  return <span className={classe ? `pill ${classe}` : 'pill'}>{ROTULO_DO_DETALHE[detalhe]}</span>
}

/** "Novembro · 2 de 5 semanas lançadas" (L758) ou "Até dd/mm" (L769). */
function periodo(m: MetaAvaliada, hoje: string): string {
  if (m.semanasDoMes !== null && m.semanasPassadas !== null) {
    const mes = MESES_LONGOS[Number(hoje.slice(5, 7)) - 1] ?? ''
    return `${mes} · ${m.semanasPassadas} de ${m.semanasDoMes} semanas lançadas`
  }
  return m.prazo ? `Até ${diaCurto(m.prazo)}` : ''
}

/** Uma meta com barra, valores, semanas e histórico (`metaRow`, L784-790). */
export function LinhaDaMeta({
  meta: m,
  hoje,
  painel = false,
  aoAbrir,
}: {
  meta: MetaAvaliada
  hoje: string
  painel?: boolean
  aoAbrir?: (m: MetaAvaliada) => void
}) {
  const acumulado = m.tipo === 'mensal' && m.agregacao === 'soma' && m.fonte === 'lancamento'
  const cabeca = (
    <span className="meta-linha-topo">
      <span className="meta-linha-titulo">{m.titulo}</span>
      <ChipDaMeta avaliacao={m.avaliacao} painel={painel} />
    </span>
  )
  return (
    <div className="meta-linha">
      {aoAbrir ? (
        <button type="button" className="meta-linha-abrir" onClick={() => aoAbrir(m)}>
          {cabeca}
        </button>
      ) : (
        cabeca
      )}
      <BarraDaMeta avaliacao={m.avaliacao} />
      <div className="meta-linha-numeros">
        <span className="num">
          {m.atual === null ? 'sem lançamento' : `${acumulado ? 'Acumulado' : 'Atual'} ${textoDoNumero(m.atual, m.unidade)}`}
          {m.automatico ? <span className="meta-auto"> da planilha</span> : null}{' '}
          <span className="muted">de {textoDoAlvo(m)}</span>
          {/* O painel (`metaRow`, L786) não repete o percentual: a barra já o mostra. A aba Plano continua com ele. */}
          {!painel && m.avaliacao.percentual !== null ? <span className="muted"> · {m.avaliacao.percentual}%</span> : null}
        </span>
        <span className="muted">{periodo(m, hoje)}</span>
      </div>
      {m.semanas.length > 0 ? (
        <div className="meta-semanas">
          <span className="meta-semanas-barras" aria-label="Lançamentos por semana do mês">
            {m.semanas.map((s, i) => (
              <span
                key={s.referencia}
                className="meta-semana"
                title={`Semana ${i + 1}: ${s.lancada ? textoDoNumero({ valor: s.valor, numero: s.numero, escala: m.atual?.escala ?? 'decimos' }, m.unidade) : 'sem lançamento'}`}
              >
                <svg viewBox="0 0 10 100" preserveAspectRatio="none" aria-hidden="true">
                  {s.altura !== null ? <rect className="meta-semana-feita" x="0" y={100 - s.altura} width="10" height={s.altura} /> : null}
                </svg>
              </span>
            ))}
          </span>
          <em>{m.agregacao === 'soma' ? 'por semana' : AGREGACAO[m.agregacao].toLowerCase()}</em>
          {m.historico.map((h) => (
            <b key={h.mes} className={`meta-hist meta-hist-${h.faixa ?? 'nenhuma'}`}>
              {MESES[Number(h.mes.slice(5, 7)) - 1]} {h.percentual === null ? '—' : `${h.percentual}%`}
            </b>
          ))}
        </div>
      ) : null}
      {m.faltaLancar ? <div className="meta-falta">Falta lançar a semana de {diaCurto(m.faltaLancar)}</div> : null}
    </div>
  )
}

/**
 * "Metas da semana" (`abrirLancamentoMetas`, L793-805): a semana (a atual e
 * as 4 anteriores; padrão, a da reunião), um campo por meta de lançamento
 * semanal, e "Combinados da reunião", que vira uma reunião registrada.
 * Relançar a mesma semana atualiza (o servidor faz o upsert).
 */
export function LancarMetasDaSemana({
  clienteId,
  nome,
  dados,
  semana: semanaInicial,
  tarefaInternaId,
  aoFechar,
  aoSalvar,
}: {
  clienteId: string
  nome: string
  dados: Pick<MetasDoClienteSaida, 'semanaDaReuniao' | 'semanasParaLancar' | 'metas'>
  semana?: string
  tarefaInternaId?: string
  aoFechar: () => void
  aoSalvar: (recado: string) => void
}) {
  const metas = dados.metas.filter((m) => m.status !== 'cancelada' && m.fonte === 'lancamento')
  const [semana, setSemana] = useState(semanaInicial ?? dados.semanaDaReuniao)
  const [valores, setValores] = useState<Record<string, string>>({})
  const [combinados, setCombinados] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [chave] = useState(() => crypto.randomUUID())
  const opcoes = dados.semanasParaLancar.includes(semana) ? dados.semanasParaLancar : [semana, ...dados.semanasParaLancar]

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const lista: { metaId: string; valor?: string; valorInteiro?: string }[] = []
    for (const m of metas) {
      const t = valores[m.id] ?? ''
      if (t.trim() === '') continue
      const v = lerDigitado(t, m.unidade)
      if (v === null) {
        setErro(`Revise o valor de "${m.titulo}".`)
        return
      }
      lista.push({ metaId: m.id, ...v })
    }
    setEnviando(true)
    setErro(null)
    try {
      const r = await chamar<{ lancadas: number }>(`v1/carteira/clientes/${clienteId}/metas/lancamento-semanal`, {
        method: 'POST',
        body: JSON.stringify({
          semana,
          valores: lista,
          combinados: combinados.trim() || null,
          chaveIdempotencia: chave,
          ...(tarefaInternaId ? { tarefaInternaId } : {}),
        }),
      })
      aoSalvar(`${r.lancadas} ${r.lancadas === 1 ? 'meta lançada' : 'metas lançadas'} para ${nome}`)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível lançar. Tente de novo.')
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={`Metas da semana · ${nome}`} aoFechar={aoFechar}>
      <form className="meta-form" onSubmit={enviar}>
        <label className="campo">
          Semana
          <select value={semana} onChange={(e) => setSemana(e.target.value)}>
            {opcoes.map((s, i) => (
              <option key={s} value={s}>
                Semana de {diaCurto(s)}
                {i === 0 && s === dados.semanasParaLancar[0] ? ' (atual)' : ''}
              </option>
            ))}
          </select>
        </label>
        {metas.map((m) => (
          <label key={m.id} className="campo">
            {m.titulo} · {m.agregacao === 'soma' ? 'realizado na semana' : 'valor da semana'} ({m.unidade})
            <input
              inputMode={m.unidade === 'un' || m.unidade === 'dias' ? 'numeric' : 'decimal'}
              className="num"
              value={valores[m.id] ?? ''}
              onChange={(e) => setValores({ ...valores, [m.id]: e.target.value })}
            />
            <small>
              {m.agregacao === 'soma'
                ? `Alvo do ${m.tipo === 'mensal' ? 'mês' : 'período'}: ${textoDoAlvo(m)} · acumulado até agora: ${textoDoNumero(m.atual, m.unidade)}`
                : `Alvo: ${textoDoAlvo(m)}`}
            </small>
          </label>
        ))}
        <label className="campo">
          Combinados da reunião
          <textarea rows={3} value={combinados} onChange={(e) => setCombinados(e.target.value)} maxLength={3000} />
          <small>Vai para o histórico de reuniões da cliente</small>
        </label>
        {erro ? (
          <p className="erro" role="alert">
            {erro}
          </p>
        ) : null}
        <div className="botoes">
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

const FONTE_LANCAMENTO = 'lancamento'

/**
 * "Nova meta" / "Editar meta" (`F.meta`, L2756-2761). O indicador é um da
 * cliente ou nasce junto (o caminho de dois toques, M2). O tipo, a agregação
 * e a fonte ficam recolhidos em "Mais opções" — o padrão do protótipo
 * (mensal, soma, lançado na reunião) cobre a meta comum.
 */
export function FormularioDeMeta({
  clienteId,
  meta,
  indicadores,
  fontes,
  hoje,
  aoFechar,
  aoSalvar,
}: {
  clienteId: string
  meta: MetaAvaliada | null
  indicadores: readonly IndicadorParaMeta[]
  fontes: MetasDoClienteSaida['fontes']
  hoje: string
  aoFechar: () => void
  aoSalvar: (recado: string) => void
}) {
  const [titulo, setTitulo] = useState(meta?.titulo ?? '')
  const [indicadorId, setIndicadorId] = useState(meta?.indicadorId ?? (indicadores[0]?.id ?? '__novo'))
  const [novoNome, setNovoNome] = useState('')
  const [novaUnidade, setNovaUnidade] = useState<UnidadeDeIndicadorCarteira>('R$')
  const [tipo, setTipo] = useState(meta?.tipo ?? 'mensal')
  const [agregacao, setAgregacao] = useState(meta?.agregacao ?? 'soma')
  const [sentido, setSentido] = useState(meta?.sentido ?? 'maior_melhor')
  const [alvo, setAlvo] = useState('')
  const [inicial, setInicial] = useState('')
  const [fonte, setFonte] = useState(meta?.fonte ?? FONTE_LANCAMENTO)
  const [inicio, setInicio] = useState(meta?.inicio ?? hoje)
  const [prazo, setPrazo] = useState(meta?.prazo ?? '')
  const [status, setStatus] = useState(meta?.status ?? 'em_andamento')
  const [mais, setMais] = useState(meta !== null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmarExclusao, setConfirmarExclusao] = useState(false)

  const unidade: UnidadeDeIndicadorCarteira =
    meta?.unidade ?? (indicadorId === '__novo' ? novaUnidade : (indicadores.find((i) => i.id === indicadorId)?.unidade ?? 'R$'))
  const fontesDaUnidade = fontes.filter((f) => f.unidade === null || f.unidade === unidade)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const alvoLido = alvo.trim() === '' ? null : lerDigitado(alvo, unidade)
    const inicialLido = inicial.trim() === '' ? null : lerDigitado(inicial, unidade)
    if (alvo.trim() !== '' && alvoLido === null) return setErro('Revise o valor alvo.')
    if (inicial.trim() !== '' && inicialLido === null) return setErro('Revise o valor no início.')
    if (meta === null && alvoLido === null) return setErro('Informe o valor alvo.')
    if (tipo === 'prazo' && prazo === '') return setErro('Meta com prazo precisa da data final.')
    const comoAlvo = (v: { valor?: string; valorInteiro?: string } | null) =>
      v === null ? {} : v.valor !== undefined ? { valorMeta: v.valor } : { valorMetaInteiro: v.valorInteiro }
    const comoInicial = (v: { valor?: string; valorInteiro?: string } | null) =>
      v === null ? {} : v.valor !== undefined ? { valorInicial: v.valor } : { valorInicialInteiro: v.valorInteiro }
    setEnviando(true)
    setErro(null)
    try {
      if (meta === null) {
        // O corpo é a ENTRADA do contrato, em texto (os bigint são do lado do servidor).
        const corpo: Record<string, unknown> = {
          titulo,
          ...(indicadorId === '__novo'
            ? { novoIndicador: { nome: novoNome.trim() || titulo, unidade: novaUnidade } }
            : { indicadorId }),
          tipo,
          agregacao,
          sentido,
          ...comoAlvo(alvoLido),
          ...comoInicial(inicialLido),
          fonte,
          inicio,
          prazo: prazo || null,
          status,
        }
        await chamar<MetaDoClienteSalvaSaida>(`v1/carteira/clientes/${clienteId}/metas`, { method: 'POST', body: JSON.stringify(corpo) })
        aoSalvar('Meta criada')
      } else {
        // Só o que mudou: reenviar um valor redigido (`null`) nunca apaga o guardado (A-6).
        const corpo: Record<string, unknown> = {
          ...(titulo !== meta.titulo ? { titulo } : {}),
          ...(tipo !== meta.tipo ? { tipo } : {}),
          ...(agregacao !== meta.agregacao ? { agregacao } : {}),
          ...(sentido !== meta.sentido ? { sentido } : {}),
          ...(fonte !== meta.fonte ? { fonte } : {}),
          ...(inicio !== meta.inicio ? { inicio } : {}),
          ...((prazo || null) !== meta.prazo ? { prazo: prazo || null } : {}),
          ...(status !== meta.status ? { status } : {}),
          ...comoAlvo(alvoLido),
          ...comoInicial(inicialLido),
        }
        await chamar<MetaDoClienteSalvaSaida>(`v1/carteira/clientes/${clienteId}/metas/${meta.id}`, {
          method: 'PATCH',
          body: JSON.stringify(corpo),
        })
        aoSalvar('Meta salva')
      }
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível salvar. Tente de novo.')
      setEnviando(false)
    }
  }

  async function excluir() {
    if (meta === null) return
    setEnviando(true)
    try {
      await chamar(`v1/carteira/clientes/${clienteId}/metas/${meta.id}/excluir`, { method: 'POST' })
      aoSalvar('Meta excluída')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Não foi possível excluir.')
      setEnviando(false)
    }
  }

  return (
    <Modal titulo={meta === null ? 'Nova meta' : 'Editar meta'} aoFechar={aoFechar}>
      <form className="meta-form" onSubmit={enviar}>
        <label className="campo">
          Meta
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={160} />
        </label>
        {meta === null ? (
          <label className="campo">
            Indicador
            <select value={indicadorId} onChange={(e) => setIndicadorId(e.target.value)}>
              {indicadores.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nome} ({i.unidade})
                </option>
              ))}
              <option value="__novo">Novo indicador…</option>
            </select>
          </label>
        ) : (
          <p className="nota">
            Indicador: {meta.indicadorNome} ({meta.unidade})
          </p>
        )}
        {meta === null && indicadorId === '__novo' ? (
          <div className="meta-duas">
            <label className="campo">
              Nome do indicador
              <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder={titulo} maxLength={120} />
            </label>
            <label className="campo">
              Unidade
              <select value={novaUnidade} onChange={(e) => setNovaUnidade(e.target.value as UnidadeDeIndicadorCarteira)}>
                {(['R$', '%', 'un', 'dias'] as const).map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        <div className="meta-duas">
          <label className="campo">
            Valor alvo ({unidade})
            <input
              className="num"
              inputMode="decimal"
              value={alvo}
              onChange={(e) => setAlvo(e.target.value)}
              placeholder={meta ? textoDoAlvo(meta) : ''}
            />
          </label>
          <label className="campo">
            Melhor quando
            <select value={sentido} onChange={(e) => setSentido(e.target.value as typeof sentido)}>
              <option value="maior_melhor">Maior</option>
              <option value="menor_melhor">Menor</option>
            </select>
          </label>
        </div>
        <div className="meta-duas">
          <label className="campo">
            Tipo de meta
            <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
              <option value="mensal">Mensal: recomeça todo mês</option>
              <option value="prazo">Com prazo: acumula até a data final</option>
            </select>
          </label>
          <label className="campo">
            Prazo
            <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </label>
        </div>
        {!mais ? (
          <button type="button" className="link" onClick={() => setMais(true)}>
            + Mais opções
          </button>
        ) : (
          <>
            <label className="campo">
              Como as semanas fecham o resultado
              <select value={agregacao} onChange={(e) => setAgregacao(e.target.value as typeof agregacao)}>
                {Object.entries(AGREGACAO).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <div className="meta-duas">
              <label className="campo">
                Valor no início
                <input
                  className="num"
                  inputMode="decimal"
                  value={inicial}
                  onChange={(e) => setInicial(e.target.value)}
                  placeholder={meta ? textoGuardado(meta.valorInicial, meta.valorInicialInteiro, meta.unidade) : ''}
                />
                <small>Onde a cliente estava quando a meta foi definida</small>
              </label>
              <label className="campo">
                Início
                <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
              </label>
            </div>
            <label className="campo">
              De onde vem o resultado
              <select value={fonte} onChange={(e) => setFonte(e.target.value)}>
                {fontesDaUnidade.map((f) => (
                  <option key={f.fonte} value={f.fonte}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
              <small>Lançado na reunião semanal, ou lido da planilha de indicadores</small>
            </label>
            <label className="campo">
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                {STATUS_DA_META.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {erro ? (
          <p className="erro" role="alert">
            {erro}
          </p>
        ) : null}
        <div className="botoes">
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar}>
            Cancelar
          </button>
          {meta !== null ? (
            confirmarExclusao ? (
              <button type="button" className="btn ghost meta-perigo" onClick={() => void excluir()} disabled={enviando}>
                Confirmar exclusão
              </button>
            ) : (
              <button type="button" className="link perigo" onClick={() => setConfirmarExclusao(true)}>
                Excluir meta
              </button>
            )
          ) : null}
        </div>
      </form>
    </Modal>
  )
}
