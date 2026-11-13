# Valor da lista importada: `tarefas.valor_de_referencia`

Data: 2026-11-13 · Estado: aceita · Decisão do dono

## Contexto
A lista que a clínica importa em uma campanha traz o valor ao lado do nome ("Maria Souza - R$ 15.200").
`limparNomeDeLista` já lia o valor, mas ele era descartado. A cliente quer vê-lo no cartão da tarefa.

## Decisão
- Coluna `tarefas.valor_de_referencia BIGINT NULL` (migration 0080, expand, sem preenchimento retroativo), em
  centavos. Tabela já tem RLS e trilha de auditoria; a coluna herda ambas.
- **Referência, nunca receita** (regras 3 e 4): fora de recebido, LTV, meta e `valorConvertido`.
- Dinheiro para a redação (regra 17): `valorDeReferencia` entra em `CAMPOS_MONETARIOS` e em `teste/registro.ts`;
  sem `valores` sai `null`. O cartão mostra "valor da lista" só quando o campo veio.
- A tela manda o valor em `LinhaDaCampanha.valorDeReferencia` (centavos em texto), já que o nome chega limpo; na
  falta dele o servidor lê o valor do próprio nome. Negativo é 400; acima de R$ 10 trilhões vira "sem valor"
  (lixo de planilha, evita estouro de `bigint`).
- Idempotência intacta: o valor só é gravado na criação da tarefa; reimportar não cria nada nem altera o valor.
  Tarefa já existente não recebe o valor depois (não se reescreve o que o usuário já tem, regra 27).

## Consequências
Classe nova em `docs/compliance/retencao.md`. Tarefas importadas antes da 0080 ficam sem valor.
