import type {
  ConfirmacoesDoRecebimento,
  CriarTarefa,
  EventoDeFluxo,
  PagamentoEmbutido,
  TarefasAfetadas,
} from '@fir/contracts'
import {
  aceitaPagamento,
  TIPO_PAGAMENTO_DE_ORCAMENTO,
  diaCivil,
  type EventoDeJornada,
  ehErro,
  ehOk,
  formaPrincipal,
  gerarSerie,
  instanteDaConclusao,
  podeEditar,
  type Relogio,
  type Result,
  rotuloDaSerie,
  temPerm,
  tipoAoConcluir,
} from '@fir/domain'
import { partesDoPagamento } from '@fir/contracts'
import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import { type Ator, type PessoaId, pessoaDoAtor } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { campanhaParaVincular } from '../campanhas/vinculo'
import { unidadeValida } from '../comum/unidade'
import { emDominio, gravarRecebimento } from '../financeiro/partes'
import { conferirAvisosDoRecebimento, confirmacoesDe } from '../financeiro/recebimentos.avisos'
import { lerAtorDeAcesso, lerPerfisDoDominio } from '../pessoas/acesso-do-ator'
import { comGrupos } from './grupos-do-autor'
import { brAno, lerTarefas, TIPOS_DE_AGENDA, TIPOS_REALIZADOS } from './leitura'
import { kpiDoPlanoDeAcao } from './plano-de-acao'

/**
 * Um erro de domínio vira 400 com a MENSAGEM DELE.
 *
 * As mensagens de `packages/domain` já são escritas para a recepção ("A série
 * precisa de pelo menos 2 datas. Ajuste o 'repetir até'."). Traduzi-las de
 * novo na borda HTTP é a segunda escrita da mesma regra — e a segunda escrita
 * é a que fica desatualizada.
 */
export function exigirDominio<T>(r: Result<T>): T {
  if (ehErro(r)) throw new BadRequestException(r.erro.mensagem)
  return r.valor
}

/** As 22 colunas que toda tarefa nova preenche, na ordem. */
const COLUNAS = [
  'clinica_id',
  'solicitante_id',
  'responsavel_id',
  'grupo_id',
  'tarefa_origem_id',
  'descricao',
  'prazo',
  'hora',
  'prioridade',
  'status',
  'concluida_em',
  'paciente_id',
  'tipo',
  'etapa',
  'historico',
  'resultado',
  'obs',
  'serie_id',
  'recorrencia',
  'unidade_id',
  'campanha_id',
  // O plano de ação (I-46): `null` em toda tarefa que não é plano.
  'kpi_id',
] as const

type LinhaNova = readonly unknown[]

/**
 * Insere N tarefas em UM comando.
 *
 * 150 linhas em 150 `INSERT` são 150 idas ao banco, e a tela de quem criou a
 * série fica parada enquanto isso — no celular da recepção, com o telefone
 * tocando. Um `VALUES` de 150 linhas × 18 colunas são 2.700 parâmetros, bem
 * abaixo do teto de 65.535 do protocolo (com 19 colunas, 2.850).
 */
async function inserirTarefas(c: pg.PoolClient, linhas: readonly LinhaNova[]): Promise<string[]> {
  const params: unknown[] = []
  const grupos = linhas.map((linha) => {
    const marcas = linha.map((valor) => {
      params.push(valor)
      return `$${params.length}`
    })
    return `(${marcas.join(',')})`
  })
  const r = await c.query<{ id: string }>(
    `INSERT INTO tarefas (${COLUNAS.join(',')}) VALUES ${grupos.join(',')} RETURNING id`,
    params,
  )
  return r.rows.map((x) => x.id)
}

@Injectable()
export class TarefasService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /** O dia civil de hoje, no fuso da clínica. A autoridade é o servidor. */
  hojeDaClinica(fuso: string): string {
    return diaCivil(this.relogio.agora(), fuso)
  }

  /**
   * Criar tarefa — as três formas do contrato, decididas por `quando.modo`.
   *
   * Tudo dentro de UM `naClinica`, série inclusive: uma série meia-criada é
   * pior que nenhuma, porque a recepção vê cinco das doze tarefas que pediu e
   * não tem como saber quais faltam.
   */
  async criar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: PessoaId,
    dados: CriarTarefa,
    podeJornada: boolean,
    podeEquipe = false,
  ): Promise<TarefasAfetadas> {
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      // O destino é UM só (o contrato já exige; o `CHECK tarefa_tem_destino` é a
      // terceira camada).
      let responsavelId: string | null = null
      let grupoId: string | null = null
      if (dados.grupoId !== undefined) {
        // Tarefa de grupo é ritual da clínica: a sessão de suporte (que assina
        // como administradora) não a cria (E3).
        if (pessoaDoAtor(ator) === null) {
          throw new ForbiddenException('A sessão de suporte não cria tarefa para um grupo.')
        }
        if (dados.quando.modo === 'retroativo') {
          // "Já aconteceu" precisa de quem fez; o grupo não é ninguém.
          throw new BadRequestException(
            'Um lançamento que já aconteceu precisa de uma pessoa, não de um grupo.',
          )
        }
        const g = await c.query<{ ativo: boolean }>(
          'SELECT ativo FROM grupos_da_equipe WHERE id = $1 AND clinica_id = $2',
          [dados.grupoId, clinicaId],
        )
        if (g.rowCount === 0 || g.rows[0]!.ativo !== true) {
          throw new BadRequestException('Escolha um grupo ativo.')
        }
        grupoId = dados.grupoId
      } else {
        // `Code.gs:355`: o responsável precisa estar ATIVO. Tarefa atribuída a
        // quem saiu da clínica não aparece no "Para mim" de ninguém — ela some,
        // e ninguém descobre que ela existe.
        const resp = await c.query<{ ativo: boolean }>(
          'SELECT ativo FROM pessoas WHERE id = $1 AND clinica_id = $2',
          [dados.responsavelId, clinicaId],
        )
        if (resp.rowCount === 0 || resp.rows[0]!.ativo !== true) {
          throw new BadRequestException('Escolha um responsável ativo.')
        }
        responsavelId = dados.responsavelId ?? null
      }

      let pacienteId: string | null = null
      let unidadeDoPaciente: string | null = null
      let tipo = ''
      if (dados.vinculo === 'paciente') {
        // A RLS faz o filtro por clínica: o paciente da vizinha devolve zero
        // linhas, e a mensagem é a mesma de "não existe" — 400, nunca 403,
        // porque 403 confirmaria que ele existe em algum lugar.
        const p = await c.query<{ unidade_id: string | null }>(
          'SELECT unidade_id FROM pacientes WHERE id = $1 AND ativo',
          [dados.pacienteId],
        )
        if (p.rowCount === 0) throw new BadRequestException('Paciente não encontrado.')
        pacienteId = dados.pacienteId
        unidadeDoPaciente = p.rows[0]!.unidade_id
        tipo = dados.tipo
      }

      // `Code.gs:373`: a unidade cai na unidade PRINCIPAL do paciente quando
      // não vier explícita. O protótipo deixa vazio, e o dado migrado das 4
      // clínicas desapareceria do filtro por unidade. Tarefa INTERNA não herda
      // nada — não há paciente de quem herdar.
      const unidade =
        pacienteId === null
          ? null
          : ((await unidadeValida(c, dados.unidadeId)) ?? unidadeDoPaciente)

      // É o que a tela faz: sem descrição, o nome do tipo serve. Por isso o
      // rótulo dela vira "Descrição (opcional)" no modo paciente — e por isso
      // a tarefa INTERNA, que não tem tipo, continua exigindo o texto.
      const descricao = (dados.descricao ?? '').trim() || tipo
      if (descricao === '') throw new BadRequestException('Descreva a tarefa.')

      // A campanha passa pela MESMA janela da lista (S-10): em andamento ou
      // encerrada há até 30 dias, da clínica e não excluída. A série inteira
      // herda a mesma campanha, como no protótipo (`Object.assign({}, nova)`).
      const campanhaId = await campanhaParaVincular(c, {
        clinicaId,
        campanhaId: dados.campanhaId,
        contexto: 'tarefa',
        agora,
        fuso,
      })

      // A tarefa de origem ("concluir e criar nova"): da clínica, que a pessoa
      // enxerga (mesmo filtro de `GET tarefas/:id`), e do MESMO paciente ou sem
      // paciente — a cadeia nunca atravessa de um paciente para outro (appsec S2).
      let tarefaOrigemId: string | null = null
      if (dados.tarefaOrigemId !== undefined) {
        const o = await c.query<{
          solicitante_id: string
          responsavel_id: string | null
          grupo_id: string | null
          status: 'aberta' | 'concluida' | 'cancelada'
          paciente_id: string | null
        }>(
          `SELECT solicitante_id, responsavel_id, grupo_id, status, paciente_id
             FROM tarefas WHERE id = $1 AND clinica_id = $2 AND excluida_em IS NULL`,
          [dados.tarefaOrigemId, clinicaId],
        )
        const origem = o.rows[0]
        const eu = await comGrupos(c, clinicaId, { id: autor, podeEquipe })
        if (
          origem === undefined ||
          !ehOk(
            podeEditar(
              {
                solicitanteId: origem.solicitante_id,
                responsavelId: origem.responsavel_id,
                grupoId: origem.grupo_id,
                status: origem.status,
              },
              eu,
            ),
          )
        ) {
          throw new BadRequestException('Tarefa de origem não encontrada.')
        }
        if (origem.paciente_id !== null && origem.paciente_id !== pacienteId) {
          throw new BadRequestException(
            'A tarefa de origem é de outro paciente, então não pode ser ligada a esta.',
          )
        }
        tarefaOrigemId = dados.tarefaOrigemId
      }

      // O plano de ação (I-46): `indicadores` + a `permissaoDoValor` do KPI, e
      // a clínica conferida (appsec C6, C27). Só a tarefa interna o aceita.
      const kpiId = await kpiDoPlanoDeAcao(c, clinicaId, autor, dados.vinculo === 'interna' ? dados.kpiId : undefined)

      const comum = {
        clinicaId,
        autor,
        responsavelId,
        grupoId,
        tarefaOrigemId,
        atribuidaEm: agora.toISOString(),
        descricao,
        prioridade: dados.prioridade,
        obs: dados.obs,
        pacienteId,
        tipo,
        unidade,
        campanhaId,
        kpiId,
      }

      const ids =
        dados.quando.modo === 'serie'
          ? await this.criarSerie(c, comum, dados.quando, agora)
          : dados.quando.modo === 'retroativo'
            ? await this.criarRetroativa(
                c,
                comum,
                dados.quando,
                agora,
                hoje,
                fuso,
                confirmacoesDe(dados),
              )
            : await this.criarAgendada(c, comum, dados.quando, agora)

      const todas = await lerTarefas(c, clinicaId, hoje, ids, podeJornada)
      return { tarefa: todas[0]!, todas }
    })
  }

  private async criarAgendada(
    c: pg.PoolClient,
    t: Comum,
    q: { prazo: string; hora?: string | undefined },
    agora: Date,
  ): Promise<string[]> {
    const naAgenda = t.pacienteId !== null && TIPOS_DE_AGENDA.includes(t.tipo)
    const historico: EventoDeJornada[] = naAgenda
      ? [
          {
            acao: 'agendar',
            etapa: 'agendado',
            em: agora.toISOString(),
            porId: t.autor,
            nota: `para ${brAno(q.prazo)}${q.hora === undefined ? '' : ` ${q.hora}`}`,
          },
        ]
      : []
    return inserirTarefas(c, [
      linha(t, {
        prazo: q.prazo,
        hora: q.hora ?? null,
        status: 'aberta',
        concluidaEm: null,
        tipo: t.tipo,
        etapa: naAgenda ? 'agendado' : null,
        historico,
        serieId: null,
        recorrencia: '',
      }),
    ])
  }

  /**
   * "Lançar algo que já aconteceu" (MANUAL cap. 4): a tarefa NASCE concluída.
   *
   * Agendado vira realizado aqui mesmo, na MESMA tarefa e com os dois passos
   * no histórico — nunca uma tarefa nova por etapa.
   */
  private async criarRetroativa(
    c: pg.PoolClient,
    t: Comum,
    q: { em: string; hora?: string | undefined; pagamento?: PagamentoEmbutido | undefined },
    agora: Date,
    hoje: string,
    fuso: string,
    confirmacoes: ConfirmacoesDoRecebimento,
  ): Promise<string[]> {
    const concluidaEm = exigirDominio(instanteDaConclusao(q.em, hoje, fuso, agora))

    let tipo = t.tipo
    let etapa: string | null = null
    let historico: EventoDeJornada[] = []
    if (t.pacienteId !== null && TIPOS_DE_AGENDA.includes(t.tipo)) {
      tipo = tipoAoConcluir(t.tipo)
      etapa = 'realizado'
      historico = [
        { acao: 'agendar', etapa: 'agendado', em: agora.toISOString(), porId: t.autor },
        { acao: 'concluir', etapa: 'realizado', em: concluidaEm.toISOString(), porId: t.autor },
      ]
    } else if (t.pacienteId !== null && TIPOS_REALIZADOS.includes(t.tipo)) {
      etapa = 'realizado'
      historico = [
        { acao: 'concluir', etapa: 'realizado', em: concluidaEm.toISOString(), porId: t.autor },
      ]
    }

    const descricao = t.descricao === t.tipo && tipo !== t.tipo ? tipo : t.descricao

    const ids = await inserirTarefas(c, [
      linha(
        { ...t, descricao },
        {
          prazo: q.em,
          hora: q.hora ?? null,
          status: 'concluida',
          concluidaEm,
          tipo,
          etapa,
          historico,
          serieId: null,
          recorrencia: '',
        },
      ),
    ])

    if (q.pagamento !== undefined) {
      await registrarPagamento(c, {
        clinicaId: t.clinicaId,
        pacienteId: t.pacienteId,
        tarefaId: ids[0]!,
        tipo,
        pagamento: q.pagamento,
        quando: concluidaEm,
        unidade: t.unidade,
        autor: t.autor,
        fuso,
        confirmacoes,
      })
    }
    return ids
  }

  /** N tarefas abertas com o mesmo `serie_id`. A recorrência é materializada. */
  private async criarSerie(
    c: pg.PoolClient,
    t: Comum,
    q: {
      inicio: string
      hora?: string | undefined
      freq: Parameters<typeof gerarSerie>[1]
      ate: string
      aCadaNDias?: number | undefined
    },
    agora: Date,
  ): Promise<string[]> {
    const datas = exigirDominio(gerarSerie(q.inicio, q.freq, q.ate, q.aCadaNDias))
    const serieId = randomUUID()
    const recorrencia = rotuloDaSerie(q.freq, q.aCadaNDias)
    const naAgenda = t.pacienteId !== null && TIPOS_DE_AGENDA.includes(t.tipo)

    return inserirTarefas(
      c,
      datas.map((prazo) =>
        linha(t, {
          prazo,
          hora: q.hora ?? null,
          status: 'aberta',
          concluidaEm: null,
          tipo: t.tipo,
          etapa: naAgenda ? 'agendado' : null,
          historico: naAgenda
            ? [
                {
                  acao: 'agendar',
                  etapa: 'agendado',
                  em: agora.toISOString(),
                  porId: t.autor,
                  nota: `para ${brAno(prazo)}${q.hora === undefined ? '' : ` ${q.hora}`}`,
                },
              ]
            : [],
          serieId,
          recorrencia,
        }),
      ),
    )
  }
}

type Comum = {
  readonly clinicaId: ClinicaId
  readonly autor: PessoaId
  readonly responsavelId: string | null
  readonly grupoId: string | null
  readonly tarefaOrigemId: string | null
  /** O instante do evento `atribuir`, quando a tarefa nasce num grupo. */
  readonly atribuidaEm: string
  readonly descricao: string
  readonly prioridade: 'normal' | 'urgente'
  readonly obs: string
  readonly pacienteId: string | null
  readonly tipo: string
  readonly unidade: string | null
  readonly campanhaId: string | null
  readonly kpiId: string | null
}

/**
 * A tarefa que nasce NUM GRUPO registra de onde veio: `atribuir`, de ninguém para
 * o grupo, por quem a criou. Tarefa de pessoa não ganha evento (o histórico
 * dela continua exatamente como era).
 */
const eventoDeAtribuicao = (t: Comum): EventoDeFluxo[] =>
  t.grupoId === null
    ? []
    : [
        {
          acao: 'atribuir',
          em: t.atribuidaEm,
          porId: t.autor,
          de: null,
          para: { tipo: 'grupo', id: t.grupoId },
        },
      ]

const linha = (
  t: Comum,
  x: {
    prazo: string
    hora: string | null
    status: 'aberta' | 'concluida'
    concluidaEm: Date | null
    tipo: string
    etapa: string | null
    historico: EventoDeJornada[]
    serieId: string | null
    recorrencia: string
  },
): LinhaNova => [
  t.clinicaId,
  t.autor,
  t.responsavelId,
  t.grupoId,
  t.tarefaOrigemId,
  t.descricao,
  x.prazo,
  x.hora,
  t.prioridade,
  x.status,
  x.concluidaEm,
  t.pacienteId,
  x.tipo,
  x.etapa,
  JSON.stringify([...x.historico, ...eventoDeAtribuicao(t)]),
  '',
  t.obs,
  x.serieId,
  x.recorrencia,
  t.unidade,
  t.campanhaId,
  t.kpiId,
]

/**
 * **`receber` é cobrada AQUI, uma vez, para toda porta de pagamento embutido**
 * (achado F6): concluir tarefa, criar tarefa já concluída, concluir sessão e
 * fechar na jornada. Antes, só a rota de sessão e a jornada cobravam, no
 * controlador — e concluir/criar retroativo gravavam dinheiro com qualquer
 * perfil. Uma checagem por rota é a que a quinta porta esquece.
 *
 * A permissão é RELIDA dentro da transação (pessoa e perfis, como
 * `pessoas/acesso-do-ator.ts`) e decidida por `temPerm` — a mesma função da
 * tela e do guard (regra 16). Na sessão de suporte, `autor` é a administradora
 * que assina por ela (D-13): admin, e `temPerm` diz sim, como `c.pode` diz.
 */
async function exigirPermissaoDeReceber(c: pg.PoolClient, autor: PessoaId): Promise<void> {
  const ator = await lerAtorDeAcesso(c, autor)
  const usuario = {
    admin: ator.admin,
    perfilId: ator.tipo === 'pessoa' ? (ator.perfilId ?? '') : '',
  }
  if (!temPerm(usuario, await lerPerfisDoDominio(c), 'receber')) {
    throw new ForbiddenException(
      'Para lançar o pagamento você precisa da permissão de recebimentos. ' +
        'Conclua sem pagamento e registre o dinheiro pela tela Recebimentos.',
    )
  }
}

/**
 * O pagamento embutido: UMA linha em `recebimentos`, presa à tarefa.
 *
 * Esta é a única escrita de dinheiro do épico 2, e ela é o ponto onde a regra
 * 3 vive na aplicação. O que garante a regra, porém, não é este código: é o
 * índice único parcial `recebimento_por_tarefa`. Se este caminho for chamado
 * duas vezes para o mesmo atendimento — por um job, por uma importação, por um
 * `psql` às duas da manhã — o banco recusa a segunda.
 */
export async function registrarPagamento(
  c: pg.PoolClient,
  x: {
    clinicaId: ClinicaId
    pacienteId: string | null
    tarefaId: string
    tipo: string
    pagamento: PagamentoEmbutido
    quando: Date
    unidade: string | null
    autor: PessoaId
    /** O fuso da clínica: a janela do dia dos avisos (D-21). */
    fuso: string
    /** As confirmações que o corpo trouxe. Ver `recebimentos.avisos.ts`. */
    confirmacoes: ConfirmacoesDoRecebimento
  },
): Promise<string> {
  await exigirPermissaoDeReceber(c, x.autor)
  if (x.pacienteId === null) {
    throw new BadRequestException(
      'Só uma tarefa de paciente guarda pagamento — o dinheiro precisa de a quem pertencer.',
    )
  }
  // O "Pagamento de orçamento" não é atendimento, mas é a tarefa companheira
  // em que o fechamento põe o dinheiro de um atendimento que já tinha o seu.
  if (!aceitaPagamento(x.tipo) && x.tipo !== TIPO_PAGAMENTO_DE_ORCAMENTO) {
    throw new BadRequestException(
      'Este tipo de tarefa não guarda pagamento. Use Recebimento para registrar dinheiro recebido.',
    )
  }
  // A lista de formas, ou a parte única com a forma de sempre (fatia 4.1).
  const partes = partesDoPagamento(x.pagamento)
  // O MESMO instante que vai ser gravado (`quando`): retroativo incluído.
  // Caixa e depois duplicidade (F8): quem chama e ainda tem recusa depois desta
  // função a põe ANTES dela, ou move a recusa dele para antes (ver
  // `fechamento.service.ts` e `sessoes.service.ts`).
  await conferirAvisosDoRecebimento(c, {
    clinicaId: x.clinicaId,
    pacienteId: x.pacienteId,
    valor: x.pagamento.valor,
    forma: formaPrincipal(emDominio(partes)),
    recebidoEm: x.quando,
    fuso: x.fuso,
    confirmacoes: x.confirmacoes,
  })

  // `RETURNING id` porque o épico 5 precisa carimbar `programa_id` nesta
  // linha, na MESMA transação: é só isso que falta para o saldo em aberto
  // deixar de ser um grupo só (regra 5). Quem não precisa do id ignora o
  // retorno, e nada mais muda.
  const gravado = await gravarRecebimento(c, {
    clinicaId: x.clinicaId,
    pacienteId: x.pacienteId,
    tarefaId: x.tarefaId,
    tipo: x.tipo,
    valor: x.pagamento.valor,
    valorAberto: x.pagamento.valorAberto ?? 0n,
    recebidoEm: x.quando,
    unidadeId: x.unidade,
    registradoPor: x.autor,
    partes,
  })
  return gravado.id
}
