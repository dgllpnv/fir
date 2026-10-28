import { Module } from '@nestjs/common'
import { provedorDeRelogio } from '../comum/relogio'
import { PessoasController } from './pessoas.controller'
import { PessoasService } from './pessoas.service'

@Module({
  controllers: [PessoasController],
  providers: [PessoasService, provedorDeRelogio],
})
export class PessoasModule {}
