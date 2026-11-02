import { erro, erroDe, ok, type Result } from './resultado'

/**
 * As invariantes de **quem tem acesso à clínica** — puras, sem I/O, as mesmas
 * no servidor e na tela.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POR QUE ELAS MORAM AQUI, E NÃO EM DOIS `if` NO SERVIÇO
 *
 * Medido no protótipo rodando (`demoApiBase`): a regra "a clínica não fica sem
 * administrativo ativo" existe em `excluirPessoa` — *"É preciso manter pelo
 * menos um administrativo ativo"* — e **não existe em `salvarPessoa`**, que é
 * o caminho pelo qual a tela desmarca "Ativa". E `login` exige `u.ativo`
 * (linha 1281). Então, no protótipo, a última administradora desmarca a
 * própria caixa, sai, e **ninguém da clínica abre Configurações de novo**: a
 * única saída é o superadmin.
 *
 * A mesma regra escrita em dois caminhos, divergindo num deles, é a herança
 * que o `CLAUDE.md` manda não atravessar. Aqui ela é **uma função**, e os dois
 * caminhos (desativar e rebaixar) a chamam.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * O mínimo que uma invariante de acesso precisa saber de uma pessoa.
 *
 * `admin` e `perfilId` viajam JUNTOS porque a restrição
 * `pessoa_tem_acesso_definido` (migration 0002) os amarra: admin tem
 * `perfil_id IS NULL`, e quem não é admin precisa de um. Um tipo que
 * permitisse os dois livres deixaria o domínio aceitar o que o banco recusa, e
 * a recusa chegaria à tela como erro de constraint.
 */
export type PessoaDaClinica = {
  readonly id: string
  readonly admin: boolean
  readonly perfilId: string | null
  readonly ativo: boolean
}

/** O acesso que se quer dar a alguém: administradora, ou um perfil. */
export type AcessoPretendido = {
  readonly admin: boolean
  readonly perfilId: string | null
}

/**
 * Códigos estáveis. A tela casa **código**, nunca texto — a frase muda com a
 * redação, o código não.
 */
export const MOTIVO_PESSOA = {
  EU_MESMA: 'NaoPodeDesativarASiMesma',
  ULTIMA_ADMIN: 'UltimaAdministradoraAtiva',
  PROPRIO_ADMIN: 'NaoPodeTirarOProprioAdmin',
  SEM_PERFIL: 'AcessoIndefinido',
  PERFIL_EM_USO: 'PerfilEmUso',
  EU_MESMA_EXCLUIR: 'NaoPodeExcluirASiMesma',
} as const

/**
 * Quantas administradoras **de pé** sobram se `alvo` deixar de ser uma.
 *
 * `ativo` entra na conta de propósito: admin inativa é admin que não entra
 * pela porta, e contá-la é como a clínica fica sem ninguém com a tela
 * acreditando que tem duas.
 */
const adminsAtivasSem = (equipe: readonly PessoaDaClinica[], alvoId: string): number =>
  equipe.filter((p) => p.admin && p.ativo && p.id !== alvoId).length

/**
 * Desativar (ou reativar) uma pessoa.
 *
 * `paraAtivo = true` passa pelas duas recusas sem checagem: ativar a si mesma
 * é impossível (quem está fora não chega à rota) e o mínimo de administradoras
 * só **sobe**. Escrever as duas direções na mesma função, com a assimetria
 * explícita, é melhor que duas funções — a segunda é a que esquece a regra.
 */
export function podeDesativar(
  alvo: PessoaDaClinica,
  quemFazId: string,
  equipe: readonly PessoaDaClinica[],
  paraAtivo = false,
): Result<void> {
  if (paraAtivo) return ok(undefined)

  if (alvo.id === quemFazId) {
    return erro(
      erroDe(
        MOTIVO_PESSOA.EU_MESMA,
        'Você não pode desativar o seu próprio acesso. Pessoa inativa não entra na ferramenta.',
      ),
    )
  }

  if (alvo.admin && adminsAtivasSem(equipe, alvo.id) === 0) {
    return erro(
      erroDe(
        MOTIVO_PESSOA.ULTIMA_ADMIN,
        'Esta é a única administradora ativa da clínica. Dê acesso de administrador ' +
          'a outra pessoa antes de desativar esta.',
      ),
    )
  }
  return ok(undefined)
}

/**
 * Trocar o acesso: de administradora para perfil, de perfil para perfil, ou de
 * perfil para administradora.
 *
 * A recusa de `SEM_PERFIL` é a restrição `pessoa_tem_acesso_definido` dita
 * **antes** do banco. Deixar o banco recusar funcionaria — ele é a camada que
 * não se engana — mas a mensagem que chega à tela seria um nome de constraint.
 */
export function podeTrocarAcesso(
  alvo: PessoaDaClinica,
  quemFazId: string,
  novo: AcessoPretendido,
  equipe: readonly PessoaDaClinica[],
): Result<void> {
  if (novo.admin === (novo.perfilId !== null)) {
    return erro(
      erroDe(
        MOTIVO_PESSOA.SEM_PERFIL,
        'Escolha o perfil de acesso, ou marque acesso de administrador — nunca os dois.',
      ),
    )
  }

  // Nada a conferir quando o acesso não sai de `admin`: promover alguém só
  // aumenta o número de administradoras.
  if (!alvo.admin || novo.admin) return ok(undefined)

  if (alvo.id === quemFazId) {
    return erro(
      erroDe(
        MOTIVO_PESSOA.PROPRIO_ADMIN,
        'Você não pode tirar o seu próprio acesso de administrador.',
      ),
    )
  }

  if (adminsAtivasSem(equipe, alvo.id) === 0) {
    return erro(
      erroDe(
        MOTIVO_PESSOA.ULTIMA_ADMIN,
        'Esta é a única administradora ativa da clínica. Dê acesso de administrador ' +
          'a outra pessoa antes de mudar o acesso desta.',
      ),
    )
  }
  return ok(undefined)
}

/**
 * **Excluir uma pessoa** — e excluir é SOFT DELETE (regra 20).
 *
 * O nome leva `Pessoa` porque `podeExcluir` já existe, e é de TAREFA
 * (`tarefa.ts`): "só quem pediu — ou quem acompanha a equipe". Duas funções
 * com o mesmo nome no barril de `@fir/domain` é ambiguidade de export, e o
 * compilador a recusa — o que é o resultado certo. `podeDesativar` e
 * `podeTrocarAcesso` seguem sem sufixo porque só existem para pessoa.
 *
 * As duas recusas são as mesmas de `podeDesativar`, pela razão óbvia: excluir
 * tira o acesso como desativar tira, e mais. Elas estão escritas aqui e não
 * delegadas a `podeDesativar` por um motivo que a MENSAGEM entrega — "antes de
 * desativar esta" numa tela cujo botão diz "Excluir" manda a pessoa procurar
 * um botão que ela não apertou.
 *
 * ## A assimetria que `podeDesativar` não tem, e ela é medida
 *
 * `alvo.ativo &&` na segunda recusa. Excluir alguém que **já está inativa**
 * não muda o número de administradoras ATIVAS — ela não estava na conta. Sem
 * esta condição, a clínica cuja única administradora está inativa (estado que
 * só o superadmin destrava) ficaria também impedida de **excluí-la**, com uma
 * mensagem que manda "dar acesso de administrador a outra pessoa antes" — por
 * uma tela que ninguém dessa clínica consegue abrir. A recusa seria um beco.
 *
 * `podeDesativar` não precisa da condição porque desativar quem já está
 * inativa não faz nada; aqui faz.
 */
export function podeExcluirPessoa(
  alvo: PessoaDaClinica,
  quemFazId: string,
  equipe: readonly PessoaDaClinica[],
): Result<void> {
  if (alvo.id === quemFazId) {
    return erro(
      erroDe(
        MOTIVO_PESSOA.EU_MESMA_EXCLUIR,
        'Você não pode excluir o seu próprio acesso. Quem o devolveria seria outra ' +
          'administradora.',
      ),
    )
  }

  if (alvo.admin && alvo.ativo && adminsAtivasSem(equipe, alvo.id) === 0) {
    return erro(
      erroDe(
        MOTIVO_PESSOA.ULTIMA_ADMIN,
        'Esta é a única administradora ativa da clínica. Dê acesso de administrador ' +
          'a outra pessoa antes de excluir esta.',
      ),
    )
  }
  return ok(undefined)
}

/**
 * Remover perfis da clínica — recusado enquanto alguém **ativo** os usa, e a
 * recusa **nomeia quem**.
 *
 * É a regra do `salvarPerfis` do protótipo, inclusive no filtro por `ativo`:
 * quem saiu da clínica não trava a reorganização dos perfis, e se voltar o
 * perfil é escolhido de novo. Nomear é o que torna o erro acionável — "há
 * pessoas usando" sem a lista obriga o admin a abrir seis fichas.
 */
export function podeRemoverPerfis(
  idsRemovidos: readonly string[],
  equipe: readonly PessoaDaClinica[],
  nomeDe: (pessoaId: string) => string,
): Result<void> {
  /**
   * `perfilId !== null` é o que exclui a administradora, e isso NÃO é economia
   * de uma linha: um `!p.admin` a mais passaria por redundante e
   * **sobreviveu à prova por mutação** — apagá-lo não mudou nenhum teste,
   * porque `pessoa_tem_acesso_definido` (0002) já garante
   * `admin ⇒ perfil_id IS NULL`. Cláusula que nenhum caso distingue é
   * cláusula que o próximo leitor acha que defende algo.
   */
  const presos = equipe.filter(
    (p) => p.ativo && p.perfilId !== null && idsRemovidos.includes(p.perfilId),
  )
  if (presos.length === 0) return ok(undefined)
  return erro(
    erroDe(
      MOTIVO_PESSOA.PERFIL_EM_USO,
      `Há pessoas usando um perfil que seria excluído: ${presos
        .map((p) => nomeDe(p.id))
        .join(', ')}. Troque o perfil delas antes.`,
    ),
  )
}

// ---------------------------------------------------------------------------
// COMO CHAMAR A PESSOA
// ---------------------------------------------------------------------------

/**
 * **O nome pelo qual a equipe chama a pessoa** — "Helena", "Dra. Helena".
 *
 * É o `primeiro()` do protótipo, e ele tem uma regra que `split(' ')[0]` não
 * tem: **título vem junto**. `"Dra. Helena Prado"` → `"Dra. Helena"`, não
 * `"Dra."`.
 *
 * **Medido no navegador, e foi assim que o defeito apareceu:** a lista de
 * pendentes da 1:1 mostrava *"Camila Rocha · com Dra."*, que não identifica
 * ninguém numa clínica com duas doutoras. A tela de conversas, a de senha
 * provisória, a faixa de aniversariantes e o toast de tarefa criada tinham
 * cada uma o seu `split(' ')[0]` — **cinco cópias da mesma regra, e as cinco
 * erradas do mesmo jeito**. É exatamente o que o `CLAUDE.md` descreve: a mesma
 * regra escrita em três lugares, e elas já divergiram.
 *
 * Mora no DOMÍNIO porque servidor e tela precisam dela: o servidor a usa em
 * `por` e `gestor` das conversas, a tela em todo lugar que fala com a pessoa
 * pelo nome. Uma função, como `temPerm`.
 *
 * Nome vazio devolve string vazia — quem chama decide o que pôr no lugar.
 */
const TITULOS: readonly string[] = ['dr.', 'dra.', 'sr.', 'sra.']

export function comoChamar(nome: string | null | undefined): string {
  const partes = String(nome ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => p !== '')
  const primeiro = partes[0]
  if (primeiro === undefined) return ''
  // O título sozinho não é um nome: ele só vale acompanhado do que vem
  // depois. `"Dra."` (e nada mais) devolve `"Dra."`, porque é tudo o que há.
  if (TITULOS.includes(primeiro.toLowerCase()) && partes[1] !== undefined) {
    return `${primeiro} ${partes[1]}`
  }
  return primeiro
}
