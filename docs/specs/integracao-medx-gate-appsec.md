# Gate appsec — `integracao-medx.md` (spec, antes do código)

**Data:** 2026-11-16. **Revisor:** especialista-seguranca-appsec.
**Conferido no código:** `apps/api/src/agenda/{baixar-feed,sincronizacao,worker-agenda,fila-agenda,agenda-externa.*}.ts`, `apps/api/src/carteira/segundo-fator/cifra.ts`, `apps/api/src/comum/redacao.interceptor.ts`, `packages/domain/src/permissoes.ts`, `apps/api/migrations/0037_agenda_externa.sql` e `0055` (denylist da trilha), `apps/api/src/banco/banco.service.ts`, `infra/producao/{docker-compose.yml,implantar.sh}`.

**Veredito:** reprovado como está, com **6 bloqueios**. Todos se resolvem por texto no spec, sem mudar as decisões D1 a D5.

Severidades: **B** = bloqueia o spec · **A** = ajuste obrigatório antes do ticket · **N** = nota.

---

## 1. A chave: armazenamento, quem lê, rotação

**S-1 (B) — O "Testar conexão" não roda na API: a API não tem saída para a internet.**
A API mora só na rede `dados` (`internal: true`); quem sai é o `worker-agenda` (rede `saida`). O T1 põe "testar" numa rota da API. Para isso funcionar, alguém vai acabar ou dando saída à API (a API que atende o balcão passa a falar com a internet) ou passando a chave em texto puro num job do BullMQ (e ela fica no Redis, inclusive em `removeOnFail`).
**Ajuste:** o teste roda **no worker** e lê a chave **já gravada** (cifrada) no banco. O payload do job leva só `clinicaId` e um id de pedido; o resultado volta ao banco (`ultimo_teste_em`, nome do usuário MedX, scopes), e a tela consulta esse resultado. Fluxo: PUT grava como "não verificada", Testar enfileira, a tela mostra o resultado. **Nenhum segredo em payload de job, em retorno de job nem em `failedReason`.** A API nunca abre conexão para o MedX.

**S-2 (A) — Quem decifra.** Com AES simétrico, `FIR_CHAVE_INTEGRACOES` precisaria estar na API (para cifrar) e no worker (para decifrar). Uma SQL injection no balcão (`fir_app` lê a linha) mais a variável no mesmo processo dá o token de todas as clínicas.
**Ajuste (escolha um e escreva no spec):** (a) **cifra assimétrica**: a API guarda só a chave pública (sela com X25519/HPKE ou RSA-OAEP, e o AAD continua), e só o worker tem a privada; ou (b) a API não recebe a variável, e a cifragem acontece no worker. Em qualquer dos dois: **GRANT por coluna**, com a coluna cifrada fora do `SELECT` de `fir_app`, lida só pelo papel do worker (papel próprio, por exemplo `fir_integracoes`, sujeito a RLS e sem BYPASSRLS).

**S-3 (A) — O AAD e a versão.** O spec diz "AAD com o id da clínica". Precisa ser `integracao:<clinica_id>:<provedor>:v<versão>`, igual à forma de `cifra.ts` (que usa `usuario_gestao:<id>:v<n>`). O `clinica_id` do AAD vem do **contexto** `naClinica(clinicaId)` com que a linha foi lida, nunca da coluna da própria linha. Rótulo HKDF próprio (`fir:integracoes`). A variável entra em `implantar.sh` com `acrescentar_segredo`, nunca sobrescrita, e com `:?` no compose de **cada** serviço que a usa.
Caso de abuso: copiar o ciphertext da clínica A para a linha da B não decifra (o decifrar retorna `null` e a leitura vira "chave inválida", sem exceção com detalhe).

**S-4 (A) — Remover e trocar.** "Remover" precisa **apagar o ciphertext** (`NULL`) e marcar o estado. "Desligar" não basta. Trocar ou remover **invalida na hora o JWT em cache** (o cache é chaveado por `(clinicaId, versão da linha ou fingerprint)`, ver S-12). O spec deve dizer à clínica que, ao remover ou trocar, ela **revoga o token no MedX**: o FIR esquecer a chave não a revoga.

**S-5 (N) — Canal de entrega e conta dedicada.** O token pessoal sai da clínica e chega ao Operador. Defina o canal (nunca WhatsApp ou e-mail em claro sem rotação depois) e recomende um **usuário MedX dedicado à integração**, só com permissões de leitura (`agenda:read`, `contatos:details:read` e a de finanças que o T5 precisar). O token de uma recepcionista herda as permissões de escrita dela, e ela sai da clínica um dia. O Testar conexão **avisa** quando o scope trouxer permissão de escrita (D5 diz que não precisamos dela). Hoje o critério A.3 só cita duas permissões e esquece a de finanças.

**S-6 (B) — Mesma credencial MedX em duas clínicas.** "Credencial de clínica reutilizada entre clínicas" é veto. Colar por engano o token da A na B faz a B criar cartões e pacientes com a agenda da A, e o sistema não reclama.
**Ajuste:** (1) guardar um **fingerprint HMAC** do token (pepper derivado de `FIR_CHAVE_INTEGRACOES` por outro rótulo, como o pepper de `cifra.ts`) com **UNIQUE global por provedor**; (2) no Testar conexão, gravar o identificador da conta ou empresa MedX devolvido por `usuario-atual`, também com **UNIQUE global** `(provedor, conta_externa_id)`. A integração só liga depois de um teste verde que grave esse id. Essa checagem global é o único `semIsolamentoDeClinica` legítimo, e devolve só um booleano.

## 2. Vazamento em trilha, log, erro e resposta

**S-7 (B) — A trilha da clínica recebe a linha da integração.** A escrita do Operador via `comoPainel` dispara `registrar_auditoria`, que grava `to_jsonb(NEW)` na trilha **da clínica**, e `GET /v1/auditoria` entrega isso a quem tem `config`. O critério A.6 fala só de `auditoria_do_painel`.
**Ajuste:** a coluna cifrada e a do fingerprint entram na **denylist** de `auditoria_sem_segredos` (o mais simples é reusar o nome `segredo_cifrado`, que já está lá desde a 0055, e acrescentar o do fingerprint). Os 4 últimos caracteres podem atravessar. Teste: depois de PUT, troca e remoção, nenhum `de`/`para` de `auditoria` nem de `auditoria_do_painel` contém o ciphertext ou o fingerprint.

**S-8 (A) — Erro do MedX nunca vira texto.** `ultimo_erro` (que a clínica vê, D4) e o log saem de um **catálogo fixo** (sem chave, 401, 403 com o scope que falta, 429, 5xx, resposta não-JSON, contrato inválido, tempo esgotado). **Nunca** o corpo da resposta, a URL com query, o objeto de erro do cliente HTTP nem o `JWT`. Se o cliente for `fetch` ou axios, é proibido logar o objeto de erro: o axios carrega `config.headers.Authorization` e `config.data` (`integrationToken`). O `worker.on('failed')` de hoje loga `erro.message`, então a mensagem precisa nascer limpa. Teste: um servidor falso que ecoa o token e um nome de paciente no corpo do 500 não deixa nenhum dos dois em log, em `ultimo_erro` nem no `failedReason` do job.

**S-9 (A) — A resposta do painel.** O GET mascarado devolve `{ provedor, ligadoAgenda, ligadoFaturamento, finalDaChave, verificadaEm, contaExterna, scopes, estado }` e nada além. Nenhum campo que contenha o JWT ou o `expiresIn`. O bloco da clínica (D4) devolve **menos** ainda: sem `finalDaChave`, sem scopes, sem nome do usuário MedX. Diga sob qual permissão (sugestão: a mesma `config` do iCal) e registre em `teste/registro.ts`.

## 3. Rede, host e SSRF

**S-10 (A) — Host fixo de verdade.** A pergunta em aberto 3 deixa o host indefinido. Ele precisa ser uma **constante por ambiente** (variável de deploy validada na subida: `https:`, porta 443, sem caminho variável), **nunca** um campo por clínica nem algo editável no painel. Além disso:
- **Redirecionamento não é seguido.** Um 3xx é falha. Seguir um redirect reenviaria o `Authorization: Bearer` ao destino, que é diferente da regra de `baixar-feed.ts`, onde o link não leva credencial.
- Mesmo com host fixo, a conexão usa `lookupSoPublico`: o `worker-agenda` enxerga `postgres` e `redis` pela rede `dados`.
- **Id vindo do MedX nunca entra cru na URL.** `GET /contatos/{id}` com `id` lido da agenda passa por validação de formato (o que o OpenAPI declarar, inteiro ou uuid) e por `encodeURIComponent`. Sem isso, um `paciente.id` como `../financas/...` vira uma chamada que o FIR não pretendia, com o token da clínica.
- Nota: o MedX pode ganhar rede própria com egress restrito, como a `saida-planilhas`, em vez da `saida` aberta do iCal.

**S-11 (B) — Resposta inválida ou parcial nunca desmarca.** Atrás do Cloudflare, o MedX pode responder **200 com HTML** (desafio, manutenção) ou JSON fora do contrato. A leitura do MedX também tem algo que o iCal não tem: **várias janelas de 31 dias × várias páginas por cursor**. Se uma página falhar no meio, a lista fica parcial, e o critério B.2 só protege contra a lista **vazia**. Uma lista parcial manda para Recontatar todo cartão das páginas que faltaram.
**Ajuste:** (1) exigir `content-type: application/json` e um **parse Zod estrito** por página. Falhou, a leitura inteira é "contrato inválido". (2) **A rodada só concilia depois que TODAS as janelas e TODAS as páginas chegaram.** Qualquer falha aborta sem tocar em nada. (3) Um cursor repetido ou um número de páginas acima do teto aborta (evita laço infinito). (4) A mesma regra vale para o faturamento: um dia só é substituído se os 45 dias foram lidos por inteiro, e uma leitura que zera um dia antes não zerado fica registrada como suspeita no resumo. Casos de abuso: HTML com 200; a página 3 de 5 com 502; o cursor que volta para a página 1; `items: null`.

## 4. Abuso de "Testar conexão" e "Ler agora"

**S-12 (A) — Limite e deduplicação.**
- **Testar conexão**: no máximo 1 por clínica a cada 30 s e 10 por hora (servidor, por clínica e por operador), com o `jobId` deduplicado como em `pedirSincronizacao`.
- **Ler agora**: o spec não diz se o "Sincronizar agora" que a clínica já tem (`POST /v1/agenda-externa/sincronizar`, `config`) passa a disparar a leitura do MedX. Diga. Se passar, ele precisa de **cooldown no servidor** (por exemplo, 1 a cada 2 min por clínica). O `jobId` de hoje só deduplica enquanto o job espera, e com `removeOnComplete: true` o clique seguinte gera outra rodada. Cada rodada custa token, mais 2 janelas, mais N páginas, mais uma chamada `contatos` por paciente novo: dá para queimar a cota do usuário MedX da clínica, e o 429 ou bloqueio que o MedX aplica cai sobre o sistema principal da clínica.
- **Cache do JWT** só em memória do worker, chaveado por `(clinicaId, versão ou fingerprint da chave)`, com expiração em `expiresInSeconds − margem`. Nunca em Redis nem no banco. Teste: duas clínicas no mesmo worker nunca usam o JWT uma da outra.
- **Tetos por ciclo**: chamadas a `contatos` por rodada (por exemplo, 50; o resto fica para a rodada seguinte), prazo total da rodada, teto de bytes por página. O `Retry-After` é respeitado **sem dormir dentro do job** acima de alguns segundos: com `concurrency: 1`, um `Retry-After: 3600` pararia o iCal das outras clínicas. O certo é abortar a rodada e registrar.

## 5. Isolamento entre clínicas e RLS

**S-13 (B) — RLS nas tabelas novas, todas.** O T1 fala de RLS só em `integracoes_da_clinica`. `leituras_de_faturamento_externo`, o **histórico de substituições** e onde morar o **id do paciente no MedX** precisam de `clinica_id NOT NULL`, `ENABLE` e `FORCE ROW LEVEL SECURITY`, policy `clinica_id = app_clinica_id()` e trigger de auditoria, no molde da 0037. O histórico é **append-only** (`REVOKE UPDATE, DELETE`). O vínculo do paciente MedX tem `UNIQUE (clinica_id, provedor, id_externo)`, para que o mesmo id na clínica B nunca resolva para a paciente da A. Teste de RLS contra Postgres real.

**S-14 (A) — O worker sem contexto.** A varredura "quais clínicas têm MedX" não pode ser um `semIsolamentoDeClinica` que leia `integracoes_da_clinica` (essa tabela tem RLS: a consulta voltaria vazia, e a tentação de contornar é o vazamento). O padrão é o de `sincronizarTodas`: listar `clinicas` ativas e, **dentro de `naClinica(clinicaId, SISTEMA)`**, ler a integração e decifrar com o AAD daquele `clinicaId`. A trava da rodada (`FOR UPDATE`) é **a mesma linha** para iCal e MedX, e B.7 (um provedor por clínica) vale **no banco**: `UNIQUE (clinica_id)` ativo, ou um CHECK cruzado. Não basta a tela: a clínica com `config` ainda tem `PUT /v1/agenda-externa`, que precisa recusar com o MedX ligado.

## 6. Conteúdo vindo do MedX

**S-15 (A) — Campo externo é entrada não confiável.** `paciente.nome`, `profissional.nome`, `status.nome`, `tipo`, `setor` e `descricao` viram texto em tarefa, paciente e histórico. Ajuste no spec:
- Escrever **quais campos são persistidos**. `descricao` **não** é persistido (texto livre de agenda costuma carregar queixa ou procedimento, dado de saúde, e é a parte que o LGPD revisa).
- Parse Zod com teto de tamanho (nome até 200), remoção de caracteres de controle e de bidi (`U+202E` etc.) e normalização NFC antes de `normalizar_nome`.
- Ids externos: formato validado e teto de comprimento antes de virar `uid_externo`.
- Texto que começa com `= + - @` é neutralizado em **toda exportação CSV ou planilha** que já existe e que vai conter esse nome (injeção de fórmula).
- O nome entra em template de WhatsApp ou de e-mail só escapado.
- O React escapa no balcão, mas nenhum `dangerouslySetInnerHTML` ou markdown renderiza esses campos.

## 7. Redação de valores (regra 17)

**S-16 (B) — Os nomes novos precisam estar em `CAMPOS_MONETARIOS`, inclusive os de COLUNA.** A redação casa **nome de chave** (`redacao.interceptor.ts`), com snake convertido para camel, e `GET /v1/auditoria` entrega `de`/`para` com **nome de coluna**. O spec fala de "total em centavos" e de "total antigo, total novo" no histórico. `total`, `totalCentavos`, `totalAntigo`, `totalNovo` e `totalMedx` **não** estão na lista. Do jeito que está, o faturamento da clínica atravessa inteiro na trilha para quem tem `config` e não tem `valores`.
**Ajuste:** fixar no spec os nomes de coluna e de campo da API (por exemplo, `faturamento` e `receita` já estão na lista; para colunas novas, acrescentar `faturamento_lido`/`faturamentoLido`, `faturamento_anterior`/`faturamentoAnterior` e equivalentes), registrar cada um em `teste/registro.ts` e passar pela varredura `campos-de-dinheiro-registrados`. "Dias com diferença" sai como **array** de `{ dia, diferenca }`, nunca como mapa `{ '2026-11-03': … }`. A **quantidade de pagamentos** por dia não é dinheiro, mas revela o volume do faturamento: deixe explícito se ela atravessa sem `valores` (recomendação: não). Teste de redação por rota, mais a prova por mutação (renomear o campo tem de reprovar).

**S-17 (N) — A meta medida pelo MedX.** Sem `valores`, só o `percentual` atravessa, como hoje. Escolher entre "FIR" e "MedX" é configuração do Operador, então o valor do MedX nunca chega à clínica por essa rota. As rotas `/v1/superadmin/*` já redigem tudo (o espaço `operador` nega `valores`); mantenha os totais fora do painel, coerente com ADR 0024.

## 8. Outras

**S-18 (A) — Repetição.** A upsert por `(clinica_id, provedor, dia)` grava no histórico **só quando o total muda**, dentro de transação com trava por clínica: o cron horário e uma leitura manual simultâneos não duplicam o histórico. A criação de cartão já é idempotente pela UNIQUE de `compromissos_externos`. Caso: ler o faturamento três vezes sem mudança no MedX deixa zero linhas novas no histórico.

**S-19 (N) — Cliente só de leitura.** O `LeitorDoMedx` expõe só `GET` e o `POST /token`. Um teste de arquitetura recusa qualquer outro método no módulo (D5), para que uma escrita futura passe por spec e não por um commit.

**S-20 (N) — Backup.** O dump carrega o ciphertext. Confirme que `backup.sh` não guarda o `.env` (onde está `FIR_CHAVE_INTEGRACOES`) junto do dump. Perder a variável obriga a colar de novo as chaves de todas as clínicas: escreva isso no runbook, como `implantar.sh` já faz com o segundo fator.

---

## Casos de abuso para o `engenheiro-qa-automacao`

1. O ciphertext da A copiado para a linha da B não decifra, e a leitura da B falha com mensagem do catálogo.
2. O mesmo token colado na B (já usado na A) é recusado. A mesma conta MedX (`conta_externa_id`) na B é recusada.
3. Nenhuma resposta, log, `ultimo_erro`, `failedReason`, `auditoria` ou `auditoria_do_painel` contém o token, o JWT, o ciphertext ou o fingerprint, depois de PUT, troca, teste e remoção.
4. A clínica com `config` não tem rota que leia ou grave a chave. `GET /v1/superadmin/clinicas/:id/integracoes` com sessão de clínica dá 401/403.
5. O payload de todo job da fila tem só ids: nenhum segredo no Redis.
6. HTML com 200; 200 com JSON fora do contrato; a página 3 de 5 com 502; o cursor em laço: nada é desmarcado e nenhum dia de faturamento é substituído.
7. Um redirect 302 do MedX não é seguido, e o Bearer não sai para outro host.
8. `paciente.id = "../financas/faturas"` é recusado antes de virar URL.
9. Um nome com `U+202E`, `=HYPERLINK(...)` e 5 mil caracteres é limpo e truncado, e sai neutralizado na exportação.
10. "Ler agora" 10 vezes em 10 s gera uma rodada. "Testar" acima do teto dá 429.
11. Sem `valores`: o KPI, a conferência, a meta e `GET /v1/auditoria` (com uma substituição de faturamento na trilha) não trazem nenhum total do MedX; com `valores`, trazem.
12. RLS contra Postgres real: leitura de faturamento, histórico e vínculo de paciente MedX da A, invisíveis com o contexto da B.
13. Trocar a chave invalida o JWT em cache: a chamada seguinte troca de token.
14. A clínica com MedX ligado recebe recusa em `PUT /v1/agenda-externa` ao tentar ligar o iCal.
