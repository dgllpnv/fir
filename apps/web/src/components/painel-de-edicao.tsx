'use client'

import type {
  ExclusaoDeTarefa,
  ListaDaEquipe,
  ListaDeUnidades,
  TarefaNaLista,
  TarefasAfetadas,
} from '@fir/contracts'
import { useEffect, useRef, useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'

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
   * O painel abre no FIM da tela, e num dia com doze tarefas ele nasce fora da
   * vista: a pessoa toca "Editar" e nada parece acontecer. Movimento que
   * explica de onde veio é o único permitido (`design.md` §3), e este explica.
   *
   * O foco vai junto, para quem navega por teclado não ter de percorrer a
   * lista inteira até alcançar o formulário que acabou de abrir.
   */
  const painel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    painel.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    painel.current?.querySelector('input')?.focus()
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

  async function excluir() {
    setErro(null)
    setSalvando(true)
    try {
      const r = await chamar<ExclusaoDeTarefa>(
        `v1/tarefas/${t.id}?serie=${serie ? 'true' : 'false'}`,
        { method: 'DELETE' },
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
      className="painel"
      style={{ marginTop: 16 }}
      role="group"
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
        <div className="erro-de-tela">
          <p>
            Excluir {serie && t.serieId !== null ? 'esta tarefa e as próximas da série' : 'esta tarefa'}?
            O registro sai das listas e o histórico fica guardado.
          </p>
          <div className="botoes">
            <button type="button" className="btn" onClick={() => void excluir()} disabled={salvando}>
              Sim, excluir
            </button>
            <button type="button" className="btn ghost" onClick={() => setConfirmando(false)}>
              Não
            </button>
          </div>
        </div>
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
  )
}
