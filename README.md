# Firmare Rotinas de Gestão

Ferramenta multi-clínica que instala os rituais de gestão na rotina da equipe.
Roda **ao lado** do sistema da clínica, não no lugar dele.

> **Status: fundação.** O plano 1 está implementado: ambiente local, domínio
> puro (Dinheiro, Quantidade, Relógio, Permissões, Tipos), banco multi-clínica
> com RLS, autenticação por e-mail e senha, e um shell web com menu por
> permissão. Os módulos de negócio (tarefas, jornada, financeiro, estoque) e
> a paridade com o protótipo **ainda não existem** — isso é o plano 9. Ver
> `docs/superpowers/plans/2026-10-23-mapa-de-execucao.md`.

## Começar

Precisa de Docker Desktop e Node 22.

```bash
pnpm install   # uma vez, depois de clonar — e de novo só quando as
               # dependências mudarem
```

```
fir            sobe tudo e deixa a aplicação rodando
fir infra      só os containers (banco, Redis, Mailpit) — para os testes
fir down       derruba, preservando os dados
fir reset      zera o banco local
fir status     estado dos serviços
fir logs       logs em tempo real
fir psql       shell psql no banco local
```

Depois de `fir`: `http://127.0.0.1:4810`. A semente cria seis pessoas na
clínica de demonstração (`demo`), todas com a senha `firmare-demonstracao` —
uma por perfil, para exercitar cada nível de permissão, mais a
administradora:

| E-mail | Perfil |
|---|---|
| `demo@firmare.local` | Administradora (sem perfil — acesso total) |
| `beatriz@firmare.local` | Supervisão |
| `juliana@firmare.local` | Recepção |
| `camila@firmare.local` | Enfermagem |
| `patricia@firmare.local` | Comercial interno |
| `rosa@firmare.local` | Financeiro |

Credenciais valem só neste ambiente.

## Antes de dizer que algo está pronto

```bash
pnpm typecheck && pnpm test
```

178 testes, hoje, cobrindo domínio (64), API (79), transversais (19), UI (7),
web (5) e contratos (4). Os transversais são os que mais pegam: RLS com
canários de view, matview e partição; redação de dinheiro varrendo os esquemas
Zod; isolamento de clínica; e a varredura que falha se alguma rota do Nest
ficar sem guard.

`pnpm test` usa o cache do Turborepo. Para uma execução de verdade —
antes de afirmar que algo passou — use `npx turbo run test --force`.

## Mapa do repositório

| Caminho | O que é |
|---|---|
| `CLAUDE.md` | Regras inegociáveis, convenções e fluxo de trabalho. **Leia antes de tudo.** |
| `CONTEXT.md` | Linguagem ubíqua: glossário, invariantes e termos proibidos |
| `docs/superpowers/plans/` | O mapa de execução e os planos |
| `docs/adr/` | Decisões de arquitetura registradas (ADRs) |
| `docs/team.md` · `docs/pipeline.md` | Quem decide o quê e como o trabalho flui |
| `docs/decisoes.md` | As escolhas do dono, com data, e o que ainda depende dele |
| `docs/paridade.md` | **As 59 ações do protótipo, com estado.** É o que "paridade" significa |
| `docs/dividas.md` | Dívida carregada, cada uma com o gatilho que a torna urgente |
| `docs/diferencas-versao-po-vs-nossa.md` | As diferenças entre o que a PO entregou e o que construímos |
| `packages/domain`, `packages/contracts`, `packages/ui` | Domínio puro, contratos (zod) e componentes compartilhados |
| `apps/api`, `apps/web` | API (NestJS/Fastify) e web (Next.js) |
| `teste/` | Testes transversais, que atravessam mais de um pacote |
| `infra/` | Docker Compose do ambiente local e o SQL de provisionamento de papéis |
| `prototipo-rotinas-de-gestao.html` | **Especificação funcional.** Nunca entra em build |
| `versoes/v20-producao/` | **Produção atual e origem dos dados.** Nunca entra em build — e **não está neste repositório**: é o código rodando em 4 clínicas reais, e o repositório é público. Fica no disco da equipe, no `.gitignore` |

## Monorepo

6 pacotes `@fir/*`: `domain`, `contracts`, `ui`, `api`, `web`, `teste` —
listados em `pnpm-workspace.yaml` (`packages/*`, `apps/*` e `teste`).
Orquestrado com pnpm workspaces + Turborepo — `pnpm test` e `pnpm typecheck`
na raiz cobrem todos eles, incluindo `teste/`.
