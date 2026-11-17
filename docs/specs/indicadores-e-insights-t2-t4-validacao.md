# Validação de números: T2 (revalidação), T3 e T4

**Parecer do `validador-numeros`, 2026-11-17**, sobre o commit `01eafb1` (branch `backlog-final-indicadores-e-acesso`). Ele vem depois do [REPROVADO do T2](indicadores-e-insights-t2-validacao.md). Referências: o [gate](indicadores-e-insights-gate-numeros.md), a ADR [chaves-em-reais-e-os-dias-de-caixa](../adr/2026-11-17-chaves-em-reais-e-os-dias-de-caixa.md), a ADR [meta-medida-pelos-dias-de-caixa](../adr/2026-11-17-meta-medida-pelos-dias-de-caixa.md) e o `CLAUDE.md` §2.

## Veredito

**REPROVADO.** W1 a W5 estão corrigidos, e T4 está certo nos números. O bloqueio vem de **um defeito no T3 (X1)**: a troca de unidade concorrente com um lançamento. O número fica gravado na coluna errada e some da calculadora. Há também uma condição de coerência na ADR (C1), que precisa ser emendada antes do deploy.

Execução contra o Postgres local:

| Arquivo | Resultado |
|---|---|
| `validacao-t2`, `fonte-unica`, `okrs`, `lancamentos` (e2e) | **53/53** |
| Domínio `src/indicadores` | **96/96** |
| `validacao-t2-t4.e2e.test.ts` (novo, deste parecer) | **7 passaram, 1 falhou**: o X1. Rodado sozinho, falha de novo. É determinístico, porque a intercalação é forçada por lock |

## Defeitos

**X1. A troca de unidade de KPI manual com lançamento concorrente grava o número na coluna da unidade antiga (T3, regras 8 e 10).**
- **Onde:**
  - `indicadores.service.ts:391-394` (`editarKpi`) lê o KPI sem `FOR UPDATE`.
  - `exigirTrocaDeUnidade` (`:519-532`) confere se existe lançamento com um `SELECT`, e o `UPDATE kpis SET unidade` vem depois.
  - `lancar` (`lancamentos.service.ts:91-93`) trava o KPI `FOR UPDATE`, mas a edição só esbarra nessa trava no `UPDATE`, depois de já ter conferido.
  - Não há guarda no banco: nem trigger, nem `CHECK` entre `kpis.unidade` e `lancamentos_de_kpi.valor_*`.
- **Contraexemplo:** um KPI em `quantidade`. Um lançamento segura a linha e grava `valor_numero = 1200` (12 pacientes). Ao mesmo tempo, a gestora troca a unidade para `reais`.
  - A edição responde **200**, e o KPI fica em `reais`.
  - O lançamento continua `valor_numero = 1200, valor_centavos = NULL`.
  - `numeroDe('reais', NULL, '1200')` dá `null`: os 12 pacientes somem do cartão e da meta.
  - `numeroDaLinha` usa `?? '0'`, então o "anterior" da próxima correção mostra **R$ 0,00**.
- **Regra exigida:**
  - `editarKpi` lê o KPI `FOR UPDATE` antes de `exigirTrocaDeUnidade`, ou a troca de unidade passa a ser um `UPDATE … WHERE NOT EXISTS (lançamento ou meta)` com 409 quando `rowCount = 0`;
  - e, como segunda camada, uma trigger em `lancamentos_de_kpi` que recusa a coluna incoerente com `kpis.unidade`.
- **Teste:** `DEFEITO X1 troca-de-unidade-concorrente`, em `apps/api/src/indicadores/validacao-t2-t4.e2e.test.ts`.

## Condição (não é divergência de número, mas segura o deploy)

**C1. A ADR fecha o W4 só no mês corrente, e o gate c.10 não tem essa exceção.**
- **Onde:** `diasQueContamNasTelas`, `faturamento-conferido.ts:204`. Pela regra `dia < inicioDoMesCorrente ⇒ conta`, o dia de mês passado conta sempre.
- **O problema:** `caixa.service.ts:104` aceita fechar **qualquer** dia passado, então um dia de setembro sem caixa ainda vai à gaveta às cegas.
- **Medido:** com `conferencia_desde` = 01/09 e o 30/09 sem caixa, um pagamento de orçamento de 777,77 em 30/09 aparece no ponto diário de `valor_fechado_em_orcamentos`. Ele aparece **também no `/v1/painel` de 30/09**: o KPI é igual à tela, e a fonte única está cumprida.
- **Conclusão:** o KPI não abre porta nova. A porta já existe no Painel, e a ADR a herdou sem declarar.
- **O caso mais provável:** no dia 1º, o último dia do mês anterior ainda sem caixa.
- **Exigido:**
  - a ADR diz explicitamente que **emenda o c.10** para dias de mês passado;
  - a frase "Assim fecha o W4" ganha a ressalva;
  - o Painel por janela de dia sem caixa vira dívida em `docs/dividas.md`, com gatilho.
- **Alternativa:** bloquear o fechamento às cegas de dia de mês já fechado. Isso é decisão do `product-rotina-clinica`.
- **Fora isso, a ADR é coerente com `meta-medida-pelos-dias-de-caixa`:** `faturamento_conferido` e a meta seguem a I-9 em todo período, e a lista "não mudam: `resultadoDoMes`" foi respeitada.

## Os quatro pontos pedidos

1. **W1 a W5 estão corrigidos.**
   - `validacao-t2.e2e.test.ts` passou 6/6.
   - O arquivo entrou no repositório **pela primeira vez neste commit**: não havia versão anterior no `git log -p` para comparar.
   - Conferi linha a linha contra os contraexemplos do parecer anterior: os valores e as asserções são os meus, sem afrouxamento.
   - Sobre o W2: a asserção aceita `null`, e `so_mes_civil_inteiro` é a regra que eu mesmo exigi.
2. **`fonte-unica.e2e.test.ts`.**
   - As 13 comparações são por HTTP contra a rota da própria tela: `/v1/painel`, `/v1/visao-do-mes`, `/v1/campanhas`, `/v1/estoque`, `/v1/metas-de-pessoa`, `/v1/fichas/horas`, `/v1/conversas`.
   - Cinco delas recompõem a razão a partir dos componentes que a tela mostra: prazos, fixas ÷ recebido, caixas, 1:1 e média das metas. Aceito, porque a tela mostra os componentes e a razão do KPI é declarada nova (c.5).
   - **Fraqueza:** de 16 a 23/10 não há movimento. Por isso a soma "trecho a trecho" de `ticket_medio`, `valor_fechado` e campanha não é exercitada. O código soma numerador e denominador (`somarTotais`) e está certo por leitura.
   - Para o `engenheiro-qa-automacao`: um recebimento em 20/10 na fixture.
   - **As 4 chaves sem tela:**
     - `comparecimento` e `faltas_recontatadas` têm a regra no domínio (`jornada.ts`, testada). O SQL de `historicosDaJanela` não tem teste, e aceito por ora.
     - `pacientes_recaptados` e `rotinas_cumpridas` **não tinham teste nenhum**. Escrevi dois, com o resultado calculado à mão, e os dois passaram: recaptados 1 (198 dias sim, 100 não, sem anterior não conta, dois atendimentos contam uma vez) e rotinas 50% (cancelada e sem marcador fora, prazo fora do mês fora).
     - Eles ficam como propriedade permanente.
3. **T4.**
   - O progresso é a média, meio para cima, dos inteiros exibidos (`okr-e-jornada.test`: 11/11/10 → 11).
   - A situação é a pior; `sem_dado` só vale sozinha.
   - O KR invisível (C5) fica fora da média.
   - A meta do KR passa por `metaNaSaida`, a mesma do cartão.
   - **Duplicar:** na `soma`, a partida é **0**, medido com faturamento de R$ 500 no mês. Em posição/taxa, a partida é o valor de hoje (30,00 no e2e).
   - **Sem `valores`:** alvo 123456, partida 11111 e atual 77777 de um KR manual em reais não aparecem na lista nem no detalhe da `juliana`. A escrita é 403.
4. **T3.**
   - Um lançamento de R$ 123,45 grava `valor_centavos = 12345` (`bigint`) e `valor_numero NULL`, e o cartão mostra `12345`. Doze pacientes viram `1200` e aparecem como `1200`.
   - Sem `valores`, o número não atravessa.
   - A troca de unidade depois de existir dado dá **409** no caminho sequencial (e2e) e **falha no concorrente**: é o X1.

## Observações (não bloqueiam)

- **O1.** `LancarKpi.valor` aceita só `^\d{1,15}$`. Um KPI manual em reais que admite negativo (resultado, saldo) não tem como ser lançado. Decidir no spec se o domínio manual admite negativo.
- **O2.** `totaisDePacientes` corta pela data de `concluida_em` da tarefa, e o caixa é por dia de recebimento. Uma tarefa concluída em 14/10, com pagamento registrado em 15/10 (dia aberto), entra no KPI. O caso é raro, mas é uma segunda régua de dia. Herdado do Painel.
- **O2 do parecer anterior** segue de pé: o ensaio da 0100 numa cópia de produção e a lista assinada da Marília.

## Para o `engenheiro-qa-automacao`

`apps/api/src/indicadores/validacao-t2-t4.e2e.test.ts`, com 8 casos:

- `X1` é o defeito;
- `lancamento-reais-em-centavos`, `lancamento-quantidade-em-centesimos`, `okr-reais-sem-valores`, `okr-duplicar-soma-partida-zero`, `pacientes_recaptados` e `rotinas_cumpridas` viram propriedades permanentes;
- o caso C1 só registra o que sai. Ele vira asserção quando a decisão da C1 for tomada.
