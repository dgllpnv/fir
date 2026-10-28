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

/**
 * O OPERADOR do painel — o superadmin. **Ele não é uma `pessoa`** (D-5,
 * restrição 1; D-10): tabela própria sem `clinica_id`, cookie próprio,
 * prefixo de rota próprio.
 *
 * ## Por que ele é um OBJETO, e `PessoaId` continua sendo uma string marcada
 *
 * `atorParaOBanco` e `atorEmColunas` precisam distinguir os três atores **em
 * tempo de execução**, e uma marca de tipo só existe para o compilador: duas
 * marcas sobre `string` seriam o mesmo `typeof 'string'` na execução, e a
 * tradução viraria palpite — exatamente o tipo de "funciona hoje" que escreve
 * o ator errado numa trilha append-only, onde não há como corrigir depois.
 *
 * As duas saídas possíveis eram tornar **os dois** discriminados, ou só este.
 * O segundo é o que está aqui, e a razão é de risco, não de preguiça:
 * `PessoaId` atravessa ~20 arquivos como string (parâmetro de SQL,
 * `aplicadoPorId`, `autorId`), e trocá-lo por um objeto seria uma mudança
 * mecânica em cada um deles — mudança grande, em código de dinheiro e de
 * dose, para comprar a mesma propriedade que esta assimetria já dá. Com
 * `symbol | object | string`, `typeof` separa os três casos e as duas funções
 * são **totais**.
 *
 * O preço é a assimetria entre os dois tipos, e ele está escrito aqui para
 * quem estranhar.
 */
declare const marcaDeOperador: unique symbol

export type OperadorId = {
  readonly tipo: 'operador'
  readonly id: string
  readonly [marcaDeOperador]?: true
}

/**
 * A ÚNICA porta de entrada de um `OperadorId`. O `as` mora aqui, uma vez.
 *
 * O único chamador legítimo é `PainelService.contextoDoToken`, onde o
 * operador vem do HASH do cookie `__Host-fir-painel`. Se um segundo aparecer,
 * a pergunta é a de sempre: este valor poderia ter sido escrito pelo
 * navegador? Se puder, ele não é um `OperadorId` — e um operador forjado
 * alcança **todas** as clínicas, não só uma.
 */
export const operadorIdDeFonteConfiavel = (id: string): OperadorId => ({ tipo: 'operador', id })

/** O tipo do ator que não é ninguém. Existe para quem precisa citá-lo. */
export type Sistema = typeof SISTEMA

export type Ator = PessoaId | OperadorId | Sistema

/**
 * A sentinela que a trigger `registrar_auditoria` (0013) entende, ao lado de
 * `sistema` e do uuid cru. Esta é a ÚNICA tradução, e ela mora ao lado do
 * tipo de propósito.
 */
export const PREFIXO_OPERADOR = 'operador:'

/**
 * A sentinela que o banco entende para "o sistema" — ver o cabeçalho de
 * `app_pessoa_id()` na migration 0004 para o porquê de não ser a string
 * vazia. Esta é a ÚNICA tradução do símbolo para texto, e ela mora ao lado da
 * definição do símbolo de propósito.
 */
export const SISTEMA_NO_BANCO = 'sistema'

/**
 * Função TOTAL sobre os três atores — `typeof` separa símbolo, objeto e
 * string, e não há ramo "senão". Um `as` aqui seria um palpite sobre qual
 * marca um valor carrega, e o palpite erra em silêncio.
 */
export const atorParaOBanco = (ator: Ator): string => {
  if (ator === SISTEMA) return SISTEMA_NO_BANCO
  if (typeof ator === 'object') return `${PREFIXO_OPERADOR}${ator.id}`
  return ator
}

/**
 * O ator nas COLUNAS de `auditoria`, para quem insere a linha à mão.
 *
 * A trigger de escrita faz essa tradução em plpgsql; o registro de ACESSO
 * (regra 18) insere direto, porque trigger não vê `SELECT`. Os dois precisam
 * concordar, e a `CHECK ator_tem_id` da migration 0004 recusa `'pessoa'` sem
 * id — então a tradução mora aqui, uma vez, e não dentro de um `INSERT`.
 *
 * `'operador'` PASSA A APARECER aqui (migration 0013, decisão D-10): o
 * superadmin continua não sendo uma `pessoa`, mas ele escreve na trilha **da
 * clínica em que opera**, e é essa linha que a clínica lê para saber o que
 * fizemos dentro dela. O acesso é total; o registro é obrigatório.
 */
export const atorEmColunas = (
  ator: Ator,
): { readonly tipo: 'pessoa' | 'operador' | 'sistema'; readonly id: string | null } => {
  if (ator === SISTEMA) return { tipo: 'sistema', id: null }
  if (typeof ator === 'object') return { tipo: 'operador', id: ator.id }
  return { tipo: 'pessoa', id: ator }
}
