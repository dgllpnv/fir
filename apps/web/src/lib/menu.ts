import { type ChaveDePermissao, type Perfil, temPerm } from '@fir/domain'

export type GrupoDeMenu =
  | 'Dia a dia'
  | 'Comercial'
  | 'Financeiro'
  | 'Processos'
  | 'Pessoas'
  | 'Gestão'
  | 'Configurações'

export type ItemDeMenu = {
  readonly href: string
  readonly rotulo: string
  readonly grupo: GrupoDeMenu
  /** `null` = sempre liberado. Ver CLAUDE.md §2, regra 16. */
  readonly perm: ChaveDePermissao | null
  /**
   * O épico de `docs/roadmap.md` que constrói esta tela. `null` = já existe.
   *
   * Não é enfeite: enquanto a tela não existe, o menu aponta para uma rota que
   * daria 404 — e 404 numa ferramenta de balcão lê como "quebrou". Com o épico
   * e a promessa aqui, a rota não construída diz o que vai ser, e o
   * `docs/design.md` já exige que o estado vazio seja parte do ticket.
   */
  readonly epico: number | null
  /** Uma frase: o que a tela entrega quando existir. */
  readonly promessa: string
  /**
   * Item que a lateral desenha como **ação**, e não como item de menu.
   *
   * "Nova tarefa" e "Recebimento" são as duas coisas mais frequentes que a
   * recepção faz, e as duas CRIAM alguma coisa — não são lugares para onde se
   * vai, são coisas que se fazem. Desenhá-las como link no meio de dezessete
   * outros é enterrar o caminho de dois toques dentro de uma lista, que é
   * exatamente o que `docs/design.md` §1 manda não fazer.
   *
   * Continua sendo item de MENU (tem `href`, `perm` e `promessa`): some para
   * quem não pode, e a varredura `menu-vs-telas` continua cobrando a página.
   */
  readonly acao?: true
}

/** Hoje, Tarefas, Nova tarefa e Minhas metas são de todos — `perm: null`, sem depender de perfil. */
export const MENU: readonly ItemDeMenu[] = [
  { href: '/hoje', rotulo: 'Hoje', grupo: 'Dia a dia', perm: null,
    epico: null,
    promessa:
      'As tarefas do dia, as pendentes de dias anteriores e os aniversariantes.',
  },
  { href: '/tarefas', rotulo: 'Tarefas', grupo: 'Dia a dia', perm: null,
    epico: null,
    promessa:
      'Toda a lista de tarefas, com filtro por pessoa, por semana e por status.',
  },
  { href: '/nova', rotulo: 'Nova tarefa', grupo: 'Dia a dia', perm: null,
    epico: null, acao: true,
    promessa:
      'Criar tarefa em dois toques: paciente, tipo, data, horário e responsável.',
  },
  {
    href: '/recebimento',
    rotulo: 'Recebimento',
    grupo: 'Dia a dia',
    perm: 'receber',
    epico: null,
    acao: true,
    promessa:
      'Registrar um recebimento em dois toques, sem passar pela tela do financeiro.',
  },
  { href: '/jornada', rotulo: 'Jornada do paciente', grupo: 'Comercial', perm: 'jornada',
    epico: null,
    promessa:
      'O funil do paciente por etapas — contato, orçamento, fechamento e perda com motivo.',
  },
  { href: '/pacientes', rotulo: 'Pacientes', grupo: 'Comercial', perm: 'pacientes',
    epico: null,
    promessa:
      'Cadastro, histórico e ficha do paciente, com o saldo em aberto por programa.',
  },
  { href: '/programas', rotulo: 'Programas', grupo: 'Comercial', perm: 'programas',
    epico: null,
    promessa:
      'Programa montado por itens, sessões da enfermagem e retorno por item.',
  },
  { href: '/campanhas', rotulo: 'Campanhas', grupo: 'Comercial', perm: 'campanhas',
    epico: null,
    promessa:
      'Campanha com tipo, métrica e meta, importação de lista e funil do período.',
  },
  { href: '/recebimentos', rotulo: 'Recebimentos', grupo: 'Financeiro', perm: 'receber',
    epico: null,
    promessa:
      'Recebimento avulso e o saldo em aberto, agrupado por adesão.',
  },
  { href: '/caixa', rotulo: 'Caixa do dia', grupo: 'Financeiro', perm: 'caixa',
    epico: null,
    promessa:
      'O caixa do dia, conferido às cegas: você conta antes de ver o esperado.',
  },
  { href: '/contas', rotulo: 'Contas a pagar', grupo: 'Financeiro', perm: 'contas',
    epico: null,
    promessa:
      'Contas a pagar, com lembrete três dias antes do vencimento.',
  },
  { href: '/cobrancas', rotulo: 'Cobranças', grupo: 'Financeiro', perm: 'cobrancas',
    epico: null,
    promessa:
      'Quem está com saldo em aberto, e o registro de cada cobrança feita.',
  },
  { href: '/visao-do-mes', rotulo: 'Visão do mês', grupo: 'Financeiro', perm: 'finmes',
    epico: null,
    promessa:
      'A receita do mês por categoria, contra a meta.',
  },
  { href: '/estoque', rotulo: 'Estoque', grupo: 'Processos', perm: 'estoque',
    epico: null,
    promessa:
      'Item com as três unidades, lote por validade, contagem às cegas e entrada por NF-e.',
  },
  { href: '/equipe', rotulo: 'Equipe', grupo: 'Pessoas', perm: 'pessoas.gerir',
    epico: null,
    /**
     * A promessa voltou a mencionar metas e 1:1 porque as DUAS abas existem
     * agora — e a história vale ficar: enquanto não existiam, a frase foi
     * cortada, porque uma promessa que descreve o que a tela não tem ensina a
     * equipe a procurar um botão que não há (o mesmo conserto da promessa de
     * "convidar por e-mail" em Usuários e acessos).
     */
    promessa:
      'Fichas com contrato e salário, férias, documentos, metas do mês com os 8 indicadores, conversas 1:1 e banco de horas.',
  },
  { href: '/minhas-metas', rotulo: 'Minhas metas', grupo: 'Pessoas', perm: null,
    epico: null,
    promessa:
      'Suas metas do mês e o realizado, atualizado pelas tarefas concluídas.',
  },
  { href: '/painel', rotulo: 'Painel geral', grupo: 'Gestão', perm: 'painel',
    epico: null,
    /**
     * A promessa diz o que a tela TEM, e agora ela tem o capítulo 10 inteiro:
     * os quatro blocos que faltavam (Top 10 pagantes, desempenho por unidade,
     * campanhas no período e novos pacientes por origem) entraram na segunda
     * fatia do épico 8. Enquanto não existiam, a frase os omitia de propósito
     * — prometer o que não há ensina a equipe a procurar um bloco que não
     * existe.
     */
    promessa:
      'Prazos da equipe, pacientes no período, Top 10 pagantes, unidades, campanhas e origens.',
  },
  {
    href: '/unidades',
    rotulo: 'Unidades',
    grupo: 'Configurações',
    perm: 'config',
    epico: null,
    promessa: 'As unidades da clínica, para separar agenda, caixa e estoque por local.',
  },
  {
    href: '/usuarios',
    rotulo: 'Usuários e acessos',
    grupo: 'Configurações',
    perm: 'config',
    epico: null,
    /**
     * A promessa dizia "convidar por e-mail", e **o e-mail saiu do produto
     * inteiro** (D-10): não há coluna, não há convite, não há SMTP. A frase
     * ficou pendurada desde antes da decisão, e uma promessa que descreve uma
     * tela que não vai existir é pior que nenhuma — ela ensina a equipe a
     * procurar um botão que não há.
     */
    promessa:
      'Adicionar pessoa com senha provisória, ativar e desativar, e editar os perfis de permissão.',
  },
  {
    href: '/atividades',
    rotulo: 'Atividades',
    grupo: 'Configurações',
    perm: 'config',
    epico: null,
    promessa: 'O que a equipe fez na clínica: quem, quando e o que mudou, com filtros.',
  },
  {
    href: '/procedimentos',
    rotulo: 'Procedimentos',
    grupo: 'Configurações',
    /**
     * `config` e **não** `programas.gerir` — e isto é a API falando.
     *
     * `CatalogoController` exige `programas` para LER e `config` para cada
     * escrita (salvar, editar, excluir). O catálogo é **configuração** da
     * clínica, não operação do dia: quem monta programas usa o catálogo; quem
     * o EDITA muda o que toda nova adesão vai sugerir. Pôr `programas.gerir`
     * no menu mostraria a tela a quem só consegue ler dentro dela — que é
     * exactamente o tipo de item que ensina a equipe a tocar e levar 403.
     */
    perm: 'config',
    epico: null,
    promessa: 'O catálogo de procedimentos, com os insumos que cada um consome.',
  },
  {
    href: '/agenda-do-sistema',
    rotulo: 'Agenda do sistema',
    grupo: 'Configurações',
    /**
     * `config`, o mesmo que as rotas `/v1/agenda-externa` exigem (ADR 0019).
     * O link iCal dá leitura da agenda de pacientes: colá-lo é configuração
     * da clínica, não operação do balcão.
     */
    perm: 'config',
    epico: null,
    promessa:
      'O link iCal da agenda do sistema da clínica, que cria e reagenda os cartões da jornada sozinho.',
  },
  {
    href: '/grupos-da-clinica',
    rotulo: 'Grupos que recebem a clínica',
    grupo: 'Configurações',
    /** `config`, o mesmo que `GET /v1/clinica/grupos` exige. Transparência: quem recebe o uso agregado da clínica. */
    perm: 'config',
    epico: null,
    promessa: 'Quais grupos recebem os números agregados da clínica, desde quando e por quê.',
  },
  {
    href: '/ajuda',
    rotulo: 'Ajuda e manual',
    grupo: 'Gestão',
    /**
     * `perm: null` — **a tela que todo perfil tem**, com `/hoje`, `/tarefas`,
     * `/nova` e `/minhas-metas`.
     *
     * É o que o manual dela promete (cap. 1, "Perfis de acesso": *"Todos os
     * perfis têm Hoje, as próprias tarefas, Nova tarefa, ficha do paciente,
     * Minhas metas, Ajuda e Manual"*) — e é como a clínica nova aprende a
     * ferramenta. O que depende de permissão é o CONTEÚDO de gestão, dentro
     * da tela.
     *
     * Fica em **Gestão** porque é o grupo do fim do menu, onde ela mora no
     * protótipo: é consulta, não rotina do balcão.
     */
    perm: null,
    epico: null,
    promessa:
      'As 51 perguntas frequentes com busca e o manual em 14 capítulos, escritos pela PO.',
  },
]

/** Tela sem permissão **some do menu**. Quem alcança por URL vê "Sem acesso". */
export function itensDoMenu(
  usuario: { admin: boolean; perfilId: string | null },
  perfis: readonly Perfil[],
): ItemDeMenu[] {
  const u = { admin: usuario.admin, perfilId: usuario.perfilId ?? '' }
  return MENU.filter((i) => i.perm === null || temPerm(u, perfis, i.perm))
}

/**
 * Como a lateral desenha o menu: títulos soltos e grupos que abrem uma lista.
 *
 * A cliente pediu "só os títulos, e os subtítulos em lista suspensa
 * quando colocássemos o mouse". É o desenho do protótipo (`itensMenu`): o que
 * se usa o dia todo fica solto, e o resto vira um grupo com os itens dentro.
 * A ordem abaixo é a do dia da recepção, não a alfabética.
 *
 * Mora aqui, e não no componente, para a ordem e a regra "grupo de um item
 * vira link" serem testáveis sem montar tela.
 */
type EntradaDoLayout =
  | { readonly tipo: 'link'; readonly href: string }
  | { readonly tipo: 'acoes' }
  | { readonly tipo: 'grupo'; readonly titulo: GrupoDeMenu; readonly hrefs: readonly string[] }
  | { readonly tipo: 'separador' }

export const LAYOUT_DO_MENU: readonly EntradaDoLayout[] = [
  { tipo: 'link', href: '/hoje' },
  { tipo: 'link', href: '/tarefas' },
  { tipo: 'acoes' },
  { tipo: 'grupo', titulo: 'Comercial', hrefs: ['/jornada', '/pacientes', '/programas', '/campanhas'] },
  {
    tipo: 'grupo',
    titulo: 'Financeiro',
    hrefs: ['/recebimentos', '/caixa', '/contas', '/cobrancas', '/visao-do-mes'],
  },
  { tipo: 'grupo', titulo: 'Processos', hrefs: ['/estoque'] },
  { tipo: 'grupo', titulo: 'Pessoas', hrefs: ['/equipe', '/minhas-metas'] },
  { tipo: 'separador' },
  { tipo: 'link', href: '/painel' },
  {
    tipo: 'grupo',
    titulo: 'Configurações',
    hrefs: [
      '/unidades',
      '/usuarios',
      '/procedimentos',
      '/atividades',
      '/agenda-do-sistema',
      '/grupos-da-clinica',
    ],
  },
  { tipo: 'link', href: '/ajuda' },
]

export type BlocoDeMenu =
  | { readonly tipo: 'link'; readonly item: ItemDeMenu }
  | { readonly tipo: 'acoes'; readonly itens: readonly ItemDeMenu[] }
  | { readonly tipo: 'grupo'; readonly titulo: GrupoDeMenu; readonly itens: readonly ItemDeMenu[] }
  | { readonly tipo: 'separador' }

/**
 * Os itens já filtrados por permissão, nos blocos que a lateral desenha.
 *
 * Três garantias, todas por construção e todas com teste:
 *  - **sem título órfão**: o bloco nasce dos itens que SOBRARAM do filtro; grupo
 *    sem item não existe. Um "FINANCEIRO" sozinho diria à Enfermagem que há
 *    algo ali que ela não abre (`docs/design.md`: tela sem permissão some);
 *  - **grupo com um item só vira link direto**: abrir uma lista para achar uma
 *    única opção são dois toques onde um bastava (Estoque, ou Minhas metas
 *    para quem não gere pessoas);
 *  - **separador não fica nas pontas nem dobrado**.
 */
export function secoesDoMenu(itens: readonly ItemDeMenu[]): BlocoDeMenu[] {
  const porHref = new Map(itens.map((i) => [i.href, i]))
  const blocos: BlocoDeMenu[] = []
  for (const e of LAYOUT_DO_MENU) {
    if (e.tipo === 'separador') {
      blocos.push({ tipo: 'separador' })
    } else if (e.tipo === 'link') {
      const item = porHref.get(e.href)
      if (item) blocos.push({ tipo: 'link', item })
    } else if (e.tipo === 'acoes') {
      const acoes = itens.filter((i) => i.acao === true)
      if (acoes.length > 0) blocos.push({ tipo: 'acoes', itens: acoes })
    } else {
      const doGrupo = e.hrefs.flatMap((h) => {
        const i = porHref.get(h)
        return i ? [i] : []
      })
      const [unico] = doGrupo
      if (doGrupo.length === 1 && unico) blocos.push({ tipo: 'link', item: unico })
      else if (doGrupo.length > 1) blocos.push({ tipo: 'grupo', titulo: e.titulo, itens: doGrupo })
    }
  }
  return blocos.filter(
    (b, i) =>
      b.tipo !== 'separador' ||
      (i > 0 && i < blocos.length - 1 && blocos[i - 1]?.tipo !== 'separador'),
  )
}
