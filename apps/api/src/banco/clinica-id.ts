/**
 * O identificador de clínica, como TIPO NOMINAL.
 *
 * `naClinica(clinicaId: string, ...)` aceitava qualquer string — inclusive
 * `req.body.clinicaId` e `req.query.clinica`. Nada no compilador distinguia
 * "a clínica que o guard de sessão resolveu a partir do cookie" de "a clínica
 * que o navegador mandou no corpo", e a segunda é exatamente o bug que
 * entrega o paciente de outra clínica: `SET LOCAL app.clinica_id` passaria a
 * ser o que o atacante escolheu, e a RLS obedeceria, porque a RLS confia no
 * valor fixado.
 *
 * Com a marca, `naClinica(corpo.clinicaId)` **não compila**. O Plano 2 vai
 * escrever dezenas de repositórios, e a hora de tornar isso impossível é
 * antes do primeiro deles, não depois do quadragésimo.
 *
 * `unique symbol` numa propriedade que nunca existe em tempo de execução: o
 * valor continua sendo a string crua, sem custo nenhum, e duas marcas
 * diferentes (um futuro `PessoaId`) também não se confundem entre si — é o
 * que um `type ClinicaId = string` nunca daria.
 */
declare const marcaDeClinica: unique symbol

export type ClinicaId = string & { readonly [marcaDeClinica]: true }

/**
 * A ÚNICA porta de entrada de um `ClinicaId`. O `as` mora aqui, uma vez, com
 * esta explicação — e não espalhado por quem precisa de um.
 *
 * Os chamadores legítimos são os dois lugares onde a clínica é resolvida de
 * forma confiável, e **nenhum deles lê a requisição**:
 *
 *  1. `AutenticacaoService.clinicaPorCodigo` — a clínica vem do banco, pelo
 *     código informado na entrada, e só depois de `ativa` ser verdadeiro.
 *  2. `AutenticacaoService.contextoDoToken` e `.sair` — a clínica vem de
 *     `resolver_sessao`, a função `SECURITY DEFINER` que a descobre a partir
 *     do HASH do cookie. O cookie é `__Host-`, `HttpOnly` e opaco; quem o
 *     apresenta não escolhe a clínica que ele resolve.
 *
 * Se um terceiro chamador aparecer, a pergunta a responder é: este valor
 * poderia ter sido escrito pelo navegador? Se puder, ele não é um
 * `ClinicaId`.
 */
export const clinicaIdDeFonteConfiavel = (id: string): ClinicaId => id as ClinicaId
