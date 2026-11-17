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
    if (!ctx.pode(def.permissao)) throw new ForbiddenException('Sem permissão para este relatório.')
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
    const codigo = randomBytes(4).toString('hex')
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
        await c.query('SELECT set_config($1, $2, true)', ['statement_timeout', String(this.limites.tempoMaximoMs)])

        // C13: a própria trilha conta as gerações e exportações da última hora.
        const n = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM auditoria
            WHERE clinica_id = $1 AND ator_id = $2
              AND entidade IN ('relatorio', 'exportacao_de_relatorio')
              AND em > now() - interval '1 hour'`,
          [ctx.clinicaId, quem.id],
        )
        if (Number(n.rows[0]?.n ?? '0') >= this.limites.porHora) {
          throw new HttpException('Muitos relatórios na última hora. Tente de novo mais tarde.', HttpStatus.TOO_MANY_REQUESTS)
        }

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
        const linha = await c.query<{ id: string }>(
          `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, para)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           RETURNING id::text AS id`,
          [
            ctx.clinicaId,
            quem.tipo,
            quem.id,
            exportacao === null ? 'acessou' : 'exportou',
            exportacao === null ? 'relatorio' : 'exportacao_de_relatorio',
            exportacao === null ? p.chave : codigo,
            JSON.stringify(registro),
          ],
        )
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
