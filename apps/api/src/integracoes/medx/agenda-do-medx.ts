import { inicioDoDia, podeConsiderarRemocoes, somarDias } from '@fir/domain'
import { z } from 'zod'
import {
  type AgendaDaClinica,
  type AgendaProvider,
  type ContagensDoCiclo,
  FalhaDaLeitura,
  type JanelaDaRodada,
  type LeituraDaAgenda,
} from '../../agenda/agenda-provider'
import type { CompromissoLido } from '../../agenda/leitor-ical'
import { SISTEMA } from '../../banco/ator'
import type { BancoService } from '../../banco/banco.service'
import type { ClinicaId } from '../../banco/clinica-id'
import type { AberturaDeIntegracoes } from '../cofre-de-integracoes'
import { idDoMedx, instanteDoMedx, nomeSeguro, relogioDoMedx, telefoneSeguro } from './borda-do-medx'
import { ErroDoMedx, MENSAGENS_DO_MEDX } from './erros'
import { type LeitorDoMedx, Pagina, type Sessao } from './leitor-do-medx'

/**
 * A AGENDA DO MEDX como `AgendaProvider` (spec integracao-medx B; ticket T4).
 *
 * Só LÊ, e entrega à conciliação comum uma lista de compromissos já com o
 * paciente em campos. O que importa, e onde está:
 *
 *  - **lista branca (B.0):** os esquemas declaram só id, início, paciente
 *    (id, nome), `procedimentoId` (vira o bit Consulta/Procedimento) e o id
 *    do status (vira "cancelado"). Descrição, setor, profissional, confirmação,
 *    chegada, versão: descartados pelo Zod, nunca chegam aqui;
 *  - **janelas (B.1):** `[hoje, +31)` e `[+31, +60)`, bordas no fuso da
 *    clínica, enviadas no relógio do MedX (`-03:00`); dedupe por id;
 *  - **tudo ou nada (B.2):** qualquer página ruim lança; a trava de leitura
 *    vazia roda POR JANELA, sobre o resultado da confirmação por id;
 *  - **sumiu só depois de confirmar por id (B.4):** cada compromisso futuro
 *    que não veio na lista é pedido pelo id (`GET /agenda/agendamentos/{id}`):
 *    achou → volta para a lista (remarcado ou cancelado); 404 → sumiu de
 *    verdade; erro → não decide (`naoDecididos`), fica para o próximo ciclo;
 *  - **ids opacos (B.0, B.5):** o id do agendamento e o do paciente viram
 *    HMAC antes de tocar o banco; o do agendamento vai também SELADO, só para
 *    a confirmação por id;
 *  - **contato só sem vínculo (B.0):** `/contatos/{id}` só para paciente sem
 *    vínculo pelo id do MedX, num compromisso que vai virar cartão, até 50 por
 *    ciclo; o resto espera o próximo.
 *
 * NADA daqui vai para log além de contagens e códigos do catálogo.
 */

const DIAS_DA_PRIMEIRA_JANELA = 31
export const MAXIMO_DE_CONTATOS_POR_CICLO = 50
export const MAXIMO_DE_CONFIRMACOES_POR_CICLO = 100
const PROVEDOR = 'medx'

const Referencia = z.object({ id: z.number().int() })

const Agendamento = z.object({
  id: z.number().int(),
  inicio: z.string().max(40),
  paciente: z.object({ id: z.number().int(), nome: z.string().max(1000).nullable().optional() }).nullable().optional(),
  procedimentoId: z.number().int().nullable().optional(),
  status: Referencia.nullable().optional(),
})
const PaginaDeAgendamentos = z.object({ items: z.array(Agendamento), page: Pagina })

const AgendamentoPorId = z.object({
  inicio: z.string().max(40),
  status: Referencia.nullable().optional(),
})

const Contato = z.object({
  dados: z
    .object({
      celular: z.string().max(50).nullable().optional(),
      telefoneResidencial: z.string().max(50).nullable().optional(),
    })
    .nullable()
    .optional(),
})

type Lido = {
  id: string
  inicio: Date
  cancelado: boolean
  paciente: { id: string; nome: string } | null
  procedimento: boolean
}

type Conhecido = { uid_externo: string; inicio: Date; referencia_cifrada: Buffer | null }

export class AgendaDoMedx implements AgendaProvider {
  constructor(
    private readonly banco: BancoService,
    private readonly abertura: AberturaDeIntegracoes,
    private readonly leitor: LeitorDoMedx,
  ) {}

  async ler(clinicaId: ClinicaId, _agenda: AgendaDaClinica, j: JanelaDaRodada): Promise<LeituraDaAgenda> {
    const ciclo: ContagensDoCiclo = { agendamentosLidos: 0, paginas: 0, chamadasDeContato: 0, confirmacoesPorId: 0 }

    const guardado = await this.banco.comoIntegracoes(clinicaId, async (c) => {
      const r = await c.query<{
        segredo_cifrado: Buffer | null
        segredo_versao: number | null
        impressao_da_chave: string | null
        status_de_cancelado: number[]
      }>(
        `SELECT segredo_cifrado, segredo_versao, impressao_da_chave, status_de_cancelado
           FROM integracoes_da_clinica WHERE agenda_ligada AND verificacao = 'ok'`,
      )
      return r.rows[0]
    })
    if (!guardado?.segredo_cifrado || guardado.segredo_versao === null || guardado.impressao_da_chave === null) {
      throw new FalhaDaLeitura('A agenda do MedX não está ligada.', ciclo)
    }
    // O AAD leva a clínica do CONTEXTO, nunca a da linha (S-3).
    const chave = this.abertura.abrir(clinicaId, PROVEDOR, guardado.segredo_cifrado, guardado.segredo_versao)
    if (chave === null) {
      console.warn(`[integracoes] ALERTA clínica ${clinicaId}: a chave guardada não abriu`)
      throw new FalhaDaLeitura(MENSAGENS_DO_MEDX.chave_invalida, ciclo)
    }

    try {
      const s = await this.leitor.sessao(clinicaId, guardado.impressao_da_chave, chave)
      return await this.lerComSessao(clinicaId, s, j, new Set(guardado.status_de_cancelado), ciclo)
    } catch (e) {
      if (e instanceof FalhaDaLeitura) throw e
      const codigo = e instanceof ErroDoMedx ? e.codigo : 'contrato'
      if (codigo === 'recusada') {
        this.leitor.esquecer(clinicaId)
        console.warn(`[integracoes] ALERTA clínica ${clinicaId}: o MedX recusou a chave na leitura da agenda`)
      }
      if (!(e instanceof ErroDoMedx)) console.error('[integracoes] leitura da agenda:', e instanceof Error ? e.name : 'erro')
      throw new FalhaDaLeitura(MENSAGENS_DO_MEDX[codigo], ciclo)
    }
  }

  private async lerComSessao(
    clinicaId: ClinicaId,
    s: Sessao,
    j: JanelaDaRodada,
    statusDeCancelado: ReadonlySet<number>,
    ciclo: ContagensDoCiclo,
  ): Promise<LeituraDaAgenda> {
    const cancelado = (status: { id: number } | null | undefined): boolean =>
      status !== null && status !== undefined && statusDeCancelado.has(status.id)
    let offsetsDiferentes = 0
    const instante = (texto: string): Date => {
      const t = instanteDoMedx(texto)
      if (t === null) throw new ErroDoMedx('contrato')
      if (t.offsetDiferente) offsetsDiferentes++
      return t.instante
    }

    // 1. As janelas, todas as páginas. Nada é decidido antes de tudo chegar.
    const meio = inicioDoDia(somarDias(j.hoje, DIAS_DA_PRIMEIRA_JANELA), j.fuso)
    const janelas = [
      { de: j.de, ate: meio < j.ate ? meio : j.ate },
      { de: meio, ate: j.ate },
    ].filter((w) => w.ate > w.de)
    const porId = new Map<string, Lido>()
    const naJanela = janelas.map(() => 0)
    for (const [n, w] of janelas.entries()) {
      await this.leitor.paginar(
        s,
        '/agenda/agendamentos/detalhes',
        { Inicio: relogioDoMedx(w.de), Fim: relogioDoMedx(w.ate), Limit: '100' },
        PaginaDeAgendamentos,
        (p) => {
          ciclo.paginas++
          for (const a of p.items) {
            const id = idDoMedx(a.id)
            const pacienteId = a.paciente === null || a.paciente === undefined ? null : idDoMedx(a.paciente.id)
            if (id === null || (a.paciente !== null && a.paciente !== undefined && pacienteId === null)) throw new ErroDoMedx('contrato')
            porId.set(id, {
              id,
              inicio: instante(a.inicio),
              cancelado: cancelado(a.status),
              paciente: pacienteId === null ? null : { id: pacienteId, nome: nomeSeguro(a.paciente?.nome) },
              procedimento: a.procedimentoId !== null && a.procedimentoId !== undefined,
            })
            naJanela[n]!++
          }
        },
      )
    }
    ciclo.agendamentosLidos = porId.size

    // 2. Ids opacos e o que o banco já sabe (uma leitura curta, sem rede no meio).
    const opacoDoAgendamento = new Map([...porId.keys()].map((id) => [this.opaco(clinicaId, 'agendamento', id), id]))
    const opacoDoPaciente = new Map<string, string>()
    for (const l of porId.values()) {
      if (l.paciente !== null) opacoDoPaciente.set(l.paciente.id, this.opaco(clinicaId, 'paciente', l.paciente.id))
    }
    const { conhecidos, vinculados } = await this.banco.naClinica(clinicaId, SISTEMA, async (c) => {
      const k = await c.query<Conhecido>(
        `SELECT uid_externo, inicio, referencia_cifrada FROM compromissos_externos
          WHERE provedor = 'medx'
            AND (uid_externo = ANY($1) OR (removido_em IS NULL AND inicio >= $2 AND inicio < $3))`,
        [[...opacoDoAgendamento.keys()], j.agora, j.ate],
      )
      const v = await c.query<{ id_externo_hmac: string }>(
        `SELECT id_externo_hmac FROM pacientes_externos WHERE provedor = 'medx' AND id_externo_hmac = ANY($1)`,
        [[...opacoDoPaciente.values()]],
      )
      return { conhecidos: k.rows, vinculados: new Set(v.rows.map((r) => r.id_externo_hmac)) }
    })
    const jaConhecido = new Set(conhecidos.map((k) => k.uid_externo))

    // 3. Sumiu só depois de confirmar por id (B.4).
    const sumidos = conhecidos.filter((k) => !opacoDoAgendamento.has(k.uid_externo))
    const naoDecididos = new Set<string>()
    const achados: Conhecido[] = []
    const inexistentes: Conhecido[] = []
    for (const k of sumidos) {
      const id = k.referencia_cifrada === null ? null : this.abertura.abrirReferencia(clinicaId, PROVEDOR, k.referencia_cifrada)
      if (id === null || ciclo.confirmacoesPorId >= MAXIMO_DE_CONFIRMACOES_POR_CICLO) {
        naoDecididos.add(k.uid_externo)
        continue
      }
      ciclo.confirmacoesPorId++
      try {
        const a = await this.leitor.obter(s, `/agenda/agendamentos/${encodeURIComponent(id)}`, AgendamentoPorId)
        // Achou: volta para a lista, e a conciliação reagenda ou desmarca como "cancelado".
        porId.set(id, { id, inicio: instante(a.inicio), cancelado: cancelado(a.status), paciente: null, procedimento: false })
        opacoDoAgendamento.set(k.uid_externo, id)
        achados.push(k)
      } catch (e) {
        if (e instanceof ErroDoMedx && e.codigo === 'nao_encontrado') {
          inexistentes.push(k) // sumiu de verdade — se a trava abaixo deixar
          continue
        }
        // Chave recusada ou limite: a rodada inteira para. O resto: não decide agora.
        if (e instanceof ErroDoMedx && (e.codigo === 'recusada' || e.codigo === 'limite')) throw e
        naoDecididos.add(k.uid_externo)
      }
    }

    // 4. A trava de leitura vazia, POR JANELA (B.2), sobre o resultado da
    // confirmação: a janela que veio vazia enquanto todos os seus conhecidos
    // "não existem" é MedX quebrado, não uma clínica que cancelou o mês. Uma
    // janela vazia porque a única consulta foi remarcada para fora dela (B.4,
    // +10 → +75) passa: a consulta foi ACHADA pelo id.
    const em = (w: { de: Date; ate: Date }) => (k: Conhecido) => k.inicio >= w.de && k.inicio < w.ate
    for (const [n, w] of janelas.entries()) {
      const vistos = naJanela[n]! + achados.filter(em(w)).length
      if (!podeConsiderarRemocoes(vistos, inexistentes.filter(em(w)).length)) {
        throw new FalhaDaLeitura(
          'O MedX respondeu uma agenda vazia num período que tinha consultas. Nada foi desmarcado.',
          ciclo,
        )
      }
    }

    // 5. Telefone só de paciente SEM vínculo, num compromisso que vai virar cartão (B.0).
    const telefones = new Map<string, string | null>()
    const adiados = new Set<string>()
    let tetoAvisado = false
    for (const [uid, id] of opacoDoAgendamento) {
      const l = porId.get(id)!
      if (jaConhecido.has(uid) || l.paciente === null || l.cancelado || l.inicio < j.agora) continue
      const pid = l.paciente.id
      if (vinculados.has(opacoDoPaciente.get(pid)!) || telefones.has(pid)) continue
      if (ciclo.chamadasDeContato >= MAXIMO_DE_CONTATOS_POR_CICLO) {
        adiados.add(uid)
        if (!tetoAvisado) console.warn(`[integracoes] ALERTA clínica ${clinicaId}: teto de contatos do ciclo atingido`)
        tetoAvisado = true
        continue
      }
      ciclo.chamadasDeContato++
      try {
        const ct = await this.leitor.obter(s, `/contatos/${encodeURIComponent(pid)}`, Contato)
        telefones.set(pid, telefoneSeguro(ct.dados?.celular) ?? telefoneSeguro(ct.dados?.telefoneResidencial))
      } catch (e) {
        if (e instanceof ErroDoMedx && e.codigo === 'nao_encontrado') {
          telefones.set(pid, null)
          continue
        }
        if (e instanceof ErroDoMedx && (e.codigo === 'recusada' || e.codigo === 'limite')) throw e
        adiados.add(uid)
      }
    }

    if (offsetsDiferentes > 0) {
      console.warn(`[integracoes] ALERTA clínica ${clinicaId}: ${offsetsDiferentes} horário(s) com offset diferente de -03:00`)
    }

    // 6. A lista para a conciliação comum.
    const lidos: CompromissoLido[] = []
    for (const [uid, id] of opacoDoAgendamento) {
      if (adiados.has(uid)) {
        naoDecididos.add(uid)
        continue
      }
      const l = porId.get(id)!
      lidos.push({
        chave: uid,
        inicio: l.inicio,
        diaInteiro: false,
        titulo: '',
        descricao: '',
        cancelado: l.cancelado,
        recorrente: false,
        paciente:
          l.paciente === null
            ? null
            : {
                nome: l.paciente.nome,
                telefone: telefones.get(l.paciente.id) ?? null,
                idOpaco: opacoDoPaciente.get(l.paciente.id) ?? this.opaco(clinicaId, 'paciente', l.paciente.id),
              },
        tipo: l.procedimento ? 'Procedimento agendado' : 'Consulta agendada',
        referencia: this.abertura.selarReferencia(clinicaId, PROVEDOR, id),
      })
    }
    return { lidos, naoDecididos, ciclo }
  }

  private opaco(clinicaId: ClinicaId, tipo: 'agendamento' | 'paciente', id: string): string {
    return this.abertura.idOpaco(clinicaId, PROVEDOR, tipo, id)
  }
}
