# Excluir tarefa com pagamento estorna junto; o suporte também pode excluir

Data: 2026-11-13 · Estado: aceita · Diverge do protótipo (decisão de produto) e da regra D-13 da sessão de suporte (só nesta ação)

## Contexto
Uma clínica não conseguia apagar uma tarefa de teste: consulta realizada com um pagamento em Pix
embutido no atendimento e um orçamento já fechado. Havia um ciclo sem saída:

- `DELETE /v1/tarefas/:id` recusava por haver recebimento vivo ("reabra para estornar");
- `reabrir` é recusado em `fechado` (terminal), e a mensagem mandava "estornar em Financeiro › Recebimentos";
- `estornar` recusa o recebimento embutido ("reabra o atendimento").

Além disso, o superadmin em sessão de suporte (ator `operador`) é barrado por `exigePessoa` (D-13):
excluir não tinha caminho para ele. O protótipo apaga fisicamente e sem olhar pagamento, então não
responde ao caso (e apagar fisicamente viola a regra 20).

## Decisão
1. **Excluir tarefa com pagamento estorna o pagamento junto**, numa única transação:
   - estorna (`estornado_em`) os recebimentos vivos da tarefa e os da tarefa companheira
     "Pagamento de orçamento" (a da adesão do programa que ela criou), que também vai a `excluida_em`,
     como `RecebimentosService.estornar` já faz;
   - `excluida_em` na tarefa (soft delete, regra 20);
   - o programa criado no fechamento é **encerrado** (`situacao = 'encerrado'`), nunca excluído, com a
     mesma semântica de `ProgramasService.encerrar`: sessões já feitas ficam, sessões abertas viram
     `cancelada`. Nenhum movimento de estoque é tocado: o consumo aconteceu, e a regra 12 só pede
     movimento compensatório na reabertura de uma sessão, que não é este caso.
   - tudo cai na trilha por trigger (de → para), sem nenhuma exclusão física.
2. **Pagamento posterior do programa trava a exclusão (409)**: se o programa tem recebimento vivo que
   não é o da adesão (cobrança de saldo, sessão avulsa), excluir não estorna dinheiro que não é da
   tarefa em silêncio; a mensagem diz o caminho de cada tipo (revisão I6): o pagamento **avulso** (cobrança) se estorna em Financeiro › Recebimentos; o pagamento **embutido** em atendimento ou sessão do programa NÃO (Recebimentos recusa: "dentro de um atendimento"), então a mensagem manda reabrir esse atendimento.
3. **Quem pode**: `podeExcluir` (solicitante ou `tarefas.equipe`) **e**, quando há pagamento ou programa
   a desfazer, `receber`. Perfil sem `receber` é recusado (403) quando há pagamento. Sem pagamento, nada muda.
4. **O suporte exclui, e só exclui.** `DELETE /v1/tarefas/:id` usa o leitor (`leitorDe`), não `autorDe`: a
   exclusão não grava nome de pessoa em nenhuma coluna (`excluida_em`, `estornado_em` e o encerramento do
   programa não têm coluna de autor), então não há o que falsificar. `exigePessoa` continua intacto em todas
   as outras escritas de tarefa (criar, editar, concluir, reabrir, jornada). A trilha grava
   `ator_tipo = 'operador'`; a clínica o vê como "Suporte Firmare", sem id nem nome. Sem migration.
5. **Confirmação em dois passos na tela**, com `GET /v1/tarefas/:id/exclusao` (prévia): diz que o pagamento
   será estornado, sai da receita e o programa é encerrado. O valor só aparece com a permissão `valores`
   (o campo `valor` é redigido pelo interceptor central, regra 17). O botão Excluir aparece também no
   cartão da tarefa concluída, sem depender de "Editar".
6. **Idempotência**: excluir de novo é 404, sem novo estorno.
7. **Caixa já fechado**: nada novo. O esperado guardado do fechamento não muda; o estorno acende
   "mudou depois do fechamento" com a alteração negativa por forma (`estornado_em > fechado_em`), como o
   estorno avulso. O esperado cego continua sem atravessar antes do fechamento.

## Consequências
- Divergência da D-13: ela dizia que a sessão de suporte não faz escrita de tarefa. Passa a haver uma
  exceção explícita e auditada, e só esta.
- A mensagem de `JA_TEM_ORCAMENTO` (reabrir em `fechado`) deve apontar para Excluir, não para estornar.
- Limite conhecido: a tarefa companheira é reconhecida pelo programa de origem (mesmo `programa_id`, nascida
  na mesma transação do programa). Orçamento fechado sem itens (sem programa) com companheira não tem
  vínculo para achá-la; nesse caso só os recebimentos da própria tarefa são estornados.
- Em aberto: a exclusão não grava evento no `historico` da tarefa (as ações do histórico são da máquina de
  estados da jornada); a prova é a trilha de auditoria.

## Emenda de 2026-11-13 — revisão de segurança e LGPD (I1, I2')
- **Motivo obrigatório ao Suporte (I1).** `decisoes.md` (D-13) exige "justificativa por acesso e prazo", e o
  operador excluía, estornava e reativava sem dizer por quê. Agora `motivo` (texto, 10 a 200 caracteres) é
  **obrigatório quando o ator é o operador** — `DELETE /v1/tarefas/:id`, `DELETE /v1/recebimentos/:id`
  (estorno), `DELETE /v1/pacientes/:id` e `POST /v1/pacientes/:id/reativar` — e **opcional para a pessoa da
  clínica** (inalterado). Vai no **corpo** (não na URL, que vai para log de acesso). Sem motivo: 400 antes de
  abrir a transação. Mora em `comum/motivo-de-suporte.ts`, uma vez.
- **Como chega à trilha.** `set_config('app.motivo', …, true)` por transação, lido pela trigger
  `registrar_auditoria` (migration 0079, forward-only, `CREATE OR REPLACE` com o corpo da 0034 mais o
  motivo). Todas as linhas escritas na transação levam o mesmo motivo: o estorno, a tarefa companheira e o
  encerramento do programa são UMA ação com UMA justificativa. A variável é local à transação e não
  vaza para a requisição seguinte do pool (coberto por teste).
- **A clínica passa a ler QUAL coisa o Suporte mexeu.** `AtividadeDaClinica` ganha `entidadeId` e `motivo`
  (só nas linhas de `superadmin`; `null` nas demais, retrocompatível). Nunca nome, telefone, valor, nem id ou
  nome do operador. O motivo é texto livre e a tela do suporte avisa "não escreva nome de paciente".
- **`quem.podeReceber` é sempre verdadeiro para o operador**: `temPerm` dá acesso total a `admin: true`, e
  a sessão de suporte é admin (D-13). Logo o suporte estorna o pagamento e encerra o programa na exclusão
  mesmo sem perfil com `receber`. **Risco aceito**, compensado por: motivo obrigatório, trilha como
  `operador` visível à clínica, sessão de 30 minutos e revogável, e prévia em dois passos. Se um dia o
  suporte precisar ser MENOS que admin, a tabela de `temPerm` é o lugar, não um `if` aqui.
- **Prévia** (`GET /v1/tarefas/:id/exclusao`) ganhou `exigeMotivo` (o servidor diz à tela se é sessão de
  suporte, sem a tela adivinhar). Ela **não** é `@DadoSensivel`: devolve três booleanos e um valor já
  redigido por `valores`, sem nome, paciente nem procedimento; marcá-la encheria a trilha de acesso com a
  confirmação de uma exclusão que já deixa a sua própria linha de escrita.
- **TOCTOU na exclusão (I2').** `carregar` já trava a tarefa (`FOR UPDATE`): duas exclusões se enfileiram e a
  segunda é 404. Faltava o programa: `efeitoDaExclusao` lê "há outros pagamentos?" e o `UPDATE programas`
  vem depois. Agora o programa de origem é travado (`FOR UPDATE`) antes da leitura; o `INSERT` de uma cobrança
  (FK `recebimentos.programa_id`) toma `FOR KEY SHARE` no programa, que conflita — a cobrança em voo ou é
  vista, ou espera. Teste com cobrança não confirmada numa segunda conexão (vermelho sem a trava).

