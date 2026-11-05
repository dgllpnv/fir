-- ---------------------------------------------------------------------------
-- `sessoes_de_carteira` — persistência de sessão do `Usuário de Gestão`.
-- Mesma forma de `sessoes_de_operador` (0013).
--
-- SEM segundo fator: o gate de segurança (`especialista-seguranca-appsec`)
-- havia exigido MFA obrigatório para este ator (ADR 0012), mas o dono
-- decidiu manter o mesmo padrão de segurança já usado no resto do produto —
-- senha + Argon2 + limite de tentativas, sem segundo fator. Risco aceito e
-- registrado por escrito: ver ADR 0012 (emenda 2026-11-05) e
-- `docs/dividas.md` D3b.
-- ---------------------------------------------------------------------------

CREATE TABLE sessoes_de_carteira (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_gestao_id uuid NOT NULL REFERENCES usuarios_gestao(id),
  token_hash        text NOT NULL UNIQUE,
  criada_em         timestamptz NOT NULL DEFAULT now(),
  expira_em         timestamptz NOT NULL,
  revogada_em       timestamptz
);
CREATE INDEX sessoes_de_carteira_vivas ON sessoes_de_carteira (usuario_gestao_id)
  WHERE revogada_em IS NULL;

COMMENT ON TABLE sessoes_de_carteira IS
  'Sessão do Usuário de Gestão. Revogação (P-12) é ativo=false em '
  'usuarios_gestao OU revogada_em aqui — o guard confere as DUAS a cada '
  'requisição, nunca só no login.';

REVOKE ALL ON sessoes_de_carteira FROM fir_app;
GRANT SELECT, INSERT, UPDATE ON sessoes_de_carteira TO fir_carteira;
