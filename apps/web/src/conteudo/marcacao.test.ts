import { describe, expect, it } from 'vitest'
import { dobrar } from './busca'
import { interpretar, textoPuro } from './marcacao'
import { MANUAL } from './manual'

describe('a marcação do manual tem três regras, e só elas', () => {
  it('linha em branco separa parágrafos; `- ` vira lista; `**` vira negrito', () => {
    const blocos = interpretar('Abra **Configurações › Procedimentos** e cadastre:\n- **Nome** do item.\n- Valor.\n\nFim.')
    expect(blocos).toEqual([
      {
        tipo: 'paragrafo',
        trechos: [
          { texto: 'Abra ', negrito: false, destaque: false },
          { texto: 'Configurações › Procedimentos', negrito: true, destaque: false },
          { texto: ' e cadastre:', negrito: false, destaque: false },
        ],
      },
      {
        tipo: 'lista',
        itens: [
          [
            { texto: 'Nome', negrito: true, destaque: false },
            { texto: ' do item.', negrito: false, destaque: false },
          ],
          [{ texto: 'Valor.', negrito: false, destaque: false }],
        ],
      },
      { tipo: 'paragrafo', trechos: [{ texto: 'Fim.', negrito: false, destaque: false }] },
    ])
  })

  /**
   * **A MUTAÇÃO:** pôr a lista antes do parágrafo do mesmo bloco. A frase que
   * introduz a lista (*"cadastre:"*) apareceria DEPOIS do que se cadastra, em
   * 23 das 78 seções — o manual inteiro lido de trás para frente.
   */
  it('dentro de um bloco, o parágrafo vem ANTES da lista', () => {
    const blocos = interpretar('Introdução:\n- um\n- dois')
    expect(blocos.map((b) => b.tipo)).toEqual(['paragrafo', 'lista'])
  })

  /**
   * **A MUTAÇÃO:** `.filter(l => l.startsWith('-'))`, sem o espaço. Uma linha
   * que começa com um travessão de pensamento viraria item de lista, e a frase
   * perderia o começo (`slice(2)` comeria dois caracteres).
   */
  it('o marcador de lista é `- `, com o espaço', () => {
    const blocos = interpretar('—é um travessão, não um item.')
    expect(blocos).toEqual([
      { tipo: 'paragrafo', trechos: [{ texto: '—é um travessão, não um item.', negrito: false, destaque: false }] },
    ])
  })

  /**
   * **A MUTAÇÃO:** um `**` sem par engolindo o resto da linha. Em conteúdo
   * escrito à mão isso apaga texto — e apagar texto é pior do que não
   * destacá-lo.
   */
  it('um `**` sozinho não engole o resto da linha', () => {
    const blocos = interpretar('O valor **total do mês')
    expect(blocos[0]).toEqual({
      tipo: 'paragrafo',
      trechos: [
        { texto: 'O valor ', negrito: false, destaque: false },
        { texto: 'total do mês', negrito: true, destaque: false },
      ],
    })
  })
})

describe('o destaque da busca casa SEM acento e corta no texto original', () => {
  /**
   * **A MUTAÇÃO:** comparar no texto original em vez do dobrado. "sessao" não
   * acharia "sessão" — que é exatamente como a recepção digita, porque o
   * teclado do balcão não tem acento à mão.
   */
  it('“sessao” destaca “sessão”, com o til preservado no texto', () => {
    const blocos = interpretar('A sessão dá baixa.', ['sessao'])
    expect(blocos[0]).toEqual({
      tipo: 'paragrafo',
      trechos: [
        { texto: 'A ', negrito: false, destaque: false },
        { texto: 'sessão', negrito: false, destaque: true },
        { texto: ' dá baixa.', negrito: false, destaque: false },
      ],
    })
  })

  /**
   * **A MUTAÇÃO:** usar `normalize('NFD')` na string inteira (o `semAcento`
   * dela). O índice achado no texto dobrado passa a apontar para outro
   * caractere, e o destaque sai deslocado — uma letra a cada acento anterior.
   *
   * É a razão de `dobrar` existir ao lado de uma dobra "normal".
   */
  it('dobrar PRESERVA o comprimento, caractere por caractere', () => {
    const textos = [
      'Sessão de programa',
      'ação, órgão, aniversário',
      'Configurações › Procedimentos',
      'R$ 1.234,56',
    ]
    for (const t of textos) expect(dobrar(t).length, t).toBe(t.length)
    expect(dobrar('Sessão')).toBe('sessao')
  })

  it('dois termos no mesmo trecho destacam os dois', () => {
    const blocos = interpretar('pagamento parcial do saldo', ['pagamento', 'saldo'])
    const trechos = blocos[0]?.tipo === 'paragrafo' ? blocos[0].trechos : []
    expect(trechos.filter((t) => t.destaque).map((t) => t.texto)).toEqual(['pagamento', 'saldo'])
  })

  it('sem termos, o texto sai num trecho só por pedaço de negrito', () => {
    const blocos = interpretar('texto simples')
    expect(blocos[0]?.tipo === 'paragrafo' ? blocos[0].trechos.length : 0).toBe(1)
  })
})

describe('a marcação atravessa as 78 seções sem perder texto', () => {
  /**
   * A varredura que importa: **nenhum caractere do texto dela se perde**.
   *
   * O interpretador tira os `**`, o `- ` dos itens e junta as linhas de um
   * parágrafo com espaço. Fora isso, cada letra do original tem de sair do
   * outro lado — e esta é a asserção que pega um `slice` errado numa seção que
   * ninguém abriu.
   */
  it('o texto puro de cada seção tem as mesmas letras do original', () => {
    const limpar = (s: string) => s.replaceAll('**', '').replace(/\s+/g, ' ').trim()
    let secoes = 0
    for (const c of MANUAL) {
      for (const s of c.secoes) {
        secoes++
        const original = limpar(s.texto.replace(/^- /gm, ''))
        expect(limpar(textoPuro(s.texto)), `${c.numero}. ${s.titulo}`).toBe(original)
      }
    }
    expect(secoes).toBe(78)
  })

  it('todo negrito do manual é um par fechado', () => {
    for (const c of MANUAL) {
      for (const s of c.secoes) {
        const asteriscos = s.texto.split('**').length - 1
        expect(asteriscos % 2, `${c.numero}. ${s.titulo} tem \`**\` sem par`).toBe(0)
      }
    }
  })
})
