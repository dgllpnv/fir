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

## T2 — `LeitorDoMedx` + execução do Testar conexão (E.2–E.5, A.3–A.5, A.11)
Cliente só de leitura, host fixo por ambiente, sem redirect, `lookupSoPublico`, JSON-only, Zod estrito por página, cursor com teto, cache de JWT em memória por `(clinicaId, impressão)`, catálogo de erros, `Retry-After` sem dormir. O worker processa o job de teste: token → `usuario-atual` → `financas/unidades`, compara scopes com a lista branca e grava a verificação. Servidor MedX falso local com os casos de abuso.

## T3 — `AgendaProvider` de verdade (B.9)
Interface da ADR 0019; adaptadores iCal e MedX; `CHECK` de `provedor` ampliado; um provedor ativo por clínica no banco; `PUT /v1/agenda-externa` recusa iCal com MedX ligado. Suíte do iCal inalterada.

## T4 — Agenda do MedX → cartões (B.0–B.13)
Lista branca, janelas e hora, tudo ou nada, confirmação por id, HMAC dos ids, supressão, paciente desativado (paga D-L1), cooldown, registro de ciclo, retenção.

## T5 — Leitura de faturamento (C.0–C.7)
`Dinheiro.deDecimalExterno` + 16 propriedades; tabela + histórico; jobs horário e noturno. Só liga depois da calibração C.0.

## T6 — Telas (A e D)
Gestão → Clínicas → Integrações; bloco só leitura em Configurações → Agenda do sistema.

## T7 — Indicadores MedX (C.8–C.11)
Com a Entrega 1.
