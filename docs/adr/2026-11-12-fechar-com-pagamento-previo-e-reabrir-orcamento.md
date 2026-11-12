# ADR: fechar orçamento de atendimento já pago, reabrir orçamento enviado, estornar na lista

Data: 2026-11-12. Status: aceita (dono do produto, 12/11/2026: "siga, com as respostas padrão").
Origem: pedido 2 da cliente (clínica Raja), vídeos de 12/11.

## Contexto
Três sintomas, uma raiz comum: o cartão do orçamento e o pagamento da consulta disputavam a mesma
tarefa.

1. **"Fechou" dava "Internal server error".** A consulta já tinha o pagamento dela (entrada + em
   aberto). O fechamento tentava gravar um segundo recebimento vivo na MESMA tarefa, e o índice
   `recebimento_por_tarefa` (regra 3) recusava — sem tradução, virava 500.
2. **Excluir a tarefa de teste era impossível.** Excluir recusa tarefa com pagamento ("reabra para
   estornar"); reabrir recusava cartão em `orcamento` ("já tem orçamento registrado"). Sem saída.
3. **O que foi orçado não aparecia por item**, e "Corrigir orçamento" só mexia em valor, data e nota.

## Decisão
1. **Fechar com pagamento prévio:** se a tarefa já tem recebimento vivo, o dinheiro do fechamento vai
   para uma tarefa companheira "Pagamento de orçamento" (a mesma que Recebimento › Orçamento fechado
   cria). A consulta fica com o pagamento dela, intocado. O programa continua com
   `tarefa_de_origem_id` = o cartão. Cada pagamento conta uma vez.
2. **Reabrir passa a valer em `orcamento`** (continua recusado em `fechado` e `perdido`, com mensagem
   que aponta o estorno). Reabrir estorna o pagamento da consulta e devolve o cartão à etapa
   anterior. O CHECK `orcamento_so_com_etapa` obriga a soltar `valor_orcamento` e `programa_orcado`
   das colunas; o orçamento enviado permanece no histórico (append-only). Diverge da decisão do épico
   3, que recusava reabrir em `orcamento`.
3. **Estornar na lista de Recebimentos** (recebimento avulso, `receber`): confirmação em dois passos.
   O pagamento embutido continua se desfazendo reabrindo o atendimento.
4. **Itens do orçamento visíveis e corrigíveis:** o cartão lista cada item (procedimento, sessões,
   intervalo, dose; valor só com `valores`). `corrigirOrcamento` aceita `programa` (troca por inteiro),
   com as mesmas conferências do registro: responsável da clínica, itens que cabem no valor, e sem
   `valores` nenhum item com preço.

## Consequências / fica de fora
- Estorno **sem campo de motivo**: `recebimentos` não tem a coluna; a trilha de auditoria (quem,
  quando, de → para) cobre. Motivo exigiria migration e entra se o dono pedir.
- Orçamento **fechado** que precisa ser desfeito ainda não tem caminho de um clique: estornar o
  recebimento do orçamento, e o programa montado é arquivado à parte. Registrado como pendência.
- O teste de atomicidade de `fechar.test.ts` passou a provar o rollback pelo montador recusando o
  procedimento (a "vaga ocupada" virou caso de sucesso).
