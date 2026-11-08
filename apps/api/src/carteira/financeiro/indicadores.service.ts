import type {
  CriarIndicadorCarteiraEntrada,
  IndicadorCarteiraNaLista,
  LancamentoDeIndicadorNaLista,
  LancarIndicadorEntrada,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service'
import { gravarAuditoriaDaCarteira } from './auditoria-da-carteira'
import { exigirSegunda, exigirValores } from './metas-comum'

export class ClienteCarteiraNaoEncontrado extends Error {}
export class IndicadorCarteiraNaoEncontrado extends Error {}

type LinhaIndicador = {
  id: string
  cliente_carteira_id: string
  grupo_id: string
  nome: string
  unidade: 'R$' | 'un' | '%' | 'dias'
  sentido: 'maior_melhor' | 'menor_melhor'
  ativo: boolean
}

type LinhaLancamento = {
  id: string
  indicador_id: string
  referencia: string
  valor_centavos: string | null
  valor_inteiro: string | null
  observacao: string | null
  lancado_por: string
}

const indicadorNaLista = (l: LinhaIndicador): IndicadorCarteiraNaLista => ({
  id: l.id,
  clienteCarteiraId: l.cliente_carteira_id,
  grupoId: l.grupo_id,
  nome: l.nome,
  // O contrato de G3 conhece só R$/un/%. "dias" (G8 2B) é inteiro como "un":
  // a ficha antiga o mostra como contagem; a tela nova lê o contrato novo.
  unidade: l.unidade === 'dias' ? 'un' : l.unidade,
  sentido: l.sentido,
  ativo: l.ativo,
})

export const lancamentoNaLista = (l: LinhaLancamento): LancamentoDeIndicadorNaLista => ({
  id: l.id,
  indicadorId: l.indicador_id,
  referencia: l.referencia,
  valor: l.valor_centavos,
  valorInteiro: l.valor_inteiro,
  observacao: l.observacao,
  lancadoPor: l.lancado_por,
})

/**
 * `Indicador da carteira` e `Lançamento de indicador` (spec G3 §1, §2.1).
 *
 * Toda escrita acontece como o `Usuário de Gestão` autenticado — via
 * `nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, …)`, que
 * fixa a RLS pelo MESMO escopo que o `CarteiraGuard` já resolveu (nunca um
 * parâmetro de requisição). A coerência `unidade` × `valor_centavos`/
 * `valor_inteiro` é cobrada duas vezes: aqui (erro de validação legível) e no
 * BANCO, por trigger (`validar_lancamento_de_indicador`, migration 0031) —
 * a segunda é a que vale de verdade, a primeira só poupa uma viagem.
 */
@Injectable()
export class IndicadoresCarteiraService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async criar(
    usuario: UsuarioDeGestaoPublico,
    dto: CriarIndicadorCarteiraEntrada,
  ): Promise<IndicadorCarteiraNaLista> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const cliente = await c.query<{ grupo_id: string }>(
        `SELECT grupo_id FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL`,
        [dto.clienteCarteiraId],
      )
      const grupoId = cliente.rows[0]?.grupo_id
      if (grupoId === undefined) throw new ClienteCarteiraNaoEncontrado()

      const r = await c.query<LinhaIndicador>(
        `INSERT INTO indicadores_carteira (cliente_carteira_id, grupo_id, nome, unidade, sentido)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [dto.clienteCarteiraId, grupoId, dto.nome, dto.unidade, dto.sentido],
      )
      return indicadorNaLista(r.rows[0]!)
    })
  }

  async listarPorCliente(
    usuario: UsuarioDeGestaoPublico,
    clienteCarteiraId: string,
  ): Promise<IndicadorCarteiraNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, (c) =>
      c.query<LinhaIndicador>(
        `SELECT * FROM indicadores_carteira
          WHERE cliente_carteira_id = $1 AND excluido_em IS NULL
          ORDER BY criado_em`,
        [clienteCarteiraId],
      ),
    )
    return r.rows.map(indicadorNaLista)
  }

  /**
   * Upsert por `(indicador_id, referencia)` (critério 2.1.3): relançar a
   * mesma referência ATUALIZA a mesma linha e grava DUAS entradas na
   * auditoria (uma por lançamento), nunca duplica a linha.
   */
  async lancar(
    usuario: UsuarioDeGestaoPublico,
    indicadorId: string,
    dto: LancarIndicadorEntrada,
  ): Promise<LancamentoDeIndicadorNaLista> {
    // G8 2B: a referência é a segunda-feira (CE-4) e lançar R$ exige `valores` (A-6).
    exigirSegunda(dto.referencia)
    exigirValores(usuario, dto.valor != null)
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const indicador = await c.query<{ grupo_id: string }>(
        `SELECT grupo_id FROM indicadores_carteira WHERE id = $1 AND excluido_em IS NULL`,
        [indicadorId],
      )
      const grupoId = indicador.rows[0]?.grupo_id
      if (grupoId === undefined) throw new IndicadorCarteiraNaoEncontrado()

      const anterior = await c.query<LinhaLancamento>(
        `SELECT * FROM lancamentos_de_indicador WHERE indicador_id = $1 AND referencia = $2`,
        [indicadorId, dto.referencia],
      )

      const valorCentavos = dto.valor != null ? dto.valor.toString() : null
      const valorInteiro = dto.valorInteiro != null ? dto.valorInteiro.toString() : null

      const r = await c.query<LinhaLancamento>(
        `INSERT INTO lancamentos_de_indicador
           (indicador_id, grupo_id, referencia, valor_centavos, valor_inteiro, observacao, lancado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (indicador_id, referencia) DO UPDATE SET
           valor_centavos = EXCLUDED.valor_centavos,
           valor_inteiro  = EXCLUDED.valor_inteiro,
           observacao     = EXCLUDED.observacao,
           lancado_por    = EXCLUDED.lancado_por,
           atualizado_em  = now()
         RETURNING *`,
        [indicadorId, grupoId, dto.referencia, valorCentavos, valorInteiro, dto.observacao ?? null, usuario.id],
      )
      const linha = r.rows[0]!

      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: usuario.id,
        grupoId,
        tabela: 'lancamentos_de_indicador',
        registroId: linha.id,
        acao: anterior.rows[0] ? 'atualizar' : 'criar',
        de: anterior.rows[0] ?? null,
        para: linha,
      })

      return lancamentoNaLista(linha)
    })
  }

  async listarLancamentos(
    usuario: UsuarioDeGestaoPublico,
    indicadorId: string,
  ): Promise<LancamentoDeIndicadorNaLista[]> {
    const r = await this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, (c) =>
      c.query<LinhaLancamento>(
        `SELECT * FROM lancamentos_de_indicador WHERE indicador_id = $1 ORDER BY referencia DESC`,
        [indicadorId],
      ),
    )
    return r.rows.map(lancamentoNaLista)
  }
}
