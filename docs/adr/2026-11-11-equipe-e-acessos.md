# ADR: A diretoria administra a equipe da carteira por funções de banco que resolvem o ator sozinhas

**Estado:** proposta, 2026-11-11 (revisão 2, após veto A1 do appsec). Refina a 0041/F-1; não contraria. Não mexe na ADR 0024.

## Contexto

`/carteira/equipe` deixa a Diretoria criar, editar, redefinir senha e desativar contas de escopo `geral`. A 0041 (F-1) tirou de `fir_carteira` toda escrita em `usuarios_gestao`, porque a conexão da carteira é tratada como **comprometível** (injeção de SQL numa rota da carteira). A escrita precisa passar por um buraco estreito, e o buraco só vale se **o ator não puder ser forjado** por quem já executa SQL nessa conexão.

## Decisão

Funções `SECURITY DEFINER` `equipe_criar`, `equipe_editar`, `equipe_redefinir_senha`, `equipe_alterar_estado`, **sob o próprio papel `fir_carteira`** (uma conexão só, D-5 preservado), que recebem como primeiro argumento o **token bruto da sessão** e resolvem o ator dentro do banco: hash do token, linha viva em `sessoes_de_carteira` (não revogada, não expirada), `usuario_gestao_id`, depois conferem `ativo`, `escopo = 'geral'` e `administrar`. **O ator nunca vem de GUC**: `app.pessoa_id` (`'usuario_gestao:<id>'`, `banco.service.ts`) é escrito na conexão comprometível e serve só de rótulo para a trigger de auditoria genérica, nunca de autorização. A trilha da equipe grava o ator resolvido pela função.

Cada função: `SET search_path = pg_catalog, public`, sem SQL dinâmico, `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE` só a `fir_carteira`; a migration termina com guarda (`has_function_privilege` negativo para `fir_app` e `fir_painel`; `fir_carteira` sem `INSERT/UPDATE` em `usuarios_gestao`). Toda função que muda `administrar`, `ativo` ou escopo toma `pg_advisory_xact_lock` fixo antes de contar e conta **depois** do lock, excluindo contas de operador. Argon2id e a senha provisória são gerados **na API**; a função recebe só o hash.

## Consequências

- Forjar o ator exige o **token bruto de uma Diretoria viva**, não apenas SQL. Injeção que consegue ler o token em uso (variável do próprio request, log) ainda vence: **risco residual aceito e registrado**; mitigado por token fora de log, sessão curta, revogação imediata e trilha com IP.
- Regra de escalada mora no banco (barreira final) e em `packages/domain` (mensagem e tela). Duas implementações da mesma regra: o teste de paridade entre as duas é obrigatório.
- Custo: o token trafega como parâmetro de query; o log de consulta do Postgres não pode registrar parâmetros (conferir `log_parameter_max_length`).
- Zero seam novo.

## Alternativas rejeitadas

- **Ator por GUC** (proposta original): forjável por quem injeta SQL. Veto A1.
- **Papel `fir_equipe` com conexão separada**: isola melhor (a injeção na carteira nem alcança as funções), mas cria segundo pool, segredo e rotina de rotação, e fura o "uma conexão por requisição" da D-5, por 1 tela de baixo volume. Reavaliar se o token em uso se mostrar vazável.
- **Devolver `INSERT/UPDATE` a `fir_carteira`**: reabre o F-1.
- **API abre conexão `fir_painel`**: D-5 proíbe; o Operador é outro ator.
