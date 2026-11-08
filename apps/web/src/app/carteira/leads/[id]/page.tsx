'use client'

import type { FichaDoLeadSaida, LeadComercialNaLista, ListaDeClientesDaCarteiraSaida } from '@fir/contracts'
import { temPermCarteira } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { MarcarLeadPerdido, RegistrarContatoDoLead } from '@/components/carteira/lead-contato'
import { FormularioDoLead } from '@/components/carteira/lead-formulario'
import { BotaoWhatsApp, DuasColunasDoLead, TelaDaProspeccao } from '@/components/carteira/lead-pecas'
import { PainelDoRoteiro } from '@/components/carteira/lead-roteiros'
import { MensagemWhatsApp } from '@/components/carteira/mensagem-whatsapp'
import {
  ROTULO_DA_ETAPA,
  ROTULO_DA_TEMPERATURA,
  CLASSE_DO_NAO_CONTATAR,
  ROTULO_DO_NIVEL,
  classeDaEtapa,
  classeDaTemperatura,
  diaCompleto,
  diaCurto,
  percentualCurto,
  roteiroInicial,
} from '@/components/carteira/lead-rotulos'
import { Carregando, Toast } from '@/components/estados'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavos } from '@/lib/financeiro'
import { useCarteira } from '../../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../../pecas'

/**
 * **A FICHA DO LEAD** — `vLead` do protótipo (L2490-2513): cabeçalho com
 * etapa, temperatura, origem e indicação; WhatsApp, Registrar contato e
 * Editar; o sinal em destaque; o histórico de contatos; os dados; "Virou
 * cliente" e "Marcar como perdido", ou "Abrir cadastro do cliente".
 *
 * Briefing, roteiro e mensagem pronta (D-25): "Briefing" leva ao Roteiro de
 * briefing do Método (o briefing GRAVADO espera o jurídico, D-5); o painel
 * "Roteiro" monta a mensagem no servidor e abre o modal do 3A. Abrir esta
 * ficha grava o acesso no servidor (LGPD A53).
 *
 * "Não contatar" e "Excluir a pedido do titular" (LGPD A37) ficam recolhidos
 * no fim: são raros, e o segundo não tem volta.
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; ficha: FichaDoLeadSaida }

type Janela =
  | { tag: 'nenhuma' | 'contato' | 'editar' | 'perder' | 'converter' | 'excluir' }
  | { tag: 'mensagem'; roteiro: string }

export default function FichaDoLead() {
  const { id } = useParams<{ id: string }>()
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [janela, setJanela] = useState<Janela>({ tag: 'nenhuma' })
  const [clientes, setClientes] = useState<{ id: string; nome: string }[]>([])
  const [recado, setRecado] = useState<string | null>(null)
  const [erroDeAcao, setErroDeAcao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const recarregar = () => setTentativa((n) => n + 1)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    void (async () => {
      try {
        const ficha = await chamar<FichaDoLeadSaida>(`v1/carteira/leads/${id}`)
        if (valeu) setEstado({ tag: 'pronto', ficha })
      } catch (e) {
        if (valeu) {
          setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível abrir o lead.' })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, id, tentativa])

  async function abrirEditar() {
    setJanela({ tag: 'editar' })
    if (clientes.length > 0) return
    try {
      const r = await chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes')
      setClientes(r.clientes.map((c) => ({ id: c.id, nome: c.nome })))
    } catch {
      // O seletor de cliente indicador fica vazio; o resto do formulário funciona.
    }
  }

  async function acao(caminho: string, corpo: unknown, aviso: string) {
    setErroDeAcao('')
    setEnviando(true)
    try {
      await chamar<{ lead: LeadComercialNaLista }>(
        caminho === '' ? `v1/carteira/leads/${id}` : `v1/carteira/leads/${id}/${caminho}`,
        corpo === undefined
          ? { method: 'POST' }
          : { method: caminho === '' ? 'PATCH' : 'POST', body: JSON.stringify(corpo) },
      )
      setJanela({ tag: 'nenhuma' })
      setRecado(aviso)
      recarregar()
    } catch (e) {
      setErroDeAcao(e instanceof ErroDaApi ? e.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  const voltar = (
    <Link className="link" href="/carteira/leads">
      ← Prospecção
    </Link>
  )

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return (
      <TelaDaProspeccao>
        <NavDaCarteira atual="/carteira/leads" />
        {voltar}
        <Carregando linhas={6} />
      </TelaDaProspeccao>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <TelaDaProspeccao>
        <NavDaCarteira atual="/carteira/leads" />
        {voltar}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={recarregar} />
      </TelaDaProspeccao>
    )
  }

  const { ficha } = estado
  const { lead } = ficha
  const responsavel = ficha.equipe.find((p) => p.id === lead.responsavelUsuarioGestaoId)?.nome ?? '—'
  const fechado = lead.etapa === 'ganho' || lead.etapa === 'perdido'
  const inicial = roteiroInicial(lead.etapa, lead.sinal)

  return (
    <TelaDaProspeccao>
      <NavDaCarteira atual="/carteira/leads" />
      {voltar}

      <header className="lead-cabeca">
        <div className="lead-cabeca-linha">
          <div>
            <p className="lead-sobretitulo">{[lead.especialidade, lead.clinica].filter(Boolean).join(' · ') || 'Indicação'}</p>
            <h1 className="titulo">{lead.nome}</h1>
            <p className="lead-chips">
              <span className={classeDaEtapa(lead.etapa)}>{ROTULO_DA_ETAPA[lead.etapa]}</span>
              <span className={classeDaTemperatura(lead.temperatura)}>{ROTULO_DA_TEMPERATURA[lead.temperatura]}</span>
              {lead.naoContatar ? <span className={CLASSE_DO_NAO_CONTATAR}>Não contatar</span> : null}
              <span className="muted">
                {lead.origem}
                {lead.quemIndicou ? ` · indicação de ${lead.quemIndicou}` : ''}
              </span>
            </p>
          </div>
          <div className="lead-acoes">
            <BotaoWhatsApp lead={lead} grande aoAbrir={() => setJanela({ tag: 'mensagem', roteiro: inicial })} />
            {lead.naoContatar ? null : (
              <button type="button" className="btn ghost" onClick={() => setJanela({ tag: 'contato' })}>
                Registrar contato
              </button>
            )}
            {/* O briefing GRAVADO espera o jurídico (D-5); até lá, o roteiro de briefing do Método. */}
            {temPermCarteira(sessao.usuarioDeGestao, 'metodo') ? (
              <Link className="btn ghost" href="/carteira/metodo/roteiros">
                Briefing
              </Link>
            ) : null}
            {lead.excluidoAPedido ? null : (
              <button type="button" className="btn ghost" onClick={() => void abrirEditar()}>
                Editar
              </button>
            )}
          </div>
        </div>
      </header>

      {lead.sinal !== null ? (
        <div className={`lead-sinal-destaque lead-sinal-${lead.sinal.nivel}`} role="status">
          <span className="lead-sinal-nivel">{ROTULO_DO_NIVEL[lead.sinal.nivel]}</span>
          <p>{lead.sinal.motivo}</p>
        </div>
      ) : null}

      {lead.excluidoAPedido ? null : (
        <PainelDoRoteiro
          lead={lead}
          inicial={inicial}
          aoEnviar={(roteiro) => setJanela({ tag: 'mensagem', roteiro })}
          aoAvisar={setRecado}
        />
      )}

      <DuasColunasDoLead>
        <section className="lead-painel" aria-labelledby="lead-historico">
          <div className="lead-painel-cabeca">
            <h2 id="lead-historico">Histórico de contatos</h2>
            {lead.naoContatar ? null : (
              <button type="button" className="btn ghost lead-mini" onClick={() => setJanela({ tag: 'contato' })}>
                Registrar contato
              </button>
            )}
          </div>
          {ficha.interacoes.length === 0 ? (
            <p className="nota">Nenhum contato registrado ainda.</p>
          ) : (
            <ol className="lead-historico">
              {ficha.interacoes.map((i) => (
                <li key={i.id}>
                  <span className="lead-historico-data num">
                    <b>{diaCurto(i.dataDoContato)}</b>
                    <span className="muted">{i.canal}</span>
                  </span>
                  <span>
                    <span className="lead-historico-nota">{i.nota}</span>
                    {i.porNome ? <span className="muted lead-historico-por">por {i.porNome}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="lead-painel" aria-labelledby="lead-dados">
          <div className="lead-painel-cabeca">
            <h2 id="lead-dados">Dados</h2>
          </div>
          <dl className="lead-fatos">
            <div>
              <dt>WhatsApp</dt>
              <dd className="num">
                {lead.whatsapp ?? '—'}
                {lead.whatsapp ? (
                  <button
                    type="button"
                    className="link lead-copiar"
                    onClick={() => {
                      void navigator.clipboard?.writeText(lead.whatsapp ?? '').then(
                        () => setRecado('WhatsApp copiado.'),
                        () => setRecado('Não foi possível copiar. Selecione o número.'),
                      )
                    }}
                  >
                    copiar
                  </button>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Instagram</dt>
              <dd>
                {lead.instagram ? (
                  <a
                    className="link"
                    href={`https://instagram.com/${encodeURIComponent(lead.instagram.replace('@', ''))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {lead.instagram}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Cidade</dt>
              <dd>{lead.cidade ?? '—'}</dd>
            </div>
            <div>
              <dt>Recebida em</dt>
              <dd className="num">{diaCompleto(lead.recebidaEm)}</dd>
            </div>
            <div>
              <dt>Interesse</dt>
              <dd>{lead.produtoInteresse ?? '—'}</dd>
            </div>
            <div>
              <dt>Potencial</dt>
              <dd className="num">{formatarDinheiro(centavos(lead.valorEstimado))}/mês</dd>
            </div>
            <div>
              <dt>Próximo contato</dt>
              <dd className="num">{lead.proximoContato ? diaCompleto(lead.proximoContato) : 'não marcado'}</dd>
            </div>
            <div>
              <dt>Responsável</dt>
              <dd>{responsavel}</dd>
            </div>
          </dl>
          {lead.observacoes ? <p className="nota">{lead.observacoes}</p> : null}
          {lead.etapa === 'perdido' && lead.motivoPerda ? <p className="nota">Motivo da perda: {lead.motivoPerda}</p> : null}

          {lead.etapa === 'ganho' && lead.clienteCarteiraId !== null ? (
            <Link className="btn" href={`/carteira/clientes/${lead.clienteCarteiraId}`}>
              Abrir cadastro do cliente
            </Link>
          ) : lead.excluidoAPedido ? null : (
            <div className="lead-acoes">
              {lead.etapa !== 'perdido' ? (
                <button type="button" className="btn" onClick={() => setJanela({ tag: 'converter' })}>
                  Virou cliente
                </button>
              ) : null}
              {!fechado ? (
                <button type="button" className="btn ghost lead-perigo" onClick={() => setJanela({ tag: 'perder' })}>
                  Marcar como perdido
                </button>
              ) : null}
            </div>
          )}
        </section>
      </DuasColunasDoLead>

      {ficha.beneficio !== null ? (
        <section className="lead-painel" aria-labelledby="lead-beneficio">
          <div className="lead-painel-cabeca">
            <h2 id="lead-beneficio">Benefício de indicação</h2>
          </div>
          <p>
            <b>{ficha.beneficio.beneficiario}</b>{' '}
            <span className="muted num">
              · {percentualCurto(ficha.beneficio.percentualCentesimos)} de desconto na mensalidade seguinte
            </span>
          </p>
          <p className="nota">
            {ficha.beneficio.situacao === 'guardado'
              ? 'Guardado: quem indicou ainda não é cliente. Fica guardado até virar.'
              : ficha.beneficio.situacao === 'pendente'
                ? 'Pendente: aplicado automaticamente na próxima cobrança.'
                : `Concedido na cobrança de ${ficha.beneficio.competenciaDaCobranca ?? '—'}.`}{' '}
            <Link className="link" href="/carteira/leads/indicacoes">
              Ver benefícios
            </Link>
          </p>
        </section>
      ) : null}

      {lead.excluidoAPedido ? (
        <p className="nota">Este lead foi excluído a pedido do titular. Os dados pessoais foram apagados.</p>
      ) : (
        <details className="carteira-dobra lead-privacidade">
          <summary>Privacidade do contato</summary>
          <div className="carteira-form">
            <label className="lead-alternar">
              <input
                type="checkbox"
                checked={lead.naoContatar}
                disabled={enviando}
                onChange={(e) =>
                  void acao(
                    '',
                    { naoContatar: e.target.checked },
                    e.target.checked ? 'Marcado: não contatar.' : 'Contato liberado de novo.',
                  )
                }
              />
              <span>
                <b>Não contatar</b>
                <small className="nota">
                  A pessoa pediu para não receber contato. Some dos contatos recomendados e o WhatsApp fica bloqueado.
                </small>
              </span>
            </label>
            {lead.clienteCarteiraId === null ? (
              <button type="button" className="btn ghost lead-perigo" onClick={() => setJanela({ tag: 'excluir' })}>
                Excluir a pedido do titular
              </button>
            ) : null}
            <p role="alert" aria-live="polite" className="erro">
              {janela.tag === 'nenhuma' ? erroDeAcao : ''}
            </p>
          </div>
        </details>
      )}

      {janela.tag === 'contato' ? (
        <Modal titulo={`Registrar contato · ${lead.nome}`} aoFechar={() => setJanela({ tag: 'nenhuma' })}>
          <RegistrarContatoDoLead
            lead={lead}
            hoje={ficha.hoje}
            sugestao={ficha.sugestaoDeContato}
            aoRegistrar={() => {
              setJanela({ tag: 'nenhuma' })
              setRecado('Contato registrado.')
              recarregar()
            }}
          />
        </Modal>
      ) : null}

      {janela.tag === 'mensagem' ? (
        <MensagemWhatsApp
          destino={{ para: 'lead', leadId: lead.id, roteiro: janela.roteiro }}
          aoFechar={() => setJanela({ tag: 'nenhuma' })}
          aoConfirmarEnvio={() => {
            // O passo seguinte do protótipo: registrar o contato (L9, L13).
            setJanela({ tag: 'contato' })
            setRecado('Mensagem marcada como enviada. Registre o contato.')
          }}
        />
      ) : null}

      {janela.tag === 'editar' ? (
        <Modal titulo={`Editar ${lead.nome}`} aoFechar={() => setJanela({ tag: 'nenhuma' })}>
          <FormularioDoLead
            lead={lead}
            equipe={ficha.equipe}
            clientes={clientes}
            podeVerValores={ficha.podeVerValores}
            eu={sessao.usuarioDeGestao.id}
            hoje={ficha.hoje}
            aoSalvar={() => {
              setJanela({ tag: 'nenhuma' })
              setRecado('Indicação salva.')
              recarregar()
            }}
          />
        </Modal>
      ) : null}

      {janela.tag === 'perder' ? (
        <Modal titulo="Marcar como perdido" aoFechar={() => setJanela({ tag: 'nenhuma' })}>
          <MarcarLeadPerdido
            lead={lead}
            hoje={ficha.hoje}
            aoMarcar={(l) => {
              setJanela({ tag: 'nenhuma' })
              setRecado(l.etapa === 'espera' ? 'Movido para Em espera.' : 'Marcado como perdido.')
              recarregar()
            }}
          />
        </Modal>
      ) : null}

      {janela.tag === 'converter' ? (
        <Modal titulo="Virou cliente" aoFechar={() => setJanela({ tag: 'nenhuma' })}>
          <div className="carteira-form">
            <p>
              <b>{lead.nome}</b> vira Cliente Firmare em onboarding.
              {lead.quemIndicou ? ` O benefício de indicação de ${lead.quemIndicou} é registrado junto.` : ''}
            </p>
            <p className="nota">O cadastro completo do cliente se preenche depois, na ficha dele.</p>
            <p role="alert" aria-live="polite" className="erro">
              {erroDeAcao}
            </p>
            <button
              type="button"
              className="btn"
              disabled={enviando}
              onClick={() => void acao('etapa', { etapa: 'ganho' }, 'Cliente criado.')}
            >
              {enviando ? 'Convertendo…' : 'Confirmar: virou cliente'}
            </button>
          </div>
        </Modal>
      ) : null}

      {janela.tag === 'excluir' ? (
        <Modal titulo="Excluir a pedido do titular" aoFechar={() => setJanela({ tag: 'nenhuma' })}>
          <div className="carteira-form">
            <p>
              Os dados pessoais de <b>{lead.nome}</b> e o texto do histórico são apagados agora. O telefone fica
              bloqueado para não voltar à base. A contagem do funil continua.
            </p>
            <p className="nota">Não tem volta.</p>
            <p role="alert" aria-live="polite" className="erro">
              {erroDeAcao}
            </p>
            <button
              type="button"
              className="btn lead-perigo"
              disabled={enviando}
              onClick={() => void acao('excluir-a-pedido', undefined, 'Dados excluídos a pedido do titular.')}
            >
              {enviando ? 'Excluindo…' : 'Confirmar exclusão'}
            </button>
          </div>
        </Modal>
      ) : null}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </TelaDaProspeccao>
  )
}
