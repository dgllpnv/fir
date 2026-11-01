'use client'

import type { ChaveDePeriodo, CumprimentoDePrazos, Painel } from '@fir/contracts'
import { PERIODOS_DO_PAINEL } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { useDados } from '@/lib/dados'
import { centavos, larguraDaBarra } from '@/lib/financeiro'
import { diaCurto } from '@/lib/formato'
import { Carregando, Erro, Vazio } from './estados'

/**
 * **Gestão › Painel geral** (MANUAL cap. 10) — Período · Cumprimento de
 * prazos · Pacientes no período.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTA TELA NÃO DIVIDE NADA, E ESSA É A REGRA INTEIRA
 *
 * Toda taxa vem em percentual inteiro, pronto; todo total vem somado; as
 * bordas do período vêm do SERVIDOR, no fuso da clínica. O protótipo calcula
 * os quinze no navegador (`metricas`, `vPainel`), com `today()` do aparelho —
 * e aí o celular adiantado da recepção conta como vencida a tarefa de amanhã e
 * abre "este mês" no mês que não é.
 *
 * A tela manda a CHAVE do período (`7d`, `mes`, …), nunca as datas: regra 24.
 * Só `per` manda as duas bordas, porque aí elas são escolha da pessoa.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **390 px:** os KPIs em grade de duas colunas, a distribuição como barra
 * empilhada com legenda, e as três tabelas viram BLOCO abaixo de 620 px —
 * nada rola na horizontal (`docs/design.md`).
 */
export function TelaPainel() {
  const [periodo, setPeriodo] = useState<ChaveDePeriodo>('30d')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')

  /**
   * A consulta só leva `de`/`ate` em `per`, e **espera as duas**: mandar uma
   * só é 400 no contrato, e a tela pediria um erro de propósito enquanto a
   * pessoa ainda está escolhendo a segunda data.
   */
  const pronto = periodo !== 'per' || (de !== '' && ate !== '')
  const consulta =
    periodo === 'per' ? `periodo=per&de=${de}&ate=${ate}` : `periodo=${periodo}`
  const dados = useDados<Painel>(pronto ? `v1/painel?${consulta}` : null)
  const d = dados.dados

  return (
    <section className="painel-geral">
      <div className="eyebrow">Gestão</div>
      <div className="titulo">
        <h2>Painel geral</h2>
      </div>

      <div className="chips" role="group" aria-label="Período">
        {PERIODOS_DO_PAINEL.map((p) => (
          <button
            key={p.chave}
            type="button"
            aria-pressed={periodo === p.chave}
            onClick={() => setPeriodo(p.chave)}
          >
            {p.rotulo}
          </button>
        ))}
      </div>

      {periodo === 'per' ? (
        <div className="par">
          <label className="campo">
            De
            <input type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} />
          </label>
          <label className="campo">
            Até
            <input type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
          </label>
        </div>
      ) : null}

      {!pronto ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Escolha as duas datas do período.</p>
        </Vazio>
      ) : dados.carregando ? (
        <Carregando linhas={5} />
      ) : dados.erro !== null ? (
        <Erro mensagem={dados.erro} recarregar={dados.recarregar} />
      ) : d === null ? null : (
        <>
          <p className="nota">
            <b>{d.periodo.rotulo}</b>: {diaCurto(d.periodo.de)} a {diaCurto(d.periodo.ate)}. O
            cumprimento de prazos considera as tarefas com <b>vencimento</b> no período; o bloco
            de pacientes conta pela data em que a tarefa foi <b>concluída</b>.
          </p>

          <h3>Cumprimento de prazos</h3>
          <div className="kpis">
            <div className="kpi destaque">
              <span>Concluídas no prazo</span>
              <b className="num">
                {d.prazos.taxaNoPrazo === null ? '—' : `${d.prazos.taxaNoPrazo}%`}
              </b>
              <span>das que já venceram</span>
            </div>
            <div className="kpi">
              <span>Tarefas no período</span>
              <b className="num">{d.prazos.total}</b>
              <span>{d.criadasNoPeriodo} criadas no período</span>
            </div>
            <div className="kpi">
              <span>No prazo</span>
              <b className="num">{d.prazos.noPrazo}</b>
              <span>com atraso: {d.prazos.comAtraso}</span>
            </div>
            <div className="kpi">
              <span>Atrasadas em aberto</span>
              <b className="num">{d.prazos.atrasadas}</b>
              <span>a vencer: {d.prazos.aVencer}</span>
            </div>
          </div>

          <Distribuicao prazos={d.prazos} />

          {d.porResponsavel.length === 0 ? null : (
            <>
              <h3>Por responsável</h3>
              <div className="tabela">
                <table className="painel">
                  <thead>
                    <tr>
                      <th>Pessoa</th>
                      <th className="direita">Recebidas</th>
                      <th className="direita">No prazo</th>
                      <th className="direita">Com atraso</th>
                      <th className="direita">Atrasadas</th>
                      <th className="direita">% prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.porResponsavel.map((l) => (
                      <tr key={l.pessoaId}>
                        <td data-rotulo="Pessoa">
                          <b>{l.nome}</b>
                          {l.funcao === '' ? null : <span className="muted">{l.funcao}</span>}
                        </td>
                        <td className="direita" data-rotulo="Recebidas">
                          {l.total}
                        </td>
                        <td className="direita" data-rotulo="No prazo">
                          {l.noPrazo}
                        </td>
                        <td className="direita" data-rotulo="Com atraso">
                          {l.comAtraso}
                        </td>
                        <td className="direita" data-rotulo="Atrasadas">
                          {l.atrasadas}
                        </td>
                        <td className="direita" data-rotulo="% prazo">
                          <b>{l.taxaNoPrazo === null ? '—' : `${l.taxaNoPrazo}%`}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {d.porSolicitante.length === 0 ? null : (
            <>
              <h3>Quem solicitou</h3>
              <p className="nota">Pela data de criação da tarefa.</p>
              <div className="tabela">
                <table className="painel">
                  <thead>
                    <tr>
                      <th>Pessoa</th>
                      <th className="direita">Solicitadas</th>
                      <th className="direita">Para si mesma</th>
                      <th className="direita">Para a equipe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.porSolicitante.map((l) => (
                      <tr key={l.pessoaId}>
                        <td data-rotulo="Pessoa">{l.nome}</td>
                        <td className="direita" data-rotulo="Solicitadas">
                          {l.solicitadas}
                        </td>
                        <td className="direita" data-rotulo="Para si mesma">
                          {l.paraSiMesma}
                        </td>
                        <td className="direita" data-rotulo="Para a equipe">
                          {l.paraAEquipe}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <PacientesNoPeriodo painel={d} />
        </>
      )}
    </section>
  )
}

/**
 * A barra empilhada das quatro situações.
 *
 * **As larguras saem dos QUATRO números, não de uma divisão nova:** cada uma é
 * `n / total`, e `total` é o que o servidor somou. É desenho, não conta — e é
 * por isso que ela não pode divergir dos KPIs acima.
 */
function Distribuicao({ prazos }: { prazos: CumprimentoDePrazos }) {
  if (prazos.total === 0) {
    return (
      <Vazio>
        <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhuma tarefa com prazo no período.</p>
      </Vazio>
    )
  }
  const fatia = (n: number) => `${(n / prazos.total) * 100}%`
  return (
    <>
      <div
        className="barra empilhada"
        role="img"
        aria-label={
          `${prazos.noPrazo} no prazo, ${prazos.comAtraso} com atraso, ` +
          `${prazos.atrasadas} atrasadas, ${prazos.aVencer} a vencer`
        }
      >
        <i className="ok" style={{ width: fatia(prazos.noPrazo) }} />
        <i className="tarde" style={{ width: fatia(prazos.comAtraso) }} />
        <i className="ruim" style={{ width: fatia(prazos.atrasadas) }} />
        <i className="aberta" style={{ width: fatia(prazos.aVencer) }} />
      </div>
      <div className="legenda">
        <span>
          <i className="ok" />
          No prazo
        </span>
        <span>
          <i className="tarde" />
          Concluída com atraso
        </span>
        <span>
          <i className="ruim" />
          Atrasada em aberto
        </span>
        <span>
          <i className="aberta" />A vencer
        </span>
      </div>
    </>
  )
}

function PacientesNoPeriodo({ painel }: { painel: Painel }) {
  const p = painel.pacientes
  const receita = centavos(p.receita)
  const ticket = centavos(p.ticketMedio)
  const orcado = centavos(p.valorDosOrcamentosPagos)

  return (
    <>
      <h3>Pacientes no período</h3>
      <p className="nota">
        Contatos e valores contam pela data em que a tarefa foi <b>concluída</b>.
      </p>
      <div className="kpis">
        <div className="kpi">
          <span>Receita registrada</span>
          <b className="num">{receita === null ? '—' : formatarDinheiro(receita)}</b>
          <span>
            {p.pagamentos} {p.pagamentos === 1 ? 'pagamento' : 'pagamentos'} ·{' '}
            {p.pacientesAtendidos}{' '}
            {p.pacientesAtendidos === 1 ? 'paciente' : 'pacientes'}
          </span>
        </div>
        <div className="kpi">
          <span>Ticket médio</span>
          {/*
            `null` é "não existe ticket médio" — sem pagamento nenhum, não há
            média. `R$ 0,00` diria que a clínica vendeu de graça.
          */}
          <b className="num">{ticket === null ? '—' : formatarDinheiro(ticket)}</b>
          <span>por pagamento</span>
        </div>
        <div className="kpi">
          <span>Contatos realizados</span>
          <b className="num">{p.contatos}</b>
          <span>follow-up, recaptação, etc.</span>
        </div>
        <div className="kpi">
          <span>Orçamentos pagos</span>
          <b className="num">{p.orcamentosPagos}</b>
          <span>
            {orcado === null ? '—' : formatarDinheiro(orcado)} · {p.orcamentosEnviados} enviados
            {p.conversaoDeOrcamentos === null
              ? ''
              : ` · conversão ${p.conversaoDeOrcamentos}%`}
          </span>
        </div>
      </div>

      <h3>Recebido por forma de pagamento</h3>
      {/*
        **O RECORTE É DITO EM VOZ ALTA.** A tabela só alcança os dias com caixa
        já fechado (regra 6) — e sem esta frase ela parece o período inteiro, e
        a gestora compara uma soma parcial com um total sem saber. Isso é pior
        do que não ter a tabela.
      */}
      <p className="nota">
        {p.porFormaAteODia === null
          ? 'Nenhum caixa do período foi fechado ainda. A tabela por forma só aparece depois do fechamento — antes dele, o valor esperado por forma não sai do servidor.'
          : `Até ${diaCurto(p.porFormaAteODia)}, o último dia com caixa fechado.` +
            (p.porFormaDiasSemCaixa > 0
              ? ` ${p.porFormaDiasSemCaixa} ${p.porFormaDiasSemCaixa === 1 ? 'dia do período ainda não foi conferido e não entra' : 'dias do período ainda não foram conferidos e não entram'} aqui.`
              : '')}
      </p>
      {p.porForma.length === 0 ? null : (
        <div className="tabela">
          <table className="painel">
            <thead>
              <tr>
                <th>Forma</th>
                <th className="direita">Pagamentos</th>
                <th className="direita">Valor</th>
                <th className="direita">%</th>
              </tr>
            </thead>
            <tbody>
              {p.porForma.map((f) => {
                const v = centavos(f.valor)
                return (
                  <tr key={f.forma}>
                    <td data-rotulo="Forma">{f.forma}</td>
                    <td className="direita" data-rotulo="Pagamentos">
                      {f.pagamentos}
                    </td>
                    <td className="direita" data-rotulo="Valor">
                      {v === null ? '—' : formatarDinheiro(v)}
                    </td>
                    <td className="direita" data-rotulo="%">
                      {f.percentual === null ? '—' : `${f.percentual}%`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {p.porTipo.length === 0 ? null : (
        <>
          <h3>Por tipo de contato</h3>
          <div className="tabela">
            <table className="painel">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th className="direita">Com prazo no período</th>
                  <th className="direita">Concluídas no período</th>
                  <th className="direita">Valor</th>
                </tr>
              </thead>
              <tbody>
                {p.porTipo.map((t) => {
                  const v = centavos(t.valor)
                  return (
                    <tr key={t.tipo}>
                      <td data-rotulo="Tipo">{t.tipo === '' ? 'Tarefa interna' : t.tipo}</td>
                      <td className="direita" data-rotulo="Com prazo no período">
                        {t.comPrazoNoPeriodo}
                      </td>
                      <td className="direita" data-rotulo="Concluídas no período">
                        {t.concluidasNoPeriodo}
                      </td>
                      <td className="direita" data-rotulo="Valor">
                        {v === null || v === 0n ? '—' : formatarDinheiro(v)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}
