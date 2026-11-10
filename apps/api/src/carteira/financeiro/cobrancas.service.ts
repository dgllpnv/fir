import type {
  BaixarMensalidadesPagasSaida,
  CobrancaCarteiraNaLista,
  ListaDeCobrancasCarteiraSaida,
  PainelDeMensalidadesSaida,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import {
  Dinheiro,
  type Relogio,
  diaCivil,
  receitaRecorrente,
  responsavelImpostoPeloPerfil,
  resumirMensalidades,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO } from '../../comum/relogio'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
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
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * **O painel de Mensalidades do mês** (G8 1F, `painelMensalidades` L719-729).
   *
   * As linhas são as cobranças NÃO canceladas da competência, com o valor
   * COBRADO (snapshot com desconto) — nunca a mensalidade atual, como faz o
   * protótipo (L723): mudar a mensalidade depois não pode mudar o que foi
   * cobrado (ajuste 7, divergência consciente). Situação, totais e ticket
   * médio saem de `packages/domain`, com o hoje do servidor no fuso da
   * carteira (regra 24) — o front não calcula nada.
   *
   * Duas camadas de isolamento: a RLS por grupo da sessão
   * (`nasTabelasDaCarteiraComEscopo`) e o `grupo_id` no `WHERE` para quem
   * tem escopo de grupo.
   */
  async painel(usuario: UsuarioDeGestaoPublico, mes: string | undefined): Promise<PainelDeMensalidadesSaida> {
    const hoje = diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
    const competencia = `${mes ?? hoje.slice(0, 7)}-01`
    const grupo = usuario.escopo === 'grupo' ? usuario.grupoId : null
    // "Só a minha carteira" (A-3, ticket 0.5): linhas E o MRR do painel saem
    // da mesma restrição — senão o total revelaria a soma dos alheios.
    const minha = responsavelImpostoPeloPerfil(usuario)

    const { linhas, mensalidades, meses } = await this.banco.nasTabelasDaCarteiraComEscopo(
      usuario.escopo,
      usuario.grupoId,
      async (c) => {
        const linhas = await c.query<LinhaCobranca & { cliente_nome: string }>(
          `SELECT cb.id, cb.cliente_carteira_id, cb.competencia::text AS competencia,
                  cb.mensalidade_centavos::text AS mensalidade_centavos,
                  cb.desconto_centavos::text AS desconto_centavos,
                  cb.valor_centavos::text AS valor_centavos,
                  cb.vencimento::text AS vencimento, cb.status, cb.pago_em,
                  cl.nome AS cliente_nome
             FROM cobrancas_do_cliente_firmare cb
             JOIN clientes_carteira cl ON cl.id = cb.cliente_carteira_id
            WHERE cb.competencia = $1::date AND cb.status <> 'cancelado'
              -- Só o cliente que conta na receita (0068): a clínica em 2+ grupos não entra duas vezes.
              AND cl.conta_na_receita
              AND ($2::uuid IS NULL OR cb.grupo_id = $2::uuid)
              AND ($3::uuid IS NULL OR cl.responsavel_usuario_gestao_id = $3::uuid)
            ORDER BY cb.vencimento, cl.nome, cb.id`,
          [competencia, grupo, minha],
        )
        // Contratos ATUAIS (MRR, gate de números §3.2): ativo + onboarding,
        // não excluídos, no escopo da sessão.
        const mensalidades = await c.query<{ mensalidade_centavos: string }>(
          `SELECT mensalidade_centavos::text AS mensalidade_centavos
             FROM clientes_carteira
            WHERE status IN ('ativo', 'onboarding') AND excluido_em IS NULL
              AND conta_na_receita
              AND ($1::uuid IS NULL OR grupo_id = $1::uuid)
              AND ($2::uuid IS NULL OR responsavel_usuario_gestao_id = $2::uuid)`,
          [grupo, minha],
        )
        const meses = await c.query<{ mes: string }>(
          `SELECT DISTINCT to_char(competencia, 'YYYY-MM') AS mes
             FROM cobrancas_do_cliente_firmare
            WHERE ($1::uuid IS NULL OR grupo_id = $1::uuid)
            ORDER BY mes DESC
            LIMIT 36`,
          [grupo],
        )
        return { linhas: linhas.rows, mensalidades: mensalidades.rows, meses: meses.rows }
      },
    )

    const resumo = resumirMensalidades(
      linhas.map((l) => ({
        id: l.id,
        // O `WHERE` já tirou as canceladas; o tipo do domínio só conhece as duas.
        status: l.status === 'pago' ? ('pago' as const) : ('aberto' as const),
        valor: Dinheiro.deCentavos(BigInt(l.valor_centavos)),
        vencimento: l.vencimento,
      })),
      hoje,
    )
    const recorrente = receitaRecorrente(mensalidades.map((m) => Dinheiro.deCentavos(BigInt(m.mensalidade_centavos))))
    const mesesComCobranca = [...new Set([hoje.slice(0, 7), ...meses.map((m) => m.mes)])].sort().reverse()

    return {
      competencia,
      hoje,
      mensalidades: linhas.map((l, i) => {
        const r = resumo.linhas[i]!
        return {
          ...cobrancaNaLista(l),
          clienteNome: l.cliente_nome,
          situacao: r.situacao,
          dias: r.dias,
          pagoNoDia: l.pago_em ? diaCivil(l.pago_em, FUSO_DA_CARTEIRA) : null,
        }
      }),
      totais: {
        somaValor: resumo.total.centavos.toString(),
        recebido: resumo.recebido.centavos.toString(),
        aReceber: resumo.aReceber.centavos.toString(),
      },
      porSituacao: resumo.porSituacao.map((s) => ({
        situacao: s.situacao,
        quantidade: s.quantidade,
        valor: s.valor.centavos.toString(),
      })),
      recorrente: {
        receita: recorrente.receita.centavos.toString(),
        ticketMedio: recorrente.ticketMedio ? recorrente.ticketMedio.centavos.toString() : null,
        clientesComMensalidade: recorrente.clientesComMensalidade,
      },
      mesesComCobranca,
    }
  }

  /**
   * **"Baixar pagos"** — marca várias cobranças como pagas numa transação só.
   *
   * Idempotente: a que já está paga fica como está (o `pago_em` original não
   * é reescrito) e não ganha segunda linha de auditoria; a cancelada não é
   * tocada. Se QUALQUER id não for visível na sessão (outro grupo, ou não
   * existe), nada é gravado e a resposta é "não encontrada" — sem dizer qual,
   * para não confirmar a existência de cobrança de outro grupo.
   */
  async baixarPagos(usuario: UsuarioDeGestaoPublico, ids: readonly string[]): Promise<BaixarMensalidadesPagasSaida> {
    const unicos = [...new Set(ids)]
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const grupo = usuario.escopo === 'grupo' ? usuario.grupoId : null
      const atuais = await c.query<LinhaCobranca & { grupo_id: string }>(
        `SELECT id, cliente_carteira_id, grupo_id, competencia::text AS competencia,
                mensalidade_centavos::text AS mensalidade_centavos,
                desconto_centavos::text AS desconto_centavos,
                valor_centavos::text AS valor_centavos,
                vencimento::text AS vencimento, status, pago_em
           FROM cobrancas_do_cliente_firmare
          WHERE id = ANY($1::uuid[]) AND ($2::uuid IS NULL OR grupo_id = $2::uuid)
          ORDER BY id
          FOR UPDATE`,
        [unicos, grupo],
      )
      if (atuais.rows.length !== unicos.length) throw new CobrancaCarteiraNaoEncontrada()

      let marcadasAgora = 0
      const saida: CobrancaCarteiraNaLista[] = []
      for (const antes of atuais.rows) {
        if (antes.status !== 'aberto') {
          saida.push(cobrancaNaLista(antes))
          continue
        }
        const r = await c.query<LinhaCobranca>(
          `UPDATE cobrancas_do_cliente_firmare
              SET status = 'pago', pago_em = now(), pago_por = $2
            WHERE id = $1 AND status = 'aberto'
            RETURNING id, cliente_carteira_id, competencia::text AS competencia,
                      mensalidade_centavos::text AS mensalidade_centavos,
                      desconto_centavos::text AS desconto_centavos,
                      valor_centavos::text AS valor_centavos,
                      vencimento::text AS vencimento, status, pago_em`,
          [antes.id, `usuario_gestao:${usuario.id}`],
        )
        const depois = r.rows[0]!
        await gravarAuditoriaDaCarteira(c, {
          usuarioGestaoId: usuario.id,
          grupoId: antes.grupo_id,
          tabela: 'cobrancas_do_cliente_firmare',
          registroId: antes.id,
          acao: 'marcar_pago',
          de: { status: antes.status, pago_em: antes.pago_em },
          para: { status: depois.status, pago_em: depois.pago_em },
        })
        marcadasAgora += 1
        saida.push(cobrancaNaLista(depois))
      }
      return { marcadasAgora, cobrancas: saida }
    })
  }

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
