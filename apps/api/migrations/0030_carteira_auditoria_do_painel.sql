-- G2 (escrita): `PainelCarteiraService.criarGrupo`/`criarUsuarioDeGestao`
-- escrevem em `auditoria_do_painel` pela conexão `fir_carteira` — é lá que
-- vivem os GRANTs de `grupos`/`usuarios_gestao` (0025), e o Operador chega
-- com a sessão do PAINEL, não com uma conexão própria para esta escrita.
--
-- Sem este GRANT, a trilha dessas duas ações nunca existiu: `fir_carteira`
-- não tinha INSERT em `auditoria_do_painel`, e todo POST que passa por
-- `registrarNoPainel` morria em 500 (medido pelo e2e de
-- `painel-carteira.e2e.test.ts`).
--
-- Mesmo par de REVOKE de 0013: nem a carteira reescreve a trilha do painel.
GRANT SELECT, INSERT ON auditoria_do_painel TO fir_carteira;
REVOKE UPDATE, DELETE, TRUNCATE ON auditoria_do_painel FROM fir_carteira;
