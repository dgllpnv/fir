# ADR 0025 — Setor de atuação e tarefa para o setor

**Status:** aceita · 2026-11-09. O dono respondeu P1 a P8 (§16). Os três gates aprovaram: appsec
(S-51 a S-60 incorporadas), números (N-23 a N-33) e LGPD, cuja segunda passada
(`correcoes-po-gate-lgpd.md`, "B4 — segunda passada") registra ciência e aceite da declaração de
S-60 (§14.4) e parecer favorável a §10.4. As condições finais (S60-1, S60-3, LA24-1 a LA24-3)
entram nos tickets B4-6 e B4-8 e **não reabrem esta ADR**. Daqui em diante, mudar uma decisão
daqui exige uma ADR nova que a substitua.
**Origem:** item 8 da lista da PO (teste em produção de 2026-11-08). Decisão do dono em 2026-11-09:
*setores por clínica, setor na pessoa, a tarefa pode ir para um setor, todos do setor veem e
qualquer um conclui.* Respostas do dono a P1–P8, N-24 e N-25 em 2026-11-09 (§16).
Spec: `docs/specs/correcoes-po-2026-11-09.md` §B4.
**Gates:** `correcoes-po-gate-appsec.md` (S-40 a S-47; revisão S-51 a S-60),
`correcoes-po-gate-lgpd.md` (L-B4-1 a L-B4-7; revisão, condições 1 a 7),
`correcoes-po-gate-numeros.md` (revisão, N-23 a N-33, T-B4-1 a T-B4-11).
**Decide:** `arquiteto-dominio`, com `product-rotina-clinica`.
**Substitui:** nada. **Relacionadas:** ADR 0003 (desativar não apaga), ADR 0004 (máquina de estados
da jornada), ADR 0013 §2 (o que não atravessa para a carteira), D-13 (sessão de suporte).
**Divergência do protótipo:** **sim, duas, ambas deliberadas.**
1. **Tarefa para setor.** O protótipo sempre atribui a uma pessoa (`criarTarefa`, L1384-1387:
   `responsavelId` obrigatório; select "Responsável por executar", L2502-2503). Ele não tem setor.
   É decisão nova do dono, não correção.
2. **A lista não leva a dose orçada** (§10.4). No protótipo, o cartão de orçamento (fechado ou
   perdido) mostra a linha "Programa orçado: …" (`esteiraCardHtml`, L4790), e `resumoProgOrc`
   (L4819) inclui `it.dose` ("Tirzepatida 4× 2,5 mg → Tirzepatida 4× 5 mg"). É o mesmo
   `cardTarefa` em Hoje, Tarefas e Jornada. Aqui, toda resposta de lista leva o programa orçado
   **sem dose**, para tarefa de pessoa e de setor: neste ponto a minimização (LGPD art. 6º, III)
   vence a paridade. Decisão do `product-rotina-clinica` com o gate de LGPD (parecer "L-A2-4",
   2026-11-09). **Uma conferência de paridade que encontre a dose ausente no cartão está vendo
   esta decisão, não um defeito.** A linha "Programa orçado" do protótipo também ainda não existe
   no nosso cartão. Isso é lacuna de paridade, registrada em `docs/dividas.md`, e quando for feita
   a linha sai sem dose.

## Contexto

Hoje toda tarefa tem uma pessoa: `tarefas.responsavel_id uuid NOT NULL` (migration 0006, L135).
Tudo o que pergunta "de quem é" lê essa coluna:

- **Visibilidade.** *Para mim* é `t.responsavel_id = eu` (`filtroDeEscopo`, `consulta.service.ts`);
  os três blocos da jornada usam `responsavel OR solicitante` (`filtroDePasso`); *Equipe toda* exige
  `tarefas.equipe` (`exigirEscopo`, `leitura.ts`). A faixa da semana e o aviso "N tarefas não
  aparecem em Para mim" (`ocultasPeloFiltro`) reusam o mesmo filtro.
- **Autorização.** `podeEditar` libera o responsável (e reabrir usa `podeEditar`); `podeCancelar`
  e `podeExcluir` não (`packages/domain/src/tarefa.ts`). `podeConcluir` não pergunta quem é, e
  `conclusao.service.ts` não confere se quem conclui vê a tarefa.
- **Meta e Painel.** `indicadores.service.ts` agrupa as concluídas e o percentual no prazo por
  `t.responsavel_id`; `metricas-diarias.ts` (`consultarPrazos`) agrupa por `t.responsavel_id` com
  `GROUPING SETS ((t.responsavel_id), ())` e acha a linha de total procurando `pessoa = null`.
- **Leitura.** `SELECT_TAREFA` faz `JOIN pessoas pr ON pr.id = t.responsavel_id` — e esse `JOIN`
  interno, sob RLS, é hoje a única coisa que esconde uma tarefa cujo `responsavel_id` aponte para
  pessoa de outra clínica: as FKs de `responsavel_id` e `solicitante_id` são simples (0006), e a
  integridade referencial do Postgres ignora a RLS.
- **Quem concluiu não é gravado** como coluna: só no `historico` das tarefas da jornada e na
  `auditoria`.

A clínica pediu tarefas que são "da Enfermagem" ou "da Recepção": quem estiver de plantão faz. Com
o modelo atual a única saída é escolher alguém, e aí a tarefa some do *Para mim* das outras e conta
na meta de quem não fez.

Três riscos moram nessa mudança, e são eles que esta ADR resolve por escrito:

1. **Ela alarga quem vê dado de paciente** (§14.4).
2. **Pertencer a um setor vira permissão de fato** — quem se coloca num setor passa a ver as
   tarefas e os pacientes dele.
3. **A meta pode mentir** — creditar "o setor", todos os membros, uma pessoa de enfeite, ou deixar
   que alguém tome o ponto de outra trocando o destino ou reabrindo.

E um nome: `CONTEXT.md` já tem `Setor` — o `setor` do `Usuário de Gestão` na carteira.

## Decisão

### 1. O nome: `Setor de atuação` (P1)

Termo novo no glossário: **`Setor de atuação`**. No código: tabela `setores_de_atuacao`, colunas
`setor_de_atuacao_id`, contrato `setorDeAtuacaoId` / `SetorDeAtuacao`, rota
`/v1/setores-de-atuacao`. Na tela: "Setor de atuação" em todo rótulo de campo e título; no cartão
da tarefa, o nome do setor ("Para Enfermagem") com o rótulo acessível "Setor de atuação".

`setor` sozinho entra na lista de termos proibidos; o da carteira passa a se chamar `Setor da
carteira` no glossário, e o identificador já gravado (`usuarios_gestao.setor`,
`SetorDaCarteiraEnum`) fica como está — renomear dado em produção para ganhar nada é a mesma
recusa da exceção `'Sessão de plano'`.

### 2. Modelo de dados (migration 0066)

```
setores_de_atuacao
  id            uuid PK
  clinica_id    uuid NOT NULL → clinicas
  nome          text NOT NULL, 1..40
  criado_em     timestamptz NOT NULL DEFAULT now()
  excluido_em   timestamptz          -- soft delete (regra 20, L-B4-5)
  UNIQUE (clinica_id, id)            -- alvo das FKs compostas
  UNIQUE parcial (clinica_id, normalizar_nome(nome)) WHERE excluido_em IS NULL
  RLS ENABLE + FORCE, policy clinica_id = app_clinica_id() em USING e WITH CHECK
  trigger registrar_auditoria
  sem DELETE para fir_app (nem para o papel do painel)

pessoas
  + setor_de_atuacao_id uuid NULL
    FK (clinica_id, setor_de_atuacao_id) → setores_de_atuacao (clinica_id, id)

tarefas
  responsavel_id       DROP NOT NULL
  -- S-51: as duas FKs simples da 0006 viram compostas, NESTA migration
  - FK simples de responsavel_id e de solicitante_id
  + FK (clinica_id, responsavel_id) → pessoas (clinica_id, id)   NOT VALID + VALIDATE
  + FK (clinica_id, solicitante_id) → pessoas (clinica_id, id)   NOT VALID + VALIDATE
  + setor_de_atuacao_id uuid NULL
    FK (clinica_id, setor_de_atuacao_id) → setores_de_atuacao (clinica_id, id)
  + concluida_por       uuid NULL
    FK (clinica_id, concluida_por) → pessoas (clinica_id, id)
  CHECK tarefa_tem_um_destino:
    (responsavel_id IS NULL) <> (setor_de_atuacao_id IS NULL)
  CHECK concluida_por_so_em_concluida:
    concluida_por IS NULL OR status = 'concluida'
  CHECK tarefa_de_setor_concluida_tem_quem_concluiu:
    setor_de_atuacao_id IS NULL OR status <> 'concluida' OR concluida_por IS NOT NULL
  CHECK sessao_nao_vai_para_setor:
    setor_de_atuacao_id IS NULL OR tipo <> 'Sessão de plano'      -- §11, P3
  índice tarefas_abertas_do_setor (clinica_id, setor_de_atuacao_id, prazo)
    WHERE status = 'aberta' AND excluida_em IS NULL
```

- **S-51 — a pré-condição que falha alto.** Antes do `VALIDATE` das duas FKs compostas, a
  migration conta as tarefas cujo `responsavel_id` ou `solicitante_id` aponte para pessoa de outra
  clínica e, se a contagem não for zero, **aborta com mensagem legível** (quantas, por coluna; sem
  id de pessoa nem de paciente). Descobrir na implantação, não no Painel. A troca de `JOIN pessoas
  pr` por `LEFT JOIN` vai **no mesmo PR e no mesmo deploy** da 0066, nunca antes.
- **Um setor por pessoa** (P2), numa coluna. É o que o dono disse ("setor na pessoa") e torna o
  histórico de pertencimento uma trilha de → para numa coluna de `pessoas`, que já tem
  `registrar_auditoria`.
- **A FK composta é o que recusa o setor de outra clínica** (S-40, AB-B4-4), não um `SELECT` no
  serviço. O serviço confere antes, para devolver 400 legível em vez de 23503.
- `pessoas.setor_de_atuacao_id` mora em `pessoas`, **nunca em `fichas_de_pessoa`** (L-B4-1). Nenhuma
  relação com `cargo` nem com `funcao`.
- As restrições novas de `tarefas` entram `NOT VALID` e são validadas na mesma migration. Toda linha
  existente tem `responsavel_id`, então todas passam.

### 3. A tarefa vai para uma pessoa ou para um setor — exatamente um

Na criação e na edição, "Para" escolhe **uma pessoa ativa** ou **um setor de atuação vivo** (não
excluído) **com ao menos uma pessoa ativa**. Setor vazio é recusado com 400 pelo mesmo motivo do
`Code.gs:355` para responsável inativo.

**Proibido pôr uma pessoa de enfeite em `responsavel_id`** (S-43). A tarefa de setor tem
`responsavel_id NULL`, e o `CHECK tarefa_tem_um_destino` impede nenhum destino e dois destinos.

**Trocar o destino** (pessoa ↔ setor, setor ↔ setor, pessoa ↔ pessoa) tem regra própria no
domínio, `podeTrocarDestino` (§5):

- **só em tarefa aberta** (N-25, decisão do dono). Concluída ou cancelada → **400** "Reabra a
  tarefa para trocar o destino." — para todos, inclusive `tarefas.equipe`, e inclusive na tarefa de
  pessoa. Fecha os três defeitos do N-25 (23514 em concluída pré-0066, crédito que muda de dono
  depois do fato) e o furo 3 do appsec (S-53). **Muda um comportamento de hoje:** o responsável já
  não passa uma tarefa concluída para outra pessoa.
- **depois de vencida** (`prazo < hoje`, `hoje` do servidor no fuso da clínica), **só quem solicitou
  ou quem tem `tarefas.equipe`**, nos dois sentidos (N-24, decisão do dono). A responsável e o
  membro do setor recebem **403** "Tarefa atrasada não muda de destino; peça a quem solicitou." É o
  que impede a responsável de mandar a própria atrasada para o setor e subir o % dela (inclusive de
  mês passado), e o membro de "assumir" uma atrasada sem quem pediu saber.

Contrato (`packages/contracts/src/tarefas.ts`):

- `CriarTarefa`: `responsavelId` e `setorDeAtuacaoId` opcionais, **exatamente um** (refine do Zod;
  o `CHECK` é a segunda camada).
- `EditarTarefa`: os dois opcionais, **no máximo um** por requisição. Mandar um troca o destino e
  zera o outro, no mesmo `UPDATE`. Ausentes: o destino não muda.
- `TarefaNaLista`: `responsavelId` e `responsavelNome` passam a `nullable`; entram
  `setorDeAtuacaoId`, `setorDeAtuacaoNome`, `concluidaPorId`, `concluidaPorNome` (nullable). Nenhum
  desses nomes está ou colide com `CAMPOS_MONETARIOS`.

### 4. Quem vê

**A visibilidade é derivada na leitura, a partir de quem está no setor naquele instante** — nunca
copiada para a tarefa (S-44, L-B4-3).

Uma tarefa de setor é vista por:

1. **as pessoas ativas que estão no setor no momento da leitura**, e delas, **só** (LGPD condição
   2, decisão do dono):
   - as tarefas **abertas**;
   - as **concluídas no dia corrente** (`concluida_em` no dia de hoje do servidor, no fuso da
     clínica).

   O histórico do setor — concluídas de outros dias e canceladas — **não** é visto pelo membro. Sem
   esse recorte, a enfermeira contratada em 2027 veria, pelo filtro do próprio setor, toda tarefa
   concluída da Enfermagem desde 2026, de pacientes que nunca atendeu. A cancelada não entra nem no
   dia: `tarefas` não guarda o instante do cancelamento, e o recorte fica do lado de negar;
2. o **solicitante**, sem recorte (escopo *Solicitei*, como hoje);
3. quem tem **`tarefas.equipe`**, sem recorte (escopo *Equipe toda*, como hoje).

Quem sai do setor ou é desativada deixa de ver na requisição seguinte. Tarefa num setor excluído
continua visível a 2 e 3: nunca some.

**O pertencimento vem do banco, e o tipo garante isso** (S-42, S-56). `autorDe` e `leitorDe`
continuam **sem** setor. O setor entra por uma função `comSetorAtual(c: pg.PoolClient, autor)`, que
só existe com uma conexão aberta e é chamada dentro de `naClinica`, na mesma transação da leitura ou
do `FOR UPDATE`. `ContextoDaRequisicao`, a sessão e qualquer cache **não** ganham campo de setor (um
teste lista as chaves do contexto). Setor ausente vale `null`, e `null` não é membro de nada: o erro
fica do lado de negar.

**O fragmento SQL do pertencimento tem texto obrigatório** (S-52), numa constante só,
`DO_MEU_SETOR`, ao lado de `FORA_DO_RECONTATO`:

```sql
(t.setor_de_atuacao_id IS NOT NULL
 AND t.setor_de_atuacao_id = (SELECT p.setor_de_atuacao_id FROM pessoas p
                               WHERE p.id = <eu> AND p.ativo AND p.excluida_em IS NULL)
 AND (t.status = 'aberta'
      OR (t.status = 'concluida'
          AND (t.concluida_em AT TIME ZONE <fuso>)::date = <hoje>::date)))
```

**Proibidos** neste fragmento: `IS NOT DISTINCT FROM`, `coalesce` com sentinela, `= ANY` com array
que pode ter `NULL` — qualquer um deles faz a pessoa **sem setor** casar com **toda tarefa de
pessoa** da clínica, e o *Para mim* dela vira *Equipe toda*. Toda **negação** de filtro de escopo
(`ocultasPeloFiltro` e qualquer outra) usa `IS NOT TRUE` ou `NOT coalesce(…, false)`, nunca
`NOT (…)` sozinho: com `NULL` no meio, `NOT (false OR NULL)` é `NULL` e o aviso "N tarefas não
aparecem" fica em zero para quem não tem setor.

**Setor nunca autoriza** (L-B4-3, S-46). Ele muda **quem** recebe a tarefa, nunca **o que** ela
mostra: a tarefa de setor passa pela mesma leitura (`SELECT_TAREFA`), pela mesma redação de valores
(`redacao.interceptor.ts`) e pelos mesmos portões (`podeJornada` para os três blocos, `pacientes`
para o link da ficha) que uma tarefa atribuída à própria pessoa.

O que muda nas consultas, e muda **junto** (S-43):

| Onde | Hoje | Com setor |
|---|---|---|
| `filtroDeEscopo` `meu` | `responsavel_id = eu` | `responsavel_id = eu OR DO_MEU_SETOR` |
| `filtroDePasso` `meu` | `responsavel OR solicitante` | os dois `OR DO_MEU_SETOR` |
| `solicitei` / `equipe` | — | sem mudança |
| `ocultasPeloFiltro` | `NOT (meu)` | `(meu) IS NOT TRUE` |
| `faixaDaSemana` | usa `filtroDeEscopo` | herda |
| `exigirEscopo` | 403 em filtro de outra pessoa sem `tarefas.equipe` | o mesmo para `?setorDeAtuacaoId=` que não é o setor atual (lido por `comSetorAtual`) |
| Filtro por setor em Tarefas | — | segunda camada na própria consulta: `AND (<podeEquipe> OR DO_MEU_SETOR)` (S-57) |
| `ConsultaDeHoje` | — | **não** aceita `setorDeAtuacaoId` (`strict`, 400) |
| `uma` (`GET /v1/tarefas/:id`) e `carregar` | `podeEditar` | com `comSetorAtual`, e o recorte de 1 vale: membro que não vê recebe 404 |
| `SELECT_TAREFA` | `JOIN pessoas pr` | `LEFT JOIN pessoas pr`, `LEFT JOIN setores_de_atuacao sa`, `LEFT JOIN pessoas pc` (concluída por) |
| Sessão de suporte (`eu = ''`) | `SEM_PESSOA` | `SEM_PESSOA` — o operador vê pelo `equipe` |

### 5. Quem conclui, edita, reabre, cancela, exclui

Decidido em `packages/domain/src/tarefa.ts`, com teste de domínio por tabela, nunca em `if` de
controlador (S-45). `TarefaParaAutorizar` ganha `setorDeAtuacaoId: string | null`,
`concluidaPorId: string | null`, `prazo` e `diaDaConclusao: string | null` (no fuso da clínica);
`responsavelId` passa a `string | null`. `Autor` ganha `setorDeAtuacaoId: string | null`, preenchido
só por `comSetorAtual`. As funções que dependem do dia recebem `hoje` do servidor (regra 24).

Uma função auxiliar, `membroVe(t, a, hoje)`, é o recorte do §4.1 em TypeScript: mesmo setor, os dois
não nulos (`null === null` **não** é pertencer), e a tarefa aberta ou concluída hoje.

| Ação | Tarefa de pessoa | Tarefa de setor |
|---|---|---|
| **Concluir** | qualquer um, como hoje (risco aceito, S-55) | **membro do setor, solicitante ou `tarefas.equipe`** (S-55) — "qualquer um conclui" do dono é "qualquer um que vê"; quem não pode recebe 403 **sem o corpo da tarefa** |
| **Editar** (campos que não são destino) | solicitante, responsável, `tarefas.equipe` | solicitante, `membroVe`, `tarefas.equipe` (P5) |
| **Trocar destino** | `podeTrocarDestino`: só aberta (400); vencida só solicitante ou equipe (403); senão quem pode editar | o mesmo |
| **Reabrir** | como hoje (`podeEditar`) | **quem a concluiu**, **o solicitante** ou **`tarefas.equipe`** (P8, S-54). O membro que não a concluiu **não** reabre. Quem a concluiu reabre enquanto ainda a vê (`membroVe`: no setor, e no dia da conclusão) — o membro só reabre o que enxerga (LGPD condição 2) |
| **Cancelar** | solicitante, `tarefas.equipe` | o mesmo — o membro **não** cancela (P5) |
| **Excluir** | solicitante, `tarefas.equipe` | o mesmo — o membro **não** exclui (P5) |

Códigos de erro: estado que impede (`TAREFA_CANCELADA`, `TAREFA_JA_CONCLUIDA`) → 409, como hoje;
`DESTINO_SO_EM_TAREFA_ABERTA` → 400; autorização (incluindo `TAREFA_ATRASADA_NAO_MUDA_DESTINO`) → 403.

**O ponto da meta não se toma**: trocar o destino de uma concluída é 400 (furo 3 do appsec); reabrir
a concluída de outra pessoa do setor é 403 (furo 4); concluir sem ver é 403 (furo 5).

### 6. Quem conclui, e para quem conta

- **`concluida_por` = a pessoa da sessão** (`autorDe`, que já recusa a sessão de suporte — D-13,
  AB-B4-7). **Todo caminho que muda `status` trata a coluna** (N-26):

  | Caminho | `concluida_por` |
  |---|---|
  | `conclusao.service.ts:182` (concluir) | grava `autor.id` |
  | `sessoes.service.ts:134` (concluir sessão) | grava `autor.id` |
  | `contagens.service.ts:474` (fechar contagem) | grava a pessoa que fechou; `NULL` se não for pessoa (a tarefa de contagem é sempre de pessoa, o `CHECK` permite) |
  | `conclusao.service.ts:259` (cancelar) | zera |
  | `conclusao.service.ts:322` (reabrir) | zera |
  | `sessoes.service.ts:275` (reabrir sessão) | zera — **sem isso, nenhuma sessão concluída reabre depois da 0066** (23514), e é por ali que a baixa de insumo é restaurada |
  | `montador.service.ts:323`, `programas.service.ts:182`, `sessoes.service.ts:299/402` | já a salvo: só tocam `status = 'aberta'` |

  Um teste-guarda varre `apps/api/src`: todo `UPDATE tarefas SET status` menciona `concluida_por`.
  O valor zerado fica na `auditoria`.
- **Duas conclusões simultâneas** dão uma: `carregar` trava a linha com `FOR UPDATE`, e a segunda
  recebe 409 `TAREFA_JA_CONCLUIDA` (AB-B4-5).
- **Duas expressões, no mesmo módulo, cada uma com seu uso** (N-23):
  - **`PESSOA_QUE_CONTA = coalesce(t.responsavel_id, t.concluida_por)`** — **produção**: `contatos`,
    `orc_qtd`, `orc_valor`, `recebimentos`. Tarefa de pessoa conta para o **responsável** (mesmo que
    outra pessoa a conclua — como hoje); tarefa de setor conta para **quem concluiu**. Nunca "o
    setor", nunca todos os membros. Essas consultas filtram `status = 'concluida'`, então uma chave
    `NULL` ali só existe se um `CHECK` tiver sido violado: **lança erro**, como `emPercentual` faz
    com `no_prazo > total` — nunca `continue` calado (N-29). O tipo da linha passa a `pessoa:
    string | null` para o compilador obrigar a decisão.
  - **`DESTINO_DO_PRAZO`** = `t.responsavel_id`, senão `t.setor_de_atuacao_id` — **prazo**:
    `consultarPrazos` e `tarefas_prazo`. **`concluida_por` nunca entra em prazo.** Quem resgata a
    tarefa atrasada do setor não leva o atraso para a linha dela, e a linha do setor não esquece que
    ele atrasou.
- **Percentual no prazo da meta individual** (`tarefas_prazo`): só tarefa de pessoa (`AND
  t.setor_de_atuacao_id IS NULL`, P4). Pessoa cujas únicas tarefas do mês são de setor fica com
  `null` ("sem dado"), nunca `0`. A trava do N-24 (§3) é o que impede P4 de virar porta de fuga do %.
- **Painel — prazos** (`consultarPrazos`): agrupa por `DESTINO_DO_PRAZO`, com uma linha por pessoa
  e uma por setor ("Enfermagem (setor de atuação)"), cada uma com as cinco colunas. **A soma das
  linhas é exatamente o total, coluna por coluna.** O total é identificado por **`GROUPING()`**,
  nunca por `pessoa = null`, e a ordem é **determinística**: `ORDER BY GROUPING(...) DESC, total
  DESC, tipo, nome, id` (N-27). O contrato `LinhaPorResponsavel` vira união discriminada por `tipo`
  (`'pessoa'` com `pessoaId`; `'setor'` com `setorDeAtuacaoId`), e o nome do setor vem de `LEFT JOIN
  setores_de_atuacao` **sem** filtrar `excluido_em` — setor excluído com tarefas no período continua
  com a linha dele, e a soma continua batendo (N-31).
- **Registro corrigido** (N-27): com `responsavel_id` anulável e a consulta de hoje, o total sairia
  certo **por coincidência** (`ORDER BY count(*) DESC` põe o total antes da linha `NULL` do setor) e
  o que quebra é a **linha do setor, que some**. A carteira não teria recebido total falso, e não há
  `uso_diario_cliente` a reprocessar. `GROUPING()` continua obrigatório.
- **A carteira recebe só o total**, como hoje (N-32). `tarefas_no_prazo` passa a incluir tarefa de
  setor — a carteira mede a clínica. Nome de setor e pertencimento não atravessam (ADR 0013 §2).
- `para_si` do Painel: sem mudança; `NULL = x` não conta, a tarefa de setor cai em `paraAEquipe`, e
  `solicitadas = paraSiMesma + paraAEquipe` continua fechando.
- **Funil por pessoa** (`responsavel OR solicitante`): sem mudança (N-33). A tarefa de setor
  concluída por A não aparece no funil filtrado por A, mas conta na produção de A: são perguntas
  diferentes, e o MANUAL explica.
- **Os números, por escrito** (N-28): *a 0066 sozinha não muda número de mês nenhum. Depois dela, um
  mês passado só muda pelos caminhos que já existem (reabrir, corrigir `realizadaEm`, trocar o
  responsável de tarefa aberta), e **nunca** pela troca de destino para ou de um setor (§3, N-24,
  N-25).* A meta é recalculada na leitura (`metas.service.ts`), não congelada.

### 7. Filtros "Para mim" / "Solicitei" / "Equipe toda"

- **Para mim** inclui as tarefas do **meu setor de atuação atual**, com o recorte do §4.1 (P6): a
  recepcionista abre Hoje e vê o que é dela e o que está aberto (ou foi concluído hoje) na Recepção.
- **Solicitei** e **Equipe toda**: sem mudança, e sem recorte.
- **Tela Tarefas**: filtro "Setor de atuação" (`setorDeAtuacaoId`), liberado para o próprio setor e,
  para os outros, só com `tarefas.equipe` — duas camadas (S-57). Para o membro, o filtro do próprio
  setor mostra só abertas e concluídas hoje, qualquer que seja a situação ou o período pedidos. O
  filtro "Responsável" não traz tarefa de setor.
- **Concluídas do dia** em Hoje: as do meu setor concluídas hoje, com "Concluída por Camila". Em dia
  navegado que não é hoje, nenhuma concluída de setor aparece para o membro.

### 8. Quem gerencia setores (P7)

**`config`** (S-41). Não `pessoas.gerir`: essa é a chave do RH e do salário, e setor não é RH.

- `GET /v1/setores-de-atuacao` — **id e nome** dos setores vivos, para qualquer sessão da clínica.
- `GET /v1/setores-de-atuacao/pessoas` — quem está em cada setor, **só pessoas ativas**, `{id,
  nome}` (LGPD condição 6). `@Exige('config')`.
- `POST`, `PATCH /:id` (renomear), `POST /:id/excluir` — `@Exige('config')`.
- **Rotas de setor (S-59):** `ParseUUIDPipe` em todo `:id` (400, nunca 500). Id de outra clínica ou
  de setor excluído: **404**, decidido pelo `SELECT … FOR UPDATE` vazio ou pelo `rowCount` do
  `UPDATE`, nunca 200; nada gravado, nenhuma linha na `auditoria`. O 409 de exclusão leva **só as
  contagens**, nunca nomes.
- `setorDeAtuacaoId` só é aceito em criar pessoa e `PATCH /v1/pessoas/:id` (`@Exige('config')` na
  classe). Nenhuma rota de "minha conta" o aceita (Zod `strict`). **Ninguém se põe num setor
  sozinho** (AB-B4-3). Quem tem `config` pode se pôr num setor, e isso não abre nada novo: `config`
  já se dá `tarefas.equipe`.
- `GET /v1/equipe` **não** ganha o setor de cada pessoa (minimização).
- Sessão de suporte: gerencia como a administradora (escrita com `ator_tipo = 'operador'`); não
  conclui.

### 9. Ciclo de vida do setor

- **Criar** e **renomear**: nome único por clínica entre os vivos. Dica fixa: *"Setor é onde a
  pessoa atua, não a situação dela."* (L-B4-2).
- **Excluir** é soft delete e **só com o setor vazio**: sem pessoa ativa e sem tarefa aberta;
  senão 409 com as duas contagens. A exclusão trava o setor (`FOR UPDATE`); criar ou editar tarefa
  para o setor **e** pôr uma pessoa no setor leem o setor com `FOR SHARE` (S-59). As operações se
  serializam: nunca nasce tarefa nem pessoa ativa num setor excluído.
- **Reativar uma pessoa cujo setor foi excluído zera `setor_de_atuacao_id`** na mesma transação
  (S-59); a troca fica na `auditoria`.
- **Desativar ou excluir uma pessoa nunca é bloqueado** pelo setor. A pessoa desativada continua
  apontando para o setor (L-B4-5), não vê nada, e não aparece na lista de pessoas por setor.

### 10. Trilha: "quem podia ver esta tarefa naquela data"

**10.1 — As fontes.** Nenhuma tabela nova; tudo já é escrito pela trigger `registrar_auditoria`, de →
para, com ids. O público da tarefa T na data D é a **união** de (LGPD condição 3):

- (a) os **membros ativos em D** — `auditoria` de `pessoas` (`setor_de_atuacao_id` e `ativo`) —,
  **com o recorte do §4.1**: só se T estava aberta em D, ou foi concluída em D;
- (b) o **solicitante em D** — `auditoria` de `tarefas`;
- (c) quem tinha **`tarefas.equipe`** em D — `auditoria` de `pessoas.perfil_id` e de `perfis`;
- (d) as **sessões de suporte vivas em D** naquela clínica — `auditoria` de `sessoes` com
  `operador_id` (D-13), que veem por *Equipe toda*.

E o destino de T em D (pessoa ou setor) vem da `auditoria` de `tarefas`.

**10.2 — O que ela responde.** "Quem **podia** ver." Quem **efetivamente** abriu a ficha da paciente
vem da trilha de acesso (`@DadoSensivel`). A consulta documentada em `docs/compliance/` diz as duas
coisas sem confundi-las. O e2e do B4-9 reconstrói (a)–(d) só pela `auditoria`, com troca de perfil
que tira `tarefas.equipe` e com sessão de suporte, e falha ao remover a trigger de `pessoas`.

**10.3 — Trilha de acesso** (substitui o parágrafo que esta ADR deixava em aberto; LGPD condição 4):
nenhum registro `acessou` por leitura de **lista** de tarefa, de pessoa ou de setor — é o critério
de L-A2-4, e registro por leitura de lista seria ruído que esconde o que importa. As condições:
(a) a ficha da paciente continua sendo o único caminho para o histórico inteiro, com
`@DadoSensivel('pacientes')` (L-A2-2); **nenhuma** rota nova do B4 devolve tarefas de setor
filtradas por paciente; (b) o controle compensatório do alargamento é a reconstrução de 10.1, mais o
recorte do §4.1; (c) a pergunta 10.4 é respondida antes do B4-6.

**10.4 — A lista precisa da dose? (L-A2-4, S-60)** — **decidido: só o rótulo** (parecer de
`product-rotina-clinica` e segunda passada do gate de LGPD, 2026-11-09).

- **No nosso código, nenhum cartão de lista desenha a dose orçada.** A única leitura de
  `programaOrcado` numa lista é `faixa-da-jornada.tsx:301` (`temProposta`), que só pergunta se há
  proposta. O fechamento monta o programa a partir do que está gravado no banco
  (`fechamento.service.ts:123-140`), não do corpo da requisição. A dose aparece na tela em
  `ficha-do-programa.tsx:258` (Programas) e é escrita pelo montador.
- **No protótipo, a lista desenha a dose** (`esteiraCardHtml` L4790, `resumoProgOrc` L4819). Por isso
  esta decisão é uma **divergência deliberada**, registrada no cabeçalho.
- **Por que a recepção não precisa da dose no cartão.** O cartão de orçamento serve ao follow-up:
  o quê, quanto e quando retomar. A dose é decisão clínica e está a um toque, na ficha. O B4 mostra
  esse cartão a N pessoas.
- **A decisão.** As respostas de lista (`GET /v1/hoje`, `GET /v1/tarefas`, `GET /v1/tarefas/:id`
  e toda escrita que devolve `TarefaNaLista`: concluir, editar, reabrir, passos da jornada) levam o
  programa orçado **sem `dose`**, num tipo próprio, `ItemOrcadoNaLista`, que não tem essa chave.
  `paraSaida` é o único ponto que monta esse tipo a partir do `ItemOrcado`. Vale igual para tarefa
  de pessoa e de setor.
- **A dose só sai pela ficha** (LA24-3). O cartão da jornada na ficha usa o tipo **com** dose apenas
  dentro de `GET /v1/pacientes/:id` (`@DadoSensivel('pacientes')`). O web não completa a dose na
  ficha a partir de uma resposta de lista nem por outra rota sem a marcação.
- **Escrever não apaga a dose** (LA24-1). Um formulário preenchido a partir de uma resposta de lista
  (sem `dose`) que reenvie `programaOrcado` inteiro não pode apagar a dose gravada. O ticket escolhe
  uma de duas saídas e a deixa escrita: (a) toda escrita de `programaOrcado` preserva a `dose`
  gravada, item por item (`chave`), quando o item chega sem a chave; ou (b) o formulário carrega o
  item de uma leitura de detalhe sob `pacientes`. O caso concreto é o B1 ("Corrigir o orçamento já
  enviado").
- **Uma varredura prova a ausência** (LA24-2). Um teste percorre toda rota que devolve
  `TarefaNaLista` ou `ItemOrcadoNaLista`, descobertas pelo **registro de rotas** e não por uma lista
  escrita à mão, e exige zero ocorrências da chave `dose` em qualquer profundidade do corpo.
- **O que o tipo não alcança** (LA24-4). A dose ainda pode chegar à lista em **texto livre**: no
  rótulo que o montador gera para a sessão (`montador.service.ts:346-355`, "Aplicação 5/12 ·
  Tirzepatida 2,5 mg") e em `historico[].nota`. A da sessão fica: é a dose a aplicar, de quem aplica,
  e é paridade. Sessão não vai para setor, então o B4 não alarga esse caminho. Isso está registrado
  como dívida em `docs/dividas.md` e passa a **bloquear** a futura ADR de sessão para setor (§11,
  condição 7 da LGPD).

### 11. Recorrência, rotinas automáticas e sessões

- **Série**: toda ocorrência nasce com o mesmo destino. "Nesta e nas próximas" (S-58) só alcança as
  **abertas futuras com o mesmo destino** que a ocorrência editada tinha **antes** da edição
  (`responsavel_id IS NOT DISTINCT FROM $antigo AND setor_de_atuacao_id IS NOT DISTINCT FROM
  $antigoSetor` — aqui o `IS NOT DISTINCT FROM` está certo: compara dois valores da mesma série, não
  decide visibilidade). O mesmo `UPDATE` grava os **dois** destinos, um deles `NULL`, nunca um só. A
  propagação nunca toca em concluída nem em cancelada, e cada ocorrência alcançada passa pelas regras
  de §3 (vencida → só solicitante ou equipe). Como o pertencimento é lido na leitura, a ocorrência de
  março vai para quem estiver na Enfermagem em março.
- **Rotinas que o sistema cria** — contagem de estoque, tarefa de reposição, *Gerar tarefa* da meta
  e do alerta de pessoa, sincronização da agenda externa, contato de retorno do programa —
  **continuam indo para uma pessoa**.
- **Sessão de programa não vai para setor** (P3, `CHECK sessao_nao_vai_para_setor`). **Remover esse
  `CHECK` exige passar pelo gate de LGPD antes da ADR seguinte** (LGPD condição 7): aplicação, dose e
  lote para um setor é finalidade do art. 11, II, "f", com leitura própria em
  `programas/leitura.service.ts`, e não herda esta aprovação.

### 12. Migração e dados existentes

- **Nenhuma linha existente é reescrita.** A 0066 cria a tabela, adiciona colunas anuláveis, relaxa
  um `NOT NULL`, troca duas FKs simples por compostas (com a pré-condição de S-51) e adiciona
  `CHECK`s que toda linha atual já cumpre.
- Toda pessoa começa sem setor; toda tarefa existente continua de pessoa; `concluida_por` fica
  `NULL` nas concluídas antes da 0066 — **não se inventa autoria** a partir do responsável.
- **Proibido** derivar setor de `funcao`, de `cargo` ou do nome do perfil (L-B4-1).
- O migrador da v20 não muda: a v20 não tem setor, e ele já recusa tarefa sem responsável
  (`migrador.service.ts:931`).
- **A 0066 sozinha não muda número de mês nenhum** (§6, N-28), e isso é o T-B4-1: instantâneo de
  meta, Painel, funil e `uso_diario_cliente` antes e depois da 0066, sobre uma fixture fixa, igual em
  profundidade.

### 13. Notificações

**O produto não tem notificação hoje.** Esta ADR não cria nenhuma. O "aviso" que existe é o contador
de *Para mim* (`ocultasPeloFiltro`), e ele herda a regra nova (com a negação de S-52).

Regra para quando houver: o destinatário de uma notificação de tarefa de setor é resolvido **no
envio**, por `DO_MEU_SETOR`, e o conteúdo não leva nome de paciente nem de pessoa (L-B4-7).

### 14. LGPD

**14.1 — Classes.** Quatro linhas entram em `docs/compliance/retencao.md`, **no mesmo PR da 0066**,
numa subseção `### Setor de atuação e conclusão de tarefa (ADR 0025, migration 0066)`, com o texto
exato da revisão do gate LGPD (condição 1):

| Dado | Base | Titular | Prazo |
|---|---|---|---|
| `setores_de_atuacao` | — (não é dado pessoal) | — | enquanto em uso; soft delete |
| `pessoas.setor_de_atuacao_id` | art. 7º, V | funcionária | o da identidade `pessoas` (vínculo + 5 anos); histórico na trilha (5 anos) |
| `tarefas.concluida_por` — **dado novo de desempenho de funcionária, em toda tarefa concluída a partir da 0066**, lido pela meta | art. 7º, V | funcionária | o da linha da tarefa, nunca menos que o horizonte da meta fechada; fica ao anonimizar a paciente; não entra no extrato do paciente |
| `tarefas.setor_de_atuacao_id` | — (a tarefa herda a classe dela) | — | o da linha da tarefa |

**14.2 — Exportação** (dívida do §4 de `retencao.md`; LGPD condição 5). O extrato do **paciente** não
leva `concluidaPorNome`, `responsavelNome` nem o nome do setor junto de quem estava nele. O extrato da
**funcionária** leva o setor atual, o histórico de setor (datas de entrada e saída) e **quantas**
tarefas concluiu por período — nunca o nome, o telefone ou o conteúdo das tarefas, que são de
pacientes. Nunca a lista das colegas (L-B4-6).

**14.3 — Log.** Nome de pessoa, nome de paciente e nome de setor junto de paciente fora do log; as
mensagens de 400/409 do setor não trazem nome (L-B4-7, regra 21).

**14.4 — O alargamento, declarado ao gate (S-60, S-47).** Esta ADR aumenta o público de uma tarefa
com paciente de "solicitante + responsável + `tarefas.equipe`" para "solicitante + **pessoas ativas
do setor no momento da leitura**, só nas abertas e concluídas do dia + `tarefas.equipe`". O caso
concreto: o perfil padrão **Enfermagem** (`perfisPadrao`, `pf_enf`) tem só `programas` e `estoque` —
**não tem `pacientes` nem `jornada`** — e mesmo assim passa a ver **nome e telefone** do paciente de
**toda** tarefa mandada para o setor dela, por **qualquer** pessoa da clínica. Antes, isso só
acontecia quando alguém escolhia aquela pessoa específica como responsável. É o mesmo dado que ela
veria numa tarefa atribuída a ela (§4), mas o público passa a ser decidido por outra pessoa, de uma
vez, para o setor inteiro. O que limita o alargamento:

1. setor nunca autoriza — sem `jornada`, sem `valores`, sem link para a ficha sem `pacientes` (§4);
2. ninguém entra num setor sem `config` (§8);
3. o membro não vê o histórico do setor, só abertas e concluídas do dia (§4.1);
4. a lista não leva dose (§10.4);
5. sessão de programa não vai para setor (§11);
6. a reconstrução de "quem podia ver" (§10.1).

**O gate de LGPD registrou ciência e aceite** desta declaração (segunda passada, item (b)), com três
condições: **S60-1**, ao escolher um setor no campo "Para" de uma tarefa com paciente, aparece o
texto fixo *"Todas as pessoas ativas de {setor} verão esta tarefa, com o nome e o telefone da
paciente."*, sem contagem e sem nomes, repetido no MANUAL (ticket B4-8); **S60-2**, o registro do
controlador em `docs/decisoes.md`, junto do DPA (orquestrador); **S60-3**, um teste com o perfil
`pf_enf` real (ticket B4-6).

## Consequências

- `responsavel_id` deixa de ser garantia de "tem pessoa". Todo consumidor que lê `responsavelNome`
  como `string` trata `null` — o cartão, a lista, o painel de edição, a jornada, `tela-painel.tsx`.
  `grep responsavel` em `apps/api/src` dá 42 arquivos fora de teste; os que tocam `tarefas` estão no
  spec.
- `responsavel_id` e `solicitante_id` ganham FK composta: a segunda camada que faltava desde a 0006.
- A meta ganha duas expressões nomeadas (`PESSOA_QUE_CONTA`, `DESTINO_DO_PRAZO`) no lugar de
  `t.responsavel_id` espalhado, e o Painel ganha uma linha por setor.
- **Comportamento que muda para todas as tarefas, não só as de setor:** trocar o destino de tarefa
  concluída ou cancelada passa a ser 400; trocar o destino de tarefa vencida passa a exigir
  solicitante ou `tarefas.equipe`. O MANUAL explica, junto com "concluir pelo setor não pesa no seu %;
  assumir pesa" (N-24).
- A tarefa da clínica passa a ter registro de quem concluiu, em toda conclusão nova.
- O B4 depende de arquivos que, nesta onda, são de outras frentes. Constrói-se **depois** da
  integração desta onda.

## Alternativas rejeitadas

- **Pôr "alguém do setor" em `responsavel_id`.** É a pessoa de enfeite que S-43 proíbe.
- **Copiar os membros para a tarefa na criação.** Quem sai continuaria vendo, quem entra não veria.
- **Membro vê todo o histórico do setor.** Abre o passado a quem entra (LGPD condição 2).
- **Creditar a meta "ao setor" ou a todos os membros.** Dilui a responsabilidade e conta N vezes.
- **Uma expressão só para produção e prazo** (`PESSOA_QUE_CONTA` também no prazo). Põe o atraso do
  setor na linha de quem o resgatou e tira da linha do setor (N-23).
- **Creditar sempre quem concluiu, também na tarefa de pessoa.** Mudaria os números de todos os
  meses já fechados.
- **Deixar `tarefas.equipe` trocar o destino de concluída** (redação original de S-53). O dono
  escolheu a regra mais estrita (N-25): reabrir primeiro, e a reabertura fica na trilha.
- **Membro reabre qualquer tarefa do setor.** Permite tomar o ponto reabrindo e concluindo (S-54).
- **Setor como perfil de acesso.** Junta "onde trabalho" com "o que posso".
- **Derivar setor de `funcao` ou de `cargo`.** L-B4-1 proíbe.
- **Tabela de vínculo N:N pessoa↔setor.** Ninguém pediu duas. Se a clínica precisar, é ADR nova.
- **`pessoas.gerir` como chave de gestão.** É a chave do salário.
- **Redigir `dose` por nome de chave no interceptor**, em vez de um tipo de lista sem a chave. Dose
  é legítima na ficha e em Programas; uma redação por rota é o `if` por endpoint que a regra 17
  proíbe.
- **Os nomes:** `Setor` sozinho (carteira); `Equipe de atuação` (`Equipe` já é escopo, chave e
  tela); `Área` (não é palavra do dono); `Grupo` (carteira); `Função` (`pessoas.funcao`); `Unidade`
  (`unidades`).

## 16. Decisões do dono (2026-11-09)

| # | Pergunta | Resposta |
|---|---|---|
| P1 | Nome na tela | "Setor de atuação" |
| P2 | Quantos setores por pessoa | Um |
| P3 | Sessão de programa para setor | Fora nesta versão; a próxima ADR passa antes pelo gate de LGPD |
| P4 | Tarefa de setor no % no prazo da meta individual | Fora; o atraso do setor fica na linha dele no Painel |
| P5 | Membro do setor | Edita e reabre (nos termos de P8); não cancela nem exclui |
| P6 | *Para mim* | Inclui o setor atual, com o recorte do §4.1 |
| P7 | Quem gerencia setores | Quem tem `config` |
| P8 | Reabrir tarefa de setor concluída (S-54) | Só quem a concluiu, quem a solicitou ou quem tem `tarefas.equipe` |
| N-24 | Trocar o destino depois de vencida | Só quem solicitou ou `tarefas.equipe`, nos dois sentidos; a responsável recebe 403 |
| N-25 | Trocar o destino de tarefa não aberta | Nunca: concluída → 400 |
| LGPD 2 | O que o membro vê | Só abertas e concluídas no dia corrente; o histórico fica com solicitante e *Equipe toda* |

**§10.4, decidido:** "só o rótulo" (parecer de `product-rotina-clinica`, com o gate de LGPD). A
recomendação (R) da LGPD condição 2 — o membro ver
também as que **ele** concluiu enquanto estiver no setor — **não** foi adotada: o dono decidiu o
recorte estrito, e a meta já mostra a ela quanto concluiu.
