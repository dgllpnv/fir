import { z } from 'zod'
import { ErroDoMedx } from './erros'
import type { Pedido, Transporte } from './transporte'

/**
 * O LEITOR DO MEDX — seam declarado da integração (spec `integracao-medx.md` E).
 *
 * **Só lê** (D5, gate S-19): expõe a troca de token (`POST /token`) e leituras
 * `GET`, e nada mais. Uma escrita no MedX nasce de spec própria, nunca de um commit.
 *
 * O que ele garante a quem o usa:
 *  - **sessão em memória**, chaveada por `(clínica, impressão da chave)`: duas
 *    clínicas nunca usam o JWT uma da outra, e trocar a chave troca o JWT
 *    (S-12). Nunca em Redis nem no banco;
 *  - **leitura paginada tudo-ou-nada** (S-11): cada página passa por Zod; uma
 *    página ruim, um cursor repetido ou páginas demais abortam a leitura
 *    inteira — quem concilia nunca recebe lista parcial;
 *  - **só os campos declarados atravessam** (LGPD B2): os esquemas descartam o resto.
 */

const MARGEM_DO_TOKEN_MS = 60_000
export const MAXIMO_DE_PAGINAS = 50

const Token = z.object({
  accessToken: z.string().min(1).max(8192),
  expiresInSeconds: z.number().int().positive().max(86_400),
  scope: z.string().max(4000).nullable().optional(),
})

export const Pagina = z.object({
  hasMore: z.boolean(),
  nextCursor: z.string().max(4096).nullable().optional(),
})

const UsuarioAtual = z.object({
  id: z.number().int(),
  nome: z.string().max(400).nullable().optional(),
})

const Unidades = z.object({
  unidades: z.array(z.object({ id: z.number().int() })),
  page: Pagina,
})

export type Sessao = {
  readonly jwt: string
  readonly escopos: readonly string[]
  readonly expiraEm: number
}

/** O que a integração pode pedir, e só isso (LGPD B5). */
const ESCOPOS_BASE = ['agenda:read', 'contatos:details:read', 'financas:read'] as const
const ESCOPOS_DE_FATURAMENTO = ['lancamentos:read', 'faturas:read'] as const

/**
 * Compara os escopos da chave com a lista branca. `financas:read` entra na
 * base porque é ele que lista as UNIDADES (B5: mais de uma não liga) — e é só
 * catálogo, sem paciente. Escrita, prontuário e a lista de contatos sempre sobram.
 */
export function avaliarEscopos(
  escopos: readonly string[],
  opcoes: { faturamento: boolean },
): { faltam: string[]; sobram: string[] } {
  const tem = new Set(escopos)
  const faltam: string[] = ESCOPOS_BASE.filter((e) => !tem.has(e))
  if (opcoes.faturamento && !ESCOPOS_DE_FATURAMENTO.some((e) => tem.has(e))) {
    faltam.push('lancamentos:read ou faturas:read')
  }
  const permitidos = new Set<string>([...ESCOPOS_BASE, ...(opcoes.faturamento ? ESCOPOS_DE_FATURAMENTO : [])])
  const sobram = [...tem].filter((e) => !permitidos.has(e)).sort()
  return { faltam, sobram }
}

export class LeitorDoMedx {
  private readonly sessoes = new Map<string, Sessao>()

  constructor(
    private readonly transporte: Transporte,
    private readonly agora: () => number = Date.now,
  ) {}

  /** A chave aberta entra aqui e não é guardada: só o JWT, em memória, até expirar. */
  async sessao(clinicaId: string, impressao: string, chave: string): Promise<Sessao> {
    const k = `${clinicaId}:${impressao}`
    const atual = this.sessoes.get(k)
    if (atual !== undefined && atual.expiraEm - MARGEM_DO_TOKEN_MS > this.agora()) return atual
    // Uma clínica com chave nova deixa a sessão da antiga para trás: esquecer agora.
    for (const chaveDoMapa of this.sessoes.keys()) if (chaveDoMapa.startsWith(`${clinicaId}:`)) this.sessoes.delete(chaveDoMapa)

    const t = this.ler(Token, await this.transporte({ metodo: 'POST', caminho: '/token', corpo: { integrationToken: chave } }))
    const s: Sessao = {
      jwt: t.accessToken,
      escopos: (t.scope ?? '').split(/\s+/).filter((x) => x !== ''),
      expiraEm: this.agora() + t.expiresInSeconds * 1000,
    }
    this.sessoes.set(k, s)
    return s
  }

  /** Esquece a sessão da clínica (chave trocada, removida ou recusada). */
  esquecer(clinicaId: string): void {
    for (const k of this.sessoes.keys()) if (k.startsWith(`${clinicaId}:`)) this.sessoes.delete(k)
  }

  async usuarioAtual(s: Sessao): Promise<{ id: string; nome: string }> {
    const u = this.ler(UsuarioAtual, await this.get(s, '/agenda/usuario-atual'))
    return { id: String(u.id), nome: (u.nome ?? '').slice(0, 200) }
  }

  async quantasUnidades(s: Sessao): Promise<number> {
    let total = 0
    await this.paginar(s, '/financas/unidades', { Limit: '100' }, Unidades, (p) => {
      total += p.unidades.length
    })
    return total
  }

  /** Um recurso só (`GET`), validado. 404 lança `ErroDoMedx('nao_encontrado')`. */
  async obter<T>(s: Sessao, caminho: string, esquema: z.ZodType<T>): Promise<T> {
    return this.ler(esquema, await this.get(s, caminho))
  }

  /**
   * Lê todas as páginas, validando cada uma, e só então entrega — por
   * `aoLer`, página a página, a quem acumula. Uma falha em qualquer página
   * lança: quem acumulou descarta tudo (tudo-ou-nada, S-11).
   */
  async paginar<T extends { page: z.infer<typeof Pagina> }>(
    s: Sessao,
    caminho: string,
    query: Readonly<Record<string, string>>,
    esquema: z.ZodType<T>,
    aoLer: (pagina: T) => void,
  ): Promise<void> {
    const vistos = new Set<string>()
    let cursor: string | undefined
    for (let n = 0; n < MAXIMO_DE_PAGINAS; n++) {
      const pagina = this.ler(esquema, await this.get(s, caminho, cursor === undefined ? query : { ...query, Cursor: cursor }))
      aoLer(pagina)
      if (!pagina.page.hasMore) return
      const proximo = pagina.page.nextCursor
      if (proximo === null || proximo === undefined || proximo === '' || vistos.has(proximo)) {
        throw new ErroDoMedx('contrato')
      }
      vistos.add(proximo)
      cursor = proximo
    }
    throw new ErroDoMedx('contrato')
  }

  private get(s: Sessao, caminho: string, query?: Readonly<Record<string, string>>): Promise<string> {
    const p: Pedido = { metodo: 'GET', caminho, bearer: s.jwt, ...(query === undefined ? {} : { query }) }
    return this.transporte(p)
  }

  private ler<T>(esquema: z.ZodType<T>, texto: string): T {
    let bruto: unknown
    try {
      bruto = JSON.parse(texto)
    } catch {
      throw new ErroDoMedx('contrato')
    }
    const r = esquema.safeParse(bruto)
    if (!r.success) throw new ErroDoMedx('contrato')
    return r.data
  }
}
