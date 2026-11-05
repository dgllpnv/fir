# Spec de produto — G3: metas comerciais, indicadores e cobrança do Cliente Firmare

- **Data:** 2026-11-05
- **Fase:** spec de produto, **antes** do gate de risco. Nenhum ticket, nenhuma migration, nenhum código.
- **Autor:** `product-rotina-clinica` (sessão de spec), a pedido do dono, seguindo o plano `docs/superpowers/plans/2026-11-05-plano-integracao-firmare-gestao.md` §7 (G3) e §9 (perguntas pendentes).
- **Não edita** o plano principal — fica para o dono mesclar.

---

## 0 · Achado que muda o enquadramento de G3

O plano-mãe (§3, tabela de mapeamento) registra: *"`lancamentos` → Dinheiro real
(Firmare cobrando o grupo) → `Dinheiro` de `packages/domain`, centavos"*. **Fui
conferir isso direto no protótipo de origem**
(`C:\Users\DAVI LOPES\Desktop\AURI PROJETOS\Firmare Gestão\index.html`,
`fg-portal.js`, `fg-supabase.js` — não o `prototipo-rotinas-de-gestao.html`
deste repositório, que é sobre a clínica e **não tem nenhum conceito
equivalente a carteira comercial, meta, indicador ou cobrança**; a "Firmare
Gestão" é um protótipo separado, em outra pasta, da mesma PO).

**O que o código do protótipo realmente faz é diferente do que o mapeamento
assumiu**, e isso é exatamente o padrão de erro que o `CLAUDE.md` manda
prevenir ("confira na fonte, não no relatório de outro agente"):

| Coleção do protótipo | O que de fato guarda (lido do código) |
|---|---|
| `indicadores` | `{id, cliente_id, nome, unidade, meta, sentido, ativo}` — a **definição** de uma métrica acompanhada para um cliente (ex.: "Faturamento", unidade "R$"; ou "Tarefas concluídas", unidade "un") |
| `lancamentos` | `{id, indicador_id, referencia, valor, observacao, lancado_por}` — **um ponto de medição** de um indicador num período (ex.: a semana de 10/11), **upsert por `(indicador_id, referencia)`** (`index.html:2973`: se já existe lançamento daquela referência, atualiza o `valor`; senão, cria) |
| `metas` | `{id, cliente_id, titulo, indicador, valor_meta, sentido, valor_inicial, valor_atual, fonte, inicio, prazo, status}` — uma **meta posta pela Firmare sobre um indicador de um cliente**, com progresso calculado a partir dos `lancamentos` daquele indicador (ou de uma planilha Google, campo `fonte`) |
| mensalidade (não é coleção — é campo de `clientes`) | `c.valor_mensal` (número puro, reais, não centavos — `2800`) + `c.pagamentos[mes] = <data ISO>` (um mapa mês→data-de-pagamento, **sem valor próprio**: o painel sempre lê `c.valor_mensal` atual para mostrar quanto "foi" pago, mesmo que a mensalidade tenha mudado depois — ver §2 abaixo) |

**Conclusão: `lancamentos` não é, e nunca foi, a cobrança da Firmare sobre o
Cliente Firmare.** É o **registro histórico de medição de uma métrica do
negócio do cliente** (faturamento da clínica, número de pacientes, o que for
— a unidade pode ser monetária ou não), alimentando a tela de "Metas da
clínica" que a própria clínica vê no portal (`fg-portal.js:120-126`). A
cobrança real (dinheiro que a Firmare recebe do cliente) é um mecanismo **à
parte e muito mais simples no protótipo**: um valor fixo e um mapa de
mês-pago.

Isto muda o nome de duas coisas que o G3 vai precisar, e evita que o
vocabulário novo entre em `CONTEXT.md` errado:

- **`Lançamento`** (termo que o protótipo já usa e que a carteira herda) =
  **lançamento de indicador** — uma medição de uma métrica do negócio do
  cliente, não uma transação monetária da Firmare.
- A cobrança de verdade (o que a Firmare fatura de cada Cliente Firmare) **não
  tem nome no protótipo** além do campo cru `valor_mensal`. Este spec cunha um
  termo novo para ela — ver §1 — justamente para **não colidir** com
  "lançamento", que já significa outra coisa.

Isto não é uma correção pequena: se `arquiteto-dominio` tivesse modelado
`lancamentos` como "a tabela de cobrança", teria juntado, na mesma tabela,
dinheiro real (regra de Dinheiro, regras 1-7) com medição de negócio do
cliente (que pode nem ser dinheiro) — exatamente o tipo de mistura que as
regras inegociáveis probem implicitamente ao exigir que cada conceito tenha
um lugar.

---

## 1 · Vocabulário (para `CONTEXT.md`)

| Termo | Definição | Não confundir com |
|---|---|---|
| **`Indicador da carteira`** | Uma métrica de negócio definida para um `Cliente Firmare`, com nome e unidade (`R$`, `un`, `%`, ...) e direção de melhoria (`maior_melhor`/`menor_melhor`). É a **definição**, não um valor. Ex.: "Faturamento semanal" (unidade R$), "Novos pacientes no mês" (unidade un) | `Indicador de desempenho` interno de RH (não existe hoje) |
| **`Lançamento de indicador`** | Uma medição pontual de um `Indicador da carteira`, datada por `referência` (período — hoje, semana), com `valor`, observação opcional e quem lançou (`Usuário de Gestão`). **Não é dinheiro entrando ou saindo de lugar nenhum** — é um número que a equipe Firmare registra sobre o negócio do cliente, à mão (hoje) ou futuramente por leitura automatizada de planilha. **Idempotente por `(indicador_id, referência)`**: relançar a mesma semana corrige o valor, não duplica a linha | `Recebimento` (dinheiro que entra na clínica) · `Cobrança do Cliente Firmare` (ver abaixo) |
| **`Meta comercial do cliente`** | Um alvo posto por um `Usuário de Gestão` sobre um `Indicador da carteira` de **um** `Cliente Firmare`: valor-alvo, sentido de melhora, prazo, status (`em_andamento`/`concluída`). O progresso é derivado do último `Lançamento de indicador` da série (ou da fonte configurada), nunca um campo mutável à parte | `Meta interna da carteira` (ver linha seguinte) |
| **`Meta interna da carteira`** (conceito novo, sem equivalente no protótipo — ver §3) | Um alvo da **própria equipe Firmare** sobre a carteira inteira ou sobre um `Usuário de Gestão` (ex.: "fechar 3 Clientes Firmare novos este trimestre", "manter churn abaixo de 5%"). Reaproveita a mesma estrutura de `Indicador`/`Meta`/`Lançamento`, mas com `cliente_carteira_id` **nulo** e escopo `geral` ou por `usuario_gestao_id` | `Meta comercial do cliente` |
| **`Cobrança do Cliente Firmare`** (termo novo, cunhado aqui — **não usar "lançamento" para isto**) | O registro de **dinheiro real que a Firmare fatura de um `Cliente Firmare`** numa competência (mês). Um por `(cliente_carteira_id, competência)`, valor em `Dinheiro` (centavos), vencimento, status (`aberto`/`pago`/`cancelado`), quando foi pago. Gerado por job mensal idempotente, mesma disciplina de `uso_diario_cliente` (G4) | `Lançamento de indicador` · `Recebimento` da clínica (dinheiro do paciente, outro domínio inteiramente) |
| **`Mensalidade`** | O valor vigente, em `Dinheiro`, que um `Cliente Firmare` paga por competência — propriedade de `Cliente Firmare` (`clientes_carteira.mensalidade_centavos`), não de `Grupo` (decisão do dono, plano §9 item 6). Mudar o valor afeta cobranças **futuras**; cobranças já geradas guardam o valor **da época**, nunca recalculado (ver §2) | — |
| **`Benefício de indicação`** | Desconto aplicado a **uma** `Cobrança do Cliente Firmare` futura, concedido por indicação de um lead convertido (`beneficios`, já mapeado no plano §3). Hoje, no protótipo, um texto livre ("10% de desconto na mensalidade seguinte") — G3 precisa de uma representação exata (percentual + direção de arredondamento, ver §3) | — |

---

## 2 · Critérios de aceite

### 2.1 · Indicador, Meta comercial do cliente, Lançamento de indicador

1. Criar um `Indicador da carteira` exige `cliente_carteira_id`, `nome` e
   `unidade`; `unidade` é um de um conjunto fechado por enquanto
   (`"R$"`, `"un"`, `"%"`) — unidade livre em texto fica para quando houver
   um pedido real, não antes (mesmo princípio de "não construir abstração
   sem uso real" do `LeitorDeIndicadores`, plano §4).
2. Se `unidade = "R$"`, todo `valor` de `Lançamento de indicador` e de
   `Meta.valor_meta`/`valor_inicial` é armazenado como `Dinheiro` (centavos,
   `bigint`), **nunca** `number`/`NUMERIC`. Se `unidade ∈ {"un","%"}`, o valor
   é um inteiro simples (contagem ou percentual em centésimos — nunca
   ponto flutuante, regra 8 se aplica a quantidade e a percentual do mesmo
   jeito). **Um único tipo de coluna não serve às duas unidades** — a tabela
   `lancamentos_de_indicador` tem duas colunas (`valor_centavos bigint null`,
   `valor_inteiro bigint null`) com `CHECK` garantindo que só a coerente com
   a `unidade` do indicador está preenchida. Teste: inserir um lançamento de
   indicador `unidade="R$"` com `valor_inteiro` preenchido falha no banco.
3. Lançar duas vezes a mesma `(indicador_id, referência)` com valores
   diferentes **atualiza a mesma linha** e grava uma entrada de auditoria
   (quem, quando, de→para) — porque o valor é visível no portal do cliente
   (G6) e a clínica tem o direito de saber que o número mudou depois de
   publicado. Teste: lançar R$ 38.000 na semana X, depois R$ 36.500 na mesma
   semana X — a tabela tem **uma linha**, a auditoria tem **duas entradas**.
4. Progresso de uma `Meta comercial do cliente` é sempre **derivado** no
   momento da leitura (último `Lançamento` da série, ou a fonte configurada)
   — nunca um campo `valor_atual` persistido e sincronizado à mão (o
   protótipo faz isso hoje com `valor_atual`; G3 corrige, porque campo
   mutável duplicando um derivado é a mesma classe de erro vetada para saldo
   de estoque, regra 11, e para saldo em aberto, regra 5).
5. `Meta comercial do cliente` sem nenhum `Lançamento` ainda mostra "Aguardando
   o primeiro lançamento" (comportamento do protótipo, `index.html:126` —
   preservado, porque é bom e já funciona).
6. Soma de indicador `unidade="R$"` entre clientes de grupos diferentes
   **nunca aparece num card único**: cada card de "Meta interna da carteira"
   que agregar vários clientes mostra a lista de clientes e valores ao lado
   da soma (mesma regra 6 do CLAUDE.md, já aplicada a `campanhas_carteira`
   por ADR 0013 §6 — a mesma disciplina se estende a qualquer soma de
   Dinheiro na carteira).

### 2.2 · Cobrança do Cliente Firmare (dinheiro real da Firmare)

7. Um job mensal idempotente gera **exatamente uma** `Cobrança do Cliente
   Firmare` por `(cliente_carteira_id, competência)`, para todo `Cliente
   Firmare` com `status = 'ativo'` na data de geração. Rodar o job 3 vezes
   no mesmo dia produz o mesmo número de linhas (regra 26 — mesmo teste de
   idempotência tripla que G4 já tem para `uso_diario_cliente`).
8. `Cobrança do Cliente Firmare.valor_centavos` é **gravado no momento da
   geração**, cópia do `clientes_carteira.mensalidade_centavos` vigente
   naquele instante — nunca recalculado a partir do valor atual depois. Isto
   **corrige um defeito real do protótipo**: `painelMensalidades()`
   (`index.html:727`) sempre lê `c.valor_mensal` atual para desenhar o valor
   de qualquer mês passado, então mudar a mensalidade hoje reescreve
   silenciosamente o valor mostrado para meses já cobrados. Teste: gerar
   cobrança de outubro com mensalidade R$ 2.800; mudar a mensalidade para
   R$ 3.100 em novembro; reler a cobrança de outubro e confirmar que ainda
   mostra R$ 2.800.
9. Marcar uma `Cobrança` como paga é uma ação manual do `Usuário de Gestão`
   ou do `Operador` (preserva o fluxo do protótipo — "Marcar pago"/"Desfazer"
   — não existe conciliação bancária automática nesta fatia), com registro de
   quem e quando (trilha de escrita, regra 20).
10. A visão de um `Usuário de Gestão` com `escopo = grupo` sobre a cobrança de
    um grupo com mais de uma clínica mostra **uma linha por `Cliente
    Firmare`**, nunca um total só — mesma regra 6/ADR 0013 §6, agora
    aplicada a dinheiro de verdade, não a agregado de telemetria.
11. Nenhuma resposta de API da carteira devolve `valor_centavos` (de
    `Cobrança`, `Indicador unidade="R$"`, `Meta.valor_meta` monetário, ou
    `mensalidade_centavos`) para um `Usuário de Gestão` sem a permissão
    `valores` — a redação acontece no ponto único já existente (regra 17),
    estendido para cobrir as tabelas novas.
12. Desativar um `Cliente Firmare` (`status → 'encerrado'` ou `'pausado'`)
    **não** apaga nem altera cobranças já geradas (append-only de fato,
    soft-state só muda o que acontece **daqui para frente**: o job de
    geração simplesmente para de criar linhas novas para aquele cliente).

---

## 3 · Perguntas que precisam de spec de `Dinheiro` antes de virar ticket

Preciso que o dono decida as três perguntas abaixo (a quarta é escopo, não
Dinheiro, mas também bloqueia o ticket de `beneficios`/cobrança). Numeradas
para resposta rápida — cada uma com a recomendação que eu daria se tivesse
que decidir sozinho, mas **não decidi** porque envolve dinheiro real cobrado
de um cliente (regra 1-7) e política comercial que não está no protótipo nem
em nenhum ADR aceito.

### Pergunta 1 — direção de arredondamento do desconto de indicação

**O cenário exato:** `Benefício de indicação` aplica um desconto percentual
(hoje, no protótipo, sempre "10%", mas o campo é texto livre — G3 precisa de
um número) sobre a mensalidade do mês seguinte. Mensalidades reais não são
sempre múltiplos de 10 centavos exatos — ex.: um cliente com mensalidade de
**R$ 1.850,33** (185.033 centavos, por causa de um reajuste proporcional
anterior) ganha 10% de desconto: `185.033 × 0,10 = 18.503,3` centavos — uma
fração de centavo que precisa de uma regra de arredondamento, porque
`Dinheiro` é sempre inteiro (regra 1).

- **Opção A (minha recomendação):** arredondar o **desconto para cima**
  (18.504 centavos), o que arredonda a **cobrança final para baixo**
  (166.529 centavos). Isto segue a frase que a própria ADR 0013 §8 já deixou
  escrita como restrição ("nunca arredondar a favor de cobrar mais do que o
  preço cheio") — never round in the direction that charges the client a
  cent more than the clean 90%.
- Opção B: arredondar a cobrança final para o centavo mais próximo (pode
  cobrar 1 centavo a mais que o "90% exato" em metade dos casos) — violaria
  a frase já escrita na ADR, então eu não a recomendaria, mas registro como
  alternativa existente.

**Preciso que o dono confirme a Opção A** (ou aponte uma terceira) antes de
`arquiteto-dominio` escrever a função `aplicarDesconto(mensalidade: Dinheiro,
percentual: number): Dinheiro` — é exatamente o tipo de regra que pede
property-based test (a soma do desconto + cobrança final deve ser igual à
mensalidade cheia, sempre, regra 2 adaptada).

### Pergunta 2 — vínculo no meio do mês: primeira mensalidade cheia ou proporcional?

Quando um `Cliente Firmare` é vinculado (onboarding) no dia 17 de um mês, a
primeira `Cobrança` daquele mês é pelo valor cheio, ou proporcional aos dias
restantes do mês?

- **Minha recomendação: sempre mês cheio, sem proporcionalidade.** Três
  razões: (a) o protótipo não tem nenhuma lógica de proporção em lugar
  nenhum do código de mensalidade — `data_inicio` existe só para mostrar
  "Início" no cadastro, nunca entra em conta de valor; (b) proporcionalizar
  abriria a mesma classe de problema de arredondamento de centavo da
  Pergunta 1, por uma economia pequena (a diferença de poucos dias numa
  mensalidade B2B de consultoria); (c) simplicidade de cobrança costuma ser
  política comercial deliberada em B2B de serviço ("o mês de onboarding é
  cheio porque o trabalho da equipe começa no dia 1, não no dia do
  contrato") — mas essa é uma leitura comercial que só o dono confirma.

**Preciso que o dono confirme "sempre mês cheio"** ou informe se a Firmare
já pratica proporcionalidade com os clientes reais hoje (fora da ferramenta)
— se já pratica, G3 nasceria errado por replicar uma política que não é a
usada de fato.

### Pergunta 3 — desativação no meio do mês: reembolso proporcional ou não?

Se um `Cliente Firmare` é desativado no dia 10, e a `Cobrança` do mês
corrente já foi gerada (e talvez já paga), a Firmare devolve uma parte
proporcional, ou a mensalidade do mês de saída é sempre integral?

- **Minha recomendação: sempre integral, sem reembolso automático.**
  Simetria com a Pergunta 2 (nenhuma das duas pontas é proporcional) e
  ausência total de mecanismo de estorno em qualquer lugar do protótipo. Se
  a Firmare decidir devolver algo por cortesia comercial num caso pontual,
  isso é uma ação manual e documentada fora da ferramenta (ou um
  `Conta a pagar` da Firmare para o cliente, registrado à parte) — não um
  cálculo automático dentro de `Cobrança`.

**Preciso que o dono confirme "sempre integral, sem reembolso automático"**
— ou diga se existe cláusula contratual real de proporcionalidade na saída,
porque isso mudaria o modelo de `Cobrança` (precisaria de um campo de
estorno ligado à cobrança original, nunca um `DELETE`).

### Pergunta 4 (escopo, não Dinheiro, mas bloqueia o ticket) — nota fiscal

A ADR 0013 §8 já deixou esta em aberto: existe emissão de nota fiscal de
serviço da Firmare para o Cliente Firmare hoje, fora da ferramenta (ex.:
emitida manualmente por um contador, ou por outro sistema)? Isso importa
porque, se existir imposto retido na nota (ISS, por exemplo), o valor líquido
recebido pode divergir do `valor_centavos` da `Cobrança`, e isso é **mais uma
fonte de arredondamento** que teria que entrar no modelo de `Dinheiro` desde
o início — não como ajuste depois.

- **Minha recomendação: fora de escopo de G3.** Nada no protótipo modela
  nota fiscal ou imposto. Trato `Cobrança do Cliente Firmare` como o valor
  bruto cobrado (o que está no contrato), e deixo nota fiscal/imposto como
  um épico futuro próprio, só se e quando a Firmare quiser emitir pela
  ferramenta (hoje, provavelmente, é um processo manual fora dela).

**Preciso que o dono confirme que isto está mesmo fora de escopo** — ou
aponte que já existe um fluxo real de emissão que a ferramenta precisa
respeitar desde já.

---

## 4 · O que fica explicitamente de fora de G3

- **Nota fiscal / imposto sobre a cobrança** — Pergunta 4 acima; fora até o
  dono confirmar que existe fluxo real.
- **Leitura automatizada de planilha Google para `Lançamento de indicador`**
  (`LeitorDeIndicadores`) — o plano §4 já decidiu não construir essa
  abstração enquanto a cópia for manual. G3 só entrega o lançamento manual
  (o que o protótipo já faz, `index.html:2973`).
- **`diagnosticos` e `transcricoes`** — excluídos por ADR 0013 §1, de todos
  os épicos. G3 não reabre essa decisão.
- **Proporcionalidade de cobrança** (entrada ou saída no meio do mês) — fora
  por recomendação (Perguntas 2 e 3), até confirmação do dono.
- **Conciliação bancária automática da `Cobrança`** — "marcar pago" continua
  manual, como no protótipo. Integração com um provedor de pagamento (Pix
  automático, split) é outro épico, não pedido até aqui.
- **`Meta interna da carteira`** (quota de vendas por `Usuário de Gestão`,
  churn-alvo da carteira) — desenhada em §1 como reaproveitamento da mesma
  estrutura de `Indicador`/`Meta`/`Lançamento`, mas **não é entrega
  obrigatória de G3** se o dono preferir cortá-la: nada no protótipo pede
  isso (o protótipo só tem metas **sobre o cliente**, nunca metas internas da
  equipe Firmare) — é a parte deste spec mais "desenhada do zero", como o
  pedido original avisou que poderia ser necessário.
- **Multi-moeda** — tudo em BRL, como o protótipo e como o resto do produto.
- **Portal do cliente mostrando as novas entidades (G6)** — G3 entrega o
  modelo e as telas internas (`Usuário de Gestão`/`Operador`); ligar isso ao
  portal do cliente é consumo do G6, que já está no escopo completo por
  decisão do dono (plano §9, item 3b), mas é outro ticket.

---

## 5 · Resumo: o que decidi sozinho vs. o que precisa do dono

### (a) Decidido com base em lógica de produto e nos ADRs já aceitos

- `lancamentos`/`indicadores`/`metas` do protótipo **não são** a cobrança da
  Firmare — são medição de negócio do cliente. Confirmado lendo o código-fonte
  do protótipo, não um relatório. Isto corrige o mapeamento do plano-mãe §3.
- Vocabulário novo (§1): `Indicador da carteira`, `Lançamento de indicador`,
  `Meta comercial do cliente`, `Meta interna da carteira`, `Cobrança do
  Cliente Firmare`, `Mensalidade`, `Benefício de indicação` — com
  `Cobrança` deliberadamente **não** chamada de "lançamento", para não
  colidir com o sentido que o protótipo já consagrou.
  
- Tipo de valor por `unidade` do indicador (R$ → `Dinheiro`/centavos; `un`/`%`
  → inteiro), nunca uma coluna `NUMERIC` genérica.
- Progresso de meta é sempre derivado do último lançamento, nunca um campo
  `valor_atual` persistido (corrige o protótipo, que tem esse campo mutável).
- Cobrança gravada por valor da época (snapshot no momento da geração),
  nunca recalculada do valor atual da mensalidade — corrige um defeito real
  do protótipo (`painelMensalidades` lê o valor atual para qualquer mês
  passado).
- Job mensal idempotente para gerar `Cobrança`, mesmo padrão já usado e
  verificado em G4 para `uso_diario_cliente`.
- Regra 6 (nunca total colapsado) se estende a qualquer soma de Dinheiro na
  carteira, inclusive `Cobrança` — já era a regra para `campanhas_carteira`.
- Redação de `valores` (regra 17) cobre as tabelas novas pelo mesmo ponto
  único existente.

### (b) Perguntas que precisam da resposta do dono antes de `arquiteto-dominio` modelar `Dinheiro`

1. **Arredondamento do desconto de indicação:** arredondar o desconto para
   cima (cobrança final para baixo) — **minha recomendação é confirmar esta
   opção**, já é o que a ADR 0013 §8 sugere em prosa; falta o número exato.
2. **Mensalidade no mês de onboarding:** sempre cheia, sem proporção —
   **minha recomendação é confirmar "sempre cheia"**, por ausência de
   qualquer lógica de proporção no protótipo e para não reabrir a classe de
   problema de arredondamento da Pergunta 1 por um ganho pequeno.
3. **Mensalidade no mês de saída/desativação:** sempre integral, sem
   reembolso automático — **minha recomendação é confirmar "sempre
   integral"**, pela mesma ausência de mecanismo no protótipo; se existir
   cláusula contratual real de proporcionalidade, preciso saber antes de
   fechar o modelo de `Cobrança` (mudaria de "nunca estorna" para "tem campo
   de estorno ligado à cobrança original").
4. **Nota fiscal de serviço:** fora de escopo de G3 — **minha recomendação é
   confirmar que está fora**, porque não há nenhum traço de NF-e no
   protótipo e provavelmente é processo manual hoje; se houver imposto
   retido na prática, isso muda o modelo de `Dinheiro` da `Cobrança` desde o
   início, não depois.

Nenhuma dessas quatro perguntas tem resposta no protótipo (ele nunca lida
com fração de centavo, proporção de mês ou nota fiscal) nem em ADR aceita —
por isso seguem para o dono, com recomendação, em vez de eu decidir.
