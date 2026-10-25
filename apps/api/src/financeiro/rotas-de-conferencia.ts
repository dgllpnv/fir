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
    razao:
      'Os últimos fechamentos. Só devolve dias FECHADOS por construção (lê `caixas_do_dia`, e um dia aberto não tem linha lá) — mas ela mostra `diferenca`, que é o esperado a um passo, então entra na varredura para que isso continue sendo verdade.',
  },
  // Task 11 acrescenta `/v1/visao-do-mes?mes=:mes` — o mês CORRENTE contém o
  // dia de hoje, e o "recebido por forma" dele de um mês em curso é o
  // esperado somado com outro nome.
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
  { caminho: '/v1/eu', razao: 'Quem é você, a clínica e os perfis. Nenhum valor, nenhum dia.' },
  { caminho: '/v1/clinica', razao: 'Nome, código e fuso da clínica.' },
  { caminho: '/v1/equipe', razao: 'As pessoas ativas, para os seletores. Nenhum valor.' },
  { caminho: '/v1/unidades', razao: 'As unidades da clínica. Nenhum valor.' },
  { caminho: '/v1/motivos-de-perda', razao: 'O catálogo de motivos do funil. Nenhum valor.' },
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
    caminho: '/v1/jornada',
    razao:
      'O funil por etapa. Soma valor de ORÇAMENTO, que não é receita e não está na gaveta (regra 4).',
  },
]
