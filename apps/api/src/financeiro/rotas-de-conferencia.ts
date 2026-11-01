/**
 * As rotas que tocam **um dia cujo caixa pode estar aberto**.
 *
 * Existe porque a regra 6 não é uma propriedade de `GET /v1/caixa`: é uma
 * propriedade do SISTEMA. Um agregado por forma de pagamento de um dia aberto
 * **é o esperado com outra etiqueta**, venha ele da rota do caixa, da lista de
 * recebimentos, da tela Hoje ou da Visão do mês filtrada por hoje.
 *
 * `transporte-as-cegas.test.ts` varre esta lista — e, desde o épico 4, varre
 * também o que **não** está nela: toda rota `GET` do `AppModule` precisa
 * aparecer aqui **ou** em `ROTAS_FORA_DA_CONFERENCIA`, com razão escrita. A
 * lista deixou de ser mantida à mão e passou a ser **derivada do catálogo de
 * rotas do Nest**: esquecer de classificar uma rota nova quebra a suíte, que
 * era precisamente a fraqueza anotada no relatório das Tasks 1–7 ("a lista é
 * mantida à mão e, se alguém esquecer, nada acusa").
 *
 * `:dia` é substituído pelo dia sob teste.
 */
export type RotaDeConferencia = {
  readonly caminho: string
  /** Por que esta rota toca o dia. Escrita para quem for acrescentar a próxima. */
  readonly razao: string
  /**
   * Chaves que, nesta rota, **podem** existir — com a razão escrita.
   *
   * A varredura tem duas asserções: a CHAVE não existe, e o NÚMERO não
   * aparece. A primeira é certeira em `/v1/caixa` e `/v1/recebimentos`, onde
   * um `porForma` seria o esperado com outra etiqueta. Na Visão do mês
   * `porForma` é o nome legítimo do bloco "Recebido por forma", e o que a
   * regra 6 exige lá não é a ausência da chave — é que ela **não alcance um
   * dia cujo caixa está aberto**. Quem prova isso é a asserção de NÚMERO, que
   * continua valendo integralmente.
   *
   * Liberar uma chave aqui é barato e visível; o que não se pode é liberar o
   * número.
   */
  readonly chavesPermitidas?: readonly { readonly chave: string; readonly razao: string }[]
  /**
   * Chaves que, **nesta rota**, não podem existir — além das globais.
   *
   * Existe porque a lista global (`esperado`, `porForma`, `diferenca`,
   * `conferido`, `contado`) é a do CAIXA, e o esperado da CONTAGEM não se chama
   * assim: ele se chama `esperadoEmEstoque`, porque `esperado` está em
   * `CAMPOS_MONETARIOS` e a redação o apagaria — a contagem da enfermagem
   * sairia sem número nenhum (o mesmo defeito de `saldo` → `saldoEmEstoque`).
   *
   * Sem esta lista, a varredura cobraria da contagem a ausência de chaves que
   * ela nunca teria, e **nenhuma** asserção de chave pegaria o campo
   * reintroduzido com o nome certo.
   */
  readonly chavesProibidas?: readonly string[]
  /**
   * Números que não podem aparecer no corpo desta rota, **sob nome nenhum**.
   *
   * É esta asserção — e não a de chave — que pega o campo RENOMEADO. A global
   * (`A_SOMA`) é a soma do caixa, em centavos; o esperado de uma contagem é uma
   * QUANTIDADE em milésimos, e nenhum número de dinheiro a alcança.
   *
   * Quem monta a fixture declara aqui o que o servidor teria de ter somado para
   * entregar o esperado — um número que não existe em lugar nenhum da resposta
   * legítima.
   */
  readonly numerosProibidos?: readonly string[]
  /**
   * Um parâmetro de caminho que a varredura precisa preencher, e o que ele é.
   *
   * `:contagem` é o id da contagem ABERTA que a fixture criou. Sem isto, a rota
   * da contagem não poderia entrar na varredura — e ficar de fora dela é
   * exatamente o que a nota do épico 6 mandou não fazer.
   */
  readonly parametro?: 'contagem'
}

/**
 * O ESPERADO da contagem da fixture, em toda forma que ele poderia atravessar.
 *
 * A fixture de `transporte-as-cegas.test.ts` monta um item com contagem
 * inicial de **10 ampolas**, uma entrada de **4** e um consumo de **1**. O
 * esperado é **13**, e `13000` é um número que **não existe** em nenhuma
 * resposta legítima da contagem: os três movimentos individuais valem 10000,
 * 4000 e 1000, e a resposta da contagem aberta não traz movimento nenhum.
 *
 * É a mesma construção do `57000` do caixa — o agregado que só pode aparecer
 * se o servidor tiver somado por alguém. Um número que já estivesse na
 * resposta por outro motivo não distinguiria vazamento de dado legítimo.
 */
const ESPERADO_DA_CONTAGEM = ['13000', '13 ampola', '13,000', '"13"'] as const

export const ROTAS_DE_CONFERENCIA: readonly RotaDeConferencia[] = [
  {
    caminho: '/v1/recebimentos?dia=:dia',
    razao:
      'Devolve os recebimentos do dia, um a um. A lista individual é o instrumento de trabalho e fica; o que não pode é um AGREGADO por forma — o servidor nunca faz a soma por quem vai contar a gaveta.',
  },
  {
    caminho: '/v1/hoje',
    razao:
      'A tela do dia. O épico 4 lhe acrescenta o bloco financeiro ("fechar o caixa de hoje"), e ele é BOOLEANO: um valor ali seria o esperado chegando pela porta dos fundos.',
  },
  {
    caminho: '/v1/caixa?dia=:dia',
    razao:
      'A rota do próprio ritual. Enquanto o dia está aberto a resposta é `CaixaAberto`, que NÃO TEM os campos `esperado`, `contado`, `diferenca` nem `porForma` — eles não existem no contrato, e por isso não há como construí-la com o número dentro.',
  },
  {
    caminho: '/v1/caixa/ultimos',
    chavesPermitidas: [
      {
        chave: 'diferenca',
        razao:
          'A lista só contém dias JÁ FECHADOS — ela lê `caixas_do_dia`, e um dia aberto não tem linha lá. A diferença de um dia conferido é o número que a clínica veio ver; o que a asserção de NÚMERO continua impedindo é que algo do dia aberto entre aqui.',
      },
      {
        chave: 'conferido',
        razao: 'O booleano derivado — é ele que a equipe sem `valores` lê, e ele não é número.',
      },
    ],
    razao:
      'Os últimos fechamentos. Só devolve dias FECHADOS por construção (lê `caixas_do_dia`, e um dia aberto não tem linha lá) — mas ela mostra `diferenca`, que é o esperado a um passo, então entra na varredura para que isso continue sendo verdade.',
  },
  {
    caminho: '/v1/visao-do-mes?mes=:mes',
    chavesPermitidas: [
      {
        chave: 'diferenca',
        razao:
          'É `caixa.diferenca`: a soma das diferenças dos caixas JÁ FECHADOS do mês. Um dia aberto não tem linha em `caixas_do_dia` e não entra nessa soma.',
      },
      {
        chave: 'porForma',
        razao:
          'É o bloco "Recebido por forma" do mês, e ele soma SÓ os dias com caixa já fechado — `porFormaAteODia` e `porFormaDiasSemCaixa` declaram o recorte. A asserção de NÚMERO é que prova isso, e ela continua valendo.',
      },
    ],
    razao:
      'O mês CORRENTE contém o dia de hoje, e o "recebido por forma" de um mês em curso é o esperado somado com outro nome — a soma do mês inclui a do dia. É a rota mais perigosa da lista, e ela exige `finmes` (logo `valores`): quem a abre já vê valor em toda tela, e mesmo assim não pode receber a gaveta de hoje somada por forma.',
  },

  // -------------------------------------------------------------------------
  // A CONTAGEM ÀS CEGAS (regra 14) — o épico 6, segunda fatia.
  //
  // A regra 14 é a mesma regra 6 noutro número: a quantidade ESPERADA não
  // atravessa para o cliente antes do fechamento da contagem. *Quem implementa
  // só uma das duas implementou nenhuma*, e é por isso que estas duas rotas
  // entram AQUI, e não na lista de fora — onde estão as três rotas de LEITURA
  // de item, com a nota explicando que a classificação delas não serve para
  // esta. O catálogo é o estado da prateleira; a contagem é o esperado de quem
  // vai contar.
  //
  // `numerosProibidos` é o que pega o campo RENOMEADO: a lista global `A_SOMA`
  // é dinheiro em centavos, e o esperado de uma contagem é quantidade em
  // milésimos. Sem ele, trocar `esperadoEmEstoque` por `previstoEmEstoque`
  // passaria verde.
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // O PAINEL GERAL (épico 8) — e ele entra AQUI, não na lista de fora.
  //
  // A varredura me pegou, e a pergunta dela era a certa: o painel **agrega
  // recebimentos por FORMA DE PAGAMENTO num período que pode conter hoje** —
  // e um período personalizado de `de = ate = hoje` entrega exatamente o
  // esperado da gaveta que alguém ainda vai contar. É a mesma classe de
  // `visao-do-mes`, com uma janela que a gestora escolhe.
  //
  // A defesa é a mesma que o épico 4 construiu: `porForma` só soma os dias com
  // caixa JÁ FECHADO, e `porFormaAteODia`/`porFormaDiasSemCaixa` declaram o
  // recorte. **O protótipo vaza aqui** (`rec.forEach(t => fs[t.formaPagamento]…)`,
  // sem olhar caixa nenhum) — divergência consciente.
  // -------------------------------------------------------------------------
  {
    caminho: '/v1/painel',
    chavesPermitidas: [
      {
        chave: 'porForma',
        razao:
          'Soma SÓ os dias do período cujo caixa já foi fechado — o `EXISTS` em `caixas_do_dia` é o corte, e `porFormaAteODia`/`porFormaDiasSemCaixa` o declaram. A asserção de NÚMERO é que prova isso, e ela continua valendo.',
      },
    ],
    razao:
      'O período do painel pode conter HOJE, e "recebido por forma" num período em curso é o esperado somado com outro nome — com a agravante de a janela ser escolhida por quem olha. Exige `painel` (logo `valores`): quem a abre já vê valor em toda tela, e mesmo assim não pode receber a gaveta de hoje somada por forma.',
  },
  {
    caminho: '/v1/estoque/contagens',
    chavesProibidas: [
      'esperadoEmEstoque',
      'anteriorEmEstoque',
      'diferencaEmEstoque',
      'saldoEmEstoque',
      'esperado',
      'diferenca',
    ],
    numerosProibidos: ESPERADO_DA_CONTAGEM,
    razao:
      'A lista de contagens. Ela traz as ABERTAS, e o resumo de uma contagem aberta é o lugar mais fácil de vazar o esperado — um "quanto o sistema acha que tem" no cartão da lista chegaria antes de alguém abrir a contagem.',
  },
  {
    caminho: '/v1/estoque/contagens/:id',
    parametro: 'contagem',
    chavesProibidas: [
      'esperadoEmEstoque',
      'anteriorEmEstoque',
      'diferencaEmEstoque',
      'saldoEmEstoque',
      'loteSugerido',
      'esperado',
      'diferenca',
    ],
    numerosProibidos: ESPERADO_DA_CONTAGEM,
    razao:
      'A contagem em si, e é a rota do ritual. Enquanto aberta, a resposta é `ContagemAberta`, que NÃO TEM `esperadoEmEstoque`, `anteriorEmEstoque` nem `diferencaEmEstoque` — e também não tem os lotes conhecidos do item, porque pré-preencher as validades conta à pessoa o que o sistema espera achar na prateleira.',
  },
]

/**
 * As rotas `GET` que **não** tocam um dia cujo caixa possa estar aberto.
 *
 * Esta lista não protege nada sozinha: ela existe para que a varredura possa
 * cobrar que TODA rota `GET` foi classificada. Uma rota nova que ninguém
 * classifique derruba o teste — e a pergunta que ela força é a certa: *"esta
 * rota devolve agregado de um dia que ainda não foi conferido?"*
 *
 * Acrescentar uma linha aqui é barato e deliberado. O que não existe mais é a
 * terceira opção: ficar de fora das duas listas em silêncio.
 */
export type RotaForaDaConferencia = {
  readonly caminho: string
  readonly razao: string
}

export const ROTAS_FORA_DA_CONFERENCIA: readonly RotaForaDaConferencia[] = [
  { caminho: '/v1/saude', razao: 'Healthcheck: devolve {ok, banco}, sem dado de clínica.' },
  // ---------------------------------------------------------------------
  // O PAINEL DO SUPERADMIN (migration 0013, D-10).
  //
  // As quatro rotas tratam SÓ IDENTIDADE: quem é o operador, que clínicas
  // existem, e quem são as pessoas de uma delas. Nenhuma devolve dinheiro,
  // nenhuma soma um dia, e nenhuma sabe o que é um caixa.
  //
  // E elas estão a DUAS camadas de poder vazar um valor, não a zero: sem
  // `req.contexto`, o `RedacaoInterceptor` cai no `pode = () => false` e
  // apaga todo campo monetário. **No dia em que o painel mostrar dinheiro,
  // esta classificação é a primeira a revisitar** — e a resposta certa será
  // dar ao contexto do operador um `pode` próprio, nunca desligar o
  // interceptor.
  // ---------------------------------------------------------------------
  {
    caminho: '/v1/superadmin/eu',
    razao: 'Quem é o OPERADOR do painel. Nenhum valor, nenhum dia, nenhuma clínica.',
  },
  {
    caminho: '/v1/superadmin/clinicas',
    razao:
      'A lista de clínicas: código, nome, fuso e `ativa`. É o catálogo de ' +
      'tenants, não dado de nenhum deles.',
  },
  {
    caminho: '/v1/superadmin/clinicas/:clinicaId/pessoas',
    razao:
      'As pessoas de uma clínica, vistas pelo painel: usuário, nome, função, ' +
      'perfil e se a senha é provisória. Nenhum salário (épico 7), nenhum ' +
      'valor, nenhum dia.',
  },
  {
    caminho: '/v1/superadmin/clinicas/:clinicaId/pessoas/:pessoaId',
    razao: 'A ficha de uma pessoa, com os mesmos campos da lista acima.',
  },
  { caminho: '/v1/eu', razao: 'Quem é você, a clínica e os perfis. Nenhum valor, nenhum dia.' },
  { caminho: '/v1/clinica', razao: 'Nome, código e fuso da clínica.' },
  { caminho: '/v1/equipe', razao: 'As pessoas ativas, para os seletores. Nenhum valor.' },
  { caminho: '/v1/unidades', razao: 'As unidades da clínica. Nenhum valor.' },
  {
    caminho: '/v1/pessoas',
    razao:
      'Usuários e acessos: nome, usuário, função, perfil e ativação. Nenhum ' +
      'salário (épico 7), nenhum valor, nenhum dia — e nenhuma senha, que é o ' +
      'ponto da D-0.',
  },
  {
    caminho: '/v1/pessoas/perfis',
    razao: 'A matriz de permissões da clínica. Chaves de permissão, nenhum valor.',
  },
  // ---------------------------------------------------------------------
  // A EQUIPE (épico 7, primeira metade) — `/v1/fichas`.
  //
  // A ficha aberta DEVOLVE DINHEIRO (`salario`), e mesmo assim as quatro
  // ficam fora da conferência às cegas pela mesma razão do custo do estoque:
  // a conferência é sobre **agregado de um dia cujo caixa pode estar
  // aberto**. Salário não é o esperado de nada; ele é redigido pela regra 17,
  // com a chave `pessoas.gerir` em vez de `valores`.
  //
  // O banco de horas é a classificação que vale escrever: ele AGREGA por MÊS,
  // e um mês contém dias de caixa aberto. Ele fica fora porque o número é
  // MINUTO transcrito do app de ponto — não é dinheiro nem é derivado de
  // recebimento, e nenhuma soma de caixa o alcança. Se um dia ele passar a
  // carregar custo de hora extra, esta linha é a primeira a revisitar.
  // ---------------------------------------------------------------------
  {
    caminho: '/v1/fichas',
    razao:
      'A lista de fichas: nome, cargo, contrato, meses de casa e contagem de ' +
      'alertas. SEM salário — ele só existe na ficha aberta.',
  },
  {
    caminho: '/v1/fichas/:id',
    razao:
      'A ficha de RH, com `salario` — redigido por `pessoas.gerir`. Não há ' +
      'agregado de dia nenhum: férias e documentos são calendário.',
  },
  {
    caminho: '/v1/fichas/horas/:mes',
    razao:
      'O banco de horas: MINUTO transcrito do app de ponto, por mês. Não é ' +
      'dinheiro, não deriva de recebimento, e nenhuma soma de caixa o alcança.',
  },
  {
    caminho: '/v1/fichas/configuracao',
    razao: 'O limite de alerta do banco de horas, em minutos. Nenhum valor, nenhum dia.',
  },
  // ---------------------------------------------------------------------
  // AS METAS DA PESSOA (épico 7, segunda fatia).
  //
  // As três AGREGAM por MÊS, e um mês contém dias de caixa aberto — então a
  // pergunta é legítima e a resposta tem de ser escrita, não presumida.
  //
  // Elas ficam FORA porque o agregado delas não é o ESPERADO de nada. A
  // conferência às cegas protege dois números: o esperado do caixa por forma
  // (regra 6) e o esperado da contagem de estoque (regra 14). Os dois têm a
  // mesma forma — *"o sistema acha que você vai achar X"* —, e mostrá-los
  // antes do fechamento transforma a conferência em confirmação.
  //
  // O realizado de uma meta é o oposto disso: é o que foi REGISTRADO, contado
  // sobre tarefas e recebimentos que já existem. `orc_valor` soma pagamentos
  // de orçamento JÁ LANÇADOS; ele não antecipa nada que alguém vá contar.
  //
  // **E ele não vaza o esperado do caixa por outro caminho**, que é a pergunta
  // que de fato importa aqui: o caixa é conferido por FORMA de pagamento num
  // DIA, e a meta é uma soma por PESSOA num MÊS, sem recorte de forma e sem
  // recorte de dia. Nenhuma das três responde "quanto o sistema espera na
  // gaveta hoje". O valor em si é redigido pela regra 17 — sem `valores`, a
  // meta entrega só o percentual.
  //
  // **Se um dia a meta ganhar recorte de DIA e de FORMA, esta é a primeira
  // linha a revisitar.**
  // ---------------------------------------------------------------------
  {
    caminho: '/v1/metas-de-pessoa/:mes',
    razao:
      'As metas da equipe no mês, com o REALIZADO — contado sobre registros ' +
      'que já existem, nunca um esperado. Sem recorte de dia nem de forma de ' +
      'pagamento, então não responde "quanto o sistema espera na gaveta".',
  },
  {
    caminho: '/v1/minhas-metas/:mes',
    razao: 'As metas da própria pessoa, a mesma forma da rota acima e o mesmo raciocínio.',
  },
  {
    caminho: '/v1/conversas',
    razao:
      'As conversas 1:1 registradas: três blocos de texto, data e mês de ' +
      'referência. Nenhum valor, nenhum agregado.',
  },
  // ---------------------------------------------------------------------
  // O ESTOQUE (épico 6).
  //
  // As três devolvem DINHEIRO — `custo` do item e do movimento de entrada —,
  // e mesmo assim ficam FORA da conferência às cegas, porque a conferência é
  // sobre **agregado de um dia cujo caixa pode estar aberto**: o esperado do
  // caixa e o esperado da contagem. Custo de item não é nenhum dos dois; ele é
  // redigido pela regra 17 (sem `valores`, vem `null`) e é isso que o protege.
  //
  // **A contagem às cegas é OUTRA rota, e ela não existe ainda.** Quando
  // `criarContagem`/`salvarContagem` chegarem, a quantidade ESPERADA não pode
  // atravessar antes do fechamento (regra 14) — e aí a rota da contagem entra
  // em `ROTAS_DE_CONFERENCIA`, não aqui. Esta nota existe para que quem a
  // escrever não copie a classificação destas três por parecerem vizinhas.
  // ---------------------------------------------------------------------
  // ---------------------------------------------------------------------
  // AS CAMPANHAS (épico 8) — fora, e a razão precisa ser escrita porque elas
  // DEVOLVEM receita de um período que pode conter hoje.
  //
  // O que a conferência às cegas protege é o agregado **por FORMA DE
  // PAGAMENTO num dia** (regra 6) — é por forma que a recepcionista confere a
  // gaveta. A campanha devolve um total de receita por CAMPANHA, sem recorte
  // de forma e sem recorte de dia, e o período dela é semanas. Nenhuma das
  // quatro rotas responde "quanto o sistema espera em dinheiro, em Pix e em
  // cartão hoje".
  //
  // **Se a campanha ganhar quebra por forma de pagamento, esta é a primeira
  // linha a revisitar** — e a resposta certa será a mesma do painel: só os
  // dias com caixa fechado.
  // ---------------------------------------------------------------------
  {
    caminho: '/v1/campanhas',
    razao:
      'A receita de cada campanha, sem recorte de forma de pagamento e sem ' +
      'recorte de dia. Não é o esperado de gaveta nenhuma; é redigida pela ' +
      'regra 17 como qualquer outro valor.',
  },
  {
    caminho: '/v1/estoque',
    razao:
      'O catálogo de itens, com saldo DERIVADO e custo. Não é agregado de dia ' +
      'nenhum: é o estado atual da prateleira, que a equipe precisa ver para ' +
      'trabalhar. O custo é redigido sem `valores` (regra 17).',
  },
  {
    caminho: '/v1/estoque/locais',
    razao: 'Onde o item fica na clínica. Nenhum valor, nenhum dia.',
  },
  {
    caminho: '/v1/estoque/movimentos',
    razao:
      'O extrato de entradas e saídas, linha a linha. Não é esperado de nada ' +
      '— é o que foi REGISTRADO, que é justamente o lado que a conferência às ' +
      'cegas não precisa esconder. O custo de entrada é redigido sem `valores`.',
  },
  {
    caminho: '/v1/estoque/analise',
    razao:
      'A análise do período, e ela DEVOLVE `esperadoEmEstoque` — o que é ' +
      'correto, e não uma exceção. A regra 14 proíbe o esperado de atravessar ' +
      'ANTES do fechamento da contagem em que alguém vai contar; uma contagem ' +
      'FECHADA não pode mais ser influenciada. É a mesma classificação de ' +
      '`GET /v1/caixa/ultimos`, que mostra a diferença dos dias já fechados. ' +
      'E ela não alcança rascunho por CONSTRUÇÃO: `analiseDoPeriodo` só compara ' +
      'grupos de movimento de `contagem`, e um rascunho aberto não gerou ' +
      'movimento nenhum — ele mora em `contado_na_contagem`, que esta consulta ' +
      'não lê. **No dia em que esta rota passar a ler o rascunho, ela muda de ' +
      'lista.**',
  },
  { caminho: '/v1/motivos-de-perda', razao: 'O catálogo de motivos do funil. Nenhum valor.' },
  {
    caminho: '/v1/procedimentos',
    razao:
      'O CATÁLOGO da clínica (épico 5). Devolve `valorPorSessao`, que é PREÇO ' +
      'DE REFERÊNCIA do procedimento — não receita (regra 4), não soma de dia ' +
      'nenhum e não muda quando alguém recebe. A conferência às cegas é sobre ' +
      'o AGREGADO DO DIA; um preço de tabela não é um, e esconder a tabela de ' +
      'preços de quem monta o programa não mediria conferência nenhuma. A ' +
      'redação (regra 17) continua valendo, e há teste para ela.',
  },
  {
    caminho: '/v1/programas',
    razao:
      'O painel de programas (épico 5). Devolve `saldoAReceber` e o `saldo` de ' +
      'cada programa — **dívida acumulada**, não agregado de dia nenhum. A ' +
      'conferência às cegas é sobre quanto ENTROU num dia cujo caixa pode estar ' +
      'aberto; o saldo em aberto não muda quando o caixa fecha e não é ' +
      'comparável com gaveta nenhuma. E esconder o saldo de quem vai atender a ' +
      'paciente é o oposto do que o MANUAL pede: o aviso existe para a cobrança ' +
      'acontecer NO atendimento. A redação (regra 17) continua valendo.',
  },
  {
    caminho: '/v1/programas/:id',
    razao:
      'A ficha do programa. `recebido` é a soma dos pagamentos DAQUELE programa ' +
      'ao longo de meses, não de um dia — o mesmo raciocínio do LTV da ficha do ' +
      'paciente, que já está fora por este motivo. `saldo` é dívida. Nenhum dos ' +
      'dois é comparável com o que está na gaveta hoje.',
  },
  { caminho: '/v1/busca-de-pacientes', razao: 'Três campos: id, nome e telefone (decisão D-7).' },
  {
    caminho: '/v1/auditoria',
    razao:
      'A trilha de escrita. Devolve o diff de linhas já gravadas, nunca um agregado do dia — e um `INSERT` de `caixa_por_forma` só existe DEPOIS do fechamento.',
  },
  {
    caminho: '/v1/pacientes',
    razao:
      'Lista de pacientes: LTV e saldo POR PACIENTE, que não é agregado do dia. O LTV de uma paciente não revela o que está na gaveta.',
  },
  { caminho: '/v1/pacientes/:id', razao: 'A ficha de uma paciente. Mesma razão da lista.' },
  {
    caminho: '/v1/pacientes/:id/saldo',
    razao: 'O saldo em aberto de uma paciente, agrupado por programa. Não é dinheiro do dia.',
  },
  {
    caminho: '/v1/cobrancas',
    razao:
      'Saldo a receber por paciente, somado sobre o que ficou EM ABERTO — nunca sobre o que entrou na gaveta hoje.',
  },
  { caminho: '/v1/cobrancas/:pacienteId/mensagem', razao: 'Texto, e sem valor nenhum dentro.' },
  {
    caminho: '/v1/tarefas',
    razao:
      'Lista de tarefas. O pagamento embutido aparece POR TAREFA; não há soma por forma nem por dia.',
  },
  {
    caminho: '/v1/contas',
    razao:
      'Contas A PAGAR. É dinheiro que SAI, e o caixa confere o que entrou — nenhuma das duas listas alcança a outra.',
  },
  {
    caminho: '/v1/metas/:mes/percentual',
    razao: 'Meta e recebido do MÊS, mais o percentual. Nenhum recorte por dia nem por forma.',
  },
  {
    caminho: '/v1/configuracoes/financeiro',
    razao: 'Responsável pelo caixa e modelo da mensagem de cobrança. Nenhum valor.',
  },
  {
    caminho: '/v1/jornada',
    razao:
      'O funil por etapa. Soma valor de ORÇAMENTO, que não é receita e não está na gaveta (regra 4).',
  },
]
