import {
  CriarPessoaEntrada,
  EditarPessoa,
  type ListaDePerfis,
  type ListaDePessoas,
  type PessoaCriada,
  type PessoaNaLista,
  SalvarPerfis,
  RedefinirSenha,
  type SenhaRedefinida,
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
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { AcessoService } from './acesso.service'
import {
  PerfilNaoExiste,
  PessoaNaoExiste,
  SenhaFraca,
  PessoasService,
  UsuarioJaExiste,
} from './pessoas.service'

/**
 * **Usuários e acessos** — a tela de login, perfil e ativação da clínica.
 *
 * Toda rota exige `config` ("Unidades, usuários e acessos"), e o servidor é
 * quem valida: a tela é conveniência (regra 16).
 *
 * `config` e **não** `pessoas.gerir`, porque são duas telas com públicos
 * diferentes: "Equipe" é ficha, contrato, férias e salário — RH, onde
 * `pessoas.gerir` vale. Aqui é quem entra e com qual perfil. Juntar as duas
 * poria salário e permissão na mesma tela (nota lida da navegação dela, em
 * `docs/paridade.md`).
 *
 * **Não há senha de ninguém em nenhuma destas respostas**, e é o ponto da D-0:
 * na v20 o administrativo lê o PIN de cada pessoa nesta mesma tela. A única
 * senha que trafega é a provisória recém-gerada, uma vez, para quem acabou de
 * criá-la ou redefini-la.
 */
@Controller('v1/pessoas')
@Exige('config')
export class PessoasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(PessoasService) private readonly pessoas: PessoasService,
    @Inject(AcessoService) private readonly acesso: AcessoService,
  ) {}

  @Get()
  async listar(@Req() req: RequisicaoComContexto): Promise<ListaDePessoas> {
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.acesso.listar({ clinicaId: c.clinicaId, ator: c.ator })
  }

  /**
   * Os perfis da clínica, para a aba "Perfis de acesso".
   *
   * `GET /v1/eu` também devolve `perfis` — de propósito, porque é de lá que
   * toda tela monta o menu. A diferença é o momento: depois de salvar a matriz,
   * a tela precisa da lista nova sem recarregar a sessão inteira, e um `GET`
   * próprio é o que permite recarregar só o que mudou.
   */
  @Get('perfis')
  async perfis(@Req() req: RequisicaoComContexto): Promise<ListaDePerfis> {
    const c = req.contexto!
    return this.acesso.perfis({ clinicaId: c.clinicaId, ator: c.ator })
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<PessoaCriada> {
    const dados = CriarPessoaEntrada.safeParse(corpo)
    if (!dados.success) {
      // A mensagem da PRIMEIRA questão: ela é a do domínio quando o problema
      // é o usuário, e é ela que a tela mostra. Uma frase genérica aqui faria
      // o admin adivinhar o que está errado no balcão.
      throw new BadRequestException(
        dados.error.issues[0]?.message ?? 'Confira os dados da pessoa.',
      )
    }

    try {
      return await this.pessoas.criar(req.contexto!, dados.data)
    } catch (e) {
      if (e instanceof UsuarioJaExiste) {
        throw new ConflictException('Esse usuário já existe nesta clínica. Escolha outro.')
      }
      // Perfil de outra clínica, ou perfil que não existe mais. 400 e não 404:
      // o recurso pedido é a PESSOA, e o que está errado é o corpo.
      if (e instanceof PerfilNaoExiste) throw new BadRequestException('Esse perfil não existe.')
      throw e
    }
  }

  /**
   * Nome, função, acesso e ativação — o `pessoasOp` dela, numa rota só.
   *
   * **Não há `DELETE`**: desativar é um estado, nunca uma exclusão (regra 20, e
   * a mesma decisão da ADR 0003 para paciente). O protótipo tem as duas coisas
   * e as duas produzem o mesmo efeito observável — quem está inativo não entra,
   * porque `login` exige `u.ativo`. Duas representações do mesmo fato divergem
   * no dia em que alguém usa uma e não a outra.
   */
  @Patch(':id')
  async editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<PessoaNaLista> {
    const dados = EditarPessoa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.acesso.editar({ clinicaId: c.clinicaId, ator: c.ator }, id, dados.data)
  }

  /**
   * **EXCLUIR a pessoa** — e excluir é SOFT DELETE (regra 20).
   *
   * `DELETE` como VERBO, `UPDATE` como efeito: o verbo descreve a intenção do
   * chamador ("tire esta pessoa da equipe"), e a implementação é o estado
   * `excluida_em`. A linha fica, e o histórico dela continua ligado — tarefa,
   * recebimento, movimento de estoque e trilha seguem apontando para ela.
   * Apagar de verdade mudaria o passado da clínica, e as FKs `NOT NULL`
   * recusariam de qualquer forma.
   *
   * **204 e sem corpo:** não há o que devolver. A lista recarrega e a pessoa
   * não está nela.
   *
   * Três recusas possíveis, e cada uma diz uma coisa:
   *  - **404** a pessoa não existe nesta clínica, ou já foi excluída.
   *  - **422** o domínio recusou, com o `codigo` e a frase dele: *ninguém se
   *    exclui*, e *a clínica não fica sem administradora ativa*.
   *  - **403** a sessão é a de suporte do painel, que não assina — não é o
   *    caso aqui (excluir não grava pessoa em coluna nenhuma), e por isso
   *    **o operador PODE excluir**.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async excluir(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequisicaoComContexto,
  ): Promise<void> {
    const c = req.contexto!
    await this.acesso.excluir({ clinicaId: c.clinicaId, ator: c.ator }, id)
  }

  /**
   * Redefine a senha de outra pessoa. Corpo vazio **de propósito**: não há o
   * que escolher — nem a senha, nem o prazo. O servidor gera e devolve uma
   * vez.
   */
  @Post(':id/senha')
  @HttpCode(HttpStatus.OK)
  async redefinirSenha(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<SenhaRedefinida> {
    const pessoaId = Uuid.safeParse(id)
    // Id malformado é 404, nunca 400: responder 400 para um uuid inválido e
    // 404 para um uuid válido inexistente distingue os dois para quem sonda.
    if (!pessoaId.success) throw new NotFoundException('Pessoa não encontrada.')

    // `?? {}` porque a tela que NÃO escolhe a senha não manda corpo nenhum, e
    // `undefined` não passa por um schema `.strict()`. O caminho antigo
    // continua valendo sem mudar uma linha no cliente.
    const dados = RedefinirSenha.safeParse(corpo ?? {})
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))

    try {
      return await this.pessoas.redefinirSenha(req.contexto!, pessoaId.data, dados.data.senha)
    } catch (e) {
      if (e instanceof PessoaNaoExiste) throw new NotFoundException('Pessoa não encontrada.')
      // 422 e não 400: o corpo está bem formado, a senha é que não serve — e a
      // frase vem do DOMÍNIO, a mesma que a troca própria mostra. É o mesmo
      // status de `POST /v1/eu/senha`, porque é a mesma recusa.
      if (e instanceof SenhaFraca) {
        throw new HttpException(e.message, HttpStatus.UNPROCESSABLE_ENTITY)
      }
      throw e
    }
  }

  /**
   * A matriz de perfis, **inteira** — o `salvarPerfis` dela.
   *
   * `PUT` e não `PATCH`: a tela edita a matriz toda e manda a matriz toda. O
   * perfil que sai do corpo é desativado, nunca apagado, e a recusa de "perfil
   * em uso" vem do domínio nomeando quem — `podeRemoverPerfis`.
   */
  @Put('perfis')
  async salvarPerfis(
    @Body() corpo: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<ListaDePerfis> {
    const dados = SalvarPerfis.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    const c = req.contexto!
    return this.acesso.salvarPerfis({ clinicaId: c.clinicaId, ator: c.ator }, dados.data)
  }
}
