'use client'

import type { IndicadoresDaClinicaNaCarteiraSaida, KpiDaClinicaNaCarteira } from '@fir/contracts'
import { formatarValorNaTela } from '@fir/domain'
import { useEffect, useState } from 'react'
import { Dica } from '@/components/dica'
import { Carregando } from '@/components/estados'
import {
  agruparPorPilar,
  diaCompleto,
  numeroDoCartao,
  textoDoSelo,
  type Tom,
  TOM_DA_SITUACAO,
} from '@/components/indicadores/na-tela'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **"Indicadores da clínica"** na ficha do Cliente Firmare (T10, spec I-47).
 *
 * A fotografia diária dos KPIs que a própria clínica acompanha na tela
 * Indicadores da FIR Clinic — lida de `kpis_na_carteira`. A tela não calcula
 * nada: valor, alvo, situação e percentual chegam prontos, e o texto sai do
 * formatador central (`formatarValorNaTela`).
 *
 * Sem `valores`, o servidor apagou `emDinheiro` (redação no espaço `carteira`):
 * o número vira o percentual da meta, e "de R$…" some — o que é `null` não se
 * escreve, sem `if` de permissão aqui. No pilar Pessoas só a situação e o
 * percentual atravessam (LGPD L-IN-18), e a tela diz isso.
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; dados: IndicadoresDaClinicaNaCarteiraSaida }

const numeroDoKpi = (k: KpiDaClinicaNaCarteira): string =>
  numeroDoCartao({ unidade: k.unidade, ...k.atual, percentualDaMeta: k.percentualDaMeta, escala: null }).texto

const alvoDoKpi = (k: KpiDaClinicaNaCarteira): string | null => {
  if (k.alvo === null) return null
  const alvo = formatarValorNaTela({ unidade: k.unidade, ...k.alvo })
  return alvo === null ? null : `de ${alvo}`
}

/**
 * O selo fala como o cartão da tela Indicadores (`textoDoSelo`): sem meta
 * vigente e com a próxima já definida, "Meta a partir de dez/2026" — a data
 * veio pronta do servidor (`inicioDaProximaMeta`), o alvo dela não atravessa.
 */
export function seloDoKpiNaCarteira(k: KpiDaClinicaNaCarteira): { tom: Tom; texto: string } {
  const situacao = k.situacao ?? 'sem_meta'
  return { tom: TOM_DA_SITUACAO[situacao], texto: textoDoSelo(situacao, k.inicioDaProximaMeta) }
}

export function IndicadoresDaClinica({ clienteId }: { clienteId: string }) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const dados = await chamar<IndicadoresDaClinicaNaCarteiraSaida>(
          `v1/carteira/clientes/${encodeURIComponent(clienteId)}/indicadores-da-clinica`,
        )
        if (valeu) setEstado({ tag: 'pronto', dados })
      } catch (e) {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não consegui ler os indicadores da clínica agora.',
          })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [clienteId, tentativa])

  return (
    <section className="ficha-painel" aria-labelledby="carteira-kpis-titulo">
      <div className="ficha-painel-cabeca">
        <Dica rotulo="O que são os indicadores da clínica" titulo={<h2 id="carteira-kpis-titulo">Indicadores da clínica</h2>}>
          <p>
            Os indicadores que a própria clínica acompanha na FIR Clinic, como estavam no dia da fotografia. A fotografia
            é tirada uma vez por dia, enquanto a clínica estiver no grupo.
          </p>
          <p>
            Indicadores de equipe (banco de horas, metas individuais e conversas 1:1) não chegam à carteira. No pilar
            Pessoas, só a situação e o percentual da meta.
          </p>
        </Dica>
      </div>

      {estado.tag === 'carregando' ? (
        <Carregando linhas={3} fino />
      ) : estado.tag === 'erro' ? (
        <p className="ficha-vazio" role="alert">
          {estado.mensagem}{' '}
          <button type="button" className="link" onClick={() => setTentativa((n) => n + 1)}>
            Tentar de novo
          </button>
        </p>
      ) : !estado.dados.comClinica ? (
        <p className="ficha-vazio">Este cliente não usa a FIR Clinic, então não há indicadores da clínica para mostrar.</p>
      ) : estado.dados.kpis.length === 0 ? (
        <p className="ficha-vazio">
          Ainda não há indicadores fotografados. Quando a clínica criar indicadores na tela Indicadores da FIR Clinic,
          eles aparecem aqui no dia seguinte.
        </p>
      ) : (
        <>
          {estado.dados.dia === null ? null : (
            <p className="carteira-kpis-nota num">Fotografia de {diaCompleto(estado.dados.dia)}</p>
          )}
          {agruparPorPilar(estado.dados.kpis).map((g) => (
            <div key={g.pilar} className="carteira-kpis-pilar">
              <h3 className="carteira-kpis-pilar-titulo">{g.pilar}</h3>
              {g.pilar === 'Pessoas' ? (
                <p className="carteira-kpis-nota">Só a situação e o percentual da meta chegam à carteira.</p>
              ) : null}
              <ul className="carteira-kpis-lista">
                {g.itens.map((k) => {
                  const selo = seloDoKpiNaCarteira(k)
                  const alvo = alvoDoKpi(k)
                  return (
                    <li key={k.kpiRef} className="carteira-kpi">
                      <div className="carteira-kpi-cabeca">
                        <span className="carteira-kpi-nome">{k.nome}</span>
                        <span className={`carteira-kpi-selo carteira-kpi-tom-${selo.tom}`}>{selo.texto}</span>
                      </div>
                      <div className="carteira-kpi-valor num">
                        <b>{numeroDoKpi(k)}</b>
                        {alvo === null ? null : <span>{alvo}</span>}
                      </div>
                      {k.prazo === null ? null : <small className="carteira-kpi-prazo num">Meta até {diaCompleto(k.prazo)}</small>}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  )
}
