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
| `login` | v20 | ✅ | `POST /v1/entrar`. **Muda de forma por D-3:** e-mail e senha com Argon2id e sessão opaca, no lugar de `uid`+`pin` em texto puro em cada requisição |
| `alterarPin` | v20 | ⬜ | Vira *trocar senha*. O PIN sai e não volta como credencial primária (D-3) |

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
| `salvarUnidade` | v20 | ⬜ | **Fica no plano de admin-da-clínica**, não no épico 2. A tabela `unidades` já nasceu completa na migration `0006`, com RLS e trilha; falta a rota. Toda tela do épico 2 já a lê por `GET /v1/unidades` |

## Épico 3 — Jornada do paciente

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `moverEtapa` | `POST /v1/tarefas/:id/jornada` · `GET /v1/jornada` | ✅ | Uma rota, união discriminada por ação; motivo de perda obrigatório no servidor; fechamento numa transação; funil contado por `acao` declarada. `fechar` com programa é 501 até o épico 5. Ver ADR 0004 |

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
| `salvarPlano` | v20 | ⬜ | `Plano` do legado = **catálogo**. Nunca chamar só "plano" (CONTEXT.md) |
| `excluirPlano` | v20 | ⬜ | |
| `criarAdesao` | v20 | ⬜ | `Adesão` do legado = **programa do paciente**. Termo proibido isolado |
| `encerrarAdesao` | v20 | ⬜ | |
| `excluirAdesao` | v20 | ⬜ | |

## Épico 6 — Estoque

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `salvarItemEstoque` | — | ⬜ | As três unidades do item |
| `importarItensEstoque` | — | ⬜ | |
| `salvarLocalEstoque` | — | ⬜ | |
| `movEstoque` | — | ⬜ | **Append-only** (regra 12). Correção é movimento novo, nunca edição |
| `criarContagem` | — | ⬜ | Contagem às cegas |
| `salvarContagem` | — | ⬜ | |
| `ligarCodigoItem` | — | ⬜ | GS1/EAN |
| `entradaNota` | — | ⬜ | XML de NF-e |

## Épico 7 — Pessoas

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `salvarPessoa` | v20 | ⬜ | Salário atrás de `pessoas.gerir` |
| `excluirPessoa` | v20 | ⬜ | |
| `pessoasOp` | — | ⬜ | Ativar, desativar, operações em lote |
| `salvarPerfis` | — | ⬜ | Perfis de permissão da clínica |
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
