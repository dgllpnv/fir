/**
 * G8 2C — checklists dos programas e entrada de cliente (X3, X5, V3, V15, C4,
 * C6). Só as DECISÕES, puras: qual checklist vale para o cliente, a quem vai
 * cada item, quando vence, o que entra feito, o progresso e o que falta na
 * entrada de quem já era cliente. Gravar e conferir grupo é do serviço
 * (`apps/api/src/carteira/checklists`).
 *
 * Fonte: `versoes/firmare-gestao-prototipo/index.html` — `chaveModelo` L564,
 * `quemExecuta` L918–923, `checklistDe` L924–931, `progChecklist` L2613–2619,
 * `faltasMigracao` L1715–1721, `clienteExistente` L1739–1740.
 */
import { segundaDaSemana } from './metas-carteira'
import { somarDias } from './relogio'

/** `QUEM` (L561). Decide só a quem vai a tarefa; nunca autorização (appsec A-4). */
export const QUEM_EXECUTA = ['responsavel', 'admin', 'comercial', 'administrativo', 'financeiro'] as const
export type QuemExecuta = (typeof QUEM_EXECUTA)[number]
export type SetorDaEquipe = 'comercial' | 'administrativo' | 'financeiro'

export const ROTULO_DE_QUEM_EXECUTA: Readonly<Record<QuemExecuta, string>> = {
  responsavel: 'Responsável pela carteira',
  admin: 'Diretoria',
  comercial: 'Comercial',
  administrativo: 'Administrativo',
  financeiro: 'Financeiro',
}

/**
 * Uma pessoa da equipe Firmare que pode receber um item. `diretoria` e
 * `setor` existem no modelo do protótipo (`papel === 'admin'`, `setor`); na
 * carteira ainda não há coluna para eles (ticket 0.5, T1) — o serviço passa
 * `diretoria = escopo 'geral'` e `setor = null` até lá, e esta função não
 * muda quando a 0.5 entrar.
 */
export type PessoaDaEquipe = {
  readonly id: string
  readonly ativo: boolean
  readonly diretoria: boolean
  readonly setor: SetorDaEquipe | null
}

/** "Acelerador FIR · Comercial" vence "Acelerador FIR" quando existe (L564). */
export function chaveDoModelo(produto: string, areaFoco: string | null, chavesExistentes: readonly string[]): string {
  if (areaFoco !== null) {
    const composta = rotuloDoModelo(produto, areaFoco)
    if (chavesExistentes.includes(composta)) return composta
  }
  return produto
}

export function rotuloDoModelo(produto: string, areaFoco: string | null): string {
  return areaFoco === null ? produto : `${produto} · ${areaFoco}`
}

/**
 * `quemExecuta` (L918–923), com a última rede que o protótipo não precisa
 * (ele sempre tem uma diretoria): sem ninguém elegível, vai para QUEM
 * APLICOU o checklist — uma tarefa sem responsável não aparece na rotina de
 * ninguém e some.
 */
export function quemExecutaItem(
  quem: QuemExecuta,
  responsavelId: string | null,
  equipe: readonly PessoaDaEquipe[],
  atorId: string,
): string {
  const ativos = equipe.filter((p) => p.ativo)
  const diretoria = ativos.find((p) => p.diretoria)?.id
  const responsavel = responsavelId !== null && ativos.some((p) => p.id === responsavelId) ? responsavelId : undefined
  if (quem === 'admin') return diretoria ?? responsavel ?? atorId
  if (quem === 'responsavel') return responsavel ?? diretoria ?? atorId
  return ativos.find((p) => p.setor === quem)?.id ?? responsavel ?? diretoria ?? atorId
}

export type ItemParaAplicar = {
  readonly id: string
  readonly dias: number
  readonly titulo: string
  readonly quem: QuemExecuta
  readonly acao: 'diagnostico' | null
  readonly ordem: number
}

export type TarefaDoChecklistAGerar = {
  readonly itemId: string
  readonly titulo: string
  readonly dias: number
  readonly acao: 'diagnostico' | null
  readonly ordem: number
  readonly prazo: string
  readonly responsavelId: string
  readonly entraFeito: boolean
}

/**
 * `checklistDe` (L924–931). `inicio` e `hoje` são dias civis no fuso da
 * Firmare, calculados no servidor (regra 24). Na entrada de quem já era
 * cliente (`marcarVencidosComoFeitos`), o item com prazo ANTES de hoje entra
 * feito (`t.prazo < iso(HOJE)`, L1740) — o de hoje fica pela frente.
 */
export function tarefasDoChecklist(
  itens: readonly ItemParaAplicar[],
  ctx: {
    readonly inicio: string
    readonly hoje: string
    readonly marcarVencidosComoFeitos: boolean
    readonly responsavelId: string | null
    readonly equipe: readonly PessoaDaEquipe[]
    readonly atorId: string
  },
): TarefaDoChecklistAGerar[] {
  return [...itens]
    .sort((a, b) => a.dias - b.dias || a.ordem - b.ordem)
    .map((it) => {
      const prazo = somarDias(ctx.inicio, it.dias)
      return {
        itemId: it.id,
        titulo: it.titulo,
        dias: it.dias,
        acao: it.acao,
        ordem: it.ordem,
        prazo,
        responsavelId: quemExecutaItem(it.quem, ctx.responsavelId, ctx.equipe, ctx.atorId),
        entraFeito: ctx.marcarVencidosComoFeitos && prazo < ctx.hoje,
      }
    })
}

export type TarefaDoChecklistNaFicha = {
  readonly id: string
  readonly titulo: string
  readonly prazo: string
  readonly status: 'pendente' | 'concluida' | 'cancelada'
  readonly responsavelId: string | null
}

export type ProgressoDoChecklist = {
  readonly total: number
  readonly concluidos: number
  readonly atrasados: number
  readonly proximoId: string | null
}

/**
 * `progChecklist` (L2613–2619). A tarefa cancelada não conta: ela saiu da
 * rotina, e contá-la deixaria o checklist eternamente incompleto.
 */
export function progressoDoChecklist(tarefas: readonly TarefaDoChecklistNaFicha[], hoje: string): ProgressoDoChecklist {
  const vivas = tarefas.filter((t) => t.status !== 'cancelada')
  const abertas = vivas.filter((t) => t.status === 'pendente')
  const proximo = [...abertas].sort((a, b) => a.prazo.localeCompare(b.prazo) || a.id.localeCompare(b.id))[0]
  return {
    total: vivas.length,
    concluidos: vivas.filter((t) => t.status === 'concluida').length,
    atrasados: abertas.filter((t) => t.prazo < hoje).length,
    proximoId: proximo?.id ?? null,
  }
}

export type FrenteDoRelatorio = 'financeiro' | 'comercial' | 'trafego' | 'marketing'
const ROTULO_DA_FRENTE: Readonly<Record<FrenteDoRelatorio, string>> = {
  financeiro: 'financeiro',
  comercial: 'comercial',
  trafego: 'tráfego pago',
  marketing: 'marketing',
}

export type FaltaDaEntrada = { readonly codigo: 'links' | 'metas' | 'parceiros'; readonly texto: string }

/**
 * `faltasMigracao` (L1715–1721), menos o "Dia do vencimento": aquele depende
 * de a mensalidade ser maior que zero, e responder isso a quem não tem
 * `valores` é revelar o campo apagado. Ele volta quando a carteira tiver a
 * chave (ticket 0.5).
 */
export function faltasDaEntrada(dados: {
  readonly links: { readonly painel: boolean; readonly dashFin: boolean; readonly dashInd: boolean; readonly rotina: boolean }
  readonly temMetasEmAndamento: boolean
  readonly recebeRelatorioSemanal: boolean
  readonly frentesSemParceiroCompleto: readonly FrenteDoRelatorio[]
}): FaltaDaEntrada[] {
  const f: FaltaDaEntrada[] = []
  // A ordem de `LINKS` (L627).
  const links = (
    [
      [dados.links.painel, 'Painel do cliente'],
      [dados.links.dashFin, 'Dash financeiro'],
      [dados.links.dashInd, 'Dash de indicadores'],
      [dados.links.rotina, 'Gestor de rotinas'],
    ] as const
  )
    .filter(([tem]) => !tem)
    .map(([, rotulo]) => rotulo)
  if (links.length > 0) f.push({ codigo: 'links', texto: `Links: ${links.join(', ')}` })
  if (!dados.temMetasEmAndamento) f.push({ codigo: 'metas', texto: 'Metas em andamento' })
  if (dados.recebeRelatorioSemanal && dados.frentesSemParceiroCompleto.length > 0) {
    const frentes = dados.frentesSemParceiroCompleto.map((x) => ROTULO_DA_FRENTE[x])
    f.push({ codigo: 'parceiros', texto: `Parceiros e formulários de ${frentes.join(', ')}` })
  }
  return f
}

/** A semana de carga (R7): segunda a domingo, bordas inclusivas em dia civil. */
export function semanaDaCarga(hoje: string): { inicio: string; fim: string } {
  const inicio = segundaDaSemana(hoje)
  return { inicio, fim: somarDias(inicio, 6) }
}
