// Sobe os três workers da carteira (G3 cobranças, G4 uso diário, G5 rotinas
// internas) e o da agenda externa em paralelo, para desenvolvimento local. Processo Node puro —
// sem depender de sintaxe de shell (`&`, `wait`) que diverge entre
// PowerShell/cmd e bash, e sem adicionar `concurrently` como dependência só
// para isto.
//
// Uso: pnpm --filter @fir/api dev:workers  (ou `fir workers`, ver fir.bat)
// Requer Redis local no ar (`fir infra`) — os três workers conectam em
// redis://127.0.0.1:4879 por padrão (ver REDIS_URL em
// src/carteira/jobs/fila-uso-diario.ts, src/carteira/financeiro/
// fila-cobrancas.ts e src/carteira/prospeccao/fila-rotinas-internas.ts).

import { spawn } from 'node:child_process'

const ALVOS = [
  { nome: 'uso-diario', arquivo: 'src/carteira/jobs/worker-uso-diario.ts' },
  { nome: 'cobrancas', arquivo: 'src/carteira/financeiro/worker-cobrancas.ts' },
  { nome: 'rotinas-internas', arquivo: 'src/carteira/prospeccao/worker-rotinas-internas.ts' },
  // A sincronização da agenda iCal (ADR 0019). Diferente dos três acima, este
  // também roda em produção (`worker-agenda` no compose). Localmente ele
  // precisa de internet para baixar o feed — a máquina de desenvolvimento tem.
  { nome: 'agenda', arquivo: 'src/agenda/worker-agenda.ts' },
]

const processos = ALVOS.map(({ nome, arquivo }) => {
  const processo = spawn('pnpm', ['exec', 'tsx', 'watch', arquivo], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  processo.on('exit', (codigo) => {
    console.log(`[dev:workers] ${nome} encerrou (codigo ${String(codigo)})`)
  })
  return processo
})

const desligarTodos = () => {
  for (const processo of processos) {
    processo.kill()
  }
}

process.on('SIGINT', desligarTodos)
process.on('SIGTERM', desligarTodos)
