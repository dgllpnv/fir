import type { CobrancaCarteiraNaLista, ListaDeCobrancasCarteiraSaida, UsuarioDeGestaoPublico } from '@fir/contracts'
import { Dinheiro } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service'
import { gravarAuditoriaDaCarteira } from './auditoria-da-carteira'

export class CobrancaCarteiraNaoEncontrada extends Error {}

type LinhaCobranca = {
  id: string
  cliente_carteira_id: string
  competencia: string
  mensalidade_centavos: string
  desconto_centavos: string
  valor_centavos: string
  vencimento: string
  status: 'aberto' | 'pago' | 'cancelado'
  pago_em: Date | null
}

const cobrancaNaLista = (l: LinhaCobranca): CobrancaCarteiraNaLista => ({
  id: l.id,
  clienteCarteiraId: l.cliente_carteira_id,
  competencia: l.competencia,
  mensalidade: l.mensalidade_centavos,
  desconto: l.desconto_centavos,
  valor: l.valor_centavos,
  vencimento: l.vencimento,
  status: l.status,
  pagoEm: l.pago_em ? l.pago_em.toISOString() : null,
})

/**
 * `Cobrança do Cliente Firmare` — dinheiro REAL (spec G3 §2.2; ADR 0015).
 *
 * **Nenhum total colapsado** (achado 1, ADR 0015): `somaValor` em
 * `listarPorCliente` é recalculado em cima do MESMO array `cobrancas` que a
 * resposta devolve — `Dinheiro.mais`, nunca um segundo `SELECT SUM(...)` com
 * filtro próprio que poderia divergir da lista.
 */
@Injectable()
export class CobrancasCarteiraService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listarPorCliente(
    usuario: UsuarioDeGestaoPublico,
    clienteCarteiraId: string,
  ): Promise<ListaDeCobrancasCarteiraSaida> {
    const r = await this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, (c) =>
      c.query<LinhaCobranca>(
        `SELECT id, cliente_carteira_id, competencia::text AS competencia,
                mensalidade_centavos::text AS mensalidade_centavos,
                desconto_centavos::text AS desconto_centavos,
                valor_centavos::text AS valor_centavos,
                vencimento::text AS vencimento, status, pago_em
           FROM cobrancas_do_cliente_firmare
          WHERE cliente_carteira_id = $1
          ORDER BY competencia DESC`,
        [clienteCarteiraId],
      ),
    )
    const cobrancas = r.rows.map(cobrancaNaLista)
    // A MESMA lista, reduzida pelo value object — nunca uma segunda consulta.
    const soma = cobrancas.reduce((acc, c) => acc.mais(Dinheiro.deCentavos(BigInt(c.valor!))), Dinheiro.zero())
    return { cobrancas, somaValor: soma.centavos.toString() }
  }

  async marcarPago(usuario: UsuarioDeGestaoPublico, cobrancaId: string): Promise<CobrancaCarteiraNaLista> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const atual = await c.query<LinhaCobranca>(
        `SELECT id, cliente_carteira_id, grupo_id, competencia::text AS competencia,
                mensalidade_centavos::text AS mensalidade_centavos,
                desconto_centavos::text AS desconto_centavos,
                valor_centavos::text AS valor_centavos,
                vencimento::text AS vencimento, status, pago_em
           FROM cobrancas_do_cliente_firmare WHERE id = $1`,
        [cobrancaId],
      )
      const antes = atual.rows[0] as (LinhaCobranca & { grupo_id: string }) | undefined
      if (!antes) throw new CobrancaCarteiraNaoEncontrada()

      // Idempotente por desenho: marcar pago de novo não muda nada — nunca
      // reescreve `pago_em` de uma cobrança já paga.
      if (antes.status === 'pago') return cobrancaNaLista(antes)

      const r = await c.query<LinhaCobranca>(
        `UPDATE cobrancas_do_cliente_firmare
            SET status = 'pago', pago_em = now(), pago_por = $2
          WHERE id = $1
          RETURNING id, cliente_carteira_id, competencia::text AS competencia,
                    mensalidade_centavos::text AS mensalidade_centavos,
                    desconto_centavos::text AS desconto_centavos,
                    valor_centavos::text AS valor_centavos,
                    vencimento::text AS vencimento, status, pago_em`,
        [cobrancaId, `usuario_gestao:${usuario.id}`],
      )
      const depois = r.rows[0]!

      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: usuario.id,
        grupoId: antes.grupo_id,
        tabela: 'cobrancas_do_cliente_firmare',
        registroId: cobrancaId,
        acao: 'marcar_pago',
        de: { status: antes.status, pago_em: antes.pago_em },
        para: { status: depois.status, pago_em: depois.pago_em },
      })

      return cobrancaNaLista(depois)
    })
  }

  /**
   * "Desfazer" (critério 2.2.9 do spec G3 — "Marcar pago"/"Desfazer", o
   * mesmo par do protótipo). Reverte `status`/`pago_em`/`pago_por` para o
   * estado anterior ao pagamento — nunca apaga a `Cobrança` em si (regra 20,
   * append-only de fato: a linha continua existindo, só o estado muda, e a
   * trilha registra os dois lados).
   *
   * Idempotente por desenho, mesmo par de `marcarPago`: desfazer uma
   * cobrança que já está `aberto` não muda nada e não grava segunda entrada.
   * Nunca desfaz `cancelado` — "desfazer" só existe em relação a "pago".
   */
  async desfazerPago(usuario: UsuarioDeGestaoPublico, cobrancaId: string): Promise<CobrancaCarteiraNaLista> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const atual = await c.query<LinhaCobranca>(
        `SELECT id, cliente_carteira_id, grupo_id, competencia::text AS competencia,
                mensalidade_centavos::text AS mensalidade_centavos,
                desconto_centavos::text AS desconto_centavos,
                valor_centavos::text AS valor_centavos,
                vencimento::text AS vencimento, status, pago_em
           FROM cobrancas_do_cliente_firmare WHERE id = $1`,
        [cobrancaId],
      )
      const antes = atual.rows[0] as (LinhaCobranca & { grupo_id: string }) | undefined
      if (!antes) throw new CobrancaCarteiraNaoEncontrada()

      // Idempotente: nada a desfazer numa cobrança que já não está paga.
      if (antes.status !== 'pago') return cobrancaNaLista(antes)

      const r = await c.query<LinhaCobranca>(
        `UPDATE cobrancas_do_cliente_firmare
            SET status = 'aberto', pago_em = NULL, pago_por = NULL
          WHERE id = $1
          RETURNING id, cliente_carteira_id, competencia::text AS competencia,
                    mensalidade_centavos::text AS mensalidade_centavos,
                    desconto_centavos::text AS desconto_centavos,
                    valor_centavos::text AS valor_centavos,
                    vencimento::text AS vencimento, status, pago_em`,
        [cobrancaId],
      )
      const depois = r.rows[0]!

      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: usuario.id,
        grupoId: antes.grupo_id,
        tabela: 'cobrancas_do_cliente_firmare',
        registroId: cobrancaId,
        acao: 'desfazer_pago',
        de: { status: antes.status, pago_em: antes.pago_em },
        para: { status: depois.status, pago_em: depois.pago_em },
      })

      return cobrancaNaLista(depois)
    })
  }
}
