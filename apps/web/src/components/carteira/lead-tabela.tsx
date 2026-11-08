'use client'

import type { LeadComercialNaLista } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { centavos } from '@/lib/financeiro'
import { BotaoWhatsApp } from './lead-pecas'
import { ROTULO_DA_ETAPA, ROTULO_DA_TEMPERATURA, classeDaEtapa, classeDaTemperatura, diaCurto } from './lead-rotulos'

/**
 * O funil clicável (`.funil`, L268-273): UMA linha que rola para o lado
 * dentro de si mesma, como no protótipo — a página não rola. As contagens
 * chegam do servidor.
 */
export function FunilDaProspeccao<K extends string>({
  etapas,
  atual,
  aoEscolher,
}: {
  etapas: readonly (readonly [K, string, number])[]
  atual: K
  aoEscolher: (k: K) => void
}) {
  return (
    <div className="prosp-funil" role="group" aria-label="Filtrar por etapa">
      {etapas.map(([chave, rotulo, n]) => (
        <button
          key={chave}
          type="button"
          className={atual === chave ? 'prosp-funil-etapa prosp-funil-atual' : 'prosp-funil-etapa'}
          aria-pressed={atual === chave}
          onClick={() => aoEscolher(chave)}
        >
          <b className="num">{n}</b>
          <span>{rotulo}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * A tabela de Oportunidades (`vOportunidades`, L2484-2488): num cartão, com o
 * cabeçalho MÉDICO · ORIGEM · ETAPA · TEMPERATURA · INTERESSE · ÚLTIMO
 * CONTATO, como no protótipo. A linha inteira abre a ficha; o nome é o link
 * de verdade (teclado e leitor de tela).
 *
 * O valor estimado chega redigido do servidor sem `valores` (`null`): a tela
 * só não escreve o que não veio.
 *
 * 390 px: em vez de rolar a tabela para o lado (o protótipo rola dentro do
 * cartão), cada linha vira um bloco empilhado — nada rola na horizontal
 * (`docs/design.md` §1).
 */
export function TabelaDeOportunidades({ leads }: { leads: readonly LeadComercialNaLista[] }) {
  const router = useRouter()
  return (
    <div className="prosp-tabela-caixa">
      <table className="prosp-tabela">
        <thead>
          <tr>
            <th scope="col">Médico</th>
            <th scope="col">Origem</th>
            <th scope="col">Etapa</th>
            <th scope="col">Temperatura</th>
            <th scope="col">Interesse</th>
            <th scope="col" className="prosp-num">
              Último contato
            </th>
            <th scope="col">
              <span className="prosp-so-leitor">WhatsApp</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {leads.length === 0 ? (
            <tr>
              <td colSpan={7} className="prosp-vazio">
                Nenhuma oportunidade nesta etapa.
              </td>
            </tr>
          ) : (
            leads.map((l) => {
              const alerta = l.sinal !== null && l.sinal.nivel !== 'semana' ? l.sinal.motivo : null
              return (
                <tr key={l.id} className="prosp-clicavel" onClick={() => router.push(`/carteira/leads/${l.id}`)}>
                  <td className="prosp-medico">
                    <Link
                      href={`/carteira/leads/${l.id}`}
                      className="prosp-nome"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {l.nome}
                    </Link>
                    {alerta !== null ? <span className="lead-ponto" title={alerta} aria-label={alerta} /> : null}
                    {l.naoContatar ? <span className="prosp-chip prosp-chip-quente prosp-chip-solto">Não contatar</span> : null}
                    <span className="prosp-pequeno">{[l.especialidade, l.cidade].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td data-rotulo="Origem">
                    {l.origem}
                    {l.quemIndicou ? <span className="prosp-pequeno">{l.quemIndicou}</span> : null}
                  </td>
                  <td data-rotulo="Etapa">
                    <span className={classeDaEtapa(l.etapa)}>{ROTULO_DA_ETAPA[l.etapa]}</span>
                  </td>
                  <td data-rotulo="Temperatura">
                    <span className={classeDaTemperatura(l.temperatura)}>{ROTULO_DA_TEMPERATURA[l.temperatura]}</span>
                  </td>
                  <td data-rotulo="Interesse">
                    {l.produtoInteresse ?? '—'}
                    {l.valorEstimado !== null ? (
                      <span className="prosp-pequeno prosp-valor num">{formatarDinheiro(centavos(l.valorEstimado))}/mês</span>
                    ) : null}
                  </td>
                  <td data-rotulo="Último contato" className="prosp-num num">
                    {l.ultimoContato ? diaCurto(l.ultimoContato) : <span className="muted">nunca</span>}
                  </td>
                  <td className="prosp-num prosp-acao" onClick={(e) => e.stopPropagation()}>
                    <BotaoWhatsApp lead={l} />
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
