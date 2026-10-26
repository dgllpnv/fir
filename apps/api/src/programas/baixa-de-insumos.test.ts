import { Quantidade, ehOk, ok, type Result } from '@fir/domain'
import { describe, expect, it } from 'vitest'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'
import {
  BaixaDeInsumos,
  BaixaInerte,
  type MotivoDeDesfazer,
  type PedidoDeBaixa,
} from './baixa-de-insumos'

/**
 * **O INVARIANTE QUE O ÉPICO 6 HERDA, escrito como teste antes de o estoque
 * existir.**
 *
 * O seam `BaixaDeInsumos` nasce inerte. O que NÃO nasce inerte é a definição
 * do que "desfazer" significa — e ela é escrita aqui, agora, por três razões:
 *
 *  1. O épico 5 é quem **chama** `baixar` e `desfazer` (concluir e reabrir
 *     sessão, excluir programa). Quem chama é quem sabe o que espera de volta.
 *  2. O invariante tem uma metade que **toda implementação ingênua esquece**:
 *     o item que não aproveita sobra gera **dois** movimentos na baixa
 *     (consumo + descarte "Sobra de frasco aberto", regra 15), e desfazer
 *     precisa compensar **os dois**. O segundo não está no que a sessão
 *     pediu; ele está no que o frasco perdeu.
 *  3. Um invariante que mora só em comentário é um invariante que o épico 6
 *     vai reinterpretar.
 *
 * **COMO O ÉPICO 6 USA ESTE ARQUIVO:** `BaixaEmMemoria` é a implementação de
 * REFERÊNCIA — append-only, com lote, com a compensação apontando para a
 * origem. Copie as asserções deste `describe` para `estoque/baixa.test.ts`
 * trocando `new BaixaEmMemoria(CADASTRO)` pela implementação relacional e
 * `saldoPorLote()` por uma leitura do banco. Se alguma delas ficar vermelha, a
 * implementação relacional está errada — não o teste.
 *
 * O que este arquivo **não** prova: que o banco recusa um `DELETE`. Isso é do
 * épico 6, com o trigger de append-only da 0004 e Testcontainers. Aqui prova-se
 * a ARITMÉTICA da compensação, que é onde o centavo de dose se perde.
 */

/* ======================================================================
 * A implementação de REFERÊNCIA — em memória, append-only, com lote.
 * ====================================================================== */

type Movimento = {
  readonly id: number
  readonly tarefaId: string
  readonly itemId: string
  readonly lote: string
  /** Milésimos. Negativo sai do estoque, positivo volta. */
  readonly milesimos: bigint
  readonly tipo: 'consumo' | 'descarte' | 'compensacao'
  readonly motivo: MotivoDeDesfazer | null
  /** O movimento que esta linha reverte. Nulo nas baixas. */
  readonly compensa: number | null
}

/**
 * O item que **não aproveita sobra**: abrir o frasco de 5 mg para aplicar
 * 2,5 mg descarta os outros 2,5 mg. É a regra 15, e é o caso em que a baixa
 * gera DOIS movimentos.
 *
 * O cadastro de verdade é do épico 6; aqui a propriedade é declarada por
 * item de teste, que é o mínimo para a aritmética ser exercitada.
 */
type CadastroDeItem = {
  /** Milésimos da unidade indivisível — o frasco inteiro. */
  readonly unidade: bigint
  readonly aproveitaSobra: boolean
  readonly lote: string
}

class BaixaEmMemoria extends BaixaDeInsumos {
  private seq = 0
  readonly movimentos: Movimento[] = []

  constructor(private readonly cadastro: ReadonlyMap<string, CadastroDeItem>) {
    super()
  }

  async baixar(_tx: Transacao, p: PedidoDeBaixa): Promise<Result<void>> {
    for (const insumo of p.insumos) {
      const item = this.cadastro.get(insumo.itemId)
      if (item === undefined) continue
      const pedida = insumo.quantidade.milesimos
      this.gravar(p.tarefaId, insumo.itemId, item.lote, -pedida, 'consumo', null)

      // A SOBRA, e ela é um movimento SEPARADO.
      //
      // `ceil(pedida / unidade) * unidade − pedida`: o frasco inteiro sai da
      // prateleira, a dose vai na paciente, o resto é perda explicada. Somar
      // os dois num movimento só apagaria a distinção entre "aplicado" e
      // "jogado fora", que é justamente o que a análise do estoque mede.
      if (insumo.principal && !item.aproveitaSobra && pedida % item.unidade !== 0n) {
        const inteiras = pedida / item.unidade + 1n
        const sobra = inteiras * item.unidade - pedida
        this.gravar(p.tarefaId, insumo.itemId, item.lote, -sobra, 'descarte', null)
      }
    }
    return ok(undefined)
  }

  async desfazer(
    _tx: Transacao,
    _clinicaId: ClinicaId,
    tarefaId: string,
    motivo: MotivoDeDesfazer,
  ): Promise<Result<void>> {
    /**
     * **IDEMPOTENTE POR CONSTRUÇÃO: a compensação aponta para a ORIGEM.**
     *
     * `compensa` guarda o id do movimento revertido, e não só o `tarefaId`.
     * Sem esse apontador, reabrir duas vezes devolveria a dose duas vezes — e
     * o estoque cresceria por causa de um toque repetido no balcão. Casar por
     * (item, lote, quantidade) em vez de por id parece equivalente e não é:
     * duas sessões da mesma paciente com a mesma dose e o mesmo lote são
     * indistinguíveis por valor.
     *
     * É o detalhe que o épico 6 precisa gravar no esquema — uma coluna
     * `compensa uuid REFERENCES movimentos(id)` —, não resolver em código.
     */
    const jaCompensados = new Set(
      this.movimentos.filter((m) => m.compensa !== null).map((m) => m.compensa),
    )
    for (const o of this.movimentos.filter(
      (m) => m.tarefaId === tarefaId && m.compensa === null,
    )) {
      if (jaCompensados.has(o.id)) continue
      // MESMO LOTE, quantidade oposta, ligado pelo `tarefaId` e à origem.
      this.gravar(tarefaId, o.itemId, o.lote, -o.milesimos, 'compensacao', motivo, o.id)
      jaCompensados.add(o.id)
    }
    return ok(undefined)
  }

  private gravar(
    tarefaId: string,
    itemId: string,
    lote: string,
    milesimos: bigint,
    tipo: Movimento['tipo'],
    motivo: MotivoDeDesfazer | null,
    compensa: number | null = null,
  ): void {
    this.movimentos.push({ id: ++this.seq, tarefaId, itemId, lote, milesimos, tipo, motivo, compensa })
  }

  /** O saldo DERIVADO dos movimentos, por (item, lote). Nunca um campo (regra 11). */
  saldoPorLote(): ReadonlyMap<string, bigint> {
    const fora = new Map<string, bigint>()
    for (const m of this.movimentos) {
      const k = `${m.itemId}#${m.lote}`
      fora.set(k, (fora.get(k) ?? 0n) + m.milesimos)
    }
    return fora
  }
}

/* ======================================================================
 * AS INVARIANTES — reutilizáveis pelo épico 6.
 * ====================================================================== */

const TX = {} as Transacao
const CLINICA = 'c1' as unknown as ClinicaId

const pedido = (
  tarefaId: string,
  insumos: PedidoDeBaixa['insumos'],
): PedidoDeBaixa => ({
  clinicaId: CLINICA,
  tarefaId,
  pacienteId: 'p1',
  procedimentoId: 'proc1',
  programaId: 'prog1',
  itemChave: 'i1',
  aplicadoPorId: 'u1' as never,
  em: '2026-11-02',
  insumos,
})

const FRASCO = 'tirze-ampola'
const SERINGA = 'seringa'

/** Frasco de 5 mg que NÃO aproveita sobra; seringa que não tem sobra. */
const CADASTRO = new Map<string, CadastroDeItem>([
  [FRASCO, { unidade: 5_000n, aproveitaSobra: false, lote: 'L-2027-03' }],
  [SERINGA, { unidade: 1_000n, aproveitaSobra: true, lote: 'L-UNICO' }],
])

const DOSE = Quantidade.deMilesimos(2500n, 'mg')
const UMA = Quantidade.deMilesimos(1000n, 'un')

describe('o seam BaixaDeInsumos — o invariante que o épico 6 herda', () => {
  it('a baixa de item que NÃO aproveita sobra gera DOIS movimentos', async () => {
    const b = new BaixaEmMemoria(CADASTRO)
    expect(ehOk(await b.baixar(TX, pedido('s1', [
      { itemId: FRASCO, quantidade: DOSE, principal: true },
      { itemId: SERINGA, quantidade: UMA, principal: false },
    ])))).toBe(true)

    const doFrasco = b.movimentos.filter((m) => m.itemId === FRASCO)
    expect(doFrasco.map((m) => m.tipo)).toEqual(['consumo', 'descarte'])
    // 2,5 mg na paciente + 2,5 mg de sobra = o FRASCO INTEIRO saiu da
    // prateleira. Nunca um arredondamento (regra 15).
    expect(doFrasco.reduce((s, m) => s + m.milesimos, 0n)).toBe(-5_000n)
    // E a seringa gera UM: descartável não tem sobra de frasco aberto.
    expect(b.movimentos.filter((m) => m.itemId === SERINGA)).toHaveLength(1)
  })

  it('DESFAZER COMPENSA OS DOIS — é o descarte que a implementação ingênua esquece', async () => {
    const b = new BaixaEmMemoria(CADASTRO)
    await b.baixar(TX, pedido('s1', [{ itemId: FRASCO, quantidade: DOSE, principal: true }]))
    await b.desfazer(TX, CLINICA, 's1', 'sessao-reaberta')

    // O saldo volta a ZERO. Compensar só o consumo deixaria −2.500 para sempre
    // — meio frasco desaparecido do estoque, sem nenhum erro na tela.
    expect([...b.saldoPorLote().values()]).toEqual([0n])
    expect(b.movimentos.filter((m) => m.tipo === 'compensacao')).toHaveLength(2)
    // E compensação, nunca DELETE: os movimentos de origem continuam lá.
    expect(b.movimentos.filter((m) => m.tipo !== 'compensacao')).toHaveLength(2)
  })

  it('desfazer usa o MESMO LOTE — saldo certo com lote errado é a dose do frasco vencido', async () => {
    const b = new BaixaEmMemoria(CADASTRO)
    await b.baixar(TX, pedido('s1', [{ itemId: FRASCO, quantidade: DOSE, principal: true }]))
    await b.desfazer(TX, CLINICA, 's1', 'sessao-reaberta')
    expect(new Set(b.movimentos.map((m) => m.lote))).toEqual(new Set(['L-2027-03']))
  })

  it('a compensação fica LIGADA pelo `tarefaId`, e carrega o motivo', async () => {
    const b = new BaixaEmMemoria(CADASTRO)
    await b.baixar(TX, pedido('s1', [{ itemId: FRASCO, quantidade: DOSE, principal: true }]))
    await b.desfazer(TX, CLINICA, 's1', 'programa-excluido')
    for (const m of b.movimentos.filter((x) => x.tipo === 'compensacao')) {
      expect(m.tarefaId).toBe('s1')
      expect(m.motivo).toBe('programa-excluido')
    }
  })

  it('DESFAZER É IDEMPOTENTE: reabrir duas vezes não devolve a dose duas vezes', async () => {
    const b = new BaixaEmMemoria(CADASTRO)
    await b.baixar(TX, pedido('s1', [{ itemId: FRASCO, quantidade: DOSE, principal: true }]))
    await b.desfazer(TX, CLINICA, 's1', 'sessao-reaberta')
    await b.desfazer(TX, CLINICA, 's1', 'sessao-reaberta')
    expect([...b.saldoPorLote().values()]).toEqual([0n])
  })

  it('desfazer de UMA sessão não toca na outra', async () => {
    const b = new BaixaEmMemoria(CADASTRO)
    await b.baixar(TX, pedido('s1', [{ itemId: FRASCO, quantidade: DOSE, principal: true }]))
    await b.baixar(TX, pedido('s2', [{ itemId: FRASCO, quantidade: DOSE, principal: true }]))
    await b.desfazer(TX, CLINICA, 's1', 'sessao-reaberta')
    // Uma sessão voltou, a outra não: −5.000 de uma aplicação só.
    expect([...b.saldoPorLote().values()]).toEqual([-5_000n])
  })

  /**
   * A IDA-E-VOLTA, com as doses **CONSTRUÍDAS** em vez de sorteadas.
   *
   * A lição dos épicos 4 e 5: gerador uniforme não acha fronteira. Aqui o
   * espaço que importa é pequeno e conhecido, então a varredura é **exaustiva
   * em cima dele**: as fronteiras (`1`, `unidade − 1`, `unidade`,
   * `unidade + 1`) e um múltiplo exato, cada uma com 1 a 4 voltas.
   *
   * O caso que morde é o **não-múltiplo**: é só nele que o descarte existe, e
   * é só nele que esquecer de compensá-lo aparece. Um sorteio uniforme em
   * `[1, 100000]` acerta não-múltiplos quase sempre — e por isso não distingue
   * a fronteira `unidade` exata, onde o descarte **não** deve nascer, de um
   * código que o cria com quantidade zero.
   *
   * `fast-check` não é dependência de `apps/api` (ele é do domínio puro), e
   * acrescentá-lo para varrer cinco valores conhecidos seria cerimônia.
   */
  it('IDA-E-VOLTA: concluir → reabrir, 1 a 4 vezes, devolve saldo E lote ao zero', async () => {
    const UNIDADE = 5_000n
    const doses = [1n, UNIDADE - 1n, UNIDADE, UNIDADE + 1n, UNIDADE * 3n, UNIDADE * 3n + 2_500n]
    for (const milesimos of doses) {
      for (let voltas = 1; voltas <= 4; voltas++) {
        const b = new BaixaEmMemoria(CADASTRO)
        const q = Quantidade.deMilesimos(milesimos, 'mg')
        for (let i = 0; i < voltas; i++) {
          await b.baixar(TX, pedido('s1', [{ itemId: FRASCO, quantidade: q, principal: true }]))
          await b.desfazer(TX, CLINICA, 's1', 'sessao-reaberta')
        }
        for (const [lote, saldo] of b.saldoPorLote()) {
          // Nada de ponto flutuante em ponto nenhum: `bigint` de milésimos.
          expect(saldo, `dose ${milesimos}, ${voltas} voltas, lote ${lote}`).toBe(0n)
        }
      }
    }
  })

  it('na dose EXATAMENTE igual à unidade, não nasce descarte de zero', async () => {
    // A fronteira que o sorteio uniforme não distingue: `pedida % unidade === 0`
    // tem de gerar UM movimento, não dois com o segundo valendo zero. Um
    // descarte de zero é uma linha de perda que a análise do estoque tem de
    // explicar e que nunca aconteceu.
    const b = new BaixaEmMemoria(CADASTRO)
    const q = Quantidade.deMilesimos(5000n, 'mg')
    await b.baixar(TX, pedido('s1', [{ itemId: FRASCO, quantidade: q, principal: true }]))
    expect(b.movimentos.map((m) => m.tipo)).toEqual(['consumo'])
  })
})

describe('BaixaInerte — a clínica sem estoque usa programas', () => {
  it('as duas devolvem ok, e não falham', async () => {
    // Inerte e NÃO um `throw`: uma recusa aqui transformaria "o estoque não
    // entrou ainda" em "a enfermagem não consegue registrar a aplicação".
    const b = new BaixaInerte()
    expect(ehOk(await b.baixar())).toBe(true)
    expect(ehOk(await b.desfazer())).toBe(true)
  })
})
