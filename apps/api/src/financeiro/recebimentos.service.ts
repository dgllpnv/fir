import {
  type ConsultaDeRecebimentos,
  type RecebimentoNaLista,
  type RegistrarRecebimento,
} from '@fir/contracts'
import {
  diaCivil,
  Dinheiro,
  ehPagamento,
  exigir,
  formaPrincipal,
  instanteDaConclusao,
  somarDias,
} from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import { exigePessoa, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { CODIGO_PARTES_ACIMA_DA_DIVIDA, type PartesAcimaDaDivida, partesDoPagamento } from '@fir/contracts'
import { declararMotivo, motivoDaAcao } from '../comum/motivo-de-suporte'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { campanhaParaVincular } from '../campanhas/vinculo'
import { unidadeValida } from '../comum/unidade'
import { DINHEIRO_QUE_ENTROU } from './dinheiro-que-entrou'
import { saldoDe } from './saldo.repositorio'
import {
  confirmacoesDe,
  conferirCaixaDoRecebimento,
  conferirDuplicidadeDoRecebimento,
} from './recebimentos.avisos'
import {
  emDominio,
  exigirMesmasPartes,
  gravarRecebimento,
  PARTES_EM_JSON,
  partesDoJson,
} from './partes'

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
  /** Quem pergunta vê valores? Decide se o 409 de partes acima da dívida leva o devido. */
  readonly valores?: boolean
}

type LinhaCrua = {
  id: string
  tarefa_id: string | null
  paciente_id: string
  paciente: string
  tipo: string
  valor: string
  valor_aberto: string
  partes: unknown
  em: string
  obs: string
  registrado_por: string
  estornado: boolean
}

const paraSaida = (l: LinhaCrua): RecebimentoNaLista => {
  // As partes (da maior para a menor): é DELAS que vem a forma. A venda a
  // prazo não tem parte e sai com a forma vazia, como sempre saiu.
  const partes = partesDoJson(l.partes)
  return {
  id: l.id,
  tarefaId: l.tarefa_id,
  pacienteId: l.paciente_id,
  paciente: l.paciente,
  tipo: l.tipo,
  valor: l.valor,
  valorAberto: l.valor_aberto,
  // `forma` da parte é restrita pelo `CHECK` da 0086 às cinco do contrato (ou
  // à vazia do legado); o `as` existe porque o jsonb devolve `string`.
  forma: (partes[0]?.forma ?? '') as RecebimentoNaLista['forma'],
  partes,
  em: l.em,
  obs: l.obs,
  registradoPor: l.registrado_por,
  estornado: l.estornado,
  }
}

const SELECT_BASE = `
  SELECT r.id, r.tarefa_id, r.paciente_id, p.nome AS paciente, r.tipo,
         r.valor::text AS valor, r.valor_aberto::text AS valor_aberto,
         ${PARTES_EM_JSON} AS partes,
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

      // As partes pedidas: a lista, ou a parte única com a forma de sempre.
      let partes = partesDoPagamento(dados)

      const jaExiste = await this.porRequisicao(c, ctx, dados.requisicaoId)
      if (jaExiste !== undefined) {
        // Mesma chave com OUTRAS formas é outro pedido, não um duplo toque (409).
        // Só compara quando o total bate: o "Saldo em aberto" corta o valor e o
        // reenvio vê um saldo que o primeiro já abateu.
        if (jaExiste.valor === dados.valor.toString()) {
          await exigirMesmasPartes(c, jaExiste.id, emDominio(partes))
        }
        return jaExiste
      }

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

      /*
       * A ORDEM DAQUI PARA BAIXO É DE SEGURANÇA (achados F2 e F8).
       *
       * Primeiro tudo o que NÃO depende de valor oculto (caixa fechado,
       * unidade, campanha); depois a duplicidade (igualdade com recebimentos
       * que, sem `valores`, chegam redigidos); por último a comparação com a
       * DÍVIDA, que é oculta e bisectável. Se a comparação viesse antes de uma
       * recusa neutra, quem não vê valores provocaria a recusa neutra (dia de
       * caixa fechado, `campanhaId` qualquer) e leria pelo código — 409 de
       * partes ou a recusa neutra — se V passa do saldo, sem gravar nada: o
       * saldo exato em ~30 pedidos. Com a comparação por último, a única
       * resposta distinguível depois dela é GRAVAR de verdade.
       *
       * Ainda DEPOIS de `porRequisicao` (ajuste 3 do gate): o duplo toque
       * devolve a linha que o primeiro gravou, e nunca um 409 sobre ela mesma.
       */
      const forma = formaPrincipal(emDominio(partes))
      await conferirCaixaDoRecebimento(c, {
        clinicaId: ctx.clinicaId,
        valor: dados.valor,
        forma,
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

      // A duplicidade compara o valor DIGITADO, antes do corte do "Saldo em
      // aberto": comparar o valor cortado (= a dívida) faria do aviso uma
      // pergunta sobre a dívida oculta, e a comparação com ela vem a seguir.
      await conferirDuplicidadeDoRecebimento(c, {
        clinicaId: ctx.clinicaId,
        pacienteId: dados.pacienteId,
        valor: dados.valor,
        recebidoEm,
        fuso: ctx.fuso,
        confirmacoes: confirmacoesDe(dados),
      })

      /**
       * "SALDO EM ABERTO" NUNCA PASSA DA DÍVIDA — e é a ÚLTIMA recusa antes da
       * escrita (ver o bloco acima).
       *
       * Pedido da cliente: o valor acima do que a paciente deve não vira
       * crédito — o recebimento é registrado só com o que quita o grupo
       * escolhido. O servidor, não a tela, faz o corte (regra 5: o saldo é
       * derivado por adesão, e um grupo negativo é o crédito que não queremos
       * fabricar aqui). Sem dívida no grupo, não há o que receber.
       */
      let valor = dados.valor
      if (dados.ref === 'saldo') {
        const s = await saldoDe(c, ctx.clinicaId, dados.pacienteId)
        const grupo = s.grupos.find((g) => g.programaId === programaId)
        const devido = grupo === undefined ? 0n : grupo.saldo.centavos
        if (devido <= 0n) {
          throw new ConflictException('Esta paciente não tem valor em aberto nesta dívida.')
        }
        if (valor > devido) {
          // VETO V-1: com VÁRIAS formas o servidor não escolhe de qual tirar —
          // a escolhida dependeria da ordem digitada, e o caixa acusaria uma
          // sobra que ninguém causou. Recusa, e a tela pede nova divisão.
          if (partes.length > 1) {
            const corpo: PartesAcimaDaDivida = {
              statusCode: 409,
              codigo: CODIGO_PARTES_ACIMA_DA_DIVIDA,
              message:
                'O valor passa do que a paciente deve nesta dívida. Divida de novo entre as formas, sem passar do valor em aberto.',
              ...(ctx.valores === true ? { devido: devido.toString() } : {}),
            }
            throw new ConflictException(corpo)
          }
          // Com UMA forma, o corte do pedido 6: entra só o que quita.
          valor = devido
          partes = partes.map((p) => ({ forma: p.forma, valor: devido }))
        }
      }

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
      const gravado = await gravarRecebimento(c, {
        clinicaId: ctx.clinicaId,
        pacienteId: dados.pacienteId,
        tarefaId: tarefa.rows[0]!.id,
        tipo,
        valor,
        valorAberto: aberto,
        recebidoEm,
        unidadeId: unidade,
        registradoPor: exigePessoa(ctx.ator),
        requisicaoId: dados.requisicaoId,
        programaId,
        partes,
      })

      if (!gravado.criado) {
        // Outra requisição com a MESMA chave ganhou a corrida entre o `SELECT`
        // acima e este `INSERT`. Desfaz a tarefa que acabou de nascer — ela
        // não tem recebimento e não pode ficar — e devolve o que já existe.
        await c.query('DELETE FROM tarefas WHERE id = $1', [tarefa.rows[0]!.id])
      }

      return this.lerUm(c, ctx, gravado.id)
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
