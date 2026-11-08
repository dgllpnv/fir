# ADR 0022 — Segundo fator (TOTP) do Usuário de Gestão

**Status:** aceita · 2026-11-08 · **emendada pela [ADR 0023](0023-segundo-fator-desligado-por-decisao-do-dono.md)
(D-23):** a exigência está desligada por padrão (`SEGUNDO_FATOR_CARTEIRA_LIGADO`); ligada, vale tudo o que
está abaixo, menos o relaxamento `SEGUNDO_FATOR_CARTEIRA_OPCIONAL_FORA_DE_PRODUCAO` da decisão 7, que saiu.
**Substitui:** a emenda de 2026-11-05 da ADR 0012 ("sem MFA"). **Fecha:** a dívida D3b.
**Origem:** D-22 item 13 (o dono decidiu construir); gate appsec G8, ajuste A-12 e casos de abuso 26–35.
**Divergência do protótipo:** o protótipo Firmare Gestão não tem segundo fator. Esta é uma decisão de produto
do dono (D-22), não uma correção de comportamento.

## Decisões

1. **TOTP pela RFC 6238**: SHA-1, 6 dígitos, passo de 30 s, janela de ±1 passo, relógio do servidor
   (`Relogio` injetado). Implementado sobre `node:crypto` (`apps/api/src/carteira/segundo-fator/totp.ts`)
   e conferido contra os vetores das RFCs 4226 e 6238. A política (passo, janela, anti-replay, espera,
   forma dos códigos, URI) é pura e mora em `packages/domain/src/segundo-fator.ts`.
2. **Anti-replay em duas camadas.** O domínio só oferece passos maiores que `ultimo_passo`; o `UPDATE`
   que avança o passo também exige `ultimo_passo < novo`. A linha do TOTP é travada (`FOR UPDATE`),
   então duas verificações simultâneas se enfileiram.
3. **O estado mora em `segundo_fator_da_carteira`, nunca em `usuarios_gestao`.** A identidade continua
   escrita só pelo painel (F-1/A-1, 0041): `fir_carteira` grava em `usuarios_gestao` só as três colunas
   de senha. A tabela do TOTP não concede acesso a nada. Ela não tem RLS pela mesma razão que
   `sessoes_de_carteira` não tem: o login a escreve antes de existir sessão, com o ator `sistema`.
4. **Segredo**: 160 bits do CSPRNG, AES-256-GCM, AAD = `usuario_gestao:<id>:v<versão>`. A chave vem de
   `FIR_CHAVE_SEGUNDO_FATOR_CARTEIRA` (`implantar.sh`; `:?` no compose; ausente em produção é erro na
   subida), derivada por HKDF. O pepper dos códigos de recuperação sai do mesmo segredo por outro rótulo.
   A versão da chave fica numa coluna para permitir rotação. Hoje só existe a v1. Trocar o segredo exige
   resetar todos os usuários.
5. **Login em duas etapas na MESMA rota** (`POST /v1/carteira/entrar`). A senha certa de quem tem TOTP
   devolve `{ segundoFatorExigido: true }` e um **desafio** opaco de 5 min, num cookie à parte
   (`__Host-fir-carteira-desafio`). O desafio não é sessão: nenhuma rota o aceita. A segunda etapa manda
   `{ codigo }` ou `{ codigoDeRecuperacao }`, sob o mesmo piso de resposta da senha. A rota é a mesma
   para não acrescentar uma liberação no `CarteiraGuard`.
6. **Limite de tentativas por conta**, atravessando desafios (`tentativas_de_carteira.tipo` = `totp` ou
   `recuperacao`). Quatro erros são livres; a partir do quinto, a espera dobra (1, 2, 4… min, teto de 24 h)
   e conta da última falha. Além disso, cinco erros num mesmo desafio o matam.
7. **Obrigatório para todo Usuário de Gestão.** Uma sessão sem segundo fator só alcança o cadastro,
   `eu` e `sair`. O `SegundoFatorDaCarteiraGuard` roda logo depois do `CarteiraGuard`. É um guard à parte
   só por propriedade de arquivo no G8; ele responde 409 `SEGUNDO_FATOR_CARTEIRA`. Fora de produção, a
   variável `SEGUNDO_FATOR_CARTEIRA_OPCIONAL_FORA_DE_PRODUCAO=1` dispensa a exigência para conta **sem**
   TOTP, para os e2e dos outros módulos. Em produção ela é ignorada.
8. **Cadastro**: exige a sessão e a reconfirmação da senha. O segredo fica pendente por 15 min, até o
   primeiro código. O QR é gerado no navegador (`qrcode`). Ativar gera 10 códigos de recuperação de 60
   bits, guardados só como HMAC, e derruba as outras sessões. Regenerar os códigos exige senha e código
   na hora, invalida os anteriores e derruba as outras sessões. O uso de um código de recuperação é
   auditado e mostrado na entrada seguinte.
9. **Reset só pelo Operador** (`POST /v1/superadmin/usuarios-gestao/:id/segundo-fator/resetar`, motivo
   obrigatório). Ele apaga o estado, invalida os códigos, revoga todas as sessões e desafios, e grava
   em `auditoria_do_painel` pela conexão `fir_painel`. O procedimento fora de banda está em
   `infra/producao/README.md`.
10. **Sem "lembrar este aparelho"** nesta versão.

## Riscos assumidos

- **Assimetria (D3a):** quem reseta é o Operador, e o painel não tem MFA. A força do 2FA da carteira fica
  limitada à conta do Operador. Isso fica registrado aqui. Resta ao dono decidir entre WebAuthn no painel
  e o risco aceito por escrito.
- Uma injeção de SQL com o papel `fir_carteira` poderia apagar o TOTP de alguém. É o mesmo poder que esse
  papel já tem sobre `sessoes_de_carteira` (criar sessão), e por isso não é uma escalada nova.
