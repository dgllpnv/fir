import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { AcessoService } from './acesso.service'
import { PessoasController } from './pessoas.controller'
import { PessoasService } from './pessoas.service'

@Module({
  controllers: [PessoasController],
  providers: [PessoasService, AcessoService, provedorDeRelogio],
})
export class PessoasModule {}
