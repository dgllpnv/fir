/**
 * **O CORTE DE UMA CLÍNICA — a linha de comando do épico 9.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COMO SE USA
 *
 *   # ENSAIO: roda a migração inteira e faz ROLLBACK. Nada é gravado.
 *   pnpm --filter @fir/api exec tsx migrar-clinica.ts \
 *        --clinica <codigo> --arquivo "<caminho>.xlsx" --decisoes decisoes.json
 *
 *   # CORTE: o mesmo, com --valendo. Só depois de o ensaio FECHAR.
 *   pnpm --filter @fir/api exec tsx migrar-clinica.ts … --valendo
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UMA CLÍNICA POR VEZ, E O COMANDO NÃO ACEITA DUAS
 *
 * `--arquivo` é singular de propósito. Quatro clínicas de uma vez multiplicam
 * por quatro o custo de um erro e dividem por quatro a atenção — e o pior é
 * que elas compartilhariam a transação ou não compartilhariam, e nenhuma das
 * duas é boa: na primeira, o erro da quarta desfaz a primeira que já estava
 * certa; na segunda, o rollback deixa de ser um `ROLLBACK`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O ENSAIO É O PADRÃO, E `--valendo` É A PALAVRA
 *
 * Sem `--valendo` nada é gravado: a migração roda inteira, a conferência roda
 * inteira, e a transação é desfeita. É assim que se ensaia **contra a cópia
 * real dos dados da clínica** — que é a única forma de encontrar a célula em
 * branco, a data como serial do Excel e o nome com espaço duplo antes do dia
 * do corte. Dado de exemplo não tem nenhum dos três.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O ROLLBACK, CRONOMETRADO
 *
 * A migração inteira de uma clínica é **uma transação**. Então:
 *
 *   - se a conferência não fechar, o estado de volta é "a clínica não foi
 *     migrada", e o tempo é o do `ROLLBACK` — o comando o IMPRIME, medido;
 *   - se o corte já tiver sido feito e a clínica pedir para voltar, a v20
 *     continua de pé em paralelo, somente leitura, por alguns dias: o
 *     rollback é apontar a clínica de volta para o link antigo. É por isso
 *     que a v20 não se desliga no dia do corte.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE COMANDO NÃO IMPRIME
 *
 * Nome de paciente, telefone, valor individual e nome de procedimento. O
 * relatório fala em **ids da v20** e em **somas**. É a regra 21, e aqui ela
 * morde de verdade: o relatório é o que se cola num chamado.
 */
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import type { DecisoesDaClinica } from '@fir/domain'
import pg from 'pg'
import { BancoService } from './src/banco/banco.service'
import { clinicaIdDeFonteConfiavel } from './src/banco/clinica-id'
import { LeitorDePlanilha } from './src/migracao/leitor-de-planilha'
import { MigracaoReprovada, Migrador } from './src/migracao/migrador.service'
import type { RelatorioDaMigracao } from './src/migracao/relatorio'

type Argumentos = {
  clinica: string
  arquivo: string
  decisoes: string | null
  valendo: boolean
}

function lerArgumentos(argv: readonly string[]): Argumentos {
  const mapa = new Map<string, string>()
  let valendo = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--valendo') {
      valendo = true
      continue
    }
    if (a.startsWith('--')) {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) {
        throw new Error(`a opção ${a} precisa de um valor`)
      }
      mapa.set(a.slice(2), v)
      i += 1
    }
  }
  const clinica = mapa.get('clinica')
  const arquivo = mapa.get('arquivo')
  if (clinica === undefined || arquivo === undefined) {
    throw new Error('uso: --clinica <codigo> --arquivo <caminho.xlsx> [--decisoes d.json] [--valendo]')
  }
  return { clinica, arquivo, decisoes: mapa.get('decisoes') ?? null, valendo }
}

/**
 * As decisões da clínica, em JSON — **nunca no código, e nunca um padrão**.
 *
 * ```json
 * {
 *   "perfilPorPessoa": { "<id da v20>": "pf_rec" },
 *   "ativoPorNome":    { "tirzepatida": "<id da v20>" },
 *   "vivaPorNomeDeCampanha": { "outubro rosa": "<id da v20>" }
 * }
 * ```
 *
 * O arquivo é o REGISTRO de que a clínica revisou: ele vai para o chamado do
 * corte junto com o relatório. O migrador recusa a clínica cujo mapa não
 * cobre todos os `admin = false` — não há "Recepção por omissão", porque
 * entre os `admin = false` reais há enfermagem, fisioterapia e comercial
 * externo, e Recepção lhes daria caixa, contas e cobranças.
 */
function lerDecisoes(caminho: string | null): Partial<DecisoesDaClinica> {
  if (caminho === null) return {}
  const bruto: unknown = JSON.parse(readFileSync(caminho, 'utf8'))
  if (typeof bruto !== 'object' || bruto === null) throw new Error('decisoes.json inválido')
  const o = bruto as Record<string, unknown>
  const mapaDe = (chave: string): ReadonlyMap<string, string> | undefined => {
    const v = o[chave]
    if (v === undefined) return undefined
    if (typeof v !== 'object' || v === null) throw new Error(`"${chave}" precisa ser um objeto`)
    return new Map(Object.entries(v as Record<string, string>))
  }
  const perfilPorPessoa = mapaDe('perfilPorPessoa')
  const ativoPorNome = mapaDe('ativoPorNome')
  const vivaPorNomeDeCampanha = mapaDe('vivaPorNomeDeCampanha')
  return {
    ...(perfilPorPessoa === undefined ? {} : { perfilPorPessoa }),
    ...(ativoPorNome === undefined ? {} : { ativoPorNome }),
    ...(vivaPorNomeDeCampanha === undefined ? {} : { vivaPorNomeDeCampanha }),
  }
}

function imprimirRelatorio(r: RelatorioDaMigracao): void {
  const linha = (nome: string, origem: string, destino: string, ok: string) =>
    `  ${ok} ${nome.padEnd(52)} ${origem.padStart(26)}  ${destino.padStart(26)}\n`

  process.stdout.write('\nRELATÓRIO DE CONFERÊNCIA\n')
  process.stdout.write(linha('conferência', 'origem (v20)', 'destino (banco)', ' '))
  process.stdout.write(`  ${'-'.repeat(108)}\n`)
  for (const l of r.linhas) {
    process.stdout.write(linha(l.nome, l.origem, l.destino, l.bate ? 'ok ' : 'NAO'))
  }
  for (const l of r.linhas) {
    if (l.bate) continue
    for (const d of l.divergencias) {
      process.stdout.write(
        `    DIVERGE em ${l.nome}: chave "${d.chave}" · origem ${d.origem} · destino ${d.destino}\n`,
      )
    }
  }
  process.stdout.write(`\n  arredondamentos de centavo: ${r.arredondamentos}\n`)
  if (r.observacoes.length > 0) {
    process.stdout.write('\nOBSERVAÇÕES (não reprovam)\n')
    const porCodigo = new Map<string, { n: number; exemplo: string }>()
    for (const o of r.observacoes) {
      const k = `${o.aba}.${o.coluna}:${o.codigo}`
      const atual = porCodigo.get(k)
      porCodigo.set(k, { n: (atual?.n ?? 0) + 1, exemplo: atual?.exemplo ?? o.mensagem })
    }
    for (const [k, v] of porCodigo) {
      process.stdout.write(`  ${v.n}x ${k}\n      ${v.exemplo}\n`)
    }
  }
  process.stdout.write(
    `\n  CONFERÊNCIA ${r.fechado ? 'FECHADA — os seis totais batem exatamente' : 'NÃO FECHOU'}\n`,
  )
}

const args = lerArgumentos(process.argv.slice(2))
const decisoes = lerDecisoes(args.decisoes)

// `clinicas` não tem RLS (é a raiz do tenancy), e resolver o código antes de
// abrir a transação do migrador evita um `naClinica` com id inventado.
const admin = new pg.Client({
  connectionString:
    process.env['DATABASE_URL_MIGRATE'] ??
    'postgresql://fir_migrate:fir_local_dev@127.0.0.1:4832/fir',
})
await admin.connect()
const achada = await admin.query<{ id: string; nome: string; fuso: string }>(
  'SELECT id, nome, fuso FROM clinicas WHERE codigo = $1',
  [args.clinica],
)
await admin.end()
const clinica = achada.rows[0]
if (clinica === undefined) {
  process.stderr.write(
    `clínica "${args.clinica}" não existe. Crie-a pelo painel do superadmin ANTES do corte: ` +
      'é lá que a administradora e os perfis padrão nascem.\n',
  )
  process.exit(1)
}

const banco = new BancoService()
const leitor = new LeitorDePlanilha()
const migrador = new Migrador(banco)

process.stdout.write(
  `clínica "${args.clinica}" · fuso ${clinica.fuso} · modo ${args.valendo ? 'VALENDO' : 'ENSAIO (rollback no fim)'}\n`,
)

const comeco = performance.now()
let saida = 0
try {
  const planilha = leitor.ler(readFileSync(args.arquivo))
  const r = await migrador.migrar(clinicaIdDeFonteConfiavel(clinica.id), planilha, decisoes, {
    ensaio: !args.valendo,
  })
  imprimirRelatorio(r.relatorio)
  process.stdout.write(`  criados: ${JSON.stringify(r.criados)}\n`)
  process.stdout.write(`  reaproveitados (idempotência): ${JSON.stringify(r.reaproveitados)}\n`)
} catch (e) {
  if (e instanceof MigracaoReprovada) {
    if (e.relatorio !== null) imprimirRelatorio(e.relatorio)
    const ensaioOk = e.motivos.length === 1 && e.motivos[0]?.codigo === 'Ensaio'
    if (ensaioOk) {
      process.stdout.write('\n  ENSAIO: a transação foi desfeita. Nada foi gravado.\n')
    } else {
      process.stderr.write(`\nMIGRAÇÃO REPROVADA — ${e.motivos.length} impedimento(s):\n`)
      const porCodigo = new Map<string, { n: number; exemplo: string; linhas: number[] }>()
      for (const m of e.motivos) {
        const k = `${m.aba}.${m.coluna}:${m.codigo}`
        const atual = porCodigo.get(k)
        porCodigo.set(k, {
          n: (atual?.n ?? 0) + 1,
          exemplo: atual?.exemplo ?? m.mensagem,
          linhas: [...(atual?.linhas ?? []), m.linha].slice(0, 10),
        })
      }
      for (const [k, v] of porCodigo) {
        process.stderr.write(`  ${v.n}x ${k}\n      ${v.exemplo}\n      linhas: ${v.linhas.join(', ')}\n`)
      }
      saida = 1
    }
  } else {
    process.stderr.write(`\nERRO: ${(e as Error).message}\n`)
    saida = 1
  }
}
// O TEMPO, SEMPRE — é ele que responde "quanto tempo leva o rollback?".
process.stdout.write(`\n  tempo total: ${Math.round(performance.now() - comeco)} ms\n`)
await banco.onModuleDestroy()
process.exit(saida)
