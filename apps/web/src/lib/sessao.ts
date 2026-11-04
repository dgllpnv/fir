import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { EuSaida, OperadorPublico } from '@fir/contracts'
import { type ChaveDePermissao, PERMS } from '@fir/domain'

const API = process.env.FIR_API_URL || 'http://127.0.0.1:4811'
const CHAVES = new Set<string>(PERMS.map((p) => p[1]))

export type Sessao = {
  readonly eu: EuSaida
  readonly perfis: readonly { id: string; nome: string; perms: ChaveDePermissao[] }[]
  /**
   * O sujeito como `temPerm` o quer. **Derivado num lugar só.**
   *
   * Na sessão de suporte (D-13) não há pessoa, e o que entra aqui é
   * `{ admin: true, perfilId: '' }` — acesso total, pela MESMA função que o
   * servidor usa. Montar isto em cada página era o que já acontecia (cinco
   * cópias de `{ admin: eu.usuario.admin, … }`), e a sexta seria a que
   * estourasse em `null`.
   */
  readonly quem: { readonly admin: boolean; readonly perfilId: string }
  /**
   * O id da PESSOA da sessão, ou `''` na sessão de suporte.
   *
   * `''` e não um id emprestado: é "quem sou eu" do filtro *Para mim*, do
   * responsável padrão e de *Minhas metas*. Vazio é resposta legítima — o
   * operador não tem tarefa, nem meta, nem conta; fingir que é alguém poria o
   * nome de uma funcionária numa ação que não é dela (D-13).
   */
  readonly minhaPessoaId: string
  /** A sessão é do PAINEL. `null` na sessão de uma pessoa da clínica. */
  readonly suporte: { readonly operador: OperadorPublico } | null
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
/**
 * O cookie da sessao. Nomeado aqui para distinguir **duas coisas diferentes**
 * que davam o mesmo desvio mudo para `/entrar`:
 *
 *  - **sem cookie** — primeira visita, ou quem clicou em Sair. A tela de
 *    entrada normal, sem explicacao nenhuma, porque nao houve surpresa.
 *  - **com cookie e 401** — a sessao do dia terminou (P-1). Aqui a pessoa
 *    PRECISA de uma frase: ela abriu o sistema de manha, viu a tela de
 *    entrada e, sem explicacao, conclui que a ferramenta a deslogou sozinha.
 *
 * Colapsar as duas foi o estado anterior, e ele era defensavel enquanto a
 * sessao durava 30 dias — ninguem via a tela de entrada duas vezes. Com a
 * sessao terminando todo dia, a frase deixou de ser cortesia.
 */
const NOME_DO_COOKIE = '__Host-fir-sessao'

export const sessaoAtual = cache(async (): Promise<Sessao> => {
  const jarra = await cookies()
  const cabecalho = jarra.toString()
  const tinhaCookie = jarra.get(NOME_DO_COOKIE) !== undefined
  const r = await fetch(`${API}/v1/eu`, { headers: { cookie: cabecalho }, cache: 'no-store' })
  // `encerrada` é um rótulo, não dado pessoal: nada de PII em query string.
  if (!r.ok) redirect(tinhaCookie ? '/entrar?sessao=encerrada' : '/entrar')

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
  // `?.` e não `!`: na SESSÃO DE SUPORTE (D-13) não há pessoa, e não há
  // provisória de pessoa a cobrar. A do OPERADOR é cobrada pelo painel, que o
  // impede de abrir a sessão de suporte antes de trocá-la — mandá-lo para
  // `/trocar-senha` o largaria numa tela que troca a senha de uma pessoa que
  // ele não é.
  if (eu.usuario?.senhaProvisoria === true) redirect('/trocar-senha')
  // `perms` chega como string[] do JSON; o domínio quer ChaveDePermissao[].
  // O estreitamento acontece aqui, uma vez, e não em cada chamada de temPerm.
  const perfis = eu.perfis.map((p) => ({
    id: p.id,
    nome: p.nome,
    perms: p.perms.filter((k): k is ChaveDePermissao => CHAVES.has(k)),
  }))
  return {
    eu,
    perfis,
    quem:
      eu.usuario === null
        ? { admin: true, perfilId: '' }
        : { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' },
    minhaPessoaId: eu.usuario?.id ?? '',
    suporte: eu.operador === null ? null : { operador: eu.operador },
  }
})
