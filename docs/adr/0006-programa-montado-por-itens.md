# ADR 0006 — O programa é montado por itens, materializado em sessões, e o catálogo é imutável para quem já começou

**Data:** 2026-10-26 · **Situação:** aceita · **Épico:** 5

> **Numeração.** O plano do épico 5 anuncia `0005`; o épico 4 tomou aquele número para
> *"A recepcionista confere o caixa e recebe 'conferido', nunca a diferença"* enquanto este
> plano era escrito — exatamente a colisão que aquela ADR registra no próprio cabeçalho, uma
> geração antes. Número de ADR é sequencial, não reservado. Esta é a `0006`, e toda referência
> a "ADR 0005" dentro dos comentários do código do épico 5 aponta para cá.

---

## Contexto

Este é o primeiro épico do projeto em que **o protótipo e o `Code.gs` discordam com dado real
do lado do `Code.gs`**. Até aqui a arbitragem era fácil: o financeiro e a jornada **só existem
no protótipo**, então ele decidia sozinho (ADR 0004). Aqui as cinco ações — `salvarPlano`,
`excluirPlano`, `criarAdesao`, `encerrarAdesao`, `excluirAdesao` — **rodam hoje nas 4
clínicas**, com milhares de linhas gravadas, e a regra 28 reprova a clínica inteira por um
único programa divergente.

A discordância de fundo é de **forma do dado**:

| | O que tem |
|---|---|
| `Code.gs` v20 | uma adesão = **um** `planoId` + um bloco de sessões. Não existe `itens[]` |
| protótipo | uma adesão = **até 12 `itens[]`**, cada um com procedimento, sessões, intervalo, dose, início e `depoisDe` |

O caso que obriga os itens é clínico e corriqueiro: **a escalada de dose.** Tirzepatida 4× 2,5 mg
e depois 4× 5 mg é **um** tratamento que a paciente compra de uma vez, com **dois** insumos
diferentes e **dois** intervalos. Na v20 isso são duas adesões sem vínculo — e quem confere o
saldo da paciente vê duas dívidas onde existe uma negociação.

O invariante do qual tudo o mais decorre:

> **A sessão é uma `Tarefa` materializada, numerada dentro do seu item, e o programa é quem a
> criou.** O programa não recalcula a agenda a cada leitura: ele a **escreveu uma vez**, e só a
> move quando alguém pede.

É o invariante que, quebrado, **não produz erro nenhum**: produz uma agenda que escorrega, e a
enfermagem descobre quando a última aplicação cai em janeiro. O MANUAL da PO já o afirma em
português de balcão — *"Mudanças de sessões e intervalo valem para novas adesões; quem já está
no programa mantém as sessões programadas"* — e materializar é o que torna essa frase verdadeira
sem nenhuma linha de código a defendendo.

---

## Decisão

**Um `Programa` é montado por `Item do programa`, cada item materializa as suas `Sessão` como
`Tarefa` numerada dentro dele, e `programas` não guarda nenhum número derivado.**

Quatro camadas, e cada uma recusa o que as outras deixariam passar:

1. **O cronograma é domínio puro** (`packages/domain/src/programa.ts`): `ordenarItens` (DFS
   tricolor, que recusa ciclo), `datasDasSessoes`, `montarCronograma`, `reprogramar`,
   `situacaoDoPrograma`. Zero I/O, 35 testes, 5 por propriedade.
2. **O banco amarra a numeração** (migration `0010`): `CHECK sessao_e_do_programa` (ser sessão
   implica ter `programa_id`, `item_chave`, `sessao_indice` e `sessao_total`, com
   `indice BETWEEN 1 AND total`), `CHECK numeracao_so_em_sessao` (só sessão é numerada) e o
   índice único `sessao_unica_no_item (programa_id, item_chave, sessao_indice)`. Nenhum caminho
   futuro — job, migrador, `psql` às duas da manhã — grava duas sessões `5/12` no mesmo item.
3. **O catálogo não alcança quem já começou**: `itens_do_programa` guarda `procedimento_nome` e
   `rotulo_sessao` **no instante da montagem**, e há teste de que renomear "Tirzepatida" para
   "Tirzepatida 5 mg" não reescreve a história de ninguém.
4. **A montagem tem uma porta só**, o seam `MontadorDePrograma`, usado pelos **dois** caminhos:
   `POST /v1/programas` (nova adesão) e `fechar` um orçamento com programa. Ele recebe a
   **transação já aberta**, para que a atomicidade seja de quem chama — o `Recebimento`, o
   `Programa`, as sessões e a etapa acontecem juntos ou não acontecem.

---

## As quinze divergências, e o porquê de cada uma

| # | Ponto | Protótipo (`demoApiBase`) | `Code.gs` v20 | Segue | Por quê |
|---|---|---|---|---|---|
| 1 | **Programa por itens** | `itens[]` (até 12): `procId`, `sessoes`, `intervaloDias`, `inicio`, `depoisDe`, `insumoId`, `insumoQtd`, `dose`, `valor` | não existe: uma adesão = **um** `planoId` | **Protótipo** | O `Code.gs` é o caso degenerado de **um** item, então o modelo de itens o contém; o inverso não. A conversão *"adesão antiga = programa de um item `i1`"* acontece **uma vez, no migrador do épico 9** — no modelo relacional não existe programa sem itens, e por isso a conversão de *leitura* que o `CONTEXT.md` descrevia deixou de fazer sentido e o verbete foi corrigido. Mesmo movimento de `etapaDerivada` na ADR 0004: o migrador deriva, o runtime nunca |
| 2 | **Campos derivados na adesão** | guarda `plano` (nomes concatenados), `sessoes` (Σ), `intervaloDias` (do 1º item), `rotuloSessao`, `responsavelId`, `paciente` | guarda os mesmos, do plano único | **Nenhum dos dois** | São derivados dos itens, e campo derivado gravado é saldo mutável com outro nome (regra 5, pelo espírito). `programas` não tem nenhum deles. O migrador os **descarta e reconfere**: se o `sessoes` gravado na v20 não bater com a soma dos itens migrados, a clínica reprova |
| 3 | **Nome do procedimento na sessão** | lido do catálogo em tempo de leitura | gravado em `adesoes.plano` | **Nenhum dos dois** | `itens_do_programa.procedimento_nome` guarda o nome **no instante da montagem**. Ler do catálogo faria renomear um procedimento reescrever a história de quem já está em tratamento; gravar na adesão não permite agrupar. Guardamos os dois papéis separados: o **agrupamento** usa `procedimento_id`, a **leitura** usa o nome gravado. É a mesma lição do motivo de perda (ADR 0004) |
| 4 | **Limite de itens** | **12** em `criarAdesao`, **10** no `programaOrc` do `moverEtapa` | — | **Os dois** | Eles não se contradizem: 10 na *proposta*, 12 na *montagem*. A proposta é subconjunto da montagem, então nenhum caminho quebra. Harmonizar é alteração no contrato do épico 3 — está em `dividas.md` com gatilho |
| 5 | **`intervaloDias` máximo** | 180 no catálogo, **365** no item | 180 no catálogo | **Os dois** | 180 em `procedimentos` porque lá é **sugestão**; 365 em `itens_do_programa` porque lá é o caso real — um retorno anual de bioestimulador é um item de 365 dias |
| 6 | **`excluirPlano`** | recusa se alguma adesão usa (`planoId` **ou** `itens[].procId`); depois `splice` | recusa se alguma adesão usa; depois `deleteRow` | **Nenhum dos dois, em duas frentes** | (a) **Soft delete** (`excluido_em`), regra 20: o histórico e o contato de retorno dessas pacientes dependem do item apontar para um procedimento que ainda existe. (b) A recusa passa a alcançar também as **propostas vivas** (`tarefas.programa_orcado`), que nenhum dos dois confere — e que o épico 3 deixou como buraco aberto (D-J2). Sem ela, um orçamento de ontem ficaria apontando para um procedimento apagado, e descobriria no dia do fechamento |
| 7 | **`criarAdesao` · permissão** | **nenhuma**: qualquer pessoa logada monta um programa e lança o pagamento | **nenhuma** | **Divergência consciente** | `@Exige('programas')` na rota, e `receber` **cobrado no serviço** quando o corpo traz dinheiro. A enfermagem tem `programas` e não tem `receber`: ela monta o programa, e o pagamento vai pela tela Recebimentos. A rota que cria dinheiro é gated, sem exceção — é a mesma decisão D-7 do épico 3 |
| 8 | **`encerrarAdesao` / `excluirAdesao` · permissão** | `programas.gerir` | `me.admin` | **Protótipo** | Não é discordância: é a matriz substituindo o booleano `admin`, que o `CONTEXT.md` proíbe como termo e como modelo |
| 9 | **`excluirAdesao` · estoque** | **apaga** os movimentos (`movs.filter(m => !removidos.includes(m.id))`) | não tem estoque | **Nenhum dos dois** | Regra 12: movimento é append-only, e desfazer é compensação ligada por `tarefaId`. O seam `BaixaDeInsumos.desfazer` existe por causa desta linha. Apagar o movimento faria a prateleira e a trilha contarem histórias diferentes, e a análise do épico 6 acusaria uma perda que ninguém teve |
| 10 | **`excluirAdesao` · sessões pagas** | apaga **todas** as sessões, inclusive realizadas, e desvincula orçamento e recebimentos | o mesmo | **Nenhum dos dois** → **D-8** | O épico 2 já recusa excluir tarefa com recebimento (*"Reabra a tarefa"*), e duas respostas para a mesma pergunta é como uma delas vira a errada. `DELETE /v1/programas/:id` **recusa com 409** quando alguma sessão tem recebimento vivo, com as duas saídas na mensagem. **Diverge do MANUAL** (cap. 8), e foi o dono quem escolheu: estorno em cascata deixaria alguém mudar a receita de um mês fechado com um toque |
| 11 | **Reprogramação em cascata** | reprograma as próximas **daquele item** e **empurra os itens que começam depois dele**, só quando o dependente ainda não começou | reprograma as próximas da adesão inteira | **Protótipo** | O `Code.gs` é o caso de um item, e a regra coincide nele. Empurrar um item que **já tem sessão concluída** reescreveria o passado da paciente — medido no protótipo rodando: i2 com 1/3 concluída ficou intacta |
| 12 | **Reprogramar é escolha, não padrão** | `b.reprogramar`, a tela pergunta | `b.reprogramar`, idem | **Os dois** | Virou campo **obrigatório** no corpo de concluir sessão (sem `.default()`). Um padrão silencioso aqui move a agenda de doze aplicações sem ninguém ter pedido, e o movimento só aparece na semana seguinte |
| 13 | **Contato de retorno** | **um por item** (`itemKey`), quando não restam sessões abertas **daquele item** e não há retorno vivo dele | **um por adesão** | **Protótipo** | Para o dado migrado (um item `i1`) as duas regras produzem **o mesmo resultado**, e é isso que a conferência do épico 9 vai cobrar. Para o programa de itens, um retorno por adesão chamaria a paciente de volta pelo item errado |
| 14 | **`cancelarRetornos`** | cancela retornos abertos do mesmo **paciente + procedimento**, com `obs: 'Paciente refez o procedimento'` | o mesmo, casando pelo `planoId` da adesão | **Os dois concordam** | Sem isso, a paciente que acabou de aderir de novo continua recebendo a ligação de *"você já pode repetir"*, agendada no ciclo anterior. A frase é copiada literalmente — ela é o que a recepção lê no cartão |
| 15 | **Prazo do retorno nunca é passado** | `if (prazo < hoje) prazo = hoje` | o mesmo | **Os dois, com uma correção** | `hoje` é o do **servidor**, no fuso da clínica (regra 24); o protótipo usa `today()` do navegador. Sem o clamp, um retorno de 4 meses calculado a partir de uma sessão antiga nasceria *"atrasado há cinco meses"*, e a lista de hoje abriria com um cartão vermelho que ninguém atrasou |

Mais três pontos em que **os dois legados concordam e nós também**, listados porque a concordância
é o que o teste prova:

- **`modo` da adesão:** `saldo` quando a adesão abriu valor em aberto, `avulso` quando não. Virou
  `programas.modo_de_cobranca`, e o nome entrou no `CONTEXT.md`.
- **Pagamento da adesão:** os dois gravam valor e saldo **na própria tarefa**; aqui é **uma linha
  de `recebimentos`** presa à tarefa companheira pelo índice único do épico 2 (regra 3), em
  centavos, com `total.menos(entrada)`. O `Math.round((total - ent) * 100) / 100` do `Code.gs`
  não atravessa.
- **Sessão de programa concluída não conta na jornada:** `ehEsteira` do protótipo exclui
  `Sessão de plano`, e `TIPOS_REALIZADOS` do épico 2 já a excluía com o comentário certo. Contá-la
  faria **doze aplicações de uma paciente virarem doze atendimentos** no denominador da conversão.
  Este épico só escreveu o teste que o prova.

E um ponto em que **nenhum dos dois faz nada**: **ciclo em `depoisDe`.** No protótipo
`i1 depoisDe i2` com `i2 depoisDe i1` passa pela validação e a fila do `while` simplesmente nunca
produz data — o programa é criado sem sessão nenhuma, em silêncio. O `superRefine` do épico 3
cobre chave repetida e `depoisDe` órfão, não ciclo. `ordenarItens` detecta e recusa, nomeando o
item.

---

## As quatro decisões que a implementação tomou, e que a tabela não previa

### 1. D-9 implicou uma divergência do protótipo na lista de recebimentos do dia

A D-9 (*programa sem entrada abre saldo*) criou uma segunda espécie de linha em `recebimentos`:
`valor = 0`, `valor_aberto > 0`, forma vazia — a **venda a prazo**. A condição sem a qual a decisão
não vale é que essa linha **não apareça** no caixa do dia, na lista de recebimentos do dia nem no
LTV. Medido no protótipo rodando, em 2026-10-26:

| Lugar | Protótipo | Aqui |
|---|---|---|
| caixa do dia | `Number(t.valor) > 0 && t.formaPagamento` — **exclui**, com as duas metades | exclui |
| lista do dia | `ehReceb` dá `true` por `ehPagamento(tipo)` **antes de olhar o valor** — **vaza** | exclui |
| LTV | `pagamentos` conta só `valor > 0` — exclui | exclui |

A linha do meio é **divergência consciente**: no protótipo a seção "Recebimentos de hoje" ganha
uma linha de **R$ 0,00 sem forma de pagamento**, e o contador do cabeçalho a soma. Não é decisão
dele — é o mesmo descuido que a tabela acima mostra ele acertando duas linhas acima e abaixo. E o
ruído custa: a recepção abre o dia com um recebimento que não existe e um contador que não bate
com a gaveta.

O filtro mora num lugar só (`DINHEIRO_QUE_ENTROU`, em `apps/api/src/financeiro/`), usado por
**quatro** consultas, pela mesma razão da regra 17: o quarto lugar não é revisado com o cuidado do
primeiro, e o quinto nasce sem o filtro.

### 2. A constraint `recebimento_forma_so_com_dinheiro` — forma vazia ⟺ valor zero

`CHECK ((valor > 0) = (forma <> ''))`, na migration `0011`. O protótipo grava
`formaPagamento: ""` quando não houve entrada, pela mesma razão; aqui **o banco cobra**.

A bicondicional, e não só uma das metades: "Pix" num recebimento de R$ 0,00 apareceria como um Pix
que ninguém fez no primeiro lugar que parasse de filtrar por valor. E um recebimento de R$ 500
**sem** forma não teria onde entrar na conferência do caixa — ele sumiria do esperado e viraria
sobra na gaveta.

A mesma migration precisou de `CHECK (valor >= 0)` explícito: o `valor > 0` original carregava a
não-negatividade **de graça**, e `valor > 0 OR valor_aberto > 0` sozinho aceitaria
`(valor = −500, valor_aberto = 1000)` — um recebimento negativo que subtrai da receita do dia sem
passar por estorno, que é precisamente o caminho que a regra 20 fecha.

### 3. `HojeController` mudou de módulo, e `HojeModule` nasceu

Até aqui o controlador da tela Hoje morava em `TarefasModule`, porque compunha **duas** leituras:
as tarefas e o bloco financeiro (`tarefas → financeiro`, mão única). Este épico acrescentou a
terceira — as sessões de programas — e `ProgramasModule` **importa** `TarefasModule`. Deixar o
controlador onde estava exigiria `tarefas → programas → tarefas`.

**Alternativa rejeitada: `forwardRef`.** É a saída de uma linha, e é onde a ordem de inicialização
do Nest vira defeito intermitente — o tipo de falha que aparece em produção, uma vez, e não se
reproduz na máquina de quem a investiga.

Com módulo próprio o grafo volta a ser acíclico, e a casa fica mais honesta que antes: **Hoje não
é uma tela de tarefas.** É a composição de três leituras de três módulos, e nenhum deles a possui.
É a mesma razão pela qual a sessão ganhou rota própria (P-5 do plano): quando uma coisa passa a
depender de três, ela deixa de pertencer a uma.

### 4. A exclusão distingue o que o programa CRIOU do que existia antes

`DELETE /v1/programas/:id` não trata todas as tarefas do programa igual:

| O que é | O que acontece | Por quê |
|---|---|---|
| **Sessões** e **contatos de retorno** | soft delete (`excluida_em`) | O programa os escreveu; sem ele não têm sentido |
| **Pagamento da adesão**, **cartão de orçamento**, o que mais estiver ligado | **desvinculado e preservado** (`programa_id = NULL`, `item_chave = NULL`) | Existiam antes, ou valem por si |
| **Recebimentos** | `programa_id = NULL` — o dinheiro fica, volta ao grupo geral do saldo | Um recebimento apontando para um programa excluído cairia num grupo que a tela não desenha, e a dívida ficaria invisível |
| **Tarefa de origem** (o orçamento) | intocada | `fechado` é terminal (ADR 0004). Reabri-la mudaria a receita de um mês que já fechou |

O protótipo faz **a mesma distinção** — `ids = tasks.filter(ehSessao)` para apagar,
`t.adesaoId = ''` para o resto — e a razão é o dinheiro: apagar a tarefa do pagamento da adesão
esconderia da ficha da paciente um recebimento que **continua contando receita**. O que divergimos
dele é a forma (soft delete, não `splice`) e o estoque (compensação, não `DELETE` de movimento).

---

## Consequências

**O que ganhamos.** A escalada de dose é **um** programa, com **um** saldo e **um** total
negociado — e a conferência da paciente deixa de mostrar duas dívidas onde existe uma negociação.
Editar o catálogo é seguro por construção, não por disciplina: não existe caminho de leitura que
alcance quem já começou. A reprogramação em cascata tem uma implementação só, pura, provada por
propriedade (inclusive a idempotência: reprogramar de novo sem nova conclusão não muda nada). E a
dívida D-J1 do épico 3 está paga — `fechar` com programa monta o programa na **mesma transação** do
recebimento e da etapa, e o `MontadorIndisponivel` que devolvia 501 foi **apagado**, não deixado
para trás.

**O que custa.** Quatro tabelas novas, e a leitura de `GET /v1/programas` compõe quatro blocos
sobre a tabela mais quente do sistema. O índice `sessoes_abertas` é parcial e cresce com o que está
**pendente**, não com o histórico — mas derivar a situação de cada programa exige **todas** as
sessões dele, e isso cresce com programas × sessões. Medido no épico; se não bastar numa clínica
com três anos de dado, a saída é agregar no SQL, e aí o cronograma passa a ter uma segunda
implementação — exatamente o que este projeto existe para não repetir.

**O que fica aberto.** `BaixaDeInsumos` está **inerte** até o épico 6: nenhuma sessão dá baixa, e
os três invariantes que o épico 6 terá de honrar estão escritos com teste contra uma implementação
de referência. `procedimentos.insumo_padrao_id` e `itens_do_programa.insumo_id` **não têm FK**,
porque `itens_de_estoque` não existe. A campanha do programa é aceita no contrato e ignorada. Tudo
em `dividas.md`, com gatilho.

**A tensão que fica registrada em vez de resolvida.** Esta ADR diverge do **MANUAL da PO** em um
ponto (a exclusão do programa com sessão paga, D-8), e o MANUAL é documentação funcional que a
clínica vai ler. Quem escrever o capítulo 8 do manual novo precisa reescrever a frase *"apaga a
adesão e todas as sessões, inclusive as realizadas"* — senão a ferramenta recusa o que o manual
promete, e a recepção acha que é defeito.

---

## Alternativas rejeitadas

**Sessões derivadas de `(início, n, intervalo)`, em vez de materializadas.** É o desenho mais
enxuto, e falha em quatro frentes. (a) **Uma sessão é um item de agenda de uma pessoa:** tem
responsável, prazo, hora, observação, pode ser cancelada sozinha, concluída retroativa e carregar
o pagamento embutido — nada disso cabe numa série derivada. (b) **Reprogramar é o caso normal**,
não a exceção: a série derivada precisaria de uma tabela de exceções, que é a série materializada
com outro nome e mais um lugar para divergir. (c) **O épico 2 já materializa** a série recorrente
(`serie_id`), e duas formas de "N tarefas iguais" no mesmo sistema é dívida nascendo. (d) **Há
dado real:** as 4 clínicas têm linhas de `Tarefas` com `adesaoId` e `sessao = "5/12"`, já
reprogramadas e canceladas à mão. Derivar obrigaria o migrador a **inventar** um mapeamento de
volta para parâmetros que o dado não tem — e a regra 28 reprova a clínica inteira por uma paciente
divergente.

**Guardar `sessoes`, `saldo`, `recebido`, `valor_total` ou o nome do programa em `programas`.**
O legado guarda os cinco. Cada um deles cria **um segundo número para a mesma pergunta**, e o
segundo é o que fica errado: o nome sai da concatenação dos `procedimento_nome` dos itens; o total
sai da soma de `itens_do_programa.valor`; o recebido e o saldo saem de `recebimentos`, pelo
`saldoEmAberto` do épico 4 (regra 5). É a regra 11 do estoque aplicada a dinheiro — saldo é
derivado, nunca campo.

**Ratear o valor negociado no nível da SESSÃO.** O que a clínica negocia é *"R$ 3.600 pelo
programa"*. O que ela precisa ver é quanto cada **item** vale, porque é por item que ela encerra,
troca ou desconta. Ratear até a sessão criaria um número por linha de agenda que ninguém confere e
que o legado nunca teve — e multiplicaria por doze as oportunidades de um centavo sumir.
`Σ itens.valor = valorTotal`, **exatamente**, e é esta igualdade que o rateio prova por
propriedade. O rateio é **proporcional ao valor de referência × sessões** (Tirzepatida a R$ 300 e
drenagem a R$ 150 não dividem o desconto meio a meio), com o resto nas partes de maior resto — e
a propriedade *"pesos iguais ⇒ idêntico ao `Dinheiro.ratear` que já existe"* é o que impede o
sistema de ter **duas** regras de rateio de dinheiro, que é precisamente como um centavo some
entre duas telas.

**Estorno em cascata na exclusão do programa, como o MANUAL manda.** É menos atrito no balcão.
E deixaria uma pessoa com permissão de excluir **alterar a receita de um mês já fechado com um
toque**: a trilha registraria, mas o dinheiro já teria saído do relatório, e quem confere o mês
descobriria depois. Foi oferecida ao dono e **recusada** — D-8 em `docs/decisoes.md`,
2026-10-25. O que torna a recusa barata é que *encerrar* já faz o que a clínica quer na prática —
o programa sai da lista ativa e para de gerar sessão — e *excluir* existe para cadastro errado,
que por definição ainda não tem pagamento.

**`forwardRef` para resolver o ciclo da tela Hoje.** Ver a decisão 3 acima.

**Reagir ao catálogo editado, propagando para quem está em tratamento.** Ninguém propôs, e vale
registrar por quê: é o comportamento que uma leitura ingênua do catálogo produz **sem querer** —
basta ler `procedimentos.sessoes_sugeridas` na hora de desenhar a agenda. O MANUAL diz o contrário
em uma frase, e a frase não se sustenta sozinha: ela precisa de `procedimento_nome` e
`rotulo_sessao` copiados no item, de sessões materializadas, e de um teste que renomeie o
procedimento e confira a ficha de quem já começou. Esses três existem.
