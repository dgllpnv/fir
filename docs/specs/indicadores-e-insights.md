# Spec — Indicadores & Insights (OKR, KPI e relatórios)

**Status:** revisada pelo gate de risco em 2026-11-17. Os três pareceres aprovaram com condições:
- números: 8 bloqueantes e 16 condições;
- appsec: 30 condições, 6 delas bloqueantes;
- LGPD: 18 condições.

Todas estão incorporadas abaixo, no lugar que afetam, com a sigla do parecer: *(números B1)*, *(números c.1)*, *(appsec C1)*, *(LGPD L-IN-1)*. **Esta spec é o que vale, e implementá-la não exige reler os pareceres.** O índice final, "Condições dos gates", mapeia cada id para o ticket e o teste.

**Origem:** backlog da Marília, "FIR Clinic · Backlog final", Entrega 1 (15/11/2026), seções 1.1–1.10. **A seção 1.9 é a referência de tela** e vale sobre o resto do texto. O protótipo clicável que o backlog cita não está acessível (R-1).
**Pareceres:**
- [`-gate-numeros.md`](indicadores-e-insights-gate-numeros.md)
- [`-gate-appsec.md`](indicadores-e-insights-gate-appsec.md)
- [`-gate-lgpd.md`](indicadores-e-insights-gate-lgpd.md)

**Tickets:** [`indicadores-e-insights-tickets.md`](indicadores-e-insights-tickets.md).

## Problema

Hoje a clínica tem três lugares de meta que não se conversam: a meta de faturamento na Visão do mês, as metas individuais em Equipe e a meta de cada campanha. Não acompanha no tempo o que o sistema não calcula (NPS, avaliações). E, para tirar uma lista de pacientes para uma campanha, exporta de um lugar e importa em outro.

A entrega cria a aba **Indicadores & Insights**:
- **OKRs:** objetivos com resultados-chave.
- **KPIs:** automáticos e manuais, com meta, ritmo, projeção e gráfico.
- **Relatórios:** 15, com filtro, tabela, exportação e "Criar campanha com esta lista".

**Regra da PO que define a arquitetura:** os números reaproveitam os cálculos que o servidor já faz. Nenhuma regra é recalculada em paralelo. Se o Painel e o Indicadores mostram o mesmo número, ele sai da mesma função.

## Decisões do coordenador sobre os pareceres (17/11)

Tomadas pela regra do dono: o documento da PO primeiro, depois o recomendado.

- **G1 (números B6). Início da conferência por clínica.** Coluna `clinicas.conferencia_desde date`.
  - Clínicas existentes: a 0100 preenche com o dia do **primeiro** `caixas_do_dia` de cada uma.
  - Clínica sem caixa nenhum: `NULL`, e o primeiro fechamento de caixa preenche a coluna na mesma transação.
  - **Dia anterior a `conferencia_desde` (ou qualquer dia, com `NULL`) mantém a medida ATUAL** da meta da Visão do mês: tudo o que foi recebido. Nada que existe muda (regra geral da PO).
  - **A partir de `conferencia_desde`**, a meta e o KPI "Faturamento conferido" contam só dias com caixa fechado.
  - Exceção para os dois regimes: **o dia de hoje sem caixa fechado nunca conta**. Ver I-9 e a regra 6.
  - Antes do deploy, um script do T2 compara, por clínica e mês com meta, o medido antigo com o novo. **A saída fica fora do repositório.**
- **G2 (números B3). `caixasDoMes` é corrigido**, com ADR, porque muda um número da Visão do mês. É correção de defeito:
  - "sem diferença" = toda linha zero;
  - só entram dias úteis (mais os dias não úteis com caixa);
  - o resultado nunca passa de 100%.
- **G3 (appsec C18).** `xlsx` 0.18.5 sai. Entra o tarball oficial SheetJS 0.20.3, fixado por `integrity`. **Ticket próprio, T0, antes do T8.**
- **G4 (appsec C15).** A execução de relatório é `POST`, e os filtros nunca vão na URL.
- **G5 (LGPD L-IN-9).** `pacientes_da_exportacao` (só ids), append-only, entra na migration 0101.
- **G6.** Em todo o resto, vale a forma que o parecer exige.

## Fronteiras e seams

**Seams novos: zero.** Os de sempre bastam: HTTP da API, `packages/domain` puro e repositórios sobre Postgres real.

### Grafo de módulos (`apps/api`), acíclico

```
hoje        → (nada novo: a tela chama /v1/indicadores/da-semana em paralelo)
indicadores → metas · financeiro · painel-geral (funções) · estoque · pessoas · campanhas · tarefas
relatorios  → campanhas · financeiro · pacientes · estoque · programas · tarefas
financeiro  → metas
carteira    → indicadores        (job de agregados da Firmare, T10)
metas       → banco
```

- **`metas`:** só a persistência de `metas_de_kpi`. Existe para cortar o ciclo `financeiro ↔ indicadores`.
- **`CalculadoraDeKpi`** (`apps/api/src/indicadores/calculadora-de-kpi.ts`): o módulo profundo da entrega.
  - `medir(c, ctx, kpi, janelas[]) → Medida[]` e `composicao(c, ctx, kpi, janela) → LinhaDeComposicao[]`.
  - Uma fonte interna por chave do catálogo, chamando a função que já existe.
  - **É também o ponto único do filtro `permissaoDoValor`** *(appsec C5)*: KPI cuja permissão falta à pessoa não sai da calculadora nem da listagem, e nenhuma rota repete o filtro.
- **`MotorDeRelatorios`** (`apps/api/src/relatorios/motor.ts`): `executar(c, ctx, chave, filtros, opcoes) → ResultadoDoRelatorio`.
  - Os 15 relatórios são consultas atrás dele.
  - O catálogo (filtros, colunas, tipo, classe) mora em `packages/contracts`.
- **Regra nova vai para `packages/domain/src/indicadores/`.** O front não calcula nada. **Formatar é do front:** a frase da prévia D.3 é montada na tela a partir de `ValorNaTela` *(appsec C8)*.

### Funções extraídas (mover, não copiar)

Cada extração muda só o lugar do código, nunca o número. A suíte atual do Painel e da Visão do mês passa sem alteração de asserção. A exceção são as asserções que mudam de propósito, com ADR (I-9, I-15).

| KPI | Origem | Vira |
|---|---|---|
| Ticket médio | `PainelService.pacientes()` | `receitaEPagamentos(c, clinicaId, janela)` (`painel-geral/metricas-diarias.ts`) |
| Valor fechado em orçamentos | `PainelService.pacientes()` (`orc_valor`) | `valorDosOrcamentosPagos(c, clinicaId, janela)` |
| Conversão de orçamentos | o `Math.min(100, …)` do Painel | `conversaoDeOrcamentos(enviados, fechados)` **no domínio**, usada pelo Painel e pelo KPI *(números c.1)* |
| Novos pacientes | `PainelService.novosPacientes` | `contarNovosPacientes(c, clinicaId, janela, origem?)` |
| Itens abaixo do mínimo | `itens.service.ts` `paraSaida` | `contarAbaixoDoMinimo(c, ctx, instante)` (saldo derivado até o instante, *números c.9*) |
| Atingimento das metas individuais | `pessoas/metas.service.ts` | `mediaDaEquipeNoMes(c, ctx, mes)` |
| Resultado de campanha | `CampanhasService` | `resultadoDaCampanha(c, ctx, campanhaId)` |
| Saldo a receber na data | `saldosDe` | `saldosDe(…, { ate })`; sem `ate` = agora, mesmo resultado *(números c.9)* |
| Dias aguardando fechamento | `conferenciaMedx` (`semCaixa`) | `diasSemCaixa(c, clinicaId, janela, fuso)`: **uma função** para o Painel, a Visão do mês e o KPI *(números B5)* |
| Caixas sem diferença | `caixasDoMes` | corrigida e única (I-15) |

Reutilizáveis como estão:
- `recebidosDaJanela`;
- `contarConversaoDeOrcamentos`;
- `consultarPrazos`;
- `VisaoDoMesService.visao`;
- `AnaliseService.doPeriodo`;
- `faturamentoLidoDoMedx`;
- `medidoParaAMeta`.

## Decisões (I-n)

### Catálogo e números

- **I-1. Nome no código: `Kpi`.** "Indicador" sozinho já tem dois donos: o `Indicador da carteira` e os `INDICADORES` das metas de pessoa.
  - Tabelas: `kpis`, `lancamentos_de_kpi`, `metas_de_kpi`, `series_de_meta`, `okrs`, `resultados_chave`, `fotografias_de_kpi`, `relatorios_favoritos`, `pacientes_da_exportacao`.
  - Prefixo de rota: `/v1/indicadores`.
- **I-2. Escala por unidade** (`ESCALA_DA_UNIDADE`, no domínio, regra 9).

  | Unidade | Escala |
  |---|---|
  | `reais` | centavos (`Dinheiro`) |
  | `percentual`, `quantidade`, `dias` | centésimos |
  | `nota` | centésimos, 0–1000 |
  | `horas` | minutos (só o KPI de banco de horas) |

  - Colunas `*_centavos` XOR `*_numero`, com `CHECK`.
  - Comparar ou somar unidades diferentes lança erro.
- **I-3. Percentual automático com a precisão do Painel.** `percentualInteiro` × 100.
- **I-4. Agregação**, declarada no catálogo. É ela que dá o valor de um período arbitrário.

  | Agregação | Valor do período | Recombina baldes? |
  |---|---|---|
  | `soma` | Σ dos eventos em `[início, fim)` | sim |
  | `taxa` | Σ numerador ÷ Σ denominador | sim, pelos termos |
  | `posicao` | o valor no **instante** `início(fim)` | não |
  | `analise` *(números B4)* | `AnaliseService.doPeriodo(janela).valorTotalDaFalta`, para a janela inteira | **nunca** |
  | `media_mensal` *(números c.6)* | média dos percentuais das fichas no mês (`mediaDeAtingimento`) | **nunca**: só mensal, sem somar meses |

  No modo `analise`, o gráfico declara: "cada barra é um mês; as barras não somam o total do período".
- **I-5. KPI manual é sempre `posicao`.** O valor é o último lançamento com referência dentro do período. Fluxo ("leads do mês") se registra num KPI mensal, com o total do mês.
- **I-6. Posição passada vem de `fotografias_de_kpi`, calculada no instante e não na hora do job** *(números c.9)*.
  - A posição do dia D é o valor em `início(D+1)`, no fuso da clínica:
    - saldo a receber por `saldosDe(…, { ate })`;
    - itens abaixo do mínimo por saldo de estoque derivado até o instante.
  - O job pode rodar a qualquer hora e dá o mesmo valor.
  - Dia perdido (worker parado) se recompõe na próxima rodada, idempotente: `INSERT … ON CONFLICT DO NOTHING`, porque a tabela só aceita `INSERT` *(appsec C25)*.
  - O histórico começa no deploy. Antes disso, "sem dado", nunca zero.
- **I-7. Catálogo:** `packages/domain/src/indicadores/catalogo.ts`, 20 chaves.
  - Cada chave declara: pilar, unidade, direção, agregação, frequências, `porUnidade`, parâmetros (schema Zod `.strict()` por chave, *appsec C6*), rótulo da fonte, permissão da composição e **`permissaoDoValor`** *(appsec C5; números c.11b)*.

  | Chave | Pilar | Un. | Dir. | Agr. | Freq. | Fonte | `permissaoDoValor` |
  |---|---|---|---|---|---|---|---|
  | `faturamento_conferido` | Financeiro | reais | maior | soma | sem, mês | I-9 | — |
  | `resultado_do_mes` | Financeiro | reais | maior | soma | **só mês civil** *(c.4)* | `visao().resultadoDoMes` | — |
  | `ticket_medio` | Financeiro | reais | maior | taxa | sem, mês | `receitaEPagamentos` | — |
  | `despesas_fixas_sobre_recebido` | Financeiro | percentual | menor | taxa | mês | `percentualInteiro(fixas, recebido)` *(c.5)* | **`valores`** *(c.11b)* |
  | `saldo_a_receber` | Financeiro | reais | menor | posicao | sem, mês | `saldosDe` | — |
  | `caixas_sem_diferenca` | Financeiro | percentual | maior | taxa | sem, mês | I-15 | — |
  | `novos_pacientes` | Comercial | quantidade | maior | soma | sem, mês | `contarNovosPacientes` (`origem` opcional) | — |
  | `conversao_de_orcamentos` | Comercial | percentual | maior | taxa | sem, mês | `contarConversaoDeOrcamentos` + `conversaoDeOrcamentos` | — |
  | `valor_fechado_em_orcamentos` | Comercial | reais | maior | soma | sem, mês | `valorDosOrcamentosPagos` (= `orc_valor`) *(c.3)* | — |
  | `comparecimento` | Comercial | percentual | maior | taxa | sem, mês | I-10 | — |
  | `faltas_recontatadas` | Comercial | percentual | maior | taxa | sem, mês | I-11 | — |
  | `pacientes_recaptados` | Comercial | quantidade | maior | soma | sem, mês | I-12 | — |
  | `resultado_de_campanha` | Comercial | a da métrica | maior | soma | mês | `resultadoDaCampanha` (`campanhaId`) | — |
  | `tarefas_no_prazo` | Processos | percentual | maior | taxa | sem, mês | `consultarPrazos().total.taxaNoPrazo` | — |
  | `rotinas_cumpridas` | Processos | percentual | maior | taxa | sem, mês | I-13 | — |
  | `perda_de_estoque` | Processos | reais | menor | **analise** *(B4)* | mês | `doPeriodo` | — |
  | `itens_abaixo_do_minimo` | Processos | quantidade | menor | posicao | sem, mês | `contarAbaixoDoMinimo` | — |
  | `atingimento_metas_individuais` | Pessoas | percentual | maior | **media_mensal** *(c.6)* | mês | `mediaDaEquipeNoMes` | **`pessoas.gerir`** *(C5)* |
  | `saldo_banco_de_horas` | Pessoas | horas | menor | posicao | mês | Σ dos saldos **positivos** das fichas ativas; os negativos vão à parte, na composição *(c.14)* | **`pessoas.gerir`** *(C5)* |
  | `conversas_1a1_em_dia` | Pessoas | percentual | maior | taxa | mês | I-14 | **`pessoas.gerir`** *(C5)* |

  - **Sem a `permissaoDoValor`, o KPI não existe na resposta:** lista, detalhe, série, `da-semana`, `reuniao`, `contador`, catálogo e carteira *(appsec C5)*. O motivo: numa clínica de uma ou duas fichas, o agregado de RH é o dado de uma pessoa. E a razão "despesas fixas ÷ recebido", com o alvo visível, devolve o valor absoluto *(números c.11b)*.
  - Unicidade:
    - KPI de catálogo é único por `(clínica, chave, parametros)` entre os vivos;
    - `parametros jsonb NOT NULL DEFAULT '{}'` *(números c.13)*: com `NULL`, o `UNIQUE` aceita duplicata.
  - Declarações:
    - **Duas receitas** *(números c.2)*. O ticket médio (Painel) conta pela conclusão da tarefa; o faturamento (Visão do mês), pelo `recebido_em`. Nenhum teste nem tela afirma `ticket × n = faturamento`, e o Manual diz isso.
    - **`valor_fechado_em_orcamentos`** é subconjunto da receita. Nenhum total, OKR ou meta o soma com o faturamento *(números c.3)*.
    - **`despesas_fixas_sobre_recebido`** tem rótulo próprio. A Visão do mês mostra fixas ÷ **despesas**; aqui é fixas ÷ **recebido** (sem outras entradas), e a dica diz isso *(números c.5)*.
    - **`perda_de_estoque`** usa o custo **atual** do item e só itens ativos. Editar o custo reescreve o passado (dívida em `docs/dividas.md`, gatilho: primeira reclamação de número de perda que mudou). Sem nenhum item com duas contagens na janela, o valor é `null` ("sem contagens"), nunca 0, e o teto não fica `atingida` *(números B4)*.
- **I-8. A régua do MedX não ganha chave nova.** `faturamento_conferido` mede pela régua da meta (`medida_por`) através de `medidoParaAMeta`. Vale dentro do corte da I-9 *(números B5)*.

### Os cálculos novos

- **I-9. Faturamento conferido.**
  - **Regime do dia** *(G1, números B6)*. Para cada dia civil `d` da clínica:
    - `d < conferencia_desde` (ou coluna `NULL`) e `d ≠ hoje`: **regime anterior**, conta todo o recebido. É a medida atual da Visão do mês;
    - `d ≥ conferencia_desde` com `caixas_do_dia`: conta;
    - `d ≥ conferencia_desde` sem caixa: **aguardando**;
    - **hoje sem caixa fechado:** aguardando, nos dois regimes (regra 6). É a única mudança em clínica sem caixa: o percentual deixa de subir a cada pagamento do dia aberto, o que hoje entrega o total da gaveta em tempo real *(números, seção "o que muda")*.
  - **Valor** = Σ dos recebimentos (`recebidosDaJanela`, `DINHEIRO_QUE_ENTROU`, um item por recebimento) dos dias que contam.
  - **Aguardando** = um total só (`aguardandoFechamento`) e `diasAguardando`. **Nunca por dia nem por forma** *(números c.10)*.
  - **Corte para ritmo e projeção** *(números B1)*:
    - `L` = o último dia que conta;
    - `D` = os dias `≤ L` que **não** estão aguardando;
    - **decorridos = dias úteis de `D`**, nunca o prefixo até o primeiro dia aberto. Dia aberto no meio não infla a projeção.
  - **Régua MedX** *(números B5)*:
    - medido = `somaDoMedx(lido, D)`;
    - é `null` se algum dia de `D` não tiver leitura;
    - "aguardando" usa `diasSemCaixa`: dia com recebimento FIR **ou** faturamento MedX, sem caixa. É a mesma função do `conferenciaMedx` do Painel.
  - **A meta da Visão do mês mede assim** (ADR "meta medida pelos dias de caixa fechado"). Mudam só o medido, o `percentual` e a `metaRestante` dos dias a partir de `conferencia_desde`. **Não mudam:** `recebido`, `porForma`, `resultadoDoMes`, despesas, `aReceber`. O zero passa a arquivar.
  - **Regra 6 em todo campo** *(appsec C11)*. `percentualDaMeta`, `escala`, `variacao`, `situacao`, `projecao` e o contador são calculados só sobre os dias que contam. Com o caixa de hoje aberto, mudar um recebimento de hoje não muda **nenhum byte** de `/v1/indicadores*`.
  - **Medir antes do T2:** se a Visão do mês já mostra o total de hoje a quem tem `finmes`. Se mostrar, vai para `docs/dividas.md` com o validador, e esta entrega não amplia a exposição *(appsec C11)*.
- **I-10. Comparecimento = realizados ÷ (realizados + faltas).**
  - Realizados: eventos com `etapa = 'realizado'`. Faltas: `acao = 'noshow'`. A desmarcação não é falta.
  - Data: `ev.em`, janela semiaberta.
  - Evento desfeito por `reabrir` logo depois não conta.
  - Função pura: `classificarDesfecho`.
- **I-11. Faltas recontatadas em até 2 dias = recontatadas ÷ faltas maduras.**
  - Falta: `noshow` ou `desmarcar`.
  - Recontato: o primeiro `reagendar` vindo de `faltou`/`desmarcou`. É a definição do dono, a mesma de `contarFaltasRecontatadas`.
  - Prazo: dia do reagendamento `≤` dia da falta `+ 2`, no fuso da clínica.
  - Falta madura: `dia + 2 < hoje`. As outras aparecem como "N aguardando o prazo".
- **I-12. Pacientes recaptados (`soma`).** Paciente distinta com atendimento (tarefa concluída de `TIPOS_QUE_ATENDEM`, paciente ativo) no período, cujo atendimento anterior foi `≥ 182` dias antes.
  - `DIAS_SEM_RETORNO` vai para o domínio.
  - Quem não tem atendimento anterior não conta.
  - ADR substitui em parte a 0014.
- **I-13. Rotinas cumpridas.**
  - Previstas: tarefas vivas com `serie_id IS NOT NULL OR marcador IS NOT NULL`, fora de `TIPOS_DE_SESSAO`, não canceladas, com prazo em `[início, min(fim, hoje+1))`.
  - Cumpridas: as previstas com status `concluida`.
- **I-14. Conversas 1:1 em dia.** Fichas ativas com `conversas_1a1.mes = M` ÷ fichas ativas no fim de M. Função pura: `umAUmEmDia`.
- **I-15. Caixas sem diferença, corrigida** *(G2, números B3)*. A consulta é única (`caixasDoMes`), usada pela Visão do mês e pelo KPI.
  - **Conjunto de dias, igual no numerador e no denominador:** dias úteis até ontem, mais hoje se fechado, mais todo dia não útil com caixa.
  - **"Sem diferença":** toda linha de `caixa_por_forma` com `contado = esperado`, como no `CONTEXT.md`.
  - O `comDiferenca` da Visão do mês muda, com ADR. O resultado nunca passa de 100%.

### Meta, ritmo, situação e projeção (puros, `domain/indicadores/meta.ts`)

- **I-16. Janela da meta.** As datas civis guardam o que a pessoa vê (o prazo é inclusivo). Toda conta passa por `janelaDaMeta(início, prazo) = [início, prazo + 1)`.
  - **Corte:**
    - `faturamento_conferido`: `D`/`L` (I-9);
    - outras `soma`: hoje;
    - depois do prazo: o prazo, e a meta congela.
- **I-17. Partida.** `soma`: sempre 0, travada no formulário. `taxa`, `posicao` e `media_mensal`: o valor no início, pré-preenchido e editável.
- **I-18. Medido pela meta.**
  - `soma`: o total em `[início, corte]`.
  - As outras: o valor do período corrente da frequência, que é o mesmo do cartão.
- **I-19. Ritmo esperado**, avaliado **no fim do dia `t`**, sobre `[início, t+1)` *(números B2)*.
  - `soma`: `alvo × u ÷ U`, com `u = úteis(início..t)` e `U = úteis(início..prazo)`. É a régua do `diasUteisAte`, de segunda a sexta, sem feriado.
  - Outras agregações: `partida + (alvo − partida) × dias(início..t) ÷ dias(início..prazo)`.
  - Arredondamento só na exibição. As comparações usam o ritmo **exato**, como fração (I-20).
  - **Propriedades:**
    - `ritmo(véspera do início) = partida`;
    - `ritmo(prazo) = alvo`;
    - o ritmo é monótono;
    - fica entre os extremos.
  - Teste `ritmo-dezembro-2026`: R$ 120.000, `U = 23`.
    - Em 01/12, o ritmo é 521.739 centavos (`12.000.000 × 1 ÷ 23`, meio-para-cima, na exibição).
    - Em 31/12, é 12.000.000.
- **I-20. Situação, por multiplicação cruzada e sem ritmo arredondado** *(números c.7)*.
  - Com `ritmo = alvo·u/U` (soma), `sinal = ±1` e `avanço = |ritmo − partida|`.
  - Para `soma` com partida 0:
    - `no_ritmo` ⇔ `sinal·(atual·U − alvo·u) ≥ 0`;
    - `atencao` ⇔ `10·sinal·(atual·U − alvo·u) ≥ −alvo·u`;
    - senão `abaixo`.
  - As outras agregações usam a mesma forma, com denominadores de dias corridos.
  - Prazo vencido sem atingir: `abaixo`.
  - **Atingida:**
    - maior melhor: `atual ≥ alvo`;
    - menor melhor, `posicao`/`taxa`: `atual ≤ alvo`;
    - teto (`soma` ou `analise` com menor melhor): só depois do prazo, e com valor **não nulo** *(B4)*.
  - **Testes:**
    - alvo 100 centavos, `U = 3`, `u = 1`, atual 33 → `atencao` (e não `no_ritmo`);
    - ritmo 10.000 e atual 9.000 → `atencao`;
    - atual 8.999 → `abaixo`;
    - NPS de 60 para 70 com atual 60 e ritmo 65 → `abaixo`.
- **I-21. Projeção.**
  - `soma`: `atual × U ÷ úteis(D)` (I-9) *(números B1)*. Teste `faturamento-conferido-dia-aberto-no-meio-nao-infla-projecao`: mês de 20 úteis, R$ 1.000/dia nos dias 1, 2 e 4 fechados e o 3 aberto → projeção 2.000.000 centavos.
  - `taxa`/`posicao`: extrapolação linear, limitada ao domínio da unidade.
    - Com `corte = início`, a projeção é `null`, nunca divisão por zero.
    - **Valor de fonte fora do domínio** (negativo onde não cabe) não é escondido por `Math.max`: o servidor registra incidente e devolve `null` com `motivo` *(números c.16)*.
  - `percentualDaMeta` é **inteiro**, de `percentualInteiro`, como a rota `/percentual` *(números c.11a)*.
- **I-22. Progresso** = `(atual − partida) ÷ (alvo − partida)`, pela direção, **inteiro**, de 0 a 100.
  - No teto: `100 × fração de tempo × min(1, ritmo ÷ atual)`.
  - Alvo pior que a partida → `422`.
- **I-23. Prévia D.3**, `GET /v1/indicadores/metas/previa`, **sem frase pronta** *(appsec C8)*.
  - Devolve números estruturados: `ritmoPorDiaUtil: ValorNaTela`, `atualPorDiaUtil: ValorNaTela`, `prazo`.
  - A tela monta "Para chegar a R$ 120.000 em 31/12, o ritmo esperado é de R$ 5.217 por dia útil…" com o formatador central.
  - Sem `valores`, os `emDinheiro` saem `null` e a frase sai sem o trecho em reais.

### Tipos de meta e o lugar único no banco

- **I-24. Tipos:** `mes`, `ate_data`, `recorrente`.
  - Recorrente é uma `Série` (`series_de_meta`), que materializa a meta do mês corrente e do próximo, idempotente por `UNIQUE (serie_id, inicio)`.
  - **`resultado_do_mes` só aceita meta de mês civil inteiro** (`mes` ou `recorrente`) *(números c.4)*.
- **I-25. Uma meta viva por KPI e contexto**, com `EXCLUDE USING gist (kpi_id WITH =, coalesce(resultado_chave_id, '00000000-…') WITH =, daterange(inicio, prazo, '[]') WITH &&) WHERE (arquivada_em IS NULL)`. Usa `btree_gist`, que a 0018 já tem.
- **I-26. `metas_do_mes` migra para `metas_de_kpi`** (0100, T2).
  1. Para cada clínica com meta: cria o KPI `faturamento_conferido` (`parametros = '{}'`), mensal. O responsável é o `definida_por` da meta mais recente, **conferido como pessoa da mesma clínica** *(appsec C25)*; sem pessoa válida, fica sem responsável.
  2. Copia cada linha como meta `mes`, com `origem_migracao = metas_do_mes.id` (`UNIQUE`).
  3. **Conferência** *(números B7)*, num bloco `DO` com `RAISE`:
     - quantidade e `sum(valor)` por clínica;
     - **igualdade linha a linha** por `(clinica_id, competencia, valor, medida_por, definida_por, definida_em)`, com `EXCEPT` vazio **nos dois sentidos** entre `metas_do_mes` e a projeção de `metas_de_kpi` migradas;
     - a fixture com jan e fev trocados aborta.
  4. `ALTER TABLE clinicas ADD conferencia_desde date`, preenchida com `min(caixas_do_dia.dia)` por clínica *(G1)*.
  5. `REVOKE INSERT, UPDATE, DELETE ON metas_do_mes FROM fir_app`. A tabela congela; o `DROP` fica para uma migration futura. **O `PUT` antigo falha alto**, e o teste prova *(appsec C25)*.

  Na Visão do mês:
  - `metaDe` e `salvarMeta` usam o módulo `metas` e leem **só** o KPI com `parametros = '{}'` e `arquivada_em IS NULL` *(números c.13)*;
  - `PUT /v1/metas/:mes` sobre um mês coberto por meta `ate_data` sobreposta → `409` com mensagem ("Este mês está dentro da meta '…' até DD/MM; edite-a em Indicadores"), nunca `500` do `EXCLUDE` *(números c.13)*;
  - zero arquiva.

  Rejeitado:
  - **View com `INSTEAD OF`:** daria duas escritas do mesmo fato, e o *contract* nunca chegaria.
  - **Deixar `metas_do_mes` como armazém da meta de faturamento:** seriam duas tabelas de meta.

  **Ensaio:** rodar a 0100 numa cópia do banco de produção e anexar ao T2 a contagem por clínica dos dois lados (só contagens e somas, sem PII) *(números c.13)*.
- **I-27. A meta de campanha e as metas individuais não migram.** O KPI as lê. KR de campanha usa o alvo da campanha, travado.

### Comparação e séries

- **I-28. "Mesmo dia do período anterior."**
  - **Mensal:** os mesmos **números de dia** de `D` no mês anterior *(números B1)*, até o limite do mês anterior.
    - **Propriedade:** `dias(anterior) = min(dias(atual), dias do mês anterior)` *(números c.8)*.
    - Casos: 30/03 e 31/03 → 28/02 (2027) e 29/02 (2028).
  - **Semanal:** até o mesmo dia da semana anterior.
  - **`posicao`:** fotografia do mesmo dia.
  - **`resultado_do_mes`:** compara só mês fechado com mês fechado, rotulado "mês inteiro". Mês corrente: "comparação no fim do mês" *(números c.4)*.
  - **Formato:** `percentual` em p.p. e as outras unidades em variação relativa; anterior zero → "novo".
- **I-29. Agrupamento** (`agrupamentoPara`, puro).

  | Janela | Agrupamento |
  |---|---|
  | mais de um mês civil | `mes` |
  | dentro do mês, KPI semanal | `semana` |
  | dentro do mês, os outros | `dia` |

  - "Período da meta" de um mês, `soma`: linha acumulada com as quatro linhas.
  - "Personalizado" dentro do mês, `soma`: barras por dia e a linha do ritmo por dia útil.
  - 3 e 12 meses: barras para KPI mensal (o corrente `parcial`) e linha para KPI semanal.
  - Sem meta: os últimos 3 meses mais `avisoSemMeta`.
  - Minigráfico: 8 semanas ou 6 meses.
  - Data futura, ou De depois de Até → `422`.
  - **Regra 6 em toda série de dinheiro** *(números c.10; appsec C11)*. Ponto diário de **qualquer** KPI em reais (faturamento, ticket médio, valor fechado, receita de campanha) em dia aguardando vai com `aberto: true`, **sem `emDinheiro` e sem `escala`**. A tela desenha uma barra clara de altura fixa, "aguardando fechamento". A composição "por forma" alcança só dias que contam.

### Lançamentos manuais e tarefas

- **I-30. Referência e tarefa.**
  - Semanal: a referência é a segunda; o dia escolhido vai de 1 a 7.
  - Mensal: a referência é o dia 1º; o dia escolhido vai de 1 a 31, e o dia que não existe no mês cai no último dia (regra 25).
  - Funções puras: `referenciaPendente` e `prazoDoLancamento`.
  - A tarefa leva `marcador = 'lancamento-kpi:<kpiId>'` e `kpi_id`. O job gera para a frente a partir de `tarefas_geradas_ate` (hoje + 35 dias) e **nunca regera para trás**.
  - Trocar o responsável reatribui as tarefas abertas futuras. Arquivar cancela as abertas futuras.
  - **Só o servidor cria esse marcador.** `POST /v1/tarefas` com marcador de prefixo `lancamento-kpi:` → `422` *(appsec C27)*.
- **I-31. Lançar:** `PUT /v1/indicadores/kpis/:id/lancamentos/:referencia`, idempotente por `(kpi_id, referencia)`. Relançar corrige, e a trilha registra.
  - Na mesma transação, conclui a tarefa da referência.
  - Referência futura → `422`.
  - **Condições** *(appsec C1)*:
    - só KPI **manual** (de catálogo → `422`), **vivo** (arquivado → `409`) e **da clínica** (outra → `404`, por RLS);
    - `pessoaId` vem da sessão;
    - `responsavel_id` é lido **na mesma transação** que grava.
  - **A exceção da responsável não abre leitura nenhuma** *(appsec C2)*:
    - os dados da janela D.4 (nome, unidade, "como medir", referência, prazo) chegam pela tarefa (`TarefaNaLista.lancamentoDeKpi`), nunca por `GET /v1/indicadores*`;
    - nenhuma rota de leitura usa `podeLancar`;
    - a resposta do `PUT` traz **só o lançamento** (schema fechado): sem meta, série, situação, composição nem `percentualDaMeta`;
    - o valor anterior em reais, mostrado para correção, sai redigido sem `valores`.
  - `comentario` (280) e `como_medir` (140) levam o aviso fixo "não escreva nome de paciente" e **nunca vão para log** *(LGPD R-e; appsec C29)*.

### Permissões e redação

- **I-32. Chaves, permissões e matriz.**
  - **Chaves:** `indicadores` e `indicadores.gerir` (dependência: `indicadores`).
  - **`temPerm` não é transitivo.** Teste de arquitetura: nenhuma chave de `PERMS` depende de outra que tenha dependência própria. Se um dia depender, `temPerm` passa a resolver a cadeia, e o teste cobra *(appsec C4)*.
  - **Valores obrigatórios para escrever em reais:** o predicado `exigeValoresParaEscrever(unidade)`, no domínio, é chamado por **toda** rota que grava alvo ou partida *(appsec C3)*. São elas:
    - meta e série;
    - prévia;
    - KR de OKR (criar, editar e duplicar);
    - `PUT` de KPI manual que muda a unidade para `reais`.
  - **`podeLancar`** (I-31) fica ao lado de `temPerm`.
  - **Plano de ação:** exige `indicadores`, mais a `permissaoDoValor` do KPI quando houver *(appsec C27)*.
  - **Composição**, com a permissão própria:

    | Composição | Permissão |
    |---|---|
    | Recebimentos | `finmes` |
    | Novos pacientes por origem | `pacientes` |
    | Comparecimento, faltas recontatadas, recaptados | **`jornada`** *(LGPD L-IN-3)* |
    | Por pessoa | `tarefas.equipe` |
    | RH | `pessoas.gerir` |
    | Estoque | `estoque.gerir` |

    - A rota do detalhe que devolve linha de paciente é `@DadoSensivel('pacientes', { lista: true })` *(LGPD L-IN-3)*.
    - Sem a permissão, o bloco mostra "Sem acesso ao detalhe".
  - **Matriz de acesso:** toda rota nova entra em `teste/registro.ts` com a permissão mínima. A rota de lançamento entra como exceção nomeada *(appsec C4)*.
  - **Ids:** todo id vindo do cliente é conferido contra a clínica: `parametros` (`campanhaId`), `responsavelId`, `kpiId`, `okrId`, `serieId` e o filtro `responsavel`. Id de outra clínica → `422`/`404`, nunca `500` *(appsec C6)*.
- **I-33. Perfis.** `perfisPadrao()` dá as duas chaves a `pf_sup`. A 0099 as dá a todo perfil existente com `painel` (molde da 0075).
- **I-34. Redação num ponto só.**
  - `ValorNaTela = { unidade, emDinheiro, emNumero, percentualDaMeta, escala }`.
  - **Só se constrói pela função do domínio `valorNaTela(numero, meta?, serie?)`**, com XOR por unidade: em `reais`, `emNumero` é **sempre** `null` *(appsec C7)*.
  - `emDinheiro` entra em `CAMPOS_MONETARIOS`.
  - **Sem `valores`, sobram:**
    - `percentualDaMeta` (inteiro);
    - `escala`, relativa **à série do próprio KPI**, nunca a outro KPI *(appsec C10)*;
    - a variação.
  - **Nenhuma resposta sem `valores` traz a razão e o absoluto do mesmo par** *(appsec C10)*.
  - **Residual aceito**, registrado na ADR do T1: quem conhece um absoluto deduz o alvo pelo `percentualDaMeta`.
  - **Nenhum campo string carrega dinheiro formatado** *(appsec C8)*. Valem para rótulos, a capa do Modo reunião, o resumo de relatório, o cabeçalho de exportação e os "filtros em texto".
- **I-35. Os nomes de dinheiro desta entrega em `CAMPOS_MONETARIOS`:**

  | Nome | Onde | Ticket |
  |---|---|---|
  | `emDinheiro` | `ValorNaTela` | T1 |
  | `aguardandoFechamento` | `/v1/metas/:mes/percentual` e Visão do mês, como centavos em texto. Prova por mutação de que sai `null` para a equipe *(números c.11d)* | T2 |
  | `valorDaUltimaCompra` | relatório 1 | T8 |
  | `receitaDasIndicadas` | relatório 4 | T9 |
  | `valorMinimo`, `valorMaximo` | filtros com dinheiro: a lista de favoritos sai redigida *(appsec C9)* | T8 |

### Relatórios

- **I-36. O motor roda no servidor, por `POST`** *(G4; appsec C15)*.
  - `POST /v1/relatorios/:chave/execucoes { filtros }` → `{ cabecalho, colunas, linhas, resumo, truncado }`, até 10.000 linhas.
  - A tela ordena e pagina (50 por página).
  - **Nenhum filtro na URL.** O log da API e do Traefik não grava query nem corpo de `/v1/relatorios*`, nem a resposta *(appsec C15; LGPD L-IN-16)*.
  - **Nenhum SQL dinâmico** *(appsec C12)*:
    - filtros em Zod `.strict()`, com enum em todo campo categórico;
    - consultas parametrizadas (`$n`), nunca com texto de entrada concatenado;
    - nenhum parâmetro de ordenação nem de coluna no servidor;
    - teste de arquitetura reprova `sql.raw`, `sql.identifier` e template com interpolação em `apps/api/src/relatorios/`.
  - **Sem texto livre de paciente nos filtros** *(LGPD L-IN-7)*. Não há filtro por nome, telefone ou CPF. Procedimento, item, campanha e pessoa entram **por id**. O schema não tem `string` livre além de enum e id.
  - **Limites** *(appsec C13)*:
    - `SET LOCAL statement_timeout = '10s'` na transação do motor;
    - janela máxima de 24 meses;
    - 60 execuções mais exportações por pessoa por hora, com `429` acima disso;
    - consulta que estoura o tempo → `503` sem nenhuma linha.
  - **Ordenação no servidor por coluna em reais exige `valores`** *(números c.11c)*. O relatório 3 (top N por LTV) exige `valores` para existir. Os outros ordenam no servidor por data ou nome.
  - **Linhas:** objetos com chave nomeada, um schema por relatório. Toda coluna `dinheiro` tem a chave em `CAMPOS_MONETARIOS` (teste de arquitetura). Sem `valores`, o motor tira as colunas `dinheiro` de `colunas`, e o interceptor é a segunda camada.
  - **Registro de acesso** *(LGPD L-IN-8; appsec C14)*:
    - cada execução grava `acessou`, com `entidade = 'relatorio'`, chave, filtros (ids), classe e **quantidade de linhas**;
    - **na mesma transação da leitura**: se o registro falhar, nenhuma linha sai (`500` sem corpo), e erro não grava;
    - nenhum campo livre no detalhe.
- **I-37. Classe de cada relatório** *(LGPD L-IN-1, L-IN-2)*.
  - O catálogo declara `classe: 'saude' | 'pessoal' | 'nenhuma'`.
  - A classe sobe para `saude` em tempo de execução: no relatório 1 com filtro de procedimento, e no relatório 11 com a coluna de paciente.
  - **Classe `saude` exige também `jornada`.**
    - Sem `jornada`, os relatórios 5 e 13, e o 1 filtrado por procedimento, dão `403`.
    - O 11 continua, mas sem a coluna `paciente` (em `colunas` e em `linhas`).
- **I-38. Colunas padrão (minimização)** *(LGPD L-IN-6)*. O que não está listado não sai.

  | Relatório | Padrão (tela e arquivo) | Opt-in | Nunca |
  |---|---|---|---|
  | 1, 2 | nome, data do último atendimento ou compra, procedimento só se filtrado (no 1: valor e LTV, com `valores`) | telefone | aniversário, observação |
  | 3 | nome, LTV, ticket médio, nº de compras (exige `valores`) | telefone | procedimento |
  | 4 | indicadora, nº de indicadas, nº que viraram pacientes, receita das indicadas (com `valores`) | telefone | **nome das indicadas** |
  | 5 | nome, procedimento, sessões feitas e restantes, valor (com `valores`) | telefone | dose, lote |
  | 6 | nome, origem/campanha, convertido (sim/não), receita (com `valores`) | telefone | procedimento |
  | 7 | nome, dia/mês, idade, último atendimento | telefone | data completa de nascimento |
  | 8 | data, tipo, forma, valor, quem registrou (paciente pelo nome; classe `pessoal`) | — | telefone |
  | 9 | nome, adesão (o grupo do saldo), valor em aberto, desde quando (com `valores`) | telefone | procedimento além do nome do programa |
  | 10 | vencimento, descrição, categoria, valor, pago em, forma | — | — |
  | 11 | data, item, lote, quantidade, unidade, motivo, quem registrou, custo (com `valores`) | paciente (com `jornada`) | telefone |
  | 12 | data, item, quantidade, lote, validade, custo | — | — |
  | 13, 14 | nome, data, etapa ou situação, motivo, valor orçado e fechado (13, com `valores`) | telefone | nota livre do histórico |
  | 15 | tarefa, responsável, prazo, concluída em, no prazo? | — | paciente |

  - **Divergências da 1.8, por lei:** o relatório 4 não traz os nomes das indicadas (terceiras), e o 7 não traz a data completa de nascimento. Decisão de LGPD sobre texto da PO, registrada no Manual.
  - **Telefone é opt-in** ("Incluir telefone"), desligado por padrão. Para contatar, o caminho é "Criar campanha".
- **I-39. Exportação.** `POST /v1/relatorios/:chave/exportacoes { filtros, formato, incluirTelefone, finalidade? }`.
  - **Registro** *(LGPD L-IN-9; G5)*:
    - grava `entidade = 'exportacao_de_relatorio'` com formato, filtros, colunas opt-in, classe, quantidade e finalidade;
    - grava também, em `pacientes_da_exportacao (clinica_id, exportacao_id, paciente_id)`, append-only e com RLS, **um id por paciente no arquivo**, nunca nome nem telefone;
    - a `acao` da trilha segue a recomendação LGPD R-a ("exportou" própria), a decidir na ADR do T8. Até lá, `acessou`.
  - **Código da exportação** *(LGPD L-IN-10)*:
    - vai no cabeçalho e no nome do arquivo: `fir-<relatorio>-<AAAAMMDD>-<8 hex>.<ext>`;
    - o código do arquivo bate com a linha da auditoria.
  - **Finalidade** *(LGPD L-IN-11)*:
    - classe `saude` exige `finalidade ∈ {acompanhamento-do-tratamento, recall-de-lote, conferencia-interna}`, sem texto livre (sem ela → `422`);
    - classe `pessoal` exige só a confirmação do aviso.
  - **Cabeçalho** *(LGPD L-IN-12)*, pronto do servidor e sem dinheiro (I-34):
    - campos: clínica, relatório, filtros em texto, data e hora no fuso da clínica, quem exportou, código;
    - aviso para `pessoal`: *"Contém dados pessoais de pacientes de [clínica]. Uso restrito à finalidade da clínica. Não encaminhe nem guarde além do necessário."*;
    - aviso para `saude`: *"Contém dados pessoais sensíveis de saúde (LGPD, art. 11). Uso restrito a: [finalidade]. Não encaminhe, não imprima sem necessidade e apague o arquivo ao terminar."*
  - **Sessão de suporte** (`ator_tipo = operador`): exportar relatório `pessoal` ou `saude` → `403`. Ver na tela fica permitido e registrado *(LGPD L-IN-5)*.
  - **Mesma redação da tela, nas duas camadas** (motor e interceptor) *(appsec C16)*.
  - **Arquivo sem fórmula nem script** *(appsec C17)*:
    - **CSV**, RFC 4180, com BOM: célula de **texto** que começa, depois de espaço, com `=`, `+`, `-`, `@`, TAB ou CR ganha o prefixo `'`; número sai como número;
    - **XLSX:** texto sempre `t: 's'`, nunca `f`, sem hyperlink;
    - **impressão:** só o escape do React, sem `dangerouslySetInnerHTML`.
  - **Navegador** *(LGPD L-IN-15)*:
    - as linhas nunca vão para `localStorage`, `sessionStorage`, IndexedDB nem persistência do TanStack Query;
    - a página de impressão busca as próprias linhas pelo `POST …/exportacoes`, o que já a registra;
    - sair do sistema limpa o cache.
  - **PDF por impressão; PDF no servidor rejeitado** (Chromium na VPS). O arquivo é montado no navegador com `xlsx` 0.20.3 (T0).
- **I-40. Filtro em reais** (`valorMinimo`/`valorMaximo`) exige `valores`. Sem a chave → `403` *(appsec C9)*.
- **I-41. Favoritos são da clínica** *(appsec C19; LGPD L-IN-17)*.
  - Filtros validados pelo Zod do relatório na escrita e na leitura; chave extra → `422`.
  - A lista traz só favoritos de relatórios que a pessoa pode abrir. Rodar o favorito confere de novo a permissão.
  - O campo `nome ≤ 80` mostra o aviso "não use nome de paciente".
  - Filtro desatualizado aparece como "filtros desatualizados".
  - Favorito com faixa de valor: a lista sai com o filtro `null` sem `valores`, e rodar dá `403` *(appsec C9)*.
- **I-42. "Criar campanha com esta lista."** `POST /v1/relatorios/:chave/campanha` com o corpo `{ filtros, destino: { campanhaId } | { nova: SalvarCampanha }, tarefa: { tipo, descricao, prazo, responsavelId } }` e o cabeçalho `Idempotency-Key: <uuid>`.
  - **Permissões** *(appsec C20)*:
    - `indicadores` + a do relatório + `campanhas.gerir` + `valores` se houver filtro em reais;
    - `.strict()` recusa `pacienteIds` no corpo; os pacientes saem só da re-execução no servidor.
  - **Idempotência também na campanha nova** *(appsec C21)*. O uuid vem da tela, gerado ao abrir o formulário, e é gravado em `campanhas.chave_de_idempotencia` com `UNIQUE (clinica_id, chave_de_idempotencia)`. A repetição devolve a mesma `campanhaId`. As tarefas usam `tarefa_viva_da_campanha` + `ON CONFLICT DO NOTHING`.
  - **Tudo ou nada** *(appsec C22)*: acima de 2.000 pacientes, ou motor `truncado` → `422`, sem criar nada. Numa transação só, pelo `criarNaTransacao`/`adicionarPacientesNaTransacao` do `CampanhasService`.
  - **Conferências** *(appsec C23; LGPD L-IN-14)*:
    - `campanhaId` vivo e da clínica;
    - `responsavelId` de pessoa ativa da clínica (FK composta);
    - `tipo` de lista fechada;
    - **fica fora** paciente desativado (inclusive `pediu-para-sair`, 0081) e paciente anonimizado.
  - **Classe `saude`** *(LGPD L-IN-13)*:
    - procedimento e filtro **não são copiados** para a campanha, a descrição da tarefa nem o paciente;
    - a origem (relatório, filtros, finalidade) fica só na auditoria;
    - até o DPA confirmar a finalidade comercial (P-3), a tela mostra: *"Usar procedimento para campanha depende da finalidade combinada com a clínica."*
  - `pacientes.campanha_id` (a origem do paciente) não é reescrito.

### Telas, Hoje, menu e Firmare

- **I-43. Rotas do Next:**
  - `/indicadores`;
  - `/indicadores/relatorios`, com `layout.tsx` comum;
  - `/indicadores/[id]`;
  - `/indicadores/reuniao` (tela cheia);
  - `/indicadores/relatorios/imprimir`.

  Toda página com `useSearchParams` fica dentro de `Suspense`.
- **I-44. Gráficos em SVG feitos à mão.** A `Faisca` sobe para `components/graficos/`. Nenhuma lib de gráfico.
- **I-45. Hoje e menu.**
  - Rotas próprias: `GET /v1/indicadores/da-semana` (até 4 metas `abaixo`/`atencao`) e `GET /v1/indicadores/contador` (metas vivas `abaixo` no trimestre). Ambas respeitam `permissaoDoValor`.
  - **`da-semana` e `reuniao` nunca trazem composição, `pacienteId` nem nome de paciente:** a tela vai para a TV da sala *(LGPD L-IN-4)*.
  - Sem cache nesta entrega. Se o p95 de `/contador` passar de 800 ms, materializar a situação, com ADR.
- **I-46. Plano de ação = tarefa com `kpi_id`.**
  - FK composta `(clinica_id, kpi_id)` *(appsec C24)*.
  - `SalvarTarefa.kpiId` opcional (I-32).
  - `TarefaNaLista.kpi = { id, nome }` e nada mais *(appsec C27)*. Ganha também `lancamentoDeKpi` (I-31).
  - Slide final do Modo reunião: os planos de ação criados na semana corrente, pelo relógio do servidor.
- **I-47. Firmare.** Tabela `kpis_na_carteira`, no molde de `uso_diario_cliente`. O job `uso-diario-cliente` a popula com a mesma `CalculadoraDeKpi`.
  - **Banco e leitura** *(appsec C28)*:
    - `FORCE` RLS por grupo;
    - grava só para clínica com vínculo ativo ao grupo, e para no desvínculo;
    - a leitura passa pelo espaço `carteira` do interceptor (`temPermCarteira(…,'valores')`).
  - **O que atravessa:**
    - **KPI de catálogo de RH** (os três com `pessoas.gerir`) **não atravessa** *(appsec C5, C28)*;
    - **KPI manual do pilar Pessoas** atravessa só `situacao` e `percentual_da_meta`, sem valor *(LGPD L-IN-18)*;
    - **reais e nome livre de KPI manual** atravessam **só depois** de a ADR que emenda a 0013 estar **aceita** *(appsec C28)*. O formulário D.1 avisa: "não use nome de pessoa nem de paciente" *(LGPD L-IN-18)*;
    - nunca `como_medir`, comentário, responsável, composição nem paciente.
  - **Fora da carteira:** a tela "Grupos que recebem a clínica" ganha "…e dos indicadores e metas" no texto.

### Log, banco e jobs (transversal)

- **I-48. RLS e FK composta** *(appsec C24)*.
  - Toda tabela nova tem `clinica_id NOT NULL`, `ENABLE` + `FORCE` e policy com **`USING` e `WITH CHECK`**.
  - **Toda referência é FK composta `(clinica_id, x)`:** `kpi_id`, `okr_id`, `resultado_chave_id`, `serie_id`, `exportacao_id`, `paciente_id`, `responsavel_id`, `lancado_por`, `criado_por` e `tarefas.kpi_id`. A tabela-mãe que ainda não tem `UNIQUE (clinica_id, id)` ganha o índice na 0098. O motivo: a checagem de FK não passa por RLS.
- **I-49. Privilégios** *(appsec C25)*.
  - Nenhum `DELETE` para `fir_app`.
  - `fotografias_de_kpi` e `pacientes_da_exportacao` aceitam só `INSERT`.
  - O `REVOKE` em `metas_do_mes` é provado por teste.
- **I-50. Jobs como `fir_app`, dentro de `naClinica`, uma clínica por vez** *(appsec C26)*. Rodam no processo `worker-uso-diario`, sem container novo.
- **I-51. Log sem conteúdo** *(appsec C29; LGPD L-IN-16)*. Nenhum log leva filtros, linhas, valor de KPI, comentário, nome de KPI manual, frase da prévia nem o corpo de `/v1/relatorios*`. Os jobs logam só ids e contagens.
- **I-52. `claude-security:scan`** no diff do T3, do T8, do T9 e do T10, antes do `/code-review` *(appsec C30)*.

## Modelo de dados

| Tabela | Colunas que importam |
|---|---|
| `kpis` | `origem`, `chave_catalogo`, `parametros jsonb NOT NULL DEFAULT '{}'`, `nome`, `pilar`/`unidade`/`direcao` (só manual), `frequencia`, `dia_de_lancamento`, `como_medir ≤ 140`, `responsavel_id`, `tarefas_geradas_ate`, `arquivado_em`. `UNIQUE (clinica_id, chave_catalogo, parametros) WHERE origem='catalogo' AND arquivado_em IS NULL` |
| `lancamentos_de_kpi` | `kpi_id`, `referencia`, `valor_centavos` XOR `valor_numero`, `comentario ≤ 280`, `lancado_por`, `lancado_em`. `UNIQUE (kpi_id, referencia)` |
| `okrs` | `objetivo ≤ 160`, `porque ≤ 500`, `tipo_periodo`, `inicio`, `fim`, `responsavel_id`, `estado`, `encerrado_em`, `arquivado_em` |
| `resultados_chave` | `okr_id`, `kpi_id`, `ordem`, `arquivado_em`; de 1 a 5 vivos por OKR (trigger) |
| `series_de_meta` | `kpi_id`, `resultado_chave_id`, `alvo_*`, `responsavel_id`, `desde`, `arquivada_em` |
| `metas_de_kpi` | `kpi_id`, `resultado_chave_id`, `serie_id`, `tipo`, `inicio`, `prazo`, `alvo_*`, `partida_*`, `responsavel_id`, `medida_por`, `origem_migracao UNIQUE`, `arquivada_em`; `EXCLUDE` (I-25); `UNIQUE (serie_id, inicio)` |
| `fotografias_de_kpi` | `kpi_id`, `dia`, `valor_*`. `UNIQUE (kpi_id, dia)`; só `INSERT` |
| `tarefas.kpi_id` | FK `(clinica_id, kpi_id)` |
| `clinicas.conferencia_desde` | `date NULL` (G1) |
| `relatorios_favoritos` | `chave_relatorio`, `nome ≤ 80`, `filtros jsonb`, `criado_por`, `arquivado_em`; nome único vivo por clínica |
| `pacientes_da_exportacao` | `exportacao_id` (a linha de `auditoria`), `paciente_id`; só `INSERT` (G5) |
| `campanhas.chave_de_idempotencia` | `uuid NULL`, `UNIQUE (clinica_id, chave_de_idempotencia)` (appsec C21) |
| `kpis_na_carteira` | molde de `uso_diario_cliente`: `cliente_carteira_id`, `grupo_id`, `kpi_ref`, `dia`, `chave_catalogo`, `nome`, `pilar`, `unidade`, `valor_*` (nulo no pilar Pessoas), `alvo_*`, `prazo`, `situacao`, `percentual_da_meta`. `UNIQUE (cliente_carteira_id, kpi_ref, dia)` |

**Migrations:**

| Nº | Conteúdo | Ticket |
|---|---|---|
| 0098 | esquema de indicadores | T1 |
| 0099 | permissões nos perfis existentes | T1 |
| 0100 | `metas_do_mes` → `metas_de_kpi`, mais `conferencia_desde` | T2 |
| 0101 | favoritos e `pacientes_da_exportacao` | T8 |
| 0102 | `campanhas.chave_de_idempotencia` | T9 |
| 0103 | `kpis_na_carteira` | T10 |

A 0097 é do acesso por e-mail. **O cabeçalho da seção de `docs/compliance/retencao.md` diz "0098–0102" e passa a "0098–0103".**

## Superfície de API (nova)

| Método e caminho | Permissão |
|---|---|
| `GET /v1/indicadores/catalogo` | `indicadores.gerir` (e a `permissaoDoValor` de cada chave) |
| `GET /v1/indicadores?periodo&pilar&responsavel&unidade` | `indicadores` |
| `POST/PUT /v1/indicadores/kpis[/:id]`, `POST …/:id/arquivar` | `indicadores.gerir` (+ C3) |
| `GET /v1/indicadores/kpis/:id?meta`, `GET …/:id/serie?modo&de&ate&meta` | `indicadores` (+ `permissaoDoValor`) |
| `PUT /v1/indicadores/kpis/:id/lancamentos/:referencia` | `podeLancar` (exceção nomeada) |
| `GET /v1/indicadores/metas/previa` | `indicadores.gerir` (+ C3) |
| `POST/PUT /v1/indicadores/metas[/:id]`, `POST …/:id/arquivar` | `indicadores.gerir` (+ C3) |
| `POST/PUT /v1/indicadores/okrs[/:id]`, `…/encerrar`, `…/duplicar`, `…/arquivar` | `indicadores.gerir` (+ C3) |
| `GET /v1/indicadores/da-semana`, `…/contador`, `…/reuniao` | `indicadores` |
| `GET /v1/relatorios` | `indicadores` |
| `POST /v1/relatorios/:chave/execucoes` | `indicadores` + a do relatório (+ `jornada` na classe `saude`) |
| `POST /v1/relatorios/:chave/exportacoes` | idem; sessão de suporte → `403` em `pessoal`/`saude` |
| `POST /v1/relatorios/:chave/campanha` | idem + `campanhas.gerir` |
| `POST/PUT /v1/relatorios/favoritos[/:id]`, `…/arquivar` | `indicadores` + a do relatório |

Rotas existentes que mudam:
- `GET/PUT /v1/metas/:mes…`;
- `POST /v1/tarefas` (`kpiId`, e recusa o marcador `lancamento-kpi:`);
- `TarefaNaLista` (ganha `kpi` e `lancamentoDeKpi`);
- o fechamento do caixa (preenche `conferencia_desde` se ela for nula).

## Os 15 relatórios

Os campos de cada linha são os da I-38. Permissão e classe:

| # | Chave | Permissão | Classe | Lista de pacientes | Fonte (reuso) |
|---|---|---|---|---|---|
| 1 | `pacientes-sem-compra` | `pacientes` | `pessoal`; `saude` se filtrado por procedimento | sim | último recebimento; LTV da ficha. Procedimento = já comprou **e** está sem compra há X meses |
| 2 | `pacientes-sem-atendimento` | `pacientes` | `pessoal` | sim | último atendimento |
| 3 | `pacientes-maior-ltv` | `pacientes` + **`valores`** (c.11c) | `pessoal` | sim | LTV; `Dinheiro.media` |
| 4 | `pacientes-que-indicaram` | `pacientes` | `pessoal` | sim | regra de `quemMaisIndica`; "viraram pacientes" = indicada com ≥ 1 recebimento |
| 5 | `pacientes-por-procedimento` | `programas` + `jornada` | `saude` | sim | itens do programa |
| 6 | `pacientes-por-origem-e-campanha` | `pacientes` | `pessoal` | sim | origem; `resultadoDaCampanha` |
| 7 | `aniversariantes` | `pacientes` | `pessoal` | sim | dia/mês e idade no fuso da clínica |
| 8 | `recebimentos` | `finmes` | `pessoal` | não | `recebidosDaJanela` + partes, uma linha por parte |
| 9 | `saldos-em-aberto` | `cobrancas` | `pessoal` | sim | `saldosDe(…, { ate })`, uma linha por grupo (regra 5) |
| 10 | `contas` | `contas.gerir` | `nenhuma` | não | `contas_a_pagar` |
| 11 | `saidas-de-estoque` | `estoque.gerir` (+ `jornada` para o paciente) | `nenhuma`; `saude` com paciente | não | movimentos de saída, modo B8 |
| 12 | `entradas-de-estoque` | `estoque.gerir` | `nenhuma` | não | movimentos de entrada |
| 13 | `orcamentos` | `jornada` | `saude` | não | eventos do orçamento. "Valor fechado" = `orc_valor` (c.3), nunca `valorOrcamento` |
| 14 | `faltas-e-desmarcacoes` | `jornada` | `pessoal` | sim | `noshow`/`desmarcar` + I-11 |
| 15 | `tarefas-da-equipe` | `tarefas.equipe` | `nenhuma` | não | condição de `consultarPrazos` |

### Regras de número

- **Relatório 8, recebimentos** *(números c.10, c.15; appsec C11)*.
  - Σ das linhas dos dias que contam + `aguardandoFechamento` = `recebido` da Visão do mês, centavo a centavo, **inclusive a nota promissória**, que é receita fora da gaveta.
  - Linha de dia aguardando sai com **`valor: null` e `forma: null`**. O dinheiro desses dias aparece só no total "aguardando fechamento".
  - Os totais por forma e por tipo (arrays de `{ rotulo, valor: ValorNaTela }`) somam só os dias que contam.
  - "N recebimentos" = `count(DISTINCT r.id)` com `r.valor > 0`, e não o número de linhas.
- **Relatório 9, saldos em aberto.** Com o corte em hoje, Σ = `aReceber`. Com corte passado, o pagamento depois do corte não abate. O agrupamento é por adesão.
- **Relatório 11, saídas de estoque** *(números B8)*.
  - Ganha o modo **"período da análise"**: escolhe-se a contagem, e o recorte é o `entreGrupos` da análise, por índice.
  - Por item, Σ quantidade das linhas = `saidasEmEstoque`, com as compensações de reabertura em **linha negativa**.
  - Custo por linha com arredondamento meio-para-cima, como em `valorDaFalta`, e o total é a soma das linhas.
  - O modo "mês civil" fica disponível, e **não** se compara com a Análise.
- **Relatório 15, tarefas.** "No prazo?" é a classificação `ok`/`tarde` de `consultarPrazos`, e o resumo bate com o Painel.
- **Todos** excluem paciente desativado ou anonimizado.

## Critérios de aceite

Os testes têm o nome entre crases. O índice final os mapeia.

### A. Domínio (T1)
1. Catálogo de 20 chaves ↔ fontes registradas, e `permissaoDoValor` declarada (`catalogo-tem-fonte-para-toda-chave`).
2. Ritmo, situação, progresso e projeção com as propriedades de I-19 a I-22, mais os testes `ritmo-dezembro-2026`, `situacao-multiplicacao-cruzada`, `faturamento-conferido-dia-aberto-no-meio-nao-infla-projecao` e `projecao-com-corte-no-inicio-e-null`.
3. `agrupamentoPara`: junho–novembro dá 6 `mes`, e 01/11–hoje dá `dia`.
4. `janelaComparavel`: `dias(anterior) = min(dias(atual), dias do mês anterior)`, com 30/03 e 31/03 → 28/02 e 29/02 (`janela-comparavel-mes-curto`).
5. `referenciaPendente` e `prazoDoLancamento`, com dia 31 em fevereiro.
6. `progressoDoOkr` = média meio-para-cima dos **progressos inteiros exibidos**: 11/11/10 dá 11 (`okr-media-dos-exibidos`). A situação é a pior. A ordenação vai do menor progresso para o maior.
7. `podeLancar`, `exigeValoresParaEscrever`, `PERMS` e `temPerm`, mais o teste de arquitetura de não-transitividade (`perms-sem-dependencia-em-cadeia`).
8. `valorNaTela` com XOR por unidade (`valor-na-tela-reais-sem-em-numero`, property).

### B. KPIs automáticos (T2)
1. Meta de dezembro de R$ 120.000: o valor atual = o medido da Visão do mês. (1.10, item 1)
2. Faturamento conferido nos dois regimes (antes e depois de `conferencia_desde`). Aguardando fora do ritmo, da projeção e da situação. (1.10, item 9)
3. **Fonte única para as 20 chaves**: cada uma igual à tela de origem na mesma janela (`fonte-unica-<chave>`), incluindo a conversão com o limite de 100. (1.10, item 2)
4. Transporte com o caixa de hoje aberto: mudar um recebimento de hoje não muda nenhum byte (`regra-6-nenhum-byte-de-hoje`).
5. Bordas de I-10 a I-14. Caixas: `caixa-sabado-nao-passa-de-100` e `caixa-sobra-e-falta-iguais-tem-diferenca`. Perda: `perda-nao-soma-por-mes` e `perda-sem-contagem-nao-atinge-teto`.
6. Fotografia por instante: pagamento às 00:03 de D+1 fora de D, e o job rodado às 15:00 dá o mesmo valor (`fotografia-pelo-instante`).
7. KPI de RH sem `pessoas.gerir`: ausente de todas as rotas, numa clínica de uma ficha (`kpi-rh-some-sem-pessoas-gerir`). Despesas fixas sem `valores`: ausente (`razao-monetaria-some-sem-valores`).

### C. KPIs manuais (T3)
1. Tarefa em Hoje para a responsável sem `indicadores` e conclusão ao lançar. (1.10, item 3)
2. Relançar corrige, e a correção aparece em Atividades.
3. Job três vezes não duplica, e a tarefa excluída não volta.
4. Condições do `podeLancar` (`lancamento-responsavel-trocada`, `lancamento-kpi-de-catalogo-422`, `lancamento-outra-clinica-404`, `lancamento-arquivado-409`).
5. A responsável sem `indicadores` recebe `403` em todo `GET /v1/indicadores*`, e o `PUT` só traz o schema do lançamento (`excecao-da-responsavel-nao-abre-leitura`).

### D. Metas e migração (T2)
1. A 0100: linha a linha, quantidade e soma por clínica. A fixture com meses trocados aborta (`migracao-0100-meses-trocados-aborta`). (1.10, item 8)
2. `PUT /v1/metas/:mes` grava em `metas_de_kpi`. O `PUT` contra `metas_do_mes` falha alto.
3. Recorrente idempotente. `EXCLUDE` contra duas abas. `PUT` sobre meta `ate_data` sobreposta → `409`.
4. Escrever em reais sem `valores` → `403` em cada rota da C3 (`escrever-reais-sem-valores-403`). Alvo pior que a partida → `422`.
5. Script de comparação antes do deploy rodado em produção, com a saída fora do repositório e assinada pela Marília.

### E. OKRs (T4)
1. CRUD, encerrar, duplicar (recalcula a partida, exige `valores` para KR em reais) e arquivar.
2. De 1 a 5 KRs, aviso acima de 4, trimestre por padrão e datas livres.
3. KPI ligado sai da faixa Saúde. O mesmo KPI em dois OKRs tem duas metas. (1.10, item 5)

### F. Redação e permissão (T1–T9)
1. Sem `valores`, nenhum `emDinheiro` em nenhuma rota nova, com prova por mutação (`redacao-em-dinheiro`). (1.10, itens 6 e 17)
2. Nenhum campo string com `R$` nem `\d+,\d{2}` (`nenhuma-string-com-dinheiro`), com mutação.
3. `aguardandoFechamento` `null` para a equipe, com mutação.
4. Ids de outra clínica → `422`/`404` em cada campo (`ids-de-outra-clinica`). FK composta recusa `kpi_id` de B gravado sob A (`fk-composta-entre-clinicas`).
5. Sem `indicadores`: menu, `403` e "Sem acesso a esta tela".
6. RLS contra Postgres real, e jobs dentro de `naClinica` (`job-nao-cruza-clinica`).
7. Log sem conteúdo (`log-sem-conteudo-indicadores`, `log-sem-conteudo-relatorios`).

### G. Telas (T5–T7)
1. A 1.9 de A a H, posição por posição. (1.10, item 11)
2. Os botões do gráfico. (1.10, itens 4, 10 e 12)
3. Modo reunião: tela cheia, fundo creme, setas, `Esc` e nada de paciente na resposta (`reuniao-sem-paciente`). (1.10, itens 7 e 13)
4. Hoje, o contador, o link da Visão do mês e o selo.
5. 390 px, os dois temas, tabulares e os estados. A tela monta a frase da prévia.

### H. Relatórios (T8, T9)
1. Relatório 1 filtrado por procedimento: exige `jornada`, pede finalidade e exporta nos três formatos com o cabeçalho, o aviso `saude` e o código (`exportacao-cabecalho-e-aviso`). (1.10, item 14)
2. Criar campanha: uma tarefa por paciente, idempotente na campanha nova (`campanha-da-lista-tres-posts-uma-campanha`), tudo ou nada (`campanha-da-lista-2001-422`), sem procedimento copiado (`campanha-saude-sem-procedimento`), e paciente `pediu-para-sair` fora. (1.10, item 15)
3. Relatório 8: dias que contam + aguardando = Visão do mês. Relatório 11, no modo análise, = Análise (`saidas-batem-com-analise-reabertura`). (1.10, item 16)
4. Sem `valores`: nenhuma coluna em reais na tela nem no arquivo, com mutação na exportação. (1.10, item 17)
5. Favorito roda com um clique (1.10, item 18). Favorito de relatório sem permissão não aparece.
6. Geração e exportação em Atividades, com contagem. `pacientes_da_exportacao` com N linhas, só `INSERT`.
7. CSV e XLSX sem fórmula, com o conjunto ampliado (`csv-xlsx-sem-formula`).
8. `POST …/execucoes` sem filtro no log. Filtro desconhecido → `422`. `pg_sleep` inerte. `429` na 61ª execução. `503` em consulta lenta.
9. Registro falhando → `500` sem dados (`registro-de-acesso-falha-fechado`).
10. Classe `saude` sem `jornada`: 5 e 13 → `403`, e o 11 sem paciente. Sessão de suporte não exporta.
11. Nada de linha de relatório no storage do navegador (`storage-sem-linhas`). Telefone só com opt-in.

### I. Firmare, Manual e Ajuda (T10)
1. `kpis_na_carteira`:
   - uma linha por KPI por dia, idempotente;
   - RH de catálogo ausente;
   - manual do pilar Pessoas sem valor;
   - grupo B lê zero;
   - clínica desvinculada não ganha linha;
   - a usuária de gestão sem `valores` vê `null`.
2. Manual e Ajuda atualizados, incluindo: as duas receitas (c.2), o KPI manual como posição (I-5), a régua da meta e `conferencia_desde` (R-2), as divergências da I-38 e o aviso dos textos livres.
3. Nenhum dado existente perdido: as suítes antigas passam. A exceção é o que muda com ADR (I-9, I-15).

## Fora de escopo

- Mensagens prontas no WhatsApp.
- Feriados.
- Telemetria de recaptados e rotinas na carteira.
- Agregação configurável de KPI manual.
- PDF no servidor.
- Fotografia mensal do custo da perda (dívida).
- Alerta de exportação em excesso (LGPD R-c, dívida com o gatilho "primeira clínica com mais de 10 usuárias").
- Filtro "Exportações" em Atividades (LGPD R-b; entra no T8 se couber, senão vira dívida).

## Riscos que continuam

- **R-1. Sem o protótipo clicável, o aceite visual é "igual à 1.9".** Pedir o link à Marília antes do T5.
- **R-2. Mudança de régua da meta**, agora só a partir de `conferencia_desde` (G1). O script de comparação do T2 vai assinado pela Marília. **Um mês divergente sem a ciência dela segura o deploy.**
- **R-3. Relatórios com dado de saúde.** Resolvido pelas condições L-IN. Falta a cláusula do DPA (LGPD R-d, P-3).
- **R-7. Custo da série de 12 meses.** Medir no T6.

## Condições dos gates

Índice: cada id, o ticket que o fecha e o teste que o prova.

### Números

| Id | Ticket | Teste |
|---|---|---|
| B1 | T1, T2 | `faturamento-conferido-dia-aberto-no-meio-nao-infla-projecao`; `janela-comparavel-usa-dias-de-D` |
| B2 | T1 | `ritmo-dezembro-2026`; property `ritmo-vespera-e-prazo` |
| B3 | T2 | `caixa-sabado-nao-passa-de-100`; `caixa-sobra-e-falta-iguais-tem-diferenca` |
| B4 | T1, T2 | `perda-nao-soma-por-mes`; `perda-sem-contagem-nao-atinge-teto` |
| B5 | T2 | `regua-medx-dentro-do-corte`; `dias-sem-caixa-uma-funcao` (Painel = Visão = KPI) |
| B6 | T2 | `conferencia-desde-regime-anterior-nao-muda`; `hoje-sem-caixa-nao-conta`; script de comparação (saída fora do repo) |
| B7 | T2 | `migracao-0100-meses-trocados-aborta` |
| B8 | T8 | `saidas-batem-com-analise-reabertura`; `sobra-de-frasco-dose-mais-descarte` |
| c.1 | T2 | `fonte-unica-<chave>` (20) |
| c.2 | T2, T10 | nenhum teste afirma `ticket × n = faturamento` (revisão); Manual |
| c.3 | T2, T9 | `valor-fechado-e-orc-valor`; relatório 13 com a mesma definição |
| c.4 | T1, T2 | `resultado-do-mes-so-mes-civil-422`; `resultado-do-mes-comparacao-mes-inteiro` |
| c.5 | T2, T5 | `despesas-fixas-sobre-recebido-sem-outras-entradas`; rótulo na tela |
| c.6 | T1 | `media-mensal-nao-recombina` |
| c.7 | T1 | `situacao-multiplicacao-cruzada` (33 de 100 → atenção; 9.000/8.999) |
| c.8 | T1 | `janela-comparavel-mes-curto` |
| c.9 | T2 | `fotografia-pelo-instante`; `fotografia-dia-perdido-recompoe` |
| c.10 | T2, T8 | `regra-6-nenhum-byte-de-hoje`; `relatorio-8-dia-aberto-sem-forma` |
| c.11 | T1, T2, T8 | `percentual-da-meta-inteiro`; `razao-monetaria-some-sem-valores`; `relatorio-3-exige-valores`; `aguardando-null-para-equipe` (mutação) |
| c.12 | T1 | `okr-media-dos-exibidos` |
| c.13 | T1, T2 | `catalogo-parametros-default-unico`; `put-meta-mes-sobre-ate-data-409`; ensaio da 0100 em cópia de produção |
| c.14 | T2 | `banco-de-horas-soma-positivos` |
| c.15 | T8 | `relatorio-8-contagem-distinta`; `relatorio-8-bate-com-visao-com-promissoria` |
| c.16 | T1, T2 | `projecao-com-corte-no-inicio-e-null`; `fonte-fora-do-dominio-incidente` |

### Appsec

| Id | Ticket | Teste |
|---|---|---|
| C1 | T3 | `lancamento-responsavel-trocada`; `lancamento-kpi-de-catalogo-422`; `lancamento-outra-clinica-404`; `lancamento-arquivado-409` |
| C2 (bloqueia T3) | T3 | `excecao-da-responsavel-nao-abre-leitura` |
| C3 | T1, T2, T4 | `escrever-reais-sem-valores-403` (todas as rotas) |
| C4 | T1, T2 | `perms-sem-dependencia-em-cadeia`; matriz no `registro.ts` |
| C5 (bloqueia T1) | T1, T2, T7, T10 | `kpi-rh-some-sem-pessoas-gerir` |
| C6 | T2, T4, T6 | `ids-de-outra-clinica` |
| C7 | T1 | `valor-na-tela-reais-sem-em-numero` |
| C8 (bloqueia T2) | T2, T5, T7, T8 | `nenhuma-string-com-dinheiro` (mutação) |
| C9 | T8 | `favorito-faixa-de-valor-redigido-e-403` |
| C10 | T1 | ADR com o residual; `escala-relativa-a-propria-serie` |
| C11 (bloqueia T2 e T8) | T2, T8 | `regra-6-nenhum-byte-de-hoje`; `relatorio-8-dia-aberto-sem-forma`; medição da Visão do mês (dívida se for o caso) |
| C12 | T8 | `relatorio-filtro-desconhecido-422`; `relatorio-pg-sleep-inerte`; arquitetura `relatorios-sem-sql-raw` |
| C13 | T8 | `relatorio-61-execucao-429`; `relatorio-timeout-503` |
| C14 | T8 | `registro-de-acesso-falha-fechado` |
| C15 (bloqueia T8) | T8 | `relatorio-filtros-fora-do-log` |
| C16 | T8 | `exportacao-redacao-mutacao` |
| C17 | T8 | `csv-xlsx-sem-formula` |
| C18 | T0 | `pnpm audit` sem `xlsx`; suíte de importação inalterada |
| C19 | T8 | `favorito-de-relatorio-sem-permissao-nao-aparece` |
| C20 | T9 | `campanha-da-lista-permissoes-403`; `campanha-da-lista-recusa-paciente-ids` |
| C21 (bloqueia T9) | T9 | `campanha-da-lista-tres-posts-uma-campanha` |
| C22 | T9 | `campanha-da-lista-2001-422` |
| C23 | T9 | `campanha-da-lista-destino-e-tarefa-conferidos` |
| C24 | T1 | `fk-composta-entre-clinicas`; `rls-with-check-tabelas-novas` |
| C25 | T1, T2, T8 | `fotografias-so-insert`; `metas-do-mes-put-antigo-falha`; `pacientes-da-exportacao-so-insert` |
| C26 | T2, T10 | `job-nao-cruza-clinica` |
| C27 | T3, T6 | `marcador-lancamento-forjado-422`; `plano-de-acao-kpi-rh-exige-pessoas-gerir` |
| C28 | T10 | `carteira-sem-valores-null`; `carteira-grupo-b-zero`; `carteira-desvinculada-sem-linha`; o gate da ADR 0013 |
| C29 | T2, T3, T8, T9 | `log-sem-conteudo-indicadores`; `log-sem-conteudo-relatorios` |
| C30 | T3, T8, T9, T10 | `claude-security:scan` no diff, antes do `/code-review` |

### LGPD

| Id | Ticket | Teste |
|---|---|---|
| L-IN-1 | T8 | `classe-do-relatorio-por-filtro` |
| L-IN-2 | T8, T9 | `saude-exige-jornada` (5 e 13 → `403`; 11 sem paciente) |
| L-IN-3 | T2, T6 | `composicao-com-paciente-exige-jornada`; acesso registrado |
| L-IN-4 | T7 | `reuniao-sem-paciente`; `da-semana-sem-paciente` |
| L-IN-5 | T8 | `suporte-nao-exporta-pessoal-nem-saude` |
| L-IN-6 | T8, T9 | `schema-de-linha-e-o-padrao`; `exportacao-sem-telefone-por-padrao` |
| L-IN-7 | T8 | `filtros-sem-string-livre` |
| L-IN-8 | T8 | `geracao-registrada-com-contagem` |
| L-IN-9 | T8 | `pacientes-da-exportacao-n-linhas`; `pacientes-da-exportacao-so-insert` |
| L-IN-10 | T8 | `codigo-da-exportacao-bate-com-auditoria` |
| L-IN-11 | T8 | `exportacao-saude-sem-finalidade-422` |
| L-IN-12 | T8 | `exportacao-cabecalho-e-aviso` (Playwright, três formatos) |
| L-IN-13 | T9 | `campanha-saude-sem-procedimento` |
| L-IN-14 | T9 | `campanha-da-lista-sem-pediu-para-sair` |
| L-IN-15 | T8 | `storage-sem-linhas` (Playwright) |
| L-IN-16 | T8 | `relatorio-filtros-fora-do-log` |
| L-IN-17 | T8 | `favorito-chave-extra-422` |
| L-IN-18 | T5, T10 | `carteira-pessoas-sem-valor`; aviso no D.1 |
| R-a…R-e | T8 (R-a na ADR, R-b se couber), dívida (R-c), DPA (R-d), T3/T4 (R-e, aviso nos textos livres) | — |
