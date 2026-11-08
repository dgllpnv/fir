import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  LIMITES_DO_ASANA,
  diaDoAsana,
  ehDiaDoCalendario,
  lerCsv,
  lerExportacaoDoAsana,
  linhasParaImportar,
  pareceFormula,
  problemaDaTarefa,
  type ExportacaoDoAsana,
} from './asana-carteira'
import { ehErro, exigir } from './resultado'

/** Serializa como o Asana (e o Excel) fazem: todo campo entre aspas, `"` dobrada. */
const campoCsv = (s: string): string => `"${s.replace(/"/g, '""')}"`
const csv = (linhas: readonly (readonly string[])[], sep = ','): string =>
  linhas.map((l) => l.map(campoCsv).join(sep)).join('\r\n')

const CABECALHO = ['Task ID', 'Created At', 'Completed At', 'Name', 'Section/Column', 'Assignee', 'Assignee Email', 'Due Date', 'Notes']

type Tarefa = { id: string; criada?: string; concluida?: string; nome: string; secao?: string; prazo?: string; notas?: string }
const exportacao = (tarefas: readonly Tarefa[], sep = ','): string =>
  csv(
    [
      CABECALHO,
      ...tarefas.map((t) => [
        t.id,
        t.criada ?? '',
        t.concluida ?? '',
        t.nome,
        t.secao ?? '',
        'Fulana Responsável',
        'fulana@exemplo.com',
        t.prazo ?? '',
        t.notas ?? '',
      ]),
    ],
    sep,
  )

const ler = (texto: string, ja: Iterable<string> = []): ExportacaoDoAsana => exigir(lerExportacaoDoAsana(texto, new Set(ja)))
const todas = (e: ExportacaoDoAsana): Set<number> => new Set(e.tarefas.map((_, i) => i))

/* ── Gerador de texto "difícil": vírgula, ponto e vírgula, aspas, quebra de linha ── */
const charDificil = fc.constantFrom(',', ';', '"', '\n', '\r\n', ' ', 'a', 'é', 'Z', '1', 'ç', '\t')
const textoDificil = fc.array(charDificil, { maxLength: 30 }).map((a) => a.join(''))

describe('lerCsv: o parser do protótipo, com aspas, separadores e quebras de linha dentro do campo', () => {
  it('propriedade: serializar e ler devolve a mesma matriz (separador vírgula ou ponto e vírgula)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        fc.constantFrom(',', ';'),
        fc.array(fc.array(textoDificil, { minLength: 5, maxLength: 5 }), { minLength: 1, maxLength: 6 }),
        (colunas, sep, brutas) => {
          // Cada linha com pelo menos um campo não branco: linha toda em branco some (como no protótipo).
          const matriz = brutas.map((l, i) => {
            const linha = l.slice(0, colunas)
            linha[0] = `x${i}${linha[0] ?? ''}`
            return linha
          })
          const lida = lerCsv(csv(matriz, sep))
          const esperada = matriz.map((l) => l.map((c) => c.replace(/\r\n?/g, '\n')))
          expect(lida).toEqual(esperada)
        },
      ),
      { numRuns: 400 },
    )
  })

  it('o separador é o da primeira linha FORA das aspas (o protótipo contava dentro também)', () => {
    expect(lerCsv('"a;b;c",d\n"x;y;z",w')).toEqual([
      ['a;b;c', 'd'],
      ['x;y;z', 'w'],
    ])
    expect(lerCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('BOM sai, CRLF vira LF, linha em branco some', () => {
    expect(lerCsv('﻿Name,Notes\r\n\r\n"um","linha1\r\nlinha2"\r\n')).toEqual([
      ['Name', 'Notes'],
      ['um', 'linha1\nlinha2'],
    ])
  })
})

describe('diaDoAsana: aaaa-mm-dd ou dd/mm/aaaa, e a data precisa existir', () => {
  it('lê os dois formatos', () => {
    expect(diaDoAsana('2026-03-05')).toBe('2026-03-05')
    expect(diaDoAsana('2026-03-05T10:00:00Z')).toBe('2026-03-05')
    expect(diaDoAsana('5/3/2026')).toBe('2026-03-05')
    expect(diaDoAsana('05/03/2026')).toBe('2026-03-05')
  })
  it('recusa o que não existe ou não se lê', () => {
    expect(diaDoAsana('31/02/2026')).toBeNull()
    expect(diaDoAsana('2026-13-01')).toBeNull()
    expect(diaDoAsana('03-05-2026')).toBeNull()
    expect(diaDoAsana('')).toBeNull()
    expect(ehDiaDoCalendario('2024-02-29')).toBe(true)
    expect(ehDiaDoCalendario('2025-02-29')).toBe(false)
  })
})

describe('lerExportacaoDoAsana: a prévia do protótipo (L1795–1811)', () => {
  it('lê nome, notas, data e id; NUNCA o responsável nem o e-mail (LGPD A40)', () => {
    const e = ler(exportacao([{ id: '1201', nome: 'Reunião semanal', prazo: '2026-10-01', notas: 'Funil, agenda' }]))
    expect(e.tarefas).toHaveLength(1)
    const t = e.tarefas[0]!
    expect(t).toMatchObject({ nome: 'Reunião semanal', notas: 'Funil, agenda', data: '2026-10-01', asanaId: '1201', linha: 2 })
    expect(JSON.stringify(e)).not.toMatch(/Fulana|fulana@/)
    const enviadas = linhasParaImportar(e.tarefas, todas(e))
    expect(Object.keys(enviadas[0]!).sort()).toEqual(['asanaId', 'data', 'nome', 'notas'])
  })

  it('reconhece o cabeçalho em português, com ou sem acento, e o separador ponto e vírgula', () => {
    const texto = csv(
      [
        ['ID da tarefa', 'Nome', 'Seção/Coluna', 'Responsável', 'Data de conclusão', 'Concluído em', 'Notas'],
        ['77', 'Reunião mensal', 'Reuniões', 'Beltrana', '', '15/09/2026', 'texto'],
      ],
      ';',
    )
    const t = ler(texto).tarefas[0]!
    expect(t).toMatchObject({ asanaId: '77', nome: 'Reunião mensal', data: '2026-09-15', secao: 'Reuniões', notas: 'texto' })
  })

  it('a data é o prazo, senão a conclusão, senão a criação', () => {
    const e = ler(
      exportacao([
        { id: '1', nome: 'a', prazo: '2026-01-03', concluida: '2026-01-02', criada: '2026-01-01' },
        { id: '2', nome: 'b', concluida: '2026-01-02', criada: '2026-01-01' },
        { id: '3', nome: 'c', criada: '2026-01-01' },
        { id: '4', nome: 'd' },
      ]),
    )
    expect(e.tarefas.map((t) => t.data)).toEqual(['2026-01-03', '2026-01-02', '2026-01-01', null])
    expect(e.tarefas[3]).toMatchObject({ problema: 'sem_data', marcada: false })
  })

  it('tarefa sem nome some; se alguma fala em reunião, só essas ficam marcadas', () => {
    const e = ler(
      exportacao([
        { id: '1', nome: '', prazo: '2026-01-01' },
        { id: '2', nome: 'Reunião de diagnóstico', prazo: '2026-01-01' },
        { id: '3', nome: 'Enviar proposta', prazo: '2026-01-01' },
        { id: '4', nome: 'Pauta', secao: 'Reuniões', prazo: '2026-01-01' },
      ]),
    )
    expect(e.sugeridas).toBe(true)
    expect(e.tarefas.map((t) => [t.asanaId, t.marcada])).toEqual([
      ['2', true],
      ['3', false],
      ['4', true],
    ])
  })

  it('sem nenhuma que fale em reunião, todas as importáveis ficam marcadas', () => {
    const e = ler(exportacao([{ id: '1', nome: 'a', prazo: '2026-01-01' }, { id: '2', nome: 'b', prazo: '2026-01-01' }]))
    expect(e.sugeridas).toBe(false)
    expect(e.tarefas.every((t) => t.marcada)).toBe(true)
  })

  it('já importada (inclusive a arquivada) e id repetido no arquivo: desmarcadas e fora do envio', () => {
    const e = ler(
      exportacao([
        { id: '1', nome: 'a', prazo: '2026-01-01' },
        { id: '2', nome: 'b', prazo: '2026-01-01' },
        { id: '2', nome: 'b de novo', prazo: '2026-01-01' },
      ]),
      ['1'],
    )
    expect(e.tarefas.map((t) => [t.jaImportada, t.repetida, t.marcada])).toEqual([
      [true, false, false],
      [false, false, true],
      [false, true, false],
    ])
    expect(linhasParaImportar(e.tarefas, todas(e)).map((l) => l.asanaId)).toEqual(['2'])
  })

  it('sem id do Asana não entra (regra 26: sem chave, reimportar duplicaria) — divergência do protótipo', () => {
    const e = ler(exportacao([{ id: '', nome: 'Reunião', prazo: '2026-01-01' }]))
    expect(e.tarefas[0]).toMatchObject({ problema: 'sem_id', marcada: false })
    expect(linhasParaImportar(e.tarefas, todas(e))).toEqual([])
  })

  it('erros do arquivo', () => {
    expect(ehErro(lerExportacaoDoAsana('', new Set()))).toBe(true)
    const r = lerExportacaoDoAsana('Foo,Bar\n1,2', new Set())
    expect(ehErro(r) && r.erro.codigo).toBe('SEM_COLUNA_NOME')
    const muitas = exportacao(
      Array.from({ length: LIMITES_DO_ASANA.tarefas + 1 }, (_, i) => ({ id: String(i + 1), nome: `t${i}`, prazo: '2026-01-01' })),
    )
    const r2 = lerExportacaoDoAsana(muitas, new Set())
    expect(ehErro(r2) && r2.erro.codigo).toBe('TAREFAS_DEMAIS')
    const limite = exportacao(
      Array.from({ length: LIMITES_DO_ASANA.tarefas }, (_, i) => ({ id: String(i + 1), nome: `t${i}`, prazo: '2026-01-01' })),
    )
    expect(ler(limite).tarefas).toHaveLength(LIMITES_DO_ASANA.tarefas)
  })
})

describe('injeção e limites (appsec A-15): a linha é recusada, com o motivo, sem ecoar o valor', () => {
  const base = { nome: 'Reunião', notas: '', data: '2026-01-01', asanaId: '123' }

  it('nome que começa como fórmula', () => {
    for (const nome of ['=HYPERLINK("http://x")', '+1+1', '@SUM(A1)', '-2+3', '\tcmd']) {
      expect(pareceFormula(nome), nome).toBe(true)
      expect(problemaDaTarefa({ ...base, nome })).toBe('formula')
    }
    for (const nome of ['- item', '-- nota', 'Reunião = boa', 'R$ 10']) {
      expect(pareceFormula(nome), nome).toBe(false)
    }
  })

  it('as notas podem começar com @ ou + (texto livre, renderizado como texto)', () => {
    expect(problemaDaTarefa({ ...base, notas: '@Maria pode ver?\n+55 é o DDI' })).toBeNull()
  })

  it('caractere de controle ou bidirecional', () => {
    expect(problemaDaTarefa({ ...base, nome: 'Reu\u0000niao' })).toBe('caractere_invalido')
    expect(problemaDaTarefa({ ...base, nome: 'Reu‮niao' })).toBe('caractere_invalido')
    expect(problemaDaTarefa({ ...base, notas: 'linha\u0007' })).toBe('caractere_invalido')
    expect(problemaDaTarefa({ ...base, notas: 'linha 1\nlinha\t2' })).toBeNull()
  })

  it('id fora do formato e resumo longo demais', () => {
    expect(problemaDaTarefa({ ...base, asanaId: '=1' })).toBe('id_invalido')
    expect(problemaDaTarefa({ ...base, asanaId: 'x'.repeat(65) })).toBe('id_invalido')
    expect(problemaDaTarefa({ ...base, notas: 'x'.repeat(LIMITES_DO_ASANA.resumo - base.nome.length - 2) })).toBeNull()
    expect(problemaDaTarefa({ ...base, notas: 'x'.repeat(LIMITES_DO_ASANA.resumo - base.nome.length - 1) })).toBe('longa_demais')
  })
})

describe('propriedades da importação', () => {
  const idGen = fc.integer({ min: 1, max: 40 }).map(String)
  const tarefaGen = fc.record({
    id: idGen,
    nome: textoDificil.map((s) => `Reunião ${s}`),
    notas: textoDificil,
    prazo: fc.constantFrom('2026-01-05', '05/01/2026', '', '2026-02-30'),
    secao: textoDificil,
  })

  it('nome e notas com vírgula, ponto e vírgula, aspas e quebra de linha chegam íntegros (aparados, \\r\\n → \\n)', () => {
    fc.assert(
      fc.property(fc.array(tarefaGen, { minLength: 1, maxLength: 15 }), fc.constantFrom(',', ';'), (tarefas, sep) => {
        const e = ler(exportacao(tarefas, sep))
        const norm = (s: string) => s.replace(/\r\n?/g, '\n').trim()
        expect(e.tarefas.map((t) => [t.asanaId, t.nome, t.notas])).toEqual(
          tarefas.map((t) => [t.id, norm(t.nome), norm(t.notas)]),
        )
      }),
      { numRuns: 300 },
    )
  })

  it('idempotência: importar o que a prévia oferece e reler o mesmo arquivo três vezes não oferece nada de novo', () => {
    fc.assert(
      fc.property(fc.array(tarefaGen, { minLength: 1, maxLength: 25 }), (tarefas) => {
        const texto = exportacao(tarefas)
        const importados = new Set<string>()
        const ondas: number[] = []
        for (let vez = 0; vez < 3; vez++) {
          const e = ler(texto, importados)
          const linhas = linhasParaImportar(e.tarefas, todas(e))
          // Nenhum id enviado é repetido nem já importado.
          expect(new Set(linhas.map((l) => l.asanaId)).size).toBe(linhas.length)
          for (const l of linhas) expect(importados.has(l.asanaId)).toBe(false)
          for (const l of linhas) importados.add(l.asanaId)
          ondas.push(linhas.length)
        }
        expect(ondas[1]).toBe(0)
        expect(ondas[2]).toBe(0)
      }),
      { numRuns: 300 },
    )
  })

  it('toda linha enviada passa na regra de linha do servidor', () => {
    fc.assert(
      fc.property(fc.array(tarefaGen, { minLength: 1, maxLength: 25 }), (tarefas) => {
        const e = ler(exportacao(tarefas))
        for (const l of linhasParaImportar(e.tarefas, todas(e))) expect(problemaDaTarefa(l)).toBeNull()
      }),
    )
  })
})
