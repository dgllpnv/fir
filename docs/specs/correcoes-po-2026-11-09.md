# Correções da PO — teste em produção de 2026-11-08

Fonte: lista da PO após testar a ferramenta da clínica em produção. Cada item foi
**reproduzido em produção** (clínica `validacao`, sessão de suporte, sem gravar nada) e
comparado com o protótipo e com o código. Decisões do dono em 2026-11-09 marcadas **(D)**.

Branch: `correcoes-po-2026-11-09`. Próxima migration livre: **0062** (confira
`apps/api/migrations/` antes; números reservados abaixo).

## Bloco A — paridade com o protótipo (o protótipo decide)

### A1 · Nome do paciente no cartão vira link (item 1)
- **Hoje:** `cartao-de-tarefa.tsx:123` desenha `<span class="pill paciente">` sem link. Em
  produção, os 22 nomes em Hoje são `SPAN` sem ação.
- **Protótipo:** `pchip` com `data-pac` → `abrirPaciente` (L2085, L2215).
- **Fazer:** `Link` para `/pacientes/{pacienteId}` em Hoje, Tarefas e onde o cartão aparecer;
  opção `semPaciente` para não repetir o link dentro da própria ficha.

### A2 · Ficha do paciente mostra o cartão da jornada (itens 3 e 4)
- **Hoje:** a ficha (`ficha-do-paciente.tsx`) é uma tabela; `TarefaNaFicha`
  (`packages/contracts/src/pacientes.ts:178`) não traz `historico`, `valorOrcamento`,
  `proximoPassoEm`, `programaOrcado`. Em produção, a paciente "Ana Val z6zsr" com orçamento de
  R$ 20.000 em aberto mostra "Tarefas em aberto 0" e nenhuma etapa.
- **Protótipo:** `cardTarefa(t,{semPaciente:true})` no Histórico (L6913), com
  `esteiraCardHtml` (etapa, orçado, retomar em, Registrar follow-up/Fechou/Perdeu, Evolução).
- **Fazer:** a ficha devolve as tarefas na forma `TarefaNaLista` (mesma redação de valores —
  sem a permissão `valores`, `valorOrcamento` é apagado pelo ponto único de redação, regra 17) e
  desenha `CartaoDeTarefa` com as ações da jornada. O link do mini-cartão da Jornada leva à
  tarefa (`/pacientes/{id}?tarefa={tarefaId}`), que a ficha rola e destaca. Link nunca vira
  `/pacientes/` com id nulo.

### A3 · Campanha na tarefa, no recebimento e no cadastro do paciente (item 5)
- **Hoje:** banco pronto (`0020_campanhas.sql`: `tarefas.campanha_id`, `pacientes.campanha_id`);
  receita por campanha calculada em `campanhas.service.ts:435-498` a partir de `recebimentos`
  por `tarefa_id`. Mas `CriarTarefa`/`EditarTarefa` não aceitam `campanhaId`, o recebimento
  avulso cria tarefa sem campanha e nenhuma tela tem o campo — por isso "Receita gerada" é
  R$ 0,00 em produção. O nosso `manual.ts:444-446,475` já promete o campo.
- **Protótipo:** select "Campanha (opcional)" na Nova tarefa (L2499-2501, opções de
  `campanhasAtivasPara` L2826-2836: em andamento primeiro, depois encerradas há até 30 dias;
  sugestão por `campanhaDoPaciente` L2820-2825); no Recebimento (`rccamp` L5002/L5037); no
  cadastro "Chegou por uma campanha?" só com as ativas hoje (L2818, L6719-6727).
- **Fazer:** `campanhaId` opcional nos contratos de tarefa (criar/editar), recebimento e
  paciente; gravar e validar (campanha da clínica, não excluída; FK composta já impede outra
  clínica); a lista de campanhas vinculáveis precisa estar disponível a quem cria tarefa sem a
  permissão `campanhas` — **só id e nome**, nunca meta ou receita. Violação do índice
  `tarefa_viva_da_campanha` vira 409 legível.
- **Invariante de dinheiro (regras 3 e 4):** a receita da campanha continua vindo **só** de
  `recebimentos` ligados a tarefas da campanha; marcar campanha não cria dinheiro, e orçamento
  (`valorOrcamento`) nunca entra na receita da campanha.

### A4 · Câmera no leitor de código do estoque (item 9)
- **Hoje:** `estoque/leitor-de-codigo.tsx` é só um campo de texto, sem câmera nem foto (dívida
  D-E7 em `docs/dividas.md`); não há leitor na entrada/saída nem campo de código no cadastro;
  `SalvarItemEstoque` não aceita `gtin`. AJUDA e MANUAL prometem a câmera.
- **Protótipo:** `abrirLeitor` (L4184-4212): câmera ao vivo (`facingMode: environment`),
  "Tirar foto do código" (`<input capture="environment">`) e digitação; oferecido no topo do
  Estoque, ao lado do Item na entrada/saída, e no cadastro do item (preenche `gtin` e validade).
- **Fazer:** decodificador **empacotado** (dependência de `apps/web`, versão fixa, nunca CDN);
  os três caminhos; leitor na entrada, na saída e no cadastro; `gtin` em `SalvarItemEstoque`
  com a mesma normalização de `LigarCodigoItem`. Fechar D-E7 (e D-E6 se couber).

### A5 · Recebimento: dizer o que fazer antes de escolher a paciente (item 10)
- **Hoje:** a tela mostra só a busca de paciente; as opções só aparecem depois. Funciona (18
  recebimentos hoje em produção), mas parece vazia.
- **(D)** Não haverá entrada sem paciente. Fazer como o protótipo: "Escolha o paciente para
  continuar." e as opções de referência visíveis (desabilitadas) antes da escolha.

## Bloco B — novas, decididas pelo dono

### B1 · Corrigir o orçamento já enviado (item 2) **(D)**
- Corrigir **valor do orçamento, data de retomar e nota** do evento de orçamento já registrado,
  numa tarefa ainda em `orcamento`. As etapas passadas **não** mudam; o funil de períodos
  passados não muda. Toda correção grava trilha (quem, quando, de → para). Regra no domínio
  (`packages/domain/src/jornada.ts`), nunca na tela. Não precisou de migration (o evento cabe no `historico`).
  **Migrations desta onda:** 0062 (B2) e 0065 (A3). 0063 e 0064 ficam **sem uso**; o B4 usa **0066**, para rodar
  depois da 0065 em todo ambiente (`migrar.ts` aplica por ordem de nome só o que falta — uma 0064 criada agora
  rodaria depois da 0065 em produção e antes dela num banco novo).

### B2 · "Indicado por" liga a uma paciente cadastrada (item 6) **(D)**
- Autocomplete sobre `GET /v1/busca-de-pacientes`; grava `pacientes.indicado_por_id` (FK
  composta com `clinica_id`, sem autoindicação, `ON DELETE SET NULL`). O texto livre continua
  para quem indicou e não é paciente, e para os dados migrados. Migration: **0062**.

### B3 · "Quem mais indica" no Painel (item 7) **(D)**
- Bloco no Painel: pacientes que mais indicaram no período (conta **pacientes distintas**
  indicadas, pela data de cadastro, só por `indicado_por_id`). Se mostrar receita das indicadas,
  ela sai de `recebimentos` e passa pela redação de `valores`.

### B4 · Setor de atuação e tarefa para o setor (item 8) **(D)**

**Pedido do dono:** setores por clínica (Enfermagem, Recepção…), setor na pessoa, e a tarefa pode
ir para um setor: todos do setor veem e qualquer um conclui. O protótipo não tem (atribui sempre a
uma pessoa, L1384-1387, L2502-2503): divergência deliberada.

**Decisão de modelo: ADR 0025** (`docs/adr/0025-setor-de-atuacao-e-tarefa-para-o-setor.md`).
**Termo:** `Setor de atuação` (`CONTEXT.md`); `setor` sozinho é termo proibido. **Migration:
0066.** **Dono:** P1–P8, N-24, N-25 e LGPD condição 2 respondidos em 2026-11-09 (ADR §16).
**Gates:** appsec S-40–S-47 e S-51–S-60; LGPD L-B4-1–7 e revisão (condições 1–7); números N-23–N-33
e T-B4-1–T-B4-11; LGPD segunda passada (S60-1–3, LA24-1–4); parecer de produto L-A2-4.
**Estado: ADR 0025 aceita** (2026-11-09). Os tickets podem nascer depois da integração desta onda.
A dose na lista está decidida: **só o rótulo** (ADR §10.4), em divergência deliberada do protótipo.

**Dependência de construção.** Os tickets tocam arquivos que, nesta onda, são de outras frentes
(`contracts/tarefas.ts` da A3A5; `cartao-de-tarefa.tsx`, `tela-hoje.tsx`, `tela-tarefas.tsx` da
A1A2; `tela-nova-tarefa.tsx`, `painel-de-edicao.tsx` da A3A5). O B4 constrói **depois da
integração desta onda**, com propriedade de arquivo redeclarada pelo coordenador.

#### O que fica igual (e é teste)
- Toda tarefa existente continua de pessoa; nenhuma linha é reescrita. **A 0066 sozinha não muda
  número de mês nenhum. Depois dela, um mês passado só muda pelos caminhos que já existem (reabrir,
  corrigir `realizadaEm`, trocar o responsável de tarefa aberta), e nunca pela troca de destino
  para ou de um setor** (N-28; T-B4-1, T-B4-1b).
- Redação de valores (regra 17): a mesma, pelo mesmo ponto. Membro do setor sem `valores` recebe
  `valorOrcamento` e pagamento `null` (S-46).
- Concluir **tarefa de pessoa** continua aberto a qualquer um (risco aceito, S-55). Sessão de
  suporte continua sem poder concluir.
- Escopos *Solicitei* e *Equipe toda*: sem mudança e sem recorte.
- Rotinas criadas pelo sistema continuam indo para uma pessoa. Sessão de programa não vai para
  setor (P3); remover o `CHECK` exige o gate de LGPD antes (condição 7).

#### O que muda para toda tarefa (avisar no MANUAL)
- Trocar o destino de tarefa concluída ou cancelada: **400** "Reabra a tarefa para trocar o
  destino." — inclusive pessoa → pessoa, e inclusive para `tarefas.equipe` (N-25, S-53).
- Trocar o destino de tarefa vencida (`prazo < hoje` do servidor): só solicitante ou
  `tarefas.equipe`, nos dois sentidos; responsável e membro recebem **403** (N-24).
- MANUAL: "concluir direto pelo setor não pesa no seu % no prazo; assumir pesa"; e o funil por
  pessoa não mostra a tarefa de setor que ela concluiu (N-33).

#### Tickets

**B4-1 · Domínio: autorização com setor** (`packages/domain/src/tarefa.ts`)
- `TarefaParaAutorizar`: `responsavelId: string | null`, `setorDeAtuacaoId: string | null`,
  `concluidaPorId: string | null`, `prazo`, `diaDaConclusao: string | null`. `Autor`:
  `setorDeAtuacaoId: string | null`. As funções que dependem do dia recebem `hoje` do servidor.
- `membroVe(t, a, hoje)`: os dois setores não nulos e iguais, **e** a tarefa aberta ou concluída
  hoje (LGPD condição 2). `null === null` não é pertencer.
- `podeConcluir`: tarefa de pessoa sem mudança; tarefa de setor exige membro, solicitante ou
  `podeEquipe` (S-55).
- `podeEditar`: solicitante, responsável, `membroVe`, `podeEquipe` (P5).
- `podeReabrir` (nova; a rota de reabrir deixa de chamar `podeEditar`): tarefa de pessoa = regra
  de hoje; tarefa de setor = solicitante, `podeEquipe`, ou `concluidaPorId === a.id && membroVe`
  (P8, S-54).
- `podeCancelar` / `podeExcluir`: sem membro do setor (P5).
- `podeTrocarDestino(t, a, hoje)`: status ≠ `aberta` → `DESTINO_SO_EM_TAREFA_ABERTA` (400);
  `prazo < hoje` e não é solicitante nem `podeEquipe` → `TAREFA_ATRASADA_NAO_MUDA_DESTINO` (403);
  senão `podeEditar` (S-53, N-24, N-25).
- `destinoValido(responsavelId, setorDeAtuacaoId)`: erro se nenhum ou os dois.
- Testes de domínio por tabela: as seis ações × {solicitante, responsável, membro, membro que
  concluiu, membro de outro setor, pessoa sem setor, equipe} × {tarefa de pessoa, de setor} ×
  {aberta no prazo, aberta vencida, concluída hoje, concluída ontem, cancelada}.
- Feito quando: `pnpm test:domain` verde; prova por mutação de `null === null`, do recorte do dia
  e da condição de vencida.

**B4-2 · Migration 0066 e retenção**
- `setores_de_atuacao` completa (S-0.3): `UNIQUE (clinica_id, id)`, único parcial por nome vivo,
  ENABLE + FORCE RLS, policy em `USING` e `WITH CHECK`, `registrar_auditoria`, GRANTs sem DELETE.
- `pessoas.setor_de_atuacao_id` com FK composta.
- `tarefas`: `responsavel_id DROP NOT NULL`; **FKs compostas `(clinica_id, responsavel_id)` e
  `(clinica_id, solicitante_id)` → `pessoas (clinica_id, id)`, removendo as simples da 0006**, com
  `NOT VALID` + `VALIDATE`, precedidas de uma contagem de linhas com pessoa de outra clínica que
  **aborta com mensagem legível** (contagem por coluna, sem ids) se não for zero (S-51);
  `setor_de_atuacao_id` e `concluida_por` com FKs compostas; `CHECK`s `tarefa_tem_um_destino`,
  `concluida_por_so_em_concluida`, `tarefa_de_setor_concluida_tem_quem_concluiu`,
  `sessao_nao_vai_para_setor`; índice `tarefas_abertas_do_setor`. Texto na ADR §2.
- Nenhum `UPDATE` de dado. Nenhuma derivação de `funcao`/`cargo`/perfil.
- `docs/compliance/retencao.md`: as **quatro** linhas exatas da revisão do gate LGPD (subseção
  "Setor de atuação e conclusão de tarefa"), que substituem as duas da primeira passada.
- Feito quando: `pnpm db:migrate` limpo; `escrita-sem-rls`, `auditoria-inescapavel`,
  `isolamento-de-clinica` verdes com a tabela nova; teste de banco dos `CHECK`s e FKs (AB-B4-15,
  AB-B4-30); teste da pré-condição de S-51 (banco com uma tarefa cruzada → a migration aborta com a
  mensagem); retencao.md no mesmo diff.

**B4-3 · API de setores** (`apps/api/src/setores-de-atuacao/**`, módulo novo)
- `GET /v1/setores-de-atuacao` → `{ itens: [{ id, nome }] }`, vivos, qualquer sessão da clínica.
- `GET /v1/setores-de-atuacao/pessoas` → `{ itens: [{ id, nome, pessoas: [{ id, nome }] }] }`,
  **só pessoas ativas** (LGPD condição 6), `@Exige('config')`. Nenhum campo de ficha.
- `POST` (criar), `PATCH /:id` (renomear), `POST /:id/excluir` — `@Exige('config')`.
  `ParseUUIDPipe` em todo `:id` (400). Outra clínica ou setor excluído → 404 pelo `FOR UPDATE`
  vazio ou `rowCount`, nada gravado, nenhuma linha de auditoria (S-59). Excluir: `FOR UPDATE`, 409
  com **só** `{ pessoasAtivas, tarefasAbertas }`. Nome repetido → 409 legível.
- Entra em `teste/rotas-protegidas.test.ts`/`teste/registro.ts` e na classificação de
  `rotas-de-conferencia.ts` (fora da conferência: não há dinheiro) — S-0.1.
- Feito quando: e2e de cada rota com e sem `config`; AB-B4-10, AB-B4-31.

**B4-4 · Pessoa no setor** (`api/pessoas/**` só criar/editar/reativar pessoa; `tela-usuarios.tsx`)
- `setorDeAtuacaoId` (nullable) em criar pessoa e `PATCH /v1/pessoas/:id` (`config`). Setor vivo e
  da clínica, lido com `FOR SHARE` (S-59); 400 legível; a FK é a segunda camada. Nenhuma outra rota
  aceita o campo (Zod `strict`).
- Reativar pessoa cujo setor foi excluído zera `setor_de_atuacao_id` na mesma transação (S-59).
- `GET` de pessoas (Usuários e acessos) devolve `setorDeAtuacaoId` e o nome. `GET /v1/equipe` não
  muda.
- Tela *Usuários e acessos*: campo "Setor de atuação" (opcional) e o nome do setor ao lado da
  função na lista. 390 px sem rolagem horizontal.
- Feito quando: AB-B4-3, AB-B4-10, AB-B4-33; trilha da troca de setor lida em `GET /v1/auditoria`.

**B4-5 · Tarefa com destino setor: escrita** (`contracts/tarefas.ts`, `api/tarefas/**`; em
`programas/sessoes.service.ts` e `estoque/contagens.service.ts` só as linhas de `concluida_por`)
- Contratos: `CriarTarefa` com exatamente um de `responsavelId`/`setorDeAtuacaoId`;
  `EditarTarefa` com no máximo um (mandar um zera o outro no mesmo `UPDATE`); `TarefaNaLista` com
  `responsavelId`/`responsavelNome` nullable e `setorDeAtuacaoId`, `setorDeAtuacaoNome`,
  `concluidaPorId`, `concluidaPorNome`. Nenhum nome em `CAMPOS_MONETARIOS`.
- `comSetorAtual(c, autor)` (S-56): única fonte do setor do autor, dentro de `naClinica`, na
  transação do `FOR UPDATE`. `autorDe`, `leitorDe` e `ContextoDaRequisicao` **sem** setor (teste
  das chaves do contexto). `carregar` (conclusão, edição) e `uma` (`GET /v1/tarefas/:id`) a usam.
- Criar/editar para setor: vivo, da clínica, ≥ 1 pessoa ativa, lido com `FOR SHARE`; senão 400
  ("Este setor de atuação não tem ninguém ativo."). `'Sessão de plano'` com setor → 400.
- Troca de destino por `podeTrocarDestino` (400 / 403 / 200), com trilha de → para.
- Concluir tarefa de setor por `podeConcluir` novo: quem não pode recebe 403 **sem corpo de
  tarefa** (S-55). Reabrir por `podeReabrir`.
- **`concluida_por` em todo caminho que muda `status`** (N-26): grava em
  `conclusao.service.ts:182`, `sessoes.service.ts:134`, `contagens.service.ts:474`; zera em
  `conclusao.service.ts:259` (cancelar), `:322` (reabrir), `sessoes.service.ts:275` (reabrir
  sessão). Teste-guarda: todo `UPDATE tarefas SET status` em `apps/api/src` menciona
  `concluida_por`.
- **Série** (S-58): "nesta e nas próximas" alcança só as abertas futuras com o **mesmo destino de
  antes** (`IS NOT DISTINCT FROM` nos dois campos), grava os dois destinos no mesmo `UPDATE`, nunca
  toca concluída nem cancelada, e cada ocorrência passa por `podeTrocarDestino`.
- `SELECT_TAREFA`: `LEFT JOIN pessoas pr`, `LEFT JOIN setores_de_atuacao sa`, `LEFT JOIN pessoas
  pc ON pc.id = t.concluida_por` — **no mesmo PR e deploy da 0066** (S-51). `LinhaDeTarefa` e
  `paraSaida` com os campos novos.
- Feito quando: AB-B4-4, -5, -7, -11, -15, -17, -18, -19, -20, -22, -27, -28, -29, -32, -35;
  T-B4-5, T-B4-6, T-B4-7.

**B4-6 · Tarefa de setor: leitura, filtros e dose fora da lista** (`api/tarefas/consulta.service.ts`,
`leitura.ts`, `hoje/hoje.controller.ts`, `contracts/tarefas.ts` só `ItemOrcadoNaLista`; a
escrita de `programaOrcado` em `api/jornada/**` só para LA24-1)
- `DO_MEU_SETOR` com o **texto obrigatório** da ADR §4 (S-52 + LGPD condição 2): setor da tarefa
  não nulo, igual ao `setor_de_atuacao_id` da pessoa ativa e não excluída (subselect na mesma
  consulta), e a tarefa aberta ou concluída hoje no fuso da clínica. Proibidos no fragmento: `IS NOT
  DISTINCT FROM`, `coalesce` com sentinela, `= ANY` com array que pode ter `NULL`. `eu = ''` →
  `SEM_PESSOA`.
- `filtroDeEscopo` `meu` e `filtroDePasso` `meu` incluem `DO_MEU_SETOR` (passam a receber `fuso`
  e `hoje`); `faixaDaSemana` herda; `ocultasPeloFiltro` nega com `IS NOT TRUE`, nunca `NOT (…)`.
- `ConsultaDeTarefas.setorDeAtuacaoId`: primeira camada em `exigirEscopo` (403 sem
  `tarefas.equipe` quando não é o setor atual, lido por `comSetorAtual`); segunda camada na consulta,
  `AND (<podeEquipe> OR DO_MEU_SETOR)` (S-57). `ConsultaDeHoje` não aceita o parâmetro (400).
- **Dose fora da lista (ADR §10.4, divergência deliberada do protótipo L4790/L4819):**
  `ItemOrcadoNaLista` sem a chave `dose` em toda resposta de lista, em `GET /v1/tarefas/:id` e em
  toda escrita que devolve `TarefaNaLista`; `paraSaida` é o único ponto que o monta.
- **LA24-1 · Escrever não apaga a dose.** Escolher e escrever neste ticket uma das duas saídas:
  (a) toda escrita de `programaOrcado` preserva a `dose` gravada por `chave` quando o item chega
  sem a chave; ou (b) o formulário de orçamento carrega o item de uma leitura de detalhe sob
  `pacientes`. Mutação "sobrescreve com `null`" tem de derrubar o critério 6.
- **LA24-2 · Varredura pelo registro de rotas.** Um teste descobre pelo registro de rotas, nunca
  por lista à mão, toda rota que devolve `TarefaNaLista` ou `ItemOrcadoNaLista` (inclusive concluir,
  editar, reabrir, passos da jornada e `GET /v1/tarefas/:id`) e exige zero chaves `dose` em
  qualquer profundidade do corpo. Pôr `dose` de volta no tipo de lista derruba o teste.
- **LA24-3 · Dose só pela ficha.** O tipo com dose só sai em `GET /v1/pacientes/:id`
  (`@DadoSensivel('pacientes')`). O web não completa a dose a partir de resposta de lista nem por
  outra rota sem a marcação.
- **S60-3 · O limite com o perfil real.** No AB-B4-6/-9, membro de Enfermagem com o perfil
  `pf_enf` de `perfisPadrao` (sem `pacientes`, sem `jornada`): vê `pacienteNome` e
  `pacienteTelefone` da tarefa de setor e **não** recebe link de ficha, blocos da jornada, valores
  nem `dose` (varredura recursiva do corpo).
- **Critérios de aceite da dose** (parecer de produto L-A2-4, mais o 6 do gate de LGPD):
  1. Com uma paciente cujo orçamento tem programa com dose "2,5 mg", abrir o cartão em Hoje, em
     Tarefas e na Jornada, com usuária de pessoa e com membro de setor: "2,5 mg" não aparece no
     cartão e não aparece no JSON de nenhuma das quatro respostas de lista (aba de rede).
  2. Na mesma conta, abrir a ficha da paciente: o programa orçado aparece com "2,5 mg".
  3. Tocar em **Fechou** nesse cartão, informar a entrada e salvar: o programa montado em Programas
     tem a dose "2,5 mg" em cada sessão, sem que a dose tenha passado pela tela.
  4. Tarefa de sessão desse programa em Hoje continua mostrando "· Tirzepatida 2,5 mg" na
     descrição.
  5. Teste de contrato: `ItemOrcadoNaLista` não tem a chave `dose`, e `paraSaida` é o único ponto
     que monta o item a partir do `ItemOrcado`.
  6. Corrigir o orçamento pelo cartão em Hoje (B1), sem tocar na dose: a `dose` gravada não muda
     (LA24-1).
- `hoje.controller.ts`: o bloco de sessões não muda.
- Feito quando: AB-B4-1, -2, -6, -8, -9, -16, -21, -23, -24, -25, -26, -34, -36; S60-3; LA24-1 a
  LA24-3; critérios de aceite da dose 1 a 6; mutação de `=` para `IS NOT DISTINCT FROM` derruba o
  AB-B4-26; mutação do recorte do dia derruba o AB-B4-36.

**B4-7 · Meta e Painel** (`api/pessoas/indicadores.service.ts`, `api/painel-geral/metricas-diarias.ts`,
`api/painel-geral/painel.service.ts`, `contracts/painel.ts`, `tela-painel.tsx`) — **passa pelo
`validador-numeros`**
- Duas constantes no mesmo módulo (N-23): `PESSOA_QUE_CONTA = coalesce(t.responsavel_id,
  t.concluida_por)` para **produção** (`contatos`, `orc_qtd`, `orc_valor`, `recebimentos`);
  `DESTINO_DO_PRAZO` (responsável, senão setor) para **prazo** (`consultarPrazos`,
  `tarefas_prazo`). `concluida_por` nunca entra em prazo.
- Produção: chave `NULL` entre concluídas **lança erro** (N-29); o tipo da linha passa a `pessoa:
  string | null`.
- `tarefas_prazo`: `AND t.setor_de_atuacao_id IS NULL` (P4); só tarefas de setor → `null`, nunca 0.
- `consultarPrazos`: agrupa por `DESTINO_DO_PRAZO`; total por `GROUPING()`; `ORDER BY
  GROUPING(...) DESC, total DESC, tipo, nome, id` (N-27). Nome do setor por `LEFT JOIN
  setores_de_atuacao` **sem** filtro de `excluido_em`; nome da pessoa pela mesma expressão da chave
  (N-31). `LinhaPorResponsavel` vira união discriminada por `tipo` (`'pessoa'` com `pessoaId`,
  `'setor'` com `setorDeAtuacaoId`); `tela-painel.tsx` desenha a linha de setor.
- Job da carteira: continua com `prazos.total`; nada de setor atravessa (N-32).
- Feito quando: T-B4-1 a T-B4-4 e T-B4-8 a T-B4-11, cada um com a mutação indicada no gate.

**B4-8 · Telas** (`tela-nova-tarefa.tsx`, `cartao-de-tarefa.tsx`, `tela-tarefas.tsx`,
`painel-de-edicao.tsx`, tela nova de setores em Configurações, `manual.ts`/`ajuda.ts` só os
parágrafos do item)
- "Para" com dois grupos — pessoas ativas ("Eu mesma — …" primeiro) e setores de atuação. Sessão:
  só pessoas. Edição de tarefa não aberta, ou vencida sem ser solicitante/equipe: o campo "Para"
  aparece travado com a explicação (o servidor decide; a tela só não oferece).
- **S60-1 · Quem cria decide sabendo.** Ao escolher um setor no campo "Para" de uma tarefa **com
  paciente**, aparece abaixo do campo o texto fixo *"Todas as pessoas ativas de {setor} verão esta
  tarefa, com o nome e o telefone da paciente."*, sem contagem nem nomes de membros. O MANUAL
  repete a frase no parágrafo "quem vê".
- Cartão: "Para Enfermagem" / "Juliana → Enfermagem", rótulo acessível "Setor de atuação"; concluída
  de setor mostra "Concluída por Camila". Nada de `primeiroNome(null)`. Reabrir só aparece para quem
  `podeReabrir`.
- Tarefas: filtro "Setor de atuação" (o próprio setor sempre; os outros só com `tarefas.equipe`).
- Configurações → Setores de atuação: lista, criar, renomear, excluir (mensagem com as contagens do
  409), dica fixa *"Setor é onde a pessoa atua, não a situação dela."* (L-B4-2).
- MANUAL/AJUDA: o que é o setor, quem vê (abertas e concluídas do dia, com a frase de S60-1), quem conclui e reabre,
  quem conta na meta, as duas regras novas de troca de destino, e a nota do funil (N-33).
- Feito quando: S60-1 visível na tela e no MANUAL; build do web; 390 px e 1280 px, claro e escuro,
  `scrollWidth == innerWidth`, sem erro de console.

**B4-9 · Trilha: quem podia ver** (teste e documentação; sem rota nova)
- E2E que, depois de uma sequência (tarefa criada para setor S; A entra em S; B sai de S; tarefa
  concluída; dia seguinte; destino de outra tarefa trocado para a pessoa C; troca de perfil que tira
  `tarefas.equipe` de D; sessão de suporte aberta; A desativada), reconstrói **só a partir da
  `auditoria`** a união (membros ativos com o recorte do dia, solicitante, `tarefas.equipe`, sessões
  de suporte vivas) em cada instante e compara com o que a leitura devolveu (LGPD condição 3).
- Consulta documentada em `docs/compliance/`, que separa "quem **podia** ver" (esta) de "quem
  **abriu** a ficha" (trilha de acesso).
- Feito quando: o teste passa e falha ao remover a trigger de `pessoas` (prova por mutação).

#### Casos de abuso e testes (nomes para o QA)

**Numeração.** Os gates de appsec e de LGPD criaram, cada um, um "AB-B4-26" com conteúdo diferente.
Aqui: **AB-B4-26 a AB-B4-35 são os do appsec** (mesmos números do gate); **o AB-B4-26 do gate de
LGPD é o AB-B4-36** deste spec. Os testes do validador mantêm os nomes do gate (T-B4-1 a T-B4-11).

Do gate de appsec, primeira passada:
- **AB-B4-1** Pessoa fora do setor, sem `tarefas.equipe`: não vê a tarefa de setor em Hoje (lista,
  pendentes, bolinhas, jornada), em Tarefas, e `GET /v1/tarefas?setorDeAtuacaoId=<S>` dá 403.
- **AB-B4-2** Pessoa removida do setor: na requisição seguinte, a tarefa sumiu do Hoje dela.
- **AB-B4-3** Pessoa sem `config` tenta se pôr num setor (`PATCH /v1/pessoas/<ela>`, rota de
  setores, campo extra em qualquer rota de "minha conta"): 403 ou 400 de Zod, nada gravado.
- **AB-B4-4** `setorDeAtuacaoId` de outra clínica em criar tarefa, editar tarefa e editar pessoa:
  4xx, nada gravado (e, por SQL direto, 23503 da FK composta).
- **AB-B4-5** Dois membros concluem a mesma tarefa de setor ao mesmo tempo: uma conclusão, um
  `concluida_por`, um ponto na meta; a outra recebe 409 "já foi concluída".
- **AB-B4-6** Membro do setor sem `valores` vê tarefa de setor com orçamento: `valorOrcamento` e
  pagamento `null`; sem `jornada`, os três blocos vazios.
- **AB-B4-7** Sessão de suporte conclui tarefa de setor: recusada; *Para mim* dela vazio.

Do gate de LGPD, primeira passada:
- **AB-B4-8** Pessoa ativa do setor vê; depois de desativada (ou de sair do setor), não vê — é a
  leitura que decide, não a criação.
- **AB-B4-9** Pessoa do setor sem a permissão que a tarefa exigiria não a vê onde a permissão
  falta: sem `jornada`, a tarefa de setor em etapa `faltou` não aparece em Recontatar.
- **AB-B4-10** As rotas de setores e de pessoas por setor não devolvem `cargo`, `salario` nem
  campo de ficha (comparar o conjunto de chaves); pessoa desativada no setor não aparece no corpo
  (condição 6).
- **AB-B4-11** Concluir tarefa de setor grava a pessoa que concluiu; trocar setor de pessoa e
  destino de tarefa grava trilha de → para com ids.

Do domínio:
- **AB-B4-12** Tarefa de setor concluída por A conta 1 para A **nos indicadores de produção** e fica
  na linha do setor em prazos; aberta, não conta para ninguém e fica na linha do setor (N-23).
- **AB-B4-13** Com tarefas de setor no período, a soma das linhas do Painel de prazos é o total,
  coluna por coluna, e `tarefasNoPrazo` enviado à carteira é `total.noPrazo` (N-27, N-32).
- **AB-B4-14** Instantâneo de meta, Painel e funil sobre a fixture antes da 0066 = depois (T-B4-1).
- **AB-B4-15** `responsavelId` e `setorDeAtuacaoId` juntos, ou nenhum: 400; por SQL direto, 23514.
- **AB-B4-16** Filtro pelo próprio setor sem `tarefas.equipe`: 200, só abertas e concluídas hoje;
  por outro setor: 403.
- **AB-B4-17** Membro edita a tarefa aberta do setor (200); cancela e exclui (403). Membro de outro
  setor edita: 403.
- **AB-B4-18** Criar tarefa para setor excluído, ou sem pessoa ativa: 400. Excluir setor com pessoa
  ativa ou tarefa aberta: 409 com as contagens. Excluir e criar ao mesmo tempo: nunca tarefa em
  setor excluído.
- **AB-B4-19** Série para setor: editar o destino "nesta e nas próximas" muda as abertas futuras de
  mesmo destino e não toca nas concluídas.
- **AB-B4-20** Reabrir (tarefa e sessão) zera `concluida_por`; a `auditoria` guarda o anterior.
- **AB-B4-21** Sessão de suporte vê a tarefa de setor só por *Equipe toda*.
- **AB-B4-22** Sessão de programa com setor (criar, editar, SQL direto): recusada.
- **AB-B4-23** Pessoa troca de S1 para S2: na requisição seguinte vê as de S2 e nenhuma de S1.
- **AB-B4-24** Lista do dia, bolinha da semana e aviso de ocultas contam a mesma tarefa de setor do
  mesmo jeito, também para uma pessoa sem setor.
- **AB-B4-25** Varredura do log de um fluxo completo de tarefa de setor: nenhum nome de pessoa, de
  paciente, telefone ou dose (L-B4-7, regra 21).

Do gate de appsec, revisão da ADR (S-51 a S-60):
- **AB-B4-26** Pessoa **sem setor**, *Para mim*, numa clínica com tarefas de pessoa de outras e de
  setor: recebe exatamente as com `responsavel_id = ela`; com uma tarefa de outra pessoa no dia,
  `ocultasPeloFiltro ≥ 1`. Cai se `=` virar `IS NOT DISTINCT FROM` (S-52).
- **AB-B4-27** Membro troca o destino de uma tarefa de setor concluída por A (para si, para X, para
  outro setor): 400; `concluida_por` e `PESSOA_QUE_CONTA` não mudam. Com `tarefas.equipe`: também
  400 (N-25, decisão do dono; mais estrito que o S-53 original).
- **AB-B4-28** Membro B reabre uma tarefa de setor concluída por A: 403. A (ainda no setor, no dia),
  o solicitante e `tarefas.equipe`: 200 (P8).
- **AB-B4-29** Pessoa fora do setor, sem `tarefas.equipe` e sem ser a solicitante, chama
  `POST /v1/tarefas/<id>/concluir` com o id visto na ficha: 403, corpo sem `pacienteNome`,
  `pacienteTelefone` ou `programaOrcado`, nada gravado, meta sem alteração (S-55).
- **AB-B4-30** `INSERT`/`UPDATE` direto em `tarefas` com `responsavel_id` ou `solicitante_id` de
  pessoa de outra clínica: 23503 (S-51).
- **AB-B4-31** `PATCH /v1/setores-de-atuacao/<id da clínica B>` e `POST …/<id B>/excluir` com sessão
  da clínica A e `config`: 404, setor de B intacto, nenhuma linha de auditoria. `:id` não uuid: 400.
- **AB-B4-32** Série com destino misturado (1 a 3 para S, 4 já para X): membro de S edita a 2 com
  "nesta e nas próximas" trocando o destino; a 4 continua com X; nenhuma resposta 500 (S-58).
- **AB-B4-33** Excluir S e pôr P em S ao mesmo tempo: uma falha; nunca pessoa ativa em setor
  excluído. Reativar pessoa que aponta para setor excluído: volta sem setor (S-59).
- **AB-B4-34** `GET /v1/hoje?setorDeAtuacaoId=<qualquer>`: 400 (S-57).
- **AB-B4-35** Na mesma sessão, o setor da pessoa muda por SQL direto entre duas requisições: a
  segunda já reflete, sem novo login (S-56).

Do gate de LGPD, revisão da ADR (no gate: "AB-B4-26"):
- **AB-B4-36** A entra em S depois de T1 ter sido concluída em S num dia anterior: A não vê T1 em
  Hoje, em Tarefas (`?setorDeAtuacaoId=S`, qualquer situação) nem por `GET /v1/tarefas/:id`, e não a
  reabre (403/404). Tarefa de S cancelada hoje também não aparece para A (condição 2).

Do gate de números (nomes do gate; detalhe e mutações em `correcoes-po-gate-numeros.md`):
- **T-B4-1** A 0066 não muda mês passado (fixture fixa, relógio fixo, instantâneo em profundidade).
- **T-B4-1b** Atividade nova de setor em novembro não muda outubro.
- **T-B4-2** Tarefa de pessoa concluída por outra conta para o responsável.
- **T-B4-3** O cenário de referência de 6 tarefas dá exatamente a tabela corrigida do N-23.
- **T-B4-4** P4: % individual ignora tarefa de setor; só setor → `null`.
- **T-B4-5** N-24: Juliana não leva as atrasadas para o setor (403); a solicitante leva (200).
- **T-B4-6** N-25: troca de destino em concluída, nos dois sentidos, 400; SQL direto, 23514.
- **T-B4-7** N-26: concluir → reabrir → concluir → reabrir sessão sem 23514, lote restaurado.
- **T-B4-8** Property-based (fast-check): as seis propriedades do gate.
- **T-B4-9** Setor excluído continua com a linha no Painel do período.
- **T-B4-10** Ordem do Painel determinística em empate.
- **T-B4-11** Carteira: `tarefas_no_prazo` = Σ das linhas; três execuções, uma linha.

## Fora do pedido, achado na investigação

### C1 · Versão nova publicada com aba antiga aberta (o "painel quebrado" do superadmin)
- O dono viu, por um instante, o painel com layout quebrado logo depois de entrar. Produção está
  com o código revertido (o CSS publicado é o mesmo do build local e não tem as classes do
  D-25), não há service worker nem cache da aplicação, e o login reproduzido localmente não
  quebra. Causa provável: **aba aberta antes do deploy** — o JavaScript antigo, ainda na
  memória da aba, navega sem recarregar e monta telas com classes que o CSS novo não tem.
- **Fazer:** `deploymentId` do Next ligado ao commit, para que uma aba de versão antiga
  recarregue inteira em vez de navegar por dentro; e o painel não desenhar a Visão geral
  enquanto a sessão (e a troca de senha provisória) não estiver resolvida.
