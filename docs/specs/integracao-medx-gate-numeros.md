# Gate de risco (números): integração MedX, seções B e C

**Spec sob análise:** `docs/specs/integracao-medx.md` (rascunho de 2026-11-16).
**Revisor:** `validador-numeros`. **Data:** 2026-11-16.
**Veredito:** **reprovado até os 9 bloqueios entrarem no spec.** Nenhum deles pede mudança de produto. São definições que faltam ou que estão erradas, e o código nasce errado se elas não forem escritas antes.

Conferido na fonte: `apps/api/src/financeiro/visao-do-mes.service.ts` (`percentualDaMeta`, `recebidoNoMes`, `metaDe`), `apps/api/src/financeiro/dinheiro-que-entrou.ts`, `apps/api/migrations/0009_financeiro.sql` (`metas_do_mes`), `packages/domain/src/dinheiro.ts`, `packages/domain/src/permissoes.ts` (`CAMPOS_MONETARIOS`), `apps/api/src/comum/redacao.interceptor.ts`, `packages/domain/src/agenda.ts`, `apps/api/src/agenda/sincronizacao.ts`, `packages/contracts/src/painel.ts` (`RecorteDeCaixa`), `packages/domain/src/financeiro/visao-do-mes.ts`.

## O que foi medido (Node 22.17, `tsx`, contra o `packages/domain` atual)

| Entrada | Caminho | Resultado | Esperado |
|---|---|---|---|
| `"1.250"` (R$ 1,25 com 3 casas, no JSON do MedX) | `Dinheiro.deTexto` | **125000 centavos (R$ 1.250,00)** | 125 centavos |
| `"33.3350"` | `Dinheiro.deTexto` | `ValorInvalido` | 3334 |
| `"-10.00"` | `Dinheiro.deTexto` | `ValorInvalido` | -1000 |
| `1.005` (float de `JSON.parse`) | `Math.round(x*100)` | **100** | 101 (meio para cima) |
| `1.255` (float) | `Math.round(x*100)` | **125** | 126 |
| `'{"v":1.005,"w":33.3350}'` | `JSON.parse` com reviver lendo `context.source` | `v: '1.005'`, `w: '33.3350'` | texto exato (funciona no Node 22) |
| pagamento `1.0050` + estorno `-1.0050` | "meio para cima" (rumo a +inf) | 101 + (-100) = **+1 centavo** | 0 |
| o mesmo par | meio para longe do zero | 101 + (-101) = 0 | 0 |
| 3 x `33.3333` | arredondar por pagamento / por dia | 9999 / 10000 | ver A9 |

A primeira linha basta para mostrar o tamanho do risco. `deTexto` foi feito para o que a recepção digita, onde o ponto separa milhar. Num JSON o ponto é sempre a casa decimal. Quem reaproveitar a função que já existe multiplica o valor por mil sem nenhum erro aparecer.

---

## Bloqueios

### N-B1. O spec não diz qual campo é o "valor recebido"
**Problema.** C.1 fala em "pagamentos de faturas" e não diz qual campo soma. O pagamento tem `valor`, `valorPago` e `taxas`. Há três leituras possíveis, e cada uma dá um total diferente:
- `valor`: o que a parcela devia. Conta parcela não paga ou paga a menor.
- `valorPago`: o que entrou de fato. Só que não se sabe se vem bruto ou já sem a taxa do cartão.
- `valorPago − taxas`: o líquido. Esse a FIR não registra em lugar nenhum, porque o `recebimentos.valor` da FIR é o bruto que a paciente pagou.

Se o spec escolhe o campo errado, a "Conferência MedX × FIR" mostra todo dia uma diferença do tamanho da taxa do cartão (bruto contra líquido). Ou mostra receita que não entrou (`valor` de parcela em aberto).

**Ajuste no spec (C.1):**
1. "Valor recebido = `valorPago`, **bruto**. `taxas` nunca é subtraída nem somada: é dado do MedX, não da FIR. Pagamento sem `pagoEm`, ou com `valorPago` nulo ou zero, não conta. `valor` nunca é lido como receita."
2. Novo aceite **C.0, a calibração**, antes de ligar o faturamento em qualquer clínica. A primeira clínica escolhe, no MedX dela, 5 pagamentos reais: Pix, cartão com taxa, pagamento parcial (`valorPago < valor`), parcelado (uma parcela paga e outra não) e um estorno. A leitura da FIR tem de bater **centavo a centavo** com o relatório de recebidos do próprio MedX para esses dias. Se o MedX mostrar `valorPago` já sem a taxa, o spec volta ao gate. A leitura não se adapta em silêncio.

### N-B2. A janela de faturas filtra pela data da fatura, não pela data do pagamento
**Problema.** `GET /financas/faturas` filtra por `dataInicio/dataFim`, que pela documentação é a data **da fatura**. Uma fatura de agosto paga hoje fica fora dos "últimos 45 dias" de faturas, e o pagamento de hoje nunca é lido. É exatamente o caso do parcelamento, que é comum: fatura antiga, parcela paga no mês. Já `GET /financas/lancamentos` filtra por `pagamentoInicio/pagamentoFim`, que é a data certa. O spec cita os dois endpoints e não escolhe um.

**Ajuste no spec (C.1):**
1. "A janela é sobre a **data do pagamento**, sempre."
2. "**Uma fonte só.** Ou `lancamentos?tipo=receber&status=pago&pagamentoInicio&pagamentoFim`, ou faturas mais pagamentos. Nunca as duas para o mesmo período. Se cada pagamento de fatura gera um lançamento `receber`, somar os dois dobra a receita (regra 3)."
3. Recomendação: `lancamentos`. A janela já é a certa, é uma chamada a cada 90 dias e não exige uma chamada por fatura. Duas condições, e as duas entram no aceite C.0: provar com dado real que (a) todo pagamento de fatura gera exatamente um lançamento `receber`, e (b) dá para separar o lançamento que veio de fatura do lançamento que veio de orçamento ou foi lançado à mão. Se (b) falhar, o caminho é faturas + pagamentos, com a lista de faturas lida por uma janela larga o bastante para cobrir parcelamento (12 meses, em janelas de 90 dias) e filtrada **por `pagoEm`** no código.
4. `tipo=pagar` nunca é lido. São despesas.

### N-B3. "Substitui a do mesmo dia" deixa o total velho no dia que zerou, e não separa "não lido" de "zero"
**Problema.** Do jeito que C.3 está escrito, o natural é fazer upsert dos dias que **vieram** na leitura. Um dia em que o único pagamento foi estornado ou apagado no MedX não aparece mais na resposta, e a linha antiga fica com o total velho para sempre. Pelo mesmo motivo, um dia sem linha nenhuma pode ser "não houve pagamento" ou "nunca foi lido", e um KPI de período soma os dois como zero.

**Ajuste no spec (C.3):**
1. "A leitura grava **uma linha para cada dia da janela**, inclusive os de total zero e quantidade zero. Linha existe ⇔ dia lido. Período com algum dia sem linha é **parcial**: o KPI mostra 'leitura incompleta' e a meta medida por MedX dá `null`, nunca um percentual sobre soma parcial."
2. "A substituição é **tudo ou nada por janela**: todas as páginas do cursor lidas, depois uma transação. Se uma página falha, nenhum dia é substituído."
3. "**Dia de borda parcialmente coberto não é substituído.** A janela pedida ao MedX é alargada em 1 dia de cada lado. Só se gravam os dias civis da clínica que estão **inteiros** dentro do intervalo lido. A exceção é hoje, que é lido até agora."
4. "**Trava de leitura vazia**, a mesma ideia de `podeConsiderarRemocoes`. Se a janela inteira vier sem nenhum pagamento e a leitura anterior tinha pagamentos nesses dias, o ciclo aborta e registra erro. Não zera nada. Token sem permissão de finanças respondendo lista vazia não pode apagar 45 dias de faturamento."

### N-B4. Conversão decimal → centavos: proibir `deTexto` e todo `number`, com gramática fechada
**Problema.** C.4 diz "ler como texto", e está certo, mas não diz como. Medido acima: `deTexto` multiplica por mil (`"1.250"` → R$ 1.250,00), e o float de `JSON.parse` erra para baixo (`1.005` → 1,00).

**Ajuste no spec (C.4):**
1. "O corpo da resposta é lido com `JSON.parse` e reviver que captura `context.source` dos campos numéricos (Node ≥ 21, medido no 22.17), ou com parser sem perda equivalente. O valor numérico nunca é usado."
2. "Função nova e pura em `packages/domain`, por exemplo `Dinheiro.deDecimalExterno(texto)`, que devolve `Result<{ centavos: bigint, exatoEmDezmilesimos: bigint, arredondado: boolean }>`. Gramática fechada: `-?\d+(\.\d{1,4})?`. Expoente (`1e3`), mais de 4 casas, `NaN`, string vazia ou valor que não seja número JSON → **erro, e o ciclo da clínica aborta**. Nada de arredondar 5 casas nem de aceitar `1e3`."
3. "`Dinheiro.deTexto` é proibido neste módulo. Teste de arquitetura: `apps/api/src/integracoes/**` não importa `deTexto`, nem chama `parseFloat`, `Number(` ou `toFixed` perto de valor."

### N-B5. "Meio para cima" não é simétrico, e pagamento mais estorno sobra um centavo
**Problema.** Medido: com meio para cima (rumo a +inf), `+1,0050 → 1,01` e `−1,0050 → −1,00`. O pagamento e o estorno dele somam **+R$ 0,01**. Hoje não se sabe se o MedX devolve valor negativo, mas o spec precisa ser correto nos dois casos.

**Ajuste no spec (C.4):** "Arredondamento **meio para longe do zero** (simétrico), na 2ª casa, em aritmética de `bigint` sobre o valor em dezmilésimos: `sinal × ((|d| + 50) / 100)`. Com isso, `arred(−x) = −arred(x)`." A propriedade correspondente está na lista de testes. Se a calibração (N-B1) mostrar que o MedX nunca devolve negativo, o spec diz isso e **recusa** negativo como entrada inválida, em vez de arredondar.

### N-B6. Meta "medida por MedX": dois percentuais diferentes para a mesma meta, e o passado reescrito
**Problema 1, divergência.** Hoje o percentual da meta sai de **dois** lugares: `percentualDaMeta()` (a rota que a equipe lê, linha 129) e `visaoDoMes()` no domínio (`percentualDaMeta` e `metaRestante`, `visao-do-mes.ts:346-347`). Os dois calculam sobre `recebidoNoMes` da FIR. Se o spec trocar só a rota, a Visão do mês mostra 62% e o atalho da equipe mostra 71% para a mesma meta, no mesmo mês, e o "Faltam R$ X" contradiz o percentual.

**Problema 2, retroatividade.** A configuração "medida por" é da clínica (T1, `integracoes_da_clinica`), e `metas_do_mes` não sabe com que régua cada mês foi medido. Se alguém troca FIR por MedX em novembro, o atingimento de março a outubro muda junto, sem rastro. É comparação entre meses com réguas diferentes, e o próprio `visao-do-mes.service.ts` (linhas 68-70) diz que não pode.

**Problema 3, nome.** `PercentualDaMeta.recebido` carregando total do MedX é um campo cujo nome mente.

**Ajuste no spec (C.7):**
1. "Migração expand: `metas_do_mes.medida_por text NOT NULL DEFAULT 'fir' CHECK (medida_por IN ('fir','medx'))`. Ela é **gravada com a meta** (copiada da configuração no momento em que a meta é definida) e só muda se alguém editar a meta daquele mês, o que fica na trilha. A configuração da clínica é só o padrão dos meses novos."
2. "Uma função de domínio, `medidoParaAMeta({ medidaPor, recebidoFir, faturamentoMedx, coberturaMedxCompleta })`, devolve `Dinheiro | null`. **Ela é o único lugar que escolhe a fonte.** `visaoDoMes` recebe esse valor como entrada (não recebe mais o recebido para calcular a meta), e `percentualDaMeta()` chama a mesma função. Nunca existe `recebidoFir.mais(faturamentoMedx)`."
3. "Medida por MedX com cobertura incompleta (N-B3), ou sem nenhuma leitura no mês: `percentual = null` e `metaRestante = null`. Nunca 0%."
4. "O contrato ganha `medidaPor` e `medido` (não reaproveita `recebido`). `recebido` continua sendo **sempre** o da FIR."
5. "Para quem não tem `valores`: atravessam `percentual`, `medidaPor` e `lidoEm`. `meta`, `medido` e `recebido` saem `null` pela redação central."

### N-B7. Regra 6: total por dia do MedX ou da FIR antes do caixa fechado entrega o esperado
**Problema.** A "Conferência MedX × FIR" (C.6) mostra os dois totais por dia e os "dias com diferença". O total FIR de hoje **é** o esperado do caixa de hoje, somadas as formas. Na clínica que lança o mesmo pagamento nos dois sistemas, o total MedX de hoje também é. Quem tem `valores` e `caixa`, e confere a gaveta, passa a conferir com o esperado à vista. O produto já resolveu isso no Painel e na Visão do mês com o **corte de caixa fechado** (`RecorteDeCaixa` em `packages/contracts/src/painel.ts`: "`faturamento` passa pelo corte de caixa fechado"). O spec do MedX não herda o corte.

**Ajuste no spec (C.6):** "Todo número **por dia**, dos dois lados (MedX e FIR), e a lista de 'dias com diferença' passam pelo `RecorteDeCaixa`. Só saem dias até `ateODia`, e a resposta declara `ateODia` e `diasSemCaixa`. O total do período segue a mesma regra que a Visão do mês já usa para `recebido`." Teste de transporte: a resposta HTTP do KPI, pedida antes do fechamento do caixa de hoje, não contém nenhum número de hoje.

### N-B8. Agenda: consulta remarcada para depois de +60 dias vira "sumiu", vai para Recontatar e nunca volta
**Problema.** No iCal o feed é a agenda **inteira**: uma consulta remarcada do dia 10 para o dia 75 continua no feed e vira `reagendar`. No MedX a FIR lê só `[hoje, hoje+60)`. A mesma remarcação desaparece da leitura, entra em `sumidos` (`sincronizacao.ts:251`, filtro `k.inicio < janela.ate` com o `inicio` **antigo**) e é desmarcada, indo para Recontatar. Quando o dia 75 entra na janela, o cartão já está numa etapa fora de `ETAPAS_QUE_A_AGENDA_MOVE` e `decidirPelaAgenda` devolve `nada`. Resultado: a recepção liga para uma paciente que já está marcada, e a consulta real fica sem cartão para confirmar. É o "desloca uma data" e o "cartão faltando" do aceite B.8.

**Ajuste no spec (B.2):** "No MedX, 'sumiu da agenda' só vale depois de confirmar por **id**. Se a API tem leitura por id, ela é chamada para cada sumido antes de desmarcar: achou com nova data → `reagendar`; achou cancelado → `desmarcar('cancelado')`; 404 → `desmarcar('removido')`. Se não tem, o sumido só desmarca quando também está ausente de uma leitura de presença até `DIAS_PARA_CRIAR` (365 dias, 12 janelas de 31), feita no mínimo 1x por dia." Novo e2e: remarcar do dia +10 para o dia +75 não desmarca, e o cartão continua com a recepção.

### N-B9. Agenda: o horário "UTC−03" sem regra de leitura desloca todo cartão em 3 horas
**Problema.** A documentação diz "horários em UTC−03" e não diz se a string traz offset. `new Date('2026-11-20T09:00:00')` sem offset é interpretado no fuso **do processo**. O container roda em UTC (CLAUDE.md §8), então o cartão das 09:00 aparece às 06:00 na Bahia, e o das 21:30 muda **de dia**. O `leitor-ical.ts` resolve isso para o iCal (`Date.UTC` com fuso explícito), mas o spec do MedX não diz nada.

**Ajuste no spec (B.1):**
1. "O horário do MedX é convertido em instante UTC **na borda do adaptador**, por uma função pura testada. Sem offset na string, aplica-se o fuso do provedor (`-03:00`, constante do adaptador MedX, não da clínica). Com offset, ele é respeitado. Offset diferente de `-03:00` é registrado no resumo (quantidade, sem conteúdo)."
2. "Os parâmetros `Inicio` e `Fim` saem de `inicioDoDia(hoje, fusoDaClinica)` e `inicioDoDia(hoje+31, fusoDaClinica)`, convertidos para o relógio de parede `-03:00`."
3. Aceite C.0/B.8: numa clínica em fuso diferente de `-03` (se houver entre as 4; senão fica registrado como risco), uma consulta marcada às 09:00 locais aparece às 09:00 no cartão.

---

## Ajustes

### A1. A janela de 45 dias deixa meio mês anterior congelado
No dia 20 do mês M, 45 dias cobrem do dia ~6 de M−1 em diante. Os dias 1 a 5 de M−1 ficaram parados na última leitura, e o resto do mês continua mudando. O mesmo mês fica com duas idades. Uma fatura cancelada ou um pagamento corrigido no MedX 46 dias depois nunca aparece.
**Ajuste (C.1):** "Toda hora: do **dia 1º do mês anterior** até agora (no máximo 62 dias, uma chamada de 90). Uma vez por noite: releitura dos últimos **13 meses** em janelas de 90 dias. O selo 'lido do MedX às HH:MM' de um período é o **`min(lido_em)`** dos dias dele, nunca o mais recente." Assim o mês da meta e o anterior estão sempre frescos, e todo o resto tem no máximo um dia.

### A2. Status da fatura, cancelada depois de paga, estorno
- **Não** filtrar por `status=fechada`. Fatura `aberta` com uma parcela paga tem dinheiro que entrou. O que conta é ter pagamento com `pagoEm` na janela.
- `cancelada` com pagamento: **não entra no total**. A quantidade dessas entra no resumo técnico (`pagamentosDeFaturaCancelada`), sem valor. A calibração C.0 confirma no MedX se cancelar exige estornar antes. Se exigir, o caso não existe e o resumo fica sempre zero, o que também é informação.
- `pendencia`: o significado fica para a C.0. Até lá, conta igual a `aberta` (pagamento com `pagoEm` conta).
- Estorno: só os três jeitos possíveis existem (pagamento some, pagamento negativo, fatura cancelada). Com N-B3 (zera o dia) e N-B5 (simétrico), os três dão o número certo **dentro da janela**. Fora dela, A1.

### A3. Orçamento nunca é receita, inclusive o sinal do orçamento convertido
- `tipo=orcamento` nunca é pedido, e o teste afirma que a URL montada contém `tipo=fatura` (ou, com lançamentos, que o filtro de origem exclui orçamento).
- Orçamento `convertido` vira fatura com `orcamentoOrigemId`. Se o MedX deixa registrar sinal no orçamento, a C.0 mede se o pagamento **passa** para a fatura (conta uma vez, pela fatura) ou **fica** no orçamento (aí é perdido, e isso se documenta em vez de "consertar" lendo orçamento).
- Nenhum campo do MedX é mapeado para `valorOrcamento`, e a tabela de leitura não tem coluna de orçamento.

### A4. O que é "dia de pagamento"
O spec precisa dizer que forma tem `pagoEm`:
- **Só data** (`aaaa-mm-dd`): é o dia civil **do MedX**, e é gravado como está. Converter uma data para instante e de volta para dia em outro fuso troca o dia.
- **Instante**: convertido como em N-B9 e reduzido a `diaCivil(instante, fusoDaClinica)`.

A C.0 mede também se `pagamentoFim` é **inclusivo ou exclusivo**, com um pagamento às 23:59 do último dia e outro às 00:00 do seguinte. A janela interna é sempre `[início, fim)` (regra 23) e se adapta à semântica medida na hora de montar o parâmetro.

### A5. Concorrência e ordem das leituras
"Um ciclo por clínica de cada vez (advisory lock por `clinica_id`). `lido_em` é o **início** da leitura, e a substituição só grava se `lido_em` novo > `lido_em` gravado." Sem isso, uma leitura lenta das 10:00 que termina às 10:05 sobrescreve a leitura das 10:01 com dado mais velho.

### A6. Histórico das substituições
"Uma linha de histórico **só quando muda** (total ou quantidade), com dia, total e quantidade antigos e novos, `lido_em` e id da leitura. Append-only, `clinica_id NOT NULL`, RLS." Sem o "só quando muda", são 24 × 62 linhas iguais por dia por clínica, e a mudança real some no meio delas. O histórico marca `mesFechado = true` quando o dia pertence a um mês anterior ao corrente. Essa é a mudança que a gestora precisa ver.

### A7. Nomes dos campos novos e redação (regra 17)
O spec tem de fixar os nomes **agora** e registrá-los em `CAMPOS_MONETARIOS` no mesmo PR:
- `faturamentoNoMedx`, `recebidoNaFir`, `diferencaMedxFir`, `medido`, `totalAntigo`, `totalNovo`, `totalExato`.
- Nada de `total` genérico: ele não está na lista e colidiria com contagens.

Todo campo de dinheiro no contrato usa `centavosNaSaida`, senão `teste/campos-de-dinheiro-registrados.test.ts` não o encontra. A tela do superadmin (espaço `operador`, que já redige tudo) mostra só contagens. Teste de redação por rota, sem `valores`: KPI MedX, Conferência e `/meta` não trazem nenhum centavo.

### A8. O lado FIR da Conferência é uma função que já existe
"O total FIR por dia é `recebidoNoMes` (`DINHEIRO_QUE_ENTROU`, sem estornado, sem tarefa excluída), **sem** Outras entradas, com a mesma `janela()` e o mesmo fuso." Não pode existir uma segunda consulta de "quanto entrou". Sinal da diferença: `diferencaMedxFir = MedX − FIR`, escrito no spec e no rótulo da tela.

### A9. Arredondar por pagamento ou por dia
Medido: 3 × `33,3333` dá R$ 99,99 por pagamento e R$ 100,00 por dia. A recomendação é **manter por pagamento**, como o spec diz. Dinheiro que se moveu é inteiro em centavos, e só assim a soma dos dias fecha **exatamente** com o total do período e do mês (a soma por dia arredondado não fecha). **Mais:** gravar no dia também `total_exato` em dezmilésimos (`bigint`). A Conferência mostra o resíduo de arredondamento do período quando ele não é zero ("R$ 0,01 de arredondamento do MedX"), e quem compara com a tela do MedX entende a diferença em vez de procurá-la.

### A10. Janelas da agenda
Janelas contíguas `[d, d+31)` e `[d+31, d+60)`, com borda calculada no fuso da clínica. **Dedupe por id** entre as janelas, porque o filtro pode ser por sobreposição e a consulta que cruza a borda vem duas vezes. Uma página ou janela que falha **aborta o ciclo inteiro**, nada é conciliado (é o "tudo ou nada" que `sincronizacao.ts` já promete). A trava de leitura vazia (`podeConsiderarRemocoes`) roda **por janela**: a segunda janela vazia com futuros conhecidos nela não desmarca nada, mesmo que a primeira tenha vindo cheia.

### A11. Teste de arquitetura da seção C.2, mais forte
Além de "só indicadores e integração referenciam a tabela": o módulo de integração **não** referencia `recebimentos`, `recebimento_partes`, `caixas_do_dia` nem `outras_entradas`, e o `Migrador` e a conferência da regra 28 não leem `leituras_de_faturamento_externo`.

---

## Notas

- **N1.** Crédito ou haver da paciente no MedX (pagou adiantado e usou depois) pode aparecer como dois pagamentos. A C.0 verifica. Se acontecer, o pagamento cuja forma é "crédito" sai do total.
- **N2.** Se o fuso da clínica muda, todos os `dia` gravados ficam na régua antiga. Mudar o fuso tem de disparar a releitura de 13 meses (A1).
- **N3.** A equipe sem `valores` vê o percentual MedX e o percentual FIR da mesma meta. A razão entre os dois vaza a proporção, não valor nenhum. Aceitável, e fica registrado.
- **N4.** "UTC−03 fixo" contra `America/Sao_Paulo`: se o horário de verão voltar, as duas leituras divergem em 1 h. O adaptador fica com a constante `-03:00` como a documentação diz, e a C.0 confirma com o MedX.
- **N5.** Pagamento com `valorPago > valor` (juros, multa) entra pelo `valorPago`. É o mesmo princípio da conta a pagar da FIR, "o valor pago, nunca o valor da conta" (`visao-do-mes.service.ts:306`).

---

## Propriedades que o T5 (e o T7) tem de provar com fast-check

Exemplo escolhido a dedo não basta. Cada uma abaixo é propriedade, com gerador de decimais de 0 a 4 casas, com sinal, com zeros à direita (`"1.2500"`) e com valores perto de `.xx5`.

1. **Texto exato.** Para todo inteiro `d` em dezmilésimos, o texto JSON canônico de `d/10000` passa por `deDecimalExterno` e volta com `exatoEmDezmilesimos === d`. Inclui `"1.250"` → 1250 dezmilésimos, nunca 12.500.000.
2. **Arredondamento correto.** `|centavos × 100 − exato| ≤ 50`, e quando é exatamente 50 o sinal de `centavos × 100 − exato` é o mesmo de `exato` (longe do zero).
3. **Simetria.** `arred(−x) === −arred(x)`. Corolário: `arred(x) + arred(−x) === 0`, o caso do pagamento e do estorno.
4. **Idempotência sobre centavo.** Entrada com ≤ 2 casas: `centavos × 100 === exato` e `arredondado === false`.
5. **Entrada inválida é erro.** Mais de 4 casas, expoente, vazio, `NaN`, separador de milhar: sempre `erro`, nunca um número.
6. **Soma por dia.** Para toda lista de pagamentos com dia: `Σ_dias total(dia) === Σ_pagamentos centavos(p)`. Nenhum pagamento em dois dias, nenhum perdido.
7. **Independência de ordem.** Embaralhar os pagamentos (e as páginas do cursor) não muda nenhum total diário.
8. **Período fecha.** Para toda partição de `[a, b)` em subperíodos: `total([a,b)) === Σ total(sub)`. A soma é de centavos por dia, nunca de dias arredondados.
9. **Resíduo limitado.** `|Σ centavos × 100 − Σ exato| ≤ 50 × n`.
10. **Substituição é função da última leitura.** Para toda sequência de leituras da mesma janela, o estado final da tabela é igual a aplicar só a última. Um dia ausente da última leitura (estorno total) termina com 0, nunca com o valor anterior.
11. **Idempotência três vezes (regra 26).** Ler três vezes os mesmos dados não muda nenhum total e não cria linha de histórico.
12. **Borda de dia, em fuso.** Para todo instante gerado e para fusos `America/Bahia`, `America/Manaus`, `America/Noronha` e `America/Rio_Branco`: o pagamento cai em exatamente um dia, que é `diaCivil(instante, fuso)`. Pagamento às 23:59:59.999 e às 00:00:00.000 cai em dias diferentes.
13. **Meta nunca soma.** Para todo `(recebidoFir, faturamentoMedx, medidaPor)`, `medidoParaAMeta` devolve exatamente um dos dois, ou `null`. Nunca `recebidoFir + faturamentoMedx`. O percentual da rota `/meta` é igual ao da Visão do mês para o mesmo mês.
14. **Retroatividade.** Trocar a configuração da clínica de `fir` para `medx` não muda o percentual de nenhuma competência com meta já gravada.
15. **Orçamento invisível.** Para toda resposta gerada que mistura `tipo=fatura` e `tipo=orcamento`, o total é igual ao da resposta sem os orçamentos.
16. **Agenda: hora.** Para toda string `aaaa-mm-ddTHH:mm:ss` sem offset, `horaCivil(paraInstante(s), 'America/Bahia') === HH:mm`, e o dia não muda.

E2e com Postgres real, além do que o spec já lista: dia zerado por estorno; página 2 de 3 falhando (nada muda); leitura vazia com histórico (aborta); duas leituras concorrentes fora de ordem; KPI pedido antes do caixa de hoje fechar (nenhum número de hoje na resposta HTTP); remarcação de +10 para +75 dias (não desmarca).
