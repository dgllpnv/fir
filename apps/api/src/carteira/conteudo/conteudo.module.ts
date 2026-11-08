import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../../comum/relogio'
import { ConteudoCarteiraController } from './conteudo.controller'
import { PersonalizadosDaBibliotecaController } from './personalizados-da-biblioteca.controller'
import { DocumentosEMateriaisService } from './documentos-e-materiais.service'
import { ReunioesCarteiraService } from './reunioes.service'

/**
 * G8 1B — reuniões, documentos e materiais escritos pela equipe Firmare
 * (V13, V14, X2 na parte do cliente). O `CarteiraGuard` global protege as
 * rotas pela metadata de `@SoUsuarioDeGestao()`; `BancoService` vem do
 * `BancoModule` global.
 */
@Module({
  // G8 3D: o filtro "Personalizados" da Biblioteca.
  controllers: [ConteudoCarteiraController, PersonalizadosDaBibliotecaController],
  providers: [ReunioesCarteiraService, DocumentosEMateriaisService, provedorDeRelogio],
})
export class CarteiraConteudoModule {}
