'use client'

import type {
  CadastroDoClienteSaida,
  LeituraDaMetricaNaSaida,
  ParceiroDoClienteNaSaida,
  PlanilhaDefinidaSaida,
  PlanilhaDoClienteNaSaida,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Dica } from '@/components/dica'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaCurto } from '@/lib/formato'
import { instanteEmTexto } from '@/lib/instante'
import { decimosComUmaCasa, Faisca, variacaoNaSemana } from './indicadores-do-cliente'

/**
 * **V11 — INDICADORES PELA PLANILHA** (`cIndicadoresPlanilha`, protótipo
 * `index.html` L1499-1519; `PLANILHA` L632-641; `STF` L833).
 *
 * Quando o cliente tem planilha lida, a aba Indicadores mostra isto NO LUGAR
 * dos indicadores manuais (`cIndicadores`, L1495-1498):
 *  - **Situação da planilha**: "Semana de dd/mm · lida …", "Abrir planilha",
 *    "Ler planilha agora"; um bloco por frente com o estado, os problemas e o
 *    responsável (o parceiro da frente, do cadastro); o histórico de 8
 *    semanas em pontos coloridos e a legenda;
 *  - o filtro de janela (8 semanas, 3, 6, 12 meses);
 *  - por frente, "N de M semanas com dados" e um cartão por métrica derivada
 *    com o último valor, a média, a variação na semana e o gráfico.
 *
 * Tudo chega pronto de `GET /v1/carteira/clientes/:id/planilha` (ticket 4A):
 * estado da frente, problemas, média e variação (em décimos, meio para longe
 * do zero) são do domínio, no servidor. A tela formata.
 *
 * "Ler planilha agora" ENFILEIRA (`POST …/planilha/ler`, 202) — nunca lê na
 * requisição (appsec A-16); a tela confirma e relê a situação.
 */

const STATUS = {
  ok: { classe: 'bom', rotulo: 'Completa' },
  atencao: { classe: 'atencao', rotulo: 'Merece atenção' },
  pendente: { classe: 'critico', rotulo: 'Não recebida' },
} as const

const JANELAS: readonly [string, string][] = [
  ['8', '8 semanas'],
  ['13', '3 meses'],
  ['26', '6 meses'],
  ['52', '12 meses'],
]

/** Texto de um valor de métrica, na unidade dela. R$ sem `valores` já chega `null` → "—". */
function textoDaLeitura(l: LeituraDaMetricaNaSaida | null, unidade: 'R$' | 'un' | '%'): string {
  if (l === null) return '—'
  if (unidade === 'R$') return formatarDinheiro(l.valor === null ? null : BigInt(l.valor))
  const d = unidade === '%' ? l.percentualEmDecimos : l.quantidadeEmDecimos
  if (d === null) return '—'
  // O protótipo mostra no máximo uma casa e some com ",0" (`maximumFractionDigits:1`, L504).
  const texto = decimosComUmaCasa(BigInt(d)).replace(/,0$/, '')
  return unidade === '%' ? `${texto}%` : texto
}

/** O número cru de um ponto, para o gráfico (escala de cada unidade; R$ redigido sai do gráfico). */
function numeroDoPonto(l: LeituraDaMetricaNaSaida | null, unidade: 'R$' | 'un' | '%'): bigint | null {
  if (l === null) return null
  const t = unidade === 'R$' ? l.valor : unidade === '%' ? l.percentualEmDecimos : l.quantidadeEmDecimos
  return t === null ? null : BigInt(t)
}

function quando(iso: string | null, d: PlanilhaDoClienteNaSaida): string {
  if (iso === null) return 'nunca'
  return instanteEmTexto(iso, d.fuso, d.hoje) ?? 'nunca'
}

export function PlanilhaDoCliente({
  clienteId,
  inicial,
  aoMudar,
}: {
  clienteId: string
  inicial: PlanilhaDoClienteNaSaida
  aoMudar: (recado: string) => void
}) {
  const [dados, setDados] = useState(inicial)
  const [janela, setJanela] = useState('8')
  const [relendo, setRelendo] = useState(false)
  const [erroDaJanela, setErroDaJanela] = useState<string | null>(null)
  const [parceiros, setParceiros] = useState<readonly ParceiroDoClienteNaSaida[]>([])

  // Releitura de fora (depois de "Ler planilha agora" ou do link trocado) volta à janela padrão, a que veio.
  useEffect(() => {
    setDados(inicial)
    setJanela('8')
  }, [inicial])

  // O responsável de cada frente é o parceiro do cadastro (C3). Falhar aqui só deixa "não informado".
  useEffect(() => {
    let valeu = true
    chamar<CadastroDoClienteSaida>(`v1/carteira/clientes/${clienteId}`)
      .then((c) => {
        if (valeu) setParceiros(c.cliente.parceiros)
      })
      .catch(() => undefined)
    return () => {
      valeu = false
    }
  }, [clienteId])

  async function trocarJanela(j: string) {
    if (j === janela) return
    setJanela(j)
    setRelendo(true)
    setErroDaJanela(null)
    try {
      // O dado anterior fica na tela até o novo chegar: nada pula embaixo do dedo.
      setDados(await chamar<PlanilhaDoClienteNaSaida>(`v1/carteira/clientes/${clienteId}/planilha?semanas=${j}`))
    } catch (x) {
      setErroDaJanela(x instanceof ErroDaApi ? x.message : 'Não consegui ler esta janela agora. Tente de novo.')
    } finally {
      setRelendo(false)
    }
  }

  const planilha = dados.planilha
  if (planilha === null) return null
  const historico = dados.frentes[0]?.historico ?? []
  const responsavel = (frente: string): string =>
    parceiros.find((p) => p.frente === frente)?.nome?.trim() || 'não informado'

  return (
    <>
      <section className="ficha-painel" aria-labelledby="ind-planilha-titulo">
        <div className="ficha-painel-cabeca">
          <h2 id="ind-planilha-titulo">Situação da planilha</h2>
          <span className="ind-sub num">
            Semana de {diaCurto(dados.semanaDeReferencia)} · lida {quando(planilha.lidaEm, dados)}
          </span>
          <div className="ind-cabeca-acoes">
            <a className="link" href={planilha.link} target="_blank" rel="noopener noreferrer">
              Abrir planilha
            </a>
            <LerAgora clienteId={clienteId} aoMudar={aoMudar} />
          </div>
        </div>
        {planilha.erro !== null ? <p className="ind-aviso">{planilha.erro}</p> : null}

        <ul className="ind-frentes">
          {dados.frentes.map((f) => {
            const s = STATUS[f.situacao.status]
            return (
              <li key={f.frente} className={`ind-frente ind-frente-${s.classe}`}>
                <div className="ind-frente-topo">
                  <b>{f.aba}</b>
                  <span className={`ind-chip ind-chip-${s.classe}`}>{s.rotulo}</span>
                </div>
                {f.situacao.problemas.length > 0 ? (
                  <ul className="ind-problemas">
                    {f.situacao.problemas.map((p, i) => (
                      <li key={`${p.codigo}-${i}`}>{p.mensagem}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="ind-miudo">Todos os campos preenchidos e dentro do padrão.</p>
                )}
                <p className="ind-miudo">
                  Responsável: {responsavel(f.frente)}
                  {f.provisoria ? ' · estrutura da aba a confirmar' : ''}
                </p>
              </li>
            )
          })}
        </ul>

        {historico.length > 0 ? (
          <div className="ind-hist" tabIndex={0} role="region" aria-label="Histórico das frentes">
            <table className="ind-hist-tabela">
              <caption className="sr-apenas">Situação de cada frente nas últimas {historico.length} semanas</caption>
              <thead>
                <tr>
                  <th scope="col">Frente</th>
                  {historico.map((h) => (
                    <th key={h.semana} scope="col" className="num">
                      {diaCurto(h.semana)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dados.frentes.map((f) => (
                  <tr key={f.frente}>
                    <th scope="row">{f.aba}</th>
                    {f.historico.map((h) => {
                      const s = STATUS[h.status]
                      return (
                        <td key={h.semana}>
                          <span
                            className={`ind-ponto ind-ponto-${s.classe}`}
                            role="img"
                            aria-label={`${diaCurto(h.semana)}: ${s.rotulo}`}
                            title={s.rotulo}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div className="ind-legenda">
          <span>
            <span className="ind-ponto ind-ponto-bom" aria-hidden="true" /> completa
          </span>
          <span>
            <span className="ind-ponto ind-ponto-atencao" aria-hidden="true" /> merece atenção
          </span>
          <span>
            <span className="ind-ponto ind-ponto-critico" aria-hidden="true" /> não recebida
          </span>
        </div>
        <LinkDaPlanilha clienteId={clienteId} dados={dados} aoMudar={aoMudar} rotulo="Trocar o link da planilha" />
      </section>

      <div className="ind-filtro" aria-busy={relendo}>
        <div className="meta-segmentos" role="group" aria-label="Janela dos indicadores">
          {JANELAS.map(([k, rotulo]) => (
            <button key={k} type="button" aria-pressed={janela === k} onClick={() => void trocarJanela(k)}>
              {rotulo}
            </button>
          ))}
        </div>
        {erroDaJanela !== null ? (
          <p className="erro" role="alert">
            {erroDaJanela}
          </p>
        ) : null}
      </div>

      {dados.frentes.map((f) => (
        <section key={f.frente} className="ficha-painel" aria-labelledby={`ind-frente-${f.frente}`}>
          <div className="ficha-painel-cabeca">
            <h2 id={`ind-frente-${f.frente}`}>{f.aba}</h2>
            <span className="ind-sub num">
              {f.semanasComDados} de {dados.semanas.length} semanas com dados
            </span>
          </div>
          <ul className="ind-grade">
            {f.metricas.map((m) => {
              const pontos = m.pontos.flatMap((p) => {
                const n = numeroDoPonto(p.leitura, m.unidade)
                return n === null ? [] : [n]
              })
              const variacao = variacaoNaSemana(m.variacaoEmDecimos === null ? null : BigInt(m.variacaoEmDecimos))
              return (
                <li key={m.chave} className="ind-cartao">
                  <b className="ind-nome">{m.nome}</b>
                  <div className="ind-valor num">{textoDaLeitura(m.ultimo?.leitura ?? null, m.unidade)}</div>
                  <div className="ind-linha num">
                    Média {textoDaLeitura(m.media, m.unidade)} · {variacao ?? 'sem semana anterior para comparar'}
                  </div>
                  <Faisca valores={pontos} meta={null} tom="neutro" />
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </>
  )
}

/**
 * A planilha que AINDA NÃO FOI LIDA — os dois estados que existem hoje, com a
 * conta de serviço do Google por criar:
 *  - **sem planilha configurada**: o convite e o formulário do link;
 *  - **aguardando a primeira leitura**: o link guardado, "Abrir planilha",
 *    "Ler planilha agora", o pedido em andamento e a última falha, se houver.
 *
 * Fica abaixo dos indicadores manuais, que continuam valendo até a primeira
 * leitura (no protótipo, sem os dados da planilha, a aba é a manual — L1496).
 */
export function PlanilhaSemLeitura({
  clienteId,
  dados,
  aoMudar,
}: {
  clienteId: string
  dados: PlanilhaDoClienteNaSaida
  aoMudar: (recado: string) => void
}) {
  const planilha = dados.planilha
  return (
    <section className="ficha-painel" aria-labelledby="ind-planilha-titulo">
      <div className="ficha-painel-cabeca">
        <Dica
          rotulo="Como funciona a planilha de indicadores"
          titulo={<h2 id="ind-planilha-titulo">Planilha de indicadores</h2>}
        >
          <p>
            Os parceiros de cada frente (financeiro, comercial, tráfego pago e marketing) preenchem uma linha por semana na
            planilha da cliente. Com o link cadastrado, a ferramenta lê a planilha, confere cada semana e passa a mostrar
            aqui a situação de cada frente e os indicadores dela, no lugar do lançamento manual.
          </p>
        </Dica>
        {planilha !== null ? (
          <div className="ind-cabeca-acoes">
            <a className="link" href={planilha.link} target="_blank" rel="noopener noreferrer">
              Abrir planilha
            </a>
            <LerAgora clienteId={clienteId} aoMudar={aoMudar} />
          </div>
        ) : null}
      </div>

      {planilha === null ? (
        <p className="ficha-vazio">Sem planilha configurada.</p>
      ) : (
        <>
          <p className="ind-estado">
            <span className="ind-chip ind-chip-atencao">Aguardando a primeira leitura</span>
            {planilha.leituraPedidaEm !== null ? (
              <span className="ind-miudo num">Leitura pedida {quando(planilha.leituraPedidaEm, dados)}</span>
            ) : null}
          </p>
          {planilha.erro !== null ? <p className="ind-aviso">{planilha.erro}</p> : null}
        </>
      )}
      <ContaDeServico dados={dados} />
      <LinkDaPlanilha
        clienteId={clienteId}
        dados={dados}
        aoMudar={aoMudar}
        rotulo={planilha === null ? 'Cadastrar o link da planilha' : 'Trocar o link da planilha'}
      />
    </section>
  )
}

/** Com quem compartilhar a planilha — ou o aviso honesto de que a leitura ainda não foi ligada. */
function ContaDeServico({ dados }: { dados: PlanilhaDoClienteNaSaida }) {
  if (dados.emailDaContaDeServico !== null) {
    return (
      <p className="ind-miudo">
        Compartilhe a planilha com <b className="ind-email">{dados.emailDaContaDeServico}</b> como leitor.
      </p>
    )
  }
  return (
    <p className="ind-miudo">
      A leitura automática ainda não foi ligada no servidor. O link fica guardado e a primeira leitura acontece quando ela
      for ligada.
    </p>
  )
}

function LerAgora({ clienteId, aoMudar }: { clienteId: string; aoMudar: (recado: string) => void }) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function ler() {
    setEnviando(true)
    setErro(null)
    try {
      await chamar<{ pedida: true }>(`v1/carteira/clientes/${clienteId}/planilha/ler`, { method: 'POST' })
      aoMudar('Verificando a planilha…')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <button type="button" className="btn ghost" onClick={() => void ler()} disabled={enviando}>
        {enviando ? 'Pedindo…' : 'Ler planilha agora'}
      </button>
      {erro !== null ? (
        <p className="erro ind-erro-largo" role="alert">
          {erro}
        </p>
      ) : null}
    </>
  )
}

/**
 * O link da planilha, recolhido (`design.md` §1: campo raro fica recolhido —
 * cadastra-se uma vez por cliente). O servidor guarda só o id que extrai do
 * link e recusa link que não seja do Google Planilhas (appsec A-16), planilha
 * já ligada a outro cliente (409) e quem não pode gravar o link (403); a tela
 * mostra a frase dele.
 */
function LinkDaPlanilha({
  clienteId,
  dados,
  aoMudar,
  rotulo,
}: {
  clienteId: string
  dados: PlanilhaDoClienteNaSaida
  aoMudar: (recado: string) => void
  rotulo: string
}) {
  const [link, setLink] = useState(dados.planilha?.link ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const dobra = useRef<HTMLDetailsElement>(null)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setEnviando(true)
    setErro(null)
    try {
      const r = await chamar<PlanilhaDefinidaSaida>(`v1/carteira/clientes/${clienteId}/planilha`, {
        method: 'PUT',
        body: JSON.stringify({ link }),
      })
      if (dobra.current !== null) dobra.current.open = false
      aoMudar(r.trocou ? 'Link da planilha salvo.' : 'O link já era este. Nada mudou.')
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <details className="carteira-dobra" ref={dobra}>
      <summary>{rotulo}</summary>
      <form className="ind-form" onSubmit={salvar}>
        <label className="campo">
          Link da planilha
          <input
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            maxLength={2000}
            required
          />
        </label>
        <p className="erro" role="alert" aria-live="polite">
          {erro}
        </p>
        <div className="ind-form-acoes">
          <button type="submit" className="btn" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar link'}
          </button>
        </div>
      </form>
    </details>
  )
}
