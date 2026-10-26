import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * **A VARREDURA DA D-9 — toda pergunta de "quanto entrou" carrega o filtro.**
 *
 * Desde a `0011`, `recebimentos` guarda duas coisas: dinheiro que entrou
 * (`valor > 0`, com forma) e dinheiro que ficou devendo (`valor = 0`,
 * `valor_aberto > 0`, forma vazia — a venda a prazo). A decisão do dono só
 * vale com os três filtros: caixa do dia, lista de recebimentos do dia e LTV.
 *
 * **Por que uma varredura e não só os três testes de comportamento.** Dois dos
 * três são observáveis por fora: a linha de zero apareceria no esperado do
 * caixa e na lista do dia, e o teste e2e a pega. **O LTV não é** — ele é um
 * `sum(valor)`, e somar zero é invisível. Tirar o filtro de lá deixa toda a
 * suíte verde, e eu medi isso antes de escrever este arquivo.
 *
 * Então o LTV ganha a prova que cabe nele: **estrutural**. A varredura olha o
 * código de verdade, não uma promessa num comentário — mesmo espírito de
 * `campos-de-dinheiro-registrados.test.ts` e de `rotina-rls.test.ts`.
 *
 * E ela vale para o lugar número cinco, que ainda não existe: quem acrescentar
 * uma soma de `recebimentos.valor` sem o filtro descobre aqui, e não quando a
 * clínica reclamar que a conferência do caixa acusa uma diferença que não
 * existe.
 *
 * O ALCANCE, dito sem exagero: a varredura casa texto de consulta SQL em
 * arquivo de produção. Uma soma montada por concatenação em tempo de execução
 * escaparia — e seria um problema maior e mais visível que este.
 */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const AREAS = ['apps/api/src']

/**
 * A constante **interpolada dentro do SQL**, e não só o nome importado.
 *
 * Medido: com `'DINHEIRO_QUE_ENTROU'` solto, tirar o `AND` de dentro da
 * consulta deixava a varredura verde — a linha de `import` casava sozinha. É o
 * mesmo erro de uma varredura que confere se o arquivo "menciona" a regra em
 * vez de se ele a aplica.
 */
const FILTRO = '${DINHEIRO_QUE_ENTROU}'

/**
 * Uma consulta que **soma ou lista o valor recebido**, em texto de SQL.
 *
 * `sum(r.valor)` e `r.valor::text AS valor` são as duas formas em que a
 * pergunta aparece hoje. `valor_aberto` é deliberadamente excluído do casamento
 * (`(?!_aberto)`): somar o que a paciente DEVE é a pergunta do saldo, e ela
 * **tem** de incluir a venda a prazo.
 */
const SOMA_OU_LISTA = /(?:sum|coalesce\(sum)\(\s*r\.valor(?!_aberto)|r\.valor(?!_aberto)::text/

/**
 * As exceções, **nomeadas uma por uma e com a razão escrita.**
 *
 * Lista exata e não padrão: um `*.service.ts` qualquer entrando na exceção por
 * casar com um glob é como o quinto lugar nasce sem o filtro.
 */
const FORA_DA_VARREDURA: Readonly<Record<string, string>> = {
  // O saldo em aberto É a pergunta oposta: ele soma o que a paciente DEVE, e a
  // venda a prazo é precisamente a linha que ele existe para enxergar. Filtrar
  // aqui apagaria a dívida que a D-9 foi tomada para registrar.
  'apps/api/src/financeiro/saldo.repositorio.ts':
    'soma o que a paciente DEVE — a venda a prazo é o caso que ele existe para ver',
  // A busca por `requisicaoId` e por `id` serve o CAMINHO DE ESCRITA: ela
  // devolve a linha que acabou de nascer, para o corpo da resposta e para a
  // idempotência. Filtrar ali faria `POST /v1/programas` não achar o
  // recebimento que ele mesmo inseriu.
  'apps/api/src/financeiro/recebimentos.service.ts':
    'o SELECT_BASE serve também a leitura por id do caminho de escrita; a LISTA tem o filtro, e há teste e2e',
  // A LINHA DO TEMPO DA PACIENTE, e aqui a venda a prazo PRECISA aparecer.
  //
  // `leitura.ts` lê o pagamento embutido de UMA tarefa, não um agregado de
  // dia nenhum. A tarefa companheira "Adesão ao programa" é justamente onde a
  // clínica vê "pagou R$ 0,00, ficou devendo R$ 3.600" — é o que o protótipo
  // mostra na ficha (`valor: ""`, `valorAberto: 3600`), e esconder isso faria
  // a adesão a prazo desaparecer do histórico. `PagamentoNaSaida.forma` é
  // `z.string()` por isso: a forma vazia é um valor legítimo ali.
  'apps/api/src/tarefas/leitura.ts':
    'lê o pagamento de UMA tarefa para a linha do tempo — a venda a prazo tem de aparecer lá',
}

const ehTeste = (caminho: string): boolean =>
  caminho.endsWith('.test.ts') || caminho.includes('__tests__')

function arquivosDe(raiz: string): string[] {
  let entradas: string[]
  try {
    entradas = readdirSync(raiz)
  } catch {
    return []
  }
  const achados: string[] = []
  for (const nome of entradas) {
    if (['node_modules', '.turbo', '.next', 'dist'].includes(nome)) continue
    const caminho = join(raiz, nome)
    if (statSync(caminho).isDirectory()) achados.push(...arquivosDe(caminho))
    else if (/\.ts$/.test(nome)) achados.push(caminho)
  }
  return achados
}

const producao = AREAS.flatMap((a) => arquivosDe(join(RAIZ, a)))
  .filter((p) => !ehTeste(p))
  .map((p) => ({ rel: relative(RAIZ, p).split('\\').join('/'), texto: readFileSync(p, 'utf8') }))

describe('D-9 — o filtro do dinheiro que entrou', () => {
  it('a varredura ENCONTRA os arquivos de produção — senão ela não prova nada', () => {
    // Sem esta, um erro de caminho faria a varredura passar sobre zero
    // arquivos e todo o resto deste arquivo viraria decoração.
    expect(producao.length).toBeGreaterThan(30)
    expect(producao.map((x) => x.rel)).toContain('apps/api/src/pacientes/pacientes.service.ts')
  })

  it('todo SELECT que soma ou lista `recebimentos.valor` carrega o filtro', () => {
    const faltando = producao
      .filter((x) => SOMA_OU_LISTA.test(x.texto))
      .filter((x) => FORA_DA_VARREDURA[x.rel] === undefined)
      .filter((x) => !x.texto.includes(FILTRO))
      .map((x) => x.rel)

    expect(faltando).toEqual([])
  })

  it('os SEIS lugares estão cobertos, nominalmente', () => {
    // A varredura acima pega o que esquece o filtro. Esta pega o contrário: o
    // arquivo que perde a consulta inteira numa refatoração e sai da varredura
    // por não casar mais com o padrão — e aí "nenhum faltando" passa a ser
    // verdade por ausência.
    const comFiltro = new Set(producao.filter((x) => x.texto.includes(FILTRO)).map((x) => x.rel))
    for (const caminho of [
      'apps/api/src/financeiro/caixa.service.ts',
      'apps/api/src/financeiro/recebimentos.service.ts',
      'apps/api/src/financeiro/visao-do-mes.service.ts',
      'apps/api/src/pacientes/pacientes.service.ts',
      // Encontrado POR esta varredura, e não previsto na decisão: o funil
      // soma "o que entrou nos atendimentos do período".
      'apps/api/src/jornada/funil.service.ts',
      // Encontrado POR esta varredura tambem: o `recebido` da ficha do programa.
      'apps/api/src/programas/leitura.service.ts',
    ]) {
      expect(comFiltro, `${caminho} perdeu o filtro da D-9`).toContain(caminho)
    }
  })

  it('o filtro é UMA constante, e ela exige valor E forma', () => {
    const fonte = readFileSync(
      join(RAIZ, 'apps/api/src/financeiro/dinheiro-que-entrou.ts'),
      'utf8',
    )
    // As duas metades. A segunda é redundante com a primeira enquanto
    // `recebimento_forma_so_com_dinheiro` existir, e está lá exatamente por
    // isso: ela cai junto se alguém relaxar a constraint.
    expect(fonte).toContain('r.valor > 0')
    expect(fonte).toContain(`r.forma <> ''`)
  })

  it('o SALDO continua FORA — ele soma o que a paciente deve', () => {
    const saldo = producao.find((x) => x.rel === 'apps/api/src/financeiro/saldo.repositorio.ts')!
    // Se o filtro entrasse aqui, a dívida da venda a prazo desapareceria e a
    // D-9 perderia a razão de existir. A exceção é deliberada, e este teste é
    // o que a torna uma decisão em vez de um esquecimento.
    expect(saldo.texto).not.toContain(FILTRO)
  })
})
