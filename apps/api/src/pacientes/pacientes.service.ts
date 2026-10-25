import type {
  ConsultaDePacientes,
  EditarPaciente,
  FichaDoPaciente,
  ListaDePacientes,
  PacienteNaLista,
  SalvarPaciente,
} from '@fir/contracts'
import { diaCivil, type Relogio, type SaldoDoPaciente, somarDias, TIPOS } from '@fir/domain'
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { unidadeValida } from '../comum/unidade'
import { saldoDe, saldosDe } from '../financeiro/saldo.repositorio'

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
         p.unidade_id, p.ultima_consulta::text AS ultima_consulta, p.obs, p.ativo, p.criado_em,
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
         (SELECT coalesce(sum(r.valor), 0)::bigint FROM recebimentos r
           WHERE r.paciente_id = p.id AND r.estornado_em IS NULL
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
      let id: string
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO pacientes
             (clinica_id, nome, telefone, aniversario, origem, indicado_por, unidade_id,
              ultima_consulta, obs, criado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            clinicaId,
            dados.nome,
            dados.telefone,
            dados.aniversario ?? null,
            dados.origem,
            dados.indicadoPor,
            unidade,
            ultima,
            dados.obs,
            typeof ator === 'string' ? ator : null,
          ],
        )
        id = r.rows[0]!.id
      } catch (e) {
        // O conflito vem do BANCO, não de um `SELECT` antes: ler-depois-escrever
        // perde a corrida entre duas recepcionistas cadastrando a mesma
        // paciente ao mesmo tempo, e o índice não perde.
        if (ehNomeRepetido(e)) throw new ConflictException(NOME_REPETIDO)
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
      if (dados.indicadoPor !== undefined) por('indicado_por', dados.indicadoPor)
      if (dados.unidadeId !== undefined) {
        por('unidade_id', await unidadeValida(c, dados.unidadeId ?? null))
      }
      if (dados.ultimaConsulta !== undefined) {
        por('ultima_consulta', this.soPassado(dados.ultimaConsulta, fuso))
      }
      if (dados.obs !== undefined) por('obs', dados.obs)

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
  ): Promise<{ id: string; tarefas: number }> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const r = await c.query(
        'UPDATE pacientes SET ativo = false, desativado_em = now() WHERE id = $1 AND ativo',
        [id],
      )
      if (r.rowCount === 0) throw new NotFoundException('Paciente não encontrado.')
      const t = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM tarefas WHERE paciente_id = $1 AND excluida_em IS NULL',
        [id],
      )
      return { id, tarefas: Number(t.rows[0]!.n) }
    })
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

  async ficha(clinicaId: ClinicaId, ator: Ator, fuso: string, id: string): Promise<FichaDoPaciente> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const paciente = await this.lerUm(c, clinicaId, fuso, id)
      const tarefas = await c.query<{
        id: string
        descricao: string
        tipo: string
        prazo: string
        hora: string | null
        prioridade: 'normal' | 'urgente'
        status: 'aberta' | 'concluida' | 'cancelada'
        concluida_em: Date | null
        responsavel_id: string
        etapa: string | null
        resultado: string
      }>(
        `SELECT id, descricao, tipo, prazo::text AS prazo, hora::text AS hora, prioridade, status,
                concluida_em, responsavel_id, etapa::text AS etapa, resultado
           FROM tarefas
          WHERE paciente_id = $1 AND excluida_em IS NULL
          ORDER BY coalesce(concluida_em, (prazo + time '12:00') AT TIME ZONE $2) DESC`,
        [id, fuso],
      )
      return {
        ...paciente,
        tarefas: tarefas.rows.map((t) => ({
          id: t.id,
          descricao: t.descricao,
          tipo: t.tipo,
          prazo: t.prazo,
          hora: t.hora === null ? null : t.hora.slice(0, 5),
          prioridade: t.prioridade,
          status: t.status,
          concluidaEm: t.concluida_em === null ? null : t.concluida_em.toISOString(),
          responsavelId: t.responsavel_id,
          etapa: t.etapa,
          resultado: t.resultado,
        })),
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
