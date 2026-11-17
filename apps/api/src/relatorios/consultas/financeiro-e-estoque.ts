import type {
  FiltrosDoRelatorio,
  LinhaConta,
  LinhaEntradaDeEstoque,
  LinhaSaldoEmAberto,
  ResumoContas,
  ResumoEntradasDeEstoque,
  ResumoSaldosEmAberto,
} from '@fir/contracts'
import { custoDaQuantidade, Dinheiro, inicioDoDia, Quantidade, somarDias, type MovimentoDeEstoque } from '@fir/domain'
import { UnprocessableEntityException } from '@nestjs/common'
import type pg from 'pg'
import type { z } from 'zod'
import { itensDaAnalise } from '../../estoque/analise.service'
import { movimentosDosItens, quantidadeNaSaida } from '../../estoque/movimentos.repositorio'
import { contasDoPeriodo } from '../../financeiro/contas.service'
import { pacientesQuePodemTerSaldo, saldosDe } from '../../financeiro/saldo.repositorio'
import { type ContextoDaConsulta, cortar, emDataBr, type Linha, periodoEmTexto, type SaidaDaConsulta } from '../consultas'

/**
 * **AS CONSULTAS DE DINHEIRO E ESTOQUE DO T9** (relatórios 9, 10 e 12).
 *
 *  - 9 · `pacientesQuePodemTerSaldo` + `saldosDe` — a leitura de Cobranças, da
 *        Visão do mês e do KPI `saldo_a_receber`, com a mesma opção `ate`;
 *  - 10 · `contasDoPeriodo` (o `SELECT_BASE` da tela Contas);
 *  - 12 · `itensDaAnalise` + `movimentosDosItens` e `custoDaQuantidade`, como
 *        o 11.
 */

/* ------------------------------------------------------------- relatório 9 */

const GERAL = 'Geral'

export async function saldosEmAberto(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'saldos-em-aberto'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaSaldoEmAberto>, z.input<typeof ResumoSaldosEmAberto>>> {
  const corte = f.ate ?? ctx.hoje
  // O saldo do futuro não existe ainda: pedir é erro, não "o de hoje".
  if (corte > ctx.hoje) throw new UnprocessableEntityException('O corte não pode ser depois de hoje.')
  // `ate` < hoje: a POSIÇÃO no fim daquele dia (c.9), como `saldo_a_receber`.
  const instante = corte < ctx.hoje ? inicioDoDia(somarDias(corte, 1), ctx.fuso) : null
  const candidatos = await pacientesQuePodemTerSaldo(c, ctx.clinicaId, instante === null ? {} : { ate: instante })
  const saldos = await saldosDe(c, ctx.clinicaId, candidatos, instante === null ? {} : { ate: instante })

  const minimo = f.valorMinimo === undefined ? null : BigInt(f.valorMinimo)
  const maximo = f.valorMaximo === undefined ? null : BigInt(f.valorMaximo)
  // Uma linha por GRUPO devendo (regra 5); a faixa é do valor do grupo.
  const grupos: { pacienteId: string; programaId: string | null; saldo: Dinheiro }[] = []
  for (const id of candidatos) {
    for (const g of saldos.get(id)?.grupos ?? []) {
      if (g.saldo.centavos <= 0n) continue
      const v = g.saldo.centavos
      if ((minimo !== null && v < minimo) || (maximo !== null && v > maximo)) continue
      grupos.push({ pacienteId: id, programaId: g.programaId, saldo: g.saldo })
    }
  }

  const ids = [...new Set(grupos.map((g) => g.pacienteId))]
  const programas = [...new Set(grupos.map((g) => g.programaId).filter((x): x is string => x !== null))]
  // Em sequência: uma conexão só (a da transação) não roda duas consultas juntas.
  const pacientes = await c.query<{ id: string; nome: string; telefone: string }>(
      'SELECT id, nome, telefone FROM pacientes WHERE clinica_id = $1 AND id = ANY($2::uuid[]) AND ativo',
      [ctx.clinicaId, ids],
  )
  // A adesão pelos procedimentos GRAVADOS no programa (D-2) — o rótulo da tela Programas.
  const nomes = await c.query<{ programa_id: string; nomes: string }>(
      `SELECT programa_id, string_agg(DISTINCT procedimento_nome, ' + ') AS nomes
         FROM itens_do_programa WHERE clinica_id = $1 AND programa_id = ANY($2::uuid[])
        GROUP BY programa_id`,
      [ctx.clinicaId, programas],
  )
  // "Em aberto desde": o primeiro valor aberto do grupo que ainda existia no corte.
  const desde = await c.query<{ paciente_id: string; programa_id: string | null; dia: string }>(
      `SELECT r.paciente_id, r.programa_id, min((r.recebido_em AT TIME ZONE $3)::date)::text AS dia
         FROM recebimentos r
        WHERE r.clinica_id = $1 AND r.paciente_id = ANY($2::uuid[]) AND r.valor_aberto > 0
          AND ($4::timestamptz IS NULL AND r.estornado_em IS NULL
               OR $4::timestamptz IS NOT NULL AND r.recebido_em < $4::timestamptz
                  AND (r.estornado_em IS NULL OR r.estornado_em >= $4::timestamptz))
        GROUP BY r.paciente_id, r.programa_id`,
      [ctx.clinicaId, ids, ctx.fuso, instante],
  )
  const paciente = new Map(pacientes.rows.map((p) => [p.id, p]))
  const adesao = new Map(nomes.rows.map((n) => [n.programa_id, n.nomes]))
  const desdeDe = new Map(desde.rows.map((d) => [`${d.paciente_id}|${d.programa_id ?? ''}`, d.dia]))

  const todas = grupos
    .filter((g) => paciente.has(g.pacienteId))
    .map((g) => ({ ...g, paciente: paciente.get(g.pacienteId)! }))
    .sort((a, b) =>
      a.paciente.nome !== b.paciente.nome
        ? a.paciente.nome.localeCompare(b.paciente.nome, 'pt-BR')
        : a.pacienteId !== b.pacienteId
          ? (a.pacienteId < b.pacienteId ? -1 : 1)
          : // O grupo geral primeiro, depois as adesões.
            (a.programaId ?? '').localeCompare(b.programaId ?? ''),
    )
  const aReceber = todas.reduce((s, g) => s.mais(g.saldo), Dinheiro.zero())

  const filtrosEmTexto = [instante === null ? 'Saldo de agora' : `Saldo no fim de ${emDataBr(corte)}`]
  if (minimo !== null || maximo !== null) filtrosEmTexto.push('Faixa de valor aplicada')

  const { linhas, truncado } = cortar(todas, ctx.limite)
  return {
    linhas: linhas.map((g) => ({
      pacienteId: g.pacienteId,
      programaId: g.programaId,
      nome: g.paciente.nome,
      adesao: g.programaId === null ? GERAL : (adesao.get(g.programaId) ?? GERAL),
      valorAberto: g.saldo.centavos.toString(),
      desde: desdeDe.get(`${g.pacienteId}|${g.programaId ?? ''}`) ?? null,
      ...(ctx.incluirTelefone ? { telefone: g.paciente.telefone } : {}),
    })),
    resumo: { pacientes: new Set(todas.map((g) => g.pacienteId)).size, grupos: todas.length, aReceber: aReceber.centavos.toString() },
    truncado,
    filtrosEmTexto,
    pacienteIds: [...new Set(linhas.map((g) => g.pacienteId))],
    optIn: ctx.incluirTelefone ? ['telefone'] : [],
  }
}

/* ------------------------------------------------------------ relatório 10 */

const SITUACAO_EM_TEXTO = { todas: 'Todas as contas', abertas: 'Só as abertas', pagas: 'Só as pagas' } as const

export async function contas(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'contas'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaConta>, z.input<typeof ResumoContas>>> {
  // A categoria é da lista fechada (`CATEGORIAS_DESP`), e a tela Contas agrupa por ela.
  const todas = (await contasDoPeriodo(c, ctx.clinicaId, f, f.situacao)).filter((x) => f.categoria === undefined || x.categoria === f.categoria)
  let valor = Dinheiro.zero()
  let pago = Dinheiro.zero()
  for (const x of todas) {
    valor = valor.mais(Dinheiro.deCentavos(x.valor))
    if (x.valorPago !== null) pago = pago.mais(Dinheiro.deCentavos(x.valorPago))
  }
  const { linhas, truncado } = cortar(todas, ctx.limite)
  return {
    linhas: linhas.map((x) => ({
      contaId: x.id,
      vencimento: x.vencimento,
      descricao: x.descricao,
      categoria: x.categoria,
      valor: x.valor.toString(),
      pagoEm: x.pagoEm,
      valorPago: x.valorPago === null ? null : x.valorPago.toString(),
      forma: x.forma,
    })),
    resumo: { contas: todas.length, valor: valor.centavos.toString(), valorPago: pago.centavos.toString() },
    truncado,
    filtrosEmTexto: [
      `Vencimento: ${emDataBr(f.de)} a ${emDataBr(f.ate)}`,
      SITUACAO_EM_TEXTO[f.situacao],
      ...(f.categoria === undefined ? [] : [`Categoria: ${f.categoria}`]),
    ],
    pacienteIds: [],
    optIn: [],
  }
}

/* ------------------------------------------------------------ relatório 12 */

/**
 * **O ID DO FORNECEDOR** é `md5(emissor_chave)` como uuid: o emissor da nota
 * (CNPJ, ou o nome normalizado quando não há CNPJ — a mesma chave que a 0017
 * usa para não deixar a nota entrar duas vezes). Não há tabela de fornecedores,
 * e o filtro não pode receber o nome digitado (L-IN-7): o id é derivado, opaco
 * e estável, e só existe se houver nota DESTA clínica com aquele emissor.
 */
export async function fornecedoresDaClinica(c: pg.PoolClient, clinicaId: string): Promise<{ id: string; nome: string }[]> {
  const r = await c.query<{ id: string; nome: string }>(
    `SELECT DISTINCT ON (n.emissor_chave) md5(n.emissor_chave)::uuid::text AS id, n.fornecedor AS nome
       FROM notas_de_entrada n
      WHERE n.clinica_id = $1 AND n.emissor_chave IS NOT NULL AND btrim(n.fornecedor) <> ''
      ORDER BY n.emissor_chave, n.dia DESC, n.registrada_em DESC`,
    [clinicaId],
  )
  return r.rows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

async function entradasDoFornecedor(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  fornecedorId: string,
  filtrosEmTexto: string[],
): Promise<ReadonlySet<string>> {
  const nome = (await fornecedoresDaClinica(c, ctx.clinicaId)).find((x) => x.id === fornecedorId)?.nome
  if (nome === undefined) throw new UnprocessableEntityException('Fornecedor não encontrado nesta clínica.')
  filtrosEmTexto.push(`Fornecedor: ${nome}`)
  const r = await c.query<{ id: string }>(
    `SELECT m.id::text AS id
       FROM movimentos_de_estoque m
       JOIN notas_de_entrada n ON n.id = m.nota_id AND n.clinica_id = m.clinica_id
      WHERE m.clinica_id = $1 AND m.tipo = 'entrada' AND md5(n.emissor_chave)::uuid = $2::uuid`,
    [ctx.clinicaId, fornecedorId],
  )
  return new Set(r.rows.map((l) => l.id))
}

export async function entradasDeEstoque(
  c: pg.PoolClient,
  ctx: ContextoDaConsulta,
  f: FiltrosDoRelatorio<'entradas-de-estoque'>,
): Promise<SaidaDaConsulta<Linha<typeof LinhaEntradaDeEstoque>, z.input<typeof ResumoEntradasDeEstoque>>> {
  const filtrosEmTexto = [periodoEmTexto(f.de, f.ate)]
  const itens = (await itensDaAnalise(c)).filter((i) => f.itemId === undefined || i.id === f.itemId)
  if (f.itemId !== undefined) {
    const item = itens[0]
    if (item === undefined) throw new UnprocessableEntityException('Item não encontrado nesta clínica.')
    filtrosEmTexto.push(`Item: ${item.nome}`)
  }
  // O fornecedor é o EMISSOR da nota da entrada (a chave da 0017), por um id
  // opaco; a entrada sem nota não tem fornecedor e sai do recorte.
  const daNota = f.fornecedorId === undefined ? null : await entradasDoFornecedor(c, ctx, f.fornecedorId, filtrosEmTexto)
  const movs = await movimentosDosItens(
    c,
    itens.map((i) => i.id),
  )
  const escolhidos: { item: (typeof itens)[number]; mov: MovimentoDeEstoque }[] = []
  for (const item of itens) {
    for (const mov of movs.get(item.id) ?? []) {
      if (mov.tipo === 'entrada' && mov.dia >= f.de && mov.dia <= f.ate && (daNota === null || daNota.has(mov.id))) {
        escolhidos.push({ item, mov })
      }
    }
  }
  escolhidos.sort((a, b) => (a.mov.dia === b.mov.dia ? (a.mov.sequencia < b.mov.sequencia ? -1 : 1) : a.mov.dia < b.mov.dia ? -1 : 1))

  // O custo é o DA ENTRADA (centavos por `medida`); sem ele, o do cadastro.
  const custos = await c.query<{ id: string; custo: string | null }>(
    'SELECT id, custo::text AS custo FROM movimentos_de_estoque WHERE clinica_id = $1 AND id = ANY($2::uuid[])',
    [ctx.clinicaId, escolhidos.map((e) => e.mov.id)],
  )
  const custoDe = new Map(custos.rows.map((x) => [x.id, x.custo]))
  let total = Dinheiro.zero()
  const calculados = escolhidos.map(({ item, mov }) => {
    const q = Quantidade.deMilesimos(mov.milesimos, item.medida)
    const unitario = custoDe.get(mov.id) ?? item.custo ?? '0'
    const custo = custoDaQuantidade(q, Dinheiro.deCentavos(BigInt(unitario)))
    total = total.mais(custo)
    return { item, mov, q, custo }
  })

  const { linhas, truncado } = cortar(calculados, ctx.limite)
  return {
    linhas: linhas.map(({ item, mov, q, custo }) => ({
      movimentoId: mov.id,
      itemId: item.id,
      data: mov.dia,
      item: item.nome,
      quantidadeEmEstoque: quantidadeNaSaida(q),
      unidade: item.medida,
      lote: mov.lote,
      custo: custo.centavos.toString(),
    })),
    resumo: { linhas: calculados.length, custo: total.centavos.toString() },
    truncado,
    filtrosEmTexto,
    pacienteIds: [],
    optIn: [],
  }
}
