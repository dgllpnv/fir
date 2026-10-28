import { gerarSenhaProvisoria } from '@fir/domain'
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
  /** A senha EM CLARO. Atravessa para o hash e para a resposta, e acaba. */
  readonly senha: string
  readonly hash: string
  readonly expiraEm: Date
}

/**
 * Gera a provisória e o hash — **fora de transação**, e isso é invariante.
 *
 * Com o semáforo de 4 e o pool de 10, cada requisição esperando vaga
 * seguraria uma conexão sem usá-la durante ~25 ms de Argon2. Medido na
 * revisão da branch: 445 de 900 logins responderam 500 por pool esgotado.
 */
export async function gerarProvisoria(agora: Date): Promise<Provisoria> {
  const senha = gerarSenhaProvisoria()
  const hash = await semaforoArgon2.executar(() => hashDeSenha(senha))
  return { senha, hash, expiraEm: new Date(agora.getTime() + PROVISORIA_VALE_MS) }
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
 */
export async function redefinirSenhaDePessoa(
  c: pg.PoolClient,
  pessoaId: string,
  provisoria: Provisoria,
): Promise<void> {
  const r = await c.query(
    `UPDATE pessoas
        SET senha_hash = $1, senha_provisoria = true, senha_provisoria_expira_em = $2
      WHERE id = $3`,
    [provisoria.hash, provisoria.expiraEm, pessoaId],
  )
  if (r.rowCount === 0) throw new PessoaNaoExiste()

  await c.query(
    `UPDATE sessoes SET revogada_em = now() WHERE pessoa_id = $1 AND revogada_em IS NULL`,
    [pessoaId],
  )
}
