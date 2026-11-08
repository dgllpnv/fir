import type {
  AnexoPorLink,
  CompartilharTodasEntrada,
  EditarReuniaoEntrada,
  IdsDoAsanaImportadosSaida,
  ImportacaoDoAsanaSaida,
  ImportarDoAsanaEntrada,
  MudarCompartilhamentoEntrada,
  PessoaDaFirmare,
  RegistrarReuniaoEntrada,
  ReuniaoNaLista,
  ReunioesDoClienteSaida,
} from '@fir/contracts'
import {
  diaCivil,
  ehErro,
  linhasDeEncaminhamento,
  podeAdministrarConteudo,
  resumoDaTarefa,
  saudeDerivadaDoCliente,
  somarDias,
  type SaudeDoCliente,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { SISTEMA } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../../banco/clinica-id'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import {
  ChaveReutilizada,
  ConteudoArquivado,
  ContagemMudou,
  EntradaInvalida,
  MotivoObrigatorio,
  NaoEncontrado,
  ResponsavelInvalido,
  type Sessao,
  SemPermissaoDeAdministrar,
  clienteVisivel,
  partesDoUpdate,
  registrarAcessoAsAtas,
} from './conteudo-comum'

type LinhaReuniao = {
  id: string
  cliente_carteira_id: string
  data: string
  tipo: ReuniaoNaLista['tipo']
  participantes: string | null
  resumo: string
  encaminhamentos: string | null
  notas_internas: string | null
  saude_registrada: SaudeDoCliente | null
  compartilhada: boolean
  anexos: unknown
  por_usuario_gestao_id: string
  registrada_por_nome: string
  criado_em: Date
  tarefas_total: number
  tarefas_concluidas: number
}

/**
 * A projeção INTERNA da ata. A do portal é outra, em outro serviço, e
 * seleciona por lista branca (LGPD A7) — esta nunca é reaproveitada lá.
 */
const SELECT_REUNIAO = `
  SELECT r.id, r.cliente_carteira_id, r.data::text AS data, r.tipo, r.participantes, r.resumo,
         r.encaminhamentos, r.notas_internas, r.saude_registrada, r.compartilhada, r.anexos,
         r.por_usuario_gestao_id, u.nome AS registrada_por_nome, r.criado_em,
         (SELECT count(*)::int FROM encaminhamentos_de_reuniao e
            JOIN tarefas_internas t ON t.id = e.tarefa_interna_id
           WHERE e.reuniao_comercial_id = r.id AND t.status <> 'cancelada') AS tarefas_total,
         (SELECT count(*)::int FROM encaminhamentos_de_reuniao e
            JOIN tarefas_internas t ON t.id = e.tarefa_interna_id
           WHERE e.reuniao_comercial_id = r.id AND t.status = 'concluida') AS tarefas_concluidas
    FROM reunioes_comerciais r
    JOIN usuarios_gestao u ON u.id = r.por_usuario_gestao_id`

/**
 * `anexos` é jsonb gravado só por este serviço, a partir de `AnexoPorLink`
 * já validado pelo Zod. Uma linha antiga (0034) pode ter `null` ou outra
 * forma: tudo que não for a forma esperada é descartado na leitura, nunca
 * devolvido cru.
 */
function anexosDaLinha(bruto: unknown): AnexoPorLink[] {
  if (!Array.isArray(bruto)) return []
  return bruto.flatMap((a: unknown) => {
    if (typeof a !== 'object' || a === null) return []
    const { nome, url } = a as { nome?: unknown; url?: unknown } // estreitado pelos typeof abaixo
    return typeof nome === 'string' && typeof url === 'string' && url.startsWith('https://') ? [{ nome, url }] : []
  })
}

const reuniaoParaContrato = (l: LinhaReuniao): ReuniaoNaLista => ({
  id: l.id,
  clienteCarteiraId: l.cliente_carteira_id,
  data: l.data,
  tipo: l.tipo,
  participantes: l.participantes,
  resumo: l.resumo,
  encaminhamentos: l.encaminhamentos,
  notasInternas: l.notas_internas,
  saudeRegistrada: l.saude_registrada,
  compartilhada: l.compartilhada,
  registradaPor: { id: l.por_usuario_gestao_id, nome: l.registrada_por_nome },
  anexos: anexosDaLinha(l.anexos),
  tarefas: { total: l.tarefas_total, concluidas: l.tarefas_concluidas },
  criadoEm: l.criado_em.toISOString(),
})

const dataCurta = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

type AtaParaInserir = {
  data: string
  tipo: ReuniaoNaLista['tipo']
  participantes: string | null
  resumo: string
  encaminhamentos: string | null
  notasInternas: string | null
  saudeRegistrada: SaudeDoCliente | null
  anexos: AnexoPorLink[]
  compartilhada: boolean
  chaveIdempotencia: string | null
  asanaId: string | null
}

/**
 * O alvo do `ON CONFLICT ... DO NOTHING` de cada caminho de escrita. Texto
 * FIXO escolhido por chave, nunca montado com dado de quem chama.
 *
 *  - `chave`: "Registrar reunião" (A-20), o reenvio do mesmo formulário;
 *  - `asana`: a importação (A-15, A43), `(cliente, asana_id)`. Nunca
 *    `DO UPDATE`: a ata já existente, editada à mão, arquivada ou
 *    descompartilhada, fica exatamente como está (regra 27).
 */
const CONFLITO_DA_ATA = {
  chave: 'ON CONFLICT (grupo_id, chave_idempotencia) WHERE chave_idempotencia IS NOT NULL DO NOTHING',
  asana: 'ON CONFLICT (cliente_carteira_id, asana_id) WHERE asana_id IS NOT NULL DO NOTHING',
} as const

/**
 * O ÚNICO `INSERT` de ata. `null` = a chave de idempotência do caminho já
 * existia e nada foi gravado. Cliente e grupo vêm do cliente lido sob RLS
 * (`clienteVisivel`), nunca do corpo.
 */
async function inserirAta(
  c: pg.PoolClient,
  cliente: { id: string; grupo_id: string },
  porUsuarioGestaoId: string,
  ata: AtaParaInserir,
  conflito: keyof typeof CONFLITO_DA_ATA,
): Promise<string | null> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO reunioes_comerciais
       (cliente_carteira_id, grupo_id, data, tipo, participantes, resumo, encaminhamentos,
        notas_internas, saude_registrada, anexos, compartilhada, chave_idempotencia, asana_id, por_usuario_gestao_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ${CONFLITO_DA_ATA[conflito]}
     RETURNING id`,
    [
      cliente.id,
      cliente.grupo_id,
      ata.data,
      ata.tipo,
      ata.participantes,
      ata.resumo,
      ata.encaminhamentos,
      ata.notasInternas,
      ata.saudeRegistrada,
      JSON.stringify(ata.anexos),
      ata.compartilhada,
      ata.chaveIdempotencia,
      ata.asanaId,
      porUsuarioGestaoId,
    ],
  )
  return r.rows[0]?.id ?? null
}

/**
 * **V14 — reuniões da carteira** (`cReunioes`, `abrirReuniao`,
 * `salvarReuniao`, protótipo L1654–1712, L1813–1820, L2843–2844).
 *
 * Toda escrita roda em `nasTabelasDaCarteiraComoUsuarioDeGestao`: RLS por
 * grupo (primeira camada) e `app.pessoa_id = usuario_gestao:<id>`, que o
 * trigger `registrar_auditoria_do_painel` grava como ator — inclusive a
 * mudança de `compartilhada`, de → para (LGPD A8). O grupo da escrita sai do
 * cliente lido sob RLS, nunca do corpo.
 */
@Injectable()
export class ReunioesCarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  private prazoPadrao(): string {
    return somarDias(diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA), 7)
  }

  async listar(sessao: Sessao, clienteId: string): Promise<ReunioesDoClienteSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      const reunioes = await c.query<LinhaReuniao>(
        `${SELECT_REUNIAO}
          WHERE r.cliente_carteira_id = $1 AND r.arquivada_em IS NULL
          ORDER BY r.data DESC, r.criado_em DESC`,
        [cliente.id],
      )
      const pendentes = await c.query<{ comuns: number; importadas: number }>(
        `SELECT count(*) FILTER (WHERE tipo <> 'importada')::int AS comuns,
                count(*) FILTER (WHERE tipo = 'importada')::int  AS importadas
           FROM reunioes_comerciais
          WHERE cliente_carteira_id = $1 AND NOT compartilhada AND arquivada_em IS NULL`,
        [cliente.id],
      )
      const saudes = await c.query<{ em: Date; saude: SaudeDoCliente | null }>(
        `SELECT atualizado_em AS em, saude FROM checkins_internos WHERE cliente_carteira_id = $1
         UNION ALL
         SELECT coalesce(atualizado_em, criado_em), saude_registrada
           FROM reunioes_comerciais
          WHERE cliente_carteira_id = $1 AND arquivada_em IS NULL`,
        [cliente.id],
      )
      const responsaveis = await this.responsaveis(c, sessao, cliente.grupo_id)
      await registrarAcessoAsAtas(c, sessao, cliente.id)

      return {
        reunioes: reunioes.rows.map(reuniaoParaContrato),
        saudeAtual: saudeDerivadaDoCliente(saudes.rows.map((s) => ({ em: s.em.toISOString(), saude: s.saude }))),
        pendentesDeCompartilhar: pendentes.rows[0] ?? { comuns: 0, importadas: 0 },
        responsaveis,
        podeAdministrar: podeAdministrarConteudo(sessao),
        prazoPadrao: this.prazoPadrao(),
      }
    })
  }

  /**
   * "Registrar reunião". Uma transação: a ata, os encaminhamentos e as
   * tarefas — ou nada.
   *
   * IDEMPOTÊNCIA (A-20), em duas redes:
   *  1. `chave_idempotencia` única por grupo: o segundo envio cai no
   *     `ON CONFLICT DO NOTHING` (o concorrente ESPERA o índice único do
   *     primeiro) e devolve a ata existente, sem tocar em tarefa nenhuma;
   *  2. `UNIQUE (reuniao_comercial_id, ordem)` em `encaminhamentos_de_reuniao`:
   *     mesmo que o código mude, a mesma linha da mesma ata não gera duas
   *     tarefas — a tarefa só nasce quando o encaminhamento acabou de nascer.
   */
  async registrar(
    sessao: Sessao,
    clienteId: string,
    dados: RegistrarReuniaoEntrada,
  ): Promise<{ reuniao: ReuniaoNaLista; tarefasCriadas: number; jaExistia: boolean }> {
    let linhas: string[] = []
    if (dados.tarefas !== null) {
      const r = linhasDeEncaminhamento(dados.encaminhamentos ?? '')
      if (ehErro(r)) throw new EntradaInvalida(r.erro.codigo, r.erro.mensagem)
      linhas = r.valor
    }

    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      if (dados.tarefas !== null && linhas.length > 0) {
        await this.conferirResponsavel(c, sessao, cliente.grupo_id, dados.tarefas.responsavelUsuarioGestaoId)
      }

      const inseridaId = await inserirAta(
        c,
        cliente,
        sessao.id,
        {
          data: dados.data,
          tipo: dados.tipo,
          participantes: dados.participantes,
          resumo: dados.resumo,
          encaminhamentos: dados.encaminhamentos,
          notasInternas: dados.notasInternas,
          saudeRegistrada: dados.saudeRegistrada,
          anexos: dados.anexos,
          compartilhada: dados.compartilhada,
          chaveIdempotencia: dados.chaveIdempotencia,
          asanaId: null,
        },
        'chave',
      )

      if (inseridaId === null) {
        const existente = await c.query<LinhaReuniao>(
          `${SELECT_REUNIAO} WHERE r.grupo_id = $1 AND r.chave_idempotencia = $2`,
          [cliente.grupo_id, dados.chaveIdempotencia],
        )
        const linha = existente.rows[0]
        // A chave pertence a OUTRO cliente: não é retry, é reuso — recusa em
        // vez de devolver uma ata que a pessoa não pediu.
        if (!linha || linha.cliente_carteira_id !== cliente.id) throw new ChaveReutilizada()
        return { reuniao: reuniaoParaContrato(linha), tarefasCriadas: 0, jaExistia: true }
      }

      const reuniaoId = inseridaId
      let tarefasCriadas = 0
      if (dados.tarefas !== null) {
        const prazo = dados.tarefas.prazo ?? this.prazoPadrao()
        const descricao = `Encaminhamento da reunião de ${dataCurta(dados.data)}`
        for (const [i, texto] of linhas.entries()) {
          const enc = await c.query<{ id: string }>(
            `INSERT INTO encaminhamentos_de_reuniao (reuniao_comercial_id, grupo_id, ordem, texto)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (reuniao_comercial_id, ordem) DO NOTHING
             RETURNING id`,
            [reuniaoId, cliente.grupo_id, i + 1, texto],
          )
          if (!enc.rows[0]) continue
          const tarefa = await c.query<{ id: string }>(
            `INSERT INTO tarefas_internas
               (titulo, descricao, grupo_id, responsavel_usuario_gestao_id, cliente_carteira_id, prazo, prioridade)
             VALUES ($1, $2, $3, $4, $5, $6, 'normal')
             RETURNING id`,
            [texto, descricao, cliente.grupo_id, dados.tarefas.responsavelUsuarioGestaoId, cliente.id, prazo],
          )
          await c.query('UPDATE encaminhamentos_de_reuniao SET tarefa_interna_id = $2 WHERE id = $1', [
            enc.rows[0].id,
            tarefa.rows[0]!.id,
          ])
          tarefasCriadas++
        }
      }

      return { reuniao: await this.lerUma(c, reuniaoId), tarefasCriadas, jaExistia: false }
    })
  }

  /**
   * **"Importar do Asana"** (`asanaImportar`, L2916–2918; G8 4B). As linhas
   * chegam já lidas no navegador e validadas pelo contrato (A40, A-15).
   *
   * Uma transação: todas as linhas novas ou nenhuma. Cada ata nasce
   * `tipo = 'importada'`, `compartilhada = false` (A42, sem escolha na API),
   * sem participantes (o responsável do Asana não é lido, A40) e sem saúde.
   * Idempotente por `(cliente, asana_id)` com `DO NOTHING` (A43, A-15): a
   * reimportação não cria, não edita, não reabre o compartilhamento e não
   * ressuscita a ata arquivada. O mesmo id de OUTRO cliente não colide.
   */
  async importarDoAsana(
    sessao: Sessao,
    clienteId: string,
    dados: ImportarDoAsanaEntrada,
  ): Promise<ImportacaoDoAsanaSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      let importadas = 0
      for (const linha of dados.linhas) {
        const id = await inserirAta(
          c,
          cliente,
          sessao.id,
          {
            data: linha.data,
            tipo: 'importada',
            participantes: null,
            resumo: resumoDaTarefa(linha.nome, linha.notas),
            encaminhamentos: null,
            notasInternas: null,
            saudeRegistrada: null,
            anexos: [],
            compartilhada: false,
            chaveIdempotencia: null,
            asanaId: linha.asanaId,
          },
          'asana',
        )
        if (id !== null) importadas++
      }
      return { importadas, jaExistiam: dados.linhas.length - importadas }
    })
  }

  /** Os ids do Asana que já têm ata deste cliente, arquivadas inclusive (a prévia os desabilita). */
  async idsDoAsanaImportados(sessao: Sessao, clienteId: string): Promise<IdsDoAsanaImportadosSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      const r = await c.query<{ asana_id: string }>(
        `SELECT asana_id FROM reunioes_comerciais
          WHERE cliente_carteira_id = $1 AND asana_id IS NOT NULL
          ORDER BY asana_id`,
        [cliente.id],
      )
      return { asanaIds: r.rows.map((l) => l.asana_id) }
    })
  }

  async editar(sessao: Sessao, reuniaoId: string, dados: EditarReuniaoEntrada): Promise<ReuniaoNaLista> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await this.travar(c, reuniaoId)
      if (atual.arquivada_em !== null) throw new ConteudoArquivado()
      const { sets, valores } = partesDoUpdate(
        [
          ['data', dados.data],
          ['tipo', dados.tipo],
          ['participantes', dados.participantes],
          ['resumo', dados.resumo],
          ['encaminhamentos', dados.encaminhamentos],
          ['notas_internas', dados.notasInternas],
          ['saude_registrada', dados.saudeRegistrada],
          ['anexos', dados.anexos === undefined ? undefined : JSON.stringify(dados.anexos)],
        ],
        2,
      )
      if (sets.length > 0) {
        await c.query(
          `UPDATE reunioes_comerciais SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1`,
          [reuniaoId, ...valores],
        )
      }
      return this.lerUma(c, reuniaoId)
    })
  }

  /**
   * Compartilhar / "Deixar só para a equipe".
   *
   * DEScompartilhar depois de o portal ter sido lido (LGPD A10): a leitura do
   * portal grava `acessou` na trilha da CLÍNICA do cliente
   * (`PortalLeituraService`, uma linha por clínica, `entidade_id` = cliente).
   * Se existe uma leitura em ou depois de `compartilhada_em`, a cliente pode
   * ter lido a ata: sem motivo, recusa (a tela pede); com motivo, grava
   * `compartilhamentos_revertidos` na MESMA transação do descompartilhamento.
   *
   * Cliente sem clínica não tem trilha de portal — não há leitura detectável,
   * e o descompartilhamento segue sem o evento.
   */
  async mudarCompartilhamento(
    sessao: Sessao,
    reuniaoId: string,
    dados: MudarCompartilhamentoEntrada,
  ): Promise<{ reuniao: ReuniaoNaLista; reversaoAposLeitura: boolean }> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await this.travar(c, reuniaoId)
      if (atual.arquivada_em !== null) throw new ConteudoArquivado()
      if (atual.compartilhada === dados.compartilhada) {
        return { reuniao: await this.lerUma(c, reuniaoId), reversaoAposLeitura: false }
      }

      if (dados.compartilhada) {
        await c.query(
          'UPDATE reunioes_comerciais SET compartilhada = true WHERE id = $1',
          [reuniaoId],
        )
        return { reuniao: await this.lerUma(c, reuniaoId), reversaoAposLeitura: false }
      }

      // `compartilhada_em` só é nulo numa linha compartilhada que o CHECK da
      // 0048 não deixaria existir; a guarda é para o tipo, não para o dado.
      const leitura =
        atual.compartilhada_em === null
          ? null
          : await this.ultimaLeituraDoPortal(atual.clinica_id, atual.cliente_carteira_id, atual.compartilhada_em)

      if (leitura !== null) {
        if (dados.motivo === undefined) throw new MotivoObrigatorio()
        await c.query(
          `INSERT INTO compartilhamentos_revertidos
             (reuniao_comercial_id, cliente_carteira_id, grupo_id, compartilhada_em,
              ultima_leitura_portal_em, motivo, por_usuario_gestao_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            reuniaoId,
            atual.cliente_carteira_id,
            atual.grupo_id,
            atual.compartilhada_em,
            leitura,
            dados.motivo,
            sessao.id,
          ],
        )
      }
      await c.query('UPDATE reunioes_comerciais SET compartilhada = false WHERE id = $1', [reuniaoId])
      return { reuniao: await this.lerUma(c, reuniaoId), reversaoAposLeitura: leitura !== null }
    })
  }

  /**
   * "Compartilhar todas" de UM cliente (A-18). Confirmação com contagem
   * (LGPD A8): se o servidor contar outra coisa, recusa. Idempotente: sem
   * pendentes, devolve 0 sem conferir a contagem (o segundo clique de quem
   * já compartilhou não é erro). O trigger audita cada linha alterada.
   */
  async compartilharTodas(sessao: Sessao, clienteId: string, dados: CompartilharTodasEntrada): Promise<number> {
    if (!podeAdministrarConteudo(sessao)) throw new SemPermissaoDeAdministrar()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteVisivel(c, clienteId)
      const pendentes = await c.query<{ id: string }>(
        `SELECT id FROM reunioes_comerciais
          WHERE cliente_carteira_id = $1 AND NOT compartilhada AND arquivada_em IS NULL
            AND (tipo <> 'importada' OR $2)
          FOR UPDATE`,
        [cliente.id, dados.incluirImportadas],
      )
      const ids = pendentes.rows.map((r) => r.id)
      if (ids.length === 0) return 0
      if (ids.length !== dados.esperadas) throw new ContagemMudou()
      await c.query(
        'UPDATE reunioes_comerciais SET compartilhada = true WHERE id = ANY($1)',
        [ids],
      )
      return ids.length
    })
  }

  /** "Excluir" vira arquivar (regra 20, PP-5). Só quem administra (A-9). Idempotente. */
  async arquivar(sessao: Sessao, reuniaoId: string): Promise<void> {
    if (!podeAdministrarConteudo(sessao)) throw new SemPermissaoDeAdministrar()
    await this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const atual = await this.travar(c, reuniaoId)
      if (atual.arquivada_em !== null) return
      await c.query('UPDATE reunioes_comerciais SET arquivada_em = now() WHERE id = $1', [reuniaoId])
    })
  }

  /* ── apoio ─────────────────────────────────────────────────────────── */

  private async travar(
    c: pg.PoolClient,
    reuniaoId: string,
  ): Promise<{
    cliente_carteira_id: string
    grupo_id: string
    clinica_id: string | null
    compartilhada: boolean
    compartilhada_em: Date | null
    arquivada_em: Date | null
  }> {
    const r = await c.query<{
      cliente_carteira_id: string
      grupo_id: string
      clinica_id: string | null
      compartilhada: boolean
      compartilhada_em: Date | null
      arquivada_em: Date | null
    }>(
      `SELECT r.cliente_carteira_id, r.grupo_id, cl.clinica_id, r.compartilhada, r.compartilhada_em, r.arquivada_em
         FROM reunioes_comerciais r
         JOIN clientes_carteira cl ON cl.id = r.cliente_carteira_id
        WHERE r.id = $1
          FOR UPDATE OF r`,
      [reuniaoId],
    )
    const linha = r.rows[0]
    if (!linha) throw new NaoEncontrado()
    return linha
  }

  private async lerUma(c: pg.PoolClient, reuniaoId: string): Promise<ReuniaoNaLista> {
    const r = await c.query<LinhaReuniao>(`${SELECT_REUNIAO} WHERE r.id = $1`, [reuniaoId])
    return reuniaoParaContrato(r.rows[0]!)
  }

  /**
   * A última leitura do portal daquele cliente em ou depois de `desde`. Lida
   * na trilha da clínica pelo pool do produto (`fir_carteira` não tem grant
   * em `auditoria`) — mesmo caminho de `UsoCarteiraService` para `clinicas`.
   * O `clinica_id` vem de `clientes_carteira`, lido sob a RLS da sessão.
   */
  private async ultimaLeituraDoPortal(clinicaId: string | null, clienteId: string, desde: Date): Promise<Date | null> {
    if (clinicaId === null) return null
    const id = clinicaIdDeFonteConfiavel(clinicaId)
    const r = await this.banco.naClinica(id, SISTEMA, (c) =>
      c.query<{ em: Date | null }>(
        `SELECT max(em) AS em FROM auditoria
          WHERE clinica_id = $1 AND ator_tipo = 'usuario_portal' AND acao = 'acessou'
            AND entidade_id = $2 AND em >= $3`,
        [id, clienteId, desde],
      ),
    )
    return r.rows[0]?.em ?? null
  }

  /**
   * Quem pode receber as tarefas dos encaminhamentos: usuário ATIVO do grupo
   * do cliente, ou da Firmare (`escopo = 'geral'`) quando quem registra também
   * é geral (ADR 0016 §2; appsec A-11 item 7). Um usuário de grupo nunca vê a
   * equipe de outro grupo.
   */
  private async responsaveis(c: pg.PoolClient, sessao: Sessao, grupoId: string): Promise<PessoaDaFirmare[]> {
    const r = await c.query<PessoaDaFirmare>(
      `SELECT id, nome FROM usuarios_gestao
        WHERE ativo AND (grupo_id = $1 OR ($2 AND escopo = 'geral'))
        ORDER BY nome`,
      [grupoId, sessao.escopo === 'geral'],
    )
    return r.rows
  }

  private async conferirResponsavel(c: pg.PoolClient, sessao: Sessao, grupoId: string, id: string): Promise<void> {
    const validos = await this.responsaveis(c, sessao, grupoId)
    if (!validos.some((p) => p.id === id)) throw new ResponsavelInvalido()
  }
}
