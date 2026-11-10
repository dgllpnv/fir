# Spec — Ler a planilha real de indicadores (cabeçalhos, semana e Financeiro)

**Estado:** rascunho para o gate de risco · fase 1 (só spec) · autor: `engenheiro-integracoes`
**Seam:** `LeitorDePlanilha` · **Regra pura:** `packages/domain/src/planilhas-indicadores.ts`
**Fonte da estrutura:** uma planilha real de uma cliente da cliente, recebida em 2026-11-10 (arquivo
local, ignorado pelo git). **Este documento descreve só a ESTRUTURA** — cabeçalhos de formulário,
tipos de célula, contagens. Nenhum valor, nome, texto livre ou data dela está aqui, e nenhum teste
ou código desta entrega pode copiá-los: os testes usam dado sintético.

## 1. Problema

Hoje uma planilha real como essa é lida quase vazia. Os títulos de pergunta esperados em
`PLANILHA_DE_INDICADORES` (e `TITULOS_DA_SEMANA`, `TITULOS_DO_MES`) foram escritos a partir da
lista do protótipo, e o casamento é por **igualdade** do nome normalizado. O formulário real
redige as perguntas de outro jeito, e a coluna de semana do formulário real ("primeiro dia da
semana analisada") não está entre os aliases.

Efeito medido na estrutura real: das 4 abas, **a escolha de aba já funciona** (ver 2.1), mas quase
nenhuma coluna de dado casa, e a aba Financeiro ainda tem 5 colunas que o domínio nem conhece.

## 2. O que a planilha real tem

### 2.1 Abas: real → esperada (já funciona, falta o teste que o prove)

A planilha tem 4 abas, todas com o prefixo "Formulário" no nome (a planilha de respostas de um
Forms). `escolherAbasDaPlanilha` já resolve: nome igual ou a **única** aba que contém o nome da
frente como palavras inteiras.

| Aba real (normalizada) | Frente | Como casa hoje |
|---|---|---|
| `formulario trafego pago` | `trafego` | contém `trafego pago` |
| `formulario marketing` | `marketing` | contém `marketing` |
| `formulario comercial` | `comercial` | contém `comercial` |
| `formulario financeiro` | `financeiro` | contém `financeiro` |

Nada a mudar na escolha de aba. Entrega: um teste de caracterização com esses 4 nomes e ordem
embaralhada. Não se acrescenta "Formulário …" como apelido — a regra "contém, se única" já cobre,
e um apelido a mais esconderia o caso ambíguo.

### 2.2 Forma geral de cada aba

- Linha 1 = cabeçalho. Perguntas com `\n` no começo, espaço no fim, `?` e `.` — a normalização
  atual (`normalizarNomeDaPlanilha`) já absorve tudo isso. **Parênteses são descartados** na
  normalização, então "(Cite separadamente…)" some do título comparável.
- Em cada aba há ~35 linhas de dado, mas **só 6 ou 7 têm "Carimbo de data/hora"** (Financeiro: 18
  de 35). As demais (~28) não têm carimbo: foram digitadas à mão, preenchendo a "data da semana".
  É histórico retroativo anterior ao formulário. Consequência: **a data informada é a chave de
  semana de fato**; o carimbo é a exceção. O código já prefere a data informada, mas hoje o alias
  dessa coluna não casa, então todas essas linhas ficam `semana = null` e somem.
- Nas linhas sem carimbo, os campos vêm **esparsos**: em Comercial, só leads do site e leads frios
  são preenchidos; as 3 conversões e os leads de Google/Instagram ficam vazios (5 a 6 de ~34).
- Células de data vêm como **número de série** (a leitura usa `UNFORMATTED_VALUE` +
  `SERIAL_NUMBER`), então não há ambiguidade `d/m` versus `m/d` na planilha real. Mas, na aba
  Financeiro, o carimbo tem três formatos de exibição diferentes (formulário e digitação
  manual) — todos viram serial, ok.
- O "primeiro dia da semana" **nem sempre é segunda**: na estrutura real há sábado (7 a 11 por
  aba), domingo, terça, quarta, quinta, sexta. `semanaDaDataInformada` (segunda de `data + 2`,
  tolerância −2..+4) cobre os 7 dias da semana; sábado vai para a segunda seguinte, o que é a
  intenção ("primeiro dia" digitado como sábado). Entrega: teste com os 7 dias.
- Há **2 a 3 colisões por aba**: duas datas digitadas diferentes que normalizam para a mesma
  segunda-feira. Hoje isso vira `semana_repetida`, e vale "o mais recente" por ordem
  `(semana, carimbo)`. **Linhas sem carimbo empatam** (`carimbo` vazio ordena igual) e a
  desempatada fica na ordem do arquivo — determinística, mas arbitrária. Ver pergunta P7.
- Atraso do envio em relação ao primeiro dia informado: de 4 a 12 dias. Irrelevante quando a data
  informada existe; reforça que o carimbo sozinho (`semanaDoEnvio`) erraria a semana em boa parte
  dos casos reais.
- Coluna "mês": texto ("Outubro") na maioria, mas em **Comercial 4 linhas têm a célula como DATA
  formatada `mmmm yyyy`**, ou seja, número de série. `textoDaCelula` devolve `"45900"`, a
  normalização mantém `45900` e `mesConfere` vira **falso** (aviso `mes_nao_confere` falso
  positivo). Defeito a corrigir (T1).

### 2.3 Mapa cabeçalho real → campo do domínio

Os "aliases" são o texto NORMALIZADO (sem acento, minúsculo, sem parênteses, sem pontuação). São
perguntas de formulário, não dado de respondente. Colunas comuns às quatro abas:

| Pergunta real (normalizada) | Campo | Observação |
|---|---|---|
| `carimbo de data hora` | carimbo | já casa |
| `qual o primeiro dia da semana analisada` | semana informada | **falta alias** (hoje só `semana`, `inicio da semana`…). Serial de data |
| `qual mes sera analisado` / `que mes sera analisado` | mês | **falta alias**; as duas grafias existem (Comercial usa "Que") |

**Tráfego pago**

| Pergunta real | Campo | Tipo |
|---|---|---|
| `quantas campanhas rodaram na semana em questao` | `campanhas` | inteiro |
| `descreva os dados referente a campanha do google` | `google` | texto |
| `descreva os dados referente a campanha do meta` | `meta` | texto |
| `faca uma analise estrategica sobre o trafego pago desse cliente durante essa semana` | `analise` | texto, opcional |

**Marketing**

| Pergunta real | Campo | Tipo |
|---|---|---|
| `quantos novos seguidores chegaram durante esta semana` | `seguidores` | inteiro |
| `quantos criativos foram publicados na semana` | `criativos` | inteiro |
| `qual criativo teve maior performance durante a semana` | `melhor` | texto |
| `informe o alcance total da semana` | `alcance` | inteiro |

(Alcance é numérico na planilha real, com formato de milhar. A pergunta de criativos pede
"cite separadamente vídeos, cards e carrosséis", mas a resposta real é um número só — se vier
"3 vídeos e 2 cards" cai em `invalido`, "Não é número", sem tentar adivinhar.)

**Comercial**

| Pergunta real | Campo | Tipo |
|---|---|---|
| `quantos leads chegaram do site` | `leads_site` | inteiro (já casa) |
| `quantos leads chegaram do google` | `leads_google` | inteiro (já casa) |
| `quantos leads chegaram do instagram` | `leads_insta` | inteiro (já casa) |
| `quantos leads do site foram convertidos essa semana` | `conv_site` | inteiro |
| `quantos leads do google foram convertidos essa semana` | `conv_google` | inteiro |
| `quantos leads do instagram foram convertidos essa semana` | `conv_insta` | inteiro |
| `quantos leads frios fora de perfil de plano chegaram essa semana` | `frios` | inteiro |
| `faca uma analise estrategica sobre o desempenho do comercial durante essa semana` | `analise` | texto, opcional |

**Financeiro** (a aba que o protótipo já marca como "estrutura a confirmar", `provisoria: true`)

| Pergunta real | Campo proposto | Tipo | Colunas preenchidas (de ~35) |
|---|---|---|---|
| `receita da semana` | `receita` (**novo**) | dinheiro | quase todas |
| `despesas da semana` | `despesas` (alias novo) | dinheiro | ~30 |
| `faturamento acumulado` | `acumulado` (**novo**) | dinheiro, **não aditivo** | ~34 |
| `meta de faturamento mensal` | `meta_mensal` (**novo**) | dinheiro, **não aditivo**, opcional | ~15 |
| `ticket medio` | `ticket_medio` (**novo**) | dinheiro, **não aditivo**, opcional | ~11 |
| `top 5` (1ª ocorrência) | `top5` (**novo**) | texto, opcional | ~9 |
| `numero de vendas totais` | `vendas` (**novo**) | inteiro, opcional | ~12 |
| `analise estrategica financeira` | `analise` (alias novo) | texto, opcional | ~22 |
| `top 5` (2ª ocorrência) | ignorada | — | 0 (coluna vazia) |

Decisão de modelagem: **"Receita da semana" NÃO é mapeada para `faturamento` nem para
`recebido`** até a cliente responder P1. As duas chaves existentes continuam com os títulos
antigos como alias, porque metas já salvas apontam para elas (`pl:financeiro|faturamento|…`) e
trocar o significado em silêncio muda o número que alguém está acompanhando.

Os campos `meta_mensal`, `ticket_medio` e `vendas` são esparsos na planilha real: precisam ser
`opcional: true`, senão **cada semana** gera `campo_vazio`. Quais dos demais são obrigatórios é a
pergunta P3.

### 2.4 Cabeçalho duplicado ("Top 5" duas vezes)

Hoje `coluna()` usa `findIndex`: **a primeira ocorrência vence, a segunda é ignorada sem aviso**.
Para texto isso é inofensivo (só se registra "preenchido"). Para dinheiro ou inteiro seria um
defeito silencioso: duas colunas com o mesmo título e uma delas ganha por posição.

Regra proposta:
- Título repetido para campo `texto`: lê o campo como `preenchido` se **qualquer** das colunas
  estiver preenchida (a recepção não perde a resposta por causa de uma coluna sobrando).
- Título repetido para campo `dinheiro`, `inteiro`, carimbo, semana ou mês: **não escolhe**. O
  campo fica `invalido` na linha, e a aba ganha o aviso `coluna_duplicada`
  ("Pergunta repetida na aba: …"), com o título da ESPECIFICAÇÃO (nunca o texto cru da planilha,
  que é entrada do usuário e iria para tela e log). Palpite não vira dado.
- Em ambos os casos, o aviso de coluna duplicada de campo `texto` é só informativo e não rebaixa
  o status da frente.

## 3. Dinheiro: de célula a centavos, sem float

O contrato já é este e **continua o mesmo**: o adaptador transforma número de célula em texto
decimal (`String(n)`), e o domínio faz aritmética de dígitos (`centavosDaCelula`), em `bigint`.
Nada de `parseFloat`, `toFixed` ou `* 100`. Casos a cobrir com teste, todos sintéticos:

| Entrada (sintética) | Resultado | Por quê |
|---|---|---|
| célula numérica `1234.56` | 123456 | caminho normal da planilha real (todas as células de dinheiro da amostra são numéricas) |
| célula numérica `1234.5` | 123450 | uma casa decimal: a meta mensal real chega assim |
| célula numérica com serial `0.1+0.2` (`"0.30000000000000004"`) | `invalido` | mais de 2 decimais: recusa, não arredonda dinheiro |
| célula numérica `1e21` (`"1e+21"`) | `invalido` | notação científica não é decimal simples |
| texto `R$ 1.234,56` | 123456 | formato brasileiro |
| texto `R$ 1.234` | 123400 | milhar brasileiro, nunca 1,234 |
| texto `1234,5` | 123450 | vírgula decimal |
| texto `1,234.56` | 123456 | formato norte-americano, só quando inequívoco |
| texto `42.000` | 4200000 | milhar, nunca 42 reais |
| texto `42000.50` | 4200050 | ponto decimal só quando não pode ser milhar |
| texto `0` e célula `0` | 0 (`numero`) | zero é dado; **não** é vazio |
| célula vazia ou só espaços | `vazio` | ausência, não zero |
| texto `-`, `n/a`, `cerca de 5 mil`, `5k`, `10%`, `(50,00)` | `invalido` | texto livre nunca é adivinhado |
| texto `1.2.3`, `1,,2`, dígitos Unicode não ASCII | `invalido` | `\d` do JS é ASCII |
| negativo `-50,00` | hoje `numero` negativo | ver P5: `despesas`, `acumulado`, `meta_mensal` e `ticket_medio` não deveriam ser negativos |

Propriedades (fast-check, obrigatório por haver aritmética): para todo inteiro de centavos `c`
em faixa segura, formatar em texto brasileiro e em texto decimal e ler de volta devolve `c`
(ida e volta, **sem float**); e nenhuma entrada com mais de 2 casas decimais não nulas vira
`numero`.

**Teto de plausibilidade (proposta para o gate):** valor acima de um limite (sugestão: 10^12
centavos = R$ 10 bilhões) é `invalido`. Evita que um erro de digitação com muitos dígitos entre
como dado e estoure a mediana de `foraDoPadrao`.

**Séries que não somam.** `acumulado`, `meta_mensal` e `ticket_medio` são **níveis**, não fluxos.
A fonte de meta (`metricaDaPlanilha`) já recusa `soma4` de percentual; a mesma lógica recusa
`soma4` para essas três (somar quatro "acumulados" semanais não mede nada). `media4` de ticket
médio também não é a média ponderada, então fica restrita a `ultima` até a cliente decidir (P4).
Isto exige um atributo de métrica (`aditiva: boolean`), não um `if` por métrica.

## 4. Casos de abuso e de risco (insumo para o gate)

### 4.1 Segurança (`especialista-seguranca-appsec`)

1. **Texto de célula é entrada hostil.** Nenhum texto cru da planilha (cabeçalho, resposta
   livre) pode ir em mensagem de erro, tela ou log. Hoje as mensagens usam o título da
   ESPECIFICAÇÃO; manter assim, inclusive para o novo aviso `coluna_duplicada` e para o novo
   alias. Teste: cabeçalho com `<script>`, 10 mil caracteres, `\u0000`, `=HYPERLINK(...)`.
2. **Injeção de fórmula.** Hoje nada é reexportado para planilha/CSV. Fica registrado como
   restrição: se um dia exportarmos, células que comecem com `=`, `+`, `-`, `@` precisam de
   prefixo neutralizador.
3. **Tamanho e quantidade.** Teto de 400 linhas por aba já existe. Falta teto de **colunas**
   (cabeçalho com milhares de colunas faz o `findIndex` por campo custar O(colunas × campos)) e
   de comprimento de célula antes de normalizar (a regex de normalização roda sobre texto do
   usuário). Proposta: 200 colunas, 2.000 caracteres por célula de cabeçalho; excedeu, a aba
   vira `atencao` com aviso estrutural, sem ler.
4. **Sem SSRF e sem arquivo.** Esta entrega não muda `idDaPlanilha` nem o adaptador: continua
   id fixo contra host fixo, sem buscar a URL colada. **Não se introduz upload de `.xlsx`** (seria
   parsing de arquivo do usuário, só em processo isolado, e exigiria ADR). A planilha de
   amostra foi aberta uma vez, localmente, por nós, para derivar a estrutura.
5. **Colisão de semana não pode ser vetor de sobrescrita.** Quem edita a planilha pode empurrar
   uma linha com data de semana alheia e fazer "o mais recente vencer". Não há escrita no
   sistema da cliente, mas há decisão visível ao lado dela: a regra de desempate precisa ser
   explícita e coberta por teste (P7).
6. **Isolamento de cliente.** Nada nesta entrega toca RLS, mas a leitura é por cliente da
   carteira: manter o teste de isolamento da fila existente verde.

### 4.2 LGPD (`especialista-lgpd-saude`)

1. **O Financeiro de uma cliente da cliente é dado comercial sensível** (receita, despesa, meta,
   ticket, vendas). Não é dado pessoal de paciente, mas segue a regra 17: só com a permissão
   `valores`, redação no ponto único, nome de campo monetário (`valor`) na resposta para a
   redação alcançar, **nunca** em mensagem de problema (já é regra do módulo: "mensagem nunca
   carrega valor"). Valem para os campos novos.
2. **Texto livre ("Top 5", "Análise", descrição de campanha, "melhor criativo") pode conter nome
   de paciente, de procedimento ou de profissional.** Hoje só se guarda `preenchido`, o conteúdo
   nunca é gravado nem logado. **Isso não muda**: `top5` e `analise` entram como `texto`. Fica
   proibido, neste spec, qualquer ticket que passe a guardar o texto. Se a cliente quiser ver o
   texto na tela, é nova decisão, com ADR e base legal.
3. **Primeira ocorrência do mês e da semana** são metadado inócuo; **e-mail do respondente** e
   qualquer coluna fora do mapa continuam **não lidas** (já é o contrato: só entram colunas que
   casam com pergunta da especificação).
4. **Log:** os testes novos devem incluir a asserção de que nenhum texto de célula, nem valor
   em centavos, aparece em log nem em mensagem.
5. **Retenção:** sem mudança — a interpretação guarda até 400 linhas por aba, sem texto livre.

### 4.3 Números (`validador-numeros`)

1. **Taxa de conversão mente nas linhas históricas.** Em Comercial, ~28 linhas retroativas têm
   leads do site e **nenhuma** conversão preenchida. `ouZero` soma o ausente como zero, então a
   métrica `taxa_conversao` dá **0%** para semanas em que a conversão simplesmente não foi
   informada. O protótipo faz assim (`+v.x||0`), então corrigir **diverge do protótipo** e
   precisa de decisão de produto + ADR (pergunta P6). Recomendação: `taxa_conversao` e
   `leads_convertidos` são `null` quando **nenhum** `conv_*` está `numero`.
2. **Receita contada uma vez.** "Receita da semana" é fluxo (soma sobre semanas é legítima);
   "Faturamento acumulado" é nível. Quem montar uma meta de "faturamento do mês" por `soma4` de
   receita **e** outra por `ultima` de acumulado vê dois números para o mesmo dinheiro. Na
   amostra, o acumulado coincide com a soma corrente das receitas do mês em **16 de 34** semanas
   e é não decrescente dentro do mês em 25 de 34: **não é consistente**, então o sistema **não
   deriva um do outro** nem mostra um "receita do mês" calculado por soma de semanas
   (P2). Mostra cada campo com seu rótulo e unidade, e mais nada.
3. **Orçamento não é receita** (regra 4): se "Receita da semana" do parceiro incluir
   orçamento aprovado, o número está errado na origem. Pergunta P1.
4. **Ticket médio declarado versus derivado** (`receita ÷ vendas`): não se recalcula. Se
   um dia exibirmos divergência, é racional exato `bigint`, e o arredondamento é o de
   `arredondarRacionalDaPlanilha` (meio para longe de zero).
5. **Aritmética:** tudo `bigint` e racional exato, sem `Number` em centavos. O único `Number` do
   módulo é o do serial de data (inteiro de dias, `isSafeInteger`), e isso fica.
6. **`foraDoPadrao` em série esparsa.** Com 5 a 12 valores num campo opcional, a mediana é
   instável. Não rebaixar a frente por "fora do padrão" em campo opcional com menos de, digamos,
   4 semanas de histórico. Parâmetro a confirmar no gate.
7. **Janela semiaberta e fuso:** nenhuma mudança; as bordas continuam calculadas no fuso da
   clínica (`fusoDaClinica`), e a tolerância −2..+4 de `semanaDaDataInformada` é janela
   `[sábado, sábado)` — registrada nos testes de borda (sábado, sexta, domingo).

## 5. Perguntas em aberto para a cliente (nada abaixo é suposto)

Antes de implementar os campos de dinheiro, pedir **2 ou 3 planilhas de outras clientes**: o
formulário é um modelo único da Firmare ou cada parceiro reescreve as perguntas? Isso decide se
basta uma lista de aliases ou se precisa de **mapeamento de coluna por cliente** (T9).

| # | Pergunta | Por que importa | Recomendação |
|---|---|---|---|
| P1 | "Receita da semana": é **faturamento** (o que foi vendido/atendido) ou **recebido** (o que entrou)? Entra orçamento aprovado? | Decide se vira `faturamento`, `recebido` ou campo novo. Hoje o domínio distingue os dois | campo novo `receita`, sem mapear até responder |
| P2 | "Faturamento acumulado": é o acumulado **do mês** (zera no dia 1)? Quem preenche e de onde tira o número (sistema dele, planilha)? Por que nem sempre bate com a soma das receitas semanais? | O acumulado ora coincide com a soma, ora não. Se for lançado à mão, é declaração, não conta | tratar os dois como declarações independentes; nunca somar nem derivar |
| P3 | Quais campos do Financeiro são **obrigatórios** toda semana? | Define quando a frente fica `ok` ou `atencao`. Na amostra meta, ticket, vendas e top 5 estão quase sempre vazios | obrigatórios: receita, despesas, acumulado; opcionais: meta, ticket, vendas, top5, análise |
| P4 | "Meta de faturamento mensal" e "Ticket médio": servem para alimentar a meta do cliente na carteira, ou só para exibição? | Define se entram como fonte `pl:` (e com qual agregação) | só exibição e `ultima` |
| P5 | Pode haver valor **negativo** (estorno, devolução) em receita ou despesa? | Define a regra `naoNegativo` | receita aceita negativo; os demais, não |
| P6 | Em Comercial, vazio em conversão ou em "leads do Google/Instagram" significa **zero** ou **não informado**? Semanas antigas só têm leads do site e frios. | Decide o 0% falso da taxa de conversão (4.3.1); diverge do protótipo | `null` quando nenhuma conversão foi informada |
| P7 | Duas linhas para a mesma semana (data digitada à mão duas vezes): vale a **mais recente por carimbo**; e se nenhuma tiver carimbo, a **última linha** da planilha? | Hoje o desempate é a ordem do arquivo | com carimbo vence sobre sem carimbo; empate: última linha |
| P8 | "Análise estratégica", "Top 5" e descrições: a clínica **quer ver** o texto na ferramenta, ou basta saber que foi preenchido? | Texto pode ter nome de paciente. Ver o conteúdo exige base legal e ADR | manter `preenchido`; ver o texto só no Google |
| P9 | O primeiro "Top 5" e o segundo "Top 5" são perguntas diferentes (por exemplo, procedimentos e convênios)? A segunda coluna está sempre vazia | Decide se é um erro do formulário a corrigir na origem | corrigir o título na origem; enquanto isso, a duplicada é ignorada para texto |
| P10 | Quem preenche cada aba (o parceiro, o próprio cliente)? E há preenchimento retroativo em lote como o da amostra? | Define o peso do aviso de "campo vazio" em semana antiga e a expectativa de carimbo | semana antiga com campo vazio não rebaixa a frente atual |

## 6. Tickets propostos (fatias verticais)

Cada ticket entrega valor ponta a ponta: o que a pessoa vê muda. Ordem pelo caminho mais curto até
ler a planilha real da cliente.

| # | Fatia | Dono de arquivos | Prova | Bloqueado por |
|---|---|---|---|---|
| T1 | **Aliases de aba e de cabeçalho dos campos que NÃO são dinheiro** (Tráfego, Marketing, Comercial, e carimbo/semana/mês das quatro abas): cada campo ganha `titulos: readonly string[]` (o antigo continua como primeiro alias); `TITULOS_DA_SEMANA` e `TITULOS_DO_MES` recebem os aliases reais; mês em serial de data deixa de gerar `mes_nao_confere`; teste de caracterização da escolha de aba | `packages/domain/src/planilhas-indicadores*.ts` | Vitest: cabeçalho sintético com a MESMA estrutura da real lido por inteiro; propriedade: título normalizado de qualquer alias casa com qualquer variação de caixa/acento/pontuação | nada; é a **fase 2** |
| T2 | **Cabeçalho duplicado e limites** (2.4, 4.1.3): `coluna_duplicada`, teto de colunas e de comprimento | idem | exemplos (Top 5 ×2 texto; dinheiro ×2 inválido) e o caso hostil de 4.1.1 | T1 |
| T3 | **Semana por data informada com os 7 dias** e desempate P7: testes de borda de `semanaDaDataInformada`; ordenação com carimbo vence | idem | exemplos + propriedade: toda data cai em exatamente uma segunda; semana do dia `d` e de `d+7` diferem de 7 dias | T1; P7 |
| T4 | **Campos de dinheiro do Financeiro** (`receita`, `acumulado`, `meta_mensal`, `ticket_medio`, `vendas`, `top5`; alias de `despesas` e `analise`), atributo `aditiva`, `naoNegativo` e teto de plausibilidade | idem | property-based de ida e volta de centavos (3 formatos); recusa de >2 decimais; `soma4` recusada para não aditivas | **gate de risco + P1, P2, P3, P4, P5** |
| T5 | **Taxa de conversão sem zero falso** (4.3.1) | idem | exemplo: leads sem conversão informada → `null` | **ADR de divergência do protótipo + P6** |
| T6 | **Leitura ponta a ponta** da planilha sintética no formato real: `leitor-de-planilha-em-memoria` → `interpretarPlanilha` → `resumirPlanilha` | `apps/api/src/carteira/planilhas/` (fora desta fase) | e2e contra Postgres real: leitura três vezes não duplica nem muda; redação de `valores` na resposta; texto livre ausente do log | T1, T4 |
| T7 | **Tela da planilha**: mostrar os campos novos do Financeiro com rótulo e unidade; avisos de `coluna_duplicada` | `apps/web` (fora desta fase) | typecheck, build, verificação no navegador em 390 px | T4, T6 |
| T8 | **Manual** (capítulo de indicadores): como a planilha deve estar montada | `apps/web/src/...manual` | revisão de texto pela PO | T7 |
| T9 | **Mapeamento de coluna por cliente** (só se as outras planilhas divergirem): a pessoa associa uma coluna a uma pergunta quando o alias não casa; sugerido pelo sistema, **confirmado por humano**, nunca automático por semelhança | domínio + api + web | e2e: mapa não confirmado não é aplicado; trilha de auditoria | **P (planilhas de outras clientes)** |

A **fase 2** autorizada pelo pedido é T1 (apenas domínio, sem os campos de dinheiro). T2 e T3 podem
entrar depois dela no mesmo arquivo. T4 só depois do gate. T5 só depois de ADR.

## 7. O que não está neste spec

- Mudar o adaptador do Google, a fila, a rota ou o banco (T6 em diante).
- Upload de `.xlsx` ou `.csv`.
- Guardar ou exibir texto livre.
- Derivar `receita do mês`, `ticket médio` ou qualquer métrica nova a partir de campos
  declarados.
- Alterar o que meta já salva lê (`pl:financeiro|faturamento|…` continua a mesma chave).

## 8. Pedido de ratificação ao chamador

O código vai carregar **os títulos normalizados das perguntas do formulário real** (lista em 2.3),
em repositório público. São texto de formulário, não dado de respondente, mas vieram de um arquivo
da cliente. Confirmar que pode, ou pedir que se parafraseiem para aliases mais curtos (por
exemplo, só as palavras distintivas, ao custo de casar por "contém", que fica fora do desenho
atual).
