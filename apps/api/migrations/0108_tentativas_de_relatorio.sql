-- ===========================================================================
-- INDICADORES & INSIGHTS, T8 — correções da revisão appsec
-- (docs/specs/indicadores-e-insights-t8-appsec.md, B1 e L1).
--
-- EXPAND puro: uma tabela nova e um índice único parcial. Nenhuma linha
-- existente muda. A 0106 é do T9 e a 0107 do T7; esta vem depois das duas.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

-- ---------------------------------------------------------------------------
-- 1. TENTATIVAS_DE_RELATORIO (appsec C13, B1)
--
-- O limite de 60 gerações + exportações por pessoa por hora contava a
-- `auditoria`, e a linha da trilha só existe depois do COMMIT da leitura:
-- quinze pedidos em paralelo liam o mesmo número (ADV-1), e a consulta que
-- estourava o tempo desfazia o próprio registro e nunca chegava ao 429
-- (ADV-2). A trilha continua gravando só o SUCESSO (L-IN-8).
--
-- Aqui fica a TENTATIVA, gravada numa transação curta, própria, ANTES da
-- consulta e sob `pg_advisory_xact_lock` por (clínica, pessoa). Ela conta
-- mesmo quando a leitura falha.
--
-- Sem conteúdo nenhum: quem e quando. Vive uma hora — a mesma transação que
-- conta apaga as linhas da pessoa com mais de uma hora, e por isso `fir_app`
-- tem DELETE aqui (e só aqui, entre as tabelas do T8).
--
-- SEM trigger de auditoria, por decisão (`ENTIDADES_SEM_TRILHA_POR_DECISAO`):
-- é um contador de taxa. Cada linha que importa já está na trilha como
-- `acessou`/`exportou`; copiar a tentativa duplicaria a trilha sem responder
-- pergunta nenhuma.
-- ---------------------------------------------------------------------------
CREATE TABLE tentativas_de_relatorio (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  ator_id     uuid NOT NULL,
  em          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tentativas_de_relatorio_por_ator ON tentativas_de_relatorio (clinica_id, ator_id, em);

COMMENT ON TABLE tentativas_de_relatorio IS
  'Contador do limite por hora dos relatórios (C13): quem e quando, sem conteúdo. '
  'Linhas com mais de 1 hora são apagadas na própria contagem.';

ALTER TABLE tentativas_de_relatorio ENABLE ROW LEVEL SECURITY;
ALTER TABLE tentativas_de_relatorio FORCE  ROW LEVEL SECURITY;
CREATE POLICY tentativas_de_relatorio_por_clinica ON tentativas_de_relatorio
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());

GRANT SELECT, INSERT, DELETE ON tentativas_de_relatorio TO fir_app;
REVOKE UPDATE, TRUNCATE ON tentativas_de_relatorio FROM fir_app;

-- ---------------------------------------------------------------------------
-- 2. O CÓDIGO DA EXPORTAÇÃO É ÚNICO NA CLÍNICA (L-IN-10, L1)
--
-- 8 hex = 32 bits: uma colisão faria um arquivo achado apontar para duas
-- exportações. O motor tenta outro código quando este índice recusa.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX auditoria_codigo_da_exportacao ON auditoria (clinica_id, entidade_id)
  WHERE acao = 'exportou';
