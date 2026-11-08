-- ---------------------------------------------------------------------------
-- G8 0.5 — `carteira.administrar` nas policies de escrita das tabelas globais
-- da carteira criadas pela 0054 (ticket 3A): `mensagens_comerciais`,
-- `roteiros_comerciais` e `configuracao_da_carteira` (appsec A-9, A-19).
--
-- A 0054 deixou escrito: só `escopo = 'geral'` escreve, e "quando o ticket 0.5
-- criar `carteira.administrar`, a policy ganha a chave por AND". É isto. Vem
-- numa migration própria, depois da 0054, porque a 0050 (que cria a coluna
-- `usuarios_gestao.administrar`) roda ANTES de as tabelas existirem — e uma
-- migration aplicada nunca é editada.
--
-- A chave é lida do BANCO, pela linha do ator da transação (`app.pessoa_id =
-- 'usuario_gestao:<id>'`, fixado por `nasTabelasDaCarteiraComoUsuarioDeGestao`),
-- nunca de um GUC que a aplicação escolha: um GUC `app.administrar` seria um
-- privilégio declarado pelo próprio código que ele deveria conter. Sem ator de
-- `Usuário de Gestão` (sistema, Operador, semente), a função devolve `false` e
-- a escrita é recusada — falha fechada.
--
-- `fir_carteira` já lê `usuarios_gestao` (SELECT de tabela, 0025/0041), então
-- a função não precisa de SECURITY DEFINER: roda com o privilégio de quem
-- consulta, e não abre nada que o papel já não tivesse.
-- ---------------------------------------------------------------------------

CREATE FUNCTION app_carteira_pode_administrar() RETURNS boolean
  LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS $$
DECLARE
  v_cru  text := coalesce(current_setting('app.pessoa_id', true), '');
  v_tipo text;
  v_ator uuid;
  v_ok   boolean;
BEGIN
  IF v_cru = '' THEN
    RETURN false;
  END IF;
  SELECT tipo, ator INTO v_tipo, v_ator FROM auditoria_resolver_ator(v_cru);
  IF v_tipo IS DISTINCT FROM 'usuario_gestao' OR v_ator IS NULL THEN
    RETURN false;
  END IF;
  SELECT u.administrar AND u.ativo AND u.escopo = 'geral' INTO v_ok
    FROM usuarios_gestao u WHERE u.id = v_ator;
  RETURN coalesce(v_ok, false);
END $$;

COMMENT ON FUNCTION app_carteira_pode_administrar() IS
  'G8 0.5: o ator da transação é um Usuário de Gestão ativo, de escopo geral, '
  'com carteira.administrar? Lido da linha dele, nunca de GUC escolhido pela aplicação.';

REVOKE ALL ON FUNCTION app_carteira_pode_administrar() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_carteira_pode_administrar() TO fir_carteira;

ALTER POLICY mensagens_comerciais_criacao ON mensagens_comerciais
  WITH CHECK (app_escopo() = 'geral' AND app_carteira_pode_administrar());
ALTER POLICY mensagens_comerciais_edicao ON mensagens_comerciais
  USING (app_escopo() = 'geral' AND app_carteira_pode_administrar())
  WITH CHECK (app_escopo() = 'geral' AND app_carteira_pode_administrar());

ALTER POLICY roteiros_comerciais_criacao ON roteiros_comerciais
  WITH CHECK (app_escopo() = 'geral' AND app_carteira_pode_administrar());
ALTER POLICY roteiros_comerciais_edicao ON roteiros_comerciais
  USING (app_escopo() = 'geral' AND app_carteira_pode_administrar())
  WITH CHECK (app_escopo() = 'geral' AND app_carteira_pode_administrar());

ALTER POLICY configuracao_da_carteira_edicao ON configuracao_da_carteira
  USING (app_escopo() = 'geral' AND app_carteira_pode_administrar())
  WITH CHECK (app_escopo() = 'geral' AND app_carteira_pode_administrar());
