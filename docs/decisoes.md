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

A clínica fecha um programa de R$ 3.600, a paciente não paga nada hoje e fica devendo tudo. **O protótipo aceita** — *"fechou, paga depois"* — e representa o saldo com valor recebido vazio e `valorAberto: 3600`.

O `CHECK (valor > 0)` de `recebimentos` impedia isso: sem entrada não havia linha, e sem linha não havia dívida registrada.

**Decisão:** `CHECK (valor > 0 OR valor_aberto > 0)` — a linha é aceita quando registra **alguma coisa**, dinheiro recebido **ou** dinheiro devido.

**Por que esta formulação e não `valor >= 0`:** aquela aceitaria uma linha completamente vazia. Esta é **mais restritiva** que o original em um sentido (nenhuma linha pode ser vazia) e mais permissiva só no caso que a clínica precisa.

**Tomada sob a premissa do dono**, afirmada em 2026-10-26: *"o protótipo funcional dela é o parâmetro principal, deve seguir o mesmo comportamento funcional"*. As alternativas eram (a) montar o programa sem valor — que **faz a clínica perder um recebível**, porque vendeu R$ 3.600 e o sistema registra zero — e (c) guardar o valor em aberto fora de `recebimentos`, que faria o saldo vir de duas fontes quando a regra 5 existe para ele vir de uma.

**Condição inegociável, e sem ela a decisão não vale:** a linha de valor zero **não pode aparecer** no caixa do dia, na lista de recebimentos do dia, nem no LTV do paciente. Três filtros, três testes, escritos **antes** do código. Uma venda a prazo não é dinheiro que entrou no caixa.

**Reversível:** se o dono preferir (a) ou (c), a migration de volta é pequena enquanto nenhuma clínica tiver migrado.

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
