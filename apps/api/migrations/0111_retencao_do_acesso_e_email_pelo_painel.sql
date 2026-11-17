-- ===========================================================================
-- RETENÇÃO DO ACESSO POR E-MAIL E O E-MAIL PELO PAINEL (Entrega 3, dívidas
-- abertas da 0097; LGPD L5 e L6; `docs/compliance/retencao.md`).
--
-- 1. `purgar_acesso_vencido` — a purga de `links_de_acesso` (30 dias depois
--    do último entre `expira_em`, `usado_em` e `invalidado_em`) e de
--    `eventos_de_acesso` (1 ano).
--
--    Nenhuma das duas é append-only por TRIGGER: o append-only delas é o
--    REVOKE de `DELETE` a `fir_app` (0097). A D9 já dizia o caminho — "a purga
--    roda com o papel de migração" —, e aqui ele é uma função SECURITY
--    DEFINER de `fir_migrate`, e não a credencial de `fir_migrate` no
--    worker: o worker só ganha o poder de apagar O QUE VENCEU, e nada mais.
--    A `auditoria` NÃO é tocada (D9 é decisão à parte); a trigger de
--    auditoria de `links_de_acesso` continua registrando cada linha apagada,
--    com `token_hash` e `email_hmac` ocultos pela denylist.
--
--    Os mesmos cuidados de `resolver_link_de_acesso` (0097, molde da 0022):
--    `search_path` fixo, REVOKE de PUBLIC. E dois a mais, porque esta GRAVA:
--      - só a clínica da transação (`app_clinica_id()`), e sem ela, nada.
--        `fir_migrate` tem BYPASSRLS, então a RLS NÃO filtra aqui dentro: o
--        `WHERE clinica_id = …` é a única barreira, e é explícito por isso;
--      - o instante de corte é `LEAST(p_agora, now())`: o relógio da
--        aplicação decide, mas um relógio adiantado (ou um chamador hostil)
--        não antecipa a purga de nada que ainda está dentro do prazo.
--    Em LOTE (`p_lote`, até 10 000): o job repete até voltar zero, cada lote
--    na própria transação curta.
--
-- 2. O painel passa a CADASTRAR o e-mail de uma pessoa (pendente, com link
--    de confirmação), e para isso `fir_painel` precisa INSERIR o link e o
--    evento. Só INSERT: UPDATE continua só em `invalidado_em` (0097), DELETE
--    nunca.
--
-- 3. O link encerrado (usado ou invalidado) é TERMINAL: ver o bloco 3.
-- ===========================================================================

CREATE FUNCTION purgar_acesso_vencido(p_agora timestamptz, p_lote integer)
  RETURNS TABLE (links integer, eventos integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
DECLARE
  v_clinica uuid := public.app_clinica_id();
  v_corte   timestamptz := LEAST(p_agora, now());
  v_links   integer;
  v_eventos integer;
BEGIN
  IF v_clinica IS NULL THEN
    RAISE EXCEPTION 'purgar_acesso_vencido: sem clínica fixada';
  END IF;
  IF p_lote IS NULL OR p_lote < 1 OR p_lote > 10000 THEN
    RAISE EXCEPTION 'purgar_acesso_vencido: lote fora de 1..10000';
  END IF;

  -- GREATEST ignora NULL: o link vivo e ainda no prazo tem `expira_em` no
  -- futuro e nunca entra; o vencido sem uso conta do `expira_em`.
  DELETE FROM public.links_de_acesso
   WHERE id IN (
     SELECT l.id FROM public.links_de_acesso l
      WHERE l.clinica_id = v_clinica
        AND GREATEST(l.expira_em, l.usado_em, l.invalidado_em) < v_corte - interval '30 days'
      LIMIT p_lote);
  GET DIAGNOSTICS v_links = ROW_COUNT;

  DELETE FROM public.eventos_de_acesso
   WHERE id IN (
     SELECT e.id FROM public.eventos_de_acesso e
      WHERE e.clinica_id = v_clinica
        AND e.em < v_corte - interval '1 year'
      LIMIT p_lote);
  GET DIAGNOSTICS v_eventos = ROW_COUNT;

  RETURN QUERY SELECT v_links, v_eventos;
END
$$;

COMMENT ON FUNCTION purgar_acesso_vencido(timestamptz, integer) IS
  'Retenção da 0097 (LGPD L5, L6): apaga, da clínica da transação, links vencidos há mais de '
  '30 dias e eventos de acesso com mais de 1 ano. Em lote; repetir até zero. Nunca toca a auditoria.';

REVOKE ALL ON FUNCTION purgar_acesso_vencido(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purgar_acesso_vencido(timestamptz, integer) TO fir_app;

-- O índice de `eventos_de_acesso (clinica_id, em DESC)` da 0097 já serve à
-- purga; o de links, por clínica, é este.
CREATE INDEX links_de_acesso_por_clinica ON links_de_acesso (clinica_id, expira_em);

GRANT INSERT ON links_de_acesso, eventos_de_acesso TO fir_painel;

-- ---------------------------------------------------------------------------
-- 3. O LINK USADO NÃO VOLTA A VALER (appsec 5, 18).
--
-- O `token_hash` fica na linha depois do uso — é `NOT NULL UNIQUE` desde a
-- 0097, e é por ele que a segunda tentativa vira `link_ja_usado` em vez de
-- "token inexistente". O que torna o link inútil é `usado_em`/`invalidado_em`.
-- Só que `fir_app` tem UPDATE nessas duas colunas, e nada impedia um
-- `SET usado_em = NULL` de ressuscitar um link já consumido: o hash ainda
-- está lá para casar. Esta trigger faz do encerramento um estado TERMINAL, e
-- de toda outra coluna uma constante. Alcança o dono também, como as
-- triggers de append-only; a purga apaga, nunca atualiza.
-- ---------------------------------------------------------------------------
CREATE FUNCTION link_de_acesso_encerrado_e_terminal() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
BEGIN
  IF OLD.usado_em IS NOT NULL OR OLD.invalidado_em IS NOT NULL THEN
    RAISE EXCEPTION 'links_de_acesso: link encerrado não muda (%)', OLD.id;
  END IF;
  IF (NEW.id, NEW.clinica_id, NEW.pessoa_id, NEW.finalidade, NEW.email_hmac, NEW.token_hash,
      NEW.criado_em, NEW.expira_em)
     IS DISTINCT FROM
     (OLD.id, OLD.clinica_id, OLD.pessoa_id, OLD.finalidade, OLD.email_hmac, OLD.token_hash,
      OLD.criado_em, OLD.expira_em) THEN
    RAISE EXCEPTION 'links_de_acesso: só usado_em e invalidado_em mudam (%)', OLD.id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER links_de_acesso_encerrado_e_terminal
  BEFORE UPDATE ON links_de_acesso
  FOR EACH ROW EXECUTE FUNCTION link_de_acesso_encerrado_e_terminal();
