'use client'

import type { EtapaDoLead, ListaDeClientesDaCarteiraSaida, ListaDeLeadsSaida } from '@fir/contracts'
import { ETAPAS_DO_LEAD } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FormularioDoLead } from '@/components/carteira/lead-formulario'
import { CabecalhoDaProspeccao, LinhaDeSinal, TelaDaProspeccao } from '@/components/carteira/lead-pecas'
import { ROTULO_DA_ETAPA } from '@/components/carteira/lead-rotulos'
import { FunilDaProspeccao, TabelaDeOportunidades } from '@/components/carteira/lead-tabela'
import { Carregando, Vazio } from '@/components/estados'
import { Modal } from '@/components/modal'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavos } from '@/lib/financeiro'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **PROSPECÇÃO · OPORTUNIDADES** — `vOportunidades` do protótipo
 * (L2473-2489), na ordem dele: o resumo (em andamento, potencial, conversão
 * das encerradas), os contatos recomendados, o funil clicável por etapa numa
 * linha só e a tabela com MÉDICO · ORIGEM · ETAPA · TEMPERATURA · INTERESSE ·
 * ÚLTIMO CONTATO e o WhatsApp (D-25).
 *
 * Nada é calculado aqui: o sinal, a ordem, as contagens, o potencial e a
 * conversão chegam prontos do servidor (CLAUDE.md §5). A tela filtra a lista
 * que já recebeu pela etapa escolhida — filtrar não é calcular. A busca por
 * nome saiu (D-25): o protótipo não a tem.
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
      <TelaDaProspeccao>
        <NavDaCarteira atual="/carteira/leads" />
        {cabecalho}
        <Carregando linhas={5} />
      </TelaDaProspeccao>
    )
  }
  if (estado.tag === 'erro') {
    return (
      <TelaDaProspeccao>
        <NavDaCarteira atual="/carteira/leads" />
        {cabecalho}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </TelaDaProspeccao>
    )
  }

  const { dados } = estado
  const { resumo } = dados
  // Par (lead, sinal) já estreitado: a lista só leva quem tem sinal, sem `!` no uso.
  const comSinal = dados.leads.flatMap((l) => (l.sinal === null ? [] : [{ lead: l, sinal: l.sinal }]))
  const lista = dados.leads.filter((l) =>
    filtro === 'ativos' ? l.etapa !== 'ganho' && l.etapa !== 'perdido' : l.etapa === filtro,
  )
  const contagem = (e: EtapaDoLead) => resumo.porEtapa.find((x) => x.etapa === e)?.quantidade ?? 0
  const etapas: readonly (readonly [Filtro, string, number])[] = [
    ['ativos', 'Em andamento', resumo.emAndamento],
    ...ETAPAS_DO_LEAD.map((e) => [e, ROTULO_DA_ETAPA[e], contagem(e)] as const),
  ]
  // Sem `valores` o servidor apagou o potencial: o trecho simplesmente não vem.
  const potencial = centavos(resumo.potencial)

  return (
    <TelaDaProspeccao>
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
            {potencial !== null ? ` · ${formatarDinheiro(potencial)} por mês em potencial` : ''}
            {resumo.conversaoDasEncerradas !== null ? ` · ${resumo.conversaoDasEncerradas}% de conversão das encerradas` : ''}
          </p>

          <section className="lead-painel" aria-labelledby="lead-recomendados">
            <div className="lead-painel-cabeca">
              <h2 id="lead-recomendados">Contatos recomendados</h2>
              <p className="nota">
                A ferramenta avisa quando uma indicação está esfriando, quando uma proposta ficou sem retorno ou
                quando chegou a data combinada
              </p>
            </div>
            {comSinal.length === 0 ? (
              <p className="nota">Tudo em dia. Nenhum contato recomendado agora.</p>
            ) : (
              <ul className="lead-sinais">
                {comSinal.map(({ lead, sinal }) => (
                  <LinhaDeSinal key={lead.id} lead={lead} sinal={sinal} />
                ))}
              </ul>
            )}
          </section>

          <FunilDaProspeccao etapas={etapas} atual={filtro} aoEscolher={setFiltro} />

          <TabelaDeOportunidades leads={lista} />
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
    </TelaDaProspeccao>
  )
}
