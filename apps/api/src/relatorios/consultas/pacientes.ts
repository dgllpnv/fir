import type {
  FiltrosDoRelatorio,
  LinhaAniversariante,
  LinhaPacientesMaiorLtv,
  LinhaPacientesPorOrigemECampanha,
  LinhaPacientesPorProcedimento,
  LinhaPacientesQueIndicaram,
  LinhaPacientesSemAtendimento,
  ResumoDePacientes,
  ResumoPacientesPorOrigemECampanha,
  ResumoPacientesPorProcedimento,
  ResumoPacientesQueIndicaram,
} from '@fir/contracts'
import { diaEMesDoAniversario, Dinheiro, idadeEm, janela, somarMeses, TIPO_SESSAO } from '@fir/domain'
import type pg from 'pg'
import type { z } from 'zod'
import { comprasDosPacientes, movimentosDosPacientes } from '../../pacientes/pacientes.service'
import { diasQueAindaNaoContam, pacientesNovosDaJanela, pagoNosDias } from '../../painel-geral/novos-pacientes'
import { indicadorasDaJanela, receitaNoPeriodo } from '../../painel-geral/quem-mais-indica'
import { sessoesDoPrograma } from '../../programas/leitura.service'
import { type ContextoDaConsulta, cortar, type Linha, nomeOu422, periodoEmTexto, type SaidaDaConsulta } from '../consultas'

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
  const corte = somarMeses(ctx.hoje, -f.semAtendimentoHaMeses)
  const todas = (await movimentosDosPacientes(c, ctx.clinicaId, ctx.fuso, { comMovimento: true })).filter(
    (p): p is typeof p & { ultimoAtendimento: string } => p.ultimoAtendimento !== null && p.ultimoAtendimento < corte,
  )
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
    filtrosEmTexto: [`Sem atendimento há ${meses(f.semAtendimentoHaMeses)}`],
    pacienteIds: linhas.map((p) => p.pacienteId),
    optIn: optInDe(ctx),
  }
}

/* ------------------------------------------------------------- relatório 3 */

export async function pacientesMaiorLtv(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'pacientes-maior-ltv'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaPacientesMaiorLtv>, z.input<typeof ResumoDePacientes>>> {
  const todas = [...(await comprasDosPacientes(c, ctx.clinicaId, ctx.fuso, null))].sort((a, b) =>
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
    filtrosEmTexto: [`Os ${f.quantos} maiores LTV`],
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
  const todas = await indicadorasDaJanela(c, ctx.clinicaId, j, null)
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
}

export async function pacientesPorProcedimento(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'pacientes-por-procedimento'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaPacientesPorProcedimento>, z.input<typeof ResumoPacientesPorProcedimento>>> {
  const filtrosEmTexto = [f.incluirEncerrados ? 'Programas ativos e encerrados' : 'Só programas ativos']
  if (f.procedimentoId !== undefined) {
    const nome = await nomeOu422(
      c,
      'SELECT nome FROM procedimentos WHERE id = $1 AND clinica_id = $2',
      [f.procedimentoId, ctx.clinicaId],
      'Procedimento',
    )
    filtrosEmTexto.push(`Procedimento: ${nome}`)
  }
  // O nome do procedimento é o GRAVADO no item (D-2), como na tela Programas.
  const itens = await c.query<ItemDoPrograma>(
    `SELECT p.id AS programa_id, p.paciente_id, pa.nome, pa.telefone, i.chave,
            i.procedimento_id, i.procedimento_nome AS procedimento, i.valor::text AS valor
       FROM programas p
       JOIN pacientes pa ON pa.id = p.paciente_id AND pa.clinica_id = p.clinica_id
       JOIN itens_do_programa i ON i.programa_id = p.id AND i.clinica_id = p.clinica_id
      WHERE p.clinica_id = $1 AND p.excluido_em IS NULL AND pa.ativo
        AND ($2::boolean OR p.situacao = 'ativo')
        AND ($3::uuid IS NULL OR i.procedimento_id = $3::uuid)
      ORDER BY pa.nome, pa.id, p.inicio, p.id, i.ordem, i.chave`,
    [ctx.clinicaId, f.incluirEncerrados, f.procedimentoId ?? null],
  )
  const programas = [...new Set(itens.rows.map((i) => i.programa_id))]
  const sessoes = await c.query<{ programa_id: string; item_chave: string | null; status: string }>(
    `SELECT programa_id, item_chave, status FROM tarefas
      WHERE clinica_id = $1 AND excluida_em IS NULL AND programa_id = ANY($2::uuid[]) AND tipo = $3`,
    [ctx.clinicaId, programas, TIPO_SESSAO],
  )
  const doItem = new Map<string, { status: string }[]>()
  for (const s of sessoes.rows) {
    const k = `${s.programa_id}|${s.item_chave ?? ''}`
    doItem.set(k, [...(doItem.get(k) ?? []), s])
  }

  const { linhas, truncado } = cortar(itens.rows, ctx.limite)
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
    resumo: { pacientes: new Set(itens.rows.map((i) => i.paciente_id)).size, programas: programas.length },
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
  const todas = await pacientesNovosDaJanela(c, ctx.clinicaId, janela(f.de, f.ate, ctx.fuso), f.campanhaId ?? null)
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

export async function aniversariantes(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'aniversariantes'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaAniversariante>, z.input<typeof ResumoDePacientes>>> {
  const todas = (await movimentosDosPacientes(c, ctx.clinicaId, ctx.fuso, { aniversarioNoMes: f.mes })).filter(
    (p): p is typeof p & { aniversario: string } => p.aniversario !== null,
  )
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
    filtrosEmTexto: [`Aniversário em ${MESES[f.mes - 1] ?? ''}`],
    pacienteIds: linhas.map((p) => p.pacienteId),
    optIn: optInDe(ctx),
  }
}
