import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from './app.module.js'

const PORTA = Number(process.env['PORTA'] ?? 4811)

/**
 * `HOST` vem do ambiente porque os dois casos são diferentes e os dois
 * importam: em desenvolvimento, `127.0.0.1` evita expor a API na rede do
 * escritório; no container, só o `web` e nada mais alcança a rede interna, e
 * ligar em `127.0.0.1` faria nem ele alcançar.
 */
const HOST = process.env['HOST'] ?? '127.0.0.1'

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
await app.listen(PORTA, HOST)
process.stdout.write(`API em http://${HOST}:${PORTA}\n`)
