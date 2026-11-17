# Validação de números do T2: Indicadores & Insights

**Parecer do `validador-numeros`, 2026-11-17**, sobre o commit `c96006b` (branch `backlog-final-indicadores-e-acesso`). Escopo: `apps/api/src/indicadores/{fontes,indicadores.service}.ts`, `financeiro/faturamento-conferido.ts`, `financeiro/visao-do-mes.service.ts`, `metas/metas.repositorio.ts`, `packages/domain/src/financeiro/caixas-sem-diferenca.ts`, migration 0100. Referências: o [gate](indicadores-e-insights-gate-numeros.md), a [validação do T1](indicadores-e-insights-t1-validacao.md) e o `CLAUDE.md` §2.

## Veredito

**REPROVADO.** Há quatro defeitos e uma divergência de fonte única, e cada um tem um teste que falha em `apps/api/src/indicadores/validacao-t2.e2e.test.ts`. A execução contra o Postgres local deu **5 falharam e 1 passou (6)**: o que passou é o `W2` na versão do mês corrente, e ele foi refeito para o mês passado, onde falha.

**V1 a V3 do T1 estão corrigidos.** `npx vitest run src/indicadores` no domínio deu 77/77, com `validacao-numeros.test.ts` 9/9 e sem nenhuma asserção alterada. A suíte do domínio financeiro deu 141/141. `indicadores.e2e` e `visao-do-mes.e2e` deram 43/43.

## Defeitos

**W1. A comparação com o mês anterior usa o prefixo até hoje, e não `D` (gate B1, I-28).**
- Onde: `indicadores.service.ts:576`, `janelaComparavel(diasDe(de, ate < hoje ? ate : hoje), …)`.
- A docstring da própria `janelaComparavel` diz "o `D` da I-9, nunca o prefixo".
- Contraexemplo: R$ 1.000 em cada dia, de 01 a 24/09 e de 01 a 23/10. Hoje é 24/10, com o caixa aberto.
  - O atual é R$ 23.000, certo.
  - O anterior sai **R$ 24.000**, e o certo é R$ 23.000. A variação sai −4%, e a certa é **0%**.
- O mesmo viés atinge toda chave que corta em ontem (`ateQueConta`): `ticket_medio` e `valor_fechado_em_orcamentos`.
- Teste: `comparacao-faturamento-usa-D`.

**W2. As chaves mensais ignoram o início do período: cada balde vale o mês inteiro.**
- Onde: `fontes.ts:99`, `mes = fim.slice(0, 7)`. Atinge `resultado_do_mes`, `despesas_fixas_sobre_recebido`, `atingimento_metas_individuais`, `saldo_banco_de_horas` e `conversas_1a1_em_dia`.
- A série de um mês é agrupada por dia (`agrupamentoPara`), e cada dia chama `visao()` do mês inteiro.
- Contraexemplo: R$ 1.000 recebidos em 05/09, série de 01 a 03/09.
  - Saem 3 barras de R$ 1.000, com `barrasSomamOTotal: true`. A soma é **R$ 3.000** num mês que teve R$ 1.000.
- `listar` com uma janela de dois meses também mede só o último.
- No mês corrente o defeito fica escondido de outro jeito: todo ponto diário sai "aguardando", porque o hoje aberto entra em `diasAguardandoSemHoje` de todos os dias.
- **Regra exigida:** chave `somenteMesCivil` agrupa por `mes`, e janela que não é um mês civil inteiro dá `422` ou `null`.
- Teste: `serie-resultado-do-mes-por-dia-nao-repete-o-mes`.

**W3. `resultado_de_campanha` ignora a janela e o caixa de hoje (I-7, regra 6).** O construtor admitiu só a segunda metade.
- Onde: `fontes.ts:175-183`. `CampanhasService.noPeriodo` filtra **campanhas** pela sobreposição de datas, mas o resultado é o total da campanha de todos os tempos (`campanhas.service.ts:885-935`, sem filtro de data).
- Contraexemplo 1: R$ 1.000 da campanha em 05/10, série de 01 a 03/10.
  - Sai `['100000', '100000', '100000']`. O certo é `['0', '0', '0']`.
  - A meta `soma` mede também o que entrou antes do início dela.
- Contraexemplo 2: com o caixa de hoje aberto, um pagamento de R$ 777,77 da campanha hoje aparece em `/v1/indicadores` como `"emDinheiro":"77777"`. Isso é o total da gaveta de hoje atravessando.
- `noPeriodo` também abre uma conexão nova (`naClinica`), fora da transação da calculadora.
- Testes: `campanha-serie-por-dia` e `campanha-regra-6-hoje`.

**W4. Dia passado sem caixa, depois de `conferencia_desde`, atravessa em reais (gate c.10).**
- `ateQueConta` (`fontes.ts:220-229`) corta só **hoje**. Ontem sem caixa ainda pode ser fechado às cegas (`caixa.service.ts:104` aceita dia passado).
- Contraexemplo: `conferencia_desde` = 01/10, caixa fechado em 22/10 e não em 23/10. Um pagamento de orçamento de R$ 777,77 em 23/10.
  - A série de `valor_fechado_em_orcamentos` de 23/10 sai `diaAguardando: false` com `"emDinheiro":"77777"`.
  - O `faturamento_conferido` do mesmo dia diz "aguardando".
- O mesmo vale para `ticket_medio` e para `resultado_de_campanha`.
- Teste: `valor-fechado-dia-passado-aberto`.

**W5. Divergência de fonte única: `resultado_do_mes` de mês passado ≠ Visão do mês (gate c.1, spec I-9 "não mudam: `resultadoDoMes`").**
- Onde: `fontes.ts:109`, com `visaoNaConexao(…, true)` filtrando o recebido pelos dias que contam.
- Contraexemplo: `conferencia_desde` = 01/09, caixa fechado só em 10/09. R$ 500 entram em 10/09 e R$ 1.000 em 15/09.
  - A Visão do mês de setembro mostra resultado **R$ 1.500**. O KPI mostra **R$ 500**, para sempre.
- O mesmo vale para `despesas_fixas_sobre_recebido`, cujo denominador é o recebido.
- Isto entra em tensão com o W4. **A decisão tem que ser uma regra só para toda chave em reais.** Recomendo:
  - período passado = o número da tela;
  - período corrente = cortado nos dias que contam, como já é feito com hoje.
- Se a escolha for outra, ela vira ADR e emenda o catálogo, que hoje diz "fonte `visao().resultadoDoMes`".
- Teste: `resultado-mes-passado-igual-a-tela`.

## Os desvios admitidos, avaliados

| Desvio | Avaliação |
|---|---|
| `resultado_de_campanha` sem o corte da regra 6 | **Bloqueante, e é maior do que o declarado** (W3): também não tem janela |
| `contarNovosPacientes` copia o `WHERE` do Painel (`fontes.ts:254` × `painel.service.ts:883-884`) | Hoje os dois são idênticos: cadastro em `[de, ate)`, `ativo`, mesmo rótulo de origem. **Não bloqueia em número**, mas fere "mover, nunca copiar". Condição: extrair a função ou fazer o teste de igualdade HTTP com `/v1/painel` |
| Testes de fonte única faltando para 16 chaves | **Bloqueante.** O gate c.1 exige um teste por chave. W1 e W5 são justamente as divergências que esses testes pegariam. Hoje só `faturamento_conferido`, `saldo_a_receber`, `resultado_do_mes` (no caso sem dia aberto) e `perda_de_estoque` têm teste |

## O que foi conferido e está certo

| Item | Resultado |
|---|---|
| **Regra 3** | `recebidosDaJanela` dá um item por recebimento, e o corte é por dia no fuso da clínica (`janela(de, ate, fuso)` semiaberta). `valor_fechado` soma `r.valor`, nunca `valor_orcamento` (regra 4, c.3) |
| **G1 / B6** | Antes de `conferencia_desde` conta todo o recebido, menos hoje (`regimeDoDia`), e a mudança está declarada. A trigger da 0100 preenche no primeiro fechamento |
| **B5** | `recorteDeCaixa` é uma função só para o Painel, a Visão do mês e o KPI. Pela régua MedX, o medido é `null` se algum dia de `D` não foi lido |
| **B3 / I-15** | `caixasSemDiferenca` usa o mesmo conjunto no numerador e no denominador, nunca passa de 100% e considera "sem diferença" só quando toda forma bate. A Visão do mês e o KPI leem a mesma `caixasDoPeriodo`, e o ADR existe |
| **B7 / 0100** | `EXCEPT ALL` nos dois sentidos, mais quantidade e soma por clínica. O teste com os meses trocados aborta (passou). As colunas em centavos são `bigint`. O `PUT` antigo falha alto. O 409 sobre `ate_data` está coberto |
| **Ritmo, projeção e situação** | A régua do domínio é a do T1, validada: dias úteis, B1, B2, c.7, c.8, 29, 30 e 31 em fevereiro e o primeiro dia |

## Observações (não bloqueiam; resolver no spec)

- **O1.** `caixas_sem_diferenca` de um mês anterior à adoção do caixa dá **0%**, e não "sem dado". O mês da adoção conta como falta a primeira metade. O número bate com a tela, mas o espírito do B6 pede `null` antes de `conferencia_desde`.
- **O2.** O ensaio da 0100 numa cópia de produção (c.13) e a lista do script de comparação assinada pela Marília (B6, R-2) não têm evidência anexada. **O deploy segura até as duas existirem.**

## Para o `engenheiro-qa-automacao`

W1 a W5 viram propriedades permanentes com os nomes acima. Somam-se a elas os 16 testes de fonte única que faltam do c.1, cada um com um dia aberto no meio e um mês passado na fixture.
