import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { RegraDoBeneficioController } from './beneficios-regra.controller'
import { BeneficiosDeIndicacaoController } from './beneficios.controller'
import { BeneficiosDeIndicacaoService } from './beneficios.service'
import { CobrancasCarteiraController } from './cobrancas.controller'
import { CobrancasCarteiraService } from './cobrancas.service'
import { IndicadoresCarteiraController } from './indicadores.controller'
import { IndicadoresCarteiraService } from './indicadores.service'
import { MetasComerciaisController } from './metas.controller'
import { MetasComerciaisService } from './metas.service'

/**
 * **G3 — indicadores, metas comerciais e a cobrança do Cliente Firmare.**
 *
 * `CarteiraGuard` e `@SoUsuarioDeGestao()` já protegem estas rotas — o guard é
 * GLOBAL (`APP_GUARD` em `app.module.ts`, registrado pelo `CarteiraModule`) e
 * lê a metadata do decorador em cada controlador deste módulo, então este
 * módulo não precisa (e não deve) registrar um guard próprio.
 *
 * `BancoService` já é provido globalmente por `BancoModule` — nenhum provider
 * de banco nasce aqui.
 */
@Module({
  controllers: [
    IndicadoresCarteiraController,
    MetasComerciaisController,
    CobrancasCarteiraController,
    BeneficiosDeIndicacaoController,
    // G8 3D: "Alterar regra" do benefício (T5, L12).
    RegraDoBeneficioController,
  ],
  providers: [
    IndicadoresCarteiraService,
    MetasComerciaisService,
    CobrancasCarteiraService,
    BeneficiosDeIndicacaoService,
    // O painel de Mensalidades calcula o "hoje" no fuso da carteira (1F).
    provedorDeRelogio,
  ],
})
export class CarteiraFinanceiroModule {}
