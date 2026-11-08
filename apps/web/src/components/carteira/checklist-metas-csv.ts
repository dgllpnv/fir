import { LinhaDeMetaEmAndamento, UNIDADES_DE_META_EM_ANDAMENTO } from '@fir/contracts'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'

/**
 * **METAS EM ANDAMENTO: do que foi digitado (ou do CSV) para o contrato.**
 *
 * O CSV é lido AQUI, no navegador (padrão do gate para importações): o
 * arquivo nunca sobe. O servidor recebe só os campos de
 * `LinhaDeMetaEmAndamento`, já validados — e valida de novo.
 *
 * Nenhum `parseFloat`: o valor digitado vira inteiro na escala do indicador
 * por leitura de DÍGITOS (`centavosDoTexto`) — `R$` em centavos, `%` em
 * centésimos de ponto ("12,5" → 1250), `un`/`dias` inteiros.
 */

export type UnidadeDigitada = (typeof UNIDADES_DE_META_EM_ANDAMENTO)[number]

/** Uma linha da tabela editável (`linhaMeta`, L1750), em texto, como digitada. */
export type LinhaDigitada = {
  titulo: string
  indicador: string
  unidade: UnidadeDigitada
  tipo: 'mensal' | 'prazo'
  valorInicial: string
  valorAtual: string
  valorMeta: string
  prazo: string
}

export const linhaVazia = (): LinhaDigitada => ({
  titulo: '',
  indicador: '',
  unidade: 'R$',
  tipo: 'mensal',
  valorInicial: '',
  valorAtual: '',
  valorMeta: '',
  prazo: '',
})

/** Linha totalmente em branco: ignorada, como no protótipo (só entra quem tem nome e alvo). */
export const linhaEmBranco = (l: LinhaDigitada): boolean =>
  [l.titulo, l.indicador, l.valorInicial, l.valorAtual, l.valorMeta, l.prazo].every((x) => x.trim() === '')

/** Texto digitado → inteiro na escala da unidade, como texto. `null` = formato que não se lê. */
export function escalaDaUnidade(unidade: UnidadeDigitada, texto: string): string | null {
  const t = texto.trim()
  if (unidade === 'R$' || unidade === '%') {
    const v = centavosDoTexto(t.replace(/^R\$\s*/i, '').replace(/%$/, ''))
    return v === null ? null : v.toString()
  }
  const limpo = /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t
  return /^\d{1,15}$/.test(limpo) ? limpo : null
}

/** `dataBR` (L1786): aaaa-mm-dd ou dd/mm/aaaa. */
export function dataDigitada(v: string): string | null {
  const t = v.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`
  return null
}

export type ResultadoDaLinha = { ok: true; meta: LinhaDeMetaEmAndamento } | { ok: false; motivo: string }

/** Uma linha digitada → o contrato, ou o motivo da recusa (sem ecoar valor em log — é só tela). */
export function metaDaLinha(l: LinhaDigitada): ResultadoDaLinha {
  if (l.titulo.trim() === '') return { ok: false, motivo: 'falta o nome da meta' }
  if (l.valorMeta.trim() === '') return { ok: false, motivo: 'falta o alvo' }
  const alvo = escalaDaUnidade(l.unidade, l.valorMeta)
  if (alvo === null) return { ok: false, motivo: 'o alvo não é um número' }
  const opcional = (t: string): string | null | undefined =>
    t.trim() === '' ? null : (escalaDaUnidade(l.unidade, t) ?? undefined)
  const inicial = opcional(l.valorInicial)
  if (inicial === undefined) return { ok: false, motivo: '"quando entrou" não é um número' }
  const atual = opcional(l.valorAtual)
  if (atual === undefined) return { ok: false, motivo: '"hoje" não é um número' }
  let prazo: string | null = null
  if (l.prazo.trim() !== '') {
    prazo = dataDigitada(l.prazo)
    if (prazo === null) return { ok: false, motivo: 'o prazo não é uma data (use dd/mm/aaaa)' }
  }
  const r = LinhaDeMetaEmAndamento.safeParse({
    titulo: l.titulo,
    indicador: l.indicador.trim() === '' ? null : l.indicador,
    unidade: l.unidade,
    tipo: l.tipo,
    valorInicial: inicial,
    valorAtual: atual,
    valorMeta: alvo,
    prazo,
  })
  if (r.success) return { ok: true, meta: r.data }
  return { ok: false, motivo: r.error.issues[0]?.message ?? 'linha inválida' }
}

/** `lerCSV` (L1774): separador `;` ou `,` pelo cabeçalho, aspas, BOM e CRLF. */
export function lerCsv(texto: string): string[][] {
  const txt = texto.replace(/^﻿/, '')
  const primeira = txt.split('\n')[0] ?? ''
  const sep = (primeira.match(/;/g) ?? []).length > (primeira.match(/,/g) ?? []).length ? ';' : ','
  const linhas: string[][] = []
  let linha: string[] = []
  let atual = ''
  let aspas = false
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i]!
    if (aspas) {
      if (ch === '"') {
        if (txt[i + 1] === '"') {
          atual += '"'
          i++
        } else aspas = false
      } else atual += ch
    } else if (ch === '"') aspas = true
    else if (ch === sep) {
      linha.push(atual)
      atual = ''
    } else if (ch === '\n') {
      linha.push(atual.replace(/\r$/, ''))
      linhas.push(linha)
      linha = []
      atual = ''
    } else atual += ch
  }
  if (atual !== '' || linha.length > 0) {
    linha.push(atual.replace(/\r$/, ''))
    linhas.push(linha)
  }
  return linhas.filter((l) => l.some((x) => x.trim() !== ''))
}

const norm = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Os cabeçalhos aceitos — os rótulos da tabela do protótipo, e sinônimos óbvios. */
const COLUNAS: Readonly<Record<keyof LinhaDigitada, readonly string[]>> = {
  titulo: ['meta', 'titulo', 'nome da meta'],
  indicador: ['indicador'],
  unidade: ['unidade'],
  tipo: ['tipo'],
  valorInicial: ['quando entrou', 'inicial', 'valor inicial', 'ponto de partida'],
  valorAtual: ['hoje', 'atual', 'valor atual', 'resultado atual'],
  valorMeta: ['alvo', 'valor da meta', 'meta alvo'],
  prazo: ['prazo', 'data final'],
}

export type LeituraDoCsv = {
  linhas: LinhaDigitada[]
  recusadas: { linha: number; motivo: string }[]
  erro: string | null
}

/**
 * O arquivo inteiro → as linhas aceitas (para a tabela, onde ainda se pode
 * corrigir) e as recusadas, cada uma com o número da linha do arquivo e o
 * motivo. Uma linha recusada não entra na tabela.
 */
export function lerMetasDoCsv(texto: string): LeituraDoCsv {
  const rows = lerCsv(texto)
  if (rows.length < 2) return { linhas: [], recusadas: [], erro: 'O arquivo não tem cabeçalho e ao menos uma meta.' }
  const cab = rows[0]!.map(norm)
  const indice = (k: keyof LinhaDigitada): number => cab.findIndex((h) => COLUNAS[k].includes(h))
  const pos = Object.fromEntries((Object.keys(COLUNAS) as (keyof LinhaDigitada)[]).map((k) => [k, indice(k)])) as Record<
    keyof LinhaDigitada,
    number
  > // Record montado a partir das MESMAS chaves de COLUNAS: o tipo é exato.
  if (pos.titulo < 0 || pos.valorMeta < 0) {
    return { linhas: [], recusadas: [], erro: 'O arquivo precisa das colunas "Meta" e "Alvo".' }
  }
  const linhas: LinhaDigitada[] = []
  const recusadas: { linha: number; motivo: string }[] = []
  rows.slice(1).forEach((r, i) => {
    const numero = i + 2
    const cel = (k: keyof LinhaDigitada): string => (pos[k] >= 0 ? (r[pos[k]] ?? '').trim() : '')
    const unidadeBruta = cel('unidade') || 'R$'
    const unidade = UNIDADES_DE_META_EM_ANDAMENTO.find((u) => norm(u) === norm(unidadeBruta))
    if (!unidade) {
      recusadas.push({ linha: numero, motivo: 'unidade fora da lista (R$, %, un, dias)' })
      return
    }
    const tipoBruto = norm(cel('tipo'))
    const tipo = tipoBruto === '' || tipoBruto === 'mensal' ? 'mensal' : tipoBruto === 'prazo' || tipoBruto === 'com prazo' ? 'prazo' : null
    if (tipo === null) {
      recusadas.push({ linha: numero, motivo: 'tipo fora da lista (Mensal ou Com prazo)' })
      return
    }
    const l: LinhaDigitada = {
      titulo: cel('titulo'),
      indicador: cel('indicador'),
      unidade,
      tipo,
      valorInicial: cel('valorInicial'),
      valorAtual: cel('valorAtual'),
      valorMeta: cel('valorMeta'),
      prazo: cel('prazo'),
    }
    const v = metaDaLinha(l)
    if (!v.ok) recusadas.push({ linha: numero, motivo: v.motivo })
    else linhas.push({ ...l, prazo: v.meta.prazo ?? '' })
  })
  return { linhas, recusadas, erro: null }
}
