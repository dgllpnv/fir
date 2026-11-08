import { z } from 'zod'
import { AreaDeFoco, ProdutoFirmare } from './carteira'
import { DiaCivil, Uuid } from './comum'

/**
 * **G8 2C — checklists dos programas e entrada de cliente** (inventário X3,
 * X5, V3, V15, C4, C6; gates appsec A-19, A-20, A-21; LGPD A50, A51).
 *
 * Nenhum campo monetário na SAÍDA. A entrada das metas em andamento traz o
 * alvo e os pontos de partida na escala de armazenamento do indicador
 * (`R$` em centavos, `%` em centésimos de ponto, `un`/`dias` inteiros), como
 * texto de inteiro — nunca `number` (regra 1). O CSV é lido NO NAVEGADOR; o
 * servidor recebe só estes campos, linha a linha, já validados aqui.
 */

export const QUEM_EXECUTA_ITEM = ['responsavel', 'admin', 'comercial', 'administrativo', 'financeiro'] as const
export const QuemExecutaItem = z.enum(QUEM_EXECUTA_ITEM)
export type QuemExecutaItem = z.infer<typeof QuemExecutaItem>

export const AcaoDoItem = z.enum(['diagnostico'])
export type AcaoDoItem = z.infer<typeof AcaoDoItem>

const tituloDoItem = z.string().trim().min(1, 'Informe o item do checklist.').max(300, 'até 300 caracteres')
const diasDoItem = z.number().int('o prazo é um número inteiro de dias').min(0, 'o prazo não é negativo').max(730, 'até 730 dias')

/* ── Método Firmare · Checklists (X3) ─────────────────────────────────── */

export const ItemDeModeloNaSaida = z.object({
  id: Uuid,
  dias: z.number().int(),
  titulo: z.string(),
  quem: QuemExecutaItem,
  acao: AcaoDoItem.nullable(),
})
export type ItemDeModeloNaSaida = z.infer<typeof ItemDeModeloNaSaida>

export const ModeloDeChecklistNaSaida = z.object({
  id: Uuid,
  produto: z.string(),
  areaFoco: z.string().nullable(),
  /** "Acelerador FIR · Comercial" — o nome que a tela mostra e a ficha usa. */
  rotulo: z.string(),
  itens: z.array(ItemDeModeloNaSaida),
})
export type ModeloDeChecklistNaSaida = z.infer<typeof ModeloDeChecklistNaSaida>

/** `GET /v1/carteira/metodo/checklists`. */
export const ChecklistsDoMetodoSaida = z.object({
  modelos: z.array(ModeloDeChecklistNaSaida),
  /** Escreve modelos e itens (hoje: escopo geral; depois `carteira.administrar`). */
  podeAdministrar: z.boolean(),
})
export type ChecklistsDoMetodoSaida = z.infer<typeof ChecklistsDoMetodoSaida>

/** `POST /v1/carteira/metodo/checklists` — "Novo checklist (produto e frente)" (L2945). */
export const CriarModeloDeChecklistEntrada = z
  .object({ produto: ProdutoFirmare, areaFoco: AreaDeFoco.nullable() })
  .strict()
export type CriarModeloDeChecklistEntrada = z.infer<typeof CriarModeloDeChecklistEntrada>

export const ModeloDeChecklistSaida = z.object({ modelo: ModeloDeChecklistNaSaida })
export type ModeloDeChecklistSaida = z.infer<typeof ModeloDeChecklistSaida>

/** `POST /v1/carteira/metodo/checklists/:id/itens` — `fItem` (L2785). */
export const CriarItemDeModeloEntrada = z
  .object({ titulo: tituloDoItem, dias: diasDoItem, quem: QuemExecutaItem, acao: AcaoDoItem.nullable() })
  .strict()
export type CriarItemDeModeloEntrada = z.infer<typeof CriarItemDeModeloEntrada>

/** `PATCH /v1/carteira/metodo/checklists/itens/:id`. Campo ausente = não mexer. */
export const EditarItemDeModeloEntrada = z
  .object({
    titulo: tituloDoItem.optional(),
    dias: diasDoItem.optional(),
    quem: QuemExecutaItem.optional(),
    acao: AcaoDoItem.nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nada para alterar.')
export type EditarItemDeModeloEntrada = z.infer<typeof EditarItemDeModeloEntrada>

export const ItemDeModeloSalvoSaida = z.object({
  item: ItemDeModeloNaSaida,
  /** Tarefas ainda abertas que receberam o título novo (L2883). */
  tarefasAtualizadas: z.number().int(),
})
export type ItemDeModeloSalvoSaida = z.infer<typeof ItemDeModeloSalvoSaida>

/* ── Checklist do contrato, na ficha (V3, V15) ───────────────────────── */

export const StatusDaTarefaDoChecklist = z.enum(['pendente', 'concluida', 'cancelada'])

export const ItemDoChecklistDoCliente = z.object({
  id: Uuid,
  tarefaId: Uuid,
  titulo: z.string(),
  dias: z.number().int(),
  prazo: DiaCivil,
  status: StatusDaTarefaDoChecklist,
  /** O dia da conclusão no fuso da Firmare, já calculado no servidor (regra 22). */
  concluidaNoDia: DiaCivil.nullable(),
  responsavel: z.object({ id: Uuid, nome: z.string() }).nullable(),
  acao: AcaoDoItem.nullable(),
  entrouFeito: z.boolean(),
})
export type ItemDoChecklistDoCliente = z.infer<typeof ItemDoChecklistDoCliente>

/** `GET /v1/carteira/clientes/:id/checklist`. */
export const ChecklistDoClienteSaida = z.object({
  /** O checklist que vale para o cliente agora (produto e frente, ou o geral). */
  modelo: z.object({ rotulo: z.string(), existe: z.boolean(), itens: z.number().int() }),
  /** Já existe ao menos um item aplicado do modelo que vale agora. */
  geradoParaOModelo: z.boolean(),
  itens: z.array(ItemDoChecklistDoCliente),
  progresso: z.object({
    total: z.number().int(),
    concluidos: z.number().int(),
    atrasados: z.number().int(),
    proximoId: Uuid.nullable(),
  }),
  /** O dia de hoje no fuso da Firmare — a tela compara prazo sem relógio próprio (regra 24). */
  hoje: DiaCivil,
})
export type ChecklistDoClienteSaida = z.infer<typeof ChecklistDoClienteSaida>

/**
 * `POST /v1/carteira/clientes/:id/checklist` — aplicar o checklist.
 *  - `novo`: "Novo cliente" (C4, L2892);
 *  - `existente`: "Já é cliente" (C6) — itens com prazo passado entram feitos
 *    e nasce "Completar o cadastro de X" se faltar algo; exige `clienteDesde`;
 *  - `gerar`: "Gerar checklist de X" na ficha (L2964).
 * Repetir não cria nada novo (A-20): a chave é (cliente, item).
 */
export const AplicarChecklistEntrada = z.object({ origem: z.enum(['novo', 'existente', 'gerar']) }).strict()
export type AplicarChecklistEntrada = z.infer<typeof AplicarChecklistEntrada>

export const ChecklistAplicadoSaida = z.object({
  rotulo: z.string(),
  criadas: z.number().int(),
  entraramFeitas: z.number().int(),
  jaExistiam: z.number().int(),
  /** A frase do protótipo, montada no servidor (L2787, L1746, L2895). */
  recado: z.string(),
  /** "Eduarda +4 (fica com 11)": o que esta aplicação pôs na semana de cada pessoa. */
  cargaDaSemana: z.array(
    z.object({ responsavel: z.object({ id: Uuid, nome: z.string() }), novas: z.number().int(), ficaCom: z.number().int() }),
  ),
})
export type ChecklistAplicadoSaida = z.infer<typeof ChecklistAplicadoSaida>

/* ── Entrada de cliente que já é da Firmare (C6) ─────────────────────── */

export const FaltaDaEntradaNaSaida = z.object({ codigo: z.enum(['links', 'metas', 'parceiros']), texto: z.string() })

/** `GET /v1/carteira/clientes/:id/entrada` — o aviso permanente (`avisoMigracao`, L1723). */
export const EntradaDoClienteSaida = z.object({
  existente: z.boolean(),
  clienteDesde: DiaCivil.nullable(),
  faltas: z.array(FaltaDaEntradaNaSaida),
  asanaResolvido: z.boolean(),
  /** Some quando não falta nada e o Asana foi resolvido (L1725). */
  mostrarAviso: z.boolean(),
})
export type EntradaDoClienteSaida = z.infer<typeof EntradaDoClienteSaida>

/** Unidades das metas (L2756). */
export const UNIDADES_DE_META_EM_ANDAMENTO = ['R$', '%', 'un', 'dias'] as const
export const UnidadeDeMetaEmAndamento = z.enum(UNIDADES_DE_META_EM_ANDAMENTO)

/** Inteiro sem sinal na escala do indicador, como texto (nunca `number`). */
const inteiroNaEscala = z.string().regex(/^\d{1,15}$/, 'use só números inteiros, sem sinal')

/**
 * Uma linha de "Metas em andamento" (`linhaMeta`, L1750–1760; `migMetasSalvar`
 * L2908): nome e alvo obrigatórios; "Quando entrou", "Hoje" e prazo
 * opcionais — o prazo é obrigatório só na meta "Com prazo".
 */
export const LinhaDeMetaEmAndamento = z
  .object({
    titulo: z.string().trim().min(1, 'Informe o nome da meta.').max(160, 'até 160 caracteres'),
    indicador: z
      .string()
      .trim()
      .max(120, 'até 120 caracteres')
      .nullable()
      .transform((v) => (v === null || v === '' ? null : v)),
    unidade: UnidadeDeMetaEmAndamento,
    tipo: z.enum(['mensal', 'prazo']),
    valorInicial: inteiroNaEscala.nullable(),
    valorAtual: inteiroNaEscala.nullable(),
    valorMeta: inteiroNaEscala,
    prazo: DiaCivil.nullable(),
  })
  .strict()
  .refine((m) => m.tipo !== 'prazo' || m.prazo !== null, { message: 'A meta com prazo precisa da data.', path: ['prazo'] })
export type LinhaDeMetaEmAndamento = z.infer<typeof LinhaDeMetaEmAndamento>

export const MAX_METAS_EM_ANDAMENTO = 30

/** `POST /v1/carteira/clientes/:id/entrada/metas` — "Salvar e seguir" (L2908). */
export const CadastrarMetasEmAndamentoEntrada = z
  .object({
    chaveIdempotencia: Uuid,
    metas: z.array(LinhaDeMetaEmAndamento).min(1, 'Preencha ao menos uma meta com o nome e o alvo.').max(MAX_METAS_EM_ANDAMENTO),
  })
  .strict()
export type CadastrarMetasEmAndamentoEntrada = z.infer<typeof CadastrarMetasEmAndamentoEntrada>

export const MetasEmAndamentoSalvasSaida = z.object({ criadas: z.number().int(), jaExistia: z.boolean() })
export type MetasEmAndamentoSalvasSaida = z.infer<typeof MetasEmAndamentoSalvasSaida>

/** `POST .../entrada/metas/depois` — "Fazer depois" (L2906) e `.../entrada/asana/dispensar` (L1727). */
export const PassoDaEntradaSaida = z.object({ tarefaCriada: z.boolean() })
export type PassoDaEntradaSaida = z.infer<typeof PassoDaEntradaSaida>
