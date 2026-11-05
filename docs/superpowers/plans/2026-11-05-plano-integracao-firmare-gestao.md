# Plano — Integrar o Firmare Gestão (protótipo da PO) ao FIR Clinic

- **Data:** 2026-11-05 (grilling + gate de risco completos, mesmo dia)
- **Estado:** **Gate de risco (G0) concluído.** Quatro agentes revisaram o spec:
  `product-rotina-clinica` (escopo), `especialista-seguranca-appsec` e
  `validador-numeros` (**reprovaram** seguir a tickets como estava),
  `especialista-lgpd-saude` (não vetou, exigiu 5 itens). Todos os achados foram
  resolvidos por spec — ver §1.6 e ADRs 0011, 0012, 0013. **Pronto para
  `/to-tickets` da fatia G1a (domínio puro)** — ver §7. Nenhuma linha de código
  de produto ainda.
- **Pedido original:** unir a ferramenta já pronta (FIR Clinic) com o protótipo da PO
  (Firmare Gestão — CRM da própria Firmare sobre a carteira de clínicas-cliente),
  mantendo identidade visual, telas e funcionalidades, mais o pedido novo: um nível
  de `Grupo` de clínicas, vendido como produto, com superadmin enxergando tudo.
- **Como este plano foi feito:** estudo direto do protótipo (`C:\Users\DAVI LOPES\Desktop\AURI PROJETOS\Firmare Gestão`,
  arquivos `index.html`, `fg-portal.js`, `fg-supabase.js`) mais três consultas em
  paralelo a `arquiteto-dominio`, `arquiteto-solucao` e `especialista-contas-assinatura`
  (que tem poder de veto sobre o painel). **Ainda faltam** `especialista-seguranca-appsec`,
  `especialista-lgpd-saude` e `validador-numeros` — ver seção 8. Este plano não substitui
  o gate de risco; ele é o material que o gate vai revisar.

---

## 1 · O que cada ferramenta é, de fato

**FIR Clinic** (este repositório) — o que a **equipe da clínica** usa todo dia: tarefas,
jornada, estoque, caixa, pessoas. Multi-tenant por `clinica_id` com RLS. Já tem um
painel de superadmin (`Operador`) que **só trata identidade**, de propósito (ADR 0008).

**Firmare Gestão** (o protótipo) — o CRM que a **própria Firmare** usa para gerenciar
sua carteira de clínicas-clientes de consultoria. Não é o mesmo software, é o software
*da consultoria sobre* as clínicas. Módulos medidos no protótipo: `painel` (visão
geral), `clientes` (carteira — cada cliente tem produto, status, saúde, mensalidade,
responsável Firmare), `metas` (KPIs por cliente, checkin semanal), `campanhas`
(marketing por cliente — tem campo `codigo_rotina` para ligar à FIR Clinic), `firclinic`
(dashboard de uso — **o contrato de telemetria diária já está desenhado**, ver §4),
`prospecção` (funil de vendas B2B da própria Firmare), `rotina` (tarefas internas da
equipe Firmare), `cadastros` (equipe Firmare: papel, setor, módulos, carteira
minha/todos, bit `valores`). Mais um portal **read-only** onde a clínica-cliente loga
e vê ciclo do contrato, 4 links (um deles abre a FIR Clinic dela), metas, materiais,
documentos, reuniões. Hoje roda sobre Supabase com uma tabela genérica
`registros{colecao,id,data}` fazendo de banco — **schemaless, incompatível com as
regras inegociáveis deste repositório** (sem RLS real, sem Dinheiro em centavos, sem
soft delete).

**A descoberta que muda o enquadramento:** `especialista-contas-assinatura.md` já
declarava, antes deste plano existir, "visão de consultoria sobre várias clínicas" e
"o painel interno... é a maior superfície de risco que existirá" como seu próprio
escopo. Firmare Gestão **é** esse painel — só que muito mais rico do que identidade:
ele lê dado de negócio (metas, campanhas, receita) de toda a carteira. A ADR 0008 já
previa esse dia como a pendência **P-10**, e ele chegou.

---

## 1.5 · Decisões do dono (grilling, duas rodadas — 2026-11-05)

| # | Decisão |
|---|---|
| Q1 | Gestão entra **depois** que paridade+migração (épico 9) fechar |
| Q2 | **Fatia mínima primeiro**: `Grupo` + carteira + telemetria (G1+G2+G4), CRM completo depois |
| Q3 | `Concessão de consultoria` (P-6) **fica fechada por enquanto** — ninguém da Firmare lê dado operacional de paciente hoje |
| Q4 | Cota de clínica (FIR Clinic) e cota de grupo (Gestão) são **contratos independentes** |
| Q5 | Segmento de rota/tabela: **`carteira`** |
| Q6 | Portal estendido ao grupo (franquia) — **fora do primeiro corte** |
| Q7 | As 4 clínicas de hoje migram para **grupos singleton**, nunca um grupo compartilhado |
| Q8 | Visão de campanhas do superadmin: **completa** — não só as avulsas da Firmare. Resolvido como "uma tela, duas fontes" (sync do módulo `campanhas` da clínica quando há `clinica_id`; lançamento manual quando não há) — ver ADR 0011 |
| Q9 | **Criar clínica unifica** na tela nova de carteira, junto com criar grupo e vincular |
| — | **Só o superadmin cria e atribui `Usuário de Gestão`** — nunca convite interno do responsável do grupo. Tela de criar/editar usuário **separada e explícita** entre `Pessoa` (clínica) e `Usuário de Gestão` (carteira) |

---

## 1.6 · Gate de risco (G0) — achados e resolução

| Agente | Veredito | Achado | Resolvido em |
|---|---|---|---|
| `especialista-seguranca-appsec` | Reprovou p/ tickets | RLS cruzando clínica subespecificado; sessão do Usuário de Gestão sem MFA/TTL/rate-limit nomeados; jobs sem papel de escrita declarado; `codigo_rotina` podia virar parâmetro de requisição | **ADR 0012** |
| `validador-numeros` | Reprovou p/ tickets (G3 e parte de G4) | `lancamentos` sem nenhuma regra de `Dinheiro`; `investimento`/`receita_continuada` não existem no `CampanhasModule` real; soma de receita entre clínicas do grupo não decidida | **ADR 0013** (G3 fica fora da fatia mínima, como já estava) |
| `especialista-lgpd-saude` | Não vetou, 5 exigências | Mecanismo de registro de acesso por grupo; retenção das 6 entidades novas; base legal não nomeada; sem regra de N pequeno; `diagnosticos`/`transcricoes` só omitidas, não excluídas por escrito | **ADR 0013** + `docs/compliance/retencao.md` |
| `product-rotina-clinica` | Escopo revisado | P-12 (registro de acesso + revogação) era só política, não entrega testável; G2 herdava escopo de G5 (funil de lead); **`grupo_id NOT NULL` em `Clinica` não pode entrar antes do fim literal do épico 9** | §7 (G1 dividido em G1a/G1b) |

Resumo do que mudou por causa do gate, já aplicado no resto deste documento:

- **Sessão/cookie do `Usuário de Gestão`:** MFA obrigatório, TTL mais curto que
  o da sessão de balcão, rate limit por conta **e** por origem, lista de
  sessões revogável pelo `Operador`, cookie `__Host-fir-carteira` com as
  quatro propriedades (Secure/HttpOnly/SameSite=Strict/prefixo) — não só o
  prefixo.
- **P-12 vira entrega testável de G1**, não só política: teste de integração
  contra Postgres real provando "Usuário de Gestão de um grupo nunca lê linha
  de outro grupo" e "revogar agora bloqueia a próxima requisição".
- **Critério objetivo para abrir G3/G5/G6** (proposto por `product-rotina-clinica`,
  todos binários e verificáveis, não opinião do dono):
  1. P-12 fechada de fato — uma revogação real em produção já bloqueou a
     próxima requisição, não só testado em CI;
  2. Zero vazamento cross-grupo em 30 dias de uso real, medido pela trilha;
  3. Os dois jobs rodaram idempotentes por 30 dias sem correção manual;
  4. `campanhas_carteira` bate exatamente com `CampanhasModule` para todo
     cliente com `clinica_id` ligado (mesmo padrão de conferência do épico 9);
  5. DPA (P-3) assinado com a cláusula de acesso de Gestão para toda clínica
     cujo grupo tem `Usuário de Gestão` ativo;
  6. Nenhum achado aberto deste gate (ou reavaliação, se o tempo decorrido for
     longo).

---

## 2 · Modelo de domínio — consolidado das três consultas + grilling + gate

### Entidades novas (entram em `CONTEXT.md` antes de qualquer migration)

| Termo | O que é | Vive em |
|---|---|---|
| **`Grupo`** | Vínculo comercial **estável** entre a Firmare e um conjunto de `Clinica`s da mesma rede/franquia. Fato de tenancy, não concessão. `Clinica.grupo_id` é **`NOT NULL`** (clínicas de hoje migram para um grupo singleton com o próprio nome — conversão única no migrador, nunca derivada em runtime). N:1, migrável (`UPDATE grupo_id`, nunca duplica linha) | domínio FIR (junto de `Clinica`) |
| **`Histórico de grupo da clínica`** | Append-only: de/para grupo, quando, por quem (`operador_id`), motivo. Responde "quem tinha visão desta clínica" numa auditoria de LGPD | domínio FIR |
| **`Escopo`** | Atributo do `Usuário de Gestão`: `geral` (todas as clínicas — é o superadmin/`Operador`) ou `grupo` (só as clínicas daquele `Grupo`). **Não existe uma linha "Grupo GERAL"** — resolveria o pedido do dono criando exatamente o padrão que a migration `0002` já rejeitou por escrito para clínica (sentinela universal) | ator `Usuário de Gestão` |
| **`Usuário de Gestão`** (renomeado de "Colaboradora Firmare" — nome que o próprio dono usa) | O ator interno do Firmare Gestão (setor, `escopo`, `valores`). **Não é `Operador`** nem `Pessoa` — é um terceiro tipo. **Só o superadmin cria e atribui** — nunca cria usuário nenhum sozinho, nem convida. Vê só o grupo para o qual foi criado, com visualização total dele | tabela nova `usuarios_gestao` |
| **`Campanha da carteira`** | "Uma tela, duas fontes" (decidido na Rodada 2): sincronizada por job do módulo `campanhas` da clínica quando há `clinica_id`; lançada à mão quando não há. Visão do superadmin é **completa**, por decisão do dono — ver ADR 0011 | tabela nova `campanhas_carteira` |
| **`Cliente Firmare`** | O registro comercial de quem contrata a consultoria. Existe **antes** de haver `Clinica` (funil de prospecção) e pode existir **sem nunca haver** uma (cliente só de consultoria). Ligado por `clinica_id` **anulável e único** — preenchido no dia do onboarding no FIR Clinic | tabela nova `clientes_carteira` |
| **`Concessão de consultoria`** | Formalização do que só existia em prosa no agente: acesso **individual e temporário** de uma `Colaboradora Firmare` ao dado **operacional** de **uma** `Clinica` (dose, paciente, dinheiro granular) — prazo, motivo, revogável **pela clínica**. **Nunca um papel global** | domínio FIR |

### A tensão (resolvida pelos três agentes, de forma convergente)

`Grupo` e `Concessão de consultoria` **coexistem e não se substituem**:

| | `Grupo` | `Concessão de consultoria` |
|---|---|---|
| Natureza | fato comercial (quem é dono de quem) | permissão de acesso |
| Duração | indeterminada (como cadastro) | prazo explícito, expira |
| Dá acesso a | **só o agregado não-sensível** (o documento diário de uso, metas, campanhas) | dado operacional granular |
| Quem concede | `Operador`, ao cadastrar o grupo | a própria `Clinica`, com motivo |

**Pertencer ao mesmo grupo nunca é, por si só, concessão de acesso a ficha de
paciente, dose ou recebimento individual.** Se amanhã a consultoria quiser abrir a
ficha de uma paciente específica, isso continua exigindo uma `Concessão de
consultoria` própria. Misturar os dois reabriria, pela porta dos fundos, o "papel
global de consultoria" que `especialista-contas-assinatura` já veta por escrito.

Isto também **não é novo**: `docs/decisoes.md` já tinha a pendência **P-6**
("Perfil 'Consultoria' com visão de várias clínicas"). O grilling mostrou que
`Grupo` não é a resposta a P-6 — são perguntas diferentes — **e o dono encerrou
P-6 na Rodada 1** (Q3): fica fechada por enquanto, ninguém da Firmare lê dado
operacional de paciente hoje.

---

## 3 · Onde isso vive no monorepo

**Não cria `apps/gestao` (app novo).** Perderia `packages/domain`/`contracts`/`ui`
exatamente onde mais serve (Dinheiro para cobrança do grupo, formatador central,
leitura de `Clinica`). **Não entra dentro do `PainelModule` do superadmin** — esse
módulo é identidade pura por desenho (ADR 0008); enfiar leitura de negócio ali
dispara a P-10 no primeiro commit.

**Recomendação (`arquiteto-solucao`):** módulo novo `apps/api/src/carteira/` +
seção nova em `apps/web` reaproveitando `packages/ui` (mesma identidade "papel e
dourado" — confirmado contra o protótipo). Identidade própria:

- tabela `usuarios_gestao` (não `operadores`, não `pessoas`), com `grupo_id` e
  `escopo`;
- cookie próprio (`__Host-fir-carteira`), guard próprio, mesmo padrão do
  `PainelGuard`;
- **Só o `Operador` cria e atribui `Grupo` e `Usuário de Gestão`** — decidido pelo
  dono: nunca um fluxo de convite de dentro do grupo (ver §1.5);
- RLS continua filtrando **só por `clinica_id`**; `grupo_id` é filtro de aplicação
  sobre dado que já saiu agregado da fronteira da clínica — não é uma nova porta
  para `BYPASSRLS`.

**Nome do segmento de rota — decidido (Q5):** não usar `/gestao` (colide com o
nome do produto "Rotinas de **Gestão**") nem `/painel` (já é chave de permissão e
nome de tela). **`carteira`**.

### Mapeamento das coleções do protótipo (schemaless → tabela com schema)

| Coleção do protótipo | Tratamento recomendado |
|---|---|
| `clientes` | `clientes_carteira`, `grupo_id NOT NULL`, `clinica_id` nullable (FK) |
| `clientes_fin` | Colunas monetárias separadas, atrás de `valores` de Gestão — mesmo padrão do FIR |
| `metas`, `indicadores` | Tabelas próprias, `grupo_id` + `cliente_carteira_id` |
| `campanhas` | **`campanhas_carteira`, populada por sincronização (job), nunca consulta ao vivo** — quando `clientes_carteira.clinica_id` existe, copia do `CampanhasModule` que já existe na clínica (épico 8); quando não existe, lançamento manual. Ver ADR 0011 — isto atravessa receita por campanha, mais do que a telemetria de uso |
| `lancamentos` | Dinheiro real (Firmare cobrando o grupo) → `Dinheiro` de `packages/domain`, centavos |
| `reunioes` | `reunioes_comerciais` |
| `leads` | `leads_comerciais` — funil B2B, cadeia `lead → cliente_carteira (sem clinica_id) → clinica_id preenchido no onboarding` |
| `roteiros`, `mensagens` | `roteiros_comerciais`, `mensagens_comerciais` |
| `perfis` | `perfis_carteira` — não reutilizar `perfis` da clínica (audiências diferentes) |
| `tarefas`, `rotinas`, `checkins` | **Colisão de nome com `Tarefa` e `Marcador de rotina`, que já são conceitos centrais do domínio FIR.** Renomear: `tarefas_internas`, `rotinas_internas`, `checkins_internos` |
| `uso` | Não é coleção genérica — é fato diário, ver §4 |
| `diagnosticos`, `transcricoes` | Possível dado sensível (fala de equipe clínica pode mencionar paciente) — **não modelar sem `especialista-lgpd-saude` avaliar primeiro** |
| `documentos` | **Resolvido por leitura do seed do protótipo** — links do Drive por cliente, categorizados, com flag `interno` controlando visibilidade no portal |
| `materiais` | **Resolvido** — biblioteca compartilhada ("Método Firmare"): por programa ou personalizada por cliente. Entidade e tela próprias, não é `documentos` |
| `beneficios` | **Resolvido** — recompensa de indicação (ex.: desconto de mensalidade), liga `leads_comerciais` a `clientes_carteira` |

---

## 4 · O contrato de telemetria "uso diário" — já desenhado pela PO

O protótipo já documenta, em comentário, o formato exato que esperava receber:

```
{cliente_id, data, usuarios_cadastrados, usuarios[{nome,ultimo_acesso}], usuarios_ativos,
 tarefas_criadas, tarefas_concluidas, tarefas_no_prazo, tarefas_vencidas_abertas,
 rotinas_previstas, rotinas_cumpridas, contatos_pacientes, orcamentos_enviados,
 orcamentos_pagos, receita_registrada, recaptacoes, faltas, faltas_recontatadas}
```

**Recomendação: job agendado (BullMQ), não consulta ao vivo.** Roda dentro de cada
clínica (com o RLS dela), calcula os números usando os módulos de domínio que já
possuem essas regras (`tarefas`, `financeiro`, `jornada` — nunca recalculado do
zero fora deles, que seria a mesma regra escrita duas vezes), e escreve só o
**agregado sem PII** numa tabela fato `uso_diario_cliente` (idempotente por
`cliente_carteira_id + data`, mesma disciplina da regra 26). Três razões: dono da
regra calcula a regra; minimização de dado (nunca nome de paciente atravessa);
fato histórico não recalcula sob os pés do painel.

Isto também é o primeiro seam real candidato: **`LeitorDeIndicadores`**, **só se**
a leitura da planilha Google de indicadores for automatizada agora — se por ora é
cópia manual, não construir a abstração ainda (mesma regra do `AgendaProvider`).

**O mesmo padrão se repete para `Campanha da carteira` (decidido na Rodada 2 do
grilling, ADR 0011):** um segundo job agendado sincroniza, por clínica com
`clinica_id` ligado, o resultado das campanhas já registradas em
`CampanhasModule` (épico 8) para `campanhas_carteira` — nunca consulta ao vivo.
**Esta é a primeira vez que receita (dinheiro real de uma clínica) atravessa para
a carteira**, e não só contagem agregada — por isso vira decisão em ADR, não só
engenharia.

---

## 5 · Pendências novas ou alteradas — para `docs/o-que-depende-de-voce.md`

| # | Pendência | Por quê agora |
|---|---|---|
| **P-12 (nova)** | **Usuário de Gestão e Grupo: escopo, concessão e trilha de leitura.** Antes de ligar qualquer leitura de dado de negócio pelo Gestão em produção: ator com tabela própria (`usuarios_gestao`), concessão por grupo registrada (quem concedeu, desde quando, revisão periódica), registro de **acesso** (não só escrita) em toda leitura, revogação instantânea checada por requisição, papel de banco próprio sem `BYPASSRLS` (`fir_carteira`), e cláusula própria no DPA de cada clínica. **Escopo ampliado na Rodada 2 (ADR 0011): cobre não só telemetria de uso, mas receita agregada por campanha** | consenso dos três agentes + decisão do dono — sem isso, o painel repete o erro que a ADR 0008 já documentou para identidade, agora para dado de negócio |
| ~~**P-6**~~ | ~~Perfil "Consultoria" com acesso operacional granular~~ — **ENCERRADA pela Rodada 1 do grilling (2026-11-05).** O dono decidiu: fica fechada por enquanto. Ninguém da Firmare lê dado operacional de paciente hoje — só o agregado que `Grupo` entrega. Reabre no dia em que houver pedido real | resolvido |
| **P-4 (já existente)** | Modelo comercial por clínica x por grupo passam a ser **dois contratos sobrepostos** (clínica paga o FIR Clinic operacional; grupo paga o pacote de Gestão) — cota de um nunca toca a cota do outro | dono |

---

## 6 · ADRs — escritas

1. **ADR 0011** — `Grupo` × `Concessão de consultoria` (distintas), só o
   superadmin cria `Usuário de Gestão`, `Campanha da carteira` cruza receita.
2. **ADR 0012** — RLS da carteira por `grupo_id` (nunca cruzando `clinica_id`),
   jobs como `fir_app`, `codigo_rotina` nunca é parâmetro de requisição.
3. **ADR 0013** — o que não atravessa (`diagnosticos`/`transcricoes`, campo
   `nome` de `usuarios[]`), base legal nomeada por fluxo, N mínimo de 5 para
   receita de campanha, só `receita` sincroniza, soma de grupo sempre
   explícita por clínica.

Restam, a escrever **durante** G1a (não bloqueiam o início, só o fim da fase):

4. Segmento de rota/tabela `carteira` — decisão já tomada (Q5), falta só
   formalizar se o `arquiteto-solucao` achar que precisa de ADR própria.
5. Tabelas internas de Gestão renomeadas para não colidir com `Tarefa`/`Marcador
   de rotina` do domínio FIR — já decidido no plano §3, formalizar se o
   `revisor-codigo` pedir ao final de G5.

---

## 7 · Fases de entrega (épicos, em ordem)

**Decidido (Q1): Gestão entra depois que o épico 9 (migração das 4 clínicas, a
entrega com data) fechar.** **Decidido (Q2): fatia mínima primeiro** — G1+G2+G4
provam o modelo de acesso antes de empilhar CRM completo em cima.

| Épico (Gestão) | Entrega | Depende de |
|---|---|---|
| **G0 — Gate de risco** | ✅ Concluído — ver §1.6. ADRs 0011, 0012, 0013 aceitas | — |
| **G1a — Fundação, domínio puro** | ✅ **Entregue e verificado** (2026-11-05): `grupos`, `historico_grupo_da_clinica`, `usuarios_gestao` com `Escopo` (migration `0025_carteira_fundacao.sql`), `ator_tipo='usuario_gestao'` na auditoria, `podeVerGrupo`/`criarUsuarioDeGestao` em `packages/domain`, `app_grupo_id()`/`app_escopo()`, RLS própria em `historico_grupo_da_clinica` (regra 19 — achado próprio, não estava no gate: toda tabela com `clinica_id` precisa de RLS, mesmo sendo tabela interna da carteira). 7 testes de domínio + 21 de integração (Postgres real) + `typecheck`/`test`/`build`/`lint` limpos. **Não tocou a tabela `clinicas`** | G0 |
| **G1b — `grupo_id` em `Clinica` (reavaliado)** | **Simplificação encontrada ao planejar G2:** `clientes_carteira.grupo_id NOT NULL` (G2) já é suficiente para a fatia mínima inteira — a RLS da carteira (ADR 0012) nunca lê `clinica_id` cruzado, só as tabelas próprias da carteira. `Clinica.grupo_id` deixa de ser bloqueio: vira uma denormalização **opcional**, revisitada só se surgir necessidade real (ex.: o próprio FIR Clinic precisar saber seu grupo sem consultar a carteira) — não antes do fim do épico 9, se acontecer | — (não bloqueia mais nada) |
| **G2 — Carteira** | ✅ **Entregue e verificado por completo** (2026-11-05): banco (`clientes_carteira` migration `0026`, `sessoes_de_carteira`/`tentativas_de_carteira` `0027`/`0029`) + leitura (`CarteiraModule`: `entrar`/`sair`/`eu`/`clientes`, isolamento cross-grupo provado por `curl` real e 2 e2e) + **escrita** (`POST /v1/superadmin/grupos`, `/clientes-carteira`, `/usuarios-gestao`, só o `Operador`, ADR 0011 — migration `0030` corrigiu GRANT faltante em `auditoria_do_painel` e um novo método `BancoService.nasTabelasDaCarteiraComoOperador` fixa `escopo='geral'` para a escrita do Operador em tabela com RLS por grupo) + **frontend** (`/superadmin/grupos`, `/superadmin/usuarios-gestao`, navegação do painel). `typecheck`/`test`/`build`/`lint` limpos na árvore inteira. **Falta:** tela de login/clientes do `Usuário de Gestão` já existia; falta listagem de Usuários de Gestão (só criação por ora) | **G1a** ✅ |
| **G4 — Telemetria e campanha (fatia mínima)** | ✅ **Entregue e verificado por completo** (2026-11-05): banco (`uso_diario_cliente`/`campanhas_carteira`, migration `0028`) + job (`executarUsoDiarioCliente`, upsert idempotente por `(cliente_carteira_id, dia)`, por fuso de cada clínica — regra 22/23) + extração de `metricas-diarias.ts` a partir de `painel-geral/painel.service.ts` (regra "cada regra existe uma vez") + fila/worker BullMQ (dependência nova no projeto, documentada). **Pendências para revisão do dono/`product-rotina-clinica`:** `faltas_recontatadas` fica sempre em 0 (precisa ticket próprio — cruzar falta com reagendamento posterior), `tarefas_vencidas_abertas` usa `prazo <= dia` (confirmar se deveria ser `< dia`), cron fixo `06:00 UTC` (não por fuso de clínica). **Falta:** registrar o worker em `infra/` para produção | G1a ✅, G2 ✅ |
| **G3 — Metas comerciais e `lancamentos`** (CRM completo, pós-fatia-mínima) | `metas`, `indicadores`, `lancamentos` — **não abre ticket sem spec de `Dinheiro` para a mensalidade** (unidade de cobrança, rateio de mudança de grupo, direção de arredondamento de desconto — ADR 0013 §8) | G4 + critérios §1.6 |
| **G5 — Rotina interna + funil de prospecção** (CRM completo) | `tarefas_internas`, `rotinas_internas`, `checkins_internos`, **cadeia completa `lead → cliente_carteira (sem clinica_id) → clinica_id`** (cortada de G2, pertence aqui) | G4 + critérios §1.6 |
| **G6 — Portal do grupo (extensão)** | **Fora do primeiro corte** (Q6) — reavaliar quando o primeiro grupo-cliente de verdade pedir | G4 + critérios §1.6 |
| **G7 — Deploy VPS** | Rota Traefik para `carteira` (autenticação + MFA + rate limit por conta e origem — nunca allowlist de IP fixo), sem container novo, sem fila nova | G1a-G2-G4 primeiro; G3/G5/G6 depois |

Cada épico segue o ciclo normal: `/to-spec` → gate de risco → `/to-tickets` →
`/tdd` → `/implement` → `/code-review` → `validador-numeros`.

---

## 8 · Gate de risco — concluído

- [x] `especialista-seguranca-appsec` — resolvido em ADR 0012.
- [x] `especialista-lgpd-saude` — resolvido em ADR 0013 + `docs/compliance/retencao.md`.
- [x] `validador-numeros` — resolvido em ADR 0013 (G3 segue fora da fatia mínima até ter spec de `Dinheiro` própria).
- [x] `product-rotina-clinica` — escopo revisado: G1 dividido em G1a/G1b, funil de lead movido para G5, critérios objetivos para G3/G5/G6 em §1.6.
- [x] Dono — P-12, P-6, P-4, ordem G0-G7 vs. épico 9 — resolvido nas Rodadas 1 e 2 do grilling (§1.5).

**Pronto para `/to-tickets` de G1a.** G1b espera o fim literal do épico 9 (não apenas paridade verde).

---

## 9 · Decisões do dono (2026-11-05, pós-gate)

| # | Pergunta | Decisão |
|---|---|---|
| 1 | MFA do `Usuário de Gestão`? | **Não, por enquanto.** Mesmo padrão de segurança já usado em todo o resto do produto (senha + Argon2 + limite de tentativas), sem segundo fator. A allowlist de IP para o superadmin **não está ativa hoje** (fica no backlog) — então a carteira não fica, por essa decisão, mais fraca do que o resto do sistema já é. Risco aceito e registrado — ver ADR 0012, emenda abaixo |
| 2 | Quem testa primeiro? | O próprio Claude cria grupos e usuários fictícios — **mais de um grupo**, de propósito, para confirmar visualmente (não só pelo teste automático) que pessoas de grupos diferentes não se enxergam |
| 3 | Fatia mínima antes do resto? | **Não — construir a aplicação completa.** G3, G5 e G6 deixam de esperar os 6 critérios de observação; entram no plano de construção direto |
| 3b | Portal do grupo (G6) entra no escopo completo? | **Sim** |
| 4 | Critério de "usuário ativo no dia"? | **Opção A — login no dia.** Mais simples; evolui para "ação registrada" só se a Firmare perceber que login-sem-uso distorce o número |
| 5 | "Falta recontatada" — só falta, ou falta + desmarque? | **As duas contam.** Quem faltou e quem desmarcou entram juntas na contagem de recontato |
| 5b | Falta recontatada — data da falta ou do reagendamento? | **Data do reagendamento** (quando a recepção agiu) |
| 6 | Unidade de cobrança do G3 (mensalidade)? | **Por clínica, dentro do grupo** — não um valor único por grupo. Acha de graça a pergunta de rateio que o `validador-numeros` tinha levantado: como a mensalidade é propriedade de cada `Cliente Firmare` (ligado a uma clínica), mudar de grupo no meio do mês não exige dividir nada — o valor cobrado não depende de qual grupo a clínica está, só de ela existir. O grupo continua sendo só a lente de visualização ("quais clínicas este grupo vê"), nunca a unidade de cobrança |

**O que NÃO muda com "construir tudo":** `G1b` (`grupo_id NOT NULL` na tabela
`Clinica` de verdade) continua esperando o fim literal do épico 9. Isso não é
uma escolha de tamanho de escopo — é uma restrição técnica de sequenciamento
(o importador da v20 está sendo construído e verificado contra a mesma
tabela, ao mesmo tempo). "Construir tudo" muda O QUE construímos; não muda
QUANDO é seguro mexer numa tabela que outra frente está migrando.

**Achado técnico, não pergunta:** `rotinas_previstas`, `rotinas_cumpridas` e
`recaptacoes` do contrato original do protótipo **não têm fonte real** no
domínio FIR hoje — removidas de `uso_diario_cliente` antes de existir job
(ADR 0014). Não é uma pergunta porque a resposta de engenharia já é clara:
não se sincroniza o que não existe na fonte.

---

## Fontes consultadas

Protótipo: `index.html`, `fg-portal.js`, `fg-supabase.js`, `config.js` (pasta
`Firmare Gestão`). Repositório: `CLAUDE.md`, `CONTEXT.md`, `docs/decisoes.md`,
`docs/roadmap.md`, `docs/fila.md`, `docs/compliance/retencao.md`, ADRs 0002,
0008, 0011, 0012, 0013, `.claude/agents/especialista-contas-assinatura.md`,
`apps/api/src/painel/`, `apps/api/src/painel-geral/`, `apps/api/src/campanhas/campanhas.service.ts`,
`apps/api/migrations/0001_fundacao.sql`, `0002_identidade.sql`, `0013_painel.sql`,
`infra/bootstrap-papeis.sql`. Sete consultas: `arquiteto-dominio`,
`arquiteto-solucao`, `especialista-contas-assinatura` (fase 1-2), e o gate de
risco completo — `especialista-seguranca-appsec`, `especialista-lgpd-saude`,
`validador-numeros`, `product-rotina-clinica` (fase 3).
