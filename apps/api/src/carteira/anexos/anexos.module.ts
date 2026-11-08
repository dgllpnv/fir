import { Module } from '@nestjs/common'
import { AnexosCarteiraController, AnexosDoPortalController, TetoDoCorpoDoAnexo } from './anexos.controller'
import { AnexosService } from './anexos.service'
import {
  ARMAZENAMENTO_DE_ANEXOS,
  ArmazenamentoCifradoEmDisco,
  diretorioDeAnexosDoAmbiente,
  segredoDeAnexosDoAmbiente,
} from './armazenamento-de-anexos'

/**
 * ANEXOS DE ARQUIVO da carteira (G8 4C, A-13) — genérico pelo dono (reunião
 * ou documento), pronto para as duas telas usarem.
 *
 * Duas rotas-família num módulo só, e é de propósito: a regra de entrega
 * (cabeçalhos do A-13, registro de acesso, só `limpo`) é a mesma para a
 * equipe e para o portal, e duas cópias dela divergem. Cada controlador
 * continua no espaço de identidade dele (`@SoUsuarioDeGestao` sob
 * `/v1/carteira`, `@SoUsuarioDoPortal` sob `/v1/portal`) — os guards globais
 * fazem o resto.
 *
 * A varredura NÃO roda aqui: é o `worker-anexos.ts`, processo irmão.
 */
@Module({
  controllers: [AnexosCarteiraController, AnexosDoPortalController],
  providers: [
    AnexosService,
    TetoDoCorpoDoAnexo,
    {
      provide: ARMAZENAMENTO_DE_ANEXOS,
      useFactory: () => new ArmazenamentoCifradoEmDisco(diretorioDeAnexosDoAmbiente(), segredoDeAnexosDoAmbiente()),
    },
  ],
})
export class CarteiraAnexosModule {}
