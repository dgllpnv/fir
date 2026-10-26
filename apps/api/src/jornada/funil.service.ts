import type {
  CartaoDaColuna,
  ColunaDaJornada,
  ColunaDaJornadaNaSaida,
  ConsultaDaJornada,
  PassoDoFunil,
  PassoDoFunilNaSaida,
  RespostaDaJornada,
} from '@fir/contracts'
import {
  ACOES_DO_FUNIL,
  type AcaoDeJornada,
  diaCivil,
  type Etapa,
  janela,
  type Relogio,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'
import { bordasDoPeriodo } from '../tarefas/consulta.service'

/**
 * `GET /v1/jornada` — o funil do período e a situação de hoje.
 *
 * **A diferença entre os dois, e ela é a pergunta que a tela responde:** o
 * funil conta MOVIMENTOS DO PERÍODO; as colunas mostram A SITUAÇÃO DE HOJE.
 * Um cartão agendado em setembro e realizado em outubro conta em "agendados"
 * de setembro e em "realizados" de outubro, e hoje está na coluna "Realizadas
 * sem orçamento". São duas perguntas diferentes, e colapsá-las numa é como o
 * número do funil deixa de bater com o tamanho da coluna e ninguém sabe qual
 * está certo.
 *
 * **A regra que faz o funil honesto:** conta-se evento cuja `acao` está em
 * `ACOES_DO_FUNIL` — derivado da tabela de transições de `packages/domain`,
 * passado como PARÂMETRO, nunca escrito à mão no SQL. O protótipo infere isso
 * da ausência de um rótulo no evento (`!x.rot`), e só acerta por coincidência.
 */

/**
 * A ação que alimenta cada passo do funil. Tabela, não `if`.
 *
 * Declarada passo → ação, e não o contrário, porque assim o `Record` é
 * EXAUSTIVO sobre `PassoDoFunil`: um passo novo no contrato sem ação declarada
 * não compila. Na direção oposta (`Partial<Record<AcaoDeJornada, …>>`) a falta
 * só apareceria em tempo de execução, como uma contagem zero sem explicação.
 *
 * As três ações que sobram de `ACOES_DO_FUNIL` — `noshow`, `desmarcar` e
 * `perder` — são os três KPIs, e `funil.test.ts` cobra que as oito juntas
 * sejam exatamente `ACOES_DO_FUNIL`.
 */
export const ACAO_DO_PASSO: Readonly<Record<PassoDoFunil, AcaoDeJornada>> = {
  agendados: 'agendar',
  confirmados: 'confirmar',
  realizados: 'concluir',
  orcamentosEnviados: 'registrarOrcamento',
  fechados: 'fechar',
}

/** As ações que viram KPI em vez de passo. */
export const ACOES_DOS_KPIS = ['noshow', 'desmarcar', 'perder'] as const satisfies readonly AcaoDeJornada[]

type Desenho = {
  readonly chave: PassoDoFunil
  readonly rotulo: string
  /** De onde sai o valor do passo. `null` = o passo não tem valor. */
  readonly valorDe: 'recebido' | 'evento' | null
  readonly rotuloDoValor: string
  /** O passo sobre o qual este converte. `null` = o primeiro. */
  readonly sobre: PassoDoFunil | null
  readonly sobreRotulo: string
}

/**
 * Os cinco passos, na ordem, com a conversão que cada um mostra.
 *
 * `fechados` converte sobre os ORÇAMENTOS quando houve orçamento no período, e
 * sobre os REALIZADOS quando não houve — é a conta do protótipo, e ela é a
 * certa: numa clínica que fecha no balcão sem passar por proposta, dividir por
 * zero orçamentos não diria nada.
 */
const DESENHO: readonly Desenho[] = [
  { chave: 'agendados', rotulo: 'Agendados', valorDe: null, rotuloDoValor: '', sobre: null, sobreRotulo: '' },
  { chave: 'confirmados', rotulo: 'Confirmados', valorDe: null, rotuloDoValor: '', sobre: 'agendados', sobreRotulo: 'dos agendados' },
  { chave: 'realizados', rotulo: 'Realizados', valorDe: 'recebido', rotuloDoValor: 'recebido', sobre: 'agendados', sobreRotulo: 'dos agendados' },
  { chave: 'orcamentosEnviados', rotulo: 'Orçamentos enviados', valorDe: 'evento', rotuloDoValor: 'orçado', sobre: 'realizados', sobreRotulo: 'dos realizados' },
  { chave: 'fechados', rotulo: 'Fechados', valorDe: 'evento', rotuloDoValor: 'fechado', sobre: 'orcamentosEnviados', sobreRotulo: 'dos orçamentos' },
]

/** As sete colunas do kanban, e de onde cada uma tira os cartões. */
type DesenhoDeColuna = {
  readonly chave: ColunaDaJornada
  readonly rotulo: string
  readonly etapas: readonly Etapa[]
  /**
   * `'hoje'` = a situação atual, sem olhar data. `'periodo'` = o último evento
   * desta etapa precisa cair na janela.
   */
  readonly recorte: 'hoje' | 'periodo'
  readonly temValor: boolean
}

const COLUNAS: readonly DesenhoDeColuna[] = [
  { chave: 'agendadas', rotulo: 'Agendadas', etapas: ['agendado'], recorte: 'hoje', temValor: false },
  { chave: 'confirmadas', rotulo: 'Confirmadas', etapas: ['confirmado'], recorte: 'hoje', temValor: false },
  // Junta as duas: para a recepção é uma lista só de gente para ligar.
  { chave: 'recontatar', rotulo: 'Recontatar', etapas: ['faltou', 'desmarcou'], recorte: 'hoje', temValor: false },
  { chave: 'realizadas', rotulo: 'Realizadas sem orçamento', etapas: ['realizado'], recorte: 'periodo', temValor: false },
  { chave: 'orcamentos', rotulo: 'Orçamentos em aberto', etapas: ['orcamento'], recorte: 'hoje', temValor: true },
  { chave: 'fechados', rotulo: 'Fechados', etapas: ['fechado'], recorte: 'periodo', temValor: true },
  { chave: 'perdidos', rotulo: 'Perdidos', etapas: ['perdido'], recorte: 'periodo', temValor: true },
]

/**
 * O teto de cartões por coluna.
 *
 * Trinta cabem na rolagem da coluna sem a resposta virar um megabyte numa
 * clínica com três anos de dado; o que sobra vira `restantes`, e a tela diz
 * "+N" em vez de fingir que a coluna acabou.
 */
const TETO_DA_COLUNA = 30

/** As etapas cujas colunas são do PERÍODO, e não da situação de hoje. */
const ETAPAS_DO_PERIODO: readonly Etapa[] = COLUNAS.filter((c) => c.recorte === 'periodo').flatMap(
  (c) => c.etapas,
)

const ROTULO_DO_PERIODO: Readonly<Record<ConsultaDaJornada['periodo'], string>> = {
  '7dias': 'Últimos 7 dias',
  '30dias': 'Últimos 30 dias',
  mes: 'Este mês',
  'mes-passado': 'Mês passado',
  per: 'Período escolhido',
}

/** Centavos somados, prontos para a saída. `null` quando o passo não tem valor. */
const emTexto = (v: bigint | null): string | null => (v === null ? null : v.toString())

/**
 * Pontos percentuais inteiros, ou `null` quando não há denominador.
 *
 * `null` e não zero: zero diria "nenhuma conversão", e a verdade é "não houve
 * o que converter". Os dois desenham coisas diferentes na tela.
 */
const percentual = (parte: number, todo: number): number | null =>
  todo === 0 ? null : Math.round((parte / todo) * 100)

@Injectable()
export class FunilService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async abrir(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    consulta: ConsultaDaJornada,
  ): Promise<RespostaDaJornada> {
    const hoje = diaCivil(this.relogio.agora(), fuso)
    // As bordas CIVIS saem do servidor (regra 24) e viram instantes UTC com a
    // virada do dia no fuso da clínica. `PERIODOS_DO_FUNIL` não inclui
    // `qualquer`, então `bordasDoPeriodo` nunca devolve `null` aqui — mas o
    // `??` fica, porque um `!` aqui é a afirmação que envelhece primeiro.
    const bordas = bordasDoPeriodo(consulta, hoje) ?? { de: hoje, ate: hoje }
    const emInstantes = janela(bordas.de, bordas.ate, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const filtro = filtroDosCartoes(consulta)
      const params = [clinicaId, ...filtro.params]

      const eventos = await contarEventos(c, filtro.onde, params, emInstantes)
      const recebido = await somarRecebido(c, filtro.onde, params, emInstantes)
      const colunas = await montarColunas(c, filtro.onde, params, emInstantes)

      const n = (chave: PassoDoFunil): number =>
        eventos.get(ACAO_DO_PASSO[chave])?.n ?? 0
      const valorDoEvento = (chave: PassoDoFunil): bigint =>
        eventos.get(ACAO_DO_PASSO[chave])?.valor ?? 0n

      /**
       * O denominador de "fechados" é escolhido AQUI, e não no desenho:
       * depende do que o período trouxe, não da tabela.
       */
      const houveOrcamento = n('orcamentosEnviados') > 0
      const funil: PassoDoFunilNaSaida[] = DESENHO.map((d) => {
        const sobre =
          d.chave === 'fechados' && !houveOrcamento ? ('realizados' as const) : d.sobre
        const sobreRotulo =
          d.chave === 'fechados' && !houveOrcamento ? 'dos realizados' : d.sobreRotulo
        const quantos = n(d.chave)
        return {
          chave: d.chave,
          rotulo: d.rotulo,
          n: quantos,
          valor:
            d.valorDe === null
              ? null
              : emTexto(d.valorDe === 'recebido' ? recebido : valorDoEvento(d.chave)),
          rotuloDoValor: d.rotuloDoValor,
          conversao: sobre === null ? null : percentual(quantos, n(sobre)),
          conversaoSobre: sobre === null ? '' : sobreRotulo,
          // A barra é proporcional ao PRIMEIRO passo. Piso de 4 para que um
          // passo com 1 em 400 ainda seja um traço visível, e não nada.
          proporcao:
            n('agendados') === 0
              ? 0
              : Math.max(4, Math.round((quantos / n('agendados')) * 100)),
        }
      })

      const faltaram = eventos.get('noshow')?.n ?? 0
      const perdidos = eventos.get('perder')

      return {
        de: bordas.de,
        ate: bordas.ate,
        rotuloDoPeriodo: ROTULO_DO_PERIODO[consulta.periodo],
        hoje,
        funil,
        noShow: {
          n: faltaram,
          // Sobre os atendimentos que DEVERIAM ter acontecido, não sobre os
          // agendados: um agendamento que ainda vai acontecer não deveria
          // piorar a taxa de hoje.
          taxa: percentual(faltaram, n('realizados') + faltaram),
        },
        desmarcados: { n: eventos.get('desmarcar')?.n ?? 0 },
        // O valor do perdido é o ORÇADO do cartão, não um campo do evento: o
        // evento de perda guarda motivo, não dinheiro.
        perdidos: { n: perdidos?.n ?? 0, valor: emTexto(perdidos?.valorDoCartao ?? 0n) },
        colunas,
      }
    })
  }
}

/** O recorte de cartões: a clínica, a pessoa e a unidade. */
function filtroDosCartoes(consulta: ConsultaDaJornada): {
  onde: string
  params: unknown[]
} {
  const onde = [`t.clinica_id = $1`, `t.excluida_em IS NULL`, `t.etapa IS NOT NULL`]
  const params: unknown[] = []
  if (consulta.responsavelId !== undefined) {
    params.push(consulta.responsavelId)
    const n = params.length + 1
    // Responsável OU solicitante — a mesma regra frouxa da tela Hoje: o funil
    // de quem marca as consultas é o das consultas que ela marcou.
    onde.push(`(t.responsavel_id = $${n} OR t.solicitante_id = $${n})`)
  }
  if (consulta.unidadeId !== undefined) {
    params.push(consulta.unidadeId)
    onde.push(`t.unidade_id = $${params.length + 1}`)
  }
  return { onde: onde.join(' AND '), params }
}

type ContagemDeEvento = { n: number; valor: bigint; valorDoCartao: bigint }

/**
 * Os eventos do período, agrupados por ação.
 *
 * `jsonb_array_elements` numa `LATERAL`: é varredura do array, e nenhum índice
 * a acelera — medido com 100 mil tarefas, o planejador escolhe `Parallel Seq
 * Scan` e leva 20,6 ms. A alternativa com `WITH … AS MATERIALIZED` usa o
 * índice de etapa e é três vezes mais lenta. Ver a migration 0008.
 *
 * `(ev->>'valor')::bigint` é exato, sem `numeric` no meio e sem `float` em
 * lugar nenhum — e é por isso que a decisão D-4 (centavos em TEXTO dentro do
 * `jsonb`) vale a pena.
 */
async function contarEventos(
  c: pg.PoolClient,
  onde: string,
  params: unknown[],
  emInstantes: { de: Date; ate: Date },
): Promise<Map<AcaoDeJornada, ContagemDeEvento>> {
  const p = [...params, [...ACOES_DO_FUNIL], emInstantes.de, emInstantes.ate]
  // `params` JÁ inclui a clínica em `$1`: o próximo marcador é o comprimento
  // dela mais um. Contar `$n` à mão é como o `$8` passa a apontar para o `$9`.
  const base = params.length
  const r = await c.query<{ acao: string; n: string; valor: string; valor_do_cartao: string }>(
    `SELECT ev->>'acao' AS acao,
            count(*)::text AS n,
            coalesce(sum((ev->>'valor')::bigint), 0)::text AS valor,
            coalesce(sum(t.valor_orcamento), 0)::text AS valor_do_cartao
       FROM tarefas t
       CROSS JOIN LATERAL jsonb_array_elements(t.historico) ev
      WHERE ${onde}
        AND ev->>'acao' = ANY($${base + 1})
        AND (ev->>'em')::timestamptz >= $${base + 2}
        AND (ev->>'em')::timestamptz <  $${base + 3}
      GROUP BY 1`,
    p,
  )
  return new Map(
    r.rows.map((x) => [
      x.acao as AcaoDeJornada,
      { n: Number(x.n), valor: BigInt(x.valor), valorDoCartao: BigInt(x.valor_do_cartao) },
    ]),
  )
}

/**
 * O que ENTROU nos atendimentos do período.
 *
 * A linha de `recebimentos` presa ao cartão, viva. O protótipo soma os
 * recebimentos da paciente no MESMO DIA do atendimento, o que conta dinheiro
 * de outro atendimento quando há dois no mesmo dia, e perde o pagamento
 * lançado no dia seguinte. Aqui o vínculo é a chave estrangeira.
 *
 * O filtro da D-9 está no `JOIN` e não no `WHERE` de propósito: `onde` vem de
 * fora, montado pelo chamador, e emendar a condição nele faria o número do
 * parâmetro depender de quem chama. No `JOIN` ele vale para todos os três
 * recortes do funil sem que nenhum deles precise saber da decisão.
 *
 * Por que ele importa aqui, sendo que somar zero é invisível: a função se
 * chama "o que entrou", e um dia alguém a trocará por `count(*)` ou por
 * `avg(r.valor)` para medir ticket médio por etapa. No dia em que isso
 * acontecer, a venda a prazo entraria no denominador.
 */
async function somarRecebido(
  c: pg.PoolClient,
  onde: string,
  params: unknown[],
  emInstantes: { de: Date; ate: Date },
): Promise<bigint> {
  const p = [...params, emInstantes.de, emInstantes.ate]
  const base = params.length
  const r = await c.query<{ total: string }>(
    `SELECT coalesce(sum(r.valor), 0)::text AS total
       FROM tarefas t
       JOIN recebimentos r ON r.tarefa_id = t.id AND r.estornado_em IS NULL
            AND ${DINHEIRO_QUE_ENTROU}
      WHERE ${onde}
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(t.historico) ev
           WHERE ev->>'acao' = 'concluir'
             AND (ev->>'em')::timestamptz >= $${base + 1}
             AND (ev->>'em')::timestamptz <  $${base + 2})`,
    p,
  )
  return BigInt(r.rows[0]?.total ?? '0')
}

type LinhaDeColuna = {
  id: string
  paciente_id: string | null
  paciente_nome: string | null
  tipo: string
  etapa: Etapa
  prazo: string
  hora: string | null
  proximo_passo_em: string | null
  valor_orcamento: string | null
  ultimo_evento_em: Date | null
}

/**
 * As sete colunas, numa consulta só — e o RECORTE FEITO NO BANCO.
 *
 * Sete idas ao banco numa tela que a gestão abre para olhar o mês seria sete
 * vezes o mesmo plano com um `WHERE` diferente.
 *
 * O `LATERAL` calcula, por cartão, o instante do ÚLTIMO evento da etapa em que
 * ele está — é o que data as três colunas de período. Duas decisões, as duas
 * medidas com 100 mil tarefas (8 mil cartões de jornada na clínica):
 *
 *  - o `ON` do `LATERAL` limita a varredura do `jsonb` às TRÊS etapas que
 *    precisam dela. Nas outras, `u.em` vem `NULL` e ninguém olha;
 *  - o filtro de janela fica no SQL, e não num `.filter()` depois. Sem isso a
 *    consulta devolvia os 8 mil cartões para a aplicação descartar quase
 *    todos, e levava **36,7 ms**; com o recorte no banco são 780 linhas e
 *    **18,5 ms** — metade do tempo e um décimo do que atravessa a conexão.
 */
async function montarColunas(
  c: pg.PoolClient,
  onde: string,
  params: unknown[],
  emInstantes: { de: Date; ate: Date },
): Promise<ColunaDaJornadaNaSaida[]> {
  const r = await c.query<LinhaDeColuna>(
    `SELECT t.id, t.paciente_id, pa.nome AS paciente_nome, t.tipo, t.etapa::text AS etapa,
            t.prazo::text AS prazo, t.hora::text AS hora,
            t.proximo_passo_em::text AS proximo_passo_em,
            t.valor_orcamento::text AS valor_orcamento,
            u.em AS ultimo_evento_em
       FROM tarefas t
       LEFT JOIN pacientes pa ON pa.id = t.paciente_id
       LEFT JOIN LATERAL (
         SELECT max((ev->>'em')::timestamptz) AS em
           FROM jsonb_array_elements(t.historico) ev
          WHERE ev->>'etapa' = t.etapa::text
       ) u ON t.etapa = ANY($${params.length + 1})
      WHERE ${onde}
        -- "encerrado" não tem coluna: ele saiu de todas as listas de propósito.
        AND t.etapa <> 'encerrado'
        AND (t.etapa <> ALL($${params.length + 1})
             OR (u.em >= $${params.length + 2} AND u.em < $${params.length + 3}))
      ORDER BY t.prazo DESC, t.hora NULLS LAST, t.criada_em DESC`,
    [...params, ETAPAS_DO_PERIODO, emInstantes.de, emInstantes.ate],
  )

  const porEtapa = new Map<Etapa, LinhaDeColuna[]>()
  for (const l of r.rows) {
    const atual = porEtapa.get(l.etapa)
    if (atual) atual.push(l)
    else porEtapa.set(l.etapa, [l])
  }

  // Nenhum `.filter()` de janela aqui: o SQL acima já recortou. Repetir a
  // regra de período em TypeScript seria a segunda escrita dela — e a segunda
  // é a que diverge quando a janela virar `[de, ate]` num dos dois lugares.
  return COLUNAS.map((d) => {
    const todos = d.etapas.flatMap((e) => porEtapa.get(e) ?? [])
    const soma = todos.reduce(
      (s, l) => s + (l.valor_orcamento === null ? 0n : BigInt(l.valor_orcamento)),
      0n,
    )
    return {
      chave: d.chave,
      rotulo: d.rotulo,
      n: todos.length,
      valor: d.temValor ? soma.toString() : null,
      itens: todos.slice(0, TETO_DA_COLUNA).map(paraCartao),
      restantes: Math.max(0, todos.length - TETO_DA_COLUNA),
    }
  })
}

const paraCartao = (l: LinhaDeColuna): CartaoDaColuna => ({
  id: l.id,
  pacienteId: l.paciente_id,
  pacienteNome: l.paciente_nome,
  tipo: l.tipo,
  etapa: l.etapa,
  prazo: l.prazo,
  // `time` do Postgres volta `HH:MM:SS`; a tela e o contrato falam `HH:MM`.
  hora: l.hora === null ? null : l.hora.slice(0, 5),
  proximoPassoEm: l.proximo_passo_em,
  ultimoEventoEm: l.ultimo_evento_em === null ? null : l.ultimo_evento_em.toISOString(),
  valorOrcamento: l.valor_orcamento,
})
