import { Dinheiro } from '../dinheiro'
import { ehErro, erro, erroDe, ok, type Result } from '../resultado'

/**
 * **A CÉLULA DA PLANILHA, E AS CINCO CONVERSÕES DECLARADAS.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE UMA CÉLULA É, DE VERDADE
 *
 * Num `.xlsx`, uma célula é **texto** no XML da aba:
 *
 *     <c r="P2"><v>1250.5</v></c>              número
 *     <c r="P2" t="s"><v>14</v></c>            índice na tabela de strings
 *     <c r="P2" t="inlineStr"><is><t>…</t>…    texto embutido
 *
 * O número **nunca** é um `double` no arquivo: é o literal decimal `1250.5`.
 * Quem o lê com `Number()` — e é o que toda biblioteca de planilha faz — troca
 * um literal exato por um binário aproximado, e aí `R$ 12,30` pode voltar como
 * `12.299999999999999`. O ponto deste módulo é que **esse `Number()` não
 * acontece em dinheiro nenhum**: os dígitos do literal viram centavos
 * inteiros direto, como `leitor-de-nota.ts` já faz com `vUnCom` da NF-e.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA DE ARREDONDAMENTO, DECLARADA UMA VEZ (ADR 0009)
 *
 * A v20 grava `Math.round(n * 100) / 100` — ou seja, ela JÁ tentou duas casas,
 * e o que sobrou no arquivo é o que o float conseguiu representar. Então:
 *
 *   1. até 2 casas decimais → conversão **exata**, sem arredondar nada;
 *   2. mais de 2 casas → arredonda na segunda, **meio para cima em módulo**
 *      (`12.345` → `1235`; `-12.345` → `-1235`), e a conversão **declara**
 *      isso em `arredondou`, que o relatório de conferência soma e imprime.
 *
 * O item (2) **não é tolerância**: a conferência continua exigindo igualdade
 * exata entre a soma da origem e a soma do destino, porque as duas somas são
 * calculadas sobre o MESMO resultado de (1)+(2). O que `arredondou` responde é
 * outra pergunta — *"a migração mexeu em algum centavo?"* — e a resposta tem
 * de ser auditável, não implícita.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE O DADO REAL DAS CLÍNICAS TEM, E QUE QUEBRA UM IMPORTADOR INGÊNUO
 *
 *  - a mesma coluna lógica vem às vezes como texto e às vezes como número,
 *    linha a linha (a v20 formata a aba como texto, mas linhas gravadas em
 *    outros momentos escaparam);
 *  - data como **serial do Excel** (`45678` = dias desde 1899-12-30) ao lado
 *    de data como texto ISO, na mesma coluna;
 *  - data-hora como serial **fracionário** (`45678.5416666667`), que é uma
 *    hora local com erro de arredondamento de segundo;
 *  - data-hora em texto com `T` **e** com espaço (`2026-01-05T09:30` e
 *    `2026-01-05 09:30`), na mesma coluna;
 *  - telefone em **notação científica** (`5.5719999999E10`), porque alguém
 *    digitou só dígitos numa célula numérica;
 *  - `"1"` exportado como `"1.0"`, que quebra toda comparação de flag;
 *  - espaço duplo e espaço no fim em nome de pessoa.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** O tipo declarado na célula do `.xlsx`. */
export type TipoDeCelula = 'n' | 's' | 'str' | 'b' | 'e' | 'd'

/**
 * Uma célula como ela está no arquivo: o **literal**, mais o tipo.
 *
 * `bruto` é sempre `string`, e isto é o desenho inteiro: um `number` aqui
 * jogaria fora o literal decimal antes de qualquer conversão poder decidir o
 * que fazer com ele.
 */
export type Celula = {
  readonly bruto: string
  readonly tipo: TipoDeCelula
}

export const CELULA_VAZIA: Celula = { bruto: '', tipo: 's' }

/** Toda conversão devolve o valor **e** se ela mexeu em algum centavo. */
export type Convertido<T> = {
  readonly valor: T
  /** `true` quando a regra (2) do arredondamento declarado foi aplicada. */
  readonly arredondou: boolean
}

const semArredondar = <T>(valor: T): Convertido<T> => ({ valor, arredondou: false })

/**
 * Expande notação científica **pelos dígitos**, sem passar por `Number`.
 *
 * `5.5719999999E10` → `55719999999`. O literal do `.xlsx` carrega todos os
 * dígitos significativos do valor, então a expansão é exata — e é a única
 * forma de recuperar um telefone que virou célula numérica. Com `Number()` o
 * resultado passa por binário e volta como `55719999999` por sorte, ou como
 * `5.5719999999e+10` quando alguém o concatena.
 */
export function expandirCientifica(literal: string): string {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(literal)
  if (m === null) return literal

  const [, sinal = '', inteiros = '', decimais = '', expoente = '0'] = m
  const digitos = inteiros + decimais
  const ponto = inteiros.length + Number(expoente)

  if (ponto <= 0) return `${sinal}0.${'0'.repeat(-ponto)}${digitos}`
  if (ponto >= digitos.length) return sinal + digitos + '0'.repeat(ponto - digitos.length)
  return `${sinal}${digitos.slice(0, ponto)}.${digitos.slice(ponto)}`
}

/** `"12.300"` → `"12.3"`; `"1.0"` → `"1"`; `"0.50"` → `"0.5"`. */
function aparar(literal: string): string {
  if (!literal.includes('.')) return literal
  return literal.replace(/\.?0+$/, '') || '0'
}

/**
 * O texto da célula, **aparado**, com espaços internos colapsados.
 *
 * Colapsar o espaço interno é o `normalizar` do `Code.gs` aplicado na borda, e
 * não é zelo: `"Maria  Souza"` e `"Maria Souza"` são a mesma pessoa, e com o
 * espaço duplo intacto o índice `pacientes_nome_unico` (que normaliza) aceita
 * a linha e o relatório de LTV passa a ter duas chaves para uma paciente.
 *
 * O número é **aparado do zero à direita** antes de virar texto: a exportação
 * escreve `"1"` como `"1.0"`, e sem isto a flag `modelosPlanos` nunca casa.
 */
export function textoDeCelula(c: Celula): string {
  if (c.tipo === 'n') return aparar(expandirCientifica(c.bruto.trim()))
  return c.bruto.replace(/\s+/g, ' ').trim()
}

/**
 * Só os dígitos — a conversão do **telefone**.
 *
 * A notação científica é expandida primeiro; depois tudo o que não é dígito
 * cai. É `telefone_chave` da migration 0006 aplicado na origem, para que a
 * deduplicação por telefone compare a mesma coisa nos dois lados.
 */
export function digitosDeCelula(c: Celula): string {
  return textoDeCelula(c).replace(/\D/g, '')
}

/** `SIM`, `TRUE`, `VERDADEIRO`, `1`, `S` — o `sim()` do `Code.gs`. */
export function booleanoDeCelula(c: Celula, padrao: boolean): boolean {
  const t = textoDeCelula(c).toUpperCase()
  if (t === '') return padrao
  return ['SIM', 'TRUE', 'VERDADEIRO', '1', 'S'].includes(t)
}

/**
 * **DINHEIRO — a conversão que a migração não pode errar.**
 *
 * Três caminhos, e nenhum deles cria um `number`:
 *
 *  - vazio → `R$ 0,00`;
 *  - célula de TEXTO → `Dinheiro.deTexto`, que já aceita `450`, `450,00`,
 *    `1.250,50`, `1250.50` e `R$ 1.250,50` — exatamente o `lerValor` do
 *    `app-v20.js`, e ele já está testado;
 *  - célula NUMÉRICA → o literal decimal, dígito a dígito.
 *
 * Valor **negativo é erro**, nunca zero em silêncio. O `numero()` do `Code.gs`
 * devolve `''` para negativo, ou seja a v20 também o recusa; e
 * `recebimento_valor_nao_negativo` (migration 0011) o recusaria no destino de
 * todo modo — mas recusar aqui é o que faz a linha aparecer no relatório com o
 * número da linha, em vez de morrer num `INSERT` no meio da clínica.
 */
export function dinheiroDeCelula(c: Celula): Result<Convertido<Dinheiro>> {
  const literal = textoDeCelula(c)
  if (literal === '') return ok(semArredondar(Dinheiro.zero()))

  if (c.tipo !== 'n') {
    const r = Dinheiro.deTexto(literal)
    if (ehErro(r)) return r
    if (r.valor.ehNegativo()) {
      return erro(erroDe('ValorNegativo', `valor negativo na planilha: ${literal}`))
    }
    return ok(semArredondar(r.valor))
  }

  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(literal)
  if (m === null) {
    return erro(erroDe('ValorInvalido', `"${c.bruto}" não é um valor em reais.`))
  }
  const [, sinal = '', inteiros = '0', decimais = ''] = m
  if (sinal === '-') {
    return erro(erroDe('ValorNegativo', `valor negativo na planilha: ${literal}`))
  }

  const centavosExatos = BigInt(inteiros) * 100n + BigInt(decimais.slice(0, 2).padEnd(2, '0'))
  if (decimais.length <= 2) return ok(semArredondar(Dinheiro.deCentavos(centavosExatos)))

  // Regra (2) do arredondamento declarado: meio para cima, em módulo.
  const terceira = Number(decimais[2])
  const centavos = terceira >= 5 ? centavosExatos + 1n : centavosExatos
  return ok({ valor: Dinheiro.deCentavos(centavos), arredondou: true })
}

/**
 * Inteiro de contagem (sessões, intervalo, antecedência, meta de campanha).
 *
 * `"7.0"` → `7`; `"7"` → `7`; vazio → `padrao`. Fração **é erro**: "meia
 * sessão" não existe, e o `Number(o.sessoes) || 0` do `Code.gs` a truncaria
 * em silêncio.
 */
export function inteiroDeCelula(c: Celula, padrao: number): Result<number> {
  const t = textoDeCelula(c)
  if (t === '') return ok(padrao)
  if (!/^-?\d+$/.test(t)) {
    return erro(erroDe('InteiroInvalido', `"${c.bruto}" não é um número inteiro.`))
  }
  return ok(Number(t))
}

const EPOCA_SERIAL = Date.UTC(1899, 11, 30)
const dois = (n: number) => String(n).padStart(2, '0')

/**
 * O dia civil `yyyy-MM-dd` — **três formas na mesma coluna**.
 *
 *  - `2026-01-05` e `2026-01-05T09:30` e `2026-01-05 09:30` → o prefixo;
 *  - serial do Excel (`45678`, `45678.5416666667`) → dias desde 1899-12-30,
 *    com a parte fracionária **descartada** (é hora, não dia);
 *  - vazio → `null`.
 *
 * Por que 1899-12-30 e não 1900-01-01: o sistema de datas de 1900 do Excel
 * trata 1900 como bissexto, que não foi. O deslocamento de dois dias é a
 * convenção universal para compensar, e é o que toda planilha real usa.
 *
 * `d` (data ISO nativa do OOXML) chega como texto e cai no primeiro caminho.
 */
export function diaDeCelula(c: Celula): Result<string | null> {
  const t = textoDeCelula(c)
  if (t === '') return ok(null)

  if (c.tipo === 'n') {
    if (!/^\d+(\.\d+)?$/.test(t)) {
      return erro(erroDe('DataInvalida', `"${c.bruto}" não é uma data.`))
    }
    const dias = Math.floor(Number(t.split('.')[0]))
    const d = new Date(EPOCA_SERIAL + dias * 86_400_000)
    return ok(`${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`)
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (m === null) return erro(erroDe('DataInvalida', `"${c.bruto}" não é uma data ISO.`))
  const [, a = '', mes = '', dia = ''] = m
  const n = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(dia)))
  if (n.getUTCMonth() + 1 !== Number(mes) || n.getUTCDate() !== Number(dia)) {
    return erro(erroDe('DataInvalida', `"${c.bruto}" não é um dia do calendário.`))
  }
  return ok(`${a}-${mes}-${dia}`)
}

/**
 * O **relógio de parede** da célula: `{ dia, hora }`, sem fuso nenhum.
 *
 * A v20 grava `Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm")`,
 * então o que está no arquivo é a hora **no fuso da clínica** — e é por isso
 * que esta função **não** devolve um `Date`: ela não tem como saber o fuso, e
 * um `Date` montado aqui seria UTC por acidente, deslocando o histórico
 * inteiro de três horas (regra 22). Quem converte para instante é
 * `instanteLocal(dia, hora, fuso)`, com o fuso da clínica na mão.
 *
 * O serial fracionário é arredondado **ao minuto**, e isto é declarado: a
 * fração é um binário aproximado de `H/24 + M/1440`, então `45678.5416666667`
 * é `13:00` com erro de milissegundos. Arredondar ao segundo deixaria
 * `12:59:59` no banco e `13:00` na planilha, e a conferência de uma tarefa
 * concluída no primeiro minuto de um dia mudaria de dia.
 */
export function relogioDeParedeDeCelula(c: Celula): Result<{ dia: string; hora: string } | null> {
  const t = textoDeCelula(c)
  if (t === '') return ok(null)

  if (c.tipo === 'n') {
    if (!/^\d+(\.\d+)?$/.test(t)) {
      return erro(erroDe('InstanteInvalido', `"${c.bruto}" não é uma data-hora.`))
    }
    const minutosTotais = Math.round(Number(t) * 1440)
    const dias = Math.floor(minutosTotais / 1440)
    const resto = minutosTotais - dias * 1440
    const d = new Date(EPOCA_SERIAL + dias * 86_400_000)
    return ok({
      dia: `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`,
      hora: `${dois(Math.floor(resto / 60))}:${dois(resto % 60)}`,
    })
  }

  // `T` **ou espaço** entre o dia e a hora: as duas formas estão nas três
  // planilhas reais, na mesma coluna.
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(t)
  if (m === null) return erro(erroDe('InstanteInvalido', `"${c.bruto}" não é uma data-hora ISO.`))
  const [, dia = '', hh, mm] = m
  const r = diaDeCelula({ bruto: dia, tipo: 's' })
  if (ehErro(r)) return r
  if (hh === undefined || mm === undefined) return ok({ dia, hora: '00:00' })
  if (Number(hh) > 23 || Number(mm) > 59) {
    return erro(erroDe('InstanteInvalido', `"${c.bruto}" tem hora fora do relógio.`))
  }
  return ok({ dia, hora: `${hh}:${mm}` })
}

/** `HH:mm` da coluna `hora` da tarefa, que às vezes vem como data-hora. */
export function horaDeCelula(c: Celula): Result<string | null> {
  const t = textoDeCelula(c)
  if (t === '') return ok(null)
  if (/^\d{2}:\d{2}$/.test(t)) {
    if (Number(t.slice(0, 2)) > 23 || Number(t.slice(3)) > 59) {
      return erro(erroDe('HoraInvalida', `"${c.bruto}" tem hora fora do relógio.`))
    }
    return ok(t)
  }
  const r = relogioDeParedeDeCelula(c)
  if (ehErro(r)) return erro(erroDe('HoraInvalida', `"${c.bruto}" não é uma hora.`))
  return ok(r.valor === null ? null : r.valor.hora)
}
