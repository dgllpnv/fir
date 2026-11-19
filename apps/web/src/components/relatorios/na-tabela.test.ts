import type { ResultadoDaExportacao } from '@fir/contracts'
import { describe, expect, it } from 'vitest'
import { montarCsv } from '@/lib/planilha'
import { camposIniciais, celula, deFiltros, grupoDoRelatorio, ordenar, paraFiltros, tabelaDaExportacao, temOptInDeTelefone } from './na-tabela'

describe('célula: formata o que veio, nunca calcula', () => {
  it('dinheiro pelo formatador central; `null` (redigido) é traço, e vazio no arquivo', () => {
    expect(celula({ chave: 'valor', tipo: 'dinheiro' }, { valor: '125050' }).texto).toBe('R$ 1.250,50')
    const redigido = celula({ chave: 'valor', tipo: 'dinheiro' }, { valor: null })
    expect(redigido.texto).toBe('—')
    expect(redigido.arquivo.valor).toBe('')
  })

  it('compensação de reabertura: quantidade e custo negativos, como vieram (números B8)', () => {
    const l = { quantidadeEmEstoque: { milesimos: '-2500', unidade: 'ml', texto: '-2,5 ml' }, custo: '-1234' }
    expect(celula({ chave: 'quantidadeEmEstoque', tipo: 'quantidade' }, l).texto).toBe('-2,5')
    expect(celula({ chave: 'custo', tipo: 'dinheiro' }, l).texto).toBe('-R$ 12,34')
    expect(celula({ chave: 'custo', tipo: 'dinheiro' }, l).arquivo.tipo).toBe('numero')
  })

  it('data no formato da tela, e texto do usuário é célula de TEXTO no arquivo', () => {
    expect(celula({ chave: 'data', tipo: 'data' }, { data: '2026-11-17' }).texto).toBe('17/11/2026')
    expect(celula({ chave: 'motivo', tipo: 'texto' }, { motivo: '=cmd()' }).arquivo).toEqual({ tipo: 'texto', valor: '=cmd()' })
  })

  it('ordena por centavos como inteiro (não como texto) e deixa o vazio no fim', () => {
    const linhas = [{ v: '900' }, { v: null }, { v: '10000' }, { v: '-5' }]
    const col = { chave: 'v', tipo: 'dinheiro' } as const
    expect(ordenar(linhas, col, 'asc').map((l) => l['v'])).toEqual(['-5', '900', '10000', null])
    expect(ordenar(linhas, col, 'desc').map((l) => l['v'])).toEqual(['10000', '900', '-5', null])
  })
})

describe('filtros', () => {
  it('reais digitados viram centavos inteiros, sem ponto flutuante', () => {
    const c = { ...camposIniciais('2026-11-17'), meses: '4', valorMinimo: '1.000,10' }
    expect(paraFiltros('pacientes-sem-compra', c)).toEqual({ filtros: { semCompraHaMeses: 4, valorMinimo: '100010' } })
  })

  it('favorito → campos → filtros devolve os mesmos filtros', () => {
    const f = { modo: 'analise', de: '2026-10-01', ate: '2026-10-31', incluirPaciente: false, itemId: '0b6f2a3e-8a3b-4c1d-9e2f-1a2b3c4d5e6f' }
    const campos = deFiltros('saidas-de-estoque', f, camposIniciais('2026-11-17'))
    expect(paraFiltros('saidas-de-estoque', campos)).toEqual({ filtros: f })
  })

  it('período padrão: do dia 1 do mês até hoje — o hoje do SERVIDOR, que entra por parâmetro', () => {
    expect(paraFiltros('recebimentos', camposIniciais('2026-11-17'))).toEqual({ filtros: { de: '2026-11-01', ate: '2026-11-17' } })
  })
})

describe('catálogo', () => {
  it('o grupo sai do número do relatório', () => {
    expect([1, 7, 8, 10, 11, 12, 13, 14, 15].map(grupoDoRelatorio)).toEqual([
      'Pacientes', 'Pacientes', 'Financeiro', 'Financeiro', 'Estoque', 'Estoque', 'Comercial', 'Comercial', 'Equipe',
    ])
  })

  it('"Incluir telefone" só onde o catálogo tem a coluna opt-in', () => {
    expect(temOptInDeTelefone('pacientes-sem-compra')).toBe(true)
    expect(temOptInDeTelefone('recebimentos')).toBe(false)
  })
})

describe('o arquivo (L-IN-12)', () => {
  const exportacao: ResultadoDaExportacao = {
    exportacao: {
      codigo: 'a1b2c3d4',
      nomeDoArquivo: 'fir-pacientes-sem-compra-20261117-a1b2c3d4.csv',
      formato: 'csv',
      cabecalho: {
        clinica: '=Clínica',
        relatorio: 'Pacientes sem compra',
        filtrosEmTexto: ['Sem compra há 4 meses', 'Procedimento: Tirzepatida'],
        geradoEm: '17/11/2026 09:30',
        exportadoPor: 'Helena',
        codigo: 'a1b2c3d4',
        finalidade: 'Recall de lote',
        aviso: 'Contém dados pessoais sensíveis de saúde (LGPD, art. 11).',
      },
    },
    resultado: {
      relatorio: 'pacientes-sem-compra',
      classe: 'saude',
      cabecalho: { titulo: 'Pacientes sem compra', filtrosEmTexto: [] },
      colunas: [
        { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
        { chave: 'ultimaCompra', rotulo: 'Última compra', tipo: 'data' },
      ],
      // Sem `valores` (as colunas em reais não saíram), nenhuma soma.
      somas: [],
      linhas: [
        {
          pacienteId: '0b6f2a3e-8a3b-4c1d-9e2f-1a2b3c4d5e6f',
          nome: '@Maria',
          ultimaCompra: '2026-06-02',
          valorDaUltimaCompra: null,
          ltv: null,
        },
      ],
      resumo: { pacientes: 1 },
      truncado: false,
    },
  }

  it('leva o cabeçalho do servidor — clínica, filtros, data, quem, código, finalidade e aviso — antes das colunas', () => {
    const t = tabelaDaExportacao(exportacao)
    const valores = t.linhas.map((l) => l.map((c) => c.valor))
    expect(valores.slice(0, 8)).toEqual([
      ['Clínica', '=Clínica'],
      ['Relatório', 'Pacientes sem compra'],
      ['Filtros', 'Sem compra há 4 meses · Procedimento: Tirzepatida'],
      ['Gerado em', '17/11/2026 09:30'],
      ['Exportado por', 'Helena'],
      ['Código da exportação', 'a1b2c3d4'],
      ['Finalidade', 'Recall de lote'],
      ['Aviso', 'Contém dados pessoais sensíveis de saúde (LGPD, art. 11).'],
    ])
    expect(valores.slice(8)).toEqual([[], ['Paciente', 'Última compra'], ['@Maria', '02/06/2026']])
  })

  it('no CSV, o texto perigoso do cabeçalho e da linha ganha o apóstrofo', () => {
    const csv = montarCsv(tabelaDaExportacao(exportacao))
    expect(csv).toContain("Clínica;'=Clínica\r\n")
    expect(csv).toContain("'@Maria;02/06/2026\r\n")
  })

  it('no fim, a linha "Total" com as somas do SERVIDOR, debaixo de cada coluna; sem soma, nenhuma linha a mais', () => {
    const comValores: ResultadoDaExportacao = {
      ...exportacao,
      resultado: {
        relatorio: 'pacientes-sem-compra',
        classe: 'saude',
        cabecalho: { titulo: 'Pacientes sem compra', filtrosEmTexto: [] },
        resumo: { pacientes: 1 },
        truncado: false,
        colunas: [
          { chave: 'nome', rotulo: 'Paciente', tipo: 'texto' },
          { chave: 'ultimaCompra', rotulo: 'Última compra', tipo: 'data' },
          { chave: 'valorDaUltimaCompra', rotulo: 'Valor da última compra', tipo: 'dinheiro' },
          { chave: 'ltv', rotulo: 'LTV', tipo: 'dinheiro' },
        ],
        linhas: [
          { pacienteId: '0b6f2a3e-8a3b-4c1d-9e2f-1a2b3c4d5e6f', nome: '@Maria', ultimaCompra: '2026-06-02', valorDaUltimaCompra: '1000', ltv: '-125050' },
        ],
        // A tela não soma: escreve o que o servidor mandou.
        somas: [{ coluna: 'ltv', rotulo: 'LTV somado', valor: '-125050' }],
      },
    }
    const t = tabelaDaExportacao(comValores)
    expect(t.linhas[t.linhas.length - 1]).toEqual([
      { tipo: 'texto', valor: 'Total' },
      { tipo: 'texto', valor: '' },
      { tipo: 'texto', valor: '' },
      { tipo: 'numero', valor: '-R$ 1.250,50' },
    ])
    // O número negativo sai como número, sem o apóstrofo da proteção de texto.
    expect(montarCsv(t).endsWith('Total;;;-R$ 1.250,50\r\n')).toBe(true)
    // Sem soma (sem `valores`): cabeçalho, linha em branco, colunas e a linha — nada a mais.
    expect(tabelaDaExportacao(exportacao).linhas).toHaveLength(11)
  })
})
