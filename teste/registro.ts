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

/** Tabelas de negócio com `clinica_id`. O teste de isolamento varre todas. */
export const ENTIDADES_COM_CLINICA: readonly string[] = ['perfis', 'pessoas', 'sessoes', 'tentativas_login']
