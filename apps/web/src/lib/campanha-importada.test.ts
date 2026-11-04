import { describe, expect, it } from 'vitest'
import { diaCivilDaPlanilha, lerTabelaDeCampanha } from './campanha-importada'

const EQUIPE = [
  { id: 'p-rosy', nome: 'Rosy Andrade' },
  { id: 'p-sheila', nome: 'Sheila Marques' },
]
const PADROES = { prazo: '2026-12-01', responsavelId: 'p-rosy', equipe: EQUIPE }

const ler = (t: readonly (readonly string[])[], p = PADROES) => {
  const r = lerTabelaDeCampanha(t, p)
  if ('erro' in r) throw new Error(r.erro)
  return r
}

const MODELO = [
  ['Nome do paciente', 'Telefone', 'Data de nascimento', 'Campanha', 'Responsável', 'Prazo',
   'Observação'],
]

describe('data da planilha', () => {
  it('lê dd/mm/aaaa, que é o que o Excel brasileiro mostra', () => {
    expect(diaCivilDaPlanilha('12/03/1984')).toBe('1984-03-12')
    expect(diaCivilDaPlanilha('1/3/1984')).toBe('1984-03-01')
  })

  it('aceita aaaa-mm-dd sem reescrever', () => {
    expect(diaCivilDaPlanilha('2026-11-30')).toBe('2026-11-30')
  })

  it('recusa o que não dá para ler, em vez de inventar', () => {
    for (const v of ['', 'amanhã', '32/13/2026x', 'março']) expect(diaCivilDaPlanilha(v)).toBe('')
  })

  it('NÃO troca dia por mês: 03/12 é 3 de dezembro, não 12 de março', () => {
    // O defeito que cala: num prazo de recontato, dia e mês trocados fazem a
    // tarefa nascer vencida ou nascer invisível.
    expect(diaCivilDaPlanilha('03/12/2026')).toBe('2026-12-03')
  })
})

describe('planilha de campanha', () => {
  it('a modelo preenchida vira linhas do contrato', () => {
    const r = ler([
      ...MODELO,
      ['Marta Alves', '(71) 99999-0000', '12/03/1984', 'Retorno', 'Sheila Marques', '30/11/2026',
       'Prefere à tarde'],
    ])
    expect(r.linhas).toEqual([
      {
        nome: 'Marta Alves',
        telefone: '(71) 99999-0000',
        aniversario: '1984-03-12',
        prazo: '2026-11-30',
        responsavelId: 'p-sheila',
        obs: 'Prefere à tarde',
      },
    ])
    expect(r.responsaveisDesconhecidos).toEqual([])
    expect(r.prazosIlegiveis).toBe(0)
  })

  it('coluna vazia cai no padrão da caixa, não em vazio', () => {
    const r = ler([...MODELO, ['Rosa Lima', '', '', '', '', '', '']])
    expect(r.linhas[0]!.prazo).toBe('2026-12-01')
    expect(r.linhas[0]!.responsavelId).toBe('p-rosy')
  })

  it('responsável que não existe é RELATADO e cai no padrão — nunca inventa pessoa', () => {
    const r = ler([...MODELO, ['Rosa Lima', '', '', '', 'Joana Que Saiu', '', '']])
    expect(r.responsaveisDesconhecidos).toEqual(['Joana Que Saiu'])
    expect(r.linhas[0]!.responsavelId).toBe('p-rosy')
  })

  it('prazo ilegível é CONTADO e cai no padrão, não vira data torta', () => {
    const r = ler([...MODELO, ['Rosa Lima', '', '', '', '', 'semana que vem', '']])
    expect(r.prazosIlegiveis).toBe(1)
    expect(r.linhas[0]!.prazo).toBe('2026-12-01')
  })

  it('o nome do responsável casa sem acento e sem caixa', () => {
    const r = ler([...MODELO, ['Rosa Lima', '', '', '', 'rosy  ANDRADE', '', '']])
    expect(r.linhas[0]!.responsavelId).toBe('p-rosy')
    expect(r.responsaveisDesconhecidos).toEqual([])
  })

  it('a coluna Campanha da modelo é ignorada, e não vira nome de paciente', () => {
    const r = ler([...MODELO, ['Rosa Lima', '', '', 'Campanha de Verão', '', '', '']])
    expect(r.linhas).toHaveLength(1)
    expect(r.linhas[0]!.nome).toBe('Rosa Lima')
  })

  it('linha sem nome é descartada, não enviada com nome vazio', () => {
    const r = ler([...MODELO, ['', '71999990000', '', '', '', '', ''], ['Rosa Lima']])
    expect(r.linhas.map((l) => l.nome)).toEqual(['Rosa Lima'])
  })

  it('observação acima de 300 caracteres é cortada antes do envio', () => {
    const r = ler([...MODELO, ['Rosa Lima', '', '', '', '', '', 'x'.repeat(400)]])
    expect(r.linhas[0]!.obs).toHaveLength(300)
  })

  it('sem a coluna de nome, é um erro com saída — não uma importação vazia', () => {
    expect(lerTabelaDeCampanha([['Telefone', 'Obs'], ['71999990000', 'x']], PADROES)).toEqual({
      erro:
        'Não encontrei a coluna com o nome do paciente. Use a planilha modelo ou deixe o nome na primeira coluna.',
    })
  })
})
