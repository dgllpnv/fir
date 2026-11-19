import type { UnidadeDeKpi } from './indicadores/unidades'

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
  // Indicadores & Insights (I-32). `indicadores.gerir` depende de `indicadores`,
  // que NÃO tem dependência própria: `temPerm` confere um nível só, e o teste
  // `perms-sem-dependencia-em-cadeia` cobra que nenhuma cadeia nasça (appsec C4).
  ['Gestão', 'indicadores', 'Indicadores & Insights', 'OKRs, KPIs, metas e relatórios'],
  ['Gestão', 'indicadores.gerir', 'Criar e editar KPIs, metas e OKRs', 'Inclui a meta de faturamento e o plano de ação', 'indicadores'],
  ['Gestão', 'config', 'Configurações', 'Unidades, usuários e acessos, procedimentos'],
] as const satisfies readonly (readonly [string, string, string, string, string?])[]

export const PILARES = ['Dia a dia', 'Comercial', 'Financeiro', 'Processos', 'Pessoas', 'Gestão'] as const

export type ChaveDePermissao = (typeof PERMS)[number][1]
export type Pilar = (typeof PILARES)[number]

export type Perfil = { readonly id: string; readonly nome: string; readonly perms: readonly ChaveDePermissao[] }
export type UsuarioDePermissao = { readonly admin: boolean; readonly perfilId: string }

const porChave = new Map(PERMS.map((p) => [p[1] as ChaveDePermissao, p]))

export const infoDaPermissao = (chave: ChaveDePermissao) => porChave.get(chave)

const CHAVES_DE_PERMISSAO: ReadonlySet<string> = new Set(PERMS.map((p) => p[1]))

/**
 * Estreita um texto a `ChaveDePermissao` sem `as`: o texto que não é uma
 * chave da tabela dá `false`, e quem pergunta `pode(texto)` recebe "não" —
 * falha fechado, nunca uma chave inventada que passa pelo tipo.
 */
export const ehChaveDePermissao = (k: string): k is ChaveDePermissao => CHAVES_DE_PERMISSAO.has(k)

/**
 * Seis perfis prontos, criados com a clínica. Editáveis pela própria clínica.
 *
 * `pf_ges` NÃO está no protótipo (decisão do dono, ADR 2026-11-11): só `pessoas.gerir`, que
 * **inclui salário** — o texto da tela diz isso. Dívida: separar `pessoas.salario`.
 */
export function perfisPadrao(): Perfil[] {
  return [
    { id: 'pf_sup', nome: 'Supervisão / gestão', perms: ['tarefas.equipe', 'jornada', 'pacientes', 'pacientes.gerir', 'programas', 'programas.gerir', 'campanhas', 'campanhas.gerir', 'valores', 'receber', 'caixa', 'contas', 'cobrancas', 'estoque', 'estoque.gerir', 'painel', 'indicadores', 'indicadores.gerir'] },
    { id: 'pf_rec', nome: 'Recepção', perms: ['jornada', 'pacientes', 'programas', 'campanhas', 'receber', 'caixa', 'contas', 'cobrancas', 'estoque'] },
    { id: 'pf_com', nome: 'Comercial', perms: ['jornada', 'pacientes', 'programas', 'campanhas', 'cobrancas'] },
    { id: 'pf_enf', nome: 'Enfermagem', perms: ['programas', 'estoque'] },
    { id: 'pf_fin', nome: 'Financeiro', perms: ['valores', 'receber', 'caixa', 'contas', 'contas.gerir', 'cobrancas', 'finmes'] },
    { id: 'pf_ges', nome: 'Gestão de pessoas', perms: ['pessoas.gerir'] },
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
 * **Valor em reais exige `valores` para ESCREVER** (appsec C3). Um predicado
 * só, chamado por toda rota que grava alvo ou partida: meta, série, prévia,
 * KR de OKR (criar, editar e duplicar) e o `PUT` de KPI manual que muda a
 * unidade para `reais`. Quem grava um alvo em reais conhece o alvo — e com o
 * `percentualDaMeta` que a equipe lê, deduz o atual.
 */
export function exigeValoresParaEscrever(unidade: UnidadeDeKpi): boolean {
  return unidade === 'reais'
}

/** O predicado acima aplicado à pessoa: pode gravar alvo/partida nesta unidade? */
export function podeEscreverNaUnidade(
  usuario: UsuarioDePermissao | null | undefined,
  perfis: readonly Perfil[],
  unidade: UnidadeDeKpi,
): boolean {
  return !exigeValoresParaEscrever(unidade) || temPerm(usuario, perfis, 'valores')
}

export type KpiParaLancar = {
  readonly origem: 'catalogo' | 'manual'
  readonly arquivado: boolean
  /** Lido do banco NA MESMA TRANSAÇÃO que grava o lançamento (appsec C1). */
  readonly responsavelId: string | null
}

/**
 * Quem pode lançar o valor de um KPI manual (I-31) — a EXCEÇÃO NOMEADA da
 * matriz de acesso: a responsável lança mesmo sem `indicadores`. A gestão
 * (`indicadores.gerir`) também lança, para corrigir.
 *
 * Cada recusa tem o seu status na borda (appsec C1): KPI de catálogo → 422,
 * arquivado → 409, quem não é a responsável → 403. O KPI de outra clínica nem
 * chega aqui: a RLS o esconde e a rota dá 404.
 *
 * **Não abre leitura** (appsec C2): nenhuma rota de leitura chama esta
 * função. O que a janela de lançamento precisa chega pela tarefa.
 */
export function podeLancar(
  usuario: (UsuarioDePermissao & { readonly pessoaId: string }) | null | undefined,
  perfis: readonly Perfil[],
  kpi: KpiParaLancar,
): 'pode' | 'kpi_de_catalogo' | 'kpi_arquivado' | 'nao_e_responsavel' {
  if (kpi.origem !== 'manual') return 'kpi_de_catalogo'
  if (kpi.arquivado) return 'kpi_arquivado'
  if (!usuario) return 'nao_e_responsavel'
  if (kpi.responsavelId !== null && kpi.responsavelId === usuario.pessoaId) return 'pode'
  return temPerm(usuario, perfis, 'indicadores.gerir') ? 'pode' : 'nao_e_responsavel'
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
  'valorFechado',
  // O valor lido da lista importada da campanha (migration 0080). REFERÊNCIA,
  // nunca receita (regras 3 e 4), mas dinheiro para a redação (regra 17).
  'valorDeReferencia',
  // O que sobra do orcamento depois do fechamento parcial (oferecido - fechado).
  'valorRestante',
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
  // qualquer profundidade de qualquer resposta, e `TarefaNaLista.resultado`
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

  // A fatia 4.2: a linha "Outras entradas" da Visão do mês (dinheiro que não é de
  // paciente). O `valor` de cada entrada já está acima.
  'outrasEntradas',
  // O devido do 409 PARTES_ACIMA_DA_DIVIDA (V-1). O serviço já o omite sem
  // `valores`; estar aqui é a segunda camada se o 409 passar pela redação.
  'devido',

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

  // O DETALHE DA CAMPANHA (`/campanhas/:id`) e os KPIs do mês da lista.
  // `valorConvertido` (a soma da receita das campanhas do mês) e
  // `faltaEmDinheiro` ("Faltam R$ X" na meta em reais). `faltaEmNumero`,
  // `percentualRealizado` e as contagens NÃO entram: não são dinheiro, e a
  // equipe sem `valores` lê o andamento delas. `valor` (por tipo) e
  // `valorTotal` (drill-down) já estavam acima.
  'valorConvertido',
  'faltaEmDinheiro',

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
  /**
   * G8 1C — campanhas da carteira (`campanhas-carteira.ts` dos contratos).
   * `receita` e `resultadoEmDinheiro`/`metaEmDinheiro` já estavam acima.
   * `retornoSobreInvestimento`, e NÃO `retorno`: `retorno` já nomeia a regra
   * de retorno do procedimento e a tarefa de retorno do programa
   * (`programas.ts`), e registrá-lo apagaria as duas de quem não tem
   * `valores`. O retorno é redigido porque `retorno × investimento` devolve a
   * receita.
   */
  'investimento',
  'valorGerado',
  'retornoSobreInvestimento',
  /**
   * G8 0.4 — a seção PAGAMENTO do cadastro do `Cliente Firmare` (dia do
   * vencimento e WhatsApp de cobrança), num objeto aninhado que sai `null`
   * INTEIRO (appsec A-2, LGPD A30). Nome próprio, e NÃO `pagamento`:
   * `TarefaNaLista.pagamento` já existe e carrega a forma de pagamento do
   * atendimento — registrá-lo apagaria o bloco inteiro da tarefa para a
   * recepção sem `valores`. `mensalidade` já estava acima.
   */
  'pagamentoDaMensalidade',
  /**
   * G8 1E — prospecção (`prospeccao.ts` dos contratos). `valorEstimado` é o
   * "Valor estimado por mês" do lead (L2557) e `potencial` é a soma deles no
   * resumo das Oportunidades (L2477). Nenhum dos dois é receita (regra 4),
   * mas os dois são dinheiro na tela — gate de números, ajuste 14, e T-19.
   */
  'valorEstimado',
  'potencial',

  /**
   * G8 3B — Visão geral da carteira (P1). `mrr` é a "Receita recorrente
   * mensal" (Σ mensalidade de contrato dos ativos, gate de números ajuste
   * 11); o ticket médio viaja como `ticketMedio`, já registrado acima.
   */
  'mrr',

  /**
   * O faturamento lido do MedX (spec integracao-medx C.11, parecer A7). As
   * colunas de 0095 chegam à trilha (`GET /v1/auditoria`) pelo nome em
   * snake_case, que a redação normaliza. `quantidadeDePagamentos` também: a
   * contagem de pagamentos por dia não atravessa sem `valores` — e por isso a
   * coluna não se chama `quantidade`, que apagaria a de estoque.
   */
  'faturamentoLido',
  'faturamentoAnterior',
  'faturamentoExato',
  'quantidadeDePagamentos',
  'quantidadeDePagamentosAnterior',
  // T7 (C.8–C.11): os nomes que a API usa, fixados no parecer A7. `medido` é o
  // que a meta mede (FIR ou MedX); `recebido`, já acima, é sempre o da FIR.
  // `totalAntigo`/`totalNovo` ficam registrados para o histórico do MedX,
  // quando ele for exposto. `arredondamentoDoMedx` é o resíduo do A9.
  'faturamentoNoMedx',
  'recebidoNaFir',
  'diferencaMedxFir',
  'medido',
  'totalAntigo',
  'totalNovo',
  'totalExato',
  'arredondamentoDoMedx',

  /**
   * Indicadores & Insights (I-34, I-35; appsec C7). Todo valor de KPI em
   * reais viaja em `ValorNaTela.emDinheiro`, e SÓ nele: `valorNaTela` põe
   * `emNumero = null` em reais, então apagar este nome apaga o valor inteiro.
   *
   * **O que NÃO entra:** `emNumero` (contagens, percentuais, notas, horas),
   * `percentualDaMeta`, `escala` e a variação — são o que sobra para quem não
   * tem `valores`, e o residual de inferência está aceito na ADR de T1.
   */
  'emDinheiro',
  /**
   * T2 (I-35; números c.11d): o recebido dos dias que ainda não contam para a
   * meta, na Visão do mês, em `/v1/metas/:mes/percentual` e no KPI
   * `faturamento_conferido` de `/v1/indicadores`. Um total só, em centavos.
   * **Exige `finmes`, não só `valores`** (`CHAVE_DO_CAMPO` do interceptor;
   * ADR 2026-11-19-aguardando-em-reais-com-finmes): sem ela sai `null`, e
   * fica a contagem de dias, que não é dinheiro.
   */
  'aguardandoFechamento',
  /**
   * T8 (I-35; appsec C9): o valor da última compra no relatório 1, e a FAIXA DE
   * VALOR dos filtros. A faixa é dinheiro que a pessoa digitou e que fica
   * gravado no favorito: a lista de favoritos devolvida a quem não tem
   * `valores` sai com os dois `null`, e rodar o favorito dá 403 (I-40).
   */
  'valorDaUltimaCompra',
  'valorMinimo',
  'valorMaximo',
  /** T9: o relatório 4 — Σ do LTV das indicadas de cada indicadora. */
  'receitaDasIndicadas',
] as const

const NOMES_MONETARIOS = new Set<string>(CAMPOS_MONETARIOS)

/**
 * Se o campo (em camelCase) é dinheiro para a redação (regra 17).
 *
 * Além da lista, **todo nome terminado em `Centavos`**: é a convenção das
 * colunas de dinheiro no banco (`valor_centavos`, `alvo_centavos`,
 * `partida_centavos`…), e a trilha (`GET /v1/auditoria`) entrega NOME DE
 * COLUNA. Sem o sufixo, cada tabela nova com dinheiro precisava lembrar de
 * entrar na lista — e o T3/T4 esqueceu: o valor lançado num KPI e o alvo dos
 * KRs saíam inteiros na trilha para quem tem `config` sem `valores`
 * (revisão appsec T3/T4, B1, 2026-11-17).
 */
export function ehCampoMonetario(nomeEmCamelCase: string): boolean {
  return NOMES_MONETARIOS.has(nomeEmCamelCase) || nomeEmCamelCase.endsWith('Centavos')
}
