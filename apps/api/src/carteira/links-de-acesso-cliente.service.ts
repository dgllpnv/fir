import type { AtualizarLinksDeAcessoDoClienteEntrada, ClienteCarteiraNaLista, UsuarioDeGestaoPublico } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../banco/banco.service'
import { gravarAuditoriaDaCarteira } from './financeiro/auditoria-da-carteira'

export class ClienteCarteiraNaoEncontradoParaLinks extends Error {}

type LinhaCliente = {
  id: string
  grupo_id: string
  clinica_id: string
  nome: string
  produto: string
  status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado'
  link_painel: string | null
  link_dash_ind: string | null
  link_dash_fin: string | null
  link_rotina: string | null
}

const clienteNaLista = (l: LinhaCliente): ClienteCarteiraNaLista => ({
  id: l.id,
  grupoId: l.grupo_id,
  clinicaId: l.clinica_id,
  nome: l.nome,
  produto: l.produto,
  status: l.status,
  linkPainel: l.link_painel,
  linkDashInd: l.link_dash_ind,
  linkDashFin: l.link_dash_fin,
  linkRotina: l.link_rotina,
})

const SELECAO = `
  SELECT id, grupo_id, clinica_id, nome, produto, status,
         link_painel, link_dash_ind, link_dash_fin, link_rotina
    FROM clientes_carteira
`

/**
 * Os 4 LINKS DE ACESSO de um `Cliente Firmare` (migration 0036) — editados
 * pelo próprio `Usuário de Gestão` do grupo (ou geral), fora do fluxo de
 * provisionamento do ADR 0011: manter um link atualizado é rotina
 * comercial, não criação de cliente/cadastro de acesso.
 *
 * Mesma classe de escrita que `BeneficiosDeIndicacaoService`/
 * `MetasComerciaisService`: RLS (`nasTabelasDaCarteiraComEscopo`) filtra por
 * grupo antes de a linha chegar aqui, e a trilha (regra 20) grava o de→para
 * na mesma transação da escrita.
 */
@Injectable()
export class LinksDeAcessoClienteService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async atualizar(
    usuario: UsuarioDeGestaoPublico,
    clienteCarteiraId: string,
    dto: AtualizarLinksDeAcessoDoClienteEntrada,
  ): Promise<ClienteCarteiraNaLista> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, async (c) => {
      const antes = await c.query<LinhaCliente>(`${SELECAO} WHERE id = $1 AND excluido_em IS NULL`, [
        clienteCarteiraId,
      ])
      const linhaAntes = antes.rows[0]
      if (!linhaAntes) throw new ClienteCarteiraNaoEncontradoParaLinks()

      const r = await c.query<LinhaCliente>(
        `UPDATE clientes_carteira
            SET link_painel = $2, link_dash_ind = $3, link_dash_fin = $4, link_rotina = $5
          WHERE id = $1
          RETURNING id, grupo_id, clinica_id, nome, produto, status,
                    link_painel, link_dash_ind, link_dash_fin, link_rotina`,
        [clienteCarteiraId, dto.linkPainel, dto.linkDashInd, dto.linkDashFin, dto.linkRotina],
      )
      const linhaDepois = r.rows[0]!

      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: usuario.id,
        grupoId: linhaAntes.grupo_id,
        tabela: 'clientes_carteira',
        registroId: clienteCarteiraId,
        acao: 'atualizar',
        de: {
          link_painel: linhaAntes.link_painel,
          link_dash_ind: linhaAntes.link_dash_ind,
          link_dash_fin: linhaAntes.link_dash_fin,
          link_rotina: linhaAntes.link_rotina,
        },
        para: {
          link_painel: linhaDepois.link_painel,
          link_dash_ind: linhaDepois.link_dash_ind,
          link_dash_fin: linhaDepois.link_dash_fin,
          link_rotina: linhaDepois.link_rotina,
        },
      })

      return clienteNaLista(linhaDepois)
    })
  }
}
