-- ===========================================================================
-- INDICADORES & INSIGHTS, T8 — favoritos e `pacientes_da_exportacao`
-- (spec I-39, I-41, G5; LGPD L-IN-9, R-a; appsec C24, C25; ADR
-- 2026-11-17-relatorios-motor-por-post-e-exportacao-registrada).
--
-- O ticket chamava esta migration de 0101; a 0101 foi tomada pelo T3, e a
-- 0102/0103 pelo T4 e pelo acesso por e-mail. O conteúdo é o do ticket.
--
-- EXPAND puro: duas tabelas novas, um CHECK mais largo, um índice único e um
-- índice parcial. Nenhuma linha existente muda, e a versão anterior da API
-- continua lendo e gravando do mesmo jeito.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

-- ---------------------------------------------------------------------------
-- 1. `acao = 'exportou'` (LGPD R-a, decidido na ADR do T8).
--
-- A exportação de relatório ganha ação PRÓPRIA. Alargar o CHECK é compatível:
-- todo valor que passava continua passando.
-- ---------------------------------------------------------------------------
ALTER TABLE auditoria DROP CONSTRAINT auditoria_acao_check;
ALTER TABLE auditoria ADD CONSTRAINT auditoria_acao_check
  CHECK (acao IN ('criou', 'alterou', 'removeu', 'acessou', 'exportou'));

-- A FK COMPOSTA de `pacientes_da_exportacao` aponta para a linha da trilha
-- (appsec C24): a checagem de FK não passa pela RLS, e com FK simples um
-- `exportacao_id` de outra clínica seria aceito.
ALTER TABLE auditoria ADD CONSTRAINT auditoria_clinica_id_id_key UNIQUE (clinica_id, id);

-- O limite de 60 gerações + exportações por pessoa por hora (appsec C13) conta
-- a própria trilha: ela já registra cada uma, na mesma transação da leitura.
CREATE INDEX auditoria_relatorios_por_ator ON auditoria (clinica_id, ator_id, em DESC)
  WHERE entidade IN ('relatorio', 'exportacao_de_relatorio');

-- ---------------------------------------------------------------------------
-- 2. RELATORIOS_FAVORITOS (I-41; appsec C19; LGPD L-IN-17)
--
-- Da clínica, não da pessoa. `filtros` é validado pelo Zod do relatório na
-- escrita e na leitura — por isso não leva nome nem telefone de paciente (o
-- schema não tem string livre). `chave_relatorio` sem lista fechada aqui: o T9
-- acrescenta onze relatórios, e quem decide se a chave existe é o catálogo.
-- ---------------------------------------------------------------------------
CREATE TABLE relatorios_favoritos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id       uuid NOT NULL REFERENCES clinicas(id),
  chave_relatorio  text NOT NULL CHECK (chave_relatorio ~ '^[a-z0-9-]{1,60}$'),
  -- A tela avisa "não use nome de paciente" (L-IN-17).
  nome             text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  filtros          jsonb NOT NULL CHECK (jsonb_typeof(filtros) = 'object'),
  criado_por       uuid NOT NULL,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  arquivado_em     timestamptz,

  CONSTRAINT relatorios_favoritos_clinica_id_id_key UNIQUE (clinica_id, id),
  CONSTRAINT favorito_criado_por_da_clinica
    FOREIGN KEY (criado_por, clinica_id) REFERENCES pessoas (id, clinica_id)
);
-- O nome é único entre os VIVOS da clínica: arquivar libera o nome.
CREATE UNIQUE INDEX favorito_nome_vivo ON relatorios_favoritos (clinica_id, lower(btrim(nome)))
  WHERE arquivado_em IS NULL;

COMMENT ON TABLE relatorios_favoritos IS
  'Relatório com filtros salvos, da clínica. Filtros sem dado de paciente (L-IN-17). '
  'Arquivar é estado; fir_app não apaga.';

ALTER TABLE relatorios_favoritos ENABLE ROW LEVEL SECURITY;
ALTER TABLE relatorios_favoritos FORCE  ROW LEVEL SECURITY;
CREATE POLICY relatorios_favoritos_por_clinica ON relatorios_favoritos
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER relatorios_favoritos_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON relatorios_favoritos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

GRANT SELECT, INSERT, UPDATE ON relatorios_favoritos TO fir_app;
REVOKE DELETE, TRUNCATE ON relatorios_favoritos FROM fir_app;

-- ---------------------------------------------------------------------------
-- 3. PACIENTES_DA_EXPORTACAO (G5; LGPD L-IN-9; appsec C24, C25)
--
-- Um id por paciente do arquivo, NUNCA nome nem telefone: é o que diz quais
-- titulares estavam num arquivo vazado (art. 48, §1º, II) e responde ao
-- titular quem levou o dado dele (art. 18).
--
-- `exportacao_id` é a linha `exportou` da `auditoria`, pela FK composta. Os
-- dois vivem e morrem juntos (5 anos, `retencao.md`): a purga apaga esta antes
-- da linha da trilha.
--
-- SEM o trigger de auditoria, por decisão (`ENTIDADES_SEM_TRILHA_POR_DECISAO`):
-- esta tabela JÁ É trilha, append-only, gravada na mesma transação da linha
-- `exportou`. Copiá-la para a `auditoria` duplicaria cada exportação de 2.000
-- pacientes em 2.000 linhas de trilha sem responder pergunta nenhuma a mais.
-- ---------------------------------------------------------------------------
CREATE TABLE pacientes_da_exportacao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     uuid NOT NULL REFERENCES clinicas(id),
  exportacao_id  bigint NOT NULL,
  paciente_id    uuid NOT NULL,
  criado_em      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT paciente_uma_vez_por_exportacao UNIQUE (exportacao_id, paciente_id),
  CONSTRAINT exportacao_da_clinica
    FOREIGN KEY (clinica_id, exportacao_id) REFERENCES auditoria (clinica_id, id),
  CONSTRAINT paciente_da_exportacao_da_clinica
    FOREIGN KEY (paciente_id, clinica_id) REFERENCES pacientes (id, clinica_id)
);
CREATE INDEX pacientes_da_exportacao_por_paciente ON pacientes_da_exportacao (clinica_id, paciente_id);

COMMENT ON TABLE pacientes_da_exportacao IS
  'APPEND-ONLY. Os ids dos pacientes de cada arquivo exportado (LGPD L-IN-9). '
  'Sem nome, telefone ou coluna. fir_app só lê e insere.';

ALTER TABLE pacientes_da_exportacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE pacientes_da_exportacao FORCE  ROW LEVEL SECURITY;
CREATE POLICY pacientes_da_exportacao_por_clinica ON pacientes_da_exportacao
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());

GRANT SELECT, INSERT ON pacientes_da_exportacao TO fir_app;
REVOKE UPDATE, DELETE, TRUNCATE ON pacientes_da_exportacao FROM fir_app;

-- Camada 2 do append-only: a trigger alcança o DONO, que o REVOKE não alcança.
CREATE FUNCTION paciente_da_exportacao_e_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'pacientes_da_exportacao é append-only: % recusado', TG_OP;
END $$;

CREATE TRIGGER pacientes_da_exportacao_sem_update
  BEFORE UPDATE OR DELETE OR TRUNCATE ON pacientes_da_exportacao
  FOR EACH STATEMENT EXECUTE FUNCTION paciente_da_exportacao_e_append_only();
