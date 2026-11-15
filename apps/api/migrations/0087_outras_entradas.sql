-- ---------------------------------------------------------------------------
-- OUTRAS ENTRADAS — dinheiro que entrou e NÃO é de paciente (fatia 4.2).
--
-- Aluguel de sala, reembolso, venda avulsa. Entra no esperado do caixa por
-- forma, na Visão do mês e no painel numa linha PRÓPRIA ("Outras entradas");
-- fica FORA de recebido, LTV, ticket, campanhas, saldo, funil, indicadores,
-- conferência de migração e meta. Pagamento de paciente continua sendo
-- `recebimentos`: o mesmo dinheiro nunca está nas duas tabelas (regra 3).
--
-- Expand-only: duas tabelas novas.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

CREATE TABLE categorias_de_entrada (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  nome       text NOT NULL CHECK (length(nome) BETWEEN 2 AND 60),
  -- Sem caixa nem acento: "Reembolso" e "reembolso" são a mesma categoria.
  nome_chave text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,
  -- Estado, nunca exclusão (regra 20): a desativada continua legível nas
  -- entradas antigas.
  ativa      boolean NOT NULL DEFAULT true,
  criada_em  timestamptz NOT NULL DEFAULT now(),
  criada_por uuid,
  CONSTRAINT categorias_de_entrada_id_clinica UNIQUE (id, clinica_id),
  CONSTRAINT categoria_nome_unico UNIQUE (clinica_id, nome_chave),
  CONSTRAINT categoria_criada_por_e_da_clinica
    FOREIGN KEY (criada_por, clinica_id) REFERENCES pessoas (id, clinica_id)
);

CREATE TABLE outras_entradas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  categoria_id  uuid NOT NULL,
  -- O INSTANTE (UTC no banco); a janela do dia é semiaberta no fuso da
  -- clínica (regras 22 e 23). A data digitada é validada ≤ hoje no servidor.
  recebida_em   timestamptz NOT NULL,
  -- Centavos. Regra 1.
  valor         bigint NOT NULL CHECK (valor > 0),
  -- As QUATRO da gaveta, e só elas: a promissória não está na gaveta.
  forma         text NOT NULL CHECK (forma IN ('Pix','Dinheiro','Cartão de crédito','Cartão de débito')),
  -- TEXTO LIVRE (LGPD L3): aviso "não escreva nome de paciente nem dado de
  -- saúde" na tela; nunca vai a log nem a mensagem de erro.
  descricao     text NOT NULL DEFAULT '' CHECK (length(descricao) <= 120),
  -- Estorno por marca, como `recebimentos`. Leitores filtram `IS NULL`.
  estornada_em  timestamptz,
  -- Idempotência da escrita: o reenvio devolve o original.
  requisicao_id uuid NOT NULL,
  criado_por    uuid NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outra_entrada_e_de_categoria_da_clinica
    FOREIGN KEY (categoria_id, clinica_id) REFERENCES categorias_de_entrada (id, clinica_id),
  CONSTRAINT outra_entrada_e_de_pessoa_da_clinica
    FOREIGN KEY (criado_por, clinica_id) REFERENCES pessoas (id, clinica_id)
);

CREATE UNIQUE INDEX outra_entrada_por_requisicao ON outras_entradas (clinica_id, requisicao_id);
CREATE INDEX outras_entradas_por_data ON outras_entradas (clinica_id, recebida_em)
  WHERE estornada_em IS NULL;

COMMENT ON TABLE outras_entradas IS
  'Dinheiro que entrou e NÃO é de paciente. Fora de recebido, LTV, campanhas, saldo, funil e conferência '
  'de migração; dentro do esperado do caixa por forma, da Visão do mês e do painel, em linha própria. '
  'Estorno por marca (estornada_em), nunca DELETE. descricao é texto livre: nunca em log.';

-- Só o ESTORNO muda uma outra entrada: nenhuma outra coluna, e a marca nunca
-- volta a NULL. Corrigir é estornar e lançar de novo, que é o que a trilha
-- consegue contar.
CREATE FUNCTION outra_entrada_so_estorna() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estornada_em IS NOT NULL THEN
    RAISE EXCEPTION 'outra entrada já estornada não muda mais';
  END IF;
  IF NEW.estornada_em IS NULL
     OR (to_jsonb(NEW) - 'estornada_em') IS DISTINCT FROM (to_jsonb(OLD) - 'estornada_em') THEN
    RAISE EXCEPTION 'outra entrada só muda por estorno (estornada_em)';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER outras_entradas_so_estorna
  BEFORE UPDATE ON outras_entradas
  FOR EACH ROW EXECUTE FUNCTION outra_entrada_so_estorna();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['categorias_de_entrada', 'outras_entradas'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (clinica_id = app_clinica_id()) '
      'WITH CHECK (clinica_id = app_clinica_id())', t || '_por_clinica', t);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t || '_auditoria', t);
    -- Sem DELETE: desativar e estornar são estados (regra 20).
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO fir_app', t);
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I FROM fir_app', t);
  END LOOP;
END $$;
