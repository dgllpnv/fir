import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // `fileParallelism: false` não é otimização ao contrário — é correção.
    //
    // Estes testes são de integração contra UM Postgres real, e dois deles
    // CRIAM E APAGAM objetos no schema `public` para dar piso às varreduras
    // (os canários de view, matview e partição). Em paralelo, a varredura de
    // um arquivo enxerga o canário do outro — e, pior, enxerga a janela de
    // milissegundos entre o `CREATE TABLE` e o `REVOKE` que o torna correto.
    //
    // O sintoma era vermelho alternado: a mesma suíte passava numa rodada e
    // reprovava na seguinte, acusando um defeito que não existia. Teste
    // não-determinístico é pior que teste ausente: ensina a equipe a rodar de
    // novo até passar, e aí o vermelho verdadeiro também vira ruído.
    //
    // Só o pacote `teste` paga isto. Os pacotes sem banco seguem paralelos.
    fileParallelism: false,
  },
})
