# ADR 0024 — Um login só para a Firmare: o painel abre a Visão geral pela conta de gestão do operador

**Status:** aceita · 2026-11-08
**Origem:** D-23 item 6 (`docs/decisoes.md`), pedido do dono depois de testar o superadmin em produção, com o
protótipo do Firmare Gestão como referência ("precisa estar exatamente igual").
**Substitui, em parte:** a ADR 0011 na parte que tornava o painel um lugar sem dinheiro ("o painel trata
identidade e tenancy, nunca negócio", repetida em `redacao.interceptor.ts` e cobrada por
`superadmin/identidade.test.ts`). **O resto da ADR 0011 continua valendo.**
**Relacionadas:** ADR 0008 (painel e allowlist), ADR 0012 (RLS por grupo, `fir_carteira`), ADR 0022 e
ADR 0023 (segundo fator da carteira e a chave que o desliga).
**Divergência do protótipo:** nenhuma. O protótipo não tem superadmin; a tela que abre é a `vPainel`
dele, sem mudança.

## Contexto

A Firmare tem duas portas: o painel do superadmin (`/superadmin`, identidade e tenancy) e a carteira
comercial (`/carteira`, a Visão geral do protótipo, os clientes, as mensalidades). Quem opera o painel é
a própria diretoria da Firmare — a mesma gente que precisa da Visão geral com MRR. Com duas contas e
duas senhas, o dono entrava no painel e não via a carteira, ou criava para si um `Usuário de Gestão`
geral à mão, que ninguém mais saberia que era dele.

O pedido: todo superadmin tem automaticamente uma conta de gestão no Grupo Firmare; entrar em
`/superadmin` abre a Visão geral com todas as clínicas; o menu traz também Clínicas, Grupos e Usuários de
gestão. "O painel passa a ver dinheiro."

## Decisões

### 1 · A `Conta de gestão do operador` — provisionada pelo banco, uma por operador

Migration `0061`. Tabela `contas_de_gestao_do_operador (operador_id UNIQUE, usuario_gestao_id UNIQUE)`,
um para um nos dois lados. A conta é um `Usuário de Gestão` comum na forma, com quatro diferenças, todas
impostas no banco:

- **Nasce com o operador, na mesma transação**, por gatilho `AFTER INSERT ON operadores`. Operador
  nasce pelo break-glass da VPS (`redefinir-superadmin.sh`, `psql` como `fir`) ou pelo `INSERT` dos
  testes: nenhum dos dois é código da API, e provisionar na aplicação deixaria o primeiro operador de
  cada ambiente sem conta. **Backfill** na própria migration, inclusive para operador desativado.
- **Perfil fixo:** `escopo='geral'`, sem grupo, Diretoria (as nove telas, `valores`, `carteira =
  'todos'`, `administrar`, `setor = 'diretoria'`). Um gatilho `BEFORE UPDATE ON usuarios_gestao`
  recusa, para a conta vinculada, mudar privilégio, senha, provisória, ou `ativo` diferente do do
  operador (`check_violation`, constraint `conta_de_gestao_do_operador_fixa`, para a API traduzir em
  409 sem casar texto).
- **Sem senha própria.** `senha_hash` é um Argon2id bem formado de bytes aleatórios: nenhuma senha
  confere, e o login da carteira roda o Argon2 inteiro, como para qualquer conta. O gatilho acima
  impede que alguém lhe dê uma senha depois — sem isso, uma senha provisória dada pela tela de usuários
  de gestão abriria a conta mais poderosa da carteira pela porta `/carteira/entrar`, fora da allowlist
  de IP do painel (ADR 0008).
- **Acompanha o operador:** desativar o operador desativa a conta e revoga as sessões dela na mesma
  transação (`AFTER UPDATE OF ativo, nome ON operadores`); reativar (o break-glass reativa) reativa. O
  nome acompanha.

**F-1 (identidade só pelo painel) continua de pé:** `fir_carteira` e `fir_painel` só LEEM o vínculo;
quem escreve são as funções `SECURITY DEFINER` da 0061, disparadas pela escrita em `operadores`, que é
identidade do painel. A guarda da migration confere os privilégios em vez de presumi-los.

### 2 · Entrada única: o login do painel abre também a sessão da carteira

`POST /v1/superadmin/entrar`, com a senha certa, grava `__Host-fir-painel` **e** `__Host-fir-carteira`.
A sessão da carteira é da conta vinculada, com **a mesma duração da sessão do painel** (8 h, no cookie e
no banco), e nasce pela conexão `fir_carteira` (`CarteiraService.abrirSessaoDaContaDoOperador`) — a 0055
proíbe `fir_painel` de criar sessão de carteira, e continua proibindo.

- **Senha provisória não abre a carteira.** A provisória só pode deixar de ser (`PainelGuard`); a
  carteira não teria esse freio para esta conta.
- **`POST /v1/superadmin/eu/conta-de-gestao`** reabre a sessão da conta a quem já está no painel: depois
  da troca da provisória, depois de a sessão da carteira vencer, ou depois do "Sair" de dentro da
  carteira. A sessão do painel é a prova; o corpo é vazio. 204 com o cookie; 404 sem conta ativa.
- **`POST /v1/superadmin/sair` encerra as duas:** revoga toda sessão viva da conta vinculada (não só a
  do cookie da requisição — ela só tem sessão aberta pelo painel) e limpa os dois cookies. Mesmo
  raciocínio das sessões de suporte: "Sair" é a intenção de largar a credencial.
- **Trilha:** a abertura vai para `auditoria_do_painel` com o OPERADOR como ator e a conta como
  entidade (`acao = 'entrou'`). O que a conta fizer depois vai para as trilhas da carteira como
  `usuario_gestao:<id>`; o vínculo liga os dois.

### 3 · A regra que muda: o superadmin vê dinheiro — pela carteira, nunca pelo painel

O que esta ADR substitui da ADR 0011 é a frase "nenhum dinheiro atravessa o painel", **para o
superadmin**. O que fica, e é cobrado por teste:

- **As rotas `/v1/superadmin/*` continuam sem dinheiro.** O `RedacaoInterceptor` decide pelo espaço da
  ROTA (A-2), e o espaço `operador` continua negando `valores` — mesmo com o cookie da carteira na
  mesma requisição. Prova: `conta-de-gestao-do-operador.e2e.test.ts`, "as rotas do PAINEL continuam sem
  dinheiro".
- **O dinheiro chega por `/v1/carteira/*`, sob a sessão da carteira**, redigido pelo perfil da conta
  (`temPermCarteira(perfil, 'valores')`), como para qualquer `Usuário de Gestão`.
- **A tela do painel não formata dinheiro por conta própria.** `/superadmin` renderiza o MESMO
  componente de `/carteira` (`components/carteira/visao-geral.tsx`), e esse componente só chama rotas
  `/v1/carteira/*`. `superadmin/identidade.test.ts` cobra as três coisas.

Os links de dentro da Visão geral (ficha do cliente, rotina, prospecção, entrada de cliente) levam a
`/carteira/...`: é a sessão da carteira que os abre. O menu do painel traz, nesta ordem, Visão geral,
Gestão da carteira (`/carteira`), Clínicas, Grupos, Usuários de gestão.

### 4 · A entrada única não contorna o segundo fator

Hoje o segundo fator da carteira está desligado (ADR 0023). **Se `SEGUNDO_FATOR_CARTEIRA_LIGADO` for
ligada:**

- o login do painel **não abre** a sessão da carteira, e `POST /v1/superadmin/eu/conta-de-gestao`
  responde **409 `CONTA_DE_GESTAO_COM_SEGUNDO_FATOR`** (código próprio, e não o `SEGUNDO_FATOR_CARTEIRA`
  do guard: a tela desvia aquele para o cadastro do TOTP, e esta conta não tem como entrar pelo
  desafio — não tem senha);
- uma sessão aberta antes de a chave ser ligada nasceu sem `segundo_fator_em`, e o
  `SegundoFatorDaCarteiraGuard` a trata como qualquer sessão sem código: 409 em toda rota de dado.

Os dois estão no e2e. **O preço é explícito:** com a chave ligada, o superadmin perde a Visão geral pelo
painel. O caminho para ter as duas coisas é segundo fator **no painel** (a dívida D3a, que já cobra
isto por outra razão: o operador é o teto da segurança), e então a sessão da conta nasce verificada
porque a do painel nasceu. Nunca o contrário — marcar a sessão da conta como verificada sem segundo
fator nenhum seria o contorno que esta decisão proíbe.

## Alternativas rejeitadas

**O painel ler a carteira pelas próprias rotas (`/v1/superadmin/visao-geral`).** Rejeitada: seria a
segunda implementação da Visão geral, com a redação decidida no espaço `operador`, e a primeira rota do
painel a carregar dinheiro — exatamente o endpoint número quarenta que a regra 17 teme. Pela conta de
gestão, a mesma rota, o mesmo perfil e o mesmo interceptor servem as duas portas.

**`Operador` com escopo de carteira (um `if (req.painel)` no `CarteiraGuard`).** Rejeitada pela mesma
razão que a ADR 0011 rejeitou estender `Operador` com `grupo_id`: dois sistemas de autorização num ator
só. A conta de gestão é um ator da carteira, com o perfil da carteira, autorizado pelo guard da carteira.

**Provisionar a conta no código da API.** Rejeitada: operador não nasce pela API (ver decisão 1), e o
`firmare.admin` de produção ficaria sem conta até alguém lembrar de um script.

**Dar à conta uma senha (a do operador, ou uma própria).** Rejeitada: duas portas para a mesma
credencial, e a segunda fora da allowlist do painel.

## Consequências

- **Produção:** a 0061 cria a conta de todo operador existente (o `firmare.admin` inclusive) no deploy.
  O nome de usuário da conta é o do operador; se já houver um `Usuário de Gestão` com esse nome (alguém
  criou uma conta geral à mão para o dono), a conta do operador nasce com `.op1` e a manual fica intacta
  — vale desativá-la depois, à mão, se ela era o remendo que esta ADR substitui.
- **A conta aparece na lista de usuários de gestão** e em toda lista de responsáveis/equipe da
  carteira, como qualquer diretoria. Editá-la pela tela é recusado pelo banco (409 a traduzir na rota de
  edição e na de senha provisória do painel).
- **Tela nova da carteira** (um décimo módulo) exige acrescentá-lo às contas vinculadas e a
  `conta_de_gestao_do_operador_fixa()` na mesma migration; o comentário da 0061 diz isso.
- **P-10/P-12:** o operador já via dado agregado de carteira como Operador nas listas do painel, sem
  dinheiro; agora vê o agregado com dinheiro. Ele é a diretoria da Firmare, dona da carteira — não é
  dado de clínica de terceiro, e a base é a mesma da ADR 0013. Nada de dado operacional de paciente
  atravessa.
