'use client'

import type {
  CheckinInternoNaLista,
  ClienteCarteiraNaLista,
  ListaDeCheckinsInternosSaida,
  ListaDeClientesDaCarteiraSaida,
  ListaDeRotinasInternasSaida,
  ListaDeTarefasInternasSaida,
  RotinaInternaNaLista,
  TarefaInternaNaLista,
} from '@fir/contracts'
import { ESCOPOS_DE_APLICACAO, FREQUENCIAS_DA_ROTINA_INTERNA, SAUDES_DO_CLIENTE } from '@fir/domain'
import { useEffect, useRef, useState } from 'react'
import { Carregando, Toast, Vazio } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **A ROTINA INTERNA DA EQUIPE FIRMARE** — `Tarefa interna`, `Rotina interna`
 * e `Checkin interno` (spec G5, ADR 0016). Três estados só (`pendente` |
 * `concluida` | `cancelada`) — **nunca** a `Jornada` de nove etapas do
 * agendamento clínico (spec §3: "não anda por uma Jornada; é checklist, não
 * agendamento de paciente").
 *
 * "Minhas tarefas" é o recorte principal, mas a sessão da carteira não tem o
 * `id` do `Usuário de Gestão` corrente disponível como filtro de banco
 * diferente (spec §5: dentro do grupo, todo mundo vê a rotina de todo mundo
 * — "Minhas tarefas" é filtro de TELA, nunca fronteira). Por isso esta tela
 * mostra a rotina do grupo inteiro, mais densa que uma lista pessoal — é o
 * padrão hoje, com poucas colaboradoras.
 */

// Os contratos (`@fir/contracts`) exportam `PrioridadeDaTarefaInterna` etc. como
// SCHEMA zod (valor), sem um `type` homônimo — mesma forma que o próprio
// `prospeccao-carteira.service.ts` usa (`t.prioridade as TarefaInternaNaLista['prioridade']`).
// Derivar do campo da lista evita um segundo nome para a mesma coisa.
type PrioridadeDaTarefaInterna = TarefaInternaNaLista['prioridade']
type FrequenciaDaRotinaInterna = RotinaInternaNaLista['frequencia']
type SaudeDoCliente = CheckinInternoNaLista['saude']

const RECADO_PRIORIDADE: Record<PrioridadeDaTarefaInterna, string> = {
  baixa: 'Baixa',
  normal: 'Normal',
  alta: 'Alta',
}

const RECADO_FREQUENCIA: Record<FrequenciaDaRotinaInterna, string> = {
  diaria: 'Diária',
  semanal: 'Semanal',
  mensal: 'Mensal',
  vencimento: 'No vencimento',
  reuniao: 'Na reunião',
}

const RECADO_SAUDE: Record<SaudeDoCliente, string> = {
  bom: 'Bem',
  atencao: 'Atenção',
  critico: 'Crítico',
}

type EstadoTarefas =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; itens: TarefaInternaNaLista[] }

export default function RotinaDaCarteira() {
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<EstadoTarefas>({ tag: 'carregando' })
  const [clientes, setClientes] = useState<ClienteCarteiraNaLista[]>([])
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const dobraCriar = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const r = await chamar<ListaDeTarefasInternasSaida>('v1/carteira/tarefas-internas')
        if (valeu) setEstado({ tag: 'pronto', itens: r.tarefas })
      } catch (e) {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as tarefas.',
          })
        }
      }
      // A lista de clientes é só para NOMEAR o vínculo de uma tarefa/checkin —
      // falhar aqui não derruba a tela principal (tarefas), por isso tratada
      // à parte, sem entrar no `Estado` de erro de cima.
      try {
        const rc = await chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes')
        if (valeu) setClientes(rc.clientes)
      } catch {
        // degrada: os cartões mostram o vínculo sem o nome do cliente.
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, tentativa])

  const recarregar = () => setTentativa((n) => n + 1)

  const atualizarTarefa = (tarefa: TarefaInternaNaLista) => {
    setEstado((e) =>
      e.tag === 'pronto' ? { tag: 'pronto', itens: e.itens.map((t) => (t.id === tarefa.id ? tarefa : t)) } : e,
    )
  }

  const nomeDoCliente = (id: string | null) => clientes.find((c) => c.id === id)?.nome ?? null

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return (
      <section>
        <NavDaCarteira atual="/carteira/rotina" />
        <h1 className="titulo">Rotina</h1>
        <Carregando linhas={4} />
      </section>
    )
  }

  if (estado.tag === 'erro') {
    return (
      <section>
        <NavDaCarteira atual="/carteira/rotina" />
        <h1 className="titulo">Rotina</h1>
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={recarregar} />
      </section>
    )
  }

  const pendentes = estado.itens.filter((t) => t.status === 'pendente')
  const concluidas = estado.itens.filter((t) => t.status === 'concluida')

  return (
    <section>
      <NavDaCarteira atual="/carteira/rotina" />
      <h1 className="titulo">Rotina</h1>
      <p className="nota">
        As tarefas da equipe Firmare sobre a carteira — ligar para um cliente, retomar um lead,
        revisar o backlog da semana.
      </p>

      {estado.itens.length === 0 ? (
        <Vazio>
          <b>Nenhuma tarefa ainda.</b>
          <p className="nota">Crie a primeira tarefa para começar a rotina da equipe.</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (dobraCriar.current !== null) dobraCriar.current.open = true
            }}
          >
            Criar a primeira tarefa
          </button>
        </Vazio>
      ) : (
        <>
          {pendentes.length === 0 ? (
            <p className="nota">Nenhuma tarefa pendente — tudo em dia.</p>
          ) : (
            <div className="carteira-grade">
              {pendentes.map((t) => (
                <CartaoDeTarefa
                  key={t.id}
                  tarefa={t}
                  nomeDoCliente={nomeDoCliente(t.clienteCarteiraId)}
                  aoAtualizar={atualizarTarefa}
                  aoAvisar={setRecado}
                />
              ))}
            </div>
          )}

          {concluidas.length > 0 ? (
            <details className="carteira-dobra">
              <summary>
                Concluídas <span className="pill num">{concluidas.length}</span>
              </summary>
              {concluidas.map((t) => (
                <CartaoDeTarefa
                  key={t.id}
                  tarefa={t}
                  nomeDoCliente={nomeDoCliente(t.clienteCarteiraId)}
                  aoAtualizar={atualizarTarefa}
                  aoAvisar={setRecado}
                />
              ))}
            </details>
          ) : null}
        </>
      )}

      <FormularioDeTarefa
        dobra={dobraCriar}
        clientes={clientes}
        aoCriar={(tarefa) => {
          setEstado((e) => (e.tag === 'pronto' ? { tag: 'pronto', itens: [...e.itens, tarefa] } : e))
          setRecado(`Tarefa "${tarefa.titulo}" criada.`)
        }}
      />

      <RotinasInternas aoAvisar={setRecado} />

      <CheckinDoCliente clientes={clientes} aoAvisar={setRecado} />

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function CartaoDeTarefa({
  tarefa,
  nomeDoCliente,
  aoAtualizar,
  aoAvisar,
}: {
  tarefa: TarefaInternaNaLista
  nomeDoCliente: string | null
  aoAtualizar: (tarefa: TarefaInternaNaLista) => void
  aoAvisar: (recado: string) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [cancelando, setCancelando] = useState(false)

  async function mudarStatus(status: 'concluida' | 'cancelada') {
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<{ tarefa: TarefaInternaNaLista }>(`v1/carteira/tarefas-internas/${tarefa.id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      })
      aoAtualizar(r.tarefa)
      aoAvisar(status === 'concluida' ? `"${tarefa.titulo}" concluída.` : `"${tarefa.titulo}" cancelada.`)
      setCancelando(false)
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível atualizar a tarefa.')
    } finally {
      setEnviando(false)
    }
  }

  const atrasada = tarefa.status === 'pendente' && tarefa.prazo < hojeISO()

  return (
    <div className="carteira-card carteira-card-coluna">
      <div className="carteira-linha">
        <span className="carteira-nome">{tarefa.titulo}</span>
        {tarefa.prioridade === 'alta' ? <span className="pill mau">Alta prioridade</span> : null}
        {atrasada ? <span className="pill mau">Atrasada</span> : null}
      </div>
      <div className="carteira-linha muted">
        <span className="num">Prazo: {tarefa.prazo}</span>
        {tarefa.prioridade !== 'alta' ? <span>{RECADO_PRIORIDADE[tarefa.prioridade]}</span> : null}
        {nomeDoCliente ? <span>· Cliente: {nomeDoCliente}</span> : null}
      </div>
      {tarefa.descricao ? <p className="nota">{tarefa.descricao}</p> : null}

      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>

      {tarefa.status === 'pendente' ? (
        <div className="carteira-acoes">
          <button type="button" className="btn" disabled={enviando} onClick={() => void mudarStatus('concluida')}>
            {enviando ? 'Concluindo…' : 'Concluir'}
          </button>
          {cancelando ? (
            <span className="carteira-confirmar">
              Cancelar esta tarefa?
              <button type="button" className="btn ghost" disabled={enviando} onClick={() => void mudarStatus('cancelada')}>
                Confirmar
              </button>
              <button type="button" className="link" disabled={enviando} onClick={() => setCancelando(false)}>
                Voltar
              </button>
            </span>
          ) : (
            <button type="button" className="link" onClick={() => setCancelando(true)}>
              Cancelar
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

function hojeISO(): string {
  // Só para destacar visualmente uma tarefa atrasada na tela — NUNCA usado
  // para decidir negócio (regra 24): a recusa/aceite de qualquer ação
  // continua inteiramente do servidor, isto é maquiagem de leitura.
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function FormularioDeTarefa({
  dobra,
  clientes,
  aoCriar,
}: {
  dobra: React.RefObject<HTMLDetailsElement | null>
  clientes: ClienteCarteiraNaLista[]
  aoCriar: (tarefa: TarefaInternaNaLista) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({
    titulo: '',
    prazo: '',
    prioridade: 'normal' as PrioridadeDaTarefaInterna,
    descricao: '',
    clienteCarteiraId: '',
  })

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<{ tarefa: TarefaInternaNaLista }>('v1/carteira/tarefas-internas', {
        method: 'POST',
        body: JSON.stringify({
          titulo: form.titulo,
          prazo: form.prazo,
          prioridade: form.prioridade,
          descricao: form.descricao || undefined,
          clienteCarteiraId: form.clienteCarteiraId || undefined,
        }),
      })
      aoCriar(r.tarefa)
      setForm({ titulo: '', prazo: '', prioridade: 'normal', descricao: '', clienteCarteiraId: '' })
      if (dobra.current !== null) dobra.current.open = false
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="carteira-dobra" ref={dobra}>
      <summary>Criar tarefa</summary>
      <form className="carteira-form" onSubmit={criar}>
        <label className="campo">
          Título
          <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required />
        </label>

        <label className="campo">
          Prazo
          <input
            type="date"
            value={form.prazo}
            onChange={(e) => setForm({ ...form, prazo: e.target.value })}
            required
          />
        </label>

        <label className="campo">
          Prioridade
          <select
            value={form.prioridade}
            onChange={(e) => setForm({ ...form, prioridade: e.target.value as PrioridadeDaTarefaInterna })}
          >
            <option value="baixa">Baixa</option>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
          </select>
        </label>

        <details className="carteira-dobra carteira-dobra-mini">
          <summary>+ Mais opções</summary>
          <div className="carteira-form">
            <label className="campo">
              Descrição
              <textarea
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                rows={3}
              />
            </label>
            <label className="campo">
              Cliente relacionado
              <select
                value={form.clienteCarteiraId}
                onChange={(e) => setForm({ ...form, clienteCarteiraId: e.target.value })}
              >
                <option value="">Nenhum</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>

        <p role="alert" aria-live="polite" className="erro">
          {erro}
        </p>

        <button type="submit" disabled={enviando} className="btn">
          {enviando ? 'Criando…' : 'Criar tarefa'}
        </button>
      </form>
    </details>
  )
}

/**
 * **ROTINAS INTERNAS** — as definições recorrentes. Só leitura + criação
 * aqui: pausar/editar uma rotina fica para quando houver demanda (hoje a
 * equipe é pequena — spec §5, mesma régua de "sem fronteira extra sem
 * demonstração").
 */
function RotinasInternas({ aoAvisar }: { aoAvisar: (recado: string) => void }) {
  const [estado, setEstado] = useState<
    { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; itens: RotinaInternaNaLista[] }
  >({ tag: 'carregando' })
  const dobraCriar = useRef<HTMLDetailsElement>(null)
  const [form, setForm] = useState({
    titulo: '',
    frequencia: 'semanal' as FrequenciaDaRotinaInterna,
    escopoAplicacao: 'global' as 'global' | 'por_cliente',
    inicio: '',
    passos: '',
  })
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let valeu = true
    chamar<ListaDeRotinasInternasSaida>('v1/carteira/rotinas-internas')
      .then((r) => {
        if (valeu) setEstado({ tag: 'pronto', itens: r.rotinas })
      })
      .catch((e: unknown) => {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as rotinas.',
          })
        }
      })
    return () => {
      valeu = false
    }
  }, [])

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<{ rotina: RotinaInternaNaLista }>('v1/carteira/rotinas-internas', {
        method: 'POST',
        body: JSON.stringify({
          titulo: form.titulo,
          frequencia: form.frequencia,
          escopoAplicacao: form.escopoAplicacao,
          inicio: form.inicio,
          passos: form.passos
            .split('\n')
            .map((p) => p.trim())
            .filter((p) => p !== ''),
        }),
      })
      setEstado((s) => (s.tag === 'pronto' ? { tag: 'pronto', itens: [...s.itens, r.rotina] } : s))
      aoAvisar(`Rotina "${r.rotina.titulo}" criada.`)
      setForm({ titulo: '', frequencia: 'semanal', escopoAplicacao: 'global', inicio: '', passos: '' })
      if (dobraCriar.current !== null) dobraCriar.current.open = false
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="carteira-secao">
      <h2 className="carteira-secao-titulo">Rotinas internas</h2>
      <p className="nota">
        As definições que geram tarefa sozinhas — "ligar para cliente que não loga há 10 dias",
        "revisar o funil toda segunda".
      </p>

      {estado.tag === 'carregando' ? (
        <Carregando linhas={2} fino />
      ) : estado.tag === 'erro' ? (
        <p className="erro">{estado.mensagem}</p>
      ) : estado.itens.length === 0 ? (
        <p className="nota">Nenhuma rotina interna cadastrada ainda.</p>
      ) : (
        <div className="carteira-grade">
          {estado.itens.map((r) => (
            <div key={r.id} className="carteira-card carteira-card-coluna">
              <div className="carteira-linha">
                <span className="carteira-nome">{r.titulo}</span>
                <span className={r.ativa ? 'pill bom' : 'pill mau'}>{r.ativa ? 'Ativa' : 'Pausada'}</span>
              </div>
              <div className="carteira-linha muted">
                <span>{RECADO_FREQUENCIA[r.frequencia]}</span>
                <span>· {r.escopoAplicacao === 'global' ? 'Uma tarefa' : 'Uma por cliente'}</span>
                <span className="num">Desde {r.inicio}</span>
              </div>
              {r.passos.length > 0 ? (
                <p className="nota">{r.passos.length} passo(s) no checklist.</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <details className="carteira-dobra" ref={dobraCriar}>
        <summary>Criar rotina interna</summary>
        <form className="carteira-form" onSubmit={criar}>
          <label className="campo">
            Título
            <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} required />
          </label>
          <label className="campo">
            Frequência
            <select
              value={form.frequencia}
              onChange={(e) => setForm({ ...form, frequencia: e.target.value as FrequenciaDaRotinaInterna })}
            >
              {FREQUENCIAS_DA_ROTINA_INTERNA.map((f) => (
                <option key={f} value={f}>
                  {RECADO_FREQUENCIA[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Abrangência
            <select
              value={form.escopoAplicacao}
              onChange={(e) => setForm({ ...form, escopoAplicacao: e.target.value as 'global' | 'por_cliente' })}
            >
              {ESCOPOS_DE_APLICACAO.map((e) => (
                <option key={e} value={e}>
                  {e === 'global' ? 'Uma tarefa só' : 'Uma por cliente'}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Início
            <input
              type="date"
              value={form.inicio}
              onChange={(e) => setForm({ ...form, inicio: e.target.value })}
              required
            />
          </label>
          <details className="carteira-dobra carteira-dobra-mini">
            <summary>+ Mais opções</summary>
            <label className="campo">
              Passos do checklist (um por linha)
              <textarea
                value={form.passos}
                onChange={(e) => setForm({ ...form, passos: e.target.value })}
                rows={3}
              />
            </label>
          </details>
          <p role="alert" aria-live="polite" className="erro">
            {erro}
          </p>
          <button type="submit" disabled={enviando} className="btn">
            {enviando ? 'Criando…' : 'Criar rotina'}
          </button>
        </form>
      </details>
    </section>
  )
}

/**
 * **CHECKIN INTERNO** — qualitativo (spec §4): nota + leitura de saúde, sem
 * número de meta. Um por cliente por semana (o servidor resolve a semana —
 * regra 24, nunca o relógio do cliente); reenviar na mesma semana
 * ATUALIZA o checkin existente, não duplica.
 */
function CheckinDoCliente({
  clientes,
  aoAvisar,
}: {
  clientes: ClienteCarteiraNaLista[]
  aoAvisar: (recado: string) => void
}) {
  const [clienteId, setClienteId] = useState('')
  const [nota, setNota] = useState('')
  const [saude, setSaude] = useState<SaudeDoCliente>('bom')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [historico, setHistorico] = useState<CheckinInternoNaLista[] | null>(null)

  useEffect(() => {
    if (clienteId === '') {
      setHistorico(null)
      return
    }
    let valeu = true
    chamar<ListaDeCheckinsInternosSaida>(`v1/carteira/clientes/${clienteId}/checkins`)
      .then((r) => {
        if (valeu) setHistorico(r.checkins)
      })
      .catch(() => {
        if (valeu) setHistorico(null)
      })
    return () => {
      valeu = false
    }
  }, [clienteId])

  async function registrar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      await chamar<{ checkin: CheckinInternoNaLista }>('v1/carteira/checkins-internos', {
        method: 'POST',
        body: JSON.stringify({ clienteCarteiraId: clienteId, nota, saude }),
      })
      aoAvisar('Checkin registrado.')
      setNota('')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  const pillDaSaude = (s: SaudeDoCliente): string =>
    s === 'bom' ? 'pill bom' : s === 'critico' ? 'pill mau' : 'pill alerta'

  return (
    <section className="carteira-secao">
      <h2 className="carteira-secao-titulo">Checkin da semana</h2>
      <p className="nota">
        O ritual de olhar para cada cliente — nota e uma leitura de saúde, sem número de meta.
      </p>

      {clientes.length === 0 ? (
        <p className="nota">Nenhum cliente visível ainda para registrar um checkin.</p>
      ) : (
        <form className="carteira-form" onSubmit={registrar}>
          <label className="campo">
            Cliente
            <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} required>
              <option value="" disabled>
                Escolha o cliente
              </option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>

          {historico !== null && historico.length > 0 ? (
            <p className="nota">
              Último checkin ({historico[0]!.semana}):{' '}
              <span className={pillDaSaude(historico[0]!.saude)}>{RECADO_SAUDE[historico[0]!.saude]}</span>
            </p>
          ) : null}

          <label className="campo">
            Nota
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} required />
          </label>

          <label className="campo">
            Saúde do cliente
            <select value={saude} onChange={(e) => setSaude(e.target.value as SaudeDoCliente)}>
              {SAUDES_DO_CLIENTE.map((s) => (
                <option key={s} value={s}>
                  {RECADO_SAUDE[s]}
                </option>
              ))}
            </select>
          </label>

          <p role="alert" aria-live="polite" className="erro">
            {erro}
          </p>

          <button type="submit" disabled={enviando || clienteId === ''} className="btn">
            {enviando ? 'Registrando…' : 'Registrar checkin'}
          </button>
        </form>
      )}
    </section>
  )
}
