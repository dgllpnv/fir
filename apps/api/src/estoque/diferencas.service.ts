import type { ReconhecerDiferencas, ResultadoDoReconhecimento } from '@fir/contracts'
import { analiseDaContagem } from '@fir/domain'
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { type Ator, SessaoDeSuporteNaoAssina, pessoaDoAtor } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { ContagensService } from './contagens.service'
import { movimentosDosItens } from './movimentos.repositorio'

type Contexto = { readonly clinicaId: ClinicaId; readonly ator: Ator; readonly fuso: string }

/**
 * **RECONHECER A DIFERENÇA** de itens de uma contagem CONCLUÍDA.
 *
 * Efeito ZERO no saldo, e é por isso que isto não é um movimento: concluir a
 * contagem já fixou o saldo no contado (saldo = última contagem + movimentos
 * depois), e um `ajuste` por cima dobraria a diferença. Aqui só se grava o
 * REGISTRO de que a gestão viu — `diferencas_reconhecidas`, append-only.
 *
 *  - **A diferença é recalculada AQUI**, pela mesma `analiseDaContagem` da
 *    tela. O corpo traz só os ids dos itens: não há valor do cliente para
 *    confiar (nem para forjar).
 *  - **Idempotente**: `ON CONFLICT DO NOTHING` sobre o único
 *    `(contagem, item, lote) NULLS NOT DISTINCT`. Duplo clique e duas abas
 *    gravam UMA linha, e o segundo pedido responde `jaReconhecidas`.
 *  - **Sessão de suporte é recusada**: `pessoaDoAtor` (D-13). Quem reconhece
 *    assina com o nome de uma pessoa da clínica — e NEM o operador que
 *    assina como administradora (`exigePessoa`) passa: só `pessoaDoAtor`.
 *  - Nenhum log aqui: nem de item, nem de quantidade.
 */
@Injectable()
export class DiferencasService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(ContagensService) private readonly contagens: ContagensService,
  ) {}

  async reconhecer(
    ctx: Contexto,
    contagemId: string,
    d: ReconhecerDiferencas,
  ): Promise<ResultadoDoReconhecimento> {
    // `pessoaDoAtor` e NÃO `exigePessoa`: este deixa o operador assinar como a
    // administradora da clínica, e reconhecer uma diferença com o nome dela,
    // vindo do suporte, seria atribuir a ela um ato que não praticou.
    const quem = pessoaDoAtor(ctx.ator)
    if (quem === null) throw new SessaoDeSuporteNaoAssina()
    const pedidos = [...new Set(d.itens)]

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const cont = await c.query<{ situacao: string }>(
        'SELECT situacao FROM contagens_de_estoque WHERE id = $1',
        [contagemId],
      )
      const linha = cont.rows[0]
      if (linha === undefined) throw new NotFoundException('Contagem não encontrada.')
      if (linha.situacao !== 'concluida') {
        throw new ConflictException(
          'Só dá para reconhecer a diferença depois de concluir a contagem.',
        )
      }

      const daLista = await c.query<{ item_id: string; medida: string }>(
        `SELECT ic.item_id, i.medida
           FROM itens_da_contagem ic JOIN itens_de_estoque i ON i.id = ic.item_id
          WHERE ic.contagem_id = $1 AND ic.item_id = ANY($2::uuid[])`,
        [contagemId, pedidos],
      )
      if (daLista.rowCount !== pedidos.length) {
        throw new UnprocessableEntityException('Um dos itens não está nesta contagem.')
      }

      const movs = await movimentosDosItens(
        c,
        daLista.rows.map((x) => x.item_id),
      )

      let reconhecidas = 0
      let jaReconhecidas = 0
      for (const i of daLista.rows) {
        const a = analiseDaContagem(movs.get(i.item_id) ?? [], contagemId, i.medida)
        // Sem esperado (primeira contagem) ou sem diferença: não há o que reconhecer.
        if (a === null || !a.temEsperado || a.diferenca.milesimos === 0n) {
          throw new UnprocessableEntityException('Um dos itens não tem diferença a reconhecer.')
        }
        const r = await c.query(
          `INSERT INTO diferencas_reconhecidas
             (clinica_id, contagem_id, item_id, lote, diferenca_milesimos, reconhecida_por)
           VALUES ($1, $2, $3, NULL, $4, $5)
           ON CONFLICT DO NOTHING`,
          [ctx.clinicaId, contagemId, i.item_id, a.diferenca.milesimos.toString(), quem],
        )
        if ((r.rowCount ?? 0) > 0) reconhecidas++
        else jaReconhecidas++
      }

      const conferencia = await this.contagens.montar(c, ctx, contagemId)
      if (!conferencia.concluida) {
        throw new ConflictException('Só dá para reconhecer a diferença depois de concluir a contagem.')
      }
      return { contagem: conferencia, reconhecidas, jaReconhecidas }
    })
  }
}
