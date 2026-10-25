import type {
  ConsultaDeRecebimentos,
  RecebimentoNaLista,
  RegistrarRecebimento,
} from '@fir/contracts'
import { diaCivil, ehPagamento, exigir, instanteDaConclusao, somarDias } from '@fir/domain'
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
import { RELOGIO, type Relogio } from '../comum/relogio'
import { unidadeValida } from '../comum/unidade'

/**
 * O QUE o paciente está pagando → o TIPO de tarefa que o faturamento
 * classifica.
 *
 * Os quatro são do grupo **Pagamentos**, e `POST /v1/tarefas` recusa esses
 * tipos desde o épico 2 (`tipoQueNaoEhPagamento`). Os dois juntos fecham o
 * cerco: **a única porta para dinheiro avulso é esta rota**, e ela escreve
 * exatamente uma linha de `recebimentos`.
 *
 * `programa` e `saldo` caem no mesmo tipo de propósito — os dois ABATEM saldo
 * em aberto, e é o tipo que o cálculo de saldo consulta. O que os distingue é
 * a QUAL grupo o abate pertence, e isso é `programa_id`, coluna do épico 5.
 */
const TIPO_DA_REFERENCIA = {
  consulta: 'Pagamento de consulta',
  sinal: 'Sinal de consulta',
  novo: 'Pagamento de orçamento',
  programa: 'Pagamento de saldo em aberto',
  saldo: 'Pagamento de saldo em aberto',
} as const

/** O rótulo de `REFS_RECEB` do protótipo (linha 4917), que a ficha mostra. */
const DESCRICAO_DA_REFERENCIA = {
  consulta: 'Pagamento de consulta',
  sinal: 'Sinal de consulta',
  novo: 'Pagamento de orçamento',
  programa: 'Pagamento de programa em andamento',
  saldo: 'Pagamento de saldo em aberto',
} as const

type Referencia = keyof typeof TIPO_DA_REFERENCIA

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
}

type LinhaCrua = {
  id: string
  tarefa_id: string | null
  paciente_id: string
  paciente: string
  tipo: string
  valor: string
  valor_aberto: string
  forma: string
  em: string
  obs: string
  registrado_por: string
  estornado: boolean
}

const paraSaida = (l: LinhaCrua): RecebimentoNaLista => ({
  id: l.id,
  tarefaId: l.tarefa_id,
  pacienteId: l.paciente_id,
  paciente: l.paciente,
  tipo: l.tipo,
  valor: l.valor,
  valorAberto: l.valor_aberto,
  // `forma` do banco é restrita pelo `CHECK` da 0006 às mesmas cinco do
  // contrato; o `as` existe porque o driver devolve `string`.
  forma: l.forma as RecebimentoNaLista['forma'],
  em: l.em,
  obs: l.obs,
  registradoPor: l.registrado_por,
  estornado: l.estornado,
})

const SELECT_BASE = `
  SELECT r.id, r.tarefa_id, r.paciente_id, p.nome AS paciente, r.tipo,
         r.valor::text AS valor, r.valor_aberto::text AS valor_aberto, r.forma,
         ((r.recebido_em AT TIME ZONE $2)::date)::text AS em,
         coalesce(t.obs, '') AS obs, q.nome AS registrado_por,
         (r.estornado_em IS NOT NULL) AS estornado
    FROM recebimentos r
    JOIN pacientes p ON p.id = r.paciente_id
    JOIN pessoas  q ON q.id = r.registrado_por
    LEFT JOIN tarefas t ON t.id = r.tarefa_id
   WHERE r.clinica_id = $1`

@Injectable()
export class RecebimentosService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * O recebimento avulso: **uma transação**, duas linhas, e nenhuma coluna de
   * dinheiro em `tarefas`.
   *
   * A ordem é `recebimento` por último de propósito: é a vaga do índice
   * `recebimento_por_requisicao` que decide se este toque é o primeiro, e
   * perdê-la depois de criar a tarefa deixaria a tarefa órfã — por isso o
   * `ON CONFLICT DO NOTHING` é seguido de um `SELECT` do existente **dentro da
   * mesma transação**, e a tarefa só sobrevive se o recebimento nasceu.
   */
  async registrar(ctx: Contexto, dados: RegistrarRecebimento): Promise<RecebimentoNaLista> {
    const ref = dados.ref as Referencia

    // 409, e não 501: o cartão da paciente está impecável — ela de fato não
    // tem programa em andamento, porque programa não existe ainda. É o mesmo
    // texto da tela do protótipo.
    if (ref === 'programa') {
      throw new ConflictException('Este paciente não tem programa em andamento.')
    }

    const agora = this.relogio.agora()
    const hojeDaClinica = diaCivil(agora, ctx.fuso)
    if (dados.em > hojeDaClinica) {
      // A mensagem é a do protótipo, e o `exigir` abaixo daria a mesma — mas
      // dita aqui ela não depende de o domínio continuar com este texto.
      throw new BadRequestException('A data do recebimento precisa ser até hoje.')
    }
    const recebidoEm = exigirData(instanteDaConclusao(dados.em, hojeDaClinica, ctx.fuso, agora))

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      // O `SELECT` roda dentro de `naClinica`, então a RLS já filtra: a
      // paciente da clínica vizinha devolve zero linhas.
      const pac = await c.query('SELECT 1 FROM pacientes WHERE id = $1 AND ativo', [
        dados.pacienteId,
      ])
      if (pac.rowCount === 0) throw new NotFoundException('Paciente não encontrado.')

      const jaExiste = await this.porRequisicao(c, ctx, dados.requisicaoId)
      if (jaExiste !== undefined) return jaExiste

      const unidade = await unidadeValida(c, dados.unidadeId)
      const tipo = TIPO_DA_REFERENCIA[ref]

      const tarefa = await c.query<{ id: string }>(
        `INSERT INTO tarefas
           (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade,
            status, concluida_em, paciente_id, tipo, historico, resultado, obs, recorrencia, unidade_id)
         VALUES ($1,$2,$2,$3,$4,'normal','concluida',$5,$6,$7,'[]','','','',$8)
         RETURNING id`,
        [
          ctx.clinicaId,
          ctx.ator,
          DESCRICAO_DA_REFERENCIA[ref],
          dados.em,
          recebidoEm,
          dados.pacienteId,
          tipo,
          unidade,
        ],
      )

      const aberto = 'valorAberto' in dados ? (dados.valorAberto ?? 0n) : 0n
      const inserido = await c.query<{ id: string }>(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em,
            unidade_id, registrado_por, requisicao_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (clinica_id, requisicao_id) WHERE requisicao_id IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          ctx.clinicaId,
          dados.pacienteId,
          tarefa.rows[0]!.id,
          tipo,
          // `bigint` vira texto no parâmetro: o driver não serializa bigint, e
          // `Number()` perderia precisão acima de 2^53 (regra 1).
          dados.valor.toString(),
          dados.forma,
          aberto.toString(),
          recebidoEm,
          unidade,
          ctx.ator,
          dados.requisicaoId,
        ],
      )

      if (inserido.rowCount === 0) {
        // Outra requisição com a MESMA chave ganhou a corrida entre o `SELECT`
        // acima e este `INSERT`. Desfaz a tarefa que acabou de nascer — ela
        // não tem recebimento e não pode ficar — e devolve o que já existe.
        await c.query('DELETE FROM tarefas WHERE id = $1', [tarefa.rows[0]!.id])
        const existente = await this.porRequisicao(c, ctx, dados.requisicaoId)
        if (existente === undefined) {
          throw new ConflictException('Não consegui registrar o recebimento. Tente de novo.')
        }
        return existente
      }

      return this.lerUm(c, ctx, inserido.rows[0]!.id)
    })
  }

  async listar(ctx: Contexto, q: ConsultaDeRecebimentos): Promise<readonly RecebimentoNaLista[]> {
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)
    // A janela sai do relógio do SERVIDOR, no fuso da clínica (regras 23 e
    // 24). `ultimosDias: 7` inclui hoje, então a borda de baixo é `hoje − 6`.
    const { de, ate } =
      q.dia !== undefined
        ? { de: q.dia, ate: q.dia }
        : q.de !== undefined && q.ate !== undefined
          ? { de: q.de, ate: q.ate }
          : q.ultimosDias !== undefined
            ? { de: somarDias(hoje, -(q.ultimosDias - 1)), ate: hoje }
            : { de: hoje, ate: hoje }

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaCrua>(
        `${SELECT_BASE}
           AND ((r.recebido_em AT TIME ZONE $2)::date) BETWEEN $3::date AND $4::date
           AND ($5::uuid IS NULL OR r.paciente_id = $5)
           AND ($6::boolean OR r.estornado_em IS NULL)
           AND (t.id IS NULL OR t.excluida_em IS NULL)
         ORDER BY r.recebido_em DESC, r.criado_em DESC`,
        [
          ctx.clinicaId,
          ctx.fuso,
          de,
          ate,
          q.pacienteId ?? null,
          q.incluirEstornados ?? false,
        ],
      )
      return r.rows.map(paraSaida)
    })
  }

  /**
   * Estorna — **nunca apaga** (regra 20).
   *
   * E só alcança o recebimento AVULSO. Desfazer o pagamento embutido num
   * atendimento é REABRIR o atendimento (épico 2): uma segunda porta para o
   * mesmo estorno é a porta que esquece de reabrir a tarefa, e o atendimento
   * ficaria concluído sem o dinheiro que a recepção acha que lançou.
   */
  async estornar(ctx: Contexto, id: string): Promise<void> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<{ tipo: string; tarefa_id: string | null; estornado_em: Date | null }>(
        'SELECT tipo, tarefa_id, estornado_em FROM recebimentos WHERE id = $1',
        [id],
      )
      const linha = r.rows[0]
      if (linha === undefined) throw new NotFoundException('Recebimento não encontrado.')
      if (linha.estornado_em !== null) {
        throw new ConflictException('Este recebimento já foi estornado.')
      }
      if (!ehPagamento(linha.tipo)) {
        throw new ConflictException(
          'Este pagamento está dentro de um atendimento. Para desfazê-lo, reabra o atendimento.',
        )
      }

      await c.query('UPDATE recebimentos SET estornado_em = now() WHERE id = $1', [id])
      // A tarefa companheira existe para dar linha do tempo ao dinheiro. Sem
      // o dinheiro ela não tem o que contar — e deixá-la concluída na ficha
      // diria que houve um pagamento que não houve. Soft delete: a trilha fica.
      if (linha.tarefa_id !== null) {
        await c.query('UPDATE tarefas SET excluida_em = now() WHERE id = $1', [linha.tarefa_id])
      }
    })
  }

  private async porRequisicao(
    c: pg.PoolClient,
    ctx: Contexto,
    requisicaoId: string,
  ): Promise<RecebimentoNaLista | undefined> {
    const r = await c.query<LinhaCrua>(`${SELECT_BASE} AND r.requisicao_id = $3`, [
      ctx.clinicaId,
      ctx.fuso,
      requisicaoId,
    ])
    const linha = r.rows[0]
    return linha === undefined ? undefined : paraSaida(linha)
  }

  private async lerUm(c: pg.PoolClient, ctx: Contexto, id: string): Promise<RecebimentoNaLista> {
    const r = await c.query<LinhaCrua>(`${SELECT_BASE} AND r.id = $3`, [ctx.clinicaId, ctx.fuso, id])
    const linha = r.rows[0]
    if (linha === undefined) throw new NotFoundException('Recebimento não encontrado.')
    return paraSaida(linha)
  }
}

/** `Result` do domínio vira `400` na borda. Erro é valor dentro, exceção fora. */
function exigirData(r: ReturnType<typeof instanteDaConclusao>): Date {
  try {
    return exigir(r)
  } catch {
    throw new BadRequestException('A data do recebimento precisa ser até hoje.')
  }
}
