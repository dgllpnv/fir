# Spec — Avisos de caixa fechado e de duplicidade; desfazer pagamento de conta

**Origem:** achados da validação de produção de 2026-11-08 ("Para você decidir depois"), decididos pelo
dono no mesmo dia (D-21). Mexe em dinheiro: gate do `validador-numeros` antes do código.

## Decisões do dono (D-21)

| # | Achado | Decisão |
|---|---|---|
| 1 | Na contagem às cegas, quem tem `estoque` vê o saldo na lista de itens | **Seguir o protótipo** — nada muda |
| 2 | Recebimento lançado em dia de caixa já fechado entra sem aviso | **(a) avisar ao lançar + (b) marcar o dia como "mudou depois do fechamento"** |
| 3 | Avulso de mesmo valor, mesma paciente, mesmo dia de um pagamento já registrado | **Avisar antes de gravar** |
| 4 | Pagamento de conta registrado errado não tem correção | **Construir** "desfazer pagamento" com trilha |

## 2 e 3 — O padrão único de confirmação

Os dois avisos são do SERVIDOR (a autoridade; vale para qualquer cliente), no mesmo padrão:

- O servidor recusa com **409** e um `codigo` próprio quando o aviso se aplica, a menos que o corpo traga a
  confirmação explícita: `CAIXA_FECHADO` ↔ `confirmarCaixaFechado: true`; `POSSIVEL_DUPLICIDADE` ↔
  `confirmarDuplicidade: true`. Os dois podem vir juntos.
- A tela mostra a pergunta e, se a pessoa confirma, reenvia o MESMO corpo com a confirmação. Cancelar não
  grava nada.
- **Onde vale:** todo caminho que grava um recebimento — `POST /v1/recebimentos` (avulso e pagamento de
  saldo), concluir tarefa com pagamento embutido, concluir sessão de programa com pagamento, fechar com
  entrada. Uma função de checagem só, chamada por todos (a mesma regra escrita uma vez).
- **Caixa fechado:** o dia de negócio do recebimento (no fuso da clínica) tem `caixas_do_dia` fechado.
  A mensagem não revela valores: "O caixa de 08/11 já foi fechado. Lançar mesmo assim? O dia vai aparecer
  como alterado depois do fechamento."
- **Duplicidade:** já existe recebimento VIVO (não estornado) da mesma paciente, no mesmo dia de negócio,
  com exatamente o mesmo valor em centavos. Mensagem sem valor para quem não tem `valores`; com valor para
  quem tem ("Já existe um pagamento de R$ 150,00 para esta paciente hoje. É outro pagamento?").
- **Regra 3 intacta:** o aviso é só aviso; o índice único "um recebimento vivo por tarefa" continua sendo a
  garantia. Confirmar a duplicidade grava um segundo recebimento legítimo (é outro dinheiro).

## 2b — "Mudou depois do fechamento" na tela de caixa

- Ao ler um dia FECHADO, o servidor compara o esperado guardado no fechamento com a soma viva dos
  recebimentos daquele dia, por forma. Se diferir: `mudouDepoisDoFechamento: true` e, para quem tem
  `valores`, a diferença por forma (`{ forma, valor }`, redigido pelo interceptor central).
- **Regra 6 intacta:** só vale para dia já FECHADO (o esperado já é legítimo depois do fechamento).
  Dia aberto continua sem esperado nem diferença.
- A lista dos últimos caixas mostra o selo "alterado depois do fechamento".
- O fechamento guardado NÃO é recalculado (é o registro do que foi conferido).

## 4 — Desfazer pagamento de conta

- `POST /v1/contas/:id/desfazer-pagamento { motivo }` (motivo obrigatório, 3–200 caracteres), exige
  `contas.gerir`.
- Grava uma linha em tabela **append-only** `pagamentos_de_conta_desfeitos` (conta, pago_em, valor_pago,
  forma, pago_por, motivo, desfeito_por, desfeito_em, clinica_id; RLS) e volta a conta para "em aberto"
  (limpa `pago_em`, `valor_pago`, `forma_pagamento`, `pago_por`) — na mesma transação. A trilha de
  auditoria também registra o de→para.
- A conta do mês seguinte, criada no Paguei original, **fica**. Pagar de novo não cria outra (o
  `ON CONFLICT` da renovação já garante).
- Depois de desfeito, a conta pode ser paga de novo com os valores certos.
- A mensagem de `excluir` deixa de dizer "edite o valor pago" e passa a apontar o "Desfazer pagamento".
- Tela: na conta paga, ação "Desfazer pagamento" (só com `contas.gerir`) com o motivo; confirmação clara.

## Critérios de aceite

1. Recebimento em dia fechado sem confirmação → 409 `CAIXA_FECHADO`; com confirmação → grava; o dia passa a
   mostrar "mudou depois do fechamento" com a diferença exata por forma (para quem tem `valores`).
2. Avulso igual ao embutido (paciente, dia, valor) → 409 `POSSIVEL_DUPLICIDADE`; com confirmação → grava;
   valor diferente, outro dia ou outra paciente → grava sem aviso; estornado não conta.
3. Desfazer pagamento: conta volta a aberta, a linha append-only existe com o motivo, Visão do mês e "Pago por
   forma" deixam de contar aquele pagamento, pagar de novo não duplica a conta do mês seguinte, sem
   `contas.gerir` → 403, conta não paga → 409.
4. Regra 6: dia aberto continua sem esperado/diferença em todas as respostas.

## Ajustes do gate (`validador-numeros`, aprovado com ajustes) — VALEM SOBRE O TEXTO ACIMA

1. **Caminhos que gravam recebimento** (todos com a mesma checagem): avulso (`recebimentos.service.ts`),
   `registrarPagamento` (concluir tarefa, concluir sessão, fechar na jornada), **criar tarefa já concluída
   com pagamento** (`tarefas.service.ts`, aceita data retroativa) e **montar programa com entrada**
   (`programas.service.ts`, `lancarPagamentoDaAdesao`). Exceções declaradas: o migrador da v20 e o seed de teste.
2. A checagem recebe o `recebidoEm` **final** (o instante que vai ser gravado) e usa `janela(dia, dia, fuso)`
   semiaberta sobre `recebido_em` (regra 23) — nunca `::date`. Retroativo em dia fechado é coberto.
3. No avulso, a checagem roda **depois** de `porRequisicao`: reenvio da mesma requisição devolve a linha
   existente, nunca 409.
4. Duplicidade: compara a coluna `valor` (dinheiro que entrou, filtro `DINHEIRO_QUE_ENTROU`), **ignora a forma**,
   inclui nota promissória, exclui `valor = 0`, estornado e tarefa excluída.
5. **O 409 não carrega número nenhum** — a redação central só alcança respostas de sucesso. O corpo é
   `{ codigo: 'CONFIRMACAO_NECESSARIA', avisos: ['CAIXA_FECHADO' | 'POSSIVEL_DUPLICIDADE' | 'MES_ANTERIOR'] }`, e
   a TELA escreve o texto, usando o valor que a própria pessoa digitou e o formatador central.
6. `CAIXA_FECHADO` não se aplica a nota promissória nem a `valor = 0` (fora da gaveta; a marca não mudaria).
7. A soma viva usa **a mesma função do fechamento** (`esperadoDoCaixa(recebimentosDoDia(...))`, filtro
   `NA_GAVETA`), as 4 formas. `mudouDepoisDoFechamento` acende se a diferença por forma ≠ 0 **ou** se há evento
   posterior ao fechamento (recebimento criado, estornado ou tarefa excluída depois de `fechado_em`) — pega o caso
   que se anula. Campo: `alteracoesDepoisDoFechamento: [{ forma, valor }]`, `valor = vivo − guardado` com sinal
   (nome `valor` já é monetário e redigido). Nunca reusar `diferenca`.
8. Estorno, reabertura e exclusão de tarefa em dia fechado **não** dão aviso (intencional), mas acendem a marca.
9. Desfazer: `SELECT … FOR UPDATE` e `UPDATE … WHERE id = $1 AND pago_em IS NOT NULL`; a linha append-only só
   nasce se `rowCount = 1`. A tabela guarda também **categoria e vencimento** no instante do desfazer; PK `id`,
   RLS ENABLE+FORCE, trigger de auditoria e trigger que recusa UPDATE/DELETE/TRUNCATE (como `movimentos_de_estoque`).
10. A renovação no Paguei **não cria** a conta do mês seguinte se já existe — ou já existiu e foi excluída — conta
    da série com vencimento posterior ao desta (fecha o furo de editar o vencimento ou excluir a seguinte).
11. **Desfazer pagamento de mês anterior** (pela data `pago_em`, no fuso da clínica, relógio do servidor) exige
    confirmação: aviso `MES_ANTERIOR` ↔ `confirmarMesAnterior: true`. Decidido pelo orquestrador seguindo a
    recomendação do gate (conservador e reversível); o dono pode revogar.

Testes obrigatórios: os listados pelo gate (e2e com Postgres real nos 6 caminhos, borda de fuso, números à mão do
"mudou", estorno que se anula, promissória, transporte, duplicidade com requisicaoId, desfazer com corrida e
renovação, append-only recusado pelo banco, RLS) + property: Σ alterações = vivo − guardado; Σ registrados =
Σ vivos + Σ desfeitos; no máximo 1 conta posterior por série.
