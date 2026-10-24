# 0001 — Turbopack como bundler da web, imports internos sem extensão

## Contexto

A Task 18 criou `apps/web` (Next.js 16) e a conectou aos pacotes do workspace
(`@fir/domain`, `@fir/contracts`, `@fir/ui`) via `transpilePackages`. Esses
pacotes são TS fonte pura — sem passo de build publicando `.js` — consumidos
diretamente pelo `tsc` (checagem), pelo `tsx` (API em desenvolvimento) e
agora por um bundler de front-end (Next).

Os pacotes escreviam os próprios imports e exports relativos internos no
estilo NodeNext, com extensão `.js` apontando para um arquivo `.ts`:

```ts
// packages/domain/src/index.ts, antes
export * from './resultado.js'   // resultado.ts, não resultado.js
export * from './dinheiro.js'
```

`tsc` resolve isso porque `tsconfig.base.json` usa
`"moduleResolution": "Bundler"`, que aceita (mas não exige) a extensão `.js`
apontando para `.ts`. O `tsx` da API resolve isso em tempo de execução,
porque reimplementa a mesma regra do TypeScript. `apps/api/src/**/*.ts`
seguia a mesma convenção nos próprios imports internos.

Ao abrir qualquer tela de `apps/web` sob `(app)/layout.tsx` — que importa
`@fir/domain` — com o Next no modo padrão (Turbopack, `next dev` sem flags),
a tela quebrava com `500`:

```
Error: ./packages/domain/src/index.ts:2:1
Error: Module not found: Can't resolve './dinheiro.js'
  1 | export * from './resultado.js'
> 2 | export * from './dinheiro.js'
    | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  3 | export * from './quantidade.js'
...
Import trace:
  Server Component:
    ./packages/domain/src/index.ts
    ./apps/web/src/app/(app)/layout.tsx
```

O Turbopack resolve extensão **quando o especificador não tem nenhuma**
(tenta `.tsx`, `.ts`, `.jsx`, `.js`, `.mjs`, `.json` nessa ordem), mas não
troca a extensão de um especificador que **já tem uma** — um especificador
terminado em `.js` só resolve para um arquivo chamado literalmente `.js`.
Isso não é um bug isolado do Turbopack: nem o resolvedor ESM nativo do Node
faz essa troca (por isso `tsx` precisa reimplementá-la). A diferença é que
`tsc` e `tsx` foram escritos para entender a convenção NodeNext; o Turbopack,
não.

A primeira correção tentada — manter os imports com `.js` e configurar o
Next para compensar — tinha dois caminhos:

1. `turbopack.resolveExtensions` no `next.config.mjs`: não resolveu. Essa
   opção só afeta especificadores *sem* extensão; não troca uma extensão
   existente por outra. Reproduzi o mesmo erro `Module not found` depois de
   configurá-la.
2. Trocar o bundler de desenvolvimento e build do `apps/web` de Turbopack
   para Webpack (`next dev --webpack` / `next build --webpack`) com
   `experimental.extensionAlias: { '.js': ['.ts', '.tsx', '.js'] }` — essa
   opção é passada para `resolve.extensionAlias` do Webpack e resolveu o
   problema sem tocar nos pacotes do workspace.

A opção 2 funcionou, mas trocava o bundler de todo o `apps/web` — presente e
futuro — por causa de dez linhas de import em dois pacotes. Revisão de código
apontou a alternativa menor: **remover a extensão `.js` desses imports
internos**, já que `moduleResolution: "Bundler"` permite especificador sem
extensão, e tanto `tsc` quanto `tsx` continuam resolvendo normalmente sem
ela. Sem a extensão, o Turbopack cai no caminho que já funciona (tentar
extensões para especificador sem nenhuma) e resolve sozinho.

## Decisão

1. **`apps/web` usa o Turbopack padrão do Next** (`next dev` / `next build`,
   sem `--webpack` e sem `experimental.extensionAlias`).
2. **Todo import e export relativo interno (`./…`, `../…`) do monorepo
   perde a extensão `.js` — sem exceção de pacote nem de teste.** Isso
   cobre `packages/domain/src/index.ts`, `packages/domain/src/dinheiro.ts`,
   `packages/domain/src/quantidade.ts`, `packages/contracts/src/index.ts`,
   `packages/contracts/src/autenticacao.ts`; todo `apps/api/src/**/*.ts`
   (código e teste); e os arquivos `*.test.ts` de `packages/domain`,
   `packages/contracts`, `packages/ui` e `apps/web` que ainda citavam
   `./arquivo.js` — eles rodam sob Vitest/esbuild, que já resolvia `.js`
   para `.ts` sem reclamar, então o defeito ali nunca foi funcional; era só
   a convenção da ADR valendo pela metade do código. Corrigido numa segunda
   rodada para a convenção não ter exceção: **fonte e teste seguem a mesma
   regra.**
3. Imports de **pacote** (`@fir/domain`, `@nestjs/common`, `node:crypto`
   etc.) continuam sem extensão — nunca tiveram `.js` e não mudam.

Medido depois da mudança: `pnpm typecheck` (7/7 pacotes) e `pnpm test`
(113/113 testes, incluindo os 47 da API que dependem de `tsx` em
desenvolvimento) passaram sem alteração de comportamento. `next dev` voltou
a rodar com `▲ Next.js 16.4.2 (Turbopack)` e serviu `/hoje` com `200`,
inclusive com o menu completo por permissão (confirmado de novo com o login
de `rosa@firmare.local`, que só vê Visão do mês por ter `valores` e `finmes`
juntos). Depois da segunda rodada,
`grep -rn "from '\(\./\|\.\./\).*\.js'" packages/*/src apps/api/src apps/web/src`
dá `0` — nenhum import relativo interno com extensão sobra em lugar
nenhum do monorepo, fonte ou teste.

## Alternativas rejeitadas

**Manter a extensão `.js` e trocar o bundler para Webpack.** Rejeitada:
resolve o sintoma só em `apps/web`, mas deixa a inconsistência nos próprios
pacotes (cada um escrevendo um import que mente sobre a extensão real do
arquivo) e amarra o projeto a um bundler não-padrão por uma causa que tem
correção de dez linhas. Também significa carregar esse conhecimento para
sempre: a próxima pessoa que mexer em `apps/web` precisa saber por que ali,
e só ali, o Next não usa Turbopack.

**Manter a extensão `.js` nos pacotes para compatibilidade com ESM nativo
do Node, caso algum dia alguém rode os pacotes sem bundler.** Rejeitada
por não corresponder a nenhum uso real hoje: a API roda via `tsx` em
desenvolvimento e é empacotada (bundling via esbuild/build do Nest) para
produção; os pacotes `@fir/domain`, `@fir/contracts` e `@fir/ui` só são
consumidos por um bundler (Next, Vite/Vitest) ou pelo `tsx` — nunca por
`node` puro apontando direto para `.ts`. Se esse uso aparecer no futuro, a
convenção muda então, com ADR nova.

## Consequências

- **Convenção do projeto a partir de agora, sem exceção de pacote nem de
  fonte versus teste: imports e exports relativos internos
  (`./arquivo`, `../pasta/arquivo`) não levam extensão, em nenhum arquivo
  do monorepo.** Só imports de pacote (`@fir/...`, `node:...`, bibliotecas
  de `node_modules`) seguem a própria convenção deles, que nunca teve
  extensão. Quem criar um arquivo novo — fonte ou teste, em
  `packages/*`, `apps/api` ou `apps/web` — segue essa regra sem precisar
  perguntar nem copiar de um arquivo antigo que ainda tinha `.js`.
- `apps/web` usa o Next sem flags de bundler — Turbopack é o padrão do
  `next dev`/`next build` dessa versão, e nada no projeto força Webpack.
- Esta ADR não cobre pacotes publicados fora do monorepo nem um eventual
  passo de build que gere `.js` de verdade — se isso surgir, é decisão
  nova.
