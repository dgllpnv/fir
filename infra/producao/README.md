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
migration e não perde dado. Ele faz os passos 1 a 5 abaixo e termina com oito
asserções — **um deploy que não é verificado não é um deploy**.

O passo 6 fica fora dele de propósito: ele imprime uma senha na tela, e um
passo que imprime segredo não pertence a um script que alguém roda de novo por
reflexo.

## A ordem obrigatória, e o que acontece fora dela

```
1.  segredos no .env  (incluindo SENHA_PAINEL e DATABASE_URL_PAINEL)
2.  docker compose up -d postgres redis    # 10-papeis.sh roda AQUI, uma vez
3.  ./provisionar-painel.sh                # cria e credencia fir_painel
4.  migrar.js, como fir_migrate            # a 0013 CONFERE o papel
5.  docker compose up -d api web
6.  ./redefinir-superadmin.sh <usuario> "Nome"   # cria o PRIMEIRO operador
```

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
