import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { AcessoService } from './acesso.service'
import { EquipeController } from './equipe.controller'
import { EquipeService } from './equipe.service'
import { PessoasController } from './pessoas.controller'
import { PessoasService } from './pessoas.service'

/**
 * As DUAS telas de pessoa, no mesmo módulo e com chaves diferentes.
 *
 * `PessoasController` (`config`) é *Usuários e acessos*: login, perfil,
 * ativação. `EquipeController` (`pessoas.gerir`) é *Equipe*: ficha, contrato,
 * férias, documentos, banco de horas e **salário**.
 *
 * Mesmo módulo porque compartilham `pessoas` como tabela e o conceito de
 * desativação; chaves diferentes porque os públicos são diferentes, e juntar
 * as duas telas poria salário e permissão na mesma tela.
 */
@Module({
  controllers: [PessoasController, EquipeController],
  providers: [PessoasService, AcessoService, EquipeService, provedorDeRelogio],
})
export class PessoasModule {}
