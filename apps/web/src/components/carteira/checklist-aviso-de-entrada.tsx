'use client'

import type { EntradaDoClienteSaida, PassoDaEntradaSaida } from '@fir/contracts'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ModalImportarDoAsana, recadoDaImportacao } from '@/components/carteira/importar-do-asana'
import { chamar, ErroDaApi } from '@/lib/api'

/**
 * **"Entrada de cliente que já é da Firmare"** (C6, `avisoMigracao`,
 * `index.html` L1723–1728): o aviso permanente na visão geral da ficha até o
 * cadastro ficar completo e as reuniões do Asana serem resolvidas.
 * Pronto para a ficha montar: `<AvisoDeEntrada clienteId=… />`.
 *
 * O que falta é decidido no servidor (`faltasDaEntrada`, `packages/domain`).
 * "Importar reuniões do Asana" abre o modal do ticket 4B; importar ao menos
 * uma resolve o passo no servidor (`reunioes_importadas`).
 */
const dataBr = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`

export function AvisoDeEntrada({ clienteId }: { clienteId: string }) {
  const [dados, setDados] = useState<EntradaDoClienteSaida | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [importando, setImportando] = useState(false)
  const [recado, setRecado] = useState<string | null>(null)
  const fecharImportacao = useCallback(() => setImportando(false), [])

  useEffect(() => {
    let valeu = true
    void chamar<EntradaDoClienteSaida>(`v1/carteira/clientes/${clienteId}/entrada`)
      .then((d) => valeu && setDados(d))
      .catch((e: unknown) => valeu && setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível ler a entrada da cliente.'))
    return () => {
      valeu = false
    }
  }, [clienteId, tentativa])

  if (erro) {
    return (
      <div className="erro-de-tela" role="alert">
        <p>{erro}</p>
        <button type="button" className="btn ghost" onClick={() => { setErro(null); setTentativa((n) => n + 1) }}>
          Recarregar
        </button>
      </div>
    )
  }
  if (!dados || !dados.mostrarAviso) return null

  const dispensar = async () => {
    try {
      await chamar<PassoDaEntradaSaida>(`v1/carteira/clientes/${clienteId}/entrada/asana/dispensar`, { method: 'POST' })
      setTentativa((n) => n + 1)
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível registrar.')
    }
  }

  const faltaMetas = dados.faltas.some((f) => f.codigo === 'metas')
  const faltaCadastro = dados.faltas.some((f) => f.codigo !== 'metas')
  return (
    <section className="check-aviso" aria-labelledby="check-aviso-titulo">
      <div className="check-cabeca">
        <h2 id="check-aviso-titulo" className="check-titulo">
          Entrada de cliente que já é da Firmare
        </h2>
        <span className="check-mudo">
          Cliente desde <span className="num">{dados.clienteDesde ? dataBr(dados.clienteDesde) : 'data não informada'}</span>
        </span>
      </div>
      {dados.faltas.length > 0 ? (
        <>
          <p className="check-texto">Para o painel e a rotina funcionarem, ainda falta:</p>
          <ul className="check-faltas">
            {dados.faltas.map((f) => (
              <li key={f.codigo}>{f.texto}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="check-texto">Cadastro completo.</p>
      )}
      <div className="check-acoes">
        {faltaMetas ? (
          <Link className="btn" href={`/carteira/entrada/${clienteId}/metas`}>
            Cadastrar metas em andamento
          </Link>
        ) : null}
        {faltaCadastro ? (
          <Link className="btn ghost" href={`/carteira/clientes/${clienteId}/cadastro`}>
            Completar cadastro
          </Link>
        ) : null}
        {!dados.asanaResolvido ? (
          <button type="button" className="btn ghost" onClick={() => setImportando(true)}>
            Importar reuniões do Asana
          </button>
        ) : null}
        {!dados.asanaResolvido ? (
          <button type="button" className="link" onClick={() => void dispensar()}>
            Não há reuniões para importar
          </button>
        ) : null}
      </div>
      {recado ? (
        <p className="check-recado" role="status">
          {recado}
        </p>
      ) : null}
      {importando ? (
        <ModalImportarDoAsana
          clienteId={clienteId}
          aoFechar={fecharImportacao}
          aoImportar={(r) => {
            setImportando(false)
            setRecado(recadoDaImportacao(r))
            setTentativa((n) => n + 1)
          }}
        />
      ) : null}
    </section>
  )
}
