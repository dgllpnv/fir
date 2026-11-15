import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaOutrasEntradas } from '@/components/tela-outras-entradas'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/outras-entradas` — dinheiro que entrou e não é de paciente.
 *
 * Página de SERVIDOR. `hoje` vem de `/v1/eu` (dia de negócio da clínica, regra 24).
 * Lançar e estornar exigem `receber`; as categorias, `contas.gerir` — o servidor
 * confere as duas, a tela só decide o que mostrar.
 */
export default async function OutrasEntradas() {
  const { eu, perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'receber')) return <SemAcesso tela="Outras entradas" />
  return (
    <TelaOutrasEntradas
      hoje={eu.hoje}
      podeValores={temPerm(quem, perfis, 'valores')}
      podeGerirCategorias={temPerm(quem, perfis, 'contas.gerir')}
    />
  )
}
