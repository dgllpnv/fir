'use client'

import type {
  ChaveDePeriodo,
  CumprimentoDePrazos,
  Painel,
  RecorteDeCaixa,
} from '@fir/contracts'
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
   * A janela do Top 10 — e ela viaja na MESMA consulta.
   *
   * Trocar para "Desde o início" refaz o pedido do painel inteiro, e é o
   * certo: `useDados` guarda por URL, então voltar ao período não paga rede de
   * novo. Uma rota só para o ranking seria um segundo lugar onde o corte de
   * caixa fechado pode ser esquecido.
   */
  const [top, setTop] = useState<'periodo' | 'tudo'>('periodo')

  /**
   * A consulta só leva `de`/`ate` em `per`, e **espera as duas**: mandar uma
   * só é 400 no contrato, e a tela pediria um erro de propósito enquanto a
   * pessoa ainda está escolhendo a segunda data.
   */
  const pronto = periodo !== 'per' || (de !== '' && ate !== '')
  const consulta =
    (periodo === 'per' ? `periodo=per&de=${de}&ate=${ate}` : `periodo=${periodo}`) +
    `&top=${top}`
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
          <TopPagantesNoPainel painel={d} aoTrocarModo={setTop} />
          <PorUnidade painel={d} />
          <CampanhasNoPeriodo painel={d} />
          <NovosPacientesPorOrigem painel={d} />
        </>
      )}
    </section>
  )
}

/**
 * A frase que DECLARA o corte de caixa fechado (regra 6).
 *
 * Sem ela a tabela parece a janela inteira, e a gestora compara uma soma
 * parcial com um total sem saber — que é pior do que não ter a tabela. É a
 * mesma frase do bloco "Recebido por forma", num lugar só.
 */
function Recorte({ recorte, assunto }: { recorte: RecorteDeCaixa; assunto: string }) {
  if (recorte.ateODia === null) {
    return (
      <p className="nota">
        Nenhum caixa do período foi fechado ainda, então {assunto} não soma nada: antes do
        fechamento, o valor recebido num dia não sai do servidor.
      </p>
    )
  }
  return (
    <p className="nota">
      {assunto} vai até {diaCurto(recorte.ateODia)}, o último dia com caixa fechado.
      {recorte.diasSemCaixa > 0
        ? ` ${recorte.diasSemCaixa} ${
            recorte.diasSemCaixa === 1
              ? 'dia com recebimento ainda não foi conferido e não entra'
              : 'dias com recebimento ainda não foram conferidos e não entram'
          } aqui.`
        : ''}
    </p>
  )
}

/**
 * **Top 10 pagantes** — *"no período do Painel ou desde o início"*.
 *
 * A barra de cada linha é a fatia do PRIMEIRO colocado, e ela sai de dois
 * números que o servidor somou — desenho, não conta: nenhum total novo nasce
 * aqui.
 */
function TopPagantesNoPainel({
  painel,
  aoTrocarModo,
}: {
  painel: Painel
  aoTrocarModo: (m: 'periodo' | 'tudo') => void
}) {
  const t = painel.topPagantes
  const maior = centavos(t.itens[0]?.valor ?? null)

  return (
    <>
      <h3>Top 10 pagantes</h3>
      <div className="chips" role="group" aria-label="Janela do ranking">
        <button
          type="button"
          aria-pressed={t.modo === 'periodo'}
          onClick={() => aoTrocarModo('periodo')}
        >
          {painel.periodo.rotulo}
        </button>
        <button type="button" aria-pressed={t.modo === 'tudo'} onClick={() => aoTrocarModo('tudo')}>
          Desde o início
        </button>
      </div>
      <Recorte recorte={t.recorte} assunto="O ranking" />
      {t.itens.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>
            Nenhum pagamento conferido {t.modo === 'tudo' ? 'ainda' : 'no período'}.
          </p>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            Feche o caixa do dia em Financeiro › Caixa do dia e os pagamentos entram aqui.
          </p>
        </Vazio>
      ) : (
        <ol className="top-pagantes">
          {t.itens.map((p, i) => {
            const v = centavos(p.valor)
            return (
              <li key={p.pacienteId}>
                <span className="posicao" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <b>{p.nome}</b>
                  <span className="muted">
                    {p.pagamentos} {p.pagamentos === 1 ? 'pagamento' : 'pagamentos'}
                    {p.unidade === '' ? '' : ` · ${p.unidade}`}
                  </span>
                  {/*
                    A fatia do primeiro colocado, em percentual — e ela sai de
                    DOIS números que o servidor somou, por divisão de `bigint`.
                    É desenho, não conta: nenhum total novo nasce aqui.
                  */}
                  <i
                    className="fatia"
                    aria-hidden="true"
                    style={{
                      width:
                        v === null || maior === null || maior === 0n
                          ? '0%'
                          : `${Number((v * 100n) / maior)}%`,
                    }}
                  />
                </div>
                <b className="num">{v === null ? '—' : formatarDinheiro(v)}</b>
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}

/** **Desempenho por unidade.** Vazio na clínica de um endereço só. */
function PorUnidade({ painel }: { painel: Painel }) {
  if (painel.porUnidade.length === 0) return null
  return (
    <>
      <h3>Desempenho por unidade</h3>
      <p className="nota">
        Faturamento: pagamentos pela unidade do atendimento, só dos dias com caixa fechado. LTV
        médio: o que as pacientes desta unidade já pagaram, na média. Faltas: sessões cuja data
        prevista já passou e que não aconteceram na data.
      </p>
      <div className="tabela">
        {/*
          `larga` porque são OITO colunas: medido a 768 px, a página inteira
          rolava na horizontal (`scrollWidth` 942). Com a classe, a tabela vira
          bloco já a 900 px — ver a razão escrita em `gestao.css`.
        */}
        <table className="painel larga">
          <thead>
            <tr>
              <th>Unidade</th>
              <th className="direita">Pacientes</th>
              <th className="direita">Faturamento</th>
              <th className="direita">LTV médio</th>
              <th className="direita">Programas novos</th>
              <th className="direita">Programas ativos</th>
              <th className="direita">Faltas em sessões</th>
              <th className="direita">Tarefas atrasadas</th>
            </tr>
          </thead>
          <tbody>
            {painel.porUnidade.map((u) => {
              const fat = centavos(u.faturamento)
              const ltv = centavos(u.ltvMedio)
              return (
                <tr key={u.unidadeId ?? 'sem'}>
                  <td data-rotulo="Unidade">{u.nome}</td>
                  <td className="direita" data-rotulo="Pacientes">
                    {u.pacientes}
                  </td>
                  <td className="direita" data-rotulo="Faturamento">
                    {fat === null ? '—' : formatarDinheiro(fat)}
                  </td>
                  <td className="direita" data-rotulo="LTV médio">
                    {ltv === null ? '—' : formatarDinheiro(ltv)}
                  </td>
                  <td className="direita" data-rotulo="Programas novos">
                    {u.programasNovos}
                  </td>
                  <td className="direita" data-rotulo="Programas ativos">
                    {u.programasAtivos}
                  </td>
                  <td className="direita" data-rotulo="Faltas em sessões">
                    {u.taxaDeFalta === null
                      ? '—'
                      : `${u.sessoesComFalta} de ${u.sessoesPrevistas} · ${u.taxaDeFalta}%`}
                  </td>
                  <td className="direita" data-rotulo="Tarefas atrasadas">
                    {u.tarefasAtrasadas}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** **Campanhas no período** — as que cruzam o período, com o resultado pronto. */
function CampanhasNoPeriodo({ painel }: { painel: Painel }) {
  if (painel.campanhas.length === 0) return null
  return (
    <>
      <h3>Campanhas no período</h3>
      <p className="nota">As campanhas que cruzam o período, com o resultado de cada uma.</p>
      <div className="tabela">
        <table className="painel">
          <thead>
            <tr>
              <th>Campanha</th>
              <th className="direita">Meta</th>
              <th className="direita">Resultado</th>
              <th className="direita">% da meta</th>
              <th className="direita">Ações</th>
              <th className="direita">Receita</th>
            </tr>
          </thead>
          <tbody>
            {painel.campanhas.map((c) => {
              const meta = centavos(c.metaEmDinheiro)
              const feito = centavos(c.resultadoEmDinheiro)
              const receita = centavos(c.receita)
              return (
                <tr key={c.id}>
                  <td data-rotulo="Campanha">
                    <b>{c.nome}</b>
                    <span className="muted">
                      {c.categoria} · {c.rotuloDaMeta} · {diaCurto(c.inicio)} a {diaCurto(c.fim)}
                    </span>
                  </td>
                  {/*
                    A META E O RESULTADO VÊM EM DOIS CAMPOS PARALELOS, e
                    exatamente um está preenchido: `metaEmDinheiro` na métrica
                    de receita, `metaEmNumero` nas outras três. **Não é um `if`
                    de permissão** — é a escala da métrica. Quem não tem
                    `valores` recebe o campo de dinheiro já apagado pelo
                    servidor (regra 17).
                  */}
                  <td className="direita" data-rotulo="Meta">
                    {c.metaEmNumero !== null
                      ? c.metaEmNumero
                      : meta === null
                        ? '—'
                        : formatarDinheiro(meta)}
                  </td>
                  <td className="direita" data-rotulo="Resultado">
                    {c.resultadoEmNumero !== null
                      ? c.resultadoEmNumero
                      : feito === null
                        ? '—'
                        : formatarDinheiro(feito)}
                  </td>
                  <td className="direita" data-rotulo="% da meta">
                    <b>{c.percentualDaMeta === null ? '—' : `${c.percentualDaMeta}%`}</b>
                  </td>
                  <td className="direita" data-rotulo="Ações">
                    {c.tarefasConcluidas}/{c.tarefas}
                  </td>
                  <td className="direita" data-rotulo="Receita">
                    {receita === null ? '—' : formatarDinheiro(receita)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

/** **Novos pacientes por origem** — pela data de cadastro na ferramenta. */
function NovosPacientesPorOrigem({ painel }: { painel: Painel }) {
  const n = painel.novosPacientes
  return (
    <>
      <h3>
        Novos pacientes <span className="contador">{n.total}</span>
      </h3>
      <p className="nota">
        Pela data de cadastro na ferramenta. O LTV total é quanto essas pacientes já pagaram à
        clínica, desde sempre.
      </p>
      {n.porOrigem.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>Nenhuma paciente cadastrada no período.</p>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            A origem vem do cadastro da paciente — é ela que mostra o que está trazendo gente.
          </p>
        </Vazio>
      ) : (
        <div className="tabela">
          <table className="painel">
            <thead>
              <tr>
                <th>Origem</th>
                <th className="direita">Novos</th>
                <th className="direita">Já atendidos</th>
                <th className="direita">LTV total</th>
              </tr>
            </thead>
            <tbody>
              {n.porOrigem.map((o) => {
                const ltv = centavos(o.ltvTotal)
                return (
                  <tr key={o.origem}>
                    <td data-rotulo="Origem">{o.origem}</td>
                    <td className="direita" data-rotulo="Novos">
                      {o.novos}
                    </td>
                    <td className="direita" data-rotulo="Já atendidos">
                      {o.jaAtendidos}
                    </td>
                    <td className="direita" data-rotulo="LTV total">
                      {ltv === null ? '—' : formatarDinheiro(ltv)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
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
