'use client'

import type { ClienteNoPortal, PortalSaida } from '@fir/contracts'
import { useEffect, useState } from 'react'
import { chamar, ErroDaApi } from '@/lib/api'
import { usePortal } from '../contexto'
import { EspacoDaCliente } from '../espaco-da-cliente'
import { ErroDoPortal } from '../pecas'

/**
 * A LEITURA do portal — uma seção por `Cliente Firmare` visível ao `Usuário
 * do portal` (spec G6 §3.1), desenhada como o espaço da cliente do protótipo
 * (`fg-portal.js` L148–163) pela peça `EspacoDaCliente`, a mesma da prévia.
 * READ-ONLY: a única ação desta tela é ler (e copiar o texto de um material).
 *
 * Escopo `cliente`: o espaço inteiro. Escopo `grupo`: uma seção recolhível
 * por clínica, a primeira aberta (densidade, `design.md` §1).
 */
export default function ClientesDoPortal() {
  const { sessao } = usePortal()
  const [estado, setEstado] = useState<Estado>({ tag: 'carregando' })
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (sessao.tag !== 'pronta') return
    let valeu = true
    setEstado({ tag: 'carregando' })
    void (async () => {
      try {
        const r = await chamar<PortalSaida>('v1/portal/clientes')
        if (valeu) setEstado({ tag: 'pronto', itens: r.clientes })
      } catch (e) {
        if (valeu) {
          setEstado({ tag: 'erro', mensagem: e instanceof ErroDaApi ? e.message : 'Não foi possível carregar o seu espaço.' })
        }
      }
    })()
    return () => {
      valeu = false
    }
  }, [sessao.tag, tentativa])

  if (sessao.tag !== 'pronta' || estado.tag === 'carregando') {
    return <p className="portal-vazio-tracejado">Carregando o seu espaço…</p>
  }
  if (estado.tag === 'erro') {
    return <ErroDoPortal mensagem={estado.mensagem} recarregar={() => setTentativa((n) => n + 1)} />
  }
  if (estado.itens.length === 0) {
    return (
      <p className="portal-vazio-tracejado">
        Ainda não há uma clínica ligada a este acesso. Fale com a equipe Firmare.
      </p>
    )
  }

  const souGrupo = sessao.usuarioDoPortal.escopo === 'grupo'
  return (
    <div className="portal-clientes">
      {souGrupo ? (
        <>
          <h1 className="titulo">Suas clínicas</h1>
          <div className="portal-lista">
            {estado.itens.map((c, i) => (
              <details key={c.id} className="portal-cartao-cliente" open={i === 0}>
                <summary>
                  <span className="portal-nome-cliente">{c.nome}</span>
                  <span className="portal-produto">{c.produto}</span>
                </summary>
                <div className="portal-dentro-do-cartao">
                  <EspacoDaCliente cliente={c} baseDosAnexos="v1/portal/anexos" comCabecalho={false} />
                </div>
              </details>
            ))}
          </div>
        </>
      ) : (
        <EspacoDaCliente cliente={estado.itens[0]!} baseDosAnexos="v1/portal/anexos" />
      )}
      <p className="portal-rodape">Firmare Gestão Empresarial · área exclusiva da clínica</p>
    </div>
  )
}

type Estado = { tag: 'carregando' } | { tag: 'erro'; mensagem: string } | { tag: 'pronto'; itens: ClienteNoPortal[] }
