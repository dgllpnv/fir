import {
  type FiltrosDoRelatorio,
  type LinhaAniversariante,
  type LinhaPacientesMaiorLtv,
  type LinhaPacientesPorOrigemECampanha,
  type LinhaPacientesPorProcedimento,
  type LinhaPacientesQueIndicaram,
  type LinhaPacientesSemAtendimento,
  type ResumoDePacientes,
  type ResumoPacientesPorOrigemECampanha,
  type ResumoPacientesPorProcedimento,
  type ResumoPacientesQueIndicaram,
  ROTULO_DA_SITUACAO_DO_PROGRAMA,
  SITUACOES_DO_PROGRAMA_NO_FILTRO,
} from '@fir/contracts'
import {
  diaEMesDoAniversario,
  Dinheiro,
  idadeEm,
  janela,
  type SessaoExistente,
  situacaoDoPrograma,
  somarDias,
  somarMeses,
  TIPO_SESSAO,
} from '@fir/domain'
import { UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import type { z } from 'zod'
import { comprasDoPeriodo } from '../../pacientes/compras-do-periodo'
import { comprasDosPacientes, movimentosDosPacientes } from '../../pacientes/pacientes.service'
import { diasQueAindaNaoContam, pacientesNovosDaJanela, pagoNosDias } from '../../painel-geral/novos-pacientes'
import { indicadorasDaJanela, receitaNoPeriodo } from '../../painel-geral/quem-mais-indica'
import { sessoesDoPrograma } from '../../programas/leitura.service'
import { type ContextoDaConsulta, cortar, emDataBr, type Linha, nomeOu422, periodoEmTexto, type SaidaDaConsulta } from '../consultas'
import { pacientesDoRecorte } from './recorte'

/**
 * **AS CONSULTAS DE PACIENTE DO T9** (relatórios 2 a 7). Cascas, como as do
 * T8: cada número vem da função da tela de origem.
 *
 *  - 2 e 7 · `movimentosDosPacientes` (o `MOVIMENTO` e o atalho da lista);
 *  - 3 · `comprasDosPacientes` (o LTV da ficha);
 *  - 4 · `indicadorasDaJanela` ("Quem mais indica" do Painel),
 *        `quemTemRecebimento` ("virou paciente" = ao menos um recebimento) e
 *        `receitaNoPeriodo` (a receita das indicadas no período, com as
 *        portas do "Top pagantes": `baseDeReceita` e `caixaFechado`, N-22);
 *  - 5 · `sessoesDoPrograma` (o "realizadas de total" de Programas);
 *  - 6 · `pacientesNovosDaJanela` ("Novos pacientes" do Painel).
 */

const telefoneSe = (ctx: ContextoDaConsulta, telefone: string) => (ctx.incluirTelefone ? { telefone } : {})
const optInDe = (ctx: ContextoDaConsulta): ('telefone' | 'paciente')[] => (ctx.incluirTelefone ? ['telefone'] : [])
const meses = (n: number) => `${n} ${n === 1 ? 'mês' : 'meses'}`

/* ------------------------------------------------------------- relatório 2 */

export async function pacientesSemAtendimento(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'pacientes-sem-atendimento'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaPacientesSemAtendimento>, z.input<typeof ResumoDePacientes>>> {
  const dias = f.semAtendimentoHaDias
  const corte = dias !== undefined ? somarDias(ctx.hoje, -dias) : somarMeses(ctx.hoje, -(f.semAtendimentoHaMeses ?? 0))
  const filtrosEmTexto = [`Sem atendimento há ${dias !== undefined ? `${dias} ${dias === 1 ? 'dia' : 'dias'}` : meses(f.semAtendimentoHaMeses ?? 0)}`]
  if (f.tipo !== undefined) filtrosEmTexto.push(`Tipo de atendimento: ${f.tipo}`)
  const recorte = await pacientesDoRecorte(c, ctx, { unidadeId: f.unidadeId }, filtrosEmTexto)
  const base = (await movimentosDosPacientes(c, ctx.clinicaId, ctx.fuso, { comMovimento: true })).filter(
    (p) => recorte === null || recorte.has(p.pacienteId),
  )
  // Com o tipo, a régua é o último atendimento CONCLUÍDO daquele tipo (quem
  // nunca teve um não entra); sem ele, o movimento da lista. O tipo é de
  // `atende`, então toda paciente com um deles já está em `base`.
  const doTipo = f.tipo === undefined ? null : await ultimoAtendimentoDoTipo(c, ctx, f.tipo)
  const todas = base
    .map((p) => ({ ...p, ultimoAtendimento: doTipo === null ? p.ultimoAtendimento : (doTipo.get(p.pacienteId) ?? null) }))
    .filter((p): p is typeof p & { ultimoAtendimento: string } => p.ultimoAtendimento !== null && p.ultimoAtendimento < corte)
  if (doTipo !== null) {
    todas.sort((a, b) =>
      a.ultimoAtendimento !== b.ultimoAtendimento
        ? (a.ultimoAtendimento < b.ultimoAtendimento ? -1 : 1)
        : a.nome !== b.nome
          ? a.nome.localeCompare(b.nome, 'pt-BR')
          : a.pacienteId < b.pacienteId ? -1 : 1,
    )
  }
  const { linhas, truncado } = cortar(todas, ctx.limite)
  return {
    linhas: linhas.map((p) => ({
      pacienteId: p.pacienteId,
      nome: p.nome,
      ultimoAtendimento: p.ultimoAtendimento,
      ...telefoneSe(ctx, p.telefone),
    })),
    resumo: { pacientes: todas.length },
    truncado,
    filtrosEmTexto,
    pacienteIds: linhas.map((p) => p.pacienteId),
    optIn: optInDe(ctx),
  }
}

/** O último atendimento CONCLUÍDO de cada paciente, de um tipo, no dia civil da clínica. */
async function ultimoAtendimentoDoTipo(c: pg.PoolClient, ctx: ContextoDaConsulta, tipo: string): Promise<Map<string, string>> {
  const r = await c.query<{ id: string; dia: string }>(
    `SELECT t.paciente_id::text AS id, max((t.concluida_em AT TIME ZONE $2)::date)::text AS dia
       FROM tarefas t
      WHERE t.clinica_id = $1 AND t.status = 'concluida' AND t.excluida_em IS NULL
        AND t.paciente_id IS NOT NULL AND t.tipo = $3
      GROUP BY t.paciente_id`,
    [ctx.clinicaId, ctx.fuso, tipo],
  )
  return new Map(r.rows.map((l) => [l.id, l.dia]))
}

/* ------------------------------------------------------------- relatório 3 */

export async function pacientesMaiorLtv(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'pacientes-maior-ltv'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaPacientesMaiorLtv>, z.input<typeof ResumoDePacientes>>> {
  const filtrosEmTexto = [`Os ${f.quantos} maiores LTV`, f.de !== undefined && f.ate !== undefined ? periodoEmTexto(f.de, f.ate) : 'Desde sempre']
  const recorte = await pacientesDoRecorte(c, ctx, { unidadeId: f.unidadeId, origem: f.origem }, filtrosEmTexto)
  // Com período, as MESMAS compras da ficha dentro de `[de, ate]`; sem, o LTV da ficha.
  const fonte =
    f.de !== undefined && f.ate !== undefined
      ? await comprasDoPeriodo(c, ctx.clinicaId, janela(f.de, f.ate, ctx.fuso))
      : await comprasDosPacientes(c, ctx.clinicaId, ctx.fuso, null)
  const todas = fonte.filter((p) => recorte === null || recorte.has(p.pacienteId)).sort((a, b) =>
    a.ltv === b.ltv ? (a.nome === b.nome ? (a.pacienteId < b.pacienteId ? -1 : 1) : a.nome.localeCompare(b.nome, 'pt-BR')) : a.ltv > b.ltv ? -1 : 1,
  )
  const topo = todas.slice(0, f.quantos)
  const { linhas, truncado } = cortar(topo, ctx.limite)
  return {
    linhas: linhas.map((p) => ({
      pacienteId: p.pacienteId,
      nome: p.nome,
      ltv: p.ltv.toString(),
      // `comprasDosPacientes` só devolve quem tem ao menos uma compra.
      ticketMedio: Dinheiro.deCentavos(p.ltv).media(p.compras).centavos.toString(),
      compras: p.compras,
      ...telefoneSe(ctx, p.telefone),
    })),
    resumo: { pacientes: topo.length },
    truncado,
    filtrosEmTexto,
    pacienteIds: linhas.map((p) => p.pacienteId),
    optIn: optInDe(ctx),
  }
}

/* ------------------------------------------------------------- relatório 4 */

/**
 * "Viraram pacientes" = indicada com ≥ 1 recebimento NÃO ESTORNADO, em
 * qualquer data e de qualquer valor (spec I-4): a venda a prazo (valor 0,
 * tudo em aberto) também é a indicada que comprou. É contagem de gente, não
 * de dinheiro — a receita continua em `receitaNoPeriodo`.
 */
async function quemTemRecebimento(c: pg.PoolClient, clinicaId: ContextoDaConsulta['clinicaId'], ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const r = await c.query<{ id: string }>(
    `SELECT DISTINCT r.paciente_id::text AS id FROM recebimentos r
      WHERE r.clinica_id = $1 AND r.paciente_id = ANY($2::uuid[]) AND r.estornado_em IS NULL`,
    [clinicaId, [...ids]],
  )
  return new Set(r.rows.map((l) => l.id))
}

export async function pacientesQueIndicaram(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'pacientes-que-indicaram'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaPacientesQueIndicaram>, z.input<typeof ResumoPacientesQueIndicaram>>> {
  const j = janela(f.de, f.ate, ctx.fuso)
  const minimo = f.minimoDeIndicacoes
  const todas = (await indicadorasDaJanela(c, ctx.clinicaId, j, null)).filter((l) => minimo === undefined || l.indicadas >= minimo)
  const { linhas, truncado } = cortar(todas, ctx.limite)
  const indicadas = linhas.flatMap((l) => l.indicadaIds)
  const comRecebimento = await quemTemRecebimento(c, ctx.clinicaId, indicadas)
  const receitas = await receitaNoPeriodo(c, ctx.clinicaId, ctx.fuso, indicadas, j)
  return {
    linhas: linhas.map((l) => {
      let receita = Dinheiro.zero()
      let viraram = 0
      for (const id of l.indicadaIds) {
        if (comRecebimento.has(id)) viraram++
        receita = receita.mais(receitas.get(id) ?? Dinheiro.zero())
      }
      return {
        pacienteId: l.pacienteId,
        indicadora: l.nome,
        indicadas: l.indicadas,
        viraramPacientes: viraram,
        receitaDasIndicadas: receita.centavos.toString(),
        ...telefoneSe(ctx, l.telefone),
      }
    }),
    resumo: { indicadoras: todas.length, indicadas: todas.reduce((s, l) => s + l.indicadas, 0) },
    truncado,
    filtrosEmTexto: [
      periodoEmTexto(f.de, f.ate),
      'Pela data de cadastro da indicada',
      'Receita das indicadas no período, só dos dias com caixa fechado',
      ...(minimo === undefined ? [] : [`No mínimo ${minimo} ${minimo === 1 ? 'indicação' : 'indicações'}`]),
    ],
    pacienteIds: linhas.map((l) => l.pacienteId),
    optIn: optInDe(ctx),
  }
}

/* ------------------------------------------------------------- relatório 5 */

type ItemDoPrograma = {
  programa_id: string
  paciente_id: string
  nome: string
  telefone: string
  chave: string
  procedimento_id: string
  procedimento: string
  valor: string | null
  encerrado: boolean
}

type Situacao = (typeof SITUACOES_DO_PROGRAMA_NO_FILTRO)[number]

/**
 * A situação do PROGRAMA pela MESMA `situacaoDoPrograma` da tela Programas:
 * encerrado vence tudo, concluído é nenhuma aberta e alguma feita, e o resto é
 * ativo (atrasado, hoje, em dia).
 */
const situacaoNoFiltro = (encerrado: boolean, sessoes: readonly SessaoExistente[], hoje: string): Situacao => {
  const s = situacaoDoPrograma({ encerrado, sessoes, hojeDaClinica: hoje }).situacao
  return s === 'encerrado' || s === 'concluido' ? s : 'ativo'
}

export async function pacientesPorProcedimento(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'pacientes-por-procedimento'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaPacientesPorProcedimento>, z.input<typeof ResumoPacientesPorProcedimento>>> {
  // Os filtros de antes (I-41): `incluirEncerrados` ausente ou `false` é o
  // `situacao = 'ativo'` do banco — ativo e concluído; `true`, os três.
  const situacoes: readonly Situacao[] =
    f.situacoes ?? (f.incluirEncerrados === true ? SITUACOES_DO_PROGRAMA_NO_FILTRO : ['ativo', 'concluido'])
  const procedimentoIds = f.procedimentoIds ?? (f.procedimentoId === undefined ? null : [f.procedimentoId])
  const filtrosEmTexto = [
    `Programas: ${SITUACOES_DO_PROGRAMA_NO_FILTRO.filter((s) => situacoes.includes(s)).map((s) => ROTULO_DA_SITUACAO_DO_PROGRAMA[s]).join(', ')}`,
  ]
  if (procedimentoIds !== null) {
    const distintos = [...new Set(procedimentoIds)]
    const r = await c.query<{ nome: string }>(
      'SELECT nome FROM procedimentos WHERE clinica_id = $1 AND id = ANY($2::uuid[]) ORDER BY nome',
      [ctx.clinicaId, distintos],
    )
    if (r.rows.length !== distintos.length) throw new UnprocessableEntityException('Procedimento não encontrado nesta clínica.')
    filtrosEmTexto.push(`${distintos.length === 1 ? 'Procedimento' : 'Procedimentos'}: ${r.rows.map((x) => x.nome).join(', ')}`)
  }
  if (f.de !== undefined && f.ate !== undefined) filtrosEmTexto.push(`Início do programa: ${emDataBr(f.de)} a ${emDataBr(f.ate)}`)
  // O banco só sabe "encerrado"; concluído e ativo saem das sessões, abaixo.
  const soEncerrados = situacoes.every((s) => s === 'encerrado')
  const semEncerrados = !situacoes.includes('encerrado')
  // O nome do procedimento é o GRAVADO no item (D-2), como na tela Programas.
  const itens = await c.query<ItemDoPrograma>(
    `SELECT p.id AS programa_id, p.paciente_id, pa.nome, pa.telefone, i.chave,
            i.procedimento_id, i.procedimento_nome AS procedimento, i.valor::text AS valor,
            (p.situacao = 'encerrado') AS encerrado
       FROM programas p
       JOIN pacientes pa ON pa.id = p.paciente_id AND pa.clinica_id = p.clinica_id
       JOIN itens_do_programa i ON i.programa_id = p.id AND i.clinica_id = p.clinica_id
      WHERE p.clinica_id = $1 AND p.excluido_em IS NULL AND pa.ativo
        AND (NOT $2::boolean OR p.situacao = 'encerrado')
        AND (NOT $3::boolean OR p.situacao = 'ativo')
        AND ($4::uuid[] IS NULL OR i.procedimento_id = ANY($4::uuid[]))
        AND ($5::date IS NULL OR p.inicio >= $5::date)
        AND ($6::date IS NULL OR p.inicio <= $6::date)
      ORDER BY pa.nome, pa.id, p.inicio, p.id, i.ordem, i.chave`,
    [ctx.clinicaId, soEncerrados, semEncerrados, procedimentoIds, f.de ?? null, f.ate ?? null],
  )
  const programas = [...new Set(itens.rows.map((i) => i.programa_id))]
  const sessoes = await c.query<{ id: string; programa_id: string; item_chave: string | null; sessao_indice: number | null; prazo: string; status: string }>(
    `SELECT id, programa_id, item_chave, sessao_indice, prazo::text AS prazo, status FROM tarefas
      WHERE clinica_id = $1 AND excluida_em IS NULL AND programa_id = ANY($2::uuid[]) AND tipo = $3`,
    [ctx.clinicaId, programas, TIPO_SESSAO],
  )
  const doItem = new Map<string, { status: string }[]>()
  const doPrograma = new Map<string, SessaoExistente[]>()
  for (const s of sessoes.rows) {
    const k = `${s.programa_id}|${s.item_chave ?? ''}`
    doItem.set(k, [...(doItem.get(k) ?? []), s])
    // `as`: o status vem do CHECK de `tarefas` (aberta, concluida, cancelada) — a mesma leitura da tela Programas.
    const sessao = { tarefaId: s.id, itemChave: s.item_chave ?? 'i1', indice: s.sessao_indice ?? 1, prazo: s.prazo, status: s.status as SessaoExistente['status'] }
    doPrograma.set(s.programa_id, [...(doPrograma.get(s.programa_id) ?? []), sessao])
  }
  const situacaoDe = new Map<string, Situacao>()
  for (const i of itens.rows) {
    if (!situacaoDe.has(i.programa_id)) situacaoDe.set(i.programa_id, situacaoNoFiltro(i.encerrado, doPrograma.get(i.programa_id) ?? [], ctx.hoje))
  }
  const todas = itens.rows.filter((i) => situacoes.includes(situacaoDe.get(i.programa_id) ?? 'ativo'))

  const { linhas, truncado } = cortar(todas, ctx.limite)
  return {
    linhas: linhas.map((i) => {
      const { validas, feitas } = sessoesDoPrograma(doItem.get(`${i.programa_id}|${i.chave}`) ?? [])
      return {
        pacienteId: i.paciente_id,
        programaId: i.programa_id,
        procedimentoId: i.procedimento_id,
        nome: i.nome,
        procedimento: i.procedimento,
        sessoesFeitas: feitas.length,
        sessoesRestantes: validas.length - feitas.length,
        valor: i.valor,
        ...telefoneSe(ctx, i.telefone),
      }
    }),
    resumo: { pacientes: new Set(todas.map((i) => i.paciente_id)).size, programas: new Set(todas.map((i) => i.programa_id)).size },
    truncado,
    filtrosEmTexto,
    pacienteIds: [...new Set(linhas.map((i) => i.paciente_id))],
    optIn: optInDe(ctx),
  }
}

/* ------------------------------------------------------------- relatório 6 */

export async function pacientesPorOrigemECampanha(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'pacientes-por-origem-e-campanha'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaPacientesPorOrigemECampanha>, z.input<typeof ResumoPacientesPorOrigemECampanha>>> {
  const filtrosEmTexto = [periodoEmTexto(f.de, f.ate), 'Pela data de cadastro']
  if (f.campanhaId !== undefined) {
    const nome = await nomeOu422(
      c,
      'SELECT nome FROM campanhas WHERE id = $1 AND clinica_id = $2 AND excluida_em IS NULL',
      [f.campanhaId, ctx.clinicaId],
      'Campanha',
    )
    filtrosEmTexto.push(`Campanha: ${nome}`)
  }
  const recorte = await pacientesDoRecorte(c, ctx, { origem: f.origem }, filtrosEmTexto)
  const todas = (await pacientesNovosDaJanela(c, ctx.clinicaId, janela(f.de, f.ate, ctx.fuso), f.campanhaId ?? null)).filter(
    (p) => recorte === null || recorte.has(p.pacienteId),
  )
  const porOrigem = new Map<string, { novos: number; jaAtendidos: number }>()
  for (const p of todas) {
    const o = porOrigem.get(p.origem) ?? { novos: 0, jaAtendidos: 0 }
    porOrigem.set(p.origem, { novos: o.novos + 1, jaAtendidos: o.jaAtendidos + (p.jaAtendida ? 1 : 0) })
  }
  const { linhas, truncado } = cortar(todas, ctx.limite)
  // A receita POR PACIENTE sem os dias do mês corrente que ainda não contam
  // (regra 6, c.10; validação D4). Mês passado conta sempre (a emenda da c.10).
  const naoContam = await diasQueAindaNaoContam(c, ctx.clinicaId, ctx.fuso, ctx.hoje)
  const aguardando = await pagoNosDias(
    c,
    ctx.clinicaId,
    ctx.fuso,
    linhas.map((p) => p.pacienteId),
    naoContam,
  )
  return {
    linhas: linhas.map((p) => ({
      pacienteId: p.pacienteId,
      campanhaId: p.campanhaId,
      nome: p.nome,
      origem: p.origem,
      campanha: p.campanha,
      convertido: p.jaAtendida ? 'sim' : 'nao',
      receita: Dinheiro.deCentavos(p.ltv).menos(Dinheiro.deCentavos(aguardando.get(p.pacienteId) ?? 0n)).centavos.toString(),
      ...telefoneSe(ctx, p.telefone),
    })),
    resumo: {
      pacientes: todas.length,
      convertidos: todas.filter((p) => p.jaAtendida).length,
      porOrigem: [...porOrigem.entries()]
        .sort(([a, x], [b, y]) => y.novos - x.novos || a.localeCompare(b, 'pt-BR'))
        .map(([origem, n]) => ({ origem, ...n })),
    },
    truncado,
    filtrosEmTexto,
    pacienteIds: linhas.map((p) => p.pacienteId),
    optIn: optInDe(ctx),
  }
}

/* ------------------------------------------------------------- relatório 7 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** 29/02 faz aniversário em 28/02 no ano que não é bissexto. */
const bissexto = (ano: number): boolean => (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0
const aniversarioNoAno = (nascimento: string, ano: number): string => {
  const mmdd = nascimento.slice(5, 10)
  return `${String(ano).padStart(4, '0')}-${mmdd === '02-29' && !bissexto(ano) ? '02-28' : mmdd}`
}

/** Os meses (1–12) que `[de, ate]` toca, sem repetir. */
function mesesDoIntervalo(de: string, ate: string): number[] {
  const fora = new Set<number>()
  for (let d = `${de.slice(0, 7)}-01`; d <= ate; d = somarMeses(d, 1)) fora.add(Number(d.slice(5, 7)))
  return [...fora]
}

export async function aniversariantes(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'aniversariantes'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaAniversariante>, z.input<typeof ResumoDePacientes>>> {
  type ComAniversario = Awaited<ReturnType<typeof movimentosDosPacientes>>[number] & { aniversario: string }
  const temAniversario = (p: Awaited<ReturnType<typeof movimentosDosPacientes>>[number]): p is ComAniversario => p.aniversario !== null
  let todas: ComAniversario[]
  let filtrosEmTexto: string[]
  if (f.de !== undefined && f.ate !== undefined) {
    const { de, ate } = f
    // A MESMA leitura do atalho "Aniversariantes", mês a mês do intervalo, e o
    // dia do aniversário dentro de `[de, ate]` (o ano que o intervalo cruza).
    const porMes = []
    for (const mes of mesesDoIntervalo(de, ate)) {
      porMes.push(...(await movimentosDosPacientes(c, ctx.clinicaId, ctx.fuso, { aniversarioNoMes: mes })).filter(temAniversario))
    }
    const anos = Array.from({ length: Number(ate.slice(0, 4)) - Number(de.slice(0, 4)) + 1 }, (_, i) => Number(de.slice(0, 4)) + i)
    const noIntervalo = porMes
      .map((p) => ({ p, dia: anos.map((a) => aniversarioNoAno(p.aniversario, a)).find((d) => d >= de && d <= ate) }))
      .filter((x): x is { p: ComAniversario; dia: string } => x.dia !== undefined)
      .sort((a, b) => (a.dia !== b.dia ? (a.dia < b.dia ? -1 : 1) : a.p.nome !== b.p.nome ? a.p.nome.localeCompare(b.p.nome, 'pt-BR') : a.p.pacienteId < b.p.pacienteId ? -1 : 1))
    todas = noIntervalo.map((x) => x.p)
    filtrosEmTexto = [`Aniversário de ${emDataBr(de).slice(0, 5)} a ${emDataBr(ate).slice(0, 5)}`]
  } else {
    const mes = f.mes ?? 1
    todas = (await movimentosDosPacientes(c, ctx.clinicaId, ctx.fuso, { aniversarioNoMes: mes })).filter(temAniversario)
    filtrosEmTexto = [`Aniversário em ${MESES[mes - 1] ?? ''}`]
  }
  const { linhas, truncado } = cortar(todas, ctx.limite)
  return {
    // O nascimento entra só para o domínio derivar dia/mês e idade (I-38).
    linhas: linhas.map((p) => ({
      pacienteId: p.pacienteId,
      nome: p.nome,
      diaEMes: diaEMesDoAniversario(p.aniversario),
      idade: idadeEm(p.aniversario, ctx.hoje),
      ultimoAtendimento: p.ultimoAtendimento,
      ...telefoneSe(ctx, p.telefone),
    })),
    resumo: { pacientes: todas.length },
    truncado,
    filtrosEmTexto,
    pacienteIds: linhas.map((p) => p.pacienteId),
    optIn: optInDe(ctx),
  }
}
