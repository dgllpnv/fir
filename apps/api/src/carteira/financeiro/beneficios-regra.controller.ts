import { AlterarRegraDoBeneficioEntrada, type RegraDoBeneficioSaida } from '@fir/contracts'
import { podeAdministrarConteudo } from '@fir/domain'
import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Put, Req } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'
import { alterarPercentualDoBeneficioDeIndicacao, percentualDoBeneficioDeIndicacao } from './beneficios.regra'

/**
 * **"Alterar regra" do benefício por indicação** (T5, L12; protótipo L2542,
 * L2656, `editBenef` L2956). G8 3D.
 *
 * Tela "prospeccao" (`beneficios/**` em `modulos-das-rotas.ts`). Ler é de
 * quem vê os benefícios; ALTERAR é da diretoria (`admin()` no protótipo):
 * escopo geral e `carteira.administrar` (D-22 item 2). Primeira camada aqui,
 * com `temPermCarteira`; a segunda é a policy de edição da 0056, e a recusa
 * dela (zero linha) também vira 403.
 *
 * A regra não é dinheiro (é um percentual), então não passa pela redação; a
 * mensalidade a que ela se aplica é que é, e essa já sai redigida onde
 * aparece.
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira/beneficios/regra')
export class RegraDoBeneficioController {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  @Get()
  async ler(@Req() req: RequisicaoComCarteira): Promise<RegraDoBeneficioSaida> {
    const sessao = req.carteira!.usuarioDeGestao
    const percentual = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, (c) =>
      percentualDoBeneficioDeIndicacao(c),
    )
    return { percentualCentesimos: percentual.toString(), podeAlterar: podeAdministrarConteudo(sessao) }
  }

  @Put()
  async alterar(@Body() corpo: unknown, @Req() req: RequisicaoComCarteira): Promise<RegraDoBeneficioSaida> {
    const sessao = req.carteira!.usuarioDeGestao
    if (!podeAdministrarConteudo(sessao)) {
      throw new ForbiddenException('Só a diretoria altera a regra do benefício.')
    }
    const dados = AlterarRegraDoBeneficioEntrada.safeParse(corpo)
    if (!dados.success) throw new BadRequestException('Informe um desconto entre 0,01% e 100%.')
    const percentual = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      if (!(await alterarPercentualDoBeneficioDeIndicacao(c, dados.data.percentualCentesimos))) return null
      return percentualDoBeneficioDeIndicacao(c)
    })
    if (percentual === null) throw new ForbiddenException('Só a diretoria altera a regra do benefício.')
    return { percentualCentesimos: percentual.toString(), podeAlterar: true }
  }
}
