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

**Data:** 2026-11-04 · **Origem:** seis itens relatados pela PO · **Estado:** cinco resolvidos no protótipo, um aberto

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

### Como derrubar

O excluir está preso por `metodo-http.test.ts` (varredura com prova por mutação). As importações, por `colunas.test.ts` (8), `campanha-importada.test.ts` (13) e `itens-importados.test.ts` (12). O editar tarefa, por `uma-tarefa.test.ts` (6, incluindo "a mesma pessoa que leva 403 na leitura leva 403 na escrita").

---

## O que ainda depende do dono

| # | Pendência | Quem destrava | Bloqueia |
|---|---|---|---|
| P-1 | **UX de sessão no balcão** — tempo de sessão, bloqueio de tela, reautenticação rápida. Consequência direta de D-3. **Metade resolvida por D-5**: com trilha de auditoria, "quem fez o quê" deixa de depender de quem logou. Resta o outro lado — uma sessão de 30 dias num computador de balcão atribui a ação à pessoa errada, e nenhuma trilha corrige isso se ela registra sempre o mesmo nome | dono + `product-rotina-clinica` | fechamento do épico 1 |
| P-2 | **Hospedagem para dado de saúde** — host no Brasil ou garantias contratuais equivalentes. D-4 resolveu onde roda hoje, não se isso satisfaz a avaliação de impacto | dono + `especialista-lgpd-saude` | implantação da primeira clínica |
| P-3 | **DPA com cada clínica** — a clínica é controladora, nós somos operadores. Não existe implantação sem contrato de tratamento. **D-13 ampliou o escopo (2026-11-02):** o DPA passa a precisar de **cláusula de acesso de suporte a dado de saúde** — base legal, finalidade, prazo, os operadores nomeados e o direito da clínica de auditar o que fizemos dentro dela. Antes da D-13 o painel só tratava identidade, e a cláusula era teórica; agora o acesso **existe de fato** | dono (jurídico) | implantação da primeira clínica |
| P-4 | **Modelo comercial** — por clínica, por usuário ou por unidade. Define quais cotas precisam ser deriváveis desde já | dono | épico 12 (mas as contagens, desde o épico 1) |
| P-5 | **Janela de migração das 4 clínicas** — qual clínica primeiro, que dia, quanto tempo de v20 em paralelo | dono + cada clínica | épico 9 |
| P-6 | **Perfil "Consultoria"** com visão de várias clínicas: existe no produto ou não | dono | épico 12 |
| P-7 | **Integração com agenda** — validar com Amigo e Support Health se sincronizam e o que vai no compromisso. Construir contra formato suposto é construir duas vezes | dono + clínicas | épico 10 |
| P-8 | **Domínio e certificado** do ambiente de produção. **D-10 reduziu o escopo:** ele já não bloqueia o e-mail (não há e-mail), e o EasyPanel dá subdomínio com TLS válido. Sobra a **marca** — e um item de segurança que não existia: **se um CDN entrar na frente do Traefik, a allowlist de IP do painel falha ABERTA sem mudar de cor** (ADR 0008). Conferência obrigatória no dia da virada | dono | primeiro deploy |
| ~~P-9~~ | ~~**SMTP**~~ — **ENCERRADA por D-10 (2026-10-27).** O e-mail saiu do produto: não há convite, não há recuperação por e-mail, não há `nodemailer`. O Mailpit continua no compose para um dia de notificação, **sem código que o chame**. Ela deixou de bloquear qualquer coisa, não só o desenvolvimento | — | nada |
| P-10 | **Concessão de acesso do operador a dado clínico. A LINHA FOI CRUZADA em 2026-11-02 (D-13):** o painel agora abre o sistema da clínica e o operador vê paciente, dose e valor. O que segura hoje é *acesso total com registro obrigatório* mais **sessão de trinta minutos e revogável**; o que continua faltando é a concessão com **motivo, prazo e aprovação** (D-5, restrições 2 e 4). Deixou de ser teórico. O painel entregue em 2026-10-28 implementa **acesso total com registro obrigatório** (D-10), que é o que a decisão pede. O que ele NÃO implementa é a concessão com motivo, prazo e revogação (D-5, restrições 2 e 4). Enquanto o painel só tratar **identidade**, isso é defensável; **deixa de ser no dia em que ele ler ficha de paciente**, e aí o retrofit custa o mesmo que a D-5 descreveu para a trilha. Ver ADR 0008 | dono + `especialista-lgpd-saude` | leitura de dado de negócio pelo painel (épico 12) |
| P-11 | **Editar programa** — o protótipo não tem `editarAdesao`, então é produto novo (ver D-15). Três opções escritas lá, com recomendação: **b**, editar só o que não move dinheiro nem estoque. A PO pediu o botão; sem a decisão, a clínica que errou o cadastro depois da primeira sessão paga não tem saída, porque D-8 proíbe excluir | dono + `product-rotina-clinica` | o botão de editar na aba Programas |
