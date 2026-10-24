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

121 testes, hoje, cobrindo domínio, contratos, API, web e os transversais
(RLS, redação de dinheiro, isolamento de clínica).

## Mapa do repositório

| Caminho | O que é |
|---|---|
| `CLAUDE.md` | Regras inegociáveis, convenções e fluxo de trabalho. **Leia antes de tudo.** |
| `CONTEXT.md` | Linguagem ubíqua: glossário, invariantes e termos proibidos |
| `docs/superpowers/plans/` | O mapa de execução e os planos |
| `docs/adr/` | Decisões de arquitetura registradas (ADRs) |
| `docs/team.md` · `docs/pipeline.md` | Quem decide o quê e como o trabalho flui |
| `docs/decisoes.md` | As escolhas do dono, com data, e o que ainda depende dele |
| `packages/domain`, `packages/contracts`, `packages/ui` | Domínio puro, contratos (zod) e componentes compartilhados |
| `apps/api`, `apps/web` | API (NestJS/Fastify) e web (Next.js) |
| `teste/` | Testes transversais, que atravessam mais de um pacote |
| `infra/` | Docker Compose do ambiente local e o SQL de provisionamento de papéis |
| `prototipo-rotinas-de-gestao.html` | **Especificação funcional.** Nunca entra em build |
| `versoes/v20-producao/` | **Produção atual e origem dos dados.** Nunca entra em build |

## Monorepo

6 pacotes `@fir/*`: `domain`, `contracts`, `ui`, `api`, `web`, `teste` —
listados em `pnpm-workspace.yaml` (`packages/*`, `apps/*` e `teste`).
Orquestrado com pnpm workspaces + Turborepo — `pnpm test` e `pnpm typecheck`
na raiz cobrem todos eles, incluindo `teste/`.
