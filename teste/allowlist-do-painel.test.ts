import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * A ALLOWLIST DE REDE DO PAINEL — a parte testável da D-5, restrição 6.
 *
 * Nada aqui sobe um Traefik. O que se mede é o **texto das labels**, que é o
 * artefato de verdade: o roteador do produto NEGA o mesmo caminho que o
 * roteador do painel CASA, o middleware usa `sourcerange` e nada mais, e a
 * variável vazia cai no padrão fechado.
 *
 * Por que isso vale um teste, e não uma revisão: o gatilho mais provável do
 * erro de digitação num CIDR é o procedimento de recuperação de lockout,
 * executado por uma pessoa só, sob pressão, por SSH. Nessa hora, uma label
 * que mudou de forma meses atrás não é notada.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSE = join(RAIZ, 'infra', 'producao', 'docker-compose.yml')
const texto = readFileSync(COMPOSE, 'utf8')

const labelDe = (chave: string): string => {
  const linha = texto
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(`${chave}:`))
  if (linha === undefined) throw new Error(`label ausente no compose: ${chave}`)
  return linha.slice(chave.length + 1).trim()
}

/**
 * O padrão do `PathRegexp`, traduzido do Go para o JavaScript.
 *
 * Duas traduções, e as duas são de forma, não de sentido:
 *  - `(?i)` (flag embutida do Go) vira a flag `i` do JS;
 *  - `$$` (o escape de `$` do Compose) vira `$`.
 */
const regexpDaRegra = (regra: string): RegExp => {
  const m = /PathRegexp\(`([^`]+)`\)/.exec(regra)
  if (!m?.[1]) throw new Error(`regra sem PathRegexp: ${regra}`)
  const bruto = m[1].replace(/\$\$/g, '$')
  const semFlag = bruto.replace(/^\(\?i\)/, '')
  expect(semFlag, 'o PathRegexp deixou de ser insensível a caixa').not.toBe(bruto)
  return new RegExp(semFlag, 'i')
}

const regraDoProduto = labelDe('traefik.http.routers.fir.rule')
const regraDoPainel = labelDe('traefik.http.routers.fir-painel.rule')

describe('os dois roteadores são disjuntos', () => {
  it('o do produto NEGA exatamente o que o do painel casa', () => {
    /**
     * A negação não é estilo: é o que faz a allowlist **falhar fechada**.
     *
     * Sem ela, os dois roteadores se sobrepõem e o do produto casa
     * `/superadmin` também; no dia em que o middleware não puder ser
     * construído — `IPS_DO_PAINEL` vazia, um CIDR com erro de digitação — o
     * Traefik DESCARTA o roteador do painel em vez de bloquear, e o produto
     * passa a servir `/superadmin` sem allowlist nenhuma. O controle não
     * falharia fechado: ele sumiria em silêncio.
     */
    expect(regraDoProduto).toContain('!PathRegexp(')
    const m1 = /PathRegexp\(`([^`]+)`\)/.exec(regraDoProduto)
    const m2 = /PathRegexp\(`([^`]+)`\)/.exec(regraDoPainel)
    expect(
      m1?.[1],
      'as duas regras casam padrões DIFERENTES — elas deixaram de ser disjuntas',
    ).toBe(m2?.[1])
  })

  it('o roteador do painel declara entrypoint, tls, service e o middleware', () => {
    // Um roteador sem `entrypoints` liga-se a TODAS as entradas, e o painel
    // passaria a ser servido em texto claro no `http`. Sem `service`, ele é
    // descartado no dia em que o container declarar uma segunda porta.
    expect(labelDe('traefik.http.routers.fir-painel.entrypoints')).toBe('https')
    expect(labelDe('traefik.http.routers.fir-painel.tls')).toBe("'true'")
    expect(labelDe('traefik.http.routers.fir-painel.service')).toBe('fir')
    expect(labelDe('traefik.http.routers.fir-painel.middlewares')).toBe('fir-ips-do-painel')
  })
})

describe('a regra casa um SEGMENTO, não um prefixo', () => {
  // Dentro do `it`, e não no corpo do `describe`: uma label que mudou de
  // forma lançaria na COLETA, e aí os outros `describe` deste arquivo nem
  // rodariam — um defeito esconderia os outros.
  const casa = () => regexpDaRegra(regraDoPainel)

  /**
   * A tabela que importa. Os quatro primeiros casos vêm de assimetrias
   * MEDIDAS contra a produção do Mavia: `PathPrefix` do Traefik é sensível a
   * caixa e o rewrite do Next não é; o Traefik casa o caminho CRU e quem
   * normaliza `//` é o Next. As duas juntas tornam um prefixo contornável.
   */
  it.each([
    ['/superadmin', true],
    ['/superadmin/', true],
    ['/superadmin/clinicas', true],
    ['/SuperAdmin/', true],
    ['/api/v1/superadmin/eu', true],
    ['/api//v1/superadmin/eu', true],
    ['/API/V1/SUPERADMIN/EU', true],
    ['/x/superadmin', true],
    ['/_next/static/chunks/app/superadmin/page.js', true],
    // E o caso que prova que o `(/|$)` está certo: um caminho que COMEÇA com
    // a palavra não casa, senão a allowlist bloquearia rota de produto.
    ['/superadministrador', false],
    ['/supera', false],
    ['/hoje', false],
    ['/api/v1/pacientes', false],
    ['/api/v1/painel', false],
  ])('%s → %s', (caminho, esperado) => {
    expect(casa().test(caminho)).toBe(esperado)
  })
})

describe('o middleware é sourcerange e NADA MAIS', () => {
  it('não há ipstrategy, depth nem excludedips em lugar nenhum do arquivo', () => {
    /**
     * A estratégia padrão compara contra o endereço do SOCKET, que não se
     * forja. Qualquer `ipstrategy` faria o middleware ler o
     * `X-Forwarded-For` — um cabeçalho que, na entrada HTTPS deste Traefik,
     * VEM DO CLIENTE. Uma allowlist que lê o que o atacante escreve
     * atravessa-se com uma linha de `curl`.
     */
    for (const proibido of ['ipstrategy', 'depth', 'excludedips']) {
      expect(
        texto.toLowerCase().includes(`.${proibido}`),
        `o compose menciona \`${proibido}\` — a allowlist passaria a ler um cabeçalho ` +
          'que o cliente escreve',
      ).toBe(false)
    }
  })

  it('variável ausente E vazia caem no padrão FECHADO', () => {
    // `:-` e não `-`: com `-`, a string vazia sobrescreveria o padrão, o
    // middleware não se construiria, e cairíamos no modo de falha que a
    // negação do roteador do produto existe para conter.
    const linha = labelDe('traefik.http.middlewares.fir-ips-do-painel.ipallowlist.sourcerange')
    expect(linha).toBe("'${IPS_DO_PAINEL:-127.0.0.1/32}'")
    expect(linha, 'o padrão usa `-` em vez de `:-`: a string vazia o sobrescreveria').not.toMatch(
      /\$\{IPS_DO_PAINEL-/,
    )
  })
})

describe('o .env de produção não é versionado', () => {
  it('está no .gitignore e não está rastreado pelo git', () => {
    expect(readFileSync(join(RAIZ, '.gitignore'), 'utf8')).toContain('infra/producao/.env')
    const rastreados = execFileSync('git', ['ls-files', 'infra/producao'], {
      cwd: RAIZ,
      encoding: 'utf8',
    })
    expect(
      rastreados.split('\n').filter((l) => l.endsWith('.env')),
      'o .env de produção está no repositório — ele tem as senhas do banco e do painel',
    ).toEqual([])
  })
})

describe('os scripts de provisionamento existem e dizem a ordem', () => {
  it('a ordem obrigatória está escrita no provisionamento, não só no README', () => {
    // Fora de ordem, a 0013 falha — e o `RAISE EXCEPTION` dela diz isso.
    // Quem lê o script sob pressão não abre o README.
    const provisionar = readFileSync(join(RAIZ, 'infra', 'producao', 'provisionar-painel.sh'), 'utf8')
    expect(provisionar).toContain('db:migrate')
    expect(provisionar).toContain('redefinir-superadmin.sh')
  })

  it('o break-glass GRAVA, com ator_tipo vps', () => {
    // Um break-glass que não deixa rastro é uma porta dos fundos com outro
    // nome.
    const quebrarVidro = readFileSync(
      join(RAIZ, 'infra', 'producao', 'redefinir-superadmin.sh'),
      'utf8',
    )
    expect(quebrarVidro).toContain('auditoria_do_painel')
    expect(quebrarVidro).toContain("'vps'")
    // E ele avisa quando há menos de dois operadores ativos.
    expect(quebrarVidro).toMatch(/lt 2/)
  })
})
