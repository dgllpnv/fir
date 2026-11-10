# ADR: "Quem faz o contato" na retomada de orçamento

Data: 2026-11-10. Status: aceita (dono do produto, 10/11/2026).

## Contexto
A cliente quer que o "retomar em DD/MM" do orçamento seja uma tarefa naquele dia, visível para quem fará o contato, com o que foi orçado. No protótipo o orçamento a retomar é um cartão do bloco "Próximos passos da jornada" e só aparece para responsável ou solicitante da consulta (`vePasso`).

## Decisão
1. Sem tarefa separada: o próprio cartão de orçamento aparece na lista do dia e na bolinha da semana do dia da retomada (dias futuros); de hoje para trás continua o bloco `retomar`. Nada é criado, então registrar ou editar duas vezes não duplica.
2. Divergência do protótipo: campo OPCIONAL `contatoId` ("quem faz o contato") em `registrarOrcamento` e `followUp`. Em "Para mim" entra quem é responsável, solicitante ou contato. Sem o campo vale o comportamento anterior. Novo orçamento sem o campo limpa o contato; follow-up sem o campo o mantém.
3. `tarefas.contato_id` com FK composta `(contato_id, clinica_id)` para `pessoas`; o servidor recusa (400) pessoa inativa ou de outra clínica.
4. O cartão mostra o resumo do orçamento (valor, procedimentos pelo catálogo, nota, contato). O valor segue redigido sem `valores`.

## Fora do escopo
O contato não ganha permissão de editar o cartão; só o enxerga. Prazo padrão continua hoje + 2.
