# Itens do orçamento e fechamento por item

Data: 2026-11-13 · Status: aceita · Complementa 2026-11-12-fechamento-declarado-e-restante

## Contexto
A cliente pediu que, ao fechar parcialmente, o sistema mostre os procedimentos do orçamento e pergunte quais foram fechados, e que a ficha tenha uma aba Orçamentos. Os procedimentos só existiam dentro de `programa_orcado` (proposta de PROGRAMA); um orçamento só com valor não tinha lista, e por isso "segue sem aparecer".

## Decisão
1. **Itens do orçamento são conceito próprio**: coluna `tarefas.itens_orcamento jsonb` (migration 0078, expand-only), `[{chave, procedimentoId, valor?}]`, valor em centavos texto. CHECK: nunca junto com `programa_orcado`, e só em orçamento/fechado/perdido. `registrarOrcamento` e `corrigirOrcamento` aceitam `itens` OU `programa`.
2. **Migração por leitura**: `itensDoOrcamentoDe` (domínio) devolve `itens_orcamento` ou, na falta, os itens de `programa_orcado`. Nenhum backfill.
3. **O evento `fechar` persiste** `itensFechados` e `valorFechado` (append-only). Orçamento fechado antes disso: "sem detalhamento", nunca reconstruído.
4. `resumoDoOrcamento` (domínio) é a regra única do resumo derivado (situação, restante, marca por item). `GET /v1/pacientes/:id/orcamentos` (módulo da jornada, `jornada` + `@DadoSensivel('pacientes')`) e a coluna `parciais` da Jornada a usam. `valorRestante` entra em `CAMPOS_MONETARIOS`.
5. A coluna da Jornada "Orçamento parcialmente fechado" é visão derivada (recorte de hoje; o cartão continua em Fechados e o funil não muda).
6. Fechar recusa com 409 claro se o atendimento já tem programa vivo (índice `programa_por_origem`), em vez de 500.
7. O valor FECHADO digitado vale mais que a soma dos itens: no parcial com programa, os preços por item são rateados (`ratearValoresDosItens`, maior resto) para que a soma dos itens seja exatamente o fechado, qualquer que seja a combinação de itens com e sem preço.

## Consequências
- Fechamento direto sem orçamento enviado não aparece na aba Orçamentos.
- Corrigir itens de orçamento que é programa continua pelo programa.
