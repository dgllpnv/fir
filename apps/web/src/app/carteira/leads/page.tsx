'use client'

import type { EtapaDoLead, LeadComercialNaLista, ListaDeClientesDaCarteiraSaida, ListaDeLeadsSaida } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FormularioDoLead } from '@/components/carteira/lead-formulario'
import { BotaoWhatsApp, CabecalhoDaProspeccao, LinhaDeSinal } from '@/components/carteira/lead-pecas'
import {
  ROTULO_DA_ETAPA,
  ROTULO_DA_TEMPERATURA,
  classeDaEtapa,
  classeDaTemperatura,
  diaCurto,
} from '@/components/carteira/lead-rotulos'
import { Carregando, Vazio } from '@/components/estados'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavos } from '@/lib/financeiro'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **PROSPECÇÃO · OPORTUNIDADES** — `vOportunidades` do protótipo
 * (L2473-2489): o resumo (em andamento, potencial, conversão das
 * encerradas), os contatos recomendados, o funil clicável por etapa e a
 * lista com origem, quem indicou, etapa, temperatura, interesse, último
 * contato e WhatsApp.
 *
 * Nada é calculado aqui: o sinal, a ordem, as contagens, o potencial e a
 * conversão chegam prontos do servidor (CLAUDE.md §5). A tela filtra a lista
 * que já recebeu — filtrar não é calcular.
 *
 * 390 px: a tabela do protótipo vira uma lista de linhas empilhadas, e o
 * funil quebra em grade em vez de rolar para o lado.
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; dados: ListaDeLeadsSaida; clientes: { id: string; nome: string }[] }

type Filtro = 'ativos' | EtapaDoLead

export default function OportunidadesDaProspeccao() {
  const { sessao } = useCarteira()
  const router = useRouter()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [filtro, setFiltro] = useState<Filtro>('ativos')
  const [busca, setBusca] = useState('')
  const [criando, setCriando] = useState(false)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const [dados, clientes] = await Promise.all([
          chamar<ListaDeLeadsSaida>('v1/carteira/leads'),
          // O seletor "Indicado por cliente da carteira" — sem a lista, o formulário ainda funciona.
          chamar<ListaDeClientesDaCarteiraSaida>('v1/carteira/clientes').catch(() => ({ clientes: [] })),
        ])
        if (valeu) {
          setEstado({ tag: 'pronto', dados, clientes: clientes.clientes.map((c) => ({ id: c.id, nome: c.nome })) })
        }
      } catch (e) {
        if (valeu) {
          setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar a prospecção.' })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, tentativa])

  const cabecalho = (
    <CabecalhoDaProspeccao
      aba="oportunidades"
      acao={
        <button type="button" className="btn" disabled={estado.tag !== 'pronto'} onClick={() => setCriando(true)}>
          Nova indicação
        </button>
      }
    />
  )

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return (
      <section className="lead-tela">
        <NavDaCarteira atual="/carteira/leads" />
        {cabecalho}
        <Carregando linhas={5} />
      </section>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <section className="lead-tela">
        <NavDaCarteira atual="/carteira/leads" />
        {cabecalho}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </section>
    )
  }

  const { dados } = estado
  const { resumo } = dados
  const comSinal = dados.leads.filter((l) => l.sinal !== null)
  const termo = busca.trim().toLowerCase()
  const lista = dados.leads
    .filter((l) => (filtro === 'ativos' ? l.etapa !== 'ganho' && l.etapa !== 'perdido' : l.etapa === filtro))
    .filter((l) => termo === '' || l.nome.toLowerCase().includes(termo) || (l.quemIndicou ?? '').toLowerCase().includes(termo))
  const contagem = (e: EtapaDoLead) => resumo.porEtapa.find((x) => x.etapa === e)?.quantidade ?? 0

  return (
    <section className="lead-tela">
      <NavDaCarteira atual="/carteira/leads" />
      {cabecalho}

      {dados.leads.length === 0 ? (
        <Vazio>
          <b>Nenhuma indicação ainda.</b>
          <p className="nota">Registre a primeira indicação para a ferramenta começar a avisar quando é hora de contatar.</p>
          <button type="button" className="btn" onClick={() => setCriando(true)}>
            Registrar a primeira indicação
          </button>
        </Vazio>
      ) : (
        <>
          <p className="nota lead-resumo num">
            {resumo.emAndamento} {resumo.emAndamento === 1 ? 'oportunidade' : 'oportunidades'} em andamento
            {' · '}
            {formatarDinheiro(centavos(resumo.potencial))} por mês em potencial
            {resumo.conversaoDasEncerradas !== null ? ` · ${resumo.conversaoDasEncerradas}% de conversão das encerradas` : ''}
          </p>

          <section className="lead-painel" aria-labelledby="lead-recomendados">
            <div className="lead-painel-cabeca">
              <h2 id="lead-recomendados">Contatos recomendados</h2>
              <p className="nota">
                A ferramenta avisa quando uma indicação está esfriando, quando uma proposta ficou sem retorno ou
                quando chegou a data combinada.
              </p>
            </div>
            {comSinal.length === 0 ? (
              <p className="nota">Tudo em dia. Nenhum contato recomendado agora.</p>
            ) : (
              <ul className="lead-sinais">
                {comSinal.map((l) => (
                  <LinhaDeSinal key={l.id} lead={l} sinal={l.sinal!} />
                ))}
              </ul>
            )}
          </section>

          <div className="lead-funil" role="group" aria-label="Filtrar por etapa">
            {(
              [['ativos', 'Em andamento', resumo.emAndamento] as const,
              ...(Object.keys(ROTULO_DA_ETAPA) as EtapaDoLead[]).map((e) => [e, ROTULO_DA_ETAPA[e], contagem(e)] as const)]
            ).map(([chave, rotulo, n]) => (
              <button
                key={chave}
                type="button"
                className={filtro === chave ? 'lead-funil-etapa lead-funil-atual' : 'lead-funil-etapa'}
                aria-pressed={filtro === chave}
                onClick={() => setFiltro(chave)}
              >
                <b className="num">{n}</b>
                <span>{rotulo}</span>
              </button>
            ))}
          </div>

          <label className="campo lead-busca">
            Buscar por nome ou por quem indicou
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </label>

          {lista.length === 0 ? (
            <p className="nota">Nenhuma oportunidade nesta etapa.</p>
          ) : (
            <ul className="lead-lista">
              {lista.map((l) => (
                <LinhaDoLead key={l.id} lead={l} />
              ))}
            </ul>
          )}
        </>
      )}

      {criando ? (
        <Modal titulo="Nova indicação" aoFechar={() => setCriando(false)}>
          <FormularioDoLead
            lead={null}
            equipe={dados.equipe}
            clientes={estado.clientes}
            podeVerValores={dados.podeVerValores}
            eu={sessao.usuarioDeGestao.id}
            hoje={dados.hoje}
            aoSalvar={(lead) => {
              setCriando(false)
              router.push(`/carteira/leads/${lead.id}`)
            }}
          />
        </Modal>
      ) : null}
    </section>
  )
}

function LinhaDoLead({ lead }: { lead: LeadComercialNaLista }) {
  const alerta = lead.sinal !== null && lead.sinal.nivel !== 'semana'
  return (
    <li className="lead-linha">
      <Link href={`/carteira/leads/${lead.id}`} className="lead-linha-nome">
        <span>
          <b>{lead.nome}</b>
          {alerta ? <span className="lead-ponto" title={lead.sinal!.motivo} aria-label={lead.sinal!.motivo} /> : null}
        </span>
        <span className="muted">{[lead.especialidade, lead.cidade].filter(Boolean).join(' · ')}</span>
      </Link>
      <span className="lead-linha-origem">
        {lead.origem}
        {lead.quemIndicou ? <span className="muted"> · {lead.quemIndicou}</span> : null}
      </span>
      <span className="lead-linha-chips">
        <span className={classeDaEtapa(lead.etapa)}>{ROTULO_DA_ETAPA[lead.etapa]}</span>
        <span className={classeDaTemperatura(lead.temperatura)}>{ROTULO_DA_TEMPERATURA[lead.temperatura]}</span>
        {lead.naoContatar ? <span className="pill mau">Não contatar</span> : null}
      </span>
      <span className="lead-linha-interesse">
        {lead.produtoInteresse ?? '—'}
        {lead.valorEstimado !== null ? (
          <span className="muted num"> · {formatarDinheiro(centavos(lead.valorEstimado))}/mês</span>
        ) : null}
      </span>
      <span className="lead-linha-contato num">
        <span className="muted">Último contato </span>
        {lead.ultimoContato ? diaCurto(lead.ultimoContato) : <span className="muted">nunca</span>}
      </span>
      <span className="lead-linha-acao">
        <BotaoWhatsApp lead={lead} />
      </span>
    </li>
  )
}
