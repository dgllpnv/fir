# Administração da clínica — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — `superpowers:subagent-driven-development`. Passos com `- [ ]`.

**Objetivo:** a clínica passa a cadastrar a própria equipe. Hoje **uma pessoa só existe por SQL ou pela semente** — isso trava a primeira clínica, trava o ensaio da migração e trava o onboarding.

**Arquitetura:** convite por e-mail com token de uso único (mesmo padrão da sessão: 32 bytes aleatórios, só o SHA-256 guardado, nunca em log). A pessoa nasce `ativo = false` e **sem senha**; aceitar o convite define a senha e ativa. Telas `Usuários e acessos` e `Unidades`.

**Stack:** PostgreSQL + migration `0005`, NestJS + Fastify, Next.js, Vitest contra Postgres real, **Mailpit** (já de pé em `127.0.0.1:4826`).

**Depende da auditoria estar pronta** — toda escrita aqui é de RH e de permissão, que é exatamente o que a regra 20 manda registrar.

> **A P-9 (SMTP) não bloqueia este plano.** Ela bloqueia a *produção*. O Mailpit local entrega o fluxo inteiro, de ponta a ponta, hoje.

---

## Global Constraints

- **Regra 16:** `temPerm` é uma função só, e **o servidor sempre valida**. A tela é conveniência.
- **Regra 17:** sem a permissão `valores`, o servidor **apaga** salário da resposta. A ficha da pessoa não é exceção.
- **Regra 19:** RLS em toda tabela nova, `clinica_id NOT NULL`.
- **Regra 20:** toda escrita de RH entra na trilha. Com o trigger da auditoria isso é automático — **não escreva nada à mão**.
- **Regra 21:** token de convite, senha e e-mail **nunca** em log.
- **D-3:** e-mail e senha por pessoa; Argon2id; cookie `__Host-`.
- `UNIQUE (clinica_id, email)` já existe. Convidar e-mail repetido **não** cria segunda pessoa.
- TypeScript estrito; imports sem extensão (ADR 0001); `@Inject(Tipo)` explícito.
- Antes de "pronto": `npx turbo run typecheck test --force`. `pnpm test` responde do cache.

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `apps/api/migrations/0005_convites_e_unidades.sql` | `convites`, `unidades`, RLS, triggers de auditoria |
| `packages/domain/src/pessoa.ts` | Invariantes puros: último admin, auto-desativação |
| `packages/contracts/src/pessoas.ts` · `unidades.ts` | Zod |
| `apps/api/src/pessoas/` | rotas, serviço, convite |
| `apps/api/src/correio/correio.service.ts` | Envio de e-mail (SMTP) |
| `apps/web/src/app/(app)/usuarios/page.tsx` · `unidades/page.tsx` | Telas |
| `apps/web/src/app/convite/[token]/page.tsx` | Aceitar convite (**público**) |

---

## Task 1: Os invariantes, no domínio puro

**Files:** `packages/domain/src/pessoa.ts` · `pessoa.test.ts`

Antes de qualquer rota. São regras, não detalhe de API — e é onde um erro custa caro: **uma clínica sem admin não tem como voltar a ter um.** Não há superadmin para socorrer até o épico 12.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('desativar a última administradora é recusado', () => {
  const r = podeDesativar({ id: 'a', admin: true }, [{ id: 'a', admin: true, ativo: true }])
  expect(ehErro(r)).toBe(true)
  expect(r.erro.codigo).toBe('ULTIMA_ADMIN')
})

it('desativar uma admin entre duas é permitido', () => {
  const pessoas = [{ id: 'a', admin: true, ativo: true }, { id: 'b', admin: true, ativo: true }]
  expect(ehOk(podeDesativar({ id: 'a', admin: true }, pessoas))).toBe(true)
})

it('admin inativa não conta para o mínimo', () => {
  const pessoas = [{ id: 'a', admin: true, ativo: true }, { id: 'b', admin: true, ativo: false }]
  expect(ehErro(podeDesativar({ id: 'a', admin: true }, pessoas))).toBe(true)
})

it('ninguém se desativa — perder o próprio acesso por engano é fácil demais', () => {
  const r = podeDesativar({ id: 'a', admin: true }, POVOADO, { autor: 'a' })
  expect(r.erro.codigo).toBe('NAO_SE_DESATIVA')
})

it('tirar o admin da última administradora é o mesmo buraco por outra porta', () => {
  const r = podeTrocarPerfil({ id: 'a', admin: true }, { admin: false }, [{ id: 'a', admin: true, ativo: true }])
  expect(r.erro.codigo).toBe('ULTIMA_ADMIN')
})
```

- [ ] **Passo 2: Rodar e ver os cinco falharem**
- [ ] **Passo 3: Implementar** — `Result<void, ErroDeDominio>`, zero I/O, como o resto de `packages/domain`.
- [ ] **Passo 4: Rodar — PASS**
- [ ] **Passo 5: Commit**

---

## Task 2: Migration 0005 — convites e unidades

**Files:** `apps/api/migrations/0005_convites_e_unidades.sql` · `teste/convite-rls.test.ts`

```sql
CREATE TABLE unidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  nome text NOT NULL,
  ativa boolean NOT NULL DEFAULT true,
  criada_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinica_id, nome)
);

CREATE TABLE convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinica_id uuid NOT NULL REFERENCES clinicas(id),
  pessoa_id uuid NOT NULL REFERENCES pessoas(id),
  -- Só o hash, como a sessão. O token em claro existe uma vez, no e-mail.
  token_hash text NOT NULL UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  criado_por uuid NOT NULL REFERENCES pessoas(id)
);
```

RLS `ENABLE` + `FORCE` + `USING`/`WITH CHECK` nas duas, trigger de auditoria nas duas, e `GRANT` para `fir_app`.

> **`convites` guarda `token_hash` — logo entra na denylist do trigger de auditoria**, junto de `senha_hash` e `token_hash` de `sessoes`. Sem isso a trilha vira um índice de convites válidos, legível por quem puder ler auditoria. **Verifique que a denylist pega: a coluna se chama `token_hash`, igual à de `sessoes`, então deve pegar — mas teste.**

- [ ] **Passo 1: Teste que falha** — isolamento por clínica e append-only, no padrão de `teste/isolamento-de-clinica.test.ts`
- [ ] **Passo 2: Ver falhar** · **Passo 3: Migration** · **Passo 4: PASS**
- [ ] **Passo 5: Mutação** — remova o `FORCE` de `convites`; a varredura de RLS tem de nomear a tabela
- [ ] **Passo 6: Commit**

---

## Task 3: Correio, contra o Mailpit

**Files:** `apps/api/src/correio/correio.service.ts` · `correio.test.ts`

Interface pequena, implementação atrás: `enviar({ para, assunto, texto, html })`. Configuração por ambiente, validada com `inteiroDoAmbiente`/equivalente — **falhar na subida**, nunca em silêncio.

- [ ] **Passo 1: Teste que falha** — envia e **lê de volta pela API do Mailpit** (`http://127.0.0.1:4825/api/v1/messages`); o e-mail chegou, com o destinatário e o assunto certos
- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** (`nodemailer`) · **Passo 4: PASS**
- [ ] **Passo 5: O teste que importa** — o corpo do e-mail contém o link com o token, e **o token não aparece em nenhum log**. Capture `console.*` no teste e asserte a ausência.
- [ ] **Passo 6: Commit**

---

## Task 4: Convidar

**Files:** `apps/api/src/pessoas/convite.service.ts` · `pessoas.controller.ts` · contratos

`POST /v1/pessoas/convite` — `@Exige('config')`. Cria a pessoa `ativo = false`, **sem `senha_hash`**, gera token de 32 bytes, guarda o SHA-256, expira em 7 dias, envia o e-mail.

- [ ] **Passo 1: Testes que falham**

```ts
it('convidar cria pessoa inativa e sem senha', async () => { /* … */ })
it('quem não tem `config` recebe 403', async () => { /* … */ })
it('convidar o mesmo e-mail duas vezes não cria segunda pessoa', async () => {
  // Reenviar convite é normal: a pessoa perdeu o e-mail. O que não pode é
  // duplicar a pessoa. O convite antigo morre junto.
})
it('o token em claro nunca é devolvido pela API', async () => {
  expect(JSON.stringify(resposta.body)).not.toMatch(/[A-Za-z0-9_-]{40,}/)
})
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** · **Passo 4: PASS** · **Passo 5: Commit**

---

## Task 5: Aceitar o convite — **rota pública**

**Files:** `apps/api/src/pessoas/convite.controller.ts` · `apps/web/src/app/convite/[token]/page.tsx`

`POST /v1/convite/aceitar` com `@Publico()`. **É rota pública que cria credencial** — trate com o mesmo cuidado de `/v1/entrar`.

- [ ] **Passo 1: Testes que falham**

```ts
it('aceitar define a senha e ativa a pessoa', async () => { /* … */ })
it('o mesmo token não funciona duas vezes', async () => { /* uso único */ })
it('token expirado é recusado', async () => { /* … */ })
it('token inválido responde igual a token expirado, e no mesmo tempo', async () => {
  // Mesmo oráculo de tempo de `/v1/entrar`: resposta e duração indistinguíveis.
  // Reusa `PISO_RESPOSTA_ENTRAR_MS`.
})
it('o limite por origem vale aqui também', async () => { /* … */ })
it('senha fraca é recusada antes de virar hash', async () => { /* … */ })
```

- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** — marcar `usado_em` e gravar a senha **na mesma transação**; uso único é `UPDATE … WHERE usado_em IS NULL` com checagem de `rowCount`, nunca "ler depois escrever"
- [ ] **Passo 4: PASS**
- [ ] **Passo 5: Mutação** — troque o uso único por ler-depois-escrever e rode dois `aceitar` concorrentes: o teste tem de pegar
- [ ] **Passo 6: Commit**

---

## Task 6: Listar, ativar, desativar, trocar perfil

**Files:** `apps/api/src/pessoas/pessoas.service.ts` · `pessoas.controller.ts`

`GET /v1/pessoas` · `PATCH /v1/pessoas/:id` — todas `@Exige('config')`, todas chamando os invariantes da Task 1.

- [ ] **Passo 1: Testes que falham** — os cinco invariantes da Task 1, agora pela rota; mais: **`GET /v1/pessoas` sem a permissão `valores` não devolve salário** (quando o campo existir) e **nunca devolve `senha_hash`**
- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** · **Passo 4: PASS**
- [ ] **Passo 5: Conferir a trilha** — desativar alguém gerou linha em `auditoria` com `de`/`para` de `ativo`, **sem** `senha_hash`. Esta é a prova de que a auditoria funciona de verdade, numa escrita real de RH.
- [ ] **Passo 6: Commit**

---

## Task 7: Trocar a própria senha

**Files:** `apps/api/src/autenticacao/senha.controller.ts`

`POST /v1/eu/senha`, autenticada, **exige a senha atual**.

- [ ] **Passo 1: Testes que falham** — troca com a senha atual certa funciona; com a errada é 403; **trocar a senha revoga as outras sessões da pessoa, menos a atual**
- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** · **Passo 4: PASS** · **Passo 5: Commit**

> Por que revogar as outras: trocar senha é o que a pessoa faz quando *desconfia*. Se as sessões antigas sobrevivem, a troca não serve para nada — e é justamente o caso em que ela mais precisa servir.

---

## Task 8: Perfis e unidades

**Files:** `apps/api/src/perfis/` · `apps/api/src/unidades/`

`GET/PUT /v1/perfis` · `GET/POST/PATCH /v1/unidades`, `@Exige('config')`.

- [ ] **Passo 1: Testes que falham** — editar perfil não aceita chave de permissão inexistente (valide contra `PERMS` do domínio, não contra uma lista nova); **não dá para remover `config` do próprio perfil** (mesmo buraco do último admin, outra porta); unidade duplicada no nome é recusada
- [ ] **Passo 2: Ver falhar** · **Passo 3: Implementar** · **Passo 4: PASS** · **Passo 5: Commit**

---

## Task 9: As telas

**Files:** `apps/web/src/app/(app)/usuarios/page.tsx` · `unidades/page.tsx` · `menu.ts`

**Leia `docs/design.md` antes.** 390 px é o caso principal. Estados de carregando, erro e vazio são parte do ticket.

- [ ] **Passo 1:** `Usuários e acessos` — lista com nome, e-mail, perfil, estado; convidar; ativar/desativar; trocar perfil. **Nunca salário** — isso é a tela `Equipe`, do épico 7, e a separação é de propósito.
- [ ] **Passo 2:** `Unidades` — lista e edição.
- [ ] **Passo 3:** Em `menu.ts`, trocar `epico` por `null` nas duas rotas. **`menu-vs-telas.test.ts` vai cobrar** — ele confronta o menu com as páginas no disco.
- [ ] **Passo 4:** Auditoria de `design.md` §5, item a item.
- [ ] **Passo 5: Commit**

---

## Task 10: Fechamento

- [ ] Atualizar `docs/paridade.md`: `salvarPessoa`, `excluirPessoa`, `pessoasOp`, `salvarPerfis`, `salvarUnidade`, `alterarPin` → ✅
- [ ] `docs/dividas.md`: a P-9 deixa de bloquear o desenvolvimento; segue bloqueando produção
- [ ] `npx turbo run typecheck test --force`, **três vezes** — determinismo não se afirma, se observa
- [ ] Commit

---

## Auto-revisão

**Cobre de `paridade.md`:** `salvarPessoa` · `excluirPessoa` (vira desativar — soft delete, regra 20) · `pessoasOp` · `salvarPerfis` · `salvarUnidade` · `alterarPin` (vira trocar senha). **6 das 59.**

**Fora de escopo, de propósito:** ficha, contrato, férias, documentos, metas, 1:1, banco de horas — tudo isso é a tela `Equipe`, do épico 7. Aqui é só acesso.

**O risco que fica:** um convite que expira sem ninguém perceber deixa a pessoa sem caminho de entrada e sem mensagem de erro útil. A tela de aceitar precisa dizer *"este convite expirou, peça outro a quem administra"* — não "token inválido".
