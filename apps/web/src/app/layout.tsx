import type { Metadata } from 'next'
import { Cormorant_Garamond, Inter, Lora } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'
import { SCRIPT_DO_TEMA } from '@/lib/tema'

export const metadata: Metadata = { title: 'FIR Clinic' }

/**
 * **As fontes saem do próprio site, nunca do Google.** Antes, toda página da
 * recepção pedia Lora e Inter a `fonts.googleapis.com` — o endereço de rede de
 * cada clínica ia para um terceiro a cada tela, e o teste de navegador que
 * reprova qualquer requisição para fora da origem (gate appsec S-16) não
 * conseguia passar. O `next/font` baixa os arquivos **no build** e os serve como
 * arquivos estáticos daqui. As variáveis entram em `--display` e `--body`
 * (`packages/ui/src/tokens.css`).
 */
const lora = Lora({
  subsets: ['latin'],
  weight: ['500', '600'],
  display: 'swap',
  variable: '--fonte-lora',
})
// A serifa dos títulos do painel interno da Firmare (a do app Firmare Gestão que a cliente usa hoje).
// 500, 600 e 700: os mesmos pesos que o app da cliente carrega (a marca da lateral é 700).
const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600'],
  display: 'swap',
  variable: '--fonte-cormorant',
})
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--fonte-inter',
})

export default function RaizLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${lora.variable} ${cormorant.variable} ${inter.variable}`}>
      <head>
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
