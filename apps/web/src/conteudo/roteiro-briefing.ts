/**
 * **O ROTEIRO DE BRIEFING DA FIRMARE — conteúdo estático, sem titular.**
 *
 * Fonte: `versoes/firmare-gestao-prototipo/index.html`, `ROTEIRO` (L2034–2133),
 * `PILARES` e `BLOCOS_GESTAO` (L2137–2184). Texto
 * copiado como está, na ORDEM final que o protótipo monta com os dois
 * `splice` da L2192 (o bloco "dor" logo depois de "Quem lidera"; os cinco
 * pilares logo depois de "A clínica e o time").
 *
 * **O que NÃO é igual ao protótipo, e por quê (gate LGPD, `g8-gate-lgpd.md`
 * A5 + A57–A59).** O roteiro nasce já com os três cortes, para que a Etapa 1
 * (respostas gravadas) não precise trocar o roteiro que a equipe aprendeu:
 *
 *  - **A57** — saiu `filhos` ("Tem filhos? Como isso entra na rotina dela").
 *    Pergunta por menor sem necessidade (art. 14). No lugar, a agenda pessoal
 *    sem perguntar por ninguém: `compromissos_fixos`.
 *  - **A58** — saiu `colaboradoras` ("função, tempo de casa, ponto forte" por
 *    pessoa: avaliação nominal de quem não está na conversa). No lugar,
 *    quantas pessoas por função (`pessoas_por_funcao`) e o nome SÓ de quem vai
 *    executar o plano (`quem_executa`, porque vira responsável de tarefa).
 *    `braco_direito` passa a ser uma FUNÇÃO, em escolha fechada — nunca nome.
 *  - **A59** — `inadimplencia` deixou de ser texto livre (é onde se escreve o
 *    nome de quem deve). Agora é escolha fechada mais a faixa de valor.
 *
 * Por isso a versão não é a `2026.10b` do protótipo: é outro conteúdo.
 *
 * Fica FORA o `PLANO_MES` (L2185–2190): é conteúdo do relatório do Mapa de
 * Maturidade, que entra só na Etapa 1 (gate LGPD 1b).
 *
 * Este arquivo é só DADO. O ensaio (`components/carteira/roteiro-*`) lê daqui
 * e nunca grava nada — gate LGPD A1.
 */

export const VERSAO_DO_ROTEIRO = '2026.11a'

export const PROGRAMAS = ['Comercial', 'Financeiro', 'Operações', 'Gestão'] as const
export type Programa = (typeof PROGRAMAS)[number]

/** As três respostas de "sim ou não" do protótipo (`SN`, L2031). */
export const SIM_NAO = ['Sim', 'Não', 'Em parte'] as const

/** Os cinco pilares do Mapa de Maturidade (`PILARES`, L2137), na ordem do radar. */
export const PILARES_DO_MAPA = [
  { id: 'rumo', nome: 'Rumo e metas', curto: 'Rumo' },
  { id: 'rituais', nome: 'Rituais de gestão', curto: 'Rituais' },
  { id: 'pessoas', nome: 'Pessoas e cultura', curto: 'Pessoas' },
  { id: 'processos', nome: 'Processos e ferramentas', curto: 'Processos' },
  { id: 'dados', nome: 'Dados e inteligência', curto: 'Dados' },
] as const
export type PilarDoMapa = (typeof PILARES_DO_MAPA)[number]['id']

/**
 * O campo do cadastro do cliente que a resposta preencheria ao concluir um
 * briefing REAL (o selo "cadastro"). No ensaio é só um selo: nada vai a
 * cadastro nenhum.
 */
export type CampoDoCadastro =
  | 'responsavel'
  | 'telefone'
  | 'nascimento_responsavel'
  | 'cidade'
  | 'segmento'
  | 'resp_comercial'
  | 'resp_comercial_tel'
  | 'resp_trafego'
  | 'resp_trafego_tel'
  | 'resp_marketing'
  | 'resp_marketing_tel'
  | 'resp_financeiro'
  | 'resp_financeiro_tel'

type Base = {
  readonly id: string
  /** O texto da pergunta, como a consultora lê. */
  readonly t: string
  readonly campo?: CampoDoCadastro
  /** A dica de condução, curta. */
  readonly dica?: string
}

/**
 * `porFuncao` é o único tipo que não existe no protótipo: nasceu do corte A58
 * (quantas pessoas em cada função, um número por função, sem nome).
 */
export type Pergunta =
  | (Base & { readonly tipo: 'curto' | 'texto' | 'num' | 'moeda' | 'pct' | 'data' | 'sn' })
  | (Base & { readonly tipo: 'escolha' | 'multi' | 'porFuncao'; readonly op: readonly string[] })
  | (Base & {
      readonly tipo: 'nivel'
      /** Da pior para a melhor: a posição é a nota, de 0 a 3. */
      readonly op: readonly [string, string, string, string]
      /** O que fazer quando a resposta fica em 0 ou 1. */
      readonly acao: string
    })

export type TipoDePergunta = Pergunta['tipo']

export type BlocoDoRoteiro = {
  readonly id: string
  readonly titulo: string
  readonly objetivo: string
  /** A frase de transição, dita em voz alta para abrir o bloco. */
  readonly transicao: string
  /** Sem `prog`, o bloco vale para todos os programas. */
  readonly prog?: readonly Programa[]
  readonly pilar?: PilarDoMapa
  readonly perguntas: readonly Pergunta[]
}

export const ROTEIRO: readonly BlocoDoRoteiro[] = [
  {
    id: 'medica',
    titulo: 'Quem lidera a clínica',
    objetivo: 'Começar pela história dela. Conversa, não formulário.',
    transicao: 'Antes de falar da clínica, quero te conhecer: me conta um pouco da sua trajetória?',
    perguntas: [
      { id: 'responsavel_nome', t: 'Nome completo', tipo: 'curto', campo: 'responsavel' },
      { id: 'whats_dona', t: 'WhatsApp', tipo: 'curto', campo: 'telefone' },
      { id: 'nascimento', t: 'Data de nascimento', tipo: 'data', campo: 'nascimento_responsavel' },
      // A57: no lugar de `filhos`.
      { id: 'compromissos_fixos', t: 'Que compromissos fixos fora da clínica limitam a sua agenda?', tipo: 'curto' },
      { id: 'formacao', t: 'Formação inicial e ano de formatura', tipo: 'curto' },
      { id: 'pos', t: 'Pós graduações e especializações', tipo: 'texto' },
      { id: 'tempo_clinica', t: 'Há quanto tempo tem a clínica', tipo: 'curto' },
      { id: 'outros_locais', t: 'Atende em outros lugares? Onde e em quais dias', tipo: 'texto' },
      { id: 'turnos', t: 'Turnos em que atende na clínica', tipo: 'curto' },
      {
        id: 'gosta_delegar',
        t: 'O que mais gosta de fazer na clínica e o que gostaria de deixar de fazer',
        tipo: 'texto',
        dica: 'Mostra o que ela quer delegar e onde está o desgaste.',
      },
    ],
  },
  {
    id: 'dor',
    titulo: 'Gestão na visão de quem lidera',
    prog: ['Gestão'],
    objetivo:
      'Abrir a conversa pela dor. Escutar mais do que falar e anotar as frases exatas: elas voltam no relatório.',
    transicao: 'Antes de olhar a clínica, quero entender como é, para você, carregar a gestão dela.',
    perguntas: [
      { id: 'gestao_pra_voce', t: 'O que é gestão para você?', tipo: 'texto' },
      {
        id: 'tempo_gestao',
        t: 'Da sua semana, quanto tempo vai para atender e quanto vai para resolver a clínica?',
        tipo: 'curto',
      },
      {
        id: 'deixa_de_fazer',
        t: 'O que você deixa de fazer (na carreira, com a família, no descanso) por estar resolvendo a clínica?',
        tipo: 'texto',
      },
      { id: 'dono_refem', t: 'Hoje você se sente dono da clínica ou refém dela? Por quê?', tipo: 'texto' },
      { id: 'controle_0_10', t: 'De 0 a 10, o quanto você se sente no controle da clínica?', tipo: 'num' },
      { id: 'sem_voce_0_10', t: 'De 0 a 10, o quanto a clínica funciona sem você?', tipo: 'num' },
      {
        id: 'cultura_equipe',
        t: 'Se a sua equipe descrevesse a cultura da clínica hoje, o que diria? E o que você gostaria que ela dissesse?',
        tipo: 'texto',
      },
      {
        id: 'dormir',
        t: 'O que precisaria acontecer para você dormir tranquilo em relação à clínica?',
        tipo: 'texto',
      },
    ],
  },
  {
    id: 'clinica',
    titulo: 'A clínica e o time',
    objetivo: 'Entender a estrutura e quem vai executar o plano.',
    transicao: 'Agora me ajuda a enxergar a clínica por dentro: quem trabalha com você hoje?',
    perguntas: [
      { id: 'cidade', t: 'Cidade e bairro', tipo: 'curto', campo: 'cidade' },
      { id: 'medicos', t: 'Quantos médicos atendem e quais especialidades', tipo: 'texto', campo: 'segmento' },
      {
        id: 'contratacao',
        t: 'Formato de contratação dos médicos parceiros',
        tipo: 'multi',
        op: ['Sublocação de sala', 'Percentual da produção', 'Valor fixo', 'CLT', 'Não há outros médicos', 'Outro'],
      },
      { id: 'time_tamanho', t: 'Tamanho do time (sem contar médicos)', tipo: 'num' },
      // A58: no lugar de `colaboradoras` — número por função, nenhum nome.
      {
        id: 'pessoas_por_funcao',
        t: 'Quantas pessoas em cada função',
        tipo: 'porFuncao',
        op: ['Recepção', 'Comercial', 'Enfermagem e técnicas', 'Administrativo e financeiro', 'Gestão', 'Outras'],
      },
      {
        id: 'quem_executa',
        t: 'Quem vai executar o plano com a Firmare (nome e função)',
        tipo: 'curto',
        dica: 'Só quem vai receber tarefas do plano. Não descreva nem avalie as outras pessoas da equipe.',
      },
      // A58: o braço direito é uma função, nunca um nome.
      {
        id: 'braco_direito',
        t: 'Qual função é o braço direito dela hoje',
        tipo: 'escolha',
        op: ['Gerente', 'Recepção', 'Comercial', 'Administrativo', 'Sócia ou sócio', 'Ninguém', 'Outra'],
      },
      { id: 'metas_time', t: 'O time trabalha com metas?', tipo: 'sn' },
      { id: 'variavel', t: 'Existe comissão ou bonificação? Como funciona', tipo: 'texto' },
      { id: 'reunioes_equipe', t: 'Existe reunião de equipe? Com que frequência', tipo: 'curto' },
    ],
  },
  {
    id: 'g_rumo',
    pilar: 'rumo',
    titulo: 'Rumo e metas',
    prog: ['Gestão'],
    objetivo: 'A clínica sabe para onde vai, e a equipe sabe junto?',
    transicao:
      'Vou te fazer algumas perguntas rápidas. Responda pensando em como é hoje, não em como deveria ser.',
    perguntas: [
      {
        id: 'g_meta_recepcao',
        t: 'Se eu perguntar hoje para a sua recepcionista qual é a meta da clínica este mês, o que ela responde?',
        tipo: 'nivel',
        op: [
          'A clínica não tem meta definida',
          'Ela não saberia responder',
          'Saberia mais ou menos',
          'Saberia o número e como está o andamento',
        ],
        acao: 'Definir a meta do mês e deixá-la visível para toda a equipe',
      },
      {
        id: 'g_fat_tempo',
        t: 'Quanto a clínica faturou no mês passado e quanto sobrou? Em quanto tempo você teria esses números?',
        tipo: 'nivel',
        op: [
          'Não sei',
          'Descubro em alguns dias',
          'Sei o faturamento, mas não quanto sobrou',
          'Tenho os dois números em minutos',
        ],
        acao: 'Instituir o fechamento mensal com faturamento e resultado',
      },
      {
        id: 'g_12meses',
        t: 'Onde a clínica precisa estar daqui a 12 meses? Quem, além de você, sabe disso?',
        tipo: 'nivel',
        op: [
          'Não está claro nem para mim',
          'Está só na minha cabeça',
          'Compartilhei com uma ou duas pessoas',
          'Está escrito e a equipe conhece',
        ],
        acao: 'Escrever a direção dos próximos 12 meses e apresentar à equipe',
      },
      {
        id: 'g_metas_func',
        t: 'Cada pessoa da equipe tem uma meta ou um indicador próprio?',
        tipo: 'nivel',
        op: [
          'Ninguém tem',
          'Só o comercial, informalmente',
          'Algumas pessoas, sem acompanhamento',
          'Todas, com acompanhamento regular',
        ],
        acao: 'Definir um indicador para cada função',
      },
      {
        id: 'g_decisao',
        t: 'Pense na última decisão importante que você tomou. Ela foi baseada em números?',
        tipo: 'nivel',
        op: [
          'Decidi pelo feeling',
          'Olhei alguns números soltos',
          'Usei números, mas juntar deu trabalho',
          'Decidi olhando um painel de indicadores',
        ],
        acao: 'Montar o painel com os três indicadores que guiam as decisões',
      },
    ],
  },
  {
    id: 'g_rituais',
    pilar: 'rituais',
    titulo: 'Rituais de gestão',
    prog: ['Gestão'],
    objetivo: 'Gestão que acontece com hora marcada, e não só quando o problema aparece.',
    transicao: 'Agora quero entender o ritmo da clínica: quando as coisas são conversadas e decididas.',
    perguntas: [
      {
        id: 'g_reunioes',
        t: 'Que reuniões acontecem toda semana na clínica, com dia e hora marcados?',
        tipo: 'nivel',
        op: [
          'Nenhuma',
          'Só quando surge um problema',
          'Existem, mas são remarcadas com frequência',
          'Acontecem toda semana, com pauta',
        ],
        acao: 'Implantar a reunião semanal de resultados, com dia, hora e pauta fixos',
      },
      {
        id: 'g_ultima_reuniao',
        t: 'Quando foi a última reunião com a equipe? O que foi decidido e onde ficou registrado?',
        tipo: 'nivel',
        op: [
          'Não lembro',
          'Faz mais de um mês e nada foi registrado',
          'Foi recente, mas sem registro',
          'Foi recente, com decisões e responsáveis registrados',
        ],
        acao: 'Registrar decisões, responsáveis e prazos em toda reunião',
      },
      {
        id: 'g_problemas',
        t: 'Quando um problema acontece na clínica, como você fica sabendo?',
        tipo: 'nivel',
        op: [
          'Quando já estourou',
          'Pelo WhatsApp, a qualquer hora',
          'Pela gestora, sem um momento definido',
          'Em um momento combinado, com dados',
        ],
        acao: 'Definir o canal e o momento certos para os problemas chegarem até você',
      },
      {
        id: 'g_diario',
        t: 'A equipe começa o dia alinhada sobre agenda, prioridades e pendências?',
        tipo: 'nivel',
        op: ['Não', 'Cada uma se organiza sozinha', 'Às vezes, de forma informal', 'Sim, todo dia, em poucos minutos'],
        acao: 'Implantar o alinhamento diário de 10 minutos',
      },
      {
        id: 'g_fechamento',
        t: 'Existe um momento no mês para olhar o resultado e planejar o mês seguinte?',
        tipo: 'nivel',
        op: ['Não', 'Só quando o mês foi ruim', 'Às vezes', 'Todo mês, com data fixa'],
        acao: 'Instituir a reunião mensal de fechamento e planejamento',
      },
    ],
  },
  {
    id: 'g_pessoas',
    pilar: 'pessoas',
    titulo: 'Pessoas e cultura',
    prog: ['Gestão'],
    objetivo: 'A cultura foi construída de propósito ou foi acontecendo?',
    transicao: 'Vamos falar das pessoas. É aqui que a cultura aparece.',
    perguntas: [
      {
        id: 'g_15dias',
        t: 'Se você ficar 15 dias fora, o que acontece com a clínica?',
        tipo: 'nivel',
        op: ['Para', 'Funciona com muitos problemas', 'Funciona, mas me ligam o tempo todo', 'Funciona normalmente'],
        acao: 'Reduzir a dependência de quem lidera: responsabilidades e autonomia definidas',
      },
      {
        id: 'g_integracao',
        t: 'Como uma pessoa nova aprende o trabalho aqui?',
        tipo: 'nivel',
        op: [
          'Aprende sozinha, no dia a dia',
          'Acompanha alguém por alguns dias',
          'Tem um treinamento, mas sem material',
          'Tem roteiro de integração e material escrito',
        ],
        acao: 'Criar o roteiro de integração de novas colaboradoras',
      },
      {
        id: 'g_valores',
        t: 'Quais comportamentos você mais valoriza na equipe? A equipe sabe disso?',
        tipo: 'nivel',
        op: [
          'Nunca parei para pensar',
          'Sei, mas nunca falei',
          'Falo de vez em quando',
          'Estão claros e são reforçados no dia a dia',
        ],
        acao: 'Explicitar os valores e os comportamentos esperados',
      },
      {
        id: 'g_feedback',
        t: 'Como cada pessoa da equipe sabe se está indo bem?',
        tipo: 'nivel',
        op: ['Não sabe', 'Só quando erra', 'Recebe retornos informais', 'Tem conversas de feedback periódicas'],
        acao: 'Implantar conversas mensais de feedback',
      },
      {
        id: 'g_autonomia',
        t: 'Além de você, alguém toma decisões na clínica?',
        tipo: 'nivel',
        op: [
          'Não, tudo passa por mim',
          'Só coisas pequenas',
          'A gestora decide algumas coisas',
          'Há autonomia clara por área',
        ],
        acao: 'Definir o que cada pessoa pode decidir sozinha',
      },
      {
        id: 'g_saidas',
        t: 'Quantas pessoas saíram no último ano, e por quê?',
        tipo: 'nivel',
        op: [
          'Muitas, e não sei bem o motivo',
          'Algumas, por insatisfação',
          'Poucas, por motivos pessoais',
          'Quase ninguém sai',
        ],
        acao: 'Entender as saídas e cuidar da permanência da equipe',
      },
    ],
  },
  {
    id: 'g_processos',
    pilar: 'processos',
    titulo: 'Processos e ferramentas',
    prog: ['Gestão'],
    objetivo: 'O trabalho depende da memória das pessoas ou de um sistema?',
    transicao: 'Agora vamos olhar como o trabalho acontece no dia a dia.',
    perguntas: [
      {
        id: 'g_tarefas',
        t: 'Onde ficam as tarefas da equipe hoje?',
        tipo: 'nivel',
        op: [
          'Na cabeça de cada uma',
          'No WhatsApp',
          'Em planilha ou caderno',
          'Em uma ferramenta, com prazo e responsável',
        ],
        acao: 'Levar as tarefas para a FIR Clinic, com prazo e responsável',
      },
      {
        id: 'g_followup',
        t: 'Um paciente fez orçamento e não fechou. Quem liga para ele, e quando?',
        tipo: 'nivel',
        op: [
          'Ninguém',
          'Depende de quem lembrar',
          'Alguém liga, sem prazo definido',
          'Há responsável e prazo, com registro',
        ],
        acao: 'Implantar o follow up de orçamentos na FIR Clinic',
      },
      {
        id: 'g_duvidas',
        t: 'Quanto do seu dia vai para responder dúvidas operacionais da equipe?',
        tipo: 'nivel',
        op: ['Boa parte do dia', 'Algumas horas', 'Pouco tempo', 'Quase nada'],
        acao: 'Escrever os processos que mais geram dúvidas',
      },
      {
        id: 'g_pops',
        t: 'Existe passo a passo escrito para recepção, agendamento e pós consulta?',
        tipo: 'nivel',
        op: ['Não', 'Só na cabeça de quem faz', 'Existe algo, desatualizado', 'Escrito, atualizado e usado'],
        acao: 'Documentar os três processos mais críticos',
      },
      {
        id: 'g_recorrentes',
        t: 'As atividades que se repetem (confirmar agenda, cobrar, repor estoque) têm dono e frequência?',
        tipo: 'nivel',
        op: [
          'Não',
          'Acontecem quando alguém lembra',
          'Têm dono, mas sem controle',
          'Têm dono, frequência e controle',
        ],
        acao: 'Cadastrar as rotinas recorrentes na FIR Clinic',
      },
    ],
  },
  {
    id: 'g_dados',
    pilar: 'dados',
    titulo: 'Dados e inteligência',
    prog: ['Gestão'],
    objetivo: 'Os números existem, são confiáveis e orientam as decisões?',
    transicao: 'Para fechar esta parte, quero entender o que você enxerga da clínica em números.',
    perguntas: [
      {
        id: 'g_origem',
        t: 'De onde veio cada paciente novo deste mês?',
        tipo: 'nivel',
        op: ['Não sei', 'Tenho uma ideia', 'Registro às vezes', 'Registro sempre e acompanho'],
        acao: 'Registrar a origem de todo paciente novo',
      },
      {
        id: 'g_conversao',
        t: 'De cada 10 consultas, quantas viram tratamento ou procedimento?',
        tipo: 'nivel',
        op: ['Não sei', 'Chuto um número', 'Sei aproximadamente', 'Sei e acompanho mês a mês'],
        acao: 'Acompanhar a conversão toda semana',
      },
      {
        id: 'g_inativos',
        t: 'Você sabe quantos pacientes não voltam há mais de 6 meses?',
        tipo: 'nivel',
        op: ['Não', 'Tenho uma ideia', 'Consigo levantar com esforço', 'Sei e trabalho essa lista'],
        acao: 'Criar a rotina de reativação de pacientes',
      },
      {
        id: 'g_numeros_semana',
        t: 'Quais números você olha toda semana?',
        tipo: 'nivel',
        op: ['Nenhum', 'Só o faturamento, quando lembro', 'Alguns, sem regularidade', 'Um painel fixo, toda semana'],
        acao: 'Definir o painel semanal de indicadores',
      },
    ],
  },
  {
    id: 'numeros',
    titulo: 'Números da clínica',
    prog: ['Comercial', 'Financeiro'],
    objetivo: 'Ter clareza do ponto de partida. O que ela não souber vira pendência, sem constrangimento.',
    transicao: 'Para eu entender o tamanho da clínica, me passa uma ideia dos números. Não precisa ser exato.',
    perguntas: [
      { id: 'fat_medio', t: 'Faturamento médio mensal (R$)', tipo: 'moeda' },
      { id: 'melhor_pior', t: 'Melhor e pior mês do ano', tipo: 'curto' },
      { id: 'atendimentos_mes', t: 'Atendimentos por mês', tipo: 'num' },
      { id: 'novos_mes', t: 'Pacientes novos por mês', tipo: 'num' },
      { id: 'ticket', t: 'Ticket médio por paciente (R$)', tipo: 'moeda' },
      {
        id: 'top10',
        t: 'Top 10 produtos ou serviços',
        tipo: 'texto',
        dica: 'Se ela não souber, marcar Perguntar depois: Firmare levanta no sistema.',
      },
      { id: 'precos', t: 'Preços dos principais produtos e serviços', tipo: 'texto' },
      { id: 'sabe_sobra', t: 'Sabe quanto sobra no fim do mês?', tipo: 'sn' },
      { id: 'fat_objetivo', t: 'Qual faturamento mensal ela tem como objetivo (R$)', tipo: 'moeda' },
    ],
  },
  {
    id: 'captacao',
    titulo: 'Captação e comercial',
    prog: ['Comercial'],
    objetivo: 'O caminho do paciente: de onde vem, como é atendido, se fecha e se volta.',
    transicao: 'Vamos falar de como o paciente chega até você e o que acontece depois.',
    perguntas: [
      { id: 'canais', t: 'Canais de captação de novos pacientes e qual traz mais', tipo: 'texto' },
      { id: 'comercial_externo', t: 'Possui comercial externo?', tipo: 'sn' },
      { id: 'quem_atende', t: 'Quem atende o WhatsApp e agenda', tipo: 'curto' },
      {
        id: 'tempo_resposta',
        t: 'Em quanto tempo um contato novo é respondido',
        tipo: 'escolha',
        op: ['Em minutos', 'Em até 1 hora', 'No mesmo dia', 'No dia seguinte ou mais', 'Não sabe'],
      },
      { id: 'conversao', t: 'De cada 10 consultas, quantas viram procedimento ou tratamento', tipo: 'num' },
      { id: 'orcamento', t: 'Como o orçamento é apresentado e se existe follow up', tipo: 'texto' },
      { id: 'acompanhamento', t: 'Possui programa de acompanhamento do paciente?', tipo: 'sn' },
      { id: 'indicacao', t: 'Possui programa de indicação?', tipo: 'sn' },
      { id: 'reativacao', t: 'Faz reativação de pacientes antigos?', tipo: 'sn' },
      { id: 'aniversariantes', t: 'Faz alguma ação com aniversariantes?', tipo: 'sn' },
      {
        id: 'google',
        t: 'Faz uso do Google',
        tipo: 'multi',
        op: ['Perfil da clínica', 'Avaliações', 'Anúncios', 'Site', 'Não usa'],
      },
      { id: 'instagram', t: 'Instagram e tráfego pago: quem cuida e quanto investe por mês', tipo: 'texto' },
      { id: 'campanha_boa', t: 'Alguma campanha que funcionou muito bem', tipo: 'texto' },
      {
        id: 'quem_comercial',
        t: 'Pessoa responsável pelo comercial dentro da clínica',
        tipo: 'curto',
        campo: 'resp_comercial',
      },
      { id: 'tel_comercial', t: 'WhatsApp da pessoa do comercial', tipo: 'curto', campo: 'resp_comercial_tel' },
    ],
  },
  {
    id: 'financeiro',
    titulo: 'Financeiro',
    prog: ['Financeiro'],
    objetivo: 'Saber se os números são confiáveis e como o dinheiro é controlado.',
    transicao: 'Agora quero entender como o dinheiro da clínica é acompanhado.',
    perguntas: [
      { id: 'controle', t: 'Como são controladas entradas e saídas', tipo: 'texto' },
      { id: 'pf_pj', t: 'Contas pessoais e da empresa são separadas?', tipo: 'sn' },
      { id: 'fluxo', t: 'Existe fluxo de caixa atualizado?', tipo: 'sn' },
      { id: 'dre', t: 'Existe DRE mensal?', tipo: 'sn' },
      { id: 'precificacao', t: 'Como os preços foram definidos e quando foram revisados', tipo: 'texto' },
      // A59: escolha fechada no lugar do texto livre, mais a faixa de valor.
      {
        id: 'inadimplencia',
        t: 'Há inadimplência ou valores em aberto relevantes?',
        tipo: 'escolha',
        op: ['Não há', 'Pouca', 'Relevante'],
      },
      {
        id: 'inadimplencia_faixa',
        t: 'Faixa do valor em aberto',
        tipo: 'escolha',
        op: ['Até R$ 5 mil', 'De R$ 5 mil a R$ 20 mil', 'De R$ 20 mil a R$ 50 mil', 'Acima de R$ 50 mil', 'Não sabe'],
        dica: 'Só a faixa. Nunca o nome de quem deve.',
      },
      { id: 'prolabore', t: 'Ela tem pró labore definido?', tipo: 'sn' },
    ],
  },
  {
    id: 'operacoes',
    titulo: 'Operações',
    prog: ['Operações'],
    objetivo: 'Quanto a clínica depende dela e o que está escrito.',
    transicao: 'Vamos olhar como a rotina funciona no dia a dia.',
    perguntas: [
      { id: 'funcoes_definidas', t: 'Cada pessoa sabe exatamente o que é responsabilidade dela?', tipo: 'sn' },
      { id: 'organograma', t: 'Existe organograma e descrição de funções?', tipo: 'sn' },
      { id: 'processos', t: 'Existem processos escritos (POPs, checklists)?', tipo: 'sn' },
      { id: 'depende_dona', t: 'Se ela se ausentar uma semana, o que trava', tipo: 'texto' },
      { id: 'gargalos', t: 'Onde a rotina mais trava hoje', tipo: 'texto' },
    ],
  },
  {
    id: 'sistemas',
    titulo: 'Sistemas, ferramentas e parceiros',
    objetivo: 'Quem precisa entrar no circuito de dados e quais acessos pedir.',
    transicao: 'Para eu montar os acompanhamentos, preciso saber com quais sistemas e parceiros você trabalha.',
    perguntas: [
      {
        id: 'sistemas',
        t: 'Sistemas usados',
        tipo: 'multi',
        op: [
          'Clinicorp',
          'Amigo',
          'Ebrain',
          'Feegow',
          'iClinic',
          'Kommo',
          'RD Station',
          'Planilha',
          'Agenda de papel',
          'Outro',
        ],
      },
      {
        id: 'sistemas_obs',
        t: 'Para que cada sistema é usado (agenda, prontuário, financeiro, CRM)',
        tipo: 'texto',
      },
      { id: 'quem_trafego', t: 'Agência ou pessoa do tráfego pago', tipo: 'curto', campo: 'resp_trafego' },
      { id: 'tel_trafego', t: 'WhatsApp do tráfego pago', tipo: 'curto', campo: 'resp_trafego_tel' },
      { id: 'quem_marketing', t: 'Social media ou marketing', tipo: 'curto', campo: 'resp_marketing' },
      { id: 'tel_marketing', t: 'WhatsApp do marketing', tipo: 'curto', campo: 'resp_marketing_tel' },
      { id: 'quem_financeiro', t: 'Quem cuida do financeiro', tipo: 'curto', campo: 'resp_financeiro' },
      { id: 'tel_financeiro', t: 'WhatsApp do financeiro', tipo: 'curto', campo: 'resp_financeiro_tel' },
      { id: 'contador', t: 'Contador', tipo: 'curto' },
      { id: 'outros_parceiros', t: 'Outros parceiros importantes', tipo: 'texto' },
    ],
  },
  {
    id: 'visao',
    titulo: 'Para onde ela quer ir',
    prog: ['Comercial', 'Financeiro', 'Operações'],
    objetivo: 'Fechar com o desejo dela, nas palavras dela.',
    transicao: 'Para terminar essa parte: olhando para frente, o que você quer para a clínica?',
    perguntas: [
      { id: 'doze_meses', t: 'Onde quer que a clínica esteja em 12 meses', tipo: 'texto' },
      { id: 'tira_sono', t: 'O que mais tira o sono na gestão hoje', tipo: 'texto' },
      { id: 'ja_tentou', t: 'O que já tentou e não deu certo', tipo: 'texto' },
      { id: 'quatro_meses', t: 'Se em 4 meses uma coisa estivesse resolvida, qual seria', tipo: 'texto' },
    ],
  },
  {
    id: 'encerramento',
    titulo: 'Encerramento',
    objetivo: 'Não sair da reunião sem acesso solicitado e agendas marcadas.',
    transicao: 'Antes de desligar, vamos deixar os próximos passos marcados.',
    perguntas: [
      { id: 'acesso_sistema', t: 'Acesso ao sistema: qual sistema', tipo: 'curto' },
      { id: 'acesso_quem', t: 'Quem da clínica envia o acesso', tipo: 'curto' },
      { id: 'acesso_prazo', t: 'Até quando o acesso será enviado', tipo: 'data' },
      { id: 'time_data', t: 'Reunião com o time: data', tipo: 'data' },
      { id: 'time_hora', t: 'Reunião com o time: horário', tipo: 'curto' },
      { id: 'time_quem', t: 'Quem participa da reunião com o time', tipo: 'texto' },
      {
        id: 'semanal_dia',
        t: 'Reuniões semanais: dia da semana',
        tipo: 'escolha',
        op: ['segunda', 'terça', 'quarta', 'quinta', 'sexta'],
      },
      { id: 'semanal_hora', t: 'Reuniões semanais: horário', tipo: 'curto' },
      { id: 'semanal_inicio', t: 'Data da primeira reunião semanal', tipo: 'data' },
      { id: 'semanal_quem', t: 'Quem participa das reuniões semanais', tipo: 'texto' },
      { id: 'proximos', t: 'Outros combinados', tipo: 'texto' },
      {
        id: 'impressoes',
        t: 'Impressões de quem conduziu (uso interno)',
        tipo: 'texto',
        dica: 'Perfil dela, abertura para mudança, riscos. Não vai para a cliente.',
      },
    ],
  },
]

/** Os blocos de um programa (`blocosDe`, L2193): sem `prog` vale para todos. */
export function blocosDoPrograma(programa: Programa): readonly BlocoDoRoteiro[] {
  return ROTEIRO.filter((b) => b.prog === undefined || b.prog.includes(programa))
}

/**
 * As respostas FICTÍCIAS e FIXAS de "Preencher com respostas de exemplo"
 * (`exemploEnsaio`, L2901–2902). Gate LGPD A2: nunca derivadas de cliente
 * real. Uma frase mudou: "Deixo de estudar e de ficar com meus filhos" virou
 * "...com a família" — o roteiro não pergunta mais por filhos (A57), e o
 * exemplo não deve ensinar o contrário.
 */
export const RESPOSTAS_DE_EXEMPLO: Readonly<Record<string, string>> = {
  responsavel_nome: 'Dra. Exemplo',
  gestao_pra_voce: 'É eu saber o que está acontecendo na clínica sem precisar estar lá o tempo todo.',
  deixa_de_fazer: 'Deixo de estudar e de ficar com a família.',
  dono_refem: 'Refém. Tudo passa por mim.',
  controle_0_10: '4',
  sem_voce_0_10: '3',
  dormir: 'Saber que a equipe resolve sem me ligar.',
}

/** A sequência de notas que o exemplo usa nos `nivel`, em rodízio (L2901). */
export const NOTAS_DE_EXEMPLO = [0, 1, 2, 1, 3, 0, 1, 2] as const
