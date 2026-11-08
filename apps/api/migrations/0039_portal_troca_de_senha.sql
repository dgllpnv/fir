-- ---------------------------------------------------------------------------
-- A TROCA DA PRÓPRIA SENHA NO PORTAL DO GRUPO (defeito de produção, 2026-11-08).
--
-- O `Usuário do portal` nasce com senha provisória (72 h) e o login a recusa
-- vencida — mas não existia rota para trocá-la, e a conta ficava trancada
-- para sempre três dias depois de criada. A 0034 deixou o verbo de fora de
-- propósito ("`UPDATE` chega como EXPAND quando esse endpoint existir, nunca
-- antes"). O endpoint é `POST /v1/portal/eu/senha`, e este é o expand.
--
-- Expand puro: só concede, nada é removido nem muda de sentido. A versão
-- anterior da API continua funcionando sem saber desta migration.
-- ---------------------------------------------------------------------------

-- 1. `fir_portal` passa a poder trocar a PRÓPRIA senha — e SÓ as três colunas
--    da senha. Grant por COLUNA, não por tabela: com UPDATE na tabela inteira,
--    um defeito na rota (ou uma injeção) poderia mudar `escopo`, `grupo_id` ou
--    `cliente_carteira_id` — isto é, alargar o que o próprio usuário do lado
--    de FORA da Firmare enxerga. `ativo` também fica de fora: reativar uma
--    conta desativada é decisão de quem administra, nunca do dono da conta.
GRANT UPDATE (senha_hash, senha_provisoria, senha_provisoria_expira_em)
  ON usuarios_do_portal TO fir_portal;

-- 2. A trilha. A troca de senha é uma escrita de IDENTIDADE fora de qualquer
--    clínica, e vai para `auditoria_do_painel` — a mesma trilha das escritas
--    de identidade da carteira (`usuarios_gestao`, 0030/0032). O quinto ator
--    entra no CHECK com nome próprio, nunca reaproveitando `usuario_gestao`:
--    ADR 0017 §5 item 2 — isso esconderia que foi o CLIENTE quem escreveu.
ALTER TABLE auditoria_do_painel DROP CONSTRAINT IF EXISTS auditoria_do_painel_ator_tipo_check;
ALTER TABLE auditoria_do_painel ADD CONSTRAINT auditoria_do_painel_ator_tipo_check
  CHECK (ator_tipo IN ('operador', 'vps', 'sistema', 'usuario_gestao', 'usuario_portal'));

-- `INSERT` e só `INSERT` — nem `SELECT`: o portal não tem por que ler a trilha
-- de ninguém. O par de REVOKE é o da 0013/0030: nem o portal reescreve a trilha.
GRANT INSERT ON auditoria_do_painel TO fir_portal;
REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON auditoria_do_painel FROM fir_portal;
