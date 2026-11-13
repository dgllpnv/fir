import type { LinhaDaCampanha as LinhaDoContrato } from '@fir/contracts'
import { limparNomeDeLista } from '@fir/domain'
import { celula, mapear, normalizar, type Apelidos } from './colunas'

/** A linha como VAI no corpo (JSON): o valor da lista em centavos, em texto. */
export type LinhaDaCampanha = Omit<LinhaDoContrato, 'valorDeReferencia'> & {
  valorDeReferencia?: string
}

/**
 * Planilha de campanha → linhas do contrato.
 *
 * **Por que a tela resolve o responsável e o prazo, e não o servidor.** A
 * planilha modelo traz o responsável pelo NOME (é o que a usuária sabe
 * escrever) e o contrato exige `responsavelId`. Mandar o nome para o servidor
 * obrigaria a API a casar texto com pessoa — uma segunda regra de
 * correspondência de nome, fora do Postgres, exatamente o que a importação de
 * pacientes evita de propósito. Aqui a tela já tem a lista da equipe na mão,
 * casa pelo nome normalizado, e o que não casa cai no padrão escolhido na
 * caixa, visível antes do envio.
 *
 * **Prazo é data civil `aaaa-mm-dd`**, e a planilha traz `dd/mm/aaaa`. A
 * conversão mora aqui porque `DiaCivil` do contrato recusa qualquer outra
 * forma — e recusar é o comportamento certo: uma data ambígua num prazo de
 * recontato vira tarefa vencida ou tarefa que nunca aparece.
 */

const APELIDOS: Apelidos = [
  ['prazo', ['prazo', 'data limite', 'vencimento', 'ate']],
  ['responsavel', ['responsavel', 'quem contata', 'atendente']],
  ['aniversario', ['data de nascimento', 'nascimento', 'aniversario', 'nasc']],
  ['telefone', ['telefone', 'celular', 'whatsapp', 'fone', 'contato']],
  ['obs', ['observacao', 'observacoes', 'obs', 'nota']],
  // `campanha` existe na modelo mas é IGNORADA de propósito: a importação usa
  // a campanha aberta na ferramenta. A coluna é reivindicada só para que
  // `nome` não a confunda com o nome do paciente.
  ['campanha', ['campanha']],
  ['nome', ['nome do paciente', 'nome completo', 'nome', 'paciente']],
]

const POSICIONAL = {
  nome: 0, telefone: 1, aniversario: 2, campanha: 3, responsavel: 4, prazo: 5, obs: 6,
}

/** `dd/mm/aaaa` ou `aaaa-mm-dd` → `aaaa-mm-dd`; `''` quando não dá. */
export function diaCivilDaPlanilha(bruto: string): string {
  const t = bruto.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t)
  if (m === null) return ''
  const [, d = '', mes = '', a = ''] = m
  const ano = a.length === 2 ? `20${a}` : a.padStart(4, '0')
  return `${ano}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export type Padroes = {
  prazo: string
  responsavelId: string
  equipe: readonly { id: string; nome: string }[]
}

export type Lidas = {
  linhas: readonly LinhaDaCampanha[]
  /** Nomes da coluna Responsável que não casaram com ninguém da equipe. */
  responsaveisDesconhecidos: readonly string[]
  /** Quantas linhas traziam um prazo que não deu para ler. */
  prazosIlegiveis: number
  /**
   * O que a limpeza do nome mudou — a PRÉVIA do que vai ser gravado. A planilha
   * da cliente traz "6. Maria Souza - R$ 15.200" na coluna do
   * paciente; o índice e o valor saem do nome, e o valor (centavos) fica aqui,
   * só para a prévia de quem tem `valores`.
   */
  nomesLimpos: readonly { original: string; nome: string; valorEmCentavos: bigint | null }[]
}

export function lerTabelaDeCampanha(
  tabela: readonly (readonly string[])[],
  padroes: Padroes,
): Lidas | { erro: string } {
  const m = mapear(tabela, APELIDOS, POSICIONAL, ['nome', 'paciente', 'telefone', 'celular'])
  if ('erro' in m) return m
  if ((m.indices['nome'] ?? -1) < 0) {
    return {
      erro:
        'Não encontrei a coluna com o nome do paciente. Use a planilha modelo ou deixe o nome na primeira coluna.',
    }
  }

  const nomesLimpos: { original: string; nome: string; valorEmCentavos: bigint | null }[] = []
  const porNome = new Map(padroes.equipe.map((p) => [normalizar(p.nome), p.id]))
  const linhas: LinhaDaCampanha[] = []
  const desconhecidos = new Set<string>()
  let prazosIlegiveis = 0

  for (const linha of m.corpo) {
    const original = celula(linha, m.indices, 'nome')
    const limpo = limparNomeDeLista(original)
    const nome = limpo.nome
    if (nome === '') continue
    if (nome !== original.replace(/\s+/g, ' ').trim()) {
      nomesLimpos.push({ original, nome, valorEmCentavos: limpo.valorEmCentavos })
    }

    const resp = celula(linha, m.indices, 'responsavel')
    let responsavelId = padroes.responsavelId
    if (resp !== '') {
      const achado = porNome.get(normalizar(resp))
      if (achado === undefined) desconhecidos.add(resp)
      else responsavelId = achado
    }

    const prazoBruto = celula(linha, m.indices, 'prazo')
    let prazo = padroes.prazo
    if (prazoBruto !== '') {
      const lido = diaCivilDaPlanilha(prazoBruto)
      if (lido === '') prazosIlegiveis++
      else prazo = lido
    }

    linhas.push({
      nome: nome.slice(0, 120),
      telefone: celula(linha, m.indices, 'telefone').slice(0, 30),
      aniversario: diaCivilDaPlanilha(celula(linha, m.indices, 'aniversario')),
      prazo,
      responsavelId,
      obs: celula(linha, m.indices, 'obs').slice(0, 300),
      // O valor que a lista trazia; sem ele, nada é enviado (o campo é opcional).
      ...(limpo.valorEmCentavos === null
        ? {}
        : { valorDeReferencia: limpo.valorEmCentavos.toString() }),
    })
  }

  return { linhas, responsaveisDesconhecidos: [...desconhecidos], prazosIlegiveis, nomesLimpos }
}
