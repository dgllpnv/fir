import type { HojeComProgramas } from '@fir/contracts'
import { temPerm } from '@fir/domain'
import { TelaHoje } from '@/components/tela-hoje'
import { buscarNoServidor } from '@/lib/busca-no-servidor'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/hoje` — a tela que a clínica deixa aberta o dia inteiro.
 *
 * A página é SERVIDOR: ela resolve a sessão e decide `podeEquipe` com
 * `temPerm` — a mesma função que o servidor da API usa (regra 16). O que
 * desce para o cliente é o booleano já resolvido, nunca a lista de perfis.
 *
 * Isto é conveniência de tela, não controle de acesso: `GET /v1/hoje` recusa
 * `escopo=equipe` sem a permissão, e é ele quem manda.
 */
export default async function Hoje() {
  const { eu, perfis, quem, minhaPessoaId } = await sessaoAtual()
  const podeEquipe = temPerm(quem, perfis, 'tarefas.equipe')
  // `fechar` cria dinheiro, e o servidor exige `receber` além de `jornada`
  // (decisão D-7). Aqui só se decide se o BOTÃO aparece.
  const podeReceber = temPerm(quem, perfis, 'receber')

  // A lista do dia vem JUNTO com o HTML, buscada de dentro da VPS.
  // Sem isto o navegador pediria por conta própria — e em Boston são 137 ms
  // a mais antes de a recepcionista ver qualquer tarefa (D-11). `null` aqui
  // não quebra nada: o cliente busca sozinho e mostra carregando.
  const CAMINHO_INICIAL = 'v1/hoje?escopo=meu'
  const inicial = await buscarNoServidor<HojeComProgramas>(CAMINHO_INICIAL)

  return (
    <TelaHoje
      eu={minhaPessoaId}
      podeEquipe={podeEquipe}
      podeReceber={podeReceber}
      podeValores={temPerm(quem, perfis, 'valores')}
      podePacientes={temPerm(quem, perfis, 'pacientes')}
      {...(inicial === null ? {} : { inicial: { caminho: CAMINHO_INICIAL, dados: inicial } })}
    />
  )
}
