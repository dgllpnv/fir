# Orçamento direto, sem consulta antes

**Data:** 2026-11-19 · **Estado:** aceita · **Diverge do protótipo** (decisão de produto)

## Contexto

A cliente explicou o pedido em áudio (19/11). Uma paciente veio para a reavaliação final de um programa de emagrecimento e recebeu um orçamento novo. A tarefa criada para a reavaliação não tinha "Registrar orçamento", porque só os cartões de consulta e de procedimento têm.

Então a recepção lançou só um valor recebido. O dinheiro entrou, mas o orçamento e o saldo em aberto não ficaram registrados em lugar nenhum. Nas clínicas, a saída que as meninas vinham usando era lançar uma consulta que não aconteceu, só para abrir o orçamento.

No protótipo, `moverEtapa` só aceita `orcamento` a partir de um cartão `realizado` da esteira. O protótipo não tem esse caminho.

## Decisão

1. **`POST /v1/tarefas/orcamentos`**, com permissão `jornada`, a mesma do Registrar orçamento.
   - Ele cria o cartão **"Orçamento enviado"**, concluído e com a paciente.
   - Na mesma transação, aplica o **mesmo `registrarOrcamento`** (`JornadaService.moverNaTransacao`).
   - Por isso valor, lista de procedimentos, programa, contato e retomada passam pelas mesmas conferências, e um erro desfaz tudo, sem deixar cartão órfão.
2. **O tipo é "Orçamento enviado"**, que já existe na tabela e que a migração da v20 já leva para a etapa `orcamento`.
   - Não é receita nem atendimento (regra 4).
   - Sem o evento `concluir`, o funil não o conta como realizado. Uma consulta de mentira contaria.
3. **No Fechou, o dinheiro vai para a tarefa companheira "Pagamento de orçamento"** quando o tipo do cartão não guarda pagamento.
   - É o caminho que já existia para a consulta que já foi paga, e é a mesma tarefa do Recebimento › Orçamento fechado.
   - Corrige também os cartões "Orçamento enviado" migrados, cujo Fechou era recusado com 400.
   - O desfazer (reabrir ou excluir o orçamento) já estorna o pagamento da companheira.
4. **Na tela:** a ficha do paciente, aba Orçamentos, ganha o botão **Novo orçamento**.
   - O formulário é o do Registrar orçamento, o mesmo componente e não uma cópia.
   - Depois de salvar, a ficha leva ao cartão, onde ficam Fechou, Follow-up e Perdeu.

## Consequências

- Em "orçamentos enviados ÷ realizados" do funil, o orçamento direto entra no numerador e não no denominador. A taxa pode passar de 100% num mês com muitos orçamentos diretos.
- **Excluir orçamento** num cartão direto devolve o cartão para "realizado", sem orçamento, como faz com uma consulta. Para tirá-lo da lista, use Excluir tarefa.

Código: `JornadaService.criarOrcamento`, `NovoOrcamento` (contracts), `fechamento.service.ts` (a companheira), `aba-de-orcamentos.tsx`. Testes: `orcamento-direto.e2e.test.ts`.
