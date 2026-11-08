-- ---------------------------------------------------------------------------
-- A AGENDA DO SISTEMA DA CLÍNICA → o cartão da jornada (ADR 0019).
--
-- Duas tabelas e uma coluna:
--
--   agendas_externas      o link iCal da clínica, UMA linha por clínica, e o
--                         estado da última leitura (a tela mostra);
--   compromissos_externos o vínculo `uid do compromisso → tarefa`. É a chave
--                         de idempotência (regra 26) e é também o que impede
--                         recriar um cartão que a recepção excluiu (regra 27):
--                         a linha sobrevive à exclusão da tarefa;
--   pacientes.conferir_cadastro  a marca da paciente que a sincronização
--                         cadastrou sozinha, até alguém salvar a ficha.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

CREATE TABLE agendas_externas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id         uuid NOT NULL REFERENCES clinicas(id) UNIQUE,
  provedor           text NOT NULL DEFAULT 'ical' CHECK (provedor IN ('ical')),
  -- O link é SEGREDO: dá leitura da agenda de pacientes. Nunca volta inteiro
  -- para a tela e nunca vai para log. Só https — `webcal://` é convertido na
  -- borda, e `http://` é recusado (o token andaria em claro).
  url_secreta        text NOT NULL CHECK (url_secreta ~ '^https://' AND length(url_secreta) <= 2000),
  responsavel_id     uuid NOT NULL REFERENCES pessoas(id),
  palavras_ignorar   text[] NOT NULL DEFAULT ARRAY[
                       'bloqueio','bloqueado','almoco','reuniao','ferias',
                       'feriado','intervalo','indisponivel']::text[],
  ativa              boolean NOT NULL DEFAULT true,
  ultima_leitura_em  timestamptz,
  ultimo_sucesso_em  timestamptz,
  -- Mensagem para a TELA ("o link respondeu 404"), nunca o conteúdo do feed.
  ultimo_erro        text NOT NULL DEFAULT '' CHECK (length(ultimo_erro) <= 300),
  -- {criados, reagendados, desmarcados, ignorados, vistos}: só contagens.
  ultimo_resumo      jsonb,
  criada_em          timestamptz NOT NULL DEFAULT now(),
  atualizada_em      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE agendas_externas IS
  'O link iCal da agenda do sistema da clínica (ADR 0019). Uma por clínica. '
  'A url_secreta é segredo: a API devolve só a versão mascarada.';

CREATE TABLE compromissos_externos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id   uuid NOT NULL REFERENCES clinicas(id),
  provedor     text NOT NULL CHECK (provedor IN ('ical')),
  -- `UID` do iCal; ocorrência de recorrente: `UID|RECURRENCE-ID`.
  uid_externo  text NOT NULL CHECK (length(uid_externo) BETWEEN 1 AND 1000),
  tarefa_id    uuid NOT NULL REFERENCES tarefas(id),
  -- O início como a AGENDA o disse da última vez, em UTC. É o que decide se o
  -- sumiço do feed conta (só compromisso futuro conta como removido).
  inicio       timestamptz NOT NULL,
  visto_em     timestamptz NOT NULL,
  removido_em  timestamptz,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compromisso_unico UNIQUE (clinica_id, provedor, uid_externo)
);

CREATE UNIQUE INDEX compromisso_por_tarefa ON compromissos_externos (tarefa_id);
CREATE INDEX compromissos_futuros ON compromissos_externos (clinica_id, inicio)
  WHERE removido_em IS NULL;

ALTER TABLE pacientes
  ADD COLUMN conferir_cadastro boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN pacientes.conferir_cadastro IS
  'Cadastrada pela sincronização da agenda (ADR 0019), ou ligada a um '
  'telefone ambíguo. Some quando alguém salva a ficha.';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['agendas_externas','compromissos_externos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t || '_por_clinica', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t || '_auditoria', t);
  END LOOP;
END $$;

-- Sem DELETE para a aplicação: desligar a agenda é `ativa = false`, e o
-- vínculo de compromisso nunca some (é ele que impede recriar o excluído).
GRANT SELECT, INSERT, UPDATE ON agendas_externas, compromissos_externos TO fir_app;
REVOKE DELETE ON agendas_externas, compromissos_externos FROM fir_app;

-- O link entra na DENYLIST da trilha (0004): a auditoria registra QUE ele
-- mudou, por quem e quando, e nunca o token. `GET /v1/auditoria` é lido por
-- quem tem `config`, e o link vale como uma senha da agenda de pacientes.
CREATE OR REPLACE FUNCTION auditoria_sem_segredos(p jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog
  AS $$
    SELECT CASE WHEN p IS NULL THEN NULL ELSE coalesce(
      (SELECT jsonb_object_agg(
                k,
                CASE WHEN k = ANY (ARRAY['senha_hash', 'token_hash', 'url_secreta'])
                     THEN '"[oculto]"'::jsonb
                     ELSE p -> k END)
         FROM jsonb_object_keys(p) k),
      p) END
  $$;
