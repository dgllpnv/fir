'use client'

import type {
  AcaoDoPlanoSalvaSaida,
  AniversarioNaLista,
  EntregaDoPlano,
  ParabenizarSaida,
  StatusDeAcaoDoPlano,
  UsuarioDeGestaoPublico,
  VisaoGeralDaCarteiraSaida,
} from '@fir/contracts'
import { temPermCarteira } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { LinhaDeSinal } from '@/components/carteira/lead-pecas'
import { useEquipeEClientes } from '@/components/carteira/rotina-pecas'
import { FormularioDeTarefa } from '@/components/carteira/rotina-tarefa'
import { Carregando, Toast } from '@/components/estados'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaCurto, nomeDoDia, plural } from '@/lib/formato'

/**
 * **VISÃO GERAL DA CARTEIRA**, o componente — uma tela, duas casas
 * (D-23 item 6, ADR 0024): `/carteira` (a sessão de quem entrou na
 * carteira) e `/gestao` (a sessão da conta de gestão do operador,
 * aberta pelo login do painel). O corpo é UM só, para as duas não divergirem
 * do protótipo cada uma do seu jeito; a casa entrega só a navegação, o erro
 * com as saídas dela, e o desvio de quem não pode abrir a tela.
 *
 * Os links internos levam a `/carteira/...` nas duas casas: é a sessão da
 * carteira que abre a ficha, as mensalidades e a rotina.
 *
 * ---
 *
 * **VISÃO GERAL DA CARTEIRA** (G8 3B; `vPainel`, protótipo L1278–1331): a
 * tela de abertura da diretoria. Na ordem do protótipo: cabeçalho com os três
 * atalhos (P11), os quatro KPIs (P1), Saúde da carteira (P2) ao lado de
 * Equipe (P3) e Reuniões da semana (P4), Aniversários (P6), Prospecção ·
 * contatos recomendados (P9) e Próximas entregas do plano (P10).
 *
 * NADA é calculado aqui. Contagens, MRR, ticket, baldes, ordem, "atrasada",
 * "hoje" e até a posição de cada pedaço das barras chegam do servidor
 * (`GET /v1/carteira/painel`); a tela formata. Sem `valores`, o servidor já
 * apagou o dinheiro — `podeVerValores` só troca "—" por "restrito" (L1119).
 *
 * Quem não tem a tela `painel` (todo `escopo='grupo'`, A-5) é levado à
 * primeira área que pode abrir, como o protótipo faz (L1266).
 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']
const ROTULO_DA_SAUDE = { bom: 'Bom', atencao: 'Atenção', critico: 'Crítico' } as const
const ROTULO_DO_STATUS: Record<StatusDeAcaoDoPlano, string> = {
  pendente: 'Pendente',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
}

const dataPorExtenso = (dia: string): string => `${nomeDoDia(dia).replace(/^./, (l) => l.toUpperCase())}, ${Number(dia.slice(8, 10))} de ${MESES[Number(dia.slice(5, 7)) - 1] ?? ''}`

type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; visao: VisaoGeralDaCarteiraSaida }

type Atalho = { tag: 'nenhum' } | { tag: 'reuniao' } | { tag: 'tarefa' }

export function VisaoGeral({
  usuario,
  navegacao,
  erro,
  semPermissao,
}: {
  /** A sessão da CARTEIRA; `null` enquanto não se sabe. */
  usuario: UsuarioDeGestaoPublico | null
  /** O menu da casa no topo da tela — `null` onde a casa tem lateral (a carteira). */
  navegacao: ReactNode
  /** O erro com as saídas da casa (a carteira e o painel têm saídas diferentes). */
  erro: (mensagem: string, recarregar: () => void) => ReactNode
  /** Quem não tem a tela `painel` (A-5): para onde a casa o leva. */
  semPermissao: (usuario: UsuarioDeGestaoPublico) => void
}) {
  const router = useRouter()
  const podePainel = usuario !== null && temPermCarteira(usuario, 'painel')
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [atalho, setAtalho] = useState<Atalho>({ tag: 'nenhum' })
  const [recado, setRecado] = useState<string | null>(null)
  const { equipe, clientes } = useEquipeEClientes(atalho.tag === 'tarefa')

  useEffect(() => {
    if (usuario !== null && !podePainel) semPermissao(usuario)
  }, [usuario, podePainel, semPermissao])

  useEffect(() => {
    if (!podePainel) return
    let valeu = true
    setEstado((e) => (e.tag === 'pronto' ? e : { tag: 'carregando' }))
    chamar<VisaoGeralDaCarteiraSaida>('v1/carteira/painel')
      .then((visao) => {
        if (valeu) setEstado({ tag: 'pronto', visao })
      })
      .catch((e: unknown) => {
        if (valeu) setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar a visão geral.' })
      })
    return () => {
      valeu = false
    }
  }, [podePainel, tentativa])

  const recarregar = () => setTentativa((n) => n + 1)

  if (!podePainel || estado.tag === 'carregando') {
    return (
      <section>
        {navegacao}
        <Carregando linhas={6} />
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section>
        {navegacao}
        {erro(estado.mensagem, recarregar)}
      </section>
    )
  }

  const v = estado.visao
  const veClientes = usuario !== null && temPermCarteira(usuario, 'clientes')
  const veRotina = usuario !== null && temPermCarteira(usuario, 'rotina')
  const dinheiro = (centavos: string | null) =>
    v.podeVerValores ? formatarDinheiro(centavos === null ? null : BigInt(centavos)) : 'restrito'

  return (
    <section className="visao">
      {navegacao}

      <header className="visao-cabeca">
        <div className="visao-identidade">
          <p className="eyebrow">{dataPorExtenso(v.hoje)}</p>
          <h1 className="titulo">Olá, {v.nome}</h1>
          <p className="nota">Visão do todo da carteira, do plano de ação e da rotina da equipe.</p>
        </div>
        <div className="visao-atalhos">
          {veClientes ? (
            <button type="button" className="btn ghost" onClick={() => setAtalho({ tag: 'reuniao' })}>
              Registrar reunião
            </button>
          ) : null}
          {veRotina ? (
            <button type="button" className="btn ghost" onClick={() => setAtalho({ tag: 'tarefa' })}>
              Nova tarefa
            </button>
          ) : null}
          {veClientes ? (
            <Link className="btn" href="/carteira/entrada">
              Novo cliente
            </Link>
          ) : null}
        </div>
      </header>

      {atalho.tag === 'reuniao' ? (
        <EscolherClienteDaReuniao
          clientes={v.clientesAtivos}
          aoEscolher={(id) => router.push(`/carteira/clientes/${id}?aba=reunioes&registrar=1`)}
          aoFechar={() => setAtalho({ tag: 'nenhum' })}
        />
      ) : null}
      {atalho.tag === 'tarefa' && usuario !== null ? (
        <FormularioDeTarefa
          tarefa={null}
          hoje={v.hoje}
          eu={equipe?.eu ?? usuario.id}
          pessoas={equipe?.pessoas ?? []}
          clientes={clientes}
          aoSalvar={(t) => {
            setAtalho({ tag: 'nenhum' })
            setRecado(`Tarefa "${t.titulo}" criada`)
            recarregar()
          }}
          aoFechar={() => setAtalho({ tag: 'nenhum' })}
        />
      ) : null}

      <div className="visao-kpis">
        <div className="visao-kpi">
          <span>Clientes ativos</span>
          <b className="num">{v.kpis.clientesAtivos}</b>
          <small className="num">{v.kpis.emOnboarding} em onboarding</small>
        </div>
        <div className="visao-kpi">
          <span>Receita recorrente mensal</span>
          <b className="num">{dinheiro(v.kpis.mrr)}</b>
          <small className="num">Ticket médio {dinheiro(v.kpis.ticketMedio)}</small>
        </div>
        <div className={v.kpis.acoesAtrasadas > 0 ? 'visao-kpi visao-kpi-alerta' : 'visao-kpi'}>
          <span>Ações do plano atrasadas</span>
          <b className="num">{v.kpis.acoesAtrasadas}</b>
          <small className="num">em {plural(v.kpis.clientesComAcaoAtrasada, 'cliente', 'clientes')}</small>
        </div>
        <div className={v.kpis.tarefasVencidas > 0 ? 'visao-kpi visao-kpi-alerta' : 'visao-kpi'}>
          <span>Tarefas da equipe vencidas</span>
          <b className="num">{v.kpis.tarefasVencidas}</b>
          <small className="num">{v.kpis.tarefasVencemHoje} vencem hoje</small>
        </div>
      </div>

      <div className="visao-duas">
        <SaudeDaCarteira visao={v} />
        <div className="visao-painel">
          <div className="visao-painel-cabeca">
            <h2>Equipe</h2>
            <Link className="link" href="/carteira/rotina">
              Abrir rotina
            </Link>
          </div>
          {v.equipe.pessoas.length === 0 ? (
            <p className="visao-vazio">Ninguém na equipe além da diretoria.</p>
          ) : (
            <ul className="visao-equipe">
              {v.equipe.pessoas.map((p) => (
                <li key={p.id} className="visao-membro">
                  <span className="visao-avatar" aria-hidden="true">
                    {p.iniciais}
                  </span>
                  <div className="visao-membro-corpo">
                    <span>
                      <b>{p.nome}</b> <span className="visao-mudo num">· {plural(p.clientes, 'cliente', 'clientes')}</span>
                    </span>
                    <Barra
                      total={v.equipe.escala}
                      segmentos={p.barra}
                      rotulo={`${p.pendentes} tarefas, ${p.vencidas} vencidas`}
                    />
                  </div>
                  <div className="visao-membro-nums num">
                    {plural(p.pendentes, 'tarefa', 'tarefas')}
                    <br />
                    {p.vencidas > 0 ? <b className="visao-tarde">{plural(p.vencidas, 'vencida', 'vencidas')}</b> : 'em dia'}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="visao-painel-cabeca visao-painel-cabeca-segunda">
            <h2>Reuniões da semana</h2>
          </div>
          {v.reunioesDaSemana.length === 0 ? (
            <p className="visao-vazio">Nenhum cliente com reunião fixa.</p>
          ) : (
            <ul className="visao-linhas">
              {v.reunioesDaSemana.map((r) => (
                <li key={r.clienteId}>
                  <Link className="visao-linha" href={`/carteira/clientes/${r.clienteId}`}>
                    <span className="visao-linha-titulo">{r.nome}</span>
                    <span className={r.ehHoje ? 'visao-chip visao-chip-ouro num' : 'visao-chip num'}>
                      {r.ehHoje ? 'hoje' : DIAS[r.diaDaSemana]} {r.hora ?? ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {v.aniversarios.length > 0 ? <Aniversarios lista={v.aniversarios} /> : null}

      {v.contatosRecomendados !== null ? (
        <div className="visao-painel">
          <div className="visao-painel-cabeca">
            <h2>Prospecção · contatos recomendados</h2>
            <Link className="link" href="/carteira/leads">
              Abrir prospecção
            </Link>
          </div>
          {v.contatosRecomendados.length === 0 ? (
            <p className="visao-vazio">Nenhum contato pendente agora.</p>
          ) : (
            <ul className="lead-sinais">
              {v.contatosRecomendados.map((l) => (
                <LinhaDeSinal key={l.id} lead={l} sinal={l.sinal!} />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <ProximasEntregas
        entregas={v.proximasEntregas}
        podeConcluir={veClientes}
        aoMudar={(texto) => {
          setRecado(texto)
          recarregar()
        }}
      />

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * Uma barra empilhada. Os segmentos chegam POSICIONADOS do servidor
 * (`segmentosDaBarra`): aqui só se desenha, num `viewBox` do tamanho do total
 * — nenhuma proporção é calculada na tela, e nenhum `style` inline.
 */
function Barra({
  total,
  segmentos,
  rotulo,
}: {
  total: number
  segmentos: readonly { chave: string; inicio: number; largura: number }[]
  rotulo: string
}) {
  return (
    <svg className="visao-barra" viewBox={`0 0 ${Math.max(total, 1)} 1`} preserveAspectRatio="none" role="img" aria-label={rotulo}>
      <rect className="visao-barra-fundo" x={0} y={0} width={Math.max(total, 1)} height={1} />
      {segmentos.map((s) => (
        <rect key={s.chave} className={`visao-barra-${s.chave}`} x={s.inicio} y={0} width={s.largura} height={1} />
      ))}
    </svg>
  )
}

function SaudeDaCarteira({ visao: v }: { visao: VisaoGeralDaCarteiraSaida }) {
  const s = v.saude
  return (
    <div className="visao-painel">
      <div className="visao-painel-cabeca">
        <h2>Saúde da carteira</h2>
        <Link className="link" href="/carteira/clientes">
          Ver clientes
        </Link>
      </div>
      <Barra
        total={v.kpis.clientesAtivos}
        segmentos={s.barra}
        rotulo={`${s.bom} bom, ${s.atencao} atenção, ${s.critico} crítico${s.semSaude > 0 ? `, ${s.semSaude} sem saúde registrada` : ''}`}
      />
      <p className="visao-legenda num">
        <span>
          <b>{s.bom}</b> bom
        </span>
        <span>
          <b>{s.atencao}</b> atenção
        </span>
        <span>
          <b>{s.critico}</b> crítico
        </span>
        {s.semSaude > 0 ? (
          <span>
            <b>{s.semSaude}</b> sem saúde registrada
          </span>
        ) : null}
      </p>
      {s.emRisco.length === 0 ? (
        <p className="visao-vazio">Nenhum cliente em atenção ou crítico.</p>
      ) : (
        <ul className="visao-linhas">
          {s.emRisco.map((c) => (
            <li key={c.id}>
              <Link className="visao-linha visao-linha-risco" href={`/carteira/clientes/${c.id}`}>
                <span className="visao-linha-titulo">{c.nome}</span>
                <span className={`visao-chip visao-chip-${c.saude}`}>{ROTULO_DA_SAUDE[c.saude]}</span>
                <span className="visao-linha-detalhe">
                  {c.resumoDaUltimaReuniao ?? 'Sem reunião registrada.'}
                  {c.acoesAtrasadas > 0 ? (
                    <>
                      {' · '}
                      <span className="visao-tarde">
                        {c.acoesAtrasadas} {c.acoesAtrasadas > 1 ? 'ações atrasadas' : 'ação atrasada'}
                      </span>
                    </>
                  ) : null}
                  {' · '}
                  {c.responsavelNome ?? '—'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const quando = (a: AniversarioNaLista): string =>
  a.emDias === 0 ? 'Hoje' : a.emDias === 1 ? 'Amanhã' : `Em ${a.emDias} dias · ${diaCurto(a.data)}`

/**
 * Aniversários de hoje e dos próximos 7 dias (`painelAniversarios`,
 * L1910–1914). Sem idade (LGPD A46) e sem telefone na tela (A45): o
 * "Parabenizar" pede o link ao servidor no clique e abre o WhatsApp.
 */
function Aniversarios({ lista }: { lista: readonly AniversarioNaLista[] }) {
  const [erro, setErro] = useState('')
  async function parabenizar(a: AniversarioNaLista) {
    setErro('')
    try {
      const r = await chamar<ParabenizarSaida>('v1/carteira/aniversarios/parabenizar', {
        method: 'POST',
        body: JSON.stringify({ tipo: a.tipo, id: a.id }),
      })
      window.open(r.url, '_blank', 'noopener')
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível abrir o WhatsApp.')
    }
  }
  return (
    <div className="visao-painel">
      <div className="visao-painel-cabeca">
        <h2>Aniversários</h2>
        <span className="visao-mudo">Hoje e nos próximos 7 dias</span>
      </div>
      <ul className="visao-linhas">
        {lista.map((a) => (
          <li key={`${a.tipo}-${a.id}`} className="visao-linha">
            <span className="visao-linha-titulo">
              {a.nome} <span className="visao-mudo">· {a.sub}</span>
            </span>
            <span className="visao-linha-acoes">
              <span className={a.emDias === 0 ? 'visao-chip visao-chip-ouro num' : 'visao-chip num'}>{quando(a)}</span>
              {a.podeParabenizar ? (
                <button type="button" className="btn ghost visao-mini" onClick={() => void parabenizar(a)}>
                  Parabenizar
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
    </div>
  )
}

/**
 * Próximas entregas do plano de ação (L1327–1330, `tabelaAcoes` L1335–1345):
 * atrasadas e dos próximos 7 dias, com o check que conclui. O check chama a
 * MESMA rota da ficha (`.../acoes-do-plano/:acaoId/alternar`); a lista volta
 * do servidor depois. Em 390 px cada ação é uma linha empilhada, nunca uma
 * tabela que rola de lado.
 */
function ProximasEntregas({
  entregas,
  podeConcluir,
  aoMudar,
}: {
  entregas: readonly EntregaDoPlano[]
  podeConcluir: boolean
  aoMudar: (recado: string) => void
}) {
  const [ocupada, setOcupada] = useState<string | null>(null)
  const [erro, setErro] = useState('')

  async function alternar(a: EntregaDoPlano) {
    setErro('')
    setOcupada(a.id)
    try {
      const r = await chamar<AcaoDoPlanoSalvaSaida>(
        `v1/carteira/clientes/${a.clienteCarteiraId}/acoes-do-plano/${a.id}/alternar`,
        { method: 'POST' },
      )
      aoMudar(r.acao.status === 'concluida' ? `"${a.titulo}" concluída` : `"${a.titulo}" reaberta`)
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível concluir a ação.')
    } finally {
      setOcupada(null)
    }
  }

  return (
    <div className="visao-painel">
      <div className="visao-painel-cabeca">
        <h2>Próximas entregas do plano de ação</h2>
        <span className="visao-mudo">Atrasadas e dos próximos 7 dias</span>
      </div>
      {entregas.length === 0 ? (
        <p className="visao-vazio">Nenhuma ação aqui.</p>
      ) : (
        <ul className="visao-entregas">
          {entregas.map((a) => (
            <li key={a.id} className="visao-entrega">
              <button
                type="button"
                className={a.status === 'concluida' ? 'visao-check visao-check-feito' : 'visao-check'}
                aria-label={`Concluir ação: ${a.titulo}`}
                disabled={!podeConcluir || ocupada === a.id}
                onClick={() => void alternar(a)}
              />
              <div className="visao-entrega-acao">
                <b>{a.titulo}</b>
                <span className="visao-mudo">
                  {a.tipo === 'comercial' ? 'Ação comercial' : 'Plano de ação'}
                  {a.metaTitulo !== null ? ` · ${a.metaTitulo}` : ''}
                </span>
              </div>
              <Link className="link visao-entrega-cliente" href={`/carteira/clientes/${a.clienteCarteiraId}?aba=plano`}>
                {a.clienteNome}
              </Link>
              <span className="visao-entrega-quem">
                {a.quemExecuta === 'firmare' ? `Firmare · ${a.acompanhamentoNome ?? '—'}` : 'Cliente'}
              </span>
              <span className={a.atrasada ? 'visao-chip visao-chip-critico' : 'visao-chip'}>
                {a.atrasada ? 'Atrasada' : ROTULO_DO_STATUS[a.status]}
              </span>
              <span className={a.atrasada ? 'visao-entrega-prazo num visao-tarde' : 'visao-entrega-prazo num'}>
                {a.prazo !== null ? diaCurto(a.prazo) : ''}
                {a.atrasada && a.diasDeAtraso !== null ? <small>{plural(a.diasDeAtraso, 'dia', 'dias')}</small> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p role="alert" aria-live="polite" className="erro">
        {erro}
      </p>
    </div>
  )
}

/** O atalho "Registrar reunião" (P11): escolher o cliente e abrir o formulário da ficha (V14). */
function EscolherClienteDaReuniao({
  clientes,
  aoEscolher,
  aoFechar,
}: {
  clientes: readonly { id: string; nome: string }[]
  aoEscolher: (id: string) => void
  aoFechar: () => void
}) {
  const [escolhido, setEscolhido] = useState(clientes[0]?.id ?? '')
  return (
    <Modal titulo="Registrar reunião" aoFechar={aoFechar}>
      {clientes.length === 0 ? (
        <p className="nota">Nenhum cliente ativo na sua carteira.</p>
      ) : (
        <form
          className="carteira-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (escolhido !== '') aoEscolher(escolhido)
          }}
        >
          <label className="campo">
            Cliente
            <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
          <div className="visao-atalhos">
            <button type="submit" className="btn">
              Continuar
            </button>
            <button type="button" className="btn ghost" onClick={aoFechar}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
