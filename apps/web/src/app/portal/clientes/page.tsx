'use client'

import type {
  CampanhaNoPortal,
  ClienteNoPortal,
  CobrancaCarteiraNaLista,
  DocumentoNoPortal,
  MaterialNoPortal,
  MetaComercialNaLista,
  PortalSaida,
  ReuniaoNoPortal,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { diaEmTexto } from '@/lib/formato'
import { usePortal } from '../contexto'
import { ErroDoPortal } from '../pecas'

/**
 * A LEITURA AGREGADA do portal do grupo — uma seção por `Cliente Firmare`
 * visível ao `Usuário do portal` (spec §3.1). READ-ONLY: nenhum botão de
 * criar, editar ou marcar nada — a única ação desta tela é ler.
 *
 * **Dinheiro nunca vem `null` aqui.** Diferente da ficha da carteira (G3,
 * onde nenhum `Usuário de Gestão` tem `valores`), o `Usuário do portal` vê
 * sempre o PRÓPRIO dinheiro — é o dado comercial dele mesmo (ADR 0017 §4). Se
 * um campo monetário chegar `null`, é bug do servidor, não "sem permissão":
 * por isso não tratamos `null` como estado silencioso aqui, e sim como parte
 * do estado de erro quando ele invalida a tela inteira — `formatarDinheiro`
 * mostraria "—" de qualquer forma, mas o comentário fica registrado onde
 * alguém for procurar.
 *
 * **Nenhum total, soma ou percentual nasce aqui.** Tudo que esta tela mostra
 * já chega pronto do servidor — `GET /v1/portal/clientes`.
 */
export default function ClientesDoPortal() {
  const { sessao } = usePortal()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const r = await chamar<PortalSaida>('v1/portal/clientes')
        if (valeu) setEstado({ tag: 'pronto', itens: r.clientes })
      } catch (e) {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar os dados.',
          })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, tentativa])

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return <p className="muted">Carregando…</p>
  }

  if (estado.tag === 'erro') {
    return <ErroDoPortal mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
  }

  if (estado.itens.length === 0) {
    return (
      <section className="vazio">
        <b>Nenhum dado visível ainda.</b>
        <p className="nota">
          Quando a Firmare vincular sua conta a uma clínica, ela aparece aqui.
        </p>
      </section>
    )
  }

  const souGrupo = sessao.usuarioDoPortal.escopo === 'grupo'

  return (
    <div className="portal-clientes">
      <h1 className="titulo">{souGrupo ? 'Suas clínicas' : estado.itens[0]!.nome}</h1>
      {souGrupo ? (
        <div className="portal-lista">
          {estado.itens.map((c, i) => (
            <details key={c.id} className="portal-cartao-cliente" open={estado.itens.length === 1 || i === 0}>
              <summary>
                <span className="portal-nome-cliente">{c.nome}</span>
                <span className="portal-produto">{c.produto}</span>
                <span className={`pill ${PILL_DO_STATUS[c.status]}`}>{c.status}</span>
              </summary>
              <FichaDoCliente cliente={c} />
            </details>
          ))}
        </div>
      ) : (
        <FichaDoCliente cliente={estado.itens[0]!} />
      )}
    </div>
  )
}

type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; itens: ClienteNoPortal[] }

const PILL_DO_STATUS: Record<ClienteNoPortal['status'], string> = {
  onboarding: '',
  ativo: 'bom',
  pausado: 'alerta',
  encerrado: 'mau',
}

const PILL_DA_COBRANCA: Record<CobrancaCarteiraNaLista['status'], string> = {
  aberto: 'alerta',
  pago: 'bom',
  cancelado: 'mau',
}

/**
 * String de centavos → `bigint`. `null` só deveria acontecer se o servidor
 * tivesse apagado o campo — o que, para o `Usuário do portal`, é sempre o
 * PRÓPRIO dinheiro (nunca exige `valores`, ADR 0017 §4). Se vier `null` na
 * prática é bug do backend; `formatarDinheiro(null)` mostra "—" em vez de
 * quebrar a tela.
 */
const centavos = (texto: string | null): bigint | null => (texto === null ? null : BigInt(texto))

const sentidoEmTexto = (s: 'maior_melhor' | 'menor_melhor'): string =>
  s === 'maior_melhor' ? 'quanto maior, melhor' : 'quanto menor, melhor'

function FichaDoCliente({ cliente: c }: { cliente: ClienteNoPortal }) {
  return (
    <div className="portal-ficha">
      <p className="portal-ciclo">
        Mês <span className="num">{c.ciclo.mes}</span> do contrato
      </p>

      <section className="cartao portal-secao">
        <div className="titulo">
          <h2>Metas comerciais</h2>
        </div>
        {c.metas.length === 0 ? (
          <p className="muted">Nenhuma meta comercial definida ainda.</p>
        ) : (
          <div className="portal-lista-interna">
            {c.metas.map((m) => (
              <BlocoDeMeta key={m.id} meta={m} />
            ))}
          </div>
        )}
      </section>

      <section className="cartao portal-secao">
        <div className="titulo">
          <h2>Campanhas</h2>
        </div>
        {c.campanhas.length === 0 ? (
          <p className="muted">Nenhuma campanha registrada ainda.</p>
        ) : (
          <div className="portal-lista-interna">
            {c.campanhas.map((camp, i) => (
              <LinhaDeCampanha key={camp.tipo === 'individual' ? camp.id : `outras-${i}`} campanha={camp} />
            ))}
          </div>
        )}
      </section>

      <section className="cartao portal-secao">
        <div className="titulo">
          <h2>Cobranças</h2>
        </div>
        {c.cobrancas.length === 0 ? (
          <p className="muted">Nenhuma cobrança lançada ainda.</p>
        ) : (
          <div className="portal-lista-interna">
            {c.cobrancas.map((cob) => (
              <LinhaDeCobranca key={cob.id} cobranca={cob} />
            ))}
          </div>
        )}
      </section>

      <section className="cartao portal-secao">
        <div className="titulo">
          <h2>Materiais</h2>
        </div>
        {c.materiais.length === 0 ? (
          <p className="muted">Nenhum material disponível ainda.</p>
        ) : (
          <div className="portal-lista-interna">
            {c.materiais.map((mat) => (
              <LinhaDeMaterial key={mat.id} material={mat} />
            ))}
          </div>
        )}
      </section>

      <section className="cartao portal-secao">
        <div className="titulo">
          <h2>Documentos</h2>
        </div>
        {c.documentos.length === 0 ? (
          <p className="muted">Nenhum documento disponível ainda.</p>
        ) : (
          <div className="portal-lista-interna">
            {c.documentos.map((doc) => (
              <LinhaDeDocumento key={doc.id} documento={doc} />
            ))}
          </div>
        )}
      </section>

      <section className="cartao portal-secao">
        <div className="titulo">
          <h2>Reuniões</h2>
        </div>
        {c.reunioes.length === 0 ? (
          <p className="muted">Nenhuma reunião registrada ainda.</p>
        ) : (
          <div className="portal-lista-interna">
            {c.reunioes.map((r) => (
              <LinhaDeReuniao key={r.id} reuniao={r} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * O valor de uma meta, de um lançamento ou de um resultado — `R$` quando o
 * campo de dinheiro veio preenchido, senão o inteiro bruto (contagem ou
 * percentual em centésimos, conforme a unidade do indicador — o portal não
 * recebe o indicador em si, só os valores já calculados pelo servidor).
 */
function valorOuInteiro(dinheiro: string | null, inteiro: string | null): string {
  if (dinheiro !== null) return formatarDinheiro(centavos(dinheiro))
  if (inteiro !== null) return inteiro
  return '—'
}

function BlocoDeMeta({ meta: m }: { meta: MetaComercialNaLista }) {
  return (
    <div className="portal-meta">
      <div className="portal-meta-cabecalho">
        <div className="portal-linha-info">
          <b>{m.titulo}</b>
          <small className="muted">
            <span className="num">{diaEmTexto(m.inicio)}</span> – <span className="num">{diaEmTexto(m.prazo)}</span>
            {' · '}
            {sentidoEmTexto(m.sentido)}
          </small>
        </div>
        <span className={`pill ${m.status === 'concluida' ? 'bom' : 'alerta'}`}>
          {m.status === 'concluida' ? 'concluída' : 'em andamento'}
        </span>
      </div>
      <div className="portal-meta-linha">
        <span className="muted">
          De <span className="num">{valorOuInteiro(m.valorInicial, m.valorInicialInteiro)}</span> para{' '}
          <span className="num">{valorOuInteiro(m.valorMeta, m.valorMetaInteiro)}</span>
        </span>
        {/* O "progresso" é o ÚLTIMO lançamento, já derivado pelo servidor —
            nenhuma porcentagem é calculada aqui (design.md §5). */}
        {m.ultimoLancamento === null ? (
          <span className="muted">Aguardando o primeiro lançamento.</span>
        ) : (
          <span className="muted">
            Último lançamento:{' '}
            <span className="num">
              {valorOuInteiro(m.ultimoLancamento.valor, m.ultimoLancamento.valorInteiro)}
            </span>{' '}
            em <span className="num">{diaEmTexto(m.ultimoLancamento.referencia)}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Uma campanha — individual, ou "Outras campanhas" quando o servidor já
 * agrupou por supressão de reidentificação (ADR 0013 §4, ADR 0018 critério
 * 9). Esta tela NUNCA tenta desagrupar: o `tipo` já diz o que mostrar.
 */
function LinhaDeCampanha({ campanha }: { campanha: CampanhaNoPortal }) {
  if (campanha.tipo === 'outras') {
    return (
      <div className="portal-linha">
        <div className="portal-linha-info">
          <b>Outras campanhas</b>
          <small className="muted">
            <span className="num">{campanha.quantidade}</span>{' '}
            {campanha.quantidade === 1 ? 'campanha agrupada' : 'campanhas agrupadas'}
          </small>
        </div>
        <span className="valor num">{formatarDinheiro(centavos(campanha.resultadoEmDinheiro))}</span>
      </div>
    )
  }
  return (
    <div className="portal-linha">
      <div className="portal-linha-info">
        <b>{campanha.nome}</b>
      </div>
      <span className="valor num">{formatarDinheiro(centavos(campanha.resultadoEmDinheiro))}</span>
    </div>
  )
}

function LinhaDeCobranca({ cobranca: c }: { cobranca: CobrancaCarteiraNaLista }) {
  return (
    <div className="portal-linha">
      <div className="portal-linha-info">
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
      <span className={`pill ${PILL_DA_COBRANCA[c.status]}`}>{c.status}</span>
    </div>
  )
}

function LinhaDeMaterial({ material: m }: { material: MaterialNoPortal }) {
  return (
    <div className="portal-linha">
      <div className="portal-linha-info">
        <b>{m.titulo}</b>
        <small className="muted">
          {m.tipo}
          {m.descricao !== null ? <> · {m.descricao}</> : null}
        </small>
      </div>
      {m.link !== null ? (
        <a className="link" href={m.link} target="_blank" rel="noopener noreferrer">
          Abrir
        </a>
      ) : null}
    </div>
  )
}

function LinhaDeDocumento({ documento: d }: { documento: DocumentoNoPortal }) {
  return (
    <div className="portal-linha">
      <div className="portal-linha-info">
        <b>{d.titulo}</b>
        <small className="muted">
          {d.categoria} · <span className="num">{diaEmTexto(d.data)}</span>
        </small>
      </div>
      <a className="link" href={d.link} target="_blank" rel="noopener noreferrer">
        Abrir
      </a>
    </div>
  )
}

function LinhaDeReuniao({ reuniao: r }: { reuniao: ReuniaoNoPortal }) {
  return (
    <div className="portal-reuniao">
      <b className="num">{diaEmTexto(r.data)}</b>
      <p className="portal-reuniao-resumo">{r.resumo}</p>
      {r.encaminhamentos !== null ? (
        <p className="muted portal-reuniao-encaminhamentos">Encaminhamentos: {r.encaminhamentos}</p>
      ) : null}
    </div>
  )
}
