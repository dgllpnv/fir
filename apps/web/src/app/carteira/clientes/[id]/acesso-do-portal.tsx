'use client'

import { EspacoDaClientePainel } from '@/components/carteira/espaco-da-cliente-painel'

/**
 * O espaço da cliente na ficha (V7, O9, O10) — a peça mora em
 * `components/carteira/espaco-da-cliente-painel.tsx` (G8 3D). Este arquivo
 * fica como o ponto de montagem que `visao-geral.tsx` já importa, para a
 * ficha (1A) não precisar mudar.
 */
export default function AcessoDoPortalDoCliente({
  clienteCarteiraId,
  nomeDoCliente,
}: {
  clienteCarteiraId: string
  nomeDoCliente: string
}) {
  return <EspacoDaClientePainel clienteId={clienteCarteiraId} nomeDoCliente={nomeDoCliente} />
}
