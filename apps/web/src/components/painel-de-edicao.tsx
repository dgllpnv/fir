'use client'

import type {
  ExclusaoDeTarefa,
  ListaDaEquipe,
  ListaDeUnidades,
  TarefaNaLista,
  PrevisaoDeExclusao,
  TarefasAfetadas,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useEffect, useRef, useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { validarMotivoDeSuporte } from '@/lib/motivo-de-suporte'
import { CampoDeCampanha } from './campo-de-campanha'
import { CampoDeMotivoDeSuporte } from './campo-de-motivo-de-suporte'

/**
 * Editar — e **Excluir dentro de Editar**, como no MANUAL cap. 4.
 *
 * As duas ficam juntas porque é o mesmo lugar na cabeça de quem usa: "essa
 * tarefa está errada". Separá-las em dois botões no cartão daria à exclusão o
 * mesmo peso visual de "Editar", num alvo de toque ao lado do outro, numa
 * tela de 390 px.
 *
 * `serie` alcança as PRÓXIMAS ocorrências abertas — e o texto diz isso, com o
 * número, antes de a pessoa marcar. A data de realização e o resultado valem
 * só para esta, e isso também está escrito.
 */
export function PainelDeEdicao({
  tarefa: t,
  hoje,
  aoFechar,
  aoSalvar,
}: {
  tarefa: TarefaNaLista
  hoje: string
  aoFechar: () => void
  aoSalvar: (aviso: string) => void
}) {
  const [descricao, setDescricao] = useState(t.descricao)
  const [prazo, setPrazo] = useState(t.prazo)
  const [hora, setHora] = useState(t.hora ?? '')
  const [responsavelId, setResponsavelId] = useState(t.responsavelId)
  const [prioridade, setPrioridade] = useState(t.prioridade)
  const [obs, setObs] = useState(t.obs)
  const [unidadeId, setUnidadeId] = useState(t.unidadeId ?? '')
  const [campanhaId, setCampanhaId] = useState(t.campanhaId ?? '')
  const trocouCampanha = campanhaId !== (t.campanhaId ?? '')
  const [realizadaEm, setRealizadaEm] = useState(
    t.concluidaEm === null ? '' : t.concluidaEm.slice(0, 10),
  )
  const [serie, setSerie] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [confirmando, setConfirmando] = useState(false)

  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const unidades = useDados<ListaDeUnidades>('v1/unidades')

  /**
   * O painel é uma FOLHA fixa sobre a página, não um bloco no fim da lista: as
   * telas o montam depois das tarefas, e com 44 delas ele nascia fora da vista
   * — a cliente dizia que "Editar não abre". Fixo, ele aparece onde quer que
   * seja montado, sem que a tela precise saber.
   *
   * Foco no primeiro campo ao abrir; Esc fecha; ao fechar o foco volta ao
   * botão que o abriu.
   */
  const painel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const origem = document.activeElement
    painel.current?.querySelector('input')?.focus()
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar()
    }
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('keydown', esc)
      if (origem instanceof HTMLElement) origem.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function salvar() {
    setErro(null)
    setSalvando(true)
    try {
      const corpo: Record<string, unknown> = {
        descricao,
        prazo,
        hora: hora === '' ? null : hora,
        responsavelId,
        prioridade,
        obs,
        serie,
      }
      if (t.pacienteId !== null) corpo['unidadeId'] = unidadeId === '' ? null : unidadeId
      // TRÊS estados (N-4): a campanha só vai quando a pessoa a MUDOU. Ausente
      // é "mantém" — inclusive uma campanha antiga que a lista já não oferece.
      if (trocouCampanha) corpo['campanhaId'] = campanhaId === '' ? null : campanhaId
      // A data de realização só vai quando a tarefa ESTÁ concluída: o servidor
      // recusa o contrário, e com razão — editar não conclui.
      if (t.status === 'concluida' && realizadaEm !== '') corpo['realizadaEm'] = realizadaEm

      await chamar<TarefasAfetadas>(`v1/tarefas/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify(corpo),
      })
      aoSalvar(serie ? 'Tarefa e as próximas da série atualizadas.' : 'Tarefa atualizada.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui salvar a tarefa.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(motivo?: string) {
    setErro(null)
    setSalvando(true)
    try {
      // O motivo vai no CORPO (não na URL, que vai para log). Só o Suporte
      // Firmare é obrigado a informá-lo; para a pessoa da clínica não há campo.
      const r = await chamar<ExclusaoDeTarefa>(
        `v1/tarefas/${t.id}?serie=${serie ? 'true' : 'false'}`,
        {
          method: 'DELETE',
          ...(motivo === undefined ? {} : { body: JSON.stringify({ motivo }) }),
        },
      )
      aoSalvar(
        r.ids.length > 1
          ? `${r.ids.length} tarefas da série foram excluídas.`
          : 'Tarefa excluída.',
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui excluir a tarefa.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'grid',
        placeItems: 'center',
        padding: 16,
        background: 'color-mix(in srgb, var(--ink) 45%, transparent)',
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar()
      }}
    >
    <div
      className="painel"
      style={{
        width: 'min(560px, 100%)',
        maxHeight: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        boxSizing: 'border-box',
        margin: 0,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Editar tarefa"
      ref={painel}
    >
      <b>Editar: {t.descricao}</b>

      <label className="campo">
        Descrição
        <input value={descricao} maxLength={400} onChange={(e) => setDescricao(e.target.value)} />
      </label>

      <div className="par">
        <label className="campo">
          Prazo
          <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
        </label>
        <label className="campo">
          Horário <small>(opcional)</small>
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
        </label>
      </div>

      <div className="par">
        <label className="campo">
          Responsável
          <select value={responsavelId} onChange={(e) => setResponsavelId(e.target.value)}>
            {(equipe.dados?.equipe ?? [])
              // Pessoa que saiu não recebe tarefa nova. Ela continua na lista
              // só quando já é a responsável desta — senão o `<select>` ficaria
              // sem a opção que está selecionada.
              .filter((p) => p.ativo || p.id === t.responsavelId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                  {p.ativo ? '' : ' (inativa)'}
                </option>
              ))}
          </select>
        </label>
        <label className="campo">
          Prioridade
          <select
            value={prioridade}
            onChange={(e) => setPrioridade(e.target.value === 'urgente' ? 'urgente' : 'normal')}
          >
            <option value="normal">Normal</option>
            <option value="urgente">Urgente</option>
          </select>
        </label>
      </div>

      {t.pacienteId === null ? null : (
        <label className="campo">
          Unidade <small>(opcional)</small>
          <select value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">Sem unidade</option>
            {(unidades.dados?.unidades ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </select>
        </label>
      )}

      <CampoDeCampanha valor={campanhaId} aoMudar={setCampanhaId} incluir={t.campanhaId} />
      {/* N-5: trocar a campanha de uma tarefa paga MOVE o recebimento — permitido,
          como no protótipo, e dito antes de salvar. Sem número: a frase vale
          para quem não vê valores. */}
      {trocouCampanha && t.pagamento !== null ? (
        <p className="nota" role="status">
          O valor pago nesta tarefa passa para{' '}
          {campanhaId === '' ? 'nenhuma campanha' : 'a campanha escolhida'}.
        </p>
      ) : null}

      {t.status === 'concluida' ? (
        <label className="campo">
          Data de realização <small>(vale só para esta tarefa)</small>
          <input
            type="date"
            value={realizadaEm}
            max={hoje}
            onChange={(e) => setRealizadaEm(e.target.value)}
          />
        </label>
      ) : null}

      <label className="campo">
        Observação <small>(opcional)</small>
        <textarea
          maxLength={300}
          style={{ minHeight: 56 }}
          value={obs}
          onChange={(e) => setObs(e.target.value)}
        />
      </label>

      {t.serieId === null ? null : (
        <label className="caixa">
          <input type="checkbox" checked={serie} onChange={(e) => setSerie(e.target.checked)} />
          <span>
            Aplicar também às próximas desta série{' '}
            <small>
              (só as que ainda estão em aberto, a partir desta data. A data de realização e o
              resultado valem só para esta.)
            </small>
          </span>
        </label>
      )}

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      {confirmando ? (
        <ConfirmarExclusao
          tarefaId={t.id}
          oque={serie && t.serieId !== null ? 'esta tarefa e as próximas da série' : 'esta tarefa'}
          ocupado={salvando}
          aoConfirmar={(motivo) => void excluir(motivo)}
          aoDesistir={() => setConfirmando(false)}
        />
      ) : (
        <div className="botoes">
          <button type="button" className="btn" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
          <button type="button" className="btn ghost" onClick={aoFechar} disabled={salvando}>
            Voltar
          </button>
          <button
            type="button"
            className="link perigo"
            style={{ marginLeft: 'auto' }}
            onClick={() => setConfirmando(true)}
          >
            Excluir
          </button>
        </div>
      )}
    </div>
    </div>
  )
}

/**
 * A confirmação da exclusão, em dois passos: primeiro o que VAI acontecer,
 * depois o botão.
 *
 * Mora aqui e é usada também pelo cartão, para que a exclusão de uma tarefa
 * concluída (com pagamento e programa) tenha o mesmo texto onde quer que seja
 * pedida. O servidor decide e executa tudo numa transação; a tela só avisa.
 *
 * O valor só aparece para quem tem `valores`: o servidor o devolve `null` aos
 * demais (regra 17) e o texto sai sem número.
 */
export function ConfirmarExclusao({
  tarefaId,
  oque,
  ocupado,
  aoConfirmar,
  aoDesistir,
}: {
  tarefaId: string
  oque: string
  ocupado: boolean
  /** `motivo` só vem na sessão de suporte, quando o servidor o exige. */
  aoConfirmar: (motivo?: string) => void
  aoDesistir: () => void
}) {
  const [previa, setPrevia] = useState<PrevisaoDeExclusao | null>(null)
  const [motivo, setMotivo] = useState('')
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let valeu = true
    chamar<PrevisaoDeExclusao>(`v1/tarefas/${tarefaId}/exclusao`)
      .then((r) => {
        if (valeu) setPrevia(r)
      })
      .catch(() => {
        if (valeu) setFalhou(true)
      })
    return () => {
      valeu = false
    }
  }, [tarefaId])

  return (
    <div className="erro-de-tela" role="alertdialog" aria-label="Confirmar exclusão">
      <p>
        Excluir {oque}? O registro sai das listas e o histórico fica guardado.
      </p>
      {previa?.temPagamento ? (
        <p>
          <strong>
            O pagamento registrado nesta tarefa
            {previa.valor === null ? '' : ` (${formatarDinheiro(BigInt(previa.valor))})`} será
            estornado
          </strong>{' '}
          e deixa de contar na receita
          {previa.temPrograma ? '; o programa criado por ela será encerrado' : ''}. As sessões já
          feitas e o estoque já baixado continuam como estão.
        </p>
      ) : previa?.temPrograma ? (
        <p>O programa criado por esta tarefa será encerrado.</p>
      ) : null}
      {falhou ? <p>Não consegui conferir se há pagamento. Tente de novo.</p> : null}
      {previa?.exigeMotivo ? (
        <CampoDeMotivoDeSuporte valor={motivo} aoMudar={setMotivo} />
      ) : null}
      <div className="botoes">
        <button
          type="button"
          className="btn"
          onClick={() => aoConfirmar(previa?.exigeMotivo ? motivo.trim() : undefined)}
          disabled={
            ocupado ||
            (previa === null && !falhou) ||
            (previa?.exigeMotivo === true && !validarMotivoDeSuporte(motivo).ok)
          }
        >
          Sim, excluir
        </button>
        <button type="button" className="btn ghost" onClick={aoDesistir}>
          Não
        </button>
      </div>
    </div>
  )
}
