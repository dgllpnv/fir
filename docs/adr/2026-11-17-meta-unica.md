# A meta do mês mora em `metas_de_kpi`: um lugar só para meta

**Status:** aceita, 2026-11-17. **Spec:** `docs/specs/indicadores-e-insights.md` (I-24 a I-26), ticket T2. **Migration:** `0100_metas_do_mes_para_indicadores.sql`.

## Contexto

A Visão do mês tinha a sua tabela de meta (`metas_do_mes`, 0009 e 0096). Indicadores & Insights traz metas para qualquer KPI, inclusive o `faturamento_conferido`, que é a mesma meta de faturamento. Com duas tabelas, a clínica teria duas metas do mesmo número, e as duas telas poderiam discordar.

## Decisão

1. **A meta de faturamento do mês é a meta viva do KPI `faturamento_conferido`** com `parametros = '{}'`, sem KR, que começa no dia 1º (`mes` ou `recorrente`). A leitura e a escrita passam por `apps/api/src/metas/metas.repositorio.ts`, e nada mais lê a tabela antiga.
2. **A 0100 copia `metas_do_mes` linha a linha**, com `origem_migracao` `UNIQUE`. A conferência (`conferir_migracao_de_metas_do_mes()`) usa `EXCEPT ALL` nos dois sentidos sobre `(clinica_id, competencia, valor, medida_por, definida_por, definida_em)`, mais quantidade e soma por clínica. Se divergir, `RAISE` e a migration inteira volta. É uma função, e não um `DO` solto, para o teste `migracao-0100-meses-trocados-aborta` chamar a mesma regra que rodou.
3. **`metas_do_mes` congela.** Há `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` para `fir_app`, e o caminho antigo falha alto (`metas-do-mes-put-antigo-falha`). O `DROP` fica para uma migration futura (*contract*).
4. **`PUT /v1/metas/:mes` continua igual para a tela**, idempotente. **O zero agora ARQUIVA** em vez de apagar. Mês dentro de uma meta `ate_data` dá `409` com o nome e o prazo dela ("edite-a em Indicadores"), nunca o `500` do `EXCLUDE`.
5. O `definida_por` só atravessa se for pessoa da **mesma** clínica. Fora disso fica `NULL`, e a conferência projeta a mesma regra (appsec C25).

## Rejeitado

- **View com `INSTEAD OF`.** Daria duas escritas do mesmo fato, e o *contract* nunca chegaria.
- **Deixar `metas_do_mes` como o armazém da meta de faturamento.** São duas tabelas de meta, e a primeira divergência ninguém vê.

## Consequências

- A asserção que contava linhas em `metas_do_mes` passa a contar `metas_de_kpi` (`visao-do-mes.e2e.test.ts`, "PUT é idempotente").
- A limpeza de teste de financeiro passou a limpar as tabelas de Indicadores (`limparIndicadores`).
