# Filtro Unidade nos Indicadores: só `porUnidade` se divide; os outros avisam

**Status:** aceita · 2026-11-17

## Contexto

O backlog 1.9 B põe na linha de filtros "Unidade (só se a clínica tiver mais de uma)". Aqui unidade é o endereço da clínica (`unidades`), não a unidade de medida. O catálogo marca `porUnidade` só em `novos_pacientes`. As outras 19 chaves (faturamento conferido, caixas, estoque, RH…) e os KPIs manuais não têm unidade no modelo: o KPI manual tem uma coluna `unidade`, mas ela é a unidade de medida. Elas não se dividem sem uma regra nova de atribuição.

## Decisão

- `GET /v1/indicadores?unidade=<uuid>`. Uma unidade de outra clínica dá 422.
- `novos_pacientes` conta pela unidade **principal** da paciente (`pacientes.unidade_id`), a mesma régua do Painel por unidade. A contagem sai da mesma fonte (`contarNovosPacientes`) e da mesma `CalculadoraDeKpi`.
- Os outros KPIs **não somem**. Eles saem com o número da clínica inteira e `naoSeDividePorUnidade: true`, e o cartão mostra "Não se divide por unidade". Esconder faria a reunião perder a saúde da clínica ao trocar o filtro.
- A meta é da clínica. Com o filtro, `metaVigente` sai igual, e o número da unidade sai sem `percentualDaMeta`, porque o alvo não é dele.
- Sem migration.

## Consequências

Dividir outra chave por unidade é decidir, chave a chave, de onde vem a unidade (da tarefa, da paciente ou do caixa) e marcar `porUnidade` no catálogo. A fonte passa a ler `ctx.unidadeId`.
