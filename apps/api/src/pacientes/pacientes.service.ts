import type {
  ConsultaDePacientes,
  DesativacaoNaFicha,
  DesativarPaciente,
  EditarPaciente,
  FichaDoPaciente,
  ListaDePacientes,
  PacienteNaLista,
  RazaoDeDesativacao,
  ReativarPaciente,
  SalvarPaciente,
  TarefaNaLista,
} from '@fir/contracts'
import { diaCivil, type Relogio, type SaldoDoPaciente, somarDias, TIPOS } from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import { pessoaDoAtor, type Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { declararMotivo, motivoDaAcao } from '../comum/motivo-de-suporte'
import { RELOGIO } from '../comum/relogio'
import { unidadeValida } from '../comum/unidade'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'
import { saldoDe, saldosDe } from '../financeiro/saldo.repositorio'
import {
  type LeitorDaRequisicao,
  type LinhaDeTarefa,
  aplicarPermissaoDeJornada,
  paraSaida as tarefaParaSaida,
  SELECT_TAREFA,
} from '../tarefas/leitura'
import { campanhaParaVincular } from '../campanhas/vinculo'
import { decidirIndicacaoNoBanco, traduzirErroDeIndicacao, vinculosNaFicha } from './vinculos-do-cadastro'

/**
 * Os tipos que contam como ATENDIMENTO.
 *
 * Os que ABATEM saldo moram em `saldo.repositorio.ts`, com a única leitura de
 * saldo do sistema — aqui eles não são mais necessários porque o `saldo` saiu
 * desta consulta.
 *
 * Derivados de `TIPOS`, em `@fir/domain`, e nunca escritos à mão no SQL: a
 * classificação mora numa tabela só, e um `tipo IN ('Consulta realizada', …)`
 * dentro de uma query é como o legado passou a ter a mesma regra em três
 * lugares — com duas delas já divergindo.
 */
const TIPOS_DE_ATENDIMENTO = TIPOS.filter((t) => t.atende === true).map((t) => t.nome)

/** "Sem retorno há 6+ meses" é 182 dias no protótipo. O mesmo número aqui. */
const DIAS_SEM_RETORNO = 182

/**
 * O "movimento" do paciente: o mais recente entre o último atendimento
 * registrado aqui e a última consulta informada no cadastro.
 *
 * Os dois, e não um: uma paciente com `ultima_consulta` antiga mas atendimento
 * recente NÃO é candidata a recaptação, e confundir os dois faz a clínica
 * ligar para quem esteve lá na semana passada.
 *
 * `greatest` do Postgres ignora NULL, então basta. Só é referenciável na
 * consulta EXTERNA — é alias do `WITH base`.
 */
const MOVIMENTO = 'greatest(ultimo_atendimento_data, ultima_consulta_data)'

/** As ordenações da tela. `ltv` exige `valores` — ver o controlador. */
const ORDENS: Readonly<Record<string, string>> = {
  recentes: `coalesce(${MOVIMENTO}, (criado_em AT TIME ZONE $2)::date) DESC, nome ASC`,
  nome: 'nome ASC',
  'ultima-consulta': `${MOVIMENTO} ASC NULLS LAST, nome ASC`,
  ltv: 'ltv::bigint DESC, nome ASC',
}

type LinhaDePaciente = {
  id: string
  nome: string
  telefone: string
  aniversario: string | null
  origem: string
  indicado_por: string
  unidade_id: string | null
  ultima_consulta: string | null
  obs: string
  conferir_cadastro: boolean
  ativo: boolean
  criado_em: Date
  ultimo_atendimento: string | null
  tarefas_abertas: string
  ltv: string
  total?: string
}

/**
 * A linha do banco mais o saldo que o DOMÍNIO calculou.
 *
 * `saldo` é parâmetro, e não coluna, porque a regra 5 não é um `SELECT`: ela
 * agrupa, clampa por grupo e preserva o crédito. Ver `saldo.repositorio.ts`.
 */
const paraSaida = (l: LinhaDePaciente, s: SaldoDoPaciente): PacienteNaLista => ({
  id: l.id,
  nome: l.nome,
  telefone: l.telefone,
  aniversario: l.aniversario,
  origem: l.origem,
  indicadoPor: l.indicado_por,
  unidadeId: l.unidade_id,
  ultimaConsulta: l.ultima_consulta,
  obs: l.obs,
  conferirCadastro: l.conferir_cadastro,
  ativo: l.ativo,
  criadoEm: l.criado_em.toISOString(),
  ultimoAtendimento: l.ultimo_atendimento,
  tarefasAbertas: Number(l.tarefas_abertas),
  ltv: l.ltv,
  saldo: s.saldo.centavos.toString(),
  credito: s.credito.centavos.toString(),
  temSaldo: s.temSaldo,
})

/**
 * O SELECT que todas as leituras de paciente compartilham.
 *
 * `ltv` é DERIVADO aqui, nunca coluna — e é uma soma simples, sem regra
 * nenhuma em cima.
 *
 * **`saldo` NÃO está mais aqui, e isso é o ponto.** Até o épico 4 esta
 * consulta trazia `greatest(0, Σ aberto − Σ abatido)`: a regra 5 escrita uma
 * segunda vez, em SQL, colapsada num total só e com o excedente sumindo sem
 * deixar rastro. Era a mesma dívida que o `CLAUDE.md` descreve no legado — a
 * mesma regra em dois lugares, já divergente de `saldoEmAberto`. O SQL foi
 * apagado, não só abandonado: enquanto ele existir, alguém volta a chamá-lo.
 * O saldo agora vem de `saldo.repositorio.ts` → `@fir/domain`, agrupado, com
 * o crédito preservado.
 *
 * As colunas `*_data` existem porque `date` do Postgres vira `Date` do
 * JavaScript no `pg`, e a saída precisa de `aaaa-mm-dd` — então a data sai em
 * texto, e a versão `date` fica para comparar e ordenar na consulta externa.
 *
 * `$1` clínica · `$2` fuso · `$3` tipos de atendimento.
 */
const SELECT_BASE = `
  SELECT p.id, p.nome, p.telefone, p.aniversario::text AS aniversario, p.origem, p.indicado_por,
         p.unidade_id, p.ultima_consulta::text AS ultima_consulta, p.obs, p.conferir_cadastro, p.ativo, p.criado_em,
         p.aniversario     AS aniversario_data,
         p.ultima_consulta AS ultima_consulta_data,
         (SELECT count(*) FROM tarefas t
           WHERE t.paciente_id = p.id AND t.status = 'aberta' AND t.excluida_em IS NULL
         ) AS tarefas_abertas,
         (SELECT max((t.concluida_em AT TIME ZONE $2)::date) FROM tarefas t
           WHERE t.paciente_id = p.id AND t.status = 'concluida' AND t.excluida_em IS NULL
             AND t.tipo = ANY($3)
         ) AS ultimo_atendimento_data,
         (SELECT max((t.concluida_em AT TIME ZONE $2)::date)::text FROM tarefas t
           WHERE t.paciente_id = p.id AND t.status = 'concluida' AND t.excluida_em IS NULL
             AND t.tipo = ANY($3)
         ) AS ultimo_atendimento,
         -- O LTV É O QUE ELA JÁ DEIXOU NA CLÍNICA, e promessa não é pagamento.
         --
         -- D-9: a venda a prazo é uma linha de recebimentos com valor = 0 e a
         -- dívida em valor_aberto. Somar valor_aberto aqui é o erro plausível
         -- de quem lê "lifetime value" como "quanto ela vale" — e faria a
         -- paciente que deve R$ 3.600 parecer ter pago R$ 3.600, que é a
         -- regra 4 virada do avesso. A dívida sai em saldo, ao lado.
         --
         -- O filtro usa a mesma constante do caixa e da lista do dia; o
         -- protótipo filtra o mesmo (pagos = rec.filter(valor > 0)), que é o
         -- que mantém o ticket médio dele honesto.
         (SELECT coalesce(sum(r.valor), 0)::bigint FROM recebimentos r
           WHERE r.paciente_id = p.id AND r.estornado_em IS NULL
             AND ${DINHEIRO_QUE_ENTROU}
         )::text AS ltv
    FROM pacientes p
   WHERE p.clinica_id = $1`

/** `23505` = unique_violation. */
const ehNomeRepetido = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  (e as { code?: string }).code === '23505' &&
  String((e as { constraint?: string }).constraint ?? '') === 'pacientes_nome_unico'


const NOME_REPETIDO = 'Já existe paciente com esse nome. Busque pelo nome para selecionar.'
const CADASTRO_DESATIVADO = 'Este cadastro está desativado. Reative para editar.'
const NOME_REPETIDO_NA_REATIVACAO =
  'Já existe um paciente ativo com este nome. Ajuste o nome de um deles antes de reativar.'

@Injectable()
export class PacientesService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /** O dia civil de hoje, no fuso da clínica. A autoridade é o servidor. */
  hojeDaClinica(fuso: string): string {
    return diaCivil(this.relogio.agora(), fuso)
  }

  /**
   * Data informada pela recepção que esteja no FUTURO é descartada, não
   * recusada — é o que o `Code.gs` faz (`d <= hoje() ? d : ''`). Recusar a
   * linha inteira por causa de uma data digitada errada faria perder o
   * cadastro; descartar a data perde só o que estava errado.
   */
  private soPassado(dia: string | null | undefined, fuso: string): string | null {
    if (!dia) return null
    return dia <= this.hojeDaClinica(fuso) ? dia : null
  }

  async criar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    dados: SalvarPaciente,
  ): Promise<PacienteNaLista> {
    const ultima = this.soPassado(dados.ultimaConsulta, fuso)
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const unidade = await unidadeValida(c, dados.unidadeId ?? null)
      // B2: a indicadora cadastrada, decidida no domínio e validada aqui.
      const indicacao = await decidirIndicacaoNoBanco(c, clinicaId, null, null, dados.origem, {
        indicadoPor: dados.indicadoPor,
        indicadoPorId: dados.indicadoPorId ?? null,
      })
      // "Chegou por uma campanha?": só a em andamento HOJE, na clínica (A3).
      // A validação é a da lista (`conferirVinculo`), nunca uma segunda janela.
      const campanha = await campanhaParaVincular(c, {
        clinicaId,
        campanhaId: dados.campanhaId,
        contexto: 'paciente',
        agora: this.relogio.agora(),
        fuso,
      })
      let id: string
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO pacientes
             (clinica_id, nome, telefone, aniversario, origem, indicado_por, unidade_id,
              ultima_consulta, obs, criado_por, indicado_por_id, campanha_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [
            clinicaId,
            dados.nome,
            dados.telefone,
            dados.aniversario ?? null,
            dados.origem,
            indicacao.indicadoPor ?? '',
            unidade,
            ultima,
            dados.obs,
            pessoaDoAtor(ator),
            indicacao.indicadoPorId ?? null,
            campanha,
          ],
        )
        id = r.rows[0]!.id
      } catch (e) {
        // O conflito vem do BANCO, não de um `SELECT` antes: ler-depois-escrever
        // perde a corrida entre duas recepcionistas cadastrando a mesma
        // paciente ao mesmo tempo, e o índice não perde.
        if (ehNomeRepetido(e)) throw new ConflictException(NOME_REPETIDO)
        traduzirErroDeIndicacao(e)
        throw e
      }
      return this.lerUm(c, clinicaId, fuso, id)
    })
  }

  async editar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    id: string,
    dados: EditarPaciente,
  ): Promise<PacienteNaLista> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      // A linha travada: a indicação e a campanha comparam o pedido com o que
      // ela JÁ tem (ausente mantém; o valor atual é aceito sem revalidar).
      const atual = (
        await c.query<{
          origem: string
          indicado_por_id: string | null
          campanha_id: string | null
        }>(
          `SELECT origem, indicado_por_id::text AS indicado_por_id, campanha_id::text AS campanha_id
             FROM pacientes WHERE clinica_id = $1 AND id = $2 AND ativo FOR UPDATE`,
          [clinicaId, id],
        )
      ).rows[0]
      if (atual === undefined) {
        // Desativado existe, mas não se edita: 404 aqui mandaria a recepção
        // procurar um cadastro que ela está vendo na tela. A RLS já escondeu
        // a outra clínica, então o `SELECT` não confirma nada de fora.
        const existe = await c.query(
          'SELECT 1 FROM pacientes WHERE clinica_id = $1 AND id = $2',
          [clinicaId, id],
        )
        if (existe.rowCount === 1) throw new ConflictException(CADASTRO_DESATIVADO)
        throw new NotFoundException('Paciente não encontrado.')
      }
      const indicacao = await decidirIndicacaoNoBanco(
        c,
        clinicaId,
        id,
        atual.indicado_por_id,
        dados.origem ?? atual.origem,
        {
          ...(dados.indicadoPor === undefined ? {} : { indicadoPor: dados.indicadoPor }),
          ...(dados.indicadoPorId === undefined ? {} : { indicadoPorId: dados.indicadoPorId }),
        },
      )

      const campos: string[] = []
      const params: unknown[] = [id]
      const por = (coluna: string, valor: unknown): void => {
        params.push(valor)
        campos.push(`${coluna} = $${params.length}`)
      }

      if (dados.nome !== undefined) por('nome', dados.nome)
      if (dados.telefone !== undefined) por('telefone', dados.telefone)
      if (dados.aniversario !== undefined) por('aniversario', dados.aniversario ?? null)
      if (dados.origem !== undefined) por('origem', dados.origem)
      if (indicacao.indicadoPor !== undefined) por('indicado_por', indicacao.indicadoPor)
      if (indicacao.indicadoPorId !== undefined) por('indicado_por_id', indicacao.indicadoPorId)
      // Três estados (N-4): ausente mantém; `null` remove; id troca — e a
      // campanha que ela JÁ tem passa mesmo encerrada (`atual`).
      if (dados.campanhaId !== undefined) {
        por(
          'campanha_id',
          await campanhaParaVincular(c, {
            clinicaId,
            campanhaId: dados.campanhaId,
            contexto: 'paciente',
            agora: this.relogio.agora(),
            fuso,
            atual: atual.campanha_id,
          }),
        )
      }
      if (dados.unidadeId !== undefined) {
        por('unidade_id', await unidadeValida(c, dados.unidadeId ?? null))
      }
      if (dados.ultimaConsulta !== undefined) {
        por('ultima_consulta', this.soPassado(dados.ultimaConsulta, fuso))
      }
      if (dados.obs !== undefined) por('obs', dados.obs)
      // Salvar a ficha É conferir o cadastro (ADR 0019): quem abriu, viu o
      // nome e o telefone que a agenda trouxe e salvou, assumiu o cadastro.
      campos.push('conferir_cadastro = false')

      if (campos.length > 0) {
        try {
          const r = await c.query(
            `UPDATE pacientes SET ${campos.join(', ')} WHERE id = $1 AND ativo`,
            params,
          )
          // `rowCount`, nunca "ler depois escrever". A RLS já devolve zero
          // linhas para a clínica errada, e zero é a mesma resposta de "não
          // existe" — que é o 404 que não confirma a existência de nada.
          if (r.rowCount === 0) throw new NotFoundException('Paciente não encontrado.')
        } catch (e) {
          if (ehNomeRepetido(e)) throw new ConflictException(NOME_REPETIDO)
          traduzirErroDeIndicacao(e)
          throw e
        }
      }
      return this.lerUm(c, clinicaId, fuso, id)
    })
  }

  /**
   * Desativar, nunca apagar — ADR 0003.
   *
   * Devolve quantas tarefas FICARAM: é o que a tela avisa antes, e o número
   * que mudou de significado ("a exclusão apaga também as tarefas vinculadas"
   * virou "o cadastro sai das listas; o histórico fica").
   */
  async desativar(
    clinicaId: ClinicaId,
    ator: Ator,
    id: string,
    dados: DesativarPaciente,
  ): Promise<{ id: string; tarefas: number }> {
    const motivoDeSuporte = motivoDaAcao(ator, dados.motivo)
    const detalhe = dados.detalhe === undefined || dados.detalhe === '' ? null : dados.detalhe
    // O texto da trilha é só a razão (+ detalhe curto). Na sessão de suporte vale
    // a justificativa do operador; a razão continua na coluna e no de/para.
    const motivoNaTrilha =
      motivoDeSuporte ?? (detalhe === null ? dados.razao : `${dados.razao}: ${detalhe}`)
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      await declararMotivo(c, motivoNaTrilha)
      const r = await c.query(
        `UPDATE pacientes
            SET ativo = false, desativado_em = now(),
                motivo_desativacao = $2, detalhe_desativacao = $3
          WHERE id = $1 AND ativo`,
        [id, dados.razao, detalhe],
      )
      if (r.rowCount === 0) throw new NotFoundException('Paciente não encontrado.')
      const t = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM tarefas WHERE paciente_id = $1 AND excluida_em IS NULL',
        [id],
      )
      return { id, tarefas: Number(t.rows[0]!.n) }
    })
  }

  /**
   * Reativar — ADR 2026-11-13. O inverso exato de `desativar`.
   *
   * `desativado_tem_instante` obriga a limpar `ativo` e `desativado_em`
   * juntos. O nome foi liberado ao desativar, então outra paciente pode tê-lo
   * tomado: o índice parcial `pacientes_nome_unico` recusa (23505) e a
   * resposta é 409, sem dizer nada além do que a recepção já vê na lista.
   * Tarefas, recebimentos e programas nunca saíram do lugar: reativar não
   * toca neles, e por isso LTV e saldo não mudam.
   *
   * Quem pediu para sair (`pediu-para-sair`) só volta com confirmação
   * reforçada: `confirmoQueOTitularPediu` e um motivo de 10 a 200. A razão é
   * lida do banco, nunca do corpo — o cliente não escolhe o quão fácil é.
   */
  async reativar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    id: string,
    dados: ReativarPaciente,
  ): Promise<PacienteNaLista> {
    const motivo = motivoDaAcao(ator, dados.motivo)
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const atual = await c.query<{ ativo: boolean; motivo_desativacao: string | null }>(
        'SELECT ativo, motivo_desativacao FROM pacientes WHERE clinica_id = $1 AND id = $2 FOR UPDATE',
        [clinicaId, id],
      )
      const linha = atual.rows[0]
      if (linha === undefined) throw new NotFoundException('Paciente não encontrado.')
      if (linha.ativo) throw new ConflictException('Este cadastro já está ativo.')
      if (linha.motivo_desativacao === 'pediu-para-sair') {
        if (dados.confirmoQueOTitularPediu !== true) {
          throw new ConflictException(
            'Este cadastro foi desativado porque o titular pediu para não ser contatado. Para reativar, confirme que o titular pediu para voltar.',
          )
        }
        if (motivo === null) {
          throw new BadRequestException(
            'Informe o motivo da reativação (de 10 a 200 caracteres). Não escreva dado de saúde.',
          )
        }
      }
      await declararMotivo(c, motivo)
      try {
        await c.query(
          `UPDATE pacientes
              SET ativo = true, desativado_em = NULL,
                  motivo_desativacao = NULL, detalhe_desativacao = NULL
            WHERE id = $1 AND NOT ativo`,
          [id],
        )
      } catch (e) {
        if (ehNomeRepetido(e)) throw new ConflictException(NOME_REPETIDO_NA_REATIVACAO)
        throw e
      }
      return this.lerUm(c, clinicaId, fuso, id)
    })
  }

  private async lerDesativacao(
    c: pg.PoolClient,
    id: string,
  ): Promise<DesativacaoNaFicha | null> {
    const r = await c.query<{ m: string; d: string | null; em: Date }>(
      `SELECT motivo_desativacao AS m, detalhe_desativacao AS d, desativado_em AS em
         FROM pacientes WHERE id = $1 AND NOT ativo AND motivo_desativacao IS NOT NULL`,
      [id],
    )
    const l = r.rows[0]
    if (l === undefined) return null
    return {
      razao: l.m as RazaoDeDesativacao, // CHECK da 0081 garante o conjunto fechado
      detalhe: l.d ?? '',
      desativadoEm: l.em.toISOString(),
    }
  }

  private async lerUm(
    c: pg.PoolClient,
    clinicaId: ClinicaId,
    fuso: string,
    id: string,
  ): Promise<PacienteNaLista> {
    const r = await c.query<LinhaDePaciente>(`${SELECT_BASE} AND p.id = $4`, [
      clinicaId,
      fuso,
      TIPOS_DE_ATENDIMENTO,
      id,
    ])
    const linha = r.rows[0]
    if (!linha) throw new NotFoundException('Paciente não encontrado.')
    // Na MESMA conexão e dentro da mesma `naClinica`: a RLS vale para as duas
    // consultas, e o saldo não pode vir de outra transação que leia um
    // recebimento que esta ainda não enxerga.
    return paraSaida(linha, await saldoDe(c, clinicaId, id))
  }

  /**
   * A ficha: o cadastro e o Histórico, com as tarefas na forma `TarefaNaLista`.
   *
   * A leitura das tarefas é `SELECT_TAREFA` — a ÚNICA leitura de tarefa do
   * sistema — e não uma consulta própria: uma terceira montagem da mesma
   * tarefa é exatamente como a ficha ficou sem a etapa e sem o orçamento
   * (correções da PO, A2). O dinheiro que ela carrega (`valorOrcamento`, o
   * pagamento embutido, o valor de cada item orçado) sai pelo
   * `RedacaoInterceptor`, como em toda rota: nenhum `if` de permissão aqui.
   *
   * Ordem do protótipo (`vPaciente`): abertas primeiro, depois a mais recente.
   *
   * `leitor.podeJornada` vem de `leitorDe(c)` no controlador — a permissão
   * resolvida no servidor, nunca um parâmetro da tela (S-5).
   */
  async ficha(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    leitor: Pick<LeitorDaRequisicao, 'podeJornada'>,
    id: string,
    podeGerir = false,
  ): Promise<FichaDoPaciente> {
    const hoje = this.hojeDaClinica(fuso)
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const paciente = await this.lerUm(c, clinicaId, fuso, id)
      const tarefas = await c.query<LinhaDeTarefa>(
        `${SELECT_TAREFA} AND t.paciente_id = $3
          ORDER BY (t.status = 'aberta') DESC,
                   coalesce(t.concluida_em, (t.prazo + coalesce(t.hora, time '12:00')) AT TIME ZONE $4) DESC,
                   t.criada_em DESC`,
        [clinicaId, hoje, id, fuso],
      )
      return {
        ...paciente,
        tarefas: tarefas.rows
          .map(tarefaParaSaida)
          .map((t) => aplicarPermissaoDeJornada(t, leitor.podeJornada)),
        hoje,
        // B2: só a linha do "indicado por" (e a campanha do cadastro).
        ...(await vinculosNaFicha(c, clinicaId, id)),
        desativacao: podeGerir ? await this.lerDesativacao(c, id) : null,
      }
    })
  }

  async listar(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    consulta: ConsultaDePacientes,
  ): Promise<ListaDePacientes> {
    const hoje = this.hojeDaClinica(fuso)
    const params: unknown[] = [clinicaId, fuso, TIPOS_DE_ATENDIMENTO]
    const prox = (valor: unknown): string => {
      params.push(valor)
      return `$${params.length}`
    }

    // Filtros que falam de COLUNA da tabela ficam dentro do `WITH base`; os
    // que falam dos campos DERIVADOS (`ultimo_atendimento`) só existem fora —
    // um alias do SELECT não é visível no WHERE do mesmo nível.
    const dentro: string[] = ['p.ativo']
    const fora: string[] = []

    if (consulta.q !== undefined && consulta.q !== '') {
      const digitos = consulta.q.replace(/\D/g, '')
      const alvos = [`p.nome_chave LIKE '%' || normalizar_nome(${prox(consulta.q)}) || '%'`]
      // Só busca por telefone quando há dígitos suficientes: sem isso,
      // `LIKE '%%'` casaria com todo mundo que tem telefone e a busca por
      // nome deixaria de filtrar.
      if (digitos.length >= 3) alvos.push(`p.telefone_chave LIKE '%' || ${prox(digitos)} || '%'`)
      dentro.push(`(${alvos.join(' OR ')})`)
    }
    if (consulta.origem !== undefined && consulta.origem !== '') {
      dentro.push(`p.origem = ${prox(consulta.origem)}`)
    }

    let ordem = ORDENS[consulta.ordem] ?? ORDENS['recentes']!
    switch (consulta.atalho) {
      case 'aniversariantes':
        // O MÊS DA CLÍNICA, não o do servidor: `hoje` veio de
        // `diaCivil(agora, fuso)`.
        dentro.push(`extract(month FROM p.aniversario) = ${prox(Number(hoje.slice(5, 7)))}`)
        ordem = 'extract(day FROM aniversario_data) ASC, nome ASC'
        break
      case 'com-tarefa-aberta':
        dentro.push(`EXISTS (SELECT 1 FROM tarefas t
          WHERE t.paciente_id = p.id AND t.status = 'aberta' AND t.excluida_em IS NULL)`)
        ordem = 'nome ASC'
        break
      case 'sem-retorno':
        // O movimento precisa EXISTIR: quem nunca apareceu não deixou de
        // voltar, e encher a campanha de recaptação com cadastro vazio é como
        // ela deixa de ser usada. É o filtro do protótipo (`x.s.ultAtend &&`).
        fora.push(
          `${MOVIMENTO} IS NOT NULL AND ${MOVIMENTO} < ${prox(somarDias(hoje, -DIAS_SEM_RETORNO))}::date`,
        )
        // Do mais antigo para o mais recente, SEMPRE: é o que a tela promete e
        // o que faz a lista servir de fila de ligação.
        ordem = `${MOVIMENTO} ASC`
        break
      default:
        break
    }

    const sql = `
      WITH base AS (${SELECT_BASE} AND ${dentro.join(' AND ')})
      SELECT *, count(*) OVER () AS total FROM base
       ${fora.length > 0 ? `WHERE ${fora.join(' AND ')}` : ''}
       ORDER BY ${ordem}
       LIMIT ${prox(consulta.limite)} OFFSET ${prox(consulta.deslocamento)}`

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const r = await c.query<LinhaDePaciente>(sql, params)
      // UMA consulta de saldo para a página inteira, nunca uma por linha: a
      // lista de pacientes é a tela mais aberta da clínica depois de Hoje.
      const saldos = await saldosDe(c, clinicaId, r.rows.map((x) => x.id))
      return {
        pacientes: r.rows.map((x) => paraSaida(x, saldos.get(x.id)!)),
        total: Number(r.rows[0]?.total ?? 0),
      }
    })
  }
}
