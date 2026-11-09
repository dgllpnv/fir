import { describe, expect, it } from 'vitest'
import { gtinCanonico, interpretarCodigo } from './codigo-de-barras'

/**
 * O que a câmera lê, e o que isso significa para o estoque.
 *
 * Duas coisas acontecem aqui e as duas doem quando erram:
 *
 *  - a **validade** lida de um DataMatrix GS1 vira o LOTE do nosso modelo, e o
 *    FIFO é por ela (regra 15). Um dia errado tira um lote bom da fila ou
 *    oferece um vencido;
 *  - o **GTIN** precisa ser comparável com o que o catálogo gravou, e EAN-13 e
 *    GTIN-14 do mesmo produto são o mesmo código.
 */
describe('interpretarCodigo — etiqueta, GS1 e código de barras', () => {
  it('a ETIQUETA da ferramenta devolve o item', () => {
    expect(interpretarCodigo('FRMEST:clinica-abc:item-123')).toEqual({
      tipo: 'etiqueta',
      clinica: 'clinica-abc',
      itemId: 'item-123',
    })
    // O código da clínica pode estar vazio (o protótipo usa "demo"), e o item
    // continua sendo lido: o que identifica é o terceiro campo.
    expect(interpretarCodigo('FRMEST::item-123')).toEqual({
      tipo: 'etiqueta',
      clinica: '',
      itemId: 'item-123',
    })
  })

  it('o DATAMATRIX GS1 devolve GTIN, validade e lote', () => {
    // (01) GTIN · (17) validade AAMMDD · (10) lote
    const lido = interpretarCodigo('01078912345678951726063010L2611A')
    expect(lido).toEqual({
      tipo: 'medicamento',
      gtin: '07891234567895',
      validade: '2026-06-30',
      lote: 'L2611A',
    })
  })

  it('o DIA `00` do GS1 é o ÚLTIMO DIA DO MÊS, não o 28', () => {
    /**
     * Está na especificação GS1: `DD = 00` significa "fim do mês", e é o que o
     * fabricante imprime quando a validade é "06/2027".
     *
     * **O protótipo usa `28` fixo.** Em janeiro isso antecipa a validade em
     * três dias, e um lote bom sai do FIFO antes da hora — ou, pior, a tela
     * acusa "vence este mês" num frasco que tem mais um mês de vida.
     */
    const junho = interpretarCodigo('010789123456789517270600')
    expect(junho).toMatchObject({ validade: '2027-06-30' })
    const janeiro = interpretarCodigo('010789123456789517270100')
    expect(janeiro).toMatchObject({ validade: '2027-01-31' })
    // E fevereiro de ano bissexto: 2028 é bissexto, 2027 não é.
    expect(interpretarCodigo('010789123456789517270200')).toMatchObject({
      validade: '2027-02-28',
    })
    expect(interpretarCodigo('010789123456789517280200')).toMatchObject({
      validade: '2028-02-29',
    })
  })

  it('validade com dia que NÃO EXISTE no mês não vira data', () => {
    // `270631` é 31 de junho; `270229`, 29 de fevereiro de ano comum. Antes os
    // dois viravam texto de data inexistente, e o FIFO de validade comparava
    // um lote contra um dia que o calendário não tem.
    expect(interpretarCodigo('010789123456789517270631')).not.toHaveProperty('validade', '2027-06-31')
    expect(interpretarCodigo('010789123456789517270229')).not.toHaveProperty('validade', '2027-02-29')
    expect(interpretarCodigo('010789123456789517270630')).toMatchObject({ validade: '2027-06-30' })
    expect(interpretarCodigo('010789123456789517280229')).toMatchObject({ validade: '2028-02-29' })
  })

  it('o LOTE é de tamanho VARIÁVEL e termina no separador de grupo', () => {
    // Sem o separador, ler um tamanho fixo comeria o AI seguinte — e a série
    // viraria parte do lote.
    const comSerie = interpretarCodigo('0107891234567895172606301 0L26A|21SERIE9'.replace(' ', ''))
    expect(comSerie).toMatchObject({ lote: 'L26A' })
  })

  it('AI desconhecido PARA a leitura em vez de adivinhar o tamanho', () => {
    // Adivinhar faria o resto ser interpretado deslocado, e a validade sairia
    // de um pedaço de outro campo.
    const lido = interpretarCodigo('010789123456789599XPTO17260630')
    expect(lido).toMatchObject({ tipo: 'medicamento', validade: null, lote: '' })
  })

  it('o CÓDIGO DE BARRAS nu é normalizado para 14 dígitos', () => {
    expect(interpretarCodigo('7891234567895')).toEqual({
      tipo: 'barras',
      gtin: '07891234567895',
    })
    expect(interpretarCodigo('12345678')).toEqual({ tipo: 'barras', gtin: '00000012345678' })
  })

  it('texto estranho vira `desconhecido` — nunca lança, nunca adivinha', () => {
    expect(interpretarCodigo('qualquer coisa')).toEqual({
      tipo: 'desconhecido',
      texto: 'qualquer coisa',
    })
    expect(interpretarCodigo('')).toEqual({ tipo: 'desconhecido', texto: '' })
    // Sete dígitos não é código de barras nenhum.
    expect(interpretarCodigo('1234567')).toMatchObject({ tipo: 'desconhecido' })
  })

  it('os prefixos de simbologia do leitor são descartados', () => {
    expect(interpretarCodigo(']d201078912345678951726063010L1')).toMatchObject({
      tipo: 'medicamento',
      gtin: '07891234567895',
    })
  })
})

describe('gtinCanonico', () => {
  it('EAN-13 e GTIN-14 do mesmo produto dão a MESMA forma', () => {
    expect(gtinCanonico('7891234567895')).toBe('07891234567895')
    expect(gtinCanonico('07891234567895')).toBe('07891234567895')
    // E o que não é dígito sai: alguns leitores entregam separadores.
    expect(gtinCanonico('789-1234-567895')).toBe('07891234567895')
  })
})
