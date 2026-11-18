# Produção — Firmare Rotinas de Gestão

Na mesma VPS do Mavia, **ao lado e nunca dentro** da orquestração do
EasyPanel: containers comuns, descobertos pelo Traefik por label, Postgres
próprio, rede de dados sem rota de saída, só o `web` encarando a internet.

## O deploy, em um comando

```bash
ssh root@2.24.79.49
cd /opt/fir/repo && git fetch origin && git reset --hard origin/fundacao
cd infra/producao && bash implantar.sh
./redefinir-superadmin.sh <usuario> "Nome"   # cria o PRIMEIRO operador
```

**`implantar.sh` constrói as imagens.** Era em dois comandos, e o segundo
sozinho mentia: as oito asserções passavam, ele imprimia "FIR em https://…", e
o container seguia com a imagem anterior — `docker compose up` escreve
`Running` em vez de `Started`, numa linha que ninguém lê como erro. Duas
guardas por timestamp tentaram cobrir isso e **recusaram deploys corretos**,
porque imagem reaproveitada do cache preserva o `Created` antigo. Agora cada
imagem carrega `LABEL fir.commit` e o deploy compara identidade com o `HEAD` do
disco; construir ali acaba com a pergunta "você lembrou de construir?".

`implantar.sh` é idempotente: rodar duas vezes não recria segredo, não reaplica
migration e não perde dado. Ele faz os passos 1 a 5 abaixo e termina com
asserções (onze, desde o `worker-agenda`) — **um deploy que não é verificado não é um deploy**.

O passo 6 fica fora dele de propósito: ele imprime uma senha na tela, e um
passo que imprime segredo não pertence a um script que alguém roda de novo por
reflexo.

## A ordem obrigatória, e o que acontece fora dela

```
1.  segredos no .env  (incluindo SENHA_PAINEL e DATABASE_URL_PAINEL)
2.  docker compose up -d postgres redis    # 10-papeis.sh roda AQUI, uma vez
3.  ./provisionar-painel.sh                # cria e credencia fir_painel
4.  migrar.js, como fir_migrate            # a 0013 CONFERE o papel
5.  docker compose up -d api web worker-agenda
6.  ./redefinir-superadmin.sh <usuario> "Nome"   # cria o PRIMEIRO operador
```

### Conferência antes da migration 0084 (tarefas para grupo)

A 0084 acrescenta uma FK composta `(responsavel_id, clinica_id)` que **valida todas as linhas**
existentes. Se alguma tarefa tiver responsável de outra clínica, a migration falha no meio do deploy.
Confira antes, no banco de produção; o resultado tem de ser **0**:

```sql
SELECT count(*) FROM tarefas t
  JOIN pessoas p ON p.id = t.responsavel_id AND p.clinica_id <> t.clinica_id;
```

Diferente de 0: não aplique; é dado corrompido a investigar. A 0084 já aplicada não se edita.

### ⚠️ A armadilha da ordem — medida, não deduzida

A versão anterior deste README mandava provisionar o painel **depois** de subir
o Postgres. **Isso não funciona, e o motivo não é óbvio:** o Compose interpola
o arquivo INTEIRO antes de decidir o que subir, então `DATABASE_URL_PAINEL:?`
na definição da `api` derruba até `docker compose up -d postgres`. Medido:

```
error while interpolating services.api.environment.DATABASE_URL_PAINEL:
required variable DATABASE_URL_PAINEL is missing a value: rode ./provisionar-painel.sh
```

E `provisionar-painel.sh` usa `docker compose exec` — então ele também falha. O
passo que existe para resolver a pendência não consegue rodar: é um laço, e
quem o encontrar às duas da manhã vai ler a mensagem como "falta rodar o script
que acabei de tentar rodar".

Por isso `implantar.sh` escreve `SENHA_PAINEL` e `DATABASE_URL_PAINEL` no
`.env` **antes de qualquer comando do Compose**. `provisionar-painel.sh`
continua sendo quem cria e credencia o papel no Postgres — ele acrescenta
chave só se faltar, então encontra as duas já lá e vai direto ao SQL. A guarda
`:?` continua valendo para quem rodar o Compose à mão com `.env` incompleto,
que é de quem ela sempre foi.

**Fora de ordem, a `0013` para**, e o `RAISE EXCEPTION` dela diz exatamente o
que fazer:

- sem o passo 3, `o papel fir_painel não existe`;
- com `BYPASSRLS` no papel, `fir_painel tem BYPASSRLS ou SUPERUSER`.

As duas são deliberadas. Um `IF EXISTS` que pulasse os GRANTs em silêncio
deixaria o painel subir sem privilégio e falhar na primeira escrita, em
produção, sem ninguém ligar o sintoma à causa.

O passo 6 é o único jeito de ter o primeiro operador: **o painel não tem como
criar um operador antes de existir um.**

## worker-agenda

O processo que sincroniza a agenda iCal das clínicas (ADR 0019): a cada 15 min
por job repetível, e sob demanda quando alguém aperta "Sincronizar agora" (a
API só enfileira em `agenda:sincronizacao`). Mesma imagem `fir/api`, outro
`command` (`node worker-agenda.js`). Não serve HTTP, não publica porta, não tem
label do Traefik.

Ele sai para a internet pela rede `saida` (bridge comum), que é só dele. Ele
fica também na `dados`, para falar com Postgres e Redis — como
`fir_app`, sob RLS, nunca como `fir_migrate`. O banco continua sem rota de
saída, e a API também — salvo com o envio de e-mail ligado, quando ganha a
`saida-email`, restrita à porta do SMTP (ver "Ligar o envio de e-mail"); o
deploy mede as duas coisas (asserções 7.6 e 7.6b), além de
medir que o worker não está em laço de reinício (7.6c) e que ele resolve nome
externo (7.6d, aviso).

Como ele enxerga a rede interna **e** a internet, a trava contra SSRF não é
opcional: ela mora no `lookup` da conexão (`apps/api/src/agenda/baixar-feed.ts`)
e recusa endereço privado, loopback, link-local e CGNAT. Mexer ali é mexer na
fronteira de rede deste compose.

Sem healthcheck, de propósito (o herdado da imagem é HTTP e ficaria
`unhealthy` para sempre; o motivo completo está no compose). Teto de 256 MB e
meia vCPU — a máquina é compartilhada.

```bash
docker compose logs -f worker-agenda          # acompanhar
docker compose ps worker-agenda               # estado
docker compose restart worker-agenda          # reiniciar só ele
```

Se ele cair, o balcão continua funcionando: o que para é a agenda deixar de
se atualizar. O sinal disso é de negócio (clínica cuja sincronização parou de
dar certo), não um gráfico de container.

## worker-planilhas (G8 4A)

Lê as planilhas de indicadores dos clientes da carteira pela API do Google
Sheets, com a conta de serviço: a cada 30 min e sob demanda ("Ler planilha
agora" só enfileira em `carteira-planilhas`). Mesma imagem, `node
worker-planilhas.js`. A chave da conta de serviço (`GOOGLE_SA_JSON`) existe
**só neste container**; a API recebe apenas `GOOGLE_SA_EMAIL`.

Rede própria `saida-planilhas` (sub-rede fixa `172.31.248.0/24`), separada da
`saida` do worker-agenda. O código já fala só com `oauth2.googleapis.com` e
`sheets.googleapis.com` (URLs fixas, sem seguir redirecionamento, teto de
tamanho). A rede é a segunda camada: **da `saida-planilhas` saem só DNS (53)
e TCP 443**, por regra em `DOCKER-USER` (ver "Regras de egress", abaixo).
Aplicada na VPS em 2026-11-17 — até então a regra só existia como proposta, e
o worker tinha saída livre.

**Por porta, não por destino.** A regra não prende o worker aos hosts do
Google: com o processo comprometido, ele ainda alcança qualquer servidor na
443. O que ela tira é todo o resto (80, 22, 25, portas altas, protocolos
não-TCP). Prender por faixa do Google (ipset alimentado por `goog.json`) foi
recusado: as faixas são largas — incluem o Google Cloud, onde qualquer um
hospeda um servidor — e dinâmicas, e uma lista desatualizada derrubaria a
leitura em silêncio. Decisão e alternativa (proxy com allowlist por nome) em
`docs/adr/2026-11-17-saida-das-planilhas.md`.

O passo 7.6e do `implantar.sh` avisa se o worker não resolve
`sheets.googleapis.com`; o 7.6e' avisa se ele alcança `github.com:80` (a regra
sumiu) ou se não abre `sheets.googleapis.com:443`.

## Regras de egress (persistidas)

As redes de saída com filtro são duas, cada uma com sub-rede fixa e um só
serviço:

| Rede | Sub-rede | Serviço | Sai por |
|---|---|---|---|
| `saida-email` (opt-in) | `172.31.247.0/24` | `api` | DNS 53, TCP 465 |
| `saida-planilhas` | `172.31.248.0/24` | `worker-planilhas` | DNS 53, TCP 443 |

A `saida` do `worker-agenda` **não tem filtro**, de propósito: o iCal das
clínicas pode estar em qualquer host e porta. A `saida-antivirus` também não
(o freshclam fala com os mirrors do ClamAV).

As regras moram em `egress/regras-de-egress.sh` e sobrevivem a reboot por uma
unidade systemd (`egress/egress.service`), que roda depois do Docker. O script
é idempotente por sub-rede: se as regras já estão exatas, não toca em nada; se
faltam ou sobram, refaz só as daquela sub-rede. Nunca toca em regra de outra
faixa — a `DOCKER-USER` é da máquina inteira, e a VPS é compartilhada.

Instalar (ou atualizar depois de mudar o script), como root na VPS —
`<projeto>` é o nome do projeto do compose (`firmaregestao` na VPS de
produção):

```bash
install -m 755 egress/regras-de-egress.sh /usr/local/sbin/<projeto>-egress.sh
install -m 644 egress/egress.service /etc/systemd/system/<projeto>-egress.service
# confira o ExecStart do .service contra o caminho acima
systemctl daemon-reload
systemctl enable --now <projeto>-egress.service
systemctl restart <projeto>-egress.service   # reaplica; idempotente
journalctl -u <projeto>-egress -n 5 -o cat   # "já aplicada" / "aplicada", por sub-rede
iptables -S DOCKER-USER
```

Só IPv4: as duas redes têm `EnableIPv6=false`. Ligar IPv6 numa delas abre uma
rota que o script não filtra.

## Ligar o envio de e-mail (acesso por e-mail)

Convite, "esqueci minha senha" e confirmação de e-mail saem **de dentro do
processo da API** (spec `docs/specs/acesso-por-email.md`, seção 10, item 8): o
link leva um token que é, sozinho, a senha nova de alguém, e ele nunca sai do
processo — nem para o Redis, nem para um worker. Por isso a `api` precisa de
uma saída, a rede `saida-email` (sub-rede fixa `172.31.247.0/24`), e só ela
está nessa rede. Decisão em `docs/adr/2026-11-17-saida-de-email-da-api.md`.

**Opt-in, e desligado por padrão.** A rede e a ligação da `api` a ela moram
num arquivo à parte, `docker-compose.email.yml`, que `implantar.sh` só inclui
(via `COMPOSE_FILE`) quando `SMTP_HOST` está preenchido no `.env`. Sem isso, a
API continua **sem rota de saída nenhuma**, como antes do acesso por e-mail, e
o deploy mede exatamente isso. As seis variáveis ficam no compose base com
padrão vazio (`SMTP_PORTA` com 465); sem `SMTP_HOST`, a criação de pessoa cai
na senha provisória e as rotas que dependem de envio respondem 503.

**A ordem é: regra de egress → variáveis → deploy.** Ao contrário dela, o
deploy recusa (7.6b): com o override incluído e a regra ausente, a API
alcançaria a internet inteira.

### Antes de qualquer coisa: LGPD L10

**O envio só liga com os itens da seção 7 da spec feitos** — conta Resend no
nome da Firmare, SPF e DKIM em `firmaregestao.com.br`, DPA do Resend aceito,
garantia de transferência internacional registrada, Resend listado como
suboperador, retenção mínima no provedor e **rastreamento de clique e de
abertura desligados no painel do Resend** (o de clique reescreveria o link e
passaria a ver o token). O acompanhamento mora em
`docs/o-que-depende-de-voce.md`. Preencher `SMTP_HOST` antes disso é mandar
e-mail da equipe das clínicas a um suboperador sem contrato.

### 1 · a regra de egress da `saida-email`

**Primeiro**, antes de tocar no `.env`. Docker sozinho não filtra destino: sem
a regra, a `saida-email` é uma bridge comum e a API alcança a internet
inteira. Aplicar a regra antes de a rede existir é inofensivo — ela casa uma
sub-rede vazia até o deploy criar a rede. A regra deixa sair da sub-rede só
DNS e TCP 465 (SMTPS, TLS implícito). **Por porta, não por endereço**:
`smtp.resend.com` é um balanceador da AWS (ELB, us-east-1) cujos IPs mudam sem
aviso, e uma regra por IP derrubaria o envio no dia da troca.

O Resend aceita 25, 587 e 2587 (STARTTLS) e 465 e 2465 (TLS implícito) —
conferido em <https://resend.com/docs/send-with-smtp> em 2026-11-17. Ficamos
com **465 e só ela**: TLS desde o primeiro byte, e uma porta só na regra.

```bash
# DOCKER-USER é a cadeia que o Docker reserva para o operador e não reescreve.
# -I insere no TOPO: a ordem abaixo deixa o DROP por último na cadeia.
SUB=172.31.247.0/24
iptables -I DOCKER-USER -s $SUB -j DROP
iptables -I DOCKER-USER -s $SUB -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -I DOCKER-USER -s $SUB -p udp --dport 53 -j ACCEPT
iptables -I DOCKER-USER -s $SUB -p tcp --dport 53 -j ACCEPT
iptables -I DOCKER-USER -s $SUB -p tcp --dport 465 -j ACCEPT
```

As regras só tocam a sub-rede `172.31.247.0/24`, que é só da `api` do FIR:
nenhum container de outro negócio passa por elas. Mesmo assim, é mudança no
firewall de uma máquina compartilhada — **aplicar é decisão do dono**. Elas
já estão em `egress/regras-de-egress.sh`, persistidas pela unidade systemd
(ver "Regras de egress"): instalar a unidade é aplicar esta regra. Mesmo
assim, o deploy mede (abaixo) — é o que pega a regra perdida.

Se o `docker compose up` recusar a rede com `Pool overlaps with other one on
this address space`, outra rede da VPS já usa a faixa: escolha outra `/24`
livre (`docker network inspect $(docker network ls -q) -f '{{.Name}}
{{range .IPAM.Config}}{{.Subnet}}{{end}}'`) e troque em
`docker-compose.email.yml` **e** na regra.

### 2 · as variáveis no `.env`

**Só depois da regra.** Editadas à mão no `.env` da VPS (modo 600), **nunca**
no repositório nem em conversa. `SMTP_SENHA` é a chave de API do Resend: crie uma chave só de envio
(`sending access`), restrita ao domínio, e guarde-a com as outras senhas.

```
SMTP_HOST=smtp.resend.com
SMTP_PORTA=465
SMTP_USUARIO=resend
SMTP_SENHA=<chave de API do Resend, só envio>
URL_PUBLICA=https://<o mesmo DOMINIO do .env>
```

`EMAIL_REMETENTE` é opcional: sem ela vale `FIR Clinic
<nao-responda@firmaregestao.com.br>`. Se for definir, **entre aspas**
(`EMAIL_REMETENTE="Nome <endereco@dominio>"`): `implantar.sh` lê o `.env`
como shell, e sem aspas o espaço quebra a linha e o `<` vira redirecionamento.

`URL_PUBLICA` precisa ser `https://` — com `http://` a API **não sobe** em
produção (o link levaria o token em claro). Sem ela, o envio conta como
desligado.

**Comandos do Compose à mão.** `implantar.sh` decide o `COMPOSE_FILE` sozinho,
mas um `docker compose up -d api` digitado no terminal lê só o
`docker-compose.yml` — e recriaria a `api` **fora** da `saida-email`, com o
envio falhando em silêncio. Com o envio ligado, acrescente também esta linha ao
`.env` (o Compose a lê de lá), e retire-a ao desligar:

```
COMPOSE_FILE=docker-compose.yml:docker-compose.email.yml
```

### 3 · subir e conferir

```bash
cd /opt/fir/repo/infra/producao && bash implantar.sh
```

O deploy imprime `envio de e-mail LIGADO` no passo 1.5 e mede:

- **7.6b** (erro): as redes da `api` são exatamente `dados` e `saida-email`, e
  a API **não** alcança `github.com:443` — se alcança, a regra não está
  aplicada (ou se perdeu num reboot) e o deploy é recusado. Com o envio
  desligado, a 7.6b exige só `dados` e recusa se a API resolver um nome
  externo, como antes.
- **7.6** (erro): o Postgres continua sem rota de saída.
- **7.6f** (aviso): com o envio ligado, a API abre TCP com
  `SMTP_HOST:SMTP_PORTA`. Uma falha aqui é o único lugar em que o problema
  aparece: a rota de "esqueci a senha" responde igual com ou sem envio, de
  propósito.

Por fim, à mão: "Esqueci minha senha" para um endereço seu, confirmado, numa
clínica de teste. Tem de chegar **na caixa de entrada, não no spam**, com o
link sem reescrita do provedor (passe o mouse: o domínio é o do FIR, não um
`click.resend…`). No log da API, `docker compose logs api | grep correio`
mostra só a finalidade, o resultado e o endereço mascarado.

### Desligar

Esvazie `SMTP_HOST` (e retire a linha `COMPOSE_FILE`) no `.env` e rode
`implantar.sh`. Sem o override, a `api` é recriada só na `dados`; a rede
`fir_saida-email` fica órfã e vazia (`docker network rm fir_saida-email`, se
quiser). A regra de egress pode ficar: ela casa uma sub-rede sem ninguém.

## Variáveis do `.env`

| Chave | Quem define | Para quê |
|---|---|---|
| `DOMINIO` | você | o `Host(...)` dos três roteadores |
| `IPS_DO_PAINEL` | você | **a allowlist do painel**, em CIDR separado por vírgula |
| `SENHA_POSTGRES` | você | o superusuário do container |
| `SENHA_MIGRATE`, `SENHA_APP` | você | os dois papéis do `10-papeis.sh` |
| `SENHA_REDIS` | você | o Redis não fica sem senha |
| `SENHA_PAINEL` | `provisionar-painel.sh` | o papel `fir_painel` |
| `DATABASE_URL_PAINEL` | `provisionar-painel.sh` | a segunda conexão da API |
| `VERSAO` | o deploy | a tag das imagens |
| `GOOGLE_SA_JSON` | você (opcional) | a chave JSON da conta de serviço do Google, numa linha, entre aspas simples — só o `worker-planilhas` a recebe |
| `GOOGLE_SA_EMAIL` | você (opcional) | o `client_email` dessa conta, para a tela dizer com quem compartilhar a planilha |
| `SMTP_HOST`, `SMTP_PORTA`, `SMTP_USUARIO`, `SMTP_SENHA`, `EMAIL_REMETENTE`, `URL_PUBLICA` | você (opcional) | o envio de e-mail da API. Vazias = envio desligado e API sem rota de saída. `SMTP_HOST` preenchido inclui `docker-compose.email.yml`. **Só com a LGPD L10 feita e a regra de egress aplicada** — ver "Ligar o envio de e-mail" |
| `COMPOSE_FILE` | você (só com envio ligado) | `docker-compose.yml:docker-compose.email.yml`, para comandos do Compose à mão concordarem com o deploy |
| `FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA` | `implantar.sh` | cifra o segredo TOTP de cada Usuário de Gestão e é o pepper dos códigos de recuperação. **Nunca troque**: trocar exige resetar o segundo fator de todos |

`.env` **não é versionado** — está no `.gitignore`, e
`teste/allowlist-do-painel.test.ts` cobra isso.

## A allowlist, em uma frase e três armadilhas

O painel fica atrás de `ipallowlist.sourcerange`, e **só**. As três armadilhas
estão comentadas no `docker-compose.yml`, linha a linha; o resumo:

1. **Os dois roteadores são disjuntos.** O do produto NEGA o mesmo caminho que
   o do painel casa. Sem a negação, um CIDR com erro de digitação faz o
   Traefik descartar o roteador do painel — e o do produto passa a servir
   `/superadmin` **sem allowlist nenhuma**. O controle não falharia fechado:
   ele sumiria em silêncio.
2. **A regra casa um SEGMENTO (`superadmin`), nunca um prefixo.** `PathPrefix`
   é contornável por caixa (`/API/v1/superadmin`) e por barra dupla
   (`/api//v1/superadmin`) — as duas foram medidas contra a produção do Mavia.
3. **`sourcerange` e nada mais.** Qualquer `ipstrategy` faria o middleware ler
   o `X-Forwarded-For`, que na entrada HTTPS deste Traefik vem do CLIENTE. Uma
   allowlist que lê o que o atacante escreve atravessa-se com uma linha de
   `curl`.

> ⚠️ **Invariante do primeiro salto.** Tudo isso vale enquanto o Traefik for o
> primeiro salto TCP. Um CDN à frente faz o `RemoteAddr` virar o do CDN e a
> allowlist **falha aberta, sem mudar de cor**. Item obrigatório de
> conferência no dia em que o domínio próprio entrar (pendência P-8).

## Relatórios fora do log (T8 — appsec C15, LGPD L-IN-16)

`/api/v1/relatorios*` devolve **lista de pacientes** (nome, telefone opt-in,
procedimento, dose por paciente no relatório 11). Nada disso pode cair em log:

- **A API não tem log de requisição.** O `FastifyAdapter` de `main.ts` sobe sem
  `logger`, e o teste `log-sem-conteudo-relatorios` reprova quem ligar um. O
  filtro de erro dos relatórios grava só `relatorio falhou (codigo <pg>)`.
- **Os filtros vão no CORPO de um `POST`**, nunca na URL: o access log do
  Traefik (que é do EasyPanel e grava método, caminho e status) vê
  `/api/v1/relatorios/<chave>/execucoes` e mais nada. O corpo e a resposta
  nunca entram no access log do Traefik.
- **O que NÃO se faz aqui:** ligar `accesslog.fields.headers` em modo `keep`,
  ligar captura de corpo num middleware, ou pôr um `?filtro=` numa rota de
  relatório. Se algum dia o access log passar a guardar query string com
  conteúdo, `/api/v1/relatorios` entra numa regra de `accesslog.filters` que o
  descarta — e isso é item de conferência do próximo deploy que mexer no
  Traefik.

## Esqueci a senha — a cadeia inteira (D-10)

| Quem esquece | Quem resolve |
|---|---|
| Pessoa da clínica | o **admin da clínica** redefine, pela tela |
| Admin da clínica | o **superadmin** redefine, pelo painel |
| Superadmin | **`./redefinir-superadmin.sh`**, aqui, por quem tem SSH |

O que torna o último uma saída e não um atalho: SSH é uma credencial
**diferente**, guardada num lugar **diferente**. Ele não é alcançável pela
mesma coisa que se perdeu.

E ele **grava** — `auditoria_do_painel`, `ator_tipo = 'vps'`. Um break-glass
que não deixa rastro é uma porta dos fundos com outro nome.

## Perdi o celular — o segundo fator da carteira (G8 0.6, ADR 0022)

Todo `Usuário de Gestão` entra com senha **e** código do app autenticador. Quem
perdeu o celular entra com um dos dez **códigos de recuperação** (cada um vale
uma vez) e gera códigos novos em "Verificação em duas etapas". Quem perdeu o
celular **e** os códigos precisa do **reset pelo superadmin**:
`POST /v1/superadmin/usuarios-gestao/:id/segundo-fator/resetar`, com motivo.

O reset é o ponto fraco do segundo fator — **reset por pedido de WhatsApp é o
ataque**. Antes de resetar, o superadmin:

1. **Não age pelo canal em que o pedido chegou.** Liga de volta para o número
   que já estava no cadastro da pessoa (nunca para o número que mandou a
   mensagem), ou confirma por videochamada vendo o rosto.
2. **Confirma com uma segunda pessoa da Firmare** que conhece quem pediu.
3. **Escreve no motivo como a identidade foi confirmada** ("ligação de volta
   para o número do cadastro + confirmação da Ana"). O motivo vai para
   `auditoria_do_painel` com o nome do superadmin.
4. Depois do reset, a pessoa entra com a senha e é obrigada a cadastrar o app
   de novo. O superadmin nunca vê nem define o segredo.

Assimetria assumida (D3a): o painel do superadmin **não tem segundo fator**. A
força do 2FA da carteira fica limitada à conta de quem pode resetá-lo.

## Dois operadores, não um

`redefinir-superadmin.sh` **avisa** quando o sistema fica com menos de dois
operadores ativos. Ele não força, porque quem é o segundo é decisão do dono do
produto — mas um superadmin só é um ponto único de falha com nome bonito: se
aquela conta se perder, o painel fica fechado até alguém com SSH agir, e não
há segundo par de olhos para nada.

## O que NÃO tem aqui, e está assumido

- **MFA no painel.** A allowlist de rede é a contrapartida, e é a mesma troca
  já aceita no Mavia (C-6a). Com duas pessoas e um painel que cria credencial,
  é o item que mais rápido fica caro. Está em `docs/dividas.md`.
- **Concessão com motivo, prazo e revogação pela clínica** (D-5, restrições 2
  e 4). Este painel implementa **acesso total com registro obrigatório**, que
  é o que a D-10 pede. Enquanto ele só tratar identidade, é defensável; deixa
  de ser no dia em que ele ler ficha de paciente. É a pendência **P-10**.
