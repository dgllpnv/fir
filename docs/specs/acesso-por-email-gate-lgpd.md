# Gate LGPD — Acesso por e-mail (spec `acesso-por-email.md`, migration 0097)

**Revisor:** `especialista-lgpd-saude` · **Data:** 2026-11-16 · **Fase:** spec, antes do código.

## Veredito: APROVADO COM CONDIÇÕES (L1 a L11)

Nenhuma condição muda o produto que a PO pediu. Elas cortam dado que o spec guarda sem precisar, dão prazo ao que ainda não tinha e fecham o contrato com o provedor antes de ligar o envio.

## 1. Enquadramento

- **Titular:** a funcionária da clínica. Na tentativa de esqueci-senha, também **qualquer pessoa cujo e-mail alguém digitar**, que é terceira.
- **Não é dado sensível.** Nenhum campo novo é de saúde. O e-mail, o link e o evento são dado pessoal comum (art. 5º, I).
- **Base legal:** art. 7º, V para autenticar e recuperar o acesso (o contrato de trabalho/serviço com a clínica e o nosso contrato com ela). Art. 7º, IX para os eventos e os limites (segurança da conta), como `tentativas_login`.
- **Controladora:** a clínica. **Operadora:** a Firmare. **Suboperador novo:** o provedor de e-mail.
- **Reverte um ganho registrado.** A D-10 tinha tirado uma classe inteira de dado da equipe (`retencao.md`, "O ganho de minimização da D-10"). A reversão é legítima, porque a finalidade (redefinir a senha sem a administradora) é real e declarada. Mas ela precisa constar na avaliação de impacto, e o e-mail volta a ser um identificador que se correlaciona fora do produto.

## 2. Condições (cada uma com a prova)

**L1. O corpo do e-mail é mínimo.** Leva só o nome da clínica, o primeiro nome da pessoa, a finalidade, o link e o prazo. Nunca leva o `usuario`, o sobrenome, o perfil, o nome de quem enviou, uma senha nem qualquer dado de paciente. O `usuario` aparece só em `/criar-senha`, depois de `consultar`.
*Prova:* um teste captura as três finalidades no correio de teste e confere que o `usuario` e o sobrenome estão ausentes.

**L2. Sem rastreamento.** Rastreio de clique e de abertura desligados no provedor, e nenhum pixel. Com o rastreio de clique, o provedor reescreve o `href` e registra a URL inteira, **com o token no fragmento**. Isso anula a regra 2 do spec.
*Prova:* um teste confere que todo `href` começa com `URL_PUBLICA` e que o corpo não tem `<img>` remota. A configuração do provedor entra no checklist da L10.

**L3. Log sem destinatário, nem pelo erro.** Além da regra 12, a mensagem de erro do SMTP ou do provedor nunca vai crua para o log, porque o 550 ecoa o endereço. O log guarda só a finalidade, o resultado e o código. Também não guarda a URL do link.
*Prova:* força-se uma falha de SMTP com destinatário conhecido e confere-se que o log não contém a parte local do e-mail, nem `#t=`.

**L4. `links_de_acesso` não guarda o e-mail em claro.** Opção preferida: tirar a coluna. `consultar` lê `pessoas.email`, e trocar ou remover o e-mail invalida os links pendentes. Se a coluna ficar, ela guarda só o HMAC. Nos dois casos, `email` e `token_hash` entram na denylist de `auditoria_sem_segredos`.
*Prova:* depois de emitir um link, a linha em `auditoria` não contém o e-mail nem o hash. Trocar o e-mail faz o link anterior responder 410.

**L5. O link tem prazo de guarda.** O job privilegiado apaga a linha **30 dias** depois do último entre `expira_em`, `usado_em` e `invalidado_em`. A prova do que aconteceu é o evento (L6), não o link. Desativar, excluir ou trocar o e-mail invalida os links pendentes na mesma transação.
*Prova:* teste de integração para a invalidação. O job entra na dívida D9, com a linha em `retencao.md`.

**L6. `eventos_de_acesso` é mínimo e tem um prazo só.** Colunas apenas as do spec: sem e-mail, sem IP, sem user agent, sem token. O prazo é **1 ano**, igual a `tentativas_login`. Não há trigger que espelhe o evento na `auditoria`, senão ele herdaria os 5 anos da trilha de escrita e o prazo deixaria de ser um. A regra 11 do spec fica assim: o trigger de auditoria vale para `pessoas` e `links_de_acesso`, não para os eventos.
*Prova:* um teste de schema lista as colunas e confere que a tabela não tem trigger de auditoria.

**L7. O e-mail digitado vira hash antes de ser guardado.** O contador por e-mail do esqueci-senha e o `identificador` do entrar por e-mail guardam só o HMAC com pepper do e-mail canônico, o mesmo de `tentativas_login`. Isso vale inclusive para o e-mail sem conta, que é de terceiro.
*Prova:* depois de um pedido e de um entrar com um e-mail inexistente, uma busca textual em todas as tabelas novas e em `tentativas_login` não encontra o e-mail.

**L8. A titular corrige e retira o próprio e-mail** (art. 18, III e VI).
- `PATCH /v1/pessoas/:id` aceita `email: null`, invalida os links e deixa a pessoa no caminho do usuário com senha provisória.
- A pessoa com e-mail confirmado consegue trocá-lo por `/v1/eu/email`. O e-mail antigo continua valendo até o novo ser confirmado.
*Prova:* e2e. Depois do `PATCH null`, a pessoa entra pelo usuário e o link antigo responde 410. Na troca, ela entra pelo e-mail antigo até confirmar o novo.

**L9. A exclusão e a pseudonimização anulam o e-mail.** Excluir a pessoa (`excluida_em`) ou pseudonimizá-la zera `email` e `email_confirmado_em`. A pessoa desativada mantém os dois, para poder ser reativada.
*Prova:* teste de integração depois de excluir.

**L10. O envio só liga com o contrato.** Em produção, `SMTP_HOST` é preenchido só depois de quatro coisas:
- (a) o DPA do provedor aceito em nome da Firmare;
- (b) uma garantia de transferência internacional, porque o provedor guarda metadado e log nos EUA, que não têm adequação. Servem as cláusulas-padrão da Res. CD/ANPD 19/2024, ou uma garantia equivalente. Mesmo o Resend com região de envio em São Paulo guarda o metadado nos EUA;
- (c) o provedor listado como suboperador no DPA das clínicas (P-3), com a clínica informada;
- (d) a retenção de conteúdo do provedor no mínimo que ele permite, e o rastreio desligado (L2).

*Prova:* documental. O item entra em `docs/o-que-depende-de-voce.md`, ao lado da seção 7 do spec. O critério de aceite "chega na caixa de entrada" só é conferido depois disso.

**L11. O incidente fica detectável pela própria titular.**
- Criar ou redefinir a senha pelo link envia o aviso "sua senha foi alterada" ao e-mail confirmado, com o mesmo corpo mínimo da L1.
- Trocar um e-mail confirmado, pela pessoa ou pela administradora, avisa o endereço antigo.

Sem esses avisos, uma conta tomada pela recuperação de senha não deixa sinal para quem pode reconhecê-la.
*Prova:* e2e. O correio de teste captura os dois avisos.

## 3. O que entrou em `retencao.md`

As classes `pessoas.email` e `email_confirmado_em`, `links_de_acesso`, `eventos_de_acesso` e o contador por e-mail. Foram revistas a linha de `pessoas.usuario` e a seção da D-10.

## 4. Recomendações (não bloqueiam)

- **R1.** Com o envio desligado, deixar o e-mail **opcional**. O e-mail que a administradora digita sem confirmação não autentica nem recebe redefinição, então fica guardado sem uso até a pessoa cadastrá-lo de novo pelo fluxo 6. Se a decisão de produto mantiver a obrigatoriedade, ao ligar o envio a faixa do fluxo 6 já vem com esse e-mail preenchido, para confirmar.
- **R2.** Orientar, no Manual e na tela de criação, o uso do **e-mail de trabalho**, não o pessoal.
- **R3.** Para reduzir a transferência, avaliar o Amazon SES em `sa-east-1`. Ele não elimina a transferência, porque a VPS está nos EUA (D-11), mas não acrescenta um país novo de guarda.
- **R4.** Sinais de alerta para quando a observabilidade existir:
  - pico de 410 ou de 429 por origem;
  - mais de N links de redefinição enviados pela administradora numa hora;
  - troca de e-mail seguida de redefinição na mesma pessoa em menos de 24 horas.
- **R5.** Na exportação do titular, a pessoa leva os próprios eventos de acesso. Nunca leva os de outra pessoa nem o hash do token.
