# Gate de números — `correcoes-po-2026-11-09` (A3, A4, B1, B3)

`validador-numeros`, 2026-11-09, **sobre o spec, antes do código**. Fontes conferidas:
`campanhas.service.ts` (montar, L435-498), `recebimentos.service.ts` (L120-250),
`0020_campanhas.sql`, `0006_rotina.sql` (`recebimento_por_tarefa`), `jornada/funil.service.ts`,
`jornada/jornada.service.ts`, `jornada/fechamento.service.ts`, `programas/montador.service.ts`
(`ratear`), `painel-geral/painel.service.ts` e `metricas-diarias.ts`,
`carteira/campanhas/sincronizar-campanhas.ts`, `migracao/conferencia.service.ts`,
`domain/codigo-de-barras.ts`, `estoque/itens.service.ts`, protótipo L1390-1394, L1645-1670,
L2792-2836, L4831, L4995-5060, L5195-5205.

Convenção: **[bloqueia]** precisa entrar no spec/tickets antes do código; **[exige teste]** é
condição de aceite; **[decisão]** precisa de resposta do produto, com recomendação.

---

## A3 · Campanha na tarefa, no recebimento e no paciente

**O que está certo no desenho atual, e que o spec preserva:** a receita da campanha sai de um
caminho só (`campanhas → tarefas.campanha_id → recebimentos.tarefa_id`). Cada recebimento tem
**no máximo uma** tarefa, cada tarefa **no máximo uma** campanha, e `recebimento_por_tarefa`
deixa no máximo **um recebimento vivo por tarefa**. Por construção, um pagamento cai em zero ou
uma campanha, uma vez. O spec só acrescenta escritas em `campanha_id`. O que pode quebrar é o
que vem abaixo.

Cenário de referência, conferido à mão (centavos):

| Passo | Receita C |
|---|---|
| P1: cartão "Consulta realizada" com campanha C, orçamento R$ 3.000,00 (`valor_orcamento = 300000`) | **0** (regra 4) |
| P1: fechar com entrada 100000 e aberto 200000 (recebimento no próprio cartão) | **100000**. Não é 300000 (negócio) nem 200000 (aberto) |
| P1: avulso "saldo" de 50000 com campanha C | **150000** |
| P2: "Consulta realizada" com campanha C sem pagamento, mais avulso "consulta" de 20000 com campanha C | **170000** (o atendimento não tem recebimento, então não dobra) |
| P1: reabrir o cartão (estorna os 100000) | **70000** |
| Trocar a campanha do avulso de P2 de C para D | C = **50000**, D = **20000**, C + D = 70000 (sem mudança) |

- **N-1 [bloqueia] Um caminho só para a receita da campanha.** `pacientes.campanha_id` **nunca**
  entra na receita: ele serve para sugerir a campanha e para contar quem chegou por ela. Proibido
  qualquer `OR p.campanha_id = cp.id` ou `UNION` com programa/paciente no `montar`: com dois
  caminhos, um recebimento de uma paciente "da campanha" numa tarefa "da campanha" é somado duas
  vezes. As sessões do programa **não herdam** campanha (o protótipo grava `campanhaId:""` nas
  sessões, L995/L1849). Herdar mudaria a receita, e isso pede ADR.
- **N-2 [bloqueia] Hoje há três definições de "receita por campanha", e só duas coincidem.**
  `CampanhasService.montar` e `sincronizar-campanhas` filtram `status='concluida'`,
  `paciente_id IS NOT NULL` e `tipo ∈ TIPOS_DE_RECEITA ∪ (TIPOS_PAGAVEIS ∧ valor>0)`.
  `conferencia.service.ts` (§6, usada na migração pela regra 28) **não filtra tipo nem paciente**.
  Enquanto nenhuma tela vinculava campanha, as três davam o mesmo número. A A3 abre escrita
  manual, e a diferença passa a poder aparecer. Exigir uma das duas saídas: o mesmo fragmento SQL
  (constante, como `DINHEIRO_QUE_ENTROU`) usado nos três lugares, **ou** um teste que monte o
  cenário acima e prove `montar = Σ mensal = conferência` por campanha.
- **N-3 [exige teste] O recebimento avulso grava `campanha_id` na tarefa que ele mesmo cria**
  (`INSERT INTO tarefas`, L194). Não grava num segundo lugar: `recebimentos` não ganha
  `campanha_id`. A validação da campanha (da clínica, não excluída) roda **depois** de
  `porRequisicao`, como os avisos (ajuste 3). Assim, o duplo toque com o mesmo `requisicaoId`
  devolve a linha já gravada, com a campanha do primeiro pedido, e não dá 409 nem cria segunda
  tarefa, mesmo que a campanha tenha sido excluída entre os dois toques.
- **N-4 [bloqueia] Editar sem tocar na campanha não pode limpar a campanha.** O contrato de
  `EditarTarefa` precisa de três estados: ausente = mantém, `null` = remove, id = troca. A lista
  de vinculáveis (`campanhasAtivasPara`, L2826) **inclui a campanha atual** mesmo que esteja
  encerrada há mais de 30 dias (`c.id===atual`). O servidor aceita o id igual ao atual mesmo com
  a campanha excluída (soft delete). Sem isso, editar a descrição de uma tarefa de uma campanha
  antiga manda "Nenhuma" (o select não tem a opção), a receita **some** da campanha antiga e a
  conferência da regra 28 reprova a clínica depois da migração.
- **N-5 [decisão] Trocar a campanha de uma tarefa já paga.** O protótipo deixa (L1654). Com
  receita derivada, a troca move **todo** o recebimento de A para B, inclusive meses passados.
  A carteira acompanha, porque `sincronizar` relê e zera os meses existentes. Não há como dobrar:
  a coluna é uma só. **Recomendação:** seguir o protótipo e permitir. A trilha `de → para` já
  vem do trigger de auditoria de `tarefas`, e a tela avisa "o valor pago passa para a campanha
  B". Se o produto preferir travar (409 quando há recebimento vivo), vira ADR, porque diverge do
  protótipo. Nos dois casos vale a invariante: `Σ receita(campanhas)` antes = depois.
- **N-6 [bloqueia] O índice `tarefa_viva_da_campanha` foi feito para a importação, e a criação
  manual passa a esbarrar nele.** Ele é `(clinica, campanha, paciente)` entre as **abertas**,
  sem olhar o tipo. Caso real: a importação criou "Ligação" aberta para P em C, P aceita, e a
  recepção agenda "Consulta agendada" com campanha C antes de concluir a ligação. Resultado:
  **409**. A recepção escolhe "Nenhuma", e a conversão e a receita dessa consulta saem da
  campanha. O protótipo só confere na importação (L1765), e `criarTarefa` não confere (L1394).
  Outros caminhos que batem no mesmo índice:
  - editar a série (o protótipo propaga `campanhaId` para todas as abertas da série, L1668);
  - reabrir uma tarefa concluída (`status → aberta`);
  - a ação `reabrir` da jornada.

  **[decisão] Recomendação:** acrescentar `tipo` ao índice, com migration nova, numerada depois
  das reservadas. A reimportação do mesmo arquivo continua idempotente (mesmo tipo) e o fluxo
  ligação + consulta passa. **Mínimo, se o índice ficar como está:** 409 legível em **todos** os
  caminhos acima, dizendo qual tarefa aberta já existe. O spec hoje só cita a violação na
  criação e na edição.
- **N-7 [exige teste] Janelas de data das campanhas.** `inicio` e `fim` são `date` civis,
  fechados em dia, que é o mesmo que a semiaberta `[início(inicio), início(fim+1))` em instantes.
  Todas as comparações usam `hoje = diaCivil(relógio do servidor, fuso da clínica)`, nunca uma
  data vinda do cliente.
  - Ativas hoje (cadastro "Chegou por uma campanha?"): `inicio <= hoje AND fim >= hoje`.
  - Vinculáveis (tarefa, recebimento): `fim >= somarDias(hoje, -30) OR id = atual`. O limite
    `fim = hoje−30` entra e `hoje−31` não entra.
  - Se alguma tela pedir "ativas no mês M": `inicio < primeiro(M+1) AND fim >= primeiro(M)`.
    Nunca `fim <= último(M)` nem `BETWEEN`.
  - A receita da campanha **não tem janela de data**: é o que entrou nas tarefas dela, como no
    protótipo (`statsCamp`). Uma tela que recortar por mês usa `recebido_em` com `janela()` do
    domínio, como `sincronizar` (`AT TIME ZONE fuso`).
- **N-8 [exige teste] A lista de vinculáveis para quem não tem a permissão `campanhas` devolve só
  `{id, nome, inicio, fim}`.** Teste de transporte (resposta HTTP, não a tela): nenhuma chave de
  `CAMPOS_MONETARIOS` nem `meta`/`receita`/`resultado`, com e sem `valores`.

**Testes exigidos (A3):**
1. *Property-based* (fast-check), partição da receita. Gerar N tarefas: tipo do universo, com ou
   sem paciente, status, campanha ∈ {nenhuma, C1..Ck}, recebimento com valor ≥ 0 ou estornado.
   Afirmar, para cada campanha, que `receita(c) = Σ valor dos recebimentos vivos > 0 das tarefas
   concluídas com paciente da campanha c`, recalculado em TS a partir do mesmo cenário. Afirmar
   também que `Σ_c receita(c) = soma das mesmas tarefas com campanha não nula`: nenhum recebimento
   em duas campanhas, nenhum perdido.
2. *Property-based*, troca de campanha. Para qualquer sequência de trocas em tarefas pagas,
   `Σ_c receita(c)` não muda, e `receita(origem)` cai exatamente o valor que `receita(destino)`
   sobe.
3. O cenário de referência acima, linha a linha, em `montar` **e** em `conferencia` **e** na
   soma mensal de `sincronizar` (N-2).
4. Orçamento não é receita: cartão com campanha, `valor_orcamento = 2000000`, sem recebimento,
   dá receita 0. Fechar com entrada 500000 dá 500000, nunca 2000000.
5. Ciclo concluir com pagamento → reabrir → concluir com pagamento → reabrir: a receita volta a
   0, e no meio é sempre o valor de **um** pagamento.
6. Recebimento avulso com campanha enviado duas vezes com o mesmo `requisicaoId`: **uma** tarefa
   e **um** recebimento. `count(tarefas da campanha)` sobe 1.
7. Editar a tarefa sem `campanhaId` mantém a campanha, inclusive campanha encerrada há 90 dias e
   campanha excluída (N-4).
8. As bordas de N-7 com o relógio fixo em `23:30` de `America/Sao_Paulo` (já é o dia seguinte em
   UTC) e em `America/Manaus`: a campanha que termina "hoje" na clínica continua ativa.
9. Paciente com `campanha_id = C` e recebimento avulso **sem** campanha: receita C = 0 (N-1).

---

## A4 · Câmera no leitor e `gtin` no cadastro

- **N-9 [bloqueia] Uma normalização só.** Hoje o comprimento 14 do GTIN aparece em três lugares:
  `gtinCanonico` (domínio), `interpretarCodigo` (`t.padStart(14,'0')`) e `itens.service.ts:150`
  (`gtin.padStart(14,'0')`). O 14 vem do padrão GS1, e não é fator de conversão da regra 9. Mesmo
  assim, três cópias são três chances de divergir. `SalvarItemEstoque` e `ligarCodigo` chamam
  `gtinCanonico` do domínio, e o contrato usa o **mesmo** schema de `LigarCodigoItem` (extrair um
  `Gtin` Zod e usá-lo nos dois).
- **N-10 [exige teste] Três estados para `gtin` em `SalvarItemEstoque`:** ausente = mantém,
  `''` = desliga, dígitos = liga. Hoje o salvar não toca no `gtin` (L282). Se o campo virar
  opcional com padrão `''`, salvar o item pela tela antiga **apaga** o código. A duplicidade sai
  do índice `itens_de_estoque_gtin_unico` (23505) como o 409 de `ligarCodigo` ("Este código já
  está ligado a …"), e não do `SELECT` antes do `UPDATE`, que perde a corrida entre duas abas.
- **N-11 [bloqueia] A leitura nunca gera quantidade nem movimento.** O leitor preenche
  item/`gtin`, validade e lote, e só isso. A quantidade é sempre digitada na unidade declarada do
  item. Ler o mesmo código duas vezes não soma 1, e nenhum movimento é gravado sem "Registrar".
  `interpretarCodigo` para no primeiro AI desconhecido, então os AIs de contagem do GS1 (`30`,
  `37`) não são lidos. Nenhum ticket deve ensiná-lo a ler. **No cadastro, a validade lida não
  cria lote nem entrada**: a validade é do lote, e o lote nasce na entrada.
- **N-12 [recomendação] Dígito verificador GS1 (mod 10)** em `packages/domain`. A câmera erra
  leitura de vez em quando, e um EAN lido errado liga o código ao item errado. A próxima leitura
  da caixa certa abre a ficha de outro medicamento. Barato, puro e testável.

**Testes exigidos (A4):**
1. *Property-based:* `gtinCanonico` é idempotente; `gtinCanonico(ean13) =
   gtinCanonico('0'+ean13)`; tem sempre 14 dígitos para entrada de 8 a 14 dígitos.
2. O mesmo produto cadastrado pelo EAN-13 é achado pela leitura do DataMatrix (GTIN-14): é o
   mesmo item.
3. Salvar o item sem `gtin` preserva o `gtin` (N-10). Dois itens com o mesmo código dão 409 nos
   dois caminhos (salvar e ligar).
4. Saldo do item antes e depois de ler o código N vezes na entrada e na saída sem confirmar: é
   idêntico, e `movimentos_de_estoque` continua com o mesmo número de linhas (N-11).
5. Se N-12 entrar: um dígito trocado é recusado (*property*: toda troca de um único dígito é
   detectada).

---

## B1 · Corrigir o orçamento já enviado

**Como o funil lê o orçamento hoje:**
- "Orçamentos enviados · R$ orçado" = `Σ (ev->>'valor')` dos eventos `registrarOrcamento` com
  `em ∈ [de, ate)`.
- "Perdidos · valor" e a coluna "Fechados" leem `t.valor_orcamento` **atual**.
- O evento `fechar` grava `valor = negócio = valor_orcamento` (se > 0).
- `contarConversaoDeOrcamentos` (Painel e carteira) **conta** eventos `registrarOrcamento`.
- `valor_orcamento` também alimenta o rateio do programa no fechamento
  (`valorTotal: negocio` → `ratear`).

**É coerente com "períodos passados não mudam"?** Só com uma condição: **o evento original não
pode ser editado.** O spec diz "corrigir … do evento de orçamento já registrado". Se isso for
lido como reescrever `ev.valor` dentro de `historico`, o "R$ orçado" de **todo** período que
contém aquele evento muda, que é exatamente o que o spec proíbe, e a trilha da regra 20 perde o
"de".

- **N-13 [bloqueia] A correção é append-only.** O evento `registrarOrcamento` fica
  byte-a-byte igual. A correção **acrescenta** um evento de ação nova (`corrigirOrcamento`), com
  `etapa: 'orcamento'`, `contaNoFunil: false`, e `de → para` de valor, retomar e nota. Ela entra
  na tabela `TRANSICOES` (`de: ['orcamento'] → orcamento`, como `followUp`), e por isso a regra
  fica no domínio. **Proibido** registrá-la como um segundo `registrarOrcamento`: dobraria
  "enviados" no funil, no Painel e na carteira, e o `JA_TEM_ORCAMENTO` deixaria de valer.
  `funil.test.ts` já cobra que `ACAO_DO_PASSO + KPIs = ACOES_DO_FUNIL`, e esse teste tem de
  continuar passando sem mudança.
- **N-14 [decisão] Que valor o "R$ orçado" mostra depois da correção.** Duas leituras coerentes:
  - **(a) sempre o original.** É a mais simples. Mas o erro de digitação (R$ 200.000 em vez de
    R$ 20.000) fica no funil **também do período corrente**, para sempre.
  - **(b) o valor vigente no fim da janela** (**recomendada**). Para cada `registrarOrcamento`
    com `em ∈ [de, ate)`, soma-se o `valor` do último evento entre `{registrarOrcamento,
    corrigirOrcamento}` do mesmo cartão com `em < ate`. Uma janela já fechada (`ate <= agora`)
    nunca muda, porque toda correção futura tem `em >= agora >= ate`. A janela em curso mostra o
    valor corrigido. É a leitura precisa de "o passado não muda". Há um só `registrarOrcamento`
    por cartão (`de: ['realizado']` e nada volta de `orcamento` para `realizado`), então não há
    ambiguidade.

  Nos dois casos, a consequência vai escrita no spec. Exemplo: orçamento de outubro corrigido
  em 5 de novembro. O funil de outubro mantém o valor errado, e o de novembro não conta esse
  orçamento (ele foi enviado em outubro). O dono precisa ler isso antes do código.
- **N-15 [exige teste] O que muda de imediato, e é correto que mude:** `t.valor_orcamento`
  (coluna "Orçamentos em aberto", a sugestão de valor do Fechar, o "negócio" do fechamento e o
  `valorTotal` do rateio do programa) e `t.proximo_passo_em`. Perdidos e Fechados dos períodos
  passados **não** se movem, porque a correção só vale em `orcamento`, `perdido` e `fechado` são
  terminais (nem `reabrir` sai deles) e o evento `fechar` congela o negócio no instante dele.
- **N-16 [bloqueia] Valor em centavos, pelo mesmo schema.** `valor` usa `valorDeOrcamento` do
  contrato `registrarOrcamento` (string de centavos → `bigint`, > 0), não um segundo schema.
  `centavosNoJsonb` no evento: string, nunca número JSON. Sem `valores`, o `de`/`para` do evento
  de correção é apagado pela redação central. Os nomes dos campos do evento entram em
  `CAMPOS_MONETARIOS`, ou o histórico passa a vazar o valor do orçamento para a recepção.
- **N-17 [bloqueia] Coerência com o programa orçado.** Se `programa_orcado` tem itens com
  `valor` explícito cuja soma passa do valor corrigido, `ratear` prende a sobra em zero e o
  programa nasce com a soma das sessões ≠ negócio. A correção usa **a mesma validação** do
  `registrarOrcamento` sobre o programa (uma função de domínio), e recusa quando
  `Σ itens com valor > valor corrigido`.
- **N-18 [exige teste] Concorrência e datas.** `carregarCartao … FOR UPDATE`: corrigir e fechar
  ao mesmo tempo serializam, e a correção depois do fechamento é 409. `retomarEm` passa pela
  mesma regra do `registrarOrcamento`, comparada com o `hoje` do **servidor** no fuso da clínica.
  O padrão, se vier vazio, é calculado no servidor, nunca no cliente.

**Testes exigidos (B1):**
1. Append-only: `historico[0..n-1]` é igual em profundidade antes e depois, o comprimento é
   `n+1`, e o último evento tem `acao = 'corrigirOrcamento'` com `de`/`para`.
2. Contraexemplo nomeado `orcamento-corrigido-depois-do-mes`: orçamento de 300000
   registrado em 15/10 e corrigido para 30000 em 05/11. Funil de outubro consultado em 04/11 e
   em 06/11: **300000 nas duas consultas** (nas leituras a e b). Funil de novembro: 0 enviados.
   Coluna "Orçamentos em aberto" em 06/11: 30000. Variante: correção em 20/10 com a leitura
   (b). Outubro consultado em 06/11 e em 06/12 dá **30000 nas duas**: um mês fechado dá o
   mesmo número em qualquer data depois do fim dele.
3. *Property-based:* para qualquer sequência de correções com `em` crescente e qualquer janela
   com `ate <= agora`, o "R$ orçado" da janela calculado antes e depois de acrescentar mais
   correções (todas com `em >= agora`) é idêntico. Mesma coisa para `enviados` (contagem) do
   funil, do Painel e da carteira.
4. `enviados` não muda com a correção, em `contarConversaoDeOrcamentos`, no funil e em
   `uso-diario-cliente`.
5. Corrigir → fechar com entrada 100000 e aberto 200000: o evento `fechar` traz o valor
   corrigido. Receita = 100000. O LTV sobe 100000. Recebimentos, caixa e Visão do mês não se
   movem na correção (regra 4).
6. Corrigir num cartão com programa: depois de fechar, `Σ valores das sessões` = valor corrigido
   quando há item sem valor (`ratear` é exato: soma = todo e `max−min <= 1` dentro de cada item,
   já coberto por `ratearPrograma`). Com `Σ itens com valor > corrigido`: 409 (N-17).
7. Corrigir em `realizado`, `fechado`, `perdido` ou `agendado`: 409, e `historico` não muda.
8. Sem `valores`: o evento de correção sai com `de`/`para` `null` na resposta HTTP.

---

## B3 · "Quem mais indica" no Painel

- **N-19 [bloqueia] Contagem sem multiplicação de linhas.** `n` = `count(DISTINCT
  p_indicada.id)` agrupado por `indicado_por_id`. Se o bloco também trouxer receita, a soma vem
  de uma **subconsulta agregada por indicada** (ou CTE), e só depois entra o `JOIN`. Um `JOIN`
  direto `pacientes × tarefas × recebimentos` com `count(*)` conta **recebimentos**, não
  pacientes: a indicada com 12 sessões pagas vira 12 indicações. É o defeito que o Painel já
  documenta em `painel.service.ts:136`.
- **N-20 [exige teste] Janela.** "Pela data de cadastro" = `p.criado_em ∈ [j.de, j.ate)` com
  `j = janela(periodo.de, periodo.ate, fuso)` do domínio. As bordas vêm do servidor
  (`bordasDoPeriodo`), as mesmas dos outros blocos do Painel. Só `indicado_por_id IS NOT NULL`:
  o texto livre não conta. A autoindicação já é barrada pelo `CHECK` da 0062. **[decisão]**
  Paciente indicada que depois foi desativada: **recomendação**, conta, porque o cadastro
  aconteceu no período e desativar é estado, não exclusão. Os migrados têm `criado_em = coalesce(data
  da v20, now())`. Se alguém ligar `indicado_por_id` num migrado sem data, ele aparece no dia da
  migração. Registrar isso no spec.
- **N-21 [bloqueia] Desempate determinístico:** `ORDER BY n DESC, nome ASC, id ASC` antes do
  `LIMIT`. Sem isso, o "top 5" troca sozinho entre dois carregamentos.
- **N-22 [bloqueia se houver receita] A receita das indicadas passa pelas mesmas portas dos
  outros blocos de dinheiro do Painel:** `baseDeReceita` (o universo de receita, com
  `DINHEIRO_QUE_ENTROU` e `estornado_em IS NULL`) **e** o corte `caixaFechado`. Sem o corte, uma
  janela de um dia (`per`, `de = ate = hoje`) mostra o que a gaveta deve ter antes do fechamento:
  a regra 6 furada pela mesma porta dos fundos que `topPagantes` fechou. A janela do dinheiro tem
  de ser declarada. **Recomendação:** recebimentos das indicadas **no período** (pelo mesmo campo
  de data de `topPagantes`), não o LTV desde sempre. O campo de saída entra em
  `CAMPOS_MONETARIOS` (regra 17). `valorOrcamento` das indicadas nunca entra.

**Testes exigidos (B3):**
1. *Property-based:* para qualquer distribuição de recebimentos (0..k por indicada), `n` por
   indicador = número de pacientes com `indicado_por_id = ele` e `criado_em` na janela,
   independente de quantos recebimentos cada indicada tem.
2. Se houver receita: `Σ_indicadores receita = Σ receita das indicadas (sem repetição)`, e cada
   indicada conta para um indicador só.
3. Bordas: cadastro às `00:00` do primeiro dia entra; cadastro às `00:00` do dia seguinte ao
   último não entra. Clínica em `America/Sao_Paulo` com o relógio do servidor em UTC já no dia
   seguinte.
4. Empate de `n`: a ordem é a mesma em 10 leituras.
5. Sem `valores`: a receita sai apagada na resposta HTTP, e `n` continua visível.
6. Janela de hoje com o caixa aberto: a receita não inclui o dia (N-22).

---

## Vereditos

| Item | Veredito | Condição |
|---|---|---|
| **A3** | **Aprovado com bloqueios** | N-1, N-2, N-4 e N-6 no spec antes dos tickets; N-5 e N-6 decididos pelo produto; os 9 testes como aceite |
| **A4** | **Aprovado com bloqueios** | N-9, N-10 e N-11; N-12 recomendado |
| **B1** | **Reprovado como está escrito; aprovado com N-13 a N-18** | "Corrigir … do evento" reescrevendo o evento muda o funil passado e apaga a trilha. A correção é um evento novo fora de `ACOES_DO_FUNIL`, e o "R$ orçado" segue N-14 (recomendo a leitura b) |
| **B3** | **Aprovado com bloqueios** | N-19, N-21, e N-22 se houver receita; decisão de N-20 sobre indicadas desativadas |

Nenhum destes itens cria dinheiro ou quantidade novos se as condições acima forem cumpridas. Os
contraexemplos acima (cenário de referência da A3, outubro/novembro da B1, a indicada com
12 recebimentos da B3) vão para o `engenheiro-qa-automacao` como testes nomeados da suíte.

---

## B4 — revisão

`validador-numeros`, 2026-11-09, **sobre o spec e a ADR 0025, antes do código** (B4-7 e tudo da
ADR que mexe em contagem, prazo e meta). Fontes conferidas: `pessoas/indicadores.service.ts`
(L166-253), `pessoas/metas.service.ts` (L164, L526-536), `painel-geral/metricas-diarias.ts`
(`consultarPrazos`, L81-136), `painel-geral/painel.service.ts` (L103-163, `para_si` L198),
`contracts/painel.ts` (`LinhaPorResponsavel`, L104-109), `carteira/jobs/uso-diario-cliente.ts`,
`carteira/jobs/metricas-do-dia.ts`, `tarefas/edicao.service.ts` (L98-215),
`tarefas/conclusao.service.ts` (L182, L259, L322), `programas/sessoes.service.ts` (L134, L275),
`estoque/contagens.service.ts` (L474), `migracao/migrador.service.ts` (L927-931),
`packages/domain/src/tarefa.ts` (`podeEditar`).

**Como foi conferido.** Os cenários abaixo foram **executados** em Postgres 17 (o `fir-postgres`
do ambiente, só em tabelas `TEMP`, sem tocar no schema), com os `CHECK`s da ADR §2 copiados
literalmente. Os resultados batem com a conta à mão.

**O que está certo e o spec preserva:**
- `PESSOA_QUE_CONTA = coalesce(responsavel_id, concluida_por)` dá **exatamente uma** pessoa a
  toda tarefa concluída. A tarefa de pessoa tem `responsavel_id`. A de setor concluída tem
  `concluida_por`, pelo `CHECK tarefa_de_setor_concluida_tem_quem_concluiu`. Nenhuma conclusão
  conta duas vezes nem vale para o setor inteiro.
- **A 0066 sozinha não muda número nenhum.** Toda linha existente tem `responsavel_id NOT NULL`.
  Por isso `coalesce(...) = responsavel_id`, o filtro P4 `setor_de_atuacao_id IS NULL` não tira
  linha nenhuma, e a chave de `consultarPrazos` continua sendo `responsavel_id`.
- O migrador continua recusando tarefa sem responsável de forma explícita
  (`migrador.service.ts:931`). Quando o `NOT NULL` sair, o `CHECK tarefa_tem_um_destino` é a
  segunda camada.
- `agendamentos` e `confirmacoes` contam pelo `porId` do evento e não dependem do destino.
- `contagens_prazo` lê `contagens_de_estoque` e não muda.
- Sessão não vai para setor (há um `CHECK`). O universo de `tarefas_prazo`, que inclui sessões,
  não cruza com setor.
- `para_si` (`responsavel_id = solicitante_id`): `NULL = x` não é verdadeiro, então a tarefa de
  setor cai em `paraAEquipe`, e está certo. `solicitadas = paraSiMesma + paraAEquipe` continua
  fechando.
- Job da carteira: lê só `prazos.total.noPrazo`. `metricas-do-dia.ts` não lê `responsavel_id` em
  lugar nenhum. Nenhuma coluna de `uso_diario_cliente` recebe nome, id de setor ou linha por
  pessoa.

### Cenário de referência (executado)

Período 01–30/11/2026, `hoje = 2026-11-15`, Enf = setor de atuação.

| # | Destino | Concluída por | Situação | Prazo | Conclusão |
|---|---|---|---|---|---|
| 1 | Juliana | Juliana | ok | 05/11 | 04/11 |
| 2 | Juliana | Camila | tarde | 06/11 | 08/11 |
| 3 | Camila | — | atrasada | 10/11 | — |
| 4 | Enf | — | atrasada | 12/11 | — |
| 5 | Enf | — | a vencer | 20/11 | — |
| 6 | Enf | Camila | tarde | 07/11 | 09/11 |

Total, à mão: 6 = 1 ok + 2 tarde + 2 atrasadas + 1 a vencer.

### Achados

- **N-23 [bloqueia] A chave do Painel de prazos, como o B4-7 escreve, contradiz P4.** O B4-7
  agrupa `consultarPrazos` pela "pessoa que conta, ou o setor quando não há". A tarefa 6 é de
  setor e foi concluída **com atraso** por Camila. Com essa chave, ela vai para a linha de
  **Camila** e sai da linha da Enfermagem. Executado:

  | Linha | total | ok | tarde | atrasadas | a vencer |
  |---|---|---|---|---|---|
  | Camila | 2 | 0 | **1** | 1 | 0 |
  | Juliana | 2 | 1 | 1 | 0 | 0 |
  | Enf | 2 | 0 | **0** | 1 | 1 |

  É exatamente o que P4 diz recusar. Quem resgata a tarefa atrasada do setor fica com o atraso na
  linha dela, e a linha do setor esquece que ele atrasou. Isso desmente a própria ADR ("o atraso
  do setor aparece na linha dele no Painel").

  **Correção:** duas expressões, no mesmo módulo, cada uma com seu uso.
  - `PESSOA_QUE_CONTA = coalesce(t.responsavel_id, t.concluida_por)` vale para **produção**:
    `contatos`, `orc_qtd`, `orc_valor` e `recebimentos`.
  - `DESTINO_DO_PRAZO` (`t.responsavel_id`, senão `t.setor_de_atuacao_id`) vale para **prazo**:
    `consultarPrazos` e `tarefas_prazo` (que, com P4, fica só com `responsavel_id`).
  - `concluida_por` **nunca** entra em prazo.

  Com a correção, executado:

  | Linha | total | ok | tarde | atrasadas | a vencer |
  |---|---|---|---|---|---|
  | **Total** (`GROUPING() = 3`) | 6 | 1 | 2 | 2 | 1 |
  | Enf (setor de atuação) | 3 | 0 | 1 | 1 | 1 |
  | Juliana | 2 | 1 | 1 | 0 | 0 |
  | Camila | 1 | 0 | 0 | 1 | 0 |

  A soma das linhas dá o total, coluna por coluna. A tarefa 2 (de Juliana, concluída por Camila)
  fica com Juliana nas duas leituras.

  O AB-B4-12 passa a dizer: "concluída por A, conta 1 para A **nos indicadores de produção** e
  fica na linha do setor em prazos; aberta, não conta para ninguém e fica na linha do setor".

- **N-24 [bloqueia] A responsável manda a própria tarefa atrasada para o setor e o % no prazo dela
  sobe, inclusive em mês já passado.** `podeEditar` libera a responsável. `edicao.service.ts`
  troca o destino sem olhar prazo nem status. Com P4, a tarefa sai do denominador dela.

  Executado: em outubro, Juliana tem 4 tarefas vencidas, 2 no prazo, ou seja, **50%**. Em
  novembro ela edita as duas atrasadas para Enf. O outubro dela passa a **100%** (2 de 2). É uma
  porta para manipular a meta, e ela reescreve um mês fechado.

  **Correção (recomendação):** se a tarefa já venceu (`prazo < hoje`, com `hoje` do servidor),
  só quem solicitou ou quem tem `tarefas.equipe` pode passá-la de pessoa para setor. Para a
  responsável, a resposta é 403: "Tarefa atrasada não muda de destino; peça a quem solicitou." A
  troca fica na trilha (de → para).

  **[decisão] O caminho inverso.** "Assumir" uma tarefa atrasada (setor → pessoa) a põe no % de
  quem assumiu. Recomendação: aceitar, porque é escolha de quem assume, e escrever no MANUAL que
  concluir direto pelo setor não pesa no % e assumir pesa.

- **N-25 [bloqueia] Troca de destino em tarefa concluída.** Hoje `edicao.service.ts:120-128`
  troca `responsavel_id` em qualquer status. Com setor, isso dá três problemas:
  - **Pessoa → setor numa tarefa concluída antes da 0066** (`concluida_por NULL`): viola
    `tarefa_de_setor_concluida_tem_quem_concluiu` e devolve **23514, que sai como 500**
    (executado).
  - **Pessoa → setor numa tarefa concluída depois da 0066 por outra pessoa:** o crédito do mês da
    conclusão passa da responsável para quem concluiu, e a tarefa sai do % dela (P4).
  - **Setor → pessoa numa tarefa concluída:** o crédito passa de quem fez para quem não fez. É a
    "pessoa de enfeite" do S-43, só que depois do fato.

  **Correção:** o destino (`responsavelId`/`setorDeAtuacaoId`) só muda em tarefa **aberta**. Em
  tarefa concluída, a resposta é 400: "Reabra a tarefa para trocar o destino." A série já filtra
  `status = 'aberta'` (`edicao.service.ts:40`), e a tarefa avulsa passa a seguir a mesma regra.

  Trocar de uma pessoa para outra numa tarefa concluída já acontece hoje e fica fora desta onda.
  Fica registrado como a mesma classe de defeito.

- **N-26 [bloqueia] `concluida_por` precisa ser tratado em todo caminho que muda `status`, não só
  no de concluir.** O B4-5 lista `sessoes.service.ts` "só a linha de `concluida_por`" ao
  concluir. Só que **reabrir sessão** (`sessoes.service.ts:275`, `SET status = 'aberta',
  concluida_em = NULL`) não zera a coluna. Com o `CHECK concluida_por_so_em_concluida`, esse
  `UPDATE` falha com 23514 (executado).

  A transação inteira volta. O estoque não fica inconsistente, mas **ninguém consegue reabrir
  sessão concluída depois da 0066**, e é por esse caminho que a baixa de insumo é restaurada.

  Os caminhos:
  - **Gravar** `concluida_por`: `conclusao.service.ts:182`, `sessoes.service.ts:134`,
    `contagens.service.ts:474`.
  - **Zerar** `concluida_por`: `conclusao.service.ts:259` (cancelar), `:322` (reabrir),
    `sessoes.service.ts:275` (reabrir sessão).
  - **Já a salvo**, porque só tocam `status = 'aberta'`: os cancelamentos de
    `montador.service.ts:323`, `programas.service.ts:182` e `sessoes.service.ts:299/402`.

  Acrescentar isso ao B4-5, com um teste-guarda: todo `UPDATE tarefas SET status` em
  `apps/api/src` menciona `concluida_por`.

- **N-27 [corrige o registro] O defeito do `pessoa === null` existe, mas não onde a ADR §6 diz.**
  Medido com `responsavel_id` anulável e a consulta de hoje (chave `responsavel_id`), no
  cenário:
  - o total sai **6**, certo;
  - as linhas são Juliana 2, Camila 1 e a linha `NULL` do setor, 3;
  - **as linhas somam 3 ≠ 6**.

  O total sai certo **por coincidência**. `ORDER BY count(*) DESC` põe a linha de total, que é a
  maior, antes da linha `NULL` do setor. No empate (só tarefas de setor no período), as duas
  linhas são idênticas coluna por coluna (executado).

  Consequências:
  - **A carteira não teria recebido total falso.** Não há `uso_diario_cliente` a reprocessar, e
    antes da 0066 não existe tarefa de setor.
  - O que quebra é **a linha do setor, que some** do Painel.
  - `GROUPING()` continua obrigatório: o total certo hoje depende de um `ORDER BY` que ninguém lê
    como regra.
  - Ordem determinística também é obrigatória: `ORDER BY GROUPING(...) DESC, total DESC, tipo,
    nome, id`. Hoje o empate de `count(*)` não tem ordem definida (mesma classe do N-21).

- **N-28 [bloqueia, no texto] "Nenhum mês passado muda" vale para a 0066, mas não como promessa
  geral.** A meta não é congelada: `metas.service.ts` recalcula o mês na leitura (L164, L536).
  Escrever no spec e na ADR §6/§12:
  > *A 0066 sozinha não muda número de mês nenhum. Depois dela, um mês passado só muda pelos
  > caminhos que já existem (reabrir, corrigir `realizadaEm`, trocar o responsável), e **nunca**
  > pela troca de destino para ou de um setor (N-24, N-25).*

- **N-29 [exige teste] Linha `NULL` na consulta de conclusões é incidente, não `continue`.** O
  B4-7 diz que as consultas de produção "ignoram a linha `NULL` (tarefa de setor aberta)". Mas
  essa consulta filtra `status = 'concluida'`, então **tarefa aberta nunca chega ali**. Um
  `PESSOA_QUE_CONTA NULL` entre concluídas só aparece se o `CHECK` tiver sido violado.

  Pular essa linha calado tira um contato de todo mundo sem ninguém ver: é o `Math.max(0, ...)`
  aplicado à meta. **Regra:** lançar erro, como `emPercentual` faz com `no_prazo > total`.

  Hoje `guardar(l.pessoa, ...)` aceitaria `null` como chave do `Map`, porque o tipo `pessoa:
  string` não corresponde ao que o banco pode devolver.

- **N-30 [exige teste] A propriedade "conta para no máximo uma pessoa" é fraca demais.** Uma
  consulta que não conta nada passa nela. A propriedade certa tem três partes:
  - cada tarefa conta para **exatamente uma** pessoa;
  - `Σ_pessoas contatos` = contatos da clínica no mês;
  - `Σ_pessoas orc_valor` = Σ, **em centavos e exato**, do que entrou nas tarefas *Pagamento de
    orçamento* concluídas no mês.

- **N-31 [exige teste] A linha de setor no contrato e na leitura.**
  - `LinhaPorResponsavel` é `strict`, com `pessoaId: Uuid`. Vira união discriminada por `tipo`.
    A linha `tipo: 'setor'` leva `setorDeAtuacaoId` e `nome`, sem `pessoaId`.
  - O nome vem de `LEFT JOIN setores_de_atuacao` **sem** `excluido_em IS NULL`. Com o N-23, um
    setor excluído ainda tem tarefas concluídas no período. Um `JOIN` que filtrasse excluídos
    tiraria essas tarefas das linhas, e a soma deixaria de bater com o total.
  - O `JOIN` do nome da pessoa usa a **mesma** expressão da chave.
  - Consumidor: `apps/web/src/components/tela-painel.tsx`.

- **N-32 [aprovado, com teste] Job da carteira.** O desenho está certo. `tarefas_no_prazo` passa a
  incluir tarefa de setor, e isso está certo, porque a carteira mede a clínica. Nada de setor
  atravessa.

- **N-33 [decisão menor, não bloqueia] Funil por pessoa.** A tarefa de setor concluída por A não
  aparece no funil filtrado por A (`responsavel OR solicitante`), mas conta na meta de A. São
  perguntas diferentes. Recomendação: aceitar e explicar no MANUAL.

**P4: aprovado nos números**, condicionado ao N-23 (prazo por destino, nos dois lugares) e ao
N-24 (sem a trava, P4 vira uma porta de fuga do %).

### Testes exigidos (B4)

1. **T-B4-1 · A 0066 não muda mês passado.**
   - **Fixture fixa**, no banco migrado até a 0063:
     - meses de setembro, outubro e novembro de 2026;
     - 3 pessoas, uma desativada;
     - todos os tipos de tarefa, inclusive *Pagamento de orçamento* com recebimento em centavos
       e venda a prazo;
     - tarefas concluídas no prazo e com atraso, abertas vencidas, canceladas e excluídas;
     - tarefas migradas e contagens;
     - um empate de `count`;
     - uma conclusão às 21h no fuso da clínica.
   - **Relógio fixo:** `hoje = 2026-11-15`.
   - **Instantâneo** do que segue:
     - (a) `realizadoDosIndicadores` de cada mês, pessoa × 8 indicadores;
     - (b) `consultarPrazos` de cada mês e de **cada dia** de outubro;
     - (c) `GET /v1/painel-geral` do mês;
     - (d) o funil;
     - (e) as linhas de `uso_diario_cliente` de cada dia de outubro, via
       `executarUsoDiarioCliente(diaAlvo)`.
   - **Roda a 0066** e tira o mesmo instantâneo.
   - **Passa se** os dois forem iguais em profundidade, com as linhas comparadas após ordenar por
     id. Nenhuma diferença é tolerada.
2. **T-B4-1b · Atividade nova não muda outubro.** Depois da 0066, em novembro:
   - criar, concluir, reabrir e reconcluir tarefas de setor;
   - pôr pessoas em setores e tirar;
   - excluir um setor vazio.

   O instantâneo de outubro tem de sair idêntico ao do T-B4-1.
3. **T-B4-2 · Tarefa de pessoa concluída por outra.** Tarefa de contato de Juliana, concluída por
   Camila: `contatos` dá Juliana +1 e Camila +0.
   *Mutação:* trocar `PESSOA_QUE_CONTA` por `coalesce(concluida_por, responsavel_id)` tem de
   reprovar.
4. **T-B4-3 · O cenário de referência.** O resultado tem de ser exatamente a segunda tabela do
   N-23:

   | Linha | total | ok | tarde | atrasadas | a vencer |
   |---|---|---|---|---|---|
   | Total | 6 | 1 | 2 | 2 | 1 |
   | Enf | 3 | 0 | 1 | 1 | 1 |
   | Juliana | 2 | 1 | 1 | 0 | 0 |
   | Camila | 1 | 0 | 0 | 1 | 0 |

   A soma das linhas confere coluna por coluna.
   *Mutação:* voltar a `find(pessoa === null)` **e** tirar o `ORDER BY` tem de reprovar. Só a
   primeira mutação não reprova o total (N-27); é o teste das linhas que pega.
5. **T-B4-4 · P4.**
   - Camila tem 1 tarefa própria concluída no prazo e conclui com atraso a tarefa 6, do setor. O
     `tarefas_prazo` dela continua **100%** (1/1), não 50%.
   - Pessoa cujas únicas tarefas no mês são de setor: `tarefas_prazo = null` ("sem dado"), nunca
     `0`.
   - *Mutação:* remover `setor_de_atuacao_id IS NULL` tem de reprovar.
6. **T-B4-5 · N-24.** Juliana em outubro está em 50%.
   - Ela tenta mandar as duas atrasadas para Enf: 403, e outubro continua 50%.
   - A solicitante faz a mesma troca: 200, e a trilha registra de → para.
7. **T-B4-6 · N-25.**
   - Pela API, trocar o destino de tarefa concluída, nos dois sentidos: 400, e nada muda.
   - Por SQL direto, pessoa → setor numa concluída sem `concluida_por`: 23514.
8. **T-B4-7 · N-26.** Ciclo concluir → reabrir → concluir → reabrir de uma **sessão de programa**
   depois da 0066:
   - nenhum 23514;
   - `concluida_por` fica `NULL` depois de cada reabrir;
   - o saldo do lote volta exatamente ao inicial.

   Mais o teste-guarda sobre todo `UPDATE tarefas SET status`.
9. **T-B4-8 · Property-based (fast-check).**
   - **Gerador:** tarefas com destino pessoa ou setor, status, prazo, dia de conclusão,
     `concluida_por`, tipo e valor em centavos, mais um `hoje`.
   - **Propriedades:**
     - (i) Σ das linhas = total em **cada uma das cinco colunas**;
     - (ii) toda concluída do universo de produção conta para **exatamente uma** pessoa;
     - (iii) `Σ orc_valor` por pessoa = total da clínica, em centavos;
     - (iv) nenhuma chave `NULL` nas consultas de produção;
     - (v) a linha de prazo de uma pessoa só contém tarefas com `responsavel_id = ela`;
     - (vi) o denominador de `tarefas_prazo` exclui toda tarefa de setor.
10. **T-B4-9 · Setor excluído.** Enf é excluído depois de a tarefa 6 ter sido concluída. A linha
    "Enf" continua no Painel do período, com o nome, e a soma das linhas continua igual ao total.
11. **T-B4-10 · Determinismo.** Com empate de `total` entre duas pessoas e um setor, 10 leituras
    do Painel devolvem a mesma ordem.
12. **T-B4-11 · Carteira.**
    - Num dia com tarefas de setor: `uso_diario_cliente.tarefas_no_prazo` = `total.noPrazo` =
      Σ `noPrazo` das linhas de `consultarPrazos` daquele dia.
    - Rodar 3 vezes deixa uma linha só, idêntica.
    - O conjunto de colunas gravadas é o mesmo de hoje.

### Veredito B4

| Item | Veredito | Condição |
|---|---|---|
| **B4-7 e ADR 0025 §6/§12** | **Reprovado como está escrito; aprovado com N-23 a N-26 no spec antes do código** | Prazo por destino, nunca por `concluida_por` (N-23). A responsável não manda a própria atrasada para o setor (N-24). Destino só muda em tarefa aberta (N-25). `concluida_por` zerado em todo reabrir e cancelar, inclusive de sessão (N-26). Texto do "nenhum mês passado muda" corrigido (N-28). Aceite: T-B4-1 a T-B4-11 |
| **P4** | **Aprovado** | Condicionado ao N-23 e ao N-24 |

Os contraexemplos executados vão para o `engenheiro-qa-automacao` como testes nomeados:
- o cenário de 6 tarefas (T-B4-3);
- Juliana de 50% para 100% (T-B4-5);
- a concluída pré-0066 que dá 23514 (T-B4-6);
- o reabrir sessão que dá 23514 (T-B4-7).

## A3 — índice da 0065 (serie_id)

**Pergunta.** A 0065 fez mais do que o N-6 decidiu: além de `tipo`, pôs `AND serie_id IS NULL` no índice
parcial `tarefa_viva_da_campanha` (D-25 item 7). Com isso, uma série com campanha pode contar contato,
convertido ou receita duas vezes? Pode quebrar a idempotência da importação de lista?

**Por que o índice não mexe em contagem.** O índice só decide quais linhas podem existir. Não entra em
nenhuma soma. Os números saem assim:
- **Receita:** `RECEITA_DA_CAMPANHA`, pelo caminho `campanhas → tarefas.campanha_id → recebimentos.tarefa_id`.
  Cada ocorrência da série é uma tarefa própria. `recebimento_por_tarefa` (0006) garante no máximo um
  recebimento vivo por tarefa, então cada recebimento entra uma vez. `serie_id` não aparece no predicado.
- **Convertidos e alcançados:** `count(DISTINCT paciente_id)`. A série inteira conta 1 paciente.
- **Contatos:** conta tarefas, não pacientes (é a regra do `statsCamp`, `contatos.length`). Cada ocorrência
  concluída é um contato que aconteceu de fato, e isso já valia antes da 0065: o índice nunca cobriu
  tarefa concluída. O que a 0065 libera são mais tarefas reais na campanha, não a mesma tarefa contada
  duas vezes.

**Por que a importação continua idempotente.** O `ON CONFLICT` de `campanhas.service.ts` repete o
predicado do índice palavra por palavra, `serie_id IS NULL` incluído. A importação nunca grava
`serie_id`, então toda linha importada cai dentro do índice.

**Executado** (Postgres local, transação desfeita no fim). Paciente P, campanha C:
- série S1: 3 × Consulta realizada, duas concluídas com R$ 100,00 e R$ 50,00, uma aberta;
- série S2: 3 × Pós-consulta, duas concluídas, uma aberta;
- depois, a mesma importação (Pós-consulta, P, C) rodada 3 vezes.

| Número | Esperado à mão | Obtido |
|---|---|---|
| tarefas fora de série criadas pelas 3 importações | 1 | 1 (`INSERT 0 1`, `0 0`, `0 0`) |
| receita | 10000 + 5000 = 15000 | 15000 |
| contatos (Pós-consulta concluídas) | 2 | 2 |
| pacientes alcançados / convertidos | 1 / 1 | 1 / 1 |
| feitas / abertas / tarefas | 4 / 3 / 7 | 4 / 3 / 7 |
| 2º recebimento vivo na mesma ocorrência | recusado | 23505 `recebimento_por_tarefa` |
| ocorrência aberta que sai da série e colide com a importada | recusada | 23505 `tarefa_viva_da_campanha` |

Rodei também `vinculo.e2e.test.ts` e `campanhas.e2e.test.ts`: 48 de 48 passam.

**Mudança de comportamento (não é contagem dupla, mas tem de ficar escrita).** Se P tem uma ocorrência
**aberta** de série do tipo X na campanha C, importar P com o tipo X na mesma C **cria** uma tarefa avulsa,
e P não cai em `ignoradas`. Antes da 0065 esse caso não acontecia, porque a série com campanha nem podia
ser criada. Se as duas forem concluídas, `contatos` conta 2, que são dois contatos reais. A receita não
muda (lista de importação não aceita tipo de pagamento). Se o dono quiser que a série aberta conte como
"já está na campanha" para a importação, o lugar é um `NOT EXISTS` na importação, não o índice.

**Testes que faltam** (os de série hoje só conferem que `campanhaId` se propaga, nenhum confere número;
o gerador do fast-check nunca grava `serie_id`):
- **T-A3-S1 · Série com campanha, números.** Mesmo cenário S1+S2 acima, pela API. Receita = 15000 nos
  três lugares (tela, sincronização da carteira, conferência da migração); `pacientesConvertidos` = 1;
  `contatos` = 2. Depois, estornar o recebimento de R$ 50,00: receita = 10000 nos três.
- **T-A3-S2 · Importação ao lado de série aberta.** P com série aberta de Pós-consulta em C. Importar P
  (Pós-consulta, C) 3 vezes: `criadas` = 1, depois 0 e 0; `ignoradas` = 0, 1, 1; exatamente uma tarefa
  de C com `serie_id IS NULL`. O teste fixa a regra de hoje. Se o dono decidir o contrário, ele muda junto.

### Veredito A3 (0065, serie_id)

| Item | Veredito | Condição |
|---|---|---|
| `AND serie_id IS NULL` em `tarefa_viva_da_campanha` | **Aprovado** | T-A3-S1 e T-A3-S2 na suíte. A mudança de comportamento da importação acima fica registrada na D-25 item 7 |

Os contraexemplos vão para o `engenheiro-qa-automacao` como T-A3-S1 e T-A3-S2.
