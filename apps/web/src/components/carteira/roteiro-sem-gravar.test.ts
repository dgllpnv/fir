import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ROTEIRO, RESPOSTAS_DE_EXEMPLO } from '@/conteudo/roteiro-briefing'

/**
 * **O ENSAIO NÃO GRAVA NADA — prova pelo código-fonte** (gate LGPD A1, A3, A4,
 * A5 e os cortes A57–A59).
 *
 * O risco que o gate descreve não é técnico, é de uso: a consultora conduz
 * a conversa de verdade no "ensaio" e o relatório sai da ferramenta sem
 * registro. Por isso a varredura cobra três coisas ao mesmo tempo — nenhum
 * caminho de saída (rede, armazenamento, área de transferência), nenhum
 * import que abra um, e o conteúdo já sem as três perguntas cortadas.
 *
 * O e2e do A1 (conduzir um ensaio inteiro e olhar as requisições e o
 * armazenamento) roda no Playwright; esta varredura é a que fica na suíte e
 * reprova o primeiro `localStorage` que alguém acrescentar.
 */

const AQUI = dirname(fileURLToPath(import.meta.url))
const SRC = join(AQUI, '..', '..')

function arquivosDe(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const c = join(dir, f)
    return statSync(c).isDirectory() ? arquivosDe(c) : [c]
  })
}

const naoTeste = (c: string) => /\.tsx?$/.test(c) && !c.endsWith('.test.ts')

const ARQUIVOS = [
  join(SRC, 'conteudo', 'roteiro-briefing.ts'),
  ...arquivosDe(join(SRC, 'app', 'carteira', 'metodo', 'roteiros')).filter(naoTeste),
  ...readdirSync(AQUI)
    .filter((f) => f.startsWith('roteiro-'))
    .map((f) => join(AQUI, f))
    .filter(naoTeste),
].map((caminho) => ({
  caminho,
  nome: caminho.slice(SRC.length + 1).replace(/\\/g, '/'),
  codigo: readFileSync(caminho, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1'),
}))

describe('a varredura leu os arquivos do ticket', () => {
  it('conteúdo, tela e os componentes roteiro-*', () => {
    const nomes = ARQUIVOS.map((a) => a.nome)
    expect(nomes).toContain('conteudo/roteiro-briefing.ts')
    expect(nomes).toContain('app/carteira/metodo/roteiros/page.tsx')
    expect(nomes).toContain('components/carteira/roteiro-ensaio.ts')
    expect(nomes).toContain('components/carteira/roteiro-campo.tsx')
    expect(nomes).toContain('components/carteira/roteiro-ensaio-tela.tsx')
    expect(nomes).toContain('components/carteira/roteiro-mapa.tsx')
    expect(nomes).toContain('components/carteira/roteiro-copiar.tsx')
  })
})

describe('A1 — nenhum caminho por onde uma resposta sairia do navegador', () => {
  const PROIBIDOS: readonly [RegExp, string][] = [
    [/\blocalStorage\b/, 'localStorage'],
    [/\bsessionStorage\b/, 'sessionStorage'],
    [/\bindexedDB\b/i, 'IndexedDB'],
    [/\bcaches\s*\./, 'Cache Storage'],
    [/document\.cookie/, 'cookie'],
    [/\bfetch\s*\(/, 'fetch'],
    [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
    [/\bsendBeacon\b/, 'sendBeacon'],
    [/\bWebSocket\b/, 'WebSocket'],
    [/\bEventSource\b/, 'EventSource'],
    [/\bchamar\b/, 'chamar (cliente da API)'],
    [/\bpostar\b/, 'postar'],
    [/\bmethod\s*:/, 'método HTTP'],
    [/<form\b/, 'formulário (submit leva os campos)'],
    [/navigator\.clipboard/, 'área de transferência (A3)'],
    [/execCommand\s*\(\s*['"]copy/, 'copiar (A3)'],
    [/history\.(push|replace)State/, 'resposta na URL'],
    [/useSearchParams|router\.(push|replace)/, 'resposta na URL'],
  ]

  it.each(PROIBIDOS.map(([re, nome]) => [nome, re] as const))('nenhum %s', (_nome, re) => {
    const sujos = ARQUIVOS.filter((a) => re.test(a.codigo)).map((a) => a.nome)
    expect(sujos).toEqual([])
  })

  it('só importa o que não tem saída: React, o conteúdo, os próprios roteiro-* e peças sem rede', () => {
    const PERMITIDOS = new Set([
      'react',
      '@/conteudo/roteiro-briefing',
      '@/components/modal',
      '@/components/estados',
      '@/lib/formato',
      // A sessão (lê `v1/carteira/eu`, nunca resposta) e o menu/erro da carteira.
      '../../contexto',
      '../../pecas',
    ])
    const fora: string[] = []
    for (const a of ARQUIVOS) {
      for (const m of a.codigo.matchAll(/from\s+'([^']+)'/g)) {
        const alvo = m[1] ?? ''
        const proprio = /^\.\/roteiro-[\w-]+$/.test(alvo) || /^@\/components\/carteira\/roteiro-[\w-]+$/.test(alvo)
        if (!proprio && !PERMITIDOS.has(alvo)) fora.push(`${a.nome} → ${alvo}`)
      }
    }
    expect(fora).toEqual([])
  })

  it('campo de texto não alimenta o autopreenchimento do navegador', () => {
    const campo = ARQUIVOS.find((a) => a.nome.endsWith('roteiro-campo.tsx'))?.codigo ?? ''
    const textuais = campo.match(/<(input|textarea)\b(?![^>]*type="(radio|checkbox|date)")[^>]*>/g) ?? []
    expect(textuais.length).toBeGreaterThan(0)
    for (const t of textuais) expect(t, t).toContain('autoComplete="off"')
  })
})

describe('A3 e A4 — sem cópia, e o aviso à vista', () => {
  const tela = ARQUIVOS.find((a) => a.nome.endsWith('roteiro-ensaio-tela.tsx'))?.codigo ?? ''
  const copiar = ARQUIVOS.find((a) => a.nome.endsWith('roteiro-copiar.tsx'))?.codigo ?? ''

  it('o botão de copiar existe só desligado', () => {
    const botao = /<button[^>]*>\s*\{rotulo\}/.exec(copiar)?.[0] ?? ''
    expect(botao).toMatch(/\bdisabled\b/)
    expect(tela).toContain('<CopiarDesligado rotulo="Copiar"')
  })

  it('a faixa fixa diz o que o gate pede', () => {
    expect(tela).toContain('Ensaio: nada é salvo.')
    expect(tela).toContain('Não use com uma cliente real.')
  })

  it('o ensaio não oferece transcrição, IA, concluir nem gerar tarefas', () => {
    for (const a of ARQUIVOS) {
      expect(a.codigo, a.nome).not.toMatch(/Transcrição|transcricao|Preencher respostas vazias com IA|Concluir briefing|Gerar tarefas/)
    }
  })
})

describe('Etapa 0 — o Mapa de Maturidade não é construído (gate LGPD 1b)', () => {
  const mapa = ARQUIVOS.find((a) => a.nome.endsWith('roteiro-mapa.tsx'))?.codigo ?? ''

  it('nenhum cálculo de índice, faixa, prioridade ou plano em arquivo nenhum do ticket', () => {
    for (const a of ARQUIVOS) {
      expect(a.codigo, a.nome).not.toMatch(/indiceDoPilar|indiceGeral|dadosDoMapa|faixaDoIndice|PLANO_DO_MES|Gestão reativa|Gestão estruturada/)
    }
  })

  it('o botão do protótipo leva a uma tela que diz que o Mapa vem depois, sem receber as respostas', () => {
    expect(mapa).toContain('Chega numa próxima etapa')
    expect(mapa).not.toMatch(/\bensaio\s*[:=]/)
    expect(mapa).not.toMatch(/EstadoDoEnsaio/)
  })
})

describe('A5 + A57–A59 — o roteiro nasce com os três cortes', () => {
  const perguntas = ROTEIRO.flatMap((b) => b.perguntas)
  const porId = (id: string) => perguntas.find((p) => p.id === id)
  const conteudo = ARQUIVOS.find((a) => a.nome === 'conteudo/roteiro-briefing.ts')?.codigo ?? ''

  it('A57 — nenhuma pergunta sobre filhos', () => {
    expect(porId('filhos')).toBeUndefined()
    expect(perguntas.filter((p) => /filh/i.test(p.t))).toEqual([])
    // Nem no exemplo, nem em texto nenhum do conteúdo (comentários fora).
    expect(Object.values(RESPOSTAS_DE_EXEMPLO).filter((t) => /filh/i.test(t))).toEqual([])
    expect(conteudo).not.toMatch(/filh/i)
  })

  it('A58 — nenhuma avaliação nominal de colaboradora; braço direito é função, não nome', () => {
    expect(porId('colaboradoras')).toBeUndefined()
    expect(conteudo).not.toMatch(/ponto forte|tempo de casa/i)
    const braco = porId('braco_direito')
    expect(braco?.tipo).toBe('escolha')
    expect(porId('pessoas_por_funcao')?.tipo).toBe('porFuncao')
  })

  it('A59 — inadimplência em escolha fechada, sem texto livre', () => {
    const inad = perguntas.filter((p) => p.id.startsWith('inadimplencia'))
    expect(inad.length).toBe(2)
    for (const p of inad) expect(p.tipo).toBe('escolha')
  })
})
