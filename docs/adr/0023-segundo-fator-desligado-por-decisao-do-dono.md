# ADR 0023 — Segundo fator da carteira desligado por decisão do dono

**Status:** aceita · 2026-11-08
**Emenda:** a ADR 0022 (decisão 7, "obrigatório para todo Usuário de Gestão"; decisão 9, o reset pelo
Operador deixa de ser o caminho de quem perdeu o acesso). **Revoga:** a D-22 item 13, na parte da
exigência. **Origem:** D-23 item 3 (`docs/decisoes.md`). **Reabre:** a dívida D3b, agora D3c.
**Divergência do protótipo:** nenhuma nova. O protótipo Firmare Gestão não tem segundo fator; esta
decisão reaproxima o produto dele.

## Contexto

O dono testou o superadmin em produção e pediu "sem segundo fator por enquanto": a exigência de TOTP
fica desligada, com o código preservado, e some da tela o "Perdeu o celular?". No lugar dele, o
superadmin redefine a senha do Usuário de Gestão escolhendo uma provisória, no padrão que a clínica
já usa (D-18).

## Decisões

1. **Uma chave de configuração, `SEGUNDO_FATOR_CARTEIRA_LIGADO`, desligada por padrão.** Aceita
   `true`/`1` e `false`/`0`/vazio. Qualquer outro valor derruba a subida da API, porque um "ture"
   não pode desligar a proteção em silêncio. Em produção ela entra pelo compose com
   `${SEGUNDO_FATOR_CARTEIRA_LIGADO:-false}`. O servidor a lê a cada requisição; é assim que o e2e
   da ADR 0022 a liga só para si.
2. **Desligada:**
   - `SegundoFatorDaCarteiraGuard` deixa tudo passar.
   - `POST /v1/carteira/entrar` nunca devolve `segundoFatorExigido` e nunca cria desafio, nem para
     a conta que já tem TOTP ativo (as contas de teste de produção). A senha abre a sessão inteira.
     O corpo da segunda etapa (`{ codigo }`) cai no 400 da senha.
   - `GET /v1/carteira/eu` e a resposta do login trazem `segundoFator: { ativo, exigido: false }`.
   - As quatro rotas de `/v1/carteira/eu/segundo-fator` respondem 404.
3. **Ligada:** é exatamente a ADR 0022, sem relaxamento nenhum. A variável
   `SEGUNDO_FATOR_CARTEIRA_OPCIONAL_FORA_DE_PRODUCAO` saiu, porque os e2e dos outros módulos já rodam
   com a chave desligada e ela ficou redundante.
4. **A tela não conhece a chave.** O contrato ganhou `segundoFator.exigido`, e a web desvia para o
   cadastro e mostra "Duas etapas" só quando o servidor diz `exigido: true`. Religar não exige
   build da web.
5. **`FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA` continua obrigatória.** Os segredos já cifrados dependem
   dela. Religar com outra chave obrigaria todos a recadastrar.
6. **Os dados do TOTP ficam onde estão.** Nada é apagado: segredos, códigos de recuperação e
   `ultimo_passo` sobrevivem para o dia de religar. A rota de reset pelo Operador
   (`.../segundo-fator/resetar`) continua no servidor; ela só sai da tela.
7. **O caminho de quem perdeu o acesso passa a ser a senha.** A rota é
   `POST /v1/superadmin/usuarios-gestao/:id/senha`, com corpo `{ senha?: string }`, no padrão D-18:
   - sem `senha`, o servidor gera e devolve uma vez;
   - com `senha`, ela passa pela mesma regra de força, com o nome e o usuário da pessoa no
     contexto, e a resposta traz `senhaProvisoria: null`;
   - nos dois casos a senha é provisória (72 h, troca obrigatória no primeiro acesso pelo
     `CarteiraGuard`), todas as sessões e desafios da pessoa são revogados, e
     `auditoria_do_painel` registra o ator e a origem ("gerada pelo servidor" ou "escolhida pelo
     operador"), nunca a senha.

## Consequências

- **Religar** (`SEGUNDO_FATOR_CARTEIRA_LIGADO=true` e reiniciar a API): quem tem TOTP volta a ter o
  desafio, quem não tem é desviado para o cadastro. As sessões abertas só com a senha enquanto
  estava desligado ficam presas no cadastro (409) até sair e entrar com o código. O e2e
  `segundo-fator-desligado.e2e.test.ts` prova esse caso.
- A segurança da carteira volta ao nível da D3b original: senha, Argon2, limite por conta e por
  origem, revogação instantânea. O gatilho para religar está na dívida D3c.
- A assimetria da ADR 0022 (D3a) muda de lado: o Operador, que continua sem MFA, agora define a
  senha do Usuário de Gestão em vez de resetar o TOTP. O poder é o mesmo e a trilha também.
