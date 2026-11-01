import { erro, erroDe, ok, type Result } from '@fir/domain'
import { Injectable } from '@nestjs/common'
import { filhosDiretos, lerXml, primeiro, textoDe, todos, XmlInvalido } from './xml'

/**
 * **O seam `LeitorDeNota`** (CLAUDE.md §5) — do XML da NF-e para linhas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ELE NÃO TOCA O BANCO, E É POR ISSO QUE ELE É UM SEAM
 *
 * O que entra é texto; o que sai são linhas com quantidade inteira em
 * milésimos e dinheiro inteiro em centavos. Nenhuma consulta, nenhum id de
 * item: o CASAMENTO com o catálogo é de quem tem o catálogo
 * (`notas.service.ts`), e a leitura do XML é testável com um arquivo e nada
 * mais.
 *
 * O protótipo lê o XML no NAVEGADOR, com `DOMParser`. Aqui é no servidor por
 * duas razões, e as duas são regras: o casamento depende de dado do servidor
 * (os vínculos salvos), e o custo unitário é **dinheiro** — lido no navegador,
 * ele chegaria inteiro a quem não tem `valores` (regra 17).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NENHUM PONTO FLUTUANTE, EM NENHUM PASSO
 *
 * `qCom` vem como `"3.0000"` e `vUnCom` como `"1520.00"`. O protótipo faz
 * `Number(...)` nos dois e depois `Math.round(x * 100) / 100` — a assinatura
 * que o CLAUDE.md proíbe. Aqui os dois são lidos **do texto dos dígitos**,
 * direto para inteiro: milésimos para quantidade (regra 8) e centavos para
 * dinheiro (regra 1).
 * ────────────────────────────────────────────────────────────────────────────
 */

export type LinhaLidaDaNota = {
  /** `cProd` — o código do produto no fornecedor. */
  readonly codigo: string
  /** `xProd` — a descrição como o fornecedor a escreve. */
  readonly descricao: string
  /** `uCom` — a unidade da nota: CX, UN, FR. */
  readonly unidadeDaNota: string
  /** `qCom` (ou `qLote` na linha de rastro), em MILÉSIMOS. */
  readonly quantidade: bigint
  /** `vUnCom` em CENTAVOS, por unidade da NOTA. */
  readonly valorUnitario: bigint
  /** `nLote` — o lote do fabricante, texto. Informativo. */
  readonly loteDoFabricante: string
  /** `dVal` — a validade, que é o LOTE do nosso modelo. */
  readonly validade: string | null
}

export type NotaLidaDoXml = {
  /** A chave de acesso: 44 dígitos, do atributo `Id` de `infNFe`. */
  readonly chave: string | null
  readonly numero: string
  readonly fornecedor: string
  readonly cnpj: string
  /** `dhEmi`/`dEmi`, só o dia. */
  readonly dia: string | null
  readonly linhas: readonly LinhaLidaDaNota[]
}

export abstract class LeitorDeNota {
  abstract ler(xml: string): Result<NotaLidaDoXml>
}

/**
 * `"3.0000"` → `3000n`. **Milésimos, do texto, sem float** (regra 8).
 *
 * A NF-e declara `qCom` com quatro casas. As três primeiras cabem em
 * milésimos; a quarta, quando é **zero**, não é informação. Quando ela é
 * diferente de zero, isto é **erro** e não arredondamento: uma nota que
 * entrega 0,0001 caixa de alguma coisa precisa de alguém olhando, não de um
 * `Math.round` que faz a quantidade virar outra (regra 8, e o legado está
 * cheio de `Math.round(x * 1000) / 1000`).
 */
export function milesimosDeTexto(bruto: string): bigint | null {
  const s = bruto.trim().replace(',', '.')
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s)
  if (m === null) return null
  const decimais = m[2] ?? ''
  if (decimais.length > 3 && /[1-9]/.test(decimais.slice(3))) return null
  return BigInt(m[1]!) * 1_000n + BigInt(decimais.slice(0, 3).padEnd(3, '0') || '0')
}

/**
 * `"1520.00"` → `152000n`. **Centavos, do texto, sem float** (regra 1).
 *
 * A NF-e permite até dez casas em `vUnCom`, e o preço unitário de um item que
 * vem em caixa de mil frequentemente usa quatro. A terceira casa em diante é
 * **arredondada para o mais próximo**, com aritmética inteira — e isto é
 * deliberado: `custo` é **preço de referência** do item (alimenta a curva ABC
 * e o "valor em estoque"), não dinheiro que se moveu. Nenhum recebimento,
 * nenhum pagamento e nenhuma conferência de caixa passa por aqui.
 */
export function centavosDeTexto(bruto: string): bigint | null {
  const s = bruto.trim().replace(',', '.')
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s)
  if (m === null) return null
  const decimais = (m[2] ?? '').padEnd(3, '0')
  const centavos = BigInt(m[1]!) * 100n + BigInt(decimais.slice(0, 2))
  // Arredondamento para o mais próximo, por comparação de dígito — nunca
  // `Math.round` sobre um float.
  return Number(decimais[2]) >= 5 ? centavos + 1n : centavos
}

const soDigitos = (s: string) => s.replace(/\D/g, '')

const dia = (bruto: string): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(bruto.trim())
  return m === null ? null : m[1]!
}

@Injectable()
export class LeitorDeNotaXml extends LeitorDeNota {
  ler(xml: string): Result<NotaLidaDoXml> {
    let raiz
    try {
      raiz = lerXml(xml)
    } catch (e) {
      return erro(
        erroDe(
          'NotaIlegivel',
          e instanceof XmlInvalido
            ? `O arquivo não é um XML válido. ${e.message}`
            : 'O arquivo não é um XML válido.',
        ),
      )
    }

    const inf = primeiro(raiz, 'infNFe')
    if (inf === null) {
      return erro(
        erroDe(
          'NotaIlegivel',
          'Não parece um XML de NF-e (nota fiscal eletrônica). ' +
            'O arquivo que o fornecedor envia tem um elemento <infNFe>.',
        ),
      )
    }

    const ide = primeiro(inf, 'ide')
    const emit = primeiro(inf, 'emit')
    const chaveBruta = soDigitos(inf.atributos['Id'] ?? inf.atributos['id'] ?? '')

    const linhas: LinhaLidaDaNota[] = []
    const problemas: string[] = []

    for (const det of filhosDiretos(inf, 'det')) {
      const prod = primeiro(det, 'prod')
      if (prod === null) continue

      const descricao = textoDe(prod, 'xProd')
      const quantidade = milesimosDeTexto(textoDe(prod, 'qCom'))
      const valor = centavosDeTexto(textoDe(prod, 'vUnCom') || '0')
      if (quantidade === null || valor === null) {
        problemas.push(descricao || textoDe(prod, 'cProd'))
        continue
      }
      const base = {
        codigo: textoDe(prod, 'cProd'),
        descricao,
        unidadeDaNota: textoDe(prod, 'uCom'),
        valorUnitario: valor,
      }

      // `rastro` é o bloco de rastreabilidade de MEDICAMENTO: uma entrada por
      // LOTE, cada uma com sua quantidade e validade. É exatamente a forma do
      // nosso modelo (lote = validade), e ignorá-lo faria três lotes virarem
      // uma entrada só — e aí o FIFO de validade passaria a apontar para o
      // lote errado.
      const rastros = todos(prod, 'rastro')
      if (rastros.length === 0) {
        linhas.push({
          ...base,
          quantidade,
          loteDoFabricante: '',
          validade: dia(textoDe(prod, 'dVal')),
        })
        continue
      }
      for (const r of rastros) {
        const doLote = milesimosDeTexto(textoDe(r, 'qLote'))
        linhas.push({
          ...base,
          quantidade: doLote ?? quantidade,
          loteDoFabricante: textoDe(r, 'nLote'),
          validade: dia(textoDe(r, 'dVal')),
        })
      }
    }

    if (problemas.length > 0) {
      return erro(
        erroDe(
          'NotaIlegivel',
          `A quantidade ou o valor de "${problemas[0]!}" não está num formato que eu leia. ` +
            'Confira o XML com o fornecedor.',
        ),
      )
    }
    if (linhas.length === 0) {
      return erro(erroDe('NotaIlegivel', 'Nenhum produto encontrado na nota.'))
    }

    return ok({
      chave: chaveBruta.length === 44 ? chaveBruta : null,
      numero: textoDe(ide, 'nNF').slice(0, 20),
      // `xFant` é o nome fantasia e é como a clínica chama o fornecedor;
      // `xNome` é a razão social. O protótipo prefere o fantasia, e está certo:
      // quem recebe a caixa reconhece "Saúde Nordeste", não "Distribuidora
      // Saúde Nordeste Comércio de Medicamentos Ltda".
      fornecedor: (textoDe(emit, 'xFant') || textoDe(emit, 'xNome')).slice(0, 80),
      cnpj: soDigitos(textoDe(emit, 'CNPJ')).slice(0, 14),
      dia: dia(textoDe(ide, 'dhEmi') || textoDe(ide, 'dEmi')),
      linhas,
    })
  }
}
