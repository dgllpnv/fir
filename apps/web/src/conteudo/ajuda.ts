import type { PerguntaDaAjuda } from './tipos'

/**
 * **As 51 perguntas frequentes, escritas pela PO** — o `AJUDA` do protótipo,
 * portado palavra por palavra.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO É CONTEÚDO DO PRODUTO, E POR ISSO NÃO MORA NO BANCO
 *
 * Ele é igual para as quatro clínicas, não é dado de nenhuma delas, e muda com
 * o deploy — não com um `UPDATE`. No banco ele precisaria de `clinica_id`
 * (regra 19) e passaria a divergir entre clínicas no primeiro ajuste de texto.
 *
 * **O texto não se reescreve.** Ele é a documentação funcional do produto, e a
 * autoridade dele é a mesma do protótipo (`CLAUDE.md` §1). As ÚNICAS passagens
 * alteradas são as da **D-10** — PIN, e-mail e a cadeia de primeiro acesso —,
 * e `conteudo.test.ts` cobra que nenhuma menção a PIN ou a e-mail sobreviva.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * `chaves` são as palavras de busca (o `k` dela): sem acento, sem pontuação, e
 * é por elas que “pagamento parcial” acha a resposta que não usa essas duas
 * palavras no título.
 *
 * `gestao: true` é o `adm` dela: a pergunta só aparece para quem tem `painel`
 * ou `config`. Não é segurança — é relevância: ensinar a recepção a procurar
 * “Etiquetas QR (administrativo)” é ensiná-la a tocar e levar 403.
 */
export const AJUDA: readonly PerguntaDaAjuda[] = [
  {
    tema: 'Primeiros passos',
    pergunta: 'Como entro na ferramenta?',
    resposta: 'Abra o link da ferramenta e informe três coisas: o código da clínica, o seu usuário e a sua senha. O usuário é o nome curto que a clínica cadastrou para você (por exemplo, ana.silva), feito para ser ditado por telefone sem ambiguidade. No primeiro acesso você usa a senha provisória que lhe foi passada, e a ferramenta pede uma senha nova antes de abrir qualquer tela.',
    chaves: 'login entrar acesso senha usuario clinica primeiro acesso provisoria',
  },
  {
    tema: 'Primeiros passos',
    pergunta: 'Como troco minha senha?',
    resposta: 'Toque em “Trocar senha”, no rodapé do menu lateral (no celular, abra o Menu). Informe a senha atual e a nova duas vezes. As outras sessões abertas com a senha antiga caem na hora.',
    chaves: 'senha trocar alterar mudar esqueci',
  },
  {
    tema: 'Primeiros passos',
    pergunta: 'Esqueci minha senha. E agora?',
    resposta: 'Peça a quem administra a clínica: em Configurações › Usuários e acessos ela toca em “Redefinir senha” e a ferramenta gera uma senha provisória. A senha aparece uma única vez, na tela de quem a gerou, para ser passada a você — ninguém lê a senha de outra pessoa, nem quem a redefiniu. Ela vale por 72 horas e é trocada no seu primeiro acesso.',
    chaves: 'senha esqueci recuperar redefinir provisoria',
  },
  {
    tema: 'Primeiros passos',
    pergunta: 'Posso usar no celular?',
    resposta: 'Sim. No celular, o menu fica na barra de baixo (Hoje, Tarefas, Nova, Programas e Menu). Para ter um atalho, abra o link no navegador e use “Adicionar à tela inicial”.',
    chaves: 'celular mobile telefone app atalho tela inicial',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'O que aparece na tela Hoje?',
    resposta: 'A semana com os dias que têm tarefas (bolinhas douradas; vermelhas quando há atraso), os aniversariantes do dia, o resumo das sessões de programas e a lista de tarefas: primeiro as pendentes de dias anteriores (recolhidas; toque para abrir), depois as de hoje e os próximos passos da jornada. Use “Para mim”, “Que solicitei” ou “Equipe toda” para filtrar.',
    chaves: 'hoje semana dia agenda inicio painel diario',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Como crio uma tarefa?',
    resposta: 'Toque em “Nova tarefa”. Escolha se é uma tarefa interna (da rotina da equipe) ou vinculada a paciente, preencha o que precisa ser feito, o responsável e o prazo. Para paciente, escolha também o tipo de contato.',
    chaves: 'criar nova tarefa cadastrar lancar registrar',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Qual a diferença entre Concluir e Editar?',
    resposta: 'Concluir (tocar no círculo da tarefa) registra que ela foi feita: é aí que entram resultado, data de realização e pagamento. Editar serve só para corrigir dados da tarefa, sem concluí-la. Para registrar algo que aconteceu, use sempre Concluir.',
    chaves: 'concluir editar finalizar terminar fechar circulo diferenca',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Como encontro tarefas antigas ou de outra pessoa?',
    resposta: 'Na aba Tarefas, use os filtros de status (abertas, concluídas, canceladas) e de período, e a busca por texto ou paciente.',
    chaves: 'buscar filtrar procurar tarefas antigas historico status periodo',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Como funciona a jornada do paciente?',
    resposta: 'Cada consulta ou procedimento agendado é uma única tarefa que anda pelas etapas: agendada, confirmada, realizada, orçamento enviado e fechado (ou perdido). Use os botões do próprio cartão (Confirmar, No-show, Reagendar, Registrar orçamento, Fechou, Perdeu): não é preciso criar outra tarefa. Tudo fica registrado em “Evolução”, e a tela Comercial › Jornada do paciente mostra o funil do período.',
    chaves: 'esteira funil etapa confirmar confirmacao no-show noshow faltou reagendar orcamento fechou perdeu kanban',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Como uso o código QR do estoque?',
    resposta: 'Toque em “Ler código” no Estoque (ou ao lado do campo Item na entrada e na saída), aponte a câmera ou tire uma foto da etiqueta. A ferramenta abre o item e você escolhe Uso em paciente, Entrada ou Descarte. O código da caixa do medicamento também funciona: na primeira vez, ligue ao item; depois, validade e lote vêm preenchidos.',
    chaves: 'qr code codigo etiqueta camera celular bipar ler leitura caixa barras datamatrix',
  },
  {
    tema: 'Financeiro',
    pergunta: 'Como fecho o caixa do dia?',
    resposta: 'Em Financeiro › Caixa do dia, informe os totais conferidos de Pix, cartões e dinheiro e toque em Fechar caixa. A conferência é às cegas: depois de fechar, a ferramenta mostra o que foi registrado e a diferença por forma de pagamento.',
    chaves: 'caixa fechar fechamento conferir maquininha gaveta diferenca',
  },
  {
    tema: 'Financeiro',
    pergunta: 'Como registro que paguei uma conta?',
    resposta: 'As contas sob sua responsabilidade aparecem na tela Hoje 3 dias antes do vencimento. Toque em “Paguei”, confira a data e o valor e registre. Contas mensais criam sozinhas a do mês seguinte.',
    chaves: 'conta pagar paguei boleto vencimento despesa',
  },
  {
    tema: 'Financeiro',
    pergunta: 'Onde vejo as despesas por categoria?',
    resposta: 'Em Financeiro › Visão do mês: recebido, despesas pagas por categoria (fixas e variáveis), resultado do mês, contas a pagar, saldo a receber e meta de faturamento.',
    chaves: 'despesas categoria resultado mes visao financeira meta faturamento dre',
    gestao: true,
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Como mando a confirmação da consulta?',
    resposta: 'No cartão do agendamento, toque em “Enviar confirmação”: o WhatsApp abre com a mensagem pronta (dá para editar). O envio fica registrado no cartão. Quando a paciente responder, toque em “Confirmou”. Os agendamentos de amanhã aparecem na tela Hoje, em Próximos passos da jornada.',
    chaves: 'confirmar confirmacao whatsapp mensagem pronta agendamento amanha',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'O paciente faltou. O que faço?',
    resposta: 'No cartão do agendamento, toque em “No-show”. A falta fica registrada (e entra na taxa de no-show da Jornada do paciente) e o cartão vai para “Recontatar”, na tela Hoje, até alguém resolver. Ao falar com a paciente, toque em “Reagendar” e escolha a nova data: o mesmo cartão volta para Agendada, com o histórico completo. Se ela não quiser remarcar, use “Encerrar”. Desmarcação funciona igual.',
    chaves: 'faltou falta no-show noshow nao veio reagendar desmarcou recontatar',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Tarefa atrasada some da lista?',
    resposta: 'Não. Tarefas atrasadas ficam em “Pendentes de dias anteriores”, na tela Hoje, logo acima das tarefas do dia, até serem concluídas ou canceladas. A lista fica recolhida: toque em “ver” para abrir.',
    chaves: 'atrasada atraso pendente vencida',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Como mando mensagem pelo WhatsApp?',
    resposta: 'Nas tarefas de paciente com telefone cadastrado aparece o botão WhatsApp. No celular, ele abre a conversa direto no seu WhatsApp; no computador, abre o WhatsApp Web.',
    chaves: 'whatsapp zap mensagem contato telefone',
  },
  {
    tema: 'Pacientes',
    pergunta: 'Como cadastro um paciente?',
    resposta: 'Em Pacientes › Novo paciente. Informe nome, telefone, data de nascimento (para o lembrete de aniversário), origem e a unidade principal. Também é possível cadastrar direto ao criar uma tarefa.',
    chaves: 'cadastrar paciente novo cliente cadastro',
  },
  {
    tema: 'Pacientes',
    pergunta: 'Como importo a lista de pacientes toda de uma vez?',
    resposta: 'Em Pacientes › Importar pacientes. Baixe a planilha modelo, preencha nome completo, telefone, data de nascimento e data da última consulta (só o nome é obrigatório), escolha o arquivo e toque em “Ler lista”. Confira a prévia e importe. Quem já está cadastrado (mesmo nome ou telefone) não é duplicado: só completa o que estiver vazio.',
    chaves: 'importar lista pacientes planilha excel base cadastro em massa todos de uma vez',
    gestao: true,
  },
  {
    tema: 'Pacientes',
    pergunta: 'Como encontro pacientes que não voltam há muito tempo?',
    resposta: 'Em Pacientes, toque em “Sem retorno há 6+ meses”. A lista considera o último atendimento registrado na ferramenta ou a data da última consulta informada no cadastro, do mais antigo para o mais recente.',
    chaves: 'sumidos inativos recaptacao sem retorno ultima consulta seis meses',
  },
  {
    tema: 'Pacientes',
    pergunta: 'O que mostra a ficha do paciente?',
    resposta: 'Todo o histórico: consultas, procedimentos, contatos, orçamentos, programas e pagamentos, e os produtos utilizados (dose, lote e quem aplicou). Para o administrativo, mostra também o LTV (total já pago à clínica), o ticket médio e o saldo em aberto.',
    chaves: 'ficha paciente historico ltv perfil',
  },
  {
    tema: 'Pacientes',
    pergunta: 'Por que não vejo valores em reais?',
    resposta: 'Valores (receita, LTV, saldo) aparecem só para quem tem a permissão “Ver valores financeiros” no perfil de acesso. O restante da equipe registra os pagamentos normalmente, mas não vê os totais.',
    chaves: 'valor valores reais nao aparece escondido admin permissao',
  },
  {
    tema: 'Atendimentos e pagamentos',
    pergunta: 'Como registro uma consulta agendada que aconteceu?',
    resposta: 'Conclua a própria tarefa “Consulta agendada”: ela vira “Consulta realizada” automaticamente. Se houve pagamento na consulta, preencha o bloco “Houve pagamento?” na mesma tela. Não é preciso criar outra tarefa.',
    chaves: 'consulta agendada realizada concluir atendimento',
  },
  {
    tema: 'Atendimentos e pagamentos',
    pergunta: 'Como lanço um pagamento?',
    resposta: 'Todo dinheiro recebido entra por Financeiro › Recebimentos. Escolha o paciente, diga o que ele está pagando (consulta, sinal, procedimento ou programa novo, programa em andamento ou saldo em aberto), o valor e a forma de pagamento. Se o pagamento foi feito no próprio atendimento, também dá para registrar ao concluir a consulta, o procedimento ou a sessão, em “Recebeu algum valor?”.',
    chaves: 'pagamento receber recebimento lancar valor receita pix cartao dinheiro',
  },
  {
    tema: 'Atendimentos e pagamentos',
    pergunta: 'Lanço a consulta ou o recebimento da consulta?',
    resposta: 'São duas coisas diferentes. A consulta é o atendimento: conclua a tarefa da consulta. O dinheiro é o recebimento: se o paciente pagou na hora, responda “Recebeu algum valor?” ao concluir a consulta e pronto, não lance de novo. Se pagou em outro momento (antes ou depois), use Recebimento › Consulta.',
    chaves: 'consulta recebimento pagamento duvida lancar duas vezes atendimento',
  },
  {
    tema: 'Atendimentos e pagamentos',
    pergunta: 'O paciente já faz um programa e pagou uma parcela. Como lanço?',
    resposta: 'Use Recebimento › Programa em andamento e escolha o programa do paciente. O valor fica ligado ao programa e abate o saldo dele. Não use “Procedimento ou programa novo”: essa opção é só para venda nova.',
    chaves: 'programa programa andamento parcela pagamento sessao vendido rodando',
  },
  {
    tema: 'Atendimentos e pagamentos',
    pergunta: 'O paciente pagou só uma parte. Como registro?',
    resposta: 'No Recebimento, informe o valor pago agora e o restante em “Ficou valor em aberto?”. Quando o paciente pagar o restante, use Recebimento › Saldo em aberto (ou Programa em andamento, se for de um programa): o valor abate o saldo.',
    chaves: 'parcial parte entrada saldo aberto devendo restante parcela',
  },
  {
    tema: 'Atendimentos e pagamentos',
    pergunta: 'Quais formas de pagamento existem?',
    resposta: 'Pix, Dinheiro, Cartão de crédito, Cartão de débito e Nota promissória. O Painel mostra quanto entrou por cada forma.',
    chaves: 'forma pagamento pix dinheiro cartao credito debito nota promissoria',
  },
  {
    tema: 'Atendimentos e pagamentos',
    pergunta: 'Onde vejo quem está devendo?',
    resposta: 'Nos programas: em Programas, toque em “Ver quem deve” no cartão “Saldo a receber nos programas”. Para todos os saldos (orçamentos, procedimentos e programas): no Painel, bloco “Valores em aberto”. O saldo também aparece como alerta na próxima sessão do paciente.',
    chaves: 'devendo divida saldo aberto receber inadimplente quem deve',
    gestao: true,
  },
  {
    tema: 'Programas de acompanhamento',
    pergunta: 'Como coloco um paciente em um programa?',
    resposta: 'Em Programas › Nova adesão: escolha o paciente e a data de início e monte o programa item por item, com o procedimento, o número de sessões, o intervalo, a dose e quando cada item começa (ex.: Tirzepatida 2,5 mg por 4 semanas e depois 5 mg por mais 4). Depois informe o valor total e o pago na adesão. As sessões são criadas automaticamente.',
    chaves: 'programa adesao aderir sessoes pacote acompanhamento montar itens dose',
  },
  {
    tema: 'Programas de acompanhamento',
    pergunta: 'A sessão dá baixa no estoque?',
    resposta: 'Sim. Ao concluir a sessão, sai do estoque o insumo do item na quantidade definida na montagem (a dose) e os descartáveis cadastrados no procedimento. Se a sessão for reaberta, a baixa é desfeita. Na análise do estoque, a diferença entre o saldo esperado e a contagem final mostra o que saiu sem registro.',
    chaves: 'baixa estoque sessao dose insumo consumo automatico perda',
  },
  {
    tema: 'Programas de acompanhamento',
    pergunta: 'Como concluo uma sessão do programa?',
    resposta: 'Toque no círculo da sessão. Informe a data em que foi realizada e escolha se as próximas sessões seguem a partir dessa data ou mantêm as datas originais. Se houve pagamento, preencha “Houve pagamento?”.',
    chaves: 'sessao concluir programa reprogramar datas dose aplicacao',
  },
  {
    tema: 'Programas de acompanhamento',
    pergunta: 'O que acontece quando o programa termina?',
    resposta: 'Ao concluir a última sessão, se o procedimento tiver frequência de retorno cadastrada, a ferramenta cria sozinha uma tarefa de contato para o retorno, com a antecedência definida no cadastro.',
    chaves: 'fim programa termino retorno lembrete repetir procedimento',
  },
  {
    tema: 'Programas de acompanhamento',
    pergunta: 'Como encerro ou cancelo um programa?',
    resposta: 'Abra a adesão em Programas e use “Encerrar programa” (disponível para o administrativo). As sessões ainda abertas são canceladas e o histórico fica guardado.',
    chaves: 'encerrar cancelar programa desistiu parar',
    gestao: true,
  },
  {
    tema: 'Campanhas e relacionamento',
    pergunta: 'Como crio uma campanha?',
    resposta: 'Em Campanhas › Nova campanha: dê um nome, o objetivo e o roteiro. Depois crie tarefas nela ou importe uma lista de pacientes.',
    chaves: 'campanha criar recaptacao acao marketing',
    gestao: true,
  },
  {
    tema: 'Campanhas e relacionamento',
    pergunta: 'Como importo uma lista de pacientes para a campanha?',
    resposta: 'Dentro da campanha, use “Importar lista de pacientes” e “Baixar planilha modelo”. Preencha a planilha (há uma coluna de Observação), escolha o arquivo e toque em “Ler lista”. Uma tarefa é criada para cada paciente.',
    chaves: 'importar lista planilha excel modelo campanha observacao',
    gestao: true,
  },
  {
    tema: 'Campanhas e relacionamento',
    pergunta: 'Onde vejo os aniversariantes?',
    resposta: 'Os do dia aparecem na tela Hoje. Os do mês ficam em Pacientes › Aniversariantes, com atalho para criar a tarefa de contato.',
    chaves: 'aniversario aniversariante parabens nascimento',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Como faço a contagem de estoque?',
    resposta: 'A contagem chega como tarefa (ex.: “Contagem · Alta rotatividade”). Toque no círculo ou em “Abrir contagem”, conte o que está fisicamente no estoque e informe as quantidades (nos itens com validade, quantas vencem em cada mês). Dá para imprimir a lista e contar no papel. Ao concluir, a ferramenta calcula o consumo desde a contagem anterior.',
    chaves: 'estoque contagem inventario contar itens validade imprimir lista',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Chegou uma compra. Como lanço no estoque?',
    resposta: 'Em Processos › Estoque › Entrada pela nota: com a nota em mãos, informe o fornecedor e uma linha por item (quantidade na unidade do estoque, validade e custo). Para um item só, use Registrar entrada. A entrada soma ao estoque até a próxima contagem.',
    chaves: 'estoque entrada compra chegou material nota fornecedor',
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Como registro o produto usado em um paciente?',
    resposta: 'Pela ficha do paciente, em Produtos utilizados › Registrar uso de produto, ou pelo estoque, em Registrar saída › Uso em paciente. Informe o produto, a dose (ex.: 2,5 mg ou 20 UI), o procedimento e o lote. Sessões de programa e procedimentos com insumo registram sozinhos.',
    chaves: 'produto paciente uso dose saida estoque lote aplicacao botox toxina',
  },
  {
    tema: 'Gestão',
    pergunta: 'Como a ferramenta converte caixa, ampola e mg?',
    resposta: 'No cadastro do item, em Unidades de medida: unidade de estoque (ampola), de compra (caixa, com quantas ampolas vêm em cada) e de uso (mg, com quanto tem em cada ampola). A entrada pode ser em caixas, a contagem em ampolas e a dose em mg.',
    chaves: 'unidade medida conversao caixa ampola mg ui ml frasco',
    gestao: true,
  },
  {
    tema: 'Gestão',
    pergunta: 'Quantas ampolas usei no mês passado?',
    resposta: 'Em Processos › Estoque, toque no item: “Consumo por mês” mostra os últimos meses. Na aba Análise, escolha o período (ex.: mês passado) e veja, por item, contagem inicial, entradas, saídas registradas, saldo esperado, contagem final e a diferença.',
    chaves: 'consumo estoque ampolas mes passado quanto usei tirzepatida gasto',
    gestao: true,
  },
  {
    tema: 'Gestão',
    pergunta: 'Como funciona a gestão de pessoas?',
    resposta: 'Em Pessoas › Equipe, cada pessoa da clínica tem uma ficha (cargo, contrato, admissão, documentos, férias). A Visão geral mostra os alertas: férias para programar, fim da experiência, documentos vencendo e banco de horas acima do limite, com botão para gerar tarefa. Nas abas, ficam as metas do mês, as conversas 1:1 e o banco de horas.',
    chaves: 'pessoas equipe ficha ferias experiencia documentos aso coren banco de horas rh colaboradora',
    gestao: true,
  },
  {
    tema: 'Gestão',
    pergunta: 'Como registro a conversa 1:1?',
    resposta: 'Em Pessoas › Conversas 1:1 › Registrar conversa: escolha a pessoa, veja as metas do mês dela e anote pontos fortes, pontos a desenvolver e combinados. Cada combinado pode virar uma tarefa para a pessoa. Também dá para criar a rotina mensal de conversas.',
    chaves: 'conversa 1:1 feedback acompanhamento combinados reuniao individual',
    gestao: true,
  },
  {
    tema: 'Rotina e tarefas',
    pergunta: 'Onde vejo minhas metas?',
    resposta: 'Em Pessoas › Minhas metas. As metas automáticas (agendamentos, confirmações, orçamentos fechados, tarefas no prazo…) se atualizam sozinhas com os seus registros na ferramenta.',
    chaves: 'minhas metas meta resultado progresso desempenho',
  },
  {
    tema: 'Gestão',
    pergunta: 'O que mostra o Painel?',
    resposta: 'Cumprimento de prazos da equipe, receita registrada, ticket médio, contatos, orçamentos, formas de pagamento, Top 10 pagantes e desempenho por unidade, no período escolhido.',
    chaves: 'painel indicadores dashboard resultado receita prazos',
    gestao: true,
  },
  {
    tema: 'Gestão',
    pergunta: 'Como funciona o Top 10 pagantes?',
    resposta: 'Lista os 10 pacientes que mais pagaram, no período do Painel ou desde o início. Toque no nome para abrir a ficha.',
    chaves: 'top 10 ranking melhores clientes pagantes',
    gestao: true,
  },
  {
    tema: 'Gestão',
    pergunta: 'Como cadastro uma pessoa da equipe?',
    resposta: 'Em Configurações › Usuários e acessos › Adicionar pessoa: informe o nome, o usuário para entrar e a função, e escolha o perfil de acesso. A senha é gerada pela ferramenta e aparece uma única vez, agora, para você passar à pessoa — nem você consegue lê-la depois. É o perfil de acesso que decide o que ela vê: valores em reais, Painel geral e Equipe ficam em perfis próprios.',
    chaves: 'equipe usuario cadastrar pessoa funcionario colaborador permissao perfil senha',
    gestao: true,
  },
  {
    tema: 'Gestão',
    pergunta: 'Como cadastro procedimentos e programas?',
    resposta: 'Em Configurações › Procedimentos. Defina nome, sessões e intervalo sugeridos, valor de referência por sessão, a baixa no estoque por sessão (insumo principal e descartáveis) e, se for o caso, de quanto em quanto tempo o procedimento pode ser repetido (para o lembrete de retorno). Os programas são montados por paciente a partir desses procedimentos.',
    chaves: 'procedimento programa catalogo cadastrar frequencia retorno insumo descartavel',
    gestao: true,
  },
  {
    tema: 'Gestão',
    pergunta: 'Como excluo um procedimento ou programa do catálogo?',
    resposta: 'Em Configurações › Procedimentos, toque em Editar no item e depois em “Excluir do catálogo” (toque duas vezes para confirmar). Só é possível excluir itens que nunca foram usados em uma adesão; os demais podem ser desativados desmarcando “Ativo”.',
    chaves: 'excluir apagar remover procedimento programa catalogo desativar',
    gestao: true,
  },
  {
    tema: 'Gestão',
    pergunta: 'A clínica atende em mais de um lugar. Como separo?',
    resposta: 'Cadastre os locais em Configurações › Unidades. Cada paciente tem uma unidade principal, que já vem preenchida nos atendimentos, pagamentos e programas (dá para trocar em cada um). O Painel e a tela Programas podem ser filtrados por unidade.',
    chaves: 'unidade local endereco filial consultorio varios lugares',
    gestao: true,
  },
]
