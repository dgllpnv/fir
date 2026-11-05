# ADR 0011 — Carteira comercial: `Grupo`, `Usuário de Gestão`, e o limite do que cruza a clínica

- **Data:** 2026-11-05
- **Estado:** aceita
- **Origem:** sessão de `/grill-with-docs` com o dono, duas rodadas, sobre o plano
  `docs/superpowers/plans/2026-11-05-plano-integracao-firmare-gestao.md`
- **Relacionada:** ADR 0008 (superadmin sem concessão prévia) — esta ADR é o dia
  em que a pendência **P-10** daquela ADR deixa de ser teórica para a carteira
  comercial, e abre a **P-12**

## Contexto

A Firmare quer unir o Firmare Gestão (CRM da própria Firmare sobre sua carteira
de clínicas-cliente, hoje um protótipo da PO sobre Supabase) ao FIR Clinic, com um
pedido novo: vender o produto também para **grupos** de clínicas/médicos, com o
superadmin criando grupos e atribuindo sua gestão a um usuário responsável que só
vê as clínicas daquele grupo.

Isto introduz um nível de tenancy acima de `Clinica` e um ator novo que lê dado
agregado de negócio de várias clínicas — exatamente a maior superfície de risco
que `especialista-contas-assinatura.md` já previa para "o painel interno, quando
vier".

## Decisão

### 1 · `Grupo` é fato de tenancy, não concessão — e `Concessão de consultoria` continua fechada

Toda `Clinica` tem `grupo_id NOT NULL`, pertence a **exatamente um grupo por
vez** (nunca dois — evita duas redes concorrentes enxergando a mesma clínica), e
as 4 clínicas de hoje migram para grupos **singleton** com o próprio nome. Isto é
diferente, e **não substitui**, a ideia de uma concessão individual e temporária
de acesso a dado operacional granular (ficha, dose) de uma clínica — essa
continua **fechada por decisão do dono**: ninguém da Firmare lê dado operacional
de paciente hoje, só o agregado que `Grupo` entrega. Reabre no dia em que alguém
pedir isso de fato.

### 2 · Só o superadmin cria e atribui `Usuário de Gestão` — nunca convite interno

O ator que acessa pelo grupo (`Usuário de Gestão`, tabela própria
`usuarios_gestao`, nem `Pessoa` nem `Operador`) é criado e atribuído **somente**
pelo `Operador`. Ele tem visualização total do próprio grupo, mas **nunca cria
usuário nenhum** — nem `Pessoa` de clínica, nem outro `Usuário de Gestão`. A
tela de criar/editar usuário é **separada e explícita** entre `Pessoa` (clínica) e
`Usuário de Gestão` (carteira), nunca o mesmo formulário.

**Por que não a alternativa (responsável do grupo convidando o resto da
equipe):** foi a recomendação inicial da consulta a `arquiteto-solucao`, e o dono
a rejeitou por uma razão que se sustenta sozinha — um único ponto de entrada
(`Operador`) é o que fecha, sem esforço extra, a exigência de concessão
**registrada** que a pendência P-12 já cobra. Delegar a criação multiplicaria
pontos de entrada sem necessidade comercial demonstrada.

### 3 · `Campanha da carteira`: visão completa, populada por sincronização quando houver clínica — nunca consulta ao vivo

O dono pediu visão **completa** de campanhas, "ativas e inativas", não só as
comerciais avulsas da Firmare. O protótipo já resolve isso: uma `Campanha da
carteira` é **uma tela, duas fontes**:

- **Sincronizada** (job diário, nunca consulta ao vivo cruzando RLS — mesmo
  padrão de `uso_diario_cliente`) do módulo `campanhas` que já existe na FIR
  Clinic, quando `Cliente Firmare.clinica_id` existe;
- **Lançada à mão**, quando o cliente é só de consultoria, sem FIR Clinic.

**O que isto cruza, e por que é uma decisão e não um detalhe de implementação:**
diferente de `uso_diario_cliente` (contagens e percentuais agregados, sem
dinheiro granular), uma campanha carrega **receita** — dinheiro real de uma
clínica específica. Ainda agregado por campanha (nunca por paciente), mas é a
primeira vez que `Dinheiro` de uma clínica atravessa para a visão do superadmin
ou do grupo. Isto amplia o escopo da pendência **P-12**: a concessão que o
`Usuário de Gestão` recebe (via `Grupo`) passa a cobrir, explicitamente, receita
agregada por campanha — e isso precisa constar na cláusula de DPA de cada
clínica (P-3), não só a telemetria de uso.

### 4 · "Criar clínica" muda de casa

A criação de `Clinica`, hoje um fluxo isolado do painel de identidade do
superadmin, passa a viver na mesma tela que cria `Grupo` e vincula clínica a
grupo — mesma ação, um lugar só, pelo pedido explícito do dono de "organizar a
estrutura do sistema" num só ponto.

## Alternativas rejeitadas

**Um grupo "GERAL" como linha real, contendo todas as clínicas, para representar
a visão do superadmin.** Rejeitada: colidiria com a invariante de uma clínica,
um grupo — e repetiria o padrão da "clínica sentinela" que a migration `0002`
já recusou por escrito. A visão total do superadmin é modelada como **ausência
de restrição** do ator `Operador`, não como associação a um grupo.

**`Usuário de Gestão` como extensão de `Operador` com um `grupo_id` filtrante.**
Rejeitada pela consulta a `arquiteto-dominio`: misturaria dois sistemas de
autorização num ator só — a mesma lição que a ADR 0008 já tirou do booleano
`superadmin` em `pessoas`.

**Duas tabelas paralelas para campanha** (`campanhas_comerciais` sempre manual +
`campanhas` da clínica, nunca ligadas). Rejeitada depois da Rodada 2: o próprio
protótipo já desenha a sincronização por `codigo_rotina`, e duas tabelas sem
ligação seria a mesma regra ("resultado da campanha X") escrita duas vezes,
divergindo no primeiro lançamento manual feito por engano numa clínica que já
sincroniza.

## Consequências

- **P-12** (nova, ver plano) ganha escopo mais preciso: cobre não só
  telemetria de uso, mas também receita agregada por campanha.
- **P-3** (DPA por clínica) precisa de cláusula cobrindo os dois tipos de dado
  agregado que atravessam: uso e campanha/receita.
- O job de sincronização de `Campanha da carteira` é o segundo consumidor do
  mesmo padrão "job escreve fato agregado, Gestão nunca consulta ao vivo
  cruzando RLS" — primeiro foi `uso_diario_cliente`. Isto é, na prática, um
  seam reaproveitado, não um seam novo.
