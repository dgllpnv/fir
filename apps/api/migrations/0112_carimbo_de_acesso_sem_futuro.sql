-- ===========================================================================
-- REVISÃO APPSEC DA 0111 (`docs/specs/acesso-por-email-dividas-appsec.md`),
-- A1 e A3. A 0111 já foi aplicada e não se edita: esta a completa.
--
-- A1. Um carimbo no FUTURO adiava a purga para sempre. A purga conta os 30
--     dias do último entre `expira_em`, `usado_em` e `invalidado_em`, e um
--     `fir_app` comprometido que escrevesse `invalidado_em = '2999-01-01'`
--     (ou inserisse um evento com `em` em 2999) tirava a linha do alcance da
--     retenção. Os carimbos de ENCERRAMENTO e o instante do evento são fatos
--     que já aconteceram: não podem passar de `now()` mais uma folga de
--     relógio (5 minutos — o relógio da aplicação e o do banco são o mesmo
--     servidor em produção). `criado_em` e `expira_em` ficam de fora: o prazo
--     é futuro por definição, e um prazo distante não escapa da purga — ele
--     só faz o link valer, o que a invalidação resolve.
--
--     Trigger e não CHECK: um CHECK com `now()` não é imutável, e o
--     `pg_dump`/restore o reavaliaria contra o relógio do dia da restauração.
--
-- A3. `search_path` com `pg_temp` POR ÚLTIMO nas funções do acesso por
--     e-mail: sem ele explícito, `pg_temp` é buscado PRIMEIRO, e uma
--     referência sem esquema acrescentada depois resolveria numa tabela
--     temporária do chamador. Hoje toda relação é qualificada; isto é o cinto.
-- ===========================================================================

ALTER FUNCTION purgar_acesso_vencido(timestamptz, integer) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION resolver_link_de_acesso(text) SET search_path = pg_catalog, pg_temp;
ALTER FUNCTION link_de_acesso_encerrado_e_terminal() SET search_path = pg_catalog, pg_temp;

CREATE FUNCTION link_de_acesso_sem_carimbo_futuro() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.usado_em > now() + interval '5 minutes'
     OR NEW.invalidado_em > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'links_de_acesso: encerramento no futuro recusado (%)', NEW.id;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER links_de_acesso_sem_carimbo_futuro
  BEFORE INSERT OR UPDATE ON links_de_acesso
  FOR EACH ROW EXECUTE FUNCTION link_de_acesso_sem_carimbo_futuro();

CREATE FUNCTION evento_de_acesso_sem_instante_futuro() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
BEGIN
  IF NEW.em > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'eventos_de_acesso: instante no futuro recusado';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER eventos_de_acesso_sem_instante_futuro
  BEFORE INSERT OR UPDATE ON eventos_de_acesso
  FOR EACH ROW EXECUTE FUNCTION evento_de_acesso_sem_instante_futuro();
