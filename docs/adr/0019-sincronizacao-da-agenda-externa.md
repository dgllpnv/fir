# ADR 0019 — Sincronização da agenda do sistema da clínica (iCal)

**Status:** aceita · 2026-11-08
**Origem:** "Prioridade 1 · Sincronização da agenda", documento de novas funcionalidades da cliente.
**Spec:** `docs/specs/agenda-sincronizacao.md`

## Contexto

O agendamento nasce no sistema principal da clínica (Amigo, Support Health, iClinic). Hoje a
recepção o lança duas vezes: lá e na FIR. A cliente pediu que o compromisso da agenda crie e
mantenha sozinho o cartão da jornada, lendo a cada 15 minutos o Google Agenda ou o link iCal
que o sistema da clínica sincroniza.

A P-7 (o que exatamente cada sistema exporta) continua aberta. Construímos sobre o **menor
denominador comum**, que é o iCal (RFC 5545): o Google Agenda expõe o "endereço secreto em
formato iCal", e os sistemas que exportam agenda exportam nesse formato. Um adaptador de API
própria do Amigo, se um dia existir, entra atrás da mesma porta (`AgendaProvider`).

## Decisões

1. **Fonte: um link iCal por clínica** (`agendas_externas`, uma linha por clínica). `webcal://` vira
   `https://`. O link é um segredo, porque dá leitura da agenda de pacientes: ele **nunca volta
   inteiro para a tela** (só o host e os 4 últimos caracteres) e **nunca vai para log**.
2. **Quem busca é um worker próprio** (`worker-agenda`), não a API. A API mora numa rede sem rota de
   saída (é o desenho da produção), e conteúdo externo não é interpretado no processo que serve
   o balcão. "Sincronizar agora" enfileira um job, e o worker o executa.
3. **SSRF fechado no `lookup`**: só `https`, porta 443, e todo endereço resolvido que for
   privado, loopback, link-local, CGNAT ou multicast é recusado no momento da conexão. Isso cobre
   também o rebinding de DNS. Prazo de 20 s, teto de 5 MB e no máximo 3 redirecionamentos,
   cada um validado de novo.
4. **Idempotência** pela chave `(clinica_id, provedor, uid_externo)` em `compromissos_externos`
   (regra 26). Ocorrência de evento recorrente: `uid|RECURRENCE-ID`. Ler o mesmo feed três vezes
   não cria nada.
5. **Vínculo com paciente**, nesta ordem, como a cliente especificou:
   telefone → nome exato (a mesma `normalizar_nome` do índice único) → **cadastrar** com nome e
   telefone do compromisso e marcar `pacientes.conferir_cadastro`. O nome exato é o mesmo
   critério que a tela Nova tarefa já usa para escolher a paciente sozinha (protótipo). Quando o
   telefone casar com mais de uma paciente, desempata pelo nome. Sem desempate, liga à mais antiga
   e marca `conferir_cadastro`, para que alguém confira.
6. **O que a agenda faz com o cartão** (regra 27: a conciliação sugere, nunca sobrescreve):

   | Na agenda | Cartão em `agendado`/`confirmado` | Qualquer outra etapa, ou cartão excluído |
   |---|---|---|
   | compromisso novo | cria `Consulta agendada`/`Procedimento agendado` em `agendado` | — |
   | data ou hora mudou | `reagendar` (evento no histórico, "de X para Y") | nada |
   | removido ou `CANCELLED` | `desmarcar` → entra em **Recontatar** | nada |
   | já passou sem conclusão | nada: continua aberto em Hoje e nos pendentes | nada |

   `desmarcou` **não é cancelamento**: o cartão continua aberto e cai em Recontatar, onde uma
   pessoa decide. É a forma exata de "proposta de recontato" da regra 27. Confirmação, falta,
   conclusão e exclusão feitas à mão nunca são desfeitas, e **um cartão excluído nunca é recriado**,
   porque o vínculo `uid → tarefa` sobrevive à exclusão.
7. **Remoção exige feed saudável.** Se a leitura falhar, nada muda. Se o feed vier vazio e houver
   compromissos futuros conhecidos, a rodada é abortada com erro visível ("feed vazio"), em vez
   de desmarcar a agenda inteira. Só conta como removido o que estava no futuro e dentro da
   janela (hoje até +60 dias). Um compromisso não recorrente movido para depois da janela continua
   "visto".
8. **Consulta × procedimento**: é `Procedimento agendado` quando o título ou a descrição contém a
   palavra "procedimento" ou o nome de um procedimento ativo do catálogo da clínica. Caso
   contrário, `Consulta agendada`.
9. **Autoria**: os eventos do histórico gravam `porId = 'sistema'`, com a nota "pela agenda do
   sistema". **Decisão do dono (2026-11-08): cartão da agenda não conta na meta de agendamentos de
   ninguém.** O funil continua contando (ele conta por ação, não por pessoa). Responsável e
   solicitante do cartão são a pessoa configurada na agenda (a coluna é `NOT NULL`, e a trilha de
   auditoria grava `sistema` como ator).
10. **O que fica de fora**: eventos de dia inteiro, eventos cujo título contém uma palavra da lista
    de ignorar da clínica (padrão: bloqueio, almoço, reunião, férias, feriado, intervalo) e
    eventos sem nome extraível. Eventos já cancelados que nunca vimos não criam nada.

## Consequências

- A meta "agendamentos" perde sentido nas clínicas sincronizadas. A de confirmações continua valendo.
- A extração de nome e telefone do título é **heurística**, porque a P-7 não respondeu o formato.
  O primeiro teste na clínica piloto (uma semana, agenda × cartões) é o que calibra a extração.
  A heurística mora em `packages/domain/src/agenda.ts`, com testes, e é o único ponto a ajustar.
- Novo container em produção (`worker-agenda`), com rede de saída. É o primeiro worker a subir
  em produção: os da carteira continuam sem registro em `infra/` (dívida já anotada).
