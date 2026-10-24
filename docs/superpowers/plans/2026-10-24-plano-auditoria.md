# Trilha de auditoria — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA — use `superpowers:subagent-driven-development` para executar tarefa a tarefa. Os passos usam `- [ ]` para acompanhamento.

**Objetivo:** uma trilha append-only que registra **toda escrita e todo acesso a dado sensível**, de forma que um plano futuro **não consiga** gravar sem deixar rastro, mesmo se o programador esquecer.

**Arquitetura:** o registro de escrita é **trigger no Postgres**, não chamada no handler. O ator vem de `SET LOCAL app.pessoa_id`, ao lado do `app.clinica_id` que já existe, e o trigger **recusa a escrita** se o ator estiver ausente. O registro de acesso — que trigger não vê — é um interceptor global sobre rotas marcadas. Uma varredura transversal reprova tabela de negócio sem trigger.

**Stack:** PostgreSQL 16 (trigger `AFTER` + `SECURITY DEFINER`), NestJS + Fastify, Vitest contra Postgres real.

**Por que antes do Plano 2:** todo plano seguinte escreve dado. Em tabela append-only não existe gravar depois o que não foi gravado na hora — retrofitar em oito planos é fazer oito vezes o mesmo trabalho, e os dados dos oito ficam sem passado. Decisão **D-5**.

---

## Global Constraints

Valem para **todas** as tarefas. Copiadas do `CLAUDE.md` e de `docs/decisoes.md`.

- **Regra 20:** trilha append-only em toda escrita financeira, de estoque e de RH — quem, quando, de → para.
- **Regra 18:** dose, produto, lote e aplicação por paciente são dado sensível do art. 11 — **registro de acesso, não só de escrita**, e nunca em log.
- **Regra 21:** PII, valor e dado clínico mascarados em log. A trilha **não** é log: ela é dado, com controle de acesso próprio.
- **Regra 19:** RLS em toda tabela de negócio, `clinica_id NOT NULL`. A trilha é tabela de negócio.
- **Regra 17:** redação de valores num ponto único. A trilha guarda salário e dose em `de`/`para` — ela atravessa o mesmo interceptor.
- **Regra 22/23:** `timestamptz` em UTC; janelas `[início, fim)` com as bordas no fuso da clínica.
- **D-5, restrição 1:** o superadmin **não é uma `pessoa`**. A trilha nasce com `ator_tipo` para que o épico 12 acrescente operador **sem migration que reescreva o passado**.
- **D-5, restrição 3:** toda leitura do painel grava na mesma trilha **que a clínica enxerga**.
- **Fora de escopo, e isto é deliberado:** o painel do superadmin, as concessões e a allowlist de rede são o **épico 12**. Este plano entrega a trilha e a leitura pelo admin da clínica.
- TypeScript estrito; imports **sem** extensão (ADR 0001); `@Inject(Tipo)` explícito no Nest.
- Nenhuma migration já aplicada se edita. Esta é a `0004`.
- Antes de qualquer "pronto": `pnpm typecheck && npx turbo run test --force`. O `pnpm test` responde do cache sem rodar nada.

---

## Estrutura de arquivos

| Caminho | Responsabilidade |
|---|---|
| `apps/api/migrations/0004_auditoria.sql` | Tabela, RLS, append-only, função e trigger |
| `apps/api/src/banco/banco.service.ts` | *(modificar)* `app.pessoa_id` no contexto |
| `apps/api/src/auditoria/auditoria.controller.ts` | `GET /v1/auditoria` |
| `apps/api/src/auditoria/auditoria.service.ts` | Consulta paginada da trilha |
| `apps/api/src/auditoria/acesso.decorator.ts` | `@DadoSensivel()` |
| `apps/api/src/auditoria/acesso.interceptor.ts` | Registro de acesso (regra 18) |
| `packages/contracts/src/auditoria.ts` | Esquemas Zod da trilha |
| `teste/auditoria-inescapavel.test.ts` | Varredura: tabela de negócio sem trigger reprova |
| `docs/adr/0002-auditoria-por-trigger.md` | A decisão e o que ela custa |

---

## Task 1: Migration 0004 — a tabela e o append-only de verdade

**Files:**
- Create: `apps/api/migrations/0004_auditoria.sql`
- Test: `teste/auditoria-append-only.test.ts`

**Interfaces:**
- Produz: tabela `auditoria`; função `app_pessoa_id()`.

**Decisão que esta tarefa fixa:** append-only **no banco**, não por convenção. `REVOKE` sozinho não basta — o dono da tabela ignora `REVOKE`. Precisa das duas camadas: privilégio negado **e** trigger que levanta.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
// teste/auditoria-append-only.test.ts
it('ninguém atualiza nem apaga uma linha de auditoria — nem o dono', async () => {
  await migrate.query(`INSERT INTO auditoria
    (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
    VALUES ($1,'pessoa',$2,'criou','pessoas','x',NULL,'{"a":1}')`, [CLINICA, PESSOA])

  await expect(migrate.query(`UPDATE auditoria SET acao='alterou'`))
    .rejects.toThrow(/append-only/i)
  await expect(migrate.query(`DELETE FROM auditoria`))
    .rejects.toThrow(/append-only/i)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

`cd teste && npx vitest run auditoria-append-only` → FAIL: `relation "auditoria" does not exist`.

- [ ] **Passo 3: Escrever a migration**

```sql
-- 0004_auditoria.sql
-- O ator da transação, no mesmo espírito de app_clinica_id().
CREATE FUNCTION app_pessoa_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.pessoa_id', true), '')::uuid $$;

CREATE TABLE auditoria (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clinica_id    uuid NOT NULL REFERENCES clinicas(id),
  em            timestamptz NOT NULL DEFAULT now(),
  -- 'operador' ainda não existe: é o superadmin do épico 12. A coluna nasce
  -- agora para que aquele épico não precise de migration que reescreva o
  -- passado — e para que ninguém seja tentado a representá-lo como pessoa.
  ator_tipo     text NOT NULL CHECK (ator_tipo IN ('pessoa','operador','sistema')),
  ator_id       uuid,
  acao          text NOT NULL CHECK (acao IN ('criou','alterou','removeu','acessou')),
  entidade      text NOT NULL,
  -- text, não uuid: as chaves variam de tipo (tentativas_login é bigint).
  entidade_id   text NOT NULL,
  de            jsonb,
  para          jsonb,
  motivo        text,
  requisicao_id text,
  CHECK (ator_tipo = 'sistema' OR ator_id IS NOT NULL)
);

CREATE INDEX auditoria_por_clinica_em ON auditoria (clinica_id, em DESC);
CREATE INDEX auditoria_por_entidade ON auditoria (clinica_id, entidade, entidade_id);

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria FORCE ROW LEVEL SECURITY;
CREATE POLICY auditoria_por_clinica ON auditoria
  USING (clinica_id = app_clinica_id())
  WITH CHECK (clinica_id = app_clinica_id());

-- Camada 1: privilégio. fir_app lê e insere; nunca altera nem apaga.
GRANT SELECT, INSERT ON auditoria TO fir_app;
REVOKE UPDATE, DELETE ON auditoria FROM fir_app;
GRANT USAGE ON SEQUENCE auditoria_id_seq TO fir_app;

-- Camada 2: trigger. O REVOKE acima não alcança o DONO da tabela, e é por
-- isso que ele sozinho seria teatro: fir_migrate ignoraria o REVOKE sem
-- nenhum aviso. Esta trigger alcança todo mundo.
CREATE FUNCTION auditoria_e_append_only() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria é append-only: % recusado', TG_OP
    USING HINT = 'Corrigir um registro é inserir outro, nunca editar este.';
END $$;

CREATE TRIGGER auditoria_sem_update BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_e_append_only();
```

- [ ] **Passo 4: Aplicar e rodar**

`cd apps/api && npx tsx migrar.ts` → aplica `0004`. Depois `cd teste && npx vitest run auditoria-append-only` → PASS.

- [ ] **Passo 5: Prova por mutação**

Comente o `CREATE TRIGGER`, reaplique num banco limpo (`fir reset`), rode o teste → o `UPDATE` **passa** e o teste falha. Restaure.

- [ ] **Passo 6: Commit**

```bash
git add apps/api/migrations/0004_auditoria.sql teste/auditoria-append-only.test.ts
git commit -m "feat(db): trilha de auditoria append-only nas duas camadas"
```

---

## Task 2: O ator no contexto da transação

**Files:**
- Modify: `apps/api/src/banco/banco.service.ts`
- Test: `apps/api/src/banco/contexto-do-ator.test.ts`

**Interfaces:**
- Consome: `naClinica(clinicaId, fn)`.
- Produz: `naClinica(clinicaId, atorId, fn)` — **o ator passa a ser obrigatório**, com `atorId: PessoaId | typeof SISTEMA`.

**Por que obrigatório, e não opcional com padrão:** um parâmetro opcional é esquecido em silêncio e o padrão vira "sistema" para escrita humana — a trilha fica tecnicamente completa e factualmente mentirosa. Obrigatório, o compilador cobra em cada chamada.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
it('o ator fica visível ao banco dentro da transação, e só dentro dela', async () => {
  const dentro = await banco.naClinica(CLINICA, PESSOA, async (c) =>
    (await c.query<{ a: string | null }>('SELECT app_pessoa_id()::text AS a')).rows[0]!.a)
  expect(dentro).toBe(PESSOA)

  // SET LOCAL é de transação: a conexão devolvida ao pool não carrega o ator.
  const depois = await banco.naClinica(CLINICA, OUTRA_PESSOA, async (c) =>
    (await c.query<{ a: string | null }>('SELECT app_pessoa_id()::text AS a')).rows[0]!.a)
  expect(depois).toBe(OUTRA_PESSOA)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

`cd apps/api && npx vitest run contexto-do-ator` → FAIL: a assinatura não aceita três argumentos.

- [ ] **Passo 3: Implementar**

```ts
export const SISTEMA = Symbol('ator.sistema')
export type Ator = PessoaId | typeof SISTEMA

async naClinica<T>(clinicaId: ClinicaId, ator: Ator, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await this.pool.connect()
  try {
    await c.query('BEGIN')
    await c.query('SELECT set_config($1,$2,true)', ['app.clinica_id', clinicaId])
    // `''` e não NULL: app_pessoa_id() devolve NULL para string vazia, e é
    // assim que o trigger da Task 3 distingue "sistema" de "esqueceram".
    await c.query('SELECT set_config($1,$2,true)',
      ['app.pessoa_id', ator === SISTEMA ? '' : ator])
    const r = await fn(c)
    await c.query('COMMIT')
    return r
  } catch (erro) { /* ROLLBACK em try/catch próprio, c.release(erro) — como hoje */ }
}
```

- [ ] **Passo 4: Rodar — PASS.** Depois `pnpm typecheck` e corrigir **cada** chamador. O compilador lista todos; não acrescente `SISTEMA` para calar o erro sem pensar — em `entrar`, o ator é a pessoa que acabou de autenticar.

- [ ] **Passo 5: Commit**

---

## Task 3: O trigger que registra — e que recusa escrever sem ator

**Files:**
- Modify: `apps/api/migrations/0004_auditoria.sql` *(ainda não aplicada em produção; se já aplicada, crie `0005`)*
- Test: `teste/auditoria-registra.test.ts`

**Decisão central do plano.** O registro não é chamada no handler: é trigger. Três consequências, e elas são o motivo:

1. **Nenhum caminho escapa** — nem um `psql` manual, nem um job, nem uma rota que o programador esqueceu.
2. **`de → para` sai de `OLD`/`NEW`**, exato, sem o handler precisar montar o diff.
3. **Falha fechado:** sem ator declarado, a escrita é **recusada**. O contrário — gravar sem trilha — seria a falha silenciosa que a regra 20 existe para impedir.

**Denylist obrigatória:** `senha_hash` e `token_hash` **nunca** entram em `de`/`para`. Sem isto a trilha vira histórico de hash de senha, legível por quem puder ler auditoria.

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('UPDATE grava só as colunas que mudaram, de → para', async () => {
  await banco.naClinica(CLINICA, PESSOA, async (c) => {
    await c.query(`UPDATE pessoas SET funcao='Coordenadora' WHERE id=$1`, [ALVO])
  })
  const t = await trilhaDe('pessoas', ALVO)
  expect(t.acao).toBe('alterou')
  expect(t.de).toEqual({ funcao: 'Recepção' })
  expect(t.para).toEqual({ funcao: 'Coordenadora' })
  expect(t.ator_id).toBe(PESSOA)
})

it('senha_hash nunca aparece na trilha', async () => {
  await banco.naClinica(CLINICA, PESSOA, async (c) => {
    await c.query(`UPDATE pessoas SET senha_hash='$argon2id$novo' WHERE id=$1`, [ALVO])
  })
  const t = await trilhaDe('pessoas', ALVO)
  expect(JSON.stringify(t)).not.toContain('argon2')
  expect(Object.keys(t.para ?? {})).not.toContain('senha_hash')
})

it('escrita sem ator declarado é RECUSADA, não gravada em silêncio', async () => {
  await expect(
    banco.semIsolamentoDeClinica(`UPDATE pessoas SET funcao='x' WHERE id=$1`, [ALVO]),
  ).rejects.toThrow(/ator não declarado/i)
})
```

- [ ] **Passo 2: Rodar e ver os três falharem**

- [ ] **Passo 3: Implementar o trigger**

```sql
CREATE FUNCTION registrar_auditoria() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_ator uuid := app_pessoa_id();
  v_tipo text;
  v_de jsonb; v_para jsonb; v_id text; v_clinica uuid;
  -- Nunca atravessam para a trilha. Acrescente aqui qualquer segredo novo.
  k_ocultas text[] := ARRAY['senha_hash','token_hash'];
BEGIN
  IF v_ator IS NULL THEN
    IF current_setting('app.pessoa_id', true) IS NULL THEN
      RAISE EXCEPTION 'ator não declarado: escrita em % recusada', TG_TABLE_NAME
        USING HINT = 'Use banco.naClinica(clinica, ator, …). Para job, passe SISTEMA.';
    END IF;
    v_tipo := 'sistema';          -- string vazia = SISTEMA, deliberado
  ELSE
    v_tipo := 'pessoa';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_de := to_jsonb(OLD) - k_ocultas; v_para := NULL;
    v_id := (to_jsonb(OLD)->>'id'); v_clinica := (to_jsonb(OLD)->>'clinica_id')::uuid;
  ELSIF TG_OP = 'INSERT' THEN
    v_de := NULL; v_para := to_jsonb(NEW) - k_ocultas;
    v_id := (to_jsonb(NEW)->>'id'); v_clinica := (to_jsonb(NEW)->>'clinica_id')::uuid;
  ELSE
    -- Só o que mudou. A trilha fica legível e pequena: ninguém lê um diff
    -- de 20 colunas para descobrir que a função mudou.
    SELECT jsonb_object_agg(k, to_jsonb(OLD)->k), jsonb_object_agg(k, to_jsonb(NEW)->k)
      INTO v_de, v_para
      FROM jsonb_object_keys(to_jsonb(NEW)) k
     WHERE to_jsonb(OLD)->k IS DISTINCT FROM to_jsonb(NEW)->k
       AND NOT (k = ANY(k_ocultas));
    IF v_para IS NULL THEN RETURN NULL; END IF;   -- UPDATE que não mudou nada
    v_id := (to_jsonb(NEW)->>'id'); v_clinica := (to_jsonb(NEW)->>'clinica_id')::uuid;
  END IF;

  INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, de, para)
  VALUES (v_clinica, v_tipo, v_ator,
          CASE TG_OP WHEN 'INSERT' THEN 'criou' WHEN 'UPDATE' THEN 'alterou' ELSE 'removeu' END,
          TG_TABLE_NAME, v_id, v_de, v_para);
  RETURN NULL;
END $$;
```

- [ ] **Passo 4: Rodar — os três PASS.**

- [ ] **Passo 5: Prova por mutação**

Troque `RAISE EXCEPTION` por `v_tipo := 'sistema'` e rode: a escrita sem ator passa a ser gravada como "sistema". O terceiro teste **tem** de falhar. Restaure.

- [ ] **Passo 6: Commit**

---

## Task 4: Nenhuma tabela de negócio sem trigger — e a varredura que cobra

**Files:**
- Modify: `apps/api/migrations/0004_auditoria.sql` (anexar o trigger às tabelas de hoje)
- Create: `teste/auditoria-inescapavel.test.ts`

**Por que varredura e não lista:** lista mantida à mão envelhece em silêncio. A varredura do catálogo já provou o valor dela na RLS — foi o que pegou a view escapando. Mesmo padrão.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
it('toda tabela com clinica_id tem o trigger de auditoria', async () => {
  const r = await migrate.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_attribute a ON a.attrelid=c.oid
      WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND a.attname='clinica_id' AND NOT a.attisdropped
        AND c.relname <> 'auditoria'
        AND NOT EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhrelid=c.oid)
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t
           WHERE t.tgrelid=c.oid AND NOT t.tgisinternal
             AND t.tgfoid='registrar_auditoria'::regproc)`)
  // Piso: a varredura precisa ter olhado alguma coisa.
  const total = await migrate.query(`SELECT count(*)::int AS n FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attname='clinica_id'`)
  expect(total.rows[0]!.n, 'nenhuma tabela com clinica_id — a varredura não verificou nada')
    .toBeGreaterThan(0)
  expect(r.rows.map((x) => x.relname)).toEqual([])
})
```

- [ ] **Passo 2: Rodar e ver falhar** — lista `perfis`, `pessoas`, `sessoes`, `tentativas_login`.

- [ ] **Passo 3: Anexar o trigger**

```sql
-- `sessoes` e `tentativas_login` entram: quem entrou e de onde é exatamente o
-- que uma clínica precisa poder perguntar depois de um incidente.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['pessoas','perfis','sessoes','tentativas_login'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION registrar_auditoria()', t, t);
  END LOOP;
END $$;
```

- [ ] **Passo 4: Rodar — PASS.** E `npx turbo run test --force`: `entrar` agora escreve em `sessoes` e `tentativas_login`, então **toda** a suíte de autenticação exercita o trigger. Se algo ficou sem ator, falha aqui.

- [ ] **Passo 5: Prova por mutação** — remova o trigger de `perfis`; o teste tem de nomear `perfis`. Restaure.

- [ ] **Passo 6: Commit**

---

## Task 5: Registro de acesso (regra 18)

**Files:**
- Create: `apps/api/src/auditoria/acesso.decorator.ts`, `acesso.interceptor.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/auditoria/acesso.interceptor.test.ts`

**Por que mecanismo separado:** trigger não vê `SELECT`. E a regra 18 pede registro de **acesso**, porque a pergunta que a LGPD dá à clínica é "quem olhou o prontuário da minha paciente" — ninguém alterou nada, e é exatamente isso que precisa ser respondível.

**Marcação explícita, não automática:** registrar todo `GET` encheria a trilha de ruído (a tela Hoje recarrega sozinha) e o ruído esconde o que importa. `@DadoSensivel('paciente')` na rota que entrega dado de saúde.

- [ ] **Passo 1: Escrever o teste que falha**

```ts
it('abrir a ficha de uma paciente grava "acessou" na trilha', async () => {
  await pedir(`/v1/pacientes/${PACIENTE}`, cookieDe(JULIANA))
  const t = await ultimaTrilha()
  expect(t.acao).toBe('acessou')
  expect(t.entidade).toBe('paciente')
  expect(t.entidade_id).toBe(PACIENTE)
  expect(t.ator_id).toBe(JULIANA)
})

it('resposta de erro não grava acesso — ninguém viu nada', async () => {
  const antes = await contarTrilha()
  await pedir(`/v1/pacientes/${INEXISTENTE}`, cookieDe(JULIANA))   // 404
  expect(await contarTrilha()).toBe(antes)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar** — interceptor global que, só em resposta de sucesso a rota marcada, insere `acao='acessou'`. Registrado **depois** do `SessaoGuard` (sem sessão não há ator) e **antes** do `RedacaoInterceptor` (a trilha grava o que foi entregue, não o que sobrou).

- [ ] **Passo 4: Rodar — PASS.**

- [ ] **Passo 5: Commit**

---

## Task 6: Ler a trilha — e não transformá-la num vazamento

**Files:**
- Create: `packages/contracts/src/auditoria.ts`, `apps/api/src/auditoria/auditoria.{controller,service}.ts`
- Test: `apps/api/src/auditoria/auditoria.e2e.test.ts`

**O risco desta tarefa, dito com todas as letras:** a trilha guarda `de`/`para` de **salário** e, no Plano 6, de **dose por paciente**. Uma rota de auditoria sem controle entrega, num só `GET`, tudo o que as regras 17 e 18 protegem em todas as outras rotas. **Ela é a rota mais perigosa do sistema.**

- [ ] **Passo 1: Escrever os testes que falham**

```ts
it('quem não é admin da clínica não lê a trilha', async () => {
  expect((await pedir('/v1/auditoria', cookieDe(JULIANA))).status).toBe(403)
})

it('o admin lê só a própria clínica', async () => {
  const r = await pedir('/v1/auditoria', cookieDe(HELENA))
  expect(r.status).toBe(200)
  expect(r.body.itens.every((i) => i.clinicaId === CLINICA_DEMO)).toBe(true)
})

it('sem a permissão "valores", a trilha não entrega salário em de/para', async () => {
  const r = await pedir('/v1/auditoria?entidade=pessoas', cookieDe(SUPERVISORA_SEM_VALORES))
  expect(JSON.stringify(r.body)).not.toMatch(/salario/)
})
```

- [ ] **Passo 2: Rodar e ver falhar**

- [ ] **Passo 3: Implementar** — `@Exige('config')` na rota; consulta sempre dentro de `naClinica` (a RLS é a segunda camada, não a única); paginação por `(em, id)` e não `OFFSET`; `de`/`para` atravessam o `RedacaoInterceptor` como qualquer campo.

- [ ] **Passo 4: Rodar — PASS.**

- [ ] **Passo 5: Acrescentar a linha de `auditoria` em `docs/compliance/retencao.md`** — prazo, base legal e ação. Trilha sem prazo de retenção é acúmulo indefinido de dado sensível, e isso é o oposto do que a LGPD pede.

- [ ] **Passo 6: Commit**

---

## Task 7: ADR e fechamento

**Files:**
- Create: `docs/adr/0002-auditoria-por-trigger.md`
- Modify: `docs/dividas.md` (D4 sai), `docs/roadmap.md`, `CLAUDE.md` §10

- [ ] **Passo 1: Escrever a ADR** — decisão (trigger, não chamada no handler), alternativas recusadas (chamada no serviço: esquecível; interceptor sobre toda escrita: não enxerga `de`/`para` nem alcança job e `psql`), e o que se perde: **todo caminho de escrita passa a precisar de ator declarado**, incluindo migration de dados e seed, que passam a usar `SISTEMA` explicitamente.

- [ ] **Passo 2: Remover D4 de `docs/dividas.md`** — dívida paga sai do arquivo; o histórico fica no git.

- [ ] **Passo 3: Verificação final**

```bash
pnpm typecheck && npx turbo run test --force
```

Rode a suíte **três vezes**. Determinismo não se afirma, se observa — foi assim que o vermelho alternado apareceu no Plano 1.

- [ ] **Passo 4: Commit**

---

## Auto-revisão do plano

**Cobertura da D-5:** restrição 1 (ator_tipo, Task 1) ✓ · restrição 3 (a clínica enxerga, Task 6) ✓ · restrições 2, 4, 5, 6, 7 são do painel do superadmin — **épico 12**, declarado fora de escopo acima, e a Task 1 garante que não exigirão reescrever o passado.

**Regras:** 17 (Task 6) · 18 (Task 5) · 19 (Task 1) · 20 (Tasks 3 e 4) · 21 (denylist, Task 3) · 22 (`timestamptz`, Task 1).

**O que este plano deliberadamente não entrega:** painel do superadmin, concessões, allowlist de rede, exportação da trilha e alerta sobre padrão de acesso. Os dois últimos não têm gatilho ainda; os três primeiros são o épico 12.

**O risco que fica:** o trigger `FOR EACH ROW` custa uma inserção por linha alterada. Importação em massa no Plano 9 — migração das 4 clínicas — vai sentir. **Não otimize agora:** meça na primeira importação real e, se doer, a saída é `SISTEMA` com um único registro de lote por importação, não desligar o trigger.
