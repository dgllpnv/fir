-- ---------------------------------------------------------------------------
-- G8 0.5 — PERFIS DO `Usuário de Gestão` (item T1 do inventário; gate de
-- appsec A-1..A-6, A-9; D-22 itens 2 e 3). Forward-only, EXPAND puro: só
-- acrescenta colunas, nenhuma é removida nem renomeada.
--
-- O protótipo (`index.html` L517, L1109-1120, L2772-2775) dá a cada pessoa da
-- equipe Firmare: telas (`modulos`), "Clientes que vê" (`carteira`: minha ·
-- todos), "Valores e receita" (`valores`), `setor`, `funcao` e `telefone`. A
-- Diretoria do protótipo vira a chave `administrar` (= `carteira.administrar`,
-- A-9): concedida pelo Operador, cobre arquivar, editar conteúdo e
-- configuração, compartilhar todas as reuniões e redistribuir tarefas. Nunca
-- identidade.
--
-- QUEM ESCREVE: só `fir_painel` (o Operador), que já tem `INSERT, UPDATE` na
-- tabela inteira desde a 0041. `fir_carteira` tem só `UPDATE` POR COLUNA nas
-- três colunas de senha, e coluna nova não herda GRANT por coluna — as sete
-- colunas abaixo ficam fora do alcance da sessão que elas protegem POR
-- CONSTRUÇÃO (A-1). A guarda no fim confere isso, em vez de presumir.
--
-- O QUE A AUSÊNCIA SIGNIFICA (expand/contract): uma linha que já existe, ou
-- um `INSERT` antigo que não cita as colunas novas, mantém EXATAMENTE o
-- comportamento de antes desta migration:
--   * `valores = false` — ninguém da carteira via dinheiro (achado 1);
--   * `carteira = 'todos'` — todos viam todo cliente do escopo;
--   * `modulos` = as 9 telas — não havia filtro por tela;
--   * `administrar` = `escopo = 'geral'` — era essa a regra dos pontos de
--     extensão (`podeAdministrarConteudo`, `podeEditarMensagens`,
--     `podeVerCarga`, `podeGravarLinkDaPlanilha`), agora com AND na chave.
-- `administrar` depende de outra coluna, o que um `DEFAULT` não expressa: um
-- gatilho `BEFORE INSERT` preenche o NULL. O `NOT NULL` é conferido DEPOIS dos
-- gatilhos BEFORE, então a linha nunca é gravada sem decisão. A tela do
-- superadmin sempre manda os sete campos — o gatilho só serve a quem não os
-- conhece.
--
-- `nascimento`: o protótipo pede a data inteira (L2772). O gate de LGPD (A47)
-- manda dia e mês, gravados pela PRÓPRIA pessoa — a 0051 (ticket 2A) já fez
-- isso (`aniversario_dia`, `aniversario_mes`, `definir_meu_aniversario`).
-- Esta migration não duplica.
--
-- Retenção (LGPD, `retencao.md`): `telefone` e `funcao` são dado de trabalho
-- da equipe (art. 7º, V), anulados no desligamento; a identidade segue a linha
-- de `usuarios_gestao`.
-- ---------------------------------------------------------------------------

ALTER TABLE usuarios_gestao
  ADD COLUMN valores boolean NOT NULL DEFAULT false,
  ADD COLUMN carteira text NOT NULL DEFAULT 'todos'
    CONSTRAINT usuarios_gestao_carteira_valida CHECK (carteira IN ('minha', 'todos')),
  ADD COLUMN modulos text[] NOT NULL
    DEFAULT ARRAY['painel','rotina','clientes','firclinic','metas','campanhas','resumo','prospeccao','cadastros']::text[]
    CONSTRAINT usuarios_gestao_modulos_validos CHECK (
      modulos <@ ARRAY['painel','rotina','clientes','firclinic','metas','campanhas','resumo','prospeccao','cadastros']::text[]
      AND array_position(modulos, NULL) IS NULL
    ),
  ADD COLUMN setor text
    CONSTRAINT usuarios_gestao_setor_valido CHECK (setor IN ('diretoria', 'comercial', 'administrativo', 'financeiro')),
  ADD COLUMN funcao text
    CONSTRAINT usuarios_gestao_funcao_curta CHECK (length(funcao) BETWEEN 1 AND 80),
  -- Só dígitos (DDD + número, com ou sem 55): o número vai para um link
  -- `wa.me` (A-14), e `?text=` ou `&` gravados aqui virariam parâmetro.
  ADD COLUMN telefone text
    CONSTRAINT usuarios_gestao_telefone_digitos CHECK (telefone ~ '^[0-9]{10,13}$'),
  ADD COLUMN administrar boolean;

-- Backfill: o comportamento de antes (ver o topo).
UPDATE usuarios_gestao SET administrar = (escopo = 'geral');

ALTER TABLE usuarios_gestao
  ALTER COLUMN administrar SET NOT NULL,
  -- A-5: `carteira.administrar` não é concedível a `escopo='grupo'`, nem pelo
  -- Operador. O domínio (`temPermCarteira`) também nega; aqui é a segunda
  -- camada, que não depende de código.
  ADD CONSTRAINT usuarios_gestao_administrar_so_geral CHECK (NOT administrar OR escopo = 'geral');

CREATE FUNCTION usuarios_gestao_administrar_padrao() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.administrar IS NULL THEN
    NEW.administrar := (NEW.escopo = 'geral');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER usuarios_gestao_administrar_padrao
  BEFORE INSERT ON usuarios_gestao
  FOR EACH ROW EXECUTE FUNCTION usuarios_gestao_administrar_padrao();

COMMENT ON COLUMN usuarios_gestao.valores IS
  'Vê e escreve dinheiro na carteira (temPermCarteira ''valores''). Sem ele, o '
  'RedacaoInterceptor apaga todo campo de CAMPOS_MONETARIOS e a escrita '
  'monetária responde 403 (A-6). Só o Operador concede.';
COMMENT ON COLUMN usuarios_gestao.carteira IS
  '''minha'' = só os clientes em que é a responsável, filtrado no SERVIDOR (A-3); '
  '''todos'' = todo cliente do escopo. Nunca escolhido pela requisição.';
COMMENT ON COLUMN usuarios_gestao.modulos IS
  'As telas que pode abrir (MODULOS do protótipo, L517). Autorização de '
  'servidor com negação por padrão (A-4): o CarteiraGuard confere a tela da rota.';
COMMENT ON COLUMN usuarios_gestao.setor IS
  'Decide só quem recebe item de checklist (X5). NUNCA autorização (A-4).';
COMMENT ON COLUMN usuarios_gestao.administrar IS
  'A chave carteira.administrar (A-9, D-22 item 2): arquivar, conteúdo, '
  'configuração, compartilhar todas, redistribuir. Nunca identidade. Só escopo geral (A-5).';

-- GUARDA: as colunas de privilégio não são graváveis pela sessão da carteira.
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['valores','carteira','modulos','setor','funcao','telefone','administrar'] LOOP
    IF has_column_privilege('fir_carteira', 'usuarios_gestao', col, 'UPDATE')
       OR has_column_privilege('fir_carteira', 'usuarios_gestao', col, 'INSERT') THEN
      RAISE EXCEPTION 'fir_carteira escreve usuarios_gestao.% (G8 A-1)', col;
    END IF;
    IF NOT has_column_privilege('fir_carteira', 'usuarios_gestao', col, 'SELECT') THEN
      RAISE EXCEPTION 'fir_carteira não lê usuarios_gestao.% (o guard relê o perfil a cada requisição)', col;
    END IF;
    IF NOT has_column_privilege('fir_painel', 'usuarios_gestao', col, 'UPDATE') THEN
      RAISE EXCEPTION 'fir_painel não escreve usuarios_gestao.%', col;
    END IF;
  END LOOP;
END $$;
