import { TrilhaConsulta, type TrilhaSaida } from '@fir/contracts'
import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { DadoSensivel } from './acesso.decorator'
import { AuditoriaService } from './auditoria.service'

/**
 * A ROTA MAIS PERIGOSA DO SISTEMA, e vale escrever por quê.
 *
 * Toda outra rota entrega uma fatia do dado da clínica, e cada uma carrega os
 * próprios controles. Esta entrega o `de`/`para` de TODA escrita — hoje nome
 * e e-mail em claro, no épico 7 salário, no 6 dose e lote por paciente — num
 * só `GET`. Se as regras 17 e 18 valem em algum lugar, valem aqui primeiro.
 *
 * Três controles, e nenhum deles substitui os outros:
 *
 *  1. `@Exige('config')` — a chave de Configurações, que na matriz de
 *     permissões é de quem administra a clínica. Não `painel`, que é
 *     indicador, nem `pessoas.gerir`, que é RH: ler a trilha é ato de
 *     administração.
 *  2. `naClinica` + RLS, no serviço. Duas camadas, regra 19.
 *  3. O `RedacaoInterceptor`, que atravessa `de`/`para` como atravessa
 *     qualquer campo — por isso o salário sai `null` para quem não tem
 *     `pessoas.gerir`, sem um `if` aqui dentro.
 *
 * E `@DadoSensivel`: quem lê a trilha de todo mundo também fica na trilha.
 * Não há exceção para o administrador — se houvesse, a única leitura que
 * ninguém consegue auditar seria justamente a mais ampla do sistema.
 */
@Controller('v1')
export class AuditoriaController {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(@Inject(AuditoriaService) private readonly auditoria: AuditoriaService) {}

  @Get('auditoria')
  @Exige('config')
  @DadoSensivel('auditoria', { lista: true })
  async trilha(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<TrilhaSaida> {
    // Nada entra sem passar pelo esquema — inclusive `limite`, que sem teto
    // vira "me dá a trilha inteira" numa rota que entrega dado sensível.
    const dados = TrilhaConsulta.safeParse(consulta)
    if (!dados.success) throw new BadRequestException('Confira os filtros da consulta.')

    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()` —
    // sem contexto ela responde 401 antes de chegar aqui. Mesmo raciocínio
    // de `AutenticacaoController.eu`.
    const c = req.contexto!
    // A clínica vem do CONTEXTO, nunca da query: ver `banco/clinica-id.ts`.
    return this.auditoria.listar(c.clinicaId, c.ator, dados.data)
  }
}
