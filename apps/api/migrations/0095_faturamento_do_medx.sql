-- ===========================================================================
-- O FATURAMENTO LIDO DO MEDX (spec `docs/specs/integracao-medx.md` C.1–C.7;
-- parecer de números; ticket T5).
--
--   leituras_de_faturamento_externo     um total por DIA lido, inclusive os de
--                                       zero. Linha existe ⇔ dia lido (N-B3).
--   historico_de_faturamento_externo    uma linha quando um dia MUDA. Append-only.
--
-- NADA DISTO É RECEBIMENTO. Não entra em caixa, Visão do mês, Painel, LTV,
-- saldo, campanhas nem na conferência de migração (C.3, regra 28). É o número
-- do MedX, que os Indicadores (T7) mostram AO LADO do número da FIR.
-- ===========================================================================
SELECT set_config('app.pessoa_id', 'sistema', true);

CREATE TABLE leituras_de_faturamento_externo (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id          uuid NOT NULL REFERENCES clinicas(id),
  provedor            text NOT NULL CHECK (provedor IN ('medx')),
  -- O dia civil da clínica (ou o dia do MedX, quando o MedX dá só a data).
  dia                 date NOT NULL,
  -- Centavos, arredondados POR PAGAMENTO e somados (parecer A9).
  faturamento_lido    bigint NOT NULL,
  -- O mesmo total sem arredondar, em dezmilésimos de real: a Conferência
  -- mostra o resíduo em vez de deixar alguém procurá-lo.
  faturamento_exato   bigint NOT NULL,
  -- Quantos pagamentos: NÃO é `quantidade` (de estoque). A redação decide por
  -- nome, e esta contagem não atravessa sem `valores` (spec C.11) — inclusive
  -- na trilha, que devolve o nome da coluna.
  quantidade_de_pagamentos integer NOT NULL CHECK (quantidade_de_pagamentos >= 0),
  -- O INÍCIO da leitura que gravou o valor do dia (A5). Uma leitura que
  -- confirma o mesmo total não regrava a linha: quando a clínica foi lida
  -- pela última vez está em `integracoes_da_clinica.faturamento_ultimo_sucesso_em`.
  lido_em             timestamptz NOT NULL,
  leitura_id          uuid NOT NULL,
  CONSTRAINT leitura_por_dia UNIQUE (clinica_id, provedor, dia)
);
COMMENT ON TABLE leituras_de_faturamento_externo IS
  'O faturamento lido do MedX, um total por dia lido (inclusive zero). NÃO é recebimento: '
  'não entra em caixa, receita, LTV, saldo nem meta (spec integracao-medx C.3).';

CREATE TABLE historico_de_faturamento_externo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id            uuid NOT NULL REFERENCES clinicas(id),
  provedor              text NOT NULL CHECK (provedor IN ('medx')),
  dia                   date NOT NULL,
  faturamento_anterior  bigint NOT NULL,
  faturamento_lido      bigint NOT NULL,
  quantidade_de_pagamentos_anterior integer NOT NULL,
  quantidade_de_pagamentos          integer NOT NULL,
  lido_em               timestamptz NOT NULL,
  leitura_id            uuid NOT NULL,
  -- O dia é de um mês que já acabou: é a mudança que a gestora precisa ver (A6).
  mes_fechado           boolean NOT NULL,
  em                    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX historico_de_faturamento_por_dia ON historico_de_faturamento_externo (clinica_id, dia);
COMMENT ON TABLE historico_de_faturamento_externo IS
  'Uma linha quando o total ou a quantidade de um dia lido do MedX muda. Append-only (spec C.5).';

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['leituras_de_faturamento_externo','historico_de_faturamento_externo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t || '_por_clinica', t);
  END LOOP;
END $$;

-- A TRILHA, em toda escrita das duas, como em toda tabela de negócio
-- (`teste/auditoria-inescapavel.test.ts`). O worker relê toda hora, mas só
-- ESCREVE o dia que mudou: regravar o mesmo total seriam 1.500 linhas de
-- trilha por clínica por dia dizendo "nada mudou".
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['leituras_de_faturamento_externo','historico_de_faturamento_externo'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t || '_auditoria', t);
  END LOOP;
END $$;

-- O ESTADO da leitura, na linha da integração: o painel mostra, o worker grava.
ALTER TABLE integracoes_da_clinica
  ADD COLUMN faturamento_ultima_leitura_em  timestamptz,
  ADD COLUMN faturamento_ultimo_sucesso_em  timestamptz,
  ADD COLUMN faturamento_ultimo_erro        text NOT NULL DEFAULT '' CHECK (length(faturamento_ultimo_erro) <= 300),
  -- A releitura dos 13 meses (A1): quando foi, e em que fuso. Mudar o fuso
  -- da clínica muda o dia de cada pagamento, e obriga a reler tudo (N2).
  ADD COLUMN faturamento_releitura_em       timestamptz,
  ADD COLUMN faturamento_fuso_lido          text;

-- PRIVILÉGIOS.
REVOKE ALL ON leituras_de_faturamento_externo, historico_de_faturamento_externo FROM fir_app, fir_painel;
-- O balcão LÊ (os Indicadores do T7, sob a redação de `valores`). Nunca escreve.
GRANT SELECT ON leituras_de_faturamento_externo, historico_de_faturamento_externo TO fir_app;
-- O worker grava. O histórico é só INSERT: nem ele altera o passado.
GRANT SELECT, INSERT, UPDATE ON leituras_de_faturamento_externo TO fir_integracoes;
GRANT SELECT, INSERT ON historico_de_faturamento_externo TO fir_integracoes;
GRANT UPDATE (faturamento_ultima_leitura_em, faturamento_ultimo_sucesso_em, faturamento_ultimo_erro,
              faturamento_releitura_em, faturamento_fuso_lido)
  ON integracoes_da_clinica TO fir_integracoes;
GRANT SELECT (faturamento_ultima_leitura_em, faturamento_ultimo_sucesso_em, faturamento_ultimo_erro,
              faturamento_releitura_em)
  ON integracoes_da_clinica TO fir_painel;
