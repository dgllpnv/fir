import {
  type CampanhasVinculaveis,
  ConsultaDeCampanhasVinculaveis,
} from '@fir/contracts'
import { campanhasVinculaveis } from '@fir/domain'
import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import { BancoService } from '../banco/banco.service'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../comum/primeiro-erro'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { lerCampanhasDeVinculo } from './vinculo'

/**
 * `GET /v1/campanhas/vinculaveis` — as campanhas que se pode MARCAR numa
 * tarefa, num recebimento ou no cadastro da paciente (correções da PO, A3).
 *
 * ## SEM `@Exige`, e a razão
 *
 * Quem cria tarefa (todos — `menu.ts`, `perm: null`), quem recebe (`receber`)
 * e quem cadastra (`pacientes`) precisa escolher a campanha, e nenhum dos três
 * precisa da permissão `campanhas`, que é a de VER o relatório. Exigir
 * `campanhas` aqui obrigaria a dá-la a quem só agenda consulta — e com ela
 * viriam meta, receita e conversão. A sessão de clínica é exigida pelo
 * `SessaoGuard` global; o que esta rota entrega é **só `{ id, nome }`** (S-9,
 * L-A3-2), e é por isso que ela pode ser de todos.
 *
 * Controlador próprio, e não um método de `CampanhasController`: aquele tem
 * `@Exige('campanhas')` na CLASSE, e um `@Exige` mais fraco por método é a
 * exceção que o próximo método copia sem ler.
 *
 * ## A sugestão NÃO sai daqui (L-A3-8)
 *
 * "A paciente chegou pela campanha X" é origem do paciente, e essa leitura
 * grava trilha de acesso com o id DELA. O `@DadoSensivel` tira o id do caminho
 * e marca toda resposta; aqui ele gravaria `(lista)` para todo mundo. Por isso
 * a sugestão tem rota própria, `GET /v1/pacientes/:id/campanha-sugerida`, e o
 * `?paciente=` desta rota dá 400 (`.strict()` do contrato).
 */
@Controller('v1/campanhas/vinculaveis')
export class CampanhasVinculaveisController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  @Get()
  async listar(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<CampanhasVinculaveis> {
    const q = ConsultaDeCampanhasVinculaveis.safeParse(consulta)
    if (!q.success) throw new BadRequestException(primeiroErro(q.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const ctx = req.contexto!
    const agora = this.relogio.agora()
    const fuso = ctx.clinicaFuso

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const campanhas = await lerCampanhasDeVinculo(c, ctx.clinicaId)
      return { itens: campanhasVinculaveis(campanhas, q.data.contexto, agora, fuso, q.data.incluir) }
    })
  }
}
