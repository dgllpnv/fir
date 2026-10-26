import type {
  EditarProcedimento,
  ListaDeProcedimentos,
  ProcedimentoNaLista,
  SalvarProcedimento,
} from '@fir/contracts'
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'

/**
 * O CATÁLOGO DE PROCEDIMENTOS — a aba `Planos` da v20, com o nome certo.
 *
 * A leitura é `programas` e a escrita é `config`: quem monta o programa
 * precisa ver o catálogo, e quem edita o catálogo está mexendo numa
 * configuração da clínica. É a divisão que o protótipo já faz
 * (`VIEW_PERM.catalogo = 'config'`, e a lista chega pelo `carregar`).
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
}

type LinhaDeProcedimento = {
  id: string
  nome: string
  sessoes_sugeridas: number
  intervalo_sugerido_dias: number
  rotulo_sessao: string
  responsavel_id: string | null
  valor_por_sessao: string | null
  retorno_quantidade: number | null
  retorno_unidade: string
  retorno_antecedencia_dias: number
  retorno_responsavel_id: string | null
  insumo_padrao_id: string | null
  insumo_padrao_milesimos: string | null
  insumo_padrao_unidade: string | null
  ativo: boolean
  pacientes_ativos: string
}

type LinhaDeInsumo = {
  procedimento_id: string
  item_id: string
  milesimos: string
  unidade: string
}

/**
 * A lista, com a CONTAGEM DE PACIENTES ATIVOS por procedimento.
 *
 * "1 paciente ativo" é o que a tela mostra, medido no protótipo rodando.
 * Contar no front exigiria baixar todos os programas da clínica para desenhar
 * uma lista de sete linhas.
 *
 * "Ativo" aqui é o do protótipo (`statsAdesao`): programa não encerrado que
 * ainda tem sessão ABERTA. Um programa cujas sessões acabaram todas está
 * concluído, e contá-lo faria o número nunca descer.
 */
const SELECT_BASE = `
  SELECT p.id, p.nome, p.sessoes_sugeridas, p.intervalo_sugerido_dias, p.rotulo_sessao,
         p.responsavel_id, p.valor_por_sessao::text AS valor_por_sessao,
         p.retorno_quantidade, p.retorno_unidade, p.retorno_antecedencia_dias,
         p.retorno_responsavel_id,
         p.insumo_padrao_id, p.insumo_padrao_milesimos::text AS insumo_padrao_milesimos,
         p.insumo_padrao_unidade, p.ativo,
         (SELECT count(DISTINCT pr.paciente_id)
            FROM itens_do_programa i
            JOIN programas pr ON pr.id = i.programa_id
                             AND pr.excluido_em IS NULL AND pr.situacao = 'ativo'
           WHERE i.procedimento_id = p.id
             AND EXISTS (SELECT 1 FROM tarefas t
                          WHERE t.programa_id = pr.id AND t.item_chave = i.chave
                            AND t.tipo = 'Sessão de plano' AND t.status = 'aberta'
                            AND t.excluida_em IS NULL))::text AS pacientes_ativos
    FROM procedimentos p
   WHERE p.excluido_em IS NULL`

@Injectable()
export class CatalogoService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listar(ctx: Contexto): Promise<ListaDeProcedimentos> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeProcedimento>(`${SELECT_BASE} ORDER BY p.nome`)
      const insumos = await this.insumosDe(
        c,
        r.rows.map((x) => x.id),
      )
      return { itens: r.rows.map((l) => paraSaida(l, insumos.get(l.id) ?? [])) }
    })
  }

  async criar(ctx: Contexto, dados: SalvarProcedimento): Promise<ProcedimentoNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const id = await this.gravar(c, ctx, dados, null)
      return this.umPorId(c, id)
    })
  }

  /**
   * A edição é PARCIAL e mescla sobre a linha atual.
   *
   * O corpo chega por `EditarProcedimento`, sem `.default()` nenhum, de modo
   * que ausente signifique ausente. Com `SalvarProcedimento`, um `PATCH
   * { ativo: false }` reescreveria `rotuloSessao` para "Sessão" e apagaria os
   * descartáveis — sem erro nenhum, e a clínica descobriria na próxima sessão.
   */
  async editar(
    ctx: Contexto,
    id: string,
    dados: EditarProcedimento,
  ): Promise<ProcedimentoNaLista> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const atual = await this.umPorId(c, id)
      await this.gravar(c, ctx, mesclar(atual, dados), id)
      return this.umPorId(c, id)
    })
  }

  /**
   * SOFT DELETE, com DUAS recusas — e a segunda é o buraco que o épico 3
   * deixou.
   *
   * O protótipo e o `Code.gs` conferem só as adesões. Uma PROPOSTA VIVA
   * (`tarefas.programa_orcado`, etapa `orcamento`) também aponta para o
   * procedimento, e excluí-lo transforma o `fechar` daquele orçamento num
   * erro: a paciente aceitou, a recepção não consegue fechar, e o motivo está
   * escondido num `jsonb`.
   */
  async excluir(ctx: Contexto, id: string): Promise<void> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const existe = await c.query(
        `SELECT 1 FROM procedimentos WHERE id = $1 AND excluido_em IS NULL`,
        [id],
      )
      if (existe.rowCount === 0) {
        throw new NotFoundException('Este procedimento não está no catálogo.')
      }

      /**
       * AS DUAS RECUSAS SAEM DE UMA CONSULTA SÓ.
       *
       * Dois `SELECT` separados são duas janelas, e entre elas cabe um
       * orçamento novo — a recepção registraria a proposta no instante entre
       * as duas contagens, e o procedimento sairia do catálogo por baixo
       * dela.
       */
      const r = await c.query<{ programas: string; propostas: string }>(
        `SELECT
           (SELECT count(*) FROM itens_do_programa i
              JOIN programas p ON p.id = i.programa_id AND p.excluido_em IS NULL
             WHERE i.procedimento_id = $1)::text AS programas,
           (SELECT count(*) FROM tarefas t
              CROSS JOIN LATERAL jsonb_array_elements(t.programa_orcado) it
             WHERE t.etapa = 'orcamento' AND t.excluida_em IS NULL
               AND t.programa_orcado IS NOT NULL
               AND it->>'procedimentoId' = $1::text)::text AS propostas`,
        [id],
      )
      const programas = Number(r.rows[0]!.programas)
      const propostas = Number(r.rows[0]!.propostas)

      if (programas > 0) {
        throw new ConflictException(
          `Este item tem ${programas === 1 ? '1 programa registrado' : `${programas} programas registrados`} ` +
            'e não pode ser excluído. Desmarque "Ativo" para não oferecer em novas adesões.',
        )
      }
      if (propostas > 0) {
        throw new ConflictException(
          `Este item está em ${propostas === 1 ? '1 orçamento em aberto' : `${propostas} orçamentos em aberto`} ` +
            'e não pode ser excluído. Feche ou perca o orçamento, ou desmarque "Ativo" ' +
            'para não oferecer em novas adesões.',
        )
      }

      // Soft delete (regra 20). E `ativo = false` junto, para que o índice
      // parcial `procedimentos_nome_unico` libere o nome por qualquer dos
      // dois caminhos — e para que nenhuma consulta que filtre só por `ativo`
      // continue oferecendo um procedimento excluído.
      await c.query(
        `UPDATE procedimentos
            SET excluido_em = now(), ativo = false, desativado_em = coalesce(desativado_em, now())
          WHERE id = $1`,
        [id],
      )
      // Nada de `registrar()` à mão: o trigger `registrar_auditoria` da 0010
      // já gravou quem, quando e de → para.
    })
  }

  /**
   * O `INSERT`/`UPDATE`, com a recusa de nome repetido vinda DO BANCO.
   *
   * Nunca de um `SELECT` antes: ler-depois-escrever perde a corrida entre
   * duas pessoas cadastrando "Peeling" ao mesmo tempo, e as duas passariam.
   */
  private async gravar(
    c: pg.PoolClient,
    ctx: Contexto,
    d: SalvarProcedimento,
    id: string | null,
  ): Promise<string> {
    const valores = [
      d.nome,
      d.sessoesSugeridas,
      d.intervaloSugeridoDias,
      d.rotuloSessao,
      d.responsavelId ?? null,
      d.valorPorSessao === undefined ? null : d.valorPorSessao.toString(),
      d.retorno?.quantidade ?? null,
      d.retorno?.unidade ?? 'm',
      d.retorno?.antecedenciaDias ?? 15,
      d.retorno?.responsavelId ?? null,
      d.insumoPadrao?.itemId ?? null,
      d.insumoPadrao === undefined ? null : d.insumoPadrao.quantidade.toString(),
      d.insumoPadrao?.unidade ?? null,
      d.ativo,
    ]

    let novoId: string
    try {
      if (id === null) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO procedimentos
             (clinica_id, nome, sessoes_sugeridas, intervalo_sugerido_dias, rotulo_sessao,
              responsavel_id, valor_por_sessao, retorno_quantidade, retorno_unidade,
              retorno_antecedencia_dias, retorno_responsavel_id,
              insumo_padrao_id, insumo_padrao_milesimos, insumo_padrao_unidade,
              ativo, desativado_em, criado_por)
           VALUES ($15,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                   CASE WHEN $14 THEN NULL ELSE now() END, $16)
           RETURNING id`,
          [...valores, ctx.clinicaId, ctx.ator],
        )
        novoId = r.rows[0]!.id
      } else {
        const r = await c.query<{ id: string }>(
          `UPDATE procedimentos
              SET nome = $1, sessoes_sugeridas = $2, intervalo_sugerido_dias = $3,
                  rotulo_sessao = $4, responsavel_id = $5, valor_por_sessao = $6,
                  retorno_quantidade = $7, retorno_unidade = $8,
                  retorno_antecedencia_dias = $9, retorno_responsavel_id = $10,
                  insumo_padrao_id = $11, insumo_padrao_milesimos = $12,
                  insumo_padrao_unidade = $13,
                  ativo = $14,
                  desativado_em = CASE WHEN $14 THEN NULL ELSE coalesce(desativado_em, now()) END
            WHERE id = $15 AND excluido_em IS NULL
            RETURNING id`,
          [...valores, id],
        )
        if (r.rowCount === 0) {
          throw new NotFoundException('Este procedimento não está no catálogo.')
        }
        novoId = r.rows[0]!.id
      }
    } catch (e) {
      throw traduzirNomeRepetido(e, d.nome)
    }

    // Os descartáveis são reescritos por inteiro: a tela manda a lista toda, e
    // um diff por item seria uma segunda regra de "o que mudou" para um dado
    // que cabe em dez linhas.
    await c.query('DELETE FROM insumos_do_procedimento WHERE procedimento_id = $1', [novoId])
    for (const [i, x] of d.descartaveis.entries()) {
      await c.query(
        `INSERT INTO insumos_do_procedimento
           (clinica_id, procedimento_id, item_id, milesimos, unidade, ordem)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [ctx.clinicaId, novoId, x.itemId, x.quantidade.toString(), x.unidade, i],
      )
    }
    return novoId
  }

  private async umPorId(c: pg.PoolClient, id: string): Promise<ProcedimentoNaLista> {
    const r = await c.query<LinhaDeProcedimento>(`${SELECT_BASE} AND p.id = $1`, [id])
    const linha = r.rows[0]
    if (linha === undefined) throw new NotFoundException('Este procedimento não está no catálogo.')
    return paraSaida(linha, (await this.insumosDe(c, [id])).get(id) ?? [])
  }

  private async insumosDe(
    c: pg.PoolClient,
    ids: readonly string[],
  ): Promise<Map<string, LinhaDeInsumo[]>> {
    const fora = new Map<string, LinhaDeInsumo[]>()
    if (ids.length === 0) return fora
    const r = await c.query<LinhaDeInsumo>(
      `SELECT procedimento_id, item_id, milesimos::text AS milesimos, unidade
         FROM insumos_do_procedimento WHERE procedimento_id = ANY($1::uuid[])
        ORDER BY ordem, item_id`,
      [[...ids]],
    )
    for (const l of r.rows) {
      const lista = fora.get(l.procedimento_id)
      if (lista === undefined) fora.set(l.procedimento_id, [l])
      else lista.push(l)
    }
    return fora
  }
}

/**
 * `23505` em `procedimentos_nome_unico` vira 409 com a frase da recepção.
 *
 * O índice ignora acento e caixa (`normalizar_nome`), então "tirzepatida" e
 * "Tirzepatida" colidem — e é para isso que ele existe: dois procedimentos
 * com o mesmo nome fariam o relatório contar a mesma paciente em duas linhas.
 */
function traduzirNomeRepetido(e: unknown, nome: string): unknown {
  const erro = e as { code?: string; constraint?: string }
  if (erro.code === '23505' && erro.constraint === 'procedimentos_nome_unico') {
    return new ConflictException(`Já existe um procedimento chamado "${nome}" no catálogo.`)
  }
  return e
}

const paraSaida = (l: LinhaDeProcedimento, insumos: readonly LinhaDeInsumo[]): ProcedimentoNaLista => ({
  id: l.id,
  nome: l.nome,
  sessoesSugeridas: l.sessoes_sugeridas,
  intervaloSugeridoDias: l.intervalo_sugerido_dias,
  rotuloSessao: l.rotulo_sessao,
  responsavelId: l.responsavel_id,
  valorPorSessao: l.valor_por_sessao,
  retorno:
    l.retorno_quantidade === null
      ? null
      : {
          quantidade: l.retorno_quantidade,
          // `as`: o `CHECK retorno_unidade IN ('d','m')` da 0010 garante o
          // par, e o driver devolve `string`. O teste de banco
          // `programas-banco` cobra o CHECK.
          unidade: l.retorno_unidade as 'd' | 'm',
          antecedenciaDias: l.retorno_antecedencia_dias,
          responsavelId: l.retorno_responsavel_id,
        },
  insumoPadrao:
    l.insumo_padrao_id === null
      ? null
      : {
          itemId: l.insumo_padrao_id,
          quantidade: l.insumo_padrao_milesimos!,
          unidade: l.insumo_padrao_unidade!,
        },
  descartaveis: insumos.map((x) => ({
    itemId: x.item_id,
    quantidade: x.milesimos,
    unidade: x.unidade,
  })),
  ativo: l.ativo,
  pacientesAtivos: Number(l.pacientes_ativos),
})

/**
 * A MESCLA DA EDIÇÃO PARCIAL: o que veio vence, o que não veio permanece.
 *
 * Converte a linha ATUAL (forma de saída, com dinheiro e dose em `string`) de
 * volta para a forma de ENTRADA (`bigint`), aplica o que chegou e devolve um
 * `SalvarProcedimento` completo. Um caminho só de escrita, então o `INSERT` e
 * o `UPDATE` nunca divergem na regra de `desativado_em` nem na de
 * descartáveis.
 *
 * A REDAÇÃO NÃO ALCANÇA ESTE PONTO, e é por isso que a mescla é segura:
 * `RedacaoInterceptor` roda na BORDA HTTP, depois do serviço, então `atual`
 * aqui traz `valorPorSessao` do banco, inteiro, mesmo para quem não tem
 * `valores`. Se a redação fosse feita no serviço — que é a tentação óbvia —,
 * um `PATCH { nome }` de quem não vê valores APAGARIA o preço do
 * procedimento, sem erro nenhum. Mais uma razão para a regra 17 exigir um
 * ponto único, e que ele seja o último.
 */
function mesclar(atual: ProcedimentoNaLista, d: EditarProcedimento): SalvarProcedimento {
  const insumoDeSaida = (x: { itemId: string; quantidade: string; unidade: string }) => ({
    itemId: x.itemId,
    quantidade: BigInt(x.quantidade),
    unidade: x.unidade,
  })

  const valorAtual = atual.valorPorSessao === null ? undefined : BigInt(atual.valorPorSessao)
  const valorNovo = d.valorPorSessao === undefined ? valorAtual : (d.valorPorSessao ?? undefined)

  const retornoAtual =
    atual.retorno === null
      ? undefined
      : ({
          unidade: atual.retorno.unidade,
          quantidade: atual.retorno.quantidade,
          antecedenciaDias: atual.retorno.antecedenciaDias,
          responsavelId: atual.retorno.responsavelId,
        } as SalvarProcedimento['retorno'])

  const insumoAtual =
    atual.insumoPadrao === null ? undefined : insumoDeSaida(atual.insumoPadrao)

  return {
    nome: d.nome ?? atual.nome,
    sessoesSugeridas: d.sessoesSugeridas ?? atual.sessoesSugeridas,
    intervaloSugeridoDias: d.intervaloSugeridoDias ?? atual.intervaloSugeridoDias,
    rotuloSessao: d.rotuloSessao ?? atual.rotuloSessao,
    responsavelId: d.responsavelId === undefined ? atual.responsavelId : d.responsavelId,
    ...(valorNovo === undefined ? {} : { valorPorSessao: valorNovo }),
    ...(d.retorno === undefined
      ? retornoAtual === undefined
        ? {}
        : { retorno: retornoAtual }
      : d.retorno === null
        ? {}
        : { retorno: d.retorno }),
    ...(d.insumoPadrao === undefined
      ? insumoAtual === undefined
        ? {}
        : { insumoPadrao: insumoAtual }
      : d.insumoPadrao === null
        ? {}
        : { insumoPadrao: d.insumoPadrao }),
    descartaveis: d.descartaveis ?? atual.descartaveis.map(insumoDeSaida),
    ativo: d.ativo ?? atual.ativo,
  }
}
