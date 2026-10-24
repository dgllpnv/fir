# ADR 0003 — Desativar paciente não apaga tarefa

**Data:** 2026-10-24
**Situação:** aceita
**Decide:** `product-rotina-clinica` com `engenheiro-backend`
**Substitui:** nada

## Contexto

`excluirPaciente` existe nos dois lados da herança, e os dois fazem a mesma
coisa:

- **Protótipo (`demoApiBase`):** remove o paciente de `db.pacientes`, remove
  **todas as tarefas** com aquele `pacienteId` e remove **todas as adesões**.
- **`Code.gs` v20:** `sh.deleteRow` do paciente, laço de `deleteRow` sobre as
  tarefas do paciente (contando quantas, para devolver `{ id, tarefas: n }`) e
  `deleteRow` sobre as adesões.

A tela avisa antes: *"a exclusão apaga também as tarefas vinculadas"*, com o
número.

Como a regra geral do projeto é *"o protótipo é a especificação; onde ele e o
`Code.gs` discordam, o `Code.gs` ganha"*, a leitura preguiçosa seria: os dois
concordam, logo copie. Mas a concordância aqui é sobre **o que o Google Sheets
permitia fazer barato**, não sobre o que a clínica precisa.

O que se apaga junto com as tarefas de um paciente:

- o **atendimento concluído**, com a data e quem atendeu;
- a partir do épico 4, o **recebimento** pendurado naquela tarefa — dinheiro
  que entrou no caixa e foi conferido no fechamento;
- a partir do épico 6, a **dose aplicada**, com produto e lote.

Um cadastro duplicado criado por engano e "excluído" pela recepção levaria
junto o histórico clínico e financeiro do paciente certo, se o engano tiver
sido escolher a linha errada na lista. Não há desfazer.

E a regra 20 do `CLAUDE.md` já decidiu isto em geral: *soft delete e trilha de
auditoria append-only em toda escrita financeira, de estoque e de RH;
desativar clínica ou pessoa é um estado, nunca uma exclusão.*

## Decisão

**`DELETE /v1/pacientes/:id` desativa. Não apaga nada.**

1. `pacientes.ativo` vai a `false` e `desativado_em` recebe `now()`. A
   restrição `desativado_tem_instante` impede os dois estados discordarem.
2. **As tarefas ficam**, intactas, com `excluida_em IS NULL`. Nenhuma cascata.
3. A resposta continua sendo `{ id, tarefas: n }` — o mesmo contrato da v20 —,
   mas `n` passa a significar *"quantas ficaram"*, e não *"quantas serão
   apagadas"*.
4. O paciente desativado **sai das listas** (`WHERE p.ativo` em toda consulta
   de listagem) e **libera o nome**: `pacientes_nome_unico` é parcial em
   `ativo`, então quem desativou por engano consegue recadastrar.
5. **A ficha dele continua abrindo por id.** Quem precisa auditar um
   atendimento de dois anos atrás precisa chegar nele.
6. A permissão é `pacientes.gerir` — divergência do `Code.gs`, que exige
   `me.admin` apenas porque a v20 não tem matriz de permissão. Isso não é
   discordância, é modelo novo.

## Consequências

- **A tela muda de texto.** O aviso passa de *"a exclusão apaga também as
  tarefas vinculadas"* para *"o cadastro sai das listas; o histórico fica"*. É
  parte do ticket da tela de Pacientes (épico 2, Task 13), não acabamento.
- **A contagem de pacientes exclui inativos.** Todo indicador de "pacientes
  cadastrados" filtra `ativo`. Um indicador que contasse os desativados mudaria
  de valor sem nada ter acontecido na clínica.
- **A migração do épico 9 importa todos como ativos.** A v20 não tem o estado
  "inativo": um paciente que a clínica excluiu lá simplesmente não existe na
  planilha, e portanto não chega. Quem migrar não precisa procurar a coluna —
  ela não existe — mas precisa saber que o histórico das 4 clínicas **já perdeu**
  o que foi excluído antes da migração. Isso é irrecuperável e não é defeito
  desta decisão; é o motivo dela.
- **Reativar ainda não existe.** Hoje a volta é recadastrar, e o nome está
  livre. Uma rota de reativação é barata e entra quando alguém pedir; antes
  disso, seria código sem uso com um caminho de autorização a defender.
- **`recebimentos.paciente_id` é `NOT NULL` e continua apontando.** O saldo e o
  LTV de um paciente desativado continuam calculáveis — e precisam continuar,
  porque dinheiro em aberto não some porque o cadastro saiu da lista.

## Alternativa rejeitada — apagar em cascata, como os dois fazem

Preserva a paridade literal e é menos código. Rejeitada por duas razões, e a
segunda sozinha bastaria:

1. **A trilha de um atendimento concluído é prova, não conveniência.** Ela
   responde "quem atendeu, quando, quanto entrou, que lote foi aplicado". Um
   `DELETE` em cascata apaga a resposta e também a pergunta: depois dele,
   ninguém sabe que havia algo ali.
2. **A trilha de auditoria é append-only, e a exclusão ficaria nela de
   qualquer jeito** — o trigger `registrar_auditoria` grava `removeu` com o
   `de` inteiro de cada linha apagada. Apagar em cascata não faria o dado sumir:
   faria ele migrar das tabelas de negócio, onde tem controle de acesso por
   perfil e redação de valores, para `de`/`para` de `auditoria`, que é a rota
   mais ampla do sistema. O resultado líquido seria **menos** proteção, não mais.

## Alternativa rejeitada — bloquear a desativação quando houver tarefa

"Não dá para desativar: existem 4 tarefas." Rejeitada porque transforma o caso
comum (cadastro duplicado, criado na pressa, com uma tarefa já criada em cima)
no caso impossível, e a recepção resolveria renomeando o cadastro para
`NÃO USAR` — que é pior do que desativar sob todos os aspectos, inclusive o de
auditoria.
