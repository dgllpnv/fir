'use client'

import type { ClienteNoPortal, PreviaDoPortalSaida } from '@fir/contracts'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { EspacoDaCliente } from '../../espaco-da-cliente'
import { ErroDoPortal } from '../../pecas'

/**
 * **"Ver como a cliente"** (O9; `?preview=` do protótipo, `sb:L325-326`,
 * faixa `portal:L150`). Aberta pela ficha, em outra aba.
 *
 * Quem olha é o `Usuário de Gestão` — a sessão é a da CARTEIRA (`GET
 * /v1/carteira/clientes/:id/previa-do-portal`), nunca a do `Usuário do
 * portal` (appsec A-18). Por isso esta página fica fora do provedor do portal
 * (`casco.tsx`) e não tem a faixa dele: tem a faixa da prévia. O dinheiro sai
 * redigido pela permissão `valores` de quem olha.
 */
export default function PreviaDoPortal() {
  const { id } = useParams<{ id: string }>()
  const [estado, setEstado] = useState<
    { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronta'; cliente: ClienteNoPortal }
  >({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let valeu = true
    setEstado({ tag: 'carregando' })
    chamar<PreviaDoPortalSaida>(`v1/carteira/clientes/${encodeURIComponent(id)}/previa-do-portal`)
      .then((r) => valeu && setEstado({ tag: 'pronta', cliente: r.cliente }))
      .catch((e: unknown) => {
        if (!valeu) return
        setEstado({
          tag: 'erro',
          mensagem:
            e instanceof ErroDaApi && e.status === 404
              ? 'Cliente não encontrada, ou fora da sua carteira. Entre na ferramenta e abra a ficha de novo.'
              : e instanceof ErroDaApi
                ? e.message
                : 'Não consegui falar com o servidor. Confira a conexão.',
        })
      })
    return () => {
      valeu = false
    }
  }, [id, tentativa])

  return (
    <div className="portal">
      <div className="portal-faixa-previa" role="status">
        Você está vendo o espaço exatamente como a cliente vê. <a href={`/carteira/clientes/${encodeURIComponent(id)}`}>Voltar para a ferramenta</a>
      </div>
      <div className="portal-corpo">
        <main className="wrap">
          {estado.tag === 'carregando' ? (
            <p className="portal-vazio-tracejado">Carregando o espaço da cliente…</p>
          ) : estado.tag === 'erro' ? (
            <ErroDoPortal mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
          ) : (
            <div className="portal-clientes">
              <EspacoDaCliente cliente={estado.cliente} baseDosAnexos="v1/carteira/anexos" />
              <p className="portal-rodape">Firmare Gestão Empresarial · área exclusiva da clínica</p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
