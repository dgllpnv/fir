# Tickets — Integração com o MedX

Spec: [`integracao-medx.md`](integracao-medx.md). Ordem: T1 → T2 → T3 → T4 → T6 → T5 → T7 (T3 pode correr em paralelo a T1/T2). Cada ticket fecha com `pnpm typecheck && pnpm turbo run test --concurrency=1 && pnpm build`.

**Seams desta entrega** (acordados, de `docs/arquitetura/sistema.md`): HTTP da API · repositórios sobre Postgres real · `packages/domain` puro · `LeitorDoMedx` (novo, T2) · `AgendaProvider` (T3).

---

## T1 — Cofre, termo e configuração (spec A.0–A.10, E.1, E.6) — **feito** (16/11)

**Banco (migration 0092)**
- [x] Papel `fir_integracoes` (LOGIN, sem BYPASSRLS/SUPERUSER/CREATEROLE): `infra/bootstrap-papeis.sql`, `infra/producao/provisionar-integracoes.sh`, chamado por `implantar.sh` antes das migrations. A 0092 falha alto se ele faltar ou tiver privilégio.
- [x] `integracoes_da_clinica`: uma por clínica (`UNIQUE clinica_id`), `provedor CHECK ('medx')`, `segredo_cifrado bytea`, `segredo_versao`, `final_da_chave`, `impressao_da_chave` (HMAC hex, `UNIQUE (provedor, impressao_da_chave)` global), `conta_externa_id` (`UNIQUE (provedor, conta_externa_id)` global), termo (`termo_assinado_em`, `termo_assinado_por`, `termo_versao`), `verificacao` (estado, quando, usuário, scopes, unidades, erro do catálogo), `agenda_ligada`, `faturamento_ligado`, `meta_medida_por`, `status_de_cancelado int[]`.
- [x] RLS `ENABLE` + `FORCE`, policy por `app_clinica_id()`, trigger `registrar_auditoria`.
- [x] GRANT por coluna: `fir_painel` escreve tudo e lê tudo **menos** `segredo_cifrado`; `fir_app` lê só as colunas de estado (bloco D) e nunca `segredo_cifrado` nem `impressao_da_chave`; `fir_integracoes` lê `segredo_cifrado` + versão e grava só a verificação. Ninguém tem DELETE.
- [x] `impressao_da_chave` na denylist de `auditoria_sem_segredos` (`segredo_cifrado` já está, 0055).

**Cofre (`apps/api/src/integracoes/cofre-de-integracoes.ts`)**
- [x] Selar com a pública (X25519 efêmero + HKDF `fir:integracoes` + AES-256-GCM), AAD `integracao:<clinica_id>:medx:v<n>`. Abrir só com a privada (worker). Impressão HMAC com pepper próprio.
- [x] Variáveis `FIR_INTEGRACOES_CHAVE_PUBLICA` + `FIR_INTEGRACOES_PEPPER` (api) e `FIR_INTEGRACOES_CHAVE_PRIVADA` (worker), geradas uma vez por `implantar.sh`; ausentes em produção = erro na subida.
- [x] Testes: ida e volta; AAD de outra clínica não abre; versão errada não abre; bytes adulterados não abrem; a API sem privada não abre; impressão estável e diferente entre tokens.

**Rotas `/v1/superadmin/clinicas/:id/integracoes`** (só Operador)
- [x] `GET` mascarado (S-9: forma exata).
- [x] `PUT .../chave` grava selado, `final_da_chave`, impressão; verificação volta a "não verificada"; agenda e faturamento desligam; mesma chave em outra clínica → 409.
- [x] `DELETE .../chave` põe `NULL` em segredo e impressão, desliga tudo.
- [x] `PUT .../termo` registra o termo.
- [x] `PUT .../ligacoes` liga/desliga agenda e faturamento: ligar exige termo + verificação verde com `conta_externa_id`; faturamento exige o escopo de finanças.
- [x] `POST .../testar` enfileira o teste (payload só `{ clinicaId, pedidoId }`), limite 1/30 s e 10/h por clínica e por operador → 429. A execução do teste é do T2.
- [x] Trilha do painel em toda escrita, sem segredo; teste de que nenhum `de`/`para` de `auditoria` nem `auditoria_do_painel` contém ciphertext, impressão ou token.
- [x] Sessão de clínica não alcança nenhuma dessas rotas.
- [x] Linhas de retenção em `docs/compliance/retencao.md` (`segredo_cifrado`, termo).

## T2 — `LeitorDoMedx` + execução do Testar conexão (E.2–E.5, A.3–A.5, A.11) — **feito** (16/11)
Cliente só de leitura, host fixo por ambiente, sem redirect, `lookupSoPublico`, JSON-only, Zod estrito por página, cursor com teto, cache de JWT em memória por `(clinicaId, impressão)`, catálogo de erros, `Retry-After` sem dormir. O worker processa o job de teste: token → `usuario-atual` → `financas/unidades`, compara scopes com a lista branca e grava a verificação. Servidor MedX falso local com os casos de abuso.

## T3 — `AgendaProvider` de verdade (B.9) — **feito** (16/11)
- [x] `AgendaProvider` (`agenda/agenda-provider.ts`) com `AgendaPorIcal` e `AgendaDoMedx`; a conciliação é uma só, parametrizada pelo provedor.
- [x] Migration 0093: `provedor` em `('ical','medx')` nas duas tabelas; link só no iCal (`CHECK`); a linha única por clínica é a trava dos dois.
- [x] O painel liga a agenda do MedX na linha da clínica (responsável: o administrador ativo mais antigo); com o iCal ativo, 409. Desligar, trocar ou remover a chave tira o MedX da leitura.
- [x] `PUT /v1/agenda-externa` recusa o iCal com o MedX ligado (409); `GET` devolve `provedor`.
- [x] Suíte do iCal inalterada: `sincronizacao.e2e.test.ts` 21/21 sem mudar uma linha.

## T4 — Agenda do MedX → cartões (B.0–B.13) — **feito** (16/11), menos B.13 (aceite numa clínica real)
- [x] B.0 lista branca no Zod; `/contatos/{id}` só sem vínculo, só para consulta que vai virar cartão, até 50 por ciclo.
- [x] B.1 janelas `[hoje,+31)` e `[+31,+60)` no relógio `-03:00` (`borda-do-medx.ts`, com propriedade de ida e volta); offset diferente avisa.
- [x] B.2 tudo ou nada; a trava de vazio por janela roda **depois** da confirmação (ADR, decisão 2).
- [x] B.3 mesmo fluxo do iCal; B.4 confirmação por id (`nao_encontrado` novo no catálogo); B.5 HMAC na UNIQUE.
- [x] B.6 id do MedX → telefone → nome; B.7 desativado e supressão não voltam (paga D-L1, também no iCal).
- [x] B.8 `PUT .../status-de-cancelado` no painel (0–12); vazio = só o sumiço confirmado desmarca.
- [x] B.10 cooldown de 2 min no servidor (429); B.11 nome NFC sem controle nem bidi, telefone e id validados; B.12 `ciclos_da_agenda_externa`, 1 ano.
- [x] E.6 retenção em `retencao.md`; dívidas novas D-L2 (troca iCal → MedX), D-L3 (girar a privada), D-L4 (job dos vínculos).
- [ ] B.13 uma semana numa clínica real (depende da primeira clínica e do termo).
- Fica para o T6: ler os nomes dos status de `GET /agenda/catalogos` para o superadmin escolher, e o bloco da clínica com os ciclos (D.1).

## T5 — Leitura de faturamento (C.0–C.7) — **feito** (16/11), **sem a C.0**
- [x] `Dinheiro.deDecimalExterno` (gramática fechada, meio para longe do zero, exato em dezmilésimos) e `totaisPorDia` em `packages/domain`, com as propriedades 1–9 do parecer; 10, 11 e 15 no e2e; 12 (dia do pagamento em 4 fusos) na borda.
- [x] Leitor com reviver: o número do MedX chega como o TEXTO do JSON.
- [x] Migration 0095: `leituras_de_faturamento_externo` (um total por dia lido, inclusive zero) e `historico_de_faturamento_externo` (append-only), RLS, trilha; estado da leitura em `integracoes_da_clinica`.
- [x] `FaturamentoDoMedx`: `lancamentos` a receber pagos, pela data do pagamento; **`valorOriginal`, só de fatura** (ADR `2026-11-16-faturamento-do-medx`); tudo ou nada; trava de vazio; advisory lock; só o dia que mudou é escrito; leitura superada não grava.
- [x] Job `faturamento` de hora em hora no worker; releitura de 13 meses depois das 02:00 da clínica, na primeira leitura e quando o fuso muda.
- [x] E2e (18) contra Postgres real e teste de arquitetura (`teste/arquitetura-do-faturamento-externo.test.ts`).
- [ ] **Calibração C.0** na primeira clínica, antes de ligar o faturamento em qualquer uma. Itens novos: `valorOriginal` contra o relatório de recebidos; fatura cancelada com pagamento; sinal de orçamento com ou sem `faturaId`.

## T6 — Telas (A e D) — **feito** (16/11)
- [x] Migration 0094: `catalogo_de_status` (`[{id, nome}]`), gravado pelo worker no teste verde a partir de `GET /agenda/catalogos` (só `status`, nome limpo por `nomeSeguro`); falha do catálogo não derruba o teste e mantém o anterior. Spec A.4 atualizada.
- [x] `GET` do painel ganha `catalogoDeStatus` e `agenda` (estado técnico: ativa, última leitura, último sucesso, erro, resumo e os 10 últimos ciclos). `GET /v1/agenda-externa` ganha `ciclos` (vazio no iCal). Leitura comum em `agenda/estado-da-agenda.ts`.
- [x] Gestão → Clínicas → [clínica] → **Integrações** (`gestao/clinicas/[id]/integracoes`): Só FIR ou MedX; 1. termo; 2. chave (campo de senha, só o final, trocar e remover com o aviso de revogar no MedX); 3. testar conexão (pergunta de novo a cada 3 s enquanto "testando"); 4. o que liga; 5. status de cancelado pelo nome; leituras da agenda com os ciclos. Dossiê e navegação Pessoas | Integrações em `clinicas/[id]/dossie.tsx`.
- [x] Configurações → Agenda do sistema: com o MedX ligado, bloco só leitura ("Ligada ao MedX", leituras, erro, resumo com paciente desativado, as últimas leituras, Sincronizar agora com o 429 do servidor); sem formulário de link. MedX desligado: o formulário do iCal como na primeira vez.

## T7 — Indicadores MedX (C.8–C.11) — **feito** (16/11); exibe só o que o T5 leu, então também espera a C.0
- [x] Painel: bloco **Faturamento no MedX** com o selo "lido do MedX às HH:MM" (último sucesso, ou a releitura de 13 meses quando o período começa antes do dia 1º do mês anterior) e "leitura incompleta" quando falta dia; **Conferência MedX × FIR** lado a lado (FIR = `recebidosDaJanela`, a mesma consulta da Visão do mês), `diferencaMedxFir`, resíduo de arredondamento (`arredondamentoDoMedx`, de `totalExato` em dezmilésimos) e os dias com diferença em array. Só sai o bloco com o faturamento ligado (`medx: null` fora disso).
- [x] C.9: tudo por dia passa pelo `RecorteDeCaixa` — só dias de caixa fechado; `diasSemCaixa` conta os não fechados com número em qualquer lado. Teste de transporte: com o caixa de hoje aberto, nenhum número de hoje está na resposta.
- [x] C.10: migration 0096 (`metas_do_mes.medida_por`, copiada do padrão da clínica ao gravar a meta); `medidoParaAMeta` e `atingimentoDaMetaDoMes` em `packages/domain`, usados pela Visão do mês e por `/v1/metas/:mes/percentual`; MedX incompleto → sem percentual e sem "faltam". Padrão da clínica na tela de Integrações ("A meta do mês é medida por"), MedX só com o faturamento ligado; desligar o faturamento volta o padrão à FIR.
- [x] C.11: nomes em `CAMPOS_MONETARIOS` e em `teste/registro.ts`; sem `valores`, `/percentual` entrega só `percentual`, `medidaPor` e `lidoEm`; o Painel inteiro é 403 sem `valores` (`painel` → `valores`); a trilha de uma substituição sai sem centavos nem contagem de pagamentos — com prova por mutação.
- [x] E2e `indicadores-do-medx.e2e.test.ts` (12), mais o padrão da régua em `integracoes-no-painel.e2e.test.ts`; mutações conferidas: sem o corte do caixa, sem a régua gravada com a meta, sem `faturamentoLido` na lista da redação.
