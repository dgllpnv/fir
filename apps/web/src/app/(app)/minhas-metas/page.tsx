import { temPerm } from '@fir/domain'
import { TelaMinhasMetas } from '@/components/tela-minhas-metas'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/minhas-metas` — **a tela que TODO perfil tem.**
 *
 * **Sem `temPerm`, e isso é desenho.** Na navegação dela o item é `perm:
 * null`, e o `pesSaida` do protótipo prova por quê: quem não tem
 * `pessoas.gerir` recebe a própria ficha reduzida e as próprias metas, e nada
 * mais (`conversas: []`, `horas: []`). A recepcionista precisa ver o que
 * combinou bater — é o ritual que a ferramenta existe para instalar.
 *
 * **A defesa é a ROTA não ter parâmetro de pessoa.** `GET
 * /v1/minhas-metas/:mes` acha a ficha por `pessoa_id = ator`; um `?fichaId=`
 * ali seria a porta pela qual a recepção lê a meta — e o atingimento — da
 * colega, numa tela sem permissão nenhuma. A tela não tem como pedir a de
 * outra pessoa porque o servidor não tem como responder.
 *
 * `hoje` vem do SERVIDOR, no fuso da clínica (regra 24): é dele que sai o mês
 * que a tela abre. Com o relógio do navegador, o computador de balcão com a
 * data errada abriria o mês que não é.
 */
export default async function MinhasMetasPage() {
  const { eu, perfis, quem } = await sessaoAtual()
  // O atalho "Ir para Equipe" é conveniência de quem tem `pessoas.gerir`.
  return (
    <TelaMinhasMetas hoje={eu.hoje} podeGerirEquipe={temPerm(quem, perfis, 'pessoas.gerir')} />
  )
}
