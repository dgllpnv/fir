-- 0079 — O MOTIVO da ação de suporte chega à trilha (I1, revisão LGPD/appsec).
--
-- `auditoria.motivo` existe desde a 0004 e NINGUÉM o preenchia: o operador
-- (sessão de suporte) excluía tarefa, estornava recebimento e reativava
-- paciente sem deixar o porquê, e decisoes.md exige "justificativa por acesso".
--
-- O motivo viaja numa variável de sessão POR TRANSAÇÃO, `app.motivo`
-- (`set_config(..., true)`), igual a `app.pessoa_id`: some no COMMIT/ROLLBACK e
-- não vaza para a próxima requisição do pool. Toda linha de trilha escrita
-- naquela transação leva o mesmo motivo — a exclusão que estorna um pagamento e
-- encerra um programa é UMA ação, com UMA justificativa. Sem a variável, o
-- motivo continua NULL, como sempre foi (pessoa da clínica: inalterado).
--
-- `CREATE OR REPLACE` exige o corpo inteiro: copiado da 0034, com o motivo.
-- Forward-only: a 0034 não é editada.

CREATE OR REPLACE FUNCTION registrar_auditoria() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_cru     text := coalesce(current_setting('app.pessoa_id', true), '');
  v_tipo    text;
  v_ator    uuid;
  v_old     jsonb;
  v_new     jsonb;
  v_de      jsonb;
  v_para    jsonb;
  v_id      text;
  v_clinica uuid;
  v_motivo  text := nullif(btrim(coalesce(current_setting('app.motivo', true), '')), '');
BEGIN
  IF v_cru = '' THEN
    RAISE EXCEPTION 'ator não declarado: escrita em % recusada', TG_TABLE_NAME
      USING HINT = 'Use banco.naClinica(clinica, ator, …). Em job, semente ou '
                   'migration de dados, passe SISTEMA — explicitamente.';
  ELSIF v_cru = 'sistema' THEN
    v_tipo := 'sistema';
    v_ator := NULL;
  ELSIF left(v_cru, 9) = 'operador:' THEN
    v_tipo := 'operador';
    v_ator := substr(v_cru, 10)::uuid;
  ELSIF left(v_cru, 15) = 'usuario_gestao:' THEN
    v_tipo := 'usuario_gestao';
    v_ator := substr(v_cru, 16)::uuid;
  ELSIF left(v_cru, 15) = 'usuario_portal:' THEN
    v_tipo := 'usuario_portal';
    v_ator := substr(v_cru, 16)::uuid;
  ELSE
    v_tipo := 'pessoa';
    v_ator := v_cru::uuid;
  END IF;

  IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;

  IF TG_OP = 'DELETE' THEN
    v_de := v_old;
    v_para := NULL;
    v_id := v_old ->> 'id';
    v_clinica := (v_old ->> 'clinica_id')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_de := NULL;
    v_para := v_new;
    v_id := v_new ->> 'id';
    v_clinica := (v_new ->> 'clinica_id')::uuid;
  ELSE
    SELECT jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      INTO v_de, v_para
      FROM jsonb_object_keys(v_new) k
     WHERE v_old -> k IS DISTINCT FROM v_new -> k;
    IF v_para IS NULL THEN RETURN NULL; END IF;
    v_id := v_new ->> 'id';
    v_clinica := (v_new ->> 'clinica_id')::uuid;
  END IF;

  INSERT INTO public.auditoria
    (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, de, para, motivo)
  VALUES (
    v_clinica,
    v_tipo,
    v_ator,
    CASE TG_OP WHEN 'INSERT' THEN 'criou' WHEN 'UPDATE' THEN 'alterou' ELSE 'removeu' END,
    TG_TABLE_NAME,
    v_id,
    public.auditoria_sem_segredos(v_de),
    public.auditoria_sem_segredos(v_para),
    v_motivo);

  RETURN NULL;
END $$;
