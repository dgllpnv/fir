import type { CriarPessoaEntrada, PessoaCriada, SenhaRedefinida } from '@fir/contracts'
import {
  podeAgirSobre,
  podeAtribuirPerfil,
  podeConcederAdministracao,
  podeEscolherSenhaDe,
  type PessoaDaClinica,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { AcessoPorEmailService } from '../acesso/acesso-por-email.service'
import { emitirLink, gravarEvento } from '../acesso/links'
import { pessoaDoAtor } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { atorDeAcessoDoContexto, type ContextoDaRequisicao } from '../comum/contexto'
import {
  exigirDominio,
  lerAtorDeAcesso,
  lerPerfisDoDominio,
  travarAcessoDaClinica,
} from './acesso-do-ator'
import {
  gerarProvisoria,
  hashDoConvite,
  inserirPessoa,
  PessoaNaoExiste,
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
    @Inject(AcessoPorEmailService) private readonly acessoPorEmail: AcessoPorEmailService,
  ) {}

  /**
   * A provisória existe em UMA variável: atravessa para o hash e para a
   * resposta, e acaba. Nenhuma coluna a guarda, nenhum log a vê, e a denylist
   * de `auditoria_sem_segredos` já cobre `senha_hash`.
   *
   * **Quem cria administradora é administradora** (ou o Operador): o contrato
   * aceita `acesso: { admin: true }`, e `podeConcederAdministracao` decide —
   * `config` sozinho não basta. Quem não é admin só atribui perfil cujas
   * chaves ela própria tem (`podeAtribuirPerfil`). O ator é relido DENTRO da
   * transação, depois do lock da clínica (`travarAcessoDaClinica`).
   */
  async criar(contexto: ContextoDaRequisicao, dados: CriarPessoaEntrada): Promise<PessoaCriada> {
    /**
     * **Dois caminhos, decididos pelo envio** (spec 2.1 e 5, ADR 2026-11-16):
     *
     *  - LIGADO: nasce convidada, sem provisória, e o convite de 7 dias vai
     *    para o e-mail. Ninguém além dela chega a conhecer a senha dela.
     *  - DESLIGADO: o caminho de hoje, a provisória — e o e-mail fica guardado
     *    PENDENTE, para a pessoa confirmá-lo quando o envio ligar.
     */
    const convidando = this.acessoPorEmail.ligado
    const agora = this.relogio.agora()
    const gerada = convidando ? null : await gerarProvisoria(agora)
    const provisoria = gerada ?? { senha: null, hash: await hashDoConvite(), expiraEm: agora }

    const criada = await this.banco.naClinica(contexto.clinicaId, contexto.ator, async (c) => {
      await travarAcessoDaClinica(c, contexto.clinicaId)
      const ator = await lerAtorDeAcesso(c, contexto.ator)
      exigirDominio(podeConcederAdministracao(ator, null, dados.acesso.admin))
      if (!dados.acesso.admin) {
        exigirDominio(
          podeAtribuirPerfil(ator, await lerPerfisDoDominio(c), dados.acesso.perfilId, null),
        )
      }
      const linha = await inserirPessoa(c, {
        clinicaId: contexto.clinicaId,
        nome: dados.nome,
        usuario: dados.usuario,
        funcao: dados.funcao,
        perfilId: dados.acesso.admin ? null : dados.acesso.perfilId,
        provisoria,
        emailPendente: dados.email,
        aguardandoPrimeiraSenha: convidando,
      })
      if (!convidando) return { linha, token: null }
      // O convite nasce na MESMA transação da pessoa: sem pessoa, sem link; e
      // sem link, sem pessoa presa em `aguardando_primeira_senha`.
      const token = await emitirLink(c, {
        clinicaId: contexto.clinicaId,
        pessoaId: linha.id,
        finalidade: 'convite',
        emailHmac: this.acessoPorEmail.hmacDoEmail(dados.email),
        agora,
      })
      await gravarEvento(c, {
        clinicaId: contexto.clinicaId,
        pessoaId: linha.id,
        evento: 'convite_enviado',
        porPessoaId: pessoaDoAtor(contexto.ator),
      })
      return { linha, token }
    })

    const base = {
      id: criada.linha.id,
      nome: criada.linha.nome,
      usuario: criada.linha.usuario,
      funcao: criada.linha.funcao,
      admin: criada.linha.admin,
      perfilId: criada.linha.perfil_id,
      emailPendente: dados.email,
    }
    if (gerada !== null) {
      return {
        ...base,
        convite: null,
        senhaProvisoria: gerada.senha,
        senhaProvisoriaExpiraEm: gerada.expiraEm.toISOString(),
      }
    }
    if (criada.token === null) throw new Error('convite sem link: a transação acima o emite sempre')
    // O e-mail sai DEPOIS do COMMIT: se o SMTP recusar, a pessoa e o convite
    // existem, e a admin o reenvia — nunca uma pessoa presa sem convite.
    const saiu = await this.acessoPorEmail.entregar(
      this.acessoPorEmail.mensagemComLink('convite', criada.token, {
        para: dados.email,
        clinicaNome: contexto.clinicaNome,
        nomeDaPessoa: dados.nome,
      }),
    )
    return {
      ...base,
      convite: saiu ? 'enviado' : 'falhou',
      senhaProvisoria: null,
      senhaProvisoriaExpiraEm: null,
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
    const alvoLido = await this.contextoDaPessoa(contexto, pessoaId)

    // PRÉ-CHECAGEM barata: escolher a senha de uma admin é recusado ANTES do
    // Argon2 (que custa 19 MiB). A decisão que vale é a de dentro da transação.
    if (escolhida !== undefined && alvoLido !== null) {
      const atorDoGuard = atorDeAcessoDoContexto(contexto)
      // Sem perfis: só a metade "alvo é administradora" é decidível aqui, e é
      // a que importa para não gastar Argon2 com quem vai levar 403.
      exigirDominio(podeAgirSobre(atorDoGuard, alvoLido.pessoa, []))
      exigirDominio(podeEscolherSenhaDe(atorDoGuard, alvoLido.pessoa))
    }

    const provisoria =
      escolhida === undefined
        ? await gerarProvisoria(agora)
        : await provisoriaEscolhida(agora, escolhida, [
            contexto.clinicaCodigo,
            contexto.clinicaNome,
            ...(alvoLido === null ? [] : [alvoLido.nome, alvoLido.usuario]),
          ])

    await this.banco.naClinica(contexto.clinicaId, contexto.ator, async (c) => {
      await travarAcessoDaClinica(c, contexto.clinicaId)
      const ator = await lerAtorDeAcesso(c, contexto.ator)
      const perfis = await lerPerfisDoDominio(c)
      const r = await c.query<{ id: string; admin: boolean; perfil_id: string | null; ativo: boolean }>(
        'SELECT id, admin, perfil_id, ativo FROM pessoas WHERE id = $1 AND excluida_em IS NULL FOR UPDATE',
        [pessoaId],
      )
      const l = r.rows[0]
      if (l === undefined) throw new PessoaNaoExiste()
      const alvo = { id: l.id, admin: l.admin, perfilId: l.perfil_id, ativo: l.ativo }
      // Redefinir a senha de uma admin é tomar a conta dela: só admin, e só
      // gerada. Pessoa de perfil mais rico que o do ator: também recusada.
      exigirDominio(podeAgirSobre(ator, alvo, perfis))
      if (escolhida !== undefined) exigirDominio(podeEscolherSenhaDe(ator, alvo))
      await redefinirSenhaDePessoa(c, pessoaId, provisoria)
    })

    return {
      id: pessoaId,
      senhaProvisoria: provisoria.senha,
      senhaProvisoriaExpiraEm: provisoria.expiraEm.toISOString(),
    }
  }

  /**
   * Nome, usuário e estado de acesso da pessoa-alvo — para a regra de força e
   * para a pré-checagem. **Não é a decisão**: a transação relê tudo sob o lock.
   *
   * `excluida_em IS NULL` aqui também: sem o filtro, redefinir a senha de quem
   * a clínica excluiu LERIA o nome dela para montar o contexto, e a recusa
   * seguinte viria de `redefinirSenhaDePessoa`. Devolver `null` e deixar a
   * transação recusar mantém o 404 como a única resposta desse caminho.
   */
  private async contextoDaPessoa(
    contexto: ContextoDaRequisicao,
    pessoaId: string,
  ): Promise<{ nome: string; usuario: string; pessoa: PessoaDaClinica } | null> {
    const r = await this.banco.naClinica(contexto.clinicaId, contexto.ator, (c) =>
      c.query<{
        id: string
        nome: string
        usuario: string
        admin: boolean
        perfil_id: string | null
        ativo: boolean
      }>(
        'SELECT id, nome, usuario, admin, perfil_id, ativo FROM pessoas WHERE id = $1 AND excluida_em IS NULL',
        [pessoaId],
      ),
    )
    const l = r.rows[0]
    if (l === undefined) return null
    return {
      nome: l.nome,
      usuario: l.usuario,
      pessoa: { id: l.id, admin: l.admin, perfilId: l.perfil_id, ativo: l.ativo },
    }
  }
}

export {
  PerfilNaoExiste,
  SenhaFraca,
  PessoaNaoExiste,
  PROVISORIA_VALE_MS,
  UsuarioJaExiste,
} from './escrita-de-pessoa'
