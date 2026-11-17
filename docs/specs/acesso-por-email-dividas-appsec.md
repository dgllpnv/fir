# Revisão AppSec: dívidas da Entrega 3 (acesso por e-mail), migration 0111

**Revisor:** especialista-seguranca-appsec · **Data:** 2026-11-17 · **Branch:** `backlog-final-indicadores-e-acesso` (não commitado)
**Escopo:** `0111_retencao_do_acesso_e_email_pelo_painel.sql`, `acesso/retencao.ts`, `worker-uso-diario.ts`, `AcessoPorEmailService.trocarEmailNaTransacao`, `PATCH /v1/superadmin/clinicas/:id/pessoas/:id`, `PessoaNoPainel`/`PessoaEditadaNoPainel`, tela `gestao/clinicas/[id]/pessoas`.
**Base:** gate `acesso-por-email-gate-appsec.md`, revisão `acesso-por-email-revisao-appsec.md` (B1, o UUID em maiúsculas), D9, `retencao.md`.

**Executado contra Postgres real:**
- `retencao.e2e`, `painel-email.e2e` e `link-usado.e2e`: 15 de 15 passam.
- Novos `apps/api/src/acesso/appsec-0111.e2e.test.ts` (7) e `apps/api/src/painel/appsec-0111-painel.e2e.test.ts` (6): 13 de 13 passam. Os dois testes marcados `ACHADO` afirmam o comportamento de hoje. Quem corrigir A1 ou A2 inverte o teste correspondente.

## Veredito: **APROVADO**. Nenhum bloqueador.

### O que foi atacado e segurou
- **`purgar_acesso_vencido`.** O dono é `fir_migrate`. É SECURITY DEFINER, com `proconfig = {search_path=pg_catalog}`. Só `fir_app` tem EXECUTE; `fir_painel`, `fir_carteira`, `fir_portal` e PUBLIC não têm. Passar `p_agora` no futuro, `infinity` ou NULL apaga 0, porque o `LEAST` com `now()` segura. Um lote igual a 0, −1, 10001 ou NULL é recusado. Sem clínica fixada, a função recusa. A clínica B não é tocada quando a fixada é a A, e a `auditoria` não perde linha. O chamador pode fixar outra clínica, mas só apaga o que venceu nela, que é o mesmo que o job apagaria.
- **Trigger do link encerrado.** `fir_app` e `fir_painel` não revivem um link invalidado nem re-carimbam um usado, e `token_hash` dá *permission denied*. DELETE seguido de re-INSERT não serve de contorno: `fir_app` não tem DELETE, e `token_hash UNIQUE` barra reusar o hash enquanto a linha existir. Todos os UPDATE legítimos têm `usado_em IS NULL AND invalidado_em IS NULL` no WHERE (`links.ts:70,99`, `acesso-por-email.service.ts:388,444`), e por isso a trigger não quebra a invalidação nem o uso concorrente. A purga é DELETE e não dispara a trigger.
- **E-mail pelo painel.**
  - O endereço novo fica só pendente: não entra e não recebe redefinição.
  - O id em maiúsculas chega à mesma pessoa, com a mesma regra (pipe global e `uuidOu404`).
  - São recusados com 400, antes do envio: CRLF, Unicode, homoglifo cirílico, `,`, `;`, `<>` e mais de 254 caracteres. O CHECK ASCII da 0103 cobre o mesmo.
  - Um pendente igual ao confirmado de uma colega não troca nada: o uso do link falha.
  - Para pessoa inativa, nenhum link sai. Pessoa excluída e pessoa de outra clínica dão 404.
  - A resposta não leva token nem hash, e as chaves são exatamente as do contrato.
- **GRANTs de `fir_painel`.** Ganhou INSERT nas duas tabelas e mais nada: sem DELETE, sem TRUNCATE, sem UPDATE em `eventos`, sem UPDATE em `usado_em` ou `token_hash`. A RLS (WITH CHECK) recusa INSERT para outra clínica.
- **Trilha.** As linhas `removeu` da purga trazem `token_hash` e `email_hmac` como `[oculto]`, coberto em `retencao.e2e`.

## Corrigir (não bloqueia)

**M1. A retenção vem encadeada atrás de outros jobs, sem isolamento** (`worker-uso-diario.ts:62-63`). Se `executarUsoDiarioCliente` ou `executarIndicadoresDoDia` lançar exceção, `executarRetencaoDoAcesso` não roda, e não há erro próprio. É a falha silenciosa que a D9 descreve. *Correção:* um `try/catch` por job dentro de `rodar`, ou um job separado.

**M2. O operador troca o e-mail da administradora, e o endereço antigo só é avisado depois da confirmação** (`acesso-por-email.service.ts:682-704`; medido em `appsec-0111-painel.e2e`). Isso não dá ao operador nenhum poder novo, porque `redefinirSenha` do painel já devolve a senha provisória a ele. Mas há duas diferenças:
- Uma sessão de operador roubada passa a ter um canal de recuperação persistente que não aparece, ao contrário da provisória, que derruba a senha da vítima.
- A regra contraria a recusa do `comoPessoa` ("o e-mail da administradora em cujo nome o suporte age só muda por ela", `pessoas/acesso.service.ts:176-181`).

*Correção:* quando o ator é o operador e a pessoa já tem e-mail confirmado, avisar o endereço antigo no momento do pedido (`email_trocado`, ou um aviso de "troca pedida"). A regra do `comoPessoa` × painel precisa virar uma decisão escrita.

## Residual (baixo)

**A1. Um carimbo de encerramento no futuro adia a purga para sempre** (`0111:63`, `0111:104-121`). `fir_app` faz `SET invalidado_em = '2999-01-01'` num link vivo e vencido há 39 dias, e a purga devolve 0 (teste `ACHADO A1`). O mesmo vale para `usado_em` e para `eventos_de_acesso.em`. Só um `fir_app` comprometido chega a isso. *Correção:* a trigger recusa `NEW.usado_em` ou `NEW.invalidado_em` maior que `now()` mais uma folga, ou a purga limita cada termo com `LEAST(x, now())`.

**A2. `INSERT` em `eventos_de_acesso` permite forjar Atividades** (`0111:90`). `fir_painel` grava `senha_redefinida_pelo_link` com `por_pessoa_id` igual a qualquer pessoa (teste `ACHADO A2`), e `fir_app` já podia o mesmo. O painel só precisa de `email_cadastrado` e `convite_reenviado` com `por_pessoa_id NULL`. *Correção:* uma policy RESTRICTIVE `FOR INSERT TO fir_painel`.

**A3. `search_path = pg_catalog` sem `pg_temp` explícito** (`0111:42`). Hoje não dá para explorar, porque toda relação é qualificada com `public.`. Mesmo assim, a recomendação da documentação do Postgres é `pg_catalog, pg_temp`, para que uma referência sem esquema acrescentada depois não resolva numa tabela temporária do chamador.

**A4. Envio de e-mail sem limite.** O PATCH do painel e o da clínica mandam um link a cada endereço novo, e nenhum dos dois tem limite de envio, então podem ser usados como relé de spam por quem tem a sessão. O PATCH da clínica já era assim antes desta mudança.

**Para a LGPD (fora do appsec):** cada link apagado deixa uma linha `removeu`, e o INSERT original continua na `auditoria` por 5 anos, com `pessoa_id`, `finalidade` e instantes. A retenção de 30 dias da L5 vale para a tabela, não para os metadados. Isso cabe na D9.
