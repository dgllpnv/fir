# Spec: Equipe e acessos na carteira (`/carteira/equipe`)

**Estado:** spec revisão 2, 2026-11-11. Pedido da cliente (Marília, diretora da Firmare). Incorpora o veto A1-A8
do appsec e os pontos 1-7 da LGPD.
**Gate de risco:** appsec VETO resolvido na revisão 2 (aguarda reconferência); LGPD incorporada; validador-numeros
sem objeto (não há dinheiro). Nenhum ticket começa antes da reconferência do appsec.
**Autor:** arquiteto-solucao. Só spec; nenhum código escrito.

## 1. Problema

Hoje só o Operador (painel `/gestao/usuarios-gestao`) cria e edita `Usuário de Gestão`. A Marília, que é a
diretora e dona da carteira, precisa chamar o operador para cada pessoa nova, cada troca de perfil e cada senha
esquecida. No app antigo dela existia "Administração › Equipe e acessos" (`index.html`, `k==="equipe"`): a
diretoria lista a equipe, cria ("Nova colaboradora"), edita o acesso, gera nova senha e remove acesso. O
protótipo é a referência de comportamento. Os 4 usuários reais (a migrar para o formato de hoje):

| Nome | Setor | Telas | Valores | Clientes |
|---|---|---|---|---|
| Marillia | diretoria | todas (acesso total) | sim | todas |
| Ana | financeiro | painel, clientes, rotina | não | (definir na tela) |
| Manu | administrativo | painel, clientes, rotina, resumo | sim | (definir na tela) |
| Eduarda | comercial | painel, rotina, clientes, metas, campanhas, prospeccao | não | (definir na tela) |

"Clientes que vê" (`minha` ou `todos`) não veio no pedido. Padrão: `minha`, igual a `PERFIL_DE_COLABORADORA_NOVA`.
A diretora ajusta na tela.

## 2. Quem usa

Um `Usuário de Gestão` com `escopo = 'geral'` e `carteira.administrar` (a Diretoria). Quem não tem a chave nem
vê o item no menu, e o servidor devolve 403 de qualquer jeito (regra 16). `escopo = 'grupo'` nunca usa esta tela
(`carteira.administrar` já é "só escopo geral" em `PERMS_CARTEIRA`). Usuário de grupo e escopo da pessoa ficam
sob o Operador.

A tela cuida só da **equipe da Firmare**: toda conta criada aqui nasce `escopo = 'geral'`, `grupo_id = NULL`.

## 3. Decisão de estrutura (a que pede ADR)

**Tensão.** A migration 0041 (F-1) tirou de `fir_carteira` toda escrita em `usuarios_gestao`: só `fir_painel`
escreve. Foi de propósito: uma injeção em qualquer rota da carteira não pode virar `UPDATE usuarios_gestao SET
valores = true`. A tela nova roda sob a sessão da carteira. Três caminhos:

- **A. Devolver `INSERT/UPDATE` a `fir_carteira`.** Rejeitado: reabre o F-1 inteiro e deixa a regra de
  escalada só no código de aplicação, a segunda camada virando a única.
- **B. Funções `SECURITY DEFINER` no banco** (mesmo molde da 0061), uma por operação, **sob `fir_carteira`**, que
  recebem o **token bruto da sessão** e resolvem o ator sozinhas (hash, linha viva em `sessoes_de_carteira`,
  `usuario_gestao_id`, `ativo`, escopo geral, `administrar`), e **impõem as regras do §5 dentro do Postgres**.
  **O ator nunca vem de GUC**: `app.pessoa_id` (valor real `'usuario_gestao:<id>'`, `banco.service.ts:397`) é escrito
  na conexão comprometível (0041/F-1) e só rotula a trilha genérica. **Escolhida** (veto A1; a alternativa, papel
  `fir_equipe` com conexão separada, está rejeitada na ADR `2026-11-11-equipe-e-acessos.md`, junto do risco
  residual: injeção que lê o token em uso ainda vence).
- **C. A API abrir conexão `fir_painel` em nome da carteira.** Rejeitado: D-5 proíbe misturar as duas
  conexões numa requisição, e o `Operador` é outro ator.

**Registrar como ADR nova** (`docs/adr/`, número seguinte): "A diretoria administra a equipe da carteira por
funções de banco". Ela **refina** a ADR 0011/F-1, não a contraria, e **não mexe** na ADR 0024 (a conta do operador
continua intocável, ver §5.3).

**Seam:** nenhum novo. Teste em dois seams já existentes: **HTTP da API** (comportamento, permissão, redação) e
**repositórios sobre Postgres real** (as funções `SECURITY DEFINER` e a regra de escalada, que mora no banco).
As regras de "quem pode conceder o quê" nascem como função **pura** em `packages/domain` (seam 2), usada pela
API para dar mensagem boa e pela tela para esconder o que não cabe; o banco é a barreira final.

## 4. Fluxos

Rota da tela: **`/carteira/equipe`**, dentro do módulo `cadastros` ("Administração"), como no app antigo. Item
de menu "Equipe e acessos", visível só com `carteira.administrar`.

1. **Listar.** Todas as contas de escopo geral: nome, usuário, função, setor, chips das telas, "Só a própria
   carteira" / "Todas as clientes", "Vê valores" / "Sem valores", estado (ativa, desativada, aguardando
   primeiro acesso). A conta do operador aparece com a etiqueta "Conta do painel" e **sem ações**.
2. **Criar** ("Nova colaboradora"). Campos: nome, usuário, setor, função, telefone, telas, "Clientes que vê",
   "Vê valores". O servidor **gera** a senha provisória (72 h, mesma `gerirProvisoria` de
   `CriarUsuarioDeGestaoEntrada`) e a devolve **uma vez**; a tela mostra num aviso "Anote agora, não aparece de
   novo" com botão copiar. Não existe campo de senha no formulário de criação.
3. **Editar acesso.** Muda nome, setor, função, telefone, telas, alcance, valores, `administrar`. Não muda
   `usuario` (é a chave de login e de `tentativas_login`), nem escopo/grupo. Quem teve privilégio **reduzido**
   perde as sessões na hora (§5.5).
4. **Redefinir senha.** Só servidor-gerada (diferente do painel: aqui **sem** opção de a diretora escolher a
   senha; ela não deve conhecer a senha de uma funcionária). Provisória 72 h, mostrada uma vez, troca
   obrigatória no primeiro acesso.
5. **Desativar / reativar.** Estado, nunca exclusão (regra 20). Desativar derruba sessões e 2º fator. Reativar
   **não** devolve a senha antiga: exige nova senha provisória (mesma resposta do fluxo 4).

## 5. Regras que o SERVIDOR valida

Todas valem para API **e** para as funções de banco. A tela é conveniência (regra 16).

1. **Ator resolvido no banco (A1).** Cada `equipe_*` recebe o token bruto da sessão e resolve o ator sozinha:
   hash, linha viva em `sessoes_de_carteira`, `usuario_gestao_id`; depois confere `ativo`, `escopo = 'geral'` e
   `carteira.administrar`. Nenhum GUC é fonte de autorização. **Proibido cache de perfil por token** na API.
2. **Nunca concede mais do que tem (escalada de privilégio).** O perfil resultante do alvo é **subconjunto em
   todos os eixos** do perfil de quem executa: cada tela em `modulos`; `valores`; `carteira = 'todos'`;
   `administrar`. Vale para criar, editar **e reativar** (A4). Violação: 403 `CONCESSAO_ACIMA_DO_SEU_ACESSO`.
   Conceder `administrar` é permitido só a quem o tem, e a trilha marca a ação como "sinal de detecção".
3. **Só age sobre quem tem perfil igual ou menor** (subconjunto nos mesmos eixos; c3bb4f6), inclusive na
   reativação. Conta de escopo `grupo` ou do operador: o mesmo erro genérico "não encontrada" (404), sem
   confirmar existência (A4).
4. **Não edita a si mesma.** Nenhuma das cinco operações aceita `id` igual ao do ator (403
   `NAO_EDITA_A_PROPRIA_CONTA`); o PATCH recusa `valores`/`administrar` quando alvo = ator, **também dentro da
   função** (A8). Trocar a própria senha continua em `/carteira/eu/senha`.
5. **Nunca toca a conta do operador.** O gatilho `conta_de_gestao_do_operador_fixa` (ADR 0024) continua valendo
   e é testado com as funções no caminho (A7); a API traduz o `check_violation` em 409 sem casar texto.
6. **Trava de última diretoria (A2).** Não se desativa nem rebaixa a última conta ativa com `administrar` que
   **não** seja do operador. TODA função que muda `administrar`/`ativo`/escopo toma o mesmo
   `pg_advisory_xact_lock` fixo **no início**, e só **depois** do lock conta (excluindo contas de operador).
   Teste de corrida com duas conexões reais.
7. **Revogação na mesma transação (A5, A6).** Ao desativar, redefinir senha ou **reduzir** `modulos`,
   `carteira` ou `valores`: `sessoes_de_carteira.revogada_em = now()` **e** `desafios_de_carteira` pendentes
   revogados. O reset de senha **não** apaga o 2º fator (só o Operador o faz); desativar sim derruba o 2º
   fator. Teste do token antigo de conta desativada.
8. **Senha provisória (A3).** Argon2id e provisória gerados **na API**: CSPRNG, ao menos 80 bits, alfabeto sem
   ambiguidade (sem 0/O/1/l/I). A função recebe **só o hash**; texto claro nunca em SQL, de/para nem log. A
   nova provisória invalida a anterior; uso único. Resposta com `Cache-Control: no-store` e `Pragma: no-cache`;
   corpo nunca em log de erro.
9. **Trilha append-only de→para** (regra 20): ator **resolvido no banco** pela função, quando, ação
   (`equipe.criou`, `.editou`, `.redefiniu_senha`, `.desativou`, `.reativou`), `de`/`para` só com nomes de campo
   e flags (`valores: false -> true`, lista de telas). Para `nome` e `telefone` grava apenas "nome alterado" /
   "telefone alterado", **sem valor** (LGPD 2). Nunca senha nem hash. Inclui IP de origem. Reusa
   `auditoria_do_painel` (`atorTipo`, escrita já concedida pela 0030); ampliar CHECK de `acao`/`entidade` se
   restritivo.
9a. **Desativação e dado pessoal (LGPD 3).** Ao desativar: anular `telefone`, aniversário, `mostrar_aniversario` e
    `funcao`; vínculo e trilha ficam. Reativar exige reinformar esses campos. Depois do prazo o `nome` vira
    `ex-pessoa-<8 hex>` (dívida D9, gatilho: 1º desligamento real).
9. **Redação de valores.** Responder `UsuarioDeGestaoNaLista` não carrega dinheiro, mas esta tela fica sob o
   `RedacaoInterceptor` do espaço `carteira` como qualquer rota: se algum campo monetário aparecer um dia, sai
   apagado sem `valores`. O chip "Vê valores" é permissão, não valor, e aparece sempre.
10. **Rate limit (A8).** `limite-da-carteira` por **ator**, mais teto por **origem** (IP); nas rotas de senha e
    criar: 10 por 10 min. Excesso: 429, e entra na trilha.
11. **Senha nunca em log.** Nem requisição, resposta, erro ou auditoria (ver item 8). Critério de log (LGPD 4):
    nem **nome, usuario ou telefone** em log de produção.
12. **Validação na borda (A8).** Zod `strict()`: campo desconhecido é 400; `:id` validado como uuid; exige
    `Content-Type: application/json`. `escopo` e `grupoId` **não existem**
    nos schemas desta tela (impossível, por construção, mandar escopo grupo).
13. **Telas × chaves.** Dependências vivem em `PERMS_CARTEIRA`. Conceder `valores` não precisa de mais nada;
    `mensalidades` é derivada de `valores`. A tela não duplica essa tabela: lê de `packages/domain`.
14. **`setor` nunca autoriza** (`carteira.ts`, A-4): decide só quem recebe item de checklist. Mudar setor não
    passa pela regra de escalada.

## 6. Modelo de dados

**Reusa `usuarios_gestao` inteira.** Nenhuma coluna nova. Nenhuma tabela nova.

**Migration indispensável, forward-only, EXPAND puro** (próximo número da fila): funções `SECURITY DEFINER`
`equipe_criar`, `equipe_editar`, `equipe_redefinir_senha`, `equipe_alterar_estado`, cada uma com primeiro
argumento o token bruto da sessão (ADR), `SET search_path = pg_catalog, public`, sem SQL dinâmico, `REVOKE ALL
... FROM PUBLIC`, `GRANT EXECUTE` só a `fir_carteira`. Cada uma aplica os itens 1 a 7 do §5 e grava a trilha na
mesma transação, com o ator resolvido no banco. Recebem só o **hash** da senha (nunca texto claro). Guarda no
fim da migration confere os privilégios (`has_function_privilege` positivo para `fir_carteira`, **negativo para
`fir_app` e `fir_painel`**, e `NOT has_table_privilege(... 'UPDATE')`), no estilo da 0041 e da 0061. `fir_carteira` **continua sem**
`INSERT/UPDATE` direto em `usuarios_gestao`; essa guarda é teste de regressão.

Sem migration de dados: as 4 contas reais já existem ou entram pela própria tela.

## 7. Contrato de API (`packages/contracts`)

Reusa `PerfilDoUsuarioDeGestao`, `UsuarioDeGestaoNaLista`, `ListaDeUsuariosDeGestaoSaida`,
`UsuarioDeGestaoCriadoSaida`, `SenhaDoUsuarioDeGestaoRedefinida`. Novos, só o que é diferente:

| Método e rota (`/v1/carteira/equipe`) | Entrada Zod | Saída |
|---|---|---|
| `GET /` | nenhuma | `ListaDeUsuariosDeGestaoSaida` (só escopo geral) |
| `POST /` | `CriarMembroDaEquipeEntrada`: `usuario, nome, ...camposDoPerfilNaEntrada` (**sem** `escopo`, `grupoId`) | `UsuarioDeGestaoCriadoSaida` (201) |
| `PATCH /:id` | `EditarMembroDaEquipeEntrada`: `nome, ...camposDoPerfilNaEntrada` (**sem** `escopo`, `grupoId`, `ativo`) | `UsuarioDeGestaoNaLista` |
| `POST /:id/senha` | `{}` estrito (**sem** campo `senha`) | `SenhaDoUsuarioDeGestaoRedefinida` com `senhaProvisoria` string |
| `POST /:id/desativar` e `POST /:id/reativar` | `{}` estrito | `UsuarioDeGestaoNaLista` (reativar também devolve a provisória nova) |

Erros (código estável, a tela casa pelo código): 403 `CONCESSAO_ACIMA_DO_SEU_ACESSO`, 403
`NAO_EDITA_A_PROPRIA_CONTA`, 409 `ULTIMA_DIRETORIA`, 409 `USUARIO_JA_EXISTE` (genérico: não distingue conta de grupo ou do operador), 404
"não encontrada" (inclui conta de grupo/operador como alvo), 429. A lista **não devolve telefone**: ele só
aparece na ficha, sob demanda (LGPD 4). A funcionária lê o próprio cadastro em `GET /v1/carteira/eu`
(existe, `carteira.controller.ts`), somente leitura; retificação pela Diretoria; a criação da conta avisa a
pessoa de que seus dados são tratados.

`TELAS_DAS_ROTAS` ganha a linha `equipe/**` com a chave `cadastros`; o teste que varre o registro do Nest
(`modulos-das-rotas.test.ts`) já reprova rota sem tela. Sem isso a suíte falha. Rotas **não** entram em
`/v1/superadmin/*` (o painel continua sem dinheiro e sem esta superfície).

A função pura de "o perfil cabe no meu?" mora em `packages/domain/src/carteira.ts` e é exportada para os dois
lados; o schema Zod só valida forma.

## 8. Interface (`docs/design.md`, 390 px)

- Rota `/carteira/equipe`, item "Equipe e acessos" no grupo "Administração" da lateral da carteira
  (`apps/web/src/app/carteira/areas.ts`, atrás de `temPermCarteira(.., 'carteira.administrar')`).
- Lista em **linhas, não em cards**: nome e função à esquerda, estado à direita; as telas como chips que
  quebram a linha. Nada rola na horizontal. Em 390 px o botão principal "Nova colaboradora" ocupa a largura.
- Criar e editar abrem em tela cheia no celular, dividida em: dados da pessoa (sempre aberto); "O que ela vê"
  (telas, clientes, valores); campo raro (`telefone`, `administrar`) **recolhido**.
- "Vê valores": explicação curta num ícone de dica ("Sem isso, a pessoa não vê nenhum valor de dinheiro").
- Senha provisória: aviso destacado, texto em fonte monoespaçada de algarismos tabulares, botão "Copiar",
  texto "Mostrada só agora". Fecha ao navegar; ao reabrir a ficha só há "Redefinir senha".
- Ações destrutivas (desativar, redefinir senha) pedem confirmação com a consequência dita ("Ela sai de todos
  os aparelhos agora").
- Termos do `CONTEXT.md`: **Usuário de Gestão**, **Diretoria**, **Carteira**. Na tela: "equipe", "acesso",
  "colaboradora" (do protótipo). Marca: FIR Clinic só onde se fala da ferramenta; aqui é Firmare (consultoria).
  Sem emoji, sem roxo, sem gradiente.
- A tela **não calcula** permissão nem concessão sozinha: esconde opções com a função de `packages/domain`;
  quem decide é o servidor (a tela mostra o 403 em linguagem simples).

## 9. Critérios de aceite (cada um vira teste)

1. Marília (Diretoria) cria Ana com perfil do quadro acima: 201, senha provisória no corpo, Ana entra, é forçada
   a trocar a senha, e vê só as 3 telas e **nenhum** valor.
2. Segunda leitura (`GET`) da Ana **não** traz senha nem hash em lugar nenhum; resposta de criar tem
   `Cache-Control: no-store`.
3. Quem não tem `carteira.administrar` (Ana, Manu, Eduarda) recebe 403 em **todas** as rotas `equipe/**`, e o
   item não aparece no menu.
4. Usuário com `administrar` mas sem `valores` tenta conceder `valores`: 403 `CONCESSAO_ACIMA_DO_SEU_ACESSO`,
   nenhuma linha alterada.
5. Editar a si mesma, em qualquer das 5 rotas: 403 `NAO_EDITA_A_PROPRIA_CONTA`.
6. Qualquer operação sobre a conta do operador: recusada (409), `usuarios_gestao` intacta.
7. Desativar a única diretoria ativa não-operadora: 409 `ULTIMA_DIRETORIA`. Duas requisições simultâneas de
   rebaixar as duas últimas: uma passa, a outra falha (lock).
8. Desativar, redefinir senha e rebaixar derrubam sessões vivas da pessoa: a requisição seguinte dela dá 401.
   Com o 2º fator ligado, ele também é apagado.
9. Cada escrita deixa **uma** linha de trilha com ator, ação e de→para; a trilha não contém senha nem hash;
   `UPDATE` e `DELETE` na trilha falham.
10. `fir_carteira` não consegue `UPDATE usuarios_gestao SET valores = true` por SQL direto (regressão do F-1);
    só as funções de `equipe_*` escrevem.
11. A senha redefinida difere da anterior, é provisória, expira em 72 h, e o login com a antiga falha.
12. Reimportar o mesmo POST de criar com o mesmo `usuario`: 409 `USUARIO_JA_EXISTE`, sem duplicar.
13. Rate limit: a 11ª tentativa em 10 min dá 429.
14. Em 390 px nenhuma tela de `/carteira/equipe` gera barra horizontal (Playwright).
15. Todo `Authorization`, corpo e query com senha são mascarados em log; nome, usuario e telefone também (teste
    que varre o log capturado).
16. **Ator forjado (A1):** com `app.pessoa_id` forjado para uma Diretoria e token de quem não é Diretoria, toda
    `equipe_*` recusa; token inexistente, revogado ou de conta desativada também.
17. **Privilégios (A7):** `has_function_privilege` negativo para `fir_app`/`fir_painel`; chamada direta por eles falha.
18. **Reativação:** não reativa conta cujo perfil excede o do ator (A4); reativar exige nova provisória e
    reinformar telefone/aniversário/função (LGPD 3).
19. **Reset de senha** mantém o 2º fator e revoga `desafios_de_carteira` pendentes; provisória anterior invalidada
    e de uso único (A3, A5).
20. **Redução de `modulos`/`carteira`/`valores`** revoga as sessões da pessoa (A6).
21. Corrida de última diretoria com **duas conexões reais** (A2); `:id` não uuid: 400; Content-Type não JSON: 415/400.

## 10. Casos de abuso (o appsec transforma em teste)

- **Escalada vertical:** Eduarda, com um perfil alterado à mão para `administrar`, cria alguém com `valores`.
- **Escalada horizontal:** diretora A (menor) edita diretora B (maior); ou edita a si mesma pelo PATCH.
- **Autoconcessão por duas contas:** criar C com mais do que A tem, depois C eleva A.
- **Corrida:** duas desativações simultâneas esvaziando as diretorias; criar duas contas com o mesmo `usuario`.
- **Mass assignment:** corpo com `escopo: 'geral'`, `grupoId`, `ativo`, `senhaHash`, `setor` fora do enum:
  400 por `strict()`.
- **IDOR:** `:id` de uma conta de `escopo = 'grupo'` ou do operador pela rota da equipe: 404 genérico, não
  403, para não confirmar existência.
- **Ator forjado por GUC:** injeção de SQL na carteira escreve `app.pessoa_id` e chama `equipe_*` (§5.1).
- **Conta do operador:** tentativa de dar senha a ela pela nova rota (contornaria a allowlist de IP do painel).
- **Sessão antiga:** token da pessoa desativada continua aceito por cache.
- **Vazamento de senha:** senha provisória em log, em trilha, em header de erro, em cache de proxy, no histórico
  do navegador (a página não a coloca na URL nem em `localStorage`).
- **Enumeração:** tempo de resposta e mensagem de erro iguais para usuário existente e inexistente na criação.
- **Reativação:** reativar uma conta antiga sem trocar a senha (deve exigir nova provisória).

## 11. LGPD (dado de funcionária)

Aqui há dado pessoal **de trabalhadora**, não dado de saúde: nome, telefone, função, setor, acessos. Para o
`especialista-lgpd-saude` decidir:

- **Base legal e classes:** `docs/compliance/retencao.md` linhas 37 (`usuarios_gestao`), 124 (telefone,
  aniversário, `funcao`) e 131-134 (2º fator, recuperação, desafios, tentativas). Bases: **art. 7º, V** (contrato
  de trabalho) e **art. 7º, IX** (segurança do acesso). **Sem art. 11**: não é dado de saúde.
- **Minimização:** nenhum campo novo. `telefone` opcional, recolhido, fora da lista (só na ficha).
- **Trilha sem valor pessoal:** "nome alterado", "telefone alterado" (§5.9).
- **Desativado:** vínculo + 5 anos. Ao desativar, anular telefone, aniversário, `mostrar_aniversario` e `funcao`;
  reativar exige reinformar; `nome` vira `ex-pessoa-<8 hex>` após o prazo (dívida D9, gatilho: 1º desligamento
  real; registrar em `docs/dividas.md`).
- **Titular:** a funcionária vê o próprio cadastro em `GET /v1/carteira/eu` (leitura); retifica pela Diretoria;
  é avisada ao criar a conta.
- **Supabase:** enquanto o Supabase não for desligado, desativar aqui exige desativar lá; checklist em
  `docs/decisoes.md` e `retencao.md`.
- **Registro de leitura da lista:** não nesta versão. Gatilho: quando a ficha passar a mostrar login, IP, salário
  ou aniversário.
- **Log:** sem nome, usuario nem telefone em log de produção (regra 21).

## 12. O que fica FORA

- Escolher a própria senha na criação ou na redefinição (a diretora não conhece a senha de ninguém).
- Convite por e-mail ou link; o fluxo é senha provisória entregue por fora (como em `criarClinica`).
- Contas de `escopo = 'grupo'`, grupos e clínicas (continuam do Operador em `/gestao`).
- Editar `usuario`, excluir de verdade, mesclar contas.
- Reset do segundo fator pela diretora (hoje é `POST /v1/superadmin/usuarios-gestao/:id/segundo-fator/resetar`,
  do Operador). Redefinir senha cobre o caso enquanto o 2º fator está desligado (ADR 0023).
- Importação em lote e histórico de acessos da pessoa (login, IP).
- Perfis nomeados/reutilizáveis (modelos de perfil). Cada pessoa é um perfil direto, como no protótipo.
- Papel "Gestão de pessoas" da clínica: é outra tela e outro sistema (c3bb4f6, tenancy de clínica).

## 13. Tickets (fatias verticais, nesta ordem)

Cada fatia entrega comportamento testável de ponta a ponta. Nenhum seam novo.

0. **Antes de tudo:** ADR `2026-11-11-equipe-e-acessos.md` (mecanismo de ator: token bruto) aceita pelo humano e
   reconferida pelo appsec. Sem isso nenhuma fatia abaixo começa.
1. **T1: Domínio + prova do ator.** `engenheiro-backend`. Função pura em `packages/domain/src/carteira.ts`
   ("o perfil cabe no meu?" em todos os eixos, "alguém pode agir sobre quem?"), Vitest e fast-check na relação de
   ordem. Mais a migration-esqueleto com a resolução de ator por token e a guarda de privilégios (A1, A7), e o
   teste de ator forjado (aceite 16, 17). Sem rota.
2. **T2: Listar + criar** (fatia fina completa). `engenheiro-backend`. `equipe_criar` (recebe só hash; Argon2id e
   provisória na API, A3), `GET` sem telefone, contrato Zod, `TELAS_DAS_ROTAS`, trilha com IP, rate limit por
   ator e origem, `no-store`/`Pragma`. Aceite 1 a 3, 9, 10, 12, 13, 15.
3. **T3: Editar + escalada + trava.** `engenheiro-backend`. `equipe_editar`, regras 2 a 6 (lock A2 fixo no início),
   revoga sessões ao reduzir (A6). Aceite 4 a 7, 20, 21.
4. **T4: Redefinir senha, desativar, reativar.** `engenheiro-backend`. Revogação de sessão e desafios na mesma
   transação; reset mantém 2º fator; reativação com subconjunto e reinformar dados; anular PII ao desativar.
   Aceite 7, 8, 11, 18, 19.
5. **T5: Tela `/carteira/equipe`.** `engenheiro-frontend-web`. Só depois de T2, T3 e T4 estarem verdes (o
   contrato fecha primeiro). Lista, criar, editar, aviso da senha única, confirmações, 390 px, entrada no menu.
   Passa por `docs/design.md` e por `/prototype` (três direções) antes de codar a lista.
6. **T6: Abuso e E2E.** `engenheiro-qa-automacao`. **Em paralelo desde T2**, não depois: transforma o §10 em teste,
   mais os fluxos Playwright (Marília cria Ana, Ana entra e troca a senha, Marília a desativa) e o critério 14.
   Tem veto sobre permissão e escalada.

Depois do T6: `revisor-codigo`, `validador-numeros` (não há dinheiro aqui; confirma que nenhum campo monetário
entrou na saída), e deploy por decisão do dono.

## 14. Decisões e riscos registrados

Decididas (antes eram perguntas abertas):
1. **Conceder `administrar`:** sim, só se ela tem, com a trava (§5.6) e marca de "sinal de detecção" na trilha.
2. **Alcance padrão:** `minha`; a diretora amplia por pessoa.
3. **Registro de leitura da lista:** não nesta versão; gatilho na §11.

Riscos aceitos:
- **Atribuição:** a diretora pode entrar com a provisória da Ana e agir como ela. Mitigação parcial: troca
  obrigatória no primeiro acesso, trilha com IP de origem, e a provisória só mostrada uma vez. Não se elimina.
- **Token em uso lido por injeção** vence o mecanismo de ator (ADR, risco residual).
- **Dívida D9:** anonimização do nome pós-desligamento (gatilho: 1º desligamento real).

**GATE DE RISCO: appsec VETO resolvido na revisão 2, aguarda reconferência do appsec.**
