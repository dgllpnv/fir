# Validação de números: T9 (relatórios 2–7, 9, 10, 12, 13, 14 e "Criar campanha")

**Parecer do `validador-numeros`, 2026-11-17.** Diff não commitado em `backlog-final-indicadores-e-acesso`. Gate: [`indicadores-e-insights-gate-numeros.md`](indicadores-e-insights-gate-numeros.md) (c.3, c.9, c.10, c.11c), N-19 a N-22 de [`correcoes-po-gate-numeros.md`](correcoes-po-gate-numeros.md) e o T9 de [`-tickets.md`](indicadores-e-insights-tickets.md).

Os contraexemplos estão em `apps/api/src/relatorios/validador-t9.e2e.test.ts`, contra Postgres real. HOJE = 24/10/2026 (America/Bahia), com o caixa de hoje aberto. Cada falha foi rodada de novo sozinha e falhou de novo.

## Veredito (revalidação, 2026-11-17)

**APROVADO.** D1–D4 corrigidos. Medi na fonte e rodei: `validador-t9` (11 testes), `relatorios-t9` e as suítes das telas extraídas. 16 arquivos, 351/351 testes.

- **D1/D3, relatório 13.** O protótipo, na linha 3503, diz que `orc_valor = somaValor(conc.filter(tipo === "Pagamento de orçamento"))`. A coluna agora segue essa definição, tarefa a tarefa, só nos dias que contam. Eu mesmo mudei o meu `v13-c3`, e o cenário dele dá 0 nas duas pontas, então não prova nada. Por isso acrescentei `v13-revalida-pagamentos-de-orcamento-por-cartao-e-avulso`:
  - um cartão orçado em 25/09 e pago em 20/10 dá 1.000,00 na linha dele;
  - um pagamento avulso em 21/10 dá 500,00;
  - resumo = Σ linhas = **1.500,00**;
  - os 777,77 pagos hoje, com o caixa aberto, não aparecem em nenhuma linha nem no resumo;
  - `valorOrcamento` fica em coluna à parte e não soma.

  A entrada gravada no próprio cartão fica fora, como no protótipo.
- **D2, relatório 9.** Corte em 10/10: R$ 490,00, 3 pacientes e 4 grupos. Corte hoje: R$ 360,00 = Cobranças = Visão do mês.
- **D4, relatório 6.** Os 77,77 de hoje não atravessam.
- **Relatório 4, "viraram pacientes" = 3, aceito.** Eu tinha esperado 2.
  - O `CONTEXT.md` (§721) define a venda a prazo como um **Recebimento** de `valor = 0` com `valor_aberto > 0`, e a spec diz "≥ 1 recebimento".
  - A regra 4 trata de receita, LTV, meta e caixa, não de contagem de pessoas. A receita das indicadas continua só com `DINHEIRO_QUE_ENTROU`, no período e com o corte de caixa: 140,00. A nota promissória tem `valor > 0` e conta nos dois.
  - Fica declarado que "viraram" (qualquer recebimento vivo) e "compras" do relatório 3 (`valor > 0`) são conjuntos diferentes.
- **Painel × resumo do 13 com o caixa de hoje aberto.** Medido: o Painel, de 01 a 24/10, dá **2.277,77**; o resumo dá 1.500,00.
  - É defeito de regra 6 **no Painel**. A emenda da c.10 libera o dia sem caixa só para o mês **passado**, então o espelhamento não cobre hoje.
  - É a dívida D-I3, que já existia antes do T9. O T9 não a amplia, porque o 13 corta o dia aberto.
  - A D-I3 em `docs/dividas.md` só descreve o dia **passado**. Ela precisa incluir o dia corrente, e o gatilho precisa ser antecipado, porque o Painel fica aberto o dia inteiro na mão da gestora que fecha o caixa.

## Veredito anterior (substituído)

**REPROVADO.** São quatro defeitos, cada um com um número que diverge. As extrações estão corretas.

## Defeitos

**D1. Relatório 13: a coluna `valorFechado` atravessa o dinheiro do dia sem caixa (regra 6, c.10, a mesma porta do N-22).** Teste: `v13-dia-aberto-nao-atravessa-na-linha`.
- Cenário: orçamento de R$ 10.000 registrado e fechado hoje, com entrada de R$ 4.000 no Pix e R$ 6.000 em aberto. O caixa de hoje está aberto.
- Com `de = ate = hoje`, o resumo dá `valorFechado = 0` (correto), mas a linha dá **`valorFechado = "400000"`**.
- `efeitoDoDesfazerOrcamento` não tem corte `caixaFechado`. O ADR usa esse corte para justificar o relatório 4 ("o LTV desde sempre incluiria o dia aberto e furaria a regra 6") e não o aplica aqui.
- Exigido: a linha cujo dinheiro é de dia sem caixa no mês corrente sai `null` (ou como "aguardando"), como no relatório 8.

**D2. Relatório 9 com corte passado perde a dívida estornada depois do corte.** Teste: `v9-corte-passado-divida-estornada-depois-do-corte`.
- Cenário: Carla tinha R$ 50,00 em aberto desde 05/10, estornados em 15/10. Corte em 10/10.
- Esperado: Σ = 60,00 + 300,00 (Ana) + 80,00 (Bruna) + 50,00 (Carla) = **R$ 490,00**, em 3 pacientes e 4 grupos.
- Recebido: **R$ 440,00**, em 2 pacientes e 3 grupos. Faltam R$ 50,00.
- A causa é o pré-filtro `pacientesQuePodemTerSaldo`, que olha o estado de AGORA (`estornado_em IS NULL`). O `saldosDe(…, { ate })` conta esse recebimento, mas a paciente nunca chega até ele.
- O mesmo pré-filtro está em `fotografias.ts` e no KPI `saldo_a_receber`. Recompor um dia perdido depois de um estorno dá outro número, o que fere a c.9 ("o job atrasado dá o mesmo valor").
- Exigido: o pré-filtro recebe `ate` (`recebido_em < ate AND (estornado_em IS NULL OR estornado_em >= ate)`).

**D3. Relatório 13, desvio 3 do ADR: há duas somas com o mesmo nome, e a do resumo não mede o fechamento.** Teste: `v13-c3-mes-passado-fechado`.
- Cenário: o mesmo cartão, movido para 20/10, com o caixa de 20/10 fechado e período de 01/10 a 23/10.
- Resultado: `resumo.valorFechado = 0`, Painel `valorDosOrcamentosPagos = 0` e **Σ da coluna `valorFechado` = 400000**.
- Motivo: o fechamento gravou a entrada na própria tarefa (`tipo = 'Consulta realizada'`). O `orc_valor` só soma tarefas `Pagamento de orçamento`, e essa companheira só nasce quando a consulta já estava paga.
- Para a usuária, a tela diz "Valor fechado: R$ 0,00" acima de uma linha "Valor fechado: R$ 4.000,00".
- O resumo bate com o Painel e com o KPI, então a c.3 está cumprida na letra. Só que a própria c.3 deste gate está incompleta: "dinheiro que entrou em tarefas de pagamento de orçamento" não alcança o fluxo mais comum, que é fechar a partir da consulta sem pagamento prévio.
- Exigido no T9:
  - o resumo e a coluna com nomes e rótulos diferentes, por exemplo "Pagamentos de orçamento no período" e "Entrada do fechamento";
  - nenhum total que a tela possa ler como soma da coluna.
- Para o produto e o T2: o KPI `valor_fechado_em_orcamentos` e o bloco do Painel herdam a lacuna. Ela já existia antes do T9 e vai como achado, sem mudar o número aqui sem ADR.

**D4. Relatório 6: a coluna `receita` traz o dia aberto.** Teste: `v6-dia-aberto-nao-atravessa-na-receita`.
- Cenário: paciente cadastrada hoje paga R$ 77,77 hoje, com o caixa aberto. Com `de = ate = hoje`, a linha dá `receita = "7777"`.
- `LTV_DO_NOVO` não tem corte de caixa. É a fonte do Painel (o `ltvTotal` por origem), mas o relatório passa de "por origem" para **por paciente**.
- A emenda da c.10 só libera o dia sem caixa no mês passado, e este dia é do mês corrente.

## Conferido e certo

- **As extrações preservam o comportamento.** O SQL de `quem-mais-indica`, `JA_ATENDIDO`, `LTV_DO_NOVO`, `historicosDaJanela`, `totaisDosDiasQueContam` e `sessoesDoPrograma` é idêntico ao anterior: o `GROUP BY` ganhou `telefone` (PK já agrupa), e o `LEFT JOIN` em `pacientes` é por PK. As 13 suítes (Painel, quem-mais-indica, pacientes, ficha, indicação, programas leitura/sessões, contas, cobranças, Visão do mês, fonte-única, relatórios T8, validador T8) passam: 292/292.
- **Relatório 9, corte hoje:**
  - Σ = R$ 360,00 = `aReceber` de Cobranças = `aReceber` da Visão do mês;
  - o crédito de R$ 50,00 da Bruna no geral não compensa os R$ 80,00 do programa dela;
  - a sessão paga no modo saldo abate o programa, de R$ 300,00 para R$ 250,00, e não o geral.
- **Relatório 9, borda do corte passado:** o pagamento às 23:30 de 10/10 abate, o das 00:03 de 11/10 não, e a sessão de 20/10 não abate.
- **Relatório 4 (N-19, N-22):**
  - indicadas = 3 = `quemMaisIndica` do Painel, com 12 pagamentos de uma só indicada;
  - receita = R$ 140,00, e os R$ 99,99 de hoje não atravessam;
  - a indicada desativada conta, como no Painel. O desvio 2 do ADR está certo.
- **Relatório 3:** LTV = R$ 250,00 = ficha, contando Pix, nota promissória e venda a prazo, e excluindo o estornado. São 2 compras e ticket de R$ 125,00.
- **Relatório 14:** resumo de 4 faltas, 3 maduras e 1 recontatada. O KPI `faltas_recontatadas` dá `3300` = `valorDaTaxa(1, 3)`, com a falta da paciente desativada nos dois. O desvio 4 do ADR está certo, com nome e id `null`.
- **Relatório 6, mês passado:** Σ `receita` das linhas da origem = `ltvTotal` do Painel = R$ 150,00, com o estorno fora.

## Observações (não reprovam)

- **O1.** *(Resolvido na revalidação: "viraram" = ≥ 1 recebimento vivo de qualquer valor, ADR item 2. Veja o veredito acima.)* No relatório 4, "viraram pacientes" excluía a indicada que só comprou a prazo: Eva, com valor 0 e R$ 300,00 em aberto, dava `viraram = 2`.
- **O2.** No relatório 13, `orcamentos` conta cartões de pacientes ativas com orçamento vivo. `enviados` conta eventos, inclusive de desativadas e de orçamento excluído (o Painel). As duas contagens divergem por construção, e isso está declarado no contrato.
- **O3.** O relatório 2 conta meses (`somarMeses`). O atalho "Sem retorno" da lista de Pacientes conta 182 dias. As duas listas não se comparam.
- **O4.** O relatório 12 só alcança itens ativos (`itensDaAnalise`): a entrada de um item desativado some.
