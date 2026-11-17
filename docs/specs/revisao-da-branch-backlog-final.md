# Revisão da branch `backlog-final-indicadores-e-acesso`

**Data:** 2026-11-17 · **Revisor:** `revisor-codigo` · **Base:** `4217499` (o `main` local não existe; a base é o ponto em que a branch saiu de `integracao-medx`, 354 arquivos, +45,9 mil linhas).

**Escopo.** Os pontos que nenhum revisor tinha visto: a parte web de T5 a T10, os itens transversais e as lacunas de spec contra o backlog. T2–T4, T8–T10 (appsec e números) e a Entrega 3 já tinham revisão dedicada. Delas só conferi por amostra: o P1 da revisão da Entrega 3 está corrigido em `6cc7d71`, e o P2 em `CONTEXT.md:58-67`.

**Evidência.** `pnpm typecheck` rodou e passou (8 de 8 tarefas). **Não rodei** `pnpm test` nem `pnpm build`.

## Veredito: REPROVADO. Há dois bloqueadores, os dois baratos.

---

## Eixo 2 — Spec (vem primeiro, porque é onde estão os bloqueadores)

### Bloqueia o merge

**S1. O minigráfico do KPI semanal não mostra as 8 semanas.**
- **Onde:** `apps/web/src/components/indicadores/tela-indicadores.tsx:461-476`.
- **O que diz a spec:** o backlog 1.9 C.1 e a spec (`docs/specs/indicadores-e-insights.md:323`) pedem 8 semanas para o KPI semanal.
- **O que o código faz:** `useSeries` só manda janela para o KPI mensal. O semanal cai na janela padrão da rota, que são 3 meses agrupados por mês, ou seja, 3 barras.
- **Por que é falso o motivo dado:** o comentário diz que "as 8 semanas ainda não têm como sair" da rota. Ela tem. `ConsultaDaSerie` aceita `agrupamento: "semana"` (`packages/contracts/src/indicadores-api.ts:164-170`). O serviço usa o agrupamento pedido e o início padrão de 8 semanas (`apps/api/src/indicadores/indicadores.service.ts:326-335`).
- **Correção:** no KPI semanal, pedir `consultaEmTexto({ agrupamento: "semana" })`, apagar o comentário e cobrir no Playwright `indicadores.e2e.ts`. Nenhuma ADR registra o desvio.

**S2. Faltam nos relatórios os filtros que a 1.8 lista para 13 dos 15, e nenhuma ADR registra o corte.**
- **Onde:** `packages/contracts/src/relatorios.ts:100-210`.
- **Contexto:** a spec fixou as colunas (I-38) e as regras de segurança (sem texto livre, só enum e id). Ela não registra nenhuma decisão de cortar filtros.
- **O que falta, contra o backlog:**
  - **1 — sem compra:** unidade e origem.
  - **2 — sem atendimento:** "dias ou meses" (só aceita meses), tipo de atendimento e unidade.
  - **3 — maior LTV:** período, unidade e origem (só tem o top N).
  - **4 — indicaram:** mínimo de indicações.
  - **5 — por procedimento:** "um ou vários" (aceita um), período, e a situação ativo/concluído/encerrado (só há `incluirEncerrados`).
  - **6 — origem e campanha:** origem.
  - **7 — aniversariantes:** intervalo de datas.
  - **8 — recebimentos:** forma, tipo, unidade e quem registrou.
  - **10 — contas:** categoria.
  - **11 — saídas de estoque:** motivo e local.
  - **12 — entradas de estoque:** fornecedor.
  - **13 — orçamentos:** situação e motivo de perda.
  - **14 — faltas e desmarcações:** recontatado ou não.
  - **15 — tarefas da equipe:** situação e tipo.
- **Por que bloqueia:** os critérios da 1.10 passam, porque o único filtro que eles citam é o procedimento do relatório 1. Mas o que a Marília confere na tela é o catálogo da 1.8 inteiro. Pela regra "desvio do spec só passa com ADR", isto não pode entrar calado.
- **Correção, uma das duas:**
  - uma ADR de escopo (`product-rotina-clinica`) que adie os filtros, com um ticket por relatório;
  - ou implementar os filtros, todos por enum ou id, mantendo a L-IN-7.

### Corrigir agora

**S3. O catálogo do D.1 mostra a referência interna da spec para a usuária, e não mostra a prévia do valor.**
- **Onde:** `apps/web/src/components/indicadores/formulario-de-kpi.tsx:236-245`.
- **A referência interna:** a explicação de cada linha é `i.fonte` cru, então aparece "Recebimentos dos dias com caixa fechado (I-9)", "(I-10)", "(I-15)" e assim por diante (`packages/domain/src/indicadores/catalogo.ts:120-144`). O detalhe já limpa isso com `fonteNaTela` (`detalhe-na-tela.ts:491`), e o formulário não limpa.
- **A prévia:** a 1.9 D.1 pede "o valor atual (prévia)" em cada linha. Hoje ele só aparece em quem já é "já acompanhado".
- **Correção:**
  - tirar a referência na origem, com um campo `explicacao` no catálogo, ou ao menos usar `fonteNaTela`;
  - para a prévia, um `GET` da prévia por chave, ou a prévia na própria resposta do catálogo.

**S4. A barra de ações dos relatórios não segue a ordem da 1.9 G(5).**
- **Onde:** `apps/web/src/components/relatorios/tela-relatorios.tsx:447-468`.
- **O que a spec pede:** "Exportar", depois "Salvar como favorito", e por último "Criar campanha com esta lista", como **botão principal**.
- **O que o código faz:** a ordem é Exportar → Criar campanha → Salvar favorito, e o botão de campanha é `btn ghost`.
- **Correção:** trocar a ordem e usar a classe `btn`.

### Vira ticket

- **S5.** O backlog 1.5 pede "Imprimir ou salvar em PDF" para o painel de indicadores. A spec deixou isso cair sem registrar, e não há botão. O `@media print` global (`packages/ui/src/rotina.css:1227`) já esconde o menu; falta um botão e a regra `break-inside` para `.ii-kpi` e `.ii-okr`.
- **S6.** O backlog (decisão "lugar único") pede um atalho para o indicador também em **Equipe › Metas do mês** e em **Campanhas**. Só a Visão do mês ganhou o link (`tela-visao-do-mes.tsx:404-424`). A spec também é omissa aqui.
- **S7.** Fora deste código, e para constar: o MedX (Entrega 2) está noutra branch; o critério "e-mails chegam na caixa de entrada" depende de SPF/DKIM no domínio da Firmare; e a entrega final (repositório, cessão) não se faz em código.

---

## Eixo 1 — Padrões

### Bloqueia o merge

Nenhum achado de padrão bloqueia. As regras inegociáveis olhadas estão cumpridas na parte nova:
- **Regras 1, 2 e 8:** nenhum `toFixed`, `parseFloat` nem `Math.round(x*100)/100` perto de dinheiro ou quantidade. O domínio novo é todo `bigint` (`indicadores/aritmetica.ts`).
- **Regra 7:** todo valor passa por `formatarValorNaTela` ou `formatarDinheiro`.
- **Regras 17 e 24:** nenhum `if` de permissão decide dinheiro no front, e o "hoje" vem sempre do servidor.
- **Regra 21:** o e-mail é mascarado no log (`correio.ts:73`), e os jobs logam só contagens e ids.
- **Migrations:** só arquivos novos, `0097`–`0113`.
- **Linhas de relatório:** nada vai para storage. A impressão usa `postMessage` na mesma origem e busca as próprias linhas.
- **Design:**
  - a tabela vira lista rotulada abaixo de 720 px (`relatorios.css:146-160`);
  - há algarismos tabulares nas colunas de valor;
  - não entrou roxo, gradiente nem emoji. Os gradientes de `carteira.css:3097` e `carteira.css:3232` são anteriores à branch.

### Corrigir agora

**P1. A média dos OKRs é calculada no front, e sobre um conjunto diferente do da reunião.**
- **Onde:** `tela-indicadores.tsx:208-211` e `reuniao-na-tela.ts:47`.
- **O que acontece:**
  - a faixa "Prioridades do trimestre" tira a média de todos os OKRs que tocam o trimestre, inclusive os **encerrados**, porque `listar` devolve todo OKR não arquivado (`okrs.service.ts:116`);
  - a capa da reunião tira a média só dos **ativos**, de qualquer período (`reuniao.service.ts:66,111`).
- **Efeito:** "3 objetivos · média 62%" na tela e "2 OKRs · 70%" na TV, na mesma semana. É o que a regra "o front não calcula" existe para impedir, mesmo usando a função do domínio.
- **Correção:**
  - o servidor devolve `{ quantos, media }` na lista (com a janela do trimestre) e na capa;
  - decidir se encerrado entra. Pelo backlog ("Prioridades do trimestre"), proponho só os ativos.

**P2. Código morto com documentação falsa.**
- **Onde:** `apps/api/src/pacientes/pacientes.service.ts:269-291`.
- **O problema:** `comprasPorPaciente` diz ser "a receita das indicadas do relatório 4", mas o relatório 4 usa `receitaNoPeriodo` (`relatorios/consultas/pacientes.ts:126`). Quem ler a função vai acreditar que o relatório 4 soma LTV vitalício.
- **Correção:** remover.

**P3. `as` sem comentário (CLAUDE.md §6).**
- `apps/web/src/lib/config-do-acesso.ts:17`, `as Partial<ConfigDoAcesso>` sem justificativa e sem parse. Usar o schema de `@fir/contracts` com `safeParse`.
- `apps/api/src/relatorios/motor.ts:236` e `:343`, `k as ChaveDePermissao`. Comentar, ou tipar `pode` do `ContextoDaConsulta` com `ChaveDePermissao`.
- `apps/api/src/relatorios/campanha.service.ts:111-112`, `v as Record<string, unknown>`. Comentar, ou estreitar uma vez numa variável.

**P4. Alvo de toque de 36 px** (design.md, "alvo de toque grande"; o resto da branch usa 44).
- `apps/web/src/components/indicadores/indicadores.css:165`: os botões "Lançar valor" e "Definir meta" do cartão.
- `apps/web/src/components/indicadores/detalhe-do-kpi.css:140`.

### Vira ticket

- **P5. A linha real do gráfico da meta é acumulada no front** (`detalhe-na-tela.ts:381-402`). Só serve para desenhar, mas o último vértice não está preso ao `meta.atual` do servidor: se a série e a meta medirem janelas diferentes, a linha termina longe do número "Valor atual" impresso ao lado. Ancorar o último ponto em `meta.atual`, ou o servidor mandar a série acumulada.
- **P6. N+1 na tela principal** (`tela-indicadores.tsx:467-490`). É uma requisição de série por KPI, e cada uma mede um balde por mês. Com 20 KPIs são 20 rotas e mais de 120 medições a cada filtro trocado. Liga com o R-7 da spec: medir, e se passar do orçamento, uma rota `series?ids=`.
- **P7. Dois formatadores centrais de dinheiro.** Os relatórios usam `formatarDinheiro` de `@fir/ui` (`na-tabela.ts:12`); o resto da aba usa `formatarValorNaTela` de `@fir/domain`. A regra 7 nomeia o domínio. É anterior à branch, mas ela amplia o uso.
- **P8. Duplicação.** `textoDaMenorUnidade` (`na-tela.ts:199-207`) reimplementa `textoDeCentavos` (`lib/dinheiro-digitado.ts:24`). `numeroDoKpi` (`carteira/indicadores-da-clinica.tsx:29`) repete `numeroDoCartao` (`na-tela.ts:89`).
