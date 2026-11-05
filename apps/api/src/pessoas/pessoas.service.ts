import type { CriarPessoaEntrada, PessoaCriada, SenhaRedefinida } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import type { ContextoDaRequisicao } from '../comum/contexto'
import {
  gerarProvisoria,
  inserirPessoa,
  provisoriaEscolhida,
  redefinirSenhaDePessoa,
} from './escrita-de-pessoa'

/**
 * O ADMIN DA CLÍNICA cria pessoa e redefine senha — e nunca vê.
 *
 * A regra de escrita mora em `escrita-de-pessoa.ts`, compartilhada com o
 * painel do superadmin: o que muda entre os dois é o POOL e o ATOR, nunca a
 * regra. Duplicá-la é como a cópia que ninguém revisa esquece de derrubar as
 * sessões.
 */
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
   * `perfilId` é obrigatório no contrato: o admin da clínica cria a EQUIPE
   * dela. Quem cria ADMIN é o superadmin (D-10, cadeia de criação).
   */
  async criar(contexto: ContextoDaRequisicao, dados: CriarPessoaEntrada): Promise<PessoaCriada> {
    const provisoria = await gerarProvisoria(this.relogio.agora())

    const linha = await this.banco.naClinica(contexto.clinicaId, contexto.ator, (c) =>
      inserirPessoa(c, {
        clinicaId: contexto.clinicaId,
        nome: dados.nome,
        usuario: dados.usuario,
        funcao: dados.funcao,
        perfilId: dados.perfilId,
        provisoria,
      }),
    )

    return {
      id: linha.id,
      nome: linha.nome,
      usuario: linha.usuario,
      funcao: linha.funcao,
      perfilId: linha.perfil_id,
      senhaProvisoria: provisoria.senha,
      senhaProvisoriaExpiraEm: provisoria.expiraEm.toISOString(),
    }
  }

  /**
   * Redefine a senha de OUTRA pessoa — gerada pelo servidor **ou escolhida por
   * quem redefine** (decisão do dono, 2026-11-04).
   *
   * Quem redefine nunca vê a senha que a pessoa tinha: ela nunca existiu em
   * lugar nenhum além do hash. O que mudou é poder DITAR a nova — porque a
   * gerada se perdia: ela aparece uma vez e quem fechou o modal antes de
   * anotar não tinha como recuperá-la.
   *
   * **A escolhida continua provisória.** Quem a digitou passa a conhecê-la,
   * então ela é um bilhete de entrada e não a senha da pessoa.
   *
   * O CONTEXTO da regra de força é o de quem vai USAR a senha, não de quem a
   * digitou: proibir o nome da clínica, o nome e o usuário **dela**. Um admin
   * escolhendo `joice2026` para a Joice é exatamente o caso, e ele só é pego
   * se o nome da pessoa-alvo entrar no contexto.
   */
  async redefinirSenha(
    contexto: ContextoDaRequisicao,
    pessoaId: string,
    escolhida?: string,
  ): Promise<SenhaRedefinida> {
    const agora = this.relogio.agora()
    const provisoria =
      escolhida === undefined
        ? await gerarProvisoria(agora)
        : await provisoriaEscolhida(agora, escolhida, [
            contexto.clinicaCodigo,
            contexto.clinicaNome,
            ...(await this.contextoDaPessoa(contexto, pessoaId)),
          ])

    await this.banco.naClinica(contexto.clinicaId, contexto.ator, (c) =>
      redefinirSenhaDePessoa(c, pessoaId, provisoria),
    )

    return {
      id: pessoaId,
      senhaProvisoria: provisoria.senha,
      senhaProvisoriaExpiraEm: provisoria.expiraEm.toISOString(),
    }
  }

  /**
   * Nome e usuário da pessoa-alvo, para a regra de força.
   *
   * `excluida_em IS NULL` aqui também: sem o filtro, redefinir a senha de quem
   * a clínica excluiu LERIA o nome dela para montar o contexto, e a recusa
   * seguinte viria de `redefinirSenhaDePessoa`. Devolver vazio e deixar o
   * `UPDATE` recusar mantém o 404 como a única resposta desse caminho.
   */
  private async contextoDaPessoa(
    contexto: ContextoDaRequisicao,
    pessoaId: string,
  ): Promise<string[]> {
    const r = await this.banco.naClinica(contexto.clinicaId, contexto.ator, (c) =>
      c.query<{ nome: string; usuario: string }>(
        'SELECT nome, usuario FROM pessoas WHERE id = $1 AND excluida_em IS NULL',
        [pessoaId],
      ),
    )
    const l = r.rows[0]
    return l === undefined ? [] : [l.nome, l.usuario]
  }
}

export {
  PerfilNaoExiste,
  SenhaFraca,
  PessoaNaoExiste,
  PROVISORIA_VALE_MS,
  UsuarioJaExiste,
} from './escrita-de-pessoa'
