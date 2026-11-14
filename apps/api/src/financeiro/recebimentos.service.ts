import {
  CODIGO_CONFIRMACAO_NECESSARIA,
  type ConfirmacaoNecessaria,
  type ConsultaDeRecebimentos,
  type RecebimentoNaLista,
  type RegistrarRecebimento,
} from '@fir/contracts'
import { diaCivil, ehPagamento, exigir, instanteDaConclusao, somarDias } from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import { exigePessoa, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { declararMotivo, motivoDaAcao } from '../comum/motivo-de-suporte'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { campanhaParaVincular } from '../campanhas/vinculo'
import { unidadeValida } from '../comum/unidade'
import { DINHEIRO_QUE_ENTROU } from './dinheiro-que-entrou'
import { saldoDe } from './saldo.repositorio'
import { confirmacoesDe, conferirAvisosDoRecebimento } from './recebimentos.avisos'

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
  readonly ator: Ator
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

    // O 409 "Este paciente não tem programa em andamento." SAIU AQUI (épico 5,
    // Task 11). Ele era verdade enquanto programa não existia; agora a recusa
    // é a do programa de verdade, lá embaixo, e ela sabe a diferença entre
    // "não existe" e "não é desta paciente".

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

      /**
       * O PAGAMENTO DE UM PROGRAMA — e o `programa_id` que o saldo agrupa.
       *
       * Sem este carimbo, o abatimento cairia no grupo GERAL do
       * `saldoEmAberto` (épico 4) e a paciente com dois programas veria o
       * pagamento de um abater a dívida do outro. O agrupamento por adesão é
       * a regra 5, e é o que a cobrança usa.
       *
       * A conferência é por PACIENTE, não só por clínica: um `programaId`
       * válido de OUTRA paciente colaria um pagamento na dívida alheia, e
       * nenhuma FK impede isso — `recebimentos.programa_id` referencia
       * `programas`, não o par (programa, paciente). A RLS cuida da clínica;
       * esta consulta cuida da paciente.
       */
      // A união é estreitada por `dados.ref`, e não pela variável `ref`: ela
      // é um `as`, e um `as` não estreita o objeto de onde saiu.
      // `saldo` também pode apontar a dívida de um programa (ausente = o grupo geral).
      const programaId =
        dados.ref === 'programa'
          ? dados.programaId
          : dados.ref === 'saldo'
            ? (dados.programaId ?? null)
            : null
      if (programaId !== null) {
        const prog = await c.query(
          `SELECT 1 FROM programas
            WHERE id = $1 AND paciente_id = $2 AND excluido_em IS NULL`,
          [programaId, dados.pacienteId],
        )
        if (prog.rowCount === 0) {
          throw new ConflictException('Este paciente não tem programa em andamento.')
        }
      }

      /**
       * "SALDO EM ABERTO" NÃO GERA CRÉDITO EM SILÊNCIO.
       *
       * Pagar mais do que a dívida do grupo escolhido deixaria o grupo negativo
       * e o excedente sumiria como "crédito". O servidor — não a tela — decide:
       * 409 `CONFIRMACAO_NECESSARIA` com o aviso, SEM número (a redação central
       * não alcança corpo de erro, e o aviso é decidido pelo estado, nunca pelo
       * valor: quem não tem `valores` não vira oráculo do saldo). Com a
       * confirmação explícita, o excedente vira crédito, como sempre foi.
       */
      if (dados.ref === 'saldo' && dados.confirmarAcimaDaDivida !== true) {
        const s = await saldoDe(c, ctx.clinicaId, dados.pacienteId)
        const grupo = s.grupos.find((g) => g.programaId === programaId)
        const devido = grupo === undefined ? 0n : grupo.saldo.centavos
        if (dados.valor > devido) {
          const corpo: ConfirmacaoNecessaria = {
            statusCode: 409,
            codigo: CODIGO_CONFIRMACAO_NECESSARIA,
            avisos: ['VALOR_ACIMA_DA_DIVIDA'],
            message: 'O valor passa do que está em aberto nesta dívida. Confirme para registrar.',
          }
          throw new HttpException(corpo, HttpStatus.CONFLICT)
        }
      }

      // DEPOIS de `porRequisicao` (ajuste 3 do gate): o duplo toque devolve a
      // linha que o primeiro gravou, e nunca um 409 sobre ela mesma.
      await conferirAvisosDoRecebimento(c, {
        clinicaId: ctx.clinicaId,
        pacienteId: dados.pacienteId,
        valor: dados.valor,
        forma: dados.forma,
        recebidoEm,
        fuso: ctx.fuso,
        confirmacoes: confirmacoesDe(dados),
      })

      const unidade = await unidadeValida(c, dados.unidadeId)
      const tipo = TIPO_DA_REFERENCIA[ref]

      /**
       * A CAMPANHA vai para a TAREFA companheira — e só para ela (N-3).
       * `recebimentos` não tem `campanha_id`: a receita da campanha tem um
       * caminho só (`campanhas → tarefas → recebimentos`, N-1).
       *
       * Validada DEPOIS de `porRequisicao`, como os avisos: o duplo toque
       * devolve a linha que o primeiro gravou, com a campanha do primeiro
       * pedido, mesmo que ela tenha sido excluída entre os dois toques.
       */
      const campanhaId = await campanhaParaVincular(c, {
        clinicaId: ctx.clinicaId,
        campanhaId: dados.campanhaId,
        contexto: 'tarefa',
        agora,
        fuso: ctx.fuso,
      })

      const tarefa = await c.query<{ id: string }>(
        `INSERT INTO tarefas
           (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade,
            status, concluida_em, paciente_id, tipo, historico, resultado, obs, recorrencia, unidade_id,
            campanha_id)
         VALUES ($1,$2,$2,$3,$4,'normal','concluida',$5,$6,$7,'[]','','','',$8,$9)
         RETURNING id`,
        [
          ctx.clinicaId,
          // `tarefas.solicitante_id` e `recebimentos.registrado_por` sao
          // NOT NULL: registrar dinheiro e ritual da clinica (D-13).
          exigePessoa(ctx.ator),
          DESCRICAO_DA_REFERENCIA[ref],
          dados.em,
          recebidoEm,
          dados.pacienteId,
          tipo,
          unidade,
          campanhaId,
        ],
      )

      const aberto = 'valorAberto' in dados ? (dados.valorAberto ?? 0n) : 0n
      const inserido = await c.query<{ id: string }>(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tarefa_id, tipo, valor, forma, valor_aberto, recebido_em,
            unidade_id, registrado_por, requisicao_id, programa_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
          exigePessoa(ctx.ator),
          dados.requisicaoId,
          programaId,
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
           -- D-9: a VENDA A PRAZO fica fora desta lista. Ela é uma linha de
           -- recebimentos com valor = 0 e a dívida inteira em valor_aberto —
           -- o programa que fechou e que a paciente paga depois. Mostrá-la
           -- aqui poria um R$ 0,00 sem forma na seção "Recebimentos de hoje"
           -- e a somaria no contador do cabeçalho, que é o que o protótipo faz
           -- (ehReceb dá true por ehPagamento(tipo) antes de olhar o valor) e
           -- o que a decisão proíbe. A dívida aparece no SALDO da paciente,
           -- que é o lugar dela.
           AND ${DINHEIRO_QUE_ENTROU}
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
  async estornar(ctx: Contexto, id: string, motivoInformado?: string): Promise<void> {
    // Sessão de suporte: sem motivo, 400 antes de abrir a transação (I1).
    const motivo = motivoDaAcao(ctx.ator, motivoInformado)
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await declararMotivo(c, motivo)
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
          'Este pagamento está dentro de um atendimento. Para desfazê-lo, reabra o atendimento ou, se o orçamento já foi fechado, abra Editar e use Excluir.',
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
