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
import { Dinheiro } from './dinheiro'
import { diaCivil, diasEntre, somarDias, somarMeses } from './relogio'
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

/* ════════════════════════════════════════════════════════════════════════
 * G8 1E — PROSPECÇÃO COMPLETA, igual ao protótipo
 * (`versoes/firmare-gestao-prototipo/index.html`, L520-L2565).
 *
 * Tudo o que o protótipo calcula no navegador — sinal de contato, potencial,
 * as duas conversões, o ranking de quem indica — mora aqui, uma vez, e o
 * servidor é quem chama. A tela só formata (CLAUDE.md §5).
 * ════════════════════════════════════════════════════════════════════════ */

/** `ORIGENS` (L520), na ordem do protótipo. A coluna continua texto livre: há leads antigos com outra grafia. */
export const ORIGENS_DO_LEAD = [
  'Indicação de cliente',
  'Indicação de parceiro',
  'Indicação pessoal',
  'Palestra ou evento',
  'Instagram',
  'Outro',
] as const

/** `PRODUTOS` (L517). Também texto livre na coluna, pela mesma razão. */
export const PRODUTOS_DE_INTERESSE = [
  'Acelerador FIR',
  'Programa de Gestão FIR',
  'Gestão por Assinatura',
  'Consultoria',
  'Projeto',
] as const

/** Os canais do formulário "Registrar contato" (L2560). */
export const CANAIS_DE_CONTATO = ['WhatsApp', 'Ligação', 'Reunião', 'E-mail', 'Presencial'] as const
export type CanalDeContato = (typeof CANAIS_DE_CONTATO)[number]

/**
 * O canal das linhas que o próprio sistema escreve no histórico ("Contrato
 * fechado", "Perdido: motivo" — L2960, L2963). Nunca aceito na entrada.
 */
export const CANAL_DE_REGISTRO = 'Registro'

/* ────────────────────────────────────────────────────────────────────────
 * PERCENTUAL INTEIRO — gate de números §3.3, sem ponto flutuante.
 * ──────────────────────────────────────────────────────────────────────── */

const exigirContagem = (n: number, nome: string): void => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${nome} precisa ser uma contagem inteira ≥ 0.`)
}

/**
 * `round(a/b × 100)` por aritmética inteira: `(200·a + b) div (2·b)`. Para
 * `a, b ≥ 0` é exatamente o `Math.round` do protótipo (meio para cima), sem
 * passar por `0.1 + 0.2`. `b = 0` devolve `null` — a tela mostra "—", nunca
 * "0%" (o protótipo esconde o número quando não há denominador, L2481).
 */
export function percentualDeContagem(a: number, b: number): number | null {
  exigirContagem(a, 'a')
  exigirContagem(b, 'b')
  if (b === 0) return null
  return Math.floor((200 * a + b) / (2 * b))
}

/**
 * **"Conversão das encerradas"** — `ganhos / (ganhos + perdidos)`: o resumo
 * da prospecção (L2478, L2481). Mede quanto das conversas que TERMINARAM
 * terminaram em contrato. Não confundir com `indicacoesQueViraramCliente`
 * (gate de números, ajuste 15): os dois chamam-se "conversão" no protótipo.
 */
export const conversaoDasEncerradas = (ganhos: number, perdidos: number): number | null =>
  percentualDeContagem(ganhos, ganhos + perdidos)

/**
 * **"Indicações que viraram cliente"** — `ganhos / total`, COM as indicações
 * ainda em andamento no denominador: a coluna "Conversão" do ranking de quem
 * indica (L2541). Com conversas em aberto ela é sempre ≤ à das encerradas.
 */
export const indicacoesQueViraramCliente = (ganhos: number, total: number): number | null =>
  percentualDeContagem(ganhos, total)

/* ────────────────────────────────────────────────────────────────────────
 * RESUMO DAS OPORTUNIDADES — L2474-2481
 * ──────────────────────────────────────────────────────────────────────── */

export type LeadParaResumo = {
  readonly etapa: EtapaDoLead
  readonly arquivado: boolean
  readonly valorEstimado: Dinheiro | null
}

export type ResumoDasOportunidades = {
  /** Fora de `ganho` e `perdido` (L2474). `espera` CONTA aqui. */
  readonly emAndamento: number
  readonly porEtapa: readonly { readonly etapa: EtapaDoLead; readonly quantidade: number }[]
  /**
   * `Σ valor_estimado` das etapas abertas, MENOS `espera` (L2477; gate de
   * números, ajuste 14). Nunca entra em MRR, meta nem receita (regra 4: o
   * que ainda não é contrato não é receita).
   */
  readonly potencial: Dinheiro
  readonly conversaoDasEncerradas: number | null
}

/** Lead arquivado não conta em nada — no protótipo ele simplesmente não existe mais (L2958). */
export function resumoDasOportunidades(leads: readonly LeadParaResumo[]): ResumoDasOportunidades {
  const vivos = leads.filter((l) => !l.arquivado)
  const conta = (e: EtapaDoLead) => vivos.filter((l) => l.etapa === e).length
  const potencial = vivos
    .filter((l) => !etapaEhTerminal(l.etapa) && l.etapa !== 'espera')
    .reduce((soma, l) => (l.valorEstimado === null ? soma : soma.mais(l.valorEstimado)), Dinheiro.zero())
  return {
    emAndamento: vivos.filter((l) => !etapaEhTerminal(l.etapa)).length,
    porEtapa: ETAPAS_DO_LEAD.map((etapa) => ({ etapa, quantidade: conta(etapa) })),
    potencial,
    conversaoDasEncerradas: conversaoDasEncerradas(conta('ganho'), conta('perdido')),
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * SINAL DE CONTATO — `sinal(l)`, L2422-2435
 * ──────────────────────────────────────────────────────────────────────── */

export type NivelDoSinal = 'agora' | 'hoje' | 'semana'

/** As chaves dos roteiros do protótipo (`roteirosPadrao`, L534). Os textos chegam no ticket 3A. */
export type RoteiroSugerido = 'primeiro' | 'agendar' | 'confirmacao' | 'diagnostico' | 'proposta' | 'retomada'

/** `ROT_ETAPA` (L2446). */
const ROTEIRO_DA_ETAPA: Partial<Record<EtapaDoLead, RoteiroSugerido>> = {
  novo: 'primeiro',
  contato: 'agendar',
  reuniao: 'diagnostico',
  proposta: 'proposta',
  espera: 'retomada',
}

export type LeadParaSinal = {
  readonly etapa: EtapaDoLead
  readonly temperatura: TemperaturaDoLead
  /** "Indicação recebida em" — dia civil no fuso da carteira. */
  readonly recebidaEm: string
  readonly proximoContato: string | null
  /** A data mais recente do histórico (L2418), ou `null` se nunca houve contato. */
  readonly ultimoContato: string | null
  readonly indicadoPorCliente: boolean
  /** Oposição ao contato (LGPD A37). */
  readonly naoContatar: boolean
}

export type SinalDoLead = {
  readonly nivel: NivelDoSinal
  readonly motivo: string
  readonly roteiro: RoteiroSugerido
  /**
   * Para ordenar. O protótipo usa `3/2/1 + 0,5 (quente) + 0,3 (indicação de
   * cliente)`; aqui é o mesmo número ×10, inteiro — a ordem é idêntica e
   * nenhum `0.1 + 0.2` decide quem a recepção chama primeiro.
   */
  readonly peso: number
}

const ddMm = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

/**
 * Quando a ferramenta deve recomendar um contato — e por quê. Mesma ordem de
 * regras do protótipo; o "hoje" é o dia civil do SERVIDOR no fuso da
 * carteira (regra 24), nunca o relógio do navegador que o protótipo usa.
 *
 * Divergência a favor da regra: lead com oposição registrada (A37) nunca é
 * recomendado — o protótipo não tem o conceito.
 */
export function sinalDoLead(l: LeadParaSinal, hoje: string): SinalDoLead | null {
  if (etapaEhTerminal(l.etapa) || l.naoContatar) return null
  const sem = l.ultimoContato === null ? null : diasEntre(l.ultimoContato, hoje)
  const idade = diasEntre(l.recebidaEm, hoje)
  const px = l.proximoContato === null ? null : diasEntre(hoje, l.proximoContato)

  let r: { nivel: NivelDoSinal; motivo: string; roteiro: RoteiroSugerido } | null = null
  if (px !== null && px < 0) {
    r = {
      nivel: 'agora',
      motivo: `O contato estava combinado para ${ddMm(l.proximoContato!)}.`,
      roteiro: l.etapa === 'reuniao' ? 'confirmacao' : 'retomada',
    }
  } else if (px === 0) {
    r = {
      nivel: 'agora',
      motivo: 'Contato combinado para hoje.',
      roteiro:
        l.etapa === 'espera'
          ? 'retomada'
          : l.etapa === 'reuniao'
            ? 'confirmacao'
            : (ROTEIRO_DA_ETAPA[l.etapa] ?? 'agendar'),
    }
  } else if (l.etapa === 'novo' && l.ultimoContato === null) {
    r =
      idade >= 2
        ? {
            nivel: 'agora',
            motivo: `Indicação recebida há ${idade} dias e ainda sem contato. Indicação esfria rápido.`,
            roteiro: 'primeiro',
          }
        : { nivel: 'hoje', motivo: 'Indicação nova. O ideal é o primeiro contato em até 48 horas.', roteiro: 'primeiro' }
  } else if (l.etapa === 'proposta' && sem !== null && sem >= 5) {
    r = { nivel: 'agora', motivo: `Proposta enviada há ${sem} dias sem retorno.`, roteiro: 'proposta' }
  } else if ((l.etapa === 'contato' || l.etapa === 'reuniao') && sem !== null && sem >= 10 && px === null) {
    r = {
      nivel: 'semana',
      motivo: `Sem interação há ${sem} dias e sem próximo passo marcado.`,
      roteiro: ROTEIRO_DA_ETAPA[l.etapa] ?? 'agendar',
    }
  } else if (l.etapa === 'proposta' && sem !== null && sem >= 3) {
    r = {
      nivel: 'semana',
      motivo: `Proposta enviada há ${sem} dias. Um toque leve mantém a conversa viva.`,
      roteiro: 'proposta',
    }
  }
  if (r === null) return null

  const bonus = l.indicadoPorCliente ? ' Indicação de cliente da carteira: vale prioridade.' : ''
  const peso =
    { agora: 30, hoje: 20, semana: 10 }[r.nivel] + (l.temperatura === 'quente' ? 5 : 0) + (l.indicadoPorCliente ? 3 : 0)
  return { ...r, motivo: r.motivo + bonus, peso }
}

/* ────────────────────────────────────────────────────────────────────────
 * REGISTRAR CONTATO e MARCAR PERDIDO — L2559-2565, L2960
 * ──────────────────────────────────────────────────────────────────────── */

/** A etapa que o formulário "Registrar contato" sugere (L2560). */
export function etapaSugeridaDepoisDoContato(etapa: EtapaDoLead): EtapaDoLead {
  if (etapa === 'novo' || etapa === 'espera') return 'contato'
  return etapa
}

/** "Próximo contato": 5 dias para proposta, 7 para o resto (L2562). `hoje` é o do servidor. */
export const proximoContatoSugerido = (etapa: EtapaDoLead, hoje: string): string =>
  somarDias(hoje, etapa === 'proposta' ? 5 : 7)

/**
 * O contato registrado pode ser gravado?
 *
 * - Oposição registrada (A37) recusa — quem pediu para não ser contatado não
 *   ganha contato novo, nem registrado.
 * - A data é a que a pessoa informa (o contato pode ter sido ontem), mas
 *   nunca depois do hoje do servidor.
 * - `ganho` nunca passa por aqui: a conversão cria o `Cliente Firmare` e tem
 *   caminho próprio, com trava e idempotência (A-11). O protótipo já tira
 *   "Virou cliente" da lista (L2560).
 * - Mudar de etapa obedece `validarTransicaoDeEtapa` — lead fechado registra
 *   contato, mas não reabre por aqui. A nota faz as vezes do motivo quando a
 *   etapa escolhida é `perdido` (o formulário do protótipo não tem outro campo).
 */
export function validarRegistroDeContato(p: {
  readonly etapaAtual: EtapaDoLead
  readonly etapaDepois: EtapaDoLead
  readonly data: string
  readonly hoje: string
  readonly naoContatar: boolean
  readonly nota: string
}): Result<true> {
  if (p.naoContatar) {
    return erro(erroDe('NAO_CONTATAR', 'Este contato pediu para não ser contatado pela Firmare.'))
  }
  if (p.data > p.hoje) return erro(erroDe('DATA_FUTURA', 'A data do contato não pode ser depois de hoje.'))
  if (p.etapaDepois === 'ganho' && p.etapaAtual !== 'ganho') {
    return erro(erroDe('GANHO_PELA_CONVERSAO', 'Use "Virou cliente" para fechar o contrato.'))
  }
  if (p.etapaDepois === p.etapaAtual) return ok(true)
  return validarTransicaoDeEtapa(p.etapaAtual, p.etapaDepois, p.nota)
}

/**
 * "Marcar como perdido" com "Tentar de novo em (opcional)" (L2960): com data,
 * o lead vai para `espera` com o próximo contato marcado — não se perde quem
 * só pediu um tempo. Sem data, `perdido`.
 */
export function decidirPerda(
  motivo: string,
  tentarDeNovoEm: string | null,
  hoje: string,
): Result<{ etapa: 'perdido' | 'espera'; proximoContato: string | null }> {
  if (motivo.trim() === '') return erro(erroDe('MOTIVO_OBRIGATORIO', 'Informe o motivo da perda.'))
  if (tentarDeNovoEm === null) return ok({ etapa: 'perdido', proximoContato: null })
  if (tentarDeNovoEm < hoje) {
    return erro(erroDe('DATA_PASSADA', '"Tentar de novo em" precisa ser hoje ou depois.'))
  }
  return ok({ etapa: 'espera', proximoContato: tentarDeNovoEm })
}

/* ────────────────────────────────────────────────────────────────────────
 * QUEM INDICA — `indNome` (L2437) e `vIndicadores` (L2533-2548)
 * ──────────────────────────────────────────────────────────────────────── */

/** O nome de quem indicou: o cliente da carteira, se houver; senão o texto livre. */
export function quemIndicou(l: {
  readonly nomeDoClienteIndicador: string | null
  readonly indicadoPor: string | null
}): string | null {
  const cliente = l.nomeDoClienteIndicador?.trim() ?? ''
  if (cliente !== '') return cliente
  const pessoa = l.indicadoPor?.trim() ?? ''
  return pessoa === '' ? null : pessoa
}

export type SituacaoDoBeneficio = 'guardado' | 'pendente' | 'concedido'

/**
 * A situação de um `Benefício de indicação`, sempre DERIVADA:
 *
 * - `guardado` — quem indicou não é cliente: não há cobrança onde aplicar.
 *   Fica guardado até a pessoa virar cliente (D-22 item 11).
 * - `pendente` — ligado a um cliente, esperando a próxima cobrança.
 * - `concedido` — consumido por uma cobrança (o desconto aplicado É o
 *   registro). O protótipo marca "concedido" à mão (L2859); aqui não existe
 *   esse botão, para não divergir do consumo automático (inventário L12).
 */
export function situacaoDoBeneficio(b: {
  readonly clienteCarteiraId: string | null
  readonly consumidoEm: string | null
}): SituacaoDoBeneficio {
  if (b.clienteCarteiraId === null) return 'guardado'
  return b.consumidoEm === null ? 'pendente' : 'concedido'
}

export type LeadParaRanking = {
  readonly id: string
  readonly nome: string
  readonly etapa: EtapaDoLead
  readonly arquivado: boolean
  readonly clienteIndicadorId: string | null
  readonly nomeDoClienteIndicador: string | null
  readonly indicadoPor: string | null
}

export type BeneficioParaRanking = {
  readonly leadComercialId: string | null
  readonly situacao: SituacaoDoBeneficio
}

export type LinhaDoRanking = {
  /** `clienteCarteiraId`, ou `p:` + nome em minúsculas para quem não é cliente (L2536). */
  readonly chave: string
  readonly nome: string
  readonly clienteCarteiraId: string | null
  readonly total: number
  readonly emAndamento: number
  readonly viraramClientes: number
  readonly indicacoesQueViraramCliente: number | null
  readonly leads: readonly { readonly id: string; readonly nome: string }[]
  readonly beneficiosConcedidos: number
  readonly beneficiosPendentes: number
  readonly beneficiosGuardados: number
}

/**
 * O ranking "Quem mais indica" (L2536-2546): por quem indicou, quantas
 * indicações, quantas em andamento, quantas viraram cliente, a taxa
 * `ganhos/total` e os benefícios.
 *
 * Os benefícios casam pelo LEAD que os gerou (`leadComercialId`), não pelo
 * nome como no protótipo (L2545): o nome digitado muda, e um benefício
 * guardado que depois é ligado ao cliente continuaria contando para a mesma
 * linha.
 *
 * Ordem: mais clientes, depois mais indicações (L2537); empate pelo nome,
 * para a lista não trocar de ordem entre duas leituras.
 */
export function rankingDeQuemIndica(
  leads: readonly LeadParaRanking[],
  beneficios: readonly BeneficioParaRanking[],
): LinhaDoRanking[] {
  type Acumulador = {
    chave: string
    nome: string
    clienteCarteiraId: string | null
    total: number
    emAndamento: number
    viraramClientes: number
    leads: { id: string; nome: string }[]
  }
  const mapa = new Map<string, Acumulador>()
  for (const l of leads) {
    if (l.arquivado) continue
    const nome = quemIndicou(l)
    if (nome === null) continue
    const chave = l.clienteIndicadorId ?? `p:${nome.toLowerCase()}`
    const x =
      mapa.get(chave) ??
      ({ chave, nome, clienteCarteiraId: l.clienteIndicadorId, total: 0, emAndamento: 0, viraramClientes: 0, leads: [] } satisfies Acumulador)
    mapa.set(chave, x)
    x.total += 1
    x.leads.push({ id: l.id, nome: l.nome })
    if (l.etapa === 'ganho') x.viraramClientes += 1
    else if (l.etapa !== 'perdido') x.emAndamento += 1
  }

  return [...mapa.values()]
    .map((x) => {
      const ids = new Set(x.leads.map((l) => l.id))
      const meus = beneficios.filter((b) => b.leadComercialId !== null && ids.has(b.leadComercialId))
      const conta = (s: SituacaoDoBeneficio) => meus.filter((b) => b.situacao === s).length
      return {
        ...x,
        indicacoesQueViraramCliente: indicacoesQueViraramCliente(x.viraramClientes, x.total),
        beneficiosConcedidos: conta('concedido'),
        beneficiosPendentes: conta('pendente'),
        beneficiosGuardados: conta('guardado'),
      }
    })
    .sort(
      (a, b) =>
        b.viraramClientes - a.viraramClientes || b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'),
    )
}

/* ────────────────────────────────────────────────────────────────────────
 * TELEFONE DO LEAD — `fone()` (L2420) e `waHref` (L2447)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Só dígitos; com até 11, ganha o 55 do Brasil na frente — exatamente o
 * `fone()` do protótipo. É a forma usada no link do WhatsApp e na lista de
 * supressão (A37), para que "(71) 9999-…" e "+55 71 9999-…" sejam o mesmo
 * contato.
 *
 * Divergência medida (property test): com menos de 10 dígitos o `fone()` do
 * protótipo não é idempotente — `"0"` vira `"550"`, que vira `"55550"` — e o
 * hash da supressão de um mesmo número mudaria conforme passasse uma ou duas
 * vezes por aqui. Telefone brasileiro tem DDD + 8 ou 9 dígitos; abaixo de 10
 * não há WhatsApp possível, e a função devolve `null`.
 */
export function normalizarTelefoneDoLead(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  return d.length <= 11 ? `55${d}` : d
}

/**
 * O link do WhatsApp, SEM texto: a mensagem pronta (roteiros, L9/L10) é do
 * ticket 3A, e a primeira mensagem terá de dizer de onde veio o contato (A39).
 */
export function linkDoWhatsApp(telefone: string | null | undefined): string | null {
  const n = normalizarTelefoneDoLead(telefone)
  return n === null ? null : `https://wa.me/${n}`
}
