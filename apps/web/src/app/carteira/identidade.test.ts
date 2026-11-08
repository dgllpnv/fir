import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A CARTEIRA TEM A CARA DO SISTEMA, E DIZ ONDE VOCÊ ESTÁ.
 *
 * Mesma varredura de `superadmin/identidade.test.ts`, escopada para
 * `apps/web/src/app/carteira`. As duas razões de existir são as mesmas: o
 * estilo não pode voltar para dentro do `style={{…}}`, e nenhuma classe da
 * carteira pode colidir com uma classe do produto ou do painel — foi assim
 * que a faixa do painel virou uma barra de progresso de 8 px uma vez.
 */

const AQUI = dirname(fileURLToPath(import.meta.url))
const UI = join(AQUI, '..', '..', '..', '..', '..', 'packages', 'ui', 'src')

function fontes(dir: string): { nome: string; texto: string }[] {
  const fora: { nome: string; texto: string }[] = []
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada)
    if (statSync(caminho).isDirectory()) {
      fora.push(...fontes(caminho))
      continue
    }
    if (!entrada.endsWith('.tsx')) continue
    fora.push({ nome: entrada, texto: readFileSync(caminho, 'utf8') })
  }
  return fora
}

const semComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const CARTEIRA = fontes(AQUI)
const CSS_DA_CARTEIRA = readFileSync(join(UI, 'carteira.css'), 'utf8')
const CSS = readdirSync(UI)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(UI, f), 'utf8'))
  .join('\n')

describe('a varredura olhou a carteira inteira', () => {
  it('achou as telas e as peças', () => {
    const nomes = CARTEIRA.map((f) => f.nome).sort()
    expect(nomes).toContain('layout.tsx')
    expect(nomes).toContain('casco.tsx')
    expect(nomes).toContain('faixa.tsx')
    expect(nomes).toContain('contexto.tsx')
    expect(nomes).toContain('pecas.tsx')
    // O que se prova aqui é que a varredura ENXERGA a carteira inteira — um glob quebrado devolveria
    // poucas telas e todos os testes abaixo passariam no vazio. Com o G8 são 26 telas (visão geral,
    // clientes, ficha, cadastro, entrada, metas, campanhas, mensalidades, FIR Clinic, rotina, carga,
    // leads, indicações, resumo, Método…). Piso, não igualdade: tela nova não deve quebrar este teste.
    expect(CARTEIRA.filter((f) => f.nome === 'page.tsx').length).toBeGreaterThanOrEqual(26)
  })
})

describe('o estilo mora no sistema de design, não no JSX', () => {
  it('nenhum `style=` em tela nenhuma da carteira', () => {
    const sujas = CARTEIRA.filter((f) => semComentarios(f.texto).includes('style=')).map(
      (f) => f.nome,
    )
    expect(
      sujas,
      'estilo inline: ele não herda tema, não tem :hover e não tem @media — mova para packages/ui/src/carteira.css',
    ).toEqual([])
  })

  it('nenhuma cor crua: toda cor vem dos tokens', () => {
    const sujas = CARTEIRA.filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(semComentarios(f.texto))).map(
      (f) => f.nome,
    )
    expect(sujas).toEqual([])
    expect(
      /:\s*#[0-9a-fA-F]{3,8}\b/.test(CSS_DA_CARTEIRA.replace(/\/\*[\s\S]*?\*\//g, '')),
      'carteira.css precisa usar var(--…), nunca hex: senão o tema escuro não alcança a carteira',
    ).toBe(false)
  })

  it('toda classe usada na carteira existe no CSS', () => {
    const usadas = new Set<string>()
    for (const f of CARTEIRA) {
      for (const m of f.texto.matchAll(/className="([^"{}]+)"/g)) {
        for (const c of m[1]!.split(/\s+/).filter(Boolean)) usadas.add(c)
      }
    }
    expect(usadas.size, 'nenhuma classe lida — a varredura não verificaria nada').toBeGreaterThan(5)
    const semCss = [...usadas].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(CSS)).sort()
    expect(semCss, 'classe sem regra em packages/ui/src — a tela nasce sem estilo').toEqual([])
  })

  it('nenhuma classe DA CARTEIRA colide com uma classe de outro CSS', () => {
    /** As classes do sistema de design que a carteira legitimamente reusa. */
    const COMPARTILHADAS = new Set([
      'wrap', 'titulo', 'nota', 'cartao', 'vazio', 'muted', 'erro', 'eyebrow', 'num', 'valor',
      'campo', 'campo-com-botao', 'olho', 'btn', 'ghost', 'link',
      'pill', 'bom', 'mau', 'alerta',
      'entrada', 'caixa', 'marca', 'erro-entrada',
      // A frase da troca de senha, de `shell.css` — a mesma das três outras portas.
      'aviso-primeiro-acesso',
    ])
    const usadas = new Set<string>()
    for (const f of CARTEIRA) {
      for (const m of f.texto.matchAll(/className="([^"{}]+)"/g)) {
        for (const c of m[1]!.split(/\s+/).filter(Boolean)) usadas.add(c)
      }
    }
    const outros = readdirSync(UI)
      .filter((f) => f.endsWith('.css') && f !== 'carteira.css')
      .map((f) => readFileSync(join(UI, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
      .join('\n')
    const colidem = [...usadas]
      .filter((c) => !COMPARTILHADAS.has(c))
      .filter((c) => new RegExp(`\\.${c}(?![\\w-])`).test(outros))
      .sort()
    expect(
      colidem,
      'classe da carteira que também existe em outro CSS: prefixe-a com carteira-',
    ).toEqual([])
  })
})
