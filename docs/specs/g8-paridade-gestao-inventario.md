# G8: paridade com o protótipo do Firmare Gestão, inventário

- **Data:** 2026-11-08
- **Autor:** `product-rotina-clinica`
- **Pedido do dono (2026-11-08):** "Tudo o que tem no protótipo e não tem no nosso deve ser construído."
- **Fonte de verdade:** `versoes/firmare-gestao-prototipo/` (`index.html`, 3.025 linhas · `fg-portal.js` · `fg-supabase.js` · `config.js`). Li tudo. Nada foi executado. As linhas citadas como `L123` são do `index.html`; `portal:L` é `fg-portal.js` e `sb:L` é `fg-supabase.js`.
- **Comparado com:** migrations `0025`–`0036` e `0039`, `apps/api/src/carteira/**`, `apps/api/src/painel/painel-carteira.*`, `apps/web/src/app/{carteira,portal,superadmin}/**`, `packages/contracts/src/{carteira,cobranca-carteira,prospeccao,portal-grupo}.ts`, `packages/domain/src/{carteira,cobranca-carteira,prospeccao,portal-grupo}.ts`, ADRs 0011–0018, specs G3/G5/G6 e `CONTEXT.md`.
- **Estado deste documento:** inventário e proposta de ordem. Não é spec de ticket, não decide o que só o dono decide (seção 20) e ainda não passou pelo gate de risco. Cada onda da seção 19 volta a `/to-spec` e ao gate antes de virar ticket.

**Legenda de estado:** **FEITO** (equivalente em produção) · **PARCIAL** (existe, falta o que está escrito) · **NÃO FEITO** · **FORA POR ADR** (excluído por ADR aceita; reabrir exige o que está escrito).

**Legenda de tamanho:** **P** cabe em um ticket (migration pequena, uma rota ou uma tela) · **M** de 2 a 4 tickets · **G** é um épico, com spec própria.

**Como ler a coluna "Transpor":** é a forma que proponho, já dentro das regras inegociáveis. Não é desenho final: o `arquiteto-dominio` e o `arquiteto-solucao` revisam na spec de cada onda.

---

## 0 · O que muda o enquadramento: dez achados

Antes do inventário, os achados que mudam a ordem do trabalho. Todos foram conferidos no código, não em relatório.

1. **O `Usuário de Gestão` nunca vê dinheiro.** Não existe o bit `valores` para esse ator. `RedacaoInterceptor` só lê `req.contexto` (sessão de clínica), e a carteira popula `req.carteira`. O resultado é que todo campo monetário sai `null` para toda a equipe Firmare (`apps/api/src/carteira/financeiro/redacao-carteira.test.ts:13-17`, `packages/contracts/src/cobranca-carteira.ts:11-14`, comentário em `apps/web/src/app/carteira/clientes/[id]/page.tsx:53-61`). No protótipo, a diretoria e quem tem `valores` veem mensalidade, MRR, receita e potencial (`L1117-1119`). Sem isso, mensalidades, MRR, potencial de leads, receita de campanha e cobrança ficam inúteis para quem usa a carteira. **Bloqueia metade do protótipo.**
2. **O cadastro do `Cliente Firmare` tem 13 colunas. O do protótipo tem cerca de 45 campos.** `clientes_carteira` tem só `id, grupo_id, clinica_id, nome, produto, status, criado_em, excluido_em, mensalidade_centavos` e os quatro links (`0026`, `0031:31`, `0036:37`). Faltam responsável Firmare, área de foco, decisor, telefone, datas do ciclo, reunião fixa, dia de vencimento, saúde, serviços, planilha, parceiros, projeto, pagador e o resto (`L2745-2755`). **Quase toda tela do protótipo depende de pelo menos um desses campos.**
3. **Um cliente só de consultoria nunca pode ficar `ativo`.** O `CHECK (status = 'onboarding' OR clinica_id IS NOT NULL)` (`0032:27`) contradiz o `CONTEXT.md` ("pode existir sem nunca haver uma `Clinica`") e o protótipo, que tem clientes ativos que não são clínica (Alumilider, indústria; Connecta, imobiliária, `L941`, `L946`).
4. **Converter um lead sem grupo provavelmente quebra.** A conversão insere `clientes_carteira.grupo_id = lead.grupo_id` (`prospeccao-carteira.service.ts:168`). Para `escopo='geral'`, o lead nasce sem grupo (ADR 0016 §2). `clientes_carteira.grupo_id` é `NOT NULL` e o `catch` só trata FK violada (`:175`). O e2e só exercita `escopo='grupo'` (`prospeccao-carteira.e2e.test.ts:67-76`). **Achado por leitura, não executei.** Precisa de um teste que reproduza antes da correção.
5. **Reunião aparece no portal sem ninguém ter compartilhado.** No protótipo o compartilhamento é *opt-in*: o checkbox "Compartilhar com a cliente" nasce desmarcado (`L1671`), existe "Compartilhar todas" (`L2844`) e o importador do Asana pergunta (`L1792`). O texto do espaço da cliente diz isso com todas as letras (`sb:L243`). `reunioes_comerciais` não tem a flag, e a policy do portal mostra todas (`0034:385-415`, com o comentário assumindo isso). É divergência do protótipo introduzida sem ADR, e com risco: a ata tem "impressões" internas. **Trato como defeito (seção 21, D-P1).**
6. **O portal tem seções que ninguém consegue preencher.** `documentos_carteira`, `materiais_carteira` e `reunioes_comerciais` existem, e o portal as lê (`leitura-do-portal.service.ts:192-208`). Mas não existe rota nem tela de escrita para a equipe Firmare. O único `INSERT` nessas tabelas está em teste (`teste/portal-no-banco.test.ts`, `portal.e2e.test.ts`). O mesmo vale para `campanhas_carteira`.
7. **O job de sincronização de campanhas (G4) não foi escrito.** O comentário da `0034:274-282` diz isso. Enquanto `orcamentos_pagos` é `NULL`, a supressão por N pequeno esconde tudo, o que é o comportamento certo. Na prática, nenhuma campanha aparece em lugar nenhum.
8. **A cobrança vence sempre no dia 10.** `vencimentoDaCompetencia` fixa o dia 10 (`gerar-cobrancas.ts:51-55`). O protótipo usa o `dia_vencimento` de cada cliente e cai no último dia do mês curto (`L709`, `L887`), que é a mesma regra 25 do `CLAUDE.md`. O job também só gera para `status='ativo'` (`:75`). O protótipo cobra quem tem mensalidade e vencimento, ativo ou em onboarding (`L880`, `L1120`). E não há rota para cadastrar ou editar a `mensalidade_centavos`.
9. **A rotina interna não tem os parâmetros do protótipo.** Sem dia da semana, sem "N-ésimo dia útil", sem antecedência, sem filtro por serviço, sem mensagem e sem prioridade (`0032:388-400`). Semanal é `início + 7`, mensal é `início + 1 mês` (`packages/domain/src/prospeccao.ts:171-177`). As frequências `vencimento` e `reuniao` são aceitas no cadastro mas nunca geram tarefa (`prospeccao-carteira.service.ts:431-450`). As seis rotinas padrão do protótipo dependem justamente desses parâmetros (`L848-857`).
10. **O protótipo é o CRM da equipe Firmare, administrado pela diretoria dela.** A diretoria cria colaboradoras, escolhe telas, carteira e valores, e gera acesso (`L2641-2653`, `L2772-2775`, `sb:L196-234`). A ADR 0011 diz que só o `Operador` cria e atribui `Usuário de Gestão`. **Essa é a maior colisão entre o protótipo e uma ADR aceita (seção 20, D-2).**

---

## 1 · Transversais: perfis, acessos, navegação, configuração

| ID | O que o protótipo faz | Estado no nosso código | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **T1** Perfis e permissões | Perfil tem `papel` (`admin`=Diretoria, acesso total · `colaboradora`), `modulos[]` (9 telas, `L517`), `carteira` (`minha` = só clientes onde `colaboradora_id` é ela · `todos`), `valores` (vê dinheiro), `setor` (diretoria/comercial/administrativo/financeiro, decide quem recebe item de checklist, `L562`, `L918-923`), `funcao`, `ativo`, `nascimento`, `telefone`. `can(m)`, `podeValores()`, `vis(c)` e `money(v)` em `L1109-1120`. Na versão publicada, os campos financeiros do cliente vão para a coleção separada `clientes_fin`, só lida e escrita por quem tem `valores` (`sb:L11`, `sb:L110-118`, `sb:L327`). | **PARCIAL.** `usuarios_gestao` só tem `escopo` (geral/grupo), `ativo` e senha (`0025:158-186`). Sem papel, módulos, carteira minha/todos, `valores` ou setor. Dinheiro sempre redigido (achado 1). | Colunas novas em `usuarios_gestao`: `valores bool`, `carteira text CHECK IN ('minha','todos')`, `modulos text[]`, `setor`, `funcao`, `telefone`, `nascimento`. Uma tabela de chaves de módulo em `packages/domain`, no mesmo molde de `temPerm` (uma função só, servidor e tela). O `RedacaoInterceptor` passa a ler `req.carteira.valores` no **mesmo ponto único** (regra 17). `carteira='minha'` é filtro de **servidor** (regra 16), resolvido pela sessão e nunca por parâmetro. Edição na tela do superadmin (D-2). **G** | Segurança: `especialista-seguranca-appsec` revisa a extensão do interceptor (redação fora do ponto único é veto). LGPD: `nascimento`/`telefone` da equipe Firmare entram em `retencao.md` (art. 7º, V, contrato de trabalho, como `usuarios_gestao` já está na ADR 0013 §3). Toca ADR 0011 (D-2) e a decisão provisória 2 da ADR 0016 (D-3). |
| **T2** Acessos da equipe | A diretoria clica "Criar acesso", informa o e-mail, a ferramenta gera senha provisória e mostra a mensagem pronta para enviar. Também há "Gerar nova senha" e "Remover acesso". No primeiro login, troca de senha obrigatória (`sb:L196-234`, `sb:L51-66`, `L2648`). | **FEITO**, com outro dono: o `Operador` cria o `Usuário de Gestão` com senha provisória (`POST /v1/superadmin/usuarios-gestao`), edita e desativa (`PATCH`), e a troca obrigatória existe (`carteira.controller.ts:124`). Falta só a mensagem pronta para copiar com endereço, usuário e senha. | Mensagem pronta para copiar na tela de criação do superadmin. Login por usuário, não e-mail (decisão vigente do produto). **P** | Toca ADR 0011 só se o dono quiser que a diretoria da Firmare faça isso sem passar pelo superadmin (D-2). |
| **T3** "Ver como" | A diretoria troca o seletor da barra lateral e passa a ver a ferramenta como outra colaboradora. Uma faixa avisa "As alterações ficam registradas normalmente" (`L1257-1261`, `L1272`, `L3005`). | **NÃO FEITO.** | **Proponho não construir como impersonação.** Escrever como outra pessoa é exatamente o que a trilha de auditoria existe para impedir (regra 20: "quem"). Alternativa: uma prévia de permissões só de leitura na tela de edição do usuário. Divergência do protótipo, vira ADR (seção 21, PP-1). **P** (a prévia) | Segurança: impersonação é sessão com dois atores. |
| **T4** Navegação | Cinco grupos: Hoje · Clientes · Novos clientes · Método Firmare · Administração. Badge vermelho de tarefas vencidas e de contatos "agora" na prospecção. Cada item aparece só se o perfil tem o módulo (`L1246-1256`). | **PARCIAL.** `NavDaCarteira` tem três itens: Clientes, Leads, Rotina (`apps/web/src/app/carteira/pecas.tsx:18-20`). Sem badges e sem filtro por módulo. | Menu da carteira com os grupos do protótipo, filtrado por `modulos` (T1). Badges calculados no servidor (contagem), nunca no front. Em 390 px, uma barra rolável de grupos sem rolagem horizontal da página (o protótipo já faz isso, `L212-223`). **P** depois de T1 | — |
| **T5** Configurações | Chave Pix e favorecido da Firmare (usados no lembrete de pagamento, Pix visível só com `valores`) e a regra do benefício por indicação (texto livre) (`L2654-2657`, `L2953`, `L2956`). | **NÃO FEITO.** | Tabela `configuracao_da_carteira` (uma linha, sem `clinica_id`, RLS `escopo='geral'` para escrita), auditada por `registrar_auditoria_do_painel`. A regra do benefício vira `percentual_centesimos` (ADR 0015 §1, achado 5), nunca texto livre. **P** | Dinheiro: a regra do benefício passa pelo `validador-numeros`. Pix é dado da Firmare, não pessoal. |
| **T6** Visual | Papel e dourado, barra lateral clara, item ativo dourado, tema escuro em par, 390 px (CSS `L14-478`). Fonte de título Cormorant Garamond (`L12`). | **FEITO** na identidade (`docs/design.md`, Lora). | Seguir `docs/design.md`, não a fonte do protótipo. O cartão KPI com gradiente (`L247`) é proibido pelo nosso design.md e não atravessa. **—** | — |
| **T7** Sincronização ao vivo | Várias pessoas editando ao mesmo tempo. O protótipo assina mudanças da tabela genérica `registros` pelo Realtime do Supabase e mescla com o estado local (`L1122-1227`, `sb:L148-165`). | **Não se aplica.** É infraestrutura do protótipo. A nossa API é a fonte e o TanStack Query reconsulta. | Nada a construir. Se a equipe sentir falta, refetch por foco ou intervalo. **—** | — |
| **T8** Conteúdo padrão | Seis checklists por contrato (`modelosPadrao`, `L566-622`), seis rotinas (`L848-857`), sete mensagens (`L834-841`), oito roteiros de abordagem (`L534-560`), o roteiro de briefing (`L2031-2195`). | **NÃO FEITO.** | Semente idempotente por chave (regra 26: reexecutar não duplica), carregada uma vez e depois editável. Entra junto com o módulo que usa cada conteúdo. **P** por módulo | O roteiro de briefing é conteúdo estático, sem dado pessoal (ver B1). |

---

## 2 · Visão geral (`vPainel`, `L1278-1331`)

A tela de abertura da diretoria. **Estado do conjunto: NÃO FEITO.** Não existe painel inicial da carteira: `/carteira` redireciona para a lista de clientes (`apps/web/src/app/carteira/page.tsx`).

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **P1** Quatro KPIs | Clientes ativos (com quantos em onboarding) · Receita recorrente mensal (soma de `valor_mensal`) e ticket médio · Ações do plano atrasadas (em quantos clientes) · Tarefas da equipe vencidas (quantas vencem hoje) (`L1296-1301`). | NÃO FEITO | `GET /v1/carteira/painel`, calculado no servidor. MRR e ticket com `Dinheiro` e redação (T1). **P** | Dinheiro: o ticket médio é uma divisão, e precisa de regra de arredondamento definida (`validador-numeros`). Regra 6 da ADR 0013: para quem tem escopo de grupo, MRR sempre quebrado por clínica. |
| **P2** Saúde da carteira | Barra bom/atenção/crítico e lista dos clientes em atenção ou crítico, com o resumo da última reunião, ações atrasadas e responsável (`L1303-1310`). | NÃO FEITO (a saúde derivada do checkin existe no domínio, `saudeAtualDoCliente`) | Ler a saúde derivada (PP-3) e a última reunião (V14). **P** | — |
| **P3** Equipe | Para cada pessoa não-diretoria: clientes na carteira, tarefas pendentes, vencidas e uma barra (`L1289-1292`, `L1312-1317`). | NÃO FEITO | Depende do responsável Firmare no cliente (C3) e de tarefas por responsável (já existe). **P** | — |
| **P4** Reuniões da semana | Clientes ordenados pelo dia da reunião fixa, com o de hoje destacado (`L1288`, `L1318-1319`). | NÃO FEITO | Depende de `dia_reuniao` estruturado (C3). **P** | — |
| **P5** Briefings a fazer | Clientes em onboarding sem briefing concluído (`L1898-1902`). | FORA POR ADR 0013 §1 | Ver B10. | LGPD. |
| **P6** Aniversários | Equipe Firmare e decisoras das clientes nos próximos 7 dias, com idade e botão "Parabenizar" que abre o WhatsApp com mensagem pronta (`L1903-1914`). | NÃO FEITO | `nascimento` na equipe (T1) e `nascimento_responsavel` no cliente (C3). Lista calculada no servidor, no fuso da Firmare. Mensagem por `wa.me` (W4). **P** | LGPD: data de nascimento é dado pessoal comum. Precisa de linha própria em `retencao.md` com base legal (legítimo interesse, relacionamento comercial) e de minimização (dia e mês bastam para o lembrete, o ano só para a idade). |
| **P7** Planilhas da semana | Para cada cliente com planilha: chip por frente (completa, atenção, não recebida) da semana anterior (`L1915-1921`). | NÃO FEITO | Ver G1-G4. **M** | Integração externa (seção 17). |
| **P8** Mensalidades do mês | Ver $4. | NÃO FEITO | Ver $4. | Dinheiro. |
| **P9** Prospecção: contatos recomendados | Os quatro sinais mais urgentes (agora ou hoje), com botão de WhatsApp (`L2461-2465`). | NÃO FEITO | Ver L2. **P** | — |
| **P10** Próximas entregas do plano | Ações do plano atrasadas ou dos próximos 7 dias, com check para concluir (`L1327-1330`, `tabelaAcoes` `L1335-1345`). | NÃO FEITO | Ver V8. **P** | — |
| **P11** Atalhos | "Registrar reunião", "Nova tarefa", "Novo cliente" (`L1295`). | NÃO FEITO | Atalhos que abrem V14, R6 e C4. **P** | — |

---

## 3 · Minhas tarefas · Rotina da equipe (`vRotina`, `L1861-1896`)

Três abas: Tarefas · Carga da equipe · Rotinas.

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **R1** Lista de tarefas | Filtro Minhas · Todas · por pessoa. Quatro colunas: Vencidas · Hoje · Próximos 7 dias · Mais adiante. Painel "Concluídas recentemente" (6) (`L1877-1888`). | **PARCIAL.** `/carteira/rotina` lista as tarefas do grupo inteiro, sem filtro "Minhas" (o comentário diz que a sessão não expõe o id do usuário corrente como filtro, `rotina/page.tsx:27-32`) e sem as colunas por prazo. | O id do `Usuário de Gestão` está na sessão (`req.carteira`). "Minhas" é filtro de tela sobre a lista já autorizada (ADR 0016, decisão provisória 2). Seções empilhadas por prazo, nunca colunas lado a lado em 390 px (mesma régua de `leads/page.tsx:22-24`). **P** | — |
| **R2** Campos da tarefa | Título, cliente ou "Interno", responsável, solicitante, prazo, prioridade (normal/alta/baixa), repetir (não/diária/semanal/mensal), status, descrição. Editar e excluir (`fTarefa` `L2769-2770`, `L2869`). | **PARCIAL.** `tarefas_internas` tem título, descrição, responsável, cliente, lead, prazo, prioridade e status (`0032:422-438`). Faltam solicitante, recorrência, edição e "excluir". | Colunas `solicitante_usuario_gestao_id` e `recorrencia`. `PATCH` de edição. "Excluir" vira `cancelada` (regra 20), nunca `DELETE`. **P** | — |
| **R3** Concluir com efeitos | Concluir uma tarefa recorrente cria a próxima (`proxima` `L2789`, `L2864`). Concluir tarefa com mensagem abre o modal de WhatsApp (`L2865`). A tarefa "reunião de metas" abre o lançamento semanal em vez de concluir (`L2863`). A tarefa de lembrete de pagamento mostra "Já pago" (`L1893`). Reabrir desfaz. | **PARCIAL.** Concluir e cancelar existem (`POST tarefas-internas/:id/status`). Não há reabrir, recorrência nem efeitos. | Recorrência mensal no dia 29/30/31 cai no último dia do mês (regra 25, `somarMeses` já existe em `recorrencia.ts`). A próxima ocorrência fica idempotente por `(tarefa_origem_id)`. Reabrir é transição explícita e auditada. **M** | — |
| **R4** Transferir tarefa | Botão "Transferir" em cada tarefa aberta (`L1893`, `L2817`). | NÃO FEITO | `POST tarefas-internas/:id/responsavel`, validando que o novo responsável é do mesmo grupo (ADR 0016 §2, `validarResponsavelDoMesmoGrupo` já existe). **P** | Segurança: a mesma validação de grupo da ADR 0016. |
| **R5** Subitens | Rotina "com a lista de clientes" gera **uma** tarefa com um checkbox por cliente, e conclui sozinha quando todos estão marcados (`L912-913`, `L2855-2856`). As variantes "frentes" e "envio" mostram quatro frentes (ver W3 e G4). | NÃO FEITO | Tabela `itens_de_tarefa_interna` (tarefa, cliente opcional, rótulo, feito, feito_em, por). Concluir pelo último item no servidor. **M** | — |
| **R6** Escolher o que criar | "Nova tarefa" pergunta: tarefa única ou rotina, com exemplo de cada (`L2980-2983`). | NÃO FEITO (há dois formulários separados) | Um botão, uma escolha, dois toques até o formulário certo. **P** | — |
| **R7** Carga da equipe | Tabela pessoa × (atrasadas, esta semana, próxima, duas seguintes), com barra e composição por tipo (onboarding, rotina, reunião, avulsa). Clicar numa pessoa mostra o detalhe por cliente (`L1825-1847`). | NÃO FEITO | `GET /v1/carteira/carga`, semanas de segunda a domingo calculadas no servidor, no fuso da Firmare (regra 23, janela semiaberta). O "tipo" depende da origem da tarefa (checklist C4/X5, rotina, reunião V14, avulsa). Tabela com rolagem interna só nela, nunca na página (390 px). **M** | — |
| **R8** Redistribuir | De, para, cliente opcional, quais tarefas (só checklist · só avulsas e reunião · todas menos rotinas), prazo a partir de. Rotinas não se movem aqui, porque voltariam na semana seguinte (`L1848-1860`). | NÃO FEITO | `POST /v1/carteira/tarefas-internas/redistribuir`, em uma transação, com auditoria por tarefa e `transferida_de`. **P** | Segurança: o destino precisa ser do mesmo grupo. |
| **R9** Lista de rotinas | Por pessoa: título, formato, frequência em texto, próxima data e "% no prazo" das últimas 8 vezes (`L1867-1876`, `freqTxt` `L870-876`). | **PARCIAL.** Lista simples sem próxima data nem cumprimento (`rotina/page.tsx:421-525`). | Próxima data e "% no prazo" calculados no domínio, puros. **P** | O "% no prazo" é contagem, não dinheiro. |
| **R10** Cadastro da rotina | O que fazer, responsável, prioridade, frequência (semanal, mensal, todo dia útil, antes do vencimento de cada cliente, no dia da reunião fixa de cada cliente), dia da semana, N-ésimo dia útil, dias de antecedência, formato (simples · com lista de clientes · uma por cliente), para quais clientes (todos · relatório semanal · fluxo · DRE · mensalidade · metas), mensagem ao concluir, envio aos parceiros, marcar frentes, passos, ativa/pausada. Editar apaga as tarefas futuras ainda abertas. Excluir apaga as abertas (`fRotina` `L2776-2784`, `L2853`). | **PARCIAL.** Título, responsável, frequência, escopo de aplicação (`global` ou `por_cliente`), passos e início. Sem edição nem pausa (`0032:388-400`, achado 9). | Colunas dos parâmetros. O formato "com lista" vira `escopo_aplicacao='lista'` (terceiro valor). `PATCH` com pausa. Editar **cancela** as futuras abertas (nunca `DELETE`, regra 20) e a geração refaz. "Excluir rotina" é desativar. **M** | — |
| **R11** Geração de tarefas | Até 7 dias à frente (35 para vencimento). Diária só em dias úteis. Semanal no dia escolhido. Mensal no N-ésimo dia útil. Vencimento: X dias antes do vencimento de cada cliente, recuando para o dia útil anterior se cair no fim de semana, com vencimento no último dia do mês curto. Reunião: no dia da reunião fixa de cada cliente, a partir de `reunioes_inicio`. Por cliente, só os que têm o serviço (`aplica` `L877-883`, `datasRotina` `L859-869`, `datasVenc` `L884-892`, `gerarRotinas` `L894-917`). Idempotente por id composto (`L899`). | **PARCIAL.** O job existe e é idempotente (índices `0032:455-460`, `worker-rotinas-internas.ts`). Só diária, semanal e mensal, com regras diferentes (achado 9). | Funções puras em `packages/domain` (calendário útil, N-ésimo dia útil, vencimento com regra 25, recuo de fim de semana), com property-based test das datas que doem. Feriado: o protótipo ignora, e eu também ignoraria (fica registrado). **M** | Tempo: regras 22-25. Depende de C3 (`dia_vencimento`, `dia_reuniao`, `servicos`). |
| **R12** Rotinas padrão | Seis: fluxo de caixa (2º dia útil, por cliente com serviço "fluxo", com mensagem) · DRE (3º dia útil) · formulários semanais aos parceiros (sexta, envio) · validar dados e avisar sobre o relatório (segunda, frentes, mensagem) · reunião semanal de metas (dia da reunião) · lembrete de mensalidade (3 dias antes do vencimento, prioridade alta) (`L848-857`). | NÃO FEITO | Semente (T8), depois de R10 e R11. **P** | — |
| **R13** Uso baixo vira tarefa | Quando uma clínica fica em "Três dias sem uso" ou "Uso muito baixo", nasce uma tarefa de prioridade alta para o comercial: "FIR Clinic sem uso em X: ligar para a recepção", uma por dia, sem duplicar (`alertasUso` `L1575-1582`). | NÃO FEITO | Job diário depois do `uso_diario_cliente`, regra de saúde de uso no domínio (F1), tarefa idempotente por `(cliente, dia)`. **P** | Usa só contagens. Nunca nome de funcionária (ADR 0013 §2). |
| **R14** Lembrete some se já pagou | A tarefa de lembrete de mensalidade se conclui sozinha quando o mês já está pago, com o rótulo "pago antes do lembrete" (`baixarPagos` `L704-707`). | NÃO FEITO | No job de geração e no "marcar pago" ($2). **P** | — |

---

## 4 · Carteira de clientes (`vClientes`, `L1348-1387`)

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **C1** Lista | Busca por nome, status (ativos e onboarding · todos · cada status), saúde, responsável e projeto. Ordena por saúde (crítico primeiro) e nome. Colunas: cliente (segmento, cidade, status), produto e foco (e projeto), responsável, saúde, plano de ação concluídas/total (e atrasadas), reunião, mensalidade (`L1348-1374`). | **PARCIAL.** Cartões com nome, produto e status (`apps/web/src/app/carteira/clientes/page.tsx`). Sem filtros, saúde, responsável, plano, reunião ou mensalidade. | Filtros por query-string no servidor. Em 390 px, cartão empilhado com o essencial e o resto recolhido. **M** depois de C3, T1 e V8 | Dinheiro: mensalidade redigida sem `valores`. |
| **C2** Agrupar por produto e projeto | Segmento por produto com contagem. "Agrupar por produto e projeto" mostra um cartão por produto e projeto (ou turma) com clientes, onboarding, MRR (com `valores`), "pago por", barra de saúde e "Ver só estes" (`L1367-1368`, `L1376-1387`). | NÃO FEITO | Agregado no servidor. Depende de `projeto` e `pagador` (C3). **P** | Dinheiro: MRR por grupo é soma explícita das linhas (ADR 0013 §6, ADR 0015 achado 1: a soma sai do mesmo array das linhas). |
| **C3** Cadastro do cliente | Nome, segmento, cidade, decisor, aniversário da decisora, telefone, e-mail, CNPJ, produto (5 opções, `L516`), área de foco (6, `L515`), projeto ou turma, quem paga, mensalidade, reunião fixa ("terça 10h"), início, fim do ciclo, status, saúde, responsável Firmare, observações. Seção **Pagamento**: dia do vencimento e WhatsApp de cobrança (só com `valores`). Seção **Serviços e links**: serviços recebidos (relatório semanal, fluxo, DRE), os quatro links, planilha de indicadores, código da clínica na Gestão de Rotina. Seção **Parceiros**: por frente (financeiro, comercial, tráfego, marketing) o parceiro, o WhatsApp e o link do formulário (`F.cliente` `L2745-2755`, `fCliente` `L2771`). | **PARCIAL.** 13 colunas (achado 2). Só os quatro links têm rota de edição (`PATCH /v1/carteira/clientes/:id/links-de-acesso`). Nome e produto só na criação, pelo `Operador`. | Migração *expand* em `clientes_carteira` com: `responsavel_usuario_gestao_id`, `segmento`, `cidade`, `decisor`, `telefone`, `email`, `cnpj`, `area_foco`, `projeto`, `pagador`, `data_inicio`, `data_fim`, `reuniao_dia_semana smallint` + `reuniao_hora` (nunca o texto livre "terça 10h", que o protótipo precisa reinterpretar com `DIAN` `L748`), `reunioes_inicio`, `dia_vencimento smallint CHECK 1-31`, `telefone_cobranca`, `servicos text[]`, `link_planilha`, `observacoes`, `nascimento_decisor`, `cliente_desde`. Os parceiros vão para uma tabela própria (`parceiros_do_cliente`: frente, nome, telefone, link do formulário), nunca 12 colunas soltas. "Código da Gestão de Rotina" **não atravessa**: o vínculo é `clinica_id` (ADR 0012 item 4). `PATCH /v1/carteira/clientes/:id` com redação dos campos de pagamento. Formulário com seções recolhidas, campo raro atrás de "+ Mais opções". **G** | LGPD: decisor, telefone, e-mail e aniversário são dado pessoal da médica-cliente (art. 7º, V, contrato). Telefone de parceiro é dado de terceiro (art. 7º, IX, legítimo interesse): linha nova em `retencao.md`. Dinheiro: `mensalidade_centavos` e `dia_vencimento` atrás de `valores` (como faz `clientes_fin`, `sb:L11`). Segurança: `responsavel_usuario_gestao_id` validado no mesmo grupo (ADR 0016 §2). |
| **C4** Novo cliente | Cria o cliente com status onboarding e início hoje. Na mesma hora gera o checklist do contrato como tarefas, gera as rotinas e mostra a carga que isso põe em cada pessoa nesta semana ("Eduarda +4 (fica com 11)") (`L2892-2895`). | **NÃO FEITO** para o `Usuário de Gestão`. Só o `Operador` cria `Cliente Firmare`, e sempre vinculando uma clínica existente (`CriarClienteCarteiraEntrada`, `packages/contracts/src/carteira.ts:129-136`). A ADR 0016 §1 diz que não há rota de criar cliente do zero para o `Usuário de Gestão`. | `POST /v1/carteira/clientes` (sem clínica). Checklist (X5) e rotinas (R11) na mesma transação. Recado de carga calculado no servidor. **M** | Toca ADR 0016 §1, o CHECK da `0032` e a regra de grupo (D-4). |
| **C5** Editar e excluir | Editar cadastro. Excluir (só a diretoria) apaga em cascata metas, ações, campanhas, documentos, reuniões, indicadores e lançamentos (`L2966`). | **PARCIAL** (só links). | Excluir vira `status='encerrado'` (estado, regra 20) e `excluido_em` só para cadastro errado. Nunca cascata. **P** | Regra 20. |
| **C6** "Já é cliente" (migração da carteira atual) | Formulário de cliente com "Cliente da Firmare desde" e os quatro links obrigatórios. Gera o checklist marcando como feitos os itens de prazo vencido. Cria a tarefa "Completar o cadastro de X" com o que falta. Abre um passo a passo em três etapas: metas em andamento (tabela editável com "quando entrou", "hoje" e alvo), importar reuniões do Asana, e o aviso permanente "Entrada de cliente que já é da Firmare" até completar (`L1715-1771`, `L2905-2918`). | NÃO FEITO | Mesmo `POST` de C4 com `cliente_desde` e `migrado=true`. O que falta é calculado no domínio (`faltasMigracao`). As metas em andamento entram em lote (M2). **M** | É o caminho que traz as clientes reais da Firmare para dentro. Só faz sentido depois de C3 e M2. |
| **C7** Importar reuniões do Asana | CSV exportado do Asana, separador detectado, colunas reconhecidas em português ou inglês, datas `aaaa-mm-dd` ou `dd/mm/aaaa`, pré-seleção das tarefas que falam em "reunião", deduplicação por id da tarefa do Asana, escolha de compartilhar ou não (`L1773-1812`, `L2916-2918`). | NÃO FEITO | Ver seção 17 (integrações). `POST /v1/carteira/clientes/:id/reunioes/importar` recebendo as **linhas já parseadas** (o parser fica no front, ou em `packages/domain` puro). Idempotente por `(cliente, asana_id)` (regra 26, testada com três reimportações). **M** | Integração: só CSV, sem API do Asana. LGPD: anotação do Asana pode ter comentário interno ou menção a paciente, por isso o padrão é **não** compartilhar. |

---

## 5 · Ficha do cliente (`vCliente`, `L1388-1402`)

Nove abas com contador: Visão geral · Briefing · Checklist do contrato · Metas e plano de ação · Campanhas · Indicadores · Uso da FIR Clinic · Documentos · Reuniões. Ações no cabeçalho: Editar cadastro · Registrar reunião · Iniciar briefing.

**Estado do conjunto: PARCIAL.** A nossa ficha (`apps/web/src/app/carteira/clientes/[id]/page.tsx`) é uma página só, com Cobranças, Indicadores, Metas, Links e Acesso ao portal. Não existe `GET /v1/carteira/clientes/:id` (a tela procura o id na lista, `:40-45`).

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **V1** Abas e cabeçalho | Abas com contadores (ações abertas, campanhas, indicadores, documentos, reuniões, checklist feito/total, briefing). Chips de saúde e status. Linha com segmento, cidade e responsável Firmare (`L1390-1401`). | PARCIAL | `GET /v1/carteira/clientes/:id` (RLS por grupo e mesma resposta 404 para "não existe" e "não é seu", como já é hoje). Abas por rota, para o botão de voltar funcionar no celular. **M** | Registro de acesso por clínica (ADR 0013 §7) já vale para leitura de agregado. |
| **V2** Visão geral: cadastro e ciclo | Decisor, telefone, e-mail, mensalidade, início, fim do ciclo (ou "Recorrente"), reunião fixa, CNPJ, área de foco. Barra do ciclo: "Mês 3 de 4" e "% do ciclo". Observações (`L1409-1423`). | NÃO FEITO | Depende de C3. Mês do ciclo calculado no domínio. Hoje o portal usa `mesesJuntos` a partir de `criado_em` (`portal-grupo.ts`), que passa a usar `data_inicio`. **P** | — |
| **V3** Progresso do checklist | "Checklist Acelerador FIR · 2 atrasados · 8 de 27", barra e o próximo item com responsável e prazo (`L2613-2619`). | NÃO FEITO | Ver X5. **P** | — |
| **V4** Indicações feitas | "Indicou 2 médicos · 1 virou cliente · 1 benefício pendente" (`L2549-2553`). | NÃO FEITO | Ver L11-L12. **P** | — |
| **V5** Acessos da cliente | Os quatro links (abrir, copiar, ou "Cadastrar"), "Enviar acessos" pelo WhatsApp com mensagem pronta, e os formulários dos parceiros por frente (com "sem WhatsApp" quando falta) (`L2593-2600`). | **PARCIAL.** Os quatro links existem e são editáveis (`links-de-acesso.tsx`). Faltam a mensagem de envio e os parceiros. | Mensagem por template (X4, chave `acessos`). Parceiros a partir de C3. **P** | — |
| **V6** Última reunião e metas | Data, saúde registrada, resumo (280 caracteres), encaminhamentos. Lista de metas com "ações concluídas/total" (`L1426-1430`). | NÃO FEITO | Depende de V14 e V8. **P** | — |
| **V7** Espaço da cliente | Painel "O que X vê ao entrar": lista dos acessos (nome, e-mail), "Gerar nova senha", "Remover", "Criar acesso da cliente" e "Ver como a cliente", que abre o portal em modo prévia (`sb:L237-276`, `portal:L150`). | **PARCIAL.** Só criar (`acesso-do-portal.tsx`, `POST /v1/carteira/acessos-do-portal/usuarios`). Sem lista, nova senha, desativar ou prévia. | Listar, gerar nova provisória e desativar (estado, regra 20) usuários do portal do próprio cliente. A prévia é uma leitura do `Usuário de Gestão` que monta a **mesma** resposta do portal, com faixa "Você está vendo como a cliente vê". **M** | Segurança: a prévia nunca autentica como o `Usuário do portal`. É leitura da carteira com a mesma redação (ADR 0018 §1). Registro de acesso com `ator_tipo='usuario_gestao'`. |
| **V8** Metas e plano de ação | Tabela de metas (barra com marcador do esperado, valor atual, "da planilha", status). Botão "Lançar resultado da semana". "Nova meta". **Plano de ação e ações comerciais**: ação, tipo (plano ou comercial), meta vinculada, quem executa (cliente ou Firmare, com acompanhamento Firmare), prazo, status (pendente, em andamento, concluída, cancelada), descrição. Check para concluir, chip "Atrasada", filtro Todas · Plano · Comerciais (`L1432-1443`, `fAcao` `L2767-2768`, `L2861`). | **PARCIAL.** Metas existem (ver seção 7). **"Ação do plano" não existe** em lugar nenhum. | Termo novo no `CONTEXT.md` antes de qualquer migration: **`Ação do plano`** (não confundir com `Tarefa interna`: a ação pode ser executada pela clínica, e é o que se mostra à cliente como plano). Tabela `acoes_do_plano` (cliente, grupo, título, tipo, meta opcional, quem executa, acompanhamento, prazo, status, concluída_em), RLS por grupo, auditoria pelo painel. **M** | O portal do protótipo **não** mostra as ações (`portal:L94-173`). Não estender o portal sem decisão. |
| **V9** Aba Campanhas | Filtro de período (este mês, 3, 6, 12 meses, este ano, ciclo do contrato, escolher). KPIs: valor total no período (no mês e continuado), valor gerado neste mês, retorno sobre o investimento. Tabela: mês, campanha, tipo, resultado, % da meta, no mês, continuado, total, retorno, status. Rodapé com a regra de cálculo (`L1444-1476`). | NÃO FEITO | Ver seção 8 (K1-K4). **M** | ADR 0013 §4 e §5. |
| **V10** Indicadores manuais | Cartões por indicador: último valor, "Na meta" ou "Abaixo", meta semanal, variação na semana, gráfico das últimas 8 semanas com a linha da meta. "Novo indicador" e "Lançar semana" (todos os indicadores em um formulário, com a segunda-feira como referência) (`L1520-1530`, `L2970-2973`). | **PARCIAL.** Indicador e lançamento existem (`indicadores_carteira`, `lancamentos_de_indicador`, `0031`), com "Lançar medição" por indicador e o último valor. Faltam a meta do próprio indicador, a variação, o gráfico e o lançamento de todos de uma vez. | Coluna `meta` no indicador (mesmo par centavos/inteiro com trigger de unidade, ADR 0015 achado 4). Variação e série calculadas no servidor. `POST /v1/carteira/clientes/:id/lancamentos` em lote, upsert por `(indicador, referência)`. A referência é sempre uma segunda-feira, validada no servidor. **M** | Dinheiro: variação percentual entre duas semanas é divisão. Regra de arredondamento com o `validador-numeros`. |
| **V11** Indicadores pela planilha | Quando há planilha: "Situação da planilha" por frente com os problemas encontrados, histórico de 8 semanas em pontos coloridos, "Abrir planilha", "Ler planilha agora", filtro de 8 semanas a 12 meses ou ciclo, e por frente os indicadores derivados com média, variação, gráfico e a última análise do parceiro (`L1499-1519`). | NÃO FEITO | Ver seção 14 (G1-G4). **G** | Integração externa (seção 17). |
| **V12** Uso da FIR Clinic | KPIs da semana (dias com uso, tarefas no prazo, rotinas cumpridas, situação). Gráfico de tarefas concluídas por dia em 30 dias. **Lista de pessoas da clínica com o último acesso** ("usou ontem", "há 5 dias", "ainda não usou"). Resultados: contatos, orçamentos pagos de enviados, receita registrada (com `valores`), pacientes recaptados, faltas recontatadas, em uso desde. Relatório de uso com marcos de 30, 60 e 90 dias, comparando as duas primeiras semanas com as duas últimas, e "Copiar relatório" (`L1607-1638`). | NÃO FEITO (os dados diários existem em `uso_diario_cliente`, `0028`; não há rota de leitura nem tela) | `GET /v1/carteira/clientes/:id/uso`, métricas da janela calculadas no domínio a partir das linhas diárias. **Três partes não atravessam:** a lista de pessoas com nome e último acesso (FORA, ADR 0013 §2), "rotinas cumpridas" e "pacientes recaptados" (FORA, ADR 0014: sem fonte). "Faltas recontatadas" fica oculta até o job escrever a coluna (hoje sempre 0, `uso-diario-cliente.ts:39-41`), porque mostrar 0 mentiria. **M** | LGPD (ADR 0013 §2). Dinheiro: `receita_registrada` redigida. |
| **V13** Documentos | Primeiro os materiais (personalizados e do programa, ver X2). Depois os documentos agrupados por categoria (contrato, diagnóstico, plano de ação, política e processo, relatório, material de apoio, `L514`), com data, "Abrir" e "Excluir" (só diretoria). Ao adicionar: título, categoria, link, "aparece no espaço da cliente?" (`L1639-1645`, `F.doc` `L2764`). | **PARCIAL.** Tabela e leitura do portal existem (`documentos_carteira`, `0034:309-348`, com `visivel_portal`). Sem rota de escrita e sem tela interna (achado 6). | `POST`/`PATCH /v1/carteira/clientes/:id/documentos`. "Excluir" vira arquivar (regra 20). Auditoria por `registrar_auditoria_do_painel` (a tabela não tem `clinica_id`). **P** | Segurança: só URL `https`, validada no contrato. LGPD: a categoria "Diagnóstico" é um link para o Drive, não o conteúdo, e não reabre a ADR 0013 (o documento continua fora do sistema). |
| **V14** Reuniões | Linha do tempo: data, tipo (semanal, mensal, diagnóstico, avulsa, do Asana), saúde, quem registrou, participantes, chip "compartilhada com a cliente", alternar compartilhamento, "Editar e anexar", resumo, encaminhamentos, "X de Y tarefas da reunião concluídas", anexos. "Compartilhar todas" com confirmação. "Importar do Asana". **Registrar reunião**: cliente, data, tipo, participantes, o que foi visto, encaminhamentos (um por linha) com "Criar uma tarefa para cada linha" + responsável + prazo (padrão 7 dias), saúde da cliente depois da reunião (**atualiza a saúde do cliente**), compartilhar com a cliente (desmarcado), anexos (arquivo até 20 MB ou link do Drive). Excluir só a diretoria (`L1654-1713`, `L1813-1820`, `L2843-2844`). | **PARCIAL.** Tabela e leitura do portal existem (`reunioes_comerciais`, `0034:385-419`). Sem rota de escrita, sem tela interna, **sem flag de compartilhamento** (achado 5), sem tipo, participantes, saúde ou ligação com tarefas. | Migração *expand*: `tipo`, `participantes`, `saude_registrada`, `compartilhada bool NOT NULL DEFAULT false`, `asana_id`. A policy do portal passa a exigir `compartilhada` **por AND** (mesma forma de `visivel_portal`). `POST /v1/carteira/clientes/:id/reunioes` cria as tarefas dos encaminhamentos na mesma transação (`tarefas_internas.reuniao_comercial_id`). A saúde registrada entra na saúde derivada (PP-3). Anexos só por link nesta fase (D-6). Excluir vira arquivar. **M** | **Defeito a corrigir antes de qualquer escrita** (D-P1). LGPD: resumo de reunião com a clínica pode citar paciente. O padrão "não compartilhado" e um aviso no formulário ("não registre nome de paciente") reduzem o risco, mas a linha de retenção precisa existir antes da primeira escrita real. |
| **V15** Checklist do contrato | Lista ordenada por D+N com responsável, mensagem vinculada e "Abrir briefing" quando o item é de diagnóstico. "Gerar checklist de X" quando o cliente ainda não tem. Marcar aqui ou na rotina conclui nos dois (`L2620-2632`, `L2964`). | NÃO FEITO | Ver X3 e X5. **M** | — |
| **V16** Briefing | Lista de briefings do cliente com programa, data, progresso, pendências, transcrição e o índice do Mapa de Maturidade (`L2410-2416`). | FORA POR ADR 0013 §1 | Ver seção 6. | LGPD. |

---

## 6 · Briefing, Mapa de Maturidade, transcrição e IA (`L2027-2416`)

**Estado do conjunto: FORA POR ADR 0013 §1** ("`diagnosticos` e `transcricoes` ficam fora de TODOS os épicos, G1 a G6"). Inventario o que existe, para que a decisão (D-5) seja tomada sabendo o tamanho.

| ID | O que o protótipo faz | Observação para a decisão |
|---|---|---|
| **B1** Roteiro de briefing | Versão `2026.10b`. Quatro programas (Comercial, Financeiro, Operações, Gestão). Blocos com objetivo e frase de transição, perguntas tipadas (curto, texto, número, moeda, percentual, data, escolha, múltipla, sim/não, nível de 0 a 3 com a ação recomendada para 0 ou 1). Algumas perguntas preenchem o cadastro do cliente. O programa Gestão tem os cinco pilares do Mapa de Maturidade (`ROTEIRO` `L2034-2134`, `BLOCOS_GESTAO` `L2138-2184`). | **O roteiro em si é conteúdo estático, sem dado pessoal.** Mostrá-lo no Método Firmare e ensaiar (B9, X1) não grava resposta. Na minha leitura isso **não** é a coleção `diagnosticos` e não reabre a ADR 0013. Confirmar com `especialista-lgpd-saude` no gate da onda. |
| **B2** Conduzir o briefing | Respostas salvas durante a digitação. "Perguntar depois" com quem responde (cliente ou Firmare). "Não se aplica". Índice lateral com progresso por bloco. Pausar e continuar. Concluir e reabrir. Trocar o programa (`vDiag` `L2231-2256`, `campoQ` e `ctlQ` `L2213-2230`). | As respostas incluem dado da médica (filhos, nascimento, formação), números da clínica, nomes e perfil das colaboradoras e "Impressões de quem conduziu (uso interno)". É dado pessoal de terceiros. Não é dado de saúde em si, **mas o texto livre pode citar paciente**. |
| **B3** Pendências | As perguntas "para depois" viram uma mensagem de WhatsApp para a cliente e tarefas para a Firmare, com responsável. Responder fecha a tarefa sozinho (`L2328-2341`, `L2396-2398`). | — |
| **B4** Encaminhamentos ao concluir | Cria a tarefa "Receber o acesso ao [sistema]", a tarefa da reunião com o time, grava o dia da reunião semanal no cliente (e passa a gerar as reuniões a partir da data) e registra uma reunião do tipo diagnóstico (`L2342-2356`, `L2937-2943`). | — |
| **B5** Levar respostas ao cadastro | Nome, WhatsApp, nascimento, cidade, especialidades, parceiros e área de foco vão para o cadastro do cliente (`L2365-2370`). | — |
| **B6** Transcrição | Colar o texto ou anexar `.txt`, `.vtt`, `.srt` ou `.md`, com limpeza de marcação de legenda e corte em cerca de 240 KB (`L2399-2409`). | **A transcrição é o motivo central da exclusão:** fala gravada de equipe clínica. |
| **B7** Preencher com IA | Manda as perguntas vazias e a transcrição para um modelo e preenche só o que ficou em branco, marcando "sugerido pela IA, revisar" (`L2371-2395`). | **Na versão publicada (Supabase) a IA não funciona:** o *stub* de `window.claude` devolve `null` para tudo que não é banco, usuário ou arquivos (`sb:L331`), e a tela responde "A IA não está disponível nesta visualização" (`L2373`). Só roda dentro do ambiente de artefato do Claude. **É simulada para todos os efeitos de produção.** Construir de verdade significa enviar dado pessoal a um operador estrangeiro (transferência internacional, art. 33). |
| **B8** Mapa de Maturidade | Índice geral de 0 a 100, faixa (reativa, em construção, estruturada), radar dos cinco pilares, leitura em texto, citações "Na voz de quem lidera", três prioridades do mês, pontos de atuação imediata, plano de implantação em quatro semanas, reaplicação comparando com o mapa inicial e "Copiar texto do relatório" (`L2257-2327`). | É derivado das respostas, então segue a mesma decisão. As citações são texto literal da médica. O cálculo do índice é média de inteiros (arredondamento a definir com o `validador-numeros`). |
| **B9** Ensaio | Conduzir o roteiro sem cliente, sem salvar e sem gerar tarefa, com "Preencher com respostas de exemplo" (`L2900-2902`). | Não grava nada. Mesma leitura de B1. |
| **B10** Avisos de briefing | "Briefing ainda não realizado" na visão do cliente, "Briefings a fazer" no painel, briefing do lead que acompanha a conversão (`L1403-1408`, `L1898-1902`, `L2961`). | Seguem B2. |

**O que reabrir a ADR 0013 §1 exigiria, sem decidir aqui:** (a) avaliação própria de `especialista-lgpd-saude` sobre a coleção concreta, não por analogia com metas e campanhas; (b) base legal nomeada por sub-finalidade (provavelmente art. 7º, V, execução do contrato de consultoria, para as respostas estruturadas) e linha de retenção em `retencao.md`; (c) decisão sobre o texto livre: proibir, limitar ou avisar contra nome de paciente; (d) para a transcrição, além disso: consentimento ou ciência de quem foi gravado, prazo curto de retenção da transcrição bruta e registro de acesso; (e) para a IA, além disso: contrato com o provedor como operador, cláusula de transferência internacional e garantia de não-treinamento; (f) uma nova ADR que substitua a 0013 §1. As alternativas e a minha recomendação estão em D-5.

---

## 7 · Metas (`vMetas` e companhia, `L730-827`)

**Estado do conjunto: PARCIAL.** O G3 entregou indicador, lançamento e meta, com progresso derivado do último lançamento e status `em_andamento`/`concluida` (`0031:44-247`). O protótipo tem um modelo de meta bem mais rico.

**Achado de vocabulário:** o `checkin` do protótipo (`{meta_id, semana, valor, por}`, `L801`) é o lançamento semanal de uma meta. Não é o nosso `Checkin interno` (qualitativo, G5). Como toda `Meta comercial do cliente` nossa tem um `Indicador da carteira`, o checkin do protótipo é exatamente um `Lançamento de indicador` com referência na segunda-feira da semana. **Proponho esse mapeamento.** Ele não reabre o G5 e não cria um terceiro conceito. Fica escrito no `CONTEXT.md` para ninguém modelar "checkin de meta" de novo.

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **M1** Painel de metas | Todas as clientes ativas: cinco KPIs clicáveis que filtram (abaixo do ritmo, incluindo prazo vencido · atenção · no ritmo · atingida · sem lançamento), filtro por responsável, um cartão por cliente ordenado pela pior meta, "Lançar metas da semana" por cliente e um aviso com as clientes sem meta (`L806-825`). | NÃO FEITO | `GET /v1/carteira/metas/painel`, com avaliação no servidor. Menu "Metas" (T4). **M** | Dinheiro: valores de meta em R$ redigidos sem `valores`. Regra 6 da ADR 0013 para escopo de grupo. |
| **M2** Modelo da meta | Título, indicador, unidade (R$, %, un, dias), **tipo** (mensal, que recomeça todo mês · com prazo, que acumula até a data final), **agregação** (soma das semanas · média · último valor), valor no início, alvo, sentido, **fonte** (lançamento semanal · coluna da planilha na última semana, média ou soma de 4 · último lançamento de um indicador), início, prazo, status (em andamento, atingida, não atingida, cancelada) (`F.meta` `L2756-2761`, `TIPO_META` `L642`). | **PARCIAL.** Temos título, indicador, sentido, alvo, valor inicial, início, prazo, status com dois valores (`0031:184-214`). Faltam tipo, agregação, fonte, unidade "dias" e os status "não atingida" e "cancelada". | Colunas `tipo`, `agregacao`, `fonte` e o status ampliado. A unidade "dias" entra no conjunto fechado do indicador (inteiro). A fonte "planilha" espera G3/G4 da seção 14. Criar a meta pode criar o indicador junto, para não exigir dois formulários (o caminho de dois toques ganha). **M** | Dinheiro: a agregação "média" divide dinheiro (média de faturamento semanal). Precisa de regra de arredondamento definida e de property-based test (`validador-numeros`). "Soma" entre semanas é `Dinheiro.somar`. |
| **M3** Avaliar a meta | Mensal com soma: o esperado é semanas passadas / semanas do mês, e "no ritmo" é progresso ≥ 90% do esperado, "atenção" ≥ 70%, senão "abaixo". Mensal com média ou último: "na meta" ou "atenção" (≥ 90%) ou "abaixo". Com prazo: progresso (atual − inicial) / (alvo − inicial), limitado a 120%, contra o tempo decorrido do prazo, e "prazo vencido". Histórico dos três meses anteriores em %. Barras por semana do mês. "Falta lançar a semana de dd/mm" depois do dia da reunião (`L751-792`, `semanaDaReuniao` `L750`). | NÃO FEITO (o nosso só mostra o último lançamento, `page.tsx:450-459`) | Função pura `avaliarMeta` em `packages/domain`, com property-based test das bordas (alvo igual ao inicial, sentido "menor melhor", valor zero). A tela só formata (design.md §5). **M** | Dinheiro e quantidade: percentuais e razões calculados com inteiros (centésimos) e regra de arredondamento declarada. Nunca no front. |
| **M4** Lançar metas da semana | Escolhe a semana (atual e 4 anteriores, padrão: a semana da reunião). Um campo por meta ("realizado na semana" ou "valor da semana"), com o alvo e o acumulado como ajuda, e "Combinados da reunião", que vira uma reunião registrada. Relançar a mesma semana atualiza. Conclui a tarefa de reunião de metas que abriu o formulário (`L793-805`). | NÃO FEITO (há lançamento por indicador, um por vez) | `POST /v1/carteira/clientes/:id/metas/lancamento-semanal`: upsert dos lançamentos (o mesmo `UNIQUE (indicador_id, referencia)`, regra 26), cria a reunião (V14) e conclui a tarefa, tudo em uma transação. **M** | Auditoria: relançar audita de→para (critério 2.1.3 do G3, já existe). |
| **M5** Fonte automática | A meta lê da planilha (`pl:frente|métrica|última, média4 ou soma4`) ou do último lançamento de um indicador (`L731-743`). | NÃO FEITO | "Indicador" é trivial no nosso modelo (a meta já tem indicador). "Planilha" depende da seção 14. **P** + seção 14 | — |
| **M6** Meta ligada à reunião fixa | A semana de referência é a da reunião fixa do cliente (`semanaDaReuniao` `L750`), e a rotina "reunião semanal de metas" gera a tarefa no dia da reunião (`L855`). | NÃO FEITO | Depende de C3 (`reuniao_dia_semana`) e R11. **P** | — |

---

## 8 · Campanhas (`vCampanhas`, `L1963-2001`, e a aba do cliente)

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **K1** Tela comparativa | KPIs: valor gerado no mês (e o anterior), total no período (no mês e continuado), retorno sobre o investimento, campanhas ativas e quantas clientes atualizam sozinhas. Tabela cliente × meses, continuado, total, retorno e a campanha que mais gerou. "Campanhas que mais geraram valor" (top 6). "Por tipo de campanha" × meses. "Atualização automática pela Gestão de Rotina" com o estado de cada cliente (`L1963-2001`). | **NÃO FEITO.** Só existe a leitura do portal, filtrada para `metrica='receita'` e com supressão (`leitura-do-portal.service.ts:149-155`). | Menu "Campanhas". `GET /v1/carteira/campanhas?de&ate`. **A supressão por N pequeno (menos de 5 orçamentos pagos agrupa em "Outras campanhas") vale também aqui** (ADR 0013 §4: é o painel da carteira). Para escopo de grupo, linha por clínica e soma explícita das linhas (ADR 0013 §6). **"Continuado" e "retorno" aparecem em branco ou indisponíveis** (ADR 0013 §5) até existir a fonte (D-9). **M** | Dinheiro: receita por campanha é dinheiro real da clínica (ADR 0011 §3). LGPD: N pequeno. |
| **K2** Período | Este mês · 3 · 6 · 12 meses · este ano · ciclo do contrato · escolher (de-até por mês) (`L1459-1476`). | NÃO FEITO | Janela semiaberta `[início, fim)` em instantes, bordas no fuso da Firmare (regra 23). **P** | Tempo. |
| **K3** Campanha manual | Nome, tipo (para comparar mês a mês, padrão "Aniversariantes"), mês, métrica, meta, resultado, valor gerado no mês, valor continuado, investimento, status (planejada, ativa, encerrada), observações (`F.campanha` `L2762`). | **NÃO FEITO** (a tabela tem `origem='manual'` mas não há rota de escrita, achado 6). | `POST`/`PATCH /v1/carteira/clientes/:id/campanhas` só para cliente sem clínica ligada (ADR 0011: "uma tela, duas fontes"). Colunas novas em `campanhas_carteira`: `categoria` (a mesma de `campanhas.categoria` da clínica, `0020:55`), `status`, `observacoes`, e `investimento_centavos` lançado à mão (D-9). `receita_continuada` não entra. **M** | Dinheiro: `investimento` é `Dinheiro` em centavos, e o retorno é razão (arredondamento declarado). |
| **K4** Sincronizar com a FIR Clinic | "Código da Gestão de Rotina" no cadastro. "Atualizar agora". Na versão publicada: "A leitura automática das campanhas da FIR Clinic ainda não está ligada" (`L1453`, `L2000`, `L2946-2951`). | **NÃO FEITO.** A tabela está pronta para a sincronização (`campanha_origem_id`, índice único, `0028:92-127`), e o job não existe (achado 7). | Job diário como `fir_app`, uma clínica por vez, copiando o que `CampanhasService` já calcula (receita, orçamentos pagos, categoria, período, status), upsert por `campanha_origem_id`. Nunca recalcular (ADR 0013 §5). Idempotente, testado com três execuções. **M** | **No protótipo é simulado:** `sincronizar` soma valores com `Math.random` (`L2949-2950`), e a versão publicada declara a leitura desligada. Regra de transporte: centavos como string, nunca `number` (ADR 0013 §5). |

---

## 9 · Resumo semanal (`vResumo`, `L2004-2025`)

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **S1** Resumo para copiar | Texto pronto para o WhatsApp da equipe ou da liderança: carteira (ativos por saúde, MRR com `valores`), clientes em risco com o resumo e o encaminhamento da última reunião, plano de ação (concluídas em 7 dias, atrasadas e onde), campanhas ativas com % da meta, equipe (pendentes e vencidas por pessoa) e a prioridade da semana. "Copiar texto" (`L2004-2025`). | NÃO FEITO | `GET /v1/carteira/resumo-semanal` devolvendo o texto montado por função pura em `packages/domain`, com a redação aplicada **antes** de montar o texto (o MRR some sem `valores`, como no protótipo, `L2011`). **P** depois de C3, V8, V14 e K1 | Segurança: texto livre com valores. A redação precisa acontecer na montagem, porque o `RedacaoInterceptor` não enxerga dinheiro dentro de uma string. Teste obrigatório: sem `valores`, nenhum "R$" no texto. |

---

## 10 · Prospecção (`vProspeccao` e companhia, `L2418-2565`)

**Estado do conjunto: PARCIAL.** Temos lead, etapas, arquivar, interações e conversão (`0032:289-381`, `leads/page.tsx`). Faltam boa parte dos campos, a inteligência de sinais, os roteiros e as indicações.

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **L1** Oportunidades | Resumo (em andamento, potencial por mês com `valores`, % de conversão). "Contatos recomendados". Funil clicável por etapa com contagem. Tabela: médico (com ponto de alerta), origem e quem indicou, etapa, temperatura, interesse e potencial, último contato, botão de WhatsApp (`L2473-2489`). | **PARCIAL.** Seções empilhadas por etapa, sem potencial, conversão, alerta nem último contato. | `GET /v1/carteira/leads` com os campos de L4 e o sinal calculado no servidor. Conversão = ganhos / (ganhos + perdidos), calculada no servidor. **P** | Dinheiro: potencial é `Dinheiro` e redigido. |
| **L2** Sinais | Agora: contato combinado vencido · contato combinado para hoje · indicação com 2 dias ou mais sem contato ("Indicação esfria rápido") · proposta há 5 dias ou mais sem retorno. Hoje: indicação nova. Esta semana: sem interação há 10 dias e sem próximo passo · proposta há 3 dias. Peso extra para temperatura quente e para indicação de cliente da carteira. Cada sinal sugere o roteiro (`sinal` `L2422-2435`). | NÃO FEITO | Função pura `sinalDoLead` em `packages/domain`, datas do servidor (regra 24). Badge no menu (T4) e painel (P9). **P** | — |
| **L3** Ficha do lead | Cabeçalho com etapa, temperatura, origem e indicação. Ações: WhatsApp, registrar contato, briefing, editar. Sinal em destaque. Painel do roteiro. Histórico de contatos. Dados (WhatsApp com copiar, Instagram, cidade, recebida em, interesse, potencial, próximo contato, responsável, observações). "Virou cliente" e "Marcar como perdido", ou "Abrir cadastro do cliente" (`L2490-2513`). | NÃO FEITO (a lista tem ações inline) | `GET /v1/carteira/leads/:id` e uma tela de ficha. O botão "Briefing" fica de fora (B, D-5). **M** | — |
| **L4** Campos do lead | Nome do médico, especialidade, clínica, cidade, WhatsApp, Instagram, origem (6, `L520`), "indicado por cliente da carteira" (escolher o cliente), "quem indicou, se não foi cliente", etapa, temperatura, produto de interesse, valor estimado por mês (com `valores`), recebida em, próximo contato, responsável, observações (`fLead` `L2554-2558`, `leadsExemplo` `L523`). | **PARCIAL.** Temos nome, origem, etapa, temperatura, produto de interesse, próximo contato e responsável (`0032:289-319`, `CriarLeadEntrada`). Faltam especialidade, clínica, cidade, WhatsApp, Instagram, indicador (cliente ou texto), valor estimado, data de recebimento editável e observações. Sem edição de lead. | Migração *expand* com essas colunas: `cliente_indicador_id` com FK para `clientes_carteira` e validação de mesmo grupo (ADR 0016 §2), `valor_estimado_centavos`. `PATCH /v1/carteira/leads/:id`. **P** | LGPD: WhatsApp e Instagram de médico prospectado são dado pessoal sem contrato ainda. Base legal é o legítimo interesse (art. 7º, IX), com direito de oposição e prazo de retenção para lead perdido ou arquivado. Linha nova em `retencao.md` **antes** da migration. Dinheiro: valor estimado redigido. |
| **L5** Registrar contato | Data, canal (WhatsApp, ligação, reunião, e-mail, presencial), o que foi conversado, **etapa depois do contato**, temperatura e próximo contato (padrão: 5 dias para proposta, 7 para o resto) em um formulário só (`L2559-2565`). | **PARCIAL.** A interação tem canal e nota (`CriarInteracaoDoLeadEntrada`). Etapa e próximo contato são outra chamada. | `POST /v1/carteira/leads/:id/contato`: interação + etapa + temperatura + próximo contato em uma transação. É o caminho de um toque que evita o lead esquecido. **P** | — |
| **L6** Virou cliente | Abre o cadastro de cliente já preenchido com o lead. Ao salvar: cria o cliente, marca o lead como ganho, leva os briefings do lead, cria o benefício de indicação pendente e a tarefa "Aplicar benefício de indicação" para a diretoria, registra "Contrato fechado" no histórico, aplica o checklist e abre a ficha no checklist (`L2961-2963`). | **PARCIAL.** A conversão cria o cliente com produto "A definir no onboarding", status onboarding e sem clínica (`prospeccao-carteira.service.ts:164-185`). Sem o formulário de cadastro, sem benefício, sem checklist. Provável defeito para escopo geral (achado 4). | O mesmo `POST` de C4 com `lead_id`, na mesma transação que fecha o lead. Benefício gerado só se o indicador for cliente da carteira (o nosso benefício é de um `Cliente Firmare`). **M** | Dinheiro: benefício (ver L12). Toca D-4 (grupo do cliente convertido). |
| **L7** Marcar perdido | Motivo obrigatório e "tentar de novo em" opcional, que move para "Em espera" com próximo contato em vez de perder (`L2960`). | **PARCIAL.** O motivo obrigatório existe. Falta o "tentar de novo". | Opção no mesmo formulário. **P** | — |
| **L8** Editar e excluir | Editar todos os campos. Excluir apaga o lead (`L2958`). | **PARCIAL.** "Arquivar" existe e é o certo (regra 20, ADR 0016). Falta editar. | Ver L4. **—** | — |
| **L9** Roteiro na ficha | Chips com os roteiros. Mensagem pronta com variáveis (`{nome}` como "Dra. Fulana", `{indicador}`, `{remetente}`, `{produto}`, `{beneficio}`, trecho `[[…]]` que só aparece se as variáveis estiverem preenchidas), "Enviar pelo WhatsApp", "Copiar" e o passo a passo ao lado (`L2438-2453`, `L2514-2525`). Clicar no WhatsApp abre "Registrar contato" já preenchido (`L2796`). | NÃO FEITO | Templates e preenchimento em função pura (`preencherMensagem`). Envio por `wa.me` (W). Depois do clique, abrir o L5 já preenchido (o protótipo assume que enviou: aqui o formulário pede confirmação, porque abrir o WhatsApp não prova que a mensagem saiu). **M** | — |
| **L10** Mensagens e roteiros | Oito roteiros padrão (primeiro contato, marcar reunião, confirmar, roteiro da reunião, acompanhar proposta, objeções, retomar, agradecer indicação). Diretoria edita, cria e exclui (`L2526-2532`, `roteirosPadrao` `L534-560`). | NÃO FEITO | Tabela `roteiros_comerciais` (já prevista no plano §3), semente (T8), edição restrita por permissão (T1). **P** | — |
| **L11** Quem indica | Ranking de quem indicou (cliente da carteira ou pessoa): indicações, em andamento, viraram clientes, conversão e benefícios (concedidos e pendentes) (`L2533-2548`). | NÃO FEITO | Agregado no servidor a partir de L4. **P** | — |
| **L12** Benefícios | Pendentes: quem indicou, quem foi indicado, data do contrato, descrição, "Agradecer" (WhatsApp com o roteiro de agradecimento) e "Marcar como concedido" (diretoria). Concedidos. A regra atual com "Alterar regra" (`L2539-2547`, `L2859`). | **PARCIAL.** `beneficios_de_indicacao` existe com `percentual_centesimos` e é consumido pelo job de cobrança na competência seguinte (`0031:261-296`, `gerar-cobrancas.ts`). Só existe `POST` manual. Sem tela, sem ligação com o lead, sem "agradecer". No protótipo, "concedido" é marcado à mão. No nosso, o consumo é automático pela cobrança. | Colunas `lead_comercial_id`. Tela de benefícios lendo `consumido_em` como "concedido" (aplicado na cobrança da competência X). **Não** criar um "marcar concedido" manual que divirja do consumo automático. Divergência pequena do protótipo, a favor da regra (o desconto aplicado é o registro). **P** | Dinheiro: as quatro decisões provisórias da ADR 0015 ainda esperam o dono (D-8). |
| **L13** WhatsApp abre o registro | Ver L9. | NÃO FEITO | Ver L9. | — |

---

## 11 · FIR Clinic, painel de uso (`vFirClinic`, `L1531-1606`)

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **F1** Tela FIR Clinic | Clínicas com FIR Clinic (têm código, contratam o Programa de Gestão FIR ou têm dados). KPIs: quantas, uso em dia, uso irregular, sem uso ou muito baixo ("vira tarefa para ligar"). Tabela: situação, dias com uso / dias úteis, pessoas ativas / cadastradas, tarefas no prazo (e variação contra a semana anterior), vencidas, rotinas cumpridas, contatos (e variação), orçamentos pagos / enviados, gráfico de 30 dias. Regra de situação: 3 dias úteis seguidos sem uso ou 2 dias ou menos de uso na semana é crítico, ≥ 4 dias e ≥ 80% no prazo é bom, senão atenção (`L1556-1606`). "Ver com dados de exemplo" quando não há dados reais. | **NÃO FEITO** na tela. **FEITO** na coleta: `uso_diario_cliente` é populado por job diário idempotente (`0028:23-87`, `uso-diario-cliente.ts`). | `GET /v1/carteira/uso?semana`, métricas da janela e situação calculadas no domínio a partir das linhas diárias (os dias úteis, a janela de 7 dias e a semana anterior no fuso da clínica). Coluna "rotinas cumpridas" **não aparece** (ADR 0014). Sem "dados de exemplo" no produto. Lista só clínicas com `clinica_id` ligado. **M** | LGPD: só contagens (ADR 0013 §2). Registro de acesso por clínica (ADR 0013 §7). |
| **F2** Relatório de uso | Ver V12. | NÃO FEITO | Ver V12. | — |

---

## 12 · Método Firmare (`vMetodo`, `L2674-2717`)

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **X1** Roteiros de briefing | Lê o roteiro de cada programa (blocos, objetivo, frase de transição, perguntas com tipo, opções, níveis e ação recomendada, marcação "cadastro" e "pilar do Mapa de Maturidade") e "Ensaiar este roteiro" (`L2682-2686`). | NÃO FEITO | Conteúdo estático versionado (semente). O ensaio é tela sem gravação. **M** | Ver B1. Construir só a leitura e o ensaio não grava resposta. Confirmar no gate. |
| **X2** Biblioteca de materiais | Filtro por programa e "Personalizados". Cartão com tipo (planilha, documento, script, modelo de mensagem, apresentação), programas, "uso interno", "personalizado". Abrir link, copiar texto. Cadastro: título, exclusivo de uma cliente?, tipo, quem pode receber (pode ir para a cliente · só uso interno), programas (checkbox), link (dica do `/copy` para planilha Google), texto, para que serve. **Na ficha do cliente:** personalizados, materiais do programa da cliente com "Enviar para a cliente" (WhatsApp com o link e o texto, e registro de "Enviado em"), e os de outros programas como "porta natural para a próxima contratação" (`L2687-2717`, `L2803-2810`). | **PARCIAL.** `materiais_carteira` existe sempre ligado a um cliente, sem programa, texto ou "uso interno" (a biblioteca geral foi cortada de propósito, `0034:299-307`). Sem escrita e sem tela. O portal lê. | *Expand*: `cliente_carteira_id` vira nullable (biblioteca geral), `programas text[]`, `texto`, `uso_interno bool` (a policy do portal exige `NOT uso_interno`). Tabela `envios_de_material` (cliente, material, quando, por). O portal mostra os do programa da cliente e os personalizados, como faz o protótipo (`portal:L131-136`). A policy de leitura do portal para `cliente_carteira_id IS NULL` filtra por programa sem abrir outras clientes. **M** | Segurança: a policy nova para material geral precisa de teste de isolamento (ADR 0018). O "programa" da cliente deriva de `area_foco`/`produto` (`programaPadrao` `L2205`, `portal:L9`), então depende de C3. |
| **X3** Checklists dos programas | Um checklist por produto, ou por produto e frente (por exemplo "Acelerador FIR · Comercial", 27 itens), que tem precedência sobre o geral. Item: D+N dias depois do início, título, quem executa (responsável pela carteira, diretoria, comercial, administrativo, financeiro), ação (abre o briefing), mensagem vinculada. Editar o item propaga título e mensagem para as tarefas ainda abertas desse contrato. "Mudanças valem para os próximos clientes" (`L2661-2665`, `fItem` `L2785-2786`, `L2879-2882`, `L2945`). | NÃO FEITO | Tabelas `modelos_de_checklist` e `itens_de_modelo`, sem `clinica_id`, escrita por permissão (T1), auditoria pelo painel. A propagação para tarefas abertas é `UPDATE` auditado por item. Semente com os seis modelos (`L566-622`). **M** | O item com ação "diagnóstico" depende de D-5. Sem briefing, ele vira tarefa comum. |
| **X4** Mensagens automáticas | Sete modelos (lembrete de pagamento, fluxo de caixa, DRE, formulário semanal ao parceiro, cobrança do formulário, acessos da cliente, relatório semanal) com variáveis. Mostra onde cada um é usado (rotinas e itens de checklist). Diretoria edita e cria (`L2658-2660`, `mensagensPadrao` `L834-841`, `usoMensagem` `L2568-2572`). | NÃO FEITO | Tabela `mensagens_comerciais` (já prevista no plano §3) por chave, semente, preenchimento em função pura. **P** | Dinheiro e segurança: as variáveis `{valor}` e `{pix}` só são preenchidas para quem tem `valores` (W1). |
| **X5** Aplicar checklist | Ao criar o cliente, cada item vira tarefa com prazo = início + D+N e responsável resolvido por "quem executa" (o responsável pela carteira, a primeira pessoa ativa do setor, ou a diretoria). Cliente migrado tem os itens vencidos marcados como feitos (`checklistDe` `L924-931`, `quemExecuta` `L918-923`, `L1739-1740`). | NÃO FEITO | Função pura de resolução de responsável (depende de `setor` em T1 e do responsável em C3). Tarefas com `modelo_item_id` para a propagação de X3. Idempotente por `(cliente, item)`. **M** | — |

---

## 13 · Mensagens de WhatsApp (transversal, `L2567-2610`)

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **W1** Montar a mensagem da tarefa | Preenche o modelo com responsável ("Dra. Fulana"), cliente, remetente, valor, vencimento, mês, mês de referência (o anterior), Pix, favorecido, os quatro links, pendências das frentes, parceiro, frente e link do formulário. Lista avisos do que falta no cadastro ("Falta cadastrar o link X", "Falta a chave Pix"). Escolhe o telefone: cobrança para pagamento, parceiro para formulário, senão o da cliente (`L2574-2592`). | NÃO FEITO | `GET /v1/carteira/tarefas-internas/:id/mensagem` devolvendo texto, avisos e telefone, montados no servidor com redação **antes** do preenchimento (mesma razão de S1). **M** | Dinheiro e segurança: sem `valores`, a mensagem de pagamento não pode ser montada com valor. O protótipo não protege isso (`L2586` usa `brl(c.valor_mensal)` sem `podeValores`). Teste obrigatório. |
| **W2** Modal de envio | Texto editável, avisos, "Enviar pelo WhatsApp" (`wa.me` com o texto editado), "Copiar". Clicar em enviar marca `msg_enviada` com a data (`L2602-2610`, `L2826-2828`). | NÃO FEITO | Modal no front. "Marcar como enviada" é um `POST` explícito (abrir o WhatsApp não prova o envio, ver L9). **P** | — |
| **W3** Formulários dos parceiros | Na tarefa de envio: um botão "Enviar formulário" por frente, e cada envio marca o item; com os quatro, a tarefa conclui. Na tarefa de validação: chip por frente com o estado da planilha e "Cobrar parceiro" para a frente não recebida; as frentes não marcadas entram como pendentes na mensagem do relatório semanal (`envioHTML` `L1922-1928`, `frentesHTML` `L1929-1948`, `L2837`). | NÃO FEITO | Depende de R5 (itens), C3 (parceiros), X4 (modelos) e da seção 14. **M** | Integração (seção 14). LGPD: telefone de parceiro. |
| **W4** Outros envios | Parabenizar aniversário, enviar acessos, enviar material, pendências do briefing, agradecer indicação, primeiro contato com lead (`L1912`, `L2596`, `L2806`, `L2925-2932`, `L2538`). | NÃO FEITO | Cada um entra com o seu módulo, reusando W2. **P** cada | — |

**Integração real ou simulada:** é real e trivial. O protótipo só monta um link `https://wa.me/55…?text=…` (`waHref` `L2447`) que abre o WhatsApp no aparelho de quem clica. Não há API do WhatsApp, nenhum dado sai do servidor para terceiro, e não há confirmação de entrega.

---

## 14 · Planilhas de indicadores do Google (`L631-702`, `L1949-1960`, `sb:L278-313`)

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **G1** Estrutura das abas | Quatro abas, uma linha por semana: Financeiro (faturamento, recebido, despesas, análise; marcada como "estrutura da aba a confirmar"), Comercial (leads e convertidos por site, Google e Instagram, frios, análise), Tráfego pago (campanhas, dados Google e Meta, análise), Marketing (seguidores, criativos, melhor criativo, alcance). Métricas derivadas por aba (taxa de conversão etc.) (`PLANILHA` `L632-641`). | NÃO FEITO | Configuração declarativa versionada. A aba Financeiro espera a confirmação de estrutura que o próprio protótipo pede. **P** | — |
| **G2** Validar a semana | Por frente: "não recebida" se não há linha da semana (tolerância de −2 a +4 dias), "atenção" se a semana aparece mais de uma vez, data sem ano, mês que não bate, campo obrigatório vazio, não-número, ou valor fora do padrão (mais de 3× ou menos de ¼ da mediana das 8 semanas anteriores, quando a mediana é ≥ 5) (`validarFrente` `L688-702`). | NÃO FEITO | Função pura em `packages/domain`, testada com as situações do exemplo (`L677-681`). **P** | Quantidade: a mediana e as razões em inteiros. |
| **G3** Ler a planilha | **Demo:** `lerPlanilha` simula parceiros enviando e a Manu corrigindo, com `Math.random` (`L1949-1960`). **Publicada:** chama a função `planilhas` do Supabase com o link da planilha, que devolve por aba as últimas linhas com carimbo, semana e perguntas preenchidas de total, com cache de 10 minutos, e a tarefa mostra "Nova linha em dd/mm às hh:mm · 7 de 8 perguntas" (`sb:L286-313`). | NÃO FEITO | **Seam `LeitorDeIndicadores`**, já previsto no plano §4 só para o dia em que a leitura fosse automática. Implementação Google Sheets por conta de serviço, job agendado gravando um fato por `(cliente, frente, semana)`, idempotente, nunca consulta ao vivo. **G** | **Integração real na versão publicada, mas o código da função `planilhas` não veio na pasta.** Não sei como ela autentica no Google nem o que faz com os dados. Pedir à PO antes de desenhar (D-7). Segurança: credencial Google no servidor, escopo só leitura. LGPD: faturamento da clínica é dado de negócio (art. 7º, V). |
| **G4** Onde aparece | Painel "Planilhas da semana" (P7), aba Indicadores pela planilha (V11), frentes na tarefa de validação (W3) e fonte de meta (M5). | NÃO FEITO | Consome G3. **M** | — |

---

## 15 · Mensalidades (`L703-729`, `L2831-2833`)

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **$1** Situação da mensalidade | Vencimento no dia do cliente, limitado ao último dia do mês. Pago em dd/mm · vence hoje (e lembrete enviado) · vencida há N dias · lembrete enviado em · lembrete atrasado, hoje ou em dd/mm · "lembrete será criado" (`statusMensalidade` `L708-718`). | **PARCIAL.** A cobrança tem status aberto, pago ou cancelado e o vencimento fixo no dia 10 (achado 8). | Vencimento por `dia_vencimento` com a regra 25 em `packages/domain` (property-based, meses de 28 a 31 dias). Situação calculada no servidor com a data do servidor (regra 24). **P** depois de C3 | Dinheiro e tempo. Mudar o vencimento não muda o valor nem a chave da cobrança (`gerar-cobrancas.ts:44-50` já prevê). |
| **$2** Marcar pago e desfazer | "Marcar pago" grava a data de hoje no mês. "Desfazer" apaga e reabre o lembrete marcado como pago antes (`L2831-2833`). | **FEITO** (`POST cobrancas/:id/marcar-pago` e `desfazer-pago`, com trilha). | — | O nosso registra quem e quando, o protótipo não. |
| **$3** Lembrete de pagamento | Rotina "vencimento", 3 dias antes, recuando para o dia útil, prioridade alta, com a mensagem de pagamento (valor, vencimento, Pix, favorecido) para o WhatsApp de cobrança (`L856`, mensagem `L835`). | NÃO FEITO | R10 e R11 (frequência vencimento), W1 com redação. **P** depois deles | Dinheiro: sem `valores`, a tarefa existe mas a mensagem com valor não (W1). |
| **$4** Painel do mês | "Mensalidades de [mês]": recebido de total (barra), antecedência do lembrete e tabela cliente, vencimento, valor, situação, "Lembrete", "Marcar pago" ou "Desfazer". Só com `valores` (`painelMensalidades` `L719-729`). | **PARCIAL.** As cobranças aparecem na ficha de cada cliente (`page.tsx:171-192`), sempre redigidas (achado 1). Sem visão do mês da carteira inteira. | `GET /v1/carteira/cobrancas?competencia=` (a soma sai do mesmo array das linhas, ADR 0015 achado 1). Rota de editar a `mensalidade_centavos` com redação na entrada e na saída. **P** depois de T1 | Dinheiro: a regra 6 da ADR 0013 quebra por clínica para escopo de grupo. Gerar para clientes em onboarding segue o protótipo (`L880`) (PP-4). |

---

## 16 · Portal da clínica-cliente (`fg-portal.js`, `sb:L237-276`, `sb:L316-326`)

**Estado do conjunto: FEITO na base, PARCIAL no conteúdo.** Login, troca de senha, escopo cliente ou grupo, isolamento e registro de acesso existem (`0034`, `0035`, `0039`, `apps/api/src/carteira/portal/**`, `apps/web/src/app/portal/**`). O nosso portal já vai além do protótipo em dois pontos: mostra cobranças e campanhas (decisões do G6) e atende um grupo inteiro.

| ID | O que o protótipo faz | Estado | Como transpor (tamanho) | Bandeiras |
|---|---|---|---|---|
| **O1** Entrar | E-mail e senha, troca no primeiro acesso, "Esqueceu a senha? Peça à diretoria uma senha provisória nova" (`sb:L36-66`). | **FEITO** (com usuário em vez de e-mail, decisão do produto). | — | — |
| **O2** Cabeçalho e ciclo | "Olá, [primeiro nome da decisora]", texto de boas-vindas, cartão do ciclo: "Mês N de M" com barra e "De … a …", ou "Nº mês juntos" se recorrente, ou o programa (`portal:L101-113`, `portal:L153-154`). | **PARCIAL.** `mesesJuntos` a partir de `criado_em` (`leitura-do-portal.service.ts:2`), sem fim de ciclo nem o nome da decisora. | Usar `data_inicio`, `data_fim` e `decisor` (C3). **P** | — |
| **O3** Seus acessos | Os quatro links como cartões que abrem em nova aba (`portal:L116-117`). | **FEITO** (seção "Links de acesso", `portal/clientes/page.tsx:257`). | — | ADR 0017 §4: links inertes. |
| **O4** Metas | Cartão por meta: valor atual, alvo, barra (verde quando bateu), "Em [mês]" ou "Até [data]", "% do caminho" ou "Meta alcançada" ou "Aguardando o primeiro lançamento", ponto de partida, barras das últimas 10 semanas (`portal:L18-39`, `portal:L120-128`). | **PARCIAL.** Mostra a meta com o último lançamento (G3). Sem barra de progresso, histórico nem tipo mensal. | A mesma avaliação de M3, devolvida pelo servidor. **P** depois de M3 | Dinheiro: o portal vê o próprio dinheiro (ADR 0017 §3). |
| **O5** Materiais | Os do programa da cliente e os personalizados ("Feito para você"), com "Abrir" e "Ver texto" num modal com "Copiar texto" (`portal:L131-136`, `portal:L165-169`). | **PARCIAL.** Só os personalizados existem no modelo, sem texto (X2). | Ver X2. **P** depois de X2 | — |
| **O6** Documentos | Lista com título, categoria, data, "Abrir". Só os que não são internos (`portal:L139-140`). | **FEITO** na leitura (`visivel_portal`). Ninguém escreve (V13). | — | — |
| **O7** Reuniões | Só as compartilhadas: data, resumo, "Próximos passos", anexos (arquivo por link assinado de 10 minutos, ou link) (`portal:L143-146`, `portal:L171`). | **PARCIAL e divergente:** mostra todas (achado 5). Ninguém escreve (V14). | Ver V14 e D-P1. **P** | LGPD e segurança: compartilhamento opt-in. |
| **O8** Sua consultora | Cartão com a inicial, o nome da consultora e a reunião fixa (`portal:L160`). | NÃO FEITO | Nome do responsável Firmare (C3) e reunião fixa. Só o nome, nunca o telefone pessoal da colaboradora. **P** | LGPD: nome da colaboradora Firmare para a cliente (art. 7º, V). |
| **O9** Prévia "ver como a cliente" | `?preview=<cliente>` abre o portal com a faixa "Você está vendo o espaço exatamente como a cliente vê" (`sb:L325-326`, `portal:L150`). | NÃO FEITO | Ver V7. **M** | Ver V7. |
| **O10** Gestão dos acessos da cliente | Listar, gerar nova senha, remover (`sb:L245-276`). | **PARCIAL** (só criar). | Ver V7. | — |

---

## 17 · Integrações externas: o que é real no protótipo

| Integração | No protótipo | No nosso | Observação |
|---|---|---|---|
| Supabase (autenticação, banco schemaless `registros`, Realtime, armazenamento `anexos`, funções `acessos`, `planilhas`, RPC `portal_cliente` e `fg_valores`) | **Real** na versão publicada (`sb:L1-338`). O código das funções e RPCs **não veio** na pasta. | Substituído pela nossa API, Postgres com RLS e jobs BullMQ. | Não se constrói nada "do Supabase". Pedir o código das funções serve só para saber o comportamento (G3, O7). |
| Google Sheets | **Real** na publicada, pela função `planilhas` (não verificável). **Simulada** na demonstração (`L1949-1960`). | Não existe. | D-7. |
| Asana | Importação de **CSV**, real e local, sem API (`L1773-1812`). | Não existe. | C7. Só arquivo, nenhuma credencial. |
| WhatsApp | Link `wa.me`, real, sem API (`L2447`). | Não existe. | Seção 13. |
| IA (Claude) | Só dentro do artefato do Claude. **Indisponível na publicada** (`sb:L331`, `L2373`). | Não existe. | Fora por ADR 0013 §1 e por transferência internacional (D-5). |
| FIR Clinic → campanhas | **Simulada** (`L2946-2951`). Declarada "ainda não ligada" na publicada (`L1453`, `L2000`). | Tabela pronta, job não escrito (K4). | Vai ser a primeira vez que funciona de verdade. |
| FIR Clinic → uso diário | **Não existe** no protótipo: só dados de exemplo gerados na tela (`usoExemplo` `L1537-1550`). O texto diz "pedido feito ao programador" (`L1596`). | **Coleta FEITA** (G4). Tela não. | F1 e V12. |
| Anexos de arquivo | Upload até 20 MB (PDF, imagem, texto, vídeo) para o armazenamento do Supabase, link assinado de 10 minutos (`L1687-1696`, `sb:L175-194`). Na demonstração, só links. | Não há armazenamento de arquivo no repositório (não encontrei dependência de upload em `apps/api/package.json`). | D-6. |

---

## 18 · Tabela-resumo

| ID | Item | Estado | Tamanho | Bandeira principal |
|---|---|---|---|---|
| T1 | Perfis e permissões (papel, módulos, carteira, valores, setor) | PARCIAL | G | Segurança, regra 17, ADR 0011/0016 |
| T2 | Acessos da equipe | FEITO (falta mensagem pronta) | P | ADR 0011 |
| T3 | "Ver como" | NÃO FEITO (proponho não construir) | P | Segurança |
| T4 | Navegação com grupos e badges | PARCIAL | P | — |
| T5 | Configurações (Pix, favorecido, benefício) | NÃO FEITO | P | Dinheiro |
| T6 | Visual | FEITO | — | — |
| T7 | Sincronização ao vivo | Não se aplica | — | — |
| T8 | Conteúdo padrão (sementes) | NÃO FEITO | P por módulo | — |
| P1 | KPIs do painel | NÃO FEITO | P | Dinheiro |
| P2 | Saúde da carteira | NÃO FEITO | P | — |
| P3 | Equipe no painel | NÃO FEITO | P | — |
| P4 | Reuniões da semana | NÃO FEITO | P | — |
| P5 | Briefings a fazer | FORA POR ADR 0013 | — | LGPD |
| P6 | Aniversários | NÃO FEITO | P | LGPD |
| P7 | Planilhas da semana | NÃO FEITO | M | Integração |
| P8 | Mensalidades do mês (no painel) | NÃO FEITO | ver $4 | Dinheiro |
| P9 | Contatos recomendados (no painel) | NÃO FEITO | P | — |
| P10 | Próximas entregas do plano | NÃO FEITO | P | — |
| P11 | Atalhos | NÃO FEITO | P | — |
| R1 | Lista de tarefas | PARCIAL | P | — |
| R2 | Campos da tarefa | PARCIAL | P | — |
| R3 | Concluir com efeitos e recorrência | PARCIAL | M | Tempo |
| R4 | Transferir tarefa | NÃO FEITO | P | Segurança |
| R5 | Subitens | NÃO FEITO | M | — |
| R6 | Escolher tarefa ou rotina | NÃO FEITO | P | — |
| R7 | Carga da equipe | NÃO FEITO | M | Tempo |
| R8 | Redistribuir | NÃO FEITO | P | Segurança |
| R9 | Lista de rotinas | PARCIAL | P | — |
| R10 | Cadastro da rotina | PARCIAL | M | — |
| R11 | Geração de tarefas de rotina | PARCIAL | M | Tempo |
| R12 | Rotinas padrão | NÃO FEITO | P | — |
| R13 | Uso baixo vira tarefa | NÃO FEITO | P | LGPD |
| R14 | Lembrete some se já pagou | NÃO FEITO | P | — |
| C1 | Lista de clientes | PARCIAL | M | Dinheiro |
| C2 | Agrupar por produto e projeto | NÃO FEITO | P | Dinheiro |
| C3 | Cadastro do cliente | PARCIAL (13 de cerca de 45) | G | LGPD, dinheiro |
| C4 | Novo cliente | NÃO FEITO (só Operador, com clínica) | M | ADR 0016 |
| C5 | Editar e excluir | PARCIAL | P | Regra 20 |
| C6 | "Já é cliente" | NÃO FEITO | M | — |
| C7 | Importar reuniões do Asana | NÃO FEITO | M | Integração, LGPD |
| V1 | Abas da ficha | PARCIAL | M | — |
| V2 | Cadastro e ciclo na ficha | NÃO FEITO | P | — |
| V3 | Progresso do checklist | NÃO FEITO | P | — |
| V4 | Indicações feitas | NÃO FEITO | P | — |
| V5 | Acessos da cliente na ficha | PARCIAL | P | — |
| V6 | Última reunião e metas | NÃO FEITO | P | — |
| V7 | Espaço da cliente (acessos e prévia) | PARCIAL | M | Segurança |
| V8 | Metas e plano de ação (`Ação do plano`) | PARCIAL | M | — |
| V9 | Aba Campanhas | NÃO FEITO | M | ADR 0013 |
| V10 | Indicadores manuais | PARCIAL | M | Dinheiro |
| V11 | Indicadores pela planilha | NÃO FEITO | G | Integração |
| V12 | Uso da FIR Clinic (ficha) | NÃO FEITO (coleta feita) | M | LGPD |
| V13 | Documentos | PARCIAL (sem escrita) | P | — |
| V14 | Reuniões | PARCIAL (sem escrita, sem compartilhar) | M | LGPD, defeito |
| V15 | Checklist do contrato | NÃO FEITO | M | — |
| V16 | Briefing na ficha | FORA POR ADR 0013 | — | LGPD |
| B1–B10 | Briefing, Mapa de Maturidade, transcrição, IA | FORA POR ADR 0013 | G | LGPD |
| M1 | Painel de metas | NÃO FEITO | M | Dinheiro |
| M2 | Modelo de meta (tipo, agregação, fonte) | PARCIAL | M | Dinheiro |
| M3 | Avaliação de ritmo | NÃO FEITO | M | Dinheiro |
| M4 | Lançar metas da semana | NÃO FEITO | M | — |
| M5 | Fonte automática | NÃO FEITO | P + G | Integração |
| M6 | Meta ligada à reunião fixa | NÃO FEITO | P | — |
| K1 | Campanhas, tela comparativa | NÃO FEITO | M | Dinheiro, LGPD |
| K2 | Filtro de período | NÃO FEITO | P | Tempo |
| K3 | Campanha manual | NÃO FEITO | M | Dinheiro |
| K4 | Sincronizar com a FIR Clinic | NÃO FEITO | M | Dinheiro |
| S1 | Resumo semanal | NÃO FEITO | P | Segurança |
| L1 | Oportunidades | PARCIAL | P | Dinheiro |
| L2 | Sinais de contato | NÃO FEITO | P | — |
| L3 | Ficha do lead | NÃO FEITO | M | — |
| L4 | Campos do lead | PARCIAL | P | LGPD |
| L5 | Registrar contato com etapa | PARCIAL | P | — |
| L6 | Virou cliente | PARCIAL (provável defeito) | M | ADR 0016 |
| L7 | Perdido com "tentar de novo" | PARCIAL | P | — |
| L8 | Editar lead | PARCIAL | — | — |
| L9 | Roteiro na ficha | NÃO FEITO | M | — |
| L10 | Mensagens e roteiros | NÃO FEITO | P | — |
| L11 | Quem indica | NÃO FEITO | P | — |
| L12 | Benefícios | PARCIAL | P | Dinheiro |
| L13 | WhatsApp abre o registro | NÃO FEITO | ver L9 | — |
| F1 | Tela FIR Clinic | NÃO FEITO (coleta feita) | M | LGPD |
| F2 | Relatório de uso | NÃO FEITO | ver V12 | — |
| X1 | Roteiros de briefing (leitura e ensaio) | NÃO FEITO | M | LGPD (a confirmar) |
| X2 | Biblioteca de materiais | PARCIAL | M | Segurança |
| X3 | Checklists dos programas | NÃO FEITO | M | — |
| X4 | Mensagens automáticas | NÃO FEITO | P | Dinheiro |
| X5 | Aplicar checklist | NÃO FEITO | M | — |
| W1 | Montar mensagem da tarefa | NÃO FEITO | M | Dinheiro |
| W2 | Modal de envio | NÃO FEITO | P | — |
| W3 | Formulários dos parceiros | NÃO FEITO | M | Integração |
| W4 | Outros envios | NÃO FEITO | P cada | — |
| G1 | Estrutura das abas | NÃO FEITO | P | — |
| G2 | Validar a semana | NÃO FEITO | P | — |
| G3 | Ler a planilha | NÃO FEITO | G | Integração |
| G4 | Onde a planilha aparece | NÃO FEITO | M | — |
| $1 | Situação da mensalidade | PARCIAL (vence sempre no dia 10) | P | Dinheiro, tempo |
| $2 | Marcar pago e desfazer | FEITO | — | — |
| $3 | Lembrete de pagamento | NÃO FEITO | P | Dinheiro |
| $4 | Painel do mês | PARCIAL | P | Dinheiro |
| O1 | Entrar no portal | FEITO | — | — |
| O2 | Cabeçalho e ciclo | PARCIAL | P | — |
| O3 | Seus acessos | FEITO | — | — |
| O4 | Metas no portal | PARCIAL | P | — |
| O5 | Materiais no portal | PARCIAL | P | — |
| O6 | Documentos no portal | FEITO (leitura) | — | — |
| O7 | Reuniões no portal | PARCIAL e divergente | P | LGPD |
| O8 | Sua consultora | NÃO FEITO | P | LGPD |
| O9 | Prévia "ver como a cliente" | NÃO FEITO | M | Segurança |
| O10 | Gestão dos acessos da cliente | PARCIAL | ver V7 | — |

**Contagem (110 linhas, com B1–B10 contados como um bloco):** 6 FEITO · 34 PARCIAL · 66 NÃO FEITO · 3 FORA POR ADR (P5, V16, B) · 1 não se aplica (T7). O que é "PARCIAL" na maioria dos casos é a tabela pronta sem a tela ou a escrita, ou a tela pronta sem os campos.

---

## 19 · Ordem de construção em ondas

**Regra de paralelismo:** dentro de uma onda, cada ticket é dono de arquivos que nenhum outro ticket da mesma onda toca (`CLAUDE.md` §4). Os arquivos que vários querem tocar viram um ticket próprio, que vem **antes**. São três desses gargalos, e por isso a Onda 0 existe:

- `packages/contracts/src/carteira.ts` e o serviço da lista de clientes (todo mundo quer um campo novo do cliente);
- `apps/api/src/carteira/prospeccao/prospeccao-carteira.service.ts`, que hoje tem leads, rotinas, tarefas e checkins num arquivo só (prospecção e rotina iriam colidir);
- `apps/api/src/comum/redacao.interceptor.ts` (o ponto único da regra 17).

Uma migration por ticket, numerada em sequência na hora do merge (forward-only).

### Onda 0: defeitos e fundação (sequencial, bloqueia tudo)

| Ticket | Conteúdo | Arquivos donos | Depende de |
|---|---|---|---|
| 0.1 Defeito: reunião só aparece no portal se compartilhada | D-P1. *Expand*: `reunioes_comerciais.compartilhada DEFAULT false` e policy do portal com AND. Teste de isolamento. | migration nova, `teste/portal-no-banco.test.ts`, `leitura-do-portal.service.ts` (só a consulta de reuniões) | — |
| 0.2 Defeito: conversão de lead sem grupo | Reproduzir com teste de escopo geral. A correção depende de D-4. Até a decisão, a rota devolve 409 com mensagem clara em vez de 500. | `prospeccao-carteira.service.ts` (só `avancarEtapa`), e2e | — |
| 0.3 Separar o serviço de prospecção | `leads.service.ts` e `rotina-interna.service.ts`. Só refatoração, sem mudança de comportamento, provada pela suíte existente. | `apps/api/src/carteira/prospeccao/**` | 0.2 |
| 0.4 Cadastro do Cliente Firmare (C3) | Migration *expand*, `parceiros_do_cliente`, `GET` e `PATCH /v1/carteira/clientes/:id`, contrato, formulário de edição com seções recolhidas. | migration, `packages/contracts/src/carteira.ts`, `carteira.service.ts`, `carteira.controller.ts`, `apps/web/src/app/carteira/clientes/[id]/cadastro.tsx` (novo) | D-4 para a parte "sem clínica" |
| 0.5 Perfis do Usuário de Gestão (T1) | Colunas, tabela de módulos no domínio, redação pelo `req.carteira`, filtro "minha carteira" no servidor, campos na tela do superadmin. Gate de segurança antes do merge. | migration, `packages/domain/src/carteira.ts`, `redacao.interceptor.ts`, `carteira.guard.ts`, `painel-carteira.*`, `superadmin/usuarios-gestao/page.tsx` | D-2, D-3 |

### Onda 1: as telas que a equipe usa todo dia (paralelizável)

| Ticket | Itens | Arquivos donos | Depende de |
|---|---|---|---|
| 1A Ficha do cliente em abas | V1, V2, V5, V6, C5 | `apps/web/src/app/carteira/clientes/[id]/**` (exceto `cadastro.tsx`) | 0.4 |
| 1B Reuniões, documentos e materiais pela equipe | V13, V14 (escrita, encaminhamentos viram tarefas, saúde), X2 (só a parte do cliente) | `apps/api/src/carteira/conteudo/**` (módulo novo), contrato `conteudo-carteira.ts` (novo), uma aba nova em 1A combinada no merge | 0.1, 0.3 |
| 1C Campanhas | K1–K4, V9 | `apps/api/src/carteira/campanhas/**` (novo), job, migration de `campanhas_carteira`, `apps/web/src/app/carteira/campanhas/**` | 0.5 (dinheiro), D-9 |
| 1D Painel FIR Clinic | F1, V12, R13 | `apps/api/src/carteira/uso/**` (novo), `apps/web/src/app/carteira/fir-clinic/**` | 0.5 |
| 1E Prospecção completa | L1–L8, L11 | `leads.service.ts`, `prospeccao.ts` do contrato e do domínio, `apps/web/src/app/carteira/leads/**` | 0.3, D-4 |
| 1F Mensalidades | $1, $4, rota de mensalidade, vencimento por cliente no job | `apps/api/src/carteira/financeiro/{cobrancas,gerar-cobrancas}*`, `cobranca-carteira.ts`, `apps/web/src/app/carteira/mensalidades/**` | 0.4, 0.5, D-8 |

### Onda 2: os rituais que dispensam a cobrança

| Ticket | Itens | Arquivos donos | Depende de |
|---|---|---|---|
| 2A Rotina completa | R1–R12, R14 | `rotina-interna.service.ts`, `worker-rotinas-internas.ts`, domínio de calendário, `apps/web/src/app/carteira/rotina/**` | 0.3, 0.4 |
| 2B Metas completas | M1–M4, M6, V8 (`Ação do plano`), V10, O4 | `apps/api/src/carteira/financeiro/{metas,indicadores}*`, `acoes-do-plano/**` (novo), `apps/web/src/app/carteira/metas/**` | 0.4, 0.5 |
| 2C Checklists e entrada de cliente | X3, X5, V3, V15, C4, C6 | `apps/api/src/carteira/checklists/**` (novo), `apps/web/src/app/carteira/metodo/checklists/**`, a rota de criação de cliente | 0.4, 0.5, 2A (tarefas), D-4 |

### Onda 3: comunicação e visão do todo

| Ticket | Itens | Arquivos donos | Depende de |
|---|---|---|---|
| 3A Mensagens e WhatsApp | X4, W1, W2, W4, $3, L9, L10, L13 | `apps/api/src/carteira/mensagens/**` (novo), componente de modal no web | 2A, 1E |
| 3B Visão geral | P1–P4, P6, P9–P11, T4 | `apps/api/src/carteira/painel/**` (novo), `apps/web/src/app/carteira/page.tsx`, `pecas.tsx` | 1A–1F, 2A, 2B |
| 3C Resumo semanal | S1 | `apps/api/src/carteira/resumo/**`, função pura no domínio | 3B |
| 3D Biblioteca geral e portal | X2 (biblioteca geral), O2, O5, O8, V7, O9, O10, T2 (mensagem pronta), T5, L12 | `apps/api/src/carteira/portal/**`, `apps/web/src/app/portal/**`, `apps/web/src/app/carteira/metodo/biblioteca/**` | 1B, 0.5 |
| 3E Roteiro de briefing só leitura e ensaio | X1 | `apps/web/src/app/carteira/metodo/roteiros/**`, semente | Confirmação no gate de LGPD (B1) |

### Onda 4: integrações e o que depende de decisão

| Ticket | Itens | Depende de |
|---|---|---|
| 4A Planilhas do Google | G1–G4, V11, P7, M5, W3 | D-7, código da função `planilhas` |
| 4B Importar do Asana | C7 | 1B |
| 4C Anexos de arquivo | parte de V14 e O7 | D-6, armazenamento na VPS (`sre-devops-vps`) |
| 4D Briefing e Mapa de Maturidade | B1–B10, P5, V16 | D-5 (nova ADR substituindo a 0013 §1) |

**O que cada onda entrega para a equipe Firmare:**

- Onda 0: nada visível, mas tudo depois dela passa a ser possível.
- Onda 1: a equipe para de manter a carteira na cabeça e no Drive (ficha completa, reuniões registradas, campanhas e uso da FIR Clinic à vista, cobrança do mês).
- Onda 2: as rotinas geram as tarefas sozinhas, e a reunião semanal de metas tem lugar e ritmo.
- Onda 3: a diretoria abre a ferramenta e vê o todo, e as mensagens saem prontas.
- Onda 4: os parceiros deixam de precisar de cobrança manual da planilha.

---

## 20 · Decisões que só o dono pode tomar

Curtas, cada uma com a minha recomendação. Ou o protótipo não responde, ou a resposta dele colide com uma ADR aceita.

| # | Decisão | Por que é do dono | Recomendação |
|---|---|---|---|
| **D-1** | **Esta frente segue em paralelo ao épico 9?** | A D-19 autorizou a carteira em paralelo, com um gatilho: se ela consumir o ciclo inteiro e o épico 9 seguir parado, a prioridade volta para decisão explícita. Só as ondas 0 a 3 somam 19 tickets, a maioria de tamanho M ou G. | Ondas 0 e 1 em paralelo ao épico 9, como a D-19 já permite. Ondas 2 a 4 só depois de a P-5 (clínica e janela de migração) sair do lugar. |
| **D-2** | **Quem administra a equipe da Firmare?** No protótipo é a diretoria, de dentro da ferramenta (`L2641-2653`). A ADR 0011 diz que só o `Operador` cria e atribui `Usuário de Gestão`. | Reabre uma ADR aceita. | Manter a ADR 0011: só o `Operador`. A tela do superadmin ganha os campos do protótipo (módulos, carteira, valores, setor, função). Se a diretoria da Firmare não for a mesma pessoa que opera o superadmin, emenda à ADR 0011 criando o papel "Diretoria" no `Usuário de Gestão`, limitado ao próprio escopo e com trilha. |
| **D-3** | **`valores` e "só a minha carteira" para o `Usuário de Gestão`.** O protótipo tem as duas coisas por perfil. Hoje ninguém da carteira vê dinheiro (achado 1), e a ADR 0016 deixou como decisão provisória que todos veem tudo dentro do grupo. | Muda quem vê dinheiro real e muda uma decisão provisória da ADR 0016. | Seguir o protótipo: bit `valores` (padrão `false`, quem concede é o `Operador`) e `carteira` minha/todos como filtro de servidor. Redação pelo mesmo ponto único (regra 17). Gate de segurança antes do merge. |
| **D-4** | **Cliente sem clínica e sem grupo.** (a) Um cliente só de consultoria pode ficar `ativo`? Hoje o CHECK da `0032` impede (achado 3). (b) O `Usuário de Gestão` pode criar cliente do zero ("Novo cliente", "Já é cliente")? A ADR 0016 §1 diz que não. (c) Que grupo recebe um cliente que nasce de lead sem grupo? (achado 4). | Toca a ADR 0016 §1, a ADR 0011 (só o `Operador` cria `Grupo`) e o invariante `grupo_id NOT NULL` em que a RLS se apoia. | (a) Sim: trocar o CHECK. O `CONTEXT.md` já diz que pode existir sem clínica. (b) Sim, com emenda à ADR 0016 §1. Provisionar a clínica de verdade continua só com o `Operador`. (c) Grupo singleton criado na mesma transação, com o nome do cliente, auditado com o usuário que converteu. Mantém `grupo_id NOT NULL`, exige emenda à ADR 0011 só para esse caso, e repete o padrão da Q7 (cada uma das 4 clínicas em grupo singleton). |
| **D-5** | **Briefing, Mapa de Maturidade, transcrição e IA** (seção 6). | ADR 0013 §1 exclui. | Em etapas, cada uma com nova ADR e gate de LGPD: primeiro o roteiro só leitura e o ensaio (X1, sem gravar resposta); depois as respostas estruturadas sem transcrição; transcrição e IA só depois de contrato com o provedor e cláusula de transferência internacional. Na versão publicada do protótipo a IA já não funcionava (`sb:L331`), então não há prática da equipe que dependa dela hoje. |
| **D-6** | **Anexo de arquivo em reunião** (até 20 MB) ou só link? | Exige armazenamento de arquivo na VPS, que não existe, e o arquivo pode conter dado de paciente. | Só link nesta fase (o protótipo de demonstração já funcionava assim). O upload volta como épico próprio, com armazenamento, limite de tipo e retenção. |
| **D-7** | **Leitura automática das planilhas do Google** (seção 14). | Integração externa com credencial e custo. O código da função que faz isso na versão publicada não veio. | Pedir à PO o código da função `planilhas` e um exemplo real de planilha. Construir na Onda 4, atrás do seam `LeitorDeIndicadores`. Até lá, lançamento manual (já existe). |
| **D-8** | **As quatro decisões provisórias da ADR 0015** (arredondamento do desconto para cima, mês cheio no onboarding, mês integral na saída, nota fiscal fora). Pendentes desde 2026-11-05. | Política comercial com dinheiro real. | Confirmar as quatro como estão. A Onda 1F (mensalidades) depende disso. |
| **D-9** | **Retorno das campanhas.** O protótipo mostra "continuado" e "retorno". A ADR 0013 §5 deixa em branco até a FIR Clinic ter essas informações. | Exige feature nova no produto da clínica ou aceitar lançamento manual. | Aceitar `investimento` lançado à mão na campanha da carteira (é dado da Firmare, não recálculo de receita), o que libera o "retorno" sobre a receita do mês. "Receita continuada" fica fora até o módulo de campanhas da clínica saber calcular. |

## 21 · Decisões de produto que tomo, com ADR

Divergências que o protótipo responde e que eu decido dentro do meu papel. Cada uma vira ADR curta antes do ticket. Não precisam do dono, mas ficam listadas para ele poder vetar.

| # | Decisão |
|---|---|
| **D-P1** | Reunião só aparece no portal se for compartilhada, e nasce não compartilhada (segue o protótipo e corrige o achado 5). Ticket 0.1. |
| **PP-1** | "Ver como" não vira impersonação. Fica uma prévia de permissões só leitura (T3). |
| **PP-2** | O `checkin` do protótipo vira `Lançamento de indicador` semanal, não um terceiro conceito (seção 7). |
| **PP-3** | A saúde do cliente é derivada do registro mais recente entre checkin interno e reunião registrada. O protótipo grava a saúde a partir da reunião e da edição do cadastro (`L1711`). Mantemos derivada, nunca campo editável (`CONTEXT.md`), e incluímos a reunião como fonte. |
| **PP-4** | A cobrança é gerada também para clientes em onboarding com mensalidade e vencimento (segue o protótipo, `L880`). Muda o critério 7 do spec G3. |
| **PP-5** | Excluir cliente, lead, documento, reunião e rotina vira estado (encerrado, arquivado, cancelado, desativado). Nunca `DELETE` em cascata (`L2966`). É a regra 20. |
| **PP-6** | "Enviar pelo WhatsApp" não marca a mensagem como enviada sozinho. É preciso confirmar, porque abrir o WhatsApp não prova o envio (W2, L9). |
| **PP-7** | Reunião fixa vira dia da semana e hora estruturados, não o texto "terça 10h" (C3). |
| **PP-8** | "Faltas recontatadas" fica oculta enquanto o job não escrever a coluna. Mostrar 0 mentiria (V12). |

---

## 22 · O que fica explicitamente de fora deste inventário

- Tudo que é infraestrutura do protótipo: Supabase, Realtime, a coleção `registros`, o modo artefato do Claude, o fluxo "Sou eu" de pedido de acesso (`L1195-1205`) e os dados de exemplo gerados na tela.
- A lista nominal de pessoas da clínica com último acesso (ADR 0013 §2), "rotinas cumpridas" e "recaptações" (ADR 0014). Não se reabrem por este pedido.
- Qualquer agregado operacional ou de paciente cruzando `clinica_id` no portal (ADR 0017 §4).
- O cartão de KPI com gradiente (`L247`), proibido pelo `docs/design.md`.
