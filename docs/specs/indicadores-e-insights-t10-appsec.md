# T10 — KPIs na carteira: revisão adversarial de appsec e LGPD

**Data:** 2026-11-17 · **Revisor:** `especialista-seguranca-appsec` · **Branch:** `backlog-final-indicadores-e-acesso` (não commitado)
**Escopo:** ADR `2026-11-17-kpis-na-carteira-emenda-a-0013.md`, migration `0110_kpis_na_carteira.sql`, `carteira/jobs/kpis-do-dia.ts`, mudanças em `uso-diario-cliente.ts`, `carteira/indicadores-da-clinica/**`, `contracts/kpis-na-carteira.ts`, `web/components/carteira/indicadores-da-clinica.tsx`.
**Gates:** appsec C5, C26, C28, C29 e C30 (esta revisão faz as vezes do scan C30 para o T10), LGPD L-IN-18, ADR 0013 §4 e §7.

## Veredito: **APROVADO**

Não há bloqueio. As seis observações abaixo não vetam o ticket, e cada uma tem dono e gatilho.

## Bloqueios

Nenhum.

## Prova (Postgres real, HTTP inteira)

- `apps/api/src/carteira/indicadores-da-clinica/kpis-na-carteira.e2e.test.ts`: 13/13 passam (teste do autor).
- `apps/api/src/carteira/indicadores-da-clinica/kpis-na-carteira-appsec.e2e.test.ts`: 8/8 passam. É desta revisão e fica no repositório. Cobre o que o teste do autor não cobria:
  1. **C29:** `console.*` capturado durante o job e as duas leituras. Não aparecem o nome livre do KPI nem os centavos (crus ou formatados).
  2. **C28:** sem `valores`, nenhum centavo aparece em lugar nenhum do JSON, e não só em `emDinheiro`.
  3. **Tela e carteira:** sem a tela `firclinic` a resposta é 403. Com `carteira = 'minha'` e cliente alheio, é 404.
  4. **ADR 0013 §7:** três leituras gravam três linhas de acesso na `auditoria` da clínica.
  5. **Falha fechada:** se a gravação do acesso falha, a resposta é 500 e não leva nome nem valor.
  6. **0110:** `ENABLE` e `FORCE` estão ligados. Nenhum papel além do dono tem `DELETE` ou `TRUNCATE`. Só `fir_carteira` tem `SELECT`.
  7. **Emenda §6:** com `resultado_de_campanha` e um valor preenchido, o banco recusa a linha (`23514`).
  8. **Desvínculo real** (`PainelCarteiraService.removerGrupoDaClinica`, e não só `encerrar_participacao_da_clinica`):
     - as linhas vão para o grupo de arquivo com o cliente;
     - pela RLS, o grupo antigo lê 0 linhas, e a rota responde 404;
     - o job do dia seguinte não grava nada.

## O que foi caçado e está fechado

| Ameaça | Onde fecha |
|---|---|
| Dinheiro para quem não tem `valores` | `emDinheiro` está em `CAMPOS_MONETARIOS`, e `@SoUsuarioDeGestao` está na classe do controller. Quem decide é `decisorDaRota('carteira')`, com `temPermCarteira`. O contrato `.strict()` não tem outro campo monetário (`percentualDaMeta`, `situacao`, `prazo`). `despesas_fixas_sobre_recebido` sai pela `permissaoDoValor` (`indicadores-da-clinica.service.ts:83-88`). |
| Nome de campo que `ehCampoMonetario` não pega | A saída usa só `emDinheiro`/`emNumero`. `alvo_*` e `valor_*` são colunas e não saem cruas. O sufixo `Centavos` também é coberto. |
| KPIs de RH | São três travas: a `PODE_DO_JOB` sem `pessoas.gerir` (`kpis-do-dia.ts:42`), `ehDeRh` (`:55`) e o `CHECK chave_catalogo` da 0110, que é uma lista do que pode atravessar. A leitura também filtra (`service:86`). |
| Pilar Pessoas e campanha com valor | `semValorNaCarteira` (`kpis-do-dia.ts:49`) e o `CHECK kpis_na_carteira_sem_valor_onde_nao_atravessa`. |
| Grupo B lendo o A | A RLS por grupo é forçada. O `WHERE grupo_id` é a segunda camada. Para cliente que não existe e para cliente de outro grupo, a resposta é o mesmo 404. A "minha carteira" é checada no `CarteiraGuard`. |
| Linha depois do desvínculo | O job filtra por `vinculado` e o `INSERT … WHERE EXISTS` confere de novo (`kpis-do-dia.ts:116`). A participação só muda pelo Operador (gatilho da 0068). |
| Identidade do job | `IndicadoresService.listar` usa `banco.naClinica`, que roda no pool `fir_app` com a clínica fixada. A gravação vai por `fir_carteira`. Nenhum caminho usa `BYPASSRLS` nem o dono. |
| Espaço do operador | Nenhuma rota `/v1/superadmin/*` lê `kpis_na_carteira`, e `decisorDaRota('operador')` nega tudo. |
| Idempotência | UPSERT em `(cliente_carteira_id, kpi_ref, dia)`. Três rodadas dão linhas idênticas, e a transação é uma por cliente. |
| Nome livre em log | O `catch {}` não guarda a mensagem (`uso-diario-cliente.ts:255`). O worker loga só contagem e ids. |

## Observações (não bloqueiam)

1. **[LGPD, dívida] A retenção de 2 anos não tem executor.** `retencao.md:98` diz "eliminação por job privilegiado", mas o job não existe. A 0110 não dá `DELETE` a ninguém, o que está correto. A situação é a mesma de `uso_diario_cliente`, só que aqui a coluna `nome` é texto livre e pode trazer nome de paciente se o aviso for ignorado. Registrar em `docs/dividas.md`. **Gatilho:** a primeira linha completar 2 anos, ou um pedido do titular.
2. **[LGPD] A retificação não chega aos dias passados.** Se a clínica renomeia um KPI para tirar um nome, só a linha de hoje é reescrita. A API mostra só `max(dia)`, então nada mais fica exposto a partir do dia seguinte, mas as linhas antigas continuam no banco até a retenção. O mesmo vale para um KPI arquivado no meio do dia: a linha daquele dia fica (`kpis-do-dia.ts:119`, o UPSERT não remove quem sumiu). Recomendo a 0110 ou um job de retificação apagar ou anonimizar pelo `kpi_ref`.
3. **[defesa em profundidade] Falta a FK composta `(cliente_carteira_id, grupo_id) → clientes_carteira(id, grupo_id)`** (`0110:25-26`). Se `moverClienteDeGrupo` rodar entre o `SELECT` inicial do job e o `INSERT`, a linha nasce com o `grupo_id` antigo. Hoje nenhuma rota a expõe, porque a leitura exige o cliente no grupo. As tabelas posteriores à 0044 já usam a FK composta, e ela funciona com o `WITH` único de `moverClienteDeGrupo`, porque a checagem roda no fim da instrução.
4. **[residual aceito, L-IN-18] KPI manual fora do pilar Pessoas leva o valor.** Um "banco de horas da Ana" criado no pilar Processos, com unidade `horas`, atravessa com o número. A única barreira é o aviso do formulário. Vale uma frase na emenda dizendo que esse residual foi aceito.
5. **[UX] Cliente com a tela `metas` e sem `firclinic`** vê o bloco com "Seu acesso não inclui esta tela." (`aba-indicadores.tsx:71`). Não há vazamento. Sugiro não montar o bloco quando a tela não foi concedida.
6. **[operação] A falha dos KPIs não deixa nenhum diagnóstico** (`uso-diario-cliente.ts:255`). Para C29 o comportamento está certo. Ainda assim, dá para guardar o `code` do Postgres (por exemplo `23514`), que não carrega conteúdo e permite saber por que uma clínica parou de fotografar.

## Arquivos

- `C:\Users\DAVI LOPES\Desktop\AURI PROJETOS\firmaregestao\fir\apps\api\src\carteira\indicadores-da-clinica\kpis-na-carteira-appsec.e2e.test.ts` (novo, desta revisão)
