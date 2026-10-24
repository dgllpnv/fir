import { Global, Module } from '@nestjs/common'
import { BancoService } from './banco.service'

@Global()
@Module({ providers: [BancoService], exports: [BancoService] })
export class BancoModule {}
