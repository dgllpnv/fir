import { baixarPlanilha, type Aba } from './planilha'

/**
 * As três planilhas modelo: itens de estoque, pacientes e campanha.
 *
 * **Por que a modelo existe.** O MANUAL promete a importação a partir da
 * exportação do sistema principal — mas a clínica que não consegue exportar
 * fica sem caminho, e foi exatamente a falta que a PO apontou: *"tem que ter
 * a planilha modelo para o usuário poder baixar, preencher e subir em lote"*.
 *
 * **A aba `Instruções` não é enfeite.** É onde mora a regra que a grade de
 * células não consegue dizer: apague a linha de exemplo, não informe
 * quantidades, reimportar não duplica. Sem ela a planilha modelo é só um
 * cabeçalho, e a recepção descobre a regra pelo erro.
 *
 * As três têm a mesma forma — dados + instruções — e vêm das funções
 * `baixarModeloEst`, `baixarModeloPac` e `baixarModelo` do protótipo, com os
 * mesmos títulos de coluna, porque é por eles que o reconhecimento de
 * `colunas.ts` acha cada campo.
 */

/**
 * Sugestões, **não** uma restrição: a categoria do item é texto livre no nosso
 * contrato (`z.string().max(40)`), e a importação aceita a que vier. A lista
 * serve de exemplo na aba de instruções, como no protótipo.
 */
export const CATEGORIAS_SUGERIDAS = [
  'Injetáveis',
  'Vitaminas e ADEK',
  'Soros',
  'Bioestimuladores',
  'Implantes hormonais',
  'Descartáveis',
  'Dermocosméticos',
  'Outros',
] as const

const instrucoes = (linhas: readonly string[], largura = 110): Aba => ({
  nome: 'Instruções',
  linhas: [['Como preencher'], ...linhas.map((l) => [l])],
  larguras: [largura],
})

/* ── ITENS DE ESTOQUE ──────────────────────────────────────────────────── */

export async function baixarModeloDeItens(): Promise<void> {
  const dados: Aba = {
    nome: 'Itens',
    linhas: [
      ['Código', 'Nome do item', 'Categoria', 'Unidade de medida', 'Custo unitário',
       'Estoque mínimo', 'Alta rotatividade', 'Controla validade', 'Local'],
      ['TIR5', 'Exemplo: Tirzepatida ampola 5 mg (apague esta linha)', 'Injetáveis',
       'ampola', 380, 10, 'sim', 'sim', 'Geladeira da enfermagem'],
    ],
    larguras: [12, 44, 20, 18, 14, 14, 16, 16, 26],
  }
  await baixarPlanilha('modelo-cadastro-itens-estoque.xlsx', [
    dados,
    instrucoes(
      [
        'Pode usar a planilha exportada do sistema principal da clínica: a ferramenta reconhece colunas como Código, Produto/Descrição, Grupo/Categoria, Unidade, Custo e Mínimo.',
        'Só o nome do item é obrigatório. Não informe quantidades: o estoque começa pela contagem inicial, feita na ferramenta.',
        `Categorias sugeridas: ${CATEGORIAS_SUGERIDAS.join(', ')}. Outra categoria entra como você escrever.`,
        'Alta rotatividade e Controla validade: escreva sim ou não. Em branco, Controla validade vale sim.',
        'Local: onde o item fica na clínica (ex.: Sala de estoque, Sala de enfermagem, Geladeira da enfermagem). Locais novos são criados automaticamente.',
        'Item já cadastrado (mesmo código ou mesmo nome) não é duplicado: só completa o que estiver vazio. Alta rotatividade e Controla validade valem só para item novo — num item que já existe, a escolha feita na tela permanece.',
        'Limite de 2.000 itens por importação.',
      ],
      120,
    ),
  ])
}

/* ── PACIENTES ─────────────────────────────────────────────────────────── */

export async function baixarModeloDePacientes(exemplo: {
  nascimento: Date
  ultimaConsulta: Date
}): Promise<void> {
  const dados: Aba = {
    nome: 'Pacientes',
    linhas: [
      ['Nome completo', 'Telefone', 'Data de nascimento', 'Data da última consulta'],
      ['Maria Exemplo (apague esta linha)', '(71) 99999-0000',
       exemplo.nascimento, exemplo.ultimaConsulta],
    ],
    larguras: [38, 18, 20, 24],
    colunasDeData: [3, 4],
  }
  await baixarPlanilha('modelo-importacao-pacientes.xlsx', [
    dados,
    instrucoes([
      'Uma linha por paciente. A linha 2 é um exemplo: apague antes de importar.',
      'Nome completo: obrigatório.',
      'Telefone: opcional, com DDD. Usado no botão de WhatsApp e para reconhecer quem já está cadastrado.',
      'Data de nascimento (dd/mm/aaaa): opcional. Ativa o lembrete de aniversário.',
      'Data da última consulta (dd/mm/aaaa): opcional. Mostra há quanto tempo o paciente não volta (filtro “Sem retorno há 6+ meses”).',
      'Paciente já cadastrado (mesmo nome ou mesmo telefone): a ferramenta só completa o que estiver vazio. Nada que já existe é apagado.',
      'Pode importar a mesma lista de novo: não cria pacientes repetidos.',
      'Limite de 2.000 pacientes por importação.',
    ]),
  ])
}

/* ── CAMPANHA ──────────────────────────────────────────────────────────── */

export async function baixarModeloDeCampanha(c: {
  campanha: string
  prazo: Date
  nascimentoExemplo: Date
  equipe: readonly { nome: string; funcao: string }[]
}): Promise<void> {
  const primeiro = c.equipe[0]?.nome ?? ''
  const dados: Aba = {
    nome: 'Lista',
    linhas: [
      ['Nome do paciente', 'Telefone', 'Data de nascimento', 'Campanha', 'Responsável',
       'Prazo', 'Observação'],
      ['Maria Exemplo (apague esta linha)', '(71) 99999-0000', c.nascimentoExemplo,
       c.campanha, primeiro, c.prazo, 'Prefere contato à tarde'],
    ],
    larguras: [34, 18, 20, 30, 26, 14, 44],
    colunasDeData: [3, 6],
  }
  const equipe: Aba = {
    nome: 'Equipe',
    linhas: [
      ['Responsáveis (copie o nome exatamente assim)', 'Função'],
      ...c.equipe.map((u) => [u.nome, u.funcao]),
    ],
    larguras: [44, 28],
  }
  await baixarPlanilha('modelo-importacao-campanha.xlsx', [
    dados,
    equipe,
    instrucoes([
      'Uma linha por paciente. A linha 2 é um exemplo: apague antes de importar.',
      'Nome do paciente: obrigatório. Paciente já cadastrado (mesmo nome) é reaproveitado.',
      'Telefone e Data de nascimento (dd/mm/aaaa): opcionais.',
      `Campanha: já preenchida com ${c.campanha}. A importação usa a campanha aberta na ferramenta, não esta coluna.`,
      'Responsável: use um nome da aba Equipe, escrito igual. Em branco, vale o responsável padrão escolhido na importação.',
      'Prazo (dd/mm/aaaa): em branco, vale o prazo padrão escolhido na importação.',
      'Observação: opcional. Aparece na observação da tarefa (ex.: melhor horário, procedimento de interesse). Até 300 caracteres.',
      'Limite de 2.000 linhas por importação. Reimportar a mesma lista não duplica tarefas.',
    ]),
  ])
}
