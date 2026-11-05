# Roadmap de entregas

O que falta, em ordem, e **o que fica pronto em cada etapa**. Ordenado por dependência e por risco: o que sustenta tudo vem primeiro.

A ordem curta está em `docs/pipeline.md`. Aqui está o que cada épico entrega e o que ele desbloqueia.

---

## Épico 1 — Fundação

Monorepo, `packages/domain` com `Dinheiro` e `Quantidade`, autenticação por e-mail e senha, `Clinica` com RLS, `Pessoa`, `Perfil` e a matriz de permissões, **trilha de auditoria** (escrita por trigger, acesso por interceptor, leitura por `GET /v1/auditoria`), CI, ambiente local pelo `fir.bat`, deploy na VPS.

**Fica pronto:** uma pessoa entra, vê uma tela vazia, não enxerga dado de outra clínica — e tudo o que ela escreve ou abre fica registrado.
**Desbloqueia:** tudo. Nenhum outro épico começa antes.
**Por que a trilha vem aqui e não depois:** em tabela append-only não existe gravar depois o que não foi gravado na hora. Decisão D-5, ADR [`0002`](adr/0002-auditoria-por-trigger.md). A consequência atravessa todos os épicos seguintes: **todo caminho de escrita declara ator**, inclusive semente, job e migration de dados.
**Pendência que fecha com ele:** P-1 (UX de sessão no balcão) — ver `docs/decisoes.md`.

## Épico 2 — Núcleo da rotina

`Tarefa`, recorrência, tela **Hoje** (pendentes de dias anteriores, filtros de pessoa, semana, aniversariantes), **Tarefas**, **+ Nova tarefa**, `Paciente`, `Unidade`.

**Fica pronto:** a rotina de tarefas da v20, inteira. É o módulo que mais gente usa.
**Cuidado:** a recorrência mensal em 29, 30 e 31 cai no último dia do mês curto. As clínicas dependem disso hoje.

## Épico 3 — Jornada do paciente

Etapas, `historico`, envio de confirmação, **Recontatar**, orçamento com programa montado, fechamento, perda com motivo, funil por período.

**Fica pronto:** o ritual comercial completo. É o que diferencia a ferramenta de uma lista de tarefas.
**Invariante que define o épico:** uma única `Tarefa` anda pelas etapas; `faltou` e `desmarcou` mantêm o cartão aberto até reagendar ou encerrar.

## Épico 4 — Financeiro

`Recebimento`, saldo em aberto por programa, **Caixa do dia** às cegas, **Contas a pagar** com lembrete de 3 dias, **Cobranças**, **Visão do mês** com meta e categorias.

**Fica pronto:** o dinheiro da clínica, com conferência às cegas.
**Onde o risco está:** receita contada duas vezes (pagamento embutido mais avulso) e o esperado do caixa vazando para o cliente antes do fechamento.

## Épico 5 — Programas

`Procedimento` com insumos, `Programa` montado por itens, sessões, reprogramação, retorno por item.

**Correção, 2026-10-25:** *"Minhas metas"* **saiu daqui e está no épico 7**, onde `paridade.md` sempre a listou. Medido no protótipo rodando: aquela tela lê ficha de RH, metas do mês e os 8 indicadores `IND_PES` — **nada de programa**. Era eu que a tinha posto no lugar errado. O que a enfermagem abre todo dia e **fica** neste épico é o filtro *"Minhas sessões"* da tela Programas.

**Fica pronto:** a agenda de sessões da enfermagem.
**Depende de:** épico 3 (o orçamento monta o programa).

## Épico 6 — Estoque

`Item` com as três unidades, `Local`, `Movimento`, `Contagem` às cegas, **Análise**, curva ABC, etiqueta QR, leitura GS1/EAN, entrada por XML de NF-e, **baixa automática pela sessão**.

**Fica pronto:** o módulo mais intrincado, e o que a implantação de 30 dias mais exige da clínica.
**Depende de:** épico 5 (a baixa vem da sessão concluída).
**Como a baixa entra:** pelo seam **`BaixaDeInsumos`**, trocando `BaixaInerte` por a implementação de verdade — uma linha em `programas.module.ts`, como o épico 5 fez com o `MontadorDePrograma`. Os três invariantes que ela tem de honrar já têm teste nesta árvore.
**Ensaie antes:** a reversão. Concluir → reabrir → concluir → reabrir tem de devolver o saldo ao ponto inicial, com o mesmo lote.

## Épico 7 — Pessoas

Fichas, contrato, férias, documentos com validade, metas mensais (automáticas e manuais), conversas 1:1, banco de horas, alertas — e a tela **"Minhas metas"**, que estava no épico 5 por engano meu (ver a correção lá). Ela lê ficha de RH, as metas do mês e os **8 indicadores `IND_PES`**, que são contagens derivadas e é onde número divergente vai aparecer na migração; `paridade.md` sempre a listou aqui.

**Fica pronto:** a gestão de equipe, com salário atrás de `pessoas.gerir`.
**Serve também** clínicas maiores e multiunidade, junto com Tarefas.

## Épico 8 — Campanhas e painel

`Campanha` com tipo, métrica e meta; importação de lista; funil; **Painel geral**.

**Fica pronto:** a leitura gerencial do período.

---

## 🚩 Épico 9 — Paridade fechada e migração das 4 clínicas

**A entrega que tem data.** Nada aqui é opcional:

1. **As 59 linhas de [`docs/paridade.md`](paridade.md) em ✅**, mais os critérios de aceite da §13 do documento de passagem.
2. Importador ensaiado contra **cópia real** dos dados de cada clínica.
3. Relatório de conferência fechado, por clínica, batendo **exatamente**.
4. Perfis revisados com cada clínica, uma a uma.
5. Corte uma clínica por vez, fora do horário, com rollback cronometrado.
6. v20 em paralelo, somente leitura, por alguns dias.

**Pendências que fecham antes:** P-2 (hospedagem para dado de saúde), P-3 (DPA), P-5 (janela de migração).

> **Tudo que atrasa este épico passa pelo `product-rotina-clinica`, e a decisão é do dono.**

---

## Épico 10 — Integrações e automações

`AgendaProvider` (iCal e Google Agenda) com conciliação que **propõe**, mensagens configuráveis por clínica, WhatsApp pela API oficial (opcional), leitura de foto da nota por IA, assistente sobre o Manual.

**Depende de:** P-7 — validar com Amigo e Support Health se sincronizam e o que vai no compromisso. Construir contra formato suposto é construir duas vezes.

## Épico 11 — Produto

Previsão de compra a partir das sessões programadas · rastreabilidade por lote (quais pacientes receberam um lote) · transferência entre unidades · painel por frente · campanhas de indicação e internas.

**Atenção:** rastreabilidade por lote cruza dado sensível de vários pacientes numa tela só. Passa pelo `especialista-lgpd-saude` antes de existir.

## Épico 12 — Contas e assinatura

**O objetivo final declarado do projeto.** Onboarding self-service de clínica com perfis e catálogo padrão, convite por e-mail com token de uso único, ativar e desativar acesso, painel interno de clínicas, planos e cotas, assinatura recorrente, visão de consultoria, personalização com logo.

**Não depende só de ordem.** Depende de coisas construídas desde o épico 1: `clinica_id` com RLS em toda tabela, `ativa` como estado da clínica, `ativo` da pessoa sem exclusão, e contagens deriváveis para as cotas. Remendar isso depois é remodelar.

**Pendências:** P-4 (modelo comercial), P-6 (perfil de consultoria).

**Regra normativa:** cota que impede o titular de entrar, ver o próprio histórico ou exportar os próprios dados não é modelo comercial — é infração. Ver `especialista-contas-assinatura`.

---

## Carteira Comercial da Firmare — trilha paralela

Produto novo, **não é paridade com o protótipo da clínica**: é a ferramenta com que a
própria Firmare gerencia o portfólio de clínicas-cliente (`Grupo`, `Cliente Firmare`,
`Usuário de Gestão`). Corre no mesmo monorepo, com numeração própria (G0–G7), governada
por `docs/superpowers/plans/2026-11-05-plano-integracao-firmare-gestao.md` e pelas
ADRs 0011–0018. Não entra nas 59 ações de `docs/paridade.md` — nenhuma relação com o
`demoApiBase` do protótipo da PO, que é 100% sobre a operação de uma clínica.

**Decidido pelo dono:** a Carteira só entra em produção depois que o épico 9 (migração
das 4 clínicas) fechar — mas constrói-se agora, em paralelo, porque não compete pelo
mesmo código (G1b, a única fatia que tocaria `Clinica`, está explicitamente adiada até
o fim literal do épico 9).

| Fase | Entrega | Estado |
|---|---|---|
| **G0 — Gate de risco** | ADRs 0011, 0012, 0013 aceitas | ✅ Concluído |
| **G1a — Fundação** | `grupos`, `usuarios_gestao` com `Escopo`, RLS própria, auditoria com `ator_tipo='usuario_gestao'` | ✅ Entregue e verificado |
| **G1b — `grupo_id` em `Clinica`** | Vira denormalização opcional; não bloqueia mais nada | Adiado até o fim literal do épico 9 |
| **G2 — Carteira (Cliente Firmare)** | Leitura e escrita de `Grupo`/`Cliente Firmare`/`Usuário de Gestão`, isolamento cross-grupo provado | ✅ Entregue. **Falta:** tela de listagem de `Usuário de Gestão` (hoje só há criação) |
| **G3 — Metas comerciais e lançamentos** | `Cobrança do Cliente Firmare`, `Mensalidade`, `Benefício de indicação`, `Indicador`/`Meta`/`Lançamento` | ✅ Entregue. **Em aberto:** as quatro decisões de arredondamento/proporção/estorno/NF-e da ADR 0015 são provisórias — confirmação do dono pendente. `Meta interna da carteira` (quota por `Usuário de Gestão`, churn-alvo) foi **cortada desta fatia por decisão explícita do spec** (nada no protótipo a pede); reabre se o dono pedir. **Ver dívida nova sobre redação de valores** |
| **G4 — Telemetria e campanha** | `uso_diario_cliente`, `campanhas_carteira`, job idempotente por fuso da clínica | ✅ Entregue. **Pendências já documentadas no plano:** `faltas_recontatadas` sempre 0 (falta cruzar falta com reagendamento posterior — ticket próprio), `tarefas_vencidas_abertas` usa `prazo <= dia` (confirmar se deveria ser `<`), cron fixo `06:00 UTC` (não por fuso de clínica). **Ver dívida nova sobre o worker sem registro em `infra/`** |
| **G5 — Rotina interna + funil de prospecção** | `leads_comerciais`, `tarefas_internas`, `rotinas_internas`, `checkins_internos`, cadeia `lead → Cliente Firmare (sem clínica) → clínica` | ✅ Entregue. **Em aberto:** três decisões provisórias da ADR 0016 (checkin qualitativo, visibilidade "todos veem tudo no grupo", rótulo "Arquivar") pendentes de confirmação do dono. Catálogo de motivo de perda de lead foi **decisão deliberada de não construir agora** (volume baixo); reabre se o volume justificar. **Ver dívida nova sobre paginação** |
| **G6 — Portal do grupo** | 🟡 **Em implementação agora, por outra frente** — não tocar nos arquivos dela. Base legal e fronteira de dado operacional já decididas (ADR 0017, ADR 0018) | 🟡 Em andamento |
| **G7 — Deploy VPS** | Rota Traefik dedicada para `carteira` (autenticação + rate limit por conta e por origem — nunca allowlist de IP fixo, decisão do dono registrada na D3b) | ⬜ Não começou. Depende de G1a-G2-G4 (prontos) e de G3/G5/G6 (G6 ainda em andamento) |

---

## O que não está no roadmap, e por quê

| Ideia | Por que fora |
|---|---|
| Prontuário, agenda própria, faturamento | A ferramenta roda **ao lado** do sistema da clínica. Duplicar o que o Amigo já faz é a forma mais rápida de a equipe abandonar a ferramenta |
| Registro de ponto | A ferramenta recebe o **saldo** do app de ponto oficial. Registrar ponto é obrigação trabalhista com regra própria |
| App nativo | O produto é web, usada no computador do balcão e no celular. Revisitar só se a câmera do estoque pedir |
