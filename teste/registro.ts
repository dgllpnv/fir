import { CAMPOS_MONETARIOS } from '@fir/domain'

/**
 * O registro que os testes transversais varrem.
 *
 * **Todo plano novo acrescenta aqui.** Uma lista mantida à mão fica
 * desatualizada no endpoint número quarenta — por isso os testes abaixo
 * verificam o registro contra o que a API de fato expõe, e falham quando
 * alguém acrescenta uma rota sem registrar.
 */
export type RotaRegistrada = {
  readonly metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly caminho: string
  /** Campos monetários que esta rota pode devolver. */
  readonly camposDeDinheiro: readonly string[]
  /**
   * A rota entrega campo de ESQUEMA ABERTO e por isso declara a lista inteira.
   *
   * Só `GET /v1/auditoria` é assim, e a marca existe porque a declaração dela
   * NEUTRALIZAVA a varredura: `redacao-de-valores.test.ts` monta o conjunto de
   * campos cobertos somando `camposDeDinheiro` de todas as rotas, e uma rota
   * que declara os quinze cobre qualquer campo de qualquer contrato — o teste
   * passava verde para um `saldo` que ninguém tinha registrado. Medido ao
   * acrescentar `PacienteNaLista` com `ltv` e `saldo`: a varredura não disse
   * nada.
   *
   * Rota marcada não entra na cobertura da varredura. Ela continua coberta em
   * tempo de execução pelo `RedacaoInterceptor` — que é a única camada que ela
   * jamais teve, já que `de`/`para` são `unknown` e não há `shape` onde descer.
   */
  readonly curinga?: boolean
}

/**
 * `GET /v1/auditoria` entra com a lista inteira porque é literalmente o que
 * ela pode devolver: `de`/`para` é o diff de qualquer coluna de qualquer
 * tabela auditada, e no dia em que `pessoas` ganhar `salario` a trilha o
 * devolve sem ninguém mexer nesta rota. Declará-la com um ou dois campos seria
 * mais preciso e menos verdadeiro — por isso a marca `curinga`.
 *
 * As rotas de paciente devolvem `ltv` e `saldo` por linha. TODA rota de
 * tarefa devolve `TarefaNaLista`, e `TarefaNaLista.pagamento` carrega `valor`
 * e `valorAberto` — o pagamento embutido é uma linha de `recebimentos`, e a
 * tarefa continua sem coluna de dinheiro. Cancelar e reabrir entram porque
 * devolvem a MESMA forma: reabrir, em particular, devolve a tarefa com
 * `pagamento: null` logo depois de estornar, e esquecê-la aqui deixaria a
 * varredura sem a rota que mais mexe em dinheiro.
 */
/**
 * Os três campos monetários que TODA rota de tarefa pode devolver.
 *
 * `valor` e `valorAberto` são do pagamento embutido — uma linha de
 * `recebimentos`, nunca uma coluna de `tarefas`. `valorOrcamento` é do épico
 * 3: ele NÃO é receita (regra 4), mas é dinheiro na tela e por isso é
 * redigido como qualquer outro.
 *
 * O MESMO `valorOrcamento` também viaja dentro de `historico[].valor` e de
 * `programaOrcado[].valor`, e é aí que o protótipo vaza: `saida()` apaga o
 * campo do topo, mas o valor do orçamento e o do fechamento atravessam dentro
 * do histórico, e só a TELA os esconde. Os dois caminhos profundos são
 * cobertos pelo nome `valor`, que esta lista já declara — e o teste
 * `orcamento.test.ts` prova que o `RedacaoInterceptor` de fato desce até lá.
 *
 * Uma constante, e não a lista repetida sete vezes: a sétima é a que esquece
 * o campo novo.
 */
const DINHEIRO_DA_TAREFA = ['valor', 'valorAberto', 'valorOrcamento'] as const

/**
 * Os dois nomes monetários da META DE PESSOA — ver a nota no fim da lista.
 *
 * Uma constante, e não a dupla repetida seis vezes: a sexta é a que esquece o
 * campo novo.
 */
const DINHEIRO_DA_META = ['metaEmDinheiro', 'realizadoEmDinheiro'] as const

/** Os três nomes monetários da CAMPANHA — ver a nota no fim da lista. */
const DINHEIRO_DA_CAMPANHA = ['metaEmDinheiro', 'resultadoEmDinheiro', 'receita'] as const

export const ROTAS_COM_DINHEIRO: readonly RotaRegistrada[] = [
  { metodo: 'GET', caminho: '/v1/auditoria', camposDeDinheiro: [...CAMPOS_MONETARIOS], curinga: true },
  // `credito` entrou com o épico 4: a lista e a ficha deixaram de calcular o
  // saldo com `greatest(0, …)` em SQL e passaram a consumir `saldoEmAberto`,
  // que preserva o excedente em vez de engoli-lo.
  { metodo: 'GET', caminho: '/v1/pacientes', camposDeDinheiro: ['ltv', 'saldo', 'credito'] },
  // A ficha devolve o Histórico como `TarefaNaLista` desde as correções da PO
  // (A2): o cartão da jornada, com o orçado e o pagamento embutido.
  {
    metodo: 'GET',
    caminho: '/v1/pacientes/:id',
    camposDeDinheiro: ['ltv', 'saldo', 'credito', ...DINHEIRO_DA_TAREFA],
  },
  { metodo: 'POST', caminho: '/v1/tarefas', camposDeDinheiro: DINHEIRO_DA_TAREFA },
  { metodo: 'POST', caminho: '/v1/tarefas/:id/concluir', camposDeDinheiro: DINHEIRO_DA_TAREFA },
  { metodo: 'POST', caminho: '/v1/tarefas/:id/cancelar', camposDeDinheiro: DINHEIRO_DA_TAREFA },
  { metodo: 'POST', caminho: '/v1/tarefas/:id/reabrir', camposDeDinheiro: DINHEIRO_DA_TAREFA },
  { metodo: 'POST', caminho: '/v1/tarefas/:id/jornada', camposDeDinheiro: DINHEIRO_DA_TAREFA },
  { metodo: 'PATCH', caminho: '/v1/tarefas/:id', camposDeDinheiro: DINHEIRO_DA_TAREFA },
  { metodo: 'GET', caminho: '/v1/tarefas', camposDeDinheiro: DINHEIRO_DA_TAREFA },
  /**
   * `GET /v1/hoje` devolve `TarefaNaLista` **e**, desde o épico 4, o bloco
   * financeiro com `ContaNaLista` — daí `valorPago`. `caixaPendente` é
   * booleano de propósito: um valor ali seria o esperado chegando pela porta
   * dos fundos, e `/v1/hoje` está em `ROTAS_DE_CONFERENCIA` por causa dele.
   */
  { metodo: 'GET', caminho: '/v1/hoje', camposDeDinheiro: [...DINHEIRO_DA_TAREFA, 'valorPago'] },
  /**
   * O funil devolve dinheiro em TRÊS profundidades diferentes, e as três
   * saem pelo mesmo nome: `valor` nos passos do funil e nas colunas,
   * `valorOrcamento` em cada mini-cartão. Nenhuma delas é `TarefaNaLista` —
   * é forma própria, e por isso a rota entra aqui por direito, não por
   * herança.
   */
  { metodo: 'GET', caminho: '/v1/jornada', camposDeDinheiro: ['valor', 'valorOrcamento'] },

  /**
   * O FINANCEIRO (épico 4) — **todas as rotas abaixo existem**.
   *
   * Durante as Tasks 1–7 onze destas linhas descreviam rotas que ainda não
   * existiam: os contratos já estavam escritos, e sem elas a varredura de
   * `redacao-de-valores` acusaria campo monetário descoberto. A dívida ficou
   * registrada — *"se as Tasks 8–11 mudarem de caminho, estas linhas mentem"*
   * — e as Tasks 8 a 11 a pagaram.
   *
   * O que fecha o ciclo é a varredura nova em `rotas-protegidas.test.ts`:
   * **toda rota registrada aqui precisa existir no `AppModule`**, com o mesmo
   * método e caminho. Promessa não cumprida reprova, e caminho escrito errado
   * também.
   */
  { metodo: 'POST', caminho: '/v1/recebimentos', camposDeDinheiro: ['valor', 'valorAberto'] },
  { metodo: 'GET', caminho: '/v1/recebimentos', camposDeDinheiro: ['valor', 'valorAberto'] },
  { metodo: 'DELETE', caminho: '/v1/recebimentos/:id', camposDeDinheiro: ['valor', 'valorAberto'] },
  {
    metodo: 'GET',
    caminho: '/v1/pacientes/:id/saldo',
    // `saldo` por grupo E no topo; `aberto`/`abatido` são os brutos do grupo;
    // `credito` é o excedente que o clamp por grupo preservou.
    camposDeDinheiro: ['saldo', 'aberto', 'abatido', 'credito'],
  },
  { metodo: 'GET', caminho: '/v1/cobrancas', camposDeDinheiro: ['saldo', 'aReceber'] },
  /**
   * `GET /v1/caixa` devolve `esperado`, `contado` e `diferenca` — **só depois
   * do fechamento**. Antes dele as chaves NÃO EXISTEM no corpo (regra 6), e é
   * `teste/transporte-as-cegas.test.ts` que prova isso. Esta entrada fala da
   * resposta do dia FECHADO; redação e cegueira são defesas diferentes.
   */
  {
    metodo: 'GET',
    caminho: '/v1/caixa',
    camposDeDinheiro: ['esperado', 'contado', 'diferenca', 'valor'],
  },
  {
    metodo: 'POST',
    caminho: '/v1/caixa',
    camposDeDinheiro: ['esperado', 'contado', 'diferenca', 'valor'],
  },
  /**
   * "Últimos fechamentos". Só `diferenca` — e ela só existe para dias já
   * FECHADOS, que é quando o número passa a ser legítimo. Quem não tem
   * `valores` recebe `conferido`, que é booleano e atravessa.
   */
  { metodo: 'GET', caminho: '/v1/caixa/ultimos', camposDeDinheiro: ['diferenca'] },
  { metodo: 'GET', caminho: '/v1/contas', camposDeDinheiro: ['valor', 'valorPago'] },
  { metodo: 'POST', caminho: '/v1/contas', camposDeDinheiro: ['valor', 'valorPago'] },
  { metodo: 'PATCH', caminho: '/v1/contas/:id', camposDeDinheiro: ['valor', 'valorPago'] },
  { metodo: 'DELETE', caminho: '/v1/contas/:id', camposDeDinheiro: ['valor', 'valorPago'] },
  { metodo: 'POST', caminho: '/v1/contas/:id/pagar', camposDeDinheiro: ['valor', 'valorPago'] },
  // Devolve a `ContaNaLista` já aberta (`valorPago: null`), mas o `valor` da conta
  // continua lá — e passa pela mesma redação.
  {
    metodo: 'POST',
    caminho: '/v1/contas/:id/desfazer-pagamento',
    camposDeDinheiro: ['valor', 'valorPago'],
  },
  {
    metodo: 'GET',
    caminho: '/v1/visao-do-mes',
    camposDeDinheiro: [
      'recebido',
      'despesasPagas',
      'resultadoDoMes',
      'aPagar',
      'aReceber',
      'meta',
      'metaRestante',
      'fixas',
      'variaveis',
      'valor',
      'diferenca',
    ],
  },
  { metodo: 'GET', caminho: '/v1/metas/:mes/percentual', camposDeDinheiro: ['meta', 'recebido'] },
  /**
   * `PUT`/`DELETE` da meta devolvem a MESMA forma do percentual — gravar e
   * reler pela mesma porta, para que a tela não precise de uma segunda
   * chamada só para saber em quanto a barra ficou.
   */
  { metodo: 'PUT', caminho: '/v1/metas/:mes', camposDeDinheiro: ['meta', 'recebido'] },
  { metodo: 'DELETE', caminho: '/v1/metas/:mes', camposDeDinheiro: ['meta', 'recebido'] },

  /**
   * OS PROGRAMAS (épico 5).
   *
   * O catálogo devolve `valorPorSessao` — PREÇO DE REFERÊNCIA, nunca receita
   * (regra 4), e mesmo assim redigido: é dinheiro na tela, e a enfermagem que
   * monta o programa não tem `valores`.
   *
   * `POST /v1/programas` devolve `itens[].valor` (o preço negociado de cada
   * item) sob o nome `valor`, que esta lista já cobre em qualquer profundidade.
   * `valorTotal` entra porque o corpo o traz e a forma de saída pode voltar a
   * trazê-lo na Task 11.
   */
  { metodo: 'GET', caminho: '/v1/procedimentos', camposDeDinheiro: ['valorPorSessao'] },
  { metodo: 'POST', caminho: '/v1/procedimentos', camposDeDinheiro: ['valorPorSessao'] },
  { metodo: 'PATCH', caminho: '/v1/procedimentos/:id', camposDeDinheiro: ['valorPorSessao'] },
  { metodo: 'DELETE', caminho: '/v1/procedimentos/:id', camposDeDinheiro: ['valorPorSessao'] },
  {
    metodo: 'POST',
    caminho: '/v1/programas',
    // `valorEntrada` e `valorTotal` são de ENTRADA (o corpo), e a varredura
    // não distingue entrada de saída — ela varre os esquemas. Declará-los
    // aqui é mais verdadeiro que afrouxar a varredura: se a Task 11 passar a
    // devolvê-los, a redação já os cobre.
    camposDeDinheiro: ['valor', 'valorTotal', 'valorEntrada'],
  },
  /**
   * A LEITURA DE PROGRAMAS (Task 11).
   *
   * `GET /v1/programas` devolve dinheiro em TRÊS profundidades: `saldoAReceber`
   * nos indicadores, `saldo` em cada sessão da agenda, e `saldo` em cada linha
   * da lista. As três saem por dois nomes, e os dois estão declarados.
   *
   * `GET /v1/programas/:id` acrescenta `recebido`, `valorTotal` e o
   * `itens[].valor` — este último sob o nome `valor`, que a lista já cobre em
   * qualquer profundidade.
   *
   * `temSaldo` NÃO entra: ele é booleano derivado, não é monetário, e é
   * exatamente o que a equipe sem `valores` recebe no lugar do número. Pô-lo
   * aqui apagaria o aviso que o MANUAL pede antes da sessão.
   */
  {
    metodo: 'GET',
    caminho: '/v1/programas',
    camposDeDinheiro: ['saldoAReceber', 'saldo', 'valor', 'valorOrcamento', 'valorAberto'],
  },
  {
    metodo: 'GET',
    caminho: '/v1/programas/:id',
    camposDeDinheiro: [
      'saldo',
      'recebido',
      'valorTotal',
      'valor',
      'valorOrcamento',
      'valorAberto',
    ],
  },
  /**
   * AS SESSÕES (Task 9). As duas devolvem `TarefaNaLista` — a mesma forma da
   * rota genérica de tarefa —, então herdam `DINHEIRO_DA_TAREFA` por direito.
   *
   * `concluir` ACEITA `pagamento` no corpo e `reabrir` ESTORNA: as duas
   * devolvem a tarefa com o pagamento embutido (ou `null`, depois do estorno),
   * e é por isso que nenhuma das duas pode ficar de fora. Reabrir é, das duas,
   * a que mais mexe em dinheiro.
   */
  {
    metodo: 'POST',
    caminho: '/v1/programas/sessoes/:id/concluir',
    camposDeDinheiro: DINHEIRO_DA_TAREFA,
  },
  {
    metodo: 'POST',
    caminho: '/v1/programas/sessoes/:id/reabrir',
    camposDeDinheiro: DINHEIRO_DA_TAREFA,
  },

  /**
   * O ESTOQUE (épico 6).
   *
   * **Um nome monetário só, e ele é `custo`** — o preço unitário do item, por
   * `medida`, em centavos. Ele aparece em DOIS lugares: no cadastro do item e
   * no movimento de ENTRADA (o que se pagou naquela compra).
   *
   * **`minimo` e a QUANTIDADE não entram, e a distinção custou um defeito.**
   * Eles são quantidade, não dinheiro: a enfermagem sem `valores` precisa ver
   * que sobraram duas ampolas, e esconder isso é esconder a dose, não o preço.
   *
   * **O campo da quantidade nasceu chamado `saldo`, e isso era um defeito.**
   * `saldo` está em `CAMPOS_MONETARIOS` por causa do saldo em aberto da
   * paciente, e o `RedacaoInterceptor` casa **nome de chave** em qualquer
   * profundidade, sem olhar o tipo do valor — então a quantidade era apagada
   * para quem não tem `valores`, e a tela do estoque da enfermagem mostrava o
   * catálogo inteiro sem número nenhum. O campo virou `saldoEmEstoque`, que a
   * redação não casa (ela compara nome exato, não prefixo, de propósito), e
   * `estoque.e2e.test.ts` mede exatamente isto.
   *
   * **Nenhuma varredura pegaria.** `redacao-de-valores` cobra que todo campo
   * MONETÁRIO tenha rota registrada; não há varredura que cobre o inverso —
   * um campo não-monetário batizado como um. É o mesmo caso que
   * `CAMPOS_MONETARIOS` já registra para `resultado` → `resultadoDoMes`.
   */
  { metodo: 'GET', caminho: '/v1/estoque', camposDeDinheiro: ['custo'] },
  { metodo: 'POST', caminho: '/v1/estoque', camposDeDinheiro: ['custo'] },
  { metodo: 'PATCH', caminho: '/v1/estoque/:id', camposDeDinheiro: ['custo'] },
  { metodo: 'DELETE', caminho: '/v1/estoque/:id', camposDeDinheiro: ['custo'] },
  { metodo: 'GET', caminho: '/v1/estoque/movimentos', camposDeDinheiro: ['custo'] },
  { metodo: 'POST', caminho: '/v1/estoque/movimentos', camposDeDinheiro: ['custo'] },
  /**
   * A IMPORTAÇÃO aceita `custo` por linha e devolve só CONTAGENS. Ela entra
   * aqui pelo lado da ENTRADA — a varredura varre os esquemas e não distingue
   * entrada de saída —, e declará-la é mais verdadeiro que afrouxar a
   * varredura: no dia em que o resultado trouxer o custo importado, a redação
   * já o cobre.
   */
  { metodo: 'POST', caminho: '/v1/estoque/importar', camposDeDinheiro: ['custo'] },
  // A segunda fatia do épico 6. `valorDaFalta` é o que a diferença da contagem
  // VALE ao custo cadastrado; ele viaja ao lado de `itensComFalta`, que não é
  // dinheiro e é o indicador que a equipe sem `valores` lê.
  //
  // `POST /v1/estoque/:id/codigo` devolve `ItemNaLista`, com `custo` — a mesma
  // forma das outras rotas de item.
  { metodo: 'POST', caminho: '/v1/estoque/:id/codigo', camposDeDinheiro: ['custo'] },
  { metodo: 'GET', caminho: '/v1/estoque/contagens/:id', camposDeDinheiro: ['valorDaFalta'] },
  { metodo: 'POST', caminho: '/v1/estoque/contagens', camposDeDinheiro: ['valorDaFalta'] },
  { metodo: 'PUT', caminho: '/v1/estoque/contagens/:id', camposDeDinheiro: ['valorDaFalta'] },
  { metodo: 'GET', caminho: '/v1/estoque/analise', camposDeDinheiro: ['valorDaFalta'] },
  // `valorUnitario` é o `vUnCom` da NF-e, por unidade da nota. A leitura do XML
  // acontece no SERVIDOR justamente para que ele atravesse redigido — lido no
  // navegador, chegaria inteiro a quem não tem `valores`.
  { metodo: 'POST', caminho: '/v1/estoque/notas/ler', camposDeDinheiro: ['valorUnitario'] },
  {
    metodo: 'POST',
    caminho: '/v1/estoque/notas',
    camposDeDinheiro: ['custo', 'custoDaNota'],
  },
  /** Locais não têm dinheiro, e por isso NÃO estão aqui. */

  /**
   * A EQUIPE (épico 7, primeira metade) — e **só a ficha ABERTA tem dinheiro**.
   *
   * `salario` é o único campo monetário do módulo, e ele é o único de
   * `CAMPOS_MONETARIOS` cuja chave de permissão **não** é `valores`:
   * `CHAVE_DO_CAMPO` o mapeia para `pessoas.gerir`, porque dado de RH não se
   * libera junto com receita.
   *
   * **`GET /v1/fichas` NÃO está aqui, e é desenho.** A lista não carrega
   * `salario`: a visão geral mostra quem a pessoa é e quantos alertas ela tem.
   * É isso que permite marcar só a ficha aberta com `@DadoSensivel` e deixar a
   * trilha respondendo *"quem abriu o salário dela"* em vez de *"quem abriu a
   * Equipe"*.
   *
   * **O que NÃO entra em `CAMPOS_MONETARIOS`, e é o ponto:**
   * `saldoEmMinutos`, `limiteDeHorasEmMinutos`, `diasConcedidos`,
   * `diasRestantes`, `dias`, `diasParaVencer`, `mesesDeCasa`. Nenhum é
   * dinheiro, e dois deles quase colidiram: `saldo` e `diferenca` já estão na
   * lista por causa do caixa e do saldo da paciente, então um campo chamado
   * `saldo` apagaria o banco de horas inteiro para quem não tem `valores` — o
   * mesmo defeito que `saldo` → `saldoEmEstoque` registrou no épico 6.
   */
  { metodo: 'GET', caminho: '/v1/fichas/:id', camposDeDinheiro: ['salario'] },
  { metodo: 'POST', caminho: '/v1/fichas', camposDeDinheiro: ['salario'] },
  { metodo: 'PUT', caminho: '/v1/fichas/:id', camposDeDinheiro: ['salario'] },
  /**
   * As quatro rotas de férias e documento devolvem `FichaCompleta` — gravar e
   * reler pela mesma porta, para que a tela não precise de uma segunda
   * chamada só para saber em que estado os períodos aquisitivos ficaram. E
   * `FichaCompleta` tem `salario`, então nenhuma delas pode ficar de fora.
   */
  { metodo: 'POST', caminho: '/v1/fichas/:id/ferias', camposDeDinheiro: ['salario'] },
  { metodo: 'DELETE', caminho: '/v1/fichas/:id/ferias/:feriasId', camposDeDinheiro: ['salario'] },
  { metodo: 'POST', caminho: '/v1/fichas/:id/documentos', camposDeDinheiro: ['salario'] },
  { metodo: 'DELETE', caminho: '/v1/fichas/:id/documentos/:docId', camposDeDinheiro: ['salario'] },

  /**
   * AS METAS DA PESSOA (épico 7, segunda fatia).
   *
   * **Um campo monetário só, em dois nomes:** `metaEmDinheiro` e
   * `realizadoEmDinheiro`, preenchidos exclusivamente no indicador
   * `orc_valor` (centavos, regra 1). Toda rota daqui devolve `MetaDePessoa`,
   * então nenhuma pode ficar de fora — inclusive as de ESCRITA, que gravam e
   * releem pela mesma porta para que a tela não precise de uma segunda
   * chamada só para saber em quanto a barra ficou.
   *
   * **O que NÃO entra, e é o desenho inteiro:** `metaEmNumero`,
   * `realizadoEmNumero`, `percentual` e `mediaDeAtingimento`. Nenhum é
   * dinheiro, e registrá-los faria a recepcionista sem `valores` abrir "Minhas
   * metas" e ler `— de —` — esconder o trabalho dela em vez do preço de
   * alguma coisa. `percentual` é justamente o que sobra para quem não vê
   * valor, e "84% da meta" não revela quanto é a meta.
   *
   * **`GET /v1/minhas-metas/:mes` está aqui por direito:** ela devolve
   * `MetaDePessoa` inteira, e a pessoa pode ter uma meta de `orc_valor`. Ela é
   * a rota sem `@Exige` do produto todo — e é por isso que a redação ser um
   * ponto único, e não um `if` por endpoint, é o que a torna segura.
   *
   * **O prefixo é `/v1/metas-de-pessoa`, e não `/v1/metas`.** `/v1/metas/:mes`
   * já é a meta de FATURAMENTO (`PUT`/`DELETE` acima): o mesmo caminho
   * significando a receita da clínica num verbo e as metas da equipe em outro
   * é a ambiguidade de `plano` que `CONTEXT.md` abre proibindo.
   */
  { metodo: 'GET', caminho: '/v1/metas-de-pessoa/:mes', camposDeDinheiro: DINHEIRO_DA_META },
  { metodo: 'POST', caminho: '/v1/metas-de-pessoa/:mes', camposDeDinheiro: DINHEIRO_DA_META },
  { metodo: 'POST', caminho: '/v1/metas-de-pessoa/:mes/copiar', camposDeDinheiro: DINHEIRO_DA_META },
  {
    metodo: 'PUT',
    caminho: '/v1/metas-de-pessoa/:mes/:id/realizado',
    camposDeDinheiro: DINHEIRO_DA_META,
  },
  { metodo: 'DELETE', caminho: '/v1/metas-de-pessoa/:mes/:id', camposDeDinheiro: DINHEIRO_DA_META },
  { metodo: 'GET', caminho: '/v1/minhas-metas/:mes', camposDeDinheiro: DINHEIRO_DA_META },

  /**
   * AS CAMPANHAS (épico 8).
   *
   * **Três nomes monetários, e a lógica é a mesma das metas de pessoa:**
   * `metaEmDinheiro` e `resultadoEmDinheiro` só existem na métrica `receita`;
   * `receita` existe SEMPRE, porque a tela mostra quanto a campanha gerou
   * mesmo quando a meta é de contatos.
   *
   * **O que NÃO entra, e é o desenho:** `metaEmNumero`, `resultadoEmNumero`,
   * `percentualDaMeta` e `taxaDeConversao`. A recepção tem `campanhas` e NÃO
   * tem `valores` — é literalmente o perfil padrão dela —, e apagar "38 de 40
   * contatos" seria esconder o trabalho em vez do preço. `percentualDaMeta` é
   * o que sobra para ela, e ele não revela a meta.
   *
   * As quatro rotas devolvem a MESMA forma (`Campanhas`): gravar e reler pela
   * mesma porta, para que a tela não precise de uma segunda chamada só para
   * saber em quanto a barra ficou. `importar` é a exceção — ela devolve só
   * contagens, e nenhuma delas é dinheiro.
   */
  { metodo: 'GET', caminho: '/v1/campanhas', camposDeDinheiro: DINHEIRO_DA_CAMPANHA },
  { metodo: 'POST', caminho: '/v1/campanhas', camposDeDinheiro: DINHEIRO_DA_CAMPANHA },
  { metodo: 'PUT', caminho: '/v1/campanhas/:id', camposDeDinheiro: DINHEIRO_DA_CAMPANHA },
  { metodo: 'DELETE', caminho: '/v1/campanhas/:id', camposDeDinheiro: DINHEIRO_DA_CAMPANHA },

  /**
   * O PAINEL GERAL da clínica (épico 8).
   *
   * `painel` → `valores` na matriz, então quem abre a tela sempre vê dinheiro
   * — e mesmo assim os campos passam pela redação. A dependência entre chaves
   * vive na TABELA (regra 16); registrá-los aqui é o que garante que mudá-la
   * amanhã não vire vazamento hoje.
   *
   * **`ticketMedio` é campo monetário por direito**, e ele é o único derivado
   * de uma DIVISÃO: `receita ÷ pagamentos`, pelo `Dinheiro.media` (regra 1).
   */
  {
    metodo: 'GET',
    caminho: '/v1/painel',
    camposDeDinheiro: [
      'receita',
      'ticketMedio',
      'valorDosOrcamentosPagos',
      'valor',
      // A segunda fatia do épico 8 — os quatro blocos do MANUAL cap. 10.
      //
      // `valor` (acima) é o do Top 10 pagantes; `faturamento` e `ltvMedio`
      // são da tabela por unidade; `ltvTotal` é a soma do LTV das pacientes
      // novas de uma origem.
      //
      // `metaEmDinheiro` e `resultadoEmDinheiro` chegam dentro de
      // `CampanhaNaLista`: o bloco "Campanhas no período" devolve a MESMA
      // forma de `GET /v1/campanhas`, e as sete contagens da campanha são uma
      // regra só, no `CampanhasService`. Declará-los aqui é dizer a verdade
      // sobre o que ESTA rota entrega — a cobertura de `redacao-de-valores`
      // já viria das rotas de campanha, e é justamente por isso que a
      // omissão passaria em silêncio.
      'faturamento',
      'ltvMedio',
      'ltvTotal',
      'metaEmDinheiro',
      'resultadoEmDinheiro',
    ],
  },

  /**
   * G3 — A CARTEIRA COMERCIAL: indicadores, metas comerciais e a cobrança do
   * Cliente Firmare (ADR 0015).
   *
   * Hoje nenhum `Usuário de Gestão` tem a chave `valores` — a carteira ainda
   * não tem perfil de permissão granular (só `escopo`, ADR 0012) — e o
   * `RedacaoInterceptor` falha FECHADO quando `req.contexto` não existe
   * (rotas de carteira populam `req.carteira`, nunca `req.contexto`). Isso
   * apaga os quatro campos abaixo para TODO `Usuário de Gestão`, sempre, até
   * que a carteira ganhe sua própria chave `valores` — registrado aqui porque
   * é exatamente essa promessa que `redacao-de-valores.test.ts` cobra.
   *
   * `valor` (do `Lançamento de indicador` `unidade="R$"`) já está coberto por
   * `DINHEIRO_DA_TAREFA` e outras entradas acima — não precisa de nome novo.
   */
  {
    metodo: 'GET',
    caminho: '/v1/carteira/indicadores/:id/lancamentos',
    camposDeDinheiro: ['valor'],
  },
  {
    metodo: 'POST',
    caminho: '/v1/carteira/indicadores/:id/lancamentos',
    camposDeDinheiro: ['valor'],
  },
  {
    metodo: 'GET',
    caminho: '/v1/carteira/metas',
    camposDeDinheiro: ['valorMeta', 'valorInicial', 'valor'],
  },
  {
    metodo: 'POST',
    caminho: '/v1/carteira/metas',
    camposDeDinheiro: ['valorMeta', 'valorInicial', 'valor'],
  },
  /**
   * G8 2B — metas completas (M1–M4), indicadores manuais (V10). Todo número
   * absoluto de meta/indicador em R$ mora em `valor` (atual, cada semana,
   * cada ponto da série), `valorMeta` (alvo; meta semanal do indicador) ou
   * `valorInicial` — nomes já registrados (appsec caso 12: nunca `atual`/
   * `alvo` genéricos, que escapariam da redação por nome).
   */
  { metodo: 'GET', caminho: '/v1/carteira/metas/painel', camposDeDinheiro: ['valorMeta', 'valorInicial', 'valor'] },
  { metodo: 'GET', caminho: '/v1/carteira/clientes/:id/metas', camposDeDinheiro: ['valorMeta', 'valorInicial', 'valor'] },
  { metodo: 'POST', caminho: '/v1/carteira/clientes/:id/metas', camposDeDinheiro: ['valorMeta', 'valorInicial', 'valor'] },
  { metodo: 'PATCH', caminho: '/v1/carteira/clientes/:id/metas/:metaId', camposDeDinheiro: ['valorMeta', 'valorInicial', 'valor'] },
  { metodo: 'GET', caminho: '/v1/carteira/clientes/:id/indicadores', camposDeDinheiro: ['valorMeta', 'valor'] },
  { metodo: 'POST', caminho: '/v1/carteira/clientes/:id/indicadores', camposDeDinheiro: ['valorMeta', 'valor'] },
  {
    metodo: 'GET',
    caminho: '/v1/carteira/cobrancas',
    camposDeDinheiro: ['mensalidade', 'desconto', 'valor', 'somaValor'],
  },
  {
    metodo: 'POST',
    caminho: '/v1/carteira/cobrancas/:id/marcar-pago',
    camposDeDinheiro: ['mensalidade', 'desconto', 'valor'],
  },
  /**
   * "Desfazer" (critério 2.2.9 do spec G3) — mesma forma de `marcar-pago`:
   * devolve a MESMA `CobrancaCarteiraNaLista`, logo os mesmos três campos.
   */
  {
    metodo: 'POST',
    caminho: '/v1/carteira/cobrancas/:id/desfazer-pago',
    camposDeDinheiro: ['mensalidade', 'desconto', 'valor'],
  },
  /**
   * G8 1F — o painel de Mensalidades do mês: cada linha é uma
   * `CobrancaCarteiraNaLista` (mensalidade, desconto, valor), os totais do
   * mês (somaValor, recebido, aReceber), `valor` por situação e a receita
   * recorrente com o ticket médio.
   */
  {
    metodo: 'GET',
    caminho: '/v1/carteira/cobrancas/painel',
    camposDeDinheiro: ['mensalidade', 'desconto', 'valor', 'somaValor', 'recebido', 'aReceber', 'receita', 'ticketMedio'],
  },
  /** G8 1F — "baixar pagos": devolve as mesmas `CobrancaCarteiraNaLista`. */
  {
    metodo: 'POST',
    caminho: '/v1/carteira/cobrancas/baixar-pagos',
    camposDeDinheiro: ['mensalidade', 'desconto', 'valor'],
  },
  /**
   * G8 0.4 — o CADASTRO do `Cliente Firmare` (`CadastroDoClienteNaSaida`).
   * `pagamentoDaMensalidade` é o objeto da seção Pagamento (dia do
   * vencimento e WhatsApp de cobrança), registrado INTEIRO para sair `null`
   * de uma vez (appsec A-2, LGPD A30). As três rotas devolvem a mesma forma.
   */
  {
    metodo: 'GET',
    caminho: '/v1/carteira/clientes/:id',
    camposDeDinheiro: ['mensalidade', 'pagamentoDaMensalidade'],
  },
  {
    metodo: 'PATCH',
    caminho: '/v1/carteira/clientes/:id',
    camposDeDinheiro: ['mensalidade', 'pagamentoDaMensalidade'],
  },
  {
    metodo: 'POST',
    caminho: '/v1/carteira/clientes',
    camposDeDinheiro: ['mensalidade', 'pagamentoDaMensalidade'],
  },
  /** O lado do Operador: a lista por grupo e a edição (`ClienteCarteiraNoPainel`). */
  {
    metodo: 'GET',
    caminho: '/v1/superadmin/clientes-carteira',
    camposDeDinheiro: ['mensalidade'],
  },
  {
    metodo: 'PATCH',
    caminho: '/v1/superadmin/clientes-carteira/:id',
    camposDeDinheiro: ['mensalidade'],
  },
  /**
   * G8 1C — campanhas da carteira (K1, V9, K3). `retornoSobreInvestimento` é
   * texto ("3,2x"), mas é redigido: `retorno × investimento` devolve a receita.
   */
  {
    metodo: 'GET',
    caminho: '/v1/carteira/campanhas',
    camposDeDinheiro: ['valorGerado', 'investimento', 'retornoSobreInvestimento', 'resultadoEmDinheiro'],
  },
  {
    metodo: 'GET',
    caminho: '/v1/carteira/clientes/:id/campanhas',
    camposDeDinheiro: ['receita', 'investimento', 'retornoSobreInvestimento', 'resultadoEmDinheiro', 'metaEmDinheiro', 'valorGerado'],
  },
  {
    metodo: 'POST',
    caminho: '/v1/carteira/campanhas',
    camposDeDinheiro: ['receita', 'investimento', 'retornoSobreInvestimento', 'resultadoEmDinheiro', 'metaEmDinheiro'],
  },
  {
    metodo: 'PATCH',
    caminho: '/v1/carteira/campanhas/:id',
    camposDeDinheiro: ['receita', 'investimento', 'retornoSobreInvestimento', 'resultadoEmDinheiro', 'metaEmDinheiro'],
  },
  /** Ticket 4A: as métricas da planilha em R$ (faturamento, recebido, despesas) saem em `valor` (centavos). */
  { metodo: 'GET', caminho: '/v1/carteira/clientes/:id/planilha', camposDeDinheiro: ['valor'] },
  /**
   * `POST /v1/carteira/beneficios` cria um `Benefício de indicação`
   * (`BeneficioDeIndicacaoNaLista`): `percentualCentesimos` NÃO é dinheiro —
   * é percentual, mesma classe de `minimo`/quantidade de estoque (regra do
   * comentário do épico 6, acima) — e a resposta não tem campo monetário
   * nenhum. Sem entrada de `camposDeDinheiro` por isso; a rota ainda existe
   * de verdade, e `rotas-protegidas.test.ts` confere pela varredura do
   * `AppModule`, não por este registro.
   */

  /**
   * G6 — O PORTAL DO GRUPO (ADRs 0017, 0018).
   *
   * `GET /v1/portal/clientes` é a única rota que de fato lê dinheiro: devolve
   * `MetaComercialNaLista` (`valorMeta`/`valorInicial`/`valor` do lançamento),
   * `CobrancaCarteiraNaLista` (`mensalidade`/`desconto`/`valor`) e
   * `CampanhaNoPortal` (`resultadoEmDinheiro`) — as TRÊS formas já registradas
   * acima para `/v1/carteira/...`, agora atravessando para um QUARTO ator.
   *
   * Diferente da carteira (nota acima, "hoje nenhum Usuário de Gestão tem a
   * chave valores"), o `Usuário do portal` SEMPRE vê estes campos — ADR 0017
   * §3, confirmada pela ADR 0018: ele é o titular do próprio dinheiro, não um
   * colega de quem esconder salário. `RedacaoInterceptor` usa `req.portal`
   * como segunda fonte de `pode` (sempre `true`) precisamente por isto.
   */
  {
    metodo: 'GET',
    caminho: '/v1/portal/clientes',
    camposDeDinheiro: ['valorMeta', 'valorInicial', 'valor', 'mensalidade', 'desconto', 'resultadoEmDinheiro'],
  },

  /**
   * G8 1E — prospecção. TODA rota que devolve `LeadComercialNaLista` carrega
   * `valorEstimado` (o "Valor estimado por mês", L2557), e a lista carrega
   * também `potencial` (a soma, L2477). Nenhum dos dois é receita (regra 4),
   * e os dois saem `null` sem `valores` — provado contra o interceptor real
   * em `leads-prospeccao-completa.e2e.test.ts`. As rotas de benefício e de
   * indicações não têm R$: `percentualCentesimos` é percentual.
   */
  ...(
    [
      ['GET', '/v1/carteira/leads', ['valorEstimado', 'potencial']],
      ['GET', '/v1/carteira/leads/:id', ['valorEstimado']],
      ['POST', '/v1/carteira/leads', ['valorEstimado']],
      ['PATCH', '/v1/carteira/leads/:id', ['valorEstimado']],
      ['POST', '/v1/carteira/leads/:id/etapa', ['valorEstimado']],
      ['POST', '/v1/carteira/leads/:id/perder', ['valorEstimado']],
      ['POST', '/v1/carteira/leads/:id/contato', ['valorEstimado']],
      ['POST', '/v1/carteira/leads/:id/arquivar', ['valorEstimado']],
      ['POST', '/v1/carteira/leads/:id/excluir-a-pedido', ['valorEstimado']],
    ] as const
  ).map(([metodo, caminho, camposDeDinheiro]) => ({ metodo, caminho, camposDeDinheiro })),

  /**
   * G8 3B — Visão geral da carteira. `mrr` e `ticketMedio` (P1) e, dentro
   * dos contatos recomendados (P9), o `valorEstimado` de cada
   * `LeadComercialNaLista`. Provado `null` sem `valores` contra o interceptor
   * real em `visao-geral.e2e.test.ts`.
   */
  { metodo: 'GET', caminho: '/v1/carteira/painel', camposDeDinheiro: ['mrr', 'ticketMedio', 'valorEstimado'] },
]

/**
 * Tabelas de negócio com `clinica_id`. O teste de isolamento varre todas.
 *
 * `auditoria` entra aqui como qualquer outra: a trilha de uma clínica é dado
 * DELA, e uma trilha legível entre clínicas entregaria num só `SELECT` tudo o
 * que a RLS protege em todas as demais tabelas.
 */
export const ENTIDADES_COM_CLINICA: readonly string[] = [
  // A agenda do sistema da clínica (0037, ADR 0019): o link e o vínculo
  // `uid → tarefa`. Sem DELETE para a aplicação.
  'agendas_externas',
  'auditoria',
  // O épico 7, primeira metade (0018): a ficha de RH e os três filhos dela.
  // `banco_de_horas` é a única MUTÁVEL do grupo — ela é transcrição do app de
  // ponto, não livro-razão, e a correção de um saldo digitado errado fica na
  // trilha pelo trigger. As outras três são soft delete.
  'banco_de_horas',
  'caixa_por_forma',
  'caixas_do_dia',
  'cobrancas',
  'compromissos_externos',
  'configuracao_de_pessoal',
  'configuracao_financeira',
  // O épico 6, segunda fatia (0017): a contagem às cegas e a nota de entrada.
  // `contado_na_contagem` é a ÚNICA tabela mutável do módulo — ela é o rascunho
  // de quem está com a prancheta na mão, e "Salvar e continuar depois" é o
  // MANUAL. O livro-razão continua sendo `movimentos_de_estoque`, append-only.
  'contado_na_contagem',
  // O épico 7, segunda fatia (0019): metas da pessoa e conversas 1:1.
  // As duas são MUTÁVEIS: a meta do mês se ajusta enquanto o mês corre, e a
  // anotação de uma 1:1 se corrige — travá-las como livro-razão obrigaria a
  // clínica a criar linha nova para arrumar um número digitado errado, e a
  // trilha já guarda de → para.
  // O épico 8 (0020): as campanhas. MUTÁVEL (a gestora ajusta a meta e as
  // datas enquanto a campanha corre) e com soft delete — e, ao contrário do
  // protótipo, excluir NÃO limpa o `campanha_id` das tarefas: o trabalho feito
  // mantém a atribuição, e o painel do trimestre passado não muda sozinho.
  'campanhas',
  'conversas_1a1',
  'metas_de_pessoa',
  'contagens_de_estoque',
  'contas_a_pagar',
  'documentos_da_pessoa',
  'ferias_da_pessoa',
  'fichas_de_pessoa',
  // A carteira comercial da Firmare (0025, G1a — ADRs 0011/0012). APPEND-ONLY
  // (como `auditoria`): mudar de grupo de novo é linha nova, nunca UPDATE na
  // antiga. `fir_app` não tem privilégio nenhum aqui (é tabela de
  // `fir_carteira`) — a RLS entra mesmo assim, defesa em profundidade.
  'historico_grupo_da_clinica',
  // O épico 5 (0010): o catálogo, o programa e os dois filhos deles.
  'insumos_do_procedimento',
  // O épico 6 (0015): o estoque. `movimentos_de_estoque` é APPEND-ONLY, e por
  // isso `fir_app` tem só SELECT e INSERT nela — mas a proteção por clínica é
  // a policy, exatamente como em qualquer outra tabela desta lista.
  'itens_da_contagem',
  'itens_de_estoque',
  'itens_do_programa',
  'locais_de_estoque',
  'metas_do_mes',
  'movimentos_de_estoque',
  'motivos_de_perda',
  'notas_de_entrada',
  // O épico 9 (0021): a chave de idempotência da migração da v20. Ela tem
  // `clinica_id` e por isso entra na convenção inteira — RLS, FORCE, policy e
  // trigger — mesmo não sendo lida por rota nenhuma. É exatamente a tabela que
  // uma lista mantida à mão esqueceria: ninguém a vê na tela.
  'origens_da_v20',
  // Desfazer pagamento de conta (0040). APPEND-ONLY como `movimentos_de_estoque`:
  // `fir_app` só lê e insere, e a trigger recusa UPDATE/DELETE até do dono.
  'pagamentos_de_conta_desfeitos',
  'pacientes',
  'procedimentos',
  'programas',
  'perfis',
  'pessoas',
  'recebimentos',
  'sessoes',
  'tarefas',
  'tentativas_login',
  'unidades',
  'vinculos_de_nota',
]

/**
 * Tabelas com `clinica_id` cuja RLS é por `grupo_id`, não por `clinica_id`
 * (ADR 0012) — a carteira comercial da Firmare. `clinica_id` aqui é só a
 * ligação com a `Clinica` real; quem rege o acesso é `app_pode_ver_grupo()`.
 *
 * Lista separada de `ENTIDADES_COM_CLINICA` de propósito: aquela exige que
 * toda policy registrada contenha `app_clinica_id` e não tenha `OR` — exigir
 * o mesmo aqui reprovaria toda tabela desta lista, que é exatamente o padrão
 * novo que a carteira introduz. `teste/isolamento-de-clinica.test.ts` varre
 * as duas listas juntas para "toda tabela com clinica_id" e "RLS
 * habilitada/forçada", e só a de `ENTIDADES_COM_CLINICA` para o exame do
 * texto da policy — esta lista tem o exame equivalente, trocando
 * `app_clinica_id` por `app_pode_ver_grupo`.
 */
export const ENTIDADES_COM_CLINICA_POR_GRUPO: readonly string[] = ['clientes_carteira', 'participacao_clinica_grupo']

/**
 * G5 (migration 0032, ADR 0016): tabelas da carteira cuja RLS também é por
 * `app_pode_ver_grupo(grupo_id)`, mas que NÃO têm `clinica_id` nenhum — nem
 * nullable, nem `NOT NULL`. `leads_comerciais` é prospecção B2B, sem clínica
 * associada na imensa maioria dos casos; as outras quatro são rotina interna
 * da equipe Firmare, nunca dado de uma clínica específica.
 *
 * Lista PRÓPRIA, separada de `ENTIDADES_COM_CLINICA_POR_GRUPO`: aquela é
 * descoberta pela varredura de `isolamento-de-clinica.test.ts` a partir da
 * coluna `clinica_id` no catálogo — uma tabela sem essa coluna NUNCA
 * apareceria lá, e colocá-la na mesma lista quebraria a igualdade exata que
 * aquele teste exige entre "tabelas com `clinica_id`" e o registro. Esta
 * lista é examinada por um `it` PRÓPRIO (mesmo exame de RLS/policy, sem a
 * amarração à coluna) e pela trilha de auditoria dedicada (ADR 0016, item 4:
 * `auditoria-inescapavel.test.ts` não alcança tabela sem `clinica_id`
 * sozinha, porque ela varre exatamente por essa coluna).
 */
export const ENTIDADES_DA_CARTEIRA_SEM_CLINICA: readonly string[] = [
  'leads_comerciais',
  'interacoes_do_lead',
  'rotinas_internas',
  'tarefas_internas',
  'checkins_internos',
  // G8 1B (migration 0048): só policy por grupo, com trigger de auditoria.
  // As três tabelas antigas de conteúdo (reunioes_comerciais,
  // documentos_carteira, materiais_carteira) NÃO entram aqui: cada uma tem
  // também a policy TO fir_portal, que não é por app_pode_ver_grupo — elas são
  // cobertas por teste/portal-no-banco.test.ts.
  'encaminhamentos_de_reuniao',
  'compartilhamentos_revertidos',
  'envios_de_material',
  // G8 0.4 (0047): o parceiro de cada frente do cliente — dado de TERCEIRO
  // (LGPD A29). RLS por grupo `TO fir_carteira`, sem policy nem GRANT para o
  // portal; trilha pelo `registrar_auditoria_do_painel`, como as de G5.
  'parceiros_do_cliente',
  // G8 2C (0053): o checklist aplicado ao cliente e a entrada de quem já era
  // cliente. RLS por grupo `TO fir_carteira`, trilha pelo trigger.
  'checklist_do_cliente',
  'entradas_de_cliente_existente',
  // G8 3A (0054): o FATO do envio de mensagem (sem o texto, LGPD A36). RLS
  // por grupo `TO fir_carteira`, append-only, trigger do painel.
  'envios_de_mensagem',
  // G8 2B (0052): a `Ação do plano`. RLS por grupo `TO fir_carteira`, sem
  // portal, trilha pelo `registrar_auditoria_do_painel`.
  'acoes_do_plano',
  // G8 2A (0051): o subitem da tarefa interna (cliente da lista, frente do
  // relatório). `grupo_id` derivado da tarefa por trigger; RLS por grupo
  // `TO fir_carteira`, trilha pelo `registrar_auditoria_do_painel`.
  'itens_de_tarefa_interna',
]

/**
 * G3 (migration 0031, ADRs 0011/0012/0013/0015): as seis tabelas do
 * financeiro da carteira — `indicadores_carteira`, `lancamentos_de_indicador`,
 * `metas_comerciais`, `beneficios_de_indicacao`, `cobrancas_do_cliente_firmare`
 * e `auditoria_da_carteira`. Mesma classificação de
 * `ENTIDADES_DA_CARTEIRA_SEM_CLINICA` (SEM `clinica_id` nenhum, RLS por
 * `app_pode_ver_grupo(grupo_id)`) — achado 1 da revisão de código: nenhuma
 * das seis estava nesta varredura, então a RLS delas nunca foi examinada por
 * `isolamento-de-clinica.test.ts`, e a trilha delas nunca foi examinada por
 * `auditoria-inescapavel.test.ts`.
 *
 * **Lista PRÓPRIA, não a mesma de G5**, porque a trilha é DIFERENTE: as cinco
 * primeiras são auditadas por CÓDIGO DA APLICAÇÃO (`gravarAuditoriaDaCarteira`,
 * `auditoria-da-carteira.ts`), nunca pelo trigger `registrar_auditoria_do_painel`
 * que `ENTIDADES_DA_CARTEIRA_SEM_CLINICA` exige — porque `app.pessoa_id` das
 * conexões da carteira é sempre `'sistema'` (`nasTabelasDaCarteiraComEscopo`),
 * e gravar isso como "quem escreveu" mentiria. Exigir o trigger genérico aqui
 * reprovaria as seis tabelas de propósito. A sexta, `auditoria_da_carteira`
 * em si, é a PRÓPRIA trilha — auditá-la seria recursão infinita, mesma razão
 * pela qual `auditoria` e `auditoria_do_painel` também não têm o trigger.
 *
 * O que CADA exame cobre:
 *  - `isolamento-de-clinica.test.ts`: RLS forçada + policy por grupo sem OR
 *    nas SEIS (mesmo exame de `ENTIDADES_DA_CARTEIRA_SEM_CLINICA`), mais um
 *    exame PRÓPRIO de append-only (regra 20) só para `auditoria_da_carteira`
 *    — sem UPDATE/DELETE/TRUNCATE para `fir_carteira`, mesmo padrão de
 *    `auditoria_do_painel` (0030).
 *  - `auditoria-inescapavel.test.ts`: confirma que NENHUMA das seis usa o
 *    trigger genérico — by design, nunca por omissão — e que as DUAS formas
 *    de trilha (trigger OU gravação explícita) continuam cobrindo toda
 *    escrita: a explícita é exercitada pelos `*.e2e.test.ts` de cada serviço
 *    (`cobrancas.e2e.test.ts`, `beneficios.e2e.test.ts`, etc.), que conferem
 *    a linha em `auditoria_da_carteira` depois de cada escrita.
 */
export const ENTIDADES_DO_FINANCEIRO_DA_CARTEIRA_SEM_CLINICA: readonly string[] = [
  'indicadores_carteira',
  'lancamentos_de_indicador',
  'metas_comerciais',
  'beneficios_de_indicacao',
  'cobrancas_do_cliente_firmare',
  'auditoria_da_carteira',
  // Ticket 4A (0045): a planilha de indicadores. Mesma trilha por código (`gravarAuditoriaDaCarteira` no PUT do link).
  'planilhas_do_cliente',
]

/**
 * G8 1B (appsec A-19): tabelas GLOBAIS da Firmare — sem `clinica_id` e sem
 * `grupo_id`, conteúdo da Firmare para toda a carteira. Escapam das
 * varreduras acima (que buscam a coluna de tenant), então cada uma tem o exame
 * próprio em `teste/conteudo-carteira-no-banco.test.ts`: RLS habilitada e
 * forçada, toda policy com `TO` explícito, escrita só por
 * `app_escopo() = 'geral'`, nada para `fir_app` e trigger de auditoria.
 *
 * Quando nascerem as outras de A-19 (`configuracao_da_carteira`,
 * `modelos_de_checklist`, `mensagens_comerciais`...), entram AQUI.
 */
export const ENTIDADES_GLOBAIS_DA_CARTEIRA: readonly string[] = [
  'materiais_da_biblioteca',
  // G8 2C (0053): os checklists dos programas e os itens deles.
  'modelos_de_checklist',
  'itens_de_modelo',
  // G8 3A (0054): modelos de mensagem, roteiros de abordagem e a linha de configuração (Pix, favorecido).
  'mensagens_comerciais',
  'roteiros_comerciais',
  'configuracao_da_carteira',
]

/**
 * As ÚNICAS rotas dispensadas de sessão.
 *
 * `SessaoGuard` é global (`APP_GUARD` em `app.module.ts`), então esquecer um
 * decorador significa rota protegida. Abrir uma rota exige `@Publico()` — e
 * `rotas-protegidas.test.ts` exige que ela esteja nesta lista, com razão
 * escrita. As duas coisas juntas fazem de "abrir uma rota" um ato deliberado
 * que alguém leu, em vez de uma omissão que ninguém notou.
 *
 * Se você está acrescentando uma linha aqui, a pergunta é: esta rota devolve
 * algum dado de alguma clínica? Se devolve, ela não pertence a esta lista.
 */
export type RotaPublica = {
  readonly metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly caminho: string
  readonly razao: string
}

export const ROTAS_PUBLICAS: readonly RotaPublica[] = [
  {
    metodo: 'GET',
    caminho: '/v1/saude',
    razao:
      'O HEALTHCHECK do Docker e o probe do Traefik não têm cookie. Devolve só {ok, banco} — nenhum dado de clínica.',
  },
  {
    metodo: 'POST',
    caminho: '/v1/entrar',
    razao: 'É a rota que CRIA a sessão. Exigir sessão aqui seria circular.',
  },
  {
    metodo: 'POST',
    caminho: '/v1/sair',
    razao:
      'Age só sobre o token do próprio chamador e responde 204 sem corpo. Protegida, um cookie já expirado daria 401 e o navegador ficaria com o cookie velho — o "Sair" deixaria de sair.',
  },
]
