import { erro, erroDe, ok, type Result } from './resultado'
import { inicioDoDia, janela, somarDias } from './relogio'

/**
 * **A JANELA DE VÍNCULO DA CAMPANHA** — uma função, usada pela lista e pela
 * validação da escrita (correções da PO, A3 · S-10, N-7).
 *
 * Duas perguntas diferentes, e o protótipo responde cada uma com um filtro:
 *
 *  - **tarefa e recebimento** (`campanhasAtivasPara`, L2826): a campanha que
 *    ainda faz sentido para vincular — não encerrada há mais de 30 dias. A
 *    futura entra (o filtro dela é só `fim >= hoje − 30`), e a recepção que
 *    agenda a primeira ligação de uma campanha que começa segunda pode marcá-la;
 *  - **paciente** (`campAtivasHoje`, L2818): "Chegou por uma campanha?" só
 *    oferece as **em andamento hoje** — ninguém chega por uma campanha que
 *    ainda não começou ou que já acabou.
 *
 * **As datas da campanha são dias civis FECHADOS** ("de 1 a 30 de novembro"),
 * e a comparação acontece em INSTANTES, na janela semiaberta da regra 23:
 * `[início(inicio), início(fim + 1))`, com as bordas no fuso da CLÍNICA. É o
 * mesmo que `inicio <= hoje <= fim` sobre o dia civil da clínica — e o teste
 * de propriedade prova a equivalência —, mas escrito na convenção única do
 * sistema, para que ninguém reescreva esta janela com `BETWEEN` e um `hoje`
 * calculado em UTC (às 23:30 de São Paulo já é amanhã em UTC).
 *
 * **O relógio é argumento** (`agora`), nunca `new Date()`: a data de negócio é
 * do servidor (regra 24), e o teste precisa fixar 23:30.
 */

export const CONTEXTOS_DE_VINCULO = ['tarefa', 'paciente'] as const
export type ContextoDeVinculo = (typeof CONTEXTOS_DE_VINCULO)[number]

/** Quantos dias depois do FIM a campanha ainda aceita tarefa e recebimento. */
export const DIAS_DE_VINCULO_DEPOIS_DO_FIM = 30

/** O que a regra precisa saber da campanha. `excluida` é o soft delete. */
export type CampanhaDeVinculo = {
  readonly id: string
  readonly nome: string
  /** Dia civil `aaaa-mm-dd`, no calendário da clínica. */
  readonly inicio: string
  readonly fim: string
  readonly excluida: boolean
}

/** O item da lista: `id` e `nome`, e NADA mais (S-9, L-A3-2). */
export type CampanhaVinculavel = { readonly id: string; readonly nome: string }

/**
 * A janela, em instantes UTC, em que a campanha aceita vínculo.
 *
 * `de: null` é "sem borda de baixo": a tarefa pode ser de uma campanha que
 * ainda não começou.
 */
export function janelaDeVinculo(
  c: Pick<CampanhaDeVinculo, 'inicio' | 'fim'>,
  contexto: ContextoDeVinculo,
  fuso: string,
): { readonly de: Date | null; readonly ate: Date } {
  if (contexto === 'paciente') return janela(c.inicio, c.fim, fuso)
  // `fim + 30` é o último dia que entra; a borda de cima é o início do dia
  // SEGUINTE a ele — semiaberta, como toda janela do sistema.
  return { de: null, ate: inicioDoDia(somarDias(c.fim, DIAS_DE_VINCULO_DEPOIS_DO_FIM + 1), fuso) }
}

/** `agora` cai na janela semiaberta `[de, ate)`? `de: null` é sem borda de baixo. */
const dentroDaJanela = (j: { readonly de: Date | null; readonly ate: Date }, agora: Date): boolean => {
  const t = agora.getTime()
  return (j.de === null || t >= j.de.getTime()) && t < j.ate.getTime()
}

/** A campanha aceita vínculo NOVO agora? Excluída nunca aceita. */
export function aceitaVinculo(
  c: CampanhaDeVinculo,
  contexto: ContextoDeVinculo,
  agora: Date,
  fuso: string,
): boolean {
  if (c.excluida) return false
  return dentroDaJanela(janelaDeVinculo(c, contexto, fuso), agora)
}

/**
 * Em andamento agora: a janela do paciente, que é a da campanha inteira.
 *
 * Exportada porque a SITUAÇÃO da campanha na tela de Campanhas
 * (`campanhas.service.ts`) é esta mesma pergunta, e uma segunda escrita de
 * "`inicio <= hoje <= fim`" é como as duas telas passam a discordar sobre o
 * último dia. Excluída não importa aqui: a pergunta é sobre as datas.
 */
export const emAndamento = (
  c: Pick<CampanhaDeVinculo, 'inicio' | 'fim'>,
  agora: Date,
  fuso: string,
): boolean => dentroDaJanela(janelaDeVinculo(c, 'paciente', fuso), agora)

/**
 * A lista que a tela mostra, na ordem do protótipo: **em andamento primeiro**,
 * depois as demais; dentro de cada grupo, a que começou por último antes; e o
 * nome desempata.
 *
 * `incluir` é a campanha ATUAL de quem está sendo editado (N-4): ela entra
 * mesmo encerrada há 90 dias ou excluída — `c.id===atual` no protótipo. Sem
 * isso o `<select>` não teria a opção selecionada, mandaria "Nenhuma", e a
 * receita sumiria da campanha antiga numa edição que só mexeu na descrição.
 */
export function campanhasVinculaveis(
  campanhas: readonly CampanhaDeVinculo[],
  contexto: ContextoDeVinculo,
  agora: Date,
  fuso: string,
  incluir?: string | null,
): CampanhaVinculavel[] {
  return campanhas
    .filter((c) => c.id === incluir || aceitaVinculo(c, contexto, agora, fuso))
    .sort(
      (a, b) =>
        Number(emAndamento(b, agora, fuso)) - Number(emAndamento(a, agora, fuso)) ||
        b.inicio.localeCompare(a.inicio) ||
        a.nome.localeCompare(b.nome, 'pt-BR'),
    )
    .map((c) => ({ id: c.id, nome: c.nome }))
}

/**
 * **UM erro para "não existe", "é de outra clínica" e "foi excluída"** (S-11).
 *
 * A RLS faz a campanha da vizinha chegar aqui como `undefined` — a mesma coisa
 * que um UUID inventado. Uma mensagem diferente para a excluída diria a quem
 * testa UUIDs qual deles existe.
 */
export const CAMPANHA_NAO_ENCONTRADA = erroDe(
  'CAMPANHA_NAO_ENCONTRADA',
  'Campanha não encontrada. Escolha uma da lista.',
)

const FORA_DA_JANELA: Readonly<Record<ContextoDeVinculo, string>> = {
  tarefa: `Esta campanha encerrou há mais de ${DIAS_DE_VINCULO_DEPOIS_DO_FIM} dias. Escolha outra da lista.`,
  paciente: 'Esta campanha não está em andamento hoje. Escolha uma da lista.',
}

/**
 * A validação da ESCRITA. Se a lista e a validação divergirem, a validação é
 * a regra (S-10) — e as duas chamam `aceitaVinculo`, então não divergem.
 *
 * `atual` é a campanha que o registro JÁ tem: reenviá-la é "não mexi", e passa
 * mesmo excluída ou antiga (N-4). Só ela.
 */
export function conferirVinculo(
  c: CampanhaDeVinculo | undefined,
  contexto: ContextoDeVinculo,
  agora: Date,
  fuso: string,
  atual?: string | null,
): Result<void> {
  if (c === undefined) return erro(CAMPANHA_NAO_ENCONTRADA)
  if (atual !== undefined && atual !== null && c.id === atual) return ok(undefined)
  if (c.excluida) return erro(CAMPANHA_NAO_ENCONTRADA)
  if (!aceitaVinculo(c, contexto, agora, fuso)) {
    return erro(erroDe('CAMPANHA_FORA_DA_JANELA', FORA_DA_JANELA[contexto]))
  }
  return ok(undefined)
}

/**
 * A SUGESTÃO da Nova tarefa e do Recebimento — `campanhaDoPaciente` (L2820).
 *
 * A campanha por onde a paciente CHEGOU, se em andamento hoje; senão, a da
 * tarefa mais recente dela numa campanha em andamento; senão, nenhuma. É só
 * sugestão: a tela a pré-seleciona e diz por quê, e a pessoa troca.
 *
 * O protótipo olha a data do PRAZO digitado na Nova tarefa; aqui é o hoje do
 * servidor (regra 24). A diferença só aparece em tarefa agendada para depois
 * do fim da campanha, e aí a sugestão é a mesma que a tela de Recebimento faz.
 */
export function campanhaSugerida(
  origem: string | null,
  tarefas: readonly { readonly campanhaId: string; readonly criadaEm: string }[],
  campanhas: readonly CampanhaDeVinculo[],
  agora: Date,
  fuso: string,
): string | null {
  const ativa = (id: string): boolean => {
    const c = campanhas.find((x) => x.id === id)
    return c !== undefined && aceitaVinculo(c, 'paciente', agora, fuso)
  }
  if (origem !== null && ativa(origem)) return origem
  const recente = [...tarefas]
    .filter((t) => ativa(t.campanhaId))
    .sort((a, b) => b.criadaEm.localeCompare(a.criadaEm))[0]
  return recente?.campanhaId ?? null
}

/** Por que a campanha foi sugerida — a tela diz, e só isso (L-A3-9). */
export type MotivoDaSugestao = 'origem' | 'tarefa'

/**
 * A sugestão COM o porquê, para `GET /v1/pacientes/:id/campanha-sugerida`.
 *
 * É `campanhaSugerida`, e não uma segunda escrita da regra: o motivo sai da
 * comparação com a origem. Se a origem está em andamento, ela é a sugestão;
 * se não está, a sugestão (quando há) veio de uma tarefa, e é uma campanha em
 * andamento — logo, diferente da origem.
 */
export function sugestaoDeCampanha(
  origem: string | null,
  tarefas: readonly { readonly campanhaId: string; readonly criadaEm: string }[],
  campanhas: readonly CampanhaDeVinculo[],
  agora: Date,
  fuso: string,
): { readonly sugerida: string | null; readonly motivo: MotivoDaSugestao | null } {
  const sugerida = campanhaSugerida(origem, tarefas, campanhas, agora, fuso)
  if (sugerida === null) return { sugerida: null, motivo: null }
  return { sugerida, motivo: sugerida === origem ? 'origem' : 'tarefa' }
}
