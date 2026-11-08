import type { FonteDaMetaCarteira, MetaAvaliada, StatusDeMetaCarteira } from '@fir/contracts'
import {
  PLANILHA_DE_INDICADORES,
  agregarLancamentos,
  avaliarMeta,
  diaCivil,
  lerFonteDaPlanilha,
  metricaDaFrente,
  metricaDaPlanilha,
  percentualDoHistorico,
  segundaDaSemana,
  segundasDoMes,
  semanaDaReuniao,
  semanasPassadasDoMes,
  valorParaExibicao,
  type AgregacaoDeMeta,
  type LancamentoDeMeta,
  type PlanilhaInterpretada,
  type Racional,
  type SentidoDeMeta,
  type TipoDeMeta,
  type UnidadeDeMeta,
} from '@fir/domain'
import type pg from 'pg'
import { planilhaDoJson } from '../planilhas/planilhas-carteira.service'

/**
 * **A AVALIAÇÃO DE UMA META, montada no servidor** (M3, O4; `avaliarMeta`
 * L751-780, `valorAtualMeta` L736-743, `metaRow` L784-790).
 *
 * Este arquivo NÃO decide nada de faixa nem de ritmo: quem decide é
 * `avaliarMeta` do domínio, por comparação racional exata (CE-2, CE-5). Aqui
 * só se escolhe O QUE entra (qual recorte de lançamentos, qual fonte) e se
 * traduz a saída para o contrato — com todo número absoluto de R$ num campo de
 * nome monetário registrado (`valor`), para o ponto único de redação o
 * alcançar (appsec caso 12).
 *
 * É o mesmo cálculo para a carteira (M1, ficha) e para o portal (O4): quem
 * monta o portal chama `avaliarMetas` com as linhas que o papel `fir_portal`
 * consegue ler.
 */

export type LinhaDaMeta = {
  id: string
  cliente_carteira_id: string
  indicador_id: string
  indicador_nome: string
  unidade: UnidadeDeMeta
  titulo: string
  tipo: TipoDeMeta
  agregacao: AgregacaoDeMeta
  sentido: SentidoDeMeta
  fonte: 'lancamento' | 'indicador' | 'planilha'
  fonte_indicador_id: string | null
  fonte_indicador_nome: string | null
  fonte_planilha: string | null
  inicio: string
  prazo: string | null
  status: StatusDeMetaCarteira | 'concluida'
  valor_meta_centavos: string | null
  valor_meta_inteiro: string | null
  valor_inicial_centavos: string | null
  valor_inicial_inteiro: string | null
  acoes_total: number
  acoes_concluidas: number
}

/** O `SELECT` de uma meta com o que a avaliação precisa — o `WHERE` é de quem chama. */
export const SELECT_META = `
  SELECT m.id, m.cliente_carteira_id, m.indicador_id, i.nome AS indicador_nome, i.unidade,
         m.titulo, m.tipo, m.agregacao, m.sentido, m.fonte, m.fonte_indicador_id,
         fi.nome AS fonte_indicador_nome, m.fonte_planilha,
         m.inicio::text AS inicio, m.prazo::text AS prazo, m.status,
         m.valor_meta_centavos::text AS valor_meta_centavos, m.valor_meta_inteiro::text AS valor_meta_inteiro,
         m.valor_inicial_centavos::text AS valor_inicial_centavos, m.valor_inicial_inteiro::text AS valor_inicial_inteiro,
         (SELECT count(*)::int FROM acoes_do_plano a
           WHERE a.meta_comercial_id = m.id AND a.arquivada_em IS NULL) AS acoes_total,
         (SELECT count(*)::int FROM acoes_do_plano a
           WHERE a.meta_comercial_id = m.id AND a.arquivada_em IS NULL AND a.status = 'concluida') AS acoes_concluidas
    FROM metas_comerciais m
    JOIN indicadores_carteira i ON i.id = m.indicador_id
    LEFT JOIN indicadores_carteira fi ON fi.id = m.fonte_indicador_id`

export type LancamentoBruto = { indicador_id: string; referencia: string; valor: string }

/** O que a avaliação precisa além das linhas — tudo lido sob a RLS de quem chama. */
export type ContextoDaAvaliacao = {
  readonly agora: Date
  readonly fuso: string
  readonly lancamentos: ReadonlyMap<string, readonly LancamentoBruto[]>
  readonly planilhas: ReadonlyMap<string, PlanilhaInterpretada>
  /** Dia da reunião fixa por cliente (1 = segunda … 7); o protótipo usa 1 sem reunião (L749). */
  readonly diaDaReuniao: ReadonlyMap<string, number>
}

/** Carrega lançamentos e planilhas das metas, numa conexão já sob a RLS da sessão. */
export async function carregarContexto(
  c: pg.PoolClient,
  metas: readonly LinhaDaMeta[],
  agora: Date,
  fuso: string,
): Promise<ContextoDaAvaliacao> {
  const indicadores = [
    ...new Set(metas.flatMap((m) => (m.fonte_indicador_id ? [m.indicador_id, m.fonte_indicador_id] : [m.indicador_id]))),
  ]
  const clientes = [...new Set(metas.map((m) => m.cliente_carteira_id))]
  const lancamentos = new Map<string, LancamentoBruto[]>()
  const planilhas = new Map<string, PlanilhaInterpretada>()
  const diaDaReuniao = new Map<string, number>()
  if (indicadores.length > 0) {
    const r = await c.query<LancamentoBruto>(
      `SELECT indicador_id, referencia::text AS referencia, coalesce(valor_centavos, valor_inteiro)::text AS valor
         FROM lancamentos_de_indicador WHERE indicador_id = ANY($1) ORDER BY referencia`,
      [indicadores],
    )
    for (const l of r.rows) lancamentos.set(l.indicador_id, [...(lancamentos.get(l.indicador_id) ?? []), l])
  }
  if (clientes.length > 0) {
    if (metas.some((m) => m.fonte === 'planilha')) {
      const p = await c.query<{ cliente_carteira_id: string; resultado: unknown }>(
        'SELECT cliente_carteira_id, resultado FROM planilhas_do_cliente WHERE cliente_carteira_id = ANY($1)',
        [clientes],
      )
      for (const x of p.rows) {
        const planilha = planilhaDoJson(x.resultado)
        if (planilha) planilhas.set(x.cliente_carteira_id, planilha)
      }
    }
    const d = await c.query<{ id: string; reuniao_dia_semana: number | null }>(
      'SELECT id, reuniao_dia_semana FROM clientes_carteira WHERE id = ANY($1)',
      [clientes],
    )
    for (const x of d.rows) diaDaReuniao.set(x.id, x.reuniao_dia_semana ?? 1)
  }
  return { agora, fuso, lancamentos, planilhas, diaDaReuniao }
}

const AGREGACAO_DA_PLANILHA = { ultima: 'última semana', media4: 'média de 4 semanas', soma4: 'soma de 4 semanas' } as const

/** O texto da fonte, como `fontesMeta` (L730-735) o escreve no seletor. */
export function rotuloDaFonte(fonte: string, nomeDoIndicador: string | null): string {
  if (fonte === 'lancamento') return 'Lançado semanalmente na reunião de metas'
  if (fonte.startsWith('ind:')) return `Indicador · ${nomeDoIndicador ?? '—'} (último lançamento)`
  const pl = lerFonteDaPlanilha(fonte)
  if (pl === null) return 'Planilha'
  const metrica = metricaDaFrente(pl.frente, pl.metrica)
  return `Planilha · ${PLANILHA_DE_INDICADORES[pl.frente].aba} · ${metrica?.nome ?? pl.metrica} (${AGREGACAO_DA_PLANILHA[pl.agregacao]})`
}

export function fonteDaLinha(m: Pick<LinhaDaMeta, 'fonte' | 'fonte_indicador_id' | 'fonte_planilha'>): FonteDaMetaCarteira {
  if (m.fonte === 'indicador' && m.fonte_indicador_id) return `ind:${m.fonte_indicador_id}`
  if (m.fonte === 'planilha' && m.fonte_planilha) return m.fonte_planilha
  return 'lancamento'
}

/**
 * Os lançamentos que a agregação aceita, na referência da SEGUNDA-FEIRA.
 *
 * O domínio recusa referência fora da segunda (CE-4). Linhas antigas, de
 * antes da validação na entrada, podem existir (view
 * `lancamentos_fora_da_segunda`, migration 0052) e são tratadas assim, sem
 * mexer em dado nenhum (regra 27):
 *  - `ultimo`: o valor mais recente de cada semana, na segunda dela. Contar
 *    "o último" nunca dobra nada, então a linha legada continua valendo.
 *  - `soma`/`media`: SÓ as linhas na segunda. Uma terça e uma quinta na
 *    mesma semana somariam a semana duas vezes; até a reconciliação humana,
 *    a linha legada fica fora da conta.
 */
export function lancamentosDaSemana(brutos: readonly LancamentoBruto[], agregacao: AgregacaoDeMeta): LancamentoDeMeta[] {
  if (agregacao !== 'ultimo') {
    return brutos.filter((l) => segundaDaSemana(l.referencia) === l.referencia).map((l) => ({ referencia: l.referencia, valor: BigInt(l.valor) }))
  }
  const porSemana = new Map<string, LancamentoBruto>()
  for (const l of brutos) {
    const seg = segundaDaSemana(l.referencia)
    const atual = porSemana.get(seg)
    if (atual === undefined || l.referencia > atual.referencia) porSemana.set(seg, l)
  }
  return [...porSemana.entries()].map(([referencia, l]) => ({ referencia, valor: BigInt(l.valor) }))
}

const primeiroDoMes = (mes: string, deslocamento: number): string => {
  const [a = 1970, m = 1] = mes.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1 + deslocamento, 1))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Um instante no meio do mês, para `agregarLancamentos` recortar aquele mês no fuso dado. */
const meioDoMes = (mes: string): Date => new Date(`${mes}-15T12:00:00Z`)

function numero(r: Racional, unidade: UnidadeDeMeta): { valor: string | null; numero: string | null; escala: 'centavos' | 'centesimos' | 'decimos' } {
  const x = valorParaExibicao(r, unidade)
  return unidade === 'R$'
    ? { valor: x.valor.toString(), numero: null, escala: x.escala }
    : { valor: null, numero: x.valor.toString(), escala: x.escala }
}

/** Avalia UMA meta. Erro do domínio aqui é entrada impossível — vira exceção (defeito, não usuário). */
export function avaliarUmaMeta(m: LinhaDaMeta, ctx: ContextoDaAvaliacao): MetaAvaliada {
  const hoje = diaCivil(ctx.agora, ctx.fuso)
  const mes = hoje.slice(0, 7)
  const alvo = BigInt(m.valor_meta_centavos ?? m.valor_meta_inteiro ?? '0')
  const inicialTexto = m.valor_inicial_centavos ?? m.valor_inicial_inteiro
  const valorInicial = inicialTexto === null ? null : BigInt(inicialTexto)
  const sr = semanaDaReuniao(hoje, ctx.diaDaReuniao.get(m.cliente_carteira_id) ?? 1)
  const proprios = lancamentosDaSemana(ctx.lancamentos.get(m.indicador_id) ?? [], m.agregacao)
  const fonte = fonteDaLinha(m)
  const status: StatusDeMetaCarteira = m.status === 'concluida' ? 'atingida' : m.status

  let atual: Racional | null = null
  let automatico = false
  let tipoDaAvaliacao: TipoDeMeta = m.tipo
  let semanasPassadas = 0
  let semanasTotais = 1
  const semanas: MetaAvaliada['semanas'] = []
  const historico: MetaAvaliada['historico'] = []

  if (m.fonte === 'lancamento') {
    const r = agregarLancamentos(proprios, m.tipo, m.agregacao, { agora: ctx.agora, inicio: m.inicio }, ctx.fuso)
    if (r.tipo === 'erro') throw new Error(`agregar meta ${m.id}: ${r.erro.codigo}`)
    atual = r.valor
    if (m.tipo === 'mensal') {
      const doMes = segundasDoMes(mes)
      const lancadasNoMes = proprios.filter((l) => l.referencia.startsWith(mes))
      semanasPassadas = semanasPassadasDoMes(mes, sr, lancadasNoMes.map((l) => l.referencia))
      semanasTotais = doMes.length
      const valores = doMes.map((d) => lancadasNoMes.find((l) => l.referencia === d)?.valor ?? null)
      const maior = valores.reduce<bigint>((mx, v) => (v !== null && v > mx ? v : mx), 1n)
      doMes.forEach((d, i) => {
        const v = valores[i] ?? null
        const n = v === null ? null : numero({ num: v, den: 1n }, m.unidade)
        const altura = v === null ? null : Math.min(100, Math.max(8, Number((v * 100n) / maior)))
        semanas.push({ referencia: d, valor: n?.valor ?? null, numero: n?.numero ?? null, lancada: v !== null, altura })
      })
      // L761: os três meses anteriores, do mais antigo para o mais recente.
      for (let i = 3; i >= 1; i--) {
        const mm = primeiroDoMes(mes, -i)
        const x = agregarLancamentos(proprios, 'mensal', m.agregacao, { agora: meioDoMes(mm), inicio: null }, ctx.fuso)
        if (x.tipo === 'erro' || x.valor === null) continue
        const h = percentualDoHistorico(x.valor, alvo, m.sentido)
        historico.push({ mes: mm, percentual: h?.percentual ?? null, faixa: h?.faixa ?? null })
      }
    }
  } else {
    automatico = true
    if (m.fonte === 'indicador' && m.fonte_indicador_id) {
      const l = (ctx.lancamentos.get(m.fonte_indicador_id) ?? []).at(-1)
      if (l) atual = { num: BigInt(l.valor), den: 1n }
    } else if (m.fonte_planilha) {
      const pl = lerFonteDaPlanilha(m.fonte_planilha)
      const planilha = ctx.planilhas.get(m.cliente_carteira_id)
      if (pl && planilha) {
        const r = metricaDaPlanilha(planilha, pl, hoje)
        if (r.tipo === 'ok' && r.valor !== null) {
          // A planilha fala `%` em PONTOS; o indicador guarda centésimos.
          const fator = m.unidade === '%' ? 100n : 1n
          atual = { num: r.valor.num * fator, den: r.valor.den }
        }
      }
    }
    // Com fonte automática o protótipo não usa o ramo mensal (L755: `tipo ===
    // "mensal" && !m.fonte`): avalia pelo ramo de prazo — salvo o rótulo de
    // mensal com média/último, que continua "Na meta"/"Atenção" (L772, L775).
    tipoDaAvaliacao = m.tipo === 'mensal' && m.agregacao !== 'soma' ? 'mensal' : 'prazo'
  }

  const r = avaliarMeta({
    tipo: tipoDaAvaliacao,
    agregacao: m.agregacao,
    sentido: m.sentido,
    valorInicial,
    alvo,
    atual,
    semanasPassadas,
    semanasTotais,
    inicio: m.inicio,
    prazo: m.prazo,
    hoje,
  })
  if (r.tipo === 'erro') throw new Error(`avaliar meta ${m.id}: ${r.erro.codigo}`)
  const a = r.valor

  // L771-772: cancelada e atingida-manual são ESTADO da meta, não cálculo.
  let estado: MetaAvaliada['avaliacao']['estado'] = a.estado
  let detalhe: MetaAvaliada['avaliacao']['detalhe'] = a.detalhe
  if (status === 'cancelada') {
    estado = 'cancelada'
    detalhe = 'cancelada'
  } else if (status === 'atingida' && !a.bateu) {
    estado = 'atingida'
    detalhe = m.tipo === 'mensal' && m.agregacao !== 'soma' ? 'na_meta' : 'atingida'
  }

  const faltaLancar =
    status !== 'cancelada' && m.fonte === 'lancamento' && !proprios.some((l) => l.referencia === sr) ? sr : null

  return {
    id: m.id,
    clienteCarteiraId: m.cliente_carteira_id,
    indicadorId: m.indicador_id,
    indicadorNome: m.indicador_nome,
    unidade: m.unidade,
    titulo: m.titulo,
    tipo: m.tipo,
    agregacao: m.agregacao,
    sentido: m.sentido,
    fonte,
    fonteRotulo: rotuloDaFonte(fonte, m.fonte_indicador_nome),
    inicio: m.inicio,
    prazo: m.prazo,
    status,
    valorMeta: m.valor_meta_centavos,
    valorMetaInteiro: m.valor_meta_inteiro,
    valorInicial: m.valor_inicial_centavos,
    valorInicialInteiro: m.valor_inicial_inteiro,
    atual: atual === null ? null : numero(atual, m.unidade),
    automatico,
    avaliacao: {
      estado,
      detalhe,
      bateu: a.bateu,
      percentual: a.percentual,
      ritmoEsperado: a.ritmoEsperado,
    },
    semanas,
    historico,
    semanasPassadas: m.tipo === 'mensal' && m.fonte === 'lancamento' ? semanasPassadas : null,
    semanasDoMes: m.tipo === 'mensal' && m.fonte === 'lancamento' ? semanasTotais : null,
    faltaLancar,
    acoes: { concluidas: m.acoes_concluidas, total: m.acoes_total },
  }
}

export const avaliarMetas = (metas: readonly LinhaDaMeta[], ctx: ContextoDaAvaliacao): MetaAvaliada[] =>
  metas.map((m) => avaliarUmaMeta(m, ctx))

/** A ordem do painel (`peso`, L810): a pior primeiro. "Na meta" pesa como "Atingida" (L809). */
export const PESO_DO_DETALHE: Readonly<Record<MetaAvaliada['avaliacao']['detalhe'], number>> = {
  prazo_vencido: 0,
  abaixo_do_ritmo: 1,
  atencao: 2,
  sem_lancamento: 3,
  no_ritmo: 4,
  atingida: 5,
  na_meta: 5,
  cancelada: 9,
}

