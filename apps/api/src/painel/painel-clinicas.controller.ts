import {
  type ClinicaCriada,
  type ClinicasDoPainel,
  CriarClinicaEntrada,
  CriarPessoaNoPainelEntrada,
  EditarPessoaNoPainelEntrada,
  type PessoaCriadaNoPainel,
  type PessoaNoPainel,
  type PessoasDoPainel,
  type SenhaRedefinida,
  type SessaoDeSuporteCriada,
  Uuid,
} from '@fir/contracts'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import { DURACAO_SESSAO_DE_SUPORTE_MS } from '../autenticacao/sessao'
import { NOME_DO_COOKIE } from '../autenticacao/sessao.guard'
import { SessaoDeSuporteService } from './sessao-de-suporte.service'
import type { ContextoDoPainel, RequisicaoComPainel } from './contexto-do-painel'
import {
  ClinicaDesativada,
  ClinicaNaoExiste,
  CodigoDeClinicaJaExiste,
  PainelClinicasService,
  type ClinicaResolvida,
} from './painel-clinicas.service'
import { PainelPessoasService } from './painel-pessoas.service'
import { PerfilNaoExiste, PessoaNaoExiste, UsuarioJaExiste } from '../pessoas/escrita-de-pessoa'
import { SoOperador } from './so-operador.decorator'

/**
 * As clínicas e as pessoas delas, vistas pelo superadmin.
 *
 * **Acesso total; registro obrigatório** (D-10). Não há `@Exige` aqui e não
 * deve haver: o superadmin não tem perfil nem permissões — ele não é uma
 * pessoa de clínica nenhuma. O que o contém é que toda escrita dele cai na
 * trilha que a clínica lê, com `ator_tipo = 'operador'`, pela trigger.
 */
@SoOperador()
@Controller('v1/superadmin/clinicas')
export class PainelClinicasController {
  constructor(
    @Inject(PainelClinicasService) private readonly clinicas: PainelClinicasService,
    @Inject(PainelPessoasService) private readonly pessoas: PainelPessoasService,
    @Inject(SessaoDeSuporteService) private readonly suporte: SessaoDeSuporteService,
  ) {}

  @Get()
  async listar(): Promise<ClinicasDoPainel> {
    return { itens: await this.clinicas.listar() }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async criar(@Body() corpo: unknown, @Req() req: RequisicaoComPainel): Promise<ClinicaCriada> {
    const dados = CriarClinicaEntrada.safeParse(corpo)
    // A mensagem da PRIMEIRA questão: ela é a do domínio quando o problema é
    // o usuário ou o código, e é ela que a tela mostra.
    if (!dados.success) {
      throw new BadRequestException(
        dados.error.issues[0]?.message ?? 'Confira os dados da clínica.',
      )
    }
    try {
      return await this.clinicas.criar(painelDe(req).ator, dados.data)
    } catch (e) {
      if (e instanceof CodigoDeClinicaJaExiste) {
        throw new ConflictException('Já existe uma clínica com esse código.')
      }
      if (e instanceof UsuarioJaExiste) {
        throw new ConflictException('Esse usuário já existe nesta clínica. Escolha outro.')
      }
      throw e
    }
  }

  /**
   * ABRE O SISTEMA DA CLÍNICA — a sessão de suporte (D-13).
   *
   * Um `POST` e não um `GET`, e a razão não é estética: ela **cria** uma
   * credencial e revoga a anterior. Um `GET` seria pré-buscável pelo
   * navegador, e passar o mouse sobre o link na lista de clínicas abriria
   * sessão numa clínica que ninguém escolheu — com a linha de trilha dentro
   * dela afirmando que o operador entrou.
   *
   * ## O que ela devolve, e o que ela PÕE
   *
   * O corpo é o mínimo (a clínica e o prazo). O que importa é o `Set-Cookie`
   * do **cookie do produto** — é ele que faz a aba nova nascer logada. Mesmos
   * atributos do `/v1/entrar`, com um prazo de trinta minutos em vez de trinta
   * dias.
   *
   * `sameSite: 'lax'` e não `'strict'` como o cookie do painel: a aba nova é
   * uma navegação de topo vinda do painel, e com `strict` o cookie não
   * acompanharia o primeiro `GET` da página — a pessoa cairia em `/entrar`
   * depois de clicar em "entrar logado".
   *
   * ## A consequência que precisa estar dita
   *
   * O cookie do produto é **um por navegador** (`__Host-`, `Path=/`). Abrir
   * uma sessão de suporte SUBSTITUI o cookie de qualquer sessão de produto
   * que esse navegador tivesse. No computador do operador isso é o que se
   * quer; é por isso que ele não é o computador da clínica.
   */
  @Post(':clinicaId/sessao-de-suporte')
  @HttpCode(HttpStatus.CREATED)
  async abrirSessaoDeSuporte(
    @Param('clinicaId') clinicaId: string,
    @Req() req: RequisicaoComPainel,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<SessaoDeSuporteCriada> {
    const painel = painelDe(req)
    const clinica = await this.resolver(clinicaId)
    const { token, saida } = await this.suporte.abrir(clinica, painel.ator)
    res.setCookie(NOME_DO_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(DURACAO_SESSAO_DE_SUPORTE_MS / 1000),
    })
    return saida
  }

  @Get(':clinicaId/pessoas')
  async listarPessoas(
    @Param('clinicaId') clinicaId: string,
    @Req() req: RequisicaoComPainel,
  ): Promise<PessoasDoPainel> {
    const painel = painelDe(req)
    const clinica = await this.resolver(clinicaId)
    return { itens: await this.pessoas.listar(clinica, painel.ator) }
  }

  @Get(':clinicaId/pessoas/:pessoaId')
  async ficha(
    @Param('clinicaId') clinicaId: string,
    @Param('pessoaId') pessoaId: string,
    @Req() req: RequisicaoComPainel,
  ): Promise<PessoaNoPainel> {
    const painel = painelDe(req)
    const clinica = await this.resolver(clinicaId)
    try {
      return await this.pessoas.ficha(clinica, painel.ator, uuidOu404(pessoaId))
    } catch (e) {
      if (e instanceof PessoaNaoExiste) throw new NotFoundException('Pessoa não encontrada.')
      throw e
    }
  }

  @Post(':clinicaId/pessoas')
  @HttpCode(HttpStatus.CREATED)
  async criarPessoa(
    @Param('clinicaId') clinicaId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<PessoaCriadaNoPainel> {
    const painel = painelDe(req)
    const clinica = await this.resolver(clinicaId)
    const dados = CriarPessoaNoPainelEntrada.safeParse(corpo)
    if (!dados.success) {
      throw new BadRequestException(dados.error.issues[0]?.message ?? 'Confira os dados da pessoa.')
    }
    try {
      return await this.pessoas.criar(clinica, painel.ator, dados.data)
    } catch (e) {
      if (e instanceof UsuarioJaExiste) {
        throw new ConflictException('Esse usuário já existe nesta clínica. Escolha outro.')
      }
      // Perfil de outra clínica, ou perfil que não existe mais. 400 e não
      // 404: o recurso pedido é a PESSOA, e o que está errado é o corpo.
      if (e instanceof PerfilNaoExiste) throw new BadRequestException('Esse perfil não existe.')
      throw e
    }
  }

  /**
   * **EDITAR** uma pessoa da clínica — nome, função e acesso.
   *
   * O painel não tinha isto, e a falta aparecia no caso que ele existe para
   * resolver: a clínica trancada (sem administradora ativa) não consegue
   * corrigir nem o nome de quem está lá dentro.
   *
   * As invariantes são as do DOMÍNIO, e valem para ele também: o superadmin
   * não deixa a clínica sem administradora ativa, porque isso a tranca — e
   * destrancá-la é justamente o que ele viria fazer.
   */
  @Patch(':clinicaId/pessoas/:pessoaId')
  async editarPessoa(
    @Param('clinicaId') clinicaId: string,
    @Param('pessoaId') pessoaId: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComPainel,
  ): Promise<PessoaNoPainel> {
    const painel = painelDe(req)
    const clinica = await this.resolver(clinicaId)
    const dados = EditarPessoaNoPainelEntrada.safeParse(corpo)
    if (!dados.success) {
      throw new BadRequestException(dados.error.issues[0]?.message ?? 'Confira os dados da pessoa.')
    }
    try {
      return await this.pessoas.editar(clinica, painel.ator, uuidOu404(pessoaId), dados.data)
    } catch (e) {
      if (e instanceof PessoaNaoExiste) throw new NotFoundException('Pessoa não encontrada.')
      if (e instanceof PerfilNaoExiste) throw new BadRequestException('Esse perfil não existe.')
      throw e
    }
  }

  /**
   * **EXCLUIR** uma pessoa da clínica — soft delete (regra 20).
   *
   * `DELETE` como verbo, `UPDATE` como efeito. A linha fica e o histórico dela
   * continua ligado; o que muda é que ela sai da lista e deixa de entrar.
   *
   * O operador **não escapa do domínio**: a clínica não fica sem
   * administradora ativa nem pela mão dele, e a recusa é 422 com o código.
   */
  @Delete(':clinicaId/pessoas/:pessoaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async excluirPessoa(
    @Param('clinicaId') clinicaId: string,
    @Param('pessoaId') pessoaId: string,
    @Req() req: RequisicaoComPainel,
  ): Promise<void> {
    const painel = painelDe(req)
    const clinica = await this.resolver(clinicaId)
    try {
      await this.pessoas.excluir(clinica, painel.ator, uuidOu404(pessoaId))
    } catch (e) {
      if (e instanceof PessoaNaoExiste) throw new NotFoundException('Pessoa não encontrada.')
      throw e
    }
  }

  /**
   * Redefine a senha de uma pessoa da clínica. Corpo vazio **de propósito**:
   * não há o que escolher — nem a senha, nem o prazo. O servidor gera e
   * devolve uma vez.
   */
  @Post(':clinicaId/pessoas/:pessoaId/senha')
  @HttpCode(HttpStatus.OK)
  async redefinirSenha(
    @Param('clinicaId') clinicaId: string,
    @Param('pessoaId') pessoaId: string,
    @Req() req: RequisicaoComPainel,
  ): Promise<SenhaRedefinida> {
    const painel = painelDe(req)
    const clinica = await this.resolver(clinicaId)
    try {
      return await this.pessoas.redefinirSenha(clinica, painel.ator, uuidOu404(pessoaId))
    } catch (e) {
      if (e instanceof PessoaNaoExiste) throw new NotFoundException('Pessoa não encontrada.')
      throw e
    }
  }

  /**
   * O id da clínica vem da ROTA, e por isso passa pelo BANCO antes de virar
   * `ClinicaId`. Um uuid inventado na URL não pode virar
   * `SET LOCAL app.clinica_id`.
   */
  private async resolver(clinicaId: string): Promise<ClinicaResolvida> {
    try {
      return await this.clinicas.clinicaPorId(uuidOu404(clinicaId))
    } catch (e) {
      if (e instanceof ClinicaNaoExiste) throw new NotFoundException('Clínica não encontrada.')
      // 409 e não 404: a clínica EXISTE e está desativada. Aqui esconder não
      // protege ninguém — quem pergunta já é o superadmin —, e a diferença é
      // o que distingue "errei o link" de "esta clínica está fora".
      if (e instanceof ClinicaDesativada) {
        throw new ConflictException('Esta clínica está desativada.')
      }
      throw e
    }
  }
}

/**
 * Id malformado é **404, nunca 400**: responder 400 para um uuid inválido e
 * 404 para um uuid válido inexistente distingue os dois para quem sonda.
 */
const uuidOu404 = (bruto: string): string => {
  const r = Uuid.safeParse(bruto)
  if (!r.success) throw new NotFoundException()
  return r.data
}

/**
 * `req.painel` sem `!`. O `PainelGuard` o popula, mas um guard mal registrado
 * é exatamente o defeito que se quer ver estourar aqui, e não um `undefined`
 * atravessando para `SET LOCAL app.pessoa_id`.
 */
const painelDe = (req: RequisicaoComPainel): ContextoDoPainel => {
  if (!req.painel) throw new NotFoundException()
  return req.painel
}
