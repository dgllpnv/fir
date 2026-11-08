import {
  type AnexoCarteira,
  type AnexoNoPortal,
  type DonoDeAnexo,
  LIMITE_DE_ANEXO_BYTES,
  type SituacaoDaVarredura,
  type TipoDeAnexo,
  type UsuarioDeGestaoPublico,
  type UsuarioDoPortalPublico,
} from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { inteiroDoAmbiente } from '../../comum/ambiente'
import { ARMAZENAMENTO_DE_ANEXOS, type ArmazenamentoDeAnexos } from './armazenamento-de-anexos'
import { type MotivoDeRecusa, detectarTipo, nomeParaExibir } from './tipo-pelos-bytes'

export class DonoDoAnexoNaoEncontrado extends Error {}
export class AnexoNaoEncontrado extends Error {}
export class AnexoGrandeDemais extends Error {}
export class AnexoTipoNaoAceito extends Error {
  constructor(readonly motivo: MotivoDeRecusa) {
    super(motivo)
  }
}
export class CotaDeAnexosCheia extends Error {}
export class EnviosDemaisAoMesmoTempo extends Error {}
/** Só `limpo` é servido — falha fechada (A-13). */
export class AnexoNaoLiberado extends Error {
  constructor(readonly situacao: Exclude<SituacaoDaVarredura, 'limpo'>) {
    super(situacao)
  }
}

type LinhaDeAnexo = {
  id: string
  dono_tipo: DonoDeAnexo
  dono_id: string
  nome_original: string
  tipo_mime: TipoDeAnexo
  tamanho: string
  situacao_varredura: SituacaoDaVarredura
  criado_em: Date
}

const COLUNAS = `id, dono_tipo, dono_id, nome_original, tipo_mime, tamanho, situacao_varredura, criado_em`

const anexoNaCarteira = (l: LinhaDeAnexo): AnexoCarteira => ({
  id: l.id,
  donoTipo: l.dono_tipo,
  donoId: l.dono_id,
  nome: l.nome_original,
  tipo: l.tipo_mime,
  // `bigint` no banco por causa do teto; ≤ 20 MB cabe em `number` com folga.
  tamanho: Number(l.tamanho),
  situacao: l.situacao_varredura,
  criadoEm: l.criado_em.toISOString(),
})

export type ConteudoDeAnexo = {
  readonly nome: string
  readonly tipo: TipoDeAnexo
  readonly bytes: Buffer
}

/**
 * O SEGUNDO filtro de grupo, na aplicação (regra 19). A RLS de
 * `anexos_carteira` já recusa o grupo alheio; este `AND` é o que continua de
 * pé no dia em que alguém afrouxar a policy sem perceber.
 *
 * PONTO DE EXTENSÃO "minha carteira" (D-22 item 3): quando `temPermCarteira`
 * existir, o filtro do responsável entra AQUI, num lugar só, para listagem,
 * download e remoção ao mesmo tempo.
 */
const filtroDeGrupo = (coluna: string, posicao: number): string =>
  `($${posicao}::text = 'geral' OR ${coluna} = $${posicao + 1}::uuid)`

/** Os dois parâmetros de `filtroDeGrupo`. Escopo `grupo` sem grupo compara com NULL: não vê nada. */
const parametrosDeGrupo = (usuario: UsuarioDeGestaoPublico): [string, string | null] => [
  usuario.escopo,
  usuario.grupoId,
]

/**
 * Lê o stream inteiro, contando bytes, e corta no teto (A-13: "20 MB por
 * contagem de bytes no stream"). É a TERCEIRA camada: antes dela vêm o
 * `Content-Length` (interceptor) e o `limits.fileSize` do busboy. Ela existe
 * porque as duas primeiras são configuração — e configuração muda.
 */
export async function lerAteOLimite(stream: Readable, limite: number): Promise<Buffer> {
  const partes: Buffer[] = []
  let total = 0
  for await (const pedaco of stream) {
    const b = Buffer.isBuffer(pedaco) ? pedaco : Buffer.from(pedaco as Uint8Array)
    total += b.length
    if (total > limite) {
      stream.destroy()
      throw new AnexoGrandeDemais()
    }
    partes.push(b)
  }
  return Buffer.concat(partes, total)
}

/**
 * Os ANEXOS DE ARQUIVO da carteira (G8 4C). Genérico pelo dono — reunião ou
 * documento —, para que as telas das duas usem o mesmo serviço.
 */
@Injectable()
export class AnexosService {
  /** Envios em andamento NESTE processo — cada um segura até 20 MB em memória. */
  private enviosEmAndamento = 0
  private readonly maxEnviosSimultaneos = inteiroDoAmbiente('MAX_ENVIOS_DE_ANEXO_SIMULTANEOS', 4, { min: 1 })
  /** A-13: "cota por grupo". Em MB, sobre o tamanho original dos anexos não removidos. */
  private readonly cotaPorGrupoBytes =
    inteiroDoAmbiente('COTA_DE_ANEXOS_POR_GRUPO_MB', 2048, { min: 1 }) * 1024 * 1024

  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(ARMAZENAMENTO_DE_ANEXOS) private readonly armazenamento: ArmazenamentoDeAnexos,
  ) {}

  /** O dono visível a este usuário (RLS + filtro de grupo), ou `null`. */
  private async donoVisivel(
    c: pg.PoolClient,
    usuario: UsuarioDeGestaoPublico,
    donoTipo: DonoDeAnexo,
    donoId: string,
  ): Promise<{ cliente_carteira_id: string; grupo_id: string } | null> {
    // Nome de tabela de uma lista fechada — nunca do corpo da requisição.
    const tabela = donoTipo === 'reuniao' ? 'reunioes_comerciais' : 'documentos_carteira'
    const r = await c.query<{ cliente_carteira_id: string; grupo_id: string }>(
      `SELECT cliente_carteira_id, grupo_id FROM ${tabela}
        WHERE id = $1 AND ${filtroDeGrupo('grupo_id', 2)}`,
      [donoId, ...parametrosDeGrupo(usuario)],
    )
    return r.rows[0] ?? null
  }

  /**
   * Confere o dono ANTES de ler o arquivo: um pedido para a reunião de outro
   * grupo é recusado sem que 20 MB dele cheguem à memória.
   */
  async conferirDono(usuario: UsuarioDeGestaoPublico, donoTipo: DonoDeAnexo, donoId: string): Promise<void> {
    const dono = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuario, (c) =>
      this.donoVisivel(c, usuario, donoTipo, donoId),
    )
    if (dono === null) throw new DonoDoAnexoNaoEncontrado()
  }

  async enviar(
    usuario: UsuarioDeGestaoPublico,
    donoTipo: DonoDeAnexo,
    donoId: string,
    arquivo: { readonly nomeOriginal: string; readonly stream: Readable },
  ): Promise<{ anexo: AnexoCarteira; jaExistia: boolean }> {
    if (this.enviosEmAndamento >= this.maxEnviosSimultaneos) throw new EnviosDemaisAoMesmoTempo()
    this.enviosEmAndamento++
    try {
      const bytes = await lerAteOLimite(arquivo.stream, LIMITE_DE_ANEXO_BYTES)
      const deteccao = detectarTipo(bytes, arquivo.nomeOriginal)
      if (!deteccao.aceito) throw new AnexoTipoNaoAceito(deteccao.motivo)

      const nome = nomeParaExibir(arquivo.nomeOriginal, deteccao.tipo)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const chave = randomUUID()

      // O arquivo é gravado ANTES da linha: uma linha nunca aponta para um
      // arquivo que não existe. O contrário (arquivo órfão, se o processo
      // morrer entre os dois passos) é lixo cifrado, sem linha que o sirva.
      await this.armazenamento.gravar(chave, bytes)
      let manterArquivo = false
      try {
        const r = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuario, async (c) => {
          const dono = await this.donoVisivel(c, usuario, donoTipo, donoId)
          if (dono === null) throw new DonoDoAnexoNaoEncontrado()

          // Serializa os envios do MESMO grupo: a cota é uma soma, e duas
          // somas concorrentes leriam o mesmo total antes de qualquer uma
          // inserir. A trava é da transação e cai no COMMIT/ROLLBACK.
          await c.query(`SELECT pg_advisory_xact_lock(hashtext('anexos_carteira:' || $1::text))`, [dono.grupo_id])

          const existente = await c.query<LinhaDeAnexo>(
            `SELECT ${COLUNAS} FROM anexos_carteira
              WHERE dono_tipo = $1 AND dono_id = $2 AND sha256 = $3 AND removido_em IS NULL`,
            [donoTipo, donoId, sha256],
          )
          if (existente.rows[0]) return { linha: existente.rows[0], jaExistia: true }

          const usado = await c.query<{ total: string }>(
            `SELECT coalesce(sum(tamanho), 0)::text AS total FROM anexos_carteira
              WHERE grupo_id = $1 AND removido_em IS NULL`,
            [dono.grupo_id],
          )
          if (BigInt(usado.rows[0]!.total) + BigInt(bytes.length) > BigInt(this.cotaPorGrupoBytes)) {
            throw new CotaDeAnexosCheia()
          }

          const inserido = await c.query<LinhaDeAnexo>(
            `INSERT INTO anexos_carteira
               (grupo_id, cliente_carteira_id, dono_tipo, dono_id, nome_original, tipo_mime,
                tamanho, sha256, chave_armazenamento, criado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (dono_tipo, dono_id, sha256) WHERE removido_em IS NULL DO NOTHING
             RETURNING ${COLUNAS}`,
            [dono.grupo_id, dono.cliente_carteira_id, donoTipo, donoId, nome, deteccao.tipo,
              bytes.length, sha256, chave, usuario.id],
          )
          if (inserido.rows[0]) return { linha: inserido.rows[0], jaExistia: false }
          // Corrida perdida para um envio idêntico de outra conexão: devolve o dele.
          const venceu = await c.query<LinhaDeAnexo>(
            `SELECT ${COLUNAS} FROM anexos_carteira
              WHERE dono_tipo = $1 AND dono_id = $2 AND sha256 = $3 AND removido_em IS NULL`,
            [donoTipo, donoId, sha256],
          )
          return { linha: venceu.rows[0]!, jaExistia: true }
        })
        manterArquivo = !r.jaExistia
        return { anexo: anexoNaCarteira(r.linha), jaExistia: r.jaExistia }
      } finally {
        if (!manterArquivo) await this.armazenamento.apagar(chave)
      }
    } finally {
      this.enviosEmAndamento--
    }
  }

  async listar(usuario: UsuarioDeGestaoPublico, donoTipo: DonoDeAnexo, donoId: string): Promise<AnexoCarteira[]> {
    const linhas = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuario, async (c) => {
      const r = await c.query<LinhaDeAnexo>(
        `SELECT ${COLUNAS} FROM anexos_carteira
          WHERE dono_tipo = $1 AND dono_id = $2 AND removido_em IS NULL
            AND ${filtroDeGrupo('grupo_id', 3)}
          ORDER BY criado_em, id`,
        [donoTipo, donoId, ...parametrosDeGrupo(usuario)],
      )
      return r.rows
    })
    return linhas.map(anexoNaCarteira)
  }

  /** Remover é estado (regra 20). Idempotente: remover de novo não é erro. */
  async remover(usuario: UsuarioDeGestaoPublico, id: string): Promise<void> {
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuario, async (c) => {
      const r = await c.query<{ removido_em: Date | null }>(
        `SELECT removido_em FROM anexos_carteira WHERE id = $1 AND ${filtroDeGrupo('grupo_id', 2)}`,
        [id, ...parametrosDeGrupo(usuario)],
      )
      const linha = r.rows[0]
      if (!linha) throw new AnexoNaoEncontrado()
      if (linha.removido_em !== null) return
      await c.query('UPDATE anexos_carteira SET removido_em = now() WHERE id = $1 AND removido_em IS NULL', [id])
    })
  }

  /**
   * O download pela EQUIPE. Só `limpo` (falha fechada: nem `pendente` com
   * aviso). O registro de ACESSO (A-13, LGPD) é gravado na MESMA transação
   * da leitura do metadado, ANTES de um byte do arquivo sair: se a trilha
   * falhar, o download não acontece.
   */
  async conteudoParaCarteira(usuario: UsuarioDeGestaoPublico, id: string): Promise<ConteudoDeAnexo> {
    const linha = await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuario, async (c) => {
      const r = await c.query<{
        nome_original: string
        tipo_mime: TipoDeAnexo
        chave_armazenamento: string
        situacao_varredura: SituacaoDaVarredura
      }>(
        `SELECT nome_original, tipo_mime, chave_armazenamento, situacao_varredura
           FROM anexos_carteira
          WHERE id = $1 AND removido_em IS NULL AND ${filtroDeGrupo('grupo_id', 2)}`,
        [id, ...parametrosDeGrupo(usuario)],
      )
      const l = r.rows[0]
      if (!l) throw new AnexoNaoEncontrado()
      if (l.situacao_varredura !== 'limpo') throw new AnexoNaoLiberado(l.situacao_varredura)
      await c.query(
        `INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id)
         VALUES ('usuario_gestao', $1, 'acessou', 'anexos_carteira', $2)`,
        [usuario.id, id],
      )
      return l
    })
    const bytes = await this.armazenamento.ler(linha.chave_armazenamento)
    return { nome: linha.nome_original, tipo: linha.tipo_mime, bytes }
  }

  /**
   * A listagem do PORTAL — só anexo `limpo`, não removido, de dono
   * compartilhado. A policy `anexos_carteira_portal` já impõe as três; o
   * `WHERE` repete (segunda camada).
   */
  async listarParaPortal(
    usuarioDoPortal: UsuarioDoPortalPublico,
    donoTipo: DonoDeAnexo,
    donoId: string,
  ): Promise<AnexoNoPortal[]> {
    const linhas = await this.banco.nasTabelasDaCarteiraComoPortal(usuarioDoPortal, async (c) => {
      const r = await c.query<Pick<LinhaDeAnexo, 'id' | 'nome_original' | 'tipo_mime' | 'tamanho' | 'criado_em'>>(
        `SELECT id, nome_original, tipo_mime, tamanho, criado_em
           FROM anexos_carteira
          WHERE dono_tipo = $1 AND dono_id = $2
            AND situacao_varredura = 'limpo' AND removido_em IS NULL
            AND app_portal_pode_ver(grupo_id, cliente_carteira_id)
            AND app_portal_pode_ver_dono_de_anexo(dono_tipo, dono_id)
          ORDER BY criado_em, id`,
        [donoTipo, donoId],
      )
      return r.rows
    })
    return linhas.map((l) => ({
      id: l.id,
      nome: l.nome_original,
      tipo: l.tipo_mime,
      tamanho: Number(l.tamanho),
      criadoEm: l.criado_em.toISOString(),
    }))
  }

  /**
   * O download pelo PORTAL. `pendente`, `infectado`, removido, de dono não
   * compartilhado e de outro cliente respondem TODOS como "não encontrado" —
   * do lado de fora não se distingue "existe e não pode" de "não existe".
   * O acesso é gravado com o `Usuário do portal` real, na mesma transação.
   */
  async conteudoParaPortal(usuarioDoPortal: UsuarioDoPortalPublico, id: string): Promise<ConteudoDeAnexo> {
    const linha = await this.banco.nasTabelasDaCarteiraComoPortal(usuarioDoPortal, async (c) => {
      const r = await c.query<{ nome_original: string; tipo_mime: TipoDeAnexo; chave_armazenamento: string }>(
        `SELECT nome_original, tipo_mime, chave_armazenamento
           FROM anexos_carteira
          WHERE id = $1
            AND situacao_varredura = 'limpo' AND removido_em IS NULL
            AND app_portal_pode_ver(grupo_id, cliente_carteira_id)
            AND app_portal_pode_ver_dono_de_anexo(dono_tipo, dono_id)`,
        [id],
      )
      const l = r.rows[0]
      if (!l) throw new AnexoNaoEncontrado()
      await c.query(
        `INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id)
         VALUES ('usuario_portal', $1, 'acessou', 'anexos_carteira', $2)`,
        [usuarioDoPortal.id, id],
      )
      return l
    })
    const bytes = await this.armazenamento.ler(linha.chave_armazenamento)
    return { nome: linha.nome_original, tipo: linha.tipo_mime, bytes }
  }
}
