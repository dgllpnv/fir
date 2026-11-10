-- ===========================================================================
-- TRANSPARÊNCIA PARA A CLÍNICA: os grupos que a recebem, com o motivo.
-- Spec: docs/specs/clinica-em-varios-grupos.md §7 e §8 (pendência 1).
--
-- A 0068 criou `grupos_que_recebem_a_clinica()` devolvendo (grupo, desde).
-- Falta o motivo, que o Operador escreveu ao designar. A forma de retorno
-- muda, então a função é recriada (DROP + CREATE; nada depende dela além da
-- rota nova). Forward-only: não toca dado.
--
-- O motivo vem de `participacao_clinica_grupo.motivo`, que guarda o texto cru
-- (o mesmo que o histórico grava com o prefixo "grupo adicionado: ").
--
-- O que a função NUNCA devolve: cliente, valor, contato, outra clínica, grupo
-- de arquivo, grupo desativado. Só o que o filtro por `app_clinica_id()` e as
-- três colunas abaixo deixam passar.
-- ===========================================================================

DROP FUNCTION grupos_que_recebem_a_clinica();

CREATE FUNCTION grupos_que_recebem_a_clinica()
  RETURNS TABLE (grupo text, desde timestamptz, motivo text)
  LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp STABLE AS $$
  SELECT g.nome, p.desde, coalesce(p.motivo, '')
    FROM public.participacao_clinica_grupo p
    JOIN public.grupos g ON g.id = p.grupo_id
   WHERE p.clinica_id = public.app_clinica_id()
     AND p.ate IS NULL
     AND g.ativo
     AND NOT g.arquivo
   ORDER BY p.desde, g.nome
$$;

REVOKE ALL ON FUNCTION grupos_que_recebem_a_clinica() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grupos_que_recebem_a_clinica() TO fir_app;

COMMENT ON FUNCTION grupos_que_recebem_a_clinica() IS
  'Os grupos ativos que recebem a clínica da sessão: nome, desde e motivo. '
  'Nunca cliente, valor, contato nem outra clínica (spec clinica-em-varios-grupos §7).';
