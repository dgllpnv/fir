# A meta do mês é medida pelos dias de caixa fechado, a partir do primeiro caixa

**Status:** aceita, 2026-11-17. **Spec:** `docs/specs/indicadores-e-insights.md` (I-9, G1), números B1, B5 e B6, appsec C11. Ticket T2.

## Contexto

Até aqui, o percentual da meta da Visão do mês (e da rota que a equipe lê, `/v1/metas/:mes/percentual`) somava **todo** o recebido do mês, incluindo o de hoje com o caixa aberto. Isso traz dois problemas:

- O percentual sobe a cada Pix do dia. Quem vai contar a gaveta lê nele o total do dia, que é o esperado do caixa por outra porta (regra 6).
- O `faturamento_conferido` do KPI precisa ser **o mesmo número** da meta. Duas réguas dariam dois percentuais.

## Decisão

1. **O regime de cada dia** vem de `regimeDoDia(dia, clinicas.conferencia_desde, hoje)`:
   - **Antes de `conferencia_desde`** (ou sem ela) conta todo o recebido: a medida de sempre (G1).
   - **Dali em diante** só conta o dia com `caixas_do_dia`.
   - **Hoje sem caixa nunca conta**, nos dois regimes.
2. **`conferencia_desde` é o primeiro caixa fechado.** A 0100 o preenche com `min(caixas_do_dia.dia)`. O primeiro fechamento futuro o preenche **na mesma transação**, pela trigger `caixas_marcam_conferencia_desde`, que é `SECURITY DEFINER` e só toca a clínica do caixa. `fir_app` continua sem escrita em `clinicas`.
3. **Uma função para tudo:** `medirFaturamentoConferido`, em `financeiro/faturamento-conferido.ts`, mede a Visão do mês, a rota da equipe e o KPI. "Dia sem caixa" é `recorteDeCaixa`, a mesma função do Painel (`dias-sem-caixa-uma-funcao`): dia com recebimento na FIR **ou** faturamento lido do MedX, e sem caixa.
4. **A régua do MedX passa pelo mesmo corte** (B5). O medido é `somaDoMedx(lido, D)`. Ele vale `null` se algum dia de `D` não tem leitura.
5. **O que não conta, dos dias ANTERIORES a hoje, vira `aguardandoFechamento`** (o total de hoje com o caixa aberto é o esperado da gaveta e nunca sai — `transporte-as-cegas`), um total em centavos só, e `diasAguardandoFechamento`. O total está em `CAMPOS_MONETARIOS`, e a equipe o lê `null`. Em `/v1/indicadores*` o valor nunca sai. O contador não depende de haver pagamento hoje: senão o primeiro Pix mudaria 0 → 1.

## O que muda nas telas que existem

| Onde | Antes | Depois | Por quê |
|---|---|---|---|
| Meta, clínica **sem** caixa nenhum | recebido do mês inteiro | o mesmo, **menos o de hoje** | hoje sem caixa nunca conta |
| Meta, clínica **com** caixa | recebido do mês inteiro | dias anteriores ao 1º caixa + dias fechados depois dele | regime de conferência |
| Meta medida pelo MedX | MedX do mês inteiro (incluía hoje aberto) | MedX só dos dias que contam | B5 |

Não mudam: `recebido`, `porForma`, `resultadoDoMes`, despesas, `aReceber`.

## Asserções que mudaram por esta ADR

- **`visao-do-mes.e2e.test.ts`.** Os dois testes da meta com recebimento em 24/10 (hoje) passaram o recebimento para 23/10, porque o que mediam é a redação. O `toEqual` ganhou `aguardandoFechamento` e `diasAguardandoFechamento`.
- **`indicadores-do-medx.e2e.test.ts`:**
  - o medido do MedX vai de 32778 (66%) para 25001 (50%);
  - o da FIR vai de 57% para 46%;
  - a equipe lê 50%.
