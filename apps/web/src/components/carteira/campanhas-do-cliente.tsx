'use client'

import type {
  AtualizarCampanhaCarteiraEntrada,
  CampanhaCarteiraNaLista,
  CampanhaCarteiraSalvaSaida,
  CampanhasDoClienteSaida,
  StatusDeCampanhaCarteira,
} from '@fir/contracts'
import { useEffect, useRef, useState } from 'react'
import { Carregando, Toast } from '@/components/estados'
import {
  AvisoDeSupressao,
  FiltroDePeriodo,
  PERIODO_INICIAL,
  consultaDoPeriodo,
  dinheiro,
  legendaDoInvestimento,
  mesCurto,
  rotuloEmMinuscula,
  type EscolhaDePeriodo,
} from '@/components/carteira/campanhas-pecas'
import { chamar, ErroDaApi } from '@/lib/api'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'
import { instanteEmTexto } from '@/lib/instante'

/**
 * **A ABA CAMPANHAS DO CLIENTE** (V9, `cCampanhas`, `index.html` L1444-1456),
 * pronta para a ficha em abas (1A) usar: `<CampanhasDoCliente clienteId=… />`.
 *
 * Filtro de período, três indicadores (valor total no período, valor gerado
 * neste mês, retorno sobre o investimento), a lista de campanhas e a regra de
 * cálculo no rodapé — na ordem do protótipo. A tabela de nove colunas vira
 * linhas empilhadas (390 px, `docs/design.md` §1).
 *
 * **Duas fontes, uma tela** (ADR 0011): cliente ligado à FIR Clinic tem
 * as campanhas sincronizadas, e aqui só se lança o INVESTIMENTO e as
 * observações (D-22 item 9); cliente sem clínica lança a campanha inteira à
 * mão (K3). Quem decide o que é editável é o servidor (`editavel`).
 *
 * Nenhum `if` de permissão sobre dinheiro: sem `valores`, o servidor já
 * apagou os campos e `formatarDinheiro` mostra "—". E o formulário só envia
 * os campos que a pessoa MUDOU — reenviar um `null` apagado nunca zera o
 * valor guardado (o servidor também recusa isso, gate A-6).
 */
type Estado =
  | { tag: 'carregando' }
  | { tag: 'erro'; mensagem: string }
  | { tag: 'pronto'; dados: CampanhasDoClienteSaida }

const STATUS: readonly [StatusDeCampanhaCarteira, string][] = [
  ['planejada', 'Planejada'],
  ['ativa', 'Ativa'],
  ['encerrada', 'Encerrada'],
]
const rotuloDoStatus = (s: StatusDeCampanhaCarteira) => STATUS.find(([k]) => k === s)?.[1] ?? s

export default function CampanhasDoCliente({ clienteId }: { clienteId: string }) {
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [escolha, setEscolha] = useState<EscolhaDePeriodo>(PERIODO_INICIAL)
  const [tentativa, setTentativa] = useState(0)
  const [editando, setEditando] = useState<CampanhaCarteiraNaLista | 'nova' | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const consulta = consultaDoPeriodo(escolha)

  useEffect(() => {
    let valeu = true
    void (async () => {
      try {
        const dados = await chamar<CampanhasDoClienteSaida>(`v1/carteira/clientes/${clienteId}/campanhas?${consulta}`)
        if (valeu) setEstado({ tag: 'pronto', dados })
      } catch (e) {
        if (valeu) {
          setEstado({
            tag: 'erro',
            mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar as campanhas.',
          })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [clienteId, consulta, tentativa])

  if (estado.tag === 'carregando') return <Carregando linhas={4} />
  if (estado.tag === 'erro') {
    return (
      <div className="erro-de-tela" role="alert">
        <p>{estado.mensagem}</p>
        <button type="button" className="btn ghost" onClick={() => setTentativa((n) => n + 1)}>
          Recarregar
        </button>
      </div>
    )
  }

  const d = estado.dados
  const salvo = (texto: string) => {
    setEditando(null)
    setRecado(texto)
    setTentativa((n) => n + 1)
  }

  return (
    <div className="camp">
      <FiltroDePeriodo escolha={escolha} periodo={d.periodo} comCiclo={false} aoMudar={setEscolha} />

      <div className="camp-kpis camp-kpis-3">
        <div className="camp-kpi">
          <span>Valor total das campanhas no período</span>
          <b>{dinheiro(d.kpis.periodo.valorGerado)}</b>
          <small className="camp-legenda">no mês · continuado indisponível</small>
        </div>
        <div className="camp-kpi">
          <span>Valor gerado neste mês</span>
          <b>{dinheiro(d.kpis.mesAtual.valorGerado)}</b>
          <small className="camp-legenda">resultado parcial</small>
        </div>
        <div className="camp-kpi">
          <span>Retorno sobre o investimento</span>
          <b>{d.kpis.periodo.retornoSobreInvestimento ?? '—'}</b>
          <small className="camp-legenda">{legendaDoInvestimento(d.kpis.periodo.investimento)}</small>
        </div>
      </div>

      <AvisoDeSupressao quantidade={d.outras.quantidade} />

      <section className="camp-painel" aria-labelledby="camp-do-cliente">
        <header className="camp-painel-cabeca">
          <h2 id="camp-do-cliente">Campanhas</h2>
          <span className="nota">
            {d.cliente.ligadoAClinica
              ? `Ligada à FIR Clinic · atualizada ${
                  d.cliente.sincronizadoEm === null
                    ? 'nunca'
                    : (instanteEmTexto(d.cliente.sincronizadoEm, d.periodo.fuso, d.periodo.hoje) ?? 'nunca')
                }. Aqui se lança o investimento de cada campanha.`
              : 'Lançamento manual. Ligue a cliente à FIR Clinic para atualizar sozinho.'}
          </span>
          {d.cliente.ligadoAClinica ? null : (
            <button type="button" className="btn" onClick={() => setEditando('nova')}>
              Nova campanha
            </button>
          )}
        </header>

        {editando === 'nova' ? (
          <FormularioDeCampanha
            clienteId={clienteId}
            mesAtual={d.periodo.mesAtual}
            campanha={null}
            aoSalvar={() => salvo('Campanha criada.')}
            aoCancelar={() => setEditando(null)}
          />
        ) : null}

        {d.campanhas.length === 0 ? (
          <p className="nota camp-vazio">Nenhuma campanha.</p>
        ) : (
          <ul className="camp-linhas">
            {d.campanhas.map((c) => (
              <li key={c.id} className="camp-linha">
                <div className="camp-linha-cabeca">
                  <span className="camp-nome">{c.nome}</span>
                  <span className={c.status === 'ativa' ? 'pill dourado' : 'pill'}>{rotuloDoStatus(c.status)}</span>
                  <button
                    type="button"
                    className="btn ghost camp-editar"
                    aria-expanded={editando !== 'nova' && editando?.id === c.id}
                    aria-label={`Editar ${c.nome}, ${mesCurto(c.mes)}`}
                    onClick={() => setEditando(editando !== 'nova' && editando?.id === c.id ? null : c)}
                  >
                    {c.editavel === 'tudo' ? 'Editar' : 'Investimento'}
                  </button>
                </div>
                  <span className="nota">
                    {mesCurto(c.mes)} · {c.tipo}
                    {c.origem === 'sincronizada' ? ' · sincronizada' : ''}
                  </span>
                  {c.suprimida ? (
                    <span className="nota">Menos de 5 pagamentos no mês: valor e resultado não exibidos.</span>
                  ) : null}
                  <dl className="camp-meses">
                    <div>
                      <dt>Resultado</dt>
                      <dd>
                        {c.resultadoEmDinheiro !== null
                          ? dinheiro(c.resultadoEmDinheiro)
                          : (c.resultadoEmNumero ?? '—')}{' '}
                        <span className="nota">{rotuloEmMinuscula(c.rotuloDaMetrica)}</span>
                      </dd>
                    </div>
                    <div>
                      <dt>Meta</dt>
                      <dd>{c.percentualDaMeta === null ? '—' : `${c.percentualDaMeta}%`}</dd>
                    </div>
                    <div>
                      <dt>No mês</dt>
                      <dd>{c.receita === null ? '—' : dinheiro(c.receita)}</dd>
                    </div>
                    <div>
                      <dt>Continuado</dt>
                      <dd className="camp-mudo">—</dd>
                    </div>
                    <div>
                      <dt>Total</dt>
                      <dd>
                        <b>{c.receita === null ? '—' : dinheiro(c.receita)}</b>
                        {c.investimento !== null && c.investimento !== '0' ? (
                          <span className="nota camp-bloco">investido {dinheiro(c.investimento)}</span>
                        ) : null}
                      </dd>
                    </div>
                    <div>
                      <dt>Retorno</dt>
                      <dd>{c.retornoSobreInvestimento ?? '—'}</dd>
                    </div>
                  </dl>
                {editando !== 'nova' && editando?.id === c.id ? (
                  <FormularioDeCampanha
                    clienteId={clienteId}
                    mesAtual={d.periodo.mesAtual}
                    campanha={c}
                    aoSalvar={() => salvo('Campanha salva.')}
                    aoCancelar={() => setEditando(null)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="nota">
          No mês: pagamentos ligados às tarefas da campanha, no mês em que foram pagos. Continuado: o que os
          pacientes alcançados pagaram depois — ainda não lido da clínica. Retorno: total ÷ investimento.
        </p>
      </section>
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </div>
  )
}

type Campos = {
  nome: string
  tipo: string
  mes: string
  rotuloDaMetrica: string
  metaEmNumero: string
  resultadoEmNumero: string
  receita: string
  investimento: string
  orcamentosPagos: string
  status: StatusDeCampanhaCarteira
  observacoes: string
}

const inteiroOuNulo = (t: string): number | null => (t.trim() === '' ? null : Number.parseInt(t, 10))

function FormularioDeCampanha({
  clienteId,
  mesAtual,
  campanha,
  aoSalvar,
  aoCancelar,
}: {
  clienteId: string
  mesAtual: string
  campanha: CampanhaCarteiraNaLista | null
  aoSalvar: () => void
  aoCancelar: () => void
}) {
  const soInvestimento = campanha !== null && campanha.editavel === 'investimento_e_observacoes'
  const inicial: Campos = {
    nome: campanha?.nome ?? '',
    tipo: campanha?.tipo ?? 'Aniversariantes',
    mes: (campanha?.mes ?? mesAtual).slice(0, 7),
    rotuloDaMetrica: campanha?.rotuloDaMetrica ?? 'Agendamentos',
    metaEmNumero: campanha?.metaEmNumero?.toString() ?? '',
    resultadoEmNumero: campanha?.resultadoEmNumero?.toString() ?? '',
    receita: campanha?.receita == null ? '' : textoDeCentavos(BigInt(campanha.receita)),
    investimento: campanha?.investimento == null ? '' : textoDeCentavos(BigInt(campanha.investimento)),
    orcamentosPagos: campanha?.orcamentosPagos?.toString() ?? '',
    status: campanha?.status ?? 'planejada',
    observacoes: campanha?.observacoes ?? '',
  }
  const [f, setF] = useState<Campos>(inicial)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const primeiro = useRef<HTMLInputElement>(null)
  useEffect(() => primeiro.current?.focus(), [])

  const mudou = (k: keyof Campos) => f[k] !== inicial[k]
  const campo = (k: keyof Campos) => ({
    value: f[k],
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }),
  })

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    const receita = f.receita.trim() === '' ? null : centavosDoTexto(f.receita)
    const investimento = f.investimento.trim() === '' ? null : centavosDoTexto(f.investimento)
    if (f.receita.trim() !== '' && receita === null) return setErro('O valor gerado no mês não é um valor em reais.')
    if (f.investimento.trim() !== '' && investimento === null) return setErro('O investimento não é um valor em reais.')

    setEnviando(true)
    try {
      if (campanha === null) {
        await chamar<CampanhaCarteiraSalvaSaida>('v1/carteira/campanhas', {
          method: 'POST',
          body: JSON.stringify({
            clienteCarteiraId: clienteId,
            nome: f.nome,
            tipo: f.tipo,
            mes: f.mes,
            rotuloDaMetrica: f.rotuloDaMetrica,
            metaEmNumero: inteiroOuNulo(f.metaEmNumero),
            resultadoEmNumero: inteiroOuNulo(f.resultadoEmNumero),
            receita: receita === null ? null : receita.toString(),
            investimento: investimento === null ? null : investimento.toString(),
            orcamentosPagos: inteiroOuNulo(f.orcamentosPagos),
            status: f.status,
            observacoes: f.observacoes,
          }),
        })
      } else {
        // Só o que MUDOU. Campo monetário que chegou apagado e não foi tocado
        // nunca é reenviado.
        const corpo: Record<string, unknown> = {}
        if (mudou('investimento') && investimento !== null) corpo['investimento'] = investimento.toString()
        if (mudou('observacoes')) corpo['observacoes'] = f.observacoes
        if (!soInvestimento) {
          if (mudou('nome')) corpo['nome'] = f.nome
          if (mudou('tipo')) corpo['tipo'] = f.tipo
          if (mudou('mes')) corpo['mes'] = f.mes
          if (mudou('rotuloDaMetrica')) corpo['rotuloDaMetrica'] = f.rotuloDaMetrica
          if (mudou('metaEmNumero')) corpo['metaEmNumero'] = inteiroOuNulo(f.metaEmNumero)
          if (mudou('resultadoEmNumero')) corpo['resultadoEmNumero'] = inteiroOuNulo(f.resultadoEmNumero)
          if (mudou('receita') && receita !== null) corpo['receita'] = receita.toString()
          if (mudou('orcamentosPagos')) corpo['orcamentosPagos'] = inteiroOuNulo(f.orcamentosPagos)
          if (mudou('status')) corpo['status'] = f.status
        }
        if (Object.keys(corpo).length === 0) return aoCancelar()
        await chamar<CampanhaCarteiraSalvaSaida>(`v1/carteira/campanhas/${campanha.id}`, {
          method: 'PATCH',
          body: JSON.stringify(corpo satisfies Partial<Record<keyof AtualizarCampanhaCarteiraEntrada, unknown>>),
        })
      }
      aoSalvar()
    } catch (x) {
      setErro(x instanceof ErroDaApi ? x.message : 'Sem conexão com o servidor.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="carteira-form camp-form" onSubmit={enviar}>
      {soInvestimento ? (
        <p className="nota">Campanha sincronizada da clínica: o resultado e o valor vêm da FIR Clinic.</p>
      ) : (
        <>
          <label className="campo camp-cheio">
            Nome da campanha
            <input ref={primeiro} {...campo('nome')} required maxLength={80} />
          </label>
          <label className="campo">
            Tipo (para comparar mês a mês)
            <input {...campo('tipo')} required maxLength={60} />
          </label>
          <label className="campo">
            Mês
            <input type="month" {...campo('mes')} required />
          </label>
          <label className="campo">
            Status
            <select
              value={f.status}
              onChange={(e) => setF({ ...f, status: e.target.value as StatusDeCampanhaCarteira })}
            >
              {STATUS.map(([k, r]) => (
                <option key={k} value={k}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            Valor gerado no mês (R$)
            <input inputMode="decimal" className="num" {...campo('receita')} />
            <small className="nota">Pagamentos das tarefas da campanha dentro do mês</small>
          </label>
          <label className="campo">
            Pagamentos no mês
            <input inputMode="numeric" className="num" {...campo('orcamentosPagos')} />
            <small className="nota">Com menos de 5, o valor não aparece — protege os pacientes</small>
          </label>
        </>
      )}
      <label className="campo">
        Investimento (R$)
        <input
          ref={soInvestimento ? primeiro : undefined}
          inputMode="decimal"
          className="num"
          {...campo('investimento')}
        />
        <small className="nota">Opcional: anúncios, brindes, descontos</small>
      </label>
      <details className="carteira-dobra carteira-dobra-mini camp-cheio">
        <summary>+ Mais opções</summary>
        <div className="carteira-form camp-form">
          {soInvestimento ? null : (
            <>
              <label className="campo">
                Métrica
                <input {...campo('rotuloDaMetrica')} maxLength={60} />
              </label>
              <label className="campo">
                Meta
                <input inputMode="numeric" className="num" {...campo('metaEmNumero')} />
              </label>
              <label className="campo">
                Resultado
                <input inputMode="numeric" className="num" {...campo('resultadoEmNumero')} />
              </label>
            </>
          )}
          <label className="campo camp-cheio">
            Observações
            <textarea rows={3} maxLength={2000} {...campo('observacoes')} />
          </label>
        </div>
      </details>
      <p role="alert" aria-live="polite" className="erro camp-cheio">
        {erro}
      </p>
      <div className="carteira-acoes camp-cheio">
        <button type="submit" className="btn" disabled={enviando}>
          {enviando ? 'Salvando…' : campanha === null ? 'Criar campanha' : 'Salvar'}
        </button>
        <button type="button" className="btn ghost" onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
