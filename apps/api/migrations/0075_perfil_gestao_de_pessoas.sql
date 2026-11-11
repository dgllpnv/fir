-- ===========================================================================
-- Perfil padrão "Gestão de pessoas" (chave `pf_ges`) nas clínicas que já existem
-- (P-2, decidida pelo dono em 2026-11-10; ADR 2026-11-11, spec admin-da-clinica).
--
-- O perfil só tem `pessoas.gerir` — que INCLUI salário (dívida registrada:
-- separar `pessoas.salario`). Clínica NOVA já o recebe por `perfisPadrao()`.
--
-- IDEMPOTENTE e GENTIL, e é o que o INSERT … WHERE NOT EXISTS faz:
--   * não recria o que a clínica EXCLUIU (regra 27): qualquer linha com a chave
--     `pf_ges`, viva ou com `excluido_em`, impede a criação;
--   * não colide com perfil de mesmo nome, vivo OU excluído (mesma normalização
--     do índice `perfis_nome_unico`) — a clínica que já fez, ou apagou, o seu
--     "Gestão de pessoas" fica como está;
--   * NÃO atribui a ninguém: nenhuma linha de `pessoas` é tocada.
--
-- Forward-only, EXPAND: só INSERT. Roda pelo papel dono (BYPASSRLS); a RLS da
-- tabela e as policies não mudam. O ator é declarado `sistema` para a trigger
-- de auditoria (regra 20), como em toda migration que escreve dado.
-- ===========================================================================

SELECT set_config('app.pessoa_id', 'sistema', true);

INSERT INTO perfis (clinica_id, chave, nome, perms)
SELECT c.id, 'pf_ges', 'Gestão de pessoas', ARRAY['pessoas.gerir']::text[]
  FROM clinicas c
 WHERE NOT EXISTS (
         SELECT 1 FROM perfis p
          WHERE p.clinica_id = c.id
            AND p.chave = 'pf_ges')
   AND NOT EXISTS (
         SELECT 1 FROM perfis p
          WHERE p.clinica_id = c.id
            AND normalizar_nome(p.nome) = normalizar_nome('Gestão de pessoas'));
