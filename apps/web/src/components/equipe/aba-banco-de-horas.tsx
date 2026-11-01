'use client'

import type { BancoDeHoras, LinhaDoBancoDeHoras } from '@fir/contracts'
import {
  LIMITE_DE_HORAS_MAXIMO_EM_MINUTOS,
  MINUTOS_POR_HORA,
  ehErro,
  formatarSaldoDeHoras,
  lerSaldoDeHoras,
} from '@fir/domain'
import { useEffect, useState } from 'react'
import { chamar } from '@/lib/api'
import { useDados } from '@/lib/dados'
import { mesEmTexto } from '@/lib/formato'
import { ICONE_ANTERIOR, ICONE_PROXIMO } from '@/lib/icones'
import { Carregando, Erro, Vazio } from '../estados'


/**
 * **Aba Banco de horas** — lançar o saldo do mês de cada pessoa.
 *
 * *"A ferramenta não registra ponto. No fim do mês, lance o saldo de cada
 * pessoa como aparece no aplicativo oficial de ponto (ex.: +6:30 ou −2:15)"*
 * (MANUAL cap. 13).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * **A LEITURA E A ESCRITA DO SALDO SÃO DO DOMÍNIO.**
 *
 * `lerSaldoDeHoras` e `formatarSaldoDeHoras` moram em `packages/domain`, e são
 * a **inversa** uma da outra — provado por property-based test. O que a célula
 * mostra é exatamente o que ela aceita de volta, e o número que trafega é
 * **minuto inteiro** (regra 8). O protótipo guarda hora decimal e imprime
 * `0h60` quando o saldo é `0,999`.
 *
 * A tela não valida "é um saldo?" com uma expressão regular própria: ela chama
 * o domínio e mostra a mensagem dele.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **390 px:** a tabela de 7 colunas vira BLOCO abaixo de 620 px, com os
 * rótulos repetidos — nada rola na horizontal (`docs/design.md`).
 */
export function AbaBancoDeHoras({
  hoje,
  avisar,
}: {
  hoje: string
  avisar: (a: string) => void
}) {
  const [mes, setMes] = useState(hoje.slice(0, 7))
  const dados = useDados<BancoDeHoras>(`v1/fichas/horas/${mes}`)
  const d = dados.dados

  return (
    <>
      <p className="nota" style={{ marginTop: 0 }}>
        Lance o <b>saldo do banco de horas</b> de cada pessoa no fim do mês, como aparece no
        aplicativo oficial de ponto (ex.: +6:30 ou −2:15). A ferramenta não registra ponto: ela
        acompanha o saldo e avisa quando passa do limite.
      </p>

      {d === null ? null : <Limite atual={d.limiteDeHorasEmMinutos} aoSalvar={avisar} />}

      {/* `iconbtn` + os ícones SVG da casa: ícone é SVG com rótulo, nunca
          glifo de texto nem emoji (`docs/design.md` §3). Mesmo par da faixa
          da semana. */}
      <div className="nav-de-mes">
        <button
          type="button"
          className="iconbtn"
          aria-label="Mês anterior"
          onClick={() => setMes(mudarMes(mes, -1))}
        >
          {ICONE_ANTERIOR}
        </button>
        <b>Saldo de {mesEmTexto(mes)}</b>
        <button
          type="button"
          className="iconbtn"
          aria-label="Próximo mês"
          onClick={() => setMes(mudarMes(mes, 1))}
        >
          {ICONE_PROXIMO}
        </button>
      </div>

      {dados.carregando ? (
        <Carregando linhas={4} />
      ) : dados.erro !== null ? (
        <Erro mensagem={dados.erro} recarregar={dados.recarregar} />
      ) : d === null ? null : d.linhas.length === 0 ? (
        <Vazio>
          <p style={{ margin: 0, color: 'var(--ink)' }}>
            Nenhuma pessoa CLT ou estagiária com ficha ativa.
          </p>
          <p className="nota" style={{ margin: 0 }}>
            O banco de horas acompanha quem tem jornada controlada. Crie as fichas na aba
            <b> Visão geral</b>.
          </p>
        </Vazio>
      ) : (
        <Tabela
          dados={d}
          mes={mes}
          avisar={avisar}
          aoSalvar={() => {
            dados.recarregar()
            avisar(`Saldos de ${mesEmTexto(mes)} salvos.`)
          }}
        />
      )}
    </>
  )
}

/**
 * `aaaa-mm` ± n meses, por aritmética de calendário em inteiros.
 *
 * Navegação de mês é NAVEGAÇÃO, não data de negócio: o servidor decide o que
 * "hoje" é (e é de lá que vem o mês inicial), e isto só move a janela que a
 * gestora está olhando. Sem `Date`, porque `new Date('2026-11')` é um instante
 * UTC e num fuso a oeste o mês escorrega.
 */
function mudarMes(mes: string, n: number): string {
  const [ano, m] = mes.split('-').map(Number)
  const total = (ano ?? 1970) * 12 + ((m ?? 1) - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/* ========================================================================== */

function Limite({ atual, aoSalvar }: { atual: number; aoSalvar: (a: string) => void }) {
  const [horas, setHoras] = useState(String(atual / MINUTOS_POR_HORA))
  const [ocupado, setOcupado] = useState(false)

  // O valor do servidor manda: depois de salvar, a resposta é a verdade.
  useEffect(() => setHoras(String(atual / MINUTOS_POR_HORA)), [atual])

  async function salvar(valor: string) {
    const n = Number(valor)
    const minutos = Math.round(n * MINUTOS_POR_HORA)
    if (
      !Number.isInteger(n) ||
      minutos < MINUTOS_POR_HORA ||
      minutos > LIMITE_DE_HORAS_MAXIMO_EM_MINUTOS
    ) {
      aoSalvar(`O limite vai de 1 a ${LIMITE_DE_HORAS_MAXIMO_EM_MINUTOS / MINUTOS_POR_HORA} horas.`)
      setHoras(String(atual / MINUTOS_POR_HORA))
      return
    }
    setOcupado(true)
    try {
      await chamar('v1/fichas/configuracao', {
        method: 'PUT',
        body: JSON.stringify({ limiteDeHorasEmMinutos: minutos }),
      })
      aoSalvar(`Limite de alerta: ±${n}h.`)
    } catch (e) {
      aoSalvar(e instanceof Error ? e.message : 'Não consegui salvar o limite.')
      setHoras(String(atual / MINUTOS_POR_HORA))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <label className="campo" style={{ maxWidth: 220, marginBottom: 12 }}>
      Limite de alerta (horas)
      <input
        type="number"
        min={1}
        max={LIMITE_DE_HORAS_MAXIMO_EM_MINUTOS / MINUTOS_POR_HORA}
        value={horas}
        disabled={ocupado}
        style={{ fontVariantNumeric: 'tabular-nums' }}
        onChange={(e) => setHoras(e.target.value)}
        onBlur={(e) => void salvar(e.target.value)}
      />
      <small>Acima dele, a pessoa entra nos alertas da Visão geral.</small>
    </label>
  )
}

/* ========================================================================== */

type Rascunho = { readonly saldo: string; readonly obs: string }

function Tabela({
  dados,
  mes,
  avisar,
  aoSalvar,
}: {
  dados: BancoDeHoras
  mes: string
  avisar: (a: string) => void
  aoSalvar: () => void
}) {
  const [rascunho, setRascunho] = useState<Record<string, Rascunho>>(() => inicial(dados.linhas))
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Trocar de mês troca a tabela inteira: sem isto, o saldo digitado em
  // outubro reapareceria no campo de novembro.
  useEffect(() => setRascunho(inicial(dados.linhas)), [dados.linhas])

  async function salvar() {
    setErro(null)
    const linhas: { fichaId: string; saldoEmMinutos: number | null; obs: string }[] = []
    for (const l of dados.linhas) {
      const r = rascunho[l.fichaId] ?? { saldo: '', obs: '' }
      // A VALIDAÇÃO É DO DOMÍNIO, e a mensagem também.
      const lido = lerSaldoDeHoras(r.saldo)
      if (ehErro(lido)) {
        setErro(`${l.nome}: ${lido.erro.mensagem}`)
        return
      }
      linhas.push({ fichaId: l.fichaId, saldoEmMinutos: lido.valor, obs: r.obs.trim() })
    }

    setOcupado(true)
    try {
      await chamar(`v1/fichas/horas/${mes}`, { method: 'PUT', body: JSON.stringify({ linhas }) })
      aoSalvar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não consegui salvar os saldos.')
    } finally {
      setOcupado(false)
    }
  }

  const meses = dados.linhas[0]?.anteriores.map((a) => a.mes) ?? []

  return (
    <>
      <div className="tabela-rolavel">
        <table className="horas">
          <thead>
            <tr>
              <th>Pessoa</th>
              {meses.map((m) => (
                <th key={m} className="direita">
                  {mesEmTexto(m)}
                </th>
              ))}
              <th className="direita">{mesEmTexto(mes)} (lançar)</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {dados.linhas.map((l) => {
              const r = rascunho[l.fichaId] ?? { saldo: '', obs: '' }
              return (
                <tr key={l.fichaId}>
                  <td>
                    <b>{l.nome}</b>
                    {l.cargo === '' ? null : <div className="cargo">{l.cargo}</div>}
                  </td>
                  <td className="historico" data-rotulo="Meses anteriores">
                    <div className="historico-de-horas">
                      {l.anteriores.map((a) => (
                        <span
                          key={a.mes}
                          className={
                            a.saldoEmMinutos !== null &&
                            Math.abs(a.saldoEmMinutos) > dados.limiteDeHorasEmMinutos
                              ? 'estourou'
                              : undefined
                          }
                        >
                          {mesEmTexto(a.mes)}{' '}
                          <b>
                            {a.saldoEmMinutos === null
                              ? '—'
                              : formatarSaldoDeHoras(a.saldoEmMinutos)}
                          </b>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="direita" data-rotulo={`Saldo de ${mesEmTexto(mes)}`}>
                    <input
                      type="text"
                      className="saldo-digitado"
                      inputMode="text"
                      aria-label={`Saldo de ${l.nome} em ${mesEmTexto(mes)}`}
                      placeholder="+0:00"
                      value={r.saldo}
                      onChange={(e) =>
                        setRascunho((a) => ({
                          ...a,
                          [l.fichaId]: { ...r, saldo: e.target.value },
                        }))
                      }
                    />
                  </td>
                  <td data-rotulo="Observação">
                    <input
                      type="text"
                      maxLength={80}
                      aria-label={`Observação de ${l.nome}`}
                      placeholder="Opcional"
                      value={r.obs}
                      onChange={(e) =>
                        setRascunho((a) => ({ ...a, [l.fichaId]: { ...r, obs: e.target.value } }))
                      }
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {erro === null ? null : (
        <p className="erro" role="alert">
          {erro}
        </p>
      )}

      <p className="nota" style={{ marginBottom: 8 }}>
        Campo vazio <b>apaga</b> o lançamento do mês. Zero é um saldo: a pessoa fechou quitada.
      </p>

      <div className="botoes">
        <button type="button" className="btn" onClick={() => void salvar()} disabled={ocupado}>
          {ocupado ? 'Salvando…' : `Salvar saldos de ${mesEmTexto(mes)}`}
        </button>
      </div>
    </>
  )
}

/**
 * O rascunho parte do que está GRAVADO, formatado pelo domínio.
 *
 * É a ida-e-volta exata que torna isto seguro: `formatarSaldoDeHoras` imprime
 * `+6h30`, `lerSaldoDeHoras` lê `+6h30` de volta como 390 minutos, e salvar
 * sem tocar em nada não muda número nenhum.
 */
const inicial = (linhas: readonly LinhaDoBancoDeHoras[]): Record<string, Rascunho> =>
  Object.fromEntries(
    linhas.map((l) => [
      l.fichaId,
      {
        saldo: l.saldoEmMinutos === null ? '' : formatarSaldoDeHoras(l.saldoEmMinutos),
        obs: l.obs,
      },
    ]),
  )
