# Spec — nove pedidos da cliente (grupos, fluxo, estoque, financeiro, orçamento)

Data: 2026-11-14. Status: **decisões do dono aprovadas (Q1–Q9, "sim" a todas)**; aguarda gate de risco.
Escopo: app da CLÍNICA (lado A: `pessoas`, `tarefas`, `recebimentos`, RLS por `clinica_id`). Nada na carteira Firmare.
Substitui/implementa a ADR 0025 (setor de atuação), aceita e nunca construída.

## Fatia 1 — correções

### 1.1 "Começar em outra data" no orçamento
- Defeito: `montador.tsx:278` zera `inicio` ao escolher "data"; `itensDoMontador()` (`faixa-da-jornada.tsx:583`) não envia `inicio`; `ItemOrcado` (`contracts/jornada.ts:41`) é `.strict()` sem `inicio`; fechamento fixa `inicio: null` (`fechamento.service.ts:323`).
- Decisão (Q9): o orçamento guarda a data por procedimento (`inicio` opcional, `YYYY-MM-DD`, validada) em `programa_orcado`; o fechamento a usa. Se a data já passou ao fechar: o servidor devolve aviso confirmável (padrão `confirmar…`), nunca muda sozinho. Data nunca vem do relógio do cliente (regra 24): é dado escolhido, o "passou" é calculado no servidor no fuso da clínica.
- Corrigir divergências tela × contrato no mesmo formulário: sessões (tela 104 × contrato 60), dose (60 × 40), itens (12 × 10), sessões vazias (`Number('')` = 0), `depoisDe` deslocado ao remover item, Prévia com `ITEM_INEXISTENTE`. Fonte única: o contrato manda; a tela lê os limites dele.
- Aceite: teste de contrato (aceita `inicio`, recusa lixo), e2e registrar→fechar com data por item, teste do seletor.

### 1.2 XML da NF-e
- Código está ativo (`entrada-pela-nota.tsx`, `POST /v1/estoque/notas/ler`, exige `estoque.gerir`). Reproduzir no navegador com o XML da cliente (se houver) ou um XML de teste; descobrir se é permissão, arquivo, UI escondida ou erro. Só então decidir correção. Sem mudança de regra de estoque.
- **Causa achada (2026-11-15): permissão.** O botão e as duas rotas exigiam `estoque.gerir`; em produção, Recepção e Enfermagem (as 7 clínicas) veem Estoque mas não têm a chave, e por isso "a opção sumiu". O protótipo mostra "Entrada pela nota" a todo perfil de estoque e restringe só o custo. Corrigido seguindo o protótipo: rotas com `estoque`; o custo da nota continua de `estoque.gerir` (sai `null` na leitura e é recusado no registro, como em `movEstoque`). Teste: `estoque.e2e.test.ts`, "a NOTA é de quem tem `estoque`; o CUSTO dela, só de `estoque.gerir`".

## Fatia 2 — grupos, tarefa para grupo, transferência, fluxo

Termos novos para `CONTEXT.md` antes do código: **Grupo** (de colaboradores, não de acesso), **Transferência**.

### Modelo
> **Desvios na implementação (2026-11-14):** a tabela é `grupos_da_equipe` (o nome `grupos` já existe na carteira, migration 0025), e `membros_de_grupo` tem `id` PK + `UNIQUE (clinica_id, grupo_id, pessoa_id)` em vez de PK composta (exigência do teste `auditoria-inescapavel`). A regra "cadeia do mesmo paciente" virou trigger (0089). Ver a ADR `2026-11-14-grupos-de-colaboradores-substitui-setor-de-atuacao.md`.
- `grupos` (id, clinica_id, nome 2–60 único por clínica sem caixa, ativo, criado_em). Desativa, nunca exclui (regra 20). RLS `por_clinica` + FORCE + GRANT `fir_app` + trigger `registrar_auditoria`.
- `membros_de_grupo` (clinica_id, grupo_id, pessoa_id, PK composta; FK composta `(id, clinica_id)`): pessoa em 0..N grupos. Auditoria idem.
- `tarefas`: `grupo_id` nulo; `responsavel_id` continua NOT NULL hoje → relaxar para NULL com CHECK `tarefa_tem_destino`: exatamente um de `responsavel_id` / `grupo_id` (destino exclusivo, Q1). `tarefa_origem_id` nulo (FK composta, índice parcial). Expand-only, colunas nuláveis; dados migrados continuam válidos.
- Eventos do fluxo: gravar em `historico` (jsonb) novas ações `atribuir`, `transferir`, `assumir` com `{de:{tipo,id}, para:{tipo,id}, porId, em, nota?}`; hoje o histórico é só de paciente (jornada) — estender para a tarefa interna. Quem concluiu: `porId` (pessoa), sempre.
- Fluxo completo: `GET v1/tarefas/:id/fluxo` percorre `tarefa_origem_id` (CTE recursiva, profundidade limitada, só da mesma clínica) e devolve a linha do tempo.

### Regras
- **Hoje/consulta**: `filtroDeEscopo` e `filtroDePasso` incluem tarefas cujo `grupo_id` está entre os grupos da pessoa (Para mim). Contadores seguem a mesma regra. Índice novo `(clinica_id, grupo_id, prazo)` parcial nas abertas.
- **Assumir**: membro do grupo fixa a tarefa em si (`responsavel_id` = ele, `grupo_id` = NULL); evento `assumir`. Idempotente/concorrente: `UPDATE … WHERE grupo_id = $g AND responsavel_id IS NULL`.
- **Concluir**: qualquer membro do grupo; registra a pessoa. Cancelar/excluir seguem solicitante ou `tarefas.equipe`.
- **Transferir** (`POST v1/tarefas/:id/transferir`): quem pode = responsável atual, membro do grupo atual, ou `tarefas.equipe`. Destino pessoa ativa ou grupo ativo, da mesma clínica. Motivo opcional ≤200. Evento no histórico. Sessão de suporte recusada (D-13). `podeEditar`/`podeConcluir` em `packages/domain/src/tarefa.ts` ganham o conceito de membro (função pura, fonte única, regra 16).
- **Ver fluxo**: quem tem `tarefas.equipe` vê a cadeia inteira; os demais veem só o trecho das tarefas que enxergam. Tarefa de paciente: cadeia nunca atravessa para a carteira (ADR 0013).
- **Criação**: `CriarTarefa` aceita `grupoId` XOR `responsavelId`; "concluir e criar nova" passa `tarefaOrigemId`.
- Cadastro de grupos: aba "Grupos" em Usuários e acessos; campo "Pertence a algum grupo?" (multi) no cadastro de pessoa. Permissão: `config` (já gere pessoas/perfis); sem permissão nova.
- Privacidade: `v1/atividades` segue mostrando só nomes de campo; membros de grupo e carga por grupo são dado de RH → não expor contadores de pessoa a quem não tem `pessoas.gerir`.

## Fatia 3 — estoque

### 3.1 Aba "Consumo" na ficha do paciente
- `GET v1/pacientes/:id/consumo`, `@DadoSensivel('pacientes')` (registro de acesso na leitura, regra 18), `@Exige('estoque')` e visibilidade de paciente como a aba Orçamentos. Linha: data, item, quantidade (formatada pela conversão do item), lote, quem registrou, origem (tarefa/sessão). **Sem custo** (redação por nome de chave). Compensações aparecem como estorno ligado à origem. Sem dose além do que o movimento já tem. Teste em `acesso-sensivel.test.ts`.

### 3.2 Inventário: concluir a contagem JÁ atualiza o saldo — DECIDIDO (dono, 2026-11-14): sem movimento de ajuste
- Depois de concluída, a revisão mostra diferença por item/lote (já existente, esperado só pós-fechamento — regra 14 intacta). Botão **"Aplicar ajuste"**, exige `estoque.gerir`; o usuário marca quais itens aplicar. Cada item aplicado gera um movimento `ajuste` (append-only, motivo fixo "Inventário" ≤40, `contagem_id` novo nulo ligado à contagem). A diferença original e o ajuste ficam gravados juntos na contagem (histórico preservado). Idempotente por (contagem, item, lote): não aplica duas vezes. Nunca automático (regra 13). Ajuste é movimento, nunca UPDATE (regra 12); saldo continua derivado (regra 11).
- Contagem às cegas: nenhuma tela/rota nova expõe esperado de contagem aberta; `transporte-as-cegas.test.ts` cobre.
- A "lista extraída" não foi localizada no código: perguntar à cliente o que ela usa hoje (não bloqueia).

## Fatia 4 — financeiro (passa pelo validador-numeros antes de código)

### 4.1 Várias formas no recebimento
- `recebimento_partes(recebimento_id, clinica_id, forma, valor bigint > 0)`; soma das partes **= valor** do recebimento (validação de domínio e CHECK/trigger de deferred constraint). `recebimentos.forma` permanece como forma única quando há 1 parte e passa a `'Mista'`... **decisão para o gate**: manter `forma` e só criar partes quando N ≥ 2, ou sempre criar partes? Recomendação do spec: sempre criar partes (uma fonte única de "forma"); `recebimentos.forma` vira derivada/legado e deixa de ser lida. Migrar dados existentes para uma parte cada, expand/contract.
- Divisão manual (a pessoa digita cada valor), sem rateio automático; a soma tem de fechar com o valor exato, o formulário mostra "falta R$ X". Se algum dia houver rateio, regra 2.
- **Promissória não se mistura** (Q8): se uma parte é "Nota promissória", é a única parte. Venda a prazo (`valor = 0`, `valor_aberto > 0`) inalterada; `valor_aberto` fica **só no recebimento**, nunca nas partes (evita dobrar a dívida).
- Quem lê forma passa a ler partes: caixa (`caixa.service.ts`, `caixa.ts` — esperado por forma = soma das partes), visão do mês (`porForma`, às cegas), painel geral, `funil.service.ts`, `leitura.ts`, `programas/leitura.service.ts`, avisos de duplicidade (compara total do recebimento, não parte), estorno (estorna o recebimento inteiro → todas as partes), migração/conferência. Índice `recebimento_por_tarefa` fica (continua 1 recebimento por tarefa).
- Telas: botão "Incluir mais de uma forma de pagamento" em Recebimentos, no bloco "Houve pagamento?" da tarefa e no fechamento de orçamento/nova adesão.
- Testes obrigatórios: property-based (soma das partes = valor, centavos), receita do mês não dobra, caixa por forma bate, estorno zera todas as partes, idempotência por `requisicao_id` com partes.

### 4.2 Outras entradas
- `categorias_de_entrada` (clinica_id, nome, ativa) cadastrável + `outras_entradas` (clinica_id, categoria_id, data de negócio, valor bigint > 0, forma, descrição ≤120, estornada_em, requisicao_id idempotente, criado_por). Sem paciente. Append-only no sentido de estorno por marca (como recebimentos), trilha de auditoria.
- Entra: caixa do dia pela forma (só as 4 formas da gaveta; promissória recusada), Visão do mês e painel numa linha **"Outras entradas"** com total, separada de "Recebido".
- **Não entra**: LTV, campanhas, ticket médio, indicadores por paciente/tarefa, tarefa companheira.
- "Recebido no mês" (regra 3/4) permanece só de `recebimentos`; resultado do mês = recebido + outras entradas − despesas pagas, com as duas parcelas visíveis. Receita nunca conta o mesmo dinheiro duas vezes: entrada avulsa de paciente continua sendo `recebimento`; "outra entrada" é só o que não é de paciente.
- Permissão: nova chave? **decisão para o gate**: reaproveitar a de recebimentos/financeiro e a redação de `valor` já existente (`valores`).
- Conferência de migração (regra 28): como a tabela nasce vazia, nada migra; o teste de conferência do mês inclui a nova linha.

## Ordem, qualidade e gate
1. Gate de risco sobre ESTE spec: `especialista-seguranca-appsec`, `especialista-lgpd-saude`, `validador-numeros`. Vetos voltam como emendas ao spec.
2. Tickets por fatia; propriedade de arquivos declarada por agente (um dono por arquivo).
3. TDD nos seams: HTTP (e2e Postgres real), `packages/domain` puro, RLS (isolamento de clínica).
4. Por fatia: `pnpm typecheck && pnpm test && pnpm build`, `revisor-codigo`, `validador-numeros` (fatias 3.2 e 4), validação no Chrome, `claude-security:scan` nas mudanças.
5. Deploy só quando o dono pedir.

## Perguntas ainda abertas (não bloqueiam)
- O que a cliente usa hoje como "lista de contagem" extraída (item 7)?
- XML: o arquivo dela falha? (item 5)

---

# Emendas do gate (2026-11-14) — valem sobre o texto acima

## E-N — Números (validador-numeros)
- **N1 (veto) — 3.2 suspensa.** O saldo já é "última contagem + movimentos depois": concluir a contagem JÁ fixa o saldo no contado. Um movimento `ajuste` gravado depois soma por cima e DOBRA a diferença (medido: anterior 10, contado 8, ajuste −2 → saldo 6; correto 8; a próxima análise acusa +2 fantasma). Gravar antes reescreve o esperado da análise (viola a regra 13). Opções: (a) botão "Reconhecer diferença": registro append-only `diferencas_reconhecidas` (contagem, item, lote, diferença congelada, motivo, quem, quando), efeito zero no saldo; (b) ajuste só para lote não coberto pela contagem (outro pedido). A decisão depende do que a cliente espera ver no saldo; pergunta ao dono pendente.
- **N2 — idempotência (se algum dia houver ajuste):** coluna própria `ajuste_da_contagem_id`, nunca `contagem_id` (CHECK da 0017, chave de grupo do saldo); único `(contagem, item, lote)` com `NULLS NOT DISTINCT`.
- **N3 — 4.1 partes do recebimento (SIM, sempre criar partes, só para `valor > 0`):**
  - Venda a prazo (`valor = 0`) não tem parte; `valor > 0` exige ≥ 1 parte; Σ partes = valor via CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED + validação no domínio; `UNIQUE(recebimento_id, forma)`, ≤ 5 partes; promissória só como parte única (trigger); partes imutáveis (sem UPDATE/DELETE, sem `estornado_em`/`excluida_em` próprios: o estado é só do pai).
  - `valor_aberto` jamais na parte. A parte aceita `forma = ''` (recebimentos legados migrados; fora do caixa, dentro da receita).
  - `recebimentos.forma` nunca vira 'Mista': na gravação recebe a forma da maior parte (empate: a primeira); nenhum leitor novo a lê; teste de arquitetura proíbe `r.forma` fora do módulo de partes/migração.
  - Função única `gravarRecebimento(valor, partes[])`; proibido `INSERT INTO recebimentos` fora dela (hoje 4 pontos: tarefas.service, programas.service, recebimentos.service, migrador). Partes só são inseridas se o INSERT do recebimento afetou 1 linha (reenvio com a mesma `requisicao_id` devolve o original; partes diferentes → 409).
  - Leem partes SOMENTE: caixa (`recebimentosDoDia`, `promissoriasDoDia`, `depoisDoFechamento`), visão do mês (`porForma`; `recebido` continua `r.valor`; Σ porForma = recebido), painel por forma (`sum(parte.valor)`, `count(DISTINCT r.id)`), lista de recebimentos, funil (lista), `rec_forma` da leitura de tarefas (subquery `jsonb_agg`, nunca JOIN que multiplica linhas). O resto (campanhas, LTV, indicadores, conferência, saldo, painel por tarefa…) segue em `recebimentos`. Leitores de partes aplicam o estado do pai (`estornado_em IS NULL`, tarefa não excluída) por constante central irmã de `NA_GAVETA`.
  - `quantidadeDeRecebimentos` conta recebimentos, não partes. Avisos de duplicidade comparam o total.
  - Migração: backfill expand (1 parte por recebimento `valor>0`, inclusive `forma=''`), conferido por contagem e por Σ; o migrador grava partes na mesma operação idempotente; a conferência ganha "Σ partes = Σ valor por recebimento" e "receita por forma". As 6 conferências atuais seguem somando `recebimentos.valor`.
  - **Desvio declarado (implementação): parte única implícita.** Um constraint trigger deferido (`recebimento_0_parte_unica_implicita`, 0086) cria a parte única (forma e valor do recebimento) no COMMIT quando um recebimento com `valor > 0` e forma válida não tem NENHUMA parte. Existe só para o dono do esquema (fixtures de teste, `psql`): só vale para os **donos do esquema por lista de permitidos** (`current_user IN ('fir_migrate','fir')`; `fir_app` e qualquer papel novo ficam fora), de modo que em produção um recebimento sem partes é recusado no COMMIT — a aplicação só escreve por `gravarRecebimento`, e o teste de arquitetura trava o resto. Nunca "conserta" parte inconsistente (soma errada, promissória misturada): essas são recusadas. Provado em `partes-estorno-receita.e2e.test.ts`. Risco residual: um script SQL do dono sem partes ganha a parte única em vez de falhar.
  - **A 0086 foi corrigida antes do primeiro deploy** (função de conferência: `CASE` sobre campos de `NEW` trocado por `IF`; trigger implícito restrito ao papel não-aplicação). Nenhum ambiente a tinha aplicado; num banco zerado as migrations 0001→0089 sobem em ordem e a conferência do backfill 0088 passa (verificado em banco novo).
  - **R4 — "Saldo em aberto" acima da dívida com várias formas (veto V-1 do validador-numeros):** com UMA parte, o servidor mantém o corte no devido (pedido 6). Com MAIS DE UMA parte e Σ > devido, o servidor **recusa** com 409 `{statusCode: 409, codigo: 'PARTES_ACIMA_DA_DIVIDA', message, devido?}` — `devido` (centavos em texto) só para quem tem `valores`; sem ela a chave não existe. Cortar exigiria escolher de qual forma tirar, a escolha dependeria da ordem digitada, e o caixa acusaria uma sobra que ninguém causou. A tela pede nova divisão. `limitarPartes` foi removido.
  - **Desempate da forma principal:** a parte grava `ordem` (posição digitada). `formaPrincipal` (domínio) e `PARTES_EM_JSON` (SQL) usam o mesmo critério: maior valor; no empate, a primeira digitada.
  - **Endurecimento R3 (0090):** `fir_app` sem DELETE/TRUNCATE em `recebimentos`; `estornado_em` NOT NULL → NULL recusado por trigger (fora os donos do esquema, que podem desligar a trigger de todo modo).
- **N4 — 4.2 outras entradas:**
  - `recebida_em timestamptz` (instante; janela semiaberta no fuso da clínica, regras 22–24); data digitada ≤ hoje, validada no servidor; forma só entre as 4 da gaveta; promissória recusada.
  - Entram no esperado do caixa por forma, na transação do fechamento, em `depoisDoFechamento` (criar/estornar depois de `fechado_em` = mudança) e exigem `confirmarCaixaFechado` quando o dia já fechou. Estorno por marca `estornada_em`; leitores filtram.
  - Campos novos entram em `CAMPOS_MONETARIOS` (regra 17) com teste de redação por rota; no dia aberto do caixa não saem números (às cegas).
  - Meta e `percentualDoResultado` seguem só sobre `recebido`. Resultado do mês = recebido + outras − despesas pagas (duas parcelas visíveis). Fora de LTV/ticket/campanhas/saldo/funil/indicadores/conferência. Painel: consulta própria por `recebida_em`.
  - Permissão (decidida): lançar e estornar = `receber`; ver valor = `valores`; linha na visão do mês = `finmes`; categorias = `contas.gerir`. Sem chave nova. Risco aceito (a recepção pode lançar entrada para cobrir falta) mitigado por trilha, `confirmarCaixaFechado` e `mudouDepoisDoFechamento`.
- **Testes obrigatórios:** propriedade (Σ partes = valor, independência de ordem, Σ esperado por forma, resultado do mês); regressão em Postgres real: `receita-nao-dobra-com-partes`, `tarefas-leitura-nao-multiplica-linhas`, `caixa-por-forma-com-partes`, `estorno-zera-todas-as-partes` nos 5 caminhos de estorno, `reenvio-com-requisicao-id` 3×, forma vazia legada, backfill+reimport 3×, arquitetura, fronteira de mês e fuso das outras entradas.

## E-S — Segurança (appsec)
- **S1 (veto) FKs compostas:** `UNIQUE (id, clinica_id)` em `grupos`, `pessoas`, `tarefas` (se faltar); novas FKs compostas `(grupo_id, clinica_id)`, `(tarefa_origem_id, clinica_id)`, `(pessoa_id, clinica_id)`, `(recebimento_id, clinica_id)`; `responsavel_id` validado no serviço (migrar para composta em expand). Teste em Postgres real: id de outra clínica falha por constraint.
- **S2 (veto) Fluxo:** CTE com `depth < 20`, array de ids visitados (ciclo), CHECK `tarefa_origem_id <> id`, `clinica_id` fixo no join; cada nó passa pelo filtro de visibilidade de `GET tarefas/:id`; nó oculto = marcador opaco sem descrição; nó com `paciente_id` exige o acesso de paciente e a rota é `@DadoSensivel('pacientes')`; regra: `tarefa_origem_id` só aponta para tarefa do mesmo `paciente_id` ou sem paciente.
- **S3 (veto) Autorização de tarefa de grupo:** `Autor.grupoIds` carregado do banco no servidor (nunca do cliente), função pura testada. **Decisão:** em tarefa de grupo, só membro do grupo (ou `tarefas.equipe`) conclui, assume e transfere; em tarefa de pessoa o `podeConcluir` atual não muda. Assumir/transferir só com status aberta e `excluida_em IS NULL`, no WHERE (EXISTS em `membros_de_grupo` com `clinica_id`). Pessoa desativada perde o grupo na hora. **Grupo desativado com tarefas abertas:** a tarefa fica visível a `tarefas.equipe` e a quem a criou, que a transfere; desativar mostra a contagem de tarefas abertas e pede confirmação.
- **S4 (veto) Tabelas novas:** todas (`grupos`, `membros_de_grupo`, `recebimento_partes`, `categorias_de_entrada`, `outras_entradas`) com `clinica_id NOT NULL`, ENABLE+FORCE RLS por `app_clinica_id()`, GRANT a `fir_app` (sem DELETE), trigger `registrar_auditoria`, entradas nos testes de catálogo de RLS e de auditoria; nomes novos de campo monetário registrados no redator; teste de redação por rota com perfil sem `valores`.
- E1 `assumir`: perdedor da corrida recebe 409; evento só quando `rowCount=1`. E2: transferir para o mesmo destino é no-op; `requisicaoId`/versão contra lost update; append no histórico atômico (`historico || $evento`) e histórico com teto de tamanho. E3: sessão de suporte recusada também em assumir, criar com grupo, grupos/membros, partes, outras entradas e (se existir) ajuste. E4: vínculo pessoa↔grupo só editável com `config` e nunca o próprio. E5: limites no contrato Zod (nome 2–60 único sem caixa/acento por clínica, máximos de grupos/membros, nota/motivo ≤200, descrição ≤120, ≤5 partes) e rate limit nas escritas novas. E10: `inicio` `YYYY-MM-DD` real, ≤ 1 ano à frente, "já passou" no servidor; XML: confirmar recusa de DOCTYPE/entidades e limite de tamanho.

## E-L — LGPD
- **L1 (veto) Consumo:** finalidade "conferir o que foi aplicado e rastrear lote em recall", base art. 11, II, "f"; nova linha em `docs/compliance/retencao.md` (leitura de `movimentos_de_estoque` por `tarefa_id`, classe do cadastro do paciente, anonimiza o vínculo `paciente_id`, preserva o movimento); trilha de acesso 1 ano.
- **L2 (veto) Consumo:** rota só de visão interna; a exportação do titular usa projeção própria sem `registrado_por`; teste: resposta sem campo de outro paciente nem nome de colaborador fora de `quem`; sem "outros pacientes do lote".
- **L3 (veto) Texto livre:** aviso fixo "Não escreva nome de paciente nem dado de saúde" em nota/motivo/descrição; linhas em `retencao.md` para `historico` de tarefa interna e `outras_entradas.descricao`; nota/motivo/descrição nunca em log nem em mensagem de erro.
- E1 retenção das tabelas novas na mesma PR da migration (`membros_de_grupo` = vínculo + 5 anos; `recebimento_partes` herda de `recebimentos`; `outras_entradas` prazo fiscal da clínica). E2 `acesso-sensivel.test.ts` para `/consumo` e `/fluxo` (trilha de `pacientes`, mistura documentada). E3 Consumo exige `estoque` **e** `jornada`/visibilidade do paciente; sessão de suporte lê com trilha `ator_tipo = operador`. E4 Consumo paginado, `tarefaId` de origem só para quem vê a tarefa, estorno ligado à origem. E5 composição do grupo só para `config`/`pessoas.gerir`; membro vê o nome do próprio grupo e colegas só com `tarefas.equipe`; carga por pessoa fica sob `pessoas.gerir`. E6 logs das rotas novas só com ids/tipo/status, com teste de varredura.

## Decisão do dono sobre 3.2 (2026-11-14) — substitui o texto da seção 3.2
Confirmado em `packages/domain/src/estoque.ts:280-338`: saldo = grupo da última contagem + movimentos depois. Portanto NÃO se cria movimento de ajuste. A fatia 3.2 passa a ser:
1. Tela/mensagem explícita ao concluir a contagem: "Estoque atualizado para o contado" (por item, com o saldo anterior e o novo, sem expor esperado de contagem aberta — só depois de concluída).
2. Registro append-only `diferencas_reconhecidas` (clinica_id, contagem_id, item_id, lote nulo, diferenca_milesimos congelada, motivo fixo "Inventário", reconhecida_por, em), efeito zero no saldo, único por (contagem, item, lote) com NULLS NOT DISTINCT, RLS/FORCE/GRANT sem UPDATE/DELETE; COM trigger registrar_auditoria, exige `estoque.gerir`, só em contagem CONCLUÍDA, diferença recalculada no servidor (nunca do cliente). Aparece junto da lista no histórico de contagens.
3. Teste de propriedade: `saldoEmMedida` idêntico com e sem o registro; duplo clique gera 1 registro; contagem aberta continua sem esperado no JSON (`transporte-as-cegas.test.ts`).
Migrations: reservadas 0083–0084 para fatia 2, 0085 para fatia 3, 0086–0088 para fatia 4.
Drift da diferença (revisão da fatia 3): a diferença reconhecida é CONGELADA, mas a análise é recalculada a cada leitura; um lançamento retroativo entre as duas contagens pode fazê-las divergir. A contagem concluída devolve as duas (`quantidadeEmEstoque` congelada e `hojeEmEstoque` atual) e a tela mostra "reconhecida: −2; hoje: −3" quando diferem. O dia do reconhecimento é o dia civil NO FUSO DA CLÍNICA, calculado no servidor.
Consumo: a resposta traz `liquidoPorItem` (consumo menos estorno, sobre o histórico inteiro, somado no servidor); nenhuma tela soma linhas ignorando o flag de estorno.
