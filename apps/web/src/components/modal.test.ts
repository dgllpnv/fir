import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **O MODAL, e a senha que aparece uma vez dentro dele.**
 *
 * O laço de foco tem teste de verdade em `lib/foco.test.ts` — é lá que mora a
 * lógica. Isto é a varredura da FONTE, pela mesma razão de
 * `app/gestao/identidade.test.ts`: não há Testing Library nesta árvore
 * (dívida registrada), e o que ela pega é exatamente o que voltaria se alguém
 * "simplificasse" o modal.
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (...p: string[]) => readFileSync(join(AQUI, ...p), 'utf8')

const MODAL = ler('modal.tsx')
const SENHA = ler('senha-provisoria.tsx')
const UI = join(AQUI, '..', '..', '..', '..', 'packages', 'ui', 'src')
const CSS = readFileSync(join(UI, 'modal.css'), 'utf8')
const GLOBAIS = ler('..', 'app', 'globals.css')

const semComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const CODIGO = semComentarios(MODAL)

describe('o modal é um diálogo de verdade', () => {
  it('`role="dialog"`, `aria-modal` e RÓTULO — os três', () => {
    expect(CODIGO).toMatch(/role="dialog"/)
    expect(CODIGO).toMatch(/aria-modal="true"/)
    // Sem rótulo, o leitor de tela anuncia "diálogo" e nada mais.
    expect(CODIGO).toMatch(/aria-labelledby=\{idDoTitulo\}/)
    expect(CODIGO).toMatch(/id=\{idDoTitulo\}/)
  })

  it('o foco ENTRA, no primeiro focável — não no contêiner', () => {
    expect(CODIGO).toMatch(/focaveis\(\)\[0\]\?\.focus\(\)/)
  })

  it('Esc FECHA', () => {
    expect(CODIGO).toMatch(/e\.key === 'Escape'/)
    expect(CODIGO).toMatch(/aoFechar\(\)/)
  })

  it('o foco VOLTA para quem abriu, e só se ele ainda existe', () => {
    expect(CODIGO).toMatch(/const quemAbriu = document\.activeElement/)
    expect(CODIGO).toMatch(/quemAbriu instanceof HTMLElement && quemAbriu\.isConnected/)
    expect(CODIGO).toMatch(/quemAbriu\.focus\(\)/)
  })

  it('o foco fica PRESO, pela lógica que tem teste próprio', () => {
    expect(CODIGO).toMatch(/precisaPrender\(/)
    expect(CODIGO).toMatch(/proximoFoco\(/)
    expect(MODAL).toMatch(/from '@\/lib\/foco'/)
  })

  it('CLICAR FORA NÃO FECHA — é a razão de o modal existir', () => {
    /**
     * A informação que ele guarda é a que **some**: a senha provisória aparece
     * uma vez. Um toque errado no véu, com ela na tela, custa uma redefinição
     * — e derruba as sessões da pessoa de novo.
     *
     * A varredura é sobre o véu: ele não pode ter `onClick`, e não pode ser um
     * `<button>`.
     */
    const veu = CODIGO.slice(CODIGO.indexOf('veu-de-modal'))
    const abertura = veu.slice(0, veu.indexOf('>'))
    expect(abertura, 'o véu ficou clicável: fechar deixou de ser um ato').not.toMatch(/onClick/)
    expect(CODIGO).not.toMatch(/<button[^>]*veu-de-modal/)
  })

  it('o véu NÃO é `aria-hidden` — ele é o ancestral do diálogo', () => {
    // `aria-hidden` num ancestral esconde o filho: o modal inteiro sairia da
    // árvore de acessibilidade, que é o oposto do que `aria-modal` faz.
    const veu = CODIGO.slice(CODIGO.indexOf('veu-de-modal'))
    expect(veu.slice(0, veu.indexOf('>'))).not.toMatch(/aria-hidden/)
  })

  it('a folha existe e está importada — senão ele nasce sem véu', () => {
    expect(GLOBAIS).toMatch(/@import '@fir\/ui\/modal\.css'/)
    expect(CSS).toMatch(/\.veu-de-modal/)
    expect(CSS).toMatch(/position: fixed/)
  })
})

describe('o modal cabe em 390 px', () => {
  it('é a CAIXA que rola, não a página', () => {
    // `position: fixed` no `body` é o truque comum, e ele faz a página pular
    // para o topo ao fechar — no balcão isso perde o lugar da lista.
    expect(CSS).toMatch(/max-height: 100%/)
    expect(CSS).toMatch(/overflow-y: auto/)
    expect(CODIGO, 'o modal travou a rolagem do corpo').not.toMatch(/body\.style/)
  })

  it('os botões EMPILHAM no celular', () => {
    expect(CSS).toMatch(/@media \(max-width: 419px\)/)
    expect(CSS).toMatch(/width: 100%/)
  })

  it('nada de vidro nem de sombra — `design.md` §3', () => {
    expect(CSS).not.toMatch(/backdrop-filter/)
    expect(CSS).not.toMatch(/box-shadow/)
    expect(CSS).not.toMatch(/linear-gradient/)
  })

  it('nenhuma cor crua: toda cor vem dos tokens', () => {
    expect(CSS.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/:\s*#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('a senha provisória mora no modal, e diz o que precisa dizer', () => {
  const codigo = semComentarios(SENHA)

  it('ela é o modal, não um bloco no topo da tela', () => {
    expect(codigo).toMatch(/<Modal titulo=/)
    expect(codigo, 'voltou a ser um painel no topo da tela').not.toMatch(/className="painel"/)
  })

  it('a senha é DESTAQUE, legível de longe — ela vai ser ditada por telefone', () => {
    expect(codigo).toMatch(/className="segredo"/)
    const bloco = CSS.slice(CSS.indexOf('.modal .segredo'))
    expect(bloco).toMatch(/font-size: 22px/)
    // Um toque seleciona o valor inteiro: metade de uma senha ditada é uma
    // ligação a mais.
    expect(bloco).toMatch(/user-select: all/)
  })

  it('copia USUÁRIO E SENHA juntos — não só a senha', () => {
    expect(codigo).toMatch(/Usuário: \$\{usuario\}/)
    expect(codigo).toMatch(/Senha provisória: \$\{senha\}/)
    expect(codigo).toMatch(/Copiar usuário e senha/)
  })

  it('diz as 72 HORAS e a troca obrigatória no primeiro acesso', () => {
    expect(codigo).toMatch(/72 horas/)
    expect(codigo).toMatch(/obrigada a trocá-la no primeiro acesso/)
  })

  it('diz que ela aparece UMA vez, e qual é a saída se perder', () => {
    expect(codigo).toMatch(/aparece só desta vez/)
    expect(codigo).toMatch(/Redefinir senha/)
  })

  it('o fechamento é um ATO, e o rótulo diz o que a pessoa afirma', () => {
    expect(codigo).toMatch(/Já anotei, fechar/)
  })

  it('nenhum `style=` inline: o estilo mora no sistema de design', () => {
    expect(codigo, 'estilo inline não herda tema, não tem :hover e não tem @media').not.toMatch(
      /style=/,
    )
  })
})
