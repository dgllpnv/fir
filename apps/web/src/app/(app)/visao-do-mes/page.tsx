import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaVisaoDoMes } from '@/components/tela-visao-do-mes'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/visao-do-mes` — a tela que decide.
 *
 * `finmes` depende de `valores`, e `temPerm` resolve a dependência: marcar
 * `finmes` sem `valores` não abre esta tela nem a rota.
 *
 * `podeAbrirContas`: as linhas de "Pago por forma" só levam à lista de Contas
 * com `contas.gerir` (ADR 0020). Sem ela a lista mostra só as contas da
 * própria pessoa, e o número dela ficaria menor que o do bloco.
 */
export default async function VisaoDoMes() {
  const { eu, perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'finmes')) return <SemAcesso tela="Visão do mês" />
  return (
    <TelaVisaoDoMes
      mesCorrente={eu.hoje.slice(0, 7)}
      podeAbrirContas={temPerm(quem, perfis, 'contas.gerir')}
    />
  )
}
