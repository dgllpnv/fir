# Reabrir e excluir só o orçamento

Data: 2026-11-13. Estado: aceita. Substitui, **só para estas duas ações**, a regra
"de `fechado` e `perdido` nada sai" (`packages/domain/src/jornada.ts`) e a decisão de
que "Excluir tarefa" era o único caminho de desfazer um fechamento.

## Contexto

Errar o fechamento de um orçamento só se corrigia excluindo o atendimento
inteiro (a consulta junto). A cliente pediu reabrir ou excluir **só o orçamento**.

## Decisão

Duas ações novas da jornada, `reabrirOrcamento` e `excluirOrcamento`:

- **Reabrir** (de `fechado`/`perdido`): volta a `orcamento`, com o oferecido, a
  lista e o programa orçado intactos; `valor_fechado` sai.
- **Excluir** (de `orcamento`/`fechado`/`perdido`): volta a `realizado`; valor,
  lista e programa orçado saem. A consulta fica.

Nas duas, na **mesma transação**:

- o recebimento embutido é **estornado** pela flag existente `estornado_em` (não
  por linha negativa: `DINHEIRO_QUE_ENTROU` ignora valor negativo e a receita não
  cairia), e a tarefa companheira "Pagamento de orçamento" sai da lista;
- o programa criado é encerrado **e excluído** (`programa_por_origem` só enxerga os
  vivos; sem isso o próximo fechamento bateria no índice);
- o histórico recebe um evento novo com o **motivo**; nada é apagado.

O funil e a contagem por atendente leem **eventos**, então ignoram o que foi
desfeito (`sqlEventoDesfeito`, par de `orcadoNaJanela`). Sem isso, "Fechados"
somaria um negócio que não existe mais.

## Salvaguardas (gate de risco, 2026-11-13)

- **Permissão:** `jornada` **e** `receber`, na tabela `PERMISSAO_EXTRA`, como
  `fechar`. O superadmin, na sessão de suporte, pode (ADR do suporte), com motivo.
- **Motivo obrigatório (10 a 200)** para todos, validado antes da transação.
- **Recusa** se o programa já tem **sessão realizada** (estoque baixado e paciente
  tratado: regra 12) ou **outros pagamentos** depois do fechamento (o saldo do grupo
  ficaria negativo: regra 5).
- **Dia de caixa fechado:** o estorno exige `confirmarCaixaFechado`; a tela diz o dia.
- **Repetir** a ação é 409; nunca um segundo estorno. Linha de trilha com quem e o motivo.
- A prévia (`GET /v1/tarefas/:id/orcamento/previa`) passa pela redação central: sem
  `valores`, a frase é "há um pagamento a estornar", sem número.

## Testes

`desfazer-orcamento.e2e.test.ts` (Postgres real): estorno, receita e funil de volta
ao ponto inicial, fechar de novo sem dobrar, repetição, permissão, motivo, caixa
fechado. A matriz de transições do domínio passou de 26 para 31 combinações.
