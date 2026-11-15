-- ---------------------------------------------------------------------------
-- PARTES DO PAGAMENTO — várias formas num mesmo recebimento (fatia 4.1).
--
-- Pix 300 + Dinheiro 200 = UM recebimento de 500. A receita continua contando
-- o recebimento UMA vez (`recebimentos.valor`, regra 3); as partes só dizem
-- COMO o dinheiro entrou, e quem pergunta "por forma" (caixa, visão do mês,
-- painel, lista) as lê. EXPAND: tabela nova; `recebimentos.forma` fica como
-- legado (a forma da maior parte, nunca 'Mista') e nenhum leitor novo a lê. O
-- backfill dos recebimentos existentes é a 0088.
--
-- O QUE O BANCO GARANTE (e a aplicação também valida, no domínio):
--
--   * Σ partes = valor — CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED: as
--     partes entram DEPOIS do recebimento, na mesma transação, e a conta só
--     fecha no COMMIT.
--   * valor > 0 ⇒ ao menos uma parte; valor = 0 (venda a prazo) ⇒ nenhuma.
--   * UNIQUE (recebimento, forma) e no máximo 5 partes.
--   * Nota promissória e forma '' (legado migrado) só como parte ÚNICA.
--   * `valor_aberto` NUNCA na parte: dobraria a dívida.
--   * Partes IMUTÁVEIS e sem estado próprio (sem `estornado_em`): o estado é
--     do recebimento pai, então estornar o pai zera todas as partes de uma vez.
--
-- COMPATIBILIDADE COM QUEM GRAVA SEM PARTES. A aplicação grava por UMA função
-- (`gravarRecebimento`), e um teste de arquitetura proíbe `INSERT INTO
-- recebimentos` fora dela. Mesmo assim, o recebimento de uma forma só nascido
-- por outro caminho (fixture de teste, `psql` às duas da manhã) não pode
-- deixar o dinheiro sem forma: um caixa que não o vê é uma conferência que
-- acusa uma diferença que ninguém causou. Por isso, no COMMIT, o recebimento
-- com valor > 0 que ainda não tem NENHUMA parte ganha a parte única com a
-- forma e o valor dele — e só nesse caso, e NUNCA para o papel `fir_app`. Parte inconsistente (soma errada,
-- promissória misturada) nunca é "consertada": é recusada.
-- ---------------------------------------------------------------------------
SELECT set_config('app.pessoa_id', 'sistema', true);

-- Alvo da FK composta (appsec S1): sem ela, o id de um recebimento da
-- vizinha passaria na referência e a RLS só esconderia a leitura.
ALTER TABLE recebimentos ADD CONSTRAINT recebimentos_id_clinica UNIQUE (id, clinica_id);

CREATE TABLE recebimento_partes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id     uuid NOT NULL REFERENCES clinicas(id),
  recebimento_id uuid NOT NULL,
  -- As cinco do recebimento, e a VAZIA do dado migrado da v20 (0021): entra
  -- na receita e fica fora do caixa por forma (NA_GAVETA).
  forma          text NOT NULL CHECK (
    forma IN ('Pix','Dinheiro','Cartão de crédito','Cartão de débito','Nota promissória')
    OR forma = ''),
  -- Centavos. Regra 1: nunca numeric, nunca float.
  valor          bigint NOT NULL CHECK (valor > 0),
  -- A ordem em que a pessoa DIGITOU (0, 1, …). É o desempate da forma principal
  -- ("a maior; no empate, a primeira") e da ordem de exibição — o mesmo critério
  -- no domínio (`formaPrincipal`) e no SQL (`PARTES_EM_JSON`).
  ordem          smallint NOT NULL DEFAULT 0 CHECK (ordem BETWEEN 0 AND 4),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parte_unica_por_forma UNIQUE (recebimento_id, forma),
  -- CASCADE: só o pai pode levar as partes embora (a limpeza de uma clínica de
  -- teste, que apaga recebimentos). `fir_app` não tem DELETE na parte, e a
  -- trigger abaixo recusa o DELETE direto até do dono.
  CONSTRAINT parte_e_do_recebimento_da_clinica
    FOREIGN KEY (recebimento_id, clinica_id) REFERENCES recebimentos (id, clinica_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE recebimento_partes IS
  'Formas de pagamento de UM recebimento (1 a 5, uma por forma). Σ valor = recebimentos.valor '
  '(constraint trigger deferida). IMUTÁVEL e sem estado próprio: estornado/excluído é do pai. '
  'valor_aberto nunca aqui. Quem pergunta POR FORMA lê esta tabela; quem pergunta QUANTO lê recebimentos.';

ALTER TABLE recebimento_partes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recebimento_partes FORCE  ROW LEVEL SECURITY;
CREATE POLICY recebimento_partes_por_clinica ON recebimento_partes
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());

CREATE TRIGGER recebimento_partes_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON recebimento_partes
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();

-- O `ALTER DEFAULT PRIVILEGES` do bootstrap concede os quatro; o REVOKE é que
-- faz a imutabilidade (camada 1, para `fir_app`).
GRANT SELECT, INSERT ON recebimento_partes TO fir_app;
REVOKE UPDATE, DELETE, TRUNCATE ON recebimento_partes FROM fir_app;

-- Camada 2: a trigger alcança o DONO, que o REVOKE não alcança. O DELETE que
-- vem em CASCATA do recebimento pai roda dentro da trigger de integridade
-- referencial (profundidade > 1) e passa; o DELETE direto (profundidade 1) não.
CREATE FUNCTION parte_do_recebimento_e_imutavel() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'parte do pagamento é imutável: % recusado', TG_OP;
END $$;

CREATE TRIGGER recebimento_partes_sem_update
  BEFORE UPDATE OR DELETE ON recebimento_partes
  FOR EACH ROW EXECUTE FUNCTION parte_do_recebimento_e_imutavel();

CREATE FUNCTION parte_do_recebimento_sem_truncate() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'parte do pagamento é imutável: TRUNCATE recusado';
END $$;

CREATE TRIGGER recebimento_partes_sem_truncate
  BEFORE TRUNCATE ON recebimento_partes
  FOR EACH STATEMENT EXECUTE FUNCTION parte_do_recebimento_sem_truncate();

-- ---------------------------------------------------------------------------
-- A PARTE ÚNICA IMPLÍCITA — ver o cabeçalho. Disparada no COMMIT, ANTES da
-- conferência (os dois são constraint triggers deferidos; o Postgres os
-- dispara na ordem do nome, e `…_0_…` vem antes de `…_1_…`).
-- ---------------------------------------------------------------------------
CREATE FUNCTION criar_parte_unica_implicita() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  -- LISTA DE PERMITIDOS, não de proibidos: só os donos do esquema (`fir_migrate`
  -- e o superusuário `fir` do contêiner — infra/producao/10-papeis.sh) ganham a
  -- cura, para fixtures e `psql`. A aplicação (`fir_app`) e qualquer papel novo
  -- caem fora: lá um recebimento sem partes é BUG que o COMMIT deve recusar,
  -- não esconder. A função é SECURITY INVOKER de propósito: `current_user` é o
  -- de quem escreveu.
  IF current_user NOT IN ('fir_migrate', 'fir') THEN RETURN NULL; END IF;
  IF NEW.valor > 0
     AND NEW.forma IN ('Pix','Dinheiro','Cartão de crédito','Cartão de débito','Nota promissória','')
     AND NOT EXISTS (SELECT 1 FROM recebimento_partes WHERE recebimento_id = NEW.id) THEN
    INSERT INTO recebimento_partes (clinica_id, recebimento_id, forma, valor)
    VALUES (NEW.clinica_id, NEW.id, NEW.forma, NEW.valor);
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER recebimento_0_parte_unica_implicita
  AFTER INSERT ON recebimentos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION criar_parte_unica_implicita();

-- ---------------------------------------------------------------------------
-- A CONFERÊNCIA, no COMMIT: o recebimento e as partes dizem a mesma coisa.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER (padrão da 0004/0007): roda como o dono, com BYPASSRLS, e
-- por isso SEMPRE enxerga o pai e as partes — a conferência nunca é pulada por
-- uma RLS que esconda a linha de quem escreveu. `search_path` fixo.
CREATE FUNCTION conferir_partes_do_recebimento() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_id    uuid;
  v_valor bigint;
  v_n     integer;
  v_soma  bigint;
  v_prom  integer;
  v_vazia integer;
BEGIN
  -- IF e não CASE: o plpgsql resolve os campos de NEW na primeira avaliação, e a
  -- mesma função serve a duas tabelas (`recebimentos` não tem `recebimento_id`).
  IF TG_TABLE_NAME = 'recebimentos' THEN
    v_id := NEW.id;
  ELSE
    v_id := NEW.recebimento_id;
  END IF;
  SELECT valor INTO v_valor FROM public.recebimentos WHERE id = v_id;
  -- O pai já não existe DE FATO (apagado na mesma transação, e as partes com
  -- ele em cascata). Não é "não enxergo": a função vê tudo.
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*), coalesce(sum(valor), 0),
         count(*) FILTER (WHERE forma = 'Nota promissória'),
         count(*) FILTER (WHERE forma = '')
    INTO v_n, v_soma, v_prom, v_vazia
    FROM public.recebimento_partes WHERE recebimento_id = v_id;

  IF v_valor = 0 AND v_n > 0 THEN
    RAISE EXCEPTION 'recebimento sem dinheiro recebido (venda a prazo) não tem parte de pagamento';
  END IF;
  IF v_valor > 0 AND v_n = 0 THEN
    RAISE EXCEPTION 'recebimento com valor precisa de ao menos uma parte de pagamento';
  END IF;
  IF v_n > 5 THEN
    RAISE EXCEPTION 'no máximo 5 partes de pagamento por recebimento (% informadas)', v_n;
  END IF;
  IF v_soma <> v_valor THEN
    RAISE EXCEPTION 'a soma das partes (%) não é o valor do recebimento (%)', v_soma, v_valor;
  END IF;
  IF v_n > 1 AND (v_prom > 0 OR v_vazia > 0) THEN
    RAISE EXCEPTION 'nota promissória e forma vazia só valem como parte única';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER recebimento_1_soma_das_partes
  AFTER INSERT OR UPDATE OF valor ON recebimentos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conferir_partes_do_recebimento();

CREATE CONSTRAINT TRIGGER parte_soma_fecha_com_o_recebimento
  AFTER INSERT ON recebimento_partes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conferir_partes_do_recebimento();
