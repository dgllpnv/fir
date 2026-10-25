import type { ItemOrcadoNaSaida, TarefaNaLista } from '@fir/contracts'
import type { Autor, Etapa, EventoDeJornada } from '@fir/domain'
import { ForbiddenException } from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
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
export type AutorDaRequisicao = Autor & { readonly id: PessoaId }

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
  id: c.ator,
  podeEquipe: c.pode('tarefas.equipe'),
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
  const deOutraPessoa = pessoas.some((p) => p !== undefined && p !== c.ator)
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
export const SELECT_TAREFA = `
  SELECT t.id,
         t.solicitante_id, ps.nome AS solicitante_nome,
         t.responsavel_id, pr.nome AS responsavel_nome,
         t.descricao, t.prazo::text AS prazo, t.hora::text AS hora, t.prioridade, t.status,
         t.concluida_em, t.criada_em,
         t.paciente_id, pa.nome AS paciente_nome, pa.telefone AS paciente_telefone,
         t.tipo, t.etapa::text AS etapa, t.historico, t.resultado, t.obs,
         t.serie_id, t.recorrencia, t.unidade_id,
         -- O cast para texto no bigint é deliberado: o driver devolveria
         -- string de qualquer jeito, mas explicitar impede que uma mudança de
         -- configuração o traga como number — e number perto de dinheiro é a
         -- regra 1 quebrada.
         t.valor_orcamento::text AS valor_orcamento, t.programa_orcado,
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
    LEFT JOIN pacientes pa ON pa.id = t.paciente_id
    LEFT JOIN recebimentos r ON r.tarefa_id = t.id AND r.estornado_em IS NULL
   WHERE t.clinica_id = $1 AND t.excluida_em IS NULL`

export type LinhaDeTarefa = {
  id: string
  solicitante_id: string
  solicitante_nome: string
  responsavel_id: string
  responsavel_nome: string
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
  tipo: string
  etapa: string | null
  historico: EventoDeJornada[]
  valor_orcamento: string | null
  programa_orcado: ItemOrcadoNaSaida[] | null
  motivo_perda_id: string | null
  proximo_passo_em: string | null
  confirmacao_enviada_em: Date | null
  resultado: string
  obs: string
  serie_id: string | null
  recorrencia: string
  unidade_id: string | null
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
  tipo: l.tipo,
  etapa: l.etapa as Etapa | null,
  historico: l.historico,
  valorOrcamento: l.valor_orcamento,
  programaOrcado: l.programa_orcado,
  motivoPerdaId: l.motivo_perda_id,
  proximoPassoEm: l.proximo_passo_em,
  confirmacaoEnviadaEm:
    l.confirmacao_enviada_em === null ? null : l.confirmacao_enviada_em.toISOString(),
  resultado: l.resultado,
  obs: l.obs,
  serieId: l.serie_id,
  recorrencia: l.recorrencia,
  unidadeId: l.unidade_id,
  atrasada: l.atrasada,
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

/** Lê as tarefas pedidas, na ordem em que o banco as devolver. */
export async function lerTarefas(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  hoje: string,
  ids: readonly string[],
): Promise<TarefaNaLista[]> {
  if (ids.length === 0) return []
  const r = await c.query<LinhaDeTarefa>(
    `${SELECT_TAREFA} AND t.id = ANY($3) ORDER BY t.prazo, t.hora NULLS LAST, t.criada_em`,
    [clinicaId, hoje, ids],
  )
  return r.rows.map(paraSaida)
}

/**
 * As duas listas de tipo que a jornada usa SUBIRAM PARA `packages/domain`.
 *
 * `ehDaJornada` e `etapaDerivada` (épico 3) dependem delas, e `domain` não
 * importa de app. Reexportadas daqui para que os cinco arquivos de tarefa que
 * já as importavam continuem a importá-las de um lugar só.
 */
export { TIPOS_DE_AGENDA, TIPOS_REALIZADOS } from '@fir/domain'
