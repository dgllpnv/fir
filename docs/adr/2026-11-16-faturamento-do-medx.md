# Faturamento do MedX: `valorOriginal` de lançamento de fatura, e só o dia que muda é escrito

**Status:** aceita, 2026-11-16, **sujeita à calibração C.0**. **Migration:** 0095. **Spec:** `docs/specs/integracao-medx.md` (C.1–C.7), ticket T5. **Parecer:** `docs/specs/integracao-medx-gate-numeros.md`.

## Contexto

A spec escolheu a fonte G2: `GET /financas/lancamentos`, contas a receber pagas, pela data do pagamento. O C.1 diz "valor recebido = `valorPago`, bruto". Essa frase foi escrita para o **pagamento de fatura** (`/faturas/{id}/pagamentos`), onde `valorPago` é de fato o que entrou e `taxas` vem à parte.

A documentação do MedX (OpenAPI v1, lida em 2026-11-16) descreve o **lançamento** de outro jeito: nele, `valorOriginal` é o crédito e `valorPago` é o débito ou a taxa, e não o valor liquidado. Somar `valorPago` do lançamento somaria as taxas do cartão e chamaria isso de faturamento.

Três outras decisões apareceram na implementação: o que fazer com lançamento que não é de fatura, como auditar uma tabela que o worker relê toda hora, e quando rodar a releitura de 13 meses.

## Decisão

1. **O valor do lançamento é `valorOriginal`.** O mapeamento mora num lugar só (`integracoes/medx/faturamento-do-medx.ts`, esquema `Lancamento`). Lido como **texto** do JSON (reviver com `context.source`) e convertido por `Dinheiro.deDecimalExterno`, nunca por `deTexto`, `parseFloat` ou `Number`. A calibração C.0 confere centavo a centavo com o relatório de recebidos do MedX. **Se ela mostrar outra coisa, volta ao gate; a leitura não se adapta em silêncio.**

2. **Só conta lançamento de fatura (`faturaId` presente).** Lançamento manual e sinal de orçamento ficam fora: orçamento nunca é receita (regra 4; A3). A quantidade dos que ficaram fora vai para o log, sem valor. Valor zero e lançamento sem data de pagamento também não contam.

3. **Só o dia que mudou é escrito.** O worker relê toda hora, mas um dia com o mesmo total, o mesmo exato e a mesma quantidade não é regravado. Por isso a trilha é a de toda tabela de negócio (um trigger de INSERT, UPDATE e DELETE, como exige `teste/auditoria-inescapavel.test.ts`) e ainda assim não ganha 1.500 linhas por dia dizendo "nada mudou". O histórico (`historico_de_faturamento_externo`) ganha uma linha quando muda o centavo ou a quantidade. Um resíduo de dezmilésimo que muda sem mudar o centavo atualiza a leitura, mas não vira histórico.

4. **A regra "a última leitura vale" (A5) é por clínica.** Sob o advisory lock da clínica, uma leitura que **começou** antes do último sucesso gravado (`integracoes_da_clinica.faturamento_ultimo_sucesso_em`) não grava nada e devolve `superada`. Por dia não daria: como o dia que não mudou não é regravado, o `lido_em` da linha diz quem pôs o valor, não quem leu por último.

5. **Um job só, de hora em hora (minuto 5), e a releitura de 13 meses é a primeira volta depois das 02:00 da clínica.** A spec fala em job horário e noturno. Um job com a regra "se a última releitura não foi hoje e já passou das 02:00 no fuso da clínica, releia 13 meses" faz o mesmo sem um segundo agendamento e sem precisar saber o fuso no cron. Primeira leitura e fuso mudado também disparam a releitura.

6. **Tudo ou nada por ciclo, não por janela.** Todas as janelas (até 85 dias, cada uma alargada 1 dia de cada lado) e todas as páginas são lidas antes de qualquer escrita, numa transação. A trava de leitura vazia olha o ciclo inteiro: nenhum pagamento onde antes havia aborta e não zera nada.

## Alternativas descartadas

- **Somar `valorPago` como a spec escreveu.** Contraria a documentação do próprio MedX para o lançamento.
- **Ler `/faturas/{id}/pagamentos`.** É a fonte alternativa da G2. Uma chamada por fatura, e a G2 proíbe usar as duas fontes. Fica como plano B se a calibração reprovar o lançamento.
- **Regravar todo dia e auditar só com `WHEN` no trigger.** Exigiria dois triggers por tabela, e a guarda de auditoria (um trigger de INSERT, UPDATE e DELETE) teria de abrir exceção para esta tabela.
- **Dois jobs (horário e noturno).** Dois agendamentos para o mesmo trabalho, com o noturno fixado num fuso só.

## Consequências

- A calibração C.0 continua obrigatória antes de ligar em qualquer clínica. Além do que a spec já lista, ela confere: `valorOriginal` contra o relatório; se fatura cancelada com pagamento aparece como lançamento pago (o lançamento não diz o estado da fatura); se o sinal de orçamento convertido tem `faturaId`.
- O `lido_em` da linha é o da leitura que pôs o valor, e deixa de servir para o selo "lido do MedX às HH:MM" do T7 (a spec dizia `min(lido_em)`). O selo passa a ser a última leitura que **cobriu** o período: o último sucesso (`faturamento_ultimo_sucesso_em`) quando o período começa no dia 1º do mês anterior ou depois, e a última releitura completa (`faturamento_releitura_em`) quando começa antes.
