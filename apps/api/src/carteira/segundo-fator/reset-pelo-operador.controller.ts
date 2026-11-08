import { ResetarSegundoFatorEntrada, Uuid } from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import type { RequisicaoComPainel } from '../../painel/contexto-do-painel'
import { SoOperador } from '../../painel/so-operador.decorator'
import { SegundoFatorDaCarteiraService, UsuarioDeGestaoInexistenteNoReset } from './segundo-fator.service'

/**
 * O RESET do segundo fator de um `Usuário de Gestão` — só o `Operador`
 * (A-12). Apaga o segredo e os códigos, revoga todas as sessões e desafios;
 * o próximo login cai no cadastro. Motivo obrigatório, na
 * `auditoria_do_painel`.
 *
 * O procedimento de confirmar a identidade FORA DE BANDA antes de resetar
 * está no runbook (`infra/producao/README.md`): reset por pedido de
 * WhatsApp é o ataque.
 *
 * Sob `/v1/superadmin`, na sessão do painel, como as outras escritas de
 * identidade da carteira (ADR 0011).
 */
@SoOperador()
@Controller('v1/superadmin')
export class ResetDoSegundoFatorDaCarteiraController {
  constructor(@Inject(SegundoFatorDaCarteiraService) private readonly servico: SegundoFatorDaCarteiraService) {}

  @Post('usuarios-gestao/:id/segundo-fator/resetar')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetar(@Param('id') id: string, @Body() corpo: unknown, @Req() req: RequisicaoComPainel): Promise<void> {
    if (!Uuid.safeParse(id).success) throw new NotFoundException('Usuário de gestão não encontrado.')
    const dados = ResetarSegundoFatorEntrada.safeParse(corpo)
    if (!dados.success) {
      throw new BadRequestException('Escreva o motivo e como a identidade foi confirmada (mínimo 10 caracteres).')
    }
    try {
      await this.servico.resetarPeloOperador(req.painel!.ator, id, dados.data.motivo)
    } catch (e) {
      if (e instanceof UsuarioDeGestaoInexistenteNoReset) throw new NotFoundException('Usuário de gestão não encontrado.')
      throw e
    }
  }
}
