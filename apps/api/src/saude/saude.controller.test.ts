import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module.js'

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
