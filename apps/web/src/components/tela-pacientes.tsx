'use client'

import type { ListaDePacientes, PacienteNaLista } from '@fir/contracts'
import { ORIGENS } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { consultaEmTexto, useDados, useEspera } from '@/lib/dados'
import { diaEmTexto, plural } from '@/lib/formato'
import { inicial } from '@/lib/icones'
import { Carregando, Erro, Toast } from './estados'
import { FormularioDePaciente } from './formulario-de-paciente'
import { ImportarPacientes } from './importar-pacientes'

/**
 * Pacientes — a lista, os quatro atalhos e a entrada para a ficha.
 *
 * **Nada é contado aqui.** `ltv`, `saldo`, `tarefasAbertas` e
 * `ultimoAtendimento` chegam derivados de `GET /v1/pacientes`; "sem retorno há
 * 6+ meses" e "aniversariantes do mês" são atalhos que o SERVIDOR resolve, no
 * fuso da clínica. Um corte de seis meses feito com o relógio do navegador
 * mudaria de resultado conforme o aparelho da recepção.
 *
 * O valor à direita sai de `formatarDinheiro`, que devolve "—" para `null` —
 * e `null` é o que o servidor manda a quem não tem a permissão `valores`.
 * Nenhum `if` de permissão sobre dinheiro mora nesta tela.
 */

const ATALHOS = [
  ['todos', 'Todos'],
  ['aniversariantes', 'Aniversariantes do mês'],
  ['com-tarefa-aberta', 'Com tarefa em aberto'],
  ['sem-retorno', 'Sem retorno há 6+ meses'],
] as const

type Atalho = (typeof ATALHOS)[number][0]

const ORDENS = [
  ['recentes', 'Movimento mais recente'],
  ['nome', 'Nome (A–Z)'],
  ['ultima-consulta', 'Última consulta mais antiga'],
  ['ltv', 'Maior LTV'],
] as const

/** Uma página. 200 é o teto do contrato; 50 é o que cabe numa leitura. */
const PAGINA = 50

export function TelaPacientes({
  podeGerir,
  podeValores,
}: {
  podeGerir: boolean
  /**
   * Ordenar por LTV é LER o LTV pela posição, e o controlador devolve 403 sem
   * a permissão. A opção some da lista pela mesma razão que a tela some do
   * menu: prometer um caminho que termina em 403 é pior do que não oferecê-lo.
   * Isto não esconde valor nenhum — quem decide o que sai é o servidor.
   */
  podeValores: boolean
}) {
  const [atalho, setAtalho] = useState<Atalho>('todos')
  const [ordem, setOrdem] = useState<(typeof ORDENS)[number][0]>('recentes')
  const [origem, setOrigem] = useState('')
  const [busca, setBusca] = useState('')
  const [limite, setLimite] = useState(PAGINA)
  const [cadastrando, setCadastrando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)

  const q = useEspera(busca.trim(), 300)

  const { dados, carregando, erro, recarregar } = useDados<ListaDePacientes>(
    `v1/pacientes${consultaEmTexto({
      q: q === '' ? undefined : q,
      atalho: atalho === 'todos' ? undefined : atalho,
      origem: origem === '' ? undefined : origem,
      ordem: ordem === 'recentes' ? undefined : ordem,
      limite,
    })}`,
  )

  const trocar = (fn: () => void) => {
    setLimite(PAGINA)
    fn()
  }

  const total = dados?.total ?? 0
  const ordens = ORDENS.filter(([k]) => k !== 'ltv' || podeValores)

  return (
    <section>
      <div className="titulo">
        <div>
          <div className="eyebrow">Comercial</div>
          <h2>Pacientes</h2>
        </div>
        <div className="acoes-de-tela">
          {podeGerir ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setImportando((v) => !v)
                setCadastrando(false)
              }}
            >
              Importar pacientes
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setCadastrando((v) => !v)
              setImportando(false)
            }}
          >
            Nova paciente
          </button>
        </div>
      </div>

      {cadastrando ? (
        <div style={{ marginBottom: 16 }}>
          <FormularioDePaciente
            paciente={null}
            completo
            rotuloSalvar="Cadastrar"
            aoCancelar={() => setCadastrando(false)}
            aoSalvar={(p) => {
              setCadastrando(false)
              setRecado(`${p.nome} cadastrada.`)
              recarregar()
            }}
          />
        </div>
      ) : null}

      {importando ? (
        <div style={{ marginBottom: 16 }}>
          <ImportarPacientes
            aoFechar={() => setImportando(false)}
            aoImportar={(aviso) => {
              setImportando(false)
              setRecado(aviso)
              recarregar()
            }}
          />
        </div>
      ) : null}

      <label className="campo" style={{ marginBottom: 12 }}>
        Buscar
        <input
          type="search"
          value={busca}
          placeholder="Nome ou telefone"
          onChange={(e) => trocar(() => setBusca(e.target.value))}
        />
      </label>

      <div className="grade-de-filtros" style={{ marginBottom: 12 }}>
        <label className="campo">
          Ordenar por
          <select
            value={ordem}
            onChange={(e) => {
              const achada = ordens.find(([k]) => k === e.target.value)
              if (achada !== undefined) trocar(() => setOrdem(achada[0]))
            }}
          >
            {ordens.map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          Origem
          <select value={origem} onChange={(e) => trocar(() => setOrigem(e.target.value))}>
            <option value="">Todas as origens</option>
            {ORIGENS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="chips" role="group" aria-label="Mostrar">
        {ATALHOS.map(([k, r]) => (
          <button
            key={k}
            type="button"
            aria-pressed={atalho === k}
            onClick={() => trocar(() => setAtalho(k))}
          >
            {r}
          </button>
        ))}
      </div>

      {atalho === 'sem-retorno' ? (
        <p className="nota" style={{ marginBottom: 12 }}>
          Último atendimento há mais de seis meses, da mais antiga para a mais recente. É o ponto
          de partida de uma campanha de recaptação.
        </p>
      ) : null}

      {erro !== null ? (
        <Erro mensagem={erro} recarregar={recarregar} />
      ) : dados === null ? (
        <Carregando linhas={5} fino />
      ) : (
        <>
          <p className="aviso-filtro">
            <span className="num">{plural(total, 'paciente', 'pacientes')}</span> com estes
            filtros.
          </p>

          {dados.pacientes.length === 0 ? (
            <div className="vazio">
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                {q === '' && atalho === 'todos' && origem === ''
                  ? 'Nenhuma paciente cadastrada ainda. Cadastre aqui, importe uma planilha, ou cadastre direto ao criar uma tarefa.'
                  : 'Nenhuma paciente com esses filtros.'}
              </p>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setCadastrando(true)
                  setImportando(false)
                }}
              >
                Cadastrar paciente
              </button>
            </div>
          ) : (
            <div className="linhas">
              {dados.pacientes.map((p) => (
                <LinhaDePaciente key={p.id} paciente={p} aniversario={atalho === 'aniversariantes'} />
              ))}
            </div>
          )}

          {dados.pacientes.length < total ? (
            <div className="botoes" style={{ marginTop: 12 }}>
              {limite < 200 ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => setLimite((n) => Math.min(200, n + PAGINA))}
                >
                  Ver mais
                </button>
              ) : null}
              <p className="nota" style={{ alignSelf: 'center' }}>
                Mostrando <span className="num">{dados.pacientes.length}</span> de{' '}
                <span className="num">{total}</span>.
                {limite < 200 ? '' : ' Use a busca para alcançar as demais.'}
              </p>
            </div>
          ) : null}

          {carregando ? <p className="nota">Atualizando…</p> : null}
        </>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function LinhaDePaciente({
  paciente: p,
  aniversario,
}: {
  paciente: PacienteNaLista
  aniversario: boolean
}) {
  // O mais recente entre o atendimento registrado aqui e a consulta informada
  // no cadastro — os DOIS já vêm do servidor; a tela só escolhe qual rotular.
  const ultimo = p.ultimoAtendimento ?? p.ultimaConsulta

  return (
    <a className="linha" href={`/pacientes/${p.id}`}>
      <span className="avatar" aria-hidden="true">
        {inicial(p.nome)}
      </span>
      <span className="info">
        <b>{p.nome}</b>
        <small>
          {p.origem === '' ? 'Origem não informada' : p.origem}
          {ultimo === null ? '' : ` · última consulta ${diaEmTexto(ultimo)}`}
          {p.tarefasAbertas === 0
            ? ''
            : ` · ${plural(p.tarefasAbertas, 'tarefa em aberto', 'tarefas em aberto')}`}
        </small>
      </span>
      {aniversario && p.aniversario !== null ? (
        <span className="pill num">Aniv. {diaEmTexto(p.aniversario).slice(0, 5)}</span>
      ) : null}
      {/* `formatarDinheiro(null)` é "—": é o que quem não tem `valores` vê,
          porque o servidor já apagou o campo. Nenhum `if` mora aqui. */}
      <span className="valor">{formatarDinheiro(p.ltv === null ? null : BigInt(p.ltv))}</span>
    </a>
  )
}
