# ADR 0004 — A jornada é uma máquina de estados fechada no servidor

**Data:** 2026-10-25 · **Situação:** aceita · **Épico:** 3

---

## Contexto

A jornada do paciente — *agendado → confirmado → realizado → orçamento → fechado*, com os desvios *faltou*, *desmarcou*, *encerrado* e *perdido* — **só existe no protótipo**. O `Code.gs` da v20 não tem jornada nenhuma: nenhuma coluna `etapa`, nenhum `historico`, nenhum `moverEtapa`. Confirmado por varredura, e isso muda quem manda: **não há discordância a arbitrar**, o protótipo decide sozinho, e as sete divergências abaixo são todas do protótipo **contra ele mesmo**.

O invariante de que tudo decorre:

> **Uma única `Tarefa` anda pelas etapas.** Nunca uma tarefa nova por etapa. `faltou` e `desmarcou` mantêm o cartão **aberto** até alguém reagendar ou encerrar.

Se cada etapa criasse uma tarefa, o funil contaria a mesma paciente cinco vezes, a taxa de no-show seria calculada sobre um denominador inflado, e o painel do épico 8 herdaria o erro sem jeito de encontrá-lo.

E é o único invariante deste épico que, quebrado, **não produz erro nenhum**: produz silêncio, e ninguém liga para quem faltou.

---

## Decisão

**A jornada é uma tabela de dados em `packages/domain`, não um encadeamento de `if`, e o servidor é a única autoridade sobre o que é permitido.**

Três camadas, de propósito:

1. **`TRANSICOES`** (`packages/domain/src/jornada.ts`) — 13 ações, 9 etapas, 23 combinações permitidas. Cada linha declara origem, destino, o `status` resultante, se **conta no funil**, se exige valor e se exige motivo. `transicao()` é uma busca na tabela; nenhum `if (acao === … && etapa === …)` existe no sistema.
2. **`CHECK etapa_combina_com_status`** (migration `0007`) — o par `etapa ↔ status` é amarrado no banco. Nenhum caminho futuro — job, importação, migração das 4 clínicas, `psql` às duas da manhã — consegue gravar um cartão num estado que a tela não sabe mostrar.
3. **A tela** lê a mesma tabela (`acoesDaEtapa`, em `apps/web`), e isso é **conveniência**: o botão que não aparece não é o botão que não pode. Quem recusa é o servidor, com 409.

O cliente **nunca diz para onde o cartão vai** — ele diz o que a recepção **fez**, e `MoverEtapa` é uma união discriminada por `acao`, com `.strict()` em cada ramo. É a diferença entre uma máquina de estados e um campo editável.

---

## As sete divergências, e o porquê de cada uma

| # | Ponto | Protótipo | Nós | Por quê |
|---|---|---|---|---|
| 1 | **Motivo da perda** | o servidor aceita `perder` **sem motivo** — a obrigatoriedade existe só na tela. Medido: `api('moverEtapa',{id,acao:'perder'})` devolve `OK` e grava `nota:""` | **obrigatório no servidor**, resolvido contra a lista da clínica dentro da transação | O KPI diz *"veja os motivos no histórico"*. Sem motivo obrigatório o histórico fica vazio, e o único número que explicaria a perda não explica nada |
| 2 | **O fechamento** | **duas chamadas do cliente**: cria o recebimento e **depois** move o cartão | **uma transação**: recebimento, programa e etapa | Entre as duas cabe uma rede que cai. Quando cai, o dinheiro está lançado e o cartão continua em "Orçamentos em aberto" — a clínica liga para cobrar quem já pagou. É defeito de protótipo, não decisão de produto |
| 3 | **`encerrar`** | `status = 'cancelada'`, a `etapa` **continua** `faltou`/`desmarcou` | `etapa = 'encerrado'` | Lá o cartão só sai do Recontatar porque uma **segunda** coluna é consultada. Aqui, saber onde um cartão está exige **uma** coluna |
| 4 | **Orçar depois de 30 dias** | o **servidor permite**; só a tela esconde o botão | **igual** — o limite fica na tela | A migração do épico 9 precisa registrar orçamento contra consulta antiga, e bloquear no servidor obrigaria o migrador a escrever direto na tabela. É assim que a regra morre |
| 5 | **Cartão concluído sem etapa** | `etapaDe` devolve `agendado` para uma "Consulta agendada" já concluída, e `acoesEsteira` devolve `[]`: **cartão morto**, sem ação possível, no lugar errado do kanban (reproduzido no dado de demonstração, tarefa `h18`) | `etapa` é **coluna**, escrita por quem fez a transição. `etapaDerivada` existe só para o épico 9 preencher o dado migrado **uma vez** — o runtime nunca deriva | Derivar a cada leitura é como a inconsistência vira regra |
| 6 | **`historico[].valor`** | **não é redigido**: `saida()` apaga `valorOrcamento` do topo, mas o valor viaja dentro do histórico e só a **tela** o esconde | o `RedacaoInterceptor` percorre em profundidade, e há teste + prova por mutação | É exatamente o que a regra 17 proíbe. "Só a tela esconde" não é redação de valores |
| 7 | **Permissão** | **nenhuma**: `visivel(t)` libera qualquer tarefa com `pacienteId` para qualquer usuário, e `moverEtapa` não checa nada | `@Exige('jornada')` nas ações e no funil; `fechar` exige **também** `receber` | Sem isso a enfermagem registra orçamento de R$ 9.000. A chave `jornada` já existe na matriz com esta descrição, e Recepção, Comercial e Supervisão já a têm — ninguém perde acesso ao que usa hoje |

E uma divergência de **nome**: o `acaoEm` do protótipo tem **dois significados** — dia do no-show/desmarque **e** dia de retomar o orçamento. Virou **`proximo_passo_em`**: *o dia a partir do qual este cartão volta a pedir ação*. Os dois usos satisfazem essa definição; o nome velho não tinha nenhuma. Com um nome só, Recontatar e "orçamentos para retomar" passam a ser a **mesma** cláusula — no protótipo são duas consultas que já divergiram (Recontatar não filtra por data, retomar filtra).

### Um desvio do plano do épico, e a razão

O plano lista `encerrado` entre os terminais "sem saída nenhuma" e, três linhas depois, recusa `reabrir` só em `orcamento`, `fechado` e `perdido`. As duas frases não podem ser verdade juntas.

**`reabrir` alcança `encerrado`.** O que separa `encerrado` de `fechado` é o **dinheiro**: reabrir um fechado deixaria um `Recebimento` pendurado num atendimento que voltou a não ter acontecido; `encerrado` não tem dinheiro nenhum. Fechar essa porta transformaria um cancelamento por engano em perda definitiva do cartão. `ETAPAS_SEM_SAIDA` (`fechado`, `perdido`) separa "não avança" de "não volta".

---

## Consequências

**O que ganhamos.** Toda transição proibida é **erro de domínio**, não um caso que ninguém escreveu — as 94 recusas da matriz 9×13 estão provadas uma a uma, e as mesmas recusas estão provadas no banco (27 pares `etapa × status`). O funil conta por **`acao` declarada**, não por inferência de rótulo: `reagendar` não infla o denominador. A tela, o servidor e o banco leem a mesma tabela.

**O que custa.** Uma ação nova mexe em três lugares (tabela, `CHECK`, contrato). É deliberado: cada um deles recusa o que os outros dois deixariam passar, e o terceiro é o banco, que nenhum caminho contorna.

**O que fica aberto.** `fechar` em orçamento **com programa montado** devolve **501** até o épico 5 trocar a linha do `MontadorDePrograma` em `jornada.module.ts`. A proposta inteira fica gravada em `programa_orcado` desde o `registrarOrcamento` — nada se perde. E o `procedimentoId` dessa proposta **não é validado contra catálogo nenhum**, porque a tabela `procedimentos` não existe: quem fizer o épico 5 valida na montagem.

---

## Alternativas rejeitadas

**Uma tarefa por etapa.** É o desenho mais óbvio e o que quebra o funil: a mesma paciente apareceria cinco vezes, a conversão seria calculada sobre um denominador inflado, e a taxa de no-show mediria o número de cartões, não o de pacientes que faltaram. Pior, o erro é invisível — os números continuam saindo, só que errados.

**`etapa` como campo livre editável.** O cliente mandaria a etapa de destino. Seria uma linha a menos de contrato e a máquina de estados deixaria de existir: qualquer cliente — a tela nova, um script de importação, um `curl` — gravaria `fechado` sem recebimento nenhum.

**Motivo de perda como `ENUM` do Postgres.** Exigiria uma migration por motivo novo, e as 4 clínicas têm vocabulários diferentes. A lista **é** o relatório: ela só vira gestão quando a clínica pode acrescentar o motivo que de fato ouve ao telefone — *"esperando o marido decidir"*, *"foi para o convênio"*. É também o mesmo padrão de `origem` do paciente, que já é dado; duas listas de mesma natureza com modelagens diferentes é dívida nascendo.

**Contar o funil pela `etapa` do evento, em vez da `acao`.** É o que o protótipo faz por inferência, e foi medido com mutação: `reagendar` grava `etapa: 'agendado'`, então remarcar duas vezes transforma **1 agendamento em 3**. Toda conversão do funil cairia sem que nada tivesse piorado na clínica.

**Guardar o nome do motivo só por `id`, ou só por texto.** Com só o id, renomear "Preço" para "Preço acima do esperado" **reescreve o relatório do trimestre passado**. Com só o nome, não dá para agrupar. O evento guarda os dois: o agrupamento usa o id, a leitura usa o nome gravado no instante.

**Dinheiro como número dentro do `jsonb`.** O `jsonb` guarda `numeric` exato, então o banco não perderia precisão — mas `JSON.parse`, do lado do Node, devolve `number`, e `number` perto de dinheiro é a assinatura que a regra 1 proíbe atravessar. Centavos em **texto**, a mesma convenção do transporte. Bônus: a redação vira `valor: null` sem conversão.
