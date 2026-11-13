# Passagem — as 7 pendências que dependem da cliente (2026-11-09)

> Para a próxima sessão. Junta o que a sessão de 09/11 entendeu sobre os 7 itens da seção **"5. O que precisamos de você"** do relatório de entrega à Marília (dona da Firmare), com o estado real do código. Os caminhos são relativos à raiz do repo. Conferir na fonte antes de agir: isto é um resumo.
>
> **A sessão de 09/11 não implementou nada destes 7 itens.** Ela entregou as correções da PO (D-25), a lateral da Carteira (D-26) e o "Voltar ao painel". Este documento é o ponto de partida.

---

## 0. Estado no fim de 09/11

- **Produção** (firmaregestao.com.br): commit `8d8a5e2`. Na VPS, o checkout `/root/firmaregestao` está numa branch local chamada `agenda-sincronizacao`, que é só um nome histórico. Houve backup do banco antes de cada deploy, em `/root/backups/firmaregestao-pre-*.dump`. Procedimento de deploy: na memória `deploy-firmaregestao`.
- **GitHub**: `firmaregestao-producao` = `8d8a5e2`. A branch de trabalho `correcoes-po-2026-11-09` foi mesclada e apagada.
- **Na VPS, NUNCA mexer em `/opt/fir` nem nos containers `fir-*`** (é o FIR Clinic, outro projeto), nem nos outros apps (auri, cbt, coldre, easypanel). O nosso é só o projeto compose `firmaregestao`.
- **Fontes que não estão nesta máquina.** Estão no `.gitignore`, e a sessão anterior rodou em outra conta (`C:\Users\Mai\...`):
  - `versoes/v20-producao/`, com o `Code.gs` da v20;
  - `versoes/firmare-gestao-prototipo/`, com o `fg-supabase.js`;
  - `docs/Planilhas/`, com as exportações reais das clínicas.

  Uma cópia do protótipo do Firmare Gestão (só leitura, nunca executar) está no scratchpad da sessão de 09/11, em `prototipo-gestao/index.html`. Ela pode sumir.
- **Lista viva de pendências**: `docs/handoff/2026-11-08-sessao-g8.md` §5.3 ("Depende de terceiros"). `docs/o-que-depende-de-voce.md` está **desatualizado** e não cita estes 7 itens.
- **Ainda não feito na fila técnica**: o item 8 da PO (Setor de atuação). Está desenhado na ADR 0025 (aceita), com a migration 0066 e os tickets B4-1..B4-9, mas não foi construído.

### Quem é quem (como aparece nas mensagens)
- **Marília**: dona da Firmare e cliente final. Precisa de linguagem fácil, nível usuária. Tem uma conta de superadmin `marilia` em produção.
- **Davi**: contratou o trabalho. A orientação dele foi responder o que ela perguntou, pedir o que está no documento, explicar brevemente como a agenda funciona e dizer que o sistema "lê as planilhas compartilhadas com ela, no padrão X, na API do Google Sheets".
- **PO**: autora do protótipo e dos pedidos de correção. Não está confirmado que seja a Marília.

### O que já foi dito à Marília
A versão final da mensagem de WhatsApp pediu primeiro só três coisas: (1) o link da agenda de uma clínica, (2) um print de 2 ou 3 agendamentos e (3) o link de uma planilha semanal real. O resto "pode mandar aos poucos". Não está confirmado se foi enviada. Também ficou em aberto **o que ela perguntou no fim da mensagem dela**: essa parte nunca foi colada na sessão.

O Google Doc "Firmare — Correções pedidas pela PO (09/11/2026)" (https://docs.google.com/document/d/1GIiVhmBi2KTubtG65styLXJcQnAIoJz6yonR0YWqQyI/edit) repete esse pedido. **Ele ainda diz "não publicado"**, mas hoje está tudo publicado. Falta atualizar.

---

## 1. Agenda das clínicas

**Pedido à cliente:** qual sistema cada clínica usa (Amigo, Support Health, iClinic…) e o link Google Agenda ou iCal de uma clínica, para testar por uma semana.

**O que existe (no ar e validado com um iCal real):**
- ADR `docs/adr/0019-sincronizacao-da-agenda-externa.md` e spec `docs/specs/agenda-sincronizacao.md` (T1–T7); D-20 item 1 (`docs/decisoes.md:581`).
- Domínio puro em `packages/domain/src/agenda.ts`: telefone, extração do nome, tipo, ignorar, `decidirPelaAgenda` (:260), trava de feed vazio (:288), máscara do link (:299).
- Migration `apps/api/migrations/0037_agenda_externa.sql`:
  - `agendas_externas`: uma por clínica, `provedor CHECK IN ('ical')`, `ativa`, `palavras_ignorar`, `responsavel_id`;
  - `compromissos_externos`: `UNIQUE (clinica_id, provedor, uid_externo)`; nos eventos recorrentes a chave é `uid|RECURRENCE-ID`.
- API em `apps/api/src/agenda/`:
  - `sincronizacao.ts`: janela de 60 dias; casa a paciente por telefone, depois por nome exato e, se não achar, cadastra (:382-430);
  - `leitor-ical.ts` (ical.js);
  - `baixar-feed.ts`: SSRF fechado, 20 s, 5 MB, até 3 redirecionamentos;
  - `fila-agenda.ts`: cron `*/15`;
  - `worker-agenda.ts`;
  - `agenda-externa.controller.ts`: `GET`/`PUT /v1/agenda-externa` e `POST .../sincronizar`, com `@Exige('config')`.
- Tela "Agenda do sistema": `apps/web/src/components/tela-agenda-do-sistema.tsx`.
- Infra: serviço `worker-agenda` (`infra/producao/docker-compose.yml:164-183`), rede `saida`. O `implantar.sh` confere que ele resolve `calendar.google.com`.

**Como um agendamento vira cartão** (ADR 0019 §6):
- novo → "Consulta agendada" ou "Procedimento agendado", na etapa `agendado`;
- data ou hora mudou → `reagendar`;
- sumiu ou `CANCELLED` → `desmarcar`, e o cartão cai em Recontatar (regra 27: proposta, nunca cancelamento);
- só mexe nos cartões `agendado` e `confirmado`; nunca desfaz o que foi feito à mão e nunca recria um cartão excluído;
- o autor é `sistema`, e o cartão não conta na meta de agendamentos.

**Liga/desliga:** não há flag de ambiente. É `agendas_externas.ativa`, por clínica, alterada pela tela. O link secreto fica no banco, nunca em env nem em log.

**Lacunas:**
- **`AgendaProvider` não existe como interface no código.** O CLAUDE.md e a ADR citam o nome, mas o que existe é `Baixador` + `lerIcal`, com `'ical'` escrito fixo.
- Google Agenda funciona só pelo "endereço secreto em formato iCal". Não há OAuth.
- Amigo, Support Health e iClinic estão fora de escopo pela **P-7** (`docs/decisoes.md:727`): "construir contra formato suposto é construir duas vezes".
- Unidade e profissional vindos do compromisso não estão implementados.

**Pré-requisito que costuma ser esquecido:** as 4 clínicas reais ainda estão na v20. Para testar com um link real, a clínica precisa existir na FIR (criada pelo superadmin), e o link dá acesso à agenda de pacientes, o que pede base legal ou DPA (P-3).

**Próximo passo quando o link chegar:**
1. Criar ou usar a clínica na FIR.
2. Na tela "Agenda do sistema", colar o link, escolher o responsável e clicar em "Sincronizar agora".
3. Conferir o resumo (criados, reagendados, desmarcados, ignorados, pacientes novos).
4. Comparar agenda e cartões por uma semana.
5. Se o sistema da clínica exigir integração própria: criar a interface `AgendaProvider` de verdade, um adaptador e uma migration que amplie o `CHECK`.

## 2. Print de como aparece cada agendamento

**Pedido:** print de 2 ou 3 agendamentos (título e descrição), para achar a paciente certa.

**Onde fica o parse** (a ADR 0019 diz que é o único ponto a ajustar): `packages/domain/src/agenda.ts`.
- `PARECE_TELEFONE` (:74): 10 a 13 dígitos.
- `telefoneNacional` (:25) e `mesmoTelefone` (:41): toleram o nono dígito e exigem DDD.
- `campoRotulado` (:85), com rótulos de nome (:94) e de telefone (:95).
- `PALAVRAS_DE_TIPO` (:101).
- `dadosDoCompromisso` (:126):
  - um rótulo na descrição vence o título;
  - senão, o título é partido em `- – — | / : • ( ) [ ]`;
  - descarta telefone, tipo, procedimento do catálogo e "Dr./Dra.";
  - fica o primeiro pedaço que sobrar, até 120 caracteres.
- `tipoDoCompromisso` (:171), `PALAVRAS_PARA_IGNORAR_PADRAO` (:185), `motivoParaIgnorar` (:201).
- `normalizarNome` vem de `semelhanca.ts`.

Testes em `packages/domain/src/agenda.test.ts:63-121` (`it.each`).

**Estado:** heurística sobre um formato suposto. Nenhum print chegou.

**Próximo passo:** transformar os títulos e descrições reais, **anonimizados** (o repo é público), em casos de `agenda.test.ts`. Ajustar só `agenda.ts`, talvez com um padrão por provedor. Nunca colar nome ou telefone real de paciente em teste, commit ou log.

## 3. Documento técnico: rotinas "Pós atendimento" e "Recaptação"

**Nomenclatura:** aqui "P4" é a **Prioridade 4 da cliente** ("Nova rotina"). Ela não tem relação com a P-4 de `decisoes.md` (modelo comercial) nem com o "P4" do gate do item 8 (setor fora do % no prazo).

**Estado:** **bloqueado**, pela D-20 item 4 (`docs/decisoes.md:584`). A cliente parte das seções **6.10 e 8.9** do documento técnico dela. O documento que temos vai só até 6.9 e 8.8, e o protótipo não tem nada disso.

**Escopo esperado** (handoff 08/11 §2):
- Configurações › Rotinas automáticas, com as duas rotinas fixas;
- grupo "Pós atendimento e recaptação" na tela Hoje;
- "Nova rotina", com gatilhos, filtro, prazo, tipo, responsável, mensagem e limite por dia;
- não duplicar, cancelar se o gatilho for desfeito e intervalo mínimo.

**Em aberto:** o valor do intervalo mínimo, quem é o "responsável do paciente" e se isto entra antes ou depois da migração.

**O que já existe e não é isto:**
- Tipos manuais `Recaptação`, `Pós-consulta` e `Retorno de procedimento` (`packages/domain/src/tipos-de-tarefa.ts:34,59,63`).
- A única tarefa automática hoje é o retorno no fim do programa (`packages/domain/src/retorno.ts`, usado em `programas/sessoes.service.ts` e `tarefas/conclusao.service.ts`).
- Campanhas manuais (`apps/api/src/campanhas/`, migrations 0020 e 0028, ADR 0014).
- As **rotinas internas da Carteira** (ADR 0016, `worker-rotinas-internas`) são da equipe Firmare, não das clínicas.

**Próximo passo quando o documento chegar:**
1. `/grill-me` → spec, depois gates de LGPD e de números, e ADR.
2. Migration das regras.
3. Gerador idempotente (BullMQ).
4. Tela de Configurações e grupo em Hoje.

## 4. Planilha semanal de um cliente (Carteira, G8 4A)

**Pedido:** o link de uma planilha real que um cliente preenche toda semana.

**O que existe:**
- D-22 item 7 (`docs/decisoes.md:618`) e `infra/producao/README.md:115-165`. Migration `0045_carteira_planilhas_do_cliente.sql`.
- Seam `LeitorDePlanilha`: `apps/api/src/carteira/planilhas/leitor-de-planilha.ts:17`. Adaptador `leitor-google-sheets.ts`, que só fala com `oauth2.googleapis.com` e `sheets.googleapis.com`. Fake em memória para os testes.
- `ler-planilhas.ts`: idempotente por `cliente_carteira_id`, a cada 30 min e sob demanda.
- `worker-planilhas.ts:36` lê `GOOGLE_SA_JSON`. Sem ela, cada leitura registra "não configurado".
- Telas: `apps/web/src/components/carteira/planilha-do-cliente.tsx` e `indicadores-do-cliente.tsx`.
- Formato esperado em `packages/domain/src/planilhas-indicadores.ts:106-200`, reconstruído do `fg-supabase.js` L286-316 do protótipo:
  - uma planilha por cliente, com 4 abas de respostas de Google Forms (Financeiro, Comercial, Tráfego pago, Marketing) e "Carimbo de data/hora";
  - a aba Financeiro está marcada como `provisoria`;
  - a coluna "semana" (:285) e o corte da semana na sexta (:442-453) estão marcados "calibrar com a planilha real".
- O resumo semanal (ADR 0021) **não** lê a planilha.

**Bloqueios:**
1. **Conta de serviço do Google**, que é tarefa do dono. O JSON vai **direto no `.env` da VPS** (modo 600), **nunca pelo chat** nem pelo repo. `GOOGLE_SA_JSON` vai só para o `worker-planilhas` (`docker-compose.yml:251`), e `GOOGLE_SA_EMAIL` vai para a API (:103), para a tela mostrar com quem compartilhar.
2. Uma planilha real, para calibrar abas, colunas e a regra da semana.

**Lacuna de tela:** os blocos "Planilhas da semana de dd/mm" e "Briefings a fazer" na tela Hoje da Carteira estão no protótipo (`docs/specs/g8-fidelidade-diferencas.md:38`), mas não existem em `apps/web/src`.

**Próximo passo:**
1. A planilha é compartilhada como leitora com o e-mail da conta de serviço.
2. Clicar em "Ler planilha agora".
3. Ajustar `PLANILHA_DE_INDICADORES`, apelidos e títulos de coluna com testes.
4. Fechar a regra da semana.

## 5. Faixas de inadimplência no briefing

- O conteúdo fica em `apps/web/src/conteudo/roteiro-briefing.ts`, com `VERSAO_DO_ROTEIRO = '2026.11a'` (:34).
- Pergunta `inadimplencia` (:586): "Não há / Pouca / Relevante".
- Pergunta `inadimplencia_faixa` (:592-597): hoje "Até R$ 5 mil · De R$ 5 mil a R$ 20 mil · De R$ 20 mil a R$ 50 mil · Acima de R$ 50 mil · Não sabe", com a dica "Só a faixa. Nunca o nome de quem deve." **Esses valores são placeholder nosso.** O gate LGPD A59 (`docs/specs/g8-gate-lgpd.md:228`) só exige "escolha fechada + faixa".
- ⚠️ **Divergência a resolver:** o pedido enviado à cliente dá como exemplo faixas **em percentual** ("até 5%, de 5% a 10%, acima de 10%"), mas o código usa faixas **em reais**. Pergunte qual das duas ela quer: percentual de quê (do faturamento?) ou valor absoluto.

**Próximo passo:** trocar só o array `op` em :595 e subir `VERSAO_DO_ROTEIRO`. Os testes `roteiro-sem-gravar.test.ts` e `roteiro-ensaio.test.ts` precisam continuar passando.

## 6. Texto do jurídico para o briefing

**Pedido:** a autorização e o aviso de privacidade aprovados pelo advogado, para gravar as respostas de clientes reais.

**Como o bloqueio funciona hoje:**
- Não é uma flag: é ausência por desenho. Não há tabela `diagnosticos`, nem rota, nem gravação (ADR 0013 §1).
- A tela mostra uma faixa fixa: "Ensaio: nada é salvo. Não use com uma cliente real." (`apps/web/src/components/carteira/roteiro-ensaio-tela.tsx:109`).
- `roteiro-sem-gravar.test.ts` varre o código dos arquivos `roteiro-*` e reprova fetch, localStorage e área de transferência.
- "Copiar relatório" fica desligado no ensaio (A3).

**Referências:**
- D-22 item 5 (`docs/decisoes.md:616`);
- `docs/specs/g8-gate-lgpd.md`: vereditos 1b, 1c e 1d **vetados** (:18-35), §8 A1–A5 e §10 Etapas 0 a 3 (:266-345).

**O que falta do jurídico:**
- **Etapa 1:**
  - cláusula de privacidade no contrato de consultoria: a Firmare é controladora; o que é coletado, para quê, por quanto tempo, e a **hospedagem nos EUA** (a VPS fica em Boston, D-11, art. 33);
  - aviso de privacidade para cliente e lead;
  - LIA das "impressões".
- **Etapa 2** (transcrição): o texto de ciência dos participantes.
- **Etapa 3** (IA): DPA do provedor, retenção zero, sem treino.
- **Do dono:** aceitar que as "impressões" ficam acessíveis à titular.

**Decisão pendente separada** (handoff 08/11 §5.1.1): restaurar o **Mapa de Maturidade no ensaio**. O cálculo em memória é permitido (A3); só o gravado é vetado (B8). A recomendação é restaurar, com o cálculo em `packages/domain`. A versão guardada ficou na máquina anterior (`scratchpad/3e-mapa-guardado/`).

**Relacionado:** o DPA com cada clínica (`docs/o-que-depende-de-voce.md` §4). Nós escrevemos o anexo técnico.

**Próximo passo quando o texto chegar:**
1. ADR nova que substitui a 0013 §1 para `diagnosticos`.
2. Migration com RLS por grupo e retenção (§9 do gate).
3. Rotas com `@DadoSensivel`.
4. Mapa de Maturidade gravado (B8).
5. A faixa e o teste "sem gravar" passam a cobrir só o ensaio.

## 7. Migração das clínicas (a entrega com prazo real)

**Pedido:** "o banco de dados da Firmare atual". Na prática, a v20 roda em Google Sheets, então o que precisamos é **a cópia `.xlsx` atual de cada uma das 4 clínicas** e a pasta `versoes/v20-producao/` (o `Code.gs`, que é a definição do que os dados significam).

**Código pronto** (commits `f0b1c7d` e `cb74fbc`):
- `apps/api/src/migracao/leitor-de-planilha.ts`: ZIP+XML próprio, que preserva o literal decimal da célula.
- `apps/api/src/migracao/migrador.service.ts`:
  - uma clínica numa única transação, pelo `fir_app` com RLS e ator `SISTEMA`;
  - idempotência por `origens_da_v20` (migration 0021);
  - adesão vira programa;
  - **não funde homônimos**;
  - reconcilia por `nome_chave` (:718).
- `apps/api/src/migracao/conferencia.service.ts`: as **seis conferências exatas** da regra 28. Em 09/11 a receita por campanha passou a usar o predicado `RECEITA_DA_CAMPANHA` (`campanhas/receita-da-campanha.ts`, N-2).
- Domínio em `packages/domain/src/migracao/` (`v20.ts`: abas Equipe, Pacientes, Unidades, Campanhas, Planos, Adesoes, Tarefas e Config; `celula.ts`, `conferencia.ts`, `plano-de-migracao.ts`). O plano traz as decisões que o migrador **recusa** tomar sozinho: `perfilPorPessoa`, `ativoPorNome`, `vivaPorNomeDeCampanha`, e o perfil `pf_sem`.
- CLI `apps/api/migrar-clinica.ts`, já na imagem:
  - `--clinica <codigo> --arquivo <xlsx> --decisoes decisoes.json`;
  - **ensaio com ROLLBACK por padrão**; `--valendo` grava;
  - o relatório sai sem dado que identifique paciente;
  - exige que a clínica já exista (criada pelo superadmin).
- `infra/producao/restaurar-ensaio.sh`.
- Docs: `docs/fila.md:238-269`, `docs/roadmap.md:72-83`, `docs/paridade.md:182-205`, ADR 0009 (conversão de valor), `docs/dividas.md` D0 (:11) e D-P3, D-16, D-19, e P-2, P-3 e **P-5** (janela).
- Item 6 da PO (migration 0062, "indicado por"): na migração, o campo de indicação por nome **não vira vínculo automaticamente**.

**Já medido em dado real** (3 planilhas de clínicas; D-16):
- 64 + 1 + 1 recebimentos sem forma de pagamento (ADR 0009);
- homônimos em Planos e em Campanhas;
- pessoas não-admin com funções de enfermagem, fisioterapia e comercial.

**A 4ª clínica não aparece em lugar nenhum.**

**Bloqueios:**
- Falta o `.xlsx` atual das 4 clínicas; nenhum está nesta máquina.
- Falta `versoes/v20-producao/`.
- Falta um `decisoes.json` por clínica, revisado com cada uma.
- **P-5**: qual clínica primeiro, que dia e quanto tempo a v20 fica em paralelo. Recomendação: a menor, fora do horário, uma semana com a v20 só leitura.
- **DPA** (P-2/P-3) antes da primeira clínica real.
- Os PINs da v20 não atravessam: o admin de cada clínica redefine as senhas (D-16).
- Ao migrar a primeira clínica real, dispara o gatilho da **D-24**: fechar `IPS_DO_PAINEL`, porque o `/superadmin` hoje está aberto a qualquer IP.
- **Risco que corre sozinho:** a v20 tem autenticação fraca por desenho (D0). Cada semana de atraso é uma semana exposta. O detalhe está em `seguranca-v20-local.md`, fora do repo.

**Próximo passo:**
1. Criar a clínica pelo superadmin.
2. Rodar `migrar-clinica.ts` **em ensaio** contra a cópia real.
3. Resolver cada impedimento com a clínica e montar o `decisoes.json`.
4. Repetir até "CONFERÊNCIA FECHADA — os seis totais batem exatamente".
5. Passar pelo veto de `validador-numeros` e `engenheiro-migracao`.
6. Rodar `--valendo` na janela combinada.

Um único paciente divergente reprova a clínica inteira (regra 28).

---

## Ordem sugerida quando o material chegar

1. **Agenda e prints** (itens 1 e 2): é o que já está pronto e só falta calibrar. Mostra valor rápido à cliente.
2. **Planilha** (item 4): depende da conta de serviço, que é tarefa do dono e não da cliente. Peça as duas juntas.
3. **Migração** (item 7): é a entrega com prazo. Comece o ensaio assim que o primeiro `.xlsx` chegar, mesmo antes da janela.
4. **Faixas** (item 5): uma linha de código, depois de resolver a divergência entre percentual e reais.
5. **Rotinas automáticas** (item 3) e **briefing gravado** (item 6): dependem de documento externo e passam pela pipeline completa (spec → gates → tickets).

Em paralelo, sem depender da cliente: **o item 8 da PO (Setor de atuação, ADR 0025)** está pronto para construir.

## Cuidados que valem para todos

- O repo é **público**: nenhum dado real de paciente, planilha, link de agenda, credencial ou JSON de conta de serviço entra nele.
- Links de agenda e planilhas são segredos: ficam no banco ou no `.env` da VPS, nunca no chat, em log ou em commit.
- Senhas em produção quem digita é o dono. Contas em produção são criadas pelo dono.
- Fluxo do CLAUDE.md: spec → gate de risco → tickets → TDD. E `pnpm typecheck && pnpm test && pnpm build` antes de dizer que está pronto.
