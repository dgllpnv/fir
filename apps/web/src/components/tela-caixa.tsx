'use client'

import type {
  ConferenciaDeCaixa,
  ListaDaEquipe,
  ListaDeFechamentos,
  ConfigFinanceira,
} from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { consultaEmTexto, useDados } from '@/lib/dados'
import { centavos } from '@/lib/financeiro'
import { centavosDoTexto } from '@/lib/dinheiro-digitado'
import { diaEmTexto } from '@/lib/formato'
import { Carregando, Erro, Toast } from './estados'

/**
 * **O caixa do dia — a conferência às cegas.**
 *
 * O que esta tela NÃO faz, e é o ponto inteiro: ela não busca o esperado, não
 * o guarda em estado e não o esconde com CSS. **Ele não está na resposta.**
 * Enquanto o dia está aberto o servidor devolve `CaixaAberto`, um contrato que
 * não tem o campo — não é `null`, não é redigido: não existe. Não há aqui um
 * `if` sobre valor, porque não há valor a esconder.
 *
 * Depois do fechamento, quem tem `valores` vê a comparação; quem não tem vê
 * **"conferido"** ou **"com diferença"**, e nenhum número — inclusive a
 * diferença, que daria o esperado por subtração a quem digitou o contado. É a
 * ADR 0005.
 */

const FORMAS = ['Pix', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito'] as const

export function TelaCaixa({
  hoje,
  podeConfigurar,
}: {
  hoje: string
  podeConfigurar: boolean
}) {
  const [dia, setDia] = useState(hoje)
  const [contado, setContado] = useState<Record<string, string>>({})
  const [obs, setObs] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erroDoForm, setErroDoForm] = useState<string | null>(null)
  const [recado, setRecado] = useState<string | null>(null)

  const caixa = useDados<ConferenciaDeCaixa>(`v1/caixa${consultaEmTexto({ dia })}`)
  const ultimos = useDados<ListaDeFechamentos>('v1/caixa/ultimos')

  async function fechar(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setErroDoForm(null)

    const linhas: { forma: string; valor: string }[] = []
    for (const f of FORMAS) {
      const bruto = (contado[f] ?? '').trim()
      // Campo vazio é ZERO contado, não "não informado": a gaveta com zero em
      // dinheiro é uma informação, e uma forma ausente é um buraco que
      // ninguém confere.
      const v = bruto === '' ? 0n : centavosDoTexto(bruto)
      if (v === null) {
        setErroDoForm(`O valor de ${f} está num formato que não reconheço. Use 1.200,00.`)
        return
      }
      linhas.push({ forma: f, valor: v.toString() })
    }

    setSalvando(true)
    try {
      const r = await chamar<ConferenciaDeCaixa>('v1/caixa', {
        method: 'POST',
        body: JSON.stringify({ dia, obs: obs.trim(), contado: linhas }),
      })
      setRecado(
        r.fechado && r.conferido
          ? 'Caixa fechado: tudo conferido.'
          : 'Caixa fechado com diferença: confira abaixo.',
      )
      setContado({})
      setObs('')
      caixa.recarregar()
      ultimos.recarregar()
    } catch (erro) {
      setErroDoForm(erro instanceof ErroDaApi ? erro.message : 'Não consegui falar com o servidor.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section>
      <div className="eyebrow">Financeiro</div>
      <div className="titulo">
        <h2>Caixa do dia</h2>
      </div>

      <p className="nota" style={{ marginBottom: 14 }}>
        Ritual do fim do expediente: confira a maquininha, o extrato do Pix e o dinheiro da gaveta e
        informe os totais. A conferência é às cegas — o que o sistema registrou só aparece depois de
        fechar, para a comparação ser real.
      </p>

      <div className="par" style={{ marginBottom: 16 }}>
        <label className="campo">
          Dia
          <input type="date" max={hoje} value={dia} onChange={(e) => setDia(e.target.value)} />
        </label>
        {podeConfigurar ? <ResponsavelPeloCaixa /> : <div />}
      </div>

      {caixa.carregando ? (
        <Carregando linhas={2} />
      ) : caixa.erro !== null ? (
        <Erro mensagem={caixa.erro} recarregar={caixa.recarregar} />
      ) : caixa.dados === null ? null : caixa.dados.fechado ? (
        <Fechado c={caixa.dados} />
      ) : (
        <form className="cartao" onSubmit={fechar}>
          <b>Totais conferidos em {diaEmTexto(dia)}</b>
          <div className="grade-de-filtros">
            {caixa.dados.formas.map((f) => (
              <label className="campo" key={f}>
                {f}
                <input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={contado[f] ?? ''}
                  onChange={(e) => setContado((a) => ({ ...a, [f]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <label className="campo">
            Observação <small>(opcional)</small>
            <input
              maxLength={160}
              value={obs}
              placeholder="Ex.: troco de R$ 50 deixado na gaveta"
              onChange={(e) => setObs(e.target.value)}
            />
          </label>
          {erroDoForm === null ? null : (
            <p className="campo" role="alert">
              <span className="erro">{erroDoForm}</span>
            </p>
          )}
          <div className="botoes">
            <button type="submit" className="btn" disabled={salvando}>
              {salvando ? 'Fechando…' : 'Fechar caixa'}
            </button>
          </div>
        </form>
      )}

      <div className="grupo" style={{ marginTop: 24 }}>
        <h3>Últimos fechamentos</h3>
        {ultimos.carregando ? (
          <Carregando linhas={3} fino />
        ) : ultimos.erro !== null ? (
          <Erro mensagem={ultimos.erro} recarregar={ultimos.recarregar} />
        ) : (ultimos.dados?.itens.length ?? 0) === 0 ? (
          <p className="nota">
            Nenhum caixa fechado ainda. O primeiro fechamento vira a referência dos próximos.
          </p>
        ) : (
          <div className="linhas">
            {ultimos.dados!.itens.map((f) => (
              <button
                key={f.dia}
                type="button"
                className="linha"
                style={{ textAlign: 'left', width: '100%', background: 'none', border: 0, borderBottom: '1px solid var(--line)' }}
                onClick={() => setDia(f.dia)}
              >
                <div className="info">
                  <b className="num">{diaEmTexto(f.dia)}</b>
                  <small>
                    {f.fechadoPor}
                    {f.obs === '' ? '' : ` · ${f.obs}`}
                  </small>
                </div>
                <Selo conferido={f.conferido} diferenca={f.diferenca} />
              </button>
            ))}
          </div>
        )}
      </div>

      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </section>
  )
}

/**
 * O dia já fechado: a comparação, que é o que a clínica veio ver.
 *
 * **Nenhum `if` de permissão aqui.** Sem `valores`, `esperado`, `contado` e
 * `diferenca` chegam `null`, e `formatarDinheiro(null)` é "—". O que a pessoa
 * lê é `conferido`, que é booleano e atravessa a redação.
 */
function Fechado({ c }: { c: Extract<ConferenciaDeCaixa, { fechado: true }> }) {
  return (
    <div className="cartao">
      <b>
        Caixa de {diaEmTexto(c.dia)} fechado por {c.fechadoPor.nome}
      </b>

      <div className="tabela-rolavel">
        <table className="lista conferencia">
          <thead>
            <tr>
              <th>Forma</th>
              <th className="direita">Registrado</th>
              <th className="direita">Conferido</th>
              <th className="direita">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {c.porForma.map((l) => (
              /*
                `data-rotulo` repete o cabeçalho em 390 px, onde a tabela vira
                blocos (ver `rotina.css`). Quatro colunas de número não cabem
                em 390 px, e rolar para o lado com o telefone tocando é pior
                que ler de cima para baixo.
              */
              <tr key={l.forma}>
                <td>{l.forma}</td>
                <td className="direita" data-rotulo="Registrado">
                  {formatarDinheiro(centavos(l.esperado))}
                </td>
                <td className="direita" data-rotulo="Conferido">
                  {formatarDinheiro(centavos(l.contado))}
                </td>
                <td className="direita" data-rotulo="Diferença">
                  <Selo conferido={l.diferenca === '0'} diferenca={l.diferenca} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="nota" style={{ margin: 0 }}>
        {c.conferido ? (
          <>Tudo conferido: o registrado bate com o que você contou.</>
        ) : c.diferenca === null ? (
          <>
            <b style={{ color: 'var(--bad)' }}>O caixa fechou com diferença.</b> Confira com o
            administrativo.
          </>
        ) : (
          <>
            <b style={{ color: 'var(--bad)' }}>
              {/* O SINAL vira palavra: "falta R$ 50,00" lê melhor que
                  "diferença de -R$ 50,00", e o sinal já está em cada linha da
                  tabela acima. Trocar o sinal pelo seu oposto é formatação, não
                  cálculo — o número não muda de magnitude. */}
              {BigInt(c.diferenca) < 0n ? 'Faltam ' : 'Sobraram '}
              {formatarDinheiro(absoluto(c.diferenca))}
            </b>
            : confira se algum recebimento ficou sem registro — ou foi lançado duas vezes — e
            registre em Recebimentos.
          </>
        )}
        {c.obs === '' ? null : <> Observação: {c.obs}</>}
      </p>

      {c.promissorias.quantidade === 0 ? null : (
        <p className="nota" style={{ margin: 0 }}>
          {/* Fora dos DOIS lados da conferência: a promissória é receita, mas
              não está na gaveta. */}
          {c.promissorias.quantidade === 1 ? '1 nota promissória' : `${c.promissorias.quantidade} notas promissórias`}{' '}
          no dia, {formatarDinheiro(centavos(c.promissorias.valor))} — fora da conferência, porque
          não está na gaveta.
        </p>
      )}
    </div>
  )
}

/** O módulo de um valor, para a frase que já carrega o sinal em palavra. */
const absoluto = (texto: string): bigint => {
  const n = BigInt(texto)
  return n < 0n ? -n : n
}

/**
 * "conferido" ou "com diferença" — e o número só quando ele existe.
 *
 * Sem `valores` o servidor manda `diferenca: null`, e o selo diz só que houve
 * diferença. É a ADR 0005: mostrar a diferença a quem digitou o contado é
 * mostrar o esperado por subtração.
 */
function Selo({ conferido, diferenca }: { conferido: boolean; diferenca: string | null }) {
  if (conferido) return <span className="pill bom">conferido</span>
  if (diferenca === null) return <span className="pill mau">com diferença</span>
  const n = BigInt(diferenca)
  const sobra = n > 0n
  return (
    <span className={`pill num ${sobra ? 'alerta' : 'mau'}`}>
      {sobra ? 'sobra' : 'falta'} {formatarDinheiro(sobra ? n : -n)}
    </span>
  )
}

/**
 * Quem fecha o caixa, por padrão.
 *
 * Só aparece para quem tem `finmes` — e a escolha é visível de propósito: o
 * desenho pressupõe que a responsável **não** tenha `valores`, e é o que torna
 * a conferência cega de ponta a ponta. Pôr o Financeiro aqui transforma o
 * ritual em teatro, e nada no código avisa.
 */
function ResponsavelPeloCaixa() {
  const config = useDados<ConfigFinanceira>('v1/configuracoes/financeiro')
  const equipe = useDados<ListaDaEquipe>('v1/equipe')
  const [recado, setRecado] = useState<string | null>(null)

  if (config.dados === null || equipe.dados === null) return <div />

  return (
    <>
      <label className="campo">
        Responsável pelo fechamento
        <select
          value={config.dados.caixaResponsavelId ?? ''}
          onChange={async (e) => {
            const id = e.target.value === '' ? null : e.target.value
            await chamar('v1/configuracoes/financeiro', {
              method: 'PATCH',
              body: JSON.stringify({
                caixaResponsavelId: id,
                mensagemDeCobranca: config.dados?.mensagemDeCobranca ?? '',
              }),
            }).catch(() => undefined)
            config.recarregar()
            setRecado('Responsável pelo caixa atualizado.')
          }}
        >
          <option value="">Ninguém definido</option>
          {equipe.dados.equipe.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </select>
      </label>
      <Toast recado={recado} aoFechar={() => setRecado(null)} />
    </>
  )
}
