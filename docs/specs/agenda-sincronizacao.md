# Spec — Sincronização da agenda do sistema da clínica

**Prioridade 1 da cliente** · decisões em [ADR 0019](../adr/0019-sincronizacao-da-agenda-externa.md)

## Problema

A recepção lança o mesmo agendamento duas vezes: no sistema da clínica e na FIR. A FIR deve
registrar a continuidade (confirmação, falta, recontato, orçamento, pós), não a agenda.

## Critérios de aceite

1. Quem tem `config` cola o link iCal da agenda e escolhe o responsável pelos cartões. Pode
   desligar, trocar o link e pedir "Sincronizar agora". A tela mostra a última leitura, o último
   erro e o resumo (criados, reagendados, desmarcados, ignorados). O link nunca volta inteiro.
2. A cada 15 minutos, em cada clínica com agenda ativa:
   - compromisso novo → cartão `Consulta agendada`/`Procedimento agendado`, etapa `agendado`, com
     data, hora (no fuso da clínica) e paciente;
   - data ou hora mudou → o mesmo cartão é reagendado, com o evento no histórico;
   - removido ou cancelado → o cartão vai para `desmarcou` e aparece em Recontatar;
   - já passou sem conclusão → nada muda.
3. Paciente procurada por telefone, depois por nome exato. Se não achar, é cadastrada com o nome e
   o telefone do compromisso e marcada "Conferir cadastro", e a marca aparece na lista de
   pacientes e no cartão. Salvar a ficha da paciente limpa a marca.
4. Cada compromisso liga a um único cartão. Ler o mesmo feed três vezes não cria nada.
5. Confirmação, falta, conclusão e exclusão feitas à mão nunca são desfeitas. Um cartão excluído
   não é recriado.
6. Leitura que falha não muda nada. Feed vazio com compromissos futuros conhecidos não desmarca nada.

## Tickets (fatias verticais)

| # | Fatia | Prova |
|---|---|---|
| T1 | Domínio puro: extrair nome, telefone e tipo; mesmo telefone; decidir a ação por compromisso | `packages/domain/src/agenda.test.ts` (exemplos + property) |
| T2 | Migration 0037: `agendas_externas`, `compromissos_externos`, `pacientes.conferir_cadastro`, com RLS e auditoria | `teste/` transversais (RLS, escrita sem RLS) |
| T3 | Leitor iCal (ical.js, recorrência expandida na janela) e download seguro (SSRF, prazo, teto) | `leitor-ical.test.ts`, `baixar-feed.test.ts` |
| T4 | Serviço de sincronização: conciliação dentro de `naClinica(SISTEMA)` | e2e contra Postgres real: criar, reagendar, desmarcar, idempotência ×3, manual vence, excluído não volta, feed vazio aborta, isolamento |
| T5 | Rotas `GET/PUT /v1/agenda-externa`, `POST /v1/agenda-externa/sincronizar` (`config`) e fila BullMQ | e2e: 403 sem `config`, link mascarado |
| T6 | Worker `worker-agenda` (a cada 15 min + sob demanda), bundle e compose de produção | build + imagem |
| T7 | Tela "Agenda do sistema" em Configurações e marca "Conferir cadastro" | typecheck, build, verificação no navegador |

## Fora de escopo

API própria de Amigo, Support Health ou iClinic (P-7). Unidade a partir do compromisso (usa a
unidade principal da paciente). Profissional do compromisso.
