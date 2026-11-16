-- ===========================================================================
-- A AGENDA DO MEDX → o cartão da jornada (spec `docs/specs/integracao-medx.md`,
-- seção B; tickets T3 e T4).
--
-- T3 — o `AgendaProvider` de verdade: `agendas_externas` continua com UMA
-- linha por clínica (UNIQUE clinica_id, 0037), e é essa linha que diz de onde
-- vem a agenda — iCal OU MedX, nunca os dois (S-14). A trava da rodada
-- (`FOR UPDATE` nessa linha) é a mesma para os dois provedores.
--
-- T4 — o que a FIR guarda do MedX (B.0), e nada mais:
--   compromissos_externos.uid_externo   HMAC do id do agendamento ('h:' + hex);
--   compromissos_externos.referencia_cifrada  o id do agendamento SELADO, só
--                                       para confirmar um sumiço por id (B.4);
--                                       só o worker abre;
--   pacientes_externos                  HMAC do id do paciente → paciente da
--                                       FIR, ou a SUPRESSÃO (B.7);
--   ciclos_da_agenda_externa            o registro de cada ciclo, sem id nem
--                                       nome (B.12, LGPD A1). Retenção: 1 ano.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

-- ---------------------------------------------------------------------------
-- agendas_externas: o provedor da clínica.
-- ---------------------------------------------------------------------------
ALTER TABLE agendas_externas DROP CONSTRAINT agendas_externas_provedor_check;
ALTER TABLE agendas_externas
  ADD CONSTRAINT agendas_externas_provedor_check CHECK (provedor IN ('ical', 'medx'));
-- O link é do iCal; o MedX entra pela chave do cofre (0092), nunca por aqui.
ALTER TABLE agendas_externas ALTER COLUMN url_secreta DROP NOT NULL;
ALTER TABLE agendas_externas
  ADD CONSTRAINT agenda_link_so_do_ical CHECK ((provedor = 'ical') = (url_secreta IS NOT NULL));
-- "Sincronizar agora" do MedX: 1 a cada 2 min por clínica, no servidor (S-12).
ALTER TABLE agendas_externas ADD COLUMN sincronizacao_pedida_em timestamptz;

-- ---------------------------------------------------------------------------
-- compromissos_externos: o MedX entra na mesma chave de idempotência.
-- ---------------------------------------------------------------------------
ALTER TABLE compromissos_externos DROP CONSTRAINT compromissos_externos_provedor_check;
ALTER TABLE compromissos_externos
  ADD CONSTRAINT compromissos_externos_provedor_check CHECK (provedor IN ('ical', 'medx'));
ALTER TABLE compromissos_externos ADD COLUMN referencia_cifrada bytea;
ALTER TABLE compromissos_externos
  ADD CONSTRAINT referencia_so_do_medx CHECK ((provedor = 'medx') = (referencia_cifrada IS NOT NULL)),
  -- O id do MedX nunca é guardado em claro: só o HMAC (B.0).
  ADD CONSTRAINT uid_do_medx_e_hmac CHECK (provedor <> 'medx' OR uid_externo ~ '^h:[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------
-- pacientes_externos: o vínculo pelo id do paciente no MedX (A5), e a supressão (B3).
-- ---------------------------------------------------------------------------
CREATE TABLE pacientes_externos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id       uuid NOT NULL REFERENCES clinicas(id),
  provedor         text NOT NULL CHECK (provedor IN ('medx')),
  id_externo_hmac  text NOT NULL CHECK (id_externo_hmac ~ '^h:[0-9a-f]{64}$'),
  -- NULL só na supressão: o HMAC fica, desligado da identidade, para que a
  -- agenda do MedX nunca recrie quem pediu para sair.
  paciente_id      uuid,
  suprimido_em     timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paciente_externo_unico UNIQUE (clinica_id, provedor, id_externo_hmac),
  CONSTRAINT vinculo_ou_supressao CHECK (paciente_id IS NOT NULL OR suprimido_em IS NOT NULL),
  -- O paciente é da MESMA clínica, pela chave composta (0062 criou `pacientes_id_clinica`).
  CONSTRAINT paciente_externo_da_clinica FOREIGN KEY (paciente_id, clinica_id)
    REFERENCES pacientes (id, clinica_id)
);
CREATE INDEX pacientes_externos_por_paciente ON pacientes_externos (paciente_id);

COMMENT ON TABLE pacientes_externos IS
  'HMAC do id do paciente no MedX → paciente da FIR, ou supressão (spec integracao-medx B.6, B.7). '
  'Retenção: integração ligada + 90 dias.';

-- ---------------------------------------------------------------------------
-- ciclos_da_agenda_externa: o registro do ciclo (B.12). Só contagens.
-- ---------------------------------------------------------------------------
CREATE TABLE ciclos_da_agenda_externa (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id            uuid NOT NULL REFERENCES clinicas(id),
  provedor              text NOT NULL CHECK (provedor IN ('medx')),
  janela_de             timestamptz NOT NULL,
  janela_ate            timestamptz NOT NULL CHECK (janela_ate > janela_de),
  agendamentos_lidos    integer NOT NULL CHECK (agendamentos_lidos >= 0),
  paginas               integer NOT NULL CHECK (paginas >= 0),
  chamadas_de_contato   integer NOT NULL CHECK (chamadas_de_contato >= 0),
  confirmacoes_por_id   integer NOT NULL CHECK (confirmacoes_por_id >= 0),
  resultado             text NOT NULL CHECK (resultado IN ('ok', 'falhou')),
  em                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ciclos_da_agenda_por_clinica ON ciclos_da_agenda_externa (clinica_id, em DESC);

COMMENT ON TABLE ciclos_da_agenda_externa IS
  'Um ciclo de leitura da agenda do MedX: janela, contagens e resultado, sem id nem nome '
  '(spec integracao-medx B.12). Retenção: 1 ano, apagado pelo próprio ciclo.';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['pacientes_externos','ciclos_da_agenda_externa'] LOOP
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

-- Vínculo e supressão nunca somem pela aplicação (é a supressão que impede
-- recriar). O registro de ciclo é apagado pelo próprio ciclo depois de 1 ano.
GRANT SELECT, INSERT, UPDATE ON pacientes_externos TO fir_app;
REVOKE DELETE ON pacientes_externos FROM fir_app;
GRANT SELECT, INSERT, DELETE ON ciclos_da_agenda_externa TO fir_app;
REVOKE UPDATE ON ciclos_da_agenda_externa FROM fir_app;

-- O Operador liga a agenda do MedX: cria ou religa a linha da clínica, com o
-- responsável pelos cartões. Lê o registro de ciclo para o estado técnico (A.8).
GRANT SELECT, INSERT, UPDATE ON agendas_externas TO fir_painel;
GRANT SELECT ON ciclos_da_agenda_externa TO fir_painel;

-- A referência selada entra na DENYLIST da trilha: a auditoria registra que a
-- linha mudou, nunca o id do agendamento, mesmo cifrado.
CREATE OR REPLACE FUNCTION auditoria_sem_segredos(p jsonb) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog
  AS $$
    SELECT CASE WHEN p IS NULL THEN NULL ELSE coalesce(
      (SELECT jsonb_object_agg(
                k,
                CASE WHEN k = ANY (ARRAY['senha_hash', 'token_hash', 'url_secreta',
                                         'segredo_cifrado', 'hash', 'impressao_da_chave',
                                         'referencia_cifrada'])
                     THEN '"[oculto]"'::jsonb
                     ELSE p -> k END)
         FROM jsonb_object_keys(p) k),
      p) END
  $$;
