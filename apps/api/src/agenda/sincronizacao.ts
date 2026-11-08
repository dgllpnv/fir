import type { ResumoDaSincronizacao } from '@fir/contracts'
import {
  type AcaoDaAgenda,
  type CartaoDaAgenda,
  dadosDoCompromisso,
  decidirPelaAgenda,
  diaCivil,
  type Etapa,
  type EventoDeJornada,
  ehErro,
  finalDoTelefone,
  horaCivil,
  inicioDoDia,
  mesmoTelefone,
  motivoParaIgnorar,
  normalizarNome,
  podeConsiderarRemocoes,
  type Relogio,
  somarDias,
  type StatusDeTarefa,
  tipoDoCompromisso,
  transicao,
} from '@fir/domain'
import type pg from 'pg'
import { SISTEMA, SISTEMA_NO_BANCO } from '../banco/ator'
import type { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { brAno } from '../tarefas/leitura'
import { type Baixador, FalhaAoBaixar } from './baixar-feed'
import { type CompromissoLido, FeedInvalido, lerIcal } from './leitor-ical'

/**
 * A sincronização da agenda do sistema da clínica (ADR 0019).
 *
 * Duas fases, e a separação é a decisão que importa:
 *
 *  1. FORA de transação: baixar e interpretar o feed. É rede, pode levar 20 s,
 *     e uma transação aberta esse tempo todo morreria no
 *     `idle_in_transaction_session_timeout` — e seguraria conexão do pool que
 *     serve o balcão.
 *  2. DENTRO de UMA transação por clínica, com `FOR UPDATE` na linha da
 *     agenda: conciliar. Duas rodadas ao mesmo tempo (o cron e o "Sincronizar
 *     agora") se enfileiram em vez de criar o mesmo cartão duas vezes; e a
 *     rodada é tudo-ou-nada — meia agenda conciliada é pior que nenhuma.
 *
 * O ator é SISTEMA: a trilha de auditoria registra que foi a sincronização,
 * e o histórico do cartão grava `porId = 'sistema'` — decisão do dono: cartão
 * da agenda não conta na meta de agendamentos de ninguém.
 *
 * NADA aqui vai para log com conteúdo: nome, telefone e título do compromisso
 * são dado de paciente (regra 21). O log carrega só contagens.
 */

/** Hoje até +60 dias: a janela em que recorrência é expandida e remoção conta. */
export const DIAS_DA_JANELA = 60
/** Compromisso avulso mais longe que isto não vira cartão (agenda de 2030 não é rotina). */
const DIAS_PARA_CRIAR = 365

export type ResultadoDaClinica =
  | { readonly tipo: 'sem-agenda' }
  | { readonly tipo: 'ok'; readonly resumo: ResumoDaSincronizacao }
  | { readonly tipo: 'falhou'; readonly erro: string }

type Agenda = {
  id: string
  url_secreta: string
  responsavel_id: string
  palavras_ignorar: string[]
}

type Conhecido = {
  uid_externo: string
  tarefa_id: string
  inicio: Date
  removido_em: Date | null
  etapa: Etapa | null
  status: StatusDeTarefa
  historico: EventoDeJornada[]
  excluida: boolean
  prazo: string
  hora: string | null
}

class FeedVazio extends Error {}

export class SincronizacaoDaAgenda {
  constructor(
    private readonly banco: BancoService,
    private readonly relogio: Relogio,
    private readonly baixar: Baixador,
  ) {}

  /** Todas as clínicas ativas. Uma clínica que falha não impede as outras. */
  async sincronizarTodas(): Promise<{ clinicas: number; falhas: number }> {
    const r = await this.banco.semIsolamentoDeClinica<{ id: string; fuso: string }>(
      'SELECT id, fuso FROM clinicas WHERE ativa ORDER BY criada_em',
    )
    let clinicas = 0
    let falhas = 0
    for (const c of r.rows) {
      // `as`: o id vem de `clinicas`, a raiz do tenancy — fonte confiável.
      const res = await this.sincronizarClinica(c.id as ClinicaId, c.fuso).catch(
        (): ResultadoDaClinica => ({ tipo: 'falhou', erro: 'erro interno' }),
      )
      if (res.tipo === 'sem-agenda') continue
      clinicas++
      if (res.tipo === 'falhou') falhas++
    }
    return { clinicas, falhas }
  }

  async sincronizarClinica(clinicaId: ClinicaId, fuso: string): Promise<ResultadoDaClinica> {
    const agenda = await this.banco.naClinica(clinicaId, SISTEMA, async (c) => {
      const r = await c.query<Agenda>(
        `SELECT id, url_secreta, responsavel_id, palavras_ignorar
           FROM agendas_externas WHERE ativa`,
      )
      return r.rows[0] ?? null
    })
    if (agenda === null) return { tipo: 'sem-agenda' }

    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)
    const janela = {
      de: inicioDoDia(hoje, fuso),
      ate: inicioDoDia(somarDias(hoje, DIAS_DA_JANELA), fuso),
      fuso,
    }

    let lidos: CompromissoLido[]
    try {
      lidos = lerIcal(await this.baixar(agenda.url_secreta), janela)
    } catch (e) {
      const erro =
        e instanceof FalhaAoBaixar || e instanceof FeedInvalido ? e.message : 'Falha ao ler a agenda.'
      await this.registrarFalha(clinicaId, agora, erro)
      return { tipo: 'falhou', erro }
    }

    try {
      const resumo = await this.banco.naClinica(clinicaId, SISTEMA, (c) =>
        conciliar(c, { clinicaId, fuso, agora, hoje, janela, lidos }),
      )
      return { tipo: 'ok', resumo }
    } catch (e) {
      const erro =
        e instanceof FeedVazio
          ? e.message
          : 'A agenda foi lida, mas não deu para atualizar os cartões. Avise o suporte.'
      if (!(e instanceof FeedVazio)) {
        console.error('[agenda] conciliação falhou:', e instanceof Error ? e.message : 'erro desconhecido')
      }
      await this.registrarFalha(clinicaId, agora, erro)
      return { tipo: 'falhou', erro }
    }
  }

  private async registrarFalha(clinicaId: ClinicaId, agora: Date, erro: string): Promise<void> {
    await this.banco.naClinica(clinicaId, SISTEMA, (c) =>
      c.query(
        `UPDATE agendas_externas
            SET ultima_leitura_em = $1, ultimo_erro = left($2, 300)
          WHERE ativa`,
        [agora, erro],
      ),
    )
  }
}

type Contexto = {
  clinicaId: ClinicaId
  fuso: string
  agora: Date
  hoje: string
  janela: { de: Date; ate: Date }
  lidos: readonly CompromissoLido[]
}

async function conciliar(c: pg.PoolClient, x: Contexto): Promise<ResumoDaSincronizacao> {
  // A trava: uma rodada por clínica de cada vez. E a releitura DENTRO dela —
  // a agenda pode ter sido desligada entre a fase 1 e agora.
  const ag = await c.query<Agenda>(
    `SELECT id, url_secreta, responsavel_id, palavras_ignorar
       FROM agendas_externas WHERE ativa FOR UPDATE`,
  )
  const agenda = ag.rows[0]
  if (agenda === undefined) {
    return { vistos: 0, criados: 0, reagendados: 0, desmarcados: 0, ignorados: 0, pacientesNovos: 0 }
  }

  const resp = await c.query<{ ativo: boolean }>('SELECT ativo FROM pessoas WHERE id = $1', [
    agenda.responsavel_id,
  ])
  if (resp.rows[0]?.ativo !== true) {
    throw new FeedVazio('O responsável pelos cartões da agenda está inativo. Escolha outra pessoa.')
  }

  const procedimentos = (
    await c.query<{ nome: string }>('SELECT nome FROM procedimentos WHERE ativo AND excluido_em IS NULL')
  ).rows.map((p) => p.nome)

  const chaves = x.lidos.map((l) => l.chave)
  const conhecidosR = await c.query<Conhecido>(
    `SELECT ce.uid_externo, ce.tarefa_id, ce.inicio, ce.removido_em,
            t.etapa::text AS etapa, t.status, t.historico,
            (t.excluida_em IS NOT NULL) AS excluida,
            t.prazo::text AS prazo, left(t.hora::text, 5) AS hora
       FROM compromissos_externos ce
       JOIN tarefas t ON t.id = ce.tarefa_id
      WHERE ce.provedor = 'ical'
        AND (ce.uid_externo = ANY($1) OR (ce.removido_em IS NULL AND ce.inicio >= $2))`,
    [chaves, x.janela.de],
  )
  const conhecidos = new Map(conhecidosR.rows.map((k) => [k.uid_externo, k]))

  const resumo = { vistos: x.lidos.length, criados: 0, reagendados: 0, desmarcados: 0, ignorados: 0, pacientesNovos: 0 }
  const limiteParaCriar = somarDias(x.hoje, DIAS_PARA_CRIAR)

  for (const lido of x.lidos) {
    const comp = { dia: diaCivil(lido.inicio, x.fuso), hora: horaCivil(lido.inicio, x.fuso), cancelado: lido.cancelado }
    const k = conhecidos.get(lido.chave)

    if (k === undefined) {
      if (decidirPelaAgenda(null, comp, x.hoje).tipo !== 'criar' || comp.dia > limiteParaCriar) continue
      if (motivoParaIgnorar({ ...lido }, agenda.palavras_ignorar, procedimentos) !== null) {
        resumo.ignorados++
        continue
      }
      const novo = await criarCartao(c, x, agenda, lido, comp, procedimentos)
      resumo.criados++
      if (novo.pacienteNovo) resumo.pacientesNovos++
      continue
    }

    await c.query(
      `UPDATE compromissos_externos SET visto_em = $2, inicio = $3, removido_em = NULL
        WHERE provedor = 'ical' AND uid_externo = $1`,
      [lido.chave, x.agora, lido.inicio],
    )
    const acao = decidirPelaAgenda(cartaoDe(k), comp, x.hoje)
    if (await aplicar(c, x, k, acao)) {
      if (acao.tipo === 'reagendar') resumo.reagendados++
      if (acao.tipo === 'desmarcar') resumo.desmarcados++
    }
  }

  // SUMIÇOS. Só o que estava no FUTURO e dentro da janela, e só com feed
  // saudável. Um compromisso avulso movido para depois da janela continua
  // em `chaves` (o leitor devolve avulso de qualquer data), então não cai aqui.
  const noFeed = new Set(chaves)
  const sumidos = [...conhecidos.values()].filter(
    (k) => k.removido_em === null && k.inicio >= x.agora && k.inicio < x.janela.ate && !noFeed.has(k.uid_externo),
  )
  if (sumidos.length > 0 && !podeConsiderarRemocoes(x.lidos.length, sumidos.length)) {
    throw new FeedVazio(
      'O link da agenda respondeu um calendário vazio. Nada foi desmarcado. Confira se o link ainda é válido.',
    )
  }
  for (const k of sumidos) {
    const acao = decidirPelaAgenda(cartaoDe(k), null, x.hoje)
    if (await aplicar(c, x, k, acao)) resumo.desmarcados++
    await c.query(
      `UPDATE compromissos_externos SET removido_em = $2 WHERE provedor = 'ical' AND uid_externo = $1`,
      [k.uid_externo, x.agora],
    )
  }

  await c.query(
    `UPDATE agendas_externas
        SET ultima_leitura_em = $1, ultimo_sucesso_em = $1, ultimo_erro = '', ultimo_resumo = $2
      WHERE id = $3`,
    [x.agora, JSON.stringify(resumo), agenda.id],
  )
  return resumo
}

const cartaoDe = (k: Conhecido): CartaoDaAgenda => ({
  etapa: k.etapa,
  excluido: k.excluida,
  prazo: k.prazo,
  hora: k.hora,
})

const quando = (dia: string, hora: string | null): string => `${brAno(dia)}${hora === null ? '' : ` ${hora}`}`

/**
 * Aplica `reagendar` ou `desmarcar` pela MESMA tabela de transições da rota
 * da jornada (`transicao`): a sincronização não tem atalho que a recepção não
 * tenha. Devolve se algo mudou.
 */
async function aplicar(c: pg.PoolClient, x: Contexto, k: Conhecido, acao: AcaoDaAgenda): Promise<boolean> {
  if (acao.tipo !== 'reagendar' && acao.tipo !== 'desmarcar') return false
  if (k.etapa === null) return false

  // Relê com trava: a recepção pode ter tocado o cartão desde a leitura acima.
  const atual = await c.query<{ etapa: Etapa; status: StatusDeTarefa; historico: EventoDeJornada[]; excluida: boolean }>(
    `SELECT etapa::text AS etapa, status, historico, (excluida_em IS NOT NULL) AS excluida
       FROM tarefas WHERE id = $1 FOR UPDATE`,
    [k.tarefa_id],
  )
  const t = atual.rows[0]
  if (t === undefined || t.excluida || t.etapa !== k.etapa) return false

  const acaoDaJornada = acao.tipo === 'reagendar' ? 'reagendar' : 'desmarcar'
  const destino = transicao({ etapa: t.etapa, status: t.status, historico: t.historico }, acaoDaJornada)
  if (ehErro(destino)) return false

  const nota =
    acao.tipo === 'reagendar'
      ? `pela agenda do sistema · de ${quando(k.prazo, k.hora)} para ${quando(acao.prazo, acao.hora)}`
      : acao.porque === 'cancelado'
        ? 'cancelado na agenda do sistema'
        : 'removido da agenda do sistema'
  const evento: EventoDeJornada = {
    acao: acaoDaJornada,
    etapa: destino.valor.etapa,
    em: x.agora.toISOString(),
    porId: SISTEMA_NO_BANCO,
    nota,
  }

  if (acao.tipo === 'reagendar') {
    await c.query(
      `UPDATE tarefas
          SET etapa = $2::etapa_de_jornada, status = $3, historico = historico || $4::jsonb,
              prazo = $5::date, hora = $6::time, proximo_passo_em = NULL, confirmacao_enviada_em = NULL
        WHERE id = $1`,
      [k.tarefa_id, destino.valor.etapa, destino.valor.status, JSON.stringify([evento]), acao.prazo, acao.hora],
    )
  } else {
    // `proximo_passo_em = hoje`: é o que põe o cartão em Recontatar agora.
    await c.query(
      `UPDATE tarefas
          SET etapa = $2::etapa_de_jornada, status = $3, historico = historico || $4::jsonb,
              proximo_passo_em = $5::date
        WHERE id = $1`,
      [k.tarefa_id, destino.valor.etapa, destino.valor.status, JSON.stringify([evento]), x.hoje],
    )
  }
  return true
}

async function criarCartao(
  c: pg.PoolClient,
  x: Contexto,
  agenda: Agenda,
  lido: CompromissoLido,
  comp: { dia: string; hora: string },
  procedimentos: readonly string[],
): Promise<{ pacienteNovo: boolean }> {
  const dados = dadosDoCompromisso(lido, procedimentos)
  // `motivoParaIgnorar` já recusou o compromisso sem nome; o `!` é essa garantia.
  const paciente = await vincularPaciente(c, x.clinicaId, dados.nome!, dados.telefone)
  const tipo = tipoDoCompromisso(lido, procedimentos)

  const evento: EventoDeJornada = {
    acao: 'agendar',
    etapa: 'agendado',
    em: x.agora.toISOString(),
    porId: SISTEMA_NO_BANCO,
    nota: `pela agenda do sistema · para ${quando(comp.dia, comp.hora)}`,
  }
  const t = await c.query<{ id: string }>(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, hora, prioridade, status,
        paciente_id, tipo, etapa, historico, unidade_id)
     VALUES ($1, $2, $2, $3, $4::date, $5::time, 'normal', 'aberta', $6, $3, 'agendado', $7::jsonb, $8)
     RETURNING id`,
    [x.clinicaId, agenda.responsavel_id, tipo, comp.dia, comp.hora, paciente.id, JSON.stringify([evento]), paciente.unidadeId],
  )
  await c.query(
    `INSERT INTO compromissos_externos (clinica_id, provedor, uid_externo, tarefa_id, inicio, visto_em)
     VALUES ($1, 'ical', $2, $3, $4, $5)`,
    [x.clinicaId, lido.chave, t.rows[0]!.id, lido.inicio, x.agora],
  )
  return { pacienteNovo: paciente.novo }
}

type PacienteVinculado = { id: string; unidadeId: string | null; novo: boolean }

/**
 * Telefone → nome exato → cadastrar (ADR 0019, decisão 5).
 *
 * Telefone que casa com mais de uma paciente desempata pelo nome; sem
 * desempate, liga à mais antiga e marca `conferir_cadastro` — alguém precisa
 * olhar, e marcar é melhor que escolher em silêncio.
 */
async function vincularPaciente(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  nome: string,
  telefone: string | null,
): Promise<PacienteVinculado> {
  const final = telefone === null ? null : finalDoTelefone(telefone)
  if (final !== null && telefone !== null) {
    const r = await c.query<{ id: string; nome: string; telefone: string; unidade_id: string | null }>(
      `SELECT id, nome, telefone, unidade_id FROM pacientes
        WHERE ativo AND telefone_chave IS NOT NULL AND right(telefone_chave, 8) = $1
        ORDER BY criado_em, id`,
      [final],
    )
    const mesmos = r.rows.filter((p) => mesmoTelefone(p.telefone, telefone))
    if (mesmos.length === 1) return { id: mesmos[0]!.id, unidadeId: mesmos[0]!.unidade_id, novo: false }
    if (mesmos.length > 1) {
      const peloNome = mesmos.filter((p) => normalizarNome(p.nome) === normalizarNome(nome))
      if (peloNome.length === 1) return { id: peloNome[0]!.id, unidadeId: peloNome[0]!.unidade_id, novo: false }
      const escolhida = mesmos[0]!
      await c.query('UPDATE pacientes SET conferir_cadastro = true WHERE id = $1', [escolhida.id])
      return { id: escolhida.id, unidadeId: escolhida.unidade_id, novo: false }
    }
  }

  const porNome = await c.query<{ id: string; unidade_id: string | null }>(
    'SELECT id, unidade_id FROM pacientes WHERE ativo AND nome_chave = normalizar_nome($1)',
    [nome],
  )
  if (porNome.rows[0] !== undefined) {
    return { id: porNome.rows[0].id, unidadeId: porNome.rows[0].unidade_id, novo: false }
  }

  // `ON CONFLICT`: a recepção pode cadastrar a mesma paciente neste instante.
  // O índice único parcial decide, e quem chegou depois lê a que ficou.
  const ins = await c.query<{ id: string }>(
    `INSERT INTO pacientes (clinica_id, nome, telefone, conferir_cadastro)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (clinica_id, nome_chave) WHERE ativo DO NOTHING
     RETURNING id`,
    [clinicaId, nome, telefone ?? ''],
  )
  if (ins.rows[0] !== undefined) return { id: ins.rows[0].id, unidadeId: null, novo: true }
  const depois = await c.query<{ id: string; unidade_id: string | null }>(
    'SELECT id, unidade_id FROM pacientes WHERE ativo AND nome_chave = normalizar_nome($1)',
    [nome],
  )
  return { id: depois.rows[0]!.id, unidadeId: depois.rows[0]!.unidade_id, novo: false }
}
