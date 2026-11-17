# Validação de números: T8 (motor de relatórios) e API do T5

**Parecer do `validador-numeros`, 2026-11-17, sobre o commit `dfa581f`** (branch `backlog-final-indicadores-e-acesso`). Régua: [gate de números](indicadores-e-insights-gate-numeros.md) B8, c.1, c.10 (com a emenda da ADR chaves-em-reais), c.15, e o T8 de [tickets](indicadores-e-insights-tickets.md).

## Veredito

**REPROVADO**, por um defeito na API do T5 (V-T5-1). Os números do **T8 estão certos**: as quatro extrações preservam as telas, e B8, c.10 e c.15 fecham centavo a centavo. Depois de corrigir o V-T5-1, nada mais segura o T8.

## Defeitos

### V-T5-1. A série mede todo balde com a régua da meta de hoje, e diverge da Visão do mês daquele mês

- **Onde:** `IndicadoresService.serie`. Ela chama `reguaDoCartao(..., hoje)` uma vez e usa esse `medidaPor` em todos os baldes. Já a Visão do mês de cada mês usa `metaDoMes(mês)?.medidaPor ?? medidaPadrao`.
- **Contraexemplo, conta feita à mão:**
  - A clínica passou ao MedX em outubro.
  - Setembro tem meta `mes` medida pela FIR, com R$ 100,00 recebidos na FIR e nenhuma leitura do MedX.
  - Outubro tem meta `mes` medida pelo MedX.
  - `GET /v1/visao-do-mes?mes=2026-09` devolve `medido = 10000`.
  - `GET /v1/indicadores/kpis/:id/serie?agrupamento=mes` devolve a barra de setembro com **`null`**.
- **Antes deste commit** a série media tudo pela FIR. Num caso assim, outubro é que divergia. A mudança trocou uma divergência por outra.
- **Regra exigida:** cada balde é medido pela régua do mês a que pertence, `meta daquele mês ?? medidaPadrao`, exatamente como a Visão. O balde semanal que cruza a virada de mês é medido por trecho.
- A comparação com o período anterior no cartão tem a mesma raiz e entra na mesma correção.
- **Teste congelado:** `apps/api/src/relatorios/validador-t8.e2e.test.ts`, caso `DEFEITO serie-mes-passado-regua-do-mes`, marcado como `it.fails`. Ao corrigir, troque por `it`. Ele vai para o `engenheiro-qa-automacao`.

## O que foi conferido e fecha

**Extrações, sem mudança de comportamento.** Conferi o diff linha a linha e rodei as suítes das telas de origem: 22 arquivos e 424 testes da API (Visão do mês, partes, transporte às cegas, estoque, painel geral, pacientes, fonte única, indicadores, OKRs), mais o oráculo do Painel e `painel.e2e` (29) e o domínio inteiro (1.499).
- `RECEBIDOS_DA_JANELA` é o mesmo `WHERE` de antes, trocado como texto.
- `COMPRA_DO_PACIENTE` é o mesmo predicado do LTV.
- `itensDaAnalise` é o mesmo `SELECT`.
- `TAREFAS_DO_CUMPRIMENTO` e `SITUACAO_DO_PRAZO` são as mesmas expressões.
- `recorteDoPeriodo` e `movimentosEntre` só foram movidas.

**B8.**
- No modo análise, Σ das linhas = `saidasEmEstoque`, e a compensação entra como linha negativa.
- Cenário próprio, um ciclo duplo concluir → reabrir → concluir → reabrir com custo de R$ 0,01 por medida e dose de 0,5:
  - quantidades `500, −500, 500, −500`;
  - custos `1, −1, 1, −1`;
  - total 0, e a Análise também dá 0.
- `custoDaQuantidade` arredonda de forma simétrica, meio-para-longe-do-zero, então custo(q) + custo(−q) = 0.
- Sobra de frasco: dose 0,8 + descarte 0,2 = 1 unidade.

**Relatório 8.**
- Setembro: Pix 41,00 + legado sem forma 50,00 + estornado 99,00 dá linhas = total = Visão = **91,00**, com 2 recebimentos.
- Janela de 20/09 a hoje: 25/09 sem caixa conta (mês passado), 07/10 sem caixa aguarda (20,00, sem forma e sem valor), 05/10 fechado conta, e hoje (4,00) não atravessa. O total dá **40,00**.
- Contagem distinta e promissória: as linhas fecham com a Visão, inclusive a promissória (testes do commit).
- Σ partes = valor é garantido pela trigger deferida da 0086.

**Relatório 15.** O resumo é `consultarPrazos.total`, igual a `/v1/painel` `prazos`, e as linhas usam as mesmas expressões.

**Relatório 1.** O LTV usa o mesmo predicado da ficha.

**Régua do cartão, sem meta.** O faturamento usa `medidaPadrao`. Isso é coerente com a Visão do mês, que também mede pelo MedX quando não há meta. O cartão mostra o `medido`, não o `recebido`, que continua sendo FIR nas duas telas.

**`ritmo.percentualDaMeta`, escala e semana.**
- `ritmo.percentualDaMeta` = `percentualInteiro(ritmo exibido, alvo)`.
- A escala é relativa à própria série, e o ponto aguardando fica fora da régua.
- O agrupamento semanal tem 8 pontos.

**Metas recorrentes.** Conferidas nos testes do commit, que passaram:
- rodar três vezes gera uma meta por mês;
- mês civil inteiro;
- partida 0, e partida diferente de zero dá 422;
- a meta arquivada continua como linha, o `ON CONFLICT` impede que renasça, e a série é arquivada junto;
- mês ocupado fica sem a meta da série, sem falhar o job.

## Observações (não bloqueiam)

- `escalaNaSerie` usa valor absoluto. Um KPI que admite negativo desenha −100 e +100 com a mesma altura para quem não tem `valores`. Hoje só `resultado_do_mes` admite negativo, e ele exige `finmes`, que implica `valores`. Precisa revisar antes de existir um KPI manual em reais que admita negativo.
- O `percentualDaMeta` do ritmo parte do ritmo já arredondado. Num KPI de quantidade com alvo pequeno, por exemplo alvo 10 em 23 dias úteis, o tique fica em 0% quando o exato é 4%. É coerente com a c.12 (o que se exibe é o que se compõe), mas convém declarar.

## Evidência

- `vitest run src/relatorios src/indicadores/lacunas-da-tela.e2e.test.ts src/indicadores/validacao-t2-t4.e2e.test.ts`: 4 arquivos, 72 testes, todos passaram.
- Regressões das telas: 22 arquivos, 424 testes. Domínio: 75 arquivos, 1.499 testes. Painel: 29 testes.
- `validador-t8.e2e.test.ts`: 4 de 4. São três contraexemplos que fecham e o V-T5-1 congelado. Numa rodada intermediária o arquivo falhou por um `ReferenceError` da edição paralela do T9 em `consultas.ts`. Rodado de novo sozinho, depois que a árvore se estabilizou, passou.
