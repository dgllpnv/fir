import {
  CATALOGO_DE_RELATORIOS,
  type CabecalhoDaExportacao,
  ChaveDeRelatorio,
  classeDoRelatorio,
  type ClasseDeRelatorio,
  type ColunaNaSaida,
  ExecutarRelatorio,
  ExportarRelatorio,
  FILTROS_DOS_RELATORIOS,
  FINALIDADES_DE_EXPORTACAO,
  type FiltrosDoRelatorio,
  type FinalidadeDeExportacao,
  type FormatoDeExportacao,
  podeAbrirRelatorio,
  type ResultadoDaExportacao,
  type ResultadoDoRelatorio,
  temFaixaDeValor,
} from '@fir/contracts'
import { type ChaveDePermissao, diaCivil } from '@fir/domain'
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import type pg from 'pg'
import type { z } from 'zod'
import { type Ator, atorEmColunas } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { redigir } from '../comum/redacao.interceptor'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { primeiroErro } from '../tarefas/tarefas.controller'
import {
  type ContextoDaConsulta,
  pacientesSemCompra,
  recebimentos,
  type SaidaDaConsulta,
  saidasDeEstoque,
  tarefasDaEquipe,
} from './consultas'
import { contas, entradasDeEstoque, saldosEmAberto } from './consultas/financeiro-e-estoque'
import { faltasEDesmarcacoes, orcamentos } from './consultas/jornada'
import {
  aniversariantes,
  pacientesMaiorLtv,
  pacientesPorOrigemECampanha,
  pacientesPorProcedimento,
  pacientesQueIndicaram,
  pacientesSemAtendimento,
} from './consultas/pacientes'
import { LIMITES_DO_MOTOR, type LimitesDoMotor } from './limites'

/** O que o motor precisa da requisição — tirado de `req.contexto` pelo controlador. */
export type ContextoDoMotor = {
  readonly clinicaId: ClinicaId
  readonly clinicaNome: string
  readonly fuso: string
  readonly ator: Ator
  readonly pode: (chave: ChaveDePermissao) => boolean
  /** O nome de quem está na sessão — pessoa, ou o operador do suporte. */
  readonly quem: string
  /** Sessão de suporte (`ator_tipo = operador`): exportar `pessoal`/`saude` é 403 (L-IN-5). */
  readonly suporte: boolean
}

/** O que "Criar campanha" recebe da re-execução: ids e contagens, nunca linha. */
export type ListaDoRelatorio = {
  readonly chave: ChaveDeRelatorio
  readonly filtros: Record<string, unknown>
  readonly classe: ClasseDeRelatorio
  readonly linhas: number
  readonly truncado: boolean
  /** Distintos, na ordem do relatório. */
  readonly pacienteIds: readonly string[]
}

type Exportacao = {
  readonly formato: FormatoDeExportacao
  readonly incluirTelefone: boolean
  readonly finalidade: FinalidadeDeExportacao | undefined
}

const EXTENSAO: Record<FormatoDeExportacao, string> = { csv: 'csv', xlsx: 'xlsx', impressao: 'pdf' }

/**
 * Os avisos da L-IN-12, prontos do servidor. Sem dinheiro (appsec C8): o
 * cabeçalho é texto, e um valor aqui atravessaria a redação, que casa CHAVE.
 */
const aviso = (classe: ClasseDeRelatorio, clinica: string, finalidade: string | null): string | null =>
  classe === 'pessoal'
    ? `Contém dados pessoais de pacientes de ${clinica}. Uso restrito à finalidade da clínica. Não encaminhe nem guarde além do necessário.`
    : classe === 'saude'
      ? `Contém dados pessoais sensíveis de saúde (LGPD, art. 11). Uso restrito a: ${finalidade ?? ''}. Não encaminhe, não imprima sem necessidade e apague o arquivo ao terminar.`
      : null

/** `dd/mm/aaaa hh:mm` no fuso da CLÍNICA (regra 22), do relógio do servidor (regra 24). */
function instanteNaClinica(agora: Date, fuso: string): string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora)
  const p = (t: Intl.DateTimeFormatPartTypes) => partes.find((x) => x.type === t)?.value ?? ''
  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`
}

const ehErroDoPg = (e: unknown): e is { code: string } =>
  typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string'

/**
 * **O MOTOR DE RELATÓRIOS** (spec I-36 a I-40; ticket T8).
 *
 * Uma porta só para as duas rotas, nesta ordem, e a ordem é a regra:
 *
 *  1. o relatório existe (404) e a pessoa tem a permissão dele (403);
 *  2. a faixa de valor sem `valores` é 403 — ANTES do parse, porque o favorito
 *     redigido chega com `valorMinimo: null` e tem de dar 403, não 422 (C9);
 *  3. os filtros passam pelo `.strict()` do relatório (422, C12);
 *  4. a classe é a de tempo de execução; `saude` exige `jornada` (L-IN-2);
 *  5. na exportação: suporte não leva `pessoal`/`saude` (L-IN-5) e `saude`
 *     exige a finalidade (L-IN-11);
 *  6. DENTRO de uma transação: `statement_timeout`, o limite por hora, a
 *     consulta e o registro de acesso — se o registro falhar, a transação cai
 *     e nenhuma linha sai (C14, L-IN-8).
 *
 * A redação de valores é `redigir`, a MESMA função do `RedacaoInterceptor`,
 * aplicada aqui como primeira camada: o motor tira as colunas `dinheiro` e
 * apaga os valores; o interceptor apaga de novo na saída (C16).
 */
@Injectable()
export class MotorDeRelatorios {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(LIMITES_DO_MOTOR) private readonly limites: LimitesDoMotor,
  ) {}

  async executar(ctx: ContextoDoMotor, chaveCrua: string, corpo: unknown): Promise<ResultadoDoRelatorio> {
    const { filtros } = ler(ExecutarRelatorio, corpo)
    const p = this.preparar(ctx, chaveCrua, filtros)
    const { resultado } = await this.rodar(ctx, p, null)
    return resultado
  }

  async exportar(ctx: ContextoDoMotor, chaveCrua: string, corpo: unknown): Promise<ResultadoDaExportacao> {
    const e = ler(ExportarRelatorio, corpo)
    const p = this.preparar(ctx, chaveCrua, e.filtros)
    if (e.incluirTelefone && !CATALOGO_DE_RELATORIOS[p.chave].colunas.some((c) => 'optIn' in c && c.optIn === 'telefone')) {
      throw new UnprocessableEntityException('Este relatório não tem a coluna de telefone.')
    }
    if (ctx.suporte && p.classe !== 'nenhuma') {
      throw new ForbiddenException('A sessão de suporte não exporta dado pessoal de paciente.')
    }
    if (p.classe === 'saude' && e.finalidade === undefined) {
      throw new UnprocessableEntityException('Escolha a finalidade da exportação.')
    }
    const exportacao: Exportacao = {
      formato: e.formato,
      incluirTelefone: e.incluirTelefone,
      // A finalidade só tem sentido — e só é gravada — na classe `saude`.
      finalidade: p.classe === 'saude' ? e.finalidade : undefined,
    }
    const { resultado, codigo } = await this.rodar(ctx, p, exportacao)
    const rotulo = FINALIDADES_DE_EXPORTACAO.find((f) => f.chave === exportacao.finalidade)?.rotulo ?? null
    const agora = this.relogio.agora()
    const cabecalho: z.input<typeof CabecalhoDaExportacao> = {
      clinica: ctx.clinicaNome,
      relatorio: CATALOGO_DE_RELATORIOS[p.chave].titulo,
      filtrosEmTexto: resultado.cabecalho.filtrosEmTexto,
      geradoEm: instanteNaClinica(agora, ctx.fuso),
      exportadoPor: ctx.quem,
      codigo,
      finalidade: rotulo,
      aviso: aviso(p.classe, ctx.clinicaNome, rotulo),
    }
    const dia = diaCivil(agora, ctx.fuso).replaceAll('-', '')
    return {
      exportacao: {
        codigo,
        nomeDoArquivo: `fir-${p.chave}-${dia}-${codigo}.${EXTENSAO[e.formato]}`,
        formato: e.formato,
        cabecalho,
      },
      resultado,
    }
  }

  /** Os passos 1 a 4: tudo o que se decide sem abrir o banco. */
  private preparar(ctx: ContextoDoMotor, chaveCrua: string, cru: Record<string, unknown>) {
    const lida = ChaveDeRelatorio.safeParse(chaveCrua)
    if (!lida.success) throw new NotFoundException('Relatório não encontrado.')
    const chave = lida.data
    const def = CATALOGO_DE_RELATORIOS[chave]
    if (!podeAbrirRelatorio(chave, ctx.pode)) throw new ForbiddenException('Sem permissão para este relatório.')
    if (temFaixaDeValor(cru) && !ctx.pode('valores')) {
      throw new ForbiddenException('Filtrar por valor exige ver valores.')
    }
    const r = FILTROS_DOS_RELATORIOS[chave].safeParse(cru)
    if (!r.success) throw new UnprocessableEntityException(primeiroErro(r.error))
    const filtros: Record<string, unknown> = r.data
    let classe = classeDoRelatorio(chave, filtros)
    if (classe === 'saude' && !ctx.pode('jornada')) {
      // O 11 continua sem a coluna de paciente (a consulta a tira); os outros param.
      if (chave !== 'saidas-de-estoque') throw new ForbiddenException('Este recorte tem dado de saúde e exige a jornada.')
      classe = def.classe
    }
    return { chave, filtros, classe }
  }

  private async rodar(
    ctx: ContextoDoMotor,
    p: { chave: ChaveDeRelatorio; filtros: Record<string, unknown>; classe: ClasseDeRelatorio },
    exportacao: Exportacao | null,
  ): Promise<{ resultado: ResultadoDoRelatorio; codigo: string }> {
    const quem = atorEmColunas(ctx.ator)
    // Sem ator identificado não há a quem contar o limite: falha fechado.
    if (quem.id === null) throw new ForbiddenException('Relatório exige uma sessão identificada.')
    await this.contarTentativa(ctx.clinicaId, ctx.ator, quem.id)
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)
    const consulta: ContextoDaConsulta = {
      clinicaId: ctx.clinicaId,
      fuso: ctx.fuso,
      hoje,
      pode: (k) => ctx.pode(k as ChaveDePermissao),
      limite: this.limites.linhas,
      incluirTelefone: exportacao?.incluirTelefone === true,
    }
    try {
      return await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
        // `statement_timeout` vale POR COMANDO (ADR do T8, "Limites"): o
        // orçamento da execução é este valor vezes os comandos da consulta.
        await c.query('SELECT set_config($1, $2, true)', ['statement_timeout', String(this.limites.tempoMaximoMs)])

        const saida = await consultar(c, consulta, p.chave, p.filtros)
        const resultado = montar(p.chave, p.classe, p.filtros, saida, ctx.pode)

        // O registro de acesso, NA MESMA TRANSAÇÃO (C14): ids, enums e a
        // contagem — nenhum texto livre, nenhum nome (L-IN-8).
        const registro = {
          relatorio: p.chave,
          filtros: p.filtros,
          classe: p.classe,
          linhas: resultado.linhas.length,
          ...(exportacao === null
            ? {}
            : {
                formato: exportacao.formato,
                optIn: saida.optIn,
                finalidade: exportacao.finalidade ?? null,
              }),
        }
        const gravar = (entidadeId: string) =>
          c.query<{ id: string }>(
            `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, para)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
             RETURNING id::text AS id`,
            [
              ctx.clinicaId,
              quem.tipo,
              quem.id,
              exportacao === null ? 'acessou' : 'exportou',
              exportacao === null ? 'relatorio' : 'exportacao_de_relatorio',
              entidadeId,
              JSON.stringify(registro),
            ],
          )
        let codigo = ''
        let linha: pg.QueryResult<{ id: string }>
        if (exportacao === null) {
          linha = await gravar(p.chave)
        } else {
          // L-IN-10: o código é único na clínica (índice da 0108). Na colisão,
          // outro código — com SAVEPOINT, para a recusa não derrubar a leitura.
          for (let tentativa = 1; ; tentativa++) {
            codigo = randomBytes(4).toString('hex')
            await c.query('SAVEPOINT codigo_da_exportacao')
            try {
              linha = await gravar(codigo)
              await c.query('RELEASE SAVEPOINT codigo_da_exportacao')
              break
            } catch (e) {
              await c.query('ROLLBACK TO SAVEPOINT codigo_da_exportacao')
              const colidiu = ehErroDoPg(e) && e.code === '23505' && (e as { constraint?: string }).constraint === 'auditoria_codigo_da_exportacao'
              if (!colidiu || tentativa >= 5) throw e
            }
          }
        }
        if (exportacao !== null && saida.pacienteIds.length > 0) {
          await c.query(
            `INSERT INTO pacientes_da_exportacao (clinica_id, exportacao_id, paciente_id)
             SELECT $1, $2::bigint, unnest($3::uuid[])`,
            [ctx.clinicaId, linha.rows[0]!.id, saida.pacienteIds],
          )
        }
        return { resultado, codigo }
      })
    } catch (e) {
      // 57014 = `statement_timeout`; 55P03 = espera de lock estourada. A
      // transação caiu inteira: nenhuma linha sai, e nada foi registrado.
      if (ehErroDoPg(e) && (e.code === '57014' || e.code === '55P03')) {
        throw new ServiceUnavailableException('O relatório demorou demais. Estreite o período ou os filtros.')
      }
      throw e
    }
  }

  /**
   * **A LISTA PARA "CRIAR CAMPANHA"** (spec I-42; appsec C20, C22). Os mesmos
   * passos 1 a 4 e o mesmo limite por hora; o relatório tem de ser de lista de
   * pacientes. A consulta roda DE NOVO no servidor, com os filtros recebidos —
   * os pacientes nunca vêm do cliente —, e `usar` recebe a transação aberta:
   * a campanha nasce na mesma transação que leu a lista, ou não nasce.
   */
  async comALista<T>(
    ctx: ContextoDoMotor,
    chaveCrua: string,
    cru: Record<string, unknown>,
    usar: (c: pg.PoolClient, lista: ListaDoRelatorio) => Promise<T>,
  ): Promise<T> {
    const p = this.preparar(ctx, chaveCrua, cru)
    if (!CATALOGO_DE_RELATORIOS[p.chave].listaDePacientes) {
      throw new UnprocessableEntityException('Este relatório não é uma lista de pacientes.')
    }
    const quem = atorEmColunas(ctx.ator)
    if (quem.id === null) throw new ForbiddenException('Relatório exige uma sessão identificada.')
    await this.contarTentativa(ctx.clinicaId, ctx.ator, quem.id)
    const consulta: ContextoDaConsulta = {
      clinicaId: ctx.clinicaId,
      fuso: ctx.fuso,
      hoje: diaCivil(this.relogio.agora(), ctx.fuso),
      pode: (k) => ctx.pode(k as ChaveDePermissao),
      limite: this.limites.linhas,
      incluirTelefone: false,
    }
    try {
      return await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
        await c.query('SELECT set_config($1, $2, true)', ['statement_timeout', String(this.limites.tempoMaximoMs)])
        const saida = await consultar(c, consulta, p.chave, p.filtros)
        return usar(c, {
          chave: p.chave,
          filtros: p.filtros,
          classe: p.classe,
          linhas: saida.linhas.length,
          truncado: saida.truncado,
          pacienteIds: [...new Set(saida.pacienteIds)],
        })
      })
    } catch (e) {
      if (ehErroDoPg(e) && (e.code === '57014' || e.code === '55P03')) {
        throw new ServiceUnavailableException('O relatório demorou demais. Estreite o período ou os filtros.')
      }
      throw e
    }
  }

  /**
   * **O LIMITE POR HORA, contado na TENTATIVA** (appsec C13, revisão B1).
   *
   * Transação curta e PRÓPRIA, com COMMIT antes da consulta: a tentativa conta
   * mesmo quando a leitura estoura o tempo ou falha (a trilha, essa, continua
   * gravando só o sucesso — L-IN-8). `pg_advisory_xact_lock` por (clínica,
   * pessoa) serializa a contagem e a gravação: sem ela, pedidos em paralelo
   * liam o mesmo número. Qualquer erro aqui sobe — falha fechado.
   */
  private async contarTentativa(clinicaId: ClinicaId, ator: Ator, atorId: string): Promise<void> {
    try {
      await this.banco.naClinica(clinicaId, ator, async (c) => {
        await c.query('SELECT set_config($1, $2, true)', ['statement_timeout', String(this.limites.tempoMaximoMs)])
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [`relatorios:${clinicaId}:${atorId}`])
        await c.query(
          `DELETE FROM tentativas_de_relatorio
            WHERE clinica_id = $1 AND ator_id = $2 AND em <= now() - interval '1 hour'`,
          [clinicaId, atorId],
        )
        const n = await c.query<{ n: string }>(
          'SELECT count(*)::text AS n FROM tentativas_de_relatorio WHERE clinica_id = $1 AND ator_id = $2',
          [clinicaId, atorId],
        )
        if (Number(n.rows[0]?.n ?? 'NaN') < this.limites.porHora) {
          await c.query('INSERT INTO tentativas_de_relatorio (clinica_id, ator_id) VALUES ($1, $2)', [clinicaId, atorId])
          return
        }
        throw new HttpException('Muitos relatórios na última hora. Tente de novo mais tarde.', HttpStatus.TOO_MANY_REQUESTS)
      })
    } catch (e) {
      if (ehErroDoPg(e) && (e.code === '57014' || e.code === '55P03')) {
        throw new ServiceUnavailableException('Muitos relatórios ao mesmo tempo. Tente de novo em instantes.')
      }
      throw e
    }
  }
}

function ler<T extends z.ZodTypeAny>(schema: T, entrada: unknown): z.infer<T> {
  const r = schema.safeParse(entrada)
  if (!r.success) throw new UnprocessableEntityException(primeiroErro(r.error))
  return r.data
}

/*
 * `as`: os filtros já passaram pelo schema DESTE relatório em `preparar` — o
 * `switch` só recupera o tipo que o `Record<ChaveDeRelatorio, schema>` perde.
 */
function consultar(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  chave: ChaveDeRelatorio,
  filtros: Record<string, unknown>,
): Promise<SaidaDaConsulta<unknown, unknown>> {
  switch (chave) {
    case 'pacientes-sem-compra':
      return pacientesSemCompra(c, ctx, filtros as FiltrosDoRelatorio<'pacientes-sem-compra'>)
    case 'recebimentos':
      return recebimentos(c, ctx, filtros as FiltrosDoRelatorio<'recebimentos'>)
    case 'saidas-de-estoque':
      return saidasDeEstoque(c, ctx, filtros as FiltrosDoRelatorio<'saidas-de-estoque'>)
    case 'tarefas-da-equipe':
      return tarefasDaEquipe(c, ctx, filtros as FiltrosDoRelatorio<'tarefas-da-equipe'>)
    case 'pacientes-sem-atendimento':
      return pacientesSemAtendimento(c, ctx, filtros as FiltrosDoRelatorio<'pacientes-sem-atendimento'>)
    case 'pacientes-maior-ltv':
      return pacientesMaiorLtv(c, ctx, filtros as FiltrosDoRelatorio<'pacientes-maior-ltv'>)
    case 'pacientes-que-indicaram':
      return pacientesQueIndicaram(c, ctx, filtros as FiltrosDoRelatorio<'pacientes-que-indicaram'>)
    case 'pacientes-por-procedimento':
      return pacientesPorProcedimento(c, ctx, filtros as FiltrosDoRelatorio<'pacientes-por-procedimento'>)
    case 'pacientes-por-origem-e-campanha':
      return pacientesPorOrigemECampanha(c, ctx, filtros as FiltrosDoRelatorio<'pacientes-por-origem-e-campanha'>)
    case 'aniversariantes':
      return aniversariantes(c, ctx, filtros as FiltrosDoRelatorio<'aniversariantes'>)
    case 'saldos-em-aberto':
      return saldosEmAberto(c, ctx, filtros as FiltrosDoRelatorio<'saldos-em-aberto'>)
    case 'contas':
      return contas(c, ctx, filtros as FiltrosDoRelatorio<'contas'>)
    case 'entradas-de-estoque':
      return entradasDeEstoque(c, ctx, filtros as FiltrosDoRelatorio<'entradas-de-estoque'>)
    case 'orcamentos':
      return orcamentos(c, ctx, filtros as FiltrosDoRelatorio<'orcamentos'>)
    case 'faltas-e-desmarcacoes':
      return faltasEDesmarcacoes(c, ctx, filtros as FiltrosDoRelatorio<'faltas-e-desmarcacoes'>)
  }
}

/**
 * As colunas que saem, do catálogo: sem `valores`, nenhuma `dinheiro`; opt-in
 * só quando escolhido; "só se filtrado" só com o filtro.
 */
export function colunasQueSaem(
  chave: ChaveDeRelatorio,
  filtros: Readonly<Record<string, unknown>>,
  optIn: readonly string[],
  pode: (k: ChaveDePermissao) => boolean,
): ColunaNaSaida[] {
  const valores = pode('valores')
  return CATALOGO_DE_RELATORIOS[chave].colunas
    .filter((c) => valores || c.tipo !== 'dinheiro')
    .filter((c) => !('optIn' in c) || optIn.includes(c.optIn))
    .filter((c) => !('seFiltradoPor' in c) || filtros[c.seFiltradoPor] !== undefined)
    .map((c) => ({ chave: c.chave, rotulo: c.rotulo, tipo: c.tipo }))
}

/**
 * A resposta montada, JÁ REDIGIDA: a primeira das duas camadas (C16). É
 * exportada para que a prova por mutação exercite esta camada sozinha, sem o
 * interceptor.
 */
export function montar(
  chave: ChaveDeRelatorio,
  classe: ClasseDeRelatorio,
  filtros: Readonly<Record<string, unknown>>,
  saida: SaidaDaConsulta<unknown, unknown>,
  pode: (k: ChaveDePermissao) => boolean,
): ResultadoDoRelatorio {
  const bruto = {
    relatorio: chave,
    classe,
    cabecalho: { titulo: CATALOGO_DE_RELATORIOS[chave].titulo, filtrosEmTexto: [...saida.filtrosEmTexto] },
    colunas: colunasQueSaem(chave, filtros, saida.optIn, pode),
    linhas: [...saida.linhas],
    resumo: saida.resumo,
    truncado: saida.truncado,
  }
  // `as`: `redigir` devolve `unknown` porque é estrutural; a forma é a de
  // `bruto`, com campos monetários possivelmente `null` — que o contrato aceita.
  return redigir(bruto, pode) as ResultadoDoRelatorio
}
