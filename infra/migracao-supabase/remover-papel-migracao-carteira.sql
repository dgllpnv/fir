-- Remove o papel da carga ao fim da migração (fase 7: encerramento).
--   psql -U <superusuario> -d fir -f remover-papel-migracao-carteira.sql
-- O papel nunca foi dono de nada; DROP OWNED só retira os GRANTs.
DROP OWNED BY migracao_carteira;
DROP ROLE IF EXISTS migracao_carteira;
