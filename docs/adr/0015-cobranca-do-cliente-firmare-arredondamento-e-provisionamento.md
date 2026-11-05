# ADR 0015 — Cobrança do Cliente Firmare: arredondamento e provisionamento

- **Data:** 2026-11-05
- **Estado:** **decisão provisória de engenharia, em vigor como base de
  trabalho, pendente de confirmação do dono.** As quatro escolhas desta ADR
  correspondem às Perguntas 1–4 de
  `docs/superpowers/plans/g3-spec-metas-e-lancamentos.md` §3. O dono ainda
  não respondeu nenhuma delas. Por instrução dele (guardar perguntas sem
  resposta para o final e seguir trabalhando com a melhor recomendação), o
  gate de risco adota aqui a recomendação do autor do spec como **reversível**
  — se o dono responder diferente, esta ADR é substituída, não editada por
  cima.
- **Origem:** gate de risco de `validador-numeros` sobre o spec G3 (seção 2 —
  critérios de aceite — e seção 3 — perguntas pendentes), antes de
  `/to-tickets`. Relacionada a ADR 0013 §8 (mensalidade é por clínica —
  **essa parte já está decidida pelo dono, não é provisória** e não é
  reaberta aqui).

## Contexto

G3 introduz a primeira cobrança de dinheiro real da Firmare sobre o `Cliente
Firmare` (`Cobrança do Cliente Firmare`, §1 do spec). O spec levanta quatro
perguntas de política comercial que o dono precisa confirmar antes de
`arquiteto-dominio` fechar o modelo de `Dinheiro`. Três delas (1, 2, 3) tocam
direto as regras 1–7 do `CLAUDE.md`; a quarta (4) é escopo, mas também trava o
ticket.

Esta ADR formaliza a decisão de trabalho **provisória** para as quatro, e
registra os achados do gate de risco sobre o spec inteiro — não só as quatro
perguntas — porque esse é o papel do `validador-numeros` no pipeline: revisar
o spec, não o pull request.

## Decisão

### 1 · Arredondamento do desconto de indicação — **decisão provisória, pendente confirmação do dono (Pergunta 1 do spec G3)**

**Trabalho atual:** o desconto arredonda **para cima** (nunca a favor da
Firmare cobrar mais que 90% exato); a cobrança final é o resto, e portanto
arredonda **para baixo**. Mesma direção que a ADR 0013 §8 já deixou escrita em
prosa.

**Mas o spec, ao escrever a assinatura de referência
`aplicarDesconto(mensalidade: Dinheiro, percentual: number): Dinheiro`, introduz
um defeito que o gate reprova antes que vire código:** `percentual: number`
é exatamente o tipo que a regra 1 do `CLAUDE.md` existe para proibir perto de
dinheiro. Um `percentual` em ponto flutuante (`0.10`) multiplicado por um
`bigint` de centavos força uma conversão para `number` em algum ponto do
cálculo — a mesma classe de bug que a regra 1 cobre, só que do lado do fator,
não do valor. **Correção obrigatória antes do ticket:**

- `percentual` é um inteiro de **centésimos de ponto percentual**
  (`PercentualCentesimos`, `bigint`, `0` a `10000`, onde `1000` = 10,00%) —
  mesmo padrão que o próprio spec já usa para indicador `unidade="%"`
  (critério 2.1.2). Nunca `number`.
- O cálculo é inteiro de ponta a ponta, por divisão com teto:
  ```
  desconto = ceilDiv(mensalidade_centavos * percentual_centesimos, 10000)
  cobranca = mensalidade_centavos - desconto
  ceilDiv(a, b) = (a + b - 1) / b   // divisão inteira, a e b >= 0
  ```
  Conferido à mão com o exemplo do próprio spec: `185033 × 1000 = 185033000`;
  `ceilDiv(185033000, 10000) = (185033000 + 9999) / 10000 = 18504` (divisão
  inteira trunca `18504,2999`). `cobranca = 185033 − 18504 = 166529`.
  `18504 + 166529 = 185033` — bate com a mensalidade cheia.

**Esclarecimento de enquadramento, para não forçar a regra errada:** este NÃO
é o caso da regra 2 do `CLAUDE.md` ("dividir em N parcelas iguais, resto nas
primeiras, `max−min ≤ 1`"). Aqui há **duas partes desiguais por desenho**
(desconto pequeno, cobrança grande) — `max−min ≤ 1` não se aplica e não deve
ser testado, porque não é essa a regra de negócio. O invariante que **de
fato** precisa de property-based test é mais estreito e os dois lados contam:

- **Soma exata:** para todo `mensalidade_centavos ≥ 0` e todo
  `percentual_centesimos` em `[0, 10000]`, `desconto + cobranca ===
  mensalidade_centavos`, sempre (decorre da subtração, mas precisa de teste
  porque um bug em `ceilDiv` quebraria isso silenciosamente).
- **Direção do arredondamento:** `desconto ≥ floor(mensalidade_centavos ×
  percentual_centesimos / 10000)` e `cobranca ≤ mensalidade_centavos −
  floor(...)` — isto é o que prova que o arredondamento favorece o cliente,
  não a Firmare. Um teste que só confere a soma não pega um `ceilDiv`
  trocado por `floor` com sinal invertido (ainda fecharia a soma).
- **Casos de borda obrigatórios, não só gerados ao acaso:** `percentual = 0`
  (desconto 0), `percentual = 10000` (100%, desconto = mensalidade cheia,
  cobrança 0), `mensalidade = 0`, `mensalidade = 1` centavo com qualquer
  percentual > 0 (desconto deve ser 1, nunca 0 — "arredondar para cima" tem
  que valer até no menor valor possível).
- **Lacuna a fechar antes do ticket:** a assinatura de referência do spec
  precisa ser corrigida para `aplicarDesconto(mensalidade: Dinheiro,
  percentual: PercentualCentesimos): { desconto: Dinheiro; cobranca: Dinheiro
  }` — devolver as duas partes, nunca só a cobrança, porque o desconto
  também precisa ser um registro (é o valor do `Benefício de indicação`
  efetivamente aplicado, auditável).

### 2 · Vínculo no meio do mês — **decisão provisória, pendente confirmação do dono (Pergunta 2)**

**Trabalho atual:** a primeira `Cobrança` é sempre pelo valor cheio da
`Mensalidade` vigente, nunca proporcional aos dias restantes do mês. Sem
proporção, não há divisão nenhuma para auditar aqui — a `Cobrança` do mês de
entrada é uma cópia direta de `mensalidade_centavos`, mesmo mecanismo do
critério 2.2.8 (snapshot no momento da geração). Nenhum novo invariante
aritmético nasce desta decisão; o risco que ela evita (abrir uma segunda
classe de arredondamento de centavo, de proporção de dias) fica fora por
desenho, não por omissão.

### 3 · Desativação no meio do mês — **decisão provisória, pendente confirmação do dono (Pergunta 3)**

**Trabalho atual:** sempre integral, sem reembolso automático. `Cobrança`
nunca ganha campo de estorno nesta fatia. Isto é consistente com a regra 20 do
`CLAUDE.md` (soft delete, nunca `DELETE`, nunca alteração de registro
financeiro já emitido) e com o critério 2.2.12 do spec (desativar não apaga
nem altera cobrança já gerada). Se o dono confirmar que existe cláusula
contratual real de proporcionalidade na saída, o modelo muda de "nunca
estorna" para "tem um registro de estorno ligado à cobrança original por
`tarefaId`-equivalente" — mesma disciplina de movimento compensatório que a
regra 12 já exige para estoque. Até lá, não construir o campo.

### 4 · Nota fiscal de serviço — **decisão provisória, pendente confirmação do dono (Pergunta 4)**

**Trabalho atual:** fora de escopo de G3. `Cobrança.valor_centavos` é o valor
bruto do contrato, sem imposto. Nenhuma coluna de imposto, líquido ou alíquota
nasce nesta fatia. Consequência explícita para o gate de números: se o dono
confirmar que existe retenção de imposto na prática, o valor "recebido de
fato" pela Firmare divergirá de `Cobrança.valor_centavos`, e **essa divergência
não pode ser absorvida depois como um ajuste solto** — precisaria nascer como
um terceiro valor (`valor_liquido_centavos` ou um `Recebimento` distinto da
`Cobrança`), nunca uma subtração calculada na tela. Registrado aqui para que o
épico futuro de nota fiscal não repita o erro de "campo derivado calculado na
UI" que a regra 7 do `CLAUDE.md` já proíbe.

## Achados do gate sobre o spec inteiro (não só as 4 perguntas)

O `validador-numeros` auditou os 12 critérios de aceite (spec §2) pela ótica
de "o número está certo", e aponta as seguintes lacunas — nenhuma delas
bloqueia o spec, mas todas precisam virar critério de aceite explícito ou
caso de teste obrigatório antes de `/tdd`:

1. **Critério 2.1.6 e 2.2.10 (nunca total colapsado) não especificam de onde
   vem a soma exibida.** "Mostra a lista ao lado da soma" é necessário mas
   não suficiente: se a soma exibida for computada por uma consulta separada
   (ex.: `SUM()` em SQL com um filtro levemente diferente do que populou a
   lista), os dois números podem divergir sem que nenhum teste pegue — a
   soma "parece certa" porque é plausível, mas não é a soma das linhas que o
   usuário está olhando. **Teste obrigatório:** a soma exibida é sempre
   recalculada em cima do mesmo array de linhas que a resposta devolve
   (`soma === linhas.reduce(Dinheiro.somar)`), nunca uma segunda consulta.
   Isto vale tanto para `Meta interna da carteira` (2.1.6) quanto para a
   visão de grupo sobre `Cobrança` (2.2.10).

2. **Critério 2.2.7 (idempotência tripla) testa só a contagem de linhas, não
   o valor.** "Rodar o job 3 vezes produz o mesmo número de linhas" não prova
   que a 2ª e 3ª execução não **sobrescrevem** o valor da `Cobrança` já
   gerada (ex.: um `UPSERT` com `ON CONFLICT DO UPDATE` em vez de `DO
   NOTHING` passaria nesse teste e ainda assim violaria o critério 2.2.8 —
   snapshot imutável — se a mensalidade tiver mudado entre a 1ª e a 3ª
   execução no mesmo dia). **Teste obrigatório:** gerar a cobrança de
   outubro, mudar a mensalidade, rodar o job mais duas vezes no mesmo dia, e
   confirmar que `valor_centavos` da linha de outubro **não mudou** — não só
   que a contagem de linhas ficou igual. O mecanismo correto é `INSERT ...
   ON CONFLICT (cliente_carteira_id, competencia) DO NOTHING`, nunca `DO
   UPDATE`.

3. **Interação entre job de geração e `Benefício de indicação` não tem
   critério de aceite.** O spec descreve o desconto (Pergunta 1) e a geração
   idempotente (critério 2.2.7) como se fossem independentes, mas não são: um
   `Benefício` é "desconto na mensalidade **seguinte**", ou seja, de uso
   único. Se o job roda 3 vezes no mesmo dia (teste de idempotência já
   exigido), e a aplicação do benefício não for atômica com a criação da
   linha de `Cobrança` (mesma transação, mesma constraint de unicidade), há
   risco real de: (a) o benefício ser consumido na 1ª execução mas a
   `Cobrança` falhar por outro motivo, deixando o cliente sem o desconto que
   já "gastou"; ou (b) duas execuções concorrentes aplicarem o mesmo
   benefício a duas competências diferentes. **Critério de aceite que falta
   no spec, a acrescentar antes do ticket:** "consumir um `Benefício de
   indicação` e criar a `Cobrança` com desconto aplicado é uma única
   transação; rodar o job 3 vezes no mesmo dia aplica o benefício **no
   máximo uma vez**, e a linha de auditoria mostra exatamente um consumo."

4. **Critério 2.1.2 (CHECK de coerência `valor_centavos`/`valor_inteiro`)
   está bem desenhado, mas falta o caso simétrico para a tabela de metas.**
   O critério só descreve o teste para `lancamentos_de_indicador`. `metas`
   (`valor_meta`, `valor_inicial`) tem o mesmo par de colunas e a mesma regra
   de unidade (§1, linha `Meta comercial do cliente`) — o CHECK e o teste
   equivalente precisam existir lá também, não só em `lancamentos_de_indicador`.
   Sem isso, é fácil a migration nascer com o CHECK num lugar só.

5. **Tipo de `percentual` do `Benefício de indicação` não está declarado em
   lugar nenhum do modelo de dados do spec**, só na assinatura de função da
   Pergunta 1 (que usa `number`, já corrigido acima na Decisão 1). A coluna
   em `beneficios` (hoje texto livre no protótipo, "10% de desconto") precisa
   nascer como `percentual_centesimos bigint NOT NULL CHECK (percentual_centesimos
   BETWEEN 0 AND 10000)` desde a primeira migration de G3 — não como `TEXT`
   com parsing depois.

## Resumo do veredito

**Spec aprovado para seguir a `/to-tickets`**, condicionado a:

- As quatro decisões provisórias desta ADR entrarem no ticket como está
  (reversíveis, com link para esta ADR e para as perguntas do spec).
- Os 5 achados da seção anterior virarem critério de aceite explícito nos
  tickets de G3 (type `PercentualCentesimos`, soma-de-linhas-visíveis,
  idempotência por valor além de contagem, atomicidade benefício+cobrança,
  CHECK simétrico em `metas`) — nenhum deles muda o desenho do spec, mas
  todos fecham um caminho por onde "quase certo" passaria no code review.
- Nenhum ticket de G3 é aceito com `percentual: number` em assinatura de
  função perto de `Dinheiro` — é a mesma classe de erro que a regra 1 existe
  para proibir, só que do lado do fator em vez do valor.

**Nada nesta ADR substitui a confirmação do dono.** As quatro decisões
numeradas 1–4 são a base de trabalho enquanto a resposta não chega; no dia em
que o dono responder (mesmo que seja "sim, a recomendação está certa"), esta
ADR é atualizada para "estado: aceita" com a data da confirmação — ou
substituída por uma ADR nova, se a resposta divergir da recomendação.

## Consequências

- `arquiteto-dominio` pode modelar `aplicarDesconto` e `Cobrança do Cliente
  Firmare` com o tipo `PercentualCentesimos` e a fórmula `ceilDiv` desta ADR,
  sem esperar o dono — mas marca o código com um comentário apontando para
  esta ADR, não como verdade definitiva.
- `engenheiro-qa-automacao` recebe os 5 achados da seção "Achados do gate"
  como casos de teste nomeados a incluir na suíte de G3, além dos
  property-based tests da Decisão 1.
- Se o dono responder diferente de qualquer uma das quatro recomendações, o
  custo de retrabalho é conhecido e pequeno: a Decisão 1 muda a direção de
  `ceilDiv` para `floorDiv` (ou outra regra); as Decisões 2 e 3 trocam "mês
  cheio sempre" por uma fórmula de proporção — que então **precisa** da regra
  2 completa do `CLAUDE.md` (`max − min ≤ 1`), porque proporção por dias é
  uma divisão de verdade, diferente do desconto desta ADR.
