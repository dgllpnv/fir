'use client'

import type { MetaDePessoa } from '@fir/contracts'
import { formatarDinheiro } from '@fir/ui'
import { centavos, larguraDaBarra } from '@/lib/financeiro'

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
  salvando,
}: {
  meta: MetaDePessoa
  /** `undefined` = somente leitura (é *Minhas metas*). */
  aoLancar?: (valor: number | null) => void
  aoRemover?: () => void
  salvando?: boolean
}) {
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

      {aoLancar === undefined && aoRemover === undefined ? null : (
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
