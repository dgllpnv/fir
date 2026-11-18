import type { LinkConsultado } from '@fir/contracts'
import { TokenDeLink } from '@fir/contracts'
import {
  avaliarSenha,
  ehErro,
  mascararEmail,
  podeAgirSobre,
  primeiroNome,
  situacaoDoLink,
  type ErroDeDominio,
  type FinalidadeDeLink,
} from '@fir/domain'
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import { SISTEMA, pessoaDoAtor, pessoaIdDeFonteConfiavel, type OperadorId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import { clinicaIdDeFonteConfiavel, type ClinicaId } from '../banco/clinica-id'
import { semaforoArgon2 } from '../autenticacao/concorrencia'
import { LimitePorOrigem } from '../autenticacao/limite-por-origem'
import { conferirSenha, hashDeSenha } from '../autenticacao/senha'
import { hashDoToken } from '../autenticacao/sessao'
import { RELOGIO, type Relogio } from '../comum/relogio'
import type { ContextoDaRequisicao } from '../comum/contexto'
import { lerAtorDeAcesso, lerPerfisDoDominio, travarAcessoDaClinica, exigirDominio } from '../pessoas/acesso-do-ator'
import { ChaveDeEmail } from './chave-de-email'
import { ENVIO, envioLigado, type ConfiguracaoDoEnvio } from './correio'
import { LIMITE_ENVIOS_POR_PESSOA, LIMITE_ESQUECI_POR_EMAIL } from './limites'
import { emitirLink, gravarEvento, invalidarLinksDaPessoa } from './links'
import { linkDoToken, montarMensagem, type MensagemDeEmail, type TipoDeMensagem } from './mensagens'

const UNICIDADE_VIOLADA = '23505'

/** O 503 honesto do envio desligado (spec 2.1): nenhuma rota finge um envio. */
export const FRASE_ENVIO_DESLIGADO = 'O envio de e-mail ainda não está ligado.'

export class EnvioDesligado extends HttpException {
  constructor() {
    super(FRASE_ENVIO_DESLIGADO, HttpStatus.SERVICE_UNAVAILABLE)
  }
}

class LinkPerdido extends Error {}
class EmailEmUso extends Error {}

type LinkResolvido = {
  id: string
  clinica_id: string
  pessoa_id: string
  finalidade: FinalidadeDeLink
  email_hmac: string
  expira_em: Date
  usado_em: Date | null
  invalidado_em: Date | null
}

type PessoaDoLink = {
  id: string
  nome: string
  usuario: string
  email: string | null
  email_pendente: string | null
  ativo: boolean
  excluida_em: Date | null
  aguardando_primeira_senha: boolean
}

export type ResultadoDoUso =
  | { tipo: 'ok' }
  | { tipo: 'invalido' }
  | { tipo: 'senha-obrigatoria' }
  | { tipo: 'senha-proibida' }
  | { tipo: 'senha-fraca'; erro: ErroDeDominio }
  | { tipo: 'email-em-uso' }

/** O e-mail para onde o link foi: o PENDENTE no convite e na confirmação, o CONFIRMADO na redefinição (appsec 3). */
const alvoDoLink = (finalidade: FinalidadeDeLink, p: PessoaDoLink): string | null =>
  finalidade === 'redefinicao' ? p.email : p.email_pendente

const COLUNAS_DA_PESSOA_DO_LINK = `id, nome, usuario, email, email_pendente, ativo, excluida_em,
  aguardando_primeira_senha`

/**
 * ACESSO POR E-MAIL — os links de uso único e os e-mails que os levam.
 *
 * O que mora aqui é a ORQUESTRAÇÃO: quando emitir, para onde, e quando avisar.
 * A regra pura (prazo, situação do link, máscara, forma do e-mail) mora em
 * `@fir/domain/acesso-por-email`; a escrita no banco, em `links.ts`; o texto,
 * em `mensagens.ts`; o envio, atrás do seam `Correio`.
 *
 * **O token cru nunca sai do processo** (appsec 13): ele nasce em `emitirLink`,
 * vai para a mensagem e para o `Correio`, e acaba. Sem fila em Redis.
 */
@Injectable()
export class AcessoPorEmailService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(ENVIO) private readonly envio: ConfiguracaoDoEnvio,
    @Inject(ChaveDeEmail) private readonly chave: ChaveDeEmail,
    @Inject(LIMITE_ESQUECI_POR_EMAIL) private readonly porEmail: LimitePorOrigem,
    @Inject(LIMITE_ENVIOS_POR_PESSOA) private readonly porPessoa: LimitePorOrigem,
  ) {}

  /** O trabalho que roda DEPOIS da resposta, para `ocioso()` poder esperá-lo. */
  private readonly emAndamento = new Set<Promise<void>>()

  /**
   * Roda `trabalho` fora da requisição, sem nunca rejeitar: o que acontece
   * nele não muda resposta nenhuma (esqueci-senha, avisos de L11, envio).
   */
  emSegundoPlano(
    trabalho: () => Promise<unknown>,
    // Quando começar: por padrão, no próximo giro do laço; o esqueci-senha
    // passa "quando a resposta saiu".
    quando: Promise<void> = new Promise<void>((pronto) => setImmediate(pronto)),
  ): void {
    const p: Promise<void> = quando
      .then(trabalho)
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => this.emAndamento.delete(p))
    this.emAndamento.add(p)
  }

  /**
   * Resolve quando não há mais trabalho em segundo plano — inclusive o que um
   * trabalho agendou ao terminar. Para o desligamento ordenado e para os testes,
   * que esperam o fim em vez de dormir um tempo chutado.
   */
  async ocioso(): Promise<void> {
    while (this.emAndamento.size > 0) await Promise.all([...this.emAndamento])
  }

  get ligado(): boolean {
    return envioLigado(this.envio)
  }

  hmacDoEmail(emailCanonico: string): string {
    return this.chave.hmac(emailCanonico)
  }

  /** Monta o link com `URL_PUBLICA` e nunca com o `Host` da requisição (appsec 14). */
  private link(finalidade: FinalidadeDeLink, token: string): string {
    if (!envioLigado(this.envio)) throw new EnvioDesligado()
    return linkDoToken(this.envio.urlPublica, finalidade, token)
  }

  /**
   * Entrega uma mensagem e diz se saiu. Nunca lança: a falha do SMTP já foi
   * registrada (mascarada) pelo adaptador, e quem chama decide o que a tela ouve.
   */
  async entregar(m: MensagemDeEmail): Promise<boolean> {
    if (!envioLigado(this.envio)) return false
    try {
      await this.envio.correio.enviar(m)
      return true
    } catch {
      return false
    }
  }

  /**
   * Entrega DEPOIS da resposta (`setImmediate`, em memória). É o que tira o
   * SMTP do relógio do esqueci-senha (appsec 11) e dos avisos de L11.
   */
  entregarDepois(m: MensagemDeEmail): void {
    this.emSegundoPlano(() => this.entregar(m))
  }

  /** Mensagem com link para a pessoa, já montada. */
  mensagemComLink(
    finalidade: FinalidadeDeLink,
    token: string,
    dados: { para: string; clinicaNome: string; nomeDaPessoa: string },
  ): MensagemDeEmail {
    return montarMensagem(finalidade, { ...dados, link: this.link(finalidade, token) })
  }

  aviso(
    tipo: Extract<TipoDeMensagem, 'senha_alterada' | 'email_trocado' | 'troca_de_email_pedida'>,
    dados: { para: string; clinicaNome: string; nomeDaPessoa: string },
  ): MensagemDeEmail {
    return montarMensagem(tipo, dados)
  }

  // ---------------------------------------------------------------------------
  // Esqueci minha senha (público)
  // ---------------------------------------------------------------------------

  /**
   * O pedido de redefinição. Quem chama aplica o PISO de tempo e responde a
   * frase única, qualquer que seja o caminho — esta função não devolve nada que
   * a resposta possa refletir.
   *
   * Só manda para e-mail CONFIRMADO (appsec 4): o pendente pode ter erro de
   * digitação, ou ser o endereço que a admin cadastrou com o envio desligado.
   */
  async pedirRedefinicao(codigoClinica: string, email: string): Promise<void> {
    const hmac = this.chave.hmac(email)
    // Conta exista ou não a conta (spec 3.6), e ANTES de saber: estourado, a
    // resposta é a mesma frase e nada sai.
    if (!this.porEmail.registrar(`${codigoClinica}:${hmac}`)) return
    // Desligado: nada se grava que finja um envio (spec 2.1).
    if (!this.ligado) return

    const r = await this.banco.semIsolamentoDeClinica<{ id: string; nome: string }>(
      'SELECT id, nome FROM clinicas WHERE codigo = $1 AND ativa',
      [codigoClinica],
    )
    const clinica = r.rows[0]
    if (clinica === undefined) return
    const clinicaId = clinicaIdDeFonteConfiavel(clinica.id)

    // `SISTEMA`: quem pediu não provou quem é.
    const emitido = await this.banco.naClinica(clinicaId, SISTEMA, async (c) => {
      const p = await c.query<{ id: string; nome: string; email: string }>(
        `SELECT id, nome, email FROM pessoas
          WHERE email = $1 AND ativo AND excluida_em IS NULL FOR UPDATE`,
        [email],
      )
      const pessoa = p.rows[0]
      if (pessoa === undefined) {
        // Sem pessoa e SEM o e-mail digitado, que é de um terceiro.
        await gravarEvento(c, { clinicaId, pessoaId: null, evento: 'pedido_sem_conta', porPessoaId: null })
        return null
      }
      const token = await emitirLink(c, {
        clinicaId,
        pessoaId: pessoa.id,
        finalidade: 'redefinicao',
        emailHmac: hmac,
        agora: this.relogio.agora(),
      })
      await gravarEvento(c, {
        clinicaId,
        pessoaId: pessoa.id,
        evento: 'pedido_de_redefinicao',
        porPessoaId: null,
      })
      return { token, nome: pessoa.nome, email: pessoa.email }
    })
    if (emitido === null) return
    this.entregarDepois(
      this.mensagemComLink('redefinicao', emitido.token, {
        para: emitido.email,
        clinicaNome: clinica.nome,
        nomeDaPessoa: emitido.nome,
      }),
    )
  }

  // ---------------------------------------------------------------------------
  // O link: consultar (não consome) e usar (consome)
  // ---------------------------------------------------------------------------

  private async resolver(token: string): Promise<LinkResolvido | null> {
    if (!TokenDeLink.safeParse(token).success) return null
    const r = await this.banco.semIsolamentoDeClinica<LinkResolvido>(
      'SELECT * FROM resolver_link_de_acesso($1)',
      [hashDoToken(token)],
    )
    return r.rows[0] ?? null
  }

  /** O link vale para esta pessoa, agora? Prazo, uso, invalidação, pessoa ativa e e-mail do link. */
  private vale(link: LinkResolvido, p: PessoaDoLink | undefined, agora: Date): p is PessoaDoLink {
    if (p === undefined || !p.ativo || p.excluida_em !== null) return false
    if (
      situacaoDoLink(
        { expiraEm: link.expira_em, usadoEm: link.usado_em, invalidadoEm: link.invalidado_em },
        agora,
      ) !== 'valido'
    ) {
      return false
    }
    if (link.finalidade === 'convite' && !p.aguardando_primeira_senha) return false
    return this.chave.confere(alvoDoLink(link.finalidade, p), link.email_hmac)
  }

  /**
   * O que `/criar-senha` e `/confirmar-email` mostram. **Não consome nada**
   * (appsec 16): o leitor de link do provedor de e-mail (Safe Links) abre a
   * página antes da pessoa, e não pode queimar o convite.
   */
  async consultar(token: string): Promise<LinkConsultado | null> {
    const link = await this.resolver(token)
    if (link === null) return null
    const clinicaId = clinicaIdDeFonteConfiavel(link.clinica_id)
    return this.banco.naClinica(clinicaId, SISTEMA, async (c) => {
      const p = (
        await c.query<PessoaDoLink>(`SELECT ${COLUNAS_DA_PESSOA_DO_LINK} FROM pessoas WHERE id = $1`, [
          link.pessoa_id,
        ])
      ).rows[0]
      if (!this.vale(link, p, this.relogio.agora())) return null
      const clinica = (
        await c.query<{ nome: string; codigo: string }>('SELECT nome, codigo FROM clinicas WHERE id = $1', [
          clinicaId,
        ])
      ).rows[0]
      if (clinica === undefined) return null
      return {
        finalidade: link.finalidade,
        primeiroNome: primeiroNome(p.nome),
        clinicaNome: clinica.nome,
        clinicaCodigo: clinica.codigo,
        usuario: p.usuario,
        email: alvoDoLink(link.finalidade, p) ?? '',
      }
    })
  }

  /**
   * Usa o link. Convite e redefinição gravam a senha nova; a confirmação passa
   * o pendente a confirmado.
   *
   * **Atômico, e na mesma transação de tudo o que ele autoriza** (appsec 5): o
   * `UPDATE … WHERE usado_em IS NULL AND invalidado_em IS NULL AND expira_em >
   * agora RETURNING`, a senha, a revogação das sessões, a invalidação dos
   * outros links e o evento. Duas abas: uma grava, a outra ouve 410.
   *
   * **Não cria sessão** (appsec 8): a pessoa entra depois por `/v1/entrar`.
   */
  async usar(token: string, senha: string | undefined): Promise<ResultadoDoUso> {
    const link = await this.resolver(token)
    if (link === null) return { tipo: 'invalido' }
    const clinicaId = clinicaIdDeFonteConfiavel(link.clinica_id)

    // --- TRANSAÇÃO 1 (curta): a pessoa e a clínica, para julgar. Nenhum Argon2.
    const lido = await this.banco.naClinica(clinicaId, SISTEMA, async (c) => {
      const p = (
        await c.query<PessoaDoLink>(`SELECT ${COLUNAS_DA_PESSOA_DO_LINK} FROM pessoas WHERE id = $1`, [
          link.pessoa_id,
        ])
      ).rows[0]
      const clinica = (
        await c.query<{ nome: string; codigo: string }>('SELECT nome, codigo FROM clinicas WHERE id = $1', [
          clinicaId,
        ])
      ).rows[0]
      return { p, clinica }
    })
    const agora = this.relogio.agora()
    if (lido.clinica === undefined || !this.vale(link, lido.p, agora)) {
      await this.registrarFalha(clinicaId, link, agora)
      return { tipo: 'invalido' }
    }
    const pessoa = lido.p
    const clinica = lido.clinica

    let hash: string | null = null
    if (link.finalidade === 'confirmacao_de_email') {
      if (senha !== undefined) return { tipo: 'senha-proibida' }
    } else {
      if (senha === undefined) return { tipo: 'senha-obrigatoria' }
      // A regra ANTES do hash (a mesma ordem de `trocarAPropriaSenha`).
      const juizo = avaliarSenha(senha, {
        contexto: [
          clinica.codigo,
          clinica.nome,
          pessoa.usuario,
          pessoa.nome,
          (alvoDoLink(link.finalidade, pessoa) ?? '').split('@')[0] ?? '',
        ],
      })
      if (ehErro(juizo)) return { tipo: 'senha-fraca', erro: juizo.erro }
      // --- FORA DE TRANSAÇÃO: o Argon2, pelo semáforo.
      hash = await semaforoArgon2.executar(() => hashDeSenha(senha))
    }

    // A pessoa PROVOU quem é ao apresentar o link: é dela a escrita.
    const ator = pessoaIdDeFonteConfiavel(pessoa.id)
    let efeito: { confirmado: string | null; antigo: string | null }
    try {
      // --- TRANSAÇÃO 2: tudo ou nada.
      efeito = await this.banco.naClinica(clinicaId, ator, async (c) => {
        const u = await c.query(
          `UPDATE links_de_acesso SET usado_em = $2
            WHERE id = $1 AND usado_em IS NULL AND invalidado_em IS NULL AND expira_em > $2
            RETURNING id`,
          [link.id, agora],
        )
        if (u.rowCount === 0) throw new LinkPerdido()
        const p2 = (
          await c.query<PessoaDoLink>(
            `SELECT ${COLUNAS_DA_PESSOA_DO_LINK} FROM pessoas WHERE id = $1 FOR UPDATE`,
            [pessoa.id],
          )
        ).rows[0]
        if (!this.vale({ ...link, usado_em: null }, p2, agora)) throw new LinkPerdido()

        try {
          if (link.finalidade === 'convite') {
            await c.query(
              `UPDATE pessoas
                  SET senha_hash = $2, senha_provisoria = false, senha_provisoria_expira_em = NULL,
                      aguardando_primeira_senha = false,
                      email = email_pendente, email_pendente = NULL, email_confirmado_em = $3
                WHERE id = $1`,
              [pessoa.id, hash, agora],
            )
          } else if (link.finalidade === 'redefinicao') {
            await c.query(
              `UPDATE pessoas
                  SET senha_hash = $2, senha_provisoria = false, senha_provisoria_expira_em = NULL,
                      aguardando_primeira_senha = false
                WHERE id = $1`,
              [pessoa.id, hash],
            )
          } else {
            await c.query(
              `UPDATE pessoas
                  SET email = email_pendente, email_pendente = NULL, email_confirmado_em = $2
                WHERE id = $1`,
              [pessoa.id, agora],
            )
          }
        } catch (e) {
          // Outra pessoa da clínica já CONFIRMOU este endereço (índice único).
          if (typeof e === 'object' && e !== null && 'code' in e && e.code === UNICIDADE_VIOLADA) {
            throw new EmailEmUso()
          }
          throw e
        }

        // Criar ou redefinir a senha por link derruba TODAS as sessões (spec 3.8).
        if (link.finalidade !== 'confirmacao_de_email') {
          await c.query(
            'UPDATE sessoes SET revogada_em = now() WHERE pessoa_id = $1 AND revogada_em IS NULL',
            [pessoa.id],
          )
        }
        await c.query(
          `UPDATE links_de_acesso SET invalidado_em = $3
            WHERE pessoa_id = $1 AND id <> $2 AND usado_em IS NULL AND invalidado_em IS NULL`,
          [pessoa.id, link.id, agora],
        )
        await gravarEvento(c, {
          clinicaId,
          pessoaId: pessoa.id,
          evento:
            link.finalidade === 'convite'
              ? 'senha_criada_pelo_convite'
              : link.finalidade === 'redefinicao'
                ? 'senha_redefinida_pelo_link'
                : 'email_confirmado',
          porPessoaId: pessoa.id,
        })
        const confirmado = link.finalidade === 'redefinicao' ? p2.email : p2.email_pendente
        return { confirmado, antigo: p2.email }
      })
    } catch (e) {
      if (e instanceof LinkPerdido) {
        await this.registrarFalha(clinicaId, { ...link, usado_em: agora }, agora)
        return { tipo: 'invalido' }
      }
      if (e instanceof EmailEmUso) return { tipo: 'email-em-uso' }
      throw e
    }

    // Os avisos de L11, depois da resposta.
    const dados = { clinicaNome: clinica.nome, nomeDaPessoa: pessoa.nome }
    if (link.finalidade !== 'confirmacao_de_email' && efeito.confirmado !== null) {
      this.entregarDepois(this.aviso('senha_alterada', { ...dados, para: efeito.confirmado }))
    }
    if (
      link.finalidade === 'confirmacao_de_email' &&
      efeito.antigo !== null &&
      efeito.antigo !== efeito.confirmado
    ) {
      this.entregarDepois(this.aviso('email_trocado', { ...dados, para: efeito.antigo }))
    }
    return { tipo: 'ok' }
  }

  /** Link vencido, invalidado ou já usado: um evento de falha, em nome do sistema. */
  private async registrarFalha(clinicaId: ClinicaId, link: LinkResolvido, agora: Date): Promise<void> {
    const situacao = situacaoDoLink(
      { expiraEm: link.expira_em, usadoEm: link.usado_em, invalidadoEm: link.invalidado_em },
      agora,
    )
    await this.banco.naClinica(clinicaId, SISTEMA, (c) =>
      gravarEvento(c, {
        clinicaId,
        pessoaId: link.pessoa_id,
        evento: situacao === 'usado' ? 'link_ja_usado' : 'link_vencido',
        porPessoaId: null,
      }),
    )
  }

  // ---------------------------------------------------------------------------
  // O próprio e-mail (`POST /v1/eu/email`)
  // ---------------------------------------------------------------------------

  /**
   * Cadastrar, trocar ou retirar o PRÓPRIO e-mail, provando a senha atual
   * (appsec 1). O novo entra PENDENTE; o confirmado anterior continua valendo
   * até o link ser usado (appsec 2, LGPD L8). Nunca 409: quem já usa qual
   * e-mail não se descobre por aqui — a recusa, se houver, vem no uso do link.
   */
  async cadastrarMeuEmail(
    contexto: ContextoDaRequisicao,
    email: string | null,
    senha: string,
  ): Promise<{ enviadoPara: string | null }> {
    const eu = contexto.pessoa
    if (eu === null) {
      throw new HttpException(
        'Esta é uma sessão do painel. O e-mail é de cada pessoa da clínica.',
        HttpStatus.FORBIDDEN,
      )
    }
    if (email !== null && !this.ligado) throw new EnvioDesligado()
    if (!this.porPessoa.registrar(`eu:${eu.id}`)) {
      throw new HttpException('Muitos pedidos. Espere uma hora e tente de novo.', HttpStatus.TOO_MANY_REQUESTS)
    }

    const linha = await this.banco.naClinica(contexto.clinicaId, contexto.ator, async (c) => {
      const r = await c.query<{ senha_hash: string }>(
        'SELECT senha_hash FROM pessoas WHERE id = $1 AND ativo',
        [eu.id],
      )
      return r.rows[0] ?? null
    })
    const confere =
      linha !== null && (await semaforoArgon2.executar(() => conferirSenha(senha, linha.senha_hash)))
    if (!confere) throw new HttpException('A senha atual não confere.', HttpStatus.FORBIDDEN)

    const agora = this.relogio.agora()
    const r = await this.banco.naClinica(contexto.clinicaId, contexto.ator, async (c) => {
      const p = (
        await c.query<{ nome: string; email: string | null; email_pendente: string | null }>(
          'SELECT nome, email, email_pendente FROM pessoas WHERE id = $1 FOR UPDATE',
          [eu.id],
        )
      ).rows[0]
      if (p === undefined) throw new NotFoundException('Pessoa não encontrada.')

      if (email === null) {
        if (p.email !== null || p.email_pendente !== null) {
          await c.query(
            'UPDATE pessoas SET email = NULL, email_pendente = NULL, email_confirmado_em = NULL WHERE id = $1',
            [eu.id],
          )
          await invalidarLinksDaPessoa(c, eu.id)
        }
        return { tipo: 'retirado' as const, nome: p.nome, antigo: p.email }
      }
      if (email === p.email) {
        // Já é o confirmado: só descarta um pendente que houvesse.
        if (p.email_pendente !== null) {
          await c.query('UPDATE pessoas SET email_pendente = NULL WHERE id = $1', [eu.id])
          await invalidarLinksDaPessoa(c, eu.id)
        }
        return { tipo: 'nada' as const }
      }
      const pedidoNovo = email !== p.email_pendente
      if (pedidoNovo) {
        await c.query('UPDATE pessoas SET email_pendente = $2 WHERE id = $1', [eu.id, email])
        // O e-mail mudou: os links abertos morrem (appsec 7).
        await invalidarLinksDaPessoa(c, eu.id)
      }
      const token = await emitirLink(c, {
        clinicaId: contexto.clinicaId,
        pessoaId: eu.id,
        finalidade: 'confirmacao_de_email',
        emailHmac: this.chave.hmac(email),
        agora,
      })
      await gravarEvento(c, {
        clinicaId: contexto.clinicaId,
        pessoaId: eu.id,
        evento: 'email_cadastrado',
        porPessoaId: eu.id,
      })
      // O confirmado atual é avisado do PEDIDO, uma vez por endereço novo (M2).
      return { tipo: 'enviar' as const, token, nome: p.nome, avisarAntigo: pedidoNovo ? p.email : null }
    })

    if (r.tipo === 'nada') return { enviadoPara: null }
    if (r.tipo === 'retirado') {
      if (r.antigo !== null && this.ligado) {
        this.entregarDepois(
          this.aviso('email_trocado', { para: r.antigo, clinicaNome: contexto.clinicaNome, nomeDaPessoa: r.nome }),
        )
      }
      return { enviadoPara: null }
    }
    const saiu = await this.entregar(
      this.mensagemComLink('confirmacao_de_email', r.token, {
        para: email ?? '',
        clinicaNome: contexto.clinicaNome,
        nomeDaPessoa: r.nome,
      }),
    )
    if (!saiu) throw falhaDeEnvio()
    if (r.avisarAntigo !== null) {
      this.entregarDepois(
        this.aviso('troca_de_email_pedida', {
          para: r.avisarAntigo,
          clinicaNome: contexto.clinicaNome,
          nomeDaPessoa: r.nome,
        }),
      )
    }
    return { enviadoPara: mascararEmail(email ?? '') }
  }

  // ---------------------------------------------------------------------------
  // O e-mail de OUTRA pessoa: o PATCH da clínica e o do painel
  // ---------------------------------------------------------------------------

  /**
   * Corrigir ou RETIRAR o e-mail de uma pessoa, DENTRO da transação de quem
   * chama (spec 10, fluxos 4 e 17). Uma regra só para os dois chamadores — a
   * administradora pelo `PATCH /v1/pessoas/:id` e o operador pelo painel —;
   * o que muda entre eles é o pool e o ator, nunca a regra.
   *
   *  - `null` apaga o confirmado e o pendente (LGPD L8): a pessoa fica no
   *    caminho do usuário com senha. O endereço antigo confirmado é avisado
   *    (L11).
   *  - Um endereço novo entra PENDENTE; o confirmado anterior continua valendo
   *    até a confirmação (appsec 2). Com o envio ligado, o link sai para o
   *    novo: o convite, para quem ainda não criou a senha; a confirmação, para
   *    quem já entra.
   *
   * Toda mudança invalida os links abertos da pessoa (appsec 7): o link
   * antigo apontava para o endereço antigo. As mensagens voltam MONTADAS, e
   * quem chama as entrega depois do COMMIT.
   */
  async trocarEmailNaTransacao(
    c: pg.PoolClient,
    dados: {
      readonly clinicaId: ClinicaId
      readonly clinicaNome: string
      readonly pessoaId: string
      readonly email: string | null
      /** A pessoa que provou quem é; `null` para o operador, que não é pessoa da clínica. */
      readonly porPessoaId: string | null
    },
  ): Promise<{ enviar: MensagemDeEmail | null; avisar: MensagemDeEmail | null }> {
    const { pessoaId, email, clinicaNome } = dados
    const atual = (
      await c.query<{
        nome: string
        ativo: boolean
        email: string | null
        email_pendente: string | null
        aguardando_primeira_senha: boolean
      }>(
        `SELECT nome, ativo, email, email_pendente, aguardando_primeira_senha
           FROM pessoas WHERE id = $1 FOR UPDATE`,
        [pessoaId],
      )
    ).rows[0]
    if (atual === undefined) throw new NotFoundException('Pessoa não encontrada.')
    const nada = { enviar: null, avisar: null }

    if (email === null) {
      if (atual.email === null && atual.email_pendente === null) return nada
      await c.query(
        'UPDATE pessoas SET email = NULL, email_pendente = NULL, email_confirmado_em = NULL WHERE id = $1',
        [pessoaId],
      )
      await invalidarLinksDaPessoa(c, pessoaId)
      return {
        enviar: null,
        avisar:
          atual.email !== null && this.ligado
            ? this.aviso('email_trocado', { para: atual.email, clinicaNome, nomeDaPessoa: atual.nome })
            : null,
      }
    }
    if (email === atual.email) {
      if (atual.email_pendente === null) return nada
      await c.query('UPDATE pessoas SET email_pendente = NULL WHERE id = $1', [pessoaId])
      await invalidarLinksDaPessoa(c, pessoaId)
      return nada
    }
    if (email === atual.email_pendente) return nada

    await c.query('UPDATE pessoas SET email_pendente = $2 WHERE id = $1', [pessoaId, email])
    await invalidarLinksDaPessoa(c, pessoaId)
    if (!this.ligado) return nada
    /**
     * O confirmado atual é avisado NO PEDIDO (revisão appsec M2), venha ele
     * da administradora ou do operador: um canal de recuperação novo não nasce
     * sem que a dona da caixa antiga saiba. Antes, ela só ouvia depois da
     * confirmação — quando o novo já valia.
     */
    const avisar =
      atual.email === null
        ? null
        : this.aviso('troca_de_email_pedida', { para: atual.email, clinicaNome, nomeDaPessoa: atual.nome })
    if (!atual.ativo) return { enviar: null, avisar }

    const finalidade = atual.aguardando_primeira_senha ? 'convite' : 'confirmacao_de_email'
    const token = await emitirLink(c, {
      clinicaId: dados.clinicaId,
      pessoaId,
      finalidade,
      emailHmac: this.chave.hmac(email),
      agora: this.relogio.agora(),
    })
    await gravarEvento(c, {
      clinicaId: dados.clinicaId,
      pessoaId,
      evento: finalidade === 'convite' ? 'convite_reenviado' : 'email_cadastrado',
      porPessoaId: dados.porPessoaId,
    })
    return {
      enviar: this.mensagemComLink(finalidade, token, { para: email, clinicaNome, nomeDaPessoa: atual.nome }),
      avisar,
    }
  }

  // ---------------------------------------------------------------------------
  // A administradora: reenviar o convite e mandar o link de redefinição
  // ---------------------------------------------------------------------------

  /**
   * `config` no controlador; aqui, `podeAgirSobre` dentro da transação travada
   * (só admin age sobre admin, appsec 20) e o teto por pessoa-alvo (appsec 12).
   */
  async enviarPelaAdmin(
    contexto: ContextoDaRequisicao,
    pessoaId: string,
    finalidade: 'convite' | 'redefinicao',
  ): Promise<{ enviadoPara: string }> {
    return this.enviarParaOutraPessoa(pessoaId, finalidade, contexto.clinicaNome, (emitir) =>
      this.banco.naClinica(contexto.clinicaId, contexto.ator, async (c) => {
        await travarAcessoDaClinica(c, contexto.clinicaId)
        const ator = await lerAtorDeAcesso(c, contexto.ator)
        const perfis = await lerPerfisDoDominio(c)
        const alvo = await alvoDaAdmin(c, pessoaId)
        exigirDominio(podeAgirSobre(ator, alvo, perfis))
        return emitir(c, alvo, contexto.clinicaId, pessoaDoAtor(contexto.ator))
      }),
    )
  }

  /**
   * O MESMO envio, pelo painel (spec 2.7, ADR 2026-11-16). O operador age
   * sobre qualquer pessoa da clínica — inclusive a administradora, que é o elo
   * que a clínica não tem (D-10) —, então não há `podeAgirSobre`; o resto é a
   * regra de `enviarPelaAdmin`, inteira: só o confirmado recebe redefinição,
   * o anterior morre, o mesmo teto por pessoa-alvo e o 503 do desligado.
   *
   * `porPessoaId: null`: o operador não é pessoa da clínica. Quem assina o
   * link na trilha é a trigger, com `ator_tipo = 'operador'`.
   */
  async enviarPeloOperador(
    clinica: { readonly id: ClinicaId; readonly nome: string },
    ator: OperadorId,
    pessoaId: string,
    finalidade: 'convite' | 'redefinicao',
  ): Promise<{ enviadoPara: string }> {
    return this.enviarParaOutraPessoa(pessoaId, finalidade, clinica.nome, (emitir) =>
      this.banco.comoPainel(clinica.id, ator, async (c) => {
        await travarAcessoDaClinica(c, clinica.id)
        const alvo = await alvoDaAdmin(c, pessoaId)
        return emitir(c, alvo, clinica.id, null)
      }),
    )
  }

  /**
   * O núcleo dos dois envios a OUTRA pessoa. Quem chama abre a transação no
   * pool dele, julga quem pode agir e entrega o alvo travado; daqui em diante
   * a regra é uma só.
   *
   * O teto é por PESSOA-ALVO e é um orçamento só (`admin:<id>`), venha o
   * envio da administradora ou do operador: dois caminhos com dois tetos
   * dariam o dobro de e-mails à caixa de quem está sendo alvo (appsec 12).
   */
  private async enviarParaOutraPessoa(
    pessoaId: string,
    finalidade: 'convite' | 'redefinicao',
    clinicaNome: string,
    naTransacao: (
      emitir: (
        c: pg.PoolClient,
        alvo: AlvoDoEnvio,
        clinicaId: ClinicaId,
        porPessoaId: string | null,
      ) => Promise<{ token: string; para: string; nome: string }>,
    ) => Promise<{ token: string; para: string; nome: string }>,
  ): Promise<{ enviadoPara: string }> {
    if (!this.ligado) throw new EnvioDesligado()
    if (!this.porPessoa.registrar(`admin:${pessoaId}`)) {
      throw new HttpException(
        'Muitos envios para esta pessoa. Espere uma hora e tente de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    const agora = this.relogio.agora()
    const r = await naTransacao(async (c, alvo, clinicaId, porPessoaId) => {
      if (!alvo.ativo) throw new ConflictException('Esta pessoa está desativada.')

      let para: string | null
      if (finalidade === 'convite') {
        if (!alvo.aguardando_primeira_senha) {
          throw new ConflictException(
            'Esta pessoa já criou a senha. Para trocá-la, envie o link para redefinir a senha.',
          )
        }
        para = alvo.email_pendente
        if (para === null) throw new ConflictException('Cadastre o e-mail desta pessoa antes de convidar.')
      } else {
        // Só o CONFIRMADO recebe redefinição (appsec 4).
        para = alvo.email
        if (para === null) {
          throw new ConflictException(
            'Esta pessoa ainda não tem e-mail confirmado. Use a senha provisória.',
          )
        }
      }
      const token = await emitirLink(c, {
        clinicaId,
        pessoaId,
        finalidade,
        emailHmac: this.chave.hmac(para),
        agora,
      })
      await gravarEvento(c, {
        clinicaId,
        pessoaId,
        evento: finalidade === 'convite' ? 'convite_reenviado' : 'redefinicao_enviada_pela_admin',
        porPessoaId,
      })
      return { token, para, nome: alvo.nome }
    })

    const saiu = await this.entregar(
      this.mensagemComLink(finalidade, r.token, {
        para: r.para,
        clinicaNome,
        nomeDaPessoa: r.nome,
      }),
    )
    if (!saiu) throw falhaDeEnvio()
    return { enviadoPara: mascararEmail(r.para) }
  }
}

/** O SMTP recusou agora. 502: o pedido estava certo, o provedor é que não aceitou. */
const falhaDeEnvio = () =>
  new HttpException('Não consegui enviar o e-mail agora. Tente de novo em instantes.', HttpStatus.BAD_GATEWAY)

type AlvoDoEnvio = {
  id: string
  admin: boolean
  perfilId: string | null
  ativo: boolean
  nome: string
  email: string | null
  email_pendente: string | null
  aguardando_primeira_senha: boolean
}

async function alvoDaAdmin(c: pg.PoolClient, id: string): Promise<AlvoDoEnvio> {
  const r = await c.query<{
    id: string
    admin: boolean
    perfil_id: string | null
    ativo: boolean
    nome: string
    email: string | null
    email_pendente: string | null
    aguardando_primeira_senha: boolean
  }>(
    `SELECT id, admin, perfil_id, ativo, nome, email, email_pendente, aguardando_primeira_senha
       FROM pessoas WHERE id = $1 AND excluida_em IS NULL FOR UPDATE`,
    [id],
  )
  const l = r.rows[0]
  if (l === undefined) throw new NotFoundException('Pessoa não encontrada.')
  return { ...l, perfilId: l.perfil_id }
}
