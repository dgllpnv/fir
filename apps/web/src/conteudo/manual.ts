import { DICA_DO_NOME_DA_CAMPANHA } from './dica-do-nome-da-campanha'
import type { CapituloDoManual } from './tipos'

/**
 * **O manual da ferramenta: 14 capítulos escritos pela PO** — o `MANUAL` do
 * protótipo, portado palavra por palavra — **mais o capítulo 15 (Indicadores
 * & Insights) e as seções das três entregas do backlog final** (acesso por
 * e-mail, MedX, indicadores), escritos na mesma voz e conferidos contra o
 * código e as specs.
 *
 * Mesma razão de `ajuda.ts` para não morar no banco, e mesma regra sobre o
 * texto: só as passagens da **D-10** foram adaptadas.
 *
 * **O número do capítulo é um campo, e a ordem sai dele.** No array dela o
 * capítulo 13 vem antes do 12 — o sumário lia “… 11, 13, 12, 14”, contra a
 * numeração que o próprio texto declara. Com `numero` separado do `titulo`, a
 * ordem é derivada e o sumário não pode mais discordar do título.
 *
 * O `texto` é a marcação dela, e ela tem três regras só: linha começando com
 * `- ` é item de lista, `**assim**` é negrito, linha em branco separa
 * parágrafos. Quem a interpreta é `marcacao.ts`.
 */
export const MANUAL: readonly CapituloDoManual[] = [
  {
    id: 'm1',
    numero: 1,
    titulo: 'Visão geral',
    secoes: [
      {
        titulo: 'Para que serve a ferramenta',
        texto: `A FIR Clinic organiza o dia a dia da clínica em um só lugar: as tarefas da equipe, o relacionamento com os pacientes, os programas de acompanhamento, as campanhas comerciais e os pagamentos.

Cada coisa que precisa ser feita vira uma **tarefa**, com responsável e prazo. Quando a tarefa é concluída, fica registrada no histórico e alimenta os indicadores da clínica.`,
      },
      {
        titulo: 'Perfis de acesso',
        texto: `Cada pessoa tem um **perfil de acesso**, definido em **Configurações › Usuários e acessos**.
- **Administrador:** acesso total.
- **Perfis prontos:** Supervisão / gestão, Recepção, Comercial, Enfermagem e Financeiro. Podem ser editados, duplicados ou excluídos, e dá para criar novos.
- Na aba **Perfis de acesso**, as permissões ficam separadas por **pilar** (Dia a dia, Comercial, Financeiro, Processos, Pessoas, Gestão). Cada perfil é uma coluna: marque o que ele pode e salve.
- Algumas permissões dependem de outras: Painel geral e Visão do mês exigem “Ver valores financeiros”, e a ferramenta marca a dependência sozinha.
- Todos os perfis têm Hoje, as próprias tarefas, Nova tarefa, ficha do paciente (histórico), Minhas metas, Ajuda e Manual.
- Exemplo: quem deve ver a agenda e os orçamentos, mas não o financeiro, fica com Jornada do paciente e Pacientes marcados e “Ver valores financeiros” desmarcado.

Na aba **Pessoas**, escolha o perfil de cada uma. A mudança vale a partir do próximo acesso da pessoa.`,
      },
      {
        titulo: 'Como o menu está organizado',
        texto: `O menu segue as **quatro frentes de gestão**:
- **Dia a dia:** Hoje, Tarefas e os atalhos **+ Nova tarefa** e **+ Recebimento**.
- **Comercial:** Jornada do paciente, Pacientes, Programas (de acompanhamento) e Campanhas.
- **Financeiro:** Recebimentos, Caixa do dia, Contas a pagar, Cobranças e (administrativo) Visão do mês.
- **Processos:** Estoque.
- **Pessoas:** Equipe (fichas, metas, conversas 1:1 e banco de horas, para o administrativo) e Minhas metas.
- **Administrativo:** Painel geral e Configurações (Unidades, Usuários e acessos, Procedimentos).
- **Ajuda e manual**, no fim do menu.

No computador, cada frente abre ao passar o mouse. No celular, a barra de baixo traz Hoje, Tarefas, Nova, Programas e Menu.`,
      },
      {
        titulo: 'Cuidado com dados de pacientes',
        texto: 'Registre nas tarefas só o necessário para executar o contato. **Não inclua dados clínicos** (diagnósticos, exames, prescrições). A ferramenta é de gestão e relacionamento, não um prontuário.',
      },
    ],
  },
  {
    id: 'm2',
    numero: 2,
    titulo: 'Acesso',
    secoes: [
      {
        titulo: 'Entrar na ferramenta',
        texto: `Abra o link da ferramenta e informe três coisas: o **código da clínica**, o seu **usuário ou e-mail** e a sua **senha**.

O usuário é o nome curto que a clínica cadastrou para você (por exemplo, ana.silva). Ele é único na clínica, não muda, e foi feito para ser ditado por telefone sem ambiguidade. Quem cria o seu acesso é quem administra a clínica. O **e-mail** só serve para entrar depois de confirmado; até lá, entre pelo usuário.

No primeiro acesso há dois caminhos:
- **Convite por e-mail:** chega "Seu acesso à FIR Clinic", com o botão **Criar minha senha**. O link vale 7 dias e serve uma vez. Depois de criar a senha, entre com o seu e-mail ou usuário.
- **Senha provisória:** você usa a senha provisória que lhe foi passada, e a ferramenta pede uma senha nova antes de abrir qualquer tela.`,
      },
      {
        titulo: 'Primeiro acesso da clínica',
        gestao: true,
        texto: `A clínica e a primeira **administradora** são criadas pela Firmare. A senha dela é **provisória**: aparece uma única vez, vale 72 horas e é trocada no primeiro acesso.

No primeiro uso:
- Entre como administradora e troque a senha provisória.
- Cadastre a equipe em Configurações › Usuários e acessos e escolha o **perfil de acesso** de cada pessoa.
- Cadastre as unidades (se houver mais de um local) e revise os procedimentos e programas de modelo.`,
      },
      {
        titulo: 'Trocar a senha',
        texto: `Toque em “Trocar senha”, no rodapé do menu lateral (no celular, abra o Menu). Informe a senha atual e a nova duas vezes. As outras sessões abertas com a senha antiga caem na hora.

Esqueceu a senha? Na tela de entrada, toque em **Esqueci minha senha** e informe o seu e-mail confirmado: chega um link para criar uma senha nova, que vale 1 hora e serve uma vez. A resposta da tela é sempre a mesma, tenha o e-mail conta ou não. Sem e-mail confirmado (ou se o link não aparecer na entrada), quem administra a clínica gera uma **senha provisória** para você em Configurações › Usuários e acessos. Ela aparece uma única vez, na tela de quem a gerou: **ninguém lê a senha de outra pessoa**, nem quem a redefiniu.

**Cadastre seu e-mail.** Quem ainda não tem e-mail confirmado vê, no topo do sistema, o aviso **Cadastre seu e-mail**: informe o e-mail e a senha atual e toque em **Enviar confirmação**. O link de confirmação vale 24 horas. Até confirmar nada muda, e você continua entrando pelo usuário. "Agora não" esconde o aviso até a próxima entrada. Para trocar ou retirar o seu e-mail depois, use a parte **E-mail** de “Trocar senha” — sempre com a senha atual.`,
      },
      {
        titulo: 'Links que chegam por e-mail',
        texto: `Três links podem chegar no seu e-mail. Cada um serve **uma vez**, e só o mais recente vale: pedir outro cancela o anterior.
- **Convite** ("Seu acesso à FIR Clinic"), com o botão **Criar minha senha**: vale 7 dias.
- **Senha nova**, pedida em **Esqueci minha senha** ou enviada por quem administra a clínica: vale 1 hora.
- **Confirmação do e-mail**, pedida no aviso **Cadastre seu e-mail**: vale 24 horas.

Ao criar a senha pelo link, a tela mostra "Senha criada. Agora entre com seu e-mail ou usuário." As outras sessões abertas com a senha antiga caem.

A tela diz **"Este link não vale mais"**? Ele venceu, já foi usado ou foi trocado por um mais novo. Peça outro na tela de entrada (Esqueci minha senha) ou a quem administra a clínica.`,
      },
      {
        titulo: 'Usar no celular',
        texto: 'A ferramenta funciona no navegador do celular. Para ter um atalho como se fosse um aplicativo, abra o link e use a opção “Adicionar à tela inicial” do navegador.',
      },
    ],
  },
  {
    id: 'm3',
    numero: 3,
    titulo: 'Tela Hoje',
    secoes: [
      {
        titulo: 'O que aparece',
        texto: `- **Semana:** os sete dias, com bolinhas douradas nos dias que têm tarefas e vermelhas quando há atraso. Toque em um dia para ver as tarefas dele; use as setas para trocar de semana.
- **Aniversário hoje:** pacientes que fazem aniversário no dia, com atalho “Criar tarefa” para o contato.
- **Pendentes de dias anteriores:** tarefas atrasadas, **recolhidas** (aparece só o número). Toque para ver a lista. Ficam aqui todos os dias até serem concluídas ou canceladas.
- **Hoje:** tarefas com prazo no dia.
- **Sessões de programas:** as aplicações e sessões do dia (e as atrasadas) de quem é responsável, para concluir ali mesmo; a baixa no estoque é automática.
- **Financeiro:** o lembrete de fechar o caixa (para a responsável) e as contas a pagar dos próximos 3 dias.
- **Recontatar:** pacientes que faltaram ou desmarcaram, até reagendar ou encerrar.
- **Próximos passos da jornada:** agendamentos de amanhã para confirmar (com a mensagem pronta no WhatsApp) e orçamentos para retomar.

O administrativo abre a tela Hoje em **Equipe toda**, a visão da clínica; a equipe abre em **Para mim**. Textos de explicação aparecem no ícone **i**, ao passar o mouse ou tocar.

Se alguma tarefa do dia não aparece por causa do filtro de pessoa, um aviso logo abaixo dos filtros mostra quantas são, com o atalho para vê-las. Tocar em **Hoje** no menu sempre volta para o dia de hoje.`,
      },
      {
        titulo: 'Filtros de pessoa',
        texto: `- **Para mim:** tarefas em que você é a responsável por executar.
- **Que solicitei:** tarefas que você pediu para outra pessoa.
- **Equipe toda:** todas as tarefas da clínica.`,
      },
      {
        titulo: 'Cartão da tarefa',
        texto: `Cada tarefa mostra o paciente (quando houver), o tipo de contato, a descrição, quem executa, o prazo e etiquetas como “Atrasada” e “Urgente”.

- **Círculo:** conclui a tarefa.
- **Editar:** corrige os dados da tarefa sem concluir.
- **Cancelar tarefa:** disponível para quem solicitou e para o administrativo.
- **WhatsApp:** aparece quando o paciente tem telefone. No celular abre o seu WhatsApp; no computador abre o WhatsApp Web.`,
      },
    ],
  },
  {
    id: 'm4',
    numero: 4,
    titulo: 'Tarefas',
    secoes: [
      {
        titulo: 'Criar uma tarefa',
        texto: `Toque em “Nova tarefa” e escolha:
- **Tarefa interna:** rotina da equipe, sem paciente (ex.: inventário do estoque, conferir agenda).
- **Vinculada a paciente:** qualquer contato, atendimento ou pagamento de um paciente.

Preencha a descrição, o responsável por executar e o prazo. Opcionalmente: horário, unidade, campanha e “Marcar como urgente”.

**Agendamento de consulta ou procedimento:** a tela fica enxuta, só com paciente, tipo, data, horário, responsável e campanha. Descrição, unidade, urgente e repetir ficam em **“+ Mais opções”**. Paciente novo precisa da unidade principal.`,
      },
      {
        titulo: 'Lançar algo que já aconteceu',
        texto: 'Marque **“Já foi realizada (lançamento retroativo)”** e informe a data de realização. A tarefa já é criada como concluída. Útil para registrar um pagamento ou atendimento que não passou pela ferramenta na hora.',
      },
      {
        titulo: 'Tarefas que se repetem',
        texto: `No campo **Repetir**, escolha: Todos os dias, Dias úteis, Semanal, A cada 15 dias, Mensal ou A cada X dias, e até quando repetir.

Ao editar uma tarefa da série, é possível aplicar as alterações também às próximas em aberto. Se o prazo mudar, as próximas são deslocadas na mesma quantidade de dias.`,
      },
      {
        titulo: 'Concluir × Editar',
        texto: `Essa é a dúvida mais comum.
- **Concluir** (tocar no círculo) registra que a tarefa foi feita. É aí que entram a data de realização, o resultado do contato e o pagamento, quando houver.
- **Editar** serve só para corrigir dados (descrição, prazo, responsável). Não conclui nada.

Para registrar algo que aconteceu, use sempre **Concluir**. Precisa de um próximo passo (enviar exame, marcar retorno)? No painel de conclusão, marque **“Criar uma nova tarefa a partir desta”** e toque em **Concluir e criar nova tarefa**: a tarefa é concluída e a Nova tarefa abre já com a paciente escolhida. Vale para qualquer tarefa, inclusive as que vieram de campanha. Se a data de realização for depois do prazo, a tarefa conta como concluída com atraso.`,
      },
      {
        titulo: 'Jornada do paciente: agendamento até o fechamento',
        texto: `Consultas e procedimentos agendados seguem a **jornada do paciente**. É sempre **a mesma tarefa**, que muda de etapa; não se cria tarefa nova a cada passo.
- **Enviar confirmação**: abre o WhatsApp com a mensagem pronta (“Olá, Fulana! … confirmar sua consulta amanhã às 10h”). Dá para editar antes de enviar. O envio fica registrado no cartão (“confirmação enviada, aguardando resposta”).
- **Agendada** → **Confirmada**: quando a paciente responder, toque em “Confirmou”. Os agendamentos de amanhã aparecem na tela Hoje, em “Próximos passos da jornada”.
- **No-show** e **Desmarcou**: ficam registrados (no-show entra na taxa de no-show) e o cartão **continua aberto** em “Recontatar”, na tela Hoje, até alguém reagendar ou encerrar. Assim ninguém esquece de ligar para quem faltou ou desmarcou.
- **Reagendar** devolve o cartão para Agendada com a nova data; **Encerrar** fecha sem reagendar, com motivo opcional.
- **Realizada**: tocar no círculo conclui o atendimento (e pergunta se recebeu algum valor).
- **Orçamento enviado**: “Registrar orçamento”, com valor e data para retomar o contato (2 dias, por padrão). Se for programa, marque “É um programa” e monte os procedimentos e sessões como a médica prescreveu: o valor sugerido já aparece. O cartão mostra o que foi orçado, item por item (procedimento, sessões e intervalo). No dia de retomar, o cartão aparece em “Orçamentos para retomar”. “Registrar follow-up” anota o contato e marca o próximo.
- **Corrigir orçamento**: digitou errado? Enquanto o orçamento está em aberto, quem pediu, quem atende ou quem acompanha a equipe corrige o valor, a data de retomar e “o que foi orçado”. Para mudar os procedimentos, marque “Corrigir os procedimentos do orçamento”: a lista já vem com o que foi orçado, e é só ajustar sessões, intervalo ou trocar itens. Quem não marcar não muda nada neles. A etapa não muda, a correção aparece na “Evolução” (de → para), e o funil dos meses já fechados continua igual.
- **Fechou**: abre, no próprio cartão, o formulário do fechamento. Informe o **valor recebido agora**, a forma de pagamento e o **valor em aberto** (o que fica para depois, que vira **saldo em aberto** da paciente). Se o orçamento tinha programa, ele já vem montado para você confirmar a data de início. O dinheiro entra no caixa de hoje e **não se lança de novo em Recebimentos**. Se a consulta já tinha pagamento próprio, o do orçamento é registrado à parte, como “Pagamento de orçamento”, e o da consulta não muda.
- **Perdeu**: encerra o orçamento com o motivo (preço, sem retorno, outro lugar, momento, outro).
- **Reabrir** (círculo da tarefa concluída): volta o atendimento para a etapa anterior, e o pagamento que estava dentro dele é **estornado** (deixa de contar no caixa, mas fica registrado). Funciona até o orçamento ser fechado ou perdido. Depois de **Fechou** ou **Perdeu** não se reabre: se o fechamento foi lançado por engano, abra **Editar** e use **Excluir** (o pagamento é estornado e o programa criado é encerrado).

Cada movimento fica em **“Evolução”**, no próprio cartão: etapa, data, quem fez e observação.`,
      },
      {
        titulo: 'Tela Jornada do paciente',
        texto: `Em **Comercial › Jornada do paciente**, com filtro de **período**, pessoa e unidade:
- **Funil:** agendados, confirmados, realizados, orçamentos enviados e fechados, com a conversão entre as etapas.
- Para o administrativo, cada etapa mostra também o **valor**: realizados (recebido no atendimento), orçamentos enviados (valor orçado), fechados (valor fechado) e perdidos (valor dos orçamentos perdidos).
- **No-show** (quantidade e taxa), desmarcados e orçamentos perdidos.
- **Onde estão os pacientes agora:** colunas com os cartões de cada etapa. Toque no nome para abrir a ficha.

Os números contam os movimentos registrados no período escolhido.`,
      },
      {
        titulo: 'Agenda ligada ao MedX',
        texto: `Quando a agenda da clínica está ligada ao MedX, **a recepção marca, remarca e cancela só no MedX**. A ferramenta lê a agenda a cada 15 minutos e cuida sozinha do cartão da jornada:
- **Consulta ou procedimento novo no MedX:** aparece um cartão **Agendada**, para a pessoa responsável pelos cartões da agenda.
- **Mudou a data ou o horário:** o mesmo cartão é reagendado. Nenhum cartão novo.
- **Cancelado ou apagado no MedX:** o cartão vai para **Recontatar**, na tela Hoje, para alguém falar com a paciente. Nunca é cancelado sozinho.
- **Paciente que ainda não existe aqui:** é cadastrada com o selo **Conferir cadastro**. Confira nome e telefone e salve a ficha. Paciente desativada não volta pela agenda.

O que a equipe faz na ferramenta (confirmar, no-show, concluir, registrar orçamento) **nunca é desfeito** pela leitura. E nada volta para o MedX: confirmação e falta ficam registradas só aqui.`,
      },
      {
        titulo: 'Cancelar e excluir',
        texto: `- **Cancelar:** a tarefa não vai mais acontecer. Fica no histórico como cancelada. Pode ser feito por quem solicitou ou pelo administrativo.
- **Excluir** (dentro de Editar): tira a tarefa das listas, só para lançamentos feitos por engano. O histórico fica guardado. Se a tarefa tem pagamento, o sistema pede para **reabrir antes** (o que estorna o pagamento) e só então excluir. Em tarefas recorrentes, é possível excluir só esta ou esta e as próximas.`,
      },
      {
        titulo: 'Tela Tarefas: buscar e filtrar',
        texto: `Na tela Tarefas, combine os filtros:
- **Solicitante** e **Responsável por executar**.
- **Situação** (abertas, concluídas, canceladas…) e **Período**, ambos em lista suspensa.
- **Buscar:** paciente, descrição ou resultado.
- **Tipo**, **Campanha** e **Unidade**.

O período considera a data de realização das concluídas e o prazo das demais.`,
      },
    ],
  },
  {
    id: 'm5',
    numero: 5,
    titulo: 'Tipos de contato',
    secoes: [
      {
        titulo: 'Agenda',
        texto: `- **Consulta agendada:** consulta marcada. Ao concluir, vira **Consulta realizada** na mesma tarefa, com o pagamento, se houver.
- **Procedimento agendado:** procedimento marcado. Ao concluir, vira **Procedimento realizado**.
- **Reagendamento:** consulta, procedimento ou sessão remarcados.
- **Confirmação:** confirmação de presença.`,
      },
      {
        titulo: 'Atendimento',
        texto: `Contam como paciente atendido.
- **Consulta realizada** e **Procedimento realizado:** o pagamento recebido no atendimento fica registrado na própria tarefa.
- **Sessão de plano:** criada automaticamente pelo programa de acompanhamento.`,
      },
      {
        titulo: 'Orçamento',
        texto: '- **Orçamento enviado:** proposta apresentada ao paciente. O valor do orçamento **não** entra na receita; serve para medir a conversão (enviados × pagos).',
      },
      {
        titulo: 'Pagamentos',
        texto: `Só os pagamentos entram na receita e no LTV.
- **Sinal de consulta:** valor adiantado para reservar a consulta.
- **Pagamento de consulta:** valor pago pela consulta.
- **Pagamento de orçamento:** orçamento fechado; valor pago agora (total ou entrada).
- **Pagamento de saldo em aberto:** parcela ou restante de um valor em aberto. Abate o saldo do paciente.`,
      },
      {
        titulo: 'Relacionamento',
        texto: `- **Follow-up:** retomar conversa em andamento (ex.: orçamento sem resposta).
- **Recaptação:** paciente sem retorno há algum tempo.
- **Retorno de procedimento:** paciente que já pode repetir um procedimento (criado automaticamente pelo catálogo).
- **Contato de indicação:** com o paciente indicado ou com quem indicou.
- **Aniversário:** mensagem de aniversário.
- **Pós-consulta:** acompanhamento depois da consulta ou procedimento.
- **Outros:** qualquer outro contato.`,
      },
    ],
  },
  {
    id: 'm6',
    numero: 6,
    titulo: 'Atendimentos e pagamentos',
    secoes: [
      {
        titulo: 'Consulta agendada que aconteceu',
        texto: `Conclua a própria tarefa “Consulta agendada”. Ela passa a ser **Consulta realizada** automaticamente. Se houve pagamento, preencha o bloco **“Houve pagamento?”** na mesma tela: valor pago, forma de pagamento e, se faltar algo, valor em aberto.

Não é preciso criar outra tarefa. O mesmo vale para Procedimento agendado.`,
      },
      {
        titulo: 'Registrar um recebimento',
        texto: `Todo dinheiro recebido entra por **Financeiro › Recebimentos**. Atendimento é tarefa; dinheiro é recebimento.
- Escolha o **paciente**.
- Diga **o que ele está pagando**: Consulta ou procedimento, Sinal de consulta, Orçamento fechado (venda), Programa em andamento ou Saldo em aberto.
- Informe o **valor recebido**, a **forma de pagamento** (Pix, Dinheiro, Cartão de crédito, Cartão de débito ou Nota promissória) e a data.
- Se ficou uma parte para depois, informe em **“Ficou valor em aberto?”**.

O formulário mostra os recebimentos do paciente nos últimos 7 dias, para evitar lançar o mesmo pagamento duas vezes. Embaixo, a lista **Recebimentos de hoje** ajuda a conferir o caixa do dia.`,
      },
      {
        titulo: 'Consulta ou recebimento da consulta?',
        texto: `São duas coisas diferentes:
- A **consulta** é o atendimento: conclua a tarefa da consulta.
- O **dinheiro** é o recebimento. Se o paciente pagou na hora, responda **“Recebeu algum valor?”** ao concluir a consulta. Pronto: não lance de novo.
- Se pagou em outro momento (sinal antes, ou restante depois), use **Recebimento › Consulta ou procedimento** ou **Sinal de consulta**.`,
      },
      {
        titulo: 'Desfazer um lançamento feito por engano',
        texto: `Nada de dinheiro é apagado: ele é **estornado**, deixa de contar no caixa e a trilha mostra quem fez e quando. O caminho depende de onde o dinheiro foi lançado:
- **Dentro do atendimento** (“Houve pagamento?”): **reabra** o atendimento (círculo da tarefa concluída). O pagamento é estornado e a tarefa volta para a etapa anterior. Se for só um teste, depois de reabrir use **Editar › Excluir**.
- **Em Financeiro › Recebimentos** (recebimento avulso, inclusive o “Pagamento de orçamento”): na lista **Recebimentos de hoje**, toque em **Estornar** e confirme. O recebimento sai da conta do dia.
- **Orçamento já fechado:** abra o atendimento em Tarefas, toque em **Editar** e use **Excluir**. O pagamento é estornado e o programa que nasceu no fechamento é encerrado; as sessões já feitas ficam registradas.

Dica: antes de lançar de novo, confira a lista de recebimentos da paciente. Um pagamento não deve existir duas vezes.`,
      },
      {
        titulo: 'Programa em andamento × programa novo',
        texto: `- **Programa novo:** o paciente acabou de fechar (venda). Use Recebimento › Orçamento fechado; dá para programar as sessões do catálogo na mesma tela.
- **Programa em andamento:** o paciente já faz o programa e está pagando uma parcela ou uma sessão. Use Recebimento › Programa em andamento e escolha o programa. O valor abate o saldo dele.

Nunca registre como “programa novo” o pagamento de um programa que já está rodando: isso conta uma venda que não aconteceu.`,
      },
      {
        titulo: 'Pagamento parcial e saldo em aberto',
        texto: `Exemplo: orçamento de R$ 3.000, paciente pagou R$ 1.000 de entrada.
- Lance um **Pagamento de orçamento** com valor pago R$ 1.000 e valor em aberto R$ 2.000.
- A cada parcela, lance um **Pagamento de saldo em aberto** com o valor recebido. O saldo do paciente diminui automaticamente.

Também é possível usar **“Registrar recebimento”** na ficha do paciente, escolhendo de qual saldo abater.`,
      },
      {
        titulo: 'Orçamento com programa ou procedimento do catálogo',
        texto: `O caminho mais simples é montar o programa **no orçamento** (cartão da jornada › Registrar orçamento › “É um programa”): escolha o procedimento e o número de sessões; intervalo, dose, responsável e valor já vêm do cadastro e ficam em “Ajustar”. No **Fechou**, o programa já vem montado e o saldo é calculado sozinho.

Sem orçamento registrado, monte no Recebimento › Orçamento fechado, marcando **“É um programa de acompanhamento: montar agora”**.`,
      },
      {
        titulo: 'O que conta como receita',
        texto: `Entram na receita e no LTV:
- Os quatro tipos do grupo Pagamentos.
- O pagamento registrado ao concluir Consulta realizada, Procedimento realizado ou Sessão de plano.

**Não** entram: valor de Orçamento enviado e valor em aberto (só conta quando for pago).`,
      },
    ],
  },
  {
    id: 'm7',
    numero: 7,
    titulo: 'Pacientes e relacionamento',
    secoes: [
      {
        titulo: 'Cadastrar paciente',
        texto: `Em **Pacientes › Novo paciente**, ou direto ao criar uma tarefa vinculada a paciente. Informe:
- Nome e telefone (para o botão de WhatsApp).
- Data de nascimento (para o lembrete de aniversário).
- **Data da última consulta** (opcional): para pacientes que já eram atendidos antes da ferramenta.
- **Origem:** Indicação, Instagram, WhatsApp, Google, Site, Convênio, Fachada, Evento ou Outro. Em Indicação, é possível registrar quem indicou.
- **Unidade principal**, quando a clínica tem mais de um local.`,
      },
      {
        titulo: 'Importar a lista de pacientes',
        gestao: true,
        texto: `Para cadastrar toda a base de uma vez, use **Pacientes › Importar pacientes**:
- Toque em **“Baixar planilha modelo”** e preencha uma linha por paciente: **Nome completo** (obrigatório), **Telefone**, **Data de nascimento** e **Data da última consulta** (datas em dd/mm/aaaa).
- Se a clínica tem unidades, escolha a unidade principal dos pacientes da lista.
- Escolha o arquivo (.xlsx, .xls ou .csv), ou cole as linhas, e toque em **“Ler lista”**.
- Confira a prévia: pacientes novos, já cadastrados que terão dados completados, linhas com erro e repetidas. Toque em **Importar**.

Paciente já cadastrado (mesmo nome ou mesmo telefone) **não é duplicado**: a ferramenta só completa o que estiver vazio e atualiza a última consulta quando a da lista for mais recente. Nada que já existe é apagado. Limite de 2.000 pacientes por importação.`,
      },
      {
        titulo: 'Tela de relacionamento',
        texto: `A tela Pacientes mostra os indicadores de relacionamento com filtro de **período**: pacientes cadastrados, atendidos, pacientes por origem e, para o administrativo, receita e LTV médio.

Na lista, é possível buscar por nome ou telefone, ordenar, filtrar por origem e usar os atalhos **Todos**, **Aniversariantes do mês**, **Com tarefa em aberto** e **Sem retorno há 6+ meses** (último atendimento ou última consulta há mais de seis meses, do mais antigo para o mais recente; bom ponto de partida para campanhas de recaptação).`,
      },
      {
        titulo: 'Ficha do paciente',
        texto: `Reúne todo o histórico: consultas, procedimentos, contatos, orçamentos, programas e pagamentos, com filtro de período, e mostra a **última consulta** (a mais recente registrada na ferramenta ou informada no cadastro).

Para o administrativo, mostra também:
- **LTV:** total já pago à clínica, com número de pagamentos e ticket médio.
- **Saldo em aberto:** quanto o paciente ainda deve.

Atalhos da ficha: Editar cadastro, Registrar recebimento e Adesão a programa.

**Consumo:** tudo o que saiu do estoque para o paciente, com data, produto, dose, procedimento, lote e quem aplicou. As baixas das sessões de programa entram sozinhas; um uso avulso se lança pelo estoque, em **Registrar saída › Uso em paciente**.`,
      },
      {
        titulo: 'Excluir paciente',
        texto: 'Só o administrativo exclui pacientes. A exclusão apaga também as tarefas vinculadas, por isso pede confirmação. Use apenas para cadastros feitos por engano.',
      },
    ],
  },
  {
    id: 'm8',
    numero: 8,
    titulo: 'Programas de acompanhamento',
    secoes: [
      {
        titulo: 'Como funcionam',
        texto: `O programa é **montado para cada paciente**, como um pedido: escolha os procedimentos do catálogo e, em cada um, o número de sessões, o intervalo e a dose. Exemplo:
- Tirzepatida, 4 sessões a cada 7 dias, 2,5 mg.
- Tirzepatida, 4 sessões a cada 7 dias, 5 mg, **começando depois do item 1**.
- Drenagem linfática, 3 sessões a cada 30 dias, na data de início.

Procedimentos de sessão única (ex.: toxina botulínica) também entram como programa de 1 sessão, para gerar o contato de retorno. Programas antigos continuam funcionando como programa de um item só.`,
      },
      {
        titulo: 'Catálogo de procedimentos',
        gestao: true,
        texto: `Em **Configurações › Procedimentos**, cadastre cada procedimento com:
- **Sessões sugeridas** e **intervalo sugerido** (podem ser mudados na montagem de cada programa).
- **Valor de referência por sessão** (só o administrativo vê): soma o valor sugerido do programa.
- **Baixa no estoque por sessão:** o insumo principal com a quantidade padrão (ex.: 1 ampola) e os **descartáveis** usados em toda sessão (ex.: 1 seringa e 1 agulha).
- Frequência para repetir e antecedência do contato de retorno.`,
      },
      {
        titulo: 'Nova adesão',
        texto: `Em **Programas › Nova adesão** (ou na ficha do paciente, “Adesão a programa”), escolha o paciente e a **data de início** e monte os itens:
- **Procedimento**, **sessões**, **a cada (dias)** e quando **começa**: na data de início, depois de outro item ou em outra data.
- **Responsável** e **valor por sessão** (opcional).
- **Insumo do estoque** e **dose por sessão**: já vêm do cadastro do procedimento e podem ser ajustados para a dose daquele paciente. Nos itens com unidade de uso, a dose é informada nela (ex.: 2,5 mg) e a ferramenta converte (0,5 ampola).
- **Dose / observação:** texto livre que aparece em cada sessão (ex.: 2,5 mg).

“+ Adicionar procedimento” inclui mais itens. O resumo mostra as datas de cada item e o valor sugerido. Depois informe o **valor total do programa**, o **pago na adesão** e a forma de pagamento. Se o valor total for maior que o pago, a diferença vira **saldo a receber** do programa, abatido a cada pagamento.

O mesmo montador aparece no **Recebimento › Orçamento fechado**, ao marcar “É um programa de acompanhamento”.`,
      },
      {
        titulo: 'Baixa automática no estoque',
        texto: `Ao concluir uma sessão, a ferramenta **dá baixa sozinha** no estoque: o insumo do item na quantidade definida (a dose) e os descartáveis do procedimento. Se a sessão for reaberta ou o programa excluído, a baixa é desfeita.

Nas tarefas avulsas de **Procedimento realizado** a baixa não é automática: lance o que foi usado no estoque, em **Registrar saída › Uso em paciente**.

Cada baixa fica ligada ao paciente, com a dose e o lote, na aba **Consumo** da ficha. Na análise do estoque, o saldo esperado (contagem inicial + entradas − saídas registradas) é comparado com a contagem final: a diferença mostra o que saiu sem registro (desperdício, sessão não lançada ou desvio).`,
      },
      {
        titulo: 'Concluir uma sessão',
        texto: `Toque no círculo da sessão e informe a **data de realização**. Se a sessão aconteceu em outra data, escolha:
- **Reprogramar a partir da data de realização:** as próximas sessões daquele item seguem o intervalo a partir dessa data. Os itens que começam depois dele também são empurrados, se ainda não começaram.
- **Manter as datas originais.**

Se houve pagamento, preencha **“Houve pagamento?”**. Quando o programa tem saldo, o valor recebido abate o saldo.`,
      },
      {
        titulo: 'Contatos dentro do programa',
        texto: `Na página do programa, “Nova tarefa do programa” oferece só os tipos que fazem sentido ali: Sessão de plano, Pagamento de saldo em aberto, Reagendamento, Contato de indicação e Pós-consulta.

Se o paciente tem saldo em aberto, a **próxima sessão mostra um alerta** com o valor, para lembrar a cobrança no atendimento.`,
      },
      {
        titulo: 'Tela Programas',
        texto: `- Indicadores: pacientes em programa, sessões hoje, sessões atrasadas e (administrativo) saldo a receber, com “Ver quem deve”.
- **Sessões atrasadas:** ficam até serem realizadas. Paciente com sessão atrasada é risco de abandono.
- Hoje, Realizadas hoje e Próximos 7 dias.
- **Contatos de retorno · até 30 dias:** pacientes que já podem repetir o procedimento.
- Lista de pacientes em programa com busca, filtro por programa, por unidade e por situação (em andamento, com atraso, com saldo a receber, concluídos, encerrados).`,
      },
      {
        titulo: 'Fim do programa e contato de retorno',
        texto: `Quando a última sessão é concluída, se o procedimento tem **frequência para repetir** cadastrada, a ferramenta cria sozinha uma tarefa de **Retorno de procedimento**, com a antecedência definida no cadastro e para o responsável definido.

Exemplo: toxina botulínica, repetir a cada 4 meses, contato 15 dias antes.`,
      },
      {
        titulo: 'Encerrar ou excluir um programa',
        gestao: true,
        texto: `- **Encerrar programa:** o paciente parou antes do fim. Informe o motivo; as sessões em aberto são canceladas e as realizadas ficam no histórico.
- **Excluir adesão:** só para registros feitos por engano. Apaga a adesão e todas as sessões, inclusive as realizadas, e desfaz as baixas de estoque delas.`,
      },
    ],
  },
  {
    id: 'm9',
    numero: 9,
    titulo: 'Campanhas',
    secoes: [
      {
        titulo: 'Campanhas no dia a dia',
        texto: `As campanhas são criadas pelo administrativo. A equipe executa as tarefas da campanha normalmente, pela tela Hoje ou pela página da campanha, e pode vincular a uma campanha qualquer tarefa ou pagamento que veio dela (campo “Campanha” na tarefa).

**Campanha do paciente:** ao cadastrar um paciente novo, responda “Chegou por uma campanha?”. A partir daí, e também para pacientes que já estão na lista de uma campanha em andamento, o campo Campanha já vem **sugerido** nos agendamentos e recebimentos dele. Assim o resultado da campanha é medido sem depender de lembrar de marcar.`,
      },
      {
        titulo: 'Criar uma campanha',
        gestao: true,
        texto: `Em **Campanhas › Nova campanha**, informe:
- **Tipo:** Aniversariantes, Recaptação, Procedimento específico, Orçamentos em aberto, Data comemorativa, Indicação ou Outra.
- Procedimento em foco (opcional), nome, objetivo ou roteiro, início e fim.
- **Meta** e a métrica dela.

**${DICA_DO_NOME_DA_CAMPANHA}** O nome da campanha aparece ao lado da paciente nas tarefas, nos recebimentos e na ficha dela; um nome como o de um medicamento diria a quem lê qual tratamento ela faz.`,
      },
      {
        titulo: 'Métricas da meta',
        texto: `- **Pacientes convertidos:** pacientes da campanha com consulta, procedimento ou orçamento pago concluído.
- **Contatos realizados:** contatos concluídos com pacientes, sem contar pagamentos.
- **Tipo de contato:** quantidade de tarefas concluídas de um tipo escolhido.
- **Receita:** soma dos pagamentos vinculados à campanha (resultado visível só para o administrativo).`,
      },
      {
        titulo: 'Importar lista de pacientes',
        gestao: true,
        texto: `Dentro da campanha, use **“Importar lista de pacientes”**:
- Toque em **“Baixar planilha modelo”** e preencha uma linha por paciente. A coluna **Observação** vai para a tarefa.
- Escolha o arquivo (.xlsx, .xls ou .csv) e toque em **“Ler lista”**.
- Confira a prévia e confirme. Uma tarefa é criada para cada paciente; quem ainda não tem cadastro é cadastrado automaticamente.`,
      },
      {
        titulo: 'Acompanhar resultados',
        texto: `A página da campanha mostra o andamento da meta, o **funil** (ações planejadas, realizadas, pacientes alcançados, convertidos e receita), as ações por tipo, quem executou e o histórico de campanhas do mesmo tipo em outros meses.

**“Repetir no próximo mês”** cria a mesma campanha para o mês seguinte. Para vincular um pagamento à campanha, escolha a campanha no lançamento.`,
      },
    ],
  },
  {
    id: 'm10',
    numero: 10,
    titulo: 'Painel',
    gestao: true,
    secoes: [
      {
        titulo: 'Período',
        texto: 'Escolha 7 dias, 30 dias, Este mês, Mês passado ou Personalizado. Os prazos consideram as tarefas com vencimento no período; contatos e valores contam pela data em que a tarefa foi concluída. Toque nos números com “Ver registros” para abrir a lista.',
      },
      {
        titulo: 'Cumprimento de prazos',
        texto: 'Percentual de tarefas concluídas no prazo, tarefas no período, no prazo, concluídas com atraso, atrasadas em aberto e a vencer. Abaixo, a distribuição por responsável e quem solicitou.',
      },
      {
        titulo: 'Pacientes no período',
        texto: `- **Receita registrada**, ticket médio, contatos realizados e orçamentos pagos (com a conversão sobre os enviados).
- **Forma de pagamento:** quanto entrou por Pix, dinheiro, cartões e nota promissória.
- **Top 10 pagantes:** pacientes que mais pagaram, no período ou desde o início. Toque no nome para abrir a ficha.
- **Valores em aberto:** todos os saldos a receber, por paciente.
- Campanhas no período, desempenho por unidade e novos pacientes.`,
      },
      {
        titulo: 'Faturamento no MedX',
        texto: `Com o faturamento do MedX ligado, o Painel mostra o **Faturamento no MedX** ao lado do recebido na ferramenta, com a hora da última leitura, a **Diferença MedX − FIR** (positiva: o MedX registrou mais) e os dias em que os dois discordam.

Os dois números ficam **lado a lado e nunca se somam**: o do MedX não entra no caixa, na receita nem no LTV. "Leitura incompleta" quer dizer que algum dia do período ainda não foi lido do MedX. Quando a meta de faturamento é medida pelo MedX, a Visão do mês avisa "Medida pelo faturamento lido do MedX".`,
      },
    ],
  },
  {
    id: 'm11',
    numero: 11,
    titulo: 'Cadastros da gestão',
    gestao: true,
    secoes: [
      {
        titulo: 'Equipe',
        texto: `Em **Configurações › Usuários e acessos**, cadastre cada pessoa com nome, **usuário para entrar**, **e-mail** (obrigatório; prefira o de trabalho) e função, e escolha o **perfil de acesso**. Com o envio de e-mail ligado, ela recebe um **convite** para criar a própria senha, e você nunca a vê. Com o envio desligado, a senha provisória é gerada pela ferramenta e aparece uma única vez, para ser passada à pessoa.
- **Selos:** "Convite pendente", "Convite vencido" (o link de 7 dias passou) e "E-mail não confirmado". Ao abrir a pessoa, **Reenviar convite** manda um link novo e invalida o anterior; **Enviar link para redefinir senha** só vale para quem tem e-mail confirmado. Com o envio ligado, é o link que aparece primeiro: a pessoa cria a senha nova e ninguém mais a conhece. Se ela não consegue abrir o e-mail agora, **Sem acesso ao e-mail? Gerar senha provisória** continua disponível, e a provisória aparece uma única vez. Esvaziar o e-mail no cadastro o retira.
- **Perfil de acesso:** é ele que decide o que a pessoa vê — valores em reais, Painel geral e Equipe estão em perfis próprios. Os perfis são editados na aba **Perfis de acesso**, desta mesma tela.
- **Pode entrar na ferramenta?** responda “Não” quando a pessoa sair da clínica. O acesso dela cai na hora e o histórico é mantido.`,
      },
      {
        titulo: 'Unidades',
        texto: `Em **Configurações › Unidades**, cadastre os locais de atendimento (nome e endereço). Cada paciente tem uma unidade principal; atendimentos, pagamentos e programas herdam a unidade dele e podem ser trocados quando o atendimento for em outro local.

Com unidades cadastradas, aparecem filtros por unidade em Tarefas, Programas e no Painel, e a tabela de desempenho por unidade.`,
      },
      {
        titulo: 'Procedimentos',
        texto: `Em **Configurações › Procedimentos**, cadastre:
- Nome, número de sessões, intervalo entre sessões e nome de cada sessão (Aplicação, Sessão…).
- Responsável padrão e valor de referência (sugerido na adesão).
- **Repetição do procedimento:** de quanto em quanto tempo pode repetir, quantos dias antes fazer o contato e quem faz. Deixe em branco quando não houver retorno.

A clínica já começa com modelos, que podem ser editados.

**Excluir:** em Editar, “Excluir do catálogo” (toque duas vezes para confirmar). Só itens que nunca foram usados em uma adesão podem ser excluídos, porque o histórico e o contato de retorno desses pacientes dependem do item. Para os demais, desmarque **Ativo**: o item deixa de ser oferecido em novas adesões. Mudanças de sessões e intervalo valem para novas adesões; quem já está no programa mantém as sessões programadas.`,
      },
      {
        titulo: 'Agenda do sistema e MedX',
        texto: `Em **Configurações › Agenda do sistema** fica a ligação com a agenda do sistema principal da clínica, que cria e reagenda os cartões da jornada sozinha. Há dois caminhos:
- **Link iCal:** cole o link da agenda e escolha quem fica responsável pelos cartões.
- **MedX:** quem liga é o suporte da Firmare, com a autorização por escrito da clínica. A tela mostra **Ligada ao MedX**, para quem vão os cartões, a última leitura, o último sucesso e as últimas leituras.

**Sincronizar agora** pede uma leitura na hora; **Atualizar** só recarrega a tela. Se aparecer "A última leitura falhou", nenhum cartão foi mexido por ela. Para ligar, desligar ou mudar o MedX, fale com o suporte da Firmare: a chave do MedX não aparece para a clínica.`,
      },
    ],
  },
  {
    id: 'm12',
    numero: 12,
    titulo: 'Estoque',
    secoes: [
      {
        titulo: 'Como funciona',
        texto: `O estoque da ferramenta é uma **rotina de inventário**. Não substitui o sistema principal da clínica: o uso por paciente continua lá.

A conta é sempre a mesma: **contagem anterior + entradas − descartes − contagem atual = consumo do período**. Cada nova contagem vira o ponto de partida do período seguinte, e o histórico fica guardado.`,
      },
      {
        titulo: 'Locais do estoque',
        gestao: true,
        texto: `Em **Estoque › Locais**, cadastre onde os itens ficam na clínica: sala de estoque, sala de enfermagem, geladeira, sala da doutora. Cada item fica em **um local**.

A lista de contagem pode ser gerada por local (“só a geladeira”, “só a sala da doutora”), e a lista impressa sai agrupada por local, como um roteiro. Antes do primeiro inventário, vale organizar fisicamente o estoque para que cada item esteja no seu lugar.`,
      },
      {
        titulo: 'Cadastrar itens',
        gestao: true,
        texto: `Em **Processos › Estoque › Cadastrar item**: nome, categoria, unidade de medida, onde fica na clínica, responsável, estoque mínimo, unidade e custo unitário (visível só para o administrativo).
- **Alta rotatividade**: marque os itens que giram rápido.
- **Controla validade**: para itens com vencimento.
- **Alto valor**: automático pela curva ABC (os itens que concentram a maior parte do valor em estoque), com opção de forçar sim ou não.
- **Contagem inicial**: a quantidade de hoje é o ponto de partida.`,
      },
      {
        titulo: 'Unidades de medida',
        gestao: true,
        texto: `Cada item pode ter até três unidades, com a conversão entre elas:
- **Unidade de estoque:** como a equipe conta na prateleira (ampola, frasco, unidade). Saldos e contagens ficam nela.
- **Unidade de compra** (opcional): como vem na nota (caixa), com quantas unidades de estoque vêm em cada uma. Ex.: 1 caixa = 4 ampolas.
- **Unidade de uso** (opcional): a unidade da dose aplicada (mg, UI, ml), com quanto tem em cada unidade de estoque. Ex.: 1 ampola = 5 mg; 1 frasco = 100 UI.

Com isso, a entrada pode ser lançada em caixas, a contagem em ampolas e o uso em mg: a ferramenta converte sozinha e mostra as duas formas (ex.: 0,5 ampola · 2,5 mg).

**Sobra de ampola ou frasco aberto:** se a sobra não é aproveitada no próximo paciente, desmarque a opção no cadastro do item. Aí, quando a dose usa só parte da ampola, a ferramenta registra o uso no paciente e a sobra como descarte (“Sobra de frasco aberto”).`,
      },
      {
        titulo: 'Código QR: etiquetas e leitura pelo celular',
        texto: `Cada item tem uma **etiqueta com código QR**. Em **Estoque › Etiquetas QR** (administrativo), escolha os itens e imprima; cole a etiqueta onde o item fica (prateleira, gaveta, geladeira). No detalhe de cada item há também “Etiqueta QR”, para imprimir só uma.

**Ler código** (botão no topo do estoque e ao lado do campo Item nos formulários): aponte a câmera do celular ou use **“Tirar foto do código”**, que funciona em qualquer celular. A ferramenta abre o item certo e pergunta o que fazer: **Uso em paciente**, **Entrada** ou **Descarte**. Na entrada, basta informar a quantidade; na saída, o paciente e a dose.

**Código da caixa do medicamento:** medicamentos industrializados trazem um código na caixa com o produto, o lote e a validade. Na primeira leitura, escolha a qual item ele corresponde; daí em diante a ferramenta reconhece sozinha e já preenche **validade e lote** na entrada. Funciona também com o código de barras comum. Produtos manipulados não têm esse código: use a etiqueta da ferramenta.`,
      },
      {
        titulo: 'Importar o cadastro do sistema principal',
        gestao: true,
        texto: `Em **Estoque › Importar itens**, traga a lista de itens exportada do sistema principal, **sem quantidades**. A ferramenta reconhece colunas como Código, Produto ou Descrição, Grupo ou Categoria, Unidade, Custo e Mínimo (também há uma planilha modelo). Itens já cadastrados (mesmo código ou nome) não são duplicados.

Depois da importação, aparece o aviso dos itens sem contagem inicial, com o botão **Gerar contagem inicial**: a primeira contagem alimenta as quantidades.`,
      },
      {
        titulo: 'Entrada pela nota',
        texto: `Com a nota em mãos, use **Estoque › Entrada pela nota**: fornecedor, número, data e uma linha por item (quantidade, validade e custo). Nos itens com unidade de compra, escolha se a quantidade está em caixas ou na unidade do estoque; a conversão é automática. Tudo de uma vez.

Quem tiver o **XML da NF-e** (normalmente o financeiro) pode usar “Tenho o XML da nota”: a ferramenta lê itens, quantidades, custos, lote e validade, sugere o item correspondente e pede a conversão (ex.: 1 caixa = 10 ampolas). A ligação fica salva para as próximas notas do mesmo fornecedor, e a mesma nota não entra duas vezes. Se o custo subir 10% ou mais, a ferramenta avisa.`,
      },
      {
        titulo: 'Entradas e saídas',
        texto: `- **Registrar entrada**: compra que chegou. Quantidade (em caixas ou na unidade do estoque), data, validade (se o item controla) e custo.

Toda saída do estoque tem um motivo. Em **Registrar saída**, escolha:
- **Uso em paciente:** paciente, produto, dose (na unidade de uso, ex.: 2,5 mg ou 20 UI), procedimento, quem aplicou e lote. Fica registrado na ficha do paciente.
- **Descarte:** vencido, avaria, sobra de frasco aberto ou outro motivo.
- **Uso interno ou cortesia:** amostra, teste; o motivo é obrigatório.
- **Ajuste de estoque** (só administrativo): faltou ou sobrou, com o motivo. Ex.: correção de lançamento.

O **lote** vem sugerido pelo que vence primeiro e pode ser trocado. As sessões de programa e os procedimentos com insumo dão baixa sozinhos, já ligados ao paciente.`,
      },
      {
        titulo: 'Gerar lista de contagem',
        texto: `Na aba **Contagens**, escolha os itens (só alta rotatividade, só alto valor, todos ou uma categoria), a unidade, o responsável e a data. A lista vira uma **tarefa estratégica** para o responsável.
- Com **Repetir** (a cada 15 dias ou todo mês), a próxima contagem é criada sozinha ao concluir a atual.
- A contagem é **às cegas**: a quantidade esperada não aparece, para o número ser real.
- Nos itens com validade, informe quantas unidades vencem em cada mês.
- **Imprimir lista** gera a folha para contar no papel.
- Ao concluir, a ferramenta mostra o consumo de cada item e pode criar tarefas de reposição para o que ficou abaixo do mínimo.`,
      },
      {
        titulo: 'Análise do estoque',
        texto: `Na aba **Análise**, com filtro de período e unidade:
- **Inventário do período** de cada item: **contagem inicial**, **entradas**, **saídas registradas** (uso em pacientes, descartes, uso interno e ajustes), **saldo esperado** (inicial + entradas − saídas), **contagem final** e a **diferença** entre o esperado e o contado. Diferença em vermelho é falta (desperdício, desvio ou uso não registrado); em amarelo, sobra. O administrativo vê o valor em reais.
- Ex.: setembro começou com 14 ampolas, entraram 10, saíram 5 registradas: o esperado é 19. Se a contagem final deu 18, falta 1 ampola sem registro.
- **Próximos do vencimento** (30, 60 ou 90 dias), com botão para **gerar tarefa** (ex.: priorizar o uso antes de vencer).
- **Abaixo do mínimo**, com botão para gerar a tarefa de reposição.
- **Imprimir relatório**: a lista para entregar à médica.
- **Criar rotina mensal de análise**: uma tarefa todo dia 1º para revisar o estoque.`,
      },
    ],
  },
  {
    id: 'm13',
    numero: 13,
    titulo: 'Gestão de pessoas',
    gestao: true,
    secoes: [
      {
        titulo: 'Ficha da pessoa',
        texto: 'Em **Pessoas › Equipe**, cada pessoa da clínica tem uma ficha, mesmo quem não usa a ferramenta: cargo, tipo de contrato (CLT, PJ, estágio, autônomo, sócia), admissão, aniversário, salário (só o administrativo vê), gestor direto e o usuário da ferramenta ligado a ela (as metas automáticas usam os registros desse usuário).',
      },
      {
        titulo: 'Alertas',
        texto: `A **Visão geral** reúne os alertas da equipe, cada um com botão **Gerar tarefa**:
- **Férias (CLT):** a ferramenta calcula os períodos aquisitivos e avisa 60 dias antes do prazo para conceder. Férias concedidas fora do prazo são pagas em dobro.
- **Experiência (CLT):** aviso perto do fim dos 45 e dos 90 dias, para decidir prorrogação e efetivação.
- **Documentos:** ASO, registro profissional (COREN, CRM), treinamentos. Aviso 30 dias antes de vencer.
- **Banco de horas:** saldo acima do limite (padrão ±10 horas).`,
      },
      {
        titulo: 'Metas do mês',
        texto: `Na aba **Metas**, defina as metas de cada pessoa por mês:
- **Automáticas**, calculadas pelos registros da ferramenta: agendamentos, confirmações, contatos, orçamentos fechados (quantidade e valor), recebimentos, tarefas no prazo e contagens de estoque no prazo.
- **Manuais**, para o que não está na ferramenta (ex.: avaliações no Google): o gestor lança o resultado.

“Copiar metas do mês anterior” agiliza o mês seguinte. Cada colaboradora acompanha as próprias metas em **Pessoas › Minhas metas**.`,
      },
      {
        titulo: 'Conversas 1:1',
        texto: 'Uma conversa por mês com cada pessoa. O registro mostra as metas do mês e guarda **pontos fortes**, **pontos a desenvolver** e **combinados**. Cada combinado pode virar tarefa para a pessoa, com prazo de 30 dias. A aba mostra quem ainda não teve a conversa do mês, e a **rotina mensal** cria a tarefa do gestor todo dia 20.',
      },
      {
        titulo: 'Banco de horas',
        texto: 'A ferramenta **não registra ponto**. No fim do mês, lance o saldo de cada pessoa como aparece no aplicativo oficial de ponto (ex.: +6:30 ou −2:15). A tabela mostra os últimos meses e destaca quem passou do limite. A rotina mensal cria a tarefa “Análise do espelho de ponto” todo dia 5.',
      },
    ],
  },
  {
    id: 'm14',
    numero: 14,
    titulo: 'Financeiro',
    secoes: [
      {
        titulo: 'Para que serve',
        texto: 'O Financeiro da ferramenta **não substitui a contabilidade nem o financeiro completo**. Ele coloca na rotina da clínica os rituais que dão uma visão organizada do dinheiro: conferir o caixa todo dia, pagar as contas no prazo, cobrar quem está devendo e olhar o mês por categoria.',
      },
      {
        titulo: 'Caixa do dia',
        texto: `No fim do expediente, a pessoa responsável (definida pelo administrativo) abre **Financeiro › Caixa do dia** e informa os totais conferidos: Pix (extrato), cartão de crédito e débito (relatório da maquininha) e dinheiro (gaveta).
- A conferência é **às cegas**: o valor registrado na ferramenta só aparece depois de fechar.
- A tela mostra a diferença por forma de pagamento. Diferença costuma ser recebimento sem registro ou lançado duas vezes: confira e registre em Recebimentos.
- O lembrete “Fechar o caixa de hoje” aparece na tela Hoje da responsável até o caixa ser fechado.
- **Fechou com um valor digitado errado?** Quem tem acesso ao Financeiro do mês toca em **Reabrir caixa** no dia fechado e diz o motivo. O dia volta a ficar aberto e é fechado de novo, às cegas, com a contagem certa. O fechamento anterior não se perde: fica em Atividades, com quem reabriu e o motivo. Enquanto o dia está reaberto, o dinheiro dele volta a ficar "aguardando fechamento" nos indicadores.`,
      },
      {
        titulo: 'Contas a pagar',
        texto: `O administrativo cadastra as contas com **descrição, categoria, valor, vencimento e quem paga**. Contas mensais (aluguel, salários, sistema) se renovam sozinhas: ao registrar o pagamento, a do mês seguinte é criada com o mesmo valor.
- Quem paga recebe o lembrete na tela Hoje **3 dias antes** do vencimento (e as vencidas) e toca em **“Paguei”**, informando data, valor e forma.
- A equipe vê só as contas sob sua responsabilidade.`,
      },
      {
        titulo: 'Categorias de despesa',
        texto: `**Fixas:** Pessoal (salários, encargos, pró-labore), Ocupação (aluguel, condomínio, energia, água, internet), Sistemas e assinaturas, Serviços contratados (contabilidade, limpeza, assessoria).

**Variáveis:** Insumos e medicamentos, Marketing, Impostos e taxas, Taxas de cartão e bancárias, Manutenção e equipamentos, Outras despesas.

As despesas fixas são o custo para a clínica abrir as portas todo mês. Saber esse número ajuda a definir a meta mínima de faturamento.`,
      },
      {
        titulo: 'Cobranças',
        texto: 'Lista os pacientes com saldo em aberto, com quem está há mais tempo sem contato primeiro. **“Lembrar pelo WhatsApp”** abre a mensagem pronta (sem expor valores) e registra o contato. **“Recebeu”** abre o Recebimento do paciente. O administrativo vê os valores; a equipe vê os nomes.',
      },
      {
        titulo: 'Visão do mês',
        gestao: true,
        texto: `Em **Financeiro › Visão do mês**, escolha o mês:
- **Recebido no mês** (recebimentos registrados), **despesas pagas**, **resultado** (recebido − despesas pagas), contas **a pagar** até o fim do mês e **saldo a receber** dos pacientes, com a comparação com o mês anterior.
- **Meta de faturamento:** defina o valor do mês e acompanhe o percentual atingido. A equipe vê só o percentual, na tela de Recebimentos.
- **Despesas por categoria**, com o peso de cada uma, fixas × variáveis e o valor do mês anterior.
- **Recebido por forma de pagamento** e os **caixas fechados** do mês, com as diferenças.
- **Criar rotina mensal de fechamento:** uma tarefa todo dia 1º para revisar o mês.`,
      },
    ],
  },
  {
    id: 'm15',
    numero: 15,
    titulo: 'Indicadores & Insights',
    secoes: [
      {
        titulo: 'Para que serve',
        texto: `Em **Gestão › Indicadores & Insights** ficam juntas as metas da clínica, os objetivos do trimestre e os relatórios. Cada indicador tem meta, prazo, responsável e gráfico, e a cor mostra se a clínica está no ritmo.
- **KPI** (indicador): um número acompanhado no tempo. É **automático** quando o sistema calcula (faturamento, conversão de orçamentos, tarefas no prazo) e **manual** quando alguém da equipe lança (NPS, nota no Google, seguidores).
- **OKR:** um objetivo com 1 a 5 resultados-chave, cada um ligado a um KPI. Ligar um KPI a um OKR é opcional.
- **Relatórios:** listas e totais com filtros, para ver na tela, exportar ou virar campanha.

Quem vê a aba tem a permissão **Indicadores & Insights** no perfil de acesso. Criar, editar e arquivar KPIs, metas e OKRs exige também **Criar e editar KPIs, metas e OKRs**.`,
      },
      {
        titulo: 'A tela OKRs e KPIs',
        gestao: true,
        texto: `No topo, **Modo reunião** e **+ Novo** (Novo OKR, Novo KPI, Nova meta). Abaixo, as abas **OKRs e KPIs** e **Relatórios**, e os filtros **Período** (o trimestre), **Pilar** e **Responsável**. No celular, os filtros ficam recolhidos no botão **Filtros**.

A tela tem duas faixas:
- **Prioridades do trimestre:** um cartão por OKR, do mais atrasado (menor progresso) para o mais adiantado, com o resumo "3 objetivos · média 62%".
- **Saúde da clínica:** os KPIs que não estão em nenhum OKR, por pilar (Financeiro, Comercial, Processos, Pessoas). Em cada pilar vêm primeiro os vermelhos, depois os amarelos e os verdes; os sem meta, por último.

Sem nenhum KPI, a faixa mostra **Abrir catálogo**, para escolher o que a clínica vai acompanhar.`,
      },
      {
        titulo: 'O cartão do KPI',
        gestao: true,
        texto: `Cada cartão mostra:
- o nome (toque nele para abrir o detalhe) e o selo da situação;
- o **valor atual** em destaque e, ao lado, a meta ("de R$ 120.000,00");
- a **barra da meta**, com um traço fino onde o número deveria estar hoje;
- o minigráfico dos últimos meses;
- a **variação** contra o período anterior: verde quando melhorou, vermelho quando piorou, conforme a direção do KPI. O que soma no mês, como o faturamento, compara com o **mesmo dia do mês anterior** ("▲ 8% vs. mesmo dia de outubro"), nunca o mês pela metade contra o mês inteiro;
- a fonte: **automático** ou **lançado pela equipe**.

No KPI manual aparece **Lançar valor**; para quem gerencia, também **Definir meta** ou **Editar meta**.`,
      },
      {
        titulo: 'As cores da meta',
        gestao: true,
        texto: `A situação compara o valor de hoje com o **ritmo esperado**: uma linha reta do valor de partida até o alvo, do início ao prazo. No que soma no período, como o faturamento, a linha anda pelos **dias úteis** (segunda a sexta, sem contar feriado).
- **No ritmo** (verde): no ritmo ou acima.
- **Atenção** (amarelo): até 10% abaixo do ritmo.
- **Abaixo do ritmo** (vermelho): mais de 10% abaixo, ou o prazo venceu sem atingir.
- **Atingida:** chegou ao alvo. Em meta de teto (quanto menor, melhor, somando no período), só depois do prazo.
- **Sem meta:** o KPI ainda não tem meta.

A **projeção** diz onde o número chega no prazo, mantida a média do que já passou. No primeiro dia da meta ela ainda não aparece.`,
      },
      {
        titulo: 'Criar um KPI',
        gestao: true,
        texto: `Em **+ Novo › Novo KPI**, escolha:
- **Do catálogo (automático):** o sistema calcula sozinho a partir do que a equipe já registra. Busque no catálogo, escolha o indicador e ajuste o nome de exibição, a frequência (semanal ou mensal) e o responsável. O que a clínica já acompanha aparece como "já acompanhado".
- **Criar indicador (manual):** para o que o sistema não calcula. Informe nome, pilar, unidade (R$, %, quantidade, dias ou nota de 0 a 10), direção ("Quanto maior, melhor" ou "Quanto menor, melhor"), frequência e dia do lançamento, o responsável pelo lançamento e **Como medir** (o texto curto que aparece para quem lança).

Nos dois, dá para ligar o KPI a um OKR e marcar **Definir meta agora**. **Arquivar indicador**, no detalhe, tira o KPI da tela sem apagar o histórico.`,
      },
      {
        titulo: 'Lançar o valor de um KPI manual',
        texto: `O KPI manual é o número que alguém da equipe lança. Quem lança é a **responsável pelo lançamento**; quem gerencia os indicadores também pode, para corrigir.

No dia escolhido no cadastro, a responsável recebe em Hoje a tarefa **Lançar [nome do indicador]**. Para lançar, toque em **Lançar valor** no cartão do indicador ou no detalhe dele, em Indicadores & Insights. A janela traz o "como medir", o **Valor**, a **Referência** (a segunda-feira da semana, ou o mês) e um **Comentário** opcional. Ao salvar, a tarefa daquela referência se conclui sozinha.
- A tarefa não se conclui pelo círculo, não se cancela e não se exclui: ela pertence ao indicador. Para parar de pedi-la, quem gerencia arquiva o indicador.
- No lançamento mensal, dia 29, 30 ou 31 cai no último dia do mês curto.
- **O valor do período é o último lançamento, não a soma.** Para algo que se acumula (leads do mês), crie o KPI mensal e lance o total do mês.
- Lançou errado? Lance de novo na mesma referência: o valor é corrigido, e a correção fica registrada em Atividades. No detalhe, a tabela de lançamentos tem o ícone para corrigir.`,
      },
      {
        titulo: 'Metas com prazo',
        gestao: true,
        texto: `Em **+ Novo › Nova meta**, ou em **Definir meta** no cartão:
- **Tipo:** **Do mês** (o mês inteiro) ou **Até uma data** (início e prazo).
- **Valor-alvo**, na unidade do KPI.
- **Valor de partida:** no que soma no período (faturamento, novos pacientes) começa sempre do zero; nos outros, vem com o valor de hoje e pode mudar.
- **Responsável:** vem o do KPI.

Abaixo dos campos, a prévia mostra o ritmo: "Para chegar a R$ 120.000,00 em 31/12, o ritmo esperado é de … por dia útil. Hoje a clínica está em … por dia útil."

Cada KPI tem **uma meta por vez** no mesmo período. **A meta de faturamento da Visão do mês é esta mesma**: há um lugar só para ela, e a Visão do mês mostra o atalho **Acompanhar em Indicadores & Insights**.`,
      },
      {
        titulo: 'Faturamento conferido e o caixa fechado',
        gestao: true,
        texto: `O KPI **Faturamento conferido** e a meta de faturamento contam **só os dias com o caixa fechado**. É o fechamento do caixa, conferido às cegas, que confirma o dinheiro do dia.
- O que entrou num dia ainda sem caixa fechado aparece à parte, como **aguardando fechamento** ("R$ 6.300,00 aguardando fechamento do caixa em 2 dias, fora da meta até fechar"). Fica fora da meta, do ritmo e da projeção até o caixa daquele dia ser fechado.
- No cartão do KPI, quem tem a permissão da Visão do mês vê o valor ("+ R$ 6.300,00 aguardando fechamento de 2 dias"); para os outros, só os dias ("Aguardando fechamento de 2 dias").
- **O dia de hoje só conta depois de fechar o caixa.** Durante o dia, o percentual da meta não sobe a cada pagamento.
- No gráfico dia a dia, o dia que espera o fechamento aparece como **barra clara**, sem valor.
- A regra vale a partir do **primeiro caixa fechado da clínica na ferramenta**. Os dias anteriores continuam contados como antes, por tudo o que foi recebido: nenhum mês passado muda.

A linha **Recebido** da Visão do mês continua sendo o mês inteiro. Fechar o caixa todo dia é o que mantém a meta em dia.`,
      },
      {
        titulo: 'Números parecidos que não se somam',
        gestao: true,
        texto: `- **Ticket médio e faturamento usam datas diferentes.** O ticket médio (o mesmo do Painel) conta cada pagamento pela data em que o atendimento foi concluído; o faturamento (o mesmo da Visão do mês), pela data do recebimento. Por isso ticket médio × número de pagamentos pode não dar o faturamento do mês. Os dois estão certos.
- **Valor fechado em orçamentos** já está dentro da receita. Nunca some os dois.
- **Despesas fixas sobre o recebido** divide as despesas fixas pelo recebido no mês, sem as outras entradas. A Visão do mês faz outra conta (fixas sobre o total de despesas): não confira um número pelo outro.
- **Perda de estoque** é medida no período inteiro: as barras de cada mês não somam o total.`,
      },
      {
        titulo: 'OKRs',
        gestao: true,
        texto: `Um OKR é um objetivo em linguagem de dono ("Ter uma agenda previsível") com **1 a 5 resultados-chave**; o recomendado é até 4. Em **+ Novo › Novo OKR**:
- **Objetivo**, **Período** (o trimestre, já marcado, ou **Datas livres**) e **Responsável**.
- **+ Adicionar resultado-chave:** escolha o KPI, o valor-alvo e o prazo (vem o fim do período e o acompanha; um prazo antes dele precisa ficar dentro do período, e aparece no cartão como “até 15/02”). Falta o KPI? Crie ali mesmo, sem sair do formulário.
- **Por que isso importa** (opcional): aparece no Modo reunião.

O progresso do OKR é a **média** dos resultados-chave, e a cor é a do pior deles. O KPI ligado sai de Saúde da clínica e passa a aparecer dentro do OKR. O mesmo KPI pode estar em mais de um OKR, cada um com a sua meta.

No cartão do OKR: **Editar OKR** e o menu com **Encerrar OKR**, **Duplicar para o próximo trimestre** (mesmos indicadores e alvos, com a partida medida de novo) e **Excluir** (os indicadores continuam e voltam para Saúde da clínica).`,
      },
      {
        titulo: 'Detalhe do KPI',
        gestao: true,
        texto: `Toque no nome de um KPI para abrir o detalhe. No topo, pilar, frequência, responsável e fonte, e os botões **Lançar valor** (KPI manual), **Editar** e o menu com **Definir meta**, **Ligar a OKR** e **Arquivar indicador**.
- **Quatro números:** Valor atual, Meta e prazo (com a situação), Onde deveria estar hoje e Projeção no prazo.
- **Gráfico:** abre em **Período da meta**, com o valor real, o ritmo esperado, a projeção e o alvo. **3 meses** e **12 meses** mostram o histórico, com o mês atual marcado como em andamento. **Personalizado** abre De e Até (sem data futura), com os atalhos Este mês, Mês passado, Últimos 6 meses e Este ano.
- **Mês, semana ou dia:** mais de um mês aparece mês a mês; dentro de um mês, o faturamento aparece dia a dia e os KPIs semanais, semana a semana. A etiqueta acima do gráfico diz qual. Toque num ponto para ver a data e o valor.
- **De onde vem o número:** no automático, a composição do período (o faturamento por forma de pagamento e por tipo de atendimento) e o atalho **Ver recebimentos**, que abre o relatório já filtrado; no manual, a tabela de lançamentos. Sem a permissão daquele detalhe, aparece "Sem acesso ao detalhe".
- No rodapé, os OKRs que usam o indicador, as próximas metas (as que ainda não começaram) e as metas anteriores, atingidas ou não.

KPI sem meta mostra os últimos 3 meses, com o aviso "Este indicador ainda não tem meta". Se a meta já foi definida para um período que ainda não começou, o detalhe diz "Próxima meta" e quando ela começa.`,
      },
      {
        titulo: 'Plano de ação',
        gestao: true,
        texto: `Meta em vermelho pede ação. No detalhe do KPI, em **Planos de ação**, toque em **+ Plano de ação** e informe descrição, responsável e prazo. Vira uma tarefa para a responsável, em Hoje, ligada ao indicador. A lista do detalhe mostra os planos abertos primeiro.

No Modo reunião, o mesmo botão fica no slide de cada KPI: o plano nasce durante a reunião, sem sair dela.`,
      },
      {
        titulo: 'Modo reunião',
        gestao: true,
        texto: `Para a reunião semanal. **Modo reunião**, no topo de Indicadores & Insights, mostra um slide por vez, em fundo claro, para levar à TV:
- a capa, com a clínica, a semana e o resumo das metas (abaixo do ritmo, em atenção, no ritmo, atingidas);
- um slide por OKR, com os resultados-chave;
- um slide por KPI de Saúde da clínica em vermelho ou amarelo;
- no fim, **Planos de ação da semana**.

Passe com as setas do teclado ou com os botões dos cantos de baixo; o contador mostra "4 de 9". Ela já abre em tela cheia (no celular que não permite, o botão **Tela cheia** fica no topo); **Esc** ou o **✕** sai da reunião. Nenhum nome de paciente aparece na reunião.`,
      },
      {
        titulo: 'Indicadores em Hoje, no menu e na Visão do mês',
        gestao: true,
        texto: `- **Menu:** ao lado de Indicadores & Insights, um número vermelho conta as metas abaixo do ritmo. Some quando é zero.
- **Hoje:** quem tem acesso a Indicadores vê o bloco **Indicadores da semana**, com até 4 metas em vermelho ou amarelo e o atalho **Ver todos**. Toque num cartão para abrir o detalhe.
- **Visão do mês:** a meta de faturamento mostra os dias aguardando fechamento e o atalho **Acompanhar em Indicadores & Insights**.
- **Equipe › Metas do mês** continua igual; a média de atingimento é o KPI "Atingimento das metas individuais".`,
      },
      {
        titulo: 'Relatórios',
        gestao: true,
        texto: `Na aba **Relatórios**, os 15 relatórios ficam em grupos, com busca no topo e os **Favoritos** antes de todos:
- **Pacientes:** sem compra, sem atendimento, com maior LTV, que indicaram, por procedimento, por origem e campanha, aniversariantes.
- **Financeiro:** recebimentos, saldos em aberto, contas a pagar.
- **Estoque:** saídas e entradas.
- **Comercial:** orçamentos, faltas e desmarcações.
- **Equipe:** tarefas da equipe.

Escolha o relatório, preencha os filtros e toque em **Gerar**. Aparecem o resumo (quantas linhas e as somas em reais, como "148 pacientes · LTV somado R$ 312.400,00"), a tabela (50 linhas por página, com ordenação por coluna e a linha **Total** no pé) e os botões **Exportar**, **Salvar como favorito** e, nas listas de pacientes, **Criar campanha com esta lista**. Tocar no nome de uma paciente abre a ficha em outra aba. No celular, **Trocar de relatório** volta à lista.

Algumas colunas:
- **Pacientes sem atendimento:** o último atendimento e o tipo dele (fica em branco quando a data veio da última consulta do cadastro), o LTV e **Tem tarefa aberta?**.
- **Pacientes com maior LTV:** a posição no ranking, o LTV, as compras, o ticket médio e a última compra.
- **Pacientes por procedimento:** o início do programa, as sessões feitas e restantes e o valor.
- **Saídas de estoque:** no filtro **Motivo**, **Ajuste** mostra só os ajustes manuais, para menos e para mais (o para mais aparece com a quantidade negativa). Sem esse filtro, ajuste não entra, como na Análise.
- **Orçamentos:** a **Situação** é Enviado, Fechado ou Perdido, e o filtro usa a mesma. O valor orçado não é somado: orçamento não é receita.

Cada relatório só aparece para quem tem a permissão da tela de onde vêm os dados: Recebimentos pede a Visão do mês, Orçamentos pede a Jornada do paciente. Em Recebimentos, o dinheiro dos dias com caixa ainda aberto fica num total à parte, aguardando fechamento.`,
      },
      {
        titulo: 'Exportar um relatório',
        gestao: true,
        texto: `Em **Exportar**, escolha **Excel**, **CSV** ou **PDF**. O PDF abre em outra aba, pronto para imprimir ou "Salvar como PDF".
- Todo arquivo sai com o nome da clínica, o relatório, os filtros, a data, quem exportou e um **código**, que também vai no nome do arquivo. A exportação fica registrada em **Atividades**.
- Lista com dados de pacientes pede a confirmação do aviso. Lista com dado de saúde (pacientes por procedimento, orçamentos, sem compra filtrado por procedimento, saídas de estoque com a paciente) pede também **Para que é este arquivo?**: Acompanhamento do tratamento, Recall de lote ou Conferência interna.
- **Incluir telefone** vem desligado. Marque só se o telefone precisar estar no arquivo. Para ligar ou mandar mensagem para a lista, o caminho é **Criar campanha com esta lista**, sem arquivo nenhum.
- O arquivo termina com a linha **Total**: as mesmas somas do resumo, cada uma debaixo da sua coluna.
- Quem não tem acesso a valores exporta sem as colunas em reais e sem a linha Total.
- A sessão de suporte da Firmare vê o relatório, mas não exporta dado de paciente.

Arquivo exportado tem dado de paciente: não encaminhe e apague quando terminar.`,
      },
      {
        titulo: 'Relatório favorito',
        gestao: true,
        texto: `Gerou um relatório que a clínica usa sempre? Toque em **Salvar como favorito** e dê um nome (por exemplo, "Sem compra há 4 meses"). Ele aparece no topo da lista, em **Favoritos**, e roda de novo com um toque, com os mesmos filtros.
- O favorito é da clínica: todos que podem abrir aquele relatório o veem. Por isso o nome não leva nome de paciente, telefone, valor nem dado de saúde.
- O **✕** ao lado remove o favorito para toda a clínica; o relatório continua.
- Se um filtro deixou de valer, o favorito aparece como "Filtros desatualizados" e não roda.`,
      },
      {
        titulo: 'Criar campanha com esta lista',
        gestao: true,
        texto: `Nas listas de pacientes, **Criar campanha com esta lista** transforma o resultado em tarefas de contato, sem exportar nem importar planilha:
- Escolha a campanha: uma que já existe ou **+ Nova campanha**.
- Escolha o tipo da tarefa, o prazo e quem faz os contatos. A descrição fica em **+ Mais opções** (vazia, vira "Contato da campanha").
- Toque em **Criar as tarefas**. Cada paciente da lista ganha uma tarefa; quem já tinha tarefa aberta na campanha fica de fora, e o aviso diz quantas.

A lista é a dos filtros que estão na tela, até 2.000 pacientes: acima disso nada é criado, e é preciso estreitar o filtro. Paciente desativada não entra. Tocar de novo depois de uma falha de conexão não duplica nada. Em lista com dado de saúde, o procedimento não vai para a campanha nem para as tarefas. Exige a permissão **Criar, importar e excluir campanhas**.`,
      },
      {
        titulo: 'O que os relatórios deixam de fora',
        gestao: true,
        texto: `Alguns dados ficam fora dos relatórios **de propósito**, pela lei de proteção de dados (LGPD), mesmo onde o pedido original previa:
- **Pacientes que indicaram:** mostra quantas pessoas cada paciente indicou e quantas viraram pacientes, mas **não o nome das indicadas**.
- **Aniversariantes:** mostra o dia, o mês e a idade, **nunca a data completa de nascimento**.
- **Telefone** só sai quando alguém marca **Incluir telefone**. Recebimentos não traz telefone.
- **Pacientes por procedimento** não traz dose nem lote. **Saídas de estoque** só mostra a paciente quando se marca **Mostrar a coluna de paciente**, e só para quem tem a Jornada do paciente.
- **Nenhum relatório filtra por nome ou telefone** de paciente. Para achar uma pessoa, use a busca de Pacientes.
- Paciente desativada não aparece em nenhum relatório.

Não é defeito: é o mínimo de dado de paciente que cada lista precisa para o trabalho.`,
      },
      {
        titulo: 'Textos livres: o que não escrever',
        texto: `Nomes, objetivos, comentários e planos dos indicadores são lidos pela clínica inteira, vão para a TV no Modo reunião, e o nome do indicador pode chegar aos números que a Firmare acompanha. Por isso:
- **Nome do KPI manual:** não use nome de pessoa nem de paciente.
- **Como medir, comentário do lançamento, objetivo do OKR, "Por que isso importa" e plano de ação:** não escreva nome de paciente nem dado de saúde.
- **Nome do favorito:** nem nome de paciente, telefone, valor nem dado de saúde.
- **Não escreva valores em reais** nesses textos: quem não tem acesso a valores leria o número ali.

Escreva o que se mede e o que se vai fazer ("Ligar para os orçamentos de outubro"), nunca de quem se trata.`,
      },
      {
        titulo: 'Sem acesso a valores',
        texto: `Quem não tem a permissão **Ver valores financeiros** usa os indicadores normalmente, sem ver reais:
- No cartão, no lugar do valor em reais aparece o percentual da meta ("78% da meta"), e a meta "de R$…" não aparece. O minigráfico continua, sem valores.
- No detalhe, "Meta e prazo" mostra "Meta definida", e o gráfico sai em percentual da meta.
- **Despesas fixas sobre o recebido** não aparece. Os indicadores de equipe (banco de horas, metas individuais e conversas 1:1) só aparecem para quem tem a permissão de Equipe.
- Meta, alvo ou KPI manual em reais só é criado por quem vê valores.
- Nos relatórios, as colunas em reais e as somas do resumo somem da tela e do arquivo, e **Pacientes com maior LTV** não aparece.`,
      },
      {
        titulo: 'Indicadores da clínica na carteira da Firmare',
        gestao: true,
        texto: 'Para a equipe da Firmare: na ficha do Cliente Firmare, o bloco **Indicadores da clínica** mostra os KPIs que a própria clínica acompanha aqui, como estavam na fotografia do dia (tirada uma vez por dia, enquanto a clínica está no grupo). Sem acesso a valores, aparece só o percentual da meta. Os indicadores de equipe (banco de horas, metas individuais e conversas 1:1) não chegam à carteira, e no pilar Pessoas chegam só a situação e o percentual. Em **Configurações › Grupos que recebem a clínica**, a clínica vê quem recebe esses números.',
      },
    ],
  },
]
