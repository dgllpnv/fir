import {
  type ChaveDeRelatorio,
  type FiltrosDoRelatorio,
  type LinhaPacientesSemCompra,
  type LinhaRecebimento,
  type LinhaSaidaDeEstoque,
  type LinhaTarefaDaEquipe,
  type ResumoPacientesSemCompra,
  type ResumoRecebimentos,
  type ResumoSaidasDeEstoque,
  type ResumoTarefasDaEquipe,
  ROTULO_DO_MOTIVO_DE_SAIDA,
  SituacaoDoPrazo,
} from '@fir/contracts'
import {
  custoDaQuantidade,
  Dinheiro,
  ehSaidaDeEstoque,
  janela,
  MOTIVO_SOBRA_DE_FRASCO,
  NumeroDoKpi,
  Quantidade,
  saidasDoPeriodoDaAnalise,
  somarMeses,
  TIPOS,
  valorNaTela,
  type MovimentoDeEstoque,
} from '@fir/domain'
import { UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import type { z } from 'zod'
import type { ClinicaId } from '../banco/clinica-id'
import { itensDaAnalise } from '../estoque/analise.service'
import { movimentosDosItens, quantidadeNaSaida } from '../estoque/movimentos.repositorio'
import { diasQueContamNasTelas } from '../financeiro/faturamento-conferido'
import { partesDosRecebidosDaJanela } from '../financeiro/visao-do-mes.service'
import { comprasDosPacientes } from '../pacientes/pacientes.service'
import { consultarPrazos, cumprimento, tarefasDoCumprimento } from '../painel-geral/metricas-diarias'
import { nomeDaUnidade, pacientesDoRecorte } from './consultas/recorte'

/**
 * **AS QUATRO CONSULTAS DO T8**, e nenhuma conta nova.
 *
 * Cada uma é uma casca sobre a função que a TELA de origem já usa — o número
 * do relatório é o número da tela por construção, não por coincidência:
 *
 *  - 1 · `comprasDosPacientes` (o LTV da ficha, `COMPRA_DO_PACIENTE`);
 *  - 8 · `partesDosRecebidosDaJanela` (o `recebido` da Visão do mês) e
 *        `diasQueContamNasTelas` (os dias que contam, c.10 com a emenda);
 *  - 11 · `itensDaAnalise` + `saidasDoPeriodoDaAnalise` (o recorte da Análise,
 *        B8) e `custoDaQuantidade` (meio-para-cima, como `valorDaFalta`);
 *  - 15 · `consultarPrazos` e `tarefasDoCumprimento` (o bloco do Painel).
 *
 * O SQL que mora AQUI é só busca de nome por id, sempre com `$n` e sem
 * interpolação (appsec C12, `relatorios-sem-sql-raw`).
 */

export type ContextoDaConsulta = {
  readonly clinicaId: ClinicaId
  readonly fuso: string
  readonly hoje: string
  readonly pode: (chave: string) => boolean
  /** Quantas linhas devolver no máximo; uma a mais diz `truncado`. */
  readonly limite: number
  /** Exportação com "Incluir telefone" (L-IN-6). */
  readonly incluirTelefone: boolean
}

export type SaidaDaConsulta<L, R> = {
  readonly linhas: readonly L[]
  readonly resumo: R
  readonly truncado: boolean
  /** Sem dinheiro (appsec C8): o valor de uma faixa nunca entra aqui. */
  readonly filtrosEmTexto: readonly string[]
  /** Os pacientes do resultado, para `pacientes_da_exportacao` (L-IN-9). */
  readonly pacienteIds: readonly string[]
  /** As colunas opt-in que sairam (paciente no 11, telefone no 1). */
  readonly optIn: readonly ('telefone' | 'paciente')[]
}

// Exportados para as consultas do T9 (`./consultas/*.ts`): o mesmo corte, o
// mesmo texto de período e a mesma busca de nome por id, uma vez só.
export type Linha<S extends z.ZodTypeAny> = z.input<S>

export const cortar = <T>(xs: readonly T[], limite: number): { linhas: readonly T[]; truncado: boolean } =>
  xs.length > limite ? { linhas: xs.slice(0, limite), truncado: true } : { linhas: xs, truncado: false }

/** `aaaa-mm-dd` → `dd/mm/aaaa`. Texto de cabeçalho, nunca dinheiro. */
export const emDataBr = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`

export const periodoEmTexto = (de: string, ate: string): string => `Período: ${emDataBr(de)} a ${emDataBr(ate)}`

export const reais = (d: Dinheiro) => valorNaTela('reais', NumeroDoKpi.deDinheiro(d))

export async function nomeOu422(c: pg.PoolClient, sql: string, params: unknown[], oQue: string): Promise<string> {
  const r = await c.query<{ nome: string }>(sql, params)
  const nome = r.rows[0]?.nome
  if (nome === undefined) throw new UnprocessableEntityException(`${oQue} não encontrado nesta clínica.`)
  return nome
}

export const nomeDoLocal = (c: pg.PoolClient, ctx: ContextoDaConsulta, localId: string): Promise<string> =>
  nomeOu422(c, 'SELECT nome FROM locais_de_estoque WHERE id = $1 AND clinica_id = $2', [localId, ctx.clinicaId], 'Local')

/* ------------------------------------------------------------- relatório 1 */

export async function pacientesSemCompra(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'pacientes-sem-compra'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaPacientesSemCompra>, z.input<typeof ResumoPacientesSemCompra>>> {
  const filtrosEmTexto = [`Sem compra há ${f.semCompraHaMeses} ${f.semCompraHaMeses === 1 ? 'mês' : 'meses'}`]
  if (f.procedimentoId !== undefined) {
    const nome = await nomeOu422(
      c,
      'SELECT nome FROM procedimentos WHERE id = $1 AND clinica_id = $2',
      [f.procedimentoId, ctx.clinicaId],
      'Procedimento',
    )
    filtrosEmTexto.push(`Procedimento: ${nome}`)
  }
  if (f.valorMinimo !== undefined || f.valorMaximo !== undefined) filtrosEmTexto.push('Faixa de valor aplicada')
  const recorte = await pacientesDoRecorte(c, ctx, { unidadeId: f.unidadeId, origem: f.origem }, filtrosEmTexto)

  const corte = somarMeses(ctx.hoje, -f.semCompraHaMeses)
  const minimo = f.valorMinimo === undefined ? null : BigInt(f.valorMinimo)
  const maximo = f.valorMaximo === undefined ? null : BigInt(f.valorMaximo)
  const todas = (await comprasDosPacientes(c, ctx.clinicaId, ctx.fuso, f.procedimentoId ?? null)).filter(
    (p) =>
      p.ultimaCompra < corte &&
      (minimo === null || p.ltv >= minimo) &&
      (maximo === null || p.ltv <= maximo) &&
      (recorte === null || recorte.has(p.pacienteId)),
  )

  const { linhas, truncado } = cortar(todas, ctx.limite)
  return {
    linhas: linhas.map((p) => ({
      pacienteId: p.pacienteId,
      nome: p.nome,
      ultimaCompra: p.ultimaCompra,
      ...(f.procedimentoId !== undefined ? { procedimento: p.procedimento ?? '' } : {}),
      valorDaUltimaCompra: p.valorDaUltimaCompra.toString(),
      ltv: p.ltv.toString(),
      ...(ctx.incluirTelefone ? { telefone: p.telefone } : {}),
    })),
    resumo: { pacientes: todas.length },
    truncado,
    filtrosEmTexto,
    pacienteIds: linhas.map((p) => p.pacienteId),
    optIn: ctx.incluirTelefone ? ['telefone'] : [],
  }
}

/* ------------------------------------------------------------- relatório 8 */

type Somas = Map<string, Dinheiro>
const somarEm = (m: Somas, chave: string, v: Dinheiro): void => {
  m.set(chave, (m.get(chave) ?? Dinheiro.zero()).mais(v))
}
const emLista = (m: Somas) =>
  [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([rotulo, v]) => ({ rotulo, valor: reais(v) }))

export async function recebimentos(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'recebimentos'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaRecebimento>, z.input<typeof ResumoRecebimentos>>> {
  const filtrosEmTexto = [periodoEmTexto(f.de, f.ate)]
  if (f.forma !== undefined) filtrosEmTexto.push(`Forma: ${f.forma} (só nos dias com caixa fechado)`)
  if (f.tipo !== undefined) filtrosEmTexto.push(`Tipo: ${f.tipo}`)
  if (f.unidadeId !== undefined) filtrosEmTexto.push(`Unidade: ${await nomeDaUnidade(c, ctx, f.unidadeId)}`)
  if (f.registradoPorId !== undefined) {
    const nome = await nomeOu422(
      c,
      'SELECT nome FROM pessoas WHERE id = $1 AND clinica_id = $2',
      [f.registradoPorId, ctx.clinicaId],
      'Quem registrou',
    )
    filtrosEmTexto.push(`Registrado por: ${nome}`)
  }
  const [todasAsPartes, dias] = await Promise.all([
    partesDosRecebidosDaJanela(c, ctx.clinicaId, janela(f.de, f.ate, ctx.fuso), ctx.fuso),
    // O 8 ESPELHA a Visão do mês, e segue a regra das chaves que espelham uma
    // tela (ADR 2026-11-17-chaves-em-reais-e-os-dias-de-caixa): dia de mês
    // passado conta sempre; no mês corrente, só com caixa fechado, e hoje sem
    // caixa nunca (regra 6). É a mesma função dos KPIs.
    diasQueContamNasTelas(c, ctx.clinicaId, f.de, f.ate, ctx.fuso, ctx.hoje),
  ])
  const contam = new Set(dias.corte.dias)
  // Tipo, unidade e quem registrou estreitam tudo. A FORMA só olha os dias que
  // contam: no dia aguardando, "o Pix de hoje" é o esperado da gaveta (regra 6,
  // c.10) — a linha dele sai do recorte, e `aguardandoFechamento` continua o
  // total sem forma, o mesmo número de sem o filtro de forma.
  const doRecorte = todasAsPartes.filter(
    (p) =>
      (f.tipo === undefined || p.tipo === f.tipo) &&
      (f.unidadeId === undefined || p.unidadeId === f.unidadeId) &&
      (f.registradoPorId === undefined || p.registradoPorId === f.registradoPorId),
  )
  const partes = doRecorte.filter((p) => f.forma === undefined || (contam.has(p.dia) && p.forma === f.forma))

  let total = Dinheiro.zero()
  // O que entrou nos dias que ainda podem ser fechados às cegas. Hoje fica
  // FORA também deste total (regra 6), como em `medirFaturamentoConferido`.
  let aguardando = Dinheiro.zero()
  const porForma: Somas = new Map()
  const porTipo: Somas = new Map()
  const distintos = new Set<string>()
  for (const p of doRecorte) {
    if (!contam.has(p.dia) && p.dia !== ctx.hoje) aguardando = aguardando.mais(p.valor)
  }
  for (const p of partes) {
    if (!contam.has(p.dia)) continue
    total = total.mais(p.valor)
    somarEm(porForma, p.forma, p.valor)
    somarEm(porTipo, p.tipo, p.valor)
    distintos.add(p.recebimentoId)
  }

  const { linhas, truncado } = cortar(partes, ctx.limite)
  return {
    // O dia que não conta (aguardando o caixa, ou hoje aberto) sai sem valor e
    // sem forma: uma lista por forma de hoje É o esperado da gaveta (c.10).
    linhas: linhas.map((p) => {
      const conta = contam.has(p.dia)
      return {
        recebimentoId: p.recebimentoId,
        pacienteId: p.paciente === null ? null : p.pacienteId,
        data: p.dia,
        tipo: p.tipo,
        forma: conta ? p.forma : null,
        valor: conta ? p.valor.centavos.toString() : null,
        paciente: p.paciente,
        registradoPor: p.registradoPor,
      }
    }),
    resumo: {
      recebimentos: distintos.size,
      total: reais(total),
      porForma: emLista(porForma),
      porTipo: emLista(porTipo),
      aguardandoFechamento: aguardando.centavos.toString(),
      diasAguardando: dias.diasAguardando,
    },
    truncado,
    filtrosEmTexto,
    // O 8 traz o paciente pelo nome (I-38): quem está no arquivo vai para
    // `pacientes_da_exportacao` como no 1. Desativado sai sem nome, e fora.
    pacienteIds: [...new Set(linhas.filter((p) => p.paciente !== null).map((p) => p.pacienteId))],
    optIn: [],
  }
}

/* ------------------------------------------------------------ relatório 11 */

const ROTULO_DA_SAIDA: Readonly<Record<string, string>> = {
  consumo: 'Consumo',
  descarte: 'Descarte',
  interno: 'Uso interno',
}

/** Os motivos que o SISTEMA grava (baixa automática): não são texto de ninguém. */
const MOTIVOS_DO_SISTEMA: ReadonlySet<string> = new Set([MOTIVO_SOBRA_DE_FRASCO])

type DetalheDoMovimento = {
  id: string
  motivo: string
  compensa: boolean
  registrado_por: string | null
  paciente_id: string | null
  paciente: string | null
}

export async function saidasDeEstoque(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'saidas-de-estoque'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaSaidaDeEstoque>, z.input<typeof ResumoSaidasDeEstoque>>> {
  // L-IN-2: a coluna de paciente só com `jornada`. Sem ela, o relatório segue.
  const comPaciente = f.incluirPaciente && ctx.pode('jornada')
  const filtrosEmTexto = [
    f.modo === 'analise' ? 'Modo: período da análise (entre as contagens)' : 'Modo: calendário',
    periodoEmTexto(f.de, f.ate),
  ]

  const itens = (await itensDaAnalise(c)).filter(
    (i) => (f.itemId === undefined || i.id === f.itemId) && (f.localId === undefined || i.local_id === f.localId),
  )
  if (f.itemId !== undefined) {
    const item = await nomeOu422(
      c,
      'SELECT nome FROM itens_de_estoque WHERE id = $1 AND clinica_id = $2 AND excluido_em IS NULL AND ativo',
      [f.itemId, ctx.clinicaId],
      'Item',
    )
    filtrosEmTexto.push(`Item: ${item}`)
  }
  if (f.localId !== undefined) filtrosEmTexto.push(`Local: ${await nomeDoLocal(c, ctx, f.localId)}`)
  if (f.motivo !== undefined) filtrosEmTexto.push(`Motivo: ${ROTULO_DO_MOTIVO_DE_SAIDA[f.motivo]}`)
  if (comPaciente) filtrosEmTexto.push('Com a coluna de paciente')

  const movs = await movimentosDosItens(
    c,
    itens.map((i) => i.id),
  )
  const escolhidos: { item: (typeof itens)[number]; mov: MovimentoDeEstoque }[] = []
  for (const item of itens) {
    const doItem = movs.get(item.id) ?? []
    const saidas =
      f.modo === 'analise'
        ? (saidasDoPeriodoDaAnalise(doItem, f.de, f.ate) ?? [])
        : doItem.filter((m) => ehSaidaDeEstoque(m.tipo) && m.dia >= f.de && m.dia <= f.ate)
    // O motivo é o TIPO da saída; a compensação de uma baixa é do mesmo tipo, e
    // fica com ela — sem isso, o recorte "consumo" perderia a reabertura (B8).
    for (const mov of saidas) if (f.motivo === undefined || mov.tipo === f.motivo) escolhidos.push({ item, mov })
  }
  escolhidos.sort((a, b) => (a.mov.dia === b.mov.dia ? (a.mov.sequencia < b.mov.sequencia ? -1 : 1) : a.mov.dia < b.mov.dia ? -1 : 1))

  // Total pelo value object, linha a linha: quem soma a coluna chega ao total.
  let custoTotal = Dinheiro.zero()
  const custos = escolhidos.map(({ item, mov }) => {
    const q = Quantidade.deMilesimos(-mov.milesimos, item.medida)
    const custo = custoDaQuantidade(q, Dinheiro.deCentavos(BigInt(item.custo ?? '0')))
    custoTotal = custoTotal.mais(custo)
    return { q, custo }
  })

  const { linhas, truncado } = cortar(escolhidos, ctx.limite)
  const detalhes = new Map<string, DetalheDoMovimento>()
  if (linhas.length > 0) {
    const r = await c.query<DetalheDoMovimento>(
      `SELECT m.id, m.motivo, (m.compensa_id IS NOT NULL) AS compensa,
              pe.nome AS registrado_por,
              m.paciente_id,
              CASE WHEN pa.ativo THEN pa.nome END AS paciente
         FROM movimentos_de_estoque m
         LEFT JOIN pessoas pe ON pe.id = coalesce(m.criado_por, m.aplicado_por_id) AND pe.clinica_id = m.clinica_id
         LEFT JOIN pacientes pa ON pa.id = m.paciente_id AND pa.clinica_id = m.clinica_id
        WHERE m.clinica_id = $1 AND m.id = ANY($2::uuid[])`,
      [ctx.clinicaId, linhas.map((l) => l.mov.id)],
    )
    for (const d of r.rows) detalhes.set(d.id, d)
  }

  const pacienteIds = new Set<string>()
  const saida = linhas.map(({ item, mov }, i) => {
    const d = detalhes.get(mov.id)
    const rotulo = ROTULO_DA_SAIDA[mov.tipo] ?? mov.tipo
    // O motivo é TEXTO LIVRE ("Frasco da Ana caiu"): sai só no recorte de
    // classe `saude` (com a coluna de paciente, que exige `jornada`, e com aviso
    // e finalidade na exportação). Fora dele, só o rótulo e o motivo que o
    // próprio sistema escreve (revisão appsec do T8, M1).
    const livre = d === undefined ? '' : d.motivo.trim()
    const motivo =
      d?.compensa === true
        ? `Compensação de ${rotulo.toLowerCase()} (sessão reaberta)`
        : livre !== '' && (comPaciente || MOTIVOS_DO_SISTEMA.has(livre))
          ? `${rotulo} · ${livre}`
          : rotulo
    const pacienteId = d?.paciente === null || d === undefined ? null : d.paciente_id
    if (comPaciente && pacienteId !== null) pacienteIds.add(pacienteId)
    return {
      movimentoId: mov.id,
      itemId: item.id,
      data: mov.dia,
      item: item.nome,
      lote: mov.lote,
      quantidadeEmEstoque: quantidadeNaSaida(custos[i]!.q),
      unidade: item.medida,
      motivo,
      registradoPor: d?.registrado_por ?? null,
      custo: custos[i]!.custo.centavos.toString(),
      ...(comPaciente ? { pacienteId, paciente: d?.paciente ?? null } : {}),
    }
  })

  return {
    linhas: saida,
    resumo: { linhas: escolhidos.length, custo: custoTotal.centavos.toString() },
    truncado,
    filtrosEmTexto,
    pacienteIds: [...pacienteIds],
    optIn: comPaciente ? ['paciente'] : [],
  }
}

/* ------------------------------------------------------------ relatório 15 */

const NOMES_DE_TIPO: ReadonlySet<string> = new Set(TIPOS.map((t) => t.nome))

/**
 * O que a tarefa É, por um nome do CATÁLOGO de tipos, nunca pela descrição
 * (revisão appsec do T8, B2). A descrição é texto livre do balcão ("Ligar para
 * Maria (71) 9…") em qualquer tarefa, com ou sem paciente — e o 15 é de classe
 * `nenhuma`, sem aviso, exportável pelo suporte. O relatório mede PRAZO, e o
 * prazo não precisa do texto. Tipo fora do catálogo também cai no rótulo fixo.
 */
const rotuloDaTarefa = (tipo: string): string => (NOMES_DE_TIPO.has(tipo) ? tipo : 'Tarefa avulsa')

const ROTULO_DA_SITUACAO_DO_PRAZO: Readonly<Record<z.infer<typeof SituacaoDoPrazo>, string>> = {
  ok: 'No prazo',
  tarde: 'Com atraso',
  atrasada: 'Atrasada',
  a_vencer: 'A vencer',
}

/**
 * O resumo do recorte por situação: as outras três contagens zeram, e a taxa
 * sai da MESMA `cumprimento` do Painel — "no prazo" sozinho é 100%, "a vencer"
 * sozinho não tem denominador. Total = Σ das linhas.
 */
function soDaSituacao(
  r: z.input<typeof ResumoTarefasDaEquipe>['prazos'],
  s: z.infer<typeof SituacaoDoPrazo>,
): z.input<typeof ResumoTarefasDaEquipe>['prazos'] {
  const n = { ok: r.noPrazo, tarde: r.comAtraso, atrasada: r.atrasadas, a_vencer: r.aVencer }[s]
  const so = (k: typeof s) => String(k === s ? n : 0)
  return cumprimento({ pessoa: null, nome: null, funcao: null, total: String(n), no_prazo: so('ok'), com_atraso: so('tarde'), atrasadas: so('atrasada'), a_vencer: so('a_vencer') })
}

export async function tarefasDaEquipe(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'tarefas-da-equipe'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaTarefaDaEquipe>, z.input<typeof ResumoTarefasDaEquipe>>> {
  const filtrosEmTexto = [periodoEmTexto(f.de, f.ate)]
  if (f.responsavelId !== undefined) {
    const nome = await nomeOu422(
      c,
      'SELECT nome FROM pessoas WHERE id = $1 AND clinica_id = $2',
      [f.responsavelId, ctx.clinicaId],
      'Responsável',
    )
    filtrosEmTexto.push(`Responsável: ${nome}`)
  }
  if (f.tipo !== undefined) filtrosEmTexto.push(`Tipo: ${f.tipo}`)
  if (f.situacao !== undefined) filtrosEmTexto.push(`Situação: ${ROTULO_DA_SITUACAO_DO_PRAZO[f.situacao]}`)
  const periodo = { de: f.de, ate: f.ate }
  // O tipo entra no MESMO `WHERE` do Painel (`TAREFAS_DO_CUMPRIMENTO`) nas duas
  // leituras: o resumo continua sendo a contagem das linhas.
  const tipo = f.tipo ?? null
  const [prazos, tarefas] = await Promise.all([
    consultarPrazos(c, ctx.clinicaId, periodo, ctx.hoje, ctx.fuso, tipo),
    tarefasDoCumprimento(c, ctx.clinicaId, periodo, ctx.hoje, ctx.fuso, f.responsavelId ?? null, ctx.limite + 1, {
      tipo,
      situacao: f.situacao ?? null,
    }),
  ])
  const daPessoa = f.responsavelId === undefined ? null : prazos.porPessoa.find((p) => p.pessoaId === f.responsavelId)
  const doRecorte =
    f.responsavelId === undefined
      ? prazos.total
      : daPessoa === undefined || daPessoa === null
        ? { total: 0, noPrazo: 0, comAtraso: 0, atrasadas: 0, aVencer: 0, taxaNoPrazo: null }
        : {
            total: daPessoa.total,
            noPrazo: daPessoa.noPrazo,
            comAtraso: daPessoa.comAtraso,
            atrasadas: daPessoa.atrasadas,
            aVencer: daPessoa.aVencer,
            taxaNoPrazo: daPessoa.taxaNoPrazo,
          }
  const resumo = f.situacao === undefined ? doRecorte : soDaSituacao(doRecorte, f.situacao)

  const { linhas, truncado } = cortar(tarefas, ctx.limite)
  return {
    linhas: linhas.map((t) => ({
      tarefaId: t.tarefaId,
      tarefa: rotuloDaTarefa(t.tipo),
      responsavel: t.responsavel,
      prazo: t.prazo,
      concluidaEm: t.concluidaEm,
      noPrazo: t.situacao,
    })),
    resumo: { prazos: resumo },
    truncado,
    filtrosEmTexto,
    pacienteIds: [],
    optIn: [],
  }
}

// O registro das 15 consultas é o `switch` de `consultar` em `motor.ts`: ele é
// exaustivo por tipo (T9), e um segundo registro aqui teria de ser mantido igual.
