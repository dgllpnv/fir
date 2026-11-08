'use client'

import {
  type AnexoPorLink,
  CODIGO_CONTAGEM_MUDOU,
  CODIGO_MOTIVO_DO_DESCOMPARTILHAMENTO,
  type CompartilhamentoMudadoSaida,
  type CompartilharTodasSaida,
  type ReuniaoNaLista,
  type ReuniaoRegistradaSaida,
  type ReuniaoSaida,
  type ReunioesDoClienteSaida,
  TIPOS_DE_REUNIAO_DO_FORMULARIO,
} from '@fir/contracts'
import { somarDias } from '@fir/domain'
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { ModalImportarDoAsana, recadoDaImportacao } from './importar-do-asana'

/**
 * **A aba "Reuniões" da ficha do cliente** (`cReunioes`, `abrirReuniao`,
 * `salvarReuniao`, protótipo L1654–1712, L1813–1820, L2843–2844; G8 1B,
 * V14). Componente pronto para a ficha em abas (1A) montar.
 *
 * O que muda em relação ao protótipo, e por quê:
 *  - "Notas internas": campo a mais, que NUNCA vai ao portal (gate LGPD §3,
 *    recomendação). O protótipo manda o resumo inteiro à cliente.
 *  - Aviso fixo do gate LGPD A9 no formulário, e "Esta ata está visível para a
 *    cliente" na edição de uma ata compartilhada.
 *  - Descompartilhar depois de a cliente ter aberto o espaço dela pede motivo
 *    (LGPD A10) — o servidor decide e a tela pergunta.
 *  - "Compartilhar todas" confirma com a contagem e separa as importadas do
 *    Asana numa segunda marcação (LGPD A8).
 *  - "Excluir" vira arquivar (regra 20).
 *  - Anexo por link nesta fatia; o de arquivo entra pelo `slotDeAnexos`
 *    (componente de anexos do ticket 4C) quando a ficha o passar.
 *  - "Importar do Asana" é do ticket 4B.
 */

const ROTULO_TIPO: Record<ReuniaoNaLista['tipo'], string> = {
  semanal: 'Semanal',
  mensal: 'Mensal',
  diagnostico: 'Diagnóstico',
  extra: 'Avulsa',
  importada: 'Do Asana',
}
const ROTULO_SAUDE: Record<'bom' | 'atencao' | 'critico', string> = {
  bom: 'Bom',
  atencao: 'Atenção',
  critico: 'Crítico',
}
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

const diaEMes = (dia: string): string => `${dia.slice(8, 10)} ${MESES[Number(dia.slice(5, 7)) - 1] ?? ''}`

/** O nome do link na lista: o endereço sem o protocolo, curto — nunca buscado (LGPD A11). */
const nomeDoLink = (url: string): string => url.replace(/^https:\/\//, '').slice(0, 60)

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; dados: ReunioesDoClienteSaida }

type Props = {
  clienteId: string
  /**
   * O componente de anexos de ARQUIVO (`components/carteira/anexos.tsx`, 4C),
   * quando existir. A ficha passa `(id) => <Anexos donoTipo="reuniao" donoId={id} />`.
   */
  slotDeAnexos?: (reuniaoId: string) => ReactNode
  /** A ficha abre a aba já no formulário quando vem de "Registrar reunião" do cabeçalho (L1398). */
  registrarAoAbrir?: boolean
}

export function ReunioesDoCliente({ clienteId, slotDeAnexos, registrarAoAbrir = false }: Props) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<{ tag: 'novo' } | { tag: 'editar'; reuniao: ReuniaoNaLista } | null>(
    registrarAoAbrir ? { tag: 'novo' } : null,
  )

  const recarregar = () => setTentativa((n) => n + 1)
  const [importando, setImportando] = useState(false)
  // Estável: o Modal refaz o efeito quando `aoFechar` muda.
  const fecharImportacao = useCallback(() => setImportando(false), [])

  useEffect(() => {
    let valeu = true
    void (async () => {
      try {
        const dados = await chamar<ReunioesDoClienteSaida>(`v1/carteira/clientes/${encodeURIComponent(clienteId)}/reunioes`)
        if (valeu) setEstado({ tag: 'pronto', dados })
      } catch (e) {
        if (valeu) {
          setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as reuniões.' })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [clienteId, tentativa])

  if (estado.tag === 'carregando') return <Carregando linhas={4} />
  if (estado.tag === 'erro') {
    return (
      <div className="carteira-erro" role="alert">
        <p>{estado.mensagem}</p>
        <div className="carteira-erro-acoes">
          <button type="button" className="btn" onClick={recarregar}>
            Tentar de novo
          </button>
        </div>
      </div>
    )
  }

  const { dados } = estado
  const aoSalvar = (texto: string) => {
    setFormulario(null)
    setRecado(texto)
    recarregar()
  }

  return (
    <section className="conteudo-painel" aria-labelledby="conteudo-reunioes-titulo">
      <div className="conteudo-cabeca">
        <h2 id="conteudo-reunioes-titulo" className="conteudo-titulo">
          Reuniões e acompanhamento
        </h2>
        <div className="conteudo-acoes">
          {dados.podeAdministrar && dados.pendentesDeCompartilhar.comuns + dados.pendentesDeCompartilhar.importadas > 0 ? (
            <CompartilharTodas clienteId={clienteId} pendentes={dados.pendentesDeCompartilhar} aoTerminar={aoSalvar} />
          ) : null}
          <button type="button" className="btn" onClick={() => setFormulario({ tag: 'novo' })} disabled={formulario !== null}>
            Registrar reunião
          </button>
          <button type="button" className="btn ghost" onClick={() => setImportando(true)} disabled={formulario !== null}>
            Importar do Asana
          </button>
        </div>
      </div>

      {importando ? (
        <ModalImportarDoAsana
          clienteId={clienteId}
          aoFechar={fecharImportacao}
          aoImportar={(r) => {
            fecharImportacao()
            setRecado(recadoDaImportacao(r))
            recarregar()
          }}
        />
      ) : null}

      {formulario?.tag === 'novo' ? (
        <FormularioDeReuniao
          clienteId={clienteId}
          dados={dados}
          reuniao={null}
          aoSalvar={aoSalvar}
          aoCancelar={() => setFormulario(null)}
        />
      ) : null}

      {dados.reunioes.length === 0 && formulario === null ? (
        <p className="vazio">Nenhuma reunião registrada. Registre a primeira para guardar o que foi combinado com a cliente.</p>
      ) : null}

      <ol className="conteudo-linha-do-tempo">
        {dados.reunioes.map((r) =>
          formulario?.tag === 'editar' && formulario.reuniao.id === r.id ? (
            <li key={r.id}>
              <FormularioDeReuniao
                clienteId={clienteId}
                dados={dados}
                reuniao={r}
                aoSalvar={aoSalvar}
                aoCancelar={() => setFormulario(null)}
              />
            </li>
          ) : (
            <li key={r.id} className="conteudo-reuniao">
              <div className="conteudo-reuniao-data">
                <b className="num">{diaEMes(r.data)}</b>
                <span>{ROTULO_TIPO[r.tipo]}</span>
              </div>
              <div className="conteudo-reuniao-corpo">
                <div className="conteudo-reuniao-meta">
                  {r.saudeRegistrada !== null ? (
                    <span className={`conteudo-chip conteudo-saude-${r.saudeRegistrada}`}>{ROTULO_SAUDE[r.saudeRegistrada]}</span>
                  ) : null}
                  <span className="conteudo-mudo">
                    por {r.registradaPor.nome}
                    {r.participantes ? ` · com ${r.participantes}` : ''}
                  </span>
                  {r.compartilhada ? <span className="conteudo-chip conteudo-chip-ouro">compartilhada com a cliente</span> : null}
                </div>
                <p className="conteudo-texto">{r.resumo}</p>
                {r.encaminhamentos ? (
                  <p className="conteudo-texto conteudo-mudo">
                    <b className="conteudo-rotulo">Encaminhamentos:</b> {r.encaminhamentos}
                  </p>
                ) : null}
                {r.notasInternas ? (
                  <p className="conteudo-texto conteudo-interno">
                    <b className="conteudo-rotulo">Só para a equipe:</b> {r.notasInternas}
                  </p>
                ) : null}
                {r.tarefas.total > 0 ? (
                  <p className="conteudo-mudo num">
                    {r.tarefas.concluidas} de {r.tarefas.total} tarefas da reunião concluídas
                  </p>
                ) : null}
                {r.anexos.length > 0 ? <ListaDeLinks anexos={r.anexos} /> : null}
                {slotDeAnexos ? slotDeAnexos(r.id) : null}
                <div className="conteudo-reuniao-acoes">
                  <AlternarCompartilhamento reuniao={r} aoMudar={aoSalvar} />
                  <button type="button" className="link" onClick={() => setFormulario({ tag: 'editar', reuniao: r })} disabled={formulario !== null}>
                    Editar e anexar
                  </button>
                </div>
              </div>
            </li>
          ),
        )}
      </ol>
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function ListaDeLinks({ anexos }: { anexos: readonly AnexoPorLink[] }) {
  return (
    <ul className="conteudo-anexos">
      {anexos.map((a) => (
        <li key={a.url}>
          <a className="link" href={a.url} target="_blank" rel="noopener noreferrer">
            {a.nome}
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * Compartilhar / "Deixar só para a equipe". Se o servidor responder que a
 * cliente já abriu o espaço depois do compartilhamento (LGPD A10), pede o
 * motivo aqui mesmo e reenvia com ele.
 */
function AlternarCompartilhamento({ reuniao, aoMudar }: { reuniao: ReuniaoNaLista; aoMudar: (t: string) => void }) {
  const [pedindoMotivo, setPedindoMotivo] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  const enviar = async (comMotivo?: string) => {
    setEnviando(true)
    setErro(null)
    try {
      const r = await chamar<CompartilhamentoMudadoSaida>(`v1/carteira/reunioes/${reuniao.id}/compartilhamento`, {
        method: 'POST',
        body: JSON.stringify({ compartilhada: !reuniao.compartilhada, ...(comMotivo ? { motivo: comMotivo } : {}) }),
      })
      setPedindoMotivo(false)
      aoMudar(
        r.reuniao.compartilhada
          ? 'Reunião visível no espaço da cliente.'
          : r.reversaoAposLeitura
            ? 'Reunião só para a equipe. O motivo ficou registrado.'
            : 'Reunião só para a equipe.',
      )
    } catch (e) {
      if (e instanceof ErroDaApi && e.codigo === CODIGO_MOTIVO_DO_DESCOMPARTILHAMENTO) {
        setPedindoMotivo(true)
        setErro(e.message)
      } else {
        setErro(e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.')
      }
    } finally {
      setEnviando(false)
    }
  }

  if (pedindoMotivo) {
    return (
      <form
        className="conteudo-motivo"
        onSubmit={(e) => {
          e.preventDefault()
          void enviar(motivo.trim())
        }}
      >
        <p role="alert" className="conteudo-aviso">
          {erro}
        </p>
        <label className="campo">
          Motivo
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={1000} required rows={2} />
        </label>
        <div className="conteudo-acoes">
          <button type="submit" className="btn" disabled={enviando || motivo.trim().length < 3}>
            Deixar só para a equipe
          </button>
          <button type="button" className="btn ghost" onClick={() => setPedindoMotivo(false)}>
            Cancelar
          </button>
        </div>
      </form>
    )
  }

  return (
    <>
      <button type="button" className="link" onClick={() => void enviar()} disabled={enviando}>
        {reuniao.compartilhada ? 'Deixar só para a equipe' : 'Compartilhar com a cliente'}
      </button>
      {erro ? (
        <span role="alert" className="conteudo-aviso">
          {erro}
        </span>
      ) : null}
    </>
  )
}

/**
 * "Compartilhar todas" (L2844): o primeiro toque mostra a contagem; o segundo
 * confirma. As importadas do Asana ficam de fora, salvo a segunda marcação
 * (LGPD A8). O servidor recusa se a contagem confirmada mudou.
 */
function CompartilharTodas({
  clienteId,
  pendentes,
  aoTerminar,
}: {
  clienteId: string
  pendentes: { comuns: number; importadas: number }
  aoTerminar: (t: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const [comImportadas, setComImportadas] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const total = pendentes.comuns + (comImportadas ? pendentes.importadas : 0)

  const confirmar = async () => {
    setErro(null)
    try {
      const r = await chamar<CompartilharTodasSaida>(
        `v1/carteira/clientes/${encodeURIComponent(clienteId)}/reunioes/compartilhar-todas`,
        { method: 'POST', body: JSON.stringify({ incluirImportadas: comImportadas, esperadas: total }) },
      )
      setAberto(false)
      aoTerminar(
        r.compartilhadas === 1 ? '1 reunião compartilhada com a cliente.' : `${r.compartilhadas} reuniões compartilhadas com a cliente.`,
      )
    } catch (e) {
      if (e instanceof ErroDaApi && e.codigo === CODIGO_CONTAGEM_MUDOU) aoTerminar(e.message)
      else setErro(e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.')
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="btn ghost" onClick={() => setAberto(true)}>
        Compartilhar todas
      </button>
    )
  }
  return (
    <div className="conteudo-confirmar" role="group" aria-label="Confirmar compartilhamento">
      <span>O resumo, os encaminhamentos e os anexos aparecem para a cliente.</span>
      {pendentes.importadas > 0 ? (
        <label className="conteudo-marcar">
          <input type="checkbox" checked={comImportadas} onChange={(e) => setComImportadas(e.target.checked)} />
          Incluir também {pendentes.importadas === 1 ? 'a reunião importada' : `as ${pendentes.importadas} importadas`} do Asana (podem ter comentários internos)
        </label>
      ) : null}
      <div className="conteudo-acoes">
        <button type="button" className="btn" onClick={() => void confirmar()} disabled={total === 0}>
          Confirmar: compartilhar <span className="num">{total}</span>
        </button>
        <button type="button" className="btn ghost" onClick={() => setAberto(false)}>
          Cancelar
        </button>
      </div>
      {erro ? (
        <p role="alert" className="conteudo-aviso">
          {erro}
        </p>
      ) : null}
    </div>
  )
}

type Campos = {
  data: string
  tipo: (typeof TIPOS_DE_REUNIAO_DO_FORMULARIO)[number]
  participantes: string
  resumo: string
  encaminhamentos: string
  notasInternas: string
  saudeRegistrada: 'bom' | 'atencao' | 'critico'
  anexos: AnexoPorLink[]
  compartilhar: boolean
  criarTarefas: boolean
  responsavel: string
  prazo: string
}

function FormularioDeReuniao({
  clienteId,
  dados,
  reuniao,
  aoSalvar,
  aoCancelar,
}: {
  clienteId: string
  dados: ReunioesDoClienteSaida
  reuniao: ReuniaoNaLista | null
  aoSalvar: (t: string) => void
  aoCancelar: () => void
}) {
  // A chave nasce com o formulário (A-20): o duplo clique e o retry de rede
  // reenviam a MESMA chave, e o servidor devolve a ata já criada.
  const chave = useMemo(() => crypto.randomUUID(), [])
  const hoje = somarDias(dados.prazoPadrao, -7)
  const [f, setF] = useState<Campos>(() => ({
    data: reuniao?.data ?? hoje,
    tipo: reuniao && reuniao.tipo !== 'importada' ? reuniao.tipo : 'extra',
    participantes: reuniao?.participantes ?? '',
    resumo: reuniao?.resumo ?? '',
    encaminhamentos: reuniao?.encaminhamentos ?? '',
    notasInternas: reuniao?.notasInternas ?? '',
    saudeRegistrada: reuniao?.saudeRegistrada ?? dados.saudeAtual ?? 'bom',
    anexos: reuniao?.anexos ?? [],
    compartilhar: false,
    criarTarefas: true,
    responsavel: dados.responsaveis[0]?.id ?? '',
    prazo: dados.prazoPadrao,
  }))
  const [link, setLink] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)

  const adicionarLink = () => {
    const url = link.trim()
    if (!url.toLowerCase().startsWith('https://')) {
      setErro('O link precisa começar com https://')
      return
    }
    if (f.anexos.some((a) => a.url === url)) return
    setF({ ...f, anexos: [...f.anexos, { nome: nomeDoLink(url), url }] })
    setLink('')
    setErro(null)
  }

  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    const comum = {
      data: f.data,
      tipo: f.tipo,
      participantes: f.participantes,
      resumo: f.resumo,
      encaminhamentos: f.encaminhamentos,
      notasInternas: f.notasInternas,
      saudeRegistrada: f.saudeRegistrada,
      anexos: f.anexos,
    }
    try {
      if (reuniao === null) {
        const r = await chamar<ReuniaoRegistradaSaida>(`v1/carteira/clientes/${encodeURIComponent(clienteId)}/reunioes`, {
          method: 'POST',
          body: JSON.stringify({
            chaveIdempotencia: chave,
            ...comum,
            compartilhada: f.compartilhar,
            tarefas: f.criarTarefas && f.responsavel ? { responsavelUsuarioGestaoId: f.responsavel, prazo: f.prazo } : null,
          }),
        })
        const quem = dados.responsaveis.find((p) => p.id === f.responsavel)?.nome ?? ''
        aoSalvar(
          r.tarefasCriadas > 0
            ? `Reunião registrada e ${r.tarefasCriadas} ${r.tarefasCriadas === 1 ? 'tarefa' : 'tarefas'} para ${quem}.`
            : 'Reunião registrada.',
        )
      } else {
        await chamar<ReuniaoSaida>(`v1/carteira/reunioes/${reuniao.id}`, { method: 'PATCH', body: JSON.stringify(comum) })
        aoSalvar('Reunião atualizada.')
      }
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  const arquivar = async () => {
    if (reuniao === null) return
    if (!confirmandoExclusao) {
      setConfirmandoExclusao(true)
      return
    }
    try {
      await chamar<void>(`v1/carteira/reunioes/${reuniao.id}/arquivar`, { method: 'POST' })
      aoSalvar('Reunião excluída.')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    }
  }

  return (
    <form className="conteudo-form" onSubmit={salvar} aria-label={reuniao ? 'Editar reunião' : 'Registrar reunião'}>
      <h3 className="conteudo-subtitulo">{reuniao ? 'Editar reunião' : 'Registrar reunião'}</h3>
      {reuniao?.compartilhada ? <p className="conteudo-chip conteudo-chip-ouro">Esta ata está visível para a cliente</p> : null}
      <p className="conteudo-aviso-fixo">
        Se compartilhar, o resumo, os encaminhamentos e os anexos aparecem para a cliente. Não escreva nome de paciente.
      </p>
      <div className="conteudo-duas">
        <label className="campo">
          Data
          <input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} required />
        </label>
        <label className="campo">
          Tipo
          <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as Campos['tipo'] })}>
            {TIPOS_DE_REUNIAO_DO_FORMULARIO.map((t) => (
              <option key={t} value={t}>
                {t === 'extra' ? 'Avulsa, sem agendamento' : ROTULO_TIPO[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="campo">
        Quem participou
        <input
          value={f.participantes}
          onChange={(e) => setF({ ...f, participantes: e.target.value })}
          placeholder="Ex.: Dra. Ana, gerente, recepção, Duda"
          maxLength={500}
        />
      </label>
      <label className="campo">
        O que foi visto
        <textarea value={f.resumo} onChange={(e) => setF({ ...f, resumo: e.target.value })} required maxLength={4000} rows={4} />
      </label>
      <label className="campo">
        Encaminhamentos
        <textarea
          value={f.encaminhamentos}
          onChange={(e) => setF({ ...f, encaminhamentos: e.target.value })}
          placeholder="Um por linha"
          maxLength={4000}
          rows={3}
        />
      </label>
      {reuniao === null ? (
        <div className="conteudo-tarefas">
          <label className="conteudo-marcar">
            <input type="checkbox" checked={f.criarTarefas} onChange={(e) => setF({ ...f, criarTarefas: e.target.checked })} />
            Criar uma tarefa para cada linha
          </label>
          {f.criarTarefas ? (
            <div className="conteudo-duas">
              <label className="campo">
                Responsável pelas tarefas
                <select value={f.responsavel} onChange={(e) => setF({ ...f, responsavel: e.target.value })}>
                  {dados.responsaveis.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                Prazo das tarefas
                <input type="date" value={f.prazo} onChange={(e) => setF({ ...f, prazo: e.target.value })} required />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}
      <label className="campo">
        Saúde da cliente depois da reunião
        <select
          value={f.saudeRegistrada}
          onChange={(e) => setF({ ...f, saudeRegistrada: e.target.value as Campos['saudeRegistrada'] })}
        >
          <option value="bom">Bom</option>
          <option value="atencao">Atenção</option>
          <option value="critico">Crítico</option>
        </select>
      </label>
      <details className="carteira-dobra carteira-dobra-mini" open={f.notasInternas !== ''}>
        <summary>+ Notas só para a equipe</summary>
        <label className="campo">
          Notas internas (nunca aparecem para a cliente)
          <textarea
            value={f.notasInternas}
            onChange={(e) => setF({ ...f, notasInternas: e.target.value })}
            maxLength={4000}
            rows={3}
          />
        </label>
      </details>
      {reuniao === null ? (
        <label className="conteudo-marcar">
          <input type="checkbox" checked={f.compartilhar} onChange={(e) => setF({ ...f, compartilhar: e.target.checked })} />
          <span>
            Compartilhar com a cliente
            <small className="conteudo-mudo conteudo-bloco">O resumo, os encaminhamentos e os anexos aparecem no espaço dela.</small>
          </span>
        </label>
      ) : null}
      <fieldset className="conteudo-fieldset">
        <legend>Anexos</legend>
        {f.anexos.length > 0 ? (
          <ul className="conteudo-anexos">
            {f.anexos.map((a) => (
              <li key={a.url}>
                {a.nome}{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => setF({ ...f, anexos: f.anexos.filter((x) => x.url !== a.url) })}
                  aria-label={`Remover ${a.nome}`}
                >
                  remover
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="conteudo-linha-de-link">
          <input
            aria-label="Link do anexo"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="Cole um link (Drive, Docs, gravação)"
            inputMode="url"
          />
          <button type="button" className="btn ghost" onClick={adicionarLink}>
            Adicionar link
          </button>
        </div>
        <small className="conteudo-mudo">O link precisa estar compartilhado só com quem deve ver.</small>
      </fieldset>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
      <div className="conteudo-acoes">
        {reuniao !== null && dados.podeAdministrar ? (
          <button type="button" className="btn ghost conteudo-perigo" onClick={() => void arquivar()}>
            {confirmandoExclusao ? 'Toque de novo para excluir' : 'Excluir'}
          </button>
        ) : null}
        <span className="conteudo-espaco" />
        <button type="button" className="btn ghost" onClick={aoCancelar}>
          Cancelar
        </button>
        <button type="submit" className="btn" disabled={enviando}>
          {enviando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </form>
  )
}
