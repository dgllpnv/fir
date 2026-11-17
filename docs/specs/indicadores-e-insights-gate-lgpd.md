# Gate LGPD — Indicadores & Insights

**Parecer do `especialista-lgpd-saude`, 2026-11-17**, sobre `indicadores-e-insights.md` e `indicadores-e-insights-tickets.md` (rascunho de 2026-11-16). Responde ao R-3.

## Veredito

**Aprovado com condições.** OKRs, KPIs e o job da carteira passam com ajustes pequenos. Os **relatórios** são a parte de risco: são a primeira rota do produto que tira do sistema, num arquivo, uma **lista** de pacientes com telefone e, em quatro casos, com dado de saúde (art. 11). As condições L-IN-1 a L-IN-18 entram nos tickets indicados. Cada uma é testável. T8, T9 e T10 não fecham sem as que forem deles.

**Bases legais, por finalidade** (premissa: a clínica é controladora; nós somos operadores, P-3):
- Relatórios 5, 11 (com paciente), 13 e 1 filtrado por procedimento = dado de saúde. Servem à execução e ao acompanhamento do tratamento e ao recall de lote: art. 11, II, "f".
- Usar a mesma lista para **campanha comercial** não é tutela da saúde. É a "finalidade comercial declarada pela clínica, **a confirmar no DPA**" que já está em `retencao.md` (funil). Não se afirma art. 11 pacífico.
- Relatórios 1 sem procedimento, 2, 3, 4, 6, 7, 9 e 14 = cadastro e relacionamento: art. 7º, V ou IX. Não se contaminam com o regime do art. 11 (§2 de `retencao.md`).
- `kpis_na_carteira` = agregado da clínica, art. 7º, V (DPA), como `uso_diario_cliente`.

## Condições (bloqueiam)

### Classificação e permissão
- **L-IN-1 (T8).** O catálogo em `packages/contracts` declara, por relatório, `classe: 'saude' | 'pessoal' | 'nenhuma'`. A classe passa a `saude` em tempo de execução quando o filtro de procedimento está presente (relatório 1) ou quando a coluna de paciente está pedida (relatório 11). **Teste:** tabela do catálogo × filtros → classe esperada.
- **L-IN-2 (T8/T9).** Relatórios de classe `saude` exigem, além da permissão do relatório, **`jornada`**. É o molde de `aplicarPermissaoDeJornada` e do Consumo do paciente (`estoque` **e** `jornada`). No relatório 11 sem `jornada`, a coluna de paciente não existe, e o resto do relatório continua. **Teste:** `estoque.gerir` sem `jornada` → 11 sem `paciente` em `colunas` e em `linhas`; 5 e 13 → `403`.
- **L-IN-3 (T9).** Composição de KPI com linha de paciente: `comparecimento`, `faltas_recontatadas`, `pacientes_recaptados` e `novos_pacientes` por origem. As três primeiras exigem `jornada`, não só `pacientes`. A rota de detalhe que devolve linha de paciente é `@DadoSensivel('pacientes', { lista: true })`. **Teste:** sem `jornada` → "Sem acesso ao detalhe"; com ela, uma linha `acessou`.
- **L-IN-4 (T7).** O Modo reunião e o `da-semana` **nunca** trazem composição nem nome de paciente: a tela vai para a TV da sala. **Teste:** varredura da resposta sem `pacienteId`/`nome`.
- **L-IN-5 (T8).** Na **sessão de suporte** (`ator_tipo = operador`), `POST …/exportacoes` de relatório de classe `pessoal` ou `saude` → `403`. Ver na tela fica permitido e registrado. O operador não precisa de um arquivo de pacientes para dar suporte. **Teste:** HTTP com sessão de suporte.

### Minimização por relatório (colunas padrão)
- **L-IN-6 (T8/T9).** As colunas padrão estão abaixo. O que não está listado não sai. Coluna de paciente identificado só em relatório de "lista de pacientes" e no 11 (L-IN-2).

  | Relatório | Padrão (tela e arquivo) | Só por escolha explícita | Nunca |
  |---|---|---|---|
  | 1, 2 | nome, último atendimento/compra (data), procedimento só se filtrado | telefone | aniversário, observação |
  | 3 | nome, LTV, ticket médio, nº de compras (com `valores`) | telefone | procedimento |
  | 4 | indicadora, nº de indicadas, nº que viraram pacientes | telefone | **nome das indicadas** (terceiras) |
  | 5 | nome, procedimento, sessões feitas/restantes | telefone | dose, lote |
  | 6 | nome, origem/campanha, convertido (sim/não) | telefone | procedimento |
  | 7 | nome, dia/mês, idade | telefone | data completa de nascimento |
  | 9 | nome, adesão, saldo (com `valores`) | telefone | procedimento além do nome do programa |
  | 11 | data, item, lote, quantidade, origem, custo (com `valores`) | paciente (com `jornada`) | telefone |
  | 13, 14 | nome, data, etapa/motivo | telefone | nota livre do histórico |

  **Telefone** é coluna opt-in no arquivo ("Incluir telefone"), desligada por padrão. Para contatar, o caminho é "Criar campanha", que não precisa de arquivo. **Teste:** schema de linha por relatório = a coluna "Padrão" + opt-in. Exportação sem `incluirTelefone` não contém `telefone`.
- **L-IN-7 (T8).** Nenhum filtro de texto livre por nome, telefone ou CPF de paciente. Procedimento, item e campanha entram **por id**, nunca por nome, na URL e no `filtros` gravado. **Teste:** os schemas Zod dos filtros não têm campo `string` livre além de enumerações e ids.

### Registro de acesso e de exportação
- **L-IN-8 (T8).** Gerar na tela grava `acessou` + `entidade = 'relatorio'`, com chave, filtros (ids), classe e **quantidade de linhas**, uma linha por geração (`{ lista: true }`). Erro não grava. **Teste:** H.6 com a contagem.
- **L-IN-9 (T8).** A exportação grava `entidade = 'exportacao_de_relatorio'` com formato, filtros, colunas opt-in, classe, quantidade e `finalidade` (L-IN-11). Ela grava também, numa tabela própria `pacientes_da_exportacao (clinica_id, exportacao_id, paciente_id)`, append-only e com RLS, **os ids** (nunca nome nem telefone) de cada paciente no arquivo. Sem isso, um arquivo vazado não diz **quais titulares** foram atingidos (art. 48, §1º, II), e o titular não sabe quem levou o dado dele. **Teste:** exportar 5 pacientes → 5 linhas; `UPDATE`/`DELETE` recusados a `fir_app`.
- **L-IN-10 (T8).** O **id da exportação** vai no cabeçalho e no nome do arquivo (`fir-<relatorio>-<AAAAMMDD>-<8 hex>.xlsx`). É o que torna o incidente **detectável e rastreável**: o arquivo achado leva a quem, quando, com qual filtro e a quais pacientes. **Teste:** o id do arquivo bate com a linha de auditoria.
- **L-IN-11 (T8/T9).** Exportar relatório de classe `saude` pede **confirmação com finalidade enumerada**: "Acompanhamento do tratamento", "Recall de lote", "Conferência interna". Não há texto livre. Fica gravado na L-IN-9. Exportar classe `pessoal` só pede a confirmação do aviso, sem finalidade. **Teste:** `POST` de classe `saude` sem `finalidade` → `422`.

### Cabeçalho do arquivo
- **L-IN-12 (T8).** Todo arquivo de classe `pessoal` ou `saude` (xlsx, CSV e PDF) abre com: clínica; relatório; filtros em texto; data e hora no fuso da clínica; quem exportou; código da exportação; e o aviso. **Classe `pessoal`:** *"Contém dados pessoais de pacientes de [clínica]. Uso restrito à finalidade da clínica. Não encaminhe nem guarde além do necessário."* **Classe `saude`:** *"Contém dados pessoais sensíveis de saúde (LGPD, art. 11). Uso restrito a: [finalidade]. Não encaminhe, não imprima sem necessidade e apague o arquivo ao terminar."* O texto sai pronto do servidor. **Teste:** Playwright H.1 lê o aviso nos três formatos.

### Campanha a partir da lista
- **L-IN-13 (T9).** "Criar campanha" com classe `saude` não copia procedimento nem filtro para a campanha, para a descrição da tarefa ou para o paciente. A origem (relatório, filtros, finalidade) fica **só** na auditoria. Até o DPA confirmar a finalidade comercial (P-3), a tela mostra a dica: *"Usar procedimento para campanha depende da finalidade combinada com a clínica."* **Teste:** a campanha e as tarefas criadas não contêm o id nem o nome do procedimento.
- **L-IN-14 (T9).** A lista exclui paciente desativado, que inclui quem "pediu para sair" (0081), e anonimizado. **Teste:** H.2 com um desativado por "pediu-para-sair".

### Navegador, log e favoritos
- **L-IN-15 (T8).** Linhas de relatório nunca vão para `localStorage`, `sessionStorage` nem IndexedDB. Também não há persistência do TanStack Query. A página de impressão busca as próprias linhas pelo `POST …/exportacoes`, o que já a registra. Sair do sistema limpa o cache. **Teste:** Playwright inspeciona o storage depois de gerar e de imprimir.
- **L-IN-16 (T8).** O log da API não grava query string nem corpo de `/v1/relatorios*` nem resposta de relatório (regra 21). **Teste:** captura do logger numa geração com filtro de procedimento.
- **L-IN-17 (T8).** `relatorios_favoritos.filtros` passa pelo Zod do relatório **na escrita** e, portanto, herda a L-IN-7: sem nome nem telefone de paciente. O campo `nome ≤ 80` mostra o aviso "não use nome de paciente". **Teste:** favorito com chave extra → `422`.

### Carteira da Firmare
- **L-IN-18 (T10).** Em `kpis_na_carteira`, KPI do pilar **Pessoas** atravessa só `situacao` e `percentual_da_meta`, **sem valor**. Numa clínica de duas fichas, o banco de horas "da equipe" é o de uma pessoa. O nome livre de KPI manual atravessa, então o formulário D.1 avisa: "não use nome de pessoa nem de paciente". Nada de `como_medir` nem de comentário. **Teste:** coluna `valor_*` nula para pilar Pessoas; varredura de colunas sem nome de pessoa.

## Retenção (entra em `retencao.md` com este parecer)

As linhas novas estão na seção "Indicadores & Insights" de `docs/compliance/retencao.md`. Em resumo:
- **Geração na tela:** 1 ano.
- **Exportação e `pacientes_da_exportacao`:** 5 anos. O volume é baixo, e o valor para incidente é longo.
- **Favoritos:** enquanto a clínica existir.
- **`kpis_na_carteira`:** 2 anos.
- **Lançamentos e textos livres de KPI e OKR:** prazo de registro de gestão.

A purga distingue `entidade = 'exportacao_de_relatorio'` de `'relatorio'`: o job D9 precisa saber disso.

## Recomendações (não bloqueiam)

- R-a. O campo `entidade` sozinho separa os prazos. Uma `acao = 'exportou'` própria tornaria a purga e o filtro de Atividades mais legíveis. Decidir na ADR do T8.
- R-b. Atividades: filtro rápido "Exportações", para a administradora revisar no fim do mês quem tirou o quê.
- R-c. Alerta, não bloqueio, quando uma pessoa exporta mais de 3 relatórios de classe `saude` num dia ou mais de 2.000 pacientes numa semana. É sinal de detecção de exfiltração. Fica como dívida, com o gatilho "primeira clínica com mais de 10 usuárias".
- R-d. O DPA (P-3) precisa de uma cláusula: o arquivo exportado sai do perímetro do operador, e a guarda dele é da controladora. O cabeçalho (L-IN-12) é a instrução documentada.
- R-e. O texto livre de `comentario` (280), `como_medir` (140), `porque` (500) e do objetivo do OKR leva o aviso fixo do molde de `outras_entradas` e nunca vai a log nem a mensagem de erro.
