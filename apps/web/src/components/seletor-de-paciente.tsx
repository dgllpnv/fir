'use client'

import type { ListaDePacientes, PacienteNaLista } from '@fir/contracts'
import { useState } from 'react'
import { consultaEmTexto, useDados, useEspera } from '@/lib/dados'
import { FormularioDePaciente } from './formulario-de-paciente'

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
      /* Cadastro MÍNIMO: `completo={false}`. Última consulta e observação são
         da ficha — aqui a pessoa está agendando, e cada campo a mais é um
         campo entre ela e a agenda. */
      <FormularioDePaciente
        paciente={null}
        completo={false}
        nomeInicial={busca.trim()}
        rotuloSalvar="Cadastrar e usar"
        aoCancelar={() => setCadastrando(false)}
        aoSalvar={(p) => {
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
