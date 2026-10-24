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
  readonly metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE'
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
 * As rotas de paciente devolvem `ltv` e `saldo` por linha. As de tarefa
 * recebem e devolvem o pagamento embutido (`valor`, `valorAberto`) — elas
 * nascem no épico 2, Tasks 8 a 11, e estão aqui porque o CONTRATO delas já
 * existe: `PagamentoEmbutido` e `Concluir` são esquemas exportados de
 * `@fir/contracts` hoje, e a varredura os enxerga hoje.
 */
export const ROTAS_COM_DINHEIRO: readonly RotaRegistrada[] = [
  { metodo: 'GET', caminho: '/v1/auditoria', camposDeDinheiro: [...CAMPOS_MONETARIOS], curinga: true },
  { metodo: 'GET', caminho: '/v1/pacientes', camposDeDinheiro: ['ltv', 'saldo'] },
  { metodo: 'GET', caminho: '/v1/pacientes/:id', camposDeDinheiro: ['ltv', 'saldo'] },
  { metodo: 'POST', caminho: '/v1/tarefas', camposDeDinheiro: ['valor', 'valorAberto'] },
  { metodo: 'POST', caminho: '/v1/tarefas/:id/concluir', camposDeDinheiro: ['valor', 'valorAberto'] },
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
  'pacientes',
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
