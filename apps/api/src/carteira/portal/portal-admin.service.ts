import type {
  CriarUsuarioDoPortalClienteEntrada,
  CriarUsuarioDoPortalGrupoEntrada,
  UsuarioDoPortalPublico,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import type { OperadorId } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { gerarProvisoria } from '../../pessoas/escrita-de-pessoa'

export class ClienteCarteiraNaoVisivelParaEsteUsuarioDeGestao extends Error {}
export class GrupoNaoEncontradoParaPortal extends Error {}
export class UsuarioDoPortalJaExiste extends Error {}

const UNICIDADE_VIOLADA = '23505'

type LinhaUsuarioDoPortal = {
  id: string
  usuario: string
  nome: string
  escopo: 'cliente' | 'grupo'
  cliente_carteira_id: string | null
  grupo_id: string | null
}

const usuarioDoPortalPublico = (l: LinhaUsuarioDoPortal): UsuarioDoPortalPublico => ({
  id: l.id,
  usuario: l.usuario,
  nome: l.nome,
  escopo: l.escopo,
  clienteCarteiraId: l.cliente_carteira_id,
  grupoId: l.grupo_id,
  senhaProvisoria: true,
})

/**
 * Quem cria `Usuário do portal` — spec G6 §1.3, decisão tiered por risco:
 *
 *  - `escopo='cliente'`: o `Usuário de Gestão` responsável por aquele
 *    `Cliente Firmare`, dentro do próprio grupo/escopo — equivalente exato
 *    do botão "Criar acesso" do protótipo (`fg-supabase.js:228`).
 *  - `escopo='grupo'`: SÓ o `Operador` — risco estruturalmente maior,
 *    primeira vez que um ator do lado do cliente lê mais de uma clínica
 *    numa sessão só (mesmo ponto de entrada único já fixado para `Grupo`/
 *    `Usuário de Gestão`, ADR 0011 §2).
 *
 * Nunca autoatendimento: nenhuma tela permite que um `Usuário do portal`
 * crie outro, de nenhum escopo.
 */
@Injectable()
export class PortalAdminService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * `escopo='cliente'`, pelo `Usuário de Gestão` responsável. A autorização
   * é a PRÓPRIA RLS: a conexão roda como este `Usuário de Gestão`
   * (`nasTabelasDaCarteiraComoUsuarioDeGestao`), então um `clienteCarteiraId`
   * fora do grupo dele simplesmente NÃO APARECE no `SELECT` — a recusa nunca
   * depende de um `if` escrito à mão contra `escopo`/`grupoId`.
   */
  async criarParaCliente(
    usuarioDeGestao: UsuarioDeGestaoPublico,
    dto: CriarUsuarioDoPortalClienteEntrada,
  ): Promise<{ usuarioDoPortal: UsuarioDoPortalPublico; senhaProvisoria: string }> {
    const provisoria = await gerarProvisoria(this.relogio.agora())

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuarioDeGestao, async (c) => {
      const cliente = await c.query<{ id: string }>(
        `SELECT id FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL`,
        [dto.clienteCarteiraId],
      )
      if (cliente.rows.length === 0) throw new ClienteCarteiraNaoVisivelParaEsteUsuarioDeGestao()

      let linha: LinhaUsuarioDoPortal
      try {
        const r = await c.query<LinhaUsuarioDoPortal>(
          `INSERT INTO usuarios_do_portal
             (usuario, nome, senha_hash, escopo, cliente_carteira_id, senha_provisoria, senha_provisoria_expira_em)
           VALUES ($1, $2, $3, 'cliente', $4, true, $5)
           RETURNING id, usuario, nome, escopo, cliente_carteira_id, grupo_id`,
          [dto.usuario, dto.nome, provisoria.hash, dto.clienteCarteiraId, provisoria.expiraEm],
        )
        linha = r.rows[0]!
      } catch (e) {
        if ((e as { code?: string }).code === UNICIDADE_VIOLADA) throw new UsuarioDoPortalJaExiste()
        throw e
      }

      return { usuarioDoPortal: usuarioDoPortalPublico(linha), senhaProvisoria: provisoria.senha }
    })
  }

  /**
   * `escopo='grupo'`, SÓ pelo `Operador` — o `@SoOperador()` do controlador
   * já garante que só ele chega aqui; esta função não confere de novo o
   * ATOR (seria redundante), mas confere que o `Grupo` existe de verdade.
   */
  async criarParaGrupo(
    operador: OperadorId,
    dto: CriarUsuarioDoPortalGrupoEntrada,
  ): Promise<{ usuarioDoPortal: UsuarioDoPortalPublico; senhaProvisoria: string }> {
    const provisoria = await gerarProvisoria(this.relogio.agora())

    return this.banco.nasTabelasDaCarteiraComoOperador(operador, async (c) => {
      const grupo = await c.query<{ id: string }>(`SELECT id FROM grupos WHERE id = $1`, [dto.grupoId])
      if (grupo.rows.length === 0) throw new GrupoNaoEncontradoParaPortal()

      let linha: LinhaUsuarioDoPortal
      try {
        const r = await c.query<LinhaUsuarioDoPortal>(
          `INSERT INTO usuarios_do_portal
             (usuario, nome, senha_hash, escopo, grupo_id, senha_provisoria, senha_provisoria_expira_em)
           VALUES ($1, $2, $3, 'grupo', $4, true, $5)
           RETURNING id, usuario, nome, escopo, cliente_carteira_id, grupo_id`,
          [dto.usuario, dto.nome, provisoria.hash, dto.grupoId, provisoria.expiraEm],
        )
        linha = r.rows[0]!
      } catch (e) {
        if ((e as { code?: string }).code === UNICIDADE_VIOLADA) throw new UsuarioDoPortalJaExiste()
        throw e
      }

      return { usuarioDoPortal: usuarioDoPortalPublico(linha), senhaProvisoria: provisoria.senha }
    })
  }
}
