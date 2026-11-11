# A clínica cuida do próprio time (Usuários e acessos) — spec

> Status: **gates de risco (appsec e LGPD) incorporados em 2026-11-10; em implementação local, sem
> commit e sem deploy.**
> Origem: pedido da cliente (Marília) — o cadastro do time da clínica tem de ser responsabilidade da
> PRÓPRIA clínica. O dono mandou seguir em frente. Decisão registrada em
> `docs/adr/2026-11-11-admin-da-clinica.md`; a D-10 (`docs/decisoes.md`) fica substituída na parte da
> cadeia de criação.
> Fontes conferidas: protótipo (`prototipo-rotinas-de-gestao.html` ~1749, 1893, 1906-1908),
> `apps/api/src/pessoas/{pessoas.controller,pessoas.service,acesso.service,escrita-de-pessoa}.ts`,
> `apps/web/src/components/tela-usuarios.tsx`, `packages/domain/src/{permissoes,pessoa}.ts`,
> `CONTEXT.md` (Pessoa e Perfil, Sessão de suporte).
> Perguntas P-1, P-2 e P-3 foram **decididas pelo dono** (instrução de 2026-11-10): P-1 = só a
> administradora edita a matriz; P-2 = perfil novo nas clínicas existentes por migration idempotente;
> P-3 = aviso na tela, 30 dias.

## 1. O problema

Hoje só o `Operador` (superadmin) cria uma `Pessoa` administradora (`pessoas.service.ts`: "`perfilId`
é obrigatório no contrato"; `escrita-de-pessoa.ts`: "só o superadmin tem rota para isso"; a tela
esconde a opção). A clínica que quer dar acesso total a uma segunda pessoa de confiança precisa
pedir à Firmare. No protótipo isso não existe: a admin da clínica cria e edita pessoas **com a flag
admin**, e a clínica mantém ao menos uma admin ativa.

Constatação medida no código, que muda o tamanho do trabalho: **a metade difícil já existe.**
`AcessoService.editar` já aceita `acesso: { admin: true }` (promover), e a invariante "a clínica
nunca fica sem administradora ativa" já vale por três caminhos (`podeDesativar`, `podeTrocarAcesso`,
`podeExcluirPessoa`, com 422 `UltimaAdministradoraAtiva`) e derruba as sessões ao desativar.

**O buraco de segurança existe HOJE, em produção, e independe do pedido da cliente.** A classe
`PessoasController` exige só `config` (`pessoas.controller.ts:62`), e nada mais é conferido em
`PATCH :id` (l.129), `POST :id/senha` (l.177), `DELETE :id` (l.162) e `PUT perfis` (l.216);
`acesso.service.ts:111-127` (editar) e `:216-266` (salvarPerfis) e `pessoas.service.ts:79-95`
(redefinirSenha) não recebem nem olham o ator. Consequência: pessoa de perfil comum com `config`
(a "Supervisão com Configurações liberada") pode (a) se promover a admin, (b) redefinir a senha de
uma admin e entrar como ela, (c) desativar/reativar/excluir uma admin, (d) dar a si mesma ou a outra
pessoa um perfil mais rico (`valores`, `pessoas.gerir`, `estoque.gerir`), (e) editar a matriz de
perfis acrescentando chaves que não tem. **Este é o ticket 1 e vai antes de qualquer criação de
admin.**

## 2. A decisão

1. **A administradora da clínica cria e edita administradoras da SUA clínica**, como no protótipo.
   `POST /v1/pessoas` passa a aceitar `acesso: { admin: true } | { admin: false, perfilId }`.
2. **A fronteira de privilégio muda de `config` para "ser administradora"** nas operações que
   concedem ou retiram administração, e **para "só age sobre o que você mesma tem"** nas demais
   (seção 3.2). `config` continua abrindo a tela.
3. **O Operador continua cadastrando a primeira administradora** e continua sendo a saída quando a
   clínica perde todas as credenciais (D-10). Ele não perde nada; a clínica ganha.
4. **Novo perfil padrão "Gestão de pessoas"** com só `pessoas.gerir`. **Diverge do protótipo** (ADR).
5. **Minhas metas** diz com clareza quando a pessoa não tem ficha de RH (seção 3.6).
6. **`PUT /v1/pessoas/perfis` só para administradora** (P-1, decidida).

## 3. Regras

### 3.1 Criar e editar

- Admin da clínica cria pessoa com `perfilId` **ou** como admin (`perfil_id = NULL`, restrição
  `pessoa_tem_acesso_definido` da 0002 continua valendo, no banco).
- A **senha provisória** de qualquer pessoa criada, admin inclusive: gerada no servidor, devolvida
  **uma única vez**, 72 h, troca obrigatória no primeiro acesso, nunca lida de novo (CONTEXT.md).
  Admin nova **não** tem tratamento diferente. A tela mostra a provisória uma vez e não a repete em
  lista, log nem trilha (`auditoria_sem_segredos` já cobre `senha_hash`).
- **Redefinir a senha de uma administradora, por uma administradora: a provisória é sempre GERADA no
  servidor.** Escolher a senha de outra admin é conhecer a credencial dela; recusa 403
  `SenhaDeAdministradoraSoGerada` (é recusa de privilégio, como as demais). Quem escolhe continua podendo para pessoa de perfil comum
  (decisão do dono, 2026-11-04, preservada). O `Operador` mantém a escolha (ele é a saída de
  "esqueci a senha").
- `usuario` não se edita (D-14), único por clínica pelo índice (409), nunca por `SELECT` prévio.
- A clínica da nova admin é **sempre a da sessão** (`app.clinica_id`); o corpo não carrega
  `clinicaId`. Perfil de outra clínica continua recusado pela RLS (`inserirPessoa`).
- O corpo de criação é **discriminado**: `acesso` ou o legado `perfilId`, nunca os dois nem
  nenhum (400).

### 3.2 Escalada de privilégio (o ponto central)

Regras no **servidor**, em **funções puras do domínio** (`packages/domain/src/pessoa.ts`), nunca `if`
por rota. O ator é um valor `AtorDeAcesso = { tipo: 'pessoa' | 'operador', admin, … }`:

- **de onde vem `ator.admin`:** para `pessoa`, **lido do banco dentro da transação**, depois do lock
  (3.3) — nunca do cookie e nunca do contexto lido pelo guard antes da transação (a sessão do guard
  pode ter sido rebaixada entre o guard e a escrita); para `operador`, é `true` por construção, e só
  existe em sessão de suporte (D-13). A construção do ator mora em `apps/api/src/comum/contexto.ts`
  (`atorDeAcessoDoContexto`) e a releitura na transação em `pessoas/acesso-do-ator.ts`.

As funções:

1. **`podeConcederAdministracao(ator, alvo | null, novoAdmin)`** — criar admin (`alvo = null`),
   promover e rebaixar exigem `ator.admin`. Sem mudança de estado (promover quem já é admin) é no-op
   permitido. `config` sozinho **não basta**.
2. **`podeAgirSobre(ator, alvo, perfis)`** — vale para **atribuir perfil, criar pessoa, redefinir
   senha, editar nome/função, desativar, REATIVAR e excluir**. Não-admin só age sobre alvo que **não é
   administradora** (inclusive inativa: reativar admin inativa é só de admin) e cujo perfil tem
   apenas chaves que o ator próprio tem (`temPerm`, com as dependências da tabela). Admin e `operador`
   agem sobre qualquer um da clínica.
3. **`podeConcederChave(ator, perfis, chaves)`** — não-admin só concede chave que ele próprio tem
   (`temPerm`). Usada ao **atribuir um perfil** (as chaves do perfil) e ao criar pessoa com perfil.
   **Auto-atribuição de perfil mais rico é recusada** com código próprio (`AutoAtribuicaoDePerfil`).
4. **`podeEscolherSenhaDe(ator, alvo)`** — a regra de "admin só tem senha gerada" (3.1).
5. **`podeEditarMatrizDePerfis(ator)`** — só admin ou operador (P-1).

Demais regras:

6. **A administradora é da própria clínica.** Não há rota por `clinicaId` no corpo. O teste de
   isolamento prova que admin da clínica A não vê, não cria e não promove na clínica B (RLS +
   filtro).
7. **Sessão de suporte (D-13) continua como é:** o `Operador` tem privilégio de administradora, mas
   **não assina e não troca senha**; `eu.usuario` é `null`. Ele pode criar e promover (trilha
   `ator_tipo = 'operador'`), nunca é uma `Pessoa`. Nada nesta feature dá ao `Operador` uma linha em
   `pessoas`. A invariante da última administradora **vale para ele igual** (ele não tranca a
   clínica que viria destrancar).
8. **O `Usuário de Gestão` da carteira não tem nenhum caminho** para estas rotas (espaço de
   identidade disjunto, ADR 0012/0017). Teste de borda cobre **todas** as rotas, incluindo `DELETE`,
   `POST :id/senha`, `PATCH`, `PUT perfis` e `POST`.
9. **Recusa de privilégio é 403** com `codigo` estável; recusa de estado (última admin) é 422.

### 3.3 Trava de última administradora, e a corrida

- Continua **uma** tabela de regras (`podeDesativar`, `podeTrocarAcesso`, `podeExcluirPessoa`);
  admin inativa **não conta**.
- **Lock por clínica, tomado ANTES de qualquer leitura** do ator, do alvo e da equipe: `SELECT
  pg_advisory_xact_lock(hashtextextended('pessoas-acesso:' || clinica_id, 0))` no início da transação
  de **criar, editar, redefinir senha, excluir e salvar perfis** (clínica e painel). `FOR UPDATE` no
  alvo serializa duas escritas sobre a mesma linha, mas A rebaixando B enquanto B rebaixa A tocam
  linhas diferentes; o lock por clínica as serializa e a releitura do ator depois do lock faz a
  segunda recusar (ela já não é admin). Teste com **duas conexões** (duas admins se rebaixando ao
  mesmo tempo; duas criações simultâneas).
- **Medido no código (corrige a versão anterior deste spec):** o domínio **sempre recusa** a admin
  rebaixar **a si mesma** (`podeTrocarAcesso`, `NaoPodeTirarOProprioAdmin`, `pessoa.ts`), mesmo com
  duas ou mais admins. Quem tira a administração de alguém é **outra** admin. Este spec não altera
  isso. A admin também não se desativa nem se exclui.

### 3.4 Sessões

- **Rebaixar** (`admin true → false`), desativar e excluir **revogam todas as sessões vivas da pessoa
  na mesma transação.** Medido: hoje só desativar revoga (`escrita-de-pessoa.ts`, `editarPessoa`);
  rebaixar não. **Defeito real, corrigido no ticket 1.**
- Promover **não** revoga. Redefinir a senha revoga (já é assim).
- O privilégio de administração é lido **do banco a cada requisição**, nunca do cookie.
- `UPDATE` de pessoa só escreve quando algo muda (`IS DISTINCT FROM`): sem linha de trilha de
  no-op (A-14).

### 3.5 Auditoria

- Trigger `registrar_auditoria` (0004/0034) já grava quem, quando e de → para em `pessoas`, e já
  ignora UPDATE sem mudança. Exigido: a trilha distingue promoção e rebaixamento (`admin` de → para)
  com o ator real (pessoa ou `operador:<uuid>`); criar admin grava a linha com `admin = true`; a
  clínica vê a trilha; nenhuma senha entra na trilha nem em log (regra 21).
- **Registro de acesso (regra 18):** a criação de admin não lê dado clínico. Mas a admin nova (e o
  ator `operador` em suporte) passa a ter acesso a **toda** rota `@DadoSensivel`. **Verificado:** o
  `AcessoInterceptor` é global e registra pela rota (`marca`), com `contexto.ator` — pessoa ou
  operador — via `atorEmColunas`, sem olhar o papel; portanto a admin nova e o operador já são
  registrados como qualquer um. Teste de regressão no ticket 2. **Pendência registrada (não
  inventada aqui):** nenhuma ação desta feature adiciona rota nova de dado sensível.

### 3.6 Perfil padrão "Gestão de pessoas" e Minhas metas

- `perfisPadrao()` ganha `{ id: 'pf_ges', nome: 'Gestão de pessoas', perms: ['pessoas.gerir'] }`.
  **Só `pessoas.gerir`**, sem `valores`: a redação do salário segue o ponto único (regra 17).
  **Atenção, e a tela diz:** `pessoas.gerir` **inclui salário** (`PERMS`: "Dados de RH (inclui
  salário)"). O perfil aparece na matriz com o texto explícito **"Este perfil enxerga salário e dados
  de RH da equipe."** **Dívida** (a levar a `docs/dividas.md` pelo dono do arquivo): separar `pessoas.salario` de
  `pessoas.gerir`; gatilho: a primeira clínica que queira alguém de RH sem salário, ou a segunda
  pessoa com este perfil numa clínica.
- Quem tem `pessoas.gerir` e não é admin **não ganha** `config` (duas telas, dois públicos).
- **Clínicas existentes (P-2, decidida):** migration `0075` idempotente, `INSERT … WHERE NOT EXISTS`,
  considera perfis excluídos (`excluido_em`) e nome igual ativo, **não atribui a ninguém**, não
  recria o que a clínica apagou (regra 27). Rodada pelo papel dono (BYPASSRLS), por clínica, sem
  tocar RLS.
- **Minhas metas sem ficha de RH:** o estado `semFicha` **é** `temFicha: false` do contrato
  `MinhasMetas` (já existe e é testado; não se cria campo paralelo). A tela mostra: "Você ainda não
  tem ficha de RH. Quem cuida da equipe na clínica precisa criar a sua ficha para as metas
  aparecerem." Sem citar permissão nem nome de pessoa; o atalho "Ir para Equipe" aparece só para
  quem tem `pessoas.gerir`.

### 3.7 Aviso de administradora nova (P-3, decidida)

- Na tela Usuários e acessos, a linha de uma administradora **criada ou promovida nos últimos 30
  dias** traz "Criada/Promovida por X em dd/mm".
- **Só** o nome de quem fez e a data. O aviso sai do `GET /v1/pessoas`, que já é só de quem tem
  `config` (admin ou não): outros perfis não o recebem. Ações do `Operador` aparecem como **"Firmare
  (suporte)"**, nunca o nome ou o usuário dele.
- Some após **N = 30 dias**; **a trilha permanece** (o aviso é uma janela, não o registro).
- Fonte: a trilha `auditoria` (`pessoas`, `criou` com `admin = true`, ou `alterou` com `admin`
  `false → true`), a mais recente por pessoa. Sem coluna nova, sem canal externo.
- **Criação de admin é sinal de detecção** (documentado, não construído): uma admin nova fora do
  horário, ou duas no mesmo dia, é o sinal de conta comprometida (A-5). Quem monitora lê a trilha; o
  alerta ativo é dívida registrada, sem ser desta fatia.

### 3.8 LGPD: papéis, retenção e eliminação

- **Papéis.** A clínica é **controladora** dos dados do time e dos pacientes; a Firmare é
  **operadora**. O DPA prevê que **a clínica responde pelas administradoras que cria** (quem cria
  admin concede acesso total ao dado de saúde; a clínica escolhe e responde). A tela diz isso uma vez,
  na confirmação de "Administradora".
- **Retenção da ex-funcionária:** linha nova em `docs/compliance/retencao.md` (pessoa excluída ou
  inativa: dado cadastral e trilha de acesso mantidos pelo prazo; eliminação por pseudônimo).
- **Pseudônimo estável na trilha na eliminação:** ao eliminar a pessoa (pedido do titular), o nome e
  o usuário em `pessoas` são substituídos por um pseudônimo **estável** (`ex-pessoa-<8 hex do id>`);
  a trilha mantém `ator_id`, que continua ligando as ações sem identificar quem. A rotina de
  eliminação em si **não é desta fatia** (pendência registrada em `retencao.md`); esta fatia só
  documenta o contrato.

## 4. Desenho

- **domínio** (`packages/domain/src/pessoa.ts`): `AtorDeAcesso`, `podeConcederAdministracao`,
  `podeAgirSobre`, `podeConcederChave`, `podeAtribuirPerfil`, `podeEscolherSenhaDe`,
  `podeEditarMatrizDePerfis`, `ehRecusaDePrivilegio`. Puras, `Result`.
- **contrato** (`packages/contracts`): `CriarPessoaEntrada` com `acesso` discriminado ou o `perfilId`
  legado (expand/contract: removido por ticket próprio quando o web migrar); `PessoaCriada.admin`;
  `PessoaNaLista.avisoDeAdministradora`.
- **api**: `pessoas/acesso-do-ator.ts` (lock, releitura do ator, tradução 403/422);
  `PessoasService`, `AcessoService` e o `PainelPessoasService` usam o mesmo lock.
- **web** (`tela-usuarios.tsx`, `tela-minhas-metas.tsx`): "Administradora" na criação e edição só
  para admin (conveniência; o servidor é a barreira), confirmação ao promover/rebaixar, aviso na
  lista, texto do perfil "Gestão de pessoas", mensagem de Minhas metas.
- **banco**: sem coluna nova. Migration `0075` só para o perfil padrão.

## 5. Critérios de aceite (testáveis)

1. Admin cria uma pessoa admin: 201, `admin = true`, `perfil_id NULL`, provisória devolvida uma vez,
   `senha_provisoria = true`. O login seguinte exige troca.
2. Pessoa de perfil comum **com `config`** tenta criar admin, se promover, promover outra, rebaixar
   admin, redefinir a senha de admin, editar/desativar/reativar/excluir admin: 403. Nada muda
   (`SELECT`).
3. A mesma pessoa ainda cria, edita e redefine a senha de pessoa de **perfil comum cujas chaves ela
   tem**: 2xx. Perfil mais rico que o dela: 403 (escalada lateral).
4. Rebaixar a **última** admin ativa, por quem for (inclusive o Operador): 422
   `UltimaAdministradoraAtiva`. Desativar e excluir idem. Admin inativa não conta.
5. Duas admins, A e B, rebaixam-se mutuamente **ao mesmo tempo** (duas conexões, Postgres real): no
   máximo uma passa; ao final há pelo menos uma admin ativa. Duas criações simultâneas do mesmo
   `usuario`: uma 201 e uma 409, uma só linha.
6. Rebaixar ou desativar uma admin com sessão viva: a requisição seguinte com o cookie antigo é 401.
7. Sessão de suporte do Operador: cria admin, `ator_tipo = 'operador'` na trilha; assinatura e
   `POST /v1/eu/senha` recusados; `eu.usuario` é `null`; sem linha em `pessoas`.
8. Isolamento: admin da A não lista, cria, promove nem rebaixa na B; `perfilId` da B é 422/400.
9. `Usuário de Gestão`: 401 em todas as rotas de `/v1/pessoas`, inclusive `DELETE` e `:id/senha`.
10. Trilha: promover, rebaixar, criar admin e desativar aparecem com ator, data e `admin` de → para;
    a provisória não aparece em coluna alguma.
11. Usuário duplicado ao criar admin: 409 pelo índice.
12. `PUT /perfis` por **não-admin com `config`**: 403, matriz inalterada (P-1). Admin: 200.
13. `perfisPadrao()` devolve seis perfis; "Gestão de pessoas" tem exatamente `['pessoas.gerir']`;
    `temPerm` com `pf_ges` é verdadeiro para `pessoas.gerir` e falso para `valores`, `config`,
    `painel`.
14. Minhas metas de pessoa sem ficha devolve `temFicha: false` e a tela mostra a mensagem do 3.6.
15. Tabela de decisão de `podeConcederAdministracao`, `podeAgirSobre` e `podeConcederChave` coberta
    exaustivamente com fast-check.
16. Redefinir a senha de admin por admin **escolhendo** a senha: 403; sem escolher: 200 e gerada.
17. Migration `0075`: idempotente (rodar duas vezes não duplica), não recria perfil excluído, não
    cria se já houver perfil ativo com o mesmo nome, não atribui a ninguém.
18. Aviso: admin criada/promovida há ≤ 30 dias traz `avisoDeAdministradora` com só nome e data;
    ação do Operador sai "Firmare (suporte)"; depois de 30 dias some; quem não tem `config` não chega
    à rota.

## 6. Casos de abuso (para o appsec)

| # | Abuso | O que tem de acontecer |
|---|---|---|
| A-1 | Pessoa com `config` e perfil comum se promove a admin pelo `PATCH`. | 403, nada muda |
| A-2 | Mesma pessoa edita a matriz acrescentando `valores`/`pessoas.gerir`. | 403: `PUT /perfis` é só de admin (P-1) |
| A-3 | Pessoa de perfil comum redefine a senha de uma admin e entra como ela. | 403 |
| A-4 | Duas admins se rebaixam ao mesmo tempo. | No máximo uma passa (lock + releitura do ator) |
| A-5 | Admin comprometida cria admins persistentes (backdoor). | Trilha com ator e data; provisória com troca obrigatória; aviso na tela por 30 dias; sinal de detecção documentado |
| A-6 | Cookie de ex-admin rebaixada continua mandando. | 401 na requisição seguinte (revogação no rebaixamento) |
| A-7 | `clinicaId` no corpo. | 400 (`.strict()`); RLS recusa |
| A-8 | Perfil de outra clínica em `perfilId`. | 422/400 pela RLS |
| A-9 | `Usuário de Gestão` chamando `/v1/pessoas`. | 401 em todas as rotas |
| A-10 | Enumeração de `usuario` pelo 409. | Só a quem é `config`; índice é por clínica |
| A-11 | Operador troca a própria senha ou assina como pessoa. | Segue recusado |
| A-12 | Admin escolhe senha fraca ao redefinir. | `avaliarSenha` com contexto da alvo; para admin-alvo, só gerada |
| A-13 | Corpo ambíguo (`perfilId` e `acesso` juntos). | 400 |
| A-14 | Promoção por clique duplo ou replay. | No-op sem segunda linha de trilha (`IS DISTINCT FROM`) |
| A-15 | **Escalada lateral por perfil:** não-admin atribui a outra pessoa um perfil mais rico que o dela. | 403 `NaoConcedeChaveQueNaoTem` |
| A-16 | **Reativar admin inativa** por não-admin com `config`. | 403 |
| A-17 | **Não-admin edita nome/função de admin.** | 403 |
| A-18 | **`DELETE` de admin por não-admin.** | 403, admin intacta |
| A-19 | **Auto-atribuição** de perfil mais rico. | 403 `AutoAtribuicaoDePerfil` |
| A-20 | **Senha escolhida** para admin por admin. | 403 `SenhaDeAdministradoraSoGerada` |
| A-21 | **Criações simultâneas** do mesmo `usuario`/duas admins. | Uma só passa (lock + índice) |

## 7. Seams de teste (acordados na lista de `docs/arquitetura/sistema.md`; nada novo)

- **`packages/domain` puro** (Vitest + fast-check): as funções da seção 4 e `perfisPadrao`/`temPerm`.
- **HTTP da API + repositórios sobre Postgres real**: critérios 1 a 12, 16 a 18, incluindo as duas
  conexões. Estende `acesso.e2e.test.ts` e `pessoas.e2e.test.ts`; migration em `teste/`.
- **Contrato**: `CriarPessoaEntrada` (recusa ambíguo) e a saída de aviso.
- **Web** (varredura da fonte, como `excluir-pessoa.test.ts`; não há Testing Library na árvore).
- Não se mocka banco para a RLS, o lock nem a trilha.

## 8. Tickets (ordem de execução decidida pelo dono em 2026-11-10)

0. **Glossário** (`CONTEXT.md`): cadeia de criação, "Pessoa e Perfil", perfil "Gestão de pessoas".
1. **Fechar a escalada (já aberta em produção):** funções de domínio, aplicação em
   `PATCH`/`DELETE`/`:id/senha`/`PUT perfis`, P-1 (matriz só admin), lock, UPDATE `IS DISTINCT FROM`,
   **revogação ao rebaixar**, senha de admin só gerada. Testes A-1 a A-4, A-6, A-14 a A-20.
2. **Criar admin pela clínica:** contrato discriminado, `POST /v1/pessoas`, tela, registro de acesso
   da admin nova e do operador, `Usuário de Gestão`, duas conexões. Testes 1, 5, 7, 9, 10, 11.
3. **Perfil e aviso:** `pf_ges` + texto, migration `0075`, `avisoDeAdministradora`, Minhas metas,
   retenção, dívida `pessoas.salario`.
4. **Documentação e conferência:** AJUDA/MANUAL, `docs/paridade.md`,
   `docs/diferencas-versao-po-vs-nossa.md`. Deploy com backup; em produção só leitura.

## 9. Antes de ligar P-1 em produção (consulta de leitura, 4 clínicas)

Quem hoje é **não-admin com `config`** e edita a matriz de perfis **perde** essa capacidade. Rodar
**somente leitura** (papel de leitura, por clínica) e entregar o resultado à cliente antes do deploy:

```sql
SELECT c.codigo, p.nome, p.usuario, pf.nome AS perfil
  FROM pessoas p
  JOIN clinicas c ON c.id = p.clinica_id
  JOIN perfis pf ON pf.id = p.perfil_id
 WHERE NOT p.admin AND p.ativo AND p.excluida_em IS NULL
   AND 'config' = ANY (pf.perms)
 ORDER BY c.codigo, p.nome;
```

Quem aparecer ali perde só `PUT /perfis`, e ainda cria/edita pessoas de perfil que ela própria tem.
Se aparecer alguém, avisar a clínica e, se preciso, promover essa pessoa a administradora.

## 10. O que NÃO muda

- O Operador cria a clínica e a primeira administradora, e continua sendo a saída do "esqueci a senha"
  da única admin (D-10). Não perde o acesso total (D-5, D-13).
- `usuario` não se edita; ninguém lê a senha de ninguém; provisória 72 h com troca obrigatória.
- Não há `DELETE` físico de pessoa; desativar e excluir são estados (regra 20).
- A invariante de última administradora, o soft delete e a revogação de sessões.
- `temPerm` é uma função, e as dependências entre chaves vivem na tabela; o servidor sempre valida.
- A redação de valores e do salário (regra 17) e a aba Equipe continuam sob `pessoas.gerir`.
- Sessão de suporte: sem assinar, sem trocar senha, sem virar `Pessoa`, faixa dourada, 30 minutos.
- O `Usuário de Gestão` da carteira e o escopo da Firmare: espaços de identidade disjuntos.
- RLS por clínica, UTC no banco, nenhum campo monetário novo.
