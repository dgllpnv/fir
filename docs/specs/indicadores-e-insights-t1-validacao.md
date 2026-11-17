# Validação de números do T1: Indicadores & Insights

**Parecer do `validador-numeros`, 2026-11-17**, sobre o T1 ainda não commitado (branch `backlog-final-indicadores-e-acesso`). Escopo: `packages/domain/src/indicadores/*`, `permissoes.ts`, `packages/contracts/src/indicadores.ts`, migrations 0098 e 0099 e `teste/indicadores-no-banco.test.ts`. A referência é o gate [`indicadores-e-insights-gate-numeros.md`](indicadores-e-insights-gate-numeros.md) e o `CLAUDE.md` §2.

## Veredito

**REPROVADO.** Há três defeitos, e cada um tem um teste que falha em `packages/domain/src/indicadores/validacao-numeros.test.ts`. O que o gate pediu ao T1 está certo, com exceção da régua de c.16 (V2).

Execução: `npx vitest run src/indicadores` deu **71 passaram e 6 falharam (77)**. Os 6 que falham são os testes de defeito abaixo. O `teste/indicadores-no-banco.test.ts` rodou contra o Postgres local e passou 13/13.

## Defeitos

**V1. O comparecimento conta o mesmo atendimento duas vezes (I-10). É receita de funil dobrada.**
- `classificarDesfecho` conta `realizado` toda vez que o cartão **entra** na etapa. Duas transições reais fazem o cartão entrar de novo sem um segundo atendimento:
  - `excluirOrcamento`, que vai de `orcamento` para `realizado`;
  - `reabrir` saindo de `orcamento`, que volta para `agendado`, seguido de `concluir`. O "reabrir logo em seguida" não alcança o primeiro `concluir`, porque entre os dois está o `registrarOrcamento`.
- Contraexemplo: agendar, concluir, registrar orçamento e excluir orçamento dá **realizados = 2**. O certo é 1.
- Testes:
  - `comparecimento-excluir-orcamento-nao-conta-segundo-realizado`
  - `comparecimento-reabrir-de-orcamento-e-concluir-conta-um`
- O teste existente em `okr-e-jornada.test.ts` monta `registrarOrcamento` com `etapa: 'realizado'`. Pela tabela de transições, esse evento leva a `orcamento`, e por isso o teste não viu o caso.

**V2. A projeção de `taxa`, `posicao` e `media_mensal` usa uma régua diferente da do ritmo (I-19 × I-21). O cartão se contradiz.**
- O ritmo conta os dias até o **fim** do dia `t`, de forma inclusiva (B2). A projeção usa `diasEntre(início, t)` sobre `diasEntre(início, prazo)`, que é exclusivo.
- Contraexemplo: a meta vai de 50% a 80% em novembro (30 dias). No fim do dia 10, o ritmo é exatamente 60%.
  - Com o atual em 60% (`no_ritmo`), a projeção dá **82,22%**. O certo é 80%.
  - Com o atual em 59,5% (`atencao`), a projeção dá 80,61%, ou seja, "atinge a meta".
- Na `soma` a propriedade já vale.
- Regra: projeção = `partida + (atual − partida) × U ÷ u`, com `u` e `U` contados como na I-19.
- O texto de c.16 no meu gate ("corte = início dá `null`") vinha da régua exclusiva e passa a ser "`u = 0` dá `null`". Se o 1º dia também não deve projetar, isso é regra de produto explícita (`cedo_para_projetar`), não efeito da régua.
- Testes:
  - `projecao-taxa-no-ritmo-projeta-o-alvo`
  - `projecao-taxa-atencao-nao-projeta-meta-atingida`
  - a property "atual = ritmo exato ⇒ projeção = alvo" (contraexemplo mínimo: 3 dias, alvo 3, corte no 2º dia, atual 2 projeta 4)

**V3. `validarMeta` aceita alvo acima do teto do KPI.**
- O teto de 100% das taxas "x de y" está no catálogo (`teto`), mas `KpiParaValidarMeta` não o recebe, e `dentroDoDominio` só olha a escala da unidade.
- Contraexemplo: comparecimento com alvo de 150% é aceito. A meta nunca fica `atingida` e o progresso nunca chega a 100.
- Teste: `validar-meta-recusa-alvo-acima-do-teto`.

## O que foi conferido e está certo

Tudo foi recalculado à mão ou contra um oráculo independente.

| Item | Resultado |
|---|---|
| **B1** | O dia aberto no meio não infla a projeção: 2.000.000 centavos. Property nova: acrescentar dias aguardando não muda ritmo nem projeção, e os decorridos são os úteis de `D` |
| **B2** | 521.739 centavos em 01/12, 12.000.000 em 31/12. Véspera = partida e prazo = alvo |
| **c.7** | 33 de 100 dá `atencao`. Com ritmo 10.000, 9.000 dá `atencao` e 8.999 dá `abaixo`. Property nova contra um oráculo racional próprio, nas 3 agregações e nas 2 direções |
| **c.8** | `|anterior| = min(k, dias do mês anterior)`. 30/03 e 31/03 caem em 28/02 (2027) e em 29/02 (2028) |
| **c.12** | 11/11/10 dá 11. Property nova: `⌊Σ/n + ½⌋` em `bigint` |
| **c.14** | Declarado no catálogo: soma dos saldos positivos, com os negativos à parte. O cálculo é do T2 |
| **c.16** | `fonte_fora_do_dominio` sem `Math.max`. Ver V2 para a régua |
| **B4, parte pura** | `null` é `sem_dado`, nunca `atingida`. `analise` e `media_mensal` recusam recombinar |
| **B6** | Resolvido pelo spec (G1, regime anterior). Não é defeito do T1 |

**Aritmética:**
- Tudo em `bigint`.
- Nenhum `toFixed`, `parseFloat` ou `Math.round(x*100)/100`.
- A escala vem só de `ESCALA_DA_UNIDADE`.
- Somar unidades diferentes lança erro.
- A divisão meio-para-cima está certa também para negativo.

**0098:**
- `bigint` em XOR de coluna.
- `clinica_id NOT NULL`.
- RLS com `FORCE`, `USING` e `WITH CHECK`.
- FK composta.
- `parametros NOT NULL DEFAULT '{}'` (c.13).
- Fotografia append-only, nas duas camadas.

## Para o `engenheiro-qa-automacao`

V1 a V3 viram propriedades permanentes com estes nomes. As três properties novas que passam ficam na suíte:
- `faturamento-conferido-dia-aguardando-nao-mexe-no-ritmo`
- `situacao-oraculo-racional`
- `okr-media-meio-para-cima`
