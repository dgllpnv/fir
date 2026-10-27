'use client'

import type { PainelDeProgramas, ProgramaNaLista, SessaoNaAgenda } from '@fir/contracts'
import { FILTROS_DE_SITUACAO } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useState } from 'react'
import {
  CartaoDeSessao,
  corpoDaSessao,
  type DadosDaSessao,
} from '@/components/programas/cartao-de-sessao'
import { chamar } from '@/lib/api'
import { consultaEmTexto, useDados, useEspera } from '@/lib/dados'
import { centavos, larguraDaBarra } from '@/lib/financeiro'
import { diaEmTexto, plural } from '@/lib/formato'
import { Carregando, Erro, Toast, Vazio } from './estados'

/**
 * **Comercial › Programas de acompanhamento.**
 *
 * Tudo vem pronto de `GET /v1/programas`: os seis indicadores, a agenda em
 * quatro faixas, os contatos de retorno e a lista com a situação derivada.
 * **Nenhuma contagem acontece aqui** (`docs/design.md` §5) — e a razão é
 * concreta: contar "sessões atrasadas" no cliente exigiria baixar todas as
 * sessões abertas da clínica para desenhar quatro números.
 *
 * As duas abas são as do protótipo (medidas): *Agenda de sessões* e *Pacientes
 * em programa*. O chip **Minhas sessões / Todas** é o que a enfermagem abre
 * todo dia, e `responsavelId=eu` é resolvido no **servidor** — mandar o id
 * daqui deixaria qualquer um ver a agenda de qualquer um trocando o parâmetro.
 */

type Aba = 'agenda' | 'pacientes'
type Situacao = (typeof FILTROS_DE_SITUACAO)[number]

const ROTULO_DA_SITUACAO: Readonly<Record<Situacao, string>> = {
  ativos: 'Em andamento',
  atrasados: 'Com atraso',
  saldo: 'Com saldo a receber',
  concluidos: 'Concluídos',
  encerrados: 'Encerrados',
  todos: 'Todos',
}

type Props = {
  /** `temPerm(…, 'receber')`. Sem ela, o painel da sessão não pede dinheiro. */
  readonly podeReceber: boolean
}

export function TelaProgramas({ podeReceber }: Props) {
  const [aba, setAba] = useState<Aba>('agenda')
  const [minhas, setMinhas] = useState(false)
  const [situacao, setSituacao] = useState<Situacao>('ativos')
  const [busca, setBusca] = useState('')
  const [recado, setRecado] = useState<string | null>(null)
  const buscaCalma = useEspera(busca, 300)

  const painel = useDados<PainelDeProgramas>(
    `v1/programas${consultaEmTexto({
      situacao,
      responsavelId: minhas ? 'eu' : undefined,
      q: buscaCalma.trim() === '' ? undefined : buscaCalma.trim(),
    })}`,
  )
  const d = painel.dados

  async function concluir(id: string, dados: DadosDaSessao) {
    await chamar(`v1/programas/sessoes/${id}/concluir`, {
      method: 'POST',
      body: JSON.stringify(corpoDaSessao(dados)),
    })
    setRecado('Sessão concluída.')
    painel.recarregar()
  }

  async function reabrir(id: string) {
    await chamar(`v1/programas/sessoes/${id}/reabrir`, {
      method: 'POST',
      body: JSON.stringify({}),
    })
    setRecado('Sessão reaberta. O pagamento foi estornado, se havia.')
    painel.recarregar()
  }

  return (
    <section>
      <div className="eyebrow">Comercial</div>
      <div className="titulo">
        <h2>Programas de acompanhamento</h2>
        <div className="acoes-de-tela">
          <Link className="btn" href="/programas/nova">
            Nova adesão
          </Link>
        </div>
      </div>

      {painel.carregando ? (
        <Carregando linhas={5} />
      ) : painel.erro !== null ? (
        <Erro mensagem={painel.erro} recarregar={painel.recarregar} />
      ) : d === null ? null : (
        <>
          <Indicadores d={d.indicadores} />

          <div className="chips" role="group" aria-label="Visão">
            <button type="button" aria-pressed={aba === 'agenda'} onClick={() => setAba('agenda')}>
              Agenda de sessões
            </button>
            <button
              type="button"
              aria-pressed={aba === 'pacientes'}
              onClick={() => setAba('pacientes')}
            >
              Pacientes em programa
            </button>
          </div>

          {aba === 'agenda' ? (
            <>
              <div className="chips" role="group" aria-label="De quem">
                <button type="button" aria-pressed={minhas} onClick={() => setMinhas(true)}>
                  Minhas sessões
                </button>
                <button type="button" aria-pressed={!minhas} onClick={() => setMinhas(false)}>
                  Todas
                </button>
              </div>

              {d.agenda.atrasadas.length +
                d.agenda.hoje.length +
                d.agenda.proximos7.length +
                d.agenda.realizadasHoje.length ===
              0 ? (
                <VazioDaAgenda temPrograma={d.lista.length > 0} minhas={minhas} />
              ) : (
                <>
                  {/* ATRASADAS PRIMEIRO. A nota é a da PO: elas ficam aqui até
                      serem realizadas, porque paciente com sessão atrasada é
                      risco de abandono do programa. */}
                  <Faixa
                    titulo="Sessões atrasadas"
                    atencao
                    nota="Ficam aqui até serem realizadas. Paciente com sessão atrasada é risco de abandono do programa."
                    itens={d.agenda.atrasadas}
                    {...{ podeReceber, concluir, reabrir }}
                    hojeDoServidor={d.hoje}
                  />
                  <Faixa
                    titulo="Hoje"
                    itens={d.agenda.hoje}
                    vazio="Nenhuma sessão prevista para hoje."
                    {...{ podeReceber, concluir, reabrir }}
                    hojeDoServidor={d.hoje}
                  />
                  <Faixa
                    titulo="Realizadas hoje"
                    itens={d.agenda.realizadasHoje}
                    {...{ podeReceber, concluir, reabrir }}
                    hojeDoServidor={d.hoje}
                  />
                  <Faixa
                    titulo="Próximos 7 dias"
                    itens={d.agenda.proximos7}
                    vazio="Nenhuma sessão nos próximos 7 dias."
                    {...{ podeReceber, concluir, reabrir }}
                    hojeDoServidor={d.hoje}
                  />
                </>
              )}

              {d.retornos.length === 0 ? null : (
                <div className="grupo">
                  <h3>
                    Contatos de retorno · até 30 dias{' '}
                    <span className="contador num">{d.retornos.length}</span>
                  </h3>
                  <p className="nota">
                    Pacientes que já podem repetir o procedimento. Também aparecem na tela Hoje de
                    quem vai fazer o contato.
                  </p>
                  <div className="linhas">
                    {d.retornos.map((t) => (
                      <div className="linha" key={t.id}>
                        <div className="info">
                          <b>{t.pacienteNome}</b>
                          <small>{t.descricao}</small>
                        </div>
                        <span className="valor num">{diaEmTexto(t.prazo)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <ListaDePacientes
              lista={d.lista}
              situacao={situacao}
              aoTrocarSituacao={setSituacao}
              busca={busca}
              aoBuscar={setBusca}
            />
          )}
        </>
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * Os seis indicadores, PRONTOS.
 *
 * `saldoAReceber` chega `null` sem a permissão `valores`, e
 * `formatarDinheiro(null)` o desenha como "—". `pacientesQueDevem` é CONTAGEM,
 * não dinheiro, e atravessa: a equipe precisa saber **que** há gente devendo
 * mesmo sem ver quanto.
 */
function Indicadores({ d }: { d: PainelDeProgramas['indicadores'] }) {
  return (
    <div className="indicadores">
      <div className="indicador">
        <span className="rotulo">Pacientes em programa</span>
        <span className="numero num">{d.pacientesEmPrograma}</span>
        <small style={{ color: 'var(--muted)' }}>
          {plural(d.programasConcluidos, 'programa concluído', 'programas concluídos')}
        </small>
      </div>
      <div className="indicador">
        <span className="rotulo">Sessões hoje</span>
        <span className="numero num">{d.sessoesHoje}</span>
        <small style={{ color: 'var(--muted)' }}>
          {d.sessoesProximos7} nos próximos 7 dias
        </small>
      </div>
      <div className="indicador">
        <span className="rotulo">Sessões atrasadas</span>
        <span
          className="numero num"
          style={{ color: d.sessoesAtrasadas > 0 ? 'var(--bad)' : 'inherit' }}
        >
          {d.sessoesAtrasadas}
        </span>
        <small style={{ color: 'var(--muted)' }}>
          {plural(d.pacientesEmRisco, 'paciente', 'pacientes')} há mais de 7 dias
        </small>
      </div>
      <div className="indicador">
        <span className="rotulo">Saldo a receber nos programas</span>
        <span className="numero num">{formatarDinheiro(centavos(d.saldoAReceber))}</span>
        <small style={{ color: 'var(--muted)' }}>
          {plural(d.pacientesQueDevem, 'paciente', 'pacientes')}
        </small>
      </div>
    </div>
  )
}

function Faixa({
  titulo,
  nota,
  itens,
  vazio,
  atencao,
  podeReceber,
  concluir,
  reabrir,
  hojeDoServidor,
}: {
  titulo: string
  nota?: string
  itens: readonly SessaoNaAgenda[]
  vazio?: string
  atencao?: boolean
  podeReceber: boolean
  concluir: (id: string, dados: DadosDaSessao) => Promise<void>
  reabrir: (id: string) => Promise<void>
  hojeDoServidor: string
}) {
  if (itens.length === 0 && vazio === undefined) return null
  return (
    <div className={atencao === true ? 'grupo atencao' : 'grupo'}>
      <h3>
        {titulo} <span className={atencao === true ? 'contador atraso num' : 'contador num'}>{itens.length}</span>
      </h3>
      {nota === undefined ? null : <p className="nota">{nota}</p>}
      {itens.length === 0 ? (
        <Vazio>
          <p className="nota" style={{ margin: 0 }}>
            {vazio}
          </p>
        </Vazio>
      ) : (
        itens.map((x) => (
          <CartaoDeSessao
            key={x.tarefa.id}
            item={x}
            hoje={hojeDoServidor}
            podeReceber={podeReceber}
            aoConcluir={concluir}
            aoReabrir={reabrir}
          />
        ))
      )}
    </div>
  )
}

/**
 * A lista de pacientes em programa, com os cinco filtros de situação.
 *
 * O servidor já ordenou — e em "Com saldo a receber" a ordem é pelo **maior
 * saldo primeiro**: é a fila de cobrança, e ordem alfabética ali faria a
 * recepção ligar para quem deve R$ 50 antes de quem deve R$ 3.000. Reordenar
 * aqui exigiria o saldo aqui, e sem `valores` ele vem `null`: a fila ficaria
 * embaralhada justamente para quem liga.
 */
function ListaDePacientes({
  lista,
  situacao,
  aoTrocarSituacao,
  busca,
  aoBuscar,
}: {
  lista: readonly ProgramaNaLista[]
  situacao: Situacao
  aoTrocarSituacao: (s: Situacao) => void
  busca: string
  aoBuscar: (q: string) => void
}) {
  return (
    <>
      <div className="chips" role="group" aria-label="Situação">
        {FILTROS_DE_SITUACAO.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={situacao === s}
            onClick={() => aoTrocarSituacao(s)}
          >
            {ROTULO_DA_SITUACAO[s]}
          </button>
        ))}
      </div>

      <label className="campo" style={{ maxWidth: 420, marginBottom: 12 }}>
        Buscar paciente
        <input
          type="search"
          value={busca}
          placeholder="Nome da paciente"
          onChange={(e) => aoBuscar(e.target.value)}
        />
      </label>

      {lista.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>
            {busca.trim() === '' && situacao === 'ativos'
              ? 'Nenhum paciente em programa.'
              : 'Nenhum paciente com esse filtro.'}
          </p>
          {busca.trim() === '' && situacao === 'ativos' ? (
            <>
              <p className="nota" style={{ margin: 0 }}>
                Comece por <b>Nova adesão</b>, ou feche um orçamento com programa montado — o
                programa nasce na mesma transação do pagamento.
              </p>
              <div className="botoes" style={{ marginTop: 10 }}>
                <Link className="btn" href="/programas/nova">
                  Nova adesão
                </Link>
                <Link className="btn ghost" href="/jornada">
                  Ir para a jornada
                </Link>
              </div>
            </>
          ) : null}
        </Vazio>
      ) : (
        <div className="linhas">
          {lista.map((p) => (
            <Link className="linha" key={p.id} href={`/programas/${p.id}`}>
              <div className="info">
                <b>{p.pacienteNome}</b>
                <small>
                  {p.procedimentos} · {p.realizadas} de {p.total}{' '}
                  {p.total === 1 ? p.rotuloSessao.toLowerCase() : `${p.rotuloSessao.toLowerCase()}s`}
                  {p.proximaEm === null || p.situacao === 'atrasado'
                    ? ''
                    : ` · próxima ${diaEmTexto(p.proximaEm)}`}
                  {p.retornoEm === null ? '' : ` · contato de retorno ${diaEmTexto(p.retornoEm)}`}
                </small>
                <div className="progresso" data-situacao={p.situacao}>
                  <div className="trilha">
                    <i style={{ width: larguraDaBarra(p.percentual) }} />
                  </div>
                </div>
              </div>
              <div
                className="valor"
                style={{ display: 'grid', gap: 2, justifyItems: 'end', textAlign: 'right' }}
              >
                <Etiqueta p={p} />
                {p.temSaldo ? (
                  <span className="num" style={{ fontSize: 12.5, color: 'var(--warn-ink)' }}>
                    {p.saldo === null ? 'com saldo' : `${formatarDinheiro(BigInt(p.saldo))} a receber`}
                  </span>
                ) : null}
                {situacao === 'saldo' ? (
                  <small style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {p.ultimoPagamentoEm === null
                      ? 'sem pagamento registrado'
                      : `último pagamento ${diaEmTexto(p.ultimoPagamentoEm)}`}
                  </small>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}

/** A etiqueta da situação. O texto é o do protótipo, palavra por palavra. */
function Etiqueta({ p }: { p: ProgramaNaLista }) {
  if (p.situacao === 'encerrado') {
    return (
      <span className="pill">
        Encerrado{p.motivoEncerramento === null ? '' : ` · ${p.motivoEncerramento}`}
      </span>
    )
  }
  if (p.situacao === 'concluido') return <span className="pill bom">Programa concluído</span>
  if (p.situacao === 'atrasado') {
    return (
      <span className="pill alerta num">
        {p.diasDeAtraso === 1
          ? 'Sessão atrasada desde ontem'
          : `Sessão atrasada há ${p.diasDeAtraso} dias`}
      </span>
    )
  }
  if (p.situacao === 'hoje') return <span className="pill">Sessão hoje</span>
  return <span className="pill bom">Em dia</span>
}

function VazioDaAgenda({ temPrograma, minhas }: { temPrograma: boolean; minhas: boolean }) {
  return (
    <Vazio>
      <p style={{ margin: 0, color: 'var(--ink)' }}>
        {minhas ? 'Nenhuma sessão sua nos próximos dias.' : 'Nenhuma sessão nos próximos dias.'}
      </p>
      <p className="nota" style={{ margin: 0 }}>
        {temPrograma
          ? minhas
            ? 'Toque em “Todas” para ver a agenda da equipe.'
            : 'As sessões aparecem aqui conforme os prazos chegam.'
          : 'Nenhum paciente em programa. Comece por Nova adesão, ou feche um orçamento com programa montado.'}
      </p>
      {temPrograma ? null : (
        <div className="botoes" style={{ marginTop: 10 }}>
          <Link className="btn" href="/programas/nova">
            Nova adesão
          </Link>
        </div>
      )}
    </Vazio>
  )
}

