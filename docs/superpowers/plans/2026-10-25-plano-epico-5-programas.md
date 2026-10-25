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

> **Numeração de migration — confira antes de criar o arquivo.** Rode
> `ls apps/api/migrations/` e use o **próximo número livre**, não o que está
> escrito aqui. Os planos foram escritos em paralelo e a numeração já colidiu
> uma vez: o épico 4 anunciava `0007`, que a jornada tomou enquanto o plano era
> escrito. **Migration aplicada nunca se edita** — se o número daqui já existe,
> o certo é o próximo livre, e corrigir este cabeçalho.

> **Decidido pelo dono em 2026-10-25 — `docs/decisoes.md`, D-8.** Excluir programa
> com sessão paga é **recusado**, com as duas saídas na mensagem. A alternativa
> (estorno em cascata, como o MANUAL manda) foi oferecida e recusada: deixaria
> alguém mudar a receita de um mês fechado com um toque. **Não reabra** — e a
> Task 10 fica como está, sem o ramo de estorno.

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
| `apps/api/migrations/0010_programas.sql` | `procedimentos`, `insumos_do_procedimento`, `programas`, `itens_do_programa`, ALTERs, RLS, trilha, semeadura |
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
-- apps/api/migrations/0010_programas.sql  (Task 4)
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

## Task 4: Migration 0009 — o catálogo, o programa, e a sessão que sabe de quem é

**Files:** `apps/api/migrations/0010_programas.sql` · `apps/api/src/banco/transacao.ts` · `teste/programas-banco.test.ts` · *(modificar)* `teste/registro.ts`

**Não edite nenhuma migration aplicada.** Confira `ls apps/api/migrations/` antes de criar o arquivo: a última aplicada hoje é a `0007_jornada.sql`, e o plano do épico 4 ainda anuncia um `0007_financeiro.sql` que colidiria. Se o épico 4 já entrou como `0008`, esta é a **`0009`**; se não entrou, use o próximo livre e **corrija o plano do épico 4**, nunca o contrário.

**As quatro decisões que esta migration fixa:**

1. **FK composta `(id, clinica_id)` em tudo.** A lição medida do épico 3 (nota 3 do relatório): a verificação de chave estrangeira roda pelo sistema e **atravessa a RLS**, então uma FK simples deixa o procedimento da clínica vizinha colar num programa daqui. Foi assim que a unidade de outra clínica colou num paciente no épico 2.
2. **Nenhum número derivado em `programas`** (decisão P-2). Sem `sessoes`, sem `saldo`, sem `valor_total`, sem nome.
3. **A dose nunca é gravada sem a unidade.** `insumo_qtd_milesimos` e `insumo_unidade` nascem e morrem juntos, por `CHECK` — "qtd sem unidade é a origem da dose errada" (`CONTEXT.md`).
4. **A numeração da sessão é única dentro do item.** Duas sessões `5/12` no mesmo item tornam a reprogramação ambígua, e o defeito só aparece quando a enfermagem vê duas aplicações no mesmo dia.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// teste/programas-banco.test.ts
it('procedimento de OUTRA clínica não cola num item — FK composta, não simples', async () => {
  // Com `REFERENCES procedimentos(id)` isto PASSA: a FK atravessa a RLS.
  await expect(cru(
    `INSERT INTO itens_do_programa (clinica_id, programa_id, chave, procedimento_id, ...)
     VALUES ($1, $2, 'i1', $3, ...)`, [CLINICA, PROGRAMA, PROC_DA_OUTRA],
  )).rejects.toThrow(/itens_procedimento_da_clinica/i)
})

it('paciente de OUTRA clínica não cola num programa', async () => { /* idem */ })

it('dose sem unidade é RECUSADA pelo banco', async () => {
  await expect(cru(
    `UPDATE itens_do_programa SET insumo_qtd_milesimos = 2500 WHERE id = $1`, [ITEM],
  )).rejects.toThrow(/insumo_tem_unidade/i)
})

it('sessão sem programa é recusada, e programa sem numeração também', async () => {
  await expect(inserirTarefaCrua({ tipo: 'Sessão de plano', programaId: null }))
    .rejects.toThrow(/sessao_e_do_programa/i)
  await expect(inserirTarefaCrua({ tipo: 'Follow-up', sessaoIndice: 3 }))
    .rejects.toThrow(/numeracao_so_em_sessao/i)
})

it('índice maior que o total é recusado', async () => {
  await expect(inserirSessaoCrua({ indice: 13, total: 12 })).rejects.toThrow(/sessao_e_do_programa/i)
})

it('DUAS sessões 5/12 no MESMO item são recusadas', async () => {
  await inserirSessaoCrua({ itemChave: 'i1', indice: 5, total: 12 })
  await expect(inserirSessaoCrua({ itemChave: 'i1', indice: 5, total: 12 }))
    .rejects.toThrow(/sessao_unica_no_item/i)
})

it('a mesma numeração em OUTRO item do mesmo programa é permitida', async () => {
  // "Aplicação 1/4 · 2,5 mg" e "Aplicação 1/4 · 5 mg" convivem: a numeração é
  // DENTRO do item.
  await expect(inserirSessaoCrua({ itemChave: 'i2', indice: 1, total: 4 })).resolves.toBeDefined()
})

it('sessão EXCLUÍDA libera a numeração', async () => { /* índice parcial em excluida_em */ })

it('`depois_de` não aponta para o próprio item', async () => {
  await expect(cru(`UPDATE itens_do_programa SET depois_de = chave WHERE id = $1`, [ITEM]))
    .rejects.toThrow(/item_nao_depende_de_si/i)
})

it('programa encerrado tem instante; ativo não tem', async () => { /* … */ })

it('TODA CLÍNICA NOVA NASCE COM OS CINCO MODELOS DO `Code.gs`', async () => {
  expect((await procedimentosDe(NOVA)).map((p) => [p.nome, p.sessoes_sugeridas, p.intervalo_sugerido_dias]))
    .toEqual([
      ['Tirzepatida', 12, 7], ['Semaglutida', 8, 7],
      ['Bioestimulador de colágeno', 3, 30], ['Toxina botulínica', 1, 7],
      ['Implante hormonal', 1, 7],
    ])
})

it('o nome do procedimento é único por clínica, ignorando acento e caixa', async () => {
  await expect(criarProcedimentoCru(CLINICA, 'tirzepatida')).rejects.toThrow(/procedimentos_nome_unico/i)
})

it('procedimento EXCLUÍDO libera o nome; DESATIVADO também', async () => { /* … */ })

it('as quatro tabelas têm RLS e trilha', async () => { /* auditoria-inescapavel varre o catálogo */ })

it('`recebimentos.programa_id` aceita NULL — o recebimento fora de programa continua', async () => { /* … */ })
```

- [ ] **Passo 2: Rodar e ver falhar** — `relation "procedimentos" does not exist`.

- [ ] **Passo 3: Escrever a migration**

```sql
-- 0010_programas.sql

-- ---------------------------------------------------------------------------
-- PRÉ-REQUISITO DAS FK COMPOSTAS.
--
-- A verificação de FK roda PELO SISTEMA e atravessa a RLS: com
-- `REFERENCES pacientes(id)`, o paciente da clínica vizinha cola num programa
-- daqui. Medido no épico 2 (commit d0d4bb0) e corrigido no épico 3 pela FK
-- composta. Aqui ela é a regra, não a exceção.
-- ---------------------------------------------------------------------------
ALTER TABLE pacientes ADD CONSTRAINT pacientes_id_clinica UNIQUE (id, clinica_id);
ALTER TABLE tarefas   ADD CONSTRAINT tarefas_id_clinica   UNIQUE (id, clinica_id);

-- ---------------------------------------------------------------------------
-- PROCEDIMENTOS — o CATÁLOGO da clínica (aba `Planos` da v20).
--
-- Nunca "plano": a aba se chama Planos, o campo se chama planoId, e os dois
-- significam coisas diferentes em telas diferentes. É a ambiguidade mais cara
-- do legado, e ela se paga aqui (CONTEXT.md).
-- ---------------------------------------------------------------------------
CREATE TABLE procedimentos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  nome_chave    text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,

  -- SUGERIDOS. Mudá-los NÃO toca em quem já está em tratamento (MANUAL
  -- cap. 11) — e é por isso que as sessões são materializadas (decisão P-1).
  sessoes_sugeridas        smallint NOT NULL CHECK (sessoes_sugeridas BETWEEN 1 AND 104),
  intervalo_sugerido_dias  smallint NOT NULL CHECK (intervalo_sugerido_dias BETWEEN 1 AND 180),
  rotulo_sessao            text NOT NULL DEFAULT 'Sessão' CHECK (length(rotulo_sessao) BETWEEN 1 AND 40),
  responsavel_id           uuid REFERENCES pessoas(id),

  -- Centavos, POR SESSÃO. Regra 1. É referência, não receita (regra 4).
  valor_por_sessao bigint CHECK (valor_por_sessao IS NULL OR valor_por_sessao > 0),

  -- REPETIÇÃO: de quanto em quanto tempo pode repetir, e quantos dias antes
  -- fazer o contato. `retorno_quantidade` nulo = não há contato de retorno.
  retorno_quantidade        smallint,
  retorno_unidade           text NOT NULL DEFAULT 'm' CHECK (retorno_unidade IN ('d','m')),
  retorno_antecedencia_dias smallint NOT NULL DEFAULT 15
                              CHECK (retorno_antecedencia_dias BETWEEN 0 AND 90),
  retorno_responsavel_id    uuid REFERENCES pessoas(id),

  -- BAIXA NO ESTOQUE: o insumo principal e a dose padrão. `item_id` é do
  -- épico 6 e AINDA NÃO TEM FK — a tabela `itens_de_estoque` não existe. A FK
  -- entra na migration do épico 6, por expand, e o teste de órfãos é de lá.
  insumo_padrao_id        uuid,
  insumo_padrao_milesimos bigint CHECK (insumo_padrao_milesimos IS NULL OR insumo_padrao_milesimos > 0),
  -- A UNIDADE em que a dose foi declarada. Sem ela, "2500" é mg, ampola ou
  -- UI conforme quem lê — e é assim que se aplica a dose errada (regra 10).
  insumo_padrao_unidade   text CHECK (insumo_padrao_unidade IS NULL OR length(insumo_padrao_unidade) BETWEEN 1 AND 20),

  ativo         boolean NOT NULL DEFAULT true,
  desativado_em timestamptz,
  excluido_em   timestamptz,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    uuid REFERENCES pessoas(id),

  CONSTRAINT desativado_tem_instante CHECK ((NOT ativo) = (desativado_em IS NOT NULL)),
  CONSTRAINT retorno_positivo CHECK (
    retorno_quantidade IS NULL OR (retorno_quantidade > 0 AND retorno_quantidade <=
      CASE retorno_unidade WHEN 'd' THEN 1825 ELSE 60 END)),
  -- A DOSE NUNCA ANDA SEM A UNIDADE.
  CONSTRAINT insumo_padrao_tem_unidade CHECK (
    (insumo_padrao_id IS NULL) = (insumo_padrao_milesimos IS NULL)
    AND (insumo_padrao_milesimos IS NULL) = (insumo_padrao_unidade IS NULL)),
  CONSTRAINT procedimentos_id_clinica UNIQUE (id, clinica_id)
);

CREATE UNIQUE INDEX procedimentos_nome_unico ON procedimentos (clinica_id, nome_chave)
  WHERE ativo AND excluido_em IS NULL;

-- ---------------------------------------------------------------------------
-- DESCARTÁVEIS DE TODA SESSÃO (seringa, agulha, equipo).
--
-- Tabela e não `jsonb`: o épico 6 vai perguntar "quais procedimentos usam
-- esta agulha" quando o fornecedor mudar a caixa, e a trilha de "quem mudou
-- a dose" é por linha.
-- ---------------------------------------------------------------------------
CREATE TABLE insumos_do_procedimento (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id      uuid NOT NULL REFERENCES clinicas(id),
  procedimento_id uuid NOT NULL,
  item_id         uuid NOT NULL,           -- épico 6, sem FK ainda
  milesimos       bigint NOT NULL CHECK (milesimos > 0),
  unidade         text NOT NULL CHECK (length(unidade) BETWEEN 1 AND 20),
  ordem           smallint NOT NULL DEFAULT 0,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insumos_procedimento_da_clinica
    FOREIGN KEY (procedimento_id, clinica_id) REFERENCES procedimentos (id, clinica_id),
  UNIQUE (procedimento_id, item_id)
);

-- ---------------------------------------------------------------------------
-- PROGRAMAS — o tratamento DE UMA PACIENTE (aba `Adesoes` da v20).
--
-- SEM NENHUM NÚMERO DERIVADO (decisão P-2). O legado guarda `sessoes` (a
-- soma), `plano` (os nomes concatenados), `intervaloDias` (o do primeiro
-- item) e `rotuloSessao`. Todos saem dos itens; guardá-los é criar um segundo
-- número para a mesma pergunta, e o segundo é o que fica errado.
-- ---------------------------------------------------------------------------
CREATE TABLE programas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  paciente_id uuid NOT NULL,
  inicio      date NOT NULL,

  -- `saldo`:  a adesão abriu valor em aberto; cada pagamento abate.
  -- `avulso`: cada sessão registra o que foi pago naquele dia.
  -- Os nomes são os do `Code.gs` e do protótipo, de propósito: eles estão
  -- gravados nas 4 clínicas e o migrador os copia sem traduzir (regra 28).
  modo_de_cobranca text NOT NULL DEFAULT 'avulso' CHECK (modo_de_cobranca IN ('avulso','saldo')),

  situacao            text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo','encerrado')),
  encerrado_em        timestamptz,
  motivo_encerramento text CHECK (motivo_encerramento IS NULL OR length(motivo_encerramento) <= 260),

  -- O cartão de orçamento que fechou e montou este programa. NULL quando o
  -- programa nasceu por `POST /v1/programas`.
  tarefa_de_origem_id uuid,
  unidade_id          uuid REFERENCES unidades(id),

  excluido_em timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  criado_por  uuid REFERENCES pessoas(id),

  CONSTRAINT programas_paciente_da_clinica
    FOREIGN KEY (paciente_id, clinica_id) REFERENCES pacientes (id, clinica_id),
  CONSTRAINT programas_origem_da_clinica
    FOREIGN KEY (tarefa_de_origem_id, clinica_id) REFERENCES tarefas (id, clinica_id),
  CONSTRAINT encerrado_tem_instante CHECK ((situacao = 'encerrado') = (encerrado_em IS NOT NULL)),
  CONSTRAINT programas_id_clinica UNIQUE (id, clinica_id)
);

CREATE INDEX programas_por_paciente ON programas (clinica_id, paciente_id)
  WHERE excluido_em IS NULL;
CREATE INDEX programas_ativos ON programas (clinica_id, situacao)
  WHERE situacao = 'ativo' AND excluido_em IS NULL;
-- Um orçamento fechado monta UM programa. Reenviar o `fechar` não monta o
-- segundo — e o `fechar` já é terminal, mas a defesa fica onde nenhum caminho
-- novo (job, migração, correção no psql) a contorna.
CREATE UNIQUE INDEX programa_por_origem ON programas (tarefa_de_origem_id)
  WHERE tarefa_de_origem_id IS NOT NULL AND excluido_em IS NULL;

-- ---------------------------------------------------------------------------
-- ITENS DO PROGRAMA — um procedimento, com sessões, intervalo, dose e início.
-- ---------------------------------------------------------------------------
CREATE TABLE itens_do_programa (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  programa_id uuid NOT NULL,
  chave       text NOT NULL CHECK (length(chave) BETWEEN 1 AND 20),

  procedimento_id uuid NOT NULL,
  -- O NOME NO INSTANTE DA MONTAGEM (a lição D-2 do épico 3). Renomear
  -- "Tirzepatida" para "Tirzepatida 5 mg" no catálogo NÃO pode reescrever a
  -- história de quem já está em tratamento. O id agrupa; o nome se lê.
  procedimento_nome text NOT NULL CHECK (length(procedimento_nome) BETWEEN 1 AND 80),
  rotulo_sessao     text NOT NULL CHECK (length(rotulo_sessao) BETWEEN 1 AND 40),

  sessoes        smallint NOT NULL CHECK (sessoes BETWEEN 1 AND 104),
  intervalo_dias smallint NOT NULL CHECK (intervalo_dias BETWEEN 1 AND 365),
  -- RESOLVIDO na montagem, nunca derivado em runtime. `depois_de` fica como
  -- registro de COMO foi montado — a reprogramação em cascata o usa.
  inicio         date NOT NULL,
  depois_de      text,

  responsavel_id uuid NOT NULL REFERENCES pessoas(id),
  dose           text NOT NULL DEFAULT '' CHECK (length(dose) <= 60),

  -- O insumo e a dose DESTA paciente, que sobrepõem o padrão do procedimento.
  -- Dado de saúde (regra 18): nunca em log.
  insumo_id        uuid,
  insumo_milesimos bigint CHECK (insumo_milesimos IS NULL OR insumo_milesimos > 0),
  insumo_unidade   text CHECK (insumo_unidade IS NULL OR length(insumo_unidade) BETWEEN 1 AND 20),

  -- O que ESTE item vale, em centavos. A soma dos itens é o total negociado,
  -- EXATAMENTE (Task 2). Preço, não receita: não entra em LTV nem em meta.
  valor bigint CHECK (valor IS NULL OR valor >= 0),
  ordem smallint NOT NULL DEFAULT 0,

  criado_em timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT itens_programa_da_clinica
    FOREIGN KEY (programa_id, clinica_id) REFERENCES programas (id, clinica_id),
  CONSTRAINT itens_procedimento_da_clinica
    FOREIGN KEY (procedimento_id, clinica_id) REFERENCES procedimentos (id, clinica_id),
  CONSTRAINT item_nao_depende_de_si CHECK (depois_de IS NULL OR depois_de <> chave),
  CONSTRAINT insumo_tem_unidade CHECK (
    (insumo_id IS NULL) = (insumo_milesimos IS NULL)
    AND (insumo_milesimos IS NULL) = (insumo_unidade IS NULL)),
  UNIQUE (programa_id, chave)
);

-- ---------------------------------------------------------------------------
-- A SESSÃO É UMA TAREFA (decisão P-1).
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas
  ADD COLUMN programa_id     uuid,
  ADD COLUMN item_chave      text CHECK (item_chave IS NULL OR length(item_chave) BETWEEN 1 AND 20),
  ADD COLUMN sessao_indice   smallint,
  ADD COLUMN sessao_total    smallint,
  -- "Qual procedimento?" na tarefa avulsa de Procedimento realizado. O épico
  -- 6 dá baixa dos insumos padrão por este campo (MANUAL cap. 8).
  ADD COLUMN procedimento_id uuid;

ALTER TABLE tarefas ADD CONSTRAINT tarefas_programa_da_clinica
  FOREIGN KEY (programa_id, clinica_id) REFERENCES programas (id, clinica_id);
ALTER TABLE tarefas ADD CONSTRAINT tarefas_procedimento_da_clinica
  FOREIGN KEY (procedimento_id, clinica_id) REFERENCES procedimentos (id, clinica_id);

-- Toda sessão é de um item de um programa, e é numerada.
ALTER TABLE tarefas ADD CONSTRAINT sessao_e_do_programa CHECK (
  tipo <> 'Sessão de plano' OR (
    programa_id IS NOT NULL AND item_chave IS NOT NULL
    AND sessao_indice IS NOT NULL AND sessao_total IS NOT NULL
    AND sessao_indice BETWEEN 1 AND sessao_total));

-- E só sessão é numerada: um Follow-up com `sessao_indice` é dado que nenhuma
-- consulta sabe ler, e que só se descobre quando a conta não bate.
ALTER TABLE tarefas ADD CONSTRAINT numeracao_so_em_sessao CHECK (
  tipo = 'Sessão de plano'
  OR (sessao_indice IS NULL AND sessao_total IS NULL));

-- `item_chave` também aparece no CONTATO DE RETORNO (ele é de um item), então
-- não se amarra a `tipo`; amarra-se ao programa.
ALTER TABLE tarefas ADD CONSTRAINT item_chave_tem_programa CHECK (
  item_chave IS NULL OR programa_id IS NOT NULL);

-- DUAS SESSÕES 5/12 NO MESMO ITEM tornam a reprogramação ambígua: ela usa o
-- índice para saber o que vem depois. Parcial em `excluida_em` para que a
-- sessão excluída libere o número.
CREATE UNIQUE INDEX sessao_unica_no_item
  ON tarefas (programa_id, item_chave, sessao_indice)
  WHERE tipo = 'Sessão de plano' AND excluida_em IS NULL;

CREATE INDEX tarefas_do_programa ON tarefas (clinica_id, programa_id, prazo)
  WHERE programa_id IS NOT NULL AND excluida_em IS NULL;
-- A agenda da enfermagem: sessões abertas, da mais atrasada para a frente.
CREATE INDEX sessoes_abertas ON tarefas (clinica_id, prazo, responsavel_id)
  WHERE tipo = 'Sessão de plano' AND status = 'aberta' AND excluida_em IS NULL;

-- ---------------------------------------------------------------------------
-- O RECEBIMENTO SABE DE QUE PROGRAMA É.
--
-- É só isto que falta para o agrupamento do épico 4 deixar de ser um grupo
-- só. O contrato e a função `saldoEmAberto` NÃO MUDAM — o `SELECT` do
-- repositório passa a projetar a coluna no lugar de `NULL`.
-- ---------------------------------------------------------------------------
ALTER TABLE recebimentos ADD COLUMN programa_id uuid;
ALTER TABLE recebimentos ADD CONSTRAINT recebimentos_programa_da_clinica
  FOREIGN KEY (programa_id, clinica_id) REFERENCES programas (id, clinica_id);
CREATE INDEX recebimentos_por_programa ON recebimentos (clinica_id, programa_id)
  WHERE programa_id IS NOT NULL AND estornado_em IS NULL;

-- ---------------------------------------------------------------------------
-- RLS e trilha nas quatro tabelas novas.
-- ---------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['procedimentos','insumos_do_procedimento','programas','itens_do_programa'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_por_clinica ON %I USING (clinica_id = app_clinica_id()) '
                   'WITH CHECK (clinica_id = app_clinica_id())', t, t);
    EXECUTE format('CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I '
                   'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- OS CINCO MODELOS, por TRIGGER em `clinicas` — não por TypeScript.
--
-- A lição medida do épico 3: não existe rota que crie clínica. Os testes, a
-- semente e o épico 9 criam clínica por INSERT cru, e uma semeadura em
-- TypeScript deixaria todas elas com o catálogo vazio. `SECURITY DEFINER`,
-- para que a clínica criada por `fir_app` não seja recusada pela própria
-- policy de `procedimentos`.
--
-- Nomes, sessões, intervalo, rótulo, retorno e antecedência vêm de
-- `MODELOS_PLANOS` (Code.gs:90). NÃO INVENTE OUTROS: é o catálogo que as 4
-- clínicas receberam, e o migrador do épico 9 reconcilia por `nome_chave`.
-- ---------------------------------------------------------------------------
CREATE FUNCTION semear_procedimentos() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO procedimentos (clinica_id, nome, sessoes_sugeridas, intervalo_sugerido_dias,
                             rotulo_sessao, retorno_quantidade, retorno_unidade,
                             retorno_antecedencia_dias)
  VALUES
    (NEW.id, 'Tirzepatida',                12,  7, 'Aplicação',   NULL, 'm', 15),
    (NEW.id, 'Semaglutida',                 8,  7, 'Aplicação',   NULL, 'm', 15),
    (NEW.id, 'Bioestimulador de colágeno',  3, 30, 'Sessão',        12, 'm', 30),
    (NEW.id, 'Toxina botulínica',           1,  7, 'Aplicação',      4, 'm', 15),
    (NEW.id, 'Implante hormonal',           1,  7, 'Procedimento',   6, 'm', 20);
  RETURN NEW;
END $$;

CREATE TRIGGER clinicas_semeia_procedimentos AFTER INSERT ON clinicas
  FOR EACH ROW EXECUTE FUNCTION semear_procedimentos();

-- E as clínicas que já existem neste banco.
INSERT INTO procedimentos (…) SELECT … FROM clinicas c WHERE NOT EXISTS (…);
```

- [ ] **Passo 4: O arquivo do tipo da transação**

```ts
// apps/api/src/banco/transacao.ts
import type pg from 'pg'
/**
 * O que `BancoService.naClinica` entrega ao callback.
 *
 * Existe como alias porque os DOIS seams deste épico — `MontadorDePrograma` e
 * `BaixaDeInsumos` — recebem a transação de quem chama, e "a atomicidade é de
 * quem chama" é mais fácil de ler em `montar(tx: Transacao, …)` do que em
 * `montar(c: pg.PoolClient, …)`.
 */
export type Transacao = pg.PoolClient
```

- [ ] **Passo 5: Aplicar e rodar** — `cd apps/api && npx tsx migrar.ts`, depois `cd teste && npx vitest run programas-banco` → PASS. Rode a suíte inteira: nada do épico 2, 3 ou 4 pode ficar vermelho, e as duas `UNIQUE` novas em `pacientes` e `tarefas` são o ponto onde isso acontece.

- [ ] **Passo 6: Registrar** — as quatro tabelas em `ENTIDADES_COM_CLINICA` (`teste/registro.ts`). `auditoria-inescapavel.test.ts` varre o catálogo e reprova tabela com `clinica_id` sem trigger — rode e veja passar.

- [ ] **Passo 7: Prova por mutação** — troque `itens_procedimento_da_clinica` pela FK simples `REFERENCES procedimentos(id)`, reaplique num banco limpo (`fir reset`) e rode: o teste *"procedimento de OUTRA clínica não cola num item"* tem de falhar. Restaure. **É esta mutação que separa "escrevi uma FK" de "o banco recusa a linha errada".**

- [ ] **Passo 8: Segunda mutação** — remova o índice `sessao_unica_no_item`. O teste das duas `5/12` tem de falhar. Restaure.

- [ ] **Passo 9: Nota de migração** — escreva, no cabeçalho da migration, que **o migrador do épico 9 reconcilia o catálogo por `nome_chave`**: as 4 clínicas já receberam estes cinco modelos (editados), e um `INSERT` cego colidiria com `procedimentos_nome_unico`. Reconciliar, não inserir.

- [ ] **Passo 10: Commit**

---

## Task 5: Os contratos — e o início que o orçamento não tinha

**Files:** `packages/contracts/src/programas.ts` · `programas.test.ts` · *(modificar)* `packages/contracts/src/jornada.ts` · `index.ts`

**O buraco que esta tarefa fecha:** o `ItemOrcado` do épico 3 tem `sessoes`, `intervaloDias`, `dose`, `responsavelId`, `valor`, `chave` e `depoisDe` — **e nenhuma data**. Quem não tem `depoisDe` começa no início do programa; mas **qual** é o início do programa não está na proposta. Então `fechar` ganha `inicioDoPrograma`, opcional, com padrão **hoje da clínica, calculado no servidor** (regra 24).

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// packages/contracts/src/programas.test.ts
it('procedimento sem nome é recusado pelo PARSE', () => {
  expect(SalvarProcedimento.safeParse({ ...BASE, nome: '  ' }).success).toBe(false)
})

it('sessões fora de 1..104 e intervalo fora de 1..180 são recusados', () => {
  // Os limites são os do `Code.gs` E do protótipo — eles concordam.
  expect(SalvarProcedimento.safeParse({ ...BASE, sessoesSugeridas: 105 }).success).toBe(false)
  expect(SalvarProcedimento.safeParse({ ...BASE, intervaloSugeridoDias: 181 }).success).toBe(false)
})

it('retorno em MESES vai até 60; em DIAS até 1825', () => {
  expect(SalvarProcedimento.safeParse({ ...BASE, retorno: { quantidade: 61, unidade: 'm' } }).success).toBe(false)
  expect(SalvarProcedimento.safeParse({ ...BASE, retorno: { quantidade: 1825, unidade: 'd' } }).success).toBe(true)
})

it('A DOSE NÃO ATRAVESSA SEM A UNIDADE', () => {
  // Regra 10: `qtd` sem unidade é a origem da dose errada. Aqui ela nem compila.
  expect(SalvarProcedimento.safeParse({ ...BASE, insumoPadrao: { itemId: ID, quantidade: '2,5' } }).success)
    .toBe(false)
  expect(SalvarProcedimento.safeParse({
    ...BASE, insumoPadrao: { itemId: ID, quantidade: '2,5', unidade: 'mg' },
  }).success).toBe(true)
})

it('a dose chega em MILÉSIMOS inteiros, nunca float', () => {
  const r = SalvarProcedimento.parse({ ...BASE, insumoPadrao: { itemId: ID, quantidade: '0,25', unidade: 'ampola' } })
  expect(r.insumoPadrao!.quantidade.milesimos).toBe(250n)
})

it('o valor por sessão chega em centavos', () => {
  expect(SalvarProcedimento.parse({ ...BASE, valorPorSessao: '30000' }).valorPorSessao!.centavos).toBe(30000n)
})

it('montar programa com 13 itens é recusado — o limite é 12', () => {
  expect(MontarPrograma.safeParse({ ...BASE, itens: Array(13).fill(ITEM) }).success).toBe(false)
})

it('`depoisDe` apontando para item que não existe é recusado', () => { /* o mesmo superRefine do épico 3 */ })

it('chave repetida é recusada', () => { /* … */ })

it('o valor total e a entrada chegam em centavos, e entrada > total é recusada', () => {
  expect(MontarPrograma.safeParse({ ...BASE, valorTotal: '100000', valorEntrada: '150000' }).success)
    .toBe(false)
})

it('concluir sessão EXIGE dizer o que fazer com as próximas', () => {
  // Um padrão silencioso aqui move a agenda de doze aplicações sem ninguém
  // ter pedido. O protótipo pergunta; aqui o parse cobra.
  expect(ConcluirSessao.safeParse({ em: '2026-11-13' }).success).toBe(false)
  expect(ConcluirSessao.safeParse({ em: '2026-11-13', reprogramar: true }).success).toBe(true)
})

it('encerrar programa exige motivo', () => {
  expect(EncerrarPrograma.safeParse({}).success).toBe(false)
})

it('`fechar` aceita o início do programa, e ele é opcional', () => {
  expect(MoverEtapa.parse({ acao: 'fechar', recebimento: R, inicioDoPrograma: '2026-11-02' })
    .inicioDoPrograma).toBe('2026-11-02')
  expect(MoverEtapa.safeParse({ acao: 'fechar', recebimento: R }).success).toBe(true)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar**

```ts
// packages/contracts/src/programas.ts
import { z } from 'zod'
import { DiaCivil, dinheiroEmTexto, Hora, Uuid } from './comum'

/**
 * A DOSE NUNCA ATRAVESSA SEM A UNIDADE.
 *
 * `quantidadeEmTexto` devolve `Quantidade` — inteiro em milésimos, com a
 * unidade dentro do tipo. O protótipo manda `insumoQtd: 2.5` e descobre a
 * unidade lendo o item; aqui a combinação "número solto perto de dose" não
 * tem como ser escrita (regra 10, CONTEXT.md).
 */
const Insumo = z.object({
  itemId: Uuid,
  quantidade: quantidadeEmTexto,
  unidade: z.string().trim().min(1).max(20),
}).strict()

export const SalvarProcedimento = z.object({
  nome: z.string().trim().min(1).max(80),
  sessoesSugeridas: z.number().int().min(1).max(104),
  intervaloSugeridoDias: z.number().int().min(1).max(180),
  rotuloSessao: z.string().trim().min(1).max(40).default('Sessão'),
  responsavelId: Uuid.nullish(),
  valorPorSessao: dinheiroEmTexto.optional(),
  retorno: z.discriminatedUnion('unidade', [
    z.object({ unidade: z.literal('m'), quantidade: z.number().int().min(1).max(60) }),
    z.object({ unidade: z.literal('d'), quantidade: z.number().int().min(1).max(1825) }),
  ]).extend({
    antecedenciaDias: z.number().int().min(0).max(90).default(15),
    responsavelId: Uuid.nullish(),
  }).optional(),
  insumoPadrao: Insumo.optional(),
  descartaveis: z.array(Insumo).max(10).default([]),
  ativo: z.boolean().default(true),
}).strict()

/**
 * O MONTADOR — o mesmo corpo em três entradas: `Programas › Nova adesão`,
 * `Recebimento › Procedimento ou programa novo` e o `programa` do orçamento.
 *
 * `itens` aceita 12 (o limite de `criarAdesao`); a PROPOSTA do épico 3 aceita
 * 10. A proposta é subconjunto da montagem, então nenhum caminho quebra.
 */
export const MontarPrograma = z.object({
  pacienteId: Uuid,
  inicio: DiaCivil,
  hora: Hora.optional(),
  unidadeId: Uuid.nullish(),
  campanhaId: Uuid.nullish(),
  itens: z.array(ItemDoPrograma).min(1).max(12).superRefine(fechaOEncadeamento),
  // O pagamento da adesão. Ausente = programa sem total (cada sessão registra
  // o que foi pago no dia). `valorEntrada > valorTotal` é recusado aqui.
  pagamento: z.object({
    valorTotal: dinheiroEmTexto,
    valorEntrada: dinheiroEmTexto.default(0n),
    forma: z.enum(FORMAS),
  }).strict().refine((p) => p.valorEntrada <= p.valorTotal,
    { message: 'O valor pago não pode ser maior que o total.' }).optional(),
}).strict()

/**
 * CONCLUIR UMA SESSÃO NÃO É CONCLUIR UMA TAREFA.
 *
 * `reprogramar` é OBRIGATÓRIO: a tela pergunta "as próximas seguem a partir
 * desta data" ou "mantêm as datas originais", e um padrão silencioso aqui
 * move doze aplicações sem ninguém ter pedido.
 */
export const ConcluirSessao = z.object({
  em: DiaCivil,
  reprogramar: z.boolean(),
  obs: z.string().trim().max(300).default(''),
  pagamento: PagamentoEmbutido.optional(),   // o MESMO schema do épico 2
}).strict()

export const EncerrarPrograma = z.object({
  motivo: z.string().trim().min(1).max(60),
  obs: z.string().trim().max(200).optional(),
}).strict()
```

E, em `packages/contracts/src/jornada.ts`, o ramo `fechar` ganha **um campo**:

```ts
z.object({
  acao: z.literal('fechar'),
  recebimento: PagamentoEmbutido,
  /**
   * O início do programa, quando a proposta tiver um.
   *
   * `ItemOrcado` não tem data — só `depoisDe`. Quem não depende de ninguém
   * começa no início do programa, e o início vem daqui. Opcional: o padrão é
   * HOJE DA CLÍNICA, calculado no servidor (regra 24).
   */
  inicioDoPrograma: DiaCivil.optional(),
  nota: Nota,
}).strict(),
```

- [ ] **Passo 4: PASS.** Exporte de `index.ts`. Os testes do épico 3 continuam verdes — `.strict()` com campo opcional novo não quebra nenhum corpo antigo; **rode-os para ver**.

- [ ] **Passo 5: Commit**

---

## Task 6: O catálogo de procedimentos

**Files:** `apps/api/src/programas/catalogo.controller.ts` · `catalogo.service.ts` · `programas.module.ts` · `catalogo.e2e.test.ts`

```
GET    /v1/procedimentos         @Exige('programas')     — a montagem precisa da lista
POST   /v1/procedimentos         @Exige('config')
PATCH  /v1/procedimentos/:id     @Exige('config')
DELETE /v1/procedimentos/:id     @Exige('config')        — soft delete, com DUAS recusas
```

**A leitura é `programas`, a escrita é `config`** — porque quem monta o programa precisa ver o catálogo, e quem edita o catálogo está mexendo numa configuração da clínica. É a divisão que o protótipo já faz (`VIEW_PERM.catalogo = 'config'`, e a lista chega pelo `carregar`).

**A exclusão tem DUAS recusas, e a segunda é o buraco que o épico 3 deixou.** O protótipo e o `Code.gs` conferem só as adesões. Uma **proposta viva** (`tarefas.programa_orcado`) também aponta para o procedimento, e excluí-lo transforma o `fechar` daquele orçamento em 409 — a paciente aceitou, a recepção não consegue fechar, e o motivo está escondido num `jsonb`.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('a lista traz só os NÃO EXCLUÍDOS, com os inativos marcados', async () => {
  const r = await listar()
  expect(r.map((p) => p.nome)).toContain('Tirzepatida')
  expect(r.find((p) => p.id === EXCLUIDO)).toBeUndefined()
  expect(r.find((p) => p.id === INATIVO)!.ativo).toBe(false)
})

it('a lista traz quantos PACIENTES ATIVOS cada procedimento tem — calculado no servidor', async () => {
  // "1 paciente ativo" é o que a tela mostra (medido no protótipo). Contar no
  // front exigiria baixar todos os programas da clínica para desenhar uma
  // lista de sete linhas.
  expect((await listar()).find((p) => p.id === TIRZE)!.pacientesAtivos).toBe(1)
})

it('nome repetido, só acento diferente, é 409 com a mensagem dela', async () => {
  expect((await criar({ nome: 'tirzepatida' })).statusCode).toBe(409)
})

it('sem `config`, criar é 403 — mas LISTAR com `programas` é 200', async () => {
  expect((await criar({ nome: 'X' }, cookieDe(ENFERMAGEM))).statusCode).toBe(403)
  expect((await pedir('/v1/procedimentos', cookieDe(ENFERMAGEM))).statusCode).toBe(200)
})

it('sem `valores`, o valor por sessão vem null e o resto fica', async () => {
  const p = (await listar(cookieDe(SEM_VALORES))).find((x) => x.id === TIRZE)!
  expect(p.valorPorSessao).toBeNull()
  expect(p.sessoesSugeridas).toBe(12)
})

// ── EXCLUIR ─────────────────────────────────────────────────────────────────
it('excluir é SOFT DELETE: some da lista, e o item do programa continua inteiro', async () => {
  await excluir(SEM_USO)
  expect(await existeNoBanco('procedimentos', SEM_USO)).toBe(true)
})

it('procedimento COM PROGRAMA é 409, com a contagem na mensagem', async () => {
  const r = await excluir(TIRZE)
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('1 programa')
  expect(r.json().message).toContain('Ativo')      // a saída que ela já conhece
})

it('procedimento COM PROPOSTA VIVA é 409 — o buraco que o épico 3 deixou', async () => {
  // `tarefas.programa_orcado` aponta para o procedimento, e o cartão está em
  // `orcamento`. Excluir aqui faria o `fechar` daquele cartão virar 409 com o
  // motivo escondido num jsonb.
  await mover(REALIZADO, { acao: 'registrarOrcamento', valor: '360000',
    programa: [{ procedimentoId: NOVO, sessoes: 4, intervaloDias: 7, chave: 'i1' }] })
  const r = await excluir(NOVO)
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('orçamento')
})

it('proposta de cartão PERDIDO ou FECHADO não impede a exclusão', async () => {
  // Só a proposta VIVA (etapa `orcamento`) importa: ela ainda pode fechar.
})

it('DESATIVAR um procedimento em uso é permitido — é a saída que o MANUAL dá', async () => {
  expect((await editar(TIRZE, { ativo: false })).statusCode).toBe(200)
})

it('editar sessões e intervalo NÃO TOCA em quem já está em tratamento', async () => {
  // MANUAL cap. 11, e é a frase que a decisão P-1 torna verdadeira sem código.
  const antes = await sessoesDoPrograma(PROG)
  await editar(TIRZE, { sessoesSugeridas: 4 })
  expect(await sessoesDoPrograma(PROG)).toEqual(antes)
})

it('renomear o procedimento NÃO reescreve o nome no programa de quem já começou', async () => {
  await editar(TIRZE, { nome: 'Tirzepatida 5 mg' })
  expect((await programa(PROG)).itens[0]!.procedimentoNome).toBe('Tirzepatida')
})

it('nenhum log contém o nome do procedimento nem a dose', async () => { /* regra 18/21 */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — a recusa de nome repetido **vem do banco** (`23505` em `procedimentos_nome_unico`), nunca de um `SELECT` antes: ler-depois-escrever perde a corrida entre duas pessoas cadastrando o mesmo procedimento.

As duas recusas da exclusão saem de **uma consulta só**, dentro da transação:

```sql
SELECT
  (SELECT count(*) FROM itens_do_programa i
     JOIN programas p ON p.id = i.programa_id AND p.excluido_em IS NULL
    WHERE i.procedimento_id = $1)                                        AS programas,
  (SELECT count(*) FROM tarefas t
     CROSS JOIN LATERAL jsonb_array_elements(t.programa_orcado) it
    WHERE t.etapa = 'orcamento' AND t.excluida_em IS NULL
      AND it->>'procedimentoId' = $1::text)                              AS propostas
```

Dois `SELECT` separados são duas janelas, e entre elas cabe um orçamento novo.

**Nada de `registrar()`** — o trigger da `0009` já gravou.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Registrar as rotas** em `teste/registro.ts`. `GET /v1/procedimentos` devolve `valorPorSessao` → entra em `ROTAS_COM_DINHEIRO` com esse campo.

- [ ] **Passo 6: Prova por mutação** — remova a segunda recusa (a das propostas). O teste do buraco do épico 3 tem de falhar. Restaure.

- [ ] **Passo 7: Commit**

---

## Task 7: O `MontadorDePrograma` — a porta que o épico 3 declarou

**Files:** `apps/api/src/programas/montador-de-programa.ts` · `montador.service.ts` · `programas.controller.ts` · `programas.service.ts` · `programas.module.ts` · `montador.test.ts`

```
POST /v1/programas     @Exige('programas')   (+ `receber` no serviço, quando há dinheiro)
```

**Esta tarefa fecha metade da dívida do épico 3.** O relatório dele (nota 11) diz: *"`fechar` devolve 501. Task 7 não é deste escopo."* E a nota 12: *"`procedimentoId` da proposta não é validado contra nada — a tabela não existe. Quem fizer o épico 5 precisa validar na montagem."* As duas chegam aqui.

**A classe abstrata muda de casa.** O épico 3 a anunciou em `apps/api/src/jornada/montador-de-programa.ts`; ela nasce em `apps/api/src/programas/`. O seam pertence ao módulo que possui o conceito, e `jornada → programas` é a dependência que o **dado** já tem (`tarefas.programa_orcado` guarda `procedimentoId` desde o épico 3). O inverso seria ciclo de módulo.

**A assinatura do épico 3 era insuficiente, e isto é parte da entrega.** Ele declarou `montar(tx, dados: ProgramaOrcado)`. `ProgramaOrcado` é só a lista de itens: não diz de que **paciente** é, de que **clínica**, qual o **início**, quem é o **ator**, qual o **recebimento** que precisa receber `programa_id`, nem qual é a **data de negócio do servidor**. Montar com `new Date()` dentro do montador quebraria a regra 24 em silêncio. A assinatura nova está na seção **Interfaces**; o conserto é de **uma linha** no único lugar que a chama, que é o `fechamento.service.ts` da Task 8 — e esse arquivo ainda não existe.

**Duas entradas, um montador:** `POST /v1/programas` (Nova adesão) e o `fechar` da Task 8. Se a montagem fosse escrita duas vezes, a segunda seria a que esquece de cancelar os contatos de retorno — e a paciente que acabou de refazer o procedimento receberia a ligação de "você já pode repetir".

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// apps/api/src/programas/montador.test.ts
it('monta as sessões como TAREFAS, numeradas dentro do item', async () => {
  const p = (await montar({
    pacienteId: ANA, inicio: '2026-11-02',
    itens: [{ chave: 'i1', procedimentoId: TIRZE, sessoes: 4, intervaloDias: 7, dose: '2,5 mg' }],
  })).json()
  const s = await sessoesDe(p.id)
  expect(s).toHaveLength(4)
  expect(s.map((x) => x.prazo)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'])
  expect(s[0]).toMatchObject({ tipo: 'Sessão de plano', sessaoIndice: 1, sessaoTotal: 4, itemChave: 'i1' })
})

it('a descrição da sessão é o rótulo do item, com a dose — o que a enfermagem lê', async () => {
  expect((await sessoesDe(P))[0]!.descricao).toBe('Aplicação 1/4 · Tirzepatida 2,5 mg')
})

it('A ESCALADA DE DOSE em duas linhas, com a segunda começando depois da primeira', async () => {
  const p = (await montar({ ...BASE, itens: [
    { chave: 'i1', procedimentoId: TIRZE, sessoes: 4, intervaloDias: 7, dose: '2,5 mg' },
    { chave: 'i2', procedimentoId: TIRZE, sessoes: 4, intervaloDias: 7, dose: '5 mg', depoisDe: 'i1' },
  ] })).json()
  expect((await sessoesDe(p.id)).map((s) => s.prazo)).toEqual([
    '2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23',
    '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21',
  ])
})

it('A MONTAGEM É UMA TRANSAÇÃO: ou tudo, ou nada', async () => {
  // Forçar falha na 7ª sessão de 8 e conferir que não há programa, não há
  // item e não há tarefa nenhuma.
  await comFalhaNaSessao(7, async () => {
    expect((await montar(COM_8_SESSOES)).statusCode).toBe(500)
  })
  expect(await contarProgramasDe(ANA)).toBe(0)
  expect(await contarSessoesDe(ANA)).toBe(0)
})

it('O NOME DO PROCEDIMENTO É CONGELADO no item — D-2 do épico 3, aplicada aqui', async () => {
  const p = (await montar(BASE)).json()
  await renomearProcedimento(TIRZE, 'Tirzepatida 5 mg')
  expect((await programa(p.id)).itens[0]!.procedimentoNome).toBe('Tirzepatida')
})

it('procedimento EXCLUÍDO é 409, com o item nomeado, e NADA foi escrito', async () => {
  await excluirProcedimento(NOVO)
  const r = await montar({ ...BASE, itens: [{ chave: 'i1', procedimentoId: NOVO, ... }] })
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('item 1')
  expect(await contarProgramasDe(ANA)).toBe(0)
})

it('procedimento DESATIVADO MONTA — desativar é "não oferecer em novas", não "anular"', async () => {
  // Decisão P-7. O orçamento foi feito quando o procedimento estava ativo; a
  // clínica só parou de oferecê-lo. Recusar aqui faria a paciente que já
  // aceitou ficar sem programa.
  await editarProcedimento(TIRZE, { ativo: false })
  expect((await montar(BASE)).statusCode).toBe(201)
})

it('procedimento de OUTRA clínica é 400 — e nem com o id na mão', async () => { /* RLS + FK composta */ })

it('responsável INATIVO é recusado; sem responsável, cai no padrão do procedimento', async () => {
  // `Code.gs:355` exige `u.ativo`. Tarefa atribuída a quem saiu da clínica
  // não aparece no "Para mim" de ninguém.
  expect((await montar({ ...BASE, itens: [{ ...ITEM, responsavelId: QUEM_SAIU }] })).statusCode).toBe(400)
  const p = (await montar({ ...BASE, itens: [{ ...ITEM, responsavelId: null }] })).json()
  expect((await programa(p.id)).itens[0]!.responsavelId).toBe(RESPONSAVEL_PADRAO_DO_PROC)
})

it('CICLO em `depoisDe` é 400, com os itens nomeados', async () => { /* Task 1, pela rota */ })

// ── O DINHEIRO ──────────────────────────────────────────────────────────────
it('o pagamento da adesão cria UM recebimento, com o `programa_id` preenchido', async () => {
  const p = (await montar({ ...BASE, pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' } })).json()
  const r = await recebimentosDe(p.id)
  expect(r).toHaveLength(1)
  expect(r[0]).toMatchObject({ valor: '120000', valorAberto: '240000', programaId: p.id })
  expect(await receitaDoDia()).toBe(120000n)      // A ENTRADA, não o total
})

it('O SALDO DO ÉPICO 4 PASSA A AGRUPAR POR PROGRAMA — era um grupo só', async () => {
  const p = (await montar({ ...BASE, pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' } })).json()
  const s = await saldoDe(ANA)
  expect(s.grupos.map((g) => g.programaId)).toContain(p.id)
  expect(s.grupos.find((g) => g.programaId === p.id)!.saldo).toBe('240000')
})

it('`modoDeCobranca` é `saldo` quando sobrou valor em aberto, `avulso` quando não', async () => {
  expect((await montar({ ...BASE, pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' } }))
    .json().modoDeCobranca).toBe('saldo')
  expect((await montar({ ...BASE, pagamento: { valorTotal: '360000', valorEntrada: '360000', forma: 'Pix' } }))
    .json().modoDeCobranca).toBe('avulso')
  expect((await montar(BASE)).json().modoDeCobranca).toBe('avulso')   // sem pagamento
})

it('O TOTAL É RATEADO ENTRE OS ITENS, e a soma bate EXATAMENTE', async () => {
  const p = (await montar({ ...BASE, itens: [TIRZE_12, DRENAGEM_3],
    pagamento: { valorTotal: '360001', valorEntrada: '0', forma: 'Pix' } })).json()
  const itens = (await programa(p.id)).itens
  expect(somar(itens.map((i) => i.valor))).toBe('360001')
})

it('item com valor PRÓPRIO não é rateado; o resto do total é', async () => { /* … */ })

it('SEM `receber`, o corpo COM dinheiro é 403 — e nada foi escrito', async () => {
  // Decisão: a rota que cria dinheiro é gated. A enfermagem monta o programa
  // sem valor, e o pagamento vai pela tela Recebimentos.
  const r = await montar({ ...BASE, pagamento: PAG }, cookieDe(ENFERMAGEM))
  expect(r.statusCode).toBe(403)
  expect(r.json().message).toContain('Recebimentos')
  expect(await contarProgramasDe(ANA)).toBe(0)
})

it('SEM `receber`, o corpo SEM dinheiro é 201 — a enfermagem monta', async () => {
  expect((await montar(BASE, cookieDe(ENFERMAGEM))).statusCode).toBe(201)
})

it('sem `programas`, 403', async () => { /* … */ })

// ── CONTATOS DE RETORNO ─────────────────────────────────────────────────────
it('montar CANCELA os contatos de retorno abertos do MESMO procedimento', async () => {
  // "Paciente refez o procedimento". Sem isso, a paciente que acabou de
  // aderir recebe a ligação de "você já pode repetir".
  const p = (await montar(BASE)).json()
  expect((await buscar(RETORNO_ABERTO_DE_TIRZE)).status).toBe('cancelada')
  expect((await buscar(RETORNO_ABERTO_DE_TIRZE)).obs).toBe('Paciente refez o procedimento')
  expect(p.retornosCancelados).toContain(RETORNO_ABERTO_DE_TIRZE)
})

it('o retorno de OUTRO procedimento, e o de outra paciente, continuam abertos', async () => { /* … */ })

// ── O QUE A SESSÃO NÃO É ────────────────────────────────────────────────────
it('A SESSÃO NÃO ENTRA NA JORNADA: `etapa` é NULL e o funil não a conta', async () => {
  // `TIPOS_REALIZADOS` do épico 2 já exclui `Sessão de plano`. Contá-la faria
  // doze aplicações de uma paciente virarem doze atendimentos no denominador
  // da conversão do funil.
  expect((await sessoesDe(P))[0]!.etapa).toBeNull()
  const antes = await funil()
  await concluirSessao(S1, { em: hojeDaClinica(), reprogramar: false })
  expect((await funil()).realizados.n).toBe(antes.realizados.n)
})

it('nenhum log contém a dose, o nome do procedimento nem o da paciente', async () => {
  const linhas = await capturarConsole(() => montar({ ...BASE, itens: [{ ...ITEM, dose: '2,5 mg' }] }))
  expect(linhas.join('\n')).not.toMatch(/2,5 mg|Tirzepatida|Ana Lúcia/)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar — e declarar as duas costuras**

O arquivo `montador-de-programa.ts` carrega **só os tipos e a classe abstrata** (ver **Interfaces**). A implementação vive em `montador.service.ts`:

```ts
@Injectable()
export class MontadorRelacional extends MontadorDePrograma {
  async montar(tx: Transacao, p: PedidoDeMontagem): Promise<Result<ProgramaMontado>> {
    // 1. Resolver o catálogo DENTRO da transação, com a RLS ativa.
    //    `SELECT … FROM procedimentos WHERE id = ANY($1) AND excluido_em IS NULL`.
    //    Faltou algum -> PROCEDIMENTO_FORA_DO_CATALOGO, com o número do item.
    //    INATIVO PASSA (decisão P-7).
    // 2. Resolver os responsáveis (ativos), caindo no padrão do procedimento.
    // 3. `montarCronograma` (Task 1) -> as sessões. Erro de ciclo sobe.
    // 4. `ratearPrograma` (Task 2) -> o valor de cada item.
    // 5. INSERT programa, INSERT itens, INSERT tarefas das sessões em UM
    //    `INSERT … SELECT * FROM unnest(...)` — 48 round-trips para montar um
    //    programa de 48 sessões é o que faz a tela travar no celular.
    // 6. `UPDATE recebimentos SET programa_id = $1 WHERE id = $2` (quando houver).
    // 7. Cancelar os contatos de retorno abertos do paciente, por procedimento.
  }
}
```

A rota `POST /v1/programas` monta o **recebimento primeiro** (serviço do épico 4 ou o embutido do épico 2, na tarefa companheira) e passa o `recebimentoDaAdesaoId` ao montador — na **mesma** `naClinica`. A ordem importa: o montador precisa do id para carimbar `programa_id`, e o recebimento precisa existir antes de o programa existir? Não: os dois nascem na mesma transação, e o `UPDATE` do passo 6 acontece depois do `INSERT` do programa. **Nenhuma das duas escritas sobrevive sozinha.**

A cobrança de `receber` é no **serviço**, não no decorador, porque ela depende do corpo:

```ts
// `@Exige` é estático; "tem dinheiro no corpo" não é. Mesma decisão D-7 do
// épico 3 pela outra porta: a rota que cria dinheiro é gated, sem exceção.
if (corpo.pagamento !== undefined && !temPerm(usuario, perfis, 'receber')) {
  throw new ForbiddenException(
    'Para lançar o pagamento da adesão você precisa da permissão de recebimentos. ' +
    'Crie o programa sem valor e registre o pagamento pela tela Recebimentos.',
  )
}
```

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Registrar** — `POST /v1/programas` em `ROTAS_COM_DINHEIRO`, com `valor`, `valorTotal` e `itens[].valor`.

- [ ] **Passo 6: Prova por mutação** — tire o `INSERT` das sessões de dentro da transação (abra uma segunda conexão). O teste *"A MONTAGEM É UMA TRANSAÇÃO"* tem de falhar com um programa sem sessões. Restaure.

- [ ] **Passo 7: Segunda mutação** — faça o item gravar `procedimento_nome` por `JOIN` em tempo de leitura, em vez de congelado. O teste do rename tem de falhar. Restaure.

- [ ] **Passo 8: Commit**

---

## Task 8: `fechar` numa transação só — a dívida do épico 3, paga

**Files:** `apps/api/src/jornada/fechamento.service.ts` · `apps/api/src/jornada/jornada.service.ts` *(modificar)* · `jornada.module.ts` *(modificar)* · `fechar.test.ts`

```
POST /v1/tarefas/:id/jornada   { acao: 'fechar', recebimento, inicioDoPrograma? }
@Exige('jornada')  @Exige('receber')
```

> Esta é literalmente a **Task 7 do plano do épico 3**, que o executor não fez — e o teste dele *"fechar com programa orçado é 409 enquanto o épico 5 não existe"* **vira o teste do caminho feliz**. Leia a Task 7 daquele plano inteira antes de começar: a tabela "as três coisas que o fechamento grava" e os testes de regra 4 são de lá, e não se reescrevem aqui.

**O defeito que esta tarefa corrige, e ele é do protótipo.** No `demoApiBase`, "Fechou" são **duas chamadas do cliente**: `criarAdesao` (que cria o recebimento e o programa) e **depois** `moverEtapa fechar` (que move o cartão). Medido: o `case "fechar"` do `moverEtapa` **não monta programa nenhum** — ele só grava a etapa e o `valorOrcamento`. Entre as duas chamadas cabe uma rede que cai. Quando cai, a paciente pagou, o programa existe, e o cartão continua em "Orçamentos em aberto": a clínica liga para cobrar quem já pagou.

Aqui são **quatro escritas numa transação**: o `Recebimento`, o `Programa` (com itens e sessões), o cancelamento dos retornos, e a etapa.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('O 501 ACABOU: fechar com programa orçado monta o programa', async () => {
  const t = (await mover(ORCADO_COM_PROGRAMA, {
    acao: 'fechar', recebimento: { valor: '120000', forma: 'Pix', valorAberto: '240000' },
    inicioDoPrograma: '2026-11-02',
  })).json()
  expect(t.etapa).toBe('fechado')
  const p = await programaDaOrigem(ORCADO_COM_PROGRAMA)
  expect(p.itens).toHaveLength(1)
  expect(await contarSessoesDe(p.id)).toBe(12)
})

it('UMA TRANSAÇÃO: ou as quatro escritas, ou nenhuma', async () => {
  // Força falha no montador e confere que NÃO existe recebimento órfão, que o
  // cartão continua em `orcamento` e que o programa não existe.
  await comMontadorQueFalha(async () => {
    expect((await mover(ORCADO_COM_PROGRAMA, { acao: 'fechar', recebimento: ENTRADA })).statusCode).toBe(500)
  })
  expect(await recebimentosVivosDe(ORCADO_COM_PROGRAMA)).toHaveLength(0)
  expect((await buscar(ORCADO_COM_PROGRAMA)).etapa).toBe('orcamento')
  expect(await contarProgramasDe(ANA)).toBe(0)
  // E O PROGRAMA PROPOSTO CONTINUA LÁ, inteiro, esperando.
  expect((await buscar(ORCADO_COM_PROGRAMA)).programaOrcado).toHaveLength(1)
})

it('o recebimento do fechamento nasce com o `programa_id` — o saldo agrupa', async () => {
  await mover(ORCADO_COM_PROGRAMA, { acao: 'fechar',
    recebimento: { valor: '120000', forma: 'Pix', valorAberto: '240000' } })
  const p = await programaDaOrigem(ORCADO_COM_PROGRAMA)
  expect((await saldoDe(ANA)).grupos.find((g) => g.programaId === p.id)!.saldo).toBe('240000')
})

it('a receita conta A ENTRADA, não o orçamento nem o total do programa', async () => {
  await mover(ORCADO_COM_PROGRAMA, { acao: 'fechar',
    recebimento: { valor: '120000', forma: 'Pix', valorAberto: '240000' } })
  expect(await receitaDoDia()).toBe(120000n)
  expect((await buscar(ORCADO_COM_PROGRAMA)).valorOrcamento).toBe('360000')
})

it('O PROCEDIMENTO QUE SAIU DO CATÁLOGO É 409, e nada foi escrito', async () => {
  // A nota 12 do relatório do épico 3: a proposta pode carregar um id que
  // nunca existiu, ou que foi excluído entre o orçamento e o fechamento.
  await excluirProcedimentoDireto(TIRZE)   // direto no banco, driblando a Task 6
  const r = await mover(ORCADO_COM_PROGRAMA, { acao: 'fechar', recebimento: ENTRADA })
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('item 1')
  expect(r.json().message).toContain('catálogo')
  expect(await recebimentosVivosDe(ORCADO_COM_PROGRAMA)).toHaveLength(0)
  expect((await buscar(ORCADO_COM_PROGRAMA)).etapa).toBe('orcamento')
})

it('sem `inicioDoPrograma`, o início é HOJE DA CLÍNICA, do servidor', async () => {
  // RelogioFixo em 2026-10-25T02:00:00Z -> em America/Bahia ainda é 24/10.
  const p = await fecharEObterPrograma({ acao: 'fechar', recebimento: ENTRADA })
  expect(p.inicio).toBe('2026-10-24')
})

it('fechar SEM programa continua funcionando exatamente como antes', async () => {
  // Os testes da Task 7 do épico 3 que já descreviam este caminho continuam
  // verdes, palavra por palavra. RODE-OS.
  const t = (await mover(ORCADO, { acao: 'fechar', recebimento: { valor: '45000', forma: 'Pix' } })).json()
  expect(t.etapa).toBe('fechado')
  expect(await contarProgramasDe(ANA)).toBe(0)
})

it('fechar NÃO sobrescreve um valor de orçamento já registrado', async () => { /* épico 3 */ })

it('fechar DUAS VEZES não monta dois programas', async () => {
  // `fechado` é terminal, então a segunda já é 409 pela máquina de estados. O
  // índice `programa_por_origem` é a segunda camada, para o caminho que
  // ninguém previu.
  await mover(ORCADO_COM_PROGRAMA, { acao: 'fechar', recebimento: ENTRADA })
  expect((await mover(ORCADO_COM_PROGRAMA, { acao: 'fechar', recebimento: ENTRADA })).statusCode).toBe(409)
  expect(await contarProgramasDe(ANA)).toBe(1)
})

it('sem `receber`, 403 — e nem recebimento, nem programa, nem etapa', async () => { /* épico 3 */ })

it('o dinheiro DENTRO do `programa_orcado` continua redigido sem `valores`', async () => {
  // Regra 17, em profundidade. A Task 5 do épico 3 prova; aqui só se confere
  // que o campo novo `itens[].valor` do programa MONTADO entra na mesma rede.
  const p = await programaDaOrigem(ORCADO_COM_PROGRAMA, cookieDe(SEM_VALORES))
  expect(p.itens[0]!.valor).toBeNull()
  expect(JSON.stringify(p)).not.toContain('360000')
})
```

- [ ] **Passo 2: Ver falhar** — hoje é `501`.

- [ ] **Passo 3: Implementar** — **a troca de uma linha que o épico 3 prometeu**, e ela é literalmente esta:

```ts
// apps/api/src/jornada/jornada.module.ts
-  // (nada: `fechar` lançava NotImplementedException)
+  imports: [TarefasModule, ProgramasModule],
+  providers: [..., { provide: MontadorDePrograma, useClass: MontadorRelacional }],
```

E, em `jornada.service.ts`, o ramo `case 'fechar'` deixa de lançar e delega ao `FechamentoService`, que faz, **dentro da `naClinica` que a rota já abriu**:

```
1. SELECT … FOR UPDATE            (já é o que a rota faz)
2. transicao(estado, 'fechar')    ← packages/domain, intocado
3. cria o Recebimento             ← serviço do épico 2, intocado
4. programa_orcado vazio?  → pula o passo 5
5. MontadorDePrograma.montar(tx, pedido)   ← Task 7
6. UPDATE etapa, status, historico, valor_orcamento, proximo_passo_em
```

**O `MontadorIndisponivel` é apagado**, não deixado para trás: um provider alternativo que ninguém usa é o lugar onde a próxima pessoa pluga sem perceber.

- [ ] **Passo 4: PASS.** Rode a suíte **inteira** do épico 3 — `jornada.e2e`, `orcamento`, `perder`, `jornada-banco`. O único teste que muda de significado é o do 409, e ele vira o do caminho feliz.

- [ ] **Passo 5: Prova por mutação** — faça as quatro escritas em quatro conexões. O teste *"UMA TRANSAÇÃO"* tem de falhar com recebimento órfão. Restaure. **É esta mutação que separa o nosso fechamento do do protótipo.**

- [ ] **Passo 6: Segunda mutação** — faça o montador aceitar `procedimentoId` inexistente, montando o programa sem o item. O teste do catálogo tem de falhar com um programa de zero itens. Restaure.

- [ ] **Passo 7: Commit**

---

## Task 9: Concluir a sessão — reprogramar, dar baixa, e chamar de volta

**Files:** `apps/api/src/programas/sessoes.controller.ts` · `sessoes.service.ts` · `baixa-de-insumos.ts` · `apps/api/src/tarefas/conclusao.service.ts` *(modificar)* · `apps/api/src/tarefas/tarefas.controller.ts` *(modificar)* · `sessoes.test.ts`

```
POST /v1/programas/sessoes/:id/concluir   @Exige('programas')
POST /v1/programas/sessoes/:id/reabrir    @Exige('programas')
```

**Rota própria, e a rota genérica recusa** (decisão P-5). Concluir uma sessão faz **quatro** coisas que concluir uma tarefa não faz: reprograma as próximas, dá baixa nos insumos, cria o contato de retorno na última do item, e carimba `programa_id` no recebimento embutido. Empilhar isso em `POST /v1/tarefas/:id/concluir` faria `TarefasModule` depender de `ProgramasModule`, que já depende dele — e a saída do ciclo seria um `forwardRef`, que é onde a ordem de inicialização vira defeito intermitente.

**Aqui nasce o segundo seam.** `BaixaDeInsumos` está declarado na seção **Interfaces**, provido por `BaixaInerte` até o épico 6, e chamado **dentro da transação de quem chama** — exatamente como o épico 3 fez com o montador.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('concluir a sessão REPROGRAMA as próximas quando se pede', async () => {
  // Série semanal 02/11..23/11. A 2ª realizada em 13/11.
  await concluirSessao(S2, { em: '2026-11-13', reprogramar: true })
  expect(await prazosDe(P)).toEqual(['2026-11-02', '2026-11-09', '2026-11-20', '2026-11-27'])
})

it('e MANTÉM as datas quando se pede — é escolha, não padrão', async () => {
  await concluirSessao(S2, { em: '2026-11-13', reprogramar: false })
  expect(await prazosDe(P)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'])
})

it('o corpo SEM `reprogramar` é 400 — nenhum padrão silencioso', async () => {
  expect((await pedirConcluirSessao(S2, { em: '2026-11-13' })).statusCode).toBe(400)
})

it('A CASCATA: o item seguinte é empurrado, se ainda não começou', async () => { /* Task 1, pela rota */ })

it('reprogramar grava SÓ as linhas que mudaram — a trilha não ganha ruído', async () => {
  const antes = await contarTrilhaDe('tarefas', P)
  await concluirSessao(S2, { em: PRAZO_ORIGINAL_DA_2, reprogramar: true })
  expect(await contarTrilhaDe('tarefas', P)).toBe(antes + 1)   // só a própria S2
})

// ── A ÚLTIMA SESSÃO ─────────────────────────────────────────────────────────
it('a ÚLTIMA sessão do item cria o CONTATO DE RETORNO, com a antecedência', async () => {
  await concluirSessao(ULTIMA_DE_TOXINA, { em: '2026-10-25', reprogramar: false })
  const t = await contatoDeRetornoDe(P, 'i1')
  expect(t.prazo).toBe('2027-02-10')            // 4 meses − 15 dias
  expect(t.descricao).toContain('pode repetir a partir de 25/02/27')
  expect(t.responsavelId).toBe(RESP_DO_RETORNO)
})

it('o contato de retorno é POR ITEM: a última do item 1 não espera o item 2', async () => {
  // O protótipo cria um por `itemKey`; o `Code.gs` cria um por adesão, porque
  // ele não tem itens. Para o dado migrado (um item `i1`) os dois coincidem,
  // e é isso que a conferência do épico 9 cobra.
})

it('sem regra de retorno no procedimento, nenhuma tarefa é criada', async () => { /* … */ })

it('restando sessão aberta do item, o retorno NÃO é criado', async () => { /* … */ })

it('retorno já existente não é duplicado', async () => { /* `jaTem` do protótipo */ })

it('criar o retorno CANCELA os retornos antigos do mesmo procedimento', async () => { /* … */ })

it('programa ENCERRADO não gera contato de retorno', async () => { /* `a.status !== 'cancelado'` */ })

// ── O DINHEIRO ──────────────────────────────────────────────────────────────
it('o pagamento da sessão cria UM recebimento, com o `programa_id`', async () => {
  await concluirSessao(S2, { em: H, reprogramar: false, pagamento: { valor: '30000', forma: 'Pix' } })
  expect(await recebimentosVivosDe(S2)).toHaveLength(1)
  expect((await recebimentoDe(S2)).programaId).toBe(P)
})

it('EM MODO SALDO, o pagamento da sessão ABATE o saldo do programa', async () => {
  // `Code.gs:1021`: sessão de adesão em modo `saldo` abate. É o que o MANUAL
  // diz — "quando o programa tem saldo, o valor recebido abate o saldo".
  const antes = (await saldoDe(ANA)).grupos.find((g) => g.programaId === P)!.saldo
  await concluirSessao(S2, { em: H, reprogramar: false, pagamento: { valor: '30000', forma: 'Pix' } })
  expect((await saldoDe(ANA)).grupos.find((g) => g.programaId === P)!.saldo)
    .toBe(String(BigInt(antes) - 30000n))
})

it('EM MODO AVULSO, o pagamento da sessão é receita e NÃO abre nem abate saldo', async () => { /* … */ })

it('A RECEITA NÃO DOBRA: a mesma sessão recusa o segundo recebimento', async () => {
  // O índice `recebimento_por_tarefa` do épico 2, pela porta nova.
})

// ── REABRIR ─────────────────────────────────────────────────────────────────
it('reabrir ESTORNA o recebimento e a receita do dia volta', async () => { /* épico 2, pela porta nova */ })

it('reabrir CANCELA o contato de retorno que a conclusão criou', async () => {
  await concluirSessao(ULTIMA, { em: H, reprogramar: false })
  await reabrirSessao(ULTIMA)
  expect((await contatoDeRetornoDe(P, 'i1')).status).toBe('cancelada')
})

it('reabrir NÃO desfaz a reprogramação — as datas novas ficam', async () => {
  // Reprogramar é uma decisão sobre a agenda, não um efeito da conclusão. A
  // enfermagem já reorganizou o dia dela; desfazer seria a surpresa.
})

// ── OS LIMITES DA ROTA GENÉRICA ─────────────────────────────────────────────
it('`POST /v1/tarefas/:id/concluir` RECUSA uma sessão, e diz por quê em português', async () => {
  const r = await concluir(S2, { em: H })
  expect(r.statusCode).toBe(409)
  expect(r.json().message)
    .toContain('precisa saber se as próximas sessões seguem a nova data')
})

it('`DELETE /v1/tarefas/:id` RECUSA uma sessão', async () => {
  // Excluir abre buraco na numeração, e a numeração é o que a reprogramação
  // usa para saber o que vem depois.
  expect((await excluirTarefa(S2)).statusCode).toBe(409)
})

it('CANCELAR uma sessão continua pela rota genérica, e o programa segue', async () => {
  await cancelar(S3)
  expect(await situacaoDoProgramaNaRota(P)).not.toBe('concluido')
})

// ── O SEAM DO ESTOQUE ───────────────────────────────────────────────────────
it('concluir CHAMA a baixa, com a dose do item e os descartáveis do procedimento', async () => {
  const espiao = espiarBaixa()
  await concluirSessao(S2, { em: H, reprogramar: false })
  expect(espiao.ultimoPedido.insumos).toEqual([
    { itemId: TIRZE_AMPOLA, quantidade: q('1', 'ampola'), principal: true },
    { itemId: SERINGA,      quantidade: q('1', 'un'),     principal: false },
    { itemId: AGULHA,       quantidade: q('1', 'un'),     principal: false },
  ])
  expect(espiao.ultimoPedido).toMatchObject({ tarefaId: S2, programaId: P, itemChave: 'i1' })
})

it('a dose DO ITEM vence a do procedimento — é a dose daquela paciente', async () => { /* … */ })

it('reabrir CHAMA o desfazer, com o motivo', async () => {
  const espiao = espiarBaixa()
  await concluirSessao(S2, { em: H, reprogramar: false })
  await reabrirSessao(S2)
  expect(espiao.ultimoDesfazer).toMatchObject({ tarefaId: S2, motivo: 'sessao-reaberta' })
})

it('a baixa INERTE não impede nada — a clínica sem estoque usa programas', async () => {
  expect((await concluirSessao(S2, { em: H, reprogramar: false })).statusCode).toBe(200)
})

it('a baixa que FALHA desfaz a conclusão inteira — mesma transação', async () => {
  // O épico 6 vai falhar aqui quando o saldo não cobrir a dose. Quando isso
  // acontecer, a sessão NÃO pode ficar concluída: a enfermagem precisa saber
  // que o frasco acabou antes de registrar que aplicou.
  await comBaixaQueFalha(async () => {
    expect((await concluirSessao(S2, { em: H, reprogramar: false })).statusCode).toBe(409)
  })
  expect((await buscar(S2)).status).toBe('aberta')
  expect(await recebimentosVivosDe(S2)).toHaveLength(0)
})
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — a ordem dentro da transação, e ela não é negociável:

```
1. SELECT … FOR UPDATE da sessão e do programa
2. não é sessão?             → 404
3. podeConcluir (épico 2, domínio puro)
4. instanteDaConclusao (épico 2) — data de negócio do SERVIDOR
5. UPDATE status, concluida_em, obs
6. pagamento?  → Recebimento (serviço do épico 2) + programa_id
7. reprogramar? → reprogramar() do domínio → UPDATE só do que mudou
8. última do item? → retornoDe() → cancelarRetornos + INSERT do contato
9. BaixaDeInsumos.baixar(tx, …)
```

A baixa é **por último**, e **dentro** da transação: ela é a única que pode falhar por motivo do mundo (saldo insuficiente), e falhar depois de tudo escrito é o que torna o rollback significativo.

```ts
// apps/api/src/programas/baixa-de-insumos.ts
/**
 * A COSTURA COM O ÉPICO 6, declarada aqui e implementada lá.
 *
 * Mesmo movimento que o épico 3 fez com o `MontadorDePrograma`: este épico
 * não constrói o estoque, ele declara a porta pela qual o estoque entra, e
 * recebe a transação aberta para que a atomicidade seja de quem chama.
 *
 * O QUE O ÉPICO 6 TERÁ DE HONRAR, e que já tem teste escrito aqui:
 *
 *   `desfazer` restaura EXATAMENTE o que `baixar` tirou — mesma quantidade,
 *   mesmo lote — por movimento COMPENSATÓRIO ligado por `tarefaId`, nunca
 *   `DELETE` (regra 12). Concluir -> reabrir -> concluir -> reabrir devolve
 *   saldo e lote ao ponto inicial.
 *
 *   Item que não aproveita sobra gera DOIS movimentos na baixa (consumo da
 *   dose + descarte "Sobra de frasco aberto"), e `desfazer` compensa OS DOIS.
 *   É o segundo que a implementação ingênua esquece, porque o descarte não
 *   está no que a sessão pediu.
 *
 * O protótipo APAGA os movimentos ao excluir a adesão
 * (`movs.filter(m => !removidos.includes(m.id))`). Essa linha não atravessa.
 */
export abstract class BaixaDeInsumos { /* ver Interfaces */ }
```

A recusa da rota genérica, em `conclusao.service.ts`:

```ts
// A mensagem diz o MOTIVO, não a rota. A recepção não lê URL.
if (ehSessao(tarefa)) {
  throw new ConflictException(
    'Conclua a sessão pelo cartão do programa: ela precisa saber se as ' +
    'próximas sessões seguem a nova data.',
  )
}
```

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Registrar** — as duas rotas novas em `ROTAS_COM_DINHEIRO` (`valor`, `valorAberto`, `saldoDoPrograma`).

- [ ] **Passo 6: Prova por mutação** — faça a baixa rodar **depois** do `COMMIT`. O teste *"a baixa que FALHA desfaz a conclusão inteira"* tem de falhar com a sessão concluída e o estoque intocado. Restaure.

- [ ] **Passo 7: Segunda mutação** — faça `reprogramar` gravar a lista inteira em vez de só o que mudou. O teste da trilha sem ruído tem de falhar. Restaure.

- [ ] **Passo 8: Commit**

---

## Task 10: Encerrar × excluir — e a diferença que o MANUAL tem uma seção só para explicar

**Files:** `apps/api/src/programas/programas.service.ts` *(modificar)* · `programas.controller.ts` *(modificar)* · `encerrar-excluir.test.ts`

```
POST   /v1/programas/:id/encerrar   @Exige('programas.gerir')
DELETE /v1/programas/:id            @Exige('programas.gerir')
```

> ⚠️ **Leia antes a pergunta 1 para o dono.** Se a resposta for *"siga o MANUAL"*, o Passo 3 troca a recusa por estorno em cascata.

**São coisas diferentes, e a diferença é de intenção** (MANUAL cap. 8, *"Encerrar ou excluir um programa"*):

| | **Encerrar** | **Excluir** |
|---|---|---|
| Quando | a paciente **parou antes do fim** | o registro foi **feito por engano** |
| O programa | `situacao = 'encerrado'`, com motivo | `excluido_em` — soft delete (regra 20) |
| Sessões **abertas** | `cancelada` | `excluida_em` |
| Sessões **realizadas** | **ficam no histórico** | `excluida_em` |
| Estoque | **intocado** — o consumo aconteceu | `BaixaDeInsumos.desfazer`, por compensação |
| Recebimentos | ficam, com `programa_id` | ficam, **sem** `programa_id` (voltam ao grupo geral) |
| Contato de retorno | **não é criado** daqui em diante | cancelado, se houver |

**O que nenhum dos dois legados faz, e nós fazemos:** soft delete. O protótipo dá `splice`; o `Code.gs` dá `deleteRow`. A regra 20 vence os dois, pela mesma razão da ADR 0003 — a trilha de um atendimento realizado é prova, não conveniência.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
// ── ENCERRAR ────────────────────────────────────────────────────────────────
it('encerrar CANCELA as abertas e PRESERVA as realizadas', async () => {
  const r = (await encerrar(P, { motivo: 'Desistiu', obs: 'mudou de cidade' })).json()
  expect(r.situacao).toBe('encerrado')
  expect(r.motivoEncerramento).toBe('Desistiu — mudou de cidade')
  expect(await statusDasSessoes(P)).toEqual(['concluida', 'concluida', 'cancelada', 'cancelada'])
})

it('encerrar NÃO desfaz baixa nenhuma — o consumo aconteceu', async () => {
  const espiao = espiarBaixa()
  await encerrar(P, { motivo: 'Desistiu' })
  expect(espiao.desfazeres).toHaveLength(0)
})

it('encerrar NÃO apaga: o programa continua no banco e na ficha da paciente', async () => {
  await encerrar(P, { motivo: 'Desistiu' })
  expect(await existeNoBanco('programas', P)).toBe(true)
  expect(await programasDaFicha(ANA)).toContainEqual(expect.objectContaining({ id: P }))
})

it('encerrar sem motivo é 400 — o motivo é o relatório', async () => {
  expect((await pedirEncerrar(P, {})).statusCode).toBe(400)
})

it('programa encerrado NÃO gera contato de retorno, nem se a última for concluída', async () => {
  // Já é verdade pela Task 9; aqui se prova pela outra porta.
})

it('encerrar DUAS VEZES é 409', async () => { /* `situacao` já é `encerrado` */ })

it('a trilha registra de/para de `situacao`', async () => {
  const t = await trilhaDe('programas', P)
  expect(t.de.situacao).toBe('ativo'); expect(t.para.situacao).toBe('encerrado')
})

it('sem `programas.gerir`, 403 — e o programa continua ativo', async () => {
  // A enfermagem tem `programas` e NÃO tem `programas.gerir`.
  expect((await encerrar(P, { motivo: 'X' }, cookieDe(ENFERMAGEM))).statusCode).toBe(403)
  expect((await programa(P)).situacao).toBe('ativo')
})

// ── EXCLUIR ─────────────────────────────────────────────────────────────────
it('excluir é SOFT DELETE do programa E das sessões', async () => {
  await excluirPrograma(SEM_PAGAMENTO)
  expect(await existeNoBanco('programas', SEM_PAGAMENTO)).toBe(true)
  expect((await linhaCrua('programas', SEM_PAGAMENTO)).excluido_em).not.toBeNull()
  expect(await sessoesVivasDe(SEM_PAGAMENTO)).toHaveLength(0)
  expect(await listarProgramas()).not.toContainEqual(expect.objectContaining({ id: SEM_PAGAMENTO }))
})

it('excluir DESFAZ as baixas — por compensação, e com o motivo', async () => {
  const espiao = espiarBaixa()
  await excluirPrograma(COM_SESSAO_CONCLUIDA_SEM_PAGAMENTO)
  expect(espiao.desfazeres.map((d) => d.motivo)).toEqual(['programa-excluido'])
})

it('excluir com SESSÃO PAGA é 409 — e a mensagem dá as duas saídas', async () => {
  // O épico 2 já recusa excluir tarefa com recebimento ("Reabra a tarefa").
  // Duas respostas para a mesma pergunta é como uma delas vira a errada.
  const r = await excluirPrograma(COM_SESSAO_PAGA)
  expect(r.statusCode).toBe(409)
  expect(r.json().message).toContain('Estorne')
  expect(r.json().message).toContain('Encerrar programa')
  expect(await sessoesVivasDe(COM_SESSAO_PAGA)).toHaveLength(4)   // nada mudou
})

it('o RECEBIMENTO DA ADESÃO sobrevive, perdendo o vínculo com o programa', async () => {
  // Legado: `t.adesaoId = ''`. Aqui: `programa_id = NULL`. O dinheiro não
  // some; ele volta para o grupo geral do saldo.
  const antes = await receitaDoDia()
  await excluirPrograma(COM_ADESAO_PAGA_E_SESSOES_ABERTAS)
  expect(await receitaDoDia()).toBe(antes)
  expect((await saldoDe(ANA)).grupos.map((g) => g.programaId)).toEqual([null])
})

it('excluir CANCELA o contato de retorno que o programa criou', async () => { /* … */ })

it('a tarefa de ORIGEM (o orçamento fechado) não é tocada', async () => {
  await excluirPrograma(P)
  expect((await buscar(ORCADO)).etapa).toBe('fechado')
})

it('excluído liberou a origem: fechar de novo é possível?', async () => {
  // NÃO — `fechado` é terminal (épico 3). O índice `programa_por_origem` é
  // parcial em `excluido_em`, então ele não impede; quem impede é a máquina
  // de estados, e é ela que tem de impedir.
  expect((await mover(ORCADO, { acao: 'fechar', recebimento: E })).statusCode).toBe(409)
})

it('sem `programas.gerir`, 403', async () => { /* … */ })
it('programa de outra clínica é 404, nem com o id na mão', async () => { /* RLS */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — tudo dentro de uma `naClinica`, com `SELECT … FOR UPDATE` no programa. A recusa da exclusão sai de **uma** consulta:

```sql
SELECT count(*) FROM recebimentos r
  JOIN tarefas t ON t.id = r.tarefa_id
 WHERE t.programa_id = $1 AND t.tipo = 'Sessão de plano' AND r.estornado_em IS NULL
```

`UPDATE … SET excluida_em = now() WHERE programa_id = $1 AND excluida_em IS NULL` alcança sessões **e** contatos de retorno numa escrita só — os dois carregam `programa_id`.

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Prova por mutação** — troque o soft delete das sessões por `DELETE`. O teste da trilha de `programas` (que referencia as tarefas) e o de `existeNoBanco` têm de falhar. Restaure.

- [ ] **Passo 6: Commit**

---

## Task 11: A leitura — tudo calculado no servidor

**Files:** `apps/api/src/programas/leitura.service.ts` · `programas.controller.ts` *(modificar)* · `apps/api/src/hoje/hoje.service.ts` *(modificar)* · `leitura.test.ts`

```
GET /v1/programas       ?uni=&situacao=&procedimentoId=&responsavelId=&q=    @Exige('programas')
GET /v1/programas/:id                          @Exige('programas') @DadoSensivel('paciente')
```

`GET /v1/programas` devolve **quatro coisas, todas calculadas no servidor** (`docs/design.md` proíbe cálculo no front):

1. **Os indicadores:** pacientes em programa · programas concluídos · sessões hoje · sessões nos próximos 7 dias · sessões atrasadas · pacientes com atraso > 7 dias · (com `valores`) saldo a receber nos programas e quantas pacientes devem.
2. **A agenda:** sessões atrasadas (da mais antiga), de hoje, realizadas hoje, próximos 7 dias.
3. **Os contatos de retorno até 30 dias** — pacientes que já podem repetir.
4. **A lista de pacientes em programa**, com situação derivada e filtros.

**A `@DadoSensivel('paciente')` na ficha do programa não é zelo.** Ela carrega dose, insumo e procedimento aplicado — dado pessoal sensível de saúde (LGPD art. 11, regra 18). A pergunta que a lei faz é *"quem olhou o tratamento da minha paciente"*, e a resposta precisa existir.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('os indicadores vêm PRONTOS, e nenhum deles é somado no front', async () => {
  expect(await indicadores()).toMatchObject({
    pacientesEmPrograma: 5, programasConcluidos: 1,
    sessoesHoje: 0, sessoesProximos7: 3, sessoesAtrasadas: 6, pacientesEmRisco: 1,
  })
})

it('a situação do programa é a do domínio, não uma segunda conta no servidor', async () => {
  // `situacaoDoPrograma` (Task 1) é a única fonte. Um `CASE WHEN` no SQL
  // seria a segunda implementação, e é a segunda que diverge.
})

it('o filtro "Minhas sessões" traz só as do usuário — é o que a enfermagem abre', async () => {
  const r = await listar({ responsavelId: 'eu' }, cookieDe(CAMILA))
  expect(r.agenda.atrasadas.every((s) => s.responsavelId === CAMILA)).toBe(true)
})

it('o filtro por situação cobre as cinco: andamento, atraso, com saldo, concluídos, encerrados', async () => { /* … */ })

it('SEM `valores`: as contagens ficam, o saldo some, e `temSaldo` fica', async () => {
  // Regra 17. A equipe precisa do AVISO antes da sessão ("confirmar o
  // pagamento"), e não precisa do valor para dá-lo.
  const r = await listar(cookieDe(SEM_VALORES))
  expect(r.indicadores.pacientesEmPrograma).toBeGreaterThan(0)
  expect(r.indicadores.saldoAReceber).toBeNull()
  expect(r.lista[0]!.temSaldo).toBe(true)
  expect(r.lista[0]!.saldo).toBeNull()
  expect(JSON.stringify(r)).not.toContain('120000')
})

it('a sessão traz o AVISO DE SALDO do programa, para a cobrança no atendimento', async () => {
  // MANUAL cap. 8: "a próxima sessão mostra um alerta com o valor".
  expect((await listar()).agenda.atrasadas[0]).toMatchObject({ temSaldo: true, saldo: '120000' })
})

it('os contatos de retorno vêm só até 30 dias, do mais próximo', async () => { /* … */ })

it('a ficha do programa traz progresso, itens, sessões, recebido e saldo — tudo derivado', async () => {
  const p = await programa(P)
  expect(p).toMatchObject({ realizadas: 4, total: 12, percentual: 33 })
  expect(p.recebido).toBe('240000')
  expect(p.saldo).toBe('120000')
  // E NÃO EXISTE coluna `saldo` nem `recebido` em `programas` (regra 5, P-2).
})

it('o percentual no prazo é realizadas no prazo ÷ realizadas', async () => {
  expect((await programa(P)).percentualNoPrazo).toBe(75)
})

it('abrir a ficha do programa grava "acessou" na trilha, com o id da paciente', async () => {
  await pedir(`/v1/programas/${P}`, cookieDe(JULIANA))
  expect(await ultimaTrilha()).toMatchObject({ acao: 'acessou' })
})

it('programa EXCLUÍDO não aparece em lista nenhuma, nem por id', async () => { /* … */ })
it('sem `programas`, 403', async () => { /* … */ })
it('a lista não enxerga programa de outra clínica', async () => { /* RLS */ })

// ── A TELA HOJE ─────────────────────────────────────────────────────────────
it('`GET /v1/hoje` ganha o bloco `sessoes`, FORA da seção "Hoje"', async () => {
  // O protótipo tem um bloco próprio, "SESSÕES DE PROGRAMAS", com as
  // atrasadas primeiro — medido na tela. Misturá-las com as tarefas do dia
  // faz a recepção ver trinta cartões e parar de olhar.
  const h = await hoje()
  expect(h.sessoes.map((s) => s.id)).toContain(SESSAO_ATRASADA)
  expect(h.hoje.map((t) => t.id)).not.toContain(SESSAO_ATRASADA)
  expect(h.pendentes.itens.map((t) => t.id)).not.toContain(SESSAO_ATRASADA)
})

it('sem a permissão `programas`, o bloco vem vazio e o resto da Hoje continua', async () => { /* … */ })
```

- [ ] **Passo 2: Ver falhar**

- [ ] **Passo 3: Implementar** — os quatro blocos de `GET /v1/programas` saem de **uma consulta por bloco, no máximo**, usando `sessoes_abertas` e `tarefas_do_programa`. O saldo vem do repositório do épico 4, **com `programa_id` agora projetado** — e é esta a única mudança naquele repositório:

```sql
-  NULL::uuid AS programa_id,
+  r.programa_id,
```

- [ ] **Passo 4: PASS**

- [ ] **Passo 5: Registrar** — as duas rotas em `ROTAS_COM_DINHEIRO`, com `saldo`, `recebido`, `saldoAReceber`, `valor` e `itens[].valor`. `redacao-de-valores.test.ts` passa a cobrá-los.

- [ ] **Passo 6: Medir** — `EXPLAIN ANALYZE` da consulta de `GET /v1/programas` com **50 mil tarefas** semeadas, das quais 2 mil sessões e 200 atrasadas, e de `GET /v1/hoje` com o bloco novo. O índice `sessoes_abertas` tem de aparecer nas duas. A tela Hoje a recepção abre cinquenta vezes por dia; se vier sequential scan, conserte **agora**.

- [ ] **Passo 7: Prova por mutação** — faça o servidor devolver `saldo` sem passar pela redação (um campo chamado `aReceber`, fora de `CAMPOS_MONETARIOS`). O teste de redação tem de falhar. Restaure. **É a varredura de campo monetário não registrado do épico 4 que pega isto** — se ela não pegar, o problema é ela.

- [ ] **Passo 8: Commit**

---

## Task 12: A tela Programas e a página do programa

**Files:** `apps/web/src/app/(app)/programas/page.tsx` · `programas/[id]/page.tsx` · `apps/web/src/components/programas/cartao-de-sessao.tsx` · `aviso-de-saldo.tsx` · *(modificar)* `apps/web/src/app/(app)/hoje/page.tsx` · `apps/web/src/lib/menu.ts`

**Leia `docs/design.md` antes, e rode a auditoria da seção 5 no fim.**

**Comercial › Programas.** Tudo vem pronto de `GET /v1/programas`; **nenhuma contagem no front**.

- [ ] **Passo 1: Os indicadores e as três abas** — `Agenda de sessões` · `Pacientes em programa`, com os chips `Minhas sessões` / `Todas` (medidos no protótipo) e o filtro de unidade. Algarismos tabulares em tudo.

- [ ] **Passo 2: O cartão de sessão** — paciente, rótulo do item com a dose (*"Aplicação 5/12 · Tirzepatida"*), responsável, prazo, etiqueta de atraso, WhatsApp. O círculo abre o painel de conclusão **no próprio cartão**:
  - **data de realização** (padrão: hoje);
  - **"as próximas sessões seguem a partir desta data"** × **"mantêm as datas originais"** — duas opções visíveis, nenhum padrão marcado quando a data difere do prazo;
  - **"Houve pagamento?"** Não/Sim, com valor e forma.

  É o caminho de dois toques, e é o que a enfermagem faz várias vezes por dia. **Conte os toques** de `abrir Programas → concluir a sessão de hoje sem pagamento` (alvo: **2**).

- [ ] **Passo 3: O aviso de saldo** — *"Paciente com saldo em aberto · R$ 1.200,00 · Confirmar o pagamento antes da sessão."* **Sem `valores`, o mesmo aviso aparece sem o número** — e isso é `temSaldo`, não um `if` de permissão no front: o servidor já devolveu `saldo: null`.

- [ ] **Passo 4: A página do programa** — cabeçalho com paciente, situação, modo de cobrança e unidade; as quatro ações (`Ficha do paciente`, `Nova tarefa do programa`, `Registrar recebimento`, `Encerrar programa`); a barra de progresso com *"4 de 12 realizadas · 33%"*; os três indicadores (recebido, saldo, sessões atrasadas); e **uma seção por item**, com as sessões em ordem e o contato de retorno quando houver.

  `Nova tarefa do programa` oferece **só os tipos que fazem sentido ali** (MANUAL cap. 8): Sessão de plano, Pagamento de saldo em aberto, Reagendamento, Contato de indicação, Pós-consulta. A lista sai de `TIPOS` (`@fir/domain`), filtrada — **nunca de um array no front**.

  `Encerrar programa` e `Excluir adesão` só aparecem com `programas.gerir`, e `Excluir` exige **dois toques** para confirmar, como o `Excluir do catálogo` do protótipo.

- [ ] **Passo 5: O bloco "Sessões de programas" na tela Hoje** — depois do financeiro e antes de Recontatar, com as atrasadas primeiro e a nota da PO: *"Aplicações e sessões da equipe para hoje, com as atrasadas primeiro. Ao concluir, a baixa no estoque é feita sozinha."* Dados prontos de `GET /v1/hoje`.

- [ ] **Passo 6: `menu.ts`** — troque `epico` por `'programas'` em `/programas`. **`menu-vs-telas.test.ts` vai cobrar.**

- [ ] **Passo 7: Estados** — carregando (sem deslocar conteúdo), erro (com "Ir para Hoje" e "Recarregar"), e o **vazio**, que é a primeira tela de toda clínica nova: *"Nenhum paciente em programa. Comece por Nova adesão, ou feche um orçamento com programa montado."*, com os dois atalhos.

- [ ] **Passo 8: Auditoria de `design.md` §5**, item a item — inclusive abrir em **390 px** e confirmar que a seção por item **não rola na horizontal** e que `--gold` não é usado como texto.

- [ ] **Passo 9: Commit**

---

## Task 13: Nova adesão e Procedimentos — o montador em três entradas

**Files:** `apps/web/src/components/programas/montador.tsx` · `apps/web/src/app/(app)/programas/nova/page.tsx` · `apps/web/src/app/(app)/procedimentos/page.tsx` · *(modificar)* `apps/web/src/components/jornada/forma-de-etapa.tsx` · `menu.ts`

**O montador é UM componente, usado em três lugares** (MANUAL cap. 8): `Programas › Nova adesão`, `Recebimento › Procedimento ou programa novo` e a caixa **"É um programa: montar agora"** do `registrarOrcamento` (épico 3). Duplicá-lo é como a terceira entrada deixa de aceitar `depoisDe` e ninguém percebe.

- [ ] **Passo 1: O montador** — paciente, data de início do programa, e **uma linha por procedimento**:
  - `Procedimento` (do `GET /v1/procedimentos`), `Sessões`, `Começa` (*na data de início* · *depois do item N* · *em outra data*);
  - recolhido atrás de **`Ajustar intervalo, dose, responsável e valor`** — medido no protótipo: a linha fechada mostra só três campos;
  - `+ Adicionar procedimento`;
  - o resumo: *"12 sessões programadas · 1. Tirzepatida — 12 sessões, de 02/11/26 a 18/01/27"*.

  **A prévia das datas vem de `montarCronograma` (`@fir/domain`)** — nunca de uma segunda implementação no front. Formatar é do front; calcular não é.

- [ ] **Passo 2: O pagamento do programa** — `Valor total do programa` e `Pago na adesão`, com a nota da PO: *"Sem valor total: cada sessão registra quanto foi pago naquele dia."* **Entrada é texto; saída sai de `formatarDinheiro`.** Nenhum `toFixed`. O bloco inteiro **não aparece** sem `receber` — com a dica de que o pagamento vai pela tela Recebimentos.

- [ ] **Passo 3: A dose** — o campo de dose do item vem preenchido do procedimento e é editável **para aquela paciente**. O rótulo mostra a unidade declarada (*"Dose por sessão (mg)"*), porque dose sem unidade é a origem da dose errada. Até o épico 6, a lista de insumos vem vazia e o campo fica **recolhido com a dica** *"O estoque entra em breve"* — ele não some, porque ele é o que a enfermagem procura.

- [ ] **Passo 4: Procedimentos** (`Configurações › Procedimentos`) — a lista com a linha-resumo do protótipo (*"12 aplicações · toda semana · baixa: 1 Tirzepatida ampola 5 mg · Camila · R$ 300 · 1 paciente ativo"*) e o formulário de edição com as quatro seções: identificação, repetição do procedimento, valor de referência, e baixa no estoque por sessão.

  **`Excluir do catálogo`** com dois toques, e, quando recusado, **a mensagem do servidor inteira** — ela já explica a saída (*"desmarque Ativo"*). A tela não reescreve a regra.

- [ ] **Passo 5: `menu.ts`** — `/procedimentos` com `perm: 'config'`, dentro do grupo Configurações.

- [ ] **Passo 6: Plugar no orçamento do épico 3** — a caixa `É um programa: montar agora` do `registrarOrcamento` passa a abrir **este** montador, e o `fechar` passa a enviar `inicioDoPrograma`. O formulário de `fechar` do épico 3 ganha o campo de data, com padrão **vindo do servidor**.

- [ ] **Passo 7: Auditoria de `design.md` §5** nas duas telas, em 390 px. Conte os toques de `abrir Nova adesão → criar um programa de um item com valor total` (alvo: **6**, contando o paciente e as duas datas).

- [ ] **Passo 8: Commit**

---

## Task 14: Fechamento

- [ ] `docs/paridade.md`: `salvarPlano`, `excluirPlano`, `criarAdesao`, `encerrarAdesao`, `excluirAdesao` → ✅, com as notas: *"`Plano` virou `Procedimento`; soft delete, e a recusa alcança também as propostas vivas"* · *"`criarAdesao` virou `POST /v1/programas`, com o mesmo `MontadorDePrograma` que o `fechar` usa"* · *"`excluirAdesao` virou soft delete e recusa quando há recebimento vivo — ver ADR 0005"*. E **atualize a linha de `moverEtapa`**: o `fechar` deixou de ser 409/501.
- [ ] `docs/adr/0005-programa-montado-por-itens.md` — contexto (o `Code.gs` tem uma adesão = um plano; o protótipo tem itens; há dado real nas 4 clínicas), decisão (programa montado por itens, sessões materializadas, catálogo imutável para quem já começou), consequências, e **as quinze divergências** da tabela, cada uma com o seu porquê. Alternativas rejeitadas: sessões derivadas (e por que a migração e a reprogramação quebrariam), guardar `sessoes`/`saldo`/`valor_total` em `programas`, rateio no nível da sessão.
- [ ] `CONTEXT.md`:
  - **corrigir o verbete `Programa`** — "programa antigo sem `itens` é lido como um item `i1`" deixa de ser conversão de leitura: no modelo relacional não existe programa sem itens, e a conversão acontece **uma vez, no migrador do épico 9**. Mesmo movimento de `etapaDerivada` no épico 3;
  - acrescentar **`Modo de cobrança`**, **`Contato de retorno`** e **`Sessão`** como verbetes, com invariantes;
  - acrescentar ao verbete `Procedimento` que **mudar sessões e intervalo não toca em quem já está em tratamento**;
  - registrar que **`'Sessão de plano'` continua sendo o nome do *tipo de tarefa*** — dado gravado nas 4 clínicas — e que o rótulo que a usuária lê é `rotulo_sessao`.
- [ ] `docs/arquitetura/sistema.md`: trocar `MontadorDePrograma` de "declarado" para **"implementado"** na lista de seams, e acrescentar **`BaixaDeInsumos`**. Mantenha a lista curta.
- [ ] `docs/roadmap.md`: tirar *"'Minhas metas' da enfermagem"* do épico 5 e pô-la no 7 (ver a pergunta 2 ao dono). Acrescentar ao épico 6 que a baixa entra **pelo seam `BaixaDeInsumos`**, trocando `BaixaInerte` — uma linha, como o épico 3 fez com o montador.
- [ ] `teste/registro.ts`: as quatro tabelas em `ENTIDADES_COM_CLINICA`; as rotas de programas e procedimentos em `ROTAS_COM_DINHEIRO`, com `valor`, `valorPorSessao`, `valorTotal`, `recebido`, `saldo`, `saldoAReceber`.
- [ ] `docs/dividas.md`, com gatilho em cada linha:
  - **(a)** `BaixaDeInsumos` está **inerte**: nenhuma sessão dá baixa até o épico 6. Os testes do seam existem e passam contra o espião; os do estoque de verdade são de lá. **Gatilho: a primeira tarefa do épico 6.**
  - **(b)** `procedimentos.insumo_padrao_id` e `insumos_do_procedimento.item_id` **não têm FK** — `itens_de_estoque` não existe. Um item apagado no épico 6 deixaria órfão silencioso. **Gatilho: a migration do épico 6**, que acrescenta a FK por expand e varre os órfãos antes.
  - **(c)** O migrador do épico 9 **reconcilia o catálogo por `nome_chave`**: as 4 clínicas já receberam os cinco modelos semeados, editados. `INSERT` cego colide. **Gatilho: a primeira clínica migrada.**
  - **(d)** A **campanha** do programa (`criarAdesao` aceita `campanhaId`) está aceita no contrato e **ignorada** — a tabela é do épico 8. **Gatilho: o épico 8.**
  - **(e)** O limite de itens é **10 na proposta** e **12 na montagem**. Harmonizar é alteração no contrato do épico 3. **Gatilho: a PO pedir 12 no orçamento.**
- [ ] **Conferência de migração (regra 28), escrita agora e executada no épico 9** — acrescente a `docs/paridade.md` as seis igualdades que o épico 9 vai cobrar, por clínica: quantidade de programas · quantidade de sessões por programa · soma de `itens.sessoes` igual ao `adesoes.sessoes` da v20 · `modo_de_cobranca` idêntico · saldo por programa idêntico ao `pacientesComSaldo` da v20 · contatos de retorno abertos idênticos. **Um único programa divergente reprova a clínica inteira.**
- [ ] `npx turbo run typecheck test --force`, **três vezes** — determinismo não se afirma, se observa.
- [ ] Commit

---

## Auto-revisão

**Cobre de `paridade.md`:** `salvarPlano` · `excluirPlano` · `criarAdesao` · `encerrarAdesao` · `excluirAdesao`. **5 das 59** — e paga a dívida de `moverEtapa fechar`, que o épico 3 entregou em 501.

**Regras do `CLAUDE.md` exercitadas:** 1 (Tasks 2, 7, 8, 9 — e o `Math.round((total-ent)*100)/100` do `Code.gs` que não atravessa) · 2 (Task 2, property-based, com a propriedade que amarra o rateio novo ao `ratear` que já existe) · 4 (Task 8) · 5 (Tasks 7, 9, 11 — o saldo do épico 4 passa a agrupar por programa sem que contrato nem função mudem) · 8, 9 e 10 (Tasks 4, 5, 9 — a dose nunca anda sem a unidade, e nenhuma conversão vive em código) · 12 (Task 9, o seam e o invariante que o épico 6 herda) · 16 e 17 (Tasks 6–11) · 18 e 21 (Tasks 6, 7, 11 — `@DadoSensivel` na ficha e a dose fora de log) · 19 e 20 (Tasks 4, 6, 10) · 22, 23, 24 e 25 (Tasks 1, 3, 8, 9) · **28 (Task 14, a conferência escrita antes de migrar)**.

**O invariante, e onde ele está escrito três vezes de propósito:** **a sessão é materializada e numerada dentro do seu item.** Está no cronograma puro (Task 1), no `CHECK sessao_e_do_programa` mais o índice `sessao_unica_no_item` (Task 4), e no teste de que editar o catálogo não toca em quem já está em tratamento (Task 6). Três camadas, porque é o invariante do qual a reprogramação, o contato de retorno, a baixa do épico 6 e a migração das 4 clínicas dependem — e porque é o único que, quebrado, **não produz erro nenhum**: produz uma agenda que escorrega, e a enfermagem descobre quando a última aplicação cai em janeiro.

**A dívida do épico 3, paga, item por item:**

| O que ele deixou | Onde se paga |
|---|---|
| `fechar` devolve 501; `fechamento.service.ts` não existe | **Task 8** |
| `MontadorDePrograma` declarado e não escrito | **Task 7** (e a assinatura é ampliada — ver Interfaces) |
| `procedimentoId` da proposta não validado contra nada | **Task 7**, com 409 nomeando o item, mais **Task 6**, que impede a exclusão de procedimento com proposta viva |
| `MontadorIndisponivel` como provider | **Task 8**, apagado — provider alternativo que ninguém usa é onde a próxima pessoa pluga sem perceber |

**Fora de escopo, de propósito:**

- **A baixa no estoque de verdade.** Aqui só o seam `BaixaDeInsumos`, inerte, mais o teste de que ele é chamado com a dose certa e desfeito na reabertura. O movimento, o lote por FIFO, a sobra de frasco aberto e a análise são o **épico 6**. O invariante que ele terá de honrar está escrito, com teste, na Task 9.
- **"Minhas metas"** — **épico 7**, com a linha do roadmap corrigida. Ver a pergunta 2 ao dono. A enfermagem recebe "Minhas sessões" na tela Programas.
- **A campanha do programa** — o contrato aceita `campanhaId` e o serviço o ignora; a tabela é do **épico 8**, e a coluna entra por expand.
- **"Produtos utilizados" na ficha do paciente** (lote e dose por aplicação) — depende do épico 6, e o acesso a ela passa pelo `especialista-lgpd-saude` antes de existir em tela.
- **A edição de um programa já montado** (trocar o procedimento de um item, acrescentar item). Nem o protótipo nem o `Code.gs` têm isso: encerra-se e monta-se de novo. Anotado em `dividas.md` se a PO pedir.
- **O recebimento avulso com `ref: 'programa'`** — a rota é do épico 4; este épico só torna o 409 dela desnecessário ao preencher `recebimentos.programa_id`. **Confira que o 409 saiu**: se o épico 4 já entrou, a Task 11 tem de destravá-lo, e há teste para isso.

**O risco que fica:** `GET /v1/programas` monta quatro blocos sobre a tabela mais quente do sistema, e dois deles (agenda e lista) varrem todas as sessões abertas da clínica. O índice `sessoes_abertas` é parcial e cresce com o que está **pendente**, não com o histórico — mas a lista de "pacientes em programa com situação" precisa de **todas** as sessões de cada programa ativo para derivar a situação, e isso cresce com o número de programas × sessões. O Passo 6 da Task 11 mede **agora**, com 50 mil tarefas. Se não bastar, a saída é derivar a situação por agregação no SQL — e aí a Task 1 passa a ter uma segunda implementação, que é exatamente o que este projeto existe para não repetir. **Essa decisão é melhor tomada aqui, com o número na mão, do que no épico 9**, quando a clínica com três anos de dado abrir a tela pela primeira vez.
