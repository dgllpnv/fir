# Prompt para o primeiro Claude no PC novo

> Copie **todo o bloco abaixo** e mande como a primeira mensagem, já dentro da pasta
> do projeto clonado. Este arquivo não é lido por ninguém automaticamente — ele só
> guarda o texto.

---

Você vai continuar o desenvolvimento do **FIR — Rotina de Gestão** nesta máquina. O repositório acabou de ser clonado de `https://github.com/dgllpnv/fir`. **Não escreva código nenhum nesta sessão** — ela é só de preparação, e termina com um relatório para eu aprovar.

Trabalhe em português. Eu sou o dono do produto.

## 0 · Antes de qualquer coisa

Leia o `CLAUDE.md` **inteiro**. Ele é a instrução do projeto e tem precedência sobre o seu padrão: regras inegociáveis de dinheiro, estoque, permissão, LGPD e tempo; o time de 15 agentes; a pipeline; as convenções. Depois leia o `CONTEXT.md` (glossário — nome no código = nome na UI = nome no glossário).

Não resuma esses dois para mim. Eu os escrevi.

## 1 · Instalar os plugins de skills

Eles **não vêm no repositório** — são do nível do usuário. Confira o que já existe e instale o que faltar:

```bash
claude plugin marketplace list
claude plugin list
```

Os dois mercados e os plugins que este projeto usa:

```bash
claude plugin marketplace add obra/superpowers-marketplace
claude plugin marketplace add anthropics/claude-plugins-official

claude plugin install superpowers@superpowers-marketplace
claude plugin install elements-of-style@superpowers-marketplace
claude plugin install mattpocock-skills@claude-plugins-official
claude plugin install claude-security@claude-plugins-official
```

Estes quatro são os que o `CLAUDE.md` cita por nome. Se algum comando de instalação falhar, **não improvise**: me diga qual falhou e com que erro, porque `/plugin` é interativo e eu resolvo na hora.

**O `mattpocock-skills` é o do Matt Pocock** — é dele que vêm `grill-me`, `grilling`, `to-spec`, `to-tickets`, `tdd`, `implement`, `code-review`, `diagnosing-bugs`, `domain-modeling`, `codebase-design`, `prototype`, `research`, `wayfinder`, `handoff`, `triage`, `improve-codebase-architecture`, `pr` e `wizard`. O `CLAUDE.md` §9 diz qual usar em cada situação; confira se **todos** os que ele cita aparecem na sua lista de skills e me avise se faltar algum.

Do `superpowers` eu uso principalmente `brainstorming`, `writing-plans`, `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `requesting-code-review` e `verification-before-completion`.

**Uma ressalva que já custou caro aqui:** as skills do `superpowers` empurram `using-git-worktrees`. **Este projeto proíbe worktree** — o trabalho acontece na raiz do repositório, numa branch. Está escrito no `CLAUDE.md` §4, com o motivo: com o trabalho em `.claude/worktrees/`, eu não enxergo o que mudou no repositório que tenho aberto, e o merge deixa de ser possível de dentro dela. Se uma skill mandar criar worktree, **a instrução do projeto vence**.

## 2 · Conferir que o repositório veio completo

Sem instalar nada, verifique:

- A branch é `fundacao` (a `main` está alinhada com ela). O trabalho acontece em `fundacao`.
- **Os 15 agentes estão versionados** em `.claude/agents/` — não há nada a instalar aí. Confira que são 15 arquivos e que `docs/team.md` descreve cada um (responsabilidade, gatilho, poder de veto).
- Os documentos vivos existem: `docs/fila.md`, `docs/paridade.md`, `docs/decisoes.md`, `docs/dividas.md`, `docs/o-que-depende-de-voce.md`, `docs/design.md`, `docs/arquitetura/sistema.md`, `docs/compliance/retencao.md`, `docs/adr/` (10 ADRs) e `docs/superpowers/plans/` (9 planos).
- O `prototipo-rotinas-de-gestao.html` está lá. **Ele é a especificação, e é funcional** — roda em modo demonstração. Nunca entra em build.

## 3 · O que NÃO vem no repositório, e eu preciso te dar

O repositório é **público**. Quatro coisas ficaram de fora de propósito, e você vai esbarrar nelas:

| O que falta | Por que | O que fazer |
|---|---|---|
| `versoes/v20-producao/` | é o código rodando em 4 clínicas reais | **me peça.** É a referência do que os dados significam hoje, e o `Code.gs` tem precedência sobre qualquer documento quando os dois discordam |
| `docs/Planilhas/` | planilhas com nome, telefone, procedimento e valor de **pacientes reais** | **me peça** quando precisar mexer em migração |
| `docs/seguranca-v20-local.md` | descreve as fraquezas da v20 em uso | me peça |
| `.claude/settings.local.json` e `infra/producao/.env` | permissões locais e segredos de produção | o `.env` **só existe na VPS**, e é lá que ele nasce. Não tente recriá-lo |

**Não tente deployar nem acessar a VPS nesta máquina** sem eu liberar o SSH explicitamente. O deploy roda **na VPS**, por `infra/producao/implantar.sh`, que constrói as imagens e confere o selo do commit — veja `infra/producao/README.md`.

## 4 · Ambiente local

Exigências: **Node ≥ 22**, **pnpm 11.25.0** (está em `packageManager`, use `corepack`), **Docker Desktop** rodando.

```bash
pnpm install
fir infra          # Postgres, Redis e Mailpit locais, e espera ficarem saudáveis
pnpm db:migrate
```

O `fir.bat` está na raiz. **Bloco de portas 48xx**, e ele não se negocia: Postgres 4832, Redis 4879, API 4811, web 4810, Mailpit 4825/4826. As razões estão no `CLAUDE.md` §8 — resumidamente, 5432 faria o cliente conectar num Postgres já instalado na máquina sem avisar, e 47xx é do Mavia.

## 5 · O portão de verificação

Rode, nesta ordem, e **cole a saída de cada um**:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

**Os quatro, sem exceção.** O `build` está na lista porque a falta dele custou um deploy: a suíte passou verde, o `typecheck` limpo, e o `next build` quebrou na VPS — `useSearchParams()` numa página sem `Suspense` é erro de pré-renderização, e nada antes do build o vê.

**Hoje são 2.484 testes passando**, divididos assim: `domain` 580, `ui` 55, `contracts` 121, `web` 249, `teste` 256, `api` 1.223. Se der um número menor, **pare e me diga** — não siga adiante.

Os testes da `api` e do pacote `teste` sobem **Postgres de verdade** (Testcontainers / o container local). Eles não passam sem o passo 4.

## 6 · Ler, nesta ordem, antes de propor qualquer trabalho

1. `docs/fila.md` — o que falta, por prioridade, ordenado pelo caminho mais curto até as clínicas migradas. **Comece por aqui.**
2. `docs/decisoes.md` — as minhas decisões, com data (hoje vão até **D-18**). **Não re-litigue nenhuma.**
3. `docs/o-que-depende-de-voce.md` — o que trava e depende de mim.
4. `docs/paridade.md` — as 59 ações do protótipo, com estado. É o que "paridade" significa.
5. `docs/dividas.md` — dívida carregada, cada uma com o gatilho que a torna urgente.

## 7 · Como trabalhamos — as cinco regras que mais importam

1. **O protótipo é o desempate, e perguntar a mim é o último recurso.** Na prática: (1) abra e teste no protótipo; (2) se ele não cobrir o caso, veja o `Code.gs` da v20 — dado real foi gravado por ele; (3) só então pergunte, e pergunte com as opções e uma recomendação.
2. **Confira na fonte, não no relatório de outro agente.** Isso já custou caro aqui: um relatório afirmou que o protótipo aceita entrada zero num programa, a decisão veio a mim sobre essa premissa, e a medição posterior mostrou que ele **exige** valor.
3. **Nunca diga "pronto" sem evidência.** Rode o comando, cole a saída. Teste que não foi executado não passou.
4. **Invariante sem prova por mutação não está provada.** O padrão aqui é: quebre a regra de propósito, mostre o teste ficando vermelho, restaure. Teste que sobrevive à mutação é teste ruim — reescreva o teste, não o código.
5. **Nada de código sem spec e tickets.** Se eu pedir uma feature direto, invoque `/grill-me` primeiro. "É simples" é exatamente quando isso falha. E o gate de risco (segurança, LGPD, validador de números) revisa o **spec**, não o pull request.

## 8 · O que eu quero no fim desta sessão

Um relatório curto com:

- o que já estava pronto no clone e o que você instalou;
- a saída dos quatro comandos de verificação, com os números de teste;
- qualquer coisa que faltou ou falhou, **nomeada** — sem "deve funcionar";
- o que você entendeu que é o próximo trabalho, lido de `docs/fila.md`, em uma ou duas frases.

Depois **pare e espere**. Eu digo o que fazer em seguida.
