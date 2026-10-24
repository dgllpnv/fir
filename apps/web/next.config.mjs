/**
 * O navegador chama `/api/...` na MESMA origem do web, e o servidor do Next
 * repassa para a API pela rede interna.
 *
 * Não é conveniência: é o que faz o cookie `__Host-fir-sessao` funcionar sem
 * CORS. `__Host-` proíbe `Domain`, então o cookie só vale na origem exata —
 * e uma API em outra origem simplesmente não o receberia.
 *
 * `??` não cai no padrão para string vazia: um `ARG` do Docker não passado
 * vira `ENV` vazia. Daí o `||`.
 */
const API = process.env.FIR_API_URL || 'http://127.0.0.1:4811'

export default {
  reactStrictMode: true,
  transpilePackages: ['@fir/contracts', '@fir/domain', '@fir/ui'],
  /**
   * DEFEITO DO BRIEF (Task 18): os pacotes do workspace exportam TS fonte com
   * especificadores relativos terminados em `.js` apontando para arquivos
   * `.ts` (estilo NodeNext) — ex.: `export * from './dinheiro.js'` em
   * `packages/domain/src/index.ts`, que na verdade é `dinheiro.ts`.
   *
   * `tsc` resolve isso (moduleResolution: "Bundler"), e `tsx` resolve isso em
   * tempo de execução na API. Mas o bundler de desenvolvimento do Next 16,
   * Turbopack, NÃO troca a extensão de um especificador que já tem uma —
   * só tenta extensões quando o especificador não tem nenhuma. Resultado:
   * "Module not found: Can't resolve './dinheiro.js'" ao abrir qualquer tela
   * sob `(app)/layout.tsx`, que importa `@fir/domain`.
   *
   * O Webpack do Next já resolve isso nativamente via
   * `resolve.extensionAlias`, acionado por `experimental.extensionAlias`
   * abaixo — por isso o `dev`/`build` deste app usam `--webpack` em vez do
   * Turbopack padrão (ver package.json). Não editamos os pacotes do
   * workspace: a correção fica inteira em `apps/web`.
   */
  experimental: {
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  async rewrites() {
    return [{ source: '/api/:caminho*', destination: `${API}/:caminho*` }]
  },
}
