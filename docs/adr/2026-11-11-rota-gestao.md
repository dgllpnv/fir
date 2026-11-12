# ADR: a rota web do painel interno passa de /superadmin para /gestao

Data: 2026-11-11. Status: aceita (dono do produto, 11/11/2026). Complementa a ADR 0024 (um login para a
Firmare) e muda a linha do `CONTEXT.md` sobre `/superadmin` como rota do painel.

## Contexto
O dono pediu: "a rota é para a aplicação abrir o gestão, com admin ou superadmin". A tela que o
`Operador` e o `Usuário de Gestão` abrem é o gestão da Firmare; o nome `/superadmin` descreve um papel,
não o lugar. A allowlist de IP do Traefik casava o segmento `superadmin`, e o `CONTEXT.md` proíbe
`/painel` por colidir com a chave de permissão `painel`.

## Decisão
1. A rota **web** passa de `/superadmin` para `/gestao`. A URL antiga redireciona com **308**
   (preserva o método e o caminho), para favoritos e links já enviados.
2. **Não mudam:** o prefixo da API `/v1/superadmin`, o nome do papel (`Operador`) e as chaves de
   permissão. Mudar rota de tela é barato; mudar prefixo de API quebra cookie, allowlist e contrato.
3. A allowlist de IP do Traefik continua reconhecendo o segmento `superadmin` (a API). Por decisão do
   dono, **`/gestao` fica aberta a qualquer IP**, para a equipe abrir de qualquer rede.
4. **Esta abertura é consciente.** A API do painel segue atrás de IP e de autenticação; a tela de
   `/gestao` é só a casca (JavaScript e HTML sem dado). O risco aceito: qualquer pessoa na internet
   consegue **ver a casca de JavaScript** das telas internas, o que revela nomes de rotas e telas, mas
   nenhum dado, porque toda chamada à API é recusada fora da allowlist e sem sessão.
5. **Gatilho para revisitar:** (a) qualquer dado de negócio passar a ser renderizado no servidor da
   página `/gestao` (hoje não há); (b) tentativa de varredura registrada na casca; (c) a Firmare passar a
   ter IP fixo para a equipe inteira. Em qualquer um, nova ADR fecha `/gestao` por IP.

## Consequências
- Links e favoritos para `/superadmin` continuam funcionando pelo 308; ele pode sair depois de um
  período sem acesso (sem data definida).
- Duas coisas com nomes diferentes passam a coexistir: tela `/gestao`, API `/v1/superadmin`. Quem lê o
  código precisa desta ADR para entender por quê.
- A regra de que a allowlist depende do nome do segmento continua: nunca renomear o segmento da API sem
  atualizar o Traefik.
- **Pendência de documentação:** a linha de termos proibidos do `CONTEXT.md` (`/painel` -> `/superadmin`)
  e a descrição da Visão geral na `Conta de gestão do operador` ainda dizem `/superadmin`.

## Alternativas rejeitadas
- **Renomear também `/v1/superadmin`:** quebra contrato, cookie e Traefik sem ganho para a usuária.
- **Manter `/gestao` atrás da allowlist:** seria o mais seguro, mas contraria a decisão do dono.
- **Sem redirecionamento:** quebraria links já distribuídos.
