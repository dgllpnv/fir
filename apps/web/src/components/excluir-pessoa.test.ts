import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **EXCLUIR PESSOA NA TELA — a confirmação que DIZ O QUE ACONTECE.**
 *
 * O que estes testes seguram é o conteúdo da caixa, não a mecânica (essa é do
 * `Modal`, e tem teste próprio). E o conteúdo é o ponto: um "tem certeza?"
 * vazio não informa nada, e quem não sabe que o histórico FICA hesita por medo
 * de "perder os dados" — e aí o caminho real volta a ser deixar quinze
 * inativas na lista.
 *
 * Varredura sobre a FONTE, pela mesma razão de `modal.test.ts`: não há Testing
 * Library nesta árvore (dívida registrada).
 */
const AQUI = dirname(fileURLToPath(import.meta.url))
const ler = (...p: string[]) => readFileSync(join(AQUI, ...p), 'utf8')

const CAIXA = ler('excluir-pessoa.tsx')
const CLINICA = ler('tela-usuarios.tsx')
const PAINEL = ler('..', 'app', 'superadmin', 'clinicas', '[id]', 'pessoas', 'page.tsx')

const semComentarios = (texto: string): string =>
  texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const codigo = semComentarios(CAIXA)

describe('a confirmação diz o que acontece', () => {
  it('é um MODAL, com o nome da pessoa no rótulo', () => {
    expect(codigo).toMatch(/<Modal titulo=\{`Excluir \$\{comoChamar\(nome\)\} da equipe\?`\}/)
  })

  it('diz O QUE ELA PERDE: o acesso, imediatamente, com as sessões caindo', () => {
    expect(codigo).toMatch(/perde o acesso imediatamente/)
    expect(codigo).toMatch(/sessões abertas dela caem/)
  })

  it('diz O QUE FICA: o histórico, nomeado item por item', () => {
    /**
     * A metade que falta em todo "tem certeza?". Sem ela, quem decide acha que
     * está apagando o passado da clínica — e a regra 20 garante que não está.
     */
    expect(codigo).toMatch(/O histórico dela continua/)
    for (const coisa of ['tarefas', 'recebimentos', 'estoque', 'auditoria']) {
      expect(codigo, `a caixa não diz que ${coisa} continua`).toContain(coisa)
    }
    expect(codigo).toMatch(/nada do passado da clínica muda/)
  })

  it('oferece a ALTERNATIVA: desativar, para quem só vai se afastar', () => {
    expect(codigo).toMatch(/desative<\/b> em vez de excluir/)
  })

  it('NÃO é um "tem certeza?"', () => {
    expect(codigo).not.toMatch(/tem certeza/i)
    // E o botão NOMEIA a ação e a pessoa, nunca um "OK" solto.
    expect(codigo).toMatch(/Excluir \$\{comoChamar\(nome\)\}/)
    expect(codigo).toMatch(/Não excluir/)
  })

  it('mostra a RAZÃO do servidor quando o domínio recusa', () => {
    // O 422 do domínio já traz a saída ("dê acesso de administrador a outra
    // pessoa antes"); reescrevê-la aqui criaria a segunda versão da regra.
    expect(codigo).toMatch(/e instanceof ErroDaApi \? e\.message/)
    expect(codigo).toMatch(/role="alert"/)
  })

  it('é UMA caixa para os DOIS lugares — só o caminho muda', () => {
    expect(codigo).toMatch(/chamar\(caminho, \{ method: 'DELETE' \}\)/)
    expect(semComentarios(CLINICA)).toMatch(/caminho=\{`v1\/pessoas\/\$\{p\.id\}`\}/)
    expect(semComentarios(PAINEL)).toMatch(/caminho=\{`\$\{base\}\/\$\{excluindo\.id\}`\}/)
  })
})

describe('as duas telas têm EDITAR e EXCLUIR', () => {
  it('a tela da clínica: a linha É o botão de editar, e diz isso', () => {
    const c = semComentarios(CLINICA)
    expect(c).toMatch(/className="abrir"/)
    expect(c).toMatch(/aberto \? 'fechar' : 'editar'/)
    // `aria-expanded` continua no botão da linha: o rótulo visível é para quem
    // bate o olho, e o estado para quem usa leitor de tela.
    expect(c).toMatch(/aria-expanded=\{aberto\}/)
  })

  it('a tela da clínica: excluir fica DENTRO do editor aberto', () => {
    const c = semComentarios(CLINICA)
    expect(c).toMatch(/Excluir da equipe/)
    // Uma lista de seis pessoas com um "excluir" por linha é seis alvos de
    // toque errado em 390 px.
    expect(c).toMatch(/p === undefined \|\| p\.euMesma \? null : \(/)
  })

  it('a tela da clínica: NINGUÉM se exclui, e a tela nem oferece', () => {
    // O servidor recusa de qualquer forma (`NaoPodeExcluirASiMesma`); esconder
    // é conveniência, e a conveniência certa é não oferecer o que não pode.
    expect(semComentarios(CLINICA)).toMatch(/p\.euMesma \? null/)
  })

  it('a tela do painel: Editar, Redefinir senha e Excluir, nessa ordem', () => {
    const p = semComentarios(PAINEL)
    const iEditar = p.indexOf(">\n                    {editando?.id === p.id ? 'Fechar' : 'Editar'}")
    const iSenha = p.indexOf('Redefinir senha')
    const iExcluir = p.indexOf('>\n                    Excluir\n')
    expect(iEditar).toBeGreaterThan(0)
    expect(iSenha).toBeGreaterThan(iEditar)
    // A destrutiva é a ÚLTIMA.
    expect(iExcluir).toBeGreaterThan(iSenha)
  })

  it('a tela do painel: o editor NOMEIA a clínica, no título e no botão', () => {
    const p = semComentarios(PAINEL)
    expect(p).toMatch(/Editar \{pessoa\.nome\} em \{clinica\.codigo\}/)
    expect(p).toMatch(/Salvar em \$\{clinica\.codigo\}/)
    // E ele só existe com a clínica RESOLVIDA — duas abas em duas clínicas são
    // indistinguíveis por um botão que só diz "Salvar".
    expect(p).toMatch(/editando === null \|\| clinica === null \? null/)
  })

  it('o USUÁRIO não se edita, nos dois lugares, e a tela explica', () => {
    for (const [nome, fonte] of [
      ['clínica', semComentarios(CLINICA)],
      ['painel', semComentarios(PAINEL)],
    ] as const) {
      expect(fonte, `${nome}: o campo de usuário virou editável`).toMatch(
        /readOnly value=\{p(essoa)?\.usuario\}/,
      )
      expect(fonte, `${nome}: a tela não explica por que`).toMatch(/usuário não muda/)
    }
  })
})
