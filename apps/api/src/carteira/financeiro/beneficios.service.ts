import type {
  BeneficioDeIndicacaoNaLista,
  BeneficioDeIndicacaoNaTela,
  CriarBeneficioDeIndicacaoEntrada,
  ListaDeBeneficiosSaida,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service'
import { gravarAuditoriaDaCarteira } from './auditoria-da-carteira'
import { beneficiosNaTela, SQL_BENEFICIO_NA_TELA, type LinhaBeneficioNaTela } from './beneficios.leitura'
import { percentualDoBeneficioDeIndicacao } from './beneficios.regra'

export class ClienteCarteiraNaoEncontradoParaBeneficio extends Error {}
export class BeneficioNaoEncontrado extends Error {}
/** O benefício já tem dono — ligar a outro cliente seria trocá-lo em silêncio. */
export class BeneficioJaLigado extends Error {}

type LinhaBeneficio = {
  id: string
  cliente_carteira_id: string
  percentual_centesimos: string
  motivo: string | null
  consumido_em: Date | null
  cobranca_id: string | null
}

const beneficioNaLista = (l: LinhaBeneficio): BeneficioDeIndicacaoNaLista => ({
  id: l.id,
  clienteCarteiraId: l.cliente_carteira_id,
  percentualCentesimos: l.percentual_centesimos,
  motivo: l.motivo,
  consumidoEm: l.consumido_em ? l.consumido_em.toISOString() : null,
  cobrancaId: l.cobranca_id,
})

/**
 * `Benefício de indicação` (spec G3 §1) — desconto de USO ÚNICO sobre uma
 * `Cobrança do Cliente Firmare` futura. Esta classe só CRIA o cadastro: quem
 * CONSOME (`consumido_em`/`cobranca_id`) é `executarGeracaoDeCobrancas`
 * (`gerar-cobrancas.ts`), dentro da mesma transação que insere a `Cobrança`
 * (achado 3, ADR 0015) — nunca este service.
 *
 * Criado pelo `Usuário de Gestão`, mesma porta de `indicadores`/`metas`
 * (`/v1/carteira/...`) — e não pelo `Operador`: `auditoria_da_carteira.
 * usuario_gestao_id` é `NOT NULL` com FK para `usuarios_gestao`, nunca para
 * `operadores`, então só o `Usuário de Gestão` tem uma trilha possível de
 * gravar aqui (regra 20). O `Operador` cria `Cliente Firmare` e `Usuário de
 * Gestão` (ADR 0011 — ponto único de entrada para ESSES dois cadastros, por
 * razão própria), mas um `Benefício de indicação` não é nenhum dos dois: é
 * uma concessão comercial sobre um cliente já existente, mesma classe de
 * escrita que `Indicador`/`Meta comercial`.
 */
@Injectable()
export class BeneficiosDeIndicacaoService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async criar(
    usuario: UsuarioDeGestaoPublico,
    dto: CriarBeneficioDeIndicacaoEntrada,
  ): Promise<BeneficioDeIndicacaoNaLista> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const cliente = await c.query<{ grupo_id: string }>(
        `SELECT grupo_id FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL`,
        [dto.clienteCarteiraId],
      )
      const grupoId = cliente.rows[0]?.grupo_id
      if (grupoId === undefined) throw new ClienteCarteiraNaoEncontradoParaBeneficio()

      const r = await c.query<LinhaBeneficio>(
        `INSERT INTO beneficios_de_indicacao (cliente_carteira_id, grupo_id, percentual_centesimos, motivo)
         VALUES ($1, $2, $3, $4)
         RETURNING id, cliente_carteira_id, percentual_centesimos::text AS percentual_centesimos,
                   motivo, consumido_em, cobranca_id`,
        [dto.clienteCarteiraId, grupoId, dto.percentualCentesimos.toString(), dto.motivo ?? null],
      )
      const linha = r.rows[0]!

      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: usuario.id,
        grupoId,
        tabela: 'beneficios_de_indicacao',
        registroId: linha.id,
        acao: 'criar',
        de: null,
        para: linha,
      })

      return beneficioNaLista(linha)
    })
  }

  /**
   * A tela de benefícios (L2539-2547): guardados, pendentes e concedidos,
   * cada um com quem indicou e quem foi indicado. Sob a RLS da sessão.
   */
  async listar(usuario: UsuarioDeGestaoPublico): Promise<ListaDeBeneficiosSaida> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const r = await c.query<LinhaBeneficioNaTela>(`${SQL_BENEFICIO_NA_TELA} ORDER BY b.criado_em DESC`)
      return {
        beneficios: await beneficiosNaTela(c, r.rows),
        regraPercentualCentesimos: (await percentualDoBeneficioDeIndicacao(c)).toString(),
      }
    })
  }

  /**
   * Liga um benefício GUARDADO ao cliente em que a pessoa que indicou se
   * tornou (D-22 item 11). Daí em diante a próxima cobrança desse cliente o
   * consome, como qualquer benefício.
   *
   * O grupo do benefício passa a ser o do cliente (a RLS decide por ele; a
   * FK composta da 0049 recusa o par divergente). Para escopo 'grupo', o
   * UPDATE só passa se o benefício E o cliente forem do grupo da sessão: a
   * policy confere o grupo antigo (USING) e o novo (WITH CHECK).
   *
   * Idempotente: ligar de novo ao MESMO cliente devolve o benefício como
   * está; a outro cliente, recusa — um benefício nunca troca de dono em
   * silêncio.
   */
  async vincularACliente(
    usuario: UsuarioDeGestaoPublico,
    beneficioId: string,
    clienteId: string,
  ): Promise<BeneficioDeIndicacaoNaTela> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const atual = await c.query<{ id: string; cliente_carteira_id: string | null; grupo_id: string }>(
        `SELECT id, cliente_carteira_id, grupo_id FROM beneficios_de_indicacao WHERE id = $1 FOR UPDATE`,
        [beneficioId],
      )
      const b = atual.rows[0]
      if (b === undefined) throw new BeneficioNaoEncontrado()
      if (b.cliente_carteira_id !== null && b.cliente_carteira_id !== clienteId) throw new BeneficioJaLigado()

      if (b.cliente_carteira_id === null) {
        const cliente = await c.query<{ grupo_id: string }>(
          `SELECT grupo_id FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL`,
          [clienteId],
        )
        const grupoDoCliente = cliente.rows[0]?.grupo_id
        if (grupoDoCliente === undefined) throw new ClienteCarteiraNaoEncontradoParaBeneficio()

        await c.query(
          `UPDATE beneficios_de_indicacao
              SET cliente_carteira_id = $2, grupo_id = $3, vinculado_em = now()
            WHERE id = $1 AND cliente_carteira_id IS NULL`,
          [beneficioId, clienteId, grupoDoCliente],
        )
        await gravarAuditoriaDaCarteira(c, {
          usuarioGestaoId: usuario.id,
          grupoId: grupoDoCliente,
          tabela: 'beneficios_de_indicacao',
          registroId: beneficioId,
          acao: 'atualizar',
          de: { cliente_carteira_id: null, grupo_id: b.grupo_id },
          para: { cliente_carteira_id: clienteId, grupo_id: grupoDoCliente },
        })
      }

      const r = await c.query<LinhaBeneficioNaTela>(`${SQL_BENEFICIO_NA_TELA} WHERE b.id = $1`, [beneficioId])
      return (await beneficiosNaTela(c, r.rows))[0]!
    })
  }
}
