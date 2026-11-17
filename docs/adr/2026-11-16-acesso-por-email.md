# ADR — Acesso por e-mail e redefinição de senha pela própria pessoa

- **Data:** 2026-11-16
- **Estado:** aceita
- **Origem:** backlog final da PO (2026-11-15), Entrega 3. O dono mandou finalizar o backlog inteiro (2026-11-16).
- **Substitui em parte:** ADR 0007 / D-10 (identidade sem e-mail)
- **Spec:** `docs/specs/acesso-por-email.md`

## Contexto

A ADR 0007 tirou o e-mail do produto porque ele puxava SMTP (P-9) e domínio (P-8) para o caminho crítico. Sem os dois, nenhuma clínica entrava. Isso já não vale: as clínicas entram por usuário e senha, criados pela administradora. O que a PO pede agora é que **cada pessoa redefina a própria senha** sem depender da administradora, e que a senha provisória deixe de ser ditada por WhatsApp.

## Decisão

1. **O e-mail volta, como segundo identificador, sem substituir o usuário.**
   - `pessoas.email` é opcional no banco, obrigatório na criação pela clínica, e único por clínica entre as não excluídas.
   - O login aceita usuário **ou** e-mail confirmado. O código da clínica continua vindo do link (ADR 0010).
2. **E-mail só autentica depois de confirmado.** No convite, a confirmação é o próprio uso do link. Quem já existe confirma pelo link de confirmação. Cadastrar o e-mail de outra pessoa não dá acesso a nada.
3. **Links de uso único, de 256 bits, guardados como hash.**
   - Prazos: convite 7 dias, redefinição 1 hora, confirmação 24 horas.
   - Emitir um link novo invalida os anteriores da mesma finalidade.
   - O token viaja no fragmento da URL.
4. **O envio é um seam (`Correio`)**, com dois adaptadores: SMTP (nodemailer, que aceita Resend, SendGrid ou SES) e, nos testes, um que captura as mensagens.
   - **Sem `SMTP_HOST` o envio está desligado.** Nesse caso a criação de pessoa cai na senha provisória de hoje e as rotas que dependem de envio respondem 503. **Nenhuma rota finge um envio.**
   - **O rastreamento de clique e de abertura do provedor fica DESLIGADO.** O de clique reescreve o `href` e passa a ver o token do link; o de abertura é um pixel (LGPD L2, appsec 15). É configuração do painel do provedor, não do código, e por isso é item do checklist de `docs/o-que-depende-de-voce.md` (item 2), junto do DPA, da garantia de transferência, do suboperador e da retenção mínima (L10). O envio não liga sem eles.
5. **Esqueci-senha não revela quem tem conta:** mesma frase, mesmo status, piso de tempo, e o envio sai depois da resposta.
6. **A senha provisória continua existindo**, como saída para quem não tem e-mail e para a instalação sem envio.

## O que continua valendo da ADR 0007

- Usuário canônico.
- Regra de senha: mínimo de 12. A PO pediu 8, e 12 atende.
- Argon2id.
- Limite por conta e por origem.
- A administradora nunca vê a senha.
- O superadmin cria a clínica e a primeira administradora.

## Alternativas recusadas

- **Login só por e-mail:** trancaria para fora quem não cadastrou e-mail, e as 4 clínicas migradas não têm.
- **Senha provisória enviada por e-mail:** a senha passaria a existir em texto numa caixa de entrada. O link de uso único vence sozinho.
- **Recusar criar pessoa sem SMTP:** trancaria as clínicas até a Firmare contratar o provedor.
- **Token na query string:** vaza para log de proxy e para o `Referer`.

## Consequências

- Os testes que proibiam o e-mail (`teste/identidade-sem-email.test.ts`, `conteudo.test.ts`, `autenticacao.test.ts`) passam a cobrar a forma nova: a coluna existe com CHECK canônico, o login aceita e-mail confirmado, e a ajuda pode falar de e-mail.
- **Depende do dono, para o envio real:** conta no provedor no nome da Firmare, e SPF e DKIM em `firmaregestao.com.br` (`docs/o-que-depende-de-voce.md`).

## Adendo 2026-11-17: o e-mail da administradora pela sessão de suporte e pelo painel (revisão appsec da 0111, M2)

São duas regras diferentes, e a diferença é de propósito:

- **Na sessão de suporte (`comoPessoa`)**, o operador age *em nome* da administradora, e a trilha fica no nome dela. Por isso ele não muda o e-mail dela (`pessoas/acesso.service.ts`, recusa 403): a escrita pareceria dela.
- **Pelo painel** (`PATCH /v1/superadmin/clinicas/:id/pessoas/:id`), o operador age *como operador*: a trilha registra `ator_tipo = 'operador'`. Ele pode cadastrar ou trocar o e-mail de qualquer pessoa, a administradora inclusive. O caso de uso é corrigir o erro de digitação da primeira administradora de uma clínica trancada. Há duas condições:
  1. O endereço novo fica **pendente** até alguém usar o link que chega na caixa nova. O operador não confirma por ninguém.
  2. O endereço confirmado atual recebe **no momento do pedido** o aviso `troca_de_email_pedida`, sem link, e depois da confirmação recebe `email_trocado`. O aviso no pedido vale para **todo** caminho que troca e-mail: o PATCH da clínica, o do painel e `/v1/eu/email`.
