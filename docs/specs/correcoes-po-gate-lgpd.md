# Gate LGPD — correções da PO (2026-11-09)

Parecer do `especialista-lgpd-saude` sobre `docs/specs/correcoes-po-2026-11-09.md`,
**antes do código**. Escopo: A2, A3, B2, B3, B4 (A1 entra só onde toca A2).
Conferido na fonte: `pacientes.controller.ts` (ficha com `@DadoSensivel('pacientes')`),
`busca.controller.ts` (devolve `id, nome, telefone`, só `ativo`, sem trilha),
`pacientes.service.ts` (`SELECT_BASE` comum a lista e ficha; desativar, nunca apagar — ADR 0003),
`contracts/src/tarefas.ts` (`TarefaNaLista` traz `programaOrcado[].dose`, `historico[].nota`,
`historico[].valor`, `pagamento`, `pacienteTelefone`, nomes de solicitante e responsável),
`rotas-de-conferencia.ts` (`/v1/pacientes/:id` já em rota com dinheiro), migrations 0006, 0018, 0020,
Postgres 17.

Requisitos são **obrigatórios** para o construtor, salvo os marcados **(R)**, que são recomendação.

**Achado que vale para todos os itens:** `retencao.md` **ainda não tem linha para o cadastro do
paciente** (nome, telefone, aniversário, origem, `indicado_por`, `campanha_id`). As linhas novas
abaixo herdam o prazo dessa classe. Este gate não bloqueia por isso, porque a lacuna já existia,
mas ela precisa ser registrada como dívida, com gatilho "antes da primeira solicitação de
eliminação de titular, e no máximo até a migração das 4 clínicas". O procedimento de
anonimização do paciente (`retencao.md` §3) também não existe. **Nada deste spec pode
torná-lo mais difícil de escrever**, e é isso que L-B2-6 e L-A3-5 protegem.

---

## A2 · Ficha mostra o cartão da jornada

Dado: etapa, histórico da jornada (com `nota` em texto livre), `valorOrcamento`, `programaOrcado`
(procedimento, sessões, **dose**), pagamento. `programaOrcado` + dose ligados a uma paciente
identificada são dado de saúde (art. 5º, II).

- **L-A2-1 · Base legal.** Art. 11, II, "f" para `programaOrcado`/dose/procedimento e para notas
  de evolução; art. 7º, V para valor orçado e pagamento. Não muda nada no modelo: o dado já existe
  em `tarefas`. O que muda é que **a ficha acumula toda a história** da paciente numa só leitura.
- **L-A2-2 · Trilha de acesso.** A ficha continua em `GET /v1/pacientes/:id` com
  `@DadoSensivel('pacientes')`. **Proibido** servir as tarefas da ficha por rota nova sem a
  marcação (por exemplo `GET /v1/pacientes/:id/tarefas` ou `GET /v1/tarefas?pacienteId=`). Se a
  implementação precisar de rota própria, ela nasce com `@DadoSensivel('pacientes')` registrando o
  id da **paciente**, não o da tarefa. O deep link `?tarefa={id}` é estado da tela e não gera
  segunda leitura no servidor.
- **L-A2-3 · Redação em profundidade.** Sem `valores`, saem `null`: `valorOrcamento`,
  `historico[].valor`, `programaOrcado[].valor`, `pagamento.valor`, `pagamento.valorAberto`.
  Quem faz isso é o `RedacaoInterceptor`, nunca um `if` no serviço da ficha (regra 17).
- **L-A2-4 · Quem vê.** Quem tem `pacientes`, como hoje. A ficha não amplia o público. A dose já
  chega à equipe em `descricao` e em `TarefaNaLista` na tela Hoje. **(R)** Registrar como questão
  aberta para o `product-rotina-clinica` se a recepção precisa de `programaOrcado[].dose` ou só do
  rótulo. Não bloqueia: não é expansão criada por este item.
- **L-A2-5 · Tarefa excluída não aparece.** `excluida_em IS NOT NULL` fica fora da ficha, como em
  `SELECT_BASE`. Soft delete não é "visível com outro rótulo".
- **L-A2-6 · Link.** Só ids na URL (`/pacientes/{uuid}?tarefa={uuid}`), nunca nome nem telefone,
  nem em query string, nem em `title` ou `aria-label` que ferramenta de telemetria capture. Id nulo
  não desenha link (o spec já pede isso, e vale também para A1).
- **L-A2-7 · Log e erro.** Nenhum `console.*` com a tarefa ou a ficha no `web`. Erro da ficha não
  ecoa `nota`, `descricao`, dose nem valor (padrão `primeiroErro`).
- **L-A2-8 · Exportação futura.** `FichaDoPaciente` **não** é o extrato do titular. Ela carrega
  `solicitanteNome`, `responsavelNome` e `historico[].porId`, que são dado de terceiro (a equipe).
  O endpoint de exportação, quando existir, tem forma própria, sem quem aplicou ou atendeu.
  Registrar junto à dívida do §4 de `retencao.md`.

**Testes exigidos**
1. E2E: `GET /v1/pacientes/:id` com tarefa de jornada, sem `valores` → todos os campos de
   L-A2-3 são `null` **em todas as profundidades** (varredura recursiva, não campo a campo).
2. E2E: a mesma leitura grava **uma** linha `acao='acessou'`, `entidade='pacientes'`, id da paciente.
   Resposta 404 ou 403 não grava.
3. E2E: tarefa com `excluida_em` não aparece na ficha.
4. Se houver rota nova (L-A2-2), teste que ela grava acesso.

**Veredito A2: APROVADO COM CONDIÇÕES** (L-A2-2, L-A2-3, L-A2-5).

---

## A3 · Campanha de origem na tarefa, no recebimento e no paciente

- **L-A3-1 · Base legal.** Art. 7º, IX (legítimo interesse da clínica em medir de onde vem o
  paciente), ou art. 7º, V na tarefa ou no recebimento vinculado. **Não é art. 11**, e precisa
  continuar separado do dado de aplicação (`retencao.md` §2). Atenção: uma campanha chamada
  "Tirzepatida Novembro" ou "Emagrecimento" transforma o vínculo paciente ↔ campanha em
  **inferência de saúde**. **(R)** No cadastro da campanha, dica fixa: "Não use nome de
  medicamento ou de condição de saúde no nome da campanha."
- **L-A3-2 · Minimização na lista vinculável.** Para quem não tem `campanhas`, a rota devolve
  **só `id` e `nome`**. Ficam fora meta, receita, investimento, contagem de pacientes e lista de
  pacientes. Colunas nomeadas, nunca `SELECT *`, como na busca. A forma da resposta não muda com a
  permissão: é outro contrato, não o mesmo com campos nulos.
- **L-A3-3 · Relatório da campanha.** "Receita gerada" continua **agregada**. Este item não cria
  lista nominal de pacientes por campanha. Se alguém quiser essa lista, ela é feature nova e passa
  por este gate.
- **L-A3-4 · 409 legível sem PII.** A mensagem do índice `tarefa_viva_da_campanha` não traz nome
  nem telefone da paciente: "Esta paciente já tem uma tarefa aberta nesta campanha." O nome da
  campanha pode aparecer.
- **L-A3-5 · Eliminação.** Anonimizar a paciente **preserva** `pacientes.campanha_id` e
  `tarefas.campanha_id`. A contagem e a receita por campanha não mudam, e a regra 28 confere a
  receita por campanha na migração. O vínculo sozinho, com a paciente anonimizada, não identifica
  ninguém.
- **L-A3-6 · Log.** `campanhaId` e `pacienteId` (uuids) podem aparecer em log. Nome da paciente,
  telefone e valor do recebimento não podem (regra 21).
- **L-A3-7 · Trilha.** A mudança de `campanha_id` em tarefa, recebimento ou paciente entra na
  trilha de escrita (de → para em ids), porque mexe na atribuição de receita (regra 20).

**Testes exigidos**
1. E2E: usuária sem `campanhas` lista as campanhas vinculáveis e recebe objetos com **exatamente**
   as chaves `{id, nome}` (comparar o conjunto de chaves).
2. E2E: o corpo do 409 de campanha duplicada não contém o nome nem o telefone da paciente.
3. E2E: vincular campanha grava linha de trilha com `de`/`para` = ids.

**Veredito A3: APROVADO COM CONDIÇÕES** (L-A3-2, L-A3-4, L-A3-7).

---

## B2 · "Indicado por" ligado a paciente cadastrada

O vínculo revela uma **relação entre duas titulares**: "Maria trouxe Carla para esta clínica".
Numa clínica de tratamento de obesidade, ser paciente já sugere condição de saúde, e o vínculo
conta isso **de uma pessoa sobre a outra**.

- **L-B2-1 · Base legal.** Art. 7º, IX (legítimo interesse da clínica em atribuir origem e
  reconhecer quem indica). **Não é art. 11**: o vínculo diz quem indicou, não o que foi tratado. A
  clínica, como controladora, registra o LIA no seu RIPD, e isso entra no DPA (P-3). Oposição:
  qualquer das duas pode pedir para desfazer o vínculo, e desfazer é editar o campo para `null`
  (sem fluxo novo).
- **L-B2-2 · FK composta com `SET NULL` — defeito no spec.** `FOREIGN KEY (clinica_id,
  indicado_por_id) … ON DELETE SET NULL` anula **as duas colunas**, inclusive `clinica_id NOT NULL`,
  e o `DELETE` falha. No Postgres 17, escrever
  `ON DELETE SET NULL (indicado_por_id)`. Mais um `CHECK (indicado_por_id IS DISTINCT FROM id)`
  contra autoindicação, e índice `(clinica_id, indicado_por_id) WHERE indicado_por_id IS NOT NULL`.
  O `DELETE` de paciente não acontece em produção (ADR 0003), mas acontece em `apagarClinicaDeTeste`
  e no futuro job de purga.
- **L-B2-3 · Um nome, um lugar.** Com `indicado_por_id` preenchido, `indicado_por` (texto) é
  gravado como `''`, no servidor. Sem isso, o nome da indicadora sobrevive em texto na ficha da
  indicada depois que a indicadora for anonimizada, e a eliminação dela fica incompleta sem que
  ninguém perceba. `CHECK (indicado_por_id IS NULL OR indicado_por = '')`.
- **L-B2-4 · Sem preenchimento automático do legado.** **Proibido** casar o `indicado_por` em texto
  (dado migrado) com pacientes pelo nome, em migration ou job. Homônimo vira relação falsa entre
  duas titulares (art. 6º, V, qualidade dos dados). No máximo uma **sugestão** que a recepção
  confirma (regra 27). Fora deste item.
- **L-B2-5 · Autocomplete.** Usa `GET /v1/busca-de-pacientes` sem mudança (D-7: `id, nome, telefone`,
  só ativas, limite 20). Na tela de indicação, **o telefone não é desenhado**, porque o nome já é
  único por clínica (`pacientes_nome_unico`). O campo só existe no formulário de paciente, que exige
  `pacientes`. O `termo` vai na query string. Confirmar com o `sre-devops-vps` que o access log do
  Traefik compartilhado da VPS e o logger do Fastify não gravam a query string de
  `/v1/busca-de-pacientes`. Se gravarem, isso já viola a regra 21 hoje, e o B2 só aumenta o volume.
  Bloqueia o deploy, não a construção.
- **L-B2-6 · Leitura do vínculo, e onde sai o nome.**
  - **Ficha da indicada** (rota com trilha): "Indicada por {nome}" com link para a indicadora, só
    se ela estiver **ativa**. Indicadora desativada ou anonimizada: "Indicada por uma paciente"
    sem nome e sem link.
  - **Lista de pacientes** (`SELECT_BASE`, sem trilha): leva no máximo `indicadoPorId`, **nunca o
    nome resolvido da indicadora**. O grafo "quem indicou quem" de 200 pacientes não sai numa
    leitura sem registro.
  - **Ficha da indicadora:** este spec **não** cria lista "indicou: A, B, C". Se ela vier depois,
    é só na ficha e passa por este gate.
- **L-B2-7 · Eliminação ou anonimização.**
  - **Da indicadora:** a linha é anonimizada, não apagada. O id fica, então
    `indicado_por_id` das indicadas **continua** apontando para ela e a contagem histórica de B3
    não muda. Como L-B2-3 garante que o nome dela não ficou em texto, nada a identifica.
  - **Da indicada:** a linha dela é anonimizada, incluindo `indicado_por` (texto) → `''`. O
    `indicado_por_id` pode ficar: aponta para a indicadora, mas sai de uma linha sem identidade.
  - **Indicadora fora do cadastro** (texto livre, dado de terceiro coletado indiretamente): quando
    ela pedir eliminação, o procedimento inclui uma busca por `normalizar_nome(indicado_por)` em
    `pacientes` da clínica, e esses campos vão para `''`. Escrever isso no procedimento do §3.
  - **Trilha de escrita:** o `de → para` guarda ids, não nomes. O texto livre antigo **fica** na
    trilha até a purga de 5 anos. Isso precisa ser dito ao titular (como em `retencao.md`, linha
    da trilha do painel).
- **L-B2-8 · Exportação.** O extrato da indicada leva "origem: Indicação", **sem o nome da
  indicadora**, que é terceira. O extrato da indicadora leva no máximo **quantas** indicou,
  **nunca os nomes**.
- **L-B2-9 · Log e erro.** Nome da indicadora não entra em log nem em mensagem de erro. O 400 de
  autoindicação diz "Uma paciente não pode indicar a si mesma.", sem nome.
- **L-B2-10 · Trilha.** Mudança de `indicado_por_id` entra na trilha de escrita (ids).

**Linhas para `retencao.md`** (o construtor insere no mesmo PR da migration 0062):

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|
| `pacientes.indicado_por_id` — vínculo indicada → indicadora cadastrada (0062) | Atribuir origem, reconhecer quem indica (B3) | Art. 7º, IX, com LIA da clínica e oposição | Indicada **e** indicadora | O da classe "cadastro do paciente" da indicada (classe pendente) | Fica ao anonimizar qualquer das duas (aponta para uma linha sem identidade). `null` a pedido de oposição de qualquer das duas |
| `pacientes.indicado_por` (texto) — nome de quem indicou **sem ser paciente**, e dado migrado | Atribuir origem | Art. 7º, IX | Indicada; e a indicadora, **terceira coletada indiretamente** | O do cadastro da indicada | `''` ao anonimizar a indicada, ou a pedido da indicadora (busca por nome normalizado). Fica na trilha até a purga de 5 anos |

**Testes exigidos**
1. Integração (Postgres real): autoindicação recusada pelo `CHECK`. Indicadora de outra clínica
   recusada pela FK composta. `DELETE` da indicadora (caminho de teste ou purga) deixa
   `indicado_por_id = null` e `clinica_id` intacto.
2. E2E: gravar `indicadoPorId` com `indicadoPor` não vazio → texto salvo como `''`.
3. E2E: `GET /v1/pacientes` (lista) não contém o nome da indicadora em nenhum campo (procurar o nome
   no corpo serializado).
4. E2E: indicadora desativada → a ficha da indicada não traz o nome nem o id navegável.
5. E2E: o corpo do 400 de autoindicação não contém o nome.
6. E2E: a edição do vínculo grava trilha com `de`/`para` = ids.

**Veredito B2: APROVADO COM CONDIÇÕES** (L-B2-2, L-B2-3, L-B2-6, L-B2-7, e L-B2-5 antes do deploy).

---

## B3 · "Quem mais indica" no Painel

Ranking **nominal** de pacientes. É uma lista de titulares mais a relação de cada uma com outras.

- **L-B3-1 · Base legal.** Art. 7º, IX (programa de reconhecimento e fidelização da clínica), com
  o mesmo LIA de B2. Não é art. 11.
- **L-B3-2 · Quem vê.** Só `painel` (que depende de `valores`, na tabela de `temPerm`). Não
  aparece na tela Hoje nem em nenhuma rota sem `painel`.
- **L-B3-3 · Minimização.** O bloco mostra **nome da indicadora + quantidade** de indicadas
  distintas, e no máximo os **10** primeiros. **Proibido** listar os nomes das indicadas no bloco
  ou num detalhe dele. Quem quiser ver, abre a ficha da indicadora, e a ficha tem trilha.
  Indicadora **desativada ou anonimizada não entra** no ranking. As indicadas desativadas continuam
  contando (o número é histórico), mas sem nome.
- **L-B3-4 · Receita das indicadas.** Se aparecer, sai de `recebimentos` (pagamentos que entraram,
  regra 3), **agregada por indicadora**, nunca por indicada, e passa pelo `RedacaoInterceptor`. A
  rota `/v1/painel` já é rota com dinheiro, e o campo novo precisa estar na declaração de chaves
  permitidas dela em `rotas-de-conferencia.ts`. Orçamento nunca entra (regra 4).
- **L-B3-5 · Sem cópia persistida.** O ranking é calculado na leitura. Ele não é gravado em
  snapshot, cache com prazo indefinido, `uso_diario_cliente`, resumo semanal nem mensagem. **Nunca
  atravessa para a carteira da Firmare** (ADR 0013 §2: agregados sem nome), nem para o Portal do
  Grupo.
- **L-B3-6 · Log.** Nomes do ranking não vão para log nem para mensagem de erro.
- **L-B3-7 · Trilha de acesso.** Não exigida: não é dado de saúde, e segue o mesmo critério da lista
  de pacientes. **(R)** Se o Painel ganhar detalhe por indicadora, esse detalhe vira rota com
  `@DadoSensivel('pacientes')`.

**Testes exigidos**
1. E2E: sem `painel` → 403 na rota do bloco.
2. E2E: com `painel` e sem `valores` impossível pela tabela. Se a tabela mudar, receita `null`.
3. E2E: a resposta contém só os nomes das indicadoras. O nome de uma indicada não aparece no corpo
   serializado.
4. E2E: indicadora desativada não aparece. Contagem de **distintas** com duas tarefas da mesma
   indicada = 1. Janela semiaberta pela data de cadastro no fuso da clínica (regra 23), com caso na
   borda.
5. E2E: carteira e portal não recebem o bloco (procurar o nome no agregado da carteira).

**Veredito B3: APROVADO COM CONDIÇÕES** (L-B3-2, L-B3-3, L-B3-5).

---

## B4 · Setor de atuação e tarefa para o setor

- **L-B4-1 · Classe do dado.** Setor de atuação é **dado de trabalho**, não dado sensível nem RH
  restrito. Base: art. 7º, V (execução do contrato de trabalho, pela clínica controladora). Fica
  em `pessoas` (ou `setores` + `pessoas.setor_id`), **nunca em `fichas_de_pessoa`** (0018, onde
  moram `cargo` e `salario` sob `pessoas.gerir`). Uma rota que devolve setor não devolve campo de
  ficha de RH. **Proibido** derivar o setor de `cargo` ou ligar um ao outro.
- **L-B4-2 · Nome do setor.** O setor não codifica condição da pessoa ("Afastadas", "Gestantes",
  "Licença médica" seriam dado de saúde, art. 11, de funcionária). **(R)** Dica fixa no cadastro de
  setor: "Setor é onde a pessoa atua, não a situação dela."
- **L-B4-3 · Setor amplia quem vê dado de paciente, e a ADR precisa dizer isso.** Uma tarefa de
  sessão ("Aplicação 5/12 · Tirzepatida 2,5 mg") enviada a um setor aparece para **todo o setor**.
  A ADR exigida pelo spec tem que responder, por escrito:
  - a visibilidade vale para **as pessoas ativas do setor no momento da leitura**: quem saiu do
    setor ou foi desativada deixa de ver;
  - setor **nunca autoriza** (mesmo princípio do glossário): a pessoa só vê a tarefa de setor se
    também tiver as permissões que veria numa tarefa atribuída a ela;
  - a trilha precisa responder "quem podia ver esta tarefa em tal data": a mudança de setor de uma
    pessoa e a mudança do destino da tarefa entram na trilha de escrita (de → para, ids);
  - quem concluiu fica gravado como pessoa (`concluida_por`), nunca como setor. A meta conta para
    a pessoa, não para o grupo.
- **L-B4-4 · Glossário.** `CONTEXT.md` já define `Setor` para o `Usuário de Gestão` (carteira,
  "nunca autoriza"). O setor de atuação da clínica é outro conceito, e o termo entra no glossário
  antes do código. A carteira **não** lê setor de pessoa da clínica (ADR 0013 §2).
- **L-B4-5 · Eliminação.** A pessoa se desativa, nunca se apaga. Setor excluído é soft delete
  (`excluido_em`), porque tarefas o referenciam. O setor da pessoa fica enquanto a identidade
  existir.
- **L-B4-6 · Exportação da funcionária.** Leva o setor e o histórico de setor dela, **sem** a lista
  das colegas do setor.
- **L-B4-7 · Log.** Nome de pessoa e nome de paciente da tarefa de setor fora do log.

**Linhas para `retencao.md`** (mesmo PR da migration 0066):

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|
| `setores` (nome por clínica) | Organizar quem recebe tarefa | — (não é dado pessoal) | — | Enquanto em uso | Soft delete |
| `pessoas.setor_id` — setor de atuação da funcionária (0066) | Entregar tarefa ao setor e decidir quem a vê | Art. 7º, V (contrato de trabalho, clínica controladora) | Funcionária | O da identidade `pessoas`: vínculo **mais 5 anos** | Nenhuma em separado: segue a desativação da pessoa. O histórico fica na trilha de escrita (5 anos) |

**Testes exigidos**
1. E2E: tarefa de setor visível a uma pessoa ativa do setor. Depois de sair do setor, a mesma pessoa
   não vê (é a leitura que decide, não a criação).
2. E2E: pessoa do setor sem a permissão que a tarefa exigiria não vê (setor não autoriza).
3. E2E: a rota de setores e de pessoas por setor não devolve `cargo`, `salario` nem campo de ficha
   de RH (comparar o conjunto de chaves).
4. E2E: concluir tarefa de setor grava a pessoa que concluiu. Mudança de setor grava trilha.

**Veredito B4: APROVADO COM CONDIÇÕES** (L-B4-1 e L-B4-3 dentro da ADR. A ADR volta a este gate
antes do ticket).

---

## Vereditos

| Item | Veredito | Condições que bloqueiam |
|---|---|---|
| A2 | **APROVADO COM CONDIÇÕES** | L-A2-2, L-A2-3, L-A2-5 |
| A3 | **APROVADO COM CONDIÇÕES** | L-A3-2, L-A3-4, L-A3-7 |
| B2 | **APROVADO COM CONDIÇÕES** | L-B2-2 (correção do spec), L-B2-3, L-B2-6, L-B2-7. L-B2-5 bloqueia o deploy |
| B3 | **APROVADO COM CONDIÇÕES** | L-B3-2, L-B3-3, L-B3-5 |
| B4 | **APROVADO COM CONDIÇÕES** | ADR com L-B4-1 e L-B4-3, que volta a este gate |

Pendências fora do escopo, a registrar pelo orquestrador (este gate não edita outros arquivos):
classe "cadastro do paciente" em `retencao.md`; procedimento de anonimização do paciente (§3,
incluindo L-B2-7 e L-A3-5); forma do extrato do titular (§4, L-A2-8, L-B2-8); conferência do access
log do Traefik para a query string da busca (L-B2-5).

---

## B4 — revisão da ADR 0025

Revisados: `docs/adr/0025-setor-de-atuacao-e-tarefa-para-o-setor.md` (proposta, 2026-11-09), a
seção B4 reescrita de `docs/specs/correcoes-po-2026-11-09.md` (tickets B4-1 a B4-9, AB-B4-1 a
AB-B4-25) e o verbete `Setor de atuação` em `CONTEXT.md` (mais as linhas de termos proibidos, de
`Tarefa`/`concluida_por`/`Para quem a tarefa conta` e de `Setor da carteira`). Conferido na fonte:
`0004_auditoria.sql` (`pessoas`, `perfis`, `sessoes` já têm `registrar_auditoria`, com de → para
só do que mudou, e INSERT com a linha inteira), `0022_sessao_de_operador.sql` (sessão de suporte é
linha de `sessoes`, auditada) e `retencao.md` (sem linha de `tarefas` nem de cadastro do paciente).

### Conferência dos requisitos

| Requisito | Atendido? | Onde | Observação |
|---|---|---|---|
| **L-B4-1** Classe, base legal, `pessoas` e não `fichas_de_pessoa`, sem derivar de `cargo` | **Sim** | ADR §2, §8, §12, §14; CONTEXT invariante "Dado de trabalho, não de RH"; B4-3/B4-4; AB-B4-10 | Gestão sob `config`, não `pessoas.gerir`: correto, e evita dar salário a quem organiza o balcão. Proibição de derivar de `funcao`/`cargo`/perfil está na migration e no script de implantação. |
| **L-B4-2** Nome do setor não codifica condição | **Sim (R atendida)** | ADR §9; B4-8; CONTEXT | Dica fixa presente. |
| **L-B4-3a** Quem vê = pessoas **ativas** no setor **no momento da leitura** | **Sim** | ADR §4; B4-6 (`DO_MEU_SETOR` com `AND ativo`, lido na transação, nunca de cache/sessão/cliente); CONTEXT; AB-B4-2, -8, -23 | Rejeição explícita de copiar membros na tarefa. Ver condição 2 sobre **concluídas antigas**, que a regra "estado atual" sozinha alarga. |
| **L-B4-3b** Setor nunca autoriza | **Sim** | ADR §4 (mesma `SELECT_TAREFA`, mesmo `RedacaoInterceptor`, mesmos portões `podeJornada`/`pacientes`); CONTEXT invariante; AB-B4-6, -9 | Correto também no sentido inverso: setor não dá `config`, não dá `pacientes`, não dá `valores`. |
| **L-B4-3c** Trilha "quem podia ver esta tarefa naquela data" | **Sim, com condição** | ADR §10; B4-9 (reconstrução só pela `auditoria`, prova por mutação da trigger de `pessoas`) | As três fontes existem e são auditadas. Faltam duas no conjunto: a sessão de suporte e o solicitante quando a tarefa é editada (condição 3). O parágrafo final de §10 deixa a trilha de acesso "para outra decisão": este gate decide (condição 4). |
| **L-B4-3d** Conclusão gravada como pessoa; meta para a pessoa | **Sim** | ADR §6 (`concluida_por` = pessoa da sessão, `CHECK tarefa_de_setor_concluida_tem_quem_concluiu`, `PESSOA_QUE_CONTA`, P4); CONTEXT `Tarefa`; AB-B4-5, -11, -12, -20 | Bom: não inventa autoria para o passado (§12) e não muda mês fechado. `concluida_por` é **dado novo de funcionária em toda tarefa**, não só na de setor, e não tinha linha de retenção (condição 1). |
| **L-B4-4** Glossário, separação da carteira, carteira não lê | **Sim** | ADR §1, §6 (só `prazos.total` atravessa); CONTEXT (termo proibido `setor` sozinho, `Setor da carteira`) | — |
| **L-B4-5** Eliminação: pessoa desativa, setor soft delete | **Sim** | ADR §2 (sem DELETE para `fir_app`), §9; B4-2 | Desativar a pessoa nunca é bloqueado pelo setor: correto. |
| **L-B4-6** Exportação da funcionária sem lista das colegas | **Sim, com condição** | ADR §14 | Falta o lado do **paciente** (`concluidaPorNome` é terceiro) e o conteúdo das tarefas que ela concluiu (condição 5). |
| **L-B4-7** Log | **Sim** | ADR §13, §14; AB-B4-25 | Mensagens de 400/409 do setor não trazem nome de pessoa nem de paciente. |
| **Retenção** (linhas no PR da 0066) | **Não ainda** | ADR §14 cita "as duas linhas que o gate escreveu" | As linhas do gate usam os nomes provisórios `setores` e `pessoas.setor_id`, e não cobrem `concluida_por`. Substituídas abaixo (condição 1). |
| Sessão de programa fora do setor | **Sim** (vai além do pedido) | ADR §11, `CHECK sessao_nao_vai_para_setor`; AB-B4-22 | É o que tira da superfície o caso mais sensível (dose e aplicação). Qualquer ADR que remova o `CHECK` passa por este gate **antes** (condição 7). |

### Veredito

**ADR 0025: APROVADA COM CONDIÇÕES** pelo gate LGPD. As condições 1 a 5 bloqueiam os tickets
indicados. A 6 e a 7 são regras para o futuro, e entram no texto da ADR antes de ela virar
**aceita**. Nada aqui reabre o modelo de dados.

### Condições

1. **Retenção no PR da 0066 (bloqueia B4-2).** As linhas abaixo **substituem** as duas da seção B4
   deste gate. O §14 da ADR passa a dizer "as linhas da revisão do gate LGPD (três classes)", e
   `concluida_por` entra no §14 com classe, base, titular e prazo. É dado novo de desempenho de
   funcionária, gravado em **toda** tarefa concluída a partir da 0066, e lido pela meta.
2. **Concluídas e canceladas antigas não alargam com o tempo (bloqueia B4-6).** "Quem está no setor
   agora" resolve quem **sai**, mas abre o passado a quem **entra**: a enfermeira contratada em 2027
   veria, no filtro do próprio setor em Tarefas, toda tarefa concluída da Enfermagem desde 2026, com
   nome, telefone e `programaOrcado` de pacientes que nunca atendeu. Nenhuma tarefa de pessoa tem
   esse efeito. A ADR (§4 e §7) e `DO_MEU_SETOR` precisam limitar o que o **membro** vê da tarefa
   de setor a:
   (a) as **abertas**;
   (b) as concluídas ou canceladas **no dia corrente**, no fuso da clínica (as "Concluídas do dia"
   de §7).
   O histórico anterior fica com o solicitante e com *Equipe toda*. **(R)** Incluir também
   `concluida_por = eu`, enquanto ela estiver no setor, para ela ver o que contou na meta dela.
   Isso é decisão do `product-rotina-clinica`, e não alarga o público, porque ela já viu aquela
   paciente. A regra vale também para reabrir: o membro só reabre o que enxerga. Teste novo
   **AB-B4-26**: A entra em S depois de T1 ter sido concluída em S num dia anterior. A não vê T1 em
   Hoje, em Tarefas (`?setorDeAtuacaoId=S`, qualquer status) nem por `GET /v1/tarefas/:id`, e não a
   reabre (403/404).
3. **Reconstrução completa (bloqueia B4-9).** A consulta documentada em `docs/compliance/` e o e2e
   reconstroem o público em D como a união de: (a) os membros ativos em D (`auditoria` de `pessoas`:
   `setor_de_atuacao_id` e `ativo`), aplicando o recorte da condição 2; (b) o **solicitante em D**,
   porque `solicitante_id` também está na `auditoria` de `tarefas` se um dia for editável;
   (c) quem tinha `tarefas.equipe` em D (`pessoas.perfil_id` e `perfis`); (d) as **sessões de
   suporte vivas em D** naquela clínica (`auditoria` de `sessoes` com `operador_id`, D-13), que veem
   por *Equipe toda*. A resposta é "quem **podia** ver". Quem **efetivamente** abriu a ficha da
   paciente vem da trilha de acesso, e o documento diz as duas coisas sem confundi-las. O e2e de
   B4-9 inclui um passo com troca de perfil que tira `tarefas.equipe` e um com sessão de suporte.
4. **Trilha de acesso: a decisão que §10 deixou aberta (bloqueia o aceite da ADR).** Este gate
   **não** exige `acessou` por leitura de lista de tarefa, nem de pessoa nem de setor: é o critério
   já aplicado em L-A2-4, e o registro por leitura de lista seria ruído que esconde o que importa.
   As condições são três:
   (a) a ficha da paciente continua sendo o único caminho para o histórico inteiro, com
   `@DadoSensivel('pacientes')` (L-A2-2). **Nenhuma** rota nova de B4 devolve tarefas de setor
   filtradas por paciente;
   (b) o controle compensatório do alargamento é a reconstrução da condição 3, e a ADR diz isso;
   (c) como B4 multiplica o público de uma tarefa de orçamento por N, a questão aberta de L-A2-4
   (a recepção precisa de `programaOrcado[].dose` na lista, ou só do rótulo?) sobe de prioridade e
   precisa estar **respondida antes do B4-6**. Se a resposta for "só o rótulo", a redação vale para
   tarefa de pessoa e de setor igualmente (setor nunca autoriza nem desautoriza), no mesmo ponto da
   regra 17.
   A ADR substitui o último parágrafo de §10 por este texto.
5. **Exportação (bloqueia nada agora, entra na dívida do §4 de `retencao.md`).** O extrato do
   **paciente** não leva `concluidaPorNome`, `responsavelNome` nem o nome do setor junto de quem
   estava nele. São dado de terceiro (extensão de L-A2-8). O extrato da **funcionária** leva o setor
   atual, o histórico de setor dela (datas de entrada e saída) e **quantas** tarefas concluiu por
   período. Ele **não** leva o nome, o telefone nem o conteúdo das tarefas que ela concluiu, que
   são dado de pacientes.
6. **`GET /v1/setores-de-atuacao/pessoas` só com ativas (B4-3).** Minimização: a lista de quem está
   em cada setor devolve só pessoas **ativas**, com `{id, nome}`. Desativadas não aparecem, mesmo
   que ainda apontem para o setor (ADR §9). A contagem do 409 de exclusão já é de ativas. Teste no
   AB-B4-10: pessoa desativada no setor não aparece no corpo.
7. **Remover `sessao_nao_vai_para_setor` exige este gate antes da ADR seguinte.** A ADR §11 e P3
   passam a dizer isso. Aplicação, dose e lote para um setor é finalidade do art. 11, II, "f", com
   leitura própria em `programas/leitura.service.ts`, e não herda esta aprovação.

O verbete de `CONTEXT.md` está **aprovado como está**. Quando a condição 2 entrar na ADR, a frase
"Quem entra passa a ver as abertas" já é exatamente a regra. Acrescentar só "e as concluídas do
dia, nunca o histórico do setor".

### Linhas exatas para `docs/compliance/retencao.md` (mesmo PR da migration 0066)

Inserir numa subseção nova `### Setor de atuação e conclusão de tarefa (ADR 0025, migration 0066)`,
logo depois da tabela de §1 da clínica (antes de "Carteira comercial da Firmare"):

| Dado | Finalidade | Base legal | Titular | Prazo | Ação no fim |
|---|---|---|---|---|---|
| `setores_de_atuacao` (`nome` por clínica, `criado_em`, `excluido_em`) | Organizar para onde vai uma tarefa | — (não é dado pessoal; o nome diz onde se atua, nunca a situação de alguém — L-B4-2) | — | Enquanto em uso | Soft delete (`excluido_em`), só com o setor vazio. Nunca `DELETE` por `fir_app` |
| `pessoas.setor_de_atuacao_id`: setor de atuação da funcionária (0066) | Entregar tarefa ao setor e decidir, na leitura, quem a vê | Art. 7º, V (execução do contrato de trabalho, clínica controladora) | Funcionária | O da identidade `pessoas`: vínculo **mais 5 anos** | Nenhuma em separado: segue a desativação da pessoa. O histórico de entrada e saída fica na trilha de escrita (5 anos), e é ele que responde "quem podia ver esta tarefa naquela data" |
| `tarefas.concluida_por`: a pessoa que concluiu a tarefa, em **toda** tarefa concluída a partir da 0066. `NULL` nas anteriores | Registrar quem fez, e creditar a meta individual na tarefa de setor (`PESSOA_QUE_CONTA`) | Art. 7º, V (contrato de trabalho) | Funcionária | O da linha da tarefa (classe de `tarefas` ainda pendente, junto com o cadastro do paciente), e nunca menos que o horizonte da meta já fechada | Fica ao anonimizar a paciente: é dado da funcionária, e a meta histórica depende dele. Zerado ao reabrir ou cancelar, com o valor anterior na trilha de escrita (5 anos). Não entra no extrato do paciente |
| `tarefas.setor_de_atuacao_id`: destino da tarefa quando ela vai para um setor (0066) | Entregar a tarefa e reconstruir quem podia vê-la | — (não é dado pessoal sozinho; a tarefa herda a classe dela) | — | O da linha da tarefa | Fica ao anonimizar a paciente. Trocas na trilha de escrita (5 anos) |

**Testes exigidos, além dos de B4 acima**
1. AB-B4-26 (condição 2).
2. B4-9 com troca de perfil e sessão de suporte (condição 3).
3. AB-B4-10 com pessoa desativada no setor (condição 6).
4. `retencao.md` com as quatro linhas no mesmo diff da 0066 (o revisor confere no PR).

| Item | Veredito | Condições que bloqueiam |
|---|---|---|
| ADR 0025 / B4 | **APROVADA COM CONDIÇÕES** | 1 (B4-2), 2 (B4-6), 3 (B4-9), 4 (aceite da ADR; 4c antes do B4-6) |

### B4 — segunda passada: ADR 0025 revisada (2026-11-09)

Relidos: a ADR 0025 revisada (status "proposta", com P1–P8, N-24, N-25 e a condição 2 respondidas
pelo dono, §16), o verbete `Setor de atuação` e as linhas de `Tarefa` em `CONTEXT.md`, e a seção B4
do spec (tickets B4-1 a B4-9, AB-B4-1 a AB-B4-36). Conferido na fonte, porque o texto obrigatório
de `DO_MEU_SETOR` depende disto: `pessoas.excluida_em` existe (0023) e implica `NOT ativo`;
`tarefas.concluida_em` existe e é `NOT NULL` exatamente quando `status = 'concluida'` (0006,
`concluida_tem_instante`). O recorte "concluída hoje" tem, portanto, o instante de que precisa.
`fechamento.service.ts:123-140` monta o programa a partir de `cartao.programaOrcado`, lido do
banco, e não do corpo da requisição.

**Numeração.** O AB-B4-26 deste gate é o **AB-B4-36** do spec, que reservou 26 a 35 para o appsec.
Daqui em diante vale o número do spec.

#### (a) Condições 1 a 7 na ADR revisada

| # | Condição | Atendida? | Onde | Observação |
|---|---|---|---|---|
| 1 | Retenção no PR da 0066 (quatro linhas) | **Sim** | ADR §14.1; spec B4-2 ("as quatro linhas exatas … retencao.md no mesmo diff") | A tabela do §14.1 é **resumo**. O construtor copia o texto das linhas exatas da seção acima, não o resumo da ADR, e o revisor do PR confere isso. `concluida_por` está declarado como dado novo de desempenho de funcionária, em toda tarefa. |
| 2 | Membro não vê o histórico do setor | **Sim, mais estrito que o pedido** | ADR §4.1 (texto obrigatório de `DO_MEU_SETOR`), §5 (`membroVe`; quem concluiu reabre só enquanto vê), §7 (filtro do próprio setor ignora situação e período pedidos; dia navegado não mostra concluída de setor); `uma`/`carregar` devolvem 404; CONTEXT; AB-B4-36, AB-B4-16, AB-B4-28 | A (R) "concluída por mim" não foi adotada: decisão do dono, aceita. Também aceito que a cancelada não entre nem no dia, porque `tarefas` não guarda o instante do cancelamento. O recorte fica do lado de negar. |
| 3 | Reconstrução completa de "quem podia ver" | **Sim** | ADR §10.1 (a)–(d), §10.2; spec B4-9 (sequência com dia seguinte, troca de perfil, sessão de suporte, mutação da trigger) | (a) aplica o recorte do §4.1 na própria reconstrução, que é o certo: "podia ver" passou a depender do dia. |
| 4 | Trilha de acesso: decisão de §10 | **Sim** | ADR §10.3 (texto deste gate); spec B4-6 "depois da resposta da ADR §10.4" | (c) é tratado no item (c) abaixo. |
| 5 | Exportação | **Sim** | ADR §14.2 | Continua como dívida do §4 de `retencao.md`. Nada a construir agora. |
| 6 | Lista de pessoas por setor só com ativas | **Sim** | ADR §8, §9; spec B4-3; AB-B4-10 | A 409 de exclusão leva só contagens (S-59). |
| 7 | Remover `sessao_nao_vai_para_setor` passa por este gate antes | **Sim** | ADR §11, §16 P3; spec "O que fica igual" | — |

Também conferido, porque toca dado pessoal e entrou depois da primeira passada:
- **FKs compostas de `responsavel_id`/`solicitante_id`, com pré-condição que aborta (S-51).** A
  mensagem leva só contagens por coluna, sem id de pessoa nem de paciente. De acordo com a regra 21.
- **Reativar pessoa de setor excluído zera o setor (S-59)**, com a troca na trilha. Mantém a
  reconstrução coerente.
- **403 de conclusão sem o corpo da tarefa (S-55, AB-B4-29).** Fecha a leitura de dado de paciente
  por mensagem de erro. Bom.
- **`ContextoDaRequisicao` sem setor (S-56).** Coincide com L-B4-3a ("lido na leitura, nunca de
  sessão").

#### (b) Declaração de alargamento S-60 (ADR §14.4): **ciente e aceita**

O gate registra **ciência e aceite**. O alargamento declarado é este: o perfil padrão Enfermagem
(`pf_enf`), **sem `pacientes` e sem `jornada`**, passa a ver **nome e telefone** da paciente de toda
tarefa mandada para o setor dela, por decisão de qualquer pessoa da clínica, para o setor inteiro
de uma vez.

Por que este gate aceita:
1. **Não é dado novo para o perfil.** Hoje a mesma enfermeira já vê nome e telefone de toda tarefa
   em que é responsável. O setor muda o **número** de pessoas e **quem decide**, não a natureza do
   dado. Pela finalidade (executar a tarefa: ligar, receber, preparar), nome e telefone são o mínimo
   para cumprir a tarefa. Setor nunca autoriza e também nunca desautoriza, e redigir o telefone só
   na tarefa de setor criaria uma tarefa que o setor não consegue cumprir.
2. **O que atravessa é identificação, não dado de saúde.** Sem `jornada`, os três blocos saem
   vazios. Sem `valores`, o dinheiro sai `null`. Sem `pacientes`, não há link para a ficha. A dose
   sai das listas (item (c)). A sessão de programa não vai para setor. Num contexto de clínica de
   tratamento, ser paciente sugere condição de saúde, mas essa inferência já existe para toda a
   equipe que vê a agenda. B4 não a cria.
3. **Os seis limites do §14.4 são verificáveis.** Cada um tem teste nomeado (AB-B4-6, -9, -3,
   -36, -22, e o B4-9).

As condições do aceite **não bloqueiam a passagem da ADR a "aceita"** e entram nos tickets
indicados:
- **S60-1 · Transparência no ponto de decisão (B4-8).** No campo "Para", ao escolher um setor numa
  tarefa **com paciente**, um texto fixo abaixo do campo: *"Todas as pessoas ativas de {setor}
  verão esta tarefa, com o nome e o telefone da paciente."* É quem cria a tarefa, e não o
  sistema, que decide o alargamento, e ela decide sabendo. O texto não traz contagem nem nomes de
  membros. O MANUAL repete a frase no parágrafo "quem vê".
- **S60-2 · Registro do controlador (orquestrador, fora deste arquivo).** Entra em
  `docs/decisoes.md`, junto do DPA (P-3), que o RIPD da clínica precisa citar: "perfis sem
  `pacientes` podem ver nome e telefone de paciente em tarefa de setor". A clínica é a
  controladora. Ela precisa saber que a configuração de setores é também uma configuração de
  quem vê identificação de paciente, e é por isso que pôr alguém num setor exige `config`.
- **S60-3 · Teste do limite (B4-6).** Acrescentar ao AB-B4-6/-9 o caso do perfil `pf_enf` real
  (`perfisPadrao`): membro de Enfermagem vê `pacienteNome` e `pacienteTelefone` da tarefa de setor,
  e **não** recebe link de ficha, blocos da jornada, valores nem `dose` (varredura recursiva do
  corpo). Assim o §14.4 vira teste, não só texto.

#### (c) Parecer sobre a resposta proposta a L-A2-4 (ADR §10.4): **favorável, com condições**

"Só o rótulo" é a resposta certa. Ela é **minimização de verdade**: tira a dose de **toda** lista,
para tarefa de pessoa e de setor, em vez de compensar o alargamento só no caso novo. Também
concordo com a forma: um **tipo sem a chave** (`ItemOrcadoNaLista`) é mais forte que redação por
nome no interceptor, e a recusa desta última está registrada nas alternativas. A medição no código
confere: a lista só pergunta **se há** proposta (`faixa-da-jornada.tsx:301`), e o fechamento lê a
proposta do banco (`fechamento.service.ts:123`), não do corpo. A pergunta L-A2-4 da primeira passada
fica **respondida**, desde que `product-rotina-clinica` confirme no protótipo, como a ADR pede.

Condições (bloqueiam o B4-6, que é onde a ADR põe a mudança):
- **LA24-1 · Escrita não apaga a dose.** É o risco que a ADR não cobre. Se algum formulário de
  edição de orçamento for preenchido a partir de uma resposta de **lista** (sem `dose`) e reenviar
  `programaOrcado` inteiro, o servidor gravaria `dose` ausente, e a dose orçada seria **apagada em
  silêncio**. Isso é perda de dado de saúde e falha de qualidade (art. 6º, V). Por isso:
  - toda escrita de `programaOrcado` **preserva a `dose` gravada por `chave`** quando o item chega
    sem a chave `dose`;
  - ou o formulário de orçamento carrega o item de uma leitura de detalhe sob `pacientes`, como a
    própria ADR sugere.

  O construtor escolhe uma das duas e a escreve no ticket. Teste: editar o orçamento a partir da
  tela Hoje sem tocar na dose e conferir que a `dose` no banco não mudou. A mutação "sobrescreve
  com `null`" derruba o teste.
- **LA24-2 · Varredura, não lista de rotas.** Um teste percorre **toda** rota que devolve
  `TarefaNaLista` ou `ItemOrcadoNaLista`, descobertas pelo registro de rotas e não por lista à
  mão. Ele procura a chave `dose` em qualquer profundidade do corpo e exige zero. Entram também as
  respostas de escrita (`concluir`, `editar`, `reabrir`, passos da jornada) e
  `GET /v1/tarefas/:id`. Prova: pôr `dose` de volta no tipo de lista derruba o teste.
- **LA24-3 · A ficha é o único caminho com dose.** O cartão da jornada na ficha da paciente (A2) usa
  o tipo **com** dose apenas dentro de `GET /v1/pacientes/:id` (`@DadoSensivel('pacientes')`,
  L-A2-2). Proibido o web reaproveitar uma resposta de lista para desenhar a dose na ficha, ou a
  ficha reaproveitar o tipo de lista e "completar" a dose por outra rota sem marcação.
- **LA24-4 · Resíduo declarado, não bloqueia.** O tipo não alcança texto livre. A dose ainda pode
  chegar à lista pela `descricao`. É o caso do rótulo que o montador gera para **sessão**
  (`montador.service.ts:346-355`, "Aplicação 5/12 · Tirzepatida 2,5 mg"), mas sessão não vai para
  setor, então B4 não alarga esse caminho. A dose também pode chegar por `historico[].nota`, escrita
  por pessoa. Isso fica como questão aberta de L-A2-4 para a **tarefa de sessão em tarefa de
  pessoa**: o rótulo da sessão precisa da dose na lista? O orquestrador registra como dívida. Ela
  passa a **bloquear** o dia em que a condição 7 for invocada (sessão para setor).

#### (d) Veredito final

**ADR 0025: APROVADA pelo gate LGPD. Pode passar a "aceita"** no que depende deste gate. As
condições 1 a 7 estão incorporadas, a declaração S-60 tem ciência e aceite registrados aqui, e a
resposta a L-A2-4 tem parecer favorável.

Nenhuma condição desta segunda passada reabre a ADR. Todas entram nos tickets:

| Condição | Onde entra | Bloqueia |
|---|---|---|
| S60-1 · texto fixo no campo "Para" + MANUAL | B4-8 | o "feito" do B4-8 |
| S60-2 · registro do controlador em `decisoes.md` (DPA/RIPD) | orquestrador | a implantação em clínica, não a construção |
| S60-3 · teste do perfil `pf_enf` real | B4-6 | o "feito" do B4-6 |
| LA24-1 · escrita preserva a dose | B4-6 (ou o ticket que implementar §10.4) | o B4-6 |
| LA24-2 · varredura da chave `dose` em toda resposta de lista | B4-6 | o B4-6 |
| LA24-3 · dose só pela ficha marcada | B4-6 / A2 | o B4-6 |
| LA24-4 · dose em texto livre (rótulo de sessão, nota) | dívida, pelo orquestrador | a futura ADR de sessão para setor (condição 7) |

**Confirmação de produto.** O parecer de `product-rotina-clinica` (seção "Parecer de produto —
L-A2-4", logo abaixo) decide "só o rótulo" e é compatível com este. Duas observações dele afetam
este gate:
- **A divergência do protótipo.** `resumoProgOrc` (protótipo L4819) inclui a dose no cartão de
  orçamento. Isso não muda o parecer, porque minimização aqui vence paridade. Mas a ADR precisa
  registrar a divergência no cabeçalho e em §10.4 antes do B4-6, como o produto pede.
- **LA24-1 continua obrigatória.** Os critérios de aceite do produto (1 a 5) não incluem editar o
  orçamento a partir do cartão sem dose. O caso concreto é o B1 desta onda, "Corrigir o orçamento
  já enviado". Acrescentar como critério 6: *corrigir o orçamento pelo cartão em Hoje, sem tocar na
  dose → a `dose` gravada não muda.* A futura linha "Programa orçado: …" (dívida de paridade do
  produto) sai sem dose, e é coberta pela varredura de LA24-2.

## Parecer de produto — L-A2-4

**Autor:** `product-rotina-clinica` · 2026-11-09 · responde ADR 0025 §10.4 e a condição 4c acima.

**Decisão: só o rótulo.** As respostas de lista (`GET /v1/hoje`, `GET /v1/tarefas`,
`GET /v1/tarefas/:id` e toda escrita que devolve `TarefaNaLista`) levam o programa orçado **sem
`dose`** (`ItemOrcadoNaLista`). A dose orçada fica na ficha da paciente e na tela de Programas.
Vale igual para tarefa de pessoa e de setor.

**Correção de fato na ADR §10.4.** "Nenhum fluxo de lista exibe a dose" vale para o nosso código,
mas **não vale para o protótipo**. `esteiraCardHtml` (L4790) põe no cartão de orçamento, fechado
ou perdido a linha "Programa orçado: …", e `resumoProgOrc` (L4819) inclui `it.dose`
("Tirzepatida 4× 2,5 mg → Tirzepatida 4× 5 mg"). O cartão é o mesmo `cardTarefa` em Hoje, Tarefas e
Jornada: nenhuma chamada passa `semEsteira`. Por isso esta decisão é **divergência deliberada do
protótipo**. A ADR 0025 precisa registrá-la no cabeçalho "Divergência do protótipo" e em §10.4
antes do B4-6. Sem esse registro, a próxima conferência de paridade vai reabrir o assunto como
se fosse bug.

**Por que a recepção não precisa da dose no cartão.**
- O cartão de orçamento serve ao ritual do **follow-up**: retomar o contato na data marcada e
  levar a paciente a fechar ou perder. Nessa conversa a recepcionista precisa saber o quê
  (procedimento e sessões), quanto (valor, se tem `valores`) e quando retomar. A dose é decisão
  da médica. Quando a paciente pergunta pela dose, a resposta é clínica, não de balcão, e a ficha
  está a um toque no nome da paciente. A pergunta é rara e não paga uma linha num cartão de
  rotina, ainda mais num cartão que o B4 mostra a N pessoas.
- A escalada continua visível sem a dose. "Tirzepatida 4× → Tirzepatida 4×" diz que há duas
  etapas. O detalhe de cada etapa fica na ficha.
- O **Fechou** não precisa da dose no cliente. O protótipo remonta o montador a partir de
  `programaOrc` (`bldDoOrcamento`, L4814-4817). O nosso servidor monta a partir do que está
  gravado (`fechamento.service.ts:140`), e a tela só pergunta o início
  (`faixa-da-jornada.tsx:301`, `:457`). A correção de orçamento não reabre o programa.
- Onde a dose é **trabalho**, ela continua no cartão. A tarefa de sessão leva a dose na
  `descricao` ("Aplicação 3/8 · Tirzepatida 5 mg", `montador.service.ts:355`, igual ao protótipo
  L1847), porque quem aplica precisa dela. Isso fica como está e não é coberto por esta decisão.
  Sessão não vai para setor (ADR §11), então o B4 não multiplica esse público.

**Critérios de aceite (B4-6)**
1. Com uma paciente cujo orçamento tem programa com dose "2,5 mg", abrir o cartão em Hoje, em
   Tarefas e na Jornada, com usuária de pessoa e com membro de setor: "2,5 mg" não aparece no
   cartão e não aparece no JSON de nenhuma das quatro respostas de lista (ver na aba de rede).
2. Na mesma conta, abrir a ficha da paciente: o programa orçado aparece com "2,5 mg".
3. Tocar em **Fechou** nesse cartão, informar a entrada e salvar: o programa montado em
   Programas tem a dose "2,5 mg" em cada sessão, sem que a dose tenha passado pela tela.
4. Tarefa de sessão desse programa em Hoje continua mostrando "· Tirzepatida 2,5 mg" na
   descrição.
5. Teste de contrato: `ItemOrcadoNaLista` não tem a chave `dose`, e `paraSaida` é o único
   ponto que monta o item a partir do `ItemOrcado`.

**Fica de fora**
- Tirar a dose da `descricao` da sessão. É a dose a aplicar, de quem aplica, e é paridade.
- **Lacuna de paridade, fora do B4.** O nosso cartão não desenha a linha "Programa orçado: …"
  que o protótipo mostra no orçamento. Ela ajuda o follow-up (a recepção vê o que foi orçado sem
  abrir a ficha), então vai para `docs/dividas.md` como paridade. Quando for feita, sai **sem
  dose**, no formato desta decisão. Não atrasa a migração e não entra no B4-6.

---

## A3 — campanha sugerida

Responde a L-A3-1 da revisão de código. Conferido na fonte: `vinculaveis.controller.ts`
(`?paciente=` lido só com `pacientes`, sem marca), `campanha-vinculavel.ts` (`campanhaSugerida`),
`acesso.decorator.ts`/`acesso.interceptor.ts` (o id sai **só** de `req.params`, e a marca é
incondicional), `vinculos-do-cadastro.ts` (`pacientes.campanha_id` sai **só** na ficha, sob
`@DadoSensivel('pacientes')`) e `contracts/src/tarefas.ts` (`TarefaNaLista.campanhaId`).

**O achado procede.** `sugerida` é a campanha de origem da paciente (`pacientes.campanha_id`)
sempre que ela está em andamento. Esse dado hoje só sai na ficha, que tem trilha. Pela rota
vinculável, quem tem `pacientes` itera os uuids da lista de pacientes (que não tem trilha) e
monta o mapa "paciente ↔ campanha de origem" da clínica inteira **sem uma linha de acesso**. É o
mesmo desvio que L-A2-2 proíbe para as tarefas e L-B2-6 para o grafo de indicação. Com campanha
chamada "Tirzepatida", o mapa vira inferência de saúde (L-A3-1). A parte das tarefas
(`tarefas.campanha_id`) já sai em `TarefaNaLista` e não é dado novo. A origem é.

**Veredito: precisa de registro de acesso, e `@DadoSensivel` na rota atual não basta.** O
interceptor tira o id do **caminho** e grava em **toda** resposta. Na rota vinculável, ele gravaria
`(lista)` para todo mundo, que é ruído e não diz de quem foi a origem lida, ou falharia fechado. O
registro condicional à mão é o esquecimento que o decorador existe para evitar, e a varredura de
`acesso-sensivel.test.ts` não o enxerga.

**Requisitos (bloqueiam o "feito" do A3):**

- **L-A3-8 · Rota própria.** A sugestão sai de `GET /v1/pacientes/:id/campanha-sugerida` em
  `PacientesController`, com `@Exige('pacientes')` (herdado da classe) e
  `@DadoSensivel('pacientes')`: uma linha `acessou`, `entidade='pacientes'`, id da **paciente**.
  `GET /v1/campanhas/vinculaveis` volta a ser `{ itens }`, sem `sugerida`, e
  `ConsultaDeCampanhasVinculaveis` **recusa** `paciente` com 400 (`.strict()`). Ignorar o parâmetro
  em silêncio esconderia um cliente antigo.
- **L-A3-9 · Resposta mínima.** `{ sugerida: uuid | null, motivo: 'origem' | 'tarefa' | null }`.
  `motivo` só existe se a tela disser por quê. Sem nome de campanha, que vem da lista, sem id,
  data ou descrição de tarefa, e sem a origem quando ela não está em andamento.
- **L-A3-10 · Só paciente ativa.** Inexistente, de outra clínica, desativada ou anonimizada →
  **o mesmo 404**, que não grava acesso. A Nova tarefa e o Recebimento só escolhem ativa (busca
  D-7), e a origem de quem saiu não tem finalidade aqui.
- **L-A3-11 · Uma leitura por escolha.** O `web` chama a rota **ao escolher** a paciente, nunca por
  tecla do autocomplete, nem por re-render, nem por prefetch da lista. Senão a trilha da paciente
  vira ruído de formulário.
- **L-A3-12 · Nome da campanha.** A dica de L-A3-1 deixa de ser **(R)** e passa a ser
  **obrigatória** no cadastro de campanha: *"Não use nome de medicamento ou de condição de saúde
  no nome da campanha."* A trilha registra quem leu a inferência, mas não a impede. Desde o A3, o
  vínculo paciente ↔ campanha aparece em quatro lugares (lista de tarefas, recebimento, ficha e
  sugestão), e não guardar dado de saúde no nome é o corte mais barato. O MANUAL repete a frase.

Nada muda em `retencao.md`: a rota lê, não grava dado novo.

**Testes exigidos**
1. E2E: com `pacientes`, `GET /v1/pacientes/:id/campanha-sugerida` grava **uma** linha `acessou`,
   `pacientes`, id da paciente. Sem `pacientes` → 403. Paciente desativada, ou uuid inventado → 404.
   Nenhum dos dois grava. Mutação: tirar o `@DadoSensivel` derruba o teste.
2. E2E: `GET /v1/campanhas/vinculaveis?paciente=<uuid>` → 400. Sem o parâmetro, as chaves da
   resposta são exatamente `{itens}`, e as de cada item exatamente `{id, nome}`.
3. E2E: o corpo da sugestão tem exatamente as chaves de L-A3-9.
4. Web: escolher a paciente uma vez na Nova tarefa faz **uma** chamada à rota (contar as
   requisições no teste de tela).

**Veredito A3 (campanha sugerida): APROVADO COM CONDIÇÕES** (L-A3-8, L-A3-10, L-A3-11, L-A3-12).
