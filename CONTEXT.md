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

**A clínica nunca fica sem administradora ativa.** É **uma** função do domínio
(`podeDesativar` e `podeTrocarAcesso`, em `packages/domain/pessoa.ts`) para os
**dois** caminhos que podem violá-la — desativar e rebaixar. No protótipo a
regra existe no `excluirPessoa` e **não** no `salvarPessoa`, que é justamente o
caminho pelo qual a tela desmarca "Ativa"; e `login` exige `u.ativo`. A última
administradora desmarca a própria caixa, sai, e ninguém da clínica abre
Configurações de novo — a única saída é o superadmin.

**Desativada e excluída são DOIS estados, e nenhum deles apaga a linha** (regra
20, e a mesma decisão da ADR 0003 para paciente). Não há `DELETE` — o protótipo
oferece "inativar" e "excluir de vez", e a segunda apaga a linha e deixa as
tarefas antigas apontando para um id inexistente, que ele contorna copiando o
nome para dentro de cada tarefa.

A clínica usa as duas afirmações, e elas são diferentes:

- **`ativo = false` — desativada:** "afastada, de licença, não usa mais a
  ferramenta, mas é da equipe". **Continua na lista**, para voltar num toque.
- **`excluida_em` — excluída (D-14):** "não é mais da equipe". **Sai da lista** e
  de toda escolha. **Excluída implica inativa**, por `CHECK` (migration `0023`):
  não existe pessoa fora de toda tela e ainda entrando — e é esse `CHECK` que
  deixa `entrar` precisando conferir só `ativo`.

Colapsar as duas obrigaria a recepção a procurar, entre quinze inativas, as três
que ainda voltam.

**As duas derrubam as sessões vivas**: "tirei o acesso dela" tem de ser verdade
no instante do toque, senão a clínica que demitiu alguém às 14h descobre às 18h
que ela esteve na ferramenta a tarde inteira.

**A clínica nunca fica sem administradora ativa por nenhum dos três caminhos** —
desativar, rebaixar e excluir —, e **admin inativa não conta** para o mínimo.
São três chamadores e **uma** tabela de regras (`podeDesativar`,
`podeTrocarAcesso`, `podeExcluirPessoa`), inclusive para o superadmin: ele não
tranca a clínica que viria destrancar.

**O `usuario` não se edita, e isso é decisão** (D-14): ele é ditado por
telefone, é o nome pelo qual a equipe chama a pessoa, e é a chave de
`tentativas_login.identificador`. Trocá-lo quebraria o que ela decorou e
misturaria o histórico de bloqueio de duas contas. Por isso o índice único de
`(clinica_id, usuario)` **não** é parcial em `excluida_em` — ao contrário do de
`perfis`: não se reaproveita identificador de gente.

**Perfil excluído é soft delete.** Uma pessoa inativa continua apontando para
ele, e um `DELETE` chegaria à tela como erro de constraint sobre um perfil que
ninguém mais usa. Ele some das escolhas, continua legível no histórico, e a
chave estável dele volta a ser usável (o índice único é parcial).

### `Operador` — o superadmin

**Ele NÃO é uma `Pessoa`.** Tabela própria (`operadores`, **sem `clinica_id`**), cookie próprio (`__Host-fir-painel`, 8 h), prefixo de rota próprio (`/v1/superadmin`). Um booleano `superadmin` em `pessoas` já teria perdido o modelo: a mesma sessão passaria a poder sair do próprio tenant, e a RLS que sustenta o produto dependeria de um `if` (D-5, restrição 1).

**Ele nunca atravessa a RLS.** Ele fixa `app.clinica_id` da clínica em que opera, como qualquer um, por uma **segunda conexão autenticada** como `fir_painel` — papel sem `BYPASSRLS`. Duas conexões separadas por **autenticação**, nunca por `SET ROLE`: `RESET ROLE` desfaz na mesma transação (D-5, restrição 5).

**A formulação que vale: o acesso é total; o registro é obrigatório.** A clínica não pode nos barrar, mas pode nos **ver**. Toda ação do operador dentro de uma clínica cai na `auditoria` **dela**, com `ator_tipo = 'operador'`, pela trigger. O que é **sobre operadores** — "o operador entrou", "a senha dele foi redefinida pela VPS" — vai para `auditoria_do_painel`, porque `auditoria.clinica_id` é `NOT NULL` e a clínica sentinela foi recusada por escrito na migration `0002`.

A **cadeia de criação** (D-10): superadmin → cria a clínica e a administradora dela; admin → cria a equipe. A cadeia de **"esqueci a senha"** é a mesma, ao contrário: pessoa → o admin redefine; admin → o superadmin redefine; superadmin → **comando na VPS**, por quem tem SSH, gravado na trilha.

### `Sessão de suporte`

A sessão **do produto** que carrega um `Operador` em vez de uma `Pessoa` — é por ela que o
superadmin abre o sistema de uma clínica já logado, com privilégio de administradora (D-13).

`sessoes` ganhou `operador_id`, `pessoa_id` ficou anulável, e um `CHECK` exige **exatamente um dos
dois**: nunca nenhum, nunca os dois. Não é um segundo tipo de sessão — é a mesma linha, com outro
sujeito.

**Invariantes:**
- **O operador NUNCA vira uma `Pessoa` da clínica.** Nenhuma linha em `pessoas` nasce disto, e por
  isso ele não aparece em lista de equipe, em seletor de responsável, em contagem de pessoas, em
  meta nem em banco de horas. Um booleano em `pessoas` já teria perdido o modelo (D-5, restrição 1).
- **Toda escrita dele cai na `auditoria` DAQUELA clínica com `ator_tipo = 'operador'`** e o id dele,
  pela trigger — jamais atribuída a uma pessoa. `app.pessoa_id` carrega `operador:<uuid>`, que é a
  sentinela que a 0013 já ensinou à trigger.
- **Uma clínica por vez.** A sessão fixa `app.clinica_id` daquela clínica, como qualquer um: nada de
  `BYPASSRLS`, nada de sessão que alcance duas clínicas. Trocar de clínica é outra sessão.
- **A tela diz que é ela.** O casco do produto mostra, de forma permanente, a faixa dourada do
  painel. Uma sessão que parece a de uma administradora faz quem a usa agir achando que é a clínica
  agindo.
- **Curta e revogável.** **Trinta minutos**, sem renovação, e `POST /v1/sair` a mata. Sair do painel
  revoga **todas** as sessões de suporte vivas daquele operador (`revogar_sessoes_de_operador`), e
  desativar o operador as derruba no instante seguinte — `resolver_sessao` exige `operadores.ativo`.

**`eu.usuario` é `null` nela**, e isso é o desenho: não há pessoa. As telas que dependem de "quem
sou eu" (filtro *Para mim*, responsável padrão, *Minhas metas*) mostram **vazio** — fingir que o
operador é alguém poria o nome de uma funcionária numa ação que não foi dela.

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

**Invariantes:**
- **Cada conversão viaja inteira ou não viaja.** "Caixa" sem dizer quantas ampolas vêm nela não é conversão: é um rótulo que a tela mostra e que nenhuma conta usa. O protótipo aceita o par meio preenchido e o descarta na leitura, então a clínica cadastra "caixa", não vê erro, e a entrada em caixas simplesmente não aparece como opção.
- **Unidade de compra ou de uso igual à `medida` é recusada.** A conversão nunca seria aplicada (a medida casa primeiro), e o número gravado passaria a depender da ordem dos `if`.
- **Converter unidade que o item não declarou é ERRO**, nunca uma conversão em silêncio (regra 10) — o silêncio aqui é a dose mil vezes maior.
- **O mínimo nulo é "este item não tem mínimo", e não "o mínimo é zero".** Tratá-los igual faz nenhum item ficar abaixo dele, e a tarefa de reposição nunca nasce.
- **O campo de quantidade na API é `saldoEmEstoque`, nunca `saldo`.** `saldo` está em `CAMPOS_MONETARIOS` por causa do saldo em aberto da paciente, e a redação de valores casa **nome de chave** sem olhar o tipo — chamado `saldo`, o número era apagado para quem não tem `valores`, e a tela do estoque da enfermagem mostrava o catálogo inteiro **sem número nenhum**. É o mesmo conserto de `resultado` → `resultadoDoMes`: nome genérico em dinheiro é nome que colide.

### `Local de estoque`
Onde o item fica **na clínica**: sala de estoque, sala de enfermagem, geladeira, sala da doutora. Cada item fica em **um** local, e a lista de contagem sai agrupada por ele — como um roteiro de quem vai contar.

**Invariantes:**
- O nome é único **por unidade de atendimento**, pelo nome normalizado. "Sem unidade" é **um** balde que deduplica, não a ausência de balde: a clínica de um endereço só é justamente a que teria duas "Geladeira".
- Desativar é um **estado**; excluir é soft delete. O item aponta para o local, e o movimento antigo foi feito num item que morava ali.

### `Movimento` de estoque
`contagem` (=, ponto de partida) · `entrada` (+) · `consumo` (−, uso em paciente) · `descarte` (−) · `interno` (−) · `ajuste` (±, só gestão, motivo obrigatório).

**Invariantes:**
- **Append-only**, em duas camadas: `REVOKE UPDATE/DELETE` para o papel da aplicação e trigger que alcança o DONO. Sozinho, o `REVOKE` é teatro — `fir_migrate` tem BYPASSRLS.
- **Desfazer é movimento compensatório ligado à origem**, por `compensa_id` (a linha revertida) **e** por `tarefaId`, nunca `DELETE`. A compensação tem o **mesmo** item, o **mesmo** tipo, o **mesmo lote** e a quantidade oposta — cobrado por trigger, porque `CHECK` não vê outra linha. Saldo certo com lote errado é a dose do frasco vencido na próxima paciente.
- **Um movimento é compensado no máximo uma vez** (`UNIQUE (compensa_id)`). É isto, e não um `if` no serviço, que torna `desfazer` idempotente: reabrir duas vezes não devolve a dose duas vezes, e duas abas correndo têm a segunda recusada pelo banco.
- **A quantidade é sempre em `medida`, assinada, em milésimos.** A nota chega em caixas e a dose em mg; as duas são convertidas na BORDA pelos fatores do cadastro. Uma coluna `unidade` por movimento seria a segunda representação do mesmo número.
- **O sinal vem do tipo**, por `CHECK`. `ajuste` é o único dos dois sentidos, e carrega o sinal no próprio valor. O legado guarda `qtd` positiva mais uma coluna `sinal` usada só pelo ajuste, e deriva o resto de um `if` encadeado — três lugares para a mesma pergunta.
- **A ordem é `(dia, em, sequencia)`**, e a `sequencia` monotônica não é luxo: `now()` em Postgres é o instante da TRANSAÇÃO, então toda linha escrita junta compartilha `em` exatamente. Sem o terceiro critério, uma contagem e uma entrada do mesmo instante ordenam de forma arbitrária e o saldo muda entre duas leituras do mesmo dado.
- **Lote por FIFO de validade**, e item que não aproveita sobra gera **dois** movimentos (consumo da dose + descarte da sobra) somando a unidade inteira. A sobra exige unidade de **uso** declarada: "sobra de frasco aberto" só existe onde há frasco de que se tira dose — numa seringa, arredondar para cima descartaria meia seringa que ninguém abriu.
- **O saldo não é clampado em zero**, e aqui divergimos do protótipo (`Math.max(0, …)`). Saldo negativo significa mais saída registrada do que havia — lançamento duplicado, contagem errada, consumo sem entrada. Mostrar zero esconde o incidente exatamente onde ele seria visto, e é o mesmo erro que o clamp do `Saldo em aberto` cometia antes do crédito.

### `Contagem`
A lista do que contar, gerada por um filtro, com um responsável e um prazo — e ela **vira uma `Tarefa`** para quem vai contar. É isso que a põe na rotina em vez de numa aba que ninguém abre.

Contagem **às cegas**: a quantidade esperada **não atravessa para o cliente** antes do fechamento. É invariante de transporte, não de tela.

**Invariantes:**
- **O esperado não existe na resposta da contagem aberta** — não é `null`, não é redigido: o contrato `ContagemAberta` não tem o campo (regra 14). E ela também **não traz os lotes conhecidos do item**: pré-preencher as validades conta à pessoa o que o sistema espera achar na prateleira, que é o esperado por outro caminho.
- **O filtro é resolvido no SERVIDOR**, nunca na tela. `altoValor` depende da `Curva ABC`, que depende do custo de todos os itens — e custo é redigido para quem não tem `valores` (regra 17). Resolvido no cliente, o filtro da enfermagem receberia uma lista de `custo: null` e devolveria o catálogo inteiro.
- **A contagem de um item com validade é um GRUPO de movimentos**, uma linha por lote, amarradas por `movimentos_de_estoque.contagem_id`. A prateleira com 2 frascos de junho e 1 de setembro é **uma** contagem, não três. Sem o grupo, o saldo leria só a última linha e os outros frascos desapareceriam sem erro na tela.
- **O rascunho é mutável; o livro-razão não.** "Salvar e continuar depois" grava em `contado_na_contagem` e **não gera movimento nenhum**. O movimento nasce no fechamento, e aí é append-only.
- **Concluir duas vezes é recusado.** A segunda chamada não reescreve o saldo.
- **O mês da validade digitada vira o ÚLTIMO DIA do mês**, não o dia 1º. A caixa imprime "06/2027", e isso quer dizer "até o fim de junho" — é a mesma regra do `DD = 00` do GS1. O protótipo grava o dia 1º e antecipa a validade em 29 dias.

### `Tarefa de reposição`
A `Tarefa` que nasce sozinha ao fechar a contagem, para o item que ficou **abaixo do mínimo**: *"Repor estoque: Tirzepatida 5 mg (tem 2 ampola, mínimo 4 ampola)"*, com prazo de dois dias e o responsável do item.

**Invariante:** no máximo **uma viva por item**, garantida pelo índice `tarefa_de_reposicao_viva` — não por um `if` no serviço. Duas contagens concluídas ao mesmo tempo criariam duas tarefas para o mesmo item, e a segunda só apareceria na lista de quem compra.

### `Análise` de estoque
```
inicial + entradas − saídas = esperado
diferença = contagem final − esperado
```
**A diferença é relatada, nunca corrigida.** Ela é o produto inteiro do módulo: é ela que mostra à clínica que há saída sem registro. Não existe rota que "acerte" o estoque pela diferença: corrigir é um `ajuste` com motivo e `estoque.gerir`, e ele aparece **como ajuste** na análise seguinte.

**Invariantes:**
- **As duas bordas são CONTAGENS, não datas.** O esperado precisa de um ponto de partida que alguém **viu na prateleira**; com bordas de data, o "inicial" seria um saldo derivado, e comparar um derivado com um contado mede o acumulado desde a última contagem, não o período pedido. Sem duas contagens, a resposta é *"sem contagens no período"* — nunca uma diferença que não significa nada.
- **A contagem do meio é ignorada**, e isso é deliberado: ela é outra **medição**, nunca uma correção. Tomá-la como ponto de partida esconderia a parte da perda que ela já tinha acusado.
- **A inicial é a última contagem ANTES de `de`** (ou a primeira dentro da janela). O protótipo usa `<=` e, com duas contagens no primeiro dia do período — o caso do primeiro dia de uso —, escolhe a segunda como partida e devolve "sem contagens".
- **O esperado de uma contagem FECHADA pode atravessar**, e isso não contradiz a regra 14: ela proíbe o esperado antes do fechamento, e uma contagem fechada não pode mais ser influenciada. Mesma classificação de "Últimos fechamentos" no caixa.

### `Curva ABC`
A classificação de Pareto do estoque por **valor** (`saldo × custo`): **A** até 80% do valor acumulado, **B** até 95%, **C** o resto. É ela que decide "alto valor" quando a clínica não forçou (`altoValor = ''` no cadastro).

**Invariantes:**
- **O acumulado é o de ANTES do item.** Com o acumulado depois, o item que sozinho vale 90% do estoque cairia em C — e "alto valor" deixaria de fora justamente o frasco mais caro da geladeira.
- **Valor não-positivo é C e não entra no total.** Aqui divergimos do protótipo, que clampa o saldo em zero: somar um valor negativo ao total encolheria o denominador, e um item com lançamento duplicado promoveria todos os outros a "alto valor".
- **Calculada no servidor, sobre o catálogo inteiro.** Ela é relativa por definição; item a item seria sempre `A`. E o que atravessa é a **letra**, não o custo — é isso que faz o filtro "alto valor" funcionar para quem conta a prateleira sem ver preço.
- **Só os itens ATIVOS entram.** Um item desativado com estoque parado puxaria o denominador e rebaixaria itens que a clínica usa toda semana.

### `Nota de entrada`
A NF-e lançada no estoque. Traz fornecedor, número, data, e uma linha por produto — e, nos medicamentos, **uma linha por lote** (o bloco `rastro` do XML).

**Invariantes:**
- **A ingestão é IDEMPOTENTE (regra 26), por DUAS chaves de esquema:** a **chave de acesso** da NF-e (44 dígitos) e, para a nota digitada à mão, o par **emissor + número**. Reimportar o mesmo XML três vezes devolve os **mesmos movimentos, com os mesmos ids**, e `jaRegistrada: true`. O protótipo responde erro; devolver o resultado é o que faz a terceira importação parecer com a primeira — quem apertou duas vezes precisa saber se o estoque entrou.
- **O protótipo não dedupa a nota digitada**, e lançá-la duas vezes dobra o estoque de um item caro sem nenhum aviso. É o erro da receita dobrada (regra 3) do outro lado do balcão.
- **O XML é lido no SERVIDOR**, pelo seam `LeitorDeNota`: o casamento com o catálogo depende dos vínculos salvos, e o custo unitário é dinheiro — lido no navegador, chegaria inteiro a quem não tem `valores`.
- **O casamento SUGERE, nunca decide** (regra 27): vínculo salvo → código igual → nome muito parecido → sugestão para conferir → nada. A tela diz *qual* dos cinco, e a diferença entre "nome parecido" e "sugestão: confira" é a diferença entre a pessoa conferir e não conferir.
- **Nenhum ponto flutuante atravessa.** `qCom: "3.0000"` vira `3000` milésimos e `vUnCom: "1520.00"` vira `152000` centavos, lidos **do texto dos dígitos**. Uma quarta casa decimal diferente de zero na quantidade é **erro**, nunca arredondamento.

### `Vínculo de nota`
A ligação `(CNPJ do emissor, código do produto) → (item, fator)`. *"A ferramenta guarda essa ligação para as próximas notas desse fornecedor"* (MANUAL cap. 12).

**Invariantes:**
- **O fator é cadastro, nunca número em código** (regra 9): "1 CX = 10 ampolas" é conhecimento da clínica, e é ela que o confirma na primeira nota.
- A chave inclui o **CNPJ**: o `cProd` é único dentro do emissor, nunca entre emissores. Sem o CNPJ, o "MJ5-01" de uma distribuidora casaria com o item ligado ao "MJ5-01" de outra.

### `Ficha de pessoa`
O registro de RH de quem trabalha na clínica — **inclusive quem não usa a ferramenta**. Cargo, tipo de contrato, admissão, aniversário, **salário**, gestor direto e o `Usuário` ligado a ela.

**Ela não é a `Pessoa`, e a distinção é o desenho.** `Pessoa` é quem **entra** (login, perfil, ativação — tela *Usuários e acessos*, chave `config`). A `Ficha` é quem **trabalha** (RH — tela *Equipe*, chave `pessoas.gerir`). A faxineira sem login tem ficha; o `Operador` do painel não tem nem uma nem outra. Juntá-las poria **salário e permissão na mesma tela**, com públicos diferentes — e é por isso que são duas tabelas e duas chaves.

**Invariantes:**
- **Uma ficha por `Usuário`, no máximo.** O vínculo é o que faz a meta automática saber de quem são os registros; duas fichas apontando para o mesmo login contariam o trabalho dela duas vezes. Índice único parcial, não um `if` no serviço.
- **`salario` atrás de `pessoas.gerir`, e o SERVIDOR apaga** (regra 17). É o único campo de `CAMPOS_MONETARIOS` cuja chave **não** é `valores`: dado de RH não se libera junto com receita, e quem tem `valores` para fechar o caixa não passa a ver o salário da colega. O nome da coluna é `salario` **de propósito** — a redação casa nome de chave, e `remuneracao` atravessaria inteiro em `GET /v1/auditoria`, que entrega o `de`/`para` de toda escrita.
- **Ler a ficha fica na trilha**, não só escrevê-la (`@DadoSensivel`): a pergunta que se faz depois é *"quem abriu o salário dela"*, e ninguém alterou nada.
- **Desativar é um estado** (`ativo` — "desmarque quando a pessoa sair da clínica"); excluir é soft delete. O histórico dela é mantido, como o MANUAL promete (cap. 13).
- **Nenhum número derivado é gravado:** tempo de casa, dias de férias restantes e contagem de alertas saem do cálculo, nunca de coluna.

### `Período aquisitivo`
Os **12 meses** de trabalho que dão direito a **30 dias** de férias, e os 12 meses seguintes são o prazo para concedê-las. Só existe em contrato **CLT**.

**Invariantes:**
- **Os períodos são contíguos e não se sobrepõem:** o período `k` termina no dia anterior ao início do `k+1`, e as bordas saem de `somarMeses` (regra 25) — escritas à mão, uma admissão em 29/02 produz um dia de buraco ou um dia contado duas vezes.
- **Só período COMPLETO aparece.** Enquanto `fim >= hoje`, ele não terminou e não há nada a conceder.
- **Os dias registrados abatem os períodos mais antigos primeiro** (FIFO). A soma dos abatimentos é **exatamente** `min(dias registrados, 30 × períodos)`, e nenhum período fica com `diasConcedidos` fora de `[0, 30]`. Property-based, como qualquer aritmética desta casa.
- **`concederAte` é o fim do período SEGUINTE**, e passar dele custa dinheiro de verdade: *"férias concedidas fora do prazo são pagas em dobro"* (CLT art. 137). É o alerta mais caro da tela.
- **Período de férias registrado não se sobrepõe a outro** da mesma ficha — aqui divergimos do protótipo, que apenas concatena. Dois registros sobrepostos inflam o total abatido, `diasRestantes` encolhe, e a clínica deixa de ser avisada da dívida que tem. Cobrado por `EXCLUDE` no banco, não por `if`.

### `Banco de horas`
O **saldo de horas do mês**, lançado pelo gestor como aparece no aplicativo oficial de ponto. A ferramenta **não registra ponto**: ela acompanha o saldo e avisa quando passa do limite (MANUAL cap. 13).

**Invariantes:**
- **Inteiro de MINUTOS, nunca hora decimal** (regra 8). O protótipo guarda `Math.round(x*100)/100` e formata com `Math.floor(a) + Math.round((a%1)*60)` — em `0,999 h` isso imprime `0h60`, que não é hora nenhuma. Minuto inteiro torna o caso impossível, e `lerSaldoDeHoras`/`formatarSaldoDeHoras` fazem a volta exata.
- **O campo é `saldoEmMinutos`, nunca `saldo`.** `saldo` está em `CAMPOS_MONETARIOS` por causa do saldo em aberto da paciente, e a redação casa **nome de chave** sem olhar o tipo — é o mesmo conserto de `saldo` → `saldoEmEstoque` no épico 6.
- **Um saldo por pessoa e por mês** (índice único parcial). O lançamento do mês é **corrigível** — é transcrição de outro sistema, não livro-razão —, e limpar o campo é soft delete, nunca `DELETE`.
- **O limite de alerta é dado da clínica** (`±10 h` por padrão), e vale para `CLT` e `Estágio` — os contratos que têm jornada.

### `Documento com validade`
ASO, registro profissional (COREN, CRM), treinamento, vacinação. **O valor dele é o alerta:** uma ficha com documento vencido que não avisa é um arquivo, não uma ferramenta. Aviso **30 dias** antes; vencido é `crítico`.

### `Alerta de pessoa`
Os quatro avisos da tela Equipe — **Férias**, **Experiência**, **Documento** e **Banco de horas** —, cada um com severidade (`atencao` ou `critico`), o dia a que se refere e o **prazo e a descrição da tarefa** que o botão *Gerar tarefa* cria.

**Invariantes:**
- **Calculado no SERVIDOR**, no fuso da clínica (regras 22 e 24). O protótipo usa `today()` do navegador: o celular adiantado da recepção antecipa um vencimento e atrasa outro.
- **Ficha inativa não alerta.** Quem saiu da clínica não tem férias a programar.
- **O prazo da tarefa é `max(hoje, em − 7 dias)`** — nunca nasce no passado, pela mesma razão do `Contato de retorno`.

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
| **Local de estoque** | Onde o item fica na clínica. A lista de contagem sai agrupada por ele |
| **Compensação** | O movimento que reverte outro, ligado a ele por `compensa_id`. Desfazer nunca é `DELETE` |
| **Contagem às cegas** | Contagem sem mostrar a quantidade esperada |
| **Curva ABC** | A classificação do estoque por valor: A até 80%, B até 95%, C o resto |
| **Tarefa de reposição** | A tarefa que nasce ao fechar a contagem, para o item abaixo do mínimo |
| **Nota de entrada** | A NF-e lançada no estoque. Idempotente pela chave de acesso |
| **Vínculo de nota** | `(CNPJ, código do produto) → (item, fator)`, aprendido na primeira nota |
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
| **Sessão de suporte** | A sessão do PRODUTO que carrega um `Operador` em vez de uma `Pessoa`. 30 min, revogável, com faixa permanente na tela |
| **Perfil de acesso** | Conjunto de permissões por pilar |
| **Pilar** | Dia a dia · Comercial · Financeiro · Processos · Pessoas · Gestão |
| **Ficha de pessoa** | O registro de RH de quem trabalha na clínica, com ou sem login |
| **Período aquisitivo** | Os 12 meses de CLT que dão 30 dias de férias, com 12 meses para conceder |
| **Banco de horas** | O saldo do mês em **minutos inteiros**, transcrito do app de ponto |
| **Alerta de pessoa** | Férias · Experiência · Documento · Banco de horas, com o prazo da tarefa |

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
