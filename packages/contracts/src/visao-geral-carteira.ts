import { z } from 'zod'
import { DiaCivil, Uuid, centavosNaSaida } from './comum'
import { AcaoDoPlano } from './metas-carteira'
import { LeadComercialNaLista } from './prospeccao'
import { AniversarioNaLista } from './rotina-carteira'

/**
 * G8 3B — **A VISÃO GERAL DA CARTEIRA** (`vPainel`, protótipo L1278–1331) e
 * os contadores do menu (`renderNav`, L1247–1248).
 *
 * Tudo é calculado no SERVIDOR (`montarVisaoGeral`, `packages/domain`); a
 * tela só formata. O "hoje" é o dia civil do servidor no fuso da carteira.
 *
 * DINHEIRO: só `mrr` e `ticketMedio` (`CAMPOS_MONETARIOS`), mais o
 * `valorEstimado` que viaja dentro de `LeadComercialNaLista`. Sem `valores`,
 * o `RedacaoInterceptor` os devolve `null` — `podeVerValores` existe só para
 * a tela escrever "restrito" em vez de "—" (L1119), nunca para esconder.
 *
 * ESCOPO ("só a minha carteira", A-3): para quem tem `carteira = 'minha'`,
 * TODO agregado desta rota é da própria carteira — MRR, ticket, contagens,
 * saúde, equipe (clientes e tarefas no mesmo escopo), reuniões, aniversários
 * de decisoras, contatos e entregas. Nunca o total da Firmare.
 */

const Segmento = <K extends [string, ...string[]]>(chaves: K) =>
  z.object({ chave: z.enum(chaves), inicio: z.number().int().min(0), largura: z.number().int().min(1) })

export const ClienteEmRisco = z.object({
  id: Uuid,
  nome: z.string(),
  saude: z.enum(['atencao', 'critico']),
  resumoDaUltimaReuniao: z.string().nullable(),
  acoesAtrasadas: z.number().int().min(0),
  responsavelNome: z.string().nullable(),
})

export const PessoaNaVisaoGeralSaida = z.object({
  id: Uuid,
  nome: z.string(),
  iniciais: z.string(),
  clientes: z.number().int().min(0),
  pendentes: z.number().int().min(0),
  vencidas: z.number().int().min(0),
  barra: z.array(Segmento(['emDia', 'vencidas'])),
})

export const ReuniaoDaSemana = z.object({
  clienteId: Uuid,
  nome: z.string(),
  /** 1 = segunda … 7 = domingo (ISO). */
  diaDaSemana: z.number().int().min(1).max(7),
  hora: z.string().nullable(),
  ehHoje: z.boolean(),
})

export const EntregaDoPlano = AcaoDoPlano.extend({ clienteNome: z.string() })
export type EntregaDoPlano = z.infer<typeof EntregaDoPlano>

export const VisaoGeralDaCarteiraSaida = z.object({
  hoje: DiaCivil,
  /** "Olá, {nome}" (L1294). */
  nome: z.string(),
  podeVerValores: z.boolean(),
  kpis: z.object({
    clientesAtivos: z.number().int().min(0),
    emOnboarding: z.number().int().min(0),
    mrr: centavosNaSaida,
    /** `null` também quando nenhum cliente ativo tem mensalidade (ajuste 12). */
    ticketMedio: centavosNaSaida,
    acoesAtrasadas: z.number().int().min(0),
    clientesComAcaoAtrasada: z.number().int().min(0),
    tarefasVencidas: z.number().int().min(0),
    tarefasVencemHoje: z.number().int().min(0),
  }),
  saude: z.object({
    bom: z.number().int().min(0),
    atencao: z.number().int().min(0),
    critico: z.number().int().min(0),
    semSaude: z.number().int().min(0),
    barra: z.array(Segmento(['bom', 'atencao', 'critico', 'sem'])),
    emRisco: z.array(ClienteEmRisco),
  }),
  equipe: z.object({ pessoas: z.array(PessoaNaVisaoGeralSaida), escala: z.number().int().min(1) }),
  reunioesDaSemana: z.array(ReuniaoDaSemana),
  aniversarios: z.array(AniversarioNaLista),
  /** `null` = a sessão não tem a tela Prospecção (o painel some, L1325). */
  contatosRecomendados: z.array(LeadComercialNaLista).nullable(),
  proximasEntregas: z.array(EntregaDoPlano),
  /** Os clientes ativos, para o atalho "Registrar reunião" escolher um. */
  clientesAtivos: z.array(z.object({ id: Uuid, nome: z.string() })),
})
export type VisaoGeralDaCarteiraSaida = z.infer<typeof VisaoGeralDaCarteiraSaida>

/**
 * Os badges do menu (T4). `null` = a sessão não tem a tela, e o badge não
 * existe. Contagem, nunca lista: nada aqui nomeia cliente ou lead.
 */
export const ContadoresDoMenuSaida = z.object({
  tarefasVencidas: z.number().int().min(0).nullable(),
  contatosAgora: z.number().int().min(0).nullable(),
})
export type ContadoresDoMenuSaida = z.infer<typeof ContadoresDoMenuSaida>
