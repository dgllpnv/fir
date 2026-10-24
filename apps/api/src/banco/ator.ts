/**
 * Quem está escrevendo — a outra metade do contexto da transação, ao lado da
 * clínica.
 *
 * A trigger `registrar_auditoria` (migration 0004) recusa toda escrita em
 * tabela de negócio sem ator declarado. Este arquivo é o vocabulário que o
 * compilador usa para cobrar essa declaração em cada chamada de `naClinica`.
 */

/**
 * O identificador de pessoa, como TIPO NOMINAL — a mesma defesa de
 * `ClinicaId`, pela mesma razão.
 *
 * `naClinica(clinica, corpo.pessoaId, …)` com `string` compilaria, e a trilha
 * passaria a atribuir à pessoa que o navegador escolheu tudo o que a
 * requisição escrevesse. Numa trilha append-only isso não se corrige depois:
 * o registro falso é permanente, e ele é a prova que a clínica apresentaria.
 */
declare const marcaDePessoa: unique symbol

export type PessoaId = string & { readonly [marcaDePessoa]: true }

/**
 * A ÚNICA porta de entrada de um `PessoaId`. O `as` mora aqui, uma vez.
 *
 * Os chamadores legítimos são os lugares onde a identidade foi PROVADA, nunca
 * informada:
 *
 *  1. `AutenticacaoService.entrar` — depois de o Argon2 conferir a senha.
 *  2. `AutenticacaoService.contextoDoToken` e `.sair` — a pessoa vem de
 *     `resolver_sessao`, que a descobre a partir do HASH do cookie.
 *
 * Se um terceiro chamador aparecer, a pergunta é: este valor poderia ter sido
 * escrito pelo navegador? Se puder, ele não é um `PessoaId` — é um palpite,
 * e um palpite não assina a trilha de ninguém.
 */
export const pessoaIdDeFonteConfiavel = (id: string): PessoaId => id as PessoaId

/**
 * O ator que não é pessoa: semente, job de fila, migration de dados.
 *
 * `Symbol`, e não a string `'sistema'`: com a string, um `PessoaId` mal
 * tipado que viesse a valer `'sistema'` se passaria por sistema, e qualquer
 * variável `string` seria um ator válido para o compilador. O símbolo não tem
 * outro valor possível, e escrevê-lo é um ato deliberado.
 */
export const SISTEMA = Symbol('ator.sistema')

export type Ator = PessoaId | typeof SISTEMA

/**
 * A sentinela que o banco entende para "o sistema" — ver o cabeçalho de
 * `app_pessoa_id()` na migration 0004 para o porquê de não ser a string
 * vazia. Esta é a ÚNICA tradução do símbolo para texto, e ela mora ao lado da
 * definição do símbolo de propósito.
 */
export const SISTEMA_NO_BANCO = 'sistema'

export const atorParaOBanco = (ator: Ator): string =>
  ator === SISTEMA ? SISTEMA_NO_BANCO : ator

/**
 * O ator nas COLUNAS de `auditoria`, para quem insere a linha à mão.
 *
 * A trigger de escrita faz essa tradução em plpgsql; o registro de ACESSO
 * (regra 18) insere direto, porque trigger não vê `SELECT`. Os dois precisam
 * concordar, e a `CHECK ator_tem_id` da migration 0004 recusa `'pessoa'` sem
 * id — então a tradução mora aqui, uma vez, e não dentro de um `INSERT`.
 *
 * `'operador'` não aparece: o superadmin do épico 12 não é uma `pessoa`
 * (decisão D-5, restrição 1) e não atravessa este tipo.
 */
export const atorEmColunas = (
  ator: Ator,
): { readonly tipo: 'pessoa' | 'sistema'; readonly id: string | null } =>
  ator === SISTEMA ? { tipo: 'sistema', id: null } : { tipo: 'pessoa', id: ator }
