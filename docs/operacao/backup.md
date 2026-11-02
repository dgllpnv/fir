# Backup e restauração — produção

> **Backup não testado não é backup.** Este documento registra o que está
> montado, o **número medido** do ensaio de restauração (não o desejado), e o
> que falta — com nome e preço.

Estado em **2026-11-02**.

## O que existe

| | |
|---|---|
| Script de backup | `infra/producao/backup.sh` |
| Ensaio de restauração | `infra/producao/restaurar-ensaio.sh` |
| Agendamento | `/etc/cron.d/fir-backup`, diário às **03:10 UTC** (00:10 em `America/Bahia`) |
| Onde ficam | `/opt/fir/backups/` na VPS, modo 700 |
| Formato | `pg_dump -Fc` (comprimido) cifrado com **gpg AES256** |
| Chave | `/opt/fir/backup.chave`, modo 600 — **fora do `.env`** |
| Retenção | 30 diários + 12 mensais (dia 01, por hard link) |
| Verificação | todo backup é decifrado e lido por `pg_restore --list`; menos de 50 objetos ⇒ **recusado** |

### Por que a chave não está no `.env`

O `.env` tem as senhas do banco. Se a chave de cifra morasse lá, **perder um
arquivo perderia as duas coisas ao mesmo tempo** — o acesso ao banco e a
capacidade de ler os backups. São dois segredos com dois destinos diferentes no
cofre da equipe, de propósito.

> ⚠️ **Sem `/opt/fir/backup.chave`, NENHUM backup é restaurável** — nem o de
> hoje nem o de seis meses atrás. Ela precisa estar no cofre da equipe **antes**
> de qualquer incidente. Ela nunca é rotacionada em silêncio: rotacionar sem
> guardar a anterior transforma trinta backups em trinta arquivos inúteis.

## O ensaio, com o número medido

```
bash restaurar-ensaio.sh            # usa o backup mais recente
bash restaurar-ensaio.sh <arquivo>  # ou um especifico
```

Ele restaura num banco **descartável** (`fir_ensaio`), cronometra, e a
aceitação é a **comparação de contagens com o banco vivo**, tabela por tabela,
mais a contagem de tabelas com RLS ligada. Um restore que traz os dados e perde
a política devolve um banco em que toda clínica lê a outra — e "restaurou".

### Medição de 2026-11-02

| | |
|---|---|
| Arquivo | 122.400 bytes cifrados |
| Banco na origem | 12 MB |
| **RTO medido (dados)** | **1 s** |
| Erros do `pg_restore` | 0 |
| Conferências | 13/13 bateram (12 tabelas + RLS: 37 tabelas com política) |

**Este número não é o RTO de um incidente real, e não deve ser citado como
tal**, por duas razões:

1. **O banco estava quase vazio.** As três clínicas ainda não foram migradas.
   Com elas dentro (≈774 pacientes e ≈1.815 tarefas somadas), o ensaio
   **precisa ser repetido e o número reescrito aqui**.
2. **Falta o provisionamento.** O RTO de verdade é `implantar.sh` (subir
   Postgres, papéis, migrations, api e web) **mais** esta restauração. Medir só
   a segunda metade é relatar metade do caminho.

### Calendário

Repetir o ensaio **a cada quatro a seis épicos**, e obrigatoriamente:

- depois da migração de cada clínica real;
- antes de qualquer migration que mexa em tabela com dado financeiro ou de estoque.

Anote sempre o número medido, com data, nesta seção. Um RTO estimado não serve
para nada: ele é usado exatamente uma vez, sob pressão, e aí erra.

## ⚠️ O que NÃO existe: a cópia fora da VPS

**Hoje o backup está no mesmo disco do banco.** Se `/dev/sda1` morrer, os
trinta dumps morrem junto. Isso é cópia, não backup — e o `backup.sh` avisa
isso em **toda** execução, de propósito.

O **código do envio já está escrito** (`ssh` e `rclone`). O que falta é
exclusivamente a **credencial do destino**, que depende de uma decisão do dono:

| Opção | Custo/mês | O que o dono precisa fornecer |
|---|---|---|
| **Backblaze B2** | ~US$ 0,006/GB — centavos neste volume | chave de aplicação (`keyID` + `applicationKey`) e nome do bucket; exige instalar `rclone` na VPS |
| **Cloudflare R2** | gratuito até 10 GB | token de API e bucket; também via `rclone` |
| **Outro host com SSH** | zero, se já existir | `user@host:/caminho` e uma chave pública autorizada lá |

Para ligar, crie `/opt/fir/backup-remoto.conf` (modo 600):

```sh
REMOTO_TIPO=ssh                                 # ou: rclone
REMOTO_DESTINO=user@host:/srv/fir-backups/      # ou: b2:fir-backups/
```

O arquivo enviado **já está cifrado** e a chave **não viaja com ele**, então o
destino não precisa ser confiável — precisa ser **outro disco**. É isso que
torna um bucket de terceiro uma resposta aceitável para dado de saúde aqui.

Quando o envio estiver configurado e falhar, o `backup.sh` **falha** em vez de
avisar: um backup que para de sair da VPS em silêncio é o estado que se
descobre no dia do incidente.

## Retenção e LGPD

O backup carrega **dado pessoal sensível de saúde** (LGPD art. 11) e segue a
mesma classificação do banco: a retenção acima (30 dias + 12 meses) é o prazo
de **recuperação**, e não um direito de guardar para sempre. Quando uma
eliminação for executada no banco por pedido de titular, ela precisa alcançar
as cópias — hoje isso significa esperar a janela de retenção expirar, e **esse
limite tem de estar escrito na resposta ao titular**. Ver
`docs/compliance/retencao.md`.

## Custo mensal corrente

| Item | Custo |
|---|---|
| VPS (compartilhada com a Mavia e a produção de outros negócios) | já paga, não atribuída ao FIR |
| 4 containers do FIR (postgres, redis, api, web) | ~500 MB RAM, ~1 GB disco |
| Backups | ~120 KB/dia cifrado ⇒ ~4 MB/mês com a retenção cheia |
| Cópia fora da VPS | **US$ 0 hoje (não existe)**; centavos/mês quando ligada |

**Total adicional em dinheiro: zero hoje.** O FIR não acrescentou custo
mensal — acrescentou consumo numa máquina já paga. O item que vai custar
dinheiro é o destino remoto, e ele custa centavos.

## Operação

```bash
cd /opt/fir/repo/infra/producao

bash backup.sh                 # a mao (o cron ja faz diariamente)
bash restaurar-ensaio.sh       # o ensaio, cronometrado
cat /opt/fir/backups/manifesto.txt     # historico: data, tamanho, objetos
```

Restaurar **valendo**, num incidente, é deliberadamente **não** um script: ele
seria o comando mais perigoso do repositório, a um `↑ Enter` de distância do
`restaurar-ensaio.sh`. O caminho é decifrar e aplicar à mão, com o serviço
parado e depois de um dump do estado corrente:

```bash
gpg --decrypt --passphrase-file /opt/fir/backup.chave <arquivo> \
  | docker compose exec -T postgres pg_restore -U fir -d fir --clean --if-exists
```
