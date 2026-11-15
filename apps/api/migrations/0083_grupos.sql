-- ---------------------------------------------------------------------------
-- GRUPOS DE COLABORADORES — lista nomeada de pessoas da clínica, para onde uma
-- tarefa pode ir quando não importa QUAL pessoa a faz (ADR 2026-11-14, que
-- substitui a 0025). NÃO é grupo de acesso: pertencer nunca dá permissão.
--
-- O nome é `grupos_da_equipe` e não `grupos`: `grupos` já existe desde a 0025
-- da carteira (conjunto de CLÍNICAS da Firmare), e são dois conceitos em dois
-- produtos. Ver CONTEXT.md, "Grupo de colaboradores".
--
-- Expand-only: tabelas novas, nada existente é alterado exceto as chaves
-- únicas compostas que as FKs abaixo exigem (e que não removem nada).
-- ---------------------------------------------------------------------------
CREATE TABLE grupos_da_equipe (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  nome       text NOT NULL CHECK (length(nome) BETWEEN 2 AND 60),
  -- Sem caixa nem acento: "Recepção" e "recepcao" são o mesmo grupo. A mesma
  -- função que indexa o nome do paciente (`normalizar_nome`, 0006).
  nome_chave text GENERATED ALWAYS AS (normalizar_nome(nome)) STORED,
  -- Estado, nunca exclusão (regra 20). Ver docs/adr/0003.
  ativo      boolean NOT NULL DEFAULT true,
  desativado_em timestamptz,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  criado_por uuid,
  CONSTRAINT grupo_desativado_tem_instante CHECK ((NOT ativo) = (desativado_em IS NOT NULL)),
  -- Alvo das FKs compostas: sem ela, o id do grupo da vizinha passaria na
  -- referência e a RLS só esconderia a leitura (appsec S1).
  CONSTRAINT grupos_da_equipe_id_clinica UNIQUE (id, clinica_id),
  CONSTRAINT grupo_criado_por_e_da_clinica
    FOREIGN KEY (criado_por, clinica_id) REFERENCES pessoas (id, clinica_id)
);

-- Parcial em `ativo`: o grupo desativado não ocupa o nome. Reativar um grupo
-- cujo nome foi reusado esbarra aqui, e o serviço traduz em 409.
CREATE UNIQUE INDEX grupos_da_equipe_nome_unico ON grupos_da_equipe (clinica_id, nome_chave) WHERE ativo;

-- ---------------------------------------------------------------------------
-- MEMBROS — pessoa em 0..N grupos.
--
-- O vínculo é ESTADO (`removido_em`), nunca DELETE: quem pertenceu a que grupo
-- é dado de RH. A chave primária é `id`, e NÃO o par: a trigger de auditoria
-- grava `entidade_id` a partir da coluna `id`, e `teste/auditoria-inescapavel`
-- recusa tabela auditada com outra chave. A unicidade do par é a UNIQUE logo
-- abaixo — a mesma pessoa não entra duas vezes no mesmo grupo; voltar é
-- limpar `removido_em`.
-- ---------------------------------------------------------------------------
CREATE TABLE membros_de_grupo (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id  uuid NOT NULL REFERENCES clinicas(id),
  grupo_id    uuid NOT NULL,
  pessoa_id   uuid NOT NULL,
  entrou_em   timestamptz NOT NULL DEFAULT now(),
  removido_em timestamptz,
  CONSTRAINT membro_unico_no_grupo UNIQUE (clinica_id, grupo_id, pessoa_id),
  CONSTRAINT membro_e_do_grupo_da_clinica
    FOREIGN KEY (grupo_id, clinica_id) REFERENCES grupos_da_equipe (id, clinica_id),
  CONSTRAINT membro_e_pessoa_da_clinica
    FOREIGN KEY (pessoa_id, clinica_id) REFERENCES pessoas (id, clinica_id)
);

-- "Em que grupos esta pessoa está?" é a pergunta de toda leitura de tarefa.
CREATE INDEX membros_por_pessoa ON membros_de_grupo (clinica_id, pessoa_id) WHERE removido_em IS NULL;

COMMENT ON TABLE grupos_da_equipe IS
  'Grupo de colaboradores (NÃO de acesso). Nome não é dado pessoal; a composição (membros_de_grupo) é dado de RH: só config.';
COMMENT ON TABLE membros_de_grupo IS
  'Vínculo pessoa-grupo. Estado, nunca DELETE (removido_em). Dado de RH: vínculo + 5 anos (docs/compliance/retencao.md).';

-- RLS: primeira camada, nunca a única (regra 19).
ALTER TABLE grupos_da_equipe ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupos_da_equipe FORCE  ROW LEVEL SECURITY;
CREATE POLICY grupos_da_equipe_por_clinica ON grupos_da_equipe
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());

ALTER TABLE membros_de_grupo ENABLE ROW LEVEL SECURITY;
ALTER TABLE membros_de_grupo FORCE  ROW LEVEL SECURITY;
CREATE POLICY membros_de_grupo_por_clinica ON membros_de_grupo
  USING (clinica_id = app_clinica_id()) WITH CHECK (clinica_id = app_clinica_id());

-- O ALTER DEFAULT PRIVILEGES do bootstrap concede os quatro; o REVOKE é que
-- fecha DELETE (regra 20: desativar é estado).
GRANT SELECT, INSERT, UPDATE ON grupos_da_equipe, membros_de_grupo TO fir_app;
REVOKE DELETE, TRUNCATE ON grupos_da_equipe, membros_de_grupo FROM fir_app;

CREATE TRIGGER grupos_da_equipe_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON grupos_da_equipe
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();
CREATE TRIGGER membros_de_grupo_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON membros_de_grupo
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();
