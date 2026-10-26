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

export const ROTAS_COM_DINHEIRO: readonly RotaRegistrada[] = [
  { metodo: 'GET', caminho: '/v1/auditoria', camposDeDinheiro: [...CAMPOS_MONETARIOS], curinga: true },
  // `credito` entrou com o épico 4: a lista e a ficha deixaram de calcular o
  // saldo com `greatest(0, …)` em SQL e passaram a consumir `saldoEmAberto`,
  // que preserva o excedente em vez de engoli-lo.
  { metodo: 'GET', caminho: '/v1/pacientes', camposDeDinheiro: ['ltv', 'saldo', 'credito'] },
  { metodo: 'GET', caminho: '/v1/pacientes/:id', camposDeDinheiro: ['ltv', 'saldo', 'credito'] },
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
]

/**
 * Tabelas de negócio com `clinica_id`. O teste de isolamento varre todas.
 *
 * `auditoria` entra aqui como qualquer outra: a trilha de uma clínica é dado
 * DELA, e uma trilha legível entre clínicas entregaria num só `SELECT` tudo o
 * que a RLS protege em todas as demais tabelas.
 */
export const ENTIDADES_COM_CLINICA: readonly string[] = [
  'auditoria',
  'caixa_por_forma',
  'caixas_do_dia',
  'cobrancas',
  'configuracao_financeira',
  'contas_a_pagar',
  // O épico 5 (0010): o catálogo, o programa e os dois filhos deles.
  'insumos_do_procedimento',
  'itens_do_programa',
  'metas_do_mes',
  'motivos_de_perda',
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
