import type { CriarPessoaEntrada, PessoaCriada, SenhaRedefinida } from '@fir/contracts'
import { gerarSenhaProvisoria } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { semaforoArgon2 } from '../autenticacao/concorrencia'
import { hashDeSenha } from '../autenticacao/senha'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import type { ContextoDaRequisicao } from '../comum/contexto'

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

@Injectable()
export class PessoasService {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * A provisória existe em UMA variável: atravessa para o hash e para a
   * resposta, e acaba. Nenhuma coluna a guarda, nenhum log a vê, e a denylist
   * de `auditoria_sem_segredos` já cobre `senha_hash`.
   *
   * O hash roda FORA de transação, como em `entrar` e pela mesma razão
   * medida lá: com o semáforo de 4 e o pool de 10, cada requisição esperando
   * vaga seguraria uma conexão sem usá-la.
   */
  async criar(contexto: ContextoDaRequisicao, dados: CriarPessoaEntrada): Promise<PessoaCriada> {
    const provisoria = gerarSenhaProvisoria()
    const hash = await semaforoArgon2.executar(() => hashDeSenha(provisoria))
    const expiraEm = new Date(this.relogio.agora().getTime() + PROVISORIA_VALE_MS)

    const linha = await this.banco.naClinica(contexto.clinicaId, contexto.ator, async (c) => {
      /**
       * O perfil é conferido DENTRO da transação, e é a RLS que responde.
       *
       * `pessoas.perfil_id` referencia `perfis(id)` sem a clínica junto — a
       * chave estrangeira aceitaria um perfil de OUTRA clínica. Quem recusa é
       * esta leitura, que roda sob `app.clinica_id` e devolve zero linhas
       * para o perfil da vizinha. Na mesma transação do `INSERT` para que a
       * conferência e o uso não possam divergir.
       */
      const perfil = await c.query('SELECT 1 FROM perfis WHERE id = $1', [dados.perfilId])
      if (perfil.rowCount === 0) throw new PerfilNaoExiste()

      /**
       * O 409 de usuário repetido vem do ÍNDICE ÚNICO, nunca de um `SELECT`
       * antes do `INSERT`. Ler-depois-escrever cria as duas pessoas quando
       * duas recepcionistas cadastram ao mesmo tempo; é a razão escrita na
       * `0006` e vale igual aqui.
       */
      try {
        const r = await c.query<{
          id: string
          nome: string
          usuario: string
          funcao: string
          perfil_id: string | null
        }>(
          `INSERT INTO pessoas (clinica_id, nome, usuario, funcao, senha_hash, perfil_id,
                                senha_provisoria, senha_provisoria_expira_em)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7)
           RETURNING id, nome, usuario, funcao, perfil_id`,
          [
            contexto.clinicaId,
            dados.nome,
            dados.usuario,
            dados.funcao,
            hash,
            dados.perfilId,
            expiraEm,
          ],
        )
        return r.rows[0]!
      } catch (e) {
        if ((e as { code?: string }).code === UNICIDADE_VIOLADA) throw new UsuarioJaExiste()
        throw e
      }
    })

    return {
      id: linha.id,
      nome: linha.nome,
      usuario: linha.usuario,
      funcao: linha.funcao,
      perfilId: linha.perfil_id,
      senhaProvisoria: provisoria,
      senhaProvisoriaExpiraEm: expiraEm.toISOString(),
    }
  }

  /**
   * Redefine a senha de OUTRA pessoa — e quem redefine nunca vê a senha que a
   * pessoa tinha, porque ela nunca existiu em lugar nenhum além do hash.
   *
   * DERRUBA TODAS as sessões da pessoa, e isto não é zelo: quem redefine o faz
   * porque desconfia de que alguém entrou, ou porque a pessoa perdeu o acesso.
   * Uma redefinição que deixa a sessão viva de pé não serve ao primeiro caso —
   * que é justamente aquele em que ela precisa servir.
   */
  async redefinirSenha(
    contexto: ContextoDaRequisicao,
    pessoaId: string,
  ): Promise<SenhaRedefinida> {
    const provisoria = gerarSenhaProvisoria()
    const hash = await semaforoArgon2.executar(() => hashDeSenha(provisoria))
    const expiraEm = new Date(this.relogio.agora().getTime() + PROVISORIA_VALE_MS)

    await this.banco.naClinica(contexto.clinicaId, contexto.ator, async (c) => {
      // Sem clínica no `WHERE`: a RLS já a impõe, e a pessoa da vizinha
      // simplesmente não existe vista daqui — `rowCount` zero vira 404.
      const r = await c.query(
        `UPDATE pessoas
            SET senha_hash = $1, senha_provisoria = true, senha_provisoria_expira_em = $2
          WHERE id = $3`,
        [hash, expiraEm, pessoaId],
      )
      if (r.rowCount === 0) throw new PessoaNaoExiste()

      await c.query(
        `UPDATE sessoes SET revogada_em = now()
          WHERE pessoa_id = $1 AND revogada_em IS NULL`,
        [pessoaId],
      )
    })

    return {
      id: pessoaId,
      senhaProvisoria: provisoria,
      senhaProvisoriaExpiraEm: expiraEm.toISOString(),
    }
  }
}
