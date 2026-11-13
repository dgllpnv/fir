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
 * ## Era um `Symbol`, e virou um objeto congelado — a razão é MEDIDA
 *
 * A propriedade que se queria é a mesma, e ela se mantém: **nenhuma `string`
 * é um ator válido para o compilador**, então um `PessoaId` mal tipado que
 * viesse a valer `'sistema'` não se passa por sistema. Escrever `SISTEMA`
 * continua sendo um ato deliberado.
 *
 * O que mudou é o que o `unique symbol` custava. Ele **alarga** em posição de
 * propriedade de literal de objeto: `{ ator: c.ator }` inferia
 * `symbol | PessoaId | OperadorId`, e `symbol` não é assinável a um `unique
 * symbol`. Com a D-13, quando `ContextoDaRequisicao.ator` passou de
 * `PessoaId` para `Ator`, isso virou **35 erros de compilação** em
 * controladores que só repassam o contexto — e a saída seria um `as Ator` em
 * cada um deles, isto é, 35 afirmações sem prova no caminho que decide quem
 * assina a trilha.
 *
 * Objeto congelado não alarga, e `===` sobre um singleton distingue tão bem
 * quanto um símbolo. `Object.freeze` para que ninguém lhe acrescente um `id` e
 * o faça parecer um `OperadorId`.
 */
export const SISTEMA = Object.freeze({ tipo: 'sistema' } as const)

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
 * `PessoaId` continua string, e a razão é de risco: ela atravessa ~20
 * arquivos como string (parâmetro de SQL, `aplicadoPorId`, `autorId`), e
 * trocá-la por um objeto seria uma mudança mecânica em cada um deles — grande,
 * em código de dinheiro e de dose, para comprar a mesma propriedade que esta
 * assimetria já dá. Com `string` de um lado e objeto do outro, `typeof`
 * separa os casos e as duas funções são **totais**.
 *
 * O preço é a assimetria entre os dois tipos, e ele está escrito aqui para
 * quem estranhar.
 */
declare const marcaDeOperador: unique symbol

export type OperadorId = {
  readonly tipo: 'operador'
  readonly id: string
  /**
   * A administradora da clínica, que **assina no lugar do operador** nas colunas
   * `NOT NULL` que guardam uma pessoa (`responsavel_id`, `registrado_por`…).
   *
   * Decisão do dono (2026-11-13, ADR "suporte-age-como-administradora"): o
   * superadmin deve poder tudo o que a administradora pode. A FK exige uma
   * pessoa, então ela empresta o id; **a trilha de auditoria continua dizendo
   * `ator_tipo = 'operador'`** (`atorEmColunas` ignora este campo), e é ela que
   * responde "quem fez de verdade". `pessoaDoAtor` continua `null`: leitura de
   * "minhas tarefas" do operador segue vazia, nada é lido como se fosse dela.
   */
  readonly comoPessoa?: PessoaId
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

export type Ator = PessoaId | OperadorId | UsuarioPortalId | Sistema

/**
 * A sentinela que a trigger `registrar_auditoria` (0013) entende, ao lado de
 * `sistema` e do uuid cru. Esta é a ÚNICA tradução, e ela mora ao lado do
 * tipo de propósito.
 */
export const PREFIXO_OPERADOR = 'operador:'

/**
 * A sentinela do terceiro ator (G5, ADR 0016) — o `Usuário de Gestão`
 * escrevendo em tabela da carteira. `registrar_auditoria()`,
 * `registrar_auditoria_carteira_cliente()` e `registrar_auditoria_do_painel()`
 * (migration 0032) já reconhecem este prefixo desde a 0025; esta constante só
 * passa a ser USADA do lado TypeScript com G5 (`BancoService.
 * nasTabelasDaCarteiraComoUsuarioDeGestao`). Não vira um `UsuarioDeGestaoId`
 * tipado como `OperadorId` por enquanto — o único chamador é aquele método, e
 * criar um tipo nominal para um único uso seria cerimônia sem o ganho que
 * justificou `OperadorId` (35 chamadores, D-13).
 */
export const PREFIXO_USUARIO_GESTAO = 'usuario_gestao:'

/**
 * O QUARTO ATOR (G6, ADR 0018) — o `Usuário do portal`, lendo dado comercial
 * do lado do Cliente Firmare. Diferente de `UsuarioDeGestaoId` (que não
 * chegou a existir tipado, porque nunca escreveu nada até agora), este
 * PRECISA de tipo próprio: o registro de acesso (ADR 0017 §5) exige gravar
 * `ator_tipo = 'usuario_portal'` em `auditoria`, via `AuditoriaService.
 * registrarAcesso`, que recebe um `Ator` — sem este tipo, não haveria como
 * `atorEmColunas` distinguir um `Usuário do portal` de uma `Pessoa`.
 */
declare const marcaDeUsuarioPortal: unique symbol

export type UsuarioPortalId = {
  readonly tipo: 'usuario_portal'
  readonly id: string
  readonly [marcaDeUsuarioPortal]?: true
}

/**
 * A ÚNICA porta de entrada de um `UsuarioPortalId`. O `as` mora aqui, uma
 * vez. O único chamador legítimo é `PortalService.contextoDoToken`, onde o
 * `Usuário do portal` vem do HASH do cookie `__Host-fir-portal`.
 */
export const usuarioPortalIdDeFonteConfiavel = (id: string): UsuarioPortalId => ({
  tipo: 'usuario_portal',
  id,
})

/** A sentinela do quarto ator — `registrar_auditoria()` já a reconhece desde a migration 0034. */
export const PREFIXO_USUARIO_PORTAL = 'usuario_portal:'

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
  // `typeof === 'string'` PRIMEIRO, e não `=== SISTEMA` primeiro: a pessoa é
  // o caso de toda requisição do balcão, e a ordem deixa a leitura do mais
  // comum ao mais raro. Os quatro ramos cobrem a união inteira — não há "senão".
  if (typeof ator === 'string') return ator
  // `ator.tipo` e não `ator === SISTEMA`: é o DISCRIMINANTE que estreita a
  // união para o compilador, e é ele que torna estes quatro ramos totais —
  // sem "senão", sem `as`.
  if (ator.tipo === 'sistema') return SISTEMA_NO_BANCO
  if (ator.tipo === 'usuario_portal') return `${PREFIXO_USUARIO_PORTAL}${ator.id}`
  return `${PREFIXO_OPERADOR}${ator.id}`
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
): {
  readonly tipo: 'pessoa' | 'operador' | 'usuario_portal' | 'sistema'
  readonly id: string | null
} => {
  if (typeof ator === 'string') return { tipo: 'pessoa', id: ator }
  if (ator.tipo === 'sistema') return { tipo: 'sistema', id: null }
  if (ator.tipo === 'usuario_portal') return { tipo: 'usuario_portal', id: ator.id }
  return { tipo: 'operador', id: ator.id }
}

/**
 * O ator QUANDO ELE É UMA PESSOA — `null` quando não é (D-13).
 *
 * ## Por que esta função existe, e por que ela não é uma conveniência
 *
 * `Ator` responde "quem está escrevendo", e é o que vai para
 * `app.pessoa_id` e para a trilha. Mas o banco tem **trinta e tantas colunas**
 * que guardam *uma pessoa da clínica*: `criada_por`, `responsavel_id`,
 * `lancado_por`, `fechado_por`, `definida_por`, `por_id`. Elas são FK para
 * `pessoas`, e o `OperadorId` **não cabe em nenhuma delas** — nem deve: o
 * operador não é uma pessoa da clínica (D-5, restrição 1).
 *
 * Antes da D-13 os dois papéis eram o mesmo valor, e por isso `ctx.ator` ia
 * direto para a coluna. Agora são dois, e **esta é a única tradução**. Sem
 * ela, o objeto `{ tipo: 'operador', id }` seria serializado pelo `pg` e
 * chegaria ao Postgres como texto — `invalid input syntax for type uuid`, 500
 * na tela, numa rota que a recepcionista usa todo dia.
 *
 * `null` é a resposta HONESTA para coluna anulável: nenhuma pessoa da clínica
 * fez aquilo, e quem fez está na trilha, com `ator_tipo = 'operador'`.
 * Fabricar um id ali seria assinar o trabalho de alguém com o nome de outra.
 *
 * Em cláusula `WHERE` ("as contas sob minha responsabilidade", "minhas
 * metas"), `null` não casa nada e a lista sai **vazia** — que é exatamente o
 * que se quer: o operador não tem tarefa, nem meta, nem conta. Mostrar vazio
 * é resposta legítima; mostrar as de alguém não é.
 */
export const pessoaDoAtor = (ator: Ator): PessoaId | null =>
  typeof ator === 'string' ? ator : null

/**
 * O erro de uma escrita que **exige nome de pessoa** e não o tem.
 *
 * Erro próprio e não `ForbiddenException`: `banco/` não conhece HTTP. Quem
 * traduz é o `FiltroDeExcecao` da borda — num lugar só, para que a rota
 * número quarenta não precise lembrar de mapear.
 */
export class SessaoDeSuporteNaoAssina extends Error {
  constructor() {
    super('Esta ação é de uma pessoa da clínica, e a sessão do painel não é uma.')
  }
}

/**
 * O ator como pessoa, **ou recusa**.
 *
 * Usado onde a coluna é `NOT NULL` e guarda uma pessoa: `recebimentos.
 * registrado_por`, `caixas_do_dia.fechado_por`, `metas_do_mes.definida_por`,
 * `conversas_1a1.por_id`, `tarefas.responsavel_id`.
 *
 * Nessas, não há resposta honesta para "qual pessoa": fechar o caixa da
 * clínica, registrar um recebimento, definir a meta do mês e conduzir uma 1:1
 * são **rituais da clínica**, feitos por quem trabalha nela. O suporte olha e
 * conserta configuração; ele não faz a rotina da clínica em nome de ninguém.
 *
 * FALHA FECHADO, e é o modo de falha certo: a alternativa seria deixar o
 * `NULL` chegar à coluna e o Postgres recusar com `not-null violation` — 500
 * numa tela, em vez de uma frase que diz o que aconteceu.
 */
export const exigePessoa = (ator: Ator): PessoaId => {
  const pessoa = pessoaDoAtor(ator)
  if (pessoa !== null) return pessoa
  // O operador assina como a administradora da clínica (ver `OperadorId`).
  if (typeof ator !== 'string' && ator.tipo === 'operador' && ator.comoPessoa !== undefined) {
    return ator.comoPessoa
  }
  throw new SessaoDeSuporteNaoAssina()
}
