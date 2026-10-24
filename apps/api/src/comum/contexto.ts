import type { ChaveDePermissao, Perfil } from '@fir/domain'
import type { PessoaPublica } from '@fir/contracts'
import type { PessoaId } from '../banco/ator'
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
  /**
   * O ATOR, marcado — o mesmo valor de `usuario.id`, com o tipo que
   * `naClinica` exige.
   *
   * Existe separado de `usuario.id` por uma razão só, e ela é a de
   * `clinica-id.ts`: `usuario` é `PessoaPublica`, um tipo de CONTRATO, cujo
   * `id` é `string` porque ele também descreve corpo de requisição. Um
   * controlador que escrevesse `naClinica(c.clinicaId, c.usuario.id as PessoaId, …)`
   * espalharia o `as` por quarenta arquivos, e no quadragésimo alguém
   * marcaria `corpo.pessoaId` do mesmo jeito. Aqui o valor já vem marcado de
   * onde a identidade foi PROVADA (`resolver_sessao`, pelo hash do cookie), e
   * nenhum controlador precisa de `as`.
   */
  readonly ator: PessoaId
  readonly usuario: PessoaPublica
  readonly perfis: readonly PerfilComChave[]
  readonly pode: (chave: ChaveDePermissao) => boolean
}

/** `Perfil` do domínio mais a `chave` estável, que a tela usa para rotular. */
export type PerfilComChave = Perfil & { readonly chave: string }

export type RequisicaoComContexto = { contexto?: ContextoDaRequisicao }
