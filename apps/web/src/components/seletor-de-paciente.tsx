'use client'

import type { ListaDePacientes, ListaDeUnidades, PacienteNaLista } from '@fir/contracts'
import { ORIGEM_INDICACAO, ORIGENS } from '@fir/contracts'
import { useState } from 'react'
import { chamar } from '@/lib/api'
import { consultaEmTexto, useDados, useEspera } from '@/lib/dados'

/**
 * Escolher a paciente — ou **cadastrá-la aqui mesmo**.
 *
 * O cadastro embutido não é conveniência: sem ele, agendar uma paciente nova
 * são duas telas, e a recepção com o telefone na mão escolhe o caminho de dois
 * toques, que seria o errado — criar a tarefa sem vínculo. `docs/design.md` §1:
 * "se o fluxo certo exige sete toques e o errado exige dois, a equipe fará o
 * errado, e o defeito é do desenho".
 *
 * A busca acontece no SERVIDOR (`GET /v1/pacientes?q=`), com a mesma
 * `normalizar_nome` que indexa o nome — acento, caixa e espaço resolvidos onde
 * o índice está. Uma busca em memória aqui só encontraria a página carregada.
 */
export function SeletorDePaciente({
  escolhido,
  aoEscolher,
}: {
  escolhido: PacienteNaLista | null
  aoEscolher: (p: PacienteNaLista | null) => void
}) {
  const [busca, setBusca] = useState('')
  const [cadastrando, setCadastrando] = useState(false)
  const q = useEspera(busca.trim(), 250)

  const achados = useDados<ListaDePacientes>(
    escolhido === null && !cadastrando && q.length >= 2
      ? `v1/pacientes${consultaEmTexto({ q, limite: 6 })}`
      : null,
  )

  if (escolhido !== null) {
    return (
      <div className="escolhido">
        <div>
          <div className="eyebrow">Paciente</div>
          <b>{escolhido.nome}</b>
        </div>
        <button
          type="button"
          className="link"
          onClick={() => {
            aoEscolher(null)
            setBusca('')
          }}
        >
          Trocar
        </button>
      </div>
    )
  }

  if (cadastrando) {
    return (
      <CadastroRapido
        nomeInicial={busca.trim()}
        aoCancelar={() => setCadastrando(false)}
        aoCadastrar={(p) => {
          setCadastrando(false)
          aoEscolher(p)
        }}
      />
    )
  }

  const lista = achados.dados?.pacientes ?? []
  // O servidor recusa a lista a quem não tem a permissão `pacientes`. A tela
  // diz isso em vez de ficar sem resposta — e `/nova` continua servindo para a
  // tarefa interna, que é de todos.
  const semAcesso = achados.erro !== null

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label className="campo">
        Paciente
        <input
          type="search"
          autoComplete="off"
          value={busca}
          placeholder="Digite o nome para buscar"
          onChange={(e) => setBusca(e.target.value)}
        />
      </label>

      {semAcesso ? (
        <p className="nota">{achados.erro}</p>
      ) : q.length < 2 ? (
        busca === '' ? null : (
          <p className="nota">Digite ao menos duas letras.</p>
        )
      ) : (
        <div className="sugestoes">
          {lista.map((p) => (
            <button key={p.id} type="button" onClick={() => aoEscolher(p)}>
              <b>{p.nome}</b>
              {p.telefone === '' ? null : <span className="num"> · {p.telefone}</span>}
            </button>
          ))}
          <button type="button" onClick={() => setCadastrando(true)}>
            + Cadastrar “{busca.trim()}” como nova paciente
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * O cadastro mínimo: nome, telefone, aniversário e origem.
 *
 * Mínimo de propósito. Última consulta, observação e unidade principal são da
 * ficha, em `/pacientes` — aqui a pessoa está agendando, e cada campo a mais é
 * um campo entre ela e a agenda.
 */
function CadastroRapido({
  nomeInicial,
  aoCancelar,
  aoCadastrar,
}: {
  nomeInicial: string
  aoCancelar: () => void
  aoCadastrar: (p: PacienteNaLista) => void
}) {
  const [nome, setNome] = useState(nomeInicial)
  const [telefone, setTelefone] = useState('')
  const [aniversario, setAniversario] = useState('')
  const [origem, setOrigem] = useState('')
  const [indicadoPor, setIndicadoPor] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const unidades = useDados<ListaDeUnidades>('v1/unidades')
  const ativas = (unidades.dados?.unidades ?? []).filter((u) => u.ativa)

  async function salvar() {
    if (nome.trim() === '') {
      setErro('Informe o nome da paciente.')
      return
    }
    setErro(null)
    setSalvando(true)
    try {
      const p = await chamar<PacienteNaLista>('v1/pacientes', {
        method: 'POST',
        body: JSON.stringify({
          nome: nome.trim(),
          telefone: telefone.trim(),
          aniversario: aniversario === '' ? null : aniversario,
          origem,
          // `indicadoPor` só vale com a origem Indicação, e quem decide isso é
          // o contrato (`limparIndicacao`), não esta tela.
          indicadoPor: indicadoPor.trim(),
          unidadeId: unidadeId === '' ? null : unidadeId,
          ultimaConsulta: null,
          obs: '',
        }),
      })
      aoCadastrar(p)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui cadastrar a paciente.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="painel" role="group" aria-label="Nova paciente">
      <b>Nova paciente</b>
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
          <input
            type="date"
            value={aniversario}
            onChange={(e) => setAniversario(e.target.value)}
          />
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

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Cadastrando…' : 'Cadastrar e usar'}
        </button>
        <button type="button" className="btn ghost" onClick={aoCancelar} disabled={salvando}>
          Buscar paciente já cadastrada
        </button>
      </div>
    </div>
  )
}
