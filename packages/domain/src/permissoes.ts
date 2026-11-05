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
  /**
   * O indicador "Saldo a receber nos programas", no topo da tela Programas.
   *
   * **Encontrado pela varredura `campos-de-dinheiro-registrados`**, não por
   * revisão: sem esta linha, o número atravessava para a enfermagem sem
   * `valores`. É o nome número quarenta que o `CLAUDE.md` descreve — o que
   * ninguém revisa com o cuidado do primeiro.
   *
   * `aReceber` (do financeiro) já estava acima e **não** cobre este: a redação
   * casa nome exato, não prefixo, de propósito — um casamento por prefixo
   * apagaria `aReceberQuantos` no dia em que alguém o criasse.
   */
  'saldoAReceber',

  // ---------------------------------------------------------------------
  // O ÉPICO 6, segunda fatia: a contagem e a nota de entrada.
  //
  // `custo` já estava acima e cobre o do item e o do movimento de entrada.
  // Os três abaixo são novos, e nenhum deles reaproveita um nome existente
  // de propósito:
  //
  //  * `valorDaFalta` — o que a diferença da contagem VALE, ao custo
  //    cadastrado. É o indicador "Falta nesta contagem (valor)" do protótipo.
  //    Não é `valor`: ele viaja ao lado de `itensComFalta`, que NÃO é dinheiro
  //    e é justamente o que a equipe sem `valores` lê.
  //
  //  * `valorUnitario` — o `vUnCom` da NF-e, por unidade da nota, em centavos.
  //
  //  * `custoDaNota` — o custo por unidade da NOTA, de ENTRADA. Nome próprio
  //    porque a escala é outra: `custo` é por `medida`, e um nome só para as
  //    duas escalas seria a ambiguidade que a regra 9 fecha. Ele é campo de
  //    entrada, e registrá-lo aqui não custa nada: a redação apaga por nome em
  //    qualquer resposta, e não há resposta com este nome.
  //
  // **O que NÃO entra aqui, e é o ponto:** `esperadoEmEstoque`,
  // `contadoEmEstoque`, `diferencaEmEstoque`, `saldoEmEstoque`. São
  // QUANTIDADES, e `esperado`, `contado`, `diferenca` e `saldo` já estão nesta
  // lista por causa do caixa e do saldo da paciente. Nomeá-los assim faria a
  // redação apagar a contagem inteira para a enfermagem — é o mesmo defeito
  // que `saldo` → `saldoEmEstoque` registrou no épico 6, medido em
  // `estoque.e2e.test.ts`.
  // ---------------------------------------------------------------------
  'valorDaFalta',
  'valorUnitario',
  'custoDaNota',

  // ---------------------------------------------------------------------
  // O ÉPICO 7, segunda fatia: as METAS do mês de uma pessoa.
  //
  // Dos nove indicadores de `IND_PES`, **um é dinheiro** (`orc_valor`, em
  // centavos) e oito são quantidade ou ponto percentual. Os dois nomes abaixo
  // carregam o único que é — e a regra 17 exige que, sem `valores`, a meta
  // entregue **só o percentual**.
  //
  // **O que NÃO entra aqui, e é o ponto inteiro:** `metaEmNumero`,
  // `realizadoEmNumero`, `percentual` e `mediaDeAtingimento`. Nenhum é
  // dinheiro. Registrá-los faria a recepcionista sem `valores` abrir "Minhas
  // metas" e ler `— de —`, que é esconder o trabalho dela em vez do preço de
  // alguma coisa — o mesmo defeito de `saldo` → `saldoEmEstoque`, pelo lado
  // inverso. `percentual` é justamente o que sobra para quem não vê valor, e
  // ele não revela a meta: "84% da meta" não diz quanto é a meta.
  //
  // `meta` já está nesta lista (a meta de faturamento, épico 4) e NÃO cobre
  // estes dois: a redação casa nome EXATO, nunca prefixo — de propósito, senão
  // `metaEmNumero` seria apagado junto.
  // ---------------------------------------------------------------------
  'metaEmDinheiro',
  'realizadoEmDinheiro',

  // ---------------------------------------------------------------------
  // O ÉPICO 8: as CAMPANHAS e o PAINEL GERAL.
  //
  //  * `resultadoEmDinheiro` — o resultado da campanha quando a métrica é
  //    `receita`. Par de `metaEmDinheiro`, que já está acima. As outras três
  //    métricas usam `resultadoEmNumero`, que **não** entra: a Recepção tem
  //    `campanhas` e não tem `valores` — é o perfil padrão dela —, e apagar
  //    "38 de 40 contatos" seria esconder o trabalho em vez do preço.
  //
  //  * `receita` — quanto a campanha gerou, e quanto o PAINEL registrou no
  //    período. Existe sempre, mesmo quando a meta é de contatos.
  //
  //  * `ticketMedio` — `receita ÷ pagamentos`, pelo `Dinheiro.media` (regra
  //    1). É o único campo desta lista que nasce de uma DIVISÃO.
  //
  //  * `valorDosOrcamentosPagos` — a soma dos orçamentos fechados no período.
  //    Nome próprio, e não `valorOrcamento`: aquele é o valor PROPOSTO (que
  //    não é receita, regra 4) e este é o que ENTROU no fechamento. Dois
  //    fatos, dois nomes.
  //
  // **O que NÃO entra:** `resultadoEmNumero`, `metaEmNumero`,
  // `percentualDaMeta`, `taxaDeConversao`, `taxaNoPrazo`,
  // `conversaoDeOrcamentos` e todas as contagens do painel. Nenhum é
  // dinheiro, e os percentuais são exatamente o que sobra para quem não vê
  // valor.
  // ---------------------------------------------------------------------
  'resultadoEmDinheiro',
  'receita',
  'ticketMedio',
  'valorDosOrcamentosPagos',

  // ---------------------------------------------------------------------
  // O ÉPICO 8, SEGUNDA FATIA: os quatro blocos que fecham o capítulo 10.
  //
  //  * `faturamento` — o recebido da UNIDADE na janela do painel. Nome
  //    próprio porque é o rótulo da coluna dela ("Faturamento"), e porque
  //    `receita` já significa outra coisa na MESMA resposta: a receita do
  //    período inteiro. Dois fatos, dois nomes — a ambiguidade de `plano`
  //    que o `CONTEXT.md` abre proibindo.
  //
  //  * `ltvMedio` — a média do LTV entre as pacientes de uma unidade que já
  //    pagaram algo. `ltv` já está nesta lista e **não** o cobre: a redação
  //    casa nome EXATO, nunca prefixo (de propósito, senão `ltvTotal`
  //    desapareceria junto com qualquer campo futuro que comece com `ltv`).
  //
  //  * `ltvTotal` — quanto as pacientes novas de uma origem já pagaram, na
  //    vida, somado. Não é `receita` pela mesma razão de `faturamento`: a
  //    janela é a vida da paciente, não o período.
  //
  // **O que NÃO entra, e é o ponto:** `novos`, `jaAtendidos`, `pacientes`,
  // `pagamentos`, `programasNovos`, `programasAtivos`, `sessoesPrevistas`,
  // `sessoesComFalta`, `taxaDeFalta`, `tarefasAtrasadas` e `diasSemCaixa`.
  // Nenhum é dinheiro, e apagá-los esconderia o trabalho da unidade em vez
  // do preço de alguma coisa — o mesmo defeito de `saldo` → `saldoEmEstoque`,
  // pelo lado inverso.
  // ---------------------------------------------------------------------
  'faturamento',
  'ltvMedio',
  'ltvTotal',

  // ---------------------------------------------------------------------
  // G3 — a carteira comercial: `Cobrança do Cliente Firmare`, `Mensalidade` e
  // `Meta comercial do cliente` (ADR 0015).
  //
  // Hoje nenhum `Usuário de Gestão` tem a chave `valores` (não existe perfil
  // de permissão granular para a carteira ainda — só `escopo`, ADR 0012), e o
  // `RedacaoInterceptor` falha FECHADO quando `req.contexto` não existe
  // (`pode = () => false`): como as rotas de carteira nunca populam
  // `req.contexto` (elas populam `req.carteira`, um espaço de identidade
  // disjunto), TODO campo monetário listado aqui sai `null` para TODO
  // `Usuário de Gestão`, sempre, até que a carteira ganhe sua própria chave
  // `valores` — o que já satisfaz o critério 2.2.11 do spec G3 (regra 17) por
  // construção, sem precisar de um segundo interceptor.
  //
  //  * `mensalidade` — o valor vigente que um `Cliente Firmare` paga por
  //    competência (`clientes_carteira.mensalidade_centavos`).
  //  * `desconto` — o `Benefício de indicação` efetivamente aplicado a UMA
  //    `Cobrança` (o par de `aplicarDesconto`, nunca só a cobrança final).
  //  * `valorMeta`, `valorInicial` — os dois campos de `Meta comercial do
  //    cliente` quando o `Indicador` é `unidade = "R$"`. Nomes próprios,
  //    porque `meta` (acima) já significa a meta de FATURAMENTO da própria
  //    clínica (épico 4) — colidir apagaria um campo que não é este.
  //
  // `valor` (já na lista, épico 2) cobre o valor final cobrado
  // (`Cobrança.valor`) e o valor de um `Lançamento de indicador`
  // `unidade = "R$"` — nenhum dos dois precisa de nome próprio.
  // ---------------------------------------------------------------------
  'mensalidade',
  'desconto',
  'valorMeta',
  'valorInicial',
  /**
   * `ListaDeCobrancasCarteiraSaida.somaValor` — a soma de `Cobrança` por
   * cliente (critério 2.2.10/achado 1, ADR 0015). Nome próprio porque `valor`
   * sozinho já está na lista e redige cada LINHA; sem um nome dedicado para a
   * SOMA, esquecer de registrá-lo aqui vazaria o agregado para quem não tem
   * `valores`, mesmo com cada linha individual corretamente apagada —
   * encontrado pelo teste de redação deste próprio ticket, não por revisão.
   */
  'somaValor',
] as const
