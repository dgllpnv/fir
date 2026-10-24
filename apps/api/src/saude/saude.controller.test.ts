import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module'
import { BancoService } from '../banco/banco.service'

let app: NestFastifyApplication

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await app.close()
})

describe('GET /v1/saude', () => {
  it('responde ok quando o banco responde', async () => {
    const r = await request(app.getHttpServer()).get('/v1/saude').expect(200)
    expect(r.body).toEqual({ ok: true, banco: true })
  })
})

/**
 * Banco de mentira cujo `semIsolamentoDeClinica` rejeita — mais rápido e mais
 * confiável que derrubar o container Postgres para provar o mesmo caminho.
 */
class BancoFalho {
  semIsolamentoDeClinica(): Promise<never> {
    return Promise.reject(new Error('banco fora'))
  }
}

describe('GET /v1/saude — banco fora', () => {
  let appFalho: NestFastifyApplication

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BancoService)
      .useValue(new BancoFalho())
      .compile()
    appFalho = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
    await appFalho.init()
    await appFalho.getHttpAdapter().getInstance().ready()
  })

  afterAll(async () => {
    await appFalho.close()
  })

  it('responde 503 com o corpo {ok:false, banco:false} quando o banco não responde', async () => {
    const r = await request(appFalho.getHttpServer()).get('/v1/saude').expect(503)
    expect(r.body).toEqual({ ok: false, banco: false })
  })
})
