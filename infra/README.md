# Ambiente local

Postgres, Redis e Mailpit via Docker Compose, orquestrados pelo `fir.bat` na
raiz do repositório.

## Portas

| Serviço          | Porta local    | Porta no container | Por quê                                  |
| ---------------- | --------------- | ------------------- | ----------------------------------------- |
| Postgres         | `127.0.0.1:4832` | 5432                 | bloco 48xx                                |
| Redis            | `127.0.0.1:4879` | 6379                 | bloco 48xx                                |
| API              | `127.0.0.1:4811` | —                    | bloco 48xx (fora do Docker, Task 9)       |
| Web              | `127.0.0.1:4810` | —                    | bloco 48xx (fora do Docker, Task 9)       |
| Mailpit (tela)   | `127.0.0.1:4825` | 8025                 | bloco 48xx                                |
| Mailpit (SMTP)   | `127.0.0.1:4826` | 1025                 | bloco 48xx                                |

Por que o bloco 48xx, e não as portas padrão:

- **80 e 8080** ficam de fora por decisão do dono do projeto.
- **5432** (Postgres) e **6379** (Redis) ficam de fora para não colidir com
  uma instalação já existente dessas mesmas portas nesta máquina.
- **47xx** já pertence a outro produto (Mavia) que roda na mesma máquina.
- Sobrou o 48xx, livre e reservado só para o Firmare.

## Por que `127.0.0.1:` em cada porta publicada

O compose publica cada porta como `127.0.0.1:PORTA_LOCAL:PORTA_CONTAINER`, e
não apenas `PORTA_LOCAL:PORTA_CONTAINER`. Sem o prefixo, o Docker publica em
`0.0.0.0` por padrão — ou seja, o banco e o Redis ficariam acessíveis a
qualquer máquina na mesma rede local, não só a esta máquina. O prefixo
restringe a publicação à interface loopback.

## Por que UTC

Os containers (Postgres incluído, via `TZ` e `PGTZ`) rodam sempre em UTC. A
conversão para o fuso horário de cada clínica é responsabilidade do domínio
da aplicação, não do banco de dados. Guardar tudo em UTC evita ambiguidade
quando uma clínica muda de fuso ou quando o mesmo dado é lido por usuários em
fusos diferentes.

## Comandos do `fir`

Executar da raiz do repositório (`fir.bat` lida com o restante):

| Comando       | O que faz                                                        |
| ------------- | ------------------------------------------------------------------ |
| `fir`         | sobe os containers, aplica migrations, semeia a clínica de demonstração e inicia API + web com logs à vista |
| `fir infra`   | sobe só os containers (banco, Redis, Mailpit) — usado pelos testes, não toca em migrations |
| `fir down`    | derruba os containers, preservando os dados                        |
| `fir reset`   | derruba os containers e apaga os volumes — banco volta zerado      |
| `fir status`  | mostra o estado dos serviços (`docker compose ps`)                 |
| `fir logs`    | acompanha os logs dos containers                                   |
| `fir psql`    | abre um shell `psql` dentro do container do Postgres               |

`fir infra` é o comando relevante enquanto o pacote `@fir/api` ainda não
existe (ele nasce na Task 9): `fir` sozinho tentaria rodar `pnpm db:migrate`
contra um pacote inexistente e falharia de propósito.

## Papéis do banco

O `bootstrap-papeis.sql` roda uma única vez, na criação do volume do
Postgres, e cria dois papéis:

- `fir_migrate`: dono do esquema, com `BYPASSRLS`. É quem roda as migrations.
- `fir_app`: é quem a aplicação usa em tempo de execução, e está sujeito à
  Row-Level Security. Rodar a aplicação com um papel que atravessa a RLS faz
  todo teste de isolamento entre clínicas passar sem provar nada.

Se o SQL de bootstrap for alterado depois que o volume já existe, ele não é
reaplicado automaticamente. Use `fir reset` (ou
`docker compose -f infra/docker-compose.yml down -v`) para apagar o volume e
subir limpo.

## Sobre a senha no docker-compose.yml

A senha `fir_local_dev`, usada pelo usuário do Postgres e pelos papéis
`fir_migrate`/`fir_app`, está em claro no `docker-compose.yml` e no
`bootstrap-papeis.sql`, e isso é proposital: o container só escuta em
`127.0.0.1`, os dados são descartáveis, e `fir reset` apaga tudo com um
comando. Não há nada ali que precise de sigilo.

Isso não abre exceção nenhuma para credencial de verdade. Segredo de
produção não entra neste repositório, nem em claro, nem em `.env`
versionado, nem embutido em imagem. A diferença não é de forma — é de
conteúdo: a senha deste arquivo protege um banco vazio que qualquer pessoa
pode recriar do zero; uma credencial de produção protege dado de clínica e
paciente. Tratar as duas como equivalentes é como se confunde ambiente de
desenvolvimento com produção.

Nunca reutilize esta senha fora daqui.

## `fir reset` é obrigatório depois de mexer em `bootstrap-papeis.sql`

O bootstrap roda **uma vez**, na criação do volume, pelo
`docker-entrypoint-initdb.d` do Postgres. Editá-lo não muda nada num volume
que já existe.

Isso importa de verdade desde a migration `0013`: ela exige o papel
`fir_painel`, que nasce no bootstrap. Sem `fir reset`, `pnpm db:migrate` falha
com

```
ERRO em 0013_painel.sql: o papel fir_painel não existe
HINT: Local: rode `fir reset` depois de atualizar infra/bootstrap-papeis.sql.
```

e o sintoma — "a migration não aplica" — não aponta sozinho para a causa.

```bat
fir reset   :: derruba e APAGA os volumes (digite ZERAR para confirmar)
fir         :: sobe de novo, migra e semeia
```

**`fir reset` apaga o banco local inteiro.** Quem tiver dado próprio numa
clínica de desenvolvimento perde — e precisa semear de novo. É o preço de o
bootstrap ser idempotente por construção em vez de por script.

## O terceiro papel: `fir_painel`

| Papel | Login | BYPASSRLS | Quem usa |
|---|---|---|---|
| `fir_migrate` | sim | **sim** | só as migrations |
| `fir_app` | sim | não | a API do produto |
| `fir_painel` | sim | **não** | o painel do superadmin |

`fir_painel` **não tem** `BYPASSRLS`, e isso é a decisão: o superadmin fixa
`app.clinica_id` da clínica em que opera, como qualquer um (D-10). A `0013`
**recusa migrar** se alguém lhe der o privilégio.

São duas conexões separadas **por autenticação**, nunca por `SET ROLE` — D-5,
restrição 5: `RESET ROLE` desfaz na mesma transação, e aí o privilégio de
criar clínica passa a existir na conexão que serve o balcão.

Em produção o papel não nasce no bootstrap: ele nasce em
`infra/producao/provisionar-painel.sh`, com a senha vinda do `.env`. Ver
`infra/producao/README.md`.
