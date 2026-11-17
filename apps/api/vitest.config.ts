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
    // E o SEGUNDO FATOR da carteira: desligado, que é o padrão de produção
    // desde a D-23 (ADR 0023) — fixado aqui para que um shell com a chave
    // ligada não mude o que os e2e medem. `segundo-fator.e2e.test.ts` a liga
    // para si e mede a regra da ADR 0022.
    env: {
      MAX_LOGIN_POR_ORIGEM: '5000',
      MAX_PAINEL_POR_ORIGEM: '5000',
      SEGUNDO_FATOR_CARTEIRA_LIGADO: 'false',
      // O ENVIO DE E-MAIL desligado, fixado: um shell com `SMTP_HOST` não muda o
      // que os e2e medem. `acesso-por-email.e2e.test.ts` liga o seu, com o
      // correio que captura. E o limite por origem do esqueci-senha (5 por
      // hora) alto, pela mesma razão do entrar: o describe dedicado mede o 429.
      SMTP_HOST: '',
      URL_PUBLICA: '',
      MAX_ESQUECI_POR_ORIGEM: '5000',
    },
  },
})
