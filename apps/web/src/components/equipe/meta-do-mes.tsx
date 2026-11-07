'use client'

import type { MetaDePessoa } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { useState } from 'react'
import { centavosDoTexto, textoDeCentavos } from '@/lib/dinheiro-digitado'
import { centavos, larguraDaBarra } from '@/lib/financeiro'

/** O corpo de criar OU editar uma meta — o alvo, na escala do indicador. */
export type CorpoDaMeta = {
  indicador: MetaDePessoa['indicador']
  nome: string
  metaEmNumero: number | null
  metaEmDinheiro: string | null
}

/**
 * **UM CARTÃO DE META** — o mesmo em *Equipe › Metas* e em *Minhas metas*.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTE COMPONENTE NÃO TEM UM ÚNICO `if` DE PERMISSÃO, E É O PONTO.
 *
 * A meta de `orc_valor` chega em `metaEmDinheiro`/`realizadoEmDinheiro`; as
 * outras oito em `metaEmNumero`/`realizadoEmNumero`. Sem a permissão
 * `valores`, o **servidor** apaga os dois primeiros (regra 17), e o que sobra
 * é `percentual` — que atravessa sempre, porque *"84% da meta"* não revela
 * quanto é a meta.
 *
 * Então a regra "sem `valores`, a meta entrega só o percentual" é verdade aqui
 * **sem a tela decidir nada**: ela desenha o que chegou. A única coisa que ela
 * faz com a redação é NOMEÁ-LA (ver `dinheiroOculto`, abaixo) — e nomear não é
 * decidir: o servidor já apagou o número, e dizer "meta em reais" não revela
 * quanto é. O protótipo calcula atingimento e média no navegador, em dois
 * lugares diferentes (`metaCardHtml` e `pesMetas`).
 * ────────────────────────────────────────────────────────────────────────────
 *
 * **O que esta tela NÃO calcula:** nem o realizado (são oito consultas), nem o
 * percentual, nem a média, nem o nome do indicador — todos vêm prontos.
 *
 * **390 px:** o nome em cima, o par `realizado de meta` e o percentual numa
 * linha que quebra, e a barra colada embaixo. Algarismos tabulares em todo
 * número (`docs/design.md`).
 */
export function MetaDoMes({
  meta,
  aoLancar,
  aoRemover,
  aoEditar,
  salvando,
}: {
  meta: MetaDePessoa
  /** `undefined` = somente leitura (é *Minhas metas*). */
  aoLancar?: (valor: number | null) => void
  aoRemover?: () => void
  aoEditar?: (corpo: CorpoDaMeta) => void
  salvando?: boolean
}) {
  const [editando, setEditando] = useState(false)
  /**
   * **O VALOR FOI REDIGIDO** — e a tela pode dizer isso sem vazar nada.
   *
   * `tipo === 'valor'` com `metaEmDinheiro === null` só acontece por uma
   * razão: o `RedacaoInterceptor` apagou o campo (regra 17). O contrato exige
   * `metaEmDinheiro > 0` em toda meta de `orc_valor`, então uma meta em reais
   * sem o número é uma meta em reais que quem olha não pode ver.
   *
   * **Medido no navegador, e é por isso que esta distinção existe:** sem ela a
   * tela mostrava *"Orçamentos fechados (valor) · meta —"*, que lê como "a
   * gestão esqueceu de definir a meta" e manda a pessoa cobrar uma coisa que
   * já foi feita. Dizer *"meta em reais"* não revela quanto é — o nome do
   * indicador já diz que ele é dinheiro.
   */
  const dinheiroOculto = meta.tipo === 'valor' && meta.metaEmDinheiro === null
  const alvo = textoDaMeta(meta, 'meta')
  const feito = textoDaMeta(meta, 'realizado')
  const faixa = faixaDoAtingimento(meta.percentual)

  return (
    <div className="meta-de-pessoa" data-faixa={faixa}>
      <div className="meta-de-pessoa-topo">
        <div>
          <b>{meta.nome}</b>
          <span className="muted">
            {meta.automatica ? 'calculada pela ferramenta' : 'lançamento manual'} ·{' '}
            {dinheiroOculto ? 'meta em reais, que seu perfil não mostra' : `meta ${alvo}`}
          </span>
        </div>
        <div className="meta-de-pessoa-valor">
          <b className="num">{feito}</b>
          <span className={`pill ${classeDaPilula(faixa)}`}>
            {meta.percentual === null ? 'sem dado' : `${meta.percentual}%`}
          </span>
        </div>
      </div>

      {/* A barra é um DESENHO e o número é o texto acima: a largura é um
          `width` que o servidor decidiu, nunca uma divisão feita aqui. */}
      <div
        className="barra"
        role="img"
        aria-label={
          meta.percentual === null ? 'sem dado no período' : `${meta.percentual}% da meta`
        }
      >
        <i style={{ width: larguraDaBarra(meta.percentual) }} />
      </div>

      {editando && aoEditar !== undefined ? (
        <EditarAlvo
          meta={meta}
          aoSalvar={(corpo) => {
            aoEditar(corpo)
            setEditando(false)
          }}
          aoCancelar={() => setEditando(false)}
          salvando={salvando === true}
        />
      ) : null}

      {aoLancar === undefined && aoRemover === undefined && aoEditar === undefined ? null : (
        <div className="meta-de-pessoa-acoes">
          {/*
            O campo de resultado existe SÓ na meta manual, e isso não é
            cosmético: o servidor responde 422 nas automáticas, com a razão. No
            protótipo o campo aparece em todas, a gravação "dá certo", e a
            leitura ignora o número — a gestora digita e acha que lançou.
          */}
          {meta.automatica || aoLancar === undefined ? null : (
            <LancarResultado
              atual={meta.realizadoEmNumero}
              aoLancar={aoLancar}
              salvando={salvando === true}
            />
          )}
          {/*
            **Editar some quando o valor foi redigido** (regra 17): sem
            `valores`, `metaEmDinheiro` chega `null` e um "Editar" aqui
            convidaria a pessoa a digitar um número novo por cima de um alvo
            que ela não pode ver — a edição substituiria o alvo real por um
            chute, em vez de recusar.
          */}
          {aoEditar === undefined || editando || dinheiroOculto ? null : (
            <button
              type="button"
              className="link"
              onClick={() => setEditando(true)}
              disabled={salvando === true}
            >
              Editar
            </button>
          )}
          {aoRemover === undefined ? null : (
            <button
              type="button"
              className="link perigo"
              onClick={aoRemover}
              disabled={salvando === true}
            >
              Remover
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** O formulário inline de editar o alvo — mesma escala e regras da criação. */
function EditarAlvo({
  meta,
  aoSalvar,
  aoCancelar,
  salvando,
}: {
  meta: MetaDePessoa
  aoSalvar: (corpo: CorpoDaMeta) => void
  aoCancelar: () => void
  salvando: boolean
}) {
  const manual = meta.indicador === 'manual'
  const [nome, setNome] = useState(meta.nome)
  const [valor, setValor] = useState(
    meta.tipo === 'valor'
      ? meta.metaEmDinheiro === null
        ? ''
        : textoDeCentavos(BigInt(meta.metaEmDinheiro))
      : String(meta.metaEmNumero ?? ''),
  )
  const [erro, setErro] = useState<string | null>(null)

  return (
    <form
      className="nova-meta"
      onSubmit={(e) => {
        e.preventDefault()
        setErro(null)
        if (meta.tipo === 'valor') {
          // `centavosDoTexto` — a ÚNICA leitura de dinheiro digitado do front
          // (ver `lib/dinheiro-digitado.ts`): "2.000" é dois mil reais, como
          // se digita no balcão, nunca `Number("2.000") * 100` (que lê "2.000"
          // como 2 e grava R$ 2,00 — 1000x menor, em silêncio).
          const valorEmCentavos = centavosDoTexto(valor)
          if (valorEmCentavos === null || valorEmCentavos <= 0n) {
            setErro('Informe a meta em reais — um valor maior que zero.')
            return
          }
          aoSalvar({
            indicador: meta.indicador,
            nome: manual ? nome.trim() : '',
            metaEmDinheiro: String(valorEmCentavos),
            metaEmNumero: null,
          })
          return
        }
        const n = Number(valor.replace(',', '.'))
        if (!Number.isFinite(n) || n <= 0) {
          setErro('Informe a meta — um número maior que zero.')
          return
        }
        aoSalvar({
          indicador: meta.indicador,
          nome: manual ? nome.trim() : '',
          metaEmDinheiro: null,
          metaEmNumero: Math.round(n),
        })
      }}
    >
      {manual ? (
        <label className="campo">
          Nome da meta
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={60}
            required
          />
        </label>
      ) : null}
      <label className="campo">
        Meta{' '}
        <small>{meta.tipo === 'pct' ? '(%)' : meta.tipo === 'valor' ? '(R$)' : '(quantidade)'}</small>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          type="text"
          inputMode="decimal"
          className="num"
          required
        />
      </label>
      {erro === null ? null : (
        <p className="campo erro" role="alert">
          {erro}
        </p>
      )}
      <div className="acoes-de-tela">
        <button type="submit" className="btn" disabled={salvando}>
          Salvar
        </button>
        <button type="button" className="link" onClick={aoCancelar} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

/**
 * O campo de resultado da meta manual. **Vazio LIMPA o lançamento.**
 *
 * Zero é um resultado declarado como zero, e vazio é "ainda não lancei" — os
 * dois não são a mesma coisa, e é por isso que o corpo manda `null` e não `0`.
 * Medido no protótipo: `realizado: 0` devolve `0`, `realizado: ''` devolve
 * `null`.
 */
function LancarResultado({
  atual,
  aoLancar,
  salvando,
}: {
  atual: number | null
  aoLancar: (valor: number | null) => void
  salvando: boolean
}) {
  return (
    <form
      className="meta-de-pessoa-lancar"
      onSubmit={(e) => {
        e.preventDefault()
        const campo = new FormData(e.currentTarget).get('resultado')
        const texto = String(campo ?? '').trim()
        aoLancar(texto === '' ? null : Number(texto))
      }}
    >
      <label className="campo">
        <span className="rotulo-curto">Realizado</span>
        <input
          name="resultado"
          type="text"
          inputMode="numeric"
          className="num"
          defaultValue={atual === null ? '' : String(atual)}
          placeholder="—"
          aria-label="Resultado realizado"
        />
      </label>
      <button type="submit" className="link" disabled={salvando}>
        Salvar
      </button>
    </form>
  )
}

/**
 * O texto de um dos dois lados, na escala do indicador.
 *
 * `null` é `—` nos três casos — sem dado, sem lançamento, e redigido por falta
 * de `valores`. Quem distingue o terceiro é `dinheiroOculto`, no corpo do
 * componente, e só para o RÓTULO: o número continua sendo `—`.
 */
function textoDaMeta(meta: MetaDePessoa, lado: 'meta' | 'realizado'): string {
  if (meta.tipo === 'valor') {
    const bruto = lado === 'meta' ? meta.metaEmDinheiro : meta.realizadoEmDinheiro
    const v = centavos(bruto)
    return v === null ? '—' : formatarDinheiro(v)
  }
  const n = lado === 'meta' ? meta.metaEmNumero : meta.realizadoEmNumero
  if (n === null) return '—'
  return meta.tipo === 'pct' ? `${n}%` : String(n)
}

type Faixa = 'sem-dado' | 'baixo' | 'meio' | 'ok'

/**
 * As três faixas do protótipo: `>= 100` ok, `>= 70` meio, o resto baixo.
 *
 * É classificação de APRESENTAÇÃO sobre um percentual que o servidor calculou
 * — não é conta. A cor sai dos tokens, nunca de um hex escrito aqui.
 */
function faixaDoAtingimento(percentual: number | null): Faixa {
  if (percentual === null) return 'sem-dado'
  if (percentual >= 100) return 'ok'
  if (percentual >= 70) return 'meio'
  return 'baixo'
}

/**
 * As pílulas da casa — `bom`, `dourado`, `alerta` — e nenhuma classe nova de
 * cor. `sem-dado` fica com a pílula neutra: `—` já diz o que há a dizer.
 */
const classeDaPilula = (f: Faixa): string =>
  f === 'ok' ? 'bom' : f === 'meio' ? 'dourado' : f === 'baixo' ? 'alerta' : ''
