-- ---------------------------------------------------------------------------
-- G3 — "Cobrança do Cliente Firmare" + indicadores e metas comerciais.
-- ADRs 0011, 0012, 0013, 0015. Spec:
-- docs/superpowers/plans/g3-spec-metas-e-lancamentos.md.
--
-- `Meta interna da carteira` (meta da própria equipe Firmare sobre a
-- carteira, sem `Cliente Firmare` associado) FICA FORA desta migration — o
-- spec (§4) a marca como corte legítimo, sem equivalente no protótipo, e
-- `metas_comerciais` abaixo nasce só com `Meta comercial do cliente`
-- (`cliente_carteira_id NOT NULL`). Decisão do engenheiro que implementou o
-- ticket, registrada aqui para quem for desarquivá-la.
--
-- Nenhuma tabela desta migration tem `clinica_id` — mesma classificação de
-- `uso_diario_cliente`/`campanhas_carteira` (0028): são dado DA CARTEIRA,
-- ligado por `cliente_carteira_id`/`grupo_id`, não dado DA clínica. RLS por
-- `grupo_id` (`app_pode_ver_grupo`, ADR 0012) em todas.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 0 · `Mensalidade` — propriedade de `Cliente Firmare` (spec §1, decisão do
-- dono no plano §9 item 6: mensalidade é por CLIENTE, nunca por grupo).
--
-- EXPAND: coluna nova em tabela existente (0026), `NOT NULL DEFAULT 0` para
-- não quebrar as linhas já migradas — forward-only (CLAUDE.md §2, migrations).
-- Um `Cliente Firmare` real sem mensalidade cadastrada ainda mostra R$ 0,00
-- até alguém preencher; o job de geração (abaixo) não distingue "zero de
-- verdade" de "ainda não cadastrado" nesta fatia — mesmo tipo de corte que
-- `beneficios_de_indicacao` aceita para não esperar uma segunda decisão do
-- dono que não foi pedida.
-- ---------------------------------------------------------------------------
ALTER TABLE clientes_carteira
  ADD COLUMN mensalidade_centavos bigint NOT NULL DEFAULT 0 CHECK (mensalidade_centavos >= 0);

COMMENT ON COLUMN clientes_carteira.mensalidade_centavos IS
  'O valor VIGENTE que o Cliente Firmare paga por competência (Dinheiro, '
  'centavos). Mudar este valor afeta só as Cobrança FUTURAS — as já geradas '
  'guardam o valor da época em cobrancas_do_cliente_firmare.valor_centavos, '
  'nunca recalculado (critério 2.2.8 do spec G3).';

-- ---------------------------------------------------------------------------
-- 1 · `indicadores_carteira` — a DEFINIÇÃO de uma métrica de negócio do
-- cliente (spec §1, critério 2.1.1). Nunca dinheiro em si; é o cadastro.
-- ---------------------------------------------------------------------------
CREATE TABLE indicadores_carteira (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id            uuid NOT NULL REFERENCES grupos(id),
  nome                text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  -- Conjunto FECHADO por enquanto (critério 2.1.1) — unidade livre em texto
  -- fica para quando houver pedido real, mesmo princípio do
  -- `LeitorDeIndicadores` (plano §4): não construir abstração sem uso.
  unidade             text NOT NULL CHECK (unidade IN ('R$', 'un', '%')),
  sentido             text NOT NULL CHECK (sentido IN ('maior_melhor', 'menor_melhor')),
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  -- Soft delete (regra 20) — nunca DELETE de um indicador com lançamentos.
  excluido_em         timestamptz
);

COMMENT ON TABLE indicadores_carteira IS
  'Indicador da carteira (CONTEXT.md): a DEFINIÇÃO de uma métrica de negócio '
  'de um Cliente Firmare — nome, unidade e sentido de melhora. Não é valor '
  'nenhum; o valor mora em lancamentos_de_indicador.';

CREATE INDEX indicadores_carteira_por_cliente ON indicadores_carteira (cliente_carteira_id)
  WHERE excluido_em IS NULL;

ALTER TABLE indicadores_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE indicadores_carteira FORCE  ROW LEVEL SECURITY;
CREATE POLICY indicadores_carteira_por_grupo ON indicadores_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON indicadores_carteira FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON indicadores_carteira TO fir_carteira;

-- ---------------------------------------------------------------------------
-- 2 · `lancamentos_de_indicador` — uma MEDIÇÃO pontual (spec §1, critérios
-- 2.1.2 e 2.1.3). Idempotente por `(indicador_id, referencia)` — relançar a
-- mesma referência faz UPDATE, nunca duplica (regra 26 adaptada: a chave é o
-- par, e quem garante é a UNIQUE abaixo, não um "achar e decidir" da
-- aplicação).
--
-- `valor_centavos`/`valor_inteiro`: duas colunas, porque `unidade = 'R$'` é
-- `Dinheiro` (bigint centavos) e `unidade IN ('un','%')` é inteiro simples
-- (contagem, ou percentual em centésimos) — um tipo de coluna NÃO serve às
-- duas (critério 2.1.2). A coerência com `indicadores_carteira.unidade` é
-- cobrada por TRIGGER, não por CHECK: um CHECK do Postgres não pode consultar
-- outra tabela, e duplicar a unidade numa coluna própria (ao invés de ler do
-- indicador) abriria a possibilidade de ela divergir do cadastro. A falha
-- ainda acontece NO BANCO, com `RAISE EXCEPTION` — mesma garantia que um CHECK
-- daria, se pudesse.
-- ---------------------------------------------------------------------------
CREATE TABLE lancamentos_de_indicador (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicador_id    uuid NOT NULL REFERENCES indicadores_carteira(id),
  grupo_id        uuid NOT NULL REFERENCES grupos(id),
  referencia      date NOT NULL,
  valor_centavos  bigint,
  valor_inteiro   bigint,
  observacao      text,
  lancado_por     uuid NOT NULL REFERENCES usuarios_gestao(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT lancamentos_de_indicador_um_so_tipo CHECK (
    (valor_centavos IS NOT NULL AND valor_inteiro IS NULL) OR
    (valor_centavos IS NULL AND valor_inteiro IS NOT NULL)
  ),
  UNIQUE (indicador_id, referencia)
);

COMMENT ON TABLE lancamentos_de_indicador IS
  'Lançamento de indicador (CONTEXT.md): uma medição pontual, NUNCA dinheiro '
  'entrando ou saindo de lugar nenhum. Idempotente por (indicador_id, '
  'referencia) — relançar a mesma referência corrige o valor, não duplica '
  '(critério 2.1.3): a auditoria em auditoria_da_carteira é quem registra as '
  'DUAS entradas (de→para) quando isso acontece.';

CREATE INDEX lancamentos_de_indicador_por_indicador ON lancamentos_de_indicador (indicador_id, referencia DESC);

ALTER TABLE lancamentos_de_indicador ENABLE ROW LEVEL SECURITY;
ALTER TABLE lancamentos_de_indicador FORCE  ROW LEVEL SECURITY;
CREATE POLICY lancamentos_de_indicador_por_grupo ON lancamentos_de_indicador
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON lancamentos_de_indicador FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON lancamentos_de_indicador TO fir_carteira;

-- A função de coerência — reaproveitada por `metas_comerciais` abaixo (achado
-- 4 do ADR 0015: o CHECK/trigger de `lancamentos_de_indicador` tem que valer
-- SIMETRICAMENTE para `metas`, não só para o lançamento).
CREATE FUNCTION validar_valor_por_unidade(
  p_indicador_id uuid,
  p_valor_centavos bigint,
  p_valor_inteiro bigint,
  p_rotulo text
) RETURNS void AS $$
DECLARE
  v_unidade text;
BEGIN
  SELECT unidade INTO v_unidade FROM indicadores_carteira WHERE id = p_indicador_id;
  IF v_unidade IS NULL THEN
    RAISE EXCEPTION 'indicador % não encontrado', p_indicador_id;
  END IF;

  IF v_unidade = 'R$' THEN
    IF p_valor_centavos IS NULL OR p_valor_inteiro IS NOT NULL THEN
      RAISE EXCEPTION '% de indicador unidade=R$ precisa de valor_centavos preenchido e valor_inteiro NULL (indicador %)',
        p_rotulo, p_indicador_id;
    END IF;
  ELSE
    IF p_valor_inteiro IS NULL OR p_valor_centavos IS NOT NULL THEN
      RAISE EXCEPTION '% de indicador unidade=% precisa de valor_inteiro preenchido e valor_centavos NULL (indicador %)',
        p_rotulo, v_unidade, p_indicador_id;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE FUNCTION validar_lancamento_de_indicador() RETURNS trigger AS $$
BEGIN
  PERFORM validar_valor_por_unidade(NEW.indicador_id, NEW.valor_centavos, NEW.valor_inteiro, 'lançamento');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lancamentos_de_indicador_valida_unidade
  BEFORE INSERT OR UPDATE ON lancamentos_de_indicador
  FOR EACH ROW EXECUTE FUNCTION validar_lancamento_de_indicador();

-- ---------------------------------------------------------------------------
-- 3 · `metas_comerciais` — `Meta comercial do cliente` (spec §1, critérios
-- 2.1.4 e 2.1.5). SEM `valor_atual`: o progresso é sempre DERIVADO do último
-- `lancamentos_de_indicador` da série (critério 2.1.4) — um campo mutável
-- duplicando um derivado é a mesma classe de erro vetada para saldo de
-- estoque (regra 11) e saldo em aberto (regra 5).
--
-- `valor_meta_*`/`valor_inicial_*`: MESMO par de colunas e MESMA trigger de
-- `lancamentos_de_indicador` (achado 4 do ADR 0015) — sem isto, seria fácil a
-- migration nascer com o CHECK num lugar só.
-- ---------------------------------------------------------------------------
CREATE TABLE metas_comerciais (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id     uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id                uuid NOT NULL REFERENCES grupos(id),
  indicador_id            uuid NOT NULL REFERENCES indicadores_carteira(id),
  titulo                  text NOT NULL CHECK (length(btrim(titulo)) BETWEEN 1 AND 160),
  sentido                 text NOT NULL CHECK (sentido IN ('maior_melhor', 'menor_melhor')),
  valor_meta_centavos     bigint,
  valor_meta_inteiro      bigint,
  valor_inicial_centavos  bigint,
  valor_inicial_inteiro   bigint,
  inicio                  date NOT NULL,
  prazo                   date NOT NULL CHECK (prazo >= inicio),
  status                  text NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento', 'concluida')),
  criado_em               timestamptz NOT NULL DEFAULT now(),
  excluido_em             timestamptz,

  CONSTRAINT metas_comerciais_meta_um_so_tipo CHECK (
    (valor_meta_centavos IS NOT NULL AND valor_meta_inteiro IS NULL) OR
    (valor_meta_centavos IS NULL AND valor_meta_inteiro IS NOT NULL)
  ),
  -- `valor_inicial_*` é OPCIONAL (ao contrário de `valor_meta_*`, que é
  -- sempre obrigatório — toda meta tem um alvo, nem toda meta registra de
  -- onde partiu): os DOIS NULL são um estado válido ("sem valor inicial
  -- registrado"), ao lado dos dois casos de exatamente-um-preenchido.
  CONSTRAINT metas_comerciais_inicial_um_so_tipo CHECK (
    (valor_inicial_centavos IS NULL AND valor_inicial_inteiro IS NULL) OR
    (valor_inicial_centavos IS NOT NULL AND valor_inicial_inteiro IS NULL) OR
    (valor_inicial_centavos IS NULL AND valor_inicial_inteiro IS NOT NULL)
  )
);

COMMENT ON TABLE metas_comerciais IS
  'Meta comercial do cliente (CONTEXT.md): um alvo sobre UM indicador de UM '
  'Cliente Firmare. Progresso SEMPRE derivado do último lançamento da série '
  '(critério 2.1.4) — não há valor_atual aqui, de propósito. "Meta interna da '
  'carteira" (sem cliente, escopo geral/usuário de gestão) fica FORA desta '
  'migration — corte explícito do spec G3 §4.';

CREATE INDEX metas_comerciais_por_cliente ON metas_comerciais (cliente_carteira_id)
  WHERE excluido_em IS NULL;

ALTER TABLE metas_comerciais ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas_comerciais FORCE  ROW LEVEL SECURITY;
CREATE POLICY metas_comerciais_por_grupo ON metas_comerciais
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON metas_comerciais FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON metas_comerciais TO fir_carteira;

CREATE FUNCTION validar_meta_comercial() RETURNS trigger AS $$
BEGIN
  PERFORM validar_valor_por_unidade(NEW.indicador_id, NEW.valor_meta_centavos, NEW.valor_meta_inteiro, 'valor_meta');
  IF NEW.valor_inicial_centavos IS NOT NULL OR NEW.valor_inicial_inteiro IS NOT NULL THEN
    PERFORM validar_valor_por_unidade(NEW.indicador_id, NEW.valor_inicial_centavos, NEW.valor_inicial_inteiro, 'valor_inicial');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER metas_comerciais_valida_unidade
  BEFORE INSERT OR UPDATE ON metas_comerciais
  FOR EACH ROW EXECUTE FUNCTION validar_meta_comercial();

-- ---------------------------------------------------------------------------
-- 4 · `beneficios_de_indicacao` — `Benefício de indicação` (spec §1). Desconto
-- de USO ÚNICO sobre UMA `Cobrança` futura. `percentual_centesimos` nasce
-- `bigint` com `CHECK` desde a PRIMEIRA migration (achado 5 do ADR 0015) —
-- nunca `TEXT` com parsing depois.
--
-- Consumo: `consumido_em`/`cobranca_id` nascem juntos NULL e são preenchidos
-- juntos, nunca em dois passos separados visíveis de fora — é o job de
-- geração (achado 3 do ADR 0015) quem garante a atomicidade com
-- `SELECT ... FOR UPDATE SKIP LOCKED` seguido do `INSERT` da `Cobrança` na
-- MESMA transação.
-- ---------------------------------------------------------------------------
CREATE TABLE beneficios_de_indicacao (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id   uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id              uuid NOT NULL REFERENCES grupos(id),
  percentual_centesimos bigint NOT NULL CHECK (percentual_centesimos BETWEEN 0 AND 10000),
  motivo                text,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  -- NULL até o job de geração consumir. Preenchidos JUNTOS (trigger abaixo).
  consumido_em          timestamptz,
  cobranca_id           uuid,

  CONSTRAINT beneficios_de_indicacao_consumo_junto CHECK (
    (consumido_em IS NULL) = (cobranca_id IS NULL)
  )
);

COMMENT ON TABLE beneficios_de_indicacao IS
  'Benefício de indicação (CONTEXT.md): desconto de USO ÚNICO sobre UMA '
  'Cobrança futura. percentual_centesimos é bigint com CHECK desde a '
  'primeira migration (achado 5, ADR 0015) — nunca TEXT.';

-- Só um benefício não-consumido por `cliente_carteira_id` de cada vez não é
-- exigido pelo spec (um cliente pode acumular indicações) — por isso NÃO há
-- UNIQUE aqui. O que a constraint acima garante é que CADA benefício, uma vez
-- consumido, aponta para exatamente UMA cobrança, para sempre.
CREATE INDEX beneficios_de_indicacao_nao_consumidos ON beneficios_de_indicacao (cliente_carteira_id)
  WHERE consumido_em IS NULL;

ALTER TABLE beneficios_de_indicacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficios_de_indicacao FORCE  ROW LEVEL SECURITY;
CREATE POLICY beneficios_de_indicacao_por_grupo ON beneficios_de_indicacao
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON beneficios_de_indicacao FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON beneficios_de_indicacao TO fir_carteira;

-- ---------------------------------------------------------------------------
-- 5 · `cobrancas_do_cliente_firmare` — `Cobrança do Cliente Firmare` (spec
-- §1, critérios 2.2.7 a 2.2.12). Dinheiro REAL da Firmare.
--
-- `UNIQUE (cliente_carteira_id, competencia)` é a chave de idempotência
-- (regra 26): o job de geração usa `INSERT ... ON CONFLICT DO NOTHING`,
-- NUNCA `DO UPDATE` (achado 2 do ADR 0015 — `DO UPDATE` violaria o snapshot
-- imutável do valor se a mensalidade mudar entre execuções do mesmo dia).
--
-- `mensalidade_centavos`/`desconto_centavos`/`valor_centavos`: as TRÊS,
-- nunca só o valor final — o desconto é o registro do `Benefício`
-- efetivamente aplicado (auditável, ADR 0015 Decisão 1), e a mensalidade é o
-- SNAPSHOT bruto da época (critério 2.2.8), antes do desconto.
-- ---------------------------------------------------------------------------
CREATE TABLE cobrancas_do_cliente_firmare (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_carteira_id   uuid NOT NULL REFERENCES clientes_carteira(id),
  grupo_id              uuid NOT NULL REFERENCES grupos(id),
  -- Sempre o primeiro dia do mês — convenção única, nunca "qualquer dia do mês".
  competencia           date NOT NULL,
  mensalidade_centavos  bigint NOT NULL CHECK (mensalidade_centavos >= 0),
  desconto_centavos     bigint NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0),
  valor_centavos        bigint NOT NULL CHECK (valor_centavos >= 0),
  beneficio_id          uuid REFERENCES beneficios_de_indicacao(id),
  vencimento            date NOT NULL,
  status                text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'pago', 'cancelado')),
  pago_em               timestamptz,
  pago_por              text,
  gerado_em             timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cobrancas_do_cliente_firmare_conta_fecha CHECK (
    valor_centavos = mensalidade_centavos - desconto_centavos
  ),
  CONSTRAINT cobrancas_do_cliente_firmare_desconto_nao_estoura CHECK (
    desconto_centavos <= mensalidade_centavos
  ),
  CONSTRAINT cobrancas_do_cliente_firmare_pago_junto CHECK (
    (status = 'pago') = (pago_em IS NOT NULL)
  ),
  UNIQUE (cliente_carteira_id, competencia)
);

COMMENT ON TABLE cobrancas_do_cliente_firmare IS
  'Cobrança do Cliente Firmare (CONTEXT.md): dinheiro REAL que a Firmare '
  'fatura de um Cliente Firmare numa competência. Gerada por job mensal '
  'idempotente (ON CONFLICT DO NOTHING, NUNCA DO UPDATE — achado 2, ADR '
  '0015). valor_centavos é SNAPSHOT: nunca recalculado do valor atual da '
  'mensalidade depois de gerado (critério 2.2.8).';

CREATE INDEX cobrancas_do_cliente_firmare_por_cliente ON cobrancas_do_cliente_firmare
  (cliente_carteira_id, competencia DESC);

ALTER TABLE cobrancas_do_cliente_firmare ENABLE ROW LEVEL SECURITY;
ALTER TABLE cobrancas_do_cliente_firmare FORCE  ROW LEVEL SECURITY;
CREATE POLICY cobrancas_do_cliente_firmare_por_grupo ON cobrancas_do_cliente_firmare
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON cobrancas_do_cliente_firmare FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON cobrancas_do_cliente_firmare TO fir_carteira;

-- `beneficios_de_indicacao.cobranca_id` só pode ser resolvido DEPOIS que a
-- cobrança existe — a FK entra agora que a tabela já está criada.
ALTER TABLE beneficios_de_indicacao
  ADD CONSTRAINT beneficios_de_indicacao_cobranca_fk
  FOREIGN KEY (cobranca_id) REFERENCES cobrancas_do_cliente_firmare(id);

-- ---------------------------------------------------------------------------
-- 6 · `auditoria_da_carteira` — a trilha de ESCRITA do `Usuário de Gestão`
-- sobre tabelas da carteira (quem, quando, de→para — regra 20).
--
-- NÃO é a mesma coisa que `auditoria_do_painel` (0030, ator Operador) nem a
-- trilha de CLÍNICA (`auditoria`, trigger `registrar_auditoria`, que lê
-- `app.pessoa_id` da sessão) — nenhuma tabela desta migration tem
-- `clinica_id`, então o trigger genérico não se aplica, e `app.pessoa_id` das
-- conexões de LEITURA da carteira é sempre `'sistema'` (`nasTabelasDaCarteiraComEscopo`,
-- `banco.service.ts`), o que mentiria sobre quem escreveu. Por isso a trilha
-- aqui é gravada EXPLICITAMENTE pelo código da aplicação (cada serviço grava
-- a própria linha, com o id do `Usuário de Gestão` real, como valor — nunca
-- lido de uma variável de sessão), não por trigger.
--
-- APPEND-ONLY (regra 20): REVOKE de UPDATE/DELETE, mesmo padrão de
-- `auditoria_do_painel` (0030).
-- ---------------------------------------------------------------------------
CREATE TABLE auditoria_da_carteira (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_gestao_id uuid NOT NULL REFERENCES usuarios_gestao(id),
  grupo_id          uuid NOT NULL REFERENCES grupos(id),
  tabela            text NOT NULL,
  registro_id       uuid NOT NULL,
  acao              text NOT NULL CHECK (acao IN ('criar', 'atualizar', 'marcar_pago', 'desfazer_pago')),
  de                jsonb,
  para              jsonb,
  em                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE auditoria_da_carteira IS
  'Trilha de ESCRITA do Usuário de Gestão sobre tabelas da carteira (quem, '
  'quando, de→para — regra 20). Gravada EXPLICITAMENTE pelo código da '
  'aplicação, nunca por trigger: as tabelas de G3 não têm clinica_id, e '
  'app.pessoa_id das conexões de leitura da carteira é sempre "sistema".';

CREATE INDEX auditoria_da_carteira_por_registro ON auditoria_da_carteira (tabela, registro_id, em DESC);

ALTER TABLE auditoria_da_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_da_carteira FORCE  ROW LEVEL SECURITY;
CREATE POLICY auditoria_da_carteira_por_grupo ON auditoria_da_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

REVOKE ALL ON auditoria_da_carteira FROM fir_app;
GRANT SELECT, INSERT ON auditoria_da_carteira TO fir_carteira;
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria_da_carteira FROM fir_carteira;
