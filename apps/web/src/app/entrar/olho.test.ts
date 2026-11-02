import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * O botão de mostrar a senha, pelas três coisas que o tornam seguro em vez de
 * conveniente. Não há Testing Library nesta árvore (dívida registrada), então
 * a varredura é sobre a fonte — o que ainda pega as três regressões reais.
 */
const FONTE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'),
  'utf8',
)

describe('mostrar a senha na tela de entrada', () => {
  it('a varredura leu a página', () => {
    expect(FONTE.length, 'page.tsx vazia').toBeGreaterThan(1000)
  })

  it('nasce ESCONDIDA', () => {
    // `useState(true)` aqui mostraria a senha de quem só abriu a tela — e no
    // balcão a tela fica aberta o dia todo, à vista de quem passa.
    expect(FONTE).toMatch(/const \[senhaVisivel, setSenhaVisivel\] = useState\(false\)/)
  })

  it('o botão é `type="button"` — senão revelar a senha TENTA ENTRAR', () => {
    // Sem isto o navegador o trata como submit: clicar no olho gastaria uma
    // das cinco tentativas por 15 minutos, e a pessoa seria barrada sem ter
    // errado a senha.
    const olho = FONTE.slice(FONTE.indexOf('className="olho"') - 400, FONTE.indexOf('className="olho"'))
    expect(olho, 'o botão do olho precisa de type="button"').toMatch(/type="button"/)
  })

  it('volta a esconder a cada tentativa', () => {
    // Computador compartilhado: senha revelada depois de uma falha fica
    // exposta para a próxima pessoa que sentar.
    const envio = FONTE.slice(0, FONTE.indexOf('setEnviando(true)'))
    expect(envio, 'setSenhaVisivel(false) precisa vir antes de setEnviando(true)').toMatch(
      /setSenhaVisivel\(false\)/,
    )
  })

  it('o input alterna entre `password` e `text`, e nada mais', () => {
    expect(FONTE).toMatch(/type=\{senhaVisivel \? 'text' : 'password'\}/)
  })

  it('o botão diz o que faz, e sem emoji', () => {
    expect(FONTE).toMatch(/aria-label=\{senhaVisivel \? 'Esconder a senha' : 'Mostrar a senha'\}/)
    expect(FONTE).toMatch(/aria-pressed=\{senhaVisivel\}/)
    // `docs/design.md`: ícone é SVG com rótulo, nunca emoji.
    expect(FONTE).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
  })
})
