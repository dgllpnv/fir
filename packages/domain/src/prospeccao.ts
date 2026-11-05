/**
 * G5 — funil de prospecção (`Lead comercial`) e rotina interna da equipe
 * Firmare (`Tarefa interna`/`Rotina interna`/`Checkin interno`).
 *
 * `docs/superpowers/plans/g5-spec-rotina-interna-funil.md`,
 * `docs/adr/0016-escrita-do-usuario-de-gestao-leads-e-rotina-interna.md`.
 *
 * Regra geral do domínio: nada aqui faz I/O. A busca por um `usuario_gestao`
 * de outro grupo, a existência de uma `clientes_carteira`, a gravação —
 * tudo isso é do service. O que mora aqui é a DECISÃO, pura, testável sem
 * banco: que etapa pode virar qual, quem pode escrever em qual grupo, qual é
 * a semana corrente de um checkin.
 */
import { diaCivil, somarDias, somarMeses } from './relogio'
import { erro, erroDe, ok, type Result } from './resultado'

/* ────────────────────────────────────────────────────────────────────────
 * O FUNIL — `Etapa do lead` (spec §1, §2)
 * ──────────────────────────────────────────────────────────────────────── */

export const ETAPAS_DO_LEAD = [
  'novo',
  'contato',
  'reuniao',
  'proposta',
  'espera',
  'ganho',
  'perdido',
] as const
export type EtapaDoLead = (typeof ETAPAS_DO_LEAD)[number]

export const ETAPAS_TERMINAIS_DO_LEAD: readonly EtapaDoLead[] = ['ganho', 'perdido']

export const etapaEhTerminal = (etapa: EtapaDoLead): boolean =>
  (ETAPAS_TERMINAIS_DO_LEAD as readonly string[]).includes(etapa)

export const TEMPERATURAS_DO_LEAD = ['frio', 'morno', 'quente'] as const
export type TemperaturaDoLead = (typeof TEMPERATURAS_DO_LEAD)[number]

/**
 * A transição de etapa pedida é válida?
 *
 * `novo`→`contato`→`reuniao`→`proposta`→`espera` são passos livres — a tela
 * deixa escolher a etapa seguinte (spec §2.2, "não é uma máquina de estados
 * rígida como a `Jornada` clínica"). O que esta função FECHA, porque é
 * negócio e não UX, são as duas bordas que todo o resto depende:
 *
 *  - uma etapa TERMINAL (`ganho`/`perdido`) nunca tem saída — reabrir um
 *    lead fechado não é "mudar de etapa", é um erro de uso (spec §2.3, §6.3);
 *  - `perdido` exige `motivoPerda` no mesmo instante da transição (spec
 *    §2.4) — texto livre, mas OBRIGATÓRIO, e o servidor confere, não só a
 *    tela.
 *
 * Não valida `ganho` ⇒ conversão: criar a linha em `clientes_carteira` é
 * efeito colateral do service, numa transação — fora do alcance de uma
 * função pura.
 */
export function validarTransicaoDeEtapa(
  de: EtapaDoLead,
  para: EtapaDoLead,
  motivoPerda: string | null | undefined,
): Result<true> {
  if (etapaEhTerminal(de)) {
    return erro(erroDe('ETAPA_TERMINAL', 'Este lead já está fechado — a etapa não muda mais.'))
  }
  if (para === 'perdido' && (motivoPerda === null || motivoPerda === undefined || motivoPerda.trim() === '')) {
    return erro(erroDe('MOTIVO_OBRIGATORIO', 'Informe o motivo da perda.'))
  }
  return ok(true)
}

/* ────────────────────────────────────────────────────────────────────────
 * ESCRITA POR GRUPO — ADR 0016, item 2. O ACHADO CRÍTICO DO GATE.
 *
 * `grupo_id`/`responsavel_usuario_gestao_id` NUNCA vêm crus do corpo da
 * requisição quando `escopo = 'grupo'`. Esta é a PRIMEIRA camada (a RLS com
 * `WITH CHECK` é a segunda, nunca a única — regra 19 do CLAUDE.md).
 * ──────────────────────────────────────────────────────────────────────── */

export type SessaoDaCarteira = { readonly escopo: 'geral' | 'grupo'; readonly grupoId: string | null }

/**
 * O `grupo_id` que de fato vai para o `INSERT` — nunca o do corpo da
 * requisição, tomado ao pé da letra.
 *
 * - `escopo = 'geral'`: o Operador enxerga todo grupo e pode escolher
 *   (inclusive `null`, prospecção avulsa) — o valor pedido vale como está.
 * - `escopo = 'grupo'`: só dois valores são aceitos — `null` (grupo_id vem
 *   da sessão) ou o PRÓPRIO grupo da sessão, pedido de novo (idempotente,
 *   nunca um erro). Qualquer outro valor — o UUID de outro grupo — é
 *   recusado aqui, antes de qualquer `INSERT`: depender só do `WITH CHECK`
 *   da RLS devolveria um erro de banco genérico na borda HTTP (ADR 0016).
 */
export function resolverGrupoDeEscrita(
  sessao: SessaoDaCarteira,
  grupoIdPedido: string | null | undefined,
): Result<string | null> {
  const pedido = grupoIdPedido ?? null
  if (sessao.escopo === 'geral') return ok(pedido)
  if (pedido === null || pedido === sessao.grupoId) return ok(sessao.grupoId)
  return erro(
    erroDe(
      'GRUPO_CRUZADO',
      'Você não pode criar ou editar um registro de outro grupo.',
    ),
  )
}

/**
 * O `responsavel_usuario_gestao_id` pedido pertence ao mesmo grupo da
 * escrita? (ADR 0016, item 2, segundo achado.) Pura: recebe o grupo do
 * responsável já resolvido pelo service (que consultou `usuarios_gestao`) —
 * esta função só decide se a combinação é aceitável.
 *
 * `escopo = 'geral'` nunca recusa: o Operador pode atribuir a qualquer
 * `Usuário de Gestão`, de qualquer grupo (ele enxerga todos).
 */
export function validarResponsavelDoMesmoGrupo(
  sessao: SessaoDaCarteira,
  grupoDaEscrita: string | null,
  responsavelId: string | null | undefined,
  grupoDoResponsavel: string | null,
): Result<true> {
  if (responsavelId === null || responsavelId === undefined) return ok(true)
  if (sessao.escopo === 'geral') return ok(true)
  if (grupoDoResponsavel === grupoDaEscrita) return ok(true)
  return erro(
    erroDe(
      'RESPONSAVEL_DE_OUTRO_GRUPO',
      'Este responsável pertence a outro grupo.',
    ),
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * ROTINA INTERNA — próximo prazo, reaproveitando a aritmética de calendário
 * de `relogio.ts` (regra 25: dia 29/30/31 cai no último dia do mês curto).
 * ──────────────────────────────────────────────────────────────────────── */

export const FREQUENCIAS_DA_ROTINA_INTERNA = [
  'diaria',
  'semanal',
  'mensal',
  'vencimento',
  'reuniao',
] as const
export type FrequenciaDaRotinaInterna = (typeof FREQUENCIAS_DA_ROTINA_INTERNA)[number]

export const ESCOPOS_DE_APLICACAO = ['global', 'por_cliente'] as const
export type EscopoDeAplicacao = (typeof ESCOPOS_DE_APLICACAO)[number]

/**
 * O próximo dia civil em que uma rotina `diaria`/`semanal`/`mensal` vence, a
 * partir de uma referência (o último prazo gerado, ou o `inicio` da rotina
 * na primeira geração).
 *
 * `diaDeAncoragem` é o dia-do-mês do `inicio` da `Rotina interna` —
 * **sempre** o mesmo em toda chamada, nunca o dia da `referencia` anterior.
 * `somarMeses` já documenta por quê (`recorrencia.ts`): uma rotina mensal
 * ancorada em 31 que passasse pelo mês curto (fevereiro, dia 28) e usasse
 * esse 28 como âncora da vez seguinte ficaria **presa no dia 28 para
 * sempre** — a mesma armadilha que `gerarSerie` já resolveu lá, resolvida
 * aqui do mesmo jeito: o chamador (o job de geração) guarda o dia original
 * da rotina e o repassa sempre, nunca lê o dia da última tarefa gerada.
 *
 * `vencimento` e `reuniao` NÃO passam por aqui: dependem de dado por
 * `Cliente Firmare` (data de vencimento do contrato, dia da reunião fixa) que
 * esta função não tem — o service resolve essas duas consultando
 * `clientes_carteira`, e usa esta função só para as três genéricas.
 */
export function proximoPrazoDaRotina(
  frequencia: 'diaria' | 'semanal' | 'mensal',
  referencia: string,
  diaDeAncoragem?: number,
): string {
  if (frequencia === 'diaria') return somarDias(referencia, 1)
  if (frequencia === 'semanal') return somarDias(referencia, 7)
  return somarMeses(referencia, 1, diaDeAncoragem ?? Number(referencia.slice(8, 10)))
}

/* ────────────────────────────────────────────────────────────────────────
 * CHECKIN INTERNO — semana ISO, e a janela de edição (spec §7, critério 7).
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A semana ISO-8601 (`yyyy-Www`) de um dia civil `yyyy-MM-dd`.
 *
 * ISO: a semana começa na segunda-feira, e a semana 1 é a que contém a
 * primeira quinta-feira do ano — por isso o deslocamento para a
 * quinta-feira mais próxima antes de calcular o ano e o número da semana
 * (algoritmo padrão, sem biblioteca: `Date.UTC` já garante aritmética de
 * calendário exata, sem fuso, igual ao resto de `relogio.ts`).
 */
export function semanaIsoCivil(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  const data = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1))
  // Segunda=0 ... domingo=6, para achar a quinta-feira da MESMA semana ISO.
  const diaDaSemana = (data.getUTCDay() + 6) % 7
  data.setUTCDate(data.getUTCDate() - diaDaSemana + 3)
  const anoIso = data.getUTCFullYear()
  const primeiraQuinta = new Date(Date.UTC(anoIso, 0, 4))
  const diaDaSemanaPrimeira = (primeiraQuinta.getUTCDay() + 6) % 7
  const inicioSemana1 = new Date(primeiraQuinta)
  inicioSemana1.setUTCDate(primeiraQuinta.getUTCDate() - diaDaSemanaPrimeira)
  const numero = Math.round((data.getTime() - inicioSemana1.getTime()) / (7 * 86_400_000)) + 1
  return `${anoIso}-W${String(numero).padStart(2, '0')}`
}

/** A semana ISO corrente, no fuso da clínica/da carteira (D-?: UTC no banco, fuso na borda). */
export const semanaAtual = (agora: Date, fuso: string): string => semanaIsoCivil(diaCivil(agora, fuso))

/**
 * Um `checkin_interno` da semana `semanaDoCheckin` pode ser editado agora?
 * Só a semana corrente — "um fechamento por semana", mesma disciplina do
 * Caixa por dia (spec §7, critério de aceite 7). Semana futura também é
 * recusada: não se registra o ritual antes dele acontecer.
 */
export const podeEditarCheckinDaSemana = (
  semanaDoCheckin: string,
  agora: Date,
  fuso: string,
): boolean => semanaDoCheckin === semanaAtual(agora, fuso)

export const SAUDES_DO_CLIENTE = ['bom', 'atencao', 'critico'] as const
export type SaudeDoCliente = (typeof SAUDES_DO_CLIENTE)[number]

/**
 * A `Saúde do cliente` é sempre DERIVADA do checkin mais recente — nunca um
 * campo solto editável (spec §4, mesma forma de `Saldo em aberto`). Dado só
 * o histórico (mais recente primeiro OU em qualquer ordem — a função ordena),
 * decide a leitura atual; `null` quando não há nenhum checkin ainda.
 */
export function saudeAtualDoCliente(
  checkins: readonly { readonly semana: string; readonly saude: SaudeDoCliente }[],
): SaudeDoCliente | null {
  if (checkins.length === 0) return null
  return [...checkins].sort((a, b) => (a.semana < b.semana ? 1 : a.semana > b.semana ? -1 : 0))[0]!.saude
}
