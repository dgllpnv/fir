# Linguagem ubíqua — Firmare Rotinas de Gestão

**Nome no código = nome aqui = nome na tela.** Termo novo entra neste arquivo **primeiro**, com definição e invariantes, e só depois vira código.

> **Estado: semente.** Este arquivo foi extraído do protótipo, do `Code.gs` da v20 e do documento de passagem. Ele cobre os conceitos centrais e os termos proibidos. A rodada de `/grill-with-docs` da Fase 0.2 (ver `docs/pipeline.md`) completa as invariantes por entidade antes da primeira migration. **Não crie entidade nova sem passar por aqui.**

---

## Termos proibidos

O legado carrega três gerações de nomes para as mesmas coisas. Essa dívida se paga uma vez, aqui.

| Não escreva | Escreva | Por quê |
|---|---|---|
| `plano` | `Procedimento` (catálogo) ou `Programa` (do paciente) | A aba chama-se `Planos`, o campo chama-se `planoId`, e os dois significam coisas diferentes em telas diferentes. É a ambiguidade mais cara do legado |
| `adesão` | `Programa` | Mesmo conceito, nome antigo |
| `pagamento` sozinho | `Recebimento` (entra) ou `Conta a pagar` (sai) | Dinheiro que entra e dinheiro que sai não compartilham nome |
| `baixa` sozinha | `Movimento de consumo`, `de descarte`, `de uso interno` | "Baixa" esconde qual dos três |
| `valor` nu | `Dinheiro` ou `Quantidade` | Os dois convivem na mesma tela de estoque |
| `admin = true/false` | `Perfil de acesso` com `permissões` | O booleano foi substituído pela matriz; usá-lo reintroduz o modelo antigo |
| `qtd` sem unidade | `Quantidade` com `medida` | Quantidade sem unidade é a origem da dose errada |
| `e-mail`, `email`, `convite` | `Usuário` (o identificador de login) | **D-10:** o e-mail saiu do produto inteiro. Não há coluna, não há convite, não há SMTP. `grep -rn "email"` em `apps` e `packages` devolve zero, e é assim que fica |
| `admin` para o superadmin | `Operador` | `admin` é a administradora **da clínica**, que é uma `Pessoa`. O superadmin é um `Operador`, que **não é uma `Pessoa`** — confundir os dois é o primeiro passo para um booleano em `pessoas` |
| `/painel` como rota do superadmin | `/superadmin` | `painel` é chave de permissão existente (`painel` → `valores`) e é o nome da tela do épico 8. A allowlist de IP casa o segmento `superadmin`; usar `painel` bloquearia a tela de indicadores para a clínica inteira |

**A única exceção, e ela é deliberada:** o **nome do tipo de tarefa** continua `'Sessão de plano'`
(`TIPO_SESSAO`, em `packages/domain/src/tipos-de-tarefa.ts`). É a string gravada em milhares de
linhas nas 4 clínicas; renomeá-la obrigaria o migrador a reescrever dado para ganhar nada. **Não
"corrija" essa constante.** O rótulo que a usuária lê não é o nome do tipo — ele sai de
`itens_do_programa.rotulo_sessao`.

---

## Os dois value objects

### `Dinheiro`
Inteiro de **centavos**, com moeda. Nunca ponto flutuante, nunca `number`. Toda aritmética monetária passa por ele, inclusive soma de lista e total calculado em query.

**Invariantes:** somar moedas diferentes lança erro · divisão distribui o resto um centavo por parte, nas primeiras partes, com `max − min <= 1` e soma exatamente igual ao todo.

### `Quantidade`
Inteiro na **menor unidade indivisível declarada do item**, com a unidade carregada no tipo.

**Invariantes:** somar quantidades de itens diferentes lança erro · somar unidades diferentes sem conversão declarada lança erro · converter ida e volta devolve exatamente o original.

---

## Entidades centrais

### `Clinica`
O tenant. **Toda tabela de negócio tem `clinica_id NOT NULL` com RLS.** Tem `ativa` (estado, nunca exclusão) e **fuso próprio** — não existe fuso global no sistema.

### `Pessoa` e `Perfil`
`Pessoa` é quem usa a ferramenta; tem `ativo`, e desativar nunca apaga. O acesso vem de um `Perfil`, que é um conjunto de `permissões` por pilar — não mais de um booleano `admin`.

**O identificador de login é `usuario`**, único por clínica, e **não há e-mail** (D-10). A forma canônica é `normalizar_nome(usuario)` restrita ao alfabeto de identificador — `^[a-z][a-z0-9]*([._-][a-z0-9]+)*$`, 3 a 32 — e quem a define é o **banco**, por `CHECK`. Ela existe para ser **ditável por telefone**: `ana.silva` se dita sem ambiguidade, `Ana Silva` não. Não há coluna "como foi digitado": um identificador de login não tem valor de exibição.

**Senha definida por outra pessoa é `senha provisória`**: gerada no servidor (quatro palavras, `pinheiro-balde-sete-azul`), devolvida **uma única vez** na resposta que a criou, válida por 72 h, e a pessoa é obrigada a trocá-la no primeiro acesso. **Ninguém nunca lê a senha de outra pessoa** — nem quem a redefiniu. É o defeito da D-0 corrigido: na v20 o administrativo vê o PIN de cada pessoa.

**`temPerm(usuario, perfis, chave)` é uma função só**, em `packages/domain`, usada por servidor e tela. O servidor sempre valida. Dependências entre chaves (`finmes` → `valores`, `painel` → `valores`) vivem na tabela.

Perfis padrão de uma clínica nova: Supervisão/gestão · Recepção · Comercial · Enfermagem · Financeiro.

### `Operador` — o superadmin

**Ele NÃO é uma `Pessoa`.** Tabela própria (`operadores`, **sem `clinica_id`**), cookie próprio (`__Host-fir-painel`, 8 h), prefixo de rota próprio (`/v1/superadmin`). Um booleano `superadmin` em `pessoas` já teria perdido o modelo: a mesma sessão passaria a poder sair do próprio tenant, e a RLS que sustenta o produto dependeria de um `if` (D-5, restrição 1).

**Ele nunca atravessa a RLS.** Ele fixa `app.clinica_id` da clínica em que opera, como qualquer um, por uma **segunda conexão autenticada** como `fir_painel` — papel sem `BYPASSRLS`. Duas conexões separadas por **autenticação**, nunca por `SET ROLE`: `RESET ROLE` desfaz na mesma transação (D-5, restrição 5).

**A formulação que vale: o acesso é total; o registro é obrigatório.** A clínica não pode nos barrar, mas pode nos **ver**. Toda ação do operador dentro de uma clínica cai na `auditoria` **dela**, com `ator_tipo = 'operador'`, pela trigger. O que é **sobre operadores** — "o operador entrou", "a senha dele foi redefinida pela VPS" — vai para `auditoria_do_painel`, porque `auditoria.clinica_id` é `NOT NULL` e a clínica sentinela foi recusada por escrito na migration `0002`.

A **cadeia de criação** (D-10): superadmin → cria a clínica e a administradora dela; admin → cria a equipe. A cadeia de **"esqueci a senha"** é a mesma, ao contrário: pessoa → o admin redefine; admin → o superadmin redefine; superadmin → **comando na VPS**, por quem tem SSH, gravado na trilha.

### `Tarefa`
Qualquer item da rotina: interna, contato, atendimento, pagamento ou sessão. É a entidade mais usada do produto.

**Invariante central:** um agendamento é **uma única `Tarefa`** que anda pelas etapas da `Jornada`; cada movimento entra em `historico`. Nunca uma tarefa nova por etapa.

### `Jornada`
As **nove** etapas de um agendamento, e cada uma obriga um `status` (`CHECK etapa_combina_com_status`, migration `0007`):

| Etapa | `status` | O que significa |
|---|---|---|
| `agendado` | `aberta` | marcado, sem resposta da paciente |
| `confirmado` | `aberta` | a paciente respondeu que vem |
| `faltou` | **`aberta`** | não compareceu |
| `desmarcou` | **`aberta`** | avisou que não vem |
| `realizado` | `concluida` | o atendimento aconteceu |
| `orcamento` | `concluida` | proposta apresentada, aguardando decisão |
| `fechado` | `concluida` | **terminal** — aceitou e pagou |
| `perdido` | `concluida` | **terminal** — desistiu, com motivo |
| `encerrado` | `cancelada` | **terminal** — faltou/desmarcou e não reagendou |

**Invariante:** `faltou` e `desmarcou` mantêm a tarefa **aberta** até alguém **reagendar** (volta a `agendado`) ou **encerrar**. É isso que faz o cartão aparecer em "Recontatar" todo dia até alguém resolver — e é o ritual que a ferramenta existe para instalar.

A jornada é uma **tabela de dados** em `packages/domain/src/jornada.ts`, não um encadeamento de `if`: 13 ações, 23 transições permitidas, e `transicao()` é a única porta. O funil conta por **`acao` declarada** (`contaNoFunil` na tabela), nunca por inferência de rótulo — `reagendar` leva a `agendado` e **não conta**, senão quem remarcou três vezes vira três agendamentos. Ver [ADR 0004](docs/adr/0004-maquina-de-estados-da-jornada.md).

**Termo proibido: `acaoEm`.** No protótipo ele tem dois significados — dia do no-show e dia de retomar o orçamento. Use `proximo_passo_em`.

### `proximo_passo_em`
**O dia a partir do qual este cartão volta a pedir ação.** Um campo, um significado.

Substitui o `acaoEm` de dois sentidos, e com isso "Recontatar" e "Orçamentos para retomar" passam a ser a **mesma** cláusula (`proximo_passo_em <= hoje`) — no protótipo são duas consultas que já divergiram: Recontatar não filtra por data, retomar filtra.

`noshow` e `desmarcar` o põem em **hoje**; `registrarOrcamento` em **hoje + 2**; `followUp` em **hoje + 3**; `reagendar`, `encerrar`, `perder` e `fechar` o **limpam**. Os padrões são calculados no servidor, no fuso da clínica (regra 24) — a tela os **mostra**, não os decide.

### `Motivo de perda`
Por que um orçamento se perdeu. **É dado da clínica, não `enum` do código**: toda clínica nova nasce com os cinco do protótipo (Preço · Sem retorno do paciente · Escolheu outro lugar · Não é o momento · Outro) e pode acrescentar os seus.

**Invariantes:**
- **Obrigatório no servidor** ao perder — o protótipo aceita sem, e aí o KPI *"veja os motivos no histórico"* aponta para um histórico vazio.
- O evento guarda o **`motivoId` e o nome no instante**. Renomear "Preço" não pode reescrever o relatório do trimestre passado; com só o nome, não dá para agrupar.
- Desativar é um **estado** (`ativo`), nunca uma exclusão. Motivo desativado não serve para perda nova e continua legível nas antigas.

### `Recebimento`
Dinheiro que entra. *"Atendimento é tarefa; dinheiro é recebimento."*

**Invariante:** o pagamento pode ficar **embutido no atendimento** ou ser um **recebimento avulso** — nunca os dois para o mesmo dinheiro. Dobrar a receita do mês por aqui é o erro clássico da categoria.

`Orçamento` **não** é recebimento: `valorOrcamento` nunca entra em receita, LTV ou meta.

### `Venda a prazo`
A linha de `recebimentos` com **`valor = 0`, `valor_aberto > 0` e forma vazia**: o programa fechou, a paciente não pagou nada hoje e deve tudo. Decisão **D-9** do dono (2026-10-26), e o protótipo faz o mesmo — *"fechou, paga depois"*.

Ela existe porque o saldo vem de **uma** fonte (regra 5): sem linha não há dívida registrada, e a clínica que vendeu R$ 3.600 teria zero no sistema.

**Invariantes:**
- **A linha nunca é vazia:** `CHECK (valor > 0 OR valor_aberto > 0)` — ela registra dinheiro recebido **ou** dinheiro devido. `valor >= 0` sozinho aceitaria uma linha que não registra nada.
- **Forma vazia ⟺ valor zero** (`CHECK ((valor > 0) = (forma <> ''))`). Não existe forma de pagamento para dinheiro que não se moveu, e "Pix" num recebimento de R$ 0,00 apareceria como um Pix que ninguém fez no primeiro lugar que parasse de filtrar.
- **`valor` nunca é negativo.** Um recebimento negativo subtrai da receita do dia sem passar por estorno, que é o caminho que a regra 20 fecha.

### `Dinheiro que entrou`
A pergunta *"quanto entrou"* — e ela **exclui a `Venda a prazo`**. Um filtro só (`DINHEIRO_QUE_ENTROU`), usado pelo **caixa do dia**, pela **lista de recebimentos do dia**, pelo **LTV da paciente** e pela **receita do mês**.

Uma constante e não quatro `WHERE`s, pela mesma razão da regra 17: o quarto lugar não é revisado com o cuidado do primeiro, e o quinto nasce sem o filtro. **Se vazar no caixa**, a conferência acusa uma diferença que não existe e a recepcionista procura por uma hora o erro que ela não cometeu. O protótipo vaza num dos quatro (a lista do dia) — divergência consciente, ver [ADR 0006](docs/adr/0006-programa-montado-por-itens.md).

A pergunta do **saldo** é a oposta e **tem** de incluir a venda a prazo: somar o que a paciente deve é somar `valor_aberto`.

### `Saldo em aberto`
Derivado: `aberto − abatido`, **agrupado por `Programa`**, com um grupo geral para o que não é de programa. Nunca campo mutável, nunca colapsado num total só.

O clamp em zero é **por grupo** — um programa pago a mais não reduz a dívida de outro. E o excedente que o clamp engole **não se descarta**: ele sai como `credito` do grupo. Paciente que pagou a mais é erro de lançamento ou crédito real, e os dois precisam aparecer; `Math.max(0, …)` sem o crédito esconde o incidente.

### `Caixa do dia`
Conferência **às cegas**: o esperado por forma de pagamento é calculado no **servidor** e **não atravessa para o cliente** antes do fechamento. Nota promissória não entra. Um fechamento por dia.

`conferido` é **toda linha com diferença zero**, nunca "o total zerou": sobra numa forma e falta igual em outra zeram o total, e a clínica teria dois erros achando que não tem nenhum.

### `Conta a pagar`
Dinheiro que **sai**. Descrição, categoria (uma das dez de `CATEGORIAS_DESP`), valor, vencimento, fornecedor e **responsável** — é o responsável que define quem a vê e quem a paga.

**Invariantes:**
- **A recorrência é a `Série`, nunca um booleano.** Uma conta mensal pertence a uma série (`serie_id`) e carrega a **âncora** (`dia_vencimento`, 1–31). Duas representações do mesmo fato divergem no dia em que alguém desmarca uma e não a outra.
- **A âncora é o dia ORIGINAL**, e é ela que faz 31/12 → 31/01 → 28/02 → **31/03**. Sem âncora, a conta cai no dia 28 em fevereiro e nunca mais volta.
- **A conta do mês seguinte nasce uma vez**, garantida por `UNIQUE (clinica_id, serie_id, vencimento)` — não por um `if` no serviço, que perde a corrida entre duas abas.
- **Conta paga não se exclui.** Ela faz parte do resultado do mês; apagá-la muda o passado sem deixar rastro. Excluir é soft delete, e só antes do pagamento.
- O que entra no mês é o **valor pago**, que pode diferir do valor da conta.
- As formas de **saída** não são as de entrada: `Boleto`, `Transferência` e `Débito automático` existem aqui e não em `Recebimento`; `Nota promissória` existe lá e não aqui.

### `Marcador de rotina`
O rótulo que liga uma `Tarefa` à rotina que a criou (ex.: `fechamento-do-mes`). É dado da rotina, nunca do usuário — ninguém o digita.

**Invariante:** `UNIQUE (clinica_id, marcador, prazo)` entre as tarefas vivas. Criar a mesma rotina duas vezes produz o mesmo conjunto de `(marcador, prazo)`, e o segundo `INSERT … ON CONFLICT DO NOTHING` não escreve nada. Idempotência sem lock.

### `Procedimento`
O catálogo da clínica (aba `Planos` no legado). Tem sessões e intervalo **sugeridos**, rótulo da sessão, valor **por sessão**, regra de retorno, e os insumos: `insumoPadrao` mais `insumos[]` fixos.

**Invariantes:**
- **Sessões e intervalo são sugestão, e mudá-los não toca em quem já está em tratamento.** O MANUAL diz exatamente isso (cap. 11): *"Mudanças de sessões e intervalo valem para novas adesões; quem já está no programa mantém as sessões programadas."* O que torna a frase verdadeira não é disciplina: é que a sessão é **materializada** e o item copia `procedimento_nome` e `rotulo_sessao` no instante da montagem. Nenhum caminho de leitura alcança a agenda de quem já começou. Renomear "Tirzepatida" para "Tirzepatida 5 mg" não reescreve a ficha de ninguém — o agrupamento usa o `procedimento_id`, a leitura usa o nome gravado.
- **Desativar é um estado** (`ativo`): o procedimento deixa de ser oferecido em adesão nova e **continua montando** uma proposta feita antes da desativação. Excluir é soft delete, e é **recusado** enquanto algum programa ou alguma **proposta viva** (`tarefas.programa_orcado`) o usar.

### `Programa`
Montado **por paciente**, com vários `Item do programa` — cada um com seu procedimento, sessões, intervalo, dose e início (data própria, início do programa, ou `depoisDe` outro item). Ex.: Tirzepatida 4× 2,5 mg, depois 4× 5 mg.

**Invariantes:**
- **Não existe programa sem itens.** O `Code.gs` da v20 tem uma adesão = **um** `planoId`; a conversão *"adesão antiga = programa de um item `i1`"* acontece **uma vez, no migrador do épico 9**, e o runtime nunca deriva nada. É o mesmo movimento de `etapaDerivada` na ADR 0004 — o migrador deriva, a leitura não.
- **Nenhum número derivado é gravado:** nem `sessoes`, nem `saldo`, nem `recebido`, nem `valor_total`, nem o nome do programa. O legado guarda os cinco. O nome sai da concatenação dos `procedimento_nome` dos itens; o total, da soma de `itens_do_programa.valor`; o recebido e o saldo, de `recebimentos`. Cada campo desses é um segundo número para a mesma pergunta, e o segundo é o que fica errado.
- **`Σ itens.valor = valorTotal`, exatamente.** O valor negociado é rateado entre os **itens**, proporcional a valor de referência × sessões, nunca entre as sessões — é por item que a clínica encerra, troca ou desconta.
- **Encerrar e excluir são rotas diferentes porque a intenção é diferente.** Encerrar é *a paciente parou*: `situacao = 'encerrado'`, sessões abertas canceladas, realizadas no histórico, **estoque intocado** (as doses saíram do frasco). Excluir é *o registro foi feito por engano*: soft delete, compensação no estoque, e **recusado quando há recebimento vivo** (D-8). Ver [ADR 0006](docs/adr/0006-programa-montado-por-itens.md).

### `Item do programa`
Um `Procedimento` dentro do `Programa`, com **sessões, intervalo, dose e início próprios**. É o que torna a escalada de dose **um** tratamento: Tirzepatida 4× 2,5 mg e depois 4× 5 mg são dois itens de um programa, não duas adesões sem vínculo.

**Invariantes:**
- **A chave é do programa** (`i1`, `i2`), e é por ela que a sessão, o contato de retorno e a reprogramação se referem ao item. Repetida, é recusada.
- **O início é uma de três coisas:** data própria, o início do programa, ou **`depoisDe` outro item**. No encadeamento, **o intervalo é o do filho, não o do pai** — item mensal que segue item semanal começa 30 dias depois da última sessão do pai, não 7. Medido no protótipo rodando; um teste com 7 e 7 nos dois itens não distingue as duas implementações, que é exatamente o caso com que todo mundo confere.
- **Ciclo em `depoisDe` é recusado, nomeando o item.** No protótipo `i1 depoisDe i2` com `i2 depoisDe i1` passa, e o programa nasce sem sessão nenhuma, em silêncio.
- **`procedimento_nome` e `rotulo_sessao` são copiados no instante da montagem.** É o que protege quem já começou da edição do catálogo.
- **A dose nunca anda sem a unidade:** `insumo_milesimos` (inteiro, regra 8) e `insumo_unidade` viajam e são gravados juntos, ou nenhum dos dois. Quantidade sem unidade é a origem da dose errada.
- **`valor` é preço negociado, não recebimento.** Ele não entra em receita, LTV nem meta (regra 4, pelo espírito). A soma dos `valor` dos itens é **exatamente** o valor total do programa.
- **Limite:** 12 itens na montagem, 10 na proposta do orçamento. Não se contradizem — a proposta é subconjunto da montagem.
- **O intervalo vai a 365 dias** no item (é o caso real: um retorno anual), e a 180 no catálogo (é sugestão).

### `Sessão`
Uma `Tarefa` de tipo `'Sessão de plano'`, **numerada dentro do seu item** (`5/12` do item `i1`, não do programa).

**Invariantes:**
- **A sessão é materializada, não derivada.** Uma linha por sessão, escrita **uma vez** na montagem, com `programa_id`, `item_chave`, `sessao_indice` e `sessao_total`. O programa não recalcula a agenda a cada leitura: ele só a **move** quando alguém pede. Uma sessão cancelada continua existindo; uma sessão reprogramada não vira outra.
- **A numeração é do item, e é única nele** (`UNIQUE (programa_id, item_chave, sessao_indice)`). Ser sessão implica ter os quatro campos, com `indice BETWEEN 1 AND total`; e **só** sessão é numerada — um follow-up com `sessao_indice` é dado que nenhuma tela sabe mostrar.
- **Não se exclui uma sessão**: cancele-a, ou encerre o programa. Excluir abre buraco na numeração (`5/12` sem `6/12`), e é a numeração que a reprogramação usa para saber o que vem depois.
- **Concluir uma sessão tem rota própria**, e `POST /v1/tarefas/:id/concluir` a recusa. Concluir uma sessão não é concluir uma tarefa: ela reprograma as seguintes, dá baixa no estoque e, na última do item, cria o `Contato de retorno`.
- **Reprogramar é escolha obrigatória no corpo, nunca padrão.** Um padrão silencioso move a agenda de doze aplicações sem ninguém ter pedido, e o movimento só aparece na semana seguinte.
- **Sessão concluída não conta na jornada.** Contá-la faria doze aplicações de uma paciente virarem doze atendimentos no denominador da conversão.

**O nome do tipo é `'Sessão de plano'`, e isso é deliberado** — é a string gravada em milhares de linhas nas 4 clínicas, e renomeá-la obrigaria o migrador a reescrever dado para ganhar nada. **O rótulo que a usuária lê não é o nome do tipo:** ele sai de `itens_do_programa.rotulo_sessao` ("Aplicação 5/12 · Tirzepatida 2,5 mg"). O termo proibido `plano` continua proibido em todo o resto.

### `Modo de cobrança`
Como o programa cobra: **`saldo`** quando a adesão abriu valor em aberto (a paciente deve, e a dívida aparece no `Saldo em aberto` agrupada por este programa) ou **`avulso`** quando cada sessão registra o que foi pago no dia.

**Invariantes:** é **derivado uma vez, na montagem**, do pagamento informado — não um campo que a recepção escolhe numa lista. Os dois legados fazem a mesma conta (`saldo` se `valorAberto > 0`, senão `avulso`), e a conferência do épico 9 compara o valor campo a campo.

### `Contato de retorno`
A `Tarefa` criada **sozinha** quando o último item termina, para a paciente repetir o procedimento.

```
podeEm = última sessão do item + quantidade (meses ou dias)
prazo  = podeEm − antecedência
se prazo < hoje da clínica  →  prazo = hoje da clínica
```

**Invariantes:**
- **Um por item**, não um por adesão — e nasce só quando não restam sessões abertas **daquele item**, não há retorno vivo dele, o programa não está encerrado e o procedimento tem regra de retorno. Para o dado migrado (um item `i1`) as duas regras coincidem, e é isso que o épico 9 cobra.
- **A aritmética de mês é a regra 25**: 4 meses de 31/01 cai no último dia do mês curto, pelo `somarMeses` que já existe. Escrita à mão, ela devolve 03/03 em vez de 28/02.
- **O prazo nunca nasce no passado**, e `hoje` é o do **servidor**, no fuso da clínica (regra 24) — o protótipo usa o relógio do navegador. Sem o clamp, um retorno calculado a partir de uma sessão antiga nasce *"atrasado há cinco meses"*, e a lista de hoje abre com um cartão vermelho que ninguém atrasou.
- **Aderir de novo cancela o retorno antigo** do mesmo paciente + procedimento, com `obs: 'Paciente refez o procedimento'`. Sem isso, quem acabou de comprar o tratamento recebe a ligação de *"você já pode repetir"*.

### `Item de estoque`
Três unidades, e as conversões vivem **no cadastro**:

```
1 unidCompra = fatorCompra × medida     (1 caixa = 4 ampolas)
1 medida     = fatorUso    × unidUso    (1 ampola = 5 mg)
```

`medida` é a unidade de estoque, e **saldo é sempre em `medida`**.

### `Movimento` de estoque
`contagem` (=, ponto de partida) · `entrada` (+) · `consumo` (−, uso em paciente) · `descarte` (−) · `interno` (−) · `ajuste` (±, só gestão, motivo obrigatório).

**Invariantes:** append-only · desfazer é movimento compensatório ligado à origem (`tarefaId`), nunca `DELETE` · lote por FIFO de validade · item que não aproveita sobra gera **dois** movimentos (consumo da dose + descarte da sobra) somando a unidade inteira.

### `Contagem`
Contagem **às cegas**: a quantidade esperada **não atravessa para o cliente** antes do fechamento. É invariante de transporte, não de tela.

### `Análise` de estoque
```
inicial + entradas − saídas = esperado
diferença = contagem final − esperado
```
**A diferença é relatada, nunca corrigida.** Ela é o produto inteiro do módulo: é ela que mostra à clínica que há saída sem registro.

### `Dado de saúde`
Dose, produto, lote e aplicação **por paciente** são **dado pessoal sensível** (LGPD art. 11). Base legal própria, acesso por perfil, **registro de acesso — não só de escrita** — e nunca em log. Ver `especialista-lgpd-saude`.

---

## Glossário rápido

| Termo | Significado |
|---|---|
| **Recontatar** | Agendamentos com no-show ou desmarcação aguardando novo contato |
| **Item do programa** | Um procedimento dentro do programa, com sessões, intervalo, dose e início |
| **Sessão** | Uma `Tarefa` de tipo `'Sessão de plano'`, numerada **dentro do seu item** |
| **Modo de cobrança** | `saldo` (a adesão abriu valor em aberto) ou `avulso` (cada sessão registra o que pagou) |
| **Contato de retorno** | A tarefa criada sozinha ao fim de um item, para a paciente repetir o procedimento |
| **Venda a prazo** | Recebimento de `valor = 0` com `valor_aberto > 0`: o programa fechou, ela paga depois |
| **Dinheiro que entrou** | A pergunta "quanto entrou", que exclui a venda a prazo. Um filtro, quatro consultas |
| **Unidade de estoque / compra / uso** | Como se conta / como se compra / como se aplica |
| **Contagem às cegas** | Contagem sem mostrar a quantidade esperada |
| **Caixa às cegas** | Conferência do caixa sem mostrar o valor registrado |
| **Diferença** | Contagem final − saldo esperado. Negativo = falta sem registro |
| **Perda não explicada** | Diferença negativa recorrente num item |
| **LTV** | Total já pago pelo paciente à clínica |
| **Saldo em aberto** | Quanto o paciente ainda deve, por programa e no geral |
| **Crédito** | O que o grupo recebeu **a mais** do que abriu. Nunca abate outro grupo |
| **Conta a pagar** | Dinheiro que sai, com categoria, vencimento e responsável |
| **Série** (de conta) | O vínculo que torna uma conta mensal, com a âncora do dia |
| **Âncora** | O dia original do vencimento (1–31), que sobrevive ao mês curto |
| **Marcador de rotina** | O rótulo que liga uma tarefa à rotina que a criou |
| **Perfil de acesso** | Conjunto de permissões por pilar |
| **Pilar** | Dia a dia · Comercial · Financeiro · Processos · Pessoas · Gestão |

---

## Onde a regra deste arquivo já foi quebrada

A regra do topo — *termo novo entra aqui primeiro, e só depois vira código* — foi invertida uma
vez, e vale registrar em vez de apagar.

**`Modo de cobrança` e `Contato de retorno` viraram coluna de banco antes de entrar neste
arquivo.** `programas.modo_de_cobranca` e as colunas de retorno de `procedimentos` nasceram na
migration `0010`, e os verbetes só chegaram no fechamento do épico 5. **Não deu defeito porque os
dois nomes vieram prontos do protótipo** (`modo: 'saldo' | 'avulso'` e `retorno`/`antecedencia`),
então código, banco e tela já concordavam — o glossário só confirmou o que estava escrito.

O que isso custou é o que a regra existe para evitar: durante o épico inteiro, as **invariantes**
dos dois termos moravam só em comentário de serviço e em `CHECK` de migration. Quem tivesse
precisado saber se o modo é escolhido ou derivado teria de ler o montador para descobrir. Migration
aplicada não se edita, então inverter a ordem significa que um nome mal escolhido vira dívida de
esquema — e aí a correção deixa de ser de uma linha neste arquivo.

**Para a próxima entidade:** o verbete antes da migration. Custa dez minutos, e é o momento em que
um nome ambíguo ainda é barato de trocar.
