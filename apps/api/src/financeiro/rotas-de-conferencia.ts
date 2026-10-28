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
}

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
