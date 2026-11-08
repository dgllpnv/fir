# Decisões do produto

Índice das escolhas do dono, com data. **Uma decisão registrada aqui não se re-litiga em conversa** — se mudou, registre a mudança com a data nova e a razão.

---

## D-1 · Stack: espelhar o Mavia · 2026-10-23

Monorepo TypeScript — pnpm + Turborepo, NestJS + Fastify na API, Next.js (App Router) na web, PostgreSQL com Drizzle, RLS multi-tenant, BullMQ/Redis.

**Por quê:** o padrão já está rodando em produção no Mavia, com time de agentes, CI, Dockerfiles e procedimento de deploy provados. Reaproveitar reduz o risco de infraestrutura a quase zero e deixa a atenção onde ela precisa estar — no domínio, que aqui é mais intrincado que o do Mavia.

**Consequência:** as convenções do Mavia valem aqui por padrão, e divergir delas exige razão. O que **não** se copia é o domínio: dinheiro em centavos é a mesma regra, mas fatura, parcelamento e Open Finance não existem neste produto, e estoque, dose e lote não existem naquele.

---

## D-2 · Prioridade: paridade com o protótipo e migração das 4 clínicas · 2026-10-23

A primeira entrega é o sistema novo com paridade funcional ao `prototipo-rotinas-de-gestao.html`, e a migração das quatro clínicas que hoje rodam na v20.

**Por quê:** é o que tem prazo real (implantação de novembro) e é o que a PO já especificou por inteiro. Construir feature nova antes da paridade deixa quatro clínicas em produção sobre Google Sheets por mais um ciclo.

**Consequência:** escopo que atrasa a paridade passa pelo `product-rotina-clinica` e a decisão é do dono. O protótipo tem autoridade: divergir dele é decisão de produto e vira ADR.

---

## D-3 · Autenticação: e-mail e senha, por pessoa · 2026-10-23

Login por e-mail e senha individual. Hash Argon2id, sessão opaca com expiração e rotação de refresh, limite de tentativas, cookie `__Host-` com `Secure` e `HttpOnly`.

**O PIN de 4 dígitos da v20 sai, e não volta como credencial primária.** Nome mais PIN em texto puro, enviado em toda requisição, sem limite de tentativas, é o item de maior risco do produto atual (limitação 1 do documento de passagem).

**O custo foi assumido com ele à vista.** Três pessoas que hoje compartilham o computador do balcão passam a logar e deslogar. A alternativa recomendada — PIN como troca rápida dentro de um aparelho já autenticado — **foi oferecida e recusada**.

**Consequência operacional, e ela precisa de resposta antes da implantação:** sem troca rápida, ou a sessão é longa e o computador do balcão fica logado numa pessoa só (e a trilha de auditoria registra a pessoa errada), ou a equipe digita senha dezenas de vezes por dia (e ela vira um papel colado no monitor). **Isto é pendência aberta de UX de sessão**, e o `product-rotina-clinica` com o `especialista-seguranca-appsec` precisam resolvê-la — tempo de sessão, bloqueio de tela, reautenticação rápida — antes do épico 1 fechar.

**TLS deixa de ser opcional:** o cookie `__Host-` exige `Secure`, e navegador nenhum aceita cookie `Secure` sobre `http://` fora de `localhost`. Servir sem HTTPS não é degradação — é o login não existir.

---

## D-4 · Hospedagem: mesma VPS do Mavia, ao lado · 2026-10-23

Containers Docker comuns na VPS que já roda o Mavia e outros negócios, descobertos pelo Traefik do EasyPanel **por label**, com Postgres próprio e rede de dados sem rota de saída. **Ao lado da orquestração do EasyPanel, nunca dentro dela.**

**Por quê:** custo marginal próximo de zero e procedimento já provado em `infra/producao/` do Mavia, incluindo as três armadilhas registradas lá.

**Consequências assumidas:**
- O disco e a CPU são compartilhados com produção de outros negócios. Builds rodam com `nice`, e disco cheio é alerta em 70%.
- Um incidente de host alcança os dois produtos ao mesmo tempo. O isolamento entre eles é de container e de rede, não de máquina.
- **Dado de saúde de paciente passa a morar na mesma VPS que dado financeiro de outro produto.** O `especialista-lgpd-saude` precisa registrar isso na avaliação de impacto, e a decisão de hospedagem no Brasil (abaixo) interage com ela.

---

## D-5 · Auditoria de todas as ações, e o superadmin que troca de clínica · 2026-10-24

**Toda ação registrada numa trilha append-only.** Visível ao administrador da clínica (as próprias) e ao superadmin (as de qualquer clínica, trocando a visualização).

Isso não é feature nova — é o que o `CLAUDE.md` já exigia e a fundação não construiu: a regra 20 pede trilha append-only em toda escrita financeira, de estoque e de RH, e a regra 18 pede **registro de acesso, não só de escrita**, porque dose, produto e lote por paciente são dado sensível do art. 11.

**Consequência de prazo, e ela é a parte que importa:** a trilha precisa existir **antes do Plano 2**. Todo plano seguinte escreve dado; retrofitar auditoria em oito planos de código é fazer oito vezes o mesmo trabalho, e numa tabela append-only não há como recuperar o que não foi gravado. Vira um plano curto entre a fundação e as tarefas.

### Restrições que tornam o superadmin seguro — e sem as quais ele destrói o isolamento

O "trocar de clínica" é o caminho mais tentador para desfazer a RLS que sustenta o produto. Estas condições não são sugestão:

1. **O superadmin não é uma `pessoa`.** Identidade separada, tabela própria, cookie próprio, prefixo de rota próprio. Um booleano `superadmin` em `pessoas` já perderia o modelo: a mesma sessão passaria a poder sair do próprio tenant.
2. **Trocar de clínica não é um seletor que muda uma variável.** É uma **concessão** registrada: qual operador, qual clínica, quem autorizou, até quando, e por quê. A sessão do painel só resolve para clínica com concessão viva.
3. **Toda leitura do painel grava na mesma trilha que a clínica enxerga.** "Quem olhou meus pacientes" tem de ser respondível **pela clínica**, não só por nós. É isso que separa acesso de suporte de acesso arbitrário.
4. **A clínica pode revogar.**
5. **Duas conexões de banco separadas por autenticação, não por `SET ROLE`** — `RESET ROLE` desfaz na mesma transação, e aí a leitura vira escrita sem nada além da disciplina impedindo.
6. **Allowlist de rede na frente do controle de aplicação, falhando fechada.** O padrão de `infra/producao` do Mavia: as regras do produto e do painel são disjuntas, de modo que, se o middleware não puder ser construído, o painel vira 404 em vez de ficar aberto.
7. **O superadmin nunca atravessa a RLS por conveniência.** Ele fixa `app.clinica_id` da clínica concedida, como qualquer um. Nada de `BYPASSRLS` para a aplicação.

### O que isso custa, e por que vale

Um seletor de clínica no painel custa uma tarde. Esta versão custa alguns dias. A diferença aparece no dia em que uma clínica perguntar quem viu o prontuário dos pacientes dela — e a LGPD dá a ela o direito de perguntar. Nós somos **operadores**, a clínica é controladora: acesso nosso a dado de saúde dela precisa de base legal no contrato de tratamento, justificativa por acesso e prazo. Sem isso, é operador excedendo o mandato.

Leve ao `especialista-lgpd-saude` antes de implementar, e à minuta de DPA (pendência P-3).

### O que fica para o épico 12

A gestão de **pessoas dentro de uma clínica** (criar, convidar por e-mail com token de uso único, desativar, trocar perfil) é pequena e independente: o `admin` da clínica e a permissão `config` já existem, `pessoas.ativo` já existe, e falta a tela e as rotas. Pode vir a qualquer momento.

O **painel do superadmin** é o épico 12, e está no fim do roadmap por causa das sete condições acima — não por falta de importância.

---

## D-6 · O total do caixa não aparece antes do fechamento · 2026-10-24

Na tela **Recebimentos**, o somatório por forma de pagamento **não é devolvido pelo servidor** enquanto o caixa do dia estiver aberto. A lista de recebimentos individuais continua visível; só o agregado espera o fechamento.

**Por quê:** conferir o caixa é contar o dinheiro **sem saber o número**. Quem vê "esperado R$ 1.250" e conta R$ 1.180 procura o erro na contagem até fechar — e a conferência deixa de medir qualquer coisa. É a regra 6, e ela é invariante de **transporte**, não de tela.

**Diverge do protótipo**, que mostra "Total recebido hoje · Pix R$ 450" o tempo todo. Vira ADR.

**A alternativa foi oferecida e recusada:** manter a tela dela e deixar a cegueira valer só para quem não tem a permissão `valores` — hoje a Recepção, que é quem conta. Recusada porque transforma a proteção em **configuração de perfil**: basta alguém dar `valores` à recepcionista um dia, e a conferência morre sem ninguém perceber. O dono escolheu a proteção estrutural.

**Consequência assumida:** quem tem `valores` deixa de ver o total do dia na hora. Depois do fechamento, aparece tudo.

---

## D-7 · Quem cria tarefa pode buscar paciente · 2026-10-24

Criar tarefa é liberado a todos, e **a busca de paciente para vincular também** — por uma rota estreita, que devolve **só nome e telefone**. Nada de valores, LTV, saldo, histórico ou origem.

**Por quê:** a recepcionista que atende o telefone precisa vincular a tarefa à paciente certa. Sem isso ela cria tarefa solta e alguém vincula depois — retrabalho, e tarefa órfã é exatamente o que suja o funil.

**O cuidado que a decisão exige:** **não** abrir a rota `GET /v1/pacientes` existente, que devolve LTV e saldo. Rota nova, estreita, com `@DadoSensivel` nenhum (busca não vira 200 linhas de trilha, pela mesma razão da listagem). A permissão `pacientes` segue valendo para a tela Pacientes, a ficha e tudo o mais.

**É dado pessoal de paciente**, e a decisão foi do dono com isso dito.

---

## D-8 · Programa com sessão paga não se exclui · 2026-10-25

Excluir um programa que tenha **sessão realizada e paga** é **recusado** (409), com a mensagem dizendo as duas saídas: *encerrar* o programa, ou *estornar* o pagamento antes.

**Diverge do MANUAL dela** (cap. 8, *"Encerrar ou excluir um programa"*), que manda apagar programa, sessões e pagamentos juntos. Vira ADR.

**Por quê:** o épico 2 já recusa excluir tarefa com recebimento, pela mesma razão — a receita de um mês fechado não muda sozinha. A alternativa (estorno em cascata) deixaria uma pessoa com permissão de excluir **alterar a receita de um mês já fechado com um toque**. A trilha registraria, mas o dinheiro já teria saído do relatório, e quem confere o mês descobriria depois.

**O que torna a recusa barata:** *encerrar* já faz o que a clínica quer na prática — o programa sai da lista ativa e para de gerar sessão. *Excluir* existe para cadastro errado, que por definição ainda não tem pagamento.

---

## D-9 · Programa sem entrada abre saldo · 2026-10-26

> **⚠️ CORREÇÃO, 2026-10-26, no mesmo dia.** A premissa com que esta decisão foi
> apresentada ao dono **estava errada**, e a correção é minha. Eu disse que *"o
> protótipo aceita entrada zero"*. **Ele não aceita.** Medido na fonte dela: a tela
> de recebimento exige valor (*"Informe o valor recebido"*), e o caso "não pagou"
> tem caminho próprio (*"Informe o valor pago (ou marque 'Não')"*) — não é um zero.
> O primeiro relatório leu aquele caminho como "aceita zero", e eu repassei sem
> conferir na fonte.
>
> **O que isso muda, e o que não muda.** `MontarPrograma` **continua recusando**
> `valorEntrada: 0` — paridade com ela, e há teste. O que a decisão de fato
> entregou foi a **forma da linha**: `valor = 0` com `valor_aberto > 0` passou a ser
> representável, e é disso que o modo **saldo** precisa, onde a sessão paga abate
> um valor em aberto. A decisão continua válida; a justificativa é que estava errada.

A clínica fecha um programa de R$ 3.600 e a paciente fica devendo. A representação desse saldo exige uma linha com **valor recebido zero e valor em aberto positivo** — e o `CHECK (valor > 0)` de `recebimentos` a tornava impossível.

O `CHECK (valor > 0)` de `recebimentos` impedia isso: sem entrada não havia linha, e sem linha não havia dívida registrada.

**Decisão:** `CHECK (valor > 0 OR valor_aberto > 0)` — a linha é aceita quando registra **alguma coisa**, dinheiro recebido **ou** dinheiro devido.

**Por que esta formulação e não `valor >= 0`:** aquela aceitaria uma linha completamente vazia. Esta é **mais restritiva** que o original em um sentido (nenhuma linha pode ser vazia) e mais permissiva só no caso que a clínica precisa.

**Escolhida pelo dono em 2026-10-26** — sobre a premissa corrigida acima. A premissa que ele afirmara na mesma data era: *"o protótipo funcional dela é o parâmetro principal, deve seguir o mesmo comportamento funcional"*. As alternativas eram (a) montar o programa sem valor — que **faz a clínica perder um recebível**, porque vendeu R$ 3.600 e o sistema registra zero — e (c) guardar o valor em aberto fora de `recebimentos`, que faria o saldo vir de duas fontes quando a regra 5 existe para ele vir de uma.

**Condição inegociável, e sem ela a decisão não vale:** a linha de valor zero **não pode aparecer** no caixa do dia, na lista de recebimentos do dia, nem no LTV do paciente. Três filtros, três testes, escritos **antes** do código. Uma venda a prazo não é dinheiro que entrou no caixa.

**Reversível:** se o dono preferir (a) ou (c), a migration de volta é pequena enquanto nenhuma clínica tiver migrado.

---

## D-10 · Usuário e senha, sem e-mail. O superadmin cria os admins · 2026-10-27

**Substitui a D-3 na parte do identificador.** O login passa a ser **clínica + usuário + senha**. Não há e-mail em lugar nenhum.

**A cadeia de criação:**

```
superadmin  →  cria a clínica e o admin dela
admin       →  cria as pessoas da clínica, com usuário e senha
```

**O superadmin tem acesso total** e pode criar qualquer perfil para qualquer clínica.

### Por que, e o que isso destrava

Tira duas pendências do caminho crítico de uma vez: **P-9 (SMTP)** deixa de bloquear qualquer coisa, e **P-8 (domínio)** deixa de bloquear o e-mail — sobra só como questão de confiança e marca. Era a cadeia que travava a primeira clínica entrar.

**E aproxima do protótipo, não afasta.** O modelo dela é exatamente este: a pessoa diz quem é, digita um segredo curto, e quem administra gerencia. Foi o e-mail que foi acréscimo nosso.

### O que vem de graça, e vale dizer

**Menos dado pessoal coletado.** Num produto que guarda dado de saúde, não pedir e-mail da equipe é uma linha a menos na avaliação de impacto. E `tentativas_login` passa a guardar um nome de usuário em vez de um e-mail — menos PII na trilha.

### Esqueci a senha — a cadeia inteira

| Quem esquece | Quem resolve | De onde veio |
|---|---|---|
| Pessoa da clínica | **o admin da clínica redefine** | Protótipo, AJUDA: *"Peça ao administrativo da clínica"* |
| Admin da clínica | **o superadmin redefine** | Segue da cadeia de criação |
| Superadmin | **comando na VPS**, por quem tem SSH, gravado na trilha | Não existe no protótipo. A v20 tem a planilha central que o dono edita direto; o equivalente moderno é o comando |

**Melhoria sobre ela, e é inegociável:** na v20 e no protótipo o admin **vê** o PIN de cada pessoa. Aqui ele **redefine e nunca vê** — a senha é hash desde o primeiro dia. Ver a credencial de outra pessoa é o defeito que a D-0 descreve na v20.

**Senha definida na criação é provisória**, e a pessoa é obrigada a trocar no primeiro acesso. Depois de criada, ninguém a lê de novo — nem quem a digitou.

### O que fica mais perigoso, e precisa de resposta no plano

**Nome de usuário é adivinhável de um jeito que e-mail não era.** `recepcao`, `ana`, `admin` — com o código da clínica conhecido, o espaço de busca encolhe muito. O que já temos passa a valer mais, não menos: limite por conta, **limite por origem**, piso de tempo igualado, e Argon2id. **O plano precisa acrescentar exigência de senha forte** — era aceitável depender do e-mail ser desconhecido; não é mais.

### O superadmin: o que muda e o que NÃO muda da D-5

**Muda:** ele não espera concessão da clínica para existir. Ele **cria** o admin dela — exigir autorização prévia de quem ainda não existe seria absurdo.

**Não muda, e isto é o que nos protege:** ele continua **não sendo uma `pessoa`** (tabela, cookie e prefixo de rota próprios); **toda ação dele vai para a trilha que a clínica enxerga**; a allowlist de rede continua na frente, falhando fechada; e ele **nunca atravessa a RLS** — fixa `app.clinica_id` como qualquer um.

A formulação que vale: **o acesso é total; o registro é obrigatório.** A clínica não pode nos barrar, mas pode nos **ver**. É isso que, com o DPA (P-3), separa acesso de operador de acesso arbitrário.

### Emenda, no mesmo dia: duas coisas que eu tinha deixado em silêncio

**1. A D-5 restrição 4 dizia "a clínica pode revogar". Com a D-10, ela não pode — e isso precisa ser decisão escrita, não omissão.** Eu listei o que *não muda* e simplesmente não mencionei a 4; lido de fora, parece esquecimento.

A razão de não poder: o superadmin **cria** a clínica e o admin dela. Uma clínica que revoga o acesso de quem a provisiona tranca a si mesma fora de qualquer suporte, e tranca a nós fora de um sistema que operamos. O `Code.gs` concorda por analogia — na v20 o dono edita a planilha central e as clínicas não têm voz nisso.

**O que a clínica tem, em troca, e precisa estar no DPA (P-3):** ela **vê tudo** o que fazemos, na trilha dela, sem pedir; e ela pode **encerrar o contrato**, o que encerra o tratamento. Controlador revoga operador rescindindo, não cortando acesso individual enquanto usa o serviço.

**2. A trilha do próprio operador não tinha onde morar.** `auditoria.clinica_id` é `NOT NULL`, e "operador criado", "senha de operador redefinida pela VPS" e "operador entrou" não pertencem a clínica nenhuma — e a clínica sentinela já foi recusada por escrito na migration `0002`.

**Regra de repartição, em uma frase:** o que toca dado **de uma clínica** vai para a `auditoria` dela, com `ator_tipo = 'operador'`; o que é **sobre operadores** vai para `auditoria_do_painel`.

**3. Quem cria o superadmin nº 1** é o mesmo comando de break-glass na VPS — e ele **avisa quando houver menos de dois ativos**. Um superadmin só é um ponto único de falha com nome bonito.

---

## Decisões tomadas pela construção, e que o dono pode derrubar

Não são escolhas dele — são divergências do protótipo que a engenharia tomou com
razão escrita, no espírito do *"decida com base no comportamento do protótipo; só
pergunte quando ele não responder"*. Ficam aqui porque **mudam quem pode o quê**
ou **o que a equipe vê**, e porque derrubá-las é de uma linha.

### E-1 · A entrada pela NOTA exige `estoque.gerir`; a entrada à mão, não · 2026-11-01

O protótipo deixa qualquer perfil com acesso ao estoque lançar a nota. Aqui
`POST /v1/estoque/notas` e `POST /v1/estoque/notas/ler` exigem `estoque.gerir`.

**Por quê:** a nota **carrega custo**, e custo é dinheiro — é a mesma razão pela
qual `movEstoque` já recusa o campo `custo` de quem não tem a chave, e pela qual
a redação de valores existe (regra 17). O XML traz o preço unitário de cada
produto, e quem lê a nota lê a tabela de compras da clínica.

**O que NÃO muda:** lançar entrada sem custo continua sendo
`POST /v1/estoque/movimentos`, que a enfermagem pode. A recepcionista que recebe
a caixa continua registrando o que chegou.

**Como derrubar:** tirar `@Exige('estoque.gerir')` das duas rotas e gatear o
campo `custo` linha a linha, como `movEstoque` faz. Meia hora, com teste.

### E-2 · A nota fiscal já registrada responde 200, não erro · 2026-11-01

O protótipo responde `fail("Esta nota já foi registrada.")`. Aqui a segunda e a
terceira importação do mesmo arquivo respondem **200 com os mesmos movimentos e
`jaRegistrada: true`**.

**Por quê:** é o que a regra 26 pede de uma escrita externa idempotente — e é o
que a recepção precisa. Um vermelho não diz se o estoque entrou; a resposta com
os movimentos diz.

**Como derrubar:** trocar o retorno por `409` no mesmo ponto
(`notas.service.ts`, o ramo `jaRegistrada`). A tela já tem a frase.

---

## D-11 · A VPS fica onde está — Boston, Estados Unidos · 2026-11-02

Medido por acesso direto: `srv1647618.hstgr.cloud`, Boston/Massachusetts, Hostinger (AS47583). 4 vCPU, 15 GiB, 27 containers de produção, **137 ms de ida e volta até o Brasil**.

**Decisão do dono, tomada com a consequência à vista:** fica lá. A alternativa — VPS própria em São Paulo, que resolveria latência e transferência internacional de uma vez — foi apresentada e recusada.

**A pendência P-2 fecha aqui.** Não some: vira obrigação de contrato.

### O que isso obriga, e não é opcional

Guardamos **dose, lote e procedimento por paciente** — dado sensível do art. 11. Hospedar fora do Brasil é **transferência internacional** (LGPD arts. 33–36), e os Estados Unidos **não têm decisão de adequação da ANPD**. Logo:

1. **O DPA (P-3) precisa de cláusula de transferência internacional**, com garantias contratuais específicas. Sem ela, o contrato está incompleto — e é a **clínica**, como controladora, que responde perante as pacientes dela.
2. **A avaliação de impacto registra o país e a base legal.**
3. **A clínica precisa saber.** Uma clínica bem assessorada pergunta; melhor que a resposta já esteja escrita.

Isto **não re-litiga a decisão**. É o que a torna defensável.

### O que a decisão obriga do lado técnico

137 ms por ida e volta significa que **o custo não é a tela, é o número de requisições do navegador**. A arquitetura já protege em parte: o Next roda **na VPS**, e a conversa dele com a API e com o Postgres é local. Quem paga os 137 ms é só o salto navegador → VPS.

**Por isso a regra passa a ser:** tela de rotina resolve o que puder **no servidor**, numa resposta só. Cada `fetch` do cliente custa 137 ms, e três deles em sequência são meio segundo antes de a recepcionista ver qualquer coisa.

---

## D-12 · A clínica vem do link; nenhuma rota pública lista clínicas · 2026-11-02

**O pedido:** na tela de entrada, clicar e abrir um menu com as clínicas cadastradas, em vez de digitar o código.

**O custo apresentado:** o menu exige uma rota que responde **antes de qualquer autenticação**. Ela publica a lista de clientes do produto e tira **um dos dois desconhecidos** da credencial — hoje é clínica + usuário + senha; viraria usuário + senha, e usuário é adivinhável (`recepcao`, `ana`). É a classe do `equipePublica` da v20, que removemos de propósito.

**A decisão, com o custo à vista:** **não** haverá rota pública de clínicas. No lugar, as duas coisas que a recepção de fato usa:

1. **`/entrar?clinica=CODIGO` pré-seleciona a clínica** e recolhe o campo. É como as quatro clínicas já entram (cada uma tem o próprio link no `GUIA-INSTALACAO.md` da v20), e a recepcionista nunca digita o código. Sem o parâmetro, a tela segue como hoje: campo de texto.
2. **O seletor com a lista vai para o painel do superadmin** — autenticado e atrás da allowlist de IP do escritório. Busca por digitação, teclado completo, escrito para quarenta clínicas.

**O que isso obriga:** a lista do painel devolve o **mínimo** (`id`, `codigo`, `nome`, `fuso`, `ativa`) e nada que revele tamanho. `criadaEm` saiu — atravessava a resposta e nenhuma tela a mostrava.

**Como derrubar:** não derrube por conveniência. Dois testes seguram a decisão: *"devolve o MÍNIMO"* (`painel-clinicas.e2e.test.ts`) e *"nenhuma rota pública menciona CLÍNICA no caminho"* (`teste/rotas-protegidas.test.ts`). Ver [ADR 0010](adr/0010-clinica-vem-do-link-e-nenhuma-rota-publica-lista-clinicas.md).

---

## D-13 · O superadmin entra no sistema da clínica logado — a sessão de suporte · 2026-11-02

**O pedido:** no painel, a coluna *Sistema* abria `/entrar?clinica=CODIGO` numa aba nova e a pessoa digitava credencial de novo. O dono quer **clicar e já entrar no sistema da clínica, logado como superadmin, com privilégio de administradora e vendo tudo**.

**O que muda:** a sessão do produto passa a poder carregar um **`Operador`** em vez de uma `Pessoa`. `sessoes.pessoa_id` ficou anulável, entrou `operador_id`, e um `CHECK` exige **exatamente um dos dois** (migration `0022`, forward-only, expand puro). É a *sessão de suporte*: uma linha de `sessoes` comum, na clínica dela, com outro sujeito.

### Os cinco invariantes, e nenhum é negociável

1. **O operador NUNCA vira uma `pessoa` da clínica.** Nenhum `INSERT INTO pessoas` acontece, e por isso ele não aparece em lista de equipe, em seletor de responsável, em contagem de pessoas, em meta nem em banco de horas — não por um `if` em cada tela, mas porque a linha não existe. A D-5 restrição 1 recusa o booleano `superadmin` em `pessoas` pela mesma razão: com ele, a mesma sessão passaria a poder sair do próprio tenant.
2. **Toda escrita dele cai na `auditoria` DAQUELA clínica com `ator_tipo = 'operador'`** e o id dele, pela trigger — jamais atribuída a uma pessoa. `app.pessoa_id` carrega `operador:<uuid>`, a sentinela que a `0013` já ensinou à trigger. **Nada é chamado à mão.**
3. **A RLS continua valendo, e é uma clínica por sessão.** A sessão fixa `app.clinica_id` daquela clínica, como qualquer um: nada de `BYPASSRLS`, nada de sessão que alcance duas clínicas. Trocar de clínica é **outra** sessão, e abrir a segunda não move a primeira.
4. **Quem está usando SABE que é operador.** O casco do produto mostra, de forma permanente, a **faixa dourada do painel** — as mesmas classes, nenhuma regra de CSS duplicada. Uma sessão que parece a de uma administradora faz quem a usa agir achando que é a clínica agindo.
5. **Curta e revogável: trinta minutos**, sem renovação por uso. O balcão precisa de trinta dias para **não** relogar; o suporte precisa de minutos para **olhar uma coisa**. `POST /v1/sair` a mata, sair do painel revoga **todas** as sessões de suporte vivas daquele operador, e desativar o operador as derruba na requisição seguinte.

### A formulação que vale: **o acesso é total; o registro é obrigatório**

A clínica não pode nos barrar, mas pode nos **ver**. É a mesma frase da D-10, agora com dado de negócio dentro.

### Onde o acesso total PARA, e por que isso não o contradiz

Trinta e tantas colunas do banco guardam *uma pessoa da clínica* (`criada_por`, `responsavel_id`, `lancado_por`). Onde a coluna é **anulável**, ela fica `null` — ninguém da clínica fez aquilo, e quem fez está na trilha. Onde ela é **`NOT NULL`**, a ação é **recusada com 403**: fechar o caixa, registrar um recebimento, definir a meta do mês, conduzir uma 1:1, criar tarefa e montar programa são **rituais da clínica**, feitos por quem trabalha nela. O suporte olha e conserta configuração; ele não faz a rotina da clínica em nome de ninguém. A tradução mora em **uma** função (`pessoaDoAtor` / `exigePessoa`, em `apps/api/src/banco/ator.ts`), nunca num `if` por rota.

Pelo mesmo princípio, `eu.usuario` é **`null`** na sessão de suporte, e as telas de "quem sou eu" (filtro *Para mim*, responsável padrão, *Minhas metas*) mostram **vazio**. Mostrar vazio é resposta legítima; fingir que é alguém não é.

### A consequência que precisa estar escrita

Até aqui o painel **não lia dado de negócio**, e foi isso que o manteve defensável enquanto o DPA não existe (**P-10**). **Esta decisão cruza essa linha:** o operador passa a ver **paciente, dose e valor**. O dono decidiu com isso dito.

Por consequência, **o DPA (P-3) passa a precisar de cláusula de acesso de suporte a dado de saúde** — base legal, finalidade, prazo, quem são os operadores nomeados, e o direito da clínica de auditar o que fizemos dentro dela (que a trilha já entrega). Sem essa cláusula, não há implantação.

### Como derrubar

Não derrube por conveniência. Seguram a decisão: `teste/sessao-de-operador.test.ts` (22 testes, Postgres real), `apps/api/src/painel/sessao-de-suporte.e2e.test.ts` (21 testes, borda HTTP) e `apps/web/src/components/faixa-de-suporte.test.ts` (12 testes, o sinal na tela). Os cinco invariantes têm prova por mutação registrada no relatório da branch.

---

## D-14 · A senha provisória é modal; editar e excluir pessoa existem nos dois lugares · 2026-11-02

Três pedidos do dono, na mesma tela — `Usuários e acessos` da clínica e a tela de pessoas do painel.

### 1 · A senha provisória vira MODAL

**Era um bloco no topo da tela, e o defeito é da informação, não do layout:** ela **aparece uma vez e não se recupera**. No topo, compete com a lista, sai de vista ao rolar, e a pessoa fecha sem copiar — e aí o caminho é *redefinir de novo*, gastando outra provisória e derrubando as sessões dela mais uma vez.

O modal **obriga a fechar de propósito**: foco preso, `Esc` fecha, o foco volta para o botão que o abriu, `role="dialog"` + `aria-modal` + rótulo, e **clicar fora NÃO fecha** — um toque errado no véu, com a senha na tela, custa uma redefinição. A senha sai em 22 px com `user-select: all`, porque ela vai ser **ditada por telefone**, e o botão copia **usuário e senha juntos**.

O laço de foco mora em `apps/web/src/lib/foco.ts`, puro, com teste próprio: não há Testing Library nesta árvore, e um laço escrito dentro do `useEffect` seria código que nenhum teste roda.

### 2 · Editar pessoa — e o `usuario` NÃO entra

Nome, função, acesso e ativação, nos dois lugares. A rota da clínica já existia (`PATCH /v1/pessoas/:id`); o painel **não tinha nenhuma**, e a falta aparecia justamente no caso que ele existe para resolver — a clínica trancada, sem administradora ativa, não conseguia corrigir nem o nome de quem estava lá dentro.

**O `usuario` ficou de fora, e é decisão, não esquecimento.** Ele é ditado por telefone, é o nome pelo qual a equipe chama a pessoa, e é a chave de `tentativas_login.identificador` — que guarda o TEXTO digitado, não um uuid. Trocá-lo quebraria o que ela decorou e misturaria o histórico de bloqueio de duas contas. O campo aparece na tela, somente leitura, **com a explicação e a saída**: crie a pessoa com o usuário novo e exclua esta. Se o dono quiser o contrário, é uma decisão nova — e ela precisa dizer o que acontece com o limite de tentativas.

### 3 · Excluir pessoa — e é SOFT DELETE

`DELETE` como **verbo**, `UPDATE` como **efeito** (`pessoas.excluida_em`, migration `0023`).

- **A linha fica, e o histórico continua ligado a ela:** tarefa, recebimento, movimento de estoque e trilha seguem apontando para a pessoa, com o nome dela legível. Apagar mudaria o passado da clínica — e as FKs `NOT NULL` (`tarefas.responsavel_id`, `recebimentos.registrado_por`, `conversas_1a1.por_id`) recusariam de qualquer forma.
- **Excluída implica inativa**, por `CHECK`. Sem isso, existiria o pior estado possível: fora de toda tela e **ainda entrando** — `entrar` filtra `ativo`, não `excluida_em`.
- **A clínica não fica sem administradora ativa**, e **admin inativa não conta**. Vale para o superadmin também.
- **Ninguém se exclui.**
- **A confirmação diz o que acontece**, e as duas metades: *ela perde o acesso agora, com as sessões caindo* **e** *o histórico dela continua*. Quem não sabe da segunda hesita por medo de "perder os dados", e o caminho real volta a ser deixar quinze inativas na lista. A caixa também oferece a alternativa: **desative**, se ela só vai se afastar.
- **Idempotente:** excluir duas vezes é 404, e a segunda não reescreve `excluida_em` nem a trilha.

### O que isso obriga

`excluida_em IS NULL` entra na **base** de toda consulta de pessoa — lista, alvo de escrita, equipe que o domínio julga, e a lista do painel. Pô-lo em cada `WHERE` é como a quinta consulta nasce mostrando quem saiu da clínica. O defeito foi medido: sem o filtro em `redefinirSenhaDePessoa`, redefinir a senha de quem a clínica excluiu respondia **200**.

### Como derrubar

Seguram a decisão: `podeExcluirPessoa` em `packages/domain/src/pessoa.ts` (6 testes, com prova por mutação em `alvo.ativo`), `acesso.e2e.test.ts` (13 testes na borda da clínica), `painel-clinicas.e2e.test.ts` (13 na borda do painel), `modal.test.ts` e `excluir-pessoa.test.ts` (o que a caixa diz).

---

## D-15 · Importação por planilha, editar tarefa — e editar programa, que não tem resposta no protótipo

**Data:** 2026-11-04 · **Origem:** seis itens relatados pela PO · **Estado:** resolvida — os cinco de paridade, e a opção **b** escolhida pelo dono para o sexto

### O que o protótipo respondeu, e foi feito sem perguntar

| Item da PO | O que o protótipo diz | O que foi feito |
|---|---|---|
| Excluir programa dá erro | — (era defeito nosso) | `{ method: '' }`; o `fetch` recusa método vazio. Corrigido, com varredura que pega a classe |
| Importar lista de itens, com modelo | `importarItensEstoque`, caixa de duas etapas, `baixarModeloEst` | Caixa de duas etapas (ler → conferir) e planilha modelo com aba Instruções |
| Modelo na campanha | `baixarModelo(c)`, 7 colunas, aba Equipe | Modelo igual, e as colunas Responsável/Prazo/Observação passaram a ser honradas |
| Botão importar no estoque | `#bimpest` na barra de ações | Botão na barra, atrás de `estoque.gerir` como no protótipo |
| Editar tarefa de paciente | `editarTarefa` + "Editar tarefa" no cartão | Botão na linha do histórico, abrindo o painel que já existia |

### O que o protótipo NÃO responde: **editar programa**

Medido, não deduzido: o `demoApiBase` tem `criarAdesao`, `encerrarAdesao` e `excluirAdesao`. **Não existe `editarAdesao`.** A ficha do programa oferece Encerrar e Excluir, e "Editar tarefa" — que é da tarefa da sessão, não do programa.

Então o pedido é **produto novo**, e é decisão sua. As opções, e o que cada uma custa:

| Opção | O que permite | O preço |
|---|---|---|
| **a. Nada** (como o protótipo) | Errou o programa? Excluir e montar de novo — e D-8 já proíbe excluir programa com sessão paga | A clínica que errou o nome do programa depois da primeira sessão paga não tem saída nenhuma |
| **b. Editar só o que não move dinheiro nem estoque** (recomendada) | Nome, observação, responsável, datas das sessões ainda não realizadas | Precisa dizer o que acontece com sessão já concluída: ela não se move. É a fatia pequena que resolve o caso real (nome errado, responsável que saiu) |
| **c. Editar tudo, inclusive valor e quantidade de sessões** | Qualquer correção | Mexe em valor de programa com pagamento lançado e em insumo já baixado. Cada um deles é um recálculo de saldo em aberto e um movimento de estoque compensatório — e é a porta pela qual a receita do mês muda sem ninguém ver |

**Recomendação: b.** Resolve o que a PO está vivendo (corrigir um cadastro) sem abrir a porta que a regra 3 e a regra 12 existem para manter fechada. O **c** não é impossível, é um épico próprio, com compensação de estoque e recálculo de saldo.

### **O dono escolheu b.** O que isso virou, exatamente

`PATCH /v1/programas/:id`, com `@Exige('programas.gerir')` — a mesma permissão de encerrar e excluir. A fronteira teve de ser traduzida para o nosso esquema, porque "nome" e "observação" não existiam nele:

| Pedido | No nosso esquema | Como |
|---|---|---|
| nome | **não existe, e não passou a existir** | a identidade é `procedimento_nome`, congelado na montagem (lição D-2): renomear no catálogo não reescreve o tratamento de quem está em curso. O que a tela chama de nome é `rotulo_sessao`, **e esse muda** |
| observação | coluna nova `programas.observacao` (migration `0024`) | é o "por que este programa é assim": dose reduzida, paciente viaja em janeiro. Hoje isso mora na cabeça de quem montou |
| responsável | `itens_do_programa.responsavel_id`, **e reaponta as sessões em aberto** | é o caso real — a funcionária saiu e as nove aplicações futuras estão no nome dela. A sessão **realizada** não se move: reescrever o responsável de um atendimento que aconteceu muda a história clínica e troca o dono de um recebimento que entrou |
| datas das sessões não realizadas | **já funcionava** | a sessão é uma tarefa. Medido: o `DELETE` de tarefa recusa sessão (`SESSAO_NAO_SE_EXCLUI`), o `PATCH` não. Pôr uma segunda forma de mexer na mesma data criaria duas telas que discordam sobre a série |

**O que ela recusa, com 400 que nomeia o campo:** `valor`, `sessoes`, `intervaloDias`, `inicio`, `dose`, `insumo`, `modoDeCobranca`, `pacienteId`. O `.strict()` do contrato é quem garante — e a alternativa (ignorar campo desconhecido) é pior que o 400: a tela acharia que salvou o valor e o próximo fechamento diria outro número.

**Nenhuma coluna nova para afrouxá-los, de propósito.** A ausência de um `programas.editado_valor_em` é o que torna "o valor não muda" uma afirmação sobre o esquema, e não uma convenção que o endpoint número quarenta esquece.

Programa **encerrado** aceita a correção e devolve `sessoesRepontadas: 0`. Recusar impediria a correção justamente do registro que vai ficar; o zero diz, sem uma segunda regra, que não havia o que mover.

### Como derrubar

A edição de programa está presa por `editar-programa.e2e.test.ts` (21 testes), e as duas regras que importam foram **provadas por mutação**: tirar `status = 'aberta'` do reapontamento mata "a sessão realizada não se move"; tirar o `.strict()` do item mata as sete recusas. O excluir está preso por `metodo-http.test.ts` (varredura com prova por mutação). As importações, por `colunas.test.ts` (8), `campanha-importada.test.ts` (13) e `itens-importados.test.ts` (12). O editar tarefa, por `uma-tarefa.test.ts` (6, incluindo "a mesma pessoa que leva 403 na leitura leva 403 na escrita").

---

## D-16 · Quem define a senha da equipe das clínicas reais

**Data:** 2026-11-04 · **Estado:** resolvida, e **já existia**

A migração trouxe 9 pessoas da Suzana, 8 da Raphaella e 7 da Joice **sem senha**: o PIN da v20 não atravessa (D-10 trocou PIN por senha, e um PIN de 4 dígitos não é hash de senha). Faltava decidir quem define o primeiro acesso de cada uma.

**Decisão do dono: o admin de cada clínica.** Não o superadmin, e não um lote de senhas geradas por nós.

### Por que isso é a resposta certa, e não só a conveniente

O superadmin definindo a senha de 24 pessoas obrigaria a transmitir 24 segredos por fora — WhatsApp, papel, o que estivesse à mão —, e cada canal desses é onde a senha sobrevive ao primeiro acesso. O admin da clínica está **na sala** com a pessoa: ele redefine, lê a provisória na tela, a pessoa entra e troca. O segredo não viaja.

E é a divisão que D-10 já desenhou: o painel cuida de **clínica e identidade**; o acesso de quem trabalha na clínica é da clínica.

### Medido: isto já funcionava

Não houve código novo. `POST /v1/pessoas/:id/senha` existe desde o épico 1, com `@Exige('config')`, e a tela **Usuários e acessos** já a chama — a provisória aparece no modal (D-14), com 72 horas de prazo. O que estava preso por teste:

- *"o admin NÃO escolhe a senha de outra pessoa"* — o corpo é vazio de propósito; o servidor gera
- *"a pessoa nasce ATIVA, com senha provisória e prazo de 72 horas"*
- *"a trilha diz QUEM redefiniu, e não guarda a senha"*
- *"nenhuma rota devolve `senha_hash`, nunca"*
- *"a excluída não é mais ALVO de nada: editar e redefinir senha dão 404"*

Então a decisão é **operacional**: cada admin de clínica entra em **Usuários e acessos**, redefine a senha de cada pessoa da equipe e entrega a provisória ali, pessoalmente.

---

## D-17 · A sessão do balcão termina no fim do dia da clínica

**Data:** 2026-11-04 · **Origem:** P-1, aberta desde o épico 1 · **Estado:** resolvida — opção **3** escolhida pelo dono

### O que estava errado, com o número

A sessão durava **30 dias**. O preço não era segurança: quem sai da clínica perde o acesso na hora, porque a resolução de contexto filtra `AND ativo` — medido, e em produção não existe pessoa excluída e ativa.

O preço era **atribuição**, e ele atacava justamente a trilha de auditoria que a D-5 existe para construir. Num computador de recepção que três pessoas usam, uma sessão de 30 dias atribui **um mês inteiro de ações a quem entrou primeiro**. A trilha fica precisa e errada — pior que trilha nenhuma, porque todo mundo confia nela. E dói onde mais importa: quem fechou o caixa, quem aplicou a dose, quem mexeu num salário.

**Medido em produção:** a conta `admin.teste` tinha **211 sessões válidas**, a mais antiga de dois dias antes, todas boas por mais um mês. Nada revogava nada.

### A regra, exatamente

`fimDaSessaoDoBalcao(agora, fuso)` em `packages/domain`: **o fim do dia da clínica, nunca passando de 12 horas e nunca menos de 1 hora.**

| Entra às | Termina | Quem manda |
|---|---|---|
| 08h00 | 20h00 | o **teto** de 12 h — e ele cobre o expediente inteiro |
| 14h00 | meia-noite | a **fronteira do dia**; sem ela, ficaria até as 2h e o turno da manhã herdaria a sessão da tarde |
| 00h01 | 12h01 | o **teto**; sem ele, entrar depois da meia-noite daria quase 24 h pela porta dos fundos |
| 23h55 | 00h55 | o **piso** de 1 h; sem ele, a pessoa abre o sistema e é desconectada em cinco minutos |

**Não há renovação por uso.** Deslizar o prazo a cada requisição é como uma sessão de 12 horas fica viva uma semana, com uma aba esquecida recarregando sozinha — e aí a atribuição volta a cobrir mais de um turno.

**Entrar de novo não revoga as sessões anteriores**, de propósito: a recepção usa o sistema no balcão e na sala de trás, e revogar na entrada derrubaria a outra máquina. Com o prazo de um dia, o acúmulo se limita sozinho — era o prazo de 30 dias que transformava isso em 211 credenciais vivas.

### O que atravessa é a DURAÇÃO, não o instante — e isso custou 759 testes

A primeira versão gravava o instante calculado na aplicação. **A suíte caiu em 759 testes de uma vez**, e a razão vale em produção também: quem julga a validade é `expira_em > now()`, o relógio do **Postgres**, e quem calculava o fim era o relógio da **aplicação**. Nos testes o relógio da aplicação é congelado num dia passado, então toda sessão nascia vencida.

Em produção os dois relógios estão a milissegundos de distância e nada apareceria — até o dia de um desvio de NTP, e aí a clínica inteira não entraria. Agora o domínio decide **quanto tempo** e o banco aplica ao próprio instante: um relógio julga.

### A tela, porque a regra sem ela é um defeito

O desvio para `/entrar` era **mudo**. Com 30 dias ninguém via aquela tela duas vezes; com um dia, a recepcionista a encontra **toda manhã** — e sem explicação conclui que a ferramenta a deslogou sozinha. Um sistema que parece instável é um sistema que ninguém deixa aberto.

Agora `sessaoAtual` distingue **sem cookie** (primeira visita, ou clicou em Sair — nenhuma frase, não houve surpresa) de **cookie que venceu** (`?sessao=encerrada`, com a frase que diz que é de propósito e por quê). O nome do cookie passou a existir nos dois lados, e uma varredura impede a divergência silenciosa — se os nomes divergirem, a frase desaparece sem nenhum erro em lugar nenhum.

**O cookie morre com a sessão.** O `maxAge` era 30 dias fixos; um cookie mais longo que a sessão faz o navegador mandar credencial que o servidor já recusa.

### Como derrubar

`sessao-do-balcao.test.ts` (13 testes: property-based em 6 fusos, mais as bordas construídas à mão — gerador uniforme não acha virada de horário de verão nem minuto de meia-noite) e cinco testes ponta a ponta em `autenticacao.e2e.test.ts`. **Cinco provas por mutação:** tirar o teto, tirar o piso, tirar a fronteira do dia, divergir o cookie do banco, e voltar aos 30 dias — cada uma mata testes diferentes.

---

## D-18 · Quem redefine a senha pode DITÁ-LA

**Data:** 2026-11-04 · **Origem:** relato do dono — *"a senha está se perdendo"* · **Estado:** resolvida

### O que estava errado, e não era segurança

A redefinição tinha **corpo vazio de propósito**: o servidor gerava quatro palavras e as mostrava **uma vez**. Quem fechou o modal antes de anotar não tinha como recuperá-las — e a senha simplesmente se perdia, obrigando a redefinir de novo e a torcer para anotar a tempo. Numa clínica de quatro pessoas no balcão, isso acontece toda semana.

### A decisão

`POST /v1/pessoas/:id/senha` e a rota gêmea do painel passam a aceitar `senha` **opcional**:

| Corpo | Comportamento | Para quem |
|---|---|---|
| `{}` | o servidor gera quatro palavras ditáveis por telefone | quem está **longe** da pessoa |
| `{"senha": "…"}` | quem redefine escolhe | quem está **no balcão**, ao lado dela |

O caminho antigo não mudou uma linha no cliente — `{}` continua gerando.

### As três coisas que não mudaram, e são o que torna isso seguro

**1. A senha escolhida continua PROVISÓRIA, com as mesmas 72 horas.** Não é zelo: quem a digitou passa a conhecê-la, então ela ainda não é a senha da pessoa — é um **bilhete de entrada**. A obrigação de trocar no primeiro acesso é o que mantém verdadeira a frase *"ninguém além dela sabe a senha dela"*, e é dela que depende a trilha de auditoria apontar para a pessoa certa. Sem isso, a D-17 (sessão de um dia) resolveria metade do problema de atribuição e a outra metade voltaria pela senha compartilhada.

**2. A mesma regra de força da troca própria.** Uma senha escolhida *por outra pessoa* não é mais confiável por ter sido escolhida — ao contrário: um humano escolhendo senha para outro escreve `joice2026`. `avaliarSenha` julga as duas igual, e **o contexto é de quem vai USAR a senha** (nome da clínica, nome e usuário dela), não de quem digitou. É isso que pega `joice2026` para a Joice.

**3. A regra vem ANTES do hash.** `hashDeSenha` custa 19 MiB e ~25 ms e é o recurso que o semáforo protege. Hashear primeiro daria a quem tem sessão de admin um jeito de consumir o semáforo inteiro com senhas que nunca seriam aceitas.

### A escolhida NÃO volta na resposta

`senhaProvisoria: null`. Ecoar de volta uma cadeia que o cliente acabou de enviar a põe no corpo de uma resposta — e daí no log do proxy e no histórico do navegador — **sem informar nada a ninguém**. Quem digitou já sabe.

E o `null` é também o que diz à tela para **não abrir o modal**: "anote esta senha" para quem acabou de escolhê-la é ruído, e o modal existe justamente porque a gerada não pode ser recuperada depois.

### A assimetria que ficou

**Criar** pessoa continua sem aceitar senha escolhida — o dono decidiu sobre a *troca*. O teste que guardava a fronteira foi renomeado para dizer isso (`CRIAR pessoa não aceita senha escolhida — só a TROCA aceita`) em vez de afirmar uma regra que já não vale inteira. **A mesma perda acontece na criação**, e fechar essa metade é uma decisão de uma linha.

### Como derrubar

Sete testes em `pessoas.e2e.test.ts` e dois em `painel-clinicas.e2e.test.ts`. **Três provas por mutação:** ecoar a escolhida de volta, julgar depois do hash, e deixar de marcar como provisória — cada uma mata testes diferentes. E a varredura `identidade.test.ts` pegou a caixa nova do painel usando `.painel` do produto, que é classe do outro sistema de design.

---

## D-19 · A Carteira Comercial roda em paralelo ao épico 9 — qualifica a D-2, não a revoga

**Data:** 2026-11-05 · **Origem:** instrução direta do dono, em conversa, para construir a "Carteira Comercial da Firmare" por completo (G1-G6) · **Estado:** decidida, achado de processo registrado

### O achado que motivou este registro

A D-2 (2026-10-23) estabeleceu que a primeira entrega é a paridade com o protótipo e a migração das 4 clínicas reais, e que "escopo que atrasa a paridade passa pelo `product-rotina-clinica` e a decisão é do dono". Nesta sessão, o dono instruiu a construção completa da Carteira Comercial (G1 a G6) sem que essa instrução passasse por uma entrada aqui — uma violação de processo, não de intenção: o CLAUDE.md exige que "toda decisão não-óbvia vira ADR/decisão registrada", e uma instrução verbal que reordena prioridade é exatamente esse caso. Um levantamento do `engenheiro-migracao` (2026-11-05) trouxe isso à tona: a paridade de código está em 58/59 ações, mas o trabalho de MIGRAÇÃO de verdade (importador ensaiado contra dado real, relatório de conferência, janela de corte) não começou, e D0 (autenticação fraca da v20 em produção, com dado de saúde real) segue como a única dívida "cujo relógio corre sozinho".

### A decisão

Confrontado com a escolha entre pausar a Carteira e redirecionar para o épico 9, ou registrar o paralelismo e seguir — **o dono escolheu registrar a decisão e continuar a Carteira.**

A D-2 não é revogada: a migração das 4 clínicas continua sendo a entrega com prazo real, e nada na Carteira pode canibalizar o que ela ainda precisa (P-5, o primeiro ensaio de importação, o relatório de conferência). A D-2 é **qualificada**: construir a Carteira em paralelo é escopo autorizado, não um desvio silencioso.

### O que isso não resolve, e continua pendente

- **P-5** (escolher a clínica e a janela de migração com o dono) segue sem ação.
- **D0** (autenticação fraca da v20) segue com o relógio correndo — este registro não a mitiga.
- Nenhum trabalho de migração real (importador, conferência, corte) começou nesta sessão.

### Gatilho para revisitar

Se a Carteira consumir o próximo ciclo inteiro de novo (como consumiu este), ou se o dono notar que o épico 9 segue parado por mais de uma sessão de trabalho, isso deixa de ser paralelismo saudável e vira o adiamento que a D-2 original existia para evitar — nesse ponto, a prioridade volta ao `product-rotina-clinica` para decisão explícita, não para suposição.

---

## D-20 · As prioridades da cliente entram em paralelo à migração — agenda, forma de pagamento, rotinas

**Data:** 2026-11-08 · **Origem:** instrução direta do dono, com o documento "Novas funcionalidades ou melhorias" da cliente · **Estado:** decidida

O dono pediu que os pedidos da cliente sejam construídos e validados em produção:

| Prioridade | Pedido | Situação |
|---|---|---|
| 1 | Sincronização da agenda do sistema da clínica (iCal) | construída, [ADR 0019](adr/0019-sincronizacao-da-agenda-externa.md); decisão do dono: cartão da agenda não conta na meta de agendamentos |
| 2 | União do Firmare Gestão com o FIR Clinic | em produção (D-19) |
| 3 | Forma de pagamento nas despesas | spec aprovado com ajustes, [ADR 0020](adr/0020-forma-de-pagamento-nas-despesas.md) |
| 4 | Criação de novas rotinas automáticas | **bloqueada**: a cliente parte de "Configurações › Rotinas automáticas" com Pós atendimento e Recaptação (documento técnico 6.10 e 8.9), e nada disso existe no protótipo nem no documento técnico que temos (vão até 6.9 e 8.8). Falta receber a versão nova |

Qualifica a D-2 como a D-19 já fez: a migração das 4 clínicas continua sendo a entrega com prazo, e
nada disto pode consumir o que ela precisa.

---

## D-21 · Os achados da validação de produção — o que muda e o que fica

**Data:** 2026-11-08 · **Origem:** decisão do dono sobre a seção "Para você decidir depois" do relatório de entrega · **Estado:** decidida

| # | Achado | Decisão |
|---|---|---|
| 1 | Na contagem às cegas, quem tem `estoque` vê o saldo na lista de itens | **Seguir o protótipo.** Nada muda; o comentário em `itens.controller.ts` já registra o porquê |
| 2 | Recebimento em dia de caixa já fechado entra sem aviso | Avisar ao lançar + marcar o dia como "mudou depois do fechamento" |
| 3 | Avulso de mesmo valor/paciente/dia de um pagamento já registrado | Avisar antes de gravar |
| 4 | Pagamento de conta errado sem correção (D17) | Construir "desfazer pagamento" com trilha |

Spec: [avisos-de-caixa-duplicidade-e-desfazer-pagamento](specs/avisos-de-caixa-duplicidade-e-desfazer-pagamento.md).

---

## D-22 · Paridade total com o protótipo do Firmare Gestão (G8) — as decisões do dono

**Data:** 2026-11-08 · **Origem:** "tudo o que tem no protótipo e não tem no nosso deve ser construído"; inventário `docs/specs/g8-paridade-gestao-inventario.md` e gates `g8-gate-{appsec,lgpd,numeros}.md` · **Estado:** decidida — "siga o recomendado, priorizando fidelidade ao protótipo"

| # | Pergunta | Decisão |
|---|---|---|
| 1 | Ritmo frente ao épico 9 | Todas as ondas agora (qualifica a D-2, como a D-19) |
| 2 | Quem administra a equipe Firmare | **Superadmin cria pessoas e dá acesso** (ADR 0011 mantida — o gate de segurança reprovou "Diretoria" administrando identidade). A diretoria recebe do superadmin a chave **`carteira.administrar`**: arquivar, editar conteúdo e configuração, compartilhar todas as reuniões, redistribuir tarefas. As telas seguem o protótipo |
| 3 | Valores e "só a minha carteira" | Como o protótipo, com filtro e redação no servidor, num ponto único (`temPermCarteira`) |
| 4 | Cliente sem clínica / sem grupo | Pode ficar ativo; o Usuário de Gestão cria cliente do zero; lead convertido sem grupo ganha grupo próprio na mesma transação (função estreita, auditada) |
| 5 | Briefing, Mapa de Maturidade, transcrição, IA | **Em etapas (gate LGPD):** roteiro e ensaio sem gravar já; respostas gravadas e Mapa depois da ADR da Etapa 1 e do texto do jurídico; transcrição e IA depois do contrato com o provedor (sem treino, retenção zero, transferência internacional). Itens do checklist que pedem a base de pacientes ou guardam transcrição fora do sistema saem |
| 6 | Anexos | Arquivos na VPS, com as condições do gate de segurança (tipo pelos bytes, sem SVG/HTML, 20 MB, antivírus, download autenticado, acesso registrado) |
| 7 | Planilhas Google | Leitura pela **conta de serviço** do Google; contrato da função reconstruído do `fg-supabase.js` (formulários por frente) |
| 8 | ADR 0015 (4 decisões provisórias de cobrança) | Confirmadas como estão |
| 9 | Retorno de campanha | Investimento lançado à mão; retorno = total ÷ investimento (como o protótipo, "N,Nx") |
| 10 | Primeira cobrança | No mês de entrada (como o protótipo); job diário |
| 11 | Benefício de quem indicou sem ser cliente | Fica guardado até a pessoa virar cliente |
| 12 | Ticket médio | Só clientes com mensalidade |
| 13 | 2FA do Usuário de Gestão | Construir (TOTP, desenho mínimo do gate A-12); revoga a decisão 1 da §9 do plano de 05/11 e fecha a dívida D3b |

---

## D-23 · Ajustes do superadmin pedidos pelo dono (2026-11-08)

O dono testou o superadmin em produção e pediu, com o protótipo do Firmare Gestão como referência ("precisa estar exatamente igual"):

1. **Criar grupo, clínica e usuário de gestão por botão no topo** que abre o formulário, como "Adicionar pessoa" em `/usuarios` da clínica — não mais formulário no fim da página.
2. **Uma clínica pertence a no máximo um grupo de cliente** (mantido). O **grupo Firmare** vê todas as clínicas sem vínculo: é o escopo `geral` apresentado como grupo.
3. **Sem segundo fator por enquanto.** A exigência de TOTP da ADR 0022 fica **desligada** (por chave de configuração, código preservado), e some da tela o "Perdeu o celular?". No lugar, o superadmin **redefine a senha do usuário de gestão escolhendo uma senha provisória**, que ele troca no primeiro acesso (mesmo padrão da D-18 para a clínica). Revoga a decisão D-22 item 13.
4. **Modal de edição de usuário maior.**
5. **Espaço** entre "Grupos" e "Clientes de cada grupo" em `/superadmin/grupos`.
6. **Um login só para a Firmare:** todo superadmin tem automaticamente uma conta de gestão no grupo Firmare (vê todas as clínicas, perfil Diretoria, com valores). Ao entrar em `/superadmin`, abre a **Visão geral do protótipo** com todas as clínicas; o menu traz também Clínicas, Grupos e Usuários de gestão. **O painel passa a ver dinheiro** — revoga, para o superadmin, a regra "nenhum dinheiro atravessa o painel" (ADR nova substitui a parte correspondente da ADR 0011).

## O que ainda depende do dono

| # | Pendência | Quem destrava | Bloqueia |
|---|---|---|---|
| ~~P-1~~ | ~~**UX de sessão no balcão**~~ — **ENCERRADA por D-17 (2026-11-04).** O dono escolheu a opção 3: sessão terminando no fim do dia da clínica, com teto de 12 h e piso de 1 h. Implementada, com 18 testes e cinco provas por mutação | — | nada |
| P-2 | **Hospedagem para dado de saúde** — host no Brasil ou garantias contratuais equivalentes. D-4 resolveu onde roda hoje, não se isso satisfaz a avaliação de impacto | dono + `especialista-lgpd-saude` | implantação da primeira clínica |
| P-3 | **DPA com cada clínica** — a clínica é controladora, nós somos operadores. Não existe implantação sem contrato de tratamento. **D-13 ampliou o escopo (2026-11-02):** o DPA passa a precisar de **cláusula de acesso de suporte a dado de saúde** — base legal, finalidade, prazo, os operadores nomeados e o direito da clínica de auditar o que fizemos dentro dela. Antes da D-13 o painel só tratava identidade, e a cláusula era teórica; agora o acesso **existe de fato** | dono (jurídico) | implantação da primeira clínica |
| P-4 | **Modelo comercial** — por clínica, por usuário ou por unidade. Define quais cotas precisam ser deriváveis desde já | dono | épico 12 (mas as contagens, desde o épico 1) |
| P-5 | **Janela de migração das 4 clínicas** — qual clínica primeiro, que dia, quanto tempo de v20 em paralelo | dono + cada clínica | épico 9 |
| P-6 | **Perfil "Consultoria"** com visão de várias clínicas: existe no produto ou não | dono | épico 12 |
| P-7 | **Integração com agenda** — validar com Amigo e Support Health se sincronizam e o que vai no compromisso. Construir contra formato suposto é construir duas vezes | dono + clínicas | épico 10 |
| P-8 | **Domínio e certificado** do ambiente de produção. **D-10 reduziu o escopo:** ele já não bloqueia o e-mail (não há e-mail), e o EasyPanel dá subdomínio com TLS válido. Sobra a **marca** — e um item de segurança que não existia: **se um CDN entrar na frente do Traefik, a allowlist de IP do painel falha ABERTA sem mudar de cor** (ADR 0008). Conferência obrigatória no dia da virada | dono | primeiro deploy |
| ~~P-9~~ | ~~**SMTP**~~ — **ENCERRADA por D-10 (2026-10-27).** O e-mail saiu do produto: não há convite, não há recuperação por e-mail, não há `nodemailer`. O Mailpit continua no compose para um dia de notificação, **sem código que o chame**. Ela deixou de bloquear qualquer coisa, não só o desenvolvimento | — | nada |
| P-10 | **Concessão de acesso do operador a dado clínico. A LINHA FOI CRUZADA em 2026-11-02 (D-13):** o painel agora abre o sistema da clínica e o operador vê paciente, dose e valor. O que segura hoje é *acesso total com registro obrigatório* mais **sessão de trinta minutos e revogável**; o que continua faltando é a concessão com **motivo, prazo e aprovação** (D-5, restrições 2 e 4). Deixou de ser teórico. O painel entregue em 2026-10-28 implementa **acesso total com registro obrigatório** (D-10), que é o que a decisão pede. O que ele NÃO implementa é a concessão com motivo, prazo e revogação (D-5, restrições 2 e 4). Enquanto o painel só tratar **identidade**, isso é defensável; **deixa de ser no dia em que ele ler ficha de paciente**, e aí o retrofit custa o mesmo que a D-5 descreveu para a trilha. Ver ADR 0008 | dono + `especialista-lgpd-saude` | leitura de dado de negócio pelo painel (épico 12) |
| ~~P-11~~ | ~~**Editar programa**~~ — **ENCERRADA por D-15 (2026-11-04).** O dono escolheu a opção **b**: editar só o que não move dinheiro nem estoque. Implementada, com 21 testes e duas provas por mutação | — | nada |
