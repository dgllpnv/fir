# Detalhe da campanha: tarefas da campanha toda, para quem tem `campanhas`

Data: 2026-11-13 · Estado: aceita · Restaura paridade com o protótipo (`vCampanha`)

## Contexto
A cliente: "quando clicávamos na aba campanha e selecionávamos uma campanha, ela abria e
apareciam todas as tarefas dali. Agora não consigo mais ver as ações desenvolvidas". Nossa
`/campanhas` listava cartões sem link; não havia rota de detalhe nem consulta de tarefas por
campanha. Omissão de paridade, não decisão. O dado existia (`tarefas.campanha_id`).

## Decisão
1. `/campanhas/[id]` (chave `campanhas`): meta, funil, ações por tipo, quem executou, histórico
   do mesmo tipo, drill-down por número e "Tarefas da campanha" (Tudo / Em aberto / Concluídas).
2. **Tarefas da campanha = TODAS as da campanha para quem tem `campanhas`**, sem o recorte de
   `escopo` de `/v1/tarefas` (decisão do dono, como o protótipo). `GET /v1/campanhas/:id/tarefas`
   lê pela `SELECT_TAREFA` única (mesmo cartão de Hoje e Tarefas).
3. Sem `valores`: o servidor apaga os campos monetários por nome de chave (novos em
   `CAMPOS_MONETARIOS`: `valorConvertido`, `faltaEmDinheiro`). Sem `pacientes`: `pacienteTelefone`
   sai `null`; o nome fica. A leitura das tarefas grava trilha de acesso (`@DadoSensivel`,
   `pacientes`, lista).
4. Fórmulas não se duplicam: detalhe e lista usam o mesmo `montar()`; receita pelo predicado
   único `RECEITA_DA_CAMPANHA` (orçamento fora, estornado fora, pagamento embutido conta uma vez).
5. Lista: `GET /v1/campanhas?mes=aaaa-mm|atual&tipo=` (o mês cruza o período; `atual` é do
   servidor), com `totais` do mês. Sem `mes`, a lista vem inteira (painel e formulários).
6. Filtro "Campanha" em Tarefas: `campanhaId` em `ConsultaDeTarefas` (uuid ou `__sem`).
7. "Nova tarefa nesta campanha": `/nova?campanhaId=&voltar=campanha`.

## Divergências do protótipo
- **Repetir no próximo mês** não grava: `GET /:id/proximo-mes` devolve o rascunho (datas do
  servidor, regra 25) e abre o formulário de nova campanha, como o protótipo. Não é um POST,
  porque o índice `campanha_por_nome` recusaria o nome repetido, e a meta em R$ pode vir redigida.
- Opções do filtro "Campanha" em Tarefas: as vinculáveis (janela do domínio), não todas.
- A lista não mostra "N pagamentos" no cartão (só o detalhe).

## Importação com índice e valor no nome (vídeo de 12/11)
A planilha da cliente traz "6. Maria Souza - R$ 15.200" na coluna do paciente, e o
nome era gravado como veio. `limparNomeDeLista` (domain) tira índice e valor; a tela mostra a
prévia e o servidor limpa antes da chave de idempotência. O valor lido é gravado
em `tarefas.valor_de_referencia` (decisão do dono, 2026-11-13; ver ADR `2026-11-13-valor-de-referencia-da-lista`):
pô-lo em `obs`/`descricao` o entregaria à equipe sem `valores`.
Pacientes já gravados com o nome sujo não são corrigidos sozinhos (regra 27).

## Emenda de 2026-11-13 — revisão LGPD (B1, I3, I4, I5)
- **A jornada não atravessa por `campanhas` (B1).** `GET /v1/campanhas/:id/tarefas` exige `campanhas`, que não
  é `jornada`, mas devolvia o cartão inteiro: `historico` (nota em texto livre), `programaOrcado` (dose),
  `itensOrcamento` (procedimentos por paciente identificado, dado de saúde, regra 18) e `proximoPassoEm`.
  `aplicarPermissaoDeJornada(t, podeJornada)` (`tarefas/leitura.ts`) é a **única** função que zera esses quatro
  e é usada em campanhas, ficha, `/v1/tarefas`, `/v1/tarefas/:id` e Hoje, no lugar do `semJornada` da ficha (que
  esquecia `itensOrcamento`). A forma da resposta não muda: vazio e `null`.
- **Telefone de paciente desativado (I3).** `SELECT_TAREFA` devolve `paciente_telefone` nulo quando o paciente
  está desativado (nome e tarefa ficam).
- **Trilha de acesso (I4).** A lista passa a `@DadoSensivel('campanhas', { param: 'id' })`: a linha de acesso
  grava o **id da campanha**, e não a sentinela `(lista)` sob `pacientes`, que não permitia responder "quem
  abriu as tarefas desta campanha".
- **`proximo-mes` sem `valores` (I5)**: investigado; **não zera** a meta. O rascunho vem com `metaEmDinheiro`
  nula (redação) e o contrato exige meta > 0 em campanha de receita, então salvar a cópia ou editar a original
  sem digitar a meta é 400, e a meta guardada não muda (teste). Resta o custo de uso: quem gerencia campanhas
  sem `valores` não consegue copiar uma campanha de receita sem informar a meta, o que é coerente (meta em R$ é
  dado de `valores`). A tela deve dizer isso em vez de mostrar só "Informe a meta em reais".

## Emenda (2026-11-13): percentual da meta sem `valores`
Decisão do dono: seguir o protótipo (`prototipo-rotinas-de-gestao.html`, ~2806, 2940, 2998, 3033-3034).
Campanha de **receita**, para quem não tem `valores`, mostra "Resultado visível para o administrativo",
**sem percentual e sem barra**. O servidor devolvia `percentualDaMeta` a todos, mas com meta e resultado
conhecidos o percentual devolve a receita em claro (a tese de que "não revela a meta" era falsa). Agora
`percentualDaMeta` é `null` no ponto único de montagem (`montarCampanha`), para métrica `receita` sem
`valores`; campanha de contagem não muda. A correção anterior permanece: sem `valores` não se define meta
em R$ nem se troca a métrica para receita (403). O protótipo não cobre o histórico da campanha nem a
carteira: ambos seguem a mesma montagem (o histórico já mostrava "—" quando a meta vinha redigida).

## Emenda (2026-11-13): paciente desativado
Tarefa **aberta** de paciente desativado não aparece na lista da campanha nem nas contagens de pendentes
(`FORA_DE_PACIENTE_DESATIVADO`). Concluída e cancelada seguem contando para o resultado. Reativar devolve.
