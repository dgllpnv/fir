# "Caixas sem diferença": o mesmo conjunto de dias em cima e embaixo, e toda forma igual

**Status:** aceita, 2026-11-17. **Spec:** `docs/specs/indicadores-e-insights.md` (I-15, G2), números B3. Ticket T2.

## Contexto

O bloco de caixa da Visão do mês tinha dois defeitos, que o KPI `caixas_sem_diferenca` teria herdado:

- **Passava de 100%.** `fechados` contava todo caixa do mês, inclusive o de sábado, e o denominador era `diasUteis` (de segunda a sexta). Com os caixas de segunda a sábado fechados, a conta dava 6 de 5.
- **Contava errado como certo.** "Com diferença" era a **soma** de `contado − esperado` do caixa. Pix +R$ 50 com Dinheiro −R$ 50 dava zero, e o caixa contava como certo. O `CONTEXT.md` define o caixa sem diferença como **toda** forma conferida igual.

## Decisão

1. **Uma função pura, `caixasSemDiferenca`** (`packages/domain/src/financeiro/caixas-sem-diferenca.ts`), usada pela Visão do mês e pelo KPI. A consulta é única: `caixasDoPeriodo`, que lê as linhas de `caixa_por_forma`.
2. **O conjunto de dias**, igual no numerador e no denominador, tem três partes:
   - os dias úteis até ontem;
   - hoje, se fechado;
   - todo dia não útil com caixa.
3. **"Sem diferença"** é toda linha com `contado = esperado`.

## O que muda na tela

- `caixa.comDiferenca` passa a contar o caixa com **alguma** forma diferente. Isso inclui o caso que somava zero, e o número pode subir.
- `caixa.fechados`, `caixa.diasUteis` e `caixa.diferenca` não mudam. `diasUteis` continua sendo o "N dias úteis passados" da meta.
- Entra `caixa.diasDaConferencia`, opcional para a tela antiga continuar compilando: o denominador corrigido. A tela que quiser a razão faz `(fechados − comDiferenca) ÷ diasDaConferencia`, que nunca passa de 100%.

## Testes

- `caixa-sabado-nao-passa-de-100`
- `caixa-sobra-e-falta-iguais-tem-diferenca`
- a property "nunca passa de 100"

A suíte da Visão do mês não teve asserção alterada por esta ADR: o caso existente tem uma forma só.
