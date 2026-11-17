import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { PERMS, type Perfil, perfisPadrao, podeEscreverNaUnidade, podeLancar, exigeValoresParaEscrever, temPerm, CAMPOS_MONETARIOS } from '../permissoes'
import {
  CATALOGO_DE_KPIS,
  CHAVES_DO_CATALOGO,
  combinarBaldes,
  kpiDoCatalogo,
  permissaoDoValor,
  podeVerKpi,
  recombinaBaldes,
  unidadeDoKpiDoCatalogo,
  valorDaMediaMensal,
  valorDaTaxa,
} from './catalogo'
import { conversaoDeOrcamentos } from './conversao'
import { umAUmEmDia } from './pessoas'
import { NumeroDoKpi, UNIDADES_DE_KPI, valorNaTela } from './unidades'

describe('catálogo (I-7)', () => {
  it('catalogo-tem-fonte-para-toda-chave: 20 chaves únicas, cada uma com fonte e permissaoDoValor declarada', () => {
    expect(CHAVES_DO_CATALOGO).toHaveLength(20)
    expect(new Set(CHAVES_DO_CATALOGO).size).toBe(20)
    expect(CATALOGO_DE_KPIS.map((k) => k.chave)).toEqual([...CHAVES_DO_CATALOGO])
    for (const k of CATALOGO_DE_KPIS) {
      expect(k.fonte.length, k.chave).toBeGreaterThan(0)
      expect(k).toHaveProperty('permissaoDoValor')
      expect(k.frequencias.length, k.chave).toBeGreaterThan(0)
      for (const p of k.parametrosObrigatorios) expect(k.parametros).toContain(p)
    }
  })

  it('explicacao-sem-referencia-da-spec: a tela lê a explicação, nunca "(I-9)" nem "(c.12)" (revisão S3)', () => {
    for (const k of CATALOGO_DE_KPIS) {
      expect(k.explicacao.length, k.chave).toBeGreaterThan(0)
      expect(k.explicacao, k.chave).not.toMatch(/\((?:I|c|B|C)[-.]?\d/)
      expect(k.explicacao, k.chave).not.toMatch(/\s$/)
    }
    expect(kpiDoCatalogo('faturamento_conferido').explicacao).toBe('Recebimentos dos dias com caixa fechado')
    expect(kpiDoCatalogo('comparecimento').explicacao).toBe('Realizados ÷ (realizados + faltas)')
    // O parêntese que é texto fica.
    expect(kpiDoCatalogo('novos_pacientes').explicacao).toBe('Painel: pacientes novos (origem opcional)')
  })

  it('os três KPIs de RH exigem pessoas.gerir, e a razão monetária exige valores (appsec C5; números c.11b)', () => {
    const comPermissao = CATALOGO_DE_KPIS.filter((k) => k.permissaoDoValor !== null).map((k) => [k.chave, k.permissaoDoValor])
    expect(comPermissao).toEqual([
      ['despesas_fixas_sobre_recebido', 'valores'],
      ['atingimento_metas_individuais', 'pessoas.gerir'],
      ['saldo_banco_de_horas', 'pessoas.gerir'],
      ['conversas_1a1_em_dia', 'pessoas.gerir'],
    ])
    // Todo KPI do pilar Pessoas está nessa lista: um quarto KPI de RH sem a chave é defeito.
    for (const k of CATALOGO_DE_KPIS.filter((x) => x.pilar === 'Pessoas')) expect(k.permissaoDoValor).toBe('pessoas.gerir')
    expect(permissaoDoValor(null)).toBeNull()
  })

  it('kpi-rh-some-sem-pessoas-gerir (parte pura): o filtro do ponto único esconde os três', () => {
    const perfis: Perfil[] = [{ id: 'p', nome: 'Gestão', perms: ['indicadores', 'painel', 'valores'] }]
    const u = { admin: false, perfilId: 'p' }
    const visiveis = CHAVES_DO_CATALOGO.filter((c) => podeVerKpi(u, perfis, c))
    expect(visiveis).toHaveLength(17)
    expect(visiveis).not.toContain('saldo_banco_de_horas')
    expect(visiveis).toContain('despesas_fixas_sobre_recebido')
    const semValores: Perfil[] = [{ id: 'p', nome: 'Equipe', perms: ['indicadores'] }]
    expect(CHAVES_DO_CATALOGO.filter((c) => podeVerKpi(u, semValores, c))).not.toContain('despesas_fixas_sobre_recebido')
    expect(podeVerKpi(u, semValores, null)).toBe(true)
  })

  it('as agregações declaradas: perda é analise (B4), atingimento é media_mensal (c.6), resultado do mês só mês civil (c.4)', () => {
    expect(kpiDoCatalogo('perda_de_estoque').agregacao).toBe('analise')
    expect(kpiDoCatalogo('atingimento_metas_individuais').agregacao).toBe('media_mensal')
    expect(kpiDoCatalogo('resultado_do_mes').somenteMesCivil).toBe(true)
    expect(kpiDoCatalogo('resultado_do_mes').frequencias).toEqual(['mensal'])
    expect(kpiDoCatalogo('resultado_do_mes').admiteNegativo).toBe(true)
    expect(CATALOGO_DE_KPIS.filter((k) => k.admiteNegativo).map((k) => k.chave)).toEqual(['resultado_do_mes'])
    expect(kpiDoCatalogo('resultado_de_campanha').parametrosObrigatorios).toEqual(['campanhaId'])
  })

  it('só mês civil: toda chave cuja fonte é do mês inteiro (validação T2, W2)', () => {
    expect(CATALOGO_DE_KPIS.filter((k) => k.somenteMesCivil).map((k) => k.chave)).toEqual([
      'resultado_do_mes',
      'despesas_fixas_sobre_recebido',
      'atingimento_metas_individuais',
      'saldo_banco_de_horas',
      'conversas_1a1_em_dia',
    ])
  })

  it('a composição com linha de paciente de comparecimento, faltas e recaptados exige jornada (LGPD L-IN-3)', () => {
    for (const c of ['comparecimento', 'faltas_recontatadas', 'pacientes_recaptados'] as const) {
      expect(kpiDoCatalogo(c).permissaoDaComposicao).toBe('jornada')
      expect(kpiDoCatalogo(c).composicaoComPaciente).toBe(true)
    }
  })

  it('resultado_de_campanha tem a unidade da métrica', () => {
    expect(unidadeDoKpiDoCatalogo('resultado_de_campanha', 'receita')).toBe('reais')
    expect(unidadeDoKpiDoCatalogo('resultado_de_campanha', 'agendamentos')).toBe('quantidade')
    expect(unidadeDoKpiDoCatalogo('ticket_medio')).toBe('reais')
  })
})

describe('agregação (I-4)', () => {
  it('media-mensal-nao-recombina: nem baldes, nem dois meses', () => {
    expect(recombinaBaldes('media_mensal')).toBe(false)
    const r = combinarBaldes('media_mensal', 'percentual', [{ valor: NumeroDoKpi.de('percentual', 5_000n) }])
    expect(r.tipo === 'erro' && r.erro.codigo).toBe('AgregacaoNaoRecombina')
    const dois = valorDaMediaMensal([
      { mes: '2026-10', percentuais: [100, 0] },
      { mes: '2026-11', percentuais: [100] },
    ])
    expect(dois.tipo === 'erro' && dois.erro.codigo).toBe('MediaMensalSoUmMes')
    // Um mês: a média das fichas, cada uma clampada em 100 (mediaDeAtingimento).
    const um = valorDaMediaMensal([{ mes: '2026-11', percentuais: [200, 0, null] }])
    expect(um.tipo === 'ok' && um.valor?.emMenorUnidade).toBe(5_000n)
  })

  it('perda (analise) e posição não se somam por balde (números B4 — parte pura)', () => {
    expect(recombinaBaldes('analise')).toBe(false)
    expect(recombinaBaldes('posicao')).toBe(false)
    // A ampola de R$ 10: falta de 2 em outubro e sobra de 2 em novembro. Somar os
    // meses daria R$ 20, e a análise de out–nov dá R$ 0. O domínio recusa a soma.
    const r = combinarBaldes('analise', 'reais', [{ valor: NumeroDoKpi.de('reais', 2_000n) }, { valor: NumeroDoKpi.de('reais', 0n) }])
    expect(r.tipo).toBe('erro')
  })

  it('taxa recombina pelos termos, nunca pela média dos percentuais', () => {
    // 1 de 1 (100%) e 1 de 3 (33%): a média daria 67%, os termos dão 2/4 = 50%.
    const r = combinarBaldes('taxa', 'percentual', [
      { numerador: 1n, denominador: 1n },
      { numerador: 1n, denominador: 3n },
    ])
    expect(r.tipo === 'ok' && r.valor?.emMenorUnidade).toBe(5_000n)
    expect(valorDaTaxa('percentual', 0n, 0n)).toBeNull()
    // Ticket médio: Dinheiro.media, meio para cima.
    expect(valorDaTaxa('reais', 1_000n, 3n)?.emMenorUnidade).toBe(333n)
  })

  it('property: soma de baldes = soma dos valores, e recombinar a partição dá o mesmo que o todo', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.bigInt({ min: 0n, max: 10n ** 9n }), fc.bigInt({ min: 0n, max: 10n ** 9n })), { maxLength: 30 }), fc.nat(30), (termos, corte) => {
        const baldes = termos.map(([n, d]) => ({ numerador: n < d ? n : d, denominador: d }))
        const todo = combinarBaldes('taxa', 'percentual', baldes)
        const k = Math.min(corte, baldes.length)
        const a = baldes.slice(0, k)
        const b = baldes.slice(k)
        const somaTermos = (xs: typeof baldes) => ({
          numerador: xs.reduce((s, x) => s + x.numerador, 0n),
          denominador: xs.reduce((s, x) => s + x.denominador, 0n),
        })
        const partido = combinarBaldes('taxa', 'percentual', [somaTermos(a), somaTermos(b)])
        expect(partido).toEqual(todo)
      }),
    )
  })
})

describe('conversão e 1:1', () => {
  it('conversaoDeOrcamentos: o limite de 100 do Painel; sem envio, null (números c.1)', () => {
    expect(conversaoDeOrcamentos(3, 4)).toBe(100)
    expect(conversaoDeOrcamentos(3, 1)).toBe(33)
    expect(conversaoDeOrcamentos(0, 2)).toBeNull()
    fc.assert(
      fc.property(fc.nat(10_000), fc.nat(10_000), (e, f) => {
        const c = conversaoDeOrcamentos(e, f)
        if (e === 0) expect(c).toBeNull()
        else expect(c! >= 0 && c! <= 100 && Number.isInteger(c)).toBe(true)
      }),
    )
  })

  it('umAUmEmDia: conversa de ficha inativa não entra; sem ficha ativa, null', () => {
    expect(umAUmEmDia(['a', 'b', 'c', 'd'], ['a', 'b', 'x'])).toBe(50)
    expect(umAUmEmDia([], ['a'])).toBeNull()
    expect(umAUmEmDia(['a'], ['a', 'a'])).toBe(100)
  })
})

describe('permissões de indicadores (I-32, I-33)', () => {
  it('perms-sem-dependencia-em-cadeia: nenhuma chave depende de outra que tem dependência própria (appsec C4)', () => {
    const dep = new Map<string, string | undefined>(PERMS.map((p) => [p[1], p[4]]))
    for (const [, chave, , , d] of PERMS) {
      if (d === undefined) continue
      expect(dep.get(d), `${chave} → ${d} → ${dep.get(d)}: temPerm não resolve cadeia`).toBeUndefined()
    }
    expect(dep.get('indicadores.gerir')).toBe('indicadores')
    expect(dep.get('indicadores')).toBeUndefined()
  })

  it('indicadores.gerir sem indicadores não vale', () => {
    const perfis: Perfil[] = [{ id: 'p', nome: 'x', perms: ['indicadores.gerir'] }]
    expect(temPerm({ admin: false, perfilId: 'p' }, perfis, 'indicadores.gerir')).toBe(false)
  })

  it('pf_sup recebe as duas chaves; os outros perfis padrão, não', () => {
    const p = perfisPadrao()
    expect(p.find((x) => x.id === 'pf_sup')!.perms).toEqual(expect.arrayContaining(['indicadores', 'indicadores.gerir']))
    for (const x of p.filter((y) => y.id !== 'pf_sup')) expect(x.perms).not.toContain('indicadores')
  })

  it('exigeValoresParaEscrever: só reais (appsec C3)', () => {
    expect(UNIDADES_DE_KPI.filter(exigeValoresParaEscrever)).toEqual(['reais'])
    const perfis: Perfil[] = [{ id: 'g', nome: 'g', perms: ['indicadores', 'indicadores.gerir'] }]
    const u = { admin: false, perfilId: 'g' }
    expect(podeEscreverNaUnidade(u, perfis, 'reais')).toBe(false)
    expect(podeEscreverNaUnidade(u, perfis, 'percentual')).toBe(true)
    const comValores: Perfil[] = [{ id: 'g', nome: 'g', perms: ['indicadores', 'indicadores.gerir', 'valores'] }]
    expect(podeEscreverNaUnidade(u, comValores, 'reais')).toBe(true)
  })

  it('podeLancar: só KPI manual, vivo, e a responsável (ou a gestão) — appsec C1', () => {
    const semNada: Perfil[] = [{ id: 'r', nome: 'r', perms: [] }]
    const ana = { admin: false, perfilId: 'r', pessoaId: 'ana' }
    const bia = { admin: false, perfilId: 'r', pessoaId: 'bia' }
    const manual = { origem: 'manual' as const, arquivado: false, responsavelId: 'ana' }
    expect(podeLancar(ana, semNada, manual)).toBe('pode')
    // Trocou a responsável: a antiga perde, a nova ganha.
    expect(podeLancar(ana, semNada, { ...manual, responsavelId: 'bia' })).toBe('nao_e_responsavel')
    expect(podeLancar(bia, semNada, { ...manual, responsavelId: 'bia' })).toBe('pode')
    expect(podeLancar(ana, semNada, { ...manual, origem: 'catalogo' })).toBe('kpi_de_catalogo')
    expect(podeLancar(ana, semNada, { ...manual, arquivado: true })).toBe('kpi_arquivado')
    expect(podeLancar(null, semNada, manual)).toBe('nao_e_responsavel')
    const gestao: Perfil[] = [{ id: 'r', nome: 'r', perms: ['indicadores', 'indicadores.gerir'] }]
    expect(podeLancar(bia, gestao, manual)).toBe('pode')
    // `indicadores` sozinho não lança o KPI de outra pessoa.
    expect(podeLancar(bia, [{ id: 'r', nome: 'r', perms: ['indicadores'] }], manual)).toBe('nao_e_responsavel')
  })

  it('emDinheiro está em CAMPOS_MONETARIOS; emNumero, percentualDaMeta e escala não', () => {
    expect(CAMPOS_MONETARIOS).toContain('emDinheiro')
    for (const c of ['emNumero', 'percentualDaMeta', 'escala']) expect(CAMPOS_MONETARIOS as readonly string[]).not.toContain(c)
    // A forma de ValorNaTela só tem um nome que carrega reais.
    const v = valorNaTela('reais', NumeroDoKpi.de('reais', 1n))
    const monetarios = Object.keys(v).filter((k) => (CAMPOS_MONETARIOS as readonly string[]).includes(k))
    expect(monetarios).toEqual(['emDinheiro'])
  })
})
