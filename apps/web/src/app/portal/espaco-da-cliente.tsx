'use client'

import type {
  ArquivoNoPortal,
  CampanhaNoPortal,
  ClienteNoPortal,
  CobrancaCarteiraNaLista,
  MaterialNoPortal,
  MetaNoPortal,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { textoDoAlvo, textoDoNumero, textoGuardado } from '@/components/carteira/meta-pecas'
import { Modal } from '@/components/modal'
import { diaEmTexto } from '@/lib/formato'

/**
 * **O ESPAÇO DA CLIENTE** — a seção de UM `Cliente Firmare`, como o protótipo
 * a desenha (`fg-portal.js` L148–163): cabeçalho com a saudação e o ciclo,
 * acessos, metas, materiais, documentos, reuniões e a consultora. Mais as
 * duas seções que o nosso portal já mostrava e o protótipo não tem
 * (campanhas e cobranças, decisões do G6).
 *
 * A MESMA peça serve o portal (`/portal/clientes`) e a prévia "ver como a
 * cliente" (`/portal/previa/[id]`) — a única diferença é de onde se baixa o
 * anexo de arquivo (`baseDosAnexos`), porque cada uma tem a sua sessão.
 *
 * **Nada é calculado aqui.** Ciclo, percentual da meta, altura das barras,
 * supressão e total das campanhas chegam prontos do servidor. Sem `style=`:
 * as barras são SVG, com a medida em atributo (identidade.test.ts).
 * **Nenhum `if` de dinheiro:** sem `ve_valores` (ou sem `valores`, na
 * prévia), o servidor já apagou o campo, e o formatador mostra "—".
 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

const mesDe = (dia: string): number => Number(dia.slice(5, 7)) - 1
/** `aaaa-mm-dd` → "8 de novembro de 2026" (`dataBR(s, true)`, portal:L6). */
const diaLongo = (dia: string): string => `${Number(dia.slice(8, 10))} de ${MESES[mesDe(dia)] ?? ''} de ${dia.slice(0, 4)}`
/** `aaaa-mm-dd` → "08 nov" (`dataBR(s)`, portal:L6). */
const diaECurto = (dia: string): string => `${dia.slice(8, 10)} ${MESES_CURTOS[mesDe(dia)] ?? ''}`
const tamanho = (bytes: number): string =>
  bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

export function EspacoDaCliente({
  cliente: c,
  baseDosAnexos,
  comCabecalho = true,
}: {
  cliente: ClienteNoPortal
  /** `v1/portal/anexos` no portal; `v1/carteira/anexos` na prévia. */
  baseDosAnexos: string
  /** No escopo de grupo o nome já está no resumo recolhível — o cabeçalho repetiria. */
  comCabecalho?: boolean
}) {
  return (
    <div className="portal-espaco">
      {comCabecalho ? (
        <section className="portal-heroi">
          <div>
            <div className="portal-sobrelinha">{c.nome}</div>
            <h1 className="portal-ola">Olá, {c.saudacao ?? 'seja bem vinda'}</h1>
            <p className="portal-boas-vindas">
              Este é o seu espaço na Firmare: os seus acessos, as metas da clínica, os materiais do programa e o registro
              do que combinamos em cada reunião.
            </p>
          </div>
          <CartaoDoCiclo cliente={c} />
        </section>
      ) : (
        <CartaoDoCiclo cliente={c} />
      )}

      <SeusAcessos cliente={c} />

      <section className="portal-secao-da-cliente">
        <h2 className="portal-secao-titulo">
          Metas da clínica <small>atualizadas na reunião semanal</small>
        </h2>
        {c.metas.length === 0 ? (
          <p className="portal-vazio-tracejado">As metas aparecem aqui assim que forem definidas com a equipe Firmare.</p>
        ) : (
          <div className="portal-grade">
            {c.metas.map((m) => (
              <CartaoDaMeta key={m.id} meta={m} />
            ))}
          </div>
        )}
      </section>

      <Materiais cliente={c} />

      {c.documentos.length > 0 ? (
        <section className="portal-secao-da-cliente">
          <h2 className="portal-secao-titulo">Documentos</h2>
          <div className="portal-lista-papel">
            {c.documentos.map((d) => (
              <div key={d.id} className="portal-linha-papel">
                <span className="portal-linha-texto">
                  {d.titulo}
                  <span className="portal-linha-detalhe">
                    {d.categoria} · <span className="num">{diaECurto(d.data)}</span>
                  </span>
                  <Arquivos arquivos={d.arquivos} base={baseDosAnexos} />
                </span>
                <a className="portal-abrir" href={d.link} target="_blank" rel="noopener noreferrer">
                  Abrir →
                </a>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="portal-secao-da-cliente">
        <h2 className="portal-secao-titulo">Reuniões</h2>
        {c.reunioes.length === 0 ? (
          <p className="portal-vazio-tracejado">O resumo de cada reunião e os próximos passos ficam registrados aqui.</p>
        ) : (
          <div className="portal-lista-papel">
            {c.reunioes.map((r) => (
              <div key={r.id} className="portal-ata">
                <div className="portal-ata-data num">
                  {diaECurto(r.data)}
                  <span className="portal-mini">{r.data.slice(0, 4)}</span>
                </div>
                <div>
                  <p className="portal-ata-resumo">{r.resumo}</p>
                  {r.encaminhamentos !== null ? (
                    <div className="portal-ata-passos">
                      <b>Próximos passos:</b> <span className="portal-quebra">{r.encaminhamentos}</span>
                    </div>
                  ) : null}
                  {r.links.length + r.arquivos.length > 0 ? (
                    <div className="portal-anexos">
                      {r.links.map((a) => (
                        <a key={a.url} className="portal-anexo" href={a.url} target="_blank" rel="noopener noreferrer">
                          {a.nome}
                        </a>
                      ))}
                      {r.arquivos.map((a) => (
                        <a key={a.id} className="portal-anexo" href={`/api/${baseDosAnexos}/${a.id}/conteudo`} rel="noopener noreferrer">
                          {a.nome}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Campanhas cliente={c} />

      {c.cobrancas.length > 0 ? (
        <section className="portal-secao-da-cliente">
          <h2 className="portal-secao-titulo">Mensalidades</h2>
          <div className="portal-lista-papel">
            {c.cobrancas.map((cob) => (
              <LinhaDeCobranca key={cob.id} cobranca={cob} />
            ))}
          </div>
        </section>
      ) : null}

      {c.consultora !== null ? (
        <section className="portal-consultora">
          <div className="portal-avatar" aria-hidden="true">
            {c.consultora.nome.slice(0, 1)}
          </div>
          <div>
            <div className="portal-mini">Sua consultora na Firmare</div>
            <div className="portal-consultora-nome">{c.consultora.nome}</div>
            {c.consultora.reuniao !== null ? (
              <div className="portal-mini">
                Reunião fixa: {DIAS[c.consultora.reuniao.diaDaSemana]}
                {c.consultora.reuniao.hora !== null ? <> às <span className="num">{c.consultora.reuniao.hora}</span></> : null}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}

/** O cartão do ciclo (portal:L104–113) — três formas, todas decididas no servidor. */
function CartaoDoCiclo({ cliente: c }: { cliente: ClienteNoPortal }) {
  const ciclo = c.ciclo
  return (
    <div className="portal-ciclo-cartao">
      <span className="portal-ciclo-rotulo">{c.produto || 'Programa'}</span>
      {ciclo.tipo === 'com_fim' ? (
        <>
          <b className="portal-ciclo-numero num">
            Mês {ciclo.mes} de {ciclo.total}
          </b>
          <svg className="portal-trilho" viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label={`${ciclo.percentual}% do ciclo`}>
            <rect className="portal-trilho-fundo" x="0" y="0" width="100" height="6" rx="3" />
            <rect className="portal-trilho-cheio" x="0" y="0" width={ciclo.percentual} height="6" rx="3" />
          </svg>
          <small className="portal-ciclo-legenda">
            De {diaLongo(ciclo.inicio)} a {diaLongo(ciclo.fim)}
          </small>
        </>
      ) : ciclo.tipo === 'recorrente' ? (
        <>
          <b className="portal-ciclo-numero num">{ciclo.mes}º mês juntos</b>
          <small className="portal-ciclo-legenda">Desde {diaLongo(ciclo.inicio)}</small>
        </>
      ) : (
        <>
          <b className="portal-ciclo-numero">{c.programa}</b>
          <small className="portal-ciclo-legenda">Programa Firmare</small>
        </>
      )}
    </div>
  )
}

/** Os quatro links (portal:L116–117) — string crua, em nova aba; `null` não aparece. */
function SeusAcessos({ cliente: c }: { cliente: ClienteNoPortal }) {
  const links = [
    { url: c.linkPainel, titulo: 'Painel da clínica', texto: 'Todos os documentos preparados para você' },
    { url: c.linkDashInd, titulo: 'Indicadores', texto: 'Resultados semana a semana' },
    { url: c.linkDashFin, titulo: 'Financeiro', texto: 'Fluxo de caixa e DRE' },
    { url: c.linkRotina, titulo: 'FIR Clinic', texto: 'A rotina de gestão da sua equipe' },
  ].filter((l): l is { url: string; titulo: string; texto: string } => l.url !== null)
  if (links.length === 0) return null
  return (
    <section className="portal-secao-da-cliente">
      <h2 className="portal-secao-titulo">Seus acessos</h2>
      <div className="portal-grade">
        {links.map((l) => (
          <a key={l.titulo} className="portal-cartao-link" href={l.url} target="_blank" rel="noopener noreferrer">
            <span className="portal-cartao-titulo">{l.titulo}</span>
            <span className="portal-cartao-texto">{l.texto}</span>
            <span className="portal-abrir">Abrir →</span>
          </a>
        ))}
      </div>
    </section>
  )
}

/** Um cartão de meta (portal:L120–128): valor, alvo, barra, rótulo, situação, ponto de partida, barras. */
function CartaoDaMeta({ meta: m }: { meta: MetaNoPortal }) {
  const a = m.avaliacao
  const rotulo =
    m.tipo === 'mensal' && m.prazo === null
      ? `Em ${MESES[mesDe(m.semanas[0]?.referencia ?? m.inicio)] ?? ''}`
      : m.prazo !== null
        ? `Até ${diaLongo(m.prazo)}`
        : 'Acumulado'
  const situacao = a.bateu ? 'Meta alcançada' : a.percentual === null ? 'Aguardando o primeiro lançamento' : `${a.percentual}% do caminho`
  const largura = a.percentual === null ? 0 : Math.min(100, Math.max(0, a.percentual))
  const temPartida = m.valorInicial !== null || m.valorInicialInteiro !== null
  return (
    <div className="portal-meta-cartao">
      <span className="portal-cartao-titulo">{m.titulo}</span>
      <div>
        <span className="portal-meta-valor num">{textoDoNumero(m.atual, m.unidade)}</span>{' '}
        <span className="portal-cartao-texto">
          de <span className="num">{textoDoAlvo(m)}</span>
        </span>
      </div>
      <svg className="portal-trilho" viewBox="0 0 100 7" preserveAspectRatio="none" role="img" aria-label={situacao}>
        <rect className="portal-trilho-fundo" x="0" y="0" width="100" height="7" rx="3.5" />
        <rect className={a.bateu ? 'portal-trilho-ok' : 'portal-trilho-cheio'} x="0" y="0" width={largura} height="7" rx="3.5" />
      </svg>
      <div className="portal-meta-linha">
        <span>{rotulo}</span>
        <span>{situacao}</span>
      </div>
      {temPartida ? (
        <div className="portal-mini">
          Ponto de partida: <span className="num">{textoGuardado(m.valorInicial, m.valorInicialInteiro, m.unidade)}</span>
        </div>
      ) : null}
      {m.ultimasSemanas.length > 0 ? (
        <>
          <svg className="portal-barras" viewBox={`0 0 ${m.ultimasSemanas.length * 10} 40`} preserveAspectRatio="none" aria-hidden="true">
            {m.ultimasSemanas.map((s, i) => (
              <rect
                key={s.referencia}
                className={i === m.ultimasSemanas.length - 1 ? 'portal-barra-ultima' : 'portal-barra-semana'}
                x={i * 10 + 1}
                y={40 - (s.altura * 40) / 100}
                width="8"
                height={(s.altura * 40) / 100}
                rx="1.5"
              >
                <title>{diaECurto(s.referencia)}</title>
              </rect>
            ))}
          </svg>
          <div className="portal-mini">Últimas {m.ultimasSemanas.length} semanas lançadas</div>
        </>
      ) : null}
    </div>
  )
}

/** O5 (portal:L131–136, L165–169): os do programa e os "Feito para você", com o "Ver texto". */
function Materiais({ cliente: c }: { cliente: ClienteNoPortal }) {
  const [aberto, setAberto] = useState<MaterialNoPortal | null>(null)
  const [copiado, setCopiado] = useState<'nao' | 'sim' | 'falhou'>('nao')
  const copiar = async (texto: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado('sim')
    } catch {
      setCopiado('falhou')
    }
  }
  return (
    <section className="portal-secao-da-cliente">
      <h2 className="portal-secao-titulo">
        Materiais <small>Programa {c.programa}</small>
      </h2>
      {c.materiais.length === 0 ? (
        <p className="portal-vazio-tracejado">Os materiais do seu programa vão aparecer aqui.</p>
      ) : (
        <div className="portal-grade">
          {c.materiais.map((x) => (
            <div key={x.id} className="portal-material">
              {x.personalizado ? (
                <span className="portal-feito-para-voce">Feito para você</span>
              ) : (
                <span className="portal-mini">{x.tipo || 'Material'}</span>
              )}
              <span className="portal-cartao-titulo">{x.titulo}</span>
              {x.descricao ? <span className="portal-cartao-texto">{x.descricao}</span> : null}
              <span className="portal-material-acoes">
                {x.link ? (
                  <a className="portal-abrir" href={x.link} target="_blank" rel="noopener noreferrer">
                    Abrir →
                  </a>
                ) : null}
                {x.texto ? (
                  <button
                    type="button"
                    className="portal-ver-texto"
                    onClick={() => {
                      setCopiado('nao')
                      setAberto(x)
                    }}
                  >
                    Ver texto
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
      {aberto !== null && aberto.texto !== null ? (
        <Modal titulo={aberto.titulo} aoFechar={() => setAberto(null)}>
          <pre className="portal-texto-do-material">{aberto.texto}</pre>
          <p className="nota" role="status" aria-live="polite">
            {copiado === 'sim' ? 'Texto copiado.' : copiado === 'falhou' ? 'Não consegui copiar. Selecione o texto e copie à mão.' : ''}
          </p>
          <div className="portal-modal-acoes">
            <button type="button" className="btn" onClick={() => void copiar(aberto.texto ?? '')}>
              {copiado === 'sim' ? 'Copiado' : 'Copiar texto'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setAberto(null)}>
              Fechar
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  )
}

/**
 * Campanhas (decisão do G6, não existe no protótipo). O servidor já agrupou
 * as pequenas em "Outras campanhas" SEM valor (supressão k = 5, CE-3); o total
 * é das campanhas exibidas, e a tela diz isso quando houve supressão.
 */
function Campanhas({ cliente: c }: { cliente: ClienteNoPortal }) {
  if (c.campanhas.length === 0) return null
  const r = c.resumoDeCampanhas
  return (
    <section className="portal-secao-da-cliente">
      <h2 className="portal-secao-titulo">
        Campanhas <small>últimos 12 meses</small>
      </h2>
      <div className="portal-lista-papel">
        {c.campanhas.map((camp, i) => (
          <LinhaDeCampanha key={camp.tipo === 'individual' ? camp.id : `outras-${i}`} campanha={camp} />
        ))}
        <div className="portal-linha-papel portal-total">
          <span className="portal-linha-texto">
            Valor gerado
            {r.soDasExibidas ? <span className="portal-linha-detalhe">das campanhas exibidas</span> : null}
          </span>
          <span className="num">{formatarDinheiro(r.receita === null ? null : BigInt(r.receita))}</span>
        </div>
      </div>
    </section>
  )
}

function LinhaDeCampanha({ campanha }: { campanha: CampanhaNoPortal }) {
  if (campanha.tipo === 'outras') {
    return (
      <div className="portal-linha-papel">
        <span className="portal-linha-texto">
          Outras campanhas
          <span className="portal-linha-detalhe">
            <span className="num">{campanha.quantidade}</span>{' '}
            {campanha.quantidade === 1 ? 'campanha pequena' : 'campanhas pequenas'}, valor não exibido
          </span>
        </span>
      </div>
    )
  }
  return (
    <div className="portal-linha-papel">
      <span className="portal-linha-texto">
        {campanha.nome}
        <span className="portal-linha-detalhe">
          {MESES[mesDe(campanha.mes)]} de {campanha.mes.slice(0, 4)}
        </span>
      </span>
      <span className="num">
        {formatarDinheiro(campanha.resultadoEmDinheiro === null ? null : BigInt(campanha.resultadoEmDinheiro))}
      </span>
    </div>
  )
}

const SITUACAO_DA_COBRANCA: Record<CobrancaCarteiraNaLista['status'], string> = {
  aberto: 'em aberto',
  pago: 'paga',
  cancelado: 'cancelada',
}
const PILULA_DA_COBRANCA: Record<CobrancaCarteiraNaLista['status'], string> = {
  aberto: 'pill alerta',
  pago: 'pill bom',
  cancelado: 'pill mau',
}

function LinhaDeCobranca({ cobranca: c }: { cobranca: CobrancaCarteiraNaLista }) {
  return (
    <div className="portal-linha-papel">
      <span className="portal-linha-texto">
        {MESES[mesDe(c.competencia)]} de {c.competencia.slice(0, 4)}
        <span className="portal-linha-detalhe">
          vencimento <span className="num">{diaEmTexto(c.vencimento)}</span>
          {c.desconto !== null && c.desconto !== '0' ? (
            <>
              {' '}
              · desconto <span className="num">{formatarDinheiro(BigInt(c.desconto))}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="num">{formatarDinheiro(c.valor === null ? null : BigInt(c.valor))}</span>
      <span className={PILULA_DA_COBRANCA[c.status]}>{SITUACAO_DA_COBRANCA[c.status]}</span>
    </div>
  )
}

function Arquivos({ arquivos, base }: { arquivos: readonly ArquivoNoPortal[]; base: string }) {
  if (arquivos.length === 0) return null
  return (
    <span className="portal-anexos">
      {arquivos.map((a) => (
        <a key={a.id} className="portal-anexo" href={`/api/${base}/${a.id}/conteudo`} rel="noopener noreferrer">
          {a.nome} <span className="num">({tamanho(a.tamanho)})</span>
        </a>
      ))}
    </span>
  )
}
