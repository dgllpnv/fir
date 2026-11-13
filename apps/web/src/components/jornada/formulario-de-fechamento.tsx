'use client'

import { FORMAS, type ListaDeProcedimentos, type TarefaNaLista } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { useDados } from '@/lib/dados'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'
import { calcularFechamento, somaDosItensMarcados } from '@/lib/fechamento'

/**
 * "FECHOU O ORÇAMENTO" — dois blocos, nesta ordem.
 *
 *  1. O QUE FOI FECHADO: o orçamento todo, ou só uma parte (e então QUAIS
 *     procedimentos, o valor fechado e quando retomar o restante).
 *  2. O PAGAMENTO: recebido agora, forma e o pagamento em aberto.
 *
 * Os dois conceitos que a cliente separou têm nomes que não se confundem:
 * **Pagamento em aberto** é o saldo a receber do que foi fechado;
 * **Restante do orçamento** é a parte que não foi fechada.
 *
 * Fechou o todo → só as perguntas de pagamento. Sem a permissão `valores` não
 * há cálculo na tela (o servidor devolveu o orçamento `null`): a recepção digita
 * o recebido e o pagamento em aberto, e o servidor confere — sem repetir o valor
 * na recusa.
 */
export function FormularioDeFechamento({
  tarefa: t,
  hoje,
  podeValores,
  aoFechar,
  aoSalvar,
}: {
  tarefa: TarefaNaLista
  hoje: string
  podeValores: boolean
  aoFechar: () => void
  aoSalvar: (corpo: Record<string, unknown>) => Promise<void>
}) {
  // Fechar direto de "realizado" não tem orçamento: não há o que declarar.
  const temOrcamento = t.etapa === 'orcamento'
  const itens = t.itensOrcamento ?? []
  const temItens = itens.length > 0
  const temPrograma = (t.programaOrcado?.length ?? 0) > 0
  const oferta = podeValores && t.valorOrcamento !== null ? BigInt(t.valorOrcamento) : null

  const catalogo = useDados<ListaDeProcedimentos>(temItens ? 'v1/procedimentos' : null)
  const nome = (id: string): string =>
    (catalogo.dados?.itens ?? []).find((p) => p.id === id)?.nome ?? 'Procedimento'

  const [tipo, setTipo] = useState<'' | 'tudo' | 'parte'>('')
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set())
  const [fechadoTexto, setFechadoTexto] = useState('')
  /** Uma vez digitado à mão, a soma dos itens não sobrescreve mais. */
  const [fechadoEditado, setFechadoEditado] = useState(false)
  const [restanteEm, setRestanteEm] = useState('')
  const [entrada, setEntrada] = useState('')
  const [aberto, setAberto] = useState('')
  const [forma, setForma] = useState<(typeof FORMAS)[number]>(FORMAS[0])
  const [nota, setNota] = useState('')
  const [inicio, setInicio] = useState(hoje)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const calculo =
    tipo === '' || oferta === null
      ? null
      : calcularFechamento({
          oferta,
          tipo,
          fechadoDigitado: fechadoTexto,
          entradaDigitada: entrada,
        })

  function marcar(chave: string, ligado: boolean) {
    const novo = new Set(marcados)
    if (ligado) novo.add(chave)
    else novo.delete(chave)
    setMarcados(novo)
    // O valor fechado nasce da soma dos itens marcados (quando todos têm preço)
    // e continua DIGITÁVEL: a paciente pode ter negociado.
    if (podeValores && !fechadoEditado) {
      const soma = somaDosItensMarcados(itens, novo)
      setFechadoTexto(soma === null ? '' : textoDeCentavos(soma))
    }
  }

  function montar(): Record<string, unknown> | string {
    const valorEntrada = centavosDoTexto(entrada)
    if (valorEntrada === null || valorEntrada <= 0n) return 'Informe o valor recebido agora.'
    if (temOrcamento && tipo === '') return 'Diga se fechou o orçamento todo ou só uma parte.'
    if (tipo === 'parte' && temItens) {
      if (marcados.size === 0) return 'Marque os procedimentos que a paciente fechou.'
      if (marcados.size >= itens.length) {
        return 'Todos os procedimentos estão marcados: escolha "O orçamento todo".'
      }
    }
    let emAberto: bigint
    if (calculo !== null) {
      if (calculo.erro !== null) return calculo.erro
      if (calculo.pagamentoEmAberto === null) return 'Confira os valores.'
      emAberto = calculo.pagamentoEmAberto
    } else {
      // Sem `valores` (ou sem orçamento): digitado, e o servidor confere.
      const d = aberto.trim() === '' ? 0n : centavosDoTexto(aberto)
      if (d === null || d < 0n) return 'Pagamento em aberto inválido. Use 300,00.'
      emAberto = d
    }
    return {
      acao: 'fechar',
      ...(tipo === '' ? {} : { fechamento: tipo }),
      recebimento: { valor: valorEntrada.toString(), forma, valorAberto: emAberto.toString() },
      ...(tipo === 'parte' && temItens ? { itensFechados: [...marcados] } : {}),
      ...(tipo === 'parte' && restanteEm !== '' ? { retomarRestanteEm: restanteEm } : {}),
      // Só viaja se a recepção mudou: o padrão é o hoje da clínica, que o servidor aplica.
      ...(temPrograma && inicio !== hoje ? { inicioDoPrograma: inicio } : {}),
      ...(nota.trim() === '' ? {} : { nota: nota.trim() }),
    }
  }

  async function salvar() {
    setErro(null)
    const corpo = montar()
    if (typeof corpo === 'string') {
      setErro(corpo)
      return
    }
    setSalvando(true)
    try {
      await aoSalvar(corpo)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui registrar.')
    } finally {
      setSalvando(false)
    }
  }

  const mostraPagamento = !temOrcamento || tipo !== ''

  return (
    <div className="painel jornada-form">
      <b>Fechou o orçamento</b>

      {temOrcamento ? (
        <fieldset className="campo" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>
            O que foi fechado
            {oferta === null ? null : (
              <small className="num"> (orçamento de {formatarDinheiro(oferta)})</small>
            )}
          </legend>
          <label style={{ display: 'inline-block', marginRight: 16 }}>
            <input type="radio" name="fechamento" checked={tipo === 'tudo'} onChange={() => setTipo('tudo')} />{' '}
            O orçamento todo
          </label>
          <label style={{ display: 'inline-block' }}>
            <input type="radio" name="fechamento" checked={tipo === 'parte'} onChange={() => setTipo('parte')} />{' '}
            Só uma parte
          </label>
        </fieldset>
      ) : null}

      {tipo === 'parte' ? (
        <>
          {temItens ? (
            <fieldset className="campo" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend>Quais procedimentos a paciente fechou?</legend>
              {itens.map((i) => (
                <label key={i.chave} style={{ display: 'block', padding: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={marcados.has(i.chave)}
                    onChange={(e) => marcar(i.chave, e.target.checked)}
                  />{' '}
                  {nome(i.procedimentoId)}
                  {podeValores && i.valor !== undefined && i.valor !== null ? (
                    <span className="num muted"> · {formatarDinheiro(BigInt(i.valor))}</span>
                  ) : null}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="nota">Este orçamento não lista procedimentos: informe só o valor.</p>
          )}
          {oferta !== null ? (
            <div className="par">
              <label className="campo">
                Valor fechado (R$)
                <input
                  inputMode="decimal"
                  className="num"
                  placeholder="Ex.: 15.000,00"
                  value={fechadoTexto}
                  onChange={(e) => {
                    setFechadoEditado(true)
                    setFechadoTexto(e.target.value)
                  }}
                />
              </label>
              <p className="nota num" style={{ alignSelf: 'end', margin: 0 }}>
                Restante do orçamento (não fechado):{' '}
                <b>{calculo?.restante == null ? '—' : formatarDinheiro(calculo.restante)}</b>
              </p>
            </div>
          ) : null}
          <label className="campo" style={{ maxWidth: 260 }}>
            Retomar o restante em <small>(opcional)</small>
            <input type="date" className="num" min={hoje} value={restanteEm} onChange={(e) => setRestanteEm(e.target.value)} />
          </label>
        </>
      ) : null}

      {mostraPagamento ? (
        <>
          <b style={{ marginTop: 8, display: 'block' }}>Pagamento</b>
          <div className="par">
            <label className="campo">
              Recebido agora (R$)
              <input
                inputMode="decimal"
                className="num"
                placeholder="Ex.: 1.000,00"
                value={entrada}
                onChange={(e) => setEntrada(e.target.value)}
              />
            </label>
            <label className="campo">
              Forma de pagamento
              <select
                value={forma}
                onChange={(e) => {
                  const escolhida = FORMAS.find((f) => f === e.target.value)
                  if (escolhida !== undefined) setForma(escolhida)
                }}
              >
                {FORMAS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {calculo !== null ? (
            <p className="nota num" style={{ margin: 0 }}>
              Pagamento em aberto (saldo da paciente):{' '}
              <b>
                {calculo.pagamentoEmAberto === null ? '—' : formatarDinheiro(calculo.pagamentoEmAberto)}
              </b>
            </p>
          ) : (
            <label className="campo" style={{ maxWidth: 260 }}>
              Pagamento em aberto (R$) <small>(saldo da paciente)</small>
              <input
                inputMode="decimal"
                className="num"
                placeholder="Vazio = nada em aberto"
                value={aberto}
                onChange={(e) => setAberto(e.target.value)}
              />
            </label>
          )}

          {temPrograma ? (
            <details>
              <summary>Detalhes do programa</summary>
              <p className="nota">
                Ao fechar, o programa é montado e as sessões entram na agenda. Por padrão a
                primeira é hoje.
              </p>
              <label className="campo" style={{ maxWidth: 260 }}>
                Data da primeira sessão
                <input type="date" className="num" value={inicio} onChange={(e) => setInicio(e.target.value)} />
              </label>
            </details>
          ) : null}

          <label className="campo">
            Observação (opcional)
            <input type="text" maxLength={160} value={nota} onChange={(e) => setNota(e.target.value)} />
          </label>
        </>
      ) : null}

      {erro === null ? null : (
        <p className="campo" role="alert">
          <span className="erro">{erro}</span>
        </p>
      )}

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="btn ghost" onClick={aoFechar} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
