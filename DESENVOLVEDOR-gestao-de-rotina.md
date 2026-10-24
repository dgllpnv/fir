# Firmare Rotinas de Gestão — documento de passagem para desenvolvimento

> **Base em produção:** v20 (outubro/2026), Google Apps Script + Google Sheets, 4 clínicas em uso real.
> **Protótipo funcional:** `prototipo-rotinas-de-gestao.html` (outubro/2026). Contém tudo o que foi desenhado depois da v20, rodando em modo demonstração. **Nada do que está no protótipo e não está na v20 existe no `Code.gs`.**
> **Objetivo:** dar ao desenvolvimento o contexto completo (propósito, regras de negócio, modelo de dados, permissões) para construir a versão robusta da ferramenta, partindo do protótipo como especificação funcional.

---

## Sumário
1. Propósito do produto
2. Situação atual e arquivos entregues
3. Como usar o protótipo
4. Organização da ferramenta (as quatro frentes)
5. Perfis de acesso
6. Modelo de dados
7. API (ações) — referência
8. Regras de negócio por módulo
9. Front-end: padrões de interface
10. Limitações e riscos da base atual
11. Roadmap
12. Decisões a alinhar antes de começar
13. Critérios de aceite da paridade
14. Glossário

---

## 1. Propósito do produto

A ferramenta **não é um sistema de gestão de clínica (agenda, prontuário, faturamento)** e não substitui o sistema principal da clínica (Amigo, Support Health, iClinic etc.). Ela funciona **ao lado** dele, aberta o dia todo pela equipe.

O objetivo é **colocar os rituais de gestão na rotina da equipe**, principalmente da recepção, sem depender de alguém cobrar:

| Ritual | Como a ferramenta garante |
|---|---|
| Confirmar consultas da véspera | Cartão do agendamento com mensagem pronta no WhatsApp e registro do envio |
| Recontatar quem faltou ou desmarcou | O cartão vai para "Recontatar" na tela Hoje até alguém reagendar ou encerrar |
| Retomar orçamentos | Data de retomada no orçamento; o cartão volta na tela Hoje no dia |
| Acompanhar programas (sessões) | Sessões do dia na tela Hoje da enfermagem; atrasadas destacadas |
| Contar o estoque | Contagem às cegas como tarefa recorrente, com análise esperado × contado |
| Fechar o caixa | Conferência às cegas no fim do dia, com lembrete na tela Hoje |
| Pagar contas no prazo | Lembrete 3 dias antes para quem paga |
| Cobrar saldos em aberto | Lista de cobrança com mensagem pronta e registro do contato |
| Conversas 1:1, férias, documentos | Alertas e rotina mensal em Pessoas |
| Fechamento do mês | Tarefa recorrente no dia 1º + Visão do mês por categoria |

**Público:** clínicas de um médico ou pequenas (faturamento até R$ 1–1,5 milhão/ano), operadas pela recepção. Os módulos de **Pessoas** e **Tarefas** devem servir também a clínicas maiores e com várias unidades.

**Princípio de interface:** a usuária principal é a recepcionista. Cada tela deve exigir o mínimo de campos; o que é raro fica recolhido ("+ Mais opções", "Ajustar"); explicações aparecem em ícone de dica, não em texto corrido.

---

## 2. Situação atual e arquivos entregues

```
 Navegador (celular/computador)
   index.html  (app de página única: HTML + CSS + JS em um arquivo)
   config.js   (URL do backend)
        │  POST JSON  { action, clinica, uid, pin, ...dados }
        ▼
 Google Apps Script (Code.gs) — App da Web
        ├── Planilha central "Clínicas" → código → planilha
        └── Uma planilha Google Sheets por clínica (uma aba por entidade)
```

| Arquivo | O que é |
|---|---|
| `versoes/v20-producao/` (e `.zip`) | **Produção atual:** `Code.gs`, `index.html`, `config.js`. É a fonte dos dados reais a migrar |
| `prototipo-rotinas-de-gestao.html` | **Protótipo completo** (front + `demoApi` que simula o servidor). Especificação funcional de tudo o que vem depois da v20 |
| `DESENVOLVEDOR-gestao-de-rotina.md` | Este documento |
| `roteiro-implantacao-notas.md` | Passo a passo de implantação em uma clínica (30 dias), por módulo |
| `GUIA-INSTALACAO.md` | Guia operacional da v20 (instalação, atualização, clínica nova) |
| `versoes/DESENVOLVEDOR-v19.md` | Versão anterior deste documento (detalhes da v19/v20 que continuam válidos) |

**Importante sobre o protótipo:**
- As regras de negócio do servidor estão implementadas na função `demoApiBase` (dentro do HTML). Ela é a **referência de comportamento** para o backend novo: cada `case "acao"` corresponde a uma ação da API.
- O cálculo de indicadores está no front (funções `saldoItem`, `consumoItem`, `saldoInfo`, `statsAdesao`, `vPainel`, `vEsteira`, `vFinMes`). No produto, esses cálculos devem ir para o backend.
- A Ajuda (`AJUDA`) e o Manual (`MANUAL`, 14 capítulos) embutidos descrevem o comportamento esperado de cada tela em linguagem de usuário. **Usar como documentação funcional.**

---

## 3. Como usar o protótipo

Abrir o HTML no navegador. Ele roda em modo demonstração, com dados de exemplo salvos só no aparelho.

| Usuário | Perfil | PIN |
|---|---|---|
| Dra. Helena Prado | Administrador | 1234 |
| Juliana Santos | Recepção | 1234 |
| Camila Rocha | Enfermagem | 1234 |
| Patrícia Lima | Comercial | 1234 |
| Administrativo | Administrador | 0000 |

Para recomeçar do zero: limpar o `localStorage` do navegador (chave `firmare-rotina-demo-v13`).

Bibliotecas carregadas sob demanda (CDN): SheetJS 0.18.5 (importação de planilhas), `qrcode-generator` 1.4.4 (etiquetas) e `html5-qrcode` 2.3.8 (leitura de QR, DataMatrix e código de barras). Fontes: Lora (títulos) e Inter (texto e números).

---

## 4. Organização da ferramenta (as quatro frentes)

Menu lateral no computador (cada frente abre ao passar o mouse); barra inferior no celular (Hoje, Tarefas, Nova, Programas, Menu).

| Área | Telas |
|---|---|
| **Dia a dia** | Hoje · Tarefas · + Nova tarefa · + Recebimento |
| **Comercial** | Jornada do paciente · Pacientes (lista, ficha) · Programas de acompanhamento · Campanhas |
| **Financeiro** | Recebimentos · Caixa do dia · Contas a pagar · Cobranças · Visão do mês |
| **Processos** | Estoque (Itens, Contagens, Análise; código QR) |
| **Pessoas** | Equipe (fichas, metas, conversas 1:1, banco de horas) · Minhas metas |
| **Gestão** | Painel geral · Configurações (Unidades, Usuários e acessos, Procedimentos) |
| **Ajuda** | Ajuda (perguntas com busca) · Manual (capítulos com busca) |

### Tela Hoje (a mais usada)
Ordem dos blocos:
1. Semana (dias com tarefas e atrasos) e aniversariantes do dia.
2. Filtros de pessoa: Para mim · Que solicitei · Equipe toda (só com permissão). Aviso quando o filtro esconde tarefas do dia. O administrador abre em "Equipe toda".
3. **Pendentes de dias anteriores** — recolhido, em vermelho, com o número.
4. **Hoje** — tarefas do dia.
5. **Sessões de programas** — sessões do dia e atrasadas do responsável (ou da equipe).
6. **Financeiro** — "Fechar o caixa de hoje" (para a responsável) e contas a pagar dos próximos 3 dias.
7. **Recontatar** — no-show e desmarcados ainda sem solução.
8. **Próximos passos da jornada** — agendamentos de amanhã para confirmar e orçamentos para retomar.

---

## 5. Perfis de acesso

Substitui o antigo "admin sim/não". Cada pessoa tem `admin = true` (acesso total) **ou** um `perfilId`. Perfis são editáveis pela clínica numa matriz **permissão × perfil**, separada por pilar.

### 5.1 Permissões

| Pilar | Chave | Libera | Depende de |
|---|---|---|---|
| Dia a dia | `tarefas.equipe` | Filtro "Equipe toda"; concluir/cancelar tarefas de outras pessoas | |
| Comercial | `jornada` | Tela Jornada do paciente | |
| Comercial | `pacientes` | Lista de pacientes e relacionamento | |
| Comercial | `pacientes.gerir` | Importar e excluir pacientes | |
| Comercial | `programas` | Programas de acompanhamento | |
| Comercial | `programas.gerir` | Encerrar e excluir programas | |
| Comercial | `campanhas` | Ver campanhas e executar ações | |
| Comercial | `campanhas.gerir` | Criar, importar e excluir campanhas | |
| Financeiro | `valores` | **Ver valores em R$** em todas as telas (receita, LTV, saldos, orçamentos, custos) | |
| Financeiro | `receber` | Recebimentos e atalho + Recebimento | |
| Financeiro | `caixa` | Fechar o caixa do dia | |
| Financeiro | `contas` | Contas a pagar sob sua responsabilidade | |
| Financeiro | `contas.gerir` | Cadastrar e ver todas as contas | |
| Financeiro | `cobrancas` | Cobranças | |
| Financeiro | `finmes` | Visão do mês e meta | `valores` |
| Processos | `estoque` | Itens, entradas, saídas, contagens, leitura de QR | |
| Processos | `estoque.gerir` | Cadastro de itens, ajustes, custos, análise, etiquetas, importação, locais | |
| Pessoas | `pessoas.gerir` | Fichas, metas, 1:1, banco de horas (inclui salário) | |
| Gestão | `painel` | Painel geral | `valores` |
| Gestão | `config` | Unidades, usuários e acessos, procedimentos | |

**Sempre liberado a todos:** Hoje, próprias tarefas, Nova tarefa, ficha do paciente (histórico), Minhas metas, Ajuda e Manual.

### 5.2 Perfis padrão (criados com a clínica)

| Perfil | Permissões |
|---|---|
| Supervisão / gestão | tarefas.equipe, jornada, pacientes(+gerir), programas(+gerir), campanhas(+gerir), valores, receber, caixa, contas, cobrancas, estoque(+gerir), painel |
| Recepção | jornada, pacientes, programas, campanhas, receber, caixa, contas, cobrancas, estoque |
| Comercial | jornada, pacientes, programas, campanhas, cobrancas |
| Enfermagem | programas, estoque |
| Financeiro | valores, receber, caixa, contas, contas.gerir, cobrancas, finmes |

### 5.3 Regras
- **A mesma função `temPerm(user, perfis, chave)` vale para tela e servidor.** O servidor **sempre** valida (o protótipo devolve "Seu perfil não tem acesso a esta ação.").
- Sem `valores`, o servidor **apaga** campos monetários da resposta (`valor`, `valorAberto`, valores de planos, custos de estoque, metas financeiras). A equipe recebe só `comSaldo` (ids de pacientes com saldo) e, na meta do mês, apenas o percentual (`metaPct`).
- Tela sem permissão mostra "Sem acesso a esta tela" e some do menu.
- Mudança de perfil vale no próximo acesso da pessoa.
- Não permitir excluir perfil em uso por pessoa ativa.

---

## 6. Modelo de dados

Datas `yyyy-MM-dd`; data-hora `yyyy-MM-ddTHH:mm`; fuso `America/Bahia`. No produto: banco relacional multi-tenant (`clinic_id` em todas as tabelas). Abaixo, entidades e campos como estão no protótipo; **[v20]** = já existe em produção, **[novo]** = só no protótipo.

### 6.1 Equipe [v20 + novo]
`id, nome, funcao, pin, admin, ativo, perfilId [novo]`

### 6.2 Perfis [novo]
`id, nome, perms[]` (chaves da seção 5.1)

### 6.3 Pacientes [v20 + novo]
`id, nome, telefone, aniversario, criadoEm, origem, indicadoPor, unidadeId, ultimaConsulta [v20], campanhaId [novo], campanhaEm [novo]`
- `campanhaId`: campanha pela qual o paciente chegou (pergunta "Chegou por uma campanha?" no cadastro).
- Paciente novo **exige** unidade principal quando a clínica tem unidades.

### 6.4 Tarefas [v20 + novo]
Campos v20: `id, criadaEm, solicitanteId, responsavelId, descricao, prazo, hora, prioridade, status, concluidaEm, pacienteId, tipo, valor, obs, serieId, recorrencia, campanhaId, valorAberto, adesaoId, sessao, formaPagamento, unidadeId`

Novos:
| Campo | Uso |
|---|---|
| `etapa` | Jornada: `agendado`, `confirmado`, `faltou`, `desmarcou`, `realizado`, `orcamento`, `fechado`, `perdido` |
| `historico[]` | Eventos da jornada `{e, em, por, nota, valor?, rot?}` (ex.: `rot:"Reagendada"`, `"Confirmação enviada"`, `"Follow-up"`, `"Encerrado sem reagendar"`) |
| `acaoEm` | Data de retomada (orçamento) ou de recontato (no-show/desmarcou) |
| `valorOrcamento` | Valor orçado (etapa orçamento) |
| `programaOrc[]` | Programa montado no orçamento (itens, mesmo formato de `adesao.itens`) |
| `confEnviadaEm` | Data-hora do envio da confirmação pelo WhatsApp |
| `procId` | Procedimento do catálogo (procedimento avulso realizado → baixa de estoque) |
| `itemKey` | Item do programa a que a sessão pertence (`i1`, `i2`…) |
| `estoqueRef` | Vínculo com rotinas: `contagem:<id>`, `analise`, `finmes` |

### 6.5 Procedimentos (catálogo; aba `Planos`) [v20 + novo]
`id, nome, sessoes (sugeridas), intervaloDias (sugerido), rotuloSessao, responsavelId, valor (referência POR SESSÃO), ativo, retorno, retornoUnid, antecedencia, retornoRespId`
Novos: `insumoPadraoId, insumoPadraoQtd (em unidade de estoque), insumos[] {itemId, qtd}` (descartáveis/itens fixos por sessão).

### 6.6 Adesões (programas) [v20 + novo]
Campos v20 + `itens[]` [novo]:
`{key, procId, nome, rotuloSessao, sessoes, intervaloDias, inicio, depoisDe (key de outro item), insumoId, insumoQtd (unidade de estoque), dose (texto exibido), responsavelId, valor (por sessão)}`
- Programa **montado por paciente**: vários procedimentos, cada um com sessões, intervalo, dose e início (na data de início, depois de outro item, ou em data própria). Ex.: Tirzepatida 4× 2,5 mg → depois 4× 5 mg.
- Adesões antigas (sem `itens`) são tratadas como programa de um item `i1`.
- `plano` = nomes dos itens unidos; `sessoes` = total; `rotuloSessao` = o comum aos itens ou "Sessão".

### 6.7 Estoque [novo]
**Itens:** `id, nome, codigo, gtin, categoria, medida (unidade de estoque), unidCompra, fatorCompra, unidUso, fatorUso, aproveitaSobra, custo, minimo, responsavelId, unidadeId, localId, altaRot, controlaValidade, altoValor (""|"sim"|"nao"), ativo, vinculos[] {cProd, cnpj, fator, xProd}`
- Conversões: `1 unidCompra = fatorCompra × medida`; `1 medida = fatorUso × unidUso`. Ex.: 1 caixa = 4 ampolas; 1 ampola = 5 mg; 1 frasco = 100 UI.
- `vinculos`: ligação de produtos de NF-e (XML) a itens.

**Locais:** `id, nome, unidadeId, ativo` (cada item fica em um único local).

**Movimentos:** `id, itemId, tipo, data, em, qtd (unidade de estoque), validade (lote), validades[] (contagem: {v, q}), custo, motivo, obs, por, contagemId, tarefaId, pacienteId, procId, aplicadoPor, qtdUso, unidUso, sinal, notaChave`
| `tipo` | Sinal | Observação |
|---|---|---|
| `contagem` | = | Ponto de partida (saldo absoluto) |
| `entrada` | + | Compra (manual, nota manual ou XML) |
| `consumo` | − | **Uso em paciente** (sessão, procedimento avulso ou lançamento manual). Exige `pacienteId` quando manual |
| `descarte` | − | Motivo: vencido, avaria, **sobra de frasco aberto**, outro |
| `interno` | − | Uso interno ou cortesia (motivo obrigatório) |
| `ajuste` | `sinal` ±1 | Só gestão; motivo obrigatório |

**Contagens:** `id, nome, filtro, localId, unidadeId, responsavelId, prazo, repetir (""|quinzenal|mensal), status, criadaEm, itens[], valores{}, concluidaEm`

### 6.8 Pessoas [novo]
- **Fichas:** `id, nome, cargo, contrato (CLT|PJ|Estágio|Autônomo|Sócia), admissao, aniversario, salario, userId, gestorId, ativo, ferias[] {id, inicio, fim, status}, docs[] {id, nome, validade}`
- **Metas:** `id, pessoaId, mes, indicador, nome, meta, realizado` — indicadores automáticos: agendamentos, confirmações, contatos, orçamentos fechados (qtd e valor), recebimentos, tarefas no prazo (%), contagens no prazo (%); ou `manual`.
- **Conversas 1:1:** `id, pessoaId, data, mes, porId, fortes, desenvolver, combinados` (combinados viram tarefas).
- **Banco de horas:** `id, pessoaId, mes, saldo, obs` (saldo vem do app de ponto oficial; a ferramenta **não registra ponto**). `config.limiteHoras` (alerta).

### 6.9 Financeiro [novo]
- **Contas:** `id, descricao, categoria, valor, vencimento, pagoEm, valorPago, formaPag, pagoPor, recorrente, fornecedor, responsavelId, criadoEm`
- **Caixas:** `id, data, esperado{forma: valor}, contado{forma: valor}, diferenca, obs, por, em`
- **Metas:** `{ "yyyy-MM": valor }`
- **Cobranças:** `id, pacienteId, canal, em, por`
- **Config:** `caixaResp` (quem fecha o caixa), `msgCobranca` (opcional)

Categorias de despesa: **fixas** — Pessoal, Ocupação, Sistemas e assinaturas, Serviços contratados; **variáveis** — Insumos e medicamentos, Marketing, Impostos e taxas, Taxas de cartão e bancárias, Manutenção e equipamentos, Outras despesas.

---

## 7. API (ações) — referência

Todas as ações abaixo estão implementadas na `demoApiBase` do protótipo. As marcadas **[v20]** existem no `Code.gs`. A coluna Permissão indica a checagem no servidor.

| Ação | Permissão | O que faz |
|---|---|---|
| `equipePublica`, `login`, `carregar` [v20] | — | Login por nome + PIN; carga inicial (no produto: substituir por consultas paginadas) |
| `criarTarefa`, `atualizarTarefa`, `editarTarefa`, `excluirTarefa` [v20] | própria / `tarefas.equipe` | Tarefas; `atualizarTarefa` aplica agendado → realizado, pagamento embutido, reprogramação de sessões, retorno, **baixa de estoque** |
| `moverEtapa` | todos | Jornada: `confirmar`, `enviar` (confirmação WhatsApp), `noshow`, `reagendar`, `desmarcar`, `encerrar`, `orcamento` (com `programa[]`), `retomar`, `perder`, `fechar` |
| `salvarPaciente`, `excluirPaciente`, `importarPacientes` [v20] | todos / `pacientes.gerir` | Pacientes (importação com deduplicação por nome ou telefone, até 2.000 linhas) |
| `salvarCampanha`, `excluirCampanha`, `importarCampanha` [v20] | `campanhas.gerir` | Campanhas |
| `salvarPlano`, `excluirPlano` [v20 + novo] | `config` | Catálogo de procedimentos (com insumos) |
| `criarAdesao` [v20 + novo], `encerrarAdesao`, `excluirAdesao` [v20] | todos / `programas.gerir` | Programas montados por itens; exclusão desfaz baixas |
| `salvarUnidade`, `salvarPessoa`, `excluirPessoa`, `alterarPin` [v20] | `config` / próprio | Cadastros |
| `salvarPerfis` | `config` | Perfis de acesso |
| `salvarItemEstoque`, `importarItensEstoque`, `salvarLocalEstoque` | `estoque.gerir` | Cadastro do estoque |
| `movEstoque` | `estoque` (ajuste: `estoque.gerir`) | Entrada, consumo (paciente), descarte, interno, ajuste; gera descarte da sobra quando `aproveitaSobra=false` |
| `entradaNota` | `estoque` | Entrada de várias linhas (manual ou XML NF-e, com conversão e vínculo por fornecedor; a mesma chave de nota não entra duas vezes) |
| `criarContagem`, `salvarContagem` | `estoque` | Contagem às cegas como tarefa; recorrência; tarefas de reposição |
| `ligarCodigoItem` | `estoque` | Liga GTIN (código de barras / DataMatrix) a um item |
| `pessoasOp` (ficha, doc, ferias, meta, copiarMetas, conversa, horas, config…) | `pessoas.gerir` | Gestão de pessoas |
| `salvarConta`, `excluirConta` | `contas.gerir` | Contas a pagar |
| `pagarConta` | `contas` (própria) | Registra pagamento; conta recorrente gera a do mês seguinte |
| `fecharCaixa` | `caixa` | Calcula o esperado no servidor (às cegas) e grava a diferença |
| `registrarCobranca` | `cobrancas` | Registra contato de cobrança |
| `salvarMetaFin`, `finConfig` | `finmes` / `config` | Meta do mês; responsável pelo caixa |

---

## 8. Regras de negócio por módulo

As regras da v20 continuam valendo (ver `versoes/DESENVOLVEDOR-v19.md`, seção 5: tipos de contato, receita/LTV/saldo, retorno de procedimento, campanhas, unidades, prazos, migrações v16/v17). Abaixo, o que mudou ou é novo.

### 8.1 Jornada do paciente
- Consulta/Procedimento **agendado** é **uma única tarefa** que anda pelas etapas; cada movimento entra em `historico`.
- **Enviar confirmação:** abre `wa.me/<telefone>?text=<mensagem>` e registra `confEnviadaEm` + evento "Confirmação enviada". Mensagem padrão: "Olá, {nome}! Aqui é {eu}, da {clinica}. Passando para confirmar sua {consulta|procedimento} {hoje|amanhã|no dia dd/mm} às {hh:mm}. Podemos confirmar?" → **deve ser configurável por clínica**.
- **Confirmou** → `confirmado`.
- **No-show** → `faltou`, `acaoEm = hoje`; **Desmarcou** → `desmarcou`, `acaoEm = hoje`. Nos dois casos a tarefa **continua aberta** e aparece em "Recontatar" até **Reagendar** (volta a `agendado` com nova data) ou **Encerrar** (cancela, evento "Encerrado sem reagendar").
- **Concluir** (círculo) → `realizado`; tipo vira "… realizada" e a descrição padrão acompanha. Pergunta "Recebeu algum valor?" (pagamento embutido).
- **Registrar orçamento:** valor, data de retomada (padrão +2 dias), observação e, opcionalmente, **programa montado** (`programaOrc`); o valor sugerido = soma de sessões × valor por sessão.
- **Registrar follow-up:** nova data de retomada.
- **Fechou:** abre o Recebimento pré-preenchido. **Valor em aberto = orçamento − entrada** (calculado sozinho, editável). Se houver `programaOrc`, o programa vem montado. Evento `fechado` com `valor = entrada + em aberto`.
- **Perdeu:** motivo obrigatório (Preço, Sem retorno do paciente, Escolheu outro lugar, Não é o momento, Outro).
- **Funil (período):** contagem de eventos por etapa; para quem tem `valores`, **valor por etapa**: realizados (recebido no atendimento ou recebimentos do paciente no mesmo dia), orçados, fechados, perdidos. Taxa de no-show = faltas ÷ (realizados + faltas).

### 8.2 Recebimentos
"Atendimento é tarefa; dinheiro é recebimento." Tipos ("O que o paciente está pagando"): Consulta · Sinal de consulta · Procedimento ou programa novo (venda) · Programa em andamento · Saldo em aberto. Aviso dos recebimentos do paciente nos últimos 7 dias (evita duplicidade). Campanha sugerida pelo paciente.

### 8.3 Programas e baixa automática
- Concluir sessão → baixa do **insumo do item** (`insumoQtd`) + **insumos fixos do procedimento**; reabrir sessão ou excluir programa **desfaz** as baixas (movimentos com `tarefaId`).
- Procedimento avulso realizado com `procId` → baixa dos insumos padrão do procedimento.
- Lote da baixa: **o que vence primeiro** (FIFO por validade), editável no lançamento manual.
- Se o item não aproveita sobra (`aproveitaSobra=false`) e a dose usa fração da unidade: consumo = dose; **descarte automático** da sobra ("Sobra de frasco aberto").
- Reprogramar uma sessão desloca o item e os itens que começam **depois** dele (se ainda não começaram). Retorno de procedimento é **por item**.

### 8.4 Estoque
- **Saldo** = última contagem + entradas − saídas (consumo, descarte, interno) ± ajustes.
- **Análise do período:** contagem inicial (última até o início) · entradas · saídas registradas (pacientes, descartes, interno, ajustes) · **saldo esperado** = inicial + entradas − saídas · contagem final · **diferença** = final − esperado (negativo = falta sem registro; positivo = sobra).
- Curva ABC automática para "alto valor" (80% do valor em estoque), com ajuste manual.
- Contagem **às cegas** (a quantidade esperada não aparece).
- **Código QR:** etiqueta por item (`FRMEST:<clinica>:<itemId>`), impressão em folha; leitura pela câmera (ao vivo) ou foto; também lê **DataMatrix GS1** de medicamentos (AI 01 GTIN, 17 validade AAMMDD, 10 lote, 21 série) e código de barras EAN. Código desconhecido → ligar ao item uma vez (`gtin`). Na entrada lida da caixa, validade e lote vêm preenchidos.

### 8.5 Financeiro
- **Caixa do dia:** esperado por forma = soma dos recebimentos do dia (calculado no **servidor**); contado informado às cegas; diferença total e por forma. Nota promissória não entra no caixa. Um fechamento por dia.
- **Contas:** lembrete na Hoje do responsável 3 dias antes; recorrente mensal gera a do mês seguinte no pagamento (mesmo dia, mesmo valor).
- **Cobranças:** pacientes com saldo, ordenados por tempo sem contato; mensagem sem valores.
- **Visão do mês:** recebido, despesas pagas, resultado (recebido − pagas), a pagar no mês, saldo a receber dos pacientes, meta (% e quanto falta), despesas por categoria (peso, fixas × variáveis, mês anterior), recebido por forma, caixas fechados × dias úteis.
- **Rotina de fechamento:** tarefa mensal no dia 1º.

### 8.6 Pessoas
Alertas: documentos vencendo/vencidos, férias a programar (período concessivo), fim de experiência, banco de horas acima do limite. Metas mensais automáticas ou manuais; "Minhas metas" para a própria pessoa. Conversa 1:1 mensal; combinados viram tarefas.

### 8.7 Campanhas
Campanha ligada ao **paciente** (`paciente.campanhaId` ou ação do paciente em campanha ativa) e **sugerida** em agendamentos e recebimentos dele.

### 8.8 Tela Nova tarefa
Agendamento enxuto (paciente, tipo, data, horário, responsável, campanha); descrição, unidade, urgente e repetir em "+ Mais opções". Seleção de paciente: nome exatamente igual a um cadastrado é escolhido sozinho; caso contrário, aviso em destaque para escolher da lista ou cadastrar.

---

## 9. Front-end: padrões de interface

- Identidade: off-white `#F8F6F1`, dourado (`--gold`, `--gold-ink #8A6A2C`), marrom `#2E1F0E`; títulos Lora, texto e números Inter. Tokens CSS em `:root`.
- Uma mensagem (toast) por vez; toda ação confirma o que aconteceu.
- Explicações longas viram ícone **i** com dica (hover/toque); textos com números ficam visíveis.
- Telas pensadas para celular (sem rolagem horizontal), testadas em 390 px.
- Erro em uma tela mostra mensagem com detalhe e botões "Ir para Hoje" / "Recarregar" (no produto: enviar para monitoramento de erros).
- Valores em R$ somente com permissão `valores`.

---

## 10. Limitações e riscos da base atual

| # | Ponto | Risco | Direção |
|---|---|---|---|
| 1 | Login por nome + PIN de 4 dígitos, PIN em texto puro, enviado em toda requisição | Força bruta; vazamento | Login por e-mail/senha ou link, hash, token com expiração, limite de tentativas; PIN só como troca rápida de usuário em aparelho autenticado |
| 2 | Google Sheets como banco | Cotas, latência, lock global, sem transações | PostgreSQL multi-tenant com row-level security |
| 3 | `carregar` traz tudo | Lentidão com o crescimento | API paginada; indicadores no banco |
| 4 | Regras duplicadas (front, demoApi, Code.gs) | Divergência | Regras só no backend; testes automatizados |
| 5 | Front em um arquivo (~700 KB) | Manutenção | Framework de componentes; testes e2e dos fluxos críticos |
| 6 | Sem auditoria | Disputa em pagamentos, estoque e ajustes | Log imutável; exclusão lógica |
| 7 | **Dado de saúde** (dose, produto e lote por paciente) | LGPD (dado sensível) | Base legal, termo de tratamento (DPA), criptografia, controle de acesso por perfil, registro de acesso |
| 8 | Backup = histórico do Google Sheets | Recuperação manual | Backup diário com teste de restauração |
| 9 | Onboarding manual | Não escala | Cadastro de clínica com perfis, procedimentos e categorias padrão |
| 10 | Câmera: no ambiente de prévia (iframe) a câmera ao vivo pode ser bloqueada | — | No produto, servir em HTTPS próprio; manter a opção "foto do código" |

---

## 11. Roadmap

**Fase 0 — Base**
- Repositório com a v20 e o protótipo; ambientes de desenvolvimento, homologação e produção.
- Testes automatizados das regras (seções 5 e 8) sobre os dados de exemplo do protótipo.

**Fase 1 — Paridade com o protótipo + migração** (prioridade para a implantação de novembro)
- Backend + banco multi-tenant, autenticação e perfis de acesso.
- Todas as telas e regras do protótipo.
- **Migração das 4 clínicas da v20** com conferência automática por clínica (quantidade de registros; receita total; LTV por paciente; saldo por paciente e por adesão; receita por campanha). Totais devem bater exatamente.
- Conversões na migração: adesões sem `itens` → um item `i1`; equipe `admin=false` → perfil "Recepção" (revisar com cada clínica); tarefas de agenda sem `etapa` → etapa derivada (`etapaDe`).

**Fase 2 — Integrações e automações** (novembro em diante)
- **Agenda do sistema principal → tarefas:** ler o Google Agenda (ou link iCal) sincronizado pelo sistema da clínica a cada 15 min; criar/atualizar o cartão da jornada (novo → agendado; horário mudou → reagendado; compromisso removido → recontatar). Ligação com paciente por telefone, depois por nome. **Validar antes:** se Amigo/Support Health sincronizam e o que vai no compromisso.
- Mensagens configuráveis por clínica (confirmação, cobrança).
- WhatsApp pela API oficial (opcional, por clínica).
- Leitura da foto da nota fiscal por IA (preencher itens da entrada).
- Assistente de IA sobre o Manual.

**Fase 3 — Produto**
- Previsão de compra a partir das sessões programadas (ex.: "14 ampolas necessárias até 20/11; há 9").
- Rastreabilidade por lote (quais pacientes receberam um lote).
- Transferência entre unidades no estoque.
- Painel por frente (Comercial, Financeiro, Processos, Pessoas) e visão consolidada para a consultoria (várias clínicas).
- Campanhas de indicação/recompensa e campanhas internas (equipe).
- Onboarding self-service, assinatura recorrente, painel interno de clínicas, personalização (logo).

---

## 12. Decisões a alinhar antes de começar
1. Stack e hospedagem (custo previsível; hospedagem no Brasil ou com DPA para dados de saúde).
2. Login (e-mail por pessoa × aparelho da clínica com PIN rápido).
3. Modelo comercial (por clínica, por usuário ou por unidade) — impacta o modelo de assinatura.
4. Janela de migração das 4 clínicas (uma por vez, fora do horário, v20 em paralelo somente leitura por alguns dias).
5. Perfil "Consultoria" com visão de várias clínicas.
6. Prioridade da integração com agenda (depende da validação com o sistema de cada clínica).

---

## 13. Critérios de aceite da paridade (amostra)
- Fluxo completo da recepção: agendar paciente novo → enviar confirmação → confirmou → concluir com pagamento → orçamento com programa → fechou com entrada → programa criado com saldo = orçamento − entrada.
- Enfermagem: sessão do dia aparece na Hoje; concluir dá baixa (dose convertida, descartáveis, lote FIFO); reabrir desfaz.
- No-show e desmarcou aparecem em Recontatar em qualquer dia selecionado; reagendar devolve à agenda.
- Estoque: entrada em caixas converte para a unidade de estoque; saída em mg/UI converte; sobra descartada quando configurado; análise mensal com esperado × contado.
- Caixa às cegas: valores esperados só depois de fechar; diferença por forma.
- Perfil sem `valores` nunca recebe valores monetários do servidor.
- Nenhuma tela com rolagem horizontal em 390 px.

---

## 14. Glossário

| Termo | Significado |
|---|---|
| Tarefa | Qualquer item da rotina: interna, contato, atendimento, pagamento, sessão |
| Jornada | Etapas de um agendamento até o fechamento ou perda do orçamento |
| Recontatar | Agendamentos com no-show ou desmarcação aguardando novo contato |
| Programa (adesão) | Conjunto de procedimentos e sessões montado para um paciente |
| Item do programa | Um procedimento dentro do programa, com sessões, intervalo, dose e início |
| Baixa | Saída de estoque gerada por sessão ou procedimento |
| Unidade de estoque / compra / uso | Como se conta / como se compra / como se aplica (ex.: ampola / caixa / mg) |
| Contagem às cegas | Contagem sem mostrar a quantidade esperada |
| Diferença (estoque) | Contagem final − saldo esperado |
| Caixa às cegas | Conferência do caixa sem mostrar o valor registrado |
| Perfil de acesso | Conjunto de permissões por pilar |
| LTV | Total já pago pelo paciente à clínica |
| Saldo em aberto | Quanto o paciente ainda deve |
