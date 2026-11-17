# Revisão AppSec / LGPD — Indicadores T3 (lançamentos) e T4 (OKRs)

**Revisor:** especialista-seguranca-appsec · **Data:** 2026-11-17 · **Commit:** `01eafb1` (branch `backlog-final-indicadores-e-acesso`)
**Gate:** `indicadores-e-insights-gate-appsec.md`, condições C1–C6, C27, C29, C30 e LGPD R-e. Esta revisão substitui o `claude-security:scan` da C30 para T3/T4.

## Veredito: **REPROVADO** (1 bloqueador)

O desenho da exceção `podeLancar`, o marcador, a C5, a C6 e a trigger diferida estão certos e medidos. O que reprova é dinheiro em reais saindo pela trilha de auditoria. Isso foi reproduzido contra Postgres real.

## Bloqueador

### B1. O valor lançado em reais e o alvo/partida do KR em reais atravessam `GET /v1/auditoria` para quem tem `config` sem `valores` (regra 17, C2/C3, veto)

- `packages/domain/src/permissoes.ts:152-475`: `CAMPOS_MONETARIOS` não tem `valorCentavos`, `alvoCentavos` nem `partidaCentavos`.
- `apps/api/src/comum/redacao.interceptor.ts:57-72`: a trilha devolve `to_jsonb(NEW)` em snake_case. O interceptor converte para camelCase e só depois compara com a lista, então `valor_centavos` vira `valorCentavos` e passa inteiro.
- Quem grava a coluna:
  - `apps/api/src/indicadores/lancamentos.service.ts:132-143` (`lancamentos_de_kpi.valor_centavos`, T3);
  - `apps/api/src/indicadores/okrs.service.ts:419-426` e `:441-448` (`metas_de_kpi.alvo_centavos` e `partida_centavos`, T4);
  - as triggers de `apps/api/migrations/0098_indicadores.sql:326-364`.
- **Reprodução:** sonda e2e temporária, apagada depois da medição. O perfil `pf_rec` recebeu `indicadores` + `indicadores.gerir` + `config`, sem `valores`. A responsável lança `150043` num KPI manual em reais, e a gestão cria um KR em reais com alvo `990077`. As rotas de indicadores redigem os dois valores (conferido). Já `GET /v1/auditoria?entidade=lancamentos_de_kpi` devolve `"para":{…,"valor_centavos":150043}`, e `?entidade=metas_de_kpi` contém `990077`. Os dois com status 200.
- **A mesma classe, fora do diff:** `fotografias_de_kpi.valor_centavos` (job do T1/T2) e as metas de saúde em reais do T1 também caem na trilha. Uma correção fecha as três.
- **O que se exige (sem implementar aqui):**
  1. registrar `valorCentavos`, `alvoCentavos` e `partidaCentavos` em `CAMPOS_MONETARIOS`, no ponto único;
  2. criar um teste de varredura que lê do catálogo do Postgres toda coluna `*_centavos` de tabela com trigger `registrar_auditoria` e exige o nome camelCase na lista, para que a próxima coluna não dependa de revisão;
  3. criar um e2e com mutação: sem `valores`, a trilha sai `null`; com `valores`, o número aparece.

## Condições verificadas na fonte

| Cond. | Estado | Evidência |
|---|---|---|
| C1 | OK | `lancamentos.service.ts:91-115`: o KPI é lido `FOR UPDATE` na transação que grava, e o ator e os perfis são relidos (`lerAtorDeAcesso`). Troca de responsável: o `UPDATE kpis` de `editarKpi` segura a linha, e o `SELECT … FOR UPDATE` do PUT relê a versão nova (READ COMMITTED). Não há janela em que a antiga lança depois da troca. Outra clínica dá 404, catálogo 422, arquivado 409. e2e verdes. |
| C2 | OK, com B1 | O PUT devolve só `LancamentoDeKpiNaSaida`, e `anterior`/`lancado` em reais saem redigidos (e2e com mutação). Nenhum GET usa `podeLancar`. A tarefa leva só `{id,nome}` e o `lancamentoDeKpi` da D.4. O vazamento por fora é o B1. |
| C3 | OK | `exigirEscritaNaUnidade` em criar/editar/duplicar KR (`okrs.service.ts:261,361,507`). Trocar para `reais` também exige `valores` (`indicadores.service.ts exigirTrocaDeUnidade`). |
| C4 | OK | `EXCECOES_DE_ACESSO` cobrado nos dois sentidos em `teste/rotas-protegidas.test.ts`. Todas as rotas de OKR têm `@Exige`. |
| C5 | OK | O OKR sai só por `kpisVisiveis`. KR invisível não entra em `progresso`/`situacao` e não é editado nem duplicado. |
| C6 | OK | OKR, KPI e KR de outro OKR dão 404, e o responsável de outra clínica dá 422 (FK composta). O destino da tarefa reatribuída é relido sob RLS. |
| C27 | OK | O marcador só nasce em `lancamentos-tarefas.ts`. `POST /v1/tarefas` dá 422 antes do parse, e `CriarTarefa` é `.strict()` sem `marcador`. Nenhuma rota de import ou série escreve `marcador`, `kpi_id` nem `kpi_referencia`. PATCH, transferir, cancelar, excluir e concluir pela rota genérica passam por `tarefa-de-lancamento.ts`. |
| C29 / R-e | OK no servidor | Nenhum log novo com texto livre. O único `console.warn` leva id e chave. As mensagens de erro são fixas, e a trigger 0102 leva só a contagem. **Pendente na web:** o aviso fixo `AVISO_DE_TEXTO_LIVRE_DO_KPI` não é usado em nenhum lugar ainda. Ele precisa aparecer no campo de comentário, "como medir", objetivo e porquê quando a tela T3/T4 nascer. |
| Trigger diferida | OK | A 0102 trava a linha do OKR antes de contar. `editar` já faz `FOR UPDATE` do OKR, então duas edições concorrentes se serializam. `SET CONSTRAINTS … IMMEDIATE` traduz o erro para 422. |

## Achados menores (não bloqueiam, entram em `docs/dividas.md`)

- **M1. Oráculo de estado no PUT.** `podeLancar` responde catálogo (422) e arquivado (409) **antes** de conferir a pessoa (`packages/domain/src/permissoes.ts:138-142`). Qualquer pessoa autenticada da clínica, sem `indicadores`, descobre se um uuid é KPI de catálogo ou arquivado (medido: 422). O impacto é baixo, porque não sai valor e o id só vaza por `tarefa.kpi`. A correção é decidir 403 primeiro quando a pessoa não é a responsável nem tem `indicadores.gerir`.
- **M2. KRs invisíveis deixam um rastro.** Para quem não vê KPI de RH, o 422 "de 1 a 5" ou o 409 do `EXCLUDE` ao editar revela que existe KR oculto. Não sai valor nenhum. Aceitável.
- **M3. KRs invisíveis sem validação de período.** A edição move período e responsável dos KRs invisíveis (`okrs.service.ts:208-214`) sem `validarMeta`. É assunto do validador de números, não de acesso.

## Testes executados

- `pnpm --filter @fir/api exec vitest run src/indicadores/lancamentos.e2e.test.ts src/indicadores/okrs.e2e.test.ts`: 32/32 verdes.
- Sonda B1 (temporária, removida): falhou como esperado, com `valor_centavos":150043` e `990077` na trilha.
