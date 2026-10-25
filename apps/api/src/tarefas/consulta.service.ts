import type {
  ConsultaDeHoje,
  ConsultaDeTarefas,
  Escopo,
  ListaDeTarefas,
  RespostaDeHoje,
  TarefaNaLista,
} from '@fir/contracts'
import { diaCivil, fimDoMes, janela, type Relogio, somarDias, somarMeses } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { type AutorDaRequisicao, type LinhaDeTarefa, paraSaida, SELECT_TAREFA } from './leitura'

/**
 * A consulta que as DUAS telas usam.
 *
 * `GET /v1/tarefas` e `GET /v1/hoje` são a mesma leitura com recortes
 * diferentes. Escrevê-las separadas é como a janela de período divergiria
 * entre elas — e aí "o que fiz hoje" na tela Tarefas deixaria de bater com a
 * tela Hoje, para a mesma pessoa, no mesmo instante.
 */

/** O acumulador de parâmetros do `pg`, para não contar `$n` à mão. */
class Parametros {
  readonly valores: unknown[] = []
  constructor(...iniciais: unknown[]) {
    this.valores.push(...iniciais)
  }
  prox(valor: unknown): string {
    this.valores.push(valor)
    return `$${this.valores.length}`
  }
}

/**
 * O filtro do escopo (MANUAL cap. 3).
 *
 * `equipe` não filtra nada — e por isso ele exige `tarefas.equipe`, conferido
 * no controlador. A permissão não entra aqui porque uma consulta que decide
 * permissão é uma consulta que alguém vai chamar de outro lugar sem decidir.
 */
function filtroDeEscopo(escopo: Escopo, eu: string, p: Parametros): string | null {
  if (escopo === 'meu') return `t.responsavel_id = ${p.prox(eu)}`
  if (escopo === 'solicitei') return `t.solicitante_id = ${p.prox(eu)}`
  return null
}

/**
 * O filtro de pessoa dos TRÊS BLOCOS DA JORNADA — mais frouxo que o das
 * tarefas, e é o `vePasso` do protótipo.
 *
 * Em "Para mim" entra quem é **responsável ou solicitante**, e isso é decisão
 * de produto: o passo seguinte de um agendamento que eu marquei é meu, mesmo
 * que outra pessoa vá executá-lo. Com o filtro estrito, quem marca a consulta
 * nunca vê que a paciente faltou — e o recontato cai no vão entre as duas.
 */
function filtroDePasso(escopo: Escopo, eu: string, p: Parametros): string | null {
  if (escopo === 'meu') {
    const quem = p.prox(eu)
    return `(t.responsavel_id = ${quem} OR t.solicitante_id = ${quem})`
  }
  if (escopo === 'solicitei') return `t.solicitante_id = ${p.prox(eu)}`
  return null
}

/**
 * O cartão em RECONTATO sai das listas de tarefa, e não do banco.
 *
 * Esta cláusula aparece nas quatro contagens da tela Hoje — a lista do dia, as
 * pendentes de dias anteriores, as bolinhas da semana e o aviso do que o
 * filtro esconde. Escrita uma vez, como constante, porque a quinta contagem
 * que alguém acrescentar sem ela devolve o cartão para "Pendentes" sem erro
 * nenhum, e a recepção volta a ver 15 pendentes todo dia.
 *
 * **Divergência consciente do protótipo** no caso do aviso: lá a conta de
 * ocultas NÃO exclui o recontato (`ocultas = …filter(…)` sem `emRecontato`),
 * então o aviso promete cartões que a tela do dia não mostra.
 */
const FORA_DO_RECONTATO = `t.etapa IS DISTINCT FROM 'faltou'
                       AND t.etapa IS DISTINCT FROM 'desmarcou'`

/**
 * As bordas CIVIS do período, resolvidas no servidor (regra 24).
 *
 * O cliente manda o NOME do período; as datas saem do dia civil de hoje na
 * clínica. Bordas calculadas no navegador seriam o relógio do cliente
 * decidindo a data de negócio — e o navegador de quem está em outro fuso, ou
 * com o relógio errado, mudaria o relatório do mês.
 */
export function bordasDoPeriodo(
  consulta: Pick<ConsultaDeTarefas, 'periodo' | 'de' | 'ate'>,
  hoje: string,
): { de: string; ate: string } | null {
  switch (consulta.periodo) {
    case 'qualquer':
      return null
    case '7dias':
      return { de: somarDias(hoje, -6), ate: hoje }
    case '30dias':
      return { de: somarDias(hoje, -29), ate: hoje }
    case 'mes':
      return { de: `${hoje.slice(0, 7)}-01`, ate: fimDoMes(hoje.slice(0, 7)) }
    case 'mes-passado': {
      const mes = somarMeses(`${hoje.slice(0, 7)}-01`, -1, 1).slice(0, 7)
      return { de: `${mes}-01`, ate: fimDoMes(mes) }
    }
    case 'per':
      return { de: consulta.de ?? hoje, ate: consulta.ate ?? consulta.de ?? hoje }
  }
}

/**
 * A regra do período, e ela é do MANUAL cap. 4: *"O período considera a data
 * de realização das concluídas e o prazo das demais."*
 *
 * Duas colunas de natureza diferente numa janela só. A concluída é um
 * INSTANTE, então a janela é em UTC com as bordas calculadas no fuso da
 * clínica; a aberta é um DIA CIVIL, e compara data com data, sem fuso nenhum
 * no meio — converter um dia civil para instante só para compará-lo seria
 * convertê-lo duas vezes.
 *
 * Semiaberta `[de, ate)` nas duas metades, uma convenção só (regra 23).
 */
function filtroDePeriodo(bordas: { de: string; ate: string }, fuso: string, p: Parametros): string {
  const emInstantes = janela(bordas.de, bordas.ate, fuso)
  return `CASE WHEN t.status = 'concluida'
               THEN t.concluida_em >= ${p.prox(emInstantes.de)}
                AND t.concluida_em <  ${p.prox(emInstantes.ate)}
               ELSE t.prazo >= ${p.prox(bordas.de)}::date
                AND t.prazo <  ${p.prox(somarDias(bordas.ate, 1))}::date
          END`
}

/**
 * A segunda-feira da semana que contém o dia — o `weekStartOf` do protótipo.
 *
 * Sem fuso: um dia civil já é uma data de calendário, e aplicar o fuso da
 * clínica a ele seria convertê-lo duas vezes. Em que dia da semana cai 24/10
 * não depende de onde a clínica fica.
 */
export function segundaDaSemana(dia: string): string {
  const [a, m, d] = dia.split('-').map(Number)
  const diaDaSemana = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()
  return somarDias(dia, -((diaDaSemana + 6) % 7))
}

/** O escopo para onde o aviso "N tarefas não aparecem aqui" manda olhar. */
const escopoAlternativo = (escopo: Escopo, podeEquipe: boolean): Escopo =>
  podeEquipe ? 'equipe' : escopo === 'meu' ? 'solicitei' : 'meu'

@Injectable()
export class ConsultaDeTarefasService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  hojeDaClinica(fuso: string): string {
    return diaCivil(this.relogio.agora(), fuso)
  }

  async listar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    consulta: ConsultaDeTarefas,
  ): Promise<ListaDeTarefas> {
    const hoje = this.hojeDaClinica(fuso)
    // `$1` clínica e `$2` hoje são os dois do `SELECT_TAREFA`.
    const p = new Parametros(clinicaId, hoje)
    const onde: string[] = []

    const escopo = filtroDeEscopo(consulta.escopo, autor.id, p)
    if (escopo !== null) onde.push(escopo)

    const bordas = bordasDoPeriodo(consulta, hoje)
    if (bordas !== null) onde.push(filtroDePeriodo(bordas, fuso, p))

    switch (consulta.situacao) {
      case 'todas':
        break
      case 'atrasada':
        // Contra o HOJE DO SERVIDOR, sempre. É a mesma regra do campo
        // `atrasada` de cada linha, e as duas leem o mesmo `$2`.
        onde.push(`t.status = 'aberta' AND t.prazo < $2::date`)
        break
      default:
        onde.push(`t.status = ${p.prox(consulta.situacao)}`)
    }

    if (consulta.solicitanteId !== undefined) {
      onde.push(`t.solicitante_id = ${p.prox(consulta.solicitanteId)}`)
    }
    if (consulta.responsavelId !== undefined) {
      onde.push(`t.responsavel_id = ${p.prox(consulta.responsavelId)}`)
    }
    if (consulta.tipo !== undefined && consulta.tipo !== '') {
      // "__interna" é o valor que a tela usa para "Tarefas internas" — as que
      // não têm paciente. Não é um tipo, é a ausência de um.
      onde.push(
        consulta.tipo === '__interna'
          ? 't.paciente_id IS NULL'
          : `t.tipo = ${p.prox(consulta.tipo)}`,
      )
    }
    if (consulta.unidadeId !== undefined) {
      onde.push(`t.unidade_id = ${p.prox(consulta.unidadeId)}`)
    }
    if (consulta.q !== undefined && consulta.q !== '') {
      // `normalizar_nome` é a MESMA função que indexa o nome do paciente —
      // sem acento, sem caixa, espaços colapsados. Uma segunda normalização
      // em TypeScript divergiria dela no primeiro nome em NFD.
      const alvo = p.prox(consulta.q)
      onde.push(`(
        normalizar_nome(coalesce(pa.nome, '')) LIKE '%' || normalizar_nome(${alvo}) || '%'
        OR normalizar_nome(t.descricao)        LIKE '%' || normalizar_nome(${alvo}) || '%'
        OR normalizar_nome(t.obs)              LIKE '%' || normalizar_nome(${alvo}) || '%'
        OR normalizar_nome(t.resultado)        LIKE '%' || normalizar_nome(${alvo}) || '%')`)
    }

    // `count(*) OVER ()` precisa viver na mesma lista de seleção do resultado,
    // e `SELECT_TAREFA` termina no `WHERE` — daí a CTE. O total vem na mesma
    // ida ao banco: uma segunda consulta de contagem pode discordar da
    // primeira quando alguém conclui uma tarefa entre as duas.
    const sql = `
      WITH base AS (${SELECT_TAREFA}${onde.map((o) => ` AND ${o}`).join('')})
      SELECT *, count(*) OVER () AS total FROM base
       ORDER BY prazo, hora NULLS LAST, (prioridade = 'urgente') DESC, criada_em
       LIMIT ${p.prox(consulta.limite)} OFFSET ${p.prox(consulta.deslocamento)}`

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const r = await c.query<LinhaDeTarefa>(sql, p.valores)
      return {
        tarefas: r.rows.map(paraSaida),
        total: Number(r.rows[0]?.total ?? 0),
        hoje,
      }
    })
  }

  /**
   * Tudo o que a tela Hoje mostra, composto AQUI.
   *
   * A faixa da semana, a contagem de pendentes e o aviso de tarefas ocultas
   * são contas, e `docs/design.md` proíbe conta no front. Também não são uma
   * conveniência: a faixa precisa contar tarefas que o recorte da tela não
   * carregou, e o aviso precisa contar justamente as que o filtro escondeu.
   */
  async hoje(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    consulta: ConsultaDeHoje,
  ): Promise<RespostaDeHoje> {
    const hoje = this.hojeDaClinica(fuso)
    const dia = consulta.dia ?? hoje
    const inicioDaSemana = segundaDaSemana(dia)
    const escopo = consulta.escopo

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const ler = async (
        extra: string,
        params: unknown[],
        ordem = 't.prazo, t.hora NULLS LAST, (t.prioridade = \'urgente\') DESC, t.criada_em',
        escopoFrouxo = false,
      ): Promise<TarefaNaLista[]> => {
        const p = new Parametros(clinicaId, hoje, ...params)
        const doEscopo = escopoFrouxo
          ? filtroDePasso(escopo, autor.id, p)
          : filtroDeEscopo(escopo, autor.id, p)
        const r = await c.query<LinhaDeTarefa>(
          `${SELECT_TAREFA} AND ${extra}${doEscopo === null ? '' : ` AND ${doEscopo}`}
             ORDER BY ${ordem}`,
          p.valores,
        )
        return r.rows.map(paraSaida)
      }

      // Pendentes: abertas com prazo < HOJE DO SERVIDOR. Não dependem do dia
      // navegado — "ficam aqui todos os dias até serem concluídas ou
      // canceladas" (MANUAL cap. 3).
      const pendentes = await ler(
        `t.status = 'aberta' AND t.prazo < $2::date AND ${FORA_DO_RECONTATO}`,
        [],
      )
      const tarefas = await ler(
        `t.status = 'aberta' AND t.prazo = $3::date AND ${FORA_DO_RECONTATO}`,
        [dia],
      )
      // As concluídas não precisam da cláusula: `faltou` e `desmarcou` têm
      // `status = 'aberta'` por `CHECK` (0007), então não há como cair aqui.
      const concluidas = await ler(`t.status = 'concluida' AND t.prazo = $3::date`, [dia])

      const semana = await this.faixaDaSemana(c, clinicaId, hoje, inicioDaSemana, escopo, autor)
      const aniversariantes =
        dia === hoje ? await this.aniversariantesDoDia(c, clinicaId, dia) : []
      const { ocultas, alvo } = await this.ocultasPeloFiltro(c, clinicaId, hoje, dia, escopo, autor)

      /**
       * OS TRÊS BLOCOS DA JORNADA — e os três são do HOJE DO SERVIDOR.
       *
       * Nunca do dia navegado: ir para a semana passada não faz o recontato
       * de ontem desaparecer, exatamente como "atrasada" não desatrasa. É a
       * mesma razão pela qual `$2` (hoje) e `$3` (dia) são parâmetros
       * diferentes no `SELECT_TAREFA`.
       *
       * Vazios sem a permissão `jornada`: o servidor sempre valida (regra 16),
       * e aqui "validar" é não compor a seção — não esconder na tela. A tela
       * Hoje em si é de todos (`perm: null`), então a resposta continua
       * inteira para o resto.
       */
      const daJornada = autor.podeJornada
      const recontatar = daJornada
        ? await ler(
            `t.etapa IN ('faltou','desmarcou')`,
            [],
            // Quem espera há mais tempo vem primeiro. `coalesce` porque um
            // cartão migrado (épico 9) pode não ter `proximo_passo_em`.
            'coalesce(t.proximo_passo_em, t.prazo), t.hora NULLS LAST, t.criada_em',
            true,
          )
        : []
      const paraConfirmar = daJornada
        ? await ler(
            `t.etapa = 'agendado' AND t.prazo = $2::date + 1`,
            [],
            't.hora NULLS LAST, t.criada_em',
            true,
          )
        : []
      const retomar = daJornada
        ? await ler(
            `t.etapa = 'orcamento' AND t.proximo_passo_em IS NOT NULL
             AND t.proximo_passo_em <= $2::date`,
            [],
            't.proximo_passo_em, t.criada_em',
            true,
          )
        : []

      return {
        dia,
        hoje,
        escopo,
        semana,
        aniversariantes,
        pendentes: { total: pendentes.length, itens: pendentes },
        tarefas,
        concluidas,
        ocultasPeloFiltro: ocultas,
        escopoComAsOcultas: ocultas === 0 ? null : alvo,
        recontatar,
        paraConfirmar,
        retomar,
      }
    })
  }

  /** Os sete dias, com os números que viram as bolinhas. */
  private async faixaDaSemana(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    hoje: string,
    inicio: string,
    escopo: Escopo,
    autor: AutorDaRequisicao,
  ): Promise<RespostaDeHoje['semana']> {
    const p = new Parametros(clinicaId, hoje, inicio, somarDias(inicio, 7))
    const doEscopo = filtroDeEscopo(escopo, autor.id, p)
    const r = await c.query<{ dia: string; abertas: string; atrasadas: string }>(
      `SELECT t.prazo::text AS dia,
              count(*)::text AS abertas,
              count(*) FILTER (WHERE t.prazo < $2::date)::text AS atrasadas
         FROM tarefas t
        WHERE t.clinica_id = $1 AND t.excluida_em IS NULL AND t.status = 'aberta'
          AND t.prazo >= $3::date AND t.prazo < $4::date
          AND ${FORA_DO_RECONTATO}
          ${doEscopo === null ? '' : `AND ${doEscopo}`}
        GROUP BY t.prazo`,
      p.valores,
    )
    const porDia = new Map(r.rows.map((x) => [x.dia, x]))
    return [0, 1, 2, 3, 4, 5, 6].map((i) => {
      const dia = somarDias(inicio, i)
      const achado = porDia.get(dia)
      return {
        dia,
        abertas: Number(achado?.abertas ?? 0),
        atrasadas: Number(achado?.atrasadas ?? 0),
      }
    })
  }

  private async aniversariantesDoDia(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    dia: string,
  ): Promise<RespostaDeHoje['aniversariantes']> {
    const r = await c.query<{
      id: string
      nome: string
      telefone: string
      aniversario: string
      ja_tem: boolean
    }>(
      `SELECT p.id, p.nome, p.telefone, p.aniversario::text AS aniversario,
              EXISTS (SELECT 1 FROM tarefas t
                       WHERE t.paciente_id = p.id AND t.tipo = 'Aniversário'
                         AND t.prazo = $2::date AND t.status <> 'cancelada'
                         AND t.excluida_em IS NULL) AS ja_tem
         FROM pacientes p
        WHERE p.clinica_id = $1 AND p.ativo AND p.aniversario IS NOT NULL
          -- Mês e dia do DIA CIVIL DA CLÍNICA, que já veio resolvido: um
          -- extract(... from now()) aqui usaria o fuso do banco (UTC) e a
          -- clínica veria o aniversário de ontem ou o de amanhã.
          AND extract(month FROM p.aniversario) = extract(month FROM $2::date)
          AND extract(day   FROM p.aniversario) = extract(day   FROM $2::date)
        ORDER BY p.nome`,
      [clinicaId, dia],
    )
    return r.rows.map((x) => ({
      id: x.id,
      nome: x.nome,
      telefone: x.telefone,
      aniversario: x.aniversario,
      jaTemTarefa: x.ja_tem,
    }))
  }

  /**
   * *"6 tarefas em aberto para hoje não aparecem em 'Para mim'."*
   *
   * Sem este número a recepção olha para um dia vazio e conclui que não há
   * nada a fazer — quando há seis tarefas abertas, criadas para outra pessoa,
   * a um toque de distância. É o `ocultas` do protótipo, com o mesmo alcance:
   * as do dia navegado, mais as pendentes quando o dia navegado é hoje (que é
   * quando a tela as mostra).
   */
  private async ocultasPeloFiltro(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    hoje: string,
    dia: string,
    escopo: Escopo,
    autor: AutorDaRequisicao,
  ): Promise<{ ocultas: number; alvo: Escopo }> {
    const alvo = escopoAlternativo(escopo, autor.podeEquipe)
    if (escopo === 'equipe') return { ocultas: 0, alvo }

    const p = new Parametros(clinicaId, hoje, dia)
    const meu = filtroDeEscopo(escopo, autor.id, p)
    const doAlvo = filtroDeEscopo(alvo, autor.id, p)
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM tarefas t
        WHERE t.clinica_id = $1 AND t.excluida_em IS NULL AND t.status = 'aberta'
          AND (t.prazo = $3::date OR ($3::date = $2::date AND t.prazo < $2::date))
          AND ${FORA_DO_RECONTATO}
          AND NOT (${meu ?? 'true'})
          ${doAlvo === null ? '' : `AND ${doAlvo}`}`,
      p.valores,
    )
    return { ocultas: Number(r.rows[0]!.n), alvo }
  }
}
