'use client'

import type {
  CampanhasVinculaveis,
  FichaDoPaciente,
  ListaDeUnidades,
  PacienteNaLista,
  TRespostaDaBusca,
} from '@fir/contracts'
import { ORIGEM_INDICACAO, ORIGENS } from '@fir/contracts'
import { useId, useState } from 'react'
import { chamar } from '@/lib/api'
import { consultaEmTexto, useDados, useEspera } from '@/lib/dados'

/**
 * O que o formulário sabe de quem está editando. A ficha passa o que ela tem;
 * os vínculos (indicadora, campanha) só existem na ficha — a lista não os
 * carrega (LGPD L-B2-6).
 */
type CadastroEmEdicao = PacienteNaLista &
  Partial<Pick<FichaDoPaciente, 'indicadora' | 'indicadaPorPaciente' | 'campanhaId'>>

/**
 * Cadastrar e editar paciente — UM formulário.
 *
 * Ele aparece em três lugares: no seletor de "Nova tarefa", na tela Pacientes
 * e na ficha. Com três cópias, a regra do "Indicado por" some de uma delas e
 * ninguém descobre até a próxima campanha agradecer a quem nunca indicou.
 *
 * `completo` é a única diferença: no seletor a pessoa está AGENDANDO, e última
 * consulta e observação seriam dois campos entre ela e a agenda. O resto é
 * idêntico, inclusive quem decide sobre `indicadoPor` — o contrato
 * (`limparIndicacao`) e o domínio (`decidirIndicacao`), nunca esta tela.
 */
export function FormularioDePaciente({
  paciente,
  completo,
  rotuloSalvar,
  aoSalvar,
  aoCancelar,
  nomeInicial,
}: {
  /** `null` cria; preenchido edita. */
  paciente: CadastroEmEdicao | null
  completo: boolean
  rotuloSalvar: string
  aoSalvar: (p: PacienteNaLista) => void
  aoCancelar: () => void
  /** O que já foi digitado na busca, quando o cadastro nasce dela. */
  nomeInicial?: string
}) {
  const [nome, setNome] = useState(paciente?.nome ?? nomeInicial ?? '')
  const [telefone, setTelefone] = useState(paciente?.telefone ?? '')
  const [aniversario, setAniversario] = useState(paciente?.aniversario ?? '')
  const [origem, setOrigem] = useState(paciente?.origem ?? '')
  const [indicacao, setIndicacao] = useState<Indicacao>(() => indicacaoInicial(paciente))
  const [campanhaId, setCampanhaId] = useState(paciente?.campanhaId ?? '')
  const [unidadeId, setUnidadeId] = useState(paciente?.unidadeId ?? '')
  const [ultimaConsulta, setUltimaConsulta] = useState(paciente?.ultimaConsulta ?? '')
  const [obs, setObs] = useState(paciente?.obs ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const unidades = useDados<ListaDeUnidades>('v1/unidades')
  const ativas = (unidades.dados?.unidades ?? []).filter(
    (u) => u.ativa || u.id === paciente?.unidadeId,
  )

  /**
   * "Chegou por uma campanha?" — **só as em andamento hoje**, decididas no
   * servidor no fuso da clínica (`contexto=paciente`). `incluir` traz a
   * campanha que ela já tem, mesmo encerrada: sem a opção, o select mostraria
   * "Não" e a edição soltaria a campanha sem ninguém pedir (N-4).
   */
  const atualDaCampanha = paciente?.campanhaId ?? null
  const campanhas = useDados<CampanhasVinculaveis>(
    `v1/campanhas/vinculaveis${consultaEmTexto({
      contexto: 'paciente',
      incluir: atualDaCampanha ?? undefined,
    })}`,
  )
  const opcoesDeCampanha = campanhas.dados?.itens ?? []

  async function salvar() {
    if (nome.trim() === '') {
      setErro('Informe o nome da paciente.')
      return
    }
    setErro(null)
    setSalvando(true)
    try {
      const corpo = {
        nome: nome.trim(),
        telefone: telefone.trim(),
        aniversario: aniversario === '' ? null : aniversario,
        origem,
        ...corpoDaIndicacao(indicacao, paciente !== null),
        // Na edição, só manda a campanha quando ela mudou: ausente mantém.
        ...(paciente !== null && campanhaId === (atualDaCampanha ?? '')
          ? {}
          : { campanhaId: campanhaId === '' ? null : campanhaId }),
        unidadeId: unidadeId === '' ? null : unidadeId,
        ultimaConsulta: ultimaConsulta === '' ? null : ultimaConsulta,
        obs: obs.trim(),
      }
      const salvo = await chamar<PacienteNaLista>(
        paciente === null ? 'v1/pacientes' : `v1/pacientes/${paciente.id}`,
        { method: paciente === null ? 'POST' : 'PATCH', body: JSON.stringify(corpo) },
      )
      aoSalvar(salvo)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui salvar o cadastro.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="painel" role="group" aria-label={paciente === null ? 'Nova paciente' : 'Editar cadastro'}>
      <b>{paciente === null ? 'Nova paciente' : 'Editar cadastro'}</b>

      <label className="campo">
        Nome completo
        <input value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
      </label>

      <div className="par">
        <label className="campo">
          Telefone
          <input
            type="tel"
            inputMode="tel"
            placeholder="(71) 99999-0000"
            value={telefone}
            maxLength={30}
            onChange={(e) => setTelefone(e.target.value)}
          />
        </label>
        <label className="campo">
          Aniversário <small>(opcional)</small>
          <input type="date" value={aniversario} onChange={(e) => setAniversario(e.target.value)} />
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Origem
          <select value={origem} onChange={(e) => setOrigem(e.target.value)}>
            <option value="">Selecione</option>
            {ORIGENS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
            {origem !== '' && !ORIGENS.some((o) => o === origem) ? (
              <option value={origem}>{origem}</option>
            ) : null}
          </select>
        </label>
        {origem !== ORIGEM_INDICACAO ? null : (
          <CampoIndicadoPor
            proprioId={paciente?.id ?? null}
            valor={indicacao}
            aoMudar={setIndicacao}
          />
        )}
      </div>

      {/* Como no protótipo (`campAtivasHoje().length ? … : ""`): sem campanha
          em andamento, o campo não existe — e a edição não manda nada. */}
      {opcoesDeCampanha.length === 0 ? null : (
        <label className="campo">
          Chegou por uma campanha? <small>(opcional)</small>
          <select value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)}>
            <option value="">Não</option>
            {opcoesDeCampanha.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      {ativas.length === 0 ? null : (
        <label className="campo">
          Unidade principal <small>(opcional)</small>
          <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">Sem unidade</option>
            {ativas.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      {completo ? (
        <>
          <label className="campo">
            Data da última consulta <small>(opcional · de antes de usar a ferramenta)</small>
            <input
              type="date"
              value={ultimaConsulta}
              onChange={(e) => setUltimaConsulta(e.target.value)}
            />
          </label>
          <label className="campo">
            Observação <small>(opcional · nada de dado clínico)</small>
            <textarea
              maxLength={300}
              style={{ minHeight: 56 }}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
            />
          </label>
        </>
      ) : null}

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Salvando…' : rotuloSalvar}
        </button>
        <button type="button" className="btn ghost" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// "INDICADO POR" (correções da PO, B2)
// ---------------------------------------------------------------------------

/**
 * O estado do campo — três formas, e a tela nunca mistura duas:
 *
 *  - `paciente`: a indicadora está no cadastro, ligada pelo id;
 *  - `paciente-oculta`: há indicadora ligada, mas ela foi desativada — a
 *    ficha não manda nome nem id dela (L-B2-6), e a tela não inventa;
 *  - `texto`: nome livre de quem indicou sem ser paciente (ou vazio).
 *
 * `mexeu` diz se a pessoa trocou o vínculo. Sem ele, a edição mandaria
 * `indicadoPorId: null` toda vez que a indicadora estivesse oculta, e
 * salvar o telefone desfaria a indicação.
 */
type Indicacao =
  | { readonly forma: 'paciente'; readonly id: string; readonly nome: string; readonly mexeu: boolean }
  | { readonly forma: 'paciente-oculta' }
  | { readonly forma: 'texto'; readonly texto: string; readonly mexeu: boolean }

function indicacaoInicial(p: CadastroEmEdicao | null): Indicacao {
  if (p?.indicadora) return { forma: 'paciente', ...p.indicadora, mexeu: false }
  if (p?.indicadaPorPaciente === true) return { forma: 'paciente-oculta' }
  return { forma: 'texto', texto: p?.indicadoPor ?? '', mexeu: false }
}

/**
 * O pedaço do corpo que fala da indicação.
 *
 * No cadastro, manda sempre os dois. Na edição, o id só vai quando o vínculo
 * mudou (três estados: ausente mantém). O texto vai sempre que a forma é
 * texto — e o domínio solta o id quando ele vem preenchido.
 */
function corpoDaIndicacao(
  i: Indicacao,
  editando: boolean,
): { indicadoPor?: string; indicadoPorId?: string | null } {
  switch (i.forma) {
    case 'paciente':
      return !editando || i.mexeu ? { indicadoPor: '', indicadoPorId: i.id } : { indicadoPor: '' }
    case 'paciente-oculta':
      return {}
    case 'texto':
      return !editando || i.mexeu
        ? { indicadoPor: i.texto.trim(), indicadoPorId: null }
        : { indicadoPor: i.texto.trim() }
  }
}

/**
 * O autocomplete ENXUTO — e não o `SeletorDePaciente`.
 *
 * Aquele embute o cadastro de paciente nova, e este formulário É o cadastro:
 * usá-lo aqui seria o formulário dentro do formulário. A busca é a mesma
 * (`GET /v1/busca-de-pacientes`, sem alargar a rota — S-35), mas o
 * **telefone não é desenhado** (L-B2-5): o nome já é único por clínica, e a
 * recepção não precisa do telefone de uma terceira para dizer quem indicou.
 *
 * O texto livre continua valendo: quem digita e não escolhe da lista
 * registra alguém que não é paciente.
 */
function CampoIndicadoPor({
  proprioId,
  valor,
  aoMudar,
}: {
  proprioId: string | null
  valor: Indicacao
  aoMudar: (i: Indicacao) => void
}) {
  const dicaId = useId()
  const digitado = valor.forma === 'texto' ? valor.texto : ''
  const q = useEspera(digitado.trim(), 250)
  const [fechou, setFechou] = useState(false)
  const achados = useDados<TRespostaDaBusca>(
    valor.forma === 'texto' && !fechou && q.length >= 2
      ? `v1/busca-de-pacientes${consultaEmTexto({ termo: q })}`
      : null,
  )
  // Ela mesma não aparece: ninguém indica a si mesma (o servidor também recusa).
  const lista = (achados.dados?.itens ?? []).filter((p) => p.id !== proprioId).slice(0, 6)

  if (valor.forma !== 'texto') {
    return (
      <div className="campo">
        Indicado por
        <div className="escolhido">
          <div>
            <b>{valor.forma === 'paciente' ? valor.nome : 'Uma paciente'}</b>
            <small style={{ color: 'var(--muted)' }}>
              {valor.forma === 'paciente' ? 'paciente cadastrada' : 'cadastro desativado'}
            </small>
          </div>
          <button
            type="button"
            className="link"
            onClick={() => {
              setFechou(false)
              aoMudar({ forma: 'texto', texto: '', mexeu: true })
            }}
          >
            Trocar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="campo">
      <label htmlFor={`${dicaId}-ind`}>
        Indicado por <small>(opcional)</small>
      </label>
      <input
        id={`${dicaId}-ind`}
        value={valor.texto}
        maxLength={80}
        placeholder="Nome de quem indicou"
        autoComplete="off"
        aria-describedby={dicaId}
        onChange={(e) => {
          setFechou(false)
          aoMudar({ forma: 'texto', texto: e.target.value, mexeu: true })
        }}
      />
      <small id={dicaId} style={{ color: 'var(--muted)' }}>
        Se ela é paciente, escolha na lista. Se não é, deixe o nome escrito.
      </small>
      {lista.length === 0 || fechou ? null : (
        <div className="sugestoes" role="group" aria-label="Pacientes com esse nome">
          {lista.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => aoMudar({ forma: 'paciente', id: p.id, nome: p.nome, mexeu: true })}
            >
              <b>{p.nome}</b>
            </button>
          ))}
          <button type="button" onClick={() => setFechou(true)}>
            Não é paciente — manter “{valor.texto.trim()}”
          </button>
        </div>
      )}
    </div>
  )
}
