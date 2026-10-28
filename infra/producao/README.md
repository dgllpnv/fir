# Produção — Firmare Rotinas de Gestão

Na mesma VPS do Mavia, **ao lado e nunca dentro** da orquestração do
EasyPanel: containers comuns, descobertos pelo Traefik por label, Postgres
próprio, rede de dados sem rota de saída, só o `web` encarando a internet.

## A ordem obrigatória, e o que acontece fora dela

```
1.  cp .env.exemplo .env   e preencha os segredos
2.  docker compose up -d postgres          # 10-papeis.sh roda AQUI, uma vez
3.  ./provisionar-painel.sh                # cria fir_painel, escreve DATABASE_URL_PAINEL
4.  pnpm --filter @fir/api db:migrate      # a 0013 CONFERE o papel
5.  docker compose up -d                   # api + web
6.  ./redefinir-superadmin.sh <usuario> "Nome"   # cria o PRIMEIRO operador
```

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
