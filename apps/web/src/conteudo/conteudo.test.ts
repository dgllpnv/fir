import { describe, expect, it } from 'vitest'
import { AJUDA } from './ajuda'
import { MANUAL } from './manual'
import { rotuloDoCapitulo } from './busca'

/**
 * **A varredura de FIDELIDADE do conteúdo.**
 *
 * O texto é da PO, e a autoridade dele é a do protótipo (`CLAUDE.md` §1). O
 * que este arquivo protege são as duas coisas que um "ajuste rápido" quebra em
 * silêncio:
 *
 *  1. **A contagem** — 15 capítulos, 104 seções, 75 perguntas (os 14
 *     capítulos e as 51 perguntas dela, mais o capítulo 15 e as entradas das
 *     três entregas do backlog final). Uma seção que alguém apague ao
 *     resolver um conflito não acusa nada sem isto.
 *  2. **A D-10** — nenhuma menção a PIN sobrevive: um manual que ensina a
 *     trocar o PIN manda a recepção procurar um campo que não existe. O
 *     e-mail, que a D-10 tinha tirado, VOLTOU pela ADR 2026-11-16 como canal de
 *     convite e de redefinição — e o texto tem de descrevê-lo como ele é.
 */
const tudoDaAjuda = AJUDA.map((p) => `${p.pergunta} ${p.resposta} ${p.chaves}`).join('\n')
const tudoDoManual = MANUAL.flatMap((c) =>
  c.secoes.map((s) => `${rotuloDoCapitulo(c)} ${s.titulo} ${s.texto}`),
).join('\n')
const TUDO = `${tudoDaAjuda}\n${tudoDoManual}`

describe('o conteúdo é o dela, inteiro', () => {
  it('15 capítulos, 104 seções, 75 perguntas', () => {
    expect(MANUAL).toHaveLength(15)
    expect(MANUAL.reduce((n, c) => n + c.secoes.length, 0)).toBe(104)
    expect(AJUDA).toHaveLength(75)
  })

  /**
   * **A MUTAÇÃO:** devolver os capítulos na ordem do array dela, em que o 13
   * vem antes do 12. O sumário lia "… 11, 13, 12, 14" — contra a numeração que
   * o próprio título de cada capítulo declara.
   */
  it('os capítulos vão de 1 a 15, em ordem, sem buraco e sem repetição', () => {
    expect(MANUAL.map((c) => c.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(new Set(MANUAL.map((c) => c.id)).size).toBe(15)
  })

  it('nenhum capítulo sem seção, nenhuma seção sem texto', () => {
    for (const c of MANUAL) {
      expect(c.secoes.length, rotuloDoCapitulo(c)).toBeGreaterThan(0)
      expect(c.titulo.length, c.id).toBeGreaterThan(2)
      for (const s of c.secoes) {
        expect(s.titulo.length, `${c.id}/${s.titulo}`).toBeGreaterThan(2)
        expect(s.texto.length, `${c.id}/${s.titulo}`).toBeGreaterThan(40)
      }
    }
  })

  it('nenhuma pergunta sem resposta nem sem palavra-chave', () => {
    for (const p of AJUDA) {
      expect(p.pergunta.endsWith('?') || p.pergunta.endsWith('.'), p.pergunta).toBe(true)
      expect(p.resposta.length, p.pergunta).toBeGreaterThan(40)
      expect(p.chaves.split(' ').length, p.pergunta).toBeGreaterThan(2)
      // As chaves são de BUSCA: sem acento e sem maiúscula, como as dela.
      expect(p.chaves, p.pergunta).toBe(p.chaves.toLowerCase())
      expect(p.chaves.normalize('NFD'), p.pergunta).toBe(p.chaves)
    }
    expect(new Set(AJUDA.map((p) => p.pergunta)).size).toBe(AJUDA.length)
  })
})

/**
 * **O que o T10 exige do Manual e da Ajuda** (spec indicadores-e-insights, I.2)
 * e o que as outras duas entregas do backlog final acrescentaram. Cada frase
 * aqui é uma regra que a clínica precisa ler para não estranhar o número —
 * apagar uma delas ao "enxugar" o texto devolve a dúvida ao balcão.
 */
describe('as três entregas do backlog final estão no conteúdo', () => {
  const capitulo15 = MANUAL.find((c) => c.numero === 15)
  const doCapitulo15 = (capitulo15?.secoes ?? []).map((s) => `${s.titulo} ${s.texto}`).join('\n')

  it('o capítulo 15 é Indicadores & Insights', () => {
    expect(capitulo15?.titulo).toBe('Indicadores & Insights')
  })

  it('as duas receitas, o KPI manual como posição e a régua do caixa fechado', () => {
    // números c.2: ticket médio pela conclusão, faturamento pelo recebimento.
    expect(doCapitulo15).toContain('Ticket médio e faturamento usam datas diferentes')
    // I-5: o valor do período é o último lançamento.
    expect(doCapitulo15).toContain('O valor do período é o último lançamento, não a soma')
    // números B6, R-2: a régua a partir do primeiro caixa fechado; o dia aberto à parte.
    expect(doCapitulo15).toContain('primeiro caixa fechado da clínica na ferramenta')
    expect(doCapitulo15).toContain('aguardando fechamento')
    expect(doCapitulo15).toContain('barra clara')
  })

  it('as divergências da I-38 e os avisos dos textos livres', () => {
    expect(doCapitulo15).toContain('não o nome das indicadas')
    expect(doCapitulo15).toContain('nunca a data completa de nascimento')
    expect(doCapitulo15).toContain('**Incluir telefone** vem desligado')
    expect(doCapitulo15).toContain('não use nome de pessoa nem de paciente')
    expect(doCapitulo15).toContain('não escreva nome de paciente nem dado de saúde')
  })

  it('o MedX e os links do e-mail', () => {
    expect(TUDO).toContain('Agenda ligada ao MedX')
    expect(TUDO).toContain('Conferir cadastro')
    expect(TUDO).toContain('Este link não vale mais')
    expect(TUDO).toMatch(/vale 24 horas/)
  })
})

describe('a D-10 alcançou o conteúdo', () => {
  /**
   * O PIN não existe no produto, e um manual que o mencione é a instrução que
   * sobra depois de a coisa sair. O e-mail existe de novo (ADR 2026-11-16), e
   * as duas varreduras abaixo cobram o contrário: que ele apareça como é, e
   * que nada falso sobre ele apareça.
   */
  it('nenhuma menção a PIN', () => {
    const achados = AJUDA.filter((p) =>
      /\bPIN\b/i.test(`${p.pergunta} ${p.resposta} ${p.chaves}`),
    ).map((p) => p.pergunta)
    const noManual = MANUAL.flatMap((c) =>
      c.secoes.filter((s) => /\bPIN\b/i.test(`${s.titulo} ${s.texto}`)).map(
        (s) => `${rotuloDoCapitulo(c)} / ${s.titulo}`,
      ),
    )
    expect([...achados, ...noManual]).toEqual([])
  })

  /**
   * **O e-mail VOLTOU** (ADR 2026-11-16) — como canal de convite e de
   * redefinição, nunca como lugar onde a senha viaja. O que continua falso, e
   * por isso continua proibido: falar do servidor de envio (detalhe de
   * instalação, não da rotina da recepção), prometer a senha por e-mail ou
   * dizer que a administradora vê a senha de alguém.
   */
  it('nada do que ainda é falso sobre o e-mail', () => {
    const proibidos = [
      /\bSMTP\b/i,
      /senha (provisória )?(chega|vai|é enviada) (por|pelo) e-?mail/i,
      /(administradora|admin) (vê|lê) a senha/i,
    ]
    for (const p of proibidos) {
      expect(p.test(TUDO) ? `achou ${p} no conteúdo` : 'ok').toBe('ok')
    }
  })

  it('o que entrou com o e-mail: entrar por ele, esqueci a senha, cadastrar e convite', () => {
    expect(TUDO).toContain('usuário ou e-mail')
    expect(TUDO).toContain('Esqueci minha senha')
    expect(TUDO).toContain('Cadastre seu e-mail')
    expect(TUDO).toContain('Reenviar convite')
    expect(TUDO).toContain('Enviar link para redefinir senha')
    // Os prazos são os do servidor (spec 3.3): convite 7 dias, redefinição 1 hora.
    expect(TUDO).toMatch(/vale 7 dias/)
    expect(TUDO).toMatch(/vale 1 hora/)
  })

  /**
   * **A varredura tem DENTES.** Sem esta asserção, um conteúdo esvaziado
   * passaria nas duas acima — "nenhuma menção a PIN" é trivialmente verdadeiro
   * num texto vazio. O que entrou no lugar do PIN é a senha, e ela tem de
   * estar lá.
   */
  it('o que entrou no lugar: usuário, senha e senha provisória', () => {
    expect(TUDO).toContain('senha provisória')
    expect(TUDO).toContain('usuário')
    expect(TUDO).toContain('Trocar senha')
    // A D-0 corrigida: ninguém lê a senha de outra pessoa.
    expect(TUDO).toContain('ninguém lê a senha de outra pessoa')
  })
})
