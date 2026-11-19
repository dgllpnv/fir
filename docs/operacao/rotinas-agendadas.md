# Rotinas agendadas

Tudo que roda sozinho em produção: filas BullMQ, processos periódicos dos
containers e crons da máquina. Conferido no código em 2026-11-19.

Fontes: `apps/api/src/**/fila-*.ts` e `worker-*.ts`,
`infra/producao/docker-compose.yml`, `infra/producao/cron-fir-backup`.

## Como os jobs funcionam

- **BullMQ sobre o Redis do FIR.** Cada worker é um processo próprio, da
  mesma imagem `fir/api`, com outro `command`. Nenhum serve HTTP, nenhum
  publica porta.
- **O worker registra o próprio agendamento ao subir**, com `jobId` fixo. Um
  deploy novo não duplica o agendamento.
- **Os horários são em UTC** (`tz: 'UTC'`). O que cada job calcula ("ontem",
  "o mês") é no fuso de cada clínica, dentro do job.
- **Não há nova tentativa automática.** Nenhum job define `attempts`. Um job
  que falha fica na lista de falhas do BullMQ (as últimas 20 a 200, conforme
  a fila) e a próxima execução agendada cobre o atraso. Todo job é
  idempotente: rodar duas vezes dá o mesmo resultado.
- **Worker caído não derruba o balcão.** A API não depende de nenhum worker
  para servir. O que para é a rotina dele.
- **O sinal de falha é de negócio**, não de container. Os workers não têm
  healthcheck (ver o comentário no compose). Quem reinicia é
  `restart: unless-stopped`, quando o processo morre.

## Inventário

### Filas BullMQ

| Fila · job | Quando (UTC) | Container | O que faz | Se falhar |
|---|---|---|---|---|
| `agenda-sincronizacao` · `todas` | a cada 15 min (`*/15 * * * *`) | `worker-agenda` | Baixa a agenda externa (iCal ou MedX) de cada clínica ativa e concilia os compromissos. Compromisso que sumiu vira proposta de recontato, nunca cancelamento | A clínica grava `ultimo_erro` em `agendas_externas` e as outras seguem. A agenda deixa de se atualizar; o balcão continua. Log `[agenda] ... falha(s)` |
| `agenda-sincronizacao` · `uma` | sob demanda ("Sincronizar agora") | `worker-agenda` | O mesmo, para uma clínica. `jobId` por clínica: três cliques viram um job | Igual ao acima |
| `agenda-sincronizacao` · `faturamento` | de hora em hora, minuto 5 (`5 * * * *`) | `worker-agenda` | Lê o faturamento do MedX das clínicas com a integração ligada. A primeira volta depois das 02:00 da clínica relê 13 meses | A clínica grava `faturamento_ultimo_erro` e as outras seguem. Log `[faturamento] rodada: N lida(s), M falha(s)` |
| `agenda-sincronizacao` · `testar-integracao` | sob demanda ("Testar conexão", no painel) | `worker-agenda` | Testa a conexão da integração de uma clínica. Vai nesta fila porque só este worker tem saída para a internet | O resultado volta como falha do teste; nada é gravado na clínica |
| `carteira-planilhas` · `todas` | a cada 30 min, minutos 7 e 37 | `worker-planilhas` | Lê as planilhas de indicadores dos clientes da carteira pela API do Google Sheets | Cada leitura grava o erro em `planilhas_do_cliente`. Sem `GOOGLE_SA_JSON`, grava "não configurado" e o worker não cai |
| `carteira-planilhas` · `um-cliente` | sob demanda ("Ler planilha agora") | `worker-planilhas` | O mesmo, para um cliente | Igual ao acima |
| `carteira-uso-diario-cliente` · `calcular-uso-diario` | todo dia, 06:00 | `worker-uso-diario` | **Três jobs em sequência, cada um isolado** (a falha de um não impede o seguinte): (1) `carteira:uso-diario` — telemetria de uso de cada clínica cliente e os KPIs para a carteira; (2) `indicadores-do-dia` — fotografias dos KPIs de posição e tarefas de lançamento de KPI; (3) `retencao-do-acesso` — apaga links de acesso vencidos há 30 dias e eventos de acesso com 1 ano | **Só o log mostra**: `[<nome do job>] falhou: <código>`. O job BullMQ termina como concluído mesmo assim. Também roda uma vez ao subir o worker, para recuperar o dia perdido num deploy |
| `carteira-gerar-tarefas-de-rotinas-internas` | todo dia, 06:30 | `worker-rotinas-internas` | Gera as tarefas do dia das rotinas internas da equipe Firmare | Tarefas do dia não aparecem. Rodar de novo não duplica (`ON CONFLICT DO NOTHING`) |
| `carteira-gerar-cobrancas` · `gerar-cobrancas-do-mes` | **todo dia**, 07:00 | `worker-cobrancas` | Gera a cobrança do mês de cada Cliente Firmare que ainda não tem. Diário para pegar cliente que entrou no meio do mês | Cobrança do mês não é gerada até a próxima rodada. Nunca duplica nem muda valor já gravado |
| `carteira-sincronizar-campanhas` · `sincronizar-campanhas` | todo dia, 07:30 | `worker-campanhas` | Copia as campanhas de cada clínica cliente para a carteira (`campanhas_carteira`), por mês | Carteira mostra campanhas de ontem. UPSERT: rodar de novo dá as mesmas linhas |
| `carteira-varrer-anexos` · `varrer-anexos-pendentes` | a cada 30 s | `worker-anexos` | Passa os anexos `pendente` da carteira pelo antivírus (clamd). Infectado: apaga o arquivo e mantém a linha | Anexo fica `pendente`, e `pendente` não é servido a ninguém (falha fechada). Esperado na primeira subida, enquanto as assinaturas baixam |

### Processos periódicos dentro de containers

| Rotina | Quando | Container | O que faz | Se falhar |
|---|---|---|---|---|
| `freshclam` | 12 vezes por dia (`--checks=12`) | `clamav-atualizador` | Baixa as assinaturas do antivírus para o volume `clamav-assinaturas` | Assinaturas envelhecem; a varredura continua com as antigas |
| `SelfCheck` do clamd | a cada 600 s | `clamav` | Recarrega as assinaturas quando o volume muda | Mesmo efeito acima |

### Na máquina (host)

| Rotina | Quando | Onde | O que faz | Se falhar |
|---|---|---|---|---|
| Backup | todo dia, 03:10 UTC | `/etc/cron.d/fir-backup` → `backup.sh` | `pg_dump` cifrado com gpg, verificado por `pg_restore --list`, mais o tar cifrado dos anexos. Retenção 30 diários + 12 mensais. Com `nice -n 19` e `ionice -c3` | O script sai com erro e escreve em `/var/log/fir-backup.log`. **Ninguém é avisado hoje**: a falha só aparece lendo o log ou o `manifesto.txt`. Ver [`backup.md`](backup.md) |
| Regras de egress | a cada boot, depois do Docker | unidade systemd `<projeto>-egress.service` | Reaplica as regras `DOCKER-USER` das redes `saida-planilhas` e `saida-email` | Sem a regra, o deploy seguinte recusa (com e-mail ligado) ou avisa (planilhas). Ver `infra/producao/README.md` |
| `docker image prune -af` | todo dia, 00:00 + atraso aleatório | `/etc/cron.d/docker-image-prune` | **Não é nosso, e não se altera.** Remove imagens sem container há mais de 24 h | Afeta o RTO: depois de um `down` longo, as imagens do FIR somem e precisam ser reconstruídas |

## O que não é rotina agendada

- **O envio de e-mail** sai do próprio processo da API, logo depois da
  resposta (`setImmediate`). Não há fila: o token do link nunca vai para o
  Redis. Se o envio falhar, a API registra `[correio] ...: falhou`.
- **Migrations** rodam só no deploy (`implantar.sh`, passo 5).
- **Purga da trilha de auditoria** e **eliminação de `uso_diario_cliente` e
  `kpis_na_carteira`** não existem ainda. Ver `docs/dividas.md` (D9 e
  seguintes).

## Comandos

Os nomes de container dependem do nome do projeto do Compose na VPS (ver
[`logs.md`](logs.md)). Rode do diretório `infra/producao` do checkout.

```bash
docker compose ps                                 # estado de todos
docker compose logs --since 24h worker-uso-diario # a rodada das 06:00
docker compose restart worker-cobrancas           # reinicia um worker
```

Ver os agendamentos registrados no Redis (só leitura; o `redis-cli` lê a
senha de `REDISCLI_AUTH`, que o compose já define):

```bash
docker compose exec redis redis-cli KEYS 'bull:*:repeat*'
```

**Refazer a rodada diária perdida** (deploy ou queda às 06:00): basta
reiniciar o `worker-uso-diario`. Ao subir, ele roda os três jobs de novo (a
telemetria de "ontem", a fotografia do instante e a retenção). É seguro: tudo
é UPSERT ou reentrante.

```bash
docker compose restart worker-uso-diario
docker compose logs --since 10m worker-uso-diario
```

Um dia mais antigo exige enfileirar o job com `{ dia: "AAAA-MM-DD" }`. Não há
comando pronto para isso; faça-o com o serviço de pé e anote aqui o comando
que funcionou.

## Desenvolvimento local

`fir workers` sobe os mesmos sete workers com `tsx watch`
(`apps/api/dev-workers.mjs`). Exige `fir infra` antes, para o Redis estar no
ar.
