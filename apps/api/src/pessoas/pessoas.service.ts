import type { CriarPessoaEntrada, PessoaCriada, SenhaRedefinida } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import type { ContextoDaRequisicao } from '../comum/contexto'
import { gerarProvisoria, inserirPessoa, redefinirSenhaDePessoa } from './escrita-de-pessoa'

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
   * Redefine a senha de OUTRA pessoa — e quem redefine nunca vê a senha que a
   * pessoa tinha, porque ela nunca existiu em lugar nenhum além do hash.
   */
  async redefinirSenha(
    contexto: ContextoDaRequisicao,
    pessoaId: string,
  ): Promise<SenhaRedefinida> {
    const provisoria = await gerarProvisoria(this.relogio.agora())

    await this.banco.naClinica(contexto.clinicaId, contexto.ator, (c) =>
      redefinirSenhaDePessoa(c, pessoaId, provisoria),
    )

    return {
      id: pessoaId,
      senhaProvisoria: provisoria.senha,
      senhaProvisoriaExpiraEm: provisoria.expiraEm.toISOString(),
    }
  }
}

export {
  PerfilNaoExiste,
  PessoaNaoExiste,
  PROVISORIA_VALE_MS,
  UsuarioJaExiste,
} from './escrita-de-pessoa'
