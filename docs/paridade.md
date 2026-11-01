# Paridade — a lista conferível

O épico 9 exige "paridade verde". Sem esta lista, *paridade* é uma palavra: ninguém
consegue dizer se chegou. Aqui está o que ela significa, ação por ação.

**A fonte é o `demoApiBase` do `prototipo-rotinas-de-gestao.html` — 59 ações distintas.**
Elas são o contrato de servidor que a PO escreveu, e o protótipo tem autoridade: divergir
dele é decisão de produto e vira ADR, não bug.

**A v20 em produção implementa 21 dessas 59.** As 38 restantes — estoque inteiro,
financeiro inteiro, documentos, férias, horas, perfis e metas de pessoa — existem só no
protótipo. Paridade é **as 59**, não as 21: foi o que o dono pediu ("tudo o que ela
escreveu"). O que roda hoje nas 4 clínicas está marcado **v20** e tem precedência
operacional quando os dois discordarem.

Legenda de estado: ⬜ não começou · 🟡 em andamento · ✅ pronto e testado

---

## Épico 1 — Fundação

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `login` | v20 | ✅ | `POST /v1/entrar`. **Muda de forma por D-3 e D-10:** **clínica + usuário + senha** com Argon2id e sessão opaca, no lugar de `uid`+`pin` em texto puro em cada requisição. Não há e-mail |
| `alterarPin` | v20 | ✅ | Virou *trocar senha* (`POST /v1/eu/senha`), com **troca obrigatória no primeiro acesso** por guard global e revogação das outras sessões. O PIN sai e não volta como credencial primária (D-3). A regra de força mora em `packages/domain/senha-forte.ts` e vale na criação e na troca, nunca na entrada |

## Épico 2 — Núcleo da rotina

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `criarTarefa` | v20 | ✅ | `POST /v1/tarefas`. **`quando` virou união discriminada:** agendada · retroativo · série. O protótipo descobre "retroativo + recorrente" em tempo de execução; aqui a combinação não tem como ser escrita |
| `editarTarefa` | v20 | ✅ | `PATCH /v1/tarefas/:id`, com `serie: boolean` para alcançar as próximas em aberto. **`pagamento` não existe neste corpo** — editar não conclui |
| `atualizarTarefa` | v20 | ✅ | **Virou três rotas:** `POST :id/concluir`, `:id/cancelar`, `:id/reabrir`. O `status` sem lista branca do protótipo é defeito dele; empilhar as três num campo foi como ele ficou sem validação |
| `excluirTarefa` | v20 | ✅ | `DELETE /v1/tarefas/:id?serie=true\|false`. **Soft delete** (`excluida_em`), não `DELETE` de linha — regra 20 |
| `salvarPaciente` | v20 | ✅ | `POST /v1/pacientes` e `PATCH /v1/pacientes/:id` |
| `excluirPaciente` | v20 | ✅ | **Virou desativar** (`DELETE /v1/pacientes/:id` = soft delete), e **as tarefas ficam**. Os dois legados apagam paciente, tarefas e adesões; a regra 20 vence os dois. Ver [ADR 0003](adr/0003-paciente-desativado-nao-apaga-tarefa.md) |
| `importarPacientes` | v20 | ✅ | `POST /v1/pacientes/importar`, idempotente — a chave de nome sai do Postgres, não de uma cópia em TypeScript (regra 26) |
| `salvarUnidade` | v20 | ✅ | `POST /v1/unidades` e `PATCH /v1/unidades/:id`, em `UnidadesController` **próprio** com `@Exige('config')` na classe — pendurá-las em `ClinicaController` herdaria a ausência de `@Exige` dele (as listas de apoio são de todos) e a recepção passaria a cadastrar unidade. A LEITURA (`GET /v1/unidades`) continua sem permissão: escolher a unidade de um atendimento é parte de atender. O nome é único pelo nome NORMALIZADO, **pelo índice** — ler-depois-escrever perde a corrida entre duas abas, e aí a recepção fica com duas "Unidade Pituba" e metade do caixa em cada. Mais a tela `/unidades` |

## Épico 3 — Jornada do paciente

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `moverEtapa` | `POST /v1/tarefas/:id/jornada` · `GET /v1/jornada` | ✅ | Uma rota, união discriminada por ação; motivo de perda obrigatório no servidor; fechamento numa transação; funil contado por `acao` declarada. **`fechar` com programa deixou de ser 501 no épico 5:** ele monta o programa pelo mesmo `MontadorDePrograma` de `POST /v1/programas`, na **mesma transação** do recebimento e da etapa, e o `MontadorIndisponivel` foi apagado. Ver ADR 0004 e [ADR 0006](adr/0006-programa-montado-por-itens.md) |

## Épico 4 — Financeiro

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `fecharCaixa` | — | ✅ | Conferência às cegas provada **no corpo HTTP**: em dia aberto a chave `esperado` não existe. Sem `valores`, a equipe recebe `conferido`, nunca a diferença (ADR 0005) |
| `salvarConta` | — | ✅ | Contas a pagar, com âncora de dia 31 na recorrência |
| `excluirConta` | — | ✅ | Conta já paga não se exclui — apagá-la mudaria o resultado do mês |
| `pagarConta` | — | ✅ | |
| `registrarCobranca` | — | ✅ | Saldo derivado e **agrupado por programa** — a segunda implementação, que colapsava num total, foi apagada |
| `finConfig` | — | ✅ | Categoria desconhecida cai em *Outras despesas* em vez de sumir da soma |
| `salvarMetaFin` | — | ✅ | Sem `valores`, a meta entrega só o **percentual** |

## Épico 5 — Programas

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `salvarPlano` | v20 | ✅ | `POST /v1/procedimentos` e `PATCH /v1/procedimentos/:id`. **`Plano` virou `Procedimento`** — nunca chamar só "plano" (CONTEXT.md). O `PATCH` é **parcial**: `SalvarProcedimento` tem `.default()`, e usá-lo no `PATCH` reescreveria o rótulo da sessão e apagaria os descartáveis ao desativar um procedimento |
| `excluirPlano` | v20 | ✅ | `DELETE /v1/procedimentos/:id`. **Soft delete** (regra 20) — o protótipo dá `splice`, o `Code.gs` dá `deleteRow`, e o histórico dessas pacientes depende do item. E a recusa **alcança também as propostas vivas** (`tarefas.programa_orcado`), que nenhum dos dois confere — era o buraco D-J2 do épico 3 |
| `criarAdesao` | v20 | ✅ | `POST /v1/programas`, com o **mesmo `MontadorDePrograma`** que o `fechar` usa — uma porta só para as duas entradas. **`Adesão` virou `Programa`**, montado por `Item do programa`. `@Exige('programas')` na rota e `receber` cobrado no serviço quando o corpo traz dinheiro: a enfermagem monta o programa, o pagamento vai pela tela Recebimentos. O protótipo não exige nada |
| `encerrarAdesao` | v20 | ✅ | `POST /v1/programas/:id/encerrar`, com `@Exige('programas.gerir')` no lugar do `me.admin` do `Code.gs`. Sessões abertas e contatos de retorno viram `cancelada`; as realizadas ficam no histórico; o **estoque fica intocado** — as doses saíram do frasco |
| `excluirAdesao` | v20 | ✅ | `DELETE /v1/programas/:id`. **Soft delete, e recusa (409) quando há recebimento vivo** nas sessões — D-8, e diverge do MANUAL dela. Sessões e contatos de retorno vão com soft delete; o **pagamento da adesão e o cartão de orçamento são desvinculados e preservados**; o estoque é compensado, nunca apagado. Ver [ADR 0006](adr/0006-programa-montado-por-itens.md) |

## Épico 6 — Estoque

**O seam `BaixaDeInsumos` está LIGADO.** Ele nasceu inerte no épico 5, com o
invariante escrito como teste antes de o estoque existir; agora
`estoque/baixa-relacional.ts` o implementa, `BaixaInerte` foi **apagada** (e não
deixada como provider alternativo, que é onde a próxima pessoa pluga sem
perceber — lição do `MontadorIndisponivel`), e as asserções daquele arquivo
foram portadas para `estoque/baixa.test.ts`, **contra Postgres de verdade**.

Duas coisas que a referência em memória não podia provar e agora estão provadas:
o banco **recusa** o `DELETE` de movimento, e a idempotência de `desfazer` mora
no **esquema** (`UNIQUE (compensa_id)`) — não num `Set` em processo, que a
corrida entre duas abas vence. A trigger `compensacao_espelha_a_origem` cobra
item, tipo, **lote** e quantidade oposta, porque `CHECK` não vê outra linha.

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `salvarItemEstoque` | — | ✅ | `POST /v1/estoque` e `PATCH /v1/estoque/:id`. **As três unidades são colunas**, e cada conversão viaja inteira ou não viaja: `CHECK compra_declarada_por_inteiro` no banco e união discriminada no contrato. O protótipo aceita `unidCompra: caixa` sem fator, grava, e descarta na leitura — a clínica cadastra "caixa", não vê erro, e a entrada em caixas não aparece como opção. A **contagem inicial** é um MOVIMENTO de tipo `contagem`, nunca um campo: saldo é derivado (regra 11), e não há coluna `saldo` em `itens_de_estoque` |
| `importarItensEstoque` | — | ✅ | `POST /v1/estoque/importar`. **Idempotente três vezes** (regra 26) por `ON CONFLICT` nos dois índices únicos parciais da `0015` — código normalizado e nome normalizado —, nunca por um `SELECT` antes do `INSERT`. E **completa, nunca sobrescreve** (regra 27): o que a clínica digitou permanece, o vazio é preenchido. O `WHERE` do `DO UPDATE` é o que faz "nada a completar" ser distinguível de "completei", senão a terceira reimportação diria que mexeu em 300 itens |
| `salvarLocalEstoque` | — | ✅ | `POST` e `PATCH /v1/estoque/locais`. `NULLS NOT DISTINCT` no índice de nome: "sem unidade" é **um** balde que deduplica, como no protótipo (`(l.unidadeId||"") === (x.unidadeId||"")`) — com o padrão do Postgres, duas "Geladeira" sem unidade passariam, e a clínica de um endereço só é justamente a que teria duas |
| `movEstoque` | — | ✅ | `POST /v1/estoque/movimentos`, **append-only nas duas camadas** (regra 12): `REVOKE UPDATE/DELETE` para `fir_app` e trigger que alcança o DONO. **União discriminada por tipo** — no protótipo é um objeto solto com uma pilha de `if`, e `custo` num consumo é descartado em silêncio. O **sinal vem do tipo**; no ajuste vem de `sentido: faltou | sobrou`, porque `Number(m.sinal)===1 ? 1 : -1` faz um corpo sem `sinal` **tirar** do estoque. Consumo gera a **sobra** pelo mesmo `baixaDoItem` da baixa automática. Data futura é recusada pelo dia do SERVIDOR no fuso da clínica |
| `criarContagem` | — | ⬜ | Contagem às cegas. **O esperado não atravessa antes do fechamento** (regra 14) — e a rota dela entra em `ROTAS_DE_CONFERENCIA`, não em `ROTAS_FORA_DA_CONFERENCIA`, onde as três rotas de leitura do estoque estão por não serem agregado de dia nenhum |
| `salvarContagem` | — | ⬜ | |
| `ligarCodigoItem` | — | ⬜ | GS1/EAN |
| `entradaNota` | — | ⬜ | XML de NF-e |

## Épico 7 — Pessoas

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `salvarPessoa` | v20 | 🟡 | **Parcial, e a parte de ACESSO está fechada.** `POST /v1/pessoas` cria a pessoa já ativa, com senha provisória gerada no servidor e devolvida **uma vez** — o admin redefine e **nunca vê** (corrige o defeito da D-0: na v20 ele vê o PIN). `GET /v1/pessoas` lista, `PATCH /v1/pessoas/:id` muda nome, função, acesso e ativação, `POST /v1/pessoas/:id/senha` redefine e derruba as sessões. Tela `/usuarios`, com as duas abas dela. **Falta a ficha** (contrato, documentos, férias, horas) e o salário atrás de `pessoas.gerir` — épico 7 |
| `excluirPessoa` | v20 | ✅ | **Virou desativar**, pelo `PATCH /v1/pessoas/:id` com `{ ativo: false }` — regra 20, e a mesma decisão da [ADR 0003](adr/0003-paciente-desativado-nao-apaga-tarefa.md) para paciente. Não há `DELETE`: o protótipo oferece "inativar" **e** "excluir de vez", e as duas produzem o mesmo efeito observável (quem está inativo não entra — `login` exige `u.ativo`), com uma diferença só: a segunda apaga a linha e deixa as tarefas antigas apontando para um id inexistente, que ele contorna copiando o NOME para dentro de cada tarefa. Desativar **derruba as sessões vivas** e **revoga o cookie**, para que "tirei o acesso dela" seja verdade no instante do toque |
| `pessoasOp` | — | 🟡 | **A parte de ACESSO está pronta** no `PATCH /v1/pessoas/:id`: ativar, desativar e trocar perfil. As invariantes moram em `packages/domain/pessoa.ts` — `podeDesativar`, `podeTrocarAcesso`, `podeRemoverPerfis` —, **uma função para os dois caminhos**, e é aí que o protótipo se perde: a regra "a clínica não fica sem administrativo ativo" existe no `excluirPessoa` dele e **não** no `salvarPessoa`, que é o caminho pelo qual a tela desmarca "Ativa". A última administradora desmarca a própria caixa, sai, e ninguém da clínica abre Configurações de novo. Falta o resto do `pessosOp` — ficha, férias, documentos, metas, horas e 1:1 (épico 7) |
| `salvarPerfis` | — | ✅ | `GET` e `PUT /v1/pessoas/perfis`. `PUT` porque a tela edita a matriz toda e manda a matriz toda. Perfil que sai do corpo é **desativado, nunca apagado** (regra 20): `pessoas.perfil_id` de uma pessoa INATIVA referencia a linha, e um `DELETE` chegaria à tela como erro de constraint sobre um perfil que ninguém usa mais. Chave de permissão inválida é **400** — o protótipo a descarta em silêncio (`.filter(k => PERMS.some(…))`), e aí o perfil "salva com sucesso" sem ela |
| `ficha` | — | ⬜ | Ficha e contrato |
| `doc` | — | ⬜ | Documento com validade |
| `excluirDoc` | — | ⬜ | |
| `ferias` | — | ⬜ | |
| `excluirFerias` | — | ⬜ | |
| `horas` | — | ⬜ | Banco de horas |
| `config` | — | ⬜ | `limiteHoras` do banco de horas |
| `conversa` | — | ⬜ | 1:1 |
| `meta` | — | ⬜ | Meta mensal manual |
| `excluirMeta` | — | ⬜ | |
| `copiarMetas` | — | ⬜ | Copiar as metas de um mês para outro |
| `realizado` | — | ⬜ | Realizado manual contra a meta |

### Os 8 indicadores automáticos (`IND_PES`)

Não são CRUD — são **contagens derivadas** que alimentam a meta automática da pessoa e o
painel. Cada uma precisa bater com a definição do legado, e é onde número divergente vai
aparecer na migração.

| Ação | v20 | Estado | O que conta |
|---|---|---|---|
| `agendamentos` | — | ⬜ | eventos `agendado` |
| `confirmacoes` | — | ⬜ | eventos `confirmado` |
| `contatos` | — | ⬜ | concluídas que são contato |
| `recebimentos` | — | ⬜ | concluídas que são recebimento |
| `orc_qtd` | — | ⬜ | concluídas do tipo *Pagamento de orçamento* |
| `orc_valor` | — | ⬜ | soma em R$ das mesmas |
| `tarefas_prazo` | — | ⬜ | **percentual** no prazo, excluindo pagamentos e canceladas |
| `contagens_prazo` | — | ⬜ | **percentual** de contagens de estoque no prazo |

## Épico 8 — Campanhas e painel

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `salvarCampanha` | v20 | ⬜ | |
| `excluirCampanha` | v20 | ⬜ | |
| `importarCampanha` | v20 | ⬜ | |

## Transversal

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `carregar` | v20 | ⬜ | **Não vira uma rota.** É o bootstrap da v20: devolve a clínica inteira numa resposta. Na nossa arquitetura vira uma rota por recurso, paginada, cada uma com sua permissão. Ver a nota abaixo — ela é a diferença mais consequente da lista |

### Por que `carregar` não vira uma rota

Na v20, `carregar` devolve tudo de uma vez e o cliente filtra. Isso tem três consequências
que o desenho novo não pode herdar:

1. **A autorização fica no cliente.** O legado já tenta corrigir isso apagando dinheiro
   para não-admin (`Code.gs:310`), mas só para dinheiro, e só nessa resposta.
2. **Cresce com a clínica, não com a tela.** Uma clínica com anos de histórico paga o
   custo inteiro para abrir a tela Hoje.
3. **O registro de acesso perde sentido.** A regra 18 pede registro de *acesso* a dado de
   saúde. "A recepção carregou tudo" não é um registro útil; "a recepção abriu a ficha da
   paciente X" é.

Trocar `carregar` por rotas por recurso **não é divergência de produto** — a tela que a PO
desenhou continua idêntica. É a mesma informação, buscada por partes.

---

## Como este arquivo se mantém honesto

- Uma ação só vira ✅ quando tem rota, contrato em `packages/contracts`, teste e trilha de
  auditoria. "Funciona na tela" não é ✅.
- Ação que divergir do protótipo deixa de ser linha desta tabela e vira ADR em `docs/adr/`,
  com a divergência escrita. Não existe divergência silenciosa.
- O épico 9 só fecha com **as 59 linhas em ✅** e o relatório de conferência por clínica
  batendo exatamente (regra 28: migração sem reconciliação é cópia).

---

## A conferência de migração, escrita antes de migrar

A regra 28 cobra totais que batem **exatamente, por clínica**. As igualdades abaixo são escritas
**no épico em que o módulo nasce** e executadas no épico 9, e a ordem importa: escrita depois, a
conferência é desenhada já conhecendo o resultado da migração, e aí ela confirma o migrador em
vez de medi-lo.

**Um único registro divergente reprova a clínica inteira.** Não existe "99% migrado".

### Épico 5 — programas (as seis que o épico 9 vai cobrar)

| # | A igualdade | Por que esta, e o que ela pega |
|---|---|---|
| 1 | **Quantidade de programas** por clínica = quantidade de `Adesoes` vivas da v20 | O piso. Uma adesão que o migrador não enxergou é uma paciente em tratamento que desapareceu da agenda da enfermagem |
| 2 | **Quantidade de sessões por programa** = quantidade de linhas de `Tarefas` com aquele `adesaoId` | As 4 clínicas já reprogramaram e **cancelaram sessões à mão**. O migrador não recria a série a partir de `(início, n, intervalo)` — ele traz as linhas que existem. Se a contagem bater pela soma e não linha a linha, uma sessão cancelada voltou a existir |
| 3 | **`Σ itens.sessoes` = `adesoes.sessoes`** da v20 | A v20 **guarda** o derivado; nós não (ADR 0006). A igualdade é o que prova que descartá-lo foi seguro. Divergência aqui significa que a conversão "uma adesão = um item `i1`" perdeu ou inventou sessão |
| 4 | **`modo_de_cobranca` idêntico**, campo a campo | `saldo` × `avulso` decide se a dívida aparece no `Saldo em aberto`. Errado para menos, a clínica perde a cobrança; errado para mais, ela cobra quem já pagou |
| 5 | **Saldo por programa idêntico** ao `pacientesComSaldo` da v20 | É a regra 28 escrita no `CLAUDE.md` (*saldo por adesão*), e é a cobrança que a clínica roda toda semana. O nosso saldo é **derivado** de `recebimentos`; o da v20 é campo. Esta é a igualdade que cruza as duas modelagens |
| 6 | **Contatos de retorno abertos idênticos** | A v20 cria **um por adesão**, nós criamos **um por item** — e para o dado migrado (um item `i1`) as duas regras têm de dar o mesmo resultado. Divergência aqui é a regra nova vazando para dado antigo, e o sintoma é uma paciente recebendo duas ligações de "você já pode repetir" |

**O que fica fora de propósito, e vale dizer:** o **rateio** do valor negociado entre os itens
(ADR 0006) **não existe na v20 nem no protótipo** — `criarAdesao` só grava `itens[].valor` quando o
cliente o manda. Não há com o que comparar, e a conferência não finge que há. O que ela compara é a
igualdade que o rateio garante: `Σ itens.valor` = o valor total do programa migrado.

---

# Parte 2 — As telas, e o manual dela

As 59 ações acima são o **contrato do servidor**. Elas não descrevem as telas, e
foi assim que duas delas quase ficaram sem destino: `salvarUnidade` e
`salvarPlano` não tinham onde morar na nossa interface, porque tratamos
"Configurações" como uma tela só quando no desenho dela é um **grupo com três**.

Esta parte veio de ler a navegação do protótipo rodando, e o manual embutido.

## A navegação dela, lida da tela

```
Hoje  (com contador)
Tarefas
+ Nova tarefa          ← ação, estilo diferente de item de menu
+ Recebimento          ← ação

GESTÃO
  Comercial     (grupo recolhível, com contador) → Jornada do paciente · Pacientes · Programas · Campanhas
  Financeiro    (grupo) → Recebimentos · Caixa do dia · Contas a pagar · Cobranças · Visão do mês
  Processos     (grupo) → Estoque
  Pessoas       (grupo) → Equipe · Minhas metas
  Painel geral
  Configurações (grupo) → Unidades · Usuários e acessos · Procedimentos
  Ajuda e manual

rodapé: avatar · nome · Trocar meu PIN · Sair
```

**Três coisas que isso nos ensinou:**

1. **"Recebimento" é ação fixa na lateral**, não só uma tela de lista. Registrar
   pagamento é frequente o bastante para ganhar atalho permanente.
2. **"Equipe" e "Usuários e acessos" são telas diferentes**, e a diferença
   importa: Equipe é ficha, contrato, férias e metas — RH. Usuários e acessos é
   login, perfil e ativação. Juntar põe **salário e permissão na mesma tela**,
   com públicos diferentes.
3. **Os grupos dela recolhem com submenu suspenso**, por isso a lateral nunca
   rola. A nossa mostra tudo aberto e rola ~100 px no perfil de administrador.
   Divergência consciente, anotada — reabre se incomodar.

## O manual dela — 14 capítulos, 77 seções

É a documentação funcional em linguagem de usuário, e é o melhor inventário de
regra de negócio que existe neste projeto. **Entregar a ferramenta sem ele é
entregar metade:** é como a clínica aprende.

| Cap. | Seções | Épico |
|---|---|---|
| 1 · Visão geral | Para que serve · Perfis de acesso · Como o menu está organizado · Cuidado com dados de pacientes | 9 |
| 2 · Acesso | Entrar · Primeiro acesso da clínica · **Trocar o PIN** → trocar senha · Usar no celular | 1 |
| 3 · Tela Hoje | O que aparece · Filtros de pessoa · Cartão da tarefa | 2 |
| 4 · Tarefas | Criar · **Lançar algo que já aconteceu** · Tarefas que se repetem · Concluir × Editar · Jornada: agendamento até fechamento · Tela Jornada · Cancelar e excluir · Buscar e filtrar | 2, 3 |
| 5 · Tipos de contato | Agenda · Atendimento · Orçamento · Pagamentos · Relacionamento | 2, 3 |
| 6 · Atendimentos e pagamentos | Consulta agendada que aconteceu · Registrar recebimento · **Consulta ou recebimento da consulta?** · Programa em andamento × novo · Pagamento parcial e saldo · Orçamento com programa ou catálogo · **O que conta como receita** | 3, 4 |
| 7 · Pacientes | Cadastrar · Importar lista · Tela de relacionamento · Ficha · Excluir | 2 |
| 8 · Programas | Como funcionam · Catálogo · Nova adesão · **Baixa automática no estoque** · Concluir sessão · Contatos dentro do programa · Tela Programas · Fim e contato de retorno · Encerrar ou excluir | 5, 6 |
| 9 · Campanhas | No dia a dia · Criar · Métricas da meta · Importar lista · Acompanhar resultados | 8 |
| 10 · Painel | Período · Cumprimento de prazos · Pacientes no período | 8 |
| 11 · Cadastros da gestão | **Equipe · Unidades · Procedimentos** | 1, 2, 5 |
| 12 · Estoque | Como funciona · Locais · Cadastrar itens · **Unidades de medida** · **QR: etiquetas e leitura pelo celular** · Importar do sistema principal · **Entrada pela nota** · Entradas e saídas · **Gerar lista de contagem** · **Análise do estoque** | 6 |
| 13 · Gestão de pessoas | Ficha · **Alertas** · Metas do mês · Conversas 1:1 · Banco de horas | 7 |
| 14 · Financeiro | Para que serve · Caixa do dia · Contas a pagar · **Categorias de despesa** · Cobranças · Visão do mês | 4 |

**Em negrito, o que não aparecia em lugar nenhum do nosso planejamento** antes
desta leitura. Dois merecem destaque porque são regra, não tela:

- **"Consulta ou recebimento da consulta?"** e **"O que conta como receita"** —
  é a regra 3 do `CLAUDE.md` escrita por ela, na linguagem da recepção. Ela já
  sabia que contar o pagamento duas vezes é o erro clássico.
- **"Lançar algo que já aconteceu"** — registro retroativo. Muda o desenho da
  criação de tarefa: não é só agendar para a frente.

Mais **35 perguntas frequentes** em 7 capítulos, que são o texto de ajuda da
interface.
