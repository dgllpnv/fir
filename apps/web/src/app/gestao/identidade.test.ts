import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **O PAINEL TEM A CARA DO SISTEMA, E DIZ ONDE VOCÊ ESTÁ.**
 *
 * O painel nasceu feio de propósito, para "quem abrir isto por engano perceber
 * que não está no sistema da clínica". A intenção era legítima e a execução
 * estava errada: feiura não responde *onde estou* nem *em qual clínica estou
 * agindo*, e são essas duas perguntas que impedem o pior defeito possível
 * daqui — uma administradora criada na clínica de outra pessoa.
 *
 * Esta varredura é o que impede as duas regressões de volta:
 *
 *  1. **O estilo volta para dentro do `style={{…}}`.** Foi assim que ninguém
 *     conseguiu melhorar estas telas: estilo em objeto JavaScript não herda
 *     tema, não tem `:hover`, não tem `@media` e não aparece numa busca por
 *     classe.
 *  2. **A faixa deixa de nomear a clínica.** Uma faixa que afirma a clínica
 *     errada é pior que nenhuma faixa — ela dá confiança a uma afirmação
 *     falsa.
 *
 * Não há Testing Library nesta árvore (dívida registrada), então a varredura é
 * sobre a FONTE. O que ela pega não é tudo, mas é exatamente o que voltaria.
 */

const AQUI = dirname(fileURLToPath(import.meta.url))
const UI = join(AQUI, '..', '..', '..', '..', '..', 'packages', 'ui', 'src')

/** Todo `.tsx` do painel, recursivamente. */
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

/**
 * O CÓDIGO sem os comentários.
 *
 * As varreduras abaixo proíbem coisas que os comentários precisam poder
 * NOMEAR — o cabeçalho de `pecas.tsx` explica justamente que havia
 * `style={{…}}` ali antes. Varrer o arquivo cru transformaria "não faça isto"
 * em motivo de reprovação, e o remédio seria apagar a explicação.
 */
const semComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const PAINEL = fontes(AQUI)
const CSS_DO_PAINEL = readFileSync(join(UI, 'superadmin.css'), 'utf8')
/** O CSS sem comentários, para as varreduras que leem SELETOR e não prosa. */
const REGRAS_DO_PAINEL = CSS_DO_PAINEL.replace(/\/\*[\s\S]*?\*\//g, '')
const CSS = readdirSync(UI)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(UI, f), 'utf8'))
  .join('\n')

describe('a varredura olhou o painel inteiro', () => {
  it('achou as telas e as peças', () => {
    const nomes = PAINEL.map((f) => f.nome).sort()
    expect(nomes).toContain('layout.tsx')
    expect(nomes).toContain('casco.tsx')
    expect(nomes).toContain('faixa.tsx')
    expect(nomes).toContain('contexto.tsx')
    expect(nomes).toContain('pecas.tsx')
    // As sete telas: entrar, trocar-senha, clínicas, pessoas, grupos,
    // usuários de gestão e atividades (mais a porta `/gestao`, que é a oitava).
    expect(PAINEL.filter((f) => f.nome === 'page.tsx').length).toBe(8)
  })
})

describe('o estilo mora no sistema de design, não no JSX', () => {
  it('nenhum `style=` em tela nenhuma do painel', () => {
    const sujas = PAINEL.filter((f) => semComentarios(f.texto).includes('style=')).map(
      (f) => f.nome,
    )
    expect(
      sujas,
      'estilo inline: ele não herda tema, não tem :hover e não tem @media — mova para packages/ui/src/superadmin.css',
    ).toEqual([])
  })

  it('nenhuma fonte monoespaçada — a tipografia é Lora e Inter', () => {
    const sujas = PAINEL.filter((f) => /monospace|SFMono/.test(semComentarios(f.texto)))
    expect(sujas.map((f) => f.nome), 'a identidade é "papel e dourado"').toEqual([])
  })

  it('nenhuma cor crua: toda cor vem dos tokens', () => {
    // `#fff` no JSX é a cor que não muda com o tema — e o tema escuro é par de
    // primeira classe.
    const sujas = PAINEL.filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(semComentarios(f.texto))).map(
      (f) => f.nome,
    )
    expect(sujas).toEqual([])
    expect(
      /:\s*#[0-9a-fA-F]{3,8}\b/.test(REGRAS_DO_PAINEL),
      'superadmin.css precisa usar var(--…), nunca hex: senão o tema escuro não alcança o painel',
    ).toBe(false)
  })

  it('toda classe usada no painel existe no CSS', () => {
    /**
     * A varredura que pega o typo e pega o renome.
     *
     * Classe que não existe no CSS não dá erro em lugar nenhum: a tela só
     * nasce sem o estilo, e numa tela interna ninguém reclama. Aqui cada
     * token de `className="…"` é confrontado com os seletores de
     * `packages/ui/src`.
     */
    const usadas = new Set<string>()
    for (const f of PAINEL) {
      for (const m of f.texto.matchAll(/className="([^"{}]+)"/g)) {
        for (const c of m[1]!.split(/\s+/).filter(Boolean)) usadas.add(c)
      }
    }
    expect(usadas.size, 'nenhuma classe lida — a varredura não verificaria nada').toBeGreaterThan(
      15,
    )
    const semCss = [...usadas].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(CSS)).sort()
    expect(semCss, 'classe sem regra em packages/ui/src — a tela nasce sem estilo').toEqual([])
  })

  it('nenhuma classe do painel COLIDE com uma classe do produto', () => {
    /**
     * **A varredura que nasceu de um defeito medido, e o pior deles.**
     *
     * A faixa usava `className="barra"`. `rotina.css` tem um `.barra` global —
     * a barra de progresso da meta, de 8 px de altura e `overflow: hidden`. A
     * faixa do painel herdou as duas regras e desabou para **17 px**, com
     * "PAINEL INTERNO" cortado ao meio: o sinal inteiro do painel apagado por
     * uma classe de outro arquivo, sem nenhum erro em lugar nenhum. O teste
     * anterior ("toda classe existe no CSS") passava com folga — a classe
     * existia; só que no arquivo errado.
     *
     * A regra, daqui em diante: classe do painel é ou **compartilhada de
     * propósito** (a lista abaixo, que é o sistema de design do produto) ou
     * **só do painel** — e então ela não pode aparecer em nenhum outro CSS.
     */
    const COMPARTILHADAS = new Set([
      // Casco e tipografia da casa.
      'wrap', 'eyebrow', 'titulo', 'nota', 'cartao', 'vazio', 'sr-apenas', 'muted', 'num',
      // Formulário e ação.
      'campo', 'campo-com-botao', 'olho', 'btn', 'ghost', 'link', 'botoes', 'erro',
      // Pílulas de estado, com as variantes do produto.
      'pill', 'bom', 'mau', 'alerta', 'dourado',
      // A porta: a mesma caixa centrada da entrada do produto.
      'entrada', 'caixa', 'marca', 'erro-entrada', 'aviso-primeiro-acesso',
      // Estados.
      'esqueleto', 'fino', 'toast', 'erro-de-tela',
    ])
    const usadas = new Set<string>()
    for (const f of PAINEL) {
      for (const m of f.texto.matchAll(/className="([^"{}]+)"/g)) {
        for (const c of m[1]!.split(/\s+/).filter(Boolean)) usadas.add(c)
      }
    }
    /**
     * SEM COMENTÁRIO, e a razão é a mesma do `semComentarios` do JSX: o CSS do
     * produto precisa poder **nomear** uma classe do painel para explicar por
     * que copiou a forma dela.
     *
     * Medido: `rotina.css` passou a citar `.superadmin-dossie .link` no
     * comentário de `.botoes > .link` ("mesma forma, e pela mesma razão medida
     * lá"), e esta varredura acusou colisão numa regra que não existe. O
     * remédio seria apagar a explicação — exatamente o que o cabeçalho de
     * `semComentarios` diz que não se faz.
     */
    const outros = readdirSync(UI)
      .filter((f) => f.endsWith('.css') && f !== 'superadmin.css')
      .map((f) => readFileSync(join(UI, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
      .join('\n')
    const colidem = [...usadas]
      .filter((c) => !COMPARTILHADAS.has(c))
      .filter((c) => new RegExp(`\\.${c}(?![\\w-])`).test(outros))
      .sort()
    expect(
      colidem,
      'classe do painel que também existe no CSS do produto: prefixe-a (foi assim que a faixa virou uma barra de progresso de 8 px)',
    ).toEqual([])
  })

  it('toda coluna de código ou de quantidade usa algarismos tabulares', () => {
    // `docs/design.md` §3: número que dança entre linhas não se compara, e
    // comparar é o motivo de a coluna existir. O código da clínica é a coluna
    // que o operador varre com o olho.
    const blocos = [...REGRAS_DO_PAINEL.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    /**
     * A regra que TIPOGRAFA um código — a que escolhe fonte, corpo ou peso —
     * é a que precisa declarar os algarismos tabulares. Uma segunda regra que
     * só pinta o link de dourado não repete a declaração, e exigir isso dela
     * seria cobrar ritual em vez de resultado.
     */
    const numericos = blocos.filter(
      ([, seletor, corpo]) =>
        /\b(codigo|num)\b/.test(seletor!) && /font-(size|weight|family)/.test(corpo!),
    )
    expect(numericos.length, 'nenhuma regra de coluna numérica encontrada').toBeGreaterThan(2)
    const sem = numericos
      .filter(([, , corpo]) => !corpo!.includes('tabular-nums'))
      .map(([, seletor]) => seletor!.trim())
    expect(sem).toEqual([])
  })

  it('nenhum link sem classe — o navegador pinta de AZUL o que não tem', () => {
    /**
     * Medido na tela de entrada do painel: `<a href="/entrar">o endereço
     * dela</a>` saiu **azul**, que é a cor que `docs/design.md` §3 mais
     * combate (roxo e índigo são "a assinatura de interface gerada sem
     * direção"). Link do painel usa `.link` ou `.btn`, nunca o padrão do
     * navegador.
     */
    const nus: string[] = []
    for (const f of PAINEL) {
      for (const m of semComentarios(f.texto).matchAll(/<a\s[^>]*>/g)) {
        if (!m[0].includes('className')) nus.push(`${f.nome}: ${m[0].slice(0, 60)}`)
      }
    }
    expect(nus, 'link sem className: use `link` ou `btn`').toEqual([])
  })

  it('nenhum emoji na interface', () => {
    const sujas = PAINEL.filter((f) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(f.texto))
    expect(sujas.map((f) => f.nome), 'ícone é SVG com rótulo — design.md §3').toEqual([])
  })
})

describe('a faixa diz onde se está e em qual clínica se age', () => {
  const faixa = PAINEL.find((f) => f.nome === 'faixa.tsx')!
  const casco = PAINEL.find((f) => f.nome === 'casco.tsx')!

  it('ela nomeia o lugar', () => {
    expect(faixa.texto).toMatch(/Painel interno/)
  })

  it('ela nomeia a clínica, e as três respostas são diferentes', () => {
    // "nenhuma" na lista, "não identificada" enquanto não se sabe, e o
    // código + nome quando se sabe. Colapsar as duas primeiras numa só faria
    // a tela de pessoas parecer a lista.
    expect(faixa.texto).toMatch(/Nenhuma clínica aberta/)
    expect(faixa.texto).toMatch(/não identificada/)
    expect(faixa.texto).toMatch(/c\.codigo/)
    expect(faixa.texto).toMatch(/c\.nome/)
    // **Os DOIS ramos que agem dentro de uma clínica** dizem "Agindo na
    // clínica": o que a nomeia e o que admite não sabê-la. Contar em vez de
    // casar uma vez é o que faz o teste notar o ramo que perdeu o rótulo —
    // medido: com um `toMatch` só, apagar o rótulo de um dos dois passa.
    expect(faixa.texto.match(/Agindo na clínica/g) ?? []).toHaveLength(2)
  })

  it('ela marca a clínica DESATIVADA — agir numa é erro', () => {
    expect(faixa.texto).toMatch(/c\.ativa \? null : /)
  })

  it('ela está em toda tela de operação, e não nas portas', () => {
    expect(casco.texto).toMatch(/<FaixaDoPainel \/>/)
    expect(casco.texto).toMatch(/ehPortaDoPainel/)
  })

  it('ela é grudada no topo: o sinal vale a qualquer momento, não só no começo', () => {
    const bloco = REGRAS_DO_PAINEL.slice(
      REGRAS_DO_PAINEL.indexOf('.superadmin-faixa {'),
      REGRAS_DO_PAINEL.indexOf('}', REGRAS_DO_PAINEL.indexOf('.superadmin-faixa {')),
    )
    expect(bloco).toMatch(/position: sticky/)
    expect(bloco).toMatch(/top: 0/)
    // Dourado PREENCHIDO: é o que o produto nunca faz em largura cheia, e é o
    // que não muda entre os temas (`--gold` e `--on-gold` são iguais nos dois).
    expect(bloco).toMatch(/background: var\(--gold\)/)
    expect(bloco).toMatch(/color: var\(--on-gold\)/)
  })
})

describe('quem não sabe em qual clínica está, não age', () => {
  const pessoas = PAINEL.find(
    (f) => f.nome === 'page.tsx' && f.texto.includes('FormularioDeAdmin'),
  )!

  it('o formulário de criar administradora exige a clínica RESOLVIDA', () => {
    // Tipo não-anulável: o formulário não pode sequer ser renderizado sem a
    // clínica. Trocar por `ClinicaNaLista | null` faz este teste falhar.
    expect(pessoas.texto).toMatch(/clinica: ClinicaNaLista\n/)
    expect(pessoas.texto).toMatch(/clinica === null \?/)
  })

  it('a ação NOMEIA o alvo, no resumo e no botão', () => {
    // A última linha de defesa, e a que fica debaixo do dedo: duas abas do
    // painel abertas em duas clínicas são indistinguíveis por um botão que só
    // diz "Criar".
    expect(pessoas.texto).toMatch(/Criar administradora em \{clinica\.codigo\}/)
    expect(pessoas.texto).toMatch(/Criar administradora em \$\{clinica\.codigo\}/)
  })

  it('o dossiê nunca mostra a clínica anterior', () => {
    expect(pessoas.texto).toMatch(/não identificada/)
  })
})

/**
 * **A REGRA MUDOU EM 2026-11-08 (D-23 item 6, ADR 0024), e o que ela diz
 * agora é mais estreito do que parece.**
 *
 * Antes: "nenhum dinheiro atravessa o painel". Agora o superadmin VÊ dinheiro
 * — a Visão geral, com MRR e ticket — mas pela CONTA DE GESTÃO dele, sob a
 * sessão da carteira, pela rota da carteira (`GET /v1/carteira/painel`). O
 * que continua proibido:
 *
 *  1. uma tela do painel formatar dinheiro por conta própria (a Visão geral é
 *     o componente da carteira, não uma cópia aqui);
 *  2. o componente buscar dinheiro numa rota `/v1/superadmin/*` — essas
 *     continuam redigidas pelo `RedacaoInterceptor` (espaço `operador`), e é
 *     o e2e `conta-de-gestao-do-operador.e2e.test.ts` que o prova no servidor.
 */
describe('o painel vê dinheiro só pela conta de gestão (ADR 0024)', () => {
  const VISAO = readFileSync(
    join(AQUI, '..', '..', 'components', 'carteira', 'visao-geral.tsx'),
    'utf8',
  )
  const CARTEIRA = readFileSync(join(AQUI, '..', 'carteira', 'page.tsx'), 'utf8')
  const porta = PAINEL.find((f) => f.nome === 'page.tsx' && f.texto.includes('VisaoGeralDoPainel'))

  it('a porta do painel É a Visão geral, e é o MESMO componente da carteira', () => {
    expect(porta, '`/gestao` deixou de abrir a Visão geral').toBeDefined()
    const importa = /import \{ VisaoGeral \} from '@\/components\/carteira\/visao-geral'/
    expect(porta!.texto).toMatch(importa)
    expect(CARTEIRA, '`/carteira` tem de usar o mesmo componente, nunca uma cópia').toMatch(importa)
    expect(semComentarios(porta!.texto)).toMatch(/<VisaoGeral\b/)
  })

  it('o componente busca tudo em `/v1/carteira/*` — nada em `/v1/superadmin/*`', () => {
    const rotas = [...semComentarios(VISAO).matchAll(/chamar(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1]!)
    expect(rotas.length, 'nenhuma chamada lida — a varredura não verificaria nada').toBeGreaterThan(1)
    expect(rotas.filter((r) => !r.startsWith('v1/carteira/'))).toEqual([])
  })

  it('a porta só fala com o painel para PEDIR a sessão da conta, nunca para ler dado', () => {
    const doPainel = [...semComentarios(porta!.texto).matchAll(/chamar(?:<[^>]*>)?\(\s*[`'"](v1\/superadmin\/[^`'"]+)/g)].map(
      (m) => m[1]!,
    )
    expect(doPainel).toEqual(['v1/superadmin/eu/conta-de-gestao'])
  })

  it('o menu traz a Visão geral primeiro, depois a carteira, Clínicas, Grupos, Usuários de gestão e Atividades', () => {
    const pecas = PAINEL.find((f) => f.nome === 'pecas.tsx')!
    const rotulos = [...pecas.texto.matchAll(/\{ href: '[^']+', rotulo: '([^']+)' \}/g)].map((m) => m[1])
    expect(rotulos).toEqual(['Visão geral', 'Gestão da carteira', 'Clínicas', 'Grupos', 'Usuários de gestão', 'Atividades'])
  })
})

describe('o painel trata identidade; o negócio vem pela conta de gestão', () => {
  it('nenhuma tela do painel formata dinheiro por conta própria', () => {
    for (const f of PAINEL) {
      const codigo = semComentarios(f.texto)
      expect(codigo, `${f.nome} formata dinheiro`).not.toMatch(/formatarDinheiro|toFixed|R\$/)
      // `Intl` direto na página é proibido por `docs/design.md` §4; o prazo da
      // provisória é formatado pelo componente compartilhado do produto.
      expect(f.texto, `${f.nome} chama Intl direto`).not.toMatch(/\bIntl\./)
    }
  })

  it('nenhum `if` de permissão — o operador não tem perfil nem permissões', () => {
    for (const f of PAINEL) {
      expect(semComentarios(f.texto), `${f.nome} decide permissão na tela`).not.toMatch(
        /temPerm|ChaveDePermissao/,
      )
    }
  })

  it('a lista de clínicas continua sendo o MÍNIMO', () => {
    // Nada de contagem de pacientes, de pessoas ou de receita "para
    // enriquecer a tela": seria o mapa comercial dos clientes do produto, e o
    // painel é justamente o lugar onde esse acréscimo pareceria inofensivo.
    for (const f of PAINEL) {
      expect(f.texto, `${f.nome} lê tamanho de clínica`).not.toMatch(
        /\.(pacientes|totalDePacientes|receita|criadaEm)\b/,
      )
    }
  })
})
