import { diaDaSemanaIso } from './calendario-carteira'
import { Dinheiro } from './dinheiro'
import type { NivelDoSinal, SaudeDoCliente } from './prospeccao'
import { somarDias } from './relogio'

/**
 * **A VISÃO GERAL DA CARTEIRA** (G8 3B; `vPainel`, protótipo L1278–1331, e o
 * contador do menu, `renderNav` L1247–1248). Puro: sem I/O, sem relógio — o
 * "hoje" chega de quem chama, do relógio do SERVIDOR no fuso da carteira
 * (regras 22–24).
 *
 * Este módulo AGREGA, não decide: a saúde de cada cliente já chega derivada
 * (`saudeDerivadaDoCliente`), o sinal de cada lead já chega calculado
 * (`sinalDoLead`) e "atrasada" é a mesma definição de `acaoParaContrato`
 * (aberta e prazo antes de hoje, L1115). O que mora aqui é só a composição da
 * tela: os quatro KPIs, os baldes da saúde, a equipe, as reuniões da semana e
 * as próximas entregas.
 *
 * Ajustes do gate de números aplicados:
 *  - 11: MRR = Σ mensalidade (valor de contrato) dos `ativo`+`onboarding`, em
 *    `Dinheiro`.
 *  - 12 / D-22 item 12: ticket médio com `Dinheiro.media(n)`, `n` = só os que
 *    TÊM mensalidade. Sem nenhum, `null` (a tela mostra "—", nunca R$ 0,00).
 *  - 13: `bom + atenção + crítico + sem saúde = clientes ativos` — a saúde
 *    não registrada é balde próprio (o protótipo faz `n[undefined]++` e perde
 *    o cliente). Todos os KPIs leem o MESMO conjunto de clientes; as tarefas
 *    chegam já filtradas pelo mesmo escopo (o protótipo conta as de todos).
 */

export type StatusNaVisaoGeral = 'onboarding' | 'ativo' | 'pausado' | 'encerrado'

export type ClienteNaVisaoGeral = {
  readonly id: string
  readonly nome: string
  readonly status: StatusNaVisaoGeral
  readonly mensalidade: Dinheiro
  /** Já derivada (PP-3). `null` = nunca registrada. */
  readonly saude: SaudeDoCliente | null
  readonly responsavelId: string | null
  readonly responsavelNome: string | null
  /** 1 = segunda … 7 = domingo (ISO), `clientes_carteira.reuniao_dia_semana`. */
  readonly reuniaoDiaSemana: number | null
  readonly reuniaoHora: string | null
  readonly resumoDaUltimaReuniao: string | null
}

export type AcaoNaVisaoGeral = {
  readonly id: string
  readonly clienteId: string
  /** Nem concluída nem cancelada (`aberta`, L1114). */
  readonly aberta: boolean
  readonly prazo: string | null
}

/** Uma tarefa interna PENDENTE, já dentro do escopo da sessão. */
export type TarefaNaVisaoGeral = {
  readonly prazo: string
  readonly responsavelId: string | null
}

export type PessoaNaVisaoGeral = { readonly id: string; readonly nome: string }

export type EntradaDaVisaoGeral = {
  readonly clientes: readonly ClienteNaVisaoGeral[]
  readonly acoes: readonly AcaoNaVisaoGeral[]
  readonly tarefas: readonly TarefaNaVisaoGeral[]
  /** A equipe sem a diretoria (`papel !== 'admin'`, L1289). */
  readonly pessoas: readonly PessoaNaVisaoGeral[]
}

export type SegmentoDaBarra<K extends string> = { readonly chave: K; readonly inicio: number; readonly largura: number }

export type VisaoGeralDaCarteira = {
  readonly kpis: {
    readonly clientesAtivos: number
    readonly emOnboarding: number
    readonly mrr: Dinheiro
    readonly ticketMedio: Dinheiro | null
    readonly acoesAtrasadas: number
    readonly clientesComAcaoAtrasada: number
    readonly tarefasVencidas: number
    readonly tarefasVencemHoje: number
  }
  readonly saude: {
    readonly bom: number
    readonly atencao: number
    readonly critico: number
    readonly semSaude: number
    readonly barra: readonly SegmentoDaBarra<SaudeDoCliente | 'sem'>[]
    readonly emRisco: readonly {
      readonly id: string
      readonly nome: string
      readonly saude: 'atencao' | 'critico'
      readonly resumoDaUltimaReuniao: string | null
      readonly acoesAtrasadas: number
      readonly responsavelNome: string | null
    }[]
  }
  readonly equipe: {
    readonly pessoas: readonly {
      readonly id: string
      readonly nome: string
      readonly iniciais: string
      readonly clientes: number
      readonly pendentes: number
      readonly vencidas: number
      readonly barra: readonly SegmentoDaBarra<'emDia' | 'vencidas'>[]
    }[]
    /** O maior número de pendentes (mínimo 1): o comprimento de toda barra. */
    readonly escala: number
  }
  readonly reunioesDaSemana: readonly {
    readonly clienteId: string
    readonly nome: string
    readonly diaDaSemana: number
    readonly hora: string | null
    readonly ehHoje: boolean
  }[]
  /** Os ids das ações, na ordem da tela. */
  readonly proximasEntregas: readonly string[]
}

const ehAtivo = (c: ClienteNaVisaoGeral): boolean => c.status === 'ativo' || c.status === 'onboarding'

/** Aberta e prazo antes de hoje — a mesma definição de `acaoParaContrato` (L1115). */
const atrasada = (a: AcaoNaVisaoGeral, hoje: string): boolean => a.aberta && a.prazo !== null && a.prazo < hoje

/** `ini` (L1112): as iniciais das duas primeiras palavras. */
export function iniciaisDoNome(nome: string): string {
  return nome
    .split(/\s+/)
    .filter((p) => p !== '')
    .slice(0, 2)
    .map((p) => p[0]!)
    .join('')
    .toUpperCase()
}

/**
 * As partes de uma barra empilhada, já posicionadas: cada segmento começa onde
 * o anterior termina. A tela só desenha (`<rect x={inicio} width={largura}>`
 * num `viewBox` do tamanho do total) — nenhuma conta de proporção no front.
 * Parte com zero não vira segmento.
 */
export function segmentosDaBarra<K extends string>(partes: readonly (readonly [K, number])[]): SegmentoDaBarra<K>[] {
  const fora: SegmentoDaBarra<K>[] = []
  let inicio = 0
  for (const [chave, n] of partes) {
    if (n <= 0) continue
    fora.push({ chave, inicio, largura: n })
    inicio += n
  }
  return fora
}

const PESO_DO_RISCO: Record<'critico' | 'atencao', number> = { critico: 0, atencao: 1 }

export function montarVisaoGeral(e: EntradaDaVisaoGeral, hoje: string): VisaoGeralDaCarteira {
  const ativos = e.clientes.filter(ehAtivo)
  const idsAtivos = new Set(ativos.map((c) => c.id))

  const mrr = ativos.reduce((soma, c) => soma.mais(c.mensalidade), Dinheiro.zero())
  const comMensalidade = ativos.filter((c) => c.mensalidade.ehMaiorQue(Dinheiro.zero())).length
  const ticketMedio = comMensalidade === 0 ? null : mrr.media(comMensalidade)

  const acoesAtrasadasAtivas = e.acoes.filter((a) => idsAtivos.has(a.clienteId) && atrasada(a, hoje))
  const atrasadasPorCliente = new Map<string, number>()
  for (const a of acoesAtrasadasAtivas) atrasadasPorCliente.set(a.clienteId, (atrasadasPorCliente.get(a.clienteId) ?? 0) + 1)

  const conta = (s: SaudeDoCliente | null) => ativos.filter((c) => c.saude === s).length
  const bom = conta('bom')
  const atencao = conta('atencao')
  const critico = conta('critico')
  const semSaude = conta(null)

  const emRisco = ativos
    .filter((c): c is ClienteNaVisaoGeral & { saude: 'atencao' | 'critico' } => c.saude === 'atencao' || c.saude === 'critico')
    .map((c, i) => ({ c, i }))
    .sort((a, b) => PESO_DO_RISCO[a.c.saude] - PESO_DO_RISCO[b.c.saude] || a.i - b.i)
    .map(({ c }) => ({
      id: c.id,
      nome: c.nome,
      saude: c.saude,
      resumoDaUltimaReuniao: c.resumoDaUltimaReuniao,
      acoesAtrasadas: atrasadasPorCliente.get(c.id) ?? 0,
      responsavelNome: c.responsavelNome,
    }))

  const pessoas = e.pessoas.map((p) => {
    const minhas = e.tarefas.filter((t) => t.responsavelId === p.id)
    const vencidas = minhas.filter((t) => t.prazo < hoje).length
    return {
      id: p.id,
      nome: p.nome,
      iniciais: iniciaisDoNome(p.nome),
      clientes: ativos.filter((c) => c.responsavelId === p.id).length,
      pendentes: minhas.length,
      vencidas,
      barra: segmentosDaBarra([
        ['emDia', minhas.length - vencidas],
        ['vencidas', vencidas],
      ] as const),
    }
  })

  const ds = diaDaSemanaIso(hoje)
  const reunioesDaSemana = ativos
    .filter((c): c is ClienteNaVisaoGeral & { reuniaoDiaSemana: number } => c.reuniaoDiaSemana !== null)
    .map((c) => ({
      clienteId: c.id,
      nome: c.nome,
      diaDaSemana: c.reuniaoDiaSemana,
      hora: c.reuniaoHora,
      ehHoje: c.reuniaoDiaSemana === ds,
    }))
    .sort((a, b) => a.diaDaSemana - b.diaDaSemana || (a.hora ?? '').localeCompare(b.hora ?? ''))

  const limite = somarDias(hoje, 7)
  const visiveis = new Set(e.clientes.map((c) => c.id))
  const proximasEntregas = e.acoes
    .filter((a): a is AcaoNaVisaoGeral & { prazo: string } => visiveis.has(a.clienteId) && a.aberta && a.prazo !== null && a.prazo <= limite)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => x.a.prazo.localeCompare(y.a.prazo) || x.i - y.i)
    .map(({ a }) => a.id)

  return {
    kpis: {
      clientesAtivos: ativos.length,
      emOnboarding: ativos.filter((c) => c.status === 'onboarding').length,
      mrr,
      ticketMedio,
      acoesAtrasadas: acoesAtrasadasAtivas.length,
      clientesComAcaoAtrasada: atrasadasPorCliente.size,
      tarefasVencidas: e.tarefas.filter((t) => t.prazo < hoje).length,
      tarefasVencemHoje: e.tarefas.filter((t) => t.prazo === hoje).length,
    },
    saude: {
      bom,
      atencao,
      critico,
      semSaude,
      barra: segmentosDaBarra([
        ['bom', bom],
        ['atencao', atencao],
        ['critico', critico],
        ['sem', semSaude],
      ] as const),
      emRisco,
    },
    equipe: { pessoas, escala: Math.max(1, ...pessoas.map((p) => p.pendentes)) },
    reunioesDaSemana,
    proximasEntregas,
  }
}

/**
 * Os dois contadores vermelhos do menu (`renderNav`, L1247–1248):
 *  - **tarefas vencidas** em "Minhas tarefas": de todo mundo para quem
 *    administra (a diretoria do protótipo, `admin()`), só as próprias para os
 *    demais. As tarefas chegam já no escopo da sessão.
 *  - **contatos "agora"** na Prospecção: o nível do sinal de cada lead
 *    visível, já calculado por `sinalDoLead`.
 */
export function contadoresDoMenu(
  e: {
    readonly tarefas: readonly TarefaNaVisaoGeral[]
    readonly eu: string
    readonly veTodas: boolean
    readonly sinais: readonly (NivelDoSinal | null)[]
  },
  hoje: string,
): { tarefasVencidas: number; contatosAgora: number } {
  return {
    tarefasVencidas: e.tarefas.filter((t) => t.prazo < hoje && (e.veTodas || t.responsavelId === e.eu)).length,
    contatosAgora: e.sinais.filter((s) => s === 'agora').length,
  }
}
