-- ---------------------------------------------------------------------------
-- REABRIR O CAIXA DO DIA (ADR 2026-11-19-reabrir-caixa).
--
-- Pedido do dono em 19/11: depois de fechado, o caixa não se edita nem se
-- exclui, e um valor digitado errado fica para sempre. O protótipo não tem a
-- ação; a divergência é decisão de produto e está no ADR.
--
-- REABRIR = o fechamento SAI de `caixas_do_dia` e ENTRA aqui, inteiro. Não é
-- uma coluna `reaberto_em` em `caixas_do_dia`: dez consultas (faturamento
-- conferido, Visão do mês, Painel, avisos, indicadores, relatórios) dizem
-- "dia fechado" pela EXISTÊNCIA da linha. Uma coluna nova exigiria um filtro
-- em cada uma, e a décima primeira que esquecesse contaria um dia reaberto
-- como conferido. Assim, o dia reaberto é exatamente um dia aberto.
--
-- Nada se perde: o esperado e o contado de cada forma, quem fechou e quando,
-- quem reabriu, quando e por quê ficam aqui, append-only; e a trilha
-- (`registrar_auditoria`) registra o DELETE em `caixas_do_dia` com a linha.
--
-- `caixa_id` é o id do fechamento que saiu, SEM chave estrangeira: a linha
-- apontada não existe mais, e é justamente o que esta tabela registra.
-- ---------------------------------------------------------------------------
CREATE TABLE caixas_reabertos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  caixa_id      uuid NOT NULL,
  dia           date NOT NULL,
  obs           text NOT NULL DEFAULT '',
  fechado_por   uuid NOT NULL REFERENCES pessoas(id),
  fechado_em    timestamptz NOT NULL,
  -- As linhas do fechamento como eram: `[{forma, esperado, contado}]`, em
  -- centavos (texto, para o bigint não virar float no jsonb).
  linhas        jsonb NOT NULL,
  motivo        text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 3 AND 160),
  reaberto_por  uuid NOT NULL REFERENCES pessoas(id),
  reaberto_em   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX caixa_reaberto_uma_vez ON caixas_reabertos (caixa_id);
CREATE INDEX caixas_reabertos_por_dia ON caixas_reabertos (clinica_id, dia, reaberto_em);

ALTER TABLE caixas_reabertos ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixas_reabertos FORCE  ROW LEVEL SECURITY;
CREATE POLICY caixas_reabertos_por_clinica ON caixas_reabertos
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());
CREATE TRIGGER caixas_reabertos_auditoria AFTER INSERT OR UPDATE OR DELETE ON caixas_reabertos
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- Append-only para a aplicação: lê e insere. O REVOKE é o que trabalha (o
-- `ALTER DEFAULT PRIVILEGES` do bootstrap concede os quatro).
GRANT SELECT, INSERT ON caixas_reabertos TO fir_app;
REVOKE UPDATE, DELETE, TRUNCATE ON caixas_reabertos FROM fir_app;

-- E o UPDATE é recusado também para o dono: o registro do que foi conferido
-- não se reescreve. (DELETE do dono fica: é a limpeza dos testes e a
-- retenção, as mesmas de `caixas_do_dia`.)
CREATE FUNCTION caixa_reaberto_sem_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'caixa reaberto é registro do que foi conferido: UPDATE recusado';
END $$;
CREATE TRIGGER caixas_reabertos_sem_update BEFORE UPDATE ON caixas_reabertos
  FOR EACH STATEMENT EXECUTE FUNCTION caixa_reaberto_sem_update();
