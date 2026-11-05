# ADR 0016 — Escrita do `Usuário de Gestão`: leads e rotina interna

- **Data:** 2026-11-05
- **Estado:** aceita (decisões 1 e 5), **provisória pendente de confirmação do
  dono** (decisões 2, 3 e 4 — ver seção própria)
- **Origem:** gate de risco (`especialista-seguranca-appsec`) sobre
  `docs/superpowers/plans/g5-spec-rotina-interna-funil.md`, antes de
  `/to-tickets`. Primeira vez que uma sessão de `Usuário de Gestão` (não o
  `Operador`) **escreve** dado de negócio na carteira.
- **Relacionada:** ADR 0011 (identidade/tenancy da carteira), ADR 0012 (RLS
  por `grupo_id`), ADR 0013 (o que não atravessa e sob que base legal).

## Contexto

G5 introduz quatro tabelas novas de escrita direta por `Usuário de Gestão`
(`leads_comerciais`, `interacoes_do_lead`, `rotinas_internas`,
`tarefas_internas`, `checkins_internos`) e uma mudança de schema em
`clientes_carteira` (`clinica_id` passa a nullable). O spec levanta 5
perguntas sem resposta do dono, cada uma com recomendação do autor. Esta ADR
formaliza a emenda textual à ADR 0011 pedida na pergunta 4 (a única das cinco
que efetivamente reabre uma decisão já aceita por escrito) e registra as
outras quatro recomendações como decisão provisória de engenharia — o projeto
segue em desenvolvimento contínuo, mas nenhuma delas vira fato definitivo sem
o dono confirmar.

## Decisão

### 1 · Emenda à ADR 0011, item 2 — "só o Operador cria" é sobre identidade/tenancy, não sobre toda escrita futura (ACEITA)

A ADR 0011, item 2, lê literalmente: *"O ator que acessa pelo grupo (`Usuário
de Gestão`...) é criado e atribuído somente pelo Operador... mas nunca cria
usuário nenhum — nem `Pessoa` de clínica, nem outro `Usuário de Gestão`."* O
escopo do texto é `Grupo` e `Usuário de Gestão` — os dois objetos de
identidade/tenancy que a ADR 0011 estava fechando. `Lead comercial`,
`Interação do lead`, `Tarefa interna`, `Rotina interna` e `Checkin interno`
são dado operacional do dia a dia da carteira — a própria razão de existir do
`Usuário de Gestão`, não um objeto de tenancy.

**Emenda:** a partir desta ADR, a ADR 0011 item 2 lê-se como: *"só o Operador
cria e atribui `Grupo` e `Usuário de Gestão`; o `Usuário de Gestão`, dentro do
seu próprio escopo, cria e edita livremente o dado operacional da carteira
(`Lead comercial`, `Tarefa interna`, `Rotina interna`, `Checkin interno`,
`Interação do lead`)."* Nenhum outro trecho da ADR 0011 muda. `Cliente
Firmare` (`clientes_carteira`) continua fora desta emenda — nasce só por
conversão de um lead (§2.3 do spec G5) ou por ação direta do Operador; não há
uma rota de "criar `Cliente Firmare` do zero" para o `Usuário de Gestão`.

### 2 · Escrita exige verificação que a leitura não exigia: `grupo_id`/`responsavel` nunca vêm do corpo da requisição (ACEITA, achado de segurança próprio)

A RLS por `app_pode_ver_grupo(grupo_id)` (ADR 0012) é suficiente para a
**leitura** sem mudança nenhuma — ela já nega a visibilidade entre grupos.
Para a **escrita**, ela só fecha metade do problema: a política com `WITH
CHECK (app_pode_ver_grupo(grupo_id))` recusa um `INSERT` cujo `grupo_id` não é
o do próprio grupo (ou geral) — isso é verdade e suficiente **se** o servidor
nunca aceitar `grupo_id` vindo do corpo da requisição. O achado é que o spec
(§2.1, §5) nunca diz isso explicitamente para as tabelas novas, só para
`clinica_id` em `clientes_carteira` (ADR 0012 item 4, "`codigo_rotina` nunca é
parâmetro de requisição").

**Decisão, a valer como requisito de implementação, não como sugestão:**

- `grupo_id` de um `Lead comercial`/`Tarefa interna`/`Rotina interna`/
  `Checkin interno` **nunca** é um campo aceito do corpo de uma requisição de
  criação. Para escopo `grupo`, o servidor grava `app_grupo_id()` da sessão
  (o mesmo `SET LOCAL app.grupo_id` fixado pelo guard, nunca por
  `request.body.grupoId`). Para escopo `geral` criando um lead **sem grupo**
  (prospecção avulsa, §2.1), `grupo_id` é `NULL` por omissão do campo, nunca
  por um valor explícito de "grupo nenhum" que o cliente poderia manipular
  para um UUID de outro grupo.
- A única exceção prevista no spec — um lead de expansão de rede, criado já
  com `grupo_id` de um grupo existente (§2.1) — só é permitida quando quem
  cria tem `escopo='geral'` (o Operador, que de fato enxerga todos os grupos
  e pode escolher) **ou** `escopo='grupo'` e o `grupo_id` do payload é
  idêntico ao `app_grupo_id()` da própria sessão. Qualquer outro valor é
  recusado no servidor, **antes** de chegar ao `INSERT` — depender só do
  `WITH CHECK` da RLS para recusar é correto como segunda camada (regra 19 do
  CLAUDE.md), mas a primeira camada (validação explícita no service) precisa
  existir e ser testada, porque é ela quem transforma "o banco rejeitou um
  INSERT" em "o usuário recebeu 403 com mensagem clara" em vez de um erro 500
  genérico vazando a existência de política de RLS.
- `responsavel_usuario_gestao_id` (em `tarefas_internas`/`rotinas_internas`)
  tem o mesmo risco num grau menor: nada impede hoje, por leitura do spec,
  que um `Usuário de Gestão` do grupo A atribua uma tarefa a
  `responsavel_usuario_gestao_id` de um usuário do grupo B (não é um
  cruzamento de clínica, mas é um cruzamento de identidade entre grupos que
  não faz sentido de negócio e não tem teste previsto). **Decisão:** o
  servidor valida que `responsavel_usuario_gestao_id`, quando preenchido,
  pertence ao mesmo `grupo_id` da tarefa (ou é `escopo='geral'`) — mesma
  forma de validação servidor-side que o item acima, antes do `INSERT`.
- **Teste de aceite novo, para o ticket:** duas sessões, dois grupos — sessão
  do grupo A tenta criar um `Lead comercial`/`Tarefa interna` com
  `grupo_id`/`responsavel_usuario_gestao_id` manipulado para apontar ao grupo
  B via payload; o servidor recusa com 4xx explícito, e nenhuma linha é
  criada (consulta direta ao banco, não só ausência de erro 500) — mesmo
  padrão de `teste/isolamento-de-clinica.test.ts`, mas contra a camada de
  validação do service, **além** da RLS.

### 3 · `clientes_carteira.clinica_id` nullable não abre bypass de RLS/tenancy (ACEITA, achado de verificação)

Verificado contra `teste/isolamento-de-clinica.test.ts` e
`teste/auditoria-inescapavel.test.ts`: a RLS de `clientes_carteira` é por
`grupo_id` (ADR 0012), nunca por `clinica_id` — `ENTIDADES_COM_CLINICA_POR_GRUPO`
(`teste/registro.ts:556`) já registra a tabela sob esse regime, e as
varreduras de `isolamento-de-clinica.test.ts` examinam só presença de coluna
`clinica_id`, RLS habilitada/forçada e o texto da policy (`app_pode_ver_grupo`,
sem `OR`) — nenhuma delas depende de `NOT NULL`. Tornar a coluna nullable não
move a tabela de lista nem muda o texto de nenhuma policy: a mudança é
schema-compatível com as varreduras existentes, sem edição necessária em
`teste/registro.ts`.

**O que isto não cobre, e que o spec já havia identificado corretamente
(§6.2):** o trigger `registrar_auditoria()` deriva `auditoria.clinica_id`
direto de `NEW.clinica_id`, e `auditoria.clinica_id` é `NOT NULL`
(`apps/api/migrations/0002`). Confirmado por leitura de
`apps/api/migrations/0025_carteira_fundacao.sql:210-281`: o `CASE` dentro de
`registrar_auditoria()` resolve o **ator** (`pessoa`/`operador`/
`usuario_gestao`/`sistema`), mas não ramifica sobre `v_clinica IS NULL` — um
`INSERT` em `clientes_carteira` com `clinica_id = NULL` executa
`v_clinica := (v_new ->> 'clinica_id')::uuid` (= `NULL`) e tenta
`INSERT INTO auditoria (clinica_id, ...) VALUES (NULL, ...)`, que viola o
`NOT NULL` da migration `0002` e falha a transação inteira. **Nenhum teste
hoje pega isto** — é schema novo, sem teste de aceite escrito ainda. Fica
como item obrigatório do ticket (já no critério de aceite 6 do spec, §9):
redirecionar para `auditoria_do_painel` quando `clinica_id IS NULL`, mesmo
padrão de `grupos`/`usuarios_gestao` (migration `0030`), **antes** do primeiro
deploy que permite `clinica_id NULL` em produção — não depois. Bloqueador de
merge, não item de follow-up.

### 4 · "Arquivar" exige trilha de quem/quando, além de `arquivado_em` (ACHADO — mitigação exigida antes do ticket)

`arquivado_em timestamptz` sozinho (§2.4, §7 do spec) responde "quando", mas
não "quem". Regra 20 do CLAUDE.md ("soft delete e trilha de auditoria
append-only... quem, quando, de → para") já é satisfeita **em parte** pelo
trigger universal `registrar_auditoria()`, que grava o `UPDATE` de
`arquivado_em` (de `NULL` para o timestamp) com `ator_tipo`/`ator_id` — ou
seja, a trilha de **quem** já existe, mas mora em `auditoria_do_painel`, uma
tabela de uso forense (consulta por `entidade_id`), não pensada para a tela.

**Decisão:** não duplicar a informação num campo `arquivado_por_id` em
`leads_comerciais` — seria a mesma regra escrita duas vezes (CLAUDE.md,
"espelho que já divergiu"). Em vez disso, a tela que mostra "arquivado por
Fulano em 05/11" lê a trilha existente (`auditoria_do_painel`, filtrando
`entidade='leads_comerciais' AND entidade_id=$1 AND para->>'arquivado_em' IS
NOT NULL`), não um campo novo na tabela de negócio. Isto é suficiente **desde
que** o trigger de `leads_comerciais` exista desde o primeiro commit da
tabela (não é opcional — toda tabela de negócio tem o trigger, regra 20, e a
varredura de `auditoria-inescapavel.test.ts` já cobra isso automaticamente
por ser genérica sobre tabelas com `clinica_id`; **atenção:** `leads_comerciais`
**não tem** `clinica_id` — ela vai para `auditoria_do_painel` por fora da
varredura automática de `comClinicaId()`, então o ticket precisa de uma
chamada explícita a `registrar_auditoria()` ou equivalente para
`auditoria_do_painel`, e um teste que prove que o `UPDATE` que seta
`arquivado_em` de fato grava lá — a varredura genérica não vai pegar essa
tabela sozinha, porque ela varre por `clinica_id`, não por "toda tabela de
negócio").

## Decisões provisórias de engenharia, pendentes de confirmação do dono

As quatro adotadas como decisão de trabalho, seguindo a recomendação do autor
do spec, **nenhuma delas é definitiva**:

1. **`checkin_interno` qualitativo**, sem `meta_id`/`valor` nesta fatia (spec
   §4, pergunta 1). Risco de reverter baixo — é aditivo, não há schema a
   refazer se o dono pedir o número depois.
2. **Visibilidade "todos veem tudo no grupo"**, sem parede por
   `responsavel_id` (spec §5, pergunta 2). Risco de reverter médio — se o
   dono pedir fronteira interna depois, é um campo novo
   (`responsavel_exclusivo` ou política adicional), não uma reescrita de RLS.
3. **"Arquivar" na tela**, nunca "Excluir" (spec §2.4, pergunta 3). Risco de
   reverter baixo — é rótulo de UI, sem impacto de schema.

Confirmação pendente nas três. **Não bloqueiam** `/to-tickets` — o
comportamento do servidor (soft-state, nunca `DELETE`) é idêntico
independente da palavra escolhida na tela, e o dono pode trocar o rótulo sem
tocar em código de domínio.

A quarta pergunta do spec (pergunta 5 — provisionamento de `Clinica` real
continua só do Operador) **não é provisória**: é reafirmação de uma regra já
em vigor (nenhuma rota nova a criar), aceita nesta ADR sem reserva.

## Alternativas rejeitadas

**Confiar só na RLS (`WITH CHECK`) para recusar `grupo_id`/
`responsavel_usuario_gestao_id` cruzados, sem validação explícita no
service.** Rejeitada: tecnicamente correta como última linha de defesa
(regra 19), mas insuficiente como única linha — um `INSERT` recusado pela RLS
vira um erro de banco genérico na borda HTTP, que ou vaza detalhe de
implementação (nome de constraint/policy) ou precisa de tratamento ad-hoc por
rota, repetindo exatamente o padrão que a regra 17 do CLAUDE.md já proíbe
("nunca um `if` por endpoint"). A validação pertence a um ponto único no
service da carteira, a RLS fica como rede de segurança, nunca como única
camada.

**Campo `arquivado_por_id` dedicado em `leads_comerciais`.** Rejeitada: a
trilha de ator já existe via `registrar_auditoria()`/`auditoria_do_painel`; um
campo espelho divergiria dela na primeira correção manual feita direto no
banco (o mesmo defeito que a regra 20 existe para evitar).

## Consequências

- `apps/api/src/carteira/` ganha a validação explícita de
  `grupo_id`/`responsavel_usuario_gestao_id` antes de qualquer `INSERT` em
  `leads_comerciais`/`tarefas_internas`/`rotinas_internas`/`checkins_internos` —
  entra no ticket de G5 como requisito, não como melhoria.
- A migration que relaxa `clientes_carteira.clinica_id` e redireciona o
  trigger de auditoria (§6.2 do spec) é **bloqueador de merge** junto com a
  primeira tabela de G5 que grava `clinica_id = NULL`, nunca um follow-up.
- `leads_comerciais` precisa de trigger de auditoria explícito para
  `auditoria_do_painel` desde a migration que a cria — a varredura automática
  de `auditoria-inescapavel.test.ts` não a alcança sozinha (ela não tem
  `clinica_id`), então o ticket inclui um teste dedicado (mesmo padrão de
  `painel-carteira.e2e.test.ts` para `grupos`/`usuarios_gestao`).
- `claude-security:scan` roda sobre `apps/api/src/carteira/` quando as rotas
  de escrita de G5 nascerem — já recomendado pela ADR 0012 e reafirmado aqui
  porque é a primeira escrita de `Usuário de Gestão` no produto.
- Nenhuma mudança em `teste/registro.ts` é necessária para
  `clientes_carteira` nullable (verificado, seção 3). As quatro tabelas novas
  de G5 (`leads_comerciais`, `interacoes_do_lead`, `rotinas_internas`,
  `tarefas_internas`, `checkins_internos`) entram em
  `ENTIDADES_COM_CLINICA_POR_GRUPO` quando a migration nascer — nenhuma delas
  tem `clinica_id`, mas todas têm RLS por `grupo_id`/`app_pode_ver_grupo`, o
  mesmo regime.
