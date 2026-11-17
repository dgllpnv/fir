# ADR — A API ganha uma saída, só para o SMTP, e só quando o envio liga

- **Data:** 2026-11-17
- **Estado:** aceita
- **Origem:** medição de que o acesso por e-mail nunca sairia em produção
- **Relaciona:** ADR 2026-11-16 (acesso por e-mail), spec `docs/specs/acesso-por-email.md` (seção 7 e seção 10, item 8)

## Contexto

O envio de convite, redefinição e confirmação roda **dentro do processo da API**. A spec manda assim (seção 10, item 8, appsec 11 e 13): o envio sai depois da resposta, por `setImmediate`, sem fila em Redis, e o token cru nunca sai do processo.

Em `infra/producao/docker-compose.yml`, porém, a `api` estava só na rede `dados`, que é `internal: true`, e o compose não repassava `SMTP_HOST`, `SMTP_PORTA`, `SMTP_USUARIO`, `SMTP_SENHA`, `EMAIL_REMETENTE` nem `URL_PUBLICA`. Com o provedor contratado, o envio continuaria desligado, e nenhuma tela mostraria isso.

## Decisão

1. **As seis variáveis entram no compose base com padrão vazio**, e `SMTP_PORTA` com 465. O envio continua desligado até alguém preencher `SMTP_HOST`.
2. **A saída é opt-in.** A rede `saida-email` e a ligação da `api` a ela ficam em `infra/producao/docker-compose.email.yml`, fora do compose base.
   - `implantar.sh` só inclui esse arquivo, via `COMPOSE_FILE`, com `SMTP_HOST` preenchido.
   - Com o envio desligado, a API continua **sem rota de saída nenhuma**, como antes. Uma saída que ninguém usa só piora a postura.
3. **A rede é uma bridge com sub-rede fixa `172.31.247.0/24`**, só da `api`. Ela fica ao lado da `saida-planilhas` (`172.31.248.0/24`) sem sobrepor.
4. **A regra de egress é por porta**, em `DOCKER-USER`: da sub-rede saem só DNS (53) e TCP 465, e todo o resto é descartado.
   - Por porta e não por IP porque `smtp.resend.com` é um ELB da AWS, e os endereços dele mudam sem aviso.
   - A escolha da 465 (TLS implícito) segue a documentação pública do Resend, conferida em 2026-11-17: ele aceita 25, 587 e 2587 com STARTTLS, e 465 e 2465 com TLS implícito. O código já põe `secure` só na 465.
5. **A ordem é: regra de iptables, depois variáveis, depois deploy.** Aplicar a regra antes de a rede existir é inofensivo, porque ela casa uma sub-rede vazia.
6. **O deploy mede os dois modos** (`implantar.sh` 7.6b):
   - **Desligado**: as redes da `api` são exatamente `[fir_dados]`, e a API resolver um nome externo é erro. É a medida de antes.
   - **Ligado**: as redes são exatamente `fir_dados` e `fir_saida-email`, e a API alcançar `github.com:443` é erro. Sem a regra, o deploy é recusado.

   A 7.6 continua medindo que o Postgres não tem rota. A 7.6f avisa se a API não abre TCP com o SMTP quando o envio está ligado.
7. **O envio só liga com a LGPD L10 feita** (spec, seção 7). Fica registrado no README de produção.

## Alternativas recusadas

- **Worker de e-mail com fila no Redis**, como os outros serviços que falam com a internet. A spec recusou: o token, que sozinho vale como senha nova, passaria a existir em claro no Redis, no AOF e no processo do worker.
- **A rede no compose base, sempre ligada.** Era a primeira versão (commit 332c8f6). A API ganharia saída livre no deploy seguinte, com o envio ainda desligado, até alguém aplicar o iptables. Seria uma regressão sem ganho nenhum.
- **Pôr a `api` na `saida` do worker-agenda.** A API passaria a enxergar o worker-agenda pelo nome e a ter saída HTTPS livre.
- **Regra por IP do provedor.** Quebraria em silêncio quando a AWS trocasse os endereços. Envio que falha não muda nada que o cliente veja, de propósito, então ninguém notaria.
- **Usar a porta 587 com STARTTLS.** Também é segura, porque o código exige `requireTLS`. A 465 tem TLS desde o primeiro byte, e basta uma porta na regra.

## Consequências

- Com o envio desligado, nada muda na rede: a API segue sem rota de saída.
- Com o envio ligado, a invariante "a API não tem rota de saída" vira "a API só sai pela 465".
- As regras de `iptables` não sobrevivem a um reboot sem persistência. Com o envio ligado, a 7.6b recusa o primeiro deploy depois de um reboot que as tenha perdido. Isso é o comportamento desejado.
- **Comandos do Compose digitados à mão leem só o arquivo base.** Com o envio ligado, o README manda pôr `COMPOSE_FILE=docker-compose.yml:docker-compose.email.yml` no `.env`. `implantar.sh` decide o valor sozinho e avisa se o `.env` discordar.
- Se a faixa `172.31.247.0/24` colidir com outra rede da VPS, o `compose up` falha em voz alta. Nesse caso troque a faixa no override e na regra.
