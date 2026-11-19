import {
  CATALOGO_DE_RELATORIOS,
  CHAVES_DE_RELATORIO,
  classeDoRelatorio,
  FILTROS_DOS_RELATORIOS,
  LINHAS_DOS_RELATORIOS,
  podeAbrirRelatorio,
} from '@fir/contracts'
import { CAMPOS_MONETARIOS, type ChaveDePermissao } from '@fir/domain'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { redigir } from '../comum/redacao.interceptor'
import type { SaidaDaConsulta } from './consultas'
import { montar } from './motor'

const AQUI = dirname(fileURLToPath(import.meta.url))
// Recursiva: as consultas do T9 moram em `consultas/` e entram na varredura.
// `as`: com `recursive` e sem `withFileTypes`, o Node devolve `string[]`.
const fontes = (readdirSync(AQUI, { recursive: true }) as string[])
  .map((n) => n.split(sep).join('/'))
  .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
  .map((n) => ({ nome: n, texto: readFileSync(join(AQUI, n), 'utf8') }))

const LINHAS = LINHAS_DOS_RELATORIOS

describe('relatorios-sem-sql-raw (appsec C12)', () => {
  it('a varredura ENXERGA o motor, as consultas e o controlador', () => {
    expect(fontes.map((f) => f.nome)).toEqual(expect.arrayContaining([
        'motor.ts',
        'consultas.ts',
        'relatorios.controller.ts',
        'campanha.service.ts',
        'consultas/pacientes.ts',
        'consultas/financeiro-e-estoque.ts',
        'consultas/jornada.ts',
      ]))
  })

  it('nenhum sql.raw, sql.identifier, nem template com interpolação que leve SQL', () => {
    const achados: string[] = []
    for (const f of fontes) {
      if (/sql\s*\.\s*(raw|identifier)/.test(f.texto)) achados.push(`${f.nome}: sql.raw/identifier`)
      for (const t of f.texto.match(/`[^`]*`/g) ?? []) {
        if (t.includes('${') && /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|ORDER BY|JOIN)\b/.test(t)) {
          achados.push(`${f.nome}: ${t.slice(0, 60)}`)
        }
      }
    }
    expect(achados).toEqual([])
  })

  it('a varredura tem dentes: um template com SQL interpolado É pego', () => {
    const t = '`SELECT * FROM x WHERE id = ${id}`'
    expect(t.includes('${') && /\bSELECT\b/.test(t)).toBe(true)
  })

  it('toda rota do controlador tem @Exige explícito', () => {
    const fonte = fontes
      .find((f) => f.nome === 'relatorios.controller.ts')!
      .texto.replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const rotas = fonte.match(/@(Get|Post|Put|Patch|Delete)\(/g) ?? []
    const exige = fonte.match(/@Exige\(/g) ?? []
    expect(rotas.length).toBeGreaterThanOrEqual(6)
    expect(exige.length).toBe(rotas.length)
  })
})

/** Desce até o objeto por baixo de `superRefine`/`default`/`optional`. */
function campos(s: z.ZodTypeAny): Record<string, z.ZodTypeAny> {
  let atual: z.ZodTypeAny = s
  while (atual instanceof z.ZodEffects) atual = atual.innerType()
  if (!(atual instanceof z.ZodObject)) throw new Error('filtro sem objeto')
  return atual.shape as Record<string, z.ZodTypeAny>
}

function folha(s: z.ZodTypeAny): z.ZodTypeAny {
  let atual = s
  for (;;) {
    if (atual instanceof z.ZodOptional || atual instanceof z.ZodNullable) atual = atual.unwrap()
    else if (atual instanceof z.ZodDefault) atual = atual.removeDefault()
    // A lista (procedimentos e situações do 5) é tão livre quanto o elemento dela.
    else if (atual instanceof z.ZodArray) atual = atual.element
    else if (atual instanceof z.ZodEffects) atual = atual.innerType()
    else return atual
  }
}

describe('filtros-sem-string-livre (LGPD L-IN-7; appsec C12)', () => {
  for (const chave of CHAVES_DE_RELATORIO) {
    it(`${chave}: todo campo é enum, id, dia, centavos, número ou booleano`, () => {
      for (const [nome, s] of Object.entries(campos(FILTROS_DOS_RELATORIOS[chave]))) {
        const f = folha(s)
        if (f instanceof z.ZodString) {
          const restrita = f._def.checks.some((k) => k.kind === 'uuid' || k.kind === 'regex')
          expect(restrita, `${chave}.${nome} é string livre`).toBe(true)
        } else {
          expect(f instanceof z.ZodEnum || f instanceof z.ZodNumber || f instanceof z.ZodBoolean, `${chave}.${nome}`).toBe(true)
        }
      }
    })
  }

  it('o filtro é .strict(): chave extra não passa', () => {
    const r = FILTROS_DOS_RELATORIOS['tarefas-da-equipe'].safeParse({ de: '2026-10-01', ate: '2026-10-31', nome: 'Ana' })
    expect(r.success).toBe(false)
  })

  it('a janela é de no máximo 24 meses', () => {
    expect(FILTROS_DOS_RELATORIOS.recebimentos.safeParse({ de: '2024-10-01', ate: '2026-09-30' }).success).toBe(true)
    expect(FILTROS_DOS_RELATORIOS.recebimentos.safeParse({ de: '2024-10-01', ate: '2026-10-01' }).success).toBe(false)
  })
})

describe('classe-do-relatorio-por-filtro (LGPD L-IN-1)', () => {
  it('o 1 é pessoal, e sobe para saude com o procedimento', () => {
    expect(classeDoRelatorio('pacientes-sem-compra', { semCompraHaMeses: 3 })).toBe('pessoal')
    expect(classeDoRelatorio('pacientes-sem-compra', { semCompraHaMeses: 3, procedimentoId: 'x' })).toBe('saude')
  })
  it('o 11 é nenhuma, e sobe para saude com a coluna de paciente', () => {
    expect(classeDoRelatorio('saidas-de-estoque', { incluirPaciente: false })).toBe('nenhuma')
    expect(classeDoRelatorio('saidas-de-estoque', { incluirPaciente: true })).toBe('saude')
  })
  it('o 8 é pessoal e o 15 é nenhuma, sempre', () => {
    expect(classeDoRelatorio('recebimentos', {})).toBe('pessoal')
    expect(classeDoRelatorio('tarefas-da-equipe', {})).toBe('nenhuma')
  })
})

describe('schema-de-linha-e-o-padrao (LGPD L-IN-6)', () => {
  for (const chave of CHAVES_DE_RELATORIO) {
    it(`${chave}: as chaves da linha são as colunas do catálogo mais os ids`, () => {
      const daLinha = Object.keys(LINHAS[chave].shape).filter((k) => !k.endsWith('Id')).sort()
      const doCatalogo = CATALOGO_DE_RELATORIOS[chave].colunas.map((c) => c.chave).sort()
      expect(daLinha).toEqual(doCatalogo)
    })
  }

  it('toda coluna `dinheiro` tem a chave em CAMPOS_MONETARIOS', () => {
    const fora = CHAVES_DE_RELATORIO.flatMap((k) =>
      CATALOGO_DE_RELATORIOS[k].colunas.filter((c) => c.tipo === 'dinheiro' && !CAMPOS_MONETARIOS.includes(c.chave)).map((c) => `${k}.${c.chave}`),
    )
    expect(fora).toEqual([])
  })

  it('nenhum relatório tem telefone fora do opt-in, e o 15 não tem paciente', () => {
    for (const k of CHAVES_DE_RELATORIO) {
      for (const c of CATALOGO_DE_RELATORIOS[k].colunas) {
        if (c.chave === 'telefone') expect('optIn' in c && c.optIn === 'telefone').toBe(true)
      }
    }
    expect(Object.keys(LINHAS['tarefas-da-equipe'].shape).some((k) => k.startsWith('paciente'))).toBe(false)
  })

  it('T9: o 7 nunca traz a data completa de nascimento, e o 4 nunca o nome da indicada (I-38)', () => {
    const do7 = Object.keys(LINHAS.aniversariantes.shape)
    expect(do7.some((k) => /aniversario|nascimento/i.test(k))).toBe(false)
    expect(Object.keys(LINHAS['pacientes-que-indicaram'].shape).some((k) => /^indicada(s)?Nome|nomeDaIndicada/i.test(k))).toBe(false)
  })

  it('T9: o 3 exige valores e o 5 exige jornada, na tabela (c.11c; L-IN-2)', () => {
    expect(CATALOGO_DE_RELATORIOS['pacientes-maior-ltv'].exigeTambem).toEqual(['valores'])
    expect(CATALOGO_DE_RELATORIOS['pacientes-por-procedimento'].exigeTambem).toEqual(['jornada'])
    expect(podeAbrirRelatorio('pacientes-maior-ltv', (k) => k === 'pacientes')).toBe(false)
    expect(podeAbrirRelatorio('pacientes-maior-ltv', (k) => k === 'pacientes' || k === 'valores')).toBe(true)
    expect(podeAbrirRelatorio('pacientes-por-procedimento', (k) => k === 'programas')).toBe(false)
  })
})

describe('log-sem-conteudo-relatorios (appsec C15, C29; LGPD L-IN-16): a API não tem log de requisição', () => {
  const main = readFileSync(join(AQUI, '..', 'main.ts'), 'utf8')

  it('o FastifyAdapter da produção sobe SEM logger — nenhuma URL, query ou corpo vai para o log', () => {
    expect(main).toMatch(/new FastifyAdapter\(\{ trustProxy: confiarNoSalto \}\)/)
    expect(main).not.toMatch(/logger\s*:/)
    expect(main).not.toMatch(/addHook\(\s*['"]on(Request|Response|Send)/)
  })

  it('o filtro de erro dos relatórios só registra o código do erro', () => {
    const controlador = fontes.find((f) => f.nome === 'relatorios.controller.ts')!.texto
    const chamadas = controlador.split('\n').filter((l) => /this\.log\.\w+\(|console\.|Logger\.\w+\(/.test(l))
    expect(chamadas.map((l) => l.trim())).toEqual(['this.log.error(`relatorio falhou (codigo ${codigo})`)'])
    for (const f of fontes.filter((x) => x.nome !== 'relatorios.controller.ts')) {
      expect(f.texto, f.nome).not.toMatch(/this\.log\.|console\.|new Logger/)
    }
  })
})

describe('exportacao-redacao-mutacao (appsec C16): cada camada, SOZINHA, apaga o dinheiro', () => {
  const saida: SaidaDaConsulta<unknown, unknown> = {
    linhas: [
      {
        pacienteId: '00000000-0000-4000-8000-000000000001',
        nome: 'Ana',
        ultimaCompra: '2026-01-10',
        valorDaUltimaCompra: '45678',
        ltv: '987654',
      },
    ],
    resumo: { pacientes: 1 },
    truncado: false,
    filtrosEmTexto: ['Sem compra há 3 meses'],
    pacienteIds: [],
    optIn: [],
  }
  const comValores = (_: ChaveDePermissao) => true
  const semValores = (k: ChaveDePermissao) => k !== 'valores'

  it('o MOTOR sozinho (sem interceptor): tira as colunas `dinheiro` e apaga os valores', () => {
    const r = montar('pacientes-sem-compra', 'pessoal', { semCompraHaMeses: 3 }, saida, semValores)
    expect(r.colunas.some((c) => c.tipo === 'dinheiro')).toBe(false)
    expect(JSON.stringify(r)).not.toContain('987654')
    expect(JSON.stringify(r)).not.toContain('45678')
  })

  it('o INTERCEPTOR sozinho (motor "esquecendo"): a mesma função apaga na saída', () => {
    const vazado = montar('pacientes-sem-compra', 'pessoal', { semCompraHaMeses: 3 }, saida, comValores)
    expect(JSON.stringify(vazado)).toContain('987654')
    const r = JSON.stringify(redigir(vazado, semValores))
    expect(r).not.toContain('987654')
    expect(r).not.toContain('45678')
  })

  it('com `valores`, o número sai — senão a prova acima não mediria nada', () => {
    const r = montar('pacientes-sem-compra', 'pessoal', { semCompraHaMeses: 3 }, saida, comValores)
    expect(r.colunas.map((c) => c.chave)).toEqual(['nome', 'ultimaCompra', 'valorDaUltimaCompra', 'ltv'])
    expect(JSON.stringify(r)).toContain('987654')
  })

  it('as somas da faixa de resumo: o motor sem `valores` não as monta; o interceptor sozinho apaga o valor', () => {
    const duas: SaidaDaConsulta<unknown, unknown> = {
      ...saida,
      linhas: [...saida.linhas, { ...(saida.linhas[0] as object), pacienteId: '00000000-0000-4000-8000-000000000002', ltv: '12346' }],
    }
    const com = montar('pacientes-sem-compra', 'pessoal', { semCompraHaMeses: 3 }, duas, comValores)
    // 987.654 + 12.346 = 1.000.000, pelo value object.
    expect(com.somas).toEqual([{ coluna: 'ltv', rotulo: 'LTV somado', valor: '1000000' }])
    const sem = montar('pacientes-sem-compra', 'pessoal', { semCompraHaMeses: 3 }, duas, semValores)
    expect(sem.somas).toEqual([])
    expect(JSON.stringify(sem)).not.toContain('1000000')
    expect(JSON.stringify(redigir(com, semValores))).not.toContain('1000000')
  })

  // T9: a mesma prova num relatório novo, com dinheiro na linha E no resumo.
  const do9: SaidaDaConsulta<unknown, unknown> = {
    linhas: [
      {
        pacienteId: '00000000-0000-4000-8000-000000000001',
        programaId: null,
        nome: 'Ana',
        adesao: 'Geral',
        valorAberto: '313131',
        desde: '2026-01-10',
      },
    ],
    resumo: { pacientes: 1, grupos: 1, aReceber: '313131' },
    truncado: false,
    filtrosEmTexto: ['Saldo de agora'],
    pacienteIds: [],
    optIn: [],
  }
  it('relatório 9, cada camada SOZINHA apaga `valorAberto` e `aReceber`; com `valores`, saem', () => {
    const motor = montar('saldos-em-aberto', 'pessoal', {}, do9, semValores)
    expect(motor.colunas.some((c) => c.tipo === 'dinheiro')).toBe(false)
    expect(JSON.stringify(motor)).not.toContain('313131')
    const vazado = montar('saldos-em-aberto', 'pessoal', {}, do9, comValores)
    expect(JSON.stringify(vazado)).toContain('313131')
    expect(JSON.stringify(redigir(vazado, semValores))).not.toContain('313131')
  })
})
