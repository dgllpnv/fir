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
| `criarTarefa` | v20 | ⬜ | |
| `editarTarefa` | v20 | ⬜ | |
| `atualizarTarefa` | v20 | ⬜ | Conclusão, cancelamento, mudança de status |
| `excluirTarefa` | v20 | ⬜ | |
| `salvarPaciente` | v20 | ⬜ | |
| `excluirPaciente` | v20 | ⬜ | |
| `importarPacientes` | v20 | ⬜ | |
| `salvarUnidade` | v20 | ⬜ | |

## Épico 3 — Jornada do paciente

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `moverEtapa` | — | ⬜ | Invariante do épico: uma só `Tarefa` anda pelas etapas; `faltou` e `desmarcou` mantêm o cartão aberto |

## Épico 4 — Financeiro

| Ação | v20 | Estado | Nota |
|---|---|---|---|
| `fecharCaixa` | — | ⬜ | Conferência às cegas: o esperado não pode vazar antes do fechamento |
| `salvarConta` | — | ⬜ | Contas a pagar |
| `excluirConta` | — | ⬜ | |
| `pagarConta` | — | ⬜ | |
| `registrarCobranca` | — | ⬜ | |
| `finConfig` | — | ⬜ | Categorias e configuração financeira |
| `salvarMetaFin` | — | ⬜ | Meta do mês |

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
