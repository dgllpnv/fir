import type { PersonalizadosDaBibliotecaSaida } from '@fir/contracts'
import { responsavelImpostoPeloPerfil, temPermCarteira } from '@fir/domain'
import { Controller, Get, Inject, Req } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service'
import type { RequisicaoComCarteira } from '../contexto-da-carteira'
import { SoUsuarioDeGestao } from '../so-usuario-de-gestao.decorator'

type Linha = {
  id: string
  cliente_carteira_id: string
  cliente_nome: string
  titulo: string
  tipo: string
  programas: string[]
  uso_interno: boolean
  link: string | null
  texto: string | null
  descricao: string | null
}

/**
 * **O filtro "Personalizados" da Biblioteca** (X2; `vMetodo`, protótipo
 * L2689–2690: `st.bibF === "_pers"` mostra os materiais com `cliente_id`, e o
 * cartão diz "personalizado · Clínica X", L2698). G8 3D.
 *
 * A 1B deixou este filtro de fora porque uma lista CRUZANDO clientes pedia a
 * "minha carteira" (A-3). Ela mora aqui, num ponto só:
 *  - a RLS de `fir_carteira` recorta o grupo (primeira camada);
 *  - `responsavelImpostoPeloPerfil` recorta a carteira de quem só vê a
 *    própria (segunda camada, no `WHERE`) — cliente alheio não aparece nem
 *    pelo nome;
 *  - sem a tela de clientes, a lista é vazia: o personalizado é dado de um
 *    cliente, e quem não vê clientes não lê o nome deles por aqui.
 *
 * Tela `metodo` (`biblioteca/**` em `modulos-das-rotas.ts`).
 */
@SoUsuarioDeGestao()
@Controller('v1/carteira/biblioteca/personalizados')
export class PersonalizadosDaBibliotecaController {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  @Get()
  async listar(@Req() req: RequisicaoComCarteira): Promise<PersonalizadosDaBibliotecaSaida> {
    const sessao = req.carteira!.usuarioDeGestao
    if (!temPermCarteira(sessao, 'clientes')) return { materiais: [] }
    const responsavel = responsavelImpostoPeloPerfil(sessao)
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<Linha>(
        `SELECT m.id, m.cliente_carteira_id, cl.nome AS cliente_nome, m.titulo, m.tipo, m.programas,
                NOT m.visivel_portal AS uso_interno, m.link, m.texto, m.descricao
           FROM materiais_carteira m
           JOIN clientes_carteira cl ON cl.id = m.cliente_carteira_id
          WHERE m.arquivado_em IS NULL AND cl.excluido_em IS NULL
            AND ($1::uuid IS NULL OR cl.responsavel_usuario_gestao_id = $1::uuid)
          ORDER BY m.tipo, m.titulo, m.id`,
        [responsavel],
      )
      return {
        materiais: r.rows.map((l) => ({
          id: l.id,
          origem: 'personalizado' as const,
          titulo: l.titulo,
          tipo: l.tipo,
          programas: l.programas,
          usoInterno: l.uso_interno,
          link: l.link,
          texto: l.texto,
          descricao: l.descricao,
          enviadoEm: null,
          clienteCarteiraId: l.cliente_carteira_id,
          clienteNome: l.cliente_nome,
        })),
      }
    })
  }
}
