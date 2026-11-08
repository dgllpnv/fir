'use client'

import type { UsoNaVisaoGeralSaida, VisaoDeUsoSaida } from '@fir/contracts'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { UsoDelta, UsoSituacao, UsoSpark, pctTexto } from '@/components/carteira/uso-pecas'
import { Carregando, Vazio } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { useCarteira } from '../contexto'
import { ErroDaCarteira, NavDaCarteira } from '../pecas'

/**
 * **FIR CLINIC — quem está usando a ferramenta** (`vFirClinic`, protótipo
 * L1590–1606; G8 1D, item F1).
 *
 * Igual ao protótipo, com o que os gates mandam tirar ou mudar:
 *  - sem a coluna "Rotinas cumpridas" (ADR 0014: não há fonte);
 *  - sem "Ver com dados de exemplo" (inventário F1: sem dado inventado no produto);
 *  - "últimos 7 dias" são os sete dias COMPLETOS antes de hoje (ajuste 30), e
 *    um dia útil sem resumo aparece como "sem dado", não como "sem uso" (31);
 *  - entram as clientes ligadas a uma clínica (a ligação é o "código da FIR
 *    Clinic" do protótipo), ativas ou em onboarding.
 *
 * Nenhum número nasce aqui: situação, percentuais e deltas vêm do servidor.
 * A 390 px a tabela vira um bloco por clínica (CSS), sem rolagem horizontal.
 */

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; visao: VisaoDeUsoSaida }

export default function FirClinic() {
  const { sessao } = useCarteira()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const visao = await chamar<VisaoDeUsoSaida>('v1/carteira/uso')
        if (valeu) setEstado({ tag: 'pronto', visao })
      } catch (e) {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar o uso da FIR Clinic.',
          })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, tentativa])

  const cabeca = (
    <>
      <NavDaCarteira atual="/carteira/fir-clinic" />
      <div className="eyebrow">Clientes</div>
      <h1 className="titulo">FIR Clinic</h1>
      <p className="nota">
        Quem está usando a ferramenta, com que regularidade e que resultados aparecem. Últimos 7 dias, comparados
        com a semana anterior.
      </p>
    </>
  )

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return (
      <section className="uso">
        {cabeca}
        <Carregando linhas={5} />
      </section>
    )
  }

  if (estado.tag === 'erro') {
    return (
      <section className="uso">
        {cabeca}
        <ErroDaCarteira mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
      </section>
    )
  }

  const { totais, clientes } = estado.visao

  return (
    <section className="uso">
      {cabeca}

      {clientes.length > 0 && totais.comDados === 0 ? (
        <p className="uso-aviso">
          Ainda não chegou nenhum resumo diário. A FIR Clinic envia o resumo de cada clínica uma vez por dia, de
          madrugada, e ele aparece aqui na manhã seguinte.
        </p>
      ) : null}

      <div className="uso-kpis">
        <div className="uso-kpi">
          <span>Clínicas com FIR Clinic</span>
          <b className="num">{totais.clinicas}</b>
          <small>{totais.comDados} com dados</small>
        </div>
        <div className="uso-kpi">
          <span>Uso em dia</span>
          <b className="num uso-ok">{totais.bom}</b>
          <small>uso diário e tarefas no prazo</small>
        </div>
        <div className="uso-kpi">
          <span>Uso irregular</span>
          <b className="num uso-atencao">{totais.atencao}</b>
          <small>pede acompanhamento</small>
        </div>
        <div className="uso-kpi">
          <span>Sem uso ou muito baixo</span>
          <b className="num uso-critico">{totais.critico}</b>
          <small>vira tarefa para ligar</small>
        </div>
      </div>

      {clientes.length === 0 ? (
        <Vazio>
          Nenhuma cliente com FIR Clinic ainda. Ligue a cliente à clínica dela no cadastro: o resumo diário de uso
          passa a aparecer aqui na manhã seguinte.
        </Vazio>
      ) : (
        <table className="uso-tabela">
          <thead>
            <tr>
              <th scope="col">Clínica</th>
              <th scope="col">Situação</th>
              <th scope="col" className="uso-num">Dias com uso</th>
              <th scope="col" className="uso-num">Pessoas ativas</th>
              <th scope="col" className="uso-num">Tarefas no prazo</th>
              <th scope="col" className="uso-num">Vencidas</th>
              <th scope="col" className="uso-num">Contatos</th>
              <th scope="col" className="uso-num">Orçamentos pagos</th>
              <th scope="col">Últimos 30 dias</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <LinhaDaClinica key={c.clienteCarteiraId} c={c} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function LinhaDaClinica({ c }: { c: UsoNaVisaoGeralSaida }) {
  const m = c.semana
  return (
    <tr>
      <td className="uso-clinica">
        <Link className="uso-nome" href={`/carteira/clientes/${c.clienteCarteiraId}`}>
          {c.nome}
        </Link>
      </td>
      <td className="uso-situacao">
        <UsoSituacao saude={c.saude} />
      </td>
      {m === null ? (
        <td className="muted uso-aguardando" colSpan={7}>
          Aguardando o primeiro resumo da FIR Clinic
        </td>
      ) : (
        <>
          <td className="uso-num" data-rotulo="Dias com uso">
            {m.diasComUso}/{m.diasUteis}
            {m.diasSemDado > 0 ? <span className="uso-semdado"> · {m.diasSemDado} sem dado</span> : null}
          </td>
          <td className="uso-num" data-rotulo="Pessoas ativas">
            {m.pessoasAtivas}/{m.pessoasCadastradas ?? '—'}
          </td>
          <td className="uso-num" data-rotulo="Tarefas no prazo">
            {pctTexto(m.percentualNoPrazo)} <UsoDelta valor={c.deltaNoPrazo} />
          </td>
          <td className={m.tarefasVencidasAbertas !== null && m.tarefasVencidasAbertas > 5 ? 'uso-num uso-tarde' : 'uso-num'} data-rotulo="Vencidas">
            {m.tarefasVencidasAbertas ?? '—'}
          </td>
          <td className="uso-num" data-rotulo="Contatos">
            {m.contatos} <UsoDelta valor={c.deltaContatos} />
          </td>
          <td className="uso-num" data-rotulo="Orçamentos pagos">
            {m.orcamentosPagos}/{m.orcamentosEnviados}
          </td>
          <td className="uso-serie">
            <UsoSpark serie={c.serie} />
          </td>
        </>
      )}
    </tr>
  )
}
