import { diaCivil, diasEntre, instanteLocal, somarDias } from './relogio'
import { type ErroDeDominio, type Result, erro, erroDe, ok } from './resultado'

/**
 * **A PLANILHA DE INDICADORES DO CLIENTE FIRMARE** (ticket 4A — G1, G2, G3,
 * M5 do inventário G8).
 *
 * Cada cliente tem uma planilha Google com uma aba por frente (Financeiro,
 * Comercial, Tráfego pago, Marketing). Cada aba é a planilha de RESPOSTAS de
 * um Google Forms que o parceiro daquela frente preenche toda semana — uma
 * linha por envio, com o "Carimbo de data/hora" que o Forms grava sozinho
 * (contrato reconstruído de `fg-supabase.js` L286-316; estrutura das abas em
 * `PLANILHA`, `index.html` L632-640).
 *
 * Este módulo é PURO: recebe as células já lidas (o adaptador do Google mora
 * em `apps/api/src/carteira/planilhas/`) e decide tudo o que importa —
 * qual aba é de qual frente, qual coluna é de qual pergunta, a que semana
 * cada envio pertence, se a semana está completa, e as métricas.
 *
 * **Nada aqui toca ponto flutuante.** O Google devolve número de célula como
 * número JSON; o adaptador o transforma em TEXTO decimal (`String(n)`, a
 * menor representação que volta ao mesmo double — é o que a pessoa digitou)
 * antes de chegar aqui, e este módulo converte o texto em inteiro de
 * centavos ou de unidades por manipulação de dígitos. Métricas são
 * racionais exatos `{num, den}` em `bigint` — mesma forma do `Racional` de
 * `avaliarMeta` (gate de números, ajuste 16), para que a meta com fonte
 * "planilha" compare sem arredondar.
 */

// ---------------------------------------------------------------------------
// 1 · A especificação (G1) — `PLANILHA`, index.html L632-640
// ---------------------------------------------------------------------------

export type FrenteDaPlanilha = 'financeiro' | 'comercial' | 'trafego' | 'marketing'

/** Na ordem do protótipo (`FRENTES`, L629) — é a ordem da tela. */
export const FRENTES_DA_PLANILHA: readonly FrenteDaPlanilha[] = ['financeiro', 'comercial', 'trafego', 'marketing']

/**
 * `dinheiro` é inteiro em CENTAVOS; `inteiro` é contagem; `texto` é
 * resposta livre. O protótipo tem `num` para dinheiro e para "Alcance";
 * aqui o alcance é `inteiro` (gente alcançada não tem fração), e o que é
 * reais é `dinheiro` — a unidade decide o tipo, não o formulário.
 */
export type TipoDeCampoDaPlanilha = 'dinheiro' | 'inteiro' | 'texto'

export type CampoDaPlanilha = {
  readonly chave: string
  /** O título da PERGUNTA no Forms, literal do protótipo — é ele que casa com o cabeçalho da coluna. */
  readonly titulo: string
  /** Todos os títulos de pergunta aceitos para a coluna; o primeiro é sempre `titulo`. A comparação é pelo nome normalizado. */
  readonly titulos: readonly string[]
  readonly tipo: TipoDeCampoDaPlanilha
  readonly opcional: boolean
}

export type UnidadeDaMetricaDaPlanilha = 'R$' | 'un' | '%'

/** Racional exato, `den > 0` sempre. `R$` em centavos, `un` em unidades, `%` em pontos percentuais. */
export type RacionalDaPlanilha = { readonly num: bigint; readonly den: bigint }

export type ValorDeCampoDaPlanilha =
  | { readonly estado: 'vazio' }
  /** Resposta de texto livre: só se registra QUE foi respondida — o conteúdo nunca é guardado (LGPD, ver o relatório do 4A). */
  | { readonly estado: 'preenchido' }
  /** Inteiro em texto (JSON não carrega `bigint`): centavos para `dinheiro`, unidades para `inteiro`. */
  | { readonly estado: 'numero'; readonly inteiro: string }
  | { readonly estado: 'invalido' }

export type ValoresDaLinha = Readonly<Record<string, ValorDeCampoDaPlanilha>>

export type MetricaDaPlanilha = {
  /** Chave estável para a fonte de meta (`pl:frente|chave|agregação`). */
  readonly chave: string
  /** O nome do protótipo — a fonte antiga (`pl:frente|Nome|agregação`) também é aceita. */
  readonly nome: string
  readonly unidade: UnidadeDaMetricaDaPlanilha
  readonly calcular: (v: ValoresDaLinha) => RacionalDaPlanilha | null
}

export type EspecificacaoDaFrente = {
  readonly frente: FrenteDaPlanilha
  /** O nome da aba, como o protótipo o escreve. */
  readonly aba: string
  /** Outros nomes que a aba pode ter e ainda ser desta frente. */
  readonly apelidos: readonly string[]
  /** "Estrutura da aba a confirmar" (L1505) — o próprio protótipo marca o Financeiro assim. */
  readonly provisoria: boolean
  readonly campos: readonly CampoDaPlanilha[]
  readonly metricas: readonly MetricaDaPlanilha[]
}

const inteiroDe = (v: ValoresDaLinha, chave: string): bigint | null => {
  const x = v[chave]
  return x?.estado === 'numero' ? BigInt(x.inteiro) : null
}
/** `+v.x || 0` do protótipo: ausente e inválido somam como zero. */
const ouZero = (v: ValoresDaLinha, chave: string): bigint => inteiroDe(v, chave) ?? 0n
const inteiroComoRacional = (n: bigint | null): RacionalDaPlanilha | null => (n === null ? null : { num: n, den: 1n })

const campo = (
  chave: string,
  titulo: string,
  tipo: TipoDeCampoDaPlanilha,
  opcional = false,
  apelidos: readonly string[] = [],
): CampoDaPlanilha => ({
  chave,
  titulo,
  titulos: [titulo, ...apelidos],
  tipo,
  opcional,
})

export const PLANILHA_DE_INDICADORES: Readonly<Record<FrenteDaPlanilha, EspecificacaoDaFrente>> = {
  financeiro: {
    frente: 'financeiro',
    aba: 'Financeiro',
    apelidos: [],
    provisoria: true,
    campos: [
      campo('faturamento', 'Faturamento da semana (R$)', 'dinheiro'),
      campo('recebido', 'Valor recebido (R$)', 'dinheiro'),
      campo('despesas', 'Despesas pagas (R$)', 'dinheiro'),
      campo('analise', 'Análise estratégica', 'texto', true),
    ],
    metricas: [
      { chave: 'faturamento', nome: 'Faturamento da semana', unidade: 'R$', calcular: (v) => inteiroComoRacional(inteiroDe(v, 'faturamento')) },
      { chave: 'recebido', nome: 'Valor recebido', unidade: 'R$', calcular: (v) => inteiroComoRacional(inteiroDe(v, 'recebido')) },
      { chave: 'despesas', nome: 'Despesas pagas', unidade: 'R$', calcular: (v) => inteiroComoRacional(inteiroDe(v, 'despesas')) },
    ],
  },
  comercial: {
    frente: 'comercial',
    aba: 'Comercial',
    apelidos: [],
    provisoria: false,
    campos: [
      campo('leads_site', 'Quantos leads chegaram do site?', 'inteiro'),
      campo('leads_google', 'Quantos leads chegaram do google?', 'inteiro'),
      campo('leads_insta', 'Quantos leads chegaram do Instagram?', 'inteiro'),
      campo('conv_site', 'Leads do site convertidos', 'inteiro', false, ['Quantos leads do site foram convertidos essa semana?']),
      campo('conv_google', 'Leads do google convertidos', 'inteiro', false, ['Quantos leads do google foram convertidos essa semana?']),
      campo('conv_insta', 'Leads do Instagram convertidos', 'inteiro', false, ['Quantos leads do instagram foram convertidos essa semana?']),
      campo('frios', 'Leads frios ou fora de perfil', 'inteiro', false, ['Quantos leads frios fora de perfil de plano chegaram essa semana?']),
      campo('analise', 'Análise estratégica do comercial', 'texto', true, ['Faça uma análise estratégica sobre o desempenho do comercial durante essa semana']),
    ],
    metricas: [
      {
        chave: 'leads_recebidos',
        nome: 'Leads recebidos',
        unidade: 'un',
        calcular: (v) => ({ num: ouZero(v, 'leads_site') + ouZero(v, 'leads_google') + ouZero(v, 'leads_insta'), den: 1n }),
      },
      {
        chave: 'leads_convertidos',
        nome: 'Leads convertidos',
        unidade: 'un',
        calcular: (v) => ({ num: ouZero(v, 'conv_site') + ouZero(v, 'conv_google') + ouZero(v, 'conv_insta'), den: 1n }),
      },
      {
        chave: 'taxa_conversao',
        nome: 'Taxa de conversão',
        unidade: '%',
        calcular: (v) => {
          const leads = ouZero(v, 'leads_site') + ouZero(v, 'leads_google') + ouZero(v, 'leads_insta')
          if (leads <= 0n) return null
          const conv = ouZero(v, 'conv_site') + ouZero(v, 'conv_google') + ouZero(v, 'conv_insta')
          return reduzir({ num: conv * 100n, den: leads })
        },
      },
      { chave: 'leads_fora_de_perfil', nome: 'Leads fora de perfil', unidade: 'un', calcular: (v) => inteiroComoRacional(inteiroDe(v, 'frios')) },
    ],
  },
  trafego: {
    frente: 'trafego',
    aba: 'Tráfego pago',
    apelidos: ['Tráfego', 'Trafego pago'],
    provisoria: false,
    campos: [
      campo('campanhas', 'Quantas campanhas rodaram na semana?', 'inteiro', false, ['Quantas campanhas rodaram na semana em questão?']),
      campo('google', 'Dados da campanha do Google', 'texto', false, ['Descreva os dados referente a campanha do Google']),
      campo('meta', 'Dados da campanha do Meta', 'texto', false, ['Descreva os dados referente a campanha do Meta']),
      campo('analise', 'Análise estratégica do tráfego', 'texto', true, ['Faça uma análise estratégica sobre o tráfego pago desse cliente durante essa semana']),
    ],
    metricas: [
      { chave: 'campanhas', nome: 'Campanhas na semana', unidade: 'un', calcular: (v) => inteiroComoRacional(inteiroDe(v, 'campanhas')) },
    ],
  },
  marketing: {
    frente: 'marketing',
    aba: 'Marketing',
    apelidos: [],
    provisoria: false,
    campos: [
      campo('seguidores', 'Novos seguidores na semana', 'inteiro', false, ['Quantos novos seguidores chegaram durante esta semana?']),
      campo('criativos', 'Criativos publicados', 'inteiro', false, ['Quantos criativos foram publicados na semana?']),
      campo('melhor', 'Criativo de melhor performance', 'texto', false, ['Qual criativo teve maior performance durante a semana?']),
      campo('alcance', 'Alcance total da semana', 'inteiro', false, ['Informe o alcance total da semana']),
    ],
    metricas: [
      { chave: 'seguidores', nome: 'Novos seguidores', unidade: 'un', calcular: (v) => inteiroComoRacional(inteiroDe(v, 'seguidores')) },
      { chave: 'alcance', nome: 'Alcance', unidade: 'un', calcular: (v) => inteiroComoRacional(inteiroDe(v, 'alcance')) },
      { chave: 'criativos', nome: 'Criativos publicados', unidade: 'un', calcular: (v) => inteiroComoRacional(inteiroDe(v, 'criativos')) },
    ],
  },
}

// ---------------------------------------------------------------------------
// 2 · O link (gate de segurança A-16: sem SSRF)
// ---------------------------------------------------------------------------

/** O formato do id de planilha do Google: letras, dígitos, `-` e `_`. */
export const FORMATO_DO_ID_DA_PLANILHA = /^[A-Za-z0-9_-]{20,100}$/

/**
 * Extrai SÓ o id da planilha de um link `https://docs.google.com/spreadsheets/d/<id>/…`.
 *
 * O servidor nunca busca a URL que a pessoa colou: chama a API do Sheets com
 * o id, num host fixo. Por isso a validação é estrita — esquema `https`,
 * host EXATAMENTE `docs.google.com`, sem usuário, senha nem porta — e não
 * uma regex frouxa sobre o texto, que aceitaria
 * `https://docs.google.com.evil.example/spreadsheets/d/…` ou
 * `https://x@docs.google.com/…`. O link "publicado na web"
 * (`/spreadsheets/d/e/2PACX-…`) é recusado: aquele id não é o da planilha e
 * a API não o aceita.
 */
export function idDaPlanilha(link: string): Result<string> {
  const recusa = erro(
    erroDe('link_invalido', 'Cole o link da planilha do Google (https://docs.google.com/spreadsheets/d/…).'),
  )
  const texto = link.trim()
  if (texto.length === 0 || texto.length > 2000) return recusa
  let url: URL
  try {
    url = new URL(texto)
  } catch {
    return recusa
  }
  if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return recusa
  if (url.username !== '' || url.password !== '' || url.port !== '') return recusa
  const m = /^\/spreadsheets(?:\/u\/\d{1,2})?\/d\/([^/]+)(?:\/.*)?$/.exec(url.pathname)
  const id = m?.[1]
  if (id === undefined || !FORMATO_DO_ID_DA_PLANILHA.test(id)) return recusa
  return ok(id)
}

// ---------------------------------------------------------------------------
// 3 · Casamento por nome (aba → frente, coluna → pergunta)
// ---------------------------------------------------------------------------

/**
 * A forma comparável de um nome de aba ou de um título de pergunta: sem
 * acento, minúsculo, sem o que estiver entre parênteses (`(R$)`), sem
 * pontuação, espaços colapsados. "Quantos leads chegaram do site?" e
 * "QUANTOS LEADS  chegaram do site" ficam iguais — é o que se espera quando
 * a Firmare cria o formulário à mão a partir da lista do protótipo.
 */
export function normalizarNomeDaPlanilha(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export type EscolhaDaAba =
  | { readonly frente: FrenteDaPlanilha; readonly titulo: string }
  | { readonly frente: FrenteDaPlanilha; readonly titulo: null; readonly candidatas: readonly string[] }

/**
 * Para cada frente, a aba que é dela. Primeiro o nome igual (ou um apelido);
 * senão, a ÚNICA aba cujo nome contém o da frente como palavras inteiras
 * ("Respostas — Comercial"). Duas candidatas é ambiguidade, e ambiguidade
 * não se resolve por palpite: a frente fica sem aba, com as candidatas
 * listadas para a pessoa renomear.
 */
export function escolherAbasDaPlanilha(titulos: readonly string[]): readonly EscolhaDaAba[] {
  const normalizados = titulos.map((t) => ({ t, n: normalizarNomeDaPlanilha(t) }))
  return FRENTES_DA_PLANILHA.map((frente) => {
    const spec = PLANILHA_DE_INDICADORES[frente]
    const nomes = [spec.aba, ...spec.apelidos].map(normalizarNomeDaPlanilha)
    const exata = normalizados.find((x) => nomes.includes(x.n))
    if (exata) return { frente, titulo: exata.t }
    const contem = normalizados.filter((x) => nomes.some((nome) => ` ${x.n} `.includes(` ${nome} `)))
    if (contem.length === 1) return { frente, titulo: contem[0]!.t }
    return { frente, titulo: null, candidatas: contem.map((x) => x.t) }
  })
}

export const TITULOS_DO_CARIMBO = ['carimbo de data hora', 'carimbo de data e hora', 'timestamp', 'data e hora']
/** A semana a que o parceiro diz que a resposta se refere — opcional; sem ela, vale o carimbo. */
export const TITULOS_DA_SEMANA = [
  'qual o primeiro dia da semana analisada',
  'semana',
  'data da semana',
  'semana de referencia',
  'semana referente',
  'inicio da semana',
  'data de inicio da semana',
]
export const TITULOS_DO_MES = ['mes', 'qual mes sera analisado', 'que mes sera analisado', 'mes de referencia', 'mes referente']

// ---------------------------------------------------------------------------
// 4 · Células, números e datas
// ---------------------------------------------------------------------------

/**
 * Uma célula como o adaptador a entrega: texto, ou um número da planilha já
 * convertido em TEXTO decimal (`"42000.5"`). A distinção importa porque
 * `"42.000"` digitado é quarenta e dois mil (milhar brasileiro), e o número
 * 42.0 da planilha vira `"42"` — sem ela, um dos dois seria lido errado.
 */
export type CelulaDaPlanilha = string | { readonly numeroDecimal: string }

const textoDaCelula = (c: CelulaDaPlanilha | undefined): string =>
  c === undefined ? '' : typeof c === 'string' ? c.trim() : c.numeroDecimal

const celulaVazia = (c: CelulaDaPlanilha | undefined): boolean => textoDaCelula(c) === ''

/** `"-12.345"` → `{neg, inteiros: "12", decimais: "345"}`; `null` se não for decimal simples. */
function partesDecimais(texto: string): { neg: boolean; inteiros: string; decimais: string } | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(texto)
  if (!m) return null
  return { neg: m[1] === '-', inteiros: m[2]!, decimais: m[3] ?? '' }
}

/** Decimal em texto → centavos, só se não sobrar fração além do centavo (sem arredondamento silencioso de dinheiro). */
function centavosDeDecimal(texto: string): bigint | null {
  const p = partesDecimais(texto)
  if (!p) return null
  const decimais = p.decimais.replace(/0+$/, '')
  if (decimais.length > 2) return null
  const v = BigInt(p.inteiros) * 100n + BigInt(decimais.padEnd(2, '0') || '0')
  return p.neg ? -v : v
}

/**
 * Dinheiro de uma célula, em centavos.
 *
 * Número da planilha: o texto decimal dele. Texto digitado: aceita o jeito
 * brasileiro (`R$ 42.000,50`, `42000,5`) e o decimal com ponto só quando não
 * pode ser milhar (`42000.50`, nunca `42.000`). Qualquer outra coisa é
 * `null` — "Não é número", que a tela mostra para alguém corrigir na
 * planilha.
 */
export function centavosDaCelula(c: CelulaDaPlanilha): bigint | null {
  if (typeof c !== 'string') return centavosDeDecimal(c.numeroDecimal)
  const t = c.replace(/R\$/gi, '').replace(/[\s ]/g, '')
  if (t === '') return null
  const neg = t.startsWith('-')
  const s = neg ? t.slice(1) : t
  let decimal: string | null = null
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) decimal = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d+(,\d{1,2})?$/.test(s)) decimal = s.replace(',', '.')
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) decimal = s.replace(/,/g, '')
  else if (/^\d+\.\d{1,2}$/.test(s)) decimal = s
  if (decimal === null) return null
  const v = centavosDeDecimal(decimal)
  return v === null ? null : neg ? -v : v
}

/** Contagem de uma célula: inteiro, com ou sem milhar brasileiro (`12.000`). Fração é "Não é número". */
export function inteiroDaCelula(c: CelulaDaPlanilha): bigint | null {
  if (typeof c !== 'string') {
    const p = partesDecimais(c.numeroDecimal)
    if (!p || /[1-9]/.test(p.decimais)) return null
    const v = BigInt(p.inteiros)
    return p.neg ? -v : v
  }
  const t = c.replace(/[\s ]/g, '')
  if (/^-?\d+$/.test(t)) return BigInt(t)
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return BigInt(t.replace(/\./g, ''))
  return null
}

const dois = (n: number): string => String(n).padStart(2, '0')

function diaValido(a: number, m: number, d: number): string | null {
  if (a < 1900 || a > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const t = new Date(Date.UTC(a, m - 1, d))
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return `${a}-${dois(m)}-${dois(d)}`
}

/** Número de série do Sheets (dias desde 30/12/1899, fração = hora) → dia e segundos do dia, sem ponto flutuante. */
function deSerial(texto: string): { dia: string; segundos: number } | null {
  const p = partesDecimais(texto)
  if (!p || p.neg) return null
  const dias = Number(p.inteiros)
  if (!Number.isSafeInteger(dias) || dias < 1 || dias > 400_000) return null
  const escala = 10n ** BigInt(p.decimais.length)
  const fracao = BigInt(p.decimais || '0')
  // Meio para cima no segundo: `round(f × 86400)` em inteiros.
  let segundos = Number((fracao * 86_400n * 2n + escala) / (2n * escala))
  let extra = 0
  if (segundos >= 86_400) {
    segundos -= 86_400
    extra = 1
  }
  return { dia: somarDias('1899-12-30', dias + extra), segundos }
}

/**
 * O "Carimbo de data/hora" do Forms → instante UTC (ISO).
 *
 * O carimbo é relógio de parede NO FUSO DA PLANILHA (propriedade
 * `timeZone` dela; sem essa informação, o da clínica). Aceita o número de
 * série que a API devolve com `dateTimeRenderOption=SERIAL_NUMBER`, e o
 * texto `dd/mm/aaaa hh:mm[:ss]` ou ISO, para a planilha em que o carimbo
 * ficou como texto.
 */
export function instanteDoCarimbo(c: CelulaDaPlanilha, fusoDaPlanilha: string): string | null {
  let dia: string | null = null
  let segundos = 0
  if (typeof c !== 'string') {
    const s = deSerial(c.numeroDecimal)
    if (!s) return null
    dia = s.dia
    segundos = s.segundos
  } else {
    const t = c.trim()
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t)
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t)
    if (br) {
      dia = diaValido(Number(br[3]), Number(br[2]), Number(br[1]))
      segundos = Number(br[4] ?? 0) * 3600 + Number(br[5] ?? 0) * 60 + Number(br[6] ?? 0)
    } else if (iso) {
      dia = diaValido(Number(iso[1]), Number(iso[2]), Number(iso[3]))
      segundos = Number(iso[4] ?? 0) * 3600 + Number(iso[5] ?? 0) * 60 + Number(iso[6] ?? 0)
    }
    if (segundos >= 86_400) return null
  }
  if (dia === null) return null
  const hh = Math.floor(segundos / 3600)
  const mm = Math.floor((segundos % 3600) / 60)
  const ss = segundos % 60
  const inicio = instanteLocal(dia, `${dois(hh)}:${dois(mm)}`, fusoDaPlanilha)
  return new Date(inicio.getTime() + ss * 1000).toISOString()
}

/** A segunda-feira da semana de um dia civil (semana de segunda a domingo — gate de números, ajuste 18). */
export function segundaDaSemanaDaPlanilha(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  const diaDaSemana = (new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay() + 6) % 7
  return somarDias(dia, -diaDaSemana)
}

/**
 * A semana a que um envio SEM data informada pertence: a segunda-feira de
 * `dia − 4`. Um envio de sexta a quinta-feira fala da semana que começou na
 * segunda ANTERIOR àquela sexta.
 *
 * Por que −4: a versão publicada conta como "desta semana" o envio entre a
 * segunda da semana de referência e a quinta seguinte (`FG_PL_STATUS`,
 * janela `[prazo−7, prazo+3]` com `ref = segunda(prazo−7)`) — uma janela de
 * 11 dias que se sobrepõe à da semana anterior. Um fato por semana exige uma
 * partição, e a partição que preserva o caso real (o parceiro envia na
 * segunda ou na terça sobre a semana que acabou) é cortar na sexta.
 * Calibrar com a planilha real (D-7).
 */
export const semanaDoEnvio = (diaDoCarimbo: string): string => segundaDaSemanaDaPlanilha(somarDias(diaDoCarimbo, -4))

/**
 * A semana de uma data INFORMADA pelo parceiro: a segunda-feira de
 * `data + 2`. É a tolerância de −2 a +4 dias de `linhasDaSemana` (L686)
 * escrita como função: uma data entre o sábado anterior e a sexta pertence
 * à semana daquela segunda.
 */
export const semanaDaDataInformada = (dia: string): string => segundaDaSemanaDaPlanilha(somarDias(dia, 2))

/** `dd/mm[/aa[aa]]` ou número de série → dia civil; sem ano, o ano mais próximo do envio. */
function dataInformada(c: CelulaDaPlanilha, diaDoEnvio: string | null): { dia: string; semAno: boolean; texto: string } | null {
  if (typeof c !== 'string') {
    const s = deSerial(c.numeroDecimal)
    return s ? { dia: s.dia, semAno: false, texto: s.dia } : null
  }
  const t = c.trim()
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t)
  if (!m) return null
  const d = Number(m[1])
  const mes = Number(m[2])
  if (m[3] !== undefined) {
    const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const dia = diaValido(a, mes, d)
    return dia ? { dia, semAno: false, texto: t } : null
  }
  if (diaDoEnvio === null) return null
  const base = Number(diaDoEnvio.slice(0, 4))
  let melhor: string | null = null
  for (const a of [base - 1, base, base + 1]) {
    const dia = diaValido(a, mes, d)
    if (dia && (melhor === null || Math.abs(diasEntre(diaDoEnvio, dia)) < Math.abs(diasEntre(diaDoEnvio, melhor)))) {
      melhor = dia
    }
  }
  return melhor ? { dia: melhor, semAno: true, texto: t } : null
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

// ---------------------------------------------------------------------------
// 5 · Interpretar (G3): células → linhas por frente
// ---------------------------------------------------------------------------

export type LinhaDaFrente = {
  /** Instante UTC do envio (ISO), ou `null` se o carimbo não pôde ser lido. */
  readonly carimbo: string | null
  /** A segunda-feira da semana a que o envio se refere, ou `null` sem carimbo nem data. */
  readonly semana: string | null
  /** A data que o parceiro escreveu, quando há coluna de semana — só para os avisos de G2. */
  readonly semanaInformada: { readonly texto: string; readonly semAno: boolean } | null
  /** `false` quando o mês informado não bate com a data; `null` sem coluna de mês. O texto do mês não é guardado. */
  readonly mesConfere: boolean | null
  readonly preenchidas: number
  readonly total: number
  readonly valores: ValoresDaLinha
}

export type AbaInterpretada = {
  readonly frente: FrenteDaPlanilha
  /** O nome real da aba na planilha, ou `null` quando não foi achada. */
  readonly titulo: string | null
  readonly candidatas: readonly string[]
  /** Títulos de pergunta esperados e não achados no cabeçalho. */
  readonly colunasFaltando: readonly string[]
  readonly semCarimbo: boolean
  /**
   * Perguntas que aparecem em mais de uma coluna. O título é o da ESPECIFICAÇÃO,
   * nunca o texto da planilha. `informativa`: campo de texto, que só registra
   * "preenchido" e por isso não perde dado; nos demais, a linha fica inválida.
   * Ausente em leituras gravadas antes deste campo existir.
   */
  readonly colunasDuplicadas?: readonly { readonly titulo: string; readonly informativa: boolean }[]
  /** O cabeçalho passou do teto de colunas ou de caracteres: a aba não foi lida. */
  readonly cabecalhoRecusado?: true
  readonly linhas: readonly LinhaDaFrente[]
}

export type PlanilhaInterpretada = { readonly abas: readonly AbaInterpretada[] }

export type AbaLida = { readonly titulo: string; readonly linhas: readonly (readonly CelulaDaPlanilha[])[] }

/** Teto de linhas guardadas por aba: um ano e meio de semanas, com folga para reenvios. */
export const MAXIMO_DE_LINHAS_POR_ABA = 400
/** Tetos do cabeçalho, conferidos antes de normalizar: a normalização roda regex sobre texto do usuário. */
export const MAXIMO_DE_COLUNAS_DO_CABECALHO = 200
export const MAXIMO_DE_CARACTERES_DO_CABECALHO = 2000

const comprimentoDaCelula = (c: CelulaDaPlanilha): number => (typeof c === 'string' ? c.length : c.numeroDecimal.length)

/** O mês (`01`..`12`) de uma célula de data formatada `mmmm yyyy`, que chega como número de série. */
const mesDoSerial = (c: CelulaDaPlanilha): string | null => {
  if (typeof c === 'string') return null
  const x = deSerial(c.numeroDecimal)
  return x === null ? null : x.dia.slice(5, 7)
}

function valorDoCampo(c: CelulaDaPlanilha | undefined, tipo: TipoDeCampoDaPlanilha): ValorDeCampoDaPlanilha {
  if (c === undefined || celulaVazia(c)) return { estado: 'vazio' }
  if (tipo === 'texto') return { estado: 'preenchido' }
  const v = tipo === 'dinheiro' ? centavosDaCelula(c) : inteiroDaCelula(c)
  return v === null ? { estado: 'invalido' } : { estado: 'numero', inteiro: v.toString() }
}

/** Pergunta repetida: texto vale se qualquer coluna tiver resposta; número não se escolhe por posição. */
function valorDeCampoRepetido(
  celulas: readonly (CelulaDaPlanilha | undefined)[],
  tipo: TipoDeCampoDaPlanilha,
): ValorDeCampoDaPlanilha {
  if (celulas.every((c) => c === undefined || celulaVazia(c))) return { estado: 'vazio' }
  return tipo === 'texto' ? { estado: 'preenchido' } : { estado: 'invalido' }
}

const ordemDaLinha = (a: LinhaDaFrente, b: LinhaDaFrente): number => {
  const sa = a.semana ?? ''
  const sb = b.semana ?? ''
  if (sa !== sb) return sa < sb ? -1 : 1
  const ca = a.carimbo ?? ''
  const cb = b.carimbo ?? ''
  return ca === cb ? 0 : ca < cb ? -1 : 1
}

/**
 * Lê as abas escolhidas. A primeira linha de cada aba é o cabeçalho (é onde o
 * Forms escreve as perguntas). Só as colunas que casam com uma pergunta da
 * especificação são lidas — e-mail do respondente, nome, qualquer coluna que
 * o Forms acrescente, nada disso entra.
 */
export function interpretarPlanilha(entrada: {
  readonly escolhas: readonly EscolhaDaAba[]
  readonly abas: readonly AbaLida[]
  readonly fusoDaPlanilha: string
  readonly fusoDaClinica: string
}): PlanilhaInterpretada {
  return {
    abas: entrada.escolhas.map((escolha): AbaInterpretada => {
      const spec = PLANILHA_DE_INDICADORES[escolha.frente]
      const aba = escolha.titulo === null ? undefined : entrada.abas.find((a) => a.titulo === escolha.titulo)
      if (escolha.titulo === null || aba === undefined) {
        return {
          frente: escolha.frente,
          titulo: null,
          candidatas: 'candidatas' in escolha ? escolha.candidatas : [],
          colunasFaltando: [],
          semCarimbo: false,
          linhas: [],
        }
      }
      const cabecalhoCru = aba.linhas[0] ?? []
      if (
        cabecalhoCru.length > MAXIMO_DE_COLUNAS_DO_CABECALHO ||
        cabecalhoCru.some((c) => comprimentoDaCelula(c) > MAXIMO_DE_CARACTERES_DO_CABECALHO)
      ) {
        return {
          frente: escolha.frente,
          titulo: aba.titulo,
          candidatas: [],
          colunasFaltando: [],
          semCarimbo: false,
          cabecalhoRecusado: true,
          linhas: [],
        }
      }
      const cabecalho = cabecalhoCru.map((c) => normalizarNomeDaPlanilha(textoDaCelula(c)))
      const colunas = (nomes: readonly string[]): number[] => {
        const comparaveis = nomes.map(normalizarNomeDaPlanilha)
        return cabecalho.flatMap((h, i) => (h !== '' && comparaveis.includes(h) ? [i] : []))
      }
      const colsCarimbo = colunas(TITULOS_DO_CARIMBO)
      const colsSemana = colunas(TITULOS_DA_SEMANA)
      const colsMes = colunas(TITULOS_DO_MES)
      // Pergunta repetida não escolhe coluna por posição: só a coluna única vale.
      const unica = (cols: readonly number[]): number => (cols.length === 1 ? cols[0]! : -1)
      const colCarimbo = unica(colsCarimbo)
      const colSemana = unica(colsSemana)
      const colMes = unica(colsMes)
      const colCampos = spec.campos.map((c) => {
        const cols = colunas(c.titulos)
        return { campo: c, col: unica(cols), cols }
      })
      const colunasDuplicadas: { titulo: string; informativa: boolean }[] = []
      if (colsCarimbo.length > 1) colunasDuplicadas.push({ titulo: 'Carimbo de data/hora', informativa: false })
      if (colsSemana.length > 1) colunasDuplicadas.push({ titulo: 'Primeiro dia da semana', informativa: false })
      if (colsMes.length > 1) colunasDuplicadas.push({ titulo: 'Mês analisado', informativa: false })
      for (const x of colCampos) {
        if (x.cols.length > 1) colunasDuplicadas.push({ titulo: x.campo.titulo, informativa: x.campo.tipo === 'texto' })
      }

      const linhas: LinhaDaFrente[] = []
      for (const bruta of aba.linhas.slice(1)) {
        if (bruta.every((c) => celulaVazia(c))) continue
        const carimboCelula = colCarimbo >= 0 ? bruta[colCarimbo] : undefined
        const carimbo =
          carimboCelula === undefined || celulaVazia(carimboCelula)
            ? null
            : instanteDoCarimbo(carimboCelula, entrada.fusoDaPlanilha)
        const diaDoEnvio = carimbo === null ? null : diaCivil(new Date(carimbo), entrada.fusoDaClinica)
        const semanaCelula = colSemana >= 0 ? bruta[colSemana] : undefined
        const informada =
          semanaCelula === undefined || celulaVazia(semanaCelula) ? null : dataInformada(semanaCelula, diaDoEnvio)
        // Data informada repetida não cai no carimbo: o carimbo daria uma semana palpitada.
        const semana =
          colsSemana.length > 1
            ? null
            : informada !== null
              ? semanaDaDataInformada(informada.dia)
              : diaDoEnvio !== null
                ? semanaDoEnvio(diaDoEnvio)
                : null
        const mesCelula = colMes >= 0 ? bruta[colMes] : undefined
        let mesConfere: boolean | null = null
        if (mesCelula !== undefined && !celulaVazia(mesCelula) && informada !== null) {
          const mesDaData = informada.dia.slice(5, 7)
          const doSerial = mesDoSerial(mesCelula)
          mesConfere =
            doSerial !== null
              ? doSerial === mesDaData
              : normalizarNomeDaPlanilha(textoDaCelula(mesCelula)).startsWith(MESES[Number(mesDaData) - 1]!)
        }
        const valores: Record<string, ValorDeCampoDaPlanilha> = {}
        let preenchidas = 0
        for (const { campo: c, col, cols } of colCampos) {
          const v =
            cols.length > 1
              ? valorDeCampoRepetido(cols.map((i) => bruta[i]), c.tipo)
              : valorDoCampo(col >= 0 ? bruta[col] : undefined, c.tipo)
          valores[c.chave] = v
          if (v.estado !== 'vazio') preenchidas++
        }
        linhas.push({
          carimbo,
          semana,
          semanaInformada: informada === null ? null : { texto: informada.texto, semAno: informada.semAno },
          mesConfere,
          preenchidas,
          total: spec.campos.length,
          valores,
        })
      }
      linhas.sort(ordemDaLinha)
      return {
        frente: escolha.frente,
        titulo: aba.titulo,
        candidatas: [],
        colunasFaltando: colCampos.filter((x) => x.cols.length === 0 && !x.campo.opcional).map((x) => x.campo.titulo),
        semCarimbo: colsCarimbo.length === 0,
        colunasDuplicadas,
        linhas: linhas.slice(-MAXIMO_DE_LINHAS_POR_ABA),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// 6 · Validar a semana (G2) — `validarFrente`, L688-702
// ---------------------------------------------------------------------------

export type StatusDaFrente = 'ok' | 'atencao' | 'pendente'

export type CodigoDoProblemaDaPlanilha =
  | 'aba_nao_encontrada'
  | 'aba_ambigua'
  | 'coluna_nao_encontrada'
  | 'coluna_duplicada'
  | 'cabecalho_fora_do_limite'
  | 'sem_carimbo'
  | 'sem_linha'
  | 'semana_repetida'
  | 'semana_sem_ano'
  | 'mes_nao_confere'
  | 'campo_vazio'
  | 'nao_e_numero'
  | 'fora_do_padrao'

/**
 * `mensagem` nunca carrega VALOR de dinheiro: o texto do protótipo ("Valor
 * fora do padrão em X: 42.000 (o normal é perto de 12.000)") levaria o
 * faturamento para quem não tem `valores` por dentro de uma string, onde a
 * redação por nome de campo não alcança. Contagem (leads, seguidores) vai
 * como no protótipo.
 */
export type ProblemaDaPlanilha = { readonly codigo: CodigoDoProblemaDaPlanilha; readonly mensagem: string }

export type SituacaoDaFrente = {
  readonly frente: FrenteDaPlanilha
  readonly semana: string
  readonly status: StatusDaFrente
  readonly problemas: readonly ProblemaDaPlanilha[]
  /** O envio considerado (o mais recente da semana), sem os valores. */
  readonly linha: { readonly carimbo: string | null; readonly preenchidas: number; readonly total: number } | null
  /** Quantos envios caíram nesta semana. */
  readonly envios: number
}

/** Mediana do protótipo (`medianaDe`, L683): o elemento `⌊n/2⌋` da lista ordenada. */
export function medianaDaPlanilha(valores: readonly bigint[]): bigint | null {
  if (valores.length === 0) return null
  const ordenados = [...valores].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return ordenados[Math.floor(ordenados.length / 2)]!
}

/** "A partir de 5": 5 unidades, ou R$ 5,00 (500 centavos) — a mesma régua do protótipo, na unidade do campo. */
const LIMIAR_DA_MEDIANA: Readonly<Record<'dinheiro' | 'inteiro', bigint>> = { dinheiro: 500n, inteiro: 5n }

/** Mais de 3× ou menos de ¼ da mediana, comparando inteiros (`4v < m`, nunca `v < m/4`). */
export function foraDoPadrao(valor: bigint, mediana: bigint, tipo: 'dinheiro' | 'inteiro'): boolean {
  if (mediana < LIMIAR_DA_MEDIANA[tipo]) return false
  return valor > mediana * 3n || valor * 4n < mediana
}

const linhasDaSemana = (aba: AbaInterpretada, semana: string): LinhaDaFrente[] =>
  aba.linhas.filter((l) => l.semana === semana)

/** O envio que vale numa semana: o mais recente (uma correção pelo Forms é um envio novo). */
export const envioDaSemana = (aba: AbaInterpretada, semana: string): LinhaDaFrente | null =>
  linhasDaSemana(aba, semana).at(-1) ?? null

const formatarContagem = (n: bigint): string => new Intl.NumberFormat('pt-BR').format(n)

export function situacaoDaFrente(aba: AbaInterpretada | undefined, frente: FrenteDaPlanilha, semana: string): SituacaoDaFrente {
  const spec = PLANILHA_DE_INDICADORES[frente]
  const base = { frente, semana }
  if (aba === undefined || aba.titulo === null) {
    const candidatas = aba?.candidatas ?? []
    return {
      ...base,
      status: 'atencao',
      problemas: [
        candidatas.length > 1
          ? {
              codigo: 'aba_ambigua',
              mensagem: `Mais de uma aba parece ser de ${spec.aba} (${candidatas.join(', ')}). Renomeie para ficar só uma.`,
            }
          : { codigo: 'aba_nao_encontrada', mensagem: `Aba ${spec.aba} não encontrada na planilha.` },
      ],
      linha: null,
      envios: 0,
    }
  }
  if (aba.cabecalhoRecusado === true) {
    return {
      ...base,
      status: 'atencao',
      problemas: [
        {
          codigo: 'cabecalho_fora_do_limite',
          mensagem: `O cabeçalho da aba ${spec.aba} tem colunas demais ou um título longo demais; a aba não foi lida.`,
        },
      ],
      linha: null,
      envios: 0,
    }
  }
  const estrutura: ProblemaDaPlanilha[] = []
  const informativos: ProblemaDaPlanilha[] = []
  for (const d of aba.colunasDuplicadas ?? []) {
    const problema: ProblemaDaPlanilha = { codigo: 'coluna_duplicada', mensagem: `Pergunta repetida na aba: ${d.titulo}.` }
    ;(d.informativa ? informativos : estrutura).push(problema)
  }
  if (aba.semCarimbo) {
    estrutura.push({ codigo: 'sem_carimbo', mensagem: `A aba ${spec.aba} não tem a coluna "Carimbo de data/hora".` })
  }
  for (const titulo of aba.colunasFaltando) {
    estrutura.push({ codigo: 'coluna_nao_encontrada', mensagem: `Pergunta não encontrada na aba: ${titulo}.` })
  }
  const achadas = linhasDaSemana(aba, semana)
  const r = achadas.at(-1)
  if (r === undefined) {
    return {
      ...base,
      status: 'pendente',
      problemas: [{ codigo: 'sem_linha', mensagem: `Nenhuma linha desta semana na aba ${spec.aba}.` }, ...estrutura, ...informativos],
      linha: null,
      envios: 0,
    }
  }
  const pb: ProblemaDaPlanilha[] = [...estrutura]
  if (achadas.length > 1) {
    pb.push({ codigo: 'semana_repetida', mensagem: `A semana aparece ${achadas.length} vezes na aba.` })
  }
  if (r.semanaInformada?.semAno) {
    pb.push({ codigo: 'semana_sem_ano', mensagem: `Data da semana sem o ano ("${r.semanaInformada.texto}").` })
  }
  if (r.mesConfere === false) {
    pb.push({ codigo: 'mes_nao_confere', mensagem: 'O mês informado não bate com a data da semana.' })
  }
  const anteriores = aba.linhas.filter((l) => l.semana !== null && l.semana < semana).slice(-8)
  for (const c of spec.campos) {
    if (aba.colunasFaltando.includes(c.titulo)) continue
    // Já avisado como pergunta repetida; "não é número" por cima diria a mesma coisa duas vezes.
    if (c.tipo !== 'texto' && aba.colunasDuplicadas?.some((d) => !d.informativa && d.titulo === c.titulo)) continue
    const v = r.valores[c.chave] ?? { estado: 'vazio' }
    const rotulo = c.titulo
    if (v.estado === 'vazio') {
      if (!c.opcional) pb.push({ codigo: 'campo_vazio', mensagem: `Campo vazio: ${rotulo}.` })
      continue
    }
    if (v.estado === 'invalido') {
      pb.push({ codigo: 'nao_e_numero', mensagem: `Não é número: ${rotulo}.` })
      continue
    }
    if (v.estado !== 'numero' || c.tipo === 'texto') continue
    const historico = anteriores.flatMap((l) => {
      const x = l.valores[c.chave]
      return x?.estado === 'numero' ? [BigInt(x.inteiro)] : []
    })
    const md = medianaDaPlanilha(historico)
    const valor = BigInt(v.inteiro)
    if (md !== null && foraDoPadrao(valor, md, c.tipo)) {
      pb.push({
        codigo: 'fora_do_padrao',
        mensagem:
          c.tipo === 'dinheiro'
            ? `Valor fora do padrão em "${rotulo}": mais de três vezes ou menos de um quarto do normal das semanas anteriores.`
            : `Valor fora do padrão em "${rotulo}": ${formatarContagem(valor)} (o normal é perto de ${formatarContagem(md)}).`,
      })
    }
  }
  return {
    ...base,
    status: pb.length > 0 ? 'atencao' : 'ok',
    problemas: [...pb, ...informativos],
    linha: { carimbo: r.carimbo, preenchidas: r.preenchidas, total: r.total },
    envios: achadas.length,
  }
}

// ---------------------------------------------------------------------------
// 7 · Métricas (M5 e V11)
// ---------------------------------------------------------------------------

const abs = (n: bigint): bigint => (n < 0n ? -n : n)
function mdc(a: bigint, b: bigint): bigint {
  let x = abs(a)
  let y = abs(b)
  while (y !== 0n) [x, y] = [y, x % y]
  return x === 0n ? 1n : x
}
function reduzir(r: RacionalDaPlanilha): RacionalDaPlanilha {
  const sinal = r.den < 0n ? -1n : 1n
  const g = mdc(r.num, r.den)
  return { num: (sinal * r.num) / g, den: (sinal * r.den) / g }
}
const somar = (a: RacionalDaPlanilha, b: RacionalDaPlanilha): RacionalDaPlanilha =>
  reduzir({ num: a.num * b.den + b.num * a.den, den: a.den * b.den })

/** Inteiro mais próximo, meio para longe do zero — a regra de `Dinheiro.media`. */
export function arredondarRacionalDaPlanilha(r: RacionalDaPlanilha): bigint {
  const { num, den } = reduzir(r)
  const v = (2n * abs(num) + den) / (2n * den)
  return num < 0n ? -v : v
}

/** A métrica de uma frente pela chave estável ou pelo nome do protótipo. */
export function metricaDaFrente(frente: FrenteDaPlanilha, chaveOuNome: string): MetricaDaPlanilha | null {
  return PLANILHA_DE_INDICADORES[frente].metricas.find((m) => m.chave === chaveOuNome || m.nome === chaveOuNome) ?? null
}

/** O valor de uma métrica numa semana, pelo envio que vale; `null` sem envio ou sem dado. */
export function valorDaMetricaNaSemana(aba: AbaInterpretada, metrica: MetricaDaPlanilha, semana: string): RacionalDaPlanilha | null {
  const r = envioDaSemana(aba, semana)
  return r === null ? null : metrica.calcular(r.valores)
}

export type AgregacaoDaPlanilha = 'ultima' | 'media4' | 'soma4'

/**
 * **A FONTE DE META "PLANILHA"** (M5) — `valorAtualMeta`, L735-737.
 *
 * Olha as quatro semanas anteriores à `semanaCorrente` (a segunda-feira de
 * hoje, no fuso da carteira), da mais recente para a mais antiga, e junta as
 * que têm valor:
 *  - `ultima`: a mais recente COM valor (o protótipo pula a semana vazia);
 *  - `soma4`: a soma das que têm valor;
 *  - `media4`: a soma dividida por QUANTAS têm valor (não por 4), exata.
 *
 * Devolve racional exato, sem arredondar: quem compara com o alvo é
 * `avaliarMeta`, por multiplicação cruzada. `null` quando nenhuma das quatro
 * tem valor ("Aguardando o primeiro lançamento").
 *
 * Recusa `soma4` de percentual — somar taxas semanais não mede nada (gate de
 * números, ajuste 19); o protótipo oferecia a opção.
 */
export function metricaDaPlanilha(
  planilha: PlanilhaInterpretada,
  fonte: { readonly frente: FrenteDaPlanilha; readonly metrica: string; readonly agregacao: AgregacaoDaPlanilha },
  semanaCorrente: string,
): Result<RacionalDaPlanilha | null, ErroDeDominio> {
  const metrica = metricaDaFrente(fonte.frente, fonte.metrica)
  if (metrica === null) return erro(erroDe('metrica_desconhecida', 'Esta métrica não existe na planilha.'))
  if (metrica.unidade === '%' && fonte.agregacao === 'soma4') {
    return erro(erroDe('soma_de_percentual', 'Percentual não se soma: use a última semana ou a média de 4.'))
  }
  const aba = planilha.abas.find((a) => a.frente === fonte.frente)
  if (aba === undefined) return ok(null)
  const segunda = segundaDaSemanaDaPlanilha(semanaCorrente)
  const valores: RacionalDaPlanilha[] = []
  for (let k = 1; k <= 4; k++) {
    const v = valorDaMetricaNaSemana(aba, metrica, somarDias(segunda, -7 * k))
    if (v !== null) valores.push(v)
  }
  if (valores.length === 0) return ok(null)
  if (fonte.agregacao === 'ultima') return ok(valores[0]!)
  const soma = valores.reduce(somar)
  if (fonte.agregacao === 'soma4') return ok(soma)
  return ok(reduzir({ num: soma.num, den: soma.den * BigInt(valores.length) }))
}

/**
 * Lê `pl:<frente>|<métrica>|<agregação>` — o formato de fonte do protótipo
 * (`fontesMeta`, L733). A métrica pode vir pela chave ou pelo nome.
 */
export function lerFonteDaPlanilha(
  fonte: string,
): { readonly frente: FrenteDaPlanilha; readonly metrica: string; readonly agregacao: AgregacaoDaPlanilha } | null {
  if (!fonte.startsWith('pl:')) return null
  const [f, metrica, agregacao] = fonte.slice(3).split('|')
  if (!FRENTES_DA_PLANILHA.includes(f as FrenteDaPlanilha)) return null
  if (agregacao !== 'ultima' && agregacao !== 'media4' && agregacao !== 'soma4') return null
  if (metrica === undefined || metricaDaFrente(f as FrenteDaPlanilha, metrica) === null) return null
  // `as`: `f` acabou de ser conferido contra `FRENTES_DA_PLANILHA` acima.
  return { frente: f as FrenteDaPlanilha, metrica, agregacao }
}

/**
 * Uma leitura de métrica pronta para a borda, em inteiros e na unidade dela.
 * Só um dos três campos vem preenchido. `centavos` é DINHEIRO e vai, na
 * resposta HTTP, num campo de nome monetário (`valor`), para a redação de
 * valores alcançá-lo (gate A-16 / regra 17). Média em `un` vira décimos
 * (gate de números, ajuste 20); percentual, décimos de ponto.
 */
export type LeituraDaMetrica = {
  readonly centavos: bigint | null
  readonly quantidadeEmDecimos: bigint | null
  readonly percentualEmDecimos: bigint | null
}

export function leituraDaMetrica(r: RacionalDaPlanilha, unidade: UnidadeDaMetricaDaPlanilha): LeituraDaMetrica {
  if (unidade === 'R$') return { centavos: arredondarRacionalDaPlanilha(r), quantidadeEmDecimos: null, percentualEmDecimos: null }
  const decimos = arredondarRacionalDaPlanilha({ num: r.num * 10n, den: r.den })
  return unidade === 'un'
    ? { centavos: null, quantidadeEmDecimos: decimos, percentualEmDecimos: null }
    : { centavos: null, quantidadeEmDecimos: null, percentualEmDecimos: decimos }
}

export type ResumoDaMetrica = {
  readonly metrica: MetricaDaPlanilha
  readonly pontos: readonly { readonly semana: string; readonly valor: RacionalDaPlanilha | null }[]
  /** O valor da semana mais recente COM dado, na janela. */
  readonly ultimo: { readonly semana: string; readonly valor: RacionalDaPlanilha } | null
  /** Média das semanas com dado, na janela (o protótipo, L1512). */
  readonly media: RacionalDaPlanilha | null
  /**
   * Variação do último contra a segunda IMEDIATAMENTE anterior, em décimos
   * de ponto percentual, meio para longe do zero (gate de números, ajuste
   * 22). `null` sem a semana anterior ou com ela em zero ("variação
   * indefinida") — nunca o penúltimo dado, que pula lacunas.
   */
  readonly variacaoEmDecimos: bigint | null
}

export type ResumoDaFrente = {
  readonly frente: FrenteDaPlanilha
  readonly situacao: SituacaoDaFrente
  /** As 8 semanas até a de referência, da mais antiga para a mais recente (pontos coloridos de V11). */
  readonly historico: readonly { readonly semana: string; readonly status: StatusDaFrente }[]
  readonly semanasComDados: number
  readonly metricas: readonly ResumoDaMetrica[]
}

/**
 * Tudo o que `cIndicadoresPlanilha` (L1496-1514) mostra, para uma semana de
 * referência (a segunda passada) e uma janela de `n` semanas terminando
 * nela. O servidor calcula, a tela formata.
 */
export function resumirPlanilha(
  planilha: PlanilhaInterpretada,
  semanaDeReferencia: string,
  nSemanas: number,
): readonly ResumoDaFrente[] {
  const ref = segundaDaSemanaDaPlanilha(semanaDeReferencia)
  const n = Math.max(1, Math.min(104, Math.floor(nSemanas)))
  const semanas = Array.from({ length: n }, (_, i) => somarDias(ref, -7 * (n - 1 - i)))
  const historico = Array.from({ length: 8 }, (_, i) => somarDias(ref, -7 * (7 - i)))
  return FRENTES_DA_PLANILHA.map((frente) => {
    const aba = planilha.abas.find((a) => a.frente === frente)
    const metricas = PLANILHA_DE_INDICADORES[frente].metricas.map((metrica): ResumoDaMetrica => {
      const pontos = semanas.map((semana) => ({
        semana,
        valor: aba === undefined ? null : valorDaMetricaNaSemana(aba, metrica, semana),
      }))
      const comDado = pontos.flatMap((p) => (p.valor === null ? [] : [{ semana: p.semana, valor: p.valor }]))
      const ultimo = comDado.at(-1) ?? null
      const soma = comDado.length === 0 ? null : comDado.map((p) => p.valor).reduce(somar)
      const media = soma === null ? null : reduzir({ num: soma.num, den: soma.den * BigInt(comDado.length) })
      let variacaoEmDecimos: bigint | null = null
      if (ultimo !== null && aba !== undefined) {
        const anterior = valorDaMetricaNaSemana(aba, metrica, somarDias(ultimo.semana, -7))
        if (anterior !== null && anterior.num !== 0n) {
          // (u − p) / p × 1000, exato até o arredondamento final.
          const u = ultimo.valor
          variacaoEmDecimos = arredondarRacionalDaPlanilha({
            num: (u.num * anterior.den - anterior.num * u.den) * 1000n,
            den: u.den * anterior.num,
          })
        }
      }
      return { metrica, pontos, ultimo, media, variacaoEmDecimos }
    })
    return {
      frente,
      situacao: situacaoDaFrente(aba, frente, ref),
      historico: historico.map((semana) => ({ semana, status: situacaoDaFrente(aba, frente, semana).status })),
      semanasComDados: aba === undefined ? 0 : semanas.filter((s) => envioDaSemana(aba, s) !== null).length,
      metricas,
    }
  })
}
