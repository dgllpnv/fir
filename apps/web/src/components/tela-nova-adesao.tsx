'use client'

import type { ClinicaAtual, TPacienteEncontrado } from '@fir/contracts'
import { FORMAS } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  Montador,
  montadorVazio,
  type EstadoDoMontador,
} from '@/components/programas/montador'
import { SeletorDePaciente } from '@/components/seletor-de-paciente'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { Carregando, Erro, Toast } from './estados'

/**
 * **Programas › Nova adesão.**
 *
 * `abrir Nova adesão → criar um programa de um item com valor total` é o fluxo
 * que esta tela existe para fazer curto. Os toques, contados: paciente (1),
 * procedimento (2), total (3), pago na adesão (4), forma (5), "Criar programa
 * e sessões" (6). A **data de início já nasce em hoje** e as sessões, o
 * intervalo e o responsável vêm do catálogo quando o procedimento é escolhido —
 * são três campos que o caminho comum não toca.
 *
 * **D-9: "Pago na adesão" pode ficar em branco.** O programa fecha, a dívida
 * inteira fica registrada, e o saldo aparece na cobrança. Era isso que o
 * `CHECK (valor > 0)` impedia e que o protótipo sempre permitiu.
 *
 * O bloco de pagamento **não aparece** sem `receber` — e a dica diz por onde
 * ir. A rota recusaria (403) de qualquer jeito.
 */

type Props = {
  readonly podeReceber: boolean
  readonly podeValores: boolean
}

/**
 * **A DATA DE HOJE VEM DO SERVIDOR** (`GET /v1/clinica`), nunca de
 * `new Date()` (regra 24): o relogio do cliente nao e autoridade sobre data de
 * negocio, e um computador de balcao com a data errada agendaria doze
 * aplicacoes no mes que vem.
 */
export function TelaNovaAdesao({ podeReceber, podeValores }: Props) {
  const clinica = useDados<ClinicaAtual>('v1/clinica')

  if (clinica.erro !== null) {
    return <Erro mensagem={clinica.erro} recarregar={clinica.recarregar} />
  }
  if (clinica.dados === null) return <Carregando linhas={6} />

  return (
    <Formulario
      hoje={clinica.dados.hoje}
      podeReceber={podeReceber}
      podeValores={podeValores}
    />
  )
}

function Formulario({
  hoje,
  podeReceber,
  podeValores,
}: {
  hoje: string
  podeReceber: boolean
  podeValores: boolean
}) {
  const router = useRouter()
  const [paciente, setPaciente] = useState<TPacienteEncontrado | null>(null)
  const [montagem, setMontagem] = useState<EstadoDoMontador>(() => montadorVazio(hoje))
  const [hora, setHora] = useState('')
  const [total, setTotal] = useState('')
  const [entrada, setEntrada] = useState('')
  const [forma, setForma] = useState<(typeof FORMAS)[number]>(FORMAS[0])
  const [erro, setErro] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  const centavosDoTotal = total.trim() === '' ? null : centavosDoTexto(total)
  const centavosDaEntrada = entrada.trim() === '' ? 0n : centavosDoTexto(entrada)

  async function salvar() {
    setErro(null)
    if (paciente === null) {
      setErro('Escolha a paciente.')
      return
    }
    if (montagem.itens.some((x) => x.procedimentoId === '')) {
      setErro('Escolha o procedimento de cada item.')
      return
    }

    let pagamento: Record<string, unknown> | undefined
    if (centavosDoTotal !== null) {
      if (centavosDoTotal <= 0n) {
        setErro('Valor total inválido. Use o formato 3.600,00.')
        return
      }
      if (centavosDaEntrada === null || centavosDaEntrada < 0n) {
        setErro('Valor pago inválido. Use o formato 1.200,00.')
        return
      }
      if (centavosDaEntrada > centavosDoTotal) {
        setErro('O valor pago não pode ser maior que o total.')
        return
      }
      /**
       * **A FORMA ACOMPANHA O DINHEIRO, e só ele** (D-9).
       *
       * Com entrada zero não existe forma de pagamento: nada se moveu. O
       * contrato recusa a combinação errada nos dois sentidos, e o banco
       * também (`recebimento_forma_so_com_dinheiro`).
       */
      pagamento =
        centavosDaEntrada > 0n
          ? {
              valorTotal: centavosDoTotal.toString(),
              valorEntrada: centavosDaEntrada.toString(),
              forma,
            }
          : { valorTotal: centavosDoTotal.toString(), valorEntrada: '0' }
    }

    setSalvando(true)
    try {
      const r = await chamar<{ id: string }>('v1/programas', {
        method: 'POST',
        body: JSON.stringify({
          pacienteId: paciente.id,
          inicio: montagem.inicio,
          ...(hora === '' ? {} : { hora }),
          /**
           * Os campos OPCIONAIS só entram quando têm valor.
           *
           * O contrato é `.strict()` e os ramos são opcionais: mandar
           * `depoisDe: ''` ou `dose: ''` seria mandar um valor inválido em vez
           * de omitir o campo — e o 400 chegaria com o caminho de um campo que
           * a pessoa não preencheu.
           *
           * O valor do item sai em CENTAVOS DE TEXTO, de `centavosDoTexto`
           * (regra 1): nenhum `parseFloat`, nenhum `* 100`.
           */
          itens: montagem.itens.map((x) => ({
            chave: x.chave,
            procedimentoId: x.procedimentoId,
            sessoes: x.sessoes,
            intervaloDias: x.intervaloDias,
            ...(x.inicio === '' ? {} : { inicio: x.inicio }),
            ...(x.depoisDe === '' ? {} : { depoisDe: x.depoisDe }),
            ...(x.responsavelId === '' ? {} : { responsavelId: x.responsavelId }),
            ...(x.dose === '' ? {} : { dose: x.dose }),
            ...(x.valor.trim() === ''
              ? {}
              : { valor: (centavosDoTexto(x.valor) ?? 0n).toString() }),
          })),
          ...(pagamento === undefined ? {} : { pagamento }),
        }),
      })
      router.push(`/programas/${r.id}`)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui criar o programa.')
    } finally {
      setSalvando(false)
    }
  }

  const saldo =
    centavosDoTotal === null || centavosDaEntrada === null
      ? null
      : centavosDoTotal - centavosDaEntrada

  return (
    <section>
      <div className="eyebrow">Comercial</div>
      <div className="titulo">
        <h2>Novo programa de acompanhamento</h2>
      </div>

      <p className="nota" style={{ marginBottom: 14 }}>
        Monte o programa da paciente: um procedimento por linha, com sessões, intervalo e dose. Para
        escalonar a dose, adicione o mesmo procedimento de novo e escolha “Depois de outro item”.
      </p>

      <div className="formulario">
        <SeletorDePaciente escolhido={paciente} aoEscolher={setPaciente} />

        <Montador
          estado={montagem}
          aoMudar={setMontagem}
          podeValores={podeValores}
        />

        <label className="campo" style={{ maxWidth: 260 }}>
          Horário das sessões <small>(opcional)</small>
          <input
            type="time"
            className="num"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
          />
        </label>

        {podeReceber ? (
          <fieldset className="refs" style={{ display: 'grid', gap: 10 }}>
            <legend>Pagamento do programa</legend>
            <div className="par">
              <label className="campo">
                Valor total do programa (R$)
                <input
                  type="text"
                  inputMode="decimal"
                  className="num"
                  value={total}
                  placeholder="Em branco se paga por sessão"
                  onChange={(e) => setTotal(e.target.value)}
                />
              </label>
              <label className="campo">
                Pago na adesão (R$)
                <input
                  type="text"
                  inputMode="decimal"
                  className="num"
                  value={entrada}
                  placeholder="Em branco: paga depois"
                  onChange={(e) => setEntrada(e.target.value)}
                />
              </label>
            </div>

            {/* A FORMA só aparece quando entrou dinheiro — é o
                `adformal.hidden = !(ent > 0)` do protótipo, medido. */}
            {centavosDaEntrada !== null && centavosDaEntrada > 0n ? (
              <label className="campo" style={{ maxWidth: 260 }}>
                Forma de pagamento da entrada
                <select
                  value={forma}
                  onChange={(e) => setForma(e.target.value as typeof forma)}
                >
                  {FORMAS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <p className="nota">
              {centavosDoTotal === null ? (
                'Sem valor total: cada sessão registra quanto foi pago naquele dia.'
              ) : (
                <>
                  Saldo a receber: <b className="num">{formatarDinheiro(saldo ?? 0n)}</b>. Os
                  valores pagos nas sessões abatem esse saldo.
                </>
              )}
            </p>
          </fieldset>
        ) : (
          <p className="nota">
            O pagamento do programa vai pela tela <b>Recebimento</b>. Crie o programa sem valor — o
            saldo entra quando o pagamento for lançado.
          </p>
        )}

        {erro === null ? null : (
          <p className="campo erro" role="alert">
            {erro}
          </p>
        )}

        <div className="botoes">
          <button type="button" className="btn" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Criando…' : 'Criar programa e sessões'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => router.push('/programas')}
            disabled={salvando}
          >
            Cancelar
          </button>
        </div>
      </div>

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}
