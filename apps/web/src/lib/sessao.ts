import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { EuSaida } from '@fir/contracts'
import { type ChaveDePermissao, PERMS } from '@fir/domain'

const API = process.env.FIR_API_URL || 'http://127.0.0.1:4811'
const CHAVES = new Set<string>(PERMS.map((p) => p[1]))

export type Sessao = {
  readonly eu: EuSaida
  readonly perfis: readonly { id: string; nome: string; perms: ChaveDePermissao[] }[]
}

/**
 * A sessão do pedido atual, resolvida **no servidor** — a tela nunca decide se
 * alguém entrou.
 *
 * `cache()` do React: o layout e a página do mesmo pedido chamam isto, e com
 * `cache: 'no-store'` o fetch não seria deduplicado sozinho. Sem o `cache()`,
 * cada navegação viraria duas chamadas a `/v1/eu` — e, quando a trilha de
 * auditoria existir, dois registros de acesso para um acesso só.
 *
 * Existe num lugar só por decisão: duplicar o estreitamento de `perms` entre
 * layout e página é a dívida do legado (a mesma regra escrita três vezes, já
 * divergentes) começando de novo.
 */
export const sessaoAtual = cache(async (): Promise<Sessao> => {
  const cabecalho = (await cookies()).toString()
  const r = await fetch(`${API}/v1/eu`, { headers: { cookie: cabecalho }, cache: 'no-store' })
  if (!r.ok) redirect('/entrar')

  const eu = (await r.json()) as EuSaida

  /**
   * O desvio para a troca de senha, no SERVIDOR, antes de qualquer render.
   *
   * O guard da API já recusa toda rota de negócio com 409, e `chamar()`
   * desvia no cliente. Esta é a terceira camada, e a que importa para a
   * primeira navegação: sem ela a pessoa veria a Shell montar, o menu
   * aparecer e cada bloco falhar sozinho — uma tela quebrada em vez de uma
   * instrução.
   *
   * `/trocar-senha` NÃO usa esta função, justamente para não entrar em laço.
   */
  if (eu.usuario.senhaProvisoria) redirect('/trocar-senha')
  // `perms` chega como string[] do JSON; o domínio quer ChaveDePermissao[].
  // O estreitamento acontece aqui, uma vez, e não em cada chamada de temPerm.
  const perfis = eu.perfis.map((p) => ({
    id: p.id,
    nome: p.nome,
    perms: p.perms.filter((k): k is ChaveDePermissao => CHAVES.has(k)),
  }))
  return { eu, perfis }
})
