import type { ItemNoPrograma, MontarPrograma, ProgramaMontadoNaSaida } from '@fir/contracts'
import {
  diaCivil,
  Dinheiro,
  ehErro,
  Quantidade,
  type ErroDeDominio,
  type Result,
} from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'
import { RELOGIO, type Relogio } from '../comum/relogio'
import {
  MontadorDePrograma,
  PROCEDIMENTO_FORA_DO_CATALOGO,
  RESPONSAVEL_INVALIDO,
  type ItemParaMontar,
  type ProgramaMontado,
} from './montador-de-programa'

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
}

/** O tipo da tarefa companheira do pagamento da adesão. */
const TIPO_DA_ADESAO = 'Pagamento de orçamento'

@Injectable()
export class ProgramasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(MontadorDePrograma) private readonly montador: MontadorDePrograma,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * `POST /v1/programas` — Nova adesão.
   *
   * O recebimento da adesão e o programa nascem na MESMA `naClinica`: o
   * montador precisa do id do recebimento para carimbar `programa_id`, e
   * nenhuma das duas escritas sobrevive sozinha. Se o montador recusar, o
   * recebimento inserido volta atrás — a diferença entre "a adesão não
   * aconteceu" e "o dinheiro entrou e as doze aplicações não existem".
   */
  async montar(ctx: Contexto, dados: MontarPrograma): Promise<ProgramaMontadoNaSaida> {
    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, ctx.fuso)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      // A RLS já filtra: a paciente da clínica vizinha devolve zero linhas.
      const pac = await c.query('SELECT 1 FROM pacientes WHERE id = $1 AND ativo', [
        dados.pacienteId,
      ])
      if (pac.rowCount === 0) throw new NotFoundException('Paciente não encontrado.')

      const unidade = await this.unidadeValida(c, dados.unidadeId ?? null)

      let recebimentoId: string | null = null
      let modo: 'avulso' | 'saldo' = 'avulso'
      if (dados.pagamento !== undefined) {
        const aberto = dados.pagamento.valorTotal - dados.pagamento.valorEntrada
        // `saldo` quando a adesão abriu valor em aberto; `avulso` quando não.
        // Os nomes são os do `Code.gs` e do protótipo, e o migrador os copia
        // sem traduzir (regra 28).
        modo = aberto > 0n ? 'saldo' : 'avulso'
        recebimentoId = await this.lancarPagamentoDaAdesao(c, ctx, dados, aberto, agora, unidade)
      }

      const montado = await this.montador.montar(c, {
        clinicaId: ctx.clinicaId,
        pacienteId: dados.pacienteId,
        inicio: dados.inicio,
        itens: dados.itens.map(paraItemDeMontagem),
        hora: dados.hora ?? null,
        unidadeId: unidade,
        tarefaDeOrigemId: null,
        recebimentoDaAdesaoId: recebimentoId,
        valorTotal:
          dados.pagamento === undefined
            ? null
            : Dinheiro.deCentavos(dados.pagamento.valorTotal),
        modoDeCobranca: modo,
        atorId: ctx.ator,
        hojeDaClinica: hoje,
      })
      if (ehErro(montado)) throw traduzir(montado.erro)

      return this.lerMontado(c, montado.valor, modo, dados)
    })
  }

  /**
   * O PAGAMENTO DA ADESÃO: uma linha de `recebimentos`, presa à tarefa
   * companheira pelo índice único do épico 2 (regra 3).
   *
   * O `Code.gs` faz `Math.round((total - ent) * 100) / 100` ao montar a
   * adesão — **essa linha não atravessa**: aqui é subtração de `bigint` de
   * centavos, e o valor em aberto é um fato imutável do evento, não um saldo
   * corrente (o saldo continua derivado, regra 5).
   *
   * A tarefa companheira dá LINHA DO TEMPO ao dinheiro: a ficha da paciente
   * é uma lista só, e um recebimento sem tarefa some dela.
   */
  private async lancarPagamentoDaAdesao(
    c: pg.PoolClient,
    ctx: Contexto,
    dados: MontarPrograma,
    aberto: bigint,
    agora: Date,
    unidade: string | null,
  ): Promise<string> {
    const pagamento = dados.pagamento!
    const tarefa = await c.query<{ id: string }>(
      `INSERT INTO tarefas
         (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade,
          status, concluida_em, paciente_id, tipo, historico, unidade_id)
       VALUES ($1,$2,$2,$3,$4,'normal','concluida',$5,$6,$7,'[]',$8)
       RETURNING id`,
      [
        ctx.clinicaId,
        ctx.ator,
        'Adesão ao programa',
        diaCivil(agora, ctx.fuso),
        agora,
        dados.pacienteId,
        TIPO_DA_ADESAO,
        unidade,
      ],
    )
    const r = await c.query<{ id: string }>(
      `INSERT INTO recebimentos
         (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em,
          unidade_id, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        ctx.clinicaId,
        dados.pacienteId,
        tarefa.rows[0]!.id,
        TIPO_DA_ADESAO,
        // `bigint` vira texto no parâmetro: o driver não serializa bigint, e
        // `Number()` perderia precisão acima de 2^53 (regra 1).
        pagamento.valorEntrada.toString(),
        pagamento.forma,
        aberto.toString(),
        agora,
        unidade,
        ctx.ator,
      ],
    )
    return r.rows[0]!.id
  }

  /**
   * A unidade que não é desta clínica é DESCARTADA, não recusada.
   *
   * É a mesma decisão do épico 2 (`unidadeValida`): a unidade é organização
   * interna, e perder o vínculo não põe ninguém em risco. O responsável é
   * diferente — lá a recusa é a resposta certa, porque sem ele as sessões
   * ficam na agenda de ninguém.
   */
  private async unidadeValida(c: pg.PoolClient, id: string | null): Promise<string | null> {
    if (id === null) return null
    const r = await c.query('SELECT 1 FROM unidades WHERE id = $1', [id])
    return r.rowCount === 0 ? null : id
  }

  private async lerMontado(
    c: Transacao,
    montado: ProgramaMontado,
    modo: 'avulso' | 'saldo',
    dados: MontarPrograma,
  ): Promise<ProgramaMontadoNaSaida> {
    const itens = await c.query<{
      chave: string
      procedimento_id: string
      procedimento_nome: string
      rotulo_sessao: string
      sessoes: number
      intervalo_dias: number
      inicio: string
      depois_de: string | null
      responsavel_id: string
      dose: string
      insumo_id: string | null
      insumo_milesimos: string | null
      insumo_unidade: string | null
      valor: string | null
    }>(
      `SELECT chave, procedimento_id, procedimento_nome, rotulo_sessao, sessoes, intervalo_dias,
              inicio::text AS inicio, depois_de, responsavel_id, dose,
              insumo_id, insumo_milesimos::text AS insumo_milesimos, insumo_unidade,
              valor::text AS valor
         FROM itens_do_programa WHERE programa_id = $1 ORDER BY ordem`,
      [montado.programaId],
    )

    const paraItem = (l: (typeof itens.rows)[number]): ItemNoPrograma => ({
      chave: l.chave,
      procedimentoId: l.procedimento_id,
      procedimentoNome: l.procedimento_nome,
      rotuloSessao: l.rotulo_sessao,
      sessoes: l.sessoes,
      intervaloDias: l.intervalo_dias,
      inicio: l.inicio,
      depoisDe: l.depois_de,
      responsavelId: l.responsavel_id,
      dose: l.dose,
      insumo:
        l.insumo_id === null
          ? null
          : { itemId: l.insumo_id, quantidade: l.insumo_milesimos!, unidade: l.insumo_unidade! },
      valor: l.valor,
    })

    const totalPorItem = new Map(itens.rows.map((l) => [l.chave, l.sessoes]))
    return {
      id: montado.programaId,
      pacienteId: dados.pacienteId,
      inicio: dados.inicio,
      modoDeCobranca: modo,
      situacao: 'ativo',
      itens: itens.rows.map(paraItem),
      sessoes: montado.sessoes.map((s) => ({
        tarefaId: s.tarefaId,
        itemChave: s.itemChave,
        indice: s.indice,
        total: totalPorItem.get(s.itemChave)!,
        prazo: s.prazo,
        status: 'aberta' as const,
      })),
      retornosCancelados: [...montado.retornosCancelados],
    }
  }
}

const paraItemDeMontagem = (i: MontarPrograma['itens'][number]): ItemParaMontar => ({
  chave: i.chave,
  procedimentoId: i.procedimentoId,
  sessoes: i.sessoes,
  intervaloDias: i.intervaloDias,
  inicio: i.inicio ?? null,
  depoisDe: i.depoisDe ?? null,
  responsavelId: i.responsavelId ?? null,
  dose: i.dose ?? null,
  valor: i.valor === undefined ? null : Dinheiro.deCentavos(i.valor),
  insumo:
    i.insumo === undefined
      ? null
      : {
          itemId: i.insumo.itemId,
          // A dose anda COM a unidade, sempre. `Quantidade` a carrega no tipo.
          quantidade: Quantidade.deMilesimos(i.insumo.quantidade, i.insumo.unidade),
        },
})

/**
 * ERRO É VALOR NO DOMÍNIO, EXCEÇÃO NA BORDA — e o status diz o que fazer.
 *
 * `409` para o catálogo: o corpo está bem formado, o que mudou foi o ESTADO
 * do catálogo. `400` para o resto: foi o cliente que mandou algo que não
 * fecha (ciclo, item inexistente, responsável inativo).
 */
function traduzir(e: ErroDeDominio): Error {
  if (e.codigo === PROCEDIMENTO_FORA_DO_CATALOGO) return new ConflictException(e.mensagem)
  if (e.codigo === RESPONSAVEL_INVALIDO) return new BadRequestException(e.mensagem)
  return new BadRequestException(e.mensagem)
}

/** Reexportado para o controlador reconhecer o tipo do `Result`. */
export type { Result }
