# Ensaio da subida 0067-0070 (grupo Firmare / clinica em varios grupos)

Dados 100% sinteticos. Local: Postgres 4832, banco descartavel `fir_ensaio`. Rode da raiz do repo (usa `pg` de `apps/api`).

    C=postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir_ensaio
    # criar o banco (superusuario do container) e dar o schema ao dono
    docker exec fir-postgres psql -U fir -d postgres -c "CREATE DATABASE fir_ensaio OWNER fir_migrate"
    docker exec fir-postgres psql -U fir -d fir_ensaio -c "ALTER SCHEMA public OWNER TO fir_migrate" \
      -c "ALTER DEFAULT PRIVILEGES FOR ROLE fir_migrate IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO fir_app"
    node infra/ensaio-migracao/aplicar-ate.mjs $C 0066           # estado de producao
    node infra/ensaio-migracao/semear.mjs $C                      # imprime o uuid do operador
    node infra/ensaio-migracao/conferir.mjs foto $C antes.json
    node infra/ensaio-migracao/aplicar-ate.mjs $C 0070 0067       # as quatro migrations
    # backfill como dono, 3 vezes: SELECT * FROM preencher_grupo_firmare('<uuid do operador>')
    node infra/ensaio-migracao/conferir.mjs comparar $C antes.json   # exit != 0 se divergir
    node infra/ensaio-migracao/conferir.mjs foto $C depois1.json      # (apos 1a execucao)
    node infra/ensaio-migracao/conferir.mjs identica depois1.json depois3.json   # idempotencia
    docker exec fir-postgres psql -U fir -d postgres -c "DROP DATABASE fir_ensaio"

## Em producao
Somente `conferir.mjs` (e o backfill, que e a decisao do dono). Ele so faz SELECT, dentro de `BEGIN READ ONLY`, e a foto guarda ids, grupo_id, contagens e somas, nenhum dado pessoal.
Use o papel dono do banco (atravessa a RLS; com `fir_app` as contagens sairiam zeradas e o script nao detectaria). Precisa do modulo `pg` (rode dentro do container da api).
`foto` antes das migrations, `comparar` depois do backfill. Antes do backfill o `comparar` reprova de proposito (falta o Firmare nas clinicas).
Ajustes esperados que o script ja conhece: +1 grupo Firmare (0067), +1 grupo inativo `Encerrados` (0068), linhas de auditoria.
`aplicar-ate.mjs` e `semear.mjs` sao so do ensaio local: nunca em producao.

## Prova de que o comparador reprova (ensaio de 2026-11-10)
Depois do backfill, movidos de grupo com `set_config('app.pessoa_id','operador:<uuid>',true)` na mesma transacao: 1 tarefa
(`tarefas_internas`) e 1 cliente sem clinica (o banco recusa mover reuniao avulsa, FK composta, e cliente com clinica; o
`UPDATE` do cliente leva junto 6 reunioes e 1 parceiro por ON UPDATE CASCADE). `comparar` saiu com codigo 1 e 18 divergencias,
apontando `tarefas_internas`, `clientes_carteira`, `reunioes_comerciais`, `parceiros_do_cliente` (linhas movidas, hash de
(id, grupo_id), contagem por grupo) e o MRR dos dois grupos. Revertido: `comparar` voltou a APROVADO, codigo 0. Banco apagado.
