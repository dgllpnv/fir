# Firmare Rotinas de Gestão

Ferramenta multi-clínica que instala os rituais de gestão na rotina da equipe:
confirmar consultas, recontatar quem faltou, retomar orçamentos, acompanhar
sessões, contar o estoque, fechar o caixa, pagar contas no prazo, cobrar
saldos, conduzir 1:1.

Ela **não** é o sistema da clínica (agenda, prontuário, faturamento). Roda
**ao lado** dele, aberta o dia inteiro pela recepção.

Lida com dinheiro de clínicas reais, estoque de medicamento controlado e dado
de saúde de pacientes. Leia `CLAUDE.md` antes de mudar qualquer coisa.

## Estado

**Em produção**, numa VPS compartilhada, ao lado de outros negócios. O passo a
passo está em [`infra/producao/README.md`](infra/producao/README.md).

O sistema tem quatro áreas, cada uma com login próprio:

| Área | Para quem | O que tem |
|---|---|---|
| **Produto da clínica** (`/hoje` e demais) | A equipe da clínica | Hoje, Tarefas, Recebimento, Jornada do paciente, Pacientes, Programas, Campanhas, Recebimentos, Outras entradas, Caixa do dia, Contas a pagar, Cobranças, Visão do mês, Estoque, Equipe, Minhas metas, Indicadores & Insights, Painel geral, Unidades, Usuários e acessos, Atividades, Procedimentos, Agenda do sistema, Ajuda e manual |
| **Gestão** (`/gestao`) | Operadores da Firmare | Clínicas, grupos, usuários de gestão, atividades |
| **Carteira** (`/carteira`) | Equipe comercial da Firmare | Clientes, leads, metas, mensalidades, campanhas, rotina interna |
| **Portal** (`/portal`) | Cliente da Firmare (grupo) | O espaço do cliente |

A paridade com o protótipo, ação por ação, está em
[`docs/paridade.md`](docs/paridade.md). O que falta, em ordem, está em
[`docs/fila.md`](docs/fila.md).

## Rodar na sua máquina

Precisa de Docker Desktop, Node 22 e pnpm (`corepack enable`).

```bash
pnpm install        # uma vez, depois de clonar
```

Depois, na raiz, no Windows:

```
fir            sobe banco, Redis e Mailpit, aplica migrations, semeia e roda API + web
fir infra      só os containers (para os testes)
fir down       derruba, preservando os dados
fir reset      zera o banco local
fir status     estado dos serviços
fir logs       logs em tempo real
fir psql       shell psql no banco local
fir workers    sobe os workers (filas) para testar à mão; exige "fir infra" antes
```

Depois de `fir`, a janela fica transmitindo os logs da API e da web. Isso é o
certo: ela está servindo. Abra `http://127.0.0.1:4810`. `Ctrl+C` encerra.

### Portas — bloco 48xx

| Serviço | Porta |
|---|---|
| web | 4810 |
| API | 4811 |
| Postgres | 4832 |
| Redis | 4879 |
| Mailpit (tela) | 4825 |
| Mailpit (SMTP) | 4826 |

Tudo publicado em `127.0.0.1`, nunca em `0.0.0.0`. O 47xx é do Mavia. Os
containers rodam em UTC. Detalhes em [`infra/README.md`](infra/README.md).

### Clínica de demonstração

A semente cria a clínica `demo`. O login é **clínica + usuário + senha**. A
senha de todos é `quatro-pedras-no-caminho`, e vale só neste ambiente.

| Usuário | Perfil |
|---|---|
| `helena` | Administradora |
| `beatriz` | Supervisão |
| `juliana` | Recepção |
| `camila` | Enfermagem |
| `patricia` | Comercial interno |
| `rosa` | Financeiro |

### Comandos do monorepo

```bash
pnpm dev            # api + web
pnpm test           # suíte completa (usa cache do Turborepo)
pnpm test:domain    # só o domínio, rápido
pnpm typecheck
pnpm build
pnpm db:migrate
pnpm db:seed
```

Antes de dizer que algo está pronto:

```bash
pnpm typecheck && pnpm test && pnpm build
```

O `build` está na lista porque já quebrou um deploy com a suíte verde. Para
uma execução sem cache, use `npx turbo run test --force`.

## Documentação técnica

| Documento | O que responde |
|---|---|
| [`infra/producao/README.md`](infra/producao/README.md) | Deploy, máquina nova do zero, variáveis do `.env`, redes e egress |
| [`docs/operacao/estrutura-do-banco.md`](docs/operacao/estrutura-do-banco.md) | Tabelas por módulo e as regras transversais do banco |
| [`docs/operacao/rotinas-agendadas.md`](docs/operacao/rotinas-agendadas.md) | Todos os jobs, filas e crons: o que fazem, quando, onde, o que acontece se falharem |
| [`docs/operacao/logs.md`](docs/operacao/logs.md) | Onde ficam os logs, o que é proibido neles, comandos prontos |
| [`docs/operacao/backup.md`](docs/operacao/backup.md) | Backup, ensaio de restauração e RTO medido |
| [`docs/arquitetura/sistema.md`](docs/arquitetura/sistema.md) | Módulos, seams, superfície de API |
| [`docs/adr/`](docs/adr/) | Decisões de arquitetura |
| [`docs/dividas.md`](docs/dividas.md) | Dívida carregada, cada uma com gatilho |
| [`docs/compliance/retencao.md`](docs/compliance/retencao.md) | Prazo e base legal de cada classe de dado pessoal |

## Mapa do repositório

| Caminho | O que é |
|---|---|
| `CLAUDE.md` | Regras inegociáveis, convenções e fluxo de trabalho |
| `CONTEXT.md` | Glossário do domínio e termos proibidos |
| `apps/api` | API (NestJS + Fastify, `pg`, BullMQ) e os workers |
| `apps/web` | Web (Next.js App Router) |
| `packages/domain` | Regras puras: Dinheiro, Quantidade, permissões, estoque |
| `packages/contracts` | Schemas Zod da API |
| `packages/ui` | Design system |
| `teste/` | Testes transversais (RLS, redação de valores, rotas protegidas) |
| `infra/` | Compose local, papéis do banco, produção |
| `docs/` | ADRs, specs, operação, compliance |
| `prototipo-rotinas-de-gestao.html` | Especificação funcional. Nunca entra em build |
| `versoes/v20-producao/` | Sistema anterior. **Não está no repositório** (ele é público). Fica no disco da equipe |
