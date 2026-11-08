import type {
  AcessoDoPortalNaLista,
  AcessosDoPortalSaida,
  CriarUsuarioDoPortalClienteEntrada,
  CriarUsuarioDoPortalGrupoEntrada,
  UsuarioDoPortalPublico,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import { temPermCarteira } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import type { OperadorId } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { registrarNoPainel } from '../../painel/painel.service'
import { gerarProvisoria } from '../../pessoas/escrita-de-pessoa'

export class ClienteCarteiraNaoVisivelParaEsteUsuarioDeGestao extends Error {}
export class GrupoNaoEncontradoParaPortal extends Error {}
export class UsuarioDoPortalJaExiste extends Error {}
/** A conta não existe, é de outro cliente, é de grupo (só o Operador) ou já está desativada. */
export class AcessoDoPortalNaoEncontrado extends Error {}
/** Conceder ou retirar "vê valores" exige ver valores (LGPD A52). */
export class SemPermissaoDeValores extends Error {}

const UNICIDADE_VIOLADA = '23505'

/**
 * O driver `pg` não tipa `code` no `Error` que lança — é uma propriedade
 * que ele anexa em runtime, lida direto do SQLSTATE do Postgres. O `as` abaixo
 * é seguro porque `code`, quando presente, é sempre essa string de 5
 * caracteres; quando ausente (erro que não veio do banco), `code` é
 * `undefined` e a comparação com `UNICIDADE_VIOLADA` simplesmente falha.
 */
const codigoPg = (e: unknown): string | undefined => (e as { code?: string }).code

type LinhaUsuarioDoPortal = {
  id: string
  usuario: string
  nome: string
  escopo: 'cliente' | 'grupo'
  cliente_carteira_id: string | null
  grupo_id: string | null
  senha_provisoria: boolean
  ve_valores: boolean
}

const COLUNAS = 'id, usuario, nome, escopo, cliente_carteira_id, grupo_id, senha_provisoria, ve_valores'

const usuarioDoPortalPublico = (l: LinhaUsuarioDoPortal): UsuarioDoPortalPublico => ({
  id: l.id,
  usuario: l.usuario,
  nome: l.nome,
  escopo: l.escopo,
  clienteCarteiraId: l.cliente_carteira_id,
  grupoId: l.grupo_id,
  senhaProvisoria: l.senha_provisoria,
  veValores: l.ve_valores,
})

type LinhaAcesso = {
  id: string
  usuario: string
  nome: string
  ativo: boolean
  ve_valores: boolean
  senha_provisoria: boolean
  criado_em: Date
}

const acessoNaLista = (l: LinhaAcesso): AcessoDoPortalNaLista => ({
  id: l.id,
  usuario: l.usuario,
  nome: l.nome,
  ativo: l.ativo,
  veValores: l.ve_valores,
  senhaProvisoria: l.senha_provisoria,
  criadoEm: l.criado_em.toISOString(),
})

/**
 * O cliente da rota, sob a RLS da sessão do `Usuário de Gestão`: fora do
 * grupo dele, simplesmente não aparece — a recusa nunca depende de um `if`
 * escrito à mão contra `escopo`/`grupoId`. A "minha carteira" (A-3) já foi
 * conferida pelo `CarteiraGuard`, pelo `clienteCarteiraId`/`:id` da rota.
 */
async function clienteVisivel(c: pg.PoolClient, clienteId: string): Promise<void> {
  const r = await c.query(`SELECT 1 FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL`, [clienteId])
  if (r.rows.length === 0) throw new ClienteCarteiraNaoVisivelParaEsteUsuarioDeGestao()
}

/**
 * `usuarios_do_portal` não tem RLS (mesma forma de `usuarios_gestao`), então
 * a conta é amarrada ao cliente À MÃO, e o cliente pela RLS acima: só conta
 * `escopo='cliente'` DESTE cliente. A de grupo é do Operador (spec G6 §1.3),
 * e não se alcança por aqui. `FOR UPDATE`: duas abas gerando senha ao mesmo
 * tempo não se atropelam.
 */
async function contaDoCliente(c: pg.PoolClient, clienteId: string, usuarioId: string): Promise<LinhaUsuarioDoPortal & { ativo: boolean }> {
  await clienteVisivel(c, clienteId)
  const r = await c.query<LinhaUsuarioDoPortal & { ativo: boolean }>(
    `SELECT ${COLUNAS}, ativo FROM usuarios_do_portal
      WHERE id = $1 AND escopo = 'cliente' AND cliente_carteira_id = $2
      FOR UPDATE`,
    [usuarioId, clienteId],
  )
  const conta = r.rows[0]
  if (!conta || !conta.ativo) throw new AcessoDoPortalNaoEncontrado()
  return conta
}

/** Desativar e trocar a senha derrubam toda sessão aberta da conta (appsec A-18, caso 61). */
async function revogarSessoes(c: pg.PoolClient, usuarioId: string): Promise<void> {
  await c.query(
    `UPDATE sessoes_do_portal SET revogada_em = now() WHERE usuario_portal_id = $1 AND revogada_em IS NULL`,
    [usuarioId],
  )
}

/**
 * Quem cria e administra `Usuário do portal` — spec G6 §1.3, decisão tiered
 * por risco:
 *
 *  - `escopo='cliente'`: o `Usuário de Gestão` que vê aquele `Cliente
 *    Firmare`, dentro do próprio grupo/escopo e da "minha carteira" — o
 *    "Criar acesso da cliente", "Gerar nova senha" e "Remover" do protótipo
 *    (`fg-supabase.js` L237–276);
 *  - `escopo='grupo'`: SÓ o `Operador` — primeira vez que um ator do lado do
 *    cliente lê mais de uma clínica numa sessão só (ADR 0011 §2).
 *
 * Nunca autoatendimento: nenhuma tela permite que um `Usuário do portal`
 * crie outro, de nenhum escopo. Toda escrita de identidade deixa trilha em
 * `auditoria_do_painel` (regra 20), sem senha nem hash.
 */
@Injectable()
export class PortalAdminService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * `escopo='cliente'`. A PRIMEIRA conta ativa do cliente é a do titular e
   * nasce vendo valores; as seguintes nascem sem (LGPD A52) — quem tem
   * `valores` concede depois, conta a conta.
   */
  async criarParaCliente(
    usuarioDeGestao: UsuarioDeGestaoPublico,
    dto: CriarUsuarioDoPortalClienteEntrada,
  ): Promise<{ usuarioDoPortal: UsuarioDoPortalPublico; senhaProvisoria: string }> {
    const provisoria = await gerarProvisoria(this.relogio.agora())

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuarioDeGestao, async (c) => {
      await clienteVisivel(c, dto.clienteCarteiraId)

      let linha: LinhaUsuarioDoPortal
      try {
        const r = await c.query<LinhaUsuarioDoPortal>(
          `INSERT INTO usuarios_do_portal
             (usuario, nome, senha_hash, escopo, cliente_carteira_id, senha_provisoria, senha_provisoria_expira_em, ve_valores)
           VALUES ($1, $2, $3, 'cliente', $4, true, $5,
                   NOT EXISTS (SELECT 1 FROM usuarios_do_portal
                                WHERE cliente_carteira_id = $4 AND escopo = 'cliente' AND ativo))
           RETURNING ${COLUNAS}`,
          [dto.usuario, dto.nome, provisoria.hash, dto.clienteCarteiraId, provisoria.expiraEm],
        )
        linha = r.rows[0]!
      } catch (e) {
        if (codigoPg(e) === UNICIDADE_VIOLADA) throw new UsuarioDoPortalJaExiste()
        throw e
      }

      await registrarNoPainel(c, {
        atorTipo: 'usuario_gestao',
        atorId: usuarioDeGestao.id,
        acao: 'criou',
        entidade: 'usuarios_do_portal',
        entidadeId: linha.id,
        para: { usuario: linha.usuario, escopo: 'cliente', cliente_carteira_id: linha.cliente_carteira_id, ve_valores: linha.ve_valores },
      })
      return { usuarioDoPortal: usuarioDoPortalPublico(linha), senhaProvisoria: provisoria.senha }
    })
  }

  /** V7 / O10: os acessos de UM cliente, ativos primeiro. Nunca o hash. */
  async listarDoCliente(usuarioDeGestao: UsuarioDeGestaoPublico, clienteId: string): Promise<AcessosDoPortalSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuarioDeGestao, async (c) => {
      await clienteVisivel(c, clienteId)
      const r = await c.query<LinhaAcesso>(
        `SELECT id, usuario, nome, ativo, ve_valores, senha_provisoria, criado_em
           FROM usuarios_do_portal
          WHERE escopo = 'cliente' AND cliente_carteira_id = $1
          ORDER BY ativo DESC, criado_em, id`,
        [clienteId],
      )
      return { acessos: r.rows.map(acessoNaLista), podeConcederValores: temPermCarteira(usuarioDeGestao, 'valores') }
    })
  }

  /**
   * "Gerar nova senha" (`sb:L264-265`): provisória nova, com expiração,
   * mostrada uma vez; derruba as sessões abertas da conta (caso 61).
   */
  async novaSenha(
    usuarioDeGestao: UsuarioDeGestaoPublico,
    clienteId: string,
    usuarioId: string,
  ): Promise<{ usuarioDoPortal: UsuarioDoPortalPublico; senhaProvisoria: string }> {
    const provisoria = await gerarProvisoria(this.relogio.agora())
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuarioDeGestao, async (c) => {
      await contaDoCliente(c, clienteId, usuarioId)
      const r = await c.query<LinhaUsuarioDoPortal>(
        `UPDATE usuarios_do_portal
            SET senha_hash = $1, senha_provisoria = true, senha_provisoria_expira_em = $2
          WHERE id = $3
          RETURNING ${COLUNAS}`,
        [provisoria.hash, provisoria.expiraEm, usuarioId],
      )
      await revogarSessoes(c, usuarioId)
      await registrarNoPainel(c, {
        atorTipo: 'usuario_gestao',
        atorId: usuarioDeGestao.id,
        acao: 'alterou',
        entidade: 'usuarios_do_portal',
        entidadeId: usuarioId,
        para: { senha_hash: '(nova senha provisória gerada pela equipe)' },
      })
      return { usuarioDoPortal: usuarioDoPortalPublico(r.rows[0]!), senhaProvisoria: provisoria.senha }
    })
  }

  /** "Remover" (`sb:L266-267`) vira DESATIVAR — estado, nunca exclusão (regra 20) — e derruba as sessões. */
  async desativar(usuarioDeGestao: UsuarioDeGestaoPublico, clienteId: string, usuarioId: string): Promise<void> {
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuarioDeGestao, async (c) => {
      await contaDoCliente(c, clienteId, usuarioId)
      await c.query(`UPDATE usuarios_do_portal SET ativo = false WHERE id = $1`, [usuarioId])
      await revogarSessoes(c, usuarioId)
      await registrarNoPainel(c, {
        atorTipo: 'usuario_gestao',
        atorId: usuarioDeGestao.id,
        acao: 'alterou',
        entidade: 'usuarios_do_portal',
        entidadeId: usuarioId,
        de: { ativo: true },
        para: { ativo: false },
      })
    })
  }

  /** LGPD A52: concede ou retira "vê cobranças e receita" de uma conta. Só quem tem `valores`. */
  async alterarVeValores(
    usuarioDeGestao: UsuarioDeGestaoPublico,
    clienteId: string,
    usuarioId: string,
    veValores: boolean,
  ): Promise<AcessoDoPortalNaLista> {
    if (!temPermCarteira(usuarioDeGestao, 'valores')) throw new SemPermissaoDeValores()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuarioDeGestao, async (c) => {
      const antes = await contaDoCliente(c, clienteId, usuarioId)
      const r = await c.query<LinhaAcesso>(
        `UPDATE usuarios_do_portal SET ve_valores = $1 WHERE id = $2
          RETURNING id, usuario, nome, ativo, ve_valores, senha_provisoria, criado_em`,
        [veValores, usuarioId],
      )
      if (antes.ve_valores !== veValores) {
        await registrarNoPainel(c, {
          atorTipo: 'usuario_gestao',
          atorId: usuarioDeGestao.id,
          acao: 'alterou',
          entidade: 'usuarios_do_portal',
          entidadeId: usuarioId,
          de: { ve_valores: antes.ve_valores },
          para: { ve_valores: veValores },
        })
      }
      return acessoNaLista(r.rows[0]!)
    })
  }

  /**
   * `escopo='grupo'`, SÓ pelo `Operador` — o `@SoOperador()` do controlador
   * já garante que só ele chega aqui; esta função confere que o `Grupo`
   * existe de verdade. A conta de grupo é a do dono da rede: vê valores
   * (LGPD A52 — o Operador a cria para o titular).
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
             (usuario, nome, senha_hash, escopo, grupo_id, senha_provisoria, senha_provisoria_expira_em, ve_valores)
           VALUES ($1, $2, $3, 'grupo', $4, true, $5, true)
           RETURNING ${COLUNAS}`,
          [dto.usuario, dto.nome, provisoria.hash, dto.grupoId, provisoria.expiraEm],
        )
        linha = r.rows[0]!
      } catch (e) {
        if (codigoPg(e) === UNICIDADE_VIOLADA) throw new UsuarioDoPortalJaExiste()
        throw e
      }

      return { usuarioDoPortal: usuarioDoPortalPublico(linha), senhaProvisoria: provisoria.senha }
    })
  }
}
