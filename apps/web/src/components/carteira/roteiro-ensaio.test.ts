import { describe, expect, it } from 'vitest'
import { blocosDoPrograma, PROGRAMAS, ROTEIRO, type Pergunta } from '@/conteudo/roteiro-briefing'
import {
  alternarSituacao,
  comRespostasDeExemplo,
  divisaoArredondada,
  ensaioVazio,
  pendentes,
  progresso,
  type EstadoDoEnsaio,
} from './roteiro-ensaio'

type Nivel = Extract<Pergunta, { tipo: 'nivel' }>

const niveisDo = (pilar: string): Nivel[] =>
  (ROTEIRO.find((b) => b.pilar === pilar)?.perguntas ?? []).filter((p): p is Nivel => p.tipo === 'nivel')

describe('a barra de progresso arredonda como o protótipo, sem passar por fração', () => {
  // Domínio inteiro da barra: n tratadas de t perguntas, t até o maior roteiro.
  it('⌊(2a + b) / 2b⌋ = Math.round(a / b) para toda contagem possível', () => {
    const maior = Math.max(...PROGRAMAS.map(
      (p) => blocosDoPrograma(p).flatMap((b) => b.perguntas).length,
    ))
    for (let t = 1; t <= maior; t++) {
      for (let n = 0; n <= t; n++) {
        expect(divisaoArredondada(n * 100, t), `${n} de ${t}`).toBe(Math.round((n * 100) / t))
      }
    }
  })
})

describe('o ensaio, em memória', () => {
  it('"Perguntar depois" é chave: liga, assume a cliente, e desliga no segundo toque', () => {
    const e0 = ensaioVazio('Comercial')
    const e1 = alternarSituacao(e0, 'canais', 'depois')
    expect(e1.st.canais).toBe('depois')
    expect(e1.quem.canais).toBe('cliente')
    expect(pendentes(e1).map((p) => p.id)).toEqual(['canais'])
    const e2 = alternarSituacao(e1, 'canais', 'depois')
    expect(e2.st.canais).toBeUndefined()
    expect(pendentes(e2)).toEqual([])
  })

  it('"Não se aplica" conta como tratada', () => {
    const e = alternarSituacao(ensaioVazio('Comercial'), 'canais', 'na')
    expect(progresso(e)[0]).toBe(1)
  })

  it('respostas de exemplo preenchem todos os níveis e não sobrescrevem o que já foi respondido', () => {
    const base: EstadoDoEnsaio = { ...ensaioVazio('Gestão'), resp: { responsavel_nome: 'Outra' } }
    const e = comRespostasDeExemplo(base)
    expect(e.resp.responsavel_nome).toBe('Outra')
    const niveis = blocosDoPrograma('Gestão').flatMap((b) => b.perguntas).filter((p) => p.tipo === 'nivel')
    expect(niveis.length).toBeGreaterThan(0)
    for (const p of niveis) expect(e.resp[p.id], p.id).toBeDefined()
    // O original não muda: o estado é imutável, cada passo devolve um novo.
    expect(base.resp.g_meta_recepcao).toBeUndefined()
  })

  it('o exemplo segue o rodízio do protótipo: 0, 1, 2, 1, 3, 0, 1, 2 nos níveis', () => {
    const e = comRespostasDeExemplo(ensaioVazio('Gestão'))
    const primeiros = niveisDo('rumo').map((p) => p.op.indexOf(String(e.resp[p.id])))
    // Antes dos níveis de Rumo, o programa Gestão tem um `sn` (metas_time) que gasta uma posição.
    expect(primeiros).toEqual([1, 2, 1, 3, 0])
  })

  it('o programa decide os blocos: Gestão tem os cinco pilares, Comercial nenhum', () => {
    expect(blocosDoPrograma('Gestão').filter((b) => b.pilar).length).toBe(5)
    expect(blocosDoPrograma('Comercial').filter((b) => b.pilar).length).toBe(0)
  })
})
