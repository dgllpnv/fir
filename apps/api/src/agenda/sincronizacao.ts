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
import {
  type AgendaDaClinica,
  AgendaPorIcal,
  type AgendaProvider,
  type ContagensDoCiclo,
  FalhaDaLeitura,
  type LeituraDaAgenda,
  type Provedor,
} from './agenda-provider'
import { type Baixador, FalhaAoBaixar } from './baixar-feed'
import { type CompromissoLido, FeedInvalido } from './leitor-ical'

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
  provedor: Provedor
  url_secreta: string | null
  responsavel_id: string
  palavras_ignorar: string[]
}

/**
 * A agenda que a rodada lê. O MedX só conta com a integração LIGADA e o
 * último teste verde (spec integracao-medx B.9): desligar no painel para a
 * leitura no ciclo seguinte, sem depender de mexer nesta linha.
 */
const AGENDA_ATIVA = `
  SELECT a.id, a.provedor, a.url_secreta, a.responsavel_id, a.palavras_ignorar
    FROM agendas_externas a
    LEFT JOIN integracoes_da_clinica i ON i.clinica_id = a.clinica_id AND i.provedor = a.provedor
   WHERE a.ativa
     AND (a.provedor = 'ical' OR (i.agenda_ligada AND i.verificacao = 'ok'))`

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
  private readonly provedores: ReadonlyMap<Provedor, AgendaProvider>

  /** `medx` ausente: a clínica com MedX fica sem leitura (só o worker fala com o MedX). */
  constructor(
    private readonly banco: BancoService,
    private readonly relogio: Relogio,
    baixar: Baixador,
    medx?: AgendaProvider,
  ) {
    const p = new Map<Provedor, AgendaProvider>([['ical', new AgendaPorIcal(baixar)]])
    if (medx !== undefined) p.set('medx', medx)
    this.provedores = p
  }

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
      const r = await c.query<Agenda>(AGENDA_ATIVA)
      return r.rows[0] ?? null
    })
    const provedor = agenda === null ? undefined : this.provedores.get(agenda.provedor)
    if (agenda === null || provedor === undefined) return { tipo: 'sem-agenda' }

    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)
    const janela = {
      de: inicioDoDia(hoje, fuso),
      ate: inicioDoDia(somarDias(hoje, DIAS_DA_JANELA), fuso),
      fuso,
    }

    let leitura: LeituraDaAgenda
    try {
      leitura = await provedor.ler(clinicaId, deAgenda(agenda), { ...janela, hoje, agora })
    } catch (e) {
      const conhecida = e instanceof FalhaAoBaixar || e instanceof FeedInvalido || e instanceof FalhaDaLeitura
      const erro = conhecida ? e.message : 'Falha ao ler a agenda.'
      if (!conhecida) console.error('[agenda] leitura falhou:', e instanceof Error ? e.name : 'erro desconhecido')
      const ciclo = e instanceof FalhaDaLeitura ? e.ciclo : undefined
      await this.registrarFalha(clinicaId, agora, erro, agenda.provedor, janela, ciclo)
      return { tipo: 'falhou', erro }
    }

    try {
      const resumo = await this.banco.naClinica(clinicaId, SISTEMA, (c) =>
        conciliar(c, {
          clinicaId,
          fuso,
          agora,
          hoje,
          janela,
          provedor: agenda.provedor,
          lidos: leitura.lidos,
          naoDecididos: leitura.naoDecididos,
          ciclo: leitura.ciclo,
        }),
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
      await this.registrarFalha(clinicaId, agora, erro, agenda.provedor, janela, leitura.ciclo)
      return { tipo: 'falhou', erro }
    }
  }

  private async registrarFalha(
    clinicaId: ClinicaId,
    agora: Date,
    erro: string,
    provedor: Provedor,
    janela: { de: Date; ate: Date },
    ciclo: ContagensDoCiclo | undefined,
  ): Promise<void> {
    await this.banco.naClinica(clinicaId, SISTEMA, async (c) => {
      await c.query(
        `UPDATE agendas_externas
            SET ultima_leitura_em = $1, ultimo_erro = left($2, 300)
          WHERE ativa`,
        [agora, erro],
      )
      if (provedor === 'medx') await registrarCiclo(c, clinicaId, janela, ciclo, 'falhou', agora)
    })
  }
}

const deAgenda = (a: Agenda): AgendaDaClinica => ({
  id: a.id,
  provedor: a.provedor,
  urlSecreta: a.url_secreta,
  responsavelId: a.responsavel_id,
  palavrasIgnorar: a.palavras_ignorar,
})

/** O registro do ciclo (B.12): só contagens. Apaga o que passou de 1 ano (retenção). */
async function registrarCiclo(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  janela: { de: Date; ate: Date },
  ciclo: ContagensDoCiclo | undefined,
  resultado: 'ok' | 'falhou',
  agora: Date,
): Promise<void> {
  const k = ciclo ?? { agendamentosLidos: 0, paginas: 0, chamadasDeContato: 0, confirmacoesPorId: 0 }
  await c.query(
    `INSERT INTO ciclos_da_agenda_externa
       (clinica_id, provedor, janela_de, janela_ate, agendamentos_lidos, paginas, chamadas_de_contato,
        confirmacoes_por_id, resultado, em)
     VALUES ($1, 'medx', $2, $3, $4, $5, $6, $7, $8, $9)`,
    [clinicaId, janela.de, janela.ate, k.agendamentosLidos, k.paginas, k.chamadasDeContato, k.confirmacoesPorId, resultado, agora],
  )
  await c.query(`DELETE FROM ciclos_da_agenda_externa WHERE em < $1::timestamptz - interval '1 year'`, [agora])
}

type Contexto = {
  clinicaId: ClinicaId
  fuso: string
  agora: Date
  hoje: string
  janela: { de: Date; ate: Date }
  provedor: Provedor
  lidos: readonly CompromissoLido[]
  naoDecididos: ReadonlySet<string>
  ciclo: ContagensDoCiclo | undefined
}

async function conciliar(c: pg.PoolClient, x: Contexto): Promise<ResumoDaSincronizacao> {
  // A trava: uma rodada por clínica de cada vez. E a releitura DENTRO dela —
  // a agenda pode ter sido desligada entre a fase 1 e agora.
  // A mesma linha para iCal e MedX (B.9): trocar de provedor no meio da
  // rodada faz esta rodada não aplicar nada.
  const ag = await c.query<Agenda>(`${AGENDA_ATIVA} FOR UPDATE OF a`)
  const agenda = ag.rows[0]
  if (agenda === undefined || agenda.provedor !== x.provedor) {
    return { vistos: 0, criados: 0, reagendados: 0, desmarcados: 0, ignorados: 0, pacientesNovos: 0, pacienteDesativado: 0 }
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
      WHERE ce.provedor = $3
        AND (ce.uid_externo = ANY($1) OR (ce.removido_em IS NULL AND ce.inicio >= $2))`,
    [chaves, x.janela.de, x.provedor],
  )
  const conhecidos = new Map(conhecidosR.rows.map((k) => [k.uid_externo, k]))

  const resumo = {
    vistos: x.lidos.length,
    criados: 0,
    reagendados: 0,
    desmarcados: 0,
    ignorados: 0,
    pacientesNovos: 0,
    pacienteDesativado: 0,
  }
  const limiteParaCriar = somarDias(x.hoje, DIAS_PARA_CRIAR)

  for (const lido of x.lidos) {
    const comp = { dia: diaCivil(lido.inicio, x.fuso), hora: horaCivil(lido.inicio, x.fuso), cancelado: lido.cancelado }
    const k = conhecidos.get(lido.chave)

    if (k === undefined) {
      if (decidirPelaAgenda(null, comp, x.hoje).tipo !== 'criar' || comp.dia > limiteParaCriar) continue
      // Provedor estruturado (MedX): o paciente veio em campos; sem paciente
      // (bloqueio de horário) não há cartão. iCal: o título decide.
      const ignorar =
        lido.paciente !== undefined
          ? lido.paciente === null || lido.paciente.nome === ''
          : motivoParaIgnorar({ ...lido }, agenda.palavras_ignorar, procedimentos) !== null
      if (ignorar) {
        resumo.ignorados++
        continue
      }
      const novo = await criarCartao(c, x, agenda, lido, comp, procedimentos)
      if (novo.tipo === 'paciente-desativado') {
        resumo.pacienteDesativado++
        continue
      }
      resumo.criados++
      if (novo.pacienteNovo) resumo.pacientesNovos++
      continue
    }

    await c.query(
      `UPDATE compromissos_externos SET visto_em = $2, inicio = $3, removido_em = NULL
        WHERE provedor = $4 AND uid_externo = $1`,
      [lido.chave, x.agora, lido.inicio, x.provedor],
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
    (k) =>
      k.removido_em === null &&
      k.inicio >= x.agora &&
      k.inicio < x.janela.ate &&
      !noFeed.has(k.uid_externo) &&
      !x.naoDecididos.has(k.uid_externo),
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
      `UPDATE compromissos_externos SET removido_em = $2 WHERE provedor = $3 AND uid_externo = $1`,
      [k.uid_externo, x.agora, x.provedor],
    )
  }
  if (x.provedor === 'medx') await registrarCiclo(c, x.clinicaId, x.janela, x.ciclo, 'ok', x.agora)

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
): Promise<{ tipo: 'criado'; pacienteNovo: boolean } | { tipo: 'paciente-desativado' }> {
  const estruturado = lido.paciente ?? null
  const dados =
    estruturado !== null
      ? { nome: estruturado.nome, telefone: estruturado.telefone }
      : dadosDoCompromisso(lido, procedimentos)
  // A conciliação já recusou o compromisso sem nome; o `!` é essa garantia.
  const paciente = await vincularPaciente(c, x, dados.nome!, dados.telefone, estruturado?.idOpaco ?? null)
  if (paciente === 'desativado') return { tipo: 'paciente-desativado' }
  const tipo = lido.tipo ?? tipoDoCompromisso(lido, procedimentos)

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
    `INSERT INTO compromissos_externos (clinica_id, provedor, uid_externo, tarefa_id, inicio, visto_em, referencia_cifrada)
     VALUES ($1, $6, $2, $3, $4, $5, $7)`,
    [x.clinicaId, lido.chave, t.rows[0]!.id, lido.inicio, x.agora, x.provedor, lido.referencia ?? null],
  )
  return { tipo: 'criado', pacienteNovo: paciente.novo }
}

type PacienteVinculado = { id: string; unidadeId: string | null; novo: boolean }

/**
 * Desativação que NÃO bloqueia a agenda: o cadastro era engano, não a vontade
 * do titular. Qualquer outro motivo — e o desativado antigo, sem motivo — bloqueia.
 */
const DESATIVACAO_POR_ENGANO = ['duplicado', 'erro-de-cadastro']

/**
 * Id do provedor → telefone → nome exato → cadastrar (ADR 0019, decisão 5;
 * spec integracao-medx B.6, B.7).
 *
 * **Quem foi desativado não volta pela agenda** (B.7, dívida D-L1): se o
 * vínculo pelo id do MedX, o telefone ou o nome levam a um paciente
 * desativado (ou à supressão), devolve `'desativado'` — não cria cartão, não
 * cadastra de novo, não reativa. Vale para o iCal também: era ele que recriava.
 *
 * Telefone que casa com mais de uma paciente desempata pelo nome; sem
 * desempate, liga à mais antiga e marca `conferir_cadastro` — alguém precisa
 * olhar, e marcar é melhor que escolher em silêncio. Nome e telefone de fora
 * nunca substituem os da ficha.
 */
async function vincularPaciente(
  c: pg.PoolClient,
  x: Contexto,
  nome: string,
  telefone: string | null,
  idOpaco: string | null,
): Promise<PacienteVinculado | 'desativado'> {
  if (idOpaco !== null) {
    const v = await c.query<{ paciente_id: string | null; suprimido: boolean; ativo: boolean | null; unidade_id: string | null }>(
      `SELECT pe.paciente_id, pe.suprimido_em IS NOT NULL AS suprimido, p.ativo, p.unidade_id
         FROM pacientes_externos pe LEFT JOIN pacientes p ON p.id = pe.paciente_id
        WHERE pe.provedor = $1 AND pe.id_externo_hmac = $2`,
      [x.provedor, idOpaco],
    )
    const l = v.rows[0]
    if (l !== undefined) {
      if (l.suprimido || l.paciente_id === null || l.ativo !== true) return 'desativado'
      return { id: l.paciente_id, unidadeId: l.unidade_id, novo: false }
    }
  }

  const achado = (await porTelefoneOuNome(c, nome, telefone)) ?? (await cadastrar(c, x.clinicaId, nome, telefone))
  if (achado === 'desativado') return 'desativado'
  if (idOpaco !== null) {
    await c.query(
      `INSERT INTO pacientes_externos (clinica_id, provedor, id_externo_hmac, paciente_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (clinica_id, provedor, id_externo_hmac) DO NOTHING`,
      [x.clinicaId, x.provedor, idOpaco, achado.id],
    )
  }
  return achado
}

async function porTelefoneOuNome(
  c: pg.PoolClient,
  nome: string,
  telefone: string | null,
): Promise<PacienteVinculado | 'desativado' | null> {
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

  // Ninguém ATIVO casou: um desativado que casa bloqueia (B.7, D-L1).
  const inativos = await c.query<{ telefone: string; mesmo_nome: boolean }>(
    `SELECT telefone, nome_chave = normalizar_nome($1) AS mesmo_nome FROM pacientes
      WHERE NOT ativo
        AND (motivo_desativacao IS NULL OR motivo_desativacao <> ALL ($3::text[]))
        AND (nome_chave = normalizar_nome($1)
             OR ($2::text IS NOT NULL AND telefone_chave IS NOT NULL AND right(telefone_chave, 8) = $2))`,
    [nome, final, DESATIVACAO_POR_ENGANO],
  )
  const bloqueia = inativos.rows.some((p) => p.mesmo_nome || (telefone !== null && mesmoTelefone(p.telefone, telefone)))
  return bloqueia ? 'desativado' : null
}

async function cadastrar(
  c: pg.PoolClient,
  clinicaId: ClinicaId,
  nome: string,
  telefone: string | null,
): Promise<PacienteVinculado> {
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
