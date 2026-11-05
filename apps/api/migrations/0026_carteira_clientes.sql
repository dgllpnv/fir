-- ---------------------------------------------------------------------------
-- G2 — `clientes_carteira`. ADRs 0011, 0012.
--
-- `clinica_id NOT NULL`: a Rodada 2 do grilling cortou o estágio de lead
-- (sem clínica) da fatia mínima — isso é G5, funil de prospecção completo.
-- Aqui, todo `Cliente Firmare` já tem uma `Clinica` real.
--
-- `grupo_id NOT NULL`, não `Clinica.grupo_id`: a simplificação encontrada ao
-- planejar G2 (ver plano §7) — a RLS da carteira (ADR 0012) só lê as
-- tabelas PRÓPRIAS da carteira, nunca `clinica_id` cruzado. `Clinica.grupo_id`
-- (G1b) fica para depois, se um dia for preciso.
-- ---------------------------------------------------------------------------

CREATE TABLE clientes_carteira (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id   uuid NOT NULL REFERENCES grupos(id),
  clinica_id uuid NOT NULL UNIQUE REFERENCES clinicas(id),
  nome       text NOT NULL,
  produto    text NOT NULL,
  status     text NOT NULL DEFAULT 'onboarding'
               CHECK (status IN ('onboarding', 'ativo', 'pausado', 'encerrado')),
  -- Estado, nunca exclusão — regra 20, mesma forma de `clinicas.ativa`.
  criado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz
);

COMMENT ON TABLE clientes_carteira IS
  'O registro comercial de quem contrata a consultoria (CONTEXT.md, '
  '"Cliente Firmare"). clinica_id ÚNICO: uma Clinica tem no máximo um '
  'Cliente Firmare. NOT NULL nesta fatia — o estágio de lead sem clínica é '
  'G5, cortado daqui na Rodada 2 do grilling.';

CREATE INDEX clientes_carteira_por_grupo ON clientes_carteira (grupo_id)
  WHERE excluido_em IS NULL;

-- RLS: a PRIMEIRA tabela de negócio da carteira a usar app_grupo_id() de
-- verdade (ADR 0012). app_escopo() = 'geral' é o superadmin operando a
-- carteira — vê tudo, sem associação a grupo nenhum.
ALTER TABLE clientes_carteira ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes_carteira FORCE  ROW LEVEL SECURITY;
CREATE POLICY clientes_carteira_por_grupo ON clientes_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));

-- `fir_app` nunca toca a carteira. `fir_carteira` lê/escreve sujeito à RLS
-- acima — nunca BYPASSRLS (checado no boot da 0025).
REVOKE ALL ON clientes_carteira FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON clientes_carteira TO fir_carteira;

-- A trilha universal (regra 20). `clientes_carteira` TEM `clinica_id` —
-- ainda que o RLS seja por `grupo_id` — e por isso entra na varredura de
-- `auditoria-inescapavel.test.ts` como qualquer tabela de negócio: nenhuma
-- escapa. A escrita grava na `auditoria` DA CLÍNICA ligada — "a Firmare
-- registrou/mudou isto comercialmente" é algo que a própria clínica tem o
-- direito de ver na trilha dela (mesmo espírito da D-10 para o `Operador`).
-- Quem escreve (G2, service) fixa `app.pessoa_id = 'operador:<uuid>'` — só
-- o superadmin cria `Cliente Firmare` (Q9/ADR 0011).
--
-- Isto NÃO é a trilha de ACESSO que falta (ADR 0013 §7, "quem da Firmare LEU
-- o quê") — aquela é `auditoria_da_carteira`, e chega com G4, quando existir
-- o primeiro dashboard que de fato lê dado agregado de várias clínicas.
CREATE TRIGGER clientes_carteira_auditoria
  AFTER INSERT OR UPDATE OR DELETE ON clientes_carteira
  FOR EACH ROW EXECUTE FUNCTION registrar_auditoria();
