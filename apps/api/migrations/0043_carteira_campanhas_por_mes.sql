-- ===========================================================================
-- G8, ticket 1C — campanhas da carteira POR MÊS, investimento lançado à mão e
-- a chave de idempotência da sincronização com a FIR Clinic.
--
-- Inventário `docs/specs/g8-paridade-gestao-inventario.md` K1–K4 e V9;
-- gates `g8-gate-numeros.md` ajustes 23–29, `g8-gate-lgpd.md` A20–A26;
-- decisão do dono D-22 item 9 (investimento à mão, retorno = total ÷
-- investimento, "N,Nx").
--
-- Forward-only, expand: só acrescenta coluna, trigger, tabela e índice. A
-- única coisa retirada é um índice único (ver PARTE 3) — afrouxar uma
-- unicidade não apaga dado nem quebra leitor antigo.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PARTE 1 — a linha passa a ser UMA CÉLULA (campanha × mês).
--
-- No protótipo cada campanha tem UM mês (`x.mes`, `index.html` L2762) e o
-- "valor gerado no mês" são os pagamentos daquele mês (L1453). As campanhas
-- da FIR Clinic cobrem vários meses (`campanhas.inicio`/`fim`), então a
-- sincronização grava uma linha por mês em que a campanha correu ou recebeu
-- (gate de números, ajuste 24): o mês do pagamento é calculado NO FUSO DA
-- CLÍNICA, nunca em UTC.
--
-- A granularidade de linha também é a da supressão (LGPD A21): o `k = 5`
-- vale para cada célula exibida, e a célula é esta linha.
-- ---------------------------------------------------------------------------
ALTER TABLE campanhas_carteira
  -- Primeiro dia do mês da célula. NULL só durante este ALTER: o trigger
  -- abaixo preenche a partir de `periodo_inicio` quando quem insere não
  -- informa (os testes e leitores anteriores à 0043 inserem sem ela).
  ADD COLUMN mes_referencia date,
  -- "Valor gerado no mês" (L1453), em centavos, INDEPENDENTE da métrica
  -- (ajuste 23): o protótipo mostra receita até de campanha de
  -- "convertidos". NULL = ainda não medido / não lançado; nunca um 0 que
  -- confundiria "zero medido" com "não medido".
  ADD COLUMN receita_centavos bigint
    CHECK (receita_centavos IS NULL OR receita_centavos >= 0),
  -- Lançado À MÃO (D-22 item 9, ajuste 27). A SINCRONIZAÇÃO NUNCA ESCREVE
  -- ESTA COLUNA — nem no INSERT nem no UPDATE do upsert
  -- (`apps/api/src/carteira/campanhas/sincronizar-campanhas.ts`), e há teste
  -- que roda a sincronização três vezes conferindo isto.
  ADD COLUMN investimento_centavos bigint
    CHECK (investimento_centavos IS NULL OR investimento_centavos >= 0),
  -- O "tipo, para comparar mês a mês" (L2762). Na sincronização é a mesma
  -- `campanhas.categoria` da clínica (0020) — mesmo vocabulário.
  ADD COLUMN categoria text NOT NULL DEFAULT 'Outra'
    CHECK (length(btrim(categoria)) BETWEEN 1 AND 60),
  ADD COLUMN status text NOT NULL DEFAULT 'planejada'
    CHECK (status IN ('planejada', 'ativa', 'encerrada')),
  -- O texto da métrica como a tela mostra ("Agendamentos", "Pacientes
  -- convertidos"). Na campanha manual a métrica do protótipo é texto livre
  -- (`def:"Agendamentos"`); a coluna `metrica` continua no vocabulário de
  -- quatro da 0020 e a manual usa 'tipo' com este rótulo.
  ADD COLUMN rotulo_da_metrica text NOT NULL DEFAULT ''
    CHECK (length(rotulo_da_metrica) <= 60),
  ADD COLUMN observacoes text NOT NULL DEFAULT ''
    CHECK (length(observacoes) <= 2000);

-- A meta da campanha manual é opcional no protótipo (L2762, sem `req`).
-- Afrouxar um NOT NULL é expand puro; o CHECK (meta > 0) continua valendo
-- para quem informa.
ALTER TABLE campanhas_carteira ALTER COLUMN meta DROP NOT NULL;

UPDATE campanhas_carteira
   SET mes_referencia = date_trunc('month', periodo_inicio)::date
 WHERE mes_referencia IS NULL;

-- Linhas anteriores com métrica de receita já tinham a receita em
-- `resultado` (0028). Copiadas uma vez, para que a leitura nova não as
-- mostre "não medidas".
UPDATE campanhas_carteira
   SET receita_centavos = resultado
 WHERE metrica = 'receita' AND receita_centavos IS NULL AND resultado IS NOT NULL;

CREATE FUNCTION campanhas_carteira_mes_padrao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mes_referencia IS NULL THEN
    NEW.mes_referencia := date_trunc('month', NEW.periodo_inicio)::date;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER campanhas_carteira_mes_padrao
  BEFORE INSERT OR UPDATE ON campanhas_carteira
  FOR EACH ROW EXECUTE FUNCTION campanhas_carteira_mes_padrao();

ALTER TABLE campanhas_carteira ALTER COLUMN mes_referencia SET NOT NULL;
ALTER TABLE campanhas_carteira
  ADD CONSTRAINT campanhas_carteira_mes_no_dia_1 CHECK (extract(day FROM mes_referencia) = 1);

COMMENT ON COLUMN campanhas_carteira.orcamentos_pagos IS
  'Contagem que decide a supressão (ADR 0013 §4, k=5) NA CÉLULA (campanha × '
  'mês, LGPD A21). Na sincronização: pacientes DISTINTOS com pagamento '
  'contado na receita do mês — nunca maior que o número de orçamentos pagos, '
  'então a decisão é pelo menos tão restritiva quanto a do gate. Na campanha '
  'manual, informada pela equipe (LGPD A24). NULL = abaixo do limiar.';
COMMENT ON COLUMN campanhas_carteira.investimento_centavos IS
  'Lançado à mão (D-22 item 9). A sincronização nunca escreve esta coluna.';

-- ---------------------------------------------------------------------------
-- PARTE 2 — quando cada cliente foi sincronizado ("Última atualização",
-- L1997). Uma linha por `Cliente Firmare` ligado a clínica; o job grava na
-- mesma transação em que grava as campanhas do cliente — assim um cliente sem
-- nenhuma campanha também mostra que a leitura rodou.
-- ---------------------------------------------------------------------------
CREATE TABLE sincronizacao_campanhas_carteira (
  cliente_carteira_id uuid PRIMARY KEY REFERENCES clientes_carteira(id),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  sincronizado_em     timestamptz NOT NULL
);

ALTER TABLE sincronizacao_campanhas_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE sincronizacao_campanhas_carteira FORCE  ROW LEVEL SECURITY;
-- `TO fir_carteira` explícito: a lição da 0035 (policy sem `TO` é PUBLIC e
-- soma por OR com a de outro papel).
CREATE POLICY sincronizacao_campanhas_carteira_por_grupo ON sincronizacao_campanhas_carteira
  TO fir_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON sincronizacao_campanhas_carteira FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON sincronizacao_campanhas_carteira TO fir_carteira;

-- ---------------------------------------------------------------------------
-- PARTE 3 — a chave de idempotência da sincronização (regra 26).
--
-- Era `(campanha_origem_id)`: uma linha por campanha. Passa a ser
-- `(campanha_origem_id, mes_referencia)`: uma linha por campanha e mês. O
-- índice antigo é mais estreito que o novo e impediria o segundo mês, então
-- ele sai NESTE deploy — e pode sair: nenhum código anterior grava linha
-- sincronizada (o job nasce neste ticket), então não existe escritor antigo
-- que dependa dele. O novo cobre o mesmo "nunca duplica" do antigo, por mês.
-- ---------------------------------------------------------------------------
DROP INDEX campanhas_carteira_por_origem;
CREATE UNIQUE INDEX campanhas_carteira_por_origem_e_mes
  ON campanhas_carteira (campanha_origem_id, mes_referencia)
  WHERE campanha_origem_id IS NOT NULL;

CREATE INDEX campanhas_carteira_por_cliente_e_mes
  ON campanhas_carteira (cliente_carteira_id, mes_referencia);
