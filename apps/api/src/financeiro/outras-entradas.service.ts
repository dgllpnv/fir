import type {
  CategoriaDeEntradaNaLista,
  ConsultaDeOutrasEntradas,
  CriarCategoriaDeEntrada,
  EditarCategoriaDeEntrada,
  LancarOutraEntrada,
  OutraEntradaNaLista,
} from '@fir/contracts'
import {
  diaCivil,
  exigir,
  fimDoMes,
  instanteDaConclusao,
  janela,
} from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import { type Ator, pessoaDoAtor, SessaoDeSuporteNaoAssina } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { conferirCaixaDoRecebimento } from './recebimentos.avisos'

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
}

type LinhaCrua = {
  id: string
  categoria_id: string
  categoria: string
  em: string
  valor: string
  forma: string
  descricao: string
  registrado_por: string
  estornada: boolean
}

const paraSaida = (l: LinhaCrua): OutraEntradaNaLista => ({
  id: l.id,
  categoriaId: l.categoria_id,
  categoria: l.categoria,
  em: l.em,
  valor: l.valor,
  // O `CHECK` da 0087 restringe a forma às quatro da gaveta; o `as` existe
  // porque o driver devolve `string`.
  forma: l.forma as OutraEntradaNaLista['forma'],
  descricao: l.descricao,
  registradoPor: l.registrado_por,
  estornada: l.estornada,
})

const SELECT_BASE = `
  SELECT oe.id, oe.categoria_id, cat.nome AS categoria,
         ((oe.recebida_em AT TIME ZONE $2)::date)::text AS em,
         oe.valor::text AS valor, oe.forma, oe.descricao, q.nome AS registrado_por,
         (oe.estornada_em IS NOT NULL) AS estornada
    FROM outras_entradas oe
    JOIN categorias_de_entrada cat ON cat.id = oe.categoria_id AND cat.clinica_id = oe.clinica_id
    JOIN pessoas q ON q.id = oe.criado_por AND q.clinica_id = oe.clinica_id
   WHERE oe.clinica_id = $1`

/**
 * **OUTRAS ENTRADAS** (fatia 4.2) — dinheiro que entrou e não é de paciente.
 *
 * O que este serviço NÃO faz, de propósito: não lê nem escreve `recebimentos`,
 * `tarefas` ou `pacientes`. Pagamento de paciente é recebimento; "outra
 * entrada" é só o que não é — e o mesmo dinheiro nunca está nos dois (regra 3).
 *
 * **Descrição é texto livre** (LGPD L3): nunca vai a log nem a mensagem de erro
 * — nenhum `Logger` nem `message` aqui a interpola.
 */
@Injectable()
export class OutrasEntradasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /* ------------------------------------------------------------ categorias */

  async listarCategorias(ctx: Contexto): Promise<readonly CategoriaDeEntradaNaLista[]> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<CategoriaDeEntradaNaLista>(
        `SELECT id, nome, ativa FROM categorias_de_entrada
          WHERE clinica_id = $1 ORDER BY ativa DESC, nome_chave`,
        [ctx.clinicaId],
      )
      return r.rows
    })
  }

  async criarCategoria(
    ctx: Contexto,
    dados: CriarCategoriaDeEntrada,
  ): Promise<CategoriaDeEntradaNaLista> {
    const pessoa = this.pessoa(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      try {
        const r = await c.query<CategoriaDeEntradaNaLista>(
          `INSERT INTO categorias_de_entrada (clinica_id, nome, criada_por)
           VALUES ($1,$2,$3) RETURNING id, nome, ativa`,
          [ctx.clinicaId, dados.nome, pessoa],
        )
        return r.rows[0]!
      } catch (e) {
        if (ehNomeRepetido(e)) throw new ConflictException('Já existe uma categoria com este nome.')
        throw e
      }
    })
  }

  async editarCategoria(
    ctx: Contexto,
    id: string,
    dados: EditarCategoriaDeEntrada,
  ): Promise<CategoriaDeEntradaNaLista> {
    this.pessoa(ctx)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      try {
        const r = await c.query<CategoriaDeEntradaNaLista>(
          `UPDATE categorias_de_entrada
              SET nome = coalesce($2, nome), ativa = coalesce($3, ativa)
            WHERE id = $1 AND clinica_id = $4
          RETURNING id, nome, ativa`,
          [id, dados.nome ?? null, dados.ativa ?? null, ctx.clinicaId],
        )
        const linha = r.rows[0]
        if (linha === undefined) throw new NotFoundException('Categoria não encontrada.')
        return linha
      } catch (e) {
        if (ehNomeRepetido(e)) throw new ConflictException('Já existe uma categoria com este nome.')
        throw e
      }
    })
  }

  /* --------------------------------------------------------------- entradas */

  /**
   * Lança uma outra entrada.
   *
   * **A data é do servidor** (regra 24): a pessoa digita o DIA, o servidor
   * recusa o futuro e escolhe o instante (agora, se for hoje; meio-dia da
   * clínica, se for um dia passado). **Idempotente** por `requisicaoId`: o
   * reenvio devolve a linha que o primeiro gravou, nunca uma segunda.
   *
   * No dia cujo caixa já fechou, a rota responde 409 de confirmação
   * (`CAIXA_FECHADO`) e só grava com `confirmarCaixaFechado: true` — o mesmo
   * aviso do recebimento, porque a entrada muda o esperado de um dia que já foi
   * conferido (e o selo `mudouDepoisDoFechamento` acende).
   */
  async lancar(ctx: Contexto, dados: LancarOutraEntrada): Promise<OutraEntradaNaLista> {
    const pessoa = this.pessoa(ctx)
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, ctx.fuso)
    if (dados.em > hoje) throw new BadRequestException('A data da entrada precisa ser até hoje.')
    const recebidaEm = exigirData(instanteDaConclusao(dados.em, hoje, ctx.fuso, agora))

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const jaExiste = await this.porRequisicao(c, ctx, dados.requisicaoId)
      if (jaExiste !== undefined) return mesmoPedido(jaExiste, dados)

      const cat = await c.query<{ ativa: boolean }>(
        'SELECT ativa FROM categorias_de_entrada WHERE id = $1 AND clinica_id = $2',
        [dados.categoriaId, ctx.clinicaId],
      )
      const categoria = cat.rows[0]
      if (categoria === undefined) throw new NotFoundException('Categoria não encontrada.')
      if (!categoria.ativa) throw new ConflictException('Esta categoria está desativada.')

      // O aviso do caixa fechado, DEPOIS do reenvio (o duplo toque devolve a
      // linha do primeiro, nunca um 409 sobre ela mesma). Outra entrada não tem
      // paciente, então não há duplicidade a avisar — só o caixa, que não
      // depende de valor oculto nenhum (F8).
      await conferirCaixaDoRecebimento(c, {
        clinicaId: ctx.clinicaId,
        valor: dados.valor,
        forma: dados.forma,
        recebidoEm: recebidaEm,
        fuso: ctx.fuso,
        confirmacoes: { confirmarCaixaFechado: dados.confirmarCaixaFechado },
      })

      const inserido = await c.query<{ id: string }>(
        `INSERT INTO outras_entradas
           (clinica_id, categoria_id, recebida_em, valor, forma, descricao, requisicao_id, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (clinica_id, requisicao_id) DO NOTHING
         RETURNING id`,
        [
          ctx.clinicaId,
          dados.categoriaId,
          recebidaEm,
          // `bigint` vira texto no parâmetro: o driver não serializa bigint, e
          // `Number()` perderia precisão acima de 2^53 (regra 1).
          dados.valor.toString(),
          dados.forma,
          dados.descricao,
          dados.requisicaoId,
          pessoa,
        ],
      )
      const nova = inserido.rows[0]
      if (nova === undefined) {
        // Outra requisição com a MESMA chave ganhou a corrida: devolve o original.
        const existente = await this.porRequisicao(c, ctx, dados.requisicaoId)
        if (existente === undefined) {
          throw new ConflictException('Não consegui registrar a entrada. Tente de novo.')
        }
        return mesmoPedido(existente, dados)
      }
      return this.lerUma(c, ctx, nova.id)
    })
  }

  async listar(
    ctx: Contexto,
    q: ConsultaDeOutrasEntradas,
  ): Promise<readonly OutraEntradaNaLista[]> {
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)
    // Janela semiaberta `[início, fim)` no fuso da CLÍNICA (regra 23).
    const j =
      q.mes !== undefined
        ? janela(`${q.mes}-01`, fimDoMes(q.mes), ctx.fuso)
        : janela(q.dia ?? hoje, q.dia ?? hoje, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaCrua>(
        `${SELECT_BASE}
           AND oe.recebida_em >= $3 AND oe.recebida_em < $4
           AND ($5::boolean OR oe.estornada_em IS NULL)
         ORDER BY oe.recebida_em DESC, oe.criado_em DESC
         LIMIT 500`,
        [ctx.clinicaId, ctx.fuso, j.de, j.ate, q.incluirEstornadas ?? false],
      )
      return r.rows.map(paraSaida)
    })
  }

  /**
   * Estorna — **por marca, nunca apaga** (regra 20). Só quem pode lançar; e a
   * sessão de suporte não assina estorno de dinheiro.
   */
  async estornar(ctx: Contexto, id: string): Promise<void> {
    this.pessoa(ctx)
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query(
        `UPDATE outras_entradas SET estornada_em = now()
          WHERE id = $1 AND clinica_id = $2 AND estornada_em IS NULL`,
        [id, ctx.clinicaId],
      )
      if (r.rowCount === 1) return
      const existe = await c.query('SELECT 1 FROM outras_entradas WHERE id = $1 AND clinica_id = $2', [
        id,
        ctx.clinicaId,
      ])
      if (existe.rowCount === 0) throw new NotFoundException('Entrada não encontrada.')
      throw new ConflictException('Esta entrada já foi estornada.')
    })
  }

  /* ---------------------------------------------------------------- apoio */

  /** Dinheiro é ritual da clínica (D-13): a sessão de suporte não assina. */
  private pessoa(ctx: Contexto): string {
    const p = pessoaDoAtor(ctx.ator)
    if (p === null) throw new SessaoDeSuporteNaoAssina()
    return p
  }

  private async porRequisicao(
    c: pg.PoolClient,
    ctx: Contexto,
    requisicaoId: string,
  ): Promise<OutraEntradaNaLista | undefined> {
    const r = await c.query<LinhaCrua>(`${SELECT_BASE} AND oe.requisicao_id = $3`, [
      ctx.clinicaId,
      ctx.fuso,
      requisicaoId,
    ])
    const linha = r.rows[0]
    return linha === undefined ? undefined : paraSaida(linha)
  }

  private async lerUma(
    c: pg.PoolClient,
    ctx: Contexto,
    id: string,
  ): Promise<OutraEntradaNaLista> {
    const r = await c.query<LinhaCrua>(`${SELECT_BASE} AND oe.id = $3`, [ctx.clinicaId, ctx.fuso, id])
    const linha = r.rows[0]
    if (linha === undefined) throw new NotFoundException('Entrada não encontrada.')
    return paraSaida(linha)
  }
}

/**
 * O reenvio da MESMA `requisicaoId` só devolve o original se for o MESMO
 * pedido. Outra categoria, outro valor, outra forma ou outro dia com a mesma
 * chave é erro de cliente (formulário reaproveitado), não duplo toque — e
 * devolver o original em silêncio esconderia que o novo lançamento não entrou.
 */
function mesmoPedido(existente: OutraEntradaNaLista, dados: LancarOutraEntrada): OutraEntradaNaLista {
  const igual =
    existente.categoriaId === dados.categoriaId &&
    existente.valor === dados.valor.toString() &&
    existente.forma === dados.forma &&
    existente.em === dados.em
  if (!igual) {
    throw new ConflictException(
      'Esta requisição já foi usada para outra entrada. Abra o formulário de novo.',
    )
  }
  return existente
}

/** `Result` do domínio vira `400` na borda. Erro é valor dentro, exceção fora. */
function exigirData(r: ReturnType<typeof instanteDaConclusao>): Date {
  try {
    return exigir(r)
  } catch {
    throw new BadRequestException('A data da entrada precisa ser até hoje.')
  }
}

/** `23505` no `UNIQUE (clinica_id, nome_chave)` da categoria. */
const ehNomeRepetido = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  (e as { code?: string }).code === '23505' &&
  String((e as { constraint?: string }).constraint ?? '') === 'categoria_nome_unico'
