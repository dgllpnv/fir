import type {
  BibliotecaSaida,
  CriarDocumentoEntrada,
  CriarMaterialDaBibliotecaEntrada,
  CriarMaterialDoClienteEntrada,
  DocumentoNaLista,
  DocumentosDoClienteSaida,
  EditarDocumentoEntrada,
  EditarMaterialDaBibliotecaEntrada,
  EditarMaterialDoClienteEntrada,
  MateriaisDoClienteSaida,
  MaterialNaLista,
  RegistrarEnvioDeMaterialEntrada,
} from '@fir/contracts'
import { diaCivil, materiaisParaOCliente, podeAdministrarConteudo, programaDoCliente } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import {
  ConteudoArquivado,
  EntradaInvalida,
  NaoEncontrado,
  type Sessao,
  SemPermissaoDeAdministrar,
  clienteVisivel,
  partesDoUpdate,
} from './conteudo-comum'

type LinhaDocumento = {
  id: string
  cliente_carteira_id: string
  titulo: string
  categoria: string
  link: string
  data: string
  visivel_portal: boolean
}

const COLUNAS_DOCUMENTO = 'id, cliente_carteira_id, titulo, categoria, link, data::text AS data, visivel_portal'

const documentoParaContrato = (l: LinhaDocumento): DocumentoNaLista => ({
  id: l.id,
  clienteCarteiraId: l.cliente_carteira_id,
  titulo: l.titulo,
  categoria: l.categoria,
  link: l.link,
  data: l.data,
  visivelPortal: l.visivel_portal,
})

type LinhaMaterial = {
  id: string
  titulo: string
  tipo: string
  programas: string[]
  uso_interno: boolean
  link: string | null
  texto: string | null
  descricao: string | null
}

const COLUNAS_PERSONALIZADO =
  'id, titulo, tipo, programas, NOT visivel_portal AS uso_interno, link, texto, descricao'
const COLUNAS_BIBLIOTECA = 'id, titulo, tipo, programas, uso_interno, link, texto, descricao'

const materialParaContrato = (
  l: LinhaMaterial,
  origem: MaterialNaLista['origem'],
  enviadoEm: string | null,
): MaterialNaLista => ({
  id: l.id,
  origem,
  titulo: l.titulo,
  tipo: l.tipo,
  programas: l.programas,
  usoInterno: l.uso_interno,
  link: l.link,
  texto: l.texto,
  descricao: l.descricao,
  enviadoEm,
})

/**
 * **V13 (documentos) e X2 (materiais)** — `cDocumentos`,
 * `cDocumentosProprios`, `materiaisDoCliente`, `cardMaterial`, `vMetodo`
 * (biblioteca), protótipo L1639–1646, L2677–2717.
 *
 * Mesmas duas camadas da reunião: RLS por grupo (sessão do `Usuário de
 * Gestão`) e grupo da escrita lido do cliente, nunca do corpo. Trilha pelo
 * trigger `registrar_auditoria_do_painel` (0048).
 */
@Injectable()
export class DocumentosEMateriaisService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /* ── Documentos ────────────────────────────────────────────────────── */

  async listarDocumentos(sessao: Sessao, clienteId: string): Promise<DocumentosDoClienteSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      const r = await c.query<LinhaDocumento>(
        `SELECT ${COLUNAS_DOCUMENTO} FROM documentos_carteira
          WHERE cliente_carteira_id = $1 AND arquivado_em IS NULL
          ORDER BY data DESC, criado_em DESC`,
        [cliente.id],
      )
      return { documentos: r.rows.map(documentoParaContrato), podeAdministrar: podeAdministrarConteudo(sessao) }
    })
  }

  /** A data do documento é o dia do cadastro no fuso da carteira (servidor, regra 24). */
  async criarDocumento(sessao: Sessao, clienteId: string, dados: CriarDocumentoEntrada): Promise<DocumentoNaLista> {
    const hoje = diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      const r = await c.query<LinhaDocumento>(
        `INSERT INTO documentos_carteira
           (cliente_carteira_id, grupo_id, titulo, categoria, link, data, visivel_portal, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${COLUNAS_DOCUMENTO}`,
        [cliente.id, cliente.grupo_id, dados.titulo, dados.categoria, dados.link, hoje, dados.visivelPortal, sessao.id],
      )
      return documentoParaContrato(r.rows[0]!)
    })
  }

  async editarDocumento(sessao: Sessao, documentoId: string, dados: EditarDocumentoEntrada): Promise<DocumentoNaLista> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      await this.travarVivo(c, 'documentos_carteira', documentoId)
      const { sets, valores } = partesDoUpdate(
        [
          ['titulo', dados.titulo],
          ['categoria', dados.categoria],
          ['link', dados.link],
          ['visivel_portal', dados.visivelPortal],
        ],
        2,
      )
      if (sets.length > 0) {
        await c.query(`UPDATE documentos_carteira SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1`, [
          documentoId,
          ...valores,
        ])
      }
      const r = await c.query<LinhaDocumento>(`SELECT ${COLUNAS_DOCUMENTO} FROM documentos_carteira WHERE id = $1`, [
        documentoId,
      ])
      return documentoParaContrato(r.rows[0]!)
    })
  }

  /** "Excluir" (só diretoria, L1644) vira arquivar. */
  async arquivarDocumento(sessao: Sessao, documentoId: string): Promise<void> {
    if (!podeAdministrarConteudo(sessao)) throw new SemPermissaoDeAdministrar()
    await this.arquivar(sessao, 'documentos_carteira', documentoId)
  }

  /* ── Materiais do cliente ──────────────────────────────────────────── */

  /**
   * A aba de materiais da ficha (`materiaisDoCliente`): os personalizados do
   * cliente, os do programa dele e os de outros programas. O de uso interno
   * da biblioteca não aparece aqui (L2707: `m.cliente !== "nao"`).
   */
  async materiaisDoCliente(sessao: Sessao, clienteId: string): Promise<MateriaisDoClienteSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      const personalizados = await c.query<LinhaMaterial>(
        `SELECT ${COLUNAS_PERSONALIZADO} FROM materiais_carteira
          WHERE cliente_carteira_id = $1 AND arquivado_em IS NULL
          ORDER BY tipo, titulo`,
        [cliente.id],
      )
      const biblioteca = await c.query<LinhaMaterial>(
        `SELECT ${COLUNAS_BIBLIOTECA} FROM materiais_da_biblioteca
          WHERE arquivado_em IS NULL
          ORDER BY tipo, titulo`,
      )
      const envios = await c.query<{ material: string; enviado_em: Date }>(
        `SELECT coalesce(material_biblioteca_id, material_carteira_id) AS material, max(enviado_em) AS enviado_em
           FROM envios_de_material
          WHERE cliente_carteira_id = $1
          GROUP BY 1`,
        [cliente.id],
      )
      const enviado = new Map(envios.rows.map((e) => [e.material, diaCivil(e.enviado_em, FUSO_DA_CARTEIRA)]))
      const programa = programaDoCliente({ areaFoco: null, produto: cliente.produto })
      const geral = biblioteca.rows.map((l) => ({ ...l, usoInterno: l.uso_interno }))
      const { doPrograma, deOutrosProgramas } = materiaisParaOCliente(programa, geral)
      return {
        programa,
        personalizados: personalizados.rows.map((l) =>
          materialParaContrato(l, 'personalizado', enviado.get(l.id) ?? null),
        ),
        doPrograma: doPrograma.map((l) => materialParaContrato(l, 'biblioteca', enviado.get(l.id) ?? null)),
        deOutrosProgramas: deOutrosProgramas.map((l) => materialParaContrato(l, 'biblioteca', null)),
      }
    })
  }

  async criarMaterialDoCliente(
    sessao: Sessao,
    clienteId: string,
    dados: CriarMaterialDoClienteEntrada,
  ): Promise<MaterialNaLista> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      const r = await c.query<LinhaMaterial>(
        `INSERT INTO materiais_carteira
           (cliente_carteira_id, grupo_id, titulo, tipo, programas, link, texto, descricao, visivel_portal, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${COLUNAS_PERSONALIZADO}`,
        [
          cliente.id,
          cliente.grupo_id,
          dados.titulo,
          dados.tipo,
          dados.programas,
          dados.link,
          dados.texto,
          dados.descricao,
          dados.visivelPortal,
          sessao.id,
        ],
      )
      return materialParaContrato(r.rows[0]!, 'personalizado', null)
    })
  }

  async editarMaterialDoCliente(
    sessao: Sessao,
    materialId: string,
    dados: EditarMaterialDoClienteEntrada,
  ): Promise<MaterialNaLista> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      await this.travarVivo(c, 'materiais_carteira', materialId)
      const { sets, valores } = partesDoUpdate(
        [
          ['titulo', dados.titulo],
          ['tipo', dados.tipo],
          ['programas', dados.programas],
          ['link', dados.link],
          ['texto', dados.texto],
          ['descricao', dados.descricao],
          ['visivel_portal', dados.visivelPortal],
        ],
        2,
      )
      if (sets.length > 0) {
        await c.query(`UPDATE materiais_carteira SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1`, [
          materialId,
          ...valores,
        ])
      }
      const r = await c.query<LinhaMaterial>(`SELECT ${COLUNAS_PERSONALIZADO} FROM materiais_carteira WHERE id = $1`, [
        materialId,
      ])
      return materialParaContrato(r.rows[0]!, 'personalizado', null)
    })
  }

  /**
   * O personalizado se exclui pelo próprio "Editar" no protótipo
   * (`data-editmat` L2804, para quem edita o personalizado). Aqui vira
   * arquivar, e não exige `carteira.administrar`: é material do cliente, da
   * mesma equipe que o criou.
   */
  async arquivarMaterialDoCliente(sessao: Sessao, materialId: string): Promise<void> {
    await this.arquivar(sessao, 'materiais_carteira', materialId)
  }

  /**
   * "Envio registrado" (L2810). O material precisa poder ir para a cliente:
   * da biblioteca, sem `uso_interno`; personalizado, DESTE cliente e com
   * `visivel_portal`. Tudo conferido sob a RLS da sessão antes do INSERT.
   */
  async registrarEnvio(
    sessao: Sessao,
    clienteId: string,
    dados: RegistrarEnvioDeMaterialEntrada,
  ): Promise<{ enviadoEm: string }> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      const pode =
        dados.origem === 'biblioteca'
          ? await c.query(
              'SELECT 1 FROM materiais_da_biblioteca WHERE id = $1 AND NOT uso_interno AND arquivado_em IS NULL',
              [dados.materialId],
            )
          : await c.query(
              `SELECT 1 FROM materiais_carteira
                WHERE id = $1 AND cliente_carteira_id = $2 AND visivel_portal AND arquivado_em IS NULL`,
              [dados.materialId, cliente.id],
            )
      if (!pode.rows[0]) throw new NaoEncontrado()
      const r = await c.query<{ enviado_em: Date }>(
        `INSERT INTO envios_de_material
           (cliente_carteira_id, grupo_id, material_biblioteca_id, material_carteira_id, por_usuario_gestao_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING enviado_em`,
        [
          cliente.id,
          cliente.grupo_id,
          dados.origem === 'biblioteca' ? dados.materialId : null,
          dados.origem === 'personalizado' ? dados.materialId : null,
          sessao.id,
        ],
      )
      return { enviadoEm: diaCivil(r.rows[0]!.enviado_em, FUSO_DA_CARTEIRA) }
    })
  }

  /* ── Biblioteca geral ──────────────────────────────────────────────── */

  /** Leitura liberada à carteira (A-18) — a tela do Método mostra o de uso interno também. */
  async biblioteca(sessao: Sessao): Promise<BibliotecaSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<LinhaMaterial>(
        `SELECT ${COLUNAS_BIBLIOTECA} FROM materiais_da_biblioteca
          WHERE arquivado_em IS NULL
          ORDER BY tipo, titulo`,
      )
      return {
        materiais: r.rows.map((l) => materialParaContrato(l, 'biblioteca', null)),
        podeAdministrar: podeAdministrarConteudo(sessao),
      }
    })
  }

  /**
   * Escrita na biblioteca: só quem administra (A-18/A-19). Primeira camada
   * aqui; a segunda é a policy `app_escopo() = 'geral'` da 0048.
   */
  async criarNaBiblioteca(sessao: Sessao, dados: CriarMaterialDaBibliotecaEntrada): Promise<MaterialNaLista> {
    if (!podeAdministrarConteudo(sessao)) throw new SemPermissaoDeAdministrar()
    if (dados.programas.length === 0 && !dados.usoInterno) {
      // Sem programa, o material geral não aparece na ficha de cliente nenhuma
      // (`materiaisParaOCliente`) — seria um cadastro invisível.
      throw new EntradaInvalida('SEM_PROGRAMA', 'Marque ao menos um programa, ou "Todos".')
    }
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<LinhaMaterial>(
        `INSERT INTO materiais_da_biblioteca
           (titulo, tipo, uso_interno, programas, link, texto, descricao, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${COLUNAS_BIBLIOTECA}`,
        [dados.titulo, dados.tipo, dados.usoInterno, dados.programas, dados.link, dados.texto, dados.descricao, sessao.id],
      )
      return materialParaContrato(r.rows[0]!, 'biblioteca', null)
    })
  }

  async editarNaBiblioteca(
    sessao: Sessao,
    materialId: string,
    dados: EditarMaterialDaBibliotecaEntrada,
  ): Promise<MaterialNaLista> {
    if (!podeAdministrarConteudo(sessao)) throw new SemPermissaoDeAdministrar()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      await this.travarVivo(c, 'materiais_da_biblioteca', materialId)
      const { sets, valores } = partesDoUpdate(
        [
          ['titulo', dados.titulo],
          ['tipo', dados.tipo],
          ['uso_interno', dados.usoInterno],
          ['programas', dados.programas],
          ['link', dados.link],
          ['texto', dados.texto],
          ['descricao', dados.descricao],
        ],
        2,
      )
      if (sets.length > 0) {
        await c.query(`UPDATE materiais_da_biblioteca SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1`, [
          materialId,
          ...valores,
        ])
      }
      const r = await c.query<LinhaMaterial>(`SELECT ${COLUNAS_BIBLIOTECA} FROM materiais_da_biblioteca WHERE id = $1`, [
        materialId,
      ])
      return materialParaContrato(r.rows[0]!, 'biblioteca', null)
    })
  }

  async arquivarNaBiblioteca(sessao: Sessao, materialId: string): Promise<void> {
    if (!podeAdministrarConteudo(sessao)) throw new SemPermissaoDeAdministrar()
    await this.arquivar(sessao, 'materiais_da_biblioteca', materialId)
  }

  /* ── apoio ─────────────────────────────────────────────────────────── */

  /**
   * Trava a linha sob a RLS da sessão. Ausente = 404 (não existe ou é de
   * outro grupo); arquivada = 409. `tabela` é sempre um literal deste
   * arquivo, nunca entrada do usuário.
   */
  private async travarVivo(
    c: pg.PoolClient,
    tabela: 'documentos_carteira' | 'materiais_carteira' | 'materiais_da_biblioteca',
    id: string,
  ): Promise<void> {
    const r = await c.query<{ arquivado_em: Date | null }>(
      `SELECT arquivado_em FROM ${tabela} WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const linha = r.rows[0]
    if (!linha) throw new NaoEncontrado()
    if (linha.arquivado_em !== null) throw new ConteudoArquivado()
  }

  private async arquivar(
    sessao: Sessao,
    tabela: 'documentos_carteira' | 'materiais_carteira' | 'materiais_da_biblioteca',
    id: string,
  ): Promise<void> {
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const r = await c.query<{ arquivado_em: Date | null }>(
        `SELECT arquivado_em FROM ${tabela} WHERE id = $1 FOR UPDATE`,
        [id],
      )
      const linha = r.rows[0]
      if (!linha) throw new NaoEncontrado()
      if (linha.arquivado_em !== null) return
      await c.query(`UPDATE ${tabela} SET arquivado_em = now() WHERE id = $1`, [id])
    })
  }
}
