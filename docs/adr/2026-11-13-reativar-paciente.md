# ADR 2026-11-13 — Reativar paciente desativado

**Data:** 2026-11-13
**Situação:** aceita
**Decide:** `product-rotina-clinica` com `engenheiro-backend`
**Substitui:** a consequência "Reativar ainda não existe" do ADR 0003 (o resto do 0003 segue valendo)

## Contexto

O ADR 0003 adiou a reativação: "entra quando alguém pedir". A cliente pediu
("o cadastro tá desativado, eu nem consigo reativar"). Além disso, a ficha de
um paciente desativado mostrava "Editar cadastro", e salvar devolvia 404
(`UPDATE ... WHERE ativo`), que manda a recepção procurar um cadastro que ela
está vendo na tela.

## Decisão

1. **`POST /v1/pacientes/:id/reativar`**, `@Exige('pacientes.gerir')` (o mesmo
   gate de desativar) e `@DadoSensivel('pacientes')`. Devolve o cadastro
   (`PacienteNaLista`), status 201.
2. `UPDATE pacientes SET ativo = true, desativado_em = NULL WHERE id = $1 AND NOT ativo`
   em `naClinica`. A restrição `desativado_tem_instante` exige limpar os dois.
   Nada mais é tocado: tarefas, recebimentos e programas nunca saíram do lugar,
   então LTV e saldo não mudam.
3. Erros: 404 se não existe ou é de outra clínica (a RLS não confirma nada de
   fora); 409 "Este cadastro já está ativo." na segunda chamada; 409 "Já existe
   um paciente ativo com este nome. Ajuste o nome de um deles antes de
   reativar." quando o nome, liberado ao desativar, foi tomado
   (`pacientes_nome_unico`, índice parcial em `ativo`). A mensagem não nomeia
   nem descreve o outro paciente.
4. A trilha é a do trigger `registrar_auditoria` (de `ativo=false` para
   `ativo=true`, com o autor). Sessão de suporte age como `operador`, igual a
   desativar; não há `exigePessoa` aqui porque reativar não assina ritual da
   clínica.
5. **`PATCH /v1/pacientes/:id` em cadastro desativado devolve 409** "Este
   cadastro está desativado. Reative para editar." (e 404 só quando o id não
   existe ou é de outra clínica). Nada é gravado.
6. Na ficha: faixa "Cadastro desativado" com o botão "Reativar cadastro" só
   para quem tem `pacientes.gerir`; "Editar cadastro" e "Nova tarefa" ficam
   escondidos enquanto desativado.

## Consequências

- Desativar por engano deixa de ser definitivo; recadastrar não é mais o único
  caminho (e criava um segundo cadastro, partindo o histórico).
- Reativar com nome tomado exige que alguém renomeie um dos dois antes. Mesclar
  cadastros continua fora de escopo.
- Sem migration: o esquema já comporta.

## Emenda de 2026-11-13 — revisão de segurança e LGPD
- **Motivo no Suporte (I1).** Desativar e reativar pela sessão de suporte exigem `motivo` (corpo, 10 a 200
  caracteres); a pessoa da clínica continua sem. Vai para `auditoria.motivo` (migration 0079). Ver a emenda em
  `2026-11-13-excluir-tarefa-com-estorno-e-suporte.md` e a D-27 em `docs/decisoes.md`.
- **Paciente desativado não entrega o telefone (I3)** em `/v1/tarefas`, Hoje e tarefas da campanha. Ele
  continua na ficha (reativar a devolve), e o prazo e a anonimização do estado "desativado" estão em
  `docs/compliance/retencao.md`. Esconder as tarefas ABERTAS desses pacientes das listas é decisão de
  produto pendente do dono; **não** foi feito.

## Emenda de 2026-11-13 — tarefas abertas de desativado saem das listas (decisão do dono)
- **Esconder é filtro de leitura, nada é apagado.** A tarefa ABERTA de paciente desativado some de `/v1/tarefas`,
  `/v1/hoje` (dia, pendentes, faixa da semana, aviso de ocultas) e dos contadores de prazo do painel geral
  (`atrasadas`/`a vencer`, por pessoa e por unidade). Concluídas e canceladas ficam (histórico); a ficha do desativado
  continua mostrando tudo; reativar devolve as abertas como estavam. Implementação: uma constante,
  `FORA_DE_PACIENTE_DESATIVADO` (`apps/api/src/tarefas/leitura.ts`), usada por todas essas leituras.
- **Divergência do protótipo:** ele não tem desativar paciente, então não responde; vale a decisão do dono.
- **Fora do filtro, de propósito:** o funil da jornada (conversão histórica por janela, não é lista de trabalho).
  Pendentes de outras frentes (campanhas, programas/sessões) estão listados na entrega e não foram tocados.

## Emenda — desativar com motivo
**Contexto.** Quando o titular pede para sair (não ser contatado), desativar não pode ser desfeito por engano, e
desativar não registrava por quê.

1. **Desativar exige `razao`** no corpo do `DELETE /v1/pacientes/:id`: enumeração fechada `pediu-para-sair`,
   `duplicado`, `erro-de-cadastro`, `outro` (contrato `DesativarPaciente`), mais `detalhe` opcional de até 200
   caracteres (a tela avisa "não escreva dado de saúde"). Sem razão: 400. O `motivo` de 10 a 200 do operador de
   suporte continua exigido, à parte.
2. **Onde mora.** Migration **0081**: `pacientes.motivo_desativacao` e `detalhe_desativacao` (CHECK do conjunto
   fechado, 200 caracteres, e só preenchidos com `ativo = false`). Coluna, e não só a trilha, porque a regra de
   reativar precisa LER a razão e ler texto da trilha seria frágil. A trilha continua: o trigger grava o de/para das
   colunas, e `app.motivo` (0079) leva `razao[: detalhe]` a `auditoria.motivo` (na sessão de suporte vale a
   justificativa do operador). Desativados antes da 0081 ficam com razão `NULL` e reativam como sempre.
3. **Reativar quem `pediu-para-sair`** exige `confirmoQueOTitularPediu: true` e `motivo` (10 a 200): sem a
   confirmação, 409; sem motivo válido, 400. A razão é lida do banco dentro da transação (`FOR UPDATE`), nunca do
   corpo. Para as demais razões, reativar segue simples. Reativar limpa as duas colunas; o que havia fica no de/para.
4. **Ficha.** `FichaDoPaciente.desativacao` (razão, detalhe, instante) só sai para quem tem `pacientes.gerir`; para
   os demais é `null`. A tela mostra a razão e, em "pediu para sair", reativa em duas etapas (aviso; depois checkbox
   e motivo), no estilo da exclusão de tarefa.
