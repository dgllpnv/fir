import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaJornada } from '@/components/tela-jornada'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/jornada` — Comercial › Jornada do paciente.
 *
 * A página é SERVIDOR e resolve `jornada` com `temPerm` — a mesma função que a
 * API usa (regra 16). Isto é conveniência: a tela some do menu de quem não
 * tem a chave, e quem chega por URL vê "Sem acesso" em vez de um 403 cru. Quem
 * manda continua sendo `GET /v1/jornada`, que recusa sozinho.
 */
export default async function Jornada() {
  const { eu, perfis } = await sessaoAtual()
  const pode = temPerm(
    { admin: eu.usuario.admin, perfilId: eu.usuario.perfilId ?? '' },
    perfis,
    'jornada',
  )
  if (!pode) return <SemAcesso tela="Jornada do paciente" />
  return <TelaJornada />
}
