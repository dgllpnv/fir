import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { conferirAlvoDeProducao, conferir, executarCarga, relatorioDaCarga, reduzir, validarDestino, type ClienteSql, type ResultadoDaCarga } from '../infra/migracao-supabase/banco'
import {
  dataCivil,
  ErroDeDump,
  escalar,
  idDe,
  LiteralNumerico,
  lerDumpDeTexto,
  lerListaDeExclusao,
  metasParaDecisaoCsv,
  planejar,
  relatorioDoPlano,
  retirarDoDump,
  segundaDaSemanaIso,
  uuidV5,
  type Dump,
  type Registro,
} from '../infra/migracao-supabase/nucleo'

/**
 * Migração do Supabase (carteira da Firmare). Ensaio com Postgres LOCAL real e
 * dados 100% SINTÉTICOS, gerados aqui com a mesma forma do dump. O repositório é
 * público: nenhum valor de dado real existe neste arquivo, e as "sentinelas"
 * abaixo existem só para provar que nada do dado vaza em relatório ou erro.
 */
const URL_MIG =
  process.env['DATABASE_URL_MIGRATE'] ?? 'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir'

let p = randomBytes(4).toString('hex')
const p1 = p
const S = (x: string): string => `Sentinela ${x} ${p}`
// 14 dígitos únicos por execução (não colide com cliente de outro teste)
const cnpj = (n: number): string => `9${p.replace(/[a-f]/g, '1')}${String(n).padStart(5, '0')}`.slice(0, 14).padEnd(14, '7')

/** Número JSON escrito como literal: a mesma forma que o jsonb do Supabase devolve. */
const N = (x: string | number): string => `__N:${x}__`

function csvDe(dado: unknown): string {
  const json = JSON.stringify(dado).replace(/"__N:([^"]+)__"/g, '$1')
  return `dump\r\n"${json.replace(/"/g, '""')}"`
}

const reg = (colecao: string, id: string, data: Record<string, unknown>, cliente_id: string | null = null) => ({
  id, colecao, cliente_id, atualizado_em: '2026-11-01T00:00:00Z', atualizado_por: 'x', data,
})

function dumpSintetico(): { csv: string; docs: Record<string, unknown>[] } {
  const c = (n: number): string => `${p}-c${n}`
  const clienteBase = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: c(n), nome: S(`Cliente ${n}`), produto: 'Gestão por Assinatura', status: 'ativo', cnpj: n === 1 ? '' : cnpj(n),
    email: `s${n}-${p}@exemplo.invalid`, telefone: `7199${p.slice(0, 4).replace(/\D/g, '1')}${n}`, saude: 'bom', cidade: S('Cidade'),
    segmento: '', projeto: '', pagador: '', area_foco: 'Gestão', servicos: ['semanal', 'dre', 'outro'], criado_em: '2026-10-27',
    data_inicio: '2026-06-19', data_fim: '2026-12-23', cliente_desde: '', dia_reuniao: '', link_painel: '', link_rotina: '',
    link_dash_fin: '', link_dash_ind: '', link_planilha: `https://docs.google.com/spreadsheets/d/${(p + String(n)).repeat(4).slice(0, 30)}/edit`,
    observacoes: '', responsavel: S('Decisora'), colaboradora_id: 'u1', codigo_rotina: `cod${n}`, nascimento_responsavel: n === 2 ? '1990-01-01' : '',
    resp_comercial: S('Parceira'), resp_comercial_tel: '71999990000', form_comercial: 'https://forms.exemplo.invalid/x',
    resp_financeiro: '', resp_financeiro_tel: '', form_financeiro: '', resp_marketing: '', resp_marketing_tel: '', form_marketing: '',
    resp_trafego: '', resp_trafego_tel: '', form_trafego: '', ...extra,
  })
  const docs: Record<string, unknown>[] = [
    reg('clientes', c(1), clienteBase(1, { migrado: true })),
    reg('clientes', c(2), clienteBase(2)),
    reg('clientes', c(3), clienteBase(3, { produto: 'Acelerador FIR' })),
    reg('clientes_fin', c(1), { valor_mensal: N(3500), dia_vencimento: N(5), telefone_financeiro: '71988880000', pagamentos: { '2026-10': 'texto-livre' } }),
    reg('clientes_fin', c(2), { valor_mensal: N(2800), dia_vencimento: N(15), telefone_financeiro: '', pagamentos: {} }),
    reg('clientes_fin', c(3), { valor_mensal: N(5596), dia_vencimento: N(31), telefone_financeiro: '', pagamentos: { '2026-11': 'x' } }),
    reg('rotinas', `${p}-r1`, { titulo: S('Rotina mensal'), frequencia: 'mensal', dia_util: N(3), inicio: '2026-11-03', prioridade: 'normal', por_cliente: 'cada', frentes: 'nao', envio: 'nao', passos: ['a', 'b'], servico: 'dre', mensagem: 'dre', responsavel_id: 'u2', ativa: true, antecedencia: N(0), dia_semana: '' }),
    reg('rotinas', `${p}-r2`, { titulo: S('Rotina semanal'), frequencia: 'semanal', dia_semana: '5', inicio: '2026-10-23', prioridade: 'alta', por_cliente: 'nao', frentes: 'nao', passos: [], servico: '', mensagem: '', responsavel_id: 'u1', ativa: true, dia_util: N(0), antecedencia: N(3) }),
    reg('rotinas', `${p}-r3`, { titulo: S('Rotina que o banco recusa'), frequencia: 'mensal', dia_util: N(1), inicio: '2026-11-03', prioridade: 'normal', por_cliente: 'nao', frentes: 'nao', envio: 'sim', passos: [], ativa: true }),
    reg('tarefas', `${p}-t1`, { titulo: S('Tarefa global'), descricao: '', cliente_id: '', prazo: '2026-11-09', status: 'pendente', prioridade: 'normal', recorrencia: 'nenhuma', concluida_em: '', responsavel_id: 'u1', solicitante_id: 'u1', msg: '' }, null),
    reg('tarefas', `${p}-t2`, { titulo: S('Tarefa com itens'), descricao: S('detalhe'), cliente_id: c(1), prazo: '2026-11-13', status: 'pendente', prioridade: 'alta', recorrencia: 'semanal', concluida_em: '', rotina_id: `${p}-r1`, msg: 'semanal', itens: [{ id: 'i1', feito: false, texto: S('item 1'), frente: 'comercial', manual: true }, { id: 'i2', feito: true, texto: S('item 2'), frente: '', manual: false }], solicitante_id: 'u1', responsavel_id: 'u3' }, c(1)),
    reg('tarefas', `${p}-t3`, { titulo: S('Checklist do contrato'), descricao: '', cliente_id: c(2), prazo: '2026-11-16', status: 'concluida', prioridade: 'normal', recorrencia: 'nenhuma', concluida_em: '2026-11-01', checklist: true, contrato: 'K1', acao: 'a', item_id: 'z', ordem: N(1), responsavel_id: 'u1', solicitante_id: 'u1' }, c(2)),
    reg('tarefas', `${p}-t4`, { titulo: S('Pagamento'), descricao: '', cliente_id: c(3), prazo: '2026-11-20', status: 'pendente', prioridade: 'normal', recorrencia: 'nenhuma', concluida_em: '', msg: 'pagamento', vencimento: '2026-11-23', responsavel_id: 'u1', solicitante_id: 'u1' }, c(3)),
    // órfã: aponta para cliente que não existe em `clientes` (P-17)
    reg('tarefas', `${p}-t5`, { titulo: S('Tarefa órfã'), descricao: '', cliente_id: `${p}-ausente`, prazo: '2026-11-09', status: 'pendente', prioridade: 'normal', recorrencia: 'nenhuma', concluida_em: '', responsavel_id: 'u1', solicitante_id: 'u1' }, `${p}-ausente`),
    reg('metas', `${p}-m1`, { titulo: S('Meta em reais'), indicador: S('Faturamento'), unidade: 'R$', sentido: 'maior_melhor', tipo: 'mensal', agregacao: 'soma', fonte: '', status: 'em_andamento', inicio: '2026-11-02', prazo: '2026-11-30', valor_meta: N(31000), valor_inicial: N(0), valor_atual: null }, c(1)),
    reg('metas', `${p}-m2`, { titulo: S('Meta em unidades A'), indicador: S('Reunioes'), unidade: 'un', sentido: 'maior_melhor', tipo: 'mensal', agregacao: 'soma', fonte: '', status: 'em_andamento', inicio: '2026-11-02', prazo: '2026-11-30', valor_meta: N(10), valor_inicial: null, valor_atual: null }, c(1)),
    // mesmo texto de indicador, outra meta: cada meta mantém os seus check-ins
    reg('metas', `${p}-m3`, { titulo: S('Meta em unidades B'), indicador: S('Reunioes'), unidade: 'un', sentido: 'maior_melhor', tipo: 'mensal', agregacao: 'soma', fonte: '', status: 'em_andamento', inicio: '2026-11-02', prazo: '2026-11-30', valor_meta: N(20), valor_inicial: N(1), valor_atual: null }, c(1)),
    reg('metas', `${p}-m4`, { titulo: S('Meta percentual somada'), indicador: S('Conversao'), unidade: '%', sentido: 'maior_melhor', tipo: 'mensal', agregacao: 'soma', fonte: '', status: 'em_andamento', inicio: '2026-11-02', prazo: '2026-11-30', valor_meta: N(100), valor_inicial: null, valor_atual: null }, c(2)),
    reg('metas', `${p}-m5`, { titulo: S('Meta percentual media'), indicador: S('Taxa'), unidade: '%', sentido: 'maior_melhor', tipo: 'mensal', agregacao: 'media', fonte: '', status: 'em_andamento', inicio: '2026-11-02', prazo: '2026-11-30', valor_meta: N('12.5'), valor_inicial: null, valor_atual: null }, c(2)),
    reg('checkins', `${p}-k1`, { meta_id: `${p}-m1`, semana: '2026-11-02', valor: N('1250.5'), por: 'u1', criado_em: '2026-11-03' }),
    reg('checkins', `${p}-k2`, { meta_id: `${p}-m2`, semana: '2026-11-02', valor: N(5), por: 'u2', criado_em: '2026-11-03' }),
    reg('checkins', `${p}-k3`, { meta_id: `${p}-m3`, semana: '2026-11-02', valor: N(12), por: 'u2', criado_em: '2026-11-03' }),
    reg('checkins', `${p}-k4`, { meta_id: `${p}-m4`, semana: '2026-11-02', valor: N(17), por: 'u2', criado_em: '2026-11-03' }),
    reg('checkins', `${p}-k5`, { meta_id: `${p}-m5`, semana: '2026-W45', valor: N('7.25'), por: 'u2', criado_em: '2026-11-03' }),
    reg('reunioes', `${p}-re1`, { data: '2026-06-30', tipo: 'importada', resumo: S('ata importada'), asana_id: `as${p}`, participantes: '', encaminhamentos: '', saude_registrada: '', compartilhar: true, registrada_por: 'u1', anexos: [] }, c(1)),
    reg('reunioes', `${p}-re2`, { data: '2026-11-03', tipo: 'semanal', resumo: S('ata semanal'), participantes: S('pessoas'), encaminhamentos: S('fazer'), saude_registrada: 'bom', registrada_por: 'u9', anexos: [] }, c(2)),
    reg('materiais', `${p}-ma1`, { titulo: S('Material do cliente'), tipo: 'Planilha', link: 'https://exemplo.invalid/m', texto: '', descricao: '', programas: ['Gestão'], cliente: S('Cliente 1'), cliente_id: c(1), criado_em: '2026-11-01' }, c(1)),
    reg('materiais', `${p}-ma2`, { titulo: S('Material da biblioteca'), tipo: 'Script', link: '', texto: S('corpo'), descricao: '', programas: [], cliente: '', criado_em: '2026-11-01' }, null),
    reg('mensagens', `${p}-me1`, { chave: `t_${p}`, titulo: S('Mensagem'), texto: S('texto da mensagem') }),
    reg('roteiros', `${p}-ro1`, { id: `${p}-ro1`, chave: `r_${p}`, titulo: S('Roteiro'), quando: S('quando'), mensagem: S('msg'), passos: ['x'] }),
    reg('diagnosticos', `${p}-d1`, { titulo: S('Diagnostico'), status: 'x' }, c(1)),
    reg('transcricoes', `${p}-tr1`, { texto: S('transcricao') }),
    reg('config', 'cfg', { pix: S('chave pix'), favorecido: S('favorecido') }),
    reg('perfis', `${p}-pf1`, { nome: S('Perfil'), papel: 'admin', valores: true, user_id: 'x' }),
  ]
  return { csv: csvDe({ registros: docs, historico: [{}, {}], acessos_cliente: [{}], auth_users: [{}, {}, {}], storage_objects: [{}] }), docs }
}

const SENTINELAS = [p, 'Sentinela', 'exemplo.invalid', '71999990000', '71988880000', 'docs.google.com', cnpj(2), cnpj(3)]

let migrate: pg.Client
let grupoId: string
let cargaId: string
let sint: ReturnType<typeof dumpSintetico>
let dump: Dump
const execucoes: ResultadoDaCarga[] = []
const impressoes: string[] = []
const completos: string[] = []
const contagens: Record<string, number>[] = []
const impressoes2: string[] = []

const TABELAS_DO_GRUPO = ['itens_de_tarefa_interna', 'tarefas_internas', 'lancamentos_de_indicador', 'metas_comerciais', 'indicadores_carteira', 'reunioes_comerciais', 'materiais_carteira', 'planilhas_do_cliente', 'parceiros_do_cliente', 'rotinas_internas', 'clientes_carteira']

async function contar(): Promise<Record<string, number>> {
  const o: Record<string, number> = {}
  for (const t of TABELAS_DO_GRUPO) {
    o[t] = Number((await migrate.query(`SELECT count(*)::int AS n FROM ${t} WHERE grupo_id = $1`, [grupoId])).rows[0]!['n'])
  }
  o['materiais_da_biblioteca'] = Number((await migrate.query('SELECT count(*)::int AS n FROM materiais_da_biblioteca WHERE criado_por = $1', [cargaId])).rows[0]!['n'])
  o['mensagens_comerciais'] = Number((await migrate.query('SELECT count(*)::int AS n FROM mensagens_comerciais WHERE criado_por = $1', [cargaId])).rows[0]!['n'])
  o['roteiros_comerciais'] = Number((await migrate.query('SELECT count(*)::int AS n FROM roteiros_comerciais WHERE criado_por = $1', [cargaId])).rows[0]!['n'])
  return o
}

beforeAll(async () => {
  migrate = new pg.Client({ connectionString: URL_MIG })
  migrate.on('error', () => undefined)
  await migrate.connect()
  await migrate.query(`SELECT set_config('app.pessoa_id', 'sistema', false)`)
  grupoId = (await migrate.query(`INSERT INTO grupos (nome) VALUES ($1) RETURNING id::text AS id`, [`Grupo migracao-supabase ${p}`])).rows[0]!['id'] as string
  cargaId = (
    await migrate.query(
      `INSERT INTO usuarios_gestao (usuario, nome, senha_hash, escopo, ativo) VALUES ($1, 'Carga do sistema anterior', '!', 'geral', false) RETURNING id::text AS id`,
      [`carga.${p}`],
    )
  ).rows[0]!['id'] as string
  sint = dumpSintetico()
  dump = lerDumpDeTexto(sint.csv)
  for (let i = 0; i < 3; i++) {
    const r = await executarCarga(migrate, dump, { grupoId, usuarioCargaId: cargaId })
    execucoes.push(r)
    impressoes.push([...relatorioDoPlano(r.plano), ...relatorioDaCarga(r)].join('\n'))
    completos.push([...relatorioDoPlano(r.plano, true), ...relatorioDaCarga(r, true)].join('\n'))
    contagens.push(await contar())
  }
  impressoes2.push(...impressoes)
})

const gruposExtras: string[] = []

afterAll(async () => {
  if (!migrate) return
  const apagar = async (sql: string, v: unknown[]): Promise<void> => {
    await migrate.query(sql, v).catch(() => undefined)
  }
  for (const g of [grupoId, ...gruposExtras]) for (const t of TABELAS_DO_GRUPO) await apagar(`DELETE FROM ${t} WHERE grupo_id = $1`, [g])
  for (const g of gruposExtras) await apagar('DELETE FROM grupos WHERE id = $1', [g])
  await apagar('DELETE FROM materiais_da_biblioteca WHERE criado_por = $1', [cargaId])
  await apagar('DELETE FROM mensagens_comerciais WHERE criado_por = $1', [cargaId])
  await apagar('DELETE FROM roteiros_comerciais WHERE criado_por = $1', [cargaId])
  await apagar('DELETE FROM usuarios_gestao WHERE id = $1', [cargaId])
  await apagar('DELETE FROM grupos WHERE id = $1', [grupoId])
  await migrate.end()
})

describe('uuid v5 determinístico (§2.1)', () => {
  it('bate com o vetor conhecido da RFC 4122 (namespace DNS, python.org)', () => {
    expect(uuidV5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
  })
  it('é determinístico e o prefixo da coleção evita colisão entre coleções', () => {
    expect(idDe('tarefas', 'x')).toBe(idDe('tarefas', 'x'))
    expect(idDe('tarefas', 'x')).not.toBe(idDe('reunioes', 'x'))
    const ids = new Set<string>()
    for (const c of ['tarefas', 'reunioes', 'metas', 'clientes']) for (let i = 0; i < 200; i++) ids.add(idDe(c, `id-${i}`))
    expect(ids.size).toBe(800)
    expect([...ids].every((u) => /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(u))).toBe(true)
  })
})

describe('dinheiro: pelos dígitos, em BigInt (regra 1)', () => {
  it('reais inteiros e decimais viram centavos exatos, para qualquer par (reais, centavos)', () => {
    for (let i = 0; i < 2000; i++) {
      const reais = BigInt(Math.floor(Math.random() * 10 ** 9))
      const cent = Math.floor(Math.random() * 100)
      const r = escalar(`${reais}.${String(cent).padStart(2, '0')}`, 2)
      expect(r).toEqual({ valor: reais * 100n + BigInt(cent), arredondou: false })
      expect(escalar(`${reais}`, 2)).toEqual({ valor: reais * 100n, arredondou: false })
    }
  })
  it('mais de 2 casas arredonda meio para cima e DECLARA; negativo, fração em un e lixo são erro', () => {
    expect(escalar('0.125', 2)).toEqual({ valor: 13n, arredondou: true })
    expect(escalar('0.124', 2)).toEqual({ valor: 12n, arredondou: true })
    expect(escalar('1.10', 2)).toEqual({ valor: 110n, arredondou: false })
    expect(escalar('-1', 2)).toEqual({ erro: 'negativo' })
    expect(escalar('1.5', 0)).toEqual({ erro: 'fracionario' })
    expect(escalar('7.0', 0)).toEqual({ valor: 7n, arredondou: false })
    expect(escalar('1e3', 2)).toEqual({ erro: 'numero_invalido' })
  })
  it('o leitor entrega o número como TEXTO (JSON.parse o destruiria) e o planejador recusa number nativo', () => {
    const d = lerDumpDeTexto(csvDe({ registros: [reg('clientes_fin', 'f', { valor_mensal: N('12.30'), dia_vencimento: N(5) })] }))
    const v = d.registros[0]!.data['valor_mensal']
    expect(v).toBeInstanceOf(LiteralNumerico)
    expect((v as LiteralNumerico).texto).toBe('12.30') // JSON.parse daria 12.3
    const nativo: Dump = { registros: [{ id: 'c', colecao: 'clientes', clienteId: null, data: { nome: 'x', produto: 'Projeto', status: 'ativo' } }, { id: 'c', colecao: 'clientes_fin', clienteId: null, data: { valor_mensal: 12.3, dia_vencimento: 5 } }], contagens: { historico: 0, acessos_cliente: 0, auth_users: 0, storage_objects: 0 } }
    expect(() => planejar(nativo, { grupoId: 'g', usuarioCargaId: 'u', mapaUsuarios: {}, instanteDaCarga: '2026-01-01T00:00:00Z', decisoesCliente: {} })).toThrow(ErroDeDump)
  })
  it('data civil e semana ISO: AAAA-MM-DD, DD/MM/AAAA, instante no fuso da carteira, ano ISO', () => {
    expect(dataCivil('2026-11-03')).toBe('2026-11-03')
    expect(dataCivil('03/11/2026')).toBe('2026-11-03')
    expect(dataCivil('31/04/2026')).toBeNull()
    expect(dataCivil('2026-11-04T01:00:00Z')).toBe('2026-11-03') // 22h do dia 3 em Salvador
    expect(segundaDaSemanaIso('2026-W45')).toBe('2026-11-02')
    expect(segundaDaSemanaIso('2026-W01')).toBe('2025-12-29') // ano civil ≠ ano ISO
  })
})

describe('dry-run sobre dado sintético', () => {
  const opcoes = { grupoId: '00000000-0000-0000-0000-000000000000', usuarioCargaId: '00000000-0000-0000-0000-000000000000', mapaUsuarios: {}, instanteDaCarga: '2026-11-10T00:00:00Z', decisoesCliente: {} }
  it('todo documento tem destino: lidas = carregáveis + mescladas + retidas + rejeitadas + fora', () => {
    const plano = planejar(dump, opcoes)
    expect(plano.resultados.length).toBe(dump.registros.length)
    const por = (c: string, e: string): number => plano.resultados.filter((r) => r.colecao === c && r.estado === e).length
    expect(por('clientes', 'carregavel')).toBe(3)
    expect(por('clientes_fin', 'mesclado')).toBe(3)
    expect(por('tarefas', 'carregavel')).toBe(4)
    expect(por('tarefas', 'rejeitado')).toBe(1)
    expect(por('rotinas', 'carregavel')).toBe(2)
    expect(por('rotinas', 'rejeitado')).toBe(1)
    expect(['diagnosticos', 'transcricoes', 'config', 'perfis'].every((c) => plano.resultados.filter((r) => r.colecao === c).every((r) => r.estado === 'fora'))).toBe(true)
  })
  it('alvos: mensalidade em centavos inteiros, soma exata e check-ins por meta', () => {
    const plano = planejar(dump, opcoes)
    expect(plano.alvos.mrrCentavosTotalLido).toBe((3500n + 2800n + 5596n) * 100n)
    expect(plano.alvos.arredondamentos).toBe(0)
    expect(plano.alvos.checkinsPorMeta[`${p}-m1`]).toBe(125050n) // 1250.50 reais
    expect(plano.alvos.checkinsPorMeta[`${p}-m5`]).toBe(725n) // 7.25 % = 725 centésimos
  })
  it('lembrete repetido na origem (mesma rotina, cliente e competência): a concluída vence e a repetida é rejeitada com motivo', () => {
    const t = (id: string, status: string): Registro => ({
      id, colecao: 'tarefas', clienteId: `${p}-c3`,
      data: { titulo: S(`Lembrete ${id}`), descricao: '', cliente_id: `${p}-c3`, prazo: '2026-11-20', status, prioridade: 'normal', recorrencia: 'nenhuma', concluida_em: status === 'concluida' ? '2026-11-21' : '', rotina_id: `${p}-r1`, msg: 'pagamento', vencimento: '2026-11-23', responsavel_id: 'u1', solicitante_id: 'u1' },
    })
    const plano = planejar({ ...dump, registros: [...dump.registros, t(`${p}-d1`, 'pendente'), t(`${p}-d2`, 'concluida')] }, opcoes)
    const e = (id: string) => plano.resultados.find((r) => r.colecao === 'tarefas' && r.idOrigem === id)
    expect(e(`${p}-d2`)?.estado).toBe('carregavel')
    expect(e(`${p}-d1`)?.estado).toBe('rejeitado')
    expect(e(`${p}-d1`)?.motivo).toBe('tarefa_repetida_na_origem_mesma_rotina_cliente_competencia')
  })
  it('% com soma é rejeitada (a regra do domínio), e meta e check-in dela caem juntos, com motivo', () => {
    const plano = planejar(dump, opcoes)
    expect(plano.resultados.find((r) => r.colecao === 'metas' && r.idOrigem === `${p}-m4`)?.motivo).toBe('percentual_com_soma')
    expect(plano.resultados.find((r) => r.colecao === 'checkins' && r.idOrigem === `${p}-k4`)?.motivo).toBe('meta_nao_carregavel')
  })
})

describe('--producao: as travas de quem digita (túnel SSH até a VPS)', () => {
  it('recusa sem repetir o nome do banco, ou com nome diferente', () => {
    expect(() => conferirAlvoDeProducao({ banco: 'fir', usuario: 'migracao_carteira', confirmaBanco: undefined, incluirGlobais: false })).toThrow('producao_sem_confirmar_o_nome_do_banco')
    expect(() => conferirAlvoDeProducao({ banco: 'fir', usuario: 'migracao_carteira', confirmaBanco: 'outro', incluirGlobais: false })).toThrow('producao_sem_confirmar_o_nome_do_banco')
  })
  it('recusa conexão que não seja do papel migracao_carteira, salvo as globais do Operador', () => {
    expect(() => conferirAlvoDeProducao({ banco: 'fir', usuario: 'fir', confirmaBanco: 'fir', incluirGlobais: false })).toThrow('producao_exige_o_papel_migracao_carteira')
    expect(() => conferirAlvoDeProducao({ banco: 'fir', usuario: 'migracao_carteira', confirmaBanco: 'fir', incluirGlobais: false })).not.toThrow()
    expect(() => conferirAlvoDeProducao({ banco: 'fir', usuario: 'fir_migrate', confirmaBanco: 'fir', incluirGlobais: true })).not.toThrow()
  })
})

describe('--excluir: registros retidos para leitura da dona (decisão 4.5)', () => {
  const opcoes = { grupoId: '00000000-0000-0000-0000-000000000000', usuarioCargaId: '00000000-0000-0000-0000-000000000000', mapaUsuarios: {}, instanteDaCarga: '2026-11-10T00:00:00Z', decisoesCliente: {} }
  const alvoDe = () => dump.registros.find((r) => r.colecao === 'tarefas')!
  it('lê colecao;id, ignora cabeçalho e comentário, e recusa excluir cliente', () => {
    const alvo = alvoDe()
    const lista = lerListaDeExclusao(`﻿colecao;id;padroes\n${alvo.colecao};${alvo.id};paciente\n(comentario solto)\n\n`)
    expect(lista).toEqual([`${alvo.colecao};${alvo.id}`])
    expect(() => lerListaDeExclusao('clientes;abc123')).toThrow(ErroDeDump)
  })
  it('retira só o listado, conta, e a origem recalculada do dump continua fechando', () => {
    const alvo = alvoDe()
    const r = retirarDoDump(dump, [`${alvo.colecao};${alvo.id}`])
    expect(r.retirados).toBe(1)
    expect(r.dump.registros.length).toBe(dump.registros.length - 1)
    expect(planejar(r.dump, opcoes).resultados.length).toBe(r.dump.registros.length)
    expect(planejar(r.dump, opcoes).resultados.some((x) => x.idOrigem === alvo.id)).toBe(false)
  })
  it('id que não existe no dump é erro (um typo carregaria o registro que devia ficar fora)', () => {
    expect(() => retirarDoDump(dump, ['tarefas;nao-existe'])).toThrow('exclusao_nao_encontrada')
  })
})

describe('--aplicar: carga no Postgres local, três vezes', () => {
  it('a primeira carga grava e a conferência exata aprova (COMMIT)', () => {
    const r = execucoes[0]!
    expect(r.commitado, r.conferencia.filter((c) => !c.ok).map((c) => c.nome).join(', ')).toBe(true)
    expect(r.conferencia.every((c) => c.ok)).toBe(true)
    expect(Object.values(r.stats).reduce((a, s) => a + s.inseridas, 0)).toBeGreaterThan(20)
    expect(Object.values(r.stats).every((s) => s.colisao === 0)).toBe(true)
  })

  it('idempotência x3: a 2ª e a 3ª não criam NADA e as tabelas ficam idênticas', () => {
    for (const i of [1, 2]) {
      const r = execucoes[i]!
      expect(r.commitado).toBe(true)
      expect(Object.values(r.stats).reduce((a, s) => a + s.inseridas, 0)).toBe(0)
      expect(Object.values(r.stats).reduce((a, s) => a + s.jaExistia + s.jaExistiaPorChave, 0)).toBeGreaterThan(20)
      expect(contagens[i]).toEqual(contagens[0])
    }
  })

  it('rejeição dos órfãos: a tarefa do cliente ausente NÃO entra e nenhum cliente é criado para ela', async () => {
    const t = await migrate.query('SELECT count(*)::int AS n FROM tarefas_internas WHERE id = $1', [idDe('tarefas', `${p}-t5`)])
    expect(t.rows[0]!['n']).toBe(0)
    const c = await migrate.query('SELECT count(*)::int AS n FROM clientes_carteira WHERE id = $1 OR nome LIKE $2', [idDe('clientes', `${p}-ausente`), `%ausente%${p}%`])
    expect(c.rows[0]!['n']).toBe(0)
    const motivo = execucoes[0]!.plano.resultados.find((r) => r.idOrigem === `${p}-t5`)
    expect(motivo).toMatchObject({ estado: 'rejeitado', motivo: 'cliente_ausente_em_clientes' })
    expect(execucoes[0]!.pendencias).toContain('rejeitado:tarefas:cliente_ausente_em_clientes')
    // as 3 tarefas válidas de cliente + 1 global entram
    expect(contagens[0]!['tarefas_internas']).toBe(4)
  })

  it('dinheiro: mensalidade em centavos bigint inteiros, soma exata, e a carga NÃO gera receita (P-18)', async () => {
    const col = await migrate.query(`SELECT data_type FROM information_schema.columns WHERE table_name = 'clientes_carteira' AND column_name = 'mensalidade_centavos'`)
    expect(col.rows[0]!['data_type']).toBe('bigint')
    const ids = [1, 2, 3].map((n) => idDe('clientes', `${p}-c${n}`))
    const r = await migrate.query('SELECT id::text AS id, mensalidade_centavos::text AS m, dia_vencimento FROM clientes_carteira WHERE id = ANY($1::uuid[])', [ids])
    const por = new Map(r.rows.map((x) => [String(x['id']), String(x['m'])]))
    expect(por.get(ids[0]!)).toBe(String(3500n * 100n))
    expect(por.get(ids[1]!)).toBe(String(2800n * 100n))
    expect(por.get(ids[2]!)).toBe(String(5596n * 100n))
    const soma = await migrate.query('SELECT sum(mensalidade_centavos)::text AS s FROM clientes_carteira WHERE id = ANY($1::uuid[])', [ids])
    expect(soma.rows[0]!['s']).toBe(String((3500n + 2800n + 5596n) * 100n))
    expect(r.rows.find((x) => x['id'] === ids[2])!['dia_vencimento']).toBe(31)
    const cob = await migrate.query('SELECT count(*)::int AS n FROM cobrancas_do_cliente_firmare WHERE cliente_carteira_id = ANY($1::uuid[])', [ids])
    expect(cob.rows[0]!['n']).toBe(0)
    // check-in em R$: 1250.50 reais = 125050 centavos; % em centésimos: 7.25 = 725
    const l = await migrate.query('SELECT valor_centavos::text AS c, valor_inteiro::text AS i FROM lancamentos_de_indicador WHERE id = ANY($1::uuid[]) ORDER BY referencia, valor_inteiro NULLS FIRST', [[idDe('checkins', `${p}-k1`), idDe('checkins', `${p}-k5`)]])
    expect(l.rows.map((x) => `${String(x['c'])}/${String(x['i'])}`).sort()).toEqual(['125050/null', 'null/725'])
  })

  it('conversões declaradas: rotinas desligadas, ata importada não compartilhada, ano do aniversário descartado, materiais da biblioteca internos', async () => {
    const rot = await migrate.query('SELECT count(*) FILTER (WHERE ativa)::int AS ativas, count(*)::int AS n FROM rotinas_internas WHERE grupo_id = $1', [grupoId])
    expect(rot.rows[0]).toEqual({ ativas: 0, n: 2 })
    const re = await migrate.query('SELECT count(*) FILTER (WHERE compartilhada)::int AS n FROM reunioes_comerciais WHERE grupo_id = $1', [grupoId])
    expect(re.rows[0]!['n']).toBe(0)
    const an = await migrate.query('SELECT aniversario_decisor_dia, aniversario_decisor_mes FROM clientes_carteira WHERE id = $1', [idDe('clientes', `${p}-c2`)])
    expect(an.rows[0]).toEqual({ aniversario_decisor_dia: 1, aniversario_decisor_mes: 1 })
    const bib = await migrate.query('SELECT uso_interno FROM materiais_da_biblioteca WHERE criado_por = $1', [cargaId])
    expect(bib.rows).toEqual([{ uso_interno: true }])
    // competência só na tarefa de pagamento (inequívoca)
    const tp = await migrate.query('SELECT vencimento::text AS v, competencia::text AS c FROM tarefas_internas WHERE id = $1', [idDe('tarefas', `${p}-t4`)])
    expect(tp.rows[0]).toEqual({ v: '2026-11-23', c: '2026-11-01' })
    // cada meta tem o seu indicador (mesmo texto de indicador não funde o realizado)
    const ind = await migrate.query('SELECT count(DISTINCT indicador_id)::int AS n FROM metas_comerciais WHERE grupo_id = $1', [grupoId])
    expect(ind.rows[0]!['n']).toBe(4)
  })

  it('a conferência REPROVA quando o destino diverge de um único registro', async () => {
    const r = execucoes[0]!
    await migrate.query('BEGIN')
    try {
      await migrate.query(`SELECT set_config('app.pessoa_id', 'sistema', true)`)
      await migrate.query(`UPDATE tarefas_internas SET titulo = 'alterado' WHERE id = $1`, [idDe('tarefas', `${p}-t1`)])
      await migrate.query(`UPDATE clientes_carteira SET mensalidade_centavos = mensalidade_centavos + 1 WHERE id = $1`, [idDe('clientes', `${p}-c1`)])
      const c = await conferir(migrate, dump, r.plano, r.stats, { grupoId, resultadoPorId: r.resultadoPorId })
      const reprovadas = c.filter((x) => !x.ok).map((x) => x.nome)
      expect(reprovadas).toContain('hash_de_conteudo:tarefas_internas')
      expect(reprovadas).toContain('mensalidade_total_em_centavos')
    } finally {
      await migrate.query('ROLLBACK')
    }
  })

  it('nada vaza: relatório e erro não carregam nome, e-mail, telefone, CNPJ, link nem texto do dado', () => {
    const tudo = impressoes2.join('\n')
    for (const s of SENTINELAS) expect(tudo.includes(s), `vazou ${s.slice(0, 4)}…`).toBe(false)
    // erro do pg com `detail` (que traz o valor da linha) sai só como código + restrição
    const erro = reduzir(Object.assign(new Error('Key (nome)=(Sentinela segredo) already exists'), { code: '23505', constraint: 'uma_restricao', detail: 'Key (nome)=(Sentinela segredo)' }), 'tarefas_internas')
    expect(erro.message).toBe('erro_de_carga:23505:uma_restricao:tarefas_internas')
    expect(erro.message.includes('Sentinela')).toBe(false)
  })
})

describe('correspondência de clientes (P-19): relatório, nunca fusão', () => {
  it('cliente com CNPJ igual ao de um existente é RETIDO sem aprovação; com aprovação aponta para o existente e NÃO o altera nem o duplica', async () => {
    const cnpjExistente = cnpj(77)
    const existente = (
      await migrate.query(`INSERT INTO clientes_carteira (grupo_id, nome, produto, cnpj) VALUES ($1, $2, 'Projeto', $3) RETURNING id::text AS id`, [grupoId, `Existente ${p}`, cnpjExistente])
    ).rows[0]!['id'] as string
    const antes = (await migrate.query('SELECT md5(t::text) AS h FROM clientes_carteira t WHERE id = $1', [existente])).rows[0]!['h']
    const csv = csvDe({
      registros: [
        reg('clientes', `${p}-x1`, { id: `${p}-x1`, nome: `Outro nome ${p}`, produto: 'Projeto', status: 'ativo', cnpj: cnpjExistente.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'), servicos: [] }),
        reg('clientes_fin', `${p}-x1`, { valor_mensal: N(1000), dia_vencimento: N(10), telefone_financeiro: '', pagamentos: {} }),
        reg('reunioes', `${p}-xr1`, { data: '2026-11-03', tipo: 'extra', resumo: S('ata do cliente retido'), registrada_por: 'u1' }, `${p}-x1`),
      ],
    })
    const d = lerDumpDeTexto(csv)
    const sem = await executarCarga(migrate, d, { grupoId, usuarioCargaId: cargaId })
    expect(sem.candidatos).toEqual([{ origemId: `${p}-x1`, existenteId: existente, por: 'cnpj' }])
    expect(sem.plano.resultados.filter((r) => r.estado === 'retido').map((r) => r.colecao).sort()).toEqual(['clientes', 'clientes_fin', 'reunioes'])
    expect((await migrate.query('SELECT count(*)::int AS n FROM clientes_carteira WHERE id = $1', [idDe('clientes', `${p}-x1`)])).rows[0]!['n']).toBe(0)
    expect((await migrate.query('SELECT count(*)::int AS n FROM reunioes_comerciais WHERE id = $1', [idDe('reunioes', `${p}-xr1`)])).rows[0]!['n']).toBe(0)

    const com = await executarCarga(migrate, d, { grupoId, usuarioCargaId: cargaId, aprovacoes: { [`${p}-x1`]: `EXISTENTE:${existente}` } })
    expect(com.commitado).toBe(true)
    const re = await migrate.query('SELECT cliente_carteira_id::text AS c FROM reunioes_comerciais WHERE id = $1', [idDe('reunioes', `${p}-xr1`)])
    expect(re.rows[0]!['c']).toBe(existente)
    expect((await migrate.query('SELECT count(*)::int AS n FROM clientes_carteira WHERE id = $1', [idDe('clientes', `${p}-x1`)])).rows[0]!['n']).toBe(0)
    expect((await migrate.query('SELECT md5(t::text) AS h FROM clientes_carteira t WHERE id = $1', [existente])).rows[0]!['h']).toBe(antes)
  })
})

describe('recusa de host remoto', () => {
  it.each([
    'postgresql://fir_migrate:senha@db.exemplo.com:5432/fir',
    'postgresql://fir_migrate:senha@10.0.0.5:4832/fir',
    'postgresql://fir_migrate:senha@0.0.0.0:4832/fir',
    'postgresql://fir_migrate:senha@127.0.0.1.evil.com:4832/fir',
    'postgresql://fir_migrate:senha@127.0.0.1:4832/fir?host=db.exemplo.com',
    'postgresql://fir_migrate:senha@127.0.0.1:4832/fir?hostaddr=10.0.0.5',
    'postgresql:///fir',
    'mysql://u:p@127.0.0.1/fir',
    'isto não é uma url',
  ])('recusa %s', (url) => {
    expect(() => validarDestino(url)).toThrow(/destino_/)
  })
  it.each(['postgresql://u:p@127.0.0.1:4832/fir', 'postgres://u:p@localhost:4832/fir'])('aceita loopback %s', (url) => {
    expect(() => validarDestino(url)).not.toThrow()
  })
  it('a mensagem de recusa não repete a URL (senha) de volta', () => {
    try {
      validarDestino('postgresql://usuario:SENHA-SECRETA@db.exemplo.com:5432/fir')
      expect.unreachable()
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('SENHA-SECRETA')
    }
  })
})

describe('conferência, etiqueta de contrato e regras dos gates', () => {
  it('a etiqueta de contrato vai para a coluna nova; título e descrição ficam como vieram', async () => {
    const r = await migrate.query('SELECT contrato, titulo, descricao FROM tarefas_internas WHERE id = ANY($1::uuid[]) ORDER BY titulo', [[idDe('tarefas', `${p1}-t2`), idDe('tarefas', `${p1}-t3`)]])
    const t3 = r.rows.find((x) => String(x['titulo']).includes('Checklist'))!
    expect(t3['contrato']).toBe('K1')
    expect(t3['titulo']).toBe(S('Checklist do contrato'))
    expect(r.rows.find((x) => String(x['titulo']).includes('itens'))!['contrato']).toBeNull()
    const n = await migrate.query("SELECT count(*)::int AS n FROM tarefas_internas WHERE grupo_id = $1 AND contrato IS NOT NULL", [grupoId])
    expect(n.rows[0]!['n']).toBe(1)
  })

  it('a equação Σorigem = Σcarregado + Σjá existia + Σrejeitado + Σfora fecha em contagem e em valor, nas 3 execuções', () => {
    for (const r of execucoes) {
      const eq = r.conferencia.filter((c) => c.nome.startsWith('equacao_'))
      expect(eq.some((c) => c.nome === 'equacao_valor:R$')).toBe(true)
      expect(eq.some((c) => c.nome.startsWith('equacao_contagem:'))).toBe(true)
      expect(eq.filter((c) => !c.ok)).toEqual([])
    }
    // 1ª execução: tudo carregado; 3ª: tudo já existia — a soma de valor é a mesma
    const v = (r: ResultadoDaCarga): string => r.conferencia.find((c) => c.nome === 'equacao_valor:R$')!.origem
    expect(v(execucoes[0]!)).toBe(v(execucoes[2]!))
  })

  it('receita = 0 e cada meta (inclusive sem check-in) confere; nenhum lançamento de abertura', async () => {
    const r = execucoes[0]!
    expect(r.conferencia.find((c) => c.nome.startsWith('cobrancas_pagas'))!.ok).toBe(true)
    expect(r.conferencia.find((c) => c.nome.startsWith('checkins_por_meta'))!.ok).toBe(true)
    // m4 (%, soma) foi rejeitada e m2/m3/m5/m1 têm 1 check-in: 4 lançamentos, nenhum a mais
    expect(contagens[0]!['lancamentos_de_indicador']).toBe(4)
  })

  it('stdout padrão não leva valor: só --saida (arquivo local) leva', () => {
    const padrao = impressoes.join('\n')
    const completo = completos.join('\n')
    for (const num of ['1189600', '350000', '125050']) {
      expect(padrao.includes(num), `${num} no relatório padrão`).toBe(false)
    }
    expect(completo.includes('1189600')).toBe(true)
    expect(padrao).toContain('[oculto')
  })

  it('o carregador não cria conta nenhuma (nem com administrar)', async () => {
    const antes = await migrate.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE administrar)::int AS a FROM usuarios_gestao')
    await executarCarga(migrate, dump, { grupoId, usuarioCargaId: cargaId })
    const depois = await migrate.query('SELECT count(*)::int AS n, count(*) FILTER (WHERE administrar)::int AS a FROM usuarios_gestao')
    expect(depois.rows[0]).toEqual(antes.rows[0])
  })

  it('advisory lock: carga concorrente no mesmo grupo é recusada, e outra tabela não foi tocada', async () => {
    const outro = new pg.Client({ connectionString: URL_MIG })
    await outro.connect()
    try {
      await outro.query('BEGIN')
      await outro.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', ['migracao-supabase-carteira', grupoId])
      await expect(executarCarga(migrate, dump, { grupoId, usuarioCargaId: cargaId })).rejects.toThrow('carga_concorrente')
      await outro.query('ROLLBACK')
      const ok = await executarCarga(migrate, dump, { grupoId, usuarioCargaId: cargaId })
      expect(ok.commitado).toBe(true)
    } finally {
      await outro.end()
    }
  })

  it('a lista de metas para decisão traz as rejeitadas por regra do domínio (só em memória aqui)', () => {
    const csv = metasParaDecisaoCsv(dump, execucoes[0]!.plano)
    expect(csv.split('\r\n')[0]).toBe('cliente,titulo,unidade,agregacao,valor_meta,valor_inicial,motivo')
    expect(csv).toContain('percentual_com_soma')
    expect(csv.trim().split('\r\n').length).toBe(2)
  })
})

const URL_PAPEL = process.env['DATABASE_URL_MIGRACAO'] ?? 'postgresql://migracao_carteira:fir_local_dev@127.0.0.1:4832/fir'

describe('papel migracao_carteira (infra/migracao-supabase/criar-papel-migracao-carteira.sql)', () => {
  let papel: pg.Client
  let grupoB: string
  let clienteA: string
  let clienteB: string

  beforeAll(async () => {
    papel = new pg.Client({ connectionString: URL_PAPEL })
    await papel.connect().catch(() => {
      throw new Error('papel migracao_carteira ausente: rode infra/migracao-supabase/criar-papel-migracao-carteira.sql')
    })
    grupoB = (await migrate.query('INSERT INTO grupos (nome) VALUES ($1) RETURNING id::text AS id', [`Grupo B migracao ${p1}`])).rows[0]!['id'] as string
    gruposExtras.push(grupoB)
    clienteA = (await migrate.query("INSERT INTO clientes_carteira (grupo_id, nome, produto) VALUES ($1, $2, 'Projeto') RETURNING id::text AS id", [grupoId, `Papel A ${p1}`])).rows[0]!['id'] as string
    clienteB = (await migrate.query("INSERT INTO clientes_carteira (grupo_id, nome, produto) VALUES ($1, $2, 'Projeto') RETURNING id::text AS id", [grupoB, `Papel B ${p1}`])).rows[0]!['id'] as string
  })
  afterAll(async () => {
    await papel?.end()
  })

  it('não é superusuário, não atravessa a RLS e não é dono de nenhuma tabela', async () => {
    const r = await migrate.query("SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, (SELECT count(*)::int FROM pg_class WHERE relowner = r.oid) AS donas FROM pg_roles r WHERE rolname = 'migracao_carteira'")
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false, donas: 0 })
  })

  it('no contexto do grupo A enxerga as linhas de A e nenhuma de B', async () => {
    await papel.query('BEGIN')
    try {
      await papel.query("SELECT set_config('app.escopo', 'grupo', true), set_config('app.grupo_id', $1, true)", [grupoId])
      const r = await papel.query('SELECT id::text AS id FROM clientes_carteira WHERE id = ANY($1::uuid[])', [[clienteA, clienteB]])
      expect(r.rows.map((x) => x['id'])).toEqual([clienteA])
    } finally {
      await papel.query('ROLLBACK')
    }
  })

  it('não consegue DELETE em nenhuma tabela que a carga escreve', async () => {
    for (const t of [...TABELAS_DO_GRUPO, 'materiais_da_biblioteca', 'mensagens_comerciais', 'roteiros_comerciais']) {
      await papel.query('BEGIN')
      try {
        await papel.query("SELECT set_config('app.escopo', 'geral', true)")
        await expect(papel.query(`DELETE FROM ${t} WHERE false`), t).rejects.toThrow(/permission denied/)
      } finally {
        await papel.query('ROLLBACK')
      }
    }
  })

  it('não é membro de fir_carteira: o GRANT dele é só SELECT/INSERT, e o BANCO recusa UPDATE e DELETE em toda tabela da carga', async () => {
    const m = await migrate.query("SELECT count(*)::int AS n FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = 'migracao_carteira')")
    expect(m.rows[0]!['n']).toBe(0)
    const tabelas = [...TABELAS_DO_GRUPO, 'materiais_da_biblioteca', 'mensagens_comerciais', 'roteiros_comerciais', 'cobrancas_do_cliente_firmare']
    for (const t of tabelas) {
      const g = await migrate.query("SELECT has_table_privilege('migracao_carteira', $1, 'UPDATE') AS u, has_table_privilege('migracao_carteira', $1, 'DELETE') AS d, has_table_privilege('migracao_carteira', $1, 'TRUNCATE') AS t", [t])
      expect(g.rows[0], t).toEqual({ u: false, d: false, t: false })
    }
    for (const t of TABELAS_DO_GRUPO) {
      await papel.query('BEGIN')
      try {
        await papel.query("SELECT set_config('app.escopo', 'geral', true)")
        await expect(papel.query(`UPDATE ${t} SET id = id WHERE false`), `UPDATE ${t}`).rejects.toThrow(/permission denied/)
      } finally {
        await papel.query('ROLLBACK')
      }
    }
  })

  it('mesmo com UPDATE/DELETE concedidos por engano, a RLS forçada não deixa tocar 1 linha (a 0074 não cria essas policies)', async () => {
    await migrate.query('GRANT UPDATE, DELETE ON clientes_carteira TO migracao_carteira')
    try {
      await papel.query('BEGIN')
      await papel.query("SELECT set_config('app.escopo', 'grupo', true), set_config('app.grupo_id', $1, true)", [grupoId])
      const u = await papel.query("UPDATE clientes_carteira SET nome = 'tocado' WHERE id = $1", [clienteA])
      const d = await papel.query('DELETE FROM clientes_carteira WHERE id = $1', [clienteA])
      expect([u.rowCount, d.rowCount]).toEqual([0, 0])
      await papel.query('ROLLBACK')
      const ainda = await migrate.query('SELECT nome FROM clientes_carteira WHERE id = $1', [clienteA])
      expect(ainda.rows[0]!['nome']).toBe(`Papel A ${p1}`)
    } finally {
      await migrate.query('REVOKE UPDATE, DELETE ON clientes_carteira FROM migracao_carteira')
    }
  })

  it('executa a carga inteira com o papel (RLS valendo), 3 vezes; globais retidas; 2ª não cria nada; nunca emite UPDATE/DELETE', async () => {
    const g = (await migrate.query('INSERT INTO grupos (nome) VALUES ($1) RETURNING id::text AS id', [`Grupo C migracao ${p1}`])).rows[0]!['id'] as string
    gruposExtras.push(g)
    const antes = p
    p = randomBytes(4).toString('hex')
    const sintC = dumpSintetico()
    SENTINELAS.push(p)
    p = antes
    const d = lerDumpDeTexto(sintC.csv)
    const emitidos: string[] = []
    const espiao: ClienteSql = {
      query: (texto, valores) => {
        emitidos.push(texto)
        return papel.query(texto, valores as unknown[] | undefined) as unknown as ReturnType<ClienteSql['query']>
      },
    }
    const r1 = await executarCarga(espiao, d, { grupoId: g, usuarioCargaId: cargaId })
    expect(r1.commitado, r1.conferencia.filter((c) => !c.ok).map((c) => c.nome).join(',')).toBe(true)
    const r2 = await executarCarga(espiao, d, { grupoId: g, usuarioCargaId: cargaId })
    const r3 = await executarCarga(espiao, d, { grupoId: g, usuarioCargaId: cargaId })
    expect(r3.commitado).toBe(true)
    expect(Object.values(r3.stats).reduce((a, s) => a + s.inseridas, 0)).toBe(0)
    expect(r2.commitado).toBe(true)
    expect(Object.values(r2.stats).reduce((a, s) => a + s.inseridas, 0)).toBe(0)
    expect(emitidos.filter((q) => /^\s*(UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i.test(q))).toEqual([])
    expect(r1.pendencias).toContain('retido:mensagens:tabela_global_exige_administrar_fora_do_papel_da_carga')
    expect(r1.stats['mensagens_comerciais']).toBeUndefined()
    expect(r1.conferencia.filter((c) => c.nome.startsWith('equacao_')).every((c) => c.ok)).toBe(true)
  })
})
