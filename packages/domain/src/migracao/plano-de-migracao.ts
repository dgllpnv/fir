import { canonizarUsuario, validarUsuario } from '../usuario'
import { ehErro } from '../resultado'
import type { Achado, DadosDaV20, PessoaDaV20, PlanoDaV20 } from './v20'

/**
 * **AS DECISÕES QUE O MIGRADOR NÃO PODE TOMAR SOZINHO.**
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A REGRA DESTE ARQUIVO
 *
 * Toda conversão que o dado da v20 **determina** mora no migrador e acontece
 * sem perguntar. Toda conversão que exige uma INFORMAÇÃO QUE A PLANILHA NÃO
 * TEM mora aqui, e aqui ela só sabe fazer duas coisas: **descobrir que a
 * decisão é necessária** e **recusar enquanto ela não vier por escrito**.
 *
 * Não há padrão silencioso em nenhuma das três. Um padrão silencioso em
 * atribuição de perfil tira o acesso de quem precisa ou dá acesso a quem não
 * deve, e o erro só aparece quando alguém abre a tela errada.
 */

/**
 * **1. O PERFIL DE CADA PESSOA.**
 *
 * O roteiro conhecido é *"equipe com `admin = false` → perfil Recepção"*, com
 * a ressalva *"revisar com cada clínica, uma a uma"*. A medição nas três
 * planilhas mostra **por que** a ressalva existe: entre os `admin = false`
 * reais há `funcao` de *Tec. Enfermagem*, *Fisioterapeuta* e *Comercial
 * externo*. O perfil Recepção carrega `receber`, `caixa`, `contas` e
 * `cobrancas` — dar isso a uma fisioterapeuta é dar o caixa da clínica a
 * quem nunca o fechou, e dar o Comercial a quem mexe no caixa é tirar dela o
 * que ela usa.
 *
 * Então: a decisão é um MAPA `id da v20 → chave de perfil`, e o migrador
 * recusa a clínica cujo mapa não cobre todos os não-administradores.
 *
 * `admin = true` **não** entra no mapa: administradora não tem perfil
 * (`pessoa_tem_acesso_definido`, migration 0002), e oferecer a escolha
 * convidaria a violá-la.
 */
export type DecisaoDePerfil = {
  /** `id` da aba `Equipe` → `perfis.chave` (`pf_rec`, `pf_enf`, …). */
  readonly perfilPorPessoa: ReadonlyMap<string, string>
}

/**
 * **2. QUAL DUPLICATA DE NOME CONTINUA VIVA (`Planos` e `Campanhas`).**
 *
 * Medido: a aba `Planos` das três clínicas tem **nomes repetidos** — sete
 * "mesmo nome" numa delas, com `sessoes` diferentes (12, 9, 8, 8, 8, 5, 4). O
 * índice `procedimentos_nome_unico` é parcial em `ativo AND excluido_em IS
 * NULL`, então a saída que invent **nada** é: uma fica ativa, as outras ficam
 * **desativadas** — que é o estado que o CONTEXT.md já define ("deixa de ser
 * oferecido em adesão nova e continua montando uma proposta feita antes").
 *
 * As linhas **todas existem no destino**, então a conferência de contagem
 * continua exata. O que muda é o que a clínica vê na lista de "Nova adesão" —
 * e é por isso que a escolha é dela.
 *
 * **A REGRA AUTOMÁTICA, E O LIMITE DELA.** Quando no máximo UM dos
 * homônimos tem adesão, a escolha é determinada: fica o usado (ou o primeiro,
 * se nenhum for usado). Quando DOIS OU MAIS estão em uso, nenhuma escolha
 * automática é defensável — as duas estão vivas, com parâmetros diferentes, e
 * quem sabe qual delas a clínica ainda oferece é a clínica. Aí o migrador
 * REPROVA e nomeia o grupo.
 */
export type DecisaoDeProcedimento = {
  /** `nome_chave` → o `id` da v20 que fica ATIVO no grupo de homônimos. */
  readonly ativoPorNome: ReadonlyMap<string, string>
  /**
   * O mesmo, para `Campanhas` — e elas têm o problema igual, medido: duas
   * clínicas têm campanhas de nome repetido, e numa delas **as duas** têm
   * tarefa vinculada.
   *
   * O índice de lá (`campanha_por_nome`) é parcial em `excluida_em IS NULL`, e
   * não em `ativo`: campanha não tem estado "desativada". Então a que não
   * fica recebe **soft delete** — ela sai da lista da gestora, continua
   * legível no histórico, e as tarefas dela **mantêm** o `campanha_id` (a 0020
   * decidiu isso de propósito: o trabalho feito mantém a atribuição). A
   * receita dela continua aparecendo na conferência 6.
   */
  readonly vivaPorNomeDeCampanha?: ReadonlyMap<string, string>
}

export type DecisoesDaClinica = DecisaoDePerfil & DecisaoDeProcedimento

/** A mesma normalização de `normalizar_nome` (migration 0006). */
export const chaveDeNome = (bruto: string): string =>
  bruto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')

/**
 * **3. O `usuario` DE CADA PESSOA (D-10).**
 *
 * Cunhado das duas primeiras palavras do nome: `Ana Paula Silva` → `ana.paula`.
 * Duas e não uma porque `ana` colide com a próxima Ana, e não três porque o
 * usuário precisa ser **ditável por telefone** — é a razão de a forma canônica
 * existir.
 *
 * **COLISÃO É DECISÃO HUMANA, NUNCA SUFIXO AUTOMÁTICO.** `ana.silva2` é um
 * usuário que ninguém sabe que tem e que a pessoa não consegue adivinhar no
 * balcão. É a mesma recusa que a migration 0012 já escreveu, com a mesma
 * mensagem: *corrija antes de migrar, ou defina à mão*.
 */
export function cunharUsuario(nome: string): string {
  const palavras = chaveDeNome(nome)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter((p) => p !== '')
  const bruto = palavras.slice(0, 2).join('.')
  return canonizarUsuario(bruto)
}

export type UsuariosCunhados = {
  readonly porPessoa: ReadonlyMap<string, string>
  readonly problemas: readonly Achado[]
}

export function cunharUsuarios(equipe: readonly PessoaDaV20[]): UsuariosCunhados {
  const porPessoa = new Map<string, string>()
  const problemas: Achado[] = []
  const usados = new Map<string, string>()

  equipe.forEach((p, i) => {
    const linha = i + 2
    const u = cunharUsuario(p.nome)
    const r = validarUsuario(u)
    if (ehErro(r)) {
      problemas.push({
        aba: 'Equipe',
        linha,
        coluna: 'nome',
        codigo: `UsuarioInvalido:${r.erro.codigo}`,
        mensagem:
          `o usuário cunhado a partir deste nome não é válido (${r.erro.mensagem}). ` +
          'Defina-o à mão nas decisões da clínica.',
      })
      return
    }
    const antes = usados.get(u)
    if (antes !== undefined) {
      problemas.push({
        aba: 'Equipe',
        linha,
        coluna: 'nome',
        codigo: 'UsuarioColide',
        mensagem:
          `o usuário cunhado colide com o da pessoa ${antes} da mesma clínica. ` +
          'Escolher qual das duas fica com ele é decisão da clínica — o migrador ' +
          'não acrescenta sufixo.',
      })
      return
    }
    usados.set(u, p.id)
    porPessoa.set(p.id, u)
  })

  return { porPessoa, problemas }
}

export type GrupoDeHomonimos = {
  readonly aba: 'Planos' | 'Campanhas'
  readonly nomeChave: string
  /** Os ids da v20, na ordem da aba. */
  readonly ids: readonly string[]
  /**
   * Quantas linhas APONTAM para cada id, na mesma ordem — adesões no caso de
   * `Planos`, tarefas no caso de `Campanhas`.
   *
   * É o único critério objetivo que a planilha oferece, e ele só resolve o
   * caso fácil: **um** em uso. Dois em uso é decisão da clínica.
   */
  readonly usosPorId: readonly number[]
}

function agrupar<T extends { id: string; nome: string }>(
  aba: GrupoDeHomonimos['aba'],
  lista: readonly T[],
  usos: (x: T) => number,
): GrupoDeHomonimos[] {
  const grupos = new Map<string, T[]>()
  for (const x of lista) {
    const k = chaveDeNome(x.nome)
    grupos.set(k, [...(grupos.get(k) ?? []), x])
  }
  const out: GrupoDeHomonimos[] = []
  for (const [nomeChave, g] of grupos) {
    if (g.length < 2) continue
    out.push({ aba, nomeChave, ids: g.map((x) => x.id), usosPorId: g.map(usos) })
  }
  return out
}

/** Os grupos de `Planos` com o mesmo nome normalizado. */
export function homonimosDeProcedimento(dados: DadosDaV20): readonly GrupoDeHomonimos[] {
  return agrupar('Planos', dados.planos, (p: PlanoDaV20) =>
    dados.adesoes.filter((a) => a.planoId === p.id).length,
  )
}

/** Os grupos de `Campanhas` com o mesmo nome normalizado. */
export function homonimosDeCampanha(dados: DadosDaV20): readonly GrupoDeHomonimos[] {
  return agrupar(
    'Campanhas',
    dados.campanhas,
    (cp) => dados.tarefas.filter((t) => t.campanhaId === cp.id).length,
  )
}

/**
 * A escolha automática de um grupo, **ou `null` quando ela não é defensável**.
 *
 * `null` não é "não sei": é "duas destas estão em uso com parâmetros
 * diferentes, e desativar uma delas muda o que a clínica oferece hoje".
 */
export function escolhaAutomatica(g: GrupoDeHomonimos): string | null {
  const emUso = g.usosPorId.filter((n) => n > 0).length
  if (emUso > 1) return null
  if (emUso === 1) return g.ids[g.usosPorId.findIndex((n) => n > 0)] ?? null
  return g.ids[0] ?? null
}

/**
 * Completa as decisões com o que **é** determinado, e devolve o que falta.
 *
 * Nenhum perfil é preenchido automaticamente — nem o "Recepção" do roteiro.
 * A lista de pendências é o que vai para a clínica.
 */
export function pendenciasDeDecisao(
  dados: DadosDaV20,
  decisoes: Partial<DecisoesDaClinica>,
): readonly Achado[] {
  const out: Achado[] = []

  dados.equipe.forEach((p, i) => {
    if (p.admin) return
    if (decisoes.perfilPorPessoa?.has(p.id) === true) return
    out.push({
      aba: 'Equipe',
      linha: i + 2,
      coluna: 'admin',
      codigo: 'PerfilNaoRevisado',
      mensagem:
        `pessoa sem perfil decidido (funcao "${p.funcao}"). O roteiro sugere "Recepção" ` +
        'para admin = false, e ele PRECISA ser revisado com a clínica: Recepção carrega ' +
        'receber, caixa, contas e cobranças.',
    })
  })

  const grupos: readonly [GrupoDeHomonimos, ReadonlyMap<string, string> | undefined][] = [
    ...homonimosDeProcedimento(dados).map(
      (g) => [g, decisoes.ativoPorNome] as [GrupoDeHomonimos, ReadonlyMap<string, string> | undefined],
    ),
    ...homonimosDeCampanha(dados).map(
      (g) =>
        [g, decisoes.vivaPorNomeDeCampanha] as [
          GrupoDeHomonimos,
          ReadonlyMap<string, string> | undefined,
        ],
    ),
  ]

  for (const [g, mapa] of grupos) {
    const escolhido = mapa?.get(g.nomeChave)
    if (escolhido !== undefined) {
      if (!g.ids.includes(escolhido)) {
        out.push({
          aba: g.aba,
          linha: 0,
          coluna: 'nome',
          codigo: 'EscolhaForaDoGrupo',
          mensagem: `o id escolhido para o grupo de ${g.ids.length} homônimos não está nele`,
        })
      }
      continue
    }
    if (escolhaAutomatica(g) === null) {
      const oQue = g.aba === 'Planos' ? 'procedimentos' : 'campanhas'
      const quem = g.aba === 'Planos' ? 'programa de paciente' : 'tarefa'
      out.push({
        aba: g.aba,
        linha: 0,
        coluna: 'nome',
        codigo: 'HomonimosEmUso',
        mensagem:
          `${g.ids.length} ${oQue} com o mesmo nome normalizado, e ` +
          `${g.usosPorId.filter((n) => n > 0).length} deles têm ${quem} apontando para si. ` +
          'Qual continua vivo é decisão da clínica — o migrador não escolhe, e não funde os dois. ' +
          'Os outros entram como estado (desativado / soft delete), nunca apagados.',
      })
    }
  }

  return out
}
