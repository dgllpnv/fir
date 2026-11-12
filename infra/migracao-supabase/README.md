# Carregador da migração do Supabase (carteira da Firmare)

Plano e decisões: `docs/migracao/supabase-carteira.md`; ADR: `docs/adr/2026-11-11-migracao-supabase.md`.
Este diretório é público: nada de dado real aqui. Só roda contra Postgres **local** (`127.0.0.1` / `localhost`);
qualquer outro host é recusado. Para operar a produção, o Operador abre um túnel SSH para uma porta local e aponta a
URL para `127.0.0.1:<porta>` (o carregador não sabe, e não deve saber, que o outro lado é remoto).

    tsx infra/migracao-supabase/cli.ts --dump <dump.csv>                      # --dry-run (padrão), sem banco
    tsx infra/migracao-supabase/cli.ts --dump <dump.csv> --correspondencia <proposta.json>  # SÓ LÊ o banco
    tsx infra/migracao-supabase/cli.ts --dump <dump.csv> --aplicar            # carga + conferência, uma transação
    ... --simular-mapa-de-usuarios | --aplicar-mapa-de-usuarios   # segunda passada: ver a seção própria abaixo
    ... --excluir <lista.txt>             # registros retidos p/ leitura da dona (colecao;id), fora do repo
    ... --saida <arquivo>                 # relatório COM valores (centavos)
    ... --metas-para-decisao <arquivo>    # CSV das metas rejeitadas por regra do domínio
    (os arquivos de saída só podem estar FORA do repositório: `saida_dentro_do_repositorio`)

Ambiente: `FIR_MIGRACAO_DATABASE_URL`; `FIR_MIGRACAO_USUARIO_CARGA` (uuid do usuário de carga, inativo);
`FIR_MIGRACAO_GRUPO` (padrão: o grupo `padrao`); `FIR_MIGRACAO_MAPA_USUARIOS` (JSON fora do repo,
`{"u1": "<uuid do usuário de gestão>"}`; cada destino precisa existir, a carga nunca cria conta; o dry-run mostra
quantas referências ficam nulas); `FIR_MIGRACAO_CORRESPONDENCIA` (JSON fora do repo, `{origem: "NOVO" | "EXISTENTE:<uuid>"}`);
`FIR_MIGRACAO_INCLUIR_GLOBAIS=1` (só com o dono do esquema; ver abaixo).

**Saída.** O stdout leva só contagens, códigos e OK/REPROVA; valores aparecem como `[oculto]`. Valores só em `--saida`.

**Garantias do carregador.** Só `INSERT ... ON CONFLICT DO NOTHING` (nunca UPDATE/DELETE, nem em cliente existente: o que
haveria a completar é relatado, não feito). Uma transação por grupo, com `pg_try_advisory_xact_lock`: segunda execução
concorrente no mesmo grupo é recusada. A conferência roda dentro da transação; divergência = ROLLBACK. Não cria conta,
não gera cobrança nem receita (P-18), não cria lançamento de abertura de meta.

## Papel de banco `migracao_carteira` (fecha o resíduo de privilégio)

Migration `0074` (policies) + `criar-papel-migracao-carteira.sql` / `remover-papel-migracao-carteira.sql` (superusuário;
**não são migrations**, porque `fir_migrate` não tem CREATEROLE). Ordem: aplicar migrations até a 0074, criar o papel.

- sem BYPASSRLS, sem superusuário, **dono de nada**, **não é membro de `fir_carteira`**;
- GRANT só `SELECT, INSERT` nas 11 tabelas da carga, `SELECT` em cobranças (prova de receita zero), `SELECT (id, ativo)`
  em `grupos` e `SELECT (id)` em `usuarios_gestao`. **Nenhum UPDATE, DELETE ou TRUNCATE**: o banco recusa;
- a 0074 cria policies só de SELECT e INSERT (`TO migracao_carteira` explícito, com `app_pode_ver_grupo`).
  Nas 9 tabelas cobertas pela 0074, mesmo que alguém conceda UPDATE/DELETE por engano, a RLS forçada não deixa tocar uma linha (teste). Em `tarefas_internas` e `rotinas_internas` a policy da carteira é `FOR ALL` sem `TO`, então o único bloqueio é o GRANT: nunca conceda UPDATE/DELETE ali;
- escopo de linha: a carga fixa `app.escopo = 'grupo'` e `app.grupo_id` do grupo destino.

## Tabelas globais (mensagens, roteiros, biblioteca): procedimento do Operador

Escrever nelas exige `app_carteira_pode_administrar()`. O papel de carga **não tem** essa permissão e não finge ter: com
ele, esses documentos ficam **retidos** (`tabela_global_exige_administrar_fora_do_papel_da_carga`) e o relatório os conta
("Tabelas globais: N documentos; retidos para o Operador M"). Nenhuma permissão nova foi criada. Para carregá-los:

1. Fechar a carga do grupo com o papel `migracao_carteira` (conferência aprovada, relatório assinado).
2. O **Operador** (dono do esquema, sob a mesma janela e o mesmo backup) roda o mesmo comando com
   `FIR_MIGRACAO_INCLUIR_GLOBAIS=1` e a URL de `fir_migrate`. O que já existe dá `ja_existia`; entram só as globais.
   Chave que já existe no destino (modelos semeados pela 0054) **não é sobrescrita**: o relatório diz se o texto difere.
3. Alternativa sem o carregador: criar cada mensagem/roteiro/material pela tela de cadastros com a conta de administração.

## Testes

`teste/migracao-supabase.test.ts` e `teste/migracao-supabase-correspondencia.test.ts` (Postgres local, dados sintéticos;
o papel precisa existir: `docker exec -i fir-postgres psql -U fir -d fir -v senha="'<senha>'" < infra/migracao-supabase/criar-papel-migracao-carteira.sql`).

## Segunda passada: mapa de usuários (`--aplicar-mapa-de-usuarios`)

A carga não cria conta, então `responsavel`/`solicitante` entraram NULL (ADR 2026-11-11, Decisão 4 item 2). Depois
que a equipe existir em `usuarios_gestao`, esta passada preenche só o que está NULL.

    ... --dump <dump.csv> [--excluir <retidos.txt>] --simular-mapa-de-usuarios                # mesma transação, SEMPRE ROLLBACK
    ... --dump <dump.csv> [--excluir <retidos.txt>] --aplicar-mapa-de-usuarios [--producao]   # grava (COMMIT) se a conferência fechar

Colunas tratadas: `clientes_carteira.responsavel_usuario_gestao_id` (`colaboradora_id`),
`rotinas_internas.responsavel_usuario_gestao_id`, `tarefas_internas.responsavel_usuario_gestao_id` e
`.solicitante_usuario_gestao_id`. **Fora, de propósito:** `por` de check-in e `registrada_por` de reunião são NOT NULL e a
carga os gravou com o usuário de carga (a trilha diz a verdade: quem lançou foi a carga); trocar seria sobrescrever.

Regras: só `UPDATE ... WHERE coluna IS NULL` (nunca sobrescreve; quem já tem dono é preservado e, se difere do mapa, só
é contado); nunca cria conta, linha ou apaga; só toca linhas do `FIR_MIGRACAO_GRUPO` cujo id vem do dump (uuid v5, igual
à carga); cliente casado com existente (`EXISTENTE:<uuid>`) tem outro id e nunca é tocado. Idempotente: a 2ª e a 3ª
execução atualizam 0 linhas. Origem sem chave no mapa fica NULL e é relatada (`origem#N`, ordinal, nunca o id), não
adivinhada: completar o mapa e rodar de novo preenche só o que faltava. Uma transação com a mesma trava
`pg_try_advisory_xact_lock` da carga; por coluna a conferência exige
`linhas presentes = nulos antes + já preenchidos`, `nulos antes = preenchidos + sem mapa`, `nulos depois = sem mapa`, e
uma releitura prova que o depois é o antes mais exatamente os preenchimentos. Divergiu: ROLLBACK, exit 1. O mapa é
validado antes de tocar em linha: destino uuid, existente, ativo, e de escopo `geral` ou do grupo (o gatilho
`clientes_carteira_confere_vinculos` recusaria o contrário no meio da passada). Saída: contagens e códigos.

**Papel de banco (decisão de menor risco).** `migracao_carteira` só tem SELECT/INSERT e **continua assim**: não se cria
migration nem GRANT de UPDATE (em `tarefas_internas` e `rotinas_internas` o GRANT seria a única barreira, e o papel
passaria a poder reescrever a carteira inteira). A segunda passada roda com o **dono do esquema** (`fir_migrate`), como as
globais, sob a mesma janela e o mesmo backup. A trava correspondente é invertida em relação à da carga: com `--producao`
o nome do banco tem de ser repetido em `FIR_MIGRACAO_CONFIRMA_BANCO` e o papel `migracao_carteira` é **recusado**
(`segunda_passada_exige_o_dono_do_esquema_nao_o_papel_de_carga`). O papel precisa ver as linhas (BYPASSRLS ou membro de
`fir_carteira`), senão recusa (`papel_sem_acesso_as_linhas_da_carteira`) em vez de "fechar a conta em zero".
`--aplicar-mapa-de-usuarios` não combina com `--aplicar` (`modos_exclusivos`).

**Passo a passo do Operador (dono):**

1. Criar as contas da equipe pelo fluxo que já existe (Marillia, Ana, Manu, Eduarda); anotar o uuid de cada uma:
   `SELECT id, usuario FROM usuarios_gestao WHERE ativo`. Elas têm de estar ativas.
2. Escrever, **fora do repositório**, o JSON do mapa, uma chave por id de origem dos `perfis` (u1..u4 no dump) apontando
   para o uuid de destino: `{"u1": "<uuid>", "u2": "<uuid>", "u3": "<uuid>", "u4": "<uuid>"}`.
   Quem é quem na origem vem do dump (`perfis`); o repositório nunca traz o nome.
3. Túnel SSH, backup e janela como na carga. Conectar com a URL do **dono do esquema** (não a de `migracao_carteira`):
   `FIR_MIGRACAO_DATABASE_URL`, `FIR_MIGRACAO_CONFIRMA_BANCO=<banco>`, `FIR_MIGRACAO_GRUPO`,
   `FIR_MIGRACAO_MAPA_USUARIOS=<caminho do JSON>`.
4. **Simular primeiro:** `... --dump <dump.csv> --excluir <retidos.txt> --simular-mapa-de-usuarios --producao`. Ler o
   relatório: todas as linhas `OK`, `sem correspondencia no mapa` zero (ou aceito), e `preservados com valor diferente do
   mapa` zero (se não, alguém já atribuiu à mão: conferir, nada é sobrescrito).
5. **Aplicar:** o mesmo comando com `--aplicar-mapa-de-usuarios`. Rodar de novo: tem de dar 0 linhas atualizadas.
6. Usar o mesmo `--excluir` da carga: o que ficou retido não está no destino e aparece em "sem linha no destino".

## Carga em produção (só com o "pode" do dono; quem digita senha é o dono)

O carregador só fala com `127.0.0.1`. Para a VPS, o dono abre um túnel SSH e a porta local leva ao
Postgres do container (que não publica porta). Nada disto roda sem o deploy das migrations `0073` a `0075`.

1. **Papel de carga** (uma vez, o dono digita a senha): `criar-papel-migracao-carteira.sql` como dono do esquema.
2. **Túnel** (janela própria, fica aberta):
   `ssh -i <chave> -N -L 127.0.0.1:4843:<IP do container postgres>:5432 root@<VPS>`
   O IP sai de `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <container postgres>`.
   Porta local livre qualquer (4843 evita o Postgres local, 4832, e a 4833, que costuma estar ocupada).
3. **Autor da carga: um usuário que já existe.** Não se cria conta em produção. Use o id de um
   `usuarios_gestao` ativo de escopo `geral` (o Operador que roda a carga):
   `SELECT id, usuario FROM usuarios_gestao WHERE escopo = 'geral' AND ativo`. A trilha de auditoria
   passa a dizer, com verdade, quem rodou a carga. Vai em `FIR_MIGRACAO_USUARIO_CARGA`.
4. **Ensaio primeiro**, numa cópia restaurada do backup no Postgres local (mesmo comando, sem `--producao`).
5. **Variáveis:** `FIR_MIGRACAO_DATABASE_URL=postgresql://migracao_carteira:<senha>@127.0.0.1:4843/<banco>`,
   `FIR_MIGRACAO_CONFIRMA_BANCO=<banco>` (repetido de propósito), `FIR_MIGRACAO_GRUPO`,
   `FIR_MIGRACAO_USUARIO_CARGA`, `FIR_MIGRACAO_CORRESPONDENCIA` (aprovações do passo de casamento).
6. **Casamento dos clientes** (só lê): `--correspondencia <proposta.json>`; aprovar como `NOVO` ou `EXISTENTE:<uuid>`.
7. **Carga:** `... --dump <dump.csv> --excluir <retidos.txt> --aplicar --producao`. `--producao` recusa
   se o nome do banco não for repetido em `FIR_MIGRACAO_CONFIRMA_BANCO` e se a conexão não for do papel
   `migracao_carteira` (as globais do Operador, `FIR_MIGRACAO_INCLUIR_GLOBAIS=1`, são a única exceção).
   A conferência roda antes do COMMIT; divergência desfaz tudo.
8. **Depois:** fechar o túnel, remover o papel (`remover-papel-migracao-carteira.sql`). O Supabase não é tocado.
