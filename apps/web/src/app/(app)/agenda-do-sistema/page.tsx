import { temPerm } from '@fir/domain'
import { SemAcesso } from '@/components/sem-acesso'
import { TelaAgendaDoSistema } from '@/components/tela-agenda-do-sistema'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/agenda-do-sistema` — o link iCal da agenda da clínica (ADR 0019).
 *
 * `config`, o mesmo que `GET/PUT /v1/agenda-externa` exigem. O servidor recusa
 * de qualquer jeito; esta checagem é para quem chega pelo endereço ver "Sem
 * acesso" em vez de uma tela que falha bloco a bloco.
 *
 * O fuso e o `hoje` vêm da sessão (servidor): a última leitura é mostrada no
 * relógio da clínica, não no do aparelho (regras 22 e 24).
 */
export default async function AgendaDoSistema() {
  const { eu, perfis, quem } = await sessaoAtual()
  if (!temPerm(quem, perfis, 'config')) return <SemAcesso tela="Agenda do sistema" />
  return <TelaAgendaDoSistema fuso={eu.clinica.fuso} hoje={eu.hoje} />
}
