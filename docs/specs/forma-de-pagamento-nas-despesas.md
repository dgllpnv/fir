# Spec — Forma de pagamento nas despesas (Prioridade 3 da cliente)

## Problema

A forma de pagamento só aparece nos recebimentos. Nas despesas a clínica não enxerga como cada conta é
paga, e por isso não confere o extrato nem prevê a saída de cada conta bancária ou cartão.

## O que já existe (medido no código, 2026-11-08)

- O **Paguei** já pede data, valor e forma: `PagarConta.formaPagamento` (opcional), gravada em
  `contas_a_pagar.forma_pagamento`. Pagamento sem forma grava `''`.
- `FORMAS_DE_SAIDA` (`packages/domain/src/financeiro/contas.ts`): Pix, Boleto, Transferência, Cartão
  de crédito, Débito automático, Dinheiro. **Falta "Cartão de débito"**, que a cliente pediu.
- A Visão do mês soma `despesasPagas` a partir de `valor_pago` das contas com `pago_em` no mês (o valor
  pago, nunca o valor da conta).

O pedido é, portanto, o que a própria cliente previu no "A confirmar": a **forma prevista no cadastro**,
o **relatório por forma** e o **filtro**.

## Decisões

1. **"Cartão de débito" entra em `FORMAS_DE_SAIDA`**, na ordem que a cliente escreveu: Pix, Boleto,
   Débito automático, Cartão de crédito, Cartão de débito, Transferência, Dinheiro. A coluna é `text`,
   então incluir uma forma não exige migration. A ordem antiga não está gravada em lugar nenhum.
2. **`contas_a_pagar.forma_prevista`** (`text NOT NULL DEFAULT ''`, até 30 caracteres), opcional na
   criação e na edição. `''` quer dizer "não prevista".
3. **Paguei — sem fallback no servidor** (ajuste do `validador-numeros`). A **tela** vem preenchida
   com a forma prevista, e a pessoa confirma ou troca. O **servidor grava exatamente o que recebeu**:
   uma forma da lista, ou `''`/ausente = "Não informada". Ele nunca preenche a forma pela prevista. O
   fallback faria a forma gravada mentir: alguém limpa o campo porque não sabe a forma, e o servidor
   grava "Boleto" para um pagamento feito por Pix. O extrato deixa de conferir, que é justamente o
   que a cliente quer resolver. Conta sem forma continua sendo paga normalmente (critério 1).
4. **Renovação mensal**: a conta do mês seguinte, gerada no Paguei na mesma transação, copia
   `forma_prevista`, **listada explicitamente** no `INSERT … SELECT`. Esquecer a coluna gravaria `''`
   sem erro nenhum. A forma usada **não** é copiada: se a cliente pagou de Pix por exceção, o boleto do
   mês seguinte continua previsto como Boleto.
5. **Visão do mês: bloco "Pago por forma de pagamento"**, ao lado de "Recebido por forma".
   - Calculado em `visaoDoMes` (domínio) a partir de **`entrada.pagas`**, a mesma lista e o mesmo
     `valor_pago` de `despesasPagas`, com `forma` acrescentada a `DespesaPaga` na mesma consulta.
     **Agrupa pelo texto gravado**, nunca percorrendo `FORMAS_DE_SAIDA`: forma desconhecida (legada ou
     renomeada) ganha linha própria com o nome gravado e nunca some.
   - `''` vira **"Não informada"**, o rótulo do protótipo nos recebimentos.
   - Ordem: valor decrescente; empate pelo nome da forma em `localeCompare('pt-BR')`.
   - Sem linha de valor zero e sem forma repetida.
   - Saída como array `{ forma, valor }` (igual a `LinhaDeForma`). `valor` já está em
     `CAMPOS_MONETARIOS`, e a redação central o cobre sem lista nova. Um mapa `{ Pix: … }` vazaria.
   - **Invariante:** `Σ pagoPorForma = despesasPagas = Σ porCategoria`, exatamente. Property test.
6. **Ao tocar numa forma**, abre a tela Contas a pagar já filtrada, forçando `situacao=pagas`, o mês
   da visão e aquela forma. A linha **só é tocável com `contas.gerir`** (mesma `temPerm` da tela e do
   servidor). Sem ela a lista mostra só as contas da própria pessoa, e o número da lista ficaria menor
   que o do bloco.
7. **Filtro por forma em Contas a pagar** (`ConsultaDeContas.forma`):
   - numa conta **paga** olha a forma usada; numa conta **em aberto**, a forma prevista;
   - aceita o sentinela "Não informada" (casa só com `''`) e **qualquer texto gravado** de até 30
     caracteres, não só o enum, para que toda linha do bloco seja filtrável.
   - **Total da lista:** em `situacao=pagas`, a resposta traz `total: { valorPago }`, calculado no
     servidor como Σ `valor_pago`, nunca somado na tela. Ele bate centavo a centavo com a linha do bloco
     (e2e). `valorPago` já está registrado como monetário nas rotas de contas. A resposta de
     `GET /v1/contas` já é um objeto `{ itens }`; `total` entra como campo opcional.
7b. **Fora de escopo, escrito para ninguém "corrigir" em silêncio:** pagar despesa em Dinheiro **não**
   mexe no esperado do caixa do dia. Esse é o comportamento atual.
7c. **"Quem pagou"** (ajuste do `product-rotina-clinica`). `ContaNaLista` ganha `pagoPor` (nome, a
   partir de `pago_por`, que já é gravado). A linha de uma conta paga mostra "categoria · data · pago por
   X", o equivalente ao `registradoPor` da lista de recebimentos.
7d. **A tela de Contas ganha mês e filtro pela URL**: `/contas?situacao=pagas&mes=AAAA-MM&forma=…`,
   lidos como `searchParams` **no `page.tsx` do servidor** e passados como props. Nunca
   `useSearchParams` sem `Suspense`, que foi o erro que quebrou o build de 2026-11-04. No modo filtrado
   aparece só o grupo "Pagas em <mês> · <forma>", com o total e um "Limpar filtro" visível.
7e. **As opções do filtro** são as `FORMAS_DE_SAIDA`, mais "Não informada", mais qualquer forma já
   gravada fora da lista, como o protótipo faz com as origens.
7f. **Nota sob o bloco "Pago"**: ele conta o mês inteiro, enquanto "Recebido por forma" conta só os dias
   com caixa fechado (regra 6). A 390 px os dois blocos ficam empilhados.
8. **Sem regra nova de permissão.** O bloco usa `valor`, campo monetário já redigido pelo interceptor
   central (regra 17). A tela Visão do mês já exige `finmes` → `valores`. A forma em si não é
   monetária e aparece para quem vê a conta.
9. **Regra 6 não se aplica**: é saída de conta a pagar, não o esperado de um caixa aberto.

## Critérios de aceite (os da cliente, verificáveis)

- Uma conta criada sem forma pode ser paga normalmente (forma escolhida no Paguei, ou nenhuma).
- A soma do bloco "Pago por forma" bate com o total de despesas pagas do mês (property test e e2e).
- A renovação mensal mantém a forma prevista (e2e).
- O filtro por forma na lista de contas devolve só as contas daquela forma (e2e: paga × aberta).
- Conta prevista Boleto: o Paguei abre com Boleto, a pessoa troca para Pix e registra. Grava Pix, e a
  conta do mês seguinte nasce prevista Boleto.
- Pagar uma conta com forma prevista custa os mesmos toques de hoje (Paguei → Registrar).
- Na Visão do mês de um mês passado, tocar em "Pix" (com `contas.gerir`) abre as pagas **daquele mês**,
  só Pix. O total da lista é igual à linha do bloco, e cada linha mostra descrição, categoria, data,
  valor e quem pagou.
- Para um perfil com `finmes` e sem `contas.gerir`, a linha do bloco não é tocável.
- Conta paga sem forma aparece em "Não informada" no bloco e no filtro. Forma desconhecida gravada no
  banco aparece como linha própria, e a soma continua intacta.

## Fora de escopo, escrito

- Corrigir a forma, ou o valor, de uma conta já paga. Hoje não existe caminho para isso, e a mensagem
  de `excluir` diz "edite o valor pago" sem que a edição altere `valor_pago`. Registrado em
  `docs/dividas.md`.
- O "Paguei" da tela Hoje continua sendo um link para `/contas`.
- Pagar despesa em Dinheiro não mexe no esperado do caixa do dia (decisão 7b).

## Rastreabilidade

Fora do protótipo: é pedido da cliente, aceito pelo dono como Prioridade 3. Decisão em
[ADR 0020](../adr/0020-forma-de-pagamento-nas-despesas.md) e na linha D-20 de `docs/decisoes.md`.
Gate: `validador-numeros` e `product-rotina-clinica` aprovaram com ajustes, todos incorporados acima.

## Tickets

| # | Fatia | Prova |
|---|---|---|
| T1 | Domínio: `FORMAS_DE_SAIDA` com Cartão de débito; `DespesaPaga.forma`; `pagoPorForma` em `montarVisaoDoMes` | property: Σ = despesasPagas; "" → "Não informada"; ordem decrescente |
| T2 | Migration 0038 `forma_prevista`; contratos (`SalvarConta.formaPrevista`, `ContaNaLista.formaPrevista`, `ConsultaDeContas.forma`, `VisaoDoMesNaSaida.pagoPorForma`) | typecheck, testes de contrato |
| T3 | API: criar/editar com prevista; Paguei grava exatamente o recebido (SEM fallback, decisão 3); renovação copia a prevista; filtro com total; visão com `pagoPorForma` | e2e com Postgres real (E1–E9) |
| T4 | Tela: campo no cadastro, Paguei pré-preenchido, filtro na lista, bloco na Visão do mês com toque → lista filtrada | typecheck, build, navegador a 390 px |
