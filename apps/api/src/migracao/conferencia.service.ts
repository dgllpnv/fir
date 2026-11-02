import {
  type Achado,
  compararDinheiro,
  compararMapas,
  compararNumeros,
  conferirOrigem,
  type DadosDaV20,
  Dinheiro,
  type LinhaDeConferencia,
  type NomeDeAba,
} from '@fir/domain'
import type pg from 'pg'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'
import { saldosDe } from '../financeiro/saldo.repositorio'
import type { RelatorioDaMigracao } from './relatorio'

/**
 * **O RELATÓRIO DE CONFERÊNCIA — a regra 28, em forma de função.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * "MIGRAÇÃO SEM CONFERÊNCIA NÃO É MIGRAÇÃO, É CÓPIA"
 *
 * Seis conferências, por clínica, e elas batem **exatamente** — não
 * "aproximadamente", não "dentro da tolerância". Não existe comparação com
 * margem em nenhuma linha deste arquivo, e é deliberado: a primeira tolerância
 * que entra é a que esconde o paciente que faltou.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * OS DOIS LADOS SÃO CALCULADOS POR CAMINHOS DIFERENTES, E ISSO É O DESENHO
 *
 * **Origem:** `conferirOrigem` de `@fir/domain`, puro, a partir das LINHAS da
 * planilha, com as regras de `tipos-de-tarefa.ts` e `financeiro/saldo.ts`.
 *
 * **Destino:** as consultas **DE PRODUÇÃO** — `DINHEIRO_QUE_ENTROU` (a mesma
 * do caixa, do LTV e da Visão do mês) e `saldosDe` (a única leitura de saldo
 * do sistema). Nunca uma consulta escrita para a conferência.
 *
 * As duas coisas juntas são o que dá sentido a "bate": se o destino fosse lido
 * por um `SELECT` próprio, a conferência compararia o migrador com ele mesmo —
 * e um erro de conversão apareceria **idêntico** nos dois lados. E se o
 * destino fosse lido por uma consulta que não é a de produção, a conferência
 * passaria enquanto a TELA da clínica mostrasse outro número.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A CHAVE DE COMPARAÇÃO É O `id` DA v20 — NUNCA O NOME
 *
 * Comparar por nome faria a conferência fundir duas pacientes homônimas e
 * passar; e poria nome de paciente real no relatório, que é PII (regra 21). A
 * ponte é `origens_da_v20`, que é a mesma que a idempotência usa.
 */

/** A tabela de destino de cada aba, e o nome que o relatório imprime. */
const DESTINO: Readonly<Record<NomeDeAba, { tabela: string; rotulo: string }>> = {
  Equipe: { tabela: 'pessoas', rotulo: 'Equipe → pessoas' },
  Pacientes: { tabela: 'pacientes', rotulo: 'Pacientes → pacientes' },
  Unidades: { tabela: 'unidades', rotulo: 'Unidades → unidades' },
  Campanhas: { tabela: 'campanhas', rotulo: 'Campanhas → campanhas' },
  Planos: { tabela: 'procedimentos', rotulo: 'Planos → procedimentos' },
  Adesoes: { tabela: 'programas', rotulo: 'Adesoes → programas' },
  Tarefas: { tabela: 'tarefas', rotulo: 'Tarefas → tarefas' },
}

const ABAS = Object.keys(DESTINO) as NomeDeAba[]

const dinheiro = (texto: string): Dinheiro => Dinheiro.deCentavos(BigInt(texto))

export async function conferirMigracao(
  c: pg.PoolClient,
  clinicaId: string,
  dados: DadosDaV20,
  _fuso: string,
  observacoesDaEscrita: readonly Achado[],
): Promise<RelatorioDaMigracao> {
  const origem = conferirOrigem(dados)
  const linhas: LinhaDeConferencia[] = []
  const observacoes: Achado[] = [...dados.achados, ...observacoesDaEscrita]

  // ── 1. QUANTIDADE DE REGISTROS POR ENTIDADE ───────────────────────────
  //
  // "Linhas não vazias da aba" × "linhas da tabela". A segunda metade é
  // contada **pelo JOIN com `origens_da_v20`**, e não por um `count(*)` na
  // tabela: a tabela tem linhas que não vêm da planilha — a administradora que
  // o superadmin criou junto com a clínica, e os cinco procedimentos que a
  // trigger da 0010 semeia. Um `count(*)` acusaria divergência onde não há, e
  // a tentação seguinte seria subtrair um número à mão.
  //
  // O que NÃO se perde com isso: a linha do destino SEM origem é contada e
  // relatada à parte, abaixo. É ela que pegaria uma segunda execução
  // duplicando dado.
  for (const aba of ABAS) {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM origens_da_v20 o
         JOIN ${DESTINO[aba].tabela} d ON d.id = o.id_interno AND d.clinica_id = o.clinica_id
        WHERE o.clinica_id = $1 AND o.entidade = $2`,
      [clinicaId, aba],
    )
    linhas.push(
      compararNumeros(DESTINO[aba].rotulo, origem.contagens[aba], Number(r.rows[0]!.n)),
    )
  }

  // ── 2. RECEITA TOTAL ──────────────────────────────────────────────────
  //
  // `DINHEIRO_QUE_ENTROU`, a MESMA constante do caixa, do LTV e da Visão do
  // mês. A venda a prazo (`valor = 0`) fica fora dos dois lados: na origem
  // porque `ehReceita` a ignora, no destino porque o filtro a exclui.
  const receita = await c.query<{ v: string }>(
    `SELECT coalesce(sum(r.valor), 0)::text AS v
       FROM recebimentos r
      WHERE r.clinica_id = $1 AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}`,
    [clinicaId],
  )
  linhas.push(
    compararDinheiro('Receita total', origem.receitaTotal, dinheiro(receita.rows[0]!.v)),
  )

  // ── 3. LTV POR PACIENTE ───────────────────────────────────────────────
  //
  // **É esta conferência que a regra 28 usa para reprovar a clínica inteira
  // por UM paciente.** A receita total pode estar certa com um `pacienteId`
  // trocado entre duas pessoas; o LTV paciente a paciente não.
  //
  // `LEFT JOIN` e não `JOIN`: o paciente sem recebimento nenhum tem de voltar
  // com zero. Com o `JOIN` ele desapareceria do mapa do destino, e
  // `compararMapas` — que compara nos dois sentidos — acusaria divergência
  // onde não há, ou pior, esconderia a chave que de fato faltou.
  const ltv = await c.query<{ chave: string; v: string }>(
    `SELECT o.id_externo AS chave,
            coalesce(sum(r.valor), 0)::text AS v
       FROM origens_da_v20 o
       JOIN pacientes p ON p.id = o.id_interno AND p.clinica_id = o.clinica_id
       LEFT JOIN recebimentos r
              ON r.paciente_id = p.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
      WHERE o.clinica_id = $1 AND o.entidade = 'Pacientes'
      GROUP BY o.id_externo`,
    [clinicaId],
  )
  linhas.push(
    compararMapas(
      'LTV por paciente',
      origem.ltvPorPaciente,
      new Map(ltv.rows.map((x) => [x.chave, dinheiro(x.v)])),
    ),
  )

  // **A INVARIANTE DE GRAÇA, E ELA NÃO É DECORAÇÃO.** `Σ LTV = receita total`
  // vale nos dois lados por definição, então ela só quebra quando um
  // recebimento perdeu o paciente — e aí a receita total continua certa.
  const somaLtv = [...origem.ltvPorPaciente.values()].reduce(
    (a, x) => a.mais(x),
    Dinheiro.zero(),
  )
  linhas.push(compararDinheiro('Σ LTV = receita total (origem)', origem.receitaTotal, somaLtv))
  const somaLtvDestino = ltv.rows.reduce((a, x) => a.mais(dinheiro(x.v)), Dinheiro.zero())
  linhas.push(
    compararDinheiro(
      'Σ LTV = receita total (destino)',
      dinheiro(receita.rows[0]!.v),
      somaLtvDestino,
    ),
  )

  // ── 4 e 5. SALDO POR PACIENTE E POR ADESÃO ────────────────────────────
  //
  // `saldosDe` é a ÚNICA leitura de saldo do sistema, e ela chama
  // `saldoEmAberto` do domínio — a mesma função que o lado da origem usa. O
  // que a conferência compara, então, são os EVENTOS: um `valor_aberto` que
  // foi para o programa errado muda o grupo, e o grupo errado aparece na
  // conferência 5 mesmo quando a 4 fecha.
  //
  // O clamp e o crédito ficam idênticos nos dois lados por construção, e é
  // por isso que o CRÉDITO também é conferido: ele é o excedente que a v20
  // descarta com `Math.max(0, …)`. Um crédito que aparece no destino e não na
  // origem é um `valor_aberto` que o migrador perdeu.
  const pacientes = await c.query<{ chave: string; id: string }>(
    `SELECT o.id_externo AS chave, p.id
       FROM origens_da_v20 o
       JOIN pacientes p ON p.id = o.id_interno AND p.clinica_id = o.clinica_id
      WHERE o.clinica_id = $1 AND o.entidade = 'Pacientes'`,
    [clinicaId],
  )
  const programas = await c.query<{ chave: string; id: string }>(
    `SELECT o.id_externo AS chave, g.id
       FROM origens_da_v20 o
       JOIN programas g ON g.id = o.id_interno AND g.clinica_id = o.clinica_id
      WHERE o.clinica_id = $1 AND o.entidade = 'Adesoes'`,
    [clinicaId],
  )
  const chaveDoPrograma = new Map(programas.rows.map((x) => [x.id, x.chave]))

  const saldos = await saldosDe(c, clinicaId, pacientes.rows.map((x) => x.id))
  const saldoPorPaciente = new Map<string, Dinheiro>()
  const creditoPorPaciente = new Map<string, Dinheiro>()
  const saldoPorAdesao = new Map<string, Dinheiro>()
  for (const { chave, id } of pacientes.rows) {
    const s = saldos.get(id)
    if (s === undefined) continue
    saldoPorPaciente.set(chave, s.saldo)
    creditoPorPaciente.set(chave, s.credito)
    for (const g of s.grupos) {
      if (g.programaId === null) continue
      const k = chaveDoPrograma.get(g.programaId)
      if (k !== undefined) saldoPorAdesao.set(k, g.saldo)
    }
  }
  // Programa sem evento nenhum tem saldo zero, e tem de aparecer nos dois
  // lados — a origem já o acrescenta.
  for (const { chave } of programas.rows) {
    if (!saldoPorAdesao.has(chave)) saldoPorAdesao.set(chave, Dinheiro.zero())
  }

  linhas.push(
    compararMapas('Saldo em aberto por paciente', origem.saldoPorPaciente, saldoPorPaciente),
  )
  linhas.push(
    compararMapas('Crédito por paciente (excedente)', origem.creditoPorPaciente, creditoPorPaciente),
  )
  linhas.push(compararMapas('Saldo em aberto por adesão', origem.saldoPorAdesao, saldoPorAdesao))

  // ── 6. RECEITA POR CAMPANHA ───────────────────────────────────────────
  //
  // A tarefa carrega a campanha, e o recebimento pende da tarefa — então o
  // caminho é `campanhas → tarefas → recebimentos`, e não um `campanha_id` em
  // `recebimentos` (que seria o segundo lugar para a mesma pergunta).
  const campanhas = await c.query<{ chave: string; v: string }>(
    `SELECT o.id_externo AS chave, coalesce(sum(r.valor), 0)::text AS v
       FROM origens_da_v20 o
       JOIN campanhas cp ON cp.id = o.id_interno AND cp.clinica_id = o.clinica_id
       LEFT JOIN tarefas t
              ON t.campanha_id = cp.id AND t.clinica_id = cp.clinica_id
             AND t.excluida_em IS NULL AND t.status = 'concluida'
       LEFT JOIN recebimentos r
              ON r.tarefa_id = t.id AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
      WHERE o.clinica_id = $1 AND o.entidade = 'Campanhas'
      GROUP BY o.id_externo`,
    [clinicaId],
  )
  linhas.push(
    compararMapas(
      'Receita por campanha',
      origem.receitaPorCampanha,
      new Map(campanhas.rows.map((x) => [x.chave, dinheiro(x.v)])),
    ),
  )

  // ── OS CAMPOS DERIVADOS DA ADESÃO, COMO CONFERÊNCIA ───────────────────
  //
  // `sessoes`, `plano`, `intervaloDias` e `rotuloSessao` existem na aba
  // `Adesoes` e **não** existem no nosso modelo (P-2). O item os recebe como
  // dado primário; aqui eles são conferidos de volta.
  //
  // **A DIFERENÇA DE `sessoes` NÃO REPROVA, E ISSO FOI MEDIDO NO `Code.gs`.**
  // `statsAdesao` mostra `validas.length || Number(a.sessoes)` — a tela
  // PREFERE a contagem de sessões reais e só cai no campo gravado quando não
  // há nenhuma. Nas planilhas reais há adesão com `sessoes = 12` e 10 sessões
  // na aba `Tarefas`: a clínica cancelou ou apagou sessões à mão. Reprovar
  // isso seria exigir da planilha uma coerência que a v20 nunca cobrou.
  const itens = await c.query<{
    chave: string
    sessoes: number
    intervalo_dias: number
    rotulo_sessao: string
    procedimento_nome: string
    materializadas: string
  }>(
    `SELECT o.id_externo AS chave, i.sessoes, i.intervalo_dias, i.rotulo_sessao,
            i.procedimento_nome,
            (SELECT count(*)::text FROM tarefas t
              WHERE t.programa_id = i.programa_id AND t.item_chave = i.chave
                AND t.excluida_em IS NULL AND t.status <> 'cancelada') AS materializadas
       FROM origens_da_v20 o
       JOIN itens_do_programa i ON i.id = o.id_interno AND i.clinica_id = o.clinica_id
      WHERE o.clinica_id = $1 AND o.entidade = 'AdesaoItem'`,
    [clinicaId],
  )
  const porAdesao = new Map(dados.adesoes.map((a) => [a.id, a]))
  const planoPorId = new Map(dados.planos.map((p) => [p.id, p]))
  let itensQueBatem = 0
  for (const i of itens.rows) {
    const a = porAdesao.get(i.chave)
    if (a === undefined) continue
    const pl = planoPorId.get(a.planoId)
    const esperadoSessoes = a.sessoes > 0 ? a.sessoes : (pl?.sessoes ?? 1)
    const esperadoIntervalo = a.intervaloDias > 0 ? a.intervaloDias : (pl?.intervaloDias ?? 7)
    const esperadoRotulo = a.rotuloSessao === '' ? (pl?.rotuloSessao ?? 'Sessão') : a.rotuloSessao
    const bate =
      i.sessoes === esperadoSessoes &&
      i.intervalo_dias === esperadoIntervalo &&
      i.rotulo_sessao === esperadoRotulo &&
      i.procedimento_nome === (pl?.nome ?? '')
    if (bate) itensQueBatem += 1
    if (Number(i.materializadas) !== esperadoSessoes) {
      observacoes.push({
        aba: 'Adesoes',
        linha: 0,
        coluna: 'sessoes',
        codigo: 'SessoesMaterializadasDiferem',
        mensagem:
          `a adesão "${i.chave}" declara ${esperadoSessoes} sessões e tem ` +
          `${i.materializadas} sessão(ões) viva(s) na aba Tarefas. A v20 mostra a CONTAGEM ` +
          'real (statsAdesao), então isto é a clínica tendo cancelado ou apagado sessões à ' +
          'mão — não é divergência de migração.',
      })
    }
  }
  linhas.push(
    compararNumeros(
      'Campos derivados da adesão (sessoes · intervalo · rótulo · nome)',
      dados.adesoes.length,
      itensQueBatem,
    ),
  )

  // ── ARREDONDAMENTO (ADR 0009) ─────────────────────────────────────────
  //
  // `0` é o resultado nas três planilhas reais, e a linha existe para que o
  // dia em que não for zero seja um dia em que alguém LEIA quantos centavos
  // foram mexidos, em vez de um dia em que a soma simplesmente feche.
  linhas.push(compararNumeros('Arredondamentos de centavo declarados', 0, dados.arredondamentos))

  // ── LINHAS NO DESTINO SEM ORIGEM NA v20 ───────────────────────────────
  //
  // A contramedida do `JOIN` da conferência 1. Elas são esperadas e são
  // poucas — a administradora criada com a clínica, os perfis padrão, os
  // motivos de perda, as pessoas reconstruídas — e elas vão para o relatório
  // CONTADAS, por tabela. Uma segunda execução que duplicasse dado apareceria
  // exatamente aqui, e em nenhum outro lugar.
  for (const aba of ABAS) {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM ${DESTINO[aba].tabela} d
        WHERE d.clinica_id = $1
          AND NOT EXISTS (SELECT 1 FROM origens_da_v20 o
                           WHERE o.clinica_id = d.clinica_id AND o.id_interno = d.id)`,
      [clinicaId],
    )
    const n = Number(r.rows[0]!.n)
    if (n === 0) continue
    observacoes.push({
      aba,
      linha: 0,
      coluna: '',
      codigo: 'LinhaSemOrigem',
      mensagem:
        `${n} linha(s) de ${DESTINO[aba].tabela} desta clínica não vêm da planilha. ` +
        'Esperado para pessoas (a administradora criada com a clínica, e a equipe que a v20 ' +
        'apagou e o migrador reconstruiu). Em qualquer outra tabela, confira.',
    })
  }

  return {
    clinicaId,
    linhas,
    fechado: linhas.every((l) => l.bate),
    arredondamentos: dados.arredondamentos,
    observacoes,
  }
}
