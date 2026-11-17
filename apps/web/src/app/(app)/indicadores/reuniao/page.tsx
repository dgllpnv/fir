import { ModoReuniao } from '@/components/indicadores/reuniao-modo'
import { sessaoAtual } from '@/lib/sessao'

/**
 * `/indicadores/reuniao` — o Modo reunião (I-43, 1.9 F). O layout de
 * `/indicadores` já conferiu `indicadores` e diz "Sem acesso a esta tela" a
 * quem chegou pela URL sem ela; `GET /v1/indicadores/reuniao` recusa do mesmo
 * jeito.
 */
export default async function ReuniaoPage() {
  const { minhaPessoaId } = await sessaoAtual()
  return <ModoReuniao minhaPessoaId={minhaPessoaId} />
}
