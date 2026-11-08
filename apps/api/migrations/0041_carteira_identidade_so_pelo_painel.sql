-- ---------------------------------------------------------------------------
-- A IDENTIDADE DA CARTEIRA SÓ É ESCRITA PELO PAINEL. Gate de appsec G8,
-- achado F-1, ajuste A-1 (`docs/specs/g8-gate-appsec.md`). ADRs 0011, 0012.
--
-- O DEFEITO: `usuarios_gestao` e `grupos` não têm RLS (não têm `clinica_id`
-- nem `grupo_id` de negócio — são o ator e o tenancy, não dado de grupo), e
-- a 0025 deu `INSERT, UPDATE` nelas a `fir_carteira` — o MESMO papel que
-- serve a sessão do `Usuário de Gestão`. O privilégio era gravável pelo
-- papel da sessão que ele protege: uma injeção em qualquer rota da carteira
-- chegava a `UPDATE usuarios_gestao SET escopo = 'geral'` para o próprio
-- atacante, e daí ao dinheiro de todos os grupos. O único obstáculo era
-- código de aplicação.
--
-- A CORREÇÃO, nas duas pontas:
--
-- 1. `fir_carteira` perde toda escrita nessas duas tabelas. Fica com
--    `SELECT` (login, `CarteiraGuard`, listas) e com `UPDATE` POR COLUNA só
--    nas três colunas que a própria sessão escreve na troca de senha
--    (`POST /v1/carteira/eu/senha`). `escopo`, `grupo_id`, `ativo`, `nome`,
--    `usuario` — e toda coluna de privilégio que vier depois (`valores`,
--    `carteira`, `modulos`, ...) — ficam fora do alcance desse papel por
--    construção: coluna nova não herda GRANT por coluna.
--
-- 2. `fir_painel` ganha a escrita que o `Operador` precisa (criar/editar
--    grupo, criar/editar `Usuário de Gestão`). É o papel autenticado à parte
--    (D-5: duas conexões por autenticação, nunca `SET ROLE`), sem BYPASSRLS
--    (boot check da 0013). `PainelCarteiraService` passa a escrever por
--    `BancoService.nasTabelasDeIdentidadeDaCarteiraComoPainel`.
--
-- O QUE NÃO MUDA: `clientes_carteira` continua escrita por `fir_carteira`,
-- inclusive quando quem cria o `Cliente Firmare` é o Operador
-- (`nasTabelasDaCarteiraComoOperador`, `app.escopo='geral'`). Ela tem RLS
-- por grupo com policy `TO fir_carteira` (0035); dar a escrita a
-- `fir_painel` exigiria uma policy própria para ele — e o `Cliente Firmare`
-- não é privilégio de ninguém: não há coluna ali que eleve o acesso de uma
-- sessão. A FK `clientes_carteira.grupo_id → grupos` é conferida com o
-- privilégio do dono da tabela referenciada, não de quem insere.
--
-- Ordem: REVOKE no nível da tabela PRIMEIRO. Revogar `UPDATE` da tabela
-- revoga também os privilégios por coluna; concedidas antes, as colunas de
-- senha sumiriam junto.
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON usuarios_gestao, grupos FROM fir_carteira;

GRANT UPDATE (senha_hash, senha_provisoria, senha_provisoria_expira_em)
  ON usuarios_gestao TO fir_carteira;

-- Cada GRANT a `fir_painel` é uma linha, nunca `ALTER DEFAULT PRIVILEGES`
-- (mesma razão da 0013). Sem DELETE: desativar é estado (regra 20).
GRANT SELECT, INSERT, UPDATE ON grupos, usuarios_gestao TO fir_painel;
REVOKE DELETE, TRUNCATE ON grupos, usuarios_gestao FROM fir_painel;

-- GUARDA: a migration falha alto se o estado final não for o pretendido —
-- mesmo espírito do boot check da 0013/0025. Um GRANT executado por quem
-- não é dono "funciona" com WARNING e não concede nada (ver
-- `infra/producao/10-papeis.sh`); aqui o resultado é conferido, não presumido.
DO $$
BEGIN
  IF has_table_privilege('fir_carteira', 'usuarios_gestao', 'INSERT')
     OR has_table_privilege('fir_carteira', 'usuarios_gestao', 'UPDATE')
     OR has_table_privilege('fir_carteira', 'grupos', 'INSERT')
     OR has_table_privilege('fir_carteira', 'grupos', 'UPDATE')
     OR has_column_privilege('fir_carteira', 'usuarios_gestao', 'escopo', 'UPDATE')
     OR has_column_privilege('fir_carteira', 'usuarios_gestao', 'grupo_id', 'UPDATE')
     OR has_column_privilege('fir_carteira', 'usuarios_gestao', 'ativo', 'UPDATE')
  THEN
    RAISE EXCEPTION 'fir_carteira ainda escreve identidade da carteira'
      USING HINT = 'G8 F-1/A-1: só fir_painel escreve usuarios_gestao e grupos.';
  END IF;
  IF NOT has_column_privilege('fir_carteira', 'usuarios_gestao', 'senha_hash', 'UPDATE') THEN
    RAISE EXCEPTION 'fir_carteira perdeu a troca da própria senha';
  END IF;
  IF NOT (has_table_privilege('fir_painel', 'usuarios_gestao', 'INSERT')
          AND has_table_privilege('fir_painel', 'usuarios_gestao', 'UPDATE')
          AND has_table_privilege('fir_painel', 'grupos', 'INSERT')
          AND has_table_privilege('fir_painel', 'grupos', 'UPDATE')) THEN
    RAISE EXCEPTION 'fir_painel não recebeu a escrita de identidade da carteira';
  END IF;
END $$;
