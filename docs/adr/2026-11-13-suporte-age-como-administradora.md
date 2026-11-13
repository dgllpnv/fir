# O superadmin, na sessão de suporte, faz tudo o que a administradora faz

Data: 2026-11-13. Decisão do dono do produto. Substitui a recusa da D-13 ("a sessão do painel não assina rituais da clínica").

## Contexto

A sessão de suporte recusava toda escrita que grava uma pessoa da clínica em coluna `NOT NULL` (`responsavel_id`, `registrado_por`, `fechado_por`…) com a frase "Esta ação é de uma pessoa da clínica, e a sessão do painel não é uma". Na prática, o superadmin não conseguia criar tarefa, registrar recebimento nem fechar o caixa, e a cliente pediu que ele conseguisse tudo.

## Decisão

A sessão de suporte passa a carregar `comoPessoa`: a administradora ativa mais antiga da clínica. `exigePessoa` devolve esse id.

- **A trilha de auditoria continua dizendo `ator_tipo = 'operador'`** com o id do operador (`atorEmColunas` ignora `comoPessoa`). Quem fez de verdade fica registrado, append-only.
- `pessoaDoAtor` continua `null`: "minhas tarefas" do operador segue vazia; nada é lido como se fosse da administradora.
- Sem administradora ativa na clínica, a recusa antiga continua valendo.

## Consequências

- Colunas como `tarefas.responsavel_id` e o `historico` da tarefa mostram a administradora como autora. É a troca que a decisão aceita; a trilha é a fonte de verdade de quem agiu.
- A exigência de motivo (10 a 200 caracteres) para ações destrutivas do suporte não muda.
- Trocar a própria senha continua recusado para o operador (ele não é uma pessoa; a senha dele é do painel).
