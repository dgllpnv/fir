import { Dinheiro } from './dinheiro'
import { normalizarTelefoneDoLead } from './prospeccao'
import { somarMeses } from './relogio'
import { erro, erroDe, ok, type Result } from './resultado'

/* ════════════════════════════════════════════════════════════════════════
 * MENSAGENS PRONTAS DA CARTEIRA — G8 ticket 3A (inventário X4, W1, W2, W4,
 * $3, L9, L10, L13).
 *
 * O protótipo preenche o modelo no NAVEGADOR (`preencher` L2438,
 * `preencherMsg` L2573, `msgTarefa` L2574, `msgWA` L2442). Aqui o
 * preenchimento é função pura chamada pelo SERVIDOR, com duas garantias que
 * o protótipo não dá:
 *
 *  1. **Uma passada só** (appsec A-14). O texto do modelo é varrido uma vez;
 *     o valor inserido nunca é varrido de novo. Um lead chamado `{pix}` sai
 *     `{pix}` na mensagem, nunca a chave Pix. Provado por property test.
 *  2. **Redação ANTES do preenchimento** (appsec A-14, LGPD A35). Sem a
 *     permissão `valores`, o valor e a chave Pix nem entram na função: o
 *     chamador passa `'restrito'` e a mensagem sai com o aviso. O
 *     `RedacaoInterceptor` não enxerga dinheiro dentro de uma string — por
 *     isso a redação mora aqui, na montagem.
 * ════════════════════════════════════════════════════════════════════════ */

/** As variáveis dos modelos de mensagem (ajuda do formulário, L2839). */
export const VARIAVEIS_DOS_MODELOS = [
  'responsavel',
  'cliente',
  'remetente',
  'valor',
  'vencimento',
  'mes',
  'mes_ref',
  'pix',
  'favorecido',
  'link_painel',
  'link_dash_financeiro',
  'link_dash_indicadores',
  'link_gestor_rotina',
  'pendencias',
  'parceiro',
  'frente',
  'link_form',
] as const

/**
 * As variáveis dos roteiros de abordagem (L2527, `msgWA` L2444).
 * `origem_do_contato` é nossa (LGPD A39): a primeira mensagem ao lead diz de
 * onde veio o contato.
 */
export const VARIAVEIS_DOS_ROTEIROS = [
  'nome',
  'indicador',
  'remetente',
  'produto',
  'especialidade',
  'beneficio',
  'origem_do_contato',
] as const

/** Só são preenchidas para quem tem `valores` (appsec A-14, LGPD A35). */
export const VARIAVEIS_RESTRITAS = ['valor', 'pix'] as const

/** O roteiro que é a primeira mensagem ao lead e por isso precisa dizer de onde veio o contato (A39). */
export const CHAVE_DO_PRIMEIRO_CONTATO = 'primeiro'
export const VARIAVEL_DA_ORIGEM = 'origem_do_contato'

export const FRENTES_DO_PARCEIRO = ['financeiro', 'comercial', 'trafego', 'marketing'] as const
export type FrenteDoParceiro = (typeof FRENTES_DO_PARCEIRO)[number]

/** `FRENTES` (L629). */
export const ROTULO_DA_FRENTE: Readonly<Record<FrenteDoParceiro, string>> = {
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  trafego: 'Tráfego pago',
  marketing: 'Marketing',
}

/** `MESES` (L630). */
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

export type Variaveis = Readonly<Record<string, string | null | undefined>>

/**
 * `modelo`: os modelos de mensagem (`preencherMsg`, L2573) — só `{var}`, e o
 * espaço repetido vira um, preservando as quebras de linha.
 * `roteiro`: os roteiros de abordagem (`preencher`, L2438) — também o trecho
 * `[[…]]` que some quando falta variável, e qualquer espaço repetido
 * (inclusive quebra de linha) vira um.
 */
export type ModoDoTexto = 'modelo' | 'roteiro'

const SO_VARIAVEL = /\{(\w+)\}/g
const VARIAVEL_OU_TRECHO = /\[\[([\s\S]*?)\]\]|\{(\w+)\}/g

/**
 * O valor da variável, ou vazio. `hasOwnProperty`, e não `vars[k]`: um modelo
 * com `{constructor}` ou `{toString}` leria o protótipo de `Object` e
 * colaria o código de uma função na mensagem.
 */
function valorDe(vars: Variaveis, nome: string): string {
  if (!Object.prototype.hasOwnProperty.call(vars, nome)) return ''
  return vars[nome] ?? ''
}

/**
 * Preenche o texto numa passada só.
 *
 * Um único `replace` global sobre o TEXTO DO MODELO: o JavaScript não volta a
 * examinar o que a função de troca devolveu, então um valor com `{pix}`,
 * `{valor}` ou `[[` dentro entra literal. Dentro de um trecho `[[…]]`, a
 * troca roda sobre o texto do trecho — que também é do modelo, nunca do
 * usuário. O protótipo já era de uma passada por acaso (troca o trecho cru e
 * só depois as variáveis); aqui é por construção, e o teste prova.
 *
 * Variável desconhecida vira vazio, como no protótipo (`vars[k] ?? ""`). A
 * edição do modelo recusa variável desconhecida antes (`validarTextoDoModelo`).
 */
export function preencherMensagem(texto: string, vars: Variaveis, modo: ModoDoTexto): string {
  const preenchido =
    modo === 'roteiro'
      ? texto.replace(VARIAVEL_OU_TRECHO, (_m: string, trecho: string | undefined, nome: string | undefined) => {
          if (trecho === undefined) return valorDe(vars, nome ?? '')
          const nomes = [...trecho.matchAll(SO_VARIAVEL)].map((x) => x[1] ?? '')
          if (!nomes.every((n) => valorDe(vars, n) !== '')) return ''
          return trecho.replace(SO_VARIAVEL, (_x: string, n: string) => valorDe(vars, n))
        })
      : texto.replace(SO_VARIAVEL, (_m: string, nome: string) => valorDe(vars, nome))
  return (modo === 'roteiro' ? preenchido.replace(/\s{2,}/g, ' ') : preenchido.replace(/[ \t]{2,}/g, ' ')).trim()
}

/** As variáveis que um texto usa, na ordem em que aparecem, sem repetir. */
export function variaveisUsadas(texto: string): string[] {
  return [...new Set([...texto.matchAll(SO_VARIAVEL)].map((x) => x[1] ?? ''))]
}

/**
 * Como a mensagem chama a pessoa (`trat`, L2421): "Dra. Fulana" para quem
 * começa com Dr/Dra, senão só o primeiro nome.
 */
export function tratamento(nome: string): string {
  const n = nome.trim()
  if (n === '') return ''
  const partes = n.split(/\s+/)
  return /^dr/i.test(n) ? partes.slice(0, 2).join(' ') : (partes[0] ?? '')
}

/* ────────────────────────────────────────────────────────────────────────
 * TELEFONE E LINK `wa.me` — `fone` (L2420) e `waHref` (L2447), appsec A-14
 * ──────────────────────────────────────────────────────────────────────── */

/** O que um telefone digitado pode conter. `?`, `&`, `/` e letras recusam (A-14). */
const SO_CARACTERES_DE_TELEFONE = /^[\d\s()+.-]*$/

/**
 * O número para o `wa.me`: só dígitos, com o 55 do Brasil quando vier com
 * DDD e sem país (`normalizarTelefoneDoLead`). Devolve `null` — e o botão
 * some — quando o cadastro traz algo que não é telefone: o gate manda recusar,
 * nunca "limpar" um `?text=` colado no campo. Mais de 15 dígitos não é
 * número E.164.
 */
export function telefoneParaWhatsApp(bruto: string | null | undefined): string | null {
  if (bruto === null || bruto === undefined) return null
  if (!SO_CARACTERES_DE_TELEFONE.test(bruto)) return null
  const n = normalizarTelefoneDoLead(bruto)
  return n === null || n.length > 15 ? null : n
}

/** O link que abre a conversa com o texto pronto. `encodeURIComponent` no texto inteiro (A-14). */
export function linkDoWhatsAppComTexto(telefone: string | null | undefined, texto: string): string | null {
  const n = telefoneParaWhatsApp(telefone)
  return n === null ? null : `https://wa.me/${n}?text=${encodeURIComponent(texto)}`
}

/* ────────────────────────────────────────────────────────────────────────
 * DATAS DA MENSAGEM
 * ──────────────────────────────────────────────────────────────────────── */

const ddMm = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
const mesPorExtenso = (dia: string): string => MESES[Number(dia.slice(5, 7)) - 1] ?? ''

/**
 * O vencimento da mensalidade que a tarefa lembra: o primeiro dia de
 * vencimento do cliente no dia da tarefa ou depois. Dia 29, 30 ou 31 cai no
 * último dia do mês curto (regra 25, `somarMeses`). Sem dia de vencimento no
 * cadastro, o próprio dia — o `t.vencimento || t.prazo` do protótipo (L2575).
 */
export function vencimentoAPartirDe(dia: string, diaDoVencimento: number | null): string {
  if (diaDoVencimento === null) return dia
  const primeiro = `${dia.slice(0, 8)}01`
  const noMes = somarMeses(primeiro, 0, diaDoVencimento)
  return noMes >= dia ? noMes : somarMeses(primeiro, 1, diaDoVencimento)
}

/**
 * "10% de desconto na mensalidade seguinte" a partir do percentual em
 * centésimos (`1000` = 10,00%), sem ponto flutuante.
 */
export function descricaoDoBeneficio(percentualCentesimos: bigint): string {
  const inteiro = percentualCentesimos / 100n
  const resto = percentualCentesimos % 100n
  const fracao = resto === 0n ? '' : `,${resto.toString().padStart(2, '0').replace(/0$/, '')}`
  return `${inteiro}${fracao}% de desconto na mensalidade seguinte`
}

/* ────────────────────────────────────────────────────────────────────────
 * MENSAGEM PARA O CLIENTE (ou o parceiro dele) — `msgTarefa` (L2574)
 * ──────────────────────────────────────────────────────────────────────── */

export type ClienteParaMensagem = {
  readonly nome: string
  /** O decisor ("Dra. Raphaella Pontes") — o `c.responsavel` do protótipo. */
  readonly decisor: string | null
  readonly telefone: string | null
  readonly linkPainel: string | null
  readonly linkDashFin: string | null
  readonly linkDashInd: string | null
  readonly linkRotina: string | null
}

/** Só existe para quem tem `valores`. Sem ela, o chamador passa `'restrito'`. */
export type PagamentoParaMensagem = {
  readonly mensalidadeCentavos: bigint | null
  readonly telefoneCobranca: string | null
  readonly chavePix: string | null
}

export type ParceiroParaMensagem = {
  readonly nome: string | null
  readonly whatsapp: string | null
  readonly linkFormulario: string | null
  readonly naoContatar: boolean
}

export type EntradaDaMensagemDoCliente = {
  readonly modelo: { readonly chave: string; readonly texto: string }
  readonly cliente: ClienteParaMensagem
  readonly remetente: string
  /** O dia da tarefa, ou o hoje do servidor (regra 24). */
  readonly dia: string
  readonly diaDoVencimento: number | null
  readonly pagamento: PagamentoParaMensagem | 'restrito'
  readonly favorecido: string | null
  readonly frente: FrenteDoParceiro | null
  /** O parceiro da frente; `null` quando não há frente ou não há parceiro cadastrado. */
  readonly parceiro: ParceiroParaMensagem | null
  readonly pendencias: string
}

export type DestinatarioDaMensagem = 'cliente' | 'cobranca' | 'parceiro' | 'lead'

export type MensagemMontada = {
  readonly texto: string
  readonly avisos: readonly string[]
  /** Já normalizado para o `wa.me`; `null` esconde o botão. */
  readonly telefone: string | null
  readonly destinatario: DestinatarioDaMensagem
  /** O modelo usa valor ou Pix e quem pediu não tem `valores`. */
  readonly restrita: boolean
}

/** As quatro variáveis de link e a coluna do cliente de onde cada uma sai (`LINKS`, L627). */
const LINKS: readonly (readonly [variavel: string, rotulo: string, campo: keyof ClienteParaMensagem])[] = [
  ['link_painel', 'Painel do cliente', 'linkPainel'],
  ['link_dash_financeiro', 'Dash financeiro', 'linkDashFin'],
  ['link_dash_indicadores', 'Dash de indicadores', 'linkDashInd'],
  ['link_gestor_rotina', 'Gestor de rotinas', 'linkRotina'],
]

export const AVISO_DE_VALOR_RESTRITO =
  'Valor e chave Pix são restritos a quem tem acesso a valores. Peça a essa pessoa para enviar esta mensagem.'

const NAO_CONTATAR = () =>
  erro(erroDe('NAO_CONTATAR', 'Este contato pediu para não receber mensagens da Firmare.'))

/**
 * Monta a mensagem de um modelo para um cliente — o `msgTarefa` do protótipo,
 * com a redação aplicada e o telefone escolhido no servidor.
 *
 * O telefone: o da frente para mensagem ao parceiro; o de cobrança para o
 * lembrete de pagamento, quando cadastrado (e só para quem tem `valores`,
 * porque ele mora na seção Pagamento do cadastro); senão o do cliente.
 *
 * Mensagem restrita (usa valor ou Pix sem `valores`) sai com os marcadores
 * "(valor restrito)" e "(restrito)" — nunca "R$", nunca a chave — e SEM
 * telefone: um lembrete de pagamento sem o valor não deve sair para o cliente.
 * O texto ainda pode ser lido e copiado para quem tem acesso terminar.
 */
export function montarMensagemDoCliente(e: EntradaDaMensagemDoCliente): Result<MensagemMontada> {
  if (e.frente !== null && e.parceiro?.naoContatar === true) return NAO_CONTATAR()

  const { texto } = e.modelo
  const usa = (v: string): boolean => texto.includes(`{${v}}`)
  const avisos: string[] = []
  const nome = e.cliente.nome
  const pagamento = e.pagamento === 'restrito' ? null : e.pagamento
  const restrita = pagamento === null && VARIAVEIS_RESTRITAS.some(usa)

  const links: Record<string, string> = {}
  for (const [variavel, rotulo, campo] of LINKS) {
    if (!usa(variavel)) continue
    const link = e.cliente[campo]
    if (link === null || link === '') {
      avisos.push(`Falta cadastrar o link "${rotulo}" no cadastro de ${nome}.`)
      links[variavel] = '(link a cadastrar)'
    } else {
      links[variavel] = link
    }
  }

  const vencimento = vencimentoAPartirDe(e.dia, e.diaDoVencimento)
  const mesDeReferencia = somarMeses(`${e.dia.slice(0, 8)}01`, -1)
  const rotuloDaFrente = e.frente === null ? '' : ROTULO_DA_FRENTE[e.frente]

  if (e.frente !== null && usa('link_form') && !e.parceiro?.linkFormulario) {
    avisos.push(`Falta o link do formulário de ${rotuloDaFrente.toLowerCase()} no cadastro de ${nome}.`)
  }

  let valor = ''
  let pix = ''
  if (pagamento === null) {
    valor = '(valor restrito)'
    pix = '(restrito)'
    if (restrita) avisos.push(AVISO_DE_VALOR_RESTRITO)
  } else {
    if (pagamento.mensalidadeCentavos === null) {
      valor = '(valor a cadastrar)'
      if (usa('valor')) avisos.push(`Falta a mensalidade no cadastro de ${nome}.`)
    } else {
      valor = Dinheiro.deCentavos(pagamento.mensalidadeCentavos).formatar()
    }
    if (pagamento.chavePix === null || pagamento.chavePix === '') {
      pix = '(chave Pix a cadastrar)'
      if (usa('pix')) avisos.push('Falta cadastrar a chave Pix da Firmare em Método, na tela Mensagens.')
    } else {
      pix = pagamento.chavePix
    }
  }

  const textoPronto = preencherMensagem(
    texto,
    {
      responsavel: tratamento(e.cliente.decisor ?? '') || tratamento(nome),
      cliente: nome,
      remetente: e.remetente,
      valor,
      vencimento: ddMm(vencimento),
      mes: mesPorExtenso(vencimento),
      mes_ref: mesPorExtenso(mesDeReferencia),
      pix,
      favorecido: e.favorecido ?? '',
      ...links,
      pendencias: e.pendencias,
      parceiro: e.frente === null ? '' : e.parceiro?.nome || 'tudo bem',
      frente: rotuloDaFrente.toLowerCase(),
      link_form: e.frente === null ? '' : e.parceiro?.linkFormulario || '(link a cadastrar)',
    },
    'modelo',
  )

  let bruto: string | null
  let destinatario: DestinatarioDaMensagem
  if (e.frente !== null) {
    bruto = e.parceiro?.whatsapp ?? null
    destinatario = 'parceiro'
  } else if (e.modelo.chave === 'pagamento' && pagamento !== null && pagamento.telefoneCobranca) {
    bruto = pagamento.telefoneCobranca
    destinatario = 'cobranca'
  } else {
    bruto = e.cliente.telefone
    destinatario = 'cliente'
  }
  const telefone = telefoneParaWhatsApp(bruto)
  if (telefone === null) {
    const quem =
      e.frente !== null
        ? `do parceiro de ${rotuloDaFrente.toLowerCase()} no cadastro de ${nome}`
        : `de ${nome} no cadastro`
    avisos.push(
      bruto === null || bruto.trim() === ''
        ? `Falta o WhatsApp ${quem}.`
        : `O WhatsApp ${quem} não é um telefone válido. Corrija o cadastro.`,
    )
  }

  return ok({ texto: textoPronto, avisos, telefone: restrita ? null : telefone, destinatario, restrita })
}

/* ────────────────────────────────────────────────────────────────────────
 * MENSAGEM PARA O LEAD — `msgWA` (L2442), roteiros (L534-560)
 * ──────────────────────────────────────────────────────────────────────── */

export type LeadParaMensagem = {
  readonly nome: string
  readonly especialidade: string | null
  readonly produtoInteresse: string | null
  readonly origem: string
  /** Quem indicou, já resolvido (`indPessoa`, L2437): o decisor do cliente indicador, o cliente, ou o texto livre. */
  readonly indicador: string | null
  readonly whatsapp: string | null
  readonly naoContatar: boolean
}

export type EntradaDaMensagemDoLead = {
  readonly roteiro: { readonly chave: string | null; readonly mensagem: string }
  readonly lead: LeadParaMensagem
  readonly remetente: string
  readonly beneficio: string
}

/**
 * De onde veio o contato, numa frase (LGPD A39, art. 10 §2º). Com quem
 * indicou, é a frase do protótipo (L537); sem, diz a origem cadastrada.
 */
export function origemDoContato(origem: string, indicador: string | null): string {
  if (indicador !== null && indicador.trim() !== '') {
    return `${indicador.trim()} me passou seu contato e falou muito bem do seu trabalho.`
  }
  switch (origem) {
    case 'Instagram':
      return 'Conheci seu trabalho pelo Instagram, e foi por lá que cheguei ao seu contato.'
    case 'Palestra ou evento':
      return 'Peguei seu contato no evento em que nos encontramos.'
    case 'Indicação de cliente':
    case 'Indicação de parceiro':
    case 'Indicação pessoal':
      return 'Seu contato chegou até mim por uma indicação.'
    default:
      return 'Seu contato chegou até mim pela nossa rede de relacionamento.'
  }
}

/**
 * Monta a mensagem de um roteiro para um lead. Oposição registrada (A37)
 * recusa — o servidor não monta mensagem para quem pediu para não ser
 * contatado, e a tela não ganha botão.
 */
export function montarMensagemDoLead(e: EntradaDaMensagemDoLead): Result<MensagemMontada> {
  if (e.lead.naoContatar) return NAO_CONTATAR()
  const avisos: string[] = []
  const indicador = e.lead.indicador?.trim() ? e.lead.indicador.trim() : null
  const texto = preencherMensagem(
    e.roteiro.mensagem,
    {
      nome: tratamento(e.lead.nome),
      remetente: e.remetente,
      indicador: indicador ?? '',
      produto: e.lead.produtoInteresse ?? '',
      especialidade: e.lead.especialidade ?? '',
      beneficio: e.beneficio,
      origem_do_contato: origemDoContato(e.lead.origem, indicador),
    },
    'roteiro',
  )
  if (e.roteiro.chave === CHAVE_DO_PRIMEIRO_CONTATO && !e.roteiro.mensagem.includes(`{${VARIAVEL_DA_ORIGEM}}`)) {
    avisos.push('A primeira mensagem precisa dizer de onde veio o contato. Inclua {origem_do_contato} no roteiro.')
  }
  const telefone = telefoneParaWhatsApp(e.lead.whatsapp)
  if (telefone === null) {
    avisos.push(
      e.lead.whatsapp === null || e.lead.whatsapp.trim() === ''
        ? 'Cadastre o WhatsApp do lead para liberar o envio.'
        : 'O WhatsApp do lead não é um telefone válido. Corrija o cadastro.',
    )
  }
  return ok({ texto, avisos, telefone, destinatario: 'lead', restrita: false })
}

/* ────────────────────────────────────────────────────────────────────────
 * EDIÇÃO DOS MODELOS E ROTEIROS
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * O texto pode ser gravado? Variável fora da lista recusa — ela sairia vazia
 * em toda mensagem, sem ninguém notar. O roteiro do primeiro contato precisa
 * de `{origem_do_contato}` (A39). O erro não ecoa o texto (A-21).
 */
export function validarTextoDaMensagem(
  texto: string,
  tipo: ModoDoTexto,
  chaveDoRoteiro: string | null,
): Result<true> {
  const permitidas: readonly string[] = tipo === 'modelo' ? VARIAVEIS_DOS_MODELOS : VARIAVEIS_DOS_ROTEIROS
  if (variaveisUsadas(texto).some((v) => !permitidas.includes(v))) {
    return erro(erroDe('VARIAVEL_DESCONHECIDA', 'O texto usa uma variável que não existe. Use só as da lista.'))
  }
  if (tipo === 'roteiro' && chaveDoRoteiro === CHAVE_DO_PRIMEIRO_CONTATO && !texto.includes(`{${VARIAVEL_DA_ORIGEM}}`)) {
    return erro(
      erroDe('ORIGEM_OBRIGATORIA', 'A primeira mensagem precisa dizer de onde veio o contato: mantenha {origem_do_contato}.'),
    )
  }
  return ok(true)
}
