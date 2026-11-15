-- ---------------------------------------------------------------------------
-- TAREFA PARA GRUPO, ORIGEM E FLUXO (ADR 2026-11-14). Expand-only: colunas
-- nuláveis e uma constraint que todo dado já migrado satisfaz
-- (`responsavel_id` hoje é NOT NULL e `grupo_id` nasce NULL).
-- ---------------------------------------------------------------------------
ALTER TABLE tarefas ADD COLUMN grupo_id uuid;
ALTER TABLE tarefas ADD COLUMN tarefa_origem_id uuid;

-- FKs COMPOSTAS com a clínica (appsec S1): o id da clínica vizinha FALHA por
-- constraint, não só some da leitura pela RLS.
ALTER TABLE tarefas ADD CONSTRAINT tarefa_e_do_grupo_da_clinica
  FOREIGN KEY (grupo_id, clinica_id) REFERENCES grupos_da_equipe (id, clinica_id);
ALTER TABLE tarefas ADD CONSTRAINT tarefa_vem_de_tarefa_da_clinica
  FOREIGN KEY (tarefa_origem_id, clinica_id) REFERENCES tarefas (id, clinica_id);
-- `responsavel_id` era validado só no serviço; agora o banco também (expand:
-- a FK simples para pessoas(id) continua).
ALTER TABLE tarefas ADD CONSTRAINT tarefa_responsavel_e_da_clinica
  FOREIGN KEY (responsavel_id, clinica_id) REFERENCES pessoas (id, clinica_id);

-- Destino EXCLUSIVO: pessoa OU grupo, exatamente um. Nunca uma pessoa "de
-- enfeite" numa tarefa de grupo — ela passaria a vê-la em "Para mim" e a
-- contar na meta por algo que talvez não tenha feito.
ALTER TABLE tarefas ALTER COLUMN responsavel_id DROP NOT NULL;
ALTER TABLE tarefas ADD CONSTRAINT tarefa_tem_destino
  CHECK ((responsavel_id IS NULL) <> (grupo_id IS NULL));

-- A cadeia nunca aponta para si mesma (appsec S2); ciclos maiores são cortados
-- na leitura, pelo array de ids visitados.
ALTER TABLE tarefas ADD CONSTRAINT tarefa_origem_nao_e_ela_mesma
  CHECK (tarefa_origem_id IS NULL OR tarefa_origem_id <> id);

-- "Para mim" inclui as tarefas dos meus grupos: mesma forma do índice por
-- responsável, só nas abertas.
CREATE INDEX tarefas_abertas_do_grupo ON tarefas (clinica_id, grupo_id, prazo)
  WHERE status = 'aberta' AND excluida_em IS NULL AND grupo_id IS NOT NULL;
CREATE INDEX tarefas_por_origem ON tarefas (clinica_id, tarefa_origem_id)
  WHERE tarefa_origem_id IS NOT NULL;

COMMENT ON COLUMN tarefas.grupo_id IS
  'Destino coletivo. Exatamente um de responsavel_id / grupo_id (tarefa_tem_destino). Assumir move para responsavel_id e zera este.';
COMMENT ON COLUMN tarefas.tarefa_origem_id IS
  'A tarefa de onde esta nasceu ("concluir e criar nova"). Só do mesmo paciente ou sem paciente (regra do serviço, appsec S2).';
