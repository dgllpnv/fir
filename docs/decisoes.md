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

## O que ainda depende do dono

| # | Pendência | Quem destrava | Bloqueia |
|---|---|---|---|
| P-1 | **UX de sessão no balcão** — tempo de sessão, bloqueio de tela, reautenticação rápida. Consequência direta de D-3. **Metade resolvida por D-5**: com trilha de auditoria, "quem fez o quê" deixa de depender de quem logou. Resta o outro lado — uma sessão de 30 dias num computador de balcão atribui a ação à pessoa errada, e nenhuma trilha corrige isso se ela registra sempre o mesmo nome | dono + `product-rotina-clinica` | fechamento do épico 1 |
| P-2 | **Hospedagem para dado de saúde** — host no Brasil ou garantias contratuais equivalentes. D-4 resolveu onde roda hoje, não se isso satisfaz a avaliação de impacto | dono + `especialista-lgpd-saude` | implantação da primeira clínica |
| P-3 | **DPA com cada clínica** — a clínica é controladora, nós somos operadores. Não existe implantação sem contrato de tratamento | dono (jurídico) | implantação da primeira clínica |
| P-4 | **Modelo comercial** — por clínica, por usuário ou por unidade. Define quais cotas precisam ser deriváveis desde já | dono | épico 12 (mas as contagens, desde o épico 1) |
| P-5 | **Janela de migração das 4 clínicas** — qual clínica primeiro, que dia, quanto tempo de v20 em paralelo | dono + cada clínica | épico 9 |
| P-6 | **Perfil "Consultoria"** com visão de várias clínicas: existe no produto ou não | dono | épico 12 |
| P-7 | **Integração com agenda** — validar com Amigo e Support Health se sincronizam e o que vai no compromisso. Construir contra formato suposto é construir duas vezes | dono + clínicas | épico 10 |
| P-8 | **Domínio e certificado** do ambiente de produção | dono | primeiro deploy |
| P-9 | **SMTP** — sem ele não há convite, cadastro nem recuperação de senha, e não existe caminho para criar a primeira conta | dono | primeiro deploy útil |
