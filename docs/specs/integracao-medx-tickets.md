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

## T5 — Leitura de faturamento (C.0–C.7)
`Dinheiro.deDecimalExterno` + 16 propriedades; tabela + histórico; jobs horário e noturno. Só liga depois da calibração C.0.

## T6 — Telas (A e D)
Gestão → Clínicas → Integrações; bloco só leitura em Configurações → Agenda do sistema.

## T7 — Indicadores MedX (C.8–C.11)
Com a Entrega 1.
