# Revisão AppSec do código — Acesso por e-mail (commit c96006b)

**Revisor:** especialista-seguranca-appsec · **Data:** 2026-11-17 · **Base:** gate `acesso-por-email-gate-appsec.md` (1–20), revisão `acesso-por-email-revisao.md`.
**Executado:** `vitest run src/acesso/acesso-por-email.e2e.test.ts src/autenticacao/oraculo-de-tempo.e2e.test.ts`: 60 de 60 passam, contra Postgres real. As provas de conceito abaixo rodaram num e2e temporário (cópia do setup do e2e de acesso), que foi apagado depois.

## Veredito: **REPROVADO**. Há um bloqueador, que é tomada de conta com prova de ponta a ponta.

### B1. A correção P1 se contorna com o UUID em MAIÚSCULAS, e o resultado é a tomada de conta da administradora

`apps/api/src/pessoas/acesso.service.ts:159` compara as strings: `pessoaId === quemAssina(ctx.ator)`. O `ParseUUIDPipe` de `pessoas.controller.ts:133` aceita hexadecimal maiúsculo. O ator vem em minúsculas da sessão. O Postgres compara `uuid` sem distinguir maiúsculas de minúsculas. A guarda falha e todo o resto do `editar` funciona normalmente.

**Exploração medida:** quem encontra aberta a sessão de `helena` (admin) segue estes passos.
1. `PATCH /v1/pessoas/<ID-DELA-EM-MAIÚSCULAS> { email: 'atacante@mal.example' }` responde **200**. A confirmação vai para o atacante e `email_pendente` passa a ser `atacante@mal.example`.
2. `usar(token)` responde **204** e o e-mail confirmado de Helena vira `atacante@mal.example`.
3. `esqueci-senha` faz o link de redefinição chegar ao atacante. `usar(token, senha)` responde **204**.
4. `entrar` com `atacante@mal.example` responde **200**: a conta é do atacante.

O mesmo contorno vale para o operador de suporte com `comoPessoa` pela rota HTTP. O teste atual de `:840` chama o serviço com o id em minúsculas e por isso não pega o caso.

**Correção:** comparar UUIDs na forma canônica, com `.toLowerCase()` nos dois lados ou, melhor, normalizando o `:id` uma vez na borda com um pipe que devolve minúsculas. A condição "é a própria pessoa" deve ser decidida dentro da transação, sobre `alvo.id` lido do banco (`umaPessoa`): `alvo.id === pessoaDoAtor(ator)`. Isso elimina a classe inteira do problema.
**Teste:** repetir os e2e de `:818` e `:840` pela rota HTTP com `ids['helena'].toUpperCase()`. Resultado esperado: 403, nenhum link e nenhuma mensagem.

## Corrigir agora (não bloqueia, mas entra antes de ligar o SMTP)

**C1. O endereço aceito não é o endereço entregue.** `REGEX_EMAIL` (`packages/domain/src/acesso-por-email.ts:20`) e o CHECK da `0097:23-28` aceitam `<`, `>`, `(`, `)`, `"`, `,`, `;` e `:`. Depois `CorreioSmtp` (`apps/api/src/acesso/correio.ts:72`) passa `to: m.para` como string ao nodemailer, que a interpreta como lista de endereços. Medido com `addressparser`:
- `juliana.sol.com<x@mal.example>` é entregue a `x@mal.example`;
- `a"b@evil.com` é entregue a `b@evil.com`;
- `joana.silva(attacker@evil.com)@clinica.com.br` vira nome de exibição.

O `POST /v1/eu/email` com `juliana.sol.com<x@mal.example>` respondeu 202. A tela mascarada mostrou `j***@m***.example>`.

Isso quebra a premissa da condição 3: o HMAC prende o link a uma string que não é o destino. A pessoa com `config` consegue redirecionar o canal de recuperação de uma colega com um endereço que, na ficha, parece o dela.

*Correção:* restringir o local e o domínio a `[A-Za-z0-9.!#$%&'*+/=?^_\`{|}~-]` e `[A-Za-z0-9.-]`, no domínio e no CHECK, e enviar `to: { name: '', address: m.para }`.

**C2. `URL_PUBLICA` aceita `http:`** (`correio.ts:110`). Em produção isso põe o link com token em texto claro. *Correção:* exigir `https:` quando `NODE_ENV=production`.

## Residual aceito

- **Sinal lateral do orçamento único (condição 9).** Cinco falhas pelo usuário `maria`, seguidas de uma tentativa pelo e-mail X, dão 429 se e somente se X for o e-mail confirmado de Maria. O ataque custa bloquear a vítima e exige adivinhar o usuário. É o preço da condição 9 e fica aceito.
- **Quem tem `config` muda o e-mail de uma colega** que não é admin e, por ele, redefine a senha dela. Esse poder é o mesmo que ela já tem com a senha provisória. A colega é avisada pelo `email_trocado` no endereço antigo. A recomendação do gate continua: mostrar na lista um aviso de "e-mail trocado recentemente".

## Conferido na fonte, sem achado

- **Uso único:** é atômico e acontece na mesma transação da senha, das sessões, dos outros links e do evento (service `:356-431`).
- **Corrida entre emitir e usar:** é serializada por `FOR UPDATE`, e a nova avaliação acontece depois do lock. Duas abas resultam em 204 e 410. Dez emissões concorrentes deixam um link só.
- **Sem cookie:** o uso do link não devolve `Set-Cookie` e revoga as sessões.
- **Isolamento entre clínicas:** `resolver_link_de_acesso` segue o molde da 0022, com JOIN na clínica ativa. A escrita depois disso acontece sob RLS na clínica do próprio link.
- **Índice único e grants:** o índice único vale por clínica. Os grants são por coluna, com o `REVOKE` prévio.
- **Limites:** o piso fica em `finally` e o envio sai depois da resposta. As medianas diferem menos de 10%. O 429 por origem e o teto por pessoa existem.
- **Link e token:** o link é montado só com `URL_PUBLICA`. O token fica no fragmento, `replaceState` o remove da barra e as páginas mandam `no-referrer`. Nada é feito com `<Link>` nem prefetch, e a confirmação de e-mail exige um clique.
- **Cabeçalhos e log:** os assuntos são constantes e os nomes são escapados. O log é mascarado e não guarda o erro cru do SMTP.
- **`/eu/email`:** exige a senha atual, com limite de 5 por hora, e nunca devolve 409.
- **Convidada:** não entra por senha. Pessoa excluída, desativada ou de clínica inativa não usa link.
- **Atividades:** a consulta é parametrizada e exige `config`.
