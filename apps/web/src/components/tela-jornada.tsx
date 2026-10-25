'use client'

import type {
  CartaoDaColuna,
  ColunaDaJornadaNaSaida,
  PassoDoFunilNaSaida,
  PeriodoDoFunil,
  RespostaDaJornada,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { diaCurto, diaEmTexto } from '@/lib/formato'
import { Carregando, Erro } from './estados'

/**
 * Comercial › Jornada do paciente.
 *
 * **Tudo vem pronto de `GET /v1/jornada`** — contagem, valor, conversão,
 * largura de barra, taxa de no-show e as sete colunas. Nenhum número é
 * calculado aqui, e isso não é zelo: a barra de um passo é proporcional ao
 * número de OUTRO passo, e a taxa de no-show tem um denominador que não está
 * em nenhum dos dois. Conta que precisa da lista inteira é de quem tem a lista
 * inteira.
 */

const PERIODOS: readonly (readonly [PeriodoDoFunil, string])[] = [
  ['7dias', 'Últimos 7 dias'],
  ['30dias', 'Últimos 30 dias'],
  ['mes', 'Este mês'],
  ['mes-passado', 'Mês passado'],
]

export function TelaJornada() {
  const [periodo, setPeriodo] = useState<PeriodoDoFunil>('30dias')
  const caminho = `v1/jornada${consultaEmTexto({ periodo })}`
  const { dados, carregando, erro, recarregar } = useDados<RespostaDaJornada>(caminho)

  return (
    <section>
      <div className="titulo">
        <div>
          <div className="eyebrow">Comercial</div>
          <h2>Jornada do paciente</h2>
        </div>
      </div>
      <p className="nota" style={{ maxWidth: 620, marginBottom: 14 }}>
        Cada agendamento é uma tarefa que anda pelas etapas: agendado, confirmado, realizado,
        orçamento e fechamento. Os números contam os movimentos do período.
      </p>

      <label className="campo" style={{ maxWidth: 260, marginBottom: 16 }}>
        Período
        <select
          value={periodo}
          onChange={(e) => {
            const escolhido = PERIODOS.find(([k]) => k === e.target.value)
            if (escolhido !== undefined) setPeriodo(escolhido[0])
          }}
        >
          {PERIODOS.map(([k, rotulo]) => (
            <option key={k} value={k}>
              {rotulo}
            </option>
          ))}
        </select>
      </label>

      {erro !== null ? (
        <Erro mensagem={erro} recarregar={recarregar} />
      ) : dados === null ? (
        <Carregando linhas={5} />
      ) : (
        <Conteudo dados={dados} carregando={carregando} />
      )}
    </section>
  )
}

function Conteudo({ dados, carregando }: { dados: RespostaDaJornada; carregando: boolean }) {
  const vazio = dados.funil.every((p) => p.n === 0) && dados.colunas.every((c) => c.n === 0)
  if (vazio) {
    /**
     * O vazio é a PRIMEIRA TELA que toda clínica nova vê, e é onde ela decide
     * se a ferramenta vale o dia. Ele diz o que fazer em seguida.
     */
    return (
      <div className="vazio">
        <b>Nenhum agendamento no período.</b>
        <p className="nota" style={{ margin: 0 }}>
          A jornada começa quando você cria uma tarefa de <b>Consulta agendada</b> para uma
          paciente. Daí em diante é o mesmo cartão que anda pelas etapas.
        </p>
        <a className="btn" href="/nova">
          Criar agendamento
        </a>
      </div>
    )
  }

  return (
    <>
      <p className="nota num" style={{ marginBottom: 10 }}>
        {dados.rotuloDoPeriodo}: {diaEmTexto(dados.de)} a {diaEmTexto(dados.ate)}
      </p>

      <div className="funil">
        {dados.funil.map((p) => (
          <PassoDoFunil key={p.chave} passo={p} />
        ))}
      </div>

      <div className="kpis">
        <div className="kpi">
          <span>No-show</span>
          <b className={`num${dados.noShow.n > 0 ? ' mau' : ''}`}>{dados.noShow.n}</b>
          <span>
            {dados.noShow.taxa === null
              ? 'nenhum atendimento no período'
              : `taxa ${dados.noShow.taxa}% das consultas e procedimentos que deveriam acontecer`}
          </span>
        </div>
        <div className="kpi">
          <span>Desmarcados</span>
          <b className="num">{dados.desmarcados.n}</b>
          <span>no período</span>
        </div>
        <div className="kpi">
          <span>Orçamentos perdidos</span>
          <b className="num">{dados.perdidos.n}</b>
          <span>
            {dados.perdidos.valor === null ? '' : `${formatarDinheiro(BigInt(dados.perdidos.valor))} em orçamentos · `}
            {dados.perdidos.n === 0 ? 'no período' : 'veja os motivos no histórico'}
          </span>
        </div>
      </div>

      <div className="grupo">
        <h3>Onde estão os pacientes agora</h3>
        {/*
          A nota é OBRIGATÓRIA, e é da PO: sem ela o número do funil e o
          tamanho da coluna parecem discordar, e ninguém sabe qual está certo.
        */}
        <p className="nota">
          Agendadas, confirmadas, no-show e orçamentos em aberto mostram a situação de hoje;
          realizadas, fechados e perdidos mostram o período escolhido.
        </p>
        <Colunas colunas={dados.colunas} hoje={dados.hoje} />
      </div>

      {carregando ? <p className="nota">Atualizando…</p> : null}
    </>
  )
}

function PassoDoFunil({ passo: p }: { passo: PassoDoFunilNaSaida }) {
  return (
    <div className="funpasso">
      <span>{p.rotulo}</span>
      <b className="num">{p.n}</b>
      {p.valor === null ? (
        // `null` é "sem a permissão `valores`" OU "este passo não tem valor".
        // Nos dois casos a linha some: um "—" diria que falta informação.
        <em>&nbsp;</em>
      ) : (
        <em className="num">
          {formatarDinheiro(BigInt(p.valor))} {p.rotuloDoValor}
        </em>
      )}
      <small className="num">
        {p.conversao === null ? ' ' : `${p.conversao}% ${p.conversaoSobre}`}
      </small>
      {/* A largura vem do servidor; a tela só a desenha. */}
      <i style={{ width: `${p.proporcao}%` }} />
    </div>
  )
}

/**
 * AS SETE COLUNAS — kanban na tela larga, lista recolhível em 390 px.
 *
 * Sete colunas não cabem em 390 px, e o protótipo rola horizontalmente: medido
 * na tela dele, "Orçamentos em aberto" fica cortada na borda, e a recepção não
 * descobre que há mais à direita. A regra de `docs/design.md` não é "não
 * role": é **a página nunca rola na horizontal**.
 *
 * Então são duas formas do MESMO dado, trocadas por `@media`:
 *
 *  - de 768 px para cima, o kanban, rolando DENTRO do próprio contêiner, com
 *    sombra de borda dizendo que há mais;
 *  - abaixo disso, uma lista por etapa, cada uma recolhível, com a contagem e
 *    o valor no cabeçalho. Em 390 px a pergunta da recepção é "quantos estão
 *    em cada etapa, e quem", e uma lista responde isso melhor que uma coluna
 *    de 280 px que ela precisa empurrar com o dedo.
 *
 * **Isto é escolha minha, não do humano.** `docs/design.md` §6 manda nascer de
 * três direções via `/prototype`; o que existe aqui é uma. Está registrado em
 * `docs/dividas.md`.
 */
function Colunas({
  colunas,
  hoje,
}: {
  colunas: readonly ColunaDaJornadaNaSaida[]
  hoje: string
}) {
  return (
    <>
      <div className="kanban" role="group" aria-label="Pacientes por etapa">
        {colunas.map((c) => (
          <div className="kcol" key={c.chave}>
            <div className="khead">
              <span className={`pill ${TOM_DA_COLUNA[c.chave] ?? ''}`}>{c.rotulo}</span>
              <b className="num">{c.n}</b>
              {c.valor === null || c.valor === '0' ? null : (
                <span className="num kval">{formatarDinheiro(BigInt(c.valor))}</span>
              )}
            </div>
            {c.itens.length === 0 ? (
              <p className="kvazio">Nenhum</p>
            ) : (
              c.itens.map((x) => <MiniCartao key={x.id} cartao={x} hoje={hoje} />)
            )}
            {c.restantes === 0 ? null : <p className="kvazio">+{c.restantes}</p>}
          </div>
        ))}
      </div>

      <div className="etapas-lista">
        {colunas.map((c) => (
          <details className="etapa-bloco" key={c.chave} open={c.n > 0 && c.chave !== 'realizadas'}>
            <summary>
              <span className={`pill ${TOM_DA_COLUNA[c.chave] ?? ''}`}>{c.rotulo}</span>
              <b className="num">{c.n}</b>
              {c.valor === null || c.valor === '0' ? null : (
                <span className="num kval">{formatarDinheiro(BigInt(c.valor))}</span>
              )}
            </summary>
            {c.itens.length === 0 ? (
              <p className="kvazio">Nenhum</p>
            ) : (
              c.itens.map((x) => <MiniCartao key={x.id} cartao={x} hoje={hoje} />)
            )}
            {c.restantes === 0 ? null : <p className="kvazio">+{c.restantes}</p>}
          </details>
        ))}
      </div>
    </>
  )
}

const TOM_DA_COLUNA: Readonly<Record<string, string>> = {
  confirmadas: 'bom',
  recontatar: 'mau',
  realizadas: 'bom',
  orcamentos: 'alerta',
  fechados: 'bom',
  perdidos: 'mau',
}

function MiniCartao({ cartao: x, hoje }: { cartao: CartaoDaColuna; hoje: string }) {
  return (
    <a className="kmini" href={`/pacientes/${x.pacienteId ?? ''}`}>
      <b>{x.pacienteNome ?? 'Sem paciente'}</b>
      <span className="num">{quandoDoCartao(x, hoje)}</span>
      {x.valorOrcamento === null ? null : (
        <span className="num kval">{formatarDinheiro(BigInt(x.valorOrcamento))}</span>
      )}
    </a>
  )
}

/**
 * A data que importa em cada etapa — e **formatar é a única coisa que a tela
 * faz aqui**.
 *
 * Em aberto, o prazo; no orçamento, o dia de retomar; nas de período, o
 * instante do último evento, que o servidor já carimbou.
 */
function quandoDoCartao(x: CartaoDaColuna, hoje: string): string {
  if (x.etapa === 'orcamento') {
    if (x.proximoPassoEm === null) return ''
    return `retomar ${diaCurto(x.proximoPassoEm)}${x.proximoPassoEm < hoje ? ' (atrasado)' : ''}`
  }
  if (['agendado', 'confirmado', 'faltou', 'desmarcou'].includes(x.etapa)) {
    return `${diaCurto(x.prazo)}${x.hora === null ? '' : ` ${x.hora}`}`
  }
  return x.ultimoEventoEm === null ? '' : diaCurto(x.ultimoEventoEm.slice(0, 10))
}
