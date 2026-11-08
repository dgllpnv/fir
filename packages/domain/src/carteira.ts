/**
 * A carteira comercial da Firmare (ADRs 0011, 0012, 0013). G1a: só a lógica
 * de domínio pura, sem I/O — o espelho em banco é a migration 0025.
 *
 * `UsuarioDeGestao` não é uma `Pessoa` nem um `Operador`: é o terceiro ator,
 * dono de um `Escopo`. O banco já cobra a invariante (`usuarios_gestao_escopo_grupo`,
 * migration 0025); esta função cobra a MESMA invariante no lado do domínio,
 * para que um objeto inválido nunca chegue a existir em memória — defeito
 * encontrado no construtor, não na constraint.
 */

export type Escopo = 'geral' | 'grupo'

export type UsuarioDeGestao = {
  readonly id: string
  readonly escopo: Escopo
  readonly grupoId: string | null
  readonly ativo: boolean
}

/**
 * Constrói um `UsuarioDeGestao` válido, ou lança.
 *
 * Mesma regra que `usuarios_gestao_escopo_grupo`: `escopo = 'grupo'` exige
 * `grupoId`; `escopo = 'geral'` exige a ausência dele. Nunca os dois, nunca
 * nenhum dos dois — não há "superadmin com grupo preferido" nem "usuário de
 * grupo sem grupo".
 */
export function criarUsuarioDeGestao(args: {
  id: string
  escopo: Escopo
  grupoId: string | null
  ativo: boolean
}): UsuarioDeGestao {
  const temGrupo = args.grupoId !== null
  if (args.escopo === 'grupo' && !temGrupo) {
    throw new Error('usuário de gestão com escopo=grupo precisa de grupoId')
  }
  if (args.escopo === 'geral' && temGrupo) {
    throw new Error('usuário de gestão com escopo=geral não pode ter grupoId')
  }
  return { id: args.id, escopo: args.escopo, grupoId: args.grupoId, ativo: args.ativo }
}

/**
 * P-12: pode este usuário de gestão ler dado do grupo informado?
 *
 * `geral` vê qualquer grupo (é o superadmin operando a carteira). `grupo` vê
 * só o próprio. Um usuário inativo nunca vê nada — é o mecanismo de
 * revogação checado a cada chamada (migration 0025, comentário de
 * `usuarios_gestao.ativo`), não só no login.
 */
export function podeVerGrupo(usuario: UsuarioDeGestao, grupoId: string): boolean {
  if (!usuario.ativo) return false
  if (usuario.escopo === 'geral') return true
  return usuario.grupoId === grupoId
}

/* ────────────────────────────────────────────────────────────────────────
 * G8 0.5 — O PERFIL DO `Usuário de Gestão` E `temPermCarteira` (item T1).
 *
 * O protótipo (`index.html` L517, L1109-1120, L2772-2775) dá a cada pessoa da
 * equipe: `papel` (admin = Diretoria, acesso total · colaboradora), `modulos`
 * (as 9 telas), `carteira` (minha · todos), `valores`, `setor`, `funcao`,
 * `telefone`. Aqui, com os ajustes do gate de segurança:
 *
 *  - "Acesso total" NÃO é um `if (papel === 'admin') return true` (A-2): é o
 *    conjunto completo de chaves, gravado explícito, e continua sujeito a
 *    `escopo`, à RLS e à lista "só escopo geral" (A-5).
 *  - A Diretoria recebe do Operador a chave `carteira.administrar` (D-22
 *    item 2, A-9): arquivar, editar conteúdo e configuração, compartilhar
 *    todas as reuniões, redistribuir tarefas. Nunca identidade.
 *  - As dependências entre chaves vivem NA TABELA (`PERMS_CARTEIRA`), no
 *    mesmo molde de `PERMS`/`temPerm`. `mensalidades` exige `valores` (A-4):
 *    conceder uma sem a outra produz um usuário que não entra.
 *  - `setor` nunca é autorização (A-4): decide só quem recebe item de
 *    checklist. Ele não entra em `PerfilDaCarteira`, e o teste prova.
 * ──────────────────────────────────────────────────────────────────────── */

/** As 9 telas do protótipo, na ordem e com os rótulos dele (`MODULOS`, L517). */
export const MODULOS_DA_CARTEIRA = [
  ['painel', 'Visão geral'],
  ['rotina', 'Minhas tarefas'],
  ['clientes', 'Carteira de clientes'],
  ['firclinic', 'FIR Clinic'],
  ['metas', 'Metas'],
  ['campanhas', 'Campanhas'],
  ['resumo', 'Resumo semanal'],
  ['prospeccao', 'Prospecção'],
  ['cadastros', 'Administração'],
] as const

export type ModuloDaCarteira = (typeof MODULOS_DA_CARTEIRA)[number][0]

export const CHAVES_DE_MODULO: readonly ModuloDaCarteira[] = MODULOS_DA_CARTEIRA.map((m) => m[0])

export const ehModuloDaCarteira = (x: string): x is ModuloDaCarteira =>
  (CHAVES_DE_MODULO as readonly string[]).includes(x)

/** `SETORES` (L562). Decide quem recebe item de checklist; nunca autoriza nada. */
export const SETORES_DA_CARTEIRA = [
  ['diretoria', 'Diretoria'],
  ['comercial', 'Comercial'],
  ['administrativo', 'Administrativo'],
  ['financeiro', 'Financeiro'],
] as const

export type SetorDaCarteira = (typeof SETORES_DA_CARTEIRA)[number][0]

/** "Clientes que vê" (L2775): `minha` = só onde é a responsável · `todos`. */
export type AlcanceDaCarteira = 'minha' | 'todos'

/**
 * O que `temPermCarteira` precisa saber. Lido do banco a CADA requisição
 * (`contextoDoToken`), nunca do token nem do cookie (A-2).
 */
export type PerfilDaCarteira = {
  readonly escopo: Escopo
  readonly valores: boolean
  readonly carteira: AlcanceDaCarteira
  readonly modulos: readonly string[]
  readonly administrar: boolean
}

type OrigemDaChave = 'modulo' | 'bit' | 'sempre' | 'derivada'

/**
 * A tabela de chaves da carteira. Tupla:
 * `[chave, rótulo, origem, dependências, sóEscopoGeral]`.
 *
 *  - `modulo`: concedida quando a tela está em `modulos`.
 *  - `bit`: concedida pelo campo próprio do perfil.
 *  - `sempre`: toda sessão ativa (o protótipo libera o Método a qualquer
 *    pessoa ativa, `can()` L1116).
 *  - `derivada`: não se concede; existe quando as dependências existem.
 *
 * `sóEscopoGeral` (A-5): enquanto o dono não disser se o `Usuário de Gestão`
 * de `escopo='grupo'` pode ser alguém do lado da rede-cliente, o que é de uso
 * interno da Firmare (MRR e carga da equipe na Visão geral, o resumo da
 * equipe, Administração e a administração do conteúdo) é NEGADO a ele, por
 * mais que esteja gravado. Negar por padrão, como o gate manda.
 */
export const PERMS_CARTEIRA = [
  ['painel', 'Visão geral', 'modulo', [], true],
  ['rotina', 'Minhas tarefas', 'modulo', [], false],
  ['clientes', 'Carteira de clientes', 'modulo', [], false],
  ['firclinic', 'FIR Clinic', 'modulo', [], false],
  ['metas', 'Metas', 'modulo', [], false],
  ['campanhas', 'Campanhas', 'modulo', [], false],
  ['resumo', 'Resumo semanal', 'modulo', [], true],
  ['prospeccao', 'Prospecção', 'modulo', [], false],
  ['cadastros', 'Administração', 'modulo', [], true],
  ['metodo', 'Método Firmare', 'sempre', [], false],
  ['valores', 'Vê valores e receita', 'bit', [], false],
  ['carteira.todos', 'Vê todas as clientes', 'bit', [], false],
  ['carteira.administrar', 'Administra o conteúdo da carteira', 'bit', [], true],
  ['mensalidades', 'Mensalidades do mês', 'derivada', ['valores'], false],
] as const satisfies readonly (readonly [string, string, OrigemDaChave, readonly string[], boolean])[]

export type ChaveDaCarteira = (typeof PERMS_CARTEIRA)[number][0]

type LinhaDaChave = readonly [ChaveDaCarteira, string, OrigemDaChave, readonly ChaveDaCarteira[], boolean]

const linhaDaChave = new Map<string, LinhaDaChave>(PERMS_CARTEIRA.map((p) => [p[0], p]))

const concedidaPeloPerfil = (perfil: PerfilDaCarteira, linha: LinhaDaChave): boolean => {
  const chave = linha[0]
  switch (linha[2]) {
    case 'modulo':
      return perfil.modulos.includes(chave)
    case 'sempre':
    case 'derivada':
      return true
    case 'bit':
      if (chave === 'valores') return perfil.valores
      if (chave === 'carteira.todos') return perfil.carteira === 'todos'
      if (chave === 'carteira.administrar') return perfil.administrar
      return false
  }
}

/**
 * A MESMA função no servidor e na tela (regra 16). Sem perfil, nega.
 *
 * Ordem: (1) a chave existe na tabela; (2) `escopo='grupo'` nunca recebe uma
 * chave "só escopo geral"; (3) cada dependência declarada vale, recursiva;
 * (4) a chave em si foi concedida. Não há atalho de "acesso total".
 */
export function temPermCarteira(perfil: PerfilDaCarteira | null | undefined, chave: ChaveDaCarteira): boolean {
  if (!perfil) return false
  const linha = linhaDaChave.get(chave)
  if (!linha) return false
  if (linha[4] && perfil.escopo !== 'geral') return false
  for (const dep of linha[3]) {
    if (!temPermCarteira(perfil, dep)) return false
  }
  return concedidaPeloPerfil(perfil, linha)
}

/**
 * "Só a minha carteira" (A-3), resolvida pela sessão e nunca por parâmetro:
 * o id de responsável que toda leitura de cliente impõe no `WHERE`, ou `null`
 * para não restringir. Um ponto só: lista, ficha, painel de mensalidades,
 * leads e rotina leem daqui.
 */
export function responsavelImpostoPeloPerfil(perfil: PerfilDaCarteira & { readonly id: string }): string | null {
  return temPermCarteira(perfil, 'carteira.todos') ? null : perfil.id
}

/**
 * O perfil "Diretoria (acesso total)" do protótipo (L2773), escrito por
 * extenso: é o que a tela do superadmin grava quando o Operador escolhe esse
 * perfil. "Acesso total" é este conjunto, nunca um atalho (A-2), e para
 * `escopo='grupo'` ele não inclui `carteira.administrar` (A-5).
 */
export function perfilDeAcessoTotal(escopo: Escopo): Omit<PerfilDaCarteira, 'escopo'> {
  return {
    valores: true,
    carteira: 'todos',
    modulos: [...CHAVES_DE_MODULO],
    administrar: escopo === 'geral',
  }
}

/** O perfil de uma colaboradora nova no protótipo (`novoMembro`, L2965). */
export const PERFIL_DE_COLABORADORA_NOVA: Omit<PerfilDaCarteira, 'escopo'> = {
  valores: false,
  carteira: 'minha',
  modulos: ['clientes', 'rotina'],
  administrar: false,
}

/** O perfil gravado é o "acesso total" por inteiro? (a tela mostra o chip). */
export function ehAcessoTotal(perfil: PerfilDaCarteira): boolean {
  const total = perfilDeAcessoTotal(perfil.escopo)
  return (
    perfil.valores &&
    perfil.carteira === 'todos' &&
    perfil.administrar === total.administrar &&
    CHAVES_DE_MODULO.every((m) => perfil.modulos.includes(m))
  )
}
