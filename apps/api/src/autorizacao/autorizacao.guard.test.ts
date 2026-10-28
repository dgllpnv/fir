import type { ChaveDePermissao } from '@fir/domain'
import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  Injectable,
  Module,
} from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pessoaIdDeFonteConfiavel } from '../banco/ator'
import { clinicaIdDeFonteConfiavel } from '../banco/clinica-id'
import type { ContextoDaRequisicao, RequisicaoComContexto } from '../comum/contexto'
import { AutorizacaoGuard, Exige } from './autorizacao.guard'

/**
 * Nenhuma rota do Plano 1 usa `@Exige` — ela existe para os Planos 2 a 8.
 * Um decorador cuja primeira execução acontece no dia em que alguém depende
 * dele não é um decorador testado, então este módulo de mentira existe só
 * para exercê-lo: três rotas (sem exigência, exigindo `estoque`, exigindo
 * `pessoas.gerir`) e um contexto injetado por cabeçalho, sem banco.
 */
@Controller('mentira')
class RotaDeMentiraController {
  @Get('aberta')
  aberta(): { ok: true } {
    return { ok: true }
  }

  @Get('estoque')
  @Exige('estoque')
  estoque(): { ok: true } {
    return { ok: true }
  }

  @Get('rh')
  @Exige('pessoas.gerir')
  rh(): { ok: true } {
    return { ok: true }
  }
}

/**
 * Substitui o `SessaoGuard` no lugar que ele ocupa na cadeia: popula
 * `req.contexto`. As permissões vêm do cabeçalho `x-perms` para que o teste
 * não precise de Postgres, sessão nem Argon2 — o que está sob teste é o
 * `AutorizacaoGuard`, e nada mais.
 *
 * Sem o cabeçalho, nenhum contexto é anexado: é o caso "rota com @Exige sem
 * autenticação", que precisa recusar.
 */
@Injectable()
class ContextoDeMentiraGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<RequisicaoComContexto & { headers: Record<string, string | undefined> }>()
    const cru = req.headers['x-perms']
    if (cru === undefined) return true

    const perms = cru.split(',').filter((x) => x !== '') as ChaveDePermissao[]
    req.contexto = {
      // `ClinicaId` é nominal: a string crua não compila aqui, e é esse o
      // ponto — ver `banco/clinica-id.ts`.
      clinicaId: clinicaIdDeFonteConfiavel('00000000-0000-0000-0000-000000000001'),
      clinicaCodigo: 'mentira',
      clinicaNome: 'Clínica de Mentira',
      clinicaFuso: 'America/Bahia',
      // `PessoaId` é nominal pela mesma razão de `ClinicaId` — ver
      // `banco/ator.ts`.
      ator: pessoaIdDeFonteConfiavel('00000000-0000-0000-0000-000000000002'),
      usuario: {
        id: '00000000-0000-0000-0000-000000000002',
        nome: 'Pessoa de Mentira',
        usuario: 'mentira',
        funcao: 'Teste',
        admin: false,
        perfilId: null,
        ativo: true,
        senhaProvisoria: false,
      },
      perfis: [],
      pode: (chave) => perms.includes(chave),
    } satisfies ContextoDaRequisicao
    return true
  }
}

@Module({
  controllers: [RotaDeMentiraController],
  providers: [
    { provide: APP_GUARD, useClass: ContextoDeMentiraGuard },
    { provide: APP_GUARD, useClass: AutorizacaoGuard },
  ],
})
class ModuloDeMentira {}

let app: NestFastifyApplication

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [ModuloDeMentira] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await app.close()
})

const pedir = (caminho: string, perms?: string) => {
  const r = request(app.getHttpServer()).get(caminho)
  return perms === undefined ? r : r.set('x-perms', perms)
}

describe('@Exige', () => {
  it('rota SEM @Exige passa — autenticação já foi feita pelo guard de sessão', async () => {
    await pedir('/mentira/aberta', '').expect(200)
  })

  it('libera quem tem a permissão exigida', async () => {
    await pedir('/mentira/estoque', 'estoque').expect(200)
  })

  it('recusa com 403 quem NÃO tem a permissão exigida', async () => {
    const r = await pedir('/mentira/estoque', 'jornada,pacientes').expect(403)
    // Uma frase só, sem nomear a chave que falta: a lista do que existe atrás
    // da porta não se entrega a quem está do lado de fora.
    expect(r.body.message).toBe('Sem acesso a esta ação.')
    expect(JSON.stringify(r.body)).not.toContain('estoque')
  })

  it('permissão de outra chave não serve — `pessoas.gerir` não vem com `estoque`', async () => {
    await pedir('/mentira/rh', 'estoque,estoque.gerir').expect(403)
    await pedir('/mentira/rh', 'pessoas.gerir').expect(200)
  })

  it('sem contexto (rota com @Exige e sem sessão) recusa, nunca libera', async () => {
    // `x-perms` ausente = o guard de mentira não anexa contexto. É o caso
    // contraditório "@Publico() + @Exige": falha fechada.
    await pedir('/mentira/estoque').expect(403)
    await pedir('/mentira/aberta').expect(200)
  })
})
