import type { BeneficioDeIndicacaoNaLista, CriarBeneficioDeIndicacaoEntrada, UsuarioDeGestaoPublico } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service'
import { gravarAuditoriaDaCarteira } from './auditoria-da-carteira'

export class ClienteCarteiraNaoEncontradoParaBeneficio extends Error {}

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
}
