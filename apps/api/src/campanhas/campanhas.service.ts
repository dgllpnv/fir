import type {
  CampanhaDetalhe,
  CampanhaImportada,
  CampanhaNaLista,
  Campanhas,
  ConsultaDeCampanhas,
  ConsultaDeTarefasDaCampanha,
  ImportarCampanha,
  LinhaPorPessoa,
  LinhaPorTipo,
  MetricaDeCampanha,
  RascunhoDeCampanha,
  SalvarCampanha,
  SituacaoDaCampanha,
  TarefasDaCampanha,
} from '@fir/contracts'
import { METRICAS_DE_CAMPANHA, METRICA_EM_DINHEIRO } from '@fir/contracts'
import {
  TIPOS,
  TIPOS_DE_CONTATO,
  TIPOS_QUE_ATENDEM,
  diasEntre,
  emAndamento,
  fimDoMes,
  inicioDoDia,
  limparNomeDeLista,
  percentualInteiro,
  somarDias,
  somarMeses,
} from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import { exigePessoa, pessoaDoAtor, type Ator, type PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from '../estoque/dia-da-clinica'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'
import {
  aplicarPermissaoDeJornada,
  FORA_DE_PACIENTE_DESATIVADO,
  type LinhaDeTarefa,
  paraSaida,
  SELECT_TAREFA,
} from '../tarefas/leitura'
import { RECEITA_DA_CAMPANHA } from './receita-da-campanha'

/**
 * **Comercial › Campanhas** (MANUAL cap. 9).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NADA DE RESULTADO É GRAVADO (regra 11)
 *
 * `resultado`, `percentualDaMeta`, `receita`, `pacientesAlcancados`,
 * `pacientesConvertidos` e `taxaDeConversao` são **uma consulta só**, feita a
 * cada leitura sobre `tarefas` e `recebimentos`. O protótipo calcula os seis
 * no navegador (`statsCamp`), e por isso a definição de "convertido" mora só
 * lá.
 *
 * **As definições, portadas de `statsCamp` e medidas:**
 *
 *   `ts`           tarefas da campanha que não foram canceladas
 *   `feitas`       delas, as concluídas
 *   `contatos`     feitas **com paciente** cujo tipo é contato
 *   `conv`         feitas **com paciente** cujo tipo ATENDE
 *   `pacAlc`       pacientes distintos com alguma tarefa feita
 *   `pacConv`      pacientes distintos com alguma `conv`
 *   `receita`      soma, em centavos, do que ENTROU nas feitas que são receita
 *
 * **`resultado` depende da métrica**, e `convertidos` conta PACIENTES
 * DISTINTOS, não tarefas — `pacConv.size`, não `conv.length`. A diferença é a
 * paciente que fez consulta e procedimento na mesma campanha: ela é **uma**
 * conversão, e contá-la duas vezes faz a campanha bater a meta sem ter
 * convertido ninguém a mais.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **Este serviço não decide quem vê valor.** `metaEmDinheiro`,
 * `resultadoEmDinheiro` e `receita` estão em `CAMPOS_MONETARIOS`, e o
 * `RedacaoInterceptor` os apaga num ponto único (regra 17). O protótipo faz
 * `oculto: c.metrica==="receita" && !vVal()` **na tela**, que é um `if` por
 * tela — e a rota continua entregando o número inteiro.
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: Ator
  readonly fuso: string
  /**
   * `pode('valores')` de quem pergunta. Ausente = `false`: quem esquece de
   * dizer não ganha o percentual de uma campanha de receita (regra 17).
   */
  readonly valores?: boolean
}

type LinhaDeCampanha = {
  id: string
  categoria: string
  foco: string
  nome: string
  objetivo: string
  inicio: string
  fim: string
  metrica: MetricaDeCampanha
  tipo_metrica: string
  meta: string
  tarefas: string
  feitas: string
  abertas: string
  contatos: string
  por_tipo: string
  pac_alcancados: string
  pac_convertidos: string
  receita: string
}

@Injectable()
export class CampanhasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async listar(ctx: Contexto, consulta: ConsultaDeCampanhas = {}): Promise<Campanhas> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) =>
      this.montar(c, ctx, hoje, consulta),
    )
  }

  /**
   * O detalhe de UMA campanha (`vCampanha`). **Não há segunda fórmula**: a
   * campanha e o histórico saem do mesmo `montar` da lista, e só o que a lista
   * não tem (por tipo, por pessoa, conversões) é consulta nova — sobre as
   * mesmas tarefas e com o mesmo predicado de receita.
   */
  async detalhe(ctx: Contexto, id: string): Promise<CampanhaDetalhe> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const todas = await this.montarCampanhas(c, ctx, hoje)
      const camp = todas.find((x) => x.id === id)
      if (camp === undefined) throw new NotFoundException('Campanha não encontrada.')

      const porTipoSql = await c.query<{
        tipo: string
        planejadas: string
        realizadas: string
        valor: string
      }>(
        `SELECT t.tipo,
                count(*)::text AS planejadas,
                count(*) FILTER (WHERE t.status = 'concluida')::text AS realizadas,
                coalesce(sum(r.valor) FILTER (WHERE ${RECEITA_DA_CAMPANHA}), 0)::text AS valor
           FROM tarefas t
           LEFT JOIN recebimentos r
                  ON r.tarefa_id = t.id
                 AND r.estornado_em IS NULL
                 AND ${DINHEIRO_QUE_ENTROU}
          WHERE t.clinica_id = $1 AND t.campanha_id = $2
            AND t.excluida_em IS NULL AND t.status <> 'cancelada'
            AND ${FORA_DE_PACIENTE_DESATIVADO}
          GROUP BY t.tipo`,
        [ctx.clinicaId, id],
      )
      // A ordem do catálogo (o `CONFIG.TIPOS` dela), com as internas na frente.
      const ordemDoTipo = (n: string): number =>
        n === '' ? -1 : TIPOS.findIndex((t) => t.nome === n) + 1 || 9999
      const porTipo: LinhaPorTipo[] = porTipoSql.rows
        .map((l) => ({
          tipo: l.tipo,
          rotulo: l.tipo === '' ? 'Tarefas internas' : l.tipo,
          planejadas: Number(l.planejadas),
          realizadas: Number(l.realizadas),
          valor: l.valor,
        }))
        .sort(
          (a, b) =>
            ordemDoTipo(a.tipo) - ordemDoTipo(b.tipo) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'),
        )

      const porPessoa: LinhaPorPessoa[] = (
        await c.query<{ id: string; nome: string; planejadas: string; realizadas: string }>(
          `SELECT p.id::text AS id, p.nome,
                  count(*)::text AS planejadas,
                  count(*) FILTER (WHERE t.status = 'concluida')::text AS realizadas
             FROM tarefas t JOIN pessoas p ON p.id = t.responsavel_id
            WHERE t.clinica_id = $1 AND t.campanha_id = $2
              AND t.excluida_em IS NULL AND t.status <> 'cancelada'
              AND ${FORA_DE_PACIENTE_DESATIVADO}
            GROUP BY p.id, p.nome`,
          [ctx.clinicaId, id],
        )
      ).rows
        .map((l) => ({
          pessoaId: l.id,
          nome: l.nome,
          planejadas: Number(l.planejadas),
          realizadas: Number(l.realizadas),
        }))
        .sort((a, b) => b.realizadas - a.realizadas || a.nome.localeCompare(b.nome, 'pt-BR'))

      const conversoes = Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM tarefas t
              WHERE t.clinica_id = $1 AND t.campanha_id = $2 AND t.excluida_em IS NULL
                AND t.status = 'concluida' AND t.paciente_id IS NOT NULL
                AND t.tipo = ANY($3)`,
            [ctx.clinicaId, id, [...TIPOS_QUE_ATENDEM]],
          )
        ).rows[0]?.n ?? 0,
      )

      const ehDinheiro = camp.metrica === METRICA_EM_DINHEIRO
      const meta = BigInt(ehDinheiro ? camp.metaEmDinheiro! : camp.metaEmNumero!)
      const resultado = BigInt(ehDinheiro ? camp.resultadoEmDinheiro! : camp.resultadoEmNumero!)
      const falta = resultado >= meta ? 0n : meta - resultado

      // O histórico: mesma categoria — e, em "Procedimento específico", o
      // mesmo foco (`norm(x.foco) === norm(c.foco)` dela).
      const ESPECIFICO = 'Procedimento específico'
      const historico = todas
        .filter(
          (x) =>
            x.categoria === camp.categoria &&
            (camp.categoria !== ESPECIFICO || semAcento(x.foco) === semAcento(camp.foco)),
        )
        .sort((a, b) => b.inicio.localeCompare(a.inicio) || a.nome.localeCompare(b.nome, 'pt-BR'))

      return {
        hoje,
        campanha: camp,
        funil: {
          planejadas: camp.tarefas,
          emAberto: camp.tarefasAbertas,
          realizadas: camp.tarefasConcluidas,
          percentualRealizado:
            camp.tarefas === 0
              ? 0
              : (percentualInteiro(BigInt(camp.tarefasConcluidas), BigInt(camp.tarefas)) ?? 0),
          alcancados: camp.pacientesAlcancados,
          convertidos: camp.pacientesConvertidos,
          taxaDeConversao: camp.taxaDeConversao,
          conversoes,
          receita: camp.receita,
        },
        // Em campanha de receita, quem não tem `valores` não pode saber se a
        // receita bateu a meta: o booleano seria o percentual por outro caminho.
        metaAtingida: ehDinheiro && ctx.valores !== true ? false : resultado >= meta,
        faltaEmDinheiro: ehDinheiro ? falta.toString() : null,
        faltaEmNumero: ehDinheiro ? null : Number(falta),
        porTipo,
        porPessoa,
        tituloDoHistorico:
          historico.length > 1
            ? camp.categoria === ESPECIFICO && camp.foco !== ''
              ? camp.foco
              : camp.categoria
            : '',
        historico: historico.length > 1 ? historico : [],
      }
    })
  }

  /**
   * **As tarefas da campanha** — `cardTarefa` na lista e no `drill` do protótipo.
   *
   * **TODAS as da campanha, para quem tem `campanhas`** (decisão do dono, ADR
   * 2026-11-13): sem o recorte de `escopo` de `GET /v1/tarefas`. A permissão é
   * conferida no controlador; a RLS isola a clínica; e a leitura é a
   * `SELECT_TAREFA` única, então o cartão é o mesmo de Hoje e de Tarefas.
   *
   * O telefone da paciente SAI `null` sem a permissão `pacientes`: o nome fica
   * (é o que a campanha precisa para dizer "quem foi alcançado"), mas o
   * contato é dado do cadastro, e a Recepção desta tela pode não ter a ficha.
   * Sem `jornada`, o cartão sai sem histórico, procedimentos e dose.
   */
  async tarefas(
    ctx: Contexto,
    id: string,
    q: ConsultaDeTarefasDaCampanha,
    podePacientes: boolean,
    podeJornada: boolean,
  ): Promise<TarefasDaCampanha> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    if (
      (q.recorte === 'tipo-planejadas' || q.recorte === 'tipo-realizadas') &&
      q.tipo === undefined
    ) {
      throw new BadRequestException('Informe o tipo.')
    }
    if (
      (q.recorte === 'pessoa-planejadas' || q.recorte === 'pessoa-realizadas') &&
      q.pessoaId === undefined
    ) {
      throw new BadRequestException('Informe a pessoa.')
    }

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const camp = (
        await c.query<{ metrica: MetricaDeCampanha; tipo_metrica: string }>(
          `SELECT metrica, tipo_metrica FROM campanhas
            WHERE id = $1 AND clinica_id = $2 AND excluida_em IS NULL`,
          [id, ctx.clinicaId],
        )
      ).rows[0]
      if (camp === undefined) throw new NotFoundException('Campanha não encontrada.')

      /**
       * As condições do recorte, escritas UMA vez e montadas para duas
       * consultas (a lista e a soma do `drill`): cada uma com a sua
       * numeração de parâmetros, a partir de `base`.
       */
      const condicoes = (base: number): { sql: string[]; valores: unknown[] } => {
        const sql: string[] = []
        const valores: unknown[] = []
        const p = (v: unknown): string => {
          valores.push(v)
          return `$${base + valores.length}`
        }
        const feita = "t.status = 'concluida'"
        const comPaciente = 't.paciente_id IS NOT NULL'
        const planejada = "t.status <> 'cancelada'"
        const doTipo = (): string => `t.tipo = ${p(q.tipo === '__interna' ? '' : q.tipo)}`
        const daPessoa = (): string => `t.responsavel_id = ${p(q.pessoaId)}`
        switch (q.recorte) {
          case undefined:
            if (q.situacao === 'abertas') sql.push("t.status = 'aberta'")
            else if (q.situacao === 'concluidas') sql.push(feita)
            break
          case 'planejadas':
            sql.push(planejada)
            break
          case 'realizadas':
            sql.push(feita)
            break
          case 'alcancadas':
            sql.push(feita, comPaciente)
            break
          case 'conversoes':
            sql.push(feita, comPaciente, `t.tipo = ANY(${p([...TIPOS_QUE_ATENDEM])})`)
            break
          case 'resultado':
            if (camp.metrica === 'contatos') {
              sql.push(feita, comPaciente, `t.tipo = ANY(${p([...TIPOS_DE_CONTATO])})`)
            } else if (camp.metrica === 'tipo') {
              sql.push(feita, `t.tipo = ${p(camp.tipo_metrica)}`)
            } else if (camp.metrica === 'convertidos') {
              sql.push(feita, comPaciente, `t.tipo = ANY(${p([...TIPOS_QUE_ATENDEM])})`)
            } else {
              // A MESMA receita da lista: o predicado único (N-2).
              sql.push(RECEITA_DA_CAMPANHA)
            }
            break
          case 'tipo-planejadas':
            sql.push(planejada, doTipo())
            break
          case 'tipo-realizadas':
            sql.push(feita, doTipo())
            break
          case 'pessoa-planejadas':
            sql.push(planejada, daPessoa())
            break
          case 'pessoa-realizadas':
            sql.push(feita, daPessoa())
            break
        }
        return { sql, valores }
      }

      // `$1` clínica, `$2` hoje (do SELECT_TAREFA), `$3` campanha, `$4` fuso.
      const ate = 4
      const onde = condicoes(ate)
      const pLimite = `$${ate + onde.valores.length + 1}`
      const pDesloc = `$${ate + onde.valores.length + 2}`
      const r = await c.query<LinhaDeTarefa>(
        `WITH base AS (${SELECT_TAREFA} AND t.campanha_id = $3
            AND ${FORA_DE_PACIENTE_DESATIVADO}${onde.sql
          .map((o) => ` AND ${o}`)
          .join('')})
         SELECT *, count(*) OVER () AS total FROM base
          ORDER BY ${q.recorte === undefined ? "(status = 'aberta') DESC, " : ''}
                   coalesce((concluida_em AT TIME ZONE $4::text)::date::text, prazo) DESC,
                   criada_em DESC, id
          LIMIT ${pLimite} OFFSET ${pDesloc}`,
        [ctx.clinicaId, hoje, id, ctx.fuso, ...onde.valores, q.limite, q.deslocamento],
      )

      let valorTotal: string | null = null
      if (q.recorte !== undefined) {
        const soma = condicoes(2)
        valorTotal = (
          await c.query<{ s: string }>(
            `SELECT coalesce(sum(r.valor) FILTER (WHERE ${RECEITA_DA_CAMPANHA}), 0)::text AS s
               FROM tarefas t
               LEFT JOIN recebimentos r ON r.tarefa_id = t.id AND r.estornado_em IS NULL
              WHERE t.clinica_id = $1 AND t.excluida_em IS NULL AND t.campanha_id = $2
                AND ${FORA_DE_PACIENTE_DESATIVADO}${soma.sql
                .map((o) => ` AND ${o}`)
                .join('')}`,
            [ctx.clinicaId, id, ...soma.valores],
          )
        ).rows[0]!.s
      }

      return {
        hoje,
        tarefas: r.rows.map((l) => {
          // A jornada (histórico, procedimentos, dose) é de quem tem `jornada`,
          // não de quem tem `campanhas` (B1): a mesma função da ficha e de Hoje.
          const t = aplicarPermissaoDeJornada(paraSaida(l), podeJornada)
          return podePacientes ? t : { ...t, pacienteTelefone: null }
        }),
        total: Number(r.rows[0]?.total ?? 0),
        valorTotal,
      }
    })
  }

  /**
   * O rascunho de **"Repetir no próximo mês"** (`proximoMes` do protótipo).
   *
   * Campanha que ocupa o mês inteiro vira o mês seguinte inteiro; as demais
   * andam um mês, com o dia 29–31 caindo no último dia do mês curto (regra 25,
   * `somarMeses`). Nada é gravado: a cópia nasce sem tarefas, quando a
   * gestora salva o formulário.
   */
  async proximoMes(ctx: Contexto, id: string): Promise<RascunhoDeCampanha> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const camp = (await this.montarCampanhas(c, ctx, hoje)).find((x) => x.id === id)
      if (camp === undefined) throw new NotFoundException('Campanha não encontrada.')
      const mesInteiro = camp.inicio.slice(8) === '01' && somarDias(camp.fim, 1).slice(8) === '01'
      const inicio = somarMeses(camp.inicio, 1)
      return {
        categoria: camp.categoria,
        foco: camp.foco,
        nome: camp.nome,
        objetivo: camp.objetivo,
        inicio,
        fim: mesInteiro ? fimDoMes(inicio.slice(0, 7)) : somarMeses(camp.fim, 1),
        metrica: camp.metrica,
        tipoMetrica: camp.tipoMetrica,
        metaEmDinheiro: camp.metaEmDinheiro,
        metaEmNumero: camp.metaEmNumero,
      }
    })
  }

  /**
   * **As campanhas que CRUZAM uma janela de dias** — o bloco "Campanhas no
   * período" do Painel geral (MANUAL cap. 10).
   *
   * `inicio <= ate AND fim >= de`, que é o `campsPer` dela: cruzar o período é
   * tocá-lo em qualquer ponto, e não estar inteira dentro dele. Com
   * `inicio >= de`, a campanha que começou em setembro e ainda corre
   * desapareceria do painel de outubro — justamente a que está dando
   * resultado agora.
   *
   * **Ordenada pelo INÍCIO, crescente**, como nela: a tabela do painel lê como
   * uma linha do tempo, não como um ranking.
   *
   * O filtro acontece AQUI e não em SQL de propósito: as sete contagens, o
   * percentual da meta, a taxa de conversão e a situação são uma regra só, no
   * `montar` — e um `WHERE` novo na consulta grande seria uma segunda lista de
   * campanhas, com uma segunda chance de divergir da tela de Campanhas. A
   * clínica tem dezenas de campanhas, não dezenas de milhares.
   */
  async noPeriodo(ctx: Contexto, de: string, ate: string): Promise<CampanhaNaLista[]> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    const todas = await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) =>
      this.montar(c, ctx, hoje),
    )
    return todas.campanhas
      .filter((x) => x.inicio <= ate && x.fim >= de)
      .sort((a, b) => a.inicio.localeCompare(b.inicio) || a.nome.localeCompare(b.nome, 'pt-BR'))
  }

  /**
   * `salvarCampanha` — criar (`id === null`) e editar pela mesma porta.
   *
   * **409 no nome repetido, pelo índice `campanha_por_nome`.** O protótipo não
   * confere nada: duas "Outubro Rosa" e o resultado da campanha parte em duas
   * linhas do painel. O `SELECT` não existe aqui — quem recusa é o índice, e
   * é isso que faz duas abas não atravessarem juntas.
   */
  async salvar(
    ctx: Contexto,
    id: string | null,
    dados: SalvarCampanha,
    podeVerValores: boolean,
  ): Promise<Campanhas> {
    // Quem nao ve valor nao DEFINE a meta em reais (regra 17, appsec F10): com
    // `metaEmDinheiro` = 1 o `percentualDaMeta` (que atravessa a redacao) viraria
    // a receita em claro. O mesmo vale ao TIRAR a metrica de 'receita', que
    // sobrescreveria a meta em reais que ela nao pode ver.
    const SEM_VALORES =
      'Definir ou alterar uma campanha em R$ exige a permissão de valores. Peça a quem a tem.'
    if (!podeVerValores && dados.metrica === METRICA_EM_DINHEIRO) {
      throw new ForbiddenException(SEM_VALORES)
    }
    // O ALVO num inteiro só, na escala da MÉTRICA (migration 0020, decisão 2).
    // O contrato já garantiu que o campo preenchido combina com a métrica.
    const meta = dados.metaEmDinheiro !== null ? dados.metaEmDinheiro : BigInt(dados.metaEmNumero!)
    const campos = [
      dados.categoria === '' ? 'Outra' : dados.categoria,
      dados.foco,
      dados.nome,
      dados.objetivo,
      dados.inicio,
      dados.fim,
      dados.metrica,
      dados.tipoMetrica,
      meta.toString(),
    ]

    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      if (!podeVerValores && id !== null) {
        const atual = await c.query<{ metrica: string }>(
          'SELECT metrica FROM campanhas WHERE id = $1 AND excluida_em IS NULL',
          [id],
        )
        if (atual.rows[0]?.metrica === METRICA_EM_DINHEIRO) throw new ForbiddenException(SEM_VALORES)
      }
      try {
        if (id === null) {
          await c.query(
            `INSERT INTO campanhas
               (clinica_id, categoria, foco, nome, objetivo, inicio, fim, metrica,
                tipo_metrica, meta, criada_por)
             VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, $10, $11)`,
            [ctx.clinicaId, ...campos, pessoaDoAtor(ctx.ator)],
          )
          return
        }
        const r = await c.query(
          `UPDATE campanhas
              SET categoria = $2, foco = $3, nome = $4, objetivo = $5,
                  inicio = $6::date, fim = $7::date, metrica = $8,
                  tipo_metrica = $9, meta = $10
            WHERE id = $1 AND excluida_em IS NULL`,
          [id, ...campos],
        )
        if (r.rowCount === 0) throw new NotFoundException('Essa campanha não existe mais.')
      } catch (e: unknown) {
        if (ehNomeRepetido(e)) {
          throw new ConflictException(`Já existe uma campanha chamada "${dados.nome}".`)
        }
        throw e
      }
    })
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => this.montar(c, ctx, hoje))
  }

  /**
   * `excluirCampanha` — **soft delete, e a tarefa continua ligada**.
   *
   * Aqui divergimos do protótipo, que apaga a campanha **e limpa o
   * `campanhaId` de toda tarefa dela** (`db.tasks.forEach(t => { if
   * (t.campanhaId===b.id) t.campanhaId = "" })`). O trabalho feito perde a
   * atribuição para sempre, e o painel do trimestre passado muda sozinho.
   *
   * Com soft delete, a campanha some das escolhas e continua legível no
   * histórico — regra 20, e a mesma decisão da ADR 0003 para paciente.
   */
  async excluir(ctx: Contexto, id: string): Promise<Campanhas> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query(
        `UPDATE campanhas SET excluida_em = now() WHERE id = $1 AND excluida_em IS NULL`,
        [id],
      )
      if (r.rowCount === 0) throw new NotFoundException('Essa campanha não existe mais.')
      return this.montar(c, ctx, hoje)
    })
  }

  /**
   * `importarCampanha` — a lista vira paciente mais tarefa, numa transação.
   *
   * **IDEMPOTENTE POR ESQUEMA** (regra 26), em dois índices:
   *
   *  1. `pacientes_nome_unico` (épico 2) — o paciente que já existe é
   *     reaproveitado, nunca duplicado. A chave de nome sai do **Postgres**
   *     (`normalizar_nome`), nunca de uma cópia em TypeScript: `translate()`
   *     do SQL e `normalize('NFD')` do JavaScript divergem em planilha
   *     exportada de macOS, e aí o mesmo nome tem duas chaves.
   *  2. `tarefa_viva_da_campanha` (0020) — no máximo uma tarefa ABERTA por
   *     (campanha, paciente). É a condição que o protótipo confere com
   *     `some()`, e que duas abas atravessam juntas.
   *
   * **Completa o que está VAZIO** em quem já existe (telefone, aniversário), e
   * nunca sobrescreve — regra 27, e a planilha de origem costuma ser mais
   * velha que o cadastro.
   */
  async importar(
    ctx: Contexto,
    campanhaId: string,
    dados: ImportarCampanha,
  ): Promise<CampanhaImportada> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    /**
     * **O NOME CHEGA LIMPO, venha de onde vier.** A planilha da cliente traz
     * `6. Maria Souza - R$ 15.200` na coluna do paciente; a tela
     * já limpa na prévia, mas o servidor não confia nela (outro cliente da
     * API, planilha colada): índice e valor saem do nome ANTES da chave de
     * idempotência (regra 26) — o mesmo paciente com e sem o "- R$" é UM
     * paciente. O valor lido é gravado em `tarefas.valor_de_referencia` (0080,
     * ADR 2026-11-13 "valor da lista"): referência, nunca receita, redigida sem
     * `valores`. Pô-lo em `obs`/`descricao` o entregaria à equipe (regra 17).
     */
    // Acima disto o `bigint` do Postgres estouraria: valor assim é lixo de
    // planilha (um CPF na coluna errada), não dinheiro — fica sem valor.
    const TETO = 10n ** 15n
    const valores = dados.linhas.map((l) => {
      const v = l.valorDeReferencia ?? limparNomeDeLista(l.nome).valorEmCentavos
      return v !== null && v >= 0n && v <= TETO ? v : null
    })
    dados = { ...dados, linhas: dados.linhas.map((l) => ({ ...l, nome: limparNomeDeLista(l.nome).nome })) }

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const campanha = (
        await c.query<{ nome: string }>(
          `SELECT nome FROM campanhas WHERE id = $1 AND excluida_em IS NULL`,
          [campanhaId],
        )
      ).rows[0]
      if (campanha === undefined) throw new NotFoundException('Campanha não encontrada.')

      /**
       * Os responsáveis VÁLIDOS, numa consulta só.
       *
       * Pessoa ATIVA da clínica, como ela (`db.team.some(u=>u.id===l.responsavelId
       * && u.ativo)`). A RLS já recusaria a de outra clínica; a conferência de
       * `ativo` é a que importa — importar 300 tarefas para quem saiu da
       * clínica é criar 300 pendências que ninguém vê.
       */
      const ativos = new Set(
        (
          await c.query<{ id: string }>(`SELECT id::text AS id FROM pessoas WHERE ativo`)
        ).rows.map((p) => p.id),
      )

      // A chave de nome de cada linha, calculada PELO POSTGRES — a mesma
      // função do índice. Ver a nota em `pacientes/importacao.service.ts`.
      const chaves = (
        await c.query<{ chave: string }>(
          `SELECT normalizar_nome(n) AS chave
             FROM unnest($1::text[]) WITH ORDINALITY AS t(n, i)
            ORDER BY i`,
          [dados.linhas.map((l) => l.nome)],
        )
      ).rows.map((r) => r.chave)

      type Limpa = {
        chave: string
        nome: string
        telefone: string
        aniversario: string | null
        prazo: string
        responsavelId: string
        obs: string
        valorDeReferencia: bigint | null
      }
      const limpas: Limpa[] = []
      const vistas = new Set<string>()
      let ignoradas = 0
      for (const [i, l] of dados.linhas.entries()) {
        const chave = chaves[i] ?? ''
        // Linha sem nome, com responsável inválido, ou REPETIDA no próprio
        // arquivo: ignorada, e a importação continua. Perder o lote inteiro
        // por causa de uma célula em branco é o jeito caro de descobrir que a
        // planilha tinha uma célula em branco.
        if (chave === '' || !ativos.has(l.responsavelId) || vistas.has(chave)) {
          ignoradas++
          continue
        }
        vistas.add(chave)
        limpas.push({
          chave,
          nome: l.nome.replace(/\s+/g, ' ').slice(0, 120),
          telefone: l.telefone,
          // Aniversário inválido ou FUTURO é descartado, e a linha entra
          // assim mesmo — é o `dOk` do legado.
          aniversario: /^\d{4}-\d{2}-\d{2}$/.test(l.aniversario) && l.aniversario <= hoje
            ? l.aniversario
            : null,
          prazo: l.prazo,
          responsavelId: l.responsavelId,
          obs: l.obs,
          valorDeReferencia: valores[i] ?? null,
        })
      }
      if (limpas.length === 0) {
        return { criadas: 0, novosPacientes: 0, pacientesCompletados: 0, ignoradas }
      }

      /**
       * UM `INSERT … ON CONFLICT` para o lote inteiro, e ele faz as três
       * coisas de uma vez: cria quem não existe, completa o VAZIO de quem
       * existe, e devolve o id de todos — inclusive o de quem não mudou.
       *
       * `WHERE` no `DO UPDATE` é o que distingue "completei" de "nada a
       * completar": sem ele, a terceira reimportação diria que mexeu em 300
       * pacientes. É o mesmo mecanismo da importação do estoque.
       */
      const nomes = limpas.map((l) => l.nome)
      const telefones = limpas.map((l) => l.telefone)
      const aniversarios = limpas.map((l) => l.aniversario)
      const upsert = await c.query<{ id: string; chave: string; origem: string }>(
        `WITH entrada AS (
           SELECT * FROM unnest($2::text[], $3::text[], $4::date[])
                      AS e(nome, telefone, aniversario)
         ), gravados AS (
           INSERT INTO pacientes (clinica_id, nome, telefone, aniversario, campanha_id, criado_por)
           SELECT $1, e.nome, coalesce(e.telefone, ''), e.aniversario, $5, $6 FROM entrada e
           ON CONFLICT (clinica_id, nome_chave) WHERE ativo DO UPDATE
             SET telefone    = CASE WHEN pacientes.telefone = ''
                                    THEN EXCLUDED.telefone ELSE pacientes.telefone END,
                 aniversario = coalesce(pacientes.aniversario, EXCLUDED.aniversario),
                 -- A campanha de ORIGEM nunca é reescrita: quem já chegou por
                 -- outra campanha chegou por ela, e sobrescrever apagaria a
                 -- resposta de "quem essa campanha trouxe".
                 campanha_id = coalesce(pacientes.campanha_id, EXCLUDED.campanha_id)
             WHERE (pacientes.telefone = '' AND EXCLUDED.telefone <> '')
                OR (pacientes.aniversario IS NULL AND EXCLUDED.aniversario IS NOT NULL)
                OR pacientes.campanha_id IS NULL
           -- TRES estados, e nao dois: xmax = 0 e linha NOVA; xmax <> 0 e
           -- veio do CTE e linha COMPLETADA; quem nao veio do CTE ja existia
           -- sem nada a completar. Com um booleano, a segunda importacao
           -- contava os dois ultimos juntos e dizia "2 pacientes novos" sobre
           -- dois que ja estavam la -- medido.
           RETURNING id, nome_chave AS chave,
                     CASE WHEN xmax = 0 THEN 'inserido' ELSE 'completado' END AS origem
         )
         SELECT id::text AS id, chave, origem FROM gravados
         UNION ALL
         -- Quem ja existia e nao tinha NADA a completar nao volta do CTE: o
         -- WHERE do DO UPDATE o descartou. Sem esta metade, a terceira
         -- importacao nao acharia o paciente e nao criaria tarefa nenhuma.
         SELECT p.id::text, p.nome_chave, 'existente'
           FROM pacientes p
          WHERE p.clinica_id = $1 AND p.ativo
            AND p.nome_chave = ANY($7::text[])
            AND p.id NOT IN (SELECT id FROM gravados)`,
        [
          ctx.clinicaId,
          nomes,
          telefones,
          aniversarios,
          campanhaId,
          // `pacientes.criado_por` e anulavel; na sessao de suporte nao
          // houve pessoa da clinica criando (D-13).
          pessoaDoAtor(ctx.ator),
          limpas.map((l) => l.chave),
        ],
      )
      const idPorChave = new Map(upsert.rows.map((r) => [r.chave, r.id]))
      const novosPacientes = upsert.rows.filter((r) => r.origem === 'inserido').length
      const pacientesCompletados = upsert.rows.filter((r) => r.origem === 'completado').length

      const descricao =
        dados.descricao === '' ? `Contato da campanha: ${campanha.nome}` : dados.descricao

      let criadas = 0
      for (const l of limpas) {
        const pacienteId = idPorChave.get(l.chave)
        // Paciente inativo com o mesmo nome: o `ON CONFLICT` é parcial em
        // `ativo`, e a regra 27 manda não ressuscitar quem a clínica
        // desativou. A linha é ignorada, não recriada.
        if (pacienteId === undefined) {
          ignoradas++
          continue
        }
        const r = await c.query(
          `INSERT INTO tarefas
             (clinica_id, solicitante_id, responsavel_id, descricao, prazo, prioridade,
              status, historico, resultado, obs, recorrencia, paciente_id, tipo, campanha_id,
              valor_de_referencia)
           VALUES ($1, $2, $3, $4, $5::date, 'normal', 'aberta', '[]', '', $6, '', $7, $8, $9, $10::bigint)
           ON CONFLICT (clinica_id, campanha_id, paciente_id, tipo)
             WHERE campanha_id IS NOT NULL AND paciente_id IS NOT NULL
               AND status = 'aberta' AND excluida_em IS NULL AND serie_id IS NULL
             DO NOTHING`,
          [
            ctx.clinicaId,
            // `tarefas.solicitante_id` e NOT NULL e guarda uma PESSOA: a
            // sessao de suporte e recusada (D-13).
            exigePessoa(ctx.ator),
            l.responsavelId,
            descricao,
            l.prazo,
            l.obs,
            pacienteId,
            dados.tipo,
            campanhaId,
            // Texto, nunca `number`: bigint em centavos (regra 1).
            l.valorDeReferencia === null ? null : l.valorDeReferencia.toString(),
          ],
        )
        if (r.rowCount === 0) ignoradas++
        else criadas++
      }

      return { criadas, novosPacientes, pacientesCompletados, ignoradas }
    })
  }

  // -----------------------------------------------------------------------
  // MONTAGEM
  // -----------------------------------------------------------------------

  /**
   * **UMA CONSULTA PARA TODAS AS CAMPANHAS**, e não uma por campanha.
   *
   * A tela abre a lista inteira; `N` campanhas × 7 contagens seria `7N` idas
   * ao banco numa tela que a gestora abre para olhar o mês.
   *
   * O `LEFT JOIN` em `recebimentos` carrega `DINHEIRO_QUE_ENTROU` — a
   * constante da D-9 —, e é ele que faz a receita da campanha somar o que
   * ENTROU e nunca a venda a prazo. O `JOIN` não duplica linha:
   * `recebimento_por_tarefa` garante no máximo um recebimento vivo por tarefa.
   */
  private async montar(
    c: pg.PoolClient,
    ctx: Contexto,
    hoje: string,
    consulta: ConsultaDeCampanhas = {},
  ): Promise<Campanhas> {
    const todas = await this.montarCampanhas(c, ctx, hoje)
    const mes =
      consulta.mes === undefined ? null : consulta.mes === 'atual' ? hoje.slice(0, 7) : consulta.mes
    // O mês filtra pelo que a campanha CRUZA (`campsDoMes`), e só com `mes`
    // muda a ordem: a lista do mês põe "em andamento" na frente, e a lista
    // inteira (painel, formulário) segue do início mais recente.
    let campanhas = todas
    if (mes !== null) {
      const de = `${mes}-01`
      const ate = fimDoMes(mes)
      campanhas = campanhas
        .filter((x) => x.inicio <= ate && x.fim >= de)
        .sort(
          (a, b) =>
            Number(a.situacao !== 'andamento') - Number(b.situacao !== 'andamento') ||
            a.inicio.localeCompare(b.inicio) ||
            a.nome.localeCompare(b.nome, 'pt-BR'),
        )
    }
    if (consulta.tipo !== undefined && consulta.tipo !== '') {
      campanhas = campanhas.filter((x) => x.categoria === consulta.tipo)
    }
    return {
      hoje,
      mes,
      campanhas,
      categorias: [...new Set(todas.map((x) => x.categoria))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
      totais: {
        campanhas: campanhas.length,
        // Σ da receita das campanhas mostradas (`tot` de `vCampanhas`), em
        // centavos inteiros — nunca `number`.
        valorConvertido: campanhas.reduce((a, x) => a + BigInt(x.receita ?? '0'), 0n).toString(),
        pacientesConvertidos: campanhas.reduce((a, x) => a + x.pacientesConvertidos, 0),
        acoesRealizadas: campanhas.reduce((a, x) => a + x.tarefasConcluidas, 0),
      },
    }
  }

  private async montarCampanhas(
    c: pg.PoolClient,
    ctx: Contexto,
    hoje: string,
  ): Promise<CampanhaNaLista[]> {
    const linhas = (
      await c.query<LinhaDeCampanha>(
        `WITH feitas AS (
           SELECT t.campanha_id,
                  t.id,
                  t.paciente_id,
                  t.status,
                  t.tipo,
                  -- A RECEITA desta tarefa: o predicado ÚNICO de
                  -- \`receita-da-campanha.ts\` (N-2), o mesmo da conferência
                  -- da migração e da sincronização da carteira.
                  CASE WHEN ${RECEITA_DA_CAMPANHA} THEN r.valor END AS receita
             FROM tarefas t
             LEFT JOIN recebimentos r
                    ON r.tarefa_id = t.id
                   AND r.estornado_em IS NULL
                   AND ${DINHEIRO_QUE_ENTROU}
            WHERE t.clinica_id = $1
              AND t.campanha_id IS NOT NULL
              AND t.excluida_em IS NULL
              AND t.status <> 'cancelada'
              -- Tarefa ABERTA de paciente desativado não conta como pendente;
              -- concluída continua contando para o resultado.
              AND ${FORA_DE_PACIENTE_DESATIVADO}
         )
         SELECT cp.id::text AS id, cp.categoria, cp.foco, cp.nome, cp.objetivo,
                cp.inicio::text AS inicio, cp.fim::text AS fim,
                cp.metrica, cp.tipo_metrica, cp.meta::text AS meta,
                count(f.id)::text AS tarefas,
                count(f.id) FILTER (WHERE f.status = 'concluida')::text AS feitas,
                count(f.id) FILTER (WHERE f.status = 'aberta')::text AS abertas,
                count(f.id) FILTER (
                  WHERE f.status = 'concluida' AND f.paciente_id IS NOT NULL
                    AND f.tipo = ANY($2)
                )::text AS contatos,
                count(f.id) FILTER (
                  WHERE f.status = 'concluida' AND f.tipo = cp.tipo_metrica
                )::text AS por_tipo,
                -- PACIENTES DISTINTOS, nunca tarefas: a paciente que fez
                -- consulta e procedimento na mesma campanha é UMA conversão.
                count(DISTINCT f.paciente_id) FILTER (
                  WHERE f.status = 'concluida' AND f.paciente_id IS NOT NULL
                )::text AS pac_alcancados,
                count(DISTINCT f.paciente_id) FILTER (
                  WHERE f.status = 'concluida' AND f.paciente_id IS NOT NULL
                    AND f.tipo = ANY($3)
                )::text AS pac_convertidos,
                coalesce(sum(f.receita), 0)::text AS receita
           FROM campanhas cp
           LEFT JOIN feitas f ON f.campanha_id = cp.id
          WHERE cp.clinica_id = $1 AND cp.excluida_em IS NULL
          GROUP BY cp.id
          ORDER BY cp.inicio DESC, cp.nome`,
        [
          ctx.clinicaId,
          [...TIPOS_DE_CONTATO],
          [...TIPOS_QUE_ATENDEM],
        ],
      )
    ).rows

    return linhas.map((l) => montarCampanha(l, hoje, ctx.fuso, ctx.valores === true))
  }
}

/** `norm()` dela: minúsculas e sem acento, para comparar o foco. */
const semAcento = (t: string): string =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()

// ---------------------------------------------------------------------------
// APOIO — nenhuma destas funções lê banco
// ---------------------------------------------------------------------------

function montarCampanha(
  l: LinhaDeCampanha,
  hoje: string,
  fuso: string,
  podeVerValores: boolean,
): CampanhaNaLista {
  const meta = BigInt(l.meta)
  const receita = BigInt(l.receita)
  const pacAlcancados = Number(l.pac_alcancados)
  const pacConvertidos = Number(l.pac_convertidos)

  /**
   * O RESULTADO, por métrica — portado de `statsCamp`.
   *
   * `convertidos` é `pacConv.size` (pacientes distintos), `contatos` é
   * `contatos.length`, `tipo` é a contagem do tipo escolhido, e `receita` é a
   * soma em centavos.
   */
  const resultado: bigint =
    l.metrica === 'convertidos'
      ? BigInt(pacConvertidos)
      : l.metrica === 'contatos'
        ? BigInt(l.contatos)
        : l.metrica === 'tipo'
          ? BigInt(l.por_tipo)
          : receita

  const ehDinheiro = l.metrica === METRICA_EM_DINHEIRO
  const situacao = situacaoDaCampanha(l.inicio, l.fim, hoje, fuso)

  return {
    id: l.id,
    categoria: l.categoria,
    foco: l.foco,
    nome: l.nome,
    objetivo: l.objetivo,
    inicio: l.inicio,
    fim: l.fim,
    metrica: l.metrica,
    tipoMetrica: l.tipo_metrica,
    // O `rotuloMeta` dela: o tipo escolhido, ou o nome da métrica.
    rotuloDaMeta:
      l.metrica === 'tipo'
        ? l.tipo_metrica
        : (METRICAS_DE_CAMPANHA.find((m) => m.chave === l.metrica)?.nome ?? 'Resultado'),

    metaEmDinheiro: ehDinheiro ? meta.toString() : null,
    metaEmNumero: ehDinheiro ? null : Number(meta),
    resultadoEmDinheiro: ehDinheiro ? resultado.toString() : null,
    resultadoEmNumero: ehDinheiro ? null : Number(resultado),
    // **Pode passar de 100**, e é deliberado: a campanha que superou a meta
    // mostra "128%" no texto, e a barra é que fica cheia.
    //
    // **Campanha de RECEITA sem `valores`: `null`** (decisão do dono, segue o
    // protótipo — "Resultado visível para o administrativo", sem percentual e
    // sem barra). Com a meta conhecida o percentual devolve a receita em claro.
    // Mora AQUI, no ponto único de montagem, e não num `if` por endpoint.
    percentualDaMeta: ehDinheiro && !podeVerValores ? null : percentualInteiro(resultado, meta),

    receita: receita.toString(),

    situacao,
    rotuloDaSituacao: rotuloDaSituacao(situacao, l.inicio, l.fim, hoje),

    tarefas: Number(l.tarefas),
    tarefasConcluidas: Number(l.feitas),
    tarefasAbertas: Number(l.abertas),
    contatos: Number(l.contatos),
    pacientesAlcancados: pacAlcancados,
    pacientesConvertidos: pacConvertidos,
    // `null` sem base, nunca `0%`: `0%` acusa uma campanha que não converteu
    // ninguém, e `—` diz que ninguém foi alcançado ainda. É a mesma distinção
    // de `percentualNoPrazo`.
    taxaDeConversao:
      pacAlcancados === 0
        ? null
        : percentualInteiro(BigInt(pacConvertidos), BigInt(pacAlcancados)),
  }
}

/**
 * A situação, decidida pelo dia do SERVIDOR no fuso da clínica (regra 24).
 *
 * O protótipo usa `today()` do navegador: o celular adiantado da recepção
 * encerra a campanha um dia antes, e o atrasado a deixa "em andamento" depois
 * do fim.
 */
function situacaoDaCampanha(
  inicio: string,
  fim: string,
  hoje: string,
  fuso: string,
): SituacaoDaCampanha {
  // "Em andamento" é a regra do domínio (`emAndamento`), a mesma da lista de
  // campanhas vinculáveis — não uma segunda escrita dela. O instante é o
  // INÍCIO de `hoje` na clínica, e não uma segunda leitura do relógio: `hoje`
  // já é o dia de negócio desta resposta, e ler o relógio de novo poderia
  // cair no dia seguinte à meia-noite, com o rótulo de um dia e a situação de
  // outro.
  if (emAndamento({ inicio, fim }, inicioDoDia(hoje, fuso), fuso)) return 'andamento'
  return hoje < inicio ? 'futura' : 'encerrada'
}

function rotuloDaSituacao(
  situacao: SituacaoDaCampanha,
  inicio: string,
  fim: string,
  hoje: string,
): string {
  if (situacao === 'futura') return `Começa em ${emDiaEMes(inicio)}`
  if (situacao === 'encerrada') return 'Encerrada'
  const restam = diasEntre(hoje, fim)
  return restam === 0
    ? 'Último dia'
    : `Em andamento · ${restam} ${restam === 1 ? 'dia restante' : 'dias restantes'}`
}

const emDiaEMes = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`

/**
 * O 23505 do índice `campanha_por_nome`, e SÓ dele.
 *
 * Casar "qualquer violação de unicidade" transformaria um defeito de esquema
 * num "já existe uma campanha com esse nome" que não é verdade.
 */
function ehNomeRepetido(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: string }).code === '23505' &&
    (e as { constraint?: string }).constraint === 'campanha_por_nome'
  )
}
