import {
  blocosDoPrograma,
  NOTAS_DE_EXEMPLO,
  RESPOSTAS_DE_EXEMPLO,
  SIM_NAO,
  type BlocoDoRoteiro,
  type Pergunta,
  type Programa,
} from '@/conteudo/roteiro-briefing'

/**
 * **O ENSAIO DO BRIEFING — estado de TELA, e só de tela** (gate LGPD A1).
 *
 * Tudo aqui é função pura sobre um objeto que vive num `useState` da página.
 * Nada vai para a API, para `localStorage`, `sessionStorage` ou IndexedDB;
 * sair da tela apaga o ensaio, exatamente como o `ENSAIO = null` do protótipo
 * (L2798, L2934). `roteiro-sem-gravar.test.ts` varre o código para provar.
 *
 * **O Mapa de Maturidade não está aqui, e de propósito** (gate LGPD 1b,
 * `g8-gate-lgpd.md` §10): ele entra com a Etapa 1, junto com as respostas
 * gravadas, e o cálculo do índice nasce então em `packages/domain`, numa
 * conta só para servidor e tela.
 */

export type Resposta = string | readonly string[]
export type Situacao = 'depois' | 'na'
export type QuemResponde = 'cliente' | 'firmare'

export type EstadoDoEnsaio = {
  readonly programa: Programa
  readonly resp: Readonly<Record<string, Resposta>>
  readonly st: Readonly<Record<string, Situacao>>
  readonly quem: Readonly<Record<string, QuemResponde>>
}

export function ensaioVazio(programa: Programa): EstadoDoEnsaio {
  return { programa, resp: {}, st: {}, quem: {} }
}

/** `respVazia` (L2198), estendida ao `porFuncao`: vazio é nenhum número digitado. */
export function respVazia(v: Resposta | undefined): boolean {
  if (v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  return v.every((x) => x.trim() === '')
}

/** O encerramento não tem "Perguntar depois" nem "Não se aplica" (`ctlQ`, L2224). */
export const blocoSemControles = (bloco: BlocoDoRoteiro): boolean => bloco.id === 'encerramento'

export const tratada = (e: EstadoDoEnsaio, p: Pergunta): boolean =>
  !respVazia(e.resp[p.id]) || e.st[p.id] === 'na'

export function perguntasDoEnsaio(e: EstadoDoEnsaio): readonly Pergunta[] {
  return blocosDoPrograma(e.programa).flatMap((b) => b.perguntas)
}

/**
 * Os botões "Perguntar depois" e "Não se aplica" são chaves (L2815): tocar
 * de novo desmarca; marcar "depois" pela primeira vez assume que a cliente
 * responde.
 */
export function alternarSituacao(e: EstadoDoEnsaio, id: string, situacao: Situacao): EstadoDoEnsaio {
  const st: Record<string, Situacao> = { ...e.st }
  const quem: Record<string, QuemResponde> = { ...e.quem }
  if (st[id] === situacao) {
    delete st[id]
  } else {
    st[id] = situacao
    if (situacao === 'depois' && quem[id] === undefined) quem[id] = 'cliente'
  }
  return { ...e, st, quem }
}

/** `[tratadas, total]` — do ensaio inteiro ou de um bloco (`progDiag`, L2203). */
export function progresso(e: EstadoDoEnsaio, bloco?: BlocoDoRoteiro): readonly [number, number] {
  const ps = bloco ? bloco.perguntas : perguntasDoEnsaio(e)
  return [ps.filter((p) => tratada(e, p)).length, ps.length]
}

/** As marcadas para depois e ainda sem resposta (`pendentesDe`, L2204). */
export function pendentes(e: EstadoDoEnsaio): readonly Pergunta[] {
  return perguntasDoEnsaio(e).filter((p) => e.st[p.id] === 'depois' && respVazia(e.resp[p.id]))
}

/**
 * "Preencher com respostas de exemplo" (`exemploEnsaio`, L2901–2902), sem
 * mudar a sequência: `nivel` em rodízio, `sn` em rodízio, `escolha` na
 * primeira opção, e depois as frases fixas — tudo só onde estava vazio.
 */
export function comRespostasDeExemplo(e: EstadoDoEnsaio): EstadoDoEnsaio {
  const resp: Record<string, Resposta> = { ...e.resp }
  let k = 0
  for (const p of perguntasDoEnsaio(e)) {
    if (!respVazia(resp[p.id])) continue
    if (p.tipo === 'nivel') {
      const nota = NOTAS_DE_EXEMPLO[k++ % NOTAS_DE_EXEMPLO.length] ?? 0
      resp[p.id] = p.op[nota] ?? p.op[0]
    } else if (p.tipo === 'sn') {
      resp[p.id] = SIM_NAO[k++ % SIM_NAO.length] ?? SIM_NAO[0]
    } else if (p.tipo === 'escolha') {
      const primeira = p.op[0]
      if (primeira !== undefined) resp[p.id] = primeira
    }
  }
  for (const [id, texto] of Object.entries(RESPOSTAS_DE_EXEMPLO)) {
    if (respVazia(resp[id])) resp[id] = texto
  }
  return { ...e, resp }
}

/**
 * `Math.round(a / b)` para inteiros não negativos, sem passar por fração:
 * `⌊(2a + b) / 2b⌋`. Só desenha a barra de progresso (L2242), proporção de
 * tela e não número de negócio.
 */
export function divisaoArredondada(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b))
}

/** Texto de uma resposta para exibir (lista vira "a, b"; `porFuncao` vira "Recepção 2, ..."). */
export function textoDaResposta(p: Pergunta, v: Resposta | undefined): string {
  if (v === undefined) return ''
  if (typeof v === 'string') return v
  if (p.tipo === 'porFuncao') {
    return p.op
      .map((f, i) => [f, v[i]?.trim() ?? ''] as const)
      .filter(([, n]) => n !== '')
      .map(([f, n]) => `${f} ${n}`)
      .join(', ')
  }
  return v.join(', ')
}
