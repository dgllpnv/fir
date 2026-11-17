# As chaves em reais e os dias de caixa: a tela no mês passado, os dias que contam no mês corrente

**Status:** aceita, 2026-11-17. **Complementa** [meta-medida-pelos-dias-de-caixa](2026-11-17-meta-medida-pelos-dias-de-caixa.md). **Origem:** [validação de números do T2](../specs/indicadores-e-insights-t2-validacao.md), W4 e W5.

## Contexto

A validação do T2 achou duas falhas que puxam para lados opostos:

- **W4.** No mês corrente, um dia passado sem caixa ainda pode ser fechado às cegas (`caixa.service` aceita dia passado). Mesmo assim, `valor_fechado_em_orcamentos`, `ticket_medio` e `resultado_de_campanha` entregavam o valor desse dia.
- **W5.** Com o filtro dos dias de caixa, `resultado_do_mes` de setembro dava R$ 500, e a Visão do mês de setembro mostra R$ 1.500. O dia sem caixa ficava "aguardando" para sempre.

Uma regra que só olha o caixa resolve o W4 e quebra o W5. Uma regra que só olha a tela resolve o W5 e quebra o W4.

## Decisão

São duas regras, e cada chave segue uma delas em todo período.

1. **`faturamento_conferido` e a meta dele** seguem a I-9 em todo período, passado ou corrente. É a [ADR anterior](2026-11-17-meta-medida-pelos-dias-de-caixa.md), sem mudança: conta o dia anterior a `conferencia_desde` e, a partir dela, só o dia com caixa fechado.
2. **As outras chaves em reais**, e as que dependem do recebido, espelham uma tela. São `resultado_do_mes`, `despesas_fixas_sobre_recebido`, `ticket_medio`, `valor_fechado_em_orcamentos` e `resultado_de_campanha`. Elas seguem uma regra **por dia**, e por isso aditiva:
   - **O dia de um mês passado conta sempre.** O KPI dá o número que a tela daquele mês mostra (fonte única, c.1). Assim fecha o W5.
   - **O dia do mês corrente segue a I-9.** A partir de `conferencia_desde`, o dia sem caixa fica aguardando: sai `diaAguardando` na série, entra no contador e fica sem valor. Hoje sem caixa nunca conta (regra 6). Assim fecha o W4.
   - A função é uma só, `diasQueContamNasTelas` em `financeiro/faturamento-conferido.ts`. A fonte de janela (os totais do Painel, a consulta das Campanhas) mede cada trecho contínuo dos dias que contam, e os trechos somam.
   - `resultado_do_mes` e `despesas_fixas_sobre_recebido` usam `visaoNaConexao`, a função da tela:
     - para mês passado, sem filtro;
     - para o mês corrente, com `soDiasQueContam`, que é a mesma regra por dia.
3. **`saldo_a_receber` e `perda_de_estoque` não dependem do caixa.** São posição e análise, e dão sempre o número da tela.

**Esta ADR EMENDA a condição c.10 do [gate de números](../specs/indicadores-e-insights-gate-numeros.md).** A c.10 manda que todo ponto diário em dia sem caixa saia aguardando, sem exceção. Pela emenda, isso vale para o mês corrente. No mês passado, o dia sem caixa mostra o valor, por dois motivos:

- o KPI tem de ser igual à tela (c.1);
- o mesmo buraco já existe hoje em `/v1/painel`, que mostra o dinheiro de um dia passado sem caixa e que nunca foi conferido às cegas.

O KPI não abre uma porta nova. O buraco é a dívida [D-I3](../dividas.md), a ser paga na tela e no KPI juntos.

**Por que a fronteira é o mês corrente.** O mês passado já foi fechado na Visão do mês, e o número dele é o que a gestora viu. Mostrar outro no KPI seria a segunda régua que o c.1 proíbe. O dia aberto do mês corrente é o que ainda vai à gaveta às cegas. É nele que o total do dia pode atravessar.

## Consequências

- **O KPI do mês corrente pode ficar abaixo da tela.** A Visão do mês corrente mostra o recebido de todos os dias, inclusive o de hoje: é a dívida D-I2. O KPI não mostra o dia aberto. A diferença é exatamente o valor dos dias aguardando, e o teste `fonte-unica.e2e.test.ts` prova isso por HTTP.
- **A série diária do mês corrente** mostra o dia aberto como "aguardando", sem valor. Os dias de meses passados mostram o valor da tela.
- **As chaves só de mês civil** são `resultado_do_mes`, `despesas_fixas_sobre_recebido`, `atingimento_metas_individuais`, `saldo_banco_de_horas` e `conversas_1a1_em_dia`, com `somenteMesCivil` no catálogo. Elas agrupam a série por mês. Uma janela que não é uma sequência de meses civis inteiros dá `null` com o motivo `so_mes_civil_inteiro`: o mês corrente pode ir só até hoje. Nunca sai o mês inteiro repetido em cada barra (W2).
  - Vários meses combinam assim:
    - `resultado_do_mes` soma;
    - `despesas_fixas_sobre_recebido` é a razão das somas;
    - `saldo_banco_de_horas` usa a última posição.
  - A média mensal e o 1:1 são de um mês por vez: com mais de um mês, saem com o motivo `um_mes_por_vez`.
- **`caixas_sem_diferenca`** antes de `conferencia_desde`, ou sem ela, dá `null` com o motivo `antes_do_primeiro_caixa`, nunca 0%. O mês da adoção segue a tela.
- **A comparação com o período anterior (W1)** usa os dias que contaram, `D`:
  - a chave de soma mede trecho a trecho só os dias comparáveis;
  - a chave só de mês civil compara com os meses inteiros imediatamente anteriores.
