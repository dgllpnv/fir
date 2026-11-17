# Revisão — Acesso por e-mail (Entrega 3), diff não commitado

**Revisor:** revisor-codigo · **Data:** 2026-11-17 · **Base:** spec `acesso-por-email.md` (§10 prevalece), gates `acesso-por-email-gate-appsec.md` (1–20) e `acesso-por-email-gate-lgpd.md` (L1–L11), CLAUDE.md, CONTEXT.md, ADR 2026-11-16.
**Fora do escopo:** os arquivos de indicadores (0098–0100, `metas/`, `indicadores*`).
**Não executado por esta revisão:** `pnpm typecheck && pnpm test && pnpm build`. O que está abaixo vem da leitura do diff e dos testes, não de uma rodada da suíte.

## Veredito: REPROVADO. São quatro bloqueadores, todos de correção barata.

O núcleo está bem feito: e-mail confirmado separado do pendente, `email_hmac` em vez do endereço, índice de um link vivo por pessoa e finalidade, uso atômico na mesma transação da senha e das sessões, 204 sem cookie, piso de tempo em `finally`, token só no fragmento, link montado só com `URL_PUBLICA`, log mascarado e sem o erro cru do SMTP, `eventos_de_acesso` sem trigger, e os grants por coluna (com o REVOKE prévio, que foi medido). A reprovação vem de uma rota que contorna a condição 1 do gate de appsec, do glossário que ainda proíbe o vocabulário novo, de testes que os gates exigem e não existem, e da condição L10, que é só documental e não foi escrita.

---

## Eixo 1 — Padrões

### Bloqueia o merge

**P1. `PATCH /v1/pessoas/:id` troca o PRÓPRIO e-mail sem a senha atual (contorna o appsec 1).**
`apps/api/src/pessoas/acesso.service.ts:220` chama `trocarEmail` para qualquer alvo que passe em `podeAgirSobre`. Essa função devolve `ok` para a admin agindo sobre si mesma (`packages/domain/src/pessoa.ts:369`). A tela oferece o campo de e-mail também na própria ficha (`apps/web/src/components/tela-usuarios.tsx:714-721`, só as ações de envio somem com `euMesma`). Quem acha aberta a sessão de uma admin ou de uma gerente com `config` faz o seguinte: põe o e-mail dele no PATCH, recebe a confirmação (`trocarEmail` emite `confirmacao_de_email`), confirma e depois usa o esqueci-senha. É a tomada de conta persistente que a condição 1 existe para fechar, e `/v1/eu/email` exige a senha justamente por isso.
*Correção:* em `trocarEmail`, recusar com 403 quando `pessoaId === pessoaDoAtor(ctx.ator)`, com a mensagem "Troque o seu e-mail em Trocar senha › E-mail". Esconder o campo na própria ficha. Acrescentar um e2e: PATCH `{ email }` sobre si mesma dá 403, nenhum link é criado e nenhum e-mail é capturado.

**P2. O glossário ainda proíbe os termos que o código usa.**
`CONTEXT.md:22` lista `e-mail`, `email` e `convite` como **termos proibidos** ("grep devolve zero, e é assim que fica"). `CONTEXT.md:59` diz "não há e-mail (D-10)". CLAUDE.md §4 manda que o termo entre no glossário **antes**, e o uso de um termo proibido é reprovação.
*Correção:* tirar a linha 22 da lista de proibidos, reescrever a 59 citando a ADR 2026-11-16 e acrescentar os termos *e-mail confirmado*, *e-mail pendente*, *link de acesso* (convite · redefinição · confirmação de e-mail), *evento de acesso* e *aguardando a primeira senha*.

### Corrigir agora

- **`as` sem justificativa** (CLAUDE.md §6). Em `apps/api/src/acesso/acesso-por-email.service.ts:400`, o cast para `{ code?: string }` lança `TypeError` se `e` não for objeto. Estreitar com `typeof e === 'object' && e !== null && 'code' in e`. Em `apps/api/src/acesso/correio.ts:57,59` a guarda existe, mas falta o comentário.
- **A falha de SMTP no PATCH some em silêncio.** Em `apps/api/src/pessoas/acesso.service.ts:233`, o `entregar` devolve `false` e ninguém lê o valor: a admin vê "salvo" e o link de confirmação nunca saiu. Devolver na resposta um campo como `confirmacao: 'enviada' | 'falhou'`, no molde do `convite` da criação.

---

## Eixo 2 — Spec e gates

### Bloqueia o merge

**S1. Faltam testes que os gates exigem, inclusive de condições que bloqueiam.** Cada condição do gate traz "o teste que a prova". O código das condições abaixo existe, a prova não.
- **appsec 6:** falta o teste "10 pedidos concorrentes deixam exatamente 1 linha viva". Só existe o caso sequencial (`apps/api/src/acesso/acesso-por-email.e2e.test.ts:300`). Pelo gate, essa condição bloqueia.
- **appsec 10:** o `apps/api/src/autenticacao/oraculo-de-tempo.e2e.test.ts` não ganhou os casos "e-mail confirmado", "pendente" e "inexistente".
- **appsec 11:** nenhum teste mede tempo. Os cinco caminhos do esqueci-senha conferem status e corpo (e2e `:194`, `:225`), mas falta a diferença de medianas abaixo de 10% do piso, e é ela que prova a ausência de oráculo de tempo.
- **LGPD L8 / appsec 2:** falta o e2e de `PATCH { email: null }`, em que a pessoa continua entrando pelo usuário e o link antigo responde 410. Falta também a asserção de que **o e-mail antigo continua entrando até o novo ser confirmado**: o teste `:602` usa o link antes de conferir.

**S2. L10 e appsec 15 (parte documental) não foram feitos.**
`docs/o-que-depende-de-voce.md:46-48` ainda diz "Provedor de e-mail, ENCERRADO: não há mais e-mail no produto". Não há o checklist de quatro itens da L10 (DPA, garantia de transferência, suboperador, retenção mínima). Nem a ADR 2026-11-16 nem a §7 do spec registram que o rastreamento de clique e de abertura do provedor fica desligado. Esse rastreamento reescreve o `href` e passa a ver o token. É o único controle que existe antes de alguém preencher `SMTP_HOST` em produção, e o documento atual diz o contrário.
*Correção:* reabrir o item 2 de `o-que-depende-de-voce.md` com as quatro condições da L10 mais "click/open tracking desligado", e acrescentar uma linha à ADR.

### Corrigir agora

- **appsec 12:** falta o teste "o 6º esqueci-senha da mesma origem dá 429". Os dois apps de teste sobem o teto para 10 000 ou 5 000, e o comentário em `apps/api/vitest.config.ts` promete "o describe dedicado mede o 429", mas esse describe não existe.
- **appsec 17:** falta o teste "prefixo do hash ou `'%'` devolve 0 linhas; `fir_app` sem a função lê 0 linhas sem clínica".
- **appsec 7:** faltam os gatilhos "clínica inativa recusa o link" e "a pessoa troca o próprio e-mail por `/eu/email` e os links morrem". O código cobre os dois (migration `0097:170`, service `:539`).
- **appsec 3:** a amarração pelo HMAC nunca é testada sozinha, porque a invalidação explícita mascara o efeito dela. Falta o caso de convite com a admin trocando o e-mail.
- **L5 / dívida D9:** `docs/dividas.md` (D9) não cita a purga de `links_de_acesso` (30 dias) nem a de `eventos_de_acesso` (1 ano). A linha em `retencao.md` existe, mas a L5 manda o job "entrar na dívida D9".

### Vira ticket

- **appsec 14:** falta o e2e com `Host: evil.example`. Hoje a garantia vem da construção (`linkDoToken` só recebe `urlPublica`) e do teste unitário.
- **appsec 15:** a prova é um teste estático da fonte (`apps/web/src/lib/link-de-acesso.test.ts`), não o e2e de navegador que o gate pede (`location.hash` vazio depois de carregar). Fazer em Playwright quando os fluxos do balcão ganharem e2e.

### Lacunas conhecidas, confirmadas

| Lacuna | Confirmada | Risco | Classe |
|---|---|---|---|
| Sem job de retenção para `eventos_de_acesso` (1 ano) nem purga de `links_de_acesso` (30 dias) | Sim. Nenhum job, e a D9 não as lista | **Baixo hoje.** O prazo mais curto vence 30 dias depois do primeiro link, o volume é de dezenas de linhas e só há hashes. Vira **médio** no fim do primeiro ano, mesmo gatilho da D9 | Registrar na D9 agora; o job vira ticket |
| O painel do superadmin não edita e-mail | Sim. Só `criar` aceita o campo (`painel-pessoas.service.ts:128`, `superadmin.ts`) | **Baixo.** A §9 pede o campo opcional só na criação, e a admin da clínica corrige pelo PATCH (L8). O operador não corrige um erro de digitação da primeira admin | Ticket |
| O e-mail **confirmado** vai em claro na trilha de `pessoas` | Sim. A denylist da 0097 (`:135-141`) mascara `email_pendente`, não `email`. Ao confirmar, `email = email_pendente` grava o endereço em `para`, e a máscara do pendente deixa de servir para esse endereço | **Baixo a médio.** O dado é comum, não sensível, e `retencao.md` declara que o `de → para` fica pelos 5 anos e que isso é informado à titular. Mesmo assim a L9 só vale para a tabela viva, não para a trilha | Ticket com aceite do `especialista-lgpd-saude`: denylist por entidade, para `pessoas.email` sem tocar o `email` da carteira |

---

## Condições, uma por uma

Arquivos abreviados: `service` = `apps/api/src/acesso/acesso-por-email.service.ts`, `controller` = `apps/api/src/acesso/acesso-por-email.controller.ts`, `e2e` = `apps/api/src/acesso/acesso-por-email.e2e.test.ts`, `unit` = `apps/api/src/acesso/acesso.unit.test.ts`, `0097` = `apps/api/migrations/0097_acesso_por_email.sql`.

**AppSec**
1. Senha atual em `/eu/email`, 403: **OK** (service `:504-506`, e2e `:370`). Mas **contornada pelo PATCH sobre si mesma (P1)**.
2. O pendente não ocupa `email`: **OK** no código (0097 `:16-35`, `teste/identidade-com-email.test.ts:107`). O teste do "antigo continua valendo" **FALTA** (S1).
3. Link preso ao e-mail: **OK** no código (service `:83-84`, `:257`). Teste **parcial**.
4. Só o confirmado recebe a redefinição: **OK** (service `:196-199`, `:617`; e2e `:194`, `:542`).
5. Uso atômico na mesma transação: **OK** (service `:356-429`; e2e `:277`, `:300`).
6. Um link vivo garantido pelo banco: **OK** no código (0097 `:60-62`, `apps/api/src/acesso/links.ts:68`). O teste concorrente **FALTA** (S1).
7. Gatilhos de invalidação: **OK** no código (`apps/api/src/pessoas/escrita-de-pessoa.ts:252,304,424`, `apps/api/src/autenticacao/autenticacao.service.ts:804`, `acesso.service.ts` trocarEmail, 0097 `:170`). Testes **parciais**: faltam clínica inativa e `/eu/email`.
8. Sem sessão no uso: **OK** (controller `:141-171`, e2e `:261-263`).
9. Um orçamento de falhas por conta: **OK** (`autenticacao.service.ts:317-330`, e2e `:350`).
10. `HASH_FALSO` e piso, com o `@` decidido antes da canonização: **OK** no código (`packages/contracts/src/autenticacao.ts`, `autenticacao.service.ts:317`). O teste de tempo **FALTA** (S1).
11. Piso em `finally`, envio depois da resposta: **OK** no código (controller `:73-98`, service `:144-148`). O teste de medianas **FALTA** (S1).
12. Limites declarados: **OK** (`apps/api/src/acesso/limites.ts`). Teto por e-mail testado (e2e `:235`), teto por pessoa-alvo testado (e2e `:561`). O 429 por origem **FALTA**.
13. Token cru só em memória, log limpo: **OK** (sem Redis; e2e `:780`; unit `:87-125`).
14. Só `URL_PUBLICA`: **OK** (`apps/api/src/acesso/mensagens.ts:168-175`, `apps/api/src/acesso/correio.ts:116-119`, unit `:19`). Teste com `Host` forjado: ticket.
15. `replaceState`, `no-referrer`, rastreamento desligado: **OK** no front (`apps/web/src/lib/link-de-acesso.ts:40`, `apps/web/next.config.mjs:85-88`). O registro na ADR e na §7 **FALTA** (S2).
16. `consultar` não consome: **OK** (e2e `:249-261`, duas consultas antes de usar).
17. `resolver_link_de_acesso` no molde da 0022: **OK** (0097 `:155-180`; `search_path = pg_catalog` com nomes qualificados, mais estrito que o pedido). O teste **FALTA**.
18. RLS e privilégios: **OK** (0097 `:96-125`; e2e `:671`, `:693`).
19. Escape e uma linha só: **OK** (`mensagens.ts:42-52`, assuntos constantes, unit `:66`).
20. `podeAgirSobre`, `config`, matriz: **OK** (service `:599-603`; e2e `:551`, `:556`; `teste/registro.ts` ROTAS_PUBLICAS). A spec diz `usuarios`; no código a chave é `config`, a mesma da tela "Usuários e acessos".

**LGPD**
- L1, corpo mínimo: **OK** (`mensagens.ts`, unit `:40`, e2e `:469-472`).
- L2, sem pixel e `href` só da URL pública: **OK** (unit `:40`). O checklist do provedor **FALTA** (S2).
- L3, log sem destinatário: **OK** (`correio.ts:55-88`, unit `:108`).
- L4, só o HMAC: **OK** (0097 `:45`, `:135-141`; e2e `:707`).
- L5, guarda de 30 dias: invalidação **OK**. Job e linha na D9 **FALTAM** (lacuna conhecida).
- L6, evento mínimo e sem trigger: **OK** (e2e `:740`, `teste/auditoria-inescapavel.test.ts`). Job de 1 ano **FALTA** (lacuna conhecida).
- L7, HMAC no lugar do e-mail: **OK** (e2e `:357`, `:214`).
- L8, corrigir e retirar: **OK** no código (`/eu/email` null, PATCH null). Teste do PATCH null e do e-mail antigo valendo **FALTA** (S1).
- L9, exclusão anula o e-mail: **OK** (`escrita-de-pessoa.ts:292-294`, e2e `:654`). Não há rotina de pseudonimização para cobrir, porque ela ainda não existe (pendente em `retencao.md`).
- L10, o envio só liga com o contrato: **FALTA** (S2).
- L11, avisos à titular: **OK** (service `:439-450`, `acesso.service.ts` PATCH null; e2e `:271`, `:432`, `:617`).

**Spec §8 (critérios de aceite):** convite → senha → entrar por e-mail **OK** (e2e `:446`). Esqueci, uso único e 1 hora **OK** (e2e `:243`, `:285`). E-mail sem conta com a mesma resposta e sem envio **OK** (e2e `:194`). Pessoa antiga cadastra e continua entrando **OK** (e2e `:379`). Chegar na caixa de entrada depende do dono.

**Escopo extra:** o cartão "E-mail" em `/trocar-senha` (`apps/web/src/app/trocar-senha/page.tsx`) vai além do fluxo 5 ("não muda"), mas é o caminho da L8 (retirar o próprio e-mail) e por isso é aceitável. Nenhum outro escopo extra foi encontrado.
