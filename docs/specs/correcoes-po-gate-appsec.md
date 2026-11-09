# Gate de segurança (appsec) — correções da PO 2026-11-09

Revisão do spec `docs/specs/correcoes-po-2026-11-09.md` **antes do código**, feita pelo
`especialista-seguranca-appsec` em 2026-11-09, branch `correcoes-po-2026-11-09`.

Código consultado como âncora: `apps/api/src/comum/redacao.interceptor.ts` (ponto único de
redação, por nome de chave, em qualquer profundidade, snake_case normalizado),
`packages/domain/src/permissoes.ts` (`PERMS`, `temPerm`, `CAMPOS_MONETARIOS`),
`apps/api/src/tarefas/leitura.ts` (`SELECT_TAREFA`, `autorDe`/`leitorDe`, `exigirEscopo`),
`packages/domain/src/tarefa.ts` (`podeConcluir/Cancelar/Editar/Excluir`),
`apps/api/src/tarefas/consulta.service.ts` (escopo `meu`/`solicitei`/`equipe`, blocos de jornada
sob `podeJornada`), `apps/api/src/pacientes/{pacientes.controller,pacientes.service,busca.controller}.ts`,
`apps/api/migrations/0015_estoque.sql`, `0020_campanhas.sql`, `apps/web/next.config.mjs`,
`apps/api/src/autenticacao/senha-provisoria.guard.ts`, `apps/api/src/painel/painel.guard.ts`.

**Requisitos que valem para todos os itens.**

- **S-0.1** Toda rota nova ou alterada tem autorização explícita no servidor (`@Exige` ou a
  razão escrita para não ter) e entra nos catálogos que já varrem o `AppModule`:
  `teste/rotas-protegidas.test.ts`/`teste/registro.ts` e a classificação de
  `apps/api/src/financeiro/rotas-de-conferencia.ts` (dentro ou fora da conferência, com razão).
- **S-0.2** Todo campo monetário novo tem nome que já está em `CAMPOS_MONETARIOS`, ou entra lá
  no mesmo PR. `teste/campos-de-dinheiro-registrados.test.ts` precisa passar. Nada de dinheiro
  como valor de mapa cuja chave é dado.
- **S-0.3** Toda tabela ou coluna nova: `clinica_id NOT NULL`, `ENABLE` + `FORCE ROW LEVEL
  SECURITY`, policy `clinica_id = app_clinica_id()` em `USING` e `WITH CHECK`, trigger
  `registrar_auditoria`, e FK composta `(clinica_id, x_id)` para toda referência entre
  entidades da clínica. Os testes `escrita-sem-rls`, `auditoria-inescapavel` e
  `isolamento-de-clinica` precisam passar contra Postgres real.
- **S-0.4** Toda consulta nova filtra `clinica_id = $1` também na aplicação (segunda camada).
- **S-0.5** Nada destes fluxos vai para log: nome, telefone, nota, valor, dose, GTIN/lote lido.

---

## A1 · Nome do paciente vira link (comentário)

- **S-1** O link é conveniência; `GET /v1/pacientes/:id` já exige `pacientes` no servidor.
  Para não oferecer um link que dá 403 (perfil Enfermagem não tem `pacientes`), a tela só
  desenha o `Link` quando `temPerm(…, 'pacientes')`; sem a permissão, continua texto.
- **S-2** O `href` é montado só com `pacienteId` validado como UUID; com `pacienteId` nulo não
  há link (também em A2).

## A2 · Ficha do paciente com o cartão da jornada

Riscos: a ficha passa a carregar `historico` (com `valor` e `nota`), `valorOrcamento`,
`programaOrcado` (com `valor` **e `dose`**) e `pagamento` (`valor`, `valorAberto`). Hoje a
consulta da ficha (`pacientes.service.ts`, `ficha()`) filtra só `paciente_id = $1`, sem
`clinica_id` — depende só da RLS.

- **S-3** A ficha lê as tarefas **por `SELECT_TAREFA` / `lerTarefas`** (que já filtra
  `t.clinica_id = $1`), nunca por um SELECT próprio. Isso corrige de passagem a falta da
  segunda camada (S-0.4) na consulta atual.
- **S-4** A resposta passa pelo `RedacaoInterceptor` sem exceção: `valorOrcamento`,
  `pagamento.valor`, `pagamento.valorAberto`, `historico[].valor` e `programaOrcado[].valor`
  saem `null` sem `valores`. Nenhum valor pré-formatado ("R$ 20.000") em campo de texto.
- **S-5** Os dados e as ações da jornada na ficha seguem a mesma regra de Hoje: sem `jornada`,
  o servidor não monta `historico`/`proximoPassoEm`/`programaOrcado` (ou as ações respondem
  403). A ficha exige `pacientes`, não `jornada`, e o perfil é editável — sem isto, a ficha é
  uma porta lateral para o funil.
- **S-6** As ações do cartão na ficha (follow-up, Fechou, Perdeu, concluir, editar) chamam as
  **mesmas rotas** de tarefa/jornada, com a autorização de domínio de hoje (`podeEditar`,
  `podeCancelar`, `autorDe` → sessão de suporte recusada). Nenhuma rota nova "da ficha" que
  escreva em tarefa.
- **S-7** `?tarefa={id}`: só destaca se o id estiver **na lista já devolvida** para aquele
  paciente; nunca dispara uma busca própria. Usar `getElementById` (ou validar como UUID antes),
  nunca montar seletor CSS com o valor da URL.
- **S-8** `programaOrcado[].dose` é dado de saúde (regra 18): a ficha mantém
  `@DadoSensivel('pacientes')` (registro de acesso), e nada do cartão vai para log.

Casos de abuso (testes):
- **AB-A2-1** Pessoa com `pacientes` e sem `valores` abre a ficha de paciente com orçamento de
  R$ 20.000 e pagamento parcial: `valorOrcamento`, `pagamento.valor`, `pagamento.valorAberto`,
  `historico[*].valor`, `programaOrcado[*].valor` são todos `null`; a string `20000` não aparece
  no corpo da resposta.
- **AB-A2-2** Pessoa com `pacientes` e sem `jornada`: a ficha não traz histórico de jornada, e
  `POST` de ação da jornada numa tarefa daquela ficha devolve 403.
- **AB-A2-3** Ficha de paciente da clínica B, com sessão da clínica A: 404, sem nenhum campo.
- **AB-A2-4** Sessão de suporte (operador) clica "Fechou" pela ficha: recusado (`exigePessoa`).

## A3 · Campanha na tarefa, no recebimento e no cadastro

Riscos: rota nova de "campanhas vinculáveis" para quem **não** tem `campanhas`; escrita de
`campanhaId` por quem cria tarefa, recebe ou cadastra; desvio de atribuição de receita entre
campanhas.

- **S-9** A lista vinculável é rota própria (não `/v1/campanhas`, que tem `@Exige('campanhas')`
  na classe), autenticada, com SELECT de **colunas nomeadas: `id`, `nome`** (e no máximo o
  estado para ordenar). Nunca `meta`, `receita`, `investimento`, contagens ou datas de resultado.
  Teste de forma da resposta (chaves exatas).
- **S-10** A janela de vínculo (em andamento; encerradas há até 30 dias para tarefa e
  recebimento; só ativas hoje para o paciente) é **uma função em `packages/domain`**, usada pela
  rota da lista **e** pela validação da escrita, com "hoje" do servidor no fuso da clínica
  (regra 24). Se a lista e a validação divergirem, a validação é a regra — a tela não é.
- **S-11** Validação na escrita: campanha da clínica (FK composta já garante), não excluída e
  dentro da janela. Erro único e genérico para "não existe", "de outra clínica" e "excluída"
  (sem oráculo de existência); FK violada nunca vira 500.
- **S-12** Quem pode mudar `campanhaId` de uma tarefa é quem pode editá-la (`podeEditar`);
  no recebimento, quem tem `receber`; no paciente, quem tem `pacientes`. Mudança fica na trilha
  pelo trigger (de → para).
- **S-13** O 409 de `tarefa_viva_da_campanha` diz só "este paciente já tem uma tarefa aberta
  nesta campanha" — sem descrição, responsável ou id da outra tarefa (quem não tem
  `tarefas.equipe` não vê tarefa alheia).
- **S-14** Invariante de dinheiro (para o `validador-numeros`): trocar a campanha de uma
  tarefa com recebimento já registrado move receita entre campanhas, inclusive em períodos
  fechados. Decidir no spec se isso é permitido; se for, fica na trilha.

Casos de abuso (testes):
- **AB-A3-1** Pessoa sem `campanhas` chama a lista vinculável: recebe só `{id, nome}`; nenhuma
  chave `meta`, `receita`, `resultadoEmDinheiro`.
- **AB-A3-2** `POST /v1/tarefas` com `campanhaId` de outra clínica: 4xx genérico, nada gravado;
  mesma resposta para UUID aleatório.
- **AB-A3-3** `campanhaId` de campanha excluída ou encerrada há 31 dias: recusado no servidor,
  mesmo enviado direto pela API.
- **AB-A3-4** Paciente com campanha encerrada ontem: recusado (só ativas hoje).
- **AB-A3-5** Duas criações simultâneas da mesma (campanha, paciente): uma 201, uma 409; nunca
  500, nunca duas tarefas.
- **AB-A3-6** Marcar campanha numa tarefa com orçamento e sem recebimento: a receita da campanha
  não muda (regra 4).

## A4 · Câmera no leitor de código do estoque

Riscos: decodificador puxado de CDN (a regra é nunca); câmera que fica ligada no balcão;
foto do balcão enviada ao servidor; etiqueta `FRMEST:<clínica>:<item>` de outra clínica; `gtin`
como oráculo; validade lida do código confiada sem validação.

- **S-15** O decodificador é dependência de `apps/web` com **versão exata** (sem `^`/`~`),
  travada no `pnpm-lock.yaml`, licença conferida. **Atenção concreta:** bibliotecas baseadas em
  `zxing-wasm` (inclusive o polyfill `barcode-detector`) **baixam o `.wasm` de jsDelivr por
  padrão**. O construtor precisa servir o `.wasm` da própria origem (`locateFile`/override
  equivalente) e provar isso. Nada de `<script src>` externo, nada de `import()` de URL.
- **S-16** Teste de navegador real (Playwright) que abre o leitor e **falha se qualquer
  requisição sair da origem da aplicação**.
- **S-17** Câmera: só por ação explícita da pessoa (nunca abrir ao entrar na tela);
  `facingMode: environment`; ao fechar o leitor, trocar de tela, ler um código ou a aba ficar
  oculta, `track.stop()` em todas as faixas. Teste que confere que não sobra faixa ativa depois
  de fechar. Sem microfone (`audio: false`).
- **S-18** Hoje não há `Permissions-Policy` nem CSP em `next.config.mjs` nem no proxy. Ao mexer
  nisso: `Permissions-Policy: camera=(self), microphone=(), geolocation=()`. Se uma CSP entrar
  depois, ela precisa de `'wasm-unsafe-eval'` e `worker-src 'self'` — nunca `unsafe-eval` ou
  host de CDN. HTTPS já é obrigatório, então `getUserMedia` funciona em contexto seguro.
- **S-19** "Tirar foto do código" decodifica **no navegador**; a imagem nunca é enviada,
  guardada ou registrada. `URL.revokeObjectURL` ao terminar.
- **S-20** O texto lido é dado não confiável: vai pelo interpretador do domínio que já existe
  (`FRMEST:`, GS1, código de barras). Etiqueta `FRMEST:` com clínica diferente da sessão é
  recusada **sem consultar nada** e sem dizer de que clínica é. A busca do item é sempre na
  clínica da sessão.
- **S-21** `gtin` em `SalvarItemEstoque` usa **o mesmo schema** de `LigarCodigoItem`
  (reutilizado, não copiado). O índice `itens_de_estoque_gtin_unico` é por
  `(clinica_id, gtin)`, então conflito só revela item da própria clínica — manter assim.
  Cadastro com `gtin` exige `estoque.gerir` (já é a rota); ligar código continua com `estoque`.
- **S-22** A validade lida de um GS1 é sugestão de preenchimento: o servidor valida a data
  como valida a digitada (formato, data real). Lote e validade lidos não vão para log.

Casos de abuso (testes):
- **AB-A4-1** Abrir o leitor sem rede externa (bloqueio de tudo fora da origem): decodifica.
- **AB-A4-2** Fechar o leitor: nenhuma `MediaStreamTrack` com `readyState === 'live'`.
- **AB-A4-3** Ler `FRMEST:<clínica B>:<item B>` na clínica A: "etiqueta de outra clínica" sem
  nome nem id do item; nenhuma requisição com o id de B.
- **AB-A4-4** `SalvarItemEstoque` com `gtin` `"12345678901234567"`, `"abc"`, `" 7891234 "`
  e com caractere de controle: recusado ou normalizado exatamente como `LigarCodigoItem`.
- **AB-A4-5** Pessoa só com `estoque` tenta salvar item com `gtin` pelo cadastro: 403.

## A5 · Recebimento: instrução antes de escolher a paciente (comentário)

- **S-23** As opções desabilitadas mostradas antes da escolha são **estáticas** (rótulos):
  nenhuma chamada que traga saldo, adesão ou valor de alguma paciente antes de escolher. A
  decisão "sem entrada sem paciente" continua validada no servidor (recebimento sem
  `pacienteId` é 400).

## B1 · Corrigir o orçamento já enviado

Riscos: reescrita de histórico que hoje "não se reescreve"; trilha que vaza o valor antigo e
novo para quem não tem `valores`; oráculo do valor por mensagem de erro; corrida com
Fechou/Perdeu; o perfil Comercial (padrão) tem `jornada` e **não** tem `valores`.

- **S-24** Decisão a escrever no spec (ou ADR): **quem corrige**. Recomendação: quem pode
  registrar orçamento hoje (`jornada`) **e** `podeEditar` na tarefa (solicitante, responsável ou
  `tarefas.equipe`). Sem isso, qualquer pessoa com `jornada` reescreve o orçamento de qualquer
  cartão. Sessão de suporte recusada (`autorDe`).
- **S-25** A regra mora em `packages/domain/src/jornada.ts` e é testada lá: só com
  `status = aberta` e etapa `orcamento`; não muda `etapa`, `em` nem a ordem dos eventos;
  `valor` é `Dinheiro` positivo dentro de um teto; `nota` ≤ 160; data de retomar validada
  contra o "hoje" do servidor (regra 24).
- **S-26** O histórico é append-only: a correção **acrescenta** um evento (ex.
  `corrigirOrcamento`) em vez de reescrever o evento original; o valor vigente é derivado do
  último. Se o spec preferir reescrever o evento, isso vira ADR, porque contradiz a garantia
  documentada em `leitura.ts` ("um histórico que não se reescreve"). Em qualquer caso, o
  trigger de auditoria registra a linha de/para.
- **S-27** A trilha "de → para" guarda o dinheiro **em chave que a redação conhece**. Nomes como
  `valorAnterior`/`valorNovo` **não** estão em `CAMPOS_MONETARIOS` hoje e vazariam. Ou o evento
  usa `{ de: { valor }, para: { valor } }` (`valor` é redigido em qualquer profundidade), ou os
  nomes novos entram na lista no mesmo PR. **Nunca** o valor dentro de `nota` ou de um texto
  montado pelo servidor ("de R$ 20.000 para R$ 18.000").
- **S-28** Sem oráculo: a resposta não pode variar conforme o valor enviado bater ou não com o
  atual (ex. "nada mudou" só quando igual). Correção idêntica responde igual a qualquer outra
  e não grava evento novo.
- **S-29** Concorrência: a transação trava a linha (`SELECT … FOR UPDATE`) e confere a etapa
  **dentro** dela. Corrigir em paralelo com Fechou/Perdeu: uma das duas falha com 409, nunca
  a correção cai num cartão já fechado.
- **S-30** O funil de períodos passados lê a etapa e o instante do evento original; a correção
  não entra no funil nem na receita (regra 4). Confirmar com o `validador-numeros`.

Casos de abuso (testes):
- **AB-B1-1** Comercial sem `valores` corrige o orçamento: a resposta, o histórico em
  `GET /v1/tarefas/:id`, a ficha e `GET /v1/auditoria` não contêm nenhum dos dois valores
  (procurar os dígitos no corpo).
- **AB-B1-2** Pessoa com `jornada`, sem `tarefas.equipe`, que não é solicitante nem responsável,
  corrige o orçamento de um cartão alheio: 403.
- **AB-B1-3** Corrigir tarefa em `fechou`, `perdeu`, concluída ou cancelada: recusado.
- **AB-B1-4** Corrigir e "Fechou" em paralelo na mesma tarefa: estado final coerente, uma
  falha com 409.
- **AB-B1-5** Enviar a mesma correção duas vezes (duplo clique/retry): um evento só, mesma
  resposta.
- **AB-B1-6** Pessoa sem `valores` envia o valor certo e o errado: as duas respostas têm a
  mesma forma e o mesmo status.
- **AB-B1-7** Tarefa de outra clínica: 404.
- **AB-B1-8** Funil do mês passado é idêntico antes e depois da correção.

## B2 · "Indicado por" liga a paciente cadastrada

- **S-31** FK composta `(clinica_id, indicado_por_id) REFERENCES pacientes (clinica_id, id)`.
  Isto não é opcional: checagem de FK **ignora RLS**, então uma FK simples por `id` aceitaria
  paciente de outra clínica.
- **S-32** **Atenção concreta na migration 0062:** `ON DELETE SET NULL` puro numa FK composta
  zera **as duas** colunas, e `clinica_id` é `NOT NULL` — a exclusão quebraria. Usar
  `ON DELETE SET NULL (indicado_por_id)` (Postgres 15+; produção é 17). E lembrar que paciente
  é desativado, não excluído (ADR 0003): o caso real é indicador **inativo**.
- **S-33** `CHECK (indicado_por_id IS DISTINCT FROM id)` no banco, além da validação no domínio.
- **S-34** A escrita aceita só paciente **ativo** da clínica; erro genérico e igual para "não
  existe", "outra clínica" e "inativo".
- **S-35** O autocomplete reusa `GET /v1/busca-de-pacientes` como está (sem `@Exige`, três
  colunas `id, nome, telefone`, ativos, limite 20). Não alargar o SELECT dela para servir esta
  tela. A escrita em si continua sob `@Exige('pacientes')` (`PATCH /v1/pacientes/:id`) e no
  cadastro.
- **S-36** A ficha mostra o nome do indicador por JOIN dentro da mesma `naClinica`, com
  `clinica_id` explícito; nenhum dado do indicador além de id e nome.

Casos de abuso (testes):
- **AB-B2-1** `PATCH` com `indicadoPorId` de paciente da clínica B: 4xx, nada gravado — no
  teste contra Postgres real, com RLS ativa.
- **AB-B2-2** `indicadoPorId` igual ao próprio id: recusado (domínio e `CHECK`).
- **AB-B2-3** `indicadoPorId` de paciente inativo ou UUID aleatório: mesmo erro do AB-B2-1.
- **AB-B2-4** Excluir (via caminho de manutenção) o indicador: a indicada fica com
  `indicado_por_id = NULL` e mantém `clinica_id`.

## B3 · "Quem mais indica" no Painel

- **S-37** Mora em `GET /v1/painel` (`@Exige('painel')`, que depende de `valores` em `PERMS`):
  não criar rota nova sem `@Exige`. Ainda assim, a receita usa a chave `receita` (já na lista)
  ou outra registrada — defesa em profundidade se o bloco for reaproveitado em outra tela.
- **S-38** Receita sai só de `recebimentos` vivos (`estornado_em IS NULL`) das indicadas;
  orçamento nunca entra (regra 4). Contagem de **pacientes distintas**, só por
  `indicado_por_id`, janela `[início, fim)` no fuso da clínica (regra 23).
- **S-39** Consulta com `clinica_id` explícito e RLS; o ranking só contém pacientes da própria
  clínica, mesmo que alguma FK antiga apontasse para fora.

Casos de abuso (testes):
- **AB-B3-1** Pessoa sem `painel` (ou com `painel` sem `valores`): 403 no painel.
- **AB-B3-2** Indicações cruzadas entre duas clínicas de teste: cada painel vê só as suas.
- **AB-B3-3** Indicada com recebimento estornado e com orçamento aberto: nenhum dos dois soma.
- **AB-B3-4** Mesmo indicador, mesma indicada cadastrada duas vezes: conta 1.

## B4 · Setor de atuação e tarefa para o setor

O spec delega quem vê, quem conclui e quem conta na meta para um ADR que ainda não existe. É
exatamente aí que mora o risco: alarga a visibilidade de tarefa (com nome e telefone de paciente,
`programaOrcado` com dose) além de solicitante/responsável, e mexe em `responsavel_id NOT NULL`,
em `filtroDeEscopo` e nas quatro autorizações de `tarefa.ts`. **Não vira ticket antes do ADR**, e
o ADR precisa cumprir isto:

- **S-40** Tabelas `setores` e o vínculo pessoa↔setor: S-0.3 integral. `tarefas.setor_id` com
  FK composta `(clinica_id, setor_id)`. Pessoa↔setor com FK composta para os dois lados.
- **S-41** Criar/renomear/desativar setor e pôr pessoa em setor exigem permissão de gestão
  (`config` ou `pessoas.gerir` — decidir uma). **Ninguém se coloca num setor sozinho**: entrar
  num setor é ganhar acesso a tarefas e pacientes, isto é, escalada de permissão.
- **S-42** Pertencer a setor é lido **do banco a cada requisição**, a partir da sessão. Nenhum
  `setorId` vindo do cliente concede leitura: um filtro `?setorId=` de setor ao qual a pessoa
  não pertence cai em `exigirEscopo` (403 sem `tarefas.equipe`), como o filtro por outra pessoa.
- **S-43** Tarefa de setor: decidir no ADR se `responsavel_id` fica nulo (com
  `CHECK` de exclusividade `responsavel_id`/`setor_id`) ou se há outro desenho. **Proibido**
  pôr uma pessoa "de enfeite" em `responsavel_id`: ela passaria a ver no "meu", a ter
  `podeEditar` e a contar na meta. Se o desenho mudar o NOT NULL, `autorDe`, `filtroDeEscopo`,
  `filtroDePasso`, `ocultasPeloFiltro` e o SELECT com `JOIN pessoas pr` (vira LEFT JOIN) precisam
  ser revistos juntos.
- **S-44** Visibilidade: membro **atual** do setor vê (derivado na leitura, não copiado na
  criação); quem sai do setor deixa de ver na requisição seguinte. Setor desativado com tarefa
  aberta: a tarefa continua visível a quem tem `tarefas.equipe` e ao solicitante — nunca some.
- **S-45** Concluir já é aberto a qualquer um (`podeConcluir` não pergunta quem é); o ADR
  precisa dizer se isso continua para tarefa de setor, e registrar **quem concluiu** (pessoa da
  sessão, via `autorDe`) — é isso que conta na meta, nunca "o setor" nem todos os membros.
  Editar/cancelar/excluir por membro do setor: decisão explícita no ADR em `tarefa.ts`, com
  teste de domínio, nunca `if` no controlador.
- **S-46** A redação de valores não muda com o setor: membro do setor sem `valores` recebe a
  tarefa redigida igual a qualquer outro. Os blocos de jornada continuam sob `podeJornada`.
- **S-47** Alargar quem vê dado de paciente (nome, telefone, dose em `programaOrcado`) passa
  pelo `especialista-lgpd-saude` antes do ADR fechar.

Casos de abuso (testes):
- **AB-B4-1** Pessoa fora do setor, sem `tarefas.equipe`: não vê a tarefa do setor em Hoje,
  Tarefas nem `GET /v1/tarefas?setorId=…` (403 no filtro explícito).
- **AB-B4-2** Pessoa removida do setor: na requisição seguinte, a tarefa sumiu do Hoje dela.
- **AB-B4-3** Pessoa sem permissão de gestão tenta se pôr num setor (PATCH na própria ficha ou
  rota de setor): 403.
- **AB-B4-4** `setorId` de outra clínica na criação de tarefa: 4xx, nada gravado.
- **AB-B4-5** Dois membros concluem a mesma tarefa de setor ao mesmo tempo: uma conclusão, um
  registro de quem concluiu, um ponto na meta; a outra recebe "já foi concluída".
- **AB-B4-6** Membro do setor sem `valores` vê tarefa de setor com orçamento: `valorOrcamento`
  `null`.
- **AB-B4-7** Sessão de suporte conclui tarefa de setor: recusada.

## C1 · `deploymentId` e painel antes da sessão resolvida

`apps/web/next.config.mjs` já usa `deploymentId = FIR_COMMIT.slice(0, 12)`. O Next expõe esse
valor ao navegador (query `dpl` nos assets e cabeçalho `x-deployment-id`).

- **S-48** O valor é **só** o hash do commit: validar `^[0-9a-f]{7,40}$` antes de usar; fora
  disso, `undefined`. Nunca nome de branch, tag, hostname, data de build ou qualquer variável
  de ambiente além de `FIR_COMMIT`. Expor 12 caracteres de hash é aceitável (revela a versão,
  não segredo), desde que o repositório continue privado.
- **S-49** Nenhum segredo entra em `NEXT_PUBLIC_*` nem é lido no `next.config.mjs` para algo
  que vá ao cliente. `FIR_COMMIT` como `ARG`/`LABEL` no Dockerfile não é segredo; nenhum
  segredo entra como `ARG` (fica no histórico da imagem).
- **S-50** "Não desenhar a Visão geral enquanto a sessão não resolver" é **só tela**. A
  proteção real já está no servidor (`painel.guard.ts`, `LIBERADAS_COM_PROVISORIA`; e
  `senha-provisoria.guard.ts` na clínica) e não pode ser afrouxada por esta mudança. A tela não
  guarda dado de uma sessão anterior (cache do cliente) para desenhar enquanto espera.

Casos de abuso (testes):
- **AB-C1-1** Build com `FIR_COMMIT="main; rm -rf"` ou `"feature/x"`: `deploymentId` indefinido.
- **AB-C1-2** Operador com senha provisória chama qualquer `GET /v1/superadmin/*` fora da lista
  liberada: 409 `SENHA_PROVISORIA_OPERADOR`, sem dado.
- **AB-C1-3** Varredura do HTML/JS servido: nenhuma ocorrência de valor de variável de ambiente
  além do hash.

---

## Veredito

| Item | Veredito |
|---|---|
| A1 | APROVADO (S-1, S-2 recomendados) |
| A2 | APROVADO COM CONDIÇÕES (S-3 a S-8) |
| A3 | APROVADO COM CONDIÇÕES (S-9 a S-14) |
| A4 | APROVADO COM CONDIÇÕES (S-15 a S-22; S-15 e S-16 bloqueiam merge) |
| A5 | APROVADO (S-23) |
| B1 | APROVADO COM CONDIÇÕES (S-24 a S-30; S-24 e S-26 são decisões a escrever no spec antes dos tickets) |
| B2 | APROVADO COM CONDIÇÕES (S-31 a S-36; S-32 é defeito certo se ignorado) |
| B3 | APROVADO COM CONDIÇÕES (S-37 a S-39) |
| B4 | REPROVADO como está: não vira ticket antes do ADR cumprir S-40 a S-47 e passar pelo gate de LGPD |
| C1 | APROVADO COM CONDIÇÕES (S-48 a S-50) |

---

## B4 — revisão da ADR 0025

Revisão da ADR proposta `docs/adr/0025-setor-de-atuacao-e-tarefa-para-o-setor.md` e da seção
B4 reescrita do spec (B4-1 a B4-9, AB-B4-1 a AB-B4-25), feita pelo `especialista-seguranca-appsec`
em 2026-11-09, contra S-40 a S-47 e contra o código atual: `apps/api/src/tarefas/leitura.ts`
(`autorDe`, `leitorDe`, `exigirEscopo`, `SELECT_TAREFA`), `tarefas/consulta.service.ts`
(`filtroDeEscopo`, `filtroDePasso`, `ocultasPeloFiltro`, `uma`), `tarefas/conclusao.service.ts`
e `tarefas/edicao.service.ts` (`carregar`, `propagarNaSerie`), `tarefas/tarefas.controller.ts`,
`hoje/hoje.controller.ts`, `packages/domain/src/tarefa.ts`, `pessoas/pessoas.controller.ts`
(`@Exige('config')` na classe), `pessoas/acesso.service.ts`, `painel-geral/metricas-diarias.ts`,
`migrations/0006` (L134-135) e `0018_pessoal.sql` (L56, `pessoas_clinica_id_id_key`).

**Numeração.** S-48 a S-50 já são do C1, logo acima. Para não haver dois S-48 neste arquivo, as
condições do B4 começam em **S-51**; os casos de abuso novos começam em **AB-B4-26**.

### Conferência de S-40 a S-47

| Requisito | Situação | Observação |
|---|---|---|
| S-40 | **Atendido**, com uma ressalva (S-51) | `setores_de_atuacao` tem S-0.3 completo; `pessoas.setor_de_atuacao_id`, `tarefas.setor_de_atuacao_id` e `tarefas.concluida_por` têm FK composta. O vínculo é uma coluna em `pessoas`; o `clinica_id` é o da própria linha, então a FK composta cobre os dois lados. A ressalva é a `responsavel_id`, que continua com FK simples (abaixo). |
| S-41 | **Atendido** | A gestão é `config`. `setorDeAtuacaoId` só entra em `POST`/`PATCH /v1/pessoas` (`@Exige('config')` na classe) e o Zod é `strict` nas rotas de "minha conta". Quem tem `config` pode se pôr num setor, mas isso não abre nada novo: `config` já edita perfis e acessos (`acesso.service.ts`), e quem tem `config` já pode se dar `tarefas.equipe`. |
| S-42 | **Atendido no papel**; falta garantia de tipo (S-56, S-57) | O pertencimento é lido do banco dentro da consulta. Mas `autorDe`/`leitorDe` são síncronos e montados a partir do contexto. Se `Autor.setorDeAtuacaoId` for preenchido a partir da sessão, S-42 cai sem que nenhum teste perceba. |
| S-43 | **Atendido**, com dois furos de SQL e de escrita (S-52, S-58) | `responsavel_id NULL`, `CHECK tarefa_tem_um_destino`, proibição explícita da "pessoa de enfeite", lista das funções revistas em conjunto. Faltam na lista: a lógica de três valores no `NOT (...)` de `ocultasPeloFiltro`, `propagarNaSerie` (que precisa zerar o outro destino), e `uma`/`carregar` (que precisam do setor do autor). |
| S-44 | **Atendido** | Visibilidade derivada na leitura, com `AND ativo`. Uma tarefa num setor excluído continua visível ao solicitante e a quem tem `equipe`. |
| S-45 | **Parcial**: quem leva o ponto da meta pode ser fraudado (S-53, S-54, S-55) | `concluida_por` vem de `autorDe`, que recusa o suporte. `PESSOA_QUE_CONTA` está numa constante só. Editar, cancelar e excluir ficam no domínio. Mas, agora que concluir dá ponto na meta, deixar concluir e reabrir abertos, e deixar editar o destino sem olhar o estado, permite a uma pessoa tomar o ponto de outra. |
| S-46 | **Atendido** | Nenhum campo novo é monetário. A redação continua no `redacao.interceptor.ts`, os blocos da jornada continuam sob `podeJornada`, e há o AB-B4-6. |
| S-47 | **Pendente** (S-60) | O gate de LGPD aprovou o B4 com condições (`correcoes-po-gate-lgpd.md` L277), mas pediu que a ADR volte a ele, e isso ainda não aconteceu. A própria ADR se declara "proposta" até essa volta. |

### Furos encontrados

1. **FK simples em `tarefas.responsavel_id`, e a ADR tira a única proteção que a cobria.** A FK
   da 0006 aceita a pessoa de outra clínica: a checagem de integridade referencial do Postgres
   ignora a RLS. Hoje, a única coisa que esconde uma linha assim é o `JOIN pessoas pr` interno
   sob RLS: a tarefa some da leitura em silêncio, ou seja, o erro já fica do lado seguro sem
   ninguém ter escolhido isso. A ADR troca esse JOIN por `LEFT JOIN`. Depois disso, a mesma linha
   aparece, com `responsavelNome: null`, passa no `CHECK tarefa_tem_um_destino` como se tivesse
   destino, e entra em `PESSOA_QUE_CONTA` com um id de outra clínica. Hoje a primeira camada
   existe (`SELECT ativo FROM pessoas WHERE id = $1` sob RLS, em `tarefas.service.ts` e
   `edicao.service.ts`). Mas S-0.3 pede a segunda camada no banco para toda coluna alterada, e a
   0066 altera esta. Não aceito isso como dívida.
2. **NULL no SQL do pertencimento: um erro abre tudo, o outro esconde tudo.**
   (a) Se `DO_MEU_SETOR` for escrito com `IS NOT DISTINCT FROM`, ou com `coalesce` para um valor
   sentinela, a pessoa **sem setor** (o subselect devolve NULL) passa a casar com **toda tarefa de
   pessoa** da clínica (`setor_de_atuacao_id` NULL). O "Para mim" dela vira "Equipe toda", com
   nome, telefone e dose. É o mesmo erro do `null === null` que o B4-1 testa no domínio, só que
   no SQL, onde não há teste de mutação previsto.
   (b) Se for escrito com `=`, o `ocultasPeloFiltro` faz `NOT (responsavel_id = eu OR
   setor_de_atuacao_id = NULL)`. Para a tarefa de outra pessoa, isso dá `NOT (false OR NULL)` =
   NULL, e a linha não é contada. Para quem não tem setor, o aviso "N tarefas não aparecem" fica
   sempre em 0. Não é vazamento, mas é o defeito "dia vazio quando há seis tarefas" que a função
   existe para impedir. O AB-B4-24 só pega isso se o caso testado tiver uma pessoa sem setor.
3. **É possível tomar o ponto da meta editando o destino de uma tarefa já concluída.** Editar
   não olha o estado (`tarefa.ts`, `podeEditar`), e a ADR libera a edição para o membro do setor.
   Um membro edita uma tarefa de setor que a colega A concluiu e troca o destino para si mesmo.
   Nesse momento `PESSOA_QUE_CONTA = coalesce(responsavel_id, concluida_por)` passa a ser ele,
   porque o `CHECK tarefa_de_setor_concluida_tem_quem_concluiu` deixa de valer quando a tarefa
   deixa de ser de setor. Trocar para outro setor muda, depois de concluída, quem vê a tarefa.
4. **Também dá para tomar o ponto reabrindo e concluindo de novo.** Reabrir usa `podeEditar`, que
   agora inclui qualquer membro do setor. B reabre a tarefa que A concluiu (`concluida_por` é
   zerado) e conclui ela mesma. A auditoria registra, mas a meta credita B.
5. **Concluir sem ver a tarefa.** `podeConcluir` não pergunta quem é, e `conclusao.service.ts` não
   confere se a pessoa vê a tarefa; ainda devolve a tarefa inteira (`lerTarefas`: nome, telefone,
   `programaOrcado`). Com tarefa de pessoa, isso não dava ponto a ninguém além do responsável.
   Com tarefa de setor, **dá ponto a quem concluiu**. Exemplo: quem tem `pacientes` e vê o id na
   ficha do paciente conclui as tarefas da Enfermagem e leva os pontos. O "qualquer um conclui"
   do dono, no contexto em que foi dito ("todos do setor veem e qualquer um conclui"), se lê como
   "qualquer um que vê". O comentário do próprio `tarefa.ts` diz *"Concluir — qualquer um que
   enxerga a tarefa"*. O código não verifica isso.
6. **Propagação na série.** `propagarNaSerie` aplica `responsavel_id` a todas as abertas futuras
   da série num `UPDATE` só, autorizado pela ocorrência clicada. Numa série de destinos misturados
   (uma ocorrência já passada para a pessoa X), o membro do setor S redireciona ocorrências que
   não poderia editar uma a uma. E, se a propagação gravar só `setor_de_atuacao_id` sem zerar
   `responsavel_id`, o `CHECK` devolve 23514, que vira 500.
7. **IDOR nas rotas de setor.** `PATCH /v1/setores-de-atuacao/:id` e `POST /:id/excluir` com o id
   de outra clínica: a RLS esconde a linha, o `UPDATE` afeta 0 linhas, e, se o serviço não olhar o
   `rowCount`, responde 200 sem ter feito nada. Um id que não é uuid dá 500 (é o mesmo achado do
   `SEM_PESSOA` em `consulta.service.ts`). A ADR não diz nada sobre nenhum dos dois casos.
8. **Corridas no ciclo de vida do setor.** A exclusão trava o setor com `FOR UPDATE` e a criação
   de tarefa lê com `FOR SHARE`, mas o `PATCH /v1/pessoas/:id` que põe a pessoa no setor não trava
   nada. Resultado possível: uma pessoa ativa num setor excluído. Também não está decidido o que
   acontece ao **reativar** uma pessoa que aponta para um setor já excluído.
9. **O setor do autor não tem lugar definido no tipo.** `Autor` ganha `setorDeAtuacaoId`, mas
   `autorDe(c)` é montado a partir do contexto da requisição. O caminho mais curto para
   implementar é pôr o setor no contexto (carregado junto com a sessão), e isso é exatamente o
   cache que S-42 proíbe. O `GET /v1/tarefas/:id` (`uma`, que usa `podeEditar`) também precisa do
   setor e não aparece em B4-5 nem em B4-6.

### Veredito B4: **APROVADO COM CONDIÇÕES**

O desenho está certo: a tarefa de setor fica com responsável nulo, a visibilidade é derivada na
leitura, setor nunca vira permissão, a gestão fica com `config`, sessão não vai para setor e o
total do Painel é achado por `GROUPING()`. Isso fecha a maior parte de S-40 a S-47. As condições
abaixo resolvem os nove furos. **S-51, S-52, S-53, S-55 e S-60 bloqueiam o primeiro ticket**:
precisam estar escritas na ADR e no spec antes do B4-1. As demais bloqueiam o merge do ticket
indicado entre parênteses.

- **S-51 · FK composta em `responsavel_id` na 0066, não como dívida** (B4-2). `tarefas`
  ganha `FOREIGN KEY (clinica_id, responsavel_id) REFERENCES pessoas (clinica_id, id)`, com
  `NOT VALID` e `VALIDATE` na mesma migration; a FK simples da 0006 é removida. Faça o mesmo com
  `solicitante_id`, que tem o mesmo defeito na mesma linha. Antes do `VALIDATE`, a migration conta
  as linhas com pessoa de outra clínica e falha com mensagem legível se a contagem não for zero:
  é melhor descobrir na implantação do que no Painel. O `JOIN` vira `LEFT JOIN` **nesta mesma**
  migration e não antes dela.
- **S-52 · Semântica de NULL em `DO_MEU_SETOR`** (B4-6). Texto obrigatório:
  `(t.setor_de_atuacao_id IS NOT NULL AND t.setor_de_atuacao_id = (SELECT setor_de_atuacao_id
  FROM pessoas WHERE id = <eu> AND ativo AND excluida_em IS NULL))`. `IS NOT DISTINCT FROM`,
  `coalesce` com sentinela e `= ANY` com array que pode conter NULL estão **proibidos** neste
  fragmento. Toda negação de filtro de escopo (`ocultasPeloFiltro`, e qualquer outra que surgir)
  usa `IS NOT TRUE` ou `NOT coalesce(…, false)`, nunca `NOT (…)` sozinho. Teste de mutação:
  trocar `=` por `IS NOT DISTINCT FROM` tem de derrubar o AB-B4-26.
- **S-53 · O destino só muda enquanto a tarefa está aberta** (B4-1). Função nova no domínio,
  `podeTrocarDestino`, com teste por tabela: trocar `responsavel_id` ou `setor_de_atuacao_id`
  numa tarefa `concluida` ou `cancelada` é recusado para todos, menos para quem tem `tarefas.equipe`
  (que conserta lançamento retroativo, e a troca fica na auditoria). Editar os demais campos
  continua sem olhar o estado, como hoje. Vale também para a tarefa de pessoa: o responsável não
  pode mais passar uma concluída para outra pessoa. Isso não muda nenhum número já fechado e
  fecha o mesmo furo do lado da tarefa de pessoa.
- **S-54 · Quem reabre uma tarefa de setor concluída** (B4-1). Pode reabrir quem a concluiu
  (`concluida_por`), o solicitante e quem tem `tarefas.equipe`. O membro do setor que não a
  concluiu **não** reabre. Vai na ADR como P8, com esta recomendação. Se o dono escolher o
  contrário, a ADR precisa dizer como a meta deixa de creditar a segunda conclusão feita por
  quem reabriu.
- **S-55 · Para concluir uma tarefa de setor é preciso vê-la** (B4-1, B4-5). Para tarefa de
  setor, `podeConcluir` exige uma de três coisas: ser membro atual do setor, ser o solicitante ou
  ter `tarefas.equipe`. A decisão fica no domínio (`TarefaParaAutorizar` e `Autor` já recebem o
  setor), nunca num `if` no controlador. Quem não pode concluir recebe 403 sem o corpo da tarefa.
  A tarefa de pessoa fica como está: abrir a conclusão dela para qualquer um é decisão de produto
  anterior a esta ADR e não dá ponto a quem concluiu. Registro aqui como risco aceito, a revisar
  à parte.
- **S-56 · O setor do autor e do leitor vem só do banco, e o tipo garante isso** (B4-5, B4-6).
  `autorDe` e `leitorDe` continuam sem setor. O setor entra por uma função
  `comSetorAtual(c: pg.PoolClient, autor)`, que só existe com uma conexão aberta, chamada dentro
  de `naClinica`, na mesma transação da leitura ou do `FOR UPDATE`. `ContextoDaRequisicao`, a
  sessão e qualquer cache **não** ganham campo de setor (há um teste que lista as chaves do
  contexto). `uma` (`GET /v1/tarefas/:id`) usa essa função. Se faltar o setor, ele vale `null`,
  e nesse caso a pessoa não é membro de nada, ou seja, o erro fica do lado de negar acesso.
- **S-57 · O filtro por setor tem duas camadas, e só existe na rota de Tarefas** (B4-6).
  `?setorDeAtuacaoId=` de outro setor, sem `tarefas.equipe`, dá 403 em `exigirEscopo` (primeira
  camada). Além disso, a própria consulta faz `AND (<podeEquipe> OR DO_MEU_SETOR)` quando há
  filtro por setor (segunda camada). `ConsultaDeHoje` não aceita o parâmetro (`strict`, 400). O
  filtro "Responsável" continua indo por `exigirEscopo` como hoje e não traz tarefa de setor.
- **S-58 · Propagação na série** (B4-5). "Nesta e nas próximas" só alcança as ocorrências
  abertas futuras **com o mesmo destino** que a ocorrência editada tinha antes da edição:
  `responsavel_id IS NOT DISTINCT FROM $antigo AND setor_de_atuacao_id IS NOT DISTINCT FROM
  $antigoSetor`. Aqui o `IS NOT DISTINCT FROM` está certo, porque compara dois valores da mesma
  série e não decide visibilidade. O mesmo `UPDATE` grava os dois destinos, um deles NULL, e
  nunca um só. Vale também `S-53`: a propagação nunca toca em concluída nem em cancelada.
- **S-59 · Rotas de setor: id inválido, de outra clínica e corridas** (B4-3, B4-4).
  `ParseUUIDPipe` em todo `:id` (400). Id de outra clínica ou de setor excluído: 404, decidido
  pelo `rowCount` do `UPDATE` ou pelo `SELECT … FOR UPDATE` vazio, nunca 200; nada gravado e
  nenhuma linha na auditoria. O `PATCH`/`POST` de pessoa que põe alguém num setor lê o setor com
  `FOR SHARE`, e a exclusão do setor fica serializada com ele. Reativar uma pessoa cujo setor foi
  excluído zera `setor_de_atuacao_id` na mesma transação (a troca fica na auditoria). O 409 de
  exclusão leva **só as contagens**, nunca os nomes de pessoas ou de pacientes.
- **S-60 · Volta ao gate de LGPD antes do primeiro ticket** (S-47). A ADR passa por
  `correcoes-po-gate-lgpd.md` e registra a aprovação ali. Ela precisa declarar ao gate, por
  escrito, este alargamento concreto: o perfil padrão **Enfermagem** (`perfisPadrao`, `pf_enf`)
  não tem `pacientes` nem `jornada`, e mesmo assim passa a ver o nome e o telefone do paciente de
  **toda** tarefa mandada para o setor, por qualquer pessoa da clínica. Antes, isso só acontecia
  quando alguém escolhia aquela pessoa específica como responsável. Pela §4 da ADR é o mesmo
  dado, mas o público passa a ser decidido por outra pessoa, de uma vez só, para o setor inteiro.

Casos de abuso novos (testes, para o `engenheiro-qa-automacao`):

- **AB-B4-26** Pessoa **sem setor**, escopo *Para mim*, numa clínica com tarefas de pessoa de
  outras e tarefas de setor: recebe exatamente as tarefas com `responsavel_id = ela`, nem uma a
  mais. Com uma tarefa de outra pessoa no dia, `ocultasPeloFiltro ≥ 1`. É a prova do S-52, e cai
  se o teste de mutação trocar `=` por `IS NOT DISTINCT FROM`.
- **AB-B4-27** Membro do setor edita uma tarefa de setor concluída por A e troca o destino para
  si, para a pessoa X ou para outro setor: recusado. `concluida_por` e `PESSOA_QUE_CONTA` não
  mudam. Com `tarefas.equipe`: 200 e a troca registrada na auditoria.
- **AB-B4-28** Membro B reabre uma tarefa de setor concluída por A: 403. A, o solicitante e
  quem tem `tarefas.equipe`: 200.
- **AB-B4-29** Pessoa fora do setor, sem `tarefas.equipe` e sem ser a solicitante, chama
  `POST /v1/tarefas/<id>/concluir` com o id visto na ficha do paciente: 403, corpo sem
  `pacienteNome`, `pacienteTelefone` ou `programaOrcado`, nada gravado e a meta sem alteração.
- **AB-B4-30** `INSERT`/`UPDATE` direto em `tarefas` com `responsavel_id` ou `solicitante_id`
  de uma pessoa de outra clínica: 23503.
- **AB-B4-31** `PATCH /v1/setores-de-atuacao/<id da clínica B>` e `POST …/<id B>/excluir` com
  sessão da clínica A e com `config`: 404, setor de B intacto, nenhuma linha nova na auditoria.
  `:id` que não é uuid: 400, nunca 500.
- **AB-B4-32** Série com destino misturado (ocorrências 1 a 3 para o setor S, ocorrência 4 já
  passada para X): membro de S edita a 2 com "nesta e nas próximas" trocando o destino. A 4
  continua com X e nenhuma resposta é 500.
- **AB-B4-33** Excluir o setor S e pôr a pessoa P em S ao mesmo tempo: uma das duas operações
  falha; nunca termina com pessoa ativa em setor excluído. Reativar uma pessoa que aponta para um
  setor excluído: ela volta sem setor.
- **AB-B4-34** `GET /v1/hoje?setorDeAtuacaoId=<qualquer>`: 400.
- **AB-B4-35** Na mesma sessão, entre duas requisições, o setor da pessoa muda por SQL direto: a
  segunda requisição já reflete a mudança, sem novo login. Prova que não há setor no contexto da
  sessão (S-56).

Veredito do B4 nesta revisão: **APROVADO COM CONDIÇÕES (S-51 a S-60)**. Esta linha substitui o
"REPROVADO como está" da tabela de veredito acima. Os tickets podem nascer quando S-51, S-52,
S-53, S-55 e S-60 estiverem escritas na ADR e no spec e o dono tiver respondido de P1 a P8.
