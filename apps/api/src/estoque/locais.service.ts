import type {
  EditarLocalEstoque,
  ListaDeLocais,
  LocalNaLista,
  SalvarLocalEstoque,
} from '@fir/contracts'
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * **`salvarLocalEstoque`** — onde o item fica na clínica.
 *
 * Sala de estoque, sala de enfermagem, geladeira, sala da doutora. A lista de
 * contagem sai agrupada por local, como um roteiro (MANUAL cap. 12), e é por
 * isso que ele existe antes da contagem.
 *
 * `estoque.gerir` nas duas escritas, como no protótipo — locais são cadastro,
 * não operação do dia.
 */

type Contexto = { readonly clinicaId: ClinicaId; readonly ator: PessoaId }

type LinhaDeLocal = {
  id: string
  nome: string
  unidade_id: string | null
  ativo: boolean
  itens: string
}

/**
 * A contagem de itens por local sai do SERVIDOR.
 *
 * Contá-la na tela exigiria baixar o catálogo inteiro de estoque para desenhar
 * uma lista de cinco linhas — e é a mesma razão pela qual `pacientesAtivos` do
 * catálogo de procedimentos é calculado aqui.
 */
const SELECT_LOCAL = `
  SELECT l.id, l.nome, l.unidade_id, l.ativo,
         (SELECT count(*) FROM itens_de_estoque i
           WHERE i.local_id = l.id AND i.excluido_em IS NULL)::text AS itens
    FROM locais_de_estoque l
   WHERE l.excluido_em IS NULL`

const paraSaida = (l: LinhaDeLocal): LocalNaLista => ({
  id: l.id,
  nome: l.nome,
  unidadeId: l.unidade_id,
  ativo: l.ativo,
  itens: Number(l.itens),
})

@Injectable()
export class LocaisService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listar(ctx: Contexto): Promise<ListaDeLocais> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeLocal>(`${SELECT_LOCAL} ORDER BY l.ativo DESC, l.nome`)
      return { locais: r.rows.map(paraSaida) }
    })
  }

  async criar(ctx: Contexto, d: SalvarLocalEstoque): Promise<LocalNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      let id: string
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO locais_de_estoque (clinica_id, nome, unidade_id, ativo, criado_por)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [ctx.clinicaId, d.nome, d.unidadeId ?? null, d.ativo, ctx.ator],
        )
        id = r.rows[0]!.id
      } catch (e) {
        throw traduzirNomeRepetido(e, d.nome)
      }
      return umPorId(c, id)
    })
  }

  /**
   * Edição PARCIAL com `coalesce` — mesma razão de `unidades` e de
   * `procedimentos`: um `PATCH { ativo: false }` com o esquema de criação
   * reescreveria `unidade_id` para nulo, e o local da geladeira da Pituba
   * passaria a valer para as duas unidades.
   *
   * **Desativar não é excluir** (regra 20): `itens_de_estoque.local_id` aponta
   * para ele, e o movimento antigo foi feito num item que morava ali.
   */
  async editar(ctx: Contexto, id: string, d: EditarLocalEstoque): Promise<LocalNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      let afetadas: number
      try {
        const r = await c.query(
          `UPDATE locais_de_estoque
              SET nome       = coalesce($2, nome),
                  unidade_id = CASE WHEN $4::boolean THEN $3 ELSE unidade_id END,
                  ativo      = coalesce($5, ativo)
            WHERE id = $1 AND excluido_em IS NULL`,
          [
            id,
            d.nome ?? null,
            d.unidadeId ?? null,
            // `unidadeId: null` no corpo significa "tire a unidade", e
            // `ausente` significa "não toque". `coalesce` sozinho confunde os
            // dois, e aí nunca haveria como desvincular um local da unidade.
            'unidadeId' in d,
            d.ativo ?? null,
          ],
        )
        afetadas = r.rowCount ?? 0
      } catch (e) {
        throw traduzirNomeRepetido(e, d.nome ?? '')
      }
      // Fora do `try`: um 404 lançado dentro atravessaria a tradução, que o
      // devolveria intacto — funciona hoje e deixa de funcionar quando a
      // tradução ganhar um segundo caso.
      if (afetadas === 0) throw new NotFoundException('Local de estoque não encontrado.')
      return umPorId(c, id)
    })
  }
}

async function umPorId(c: pg.PoolClient, id: string): Promise<LocalNaLista> {
  const r = await c.query<LinhaDeLocal>(`${SELECT_LOCAL} AND l.id = $1`, [id])
  const l = r.rows[0]
  if (l === undefined) throw new NotFoundException('Local de estoque não encontrado.')
  return paraSaida(l)
}

/**
 * `23505` em `locais_nome_unico` vira 409.
 *
 * A recusa vem do ÍNDICE, que compara o nome NORMALIZADO por unidade e usa
 * `NULLS NOT DISTINCT`: duas "Geladeira" sem unidade colidem, o que é o ponto —
 * a clínica de um endereço só é justamente a que teria duas.
 */
function traduzirNomeRepetido(e: unknown, nome: string): unknown {
  const erro = e as { code?: string; constraint?: string }
  if (erro.code === '23505' && erro.constraint === 'locais_nome_unico') {
    return new ConflictException(`Já existe um local chamado "${nome}" nesta unidade.`)
  }
  return e
}
