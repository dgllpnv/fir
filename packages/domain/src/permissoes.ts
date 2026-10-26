/**
 * A matriz de permissões, portada do protótipo (`PERMS`, seção 5.1 do
 * documento de passagem).
 *
 * Tupla: [pilar, chave, rótulo, descrição, dependência?]
 *
 * `temPerm` é UMA função, usada pelo servidor e pela tela. O servidor SEMPRE
 * valida; a tela é conveniência. As dependências entre chaves vivem aqui, na
 * tabela — não num `if` espalhado pelos controladores.
 */
export const PERMS = [
  ['Dia a dia', 'tarefas.equipe', 'Ver e acompanhar as tarefas da equipe toda', 'Filtro “Equipe toda”; concluir e cancelar tarefas de outras pessoas'],
  ['Comercial', 'jornada', 'Jornada do paciente', 'Funil e situação de agendamentos, orçamentos e fechamentos'],
  ['Comercial', 'pacientes', 'Lista de pacientes e relacionamento', 'Busca, aniversariantes, origem dos pacientes'],
  ['Comercial', 'pacientes.gerir', 'Importar e excluir pacientes', ''],
  ['Comercial', 'programas', 'Programas de acompanhamento', 'Agenda de sessões e pacientes em programa'],
  ['Comercial', 'programas.gerir', 'Encerrar e excluir programas', ''],
  ['Comercial', 'campanhas', 'Campanhas', 'Ver as campanhas e executar as ações'],
  ['Comercial', 'campanhas.gerir', 'Criar, importar e excluir campanhas', ''],
  ['Financeiro', 'valores', 'Ver valores financeiros', 'Receita, LTV, saldos, valores de orçamento e de pagamentos em todas as telas'],
  ['Financeiro', 'receber', 'Registrar recebimentos', 'Tela Recebimentos e atalho + Recebimento'],
  ['Financeiro', 'caixa', 'Fechar o caixa do dia', ''],
  ['Financeiro', 'contas', 'Contas a pagar sob sua responsabilidade', 'Ver e marcar como pagas as contas em que é responsável'],
  ['Financeiro', 'contas.gerir', 'Cadastrar e ver todas as contas a pagar', ''],
  ['Financeiro', 'cobrancas', 'Cobranças de saldo em aberto', ''],
  ['Financeiro', 'finmes', 'Visão do mês e meta de faturamento', 'Despesas por categoria, resultado e meta', 'valores'],
  ['Processos', 'estoque', 'Estoque: itens, entradas, saídas e contagens', 'Inclui ler código e registrar uso em paciente'],
  ['Processos', 'estoque.gerir', 'Estoque: cadastro de itens, ajustes, custos e análise', 'Inclui valor em estoque, etiquetas, importação e locais'],
  ['Pessoas', 'pessoas.gerir', 'Equipe: fichas, metas, conversas 1:1 e banco de horas', 'Dados de RH (inclui salário)'],
  ['Gestão', 'painel', 'Painel geral', 'Indicadores de prazos, pacientes e unidades', 'valores'],
  ['Gestão', 'config', 'Configurações', 'Unidades, usuários e acessos, procedimentos'],
] as const satisfies readonly (readonly [string, string, string, string, string?])[]

export const PILARES = ['Dia a dia', 'Comercial', 'Financeiro', 'Processos', 'Pessoas', 'Gestão'] as const

export type ChaveDePermissao = (typeof PERMS)[number][1]
export type Pilar = (typeof PILARES)[number]

export type Perfil = { readonly id: string; readonly nome: string; readonly perms: readonly ChaveDePermissao[] }
export type UsuarioDePermissao = { readonly admin: boolean; readonly perfilId: string }

const porChave = new Map(PERMS.map((p) => [p[1] as ChaveDePermissao, p]))

export const infoDaPermissao = (chave: ChaveDePermissao) => porChave.get(chave)

/** Cinco perfis prontos, criados com a clínica. Editáveis pela própria clínica. */
export function perfisPadrao(): Perfil[] {
  return [
    { id: 'pf_sup', nome: 'Supervisão / gestão', perms: ['tarefas.equipe', 'jornada', 'pacientes', 'pacientes.gerir', 'programas', 'programas.gerir', 'campanhas', 'campanhas.gerir', 'valores', 'receber', 'caixa', 'contas', 'cobrancas', 'estoque', 'estoque.gerir', 'painel'] },
    { id: 'pf_rec', nome: 'Recepção', perms: ['jornada', 'pacientes', 'programas', 'campanhas', 'receber', 'caixa', 'contas', 'cobrancas', 'estoque'] },
    { id: 'pf_com', nome: 'Comercial', perms: ['jornada', 'pacientes', 'programas', 'campanhas', 'cobrancas'] },
    { id: 'pf_enf', nome: 'Enfermagem', perms: ['programas', 'estoque'] },
    { id: 'pf_fin', nome: 'Financeiro', perms: ['valores', 'receber', 'caixa', 'contas', 'contas.gerir', 'cobrancas', 'finmes'] },
  ]
}

const permsDoPerfil = (perfis: readonly Perfil[], perfilId: string): readonly ChaveDePermissao[] =>
  perfis.find((p) => p.id === perfilId)?.perms ?? []

/**
 * A mesma função no servidor e na tela.
 *
 * A dependência declarada é verificada aqui: marcar `finmes` sem `valores`
 * não libera `finmes`. Se a dependência só existisse na tela, a chave direta
 * seria uma escalada de privilégio de um passo.
 */
export function temPerm(
  usuario: UsuarioDePermissao | null | undefined,
  perfis: readonly Perfil[],
  chave: ChaveDePermissao,
): boolean {
  if (!usuario) return false
  if (usuario.admin) return true

  const perms = permsDoPerfil(perfis, usuario.perfilId)
  const dependencia = porChave.get(chave)?.[4] as ChaveDePermissao | undefined
  if (dependencia && !perms.includes(dependencia)) return false
  return perms.includes(chave)
}

/**
 * Os campos que o interceptor de redação apaga de quem não tem `valores`
 * (ou, no caso de `salario`, de quem não tem `pessoas.gerir`).
 *
 * Esta lista existe num lugar só de propósito. Um `if` por endpoint é como o
 * salário vaza no endpoint número quarenta.
 */
export const CAMPOS_MONETARIOS = [
  'valor',
  'valorAberto',
  'valorOrcamento',
  'valorPago',
  'valorTotal',
  'valorEntrada',
  'custo',
  'salario',
  'meta',
  'esperado',
  'diferenca',
  'ltv',
  'ticket',
  'recebido',
  'saldo',

  // O épico 4 (financeiro). `valor`, `valorAberto`, `valorPago`, `esperado`,
  // `diferenca`, `meta`, `recebido`, `saldo` e `ltv` já estavam acima.
  //
  // Nenhum deles mora como VALOR de um mapa cuja chave é dado: o interceptor
  // redige por NOME DE CHAVE, e `{ porForma: { Pix: '45000' } }` vaza inteiro
  // porque nem `porForma` nem `Pix` estão nesta lista. Mapa de forma de
  // pagamento, de categoria ou de programa vira ARRAY de objetos, sempre —
  // e `teste/campos-de-dinheiro-registrados.test.ts` cobra as duas coisas.
  //
  // `resultadoDoMes`, e não `resultado`: esta lista apaga por NOME em
  // qualquer profundidade de qualquer resposta, e `TarefaNaFicha.resultado`
  // já existe — é o desfecho do atendimento, um texto. Registrar `resultado`
  // apagaria o desfecho de toda tarefa para quem não tem `valores`, sem erro
  // nenhum. Nome genérico em dinheiro é nome que colide; medido.
  'aberto',
  'abatido',
  'credito',
  'contado',
  'despesasPagas',
  'resultadoDoMes',
  'aPagar',
  'fixas',
  'variaveis',
  'aReceber',
  'metaRestante',

  // O épico 5 (programas). `valor` (o do item do programa) e `valorTotal` já
  // estavam acima. `valorPorSessao` é o PREÇO DE REFERÊNCIA do catálogo — não
  // é receita (regra 4), mas é dinheiro na tela, e a enfermagem que monta o
  // programa não tem `valores`.
  //
  // Nome específico de propósito: `porSessao` sozinho seria ambíguo e
  // `preco` colidiria com qualquer campo futuro de preço de insumo.
  'valorPorSessao',
] as const
