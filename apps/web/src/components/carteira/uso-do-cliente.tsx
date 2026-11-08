'use client'

import type { IndicadorDoRelatorioDeUsoSaida, UsoDoClienteSaida } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useEffect, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import { chamar, ErroDaApi } from '@/lib/api'
import { UsoDelta, UsoSituacao, UsoSpark, decimosTexto, pctTexto } from './uso-pecas'

/**
 * **A aba "Uso da FIR Clinic" da ficha do cliente** (`cUso`, protótipo
 * L1607–1638; G8 1D, item V12). Componente pronto para a ficha em abas (1A)
 * montar — esta fatia não edita a ficha.
 *
 * O que NÃO atravessa do protótipo, e por quê:
 *  - a lista de pessoas da clínica com o último acesso (ADR 0013 §2, A15);
 *  - "Rotinas cumpridas" e "Pacientes recaptados" (ADR 0014: sem fonte);
 *  - "Ver com dados de exemplo" (sem dado inventado no produto).
 *
 * "Faltas recontatadas" só aparece quando o job calculou todos os dias da
 * janela (o servidor manda `null` antes disso — mostrar 0 mentiria, PP-8).
 * A receita chega `null` sem `valores` (redação central, regra 17), e a tela
 * diz "restrito", como o protótipo.
 */

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; dados: UsoDoClienteSaida }

const dataBr = (dia: string): string => {
  const [a, m, d] = dia.split('-')
  return `${d}/${m}/${a}`
}

const valorDoIndicador = (i: IndicadorDoRelatorioDeUsoSaida, v: number | null): string =>
  i.unidade === 'decimos' ? decimosTexto(v) : i.unidade === '%' ? pctTexto(v) : v === null ? '—' : String(v)

export function UsoDoCliente({ clienteId }: { clienteId: string }) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)
  const [recado, setRecado] = useState<string | null>(null)

  useEffect(() => {
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const dados = await chamar<UsoDoClienteSaida>(`v1/carteira/clientes/${encodeURIComponent(clienteId)}/uso`)
        if (valeu) setEstado({ tag: 'pronto', dados })
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
  }, [clienteId, tentativa])

  if (estado.tag === 'carregando') return <Carregando linhas={4} />
  if (estado.tag === 'erro') {
    return (
      <div className="carteira-erro" role="alert">
        <p>{estado.mensagem}</p>
        <div className="carteira-erro-acoes">
          <button type="button" className="btn" onClick={() => setTentativa((n) => n + 1)}>
            Tentar de novo
          </button>
        </div>
      </div>
    )
  }

  const { dados } = estado
  const uso = dados.uso
  if (uso === null) {
    return (
      <section className="uso-painel">
        <h2 className="uso-painel-titulo">Uso da FIR Clinic</h2>
        <p className="vazio">
          {dados.comClinica
            ? 'Aguardando o primeiro resumo diário da FIR Clinic desta clínica.'
            : 'Esta cliente ainda não está ligada a uma clínica da FIR Clinic. Ligue no cadastro da cliente.'}
        </p>
      </section>
    )
  }

  const m = uso.semana
  const ant = uso.semanaAnterior
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(uso.relatorio.texto)
      setRecado('Relatório copiado.')
    } catch {
      setRecado('Não foi possível copiar. Selecione o texto e copie à mão.')
    }
  }

  return (
    <div className="uso-cliente">
      <div className="uso-kpis">
        <div className="uso-kpi">
          <span>Dias com uso</span>
          <b className="num">
            {m.diasComUso}/{m.diasUteis}
          </b>
          <small>
            dias úteis da semana{m.diasSemDado > 0 ? ` · ${m.diasSemDado} sem dado` : ''}
          </small>
        </div>
        <div className="uso-kpi">
          <span>Tarefas no prazo</span>
          <b className="num">{pctTexto(m.percentualNoPrazo)}</b>
          <small>semana anterior {pctTexto(ant.percentualNoPrazo)}</small>
        </div>
        <div className="uso-kpi">
          <span>Situação</span>
          <b className={`uso-kpi-texto uso-${uso.saude.situacao ?? 'sem'}`}>{uso.saude.rotulo}</b>
          <small>últimos 7 dias</small>
        </div>
      </div>

      <div className="uso-paineis">
        <section className="uso-painel">
          <h2 className="uso-painel-titulo">
            Uso <small className="muted">Tarefas concluídas por dia, últimos 30 dias</small>
          </h2>
          <UsoSpark serie={uso.serie} grande />
          <p className="uso-nota">
            {m.tarefasCriadas} tarefas criadas e {m.tarefasConcluidas} concluídas na semana ·{' '}
            {m.tarefasVencidasAbertas ?? '—'} vencidas em aberto · {m.pessoasAtivas} de{' '}
            {m.pessoasCadastradas ?? '—'} pessoas usaram na semana
          </p>
        </section>

        <section className="uso-painel">
          <h2 className="uso-painel-titulo">Resultados na semana</h2>
          <dl className="uso-fatos">
            <div>
              <dt>Contatos com pacientes</dt>
              <dd className="num">
                {m.contatos} <UsoDelta valor={uso.deltaContatos} />
              </dd>
            </div>
            <div>
              <dt>Orçamentos pagos</dt>
              <dd className="num">
                {m.orcamentosPagos} de {m.orcamentosEnviados}
                {m.percentualConversao !== null ? ` (${m.percentualConversao}%)` : ''}
              </dd>
            </div>
            <div>
              <dt>Receita registrada</dt>
              <dd className="num">{m.receita === null ? 'restrito' : formatarDinheiro(BigInt(m.receita))}</dd>
            </div>
            {m.faltasRecontatadas !== null ? (
              <div>
                <dt>Faltas recontatadas</dt>
                <dd className="num">
                  {m.faltasRecontatadas} de {m.faltas}
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Em uso desde</dt>
              <dd className="num">{dataBr(uso.relatorio.emUsoDesde)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="uso-painel">
        <div className="uso-painel-cabeca">
          <h2 className="uso-painel-titulo">
            Relatório de uso <small className="muted">Duas primeiras semanas comparadas com as duas últimas</small>
          </h2>
          <button type="button" className="btn" onClick={() => void copiar()}>
            Copiar relatório
          </button>
        </div>
        <div className="uso-marcos">
          {uso.relatorio.marcos.map((x) => (
            <span key={x.dia} className={x.atingido ? 'pill bom' : 'pill'}>
              Dia {x.dia}
              {x.atingido ? '' : ` · em ${x.faltam} dias`}
            </span>
          ))}
        </div>
        <table className="uso-relatorio">
          <thead>
            <tr>
              <th scope="col">Indicador</th>
              <th scope="col" className="uso-num">Início</th>
              <th scope="col" className="uso-num">Agora</th>
              <th scope="col" className="uso-num">Evolução</th>
            </tr>
          </thead>
          <tbody>
            {uso.relatorio.indicadores.map((i) => (
              <tr key={i.chave}>
                <td>{i.rotulo}</td>
                <td className="uso-num">{valorDoIndicador(i, i.inicio)}</td>
                <td className="uso-num">
                  <b>{valorDoIndicador(i, i.agora)}</b>
                </td>
                <td className="uso-num">
                  <UsoDelta valor={i.evolucao} menorEMelhor={i.menorEMelhor} decimos={i.unidade === 'decimos'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="uso-nota">
          Junto com o Mapa de Maturidade reaplicado, este relatório é a base da conversa de continuidade no fim dos
          90 dias.
        </p>
      </section>
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </div>
  )
}
