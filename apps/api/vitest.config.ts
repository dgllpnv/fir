import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // O limite de login por origem (60 em 5 min) contaria as ~30 entradas que
    // o e2e dispara do mesmo loopback, e o teste passaria a depender de um
    // parâmetro que não é o que ele mede. Quem mede o limite é
    // `limite-por-origem.test.ts` (a janela deslizante) e o describe
    // dedicado do e2e, que substitui o provedor por uma instância de teto 3.
    env: { MAX_LOGIN_POR_ORIGEM: '5000' },
  },
})
