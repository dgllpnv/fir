# ADR 0018 — Isolamento do Portal do Grupo: identidade, RLS e autenticação de um quarto ator

- **Data:** 2026-11-05
- **Estado:** aceita
- **Origem:** gate de risco de `especialista-seguranca-appsec` sobre
  `docs/superpowers/plans/g6-spec-portal-do-grupo.md`, **no spec, antes de
  `/to-tickets`** — nenhum ticket, nenhuma migration, nenhum código tocado por
  esta revisão.
- **Relacionada:** ADR 0011 (`Grupo`/`Usuário de Gestão`, identidade e
  tenancy), ADR 0012 (RLS da carteira por `grupo_id`, nunca por `clinica_id`
  cruzado), ADR 0013 (base legal e supressão por N pequeno), ADR 0016 (achado
  de que `grupo_id`/identificador de escopo nunca vem do corpo da
  requisição), ADR 0017 (base legal do Portal do Grupo, já aceita — esta ADR
  não reabre nada do que ela decidiu).

## Contexto

O spec G6 introduz `Usuário do portal` — tabela `usuarios_do_portal`, cookie
`__Host-fir-portal`, `Escopo ∈ {cliente, grupo}` — o primeiro ator do **lado
do cliente** da Firmare com sessão própria no sistema, e o quarto espaço de
identidade do produto (depois de `Pessoa`, `Operador`, `Usuário de Gestão`).
A ADR 0017 já fechou a base legal e confirmou que nenhum dado operacional/de
paciente cruza `clinica_id` nesta fase. Falta o que é próprio da revisão de
`especialista-seguranca-appsec`: que a identidade e a autenticação desse
quarto ator não reabrem, por caminho novo, um isolamento que as ADRs 0011/
0012/0016 já fecharam para o terceiro.

A tarefa pediu verificação em cinco pontos. Cada um vira critério de
aceite obrigatório abaixo — **não "boa prática", bloqueador de merge**, no
mesmo registro de severidade das ADRs 0011-0017.

## Decisão

### 1 · Isolamento entre Clientes Firmare do mesmo grupo (`escopo='cliente'`) — a função distingue os dois escopos, e nenhum dos dois campos vem do corpo da requisição

A proposta do spec (§2.1) é:

```sql
CREATE FUNCTION app_portal_pode_ver(g uuid, c uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN app_portal_cliente_id() IS NULL
      THEN g = app_portal_grupo_id()
      ELSE c = app_portal_cliente_id()
    END
  $$;
```

**Confirmado como suficiente em forma**, com três requisitos que o spec não
tornou explícitos e que esta ADR fixa como obrigatórios, replicando ponto a
ponto o achado da ADR 0016 §2 para o terceiro ator:

1. **`app_portal_cliente_id()` e `app_portal_grupo_id()` são lidas de
   `current_setting('app.portal_cliente_id', true)`/`current_setting('app.portal_grupo_id', true)`,
   fixadas pelo `PortalGuard` a partir da sessão (`SET LOCAL`), nunca a partir
   de `request.body`/`request.query`.** Nenhuma rota do portal aceita
   `cliente_carteira_id` ou `grupo_id` como parâmetro de requisição para
   decidir o que mostrar — mesma letra da ADR 0012 item 4
   (`codigo_rotina`/`clinica_id` nunca vem do corpo) e da ADR 0016 item 2
   (`grupo_id` nunca vem do corpo em escrita). Uma URL manipulada
   (`/portal/clientes/{outro-id}`) é recusada pela policy de RLS — a
   identidade correta nunca chega a ser um parâmetro que o service precisa
   validar contra, porque o service não aceita esse parâmetro para decidir
   visibilidade; ele só filtra pela sessão.
2. **O `CASE` dentro da função, nunca um `OR` na cláusula da policy** — mesma
   exigência da emenda de 2026-11-05 à ADR 0012 §1: `app_portal_pode_ver()`
   concentra a decisão de escopo dentro da função, e a policy só chama a
   função. `teste/isolamento-de-clinica.test.ts` (ou um arquivo-irmão
   dedicado ao portal, ver critério 6 abaixo) prova por mutação que trocar o
   `CASE` por `g = app_portal_grupo_id() OR c = app_portal_cliente_id()` (sem
   o `ELSE`/exclusão mútua) voltaria a abrir a tabela inteira para uma sessão
   de `escopo='grupo'` tentando ler um `cliente_carteira_id` específico fora
   do próprio grupo — o `CASE` com `ELSE` exclusivo não é estilo, é a
   diferença entre "ou uma coisa ou outra" e "qualquer uma das duas".
3. **`escopo='cliente'` é estritamente mais estreito que `escopo='grupo'` do
   mesmo grupo** — uma sessão de `escopo='cliente'` nunca vê outro
   `cliente_carteira_id` do mesmo `grupo_id`, mesmo que ambos pertençam ao
   grupo que ela "poderia" enxergar se tivesse `escopo='grupo'`. É
   precisamente o ramo `ELSE c = app_portal_cliente_id()` do `CASE` acima —
   quando `app_portal_cliente_id()` não é nulo, `g = app_portal_grupo_id()`
   nunca é avaliado, então um cliente do mesmo grupo não entra por essa
   porta. Fica como critério de aceite 1 (abaixo), e é o caso mais fácil de
   regredir silenciosamente (um `OR` "só para simplificar" reabre
   exatamente isto).

### 2 · Isolamento entre grupos diferentes — mesma forma da ADR 0012, nenhuma política nova

O ramo `g = app_portal_grupo_id()` do `CASE` é a mesma forma de
`app_pode_ver_grupo()` (ADR 0012), um nível abaixo (sem o `OR` de
`escopo='geral'`, porque não existe `escopo='geral'` para `Usuário do
portal` — o spec já fixa isso em §1.2, "não existe `escopo='geral'` para
`Usuário do portal`... `CHECK` análogo... exatamente um de
`cliente_carteira_id`/`grupo_id` preenchido"). **Confirmado: nenhuma política
nova em espécie é necessária** para o isolamento entre grupos — é a mesma
regra de valor único já provada, com uma função a mais, exatamente como a
ADR 0012 já havia previsto para "o próximo ator que precisar da mesma
forma".

### 3 · Superfície de autenticação nova segue o padrão já estabelecido, não inventa um quarto

`sessoes_do_portal`/`tentativas_do_portal` (nomes a confirmar em ticket) **são
obrigatórias como tabelas próprias**, nunca reaproveitando
`tentativas_de_carteira`/`tentativas_login` de outro ator — mesma separação
já praticada entre `Pessoa`, `Operador` e `Usuário de Gestão` (cada um com
seu cookie, seu guard, sua tabela de tentativa). Requisitos, replicando
`CarteiraService.entrar`/`PainelGuard` linha a linha:

1. **Piso de resposta (`PISO_DE_RESPOSTA_MS` equivalente) envolvendo toda a
   tentativa de login**, cronometrado do início ao fim do método público
   (`performance.now()` antes, `finally` com `setTimeout` da diferença) —
   nunca um piso só no branch de "senha errada", porque é exatamente a
   assimetria de tempo entre ramos que distingue "usuário não existe" de
   "senha errada" para um atacante. O portal **não pode reduzir** esse piso
   por ser "menos crítico que a carteira" — o piso existe para proteger
   enumeração de contas de clínicas-cliente, que é dado comercial real.
2. **Resposta cega idêntica para usuário inexistente, senha errada, conta
   desativada e sessão expirada** — mesma frase genérica, mesmo código HTTP,
   mesma forma do `NotFoundException()` do `CarteiraGuard`/`PainelGuard`
   ("mesma resposta para 'sem cookie', 'inválido', 'expirado' e 'desativado'
   — quatro frases diferentes seriam quatro informações de graça").
3. **Rate limit por conta (`identificador`) e por origem**, com janela e
   teto **próprios** do portal (`LIMITE_DO_PORTAL`, símbolo de injeção
   dedicado — mesma razão documentada em `limite-da-carteira.ts`: "reusar
   `LimitePorOrigem` faria [o portal] e o produto dividirem a mesma janela").
   O teto numérico é decisão de engenharia a calibrar no ticket (o cliente
   externo é population maior e mais variável de IP que a equipe comercial
   interna — o comparável mais próximo é o teto de `Pessoa`/produto, não o
   de `Operador`/painel), não decisão desta ADR.
4. **Argon2id para a senha** — mesmo algoritmo do resto do produto (regra do
   CLAUDE.md §2, "nunca MD5, SHA-*, bcrypt"); nenhuma simplificação "porque é
   só leitura" é aceitável — a senha protege o mesmo tipo de dado comercial
   sensível (cobrança, receita de campanha) que a carteira já trata como
   crítico.
5. **Cookie `__Host-fir-portal`**: prefixo `__Host-`, `Secure`, `HttpOnly`,
   `SameSite` — mesma forma de `__Host-fir-carteira`/`__Host-fir-painel`
   (regra do CLAUDE.md §2, "Isso torna HTTPS obrigatório"). Sessão opaca,
   nunca um JWT que carregue `cliente_carteira_id`/`grupo_id` decodificável
   no cliente — o valor de sessão é um token que o `PortalGuard` resolve
   contra a tabela de sessão, exatamente como `CarteiraGuard.contextoDoToken`.
6. **Boot-check do papel de banco** (`fir_portal`), mesmo padrão de
   `fir_carteira`/`fir_painel` (ADR 0012 §2): recusa subir se
   `BYPASSRLS`/`SUPERUSER`/`CREATEROLE` estiver presente no papel. Conexão
   separada, nunca `SET ROLE` sobre `fir_app`/`fir_carteira`/`fir_painel`.

**Nenhum padrão novo de autenticação é introduzido** — o portal reaproveita,
tabela por tabela e linha por linha, a forma já provada em produção para a
carteira. A única coisa genuinamente nova é a existência de duas colunas de
escopo (`portal_cliente_id`/`portal_grupo_id`) em vez de uma, porque o ator
tem dois modos, não um.

### 4 · Escrita: o portal é read-only de ponta a ponta — confirmado, sem exceção aberta pelo spec

O spec (§3.2, §5, §7) já declara `documentos_carteira`/`materiais_carteira`/
`reunioes_comerciais` como escrita exclusiva de `Usuário de Gestão`/
`Operador`, e o `Usuário do portal` como "read-only de ponta a ponta... nenhuma
ação de escrita nasce aqui". **Confirmado como correto e suficiente, com um
requisito de implementação que o spec não tornou explícito:**

- Nenhuma rota sob o guard do portal (`PortalGuard`) pode ser `POST`/`PUT`/
  `PATCH`/`DELETE` contra tabela de negócio. Isto não pode depender só de "a
  tela não oferece botão de escrever" (regra 16 do CLAUDE.md: a tela é
  conveniência, o servidor é a verdade) — o módulo do portal, no backend, não
  declara nenhum endpoint de escrita, ponto. Se um dia aparecer um caso de
  escrita do portal (ex.: "confirmar que leu a ata"), isso é uma ADR nova com
  avaliação própria de superfície, não uma extensão silenciosa do módulo
  read-only existente.
- A RLS das três tabelas (`app_portal_pode_ver` na `USING`) **não precisa**
  de `WITH CHECK` para o papel `fir_portal`, porque `fir_portal` não deveria
  ter `GRANT INSERT/UPDATE/DELETE` nenhum nessas tabelas — a ausência de
  `GRANT` é a primeira camada (mais forte que RLS: não há nem o verbo SQL
  disponível), e vira item de teste (ver critério 7 abaixo): uma tentativa de
  `UPDATE` usando as credenciais de `fir_portal` falha por falta de
  privilégio, antes de qualquer policy ser avaliada.

### 5 · Supressão por reidentificação (ADR 0013 §4) — vira critério de aceite explícito, não fica só em ADR

A ADR 0017 §2 já registrou que a regra de N mínimo (menos de 5 orçamentos
pagos agrupa em "Outras campanhas") **continua valendo** para o `Usuário do
portal`. O spec G6 (§6, critérios de aceite) **não lista isso como critério
testável hoje** — menciona a campanha no item 3 de §3.1 ("mesma regra de N
mínimo... por clínica"), mas não como item numerado de §6 ao lado dos outros
oito. **Esta ADR fecha essa lacuna**: o critério de aceite 9 abaixo
formaliza, como requisito de teste do ticket de G6, o que até aqui só existia
como menção em prosa dentro da ADR 0017 — convertendo princípio em prova.

## Critérios de aceite obrigatórios (somam-se aos 8 já listados no spec G6 §6)

9. Uma campanha da carteira com menos de 5 orçamentos pagos, lida por um
   `Usuário do portal` (qualquer escopo), aparece agrupada em "Outras
   campanhas" — nunca com o valor/nome individualizado — exatamente como já
   é provado para `Usuário de Gestão` (ADR 0013 §4). Teste de integração
   dedicado, não apenas herdado por composição de outro teste.
10. Uma sessão de `escopo='cliente'` do `Cliente Firmare` X nunca lê, por
    nenhuma rota (incluindo manipulação de URL/parâmetro), dado de outro
    `Cliente Firmare` Y do **mesmo grupo** — teste de integração com Postgres
    real, duas sessões de `escopo='cliente'` distintas dentro do mesmo
    `grupo_id`, provando o ramo `ELSE` da função (distinto do critério 3 já
    existente no spec, que testa só cruzamento de grupos).
11. Uma tentativa de `INSERT`/`UPDATE`/`DELETE` em
    `documentos_carteira`/`materiais_carteira`/`reunioes_comerciais`/
    `clientes_carteira`/`campanhas_carteira` autenticada como `fir_portal`
    falha por ausência de privilégio de banco (`permission denied for
    table`), não por RLS — prova de que a camada de `GRANT` é a primeira
    linha de defesa da escrita, não a política.
12. O tempo de resposta de `POST /v1/portal/entrar` para "usuário
    inexistente", "senha errada" e "conta desativada" é estatisticamente
    indistinguível (mesmo piso mínimo), medido no teste de integração —
    mesmo padrão exigido para `carteira`/`painel`.
13. Boot do processo que conecta como `fir_portal` com um papel
    `BYPASSRLS`/`SUPERUSER`/`CREATEROLE` falha com `RAISE EXCEPTION` e
    `HINT` apontando `infra/bootstrap-papeis.sql` — mesmo teste que já existe
    para `fir_carteira`/`fir_painel`, replicado para o quarto papel.

## Alternativas rejeitadas

**Reaproveitar `tentativas_de_carteira`/`LIMITE_DA_CARTEIRA` para o portal,
"já que os dois são atores externos à clínica".** Rejeitada pela mesma razão
já documentada em `limite-da-carteira.ts` para não reaproveitar
`LimitePorOrigem` do produto: janelas compartilhadas entre populações de
usuário muito diferentes (equipe comercial interna vs. clientes externos de
clínicas) fazem um ataque contra uma população consumir a cota da outra, e
escondem, numa auditoria futura, de qual ator veio a tentativa.

**Um único `WITH CHECK (app_portal_pode_ver(grupo_id, cliente_carteira_id))`
nas três tabelas novas, sem reforçar a ausência de `GRANT` de escrita para
`fir_portal`.** Rejeitada: repetiria o padrão já descartado na ADR 0012
("`BYPASSRLS`... faria todo teste de isolamento passar sem provar nada") em
espelho — aqui o risco não é RLS fraca, é depender de uma única camada
(policy) quando uma camada mais barata e mais forte (ausência de privilégio
SQL) está disponível e é exatamente o que já se faz para os outros papéis
somente-leitores do produto.

**Deixar a supressão por N pequeno (critério 9) implícita, por já estar
escrita em prosa na ADR 0017.** Rejeitada: é exatamente o padrão que a regra
17 do CLAUDE.md adverte contra em espírito — "o endpoint quarenta não é
revisado com o cuidado do primeiro" aplica-se igualmente a "o critério de
aceite que só existe em prosa de ADR não é testado com o cuidado do que está
numerado em §6 do spec". Convertida em critério de aceite numerado.

## Consequências

- O ticket de G6 ganha, além dos 8 critérios já no spec §6, os critérios 9-13
  desta ADR como requisitos de teste, não como melhoria opcional.
- `apps/api/src/portal/` (quando nascer) precisa de `limite-do-portal.ts`
  (símbolo de injeção próprio), `tentativas_do_portal`/`sessoes_do_portal`
  como tabelas próprias, e `PortalGuard` no mesmo molde de `CarteiraGuard`/
  `PainelGuard`.
- A migration de `fir_portal` repete o boot-check de `0013_painel.sql`/
  `0025_carteira_fundacao.sql` linha por linha — não é um boot-check novo a
  desenhar, é cópia do padrão já provado.
- `teste/isolamento-de-clinica.test.ts` (ou um arquivo-irmão, ex.
  `teste/isolamento-do-portal.test.ts`) ganha os casos dos critérios 9-11,
  por mutação da função `app_portal_pode_ver` — mesma técnica já usada para
  `app_pode_ver_grupo`.
- `claude-security:scan` roda sobre `apps/api/src/portal/` quando o módulo
  nascer — mesma recomendação já feita para `apps/api/src/carteira/` nas
  ADRs 0012 e 0016.
- Nenhuma mudança é necessária no spec G6, na ADR 0017, nem no plano mestre —
  esta ADR formaliza requisitos adicionais de isolamento/autenticação sem
  contradizer nada do que já foi aceito; os arquivos de origem permanecem
  como estão.
