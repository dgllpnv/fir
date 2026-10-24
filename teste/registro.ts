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
}

/** Plano 1 não expõe dinheiro ainda. Planos 2+ preenchem. */
export const ROTAS_COM_DINHEIRO: readonly RotaRegistrada[] = []

/**
 * Tabelas de negócio com `clinica_id`. O teste de isolamento varre todas.
 *
 * `auditoria` entra aqui como qualquer outra: a trilha de uma clínica é dado
 * DELA, e uma trilha legível entre clínicas entregaria num só `SELECT` tudo o
 * que a RLS protege em todas as demais tabelas.
 */
export const ENTIDADES_COM_CLINICA: readonly string[] = [
  'auditoria',
  'perfis',
  'pessoas',
  'sessoes',
  'tentativas_login',
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
