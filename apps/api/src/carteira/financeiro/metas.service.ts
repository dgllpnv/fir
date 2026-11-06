import type { CriarMetaComercialEntrada, MetaComercialNaLista, UsuarioDeGestaoPublico } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service'
import { lancamentoNaLista } from './indicadores.service'

export class IndicadorCarteiraNaoEncontradoParaMeta extends Error {}

type LinhaMeta = {
  id: string
  cliente_carteira_id: string
  indicador_id: string
  titulo: string
  sentido: 'maior_melhor' | 'menor_melhor'
  valor_meta_centavos: string | null
  valor_meta_inteiro: string | null
  valor_inicial_centavos: string | null
  valor_inicial_inteiro: string | null
  inicio: string
  prazo: string
  status: 'em_andamento' | 'concluida'
  ultimo_id: string | null
  ultimo_indicador_id: string | null
  ultimo_referencia: string | null
  ultimo_valor_centavos: string | null
  ultimo_valor_inteiro: string | null
  ultimo_observacao: string | null
  ultimo_lancado_por: string | null
}

const metaNaLista = (l: LinhaMeta): MetaComercialNaLista => ({
  id: l.id,
  clienteCarteiraId: l.cliente_carteira_id,
  indicadorId: l.indicador_id,
  titulo: l.titulo,
  sentido: l.sentido,
  valorMeta: l.valor_meta_centavos,
  valorMetaInteiro: l.valor_meta_inteiro,
  valorInicial: l.valor_inicial_centavos,
  valorInicialInteiro: l.valor_inicial_inteiro,
  inicio: l.inicio,
  prazo: l.prazo,
  status: l.status,
  // DERIVADO (critério 2.1.4) — nunca um `valor_atual` persistido. `null`
  // quando não há lançamento ainda (critério 2.1.5, "Aguardando o primeiro
  // lançamento" é decisão da TELA — aqui o contrato só diz "não há dado").
  ultimoLancamento:
    l.ultimo_id === null
      ? null
      : lancamentoNaLista({
          id: l.ultimo_id,
          indicador_id: l.ultimo_indicador_id!,
          referencia: l.ultimo_referencia!,
          valor_centavos: l.ultimo_valor_centavos,
          valor_inteiro: l.ultimo_valor_inteiro,
          observacao: l.ultimo_observacao,
          lancado_por: l.ultimo_lancado_por!,
        }),
})

const SELECAO = `
  SELECT m.*,
         l.id AS ultimo_id,
         l.indicador_id AS ultimo_indicador_id,
         l.referencia::text AS ultimo_referencia,
         l.valor_centavos::text AS ultimo_valor_centavos,
         l.valor_inteiro::text AS ultimo_valor_inteiro,
         l.observacao AS ultimo_observacao,
         l.lancado_por AS ultimo_lancado_por
    FROM metas_comerciais m
    LEFT JOIN LATERAL (
      SELECT * FROM lancamentos_de_indicador
       WHERE indicador_id = m.indicador_id
       ORDER BY referencia DESC
       LIMIT 1
    ) l ON true
`

/**
 * `Meta comercial do cliente` (spec G3 §1, §2.1). Progresso SEMPRE derivado —
 * ver `metaNaLista`. "Meta interna da carteira" não existe nesta fatia
 * (corte explícito do spec §4, documentado na migration 0031).
 */
@Injectable()
export class MetasComerciaisService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async criar(usuario: UsuarioDeGestaoPublico, dto: CriarMetaComercialEntrada): Promise<MetaComercialNaLista> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const indicador = await c.query<{ grupo_id: string }>(
        `SELECT grupo_id FROM indicadores_carteira WHERE id = $1 AND excluido_em IS NULL`,
        [dto.indicadorId],
      )
      const grupoId = indicador.rows[0]?.grupo_id
      if (grupoId === undefined) throw new IndicadorCarteiraNaoEncontradoParaMeta()

      const r = await c.query<{ id: string }>(
        `INSERT INTO metas_comerciais
           (cliente_carteira_id, grupo_id, indicador_id, titulo, sentido,
            valor_meta_centavos, valor_meta_inteiro, valor_inicial_centavos, valor_inicial_inteiro,
            inicio, prazo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          dto.clienteCarteiraId,
          grupoId,
          dto.indicadorId,
          dto.titulo,
          dto.sentido,
          dto.valorMeta != null ? dto.valorMeta.toString() : null,
          dto.valorMetaInteiro != null ? dto.valorMetaInteiro.toString() : null,
          dto.valorInicial != null ? dto.valorInicial.toString() : null,
          dto.valorInicialInteiro != null ? dto.valorInicialInteiro.toString() : null,
          dto.inicio,
          dto.prazo,
        ],
      )
      const linha = await c.query<LinhaMeta>(`${SELECAO} WHERE m.id = $1`, [r.rows[0]!.id])
      return metaNaLista(linha.rows[0]!)
    })
  }

  async listarPorCliente(usuario: UsuarioDeGestaoPublico, clienteCarteiraId: string): Promise<MetaComercialNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, (c) =>
      c.query<LinhaMeta>(
        `${SELECAO} WHERE m.cliente_carteira_id = $1 AND m.excluido_em IS NULL ORDER BY m.criado_em DESC`,
        [clienteCarteiraId],
      ),
    )
    return r.rows.map(metaNaLista)
  }
}
