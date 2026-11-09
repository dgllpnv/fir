/**
 * E2E do web — Playwright contra um web e uma API NO AR (CLAUDE.md §7).
 *
 * Fora do `pnpm test` de propósito: estes testes precisam do web servido, da
 * API respondendo e do banco local semeado (`pnpm db:seed`, clínica `demo`).
 * Rodar:
 *
 *   fir                                   # Postgres/Redis locais
 *   pnpm db:migrate && pnpm db:seed
 *   pnpm --filter @fir/api dev            # API em 4811
 *   pnpm --filter @fir/web build && pnpm --filter @fir/web start   # web em 4810
 *   pnpm test:e2e                         # na raiz (ou `pnpm --filter @fir/web test:e2e`)
 *
 * Variáveis: `FIR_E2E_URL` (padrão `http://127.0.0.1:4810`) e, para outra
 * pessoa que não a da semente, `FIR_E2E_CLINICA`, `FIR_E2E_USUARIO`,
 * `FIR_E2E_SENHA`. O navegador é o Chromium da versão do `@playwright/test`
 * (`pnpm --filter @fir/web exec playwright install chromium`, uma vez).
 *
 * Um worker só: os testes escrevem no banco da clínica de demonstração e
 * apagam o que criaram. Os arquivos são `*.e2e.ts` para que o Vitest do web
 * (`src/**\/*.test.ts`) nunca os pegue.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env['CI'],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  // Fora da árvore: rastro e captura de falha não entram no repositório.
  outputDir: join(tmpdir(), 'fir-e2e-resultados'),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env['FIR_E2E_URL'] || 'http://127.0.0.1:4810',
    // 390 px é o caso principal do balcão (docs/design.md).
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
