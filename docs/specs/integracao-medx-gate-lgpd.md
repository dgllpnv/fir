# Gate LGPD — Integração com o MedX (spec `integracao-medx.md`)

**Revisor:** `especialista-lgpd-saude` · 2026-11-16 · sobre o spec, antes do código.
**Lido:** o spec, CLAUDE.md (regras 18, 20, 21, 26, 27), `docs/compliance/retencao.md`, ADR 0019, `apps/api/src/agenda/sincronizacao.ts`, migration `0037_agenda_externa.sql`, `docs/decisoes.md` (P-2, P-3, P-10).

**Veredito:** **reprovado como está, com 5 bloqueios.** Todos se resolvem por texto no spec, sem mudar as decisões D1–D5. O nível 2 (faturamento) está bem desenhado. O risco está no nível 1, porque ele é **dado de saúde**: *a pessoa X tem consulta ou procedimento na clínica Y, com o profissional Z, em tal data* é dado pessoal sensível (art. 5º, II; art. 11), mesmo sem prontuário, e mesmo que o campo se chame `tipo`.

## Papéis e base legal (para entrar no spec como seção própria)

| Papel | Quem |
|---|---|
| Controladora | A clínica |
| Operador | Firmare/FIR |
| Outro operador da mesma controladora | MedX |

A FIR **não recebe dado do MedX**. É a clínica que instrui um operador a ler o que outro operador guarda para ela. Por isso a autorização tem que vir **por escrito da clínica** (B1). Contrato entre Firmare e MedX não é necessário; o que precisa existir é o termo da clínica e a conformidade com os termos de uso da API do MedX (nota N3).

| Finalidade | Dado | Base legal provável |
|---|---|---|
| Criar e manter o cartão, confirmar a consulta, tratar falta | nome, telefone, data/hora, Consulta ou Procedimento | art. 11, II, "f" (tutela da saúde, em serviço de saúde). Para o telefone, art. 7º, V |
| Recontatar quem cancelou ou sumiu da agenda | os mesmos | art. 11, II, "f" enquanto for retomar o cuidado. Uso comercial além disso: **finalidade declarada pela clínica, a confirmar no DPA (P-3)**, igual ao funil em `retencao.md` |
| Total diário de faturamento | soma em centavos e quantidade, por dia | não é dado pessoal (ver N1). Art. 7º, V |
| Credencial do MedX e nome do usuário do MedX | segredo, e o nome de uma funcionária da clínica | art. 7º, V |

---

## Bloqueios

### B1 — Termo da clínica autorizando a integração. **BLOQUEIA ligar em produção** (não bloqueia o código)
**Problema.** O spec manda o superadmin colar uma chave que dá leitura da agenda de pacientes de outro sistema, e não exige nenhuma instrução documentada da controladora. Sem esse documento, a FIR trata dado sensível sem instrução do controlador (art. 39). A pergunta em aberto 4 reconhece isso, mas não fecha.
**Ajuste no spec.**
- Novo critério A.0: **"Ligar MedX" fica desabilitado até o superadmin registrar o termo de autorização**: data, quem assinou pela clínica, versão do termo. Isso é gravado em `integracoes_da_clinica` e vai para `auditoria_do_painel`.
- O termo (aditivo ao DPA, P-3) cobre: quais dados são lidos (a lista branca do B2), finalidades (tabela acima), frequência (15 min e 1 h), janela (hoje até +60 dias; 45 dias de faturamento), o usuário dedicado do MedX (B5), retenção (B4), como a clínica revoga (desliga na FIR **e** revoga o token no MedX) e o que acontece no fim do contrato.
- Acrescentar a P-3 em "Perguntas em aberto" como dependência do T4 em produção.

### B2 — Lista branca do que é guardado. **BLOQUEIA**
**Problema.** O spec lista os campos que a API devolve, mas não diz quais a FIR guarda. Vários deles são dado de saúde ou o revelam por inferência, sem servir à finalidade:
- `descricao`: texto livre, onde a recepção escreve queixa e procedimento;
- `setor` e `profissional`: "Dermatologia", "Dr. Fulano, psiquiatra";
- `procedimentoId` e `tipo`: qual procedimento a pessoa vai fazer;
- `status.nome`, `confirmacao`, `chegada`, `atendidoEm`, `saiuEm`: a frequência ao serviço de saúde.

`GET /contatos/{id}` com certeza devolve mais que telefone (CPF, endereço, convênio, nascimento), e isso o próprio spec exclui.
**Ajuste no spec** (novo critério B.0, "O que a FIR guarda do MedX, e nada mais"):
- **Guarda:** id do agendamento (como HMAC, ver B3), início, nome do paciente (só ao cadastrar), telefone (só ao cadastrar), id do paciente no MedX (como HMAC) e **um único bit derivado**: Consulta ou Procedimento agendado. Isso vira `tarefas.tipo`, que já existe.
- **Lê, usa em memória e descarta:** `procedimentoId`/`tipo` (só para derivar o bit), `status.id` (só para decidir se foi cancelado), `fim`.
- **Não guarda, não usa e não repassa:** `descricao`, `setor`, `profissional`, `status.nome`, `confirmacao`, `chegada`, `atendidoEm`, `saiuEm`, `criadoEm`, `versao`. **O nome do procedimento do MedX nunca vai para a nota do cartão nem para o histórico.** A nota continua genérica, "pela agenda do sistema".
- O schema Zod da borda (`LeitorDoMedx`) declara **só** esses campos e descarta o resto (`strip`). A resposta crua nunca é persistida, nunca entra em payload de job (Redis) e nunca vai para log.
- `/contatos/{id}`: o schema aceita só `celular` e `telefoneResidencial`. **Só é chamado quando o paciente não tem vínculo pelo id do MedX** (hoje o T4 diz "sob demanda"; isso tem que virar critério testado: um paciente já vinculado gera zero chamadas a `/contatos`).
- Usar `chegada` e `atendidoEm` para concluir o cartão sozinho fica para **spec própria**, com gate próprio. Fica escrito em "Fora de escopo".

### B3 — Paciente desativado, anonimizado ou excluído não volta pela sincronização. **BLOQUEIA**
**Problema.** A regra 27 e a ADR 0019 garantem que **o cartão** excluído não é recriado. **O paciente**, não. Em `sincronizacao.ts`, `vincularPaciente` procura só `WHERE ativo` (linhas 397–415), e o `ON CONFLICT (clinica_id, nome_chave) WHERE ativo` (linha 426) não colide com quem foi desativado. Resultado: a próxima consulta no MedX de quem foi desativado ou anonimizado, inclusive quem pediu para sair, **cadastra a pessoa de novo**, com nome e telefone, e marca "conferir cadastro". O pedido de eliminação do titular é desfeito em 15 minutos. O vínculo pelo id do MedX (B.4) piora o quadro: ele aponta direto para quem foi anonimizado.
**Ajuste no spec** (novo critério B.9):
- Os ids externos (agendamento e paciente do MedX) são guardados como **HMAC-SHA-256 com chave fora do banco** (o padrão de `supressoes_de_contato`). A conciliação só precisa de igualdade, e o id do agendamento chega cru da API a cada leitura. Assim nenhum id que reidentifica a pessoa no MedX fica na FIR, e a anonimização não precisa reescrever o vínculo.
- Agendamento cujo paciente do MedX está ligado a um paciente **desativado ou anonimizado**: **não cria cartão, não cadastra e não reativa**. Conta em `ignorados.pacienteDesativado`. A tela da clínica mostra só a contagem ("3 consultas de pacientes desativados não viraram cartão"), nunca o nome. Reativar é ato humano (regra 27).
- Ao anonimizar um paciente, o HMAC do id dele no MedX **fica**, como supressão, desligado da identidade. O mesmo vale para o paciente sem vínculo por id cujo nome ou telefone casa com um anonimizado: a busca por telefone e nome passa a olhar uma lista de supressão de HMAC. Sem isso, o caminho "não achou → cadastra" recria a pessoa.
- Teste e2e: desativar ou anonimizar o paciente e rodar três leituras com a consulta dele no MedX. Resultado esperado: zero pacientes e zero cartões novos.
- **O mesmo defeito existe hoje no iCal.** Registrar em `docs/dividas.md`, com o gatilho "primeira solicitação de eliminação de titular numa clínica sincronizada".

### B4 — Classes sem prazo de retenção. **BLOQUEIA** (veto: campo pessoal sem prazo)
**Problema.** `retencao.md` não tem linha para `compromissos_externos` (nem a do iCal), nem para o que o spec cria.
**Ajuste:** o T1 e o T4 só fecham com estas linhas em `retencao.md`, no mesmo PR:

| Dado | Prazo proposto | Ação no fim |
|---|---|---|
| `compromissos_externos` (HMAC do id do agendamento → tarefa, início, visto, removido) | O da tarefa ligada, que é o da classe "cadastro do paciente" | A linha fica enquanto existir a tarefa (é a prova de não recriar). Por ser HMAC, não precisa de anonimização |
| HMAC do id do paciente no MedX, e a supressão | Enquanto a integração estiver ligada naquela clínica, mais 90 dias | Eliminar, por job. Apagar antes disso reabre a recriação do B3 |
| `integracoes_da_clinica.chave_cifrada` | Até ser trocada ou removida | **Apagar o valor de verdade** (`NULL`), não marcar como inativa. Aviso na tela: "revogue também o token no MedX" |
| Nome do usuário do MedX e escopo mostrados no teste | Não são guardados, ou ficam até a próxima troca | Sobrescrever |
| Termo de autorização (B1) | Vigência do contrato mais 5 anos | Manter (é prova) |
| `leituras_de_faturamento_externo` e o histórico de substituições | Integração ligada, mais **2 anos** depois de desligada. Não é dado pessoal (N1) | Eliminar, por job |
| Registro de ciclo de leitura (A1, abaixo) | **1 ano**, como a trilha de acesso | Eliminar, por job |

### B5 — A credencial dá à FIR mais acesso do que ela precisa. **BLOQUEIA**
**Problema.** O token é **pessoal** de um usuário do MedX, e as permissões dele "são as do usuário". Se for a recepcionista ou a médica, a FIR guarda, cifrada, uma chave que lê **prontuário, exames e receitas**, justamente o que o spec exclui. Num vazamento do cofre, o alcance passa a ser o prontuário inteiro da clínica. Se a conta do MedX alcançar mais de uma clínica do grupo, a FIR ainda traz para esta clínica a agenda de **outra controladora**. E se o token for da funcionária e ela sair da clínica, a integração para, ou continua com uma credencial de ex-funcionária.
**Ajuste no spec** (critério A.3 reescrito):
- O termo (B1) exige um **usuário do MedX dedicado à integração**, com perfil mínimo: `agenda:read` e `contatos:details:read`, mais o escopo de finanças só se o faturamento for ligado.
- **Testar conexão** compara o `scope` com uma **lista branca**. Escopo a mais (prontuário, exames, escrita, qualquer outro) **impede ligar**, e a tela diz em português qual escopo sobra. Escopo a menos: a tela diz qual falta (já previsto).
- O teste mostra **quais clínicas/unidades** o usuário alcança no MedX. Se for mais de uma, não liga até a clínica restringir o usuário, ou até o spec ganhar um filtro por unidade com teste.

---

## Ajustes

**A1 — Registro do que a FIR leu do MedX.** O worker lê agenda e telefones de pacientes sem que ninguém na FIR "abra" uma ficha. A controladora precisa conseguir responder "o que o operador leu do meu outro sistema, e quando". Cada ciclo grava uma linha (clínica, provedor, janela, quantos agendamentos, **quantas chamadas a `/contatos`**, quantas páginas, quando), **sem id e sem nome**, com retenção de 1 ano (B4). A clínica a vê na tela D.1. As rotas da FIR que mostram os cartões e a ficha seguem com o `@DadoSensivel` que já têm. Cartão vindo do MedX não ganha rota nova.

**A2 — Log, erro e fila (regra 21).** Acrescentar ao T2:
- loga só o modelo da rota (`/contatos/:id`), nunca o caminho real, a query string, o corpo da resposta nem o corpo de erro do MedX (uma mensagem de validação pode trazer o nome do paciente);
- `ultimo_erro` sai de um **catálogo fixo** de mensagens nossas ("o MedX recusou a chave", "limite de chamadas", "resposta inválida"), nunca do texto do MedX;
- o payload do job BullMQ leva só `clinica_id`;
- o `accessToken` em cache fica só na memória do worker, nunca no Redis nem em log.

Teste: forçar um erro do MedX com nome no corpo e verificar que o nome não aparece em log nem em `ultimo_erro`.

**A3 — Trilha sem o segredo.** O critério A.6 cobre `auditoria_do_painel`. Mas `integracoes_da_clinica` tem `clinica_id` e, pelo padrão da 0037, ganha a trigger `registrar_auditoria`, que escreve na `auditoria` **da clínica**. Essa trilha é lida por quem tem `config`. Por isso `chave_cifrada` (e o nome da coluna de versão da chave, se houver) entra na denylist de `auditoria_sem_segredos`, ao lado de `url_secreta`. Texto cifrado também não vai para a trilha.

**A4 — O que o superadmin vê.** Pode ver o nome do usuário do MedX, o escopo, as unidades, as contagens e o erro do catálogo. **Testar conexão chama só `/agenda/usuario-atual`**: nunca lê agendamento nem contato, nem como amostra. Ver os cartões gerados continua passando pela sessão de suporte da D-13, com trilha de operador. Isso fica escrito no A.7 para ninguém criar uma "prévia da agenda" no painel.

**A5 — A sincronização não sobrescreve o cadastro.** Paciente existente: o nome e o telefone do MedX **nunca substituem** os da FIR (regra 27). Se divergirem, no máximo marca `conferir_cadastro`. Escrever isso no B.4.

**A6 — Base legal escrita no spec.** Incluir a seção "Papéis e base legal" deste parecer, com a ressalva sobre o uso comercial do Recontatar, que depende do DPA.

**A7 — Detectar incidente.** O spec precisa dizer o que dispara alerta para o operador (não para a tela da clínica):
- falha ao decifrar a chave;
- `scope` diferente do último teste (alguém ampliou o usuário no MedX);
- 401 repentino depois de semanas de sucesso;
- volume fora do normal: chamadas a `/contatos` por ciclo acima de N, ou páginas acima do esperado.

Esses quatro sinais tornam detectáveis o vazamento da chave e o uso indevido. Sem eles, o prazo de comunicação à ANPD corre sem que ninguém saiba.

**A8 — Pedido de eliminação: o titular precisa ser informado.** A FIR é a cópia, e o MedX é a fonte. O spec registra, e o termo B1 repete, que um pedido de eliminação à clínica precisa ser atendido **nos dois sistemas**. O B3 impede a FIR de recriar o paciente, mas não apaga nada no MedX. A exportação do titular informa que os cartões vieram "da agenda do sistema da clínica" e não inclui nome de profissional nem de responsável (já é a regra de `retencao.md` §4).

## Notas

**N1 — Faturamento por dia.** Total e quantidade por dia, sem paciente, não é dado pessoal. Uma exceção marginal: num dia com quantidade 1, quem tem `valores` e vê a agenda pode inferir quanto um paciente pagou. O risco é baixo e fica coberto pela redação de `valores` (C.8). O mesmo parse em memória do B2 vale aqui: `/faturas` e `/pagamentos` trazem o paciente, e só data e valor passam pelo schema.

**N2 — Hospedagem (P-2).** A integração não cria transferência nova, já que MedX e VPS estão no Brasil (o host do MedX está a confirmar na pergunta 3). Mas ela aumenta o volume de dado de saúde na VPS, e isso pesa na decisão da P-2.

**N3 — Termos de uso do MedX.** Confirmar que a API de integração admite uso por terceiro em nome da clínica. É a premissa do caminho A.

**N4 — Como a chave chega ao superadmin (D3).** Se a clínica mandar o token por WhatsApp ou e-mail, ele fica copiado lá para sempre. O spec indica o canal: entrega numa chamada, com a clínica colando ou ditando, e depois o token é girado. Fica a critério do `especialista-seguranca-appsec`.
