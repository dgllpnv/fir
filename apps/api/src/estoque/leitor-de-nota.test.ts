import { ehErro, exigir } from '@fir/domain'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  LeitorDeNotaXml,
  MAX_ITENS_NA_NOTA,
  centavosDeTexto,
  milesimosDeTexto,
} from './leitor-de-nota'
import { lerAtributos, lerXml, primeiro, textoDe } from './xml'

/**
 * O seam `LeitorDeNota`, com um arquivo e nada mais.
 *
 * O que só este arquivo mede:
 *
 *  1. **Nenhum ponto flutuante atravessa.** `qCom: "3.0000"` vira `3000n` e
 *     `vUnCom: "1520.00"` vira `152000n`, lidos **do texto dos dígitos**. O
 *     protótipo faz `Number(...)` nos dois e depois
 *     `Math.round(x * 100) / 100` — a assinatura que o CLAUDE.md proíbe.
 *  2. **O bloco `rastro` vira UMA LINHA POR LOTE.** Ignorá-lo faria três lotes
 *     virarem uma entrada só, e o FIFO de validade passaria a apontar para o
 *     lote errado — a dose do frasco vencido na próxima paciente.
 *  3. **XXE não existe aqui**: o `DOCTYPE` é ignorado por inteiro, nunca
 *     processado. O arquivo chega de um fornecedor, por e-mail, e é carregado
 *     por quem está no balcão: é entrada externa não confiável.
 */

const leitor = new LeitorDeNotaXml()

/** A nota de exemplo do protótipo, com os quatro produtos que ela tem. */
const NOTA = `<?xml version="1.0" encoding="UTF-8"?><nfeProc><NFe>
<infNFe Id="NFe29261012345678000190550010000123451000123456">
<ide><nNF>12345</nNF><dhEmi>2026-10-20T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>12345678000190</CNPJ><xNome>Distribuidora Saúde Nordeste Ltda</xNome><xFant>Saúde Nordeste</xFant></emit>
<det nItem="1"><prod><cProd>MJ5-01</cProd><xProd>TIRZEPATIDA 5MG/0,5ML SOL INJ AMP</xProd><uCom>CX</uCom><qCom>3.0000</qCom><vUnCom>1520.00</vUnCom>
  <rastro><nLote>L2611A</nLote><qLote>2</qLote><dVal>2027-06-30</dVal></rastro>
  <rastro><nLote>L2603C</nLote><qLote>1</qLote><dVal>2027-01-31</dVal></rastro></prod></det>
<det nItem="2"><prod><cProd>VITD-600</cProd><xProd>COLECALCIFEROL 600.000UI AMPOLA (VITAMINA D)</xProd><uCom>UN</uCom><qCom>50.0000</qCom><vUnCom>17.50</vUnCom>
  <rastro><nLote>VD9921</nLote><qLote>50</qLote><dVal>2027-08-31</dVal></rastro></prod></det>
<det nItem="3"><prod><cProd>SER5ML</cProd><xProd>SERINGA DESCARTAVEL 5ML S/AGULHA</xProd><uCom>CX</uCom><qCom>2.0000</qCom><vUnCom>52.00</vUnCom></prod></det>
<det nItem="4"><prod><cProd>FRETE</cProd><xProd>TAXA DE ENTREGA</xProd><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>25.00</vUnCom></prod></det>
</infNFe></NFe></nfeProc>`

describe('milesimosDeTexto — milésimos do TEXTO, sem float (regra 8)', () => {
  it('lê inteiro, decimal e as quatro casas da NF-e', () => {
    expect(milesimosDeTexto('3')).toBe(3_000n)
    expect(milesimosDeTexto('3.0000')).toBe(3_000n)
    expect(milesimosDeTexto('0.5')).toBe(500n)
    expect(milesimosDeTexto('2,5')).toBe(2_500n)
    expect(milesimosDeTexto('0.001')).toBe(1n)
  })

  it('a QUARTA casa diferente de zero é ERRO, não arredondamento', () => {
    // Uma nota que entrega 0,0001 caixa de alguma coisa precisa de alguém
    // olhando. `Math.round` faria a quantidade virar outra, em silêncio — e é
    // exatamente o que o legado faz.
    expect(milesimosDeTexto('3.0001')).toBeNull()
    // E a quarta casa ZERO não é informação: ela passa.
    expect(milesimosDeTexto('3.1200')).toBe(3_120n)
  })

  it('texto que não é número é `null`, nunca zero', () => {
    // `Number('abc') || 0` daria zero, e a linha entraria no estoque com
    // quantidade zero em vez de acusar o arquivo.
    expect(milesimosDeTexto('abc')).toBeNull()
    expect(milesimosDeTexto('')).toBeNull()
    expect(milesimosDeTexto('-1')).toBeNull()
  })

  it('PROPRIEDADE: ida e volta pelo texto preserva o inteiro exatamente', () => {
    fc.assert(
      fc.property(
        // A fronteira construída: zero, um milésimo, a medida inteira, e os
        // múltiplos exatos. Um gerador uniforme de 1..10^6 quase nunca produz
        // um valor cuja representação decimal termina em zero, que é o caso
        // em que o `padEnd`/`slice` pode errar.
        fc.oneof(
          fc.constant(0n),
          fc.constant(1n),
          fc.constant(1_000n),
          fc.bigInt({ min: 0n, max: 10n ** 9n }),
        ),
        (m) => {
          const inteiros = m / 1_000n
          const decimais = (m % 1_000n).toString().padStart(3, '0')
          expect(milesimosDeTexto(`${inteiros}.${decimais}`)).toBe(m)
        },
      ),
      { numRuns: 300 },
    )
  })
})

describe('centavosDeTexto — centavos do TEXTO, sem float (regra 1)', () => {
  it('lê o preço da nota em centavos', () => {
    expect(centavosDeTexto('1520.00')).toBe(152_000n)
    expect(centavosDeTexto('17.50')).toBe(1_750n)
    expect(centavosDeTexto('0')).toBe(0n)
    expect(centavosDeTexto('0.07')).toBe(7n)
  })

  it('a terceira casa arredonda para o mais próximo, por DÍGITO', () => {
    // A NF-e permite até dez casas em `vUnCom`. `custo` é preço de REFERÊNCIA
    // do item — alimenta a curva ABC e o "valor em estoque" —, não dinheiro que
    // se moveu: nenhum recebimento, nenhuma conta a pagar e nenhuma
    // conferência de caixa passa por aqui.
    expect(centavosDeTexto('1.005')).toBe(101n)
    expect(centavosDeTexto('1.004')).toBe(100n)
  })
})

describe('LeitorDeNotaXml — o XML da NF-e', () => {
  it('lê cabeçalho, chave de acesso de 44 dígitos e as quatro linhas', () => {
    const n = exigir(leitor.ler(NOTA))
    expect(n.chave).toBe('29261012345678000190550010000123451000123456')
    expect(n.chave).toHaveLength(44)
    expect(n.numero).toBe('12345')
    // `xFant` vence `xNome`: quem recebe a caixa reconhece "Saúde Nordeste".
    expect(n.fornecedor).toBe('Saúde Nordeste')
    expect(n.cnpj).toBe('12345678000190')
    expect(n.dia).toBe('2026-10-20')
    // 5 linhas: o produto 1 tem DOIS rastros, e cada um é uma linha.
    expect(n.linhas).toHaveLength(5)
  })

  it('o bloco `rastro` vira UMA LINHA POR LOTE, com a quantidade do lote', () => {
    const n = exigir(leitor.ler(NOTA))
    const tirzepatida = n.linhas.filter((l) => l.codigo === 'MJ5-01')
    expect(tirzepatida).toHaveLength(2)
    expect(tirzepatida.map((l) => [l.quantidade, l.validade, l.loteDoFabricante])).toEqual([
      [2_000n, '2027-06-30', 'L2611A'],
      [1_000n, '2027-01-31', 'L2603C'],
    ])
    // E a soma dos lotes é a quantidade da linha da nota: 2 + 1 = 3 caixas.
    expect(tirzepatida.reduce((s, l) => s + l.quantidade, 0n)).toBe(3_000n)
  })

  it('produto SEM rastro usa `qCom` e a validade do próprio produto', () => {
    const n = exigir(leitor.ler(NOTA))
    const seringa = n.linhas.find((l) => l.codigo === 'SER5ML')!
    expect(seringa.quantidade).toBe(2_000n)
    expect(seringa.validade).toBeNull()
    expect(seringa.valorUnitario).toBe(5_200n)
  })

  it('arquivo que não é NF-e devolve ERRO com a frase da recepção', () => {
    const r = leitor.ler('<?xml version="1.0"?><qualquer><coisa/></qualquer>')
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) {
      expect(r.erro.codigo).toBe('NotaIlegivel')
      expect(r.erro.mensagem).toContain('infNFe')
    }
  })

  it('XML quebrado devolve ERRO, nunca uma árvore pela metade', () => {
    expect(ehErro(leitor.ler('<infNFe><det>'))).toBe(true)
    expect(ehErro(leitor.ler('não é xml'))).toBe(true)
  })

  it('chave de acesso com menos de 44 dígitos vira `null`', () => {
    // Um "quase" (43 dígitos de um OCR ruim) não é chave de acesso, e não pode
    // virar chave de idempotência: duas notas diferentes colidiriam, ou a
    // mesma nota entraria duas vezes.
    const n = exigir(leitor.ler(NOTA.replace('NFe2926101234567800019055001000012345100012345', 'NFe123')))
    expect(n.chave).toBeNull()
  })
})

describe('lerXml — entrada externa não confiável', () => {
  it('o DOCTYPE é IGNORADO por inteiro — a classe XXE não existe aqui', () => {
    const comEntidade = `<?xml version="1.0"?>
      <!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
      <raiz><campo>&xxe;</campo></raiz>`
    const raiz = lerXml(comEntidade)
    // A entidade NÃO é expandida: o texto fica literal, e nenhum arquivo do
    // disco entra na resposta.
    expect(textoDe(raiz, 'campo')).toBe('&xxe;')
  })

  it('resolve só as cinco entidades predefinidas e as numéricas', () => {
    const raiz = lerXml('<r><a>Sa&#250;de &amp; Cia &lt;Ltda&gt;</a></r>')
    expect(textoDe(raiz, 'a')).toBe('Saúde & Cia <Ltda>')
  })

  it('lê atributo, tag vazia, comentário e CDATA', () => {
    const raiz = lerXml(
      '<r id="x"><!-- nada --><vazia/><c><![CDATA[<cru> & solto]]></c></r>',
    )
    expect(raiz.atributos['id']).toBe('x')
    expect(primeiro(raiz, 'vazia')).not.toBeNull()
    expect(textoDe(raiz, 'c')).toBe('<cru> & solto')
  })

  it('aninhamento sem fim é recusado, não estoura a pilha', () => {
    expect(() => lerXml('<a>'.repeat(200))).toThrow()
  })
})

/**
 * **Achado F4 (revisão de segurança 2026-11-15, CWE-1333).** A leitura de
 * atributos era uma regex não ancorada que retrocedia em tempo quadrático; o
 * `POST /v1/estoque/notas/ler` aceita 900 mil caracteres, e um só pedido
 * travava o event loop da API de todas as clínicas.
 */
describe('lerXml — tempo linear e tetos (achado F4)', () => {
  it('a carga do ataque termina rápido, recusada como XML inválido', () => {
    const ataque = `<infNFe a${'b'.repeat(899_000)}>`
    const t0 = performance.now()
    expect(() => lerXml(ataque)).toThrow(/tag grande demais/)
    expect(performance.now() - t0).toBeLessThan(1_000)
    // E pelo seam, como a rota chama: erro de domínio, não exceção.
    const r = leitor.ler(ataque)
    expect(ehErro(r)).toBe(true)
  })

  it('a leitura de atributos é linear mesmo sem o teto de tag', () => {
    // O teto de tag barra a carga acima; isto mede o leitor DE ATRIBUTOS
    // sozinho, com a sequência sem `=` que fazia a regex retroceder.
    const t0 = performance.now()
    expect(lerAtributos(` a${'b'.repeat(899_000)}`)).toEqual({})
    expect(lerAtributos(` ${'a '.repeat(400_000)}x="1"`)).toEqual({ x: '1' })
    expect(lerAtributos(` a="${'b'.repeat(899_000)}`)).toEqual({})
    expect(performance.now() - t0).toBeLessThan(1_000)
  })

  it('lê atributo como a regex lia: aspas simples, espaços no `=`, lixo pulado', () => {
    expect(lerAtributos(` Id="NFe1" versao = '4.00' xmlns:ds="http://x/y#z"`)).toEqual({
      Id: 'NFe1',
      versao: '4.00',
      'xmlns:ds': 'http://x/y#z',
    })
    expect(lerAtributos(' solto  9x="a&amp;b" sem= y="2"')).toEqual({ x: 'a&b', y: '2' })
  })

  it('uma NF-e real continua lida igual', () => {
    const nfe = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe>
<infNFe Id="NFe35261100000000000191550010000009991000099910" versao="4.00">
<ide><cUF>35</cUF><nNF>999</nNF><serie>1</serie><dhEmi>2026-11-10T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>00000000000191</CNPJ><xNome>Distribuidora Ficticia de Teste LTDA</xNome></emit>
<det nItem="1"><prod><cProd>TESTE-001</cProd><cEAN>SEM GTIN</cEAN><xProd>Soro Fisiologico Teste 500ml</xProd>
<uCom>FR</uCom><qCom>10.0000</qCom><vUnCom>12.5000000000</vUnCom><vProd>125.00</vProd>
<rastro><nLote>LT-TESTE-01</nLote><qLote>10.000</qLote><dFab>2026-09-01</dFab><dVal>2028-09-01</dVal></rastro></prod></det>
<det nItem="2"><prod><cProd>TESTE-002</cProd><xProd>Seringa Descartavel Teste 5ml</xProd>
<uCom>CX</uCom><qCom>4.0000</qCom><vUnCom>30.0000000000</vUnCom></prod></det>
</infNFe></NFe>
<protNFe versao="4.00"><infProt><chNFe>35261100000000000191550010000009991000099910</chNFe></infProt></protNFe>
</nfeProc>`
    const n = exigir(leitor.ler(nfe))
    expect(n.chave).toBe('35261100000000000191550010000009991000099910')
    expect(n.numero).toBe('999')
    expect(n.fornecedor).toBe('Distribuidora Ficticia de Teste LTDA')
    expect(n.dia).toBe('2026-11-10')
    expect(n.linhas).toEqual([
      {
        codigo: 'TESTE-001',
        descricao: 'Soro Fisiologico Teste 500ml',
        unidadeDaNota: 'FR',
        quantidade: 10_000n,
        valorUnitario: 1_250n,
        loteDoFabricante: 'LT-TESTE-01',
        validade: '2028-09-01',
      },
      {
        codigo: 'TESTE-002',
        descricao: 'Seringa Descartavel Teste 5ml',
        unidadeDaNota: 'CX',
        quantidade: 4_000n,
        valorUnitario: 3_000n,
        loteDoFabricante: '',
        validade: null,
      },
    ])
  })

  const det = (i: number, cProd = `C${i}`, xProd = `ITEM ${i}`) =>
    `<det nItem="${i}"><prod><cProd>${cProd}</cProd><xProd>${xProd}</xProd><uCom>UN</uCom><qCom>1</qCom><vUnCom>1.00</vUnCom></prod></det>`
  const notaCom = (dets: string) => `<NFe><infNFe Id="NFe1">${dets}</infNFe></NFe>`

  it(`até ${MAX_ITENS_NA_NOTA} itens é lido; um a mais é recusado`, () => {
    const no990 = Array.from({ length: MAX_ITENS_NA_NOTA }, (_, i) => det(i + 1)).join('')
    expect(exigir(leitor.ler(notaCom(no990))).linhas).toHaveLength(MAX_ITENS_NA_NOTA)
    const r = leitor.ler(notaCom(no990 + det(991)))
    expect(ehErro(r)).toBe(true)
  })

  it('cProd e xProd são cortados no teto do leiaute (60 e 120)', () => {
    const n = exigir(leitor.ler(notaCom(det(1, 'C'.repeat(5_000), 'X'.repeat(50_000)))))
    expect(n.linhas[0]!.codigo).toBe('C'.repeat(60))
    expect(n.linhas[0]!.descricao).toBe('X'.repeat(120))
  })
})
