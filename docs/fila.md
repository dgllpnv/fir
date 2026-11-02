# A fila — o que falta, por prioridade

Ordenada pelo **caminho mais curto até as 4 clínicas migradas**, que é a entrega com data. Não por tamanho, nem por facilidade.

**Estado em 2026-11-02:** 58 das 59 ações · 2.074 testes · épicos 1, 2, 3, 4, 5, 6, **7** e **8** fechados — o painel geral agora com o **capítulo 10 inteiro** —, mais a auditoria, a **identidade sem e-mail**, o **painel do superadmin**, a **administração da clínica** e a **Ajuda e manual**.

A única ação ainda em ⬜ é `carregar`, e ela **não vira rota de propósito** —
ver `paridade.md`. O que falta para a paridade virar portão é o **épico 9**.

---

## 1 · Administração da clínica — **o que sobrou dela**

**Plano parcialmente superado:** `superpowers/plans/2026-10-24-plano-admin-da-clinica.md`
(leia o carimbo no topo) e `2026-10-27-plano-acesso-sem-email.md`, que o
substitui no que toca identidade.

**O que já está entregue** (épico 4 de acesso, 2026-10-27/28):

- o login é **clínica + usuário + senha** — não há e-mail no produto;
- o **admin da clínica cria pessoa e redefine senha, e nunca vê** (`alterarPin` → *trocar senha*; `salvarPessoa` parcial);
- troca obrigatória no primeiro acesso, por guard global;
- o **superadmin** existe: cria a clínica e a administradora dela, alcança qualquer clínica, e **não faz nada sem deixar rastro na trilha que a clínica lê**.

**FECHADO em 2026-11-01.** As Tasks 1, 6, 8 e 9 saíram: as invariantes de pessoa
no domínio (`podeDesativar`, `podeTrocarAcesso`, `podeRemoverPerfis` — **uma
função para os dois caminhos**), listar/ativar/desativar/trocar perfil, os
perfis com soft delete, as unidades, e as telas **Usuários e acessos** e
**Unidades**.

O que a tela de usuários **não** tem, de propósito: campo de PIN (a senha é
gerada no servidor e aparece uma vez — defeito da D-0 corrigido), botão de
excluir pessoa (desativar é um estado, regra 20), e edição de `usuario` (ela o
decorou e o dita por telefone).

Entregou: `excluirPessoa` · `salvarPerfis` · `salvarUnidade`, e `pessoasOp` na
parte de acesso — a de RH fica no épico 7.

> A **P-9 (SMTP)** deixou de bloquear **qualquer coisa**: nenhuma linha do
> produto depende de e-mail.

## 2 · ~~Épico 6 — Estoque~~ · **8 de 8, FECHADO**

**As oito ações:** `salvarLocalEstoque` · `salvarItemEstoque` ·
`importarItensEstoque` · `movEstoque` (primeira fatia) · `criarContagem` ·
`salvarContagem` · `ligarCodigoItem` · `entradaNota` (segunda fatia). Mais a
tela `/estoque` com as três abas — Itens, Contagens e Análise — e o menu
apontando para ela.

**O que a segunda fatia resolveu, e como:**

- **A contagem às cegas (regra 14)** é invariante de **contrato**, não de tela:
  enquanto aberta, a resposta é `ContagemAberta`, que não tem
  `esperadoEmEstoque`, `anteriorEmEstoque` nem `diferencaEmEstoque` — e também
  não traz os lotes conhecidos do item. As duas rotas de leitura entraram em
  **`ROTAS_DE_CONFERENCIA`** (as três de ITEM continuam fora, com a razão
  escrita), e a varredura ganhou dois dentes novos: `chavesProibidas` pega o
  campo reintroduzido, `numerosProibidos` pega o campo **renomeado**. As duas
  mutações foram medidas — a primeira morre pela chave, a segunda pelo número.
- **A diferença é relatada, nunca corrigida (regra 13):** concluir uma contagem
  grava os movimentos de `contagem` e **mais nada**. O teste conta
  `tipo = 'ajuste'` depois do fechamento e exige zero.
- **A contagem de um item com validade é um GRUPO de movimentos**, uma linha por
  lote, amarradas por `movimentos_de_estoque.contagem_id`. Sem o grupo, o saldo
  leria só a última linha e os outros frascos desapareceriam da prateleira sem
  erro na tela.
- **A NF-e é idempotente por DUAS chaves de esquema:** a chave de acesso e, para
  a nota digitada, emissor + número. Três importações devolvem os **mesmos
  movimentos, com os mesmos ids**. O protótipo responde erro e não dedupa a nota
  digitada.
- **O seam `LeitorDeNota` foi implementado** — do XML para linhas inteiras, sem
  tocar o banco, com um leitor de XML **sem DOCTYPE** (a classe XXE não existe).
- **A curva ABC é do servidor**, sobre o catálogo inteiro: ela depende do custo
  de todos os itens, e custo é redigido sem `valores` — calculada na tela, o
  filtro "alto valor" da enfermagem devolveria o catálogo todo.

**O que ficou como dívida, com gatilho:** a etiqueta imprime o **código em
texto** e não a imagem do QR, e a leitura pela **câmera** não existe — só o
leitor USB e o código digitado (D-E6 e D-E7). As duas se pagam juntas, na
primeira clínica que quiser ler pela câmera.

## 3 · ~~Épico 7 — Pessoas~~ · **FECHADO (2026-11-01)**

**16 ações + 8 indicadores.** O maior volume da fila.

**Entregue nesta fatia:** `ficha` · `doc` · `excluirDoc` · `ferias` ·
`excluirFerias` · `horas` · `config`, mais a tela **`/equipe`** com as duas abas
que existem (Visão geral e Banco de horas).

O que a fatia resolveu, e como:

- **Salário atrás de `pessoas.gerir`, em três camadas** — e a terceira é a que
  importa: `GET /v1/auditoria` entrega o `de`/`para` de toda escrita da clínica
  e exige `config`, então um perfil com `config` + `valores` e **sem**
  `pessoas.gerir` leria o valor na trilha se o mapeamento
  `salario → pessoas.gerir` não existisse em `CHAVE_DO_CAMPO`. O teste usa
  exatamente esse perfil; feito com quem não tem `valores`, ele passaria com a
  mutação aplicada. A LISTA não carrega salário, e é por isso que só a ficha
  aberta é `@DadoSensivel`.
- **Férias são aritmética, com a fronteira construída:** períodos contíguos,
  só os completos, abatimento FIFO com soma exata, e `concederAte` **ancorado
  na admissão**. Esta última nasceu de uma mutação que SOBREVIVEU —
  `somarMeses(fim, 12)` passava os 25 testes e erra 29/02/2024 por um dia, o
  que antecipa o prazo que custa férias em dobro.
- **Banco de horas em minuto inteiro**, com `lerSaldoDeHoras` e
  `formatarSaldoDeHoras` provados inversas exatas. O protótipo guarda hora
  decimal e imprime `0h60` quando o saldo é `0,999`.
- **Período de férias sobreposto é recusado** (`EXCLUDE USING gist`) —
  divergência consciente: o protótipo concatena, e dois registros sobrepostos
  calam o alerta mais caro da tela.
- **O prefixo da API é `/v1/fichas`**, porque `GET /v1/equipe` já existe (a
  lista de pessoas para os seletores) e o Fastify recusou em tempo de subida. A
  tela continua `/equipe`.

**Entregue na segunda fatia:** `conversa` · `meta` · `excluirMeta` ·
`copiarMetas` · `realizado`, os **8 indicadores**, a tela **`/minhas-metas`**
(que o roadmap punha no épico 5 por engano — medido no protótipo, ela lê RH e
os indicadores, nada de programa) e as abas **Metas do mês** e **Conversas
1:1** em `/equipe`.

O que a segunda fatia resolveu, e como:

- **Os 8 indicadores são contagens derivadas, nunca coluna** (regra 11):
  quatro consultas a `tarefas`, `recebimentos` e `contagens_de_estoque`. As
  definições saíram do `realizadoMeta` do protótipo e estão **fixadas por 14
  mutações, todas mortas por um número que muda** — a definição de cada uma
  está em `paridade.md`, uma linha por indicador.
- **Os dois percentuais eram o risco, e o risco era o DENOMINADOR.** Quatro
  mutações diferentes sobre a borda de `tarefas_prazo` mudam o número:
  `prazo <= hoje`, `status <> 'cancelada'`, o tipo que não é pagamento, e o
  fuso em que o "no prazo" é medido.
- **Duas lições de método, medidas.** Uma mutação SOBREVIVEU na primeira
  rodada (`percentualNoPrazo(0,0)` é inalcançável pelo serviço, porque a
  consulta tem `GROUP BY` e não devolve linha com `total = 0`); e quatro
  matavam por CRASH — remover `t.prazo <= $4` deixa o parâmetro de bind sem
  uso e o Postgres recusa o statement inteiro, o que prova que o teste
  EXERCITA o código e não que ele MEDE o invariante. As cinco foram refeitas.
- **Sem `valores`, a meta entrega só o percentual** (regra 17), e o mecanismo
  é a ESCALA separar os campos: `metaEmDinheiro`/`realizadoEmDinheiro` para
  `orc_valor`, `metaEmNumero`/`realizadoEmNumero` para os outros oito. Não há
  `if` de permissão na tela — medido no navegador, com e sem a chave.
- **`comoChamar` virou uma função do domínio**, e ela substituiu **cinco
  cópias** de `split(' ')[0]` espalhadas pela web, todas erradas do mesmo
  jeito: `"Dra. Helena Prado"` virava `"Dra."`, que não identifica ninguém num
  consultório com duas doutoras. Achado por MEDIÇÃO, não por leitura.

## 4 · ~~Épico 8 — Campanhas e painel~~ · **FECHADO (2026-11-02)**

**Entregue na primeira fatia:** `salvarCampanha` · `excluirCampanha` ·
`importarCampanha`, a tela **`/campanhas`** e o **`/painel`** com Período ·
Cumprimento de prazos · Pacientes no período (MANUAL cap. 10). A migration `0020` traz
`tarefas.campanha_id` e `pacientes.campanha_id`, que é o que destrava a dívida
**D10**.

O que a fatia resolveu, e como:

- **A varredura de transporte às cegas me pegou, e a pergunta dela era a
  certa:** o painel agrega recebimentos **por FORMA** num período que pode
  conter hoje — um período personalizado de `de = ate = hoje` entrega o
  esperado da gaveta que alguém ainda vai contar. É a mesma classe de
  `visao-do-mes`, com a janela escolhida por quem olha. A defesa é a do épico
  4: `porForma` só soma os dias com caixa FECHADO, e dois campos declaram o
  recorte. **O protótipo vaza aqui.**
- **A importação de lista é idempotente por DOIS índices** (regra 26), e a
  medição no ambiente local fez a volta inteira: 5 linhas → 5 pacientes e 5
  tarefas; o mesmo arquivo de novo → `criadas: 0, ignoradas: 5`.
- **Excluir campanha é soft delete e NÃO limpa o vínculo das tarefas.** O
  protótipo limpa, e aí o trabalho feito perde a atribuição para sempre e o
  painel do trimestre passado muda sozinho.
- **`Dinheiro.media(n)` entrou no domínio** para o ticket médio. Não é
  `ratear(n)[0]`: aquele é sempre a parte que ficou com o centavo do resto,
  ou seja a média arredondada para cima, **sempre**.
- **`contracts/src/painel.ts` era o painel do SUPERADMIN e virou
  `superadmin.ts`.** O `CONTEXT.md` já proibia por escrito chamar o superadmin
  de `painel`; o arquivo nasceu com o nome errado antes de a tela existir.

**A segunda fatia fechou o capítulo 10 (2026-11-02):** **Top 10 pagantes**
(com a janela "no período" e "desde o início"), **desempenho por unidade**,
**campanhas no período** e **novos pacientes por origem**.

O que essa fatia resolveu, e como:

- **O corte de caixa fechado passou a valer para TODA soma de recebimento
  agrupada**, e não só para o `porForma`: um ranking por paciente numa janela
  de um dia é a soma daquele dia por outro agrupamento, e a janela do painel é
  escolhida por quem olha (`per` com `de = ate = hoje`). O Top 10 e o
  faturamento por unidade passam pelo mesmo `EXISTS` em `caixas_do_dia`, e
  cada bloco **declara** até onde alcança. O protótipo soma os três no
  navegador, sem olhar caixa nenhum.
- **O que NÃO passa pelo corte está escrito, e é tão importante quanto:**
  `ltvMedio` e `ltvTotal` são somas da VIDA da paciente, e a receita da
  campanha é da janela DELA — nenhum dos três é o esperado de dia nenhum, e é
  a mesma classificação que `/v1/pacientes` e `/v1/campanhas` já carregavam.
  O LTV médio por unidade mostra isso na tela: ele inclui o pagamento de hoje
  que o faturamento ao lado não inclui.
- **As campanhas vêm do `CampanhasService`**, não de um `SELECT` novo: as sete
  contagens, o percentual da meta e a taxa de conversão são uma regra só.
  Recontá-las no painel seria a herança que o `CLAUDE.md` paga — a mesma regra
  em dois lugares, divergindo no primeiro ajuste.
- **Medido no navegador, e era defeito meu:** a tabela de oito colunas fazia a
  página rolar na horizontal a **768 px** (`scrollWidth` 942). A 390 px ela já
  estava certa, porque abaixo de 620 toda tabela do painel vira bloco — o
  estouro vivia na faixa do meio, que é o tablet da recepção. A classe `larga`
  antecipa a quebra para 900 px.

A dívida **D11** (indicadores de período na tela Pacientes) continua aberta.

## 5 · ~~Ajuda e manual~~ · **FECHADA (2026-11-02)**

**14 capítulos, 77 seções e 51 perguntas frequentes**, portados palavra por
palavra do protótipo para `apps/web/src/conteudo/`, com a tela `/ajuda` — duas
abas (Perguntas e Manual), uma busca só, e o sumário do manual por capítulo.

**Não era acabamento:** é como a clínica aprende a ferramenta, e a migração
sente primeiro. Uma equipe que não sabe usar abandona.

O que essa fatia resolveu, e como:

- **O conteúdo é dado versionado no repositório, não linha de banco.** Ele é
  igual para as quatro clínicas, não é dado de nenhuma delas, e muda com o
  deploy. No banco precisaria de `clinica_id` (regra 19) e passaria a divergir
  entre clínicas no primeiro ajuste de texto.
- **Os números mudam com quem olha, e isso é dela:** 51 perguntas em 8 temas
  para quem tem `painel` ou `config`, e exatamente **35 em 7 temas** para a
  equipe — as 16 marcadas `adm` no protótipo. No manual, 14 capítulos para a
  gestão e 11 para a recepção. Medido no navegador, com os dois perfis.
- **O capítulo 13 vinha antes do 12 no array dela**, e o sumário lia
  "… 11, 13, 12, 14". O número virou campo e a ordem passou a sair dele.
- **A D-10 alcançou o texto:** PIN virou senha, o primeiro acesso mudou de
  cadeia, e `conteudo.test.ts` cobra que nenhuma menção a PIN, a e-mail ou a
  convite sobreviva — a mesma varredura de `identidade-sem-email`, do lado do
  texto.
- **"Trocar senha" ganhou botão no rodapé da lateral.** A rota existia e só era
  alcançada pelo desvio do primeiro acesso: quem quisesse trocar por vontade
  própria tinha de digitar o endereço. O manual (cap. 2) descreve esse botão, e
  um manual que descreve um botão que não existe é pior que nenhum.

## 6 · 🚩 Épico 9 — Migração das 4 clínicas

**A entrega com data.** Importador idempotente · ensaio contra cópia real · relatório de conferência batendo **exatamente**, por clínica · perfis revisados com cada uma · corte uma por vez, fora do horário, com rollback cronometrado · v20 em paralelo, somente leitura, por alguns dias.

**Um único paciente divergente reprova a clínica inteira.**

---

## Antes do primeiro deploy — não se resolve com código

> Detalhe de cada um, com custo e o que eu faço depois: [`o-que-depende-de-voce.md`](o-que-depende-de-voce.md).

| | O que falta | Quem |
|---|---|---|
| ~~**P-9**~~ | ~~SMTP~~ — **sai da lista (D-10)**. Não há convite, não há recuperação por e-mail, não há `nodemailer`. O Mailpit continua no compose sem código que o chame | resolvido |
| **P-8** | **Domínio próprio e certificado.** Já não bloqueia o login nem o e-mail: o EasyPanel dá subdomínio com TLS válido, como no Mavia. Sobra como questão de **marca** — e como **item obrigatório de conferência da allowlist do painel**: um CDN à frente faz a allowlist falhar ABERTA sem mudar de cor | dono |
| **P-10** | **Concessão de acesso do operador a dado clínico.** Hoje o painel só trata identidade, com acesso total e registro obrigatório (D-10). No dia em que ele ler ficha de paciente, isso precisa virar concessão com motivo, prazo e revogação (D-5, restrições 2 e 4) | dono + `especialista-lgpd-saude` |
| **D1** | ~~`PROXY_SALTOS_CONFIAVEIS`~~ — **decidido: `1`**, pela topologia do Mavia (Traefik é o primeiro salto TCP). Vira item de conferência se um CDN entrar na frente, porque aí falha **aberto** | resolvido |
| **D2** | O piso de tempo de 100 ms foi calibrado nesta máquina — medir o p99 na VPS | nós, no primeiro deploy |

## Antes da primeira clínica real

| | O que falta | Quem |
|---|---|---|
| **P-2** | Hospedagem para dado de saúde — Brasil ou garantias equivalentes | dono + `especialista-lgpd-saude` |
| **P-3** | **DPA com cada clínica** — elas são controladoras, nós operadores | dono (jurídico) |
| **P-5** | Janela de migração: qual clínica primeiro, que dia, quanto tempo em paralelo | dono + cada clínica |
| **P-1** | UX de sessão no balcão | dono + `product-rotina-clinica` |

## O relógio que corre sozinho

**D0** — enquanto a migração não acontecer, as 4 clínicas seguem na v20, cuja autenticação é fraca por desenho. **Três mitigações cabem numa tarde cada uma**, no próprio Apps Script, sem depender de nada que a gente entregue. Detalhe em `seguranca-v20-local.md`, fora deste repositório.

É a única dívida da lista que **piora com o tempo**.

---

## Depois da paridade

**Épico 10** (integrações — trava na P-7) · **Épico 11** (produto) · **Épico 12** (contas, assinatura e cotas).

O **painel do superadmin saiu do épico 12** e foi entregue em 2026-10-28, com
as sete condições da D-5 (menos a 4, revogada por escrito na D-10 e na ADR
0008). O que fica para o 12 é o lado comercial: planos, cotas, assinatura, e
a leitura de dado de negócio pelo painel — esta última presa na P-10.

---

## Como as decisões são tomadas nesta fila

Regra do dono, 2026-10-27, também no `CLAUDE.md`:

1. **Abra e teste no protótipo.** Ele é funcional e é o parâmetro.
2. Se ele não cobre o caso, **veja o `Code.gs`** — dado real foi gravado por ele.
3. **Só então pergunte**, com as opções e uma recomendação.

E a parte que já custou caro: **conferir na fonte, não no relatório de outro agente.**
