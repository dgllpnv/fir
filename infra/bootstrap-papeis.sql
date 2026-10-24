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
