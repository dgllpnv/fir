# G5 — Rotina interna da equipe Firmare + funil de prospecção

- **Data:** 2026-11-05
- **Estado:** spec de produto, **pré-gate de risco**. Nenhuma linha de código.
  Precisa passar por `especialista-seguranca-appsec`, `especialista-lgpd-saude`
  e `validador-numeros` antes de `/to-tickets` — G5 é a primeira vez que o
  `Usuário de Gestão` **escreve** dado de negócio da carteira (G1a/G2/G4 só
  liam, com exceção de `criarGrupo`/`criarUsuarioDeGestao`, que são do
  `Operador`). Isso muda a superfície de risco e precisa ser revisado como tal.
- **Insumos:** `docs/superpowers/plans/2026-11-05-plano-integracao-firmare-gestao.md`
  (§3, §7, §9), ADRs 0011-0014, `CONTEXT.md` (seção "Carteira comercial da
  Firmare" e os verbetes `Tarefa`/`Jornada`/`Marcador de rotina`), migrations
  `0025`-`0030`, e leitura direta do protótipo da PO em
  `C:\Users\DAVI LOPES\Desktop\AURI PROJETOS\Firmare Gestão\index.html`
  (módulos `rotina`, `prospecção`, coleções `leads`, `tarefas`, `rotinas`,
  `checkins`).
- **O que este documento NÃO decide:** G3 (`metas`, `indicadores`,
  `lancamentos`, mensalidade) e G6 (portal do grupo) continuam seus próprios
  épicos. Onde G5 toca a borda de G3 (ver §4), a decisão é **adiar**, não
  antecipar a modelagem de dinheiro de G3 aqui.

---

## 0 · Por que o protótipo não é desempate direto aqui

CLAUDE.md manda abrir o protótipo e fazer o que ele faz. Para a **FIR Clinic**
(`prototipo-rotinas-de-gestao.html`) isso vale ao pé da letra. Para o
**Firmare Gestão** (a pasta `Firmare Gestão`, CRM interno da própria Firmare)
o grau de autoridade é menor, por uma razão que o próprio plano de integração
já registrou: aquele protótipo roda sobre uma tabela genérica Supabase
(`registros{colecao,id,data}`), sem RLS real, sem soft delete, sem `Dinheiro`
em centavos — é **material de referência de comportamento**, não a
especificação de schema. Onde o protótipo faz uma coisa que colide com as
regras inegociáveis deste repositório (regra 20, 26, 27), divergir não é
opcional: é a regra vencendo o protótipo, como already aconteceu para
`Movimento de estoque` (regra 20) e `Venda a prazo` (regra 3). Cada divergência
está marcada abaixo como tal.

---

## 1 · Vocabulário exato (entra em `CONTEXT.md` antes de qualquer migration)

| Termo | Definição |
|---|---|
| **`Lead comercial`** | Um prospect do funil de vendas B2B da Firmare — uma clínica ou médico ainda sem contrato. Vive em `leads_comerciais`. **Nunca** é um `Cliente Firmare`: tem campos que só fazem sentido antes do fechamento (`temperatura`, `origem`, `próximo_contato`) e nenhum dos que só fazem sentido depois (`status` de onboarding, mensalidade). |
| **`Etapa do lead`** | Uma das sete, na ordem do protótipo (autoridade de comportamento, não de schema): `novo` → `contato` → `reuniao` → `proposta` → `espera` (aguardando o prospect, não é regressão) → **`ganho`** (terminal) ou **`perdido`** (terminal, exige motivo). Só `ganho` cria um `Cliente Firmare`. |
| **`Conversão do lead`** | O evento que faz um `Lead comercial` em etapa `proposta`/`espera` virar `ganho` **e** cria uma linha nova em `clientes_carteira` (nunca reaproveita uma linha existente — regra 27, ver §6). Append na mesma transação: `leads_comerciais.etapa='ganho'`, `cliente_carteira_id` preenchido, `fechado_em` gravado. |
| **`Interação do lead`** | Um registro append-only de contato com o prospect (canal, nota, por quem, quando) — `interacoes_do_lead`. Nunca editável nem apagável; é o histórico que justifica "por que perdemos esse". |
| **`Tarefa interna`** | O item de rotina da **equipe Firmare** sobre a carteira — o análogo, para dentro, da `Tarefa` da FIR Clinic. Vive em `tarefas_internas`. Tem responsável (`Usuário de Gestão`), prazo, prioridade, status (`pendente`\|`concluida`\|`cancelada`) e, opcionalmente, um `cliente_carteira_id` ou `lead_comercial_id` ao qual se refere. **Nunca** anda por uma `Jornada` de nove etapas — esse maquinário existe para o agendamento clínico, não para "ligar para o cliente X". |
| **`Rotina interna`** | A definição recorrente que gera `tarefas_internas` sozinha — o análogo do **`Marcador de rotina`** já existente no domínio FIR, generalizado para a carteira. Vive em `rotinas_internas`: título, responsável padrão, frequência (`diaria`\|`semanal`\|`mensal`\|`vencimento`\|`reuniao`), parâmetros da frequência, **escopo de aplicação** (`global`\|`por_cliente`), passos (checklist), `ativa`. |
| **`Marcador de rotina interna`** | O mesmo mecanismo do domínio FIR (`tarefas.marcador`, CONTEXT.md), reaproveitado: toda `tarefa_interna` nascida de uma `rotina_interna` carrega `rotina_interna_id` + `prazo`, com `UNIQUE` entre as vivas — é o que torna a geração idempotente (rodar o job duas vezes não duplica a tarefa). Não é um conceito novo; é o mesmo conceito, outra tabela. |
| **`Checkin interno`** | **Decisão própria, com divergência assinalada do protótipo — ver §4.** O registro de que o ritual periódico de acompanhamento de um `Cliente Firmare` aconteceu: quando, por quem, nota, e uma leitura pontual de saúde do cliente. **Não** carrega valor numérico de meta — isso fica para G3 (ver §4). Vive em `checkins_internos`. |
| **`Saúde do cliente` (derivada)** | O status qualitativo (`bom`\|`atencao`\|`critico`) de um `Cliente Firmare`, lido do `checkin_interno` mais recente — nunca um campo solto em `clientes_carteira` que alguém edita direto. Mesma forma de "derivado, nunca campo mutável" (regra 11/5 aplicada aqui por analogia). |
| **`Escopo de aplicação`** (de uma rotina interna) | `global` — a rotina gera **uma** tarefa, sem cliente associado (ex.: "revisar backlog de leads da semana") — ou `por_cliente` — a rotina gera **uma tarefa por `Cliente Firmare` ativo** visível no grupo do responsável (ex.: "ligar para cliente que não loga há 10 dias"). |

---

## 2 · Modelo do funil

### 2.1 Nascimento do lead

Um `Lead comercial` nasce **sem `clinica_id` e sem `grupo_id` obrigatório** —
a maioria dos leads não pertence a grupo nenhum ainda (é um médico avulso, uma
indicação). **Exceção prevista:** um lead pode nascer já associado a um
`grupo_id` existente quando é expansão de uma rede já cliente (ex.: a
franquia X, já grupo, abre uma segunda unidade) — campo nullable, nunca
obrigatório.

Quem cria: **o `Usuário de Gestão`**, dentro do seu próprio escopo (se
`escopo=grupo` e o lead tem `grupo_id`, só pode ser o próprio grupo; se o lead
não tem grupo, qualquer `Usuário de Gestão` com `escopo=geral` ou
`escopo=grupo` — a prospecção avulsa não pertence a grupo nenhum ainda, então
não há cruzamento a proteger). Isto é diferente da regra do ADR 0011 "só o
Operador cria `Grupo`/`Usuário de Gestão`" — aquela regra é sobre **identidade
e tenancy**; `Lead comercial` é dado operacional do dia a dia da carteira, da
mesma família de `tarefas_internas`. Ver §5 e a pergunta 4 em §9 — isto
**amplia** quem escreve na carteira pela primeira vez, e é o ponto que o gate
de segurança precisa examinar com cuidado.

### 2.2 Avanço de etapa

`novo → contato → reuniao → proposta → espera` são passos livres (a tela deixa
escolher a etapa seguinte, como o protótipo faz — não é uma máquina de estados
rígida como a `Jornada` clínica, porque aqui não há um conjunto fechado de
transições de negócio tão crítico quanto "faltou"/"realizado"). `espera` é
"aguardando resposta do prospect com data de retomada", não uma regressão.

### 2.3 Fechamento — `ganho`

Ao marcar como `ganho`:

1. Cria **uma linha nova** em `clientes_carteira`, com `status='onboarding'`
   e **`clinica_id = NULL`** (ver §6 — é esta a mudança de schema que o
   fechamento do lead exige).
2. Grava `leads_comerciais.cliente_carteira_id` e `fechado_em`.
3. O lead **nunca é apagado** nem reaproveitado como a linha de cliente —
   são duas linhas, em duas tabelas, ligadas por FK. Reabrir o funil e fechar
   de novo um lead que já fechou é um erro de uso que o `CHECK`
   (`etapa='ganho' ⇒ cliente_carteira_id IS NOT NULL`, e o inverso) recusa.

### 2.4 Perda — `perdido`

Etapa terminal. **Diferente do protótipo**, que faz `DELETE` em
`editLead`/descarta o lead: aqui **nunca há exclusão física** (regra 20/27).

- `perdido` exige **motivo em texto livre, obrigatório** no momento da
  transição (mesmo UX do protótipo — `perderLead` já pede nota obrigatória).
  Decisão própria: **não** criar um catálogo de `Motivo de perda` como o que
  já existe para orçamento clínico (CONTEXT.md). Volume baixo (dezenas de
  leads por mês, não milhares de orçamentos), e um catálogo sem massa de dado
  para justificar agrupamento é campo que ninguém mantém. Reabre se o volume
  justificar.
- O protótipo tem um terceiro estado implícito — "perdido mas tentar de novo
  depois" vira `espera` com `proximo_contato` setado, nunca `perdido` de
  verdade. Mantido: é bom UX e não fere nenhuma regra.
- **"Excluir um lead" na tela vira "arquivar"**: `arquivado_em timestamptz`,
  nunca remove a linha. Diferente de `perdido` (que é um desfecho comercial
  real, com motivo e vira estatística do funil) — arquivar é "entrei isso
  errado" (duplicata, teste, lead de outra ferramenta). Um lead arquivado some
  da lista ativa e do funil, mas a linha e as interações continuam legíveis
  — mesma forma de `excluida_em` em `pessoas` (CONTEXT.md). **Esta é uma
  divergência deliberada do protótipo e fica registrada aqui como tal** (não
  precisa de ADR própria — é a aplicação direta da regra 20/27 já aceita,
  mas o dono deveria confirmar que concorda com o nome "arquivar" vs.
  "excluir" — ver pergunta 3 em §9).

---

## 3 · Rotina interna — reaproveitando `Tarefa`/`Jornada`, não inventando paralelo

**O que se reaproveita, ponto a ponto:**

| Conceito já existente no domínio FIR (CONTEXT.md) | Equivalente em G5 |
|---|---|
| `Tarefa` — qualquer item de rotina | `Tarefa interna` — mesma ideia, escopo "equipe Firmare sobre a carteira" em vez de "equipe da clínica sobre pacientes" |
| `Marcador de rotina` — rótulo que liga `Tarefa` à rotina que a criou, idempotente por `UNIQUE (clinica_id, marcador, prazo)` | `rotina_interna_id` em `tarefas_internas`, idempotente por `UNIQUE (rotina_interna_id, prazo, cliente_carteira_id)` nas tarefas vivas — mesmo mecanismo, chave estendida com `cliente_carteira_id` porque uma rotina `por_cliente` gera uma tarefa por cliente no mesmo prazo (o protótipo já faz isso: `UNIQUE (clinica_id, marcador, prazo)` vira `UNIQUE (rotina_interna_id, prazo, cliente_carteira_id)` com `cliente_carteira_id` podendo ser `NULL` para rotina `global`) |
| Geração de tarefa a partir de um gatilho, sem `if` espalhado (ex.: `Tarefa de reposição`, `Contato de retorno`) | Job diário (BullMQ) que materializa `tarefas_internas` a partir de `rotinas_internas` ativas, janela de 7 dias (vencimento/reunião: janela maior, como o protótipo já calcula) — **mesmo padrão dos jobs de G4** (`uso_diario_cliente`, `campanhas_carteira`): escreve fato, nunca recalcula na leitura |
| **`Tarefa` não anda por `Jornada` de nove etapas; é materializada, não derivada** (regra geral do domínio: sessão/contagem/retorno são linhas escritas, não states calculados on-the-fly) | `Tarefa interna` tem só três estados (`pendente`\|`concluida`\|`cancelada`) — **deliberadamente mais simples** que a `Jornada` clínica, porque não há um funil de nove etapas aqui; é checklist, não agendamento de paciente |
| `temPerm` — uma função só para decidir acesso | **Não se cria uma segunda matriz de permissão.** Ver §5 — a decisão de visibilidade usa a MESMA função `app_pode_ver_grupo` já escrita em G1a, sem extensão |

**O que explicitamente não se copia do protótipo:** o campo `frentes` (o
sub-checklist "4 frentes" de uma rotina específica do cliente de exemplo) e o
sistema de `mensagem`/template de WhatsApp acoplado à tarefa (`msg`,
`abrirMsg`). Isso é tooling de produtividade (atalho para abrir uma mensagem
pronta), não um ritual de gestão — fica fora de G5, pode voltar como feature
de UI sem mudança de schema quando houver `mensagens_comerciais` (G3/adjacente,
fora desta fatia).

---

## 4 · Checkin interno — por que ele diverge do protótipo

O protótipo liga `checkins` a `metas` (`meta_id`, `semana`, `valor`): é o
lançamento semanal de um número de KPI. **`metas`/`indicadores` são G3**, que
tem gate próprio de `Dinheiro` (mensalidade, mesmo princípio que vale para
qualquer valor numérico recorrente) e está deliberadamente fora desta fatia
(ADR 0013, plano §7).

**Decisão própria:** não replicar o `checkin` ligado a `meta_id` agora — isso
seria modelar uma tabela com uma FK para algo que não existe (`metas`), e
construir a tabela errada é mais caro que não construir. Em vez disso, G5
entrega um `checkin_interno` **qualitativo**: "fizemos o acompanhamento
periódico deste cliente esta semana, aqui está a nota e a leitura de saúde",
sem número de meta. Isso:

- é exatamente o ritual que `CLAUDE.md` pede para toda feature ("que ritual
  isso instala, e quem deixa de cobrar") — o ritual aqui é *"alguém olhou
  para este cliente esta semana"*, que é mais barato de medir do que *"o
  número da meta está certo"*, e já corta a maior parte do risco de cliente
  esquecido;
- não impede que G3, quando existir, **estenda** `checkin_interno` com um
  `meta_id` nullable e um `valor` em `Dinheiro`/inteiro — é uma coluna a mais,
  não uma tabela a refazer;
- evita number nu sem unidade declarada (`valor` do protótipo é texto livre,
  às vezes é `R$`, às vezes é percentual, dependendo de `TIPO_META` — exatamente
  o tipo de ambiguidade que este repositório proíbe para quantidade/dinheiro).

**Isto é uma divergência de escopo do protótipo**, não um detalhe de
implementação — fica marcada e levada ao dono como pergunta 1 em §9, porque
muda o que "checkins_internos" significa em relação ao que o plano original
(§3) prometia copiar.

`saude_cliente` (`bom`\|`atencao`\|`critico`) é lida do checkin mais recente
por cliente — nunca um campo em `clientes_carteira` que alguém edita direto
na ficha (evita a mesma classe de erro que levou a `Saldo em aberto` e
`Curva ABC` a serem sempre derivados, nunca campo).

---

## 5 · Permissão

**Decisão própria: nenhuma matriz de permissão nova.** A visibilidade de
`leads_comerciais`, `tarefas_internas`, `rotinas_internas` e
`checkins_internos` usa **exatamente** a mesma fronteira já construída em G1a:

- RLS por `grupo_id`, pela função `app_pode_ver_grupo(grupo_id)` já existente
  — reaproveitada sem alteração, inclusive para `grupo_id IS NULL` (uma linha
  sem grupo só é visível para `escopo='geral'`, porque
  `app_pode_ver_grupo(NULL)` já resolve isso: com `escopo='grupo'`,
  `NULL = app_grupo_id()` nunca é verdadeiro).
- **Dentro do próprio grupo, todo `Usuário de Gestão` vê todas as
  `tarefas_internas`/`rotinas_internas`/`checkins_internos` do grupo**,
  independente de quem é o `responsavel_id` — é o padrão `carteira: todos` que
  já é o default dos três perfis de exemplo do protótipo (`u2`, `u3`, `u4`
  todos têm `carteira:"todos"`). **"Minhas tarefas" é um filtro de tela
  (`responsavel_id = eu`), nunca uma fronteira de banco** — mesmo padrão do
  filtro "Para mim" que já existe na FIR Clinic (CONTEXT.md, Sessão de
  suporte: "`eu.usuario` é null nela... as telas que dependem de quem sou eu
  mostram vazio" é o mesmo espírito: conveniência de tela, nunca permissão).
- `escopo='geral'` continua sendo, na prática, o `Operador` operando a
  carteira — ele vê e pode agir sobre a rotina interna de **qualquer** grupo,
  o que é coerente com ele já enxergar tudo hoje.

**O que isto assume, e que o dono deve confirmar (pergunta 2, §9):** que
dentro de um mesmo grupo não há necessidade de esconder tarefa/lead de um
`Usuário de Gestão` do outro (ex.: duas account managers da mesma franquia
veem a carteira uma da outra). Isso é verdade para equipes pequenas (o caso
de hoje: Eduarda/Manu/Ana da Firmare), mas se a Firmare crescer a ponto de
times por grupo terem fronteiras internas, isso vira um bit novo
(`responsavel_exclusivo` ou algo do tipo) — **não construído agora**, porque
não há demanda demonstrada (mesma lógica que já fechou `Concessão de
consultoria`, ADR 0011).

**Escrita nova e primeira vez que isso acontece — flag para o gate:** até
aqui, `fir_carteira` só escrevia por ação do **Operador** (`criarGrupo`,
`criarUsuarioDeGestao`, `clientes_carteira` via painel). G5 é a primeira vez
que uma sessão de `Usuário de Gestão` propriamente dita (não o Operador atrás
dela) grava linha de negócio na carteira. Isso precisa que
`especialista-seguranca-appsec` confirme, no gate de G5: rate limit de
escrita por sessão, e que o `CHECK (escopo='grupo') = (grupo_id IS NOT NULL)`
mais a política de RLS realmente impedem um `Usuário de Gestão` de grupo A de
inserir uma linha com `grupo_id` de grupo B (teste de integração contra
Postgres real, mesmo padrão de `teste/isolamento-de-clinica.test.ts`).

---

## 6 · Impacto no schema de `clientes_carteira`

### 6.1 A decisão: tabela separada `leads_comerciais`, não `clinica_id` nullable sozinho resolvendo tudo

O enunciado da tarefa levanta duas alternativas. A resposta tem duas partes,
porque são duas perguntas diferentes:

**Pergunta A — "o lead é a mesma linha que o cliente, só num estágio
anterior?"** Não. `leads_comerciais` é uma tabela própria, por um motivo
estrutural, não де estilo: `Lead comercial` não tem `grupo_id` na imensa
maioria dos casos (é um prospect, ainda não pertence a grupo nenhum — o
próprio conceito de `Grupo` pressupõe que já existe pelo menos uma `Clinica`
real vinculada a ele), enquanto `clientes_carteira.grupo_id` é **`NOT NULL`**
desde a migration `0026`, por decisão da Rodada 2 do grilling (um `Cliente
Firmare`, mesmo sem clínica, já tem um grupo comercial — ainda que seja o
grupo singleton que nasce com ele). Colapsar as duas entidades exigiria ou (a)
tornar `grupo_id` nullable em `clientes_carteira` — o que destrói a garantia
que toda a RLS de G1a-G4 já assume (`app_pode_ver_grupo` sempre compara contra
um `grupo_id` presente para qualquer linha "de verdade") — ou (b) inventar um
grupo "placeholder" para todo lead, que é exatamente o padrão "clínica
sentinela"/"grupo GERAL" que a migration `0002` e a ADR 0011 já recusaram por
escrito. Nenhuma das duas é aceitável. Além disso os dois objetos têm forma
diferente de verdade (lead tem `temperatura`/`origem`/`interacoes`; cliente
tem `status` de onboarding, mensalidade) — a mesma razão que já levou este
repositório a manter `Pessoa` e `Ficha de pessoa` como tabelas separadas
mesmo sendo quase sempre 1:1 (CONTEXT.md).

**Pergunta B — "um `Cliente Firmare` pode nascer antes de ter uma `Clinica`
real?"** Sim, e **aqui** `clinica_id` precisa virar nullable — é exatamente o
caso que a migration `0026` já antecipava em comentário ("o estágio de lead
sem clínica é G5"). A migration nova:

```sql
ALTER TABLE clientes_carteira ALTER COLUMN clinica_id DROP NOT NULL;

ALTER TABLE clientes_carteira ADD CONSTRAINT clientes_carteira_onboarding_sem_clinica
  CHECK (status = 'onboarding' OR clinica_id IS NOT NULL);
```

Não se cria um status `'lead'` novo em `clientes_carteira.status` — o enum já
tem `'onboarding'`, que já significa exatamente "contrato fechado, ainda
preparando a entrada" — reaproveitado, não um quinto estado. O `UNIQUE` em
`clinica_id` continua válido (Postgres permite múltiplos `NULL` num índice
único — múltiplos clientes em onboarding sem clínica ainda não colidem entre
si).

### 6.2 A consequência que isso quebra, e como resolver

`clientes_carteira` tem hoje um trigger genérico (`registrar_auditoria()`,
migration `0026`) que deriva `auditoria.clinica_id` direto de
`NEW.clinica_id`/`OLD.clinica_id`. Com `clinica_id` nullable, **um `INSERT`
de cliente em onboarding (lead recém-convertido, sem clínica) tentaria gravar
`auditoria.clinica_id = NULL`** — e `auditoria.clinica_id` é `NOT NULL` desde
a migration `0002` (a clínica sentinela foi recusada por escrito
precisamente para que essa coluna nunca precisasse aceitar nulo). **O
`INSERT` falharia em produção, silenciosamente só até o primeiro lead
fechado** — exatamente o tipo de defeito que `docs/dividas.md` registra como
"morde no primeiro deploy".

A correção, a fazer na mesma migration que relaxa `clinica_id`:
substituir o trigger genérico em `clientes_carteira` por uma função própria
(`registrar_auditoria_carteira()`, ou estender a existente com um `CASE`) que
grava em `auditoria` **quando `clinica_id IS NOT NULL`**, e em
`auditoria_do_painel` (ator `usuario_gestao:<uuid>`) **quando `clinica_id IS
NULL`** — mesmo padrão que `criarGrupo`/`criarUsuarioDeGestao` já usam para
tabelas sem `clinica_id` nenhum (migration `0030`). As novas tabelas de G5
(`leads_comerciais`, `tarefas_internas`, `rotinas_internas`,
`checkins_internos`) **nunca têm `clinica_id`** — todas vão para
`auditoria_do_painel` desde o início, sem ambiguidade, pelo mesmo caminho.

**Teste de aceite para isto (vai para o ticket, não é opcional):** criar um
`Cliente Firmare` com `clinica_id = NULL`, confirmar que uma linha aparece em
`auditoria_do_painel` e nenhuma tentativa de `INSERT` em `auditoria` com
`clinica_id NULL` é sequer emitida; depois, preencher `clinica_id` (onboarding
concluído) e confirmar que a trilha muda de tabela de forma coerente (a
pergunta "quem viu isto antes de virar uma clínica" responde pela
`auditoria_do_painel`; "quem mexeu nisto depois" responde pela `auditoria` da
clínica).

### 6.3 Nunca recriar o que foi apagado (regra 27), aplicado aqui

Um `Lead comercial` **arquivado** (§2.4) nunca gera, ao ser "desarquivado",
uma segunda linha em `clientes_carteira` nem reabre uma conversão antiga —
desarquivar um lead só reabilita o registro de prospecção; se ele **já**
converteu (`cliente_carteira_id IS NOT NULL`), desarquivar é bloqueado pelo
`CHECK` descrito em §2.3 (`etapa='ganho'` é terminal de verdade). Isso fecha o
caso que a regra 27 existe para evitar: reimportar/reabrir um lead não pode
recriar um cliente que já existe.

---

## 7 · Tabelas novas — resumo de forma (para a migration, não é a migration)

Todas: `grupo_id uuid NULL REFERENCES grupos(id)` (exceto `clientes_carteira`,
já existente), RLS por `app_pode_ver_grupo(grupo_id)`, `REVOKE ALL ... FROM
fir_app`, `GRANT SELECT, INSERT, UPDATE ... TO fir_carteira`, append-only onde
marcado, auditoria via `auditoria_do_painel` (§6.2).

| Tabela | Campos centrais | Append-only? |
|---|---|---|
| `leads_comerciais` | `nome`, `grupo_id` (nullable), `responsavel_usuario_gestao_id`, `origem`, `etapa` (`CHECK IN (...)`), `temperatura`, `produto_interesse`, `proximo_contato` (date, nullable), `cliente_carteira_id` (nullable, preenchido só em `ganho`), `motivo_perda` (nullable, obrigatório quando `etapa='perdido'`), `fechado_em`, `arquivado_em` (nullable, soft) | Não (mas nunca `DELETE` de verdade) |
| `interacoes_do_lead` | `lead_comercial_id`, `quando`, `canal`, `nota`, `por_usuario_gestao_id` | **Sim** |
| `rotinas_internas` | `titulo`, `responsavel_usuario_gestao_id`, `grupo_id` (nullable — `NULL` = rotina da própria Firmare, não de um grupo específico), `frequencia`, parâmetros de frequência, `escopo_aplicacao` (`global`\|`por_cliente`), `passos` (array de texto), `ativa` | Não (é cadastro, editável) |
| `tarefas_internas` | `titulo`, `descricao`, `responsavel_usuario_gestao_id`, `grupo_id` (nullable), `cliente_carteira_id` (nullable), `lead_comercial_id` (nullable), `prazo`, `prioridade`, `status` (`pendente`\|`concluida`\|`cancelada`), `concluida_em`, `rotina_interna_id` (nullable — presente só quando nasceu de uma rotina) | Não |
| `checkins_internos` | `cliente_carteira_id`, `semana` (ISO), `nota`, `saude_cliente`, `por_usuario_gestao_id`, `rotina_interna_id` (nullable) | Sim, por semana/cliente (`UNIQUE (cliente_carteira_id, semana)`, update só até o fim daquela semana) |

**Índice de idempotência da geração de tarefa:** `UNIQUE
(rotina_interna_id, prazo, cliente_carteira_id) WHERE status NOT IN
('concluida','cancelada')` nas `tarefas_internas` — o job de geração faz
`INSERT ... ON CONFLICT DO NOTHING`, mesma forma de `Marcador de rotina`.

---

## 8 · O que fica explicitamente de fora de G5

- **`metas`, `indicadores`, `lancamentos`, mensalidade** — G3, com seu próprio
  gate de `Dinheiro`. `checkin_interno` fica pronto para ganhar `meta_id`
  depois, sem refação de tabela (§4).
- **`roteiros_comerciais`, `mensagens_comerciais`** — scripts de abordagem e
  templates de WhatsApp. Ferramenta de produtividade, não ritual de gestão;
  G5 entrega o ritual (lead existe, tarefa existe, alguém é responsável);
  o atalho de "abrir mensagem pronta" é UI de cima, sem mudança de schema.
- **`beneficios`** (recompensa de indicação, liga lead a cliente indicador) —
  é dinheiro/desconto (mensalidade), cai na mesma cerca de G3.
- **Portal do grupo lendo o próprio funil/rotina** (G6) — fora do primeiro
  corte por decisão já tomada (Q6 do plano), hoje revertida para "sim, no
  escopo completo" (decisão 3b, §9 do plano) mas ainda **depois** de G5.
- **Catálogo de motivo de perda de lead** — decisão própria de não construir
  agora (§2.4); texto livre basta no volume atual.
- **Segunda fronteira de permissão dentro do grupo** (um `Usuário de Gestão`
  escondendo tarefa do outro) — sem demanda demonstrada (§5).
- **MFA para `Usuário de Gestão`** — já decidido fora de escopo (decisão 1,
  §9 do plano); G5 não reabre isso, só herda o risco já aceito e registrado.

---

## 9 · Critérios de aceite testáveis (para os tickets, quando G5 passar no gate)

1. Criar um lead sem grupo → aparece no funil do `Usuário de Gestão` que
   criou e de qualquer outro com `escopo='geral'`; **não** aparece para um
   `Usuário de Gestão` de `escopo='grupo'` de um grupo diferente do dele (se
   o lead tiver `grupo_id`) — prova por teste de integração com Postgres
   real, duas sessões, dois grupos.
2. Marcar um lead como `ganho` cria exatamente uma linha em
   `clientes_carteira`, com `clinica_id NULL` e `status='onboarding'`; rodar
   a mesma conversão duas vezes (dois cliques, mesma requisição em dobro) não
   cria uma segunda linha — idempotência pela mesma disciplina da regra 26
   (chave: `leads_comerciais.id`, `UNIQUE` em `cliente_carteira_id` quando
   preenchido, ou checagem "lead já convertido" no servidor).
3. Marcar um lead como `perdido` sem motivo é recusado pelo servidor (não só
   pela tela).
4. "Arquivar" um lead não remove a linha do banco (consulta direta ainda
   acha a linha, com `arquivado_em` preenchido); arquivar um lead já
   convertido (`cliente_carteira_id IS NOT NULL`) é recusado.
5. Uma `rotina_interna` com `escopo_aplicacao='por_cliente'` e `ativa=true`
   gera, no dia seguinte, uma `tarefa_interna` para cada `Cliente Firmare`
   ativo visível no grupo do responsável, com `rotina_interna_id` e `prazo`
   preenchidos; rodar o job duas vezes no mesmo dia não duplica nenhuma.
6. Criar um `Cliente Firmare` com `clinica_id = NULL` grava a trilha em
   `auditoria_do_painel` e **nunca** tenta um `INSERT` em `auditoria` com
   `clinica_id` nulo (ver §6.2) — medido direto no banco, não só pela
   ausência de erro 500.
7. Um `checkin_interno` da semana corrente pode ser editado; da semana
   anterior, recusado pelo servidor (a mesma disciplina de "um fechamento por
   dia" do Caixa, aplicada à semana aqui).

---

## 10 · Decisões tomadas sozinho (com a lógica de produto e os ADRs já aceitos)

1. `leads_comerciais` é tabela própria, não uma extensão nullable de
   `clientes_carteira` — motivo estrutural (grupo_id), não estético (§6.1).
2. `clientes_carteira.clinica_id` vira nullable, com `CHECK` amarrado a
   `status='onboarding'`, reaproveitando o enum existente — sem quinto
   status novo (§6.1).
3. A trilha de `clientes_carteira` precisa de uma função de auditoria
   própria (redirecionando para `auditoria_do_painel` quando `clinica_id` é
   nulo) — sem isso, o primeiro lead fechado em produção quebra o `INSERT`
   (§6.2). Isto é uma correção técnica necessária, não uma preferência.
4. Nenhuma tabela nova de G5 tem `clinica_id` — todas auditam via
   `auditoria_do_painel`, como `grupos`/`usuarios_gestao` já fazem.
5. Sem matriz de permissão nova: reaproveita `app_pode_ver_grupo`
   integralmente; "minhas tarefas" é filtro de tela, nunca fronteira de
   banco (§5).
6. Sem catálogo de motivo de perda de lead agora — texto livre (§2.4).
7. `Marcador de rotina interna` reaproveita a mesma forma (idempotência por
   `UNIQUE`) do `Marcador de rotina` já existente no domínio FIR — não um
   mecanismo paralelo (§3).
8. `Tarefa interna` tem só três estados, sem `Jornada` de nove etapas — a
   `Jornada` é desenhada para o funil clínico, não para checklist interno
   (§3).
9. Leads e tarefas internas nunca são fisicamente excluídos — "excluir" na
   tela é "arquivar"/estado, por regra 20/27, mesmo o protótipo fazendo
   `DELETE` de verdade (§2.4, §6.3) — divergência explícita, mas coberta
   pela regra já aceita, não nova decisão de produto que precisa de ADR
   própria.

---

## 11 · Perguntas para o dono (numeradas, com recomendação)

1. **`checkin_interno` sem número de meta (qualitativo) para esta fatia, só
   ganhando `meta_id`/`valor` quando G3 existir — está certo manter o escopo
   assim, mesmo divergindo do que o plano original (§3) prometia copiar do
   protótipo (`checkins` ligado a `meta_id` desde já)?**
   **Recomendação:** sim, manter qualitativo agora. Construir a FK para uma
   tabela que não existe (`metas`) seria desenhar o schema errado; o ritual
   "olhamos para este cliente esta semana" já entrega valor sozinho, e a
   extensão é aditiva (uma coluna a mais), não uma refação.

2. **Dentro de um grupo, todo `Usuário de Gestão` vê a rotina interna de
   todo mundo (sem fronteira por responsável) — confirma que é esse o
   comportamento desejado, mesmo quando a equipe crescer?**
   **Recomendação:** sim para agora (reflete o padrão `carteira: todos` já
   presente no protótipo para as três colaboradoras de exemplo). Se um dia
   times por grupo precisarem de paredes internas, isso é um campo novo
   depois — sem custo de retrabalho de schema para adiar.

3. **"Excluir lead" vira "arquivar" (nunca `DELETE` de verdade) — a palavra
   na tela deve ser "Arquivar" (deixa claro que não é descarte) ou manter
   "Excluir" na UI e só diferenciar por baixo?**
   **Recomendação:** "Arquivar" na tela, para não prometer uma exclusão que
   não acontece — mesmo espírito de "Inativar" vs. "Excluir de vez" já usado
   para `Pessoa`.

4. **`Lead comercial` pode ser criado por qualquer `Usuário de Gestão`
   (dentro do próprio escopo), não só pelo `Operador` — isto amplia o que o
   ADR 0011 havia fechado ("só o Operador cria e atribui coisas na
   carteira"). Essa regra do ADR 0011 era sobre identidade/tenancy (`Grupo`,
   `Usuário de Gestão`) ou sobre toda escrita na carteira?**
   **Recomendação:** era sobre identidade/tenancy — a leitura literal do
   texto da ADR 0011 (item 2) fala de "criar e atribuir `Usuário de
   Gestão`", nunca de "toda escrita futura na carteira". `Lead
   comercial`/`Tarefa interna` são dado operacional do dia a dia, da mesma
   família que já se esperava que o `Usuário de Gestão` manipulasse (é o
   próprio motivo de ele existir). Recomendo registrar isto como uma
   **emenda textual curta à ADR 0011** (não uma nova ADR), deixando
   explícito que "só o Operador cria" se aplica a `Grupo` e `Usuário de
   Gestão`, nunca a `Lead comercial`/`Cliente Firmare`/rotina interna.

5. **Quando um lead fecha (`ganho`), o `Cliente Firmare` nasce com
   `status='onboarding'` e `clinica_id=NULL` — quem efetivamente provisiona
   a `Clinica` real depois (preenche `clinica_id`) continua sendo só o
   `Operador`, como já é hoje?**
   **Recomendação:** sim — provisionar uma `Clinica` de verdade (criar o
   tenant, RLS, a primeira administradora) é ação de infraestrutura/
   identidade, categoricamente diferente de "fechei uma venda". Mantém a
   régua clara: vendas fecham negócio (escreve `clientes_carteira`); o
   Operador provisiona o tenant (escreve `clinica_id`). Nenhuma mudança de
   schema nova é necessária para isso — já é assim que o painel do Operador
   funciona hoje para criar clínica.
