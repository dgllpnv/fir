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
export type EntidadeSensivel = 'auditoria' | 'pacientes' | 'pessoas'

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
