'use client'

import type { ListaDeUnidades, PacienteNaLista } from '@fir/contracts'
import { ORIGEM_INDICACAO, ORIGENS } from '@fir/contracts'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'

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
 * (`limparIndicacao`), nunca esta tela.
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
  paciente: PacienteNaLista | null
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
  const [indicadoPor, setIndicadoPor] = useState(paciente?.indicadoPor ?? '')
  const [unidadeId, setUnidadeId] = useState(paciente?.unidadeId ?? '')
  const [ultimaConsulta, setUltimaConsulta] = useState(paciente?.ultimaConsulta ?? '')
  const [obs, setObs] = useState(paciente?.obs ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const unidades = useDados<ListaDeUnidades>('v1/unidades')
  const ativas = (unidades.dados?.unidades ?? []).filter(
    (u) => u.ativa || u.id === paciente?.unidadeId,
  )

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
        indicadoPor: indicadoPor.trim(),
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
          <label className="campo">
            Indicado por <small>(opcional)</small>
            <input
              value={indicadoPor}
              maxLength={80}
              placeholder="Nome de quem indicou"
              onChange={(e) => setIndicadoPor(e.target.value)}
            />
          </label>
        )}
      </div>

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
