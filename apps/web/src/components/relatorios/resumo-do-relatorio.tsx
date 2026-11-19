'use client'

import type { ResultadoDoRelatorio } from '@fir/contracts'
import { formatarValorNaTela } from '@fir/domain'
import { formatarDinheiro } from '@fir/ui'
import { Dica } from '@/components/dica'
import { LIMITE_EM_TEXTO } from './na-tabela'

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`

/**
 * **A faixa de resumo** (1.9 G, item 3): "148 pacientes · LTV somado R$ 312.400".
 *
 * Todo número aqui veio pronto do servidor — a contagem, os totais por forma e
 * por tipo e o aguardando fechamento no `resumo`; as somas em reais em `somas`
 * (Σ das colunas, pelo value object). A tela só escreve. Sem `valores`,
 * `somas` chega vazio e os campos em reais do resumo chegam `null`: a frase
 * simplesmente não os tem, e não há `if` de permissão aqui.
 */
export function ResumoDoRelatorio({ resultado }: { resultado: ResultadoDoRelatorio }) {
  return (
    <div className="rel-resumo" aria-live="polite">
      <Frase resultado={resultado} />
      {resultado.truncado ? (
        <p className="rel-aviso">
          Mostrando só as primeiras {LIMITE_EM_TEXTO} linhas. Estreite os filtros para ver o resto.
        </p>
      ) : null}
    </div>
  )
}

/** " · LTV somado R$ 312.400,00": uma por coluna somada, na ordem das colunas. */
function Somas({ resultado }: { resultado: ResultadoDoRelatorio }) {
  return (
    <>
      {resultado.somas.map((s) =>
        s.valor === null ? null : (
          <span key={s.coluna}>
            {' '}
            · {s.rotulo} <span className="rel-num">{formatarDinheiro(BigInt(s.valor))}</span>
          </span>
        ),
      )}
    </>
  )
}

function Frase({ resultado: r }: { resultado: ResultadoDoRelatorio }) {
  switch (r.relatorio) {
    case 'pacientes-sem-compra':
      return (
        <p className="rel-resumo-linha">
          {plural(r.resumo.pacientes, 'paciente', 'pacientes')}
          <Somas resultado={r} />
        </p>
      )
    case 'recebimentos': {
      // Sem `valores`, todo total chega `null`: a lista de totais some inteira.
      const totais = [...r.resumo.porForma, ...r.resumo.porTipo]
      return (
        <>
          <p className="rel-resumo-linha">
            {plural(r.resumo.recebimentos, 'recebimento', 'recebimentos')}
            <Somas resultado={r} />
          </p>
          {totais.some((t) => t.valor !== null) ? (
            <dl className="rel-totais">
              {r.resumo.porForma.length > 0 ? <Totais titulo="Por forma" itens={r.resumo.porForma} /> : null}
              {r.resumo.porTipo.length > 0 ? <Totais titulo="Por tipo" itens={r.resumo.porTipo} /> : null}
            </dl>
          ) : null}
          <Aguardando resumo={r.resumo} />
        </>
      )
    }
    case 'saidas-de-estoque':
      return (
        <p className="rel-resumo-linha">
          {plural(r.resumo.linhas, 'saída', 'saídas')}
          <Somas resultado={r} />
        </p>
      )
    case 'tarefas-da-equipe': {
      const p = r.resumo.prazos
      return (
        <p className="rel-resumo-linha">
          {plural(p.total, 'tarefa', 'tarefas')} · {p.noPrazo} no prazo · {p.comAtraso} com atraso · {plural(p.atrasadas, 'atrasada', 'atrasadas')} ·{' '}
          {p.aVencer} a vencer
          {p.taxaNoPrazo === null ? null : <> · {p.taxaNoPrazo}% no prazo</>}
        </p>
      )
    }
    case 'pacientes-sem-atendimento':
    case 'pacientes-maior-ltv':
    case 'aniversariantes':
      return (
        <p className="rel-resumo-linha">
          {plural(r.resumo.pacientes, 'paciente', 'pacientes')}
          <Somas resultado={r} />
        </p>
      )
    case 'pacientes-que-indicaram':
      return (
        <p className="rel-resumo-linha">
          {plural(r.resumo.indicadoras, 'paciente indicou', 'pacientes indicaram')} ·{' '}
          {plural(r.resumo.indicadas, 'indicação', 'indicações')}
          <Somas resultado={r} />
        </p>
      )
    case 'pacientes-por-procedimento':
      return (
        <p className="rel-resumo-linha">
          {plural(r.resumo.pacientes, 'paciente', 'pacientes')} · {plural(r.resumo.programas, 'programa', 'programas')}
          <Somas resultado={r} />
        </p>
      )
    case 'pacientes-por-origem-e-campanha':
      return (
        <>
          <p className="rel-resumo-linha">
            {plural(r.resumo.pacientes, 'paciente', 'pacientes')} · {plural(r.resumo.convertidos, 'convertido', 'convertidos')}
            <Somas resultado={r} />
          </p>
          {r.resumo.porOrigem.length > 0 ? (
            <dl className="rel-totais">
              <div>
                <dt>Por origem</dt>
                {r.resumo.porOrigem.map((o) => (
                  <dd key={o.origem}>
                    <span>{o.origem}</span>
                    <b>
                      {plural(o.novos, 'novo', 'novos')} · {o.jaAtendidos} já atendidos
                    </b>
                  </dd>
                ))}
              </div>
            </dl>
          ) : null}
        </>
      )
    case 'saldos-em-aberto':
      return (
        <p className="rel-resumo-linha">
          {plural(r.resumo.pacientes, 'paciente', 'pacientes')} · {plural(r.resumo.grupos, 'saldo', 'saldos')}
          <Somas resultado={r} />
        </p>
      )
    case 'contas':
      return (
        <p className="rel-resumo-linha">
          {plural(r.resumo.contas, 'conta', 'contas')}
          <Somas resultado={r} />
        </p>
      )
    case 'entradas-de-estoque':
      return (
        <p className="rel-resumo-linha">
          {plural(r.resumo.linhas, 'entrada', 'entradas')}
          <Somas resultado={r} />
        </p>
      )
    case 'orcamentos':
      // O valor fechado somado é a Σ da coluna "Valor fechado", e o servidor
      // garante que é o `orc_valor` do Painel no período (números c.3). O orçado
      // não tem soma: orçamento não é receita (regra 4).
      return (
        <Dica
          rotulo="De onde vêm estes números"
          titulo={
            <p className="rel-resumo-linha" style={{ margin: 0 }}>
              {plural(r.resumo.orcamentos, 'orçamento', 'orçamentos')} · {r.resumo.enviados} enviados ·{' '}
              {plural(r.resumo.fechados, 'fechado', 'fechados')}
              <Somas resultado={r} />
            </p>
          }
        >
          Enviados, fechados e o valor fechado são os do Painel no período: o pagamento de orçamento concluído nestes dias. O
          valor orçado de cada linha não é somado, porque orçamento não é receita.
        </Dica>
      )
    case 'faltas-e-desmarcacoes':
      return (
        <p className="rel-resumo-linha">
          {plural(r.resumo.faltas, 'falta ou desmarcação', 'faltas e desmarcações')} · {r.resumo.recontatadasEmAteDoisDias} de{' '}
          {r.resumo.maduras} recontatadas em até 2 dias
          {r.resumo.aguardandoPrazo > 0 ? <> · {r.resumo.aguardandoPrazo} ainda no prazo</> : null}
        </p>
      )
  }
}

type ResumoDeRecebimentos = Extract<ResultadoDoRelatorio, { relatorio: 'recebimentos' }>['resumo']

/**
 * **Os dias aguardando o fechamento do caixa** (números c.10). O valor e a
 * contagem chegam prontos e falam dos MESMOS dias — os anteriores a hoje.
 * Hoje com o caixa aberto vem só como sinal (`hojeAguardando`) e nunca ganha
 * valor ao lado: o dinheiro de hoje é o esperado da gaveta (regra 6), e o
 * servidor nem o manda.
 */
function Aguardando({ resumo }: { resumo: ResumoDeRecebimentos }) {
  const anteriores = resumo.diasAnterioresAguardando
  const hoje = resumo.hojeAguardando
  if (anteriores <= 0 && !hoje) return null
  const linhaDosAnteriores =
    anteriores <= 0
      ? null
      : resumo.aguardandoFechamento === null
        ? `${plural(anteriores, 'dia aguarda', 'dias aguardam')} o fechamento do caixa.`
        : `Mais ${formatarDinheiro(BigInt(resumo.aguardandoFechamento))} em ${plural(anteriores, 'dia', 'dias')} aguardando o fechamento do caixa.`
  const linhaDeHoje = !hoje
    ? null
    : linhaDosAnteriores === null
      ? 'Hoje aguarda o fechamento do caixa.'
      : 'Hoje também aguarda o fechamento.'
  return (
    <Dica
      rotulo="Por que estes dias ficam fora do total"
      titulo={
        <p className="rel-aviso" style={{ margin: 0 }}>
          {linhaDosAnteriores}
          {linhaDosAnteriores !== null && linhaDeHoje !== null ? ' ' : null}
          {linhaDeHoje}
        </p>
      }
    >
      O recebido conta a partir do fechamento do caixa do dia, como na Visão do mês. Até lá, a linha aparece sem valor e sem
      forma. O dinheiro dos dias anteriores fica só neste aviso; o de hoje só aparece depois que o caixa fechar.
    </Dica>
  )
}

function Totais({ titulo, itens }: { titulo: string; itens: readonly { rotulo: string; valor: Parameters<typeof formatarValorNaTela>[0] | null }[] }) {
  return (
    <div>
      <dt>{titulo}</dt>
      {itens.map((t) => (
        <dd key={t.rotulo}>
          <span>{t.rotulo}</span>
          <b>{t.valor === null ? '—' : (formatarValorNaTela(t.valor) ?? '—')}</b>
        </dd>
      ))}
    </div>
  )
}
