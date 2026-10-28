import { SENHA_MAX, canonizarUsuario } from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Uuid } from './comum'

export const EntrarEntrada = z.object({
  // A clínica entra aqui, no contrato, e não lida solta do corpo no
  // controlador: um campo que o schema não conhece é um campo que ninguém
  // valida.
  clinica: z.string().trim().toLowerCase().min(1, 'Informe a clínica.').max(60),
  /**
   * `transform` e NÃO `refine`: o canônico é o que segue adiante — para a
   * consulta E para `tentativas_login`, que é o que faz o limite por conta
   * contar `Helena`, `HELENA` e `heléna` como UMA conta. Validar a FORMA aqui
   * recusaria `Helena`, que é o que o teclado do tablet entrega; a recusa de
   * forma mora no cadastro e no `CHECK` do banco.
   *
   * `max(64)` antes do transform, e não `max(USUARIO_MAX)`: o teto aqui é de
   * custo, não de regra. Quem digitar 40 caracteres recebe credencial
   * inválida, como qualquer um que erre o usuário — nunca uma mensagem que
   * diga como o identificador é formado.
   */
  usuario: z
    .string()
    .max(64)
    .transform(canonizarUsuario)
    .pipe(z.string().min(1, 'Informe o usuário.')),
  /**
   * `min(1)`, e **não** `min(SENHA_MIN)`. A tela de ENTRADA não aplica a
   * regra de força: quem tem uma senha antiga de oito caracteres precisa
   * conseguir entrar para poder trocá-la, e aplicar a política aqui tranca
   * pessoas para fora por uma mudança de política. A regra vale na CRIAÇÃO e
   * na TROCA, que é onde ela muda alguma coisa.
   */
  senha: z.string().min(1, 'Informe a senha.').max(SENHA_MAX),
})
export type EntrarEntrada = z.infer<typeof EntrarEntrada>

export const PerfilPublico = z.object({
  id: Uuid,
  chave: z.string(),
  nome: z.string(),
  perms: z.array(z.string()),
})
export type PerfilPublico = z.infer<typeof PerfilPublico>

export const PessoaPublica = z.object({
  id: Uuid,
  nome: z.string(),
  /** O identificador de login, na forma canônica. Não há e-mail (D-10). */
  usuario: z.string(),
  funcao: z.string(),
  admin: z.boolean(),
  perfilId: Uuid.nullable(),
  ativo: z.boolean(),
  /**
   * A senha atual foi definida por outra pessoa e precisa ser trocada.
   *
   * Vai para a tela porque é ela que redireciona para `/trocar-senha`; o
   * SERVIDOR é quem impõe, por guard global, e nunca confia neste booleano.
   */
  senhaProvisoria: z.boolean(),
})
export type PessoaPublica = z.infer<typeof PessoaPublica>

export const ClinicaPublica = z.object({
  id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  fuso: z.string(),
})
export type ClinicaPublica = z.infer<typeof ClinicaPublica>

/** O que `GET /v1/eu` devolve. A tela monta o menu a partir de `perfis`. */
export const EuSaida = z.object({
  usuario: PessoaPublica,
  clinica: ClinicaPublica,
  perfis: z.array(PerfilPublico),
  /**
   * **O dia de negócio, do SERVIDOR, no fuso da clínica** (regra 24).
   *
   * Toda tela que precisa saber "que dia é hoje" — o `max` de um campo de
   * data, o agrupamento de contas vencidas, o mês corrente da Visão do mês —
   * lê daqui. O relógio do navegador não decide isso, e o do servidor web
   * tampouco: é um terceiro relógio, e a clínica que abre às 23h55 veria o
   * dia virar antes dela.
   *
   * Vem em `/v1/eu` porque toda página já resolve a sessão; uma rota só para
   * perguntar a data seria uma ida a mais em cada navegação.
   */
  hoje: DiaCivil,
})
export type EuSaida = z.infer<typeof EuSaida>

export const EntrarSaida = EuSaida
export type EntrarSaida = z.infer<typeof EntrarSaida>

/**
 * Trocar a PRÓPRIA senha — a mesma rota que serve à troca voluntária e ao
 * primeiro acesso obrigatório.
 *
 * `.strict()`, e isto é o ponto da regra de contexto: um campo `contexto`
 * aceito aqui seria um contexto ESCOLHIDO PELO CLIENTE, e bastaria mandá-lo
 * vazio para que o bloqueio por nome da clínica e nome da pessoa deixasse de
 * existir. O contexto monta-se no servidor, a partir da sessão. Campo a mais
 * é 400, nunca ignorado em silêncio.
 *
 * `min(1)` em `atual` e não `min(SENHA_MIN)`: a senha que a pessoa TEM pode
 * ser mais curta que a regra de hoje, e exigir a regra no campo da senha
 * antiga trancaria exatamente quem precisa trocar.
 */
export const TrocarSenhaEntrada = z
  .object({
    atual: z.string().min(1, 'Informe a senha atual.').max(SENHA_MAX),
    nova: z.string().min(1, 'Informe a nova senha.').max(SENHA_MAX),
  })
  .strict()
export type TrocarSenhaEntrada = z.infer<typeof TrocarSenhaEntrada>
