# ADR 0012 — RLS da carteira é por `grupo_id`, nunca consulta cruzando `clinica_id`

- **Data:** 2026-11-05
- **Estado:** aceita
- **Origem:** achado 1 e 3 do gate de risco de `especialista-seguranca-appsec`
  sobre o plano de integração Firmare Gestão (ver ADR 0011). **Reprovou** seguir
  para `/to-tickets` sem esta decisão escrita.

## Contexto

O plano original dizia "RLS continua filtrando só por `clinica_id`; `grupo_id`
é filtro de aplicação" — mas não dizia **onde** essa filtragem de aplicação
acontece, nem com qual papel de banco. `especialista-seguranca-appsec` apontou
o risco concreto: a política existente (`clinica_id = app_clinica_id()`,
`apps/api/migrations/0002_identidade.sql:73-74`, função definida em
`0001_fundacao.sql:36-38`) é de **valor único** — resolve "uma clínica por
vez" (o mesmo padrão que `fir_painel` usa, ADR 0008: "ele fixa `app.clinica_id`
como qualquer um"). Um `Usuário de Gestão` com `Escopo = grupo` precisa ler
**várias clínicas agregadas numa consulta só**. Sem decisão escrita, o caminho
de menor resistência sob prazo é dar `BYPASSRLS` "só para esse papel" — e isso
recriaria exatamente o que o próprio histórico deste produto já rejeitou duas
vezes (migration `0002`, clínica sentinela; migration `0013`, `fir_painel`
checado em boot contra `BYPASSRLS`/`SUPERUSER`/`CREATEROLE`).

## Decisão

### 1 · As tabelas da carteira nunca são lidas por RLS de `clinica_id` — elas têm `grupo_id` próprio

`campanhas_carteira`, `uso_diario_cliente` e `clientes_carteira` **não são as
tabelas operacionais da clínica**, e isso já estava certo na ADR 0011 (job
escreve fato agregado, nunca consulta ao vivo). O que faltava dizer: essas
tabelas carregam `grupo_id` como coluna própria (denormalizada de
`clientes_carteira.grupo_id` no momento da escrita), e a política de RLS delas
é **a mesma forma, um nível acima**:

```sql
CREATE FUNCTION app_grupo_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.grupo_id', true), '')::uuid $$;

CREATE FUNCTION app_pode_ver_grupo(alvo uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT app_escopo() = 'geral' OR alvo = app_grupo_id() $$;

CREATE POLICY campanhas_carteira_por_grupo ON campanhas_carteira
  USING (app_pode_ver_grupo(grupo_id))
  WITH CHECK (app_pode_ver_grupo(grupo_id));
```

**Emenda (2026-11-05, ao implementar G2):** o `OR` **nunca fica na cláusula da
policy** — `teste/isolamento-de-clinica.test.ts` já prova, por mutação ao
vivo, que `USING (clinica_id = app_clinica_id() OR true)` continua "contendo
`app_clinica_id`" e abre a tabela inteira; a defesa de lá é proibir `OR` na
cláusula, sem exceção. `app_pode_ver_grupo()` carrega o `OR` **dentro da
função** — mesma forma de `temPerm` ("uma função só, nunca um `if` espalhado")
— e a policy só chama a função. `app_escopo()` segue a mesma forma de
`app_clinica_id()` (`current_setting`, `STABLE`, nunca gravável pela própria
sessão sem passar pelo guard de autenticação). Nenhuma tabela precisa de
`BYPASSRLS`: "ver tudo" (escopo `geral`) é uma decisão dentro da função,
condicionada a um valor que só o guard define — o mesmo mecanismo que já
existe, um nível acima, nunca um mecanismo novo nem uma exceção ao "sem `OR`".

**O que isto resolve:** não há consulta que cruze `clinica_id` de verdade
nenhuma vez. O `Usuário de Gestão` nunca toca as tabelas operacionais da
clínica (`CampanhasModule`, `tarefas`, etc.) — ele lê só o que o job já
escreveu, filtrado por `grupo_id`, com uma política de valor único igual à que
já existe.

### 2 · `fir_carteira` segue o boot check de `fir_painel`, linha por linha

Migration da carteira começa com o mesmo padrão de `0013_painel.sql`:

- `IF NOT EXISTS (... pg_roles ...)` → `RAISE EXCEPTION` com `HINT` apontando
  para `infra/bootstrap-papeis.sql`;
- checagem de `rolbypassrls OR rolsuper` → `RAISE EXCEPTION`;
- checagem de `rolcreaterole` → `RAISE EXCEPTION`;
- `GRANT` linha a linha nas tabelas da carteira, nunca `ALTER DEFAULT
  PRIVILEGES`.

`fir_carteira` é **terceira conexão, separada por autenticação** — nunca
`SET ROLE` sobre `fir_app` nem sobre `fir_painel` (mesma razão da D-5 restrição
5: `RESET ROLE` desfaz na mesma transação).

### 3 · Os dois jobs escrevem como `fir_app`, fixando `app.clinica_id`, nunca como `fir_carteira`

O job de telemetria e o de sincronização de campanha rodam **dentro do
contexto de cada clínica**, um de cada vez — exatamente como qualquer escrita
de produto. Eles autenticam como `fir_app` (ou um papel irmão sem
`BYPASSRLS`), fazem `SET LOCAL app.clinica_id = $1` antes de ler
`CampanhasModule`/módulos de tarefa daquela clínica, calculam o agregado, e
então escrevem na tabela da carteira **com o `grupo_id` resolvido a partir de
`clientes_carteira.clinica_id = $1`** — nunca aceitando `grupo_id` como
parâmetro externo.

`campanhas_carteira` e `uso_diario_cliente` **entram na varredura de regra 19**
(toda tabela de negócio tem `clinica_id` ou, aqui, `grupo_id` não nulo com
RLS) e, por carregar receita real, `campanhas_carteira` **entra na regra 20**
(append-only, trilha de quem escreveu). Reprocessar um dia já fechado é
`UPDATE` proibido pelo mesmo `REVOKE`/trigger que protege `movimentos_de_estoque`
— a correção é uma linha nova com `substitui_id` apontando para a anterior,
nunca sobrescrita silenciosa.

### 4 · `codigo_rotina` nunca é parâmetro de requisição

A chave que liga uma campanha da carteira à clínica real (`codigo_rotina` no
protótipo, `clinica_id` no FIR) é resolvida **uma vez, no onboarding**, por um
ator com permissão (`Operador`, ao criar/vincular o `Cliente Firmare` à
`Clinica`) e gravada em `clientes_carteira.clinica_id`. Nenhuma rota aceita um
identificador de clínica vindo do corpo ou da query de uma requisição do
`Usuário de Gestão` — ele nunca escolhe qual clínica ler; o `grupo_id` da
sessão já restringe isso pela política acima.

## Alternativas rejeitadas

**`BYPASSRLS` para `fir_carteira`.** Rejeitada pela mesma razão da ADR 0008:
faria todo teste de isolamento passar sem provar nada, e um bug no filtro de
aplicação vazaria silenciosamente entre grupos.

**Política de múltiplos valores (`grupo_id = ANY(app_grupos_ids())`)**, para
um `Usuário de Gestão` pertencer a vários grupos. Rejeitada porque não existe
tal caso hoje — `Escopo` é `geral` ou **um** grupo (ADR 0011) — e construir a
política para um caso hipotético é abstração especulativa (veto de
`arquiteto-solucao`). Se o dono pedir isso no futuro, é uma ADR nova.

## Emenda (2026-11-05) — MFA não entra, por decisão do dono

O gate de segurança (`especialista-seguranca-appsec`) exigiu MFA obrigatório
para o `Usuário de Gestão`, por ele operar fora de qualquer allowlist de IP
fixo. **O dono decidiu não implementar MFA agora**, mantendo o mesmo padrão
de segurança já usado no resto do produto (senha + Argon2 + limite de
tentativas por conta, igual a `Pessoa` e `Operador`) — sem segundo fator.

**O que muda a análise de risco, e por que o dono considerou aceitável:** a
allowlist de IP do superadmin, que o gate citou como a diferença entre os
dois atores, **não está ativa em produção hoje** (fica no backlog — ver
`docs/dividas.md`). Ou seja: o superadmin de hoje já roda sem a camada de
rede que motivaria MFA no `Usuário de Gestão` por comparação — a carteira sem
MFA não fica, nesta decisão, mais fraca que o padrão já aceito para o resto
do produto.

**Isto é risco aceito, registrado, não esquecido.** Fica para quando (a) a
allowlist do superadmin for ativada — e aí a assimetria entre os dois atores
reabre a pergunta —, ou (b) o volume de uso da carteira justificar o custo de
implementar TOTP. `Usuários de Gestão` e sessões continuam revogáveis
instantaneamente (P-12) e com rate limit por conta, que é a mitigação que
sobra sem o segundo fator.

## Consequências

- `app_grupo_id()` e `app_escopo()` entram em `packages/domain`/migrations
  como funções estáveis, mesma forma de `app_clinica_id()`.
- `teste/escrita-sem-rls.test.ts` e `teste/painel-no-banco.test.ts` ganham
  equivalentes para `fir_carteira` (RLS contra Postgres real, nunca mock —
  regra de testes do CLAUDE.md §7).
- `claude-security:scan` roda quando `apps/api/src/carteira/` nascer (já
  recomendado pelo gate).
