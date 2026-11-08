import {
  FORMATOS_DA_ROTINA,
  FREQUENCIAS_DA_ROTINA,
  FRENTES_DA_ROTINA,
  MENSAGENS_DA_ROTINA,
  PRIORIDADES_DA_ROTINA,
  QUEM_EXECUTA_A_ROTINA,
  RECORRENCIAS_DA_TAREFA_INTERNA,
  SERVICOS_DA_ROTINA,
  TIPOS_DE_TAREFA_INTERNA,
  ehErro,
  validarParametrosDaRotina,
} from '@fir/domain'
import { z } from 'zod'
import { DiaCivil, Uuid } from './comum'

/**
 * G8, ticket 2A — a rotina da equipe Firmare completa (R1–R12, R14): rotina
 * com todos os parâmetros do protótipo (`fRotina`, L2776), tarefa com
 * solicitante e recorrência (`fTarefa`, L2769), "Minhas tarefas" por prazo,
 * carga da equipe, redistribuir e aniversários.
 *
 * Os tipos de G5 (`prospeccao.ts`) continuam lá; estes os substituem nas
 * rotas `/v1/carteira/rotinas-internas`, `/tarefas-internas`, `/carga` e
 * `/aniversarios`. Nenhum campo monetário: a rotina de lembrete de
 * mensalidade carrega só o fato ("tem mensalidade"), nunca o valor.
 *
 * `grupoId` nunca é entrada (ADR 0016 item 2). Data de negócio — o início da
 * rotina, o "hoje" das seções — vem do servidor (regra 24).
 */

const Frequencia = z.enum(FREQUENCIAS_DA_ROTINA)
const Formato = z.enum(FORMATOS_DA_ROTINA)
const Servico = z.enum(SERVICOS_DA_ROTINA)
const QuemExecuta = z.enum(QUEM_EXECUTA_A_ROTINA)
const Mensagem = z.enum(MENSAGENS_DA_ROTINA)
const Prioridade = z.enum(PRIORIDADES_DA_ROTINA)
const Recorrencia = z.enum(RECORRENCIAS_DA_TAREFA_INTERNA)
const TipoDeTarefa = z.enum(TIPOS_DE_TAREFA_INTERNA)
const Frente = z.enum(FRENTES_DA_ROTINA.map(([k]) => k) as [
  (typeof FRENTES_DA_ROTINA)[number][0],
  ...(typeof FRENTES_DA_ROTINA)[number][0][],
])
// O `as` acima só devolve ao `z.enum` a tupla não vazia que o `.map` apagou:
// os quatro valores vêm de `FRENTES_DA_ROTINA`, uma constante literal.

const StatusDaTarefa = z.enum(['pendente', 'concluida', 'cancelada'])

/* ────────────────────────────────────────────────────────────────────────
 * ROTINA
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * O formulário inteiro da rotina — criar e editar mandam o mesmo corpo
 * (`PUT` na edição: o formulário do protótipo reenvia todos os campos).
 */
export const RotinaCarteiraEntrada = z
  .object({
    titulo: z.string().trim().min(1, 'Diga o que fazer.').max(160),
    responsavelUsuarioGestaoId: Uuid.nullable().default(null),
    prioridade: Prioridade.default('normal'),
    frequencia: Frequencia,
    diaSemana: z.number().int().min(1).max(7).nullable().default(null),
    diaUtil: z.number().int().min(1).max(23).nullable().default(null),
    antecedencia: z.number().int().min(0).max(31).nullable().default(null),
    escopoAplicacao: Formato.default('global'),
    servico: Servico.nullable().default(null),
    quemExecuta: QuemExecuta.default('responsavel_da_rotina'),
    mensagem: Mensagem.nullable().default(null),
    frentes: z.boolean().default(false),
    envio: z.boolean().default(false),
    passos: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
    ativa: z.boolean().default(true),
  })
  .strict()
  .superRefine((r, ctx) => {
    const v = validarParametrosDaRotina(r)
    if (ehErro(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: v.erro.mensagem })
  })
export type RotinaCarteiraEntrada = z.infer<typeof RotinaCarteiraEntrada>

export const RotinaCarteira = z.object({
  id: Uuid,
  titulo: z.string(),
  grupoId: Uuid.nullable(),
  responsavelUsuarioGestaoId: Uuid.nullable(),
  responsavelNome: z.string().nullable(),
  prioridade: Prioridade,
  frequencia: Frequencia,
  diaSemana: z.number().int().nullable(),
  diaUtil: z.number().int().nullable(),
  antecedencia: z.number().int().nullable(),
  escopoAplicacao: Formato,
  servico: Servico.nullable(),
  quemExecuta: QuemExecuta,
  mensagem: Mensagem.nullable(),
  frentes: z.boolean(),
  envio: z.boolean(),
  passos: z.array(z.string()),
  ativa: z.boolean(),
  inicio: DiaCivil,
  /** `freqTxt` (L870), calculado no domínio. */
  textoFrequencia: z.string(),
  /** Próxima data em que a rotina gera tarefa; `null` pausada ou sem cliente a que se aplique. */
  proxima: DiaCivil.nullable(),
  /** "% no prazo" das últimas 8 vezes; `null` sem histórico. Contagem, não dinheiro. */
  noPrazo: z.number().int().min(0).max(100).nullable(),
  /** Quantos clientes a rotina alcança hoje (por cliente / lista). */
  clientesQueSeAplicam: z.number().int().min(0),
})
export type RotinaCarteira = z.infer<typeof RotinaCarteira>

export const ListaDeRotinasCarteiraSaida = z.object({ rotinas: z.array(RotinaCarteira) })
export type ListaDeRotinasCarteiraSaida = z.infer<typeof ListaDeRotinasCarteiraSaida>

export const RotinaCarteiraSalvaSaida = z.object({
  rotina: RotinaCarteira,
  /** Tarefas geradas na hora (o protótipo chama `gerarRotinas` ao salvar, L2984). */
  geradas: z.number().int().min(0),
})
export type RotinaCarteiraSalvaSaida = z.infer<typeof RotinaCarteiraSalvaSaida>

/* ────────────────────────────────────────────────────────────────────────
 * TAREFA
 * ──────────────────────────────────────────────────────────────────────── */

export const SecaoDaTarefaCarteira = z.enum(['vencidas', 'hoje', 'proximos7', 'adiante'])

export const ItemDaTarefaCarteira = z.object({
  id: Uuid,
  rotulo: z.string(),
  clienteCarteiraId: Uuid.nullable(),
  frente: Frente.nullable(),
  feito: z.boolean(),
})
export type ItemDaTarefaCarteira = z.infer<typeof ItemDaTarefaCarteira>

export const TarefaCarteira = z.object({
  id: Uuid,
  titulo: z.string(),
  descricao: z.string().nullable(),
  grupoId: Uuid.nullable(),
  responsavelUsuarioGestaoId: Uuid.nullable(),
  responsavelNome: z.string().nullable(),
  solicitanteUsuarioGestaoId: Uuid.nullable(),
  clienteCarteiraId: Uuid.nullable(),
  clienteNome: z.string().nullable(),
  leadComercialId: Uuid.nullable(),
  prazo: DiaCivil,
  prioridade: Prioridade,
  status: StatusDaTarefa,
  concluidaEm: z.string().nullable(),
  rotinaInternaId: Uuid.nullable(),
  recorrencia: Recorrencia,
  tipo: TipoDeTarefa,
  /** A coluna da lista (R1), calculada no servidor com o hoje do fuso da carteira. `null` se não está aberta. */
  secao: SecaoDaTarefaCarteira.nullable(),
  vencimento: DiaCivil.nullable(),
  competencia: DiaCivil.nullable(),
  mensagem: Mensagem.nullable(),
  /** R14: concluída sozinha porque a mensalidade do mês já estava paga. */
  pagoAntes: z.boolean(),
  transferidaDeUsuarioGestaoId: Uuid.nullable(),
  itens: z.array(ItemDaTarefaCarteira),
})
export type TarefaCarteira = z.infer<typeof TarefaCarteira>

/** `?responsavel=minhas|todas|<uuid>` — "Minhas" é recorte da lista já autorizada. */
export const FiltroDeTarefasCarteira = z.union([z.literal('minhas'), z.literal('todas'), Uuid]).default('minhas')

export const ListaDeTarefasCarteiraSaida = z.object({
  hoje: DiaCivil,
  /** Abertas, por prazo. */
  tarefas: z.array(TarefaCarteira),
  /** As 6 concluídas mais recentes do mesmo recorte (L1882). */
  concluidasRecentes: z.array(TarefaCarteira),
})
export type ListaDeTarefasCarteiraSaida = z.infer<typeof ListaDeTarefasCarteiraSaida>

export const TarefaCarteiraSaida = z.object({
  tarefa: TarefaCarteira,
  /** A próxima ocorrência criada ao concluir uma recorrente (R3). */
  proxima: TarefaCarteira.nullable().default(null),
})
export type TarefaCarteiraSaida = z.infer<typeof TarefaCarteiraSaida>

export const CriarTarefaCarteiraEntrada = z
  .object({
    titulo: z.string().trim().min(1, 'Informe a tarefa.').max(160),
    descricao: z.string().trim().max(2000).nullable().default(null),
    responsavelUsuarioGestaoId: Uuid.nullable().default(null),
    solicitanteUsuarioGestaoId: Uuid.nullable().default(null),
    clienteCarteiraId: Uuid.nullable().default(null),
    leadComercialId: Uuid.nullable().default(null),
    prazo: DiaCivil,
    prioridade: Prioridade.default('normal'),
    recorrencia: Recorrencia.default('nenhuma'),
  })
  .strict()
export type CriarTarefaCarteiraEntrada = z.infer<typeof CriarTarefaCarteiraEntrada>

/** Editar (R2): o formulário inteiro. Status muda pela rota própria. */
export const EditarTarefaCarteiraEntrada = CriarTarefaCarteiraEntrada
export type EditarTarefaCarteiraEntrada = CriarTarefaCarteiraEntrada

/** Concluir, "Excluir" (cancelar — regra 20) e reabrir (R3). */
export const MudarStatusDaTarefaCarteiraEntrada = z
  .object({ status: z.enum(['concluida', 'cancelada', 'pendente']) })
  .strict()
export type MudarStatusDaTarefaCarteiraEntrada = z.infer<typeof MudarStatusDaTarefaCarteiraEntrada>

/** "Transferir" (R4). */
export const TransferirTarefaCarteiraEntrada = z.object({ responsavelUsuarioGestaoId: Uuid }).strict()
export type TransferirTarefaCarteiraEntrada = z.infer<typeof TransferirTarefaCarteiraEntrada>

export const MarcarItemDaTarefaCarteiraEntrada = z.object({ feito: z.boolean() }).strict()
export type MarcarItemDaTarefaCarteiraEntrada = z.infer<typeof MarcarItemDaTarefaCarteiraEntrada>

/* ────────────────────────────────────────────────────────────────────────
 * EQUIPE, CARGA E REDISTRIBUIR (R7, R8)
 * ──────────────────────────────────────────────────────────────────────── */

export const EquipeDaRotinaSaida = z.object({
  /** O `Usuário de Gestão` da sessão — o "Minhas". */
  eu: Uuid,
  pessoas: z.array(z.object({ id: Uuid, nome: z.string() })),
  /** Pode ver a carga e redistribuir (por ora: `escopo = 'geral'`). */
  podeVerCarga: z.boolean(),
})
export type EquipeDaRotinaSaida = z.infer<typeof EquipeDaRotinaSaida>

const PorTipo = z.object({
  checklist: z.number().int().min(0),
  rotina: z.number().int().min(0),
  reuniao: z.number().int().min(0),
  avulsa: z.number().int().min(0),
})
export const CelulaDaCargaCarteira = z.object({ total: z.number().int().min(0), porTipo: PorTipo })

export const CargaDaEquipeSaida = z.object({
  hoje: DiaCivil,
  semanas: z.array(z.object({ inicio: DiaCivil, ultimoDia: DiaCivil })),
  pessoas: z.array(
    z.object({
      usuarioGestaoId: Uuid,
      nome: z.string(),
      atrasadas: CelulaDaCargaCarteira,
      semanas: z.array(CelulaDaCargaCarteira),
    }),
  ),
  /** O detalhe por cliente de `?pessoa=`; `null` sem pessoa escolhida. */
  detalhe: z
    .object({
      usuarioGestaoId: Uuid,
      clientes: z.array(
        z.object({
          clienteCarteiraId: Uuid.nullable(),
          clienteNome: z.string().nullable(),
          total: z.number().int().min(0),
          atrasadas: z.number().int().min(0),
          porTipo: PorTipo,
        }),
      ),
    })
    .nullable(),
})
export type CargaDaEquipeSaida = z.infer<typeof CargaDaEquipeSaida>

export const RedistribuirTarefasEntrada = z
  .object({
    deUsuarioGestaoId: Uuid,
    paraUsuarioGestaoId: Uuid,
    clienteCarteiraId: Uuid.nullable().default(null),
    tipo: z.enum(['checklist', 'avulsa', 'todas']).default('checklist'),
    desde: DiaCivil.nullable().default(null),
  })
  .strict()
  .refine((r) => r.deUsuarioGestaoId !== r.paraUsuarioGestaoId, { message: 'Escolha pessoas diferentes' })
export type RedistribuirTarefasEntrada = z.infer<typeof RedistribuirTarefasEntrada>

export const RedistribuirTarefasSaida = z.object({ movidas: z.number().int().min(0) })
export type RedistribuirTarefasSaida = z.infer<typeof RedistribuirTarefasSaida>

/* ────────────────────────────────────────────────────────────────────────
 * ANIVERSÁRIOS (P6) — dia e mês, sem idade, sem telefone na lista (A45, A46)
 * ──────────────────────────────────────────────────────────────────────── */

const TipoDeAniversario = z.enum(['cliente', 'equipe'])

export const AniversarioNaLista = z.object({
  tipo: TipoDeAniversario,
  /** O cliente (tipo `cliente`) ou o `Usuário de Gestão` (tipo `equipe`). */
  id: Uuid,
  nome: z.string(),
  /** "Equipe Firmare" ou o nome do cliente. */
  sub: z.string(),
  dia: z.number().int().min(1).max(31),
  mes: z.number().int().min(1).max(12),
  data: DiaCivil,
  emDias: z.number().int().min(0),
  /** Há telefone para o "Parabenizar". O número em si só sai no clique (A45). */
  podeParabenizar: z.boolean(),
})
export type AniversarioNaLista = z.infer<typeof AniversarioNaLista>

export const ListaDeAniversariosSaida = z.object({ aniversarios: z.array(AniversarioNaLista) })
export type ListaDeAniversariosSaida = z.infer<typeof ListaDeAniversariosSaida>

export const ParabenizarEntrada = z.object({ tipo: TipoDeAniversario, id: Uuid }).strict()
export type ParabenizarEntrada = z.infer<typeof ParabenizarEntrada>

export const ParabenizarSaida = z.object({ url: z.string() })
export type ParabenizarSaida = z.infer<typeof ParabenizarSaida>

export const MeuAniversarioSaida = z.object({
  dia: z.number().int().nullable(),
  mes: z.number().int().nullable(),
  mostrar: z.boolean(),
})
export type MeuAniversarioSaida = z.infer<typeof MeuAniversarioSaida>

const DIAS_NO_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

export const DefinirMeuAniversarioEntrada = z
  .object({
    dia: z.number().int().min(1).max(31).nullable(),
    mes: z.number().int().min(1).max(12).nullable(),
    mostrar: z.boolean(),
  })
  .strict()
  .refine((a) => (a.dia === null) === (a.mes === null), { message: 'Informe o dia e o mês, ou nenhum dos dois.' })
  .refine((a) => a.dia === null || a.mes === null || a.dia <= DIAS_NO_MES[a.mes - 1]!, {
    message: 'Esse dia não existe nesse mês.',
  })
export type DefinirMeuAniversarioEntrada = z.infer<typeof DefinirMeuAniversarioEntrada>
