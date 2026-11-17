# Spec — Integração com o MedX (agenda + faturamento como leitura)

**Status:** revisada pelo gate de risco em 2026-11-16 (appsec, LGPD e números reprovaram a versão anterior com bloqueios corrigíveis; todos estão incorporados abaixo e marcados com a sigla do parecer). Pronta para tickets. **Ligar em produção depende do termo da clínica (A.0) e da calibração (C.0).**
**Origem:** backlog da Marília, "FIR Clinic · Backlog final", Entrega 2 (15/11/2026); documentação oficial da API do MedX (`https://integracao-app.medx.med.br/`, contrato OpenAPI `v1`, lido em 16/11/2026); decisões do dono em 16/11/2026.
**Pareceres:** [`-gate-appsec.md`](integracao-medx-gate-appsec.md) (S-n), [`-gate-lgpd.md`](integracao-medx-gate-lgpd.md) (B-n, A-n), [`-gate-numeros.md`](integracao-medx-gate-numeros.md) (N-Bn, An). Os pareceres são a justificativa; **esta spec é o que vale**.

## Problema

Nas clínicas que usam o MedX como sistema da clínica, a recepção marca a consulta no MedX e lança de novo na FIR. O objetivo da Marília: **a recepção lança só no MedX e a FIR cria e atualiza sozinha o cartão da jornada**. Pagamentos do MedX interessam **para os indicadores** (pergunta 5 do backlog), não para substituir o financeiro da FIR.

O MedX tem API pública ("API de Integração v1", REST, token pessoal do usuário). O caminho é o A do backlog (API oficial). O caminho C (API interna do app web) está descartado.

## Decisões do dono (16/11/2026)

- **D1.** Nível 3 (MedX como caixa da clínica) **descartado por completo**.
- **D2.** Nível 1 (agenda) e nível 2 (faturamento do MedX como leitura nos Indicadores, sem misturar com o financeiro da FIR) aprovados.
- **D3.** A chave de integração é cadastrada **pelo superadmin**, no painel, **por clínica**. Clínica sem MedX continua "Só FIR" (padrão).
- **D4.** A clínica vê, na Agenda do sistema, se o MedX está ligado e a última leitura — **só leitura**.
- **D5.** Sentido único: **MedX → FIR**. A FIR nunca escreve no MedX nesta entrega.

## Decisões tomadas no gate (regra do dono: protótipo, depois o recomendado)

- **G1 (S-2). Cifra assimétrica.** A API guarda só a **chave pública** e sela o token (X25519 + HKDF + AES-256-GCM, AAD abaixo); só o worker tem a privada. Uma SQL injection na API mais a variável da API não abrem token nenhum. Descartada a opção "cifrar no worker": exigiria o token em claro atravessando banco ou fila.
- **G2 (N-B2). Fonte do faturamento: `lancamentos` a receber, pagos, filtrados pela data do pagamento** — desde que a calibração C.0 prove as duas condições do C.1. Se falhar, faturas + pagamentos, filtrado por `pagoEm`. **Nunca as duas.**
- **G3 (N-B8). Sumiço confirmado por id.** A API tem `GET /agenda/agendamentos/{id}` (conferido no OpenAPI). Todo "sumido" é consultado por id antes de desmarcar.
- **G4 (N-B5). Arredondamento meio para longe do zero**, simétrico.
- **G5 (B2). "Comparecimento pelo MedX" (usar `chegada`/`atendidoEm`) sai desta entrega** e vai para spec própria com gate próprio.

## Fatos da API do MedX que a spec usa

- **Autenticação:** `POST /api/integration/v1/token` com `{ integrationToken }` devolve `accessToken` (JWT, ~15 min), `expiresInSeconds` e `scope`. Chamadas com `Authorization: Bearer`. Permissões = as do usuário no MedX, conferidas a cada chamada.
- **Agenda:** `GET /agenda/agendamentos/detalhes?Inicio&Fim` (fim exclusivo, **máximo 31 dias**, horários em UTC−03, cursor, até 100 por página); `GET /agenda/agendamentos/{id}`; `GET /agenda/catalogos` (nomes dos status 0–12); `GET /agenda/usuario-atual`. Escopo `agenda:read`.
- **Telefone:** `GET /contatos/{id}` (`celular`, `telefoneResidencial`). Escopo `contatos:details:read`.
- **Faturamento:** `GET /financas/lancamentos` (`tipo=receber|pagar`, `status=pago`, `pagamentoInicio/pagamentoFim`, até 90 dias; escopo `lancamentos:read`); `GET /financas/faturas` + `/faturas/{id}/pagamentos` (`faturas:read`); `GET /financas/unidades`. **Valores: número JSON em reais, até 4 casas.**
- **Não há webhook** nem filtro "alterado desde". **Não há ambiente de teste aberto**: toda chamada acessa dado real.

## Papéis e base legal (LGPD A6)

| Papel | Quem |
|---|---|
| Controladora | A clínica |
| Operador | Firmare/FIR |
| Outro operador da mesma controladora | MedX |

A clínica instrui um operador (FIR) a ler o que outro operador (MedX) guarda para ela. A autorização é **escrita, da clínica** (A.0).

| Finalidade | Dado | Base legal |
|---|---|---|
| Criar e manter o cartão, confirmar, tratar falta | nome, telefone, data/hora, Consulta ou Procedimento | art. 11, II, "f"; telefone, art. 7º, V |
| Recontatar quem cancelou ou sumiu | os mesmos | art. 11, II, "f" enquanto retoma o cuidado; uso comercial além disso depende da finalidade declarada no DPA (P-3) |
| Total diário de faturamento | soma em centavos e quantidade, por dia | não é dado pessoal; art. 7º, V |
| Credencial e nome do usuário MedX | segredo; nome de funcionária | art. 7º, V |

Pedido de eliminação do titular precisa ser atendido **nos dois sistemas**: a FIR não recria (B.9), mas não apaga nada no MedX. O termo diz isso (LGPD A8).

## Critérios de aceite

### A. Conexão (painel do superadmin)

0. **(B1) Termo antes de ligar.** "Ligar MedX" fica desabilitado até o superadmin registrar o termo de autorização da clínica: data, quem assinou, versão do termo. Gravado na integração e em `auditoria_do_painel`. O termo cobre a lista branca (B.0), finalidades, frequência, janelas, o usuário dedicado (A.3), retenção, como revogar (desligar na FIR **e** revogar o token no MedX) e o fim do contrato.
1. Em **Gestão → Clínicas → [clínica] → Integrações**, o superadmin escolhe "Só FIR" (padrão) ou "MedX".
2. **Cofre (G1, S-3).** A chave colada é selada com a chave pública; o worker abre com a privada. AAD `integracao:<clinica_id>:medx:v<versão>`, com o `clinica_id` vindo do **contexto `naClinica`** da leitura, nunca da coluna. Rótulo HKDF `fir:integracoes`. Ciphertext de uma clínica copiado para outra não abre (vira "chave inválida", sem detalhe). A coluna cifrada **fica fora do `SELECT` de `fir_app`** (GRANT por coluna) e só o papel do worker (`fir_integracoes`, sujeito a RLS, sem BYPASSRLS) a lê. A chave nunca volta em resposta: a tela mostra só os 4 últimos caracteres. As variáveis entram em `implantar.sh` com `acrescentar_segredo` (nunca sobrescrita) e com `:?` no compose de cada serviço que as usa; o runbook diz que perder a privada obriga a recolar a chave de todas as clínicas (S-20).
3. **(B5, S-5) Usuário MedX dedicado, permissão mínima.** *Alterado em 17/11 pela ADR [chave-do-medx-como-a-clinica-tem](../adr/2026-11-17-chave-do-medx-como-a-clinica-tem.md): escopo a mais não impede ligar, só o que falta; várias unidades da mesma empresa ligam, de empresas diferentes não. O texto abaixo é o original.* O termo exige um usuário do MedX só para a integração. **Testar conexão** compara o `scope` com a lista branca `agenda:read`, `contatos:details:read`, `financas:read` (só catálogo, sem paciente: é o escopo que lista as unidades, conferido no OpenAPI em 16/11) e, só com faturamento ligado, `lancamentos:read` (ou `faturas:read`, conforme G2). Com o escopo de finanças presente, ligar só a agenda é recusado: liga-se o faturamento junto ou tira-se o escopo. **Escopo a mais impede ligar** e a tela diz em português qual sobra; escopo a menos, qual falta. O teste lê `GET /financas/unidades`: **mais de uma unidade não liga** até a clínica restringir o usuário.
4. **(S-1, A4) Testar conexão roda no worker.** A API não tem saída para a internet e não ganha. PUT grava a chave como "não verificada"; Testar enfileira um job com **só `clinicaId` e id do pedido**; o worker chama `POST /token`, `GET /agenda/usuario-atual`, `GET /financas/unidades` e, com tudo verde, `GET /agenda/catalogos` (só `status[].{id,nome}`, para o B.8; falha dele não derruba o teste) — **nunca** agendamento nem contato, nem como amostra — e grava o resultado no banco (`verificada_em`, nome do usuário, scopes, unidades, `conta_externa_id`). A tela consulta esse resultado. Limite: 1 teste por clínica a cada 30 s e 10 por hora, por clínica e por operador (429 acima), `jobId` deduplicado (S-12).
5. **(S-6) Uma credencial, uma clínica.** Fingerprint HMAC do token (pepper por rótulo próprio) com **UNIQUE global por provedor**; `conta_externa_id` (id do usuário MedX devolvido pelo teste) com **UNIQUE global `(provedor, conta_externa_id)`**. A integração só liga depois de um teste verde que grave esse id. Essa checagem é o único `semIsolamentoDeClinica` legítimo e devolve só um booleano.
6. O superadmin liga ou desliga, separadamente: **Agenda → cartões** e **Faturamento → Indicadores**.
7. **(S-4) Remover apaga.** Remover põe o ciphertext e o fingerprint em `NULL` e marca o estado; trocar ou remover invalida na hora o JWT em cache. A tela avisa: "revogue também o token no MedX — esquecer aqui não revoga lá".
8. **(S-9) Resposta mascarada.** O GET do painel devolve exatamente `{ provedor, ligadoAgenda, ligadoFaturamento, finalDaChave, verificadaEm, contaExterna, scopes, unidades, estado, termo }` — nada com JWT nem `expiresIn`. Estado técnico: última leitura, última com sucesso, contagens do último ciclo (consultas lidas, cartões criados, remarcados, desmarcados, ignorados por paciente desativado) e o último erro do catálogo. **Nunca** nome de paciente, telefone nem valor (as rotas `/v1/superadmin/*` já redigem dinheiro; mantém-se, ADR 0024).
9. **(S-7, A3) Trilha sem segredo.** Toda escrita fica em `auditoria_do_painel` (quem, quando, de → para). A coluna cifrada usa o nome `segredo_cifrado` (já na denylist de `auditoria_sem_segredos` desde a 0055) e a do fingerprint entra na denylist na mesma migration. Teste: depois de PUT, troca, teste e remoção, nenhum `de`/`para` de `auditoria` nem de `auditoria_do_painel` contém ciphertext, fingerprint, token ou JWT.
10. Só o Operador acessa a seção (`/v1/superadmin/...`). A clínica não tem rota que leia nem grave a chave (sessão de clínica → 401/403).
11. **(A7) Alerta ao operador** (não à clínica): falha ao decifrar; `scope` diferente do último teste; 401 depois de sucesso; chamadas a `/contatos` ou páginas por ciclo acima do teto.

### B. Agenda → cartões (nível 1)

0. **(B2) O que a FIR guarda do MedX, e nada mais.**
   - **Guarda:** HMAC do id do agendamento, início, HMAC do id do paciente, nome e telefone (só ao cadastrar paciente novo), e **um bit derivado**: Consulta ou Procedimento agendado (vira `tarefas.tipo`, que já existe).
   - **Lê em memória e descarta:** `procedimentoId`/`tipo` (só para o bit), `status.id` (só para decidir cancelado), `fim`.
   - **Nunca guarda, usa nem repassa:** `descricao`, `setor`, `profissional`, `status.nome`, `confirmacao`, `chegada`, `atendidoEm`, `saiuEm`, `criadoEm`, `versao`. A nota do cartão continua genérica ("pela agenda do sistema"); nome de procedimento do MedX nunca vai para nota nem histórico.
   - O schema Zod da borda declara **só** esses campos (`strip`). Resposta crua nunca é persistida, nunca vai para payload de job nem para log.
   - `/contatos/{id}`: schema aceita só `celular` e `telefoneResidencial`, e só é chamado **quando o paciente não tem vínculo pelo id do MedX** (teste: paciente vinculado gera zero chamadas). Teto de 50 chamadas por ciclo; o resto fica para o seguinte.
1. **(N-B9, A10) Janelas e hora.** A cada 15 minutos, no worker de agenda, para cada clínica com agenda MedX ligada: janelas contíguas `[hoje, hoje+31)` e `[hoje+31, hoje+60)`, bordas por `inicioDoDia(…, fusoDaClinica)` convertidas para o relógio de parede `-03:00`. **Dedupe por id** entre janelas. O horário do MedX vira instante UTC **na borda do adaptador**, por função pura testada: sem offset na string aplica-se `-03:00` (constante do adaptador, não da clínica); com offset, respeita-se; offset diferente de `-03:00` conta no resumo.
2. **(S-11) Tudo ou nada.** Exige `content-type: application/json` e parse Zod estrito **por página**; falhou, a leitura inteira é "contrato inválido". **Só se concilia depois que todas as janelas e todas as páginas chegaram**; qualquer falha aborta sem tocar em nada. Cursor repetido ou páginas acima do teto abortam. A trava de leitura vazia (`podeConsiderarRemocoes`) roda **por janela**.
3. **Mesmo fluxo do iCal** (ADR 0019, `decidirPelaAgenda`): consulta nova no futuro → cartão "agendado"; mudou data/hora → reagendado; cancelada → **Recontatar**, nunca cancelado; o que a recepção fez na FIR nunca é desfeito.
4. **(G3, N-B8) Sumiu só depois de confirmar por id.** Para cada sumido: `GET /agenda/agendamentos/{id}` → achou com nova data: `reagendar`; achou cancelado: `desmarcar('cancelado')`; 404: `desmarcar('removido')`; erro: não decide, fica para o ciclo seguinte. E2e: remarcar de +10 para +75 dias não desmarca.
5. **Idempotência:** `(clinica_id, 'medx', HMAC do id do agendamento)` na UNIQUE de `compromissos_externos`. Ler três vezes a mesma agenda não cria nada.
6. **Paciente** (A5): vincula pelo HMAC do id do paciente no MedX; senão telefone (`celular`, depois `telefoneResidencial`), depois nome exato. Não achou: cadastra com "conferir cadastro". Paciente existente: nome e telefone do MedX **nunca** substituem os da FIR; divergência no máximo marca `conferir_cadastro`.
7. **(B3) Paciente desativado ou anonimizado não volta.** Agendamento cujo paciente MedX está ligado a paciente desativado ou anonimizado: **não cria cartão, não cadastra, não reativa**; conta em `ignorados.pacienteDesativado`, e a clínica vê só a contagem. Ao anonimizar, o HMAC do id MedX fica como **supressão**, desligado da identidade; a busca por telefone e nome também consulta a lista de supressão por HMAC. E2e: desativar/anonimizar e ler três vezes → zero pacientes e zero cartões novos.
8. **Status de cancelado** lido de `GET /agenda/catalogos` e **configurado por clínica**; nenhum código no código-fonte. Até configurar, só o sumiço confirmado desmarca.
9. **(S-14) Um provedor por clínica, no banco.** UNIQUE ativo por `clinica_id`; `PUT /v1/agenda-externa` recusa o iCal com MedX ligado. A trava da rodada (`FOR UPDATE`) é a mesma linha para iCal e MedX. A varredura lista `clinicas` ativas e lê a integração **dentro de `naClinica(clinicaId, SISTEMA)`** (padrão de `sincronizarTodas`).
10. **(S-12) "Sincronizar agora"** da clínica passa a disparar a leitura do MedX, com **cooldown no servidor** de 1 a cada 2 min por clínica. `Retry-After` longo **não dorme no job**: aborta a rodada e registra.
11. **(S-15) Texto externo não é confiável.** Nome até 200 caracteres, sem controle nem bidi (`U+202E`), NFC antes de `normalizar_nome`. Ids externos com formato e comprimento validados e `encodeURIComponent` antes de virar URL. Nome que começa com `= + - @` é neutralizado em toda exportação CSV/planilha; em template de WhatsApp ou e-mail, só escapado.
12. **(A1 LGPD) Registro do ciclo**, sem id e sem nome: clínica, janela, agendamentos lidos, chamadas a `/contatos`, páginas, quando. A clínica vê em D.1. Retenção de 1 ano.
13. Uma semana numa clínica real sem cartão duplicado nem faltando, comparando com a agenda do MedX (aceite da Marília).

### C. Faturamento → leitura (nível 2)

0. **(N-B1, N-B2) Calibração antes de ligar em qualquer clínica.** Na primeira clínica, 5 pagamentos reais (Pix; cartão com taxa; parcial, `valorPago < valor`; parcelado com uma parcela paga e outra não; estorno) batem **centavo a centavo** com o relatório de recebidos do próprio MedX. A calibração também mede: se `valorPago` vem bruto; se todo pagamento de fatura gera exatamente um lançamento `receber` e se dá para separar o que veio de fatura do que veio de orçamento ou lançamento manual (condições de G2); se há valor negativo; a forma de `pagoEm` (data ou instante); se `pagamentoFim` é inclusivo; o que significa `pendencia`; o caminho do sinal de orçamento convertido; pagamento por "crédito". **Divergência volta ao gate; a leitura não se adapta em silêncio.**
1. **O que se lê.** Valor recebido = **`valorPago`, bruto**. `taxas` nunca entra. Sem `pagoEm`, ou `valorPago` nulo ou zero, não conta. `valor` nunca é receita. Janela sempre **pela data do pagamento**. Fonte única (G2). `tipo=pagar` e `tipo=orcamento` nunca são pedidos (teste afirma o filtro montado). Fatura `cancelada` com pagamento não entra no total (só a contagem no resumo). Nenhum campo do MedX vira `valorOrcamento`.
   **Na fonte G2 (lançamento), o valor é `valorOriginal`, e só de lançamento com `faturaId`** (ADR `2026-11-16-faturamento-do-medx`): a documentação do MedX diz que, no lançamento, `valorPago` é o débito ou a taxa. A frase acima vale para o pagamento de fatura (plano B da G2). A C.0 confere.
2. **(A1 números) Frequência.** Toda hora: do **dia 1º do mês anterior** até agora. Toda noite: os últimos **13 meses**, em janelas de 90 dias. Mudar o fuso da clínica dispara a releitura de 13 meses. *(Implementado como um job só, de hora em hora no minuto 5; a releitura de 13 meses é a primeira volta depois das 02:00 da clínica, em janelas de 85 dias alargadas 1 dia de cada lado. ADR, item 5.)*
3. **A tabela de leitura não é recebimento.** `leituras_de_faturamento_externo` não entra em caixa, Visão do mês, Painel, LTV, saldo, campanhas nem na conferência de migração (regra 28). Teste de arquitetura: só indicadores e integração a referenciam; o módulo de integração não referencia `recebimentos`, `recebimento_partes`, `caixas_do_dia` nem `outras_entradas`; o `Migrador` não a lê.
4. **(N-B3) Uma linha por dia lido, inclusive zero.** Linha existe ⇔ dia lido. Substituição **tudo ou nada por janela** (todas as páginas, depois uma transação). A janela pedida é alargada 1 dia de cada lado e só se gravam os dias civis da clínica **inteiros** dentro do lido (exceto hoje). **Trava de leitura vazia:** janela inteira sem pagamento onde a leitura anterior tinha pagamentos → aborta e registra; não zera nada.
5. **(A5, A6, S-18) Concorrência e histórico.** Um ciclo por clínica (advisory lock). `lido_em` = início da leitura; só grava se o novo `lido_em` for maior. *(Por clínica, contra o último sucesso; o dia que não mudou não é regravado. ADR, itens 3 e 4.)* Histórico **só quando muda** (total ou quantidade): dia, antigo e novo, `lido_em`, id da leitura, `mesFechado`. Append-only (`REVOKE UPDATE, DELETE`). Ler três vezes sem mudança: zero linhas novas.
6. **(N-B4, G4, A9) Conversão.** Corpo lido com `JSON.parse` + reviver que captura `context.source` (o número nunca é usado). Função pura nova `Dinheiro.deDecimalExterno(texto)` em `packages/domain`, gramática fechada `-?\d+(\.\d{1,4})?`, devolve `Result<{ centavos, exatoEmDezmilesimos, arredondado }>`; qualquer outra coisa é erro e **aborta o ciclo da clínica**. Arredondamento **meio para longe do zero** em `bigint`: `sinal × ((|d| + 50) / 100)`. Arredonda **por pagamento**; o dia é a soma dos centavos e grava também `total_exato` em dezmilésimos. Se a calibração mostrar que não há negativo, negativo é recusado como entrada inválida. **Proibido** `Dinheiro.deTexto`, `parseFloat`, `Number(`, `toFixed` no módulo (teste de arquitetura).
7. **(A4) Dia de pagamento.** `pagoEm` só data: é o dia do MedX, gravado como está. Instante: convertido como B.1 e reduzido a `diaCivil(instante, fusoDaClinica)`. Janela interna sempre `[início, fim)` (regra 23).
8. **Exibição (T7, junto com a Entrega 1).** KPI **"Faturamento no MedX"** com selo "lido do MedX às HH:MM" = a última leitura que cobriu o período (último sucesso ou última releitura completa; ADR `2026-11-16-faturamento-do-medx`, consequências); período com dia sem linha mostra "leitura incompleta". **"Conferência MedX × FIR"**: lado FIR = `recebidoNoMes` (`DINHEIRO_QUE_ENTROU`, sem Outras entradas, mesma `janela()`); `diferencaMedxFir = MedX − FIR`, escrito no rótulo; mostra o resíduo de arredondamento quando não é zero. Os dois números **lado a lado, nunca somados**. *(Implementado no Painel. O resíduo sai como `arredondamentoDoMedx` = Σ centavos − `totalExato` arredondado, e `totalExato` vai em dezmilésimos; os dois entraram na lista da C.11.)*
9. **(N-B7) Corte de caixa.** Todo número por dia, dos dois lados, e a lista de dias com diferença passam pelo `RecorteDeCaixa`: só saem dias até `ateODia`, e a resposta declara `ateODia` e `diasSemCaixa`. Teste de transporte: antes do caixa de hoje fechar, a resposta HTTP não contém número de hoje.
10. **(N-B6) Meta.** Migration expand `metas_do_mes.medida_por text NOT NULL DEFAULT 'fir' CHECK (medida_por IN ('fir','medx'))`, **gravada com a meta** (copiada da configuração da clínica, que é só o padrão dos meses novos). Função única de domínio `medidoParaAMeta({ medidaPor, recebidoFir, faturamentoMedx, coberturaMedxCompleta }) → Dinheiro | null`; `visaoDoMes` e `percentualDaMeta()` usam ela; nunca existe soma das duas fontes. Cobertura incompleta → `percentual = null`, `metaRestante = null`, nunca 0%. Contrato ganha `medidaPor` e `medido`; `recebido` é **sempre** o da FIR.
11. **(S-16, A7) Redação.** Nomes fixados e registrados em `CAMPOS_MONETARIOS` e `teste/registro.ts` no mesmo PR — API: `faturamentoNoMedx`, `recebidoNaFir`, `diferencaMedxFir`, `medido`, `totalAntigo`, `totalNovo`, `totalExato`; colunas: `faturamento_lido`, `faturamento_anterior`, `faturamento_exato` (a varredura converte snake para camel). Nada de `total` genérico. Todo campo de dinheiro no contrato usa `centavosNaSaida`. Dias com diferença saem como **array** `{ dia, diferencaMedxFir }`. **Quantidade de pagamentos por dia não atravessa sem `valores`.** Sem `valores`, atravessam só `percentual`, `medidaPor` e `lidoEm`. Teste de redação por rota (KPI, Conferência, `/meta`, `GET /v1/auditoria` com uma substituição na trilha) mais prova por mutação.

### D. Clínica (só leitura)

1. Em **Configurações → Agenda do sistema**, a clínica com MedX vê "Agenda ligada ao MedX", a última leitura, o registro dos ciclos (B.12), a contagem de consultas ignoradas por paciente desativado e o último erro em texto do catálogo. **Não vê** chave, final da chave, scopes nem nome do usuário MedX; não troca provedor, não liga nem desliga. Permissão: `config`, como o iCal.

### E. Transversal (todas as seções)

1. **(S-13) RLS em toda tabela nova** (`integracoes_da_clinica`, `leituras_de_faturamento_externo`, histórico, vínculo de paciente MedX, supressão, registro de ciclo): `clinica_id NOT NULL`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `clinica_id = app_clinica_id()`, trigger de auditoria no molde da 0037. Vínculo do paciente com `UNIQUE (clinica_id, provedor, id_externo_hmac)`. Teste contra Postgres real.
2. **(S-8, A2) Erro nunca vira texto.** `ultimo_erro` e log saem de **catálogo fixo** (sem chave, 401, 403 com o scope que falta, 429, 5xx, não-JSON, contrato inválido, tempo esgotado). Nunca corpo de resposta, URL com query, objeto de erro do cliente HTTP, token ou JWT. Log só com o modelo da rota (`/contatos/:id`). Teste: servidor falso que ecoa token e nome de paciente no 500 não deixa nenhum dos dois em log, `ultimo_erro` ou `failedReason`.
3. **(S-12) JWT só na memória do worker**, chaveado por `(clinicaId, fingerprint da chave)`, expira em `expiresInSeconds − margem`. Nunca Redis nem banco. Payload de job: só ids.
4. **(S-10) Host fixo por ambiente**: variável de deploy validada na subida (`https:`, porta 443), nunca campo por clínica. **Redirect não é seguido** (3xx = falha; o Bearer não sai para outro host). Conexão por `lookupSoPublico`. Tetos: prazo da rodada, bytes por página.
5. **(S-19) Cliente só de leitura.** `LeitorDoMedx` expõe só `GET` e `POST /token`; teste de arquitetura recusa qualquer outro método.
6. **(B4) Retenção.** O T1 e o T4 só fecham com estas linhas em `docs/compliance/retencao.md`, no mesmo PR: `compromissos_externos` (prazo da tarefa ligada; HMAC, sem anonimização); HMAC do paciente MedX e supressão (integração ligada + 90 dias, job); `segredo_cifrado` (até troca ou remoção, `NULL` de verdade); termo (contrato + 5 anos); leituras e histórico de faturamento (integração ligada + 2 anos, job); registro de ciclo (1 ano, job). A linha do `compromissos_externos` vale também para o iCal.

## Tickets (fatias verticais)

- **T1 — Cofre, termo e configuração.** Migration `integracoes_da_clinica` (provedor, `segredo_cifrado` + versão, fingerprint, `conta_externa_id`, termo, ligados, status de cancelado, meta medida por padrão), GRANT por coluna, papel `fir_integracoes`, denylist, UNIQUEs globais, RLS. Rotas `/v1/superadmin/clinicas/:id/integracoes` (GET mascarado, PUT, remover, pedir teste, ler resultado) com limite. Par de chaves no `implantar.sh`. Retenção. Seção A.
- **T2 — `LeitorDoMedx`** (seam novo, declarado em `docs/arquitetura/sistema.md`). Host fixo, sem redirect, `lookupSoPublico`, timeout, tetos, JSON-only, Zod estrito por página, cursor com teto, cache de JWT em memória, catálogo de erros, `Retry-After` sem dormir, reviver de `context.source`. Teste de arquitetura de método. Testes contra servidor falso local, com os casos de abuso dos pareceres. Seções E.2–E.5.
- **T3 — `AgendaProvider` de verdade.** Interface que a ADR 0019 promete; adaptadores iCal e MedX; migration que amplia o `CHECK` de `provedor`; trava única por clínica; UNIQUE de provedor ativo; recusa do iCal com MedX ligado. **A suíte atual do iCal passa inalterada.**
- **T4 — Agenda do MedX → cartões.** Seção B inteira: lista branca, janelas e hora, tudo ou nada, confirmação por id, HMAC, supressão, paciente desativado, cooldown, registro de ciclo, retenção. E2e com Postgres real: criar, remarcar, remarcar para +75, cancelar, sumir, leitura vazia por janela, página 3 de 5 falhando, paciente anonimizado, três leituras iguais.
- **T5 — Leitura de faturamento.** `Dinheiro.deDecimalExterno` com as 16 propriedades do parecer de números; tabela + histórico; jobs horário e noturno; tudo ou nada; trava de vazio; advisory lock. E2e: dia zerado por estorno, página 2 de 3 falhando, leitura vazia com histórico, leituras fora de ordem, três leituras iguais. Só liga depois da C.0.
- **T6 — Tela do superadmin (Integrações)** e bloco só leitura da clínica (seções A e D).
- **T7 — Indicadores MedX** (C.8–C.11, `metas_do_mes.medida_por`, `medidoParaAMeta`). **Entra junto com a Entrega 1.**

Ordem: T1 → T2 → T3 → T4 → T6 → T5 → T7. T3 pode correr em paralelo a T1/T2.

## Fora de escopo

- Qualquer escrita no MedX (confirmar, remarcar, cancelar, criar paciente).
- Importar pagamento do MedX como recebimento, caixa, saldo ou LTV (D1).
- Prontuário, exames, receitas, CPF, convênio.
- Concluir o cartão pelo comparecimento do MedX (`chegada`, `atendidoEm`) — spec própria (G5).
- Filtro por unidade para usuário MedX com várias unidades (A.3 recusa ligar).
- Amigo e Support Health (o `AgendaProvider` do T3 prepara o caminho).

## O que depende do dono ou da Marília

1. **Termo/aditivo de cada clínica** autorizando a leitura (A.0; liga com P-3 em `decisoes.md`). Sem ele o código pode ficar pronto, mas não liga.
2. **Usuário MedX dedicado** em cada clínica, só com as permissões de leitura, e a chave entregue numa chamada (colada ou ditada), nunca por WhatsApp ou e-mail; depois de entregue, gira-se o token (S-5, N4 LGPD).
3. **Meta de faturamento** de cada clínica com MedX: medida pela FIR ou pelo MedX.
4. **Confirmação e falta voltando ao MedX:** fora desta entrega (D5). Confirmar com a Marília que ela não espera isso agora.
5. **Primeira clínica para a calibração** (C.0) e para a semana de aceite (B.13): host da API de produção, nomes dos status 0–12, os 5 pagamentos de referência.
6. **Termos de uso do MedX** admitem uso por terceiro em nome da clínica (N3 LGPD).
