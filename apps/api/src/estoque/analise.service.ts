import type { AnaliseDoEstoque, ItemNaAnalise } from '@fir/contracts'
import { Quantidade, analiseDoPeriodo, somarDias } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type { Ator, PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from './dia-da-clinica'
import { movimentosDosItens, quantidadeNaSaida } from './movimentos.repositorio'

/**
 * A ABA **ANÁLISE** — "o que saiu sem registro", item a item.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA ROTA DEVOLVE O ESPERADO, E ISSO É CORRETO
 *
 * Parece contradizer a regra 14, e não contradiz: o que ela devolve é o
 * esperado de contagens **já concluídas**. A regra 14 proíbe o esperado de
 * atravessar **antes do fechamento** da contagem em que alguém vai contar — e
 * uma contagem fechada não pode mais ser influenciada.
 *
 * É a mesma classificação de `GET /v1/caixa/ultimos`, que mostra a `diferenca`
 * dos dias já fechados: a conferência às cegas é sobre o instante em que a
 * pessoa conta, não sobre o histórico que a clínica precisa ler.
 *
 * **O que esta rota NÃO pode fazer** é alcançar uma contagem ABERTA — e ela não
 * alcança por construção: `analiseDoPeriodo` só compara grupos de movimento de
 * `contagem`, e um rascunho aberto não gerou movimento nenhum. O rascunho mora
 * em `contado_na_contagem`, que esta consulta não lê.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
}

type LinhaDeItem = {
  id: string
  nome: string
  categoria: string
  medida: string
  controla_validade: boolean
  custo: string | null
  local_id: string | null
  local: string | null
}

@Injectable()
export class AnaliseService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async doPeriodo(
    ctx: Contexto,
    consulta: { de?: string | undefined; ate?: string | undefined },
  ): Promise<AnaliseDoEstoque> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    // O padrão é o mês corrido que termina hoje. As duas bordas vêm do
    // SERVIDOR, no fuso da clínica (regra 24): calculadas no navegador, o
    // computador de balcão com a data errada analisaria outro período.
    const ate = consulta.ate ?? hoje
    const de = consulta.de ?? somarDias(ate, -30)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeItem>(
        `SELECT i.id, i.nome, i.categoria, i.medida, i.controla_validade,
                i.custo::text AS custo, i.local_id, l.nome AS local
           FROM itens_de_estoque i
           LEFT JOIN locais_de_estoque l ON l.id = i.local_id
          WHERE i.excluido_em IS NULL AND i.ativo
          ORDER BY i.nome`,
      )
      const movs = await movimentosDosItens(
        c,
        r.rows.map((l) => l.id),
      )

      let valorDaFalta = 0n
      let itensComFalta = 0
      let itensSemContagens = 0

      const itens = r.rows.map((l): ItemNaAnalise => {
        const a = analiseDoPeriodo(movs.get(l.id) ?? [], de, ate, l.medida)
        const q = (m: bigint) => quantidadeNaSaida(Quantidade.deMilesimos(m, l.medida))
        const cabecalho = {
          itemId: l.id,
          nome: l.nome,
          categoria: l.categoria,
          medida: l.medida,
          controlaValidade: l.controla_validade,
          localId: l.local_id,
          local: l.local,
        }
        if (a === null || !a.temEsperado) {
          itensSemContagens++
          return {
            ...cabecalho,
            deDia: null,
            ateDia: null,
            inicialEmEstoque: null,
            entradasEmEstoque: null,
            saidasEmEstoque: null,
            ajustesEmEstoque: null,
            esperadoEmEstoque: null,
            finalEmEstoque: null,
            diferencaEmEstoque: null,
            valorDaFalta: null,
          }
        }
        const falta = a.diferenca.milesimos < 0n ? -a.diferenca.milesimos : 0n
        // Milésimos × centavos / mil = centavos. A divisão é por `MEDIDA_INTEIRA`
        // e vem depois da multiplicação, de propósito: dividir antes perderia o
        // custo de meia ampola.
        const valor = (falta * BigInt(l.custo ?? '0')) / 1_000n
        if (falta > 0n) {
          itensComFalta++
          valorDaFalta += valor
        }
        return {
          ...cabecalho,
          deDia: a.deDia,
          ateDia: a.ateDia,
          inicialEmEstoque: q(a.anterior?.quantidade.milesimos ?? 0n),
          entradasEmEstoque: q(a.entradas.milesimos),
          saidasEmEstoque: q(a.saidas.milesimos),
          ajustesEmEstoque: q(a.ajustes.milesimos),
          esperadoEmEstoque: q(a.esperado.milesimos),
          finalEmEstoque: q(a.contado.milesimos),
          diferencaEmEstoque: q(a.diferenca.milesimos),
          valorDaFalta: valor.toString(),
        }
      })

      return {
        de,
        ate,
        itens,
        itensComFalta,
        valorDaFalta: valorDaFalta.toString(),
        itensSemContagens,
      }
    })
  }
}
