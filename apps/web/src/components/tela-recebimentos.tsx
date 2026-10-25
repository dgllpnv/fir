'use client'

import type {
  ListaDeRecebimentos,
  PercentualDaMeta,
  RecebimentoNaLista,
  SaldoDoPaciente,
  TPacienteEncontrado,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useMemo, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { centavos, larguraDaBarra } from '@/lib/financeiro'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { diaEmTexto } from '@/lib/formato'
import { Carregando, Erro, Toast, Vazio } from './estados'
import { SeletorDePaciente } from './seletor-de-paciente'

/**
 * **Registrar recebimento — a única porta para dinheiro avulso.**
 *
 * A ordem da tela é a da conversa no balcão, e ela é do protótipo: a meta do
 * mês, a dica, a paciente, **o aviso dos últimos 7 dias**, o saldo em aberto,
 * o que ela está pagando, e só então valor e forma.
 *
 * O aviso dos 7 dias vem do SERVIDOR e aparece **antes** do campo de valor.
 * É a defesa de produto contra a receita lançada duas vezes, e ela só funciona
 * se estiver no caminho — numa aba, ninguém abre.
 */

const FORMAS = [
  'Pix',
  'Dinheiro',
  'Cartão de crédito',
  'Cartão de débito',
  'Nota promissória',
] as const

/** `REFS_RECEB` do protótipo (linha 4917), com o texto dela. */
const REFERENCIAS = [
  {
    k: 'consulta',
    t: 'Consulta ou procedimento',
    d: 'Pagamento de um atendimento que já aconteceu ou acontece hoje.',
    abre: true,
  },
  {
    k: 'sinal',
    t: 'Sinal de consulta',
    d: 'Valor adiantado para reservar a consulta. O restante fica em aberto.',
    abre: true,
  },
  {
    k: 'novo',
    t: 'Orçamento fechado',
    d: 'A paciente fechou o orçamento. Informe o que ela pagou agora.',
    abre: true,
  },
  {
    k: 'programa',
    t: 'Programa em andamento',
    d: 'Parcela de um programa de acompanhamento.',
    abre: false,
  },
  {
    k: 'saldo',
    t: 'Saldo em aberto',
    d: 'Parcela ou quitação de um valor que ficou em aberto.',
    abre: false,
  },
] as const

type Referencia = (typeof REFERENCIAS)[number]['k']

export function TelaRecebimentos({ hoje, mes }: { hoje: string; mes: string }) {
  const [paciente, setPaciente] = useState<TPacienteEncontrado | null>(null)
  const [ref, setRef] = useState<Referencia | ''>('')
  const [valor, setValor] = useState('')
  const [forma, setForma] = useState<string>('Pix')
  const [em, setEm] = useState(hoje)
  const [aberto, setAberto] = useState('')
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroDoForm, setErroDoForm] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)

  /**
   * **Gerado ao ABRIR o formulário, nunca ao enviar.**
   *
   * Gerado no envio, o duplo toque de uma conexão de balcão lenta produz dois
   * ids e o índice `recebimento_por_requisicao` não serve para nada — o
   * servidor veria duas requisições diferentes e criaria dois recebimentos.
   * Aqui ele é estável enquanto o formulário está aberto, e `troca` o renova
   * depois de cada lançamento: o próximo recebimento é outro dinheiro.
   */
  const [troca, setTroca] = useState(0)
  const requisicaoId = useMemo(() => crypto.randomUUID(), [troca])

  const meta = useDados<PercentualDaMeta>(`v1/metas/${mes}/percentual`)
  const doDia = useDados<ListaDeRecebimentos>(`v1/recebimentos${consultaEmTexto({ dia: hoje })}`)
  const recentes = useDados<ListaDeRecebimentos>(
    paciente === null
      ? null
      : `v1/recebimentos${consultaEmTexto({ pacienteId: paciente.id, ultimosDias: 7 })}`,
  )
  const saldo = useDados<SaldoDoPaciente>(
    paciente === null ? null : `v1/pacientes/${paciente.id}/saldo`,
  )

  const escolhida = REFERENCIAS.find((r) => r.k === ref)

  function limpar(): void {
    setRef('')
    setValor('')
    setAberto('')
    setObs('')
    setEm(hoje)
    setTroca((n) => n + 1)
  }

  async function registrar(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setErroDoForm(null)
    if (paciente === null || escolhida === undefined) return

    const emCentavos = centavosDoTexto(valor)
    if (emCentavos === null || emCentavos <= 0n) {
      setErroDoForm('Informe o valor recebido. Use o formato 1.200,00.')
      return
    }
    const abertoEmCentavos = aberto.trim() === '' ? null : centavosDoTexto(aberto)
    if (aberto.trim() !== '' && abertoEmCentavos === null) {
      setErroDoForm('O valor em aberto está num formato que não reconheço.')
      return
    }

    setSalvando(true)
    try {
      await chamar('v1/recebimentos', {
        method: 'POST',
        body: JSON.stringify({
          requisicaoId,
          pacienteId: paciente.id,
          valor: emCentavos.toString(),
          forma,
          em,
          obs: obs.trim(),
          ref: escolhida.k,
          ...(escolhida.abre && abertoEmCentavos !== null
            ? { valorAberto: abertoEmCentavos.toString() }
            : {}),
        }),
      })
      setRecado('Recebimento registrado.')
      limpar()
      doDia.recarregar()
      meta.recarregar()
      recentes.recarregar()
      saldo.recarregar()
    } catch (erro) {
      setErroDoForm(
        erro instanceof ErroDaApi ? erro.message : 'Não consegui falar com o servidor.',
      )
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section>
      <div className="eyebrow">Financeiro</div>
      <div className="titulo">
        <h2>Registrar recebimento</h2>
      </div>

      <BarraDaMeta estado={meta} mes={mes} />

      <p className="nota" style={{ marginBottom: 14 }}>
        Todo dinheiro que a paciente pagou entra por aqui. Atendimento é tarefa; dinheiro é
        recebimento.
      </p>

      <form className="formulario" onSubmit={registrar} style={{ maxWidth: 'none' }}>
        <SeletorDePaciente escolhido={paciente} aoEscolher={setPaciente} />

        {paciente === null ? (
          <p className="nota">Escolha a paciente para continuar.</p>
        ) : (
          <>
            <AvisoDeRepeticao estado={recentes} />
            <AvisoDeSaldo estado={saldo} />

            <fieldset className="refs">
              <legend>O que a paciente está pagando?</legend>
              {REFERENCIAS.map((r) => (
                <button
                  key={r.k}
                  type="button"
                  className="ref"
                  aria-pressed={ref === r.k}
                  // "Programa em andamento" fica desabilitado até o épico 5,
                  // com o texto do protótipo — e não escondido: a opção existe
                  // no produto, e some dela é como a recepção procura por ela.
                  disabled={r.k === 'programa'}
                  onClick={() => setRef(r.k)}
                >
                  <b>{r.t}</b>
                  <span>
                    {r.k === 'programa' ? 'Esta paciente não tem programa em andamento.' : r.d}
                  </span>
                </button>
              ))}
            </fieldset>

            {escolhida === undefined ? null : (
              <>
                <div className="par">
                  <label className="campo">
                    Valor recebido (R$)
                    <input
                      inputMode="decimal"
                      value={valor}
                      placeholder="Ex.: 450,00"
                      onChange={(e) => setValor(e.target.value)}
                    />
                  </label>
                  <label className="campo">
                    Forma de pagamento
                    <select value={forma} onChange={(e) => setForma(e.target.value)}>
                      {FORMAS.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="par">
                  <label className="campo">
                    Data
                    <input
                      type="date"
                      max={hoje}
                      value={em}
                      onChange={(e) => setEm(e.target.value)}
                    />
                  </label>
                  {escolhida.abre ? (
                    <label className="campo">
                      Ficou valor em aberto? (R$) <small>(opcional)</small>
                      <input
                        inputMode="decimal"
                        value={aberto}
                        placeholder="Ex.: 2.000,00"
                        onChange={(e) => setAberto(e.target.value)}
                      />
                    </label>
                  ) : (
                    <div />
                  )}
                </div>

                {/* O raro fica recolhido: `docs/design.md` §1. */}
                <details className="evolucao">
                  <summary>Observação</summary>
                  <label className="campo" style={{ marginTop: 10 }}>
                    <span className="sr-apenas">Observação</span>
                    <input
                      maxLength={200}
                      value={obs}
                      placeholder="Ex.: pagou metade agora, metade no retorno"
                      onChange={(e) => setObs(e.target.value)}
                    />
                  </label>
                </details>

                {erroDoForm === null ? null : (
                  <p className="campo" role="alert">
                    <span className="erro">{erroDoForm}</span>
                  </p>
                )}

                <div className="botoes">
                  <button type="submit" className="btn" disabled={salvando}>
                    {salvando ? 'Registrando…' : 'Registrar recebimento'}
                  </button>
                  <button type="button" className="btn ghost" onClick={limpar}>
                    Limpar
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </form>

      <div className="grupo" style={{ marginTop: 24 }}>
        <h3>
          Recebimentos de hoje
          {doDia.dados === null ? null : (
            <span className="contador">{doDia.dados.itens.length}</span>
          )}
        </h3>

        {/*
          NÃO existe "Total recebido hoje · Pix R$ 450" aqui, e isso é a regra
          6: o agregado por forma de um dia cujo caixa está aberto É o esperado
          com outra etiqueta. A lista individual fica — é com ela que se acha o
          recebimento que faltou.
        */}
        {doDia.carregando ? (
          <Carregando linhas={3} fino />
        ) : doDia.erro !== null ? (
          <Erro mensagem={doDia.erro} recarregar={doDia.recarregar} />
        ) : doDia.dados === null || doDia.dados.itens.length === 0 ? (
          <Vazio>
            <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhum recebimento registrado hoje.</p>
            <p className="nota" style={{ margin: 0 }}>
              Quando a paciente pagar, escolha o nome dela acima e registre. O caixa do dia compara
              o que foi registrado aqui com o que você contar na gaveta.
            </p>
          </Vazio>
        ) : (
          <div className="linhas">
            {doDia.dados.itens.map((r) => (
              <LinhaDeRecebimento key={r.id} r={r} />
            ))}
          </div>
        )}
      </div>

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * A meta do mês: barra e percentual.
 *
 * **O percentual vem do servidor.** A barra recebe o número pronto, nunca a
 * divisão — e o valor da meta sai `null` para quem não tem `valores`, sem um
 * `if` aqui: o servidor já apagou o campo.
 */
function BarraDaMeta({
  estado,
  mes,
}: {
  estado: ReturnType<typeof useDados<PercentualDaMeta>>
  mes: string
}) {
  const m = estado.dados
  if (m === null || m.percentual === null) return null
  return (
    <div className="meta-do-mes">
      <div className="meta-linha">
        <b>Meta de {mes.slice(5, 7)}/{mes.slice(0, 4)}</b>
        <span className="num">{m.percentual}%</span>
      </div>
      <div className="barra" role="img" aria-label={`${m.percentual}% da meta do mês`}>
        <i style={{ width: larguraDaBarra(m.percentual) }} />
      </div>
      {m.meta === null ? null : (
        <span className="nota">
          {formatarDinheiro(centavos(m.recebido))} de {formatarDinheiro(centavos(m.meta))}
        </span>
      )}
    </div>
  )
}

/** O aviso contra lançar o mesmo pagamento duas vezes. Vem do servidor. */
function AvisoDeRepeticao({ estado }: { estado: ReturnType<typeof useDados<ListaDeRecebimentos>> }) {
  const itens = estado.dados?.itens ?? []
  if (itens.length === 0) return null
  return (
    <div className="aviso-forte">
      <b>Recebimentos desta paciente nos últimos 7 dias</b>
      <p className="nota" style={{ margin: 0 }}>
        Confira para não lançar o mesmo pagamento duas vezes.
      </p>
      <div className="linhas" style={{ marginBottom: 0 }}>
        {itens.map((r) => (
          <LinhaDeRecebimento key={r.id} r={r} />
        ))}
      </div>
    </div>
  )
}

/**
 * "Paciente com saldo em aberto".
 *
 * `temSaldo` é booleano e derivado no servidor — é ele que decide se o aviso
 * aparece. O valor pode vir `null` (sem `valores`), e o aviso continua
 * aparecendo: saber QUE existe saldo é o que faz a recepção perguntar.
 */
function AvisoDeSaldo({ estado }: { estado: ReturnType<typeof useDados<SaldoDoPaciente>> }) {
  const s = estado.dados
  if (s === null || !s.temSaldo) return null
  return (
    <div className="aviso-forte">
      <b>Paciente com saldo em aberto</b>
      <p className="nota" style={{ margin: 0 }}>
        {s.saldo === null
          ? 'Confirme com a paciente se ela quer quitar parte do valor hoje.'
          : `${formatarDinheiro(centavos(s.saldo))} em aberto. Para receber uma parcela, escolha “Saldo em aberto”.`}
      </p>
    </div>
  )
}

function LinhaDeRecebimento({ r }: { r: RecebimentoNaLista }) {
  return (
    <div className="linha" data-estornado={r.estornado ? 'sim' : 'nao'}>
      <div className="info">
        <b>{r.paciente}</b>
        <small>
          {r.tipo} · {r.forma} · {diaEmTexto(r.em)} · {r.registradoPor}
          {r.estornado ? ' · estornado' : ''}
        </small>
      </div>
      <span className="valor">{formatarDinheiro(centavos(r.valor))}</span>
    </div>
  )
}
