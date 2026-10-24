# Plano 1 — Fundação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr de pé o monorepo, o ambiente local pelo `fir.bat`, o núcleo puro do domínio (Dinheiro, Quantidade, Relógio, Permissões, Tipos), o banco multi-clínica com RLS e a autenticação por e-mail e senha — terminando com uma pessoa entrando no sistema e vendo a tela Hoje vazia.

**Architecture:** Monorepo pnpm + Turborepo. `packages/domain` é puro e não importa nada; `packages/contracts` valida com Zod e importa o domínio; `apps/api` (NestJS + Fastify) e `apps/web` (Next.js) importam os dois. O isolamento entre clínicas é do Postgres (RLS com `app.clinica_id`), e a aplicação filtra como segunda camada. A redação de valores monetários acontece num **interceptor único**, nunca por endpoint.

**Tech Stack:** TypeScript 5.7 estrito · NestJS + Fastify · PostgreSQL 17 + Drizzle · Redis 7 · Next.js App Router · Vitest + fast-check + Testcontainers · Docker Compose

## Global Constraints

Herdadas de `docs/superpowers/plans/2026-10-23-mapa-de-execucao.md` §1. Resumo normativo:

- Node `>=22` · pnpm `11.25.0` · TypeScript `^5.7` com `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` · Turborepo `^2` · Postgres `17-alpine` · Redis `7-alpine`
- **Dinheiro: inteiro de centavos** (`BIGINT`/`bigint`), dentro de `Dinheiro`. Nunca `number`.
- **Quantidade: inteiro de milésimos da `medida`** (`BIGINT`/`bigint`), dentro de `Quantidade`. 1 ampola = `1000n`.
- `TIMESTAMPTZ` UTC no banco; containers com `TZ=UTC` e `PGTZ=UTC`; **fuso é propriedade da `Clinica`**.
- Janela de período sempre semiaberta `[início, fim)`.
- Portas **48xx** em `127.0.0.1`: Postgres 4832 · Redis 4879 · API 4811 · Web 4810 · Mailpit 4825/4826.
- Domínio em português, infraestrutura em inglês.
- `any` proibido. `UPDATE`/`DELETE` em tabela append-only proibido. Rota sem authz no servidor proibida.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` | Raiz do monorepo e scripts |
| `infra/docker-compose.yml`, `infra/bootstrap-papeis.sql` | Containers locais e papéis do banco |
| `fir.bat` | Ambiente local em um comando |
| `packages/domain/src/resultado.ts` | `Result<T,E>` e `ErroDeDominio` |
| `packages/domain/src/dinheiro.ts` | Centavos, rateio |
| `packages/domain/src/quantidade.ts` | Milésimos, conversão entre unidades |
| `packages/domain/src/relogio.ts` | Relógio injetado, dia civil no fuso, janela `[,)` |
| `packages/domain/src/permissoes.ts` | `PERMS`, `PERFIS_PADRAO`, `temPerm`, campos redigidos |
| `packages/domain/src/tipos-de-tarefa.ts` | Tabela `TIPOS` com as flags e os helpers |
| `apps/api/migrations/0001_fundacao.sql` | Papéis, `clinicas`, função de RLS |
| `apps/api/migrations/0002_identidade.sql` | `perfis`, `pessoas`, `sessoes`, `tentativas_login` |
| `apps/api/src/comum/clinica.middleware.ts` | Fixa `app.clinica_id` na transação |
| `apps/api/src/comum/redacao.interceptor.ts` | **O tradutor único** de campos monetários |
| `apps/api/src/autenticacao/*` | Argon2id, sessão, limite de tentativas |
| `apps/api/src/autorizacao/autorizacao.guard.ts` | `@Exige('chave')` no servidor |
| `apps/web/src/app/*` | Shell, entrada, Hoje vazia |
| `teste/*.ts` | Os quatro testes transversais |

---

### Task 1: Esqueleto do monorepo

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/vitest.config.ts`

**Interfaces:**
- Produces: workspace `@fir/domain`; scripts `pnpm typecheck`, `pnpm test`, `pnpm test:domain`

- [ ] **Step 1: Criar os manifestos da raiz**

`package.json`:
```json
{
  "name": "fir",
  "private": true,
  "packageManager": "pnpm@11.25.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "test:domain": "pnpm --filter @fir/domain test",
    "typecheck": "turbo run typecheck",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "db:migrate": "pnpm --filter @fir/api db:migrate",
    "db:seed": "pnpm --filter @fir/api db:seed"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5.7",
    "vitest": "^2"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true, "envMode": "loose" }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
.next/
.turbo/
*.log
infra/producao/.env
infra/producao/redis.conf
```

- [ ] **Step 2: Criar o pacote de domínio**

`packages/domain/package.json`:
```json
{
  "name": "@fir/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "build": "tsc"
  },
  "devDependencies": {
    "fast-check": "^3",
    "vitest": "^2",
    "typescript": "^5.7"
  }
}
```

`packages/domain/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/domain/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
```

`packages/domain/src/index.ts`:
```ts
export const VERSAO_DO_DOMINIO = '0.0.0'
```

- [ ] **Step 3: Instalar e verificar**

Run: `pnpm install && pnpm typecheck`
Expected: PASS, sem erro de tipo.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: esqueleto do monorepo com pacote de dominio"
```

---

### Task 2: Ambiente local — Docker e `fir.bat`

**Files:**
- Create: `infra/docker-compose.yml`, `infra/bootstrap-papeis.sql`, `infra/README.md`, `fir.bat`

**Interfaces:**
- Produces: Postgres em `127.0.0.1:4832` (usuário `fir`, senha `fir_local_dev`, banco `fir`), Redis em `4879`, Mailpit em `4825`/`4826`; comandos `fir`, `fir infra`, `fir down`, `fir reset`, `fir status`, `fir logs`, `fir psql`

- [ ] **Step 1: Escrever o compose local**

`infra/docker-compose.yml`:
```yaml
# Ambiente local do Firmare Rotinas de Gestão.
#
# Bloco 48xx: 47xx é do Mavia, que roda na mesma máquina. 80, 8080, 5432 e
# 6379 estão fora por decisão do dono. Ver infra/README.md.
#
# Toda porta publicada em 127.0.0.1 de propósito: sem o prefixo, o Docker abre
# no 0.0.0.0 e expõe o banco para a rede local inteira.

name: fir-dev

services:
  postgres:
    image: postgres:17-alpine
    container_name: fir-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: fir
      POSTGRES_PASSWORD: fir_local_dev
      POSTGRES_DB: fir
      # UTC sempre. A conversão para o fuso da clínica é do domínio.
      TZ: UTC
      PGTZ: UTC
    ports:
      - '127.0.0.1:4832:5432'
    volumes:
      - postgres-dados:/var/lib/postgresql/data
      - ./bootstrap-papeis.sql:/docker-entrypoint-initdb.d/10-papeis.sql:ro
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U fir -d fir']
      interval: 3s
      timeout: 3s
      retries: 20
      start_period: 5s

  redis:
    image: redis:7-alpine
    container_name: fir-redis
    restart: unless-stopped
    command: ['redis-server', '--appendonly', 'yes']
    ports:
      - '127.0.0.1:4879:6379'
    volumes:
      - redis-dados:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 3s
      timeout: 3s
      retries: 20

  # Sem Mailpit, convite e recuperação de senha não funcionam aqui: as rotas
  # RECUSAM quando não há SMTP, em vez de responder 202 sem mandar nada.
  mailpit:
    image: axllent/mailpit:latest
    container_name: fir-mailpit
    restart: unless-stopped
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: '1'
      MP_SMTP_AUTH_ALLOW_INSECURE: '1'
    ports:
      - '127.0.0.1:4825:8025'
      - '127.0.0.1:4826:1025'
    healthcheck:
      test: ['CMD', '/mailpit', 'readyz']
      interval: 3s
      timeout: 3s
      retries: 20

volumes:
  postgres-dados:
  redis-dados:
```

- [ ] **Step 2: Escrever os papéis do banco local**

`infra/bootstrap-papeis.sql`:
```sql
-- Roda uma vez, na criação do volume. Depois de `fir reset`, roda de novo.
--
-- Dois papéis, e a separação é o ponto: `fir_migrate` é dono do esquema e
-- atravessa a RLS; `fir_app` é quem a aplicação usa e está SUJEITO a ela.
-- Rodar a aplicação com um papel que atravessa a RLS faz todo teste de
-- isolamento passar sem provar nada.

CREATE ROLE fir_migrate LOGIN PASSWORD 'fir_local_dev' BYPASSRLS;
CREATE ROLE fir_app     LOGIN PASSWORD 'fir_local_dev';

GRANT ALL ON SCHEMA public TO fir_migrate;
ALTER SCHEMA public OWNER TO fir_migrate;

-- Tudo que `fir_migrate` criar daqui em diante fica legível e gravável por
-- `fir_app`. Sem isto, cada migration precisaria repetir os GRANTs.
ALTER DEFAULT PRIVILEGES FOR ROLE fir_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fir_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fir_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fir_app;
```

- [ ] **Step 3: Escrever o `fir.bat`**

`fir.bat`:
```bat
@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

REM ---------------------------------------------------------------------------
REM  Firmare Rotinas de Gestao - ambiente local
REM
REM    fir            sobe TUDO e deixa a aplicacao rodando com os logs a vista
REM    fir infra      so os containers (banco, Redis, Mailpit) - para os testes
REM    fir down       derruba, preservando os dados
REM    fir reset      derruba e APAGA os volumes (banco zerado)
REM    fir status     estado dos servicos
REM    fir logs       logs dos containers
REM    fir psql       shell psql no banco local
REM
REM  Portas: bloco 48xx. 47xx e do Mavia, que roda na mesma maquina.
REM  A janela NAO fecha sozinha no duplo clique: todo caminho passa por :fim.
REM ---------------------------------------------------------------------------

set "DUPLO=0"
echo(%cmdcmdline%| findstr /i /c:"%~nx0" >nul && set "DUPLO=1"

set "RAIZ=%~dp0"
set "COMPOSE=%RAIZ%infra\docker-compose.yml"
set "PORTA_PG=4832"
set "PORTA_REDIS=4879"
set "PORTA_API=4811"
set "PORTA_WEB=4810"
set "PORTA_MAILPIT=4825"
set "PORTA_SMTP=4826"
set "CODIGO=0"

set "ACAO=%~1"
if "%ACAO%"=="" set "ACAO=up"

docker info >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [ERRO] O Docker nao esta respondendo.
  echo   Abra o Docker Desktop, espere ele iniciar, e rode este script de novo.
  echo.
  set "CODIGO=1"
  goto :fim
)

if /i "%ACAO%"=="up"     goto :subir
if /i "%ACAO%"=="infra"  goto :infra
if /i "%ACAO%"=="down"   goto :derrubar
if /i "%ACAO%"=="reset"  goto :resetar
if /i "%ACAO%"=="status" goto :status
if /i "%ACAO%"=="logs"   goto :logs
if /i "%ACAO%"=="psql"   goto :psql

echo.
echo   Comando desconhecido: %ACAO%
echo   Use: fir [up^|infra^|down^|reset^|status^|logs^|psql]
echo.
set "CODIGO=1"
goto :fim

REM ---------------------------------------------------------------------------
:subir
call :containers
if errorlevel 1 goto :fim

echo.
echo   Aplicando migrations...
call pnpm --silent db:migrate
if errorlevel 1 (
  echo.
  echo   [ERRO] As migrations falharam. Nada foi iniciado.
  echo   Rode "fir logs" para ver o banco.
  set "CODIGO=1"
  goto :fim
)

echo.
echo   Semeando a clinica de demonstracao...
call pnpm --silent db:seed
if errorlevel 1 (
  echo.
  echo   [ERRO] A semente falhou.
  set "CODIGO=1"
  goto :fim
)

call :painel

set "SMTP_HOST=127.0.0.1"
set "SMTP_PORTA=%PORTA_SMTP%"
set "SMTP_REMETENTE=Firmare <ola@firmare.local>"
set "FIR_URL_PUBLICA=http://127.0.0.1:%PORTA_WEB%"

echo   Subindo API e web. Os logs dos dois aparecem abaixo.
echo   Ctrl+C encerra os dois e devolve o prompt.
echo.

call pnpm exec turbo run dev --filter=@fir/api --filter=@fir/web

echo.
echo   Aplicacao encerrada. Os containers continuam no ar.
echo   Use "fir down" para derruba-los.
goto :fim

REM ---------------------------------------------------------------------------
:infra
call :containers
if errorlevel 1 goto :fim
call :painel
echo   So os containers, como pedido. A aplicacao nao foi iniciada.
echo.
goto :fim

REM ---------------------------------------------------------------------------
:containers
echo.
echo   Subindo os containers do Firmare...
echo.
docker compose -f "%COMPOSE%" up -d
if errorlevel 1 (
  echo.
  echo   [ERRO] Falha ao subir os containers.
  set "CODIGO=1"
  exit /b 1
)

echo.
echo   Esperando o Postgres aceitar conexao...
set /a TENTATIVA=0
:esperar_pg
set /a TENTATIVA+=1
docker exec fir-postgres pg_isready -U fir -d fir >nul 2>&1
if not errorlevel 1 goto :pg_pronto
if !TENTATIVA! geq 40 (
  echo.
  echo   [ERRO] O Postgres nao ficou pronto em 40 tentativas.
  echo   Rode "fir logs" para ver o que aconteceu.
  set "CODIGO=1"
  exit /b 1
)
REM ping em vez de timeout: timeout falha quando a saida esta redirecionada.
ping -n 2 127.0.0.1 >nul
goto :esperar_pg

:pg_pronto
set /a TENTATIVA=0
:esperar_redis
set /a TENTATIVA+=1
docker exec fir-redis redis-cli ping >nul 2>&1
if not errorlevel 1 goto :redis_pronto
if !TENTATIVA! geq 40 (
  echo   [ERRO] O Redis nao ficou pronto.
  set "CODIGO=1"
  exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto :esperar_redis

:redis_pronto
exit /b 0

REM ---------------------------------------------------------------------------
:painel
echo.
echo   ------------------------------------------------------------------
echo    Ambiente no ar
echo   ------------------------------------------------------------------
echo.
echo    Aplicacao   http://127.0.0.1:%PORTA_WEB%
echo    API         http://127.0.0.1:%PORTA_API%
echo    Mailpit     http://127.0.0.1:%PORTA_MAILPIT%   (a caixa de entrada local)
echo    Postgres    127.0.0.1:%PORTA_PG%    usuario: fir   senha: fir_local_dev
echo    Redis       127.0.0.1:%PORTA_REDIS%
echo.
echo    Entre com:  demo@firmare.local
echo    Senha:      firmare-demonstracao
echo.
echo    Credenciais valem SO neste ambiente local. Nunca reutilize.
echo.
echo    fir psql    abre o banco       fir logs     logs dos containers
echo    fir down    derruba            fir reset    zera o banco
echo   ------------------------------------------------------------------
echo.
exit /b 0

REM ---------------------------------------------------------------------------
:derrubar
echo.
echo   Derrubando os containers. Os dados sao preservados.
docker compose -f "%COMPOSE%" down
echo.
goto :fim

REM ---------------------------------------------------------------------------
:resetar
echo.
echo   Isto APAGA o banco local e todos os dados dele.
set /p "CONFIRMA=  Digite ZERAR para confirmar: "
if /i not "%CONFIRMA%"=="ZERAR" (
  echo.
  echo   Cancelado. Nada foi apagado.
  echo.
  goto :fim
)
docker compose -f "%COMPOSE%" down -v
echo.
echo   Volumes removidos. Rode "fir" para subir um ambiente limpo.
echo.
goto :fim

REM ---------------------------------------------------------------------------
:status
echo.
docker compose -f "%COMPOSE%" ps
echo.
goto :fim

:logs
docker compose -f "%COMPOSE%" logs -f
goto :fim

:psql
docker exec -it fir-postgres psql -U fir -d fir
goto :fim

REM ---------------------------------------------------------------------------
:fim
if "%DUPLO%"=="1" (
  echo.
  pause
)
exit /b %CODIGO%
```

- [ ] **Step 4: Subir e verificar que os três ficam saudáveis**

Run: `fir infra`
Expected: o painel aparece; `docker compose -f infra/docker-compose.yml ps` mostra os três como `healthy`.

- [ ] **Step 5: Verificar que os papéis existem e que o fuso é UTC**

Run:
```bash
docker exec fir-postgres psql -U fir -d fir -tAc "select rolname, rolbypassrls from pg_roles where rolname like 'fir_%' order by 1"
docker exec fir-postgres psql -U fir -d fir -tAc "select current_setting('TimeZone')"
```
Expected:
```
fir_app|f
fir_migrate|t
UTC
```

- [ ] **Step 6: Commit**

```bash
git add infra fir.bat
git commit -m "feat: ambiente local com docker e fir.bat no bloco 48xx"
```

---

### Task 3: `Resultado` — erros como valores

**Files:**
- Create: `packages/domain/src/resultado.ts`, `packages/domain/src/resultado.test.ts`

**Interfaces:**
- Produces: `type Result<T, E>`, `ok<T>(valor: T)`, `erro<E>(e: E)`, `ehOk`, `ehErro`, `type ErroDeDominio = { codigo: string; mensagem: string }`, `erroDe(codigo: string, mensagem: string)`

- [ ] **Step 1: Escrever o teste que falha**

`packages/domain/src/resultado.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ehErro, ehOk, erro, erroDe, ok } from './resultado.js'

describe('Resultado', () => {
  it('ok carrega o valor e é reconhecido como ok', () => {
    const r = ok(42)
    expect(ehOk(r)).toBe(true)
    expect(ehErro(r)).toBe(false)
    if (ehOk(r)) expect(r.valor).toBe(42)
  })

  it('erro carrega o erro e é reconhecido como erro', () => {
    const r = erro(erroDe('ValorInvalido', 'valor negativo'))
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('ValorInvalido')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fir/domain test -- resultado`
Expected: FAIL — `Failed to resolve import "./resultado.js"`.

- [ ] **Step 3: Implementar**

`packages/domain/src/resultado.ts`:
```ts
export type ErroDeDominio = { readonly codigo: string; readonly mensagem: string }

export const erroDe = (codigo: string, mensagem: string): ErroDeDominio => ({ codigo, mensagem })

export type Result<T, E = ErroDeDominio> =
  | { readonly tipo: 'ok'; readonly valor: T }
  | { readonly tipo: 'erro'; readonly erro: E }

export const ok = <T>(valor: T): Result<T, never> => ({ tipo: 'ok', valor })
export const erro = <E>(e: E): Result<never, E> => ({ tipo: 'erro', erro: e })

export const ehOk = <T, E>(r: Result<T, E>): r is { tipo: 'ok'; valor: T } => r.tipo === 'ok'
export const ehErro = <T, E>(r: Result<T, E>): r is { tipo: 'erro'; erro: E } => r.tipo === 'erro'

/** Desembrulha ou lança. Só em teste e na borda HTTP, nunca dentro do domínio. */
export function exigir<T, E extends ErroDeDominio>(r: Result<T, E>): T {
  if (ehErro(r)) throw new Error(`${r.erro.codigo}: ${r.erro.mensagem}`)
  return r.valor
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @fir/domain test -- resultado`
Expected: PASS, 2 testes.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/resultado.ts packages/domain/src/resultado.test.ts
git commit -m "feat(domain): Result com erros como valores"
```

---

### Task 4: `Dinheiro` — centavos e rateio

**Files:**
- Create: `packages/domain/src/dinheiro.ts`, `packages/domain/src/dinheiro.test.ts`

**Interfaces:**
- Consumes: `Result`, `ErroDeDominio`, `erroDe`, `ok`, `erro` de `./resultado.js`
- Produces: classe `Dinheiro` com `Dinheiro.deCentavos(bigint)`, `Dinheiro.zero()`, `Dinheiro.deTexto(string): Result<Dinheiro>`, `.centavos: bigint`, `.mais(Dinheiro)`, `.menos(Dinheiro)`, `.ehZero()`, `.ehNegativo()`, `.ratear(n: number): Dinheiro[]`, `.formatar(): string`

- [ ] **Step 1: Escrever os testes que falham**

`packages/domain/src/dinheiro.test.ts`:
```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { Dinheiro } from './dinheiro.js'
import { ehErro, ehOk, exigir } from './resultado.js'

const texto = (s: string) => exigir(Dinheiro.deTexto(s))

describe('Dinheiro — leitura', () => {
  it('lê os formatos que a clínica digita', () => {
    expect(texto('450').centavos).toBe(45000n)
    expect(texto('450,00').centavos).toBe(45000n)
    expect(texto('1.250,50').centavos).toBe(125050n)
    expect(texto('1250.50').centavos).toBe(125050n)
    expect(texto('R$ 1.250,50').centavos).toBe(125050n)
    expect(texto('').centavos).toBe(0n)
  })

  it('recusa texto que não é valor', () => {
    expect(ehErro(Dinheiro.deTexto('abc'))).toBe(true)
    expect(ehErro(Dinheiro.deTexto('-10'))).toBe(true)
  })

  it('formata em pt-BR', () => {
    expect(Dinheiro.deCentavos(125050n).formatar()).toBe('R$ 1.250,50')
    expect(Dinheiro.zero().formatar()).toBe('R$ 0,00')
  })
})

describe('Dinheiro — rateio', () => {
  it('distribui o resto um centavo por parte, nas primeiras', () => {
    // R$ 100,00 em 7: a diferença com "tudo na primeira" é de R$ 0,03.
    const partes = texto('100,00').ratear(7)
    expect(partes.map((p) => p.centavos)).toEqual([1429n, 1429n, 1429n, 1429n, 1428n, 1428n, 1428n])
  })

  it('em 3 partes o resultado é o mesmo das duas regras — por isso 3 não serve de prova', () => {
    expect(texto('100,00').ratear(3).map((p) => p.centavos)).toEqual([3334n, 3333n, 3333n])
  })

  it('a soma das partes é exatamente o todo, para qualquer entrada', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000n }), fc.integer({ min: 1, max: 60 }), (c, n) => {
        const partes = Dinheiro.deCentavos(c).ratear(n)
        expect(partes.length).toBe(n)
        expect(partes.reduce((s, p) => s + p.centavos, 0n)).toBe(c)
      }),
    )
  })

  it('nenhuma parte difere de outra em mais de um centavo', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10_000_000n }), fc.integer({ min: 1, max: 60 }), (c, n) => {
        const vs = Dinheiro.deCentavos(c).ratear(n).map((p) => p.centavos)
        const max = vs.reduce((a, b) => (a > b ? a : b))
        const min = vs.reduce((a, b) => (a < b ? a : b))
        expect(max - min <= 1n).toBe(true)
      }),
    )
  })

  it('recusa rateio em zero ou menos partes', () => {
    expect(() => texto('10,00').ratear(0)).toThrow()
  })
})

describe('Dinheiro — aritmética', () => {
  it('soma e subtrai', () => {
    expect(texto('10,00').mais(texto('5,50')).centavos).toBe(1550n)
    expect(texto('10,00').menos(texto('15,00')).centavos).toBe(-500n)
  })

  it('a soma de uma lista independe da ordem', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: -1_000_000n, max: 1_000_000n }), { maxLength: 40 }), (cs) => {
        const soma = (xs: bigint[]) =>
          xs.map(Dinheiro.deCentavos).reduce((a, b) => a.mais(b), Dinheiro.zero()).centavos
        expect(soma(cs)).toBe(soma([...cs].reverse()))
      }),
    )
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fir/domain test -- dinheiro`
Expected: FAIL — `Failed to resolve import "./dinheiro.js"`.

- [ ] **Step 3: Implementar**

`packages/domain/src/dinheiro.ts`:
```ts
import { erro, erroDe, ok, type Result } from './resultado.js'

const FORMATADOR = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * Valor monetário em centavos inteiros.
 *
 * O legado faz `Math.round(x * 100) / 100` em dezenas de lugares. Esta classe
 * existe para que essa assinatura não atravesse: não há construtor que aceite
 * `number` com fração.
 */
export class Dinheiro {
  private constructor(readonly centavos: bigint) {}

  static deCentavos(centavos: bigint): Dinheiro {
    return new Dinheiro(centavos)
  }

  static zero(): Dinheiro {
    return new Dinheiro(0n)
  }

  /** Aceita `450`, `450,00`, `1.250,50`, `1250.50`, `R$ 1.250,50` e vazio. */
  static deTexto(entrada: string): Result<Dinheiro> {
    let s = String(entrada ?? '').replace(/R\$|\s| /g, '')
    if (s === '') return ok(Dinheiro.zero())

    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')

    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      return erro(erroDe('ValorInvalido', `"${entrada}" não é um valor em reais.`))
    }

    const [inteiros = '0', decimais = ''] = s.split('.')
    return ok(new Dinheiro(BigInt(inteiros) * 100n + BigInt(decimais.padEnd(2, '0'))))
  }

  mais(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.centavos + outro.centavos)
  }

  menos(outro: Dinheiro): Dinheiro {
    return new Dinheiro(this.centavos - outro.centavos)
  }

  ehZero(): boolean {
    return this.centavos === 0n
  }

  ehNegativo(): boolean {
    return this.centavos < 0n
  }

  ehMaiorQue(outro: Dinheiro): boolean {
    return this.centavos > outro.centavos
  }

  /**
   * Divide em `partes`, distribuindo o resto **um centavo por parte, nas
   * primeiras**. A soma das partes é exatamente o todo, e nenhuma parte
   * difere de outra em mais de um centavo.
   *
   * A propriedade da soma sozinha NÃO distingue esta regra de "todo o resto na
   * primeira parte", e em 3 partes as duas produzem o mesmo resultado — que é
   * justamente o caso com que todo mundo confere. A propriedade que separa é
   * `max − min <= 1`.
   */
  ratear(partes: number): Dinheiro[] {
    if (!Number.isInteger(partes) || partes < 1) {
      throw new Error(`Rateio precisa de pelo menos uma parte, recebeu ${partes}.`)
    }
    const n = BigInt(partes)
    const negativo = this.centavos < 0n
    const total = negativo ? -this.centavos : this.centavos
    const base = total / n
    const resto = total % n
    return Array.from({ length: partes }, (_, i) => {
      const v = base + (BigInt(i) < resto ? 1n : 0n)
      return new Dinheiro(negativo ? -v : v)
    })
  }

  formatar(): string {
    const negativo = this.centavos < 0n
    const abs = negativo ? -this.centavos : this.centavos
    const inteiros = abs / 100n
    const decimais = abs % 100n
    const texto = FORMATADOR.format(Number(inteiros) + Number(decimais) / 100)
    return negativo && !texto.startsWith('-') ? `-${texto}` : texto
  }
}
```

> **Nota para quem implementa:** `formatar` passa por `Number` só na formatação, nunca no cálculo. Valores acima de 90 trilhões de reais perderiam precisão na exibição; o limite é irrelevante para uma clínica e o cálculo continua exato. Se isso incomodar, troque por formatação manual com `Intl.NumberFormat` sobre as partes — mas não traga `Number` para dentro de `mais`, `menos` ou `ratear`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @fir/domain test -- dinheiro`
Expected: PASS, 10 testes (incluindo as 3 propriedades).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/dinheiro.ts packages/domain/src/dinheiro.test.ts
git commit -m "feat(domain): Dinheiro em centavos com rateio provado por propriedade"
```

---

### Task 5: `Quantidade` — milésimos e conversão de unidade

**Files:**
- Create: `packages/domain/src/quantidade.ts`, `packages/domain/src/quantidade.test.ts`

**Interfaces:**
- Consumes: `Result`, `erroDe`, `ok`, `erro`, `exigir` de `./resultado.js`
- Produces: classe `Quantidade` com `Quantidade.deMilesimos(bigint, string)`, `Quantidade.deTexto(string, string): Result<Quantidade>`, `.milesimos: bigint`, `.unidade: string`, `.mais(q): Result<Quantidade>`, `.menos(q): Result<Quantidade>`, `.ehZero()`, `.formatar()`; e `type Fatores = { compraParaMedida: bigint; medidaParaUso: bigint }`, `deCompraParaMedida`, `deMedidaParaUso`, `deUsoParaMedida`

- [ ] **Step 1: Escrever os testes que falham**

`packages/domain/src/quantidade.test.ts`:
```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  deCompraParaMedida,
  deMedidaParaUso,
  deUsoParaMedida,
  Quantidade,
  type Fatores,
} from './quantidade.js'
import { ehErro, exigir } from './resultado.js'

// 1 caixa = 4 ampolas · 1 ampola = 5 mg
const AMPOLA: Fatores = { compraParaMedida: 4000n, medidaParaUso: 5000n }
const q = (s: string, u = 'ampola') => exigir(Quantidade.deTexto(s, u))

describe('Quantidade — leitura', () => {
  it('guarda milésimos da medida', () => {
    expect(q('1').milesimos).toBe(1000n)
    expect(q('0,25').milesimos).toBe(250n)
    expect(q('2,5').milesimos).toBe(2500n)
    expect(q('').milesimos).toBe(0n)
  })

  it('recusa mais de três casas e valor negativo', () => {
    expect(ehErro(Quantidade.deTexto('1,2345', 'ampola'))).toBe(true)
    expect(ehErro(Quantidade.deTexto('-1', 'ampola'))).toBe(true)
  })

  it('formata sem zeros à direita', () => {
    expect(q('1').formatar()).toBe('1 ampola')
    expect(q('0,25').formatar()).toBe('0,25 ampola')
    expect(q('2,5').formatar()).toBe('2,5 ampola')
  })
})

describe('Quantidade — aritmética', () => {
  it('soma quantidades da mesma unidade', () => {
    expect(exigir(q('1').mais(q('0,5'))).milesimos).toBe(1500n)
  })

  it('somar unidades diferentes é erro, não conversão silenciosa', () => {
    const r = q('1', 'ampola').mais(q('1', 'mg'))
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('UnidadesIncompativeis')
  })
})

describe('Quantidade — conversão', () => {
  it('1 caixa vira 4 ampolas', () => {
    expect(exigir(deCompraParaMedida(q('1', 'caixa'), AMPOLA, 'ampola')).milesimos).toBe(4000n)
  })

  it('1 ampola vira 5 mg', () => {
    expect(exigir(deMedidaParaUso(q('1'), AMPOLA, 'mg')).milesimos).toBe(5000n)
  })

  it('2,5 mg vira meia ampola', () => {
    expect(exigir(deUsoParaMedida(q('2,5', 'mg'), AMPOLA, 'ampola')).milesimos).toBe(500n)
  })

  it('conversão inexata é recusada, não arredondada', () => {
    // 1 mg com 1 ampola = 3 mg: 1/3 de ampola não é representável em milésimos.
    const tres: Fatores = { compraParaMedida: 1000n, medidaParaUso: 3000n }
    const r = deUsoParaMedida(q('1', 'mg'), tres, 'ampola')
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('ConversaoInexata')
  })

  it('converter ida e volta devolve exatamente o original', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 1_000_000n }),
        fc.integer({ min: 1, max: 100 }),
        (mil, fator) => {
          const f: Fatores = { compraParaMedida: 1000n, medidaParaUso: BigInt(fator) * 1000n }
          const medida = Quantidade.deMilesimos(mil, 'ampola')
          const uso = deMedidaParaUso(medida, f, 'mg')
          if (uso.tipo === 'erro') return
          const volta = deUsoParaMedida(uso.valor, f, 'ampola')
          expect(exigir(volta).milesimos).toBe(mil)
        },
      ),
    )
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fir/domain test -- quantidade`
Expected: FAIL — `Failed to resolve import "./quantidade.js"`.

- [ ] **Step 3: Implementar**

`packages/domain/src/quantidade.ts`:
```ts
import { erro, erroDe, ok, type Result } from './resultado.js'

const MIL = 1000n

/**
 * Quantidade de estoque, em **milésimos da unidade declarada**.
 *
 * Milésimos porque o legado faz `Math.round(x * 1000) / 1000` em toda
 * quantidade, e as doses reais são fracionárias (0,25 ampola, 0,5 frasco).
 * Milésimos reproduzem exatamente aquela precisão sem ponto flutuante.
 *
 * A unidade viaja no tipo: somar ampola com mg lança erro em vez de converter
 * em silêncio, que é como se aplica a dose errada num paciente.
 */
export class Quantidade {
  private constructor(
    readonly milesimos: bigint,
    readonly unidade: string,
  ) {}

  static deMilesimos(milesimos: bigint, unidade: string): Quantidade {
    return new Quantidade(milesimos, unidade)
  }

  static zero(unidade: string): Quantidade {
    return new Quantidade(0n, unidade)
  }

  /** Aceita `1`, `0,25`, `2,5`, `1.5` e vazio. Até três casas decimais. */
  static deTexto(entrada: string, unidade: string): Result<Quantidade> {
    let s = String(entrada ?? '').replace(/\s| /g, '')
    if (s === '') return ok(Quantidade.zero(unidade))
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')

    if (!/^\d+(\.\d{1,3})?$/.test(s)) {
      return erro(erroDe('QuantidadeInvalida', `"${entrada}" não é uma quantidade válida (até 3 casas).`))
    }
    const [inteiros = '0', decimais = ''] = s.split('.')
    return ok(new Quantidade(BigInt(inteiros) * MIL + BigInt(decimais.padEnd(3, '0')), unidade))
  }

  private mesmaUnidade(outro: Quantidade): Result<true> {
    if (this.unidade !== outro.unidade) {
      return erro(
        erroDe('UnidadesIncompativeis', `Não é possível operar ${this.unidade} com ${outro.unidade}.`),
      )
    }
    return ok(true)
  }

  mais(outro: Quantidade): Result<Quantidade> {
    const c = this.mesmaUnidade(outro)
    if (c.tipo === 'erro') return c
    return ok(new Quantidade(this.milesimos + outro.milesimos, this.unidade))
  }

  menos(outro: Quantidade): Result<Quantidade> {
    const c = this.mesmaUnidade(outro)
    if (c.tipo === 'erro') return c
    return ok(new Quantidade(this.milesimos - outro.milesimos, this.unidade))
  }

  ehZero(): boolean {
    return this.milesimos === 0n
  }

  ehNegativa(): boolean {
    return this.milesimos < 0n
  }

  formatar(): string {
    const negativa = this.milesimos < 0n
    const abs = negativa ? -this.milesimos : this.milesimos
    const inteiros = abs / MIL
    const decimais = (abs % MIL).toString().padStart(3, '0').replace(/0+$/, '')
    const numero = decimais === '' ? `${inteiros}` : `${inteiros},${decimais}`
    return `${negativa ? '-' : ''}${numero} ${this.unidade}`
  }
}

/**
 * As duas razões do cadastro do item:
 *   `compraParaMedida` — 1 unidCompra = N medida   (1 caixa = 4 ampolas → 4000n)
 *   `medidaParaUso`    — 1 medida     = N unidUso  (1 ampola = 5 mg    → 5000n)
 *
 * Em milésimos, como toda quantidade. Um número de conversão escrito dentro de
 * uma função é defeito mesmo quando o resultado está certo hoje: no dia em que
 * o fornecedor mudar a caixa de 4 para 6, o cadastro muda e o código não.
 */
export type Fatores = { readonly compraParaMedida: bigint; readonly medidaParaUso: bigint }

function aplicar(
  q: Quantidade,
  numerador: bigint,
  denominador: bigint,
  unidadeDestino: string,
): Result<Quantidade> {
  if (denominador === 0n) {
    return erro(erroDe('FatorInvalido', 'O fator de conversão do item é zero.'))
  }
  const produto = q.milesimos * numerador
  if (produto % denominador !== 0n) {
    return erro(
      erroDe(
        'ConversaoInexata',
        `Converter ${q.formatar()} para ${unidadeDestino} não dá um valor exato. ` +
          `Confira os fatores de conversão do item.`,
      ),
    )
  }
  return ok(Quantidade.deMilesimos(produto / denominador, unidadeDestino))
}

export const deCompraParaMedida = (q: Quantidade, f: Fatores, unidadeMedida: string) =>
  aplicar(q, f.compraParaMedida, MIL, unidadeMedida)

export const deMedidaParaCompra = (q: Quantidade, f: Fatores, unidadeCompra: string) =>
  aplicar(q, MIL, f.compraParaMedida, unidadeCompra)

export const deMedidaParaUso = (q: Quantidade, f: Fatores, unidadeUso: string) =>
  aplicar(q, f.medidaParaUso, MIL, unidadeUso)

export const deUsoParaMedida = (q: Quantidade, f: Fatores, unidadeMedida: string) =>
  aplicar(q, MIL, f.medidaParaUso, unidadeMedida)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @fir/domain test -- quantidade`
Expected: PASS, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/quantidade.ts packages/domain/src/quantidade.test.ts
git commit -m "feat(domain): Quantidade em milesimos com conversao exata ou recusada"
```

---

### Task 6: `Relogio` — fuso da clínica e janela semiaberta

**Files:**
- Create: `packages/domain/src/relogio.ts`, `packages/domain/src/relogio.test.ts`

**Interfaces:**
- Produces: `interface Relogio { agora(): Date }`, `class RelogioDoSistema`, `class RelogioFixo`, `diaCivil(instante: Date, fuso: string): string`, `inicioDoDia(dia: string, fuso: string): Date`, `janela(de: string, ate: string, fuso: string): { de: Date; ate: Date }`, `somarDias(dia: string, n: number): string`, `somarMeses(dia: string, n: number, diaOriginal?: number): string`, `fimDoMes(mes: string): string`

- [ ] **Step 1: Escrever os testes que falham**

`packages/domain/src/relogio.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { diaCivil, fimDoMes, inicioDoDia, janela, RelogioFixo, somarDias, somarMeses } from './relogio.js'

const BAHIA = 'America/Bahia' // UTC−3, sem horário de verão

describe('Relogio', () => {
  it('RelogioFixo devolve sempre o mesmo instante', () => {
    const r = new RelogioFixo(new Date('2026-10-23T12:00:00Z'))
    expect(r.agora().toISOString()).toBe('2026-10-23T12:00:00.000Z')
  })
})

describe('dia civil no fuso da clínica', () => {
  it('22h30 em Salvador ainda é o dia 23, mesmo já sendo 24 em UTC', () => {
    expect(diaCivil(new Date('2026-10-24T01:30:00Z'), BAHIA)).toBe('2026-10-23')
  })

  it('o mesmo instante pode ser outro dia em outro fuso', () => {
    const i = new Date('2026-10-24T01:30:00Z')
    expect(diaCivil(i, BAHIA)).toBe('2026-10-23')
    expect(diaCivil(i, 'UTC')).toBe('2026-10-24')
  })

  it('início do dia em Salvador é 03:00 UTC', () => {
    expect(inicioDoDia('2026-10-23', BAHIA).toISOString()).toBe('2026-10-23T03:00:00.000Z')
  })
})

describe('janela semiaberta [de, ate)', () => {
  it('o último instante do dia final entra; o primeiro do dia seguinte não', () => {
    const { de, ate } = janela('2026-10-01', '2026-10-31', BAHIA)
    expect(de.toISOString()).toBe('2026-10-01T03:00:00.000Z')
    // o fim é o início do dia SEGUINTE ao último: 1º de novembro.
    expect(ate.toISOString()).toBe('2026-11-01T03:00:00.000Z')

    const ultimoInstante = new Date('2026-11-01T02:59:59Z')
    expect(ultimoInstante >= de && ultimoInstante < ate).toBe(true)
    expect(ate >= de && ate < ate).toBe(false)
  })
})

describe('aritmética de datas civis', () => {
  it('soma dias atravessando o mês', () => {
    expect(somarDias('2026-10-30', 3)).toBe('2026-11-02')
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('mensal no dia 31 cai no último dia do mês curto — a regra da v20', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(somarMeses('2026-01-31', 3)).toBe('2026-04-30')
  })

  it('mantém o dia original ao voltar para um mês longo', () => {
    // Quem repete mensalmente a partir de 31/01 deve voltar ao dia 31 em março.
    expect(somarMeses('2026-01-31', 2, 31)).toBe('2026-03-31')
  })

  it('ano bissexto', () => {
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29')
    expect(fimDoMes('2028-02')).toBe('2028-02-29')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fir/domain test -- relogio`
Expected: FAIL — `Failed to resolve import "./relogio.js"`.

- [ ] **Step 3: Implementar**

`packages/domain/src/relogio.ts`:
```ts
/**
 * O relógio é dependência injetada. Nenhuma regra chama `new Date()`:
 * data de negócio vem do servidor, e um teste precisa poder fixar o instante.
 */
export interface Relogio {
  agora(): Date
}

export class RelogioDoSistema implements Relogio {
  agora(): Date {
    return new Date()
  }
}

export class RelogioFixo implements Relogio {
  constructor(private readonly instante: Date) {}
  agora(): Date {
    return this.instante
  }
}

const dois = (n: number) => String(n).padStart(2, '0')

/** Minutos que o fuso está à frente do UTC no instante dado. */
function deslocamentoMinutos(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instante)

  const p: Record<string, string> = {}
  for (const x of partes) if (x.type !== 'literal') p[x.type] = x.value

  const hora = Number(p['hour']) === 24 ? 0 : Number(p['hour'])
  const comoSeFosseUtc = Date.UTC(
    Number(p['year']),
    Number(p['month']) - 1,
    Number(p['day']),
    hora,
    Number(p['minute']),
    Number(p['second']),
  )
  return (comoSeFosseUtc - instante.getTime()) / 60_000
}

/** O dia civil (`yyyy-MM-dd`) em que o instante cai, **no fuso da clínica**. */
export function diaCivil(instante: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante)
  return partes // en-CA já formata como yyyy-MM-dd
}

/** O instante UTC em que o dia civil começa no fuso da clínica. */
export function inicioDoDia(dia: string, fuso: string): Date {
  const [a, m, d] = dia.split('-').map(Number)
  const comoUtc = Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1, 0, 0, 0)

  // Duas passadas: a primeira usa o deslocamento no palpite, a segunda corrige
  // quando o palpite cair do outro lado de uma mudança de horário de verão.
  const primeiro = new Date(comoUtc - deslocamentoMinutos(new Date(comoUtc), fuso) * 60_000)
  const segundo = new Date(comoUtc - deslocamentoMinutos(primeiro, fuso) * 60_000)
  return segundo
}

/**
 * Janela **semiaberta** `[de, ate)` em instantes UTC, com as bordas calculadas
 * no fuso da clínica. `ate` é o início do dia **seguinte** ao último dia pedido,
 * de modo que o último instante do último dia entra e o primeiro do dia
 * seguinte não. Uma convenção só, em todo o sistema.
 */
export function janela(de: string, ate: string, fuso: string): { de: Date; ate: Date } {
  return { de: inicioDoDia(de, fuso), ate: inicioDoDia(somarDias(ate, 1), fuso) }
}

/** Soma dias a um dia civil, sem tocar em fuso — aritmética de calendário. */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  const t = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, (d ?? 1) + n))
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`
}

/**
 * Soma meses. Dia 29, 30 ou 31 em mês curto **cai no último dia do mês** — é a
 * regra da v20, e as 4 clínicas dependem dela.
 *
 * `diaOriginal` permite que uma série mensal iniciada em 31/01 volte ao dia 31
 * em março, em vez de ficar presa no 28 de fevereiro.
 */
export function somarMeses(dia: string, n: number, diaOriginal?: number): string {
  const [a, m, d] = dia.split('-').map(Number)
  const alvo = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1 + n, 1))
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate()
  const escolhido = Math.min(diaOriginal ?? d ?? 1, ultimo)
  return `${alvo.getUTCFullYear()}-${dois(alvo.getUTCMonth() + 1)}-${dois(escolhido)}`
}

/** Último dia civil de um mês `yyyy-MM`. */
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  const t = new Date(Date.UTC(a ?? 1970, m ?? 1, 0))
  return `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @fir/domain test -- relogio`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/relogio.ts packages/domain/src/relogio.test.ts
git commit -m "feat(domain): relogio injetado, fuso por clinica e janela semiaberta"
```

---

### Task 7: `permissoes` — a matriz, e o que ela redige

**Files:**
- Create: `packages/domain/src/permissoes.ts`, `packages/domain/src/permissoes.test.ts`

**Interfaces:**
- Produces: `type ChaveDePermissao`, `const PERMS: readonly Permissao[]`, `const PILARES`, `perfisPadrao(): Perfil[]`, `temPerm(usuario: UsuarioDePermissao, perfis: Perfil[], chave: ChaveDePermissao): boolean`, `const CAMPOS_MONETARIOS: readonly string[]`, `type Perfil = { id: string; nome: string; perms: ChaveDePermissao[] }`, `type UsuarioDePermissao = { admin: boolean; perfilId: string }`

- [ ] **Step 1: Escrever os testes que falham**

`packages/domain/src/permissoes.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CAMPOS_MONETARIOS, PERMS, perfisPadrao, temPerm, type Perfil } from './permissoes.js'

const perfis = perfisPadrao()
const recepcao = { admin: false, perfilId: 'pf_rec' }
const financeiro = { admin: false, perfilId: 'pf_fin' }
const enfermagem = { admin: false, perfilId: 'pf_enf' }
const admin = { admin: true, perfilId: '' }

describe('temPerm', () => {
  it('administrador pode tudo', () => {
    for (const [, chave] of PERMS) expect(temPerm(admin, perfis, chave)).toBe(true)
  })

  it('recepção vê a jornada mas não vê valores', () => {
    expect(temPerm(recepcao, perfis, 'jornada')).toBe(true)
    expect(temPerm(recepcao, perfis, 'valores')).toBe(false)
  })

  it('enfermagem não entra no financeiro', () => {
    expect(temPerm(enfermagem, perfis, 'programas')).toBe(true)
    expect(temPerm(enfermagem, perfis, 'receber')).toBe(false)
  })

  it('perfil inexistente não ganha nada', () => {
    expect(temPerm({ admin: false, perfilId: 'nao-existe' }, perfis, 'jornada')).toBe(false)
  })
})

describe('dependências entre chaves', () => {
  it('finmes exige valores — e o financeiro tem os dois', () => {
    expect(temPerm(financeiro, perfis, 'valores')).toBe(true)
    expect(temPerm(financeiro, perfis, 'finmes')).toBe(true)
  })

  it('finmes sem valores não vale, mesmo marcado no perfil', () => {
    // É a escalada de um passo: marcar a chave dependente sem a de base.
    const torto: Perfil[] = [{ id: 'pf_x', nome: 'Torto', perms: ['finmes', 'painel'] }]
    const u = { admin: false, perfilId: 'pf_x' }
    expect(temPerm(u, torto, 'finmes')).toBe(false)
    expect(temPerm(u, torto, 'painel')).toBe(false)
  })
})

describe('a matriz', () => {
  it('tem as 20 chaves do protótipo, sem repetição', () => {
    const chaves = PERMS.map(([, k]) => k)
    expect(chaves).toHaveLength(20)
    expect(new Set(chaves).size).toBe(20)
  })

  it('toda dependência aponta para uma chave existente', () => {
    const chaves = new Set(PERMS.map(([, k]) => k))
    for (const [, , , , dep] of PERMS) if (dep) expect(chaves.has(dep)).toBe(true)
  })

  it('os cinco perfis padrão só usam chaves da matriz', () => {
    const chaves = new Set(PERMS.map(([, k]) => k))
    for (const p of perfisPadrao()) for (const k of p.perms) expect(chaves.has(k)).toBe(true)
  })
})

describe('campos monetários', () => {
  it('lista os campos que o interceptor apaga de quem não tem valores', () => {
    for (const c of ['valor', 'valorAberto', 'valorOrcamento', 'custo', 'salario']) {
      expect(CAMPOS_MONETARIOS).toContain(c)
    }
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fir/domain test -- permissoes`
Expected: FAIL — `Failed to resolve import "./permissoes.js"`.

- [ ] **Step 3: Implementar**

`packages/domain/src/permissoes.ts`:
```ts
/**
 * A matriz de permissões, portada do protótipo (`PERMS`, seção 5.1 do
 * documento de passagem).
 *
 * Tupla: [pilar, chave, rótulo, descrição, dependência?]
 *
 * `temPerm` é UMA função, usada pelo servidor e pela tela. O servidor SEMPRE
 * valida; a tela é conveniência. As dependências entre chaves vivem aqui, na
 * tabela — não num `if` espalhado pelos controladores.
 */
export const PERMS = [
  ['Dia a dia', 'tarefas.equipe', 'Ver e acompanhar as tarefas da equipe toda', 'Filtro “Equipe toda”; concluir e cancelar tarefas de outras pessoas'],
  ['Comercial', 'jornada', 'Jornada do paciente', 'Funil e situação de agendamentos, orçamentos e fechamentos'],
  ['Comercial', 'pacientes', 'Lista de pacientes e relacionamento', 'Busca, aniversariantes, origem dos pacientes'],
  ['Comercial', 'pacientes.gerir', 'Importar e excluir pacientes', ''],
  ['Comercial', 'programas', 'Programas de acompanhamento', 'Agenda de sessões e pacientes em programa'],
  ['Comercial', 'programas.gerir', 'Encerrar e excluir programas', ''],
  ['Comercial', 'campanhas', 'Campanhas', 'Ver as campanhas e executar as ações'],
  ['Comercial', 'campanhas.gerir', 'Criar, importar e excluir campanhas', ''],
  ['Financeiro', 'valores', 'Ver valores financeiros', 'Receita, LTV, saldos, valores de orçamento e de pagamentos em todas as telas'],
  ['Financeiro', 'receber', 'Registrar recebimentos', 'Tela Recebimentos e atalho + Recebimento'],
  ['Financeiro', 'caixa', 'Fechar o caixa do dia', ''],
  ['Financeiro', 'contas', 'Contas a pagar sob sua responsabilidade', 'Ver e marcar como pagas as contas em que é responsável'],
  ['Financeiro', 'contas.gerir', 'Cadastrar e ver todas as contas a pagar', ''],
  ['Financeiro', 'cobrancas', 'Cobranças de saldo em aberto', ''],
  ['Financeiro', 'finmes', 'Visão do mês e meta de faturamento', 'Despesas por categoria, resultado e meta', 'valores'],
  ['Processos', 'estoque', 'Estoque: itens, entradas, saídas e contagens', 'Inclui ler código e registrar uso em paciente'],
  ['Processos', 'estoque.gerir', 'Estoque: cadastro de itens, ajustes, custos e análise', 'Inclui valor em estoque, etiquetas, importação e locais'],
  ['Pessoas', 'pessoas.gerir', 'Equipe: fichas, metas, conversas 1:1 e banco de horas', 'Dados de RH (inclui salário)'],
  ['Gestão', 'painel', 'Painel geral', 'Indicadores de prazos, pacientes e unidades', 'valores'],
  ['Gestão', 'config', 'Configurações', 'Unidades, usuários e acessos, procedimentos'],
] as const satisfies readonly (readonly [string, string, string, string, string?])[]

export const PILARES = ['Dia a dia', 'Comercial', 'Financeiro', 'Processos', 'Pessoas', 'Gestão'] as const

export type ChaveDePermissao = (typeof PERMS)[number][1]
export type Pilar = (typeof PILARES)[number]

export type Perfil = { readonly id: string; readonly nome: string; readonly perms: readonly ChaveDePermissao[] }
export type UsuarioDePermissao = { readonly admin: boolean; readonly perfilId: string }

const porChave = new Map(PERMS.map((p) => [p[1] as ChaveDePermissao, p]))

export const infoDaPermissao = (chave: ChaveDePermissao) => porChave.get(chave)

/** Cinco perfis prontos, criados com a clínica. Editáveis pela própria clínica. */
export function perfisPadrao(): Perfil[] {
  return [
    { id: 'pf_sup', nome: 'Supervisão / gestão', perms: ['tarefas.equipe', 'jornada', 'pacientes', 'pacientes.gerir', 'programas', 'programas.gerir', 'campanhas', 'campanhas.gerir', 'valores', 'receber', 'caixa', 'contas', 'cobrancas', 'estoque', 'estoque.gerir', 'painel'] },
    { id: 'pf_rec', nome: 'Recepção', perms: ['jornada', 'pacientes', 'programas', 'campanhas', 'receber', 'caixa', 'contas', 'cobrancas', 'estoque'] },
    { id: 'pf_com', nome: 'Comercial', perms: ['jornada', 'pacientes', 'programas', 'campanhas', 'cobrancas'] },
    { id: 'pf_enf', nome: 'Enfermagem', perms: ['programas', 'estoque'] },
    { id: 'pf_fin', nome: 'Financeiro', perms: ['valores', 'receber', 'caixa', 'contas', 'contas.gerir', 'cobrancas', 'finmes'] },
  ]
}

const permsDoPerfil = (perfis: readonly Perfil[], perfilId: string): readonly ChaveDePermissao[] =>
  perfis.find((p) => p.id === perfilId)?.perms ?? []

/**
 * A mesma função no servidor e na tela.
 *
 * A dependência declarada é verificada aqui: marcar `finmes` sem `valores`
 * não libera `finmes`. Se a dependência só existisse na tela, a chave direta
 * seria uma escalada de privilégio de um passo.
 */
export function temPerm(
  usuario: UsuarioDePermissao | null | undefined,
  perfis: readonly Perfil[],
  chave: ChaveDePermissao,
): boolean {
  if (!usuario) return false
  if (usuario.admin) return true

  const perms = permsDoPerfil(perfis, usuario.perfilId)
  const dependencia = porChave.get(chave)?.[4] as ChaveDePermissao | undefined
  if (dependencia && !perms.includes(dependencia)) return false
  return perms.includes(chave)
}

/**
 * Os campos que o interceptor de redação apaga de quem não tem `valores`
 * (ou, no caso de `salario`, de quem não tem `pessoas.gerir`).
 *
 * Esta lista existe num lugar só de propósito. Um `if` por endpoint é como o
 * salário vaza no endpoint número quarenta.
 */
export const CAMPOS_MONETARIOS = [
  'valor',
  'valorAberto',
  'valorOrcamento',
  'valorPago',
  'valorTotal',
  'valorEntrada',
  'custo',
  'salario',
  'meta',
  'esperado',
  'diferenca',
  'ltv',
  'ticket',
  'recebido',
  'saldo',
] as const
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @fir/domain test -- permissoes`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/permissoes.ts packages/domain/src/permissoes.test.ts
git commit -m "feat(domain): matriz de permissoes com dependencias verificadas"
```

---

### Task 8: `tipos-de-tarefa` — a tabela que classifica o dinheiro

**Files:**
- Create: `packages/domain/src/tipos-de-tarefa.ts`, `packages/domain/src/tipos-de-tarefa.test.ts`

**Interfaces:**
- Produces: `const TIPOS`, `type NomeDeTipo`, `infoDoTipo(nome)`, `ehReceita(t)`, `ehContato(t)`, `ehAtendimento(t)`, `ehSessao(t)`, `aceitaPagamento(nome)`, `ehPagamento(nome)`, `temSaldo(nome)`, `tipoAoConcluir(nome)`, `const TIPO_SESSAO`, `const TIPO_RETORNO`, `const TIPO_ANTIGO`

- [ ] **Step 1: Escrever os testes que falham**

`packages/domain/src/tipos-de-tarefa.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  aceitaPagamento,
  ehAtendimento,
  ehContato,
  ehPagamento,
  ehReceita,
  TIPO_ANTIGO,
  TIPOS,
  tipoAoConcluir,
} from './tipos-de-tarefa.js'

describe('classificação dos tipos', () => {
  it('o grupo Pagamentos é receita', () => {
    expect(ehPagamento('Pagamento de consulta')).toBe(true)
    expect(ehPagamento('Sinal de consulta')).toBe(true)
    expect(ehPagamento('Pagamento de orçamento')).toBe(true)
    expect(ehPagamento('Pagamento de saldo em aberto')).toBe(true)
  })

  it('atendimento com valor pago é receita; sem valor, não', () => {
    expect(ehReceita({ tipo: 'Consulta realizada', valor: 15000n })).toBe(true)
    expect(ehReceita({ tipo: 'Consulta realizada', valor: 0n })).toBe(false)
  })

  it('ORÇAMENTO NÃO É RECEITA — nem com valor', () => {
    expect(ehReceita({ tipo: 'Orçamento enviado', valor: 500000n })).toBe(false)
  })

  it('relacionamento é contato, atendimento e pagamento não são', () => {
    expect(ehContato({ tipo: 'Follow-up', valor: 0n })).toBe(true)
    expect(ehContato({ tipo: 'Aniversário', valor: 0n })).toBe(true)
    expect(ehContato({ tipo: 'Consulta realizada', valor: 0n })).toBe(false)
    expect(ehContato({ tipo: 'Pagamento de consulta', valor: 0n })).toBe(false)
  })

  it('conta como paciente atendido', () => {
    expect(ehAtendimento({ tipo: 'Consulta realizada', valor: 0n })).toBe(true)
    expect(ehAtendimento({ tipo: 'Sessão de plano', valor: 0n })).toBe(true)
    expect(ehAtendimento({ tipo: 'Consulta agendada', valor: 0n })).toBe(false)
  })

  it('o atendimento guarda o pagamento na própria tarefa', () => {
    expect(aceitaPagamento('Consulta realizada')).toBe(true)
    expect(aceitaPagamento('Procedimento realizado')).toBe(true)
    expect(aceitaPagamento('Sessão de plano')).toBe(true)
    expect(aceitaPagamento('Follow-up')).toBe(false)
  })
})

describe('agendado vira realizado — a mesma tarefa', () => {
  it('consulta e procedimento têm destino', () => {
    expect(tipoAoConcluir('Consulta agendada')).toBe('Consulta realizada')
    expect(tipoAoConcluir('Procedimento agendado')).toBe('Procedimento realizado')
  })

  it('tipo sem destino não muda', () => {
    expect(tipoAoConcluir('Follow-up')).toBe('Follow-up')
  })
})

describe('tipos de versões anteriores', () => {
  it('mapeiam para os atuais — a migração depende disto', () => {
    expect(TIPO_ANTIGO['Orçamento fechado']).toBe('Pagamento de orçamento')
    expect(TIPO_ANTIGO['Orçamento pago']).toBe('Pagamento de orçamento')
    expect(TIPO_ANTIGO['Recebimento de saldo']).toBe('Pagamento de saldo em aberto')
    expect(TIPO_ANTIGO['Agendamento']).toBe('Consulta agendada')
  })
})

describe('a tabela', () => {
  it('tem os 19 tipos do protótipo, sem repetição', () => {
    expect(TIPOS).toHaveLength(19)
    expect(new Set(TIPOS.map((t) => t.nome)).size).toBe(19)
  })

  it('todo destino de conclusão existe na tabela', () => {
    const nomes = new Set(TIPOS.map((t) => t.nome))
    for (const t of TIPOS) if (t.vira) expect(nomes.has(t.vira)).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fir/domain test -- tipos-de-tarefa`
Expected: FAIL — `Failed to resolve import "./tipos-de-tarefa.js"`.

- [ ] **Step 3: Implementar**

`packages/domain/src/tipos-de-tarefa.ts`:
```ts
/**
 * A tabela de tipos de tarefa, portada de `CONFIG.TIPOS` do protótipo.
 *
 * As flags são a classificação que decide o que entra na receita, o que conta
 * como paciente atendido e o que aceita valor em aberto. Elas existem aqui, em
 * tabela, porque espalhá-las em `if (tipo === '...')` foi como o legado passou
 * a contar o mesmo dinheiro duas vezes.
 *
 *   receita     — é um pagamento: entra na receita e no LTV
 *   atende      — conta como paciente atendido
 *   saldo       — aceita "valor em aberto"
 *   orcamento   — valor de proposta: NÃO entra na receita
 *   recebimento — abate saldo em aberto
 *   sessao      — sessão de programa (criada pelo próprio programa)
 *   pagavel     — atendimento que guarda o pagamento na própria tarefa
 *   vira        — ao concluir, o tipo agendado passa a ser o realizado
 */
export type InfoDoTipo = {
  readonly nome: string
  readonly grupo: 'Agenda' | 'Atendimento' | 'Orçamento' | 'Pagamentos' | 'Relacionamento'
  readonly desc: string
  readonly receita?: true
  readonly atende?: true
  readonly saldo?: true
  readonly orcamento?: true
  readonly recebimento?: true
  readonly sessao?: true
  readonly pagavel?: true
  readonly vira?: string
  readonly rotulo?: string
}

export const TIPO_SESSAO = 'Sessão de plano'
export const TIPO_RETORNO = 'Retorno de procedimento'

export const TIPOS = [
  { nome: 'Consulta agendada', grupo: 'Agenda', vira: 'Consulta realizada', desc: 'Consulta marcada. Ao concluir, vira Consulta realizada (com o pagamento, se houver). Sinal pago antes: lance como Sinal de consulta.' },
  { nome: 'Procedimento agendado', grupo: 'Agenda', vira: 'Procedimento realizado', desc: 'Procedimento marcado. Ao concluir, vira Procedimento realizado (com o pagamento, se houver).' },
  { nome: 'Reagendamento', grupo: 'Agenda', desc: 'Consulta, procedimento ou sessão remarcados.' },
  { nome: 'Confirmação', grupo: 'Agenda', desc: 'Confirmação de presença com o paciente.' },
  { nome: 'Consulta realizada', grupo: 'Atendimento', atende: true, pagavel: true, desc: 'Paciente atendido em consulta. O pagamento fica registrado nesta mesma tarefa.' },
  { nome: 'Procedimento realizado', grupo: 'Atendimento', atende: true, pagavel: true, desc: 'Procedimento feito. O pagamento fica registrado nesta mesma tarefa.' },
  { nome: TIPO_SESSAO, grupo: 'Atendimento', atende: true, sessao: true, pagavel: true, desc: 'Sessão de um programa de acompanhamento (criada pelo próprio programa).' },
  { nome: 'Orçamento enviado', grupo: 'Orçamento', orcamento: true, desc: 'Proposta apresentada. O valor do orçamento não entra na receita.' },
  { nome: 'Sinal de consulta', grupo: 'Pagamentos', receita: true, saldo: true, desc: 'Valor adiantado para reservar a consulta. O restante vai em valor em aberto.' },
  { nome: 'Pagamento de consulta', grupo: 'Pagamentos', receita: true, saldo: true, desc: 'Valor pago pela consulta. Se faltar alguma parte, informe em valor em aberto.' },
  { nome: 'Pagamento de orçamento', grupo: 'Pagamentos', receita: true, atende: true, saldo: true, desc: 'Orçamento fechado: valor pago agora (total ou entrada). O que faltar vai em valor em aberto.' },
  { nome: 'Pagamento de saldo em aberto', grupo: 'Pagamentos', receita: true, recebimento: true, rotulo: 'Valor recebido (R$)', desc: 'Parcela ou restante de um valor em aberto. Abate o saldo do paciente.' },
  { nome: 'Follow-up', grupo: 'Relacionamento', desc: 'Retomar conversa em andamento (ex.: orçamento enviado sem resposta).' },
  { nome: 'Recaptação', grupo: 'Relacionamento', desc: 'Paciente sem retorno há algum tempo.' },
  { nome: TIPO_RETORNO, grupo: 'Relacionamento', desc: 'Paciente que já pode repetir um procedimento (criado pelo catálogo).' },
  { nome: 'Contato de indicação', grupo: 'Relacionamento', desc: 'Contato com paciente indicado ou com quem indicou.' },
  { nome: 'Aniversário', grupo: 'Relacionamento', desc: 'Mensagem de aniversário.' },
  { nome: 'Pós-consulta', grupo: 'Relacionamento', desc: 'Acompanhamento depois da consulta ou procedimento.' },
  { nome: 'Outros', grupo: 'Relacionamento', desc: 'Outro contato com o paciente.' },
] as const satisfies readonly InfoDoTipo[]

export type NomeDeTipo = (typeof TIPOS)[number]['nome']

const porNome = new Map<string, InfoDoTipo>(TIPOS.map((t) => [t.nome, t]))

export const infoDoTipo = (nome: string): InfoDoTipo =>
  porNome.get(nome) ?? { nome, grupo: 'Relacionamento', desc: '' }

/** O que a tarefa precisa expor para ser classificada. */
export type TarefaClassificavel = { readonly tipo: string; readonly valor: bigint }

/**
 * Receita = só o grupo Pagamentos, **mais** o atendimento que guardou um
 * pagamento na própria tarefa. Orçamento nunca.
 */
export const ehReceita = (t: TarefaClassificavel): boolean => {
  const i = infoDoTipo(t.tipo)
  return i.receita === true || (i.pagavel === true && t.valor > 0n)
}

/** Contato = tarefa que não é atendimento nem pagamento. */
export const ehContato = (t: TarefaClassificavel): boolean => {
  const i = infoDoTipo(t.tipo)
  return i.atende !== true && i.receita !== true && i.recebimento !== true
}

export const ehAtendimento = (t: TarefaClassificavel): boolean => infoDoTipo(t.tipo).atende === true
export const ehSessao = (t: TarefaClassificavel): boolean => infoDoTipo(t.tipo).sessao === true

export const aceitaPagamento = (nome: string): boolean => infoDoTipo(nome).pagavel === true
export const ehPagamento = (nome: string): boolean => infoDoTipo(nome).receita === true
export const temSaldo = (nome: string): boolean => infoDoTipo(nome).saldo === true
export const temValor = (nome: string): boolean => {
  const i = infoDoTipo(nome)
  return i.receita === true || i.orcamento === true
}

/** Agendado vira realizado — a mesma tarefa, com histórico. */
export const tipoAoConcluir = (nome: string): string => infoDoTipo(nome).vira ?? nome

/** Nomes de versões anteriores. A migração das 4 clínicas depende deste mapa. */
export const TIPO_ANTIGO: Readonly<Record<string, string>> = {
  'Orçamento fechado': 'Pagamento de orçamento',
  'Orçamento pago': 'Pagamento de orçamento',
  'Recebimento de saldo': 'Pagamento de saldo em aberto',
  Agendamento: 'Consulta agendada',
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @fir/domain test -- tipos-de-tarefa`
Expected: PASS, 10 testes.

- [ ] **Step 5: Exportar tudo do índice do domínio**

`packages/domain/src/index.ts`:
```ts
export * from './resultado.js'
export * from './dinheiro.js'
export * from './quantidade.js'
export * from './relogio.js'
export * from './permissoes.js'
export * from './tipos-de-tarefa.js'
```

- [ ] **Step 6: Rodar a suíte inteira do domínio**

Run: `pnpm test:domain && pnpm typecheck`
Expected: PASS — 5 arquivos, ~40 testes.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src
git commit -m "feat(domain): tabela de tipos de tarefa e indice do pacote"
```

---

### Task 9: Migration 0001 — clínicas, papéis e o alicerce da RLS

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/migrar.ts`
- Create: `apps/api/migrations/0001_fundacao.sql`

**Interfaces:**
- Produces: tabela `clinicas(id uuid, codigo text unique, nome text, fuso text, ativa bool, criada_em timestamptz)`; função `app_clinica_id()`; papéis `fir_migrate`/`fir_app` já existem do bootstrap; comando `pnpm db:migrate`

- [ ] **Step 1: Criar o pacote da API e o aplicador de migrations**

`apps/api/package.json`:
```json
{
  "name": "@fir/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "db:migrate": "tsx migrar.ts",
    "db:seed": "tsx semear.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fir/domain": "workspace:*",
    "pg": "^8"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/pg": "^8",
    "tsx": "^4",
    "typescript": "^5.7",
    "vitest": "^2"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": ".", "types": ["node"] },
  "include": ["src", "migrar.ts", "semear.ts"]
}
```

`apps/api/migrar.ts`:
```ts
/**
 * Aplica as migrations em ordem, uma vez cada, dentro de uma transação por
 * arquivo. Forward-only: uma migration aplicada nunca é editada.
 *
 * Roda como `fir_migrate`, nunca como superusuário — rodar migration com
 * superusuário faz tudo passar, e passar assim esconde os erros de permissão
 * que aparecem só no primeiro deploy.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PASTA = join(AQUI, 'migrations')

const url =
  process.env['DATABASE_URL_MIGRATE'] ??
  'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const cliente = new pg.Client({ connectionString: url })
await cliente.connect()

await cliente.query(`
  CREATE TABLE IF NOT EXISTS migrations_aplicadas (
    nome       text PRIMARY KEY,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  )
`)

const { rows } = await cliente.query<{ nome: string }>('SELECT nome FROM migrations_aplicadas')
const jaAplicadas = new Set(rows.map((r) => r.nome))

const arquivos = (await readdir(PASTA)).filter((f) => f.endsWith('.sql')).sort()
let aplicadas = 0

for (const nome of arquivos) {
  if (jaAplicadas.has(nome)) continue
  const sql = await readFile(join(PASTA, nome), 'utf8')
  process.stdout.write(`==> ${nome}\n`)
  try {
    await cliente.query('BEGIN')
    await cliente.query(sql)
    await cliente.query('INSERT INTO migrations_aplicadas (nome) VALUES ($1)', [nome])
    await cliente.query('COMMIT')
    aplicadas++
  } catch (e) {
    await cliente.query('ROLLBACK')
    process.stderr.write(`ERRO em ${nome}: ${(e as Error).message}\n`)
    await cliente.end()
    process.exit(1)
  }
}

process.stdout.write(
  aplicadas === 0 ? 'banco já está na versão mais recente\n' : `${aplicadas} migration(s) aplicada(s)\n`,
)
await cliente.end()
```

- [ ] **Step 2: Escrever a migration 0001**

`apps/api/migrations/0001_fundacao.sql`:
```sql
-- ---------------------------------------------------------------------------
-- Fundação: a clínica é a fronteira de isolamento de todo o sistema.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE clinicas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     text        NOT NULL UNIQUE,
  nome       text        NOT NULL,
  -- O fuso é PROPRIEDADE DA CLÍNICA. O legado fixou 'America/Bahia' num const,
  -- e isso quebra na primeira clínica de outro estado.
  fuso       text        NOT NULL DEFAULT 'America/Bahia',
  -- Estado, nunca exclusão. Desativar uma clínica precisa ser um UPDATE, não
  -- um procedimento manual por SSH.
  ativa      boolean     NOT NULL DEFAULT true,
  criada_em  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN clinicas.fuso IS
  'Fuso IANA usado para calcular dia civil e bordas de período. Nunca global.';

-- ---------------------------------------------------------------------------
-- O alicerce da RLS.
--
-- Toda tabela de negócio ganha `clinica_id NOT NULL` e uma policy que compara
-- com esta função. O middleware da API faz `SET LOCAL app.clinica_id = …` no
-- começo de cada transação.
--
-- `true` no segundo argumento de current_setting: devolve NULL em vez de
-- lançar quando a variável não foi definida. Com NULL, a comparação
-- `clinica_id = NULL` é falsa, e a consulta não devolve nada — que é o modo de
-- falha certo. Uma conexão que esqueceu de fixar a clínica vê um banco vazio,
-- não o banco inteiro.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_clinica_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.clinica_id', true), '')::uuid $$;

COMMENT ON FUNCTION app_clinica_id() IS
  'A clínica da transação atual. NULL quando não fixada: a RLS então nega tudo.';

GRANT SELECT ON clinicas TO fir_app;
```

- [ ] **Step 3: Aplicar e verificar**

Run:
```bash
pnpm db:migrate
docker exec fir-postgres psql -U fir -d fir -tAc "select nome from migrations_aplicadas order by 1"
```
Expected:
```
==> 0001_fundacao.sql
1 migration(s) aplicada(s)
0001_fundacao.sql
```

- [ ] **Step 4: Verificar que a função nega quando a clínica não foi fixada**

Run:
```bash
docker exec fir-postgres psql -U fir -d fir -tAc "select app_clinica_id() is null"
```
Expected: `t`

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat(api): migration 0001 com clinicas e o alicerce da RLS"
```

---

### Task 10: Migration 0002 — identidade, e a prova de isolamento

**Files:**
- Create: `apps/api/migrations/0002_identidade.sql`
- Create: `apps/api/src/banco/banco.test.ts`, `apps/api/vitest.config.ts`

**Interfaces:**
- Consumes: `clinicas`, `app_clinica_id()` da Task 9
- Produces: tabelas `perfis`, `pessoas`, `sessoes`, `tentativas_login`, todas com RLS; teste de isolamento rodando contra Postgres real

- [ ] **Step 1: Escrever a migration 0002**

`apps/api/migrations/0002_identidade.sql`:
```sql
-- ---------------------------------------------------------------------------
-- Identidade: perfis de acesso, pessoas, sessões.
--
-- O PIN de 4 dígitos da v20 NÃO existe aqui. Login é por e-mail e senha, por
-- pessoa, com Argon2id — decisão D-3 em docs/decisoes.md.
-- ---------------------------------------------------------------------------

CREATE TABLE perfis (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  chave      text NOT NULL,                  -- 'pf_rec', 'pf_enf', …
  nome       text NOT NULL,
  perms      text[] NOT NULL DEFAULT '{}',
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinica_id, chave)
);

CREATE TABLE pessoas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  nome          text NOT NULL,
  email         text NOT NULL,
  funcao        text NOT NULL DEFAULT '',
  senha_hash    text NOT NULL,
  admin         boolean NOT NULL DEFAULT false,
  perfil_id     uuid REFERENCES perfis(id),
  -- Estado, nunca exclusão: o histórico de quem fez o quê não pode sumir
  -- porque alguém saiu da clínica.
  ativo         boolean NOT NULL DEFAULT true,
  criada_em     timestamptz NOT NULL DEFAULT now(),
  -- O e-mail é único POR CLÍNICA: a mesma pessoa pode atender duas clínicas.
  UNIQUE (clinica_id, email)
);

-- Administrador não tem perfil; quem não é administrador precisa de um.
ALTER TABLE pessoas ADD CONSTRAINT pessoa_tem_acesso_definido
  CHECK ((admin AND perfil_id IS NULL) OR (NOT admin AND perfil_id IS NOT NULL));

CREATE TABLE sessoes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  pessoa_id   uuid NOT NULL REFERENCES pessoas(id),
  -- O token nunca é guardado em claro: um dump do banco não vale por um login.
  token_hash  text NOT NULL UNIQUE,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL,
  revogada_em timestamptz
);
CREATE INDEX sessoes_pessoa ON sessoes (pessoa_id) WHERE revogada_em IS NULL;

-- Limite de tentativas: dez mil combinações sem limite foi o maior risco da
-- v20. O identificador é hasheado com pepper para que a tabela não vire uma
-- lista de e-mails de clientes.
CREATE TABLE tentativas_login (
  id             bigserial PRIMARY KEY,
  clinica_id     uuid NOT NULL REFERENCES clinicas(id),
  identificador  text NOT NULL,
  em             timestamptz NOT NULL DEFAULT now(),
  sucesso        boolean NOT NULL
);
CREATE INDEX tentativas_recentes ON tentativas_login (clinica_id, identificador, em DESC);

-- ---------------------------------------------------------------------------
-- RLS em tudo. FORCE para que nem o dono da tabela escape.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['perfis', 'pessoas', 'sessoes', 'tentativas_login'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I_por_clinica ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO fir_app', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE tentativas_login_id_seq TO fir_app;
```

- [ ] **Step 2: Escrever o teste de isolamento que falha**

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], testTimeout: 30_000, hookTimeout: 60_000 },
})
```

`apps/api/src/banco/banco.test.ts`:
```ts
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Testes de RLS vão contra Postgres real, nunca contra mock.
 *
 * Um mock que filtra por clínica prova que alguém escreveu um filtro — não que
 * o banco recusa a consulta que esqueceu de filtrar. É exatamente a consulta
 * esquecida que vaza o paciente de outra clínica.
 */
const URL_APP = process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir'
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client
let app: pg.Client
let clinicaA: string
let clinicaB: string

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  app = new pg.Client({ connectionString: URL_APP })
  await migrate.connect()
  await app.connect()

  const sufixo = Date.now()
  const a = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica A') RETURNING id`,
    [`teste-a-${sufixo}`],
  )
  const b = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica B') RETURNING id`,
    [`teste-b-${sufixo}`],
  )
  clinicaA = a.rows[0]!.id
  clinicaB = b.rows[0]!.id

  for (const [clinica, chave] of [
    [clinicaA, 'pf_a'],
    [clinicaB, 'pf_b'],
  ] as const) {
    await migrate.query(
      `INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, 'Recepção', '{jornada}')`,
      [clinica, chave],
    )
    await migrate.query(
      `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
       SELECT $1, 'Fulana', $2, 'x', id FROM perfis WHERE clinica_id = $1`,
      [clinica, `fulana@${chave}.local`],
    )
  }
})

afterAll(async () => {
  await migrate.query('DELETE FROM pessoas WHERE clinica_id = ANY($1)', [[clinicaA, clinicaB]])
  await migrate.query('DELETE FROM perfis  WHERE clinica_id = ANY($1)', [[clinicaA, clinicaB]])
  await migrate.query('DELETE FROM clinicas WHERE id = ANY($1)', [[clinicaA, clinicaB]])
  await migrate.end()
  await app.end()
})

async function comClinica<T>(clinica: string, fn: () => Promise<T>): Promise<T> {
  await app.query('BEGIN')
  await app.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinica])
  try {
    return await fn()
  } finally {
    await app.query('COMMIT')
  }
}

describe('RLS — a clínica é a fronteira', () => {
  it('cada clínica enxerga só as próprias pessoas', async () => {
    const naA = await comClinica(clinicaA, () => app.query('SELECT email FROM pessoas'))
    expect(naA.rows.map((r) => r.email)).toEqual(['fulana@pf_a.local'])

    const naB = await comClinica(clinicaB, () => app.query('SELECT email FROM pessoas'))
    expect(naB.rows.map((r) => r.email)).toEqual(['fulana@pf_b.local'])
  })

  it('buscar o id da outra clínica devolve vazio — não erro, vazio', async () => {
    const r = await comClinica(clinicaA, () =>
      app.query('SELECT email FROM pessoas WHERE clinica_id = $1', [clinicaB]),
    )
    expect(r.rows).toHaveLength(0)
  })

  it('sem fixar a clínica, o banco não entrega nada', async () => {
    await app.query('BEGIN')
    const r = await app.query('SELECT count(*)::int AS n FROM pessoas')
    await app.query('COMMIT')
    expect(r.rows[0]!.n).toBe(0)
  })

  it('não é possível gravar para outra clínica', async () => {
    await expect(
      comClinica(clinicaA, () =>
        app.query(
          `INSERT INTO perfis (clinica_id, chave, nome) VALUES ($1, 'invasor', 'Invasor')`,
          [clinicaB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @fir/api test`
Expected: FAIL — `relation "perfis" does not exist`.

- [ ] **Step 4: Aplicar a migration**

Run: `pnpm db:migrate`
Expected:
```
==> 0002_identidade.sql
1 migration(s) aplicada(s)
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @fir/api test`
Expected: PASS, 4 testes.

> Se o quarto teste falhar com "new row violates row-level security policy", está **certo** — é o `WITH CHECK` funcionando. O `expect(...).rejects.toThrow` é quem verifica isso.

- [ ] **Step 6: Commit**

```bash
git add apps/api/migrations apps/api/src apps/api/vitest.config.ts
git commit -m "feat(api): identidade com RLS forcada e prova de isolamento em Postgres real"
```

---

### Task 11: Autenticação — Argon2id, sessão e limite de tentativas

**Files:**
- Create: `apps/api/src/autenticacao/senha.ts`, `apps/api/src/autenticacao/senha.test.ts`
- Create: `apps/api/src/autenticacao/sessao.ts`, `apps/api/src/autenticacao/sessao.test.ts`
- Modify: `apps/api/package.json` (adicionar `@node-rs/argon2`)

**Interfaces:**
- Produces: `hashDeSenha(senha: string): Promise<string>`, `conferirSenha(senha: string, hash: string): Promise<boolean>`, `novoToken(): { token: string; hash: string }`, `hashDoToken(token: string): string`, `const DURACAO_SESSAO_MS`, `limiteExcedido(tentativas: { em: Date; sucesso: boolean }[], agora: Date): boolean`

- [ ] **Step 1: Adicionar a dependência**

Run:
```bash
pnpm --filter @fir/api add @node-rs/argon2
```

> `@node-rs/argon2` é binário nativo. É por isso que a imagem de produção usará Debian `slim` e não Alpine: a diferença entre glibc e musl aparece na primeira tentativa de login em produção.

- [ ] **Step 2: Escrever os testes que falham**

`apps/api/src/autenticacao/senha.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { conferirSenha, hashDeSenha } from './senha.js'

describe('senha', () => {
  it('o hash não contém a senha e é verificável', async () => {
    const hash = await hashDeSenha('firmare-demonstracao')
    expect(hash).not.toContain('firmare-demonstracao')
    expect(hash.startsWith('$argon2id$')).toBe(true)
    expect(await conferirSenha('firmare-demonstracao', hash)).toBe(true)
  })

  it('recusa a senha errada', async () => {
    const hash = await hashDeSenha('firmare-demonstracao')
    expect(await conferirSenha('firmare-demonstracaa', hash)).toBe(false)
  })

  it('dois hashes da mesma senha são diferentes — o sal é por hash', async () => {
    expect(await hashDeSenha('igual')).not.toBe(await hashDeSenha('igual'))
  })

  it('hash corrompido devolve false em vez de lançar', async () => {
    expect(await conferirSenha('qualquer', 'nao-e-um-hash')).toBe(false)
  })
})
```

`apps/api/src/autenticacao/sessao.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { hashDoToken, limiteExcedido, novoToken } from './sessao.js'

describe('token de sessão', () => {
  it('gera token opaco e o hash correspondente', () => {
    const { token, hash } = novoToken()
    expect(token).toHaveLength(43) // 32 bytes em base64url
    expect(hash).toBe(hashDoToken(token))
    expect(hash).not.toContain(token)
  })

  it('dois tokens nunca são iguais', () => {
    const vistos = new Set(Array.from({ length: 200 }, () => novoToken().token))
    expect(vistos.size).toBe(200)
  })
})

describe('limite de tentativas', () => {
  const agora = new Date('2026-10-23T12:00:00Z')
  const falha = (minutosAtras: number) => ({
    em: new Date(agora.getTime() - minutosAtras * 60_000),
    sucesso: false,
  })

  it('cinco falhas na janela bloqueiam', () => {
    expect(limiteExcedido([falha(1), falha(2), falha(3), falha(4), falha(5)], agora)).toBe(true)
  })

  it('quatro falhas ainda passam', () => {
    expect(limiteExcedido([falha(1), falha(2), falha(3), falha(4)], agora)).toBe(false)
  })

  it('falhas fora da janela de 15 minutos não contam', () => {
    expect(limiteExcedido([falha(20), falha(21), falha(22), falha(23), falha(24)], agora)).toBe(false)
  })

  it('um sucesso zera a contagem', () => {
    const t = [falha(10), falha(9), { em: new Date(agora.getTime() - 8 * 60_000), sucesso: true }, falha(2)]
    expect(limiteExcedido(t, agora)).toBe(false)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @fir/api test -- autenticacao`
Expected: FAIL — `Failed to resolve import "./senha.js"`.

- [ ] **Step 4: Implementar**

`apps/api/src/autenticacao/senha.ts`:
```ts
import { hash, verify } from '@node-rs/argon2'

/**
 * Argon2id. Nunca MD5, SHA-*, nem bcrypt novo.
 *
 * Parâmetros do perfil OWASP de 2024: 19 MiB, 2 iterações, paralelismo 1.
 * Em VPS compartilhada, memória é o recurso escasso — 19 MiB por login
 * simultâneo é o teto que cabe ao lado dos outros containers.
 */
const OPCOES = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export const hashDeSenha = (senha: string): Promise<string> => hash(senha, OPCOES)

export async function conferirSenha(senha: string, hashGuardado: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, senha)
  } catch {
    // Hash corrompido ou em formato desconhecido é senha errada, não erro 500.
    return false
  }
}
```

`apps/api/src/autenticacao/sessao.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto'

/** Trinta dias. O balcão não pode relogar a cada hora — ver pendência P-1. */
export const DURACAO_SESSAO_MS = 30 * 24 * 60 * 60 * 1000

const JANELA_TENTATIVAS_MS = 15 * 60 * 1000
const MAX_FALHAS = 5

/**
 * Token opaco de 32 bytes. O banco guarda só o hash: um dump de `sessoes` não
 * vale por um login.
 *
 * SHA-256 e não Argon2 aqui, de propósito — o token tem 256 bits de entropia,
 * então não há o que um ataque de dicionário adivinhe, e a verificação acontece
 * em toda requisição.
 */
export function novoToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashDoToken(token) }
}

export const hashDoToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export type Tentativa = { readonly em: Date; readonly sucesso: boolean }

/**
 * Cinco falhas em quinze minutos bloqueiam. Um sucesso zera a contagem — quem
 * errou a senha três vezes e acertou não deve ficar perto do bloqueio.
 */
export function limiteExcedido(tentativas: readonly Tentativa[], agora: Date): boolean {
  const corte = agora.getTime() - JANELA_TENTATIVAS_MS
  const naJanela = tentativas
    .filter((t) => t.em.getTime() >= corte)
    .sort((a, b) => a.em.getTime() - b.em.getTime())

  const ultimoSucesso = naJanela.map((t) => t.sucesso).lastIndexOf(true)
  const depoisDoSucesso = ultimoSucesso === -1 ? naJanela : naJanela.slice(ultimoSucesso + 1)
  return depoisDoSucesso.filter((t) => !t.sucesso).length >= MAX_FALHAS
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @fir/api test -- autenticacao`
Expected: PASS, 8 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/autenticacao apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): Argon2id, token de sessao opaco e limite de tentativas"
```

---

### Task 12: `packages/contracts` — o contrato da fundação

**Files:**
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/vitest.config.ts`
- Create: `packages/contracts/src/comum.ts`, `packages/contracts/src/autenticacao.ts`, `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/autenticacao.test.ts`

**Interfaces:**
- Consumes: nada do domínio ainda nesta tarefa
- Produces: workspace `@fir/contracts`; `EntrarEntrada`, `EntrarSaida`, `EuSaida`, `PerfilPublico`, `PessoaPublica`, `type Entrar`, `type Eu`; `dinheiroEmTexto` (schema que serializa `bigint` de centavos como string)

- [ ] **Step 1: Criar o pacote**

`packages/contracts/package.json`:
```json
{
  "name": "@fir/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit", "build": "tsc" },
  "dependencies": { "@fir/domain": "workspace:*", "zod": "^3" },
  "devDependencies": { "typescript": "^5.7", "vitest": "^2" }
}
```

`packages/contracts/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/contracts/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
```

- [ ] **Step 2: Escrever o teste que falha**

`packages/contracts/src/autenticacao.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { dinheiroEmTexto, EntrarEntrada } from './index.js'

describe('EntrarEntrada', () => {
  it('aceita e-mail e senha válidos, normalizando o e-mail', () => {
    const r = EntrarEntrada.parse({ email: '  Demo@Firmare.Local ', senha: 'firmare-demonstracao' })
    expect(r.email).toBe('demo@firmare.local')
  })

  it('recusa e-mail inválido e senha curta', () => {
    expect(EntrarEntrada.safeParse({ email: 'nao-e-email', senha: 'firmare-x' }).success).toBe(false)
    expect(EntrarEntrada.safeParse({ email: 'a@b.local', senha: 'curta' }).success).toBe(false)
  })
})

describe('dinheiroEmTexto', () => {
  it('serializa centavos como string, para o JSON não perder precisão', () => {
    // JSON.stringify(10n) lança; Number(centavos) perde precisão acima de 2^53.
    // O contrato trafega string e o cliente nunca faz aritmética com ela.
    expect(dinheiroEmTexto.parse('125050')).toBe(125050n)
    expect(dinheiroEmTexto.parse(null)).toBe(null)
  })

  it('recusa texto que não é inteiro', () => {
    expect(dinheiroEmTexto.safeParse('1250.50').success).toBe(false)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm install && pnpm --filter @fir/contracts test`
Expected: FAIL — `Failed to resolve import "./index.js"`.

- [ ] **Step 4: Implementar**

`packages/contracts/src/comum.ts`:
```ts
import { z } from 'zod'

/**
 * Dinheiro trafega como **string de centavos**.
 *
 * `JSON.stringify(125050n)` lança, e `Number(centavos)` perde precisão acima de
 * 2^53. String resolve os dois, e tem um efeito colateral desejado: o cliente
 * não consegue somar dois valores sem converter de propósito — o que o faria
 * cair na regra de que o front não calcula dinheiro.
 */
export const dinheiroEmTexto = z
  .union([z.string().regex(/^-?\d+$/, 'centavos precisam ser um inteiro'), z.null()])
  .transform((v) => (v === null ? null : BigInt(v)))

/** Quantidade trafega como string de milésimos, pela mesma razão. */
export const quantidadeEmTexto = z
  .union([z.string().regex(/^-?\d+$/, 'milésimos precisam ser um inteiro'), z.null()])
  .transform((v) => (v === null ? null : BigInt(v)))

export const DiaCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato aaaa-mm-dd')
export const Mes = z.string().regex(/^\d{4}-\d{2}$/, 'use o formato aaaa-mm')
export const Uuid = z.string().uuid()

export const Erro = z.object({ codigo: z.string(), mensagem: z.string() })
export type Erro = z.infer<typeof Erro>
```

`packages/contracts/src/autenticacao.ts`:
```ts
import { z } from 'zod'
import { Uuid } from './comum.js'

export const EntrarEntrada = z.object({
  email: z.string().trim().toLowerCase().email('Informe um e-mail válido.'),
  // Oito é o piso; a força real vem do limite de tentativas e do Argon2id.
  senha: z.string().min(8, 'A senha precisa de pelo menos 8 caracteres.').max(200),
})
export type EntrarEntrada = z.infer<typeof EntrarEntrada>

export const PerfilPublico = z.object({
  id: Uuid,
  chave: z.string(),
  nome: z.string(),
  perms: z.array(z.string()),
})
export type PerfilPublico = z.infer<typeof PerfilPublico>

export const PessoaPublica = z.object({
  id: Uuid,
  nome: z.string(),
  email: z.string(),
  funcao: z.string(),
  admin: z.boolean(),
  perfilId: Uuid.nullable(),
  ativo: z.boolean(),
})
export type PessoaPublica = z.infer<typeof PessoaPublica>

export const ClinicaPublica = z.object({
  id: Uuid,
  codigo: z.string(),
  nome: z.string(),
  fuso: z.string(),
})
export type ClinicaPublica = z.infer<typeof ClinicaPublica>

/** O que `GET /v1/eu` devolve. A tela monta o menu a partir de `perfis`. */
export const EuSaida = z.object({
  usuario: PessoaPublica,
  clinica: ClinicaPublica,
  perfis: z.array(PerfilPublico),
})
export type EuSaida = z.infer<typeof EuSaida>

export const EntrarSaida = EuSaida
export type EntrarSaida = z.infer<typeof EntrarSaida>
```

`packages/contracts/src/index.ts`:
```ts
export * from './comum.js'
export * from './autenticacao.js'
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @fir/contracts test`
Expected: PASS, 4 testes.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat(contracts): contrato da fundacao com dinheiro em string de centavos"
```

---

### Task 13: A API de pé — Nest, Fastify e o middleware de clínica

**Files:**
- Create: `apps/api/src/main.ts`, `apps/api/src/app.module.ts`
- Create: `apps/api/src/banco/banco.module.ts`, `apps/api/src/banco/banco.service.ts`
- Create: `apps/api/src/comum/clinica.middleware.ts`
- Create: `apps/api/src/saude/saude.controller.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `clinicas` e `app_clinica_id()` das Tasks 9–10
- Produces: `BancoService.naClinica<T>(clinicaId, fn)` — abre transação, faz `SET LOCAL app.clinica_id`, executa e confirma; `GET /v1/saude` responde `{ ok: true }`; API escutando em `0.0.0.0:4811` dentro do container e `127.0.0.1:4811` no desenvolvimento

- [ ] **Step 1: Adicionar as dependências do Nest**

Run:
```bash
pnpm --filter @fir/api add @nestjs/common @nestjs/core @nestjs/platform-fastify @fir/contracts reflect-metadata rxjs
pnpm --filter @fir/api add -D @nestjs/testing supertest @types/supertest
```

- [ ] **Step 2: Escrever o teste que falha**

`apps/api/src/saude/saude.controller.test.ts`:
```ts
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @fir/api test -- saude`
Expected: FAIL — `Failed to resolve import "../app.module.js"`.

- [ ] **Step 4: Implementar o acesso ao banco**

`apps/api/src/banco/banco.service.ts`:
```ts
import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import pg from 'pg'

/**
 * Pool único, com o papel `fir_app` — **sujeito à RLS**.
 *
 * Rodar a aplicação com um papel que atravessa a RLS faria todo teste de
 * isolamento passar sem provar coisa alguma.
 */
@Injectable()
export class BancoService implements OnModuleDestroy {
  private readonly pool = new pg.Pool({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://fir_app:fir_local_dev@127.0.0.1:4832/fir',
    max: 10,
  })

  /** Consulta sem clínica fixada. Só para `clinicas` e para o healthcheck. */
  async semClinica<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
    return this.pool.query<T>(sql, params)
  }

  /**
   * Abre uma transação, fixa `app.clinica_id` nela e executa.
   *
   * `SET LOCAL` e não `SET`: o escopo é a transação, então uma conexão
   * devolvida ao pool nunca carrega a clínica da requisição anterior. Essa é a
   * diferença entre isolamento e um vazamento intermitente que só aparece sob
   * carga.
   */
  async naClinica<T>(clinicaId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect()
    try {
      await c.query('BEGIN')
      await c.query('SELECT set_config($1, $2, true)', ['app.clinica_id', clinicaId])
      const r = await fn(c)
      await c.query('COMMIT')
      return r
    } catch (e) {
      await c.query('ROLLBACK')
      throw e
    } finally {
      c.release()
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end()
  }
}
```

`apps/api/src/banco/banco.module.ts`:
```ts
import { Global, Module } from '@nestjs/common'
import { BancoService } from './banco.service.js'

@Global()
@Module({ providers: [BancoService], exports: [BancoService] })
export class BancoModule {}
```

- [ ] **Step 5: Implementar o healthcheck e o módulo raiz**

`apps/api/src/saude/saude.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common'
import { BancoService } from '../banco/banco.service.js'

/**
 * Healthcheck que verifica o **banco**, não só se o processo está de pé.
 * Um container "saudável" cujo Postgres caiu é pior que um container morto:
 * ele continua recebendo tráfego.
 */
@Controller('v1/saude')
export class SaudeController {
  constructor(private readonly banco: BancoService) {}

  @Get()
  async saude(): Promise<{ ok: boolean; banco: boolean }> {
    try {
      await this.banco.semClinica('SELECT 1')
      return { ok: true, banco: true }
    } catch {
      return { ok: false, banco: false }
    }
  }
}
```

`apps/api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { BancoModule } from './banco/banco.module.js'
import { SaudeController } from './saude/saude.controller.js'

@Module({ imports: [BancoModule], controllers: [SaudeController] })
export class AppModule {}
```

`apps/api/src/main.ts`:
```ts
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
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @fir/api test -- saude`
Expected: PASS, 1 teste.

- [ ] **Step 7: Verificar que a API sobe de verdade**

Run (em outro terminal, com `fir infra` no ar):
```bash
pnpm --filter @fir/api dev
```
Depois: `curl -s http://127.0.0.1:4811/v1/saude`
Expected: `{"ok":true,"banco":true}`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): Nest com Fastify, pool sujeito a RLS e healthcheck que checa o banco"
```

---

### Task 14: O interceptor de redação — o tradutor único

**Files:**
- Create: `apps/api/src/comum/redacao.interceptor.ts`, `apps/api/src/comum/redacao.interceptor.test.ts`
- Create: `apps/api/src/comum/contexto.ts`

**Interfaces:**
- Consumes: `CAMPOS_MONETARIOS`, `temPerm`, `Perfil` de `@fir/domain`
- Produces: `redigir(dado: unknown, pode: (chave: ChaveDePermissao) => boolean): unknown`, `class RedacaoInterceptor`, `type ContextoDaRequisicao = { clinicaId: string; usuario: PessoaPublica; perfis: Perfil[] }`

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/src/comum/redacao.interceptor.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { redigir } from './redacao.interceptor.js'

const semValores = (c: string) => c !== 'valores' && c !== 'pessoas.gerir'
const comTudo = () => true

describe('redacao', () => {
  it('apaga campo monetário de quem não tem valores', () => {
    const r = redigir({ id: 't1', descricao: 'Consulta', valor: '15000' }, semValores) as Record<string, unknown>
    expect(r['valor']).toBe(null)
    expect(r['descricao']).toBe('Consulta')
  })

  it('não apaga nada de quem tem valores', () => {
    const r = redigir({ valor: '15000' }, comTudo) as Record<string, unknown>
    expect(r['valor']).toBe('15000')
  })

  it('desce em arrays e objetos aninhados — onde o vazamento mora', () => {
    const entrada = {
      tarefas: [{ valor: '100', paciente: { nome: 'Ana', ltv: '9900' } }],
      resumo: { recebido: '500' },
    }
    const r = redigir(entrada, semValores) as any
    expect(r.tarefas[0].valor).toBe(null)
    expect(r.tarefas[0].paciente.nome).toBe('Ana')
    expect(r.tarefas[0].paciente.ltv).toBe(null)
    expect(r.resumo.recebido).toBe(null)
  })

  it('salario depende de pessoas.gerir, não de valores', () => {
    const soValores = (c: string) => c === 'valores'
    const r = redigir({ salario: '500000', valor: '100' }, soValores) as Record<string, unknown>
    expect(r['salario']).toBe(null)
    expect(r['valor']).toBe('100')
  })

  it('não quebra em null, data e tipos primitivos', () => {
    expect(redigir(null, semValores)).toBe(null)
    expect(redigir('texto', semValores)).toBe('texto')
    expect(redigir(42, semValores)).toBe(42)
    const d = new Date('2026-10-23T00:00:00Z')
    expect(redigir(d, semValores)).toBe(d)
  })

  it('preserva a forma: campo apagado vira null, não some', () => {
    // Se o campo sumisse, o cliente não distinguiria "sem permissão" de
    // "valor ausente", e cada tela precisaria de um `if` a mais.
    const r = redigir({ valor: '1' }, semValores) as Record<string, unknown>
    expect('valor' in r).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @fir/api test -- redacao`
Expected: FAIL — `Failed to resolve import "./redacao.interceptor.js"`.

- [ ] **Step 3: Implementar**

`apps/api/src/comum/contexto.ts`:
```ts
import type { ChaveDePermissao, Perfil } from '@fir/domain'
import type { PessoaPublica } from '@fir/contracts'

/** O que o guard de autenticação anexa à requisição. */
export type ContextoDaRequisicao = {
  readonly clinicaId: string
  readonly clinicaFuso: string
  readonly usuario: PessoaPublica
  readonly perfis: readonly Perfil[]
  readonly pode: (chave: ChaveDePermissao) => boolean
}

export type RequisicaoComContexto = { contexto?: ContextoDaRequisicao }
```

`apps/api/src/comum/redacao.interceptor.ts`:
```ts
import { CAMPOS_MONETARIOS, type ChaveDePermissao } from '@fir/domain'
import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import type { RequisicaoComContexto } from './contexto.js'

/**
 * O TRADUTOR ÚNICO.
 *
 * Sem a permissão `valores`, todo campo monetário sai da resposta como `null`.
 * Isto atravessa **toda** saída da API, e é deliberado que não exista um `if`
 * por controlador: o endpoint número quarenta não será revisado com o cuidado
 * do primeiro, e o esquecido vaza o salário de uma funcionária.
 *
 * `salario` é o único que depende de `pessoas.gerir` em vez de `valores` —
 * dado de RH não se libera junto com receita.
 */
const CAMPOS = new Set<string>(CAMPOS_MONETARIOS)
const CHAVE_DO_CAMPO: Readonly<Record<string, ChaveDePermissao>> = { salario: 'pessoas.gerir' }

export function redigir(dado: unknown, pode: (chave: ChaveDePermissao) => boolean): unknown {
  if (dado === null || typeof dado !== 'object') return dado
  if (dado instanceof Date) return dado
  if (Array.isArray(dado)) return dado.map((x) => redigir(x, pode))

  const saida: Record<string, unknown> = {}
  for (const [chave, valor] of Object.entries(dado as Record<string, unknown>)) {
    if (CAMPOS.has(chave)) {
      // Vira null, não some: a forma da resposta não muda com a permissão, e o
      // cliente distingue "sem acesso" de "sem valor" sem um `if` extra.
      saida[chave] = pode(CHAVE_DO_CAMPO[chave] ?? 'valores') ? valor : null
      continue
    }
    saida[chave] = redigir(valor, pode)
  }
  return saida
}

@Injectable()
export class RedacaoInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<RequisicaoComContexto>()
    const contexto = req.contexto
    // Sem contexto é rota pública (entrar, saúde): não há nada a redigir, e
    // também não há como decidir — então não se inventa permissão.
    if (!contexto) return next.handle()
    return next.handle().pipe(map((dado) => redigir(dado, contexto.pode)))
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @fir/api test -- redacao`
Expected: PASS, 6 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/comum
git commit -m "feat(api): interceptor unico de redacao de valores"
```

---

### Task 15: Entrar, sair e `/v1/eu`

**Files:**
- Create: `apps/api/src/autenticacao/autenticacao.service.ts`
- Create: `apps/api/src/autenticacao/autenticacao.controller.ts`
- Create: `apps/api/src/autenticacao/sessao.guard.ts`
- Create: `apps/api/src/autenticacao/autenticacao.module.ts`
- Create: `apps/api/src/autenticacao/autenticacao.e2e.test.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: `BancoService.naClinica`, `hashDeSenha`, `conferirSenha`, `novoToken`, `hashDoToken`, `limiteExcedido`, `DURACAO_SESSAO_MS`, `EntrarEntrada`, `EuSaida`, `temPerm`, `perfisPadrao`
- Produces: `POST /v1/entrar`, `POST /v1/sair`, `GET /v1/eu`; cookie `__Host-fir-sessao`; `SessaoGuard` que popula `req.contexto`

- [ ] **Step 1: Adicionar o cookie ao Fastify**

Run: `pnpm --filter @fir/api add @fastify/cookie`

- [ ] **Step 2: Escrever o teste ponta a ponta que falha**

`apps/api/src/autenticacao/autenticacao.e2e.test.ts`:
```ts
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { Test } from '@nestjs/testing'
import pg from 'pg'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppModule } from '../app.module.js'
import { registrarCookie } from '../main.js'
import { hashDeSenha } from './senha.js'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let app: NestFastifyApplication
let migrate: pg.Client
let clinica: string
const codigo = `e2e-${Date.now()}`

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()

  const c = await migrate.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome) VALUES ($1, 'Clínica E2E') RETURNING id`,
    [codigo],
  )
  clinica = c.rows[0]!.id

  const p = await migrate.query<{ id: string }>(
    `INSERT INTO perfis (clinica_id, chave, nome, perms)
     VALUES ($1, 'pf_rec', 'Recepção', ARRAY['jornada','receber']) RETURNING id`,
    [clinica],
  )
  await migrate.query(
    `INSERT INTO pessoas (clinica_id, nome, email, senha_hash, perfil_id)
     VALUES ($1, 'Juliana', 'juliana@e2e.local', $2, $3)`,
    [clinica, await hashDeSenha('senha-de-teste'), p.rows[0]!.id],
  )

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
  app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter())
  await registrarCookie(app)
  await app.init()
  await app.getHttpAdapter().getInstance().ready()
})

afterAll(async () => {
  await migrate.query('DELETE FROM sessoes WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM tentativas_login WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM pessoas WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM perfis WHERE clinica_id = $1', [clinica])
  await migrate.query('DELETE FROM clinicas WHERE id = $1', [clinica])
  await migrate.end()
  await app.close()
})

const entrar = (senha: string) =>
  request(app.getHttpServer())
    .post('/v1/entrar')
    .send({ clinica: codigo, email: 'juliana@e2e.local', senha })

describe('POST /v1/entrar', () => {
  it('sem sessão, /v1/eu responde 401', async () => {
    await request(app.getHttpServer()).get('/v1/eu').expect(401)
  })

  it('entra e devolve usuário, clínica e perfis', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    expect(r.body.usuario.email).toBe('juliana@e2e.local')
    expect(r.body.clinica.codigo).toBe(codigo)
    expect(r.body.perfis[0].perms).toContain('jornada')
    expect(r.headers['set-cookie'].join()).toMatch(/__Host-fir-sessao=/)
  })

  it('o cookie é HttpOnly, Secure, SameSite e de caminho raiz', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const cookie = r.headers['set-cookie'].join()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).toMatch(/Path=\//)
  })

  it('a resposta NUNCA contém o hash da senha nem o token cru', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const texto = JSON.stringify(r.body)
    expect(texto).not.toMatch(/\$argon2id\$/)
    expect(texto).not.toMatch(/token/i)
  })

  it('senha errada responde 401 com a MESMA frase de e-mail inexistente', async () => {
    const a = await entrar('senha-errada').expect(401)
    const b = await request(app.getHttpServer())
      .post('/v1/entrar')
      .send({ clinica: codigo, email: 'ninguem@e2e.local', senha: 'senha-de-teste' })
      .expect(401)
    // Mensagens diferentes dizem ao atacante quais e-mails existem na clínica.
    expect(a.body.message).toBe(b.body.message)
  })

  it('com sessão, /v1/eu responde 200', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const cookie = r.headers['set-cookie']
    const eu = await request(app.getHttpServer()).get('/v1/eu').set('Cookie', cookie).expect(200)
    expect(eu.body.usuario.nome).toBe('Juliana')
  })

  it('sair revoga a sessão: o mesmo cookie passa a dar 401', async () => {
    const r = await entrar('senha-de-teste').expect(200)
    const cookie = r.headers['set-cookie']
    await request(app.getHttpServer()).post('/v1/sair').set('Cookie', cookie).expect(204)
    await request(app.getHttpServer()).get('/v1/eu').set('Cookie', cookie).expect(401)
  })

  it('cinco senhas erradas bloqueiam a sexta tentativa, mesmo com a senha certa', async () => {
    for (let i = 0; i < 5; i++) await entrar('senha-errada').expect(401)
    await entrar('senha-de-teste').expect(429)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @fir/api test -- autenticacao.e2e`
Expected: FAIL — `registrarCookie` não existe.

- [ ] **Step 4: Implementar o serviço**

`apps/api/src/autenticacao/autenticacao.service.ts`:
```ts
import type { EuSaida } from '@fir/contracts'
import { type ChaveDePermissao, type Perfil, temPerm } from '@fir/domain'
import { Injectable } from '@nestjs/common'
import { BancoService } from '../banco/banco.service.js'
import type { ContextoDaRequisicao } from '../comum/contexto.js'
import { conferirSenha } from './senha.js'
import { DURACAO_SESSAO_MS, hashDoToken, limiteExcedido, novoToken } from './sessao.js'

export class CredencialInvalida extends Error {}
export class LimiteDeTentativas extends Error {}

type LinhaPessoa = {
  id: string
  nome: string
  email: string
  funcao: string
  senha_hash: string
  admin: boolean
  perfil_id: string | null
  ativo: boolean
}

@Injectable()
export class AutenticacaoService {
  constructor(private readonly banco: BancoService) {}

  private async clinicaPorCodigo(codigo: string) {
    const r = await this.banco.semClinica<{ id: string; codigo: string; nome: string; fuso: string }>(
      'SELECT id, codigo, nome, fuso FROM clinicas WHERE codigo = $1 AND ativa',
      [codigo],
    )
    return r.rows[0] ?? null
  }

  private async perfisDa(clinicaId: string): Promise<Perfil[]> {
    return this.banco.naClinica(clinicaId, async (c) => {
      const r = await c.query<{ id: string; chave: string; nome: string; perms: string[] }>(
        'SELECT id, chave, nome, perms FROM perfis ORDER BY nome',
      )
      return r.rows.map((p) => ({
        id: p.id,
        nome: p.nome,
        perms: p.perms as ChaveDePermissao[],
      }))
    })
  }

  /**
   * Entra. A mesma frase de erro para e-mail inexistente e senha errada: frases
   * diferentes dizem ao atacante quais e-mails existem naquela clínica.
   */
  async entrar(codigoClinica: string, email: string, senha: string): Promise<{ eu: EuSaida; token: string }> {
    const clinica = await this.clinicaPorCodigo(codigoClinica)
    if (!clinica) throw new CredencialInvalida()

    return this.banco.naClinica(clinica.id, async (c) => {
      const tentativas = await c.query<{ em: Date; sucesso: boolean }>(
        `SELECT em, sucesso FROM tentativas_login
         WHERE identificador = $1 AND em > now() - interval '15 minutes'`,
        [email],
      )
      if (limiteExcedido(tentativas.rows, new Date())) throw new LimiteDeTentativas()

      const p = await c.query<LinhaPessoa>(
        `SELECT id, nome, email, funcao, senha_hash, admin, perfil_id, ativo
         FROM pessoas WHERE email = $1 AND ativo`,
        [email],
      )
      const pessoa = p.rows[0]

      const ok = pessoa ? await conferirSenha(senha, pessoa.senha_hash) : false
      await c.query(
        'INSERT INTO tentativas_login (clinica_id, identificador, sucesso) VALUES ($1, $2, $3)',
        [clinica.id, email, ok],
      )
      if (!ok || !pessoa) throw new CredencialInvalida()

      const { token, hash } = novoToken()
      await c.query(
        `INSERT INTO sessoes (clinica_id, pessoa_id, token_hash, expira_em)
         VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)`,
        [clinica.id, pessoa.id, hash, String(DURACAO_SESSAO_MS)],
      )

      const perfisRaw = await c.query<{ id: string; chave: string; nome: string; perms: string[] }>(
        'SELECT id, chave, nome, perms FROM perfis ORDER BY nome',
      )

      return {
        token,
        eu: {
          usuario: {
            id: pessoa.id,
            nome: pessoa.nome,
            email: pessoa.email,
            funcao: pessoa.funcao,
            admin: pessoa.admin,
            perfilId: pessoa.perfil_id,
            ativo: pessoa.ativo,
          },
          clinica: { id: clinica.id, codigo: clinica.codigo, nome: clinica.nome, fuso: clinica.fuso },
          perfis: perfisRaw.rows.map((x) => ({ id: x.id, chave: x.chave, nome: x.nome, perms: x.perms })),
        },
      }
    })
  }

  /** Resolve o cookie em contexto. Devolve `null` quando a sessão não vale. */
  async contextoDoToken(token: string): Promise<ContextoDaRequisicao | null> {
    const hash = hashDoToken(token)
    const s = await this.banco.semClinica<{ clinica_id: string; pessoa_id: string }>(
      `SELECT clinica_id, pessoa_id FROM sessoes
       WHERE token_hash = $1 AND revogada_em IS NULL AND expira_em > now()`,
      [hash],
    )
    const sessao = s.rows[0]
    if (!sessao) return null

    const clinicaRow = await this.banco.semClinica<{ id: string; codigo: string; nome: string; fuso: string; ativa: boolean }>(
      'SELECT id, codigo, nome, fuso, ativa FROM clinicas WHERE id = $1',
      [sessao.clinica_id],
    )
    const clinica = clinicaRow.rows[0]
    // Clínica desativada derruba a sessão: `ativa` é um estado com efeito, não
    // um rótulo no painel.
    if (!clinica?.ativa) return null

    return this.banco.naClinica(clinica.id, async (c) => {
      const p = await c.query<LinhaPessoa>(
        `SELECT id, nome, email, funcao, senha_hash, admin, perfil_id, ativo
         FROM pessoas WHERE id = $1 AND ativo`,
        [sessao.pessoa_id],
      )
      const pessoa = p.rows[0]
      if (!pessoa) return null

      const perfisRaw = await c.query<{ id: string; chave: string; nome: string; perms: string[] }>(
        'SELECT id, chave, nome, perms FROM perfis ORDER BY nome',
      )
      const perfis: Perfil[] = perfisRaw.rows.map((x) => ({
        id: x.id,
        nome: x.nome,
        perms: x.perms as ChaveDePermissao[],
      }))

      const usuarioParaPermissao = { admin: pessoa.admin, perfilId: pessoa.perfil_id ?? '' }

      return {
        clinicaId: clinica.id,
        clinicaFuso: clinica.fuso,
        usuario: {
          id: pessoa.id,
          nome: pessoa.nome,
          email: pessoa.email,
          funcao: pessoa.funcao,
          admin: pessoa.admin,
          perfilId: pessoa.perfil_id,
          ativo: pessoa.ativo,
        },
        perfis,
        pode: (chave: ChaveDePermissao) => temPerm(usuarioParaPermissao, perfis, chave),
      } satisfies ContextoDaRequisicao
    })
  }

  async sair(token: string): Promise<void> {
    await this.banco.semClinica('UPDATE sessoes SET revogada_em = now() WHERE token_hash = $1', [
      hashDoToken(token),
    ])
  }

  async perfisPublicos(clinicaId: string): Promise<Perfil[]> {
    return this.perfisDa(clinicaId)
  }
}
```

- [ ] **Step 5: Implementar o guard e o controlador**

`apps/api/src/autenticacao/sessao.guard.ts`:
```ts
import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import type { RequisicaoComContexto } from '../comum/contexto.js'
import { AutenticacaoService } from './autenticacao.service.js'

export const NOME_DO_COOKIE = '__Host-fir-sessao'

/**
 * Popula `req.contexto` a partir do cookie. **Nenhum identificador de usuário
 * ou de clínica vem do corpo ou da query** — se viesse, trocar um id no
 * DevTools leria o paciente de outra clínica.
 */
@Injectable()
export class SessaoGuard implements CanActivate {
  constructor(private readonly auth: AutenticacaoService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequisicaoComContexto & { cookies?: Record<string, string> }>()
    const token = req.cookies?.[NOME_DO_COOKIE]
    if (!token) throw new UnauthorizedException('Entre para continuar.')

    const contexto = await this.auth.contextoDoToken(token)
    if (!contexto) throw new UnauthorizedException('Entre para continuar.')

    req.contexto = contexto
    return true
  }
}
```

`apps/api/src/autenticacao/autenticacao.controller.ts`:
```ts
import { EntrarEntrada, type EuSaida } from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import type { RequisicaoComContexto } from '../comum/contexto.js'
import { AutenticacaoService, CredencialInvalida, LimiteDeTentativas } from './autenticacao.service.js'
import { DURACAO_SESSAO_MS } from './sessao.js'
import { NOME_DO_COOKIE, SessaoGuard } from './sessao.guard.js'

/** Uma frase só para toda falha de credencial. Ver o teste e2e. */
const FRASE = 'E-mail ou senha incorretos.'

@Controller('v1')
export class AutenticacaoController {
  constructor(private readonly auth: AutenticacaoService) {}

  @Post('entrar')
  @HttpCode(HttpStatus.OK)
  async entrar(
    @Body() corpo: unknown,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<EuSaida> {
    const dados = EntrarEntrada.extend(EntrarEntrada.shape).safeParse(corpo)
    const clinica = (corpo as { clinica?: unknown })?.clinica
    if (!dados.success || typeof clinica !== 'string' || clinica === '') {
      throw new BadRequestException('Confira a clínica, o e-mail e a senha.')
    }

    try {
      const { eu, token } = await this.auth.entrar(clinica, dados.data.email, dados.data.senha)

      // `__Host-` obriga Secure e Path=/, e proíbe Domain. É o prefixo mais
      // restrito que existe — e é por ele que HTTPS deixa de ser opcional:
      // sobre http:// o navegador descarta o cookie e ninguém fica logado.
      res.setCookie(NOME_DO_COOKIE, token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(DURACAO_SESSAO_MS / 1000),
      })
      return eu
    } catch (e) {
      if (e instanceof LimiteDeTentativas) {
        throw new HttpException(
          'Muitas tentativas. Espere quinze minutos e tente de novo.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
      if (e instanceof CredencialInvalida) throw new UnauthorizedException(FRASE)
      throw e
    }
  }

  @Post('sair')
  @HttpCode(HttpStatus.NO_CONTENT)
  async sair(
    @Req() req: { cookies?: Record<string, string> },
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const token = req.cookies?.[NOME_DO_COOKIE]
    if (token) await this.auth.sair(token)
    res.clearCookie(NOME_DO_COOKIE, { path: '/' })
  }

  @Get('eu')
  @UseGuards(SessaoGuard)
  eu(@Req() req: RequisicaoComContexto): EuSaida {
    const c = req.contexto!
    return {
      usuario: c.usuario,
      clinica: { id: c.clinicaId, codigo: '', nome: '', fuso: c.clinicaFuso },
      perfis: c.perfis.map((p) => ({ id: p.id, chave: '', nome: p.nome, perms: [...p.perms] })),
    }
  }
}
```

> **Nota de implementação:** `GET /v1/eu` precisa devolver `codigo` e `nome` da clínica de verdade. Acrescente-os ao `ContextoDaRequisicao` (`clinicaCodigo`, `clinicaNome`) em `contexto.ts` e preencha-os em `contextoDoToken` — os dados já estão na consulta de `clinicas`. O teste `eu.body.usuario.nome` passa sem isso, mas a tela precisa do nome.

`apps/api/src/autenticacao/autenticacao.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { AutenticacaoController } from './autenticacao.controller.js'
import { AutenticacaoService } from './autenticacao.service.js'
import { SessaoGuard } from './sessao.guard.js'

@Module({
  controllers: [AutenticacaoController],
  providers: [AutenticacaoService, SessaoGuard],
  exports: [AutenticacaoService, SessaoGuard],
})
export class AutenticacaoModule {}
```

- [ ] **Step 6: Ligar o cookie e o interceptor no módulo raiz**

`apps/api/src/app.module.ts`:
```ts
import { Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { AutenticacaoModule } from './autenticacao/autenticacao.module.js'
import { BancoModule } from './banco/banco.module.js'
import { RedacaoInterceptor } from './comum/redacao.interceptor.js'
import { SaudeController } from './saude/saude.controller.js'

@Module({
  imports: [BancoModule, AutenticacaoModule],
  controllers: [SaudeController],
  // Global de propósito: a redação não é opcional por rota.
  providers: [{ provide: APP_INTERCEPTOR, useClass: RedacaoInterceptor }],
})
export class AppModule {}
```

Em `apps/api/src/main.ts`, exporte o registro do cookie para o teste reaproveitar:
```ts
import 'reflect-metadata'
import cookie from '@fastify/cookie'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from './app.module.js'

export async function registrarCookie(app: NestFastifyApplication): Promise<void> {
  await app.register(cookie as never)
}

const PORTA = Number(process.env['PORTA'] ?? 4811)
const HOST = process.env['HOST'] ?? '127.0.0.1'

// `import.meta.url` contra argv: o módulo é importado pelos testes, e lá não
// se quer abrir porta nenhuma.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())
  await registrarCookie(app)
  await app.listen(PORTA, HOST)
  process.stdout.write(`API em http://${HOST}:${PORTA}\n`)
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @fir/api test -- autenticacao.e2e`
Expected: PASS, 8 testes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src pnpm-lock.yaml
git commit -m "feat(api): entrar, sair e /v1/eu com cookie __Host- e limite de tentativas"
```

---

### Task 16: A semente da clínica de demonstração

**Files:**
- Create: `apps/api/semear.ts`

**Interfaces:**
- Consumes: `perfisPadrao` de `@fir/domain`, `hashDeSenha`
- Produces: `pnpm db:seed` — idempotente: rodar de novo não duplica nada

- [ ] **Step 1: Escrever a semente**

`apps/api/semear.ts`:
```ts
/**
 * Semeia a clínica de demonstração local.
 *
 * Idempotente de propósito: o `fir.bat` chama isto em toda subida, e uma
 * semente que duplica dado a cada execução torna o ambiente inútil no
 * terceiro dia.
 */
import pg from 'pg'
import { perfisPadrao } from '@fir/domain'
import { hashDeSenha } from './src/autenticacao/senha.js'

const CODIGO = 'demo'
const EMAIL = 'demo@firmare.local'
const SENHA = 'firmare-demonstracao'

const url =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

const c = new pg.Client({ connectionString: url })
await c.connect()

const existente = await c.query<{ id: string }>('SELECT id FROM clinicas WHERE codigo = $1', [CODIGO])
if (existente.rows[0]) {
  process.stdout.write(`clínica "${CODIGO}" já existe; nada a semear\n`)
  await c.end()
  process.exit(0)
}

await c.query('BEGIN')
try {
  const cl = await c.query<{ id: string }>(
    `INSERT INTO clinicas (codigo, nome, fuso) VALUES ($1, 'Clínica Modelo', 'America/Bahia') RETURNING id`,
    [CODIGO],
  )
  const clinicaId = cl.rows[0]!.id

  for (const p of perfisPadrao()) {
    await c.query(
      'INSERT INTO perfis (clinica_id, chave, nome, perms) VALUES ($1, $2, $3, $4)',
      [clinicaId, p.id, p.nome, [...p.perms]],
    )
  }

  // A administradora: `admin = true` e, pela restrição `pessoa_tem_acesso_definido`,
  // sem perfil.
  await c.query(
    `INSERT INTO pessoas (clinica_id, nome, email, funcao, senha_hash, admin)
     VALUES ($1, 'Dra. Helena Prado', $2, 'Médica responsável', $3, true)`,
    [clinicaId, EMAIL, await hashDeSenha(SENHA)],
  )

  // Uma pessoa por perfil, para exercitar a redação de valores sem ficar
  // trocando o perfil da administradora.
  const porPerfil: [string, string, string, string][] = [
    ['pf_rec', 'Juliana Santos', 'juliana@firmare.local', 'Recepção'],
    ['pf_enf', 'Camila Rocha', 'camila@firmare.local', 'Enfermagem'],
    ['pf_com', 'Patrícia Lima', 'patricia@firmare.local', 'Comercial interno'],
    ['pf_fin', 'Rosa Andrade', 'rosa@firmare.local', 'Financeiro'],
  ]
  for (const [chave, nome, email, funcao] of porPerfil) {
    await c.query(
      `INSERT INTO pessoas (clinica_id, nome, email, funcao, senha_hash, admin, perfil_id)
       SELECT $1, $2, $3, $4, $5, false, id FROM perfis WHERE clinica_id = $1 AND chave = $6`,
      [clinicaId, nome, email, funcao, await hashDeSenha(SENHA), chave],
    )
  }

  await c.query('COMMIT')
  process.stdout.write(
    `clínica "${CODIGO}" criada · entre com ${EMAIL} / ${SENHA}\n` +
      `credenciais valem SÓ neste ambiente local\n`,
  )
} catch (e) {
  await c.query('ROLLBACK')
  process.stderr.write(`ERRO ao semear: ${(e as Error).message}\n`)
  await c.end()
  process.exit(1)
}

await c.end()
```

- [ ] **Step 2: Rodar duas vezes e confirmar a idempotência**

Run:
```bash
pnpm db:seed
pnpm db:seed
docker exec fir-postgres psql -U fir -d fir -tAc "select count(*) from pessoas"
```
Expected:
```
clínica "demo" criada · entre com demo@firmare.local / firmare-demonstracao
...
clínica "demo" já existe; nada a semear
5
```

- [ ] **Step 3: Entrar de verdade pela API**

Run:
```bash
curl -s -X POST http://127.0.0.1:4811/v1/entrar \
  -H 'content-type: application/json' \
  -d '{"clinica":"demo","email":"demo@firmare.local","senha":"firmare-demonstracao"}' | head -c 300
```
Expected: JSON com `usuario`, `clinica` e `perfis` — e **sem** nenhum `$argon2id$`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/semear.ts
git commit -m "feat(api): semente idempotente da clinica de demonstracao"
```

---

### Task 17: `packages/ui` — os tokens "papel e dourado"

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`
- Create: `packages/ui/src/tokens.css`, `packages/ui/src/index.ts`

**Interfaces:**
- Produces: `@fir/ui` com `tokens.css` importável; `formatarDinheiro(centavos: bigint | null): string`, `formatarQuantidade(milesimos: bigint | null, unidade: string): string`

- [ ] **Step 1: Criar o pacote e os tokens**

`packages/ui/package.json`:
```json
{
  "name": "@fir/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts", "./tokens.css": "./src/tokens.css" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "echo sem testes && exit 0" },
  "devDependencies": { "typescript": "^5.7" }
}
```

`packages/ui/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "lib": ["ES2023", "DOM"] },
  "include": ["src"]
}
```

`packages/ui/src/tokens.css`:
```css
/*
 * Identidade "papel e dourado", herdada do protótipo e mantida de propósito:
 * as quatro clínicas em uso já a reconhecem. Ver docs/design.md.
 *
 * O dourado tem DOIS papéis e eles não se trocam: --gold é traço, borda e
 * realce; --gold-ink é texto. Dourado claro sobre fundo claro não passa em AA,
 * e é o erro mais comum nesta paleta.
 */
:root {
  --bg: #f9f7f2;
  --surface: #ffffff;
  --ink: #2e1f0e;
  --muted: #6e5e4b;
  --line: #e6dfd1;
  --gold: #c5a467;
  --gold-ink: #86672e;
  --gold-soft: #f1e8d5;
  --btn-bg: #2e1f0e;
  --btn-ink: #f9f7f2;
  --ok: #3f7d4e;
  --ok-soft: #e3f0e5;
  --warn: #a8701a;
  --warn-soft: #f7ecd8;
  --bad: #b4442f;
  --bad-soft: #f6e1dc;
  --display: 'Lora', Georgia, 'Times New Roman', serif;
  --body: Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --r: 10px;
}

/* Tema escuro é par de primeira classe. O seletor manual vence nos dois sentidos. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #17110a;
    --surface: #221a10;
    --ink: #f3ede2;
    --muted: #b5a68f;
    --line: #3a2d1d;
    --gold: #c5a467;
    --gold-ink: #ddc28c;
    --gold-soft: #33271a;
    --btn-bg: #c5a467;
    --btn-ink: #1a130a;
    --ok: #86c696;
    --ok-soft: #1f3324;
    --warn: #e3b461;
    --warn-soft: #3a2c14;
    --bad: #e88672;
    --bad-soft: #3d1f18;
    color-scheme: dark;
  }
}

:root[data-theme='dark'] {
  --bg: #17110a;
  --surface: #221a10;
  --ink: #f3ede2;
  --muted: #b5a68f;
  --line: #3a2d1d;
  --gold-ink: #ddc28c;
  --gold-soft: #33271a;
  --btn-bg: #c5a467;
  --btn-ink: #1a130a;
  --ok: #86c696;
  --ok-soft: #1f3324;
  --warn: #e3b461;
  --warn-soft: #3a2c14;
  --bad: #e88672;
  --bad-soft: #3d1f18;
  color-scheme: dark;
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.45 var(--body);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 {
  font-family: var(--display);
  font-weight: 600;
  margin: 0;
  text-wrap: balance;
  letter-spacing: 0.2px;
}
button { cursor: pointer; }
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }

/* Algarismos tabulares em TODA coluna de valor, quantidade ou data.
   Número que dança entre linhas não se compara, e comparar é o motivo de a
   coluna existir. */
.num { font-variant-numeric: tabular-nums; }

.wrap { max-width: 760px; margin: 0 auto; padding-inline: 16px; }
```

`packages/ui/src/index.ts`:
```ts
const DINHEIRO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/**
 * O formatador central. A regra do `CLAUDE.md` é que dinheiro na tela sai
 * daqui — nunca `toFixed(2)` solto, nunca `Intl` chamado direto na página.
 *
 * `null` significa "você não tem permissão para ver", e é o que o interceptor
 * de redação da API devolve. Mostrar "R$ 0,00" ali seria mentira.
 */
export function formatarDinheiro(centavos: bigint | null | undefined): string {
  if (centavos === null || centavos === undefined) return '—'
  const negativo = centavos < 0n
  const abs = negativo ? -centavos : centavos
  const texto = DINHEIRO.format(Number(abs / 100n) + Number(abs % 100n) / 100)
  return negativo ? `-${texto}` : texto
}

export function formatarQuantidade(
  milesimos: bigint | null | undefined,
  unidade: string,
): string {
  if (milesimos === null || milesimos === undefined) return '—'
  const negativa = milesimos < 0n
  const abs = negativa ? -milesimos : milesimos
  const inteiros = abs / 1000n
  const decimais = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '')
  const numero = decimais === '' ? `${inteiros}` : `${inteiros},${decimais}`
  return `${negativa ? '-' : ''}${numero} ${unidade}`
}
```

- [ ] **Step 2: Verificar**

Run: `pnpm install && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/ui pnpm-lock.yaml
git commit -m "feat(ui): tokens papel e dourado e formatador central"
```

---

### Task 18: Web — entrada e Hoje vazia

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.mjs`
- Create: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`
- Create: `apps/web/src/app/entrar/page.tsx`
- Create: `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/app/(app)/hoje/page.tsx`
- Create: `apps/web/src/lib/api.ts`, `apps/web/src/lib/menu.ts`

**Interfaces:**
- Consumes: `EuSaida`, `PerfilPublico` de `@fir/contracts`; `temPerm` de `@fir/domain`; `@fir/ui/tokens.css`
- Produces: web em `127.0.0.1:4810`; `/api/*` reescrito para a API; `itensDoMenu(usuario, perfis)` devolve só o que a permissão libera

- [ ] **Step 1: Criar o app**

Run:
```bash
pnpm --filter @fir/web add next react react-dom @fir/contracts @fir/domain @fir/ui
pnpm --filter @fir/web add -D @types/react @types/react-dom
```

`apps/web/package.json`:
```json
{
  "name": "@fir/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 4810 -H 127.0.0.1",
    "build": "next build",
    "start": "next start -p 4810",
    "typecheck": "tsc --noEmit",
    "test": "echo sem testes unitarios no web && exit 0"
  }
}
```

`apps/web/next.config.mjs`:
```js
/**
 * O navegador chama `/api/...` na MESMA origem do web, e o servidor do Next
 * repassa para a API pela rede interna.
 *
 * Não é conveniência: é o que faz o cookie `__Host-fir-sessao` funcionar sem
 * CORS. `__Host-` proíbe `Domain`, então o cookie só vale na origem exata —
 * e uma API em outra origem simplesmente não o receberia.
 *
 * `??` não cai no padrão para string vazia: um `ARG` do Docker não passado
 * vira `ENV` vazia. Daí o `||`.
 */
const API = process.env.FIR_API_URL || 'http://127.0.0.1:4811'

export default {
  reactStrictMode: true,
  transpilePackages: ['@fir/contracts', '@fir/domain', '@fir/ui'],
  async rewrites() {
    return [{ source: '/api/:caminho*', destination: `${API}/:caminho*` }]
  },
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "allowJs": true,
    "noEmit": true,
    "incremental": true,
    "moduleResolution": "Bundler",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 2: Escrever o menu guiado por permissão, com teste**

`apps/web/src/lib/menu.ts`:
```ts
import { type ChaveDePermissao, type Perfil, temPerm } from '@fir/domain'

export type ItemDeMenu = {
  readonly href: string
  readonly rotulo: string
  readonly grupo: 'Dia a dia' | 'Comercial' | 'Financeiro' | 'Processos' | 'Pessoas' | 'Gestão'
  /** `null` = sempre liberado. Ver CLAUDE.md §2, regra 16. */
  readonly perm: ChaveDePermissao | null
}

/** Hoje, as próprias tarefas, Nova tarefa, Minhas metas, Ajuda e Manual são de todos. */
export const MENU: readonly ItemDeMenu[] = [
  { href: '/hoje', rotulo: 'Hoje', grupo: 'Dia a dia', perm: null },
  { href: '/tarefas', rotulo: 'Tarefas', grupo: 'Dia a dia', perm: null },
  { href: '/nova', rotulo: 'Nova tarefa', grupo: 'Dia a dia', perm: null },
  { href: '/jornada', rotulo: 'Jornada do paciente', grupo: 'Comercial', perm: 'jornada' },
  { href: '/pacientes', rotulo: 'Pacientes', grupo: 'Comercial', perm: 'pacientes' },
  { href: '/programas', rotulo: 'Programas', grupo: 'Comercial', perm: 'programas' },
  { href: '/campanhas', rotulo: 'Campanhas', grupo: 'Comercial', perm: 'campanhas' },
  { href: '/recebimentos', rotulo: 'Recebimentos', grupo: 'Financeiro', perm: 'receber' },
  { href: '/caixa', rotulo: 'Caixa do dia', grupo: 'Financeiro', perm: 'caixa' },
  { href: '/contas', rotulo: 'Contas a pagar', grupo: 'Financeiro', perm: 'contas' },
  { href: '/cobrancas', rotulo: 'Cobranças', grupo: 'Financeiro', perm: 'cobrancas' },
  { href: '/visao-do-mes', rotulo: 'Visão do mês', grupo: 'Financeiro', perm: 'finmes' },
  { href: '/estoque', rotulo: 'Estoque', grupo: 'Processos', perm: 'estoque' },
  { href: '/equipe', rotulo: 'Equipe', grupo: 'Pessoas', perm: 'pessoas.gerir' },
  { href: '/minhas-metas', rotulo: 'Minhas metas', grupo: 'Pessoas', perm: null },
  { href: '/painel', rotulo: 'Painel geral', grupo: 'Gestão', perm: 'painel' },
  { href: '/configuracoes', rotulo: 'Configurações', grupo: 'Gestão', perm: 'config' },
]

/** Tela sem permissão **some do menu**. Quem alcança por URL vê "Sem acesso". */
export function itensDoMenu(
  usuario: { admin: boolean; perfilId: string | null },
  perfis: readonly Perfil[],
): ItemDeMenu[] {
  const u = { admin: usuario.admin, perfilId: usuario.perfilId ?? '' }
  return MENU.filter((i) => i.perm === null || temPerm(u, perfis, i.perm))
}
```

`apps/web/src/lib/menu.test.ts`:
```ts
import { perfisPadrao } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { itensDoMenu } from './menu.js'

const perfis = perfisPadrao()
const href = (u: { admin: boolean; perfilId: string | null }) =>
  itensDoMenu(u, perfis).map((i) => i.href)

describe('menu por permissão', () => {
  it('administrador vê tudo', () => {
    expect(href({ admin: true, perfilId: null })).toHaveLength(17)
  })

  it('enfermagem vê programas e estoque, não vê financeiro', () => {
    const h = href({ admin: false, perfilId: 'pf_enf' })
    expect(h).toContain('/programas')
    expect(h).toContain('/estoque')
    expect(h).not.toContain('/recebimentos')
    expect(h).not.toContain('/visao-do-mes')
  })

  it('financeiro vê visão do mês porque tem valores junto', () => {
    expect(href({ admin: false, perfilId: 'pf_fin' })).toContain('/visao-do-mes')
  })

  it('recepção não vê visão do mês — não tem valores', () => {
    expect(href({ admin: false, perfilId: 'pf_rec' })).not.toContain('/visao-do-mes')
  })

  it('Hoje, Nova e Minhas metas são de todos, inclusive sem perfil', () => {
    const h = href({ admin: false, perfilId: null })
    expect(h).toEqual(['/hoje', '/tarefas', '/nova', '/minhas-metas'])
  })
})
```

Adicione `vitest` ao `@fir/web` e troque o script `test` para `vitest run`.

Run: `pnpm --filter @fir/web test`
Expected: PASS, 5 testes.

- [ ] **Step 3: Escrever o cliente de API e as telas**

`apps/web/src/lib/api.ts`:
```ts
/**
 * Toda chamada vai para `/api/...` na mesma origem, com `credentials: 'include'`
 * para o cookie `__Host-fir-sessao` viajar.
 *
 * Dinheiro chega como string de centavos e **não é convertido aqui**: o front
 * não calcula dinheiro. Quem exibe chama `formatarDinheiro(BigInt(s))`.
 */
export class ErroDaApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem)
  }
}

export async function chamar<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const r = await fetch(`/api/${caminho.replace(/^\//, '')}`, {
    ...opcoes,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(opcoes.headers ?? {}) },
  })
  if (!r.ok) {
    const corpo = (await r.json().catch(() => ({}))) as { message?: string }
    throw new ErroDaApi(r.status, corpo.message ?? 'Não foi possível completar a ação.')
  }
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T)
}
```

`apps/web/src/app/globals.css`:
```css
@import '@fir/ui/tokens.css';
```

`apps/web/src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = { title: 'Firmare · Gestão de Rotina' }

export default function RaizLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

`apps/web/src/app/entrar/page.tsx`:
```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'

export default function Entrar() {
  const router = useRouter()
  const [clinica, setClinica] = useState('demo')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await chamar('v1/entrar', { method: 'POST', body: JSON.stringify({ clinica, email, senha }) })
      router.push('/hoje')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="wrap" style={{ maxWidth: 420, paddingTop: 64 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ color: 'var(--gold-ink)', fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase' }}>
          Firmare
        </div>
        <h1 style={{ fontSize: 30 }}>Gestão de Rotina</h1>
      </div>

      <form onSubmit={enviar} style={{ display: 'grid', gap: 14 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          Clínica
          <input value={clinica} onChange={(e) => setClinica(e.target.value)} autoComplete="organization" required style={campo} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required style={campo} />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          Senha
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" required style={campo} />
        </label>

        {erro && (
          <p role="alert" style={{ color: 'var(--bad)', background: 'var(--bad-soft)', padding: '10px 12px', borderRadius: 'var(--r)', margin: 0 }}>
            {erro}
          </p>
        )}

        <button type="submit" disabled={enviando} style={botao}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}

const campo: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r)',
  background: 'var(--surface)',
}

const botao: React.CSSProperties = {
  padding: '12px 16px',
  border: 0,
  borderRadius: 'var(--r)',
  background: 'var(--btn-bg)',
  color: 'var(--btn-ink)',
  fontWeight: 600,
}
```

`apps/web/src/app/(app)/layout.tsx`:
```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import type { EuSaida } from '@fir/contracts'
import { itensDoMenu } from '@/lib/menu'

const API = process.env.FIR_API_URL || 'http://127.0.0.1:4811'

export default async function AppLayout({ children }: { children: ReactNode }) {
  // A sessão é resolvida no SERVIDOR: a tela nunca decide se alguém entrou.
  const cabecalho = (await cookies()).toString()
  const r = await fetch(`${API}/v1/eu`, { headers: { cookie: cabecalho }, cache: 'no-store' })
  if (!r.ok) redirect('/entrar')

  const eu = (await r.json()) as EuSaida
  const itens = itensDoMenu(eu.usuario, eu.perfis.map((p) => ({ id: p.id, nome: p.nome, perms: p.perms as never })))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', minHeight: '100%' }}>
      <header style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface)' }}>
        <div className="wrap" style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px' }}>
          <strong style={{ fontFamily: 'var(--display)' }}>{eu.clinica.nome || 'Firmare'}</strong>
          <nav style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 14 }}>
            {itens.map((i) => (
              <a key={i.href} href={i.href} style={{ color: 'var(--muted)', textDecoration: 'none' }}>
                {i.rotulo}
              </a>
            ))}
          </nav>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 14 }}>{eu.usuario.nome}</span>
        </div>
      </header>
      <main className="wrap" style={{ paddingBlock: 24 }}>{children}</main>
    </div>
  )
}
```

`apps/web/src/app/(app)/hoje/page.tsx`:
```tsx
export default function Hoje() {
  return (
    <section>
      <div style={{ color: 'var(--gold-ink)', fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase' }}>
        Dia a dia
      </div>
      <h2 style={{ fontSize: 26, marginBottom: 16 }}>Hoje</h2>

      {/* O estado vazio é a primeira tela que toda clínica nova vê, e é onde
          ela decide se a ferramenta vale o dia. Ele diz o que fazer em seguida. */}
      <div
        style={{
          border: '1px dashed var(--line)',
          borderRadius: 'var(--r)',
          padding: 32,
          textAlign: 'center',
          color: 'var(--muted)',
          background: 'var(--surface)',
        }}
      >
        Nenhuma tarefa em aberto para hoje.
        <br />
        <a href="/nova" style={{ color: 'var(--gold-ink)', marginTop: 8, display: 'inline-block' }}>
          Criar tarefa
        </a>
      </div>
    </section>
  )
}
```

`apps/web/src/app/page.tsx`:
```tsx
import { redirect } from 'next/navigation'

export default function Raiz() {
  redirect('/hoje')
}
```

- [ ] **Step 4: Subir tudo e entrar de verdade**

Run: `fir`
Depois abra `http://127.0.0.1:4810` e entre com `demo@firmare.local` / `firmare-demonstracao`.

Expected: a tela Hoje aparece com o menu completo (administradora vê os 17 itens). Entrando como `camila@firmare.local` (enfermagem), o menu mostra Hoje, Tarefas, Nova tarefa, Programas, Estoque e Minhas metas — e **não** mostra Recebimentos nem Visão do mês.

> **Atenção ao cookie `Secure` em `http://localhost`:** navegadores aceitam cookie `Secure` em `localhost` e `127.0.0.1` como exceção explícita ao requisito de origem segura. Se o seu navegador recusar, use `http://localhost:4810` em vez do IP. Em produção não há exceção: sem HTTPS, o login não existe.

- [ ] **Step 5: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): entrada, shell com menu por permissao e Hoje vazia"
```

---

### Task 19: Os quatro testes transversais

**Files:**
- Create: `teste/registro.ts`, `teste/redacao-de-valores.test.ts`, `teste/isolamento-de-clinica.test.ts`
- Create: `teste/package.json`, `teste/vitest.config.ts`

**Interfaces:**
- Consumes: `CAMPOS_MONETARIOS`, a API de pé
- Produces: `ROTAS_COM_DINHEIRO: RotaRegistrada[]` e `ENTIDADES_COM_CLINICA: string[]` — **cada plano novo acrescenta aqui**, e o teste falha se esquecerem

- [ ] **Step 1: Criar o registro que cresce com o sistema**

`teste/registro.ts`:
```ts
/**
 * O registro que os testes transversais varrem.
 *
 * **Todo plano novo acrescenta aqui.** Uma lista mantida à mão fica
 * desatualizada no endpoint número quarenta — por isso os testes abaixo
 * verificam o registro contra o que a API de fato expõe, e falham quando
 * alguém acrescenta uma rota sem registrar.
 */
export type RotaRegistrada = {
  readonly metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly caminho: string
  /** Campos monetários que esta rota pode devolver. */
  readonly camposDeDinheiro: readonly string[]
}

/** Plano 1 não expõe dinheiro ainda. Planos 2+ preenchem. */
export const ROTAS_COM_DINHEIRO: readonly RotaRegistrada[] = []

/** Tabelas de negócio com `clinica_id`. O teste de isolamento varre todas. */
export const ENTIDADES_COM_CLINICA: readonly string[] = ['perfis', 'pessoas', 'sessoes', 'tentativas_login']
```

- [ ] **Step 2: Escrever o teste de isolamento que varre o registro**

`teste/isolamento-de-clinica.test.ts`:
```ts
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENTIDADES_COM_CLINICA } from './registro.js'

const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let migrate: pg.Client

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  await migrate.connect()
})

afterAll(async () => {
  await migrate.end()
})

describe('toda tabela de negócio está protegida', () => {
  it('o registro cobre TODAS as tabelas com clinica_id — nenhuma escapa', async () => {
    const r = await migrate.query<{ tablename: string }>(
      `SELECT c.relname AS tablename
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND a.attname = 'clinica_id' AND NOT a.attisdropped`,
    )
    const noBanco = r.rows.map((x) => x.tablename).sort()
    // Se esta asserção falhar, alguém criou uma tabela com clinica_id e não a
    // registrou. Acrescente ao registro — e confira que ela tem RLS.
    expect(noBanco).toEqual([...ENTIDADES_COM_CLINICA].sort())
  })

  it('cada tabela registrada tem RLS habilitada E forçada', async () => {
    for (const t of ENTIDADES_COM_CLINICA) {
      const r = await migrate.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        'SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = $1',
        [t],
      )
      expect(r.rows[0], `tabela ${t} não existe`).toBeDefined()
      expect(r.rows[0]!.relrowsecurity, `${t} sem RLS habilitada`).toBe(true)
      // FORCE para que nem o dono da tabela escape. Sem isto, um job rodando
      // como fir_migrate leria todas as clínicas sem perceber.
      expect(r.rows[0]!.relforcerowsecurity, `${t} sem RLS forçada`).toBe(true)
    }
  })

  it('cada tabela registrada tem policy com USING e WITH CHECK', async () => {
    for (const t of ENTIDADES_COM_CLINICA) {
      const r = await migrate.query<{ qual: string | null; with_check: string | null }>(
        'SELECT qual, with_check FROM pg_policies WHERE tablename = $1',
        [t],
      )
      expect(r.rows.length, `${t} sem policy`).toBeGreaterThan(0)
      const p = r.rows[0]!
      expect(p.qual, `${t}: policy sem USING`).toContain('app_clinica_id')
      // Sem WITH CHECK, a leitura é isolada mas a ESCRITA para outra clínica
      // passa — e é assim que se grava um paciente no tenant errado.
      expect(p.with_check, `${t}: policy sem WITH CHECK`).toContain('app_clinica_id')
    }
  })
})
```

- [ ] **Step 3: Escrever o teste de redação que varre o registro**

`teste/redacao-de-valores.test.ts`:
```ts
import { CAMPOS_MONETARIOS } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import { ROTAS_COM_DINHEIRO } from './registro.js'

/**
 * Este arquivo ainda não tem muito a fazer no plano 1 — nenhuma rota devolve
 * dinheiro. Ele existe desde já porque o plano 4 acrescenta onze rotas de uma
 * vez, e um teste escrito depois de as rotas existirem é um teste escrito para
 * passar.
 */
describe('registro de rotas com dinheiro', () => {
  it('todo campo registrado está na lista do domínio', () => {
    const conhecidos = new Set<string>(CAMPOS_MONETARIOS)
    for (const rota of ROTAS_COM_DINHEIRO) {
      for (const campo of rota.camposDeDinheiro) {
        expect(conhecidos.has(campo), `${rota.caminho}: campo "${campo}" não está em CAMPOS_MONETARIOS`).toBe(true)
      }
    }
  })

  it('nenhuma rota é registrada duas vezes', () => {
    const chaves = ROTAS_COM_DINHEIRO.map((r) => `${r.metodo} ${r.caminho}`)
    expect(new Set(chaves).size).toBe(chaves.length)
  })
})
```

`teste/package.json`:
```json
{
  "name": "@fir/teste",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@fir/domain": "workspace:*", "pg": "^8" },
  "devDependencies": { "@types/pg": "^8", "typescript": "^5.7", "vitest": "^2" }
}
```

Acrescente `teste` a `pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
  - 'teste'
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm install && pnpm --filter @fir/teste test`
Expected: PASS, 5 testes.

- [ ] **Step 5: Provar que o teste pega o esquecimento**

Crie uma tabela de mentira e confirme que o teste **falha**:
```bash
docker exec fir-postgres psql -U fir_migrate -d fir -c \
  "CREATE TABLE teste_esquecida (id serial primary key, clinica_id uuid not null)"
pnpm --filter @fir/teste test
```
Expected: FAIL — `expected [ 'perfis', ... ] to deeply equal [ ... 'teste_esquecida' ]`.

Depois limpe:
```bash
docker exec fir-postgres psql -U fir_migrate -d fir -c "DROP TABLE teste_esquecida"
pnpm --filter @fir/teste test
```
Expected: PASS.

> Este passo não é cerimônia. Um teste transversal que nunca foi visto falhando é um teste que ninguém sabe se funciona.

- [ ] **Step 6: Commit**

```bash
git add teste pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "test: registro transversal de RLS e de redacao, provado falhando"
```

---

### Task 20: CI e o fechamento do plano

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `README.md`

**Interfaces:**
- Produces: CI que roda typecheck e a suíte completa com Postgres de serviço

- [ ] **Step 1: Escrever o workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

# Um push novo cancela a execução anterior do mesmo branch: a única que
# importa é a do último commit.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verificar:
    name: Typecheck e testes
    runs-on: ubuntu-latest
    timeout-minutes: 15

    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: fir
          POSTGRES_PASSWORD: fir_local_dev
          POSTGRES_DB: fir
          TZ: UTC
          PGTZ: UTC
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U fir -d fir"
          --health-interval 5s --health-timeout 5s --health-retries 10

    env:
      DATABASE_URL: postgresql://fir_app:fir_local_dev@127.0.0.1:5432/fir
      DATABASE_URL_MIGRATE: postgresql://fir_migrate:fir_local_dev@127.0.0.1:5432/fir

    steps:
      - uses: actions/checkout@v4

      # Sem `version`: a action lê `packageManager` do package.json, para a
      # versão do pnpm existir num lugar só.
      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      # --frozen-lockfile: o CI falha se o lockfile divergir, em vez de
      # resolver versões diferentes das que rodaram na máquina.
      - name: Instalar dependências
        run: pnpm install --frozen-lockfile

      # O serviço do Actions não roda o docker-entrypoint-initdb.d, então os
      # papéis entram aqui, com o mesmo SQL do ambiente local.
      - name: Provisionar papéis
        run: psql "postgresql://fir:fir_local_dev@127.0.0.1:5432/fir" -v ON_ERROR_STOP=1 -f infra/bootstrap-papeis.sql

      - name: Migrations
        run: pnpm db:migrate

      - name: Typecheck
        run: pnpm typecheck

      - name: Testes
        run: pnpm test
```

- [ ] **Step 2: Escrever o README**

`README.md`:
```markdown
# Firmare Rotinas de Gestão

Ferramenta multi-clínica que instala os rituais de gestão na rotina da equipe.
Roda **ao lado** do sistema da clínica, não no lugar dele.

> **Status: fundação.** O plano 1 está implementado: ambiente local, domínio
> puro (Dinheiro, Quantidade, Relógio, Permissões, Tipos), banco multi-clínica
> com RLS e autenticação por e-mail e senha. A paridade com o protótipo é o
> plano 9. Ver `docs/superpowers/plans/2026-10-23-mapa-de-execucao.md`.

## Começar

Precisa de Docker Desktop e Node 22.

```
fir            sobe tudo e deixa a aplicação rodando
fir down       derruba, preservando os dados
fir reset      zera o banco local
fir status     estado dos serviços
fir logs       logs em tempo real
fir psql       shell psql no banco local
```

Depois de `fir`: `http://127.0.0.1:4810`, com `demo@firmare.local` /
`firmare-demonstracao`. Credenciais valem só neste ambiente.

## Antes de dizer que algo está pronto

```bash
pnpm typecheck && pnpm test
```

## Mapa do repositório

| Caminho | O que é |
|---|---|
| `CLAUDE.md` | Regras inegociáveis, convenções e fluxo de trabalho. **Leia antes de tudo.** |
| `CONTEXT.md` | Linguagem ubíqua: glossário, invariantes e termos proibidos |
| `docs/superpowers/plans/` | O mapa de execução e os planos |
| `docs/team.md` · `docs/pipeline.md` | Quem decide o quê e como o trabalho flui |
| `docs/decisoes.md` | As escolhas do dono, com data, e o que ainda depende dele |
| `prototipo-rotinas-de-gestao.html` | **Especificação funcional.** Nunca entra em build |
| `versoes/v20-producao/` | **Produção atual e origem dos dados.** Nunca entra em build |
```

- [ ] **Step 3: Rodar a verificação completa, do zero**

Run:
```bash
fir reset
fir infra
pnpm db:migrate && pnpm db:seed
pnpm typecheck && pnpm test
```
Expected: PASS em tudo. **Cole a saída** — use `superpowers:verification-before-completion`. Teste que não foi executado não passou.

- [ ] **Step 4: Commit**

```bash
git add .github README.md
git commit -m "ci: typecheck e suite completa com Postgres de servico"
```

---

## Definição de pronto do plano 1

Todos verdes, com a saída colada:

- [ ] `fir` sobe o ambiente do zero e abre o painel com as credenciais.
- [ ] `http://127.0.0.1:4810` deixa entrar com `demo@firmare.local`.
- [ ] A enfermagem (`camila@firmare.local`) **não** vê Recebimentos nem Visão do mês no menu.
- [ ] `GET /v1/eu` sem cookie responde 401.
- [ ] Seis senhas erradas seguidas bloqueiam com 429.
- [ ] `pnpm typecheck` sem erro.
- [ ] `pnpm test` verde — domínio, contratos, API, web e transversais.
- [ ] O teste de isolamento foi **visto falhando** com uma tabela não registrada.
- [ ] O CI passou na `main`.

## Self-review deste plano

**Cobertura:** as 20 tarefas cobrem o épico 1 do roadmap — monorepo, `fir.bat`,
Docker, `Dinheiro`, `Quantidade`, `Relogio`, permissões, tipos, Clínica, Pessoa,
Perfil, RLS, autenticação, CI e web shell. Ficou **fora de propósito** (e está
no plano 2): `Tarefa`, recorrência, Hoje com conteúdo, Pacientes, Unidades.

**Consistência de tipos conferida:** `Result`/`ehOk`/`ehErro` (T3) são usados em
T4, T5 e T7 · `CAMPOS_MONETARIOS` (T7) é consumido em T14 e T19 ·
`ContextoDaRequisicao` (T14) é produzido em T15 e consumido em T14 ·
`BancoService.naClinica` (T13) é usado em T15 · `perfisPadrao` (T7) é usado em
T16 e T18 · `EuSaida` (T12) é devolvido em T15 e consumido em T18 ·
`registrarCookie` (T15) é importado pelo teste e2e do mesmo passo.

**Duas pendências conhecidas, deliberadamente abertas:**

1. **`GET /v1/eu` devolve `codigo` e `nome` da clínica vazios** na T15. A nota
   na própria tarefa diz como fechar (acrescentar ao contexto). O layout do web
   usa `eu.clinica.nome || 'Firmare'` justamente por isso — resolva na T15 e o
   fallback deixa de ser exercitado.
2. **UX de sessão no balcão (P-1)** não é resolvida aqui. A sessão dura 30 dias
   e isso é uma escolha provisória: com três pessoas no mesmo computador, a
   trilha de auditoria registra a pessoa errada. Está em `docs/decisoes.md` e
   **precisa de decisão do dono antes de o plano 1 ser considerado fechado para
   produção** — não para rodar local.

