# ADR — A API ganha uma saída, só para o SMTP

- **Data:** 2026-11-17
- **Estado:** aceita
- **Origem:** medição de que o acesso por e-mail nunca sairia em produção
- **Relaciona:** ADR 2026-11-16 (acesso por e-mail), spec `docs/specs/acesso-por-email.md` (seção 7 e seção 10, item 8)

## Contexto

O envio de convite, redefinição e confirmação roda **dentro do processo da API**. A spec manda assim (seção 10, item 8, appsec 11 e 13): o envio sai depois da resposta, por `setImmediate`, sem fila em Redis, e o token cru nunca sai do processo.

Em `infra/producao/docker-compose.yml`, porém, a `api` estava só na rede `dados`, que é `internal: true`, e o compose não repassava `SMTP_HOST`, `SMTP_PORTA`, `SMTP_USUARIO`, `SMTP_SENHA`, `EMAIL_REMETENTE` nem `URL_PUBLICA`. Com o provedor contratado, o envio continuaria desligado, e nenhuma tela mostraria isso.

## Decisão

1. **Rede `saida-email`, só da `api`**, bridge com sub-rede fixa `172.31.247.0/24`. Ela fica ao lado da `saida-planilhas` (`172.31.248.0/24`) sem sobrepor.
2. **Regra de egress por porta** em `DOCKER-USER`: da sub-rede saem só DNS (53) e TCP 465. Todo o resto é DROP. Por porta e não por IP porque `smtp.resend.com` é um ELB da AWS, e os endereços dele mudam sem aviso. A escolha da 465 (TLS implícito) segue a documentação pública do Resend, conferida em 2026-11-17: ele aceita 25, 587 e 2587 com STARTTLS, e 465 e 2465 com TLS implícito. O código já põe `secure` só na 465.
3. **As seis variáveis entram com padrão vazio**, e `SMTP_PORTA` com 465. O envio continua desligado até alguém preencher `SMTP_HOST`.
4. **O deploy mede as duas metades** (`implantar.sh` 7.6b):
   - **Estrutura**: as redes da `api` são exatamente `dados` e `saida-email`. Diferente disso é erro.
   - **Egress**: com a regra aplicada, a API não alcança `github.com:443`.
     - Se alcança com `SMTP_HOST` preenchido, o deploy é **recusado**.
     - Se alcança com o envio desligado, é **aviso**. O deploy de outra coisa não fica refém de uma mudança de firewall que depende do dono.

   O 7.6 continua medindo que o Postgres não tem rota. O 7.6f avisa se a API não abre TCP com o SMTP quando o envio está ligado.
5. **O envio só liga com a LGPD L10 feita** (spec, seção 7). Fica registrado no README de produção.

## Alternativas recusadas

- **Worker de e-mail com fila no Redis**, como os outros serviços que falam com a internet. A spec recusou: o token, que sozinho vale como senha nova, passaria a existir em claro no Redis, no AOF e no processo do worker.
- **Pôr a `api` na `saida` do worker-agenda.** A API passaria a enxergar o worker-agenda pelo nome e a ter saída HTTPS livre, que é a rota de exfiltração que importa.
- **Regra por IP do provedor.** Quebraria em silêncio quando a AWS trocasse os endereços. Envio que falha não muda nada que o cliente veja, de propósito, então ninguém notaria.
- **Usar a porta 587 com STARTTLS.** Também é segura, porque o código exige `requireTLS`. A 465 tem TLS desde o primeiro byte, e basta uma porta na regra.

## Consequências

- A invariante "a API não tem rota de saída" vira "a API só sai pela 465". Enquanto a regra de egress não for aplicada na VPS, a API tem saída livre. É uma regressão que o deploy anuncia com aviso a cada execução. Aplicar a regra é decisão do dono, porque o firewall é de uma máquina compartilhada, mesmo a regra só tocando a sub-rede do FIR.
- As regras de `iptables` não sobrevivem a um reboot sem persistência. Com o envio ligado, o 7.6b recusa o primeiro deploy depois de um reboot que as tenha perdido. Isso é o comportamento desejado.
- Se a faixa `172.31.247.0/24` colidir com outra rede da VPS, o `compose up` falha em voz alta. Nesse caso troque a faixa no compose e na regra.
