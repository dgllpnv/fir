# Carregador da migração do Supabase (carteira da Firmare)

Plano e decisões: `docs/migracao/supabase-carteira.md`; ADR: `docs/adr/2026-11-11-migracao-supabase.md`.
Este diretório é público: nada de dado real aqui. Só roda contra Postgres **local** (`127.0.0.1` / `localhost`);
qualquer outro host é recusado. Para operar a produção, o Operador abre um túnel SSH para uma porta local e aponta a
URL para `127.0.0.1:<porta>` (o carregador não sabe, e não deve saber, que o outro lado é remoto).

    tsx infra/migracao-supabase/cli.ts --dump <dump.csv>                      # --dry-run (padrão), sem banco
    tsx infra/migracao-supabase/cli.ts --dump <dump.csv> --correspondencia <proposta.json>  # SÓ LÊ o banco
    tsx infra/migracao-supabase/cli.ts --dump <dump.csv> --aplicar            # carga + conferência, uma transação
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
