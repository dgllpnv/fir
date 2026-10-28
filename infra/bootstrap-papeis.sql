-- Roda uma vez, na criação do volume. Depois de `fir reset`, roda de novo.
--
-- Dois papéis, e a separação é o ponto: `fir_migrate` é dono do esquema e
-- atravessa a RLS; `fir_app` é quem a aplicação usa e está SUJEITO a ela.
-- Rodar a aplicação com um papel que atravessa a RLS faz todo teste de
-- isolamento passar sem provar nada.

-- A senha abaixo está em claro de propósito: vale só para este container
-- local, que escuta apenas em 127.0.0.1, com dados descartáveis. Nunca a
-- reutilize fora daqui. Ver infra/README.md.
CREATE ROLE fir_migrate LOGIN PASSWORD 'fir_local_dev' BYPASSRLS;
CREATE ROLE fir_app     LOGIN PASSWORD 'fir_local_dev';

-- O TERCEIRO PAPEL: o painel do superadmin (migration 0013).
--
-- D-5, restrição 5: duas conexões separadas POR AUTENTICAÇÃO, nunca por
-- `SET ROLE` — `RESET ROLE` desfaz na mesma transação, e aí o privilégio de
-- criar clínica passa a existir na conexão que serve o balcão, com nada além
-- da disciplina impedindo.
--
-- SEM `BYPASSRLS`, e esta é a linha mais importante do arquivo: o superadmin
-- fixa `app.clinica_id` da clínica em que opera, como qualquer um (D-10). Um
-- painel que atravessa a RLS desfaz o isolamento que sustenta o produto, e
-- faz todo teste de isolamento passar sem provar coisa nenhuma.
--
-- Ele NÃO nasce em migration: `fir_migrate` não tem `CREATEROLE`, e dar-lhe
-- esse privilégio para criar um papel privilegiado é trocar o problema de
-- lugar. Aqui (criação do volume) no ambiente local; em produção, no
-- `infra/producao/provisionar-painel.sh`, que lê a senha do `.env`. A 0013
-- FALHA ALTO se ele faltar, ou se alguém lhe der BYPASSRLS.
--
-- ⚠️ Este arquivo só roda na CRIAÇÃO DO VOLUME. Depois de editá-lo, `fir
-- reset` é obrigatório — sem ele a 0013 falha com "o papel fir_painel não
-- existe", e o sintoma não aponta para a causa. Ver infra/README.md.
CREATE ROLE fir_painel  LOGIN PASSWORD 'fir_local_dev';

GRANT ALL ON SCHEMA public TO fir_migrate;
ALTER SCHEMA public OWNER TO fir_migrate;

-- Sem isto, a migration 0001 falha com "permission denied to create
-- extension pgcrypto" — mesmo sendo `pgcrypto` uma extensão `trusted`
-- (instalável por não-superusuário), o Postgres ainda exige privilégio
-- CREATE no *banco* (não só no schema) para rodar CREATE EXTENSION. Dono do
-- schema `public` não basta.
GRANT CREATE ON DATABASE fir TO fir_migrate;

-- Tudo que `fir_migrate` criar daqui em diante fica legível e gravável por
-- `fir_app`. Sem isto, cada migration precisaria repetir os GRANTs.
ALTER DEFAULT PRIVILEGES FOR ROLE fir_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fir_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fir_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fir_app;
