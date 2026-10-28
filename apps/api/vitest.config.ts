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
    // E o do PAINEL, pela mesma razão e com mais força: o teto real dele é
    // 10 em 15 minutos, e `painel.e2e.test.ts` sozinho dispara mais de 20
    // entradas do mesmo loopback. Quem mede o limite de verdade é o
    // `describe` dedicado, que substitui o provedor por uma instância de
    // teto 3.
    env: { MAX_LOGIN_POR_ORIGEM: '5000', MAX_PAINEL_POR_ORIGEM: '5000' },
  },
})
