# Spec — Acesso por e-mail e redefinição de senha (Entrega 3 do backlog final)

**Origem:** "FIR Clinic · Backlog final: indicadores, MedX e acesso por e-mail", da PO (Marília), 2026-11-15, Entrega 3 (3.1 a 3.3). O dono mandou finalizar o backlog inteiro (2026-11-16).
**Substitui em parte:** D-10 / ADR 0007 (identidade sem e-mail). Ver ADR `docs/adr/2026-11-16-acesso-por-email.md`.
**Estado:** spec para o gate de risco.

## 1. Problema

Hoje a pessoa entra com **clínica + usuário + senha**. Quando esquece a senha, só a administradora a redefine, e a senha provisória é ditada por WhatsApp ou telefone. A PO quer que **cada pessoa tenha e-mail** e **redefina a própria senha** por um link, sem depender da administradora.

## 2. O que muda (fluxos 3.1)

| # | Fluxo | Comportamento |
|---|---|---|
| 1 | **Cadastro** | Em Usuários e acessos, **e-mail obrigatório para pessoa nova**, único por clínica entre as pessoas não excluídas. Quem já existe continua sem e-mail até cadastrar o seu (fluxo 6). O **usuário continua existindo e funcionando**. |
| 2 | **Convite** | Ao criar a pessoa com o envio de e-mail ligado, ela recebe "Seu acesso à FIR Clinic", com o nome da clínica e o botão **Criar minha senha**. O link vale **7 dias** e serve uma vez. **Não há senha provisória nesse caminho.** |
| 3 | **Entrar** | O campo "Usuário" passa a se chamar **"Usuário ou e-mail"**. Com `@`, a busca é pelo e-mail **confirmado**; sem `@`, pelo usuário, como hoje. A clínica continua vindo do link (ADR 0010). |
| 4 | **Esqueci minha senha** | Há um link na tela de entrada que leva a `/esqueci-senha`. A pessoa informa o e-mail (a clínica vem do link ou é pedida). A resposta é **sempre a mesma**: "Se o e-mail estiver cadastrado, enviamos um link para criar uma senha nova." O link vale **1 hora** e serve **uma vez**. |
| 5 | **Trocar senha logada** | Não muda: `/trocar-senha` pede a senha atual (`POST /v1/eu/senha`). |
| 6 | **Quem já existe** | Pessoa sem e-mail confirmado vê, ao entrar, um aviso **"Cadastre seu e-mail"** com o campo e o botão **Enviar confirmação**. O link de confirmação vale **24 horas** e serve uma vez. **Até confirmar, nada muda**: ela entra pelo usuário, como sempre. O aviso pode ser adiado ("Agora não") e volta na próxima entrada. |
| 7 | **Admin** | Pode **reenviar o convite**, que invalida o anterior, e **enviar o link de redefinição** para a pessoa. **Nunca vê a senha.** A redefinição por senha provisória continua existindo, como saída para quem não tem e-mail. |

### 2.1 Envio de e-mail desligado

Até a Firmare contratar o serviço transacional (3.2, último item), **produção não tem SMTP**. Recusar a criação de pessoas nesse intervalo trancaria as clínicas, então:

- Sem `SMTP_HOST`, o envio é considerado **desligado**. A criação de pessoa **exige e-mail mesmo assim** (o campo fica guardado, sem confirmação) e cai no caminho de hoje, a **senha provisória**, com o aviso "O envio de e-mail ainda não está ligado nesta instalação; passe a senha provisória à pessoa."
- `esqueci-senha` responde a mesma frase de sempre e **não grava nada que finja um envio**. A tela de entrada esconde o link "Esqueci minha senha" quando `GET /v1/acesso/config` diz `{ envioDeEmail: false }`.
- Reenviar convite, enviar link e cadastrar o próprio e-mail respondem **503** "O envio de e-mail ainda não está ligado." **Não respondem 202 sem mandar.**

Localmente, o Mailpit (`127.0.0.1:4826`, tela em `4825`) faz o papel do provedor.

## 3. Regras de segurança (3.2)

1. **Token de 256 bits**, guardado só como SHA-256 (`token_hash`, mascarado pela `auditoria_sem_segredos`). O token cru só existe no e-mail.
2. **O token viaja no fragmento** (`/criar-senha#t=…`), nunca na query string: o fragmento não chega ao servidor web, não entra em log de proxy nem no `Referer`.
3. **Prazos:** convite 7 dias · redefinição 1 hora · confirmação de e-mail 24 horas. Só vale o link **mais recente** de cada finalidade para a pessoa: emitir um novo invalida os anteriores dela.
4. **Uso único:** usar um link marca `usado_em`. A marcação é atômica (`UPDATE … WHERE usado_em IS NULL AND expira_em > now() RETURNING`); duas abas não usam o mesmo link.
5. **Resposta idêntica** em `esqueci-senha` para e-mail existente, inexistente, clínica inexistente ou limite atingido: sempre **202** e a mesma frase. **O envio sai depois da resposta**, fora do caminho da requisição, e a rota tem **piso de tempo** (o mesmo `PISO_DE_RESPOSTA_MS` do entrar). Assim o relógio não diz quem tem conta.
6. **Limites:**
   - `esqueci-senha`: **5 pedidos por hora por e-mail** (clínica + e-mail canônico, contado **exista ou não** a conta) e **5 por hora por origem** (`req.ip`, como o entrar).
   - Por e-mail estourado: 202 com a mesma frase, **sem envio**.
   - Por origem estourada: **429**, igual para todo mundo, então não vira oráculo.
   - Consultar e usar um link: o limite por origem do entrar.
7. **Senha nova** passa por `avaliarSenha` do domínio, com o contexto (clínica, usuário, nome, e-mail). O mínimo é **12** (`SENHA_MIN`, ADR 0007). A PO pediu "no mínimo 8", e 12 atende. Não se afrouxa a regra que já vale.
8. **Redefinir ou criar senha por link encerra todas as sessões abertas da pessoa** (a pessoa não está logada nesse fluxo). Também tira a pessoa do estado provisório.
9. **Pessoa inativa ou excluída:** o link não serve. A resposta é "Este link não vale mais. Peça um novo." Esqueci-senha não envia nada para ela.
10. **Login por e-mail só com e-mail confirmado.** E-mail não confirmado não autentica. Isso impede que alguém cadastre o e-mail de outra pessoa e entre por ele.
11. **Atividades:** cada evento grava uma linha em `eventos_de_acesso`, com o ator certo (a pessoa quando provou quem é, o sistema quando não provou):
    - convite enviado, convite reenviado, link de redefinição enviado pela admin;
    - pedido de redefinição, inclusive para e-mail sem conta, gravado sem o e-mail;
    - senha criada pelo convite, senha redefinida pelo link;
    - e-mail cadastrado, e-mail confirmado;
    - link vencido ou já usado (falha).

    A trilha de auditoria pega a linha pelo trigger.
12. **Nunca em log:** token, senha, e-mail completo. O log do envio registra só a finalidade e o resultado; o e-mail sai mascarado (`j***@g***.com`).
13. **Remetente** configurável (`EMAIL_REMETENTE`), padrão `FIR Clinic <nao-responda@firmaregestao.com.br>`. SPF e DKIM são configuração do domínio, item do dono (seção 7).

## 4. Modelo de dados (migration 0097)

- **`pessoas`:**
  - `email text NULL`, com `CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')`.
  - `email_confirmado_em timestamptz NULL`.
  - `aguardando_primeira_senha boolean NOT NULL DEFAULT false`: a pessoa foi convidada e ainda não criou senha.
  - Índice único parcial `(clinica_id, email) WHERE email IS NOT NULL AND excluida_em IS NULL`.
- **`links_de_acesso`:**
  - Colunas: `id`, `clinica_id NOT NULL`, `pessoa_id NOT NULL`, `finalidade` (`convite` | `redefinicao` | `confirmacao_de_email`), `email`, `token_hash` único, `criado_em`, `expira_em`, `usado_em`, `invalidado_em`.
  - RLS por clínica e trigger de auditoria.
  - Append-only no sentido do produto: só `usado_em` e `invalidado_em` mudam.
- **`eventos_de_acesso`:** `id`, `clinica_id NOT NULL`, `pessoa_id NULL`, `evento` (CHECK sobre a lista da regra 11), `em`. RLS por clínica, só INSERT.
- **`resolver_link_de_acesso(p_token_hash text)`**, `SECURITY DEFINER`, no molde de `resolver_sessao`:
  - devolve `clinica_id`, `pessoa_id`, `finalidade`, `email`, `expira_em`, `usado_em`, `invalidado_em`;
  - exige os 256 bits, não enumera;
  - `EXECUTE` só para `fir_app`.
- **`clinica_por_codigo`:** o entrar já lê `clinicas` sem isolamento. O esqueci-senha reusa o mesmo caminho.

## 5. API

| Rota | Acesso | Corpo → resposta |
|---|---|---|
| `GET /v1/acesso/config` | público | → `{ envioDeEmail: boolean }` |
| `POST /v1/esqueci-senha` | público | `{ clinica, email }` → **202** `{ mensagem }`, sempre igual |
| `POST /v1/link-de-acesso/consultar` | público | `{ token }` → `{ finalidade, primeiroNome, clinicaNome, clinicaCodigo, usuario, email }` ou **410** "Este link não vale mais." |
| `POST /v1/link-de-acesso/usar` | público | `{ token, senha? }` → **204**. Convite e redefinição exigem `senha` (**422** com a mensagem do domínio). Confirmação de e-mail não aceita senha. Link inválido: **410** |
| `POST /v1/entrar` | público | `usuario` aceita e-mail (com `@` → `canonizarEmail`) |
| `GET /v1/eu` | sessão | ganha `usuario.email` e `usuario.emailConfirmado` |
| `POST /v1/eu/email` | sessão (liberada pelo guard da provisória? **não**) | `{ email }` → **202**. Grava o e-mail como não confirmado e envia a confirmação. **409** se outra pessoa da clínica já usa. **503** com o envio desligado |
| `POST /v1/pessoas` | `usuarios` | ganha `email` (obrigatório). Com envio ligado: cria sem provisória, com `aguardando_primeira_senha` e convite → `{ pessoa, convite: 'enviado' }`. Com envio desligado: como hoje (provisória) → `{ pessoa, senhaProvisoria }` |
| `PATCH /v1/pessoas/:id` | `usuarios` | ganha `email` opcional. **Trocar o e-mail zera a confirmação** |
| `POST /v1/pessoas/:id/convite` | `usuarios` | → **202**. Reenvia: invalida o convite anterior e cria outro. Só para quem está `aguardando_primeira_senha` |
| `POST /v1/pessoas/:id/redefinicao` | `usuarios` | → **202**. Envia o link de redefinição ao e-mail **confirmado** (**409** se não tem) |

O que continua valendo para as rotas da admin: `podeAgirSobre` (só admin age sobre admin) e as regras da ADR admin-da-clínica. `PessoaNaLista` ganha `email`, `emailConfirmado` e `situacaoDoAcesso` (`ativo` | `convite_pendente` | `convite_vencido`).

## 6. Telas

- **`/entrar`:** o rótulo vira "Usuário ou e-mail", com `autocomplete="username"`. Abaixo do botão, o link "Esqueci minha senha", que só aparece com o envio ligado.
- **`/esqueci-senha`:** pede o e-mail, e a clínica se não veio do link. O botão é "Enviar link". Depois do envio, mostra a frase única e o link "Voltar para a entrada".
- **`/criar-senha`:**
  - Lê `#t=`.
  - Em convite, o título é "Crie sua senha"; em redefinição, "Crie uma senha nova". Abaixo: "Clínica X · usuário y".
  - Campos Senha e Repetir a senha, com a mesma regra exibida pela troca de senha (mensagem do domínio).
  - Ao salvar: "Senha criada. Agora entre com seu e-mail ou usuário." e o botão **Entrar**, que leva a `/entrar?clinica=…`.
  - Link inválido: "Este link não vale mais. Peça um novo na tela de entrada ou à administradora."
- **`/confirmar-email`:** lê `#t=`, mostra o e-mail e o botão **Confirmar e-mail**. Depois: "E-mail confirmado. Daqui em diante você pode entrar por ele e redefinir a senha sozinha."
- **Aviso "Cadastre seu e-mail":** é uma faixa no topo do sistema logado, para pessoa sem e-mail confirmado e quando o envio está ligado.
  - Tem campo, o botão "Enviar confirmação" e o link "Agora não", que esconde o aviso até a próxima entrada (`sessionStorage`).
  - Com o e-mail pendente, a faixa diz "Enviamos o link para j***@… Confira sua caixa de entrada." e tem "Reenviar".
- **Usuários e acessos:**
  - A criação ganha o campo **E-mail**, obrigatório.
  - A lista mostra o e-mail e o selo "Convite pendente", "Convite vencido" ou "E-mail não confirmado".
  - O menu da pessoa ganha **Reenviar convite** e **Enviar link para redefinir senha**.
  - Com o envio ligado, a criação mostra "Convite enviado para …" em vez do modal da provisória.
- **Manual e Ajuda:** o capítulo de acesso é atualizado (entrar por e-mail, esqueci a senha, cadastrar o e-mail, convite), assim como a FAQ "Esqueci a senha".

## 7. O que depende do dono

1. **Conta Resend no nome da Firmare** (não no de uma pessoa). O plano gratuito cobre o volume (300 a 800 mensagens por mês com quatro clínicas), e o SMTP é o comum.
2. **SPF e DKIM** do domínio remetente (`firmaregestao.com.br`) apontando para o Resend. Sem os dois, o convite cai no spam.
3. **DPA com o Resend** assinado: ele passa a ser suboperador do e-mail da equipe de cada clínica.
4. **Garantia de transferência internacional** registrada (o Resend processa nos EUA), com a mesma base da VPS (item 3).
5. **O Resend listado como suboperador** no DPA com cada clínica (item 4) e na avaliação de impacto.
6. **Retenção mínima no provedor**: os logs de mensagens com o menor prazo que o plano permitir.
7. **Rastreamento de clique e de abertura DESLIGADOS** no painel do Resend. O rastreamento de clique reescreve o `href` e passaria a ver o token do link; o de abertura é um pixel. É o único controle que existe antes de alguém preencher `SMTP_HOST`.
8. As variáveis `SMTP_HOST`, `SMTP_PORTA`, `SMTP_USUARIO`, `SMTP_SENHA`, `EMAIL_REMETENTE` e `URL_PUBLICA` no `.env` da VPS. **O envio só liga com os sete itens acima feitos** (LGPD L10).

Sem isso, tudo funciona com o envio desligado (2.1), e o critério de aceite "chega na caixa de entrada, não no spam" fica para depois da configuração.

## 8. Critérios de aceite (3.3), e como cada um se prova

| Critério | Prova |
|---|---|
| Nova pessoa recebe o convite, cria a senha e entra pelo e-mail | e2e contra Postgres real com um correio de teste que captura a mensagem; Mailpit no local |
| "Esqueci minha senha" envia o link; o link funciona uma vez e expira em 1 hora | e2e: segundo uso → 410; relógio +61 min → 410 |
| E-mail não cadastrado recebe a mesma mensagem, sem envio | e2e: corpo e status idênticos, zero mensagens capturadas |
| Pessoa antiga cadastra o e-mail na primeira entrada e continua entrando | e2e: entra pelo usuário antes e depois; entra pelo e-mail só depois de confirmar |
| E-mails chegam na caixa de entrada | depende da seção 7; conferido à mão depois da configuração |

## 9. Fora do escopo

- O e-mail do **operador** (superadmin).
- Convite pelo painel do superadmin: a primeira administradora continua com a provisória. O campo e-mail aparece lá como **opcional**.
- Login sem o código da clínica.

## 10. Condições dos gates, incorporadas (2026-11-16)

Os gates `acesso-por-email-gate-appsec.md` (20 condições) e `acesso-por-email-gate-lgpd.md` (L1–L11) aprovaram com condições. Esta seção **prevalece** sobre o texto acima onde divergirem.

### Modelo de dados

- `pessoas.email` é **só o confirmado**: único, autentica e recebe a redefinição.
- `pessoas.email_pendente` guarda o digitado e ainda não provado (a admin no convite, a pessoa no cadastro). **Não é único.** Ao usar o link, o pendente vira o confirmado; se outra pessoa já confirmou o mesmo endereço, a resposta é 409. Até lá, o confirmado anterior continua valendo (appsec 2, LGPD L8).
- `links_de_acesso` guarda **`email_hmac`**, nunca o endereço (LGPD L4).
  - O link só vale se o HMAC do alvo atual for igual ao gravado. O alvo é o pendente no convite e na confirmação, e o confirmado na redefinição (appsec 3).
  - Índice único parcial: **um link vivo por pessoa e finalidade** (appsec 6).
- `eventos_de_acesso` **sem trigger de auditoria**, com retenção de 1 ano (LGPD L6). A regra 11 vale pelos triggers de `pessoas` e de `links_de_acesso`.
- O HMAC usa uma chave derivada por HKDF de `FIR_INTEGRACOES_PEPPER`, com rótulo próprio. Não há segredo novo para implantar.

### Fluxos

1. `POST /v1/eu/email` exige a **senha atual** (403 sem ela). A resposta é sempre 202, sem 409 (appsec 1).
2. Esqueci-senha e o envio de redefinição pela admin **só mandam para o e-mail confirmado** (appsec 4).
3. O uso do link é atômico (`WHERE usado_em IS NULL AND invalidado_em IS NULL AND expira_em > now()`). Roda na **mesma transação** que grava a senha, revoga as sessões, invalida os outros links da pessoa e grava o evento (appsec 5).
4. Os links pendentes morrem quando o e-mail muda, a pessoa é desativada ou excluída, a senha é trocada por `/eu/senha` ou a admin define uma provisória. Clínica inativa recusa o link (appsec 7).
5. Usar o link **não cria sessão** e não manda `Set-Cookie` (appsec 8).
6. O limite por conta é **um orçamento só**. Quando o e-mail resolve para uma pessoa, a tentativa conta no usuário dela. E-mail sem conta conta como `e:<hmac>`, e o e-mail nunca é gravado em claro em `tentativas_login` (appsec 9, LGPD L7).
7. No entrar, o ramo do `@` é decidido **antes** de `canonizarUsuario`. E-mail pendente, inativo ou inexistente passa pelo `HASH_FALSO` e pelo piso (appsec 10).
8. O esqueci-senha tem piso de tempo em `finally`, cobrindo todos os caminhos. O envio roda depois da resposta (`setImmediate`, em memória, **sem fila em Redis**: o token cru nunca sai do processo). Falha de SMTP não muda nada que o cliente veja (appsec 11, 13).
9. Limites, todos em memória do processo, com janela de 1 hora (appsec 12):
   - esqueci-senha: 5 por `clinica + hmac(e-mail)` e 5 por origem;
   - rotas da admin (reenviar, redefinir) e `/eu/email`: 5 por pessoa-alvo.
10. O link é montado **só com `URL_PUBLICA`**. Sem ela, o envio conta como desligado (appsec 14).
11. O front apaga o token da barra com `history.replaceState`, as páginas de link mandam `Referrer-Policy: no-referrer`, e a ADR e a seção 7 registram que o rastreamento de clique do provedor fica desligado (appsec 15, LGPD L2).
12. `consultar` não consome o link. Só `usar` consome (appsec 16).
13. Corpo do e-mail mínimo (LGPD L1): nome da clínica, primeiro nome, finalidade, link e prazo. Nunca o usuário, o sobrenome, o perfil ou dado de paciente. Texto escapado (appsec 19). Sem imagem remota (LGPD L2).
14. Log sem o erro cru do SMTP e sem a URL (LGPD L3). Só a finalidade, o resultado e o e-mail mascarado.
15. Aviso **"Sua senha foi alterada"** ao e-mail confirmado depois de usar o link de redefinição, e aviso ao endereço antigo quando um confirmado é trocado (LGPD L11).
16. Excluir a pessoa apaga `email`, `email_pendente` e `email_confirmado_em`. A desativada mantém os três (LGPD L9).
17. A pessoa pode retirar o próprio e-mail (LGPD L8). A admin pode corrigir ou retirar pelo `PATCH`, o que invalida os links.
18. As rotas da admin passam por `podeAgirSobre`, exigem `usuarios` e entram na matriz de acesso (appsec 20).

### Operação

**Ligar o envio em produção** (preencher `SMTP_HOST`) depende de quatro coisas (LGPD L10):
- DPA do provedor aceito;
- garantia para a transferência internacional;
- provedor listado como suboperador;
- retenção mínima no provedor.

Fica registrado em `docs/o-que-depende-de-voce.md`.
