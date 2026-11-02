import type { ChaveDePermissao, Perfil } from '@fir/domain'
import type { OperadorPublico, PessoaPublica } from '@fir/contracts'
import type { Ator } from '../banco/ator'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * O que o guard de autenticação anexa à requisição.
 *
 * A clínica vem inteira (id, código, nome, fuso) porque `GET /v1/eu` a
 * devolve para a tela, e buscá-la de novo no controlador seria uma consulta a
 * mais por requisição para um dado que o guard já leu.
 *
 * ## O SUJEITO DA SESSÃO É UM DOS DOIS — decisão D-13
 *
 * Desde a D-13 a sessão do produto pode carregar um **`Operador`** em vez de
 * uma `Pessoa`: é a *sessão de suporte*, por onde o superadmin abre o sistema
 * da clínica já logado, com privilégio de administradora.
 *
 * `pessoa` e `operador` são **exclusivos**, e o banco cobra o mesmo XOR pelo
 * `CHECK sessao_tem_um_sujeito` (migration 0022). Não existe contexto com os
 * dois, e não existe contexto com nenhum — `contextoDoToken` devolve `null`
 * nesse caso, e o guard recusa.
 *
 * **`pessoa` era `usuario`, e o nome mudou de propósito.** Com `usuario`
 * sempre presente, todo chamador assumia que havia uma pessoa; com `pessoa |
 * null`, o compilador obriga cada um deles a dizer o que faz quando não há.
 * Foi assim que o `/v1/eu/senha` da sessão de suporte apareceu — ele trocaria
 * a senha de ninguém.
 */
export type ContextoDaRequisicao = {
  // `ClinicaId` marcado: este é o valor que vai para `naClinica`, e ele veio
  // do cookie pelo guard de sessão — nunca do corpo. Ver `clinica-id.ts`.
  readonly clinicaId: ClinicaId
  readonly clinicaCodigo: string
  readonly clinicaNome: string
  readonly clinicaFuso: string
  /**
   * O ATOR, marcado — a `PessoaId` da pessoa da sessão, ou o `OperadorId` do
   * operador dela.
   *
   * Existe separado de `pessoa.id` por uma razão só, e ela é a de
   * `clinica-id.ts`: `pessoa` é `PessoaPublica`, um tipo de CONTRATO, cujo
   * `id` é `string` porque ele também descreve corpo de requisição. Um
   * controlador que escrevesse `naClinica(c.clinicaId, c.pessoa.id as PessoaId, …)`
   * espalharia o `as` por quarenta arquivos, e no quadragésimo alguém
   * marcaria `corpo.pessoaId` do mesmo jeito. Aqui o valor já vem marcado de
   * onde a identidade foi PROVADA (`resolver_sessao`, pelo hash do cookie), e
   * nenhum controlador precisa de `as`.
   *
   * `Ator` e não `PessoaId` desde a D-13: na sessão de suporte ele é o
   * operador, e é esse valor que `naClinica` traduz em `operador:<uuid>` para
   * a trigger de auditoria gravar `ator_tipo = 'operador'` na trilha da
   * clínica. **Nenhuma escrita do operador é atribuída a uma pessoa.**
   */
  readonly ator: Ator
  /** A pessoa da sessão. `null` na sessão de suporte — não há pessoa. */
  readonly pessoa: PessoaPublica | null
  /** O operador da sessão de suporte. `null` na sessão de uma pessoa. */
  readonly operador: OperadorPublico | null
  readonly perfis: readonly PerfilComChave[]
  readonly pode: (chave: ChaveDePermissao) => boolean
}

/** `Perfil` do domínio mais a `chave` estável, que a tela usa para rotular. */
export type PerfilComChave = Perfil & { readonly chave: string }

export type RequisicaoComContexto = { contexto?: ContextoDaRequisicao }
