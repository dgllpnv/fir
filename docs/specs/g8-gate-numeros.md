# G8: gate de risco de números (dinheiro e indicadores)

- **Data:** 2026-11-08
- **Autor:** `validador-numeros`
- **Objeto:** o plano `docs/specs/g8-paridade-gestao-inventario.md` (sem código novo). Escopo: todo número de dinheiro e de indicador das seções 2, 7, 8, 9, 10, 11 e 15 do inventário.
- **Fontes conferidas na origem:** `versoes/firmare-gestao-prototipo/index.html` (linhas citadas `L…`), `apps/api/src/carteira/financeiro/gerar-cobrancas.ts`, `apps/api/migrations/0028`, `0031`, `0034`, `apps/api/src/campanhas/campanhas.service.ts`, `packages/domain/src/{dinheiro,cobranca-carteira,portal-grupo}.ts`, ADRs 0013 e 0015.
- **O que foi executado** (não só lido):
  1. Varredura das fronteiras de ritmo de `avaliarMeta` do protótipo, em ponto flutuante contra aritmética exata (`bigint`): **20 divergências** em alvo de 1 a 200, mês de 4 ou 5 semanas.
  2. `agruparCampanhasComSupressao` com uma campanha grande e uma pequena: a pequena sai como `Outras campanhas (1) = 120000` centavos, com o valor exato dela.
  3. O job `executarGeracaoDeCobrancas` rodou contra o Postgres local (competência `2099-01-01`, cliente ativo com mensalidade 0 e benefício de 10% pendente). Gerou a cobrança `0 | 0 | 0 | aberto | vence 2099-01-10` e **consumiu o benefício**. O resíduo foi limpo e o banco local voltou ao estado anterior (conferido com `count(*)`).

---

## 1 · Veredito por item

| Item | Veredito | Motivo principal |
|---|---|---|
| Job de geração de cobranças (base de 1F, PP-4, $1) | **REPROVA** como está | CE-1: o benefício é queimado numa cobrança de R$ 0. Competência calculada em UTC. Sem filtro de mensalidade e vencimento. Dia 10 fixo |
| $1 Situação da mensalidade | APROVA COM AJUSTES | Ajustes 1 a 6 |
| $4 Painel de mensalidades | APROVA COM AJUSTES | Ajustes 7 e 8 |
| L12 e ADR 0015 (benefício) | APROVA COM AJUSTES | Ajustes 2, 9 e 10 |
| P1 KPIs da visão geral (MRR, ticket médio) | APROVA COM AJUSTES | Ajustes 11 a 13 |
| C2 MRR por produto e projeto | APROVA COM AJUSTES | Ajuste 13 |
| L1 Potencial e conversão | APROVA COM AJUSTES | Ajustes 14 e 15 |
| L11 Quem indica | APROVA COM AJUSTES | Ajuste 15 |
| M1, M2, M3, O4 Metas e avaliação | **REPROVA** o texto do plano | "Percentuais em centésimos" não basta: a decisão de ritmo precisa de comparação racional exata (CE-2). Referências que não caem na segunda-feira dobram a soma (CE-4) |
| M4 Lançar metas da semana | APROVA COM AJUSTES | Ajuste 17 |
| V10 Indicadores manuais (variação) | APROVA COM AJUSTES | Ajuste 22 |
| K1, V9, K3, K4 Campanhas | **REPROVA** como desenhado | Só existe receita quando `metrica='receita'`. A atribuição por mês é indefinida. A contagem para N≥5 não tem fonte. A supressão por "Outras" vaza com uma campanha só (CE-3). A sincronização pode sobrescrever o investimento |
| K2 Período | APROVA COM AJUSTES | Ajuste 29 |
| F1 e V12 Uso diário | APROVA COM AJUSTES | Ajustes 30 a 34 |
| S1 Resumo semanal | APROVA COM AJUSTES | Ajustes 35 a 37 |
| R11 e $3 Lembrete de vencimento | APROVA COM AJUSTES | Ajuste 38 |
| W1 Mensagem com valor | APROVA (o inventário já trata) | Teste T-21 obrigatório |

"REPROVA" aqui quer dizer que o item não segue para `/to-tickets` com o desenho atual. Nenhum dos três exige mudar de produto: são as correções numeradas abaixo.

---

## 2 · Contraexemplos congelados (para o `engenheiro-qa-automacao`)

Cada um vira teste com este nome **antes** da correção.

- **CE-1 `gerar-cobrancas: cliente ativo com mensalidade 0 e benefício pendente não gera cobrança e não consome o benefício`.** Cenário: cliente `ativo`, `mensalidade_centavos = 0` (o padrão da coluna, `0031:32`, e hoje não há rota para editá-la, achado 8), benefício de `1000` centésimos. Esperado: nenhuma cobrança, `consumido_em IS NULL`. **Obtido, executado:** cobrança `0/0/0 aberto` e benefício consumido. Na prática, todo benefício criado hoje é queimado na primeira rodada do job. Causa: o `SELECT` de `gerar-cobrancas.ts:76-79` não filtra a mensalidade, e o passo (4) consome sempre que a linha é nova.
- **CE-2 `avaliarMeta: mensal com soma, alvo 100, 1 de 5 semanas passadas, acumulado 18, está No ritmo`.** O valor exato é `18/100 = 0,18 = 0,9 × 1/5`, e a regra `prog ≥ 0,9 × esp` (`L782`) diz "No ritmo". O protótipo em ponto flutuante diz "Atenção". Outros casos da mesma varredura: alvo 50 com v=9; alvo 25 com v=9 e 2 de 5 semanas.
- **CE-3 `supressão de campanhas: uma única campanha pequena não aparece como "Outras campanhas (1)" com o próprio valor`.** Entrada: "Grande" (12 orçamentos pagos, 500000) e "Botox setembro" (1 orçamento, 120000). **Obtido, executado:** `{tipo:"outras", quantidade:1, resultado:"120000"}`. Esconder o nome não protege nada quando há uma campanha só no grupo. Já existe no portal (`portal-grupo.ts:97-115`).
- **CE-4 `meta mensal com soma: dois lançamentos na mesma semana (terça e quinta) não contam a semana duas vezes`.** Hoje `referencia` aceita qualquer dia (`DiaCivil`, `packages/contracts/src/cobranca-carteira.ts:66`) e o `UNIQUE (indicador_id, referencia)` permite 03/11 e 05/11. A agregação "soma das semanas do mês" do protótipo (`agregar`, `L746`, filtro por `mesRef`) somaria as duas.
- **CE-5 `avaliarMeta com prazo, menor melhor: inicial 100, alvo 50, atual 70, progresso 60%`.** Os dois denominadores são negativos (`(70−100)/(50−100)`). A multiplicação cruzada ingênua inverte a desigualdade.

---

## 3 · Fórmulas do protótipo, perigos e a regra que adotamos

### 3.1 Mensalidades ($1, $3, $4, PP-4)

| Cálculo | Protótipo | Perigo | Regra |
|---|---|---|---|
| Vencimento | `min(dia_vencimento, último dia do mês)` em data local (`L709`, `L887`) | Nenhum na fórmula. O nosso fixa o dia 10 (`gerar-cobrancas.ts:51-55`) | `vencimentoDaCompetencia(competencia, diaVencimento)` em `packages/domain`, com a regra 25 e só datas civis (sem `Date` local) |
| Quem é cobrado | `ativo` ou `onboarding` com `dia_vencimento > 0` e `valor_mensal > 0` (`L721`, `L880`) | O nosso cobra todo `ativo`, inclusive mensalidade 0 (CE-1) | Mesmo filtro do protótipo (PP-4) |
| Situação | `diff(venc)` em dias locais: pago, vence hoje, vencida há N, lembrete… (`L710-717`) | O "hoje" vem do relógio do navegador (regra 24) | Situação calculada no servidor, com o hoje no fuso da carteira (ajuste 3) |
| Recebido de total | Soma de `valor_mensal` **atual** dos pagos e de todos (`L723`). Moeda exibida **sem centavos** (`brl`, `maximumFractionDigits:0`, `L503`) | Valor atual em vez do cobrado. Soma em float de reais. Arredondamento a reais na tela | Soma de `valor_centavos` (o snapshot, já com desconto) do **mesmo array** de linhas devolvido, por competência. Exibição pelo formatador central, com centavos |

### 3.2 Receita recorrente (MRR) e ticket médio (P1, C2, S1)

- Protótipo: `mrr = Σ valor_mensal` dos clientes `ativo`+`onboarding` visíveis. `ticket = mrr / cs.length`, com clientes de mensalidade 0 no denominador (`L1279`, `L1298`). Exibido sem centavos.
- Regra: `MRR = Σ mensalidade_centavos` (valor de contrato, **antes** do desconto) dos clientes `ativo`+`onboarding` com `excluido_em IS NULL`, dentro do escopo da sessão (`carteira='minha'` incluído). O ticket médio usa `Dinheiro.media(n)` (meio para cima, `dinheiro.ts:113`, executado: 1000,00/3 = 333,33 e 1000,01/2 = 500,01). Com `n = 0` mostra "—", nunca R$ 0,00.

### 3.3 Potencial e conversão de leads (L1, L11)

- Potencial: `Σ valor_estimado` dos leads fora de `ganho`, `perdido` e `espera` (`L2477`).
- Conversão na prospecção: `round(ganhos / (ganhos + perdidos) × 100)` (`L2478`, `L2481`).
- Conversão no ranking de quem indica: `round(ganhos / total × 100)`, com os leads em andamento no denominador (`L2541`). **São duas definições diferentes com o mesmo nome.**
- Regra para percentual inteiro, sem float: `pct = (200·a + b) div (2·b)`, com `a, b ≥ 0` e `b > 0`. Com `b = 0`, "—".

### 3.4 Metas (M2, M3, O4)

O protótipo (`avaliarMeta`, `L751-788`):

- **Mensal com soma:** `v = Σ semanas do mês`, `esp = passadas / semanasDoMes`, `prog = v / alvo`. "No ritmo" se `prog ≥ 0,9·esp`, "Atenção" se `≥ 0,7·esp`, senão "Abaixo".
- **Mensal com média ou último:** `prog = v/alvo` (ou `alvo/v` se menor é melhor). "Na meta" se bateu, "Atenção" se `prog ≥ 0,9`, senão "Abaixo".
- **Com prazo:** `prog = clamp((v−ini)/(alvo−ini), 0, 1,2)`. Se `alvo = ini`, `prog = min(1,2, v/alvo)` (ou `alvo/v`). `esp = clamp(dias(hoje−início) / max(1, dias(prazo−início)), 0, 1)`.
- Média com uma casa em float (`Math.round(x*10)/10`, `L746`, `L736`). Histórico de três meses: `x/alvo` ou `alvo/x` (`L772`).
- **Divisões por zero que o protótipo não trata:** `alvo/v` com `v = 0` dá `Infinity`. Com `alvo = 0` e maior é melhor, `prog` fica `null` e a meta aparece como "Sem lançamento" mesmo tendo lançamento (`L779`, `L784`). O histórico gera `Infinity%` e `NaN%`.

A regra está no ajuste 16.

### 3.5 Campanhas (K1 a K4, V9)

- Protótipo: cada campanha tem **um mês** (`x.mes`) e dois valores em reais, `receita` e `receita_continuada`. "Valor gerado no mês" é `Σ receita` das campanhas **daquele mês** (`L1966`). O total é `receita + continuada` (`L1478`). O **retorno é um múltiplo**, `total / investimento`, exibido com uma casa e "x" (`L1477`), e não `(r−i)/i`. Do período sai a razão das somas, não a média das razões. A sincronização é `Math.random` (`L2949-2950`).
- Nosso modelo hoje: a campanha tem `periodo_inicio` e `periodo_fim`, que podem cobrir vários meses. **Não há coluna de receita:** ela só existe como `resultado` quando `metrica='receita'` (`0028:105-112`). O `CampanhasService` soma a receita de **todos os tempos** das tarefas da campanha, sem janela de data (`campanhas.service.ts:441-489`). A contagem de "orçamentos pagos" que decide o N≥5 **não é calculada em lugar nenhum** do `CampanhasService`.

### 3.6 Uso diário (F1, V12, R13)

- Protótipo: a janela é `(hoje−7, hoje]` e **inclui hoje** (`L1557`). Os dias úteis são contados pelas **linhas presentes** (`L1559`). `noPrazo = round(prazo/conc·100)`, `conv = round(op/oe·100)`, `ativos = max` diário. Saúde (`L1564-1570`): crítico com três dias úteis seguidos sem uso entre as linhas dos últimos 5 dias, ou com `diasUso ≤ 2`. Bom com `diasUso ≥ min(4, úteis)` e `noPrazo ≥ 80`. Os deltas são a diferença de inteiros já arredondados (`L1588`, `L1630`). No relatório: `round(diasUso/úteis·5·10)/10` e `round(contatos/max(1,úteis)·5)`.
- O nosso job grava "ontem" no fuso da clínica e só para `ativo` (`uso-diario-cliente.ts:108`). Não existe linha de hoje.

### 3.7 Resumo semanal (S1)

- Protótipo (`L2007-2020`): a carteira e o "em risco" respeitam `vis()`. As ações, as campanhas e a equipe **não** respeitam: o texto mistura escopos. "Concluídas nos últimos 7 dias" é `diff ≥ −7`, que são **8 dias civis**. O cabeçalho diz "semana de segunda a domingo", mas as contagens usam janela móvel. As campanhas saem com `resultado de meta_valor`. Quando `metrica='receita'`, isso imprime **centavos crus** (no nosso modelo) e vaza dinheiro sem `valores`.

---

## 4 · Ajustes obrigatórios

### Mensalidades e cobrança

1. **Filtro de geração (PP-4):** gerar só para `status IN ('ativo','onboarding')`, com `mensalidade_centavos > 0`, `dia_vencimento IS NOT NULL` e `excluido_em IS NULL`. Corrige CE-1 na raiz.
2. **O benefício só é consumido se `desconto_centavos > 0`.** Defesa em profundidade, além do ajuste 1. Teste: o benefício sobrevive a uma competência com mensalidade 0 e é aplicado na primeira com mensalidade positiva.
3. **Um único fuso da carteira** (`configuracao_da_carteira.fuso`, T5), usado por cobranças, situação, painel, resumo, rotinas e metas. Hoje há `FUSO_DA_FIRMARE = 'America/Bahia'` num `const` de controller (`prospeccao-carteira.controller.ts:55`) e a cobrança usa UTC (`gerar-cobrancas.ts:38-43`, cujo comentário diz que as regras 22 e 23 "não se aplicam"). Aplicam-se: "vencida há N dias" é uma data de negócio.
4. **O vencimento vem do cliente** (`vencimentoDaCompetencia(competencia, dia)`, regra 25). Property-based: para todo ano entre 2000 e 2100, todo mês e todo dia de 1 a 31, o resultado está no mesmo mês e é igual a `min(dia, últimoDia)`. Casos fixos: dia 31 em fev/2027 → 28/02, em fev/2028 → 29/02, dia 30 em abril → 30/04, dia 31 em abril → 30/04.
5. **Primeira competência e cadência do job.** O cron roda só no dia 1 (`fila-cobrancas.ts:21`). Um cliente cadastrado no dia 12 não tem cobrança do mês de entrada, e o protótipo já mostra essa mensalidade como devida (`L708-717`). Decidir junto com a D-8 (ADR 0015 §2): (a) a competência de entrada é cobrada cheia e o job passa a rodar diariamente (idempotente, `ON CONFLICT DO NOTHING`); ou (b) a primeira competência é a seguinte. Recomendo (a), que é o protótipo. A escolha precisa ser escrita, porque muda dinheiro.
6. **Mudar o `dia_vencimento`** atualiza o `vencimento` só das cobranças `aberto` da competência corrente e das futuras, na mesma transação e com auditoria de→para. Nunca toca valor, chave, `pago` nem `cancelado`.
7. **Painel do mês ($4):** `total = Σ valor_centavos` das cobranças não canceladas da competência, `recebido = Σ` das `pago`, ambos do mesmo array de linhas (ADR 0015, achado 1). A competência é rótulo (`aaaa-mm-01`), e o painel diz "pagas da competência", não "recebido no mês". Pagamento atrasado de outubro feito em novembro conta em outubro. O MRR e esse total são números diferentes (contrato contra cobrado com desconto) e não aparecem rotulados como a mesma coisa.
8. **Cobrança de valor 0 depois de desconto de 100%** não pode aparecer como "vencida há N dias". Situação própria ("sem valor a pagar"), fora do total a receber. Teste com `percentual = 10000`.
9. **O percentual do benefício é fotografado** em `beneficios_de_indicacao.percentual_centesimos` no momento em que o lead vira cliente. Alterar a regra em T5 não muda benefícios pendentes. T5 guarda `percentual_centesimos`, nunca texto (ADR 0015, achado 5).
10. **Benefício para quem indicou sem ser cliente** (`indicador_nome`, `L2962`) não tem cobrança onde ser aplicado. Fica registrado como benefício "fora da cobrança", nunca como desconto numa cobrança qualquer. É decisão de produto: listar na D-8.

### Visão geral e leads

11. **MRR** com a definição de 3.2. Para escopo de grupo, uma linha por clínica e a soma do mesmo array (ADR 0013 §6). Redigido sem `valores`, e o ticket médio também.
12. **Ticket médio** com `Dinheiro.media(n)`. O denominador segue o protótipo (todos os `ativo`+`onboarding` do escopo) **ou** só os com mensalidade > 0, por ADR de produto. O que não pode é ficar implícito. Recomendo só mensalidade > 0, porque cliente de consultoria sem mensalidade puxa o ticket para baixo sem significado. É divergência do protótipo e vira ADR.
13. **Contagens da visão geral fecham:** `bom + atenção + crítico + sem saúde = clientes ativos`. A saúde não registrada é um balde próprio: o protótipo faz `n[undefined]++` e perde o cliente. Todos os KPIs do painel usam **o mesmo escopo** de clientes. O protótipo filtra os clientes por `vis()` mas conta as tarefas vencidas de todos (`L1281`).
14. **Potencial dos leads** exclui `ganho`, `perdido`, `espera` e arquivados. Nunca entra em MRR, meta, receita nem resumo de receita (o mesmo princípio de "orçamento não é receita", regra 4). A conversão do lead em cliente fecha o lead e grava a mensalidade **na mesma transação**: fora dela, o valor aparece ao mesmo tempo como potencial e como MRR.
15. **As duas conversões têm nomes diferentes** no `CONTEXT.md` e na tela: "conversão das encerradas" (`ganhos/(ganhos+perdidos)`, L1) e "indicações que viraram cliente" (`ganhos/total`, L11). Percentual pela fórmula inteira de 3.3.

### Metas

16. **`avaliarMeta` em `packages/domain` com aritmética racional exata.** `prog` e `esp` são pares `{num, den}` em `bigint`, e toda decisão de faixa compara por multiplicação cruzada (`num_p · den_e · 10 ≥ 9 · num_e · den_p`), **normalizando o sinal do denominador antes** (CE-5). Arredondamento só na exibição: percentual inteiro meio para cima e média de R$ por `Dinheiro.media`. O limite de 1,2 é aplicado sobre o racional. Casos definidos, nunca `Infinity` nem `NaN`: `v = 0` com menor é melhor dá progresso máximo (1,2) e "bateu" se `0 ≤ alvo`. `alvo = 0` com maior é melhor: bateu se `v ≥ 0`, nunca "Sem lançamento" quando há lançamento. Histórico com divisor 0 mostra "—".
17. **Referência sempre na segunda-feira** (CE-4). O contrato rejeita outro dia (validação no servidor) e a migration acrescenta `CHECK (extract(isodow from referencia) = 1)`. **Antes** do CHECK, um relatório lista os lançamentos existentes fora da segunda, por indicador. Eles são reconciliados por decisão humana, nunca fundidos ou movidos automaticamente (regra 27). O lançamento semanal de M4 continua com upsert por `(indicador, referencia)`.
18. **Semanas do mês** são as segundas-feiras que caem no mês (`segundasDoMes`, `L747`). Assim, a semana de segunda 30/11/2026 pertence a novembro, mesmo com seis dias em dezembro. Novembro de 2026 tem 5 semanas e dezembro de 2026 tem 4: testar os dois. A "semana da reunião" (`L750`) usa o hoje no fuso da carteira.
19. **Combinações inválidas são recusadas no domínio:** unidade `%` com agregação `soma` (somar percentuais semanais não tem sentido) e agregação `soma` com `valor_inicial ≠ 0` no tipo com prazo, porque subtrair um estoque de um fluxo acumulado não mede nada. A segunda é decisão de produto, então registrar.
20. **A meta não ganha `unidade` própria.** A unidade é a do indicador (o protótipo tem `m.unidade` solta, `L2756`). Fonte "indicador" só aceita o próprio indicador da meta ou um de mesma unidade, validado no servidor. A média em `un` vira décimos só na exibição.
21. **Tipo com prazo, janela de semanas:** o protótipo conta lançamentos com `semana ≥ início` (`L777`), e a semana cuja segunda é anterior ao início fica fora. Seguir o protótipo e testar o caso (início numa quarta).
22. **Variação do indicador (V10):** comparar com a segunda **imediatamente anterior** (`referência − 7`), não com o penúltimo lançamento (`L1525`, que pula lacunas). Com anterior igual a 0, "variação indefinida". O protótipo diz "sem semana anterior", que é falso. Valor em décimos de ponto percentual: `(u−p)·1000 / p`, arredondado meio para longe do zero, com sinal. Sem meta cadastrada, sem chip "Abaixo" (o protótipo compara com `undefined` e mostra "Abaixo").

### Campanhas

23. **`receita_centavos` em coluna própria** em `campanhas_carteira`, independente da métrica. O protótipo mostra receita de toda campanha, inclusive de "convertidos" (`L1456`). Hoje ela só existe quando `metrica='receita'`.
24. **A receita por mês é atribuída pela data do recebimento**, no fuso **da clínica** (regras 22 e 23), e não pelo mês de início da campanha: as nossas campanhas cobrem vários meses. A quebra por competência é calculada **no `CampanhasService`** (uma regra, uma vez) e copiada pelo job para uma tabela filha `(campanha_carteira_id, competencia, receita_centavos, orcamentos_pagos)`, nunca recalculada no job (ADR 0013 §5). Invariante: `Σ competências = receita total` do `CampanhasService`, exatamente.
25. **A contagem de "orçamentos pagos" que decide o k = 5 é definida uma vez**, no `CampanhasService`, com teste. Hoje não existe, e `null` suprime tudo (`portal-grupo.ts:58-63`). Enquanto não existir, nenhuma campanha sincronizada aparece individualizada, e esse é o comportamento certo.
26. **Supressão "Outras campanhas" (CE-3):** o balde só aparece com valor se **a soma** dos orçamentos pagos agrupados for ≥ k. Se não for, aparece sem valor ("campanhas pequenas, valor não exibido") e o total exibido é rotulado "das campanhas exibidas". O total exibido continua sempre igual à soma das linhas visíveis. A granularidade da supressão segue a célula exibida: campanha × mês, tipo × mês e cliente × mês. A política fica com o `especialista-lgpd-saude`. O invariante numérico é meu: nenhum total exibido permite recuperar, por subtração, uma célula suprimida. Corrigir também o portal, que já tem o defeito.
27. **Investimento (D-9):** `investimento_centavos bigint NULL CHECK (≥ 0)`, lançado à mão. **A sincronização nunca escreve essa coluna.** Teste: lançar o investimento, rodar a sincronização 3 vezes, conferir que o investimento não mudou e que a receita foi atualizada.
28. **Retorno = múltiplo,** como no protótipo: `receita / investimento`, em décimos, `(10·r·2 + i) div (2·i)` (meio para cima), exibido "N,Nx". Investimento 0 ou nulo dá "—". No período, razão das somas. Sem retorno individual para campanha suprimida, porque `retorno × investimento` revelaria a receita. "Continuado" fica fora (D-9 e ADR 0013 §5), em branco e nunca 0.
29. **Período (K2):** os meses selecionados viram uma janela semiaberta `[1º do mês inicial, 1º do mês seguinte ao final)`, com as bordas calculadas no fuso de cada clínica para a receita e no fuso da carteira para o rótulo. "Ciclo do contrato" vai de `data_inicio` até `min(data_fim, mês corrente)`, como em `L1466`.

### Uso diário

30. **A janela é de 7 dias completos**, `[hoje−7, hoje)` no fuso da clínica. Hoje nunca entra: o protótipo inclui hoje (`L1557`), e o dia parcial conta como "sem uso" na regra dos três dias.
31. **Dias úteis contados pelo calendário,** não pelas linhas. Dia útil sem linha é "sem dado" e aparece como tal. Ele não sai do denominador (como faz o protótipo, `L1559`, que infla `diasUso/úteis` quando o job falha) e não vira "sem uso".
32. **Percentuais** (`noPrazo`, conversão de orçamentos) pela fórmula inteira de 3.3. `noPrazo` com 0 concluídas dá "—". Conversão de orçamentos acima de 100% (pago de um enviado antes da janela) é exibida como o número, nunca limitada em silêncio. A tela mostra "op de oe" ao lado.
33. **Deltas** são a diferença dos valores **exibidos** (já arredondados), em pontos percentuais, como no protótipo (`L1630`). Assim "Início 33%, Agora 50%, +17" sempre fecha na leitura.
34. **Relatório de uso:** "dias com uso por semana" em décimos, `(2·50·diasUso + úteis) div (2·úteis)`. "Contatos por semana" igual, com `max(1, úteis)`. A receita registrada da janela é `Σ receita_registrada` (bigint) e é redigida sem `valores`.

### Resumo semanal

35. **Um escopo só no texto inteiro** (os clientes visíveis à sessão). Ações, campanhas e equipe filtrados pelo mesmo conjunto.
36. **Uma janela só:** a semana do cabeçalho, `[segunda, segunda+7)` no fuso da carteira, para "concluídas" e para todo contador da semana. O protótipo usa 8 dias móveis (`diff ≥ −7`). É divergência pequena e vira ADR.
37. **Sem `valores`, nenhum valor monetário no texto.** Isso inclui `resultado` e `meta` de campanha com `metrica='receita'`, que no nosso modelo estão em centavos. Com `valores`, esses números passam pelo formatador central, nunca impressos crus. Campanha suprimida (ajuste 26) não aparece pelo nome.

### Rotinas de cobrança

38. **Lembrete de vencimento ($3, R11):** a chave de idempotência é `(rotina, cliente, competência)`, não a data do lembrete. O protótipo usa a data (`L899`), e mudar o `dia_vencimento` cria um segundo lembrete para o mesmo mês. O recuo para o dia útil anterior pode cair no mês anterior (vencimento 01/03 → lembrete 26/02), e a competência continua sendo a do vencimento. "Já pago" (R14) consulta a cobrança daquela competência.

---

## 5 · Testes obrigatórios

### Property-based (Vitest + fast-check, `packages/domain`)

- **T-1** `vencimentoDaCompetencia`: mesmo mês, `= min(dia, último)`, para todo ano, mês e dia (ajuste 4).
- **T-2** `aplicarDesconto` (já existe): somar `percentual = 10000` → cobrança 0 e `mensalidade = 0` → desconto 0, e a propriedade nova "o job não consome quando desconto = 0" no nível de integração (T-12).
- **T-3** Percentual inteiro (`pctInteiro(a, b)`): para todo `0 ≤ a` e `0 < b`, o resultado está a menos de meio ponto de `100a/b` (verificação racional), e `pctInteiro(a, b) ≤ pctInteiro(a+1, b)`.
- **T-4** `avaliarMeta`, oráculo racional: para todo alvo, inicial, valores semanais, sentido, agregação e datas gerados, a faixa devolvida é igual à de um oráculo escrito com frações exatas (`bigint`). Geradores incluem `alvo = ini`, `alvo = 0`, `v = 0`, denominadores negativos e meses de 4 e 5 segundas. Fixos: CE-2 e CE-5.
- **T-5** `avaliarMeta` nunca devolve `Infinity`, `NaN` nem `null` de progresso quando há lançamento (ajuste 16).
- **T-6** Monotonicidade: com maior é melhor e o resto igual, aumentar `v` nunca piora a faixa. Com menor é melhor, o inverso.
- **T-7** `Dinheiro.media` (já existe): `|media·n − total| ≤ n/2` centavos. Média de metas em R$ usa a mesma função.
- **T-8** Supressão: para toda lista de campanhas, (a) `Σ saída = Σ entrada` quando o balde é exibido; (b) nenhum elemento exibido tem `orcamentosPagos < k` sozinho, e o balde exibido tem soma ≥ k; (c) nenhum total exibido menos as linhas visíveis isola uma campanha suprimida (CE-3).
- **T-9** Retorno em décimos: está a menos de meio décimo de `r/i`, e com `i = 0` dá "—".
- **T-10** Uso: `diasUso ≤ úteis do calendário`, e o resultado não muda ao remover uma linha de fim de semana. Remover a linha de um dia útil muda "sem dado", nunca o denominador.
- **T-11** Lançamento semanal: para toda data, `segundaDaSemana(d)` é segunda, `≤ d` e `> d − 7`. A agregação mensal de lançamentos é idêntica para toda permutação da lista.

### Integração (Postgres real)

- **T-12** CE-1, mais: rodar o job 3 vezes numa competência com mensalidade 0 e depois uma com mensalidade positiva. O benefício é consumido exatamente uma vez, na positiva, com `desconto = ceilDiv(m·p, 10000)`.
- **T-13** PP-4: cliente `onboarding` com mensalidade e vencimento gera, `onboarding` sem `dia_vencimento` não gera, `encerrado` não gera.
- **T-14** Competência no fuso: o relógio em `2026-11-30T23:30-03:00` gera a competência de novembro, nunca a de dezembro.
- **T-15** Painel $4: `total` e `recebido` iguais à soma das linhas devolvidas. Cancelada fora do total. Mudar a mensalidade depois não muda o painel (snapshot).
- **T-16** Referência não-segunda recusada (o contrato devolve 400, o banco recusa pelo CHECK). Relançar a mesma semana 3 vezes deixa uma linha, com o último valor e a auditoria de→para.
- **T-17** Sincronização de campanhas 3 vezes: a mesma quantidade de linhas, a receita igual à do `CampanhasService`, `investimento_centavos` intocado, `Σ receita mensal = receita total`.
- **T-18** Receita mensal de campanha na borda do mês no fuso da clínica: recebimento em `31/10 23:30` local fica em outubro, `01/11 00:00` local fica em novembro, cada um exatamente uma vez.
- **T-19** Redação: o usuário sem `valores` recebe `null` em MRR, ticket, potencial, mensalidade, total e recebido do painel, receita e investimento de campanha, receita registrada e meta em R$, em **cada rota** nova (a varredura por rota que o `engenheiro-qa-automacao` já mantém).

### E2E (Playwright)

- **T-20** Resumo semanal sem `valores`: o texto copiado não contém "R$" nem nenhum número igual a um valor monetário do cenário (inclusive campanha de receita).
- **T-21** Mensagem de lembrete de pagamento (W1) sem `valores`: sem valor nem Pix, com o aviso.
- **T-22** Painel de mensalidades num cenário conferido à mão. Três clientes: A com R$ 1.000,00 no dia 31, B com R$ 1.850,33 no dia 10 e benefício de 10%, C com R$ 0,00. Em fevereiro de 2027: A vence 28/02, B é cobrado R$ 1.665,29 (desconto R$ 185,04), C não aparece. Total R$ 2.665,29. Ao marcar A como paga: recebido R$ 1.000,00 de R$ 2.665,29.
- **T-23** Meta mensal com soma, alvo R$ 100,00, novembro de 2026 (5 segundas). Lançados R$ 18,00 na semana de 02/11, e o hoje é 05/11 com reunião na segunda. A tela mostra "No ritmo" (CE-2).

---

## 6 · Para o dono (acrescentar à D-8, não decido aqui)

- Ajuste 5: a primeira competência é a do mês de entrada (protótipo), ou a seguinte?
- Ajuste 10: benefício de quem indicou sem ser cliente.
- Ajuste 12: o denominador do ticket médio.
- Ajuste 19 (segunda parte) e ajuste 36: divergências pequenas do protótipo, que viram ADR do `product-rotina-clinica`.
