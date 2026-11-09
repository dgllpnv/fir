# Correções da PO — plano de construção (ondas, donos, decisões)

Spec: `correcoes-po-2026-11-09.md`. Gates (leitura obrigatória para quem constrói o item):
`correcoes-po-gate-appsec.md` (S-…), `correcoes-po-gate-lgpd.md` (L-…),
`correcoes-po-gate-numeros.md` (N-…). **Toda condição marcada como bloqueio nos gates é
requisito do ticket.**

## Decisões tomadas pelo coordenador (seguindo a recomendação dos gates; dono avisado)

- **B1 / N-13, S-…:** a correção do orçamento **acrescenta** um evento `corrigirOrcamento` ao
  histórico; nunca reescreve o `registrarOrcamento` original e nunca cria um segundo
  `registrarOrcamento`. O funil não conta `corrigirOrcamento` como orçamento enviado.
- **B1 / N-14:** "R$ orçado" de uma janela usa o **valor vigente no fim da janela** (opção b):
  mês fechado nunca muda; o período em curso mostra o corrigido. Teste nomeado
  `orcamento-corrigido-depois-do-mes`.
- **B1:** quem corrige = tem `jornada` **e** pode editar a tarefa; linha travada `FOR UPDATE`;
  só em tarefa na etapa `orcamento`; N-17 (programa orçado) vale.
- **A3 / N-5:** trocar a campanha de uma tarefa já paga é permitido (como o protótipo); a
  troca entra na trilha.
- **A3 / N-6:** o índice `tarefa_viva_da_campanha` passa a incluir `tipo` (migration **0065**);
  e todo 23505 restante vira 409 legível sem dado da outra tarefa (L-A3-4).
- **A3 / N-4:** contrato de edição com três estados para `campanhaId` (ausente mantém, `null`
  remove, id troca); a lista vinculável inclui a campanha atual mesmo encerrada/excluída.
- **A3 / N-2:** uma única expressão de "receita por campanha" usada em
  `campanhas.service.ts`, na sincronização da carteira e em `conferencia.service.ts`, ou
  teste provando igualdade.
- **B2 / L-B2-2, S-…:** FK `ON DELETE SET NULL (indicado_por_id)`; `CHECK` sem autoindicação;
  com `indicado_por_id`, `indicado_por = ''` (CHECK). Nada de casar texto legado por nome.
- **B4:** não vira código nesta onda. Primeiro ADR + termo novo no glossário (o "setor" da
  carteira já existe) e nova passada de appsec e LGPD.

## Contrato combinado entre frentes

`GET /v1/campanhas/vinculaveis?contexto=tarefa|paciente[&incluir=<uuid>]` → `{ itens: [{ id,
nome }] }`. Exige só sessão de clínica (não a permissão `campanhas`). `tarefa`: em andamento
primeiro, depois encerradas há até 30 dias (`fim >= hoje − 30`); `paciente`: só ativas hoje
(`inicio <= hoje <= fim`). "Hoje" do servidor no fuso da clínica. A janela é **uma** função em
`packages/domain`, usada pela lista e pela validação na escrita. `incluir` acrescenta a
campanha atual (N-4). Dono: **Frente A3**. Consumidor: **Frente B2** (campo "Chegou por uma
campanha?" no cadastro do paciente).

## Frentes, donos de arquivo e migrations

| Frente | Itens | Arquivos (exclusivos, salvo nota) | Migration | Porta web |
|---|---|---|---|---|
| A1A2 | 1, 3, 4 | `cartao-de-tarefa.tsx`, `ficha-do-paciente.tsx`, `tela-jornada.tsx`, `tela-hoje.tsx`, `tela-tarefas.tsx`; em `contracts/pacientes.ts` e `api/pacientes/pacientes.service.ts` **só a ficha** | — | 4812 |
| A4 | 9 | `components/estoque/**`, `tela-estoque.tsx`, `contracts/estoque.ts`, `api/estoque/**`, dependência em `apps/web/package.json` | — | 4813 |
| B1 | 2 | `domain/jornada.ts`, `contracts/jornada.ts`, `api/jornada/**`, `components/jornada/faixa-da-jornada.tsx`, `lib/acoes-de-tarefa.ts` | 0063 (se precisar) | 4814 |
| A3A5 | 5, 10 | `contracts/tarefas.ts` (campanhaId), `contracts/recebimentos*`, `contracts/campanhas.ts`, `api/tarefas/**`, `api/financeiro/recebimentos.service.ts`, `api/campanhas/**`, `api/migracao/conferencia.service.ts` (só N-2), domínio da janela de campanha, `tela-nova-tarefa.tsx`, `painel-de-edicao.tsx`, `tela-recebimentos.tsx` | 0065 | 4815 |
| B2B3 | 6, 7 + campanha no cadastro do paciente | `contracts/pacientes.ts` e `api/pacientes/pacientes.service.ts` **só cadastro (criar/editar)**, `formulario-de-paciente.tsx`, `api/painel-geral/**`, `contracts/painel.ts`, `tela-painel.tsx`; em `ficha-do-paciente.tsx` **só a linha do "indicado por"** | 0062 | 4816 |
| B4 | 8 | só documentos: ADR nova em `docs/adr/`, `CONTEXT.md` (termo novo), seção B4 do spec | — | — |
| C1 | painel | `apps/web/next.config.mjs`, `apps/web/Dockerfile`, `superadmin/casco.tsx`, casco da carteira — **coordenador** | — | — |

Arquivos que mais de uma frente toca com uma linha (use **Edit** pontual e releia antes):
`app.module.ts`, `packages/*/src/index.ts`, a lista `CAMPOS_MONETARIOS`, `teste/registro.ts`,
`docs/compliance/retencao.md`, `apps/web/src/conteudo/manual.ts`/`ajuda.ts` (cada frente só nos
parágrafos do seu item).

## Regras de execução (todas as frentes)

- Branch `correcoes-po-2026-11-09`, raiz do repositório, sem worktree, **sem commit** (o
  coordenador integra e commita).
- Ambiente: Postgres/Redis locais (48xx), seed `demo`/`helena` (senha
  `quatro-pedras-no-caminho`, só local). API do coordenador em 127.0.0.1:4811 (tsx watch) e web
  em 4810 — **não pare**. Cada frente faz o próprio build/start do web na sua porta com
  `FIR_API_URL=http://127.0.0.1:4811`; nunca dois `next build` no mesmo `.next` ao mesmo tempo
  (use `distDir` próprio via variável, ou serialize). Cookie `__Host-` em HTTP local: injete.
- Rode **só os seus arquivos de teste** contra o Postgres local (a suíte inteira em paralelo
  esgota conexões); escopo os dados de teste aos seus (sem `count(*)` global).
- Verificação com saída colada: `pnpm db:migrate` (se houver migration), `pnpm typecheck`,
  testes próprios (domínio com fast-check onde houver aritmética; e2e contra Postgres real),
  **prova por mutação** das proteções dos gates, build do web, tela em 390 px e 1280 px, claro
  e escuro, `scrollWidth == innerWidth`, sem erro de console; dados de demonstração apagados.
- Relatório: o que mudou (arquivo:linha), cada S/L/N do seu item e como foi atendido (ou por
  que não), desvios do protótipo, o que ficou de fora, falhas que não são suas.
