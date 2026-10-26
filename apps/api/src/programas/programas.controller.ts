import { MontarPrograma, type ProgramaMontadoNaSaida } from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { ProgramasService } from './programas.service'

/**
 * `POST /v1/programas` — Nova adesão.
 *
 * **Divergência consciente do protótipo.** Lá, `criarAdesao` não exige
 * permissão nenhuma: qualquer pessoa logada monta um programa **e lança o
 * pagamento**. O `Code.gs` idem. Aqui a rota exige `programas`, e `receber` é
 * cobrado NO CORPO — a enfermagem tem `programas` e não tem `receber`: ela
 * monta o programa, e o pagamento vai pela tela Recebimentos. A rota que cria
 * dinheiro é gated, sem exceção (é a mesma decisão D-7 do épico 3).
 */
@Controller('v1/programas')
@Exige('programas')
export class ProgramasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(ProgramasService) private readonly programas: ProgramasService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async montar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<ProgramaMontadoNaSaida> {
    const dados = MontarPrograma.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!

    /**
     * A COBRANÇA DE `receber` É NO CONTROLADOR, não no decorador.
     *
     * `@Exige` é estático; "tem dinheiro no corpo" não é. E a checagem vem
     * ANTES de qualquer escrita: 403 com o banco intocado, e não um rollback
     * que depende de a transação ter sido aberta corretamente.
     */
    if (dados.data.pagamento !== undefined && !c.pode('receber')) {
      throw new ForbiddenException(
        'Para lançar o pagamento da adesão você precisa da permissão de recebimentos. ' +
          'Crie o programa sem valor e registre o pagamento pela tela Recebimentos.',
      )
    }

    return this.programas.montar(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      dados.data,
    )
  }
}
