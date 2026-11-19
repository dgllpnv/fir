import type { Perfil } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { AJUDA } from './ajuda'
import {
  ajudaVisivel,
  buscarNaAjuda,
  buscarNoManual,
  manualVisivel,
  podeVerConteudoDeGestao,
  pontuarPergunta,
  rotuloDoCapitulo,
  termosDeBusca,
} from './busca'
import { MANUAL } from './manual'

const RECEPCAO: Perfil[] = [{ id: 'pf_rec', nome: 'Recepção', perms: ['jornada', 'receber'] }]
const SUPERVISAO: Perfil[] = [
  { id: 'pf_sup', nome: 'Supervisão', perms: ['valores', 'painel'] },
]
const recepcionista = { admin: false, perfilId: 'pf_rec' }
const supervisora = { admin: false, perfilId: 'pf_sup' }

describe('os termos de busca', () => {
  it('ignora palavra de uma letra e dobra acento e caixa', () => {
    expect(termosDeBusca('Pagamento Parcial')).toEqual(['pagamento', 'parcial'])
    expect(termosDeBusca('Sessão')).toEqual(['sessao'])
    // Uma letra solta casaria com quase tudo, e é a regra dela.
    expect(termosDeBusca('a b de')).toEqual(['de'])
    expect(termosDeBusca('   ')).toEqual([])
  })
})

describe('a busca da Ajuda é E, não OU', () => {
  /**
   * **A MUTAÇÃO:** `OU` no lugar de `E` (somar zero em vez de descartar). A
   * busca por "pagamento parcial" passaria a devolver as treze respostas que
   * falam de pagamento, com a que responde a pergunta no meio da lista. É a
   * diferença entre uma busca e uma lista.
   */
  it('a pergunta que não casa com TODOS os termos fica fora', () => {
    const achados = buscarNaAjuda(AJUDA, ['pagamento', 'parcial'])
    expect(achados.length).toBeGreaterThan(0)
    expect(achados[0]?.pergunta).toBe('O paciente pagou só uma parte. Como registro?')
    for (const a of achados) {
      const tudo = `${a.pergunta} ${a.chaves} ${a.tema} ${a.resposta}`.toLowerCase()
      expect(tudo).toContain('parcial')
    }
  })

  /**
   * **A MUTAÇÃO:** pesos iguais (1, 1, 1). A pergunta cujo TÍTULO é a dúvida
   * digitada deixa de vir primeiro, e a resposta certa some para dentro de uma
   * lista ordenada por acaso.
   */
  it('título pesa 3, palavra-chave 2, corpo 1 — e um termo pontua uma vez só', () => {
    const p = {
      tema: 'Financeiro',
      pergunta: 'Como fecho o caixa do dia?',
      resposta: 'Em Financeiro › Caixa do dia, informe os totais conferidos.',
      chaves: 'caixa fechar gaveta',
    }
    // "caixa" está no título, nas chaves E no corpo: pontua 3, não 6.
    expect(pontuarPergunta(p, ['caixa'])).toBe(3)
    // "gaveta" só nas chaves.
    expect(pontuarPergunta(p, ['gaveta'])).toBe(2)
    // "conferidos" só no corpo.
    expect(pontuarPergunta(p, ['conferidos'])).toBe(1)
    expect(pontuarPergunta(p, ['estoque'])).toBeNull()
    expect(pontuarPergunta(p, ['caixa', 'gaveta'])).toBe(5)
  })

  it('acha pela palavra-chave que não está no texto nenhum', () => {
    // "zap" é `k` da pergunta do WhatsApp, e não aparece em título nem corpo.
    const achados = buscarNaAjuda(AJUDA, ['zap'])
    expect(achados[0]?.pergunta).toBe('Como mando mensagem pelo WhatsApp?')
  })

  it('sem termo nenhum, devolve a lista inteira na ordem dela', () => {
    expect(buscarNaAjuda(AJUDA, [])).toHaveLength(AJUDA.length)
    expect(buscarNaAjuda(AJUDA, [])[0]).toEqual(AJUDA[0])
  })
})

describe('a busca do manual', () => {
  it('o título da seção pesa mais que o corpo', () => {
    const achados = buscarNoManual(MANUAL, termosDeBusca('caixa do dia'))
    expect(achados[0]?.secao.titulo).toBe('Caixa do dia')
  })

  it('acha sem acento e sem caixa', () => {
    const achados = buscarNoManual(MANUAL, termosDeBusca('SESSAO'))
    expect(achados.length).toBeGreaterThan(0)
  })

  it('sem termo nenhum, não há achados — a tela mostra o sumário', () => {
    expect(buscarNoManual(MANUAL, [])).toEqual([])
  })

  it('o rótulo do capítulo junta número e título', () => {
    expect(rotuloDoCapitulo({ id: 'm10', numero: 10, titulo: 'Painel', secoes: [] })).toBe(
      '10. Painel',
    )
  })
})

describe('o conteúdo de gestão só aparece para quem tem `painel` ou `config`', () => {
  it('a recepção não vê; a supervisão vê', () => {
    expect(podeVerConteudoDeGestao(recepcionista, RECEPCAO)).toBe(false)
    expect(podeVerConteudoDeGestao(supervisora, SUPERVISAO)).toBe(true)
    // A administradora vê por `temPerm`, não por um `||admin` à parte.
    expect(podeVerConteudoDeGestao({ admin: true, perfilId: null }, [])).toBe(true)
  })

  /**
   * **A MUTAÇÃO:** filtrar só o CAPÍTULO, e não as seções de dentro.
   *
   * O capítulo 12 (Estoque) não é de gestão e tem quatro seções que são
   * ("Unidades de medida", "Cadastrar itens", "Locais do estoque", "Importar o
   * cadastro"). Sem o segundo filtro, a enfermagem lê o custo unitário e a
   * curva ABC no manual de uma tela em que não consegue entrar.
   *
   * **A SEGUNDA:** filtrar só as SEÇÕES. O capítulo 10 (Painel) é inteiro de
   * gestão e as três seções dele não têm a marca: ele apareceria com título e
   * nada dentro — um capítulo vazio no sumário da recepção.
   */
  it('filtra o capítulo E as seções, e capítulo que esvaziou não aparece', () => {
    const daRecepcao = manualVisivel(MANUAL, false)
    const daGestao = manualVisivel(MANUAL, true)

    expect(daGestao).toHaveLength(15)
    expect(daRecepcao.map((c) => c.numero)).not.toContain(10)

    // O capítulo 15 fica para a recepção só com o que é dela: lançar o KPI
    // manual de que é responsável, os textos livres e o "sem valores".
    const indicadores = daRecepcao.find((c) => c.numero === 15)
    expect(indicadores?.secoes.map((s) => s.titulo)).toEqual([
      'Para que serve',
      'Lançar o valor de um KPI manual',
      'Textos livres: o que não escrever',
      'Sem acesso a valores',
    ])

    const estoque = daRecepcao.find((c) => c.numero === 12)
    expect(estoque, 'o capítulo 12 não é de gestão e tem de ficar').toBeDefined()
    expect(estoque!.secoes.map((s) => s.titulo)).not.toContain('Unidades de medida')
    expect(estoque!.secoes.map((s) => s.titulo)).toContain('Código QR: etiquetas e leitura pelo celular')

    // Nenhum capítulo visível fica sem seção nenhuma.
    for (const c of daRecepcao) expect(c.secoes.length, rotuloDoCapitulo(c)).toBeGreaterThan(0)
  })

  it('as 46 perguntas da equipe, e as 77 da gestão', () => {
    expect(ajudaVisivel(AJUDA, false)).toHaveLength(46)
    expect(ajudaVisivel(AJUDA, true)).toHaveLength(77)
    // Oito temas para a equipe, nove para a gestão — "Gestão" é o nono.
    expect(new Set(ajudaVisivel(AJUDA, false).map((p) => p.tema)).size).toBe(8)
    expect(new Set(ajudaVisivel(AJUDA, true).map((p) => p.tema)).size).toBe(9)
  })
})

/**
 * **As perguntas das três entregas são achadas pelo que a recepção digita**,
 * não pelo título exato. Cada caso é uma dúvida de balcão, com as palavras
 * dela.
 */
describe('a busca acha as entregas do backlog final', () => {
  const primeira = (digitado: string, gestao = true) =>
    buscarNaAjuda(ajudaVisivel(AJUDA, gestao), termosDeBusca(digitado))[0]?.pergunta

  it('lançar o indicador, sem acento, pela recepção', () => {
    expect(primeira('lancar indicador', false)).toBe('Recebi a tarefa “Lançar” um indicador. Como faço?')
  })

  it('o MedX, o link vencido e o e-mail', () => {
    expect(primeira('medx agendamento', false)).toBe('A clínica usa o MedX. Preciso lançar o agendamento aqui também?')
    expect(primeira('link expirou', false)).toBe('O link do e-mail diz que não vale mais. E agora?')
    expect(primeira('confirmar email', false)).toBe('Como confirmo o meu e-mail?')
  })

  it('o caixa aberto que não entra na meta, o telefone e a campanha da lista', () => {
    expect(primeira('aguardando fechamento')).toBe('Por que o recebido de hoje não entra na meta de faturamento?')
    expect(primeira('telefone exportar')).toBe('Por que o telefone não veio no arquivo exportado?')
    // "lista campanha" sozinho empata com "Como importo uma lista de pacientes
    // para a campanha?" (as duas palavras nos dois títulos) e a dela vem antes;
    // é o "relatório" que separa a lista tirada daqui da planilha importada.
    expect(primeira('campanha relatorio')).toBe('Como tiro uma lista de pacientes para uma campanha?')
  })

  it('o manual acha o capítulo 15 pelo título da seção', () => {
    const achados = buscarNoManual(MANUAL, termosDeBusca('modo reuniao'))
    expect(achados[0]?.secao.titulo).toBe('Modo reunião')
    expect(achados[0]?.capitulo.numero).toBe(15)
  })
})
