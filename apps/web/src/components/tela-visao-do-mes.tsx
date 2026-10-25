'use client'

import type { PercentualDaMeta, RotinaDeFechamento, VisaoDoMes } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import Link from 'next/link'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { centavos, larguraDaBarra, mesesAte, nomeDoMes, rotuloDoMes } from '@/lib/financeiro'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'
import { diaEmTexto, plural } from '@/lib/formato'
import { Carregando, Erro, Toast } from './estados'

/**
 * **A Visão do mês — a tela que decide.**
 *
 * **Nenhum número desta tela é somado aqui.** Recebido, despesas pagas,
 * resultado, a pagar, saldo a receber, percentuais por categoria, fixas,
 * variáveis e o resumo dos caixas chegam prontos de `GET /v1/visao-do-mes`. A
 * barra da meta recebe o percentual, nunca a divisão.
 *
 * É a tela com mais colunas de número do produto, e por isso **algarismos
 * tabulares** não são opcionais em nenhuma delas.
 */
export function TelaVisaoDoMes({ mesCorrente }: { mesCorrente: string }) {
  const [mes, setMes] = useState(mesCorrente)
  const [recado, setRecado] = useState<string | null>(null)
  const v = useDados<VisaoDoMes>(`v1/visao-do-mes${consultaEmTexto({ mes })}`)

  return (
    <section>
      <div className="eyebrow">Financeiro</div>
      <div className="titulo">
        <h2>Visão do mês</h2>
        <div className="acoes-de-tela">
          <RotinaMensal aoCriar={setRecado} />
          <button type="button" className="btn ghost" onClick={() => window.print()}>
            Imprimir
          </button>
        </div>
      </div>

      <p className="nota" style={{ marginBottom: 14 }}>
        Uma visão simples para decidir: o que entrou, o que saiu por categoria e o resultado do mês.
        Não substitui a contabilidade nem o financeiro completo.
      </p>

      <div className="par" style={{ marginBottom: 16 }}>
        <label className="campo">
          Mês
          <select value={mes} onChange={(e) => setMes(e.target.value)}>
            {mesesAte(mesCorrente).map((m) => (
              <option key={m} value={m}>
                {rotuloDoMes(m)}
              </option>
            ))}
          </select>
        </label>
        <Meta mes={mes} aoSalvar={(aviso) => { setRecado(aviso); v.recarregar() }} />
      </div>

      {v.carregando ? (
        <Carregando linhas={3} />
      ) : v.erro !== null ? (
        <Erro mensagem={v.erro} recarregar={v.recarregar} />
      ) : v.dados === null ? null : (
        <Corpo v={v.dados} mesCorrente={mesCorrente} />
      )}

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

function Corpo({ v, mesCorrente }: { v: VisaoDoMes; mesCorrente: string }) {
  const anterior = nomeDoMes(mesesAte(v.mes)[1] ?? v.mes)

  return (
    <>
      <div className="indicadores">
        <Indicador
          rotulo="Recebido no mês"
          valor={v.recebido}
          abaixo={`${plural(v.quantidadeDeRecebimentos, 'recebimento', 'recebimentos')} · ${rotuloDeComparacao(v.recebido, v.mesAnterior.recebido, anterior)}`}
        />
        <Indicador
          rotulo="Despesas pagas"
          valor={v.despesasPagas}
          abaixo={`${plural(v.quantidadeDePagas, 'conta', 'contas')} · ${rotuloDeComparacao(v.despesasPagas, v.mesAnterior.despesasPagas, anterior)}`}
        />
        <Indicador
          rotulo="Resultado do mês"
          valor={v.resultadoDoMes}
          cor={corDoResultado(v.resultadoDoMes)}
          abaixo={
            v.percentualDoResultado === null
              ? 'recebido − despesas pagas'
              : `${v.percentualDoResultado}% do recebido`
          }
        />
        <Indicador
          rotulo="A pagar até o fim do mês"
          valor={v.aPagar}
          cor={v.quantidadeVencidas > 0 ? 'var(--bad)' : undefined}
          abaixo={`${plural(v.quantidadeAPagar, 'conta', 'contas')}${v.quantidadeVencidas > 0 ? ` · ${v.quantidadeVencidas} vencidas` : ''}`}
        />
        <Indicador rotulo="Saldo a receber" valor={v.aReceber} abaixo="dos pacientes" link="/cobrancas" />
      </div>

      {v.percentualDaMeta === null ? null : (
        <div className="meta-do-mes" style={{ marginBottom: 18 }}>
          <div className="meta-linha">
            <b>Meta de {nomeDoMes(v.mes)}: {formatarDinheiro(centavos(v.meta))}</b>
            <span className="num">{v.percentualDaMeta}%</span>
          </div>
          <div className="barra" role="img" aria-label={`${v.percentualDaMeta}% da meta`}>
            <i style={{ width: larguraDaBarra(v.percentualDaMeta) }} />
          </div>
          <span className="nota">
            {v.metaRestante === null || v.metaRestante === '0'
              ? 'Meta atingida.'
              : `Faltam ${formatarDinheiro(centavos(v.metaRestante))}.`}
            {v.mes === mesCorrente ? ` ${v.caixa.diasUteis} dias úteis passados.` : ''}
          </span>
        </div>
      )}

      <div className="grupo">
        <h3>Despesas por categoria</h3>
        {v.porCategoria.length === 0 ? (
          <p className="nota">
            Nenhuma conta paga neste mês. Cadastre as contas em <Link href="/contas">Contas a pagar</Link>.
          </p>
        ) : (
          <div className="tabela-rolavel">
            <table className="lista">
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th className="direita">Valor</th>
                  <th className="direita">%</th>
                  <th className="direita">{anterior}</th>
                </tr>
              </thead>
              <tbody>
                {v.porCategoria.map((c) => (
                  <tr key={c.categoria}>
                    <td>
                      {c.categoria}{' '}
                      <span className="pill">{c.tipo === 'fixa' ? 'fixa' : 'variável'}</span>
                    </td>
                    <td className="direita">{formatarDinheiro(centavos(c.valor))}</td>
                    <td className="direita">{c.percentual === null ? '—' : `${c.percentual}%`}</td>
                    <td className="direita">{formatarDinheiro(centavos(c.mesAnterior.valor))}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Fixas</td>
                  <td className="direita">{formatarDinheiro(centavos(v.fixas))}</td>
                  <td className="direita">
                    {v.percentualFixas === null ? '—' : `${v.percentualFixas}%`}
                  </td>
                  <td />
                </tr>
                <tr className="total">
                  <td>Variáveis</td>
                  <td className="direita">{formatarDinheiro(centavos(v.variaveis))}</td>
                  <td className="direita">
                    {v.percentualVariaveis === null ? '—' : `${v.percentualVariaveis}%`}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="nota" style={{ marginTop: 10 }}>
          As despesas fixas são o custo para a clínica abrir as portas todo mês; saber esse número
          ajuda a definir a meta mínima de faturamento.
        </p>
      </div>

      <div className="grupo">
        <h3>Recebido por forma de pagamento</h3>
        {/*
          A REGRA 6 APARECE AQUI, e por isso a frase existe. `porForma` só
          soma os dias com caixa FECHADO: o mês corrente contém o dia de hoje,
          e um agregado por forma de um dia aberto é o esperado da gaveta com
          outra etiqueta. O total do mês, acima, continua inteiro.
        */}
        {v.porForma.length === 0 ? (
          <p className="nota">
            Nenhum dia deste mês teve o caixa fechado ainda — e é o fechamento que libera a leitura
            por forma de pagamento.{' '}
            <Link href="/caixa">Fechar o caixa do dia</Link>.
          </p>
        ) : (
          <>
            <div className="linhas">
              {v.porForma.map((f) => (
                <div className="linha" key={f.forma}>
                  <div className="info">
                    <b>{f.forma}</b>
                  </div>
                  <span className="valor">{formatarDinheiro(centavos(f.valor))}</span>
                </div>
              ))}
            </div>
            <p className="nota">
              Considera os recebimentos até{' '}
              <span className="num">
                {v.porFormaAteODia === null ? '—' : diaEmTexto(v.porFormaAteODia)}
              </span>
              , o último dia com caixa fechado.
              {v.porFormaDiasSemCaixa > 0
                ? ` ${plural(v.porFormaDiasSemCaixa, 'dia ainda sem conferência', 'dias ainda sem conferência')}.`
                : ''}
            </p>
          </>
        )}
      </div>

      <div className="grupo">
        <h3>Caixa do dia</h3>
        <div className="linhas">
          <div className="linha">
            <div className="info">
              <b className="num">
                {v.caixa.fechados} de {v.caixa.diasUteis} dias úteis fechados
              </b>
              <small>
                {v.caixa.comDiferenca === 0
                  ? 'sem diferenças'
                  : `${plural(v.caixa.comDiferenca, 'caixa com diferença', 'caixas com diferença')} · total ${formatarDinheiro(centavos(v.caixa.diferenca))}`}
              </small>
            </div>
            <Link className="link" href="/caixa">
              abrir
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

function Indicador({
  rotulo,
  valor,
  abaixo,
  cor,
  link,
}: {
  rotulo: string
  valor: string | null
  abaixo: string
  cor?: string | undefined
  link?: string
}) {
  return (
    <div className="indicador">
      <span className="rotulo">{rotulo}</span>
      <span className="numero" style={cor === undefined ? undefined : { color: cor }}>
        {formatarDinheiro(centavos(valor))}
      </span>
      <small style={{ color: 'var(--muted)' }}>
        {abaixo}
        {link === undefined ? null : (
          <>
            {' · '}
            <Link className="link" href={link}>
              ver cobranças
            </Link>
          </>
        )}
      </small>
    </div>
  )
}

/** A meta do mês, editável. `PUT` idempotente; vazio REMOVE a meta. */
function Meta({ mes, aoSalvar }: { mes: string; aoSalvar: (aviso: string) => void }) {
  const atual = useDados<PercentualDaMeta>(`v1/metas/${mes}/percentual`)
  const [texto, setTexto] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const noCampo =
    texto ?? (atual.dados?.meta == null ? '' : textoDeCentavos(BigInt(atual.dados.meta)))

  async function salvar(): Promise<void> {
    setErro(null)
    const bruto = noCampo.trim()
    const v = bruto === '' ? 0n : centavosDoTexto(bruto)
    if (v === null) {
      setErro('Use o formato 120.000,00.')
      return
    }
    try {
      await chamar(`v1/metas/${mes}`, {
        method: 'PUT',
        body: JSON.stringify({ valor: v.toString() }),
      })
      setTexto(null)
      atual.recarregar()
      aoSalvar(v === 0n ? 'Meta removida.' : 'Meta do mês atualizada.')
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não consegui falar com o servidor.')
    }
  }

  return (
    <label className="campo">
      Meta de faturamento do mês (R$)
      <input
        inputMode="decimal"
        value={noCampo}
        placeholder="Ex.: 120.000,00"
        onChange={(e) => setTexto(e.target.value)}
        onBlur={salvar}
      />
      {erro === null ? <small>Deixe em branco para remover a meta.</small> : (
        <span className="erro">{erro}</span>
      )}
    </label>
  )
}

/** Criar a rotina mensal de fechamento — doze tarefas, idempotente no servidor. */
function RotinaMensal({ aoCriar }: { aoCriar: (aviso: string) => void }) {
  const [criando, setCriando] = useState(false)
  return (
    <button
      type="button"
      className="btn ghost"
      disabled={criando}
      onClick={async () => {
        setCriando(true)
        try {
          const r = await chamar<RotinaDeFechamento>('v1/visao-do-mes/rotina', { method: 'POST' })
          aoCriar(
            r.criadas === 0
              ? 'A rotina mensal de fechamento já estava criada.'
              : `Rotina criada: todo dia 1º, a partir de ${diaEmTexto(r.deInicio)}.`,
          )
        } catch {
          aoCriar('Não consegui criar a rotina. Tente de novo.')
        } finally {
          setCriando(false)
        }
      }}
    >
      {criando ? 'Criando…' : 'Criar rotina mensal de fechamento'}
    </button>
  )
}

/**
 * "+12% vs. setembro" — e **sem dividir nada aqui**.
 *
 * O que esta função faz é comparar dois `bigint` para escolher a palavra e o
 * sinal; a magnitude não é calculada porque não é entregue. Sem `valores` os
 * dois lados vêm `null` e a frase vira o nome do mês, sem seta — nenhum `if`
 * de permissão: `null` já diz o que precisa.
 */
function rotuloDeComparacao(atual: string | null, antes: string | null, nomeAnterior: string): string {
  if (atual === null || antes === null) return `vs. ${nomeAnterior}`
  const a = BigInt(atual)
  const b = BigInt(antes)
  if (b === 0n) return `vs. ${nomeAnterior}`
  if (a === b) return `igual a ${nomeAnterior}`
  return `${a > b ? 'acima de' : 'abaixo de'} ${nomeAnterior}`
}

const corDoResultado = (resultado: string | null): string | undefined => {
  if (resultado === null) return undefined
  return BigInt(resultado) < 0n ? 'var(--bad)' : 'var(--ok)'
}
