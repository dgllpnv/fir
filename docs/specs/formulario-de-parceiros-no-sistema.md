# Formulário dos parceiros dentro do sistema — proposta de escopo

> Status: **proposta, para decisão da Marília.** Nenhum código. Data: 2026-11-10.
> Origem: áudio da Marília de 08/11. Pedido dela: "que os parceiros respondessem e a resposta caísse direto dentro do sistema", "principalmente para mim, não para o cliente". Ela mesma diz que **não é urgente**, mas quer **antes de dar o desenvolvimento como encerrado**.
> Itens marcados com **[DECISÃO DELA]** não andam sem resposta.

---

## 0. O que conferi no código e no protótipo (para ninguém supor)

- `prototipo-rotinas-de-gestao.html` (o protótipo das clínicas) **não tem nada** de formulário de parceiro, Google Forms nem indicadores por frente. O que ele tem de "Formulários" é só estilo de tela. Este pedido, portanto, **não diverge do protótipo: ele não está nele.**
- A leitura de planilha já existe, e foi reconstruída do protótipo do Firmare Gestão (a Carteira), que **não está nesta máquina** (ver `docs/adr/2026-11-09-pendencias-da-cliente.md` §0). Isto não foi reconferido na fonte.
- O que existe hoje (`packages/domain/src/planilhas-indicadores.ts`, `apps/api/src/carteira/planilhas/`):
  - cada cliente tem **uma planilha Google**, com 4 abas, uma por frente: **Financeiro, Comercial, Tráfego pago, Marketing**;
  - cada aba é a planilha de respostas de um Google Forms, uma linha por envio, com o "Carimbo de data/hora";
  - o sistema lê por **conta de serviço** do Google, a cada 30 min ou sob demanda, e calcula as métricas (leads recebidos, convertidos, taxa de conversão, faturamento, alcance etc.) em número exato;
  - a aba Financeiro está marcada **provisória**; a regra de "a que semana pertence cada envio" está marcada **calibrar com a planilha real**;
  - **resposta de texto livre não é guardada**: o sistema registra só que foi respondida (decisão de LGPD do ticket 4A);
  - já existe `parceiros_do_cliente` (frente, nome, WhatsApp, link do formulário), com base legal e retenção definidas em `docs/compliance/retencao.md`. O parceiro hoje é só um **contato** na ficha do cliente; ele não entra no sistema.
- Não consegui abrir a planilha real de uma cliente da Firmare (pasta `docs/pedidos/`, fora do repositório) nesta sessão (sem ferramenta para ler .xlsx). **Falta conferir se a planilha real bate com as 4 abas acima.** Isso é o primeiro passo de qualquer opção.
- Pendência já aberta: o bloqueio da leitura de planilha é a **conta de serviço do Google** (tarefa do dono, JSON só na VPS). Sem ela, nenhuma das opções que dependem da planilha funciona em produção.

---

## 1. O problema e quem sente

**Hoje:** o parceiro (tráfego, social mídia, comercial) recebe um link de Google Forms da Marília, responde toda semana, a resposta vai para uma planilha, a planilha alimenta um painel feito em outra ferramenta (Lovable), e o link desse painel vai para o cliente.

**Quem sente, e o quê:**

| Quem | Dor |
|---|---|
| **Marília** | Para ver como o cliente vai, abre outra ferramenta. A resposta do parceiro não está no sistema onde ela já gerencia o cliente. É o pedido dela. |
| **Equipe da Firmare** | Cobrar o parceiro que não respondeu é manual (WhatsApp). O sistema **não sabe** quem respondeu e quem está atrasado, a menos que leia a planilha. |
| **Parceiro** | Recebe um link solto, sem saber se o envio foi aceito. |
| **Cliente (a clínica)** | Recebe um link de um painel externo. A Marília diz que **não é para ele** que ela quer a mudança. |

**Ritual que isso instala** (a pergunta do produto): **o fechamento semanal de indicadores por frente**, com a cobrança do parceiro atrasado saindo do sistema, sem a Marília ter que lembrar. Quem deixa de cobrar: a Marília e a equipe, no WhatsApp.

**Atenção ao que é e ao que não é o pedido.** Ela quer **ver as respostas dentro do sistema**. Isso é diferente de **trocar o formulário**. A parte de "ver dentro do sistema" já existe como leitura de planilha, mas depende de conta de serviço e de calibrar a planilha real. Por isso a pergunta 1 abaixo decide muita coisa.

---

## 2. As três formas de entregar

### A. Manter o Forms e a planilha; o sistema lê (o que já está construído)

- **O que muda para a Marília:** nada na rotina do parceiro. Ela passa a ver as métricas e "quem respondeu esta semana" dentro da Carteira.
- **Custo:** o menor. Falta a conta de serviço, calibrar com a planilha real (abas, colunas, regra da semana) e a tela "Planilhas da semana" na Hoje da Carteira (existe no protótipo do Gestão, não existe no código).
- **Risco:** depende de o parceiro **não mexer** no formulário e nas colunas (se mudar uma pergunta, a leitura quebra); depende do Google; o dado do parceiro **mora fora** do sistema (na planilha dela). O atraso de até 30 min é aceitável.
- **Não resolve:** "que a resposta caísse direto dentro do sistema". A resposta ainda nasce no Google.

### B. Formulário próprio dentro do sistema, preenchido pelo parceiro por link

- O parceiro abre um **link pessoal** (sem criar conta, sem senha), vê o formulário da frente dele, preenche em 1 minuto no celular e envia. A resposta grava direto no sistema, ligada ao cliente e à frente. O sistema sabe na hora quem respondeu e quem está atrasado, e a Hoje da Carteira mostra os atrasados.
- **O que muda para a Marília:** o link do Forms é trocado por um link do sistema (o cadastro `parceiros_do_cliente` já guarda o link por frente; passa a ser gerado pelo sistema). A planilha deixa de ser necessária. O painel externo (Lovable) deixa de ser alimentado por ela, **a não ser que se decida manter** (ver pergunta 5).
- **Custo:** o maior das três. Tabela de respostas, geração e revogação de link, formulário público com proteção contra abuso, tela de acompanhamento, e a decisão de LGPD abaixo. Estimativa de ordem de grandeza: **uma fatia de trabalho comparável à da agenda externa** (spec, gates de segurança e LGPD, ADR, migration, API, tela). Não estimei em dias.
- **Risco:** é uma **superfície pública nova** (uma página que qualquer pessoa com o link abre, sem login), a primeira do produto fora do login. Exige o gate de segurança. O dado do parceiro entra no nosso banco (ver §3).
- **Vantagem:** perguntas e unidades ficam no nosso controle (número é número, sem planilha com "12,5" ou "doze" na célula); o atraso aparece sozinho; a Marília edita as perguntas dentro do sistema.

### C. Receber a resposta do Forms por webhook (o Forms empurra para o sistema)

- O Google Forms **não tem webhook nativo**. Seria preciso um script do Apps Script dentro de cada formulário que chame uma URL nossa a cada envio. É a opção **mais frágil**: um script por formulário por cliente, mantido por alguém, autenticação por segredo compartilhado, e quebra em silêncio se o script for desativado ou o formulário duplicado.
- **Custo:** médio no nosso código, **alto na operação** (instalar e manter o script em cada formulário). **Risco:** alto de falha silenciosa. **Ganho** sobre A: só tira o atraso de 30 min, que ninguém pediu.
- **Não recomendo.** Fica registrada para a pergunta ser respondida de forma completa.

### Recomendação

**Fazer A agora, e B depois, em duas etapas — e não fazer C.**

1. **Etapa 1 (A):** fechar a leitura da planilha que já existe (conta de serviço + calibrar com a planilha real). É o que dá à Marília, no menor prazo, "ver dentro do sistema". Já está desenhado, e a planilha real dela está aqui para calibrar.
2. **Etapa 2 (B):** o formulário próprio, **só depois** de a migração das 4 clínicas fechar, e só se ela confirmar depois de usar a etapa 1. O pedido dela é de "antes de encerrar a ferramenta", não de agora, e o princípio da casa é não construir contra formato suposto duas vezes.

Se ela insistir que quer a resposta **nascendo** no sistema, B passa a ser a entrega, e a etapa 1 vira ponte. **[DECISÃO DELA]**

---

## 3. Quem é o parceiro no modelo de acesso, e o que isso implica

Hoje há dois perfis: **Carteira** (`usuarios_gestao`, equipe da Firmare) e **Portal** (`usuarios_do_portal`, a decisora do grupo de clínicas, com RLS própria e privilégio por coluna).

**Recomendação para a opção B: o parceiro NÃO é um 3º perfil com login.** É um **link com token por parceiro e por frente**, sem conta e sem senha:

- Um token longo e aleatório por `(cliente, frente)`, guardado só como **hash** (como se faz com senha); o link aparece uma vez para quem o copia.
- O link **só serve para enviar** a resposta daquela frente daquele cliente. Ele **não lê nada**: nem respostas anteriores, nem outros clientes, nem a ficha. A página mostra apenas o nome do cliente (ou só da clínica) para o parceiro saber que está no lugar certo, e a pergunta da semana.
- A Carteira pode **revogar e regenerar** o link (parceiro mudou, link vazou). É o equivalente de "trocar a senha".
- Motivo de não criar login: o parceiro é terceiro, responde 1 minuto por semana, e uma senha seria um cadastro de pessoa que não é cliente nem funcionária (dado a mais, e um perfil a mais para a regra de permissão cobrir). O login mínimo **não se justifica** pelo custo para quem usa.

**Segurança (gate de risco, no spec da etapa 2, antes de código):**

- Rota pública **só de escrita**, com limite de envios por link e por IP, tamanho máximo de resposta, validação com os mesmos tipos do domínio (número de verdade, nunca texto livre onde se espera número) e nada do que foi digitado devolvido de volta na página.
- O token na URL vaza em histórico de navegador e em registro de acesso do servidor; por isso: link que **expira ou se renova**, e o token nunca aparece em log.
- Isolamento: o token resolve para **um** cliente e uma frente no servidor; nada vem do cliente da requisição. RLS continua como segunda camada.
- Contra abuso: o link só aceita um envio por semana por frente (o reenvio vira **correção**, com histórico), e sem formulário aberto a spam.
- Quem revisa: `especialista-seguranca-appsec` (superfície pública) e `especialista-lgpd-saude` **no spec**, não no código.

**LGPD:**

- O dado é do **cliente da cliente**: números do negócio da clínica (faturamento, leads, alcance). **Não é dado clínico nem de paciente.** O que muda é que ele pode conter **receita da clínica** (financeiro) e é de **terceiro** (o parceiro) que o fornece.
- **Texto livre ("análise estratégica") é o ponto de atenção.** Hoje o sistema **não guarda** o conteúdo, só que foi respondido, por decisão de LGPD do 4A. Num formulário próprio, o texto **precisaria ser guardado** para ter valor, e a Marília quer ver a análise. Isso **reverte uma decisão** e **exige aviso ao parceiro**: "não coloque nome de paciente". **[DECISÃO DELA]** (pergunta 3).
- O parceiro já é titular de dado (nome, WhatsApp) em `parceiros_do_cliente`, base legal art. 7º, IX com LIA. O formulário próprio **acrescenta** o registro de quando ele respondeu e o IP aproximado de abuso; precisa entrar no aviso e na retenção (`docs/compliance/retencao.md`).
- O parceiro **não vê** nada dos pacientes e nada do financeiro do cliente. O painel do cliente continua só com a Carteira e o Portal, sob as regras de redação de valores já existentes.
- Receita do cliente vinda do parceiro é **valor monetário**: entra como **centavos inteiros** (`Dinheiro`), nunca decimal, como já faz a leitura de planilha, e passa pela redação de valores.

---

## 4. O que NÃO entra

- Qualquer coisa nas **clínicas** (agenda, tarefas, caixa): isto é da Carteira.
- **Substituir o painel que a Marília entrega ao cliente** (o Lovable). O pedido é para ela, "não para o cliente". O painel do cliente fica como está até ela decidir o contrário.
- **Login, senha, perfil ou menu do parceiro.** Ele só tem um link.
- O parceiro **ver** respostas anteriores, ranking, outros clientes ou qualquer indicador.
- **Construtor de formulário genérico** (perguntas arbitrárias por cliente). Entram as perguntas fixas das 4 frentes, como na planilha; mudar pergunta é pedido de produto, não tela.
- **Importar o histórico** que já está nas planilhas antigas, na etapa 2. Se ela quiser, é um ticket à parte (a leitura da etapa 1 já cobre o histórico).
- **Webhook do Forms** (opção C).
- **Lembrete automático por WhatsApp para o parceiro atrasado.** A Carteira mostra quem está atrasado e o botão de abrir a conversa; o envio automático depende de provedor e do respeito à oposição do parceiro (`nao_contatar`, A37) e fica para depois.
- Meta e alerta sobre o indicador: já existem para fonte "planilha"; **não se mexe** aqui.

---

## 5. Perguntas para a Marília (WhatsApp, no máximo 6)

1. **Marília, a planilha que você usa hoje (a que você me mandou) é a mesma estrutura para todos os clientes, com as abas Financeiro, Comercial, Tráfego pago e Marketing? Se algum cliente tiver abas ou perguntas diferentes, me conta qual.**
2. **Hoje você consegue ver as respostas dos parceiros dentro do sistema lendo a planilha, sem mudar nada para o parceiro. Isso já resolve o que você quer, ou você quer mesmo que o parceiro responda direto no sistema, sem passar pelo Google Forms?** *(decide A ou B)*
3. **A "análise estratégica" que o parceiro escreve: você quer que o sistema guarde o texto para você ler lá dentro? Se sim, eu preciso colocar um aviso para o parceiro não escrever nome de paciente.**
4. **O parceiro responde por um link só dele, sem criar conta nem senha, e o link só serve para enviar a resposta. Pode ser assim? Ou você quer que ele tenha login?**
5. **O painel que você manda para o cliente (no Lovable): daqui para frente ele continua sendo alimentado pela planilha, ou você quer que ele passe a ser feito dentro do sistema também, mais para frente?**
6. **O parceiro responde toda semana, em que dia? E quando ele atrasa, o que você quer: só ver quem está atrasado no sistema, ou que o sistema te avise?**

---

## 6. Ordem sugerida na fila

Referência: `docs/fila.md` (o caminho mais curto até as 4 clínicas migradas), `docs/decisoes.md` D-19/D-20 (a Carteira e as prioridades da cliente andam **em paralelo**, sem atrasar a migração) e a ordem de `docs/adr/2026-11-09-pendencias-da-cliente.md`.

1. **Primeiro, a migração das 4 clínicas** e as pendências dela (é a entrega com prazo, e o risco da v20 corre sozinho). Este pedido **não passa na frente**: o veto de escopo vale, porque a própria Marília diz que não é urgente.
2. **Junto com a planilha de indicadores do item 4 da lista de pendências:** a conta de serviço do Google e a planilha real. É a **etapa 1 (opção A)**, e já é pedida a ela. Sugiro pedir a planilha real de **mais de um cliente** (as perguntas 1 e 6 acima servem para isso).
3. **Depois do que já está na fila da Carteira** (Setor de atuação, ADR 0025; regra da semana fechada; tela "Planilhas da semana").
4. **Etapa 2 (opção B)** só se a resposta à pergunta 2 for "quero responder direto no sistema". Aí: `/grill-me` → spec → **gate de segurança e LGPD no spec** → ADR (o parceiro é link com token, não perfil; texto livre passa a ser guardado, se a pergunta 3 for sim) → tickets.
5. **Marco que ela pediu:** "antes de dar como encerrado o desenvolvimento". A etapa 2 é o **último** item antes de encerrar, não o primeiro.

**Critério de aceite testável, para a etapa 2** (executável no celular de um parceiro de verdade):
- Parceiro abre o link, responde as perguntas da frente e envia em **no máximo 4 toques além de digitar os números**, em 390 px, sem rolar para o lado.
- Reenviar na mesma semana **substitui** a resposta e deixa o histórico (não duplica o indicador).
- Link revogado mostra "link inválido" sem dizer a quem pertencia.
- Link de um cliente **nunca** grava em outro cliente (teste contra Postgres real com RLS).
- Dinheiro entra como centavos inteiros; "1.234,50" e "1234.5" dão o mesmo valor.
- O token nunca aparece em log.
- A Carteira mostra "quem respondeu e quem está atrasado esta semana" por cliente, em uma tela.
