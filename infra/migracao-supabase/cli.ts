/**
 * Carregador da migração do Supabase. Veja README.md desta pasta.
 *
 *   tsx infra/migracao-supabase/cli.ts --dump <arquivo.csv>              # --dry-run (padrão)
 *   tsx infra/migracao-supabase/cli.ts --dump <arquivo.csv> --aplicar    # só em banco local
 *
 * Saída: contagens e códigos. Nunca valor, nome, telefone, e-mail ou CNPJ.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { conferirAlvoDeProducao, executarCarga, gerarCorrespondencia, relatorioDaCarga, validarDestino, ErroDeCarga, type ClienteSql } from './banco'
import { aplicarMapaDeUsuarios, conferirAlvoDaSegundaPassadaEmProducao, relatorioDoMapaDeUsuarios } from './mapa-de-usuarios'
import { ErroDeDump, lerDump, lerListaDeExclusao, metasParaDecisaoCsv, planejar, relatorioDoPlano, retirarDoDump, type Plano } from './nucleo'

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const tem = (nome: string): boolean => process.argv.includes(nome)

function json(caminho: string | undefined): Record<string, string> {
  if (!caminho) return {}
  const x: unknown = JSON.parse(readFileSync(caminho, 'utf8'))
  if (typeof x !== 'object' || x === null) throw new ErroDeCarga('json_de_apoio_invalido')
  return x as Record<string, string>
}

const RAIZ_DO_REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/** Arquivo com valor de dado só pode existir FORA do repositório (público). */
function destinoForaDoRepo(caminho: string): string {
  const c = resolve(caminho)
  if (c === RAIZ_DO_REPO || c.startsWith(RAIZ_DO_REPO + sep)) throw new ErroDeCarga('saida_dentro_do_repositorio')
  return c
}

function escreverSaidas(plano: Plano, dump: ReturnType<typeof lerDump>, completo: string[]): void {
  const saida = argumento('--saida')
  if (saida) writeFileSync(destinoForaDoRepo(saida), completo.join('\n') + '\n', 'utf8')
  const metas = argumento('--metas-para-decisao')
  if (metas) writeFileSync(destinoForaDoRepo(metas), metasParaDecisaoCsv(dump, plano), 'utf8')
}

async function conectar(): Promise<ClienteSql & { end(): Promise<void> }> {
  const url = process.env['FIR_MIGRACAO_DATABASE_URL']
  if (!url) throw new ErroDeCarga('sem_FIR_MIGRACAO_DATABASE_URL')
  validarDestino(url)
  // `pg` mora em `teste/` (o pacote que já tem a dependência); este diretório não tem node_modules.
  const requerer = createRequire(new URL('../../teste/package.json', import.meta.url))
  const pg = requerer('pg') as { Client: new (c: { connectionString: string }) => ClienteSql & { connect(): Promise<void>; end(): Promise<void> } }
  const cli = new pg.Client({ connectionString: url })
  await cli.connect()
  return cli
}

/** `--correspondencia <arquivo.json>`: SÓ LÊ (transação READ ONLY) e grava a proposta fora do repo. */
async function correspondencia(dump: ReturnType<typeof lerDump>): Promise<number> {
  const destino = argumento('--correspondencia')
  if (!destino) throw new ErroDeCarga('correspondencia_sem_arquivo')
  const saida = destinoForaDoRepo(destino)
  const cli = await conectar()
  try {
    const r = await gerarCorrespondencia(cli, dump, process.env['FIR_MIGRACAO_GRUPO'])
    writeFileSync(saida, JSON.stringify(r.propostas, null, 2) + '\n', 'utf8')
    console.log('MODO: --correspondencia (somente leitura, nada gravado no banco)')
    console.log(`clientes na origem ${r.clientes}; com candidato a correspondencia ${r.propostas.length} (por cnpj ${r.propostas.filter((p) => p.por === 'cnpj').length}, por nome ${r.propostas.filter((p) => p.por === 'nome').length}, ambiguos ${r.propostas.filter((p) => p.ambiguo).length}); sem candidato ${r.clientes - r.propostas.length} entram como NOVO`)
    console.log('proposta gravada fora do repositorio; aprovar = copiar para o JSON de FIR_MIGRACAO_CORRESPONDENCIA como "NOVO" ou "EXISTENTE:<uuid>"')
    return 0
  } finally {
    await cli.end()
  }
}

/**
 * `--aplicar-mapa-de-usuarios` (grava) / `--simular-mapa-de-usuarios` (mesma transação, sempre ROLLBACK).
 * Só preenche NULL. Atualiza, então NÃO roda com o papel `migracao_carteira`: ver README.
 */
async function mapaDeUsuarios(dump: ReturnType<typeof lerDump>): Promise<number> {
  const mapa = json(process.env['FIR_MIGRACAO_MAPA_USUARIOS'])
  const cli = await conectar()
  try {
    if (tem('--producao')) {
      const q = (await cli.query('SELECT current_database() AS banco, current_user AS usuario')).rows[0] ?? {}
      conferirAlvoDaSegundaPassadaEmProducao({
        banco: String(q['banco']),
        usuario: String(q['usuario']),
        confirmaBanco: process.env['FIR_MIGRACAO_CONFIRMA_BANCO'],
      })
    }
    const grupo = process.env['FIR_MIGRACAO_GRUPO'] ?? String((await cli.query('SELECT id::text AS id FROM grupos WHERE padrao')).rows[0]?.['id'] ?? '')
    const r = await aplicarMapaDeUsuarios(cli, dump, { grupoId: grupo, mapaUsuarios: mapa, simular: tem('--simular-mapa-de-usuarios') })
    console.log(`MODO: ${tem('--simular-mapa-de-usuarios') ? '--simular-mapa-de-usuarios' : '--aplicar-mapa-de-usuarios'}`)
    for (const l of relatorioDoMapaDeUsuarios(r)) console.log(l)
    return r.commitado || (r.simulacao && r.colunas.every((c) => c.ok)) ? 0 : 1
  } finally {
    await cli.end()
  }
}

async function principal(): Promise<number> {
  for (const f of ['--saida', '--metas-para-decisao']) {
    const v = argumento(f)
    if (v) destinoForaDoRepo(v)
  }
  const dumpCru = lerDump(argumento('--dump') ?? process.env['FIR_MIGRACAO_DUMP'] ?? '')
  const arquivoDeExclusao = argumento('--excluir')
  const retirada = arquivoDeExclusao
    ? retirarDoDump(dumpCru, lerListaDeExclusao(readFileSync(arquivoDeExclusao, 'utf8')))
    : { dump: dumpCru, retirados: 0 }
  const dump = retirada.dump
  if (arquivoDeExclusao) console.log(`RETIDOS PARA LEITURA DA DONA: ${retirada.retirados} registros fora desta carga (--excluir)`)
  if (tem('--correspondencia')) return correspondencia(dump)
  if (tem('--aplicar-mapa-de-usuarios') || tem('--simular-mapa-de-usuarios')) {
    if (tem('--aplicar') || (tem('--aplicar-mapa-de-usuarios') && tem('--simular-mapa-de-usuarios'))) throw new ErroDeCarga('modos_exclusivos')
    return mapaDeUsuarios(dump)
  }
  if (!tem('--aplicar')) {
    const p = planejar(dump, {
      grupoId: '00000000-0000-0000-0000-000000000000',
      usuarioCargaId: '00000000-0000-0000-0000-000000000000',
      mapaUsuarios: json(process.env['FIR_MIGRACAO_MAPA_USUARIOS']),
      instanteDaCarga: new Date().toISOString(),
      decisoesCliente: {},
    })
    console.log('MODO: --dry-run (nada foi gravado; correspondencia com clientes existentes nao avaliada, exige banco)')
    for (const l of relatorioDoPlano(p)) console.log(l)
    escreverSaidas(p, dump, relatorioDoPlano(p, true))
    return p.resultados.some((r) => r.colecao === 'colecao_desconhecida') ? 1 : 0
  }

  const url = process.env['FIR_MIGRACAO_DATABASE_URL']
  if (!url) throw new ErroDeCarga('sem_FIR_MIGRACAO_DATABASE_URL')
  validarDestino(url)
  // `pg` mora em `teste/` (o pacote que já tem a dependência); este diretório não tem node_modules.
  const requerer = createRequire(new URL('../../teste/package.json', import.meta.url))
  const pg = requerer('pg') as { Client: new (c: { connectionString: string }) => ClienteSql & { connect(): Promise<void>; end(): Promise<void> } }
  const cli = new pg.Client({ connectionString: url })
  await cli.connect()
  try {
    if (tem('--producao')) {
      const q = (await cli.query('SELECT current_database() AS banco, current_user AS usuario')).rows[0] ?? {}
      conferirAlvoDeProducao({
        banco: String(q['banco']),
        usuario: String(q['usuario']),
        confirmaBanco: process.env['FIR_MIGRACAO_CONFIRMA_BANCO'],
        incluirGlobais: process.env['FIR_MIGRACAO_INCLUIR_GLOBAIS'] === '1',
      })
    }
    const grupo = process.env['FIR_MIGRACAO_GRUPO'] ?? String((await cli.query('SELECT id::text AS id FROM grupos WHERE padrao')).rows[0]?.['id'] ?? '')
    const carga = process.env['FIR_MIGRACAO_USUARIO_CARGA'] ?? ''
    const r = await executarCarga(cli, dump, {
      grupoId: grupo,
      usuarioCargaId: carga,
      mapaUsuarios: json(process.env['FIR_MIGRACAO_MAPA_USUARIOS']),
      aprovacoes: json(process.env['FIR_MIGRACAO_CORRESPONDENCIA']),
      ...(process.env['FIR_MIGRACAO_INCLUIR_GLOBAIS'] === '1' ? { incluirGlobais: true } : {}),
    })
    console.log('MODO: --aplicar (banco local)')
    for (const l of relatorioDoPlano(r.plano)) console.log(l)
    console.log('')
    for (const l of relatorioDaCarga(r)) console.log(l)
    escreverSaidas(r.plano, dump, [...relatorioDoPlano(r.plano, true), '', ...relatorioDaCarga(r, true)])
    return r.commitado ? 0 : 1
  } finally {
    await cli.end()
  }
}

principal().then(
  (c) => process.exit(c),
  (e: unknown) => {
    // só o código: a mensagem de um erro do pg ou do JSON pode conter o valor da linha
    const codigo = e instanceof ErroDeCarga || e instanceof ErroDeDump ? e.message : 'erro_inesperado'
    console.error(`FALHA: ${codigo}`)
    process.exit(2)
  },
)
