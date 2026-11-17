# Recaptação e rotina cumprida passam a ser derivadas, para o KPI da clínica

**Status:** aceita, 2026-11-17. **Substitui em parte** a [ADR 0014](0014-tres-campos-de-telemetria-sem-fonte-ficam-fora.md). **Spec:** `docs/specs/indicadores-e-insights.md` (I-12, I-13), ticket T1.

## Contexto

A ADR 0014 tirou `rotinas_previstas`, `rotinas_cumpridas` e `recaptacoes` da telemetria da carteira porque nenhum dos três tinha fonte. Não havia entidade `Rotina`, e a recaptação era só um filtro de candidatas (`sem-retorno`), sem o evento "voltou". A 0014 deixou a porta aberta: *"primeiro a FIR Clinic precisa saber contar essas coisas para si mesma, depois a carteira sincroniza"*.

Indicadores & Insights pede exatamente os dois números **para a própria clínica**: os KPIs `pacientes_recaptados` e `rotinas_cumpridas` do catálogo.

## Decisão

Os dois números são **derivados** de dado que já existe. Nenhum evento novo é gravado, e nenhuma entidade `Rotina` nasce.

1. **Recaptação (I-12).** Paciente distinta com atendimento no período (tarefa concluída de `TIPOS_QUE_ATENDEM`, paciente ativa) cujo atendimento anterior foi **182 dias ou mais** antes. Quem não tem atendimento anterior não conta: é paciente nova, e já está em `novos_pacientes`.
   - O 182 é `DIAS_SEM_RETORNO`, que sai de `pacientes.service.ts` e mora no domínio (`indicadores/jornada.ts`). O filtro `sem-retorno` e o KPI usam a mesma constante. A regra pura é `ehRecaptacao`.
2. **Rotina cumprida (I-13).**
   - **Previstas:** tarefas vivas com `serie_id IS NOT NULL OR marcador IS NOT NULL`, fora de `TIPOS_DE_SESSAO`, não canceladas, com prazo em `[início, min(fim, hoje + 1))`.
   - **Cumpridas:** as previstas com status `concluida`.
   - "Rotina" é o que nasce de uma série ou de um marcador: tarefa recorrente ou criada por um ritual. A sessão de programa fica fora porque é atendimento, não rotina de gestão.

## O que continua valendo da 0014

- **A telemetria da carteira continua sem os três campos.** Esta ADR decide o número **da clínica**, não o que atravessa para a Firmare. O que atravessa para a carteira é a ADR do T10, que emenda a 0013 (appsec C28). A spec põe "telemetria de recaptados e rotinas na carteira" fora de escopo.
- O princípio **não se grava o que não existe na fonte** continua. Os dois números são calculados na leitura, e o histórico começa no que as tarefas já registram.

## Alternativas descartadas

- **Gravar um evento "recaptada" no atendimento.** Duplicaria um fato que o histórico de tarefas já tem, e o evento divergiria dele no primeiro atendimento reaberto.
- **Uma entidade `Rotina` com previstas declaradas.** É modelagem nova de produto. O protótipo não a tem, e a série mais o marcador já dizem o que a clínica instalou como ritual.

## Consequências

- O número de recaptados muda se um atendimento antigo for reaberto ou excluído. É a mesma propriedade de todo número derivado do histórico, e está certa: o fato mudou.
- As consultas dos dois KPIs entram no T2, como fontes da `CalculadoraDeKpi`. A parte pura (`ehRecaptacao`, `DIAS_SEM_RETORNO`) é deste ticket.
