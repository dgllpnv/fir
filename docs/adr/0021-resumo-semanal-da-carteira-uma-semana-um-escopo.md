# ADR 0021 — Resumo semanal da carteira: uma semana, um escopo, texto montado no servidor

**Status:** aceita · 2026-11-08
**Origem:** G8, ticket 3C (item S1 do inventário `docs/specs/g8-paridade-gestao-inventario.md`). Os ajustes
35 a 37 de `docs/specs/g8-gate-numeros.md` pedem estas divergências do protótipo e dizem que elas viram ADR.
D-22 ("fidelidade ao protótipo") vale para todo o resto.

## O que o protótipo faz (`textoResumo`, `vResumo`, L2004-2025)

Uma **tela** com um texto pronto e o botão "Copiar texto", "para colar no WhatsApp da equipe ou enviar para a
liderança". Não envia e-mail, não agenda nada e não tem destinatário. As seções são: carteira (ativos por
saúde, e o MRR para quem tem `valores`), clientes em risco (com o resumo e o encaminhamento da última
reunião), plano de ação, campanhas ativas, equipe e a prioridade da semana.

## Decisões

1. **É uma tela, não um job.** `GET /v1/carteira/resumo/semanal` devolve o texto, e a tela `/carteira/resumo`
   tem o "Copiar texto". Sem e-mail, sem fila, sem worker e sem migration: nada é gravado. A ideia inicial
   de um envio por e-mail com idempotência por (destinatário, semana) não tem base no protótipo.
2. **Uma semana só (ajuste 36).** O cabeçalho diz "semana de segunda a domingo", e "concluídas" conta
   exatamente essa semana, `[segunda, segunda + 7)`, comparando o dia civil da conclusão no fuso da carteira
   (`FUSO_DA_CARTEIRA`). O protótipo conta `diff ≥ −7`, que são 8 dias móveis, e mostra outro intervalo no
   cabeçalho. Por isso o texto diz "nesta semana" em vez de "nos últimos 7 dias".
3. **Um escopo só (ajuste 35).** Ações, campanhas e tarefas da equipe entram só pelos clientes que a sessão vê
   (grupo e "só a minha carteira"). O protótipo restringe a carteira e o risco com `vis()`, mas lê
   `db.acoes`, `db.campanhas` e `db.tarefas` inteiros. Com "só a minha carteira", a equipe mostra só a
   própria pessoa.
4. **A redação acontece na montagem (ajuste 37, appsec A-14).** `montarResumoSemanal` (`packages/domain`)
   recebe `podeVerValores = temPermCarteira(sessao, 'valores')` e não escreve dinheiro quando ela nega: nem
   o MRR, nem o resultado ou a meta de campanha de receita (que aparece só como "N% da meta de receita").
   Com `valores`, todo valor sai de `Dinheiro.formatar()`, com centavos.
5. **Campanha passa por `suprimirCampanhas` (LGPD A20).** A suprimida não aparece pelo nome. Aparece só
   uma linha com a contagem ("Mais N campanhas ativas sem detalhe"). Quando a mesma campanha tem várias
   células ativas (uma por mês), entra a mais recente.
6. **Cliente sem saúde registrada é contado à parte** ("N sem saúde registrada") e não entra em risco. No
   protótipo todo cliente tem `saude`; aqui ela é derivada (`saudeDerivadaDoCliente`) e pode não existir.
7. **A ata só é lida para os clientes em risco**, os únicos que o texto cita, e cada leitura registra
   `acessou reunioes_comerciais` em `auditoria_do_painel` (regra 18: o resumo da reunião pode citar paciente).
8. **Concordância de número** ("Foi concluída 1 ação", "Permanece 1 ação atrasada"). O protótipo escreve
   "1 ações". A lista "concentradas em" sai em ordem alfabética para que duas leituras iguais deem o mesmo texto.
9. **"Equipe" é quem está ativo fora do setor `diretoria`.** Corresponde ao `papel !== "admin"` do protótipo.

## Consequências

- O acesso é a chave `resumo`, que é "só escopo geral" (A-5). Um `Usuário de Gestão` de `escopo = 'grupo'`
  recebe 403 mesmo com o módulo gravado.
- Qualquer seção nova (metas, mensalidades, uso da FIR Clinic) é decisão de produto. O protótipo não as tem.
