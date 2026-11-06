'use client'

import type {
  ClienteCarteiraNaLista,
  CobrancaCarteiraNaLista,
  DesfazerCobrancaPagaSaida,
  IndicadorCarteiraCriadoSaida,
  IndicadorCarteiraNaLista,
  LancamentoDeIndicadorNaLista,
  LancamentoDeIndicadorSalvoSaida,
  ListaDeClientesDaCarteiraSaida,
  ListaDeCobrancasCarteiraSaida,
  ListaDeIndicadoresCarteiraSaida,
  ListaDeLancamentosDeIndicadorSaida,
  ListaDeMetasComerciaisSaida,
  MarcarCobrancaPagaSaida,
  MetaComercialCriadaSaida,
  MetaComercialNaLista,
  SentidoDeIndicador,
  UnidadeDeIndicador,
} from '@fir/contracts'
import { formatarDinheiro, formatarPercentual } from '@fir/ui'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { diaEmTexto } from '@/lib/formato'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira } from '../../pecas'
import AcessoDoPortalDoCliente from './acesso-do-portal'
import LinksDeAcessoDoCliente from './links-de-acesso'

/**
 * A FICHA DE UM `Cliente Firmare` — o que o `Usuário de Gestão` acompanha:
 * `Cobrança do Cliente Firmare`, `Indicador da carteira` (com o último
 * `Lançamento` de cada um) e `Meta comercial do cliente`. Spec G3.
 *
 * **Não existe `GET /v1/carteira/clientes/:id`** — a única rota de leitura é
 * a lista (já filtrada por grupo, ADR 0012). Por isso esta tela lê a mesma
 * lista da tela anterior e procura o id nela: "não está na lista" e "não
 * existe" são a MESMA resposta aqui, de propósito — o RLS do grupo nunca
 * aparece como um erro diferente de "não encontrado" (não vaza que o cliente
 * existe, só não é seu).
 *
 * **Nenhum total, soma ou percentual nasce aqui.** `somaValor` vem pronto de
 * `GET /v1/carteira/cobrancas`; o "progresso" de uma meta é o `status` e o
 * `ultimoLancamento` que o servidor já derivou — nunca uma divisão feita
 * nesta tela (`docs/design.md` §5: "nenhum cálculo de saldo, total ou
 * percentual acontece no front").
 *
 * **Dinheiro pode vir `null`.** Hoje nenhum `Usuário de Gestão` tem a
 * permissão `valores` (não existe perfil granular ainda para este ator — ver
 * o contrato `cobranca-carteira.ts`), então TODO campo monetário desta tela
 * (`mensalidade`, `desconto`, `valor`, `somaValor`, `valorMeta`,
 * `valorInicial`) chega apagado pelo `RedacaoInterceptor`. `formatarDinheiro`
 * já mostra "—" para isso — nenhum `if` de permissão mora aqui. Os campos
 * `valorInteiro` (indicador de unidade `un` ou `%`) não são dinheiro e por
 * isso não são redigidos: um indicador de contagem ou de percentual continua
 * visível mesmo sem `valores`.
 */
export default function ClienteDaCarteira() {
  const { id } = useParams<{ id: string }>()
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)
  const recarregar = () => setTentativa((n) => n + 1)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const [listaClientes, cobrancasSaida, indicadoresSaida, metasSaida] = await Promise.all([
          chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes'),
          chamar<ListaDeCobrancasCarteiraSaida>(`v1/carteira/cobrancas?clienteId=${id}`),
          chamar<ListaDeIndicadoresCarteiraSaida>(`v1/carteira/indicadores?clienteId=${id}`),
          chamar<ListaDeMetasComerciaisSaida>(`v1/carteira/metas?clienteId=${id}`),
        ])
        const cliente = listaClientes.clientes.find((c) => c.id === id) ?? null
        if (cliente === null) {
          if (valeu) setEstado({ tag: 'naoEncontrado' })
          return
        }

        // O último lançamento de cada indicador — para MOSTRAR, não para
        // somar nem para calcular progresso. Ordenar por referência (texto
        // `aaaa-mm-dd`, comparável lexicograficamente) é escolha de EXIBIÇÃO,
        // a mesma categoria de "ordenar uma tabela", não a conta que a regra
        // 17 reserva ao servidor.
        const porIndicador = await Promise.all(
          indicadoresSaida.indicadores.map((ind) =>
            chamar<ListaDeLancamentosDeIndicadorSaida>(
              `v1/carteira/indicadores/${ind.id}/lancamentos`,
            ),
          ),
        )
        const ultimoPorIndicador: Record<string, LancamentoDeIndicadorNaLista | null> = {}
        indicadoresSaida.indicadores.forEach((ind, i) => {
          const lista = porIndicador[i]?.lancamentos ?? []
          const ordenada = [...lista].sort((a, b) => (a.referencia < b.referencia ? 1 : -1))
          ultimoPorIndicador[ind.id] = ordenada[0] ?? null
        })

        if (!valeu) return
        setEstado({
          tag: 'pronto',
          cliente,
          cobrancas: cobrancasSaida.cobrancas,
          somaValor: cobrancasSaida.somaValor,
          indicadores: indicadoresSaida.indicadores,
          ultimoPorIndicador,
          metas: metasSaida.metas,
        })
      } catch (e) {
        if (!valeu) return
        setEstado({
          tag: 'erro',
          mensagem:
            e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor. Confira a conexão.',
        })
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, id, tentativa])

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return <p className="muted">Carregando…</p>
  }

  if (estado.tag === 'naoEncontrado') {
    return (
      <section className="vazio">
        <b>Cliente não encontrado.</b>
        <p className="nota">Ele pode não existir mais, ou estar fora dos grupos que você enxerga.</p>
        <Link className="btn" href="/carteira/clientes">
          Voltar para Clientes
        </Link>
      </section>
    )
  }

  if (estado.tag === 'erro') {
    return <ErroDaCarteira mensagem={estado.mensagem} recarregar={recarregar} />
  }

  const { cliente, cobrancas, somaValor, indicadores, ultimoPorIndicador, metas } = estado
  const indicadorPorId = new Map(indicadores.map((i) => [i.id, i]))

  return (
    <div className="carteira-cliente">
      <p className="nota">
        <Link className="link" href="/carteira/clientes">
          ← Clientes
        </Link>
      </p>

      <header className="carteira-cliente-cabecalho">
        <div>
          <div className="eyebrow">{cliente.produto}</div>
          <h1>{cliente.nome}</h1>
        </div>
        <span className={`pill ${PILL_DO_STATUS_DO_CLIENTE[cliente.status]}`}>{cliente.status}</span>
      </header>

      <section className="cartao carteira-secao">
        <div className="titulo">
          <h2>Cobranças</h2>
          <span className="valor num">{formatarDinheiro(centavos(somaValor))}</span>
        </div>
        {cobrancas.length === 0 ? (
          <p className="muted">Nenhuma cobrança lançada ainda para este cliente.</p>
        ) : (
          <div className="carteira-lista-financeira">
            {cobrancas.map((c) => (
              <LinhaDeCobranca
                key={c.id}
                cobranca={c}
                aoAtualizar={(recadoCobranca) => {
                  recarregar()
                  setRecado(recadoCobranca)
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="cartao carteira-secao">
        <div className="titulo">
          <h2>Indicadores</h2>
        </div>
        {indicadores.length === 0 ? (
          <p className="muted">Nenhum indicador cadastrado para este cliente.</p>
        ) : (
          <div className="carteira-lista-financeira">
            {indicadores.map((ind) => (
              <div key={ind.id} className="carteira-linha-bloco">
                <LinhaDeIndicador indicador={ind} ultimo={ultimoPorIndicador[ind.id] ?? null} />
                <FormularioDeLancamento
                  indicador={ind}
                  aoLancado={(recadoLancamento) => {
                    recarregar()
                    setRecado(recadoLancamento)
                  }}
                />
              </div>
            ))}
          </div>
        )}

        <FormularioDeIndicador
          clienteCarteiraId={cliente.id}
          aoCriado={(recadoIndicador) => {
            recarregar()
            setRecado(recadoIndicador)
          }}
        />
      </section>

      <section className="cartao carteira-secao">
        <div className="titulo">
          <h2>Metas comerciais</h2>
        </div>
        {metas.length === 0 ? (
          <p className="muted">Nenhuma meta comercial definida para este cliente.</p>
        ) : (
          <div className="carteira-lista-financeira">
            {metas.map((m) => (
              <BlocoDeMeta key={m.id} meta={m} indicador={indicadorPorId.get(m.indicadorId) ?? null} />
            ))}
          </div>
        )}

        {indicadores.length === 0 ? (
          <p className="nota">Crie um indicador antes de definir uma meta comercial.</p>
        ) : (
          <FormularioDeMeta
            clienteCarteiraId={cliente.id}
            indicadores={indicadores}
            aoCriada={(recadoMeta) => {
              recarregar()
              setRecado(recadoMeta)
            }}
          />
        )}
      </section>

      <LinksDeAcessoDoCliente cliente={cliente} />

      <AcessoDoPortalDoCliente clienteCarteiraId={cliente.id} nomeDoCliente={cliente.nome} />

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </div>
  )
}

type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'naoEncontrado' }
  | {
      tag: 'pronto'
      cliente: ClienteCarteiraNaLista
      cobrancas: CobrancaCarteiraNaLista[]
      somaValor: string | null
      indicadores: IndicadorCarteiraNaLista[]
      ultimoPorIndicador: Record<string, LancamentoDeIndicadorNaLista | null>
      metas: MetaComercialNaLista[]
    }

const PILL_DO_STATUS_DO_CLIENTE: Record<ClienteCarteiraNaLista['status'], string> = {
  onboarding: '',
  ativo: 'bom',
  pausado: 'alerta',
  encerrado: 'mau',
}

const PILL_DO_STATUS_DA_COBRANCA: Record<CobrancaCarteiraNaLista['status'], string> = {
  aberto: 'alerta',
  pago: 'bom',
  cancelado: 'mau',
}

/** String de centavos → `bigint`. `null` quando a redação já apagou o campo. */
const centavos = (texto: string | null): bigint | null => (texto === null ? null : BigInt(texto))

const sentidoEmTexto = (s: 'maior_melhor' | 'menor_melhor'): string =>
  s === 'maior_melhor' ? 'quanto maior, melhor' : 'quanto menor, melhor'

/**
 * O valor de um `Lançamento de indicador`, na unidade declarada pelo
 * indicador. `R$` sai de `formatarDinheiro` (pode vir `null` sem `valores`);
 * `%` sai de `formatarPercentual`; `un` é a contagem simples, e nenhum dos
 * dois últimos é redigido (regra 17 só apaga dinheiro).
 */
function valorNaUnidade(
  unidade: UnidadeDeIndicador,
  v: { valor: string | null; valorInteiro: string | null },
): string {
  if (unidade === 'R$') return formatarDinheiro(centavos(v.valor))
  if (unidade === '%') return formatarPercentual(v.valorInteiro === null ? null : BigInt(v.valorInteiro))
  return v.valorInteiro ?? '—'
}

/**
 * A linha de uma `Cobrança do Cliente Firmare`, com a ação do seu status:
 * `aberto` oferece "Marcar pago", `pago` oferece "Desfazer" (critério G3
 * §2.2.9 — o contrário de marcar, nunca um cancelamento). `cancelado` não
 * tem ação nesta fatia. As duas chamam `POST .../marcar-pago` e
 * `.../desfazer-pago` sem corpo — o servidor é quem decide o que "pago"
 * significa, a tela só pede.
 */
function LinhaDeCobranca({
  cobranca: c,
  aoAtualizar,
}: {
  cobranca: CobrancaCarteiraNaLista
  aoAtualizar: (recado: string) => void
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')

  async function marcarPago() {
    setErro('')
    setEnviando(true)
    try {
      await chamar<MarcarCobrancaPagaSaida>(`v1/carteira/cobrancas/${c.id}/marcar-pago`, { method: 'POST' })
      aoAtualizar(`Cobrança de ${diaEmTexto(c.competencia)} marcada como paga.`)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      setEnviando(false)
    }
  }

  async function desfazerPago() {
    setErro('')
    setEnviando(true)
    try {
      await chamar<DesfazerCobrancaPagaSaida>(`v1/carteira/cobrancas/${c.id}/desfazer-pago`, { method: 'POST' })
      aoAtualizar(`Pagamento de ${diaEmTexto(c.competencia)} desfeito.`)
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
      setEnviando(false)
    }
  }

  return (
    <div className="carteira-linha-bloco">
      <div className="carteira-linha">
        <div className="carteira-linha-info">
          <b>{diaEmTexto(c.competencia)}</b>
          <small className="muted">
            vencimento <span className="num">{diaEmTexto(c.vencimento)}</span>
            {c.desconto !== null && c.desconto !== '0' ? (
              <> · desconto {formatarDinheiro(centavos(c.desconto))}</>
            ) : null}
            {c.pagoEm !== null ? <> · pago</> : null}
          </small>
        </div>
        <span className="valor num">{formatarDinheiro(centavos(c.valor))}</span>
        <span className={`pill ${PILL_DO_STATUS_DA_COBRANCA[c.status]}`}>{c.status}</span>
      </div>

      {c.status === 'aberto' || c.status === 'pago' ? (
        <div className="carteira-acoes">
          {c.status === 'aberto' ? (
            <button type="button" className="btn" disabled={enviando} onClick={() => void marcarPago()}>
              {enviando ? 'Marcando…' : 'Marcar pago'}
            </button>
          ) : (
            <button type="button" className="link" disabled={enviando} onClick={() => void desfazerPago()}>
              {enviando ? 'Desfazendo…' : 'Desfazer'}
            </button>
          )}
        </div>
      ) : null}

      {erro !== '' ? (
        <p role="alert" aria-live="polite" className="erro">
          {erro}
        </p>
      ) : null}
    </div>
  )
}

function LinhaDeIndicador({
  indicador,
  ultimo,
}: {
  indicador: IndicadorCarteiraNaLista
  ultimo: LancamentoDeIndicadorNaLista | null
}) {
  return (
    <div className="carteira-linha">
      <div className="carteira-linha-info">
        <b>{indicador.nome}</b>
        <small className="muted">{sentidoEmTexto(indicador.sentido)}</small>
      </div>
      {ultimo === null ? (
        <span className="muted">sem lançamento ainda</span>
      ) : (
        <>
          <span className="valor num">{valorNaUnidade(indicador.unidade, ultimo)}</span>
          <small className="muted num">{diaEmTexto(ultimo.referencia)}</small>
        </>
      )}
    </div>
  )
}

function BlocoDeMeta({
  meta: m,
  indicador,
}: {
  meta: MetaComercialNaLista
  indicador: IndicadorCarteiraNaLista | null
}) {
  return (
    <div className="carteira-meta">
      <div className="carteira-meta-cabecalho">
        <div className="carteira-linha-info">
          <b>{m.titulo}</b>
          <small className="muted">
            <span className="num">{diaEmTexto(m.inicio)}</span> – <span className="num">{diaEmTexto(m.prazo)}</span>
            {indicador === null ? null : <> · {sentidoEmTexto(m.sentido)}</>}
          </small>
        </div>
        <span className={`pill ${m.status === 'concluida' ? 'bom' : 'alerta'}`}>
          {m.status === 'concluida' ? 'concluída' : 'em andamento'}
        </span>
      </div>
      {indicador === null ? (
        <p className="carteira-meta-linha muted">O indicador desta meta não foi encontrado.</p>
      ) : (
        <div className="carteira-meta-linha">
          <span className="muted">
            {indicador.nome}: de{' '}
            <span className="num">
              {valorInicialNaUnidade(indicador.unidade, m)}
            </span>{' '}
            para <span className="num">{valorMetaNaUnidade(indicador.unidade, m)}</span>
          </span>
          {/* O "progresso" é o ÚLTIMO lançamento, já derivado pelo servidor —
              nenhuma porcentagem é calculada aqui (design.md §5). */}
          {m.ultimoLancamento === null ? (
            <span className="muted">Aguardando o primeiro lançamento.</span>
          ) : (
            <span className="muted">
              Último lançamento: <span className="num">{valorNaUnidade(indicador.unidade, m.ultimoLancamento)}</span> em{' '}
              <span className="num">{diaEmTexto(m.ultimoLancamento.referencia)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function valorMetaNaUnidade(unidade: UnidadeDeIndicador, m: MetaComercialNaLista): string {
  if (unidade === 'R$') return formatarDinheiro(centavos(m.valorMeta))
  if (unidade === '%') {
    return formatarPercentual(m.valorMetaInteiro === null ? null : BigInt(m.valorMetaInteiro))
  }
  return m.valorMetaInteiro ?? '—'
}

function valorInicialNaUnidade(unidade: UnidadeDeIndicador, m: MetaComercialNaLista): string {
  if (unidade === 'R$') return formatarDinheiro(centavos(m.valorInicial))
  if (unidade === '%') {
    return formatarPercentual(m.valorInicialInteiro === null ? null : BigInt(m.valorInicialInteiro))
  }
  return m.valorInicialInteiro ?? '—'
}

/**
 * Dígitos inteiros simples (a contagem de um `Indicador da carteira` de
 * unidade `un`) — nunca decimal, regra 8. Mesma forma de `centavosDoTexto`:
 * um texto que não bate em dígitos puros é `null`, recusado na tela.
 */
function inteiroDoTexto(texto: string): bigint | null {
  const limpo = texto.trim()
  if (!/^-?\d+$/.test(limpo)) return null
  return BigInt(limpo)
}

/**
 * O número que o SERVIDOR espera para um valor na unidade do indicador —
 * `R$` e `%` compartilham a mesma forma de digitação (duas casas decimais,
 * vírgula), porque `%` já guarda centésimos de ponto percentual
 * (`formatarPercentual`); só `un` é um inteiro simples, sem casa decimal.
 */
function numeroNaUnidade(unidade: UnidadeDeIndicador, texto: string): bigint | null {
  return unidade === 'un' ? inteiroDoTexto(texto) : centavosDoTexto(texto)
}

const RECADO_DA_UNIDADE: Record<UnidadeDeIndicador, string> = { 'R$': 'R$', 'un': 'contagem', '%': '%' }

function rotuloDoValor(unidade: UnidadeDeIndicador, base: string): string {
  return unidade === 'un' ? base : `${base} (${RECADO_DA_UNIDADE[unidade]})`
}

/**
 * **CRIAR INDICADOR** — recolhido por padrão (`design.md` §1: campo raro
 * fica recolhido). `sentido` é pedido aqui porque o contrato
 * (`CriarIndicadorCarteiraEntrada`) o exige na criação — não há como mudar
 * depois nesta fatia.
 */
function FormularioDeIndicador({
  clienteCarteiraId,
  aoCriado,
}: {
  clienteCarteiraId: string
  aoCriado: (recado: string) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({
    nome: '',
    unidade: 'R$' as UnidadeDeIndicador,
    sentido: 'maior_melhor' as SentidoDeIndicador,
  })
  const dobra = useRef<HTMLDetailsElement>(null)

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setEnviando(true)
    try {
      const r = await chamar<IndicadorCarteiraCriadoSaida>('v1/carteira/indicadores', {
        method: 'POST',
        body: JSON.stringify({
          clienteCarteiraId,
          nome: form.nome,
          unidade: form.unidade,
          sentido: form.sentido,
        }),
      })
      aoCriado(`Indicador "${r.indicador.nome}" criado.`)
      setForm({ nome: '', unidade: 'R$', sentido: 'maior_melhor' })
      if (dobra.current !== null) dobra.current.open = false
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="carteira-dobra" ref={dobra}>
      <summary>Criar indicador</summary>
      <form className="carteira-form" onSubmit={criar}>
        <label className="campo">
          Nome
          <input
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            placeholder="Faturamento mensal, leads gerados…"
            required
          />
        </label>

        <label className="campo">
          Unidade
          <select
            value={form.unidade}
            onChange={(e) => setForm({ ...form, unidade: e.target.value as UnidadeDeIndicador })}
          >
            <option value="R$">Reais (R$)</option>
            <option value="un">Contagem (un)</option>
            <option value="%">Percentual (%)</option>
          </select>
        </label>

        <label className="campo">
          Sentido
          <select
            value={form.sentido}
            onChange={(e) => setForm({ ...form, sentido: e.target.value as SentidoDeIndicador })}
          >
            <option value="maior_melhor">Quanto maior, melhor</option>
            <option value="menor_melhor">Quanto menor, melhor</option>
          </select>
        </label>

        <p role="alert" aria-live="polite" className="erro">
          {erro}
        </p>

        <button type="submit" disabled={enviando} className="btn">
          {enviando ? 'Criando…' : 'Criar indicador'}
        </button>
      </form>
    </details>
  )
}

/**
 * **LANÇAR MEDIÇÃO** de um `Indicador da carteira` já existente — dobra
 * aninhada (`carteira-dobra-mini`) dentro de cada linha, mesma forma de
 * "Mudar etapa" em `leads/page.tsx`. Relançar a mesma referência ATUALIZA o
 * lançamento (upsert do servidor, critério 2.1.3) — a tela não avisa disso
 * porque o recado de sucesso já é o mesmo nos dois casos.
 */
function FormularioDeLancamento({
  indicador,
  aoLancado,
}: {
  indicador: IndicadorCarteiraNaLista
  aoLancado: (recado: string) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [referencia, setReferencia] = useState('')
  const [valorTexto, setValorTexto] = useState('')
  const [observacao, setObservacao] = useState('')
  const dobra = useRef<HTMLDetailsElement>(null)

  async function lancar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    const numero = numeroNaUnidade(indicador.unidade, valorTexto)
    if (numero === null) {
      setErro('Informe um valor válido.')
      return
    }
    setEnviando(true)
    try {
      const corpo: Record<string, string | null> = {
        referencia,
        observacao: observacao.trim() === '' ? null : observacao,
      }
      if (indicador.unidade === 'R$') corpo.valor = numero.toString()
      else corpo.valorInteiro = numero.toString()

      await chamar<LancamentoDeIndicadorSalvoSaida>(`v1/carteira/indicadores/${indicador.id}/lancamentos`, {
        method: 'POST',
        body: JSON.stringify(corpo),
      })
      aoLancado(`Medição de "${indicador.nome}" lançada.`)
      setValorTexto('')
      setObservacao('')
      if (dobra.current !== null) dobra.current.open = false
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="carteira-dobra carteira-dobra-mini" ref={dobra}>
      <summary>Lançar medição</summary>
      <form className="carteira-form" onSubmit={lancar}>
        <label className="campo">
          Referência (competência)
          <input type="date" value={referencia} onChange={(e) => setReferencia(e.target.value)} required />
        </label>

        <label className="campo">
          {rotuloDoValor(indicador.unidade, 'Valor')}
          <input
            inputMode={indicador.unidade === 'un' ? 'numeric' : 'decimal'}
            value={valorTexto}
            onChange={(e) => setValorTexto(e.target.value)}
            placeholder={indicador.unidade === 'un' ? '0' : '0,00'}
            required
          />
        </label>

        <details className="carteira-dobra carteira-dobra-mini">
          <summary>+ Mais opções</summary>
          <label className="campo">
            Observação
            <input value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </label>
        </details>

        <p role="alert" aria-live="polite" className="erro">
          {erro}
        </p>

        <button type="submit" disabled={enviando} className="btn">
          {enviando ? 'Lançando…' : 'Lançar'}
        </button>
      </form>
    </details>
  )
}

/**
 * **CRIAR META** — escolhe o `Indicador da carteira` já cadastrado; o rótulo
 * e o `inputMode` do valor mudam com a unidade do indicador escolhido
 * (`R$`/`%` aceitam decimal, `un` só inteiro). `valorInicial` é opcional no
 * contrato (`CriarMetaComercialEntrada` não o exige) e por isso fica atrás
 * de "+ Mais opções" — o caso comum é começar do zero.
 */
function FormularioDeMeta({
  clienteCarteiraId,
  indicadores,
  aoCriada,
}: {
  clienteCarteiraId: string
  indicadores: IndicadorCarteiraNaLista[]
  aoCriada: (recado: string) => void
}) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [form, setForm] = useState({
    indicadorId: indicadores[0]?.id ?? '',
    titulo: '',
    sentido: 'maior_melhor' as SentidoDeIndicador,
    valorMetaTexto: '',
    valorInicialTexto: '',
    inicio: '',
    prazo: '',
  })
  const dobra = useRef<HTMLDetailsElement>(null)

  const indicador = indicadores.find((i) => i.id === form.indicadorId) ?? indicadores[0] ?? null

  async function criar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (indicador === null) {
      setErro('Escolha um indicador.')
      return
    }
    const numeroMeta = numeroNaUnidade(indicador.unidade, form.valorMetaTexto)
    if (numeroMeta === null) {
      setErro('Informe um valor de meta válido.')
      return
    }
    let numeroInicial: bigint | null = null
    if (form.valorInicialTexto.trim() !== '') {
      numeroInicial = numeroNaUnidade(indicador.unidade, form.valorInicialTexto)
      if (numeroInicial === null) {
        setErro('O valor inicial informado não é válido.')
        return
      }
    }
    setEnviando(true)
    try {
      const corpo: Record<string, string> = {
        clienteCarteiraId,
        indicadorId: indicador.id,
        titulo: form.titulo,
        sentido: form.sentido,
        inicio: form.inicio,
        prazo: form.prazo,
      }
      if (indicador.unidade === 'R$') corpo.valorMeta = numeroMeta.toString()
      else corpo.valorMetaInteiro = numeroMeta.toString()
      if (numeroInicial !== null) {
        if (indicador.unidade === 'R$') corpo.valorInicial = numeroInicial.toString()
        else corpo.valorInicialInteiro = numeroInicial.toString()
      }

      const r = await chamar<MetaComercialCriadaSaida>('v1/carteira/metas', {
        method: 'POST',
        body: JSON.stringify(corpo),
      })
      aoCriada(`Meta "${r.meta.titulo}" criada.`)
      setForm({
        indicadorId: indicadores[0]?.id ?? '',
        titulo: '',
        sentido: 'maior_melhor',
        valorMetaTexto: '',
        valorInicialTexto: '',
        inicio: '',
        prazo: '',
      })
      if (dobra.current !== null) dobra.current.open = false
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="carteira-dobra" ref={dobra}>
      <summary>Criar meta</summary>
      <form className="carteira-form" onSubmit={criar}>
        <label className="campo">
          Indicador
          <select
            value={form.indicadorId}
            onChange={(e) => setForm({ ...form, indicadorId: e.target.value })}
            required
          >
            {indicadores.map((i) => (
              <option key={i.id} value={i.id}>
                {i.nome}
              </option>
            ))}
          </select>
        </label>

        <label className="campo">
          Título
          <input
            value={form.titulo}
            onChange={(e) => setForm({ ...form, titulo: e.target.value })}
            placeholder="Faturamento do trimestre…"
            required
          />
        </label>

        <label className="campo">
          Sentido
          <select
            value={form.sentido}
            onChange={(e) => setForm({ ...form, sentido: e.target.value as SentidoDeIndicador })}
          >
            <option value="maior_melhor">Quanto maior, melhor</option>
            <option value="menor_melhor">Quanto menor, melhor</option>
          </select>
        </label>

        <label className="campo">
          {rotuloDoValor(indicador?.unidade ?? 'R$', 'Valor da meta')}
          <input
            inputMode={indicador?.unidade === 'un' ? 'numeric' : 'decimal'}
            value={form.valorMetaTexto}
            onChange={(e) => setForm({ ...form, valorMetaTexto: e.target.value })}
            placeholder={indicador?.unidade === 'un' ? '0' : '0,00'}
            required
          />
        </label>

        <label className="campo">
          Início
          <input
            type="date"
            value={form.inicio}
            onChange={(e) => setForm({ ...form, inicio: e.target.value })}
            required
          />
        </label>

        <label className="campo">
          Prazo
          <input
            type="date"
            value={form.prazo}
            onChange={(e) => setForm({ ...form, prazo: e.target.value })}
            required
          />
        </label>

        <details className="carteira-dobra carteira-dobra-mini">
          <summary>+ Mais opções</summary>
          <label className="campo">
            {rotuloDoValor(indicador?.unidade ?? 'R$', 'Valor inicial')}
            <input
              inputMode={indicador?.unidade === 'un' ? 'numeric' : 'decimal'}
              value={form.valorInicialTexto}
              onChange={(e) => setForm({ ...form, valorInicialTexto: e.target.value })}
              placeholder={indicador?.unidade === 'un' ? '0' : '0,00'}
            />
          </label>
        </details>

        <p role="alert" aria-live="polite" className="erro">
          {erro}
        </p>

        <button type="submit" disabled={enviando} className="btn">
          {enviando ? 'Criando…' : 'Criar meta'}
        </button>
      </form>
    </details>
  )
}
