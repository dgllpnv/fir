# Gate de números: Indicadores & Insights

**Parecer do `validador-numeros`, 2026-11-17, sobre o spec** [`indicadores-e-insights.md`](indicadores-e-insights.md) e os [tickets](indicadores-e-insights-tickets.md). Fonte: backlog da Marília, Entrega 1 (1.2, 1.4, 1.10). Conferido contra `visao-do-mes.service.ts`, `meta-medida.ts`, `visao-do-mes.ts`, `painel.service.ts`, `recebido-por-dia.ts`, `analise.service.ts`, `estoque-analise.ts`, `valor-da-falta.ts` e as migrations 0009 e 0096.

## Veredito

**APROVADO COM CONDIÇÕES.** O desenho está certo onde mais importa: uma fonte por número, dinheiro em `bigint`, regra 3 preservada (`recebidosDaJanela` traz um item por recebimento), regra 4 preservada e conferência dentro da 0100. Mas há **8 defeitos bloqueantes (B)** em que o número sai errado do jeito que o spec está escrito. Cada um tem um contraexemplo com números redondos, e cada um precisa estar resolvido no spec antes do ticket indicado começar. As condições (C) entram como teste no ticket.

Contas rodadas sobre o domínio atual com vitest no scratchpad:
- `diasUteisAte('2026-12','2026-12-31') = 23`;
- R$ 120.000 ÷ 23 = 521.739 centavos, o que fecha com o "R$ 5.217 por dia útil" do backlog;
- `diasUteisAte('2026-12','2026-12-01') = 1`;
- `visaoDoMes` com 6 caixas (+R$ 50 / −R$ 50 num deles) e 5 dias úteis dá `comDiferenca = 0`, e a fórmula do KPI dá **120%**.

## O que a Visão do mês mede hoje, e o que muda (I-9 / R-2)

**Hoje:**
- `recebido` = Σ `recebidosDaJanela` no mês civil inteiro, no fuso da clínica: dias abertos, dias fechados e **o dia de hoje**.
- `medido` pela régua `fir` = esse mesmo `recebido`.
- `medido` pela régua `medx` = Σ do MedX de 1º até hoje, ou `null` se algum dia não foi lido.
- `percentualDaMeta` = `percentualInteiro(medido, meta)` e `metaRestante` = `max(0, meta − medido)`, iguais em `/v1/visao-do-mes` e em `/v1/metas/:mes/percentual`.
- `porForma` já só alcança dias conferidos.
- Zero na meta faz **`DELETE`**.

**Depois:**

| O que | Como fica |
|---|---|
| `medido` (`fir`) | Só os recebimentos de dias com `caixas_do_dia`. A diferença vira `aguardandoFechamento` |
| `medido` (`medx`) | Só os dias com caixa fechado (B5) |
| `percentualDaMeta`, `metaRestante`, `medido` da rota `/percentual` | Caem pela diferença acima |
| Zero na meta | Passa a arquivar |

**Não mudam:** `recebido` (nas duas rotas), `porForma`, `resultadoDoMes`, despesas, `aReceber` e `caixa`.

**Efeito colateral bom:** hoje o percentual que a equipe lê sobe a cada pagamento do dia aberto. Com a meta conhecida, isso é o total da gaveta em tempo real. A mudança fecha essa porta.

**Efeito ruim:** mês passado com um dia sem fechamento perde esse dia **para sempre**. Isso fere a regra geral "nenhum dado existente é alterado" (ver B6).

## Bloqueantes

**B1. Ritmo e projeção do faturamento dividem números de conjuntos de dias diferentes (I-9, I-19, I-21). Bloqueia o T1.**
- O spec soma todo dia fechado no valor, mas conta dias úteis só até `ateODia`, que é o prefixo.
- Contraexemplo: mês com 20 dias úteis e R$ 1.000 por dia de seg 1 a qui 4. Os dias 1, 2 e 4 estão fechados e o dia 3 está aberto.
  - Pelo spec: valor = 3.000, corte = dia 2, projeção = 3.000 × 20 ÷ 2 = **R$ 30.000**.
  - Certo: **R$ 20.000**.
- A comparação "mesmo dia" ([1, corte]) também mede outro conjunto que o cartão.
- **Regra exigida:**
  - `L` = último dia fechado, e `D` = dias até `L` que não estão aguardando.
  - Valor = Σ dos fechados.
  - Decorridos = dias úteis de `D`.
  - A comparação usa, no mês anterior, os mesmos números de dia de `D`.
- Teste `faturamento-conferido-dia-aberto-no-meio-nao-infla-projecao`: projeção 2.000.000 centavos, ritmo pelos 3 dias úteis.

**B2. As propriedades de I-19 se contradizem.**
- Com dias úteis inclusivos (`diasUteisAte`), `ritmo(01/12) = 120.000 × 1 ÷ 23`, e não a partida 0.
- **Regra exigida:**
  - O ritmo é avaliado no **fim** do dia `t`, sobre `[início, t+1)`.
  - Propriedades: `ritmo(véspera do início) = partida` e `ritmo(prazo) = alvo`.
- Teste `ritmo-dezembro-2026`: em 01/12 dá 521.739 centavos e em 31/12 dá 12.000.000.

**B3. Caixas sem diferença passa de 100% e conta como certo um caixa errado (I-15, R-6). Bloqueia o T2.**
- **Passa de 100%:** `fechados` conta sábado, mas `diasUteis` não. Seg a sáb fechados sem diferença dá **6/5 = 120%** (rodado).
- **Conta errado como certo:** `comDiferenca` olha a soma por caixa. Pix +R$ 50 com Dinheiro −R$ 50 conta "sem diferença", e o `CONTEXT.md` §371 diz o contrário.
- **Regra exigida:**
  - Numerador e denominador sobre o mesmo conjunto de dias: dias úteis até ontem, mais hoje se estiver fechado, mais todo dia não útil com caixa.
  - "Sem diferença" = toda linha de `caixa_por_forma` com `contado = esperado`.
  - A correção é feita na consulta única `caixasDoMes`, para a Visão do mês e o KPI, e o `comDiferenca` da Visão do mês muda com ADR.
- Testes `caixa-sabado-nao-passa-de-100` e `caixa-sobra-e-falta-iguais-tem-diferenca`.

**B4. Perda de estoque não é `soma`, e "sem contagem" vira R$ 0 "Atingida" (I-4, I-7).**
- `analiseDoPeriodo` compara duas **contagens**, e `valorDaFalta` zera a sobra item a item. Por isso a perda de jan+fev ≠ perda(jan) + perda(fev).
- Contraexemplo: ampola de R$ 10, falta de 2 em outubro e sobra de 2 em novembro.
  - Somando os meses: R$ 20.
  - `doPeriodo(01/10, 30/11)`: R$ 0.
- **Regra exigida:**
  - O valor de qualquer janela é `doPeriodo(janela).valorDaFalta`, nunca a soma de baldes. A agregação fica fora do I-4, ou entra uma nova.
  - O gráfico declara que as barras não somam o total.
  - Sem nenhum item com duas contagens na janela, o valor é `null` ("sem contagens"). Não é 0, e o teto não fica `atingida`.
- **Declarar:** o valor usa o custo **atual** e só itens ativos. Editar o custo reescreve o passado; recomendo uma fotografia mensal na virada.
- Testes `perda-nao-soma-por-mes` e `perda-sem-contagem-nao-atinge-teto`.

**B5. Régua MedX dentro do corte. Bloqueia o T2.**
- Definir que o medido pela régua `medx` = `somaDoMedx(lido, dias fechados)`, e que ele é `null` se algum dia de `D` não tiver leitura.
- "Aguardando" usa o mesmo conjunto `semCaixa` da `conferenciaMedx` do Painel: dia com recebimento FIR **ou** faturamento MedX, sem caixa.
- O conjunto é **uma função só** para o Painel, a Visão do mês e o KPI.

**B6. O histórico sem caixa vira zero.**
- A migração da v20 **não cria `caixas_do_dia`** (`migrador.service.ts`). Todo mês anterior à adoção do caixa daria faturamento conferido 0, comparação "novo" e 12 meses de barras vazias.
- **Regra exigida:**
  - Data de início da conferência por clínica (o primeiro `caixas_do_dia`).
  - Dia anterior a ela fica "sem conferência" (`null`, nunca 0) e não entra em "aguardando".
- **Antes do deploy**, rodar em produção, por clínica e mês com meta: o medido antigo contra o novo, a diferença e a quantidade de dias sem caixa. A Marília assina a lista (R-2), e um mês divergente sem ciência dela segura o deploy.

**B7. A conferência da 0100 por quantidade + soma não pega meta trocada de mês (I-26).**
- Contraexemplo: jan = 100 e fev = 200, migrados como jan = 200 e fev = 100. A quantidade (2) e a soma (300) batem.
- **Regra exigida:** igualdade linha a linha por `(clinica_id, competencia, valor, medida_por, definida_por, definida_em)`, com `EXCEPT` nos dois sentidos vazio, além da quantidade e da soma por clínica.
- Teste: a fixture com dois meses trocados aborta.

**B8. Relatório 11 não pode "bater com a Análise" como está escrito (H.3). Bloqueia o T8.**
- A Análise não tem custo de saídas: ela devolve `saidasEmEstoque` em quantidade, entre a contagem inicial e a final, e não no mês civil.
- **Regra exigida:**
  - Modo "período da análise" com o mesmo recorte (`entreGrupos`, por índice).
  - Por item, Σ quantidade das linhas = `saidasEmEstoque`, com as compensações de reabertura em linha negativa ou somadas.
  - Custo por linha arredondado meio-para-cima como em `valorDaFalta`, e o total é a soma das linhas.
- Teste: uma sessão concluída, reaberta e concluída de novo soma a saída uma vez. Item sem aproveitamento de sobra dá dose + descarte = 1 unidade.

## Condições (testáveis)

1. **Fonte única** (T2). Para cada uma das 20 chaves, um teste HTTP de igualdade com a tela de origem na mesma janela:
   - Conversão, inclusive o `Math.min(100, …)` do Painel. Extrair `conversaoDeOrcamentos(enviados, fechados)` para o domínio; reaplicar o clamp no KPI seria uma segunda regra.
   - Ticket médio, novos pacientes, valor fechado e no prazo = `GET /v1/painel`.
   - Resultado, a receber e caixas = `/v1/visao-do-mes`.
   - Perda = Análise.
   - Atingimento = Metas do mês.
2. **Duas receitas, declaradas.** O ticket médio (Painel) conta pela **conclusão da tarefa**, e o faturamento (Visão do mês) pelo `recebido_em`. Nenhum teste nem tela pode afirmar `ticket × n = faturamento`. O Manual diz isso.
3. **Valor fechado em orçamentos** = `orc_valor` do Painel: o dinheiro que entrou em tarefas de pagamento de orçamento, e **nunca** `valorOrcamento` (regra 4).
   - O relatório 13 usa a mesma definição para "valor fechado".
   - Nenhum OKR, total ou meta soma esse KPI com o faturamento: ele é subconjunto da receita, e somar dobraria.
4. **Resultado do mês** só aceita meta de mês civil inteiro, porque `visao()` não recebe janela.
   - A comparação "mesmo dia do mês anterior" desse KPI precisa de uma fonte com janela, ou sai rotulada "mês inteiro".
   - Hoje compararia o mês pela metade com o anterior inteiro, que é justamente o que a Firmare vetou em 15/11.
5. **Despesas fixas sobre o recebido** é razão nova: `percentualInteiro(fixas, recebido)`, com o `recebido` da Visão do mês sem outras entradas. A Visão do mês mostra fixas ÷ **despesas**, e o rótulo não pode sugerir que é o mesmo número.
6. **Atingimento das metas individuais** é média de percentuais e contradiz o "taxa, nunca média" do I-4. Declarar a agregação `media_mensal`, só mensal, sem recombinar meses.
7. **Situação por multiplicação cruzada, sem ritmo arredondado.**
   - Atenção ⇔ `10·(atual−ritmo)·sinal ≥ −|ritmo−partida|`, com o ritmo exato `alvo·u/U`.
   - Teste: alvo 100 centavos, 3 dias úteis, 1 decorrido, atual 33 ⇒ `atencao`, não `no_ritmo`.
   - Teste: ritmo 10.000 com atual 9.000 ⇒ `atencao`, e com 8.999 ⇒ `abaixo`.
8. **`janelaComparavel`.** A propriedade correta é `dias(anterior) = min(dias(atual), dias do mês anterior)`. "Igual ou um a menos" é falsa: 31/03 contra fevereiro tem 3 dias a menos. Casos: 30/03 e 31/03 → 28/02 (2027) e 29/02 (2028).
9. **Fotografia por instante, não pela hora em que o job roda** (I-6).
   - A posição do dia D é calculada em `início(D+1)` no fuso da clínica: `saldosDe` com `ate` (adiantar do T9 para o T2) e o saldo de estoque derivado até o instante.
   - Rejeito a "imprecisão declarada" de 00:00–00:05: com o worker atrasado ela vira um dia inteiro, e `REVOKE UPDATE` a congela.
   - Dia perdido se recompõe idempotente.
   - Teste: um pagamento às 00:03 de D+1 fica fora da fotografia de D, e o job rodado às 15:00 dá o mesmo valor.
10. **Regra 6 em toda série de dinheiro**, não só no faturamento.
    - Ponto diário de ticket médio, valor fechado ou receita de campanha em dia sem caixa vai com `aberto: true`, sem `emDinheiro` e sem `escala`.
    - A composição "por forma" alcança só dias fechados.
    - O relatório 8 tem `forma: null` em dia aberto, também nos totais.
    - `aguardandoFechamento` sai como um total só, nunca por dia nem por forma.
    - Teste de transporte: com o caixa de hoje aberto, nenhuma resposta de `/v1/indicadores*` nem de `/v1/relatorios*` permite reconstruir o esperado por forma de hoje.
11. **Redação.**
    - **(a)** `percentualDaMeta` é inteiro (`percentualInteiro`), como na rota `/percentual`. Com a meta de R$ 120.000 conhecida, 78% já situa o medido em [93.000, 94.200).
    - **(b)** Percentual cujo numerador ou denominador é dinheiro (despesas fixas ÷ recebido) é **monetário para a redação**. Medido: meta conhecida × 78% × fixas 40% dá as fixas, que incluem a categoria "Pessoal" (salários), em [R$ 36.735, R$ 38.151). E o alvo desse KPI fica visível, então `percentualDaMeta × alvo` devolve o atual exato. Sem `valores`, esse KPI não atravessa, ou só atravessa a situação.
    - **(c)** Relatório 3 (maior LTV) e toda ordenação do servidor por coluna em reais exigem `valores`. O ranking é o valor em ordem.
    - **(d)** `aguardandoFechamento` em `/v1/metas/:mes/percentual` sai `null` para a equipe, com prova por mutação.
12. **OKR.** O progresso é a média, meio-para-cima, dos **progressos inteiros exibidos** dos KRs. Assim quem soma a tela chega ao número. Contraexemplo: 10,5 / 10,5 / 10,4 exibidos como 11 / 11 / 10 dão 11, e a média exata daria 10.
13. **Migração 0100.**
    - `parametros NOT NULL DEFAULT '{}'`: com `NULL`, o `UNIQUE` do catálogo aceita duplicata.
    - A Visão do mês lê só o KPI com `parametros = '{}'` e filtra `arquivada_em IS NULL`.
    - `PUT /v1/metas/:mes` sobre uma meta `ate_data` que se sobrepõe ao mês: `409`/`422` com mensagem, nunca 500 do `EXCLUDE`.
    - Rodar a 0100 numa cópia do banco de produção e anexar ao T2 a contagem por clínica dos dois lados.
14. **Banco de horas.** Declarar se o valor é líquido. Uma equipe com +20 h e −20 h dá 0 "atingida". Recomendo Σ dos saldos positivos, com o negativo à parte.
15. **Relatório 8.** "N recebimentos" no resumo = `count(DISTINCT r.id)` com `r.valor > 0`, não o número de linhas (uma por parte). Σ linhas = `recebido` da Visão do mês, centavo a centavo, inclusive a nota promissória, que é receita fora da gaveta.
16. **Projeção** de `taxa`/`posicao` com `corte = início` dá `null`, nunca divisão por zero. A extrapolação é limitada ao domínio da unidade, sem `Math.max` escondendo valor negativo de fonte (incidente).

Os contraexemplos de B1 a B8 e das condições 7, 9 e 12 vão para o `engenheiro-qa-automacao` com estes nomes, como propriedades permanentes da suíte.
