# Firmare Rotinas de Gestão

Ferramenta multi-clínica que **instala os rituais de gestão na rotina da equipe** — confirmar consultas, recontatar quem faltou, retomar orçamentos, acompanhar sessões, contar o estoque, fechar o caixa, pagar contas no prazo, cobrar saldos, conduzir 1:1.

Ela **não** é o sistema da clínica (agenda, prontuário, faturamento). Roda **ao lado** dele, aberta o dia inteiro pela recepção.

Domínio: dinheiro de clínicas reais, estoque de medicamento controlado e **dado de saúde de pacientes reais**. **Um bug aqui não é um bug de UI — é a dose errada no frasco de alguém, ou o salário de uma funcionária na tela errada.**

> Leia este arquivo inteiro antes da primeira ação de qualquer sessão. As seções **Regras inegociáveis** e **Fluxo de trabalho** não são sugestões.

---

## 1. Onde estamos

**Em produção hoje:** v20, Google Apps Script sobre Google Sheets, **4 clínicas em uso real**. O código está em `versoes/v20-producao/` e é a fonte dos dados a migrar.

**A especificação:** `prototipo-rotinas-de-gestao.html` — protótipo funcional completo, escrito pela PO, rodando em modo demonstração. A função `demoApiBase` é a **referência de comportamento do servidor**: cada `case "acao"` é uma ação da API. A `AJUDA` e o `MANUAL` embutidos (14 capítulos) são a documentação funcional.

**O que estamos construindo:** o sistema robusto, com paridade com o protótipo, e a **migração das 4 clínicas** — essa é a entrega com prazo real.

**O que estes arquivos são, e não são:**

| Caminho | Papel |
|---|---|
| `versoes/v20-producao/` | **Referência e origem dos dados. Nunca entra em build.** O `Code.gs` é a definição operacional do que os dados significam hoje, e tem precedência sobre qualquer documento quando os dois discordarem |
| `prototipo-rotinas-de-gestao.html` | **Especificação funcional. Nunca entra em build.** Divergir dele é decisão de produto, e vira ADR |
| `DESENVOLVEDOR-gestao-de-rotina.md` | Documento de passagem da PO: propósito, perfis, modelo de dados, API, regras por módulo |
| `roteiro-implantacao-notas.md` | O que a implantação numa clínica exige, módulo a módulo |
| `versoes/v20-producao/GUIA-INSTALACAO.md` | Regras operacionais da v20, em detalhe |

---

## 2. ⛔ Regras inegociáveis

Violar qualquer uma destas é motivo para reprovar o código, mesmo que os testes passem.

### Dinheiro

1. **Nunca `float`, `double` ou `number` para valor monetário.** Sempre inteiro em centavos (`BIGINT` no Postgres, `bigint` em TS) encapsulado no value object `Dinheiro`. O legado está cheio de `Math.round(x * 100) / 100` — **essa assinatura não atravessa para cá.** Se você escreveu `toFixed`, `parseFloat` ou uma multiplicação por 100 perto de dinheiro, pare.
2. **Toda divisão de valor distribui o resto um centavo por parte, nas primeiras partes.** A soma das partes é **exatamente** o todo, e `max(partes) − min(partes) <= 1`. Prove com property-based test — e a propriedade da soma **não basta**: sem `max − min <= 1` a suíte não distingue esta regra de "todo o resto na primeira parte", e em 3 partes as duas dão resultado idêntico, que é justamente o caso com que todo mundo confere.
3. **Receita conta cada pagamento uma vez, e só uma.** O pagamento pode ficar embutido no atendimento (bloco "Houve pagamento?") **ou** ser um recebimento avulso. Nunca os dois para o mesmo dinheiro. É o erro clássico desta categoria: a receita do mês dobra e ninguém percebe até o fechamento.
4. **Orçamento não é receita.** `valorOrcamento` nunca entra em total recebido, em LTV nem em meta. Nota promissória não entra no caixa.
5. **Saldo em aberto é derivado** (`aberto − abatido`), **agrupado por adesão**, com um grupo geral para o que não é de programa. Nunca um campo mutável, nunca colapsado num total só — é o agrupamento que a cobrança usa.
6. **O esperado do caixa é calculado no servidor e não atravessa para o cliente antes do fechamento.** Conferência às cegas é invariante de **transporte**, não de tela: quem confere com o esperado à vista confirma o esperado, e a conferência deixa de medir qualquer coisa.
7. **Dinheiro na tela sai do formatador central de `packages/domain`.** Nunca `toFixed(2)` solto.

### Quantidade e estoque

Quantidade de estoque é **tão monetária quanto dinheiro**: vira custo, vira perda não explicada e vira dose aplicada em paciente. As regras têm o mesmo peso.

8. **Nunca ponto flutuante para quantidade.** Inteiro na menor unidade indivisível declarada do item. O legado faz `Math.round(x * 1000) / 1000`; não atravessa.
9. **As conversões vivem no cadastro do item, não no código.** `1 unidCompra = fatorCompra × medida` e `1 medida = fatorUso × unidUso`. Um número de conversão dentro de uma função é defeito mesmo quando o resultado está certo hoje. **Saldo é sempre em `medida`.**
10. **Somar quantidades de itens diferentes, ou de unidades diferentes sem conversão declarada, lança erro** — não converte em silêncio.
11. **Saldo de estoque é derivado**: última `Contagem` + entradas − saídas ± ajustes. Nunca um campo.
12. **Movimento de estoque é append-only.** Desfazer uma baixa é um movimento compensatório ligado à origem (`tarefaId`), nunca um `DELETE`. Reabrir uma sessão restaura exatamente o que foi baixado — mesma quantidade, mesmo lote.
13. **A diferença da análise é relatada, nunca corrigida.** `diferença = contagem final − saldo esperado`. Ajustá-la automaticamente destrói a única informação que justifica contar o estoque. Ajuste manual exige motivo e `estoque.gerir`.
14. **O esperado da contagem não atravessa para o cliente antes do fechamento** — mesma regra 6, e quem implementa só uma das duas implementou nenhuma.
15. **Lote por FIFO de validade.** Item que não aproveita sobra gera **dois** movimentos: consumo da dose e descarte da sobra ("Sobra de frasco aberto"), somando a unidade inteira. Nunca um arredondamento.

### Permissão e dado sensível

16. **`temPerm(usuario, perfis, chave)` é uma função só**, em `packages/domain`, usada por servidor e tela. **O servidor sempre valida** — a tela é conveniência. Dependências entre chaves (`finmes` → `valores`, `painel` → `valores`) vivem na tabela, não em `if` espalhado.
17. **A redação de valores mora num ponto único.** Sem a permissão `valores`, o servidor **apaga** os campos monetários da resposta (`valor`, `valorAberto`, `valorOrcamento`, custos, metas, salário); a equipe recebe só `comSaldo` e, na meta do mês, o percentual. Isso atravessa toda saída, nunca é um `if` por endpoint — o endpoint número quarenta não será revisado com o cuidado do primeiro.
18. **Dose, produto, lote e aplicação por paciente são dado pessoal sensível de saúde** (LGPD art. 11). Base legal própria, acesso por perfil, **registro de acesso — não só de escrita** — e nunca em log.
19. **Row-Level Security no Postgres, obrigatória.** Toda tabela de negócio tem `clinica_id NOT NULL`. O filtro na aplicação é a segunda camada, nunca a única.
20. **Soft delete e trilha de auditoria append-only** em toda escrita financeira, de estoque e de RH: quem, quando, de → para. Desativar clínica ou pessoa é um estado, nunca uma exclusão.
21. **PII, valor e dado clínico mascarados em log.** Log de produção não contém nome de paciente, telefone, valor, salário nem dose.

### Tempo

22. **UTC no banco, fuso da clínica na tela.** O legado fixou `America/Bahia` num `const`; isso quebra na primeira clínica de outro estado. **O fuso é propriedade da clínica.**
23. **Toda janela de período é semiaberta `[início, fim)`**, em instantes UTC, com as bordas calculadas no fuso da clínica antes da comparação. Uma convenção só, em todo o sistema.
24. **Data de negócio nunca vem do relógio do cliente.** O servidor é a autoridade.
25. **Recorrência mensal em dia 29, 30 ou 31 cai no último dia do mês curto.** É a regra da v20, as clínicas dependem dela, e ela é testada.

### Ingestão e migração

26. **Toda ingestão externa é idempotente.** Chave explícita: chave de acesso da NF-e, `(clinica_id, provider, uid_externo)` para agenda, nome ou telefone para importação de lista. Reimportar o mesmo arquivo três vezes não cria nada novo — e é assim que se testa.
27. **Conciliação sugere, nunca sobrescreve.** Nada do usuário é apagado automaticamente, e **nunca se recria o que ele apagou**. Um compromisso que sumiu da agenda vira proposta de recontato, não cancelamento.
28. **Migração sem conferência não é migração, é cópia.** Os totais batem **exatamente**, por clínica: quantidade de registros, receita total, LTV por paciente, saldo por paciente, saldo por adesão, receita por campanha. Um único paciente divergente reprova a clínica inteira.

---

## 3. O time

15 especialistas em `.claude/agents/`. Responsabilidade, gatilho e poder de veto de cada um em **`docs/team.md`**.

| Fase | Agentes | Aciona quando |
|---|---|---|
| **Domínio** | `product-rotina-clinica`, `arquiteto-dominio`, `especialista-estoque-rastreabilidade` | Antes de existir qualquer código |
| **Arquitetura** | `arquiteto-solucao` | Antes do spec virar ticket |
| **Risco** | `especialista-seguranca-appsec`, `especialista-lgpd-saude`, `validador-numeros` | **No spec**, antes do código |
| **Construção** | `engenheiro-backend`, `engenheiro-frontend-web`, `engenheiro-migracao`, `engenheiro-integracoes` | Só com spec e tickets aprovados |
| **Qualidade** | `engenheiro-qa-automacao`, `validador-numeros`, `revisor-codigo` | QA durante; validador e revisor ao fim |
| **Operação** | `sre-devops-vps` | Migration, deploy, incidente |
| **Futuro** | `especialista-contas-assinatura` | Painel interno, onboarding, planos |

**O gate que define este projeto:** segurança, LGPD e validação de números revisam o **spec**, não o pull request. Descobrir "esse fluxo entrega o salário para a recepção" depois de implementado custa dez vezes mais.

---

## 4. Fluxo de trabalho

Pipeline completa em **`docs/pipeline.md`**. O ciclo curto:

```
/grill-me → /to-spec → 🚦 gate de risco → /to-tickets → /tdd → /implement
         → /code-review → validador-numeros → deploy
```

**Regras de processo:**

- **Nunca escreva código sem spec e tickets.** Se pedirem uma feature direto, invoque `/grill-me` primeiro. "É simples" é exatamente quando isso falha.
- **O protótipo tem autoridade.** Antes de "corrigir" um comportamento, confira o que `demoApiBase` faz. Divergir é decisão de produto do `product-rotina-clinica`, e vira ADR.
- **Trabalho acontece na raiz do repositório, em branch.** Nada de git worktree isolado — é a decisão que valeu no Mavia e vale aqui: com o trabalho em `.claude/worktrees/`, o dono não enxerga o que mudou no repositório que tem aberto, e o merge deixa de ser possível de dentro dela. Se a sessão nascer numa worktree, saia (`ExitWorktree`, preservando o que houver).
- **Trabalho paralelo na mesma árvore exige propriedade de arquivo declarada.** Dois agentes editando o mesmo arquivo perdem o trabalho um do outro. Diga a cada um quais arquivos são dele, e não meça enquanto outro escreve.
- **TDD apenas em seams acordados.** Antes de escrever teste, declare o seam e confirme. Não testamos tudo — testamos o caminho crítico e a lógica complexa.
- **Nunca afirme "pronto" sem evidência.** Use `superpowers:verification-before-completion`: rode o comando, cole a saída. Teste que não foi executado não passou.
- **Toda decisão não-óbvia vira ADR** em `docs/adr/`. Use `/domain-modeling`.
- **Vocabulário vem de `CONTEXT.md`.** Nome no código = nome no glossário = nome na UI. Precisa de um termo novo? Adicione ao glossário primeiro.
- **Ao fim de sessão longa**, rode `/handoff` antes de perder contexto.

---

## 5. Arquitetura-alvo

Monorepo TypeScript (Turborepo + pnpm), espelhando o padrão provado no Mavia. Uma linguagem do banco ao app.

```
apps/
  api/        NestJS + Fastify · PostgreSQL · Drizzle ORM · BullMQ/Redis
  web/        Next.js (App Router) · React · TanStack Query · Tailwind
packages/
  domain/     Regras PURAS: Dinheiro, Quantidade, jornada, estoque, permissões.
              Zero I/O, zero framework. O coração.
  contracts/  Schemas Zod → tipos + OpenAPI. Fonte única de verdade da API.
  ui/         Design system (tokens + primitivos)
infra/        docker-compose local · producao (Traefik/EasyPanel) · backup
docs/         ADRs, pipeline, time, specs, arquitetura, compliance
```

**Regra de dependência:** `domain` não importa nada. `contracts` importa `domain`. `api` e `web` importam ambos. Nunca o inverso. Nunca app → app.

**A herança que esta arquitetura paga:** o legado tem a mesma regra escrita três vezes — front, `demoApiBase` e `Code.gs` — e elas já divergiram. Aqui cada regra existe **uma vez**, em `packages/domain`, e **o front não calcula nada que o servidor também calcule**. Formatar é do front; calcular não é.

**Seams declarados** (mantenha a lista curta, em `docs/arquitetura/sistema.md`): HTTP da API · `packages/domain` puro · repositórios sobre Postgres real · `AgendaProvider` · `LeitorDeNota` · `Migrador`.

---

## 6. Convenções de código

- **TypeScript estrito.** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. `any` é proibido — use `unknown` e estreite. `as` só com comentário justificando.
- **Módulos profundos** (`/codebase-design`): muito comportamento atrás de uma interface pequena. Se a interface é quase tão complexa quanto a implementação, o módulo está raso.
- **Erros são valores no domínio, exceções na borda.** `packages/domain` retorna `Result<T, ErroDeDominio>`; a camada HTTP traduz para status code.
- **Validação na borda com Zod**, de `packages/contracts`. Nada entra no domínio sem parse.
- **Nomes em português para conceitos de domínio** (`Tarefa`, `Jornada`, `Programa`, `Contagem`, `Recebimento`), inglês para infraestrutura (`Repository`, `Handler`). Consistência vale mais que a escolha.
- **Migrations forward-only**, expand/contract. Nunca edite uma migration já aplicada.
- **Sem comentário que descreve o óbvio.** Comente o *porquê*, sobretudo regra de negócio clínica ou financeira não-óbvia.

### Interface

Antes de desenhar qualquer tela, leia **`docs/design.md`**. Resumo: a usuária é **a recepcionista com o telefone tocando**; 390 px é o caso principal e nenhuma tela rola na horizontal; campo raro fica recolhido; explicação longa vira ícone de dica. Identidade "papel e dourado" herdada do protótipo (off-white `#F9F7F2`, dourado `#C5A467`/`#86672E`, marrom `#2E1F0E`, Lora + Inter), tema escuro como par de primeira classe. **Proibido:** roxo/índigo, gradiente decorativo, glassmorphism, emoji na interface, toda informação dentro de card. **Algarismos tabulares em toda coluna de valor ou quantidade.** UI nova nasce de três direções diferentes via `/prototype` — o humano escolhe.

---

## 7. Testes

| Nível | Ferramenta | O que cobre |
|---|---|---|
| Domínio | Vitest + fast-check (property-based) | `Dinheiro`, `Quantidade`, conversão de unidade, saldo, análise de estoque, jornada, `temPerm` |
| Integração | Vitest + Testcontainers (Postgres real) | RLS, idempotência, transação, append-only |
| Contrato | Schemas de `packages/contracts` | API ↔ web não divergem |
| E2E | Playwright | Os fluxos do balcão, ponta a ponta |

**Property-based é obrigatório onde há aritmética** — de dinheiro e de quantidade. Exemplo escolhido a dedo não prova invariante.

**Testes contra Postgres real, não mock.** RLS não se mocka: um mock que filtra por clínica prova que você escreveu um filtro, não que o banco recusa a consulta que esqueceu de filtrar.

Os testes que este produto não pode não ter estão em `.claude/agents/engenheiro-qa-automacao.md`: transporte às cegas, redação de valores por rota, isolamento de clínica, receita que não dobra, datas que doem, idempotência três vezes.

---

## 8. Comandos e ambiente

```bat
fir               :: sobe Postgres, Redis e Mailpit locais e espera ficar saudável
fir infra         :: só os containers (para os testes)
fir down          :: derruba, preservando os dados
fir reset         :: zera o banco local
fir status        :: estado dos serviços
fir logs          :: logs em tempo real
fir psql          :: shell psql no banco local
```

**Bloco de portas 48xx**, e ele não se negocia caso a caso: Postgres 4832, Redis 4879, API 4811, web 4810, Mailpit 4825 (tela) e 4826 (SMTP).

Três razões para o bloco: **80 e 8080 estão fora** por decisão do dono; **5432 e 6379 também**, porque um Postgres já instalado na máquina faria o cliente conectar no banco errado sem avisar; e **47xx é do Mavia**, que roda na mesma máquina de desenvolvimento.

Tudo publicado em `127.0.0.1`, nunca em `0.0.0.0` — sem o prefixo, o Docker abre o banco para a rede do escritório inteira. Containers em **UTC**, com `TZ` e `PGTZ` fixados.

```bash
pnpm dev            # sobe api + web
pnpm test           # suíte completa
pnpm test:domain    # só domínio, rápido, roda o tempo todo
pnpm typecheck      # obrigatório antes de qualquer commit
pnpm lint
pnpm db:migrate
pnpm db:seed
```

Antes de dizer que algo está pronto: `pnpm typecheck && pnpm test`. Sem exceção.

**Produção:** mesma VPS do Mavia, **ao lado e nunca dentro** da orquestração do EasyPanel — containers comuns descobertos pelo Traefik por label, Postgres próprio, rede de dados sem rota de saída, só o `web` encarando a internet. Detalhe em `.claude/agents/sre-devops-vps.md` e no padrão de `infra/producao/` do Mavia.

---

## 9. Skills e quando usar

Pacotes `mattpocock-skills`, `superpowers` e `claude-security` instalados.

| Situação | Skill |
|---|---|
| Ideia vaga, decisões em aberto | `/grill-me` · `/grill-with-docs` (gera ADR junto) |
| Trabalho grande demais para uma sessão | `/wayfinder` |
| Conversa madura → PRD | `/to-spec` |
| PRD → fatias verticais | `/to-tickets` |
| Modelar entidade, cunhar termo, registrar decisão | `/domain-modeling` |
| Decidir onde vai o seam, aprofundar módulo | `/codebase-design` |
| Escrever a feature | `/tdd` → `/implement` |
| Revisar o que foi feito | `/code-review` |
| Código tocou auth, dado de paciente ou valor | `claude-security:scan` |
| Bug difícil, regressão, lentidão | `/diagnosing-bugs` |
| Dúvida de UX ou de máquina de estados | `/prototype` |
| Precisa de spec de GS1, NF-e, iCal ou API de WhatsApp | `/research` |
| Issue nova chegando | `/triage` |
| Dívida arquitetural acumulando | `/improve-codebase-architecture` |
| Fim de sessão | `/handoff` |

---

## 10. Documentos vivos

| Arquivo | Papel |
|---|---|
| `CONTEXT.md` | Glossário do domínio, a linguagem ubíqua, termos proibidos. Leia antes de nomear qualquer coisa |
| `docs/team.md` | Os 15 agentes: responsabilidade, gatilho, poder de veto |
| `docs/pipeline.md` | A pipeline completa, fase a fase |
| `docs/decisoes.md` | As escolhas do dono do produto, com data, e o que ainda depende dele |
| `docs/roadmap.md` | O que falta, em ordem, e o que fica pronto em cada etapa |
| `docs/adr/` | Decisões arquiteturais. Não re-litigue uma ADR aceita — proponha uma nova que a substitua |
| `docs/design.md` | Direção de design. **Obrigatório antes de qualquer tela** |
| `docs/arquitetura/sistema.md` | Módulos, seams, modelo de dados, superfície de API, jobs |
| `docs/compliance/retencao.md` | Cada classe de dado pessoal com prazo, base legal e ação |
