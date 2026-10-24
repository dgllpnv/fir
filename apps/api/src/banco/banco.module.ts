import { Global, Module } from '@nestjs/common'
import { BancoService } from './banco.service.js'

@Global()
@Module({ providers: [BancoService], exports: [BancoService] })
export class BancoModule {}
