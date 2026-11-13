import type { ItemDoOrcamentoNaSaida, ItemOrcadoNaSaida, TarefaNaLista } from '@fir/contracts'
import {
  type Autor,
  type Etapa,
  type EventoDeJornada,
  itensDoOrcamentoDe,
  situacaoDoFechamento,
} from '@fir/domain'
import { ForbiddenException } from '@nestjs/common'
import type pg from 'pg'
import { exigePessoa, pessoaDoAtor, type PessoaId } from '../banco/ator'
import type { ClinicaId } from '../banco/clinica-id'
import type { ContextoDaRequisicao } from '../comum/contexto'

/**
 * O autor como as regras de `packages/domain` o querem, com o id ainda
 * MARCADO como `PessoaId`.
 *
 * `Autor.id` é `string` porque o domínio não conhece a marca nominal da
 * infraestrutura. Sem este cruzamento, todo serviço que recebesse um `Autor` e
 * precisasse gravá-lo (em `recebimentos.registrado_por`, por exemplo) teria de
 * escrever `autor.id as PessoaId` — e o `as` espalhado é exatamente o que
 * `banco/ator.ts` existe para impedir.
 */
export type AutorDaRequisicao = Autor & {
  readonly id: PessoaId
  /**
   * `temPerm(…, 'jornada')` JÁ RESOLVIDO.
   *
   * Mora aqui, ao lado de `podeEquipe`, pela mesma razão: a consulta da tela
   * Hoje precisa saber se os três blocos da jornada entram na resposta, e uma
   * consulta que resolve permissão por conta própria é uma consulta que
   * alguém vai chamar de outro lugar sem resolvê-la.
   */
  readonly podeJornada: boolean
}

/**
 * Quem está LENDO — o mesmo de cima, com o `id` solto.
 *
 * `string` e não `PessoaId`: na sessão de suporte (D-13) ele é `''`, que não
 * casa com `responsavel_id` de ninguém. É o tipo que diz, no nome, que este
 * valor **não assina nada** — e é por isso que ele não é aceito onde se grava.
 */
export type LeitorDaRequisicao = Omit<AutorDaRequisicao, 'id'> & { readonly id: string }

/**
 * Quem está agindo, do jeito que `packages/domain` entende.
 *
 * `podeEquipe` é `temPerm(…, 'tarefas.equipe')` JÁ RESOLVIDO — as quatro
 * autorizações de tarefa não conhecem permissão, só o booleano. É o que
 * impede um `if (usuario.admin)` de voltar para dentro delas.
 *
 * Mora aqui, e não em cada controlador, porque os dois controladores de
 * tarefa precisam dele: duas cópias e a segunda esquece o `pode(...)`,
 * entregando `podeEquipe: false` a quem acompanha a equipe — ou, pior, o
 * contrário.
 */
export const autorDe = (c: ContextoDaRequisicao): AutorDaRequisicao => ({
  /**
   * `exigePessoa` — e a SESSÃO DE SUPORTE é RECUSADA aqui (D-13).
   *
   * Este autor é quem **assina**: ele vai para `tarefas.responsavel_id` (NOT
   * NULL), para `recebimentos.registrado_por` (NOT NULL) e para o `historico`
   * da tarefa, que é o registro de quem moveu o cartão na jornada.
   *
   * Não há resposta honesta para "qual pessoa" quando o ator é o operador.
   * Concluir um atendimento, fechar um orçamento, concluir uma sessão com
   * baixa de dose — são **rituais da clínica**, feitos por quem trabalha
   * nela. Emprestar o id de uma funcionária poria o nome dela num atendimento
   * que ela não fez, num histórico que não se reescreve.
   *
   * O operador continua **vendo tudo**: quem lê usa `leitorDe`, logo abaixo.
   */
  id: exigePessoa(c.ator),
  podeEquipe: c.pode('tarefas.equipe'),
  podeJornada: c.pode('jornada'),
})

/**
 * Quem está **lendo** — e aqui a sessão de suporte passa.
 *
 * `Autor` do domínio, sem a marca `PessoaId`: `id` é usado só em cláusula de
 * escopo ("minhas", "solicitei"), nunca gravado. Na sessão de suporte ele é
 * `''`, que não casa com `responsavel_id` de ninguém — o escopo "meu" sai
 * **vazio**, e o que o operador usa é `equipe`, liberado porque `podeEquipe`
 * é `true`.
 *
 * **Duas funções e não um parâmetro booleano**, de propósito: o booleano seria
 * esquecido no caminho de escrita número nove, e o esquecimento ali é uma
 * tarefa assinada com `''` — ou, se a coluna fosse anulável, com ninguém.
 * Separadas, o compilador cobra a escolha em cada chamada.
 */
export const leitorDe = (c: ContextoDaRequisicao): LeitorDaRequisicao => ({
  id: pessoaDoAtor(c.ator) ?? '',
  podeEquipe: c.pode('tarefas.equipe'),
  podeJornada: c.pode('jornada'),
})

/**
 * "Equipe toda" é uma PERMISSÃO, e o servidor sempre valida.
 *
 * A tela já esconde o chip de quem não pode, mas tela não é controle de
 * acesso: basta trocar `escopo=meu` por `escopo=equipe` na barra de endereço
 * para ver a agenda inteira da clínica — inclusive o nome de cada paciente.
 *
 * O filtro por OUTRA pessoa cai na mesma regra, e por isso está aqui junto:
 * sem ele, a lista suspensa de responsável seria a porta dos fundos do
 * escopo.
 */
export function exigirEscopo(
  c: ContextoDaRequisicao,
  escopo: string,
  pessoas: readonly (string | undefined)[] = [],
): void {
  if (escopo === 'equipe' && !c.pode('tarefas.equipe')) {
    throw new ForbiddenException('Seu perfil não acompanha as tarefas da equipe.')
  }
  const deOutraPessoa = pessoas.some((p) => p !== undefined && p !== pessoaDoAtor(c.ator))
  if (deOutraPessoa && !c.pode('tarefas.equipe')) {
    throw new ForbiddenException('Seu perfil não acompanha as tarefas de outras pessoas.')
  }
}

/**
 * A ÚNICA leitura de tarefa do sistema.
 *
 * Criar, concluir, cancelar, reabrir, editar, listar e a tela Hoje devolvem
 * todas a mesma forma, e todas por aqui. O legado tem a montagem da tarefa
 * escrita três vezes — front, `demoApiBase` e `Code.gs` — e as três já
 * divergiram; a mais cara das divergências é justamente esta, porque é a
 * forma que carrega o pagamento.
 *
 * `$1` clínica · `$2` o dia civil de HOJE na clínica (para `atrasada`).
 */
/**
 * O ÚNICO filtro de "paciente desativado" das listas e contadores de trabalho.
 *
 * Tarefa ABERTA de paciente desativado some de Tarefas, Hoje e dos contadores
 * de pendência; a CONCLUÍDA/cancelada fica (histórico) e a ficha do paciente
 * não usa esta cláusula. É só filtro de leitura: nada é apagado, e reativar o
 * paciente devolve as tarefas exatamente como estavam.
 *
 * `EXISTS` com subconsulta (e não `pa.ativo`) para valer em consultas com ou
 * sem o `JOIN pacientes`. Exige o alias `t` para `tarefas`. Tarefa sem
 * paciente (interna) nunca casa o `EXISTS`, então não é escondida.
 * Divergência do protótipo: lá não existe desativar paciente.
 */
export const FORA_DE_PACIENTE_DESATIVADO = `NOT (t.status = 'aberta'
       AND EXISTS (SELECT 1 FROM pacientes pdes WHERE pdes.id = t.paciente_id AND NOT pdes.ativo))`

export const SELECT_TAREFA = `
  SELECT t.id,
         t.solicitante_id, ps.nome AS solicitante_nome,
         t.responsavel_id, pr.nome AS responsavel_nome,
         t.contato_id, pc.nome AS contato_nome,
         t.descricao, t.prazo::text AS prazo, t.hora::text AS hora, t.prioridade, t.status,
         t.concluida_em, t.criada_em,
         t.paciente_id, pa.nome AS paciente_nome,
         -- Paciente DESATIVADO não entrega o telefone em lista nenhuma (I3,
         -- LGPD): o nome e a tarefa continuam, o canal de contato não.
         CASE WHEN pa.ativo THEN pa.telefone END AS paciente_telefone,
         coalesce(pa.conferir_cadastro, false) AS paciente_conferir_cadastro,
         t.tipo, t.etapa::text AS etapa, t.historico, t.resultado, t.obs,
         t.serie_id, t.recorrencia, t.unidade_id, t.campanha_id,
         -- A identidade de SESSÃO (épico 5). NULL em toda tarefa que não é
         -- sessão, e garantida pelo CHECK sessao_e_do_programa quando é.
         t.programa_id, t.item_chave, t.sessao_indice, t.sessao_total,
         -- O cast para texto no bigint é deliberado: o driver devolveria
         -- string de qualquer jeito, mas explicitar impede que uma mudança de
         -- configuração o traga como number — e number perto de dinheiro é a
         -- regra 1 quebrada.
         t.valor_orcamento::text AS valor_orcamento, t.valor_fechado::text AS valor_fechado,
         t.valor_de_referencia::text AS valor_de_referencia,
         t.programa_orcado, t.itens_orcamento,
         t.motivo_perda_id, t.proximo_passo_em::text AS proximo_passo_em,
         t.confirmacao_enviada_em,
         -- ATRASADA é contra o HOJE DO SERVIDOR ($2), nunca contra o dia que
         -- a tela está navegando: ir para a semana passada não atrasa nada,
         -- e ir para a próxima não desatrasa nada.
         (t.status = 'aberta' AND t.prazo < $2::date) AS atrasada,
         -- O pagamento embutido é uma LINHA DE \`recebimentos\`, nunca uma
         -- coluna de \`tarefas\`. O LEFT JOIN só traz o recebimento VIVO: um
         -- estornado não conta receita, e o índice único parcial garante que
         -- no máximo um esteja vivo — então este JOIN não multiplica linhas.
         r.id AS rec_id, r.valor::text AS rec_valor, r.valor_aberto::text AS rec_valor_aberto,
         r.forma AS rec_forma, r.tipo AS rec_tipo, r.recebido_em AS rec_recebido_em
    FROM tarefas t
    JOIN pessoas ps ON ps.id = t.solicitante_id
    JOIN pessoas pr ON pr.id = t.responsavel_id
    LEFT JOIN pessoas pc ON pc.id = t.contato_id
    LEFT JOIN pacientes pa ON pa.id = t.paciente_id
    LEFT JOIN recebimentos r ON r.tarefa_id = t.id AND r.estornado_em IS NULL
   WHERE t.clinica_id = $1 AND t.excluida_em IS NULL`

export type LinhaDeTarefa = {
  id: string
  solicitante_id: string
  solicitante_nome: string
  responsavel_id: string
  responsavel_nome: string
  contato_id: string | null
  contato_nome: string | null
  descricao: string
  prazo: string
  hora: string | null
  prioridade: 'normal' | 'urgente'
  status: 'aberta' | 'concluida' | 'cancelada'
  concluida_em: Date | null
  criada_em: Date
  paciente_id: string | null
  paciente_nome: string | null
  paciente_telefone: string | null
  paciente_conferir_cadastro: boolean
  tipo: string
  etapa: string | null
  historico: EventoDeJornada[]
  valor_orcamento: string | null
  valor_fechado: string | null
  valor_de_referencia: string | null
  programa_orcado: ItemOrcadoNaSaida[] | null
  itens_orcamento: ItemDoOrcamentoNaSaida[] | null
  motivo_perda_id: string | null
  proximo_passo_em: string | null
  confirmacao_enviada_em: Date | null
  resultado: string
  obs: string
  serie_id: string | null
  recorrencia: string
  unidade_id: string | null
  campanha_id: string | null
  programa_id: string | null
  item_chave: string | null
  sessao_indice: number | null
  sessao_total: number | null
  atrasada: boolean
  rec_id: string | null
  rec_valor: string | null
  rec_valor_aberto: string | null
  rec_forma: string | null
  rec_tipo: string | null
  rec_recebido_em: Date | null
  total?: string
}

/**
 * `etapa` e os eventos vêm do banco como texto, e o `as` é justificado por
 * duas restrições de lá — não por confiança.
 *
 * A coluna é o ENUM `etapa_de_jornada` (0006), cujos nove valores são
 * exatamente `ETAPAS` do domínio, e `teste/jornada-banco.test.ts` compara as
 * duas listas: o dia em que uma ganhar um valor que a outra não tem, aquele
 * teste nomeia o valor. O `historico` é `jsonb`, e o mesmo arquivo cobra que
 * todo evento do banco tenha `acao` e `etapa` dentro do vocabulário.
 *
 * Sem o `as`, a alternativa seria validar nove strings por tarefa, em toda
 * leitura de toda lista — e devolver o quê, quando falhasse? `null` esconde o
 * cartão da tela sem dizer nada, que é o defeito que este épico combate.
 */
export const paraSaida = (l: LinhaDeTarefa): TarefaNaLista => ({
  id: l.id,
  solicitanteId: l.solicitante_id,
  solicitanteNome: l.solicitante_nome,
  responsavelId: l.responsavel_id,
  responsavelNome: l.responsavel_nome,
  contatoId: l.contato_id,
  contatoNome: l.contato_nome,
  descricao: l.descricao,
  prazo: l.prazo,
  // `time` do Postgres volta `HH:MM:SS`; a tela e o contrato falam `HH:MM`.
  hora: l.hora === null ? null : l.hora.slice(0, 5),
  prioridade: l.prioridade,
  status: l.status,
  concluidaEm: l.concluida_em === null ? null : l.concluida_em.toISOString(),
  criadaEm: l.criada_em.toISOString(),
  pacienteId: l.paciente_id,
  pacienteNome: l.paciente_nome,
  pacienteTelefone: l.paciente_telefone,
  pacienteConferirCadastro: l.paciente_conferir_cadastro,
  tipo: l.tipo,
  etapa: l.etapa as Etapa | null,
  historico: l.historico,
  valorOrcamento: l.valor_orcamento,
  valorFechado: l.valor_fechado,
  valorDeReferencia: l.valor_de_referencia,
  orcamentoParcial:
    situacaoDoFechamento(
      l.valor_orcamento === null ? null : BigInt(l.valor_orcamento),
      l.valor_fechado === null ? null : BigInt(l.valor_fechado),
    ) === 'parcial',
  programaOrcado: l.programa_orcado,
  itensOrcamento: itensDoOrcamentoDe(l.itens_orcamento, l.programa_orcado),
  motivoPerdaId: l.motivo_perda_id,
  proximoPassoEm: l.proximo_passo_em,
  confirmacaoEnviadaEm:
    l.confirmacao_enviada_em === null ? null : l.confirmacao_enviada_em.toISOString(),
  resultado: l.resultado,
  obs: l.obs,
  serieId: l.serie_id,
  recorrencia: l.recorrencia,
  unidadeId: l.unidade_id,
  campanhaId: l.campanha_id,
  atrasada: l.atrasada,
  /**
   * Os quatro andam juntos ou nenhum, e isso é o banco falando: o
   * `CHECK sessao_e_do_programa` da 0010 exige os quatro quando o tipo é
   * sessão, e `numeracao_so_em_sessao` proíbe `sessao_indice` e `sessao_total`
   * em qualquer outro tipo. A conferência por `sessao_indice` basta; o `!` nos
   * outros não é confiança, é a constraint.
   */
  sessao:
    l.sessao_indice === null
      ? null
      : {
          programaId: l.programa_id!,
          itemChave: l.item_chave!,
          indice: l.sessao_indice,
          total: l.sessao_total!,
        },
  pagamento:
    l.rec_id === null
      ? null
      : {
          id: l.rec_id,
          valor: l.rec_valor,
          valorAberto: l.rec_valor_aberto,
          forma: l.rec_forma ?? '',
          tipo: l.rec_tipo ?? '',
          recebidoEm: (l.rec_recebido_em ?? new Date(0)).toISOString(),
        },
})

/**
 * A ÚNICA função que tira a jornada do cartão de quem não tem `jornada`
 * (appsec S-5, B1 da revisão LGPD).
 *
 * `historico` (nota em texto livre), `programaOrcado` (com a dose),
 * `itensOrcamento` (os PROCEDIMENTOS de um paciente identificado: dado de
 * saúde, regra 18) e `proximoPassoEm` são a jornada. Campanhas, ficha, a lista
 * de tarefas e a tela Hoje passam TODAS por aqui; um `if` por rota é como o
 * campo novo (`itensOrcamento`) escapou da versão anterior, que só zerava três.
 *
 * A FORMA não muda — vazio e `null`, que o contrato já admite, nunca uma chave
 * a menos. Com `jornada` o cartão volta intacto, e a mesma referência.
 */
export const aplicarPermissaoDeJornada = (t: TarefaNaLista, podeJornada: boolean): TarefaNaLista =>
  podeJornada
    ? t
    : { ...t, historico: [], proximoPassoEm: null, programaOrcado: null, itensOrcamento: null }

/**
 * Le as tarefas pedidas, na ordem em que o banco as devolver.
 *
 * E o caminho comum de TODA rota de escrita de tarefa (criar, editar, concluir,
 * cancelar, reabrir, sessao, mover). `podeJornada` e parametro OBRIGATORIO e a
 * jornada e tirada aqui, uma vez: antes, cada rota devolvia o cartao cru e
 * quem nao tinha `jornada` recebia historico, dose e procedimentos de volta na
 * resposta da propria escrita (appsec F6).
 */
export async function lerTarefas(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  hoje: string,
  ids: readonly string[],
  podeJornada: boolean,
): Promise<TarefaNaLista[]> {
  if (ids.length === 0) return []
  const r = await c.query<LinhaDeTarefa>(
    `${SELECT_TAREFA} AND t.id = ANY($3) ORDER BY t.prazo, t.hora NULLS LAST, t.criada_em`,
    [clinicaId, hoje, ids],
  )
  return r.rows.map((l) => aplicarPermissaoDeJornada(paraSaida(l), podeJornada))
}

/**
 * As duas listas de tipo que a jornada usa SUBIRAM PARA `packages/domain`.
 *
 * `ehDaJornada` e `etapaDerivada` (épico 3) dependem delas, e `domain` não
 * importa de app. Reexportadas daqui para que os cinco arquivos de tarefa que
 * já as importavam continuem a importá-las de um lugar só.
 */
export { TIPOS_DE_AGENDA, TIPOS_REALIZADOS } from '@fir/domain'

/**
 * `aaaa-mm-dd` → `dd/mm/aaaa`, para a nota do histórico.
 *
 * SEM fuso, e de propósito: `prazo` é uma coluna `date` — um dia no
 * CALENDÁRIO da clínica, não um instante. Converter fuso aqui seria aplicar
 * deslocamento a um valor que não tem hora, e o resultado seria a data de
 * ontem num registro de hoje. O que PRECISA de fuso é formatar `timestamptz`,
 * e aí o caminho é `diaCivil(instante, fuso)`.
 */
export const brAno = (dia: string): string =>
  `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`
