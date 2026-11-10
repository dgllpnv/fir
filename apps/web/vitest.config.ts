import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': fileURLToPath(new URL('./src/', import.meta.url)) } },
  // Sem isto o esbuild compila JSX para `React.createElement` e o teste que
  // importa `lib/icones.tsx` morre com "React is not defined". O Next já usa o
  // runtime automático; aqui a configuração só passa a mesma informação.
  esbuild: { jsx: 'automatic' },
})
