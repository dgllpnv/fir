# Revisão AppSec e LGPD do T9: relatórios 2 a 7, 9, 10, 12, 13 e 14, e "Criar campanha com esta lista"

**Revisor:** especialista-seguranca-appsec · **Data:** 2026-11-17 · **Escopo:** o diff não commitado em `backlog-final-indicadores-e-acesso` (`relatorios/consultas/*`, `relatorios/campanha.service.ts`, `campanhas.service.ts` `criarNaTransacao`/`adicionarPacientesNaTransacao`, migration 0106, `contracts/relatorios.ts`, ADR `2026-11-17-relatorios-t9-fontes-e-campanha-da-lista.md`). Esta revisão **substitui o `claude-security:scan` (C30) do T9**.

**Prova:** `apps/api/src/relatorios/appsec-t9.e2e.test.ts`, com 13 testes contra o Postgres real, **13 de 13 verdes**. Os testes `it.fails` são achados reproduzidos: cada um afirma o comportamento seguro e hoje falha. Quando a correção entrar, troque `it.fails` por `it`.

## Veredito: **APROVADO**

Não há bloqueio. Nenhum dos vetos se aplica: a rota tem autorização no servidor, nenhum valor atravessa sem `valores`, a redação continua num ponto só, nenhum dado vai a log e nenhuma credencial ou dado cruza de uma clínica para outra. Os três achados abaixo não bloqueiam e entram como correção ou dívida, cada um com o seu gatilho.

## Achados que não bloqueiam

### M1 — A mesma `Idempotency-Key` com outro corpo acrescenta outra lista à campanha da primeira chamada (ADV-1, reproduzido)

- **Onde:** `apps/api/src/campanhas/campanhas.service.ts:579-587` (a repetição devolve a campanha só pela chave), `apps/api/src/relatorios/campanha.service.ts:60-64` (as tarefas da **nova** lista entram nessa campanha) e `apps/api/migrations/0106_campanha_chave_de_idempotencia.sql:19` (não guarda nenhuma impressão do pedido).
- **Medido:** a primeira chamada é o relatório 2 com 3 meses e a campanha "A". A segunda usa a mesma chave, o relatório 2 com 12 meses e a campanha "B". Ela devolve `200` e a mesma `campanhaId`, a campanha "B" nunca existe, e a paciente que só aparece no recorte de 12 meses ganha tarefa na campanha "A". É o caso que a C22 quer evitar: a campanha fica diferente da que a pessoa viu.
- **Por que não bloqueia:** a segunda chamada passa por todas as conferências de novo (`preparar`, `campanhas.gerir`, `valores`, destino e responsável). Não há escalada de privilégio e nada cruza para outra clínica (ADV-2). O risco é de integridade, causado por um cliente que reaproveita a chave.
- **Correção:** gravar ao lado da chave um hash do pedido canônico (`chave`, filtros já parseados, destino e tarefa). A repetição com hash diferente responde `422`, ou `409`, e não toca em nada. Depois disso, o ADV-1 passa como `it`.

### M2 — No relatório 14, o `tarefaId` da linha anônima leva de volta à paciente (ADV-11, reproduzido)

- **Onde:** `apps/api/src/relatorios/consultas/jornada.ts:100` e `packages/contracts/src/relatorios.ts:735` (`tarefaId: Uuid`, que não aceita `null`).
- **Medido:** paciente desativada por `pediu-para-sair`. A linha sai com `nome: null` e `pacienteId: null`, como pede a decisão 4 da ADR. Só que `GET /v1/tarefas/:tarefaId` (quem tem `jornada`) devolve `200` com o id **e** o nome dela. Na anonimizada o nome já está apagado na origem, então ali não vaza nada.
- **Por que não bloqueia:** a mesma pessoa já chega a essa tarefa pela lista e pela ficha. O relatório não abre acesso novo, mas o anonimato que ele promete é só aparente. A exportação não vaza nada: `tarefaId` não é coluna, e o ADV-10 confirma zero linhas em `pacientes_da_exportacao`.
- **Correção:** `tarefaId: null` quando `paciente === null`, com o contrato passando a `Uuid.nullable()`. A contagem do KPI não depende do id.

### M3 — Relatório 7: dia/mês junto com a idade dá a data completa de nascimento (decisão de LGPD)

- **Onde:** `apps/api/src/relatorios/consultas/pacientes.ts:284-285` e `packages/contracts/src/relatorios.ts:657-658`.
- **Por quê:** com `diaEMes = 24/10`, `idade = 36` e a data de hoje, o ano de nascimento fica exato (1990). A I-38 põe "data completa de nascimento" na coluna "Nunca", mas as duas colunas que ela mesma lista permitem reconstruí-la. A implementação segue o spec à risca. O problema está no spec.
- **Encaminhamento:** `especialista-lgpd-saude` decide entre tirar `idade`, trocar por faixa etária ou aceitar o residual por escrito na ADR. **Gatilho:** antes da primeira exportação do relatório 7 numa clínica real.

## Observações (sem ação no T9)

- **O1.** Medi 10 rodadas de 3 pedidos concorrentes com a mesma chave e o mesmo nome: 30 respostas `200`, uma campanha por rodada e nenhum `5xx` (ADV-5). Em teoria, a checagem da UNIQUE `campanha_por_nome`, que não é a árbitra do `ON CONFLICT`, pode responder `409` "nome repetido" em vez de devolver a mesma campanha. Isso não apareceu. Se aparecer, o efeito é de experiência de uso, porque continua existindo uma campanha só.
- **O2.** No relatório 12, `itensDaAnalise(c)` e `movimentosDosItens` (`consultas/financeiro-e-estoque.ts:168`) filtram a clínica **só pela RLS**, sem `clinica_id` na aplicação. A RLS é a primeira camada e o isolamento está garantido. O que falta é a segunda camada da regra 19. É o mesmo molde do relatório 11, que o T8 aceitou.
- **O3.** A dica da L-IN-13 ("Usar procedimento para campanha depende da finalidade combinada com a clínica.") ainda não está em `apps/web`. Fica para o T9 web, que está em andamento.

## Conferido na fonte

| Condição | Estado | Prova |
|---|---|---|
| **C20**: `indicadores`, a permissão do relatório, `campanhas.gerir` e `valores` com faixa, e `pacienteIds` recusado | ok | `relatorios.controller.ts:159` `@Exige('indicadores')`; `motor.ts:206-209` (`podeAbrirRelatorio`, faixa vale `403` antes do parse, inclusive `null`); `campanha.service.ts:43`; `.strict()` em `contracts/relatorios.ts:936-942`. ADV-6, ADV-7 e ADV-8, além do teste do T9 |
| **C21**: idempotência na nova | ok, com M1 | UNIQUE `(clinica_id, chave)` em 0106, e o `SELECT` da repetição filtra a clínica (ADV-2). Uma campanha excluída não volta: `409` (ADV-4). Três pedidos concorrentes dão uma campanha (ADV-5) |
| **C22**: tudo ou nada | ok | `campanha.service.ts:53-58`, dentro da transação de `comALista` (`motor.ts:348-359`). Com 2.001 pacientes: `422` e zero linhas (teste do T9) |
| **C23**: destino, responsável e tipo | ok | `campanhas.service.ts` exige campanha viva e da clínica e responsável `ativo` da clínica. `tipoQueNaoEhPagamento` é uma lista fechada. Destino de outra clínica ou excluído: `422` (ADV-3) |
| **C29**: log sem conteúdo | ok | `FiltroDeErroDeRelatorio` loga só o código. A captura do teste do T9 não encontra nome, telefone nem o nome da campanha |
| **L-IN-2**: 5 e 13 | ok | `exigeTambem: ['jornada']` no 5, e a permissão do 13 é `jornada`. Com `programas` e sem `jornada`: `403`, também pela campanha (ADV-8) |
| **L-IN-6**: colunas | ok, com M3 | Os schemas de linha são `.strict()` e iguais à I-38. O 4 não traz o nome nem o id das indicadas, nem na tela nem no CSV com telefone (ADV-9) |
| **L-IN-13**: nada de saúde copiado | ok | O 5 filtrado por procedimento não deixa o nome nem o id do procedimento na campanha nem nas tarefas (ADV-8). A origem fica só na auditoria, por id |
| **L-IN-14**: desativada, anonimizada e `pediu-para-sair` ficam fora | ok | `p.ativo` na consulta e de novo em `adicionarPacientesNaTransacao`. A anonimização só existe sobre paciente desativada. No 14, a paciente que saiu não entra na lista, que fica vazia e dá `422` (ADV-10) |
| **Redação**: dinheiro com nome novo | ok | Toda coluna `dinheiro` e todo resumo em centavos está em `CAMPOS_MONETARIOS`, incluindo `receitaDasIndicadas`, `ticketMedio`, `aReceber`, `valorPago`, `custo` e `valorFechado`. Varri os 15 relatórios, na tela e na exportação, sem `valores`: nenhum campo preenchido, nenhuma coluna `dinheiro`, nenhum `R$` nem `\d+,\d{2}` em texto. O 3 e o 8 dão `403` pela tabela de dependência (ADV-12) |
| **T8 B1**: limite por hora | mantido | `contarTentativa` com `pg_advisory_xact_lock` e `tentativas_de_relatorio`, chamado também por `comALista` (`motor.ts:338`) |
| **T8 B2**: o 15 sem texto livre | mantido | `rotuloDaTarefa` devolve o tipo ou "Tarefa avulsa" (`consultas.ts:354`) |
| **T8 M1**: o motivo do 11 | mantido | O texto livre só sai no recorte de classe `saude` com paciente, ou quando é motivo do sistema (`consultas.ts:305-313`) |
| Texto livre nas linhas do T9 | ok | O `motivo` do 13 é o nome do motivo do catálogo, nunca a nota. A `descricao` do 10 está na I-38 e é de conta, não de paciente |
