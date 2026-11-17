'use client'

import type { ContadorDeIndicadores } from '@fir/contracts'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { chamar } from '@/lib/api'
import {
  INTERVALO_DO_CONTADOR_MS,
  precisaPerguntar,
  RESPIRO_DO_CONTADOR_MS,
  rotuloDoContador,
  textoDoContador,
} from './fora-da-aba'
import './fora-da-aba.css'

/**
 * **O contador vermelho do item "Indicadores & Insights"** (1.9 A): o número
 * de metas vivas em `abaixo`, o mesmo da capa do Modo reunião. Some no zero.
 *
 * Só é montado no item do menu, e o item só existe para quem tem
 * `indicadores` — o menu já veio filtrado do servidor; aqui não se decide
 * acesso. Pergunta ao montar, de novo a cada 10 minutos com a aba visível, e
 * ao voltar à aba ou trocar de tela se já passou um minuto. Erro não mostra
 * nada: o selo é aviso, não tela, e um "erro" no menu assustaria à toa.
 */
export function ContadorDoMenu() {
  const rota = usePathname()
  const [abaixo, setAbaixo] = useState<number | null>(null)
  const ultima = useRef<number | null>(null)
  const emVoo = useRef(false)

  const perguntar = useRef((forcar: boolean) => {
    if (emVoo.current) return
    if (!forcar && !precisaPerguntar(ultima.current, Date.now(), RESPIRO_DO_CONTADOR_MS)) return
    emVoo.current = true
    ultima.current = Date.now()
    chamar<ContadorDeIndicadores>('v1/indicadores/contador')
      .then((r) => setAbaixo(r.abaixo))
      .catch(() => undefined)
      .finally(() => {
        emVoo.current = false
      })
  })

  // Trocar de tela (inclusive voltar de Indicadores depois de lançar um valor).
  useEffect(() => {
    perguntar.current(false)
  }, [rota])

  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') perguntar.current(true)
    }, INTERVALO_DO_CONTADOR_MS)
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') perguntar.current(false)
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  const texto = textoDoContador(abaixo)
  if (texto === null || abaixo === null) return null
  return (
    <span className="ii-contador-menu" data-contador="indicadores">
      <span aria-hidden="true">{texto}</span>
      <span className="sr-apenas">, {rotuloDoContador(abaixo)}</span>
    </span>
  )
}
