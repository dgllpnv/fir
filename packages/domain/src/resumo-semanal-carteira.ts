import { type CelulaDeCampanha, type CelulaExibida, suprimirCampanhas } from './campanhas-carteira'
import { Dinheiro } from './dinheiro'
import { segundaDaSemana } from './metas-carteira'
import type { SaudeDoCliente } from './prospeccao'
import { somarDias } from './relogio'

/**
 * **RESUMO SEMANAL DA CARTEIRA** (G8 3C, item S1; protótipo `textoResumo` e
 * `vResumo`, `versoes/firmare-gestao-prototipo/index.html` L2004-2025).
 *
 * No protótipo é uma TELA com um texto pronto e o botão "Copiar texto", "para
 * colar no WhatsApp da equipe ou enviar para a liderança". Não há e-mail, não
 * há envio agendado, não há destinatário: quem abre a tela copia. Por isso
 * isto é uma função pura chamada por um `GET`, e não um job.
 *
 * O texto é montado AQUI, com a redação já aplicada (gate appsec A-14, LGPD
 * §5 item 4, números ajuste 37): o `RedacaoInterceptor` decide por nome de
 * campo e não enxerga dinheiro dentro de uma string. Sem `valores`, nenhum
 * valor monetário entra no texto — nem o MRR, nem resultado ou meta de
 * campanha de receita.
 *
 * Divergências deliberadas do protótipo (gate de números 3.7, ajustes 35-37,
 * ADR 0021):
 *  - Um escopo só: ações e campanhas só dos clientes da entrada. O protótipo
 *    mistura `vis()` com `db.acoes` inteiro.
 *  - Uma janela só: "concluídas" conta a semana do cabeçalho, `[segunda,
 *    segunda + 7)` no fuso da carteira. O protótipo diz "segunda a domingo"
 *    no cabeçalho e conta 8 dias móveis (`diff ≥ −7`).
 *  - Campanha passa por `suprimirCampanhas` (LGPD A20): a suprimida não
 *    aparece pelo nome, só na contagem.
 *  - Cliente sem saúde registrada é contado à parte. No protótipo todo
 *    cliente tem saúde; aqui ela é derivada e pode não existir ainda.
 *  - Concordância de número ("1 ação", "Permanece 1"): o protótipo escreve
 *    "1 ações" sempre.
 */

export type SemanaDoResumo = {
  /** A segunda-feira. */
  readonly inicio: string
  /** O domingo, último dia do cabeçalho. */
  readonly ultimoDia: string
  /** A segunda seguinte: a janela é `[inicio, fimExclusivo)`. */
  readonly fimExclusivo: string
}

/** A semana que contém `hoje` (dia civil no fuso da carteira), de segunda a segunda. */
export function semanaDoResumo(hoje: string): SemanaDoResumo {
  const inicio = segundaDaSemana(hoje)
  return { inicio, ultimoDia: somarDias(inicio, 6), fimExclusivo: somarDias(inicio, 7) }
}

export type ClienteNoResumo = {
  readonly id: string
  readonly nome: string
  /** `ativo` ou `onboarding` (`ativos()` do protótipo, L1120). */
  readonly ativo: boolean
  readonly saude: SaudeDoCliente | null
  /** Valor de contrato, antes do desconto (gate de números 3.2). */
  readonly mensalidade: Dinheiro
  /** A ata mais recente pela data da reunião (`ultimaReuniao`, L1333). */
  readonly ultimaReuniao: { readonly resumo: string; readonly encaminhamentos: string | null } | null
}

export type AcaoNoResumo = {
  readonly clienteId: string
  readonly status: 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
  readonly prazo: string | null
  /** O dia civil, no fuso da carteira, em que foi concluída. */
  readonly concluidaNoDia: string | null
}

export type CampanhaNoResumo = {
  readonly celula: CelulaDeCampanha
  readonly rotuloDaMetrica: string
}

export type PessoaNoResumo = {
  readonly nome: string
  /** O prazo de cada tarefa interna aberta da pessoa, dentro do escopo. */
  readonly prazosPendentes: readonly string[]
}

export type EntradaDoResumoSemanal = {
  /** Dia civil no fuso da carteira, do relógio do servidor (regra 24). */
  readonly hoje: string
  readonly podeVerValores: boolean
  /** Todos os clientes visíveis à sessão, de qualquer status. */
  readonly clientes: readonly ClienteNoResumo[]
  readonly acoes: readonly AcaoNoResumo[]
  readonly campanhas: readonly CampanhaNoResumo[]
  readonly equipe: readonly PessoaNoResumo[]
}

export type ResumoSemanal = {
  readonly semana: SemanaDoResumo
  readonly texto: string
  /** Os clientes cuja ata entrou no texto: quem chama registra o acesso (regra 18). */
  readonly atasCitadas: readonly string[]
}

/**
 * "Em risco" (L2012): ativo, em atenção ou crítico. Exportada para quem lê o
 * banco buscar a ata SÓ destes clientes (minimização, regra 18).
 */
export const clienteEmRisco = (c: Pick<ClienteNoResumo, 'ativo' | 'saude'>): boolean =>
  c.ativo && (c.saude === 'atencao' || c.saude === 'critico')

const ROTULO_DA_SAUDE:Readonly<Record<SaudeDoCliente, string>> = { bom: 'bom', atencao: 'atenção', critico: 'crítico' }

const dm = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`

const aberta = (a: AcaoNoResumo): boolean => a.status !== 'concluida' && a.status !== 'cancelada'

/** `atrasada` do protótipo (L1115): aberta, com prazo antes de hoje. */
const atrasada = (a: AcaoNoResumo, hoje: string): boolean => aberta(a) && a.prazo !== null && a.prazo < hoje

function linhaDaCampanha(c: CelulaExibida, nomeDoCliente: string, rotulo: string, podeVerValores: boolean): string {
  const pct = c.percentualDaMeta ?? 0
  // `rotulo_da_metrica` nasce '' (migration 0043): sem rótulo, a frase fecha sem ele.
  const metrica = rotulo.trim().toLowerCase()
  const cabeca = `• ${nomeDoCliente} · ${c.nome}: `
  if (c.resultadoEmDinheiro && !podeVerValores) return `${cabeca}${pct}% da meta${metrica ? ` de ${metrica}` : ''}`
  const num = (v: bigint): string => (c.resultadoEmDinheiro ? Dinheiro.deCentavos(v).formatar() : v.toString())
  return `${cabeca}${num(c.resultado!)} de ${num(c.meta!)}${metrica ? ` ${metrica}` : ''} (${pct}%)`
}

export function montarResumoSemanal(e: EntradaDoResumoSemanal): ResumoSemanal {
  const semana = semanaDoResumo(e.hoje)
  const nomes = new Map(e.clientes.map((c) => [c.id, c.nome]))
  const ativos = e.clientes.filter((c) => c.ativo)
  // Ajuste 35: um escopo só. Nada de cliente que não veio na entrada.
  const acoes = e.acoes.filter((a) => nomes.has(a.clienteId))

  const partes: string[] = [`RESUMO SEMANAL · semana de ${dm(semana.inicio)} a ${dm(semana.ultimoDia)}`]

  // CARTEIRA
  const n = { bom: 0, atencao: 0, critico: 0, sem: 0 }
  for (const c of ativos) {
    if (c.saude === null) n.sem += 1
    else n[c.saude] += 1
  }
  let carteira =
    `CARTEIRA\n${plural(ativos.length, 'cliente ativo', 'clientes ativos')}: ${n.bom} em bom, ${n.atencao} em atenção, ` +
    `${plural(n.critico, 'crítico', 'críticos')}${n.sem > 0 ? `, ${n.sem} sem saúde registrada` : ''}.`
  if (e.podeVerValores) {
    const mrr = ativos.reduce((s, c) => s.mais(c.mensalidade), Dinheiro.zero())
    carteira += `\nReceita recorrente mensal: ${mrr.formatar()}.`
  }
  partes.push(carteira)

  // EM RISCO — crítico antes de atenção, depois pelo nome.
  const risco = ativos
    .filter(clienteEmRisco)
    .sort((a, b) => Number(b.saude === 'critico') - Number(a.saude === 'critico') || a.nome.localeCompare(b.nome, 'pt-BR'))
  const atrasadas = acoes.filter((a) => atrasada(a, e.hoje))
  const atasCitadas: string[] = []
  const linhasDeRisco = risco.map((c) => {
    const r = c.ultimaReuniao
    if (r !== null) atasCitadas.push(c.id)
    const a = atrasadas.filter((x) => x.clienteId === c.id).length
    const atraso = a > 0 ? ` ${a} ${a > 1 ? 'ações atrasadas' : 'ação atrasada'}.` : ''
    const enc = r?.encaminhamentos?.trim() ? r.encaminhamentos : 'a definir'
    return `• ${c.nome} (${ROTULO_DA_SAUDE[c.saude!]}): ${r ? r.resumo : 'sem reunião registrada.'}${atraso} Encaminhamento: ${enc}`
  })
  partes.push(`EM RISCO\n${linhasDeRisco.length > 0 ? linhasDeRisco.join('\n') : 'Nenhum cliente em risco.'}`)

  // PLANO DE AÇÃO — "concluídas" na semana do cabeçalho (ajuste 36).
  const conc = acoes.filter(
    (a) => a.status === 'concluida' && a.concluidaNoDia !== null && a.concluidaNoDia >= semana.inicio && a.concluidaNoDia < semana.fimExclusivo,
  ).length
  // Ordem alfabética: o protótipo segue a ordem do array, que aqui viria do
  // banco sem garantia — e três leituras iguais precisam dar o mesmo texto.
  const ondeAtrasa = [...new Set(atrasadas.map((a) => nomes.get(a.clienteId)!))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  partes.push(
    `PLANO DE AÇÃO\n${conc === 1 ? 'Foi concluída 1 ação' : `Foram concluídas ${conc} ações`} nesta semana. ` +
      `${atrasadas.length === 1 ? 'Permanece 1 ação atrasada' : `Permanecem ${atrasadas.length} ações atrasadas`}` +
      (atrasadas.length > 0 ? `, ${atrasadas.length === 1 ? 'concentrada' : 'concentradas'} em: ${ondeAtrasa.join(', ')}.` : '.'),
  )

  // CAMPANHAS ATIVAS — a célula mais recente de cada campanha, pela supressão (LGPD A20).
  const maisRecente = new Map<string, CampanhaNoResumo>()
  for (const k of e.campanhas) {
    const c = k.celula
    if (c.status !== 'ativa' || !nomes.has(c.clienteId)) continue
    const atual = maisRecente.get(c.campanhaChave)
    if (atual === undefined || c.mes > atual.celula.mes) maisRecente.set(c.campanhaChave, k)
  }
  const candidatas = [...maisRecente.values()]
  const rotulos = new Map(candidatas.map((k) => [k.celula.id, k.rotuloDaMetrica]))
  const supressao = suprimirCampanhas(candidatas.map((k) => k.celula))
  const visiveis = supressao.celulas.filter(
    (c): c is CelulaExibida => !c.suprimida && c.resultado !== null && c.meta !== null && c.meta > 0n,
  )
  const suprimidasComMeta = supressao.celulas.filter((c) => c.suprimida && c.meta !== null && c.meta > 0n).length
  if (visiveis.length > 0 || suprimidasComMeta > 0) {
    const linhas = visiveis
      .sort((a, b) => nomes.get(a.clienteId)!.localeCompare(nomes.get(b.clienteId)!, 'pt-BR') || a.nome.localeCompare(b.nome, 'pt-BR'))
      .map((c) => linhaDaCampanha(c, nomes.get(c.clienteId)!, rotulos.get(c.id) ?? '', e.podeVerValores))
    if (suprimidasComMeta > 0) {
      linhas.push(
        `• Mais ${plural(suprimidasComMeta, 'campanha ativa', 'campanhas ativas')} sem detalhe (poucos pagamentos para exibir).`,
      )
    }
    partes.push(`CAMPANHAS ATIVAS\n${linhas.join('\n')}`)
  }

  // EQUIPE
  const equipe = e.equipe.map((p) => {
    const v = p.prazosPendentes.filter((prazo) => prazo < e.hoje).length
    return `• ${p.nome}: ${plural(p.prazosPendentes.length, 'tarefa pendente', 'tarefas pendentes')}${v > 0 ? `, ${plural(v, 'vencida', 'vencidas')}` : ', nenhuma vencida'}.`
  })
  partes.push(`EQUIPE\n${equipe.length > 0 ? equipe.join('\n') : 'Nenhuma pessoa na equipe.'}`)

  // PRIORIDADE DA SEMANA
  partes.push(
    `PRIORIDADE DA SEMANA\n${
      risco.length > 0
        ? `Atuar nos clientes em risco (${risco.map((c) => c.nome).join(', ')}) e zerar as ações e tarefas atrasadas.`
        : 'Zerar as ações e tarefas atrasadas.'
    }`,
  )

  return { semana, texto: partes.join('\n\n'), atasCitadas }
}
