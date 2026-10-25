# Épico 5 — Programas · plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`. Passos com `- [ ]`.

**Objetivo:** o catálogo de `Procedimento`s da clínica, o `Programa` montado por paciente, as **sessões materializadas** na agenda da enfermagem, a reprogramação em cascata, o contato de retorno ao fim de cada item — e a **dívida que o épico 3 deixou**: `fechar` um orçamento com programa deixa de devolver 501 e passa a montar o programa, na mesma transação do recebimento e da etapa.

**O invariante que define este épico:**

> **A sessão é uma `Tarefa` materializada, numerada dentro do seu item, e o programa é quem a criou.** O programa não recalcula a agenda a cada leitura: ele a **escreveu uma vez** e só a move quando alguém pede. Uma sessão cancelada continua existindo; uma sessão reprogramada não vira outra.

Se as sessões fossem derivadas do `Procedimento`, editar "12 sessões" para "8" no catálogo mudaria, em silêncio, a agenda de todas as pacientes que já estão em tratamento — e o MANUAL diz exatamente o contrário: *"Mudanças de sessões e intervalo valem para novas adesões; quem já está no programa mantém as sessões programadas."* Materializar é o que torna essa frase verdadeira sem nenhum código a defendendo.

**Arquitetura:** três tarefas de domínio puro antes de qualquer rota — o **cronograma** (datas, encadeamento entre itens, reprogramação), o **rateio** do valor negociado entre os itens, e o **contato de retorno** (aritmética de mês, regra 25). Depois a migration, os contratos, e duas costuras declaradas: `MontadorDePrograma` (que o épico 3 declarou e não escreveu) e `BaixaDeInsumos` (que este épico declara e deixa **inerte** para o épico 6 plugar).

**Stack:** PostgreSQL + migration `0009`, NestJS + Fastify, Next.js (App Router), Vitest contra Postgres real, fast-check no domínio.

**Depende de:** o **épico 2** inteiro (`tarefas`, `pacientes`, `recebimentos`, `instanteDaConclusao`, `ConclusaoService`), o **épico 3** inteiro (`programa_orcado`, a máquina de estados, `MoverEtapa`), e o **épico 4** para `saldoEmAberto` e `recebimentos.requisicao_id`. Usa `Dinheiro`, `Quantidade`, `somarDias`, `somarMeses`, `diaCivil`, `janela`, `temPerm`, `TIPO_SESSAO`, `TIPO_RETORNO`, `ehSessao` — **todos já existem**. Confira antes de escrever qualquer coisa nova.

**Cobre de `docs/paridade.md`:** `salvarPlano` · `excluirPlano` · `criarAdesao` · `encerrarAdesao` · `excluirAdesao`. **5 das 59** — e, ao contrário do financeiro e da jornada, **as cinco rodam hoje nas 4 clínicas**. Há dado real para migrar, e a regra 28 cobra compatibilidade exata.

---

## Global Constraints

Valem para **todas** as tarefas. Herdadas do `CLAUDE.md`, do `CONTEXT.md`, de `docs/design.md` e dos planos dos épicos 2, 3 e 4.

- **Regra 1:** nenhum `float` perto de dinheiro. `bigint` de centavos no banco, `Dinheiro` no domínio, string de centavos no transporte e dentro de `jsonb` (D-4 do épico 3). Nada de `toFixed`, `parseFloat` ou `* 100`. O `Code.gs` faz `Math.round((total - ent) * 100) / 100` ao montar a adesão — **essa linha não atravessa**; aqui é `total.menos(entrada)`.
- **Regras 8, 9 e 10:** **nenhum `float` perto de quantidade, e nenhum número de conversão dentro de função.** A dose do insumo é `Quantidade` (milésimos inteiros) **com a unidade junto**, sempre — `insumo_qtd_milesimos` nunca viaja nem é gravada sem `insumo_unidade` ao lado. O `Math.round(Number(x.qtd)*1000)/1000` do protótipo é a assinatura que a regra 8 proíbe. As conversões `unidCompra → medida → unidUso` são do épico 6 e vivem no cadastro do item; **este épico não converte nada** — ele guarda a dose na unidade em que ela foi declarada.
- **Regra 3:** cada pagamento conta uma vez. O pagamento da adesão é **uma linha de `recebimentos`** presa à tarefa companheira pelo índice único do épico 2. **Nenhuma coluna de dinheiro nasce em `tarefas` nem em `programas`.**
- **Regra 4:** orçamento não é receita. `valor_orcamento` continua fora de tudo. O `itens_do_programa.valor` é **preço negociado**, não recebimento: ele não entra em receita, LTV nem meta.
- **Regra 5:** saldo em aberto é **derivado**, agrupado por programa. Este épico **preenche `recebimentos.programa_id`** — e é só isso que falta para o agrupamento do épico 4 deixar de ser um grupo só. **Nenhuma coluna `saldo` nasce em `programas`.**
- **Regra 12 (antecipada):** movimento de estoque é append-only; desfazer é movimento compensatório ligado por `tarefaId`. Este épico **não escreve movimento nenhum** — ele chama o seam. Mas ele já escreve o teste que o épico 6 terá de passar.
- **Regra 16:** o servidor **sempre** valida. `@Exige('programas')` na leitura e na montagem; `@Exige('programas.gerir')` em encerrar e excluir; `@Exige('config')` no catálogo.
- **Regra 17:** a redação é o `RedacaoInterceptor`, num ponto único. Nenhuma rota deste plano escreve um `if` sobre dinheiro. `valorDoItem`, `valorTotal`, `recebido`, `saldo` e `valorPorSessao` entram em `CAMPOS_MONETARIOS`; a equipe sem `valores` recebe `temSaldo: boolean` e nada mais.
- **Regra 18:** **dose, insumo e procedimento por paciente são dado de saúde.** `GET /v1/programas/:id` leva `@DadoSensivel('paciente')` — registro de **acesso**, não só de escrita. E `dose`, `insumo` e nome de procedimento **nunca** vão para log (regra 21), em nenhum nível.
- **Regra 19:** RLS `ENABLE` + `FORCE` + policy nas quatro tabelas novas, `clinica_id NOT NULL`, e as quatro entram em `ENTIDADES_COM_CLINICA`.
- **Regra 20:** soft delete e trilha append-only. **O trigger `registrar_auditoria` faz o registro sozinho** — ninguém chama `registrar()` à mão. Encerrar é estado; excluir é `excluido_em`.
- **Regra 22/23/24/25:** `timestamptz` em UTC; janela `[início, fim)` com bordas no fuso da clínica; **a data de negócio vem do servidor**; recorrência mensal em 29/30/31 cai no último dia do mês curto — e é o `somarMeses` que já existe quem resolve, no contato de retorno.
- **Regra 28:** **há dado real nas 4 clínicas.** Toda decisão de esquema deste épico é também uma decisão de migração, e cada divergência contra o `Code.gs` vira linha na tabela abaixo, nunca um ajuste silencioso.
- **Telas:** `docs/design.md` é a régua. 390 px é o caso principal, a página nunca rola na horizontal. Algarismos tabulares em toda coluna de valor, quantidade, data ou percentual. Estados de carregando, erro e vazio são parte do ticket.
- TypeScript estrito; imports **sem** extensão (ADR 0001); `@Inject(Tipo)` explícito no Nest.
- Nenhuma migration já aplicada se edita. **Esta é a `0009`** — supondo que o épico 4 ocupe a `0008`. O plano do épico 4 ainda diz `0007_financeiro.sql`, número que a jornada já tomou; **o Passo 1 da Task 4 manda rodar `ls apps/api/migrations/` e usar o próximo livre**, corrigindo aquele plano se preciso.
- Antes de qualquer "pronto": `npx turbo run typecheck test --force`. O `pnpm test` responde do cache sem rodar nada.

---

## O vocabulário, e ele é armadilha

O legado tem **três nomes para duas coisas**, e os dois significados moram em telas diferentes:

| Legado | Aqui | O que é |
|---|---|---|
| aba `Planos`, `planoId`, "plano" | **`Procedimento`** | o **catálogo** da clínica: Tirzepatida, 12 aplicações sugeridas, a cada 7 dias, insumo e dose padrão, regra de retorno |
| aba `Adesoes`, `adesaoId`, "adesão" | **`Programa`** | o tratamento **de uma paciente**, montado por `Item do programa` |
| `itens[]`, `itemKey` | **`Item do programa`** | um procedimento dentro do programa, com sessões, intervalo, dose e início |
| `sessao: "5/12"` | **`Sessão`** | uma `Tarefa` de tipo `Sessão de plano`, numerada **dentro do seu item** |
| `modo: 'saldo' \| 'avulso'` | **`Modo de cobrança`** | `saldo` quando a adesão abriu valor em aberto; `avulso` quando cada sessão registra o que foi pago no dia |
| `retorno`, `antecedencia` | **`Contato de retorno`** | a tarefa criada sozinha quando o último item termina, para a paciente repetir o procedimento |

**Nunca escreva "plano" nem "adesão" sozinhos.** O nome do *tipo de tarefa* continua `'Sessão de plano'` — e **isso é deliberado**: é a string que está gravada em milhares de linhas nas 4 clínicas, `TIPO_SESSAO` já a carrega em `packages/domain/src/tipos-de-tarefa.ts`, e renomeá-la obrigaria o migrador a reescrever dado para ganhar nada. O rótulo que a recepção lê sai de `itens_do_programa.rotulo_sessao` ("Aplicação 5/12"), nunca do nome do tipo.

**Termos novos que entram no `CONTEXT.md` antes de virar código** (Task 14, mas leia-os agora): `Item do programa` (já existe no glossário rápido, ganha invariantes), `Modo de cobrança`, `Contato de retorno`, `Sessão`.

---

## As divergências, e quem ganha

O protótipo é a especificação; o `Code.gs` é a verdade operacional das 4 clínicas. **Aqui os dois existem**, e é a primeira vez neste projeto que a discordância tem dado real do lado do `Code.gs`. Cada linha é uma decisão de migração.

| Ponto | Protótipo (`demoApiBase`) | `Code.gs` v20 | Segue |
|---|---|---|---|
| **Programa por itens** | `itens[]` (até 12): `procId`, `sessoes`, `intervaloDias`, `inicio`, `depoisDe`, `insumoId`, `insumoQtd`, `dose`, `valor` | **não existe.** Uma adesão = **um** `planoId` e um bloco de sessões | **Protótipo.** O `Code.gs` é o caso degenerado de um item. A conversão "adesão antiga = programa de um item `i1`" acontece **uma vez, no migrador do épico 9** — no modelo relacional não existe programa sem itens, então a conversão de *leitura* do `CONTEXT.md` deixa de fazer sentido e o verbete é corrigido na Task 14. Mesmo movimento de `etapaDerivada` no épico 3: o migrador deriva, o runtime nunca |
| **Campos derivados na adesão** | guarda `plano` (nomes concatenados), `sessoes` (Σ), `intervaloDias` (do 1º item), `rotuloSessao`, `responsavelId`, `paciente` | guarda os mesmos, do plano único | **Nenhum dos dois.** São derivados dos itens, e campo derivado gravado é saldo mutável com outro nome (regra 5, pelo espírito). `programas` não tem nenhum deles. O migrador os **descarta e reconfere**: se o `sessoes` gravado não bater com a soma dos itens migrados, a clínica reprova |
| **Nome do procedimento na sessão** | lido do catálogo em tempo de leitura | gravado em `adesoes.plano` | **Nenhum dos dois, e a lição é do épico 3 (D-2).** `itens_do_programa.procedimento_nome` guarda o nome **no instante da montagem**; renomear "Tirzepatida" para "Tirzepatida 5 mg" **não reescreve a história** de quem já está em tratamento. O agrupamento usa o `procedimento_id`; a leitura usa o nome gravado |
| **Limite de itens** | **12** em `criarAdesao`, **10** no `programaOrc` do `moverEtapa` | — | **Os dois, e eles não se contradizem:** 10 na *proposta* (já fixado no contrato do épico 3), 12 na *montagem*. A proposta é subconjunto da montagem, então nenhum caminho quebra. Se a PO quiser 12 na proposta, é alteração no contrato do épico 3 e vira ADR |
| **`intervaloDias` máximo** | 180 no catálogo, **365** no item | 180 no catálogo | **Os dois.** 180 em `procedimentos` (é sugestão), 365 em `itens_do_programa` (é o caso real) |
| **`excluirPlano`** | recusa se alguma adesão usa (`planoId` **ou** `itens[].procId`); depois `splice` | recusa se alguma adesão usa; depois `deleteRow` | **Nenhum dos dois em DUAS frentes.** (a) **Soft delete** (`excluido_em`), regra 20 — o histórico e o contato de retorno dessas pacientes dependem do item. (b) A recusa passa a alcançar também as **propostas vivas** (`tarefas.programa_orcado`), que nenhum dos dois confere — e que o épico 3 deixou como buraco aberto |
| **`criarAdesao` · permissão** | **nenhuma**: qualquer pessoa logada monta um programa e lança o pagamento | **nenhuma** | **Divergência consciente.** `@Exige('programas')` na rota; `receber` **cobrado no serviço** quando o corpo traz dinheiro. A enfermagem tem `programas` e não tem `receber` — ela monta o programa, e o pagamento vai pela tela Recebimentos. A rota que cria dinheiro é gated, sem exceção (é a mesma decisão D-7 do épico 3) |
| **`encerrarAdesao` / `excluirAdesao` · permissão** | `programas.gerir` | `me.admin` | **Protótipo.** Não é discordância: é a matriz substituindo o booleano `admin`, que o `CONTEXT.md` proíbe |
| **`excluirAdesao` · estoque** | **apaga** os movimentos (`movs.filter(m => !removidos.includes(m.id))`) | não tem estoque | **Nenhum dos dois.** Regra 12: movimento é append-only, desfazer é compensação ligada por `tarefaId`. O seam `BaixaDeInsumos.desfazer` existe por causa desta linha |
| **`excluirAdesao` · sessões pagas** | apaga **todas** as sessões, inclusive realizadas, e **desvincula** orçamento e recebimentos | o mesmo | **Nenhum dos dois** → **❓ pergunta para o dono**, abaixo. A proposta deste plano: **recusar** quando alguma sessão tem recebimento vivo, porque o épico 2 já recusa excluir tarefa com recebimento (`"Reabra a tarefa"`) e ter duas respostas para a mesma pergunta é como uma delas vira a errada |
| **Reprogramação em cascata** | reprograma as próximas **daquele item** e **empurra os itens que começam depois dele**, só quando o dependente ainda não começou | reprograma as próximas da adesão inteira | **Protótipo.** O `Code.gs` é o caso de um item, e a regra coincide nele |
| **Reprogramar é escolha, não padrão** | `b.reprogramar`, a tela pergunta | `b.reprogramar`, idem | **Os dois.** Vira campo **obrigatório** no corpo de concluir sessão: um padrão silencioso aqui move a agenda de doze aplicações sem ninguém ter pedido |
| **Contato de retorno** | **um por item** (`itemKey`), quando não restam sessões abertas **daquele item** e não há retorno vivo dele | **um por adesão** | **Protótipo.** Para o dado migrado (um item `i1`), as duas regras produzem o mesmo resultado — e é isso que a conferência do épico 9 vai cobrar |
| **`cancelarRetornos`** | cancela retornos abertos do mesmo **paciente + procedimento**, com `obs: 'Paciente refez o procedimento'` | o mesmo, casando pelo `planoId` da adesão | **Os dois concordam.** Sem isso, a paciente que refez o procedimento continua recebendo a ligação de "você já pode repetir" |
| **Prazo do retorno nunca é passado** | `if (prazo < hoje) prazo = hoje` | o mesmo | **Os dois** — e `hoje` é o do **servidor**, no fuso da clínica (regra 24). O protótipo usa `today()` do navegador |
| **`modo` da adesão** | `saldo` quando `valorAberto > 0`, senão `avulso` | o mesmo | **Os dois.** Vira `modo_de_cobranca` |
| **Pagamento da adesão** | tarefa `Pagamento de orçamento` concluída, com `valor` e `valorAberto` na própria tarefa | o mesmo, com `Math.round((total-ent)*100)/100` | **Os dois no efeito, nenhum na forma.** Uma linha de `recebimentos` presa à tarefa companheira (regra 3), em centavos, `total.menos(entrada)` |
| **Sessão de programa concluída conta na jornada?** | `ehEsteira` exclui `Sessão de plano` | não tem jornada | **Os dois.** `TIPOS_REALIZADOS` do épico 2 **já exclui** a sessão, com o comentário certo: contá-la faria doze aplicações de uma paciente virarem doze atendimentos no denominador da conversão. Este épico só escreve o **teste** que o prova |
| **Ciclo em `depoisDe`** | não confere: `i1 depoisDe i2` e `i2 depoisDe i1` passa, e a fila do `while` nunca produz data | não existe | **Nenhum dos dois.** O `superRefine` do épico 3 cobre chave repetida e `depoisDe` órfão, **não ciclo**. O cronograma da Task 1 detecta e recusa, com o item nomeado |

**Nenhuma destas vira ADR isolada.** Entram todas em `docs/adr/0005-programa-montado-por-itens.md`, escrita na Task 14 — são a mesma decisão vista de quinze ângulos: *o programa é montado por itens, materializado em sessões, e o catálogo é imutável para quem já começou*.

---

## Decisões de produto tomadas neste plano

| # | Decisão | Por quê |
|---|---|---|
| **P-1** | **As sessões são materializadas** como `Tarefa`, uma linha por sessão, com `programa_id`, `item_chave`, `sessao_indice` e `sessao_total`. Não derivadas de `(início, n, intervalo)` | Quatro razões, e a quarta decide. (a) **Uma sessão é um item de agenda de uma pessoa:** tem responsável, prazo, hora, observação, pode ser cancelada sozinha, concluída retroativa e carregar o pagamento embutido — nada disso cabe numa série derivada. (b) **Reprogramar é o caso normal**, não a exceção: uma série derivada precisaria de uma tabela de exceções, que é a série materializada com outro nome e mais um lugar para divergir. (c) **O épico 2 já materializa** a série recorrente (`serie_id`), e duas formas de "N tarefas iguais" no mesmo sistema é dívida nascendo. (d) **Há dado real:** as 4 clínicas têm linhas de `Tarefas` com `adesaoId` e `sessao = "5/12"`, já reprogramadas e canceladas à mão. Derivar obrigaria o migrador a inventar um mapeamento de volta para parâmetros que o dado não tem — e a regra 28 reprova a clínica inteira por **uma** paciente divergente |
| **P-2** | **`programas` não guarda nenhum número derivado**: nem `sessoes`, nem `saldo`, nem `recebido`, nem `valor_total`, nem o nome do programa | O legado guarda os cinco. O nome sai da concatenação dos `procedimento_nome` dos itens; o total sai da soma de `itens_do_programa.valor`; o recebido e o saldo saem de `recebimentos` pelo `saldoEmAberto` do épico 4. Guardar qualquer um deles é criar um segundo número para a mesma pergunta, e o segundo é o que fica errado |
| **P-3** | **O valor negociado é rateado entre os ITENS, não entre as sessões** | O que a clínica negocia é "R$ 3.600 pelo programa". O que ela precisa ver é quanto cada item vale, porque é por item que ela encerra, troca ou desconta. Ratear até a sessão criaria um número por linha de agenda que ninguém confere e que o legado nunca teve. `Σ itens.valor = valorTotal`, **exatamente**, e é esta igualdade que a Task 2 prova por propriedade |
| **P-4** | **O rateio é proporcional ao valor de referência × sessões, com o resto distribuído nas partes de maior resto** (`ratearPrograma`). Com pesos iguais ele **é** o `Dinheiro.ratear` que já existe | Um programa com Tirzepatida (R$ 300/sessão) e Drenagem (R$ 150/sessão) não divide o desconto meio a meio. E a propriedade *"pesos iguais ⇒ idêntico a `ratear`"* é o que impede o sistema de ter **duas** regras de rateio de dinheiro — que é precisamente como um centavo some entre duas telas |
| **P-5** | **`concluir` de uma sessão tem rota própria** (`POST /v1/programas/sessoes/:id/concluir`), e `POST /v1/tarefas/:id/concluir` **recusa** uma sessão | Concluir uma sessão não é concluir uma tarefa: ela precisa saber se as próximas seguem a nova data, dar baixa no estoque e, na última do item, criar o contato de retorno. Empilhar isso na rota genérica faria `TarefasModule` depender de `ProgramasModule`, que já depende dele — e a saída para o ciclo seria um `forwardRef`, que é onde a ordem de inicialização vira defeito intermitente. A mensagem da recusa **diz o motivo em português de balcão**, não em português de API |
| **P-6** | **`DELETE /v1/tarefas/:id` recusa uma sessão.** Cancele a sessão, ou encerre o programa | Excluir uma sessão abre buraco na numeração (`5/12` sem `6/12`), e a numeração é o que a reprogramação usa para saber o que vem depois |
| **P-7** | **Procedimento desativado AINDA MONTA um programa orçado antes da desativação.** Procedimento **excluído**, não | "Desmarque Ativo" significa *deixa de ser oferecido em novas adesões* (MANUAL cap. 11) — não *a proposta de ontem perdeu a validade*. Já o excluído não tem sessões, intervalo nem insumo para montar com: `409`, com o item nomeado, e a proposta fica intacta esperando a edição |
| **P-8** | **`"Minhas metas" sai deste épico** e vai para o 7. No lugar, a enfermagem ganha o filtro **"Minhas sessões"** na tela Programas | Medido no protótipo rodando: `vMinhasMetas` lê `fichaDoUser`, `pes().metas` e os 8 indicadores `IND_PES` — **nada** disso existe fora do épico 7, e nenhuma linha dela toca programa. Construí-la aqui significaria construir metade do épico 7 para entregar uma tela que a enfermagem abre uma vez por mês. O que ela abre todo dia é a agenda das sessões dela, e isso **já está no protótipo**, no filtro "Minhas sessões" da tela Programas (medido). Ver a pergunta ao dono |

### ❓ As duas perguntas que ficam para o dono

> **1. Excluir um programa que já tem sessão realizada e paga: recusar ou deixar?**
>
> O MANUAL é explícito: *"Excluir adesão: só para registros feitos por engano. Apaga a adesão e todas as sessões, **inclusive as realizadas**, e desfaz as baixas de estoque delas."* O protótipo e o `Code.gs` fazem isso — e desvinculam o orçamento e os recebimentos, que continuam contando receita sem origem visível.
>
> **O épico 2 já decidiu o contrário para a tarefa solta:** *"excluir uma tarefa com recebimento é recusado — estorne primeiro"*, com a mensagem *"Reabra a tarefa"*. Duas respostas para a mesma pergunta é como uma delas vira a errada.
>
> **O que este plano faz:** `DELETE /v1/programas/:id` **recusa com 409** quando alguma sessão tem recebimento vivo — *"Há pagamentos lançados nas sessões deste programa. Estorne-os antes de excluir, ou use Encerrar programa."* Sem recebimento vivo, exclui: soft delete do programa, soft delete das sessões, `BaixaDeInsumos.desfazer` por compensação, e os recebimentos da adesão **perdem o `programa_id`** (voltam ao grupo geral do saldo).
>
> **A alternativa** é seguir o MANUAL e estornar automaticamente os recebimentos das sessões ao excluir. É menos atrito no balcão e mais chance de a receita do mês mudar sem ninguém ter pedido.
>
> **Não decida isto no código.** Se a resposta for "siga o MANUAL", a Task 11 troca a recusa por um estorno em cascata **dentro da mesma transação**, e ganha o teste de que a receita do dia cai exatamente o valor estornado.

> **2. "Minhas metas" fica no épico 7, e a enfermagem recebe "Minhas sessões" agora. Aceita?**
>
> O `docs/roadmap.md` põe *"Minhas metas da enfermagem"* neste épico. Medido no protótipo: a tela não tem **nada** de programa — ela lista as metas mensais da pessoa, automáticas (os 8 indicadores `IND_PES`) e manuais, lidas da ficha de RH. `docs/paridade.md` já lista `meta`, `copiarMetas`, `realizado` e os 8 indicadores **no épico 7**.
>
> **O que este plano faz:** entrega o filtro **"Minhas sessões"** na tela Programas — que é o que a enfermagem abre todo dia — e deixa "Minhas metas" para o épico 7, com a linha do roadmap corrigida na Task 14.
>
> **A alternativa** é antecipar fichas, metas e os 8 indicadores para cá, o que é o épico 7 inteiro menos férias e 1:1.

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `packages/domain/src/programa.ts` | **O cronograma.** `ordenarItens`, `datasDasSessoes`, `montarCronograma`, `reprogramar`, `situacaoDoPrograma` |
| `packages/domain/src/programa.test.ts` | Os exemplos e as propriedades |
| `packages/domain/src/rateio.ts` · `rateio.test.ts` | `ratearPrograma`, `Dinheiro.vezes`, `valorSugerido` |
| `packages/domain/src/retorno.ts` · `retorno.test.ts` | `retornoDe` — a aritmética de mês da regra 25 |
| `apps/api/migrations/0009_programas.sql` | `procedimentos`, `insumos_do_procedimento`, `programas`, `itens_do_programa`, ALTERs, RLS, trilha, semeadura |
| `packages/contracts/src/programas.ts` | `SalvarProcedimento`, `MontarPrograma`, `ConcluirSessao`, `EncerrarPrograma` |
| `packages/contracts/src/jornada.ts` *(modificar)* | `inicioDoPrograma` no ramo `fechar` de `MoverEtapa` |
| `apps/api/src/programas/catalogo.controller.ts` · `catalogo.service.ts` | O catálogo de procedimentos |
| `apps/api/src/programas/montador-de-programa.ts` | **O seam do épico 3**, declarado lá e implementado aqui |
| `apps/api/src/programas/programas.controller.ts` · `programas.service.ts` · `programas.module.ts` | Montar, ler, encerrar, excluir |
| `apps/api/src/programas/sessoes.controller.ts` · `sessoes.service.ts` | Concluir e reabrir sessão |
| `apps/api/src/programas/baixa-de-insumos.ts` | **O seam do épico 6**, declarado aqui e inerte |
| `apps/api/src/jornada/fechamento.service.ts` | O `fechar` numa transação só — a Task 7 que o épico 3 não fez |
| `apps/api/src/banco/transacao.ts` | `export type Transacao = pg.PoolClient` — o nome que os dois seams usam |
| `apps/api/src/hoje/hoje.service.ts` *(modificar)* | O bloco "Sessões de programas" |
| `apps/web/src/app/(app)/programas/page.tsx` · `programas/[id]/page.tsx` | A tela Programas e a página do programa |
| `apps/web/src/app/(app)/procedimentos/page.tsx` | O catálogo |
| `apps/web/src/components/programas/montador.tsx` | O montador, usado por Nova adesão **e** pelo orçamento do épico 3 |
| `docs/adr/0005-programa-montado-por-itens.md` | As quinze divergências, numa decisão só |

---

## Interfaces

As assinaturas exatas em que as tarefas dependem umas das outras.

```ts
// packages/domain/src/programa.ts  (Task 1)

export type ItemParaCronograma = {
  readonly chave: string
  readonly sessoes: number
  readonly intervaloDias: number
  /** `null` = começa no início do programa, ou logo depois do item de `depoisDe`. */
  readonly inicio: string | null
  readonly depoisDe: string | null
}

export type SessaoProgramada = {
  readonly itemChave: string
  readonly indice: number      // 1..total, DENTRO do item
  readonly total: number
  readonly prazo: string       // dia civil
}

/**
 * A ordem em que os itens podem ser datados: pai antes de filho.
 * Erro de domínio em ciclo (`CICLO_NO_PROGRAMA`) e em `depoisDe` órfão.
 */
export function ordenarItens(itens: readonly ItemParaCronograma[]): Result<readonly string[]>

/** `n` datas a partir de `inicio`, de `intervaloDias` em `intervaloDias`. */
export function datasDasSessoes(inicio: string, n: number, intervaloDias: number): readonly string[]

/** Todas as sessões do programa, em ordem cronológica estável. */
export function montarCronograma(
  inicioDoPrograma: string, itens: readonly ItemParaCronograma[],
): Result<readonly SessaoProgramada[]>

export type SessaoExistente = {
  readonly tarefaId: string
  readonly itemChave: string
  readonly indice: number
  readonly prazo: string
  readonly status: 'aberta' | 'concluida' | 'cancelada'
}

/**
 * O que muda de prazo quando a sessão `indice` do item `itemChave` foi
 * realizada em `realizadaEm`. Devolve SÓ as mudanças — nunca a lista inteira.
 *
 * Alcança: as sessões ABERTAS do mesmo item com `indice` maior, e, em cascata,
 * os itens que começam depois dele **e ainda não começaram** (nenhuma sessão
 * concluída). Nunca toca no passado, nunca toca em concluída ou cancelada.
 */
export function reprogramar(entrada: {
  readonly itens: readonly ItemParaCronograma[]
  readonly sessoes: readonly SessaoExistente[]
  readonly itemChave: string
  readonly indice: number
  readonly realizadaEm: string
}): Result<readonly { readonly tarefaId: string; readonly prazo: string }[]>

export type SituacaoDoPrograma =
  | 'encerrado' | 'concluido' | 'atrasado' | 'hoje' | 'emdia'

export function situacaoDoPrograma(entrada: {
  readonly encerrado: boolean
  readonly sessoes: readonly SessaoExistente[]
  readonly hojeDaClinica: string
}): { readonly situacao: SituacaoDoPrograma; readonly diasDeAtraso: number }
```

```ts
// packages/domain/src/rateio.ts  (Task 2)

/**
 * Reparte `total` entre as partes, proporcionalmente a `pesos`, de modo que
 * a soma seja EXATAMENTE `total`.
 *
 * Maior resto (Hare), desempate pela ORDEM — as primeiras. Com pesos todos
 * iguais, é idêntico a `Dinheiro.ratear(n)`, e a propriedade que exige isso
 * é o que impede o sistema de ter duas regras de rateio de dinheiro.
 */
export function ratearPrograma(total: Dinheiro, pesos: readonly bigint[]): readonly Dinheiro[]

/** `valor por sessão × sessões`, somado. `null` quando nenhum item tem valor. */
export function valorSugerido(
  itens: readonly { readonly valorPorSessao: Dinheiro | null; readonly sessoes: number }[],
): Dinheiro | null

// packages/domain/src/dinheiro.ts  (Task 2, acréscimo)
//   vezes(n: bigint): Dinheiro
```

```ts
// packages/domain/src/retorno.ts  (Task 3)

export type RegraDeRetorno = {
  readonly quantidade: number
  readonly unidade: 'd' | 'm'
  readonly antecedenciaDias: number
}

export type ContatoDeRetorno = {
  /** O dia em que a paciente já pode repetir o procedimento. */
  readonly podeEm: string
  /** O prazo da tarefa de contato: `podeEm − antecedência`, nunca no passado. */
  readonly prazo: string
}

/** `null` quando o procedimento não tem regra de retorno. */
export function retornoDe(
  regra: RegraDeRetorno | null, ultimaSessaoEm: string, hojeDaClinica: string,
): ContatoDeRetorno | null
```

```sql
-- apps/api/migrations/0009_programas.sql  (Task 4)
CREATE TABLE procedimentos            (… valor_por_sessao bigint, retorno_*, insumo_padrao_* …);
CREATE TABLE insumos_do_procedimento  (… item_id, qtd_milesimos bigint, unidade text …);
CREATE TABLE programas                (… modo_de_cobranca, situacao, tarefa_de_origem_id …);
CREATE TABLE itens_do_programa        (… chave, procedimento_nome, sessoes, intervalo_dias, inicio, depois_de, valor …);
ALTER TABLE tarefas      ADD programa_id, item_chave, sessao_indice, sessao_total, procedimento_id;
ALTER TABLE recebimentos ADD programa_id;
```

```ts
// apps/api/src/banco/transacao.ts  (Task 4)
import type pg from 'pg'
/** O que `banco.naClinica` entrega ao callback. Os dois seams a recebem. */
export type Transacao = pg.PoolClient
```

```ts
// apps/api/src/programas/montador-de-programa.ts  (Task 7)
//
// A CLASSE ABSTRATA QUE O ÉPICO 3 DECLAROU — e que MUDA DE CASA.
// O épico 3 a anunciou em `apps/api/src/jornada/`; ela mora aqui porque o
// seam pertence ao módulo que possui o conceito, e `jornada → programas` é a
// dependência que o DADO já tem (`tarefas.programa_orcado`). O inverso seria
// ciclo.

export type ItemParaMontar = {
  readonly chave: string
  readonly procedimentoId: string
  readonly sessoes: number
  readonly intervaloDias: number
  readonly inicio: string | null
  readonly depoisDe: string | null
  readonly responsavelId: string | null   // `null` → o padrão do procedimento
  readonly dose: string | null
  readonly valor: Dinheiro | null         // `null` → rateado do `valorTotal`
  readonly insumo: { readonly itemId: string; readonly quantidade: Quantidade } | null
}

export type PedidoDeMontagem = {
  readonly clinicaId: ClinicaId
  readonly pacienteId: string
  /** Dia civil, no fuso da clínica. NUNCA do relógio do cliente (regra 24). */
  readonly inicio: string
  readonly itens: readonly ItemParaMontar[]
  readonly hora: string | null
  readonly unidadeId: string | null
  /** O cartão de orçamento que fechou, ou `null` em `POST /v1/programas`. */
  readonly tarefaDeOrigemId: string | null
  /** O recebimento da adesão, criado por QUEM CHAMA, na mesma transação.
   *  Recebe `programa_id` para que o saldo do épico 4 agrupe. */
  readonly recebimentoDaAdesaoId: string | null
  /** O total negociado. `null` = programa sem total (cada sessão registra o
   *  que foi pago no dia). Rateado entre os itens que não trazem valor. */
  readonly valorTotal: Dinheiro | null
  readonly modoDeCobranca: 'avulso' | 'saldo'
  readonly atorId: string
  readonly hojeDaClinica: string
}

export type ProgramaMontado = {
  readonly programaId: string
  readonly sessoes: readonly {
    readonly tarefaId: string; readonly itemChave: string
    readonly indice: number;   readonly prazo: string
  }[]
  /** Contatos de retorno cancelados por "Paciente refez o procedimento". */
  readonly retornosCancelados: readonly string[]
}

export abstract class MontadorDePrograma {
  /**
   * Monta o programa inteiro — itens, sessões e o cancelamento dos contatos
   * de retorno — DENTRO da transação de quem chama.
   *
   * A atomicidade é de quem chama, não de quem é chamado: `fechar` precisa
   * que o recebimento, a etapa e o programa vivam ou morram juntos. Senão a
   * paciente paga, o cartão fecha, e as doze aplicações não existem.
   */
  abstract montar(tx: Transacao, pedido: PedidoDeMontagem): Promise<Result<ProgramaMontado>>
}
```

```ts
// apps/api/src/programas/baixa-de-insumos.ts  (Task 9)
//
// O SEAM DO ÉPICO 6, declarado aqui e INERTE até lá — do mesmo jeito que o
// épico 3 declarou o `MontadorDePrograma` para este.

export type InsumoParaBaixa = {
  readonly itemId: string
  readonly quantidade: Quantidade   // na unidade DECLARADA no cadastro
  /** O insumo do item do programa (a dose), e não um descartável fixo.
   *  Só o principal pode gerar descarte de sobra de frasco aberto. */
  readonly principal: boolean
}

export type PedidoDeBaixa = {
  readonly clinicaId: ClinicaId
  readonly tarefaId: string
  readonly pacienteId: string
  readonly procedimentoId: string
  readonly programaId: string | null
  readonly itemChave: string | null
  readonly aplicadoPorId: string
  /** Dia civil da realização, no fuso da clínica. */
  readonly em: string
  readonly insumos: readonly InsumoParaBaixa[]
}

export type MotivoDeDesfazer = 'sessao-reaberta' | 'programa-excluido'

export abstract class BaixaDeInsumos {
  abstract baixar(tx: Transacao, pedido: PedidoDeBaixa): Promise<Result<void>>
  /** Compensação ligada por `tarefaId`. NUNCA `DELETE` (regra 12). */
  abstract desfazer(
    tx: Transacao, clinicaId: ClinicaId, tarefaId: string, motivo: MotivoDeDesfazer,
  ): Promise<Result<void>>
}

/** Até o épico 6. Não falha: o programa funciona sem estoque configurado. */
@Injectable()
export class BaixaInerte extends BaixaDeInsumos { /* ok() nos dois */ }
```

**O invariante que o épico 6 terá de honrar, e que este plano já escreve como teste pendente:**

> **`desfazer` restaura exatamente o que `baixar` tirou — mesma quantidade, mesmo lote — por movimento compensatório ligado por `tarefaId`, nunca `DELETE`.** E a ida-e-volta é idempotente: **concluir → reabrir → concluir → reabrir** devolve saldo **e lote** ao ponto inicial. Item que não aproveita sobra gera **dois** movimentos na baixa (consumo da dose + descarte "Sobra de frasco aberto"), e `desfazer` compensa **os dois** — é o segundo que a implementação ingênua esquece, porque o descarte não está no que a sessão pediu.

---

## Task 1: O cronograma, no domínio puro

**Files:** `packages/domain/src/programa.ts` · `programa.test.ts` · *(modificar)* `packages/domain/src/index.ts`

**Antes da migration, antes de qualquer rota.** Esta é a tarefa de que o épico inteiro depende, e ela não toca em I/O, banco nem framework.

**A forma importa:** `montarCronograma` e `reprogramar` são **funções puras sobre listas**, e `reprogramar` devolve **só o que muda** — nunca a lista inteira. Quem devolve a lista inteira faz o serviço reescrever 12 linhas para mover 3, e a trilha de auditoria passa a registrar nove mudanças que não aconteceram. A trilha é prova (regra 20), e prova com ruído é prova que ninguém lê.

**A ordem do encadeamento é um grafo, e grafo tem ciclo.** O `superRefine` do épico 3 cobre chave repetida e `depoisDe` órfão; **ciclo passa**. No protótipo, `i1 depoisDe i2` com `i2 depoisDe i1` entra na fila do `while` e nenhum dos dois ganha data — o programa é criado com as sessões todas no dia do início. Aqui é erro de domínio, com os itens nomeados.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/programa.test.ts
const item = (chave: string, sessoes: number, intervaloDias: number, extra = {}) =>
  ({ chave, sessoes, intervaloDias, inicio: null, depoisDe: null, ...extra }) as const

it('um item: N sessões, de intervalo em intervalo, a partir do início', () => {
  const r = exigir(montarCronograma('2026-11-02', [item('i1', 4, 7)]))
  expect(r.map((s) => s.prazo)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'])
  expect(r.map((s) => s.indice)).toEqual([1, 2, 3, 4])
  expect(r.every((s) => s.total === 4)).toBe(true)
})

it('A ESCALADA DE DOSE: o item 2 começa UM INTERVALO depois da última do item 1', () => {
  // Tirzepatida 2,5 mg 4x semanal, depois 5 mg 4x semanal. É o exemplo do
  // MANUAL cap. 8, e é a razão de `itens[]` existir.
  const r = exigir(montarCronograma('2026-11-02', [
    item('i1', 4, 7),
    item('i2', 4, 7, { depoisDe: 'i1' }),
  ]))
  expect(r.filter((s) => s.itemChave === 'i1').at(-1)!.prazo).toBe('2026-11-23')
  expect(r.filter((s) => s.itemChave === 'i2')[0]!.prazo).toBe('2026-11-30')
})

it('item com data PRÓPRIA ignora o início do programa', () => {
  const r = exigir(montarCronograma('2026-11-02', [item('i1', 2, 30, { inicio: '2026-12-01' })]))
  expect(r[0]!.prazo).toBe('2026-12-01')
})

it('a numeração é DENTRO do item, não do programa', () => {
  // "Aplicação 1/4 · Tirzepatida 5 mg" e não "Aplicação 5/8". É o rótulo que
  // a enfermagem lê no frasco, e contar o programa inteiro confunde a dose.
  const r = exigir(montarCronograma('2026-11-02', [item('i1', 4, 7), item('i2', 4, 7, { depoisDe: 'i1' })]))
  expect(r.filter((s) => s.itemChave === 'i2').map((s) => s.indice)).toEqual([1, 2, 3, 4])
})

it('CICLO é erro de domínio, com os itens nomeados — o protótipo aceita', () => {
  const r = montarCronograma('2026-11-02', [
    item('i1', 2, 7, { depoisDe: 'i2' }), item('i2', 2, 7, { depoisDe: 'i1' }),
  ])
  expect(r.erro.codigo).toBe('CICLO_NO_PROGRAMA')
  expect(r.erro.mensagem).toContain('i1')
})

it('`depoisDe` órfão é erro, mesmo o contrato do épico 3 já cobrindo', () => {
  // Duas camadas de propósito: o contrato protege a ROTA, esta função protege
  // a MONTAGEM — e a montagem também é chamada pelo migrador do épico 9, que
  // não passa por contrato nenhum.
  expect(montarCronograma('2026-11-02', [item('i1', 2, 7, { depoisDe: 'ix' })]).erro.codigo)
    .toBe('ITEM_INEXISTENTE')
})

it('cadeia de três itens encadeados é datada na ordem certa, venha como vier', () => {
  const r = exigir(montarCronograma('2026-11-02', [
    item('i3', 1, 7, { depoisDe: 'i2' }), item('i1', 2, 7), item('i2', 2, 7, { depoisDe: 'i1' }),
  ]))
  expect(r.at(-1)!.itemChave).toBe('i3')
})

// -- REPROGRAMAÇÃO ---------------------------------------------------------
it('reprogramar a partir da realizada move SÓ as abertas seguintes do item', () => {
  // Série semanal 02/11..23/11. A 2ª foi realizada em 13/11 (3 dias atrasada).
  const r = exigir(reprogramar({
    itens: [item('i1', 4, 7)], sessoes: SESSOES_DE_I1,
    itemChave: 'i1', indice: 2, realizadaEm: '2026-11-13',
  }))
  expect(r).toEqual([
    { tarefaId: 's3', prazo: '2026-11-20' }, { tarefaId: 's4', prazo: '2026-11-27' },
  ])
  // A 1ª e a 2ª NÃO aparecem: o passado não se reescreve.
})

it('reprogramar NÃO toca em concluída nem em cancelada posterior', () => { /* ... */ })

it('reprogramar devolve SÓ o que muda — nada de lista inteira', () => {
  // Se a sessão já está na data certa, ela não entra no resultado. Senão a
  // trilha registra nove mudanças para mover três.
  const r = exigir(reprogramar({ ...BASE, realizadaEm: PRAZO_ORIGINAL_DA_2 }))
  expect(r).toEqual([])
})

it('CASCATA: o item que começa depois é empurrado, se ainda não começou', () => {
  const r = exigir(reprogramar({
    itens: [item('i1', 4, 7), item('i2', 4, 7, { depoisDe: 'i1' })],
    sessoes: [...I1, ...I2_TODAS_ABERTAS],
    itemChave: 'i1', indice: 2, realizadaEm: '2026-11-13',
  }))
  expect(r.map((x) => x.tarefaId)).toContain('s2-1')
})

it('CASCATA PARA: o item dependente que JÁ COMEÇOU não é empurrado', () => {
  // Uma sessão do item 2 já foi aplicada. Mover a agenda dela por causa do
  // item 1 seria reescrever o passado da paciente.
  const r = exigir(reprogramar({ ...BASE, sessoes: [...I1, ...I2_COM_UMA_CONCLUIDA] }))
  expect(r.map((x) => x.tarefaId).some((id) => id.startsWith('s2-'))).toBe(false)
})

// -- SITUAÇÃO --------------------------------------------------------------
it('a situação é atrasado > hoje > emdia, e concluído só sem abertas', () => {
  expect(situacaoDoPrograma({ encerrado: false, sessoes: TODAS_CONCLUIDAS, hojeDaClinica: H }).situacao)
    .toBe('concluido')
  expect(situacaoDoPrograma({ encerrado: false, sessoes: UMA_ATRASADA, hojeDaClinica: H }))
    .toMatchObject({ situacao: 'atrasado', diasDeAtraso: 8 })
  expect(situacaoDoPrograma({ encerrado: true, sessoes: UMA_ATRASADA, hojeDaClinica: H }).situacao)
    .toBe('encerrado')   // encerrado vence tudo
})

it('sessão CANCELADA não torna o programa concluído nem atrasado', () => {
  // `validas = status !== 'cancelada'` no protótipo. Uma sessão cancelada que
  // contasse como "em aberto" deixaria todo programa encerrado parecendo ativo.
})
```

E as propriedades — **cronograma é exatamente o lugar onde exemplo escolhido a dedo não prova nada**:

```ts
const gItem = fc.record({
  chave: fc.string({ minLength: 1, maxLength: 4 }),
  sessoes: fc.integer({ min: 1, max: 20 }),
  intervaloDias: fc.integer({ min: 1, max: 60 }),
  inicio: fc.constant(null), depoisDe: fc.constant(null),
})

it.prop([gDia, fc.integer({ min: 1, max: 60 }), fc.integer({ min: 1, max: 365 })])(
  'as datas são ESTRITAMENTE crescentes e espaçadas exatamente pelo intervalo',
  (inicio, n, passo) => {
    const d = datasDasSessoes(inicio, n, passo)
    expect(d).toHaveLength(n)
    for (let i = 1; i < d.length; i++) {
      expect(d[i]! > d[i - 1]!).toBe(true)
      expect(diasEntre(d[i - 1]!, d[i]!)).toBe(passo)
    }
  },
)

it.prop([gDia, fc.array(gItem, { minLength: 1, maxLength: 12 })])(
  'nenhum item encadeado começa antes de o seu pai terminar',
  (inicio, itens) => {
    const encadeados = encadearEmLinha(itens)   // i2 depoisDe i1, i3 depoisDe i2...
    const r = montarCronograma(inicio, encadeados)
    if (ehErro(r)) return
    for (const it of encadeados) {
      if (it.depoisDe === null) continue
      const fimDoPai = ultimaDe(r.valor, it.depoisDe)
      expect(primeiraDe(r.valor, it.chave) > fimDoPai).toBe(true)
    }
  },
)

it.prop([gDia, gItensComDepoisDeSorteado])(
  'ou o cronograma sai inteiro, ou é erro — nunca um item sem data',
  (inicio, itens) => {
    const r = montarCronograma(inicio, itens)
    if (ehErro(r)) return
    expect(r.valor).toHaveLength(itens.reduce((s, i) => s + i.sessoes, 0))
    expect(new Set(r.valor.map((s) => s.itemChave)).size).toBe(itens.length)
  },
)

it.prop([gSessoes, fc.integer({ min: 1, max: 20 }), gDia])(
  'REPROGRAMAR NUNCA MOVE O PASSADO: nenhuma sessão de índice <= k entra no resultado',
  (sessoes, k, realizadaEm) => {
    const r = reprogramar({ ...BASE, sessoes, indice: k, realizadaEm })
    if (ehErro(r)) return
    for (const m of r.valor) expect(indiceDe(sessoes, m.tarefaId) > k).toBe(true)
  },
)

it.prop([gEntradaDeReprogramacao])(
  'reprogramar é IDEMPOTENTE: aplicar o resultado e reprogramar de novo não muda nada',
  (entrada) => {
    // Sem esta, uma implementação que ancora na sessão ANTERIOR em vez de na
    // realizada desloca a série um pouco mais a cada toque — e a enfermagem
    // descobre quando a última aplicação cai em janeiro.
    const um = exigir(reprogramar(entrada))
    const dois = exigir(reprogramar({ ...entrada, sessoes: aplicar(entrada.sessoes, um) }))
    expect(dois).toEqual([])
  },
)
```

- [ ] **Passo 2: Rodar e ver falhar** — `cd packages/domain && npx vitest run programa`

- [ ] **Passo 3: Implementar**

```ts
// packages/domain/src/programa.ts
/**
 * A ÂNCORA DA REPROGRAMAÇÃO É A SESSÃO REALIZADA, não a anterior.
 *
 * `prazo = realizadaEm + (indiceDela - indiceRealizada) * intervalo`. É o que
 * o `Code.gs:444` e o protótipo fazem, e a diferença é visível: ancorar na
 * sessão anterior faz a série deslizar um pouco a cada toque, porque o erro
 * de cada passo entra no passo seguinte. Com a âncora fixa, reprogramar duas
 * vezes seguidas sem nova conclusão não muda nada — e é essa a propriedade
 * de idempotência do Passo 1.
 */
const prazoReprogramado = (realizadaEm: string, k: number, indice: number, passo: number) =>
  somarDias(realizadaEm, (indice - k) * passo)
```

`ordenarItens` é uma ordenação topológica por **busca em profundidade com marcação tripla** (branco/cinza/preto): o cinza encontrado de novo **é** o ciclo, e o caminho cinza dá os nomes para a mensagem. Contar graus de entrada (Kahn) detecta o ciclo mas não sabe dizer quais itens o formam — e "há um ciclo no programa" sem dizer onde é um erro que a recepção não consegue corrigir.

- [ ] **Passo 4: Rodar — PASS.** Exporte de `index.ts`.

- [ ] **Passo 5: Prova por mutação** — troque a âncora de `somarDias(realizadaEm, (indice-k)*passo)` para `somarDias(prazoAnterior, passo)`. A propriedade de idempotência tem de falhar. Restaure. **É a mutação que este épico existe para pegar:** ela não produz erro nenhum, produz uma agenda que escorrega.

- [ ] **Passo 6: Segunda mutação** — faça a cascata empurrar o item dependente **sempre**, sem conferir se ele já começou. O teste *"CASCATA PARA"* tem de falhar. Restaure.

- [ ] **Passo 7: Commit**

---

## Task 2: O rateio do valor — e a soma que tem de fechar

**Files:** `packages/domain/src/rateio.ts` · `rateio.test.ts` · *(modificar)* `packages/domain/src/dinheiro.ts` · `index.ts`

**O problema real:** a clínica negocia **R$ 3.600 pelo programa**, e o programa tem Tirzepatida (12 × R$ 300) e Drenagem (3 × R$ 150). O desconto não se divide meio a meio — ele se divide proporcionalmente. E **a soma dos itens tem de ser exatamente R$ 3.600**, senão a página do programa mostra uma decomposição que não bate com o que a paciente deve, e a recepção não consegue cobrar.

**A propriedade que amarra esta função à que já existe:** com **pesos iguais**, `ratearPrograma` tem de produzir **exatamente** `Dinheiro.ratear(n)`. Sem ela, o sistema passa a ter duas regras de rateio de dinheiro, e a segunda é a que vai divergir da primeira num centavo que ninguém encontra.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/rateio.test.ts
const c = (n: number) => Dinheiro.deCentavos(BigInt(n))

it('reparte proporcionalmente ao peso, e a soma é EXATA', () => {
  // R$ 3.600 entre Tirzepatida (12x300 = 3600) e Drenagem (3x150 = 450).
  const r = ratearPrograma(c(360000), [360000n, 45000n])
  expect(r.map((d) => d.centavos)).toEqual([320000n, 40000n])
  expect(r.reduce((s, d) => s.mais(d), Dinheiro.zero()).centavos).toBe(360000n)
})

it('PESOS IGUAIS É EXATAMENTE `Dinheiro.ratear` — uma regra só no sistema', () => {
  for (const [total, n] of [[100, 3], [1, 3], [1000001, 7], [0, 5]] as const) {
    expect(ratearPrograma(c(total), Array(n).fill(1n)).map((d) => d.centavos))
      .toEqual(c(total).ratear(n).map((d) => d.centavos))
  }
})

it('o centavo que sobra vai para o MAIOR RESTO, e empate vai para o primeiro', () => {
  // 10 centavos entre pesos 1,1,1: 3,3,3 e sobra 1 -> [4,3,3].
  expect(ratearPrograma(c(10), [1n, 1n, 1n]).map((d) => d.centavos)).toEqual([4n, 3n, 3n])
})

it('peso zero recebe zero, e não trava o resto', () => {
  expect(ratearPrograma(c(1000), [1n, 0n, 1n]).map((d) => d.centavos)).toEqual([500n, 0n, 500n])
})

it('todos os pesos zero cai no rateio IGUAL — o programa sem valores de referência', () => {
  expect(ratearPrograma(c(1000), [0n, 0n]).map((d) => d.centavos)).toEqual([500n, 500n])
})

it('`valorSugerido` é valor por sessão x sessões, somado', () => {
  expect(valorSugerido([
    { valorPorSessao: c(30000), sessoes: 12 }, { valorPorSessao: c(15000), sessoes: 3 },
  ])!.centavos).toBe(405000n)
})

it('`valorSugerido` é null quando NENHUM item tem valor de referência', () => {
  expect(valorSugerido([{ valorPorSessao: null, sessoes: 4 }])).toBeNull()
})

it('`vezes` não passa por Number em ponto nenhum', () => {
  expect(c(9007199254740993).vezes(3n).centavos).toBe(27021597764222979n)
})
```

E as propriedades — **aqui é obrigatório (CLAUDE.md §7), e a da soma sozinha não basta**:

```ts
const gTotal = fc.bigInt({ min: 0n, max: 10n ** 12n }).map((n) => Dinheiro.deCentavos(n))
const gPesos = fc.array(fc.bigInt({ min: 0n, max: 10n ** 9n }), { minLength: 1, maxLength: 12 })

it.prop([gTotal, gPesos])('a soma das partes é EXATAMENTE o total', (total, pesos) => {
  const r = ratearPrograma(total, pesos)
  expect(r.reduce((s, d) => s.mais(d), Dinheiro.zero()).centavos).toBe(total.centavos)
})

it.prop([gTotal, gPesos])('nenhuma parte é negativa, e há uma parte por peso', (total, pesos) => {
  const r = ratearPrograma(total, pesos)
  expect(r).toHaveLength(pesos.length)
  expect(r.every((d) => !d.ehNegativo())).toBe(true)
})

it.prop([gTotal, fc.integer({ min: 1, max: 30 })])(
  'PESOS IGUAIS => IDÊNTICO A `ratear`, para qualquer total e qualquer n',
  (total, n) => {
    // Esta é a propriedade que impede DUAS regras de rateio de dinheiro no
    // sistema. Com ela, `max - min <= 1` e a distribuição do resto nas
    // primeiras partes vêm de graça, herdadas de `ratear`.
    expect(ratearPrograma(total, Array(n).fill(7n)).map((d) => d.centavos))
      .toEqual(total.ratear(n).map((d) => d.centavos))
  },
)

it.prop([gTotal, gPesos])('MONOTONIA: peso maior nunca recebe parte menor', (total, pesos) => {
  // Sem esta, um arredondamento "para o mais próximo" por parte deixa o item
  // de R$ 450 receber mais que o de R$ 3.600, e a decomposição fica absurda
  // na tela sem que a soma acuse nada.
  const r = ratearPrograma(total, pesos)
  for (let i = 0; i < pesos.length; i++) {
    for (let j = 0; j < pesos.length; j++) {
      if (pesos[i]! > pesos[j]!) expect(r[i]!.centavos >= r[j]!.centavos).toBe(true)
    }
  }
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — maior resto (Hare), tudo em `bigint`:

```ts
/**
 * Maior resto, e NUNCA arredondamento por parte.
 *
 * `Math.round(total * peso / soma)` em cada parte é a implementação que todo
 * mundo escreve primeiro, e ela não soma o total: com 10 centavos em 3 partes
 * iguais ela dá 3+3+3 = 9, e o centavo desaparece. Aqui o piso é exato em
 * `bigint` e o resto é distribuído, um centavo por parte, nas de maior resto —
 * desempate pela ORDEM, que é o que mantém a equivalência com `ratear`.
 */
```

- [ ] **Passo 4: PASS.** Exporte de `index.ts`.

- [ ] **Passo 5: Prova por mutação** — troque a distribuição do resto por "tudo na primeira parte". A propriedade *"PESOS IGUAIS => IDÊNTICO A `ratear`"* tem de falhar para `n >= 4` (com 3 partes as duas coincidem — é exatamente o caso com que todo mundo confere, e é por isso que a propriedade varre `n` até 30). Restaure.

- [ ] **Passo 6: Segunda mutação** — troque o piso `bigint` por `Math.round(Number(...))`. A propriedade da soma exata tem de falhar com totais grandes. Restaure.

- [ ] **Passo 7: Commit**

---

## Task 3: O contato de retorno — e o dia 31 que vira 28

**Files:** `packages/domain/src/retorno.ts` · `retorno.test.ts` · *(modificar)* `index.ts`

**Confira primeiro o que já existe.** `packages/domain/src/relogio.ts` tem `somarDias`, `somarMeses(dia, n, diaOriginal)` e `fimDoMes`, e **`somarMeses` já implementa a regra 25**. Esta tarefa não reescreve nada disso.

A regra, lida de `Code.gs:154` (`retornoDe`) e idêntica no protótipo:

```
podeEm = ultimaSessaoEm + quantidade (meses ou dias)
prazo  = podeEm - antecedência
se prazo < hoje da clínica  ->  prazo = hoje da clínica
```

**O clamp é o detalhe que importa.** Uma paciente que terminou o tratamento há oito meses, com retorno de quatro meses e contato quinze dias antes, teria prazo em data passada — e o cartão nasceria "atrasado há cinco meses" no dia em que foi criado. Clampar põe a ligação na fila de hoje, que é onde ela de fato está.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/domain/src/retorno.test.ts
const regra = (quantidade: number, unidade: 'd' | 'm', antecedenciaDias = 15) =>
  ({ quantidade, unidade, antecedenciaDias }) as const

it('toxina botulínica: repetir a cada 4 meses, contato 15 dias antes', () => {
  // O exemplo do MANUAL cap. 8, "Fim do programa e contato de retorno".
  expect(retornoDe(regra(4, 'm'), '2026-10-25', '2026-10-25'))
    .toEqual({ podeEm: '2027-02-25', prazo: '2027-02-10' })
})

it('O DIA 31 CAI NO ÚLTIMO DIA DO MÊS CURTO — regra 25', () => {
  expect(retornoDe(regra(1, 'm', 0), '2026-01-31', H)!.podeEm).toBe('2026-02-28')
  expect(retornoDe(regra(1, 'm', 0), '2028-01-29', H)!.podeEm).toBe('2028-02-29')
})

it('em dias, não em meses, quando a unidade é `d`', () => {
  expect(retornoDe(regra(90, 'd', 0), '2026-10-25', H)!.podeEm).toBe('2027-01-23')
})

it('O PRAZO NUNCA NASCE NO PASSADO: cai no hoje DA CLÍNICA', () => {
  // Última sessão há 8 meses, retorno de 4 meses: o contato já venceu.
  const r = retornoDe(regra(4, 'm'), '2026-02-25', '2026-10-25')!
  expect(r.podeEm).toBe('2026-06-25')
  expect(r.prazo).toBe('2026-10-25')     // hoje, não 2026-06-10
})

it('sem regra de retorno, não há contato', () => {
  expect(retornoDe(null, '2026-10-25', H)).toBeNull()
})

it('antecedência zero põe o contato no próprio dia em que já pode repetir', () => {
  expect(retornoDe(regra(6, 'm', 0), '2026-10-25', H)!.prazo).toBe('2027-04-25')
})
```

E as propriedades:

```ts
it.prop([gDia, fc.integer({ min: 1, max: 60 }), fc.integer({ min: 0, max: 90 }), gDia])(
  'em meses: `podeEm` tem o dia original OU é o último dia do mês',
  (base, meses, ant, hoje) => {
    const r = retornoDe(regra(meses, 'm', ant), base, hoje)!
    const d = Number(r.podeEm.slice(8, 10))
    expect(d === Number(base.slice(8, 10)) || r.podeEm === fimDoMes(r.podeEm.slice(0, 7))).toBe(true)
  },
)

it.prop([gDia, gRegra, gDia])('o prazo nunca passa de `podeEm` e nunca é antes de hoje', (b, g, h) => {
  const r = retornoDe(g, b, h)
  if (r === null) return
  expect(r.prazo <= r.podeEm || r.prazo === h).toBe(true)
  expect(r.prazo >= h).toBe(true)
})
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** — `somarMeses(base, n, Number(base.slice(8,10)))`, nunca aritmética de mês escrita à mão.

- [ ] **Passo 4: PASS.** Exporte de `index.ts`.

- [ ] **Passo 5: Prova por mutação** — remova o clamp `prazo < hoje`. O teste *"O PRAZO NUNCA NASCE NO PASSADO"* e a segunda propriedade têm de falhar. Restaure.

- [ ] **Passo 6: Commit**

---
