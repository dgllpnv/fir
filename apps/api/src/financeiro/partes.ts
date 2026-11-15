import {
  Dinheiro,
  formaPrincipal,
  mesmasPartes,
  type ParteDoPagamento,
  validarPartes,
} from '@fir/domain'
import { BadRequestException, ConflictException } from '@nestjs/common'
import type pg from 'pg'
import { PartesNaSaida } from '@fir/contracts'
import type { PessoaId } from '../banco/ator'

/**
 * **O MÓDULO DE PARTES — o único lugar que escreve `recebimentos` e o único
 * (com a migração) que lê a forma por recebimento.**
 *
 * `teste/arquitetura-de-partes.test.ts` varre o fonte e reprova `INSERT INTO
 * recebimentos` fora deste arquivo e `r.forma` fora dele e da conferência de
 * migração. É o que impede o quinto ponto de escrita de nascer sem as partes.
 */

/**
 * As partes de um recebimento como um `jsonb` agregado, SEM JOIN que
 * multiplique linhas (`tarefas-leitura-nao-multiplica-linhas`). Pressupõe
 * `recebimentos r` no escopo. Valor em texto: bigint não cabe em número JSON.
 *
 * Ordem: maior valor primeiro; no empate, a que a pessoa DIGITOU primeiro
 * (`ordem`). É o MESMO critério de `formaPrincipal` no domínio, então a
 * primeira parte da lista é sempre a forma gravada em `recebimentos.forma`.
 */
export const PARTES_EM_JSON = `(
  SELECT coalesce(
           jsonb_agg(jsonb_build_object('forma', pt.forma, 'valor', pt.valor::text)
                     ORDER BY pt.valor DESC, pt.ordem),
           '[]'::jsonb)
    FROM recebimento_partes pt
   WHERE pt.recebimento_id = r.id AND pt.clinica_id = r.clinica_id)`

export type ParteNaSaida = { forma: string; valor: string | null }

/** O que `gravarRecebimento` precisa saber — o mesmo para os quatro pontos de escrita. */
export type NovoRecebimento = {
  readonly clinicaId: string
  readonly pacienteId: string
  readonly tarefaId: string | null
  readonly tipo: string
  /** Centavos recebidos. Zero é a venda a prazo (sem partes). */
  readonly valor: bigint
  readonly valorAberto: bigint
  readonly recebidoEm: Date
  readonly unidadeId: string | null
  readonly registradoPor: PessoaId | string
  /** Idempotência: o reenvio com a mesma chave devolve o original. */
  readonly requisicaoId?: string | undefined
  readonly programaId?: string | null | undefined
  /** `valor > 0` exige partes que somem `valor`; `valor = 0` exige nenhuma. */
  readonly partes: readonly { readonly forma: string; readonly valor: bigint }[]
  /** Só o migrador: a forma `''` do dado legado da v20 (0021). */
  readonly aceitaFormaVazia?: boolean | undefined
}

export type RecebimentoGravado = {
  readonly id: string
  /** `false`: o INSERT não afetou linha (mesma `requisicao_id`) e `id` é o do original. */
  readonly criado: boolean
}

const deBigint = (p: { forma: string; valor: bigint }): ParteDoPagamento => ({
  forma: p.forma,
  valor: Dinheiro.deCentavos(p.valor),
})

/**
 * Valida as partes no domínio e traduz o erro para 400 — a mesma validação que
 * o contrato faz na borda, repetida aqui porque esta é a ÚLTIMA porta antes do
 * banco (o migrador e o seed não passam pelo Zod).
 */
export function partesValidas(
  valor: bigint,
  partes: readonly { readonly forma: string; readonly valor: bigint }[],
  aceitaFormaVazia = false,
): readonly ParteDoPagamento[] {
  const r = validarPartes(Dinheiro.deCentavos(valor), partes.map(deBigint), { aceitaFormaVazia })
  if (r.tipo === 'erro') throw new BadRequestException(r.erro.mensagem)
  return r.valor
}

/**
 * **A FUNÇÃO ÚNICA DE ESCRITA DE `recebimentos`** (`gravarRecebimento`).
 *
 * Quatro pontos a chamam — `registrarPagamento` (tarefas), a adesão
 * (programas), o recebimento avulso e o migrador. Ela:
 *
 *  1. valida `Σ partes = valor` no domínio (o banco repete no COMMIT);
 *  2. grava `recebimentos.forma` com a forma da MAIOR parte (empate: a
 *     primeira), nunca 'Mista' — o legado fica coerente e ninguém o lê;
 *  3. insere as partes SÓ SE o INSERT do recebimento afetou 1 linha: o reenvio
 *     com a mesma `requisicao_id` não afeta nenhuma, e partes sem pai (ou
 *     duplicadas) é exatamente o que o `ON CONFLICT` existe para evitar;
 *  4. no reenvio, partes DIFERENTES das do original → 409 (mesma chave, outro
 *     pedido é um erro de cliente, não um duplo toque).
 */
export async function gravarRecebimento(
  c: pg.PoolClient,
  x: NovoRecebimento,
): Promise<RecebimentoGravado> {
  const partes = partesValidas(x.valor, x.partes, x.aceitaFormaVazia === true)

  const inserido = await c.query<{ id: string }>(
    `INSERT INTO recebimentos
       (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em,
        unidade_id, registrado_por, requisicao_id, programa_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (clinica_id, requisicao_id) WHERE requisicao_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      x.clinicaId,
      x.pacienteId,
      x.tarefaId,
      x.tipo,
      // `bigint` vira texto no parâmetro: o driver não serializa bigint, e
      // `Number()` perderia precisão acima de 2^53 (regra 1).
      x.valor.toString(),
      formaPrincipal(partes),
      x.valorAberto.toString(),
      x.recebidoEm,
      x.unidadeId,
      x.registradoPor,
      x.requisicaoId ?? null,
      x.programaId ?? null,
    ],
  )

  const nova = inserido.rows[0]
  if (nova === undefined) {
    // O INSERT não afetou linha: só a chave de requisição pode ser a causa.
    const existente = await c.query<{ id: string; valor: string }>(
      'SELECT id, valor::text AS valor FROM recebimentos WHERE clinica_id = $1 AND requisicao_id = $2',
      [x.clinicaId, x.requisicaoId ?? null],
    )
    const dele = existente.rows[0]
    if (dele === undefined) throw new ConflictException('Não consegui registrar o recebimento. Tente de novo.')
    if (BigInt(dele.valor) === x.valor) await exigirMesmasPartes(c, dele.id, partes)
    return { id: dele.id, criado: false }
  }

  for (const [ordem, p] of partes.entries()) {
    await c.query(
      `INSERT INTO recebimento_partes (clinica_id, recebimento_id, forma, valor, ordem)
       VALUES ($1,$2,$3,$4,$5)`,
      [x.clinicaId, nova.id, p.forma, p.valor.centavos.toString(), ordem],
    )
  }
  return { id: nova.id, criado: true }
}

/** As partes gravadas de um recebimento, da maior para a menor. */
export async function partesDe(
  c: pg.PoolClient,
  recebimentoId: string,
): Promise<readonly ParteDoPagamento[]> {
  const r = await c.query<{ forma: string; valor: string }>(
    `SELECT pt.forma, pt.valor::text AS valor FROM recebimento_partes pt
      WHERE pt.recebimento_id = $1 ORDER BY pt.valor DESC, pt.ordem`,
    [recebimentoId],
  )
  return r.rows.map((l) => ({ forma: l.forma, valor: Dinheiro.deCentavos(BigInt(l.valor)) }))
}

/**
 * O reenvio da mesma `requisicao_id` só é o MESMO pedido se as formas e os
 * valores forem os mesmos. Compara só quando o total bate: o "Saldo em aberto"
 * corta o valor ao que quita a dívida, e o reenvio calcula o corte sobre um
 * saldo que o primeiro envio já abateu — o total diferente não é erro de
 * cliente, é o teto.
 */
export async function exigirMesmasPartes(
  c: pg.PoolClient,
  recebimentoId: string,
  pedidas: readonly ParteDoPagamento[],
): Promise<void> {
  const gravadas = await partesDe(c, recebimentoId)
  if (!mesmasPartes(gravadas, pedidas)) {
    throw new ConflictException(
      'Esta requisição já foi usada com outras formas de pagamento. Abra o formulário de novo.',
    )
  }
}

/** `{forma, valor: bigint}` (o que o contrato entrega) → partes do domínio. */
export const emDominio = (
  partes: readonly { readonly forma: string; readonly valor: bigint }[],
): readonly ParteDoPagamento[] => partes.map(deBigint)

export const partesNaSaida = (partes: readonly ParteDoPagamento[]): ParteNaSaida[] =>
  partes.map((p) => ({ forma: p.forma, valor: p.valor.centavos.toString() }))

/**
 * O `jsonb` de `PARTES_EM_JSON` → partes tipadas; `null` do driver vira lista
 * vazia. Parse com Zod em vez de `as`: se a forma do JSON mudar, falha alto.
 */
export const partesDoJson = (json: unknown): ParteNaSaida[] =>
  json === null || json === undefined ? [] : PartesNaSaida.parse(json)
