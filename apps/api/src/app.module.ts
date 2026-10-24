import { Module } from '@nestjs/common'
import { BancoModule } from './banco/banco.module.js'
import { SaudeController } from './saude/saude.controller.js'

@Module({ imports: [BancoModule], controllers: [SaudeController] })
export class AppModule {}
