-- Roda uma vez, na criação do volume. Depois de `fir reset`, roda de novo.
--
-- Dois papéis, e a separação é o ponto: `fir_migrate` é dono do esquema e
-- atravessa a RLS; `fir_app` é quem a aplicação usa e está SUJEITO a ela.
-- Rodar a aplicação com um papel que atravessa a RLS faz todo teste de
-- isolamento passar sem provar nada.

CREATE ROLE fir_migrate LOGIN PASSWORD 'fir_local_dev' BYPASSRLS;
CREATE ROLE fir_app     LOGIN PASSWORD 'fir_local_dev';

GRANT ALL ON SCHEMA public TO fir_migrate;
ALTER SCHEMA public OWNER TO fir_migrate;

-- Tudo que `fir_migrate` criar daqui em diante fica legível e gravável por
-- `fir_app`. Sem isto, cada migration precisaria repetir os GRANTs.
ALTER DEFAULT PRIVILEGES FOR ROLE fir_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fir_app;
ALTER DEFAULT PRIVILEGES FOR ROLE fir_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO fir_app;
