import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import { SCRIPT_DO_TEMA } from '@/lib/tema'

export const metadata: Metadata = { title: 'Firmare · Gestão de Rotina' }

export default function RaizLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Lora:wght@500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Antes de qualquer pixel. Com `useEffect` a página nasceria clara e
            piscaria para o escuro a cada navegação — numa ferramenta aberta o
            dia todo, isso é o dia todo. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_DO_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
