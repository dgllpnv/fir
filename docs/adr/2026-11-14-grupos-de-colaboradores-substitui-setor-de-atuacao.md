# ADR — Grupos de colaboradores (substitui a ADR 0025, Setor de atuação)

**Status:** aceita · 2026-11-14. Decisões do dono Q1–Q9 ("sim" a todas), gate de risco aprovado com
as emendas E-S e E-L do spec `docs/specs/pedidos-da-cliente-grupos-estoque-financeiro.md`.
**Substitui:** ADR 0025 (`0025-setor-de-atuacao-e-tarefa-para-o-setor.md`), aceita em 2026-11-09 e
**nunca construída** — nenhuma tabela, coluna ou rota dela existe. Nenhum dado a migrar.
**Relacionadas:** ADR 0003 (desativar não apaga), ADR 0013 §2 (o que não atravessa para a carteira),
D-13 (sessão de suporte), regras 16, 18, 19, 20, 21 do `CLAUDE.md`.
**Divergência do protótipo:** sim, deliberada. O protótipo atribui toda tarefa a uma pessoa
(`responsavelId` obrigatório). Tarefa para grupo, assumir e transferir são decisão nova do dono.

## O que muda em relação à 0025

| Decisão | 0025 (Setor de atuação) | Esta ADR (Grupo de colaboradores) |
|---|---|---|
| Quantos por pessoa | **um** (`pessoas.setor_de_atuacao_id`) | **zero a vários** (`membros_de_grupo`) |
| Onde mora o vínculo | coluna em `pessoas` | tabela de vínculo, com trilha de auditoria própria |
| Quem conclui tarefa do coletivo | solicitante, membro ou `tarefas.equipe` | **só membro do grupo ou `tarefas.equipe`** (S3) |
| Quem assume | não existia | membro fixa a tarefa nele (`assumir`), concorrência resolvida no banco |
| Transferência | só mudar o destino | **evento próprio** no `historico` (`atribuir`/`transferir`/`assumir`) |
| Cadeia de tarefas | não existia | `tarefa_origem_id` + `GET v1/tarefas/:id/fluxo` |
| Quem conta na produção | `concluida_por` (coluna) | **não definido nesta fatia**: o `porId` do evento é o registro; a atribuição de meta a quem concluiu fica para decisão do produto |
| Exclusão | soft delete só com setor vazio | **desativa**, nunca exclui; com tarefas abertas pede confirmação e devolve a contagem |

## Decisão

1. **Grupo** é uma lista nomeada de **colaboradores** da clínica, criada por quem tem `config`.
   **Não é um perfil de acesso e não autoriza nada por si**: quem lê uma tarefa de grupo passa pelas
   mesmas permissões (`jornada`, `valores`, `pacientes`) que passaria numa tarefa atribuída a si.
2. **Destino exclusivo (Q1).** Uma tarefa vai para uma pessoa **ou** para um grupo — `CHECK
   tarefa_tem_destino`: exatamente um de `responsavel_id` / `grupo_id` é não nulo. Nunca uma pessoa
   "de enfeite" numa tarefa de grupo.
3. **Pessoa em vários grupos (Q2).** O vínculo é estado (`removido_em`), nunca `DELETE`: o histórico
   de quem pertenceu a que grupo é dado de RH e a trilha de auditoria o preserva.
4. **Pertencer é lido do banco, na transação da própria requisição.** Nunca do cliente, nunca da
   sessão, nunca copiado na tarefa. Pessoa **desativada** e grupo **desativado** deixam de valer na
   requisição seguinte. `Autor.grupoIds` carrega só grupos **ativos** de pessoa **ativa**.
5. **Assumir** é o `UPDATE` condicional (`WHERE grupo_id = $g AND responsavel_id IS NULL AND status =
   'aberta' AND excluida_em IS NULL` + membro): a perdedora da corrida recebe 409 e o evento só
   existe quando `rowCount = 1`. Depois de assumida a tarefa é de pessoa (`responsavel_id` = ela,
   `grupo_id` = NULL).
6. **Transferir** troca o destino (pessoa ativa ou grupo ativo, da mesma clínica) de tarefa
   **aberta**, por quem a tem hoje (responsável, membro do grupo atual) ou `tarefas.equipe`. No-op
   se `de == para`. O evento entra por `historico || $evento` (atômico) e o histórico tem teto.
   **Sessão de programa nunca vai para grupo**: a baixa de estoque assina a dose na pessoa que a
   aplica, e tarefa de grupo não tem pessoa.
7. **Eventos do fluxo** em `historico`: `{acao: atribuir|transferir|assumir, de:{tipo,id}, para:{tipo,id},
   porId, em, nota?}`. Sem `etapa` — os leitores da jornada filtram por `acao`/`etapa` e os ignoram.
   `nota` ≤ 200, com o aviso fixo "Não escreva nome de paciente nem dado de saúde", e **nunca em log
   nem em mensagem de erro**.
8. **Fluxo** (`GET v1/tarefas/:id/fluxo`): cadeia por `tarefa_origem_id`, profundidade < 20, ids
   visitados contra ciclo, `clinica_id` fixo. Cada nó passa pelo mesmo filtro de visibilidade de
   `GET v1/tarefas/:id`; nó oculto é marcador opaco; nó com paciente exige o acesso de paciente. A
   rota é `@DadoSensivel('pacientes')`. `tarefa_origem_id` só aponta para tarefa do **mesmo
   paciente** ou **sem paciente** — a cadeia nunca atravessa para outro paciente.
9. **Privacidade (L5).** A composição de um grupo e a carga por pessoa são dado de RH: só `config`.
   Qualquer pessoa vê o **nome** dos grupos ativos (precisa para criar e transferir tarefa); a
   lista de membros só `config`.
10. **Sessão de suporte é recusada** em criar tarefa com grupo, assumir, transferir e em toda escrita
    de grupo e de vínculo (E3): são rituais da clínica, não configuração que o suporte conserte.

## Consequências

- `tarefas.responsavel_id` passa a aceitar NULL. Todo leitor precisa tolerar `NULL`
  (`LEFT JOIN pessoas`); a saída (`TarefaNaLista`) ganha `grupoId`, `grupoNome` e `destino`.
- Tarefa de grupo **não conta** na meta nem no prazo de ninguém até ser assumida. Atribuir a conta a
  quem concluiu sem assumir é decisão de produto pendente (a 0025 resolvia com `concluida_por`).
- A migration é expand-only: colunas nuláveis e uma constraint que os dados já migrados satisfazem.
- `Setor de atuação` deixa de existir como termo vivo; o glossário o marca como substituído.

## Desvios do spec, registrados na implementação

- **A tabela se chama `grupos_da_equipe`, não `grupos`**: `grupos` já existe na carteira (migration
  0025) e outro significado. O termo de domínio continua **Grupo**; só o nome físico difere.
- **`membros_de_grupo` tem `id` como PK mais `UNIQUE (clinica_id, grupo_id, pessoa_id)`**, em vez de
  PK composta: o teste `auditoria-inescapavel` exige a coluna `id` em toda tabela auditada, porque o
  trigger `registrar_auditoria` grava `entidade_id` a partir dela.
- **Cadeia do mesmo paciente é regra de banco (0089)**: trigger que recusa `tarefa_origem_id` de
  outro paciente (origem sem paciente aceita qualquer filha; origem com paciente exige o mesmo) e a
  troca de paciente de quem tem filhas de outro. O serviço de edição devolve 400 com mensagem, e a
  leitura do fluxo opaca nó divergente como terceira camada.

## LGPD — a audiência de uma tarefa de grupo

Atribuir uma tarefa **com paciente** a um grupo dá acesso a ela, e portanto ao paciente nela, a **todos
os membros do grupo**: é equivalente a atribuí-la individualmente a cada um. Por isso: só `config`
põe pessoa em grupo (nunca no próprio vínculo), a composição é dado de RH, e o nó de paciente no
fluxo continua exigindo a permissão `pacientes`. Quem monta o grupo decide a audiência — a tela de
cadastro deve dizer isso.
