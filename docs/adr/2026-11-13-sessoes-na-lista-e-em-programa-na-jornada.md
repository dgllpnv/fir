# Sessões no orçamento em lista e "Em programa" na Jornada

Data: 2026-11-13. Estado: aceita. **Diverge do protótipo** (decisão de produto, pedido da cliente).

## Contexto

A cliente pediu: (1) ver as sessões no campo de orçamento do paciente, "pra saber
exatamente o que foi orçado"; (2) no fechamento parcial, escrever as sessões que o
paciente vai fazer ("de 10 para 5, seguindo os dois procedimentos"); (5) que o
recebimento "em qualquer formato" apareça na Jornada, porque o sistema "vai precisar
puxar programas de tratamento em andamento".

O orçamento em lista (sem programa) guardava só o procedimento e o preço ("sem sessões
nem dose"). O protótipo não tem sessões na lista e não mostra programa na Jornada.

## Decisão

1. **Sessões na lista.** `ItemDoOrcamento` ganha `sessoes` opcional (1 a 60), dentro do
   `jsonb` `itens_orcamento` (sem migration). Cartão, aba Orçamentos e fechamento
   parcial leem a mesma informação nos dois modos (lista e programa).
2. **Fechamento parcial por sessões na lista.** O servidor valida `sessoesFechadas`
   contra as sessões orçadas do item, venha de `itens_orcamento` ou de
   `programa_orcado`. Na lista não nasce programa: o número fica no evento `fechar`
   (append-only) e é mostrado como "fechou 5 de 10 sessões".
3. **"Em programa" na Jornada.** Seção de leitura derivada
   (`GET /v1/jornada/programas-em-andamento`, `jornada`): um cartão por programa ativo,
   com procedimentos, sessões feitas de total e próxima sessão. **Não cria tarefa e não
   entra no funil nem na receita.** Sem dinheiro, dose, produto nem lote (regra 18).

## Alternativas rejeitadas

- **Criar uma tarefa "Consulta realizada" retroativa a cada recebimento:** o funil
  contaria atendimento que não houve e o dinheiro poderia entrar duas vezes (regra 3).
- **Só a lista de recebimentos (já existente):** mostra quem pagou, mas não faz o
  paciente em programa existir na Jornada.

## Consequências

- Orçamentos antigos em lista não têm sessões: o campo é opcional e some quando vazio.
- Orçamento de programa continua com sessões no `programaOrcado`; a lista de itens agora
  também carrega `sessoes` (migração por leitura, sem reescrever linha).
