-- ---------------------------------------------------------------------------
-- A CADEIA DE TAREFAS NUNCA CRUZA DE UM PACIENTE PARA OUTRO (appsec S2).
-- Expand-only: um trigger, sem tocar em coluna nem em linha. Todo dado antigo
-- passa: nenhuma tarefa anterior à 0084 tem `tarefa_origem_id`, e o trigger só
-- olha linhas com origem (ou com filhas).
--
-- A regra, com precisão:
--   * a ORIGEM pode não ter paciente; se tem, a filha tem de ser do MESMO paciente
--     (uma filha interna de origem com paciente também é recusada — é a regra que
--     a criação já aplica no serviço);
--   * ao TROCAR o paciente de uma tarefa que já tem filhas, nenhuma filha pode
--     ficar com paciente diferente (tirar o paciente é livre: "sem paciente" é neutro).
-- A criação já conferia isso no serviço; o PATCH de `pacienteId` não. O banco
-- fecha as duas portas, e qualquer escrita futura que passe por fora do serviço.
-- ---------------------------------------------------------------------------
CREATE FUNCTION tarefa_origem_do_mesmo_paciente() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paciente_da_origem uuid;
  tem_origem_com_paciente boolean := false;
BEGIN
  IF NEW.tarefa_origem_id IS NOT NULL THEN
    SELECT o.paciente_id, o.paciente_id IS NOT NULL
      INTO paciente_da_origem, tem_origem_com_paciente
      FROM tarefas o
     WHERE o.id = NEW.tarefa_origem_id AND o.clinica_id = NEW.clinica_id;
    IF tem_origem_com_paciente AND NEW.paciente_id IS DISTINCT FROM paciente_da_origem THEN
      RAISE EXCEPTION 'tarefa_origem_do_mesmo_paciente: a origem é de outro paciente'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'tarefa_origem_do_mesmo_paciente';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.paciente_id IS NOT NULL
     AND NEW.paciente_id IS DISTINCT FROM OLD.paciente_id
     AND EXISTS (SELECT 1 FROM tarefas f
                  WHERE f.tarefa_origem_id = NEW.id AND f.clinica_id = NEW.clinica_id
                    AND f.paciente_id IS DISTINCT FROM NEW.paciente_id) THEN
    RAISE EXCEPTION 'tarefa_origem_do_mesmo_paciente: há tarefas derivadas de outro paciente'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tarefa_origem_do_mesmo_paciente';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER tarefa_origem_do_mesmo_paciente
  BEFORE INSERT OR UPDATE OF paciente_id, tarefa_origem_id ON tarefas
  FOR EACH ROW EXECUTE FUNCTION tarefa_origem_do_mesmo_paciente();
