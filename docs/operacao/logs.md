# Logs

Onde ficam os logs em produção, o que nunca pode estar neles, e os comandos
para lê-los. Conferido em 2026-11-19.

## Antes de qualquer comando: qual projeto

O nome do projeto do Compose vem de `name:` em
`infra/producao/docker-compose.yml`. No repositório é `fir`, e os containers
se chamam `fir-<serviço>-1`.

**Na VPS de produção o projeto se chama `firmaregestao`.** Containers com
prefixo `fir-` que existam lá **não são deste sistema, e não se tocam.**

Por isso, rode sempre `docker compose ...` de dentro de
`<checkout>/infra/producao`. O Compose acha o projeto certo sozinho. Use
`docker logs <container>` só depois de conferir o nome com `docker compose ps`.

## Onde ficam

Nenhum serviço escreve log em arquivo próprio. Tudo vai para stdout/stderr,
e o Docker guarda.

| Serviço | O que aparece |
|---|---|
| `api` | Subida do Nest, erros não tratados, `[correio]` (finalidade, resultado, endereço mascarado). **Sem log de requisição** |
| `web` | Subida e erros do servidor do Next |
| `worker-agenda` | `[agenda]`, `[faturamento]`, `[integracoes]`: contagens e id de clínica |
| `worker-planilhas` | `[carteira:planilhas]`: contagens e id de cliente |
| `worker-uso-diario` | `[carteira:uso-diario]`, `[indicadores-do-dia]`, `[retencao-do-acesso]`: contagens e ids |
| `worker-cobrancas` | `[carteira:cobrancas]`: geradas e falhas |
| `worker-rotinas-internas` | `[carteira:rotinas-internas]`: tarefas geradas |
| `worker-campanhas` | `[carteira:campanhas]`: clientes e linhas gravadas |
| `worker-anexos` | `[carteira:anexos]`: limpos, infectados, ilegíveis |
| `clamav`, `clamav-atualizador` | Antivírus e atualização de assinaturas |
| `postgres`, `redis` | Logs padrão das imagens oficiais |

Fora dos containers:

| Log | Onde |
|---|---|
| Backup diário | `/var/log/fir-backup.log` (o cron redireciona para lá) e `<diretório de backups>/manifesto.txt` |
| Regras de egress | `journalctl -u <projeto>-egress` |
| Deploy | Onde quem rodou `implantar.sh` mandou a saída. Guarde-a fora do repositório |
| Traefik (access log) | **É do EasyPanel, não nosso.** Grava método, caminho e status. Só leitura |

### Rotação

**O compose não configura `logging:`.** Vale o driver padrão do daemon
Docker da VPS. O padrão de fábrica é `json-file` **sem limite de tamanho**.
O disco é compartilhado com outros negócios, e disco cheio é a causa número
um de queda em VPS.

Confira na máquina:

```bash
docker info --format '{{.LoggingDriver}}'
cat /etc/docker/daemon.json 2>/dev/null     # procure "log-opts": {"max-size": ...}
du -sh /var/lib/docker/containers/*/*-json.log | sort -h | tail
```

O `daemon.json` é da máquina inteira: **não mexa nele**. Se faltar rotação,
o remédio é nosso: `logging:` com `max-size` e `max-file` em cada serviço do
compose. Está registrado em `docs/dividas.md` (D-LOG).

`/var/log/fir-backup.log` também não tem `logrotate` no repositório. Cresce
pouco (algumas linhas por dia), mas cresce.

## O que é proibido em log

Regra 21 do `CLAUDE.md`, e I-51 da spec de indicadores:

- **Nunca** nome de paciente, telefone, e-mail em claro, valor, salário,
  dose, produto ou lote por paciente.
- **Nunca** filtros de relatório, linhas de relatório, valor de KPI, nome de
  KPI manual, comentário, frase de prévia, nem o corpo de `/v1/relatorios*`.
- **Nunca** segredo: senha, token de link, chave, `DATABASE_URL` (tem senha
  dentro), conteúdo de `.env`. O `implantar.sh` imprime só o **nome** das
  chaves que acrescenta.
- **Nunca** título de compromisso, link de agenda, número lido de planilha.

O que pode: ids (clínica, cliente, job), contagens, códigos de erro
(`code` do Postgres, nome da classe do erro). Os jobs diários logam o código,
nunca a mensagem, porque a mensagem do Postgres pode citar o valor de uma
coluna.

Como isso é garantido:

- A API sobe o `FastifyAdapter` **sem logger**. Não ligue um: o teste
  `log-sem-conteudo` reprova.
- Os filtros dos relatórios vão no **corpo** de um `POST`, nunca na URL. O
  access log do Traefik vê só o caminho.
- **Não** ligue `accesslog.fields.headers` em modo `keep`, nem captura de
  corpo em middleware, nem `?filtro=` em rota de relatório.

**Ao colar log em conversa, ticket ou commit**: só a linha que importa.
O repositório é público.

## Comandos prontos

`<VPS>`, `<chave>` e `<checkout>` são placeholders. Os valores reais ficam
onde a equipe guarda senhas, nunca aqui.

Entrar:

```bash
ssh -i <chave> root@<VPS>
cd <checkout>/infra/producao
docker compose ps
```

Ler:

```bash
docker compose logs --tail 200 api
docker compose logs -f --since 10m api web          # acompanhar
docker compose logs --since 24h worker-uso-diario   # a rodada das 06:00
docker compose logs --since 2h worker-agenda | grep -E 'falh'
docker compose logs --since 1h | grep -iE 'error|erro|falhou'
docker compose logs api | grep correio             # envio de e-mail
tail -n 50 /var/log/fir-backup.log
journalctl -u <projeto>-egress -n 20 -o cat
```

Num comando só, sem abrir sessão:

```bash
ssh -i <chave> root@<VPS> 'cd <checkout>/infra/producao && docker compose logs --since 1h --tail 300 api'
```

Traefik (só leitura; o serviço é do EasyPanel):

```bash
docker service ls | grep -i traefik
docker service logs --since 30m <serviço-do-traefik> 2>&1 | grep '<DOMINIO>'
```

Uso de disco dos logs do FIR:

```bash
for c in $(docker compose ps -q); do
  docker inspect -f '{{.Name}} {{.LogPath}}' "$c"
done | while read n p; do echo "$(du -h "$p" | cut -f1) $n"; done
```
