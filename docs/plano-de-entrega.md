# Plano de entrega — o que falta, em ordem, e quanto custa

**O que este documento é:** o caminho completo da fundação até as 4 clínicas migradas e o painel de contas, com escopo, dependências e estimativa de consumo por etapa.

**A estimativa tem base medida, e tem margem larga.** Leia a seção 3 antes de usar qualquer número para decidir.

---

## 1. Onde estamos, medido

| | |
|---|---|
| Commits | 80 |
| Código | **4.112 linhas** (domínio 692 · API 1.998 · web 758 · UI 557 · contratos 78) |
| Teste | **3.022 linhas** · 191 testes em 8 pacotes |
| Documentação | 9.158 linhas |
| Ações da API entregues | **0 de 59** |
| Telas de negócio | **0** — o shell existe, as telas não |

A fundação está pronta e revisada: RLS forçada, guards globais, redação de valores, Argon2id com sessão opaca, domínio puro com `Dinheiro` e `Quantidade` em inteiro, ambiente local e CI.

**Nenhuma função de negócio existe ainda.** É isso que falta.

---

## 2. O que falta — a lista completa

Ordem de execução. O que está acima bloqueia o que está abaixo.

### 2.0 · Trilha de auditoria — **antes de tudo**

Plano escrito: `superpowers/plans/2026-10-24-plano-auditoria.md`, 7 tarefas. Trigger no Postgres, ator obrigatório, falha fechado. **Precisa vir antes do épico 2** porque todo épico seguinte escreve dado, e em tabela append-only não há como gravar depois o que não foi gravado na hora.

### 2.1 · Administração da clínica — **recomendo subir na fila**

No roadmap isto está espalhado entre o épico 7 e o 12. **Recomendo extrair e fazer logo depois da auditoria**, por um motivo concreto: hoje **uma pessoa só é criada por SQL**. Sem estas telas, nenhuma clínica consegue cadastrar a própria equipe — nem a primeira, nem na migração.

Entrega: convidar por e-mail com token de uso único · ativar e desativar pessoa · trocar perfil · editar perfis de permissão · unidades · configurações da clínica · **ver a trilha de auditoria da própria clínica**.

Depende de **P-9 (SMTP)** — sem servidor de e-mail não existe convite, nem recuperação de senha, nem caminho para a primeira conta.

### 2.2 · Épicos 2 a 8 — a paridade

| Épico | O que entrega | Ações | Telas | Depende de |
|---|---|---|---|---|
| **2 · Núcleo da rotina** | `Tarefa`, recorrência, Hoje de verdade, Tarefas, Nova tarefa, `Paciente`, `Unidade` | 8 | 4 | — |
| **3 · Jornada** | etapas, confirmação, recontato, orçamento, fechamento, perda com motivo, funil | 1 | 1 | 2 |
| **4 · Financeiro** | `Recebimento`, saldo por programa, caixa às cegas, contas a pagar, cobranças, visão do mês | 7 | 5 | 2 |
| **5 · Programas** | `Procedimento` com insumos, programa por itens, sessões, reprogramação, retorno | 5 | 2 | 3 |
| **6 · Estoque** | item com 3 unidades, local, movimento, contagem às cegas, análise, ABC, QR, GS1, NF-e, baixa pela sessão | 8 | 1+ | 5 |
| **7 · Pessoas** | fichas, contrato, férias, documentos, metas, 1:1, banco de horas | 16 **+ 8 indicadores** | 3 | 2 |
| **8 · Campanhas e painel** | campanha com meta, importação, funil, painel geral | 3 | 2 | 3, 4 |

**Total: as 59 ações de [`paridade.md`](paridade.md).**

Dois avisos que não são detalhe:

- **O épico 3 tem 1 ação e é dos maiores.** `moverEtapa` é o funil inteiro — a máquina de estados onde `faltou` e `desmarcou` mantêm o cartão aberto. Contar ações subestima.
- **Os 8 indicadores do épico 7** (`agendamentos`, `confirmacoes`, `contatos`, `recebimentos`, `orc_qtd`, `orc_valor`, `tarefas_prazo`, `contagens_prazo`) não são CRUD, são contagens derivadas — e dois são **percentuais**. É onde número divergente vai aparecer na migração.

### 2.3 · Épico 9 — 🚩 migração das 4 clínicas

**É a entrega com data.** Importador idempotente · ensaio contra cópia real dos dados de cada clínica · relatório de conferência batendo **exatamente** (registros, receita total, LTV, saldo por paciente, saldo por adesão, receita por campanha) · perfis revisados com cada clínica · corte uma por vez, fora do horário, com rollback cronometrado · v20 em paralelo, somente leitura, por alguns dias.

Um único paciente divergente reprova a clínica inteira.

### 2.4 · Épicos 10 a 12 — depois da paridade

| Épico | O que entrega |
|---|---|
| **10 · Integrações** | `AgendaProvider` (iCal, Google), conciliação que **propõe**, mensagens por clínica, WhatsApp oficial, leitura de nota por foto |
| **11 · Produto** | previsão de compra, rastreabilidade por lote, transferência entre unidades, painel por frente, campanhas de indicação |
| **12 · Contas e assinatura** | **o objetivo final** — ver a seção 4 |

---

## 3. Estimativa de consumo

### A base, e por que acreditar nela só até certo ponto

Medi quatro rodadas de trabalho **nesta sessão**, com verificação e revisão incluídas:

| Rodada | Consumo |
|---|---|
| Onda de correção (8 itens, 6 commits) | 293 k |
| Re-revisão (diff de 3.244 linhas, testes, mutações) | 175 k |
| Correção dirigida (6 achados, 6 commits) | 262 k |
| Shell do frontend (6 commits, verificação no navegador) | 232 k |

O shell entregou ~800 linhas por 232 k → **~290 tokens por linha entregue**, já incluindo revisão, provas por mutação e os consertos.

**Uso 250–350 tokens por linha de código ou teste entregue.** A faixa larga é honesta: aproximadamente 40% do consumo desta sessão foi revisão e conserto, não primeira escrita — e essa proporção varia muito com quão bem o plano foi escrito.

### Por etapa

| Etapa | Linhas estimadas | Consumo | Observação |
|---|---:|---:|---|
| **2.0 Auditoria** | ~900 | **0,3 – 0,4 M** | Plano já escrito, escopo fechado |
| **2.1 Admin da clínica** | ~1.800 | **0,5 – 0,7 M** | Trava na P-9 (SMTP) |
| Épico 2 · Rotina | ~3.700 | **1,0 – 1,3 M** | A primeira tela de verdade custa mais que as seguintes |
| Épico 3 · Jornada | ~1.800 | **0,5 – 0,7 M** | Máquina de estados; poucas linhas, muita revisão |
| Épico 4 · Financeiro | ~3.700 | **1,0 – 1,3 M** | Conferência às cegas e receita que não dobra |
| Épico 5 · Programas | ~2.100 | **0,6 – 0,8 M** | |
| Épico 6 · Estoque | ~4.400 | **1,3 – 1,7 M** | **O mais caro.** FIFO de validade, GS1, XML de NF-e, reversão de baixa |
| Épico 7 · Pessoas | ~6.400 | **1,7 – 2,2 M** | Maior volume: 16 ações + 8 indicadores |
| Épico 8 · Campanhas | ~1.500 | **0,4 – 0,6 M** | |
| **🚩 Épico 9 · Migração** | ~2.000 | **0,9 – 1,4 M** | Pouco código, **muita** iteração contra dado real |
| Épico 10 · Integrações | ~2.600 | **0,8 – 1,2 M** | Trava na P-7 |
| Épico 11 · Produto | ~2.200 | **0,6 – 0,9 M** | |
| Épico 12 · Contas | ~4.000 | **1,2 – 1,7 M** | Ver seção 4 |

### Totais

| Marco | Consumo |
|---|---|
| **Até a paridade** (auditoria + admin + épicos 2–8) | **7,3 – 9,7 M** |
| **Até as 4 clínicas em produção** (+ épico 9) | **8,2 – 11,1 M** |
| **Produto completo** (+ épicos 10, 11, 12) | **10,8 – 14,9 M** |

### O que faz o número variar, de verdade

Em ordem de impacto:

1. **Qualidade do plano antes de executar.** O Plano 1 pegou defeitos sérios na revisão do *plano* — antes de existir código. Cada um deles custaria 5 a 10 vezes mais depois de implementado. Planejar bem é a maior economia disponível.
2. **Quantas rodadas de conserto cada tarefa leva.** Uma tarefa que passa de primeira custa ~40% de uma que precisa de duas rodadas.
3. **Teste contra Postgres real.** É caro e não é negociável — RLS não se mocka.
4. **Dado real na migração.** Número que não bate vira investigação, e investigação consome muito mais que escrever código.
5. **Retrabalho de tela.** O shell que acabamos de refazer custou 232 k *porque não foi desenhado direito na primeira vez*. As telas de negócio nascendo de `/prototype`, com três direções e escolha humana, evitam isso.

---

## 4. O superadmin e as telas de admin

Você perguntou disto especificamente. São **duas coisas separadas**, e confundi-las é o erro que destrói o isolamento entre clínicas.

### 4.1 · Admin **da clínica** — dentro do produto

Quem usa: a dona da clínica, ou quem ela designar. Vê **só a própria clínica**, como qualquer pessoa — a RLS não abre exceção.

| Tela | O que faz |
|---|---|
| Equipe | convidar por e-mail (token de uso único), ativar/desativar, trocar perfil |
| Perfis | editar os conjuntos de permissão da clínica |
| Unidades | cadastrar e editar |
| Configurações | fuso, limite do banco de horas, categorias financeiras, mensagens |
| **Auditoria** | quem fez o quê, quem **acessou** o quê, de → para |

É a seção 2.1. **Recomendo fazer logo depois da auditoria** — sem isso ninguém cadastra ninguém.

### 4.2 · Superadmin — painel interno, **separado**

Quem usa: nós. É o épico 12. As sete condições abaixo vêm da decisão **D-5** e **não são sugestão** — sem elas, "trocar de clínica" vira o caminho mais curto para desfazer a RLS que sustenta o produto inteiro.

1. **O superadmin não é uma `pessoa`.** Identidade separada, tabela própria, cookie próprio, prefixo de rota próprio. Um booleano `superadmin` em `pessoas` já perderia o modelo: a mesma sessão passaria a poder sair do próprio tenant.
2. **Trocar de clínica não é um seletor que muda uma variável.** É uma **concessão** registrada: qual operador, qual clínica, quem autorizou, até quando, e por quê. A sessão só resolve para clínica com concessão viva.
3. **Toda leitura do painel grava na trilha que a clínica enxerga.** "Quem olhou meus pacientes" tem de ser respondível **pela clínica**, não só por nós.
4. **A clínica pode revogar.**
5. **Duas conexões de banco separadas por autenticação, não por `SET ROLE`** — `RESET ROLE` desfaz na mesma transação.
6. **Allowlist de rede na frente do controle de aplicação, falhando fechada.** Se o middleware não puder ser construído, o painel vira 404 em vez de ficar aberto.
7. **O superadmin nunca atravessa a RLS por conveniência.** Fixa `app.clinica_id` da clínica concedida, como qualquer um. Nada de `BYPASSRLS` para a aplicação.

**O que o painel entrega:** cadastrar clínica · ativar e desativar · onboarding self-service com perfis e catálogo padrão · planos e cotas · assinatura recorrente · visão de consultoria · personalização com logo · a trilha de qualquer clínica, sob concessão.

**O que isso custa:** um seletor de clínica custaria uma tarde. Esta versão custa dias. A diferença aparece no dia em que uma clínica perguntar quem viu o prontuário das pacientes dela — e a LGPD dá a ela o direito de perguntar. Nós somos **operadores**, a clínica é **controladora**.

**Regra normativa:** cota que impede o titular de entrar, ver o próprio histórico ou exportar os próprios dados não é modelo comercial, é infração.

---

## 5. O que não se resolve com token

Estas travam a entrega e **dependem de você**, não de trabalho:

| # | Pendência | Trava |
|---|---|---|
| **P-9** | **SMTP** | Admin da clínica (2.1) e qualquer onboarding |
| **P-2** | Hospedagem para dado de saúde — Brasil ou garantias equivalentes | Implantação da 1ª clínica |
| **P-3** | **DPA com cada clínica** — elas são controladoras, nós operadores | Implantação da 1ª clínica |
| **P-8** | Domínio e certificado | 1º deploy (sem TLS o cookie `__Host-` não existe, logo o login não existe) |
| **P-5** | Janela de migração: qual clínica primeiro, que dia, quanto tempo em paralelo | Épico 9 |
| **P-7** | Validar agenda com Amigo e Support Health | Épico 10 |
| **P-4** | Modelo comercial: por clínica, por usuário ou por unidade | Épico 12 |
| **P-6** | Perfil "Consultoria" existe ou não | Épico 12 |
| **P-1** | UX de sessão no balcão | Fechamento do épico 1 |

E duas dívidas técnicas que mordem no primeiro deploy, em [`dividas.md`](dividas.md): `PROXY_SALTOS_CONFIAVEIS` (sem ele o limite por origem conta todas as clínicas como um IP só e barra quem não errou senha) e o piso de tempo de 100 ms calibrado nesta máquina.

E **D0**: enquanto a migração não acontecer, as 4 clínicas seguem na v20, cuja autenticação é fraca por desenho. Três mitigações cabem numa tarde cada uma, no próprio Apps Script, sem depender de nada que a gente entregue.

---

## 6. A ordem que eu recomendo

```
Auditoria  →  Admin da clínica  →  Épico 2  →  Épico 3  →  Épico 4
                                                              ↓
Épico 9 (migração)  ←  Épico 8  ←  Épico 7  ←  Épico 6  ←  Épico 5
        ↓
Épico 10  →  Épico 11  →  Épico 12
```

Três razões para esta ordem, e nenhuma é arbitrária:

- **Auditoria primeiro** porque append-only não tem passado retroativo.
- **Admin da clínica em segundo** porque sem ela ninguém cadastra ninguém, e isso trava até o ensaio da migração.
- **Épico 9 logo após a paridade**, não no fim: é a entrega com data real. Os épicos 10 a 12 são valiosos, mas nenhuma clínica está esperando por eles — quatro estão esperando para sair do Google Sheets.
