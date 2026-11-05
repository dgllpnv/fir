import { describe, expect, it } from 'vitest'
import { redigir } from '../../comum/redacao.interceptor'

/**
 * **G3 — regra 17 (redação de valores), aplicada aos campos novos.**
 *
 * Não é um teste de rota HTTP (o módulo ainda não está registrado em
 * `AppModule` — ver o relatório do ticket): é o tradutor único, `redigir`,
 * exercitado com a FORMA exata das respostas de `CobrancaCarteiraNaLista` e
 * `MetaComercialNaLista` — a mesma função que o `RedacaoInterceptor` global já
 * aplica a toda resposta da API, carteira incluída.
 *
 * Hoje nenhuma requisição de carteira popula `req.contexto` (ela popula
 * `req.carteira` — espaço de identidade disjunto, ver
 * `contexto-da-carteira.ts`), então `RedacaoInterceptor` sempre cai no
 * `pode = () => false` para toda rota de carteira — este teste prova
 * exatamente essa falha fechada para os quatro campos novos de G3.
 */
describe('redigir — os campos novos de G3 (mensalidade, desconto, valor, valorMeta, valorInicial)', () => {
  const resposta = {
    cobrancas: [
      { id: '1', mensalidade: '185033', desconto: '18504', valor: '166529', status: 'aberto' },
    ],
    somaValor: '166529',
  }

  it('sem a permissão valores, os quatro campos saem null — a FORMA não muda', () => {
    const r = redigir(resposta, () => false) as typeof resposta
    expect(r.cobrancas[0]!.mensalidade).toBeNull()
    expect(r.cobrancas[0]!.desconto).toBeNull()
    expect(r.cobrancas[0]!.valor).toBeNull()
    expect(r.somaValor).toBeNull()
    expect(r.cobrancas[0]!.status).toBe('aberto') // não-monetário atravessa
  })

  it('com a permissão valores, os valores atravessam intactos', () => {
    const r = redigir(resposta, () => true) as typeof resposta
    expect(r.cobrancas[0]!.mensalidade).toBe('185033')
    expect(r.cobrancas[0]!.desconto).toBe('18504')
    expect(r.cobrancas[0]!.valor).toBe('166529')
    expect(r.somaValor).toBe('166529')
  })

  it('valorMeta e valorInicial de uma Meta comercial são redigidos do mesmo jeito', () => {
    const meta = { titulo: 'Crescer', valorMeta: '5000000', valorInicial: '3800000', status: 'em_andamento' }
    const semPermissao = redigir(meta, () => false) as typeof meta
    expect(semPermissao.valorMeta).toBeNull()
    expect(semPermissao.valorInicial).toBeNull()
    expect(semPermissao.status).toBe('em_andamento')
  })
})
