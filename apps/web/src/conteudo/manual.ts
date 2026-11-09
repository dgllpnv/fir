import { DICA_DO_NOME_DA_CAMPANHA } from './dica-do-nome-da-campanha'
import type { CapituloDoManual } from './tipos'

/**
 * **O manual da ferramenta: 14 capítulos, 77 seções, escritos pela PO** — o
 * `MANUAL` do protótipo, portado palavra por palavra.
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
        texto: `A Gestão de Rotina organiza o dia a dia da clínica em um só lugar: as tarefas da equipe, o relacionamento com os pacientes, os programas de acompanhamento, as campanhas comerciais e os pagamentos.

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
        texto: `Abra o link da ferramenta e informe três coisas: o **código da clínica**, o seu **usuário** e a sua **senha**.

O usuário é o nome curto que a clínica cadastrou para você (por exemplo, ana.silva). Ele é único na clínica, não muda, e foi feito para ser ditado por telefone sem ambiguidade. Quem cria o seu acesso é quem administra a clínica.

No primeiro acesso você usa a **senha provisória** que lhe foi passada, e a ferramenta pede uma senha nova antes de abrir qualquer tela.`,
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

Esqueceu a senha? Quem administra a clínica gera uma **senha provisória** para você em Configurações › Usuários e acessos. Ela aparece uma única vez, na tela de quem a gerou: **ninguém lê a senha de outra pessoa**, nem quem a redefiniu.`,
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

Para registrar algo que aconteceu, use sempre **Concluir**. Se a data de realização for depois do prazo, a tarefa conta como concluída com atraso.`,
      },
      {
        titulo: 'Jornada do paciente: agendamento até o fechamento',
        texto: `Consultas e procedimentos agendados seguem a **jornada do paciente**. É sempre **a mesma tarefa**, que muda de etapa; não se cria tarefa nova a cada passo.
- **Enviar confirmação**: abre o WhatsApp com a mensagem pronta (“Olá, Fulana! … confirmar sua consulta amanhã às 10h”). Dá para editar antes de enviar. O envio fica registrado no cartão (“confirmação enviada, aguardando resposta”).
- **Agendada** → **Confirmada**: quando a paciente responder, toque em “Confirmou”. Os agendamentos de amanhã aparecem na tela Hoje, em “Próximos passos da jornada”.
- **No-show** e **Desmarcou**: ficam registrados (no-show entra na taxa de no-show) e o cartão **continua aberto** em “Recontatar”, na tela Hoje, até alguém reagendar ou encerrar. Assim ninguém esquece de ligar para quem faltou ou desmarcou.
- **Reagendar** devolve o cartão para Agendada com a nova data; **Encerrar** fecha sem reagendar, com motivo opcional.
- **Realizada**: tocar no círculo conclui o atendimento (e pergunta se recebeu algum valor).
- **Orçamento enviado**: “Registrar orçamento”, com valor e data para retomar o contato (2 dias, por padrão). Se for programa, marque “É um programa” e monte os procedimentos e sessões como a médica prescreveu: o valor sugerido já aparece. No dia de retomar, o cartão aparece em “Orçamentos para retomar”. “Registrar follow-up” anota o contato e marca o próximo.
- **Corrigir orçamento**: digitou errado? Enquanto o orçamento está em aberto, quem pediu, quem atende ou quem acompanha a equipe corrige o valor, a data de retomar e “o que foi orçado”. A etapa não muda, a correção aparece na “Evolução” (de → para), e o funil dos meses já fechados continua igual.
- **Fechou**: abre o Recebimento já preenchido. Informe só a entrada: o restante do orçamento vira **saldo em aberto** sozinho, e o programa orçado já vem montado para confirmar a data de início. A adesão nasce no fechamento.
- **Perdeu**: encerra o orçamento com o motivo (preço, sem retorno, outro lugar, momento, outro).

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
        titulo: 'Cancelar e excluir',
        texto: `- **Cancelar:** a tarefa não vai mais acontecer. Fica no histórico como cancelada. Pode ser feito por quem solicitou ou pelo administrativo.
- **Excluir** (dentro de Editar): apaga o registro, só para lançamentos feitos por engano. Em tarefas recorrentes, é possível excluir só esta ou esta e as próximas.`,
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
- Diga **o que ele está pagando**: Consulta, Sinal de consulta, Procedimento ou programa novo (venda), Programa em andamento ou Saldo em aberto.
- Informe o **valor recebido**, a **forma de pagamento** (Pix, Dinheiro, Cartão de crédito, Cartão de débito ou Nota promissória) e a data.
- Se ficou uma parte para depois, informe em **“Ficou valor em aberto?”**.

O formulário mostra os recebimentos do paciente nos últimos 7 dias, para evitar lançar o mesmo pagamento duas vezes. Embaixo, a lista **Recebimentos de hoje** ajuda a conferir o caixa do dia.`,
      },
      {
        titulo: 'Consulta ou recebimento da consulta?',
        texto: `São duas coisas diferentes:
- A **consulta** é o atendimento: conclua a tarefa da consulta.
- O **dinheiro** é o recebimento. Se o paciente pagou na hora, responda **“Recebeu algum valor?”** ao concluir a consulta. Pronto: não lance de novo.
- Se pagou em outro momento (sinal antes, ou restante depois), use **Recebimento › Consulta** ou **Sinal de consulta**.`,
      },
      {
        titulo: 'Programa em andamento × programa novo',
        texto: `- **Programa novo:** o paciente acabou de fechar (venda). Use Recebimento › Procedimento ou programa novo; dá para programar as sessões do catálogo na mesma tela.
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

Sem orçamento registrado, monte no Recebimento › Procedimento ou programa novo, marcando **“É um programa de acompanhamento: montar agora”**.`,
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

**Produtos utilizados:** tudo o que saiu do estoque para o paciente, com data, produto, dose, procedimento, lote e quem aplicou. Entram sozinhas as baixas das sessões e dos procedimentos com insumo; para lançar um uso avulso, toque em **Registrar uso de produto** (o paciente já vem escolhido). O mesmo lançamento pode ser feito pelo estoque, em Registrar saída › Uso em paciente.`,
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

O mesmo montador aparece no **Recebimento › Procedimento ou programa novo**, ao marcar “É um programa de acompanhamento”.`,
      },
      {
        titulo: 'Baixa automática no estoque',
        texto: `Ao concluir uma sessão, a ferramenta **dá baixa sozinha** no estoque: o insumo do item na quantidade definida (a dose) e os descartáveis do procedimento. Se a sessão for reaberta ou o programa excluído, a baixa é desfeita.

Nas tarefas avulsas de **Procedimento realizado**, escolha “Qual procedimento?” para dar baixa dos insumos padrão daquele procedimento.

Cada baixa fica ligada ao paciente, com a dose e o lote, em **Produtos utilizados** na ficha. Na análise do estoque, o saldo esperado (contagem inicial + entradas − saídas registradas) é comparado com a contagem final: a diferença mostra o que saiu sem registro (desperdício, sessão não lançada ou desvio).`,
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
        texto: `Em **Configurações › Usuários e acessos**, cadastre cada pessoa com nome, **usuário para entrar** e função, e escolha o **perfil de acesso**. A senha é gerada pela ferramenta e aparece uma única vez, para ser passada à pessoa.
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
- O lembrete “Fechar o caixa de hoje” aparece na tela Hoje da responsável até o caixa ser fechado.`,
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
]
