import { avaliarSenha, ehErro, gerarSenhaProvisoria, type ErroDeDominio } from '@fir/domain'
import type pg from 'pg'
import { semaforoArgon2 } from '../autenticacao/concorrencia'
import { hashDeSenha } from '../autenticacao/senha'

/**
 * A escrita de pessoa, **uma vez só**, para os dois caminhos que a fazem: o
 * admin da clínica (`/v1/pessoas`) e o superadmin (`/v1/superadmin/…`).
 *
 * Por que extrair: a regra é idêntica nos dois — provisória gerada no
 * servidor, hash fora de transação, perfil conferido pela RLS, 409 vindo do
 * índice único. O que muda é só o POOL e o ATOR. Duplicar isso é a herança
 * que esta arquitetura paga: a mesma regra em dois lugares, e a cópia que
 * ninguém revisa é a que esquece de derrubar as sessões.
 *
 * Tudo aqui recebe um `pg.PoolClient` **de uma transação já aberta**, com
 * `app.clinica_id` e `app.pessoa_id` fixados por quem chamou. Nada aqui abre
 * transação, e nada aqui escolhe o pool.
 */

/**
 * Setenta e duas horas, e o prazo é o ponto.
 *
 * Um papel no balcão que funciona para sempre é o PIN da v20 com outro nome
 * (D-0). Três dias cobrem o fim de semana entre a admissão e o primeiro turno
 * da pessoa, e não cobrem a gaveta.
 */
export const PROVISORIA_VALE_MS = 72 * 60 * 60 * 1000

/** Códigos de erro do Postgres que esta camada traduz, nunca `catch (e) {}`. */
const UNICIDADE_VIOLADA = '23505'

export class UsuarioJaExiste extends Error {}
export class PerfilNaoExiste extends Error {}
export class PessoaNaoExiste extends Error {}

export type Provisoria = {
  /**
   * A senha EM CLARO, **ou `null` quando quem redefiniu a escolheu**.
   *
   * `null` é o que impede a senha escolhida de voltar na resposta: ecoar de
   * volta o que o cliente acabou de enviar a põe no corpo de uma resposta — e
   * daí no log do proxy e no histórico do navegador — sem informar nada a
   * ninguém. Quem digitou já sabe. A gerada, ao contrário, **tem** de
   * atravessar: é a única vez que ela existe fora do hash.
   */
  readonly senha: string | null
  readonly hash: string
  readonly expiraEm: Date
}

/**
 * A provisória **gerada** — `senha` nunca é `null` aqui.
 *
 * O tipo estreito existe para a CRIAÇÃO de pessoa, que sempre gera: sem ele o
 * `PessoaCriada.senhaProvisoria` (que é `string`, não `string | null`) exigiria
 * um `!` ou um `as` em três lugares, e cada um deles seria uma afirmação sem
 * prova de que aquele caminho não escolhe a senha.
 */
export type ProvisoriaGerada = Provisoria & { readonly senha: string }

/** Recusa de senha fraca, com a frase do DOMÍNIO. */
export class SenhaFraca extends Error {
  constructor(readonly erroDeDominio: ErroDeDominio) {
    super(erroDeDominio.mensagem)
  }
}

/**
 * Gera a provisória e o hash — **fora de transação**, e isso é invariante.
 *
 * Com o semáforo de 4 e o pool de 10, cada requisição esperando vaga
 * seguraria uma conexão sem usá-la durante ~25 ms de Argon2. Medido na
 * revisão da branch: 445 de 900 logins responderam 500 por pool esgotado.
 */
export async function gerarProvisoria(agora: Date): Promise<ProvisoriaGerada> {
  const senha = gerarSenhaProvisoria()
  const hash = await semaforoArgon2.executar(() => hashDeSenha(senha))
  return { senha, hash, expiraEm: new Date(agora.getTime() + PROVISORIA_VALE_MS) }
}

/**
 * A provisória **escolhida** por quem redefine (decisão do dono, 2026-11-04).
 *
 * Continua provisória, com as mesmas 72 horas: quem a digitou passa a
 * conhecê-la, então ela é um bilhete de entrada, não a senha da pessoa. A
 * obrigação de trocar no primeiro acesso é o que mantém verdadeira a frase
 * "ninguém além dela sabe a senha dela" — e é dela que depende a trilha de
 * auditoria apontar para a pessoa certa.
 *
 * **A REGRA VEM ANTES DO HASH, e esta ordem é a invariante** — a mesma de
 * `trocarAPropriaSenha`. `hashDeSenha` custa 19 MiB e ~25 ms, e é o recurso
 * que o semáforo protege: hashear primeiro e julgar depois entregaria a quem
 * tem sessão de admin um jeito de consumir o semáforo inteiro com senhas que
 * nunca seriam aceitas — e colocaria a senha recusada dentro do Argon2 antes
 * de qualquer decisão sobre ela.
 *
 * `senha: null` na saída. Ver o comentário de `Provisoria`.
 */
export async function provisoriaEscolhida(
  agora: Date,
  escolhida: string,
  contexto: readonly string[],
): Promise<Provisoria> {
  // `deOutra`: a frase da recusa fala do nome DA PESSOA, nao de quem digita.
  const juizo = avaliarSenha(escolhida, { contexto, dono: 'deOutra' })
  if (ehErro(juizo)) throw new SenhaFraca(juizo.erro)

  const hash = await semaforoArgon2.executar(() => hashDeSenha(escolhida))
  return { senha: null, hash, expiraEm: new Date(agora.getTime() + PROVISORIA_VALE_MS) }
}

export type LinhaDePessoaCriada = {
  id: string
  nome: string
  usuario: string
  funcao: string
  admin: boolean
  perfil_id: string | null
}

/**
 * Insere a pessoa, já com a senha provisória.
 *
 * `perfilId: null` é **administradora da clínica** — a restrição
 * `pessoa_tem_acesso_definido` (0002) diz que admin não tem perfil e quem não
 * é admin precisa de um. Quem passa `null` aqui está criando uma admin, e só
 * o superadmin tem rota para isso (D-10, cadeia de criação).
 */
export async function inserirPessoa(
  c: pg.PoolClient,
  dados: {
    clinicaId: string
    nome: string
    usuario: string
    funcao: string
    perfilId: string | null
    provisoria: Provisoria
  },
): Promise<LinhaDePessoaCriada> {
  /**
   * O perfil é conferido DENTRO da transação, e é a RLS que responde.
   *
   * `pessoas.perfil_id` referencia `perfis(id)` sem a clínica junto — a chave
   * estrangeira aceitaria um perfil de OUTRA clínica. Quem recusa é esta
   * leitura, que roda sob `app.clinica_id` e devolve zero linhas para o
   * perfil da vizinha. Na mesma transação do `INSERT` para que a conferência
   * e o uso não possam divergir.
   */
  if (dados.perfilId !== null) {
    const perfil = await c.query('SELECT 1 FROM perfis WHERE id = $1', [dados.perfilId])
    if (perfil.rowCount === 0) throw new PerfilNaoExiste()
  }

  /**
   * O 409 de usuário repetido vem do ÍNDICE ÚNICO, nunca de um `SELECT`
   * antes do `INSERT`. Ler-depois-escrever cria as duas pessoas quando duas
   * recepcionistas cadastram ao mesmo tempo; é a razão escrita na `0006` e
   * vale igual aqui.
   */
  try {
    const r = await c.query<LinhaDePessoaCriada>(
      `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, admin, perfil_id,
                            senha_provisoria, senha_provisoria_expira_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
       RETURNING id, nome, usuario, funcao, admin, perfil_id`,
      [
        dados.clinicaId,
        dados.nome,
        dados.usuario,
        dados.funcao,
        dados.provisoria.hash,
        dados.perfilId === null,
        dados.perfilId,
        dados.provisoria.expiraEm,
      ],
    )
    return r.rows[0]!
  } catch (e) {
    if ((e as { code?: string }).code === UNICIDADE_VIOLADA) throw new UsuarioJaExiste()
    throw e
  }
}

/**
 * Troca a senha de OUTRA pessoa por uma provisória nova, e **derruba todas as
 * sessões dela**.
 *
 * A derrubada não é zelo: quem redefine o faz porque desconfia de que alguém
 * entrou, ou porque a pessoa perdeu o acesso. Uma redefinição que deixa a
 * sessão viva de pé não serve ao primeiro caso — que é justamente aquele em
 * que ela precisa servir.
 *
 * Sem clínica no `WHERE`: a RLS já a impõe, e a pessoa da vizinha
 * simplesmente não existe vista daqui — `rowCount` zero vira 404.
 *
 * `excluida_em IS NULL` pela mesma razão, e o defeito foi MEDIDO: sem ele,
 * redefinir a senha de quem a clínica excluiu respondia **200** e trocava a
 * senha de uma linha que nenhuma tela mostra. O sintoma no teste foi outro, e
 * é o que torna isto caro: a pessoa seguinte a tentar entrar com a senha
 * antiga tomava 401, e o 401 aparecia num teste que não tinha relação nenhuma
 * com exclusão. Quem saiu da clínica não é alvo de escrita nenhuma.
 */
export async function redefinirSenhaDePessoa(
  c: pg.PoolClient,
  pessoaId: string,
  provisoria: Provisoria,
): Promise<void> {
  const r = await c.query(
    `UPDATE pessoas
        SET senha_hash = $1, senha_provisoria = true, senha_provisoria_expira_em = $2
      WHERE id = $3 AND excluida_em IS NULL`,
    [provisoria.hash, provisoria.expiraEm, pessoaId],
  )
  if (r.rowCount === 0) throw new PessoaNaoExiste()

  await c.query(
    `UPDATE sessoes SET revogada_em = now() WHERE pessoa_id = $1 AND revogada_em IS NULL`,
    [pessoaId],
  )
}

/**
 * **EXCLUIR uma pessoa — soft delete, e os três efeitos juntos.**
 *
 * Um `UPDATE` só, com os três campos, e a razão é a mesma do `editar`: dois
 * `UPDATE` separados deixariam a trilha com dois eventos para uma ação, e o
 * segundo poderia não acontecer.
 *
 *  - `excluida_em` é o estado novo: ela sai da lista e de toda escolha.
 *  - `ativo = false` **tem** de vir junto, e o `CHECK
 *    pessoa_excluida_esta_inativa` (0023) o cobra. Sem ele, a pessoa ficaria
 *    fora de toda tela e **ainda entrando** — `entrar` filtra `ativo`, não
 *    `excluida_em`. Acesso sem supervisão, porque nenhuma tela a mostra para
 *    alguém desativar.
 *  - `desativada_em` segue `ativo` pelo `CHECK pessoa_desativada_tem_instante`
 *    (0014), e `coalesce` preserva o instante de quem já estava inativa: a
 *    pergunta "desde quando ela está fora" não muda de resposta porque alguém
 *    arrumou a lista seis meses depois.
 *
 * E as sessões caem. "Tirei o acesso dela" tem de ser verdade no instante do
 * toque — é a mesma razão do `desativar`, e aqui vale mais.
 *
 * **IDEMPOTENTE pelo `WHERE`:** `excluida_em IS NULL` faz a segunda chamada
 * afetar zero linhas e virar `PessoaNaoExiste` (404). Sem isso, excluir duas
 * vezes reescreveria `excluida_em` e a trilha registraria uma exclusão que não
 * aconteceu.
 *
 * Sem cláusula de clínica: a RLS já a impõe, e a pessoa da vizinha
 * simplesmente não existe vista daqui.
 */
export async function excluirPessoa(c: pg.PoolClient, pessoaId: string): Promise<void> {
  const r = await c.query(
    `UPDATE pessoas
        SET excluida_em   = now(),
            ativo         = false,
            desativada_em = coalesce(desativada_em, now())
      WHERE id = $1 AND excluida_em IS NULL`,
    [pessoaId],
  )
  if (r.rowCount === 0) throw new PessoaNaoExiste()

  await c.query(
    'UPDATE sessoes SET revogada_em = now() WHERE pessoa_id = $1 AND revogada_em IS NULL',
    [pessoaId],
  )
}

/**
 * **EDITAR** nome, função e acesso — o mesmo `UPDATE` para a clínica e para o
 * painel.
 *
 * O painel precisava dele e não tinha: a tela de pessoas do painel só criava
 * administradora e redefinia senha, então corrigir o nome de alguém exigia
 * entrar na clínica. Escrever um segundo `UPDATE` lá seria a mesma regra em
 * dois lugares — e a cópia que ninguém revisa é a que esquece de derrubar as
 * sessões ao desativar.
 *
 * `coalesce` em cada campo: o que não veio não muda. Montar o SQL por
 * concatenação conforme os campos presentes é o caminho que acaba interpolando
 * nome de coluna.
 *
 * **`usuario` NÃO está aqui, e é decisão de produto.** Ele é ditado por
 * telefone, é o nome pelo qual a equipe chama a pessoa, e é a chave de
 * `tentativas_login.identificador` — trocá-lo quebraria o que ela decorou e
 * misturaria o histórico de bloqueio de duas contas. Ver `CONTEXT.md`,
 * `Pessoa`: *"um identificador de login não tem valor de exibição"*.
 *
 * Quem chama **já conferiu as invariantes do domínio** (`podeTrocarAcesso`,
 * `podeDesativar`): esta função escreve, não julga. A ordem importa e está nos
 * dois chamadores.
 */
export async function editarPessoa(
  c: pg.PoolClient,
  pessoaId: string,
  dados: {
    readonly nome?: string | undefined
    readonly funcao?: string | undefined
    readonly admin?: boolean | undefined
    readonly perfilId?: string | null | undefined
    readonly ativo?: boolean | undefined
  },
): Promise<LinhaDePessoaEditada> {
  const r = await c.query<LinhaDePessoaEditada>(
    `UPDATE pessoas
        SET nome      = coalesce($2, nome),
            funcao    = coalesce($3, funcao),
            admin     = coalesce($4, admin),
            perfil_id = CASE WHEN $4::boolean IS NULL THEN perfil_id
                             WHEN $4 THEN NULL ELSE $5 END,
            ativo     = coalesce($6, ativo),
            desativada_em = CASE WHEN coalesce($6, ativo) THEN NULL
                                 ELSE coalesce(desativada_em, now()) END
      WHERE id = $1 AND excluida_em IS NULL
      RETURNING id, nome, usuario, funcao, admin, perfil_id, ativo,
                senha_provisoria, senha_provisoria_expira_em`,
    [
      pessoaId,
      dados.nome ?? null,
      dados.funcao ?? null,
      dados.admin ?? null,
      dados.admin === undefined || dados.admin ? null : (dados.perfilId ?? null),
      dados.ativo ?? null,
    ],
  )
  const linha = r.rows[0]
  if (linha === undefined) throw new PessoaNaoExiste()

  /**
   * Desativar **DERRUBA AS SESSÕES**, e isto não é zelo.
   *
   * Sem isto, a pessoa desativada continua trabalhando até o cookie vencer.
   * "Tirei o acesso dela" tem de ser verdade no instante em que o admin toca o
   * botão, senão a clínica que demitiu alguém às 14h descobre às 18h que ela
   * esteve na ferramenta a tarde inteira.
   */
  if (dados.ativo === false) {
    await c.query(
      'UPDATE sessoes SET revogada_em = now() WHERE pessoa_id = $1 AND revogada_em IS NULL',
      [pessoaId],
    )
  }
  return linha
}

export type LinhaDePessoaEditada = {
  id: string
  nome: string
  usuario: string
  funcao: string
  admin: boolean
  perfil_id: string | null
  ativo: boolean
  senha_provisoria: boolean
  senha_provisoria_expira_em: Date | null
}
