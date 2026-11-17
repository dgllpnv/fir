-- ===========================================================================
-- As chaves `indicadores` e `indicadores.gerir` nos perfis que já existem
-- (I-33; molde da 0075).
--
-- Quem tem `painel` (o Painel geral) ganha as duas: é a gestão que já lê os
-- indicadores da clínica. Clínica NOVA já as recebe por `perfisPadrao()`
-- (`pf_sup`).
--
-- IDEMPOTENTE e GENTIL:
--   * acrescenta só a chave que falta — rodar duas vezes não duplica nada, e
--     um perfil que já tem uma das duas ganha só a outra;
--   * não toca perfil EXCLUÍDO (regra 27: o que a clínica apagou fica como está);
--   * não tira chave de ninguém, e não cria perfil.
--
-- Forward-only, EXPAND: só UPDATE de `perms`. Roda pelo papel dono
-- (BYPASSRLS); o ator é o sistema, para a trigger de auditoria (regra 20).
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

UPDATE perfis p
   SET perms = p.perms
       || CASE WHEN 'indicadores' = ANY (p.perms) THEN '{}'::text[] ELSE ARRAY['indicadores']::text[] END
       || CASE WHEN 'indicadores.gerir' = ANY (p.perms) THEN '{}'::text[] ELSE ARRAY['indicadores.gerir']::text[] END
 WHERE 'painel' = ANY (p.perms)
   AND p.excluido_em IS NULL
   AND NOT (p.perms @> ARRAY['indicadores', 'indicadores.gerir']::text[]);
