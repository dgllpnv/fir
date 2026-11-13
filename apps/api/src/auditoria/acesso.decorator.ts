import { SetMetadata } from '@nestjs/common'

/**
 * A MARCAÇÃO DE ACESSO — regra 18.
 *
 * A trigger `registrar_auditoria` não vê `SELECT`, e a pergunta que a LGPD
 * dá à clínica é *"quem olhou o prontuário da minha paciente"*: ninguém
 * alterou nada, e é exatamente isso que precisa ser respondível.
 *
 * MARCAÇÃO EXPLÍCITA, E NÃO AUTOMÁTICA, e isto não é preguiça. Registrar
 * todo `GET` encheria a trilha de ruído — a tela Hoje recarrega sozinha — e
 * ruído esconde o que importa: uma trilha com dez mil linhas de `/v1/eu` por
 * dia é uma trilha que ninguém abre, e trilha que ninguém abre não responde
 * pergunta nenhuma. O custo da escolha é o esquecimento, e ele é real: nenhum
 * teste sabe dizer que uma rota NOVA deveria estar marcada. O que é coberto
 * por varredura é o contrário — que toda rota marcada está marcada de forma
 * coerente (ver `teste/acesso-sensivel.test.ts`).
 */
export const DADO_SENSIVEL = 'fir:dado-sensivel'

/**
 * O nome da entidade acessada, e ele é o NOME DA TABELA de propósito.
 *
 * A trigger de escrita grava `TG_TABLE_NAME` — `pessoas`, `perfis`,
 * `sessoes`. Se a leitura gravasse `pessoa` no singular, a trilha de um
 * mesmo registro ficaria partida em dois nomes, e "o que aconteceu com esta
 * pessoa" passaria a exigir que quem consulta saiba das duas convenções.
 * Mesma coluna, mesmo vocabulário.
 *
 * UNIÃO LITERAL, e não `string`: um erro de digitação (`'pessaos'`) não
 * levanta nada em tempo de execução — ele FRAGMENTA a trilha em silêncio, e
 * o agrupamento por entidade passa a esconder as linhas digitadas errado.
 * Com a união, quebra o `typecheck`. `teste/acesso-sensivel.test.ts` ainda
 * confere cada nome usado contra o catálogo do Postgres, porque a união
 * garante consistência e não existência.
 *
 * Acrescente aqui conforme os épicos trouxerem as tabelas — `pacientes`,
 * `aplicacoes` e `programas` são do épico 2 e do 6.
 */
export type EntidadeSensivel =
  | 'auditoria'
  | 'pacientes'
  | 'pessoas'
  /** As tarefas de uma campanha: nome do paciente alcançado + procedimentos (I4). */
  | 'campanhas'
  /**
   * A FICHA DE RH (épico 7). Ela carrega o salário, e a pergunta que a clínica
   * faz depois é *"quem abriu o salário dela"* — ninguém alterou nada, e a
   * trigger de escrita não vê `SELECT`. A LISTA de fichas não é marcada, e por
   * isso ela não carrega `salario`: marcar a lista encheria a trilha de
   * "abriu a Equipe" e esconderia a pergunta útil.
   */
  | 'fichas_de_pessoa'
  /**
   * A CONVERSA 1:1 (épico 7, segunda fatia). Ela é **avaliação de desempenho
   * de uma funcionária identificada** — "pontos fortes, a desenvolver e
   * combinados" —, e a pergunta que a clínica faz depois é *"quem leu o que
   * foi dito dela"*. Mesma classificação do salário, pela mesma razão: ninguém
   * alterou nada, e a trigger de escrita não vê `SELECT`.
   *
   * A marca é `{ lista: true }`, e não `{ param }`: a tela abre as 60 últimas
   * conversas de uma vez, e uma linha de trilha por conversa devolvida
   * esconderia o próximo acesso a UMA no meio delas.
   */
  | 'conversas_1a1'
  /**
   * O PORTAL DO GRUPO (G6, ADR 0017 §5). Um `Usuário do portal` lendo a
   * seção comercial de um `Cliente Firmare` (metas, campanhas, cobrança,
   * materiais, documentos, reuniões — tudo numa resposta só) grava UMA linha
   * por CLÍNICA incluída, nunca uma por tabela: a pergunta que a LGPD
   * responde aqui é "quem do lado do cliente olhou o que é dela", e isso não
   * muda com quantas tabelas a leitura juntou. `PortalLeituraService`
   * registra isto diretamente (não via `@DadoSensivel`/`AcessoInterceptor`:
   * uma única requisição do portal grava N linhas, uma por `Clinica`
   * visível, e o mecanismo genérico foi desenhado para UM id por resposta).
   */
  | 'carteira_comercial'

/**
 * De onde sai o `entidade_id` da linha de trilha.
 *
 * `{ param }` é o caso que a regra 18 descreve: uma ficha, um registro, um
 * id. `{ lista: true }` é a rota que entrega muitos de uma vez — e aí a
 * trilha registra o ACESSO À LISTAGEM, não uma linha por registro devolvido.
 * Uma linha por registro seria a leitura certa da regra e a decisão errada na
 * prática: uma busca que devolve 200 pacientes viraria 200 linhas, e o
 * próximo acesso a UMA ficha ficaria invisível no meio delas.
 */
export type FonteDoId = { readonly param: string } | { readonly lista: true }

/**
 * `entidade_id` é `NOT NULL`, e listagem não tem id. Esta é a sentinela, num
 * lugar só, e ela é legível por quem lê a trilha sem consultar código.
 */
export const ID_DE_LISTA = '(lista)'

export type MarcaDeAcesso = {
  readonly entidade: EntidadeSensivel
  readonly de: FonteDoId
}

/**
 * Marca a rota como entrega de dado pessoal sensível: `AcessoInterceptor`
 * grava uma linha `acao = 'acessou'` em toda resposta de SUCESSO dela.
 *
 * O padrão `{ param: 'id' }` cobre o caso comum (`/v1/pacientes/:id`) sem
 * repetição. Quando o parâmetro tem outro nome, declare-o — e a varredura
 * cobra que ele exista no caminho registrado, em tempo de teste, em vez de
 * a rota falhar fechada na primeira vez que alguém a abrir em produção.
 */
export const DadoSensivel = (
  entidade: EntidadeSensivel,
  de: FonteDoId = { param: 'id' },
): MethodDecorator & ClassDecorator =>
  SetMetadata(DADO_SENSIVEL, { entidade, de } satisfies MarcaDeAcesso)
