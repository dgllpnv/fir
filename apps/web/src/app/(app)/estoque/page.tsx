import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaEstoque } from '@/components/tela-estoque'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/estoque` — itens, contagem às cegas e análise.
 *
 * **`estoque` para entrar, `estoque.gerir` para cadastrar.** É a divisão que a
 * API cobra em cada escrita, e a razão dela é a do balcão: a enfermagem
 * registra o uso em paciente e conta a prateleira; o administrativo cadastra
 * item, local, custo e ajuste. A tela esconde o que a pessoa não pode, e o
 * servidor recusa de novo (regra 16) — a tela é conveniência.
 *
 * `hoje` vem do SERVIDOR, no fuso da clínica (regras 22 e 24): o teto da data
 * de movimento, o "vence em 60 dias" e o prazo da contagem saem dele. Com o
 * relógio do navegador, o computador de balcão com a data errada lançaria
 * entrada no futuro.
 */
export default async function Estoque() {
  const { eu, perfis, quem, minhaPessoaId } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'estoque')) return <SemAcesso tela="Estoque" />
  return (
    <TelaEstoque
      hoje={eu.hoje}
      podeGerir={temPerm(quem, perfis, 'estoque.gerir')}
      minhaPessoaId={minhaPessoaId}
    />
  )
}
