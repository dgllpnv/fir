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

**Um login só para a Firmare** (D-23 item 6, ADR 0024): todo operador tem uma `Conta de gestão do operador`, e entrar no painel abre também a carteira — `/superadmin` é a Visão geral. O operador continua sem perfil e sem dinheiro nas rotas do painel; o que ele vê da carteira, vê como aquele `Usuário de Gestão`.

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

## Carteira comercial da Firmare (integração com o Firmare Gestão)

**Estado: gate de risco concluído, 2026-11-05.** Modelado em `/grill-with-docs`
com o dono (duas rodadas), revisado por `arquiteto-dominio`, `arquiteto-solucao`,
`especialista-contas-assinatura`, `especialista-seguranca-appsec`,
`especialista-lgpd-saude`, `validador-numeros` e `product-rotina-clinica`. Ver
`docs/superpowers/plans/2026-11-05-plano-integracao-firmare-gestao.md` e as ADRs
0011, 0012, 0013.

### `Grupo`
Vínculo comercial **estável** entre a Firmare e um conjunto de `Clinica`s da mesma
rede, franquia ou grupo médico — fato de tenancy, não concessão. **Toda `Clinica`
tem `grupo_id NOT NULL`** e pertence a **exatamente um grupo por vez** (nunca dois
simultâneos — decidido no grilling: evita a ambiguidade de duas redes concorrentes
enxergando a mesma clínica). As 4 clínicas de hoje migram para um grupo **singleton**
com o próprio nome cada uma — nunca um grupo "Firmare" genérico compartilhado;
juntar clínicas no mesmo grupo é sempre uma ação comercial deliberada depois (venda
de rede), nunca o estado inicial. Mudar uma clínica de grupo é `UPDATE grupo_id`,
nunca duplica linha, e grava em `Histórico de grupo da clínica`.

**Criado e gerido só pelo superadmin (`Operador`).** Decidido no grilling: o
superadmin cria o grupo, cria/vincula clínicas a ele, e atribui o usuário
responsável — **nunca** um fluxo de convite de dentro do grupo. Isso fecha, num
único ponto de entrada, a exigência de concessão registrada da pendência P-12.

### `Histórico de grupo da clínica`
Append-only: de/para grupo, quando, por quem (`operador_id`), motivo. Responde
"quem tinha visão desta clínica" numa auditoria de LGPD — mesmo espírito de regra
20 (trilha append-only em escrita que afeta quem acessa dado de negócio).

### `Escopo`
Atributo do `Usuário de Gestão` (nunca uma linha de `Grupo`): `geral` (todas as
clínicas — é o superadmin/`Operador`, que já enxerga tudo por definição, sem
precisar de associação a um grupo "GERAL" fictício) ou `grupo` (só as clínicas
daquele `Grupo`). `CHECK (escopo = 'grupo') = (grupo_id IS NOT NULL)`.

### `Usuário de Gestão`
O ator da carteira comercial da Firmare — **nem `Operador`** (que é binário,
por-sessão, sem noção de "quais clínicas"), **nem `Pessoa`** (que pertence a uma
clínica). Vive em tabela própria (`usuarios_gestao`). **Renomeado de "Colaboradora
Firmare"** (nome provisório do primeiro rascunho) para o termo que o próprio dono
usa — regra do topo deste arquivo: nome no código = nome na UI = nome do dono.

**Invariantes, decididas no grilling:**
- **Vê o grupo para o qual foi criado** (`Escopo = grupo`) — nunca escolhe nem
  muda de grupo sozinho.
- **Tem visualização total do próprio grupo, mas NUNCA cria usuário algum** — nem
  `Pessoa` de clínica, nem outro `Usuário de Gestão`. Só o `Operador` cria e
  atribui. Isso é mais restritivo que o rascunho original do `arquiteto-solucao`
  (que previa o responsável do grupo convidando o resto da equipe) — o dono
  decidiu pela via mais simples e mais auditável.
- **A tela de criar/editar usuário é separada e explícita entre `Pessoa` (clínica)
  e `Usuário de Gestão` (carteira)** — nunca o mesmo formulário com um campo a
  mais. É requisito explícito do dono: evitar o superadmin confundir as duas
  audiências na mesma tela.

**Perfil do `Usuário de Gestão`** (G8 0.5, migration 0050). Concedido só pelo
`Operador`; decidido por `temPermCarteira` (`packages/domain/src/carteira.ts`),
a mesma função no servidor e na tela:
- **Telas** (`modulos`): as 9 do protótipo — Visão geral, Minhas tarefas,
  Carteira de clientes, FIR Clinic, Metas, Campanhas, Resumo semanal,
  Prospecção, Administração. Negação por padrão: rota sem tela concedida é 403.
- **Clientes que vê** (`carteira`): `minha` (só onde é a responsável, filtrado
  no servidor) · `todos`. Quem vê só a própria carteira não troca responsável.
- **`valores`**: vê e escreve dinheiro. Sem ele, todo campo monetário sai `null`
  e a escrita monetária é 403. **Mensalidades** exige `valores`.
- **`carteira.administrar`**: a chave da Diretoria (D-22 item 2) — arquivar,
  editar conteúdo e configuração, compartilhar todas as reuniões, redistribuir
  tarefas, encerrar cliente. **Nunca identidade.** Só para escopo `geral`.
- **Setor** (`setor`): diz quem recebe item de checklist. **Nunca autoriza.**
- **Diretoria (acesso total)**: não é papel gravado; é o conjunto completo
  dessas chaves, escrito por extenso.

### `Grupo Firmare`
O escopo `geral` **apresentado como grupo** (D-23 item 2): a própria Firmare,
que vê todas as clínicas sem vínculo. **Não é uma linha de `grupos`** — a
alternativa "grupo GERAL contendo todas as clínicas" segue rejeitada pela ADR
0011 (uma clínica, um grupo). Quem é do Grupo Firmare é o `Usuário de Gestão`
com `escopo = 'geral'`, e a tela chama esse escopo pelo nome do grupo.

### `Conta de gestão do operador`
O `Usuário de Gestão` que **todo `Operador` tem automaticamente** (D-23 item 6,
ADR 0024, migration 0061): Grupo Firmare, perfil Diretoria completo, **sem senha
própria**. Nasce com o operador (gatilho no banco, inclusive pelo break-glass da
VPS), acompanha o `ativo` e o nome dele, e não se edita — perfil, senha e estado
são recusados pelo banco. **Entrada única:** o login do painel abre também a
sessão desta conta (`__Host-fir-carteira`, mesma duração da sessão do painel), e
sair do painel encerra as duas. É por ela que o superadmin vê dinheiro — pela
rota da carteira; as rotas `/v1/superadmin/*` continuam sem dinheiro. Com o
segundo fator da carteira ligado, ela não abre (a entrada única não o contorna).
Nunca chame de "superadmin na carteira" nem de "conta do painel": o ator é o
`Usuário de Gestão`, e o vínculo diz de qual operador ele é.

### `Cliente Firmare`
O registro comercial de quem contrata a consultoria. Existe **antes** de haver
`Clinica` (funil de prospecção) e pode existir **sem nunca haver** uma — inclusive
`ativo` (D-22 item 4, migration 0047). Ligado por `clinica_id` anulável e único —
preenchido no dia do onboarding no FIR Clinic, **só pelo `Operador`**, e sempre no
grupo da clínica (o da linha mais recente de `historico_grupo_da_clinica`).

**Cadastro (G8 0.4).** Os campos de `F.cliente` do protótipo: **Decisor** (quem decide
do lado da cliente — não confundir com o **Responsável Firmare**, o `Usuário de
Gestão` que cuida da conta, do mesmo grupo), aniversário da decisora (dia e mês, nunca
o ano), telefone, e-mail, CNPJ, produto, área de foco, projeto ou turma, **pagador**
(quem paga, se não for a cliente — dado de terceiro), **reunião fixa** (dia da semana
ISO + hora, nunca o texto "terça 10h"), início e fim do ciclo, cliente desde, serviços
recebidos e observações. A seção **Pagamento** (mensalidade, dia do vencimento, WhatsApp
de cobrança) só existe para quem tem `valores`. **Saúde não é campo do cadastro** — é
derivada (`Saúde do cliente`, abaixo).

### `Parceiro do cliente`
Quem atende uma **frente** do `Cliente Firmare` (financeiro, comercial, tráfego pago,
marketing): nome, WhatsApp e link do formulário semanal daquela frente — só isso
(LGPD A29). Um por frente por cliente (`parceiros_do_cliente`). Dado de **terceiro**:
nunca entra na exportação da decisora, nunca é lido pelo portal, e sai quando é
substituído. Não confundir com `Usuário do portal` nem com o decisor.

### `Concessão de consultoria`
Acesso **individual e temporário** de um ator da Firmare ao dado **operacional**
de **uma** `Clinica` (dose, paciente, dinheiro granular) — prazo, motivo, revogável
pela clínica. **Decidido no grilling: fica fechado por enquanto.** Ninguém da
Firmare lê dado operacional de paciente hoje — só o agregado que `Grupo` entrega.
Reabre o dia em que alguém pedir isso de fato; não construir o desenho antes do
pedido real.

### `Campanha da carteira`
**Decidido na Rodada 2 do grilling:** "uma tela, duas fontes" — sincronizada
(job diário, nunca consulta ao vivo cruzando RLS) do `CampanhasModule` da
clínica quando há `clinica_id`; lançada à mão quando não há.

**Fechado pelo gate de risco (ADR 0013):** só `receita` sincroniza — é o único
campo que existe de verdade em `CampanhasModule` hoje, já em `Dinheiro`.
`investimento` e `receita_continuada` (do protótipo, calculados com aritmética
de ponto flutuante do legado) ficam fora até existirem como feature própria do
domínio FIR. Campanha com menos de 5 orçamentos pagos nunca aparece
individualizada — entra agrupada em "Outras campanhas" (risco de
reidentificação por N pequeno). Receita de grupo com mais de uma clínica é
**sempre** quebrada por clínica, soma sempre explícita — nunca um total
borrado sozinho (mesma regra 5, agora aplicada à carteira).

### `Criar clínica`, unificado
**Decidido na Rodada 2:** a criação de `Clinica` deixa de ser uma tela separada do
painel de identidade do superadmin — passa a viver na mesma tela de carteira que
cria `Grupo` e vincula clínica a grupo. **Fechado pelo gate (product-rotina-clinica):**
a migration que adiciona `grupo_id NOT NULL` em `Clinica` só é aplicada depois
do fim literal do épico 9 (corte das 4 clínicas + janela de v20 em paralelo
encerrada) — nunca no meio dele. O resto da fundação (`Grupo`, `usuarios_gestao`,
`Escopo`, lógica de permissão em `packages/domain`) não depende disso e pode ser
construído antes.

### RLS da carteira (ADR 0012)
`campanhas_carteira`, `uso_diario_cliente` e `clientes_carteira` têm `grupo_id`
como coluna própria (nunca leem `clinica_id` cruzado). Política `USING
(app_pode_ver_grupo(grupo_id))` — a decisão (`geral` vê tudo; `grupo` vê só o
próprio) mora **dentro da função**, nunca como `OR` na cláusula da policy
(`teste/isolamento-de-clinica.test.ts` já proíbe `OR` ali, por mutação viva —
mesma forma de `temPerm`, "uma função só"). `fir_carteira` nunca tem
`BYPASSRLS`; os dois jobs escrevem como `fir_app`, uma clínica de cada vez,
resolvendo `grupo_id` a partir de `clientes_carteira.clinica_id` — nunca
aceitando `grupo_id` nem `clinica_id` como parâmetro de requisição do
`Usuário de Gestão`.

### Prospecção e rotina interna (G5)

**Estado: implementado e ativo em produção** (`ProspeccaoCarteiraModule` fiado
em `carteira.module.ts`). ADR 0016
(emenda à ADR 0011 item 2: o `Usuário de Gestão`, dentro do próprio escopo,
cria e edita dado operacional da carteira — nunca `Grupo`/`Usuário de
Gestão`/`Cliente Firmare` do zero). Ver
`docs/superpowers/plans/g5-spec-rotina-interna-funil.md`.

- **`Lead comercial`** — um prospect do funil B2B (`leads_comerciais`), tabela
  PRÓPRIA de `Cliente Firmare` (a maioria não tem `grupo_id`; colapsar as duas
  recriaria o padrão "grupo sentinela" já recusado). Etapas:
  `novo → contato → reuniao → proposta → espera → ganho | perdido`. `ganho`
  cria uma linha nova em `clientes_carteira`, com `clinica_id NULL` e
  `status='onboarding'` — é por isso que `clientes_carteira.clinica_id` virou
  **nullable** (migration 0032), com `CHECK (status = 'onboarding' OR
  clinica_id IS NOT NULL)`. `perdido` exige motivo em texto livre, obrigatório
  no servidor. "Excluir" um lead na tela é **"Arquivar"** — nunca `DELETE`
  (regra 20/27); um lead já convertido nunca é arquivado.
- **`Interação do lead`** — histórico append-only de contato (`interacoes_do_lead`).
- **`Tarefa interna`/`Rotina interna`** — o análogo de `Tarefa`/`Marcador de
  rotina` para a equipe Firmare sobre a carteira, SEM a `Jornada` de nove
  etapas (três estados: `pendente`\|`concluida`\|`cancelada`). O
  `rotina_interna_id` é o `Marcador de rotina interna`, idempotente por
  `UNIQUE (rotina_interna_id, prazo, cliente_carteira_id)` nas tarefas vivas.
- **`Checkin interno`** — qualitativo nesta fatia (nota + `saude_cliente`),
  **sem** `meta_id`/`valor` (G3, fora de escopo). `Saúde do cliente` é sempre
  DERIVADA do checkin mais recente, nunca um campo em `clientes_carteira`.
  Editável só na semana ISO corrente — o endpoint de criação sempre grava a
  semana calculada pelo SERVIDOR (nunca aceita uma semana do cliente), e a
  edição por id recusa quando a semana do registro não é mais a corrente.
- **O achado crítico do ADR 0016 (item 2):** `grupo_id` e
  `responsavel_usuario_gestao_id` NUNCA vêm crus do corpo da requisição.
  `packages/domain/src/prospeccao.ts` (`resolverGrupoDeEscrita`,
  `validarResponsavelDoMesmoGrupo`) é a PRIMEIRA camada; a RLS por
  `app_pode_ver_grupo` é a segunda, nunca a única (regra 19). Testado por
  `apps/api/src/carteira/prospeccao/prospeccao-carteira.e2e.test.ts` —
  payload manipulado, consulta direta ao banco confirmando zero linhas.
- **Nenhuma tabela nova de G5 tem `clinica_id`** — todas auditam via
  `auditoria_do_painel`, por um trigger próprio (`registrar_auditoria_do_painel`,
  migration 0032) desde o primeiro commit da tabela, porque a varredura
  automática de `auditoria-inescapavel.test.ts` não as alcança sozinha (ela
  varre por `clinica_id`). `clientes_carteira` ganhou um trigger PRÓPRIO
  (`registrar_auditoria_carteira_cliente`) pela mesma razão, na outra direção:
  ela TEM `clinica_id`, mas ele agora pode ser `NULL`.

### O que nunca entra na carteira
`diagnosticos` e `transcricoes` do protótipo ficam fora de **todos** os épicos
(G1 a G6), por exclusão explícita (ADR 0013 §1) — podem conter fala de equipe
clínica mencionando paciente, dado de saúde por via indireta (art. 11).

### `Indicador da carteira`
Uma **métrica de negócio** definida para um `Cliente Firmare`: nome, unidade
(`"R$"` · `"un"` · `"%"`, conjunto fechado por enquanto) e direção de melhoria
(`maior_melhor`/`menor_melhor`). É a **definição**, nunca um valor — ex.:
"Faturamento semanal" (unidade R$), "Novos pacientes no mês" (unidade un).
Ver `docs/superpowers/plans/g3-spec-metas-e-lancamentos.md` §1 e ADR 0015.

**Não confundir com** indicador de desempenho interno de RH (não existe hoje).

### `Lançamento de indicador`
Uma **medição pontual** de um `Indicador da carteira`, datada por `referência`
(período — dia, semana), com `valor`, observação opcional e quem lançou
(`Usuário de Gestão`). **Idempotente por `(indicador_id, referência)`**:
relançar a mesma semana **corrige** o valor na mesma linha (nunca duplica), e
a correção vai para a auditoria (quem, quando, de → para) — o valor é visível
no portal do cliente (G6), que tem o direito de saber que mudou depois de
publicado.

**Falso cognato, explícito:** isto **não é** um lançamento financeiro, nem
`Recebimento`, nem `Conta a pagar`, nem a `Cobrança do Cliente Firmare` abaixo.
É um número que a equipe Firmare registra sobre o **negócio do cliente** — pode
nem ser dinheiro (ex.: contagem de pacientes). O protótipo da Firmare Gestão já
usa a palavra "lançamento" com este sentido (coleção `lancamentos`); o termo
novo cunhado por este épico é exatamente `Cobrança do Cliente Firmare`, para
não brigar pelo mesmo nome.

**Invariante de tipo:** se `unidade = "R$"`, o valor é `Dinheiro` (centavos,
`bigint`), nunca `number`/`NUMERIC`; se `unidade ∈ {"un","%"}`, é inteiro
simples (percentual em centésimos — regra 8 aplicada a percentual do mesmo
jeito que a quantidade). Duas colunas (`valor_centavos`, `valor_inteiro`),
`CHECK` garante que só a coerente com a unidade do indicador está preenchida
— a mesma disciplina se repete em `metas` (`valor_meta`, `valor_inicial`), não
só em `lancamentos_de_indicador`.

### `Meta comercial do cliente`
Um alvo posto por um `Usuário de Gestão` sobre **um** `Indicador da carteira`
de **um** `Cliente Firmare`: valor-alvo, sentido de melhora, prazo, status
(`em_andamento`/`concluída`). **O progresso é sempre derivado** do último
`Lançamento de indicador` da série (ou da fonte configurada) no momento da
leitura — nunca um campo `valor_atual` persistido e sincronizado à mão (o
protótipo faz isso hoje; aqui é a mesma classe de erro vetada para saldo de
estoque, regra 11, e para saldo em aberto, regra 5).

Sem nenhum lançamento ainda, mostra "Aguardando o primeiro lançamento"
(comportamento do protótipo, preservado).

### `Meta interna da carteira`
Um alvo da **própria equipe Firmare** sobre a carteira inteira ou sobre um
`Usuário de Gestão` (ex.: "fechar 3 Clientes Firmare novos este trimestre",
"manter churn abaixo de 5%"). Reaproveita a mesma estrutura de
`Indicador`/`Meta`/`Lançamento`, mas com `cliente_carteira_id` **nulo** e
escopo `geral` ou por `usuario_gestao_id`. Conceito novo, sem equivalente no
protótipo — entrega não obrigatória de G3.

**Não confundir com** `Meta comercial do cliente` (que é sobre um cliente, não
sobre a equipe Firmare). **Invariante:** soma de indicador `unidade="R$"`
entre clientes de grupos diferentes nunca aparece num card único — a lista de
clientes e valores vai ao lado da soma, e a soma é sempre recalculada sobre o
mesmo array de linhas devolvido, nunca uma segunda consulta (mesma regra 6 do
CLAUDE.md, já aplicada a `campanhas_carteira` por ADR 0013 §6).

### `Cobrança do Cliente Firmare`
O registro de **dinheiro real que a Firmare fatura de um `Cliente Firmare`**
numa competência (mês): um por `(cliente_carteira_id, competência)`, valor em
`Dinheiro` (centavos), vencimento, status (`aberto`/`pago`/`cancelado`),
quando foi pago. Gerado por job mensal idempotente (regra 26, mesmo padrão de
`uso_diario_cliente`, G4). Termo **cunhado deliberadamente** para não usar
"lançamento" aqui — ver o falso cognato acima.

**Invariantes:**
- **Snapshot no momento da geração:** `valor_centavos` é cópia da
  `Mensalidade` vigente **naquele instante**, nunca recalculado do valor
  atual depois — corrige um defeito real do protótipo (`painelMensalidades()`
  sempre lê o valor atual da mensalidade para desenhar qualquer mês passado,
  reescrevendo silenciosamente o histórico quando o valor muda).
- **Job idempotente por valor, não só por contagem de linhas:** `INSERT ...
  ON CONFLICT (cliente_carteira_id, competencia) DO NOTHING`, nunca `DO
  UPDATE` — rodar o job três vezes no mesmo dia, com a mensalidade alterada
  entre a 1ª e a 3ª execução, não muda o valor já gravado.
- **Marcar como paga é ação manual**, com registro de quem e quando (regra
  20) — não há conciliação bancária automática nesta fatia.
- **Visão de grupo nunca colapsa:** um `Usuário de Gestão` com `escopo=grupo`
  sobre um grupo com mais de um `Cliente Firmare` vê uma linha por cliente,
  nunca um total só (regra 6/ADR 0013 §6, agora sobre dinheiro de verdade).
- **Desativar um `Cliente Firmare` não apaga nem altera cobrança já gerada**
  — soft-state só muda o que acontece daqui para frente.
- **Redigida sem `valores`:** nenhuma resposta de API devolve
  `valor_centavos` (de `Cobrança`, de indicador `unidade="R$"`, de
  `Meta.valor_meta` monetário, ou de `Mensalidade`) para quem não tem a
  permissão `valores` — o ponto único de redação (regra 17) cobre as tabelas
  novas.
- **Arredondamento de `Benefício de indicação`:** decisão provisória de
  engenharia (ADR 0015, pendente de confirmação do dono) — o desconto
  arredonda **para cima** (nunca a favor de a Firmare cobrar mais que o
  percentual exato), por `percentual_centesimos` inteiro (nunca `number`
  perto de `Dinheiro`, regra 1). `desconto + cobrança = mensalidade cheia`,
  sempre, property-based.

### `Mensalidade`
O valor vigente, em `Dinheiro`, que um `Cliente Firmare` paga por competência
— propriedade do `Cliente Firmare` (`clientes_carteira.mensalidade_centavos`),
nunca de `Grupo` (decisão do dono). Mudar o valor afeta `Cobrança`s **futuras**;
as já geradas guardam o valor **da época** (ver invariante de snapshot acima).

### `Benefício de indicação`
Desconto aplicado a **uma** `Cobrança do Cliente Firmare` futura, concedido
por indicação de um lead convertido. Hoje, no protótipo, texto livre ("10% de
desconto na mensalidade seguinte"); aqui, `percentual_centesimos` (inteiro,
`bigint`, 0–10000, onde `1000` = 10,00%) — nunca `TEXT` com parsing depois, e
nunca `number` perto de `Dinheiro`. Consumir um benefício e criar a `Cobrança`
com desconto aplicado é **uma única transação**: o benefício é consumido **no
máximo uma vez**, mesmo com o job de geração rodando três vezes no mesmo dia.

---

### `Lead comercial`
Um prospect do funil de vendas B2B da Firmare — uma clínica ou médico ainda
sem contrato. Vive em `leads_comerciais`. **Nunca** é um `Cliente Firmare`:
tem campos que só fazem sentido antes do fechamento (`temperatura`, `origem`,
`próximo_contato`) e nenhum dos que só fazem sentido depois (`status` de
onboarding, `Mensalidade`). Nasce **sem `grupo_id`** na imensa maioria dos
casos (prospect avulso, sem grupo ainda); pode nascer já com `grupo_id` só
quando é expansão de uma rede já cliente. Ver
`docs/superpowers/plans/g5-spec-rotina-interna-funil.md` §1, §6.1 e ADR 0016.

**Por que não é a mesma linha que `Cliente Firmare`:** `clientes_carteira.
grupo_id` é `NOT NULL` desde a migration `0026`; tornar essa coluna nullable
destruiria a garantia que toda a RLS de G1-G4 assume, e inventar um grupo
"placeholder" para todo lead é exatamente o padrão "grupo GERAL"/"clínica
sentinela" já recusado por escrito (ADR 0011, migration `0002`). Mesma razão
estrutural que mantém `Pessoa` e `Ficha de pessoa` em tabelas separadas.

**Etapa do lead** (nunca uma `Jornada` de nove etapas — esse maquinário é do
agendamento clínico): `novo` → `contato` → `reuniao` → `proposta` → `espera`
(aguardando o prospect, não é regressão) → **`ganho`** (terminal) ou
**`perdido`** (terminal, motivo obrigatório no servidor). Passos livres, não
máquina de estados rígida.

**Invariantes:**
- **Conversão do lead:** só `ganho` cria uma linha **nova** em
  `clientes_carteira` (nunca reaproveita linha existente, regra 27) — mesma
  transação grava `etapa='ganho'`, `cliente_carteira_id` e `fechado_em`.
  Convertido, `clinica_id` nasce `NULL`, `status='onboarding'` (enum
  reaproveitado, sem quinto estado novo). Repetir a conversão não duplica
  (idempotência, regra 26).
- **Nunca há exclusão física** (regra 20/27), mesmo o protótipo fazendo
  `DELETE`. "Excluir" na tela é **arquivar** (`arquivado_em`, nunca remove a
  linha) — divergência deliberada do protótipo. Lead já convertido não pode
  ser arquivado nem reaberto para gerar um segundo `Cliente Firmare` (regra
  27: nunca se recria o que já existe).
- **Quem cria:** qualquer `Usuário de Gestão`, dentro do próprio escopo —
  emenda textual à ADR 0011 (ver ADR 0016 §1): "só o Operador cria" vale para
  `Grupo`/`Usuário de Gestão` (identidade/tenancy), nunca para dado
  operacional do dia a dia da carteira (`Lead comercial`, `Tarefa interna`,
  `Rotina interna`, `Checkin interno`, `Interação do lead`).
- **`grupo_id` nunca vem do corpo da requisição.** Para `escopo=grupo`, o
  servidor grava `app_grupo_id()` da sessão; um `grupo_id` de payload só é
  aceito quando idêntico ao da própria sessão, ou quando quem cria tem
  `escopo=geral` — qualquer outro valor é recusado **no servidor**, antes do
  `INSERT` (RLS é a segunda camada, regra 19, nunca a única).

### `Interação do lead`
Um registro **append-only** de contato com o prospect (canal, nota, por quem,
quando) — `interacoes_do_lead`. Nunca editável nem apagável; é o histórico que
justifica "por que perdemos esse".

### `Tarefa interna`
O item de rotina da **equipe Firmare** sobre a carteira — análogo, para
dentro, da `Tarefa` da FIR Clinic. Vive em `tarefas_internas`: responsável
(`Usuário de Gestão`), prazo, prioridade, status (`pendente`\|`concluida`\|
`cancelada`), e opcionalmente um `cliente_carteira_id` ou `lead_comercial_id`
ao qual se refere.

**Não confundir com** a `Tarefa` do domínio FIR: `Tarefa interna` **nunca**
anda por uma `Jornada` de nove etapas — esse maquinário existe para o
agendamento clínico (paciente faltando, confirmando, pagando), não para "ligar
para o cliente X". Só três estados, deliberadamente mais simples.

### `Rotina interna`
A definição recorrente que gera `Tarefa interna` sozinha — o análogo do
**`Marcador de rotina`** já existente no domínio FIR, generalizado para a
carteira. Vive em `rotinas_internas`: título, responsável padrão, frequência,
**`Escopo de aplicação`**, passos (checklist), `ativa`.

### `Marcador de rotina interna`
O mesmo mecanismo do `Marcador de rotina` do domínio FIR, reaproveitado: toda
`Tarefa interna` nascida de uma `Rotina interna` carrega `rotina_interna_id` +
`prazo`, com `UNIQUE (rotina_interna_id, prazo, cliente_carteira_id)` entre as
vivas (`cliente_carteira_id` nullable para rotina `global`) — é o que torna a
geração idempotente (rodar o job duas vezes não duplica a tarefa). Não é um
conceito novo; é o mesmo conceito, outra tabela.

### `Escopo de aplicação` (de uma `Rotina interna`)
`global` — a rotina gera **uma** tarefa, sem cliente associado (ex.: "revisar
backlog de leads da semana") — ou `por_cliente` — gera **uma tarefa por
`Cliente Firmare` ativo** visível no grupo do responsável (ex.: "ligar para
cliente que não loga há 10 dias").

**Não confundir com** `Escopo` do `Usuário de Gestão` (`geral`/`grupo`, já no
glossário acima) — são dois conceitos de "escopo" diferentes, um sobre quem
vê o quê, outro sobre como uma rotina se multiplica em tarefas.

### `Checkin interno`
O registro de que o ritual periódico de acompanhamento de um `Cliente
Firmare` aconteceu: quando, por quem, nota, e uma leitura pontual de
`Saúde do cliente`. Vive em `checkins_internos`, `UNIQUE (cliente_carteira_id,
semana)` — editável só até o fim daquela semana (mesma disciplina de "um
fechamento por dia" do `Caixa do dia`, aplicada à semana aqui).

**Divergência deliberada do protótipo, registrada em ADR 0016:** o protótipo
liga `checkin` a `meta_id` e `valor` (lançamento semanal de KPI). Aqui o
`Checkin interno` **não carrega valor numérico de meta** — é qualitativo, sem
`meta_id`. Isso evita modelar uma FK para uma tabela de G3 ainda não decidida,
e evita o `valor` nu do protótipo (às vezes R$, às vezes percentual, sem
unidade declarada — exatamente a ambiguidade que a regra de `valor` nu
proíbe). Fica pronto para G3 estender com `meta_id` nullable depois (coluna a
mais, não refação de tabela).

### `Saúde do cliente` (derivada)
O status qualitativo (`bom`\|`atencao`\|`critico`) de um `Cliente Firmare`,
lido do `Checkin interno` mais recente — **nunca um campo mutável** em
`clientes_carteira` que alguém edita direto na ficha (mesma forma de "derivado,
nunca campo", regra 11/5, aplicada aqui por analogia).

*Desde o G8 a saúde lê o registro mais recente entre o `Checkin interno` e a `Reunião comercial` (`saude_registrada`).*

### Termos do G8 (paridade com o protótipo do Firmare Gestão)

- **`Reunião comercial`** — a ata de uma reunião da Firmare com um `Cliente Firmare`: tipo, participantes, texto, saúde registrada, notas internas (nunca no portal). Nasce **não compartilhada**; compartilhar a põe no portal.
- **`Encaminhamento de reunião`** — cada linha de encaminhamento da ata; vira uma `Tarefa interna` uma vez só (ligação idempotente).
- **`Compartilhamento revertido`** — o evento, só de inserção, de tirar do portal uma ata que o cliente já leu; exige motivo.
- **`Material da biblioteca`** — material de método da Firmare, global (sem grupo). Escrever exige escopo geral.
- **`Envio de material`** — o fato, só de inserção, de ter mandado um material a um cliente.
- **`Ação do plano`** — passo do plano de ação ou ação comercial de um `Cliente Firmare`: título, tipo (plano|comercial), meta opcional, quem executa (clínica|Firmare), acompanhamento, prazo e status. **Não é `Tarefa interna`** e não vai ao portal; "Atrasada" é derivada.
- **Meta comercial — status:** `em_andamento`, `atingida`, `nao_atingida`, `cancelada` (`concluida` antigo lê-se `atingida`). Unidade nova do indicador: **`dias`** (menor é melhor).
- **`Checklist do programa`** (modelo, global) e **`Item do checklist`** (título, responsável, D+N). Aplicado a um cliente, vira o **`Checklist do contrato`**, cujos itens geram `Tarefa interna` uma vez só.
- **`Entrada de cliente`** — o fluxo de cadastrar um cliente novo, ou de trazer para a carteira quem já é da Firmare, e aplicar o checklist.
- **`Modelo de mensagem`** e **`Roteiro comercial`** — textos globais com variáveis `{…}`, montados no servidor. **`Envio de mensagem`** guarda só o fato do envio, **nunca o texto**, e só depois que a pessoa confirma "Você enviou?" (abrir o WhatsApp não é enviar).
- **`Não contatar`** — a oposição de um lead ou parceiro ao contato. Bloqueia montar a mensagem e o link do WhatsApp no servidor. A exclusão a pedido guarda só o HMAC do telefone (lista de supressão).
- **`Mensalidade` — situação:** `paga`, `sem_valor`, `vence_hoje`, `vencida`, `a_vencer`. Derivada, nunca campo.

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
