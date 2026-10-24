import type { CriarTarefa, PagamentoEmbutido, PassoDaJornada, TarefasAfetadas } from '@fir/contracts'
import {
  aceitaPagamento,
  diaCivil,
  ehErro,
  gerarSerie,
  instanteDaConclusao,
  type Relogio,
  type Result,
  rotuloDaSerie,
  tipoAoConcluir,
} from '@fir/domain'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'
import type { Ator, PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { unidadeValida } from '../comum/unidade'
import { lerTarefas, TIPOS_DE_AGENDA, TIPOS_REALIZADOS } from './leitura'

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

/** As 18 colunas que toda tarefa nova preenche, na ordem. */
const COLUNAS = [
  'clinica_id',
  'solicitante_id',
  'responsavel_id',
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
] as const

type LinhaNova = readonly unknown[]

/**
 * Insere N tarefas em UM comando.
 *
 * 150 linhas em 150 `INSERT` são 150 idas ao banco, e a tela de quem criou a
 * série fica parada enquanto isso — no celular da recepção, com o telefone
 * tocando. Um `VALUES` de 150 linhas × 18 colunas são 2.700 parâmetros, bem
 * abaixo do teto de 65.535 do protocolo.
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

const brAno = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`

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
  ): Promise<TarefasAfetadas> {
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      // `Code.gs:355`: o responsável precisa estar ATIVO. Tarefa atribuída a
      // quem saiu da clínica não aparece no "Para mim" de ninguém — ela some,
      // e ninguém descobre que ela existe.
      const resp = await c.query<{ ativo: boolean }>(
        'SELECT ativo FROM pessoas WHERE id = $1',
        [dados.responsavelId],
      )
      if (resp.rowCount === 0 || resp.rows[0]!.ativo !== true) {
        throw new BadRequestException('Escolha um responsável ativo.')
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

      const comum = {
        clinicaId,
        autor,
        responsavelId: dados.responsavelId,
        descricao,
        prioridade: dados.prioridade,
        obs: dados.obs,
        pacienteId,
        tipo,
        unidade,
      }

      const ids =
        dados.quando.modo === 'serie'
          ? await this.criarSerie(c, comum, dados.quando, agora)
          : dados.quando.modo === 'retroativo'
            ? await this.criarRetroativa(c, comum, dados.quando, agora, hoje, fuso)
            : await this.criarAgendada(c, comum, dados.quando, agora)

      const todas = await lerTarefas(c, clinicaId, hoje, ids)
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
    const historico: PassoDaJornada[] = naAgenda
      ? [
          {
            e: 'agendado',
            em: agora.toISOString(),
            por: t.autor,
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
  ): Promise<string[]> {
    const concluidaEm = exigirDominio(instanteDaConclusao(q.em, hoje, fuso, agora))

    let tipo = t.tipo
    let etapa: string | null = null
    let historico: PassoDaJornada[] = []
    if (t.pacienteId !== null && TIPOS_DE_AGENDA.includes(t.tipo)) {
      tipo = tipoAoConcluir(t.tipo)
      etapa = 'realizado'
      historico = [
        { e: 'agendado', em: agora.toISOString(), por: t.autor },
        { e: 'realizado', em: concluidaEm.toISOString(), por: t.autor },
      ]
    } else if (t.pacienteId !== null && TIPOS_REALIZADOS.includes(t.tipo)) {
      etapa = 'realizado'
      historico = [{ e: 'realizado', em: concluidaEm.toISOString(), por: t.autor }]
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
                  e: 'agendado',
                  em: agora.toISOString(),
                  por: t.autor,
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
  readonly responsavelId: string
  readonly descricao: string
  readonly prioridade: 'normal' | 'urgente'
  readonly obs: string
  readonly pacienteId: string | null
  readonly tipo: string
  readonly unidade: string | null
}

const linha = (
  t: Comum,
  x: {
    prazo: string
    hora: string | null
    status: 'aberta' | 'concluida'
    concluidaEm: Date | null
    tipo: string
    etapa: string | null
    historico: PassoDaJornada[]
    serieId: string | null
    recorrencia: string
  },
): LinhaNova => [
  t.clinicaId,
  t.autor,
  t.responsavelId,
  t.descricao,
  x.prazo,
  x.hora,
  t.prioridade,
  x.status,
  x.concluidaEm,
  t.pacienteId,
  x.tipo,
  x.etapa,
  JSON.stringify(x.historico),
  '',
  t.obs,
  x.serieId,
  x.recorrencia,
  t.unidade,
]

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
  },
): Promise<void> {
  if (x.pacienteId === null) {
    throw new BadRequestException(
      'Só uma tarefa de paciente guarda pagamento — o dinheiro precisa de a quem pertencer.',
    )
  }
  if (!aceitaPagamento(x.tipo)) {
    throw new BadRequestException(
      'Este tipo de tarefa não guarda pagamento. Use Recebimento para registrar dinheiro recebido.',
    )
  }
  await c.query(
    `INSERT INTO recebimentos
       (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em,
        unidade_id, registrado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      x.clinicaId,
      x.pacienteId,
      x.tarefaId,
      x.tipo,
      // `bigint` do JS vira texto no parâmetro: o driver não serializa bigint,
      // e `Number()` perderia precisão acima de 2^53 (regra 1).
      x.pagamento.valor.toString(),
      x.pagamento.forma,
      (x.pagamento.valorAberto ?? 0n).toString(),
      x.quando,
      x.unidade,
      x.autor,
    ],
  )
}
