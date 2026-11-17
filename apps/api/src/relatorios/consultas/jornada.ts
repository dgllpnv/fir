import type {
  FiltrosDoRelatorio,
  LinhaFaltaOuDesmarcacao,
  LinhaOrcamento,
  ResumoFaltasEDesmarcacoes,
  ResumoOrcamentos,
  SituacaoDoRecontato,
} from '@fir/contracts'
import { Dinheiro, faltaMadura, janela, recontatoEmAteDoisDias, somarDias } from '@fir/domain'
import type pg from 'pg'
import type { z } from 'zod'
import { historicosDaJanela } from '../../jornada/historicos-da-janela'
import { cartoesDosPagamentos, orcamentosDaJanela } from '../../jornada/orcamentos-da-janela'
import { contarConversaoDeOrcamentos } from '../../painel-geral/metricas-diarias'
import { pagamentosDeOrcamentoDosDiasQueContam } from '../../painel-geral/totais-de-pacientes'
import { type ContextoDaConsulta, cortar, type Linha, periodoEmTexto, type SaidaDaConsulta } from '../consultas'

/**
 * **AS CONSULTAS DA JORNADA DO T9** (relatórios 13 e 14).
 *
 *  - 13 · `orcamentosDaJanela` (o passo "Orçamentos" do funil, só evento vivo),
 *        `contarConversaoDeOrcamentos` (enviados e fechados do Painel) e
 *        `pagamentosDeOrcamentoDosDiasQueContam` (o `orc_valor` do Painel e do
 *        KPI, tarefa a tarefa, números c.3): a coluna soma o resumo;
 *  - 14 · `historicosDaJanela` + `recontatoEmAteDoisDias` + `faltaMadura` — a
 *        leitura e a regra do KPI `faltas_recontatadas` (I-11).
 */

/* ------------------------------------------------------------ relatório 13 */

type PagamentoSemCartao = { id: string; paciente_id: string; nome: string | null; dia: string }

export async function orcamentos(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'orcamentos'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaOrcamento>, z.input<typeof ResumoOrcamentos>>> {
  const j = janela(f.de, f.ate, ctx.fuso)
  // Em sequência: uma conexão só (a da transação) não roda duas consultas juntas.
  // "Valor fechado" = `orc_valor` (protótipo): os "Pagamento de orçamento"
  // concluídos no período, SÓ nos dias que contam (regra 6). Nunca o orçado
  // (regra 4), nunca a entrada gravada no próprio cartão.
  const pagamentos = await pagamentosDeOrcamentoDosDiasQueContam(c, ctx.clinicaId, f, ctx.fuso, ctx.hoje)
  const cartaoDe = await cartoesDosPagamentos(
    c,
    ctx.clinicaId,
    pagamentos.map((p) => p.tarefaId),
  )
  const todos = await orcamentosDaJanela(c, ctx.clinicaId, j, ctx.fuso, [...new Set(cartaoDe.values())])
  const funil = await contarConversaoDeOrcamentos(c, ctx.clinicaId, j)

  // Cada pagamento vai para a linha do seu cartão; o sem cartão vira linha própria.
  const doCartao = new Map<string, Dinheiro>()
  const semCartao = new Map<string, Dinheiro>()
  let total = Dinheiro.zero()
  for (const p of pagamentos) {
    total = total.mais(p.valor)
    const k = cartaoDe.get(p.tarefaId)
    if (k === undefined) semCartao.set(p.tarefaId, (semCartao.get(p.tarefaId) ?? Dinheiro.zero()).mais(p.valor))
    else doCartao.set(k, (doCartao.get(k) ?? Dinheiro.zero()).mais(p.valor))
  }
  const avulsos =
    semCartao.size === 0
      ? []
      : (
          await c.query<PagamentoSemCartao>(
            `SELECT t.id::text AS id, t.paciente_id::text AS paciente_id,
                    CASE WHEN pa.ativo THEN pa.nome END AS nome,
                    ((t.concluida_em AT TIME ZONE $3)::date)::text AS dia
               FROM tarefas t
               JOIN pacientes pa ON pa.id = t.paciente_id AND pa.clinica_id = t.clinica_id
              WHERE t.clinica_id = $1 AND t.id = ANY($2::uuid[])
              ORDER BY t.concluida_em, t.id`,
            [ctx.clinicaId, [...semCartao.keys()], ctx.fuso],
          )
        ).rows

  // Paciente desativada: a linha fica (o Painel a conta), sem nome e sem ids (appsec M2).
  const anonima = (nome: string | null, tarefaId: string, pacienteId: string) =>
    nome === null ? { tarefaId: null, pacienteId: null, nome: null } : { tarefaId, pacienteId, nome }
  const todas: Linha<typeof LinhaOrcamento>[] = [
    ...todos.map((o) => ({
      ...anonima(o.nome, o.tarefaId, o.pacienteId),
      data: o.dia,
      etapa: o.etapa,
      motivo: o.motivo,
      valorOrcamento: o.valorOrcamento === null ? null : o.valorOrcamento.toString(),
      valorFechado: doCartao.get(o.tarefaId)?.centavos.toString() ?? null,
    })),
    ...avulsos.map((a) => ({
      ...anonima(a.nome, a.id, a.paciente_id),
      data: a.dia,
      etapa: 'fechado',
      motivo: null,
      valorOrcamento: null,
      valorFechado: semCartao.get(a.id)!.centavos.toString(),
    })),
  ]

  const { linhas, truncado } = cortar(todas, ctx.limite)
  return {
    linhas,
    resumo: {
      orcamentos: todos.length,
      enviados: funil.enviados,
      fechados: funil.fechados,
      // Σ da coluna, e o `valorDosOrcamentosPagos` do Painel no período: o mesmo SQL.
      valorFechado: total.centavos.toString(),
    },
    truncado,
    filtrosEmTexto: [periodoEmTexto(f.de, f.ate), 'Pela data do orçamento ou do pagamento do orçamento'],
    pacienteIds: [...new Set(linhas.flatMap((o) => (typeof o.pacienteId === 'string' ? [o.pacienteId] : [])))],
    optIn: [],
  }
}

/* ------------------------------------------------------------ relatório 14 */

export async function faltasEDesmarcacoes(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'faltas-e-desmarcacoes'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaFaltaOuDesmarcacao>, z.input<typeof ResumoFaltasEDesmarcacoes>>> {
  const cartoes = await historicosDaJanela(c, ctx.clinicaId, janela(f.de, f.ate, ctx.fuso))
  const todas: (Linha<typeof LinhaFaltaOuDesmarcacao> & { em: string; cartao: string; madura: boolean; emAteDoisDias: boolean })[] = []
  for (const k of cartoes) {
    for (const x of recontatoEmAteDoisDias(k.historico, ctx.fuso)) {
      // O mesmo recorte do KPI: o DIA da falta em `[de, ate]`.
      if (x.dia < f.de || x.dia > f.ate) continue
      const madura = faltaMadura(x.dia, ctx.hoje)
      const situacao: z.infer<typeof SituacaoDoRecontato> =
        x.recontatadaNoDia === null
          ? madura
            ? 'sem-recontato'
            : 'aguardando-prazo'
          : x.recontatadaNoDia <= somarDias(x.dia, 2)
            ? 'recontatada'
            : 'recontatada-depois'
      todas.push({
        // Sem o id do cartão na linha anônima: ele reabriria a paciente pela rota de tarefa (appsec M2).
        tarefaId: k.paciente === null ? null : k.tarefaId,
        cartao: k.tarefaId,
        pacienteId: k.paciente === null ? null : k.pacienteId,
        nome: k.paciente,
        data: x.dia,
        motivo: x.motivo,
        situacao,
        recontatadaEm: x.recontatadaNoDia,
        ...(ctx.incluirTelefone && k.telefone !== null ? { telefone: k.telefone } : {}),
        em: x.em,
        madura,
        emAteDoisDias: x.emAteDoisDias,
      })
    }
  }
  todas.sort((a, b) => (a.em === b.em ? (a.cartao < b.cartao ? -1 : 1) : a.em < b.em ? -1 : 1))
  const maduras = todas.filter((x) => x.madura)

  const { linhas, truncado } = cortar(todas, ctx.limite)
  return {
    linhas: linhas.map(({ em: _em, cartao: _c, madura: _m, emAteDoisDias: _e, ...l }) => l),
    resumo: {
      faltas: todas.length,
      maduras: maduras.length,
      recontatadasEmAteDoisDias: maduras.filter((x) => x.emAteDoisDias).length,
      aguardandoPrazo: todas.filter((x) => x.situacao === 'aguardando-prazo').length,
    },
    truncado,
    filtrosEmTexto: [periodoEmTexto(f.de, f.ate)],
    pacienteIds: [...new Set(linhas.flatMap((l) => (l.pacienteId === null || l.pacienteId === undefined ? [] : [l.pacienteId])))],
    optIn: ctx.incluirTelefone ? ['telefone'] : [],
  }
}
