# Clínica em vários grupos, e o grupo Firmare com todas — spec

> Status: **spec para o gate de risco.** Nenhum código antes do gate. Data: 2026-11-10.
> Substitui, no desenho, a regra "uma clínica, um grupo" (ADR 0011 §1; ADR 2026-11-10-grupo-firmare-padrao item 3).
> Parte já implementada e NÃO publicada: migration 0067 (commit 399caae). Este spec a amplia; sobe tudo junto.

## 1. Decisão do dono (2026-11-10)
- A clínica fica no grupo Firmare **e** em outros grupos que o superadmin (Operador) designar.
- O grupo Firmare contém **todas** as clínicas, novas e antigas. A equipe Firmare (escopo `geral`) vê tudo.
- Mensalidade do cliente novo no Firmare **nasce 0**; o dono lança à mão depois. Nunca copiada nem inferida.
- Remover a clínica de um grupo **encerra o Cliente Firmare daquele grupo** (soft delete), mantendo o histórico.

## 2. Desenho (recomendação do arquiteto, desenho B)
- **Um Cliente Firmare por (grupo, clínica).** `clientes_carteira.clinica_id` deixa de ser UNIQUE sozinho e passa a UNIQUE parcial `(grupo_id, clinica_id)` onde `clinica_id IS NOT NULL` e não excluído. A RLS por `grupo_id`, as filhas, a FK composta `(cliente_carteira_id, grupo_id)` e os jobs de uso e de campanha **não mudam**: já fazem fan-out por cliente.
- **Nova tabela `participacao_clinica_grupo(clinica_id, grupo_id, desde, ate)`**, `ate` nulo = ativa. É a fonte de "a clínica está no grupo". Substitui "última linha do histórico" como regra de pertencimento no gatilho `clientes_carteira_confere_vinculos` (0047:195-203). `historico_grupo_da_clinica` continua como trilha append-only e ganha os eventos adicionar e remover.
- **Invariantes no banco:** o Firmare é participação permanente (não se remove, não se encerra); o cliente de um grupo novo nasce vazio, sem copiar nada comercial de outro grupo (mensalidade 0).
- **API/tela:** "mudar de grupo" vira **adicionar grupo** e **remover grupo** (com motivo). Só o Operador faz.
- **Clínica nova** (gatilho 0067): participação no Firmare + cliente no Firmare. Conflito agora é em `(grupo_id, clinica_id)`.
- **Backfill (forward-only, expand, idempotente):** para toda clínica ativa: garante participação no Firmare e Cliente Firmare no grupo Firmare (nome da clínica, produto 'FIR Clinic', mensalidade 0, status copiado do cliente existente); registra a participação do grupo atual. **Não toca** a linha do grupo atual nem as filhas: nenhuma visão some. Histórico com motivo "grupo Firmare contém todas", `mudado_por` = um operador explícito (falha alto se não existir). Guarda pós-migration: toda clínica ativa tem participação no Firmare; contagens de clientes e filhas por grupo idênticas antes e depois.

## 3. Critérios de aceite
1. Criar clínica → participação e Cliente Firmare no Firmare (já feito na 0067, mantido).
2. Adicionar a clínica a outro grupo cria participação e um Cliente Firmare vazio nesse grupo (mensalidade 0); o do Firmare não muda.
3. Remover a participação de um grupo (≠ Firmare) encerra o cliente dele (soft delete) e mantém histórico; o grupo para de ver a clínica; os jobs param de gravar nele.
4. Remover ou encerrar a participação do Firmare é recusado no banco.
5. Backfill: rodar duas vezes não duplica; nenhuma linha antiga muda de `grupo_id`; toda clínica ativa fica no Firmare.
6. Usuário de escopo `grupo` num grupo X nunca lê cliente da mesma clínica no Firmare nem no grupo Y (nem filhas). O grupo A não sabe que a clínica está no B.
7. A visão `geral` não soma mensalidade nem conta a clínica duas vezes entre grupos (agrupa por clínica onde o total é "de clínicas").
8. Usuário de gestão de escopo `grupo` no Firmare continua barrado (0067).
9. Auditoria da clínica registra designação e remoção, com ator `operador`.

## 4. Para o gate
- **Appsec:** isolamento entre redes concorrentes (a 0011 §1 recusou isto: precisa de ADR nova); só Operador designa; RLS da participação; o backfill não pode dar acesso novo a ninguém.
- **LGPD:** cada grupo designado vira destinatário do uso agregado e da receita por campanha da clínica (cláusula P-3 da 0011, DPA); a clínica deve ver a designação na própria auditoria; destino do que já foi materializado ao remover (soft delete + `retencao.md`).
- **Números (`validador-numeros`):** mensalidade nunca copiada; `geral` não soma entre grupos; MRR do Firmare subestimado até o dono lançar.

## 5. Testes (Postgres real)
Os 8 do arquiteto: isolamento de SELECT/UPDATE por id entre X, Y e Firmare (cliente e filhas); jobs de uso e campanha idempotentes (3×) por grupo; remover para leitura e job e preserva histórico; Firmare irremovível; escopo `grupo` barrado no Firmare; `geral` sem duplicar; backfill idempotente sem mudar `grupo_id`; auditoria e redação por `valores`.

## 6. Tickets (depois do gate)
1. Migration: participação, UNIQUE novo, gatilhos (0047 e 0067), backfill, guardas.
2. Service/API: adicionar e remover grupo (substituem `mudarDeGrupo`).
3. Tela Grupos: adicionar/remover, com motivo.
4. Ajustes de leitura da visão `geral` (sem soma entre grupos).
5. Testes de isolamento e backfill.
6. ADR (substitui 0011 §1 e 0067 itens 3 e 5), CONTEXT.md, retenção, ROPA.
7. Deploy com backup; conferência de contagens antes e depois em produção.

## 7. Resultado do gate (2026-11-10) — vale sobre o texto acima
Appsec: com ressalvas. LGPD: com ressalvas. Números: com ressalvas. Nenhum veto. Decisões do dono: regra "quem paga" aprovada; front com o mínimo de alteração.

- **Quem paga.** `clientes_carteira.conta_na_receita boolean`; exatamente um por clínica (índice único parcial). Só ele entra em MRR, cobrança, metas e resumo. Backfill: o cliente que já existe é o pagador; o novo do Firmare nasce `false`. Clínica só no Firmare: o do Firmare é o pagador. Trocar o pagador é ação do Operador, com histórico. Toda contagem do `geral` agrupa por clínica (DISTINCT), nunca soma entre grupos (14 pontos do parecer de números, entre eles visao-geral, resumo-semanal, cobrancas, gerar-cobrancas, uso-carteira, campanhas-carteira).
- **RLS de `participacao_clinica_grupo`**: ENABLE+FORCE; `fir_app` sem privilégio; gestão lê só `grupo_id = app_grupo_id()` e `ate IS NULL`; escrita só por função SECURITY DEFINER para `fir_carteira`; sem DELETE/TRUNCATE; `ate` só NULL→valor; Firmare irremovível; índice único `(clinica_id, grupo_id) WHERE ate IS NULL`.
- **Gatilho 0047**: com `clinica_id`, exigir participação ativa `(clinica, grupo)`; proibir UPDATE de `grupo_id`/`clinica_id`; falhar fechado sem participação.
- **Gatilho 0067**: `ON CONFLICT (grupo_id, clinica_id) WHERE clinica_id IS NOT NULL AND excluido_em IS NULL` (predicado igual ao do índice).
- **Função adicionar/remover**: ator só de `app.pessoa_id` (regex antes do cast, conferido em `operadores`); sem ator, 42501; motivo obrigatório.
- **Remoção**: o grupo perde cliente e filhas na hora (policy filtra `excluido_em`); jobs resolvem o grupo pela participação ativa; dado retido só para a Firmare, 2 anos a contar da remoção.
- **Backfill**: inclui clínicas inativas; não copia contato, parceiros, observações, responsável nem campanhas; idempotente por índice; operador explícito (falha alto); guarda por hash de `(id, grupo_id)`; **só sobe com o DPA das clínicas confirmado pelo dono**.
- **Transparência**: a clínica vê a lista de grupos que a recebem (nome e motivo) e a auditoria registra adição/remoção/backfill.
- **Antes do deploy**: ADR nova primeiro; `claude-security:scan`; ensaio num dump de produção; retenção e ROPA.

## 8. Depois do gate: o que mudou na construção (2026-11-10)
O texto acima fica como histórico. Valem estas correções.

- **0069, campanhas sincronizadas.** O índice único das campanhas sincronizadas passa a incluir o cliente: cada grupo da clínica recebe a sua cópia. O `geral` deduplica por campanha e mês (uma por clínica), nunca soma as cópias.
- **Painel de metas do `geral`** deduplica por clínica (índice `um-por-clinica`): a clínica em três grupos conta uma vez.
- **Remover o grupo que é o pagador é recusado (409)** até existir a ação "trocar pagador". Ticket pendente (T8): ação do Operador, com motivo e histórico, que move `conta_na_receita` para o cliente de outro grupo da mesma clínica, numa transação, mantendo exatamente um pagador. Recomendação: fazer antes de designar o primeiro grupo externo em produção; até lá a recusa é o comportamento correto, não um defeito.
- **Remoção desativa os usuários do portal do cliente encerrado.** O portal de escopo cliente decide por cliente, não por grupo: encerrado o cliente, o acesso cai junto (estado `ativo = false`, nunca exclusão).
- **Migration 0070, em fechamento** (arquivo `apps/api/migrations/0070_endurecimento_clinica_em_varios_grupos.sql`, teste `teste/endurecimento-0070.test.ts`; ainda não commitada). Fecha achados do appsec: só o Operador altera `conta_na_receita`; usuário do portal não pode ser do grupo de arquivo (nem do padrão); `search_path` com `pg_temp` por último nas funções SECURITY DEFINER novas; operador inativo não designa; cliente arquivado não é reativado; cliente de clínica inativa nasce `pausado`, fora do job de uso.

### Pendências de transparência, antes do backfill em produção (bloqueantes)
1. Rota e tela para a clínica ver os grupos que a recebem (hoje só a função SQL; falta mostrar o motivo).
2. Aviso à clínica na primeira designação a um grupo.
3. Trilha de acesso (regra 18) dos novos destinatários: quando cada grupo leu o agregado da clínica.
4. Nota no ROPA: grupos designados como destinatários.
5. Guarda do backfill por hash de `(id, grupo_id)` e contagem antes/depois (hoje só conta).
