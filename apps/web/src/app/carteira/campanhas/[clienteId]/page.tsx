'use client'

import { useParams } from 'next/navigation'
import Link from 'next/link'
import CampanhasDoCliente from '@/components/carteira/campanhas-do-cliente'
import { useCarteira } from '../../contexto'
import { NavDaCarteira } from '../../pecas'
import { Carregando } from '@/components/estados'

/**
 * As campanhas de UM cliente — o destino de "Valor gerado por cliente" na tela
 * comparativa (no protótipo, o clique abre a aba Campanhas da ficha,
 * `data-aba-go="campanhas"`, L1985). Quando a ficha em abas (1A) existir, a
 * aba usa o mesmo componente, e esta rota pode virar redirecionamento.
 */
export default function CampanhasDeUmCliente() {
  const { clienteId } = useParams<{ clienteId: string }>()
  const { sessao } = useCarteira()
  return (
    <section>
      <NavDaCarteira atual="/carteira/campanhas" />
      <p className="nota">
        <Link className="link" href="/carteira/campanhas">
          Campanhas
        </Link>{' '}
        ·{' '}
        <Link className="link" href={`/carteira/clientes/${clienteId}`}>
          Ficha do cliente
        </Link>
      </p>
      <h1 className="titulo">Campanhas do cliente</h1>
      {sessao.tag === 'pronta' ? <CampanhasDoCliente clienteId={clienteId} /> : <Carregando linhas={4} />}
    </section>
  )
}
