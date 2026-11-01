import { FiltroDoPainel, type Painel } from '@fir/contracts'
import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import type { RequisicaoComContexto } from '../comum/contexto'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { PainelService } from './painel.service'

/**
 * **Gestão › Painel geral** (MANUAL cap. 10) — a tela da CLÍNICA.
 *
 * `@Exige('painel')`, e **`painel` depende de `valores`** na matriz de
 * permissões (regra 16): quem abre esta tela vê dinheiro, e a dependência
 * mora na TABELA, não num `if` aqui. Mesmo assim os campos monetários passam
 * pela redação — uma dependência que alguém mude amanhã não pode virar um
 * vazamento hoje.
 *
 * **Nada a ver com `/v1/superadmin`.** `CONTEXT.md` abre proibindo chamar o
 * painel do superadmin de `painel`: a allowlist de IP do Traefik casa o
 * segmento `superadmin`, e uma rota de produto lá dentro ficaria bloqueada
 * para a clínica inteira — *"dá 403 para todo mundo menos para o escritório"*.
 *
 * **O período vem como CHAVE, não como datas.** `7d`, `30d`, `mes` e `ant`
 * são resolvidos no servidor, no fuso da clínica (regra 24); só `per` manda
 * as duas bordas, e o contrato cobra que venham as duas e na ordem.
 */
@Controller('v1/painel')
@Exige('painel')
export class PainelController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(PainelService) private readonly painel: PainelService) {}

  @Get()
  async ver(
    @Query() consulta: unknown,
    @Req() req: RequisicaoComContexto,
  ): Promise<Painel> {
    const filtro = FiltroDoPainel.safeParse(consulta)
    if (!filtro.success) throw new BadRequestException(primeiroErro(filtro.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.painel.painel(
      { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
      filtro.data,
    )
  }
}
