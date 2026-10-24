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
  async rewrites() {
    return [{ source: '/api/:caminho*', destination: `${API}/:caminho*` }]
  },
}
