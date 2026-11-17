# Relatórios: o motor por POST, a exportação registrada com ação própria, e o que cada relatório conta

**Status:** aceita, 2026-11-17. **Origem:** ticket T8 de [indicadores-e-insights-tickets](../specs/indicadores-e-insights-tickets.md); spec I-36 a I-41; gates de [números](../specs/indicadores-e-insights-gate-numeros.md) (B8, c.10, c.15), [appsec](../specs/indicadores-e-insights-gate-appsec.md) (C8–C19, C25, C29) e [LGPD](../specs/indicadores-e-insights-gate-lgpd.md) (L-IN-1 a L-IN-17, R-a, R-b).

## Contexto

Os relatórios são a primeira rota que tira do sistema **lista de pacientes**, e
o primeiro lugar onde o mesmo número aparece em duas telas. Sete decisões não
eram óbvias do spec e foram tomadas aqui, pela regra do dono (protótipo, depois
a opção recomendada).

## Decisões

1. **Motor no servidor, por `POST`, filtros no corpo.**
   `POST /v1/relatorios/:chave/execucoes` e `…/exportacoes`. Nenhum filtro na
   URL: a URL é o que o proxy, o histórico e o access log guardam. A ordem do
   motor é parte da regra: permissão do relatório (403) → faixa de valor sem
   `valores` (403, **antes** do parse, porque o favorito redigido chega com
   `valorMinimo: null` e tem de dar 403, não 422) → `.strict()` (422) → classe
   de tempo de execução → limites e registro numa transação só.

2. **O arquivo é montado no navegador; o servidor devolve linhas e cabeçalho
   prontos.** PDF no servidor exigiria Chromium na VPS (rejeitado no spec). O
   cabeçalho (clínica, filtros em texto, `geradoEm` no fuso da clínica, quem
   exportou, código, aviso da L-IN-12) sai pronto e **sem dinheiro**: a
   redação casa chave, e um valor dentro de um texto a atravessaria.

3. **`acao = 'exportou'` (LGPD R-a).** A exportação ganha ação própria na
   `auditoria` (0104 alarga o CHECK). A purga distingue 5 anos (exportação) de
   1 ano (geração) pela ação, e o filtro "Exportações" de Atividades (R-b) é
   `GET /v1/atividades?acao=exportou` (o enum de `FiltroDeAtividades` ganhou
   `exportou`), sem rota nova. `entidade_id` é o código
   de 8 hex do arquivo, o mesmo do nome `fir-<relatorio>-<AAAAMMDD>-<código>`.
   Uma exportação grava só a linha `exportou` — não grava também um `acessou`.

4. **`pacientes_da_exportacao` aponta para a linha da trilha por FK composta
   `(clinica_id, exportacao_id) → auditoria(clinica_id, id)`, e não tem
   trigger de auditoria** (`ENTIDADES_SEM_TRILHA_POR_DECISAO`). Ela já é
   trilha, append-only, gravada na mesma transação da linha `exportou`;
   copiá-la para a `auditoria` faria de cada exportação de N pacientes N linhas
   de trilha. Entram os pacientes com nome no arquivo: os do 1, os do 8 e os do
   11 com a coluna de paciente.

5. **Cada relatório é uma casca sobre a função da tela de origem**, nunca uma
   conta paralela:
   - **1 · Pacientes sem compra.** "Compra" é o conjunto do LTV da ficha
     (`COMPRA_DO_PACIENTE` em `pacientes.service.ts`, `r.valor > 0`, não
     estornado). "Sem compra há X meses" = a última compra é anterior a
     `hoje − X meses` (`somarMeses`, que respeita o último dia do mês curto).
     O filtro de procedimento é "já comprou o procedimento": recebimento de
     tarefa com o procedimento, ou de programa que o contém. Só paciente ativa.
   - **8 · Recebimentos.** Uma linha por **parte**, do mesmo
     `RECEBIDOS_DA_JANELA` do `recebido` da Visão do mês; os dias que contam
     são `diasQueContamNasTelas` — o 8 espelha uma tela, e segue a
     [regra das chaves que espelham uma tela](2026-11-17-chaves-em-reais-e-os-dias-de-caixa.md):
     mês passado conta sempre; no mês corrente, só dia com caixa; hoje sem
     caixa nunca. No dia que não conta, `valor` e `forma` saem `null`, e o
     dinheiro vai para **um** `aguardandoFechamento` (sem hoje). "N
     recebimentos" = `count(DISTINCT r.id)` dos dias que contam. **Paciente
     desativado ou anonimizado: a linha fica, com `paciente: null`** — sem
     ela, Σ linhas deixaria de ser o `recebido` da Visão.
   - **11 · Saídas de estoque.** Modo `analise`: `saidasDoPeriodoDaAnalise`,
     o mesmo recorte por índice e o mesmo "entre" de `analiseDoPeriodo`, sobre
     os itens de `itensDaAnalise`. A compensação de reabertura é linha
     **negativa**. Custo por linha `custoDaQuantidade` (meio-para-cima, como
     `valorDaFalta`) com o custo atual do item; o total é a soma das linhas.
     Modo `calendario`: as saídas com dia no período, que **não** se comparam
     com a Análise.
   - **15 · Tarefas da equipe.** O `WHERE` e as quatro situações de
     `consultarPrazos` foram extraídos em constantes, e `tarefasDoCumprimento`
     lê o mesmo recorte: o resumo **é** o bloco `prazos` do Painel. Na tarefa de
     paciente sai o **tipo**, não a descrição (que é texto livre e leva nome ou
     procedimento): o 15 "nunca" tem paciente (I-38).

6. **As chaves `*Id` não são coluna.** `pacienteId`, `recebimentoId`,
   `movimentoId`, `itemId`, `tarefaId` identificam a linha para a ficha, para
   `pacientes_da_exportacao` e para "Criar campanha" (T9). O catálogo
   (`CATALOGO_DE_RELATORIOS`) é a lista das colunas; a tela e o arquivo mostram
   só elas.

7. **Limites contados na TENTATIVA, fora da leitura** (emenda de 2026-11-17,
   revisão appsec do T8, B1 — [parecer](../specs/indicadores-e-insights-t8-appsec.md)).
   A primeira versão contava a própria trilha, e falhou duas vezes: pedidos
   em paralelo liam o mesmo número (15 em paralelo com limite 3 deram 11 × 200),
   e a consulta que estourava o tempo desfazia o próprio registro e nunca
   chegava ao 429. Agora o motor grava a tentativa em `tentativas_de_relatorio`
   (0108) numa transação CURTA e PRÓPRIA, com COMMIT antes da consulta, sob
   `pg_advisory_xact_lock(hashtextextended("relatorios:<clínica>:<pessoa>", 0))`.
   A tentativa que dá 503 conta. A trilha continua gravando só o sucesso
   (L-IN-8). Erro no contador sobe: falha fechado.
   - **Orçamento de tempo.** `statement_timeout` (10 s) vale POR COMANDO, não
     pela execução. A consulta mais longa (11) roda até 4 comandos de leitura,
     então o teto real de uma execução é ~40 s; com o limite por hora, isso
     custa no máximo 60 × 40 s por pessoa por hora. Aceito pela revisão (L2).
     Estouro (57014) ou espera de lock (55P03) → 503, sem linha e sem registro.
   - **O código da exportação é único na clínica** (índice parcial da 0108,
     `acao = exportou`): na colisão dos 32 bits o motor sorteia outro, com
     SAVEPOINT, até 5 vezes (L1).
   - **Texto livre fora do relatório `nenhuma`** (B2, M1): o 15 mostra só o
     tipo da tarefa do catálogo, ou "Tarefa avulsa", e nunca a descrição; o 11
     só mostra o motivo digitado no recorte `saude` (com a coluna de paciente,
     que exige `jornada`) — fora dele, o rótulo e o motivo que o sistema grava.

## Consequências

- O web precisa de `'exportou': 'Exportou'` no rótulo de ações de Atividades.
- O registro de acesso falha fechado: sem ele, nenhuma linha sai (500 sem
  conteúdo). O teste `registro-de-acesso-falha-fechado` prova com um trigger
  que recusa a escrita.
- O T9 acrescenta relatórios ao mesmo catálogo e às mesmas cascas;
  `relatorios_favoritos.chave_relatorio` não tem lista fechada no banco por
  isso.
