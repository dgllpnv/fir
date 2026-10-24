import type { ChaveDePermissao, Perfil } from '@fir/domain'
import type { PessoaPublica } from '@fir/contracts'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * O que o guard de autenticação anexa à requisição.
 *
 * A clínica vem inteira (id, código, nome, fuso) porque `GET /v1/eu` a
 * devolve para a tela, e buscá-la de novo no controlador seria uma consulta a
 * mais por requisição para um dado que o guard já leu.
 */
export type ContextoDaRequisicao = {
  // `ClinicaId` marcado: este é o valor que vai para `naClinica`, e ele veio
  // do cookie pelo guard de sessão — nunca do corpo. Ver `clinica-id.ts`.
  readonly clinicaId: ClinicaId
  readonly clinicaCodigo: string
  readonly clinicaNome: string
  readonly clinicaFuso: string
  readonly usuario: PessoaPublica
  readonly perfis: readonly PerfilComChave[]
  readonly pode: (chave: ChaveDePermissao) => boolean
}

/** `Perfil` do domínio mais a `chave` estável, que a tela usa para rotular. */
export type PerfilComChave = Perfil & { readonly chave: string }

export type RequisicaoComContexto = { contexto?: ContextoDaRequisicao }
