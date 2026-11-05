# G6 — Spec de produto: Portal do Grupo

- **Data:** 2026-11-05
- **Fase:** spec de produto, **antes** do gate de risco. Nenhum ticket, nenhuma
  migration, nenhum código.
- **Insumos:** `docs/superpowers/plans/2026-11-05-plano-integracao-firmare-gestao.md`
  (§1.5 Q6/decisão 3b do dono, §3, §7, §9), ADRs 0011, 0012, 0013 (0014-0016
  tocam G3/G5, lidos só para não contradizer), `CONTEXT.md` ("Carteira comercial
  da Firmare"), `docs/compliance/retencao.md`, e leitura direta do protótipo em
  `C:\Users\DAVI LOPES\Desktop\AURI PROJETOS\Firmare Gestão\fg-portal.js` e
  `fg-supabase.js` (não o `prototipo-rotinas-de-gestao.html` deste repositório,
  que não tem conceito de carteira — mesma ressalva que G3/G5 já registraram).
- **O que este documento NÃO decide:** G3 (`metas`, `indicadores`, `lancamentos`,
  `Cobrança do Cliente Firmare`) e G5 (`leads_comerciais`, `tarefas_internas`,
  `rotinas_internas`, `checkins_internos`) são épicos próprios, em construção em
  paralelo. G6 **consome** o que eles produzem; não reabre a modelagem deles.

---

## 0 · O achado que muda o enquadramento de G6

**O protótipo não tem portal de grupo — e isso não é uma lacuna a preencher
por analogia, é informação.** `fg-portal.js` e `acessos_cliente`
(`fg-supabase.js:248-257`) mostram, lidos na fonte:

- Um acesso de portal é **sempre `{user_id, cliente_id}`** — uma conta, uma
  linha de `clientes`. Não existe, em lugar nenhum do código, um acesso
  keyed por "rede" ou "grupo".
- **O portal não lê dado operacional da clínica.** Os quatro links que ele
  mostra (`link_painel`, `link_dash_ind`, `link_dash_fin`, `link_rotina`) são
  **URLs abertas em nova aba** (`index.html` / `fg-portal.js:116-117`,
  `target="_blank"`) — o portal nunca busca paciente, receita ou tarefa da
  clínica em si. Tudo que ele renderiza por conta própria é dado que a
  **Firmare já produziu sobre a clínica**: `metas`/`checkins` (definidos pela
  equipe Firmare), `materiais` (biblioteca Firmare), `documentos` (links do
  Drive cadastrados pela Firmare), `reunioes` (atas da Firmare). Nada ali é
  lido direto de uma tabela operacional de paciente, dose ou caixa.

**Consequência direta para a pergunta que a tarefa levanta** ("ele pode ver
dado clínico agregado, tipo 'total de pacientes atendidos em todas as minhas
clínicas'?"): **o protótipo nunca faz isso, nem para uma clínica, nem para
várias.** Construir esse agregado para o Grupo seria inventar uma categoria de
dado que não existe nem na versão de uma clínica só — não é "generalizar o que
já existe", é **escopo novo**, sem autoridade do protótipo, cruzando pela
primeira vez a fronteira de `clinica_id` com dado derivado de ficha de
paciente para um ator do **lado do cliente**. Fica fora de G6 — ver §3 e a
pergunta 3 em §8.

**O que efetivamente generaliza para "grupo" é o que o protótipo já mostra por
clínica:** ciclo de contrato, metas comerciais (G3), campanhas (G4),
materiais, documentos, reuniões, e os mesmos quatro links — **um conjunto
disso por clínica do grupo**, nunca um número único somado escondendo de qual
clínica veio (mesma regra 6/ADR 0013 §6 já aplicada a `campanhas_carteira` e a
`lancamentos`).

**Achado colateral de escopo:** `documentos`, `materiais` e `reunioes` (plano
§3, linhas "Resolvido") **não pertencem a nenhum épico hoje.** G3 não os
contempla (só `metas`/`indicadores`/`lancamentos`/cobrança); G5 explicitamente
não os contempla (`roteiros_comerciais`/`mensagens_comerciais` ficam de fora,
e documentos/materiais/reuniões nem aparecem no escopo). Como G6 é o primeiro
e único consumidor dessas três entidades, **G6 herda a responsabilidade de
modelá-las e dar à equipe Firmare como escrevê-las** (lado `Usuário de
Gestão`), além de exibi-las (lado portal) — ver §5.

---

## 1 · A pergunta de identidade, respondida

### 1.1 Não é uma quarta extensão de ator existente

Três candidatos descartados, pela mesma lógica que a ADR 0011 já usou duas
vezes:

- **Estender `Pessoa`** com uma permissão `grupo.ver` que atravessa para
  outras clínicas. Rejeitado: `Pessoa` é, por desenho, **uma sessão, uma
  `clinica_id`** (regra 19 — toda tabela de negócio filtra por um valor só de
  `clinica_id`). Dar a uma `Pessoa` o poder de ler várias clínicas misturaria,
  na mesma sessão, duas formas de autorização — exatamente o erro que a ADR
  0011 já apontou e rejeitou para "`Usuário de Gestão` como extensão de
  `Operador` com um `grupo_id` filtrante". O argumento se aplica aqui ponto a
  ponto, só trocando o ator.
- **Reaproveitar `Usuário de Gestão`.** Rejeitado por definição: `Usuário de
  Gestão` é o ator **da Firmare**, nunca do cliente (ADR 0011 §2, CONTEXT.md
  "Carteira comercial"). Misturar as duas audiências na mesma tabela repete o
  erro que a ADR 0011 já evitou ao separar a tela de criar `Pessoa` da de
  criar `Usuário de Gestão`.
- **Um acesso por `cliente_id` só (como hoje no protótipo), e "ver o grupo" é
  o front-end abrindo N abas, uma por cliente, sem conta nova.** Rejeitado:
  não resolve o pedido do dono — ele quer **um login só** vendo as clínicas
  do grupo, não uma senha por unidade da rede. Também não dá como auditar
  "quem do lado do cliente olhou o quê" como um ator único (regra 18/20).

### 1.2 Decisão: ator novo, tabela própria, com `Escopo` — mesma forma de `Usuário de Gestão`, do lado do cliente

**`Usuário do portal`** (nome provisório — ver pergunta 1, §8): o ator que uma
pessoa do lado do **Cliente Firmare** usa para entrar no seu espaço read-only.
Tabela própria `usuarios_do_portal`. Nem `Pessoa`, nem `Operador`, nem
`Usuário de Gestão` — um quarto espaço de identidade, pela mesma razão que
justificou o terceiro: misturar autorização de audiências diferentes no mesmo
ator é o erro já evitado duas vezes neste produto.

Tem `Escopo`, reaproveitando a **forma** (não a tabela) de `Usuário de
Gestão`:

| `Escopo` | Vê | Quando existe |
|---|---|---|
| `cliente` | Um `Cliente Firmare` só (`cliente_carteira_id NOT NULL`) — equivalente exato ao `acessos_cliente` do protótipo hoje | Clínica avulsa, sem grupo relevante para o login (mesmo se a `Clinica` pertencer tecnicamente a um grupo singleton, regra já existente desde G1a) |
| `grupo` | Todos os `Cliente Firmare` do `Grupo` (`grupo_id NOT NULL`) | Dono/gestor de rede — é este o caso que a tarefa chama de "Portal do Grupo" |

**Não existe `escopo = 'geral'` para `Usuário do portal`.** Diferente de
`Usuário de Gestão`, não há um "ver tudo" do lado do cliente — ninguém do
lado de fora da Firmare enxerga a carteira inteira. `CHECK` análogo ao de
`usuarios_gestao`: exatamente um de `cliente_carteira_id`/`grupo_id`
preenchido, nunca os dois, nunca nenhum.

Sessão própria: cookie `__Host-fir-portal`, guard próprio (`PortalGuard`),
papel de banco próprio (`fir_portal`), mesmo boot-check de `fir_carteira`/
`fir_painel` (ADR 0012 §2: recusa se `BYPASSRLS`/`SUPERUSER`/`CREATEROLE`).
Mesmo padrão de senha do resto do produto (Argon2, limite de tentativas,
**sem MFA** — mesma decisão e mesmo risco aceito e registrado do plano §9
item 1, que já cobre a assimetria de não ter allowlist de IP).

### 1.3 Quem cria `Usuário do portal`

Decisão **com recomendação tiered por risco** (não decidida sozinha para o
caso de maior risco — ver pergunta 2, §8):

- `escopo = 'cliente'` (vê uma clínica só — o caso de risco igual ao que já
  existe hoje no protótipo): pode ser criado pelo `Usuário de Gestão`
  responsável por aquele `Cliente Firmare`, dentro do próprio grupo/escopo —
  mesmo espírito do botão "Criar acesso" do protótipo (`fg-supabase.js:228`),
  sempre com senha provisória gerada pela ferramenta, nunca escolhida pelo
  cliente no primeiro acesso.
- `escopo = 'grupo'` (vê várias clínicas de uma vez — risco estruturalmente
  maior, primeira vez que um ator do lado do cliente lê mais de uma clínica
  numa sessão só): **só o `Operador`**, mesmo ponto de entrada único que a
  ADR 0011 já fixou para `Grupo`/`Usuário de Gestão`, pela mesma razão
  (fecha, sem esforço extra, a exigência de concessão registrada da P-12,
  agora estendida a este ator).

**Nunca autoatendimento/convite**: nenhuma tela permite que um `Usuário do
portal` crie outro, de nenhum escopo — mesma régua já fixada para `Usuário de
Gestão` (ADR 0011 §2).

---

## 2 · Onde isso mora no RLS — a resposta à pergunta técnica da tarefa

A tarefa pergunta, com razão, se isto exige "um novo tipo de política RLS" ou
se lê "através de uma camada de agregação que já roda com `app_pode_ver_grupo`,
nunca direto nas tabelas por `clinica_id`". **A resposta depende de qual dado**
— e por isso o escopo de G6 se divide em dois (ver §3):

### 2.1 Dado da carteira (metas, campanhas, cobrança, documentos, materiais, reuniões) — reaproveita o que já existe, sem política nova

Essas tabelas (`clientes_carteira`, `campanhas_carteira`, as de G3, e as três
novas de G6 — `documentos_carteira`, `materiais_carteira`, `reunioes_comerciais`)
**já têm `grupo_id`** (denormalizado, mesmo padrão de ADR 0012) e já são
protegidas por `app_pode_ver_grupo(grupo_id)`. A única coisa nova é uma
**segunda função**, para o ator novo, com a mesma forma:

```sql
CREATE FUNCTION app_portal_grupo_id() RETURNS uuid ...  -- igual a app_grupo_id()
CREATE FUNCTION app_portal_cliente_id() RETURNS uuid ...  -- novo: nullable, só quando escopo='cliente'

CREATE FUNCTION app_portal_pode_ver(g uuid, c uuid) RETURNS boolean
  LANGUAGE sql STABLE AS $$
    SELECT app_portal_cliente_id() IS NULL
      THEN g = app_portal_grupo_id()          -- escopo grupo
      ELSE c = app_portal_cliente_id()         -- escopo cliente, mais estreito que o grupo
  $$;
```

Mesma política por função, nunca `OR` na cláusula (ADR 0012, emenda já
testada por mutação em `teste/isolamento-de-clinica.test.ts`), mesmo papel
sem `BYPASSRLS`. **Isto não é política nova em espécie — é a mesma forma da
ADR 0012, uma função a mais**, porque o ator é novo mas a tenancy (`grupo_id`)
é a mesma coluna já existente.

### 2.2 Dado operacional da própria clínica (financeiro, paciente, tarefa) — NÃO existe hoje no portal, e não é uma política RLS que resolve

Se um dia o Portal do Grupo precisar mostrar algo derivado das tabelas
**operacionais** da FIR Clinic (não as da carteira) — ex.: "receita total
deste mês, por clínica" lida de `CampanhasModule`/financeiro em vez de um fato
já sincronizado —, a arquitetura correta **não é uma política de RLS que
aceita vários `clinica_id`** (isso repetiria o erro já descartado pela ADR
0012 para o `Usuário de Gestão` — veja lá "Política de múltiplos valores...
rejeitada"). A forma já estabelecida nesta carteira é: **um job escreve o fato
agregado por clínica numa tabela da carteira** (como `uso_diario_cliente` já
faz), e o portal lê **isso**, nunca a tabela operacional direto. Nenhuma
leitura, de nenhum ator, cruza `clinica_id` dentro de uma única consulta SQL —
cada leitura operacional continua presa a um valor de `clinica_id` por vez
(regra 19 ao pé da letra), e "ver várias clínicas" é sempre "ver várias linhas
de fato já agregado", nunca "uma query que varre várias clínicas".

**Na prática, para a fatia que G6 constrói agora (§3), isto é só um
registro de arquitetura, não uma entrega**: nenhum dos dados do portal (metas,
campanhas, cobrança, materiais, documentos, reuniões) exige essa leitura
operacional — todos já chegam pela carteira, pelos jobs que G4/G3 já
desenham. Fica escrito aqui porque a tarefa pediu para investigar, e porque é
o que impede alguém de "simplificar" no futuro com uma política RLS que
aceita uma lista de clínicas.

### 2.3 Registro de acesso (regra 18/20, estendido a um quarto `ator_tipo`)

Mesmo mecanismo de ADR 0013 §7: toda leitura do `Usuário do portal` grava uma
linha de acesso **por `Cliente Firmare`/clínica incluída na resposta**, na
`auditoria`/`auditoria_do_painel` daquela clínica, `ator_tipo = 'usuario_portal'`
(quarto valor, ao lado de `pessoa`, `operador`, `usuario_gestao`). Um
`Usuário do portal` de escopo `grupo` lendo 5 clínicas de uma vez grava 5
linhas, uma por clínica — não uma linha "grupo" solta, porque é a clínica,
individualmente, que tem o direito de saber quem olhou o que é dela (mesmo
raciocínio já usado para `campanhas_carteira`/regra 6: nunca esconder de qual
clínica veio).

---

## 3 · O que o Portal do Grupo mostra — dividido por risco

### 3.1 G6 núcleo (constrói agora — mesma autoridade do protótipo, mesmo risco já aceito para a carteira)

Para cada `Cliente Firmare` visível ao `Usuário do portal` (um, se
`escopo='cliente'`; todos do grupo, se `escopo='grupo'`), **uma seção
própria**, nunca um total único escondendo a origem:

1. **Ciclo do contrato** — mesma lógica de `fg-portal.js:104-113` (mês N de
   M, ou "Nº mês juntos"), por clínica.
2. **Metas comerciais do cliente** (G3) — cartões por indicador, progresso
   derivado (nunca campo mutável — já decidido em G3 §2.1 item 4), por
   clínica.
3. **Campanha da carteira** (G4/ADR 0011 §3) — mesma regra de N mínimo e
   "Outras campanhas" (ADR 0013 §4), por clínica; soma do grupo, se exibida,
   é sempre a soma explícita das linhas visíveis (ADR 0013 §6).
4. **Cobrança do Cliente Firmare** (G3) — o que a própria clínica deve/pagou à
   Firmare; por clínica, soma do grupo sempre explícita (ADR 0013 §8, critério
   10 de G3 já escreve exatamente isto: "nunca um total só").
5. **Materiais** e **Documentos** — biblioteca e links por programa/cliente,
   tabelas novas que G6 herda de modelar (ver §5).
6. **Reuniões** — atas e encaminhamentos, tabela nova que G6 herda de
   modelar (ver §5).
7. **Os quatro links de acesso** (`link_painel`, `link_dash_ind`,
   `link_dash_fin`, `link_rotina`) — preservados do protótipo, **sempre URL
   externa aberta em nova aba**, nunca dado buscado pelo portal. O link
   "FIR Clinic" abre a instância daquela clínica; o login lá dentro continua
   sendo o `Pessoa` de cada clínica, nunca o `Usuário do portal` — são sessões
   e autorizações **inteiramente separadas**, de propósito (regra 19: a FIR
   Clinic de uma unidade nunca aceita a sessão do portal do grupo como
   credencial).

**Redação de valores (regra 17), estendida a este ator:** `Usuário do portal`
só recebe `valor_centavos` de `Cobrança`/`Indicador unidade=R$`/
`Meta.valor_meta` monetária se tiver a permissão equivalente — proposta:
**sempre tem**, porque é o próprio dinheiro dela (ela é a titular da cobrança,
não uma funcionária de terceiros). Diferente da redação dentro da clínica
(onde `valores` esconde salário de colega), aqui não há "colega" cujo dado
precise ser escondido do titular. Fica registrado como decisão própria, não
pergunta — mas sinalizada à parte em §8, pergunta 4, porque envolve dinheiro
real e por isso cabe conferência de `validador-numeros` no gate, não só minha
leitura.

### 3.2 Fora de G6 núcleo — fica para quando houver pedido real e revisão de LGPD

- **Qualquer agregado derivado de dado operacional/clínico da própria FIR
  Clinic** (total de pacientes atendidos, receita operacional da clínica,
  tarefas concluídas) **cruzando `clinica_id` para o lado do cliente.** O
  protótipo nunca fez isso nem para uma clínica (§0) — é escopo novo, não
  generalização. Precisa de: (a) confirmação de que todas as clínicas de um
  `Grupo` são sempre a mesma titularidade/controladora de dado (ver pergunta
  3, §8 — decisivo para saber se isto é "a dona vendo o próprio negócio" ou
  "dado cruzando duas controladoras distintas"), e (b) avaliação própria de
  `especialista-lgpd-saude`, **não decidida aqui**, mesma régua que já
  manteve `Concessão de consultoria` fechada (ADR 0011 §1) até pedido real.
- **Edição de qualquer coisa pelo `Usuário do portal`.** O portal é read-only
  de ponta a ponta, como o protótipo já é (`fg-portal.js` não tem nenhum
  formulário de escrita, só "copiar texto" e abrir link). Nenhuma ação de
  escrita nasce aqui.
- **Comparação entre clínicas do grupo** (ranking, "sua unidade X está acima
  da média do grupo"). Nada no protótipo sugere isso, e é uma feature de
  análise, não um ritual — fica para pedido futuro.
- **Troca de senha self-service sem fluxo de primeiro acesso.** Mantém o
  padrão do protótipo (`fg-supabase.js:62`, senha provisória → troca
  obrigatória no primeiro login) — detalhe de ticket, não decisão nova.

---

## 4 · Vocabulário (para `CONTEXT.md`)

| Termo | Definição | Não confundir com |
|---|---|---|
| **`Usuário do portal`** | Ator read-only do lado do **Cliente Firmare**, com `Escopo` `cliente` (uma clínica) ou `grupo` (todas as do `Grupo`). Tabela própria `usuarios_do_portal`, cookie `__Host-fir-portal` | `Usuário de Gestão` (ator interno da Firmare) · `Pessoa` (funcionária de uma clínica, sessão operacional) |
| **`Portal do Grupo`** | A tela que um `Usuário do portal` de `Escopo = grupo` vê: uma seção por `Cliente Firmare` do grupo (metas, campanhas, cobrança, materiais, documentos, reuniões, links) — nunca um total único colapsado | O painel do `Usuário de Gestão` (visão da Firmare sobre a carteira) · o FIR Clinic de cada unidade (sistema operacional, login de `Pessoa`) |
| **`Documento da carteira`** (tabela nova, `documentos_carteira`) | Link (tipicamente Drive) cadastrado pela equipe Firmare sobre um `Cliente Firmare`, categorizado, com visibilidade no portal controlada por flag | `Documento`/anexo de paciente (outro domínio, dado de saúde) |
| **`Material da carteira`** (tabela nova, `materiais_carteira`) | Item da biblioteca "Método Firmare" — por programa, ou personalizado a um `Cliente Firmare` | — |
| **`Reunião comercial`** (tabela nova, `reunioes_comerciais`) | Ata/resumo de uma reunião da Firmare com um `Cliente Firmare`: data, resumo, encaminhamentos, anexos | `Reunião` interna de RH da clínica (não existe hoje) |

---

## 5 · Tabelas que G6 herda (achado de §0) — resumo de forma

Nenhuma delas tem `clinica_id`; todas têm `cliente_carteira_id` (a quem se
referem) e, denormalizado, `grupo_id` (para a política de §2.1). Escrita só
por `Usuário de Gestão`/`Operador` (análogo a `campanhas_carteira`); leitura
por `Usuário de Gestão` (visão interna, já coberta pelo RLS existente) **e**
por `Usuário do portal` (visão externa, política nova de §2.1).

| Tabela | Campos centrais | Quem escreve |
|---|---|---|
| `documentos_carteira` | `cliente_carteira_id`, `titulo`, `categoria`, `link`, `data`, `visivel_portal boolean default true` | `Usuário de Gestão` |
| `materiais_carteira` | `titulo`, `tipo`, `descricao`, `link` ou `texto`, `programas text[]` (ou `personalizado_para cliente_carteira_id` nullable) | `Usuário de Gestão` |
| `reunioes_comerciais` | `cliente_carteira_id`, `data`, `resumo`, `encaminhamentos`, `anexos jsonb`, `por_usuario_gestao_id` | `Usuário de Gestão` |

Auditoria: via `auditoria_do_painel` quando a escrita é do `Usuário de
Gestão`/`Operador` (mesmo padrão de G5 §6.2) — nenhuma dessas três tabelas tem
`clinica_id`, então nunca vai para a `auditoria` por clínica como escrita;
mas a **leitura** pelo `Usuário do portal` gera a linha de acesso por clínica
descrita em §2.3.

---

## 6 · Critérios de aceite testáveis

1. Criar um `Usuário do portal` com `escopo='cliente'` e logar: vê a seção
   de um `Cliente Firmare` só; tentar ler outro `cliente_carteira_id` (URL
   manipulada) é recusado pelo servidor, não só escondido na tela.
2. Criar um `Usuário do portal` com `escopo='grupo'` para um grupo com 3
   `Cliente Firmare`: vê 3 seções, uma por cliente; nenhuma tela mostra "total
   do grupo" sem, ao lado, a lista das 3 parcelas que somam esse total (prova
   visual, mesmo padrão de G3 critério 10).
3. Um `Usuário do portal` de um grupo A nunca lê, por nenhuma rota, dado de
   um `Cliente Firmare` de um grupo B — prova por teste de integração com
   Postgres real, duas sessões, dois grupos (mesmo padrão de
   `teste/isolamento-de-clinica.test.ts`).
4. `escopo='grupo'` só é criado pelo `Operador`; uma tentativa de um `Usuário
   de Gestão` criar um `Usuário do portal` de `escopo='grupo'` é recusada
   pelo servidor com mensagem que identifica o motivo (não um 403 genérico).
5. Ler o Portal do Grupo de um grupo com 2 clínicas grava, na mesma
   requisição, duas linhas de acesso (`ator_tipo='usuario_portal'`), uma em
   cada clínica — medido direto no banco, não só ausência de erro.
6. Nenhuma resposta do portal contém `valor_centavos` sem que o `Usuário do
   portal` correspondente exista e esteja ativo — redação por permissão
   (regra 17) passa pelo ponto único já existente, estendido para cobrir
   este ator (teste: desativar o `Usuário do portal`, confirmar que a sessão
   já aberta para de servir dado monetário na próxima requisição, não só
   bloqueia novo login).
7. Os 4 links de acesso abrem em nova aba, com a URL exata cadastrada —
   nenhum deles é processado, encurtado ou proxyado pelo servidor do portal.
8. `documentos_carteira`/`materiais_carteira`/`reunioes_comerciais`: criar uma
   linha para um `Cliente Firmare` com `visivel_portal=false` (ou,
   para reunião/material, sem vínculo de visibilidade) não aparece no portal
   mas aparece na tela interna do `Usuário de Gestão` — confirma que a
   visibilidade é um filtro de leitura do portal, não uma segunda tabela.

---

## 7 · O que fica explicitamente de fora de G6

- **Agregado de dado operacional/clínico cruzando clínicas** (pacientes,
  receita operacional, tarefas da FIR Clinic) — §3.2, pendente de LGPD e de
  pedido real.
- **Edição pelo `Usuário do portal`** — portal inteiramente read-only.
- **Comparação/ranking entre clínicas do mesmo grupo.**
- **Autoatendimento de criação/convite de `Usuário do portal`** por qualquer
  um que não seja `Usuário de Gestão` (escopo cliente) ou `Operador` (escopo
  grupo).
- **MFA para `Usuário do portal`** — mesma decisão e risco aceito já
  registrado para `Usuário de Gestão` (plano §9 item 1); G6 não reabre.
- **`diagnosticos`/`transcricoes`** — excluídos de todos os épicos por ADR
  0013 §1; G6 não reabre.
- **Notificação/e-mail quando uma `Reunião comercial` é registrada** —
  feature de engajamento, não ritual de visualização; fora desta fatia.

---

## 8 · Perguntas para o dono (numeradas, com recomendação)

### Pergunta 1 — nome do ator

**O nome `Usuário do portal` está certo, ou o dono prefere `Usuário do
Grupo`** (como a própria tarefa sugeriu) **mesmo cobrindo também o caso de
escopo `cliente` (uma clínica só)?**

**Recomendação:** `Usuário do portal`, porque o ator cobre dois escopos (como
`Usuário de Gestão` cobre `geral`/`grupo`) e "Usuário do Grupo" sugeriria, por
nome, que só existe a variante de grupo — confuso no dia em que a maioria das
contas reais for `escopo='cliente'` (uma clínica avulsa). Nome e vocabulário
entram em `CONTEXT.md` só depois da confirmação, por regra do topo deste
arquivo.

### Pergunta 2 — quem cria `Usuário do portal` de `escopo='cliente'`

**`Usuário de Gestão` pode criar um `Usuário do portal` de `escopo='cliente'`
para o próprio cliente sob sua responsabilidade, ou isso também deveria ficar
restrito só ao `Operador`** (mesma régua já fixada para `Grupo`/`Usuário de
Gestão`, ADR 0011 §2)?

**Recomendação:** `Usuário de Gestão` pode, para `escopo='cliente'` apenas —
é o equivalente exato do botão "Criar acesso" que o protótipo já dá à equipe
Firmare hoje (`fg-supabase.js:228`, risco já aceito e em operação). Reservo
"só Operador" para `escopo='grupo'`, onde o risco é estruturalmente maior
(cruza clínica pela primeira vez para um ator do lado do cliente). Se o dono
preferir unificar tudo em "só Operador", é uma restrição a mais, não uma
mudança de modelo.

### Pergunta 3 — titularidade do dado dentro de um `Grupo`

**Todas as clínicas de um mesmo `Grupo` são sempre a mesma titularidade/
controladora de dado (ex.: mesmo CNPJ, ou rede com acordo de
compartilhamento formalizado entre as unidades), ou um `Grupo` pode juntar
clínicas de donos juridicamente distintos só pela conveniência comercial de
"a Firmare atende as duas"?**

Isto decide se um futuro agregado de dado operacional (§3.2) seria "a dona
vendo o próprio negócio consolidado" (baixo risco adicional de LGPD, mesma
controladora) ou "dado cruzando duas controladoras" (precisa de base legal
própria, talvez até acordo entre as clínicas, não só entre cada uma e a
Firmare). **Não decidida aqui** — é a pergunta que eu recomendo levar a
`especialista-lgpd-saude` antes de abrir qualquer ticket de agregado
operacional, mesmo que G6 núcleo (§3.1) não dependa da resposta.

**Minha leitura, sem decidir:** o uso descrito até aqui (ADR 0011, "rede ou
franquia") sugere mesma titularidade na maioria dos casos reais, mas nada no
modelo de dado (`Grupo` é só uma tabela com nome) impede hoje que o
`Operador` junte duas clínicas de donos diferentes no mesmo grupo — é uma
decisão de cadastro, não uma restrição de schema. Se o dono quiser essa
restrição, é um campo novo (`Grupo.mesma_titularidade boolean`, ou similar) e
uma ADR própria quando (e se) o agregado operacional for pedido.

### Pergunta 4 — redação de valores para `Usuário do portal`

**Confirma que `Usuário do portal` sempre vê o valor monetário da própria
`Cobrança`/`Meta` (é o dinheiro dela, não de terceiro), sem precisar de uma
permissão `valores` própria como a que existe para `Pessoa`/`Usuário de
Gestão`?**

**Recomendação:** sim — não decidi isto sozinho de fato na prática (está
escrito como decisão em §3.1), mas peço confirmação porque envolve dinheiro
real e a regra 17 foi desenhada pensando em "esconder salário de colega", um
cenário que não existe aqui (o titular vendo o próprio débito). Se o dono
quiser uma segunda trava mesmo assim (ex.: um `Usuário do portal` secundário,
de um sócio minoritário, que não deveria ver valor), isso vira uma permissão
nova em `usuarios_do_portal`, não a ausência de redação.

### Pergunta 5 — ordem: G6 espera G3 fechar, ou constrói o essencial em paralelo?

**G6 depende de `Cobrança do Cliente Firmare` e `Meta comercial do cliente`
(G3, em construção agora por outra frente) para a seção de cada clínica ficar
completa. Confirma que G6 pode começar pela fundação (identidade do `Usuário
do portal`, RLS, documentos/materiais/reuniões — §5) e só plugar
metas/cobrança quando G3 fechar, em vez de esperar G3 inteiro antes de
começar?**

**Recomendação:** sim, começar pela fundação. É o mesmo padrão de
sequenciamento que G1a/G1b já usaram (fundação primeiro, denormalização
depois) — evita que G6 fique ocioso enquanto G3 ainda decide arredondamento
de desconto (G3 §3, perguntas 1-4, ainda sem resposta do dono na data deste
documento).
