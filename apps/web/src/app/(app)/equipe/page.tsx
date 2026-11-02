import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaEquipe } from '@/components/tela-equipe'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/equipe` — a ficha de RH, os alertas, as férias, os documentos e o banco
 * de horas.
 *
 * **`pessoas.gerir`, e nada menos.** É a mesma chave que `EquipeController`
 * exige em cada rota de `/v1/fichas`, e a razão é o salário: *"Equipe: fichas,
 * metas, conversas 1:1 e banco de horas — dados de RH (inclui salário)"* é a
 * descrição da chave na matriz. Quem não a tem não vê o item no menu e, se
 * chegar por URL, vê "Sem acesso" — e o servidor recusa de novo (regra 16).
 *
 * **Não é `config`.** *Usuários e acessos* é outra tela, com outra chave e
 * outro público: login, perfil e ativação. Juntar as duas poria salário e
 * permissão na mesma tela — a nota que a navegação dela deixou registrada em
 * `docs/paridade.md`.
 *
 * `hoje` vem do SERVIDOR, no fuso da clínica (regra 24): é dele que sai o mês
 * que o banco de horas abre. Com o relógio do navegador, o computador de
 * balcão com a data errada abriria o mês que não é.
 */
export default async function EquipePage() {
  const { eu, perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'pessoas.gerir')) return <SemAcesso tela="Equipe" />
  return <TelaEquipe hoje={eu.hoje} />
}
