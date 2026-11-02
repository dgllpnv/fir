import type {
  CampanhaImportada,
  CampanhaNaLista,
  Campanhas,
  ImportarCampanha,
  MetricaDeCampanha,
  SalvarCampanha,
  SituacaoDaCampanha,
} from '@fir/contracts'
import { METRICAS_DE_CAMPANHA, METRICA_EM_DINHEIRO } from '@fir/contracts'
import {
  TIPOS_DE_CONTATO,
  TIPOS_DE_RECEITA,
  TIPOS_PAGAVEIS,
  TIPOS_QUE_ATENDEM,
  diasEntre,
  percentualInteiro,
} from '@fir/domain'
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { diaDaClinica } from '../estoque/dia-da-clinica'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'

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
  readonly ator: PessoaId
  readonly fuso: string
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

  async listar(ctx: Contexto): Promise<Campanhas> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => this.montar(c, ctx, hoje))
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
  async salvar(ctx: Contexto, id: string | null, dados: SalvarCampanha): Promise<Campanhas> {
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
      try {
        if (id === null) {
          await c.query(
            `INSERT INTO campanhas
               (clinica_id, categoria, foco, nome, objetivo, inicio, fim, metrica,
                tipo_metrica, meta, criada_por)
             VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, $10, $11)`,
            [ctx.clinicaId, ...campos, ctx.ator],
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
          ctx.ator,
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
              status, historico, resultado, obs, recorrencia, paciente_id, tipo, campanha_id)
           VALUES ($1, $2, $3, $4, $5::date, 'normal', 'aberta', '[]', '', $6, '', $7, $8, $9)
           ON CONFLICT (clinica_id, campanha_id, paciente_id)
             WHERE campanha_id IS NOT NULL AND paciente_id IS NOT NULL
               AND status = 'aberta' AND excluida_em IS NULL
             DO NOTHING`,
          [
            ctx.clinicaId,
            ctx.ator,
            l.responsavelId,
            descricao,
            l.prazo,
            l.obs,
            pacienteId,
            dados.tipo,
            campanhaId,
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
  ): Promise<Campanhas> {
    const linhas = (
      await c.query<LinhaDeCampanha>(
        `WITH feitas AS (
           SELECT t.campanha_id,
                  t.id,
                  t.paciente_id,
                  t.status,
                  t.tipo,
                  r.valor AS valor
             FROM tarefas t
             LEFT JOIN recebimentos r
                    ON r.tarefa_id = t.id
                   AND r.estornado_em IS NULL
                   AND ${DINHEIRO_QUE_ENTROU}
            WHERE t.clinica_id = $1
              AND t.campanha_id IS NOT NULL
              AND t.excluida_em IS NULL
              AND t.status <> 'cancelada'
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
                coalesce(sum(f.valor) FILTER (
                  WHERE f.status = 'concluida' AND f.paciente_id IS NOT NULL
                    AND (f.tipo = ANY($4) OR (f.tipo = ANY($5) AND f.valor > 0))
                ), 0)::text AS receita
           FROM campanhas cp
           LEFT JOIN feitas f ON f.campanha_id = cp.id
          WHERE cp.clinica_id = $1 AND cp.excluida_em IS NULL
          GROUP BY cp.id
          ORDER BY cp.inicio DESC, cp.nome`,
        [
          ctx.clinicaId,
          [...TIPOS_DE_CONTATO],
          [...TIPOS_QUE_ATENDEM],
          [...TIPOS_DE_RECEITA],
          [...TIPOS_PAGAVEIS],
        ],
      )
    ).rows

    const campanhas = linhas.map((l) => montarCampanha(l, hoje))
    return {
      hoje,
      campanhas,
      categorias: [...new Set(campanhas.map((x) => x.categoria))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      ),
    }
  }
}

// ---------------------------------------------------------------------------
// APOIO — nenhuma destas funções lê banco
// ---------------------------------------------------------------------------

function montarCampanha(l: LinhaDeCampanha, hoje: string): CampanhaNaLista {
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
  const situacao = situacaoDaCampanha(l.inicio, l.fim, hoje)

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
    percentualDaMeta: percentualInteiro(resultado, meta),

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
function situacaoDaCampanha(inicio: string, fim: string, hoje: string): SituacaoDaCampanha {
  if (hoje < inicio) return 'futura'
  if (hoje > fim) return 'encerrada'
  return 'andamento'
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
