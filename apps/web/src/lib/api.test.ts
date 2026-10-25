import { afterEach, describe, expect, it, vi } from 'vitest'
import { chamar, ErroDaApi } from './api'

/**
 * O cabeçalho `content-type` não é detalhe de transporte — é o que decidiu, em
 * produção, se duas ações funcionavam.
 *
 * Medido no navegador, contra a API de verdade: um `DELETE` ou `POST` com
 * `content-type: application/json` e SEM corpo é recusado pelo Fastify com
 * *"Body cannot be empty when content-type is set to 'application/json'"* —
 * 400, antes de o controlador existir. Isso quebrava DUAS coisas de uma vez:
 *
 *  - **Excluir tarefa** (`DELETE /v1/tarefas/:id?serie=false`), que mostrava a
 *    mensagem do Fastify na tela de edição;
 *  - **Sair** (`POST /v1/sair`), que falhava em SILÊNCIO — o `catch` manda a
 *    pessoa para `/entrar` de qualquer jeito, e como a resposta 204 (a que
 *    apaga o cookie) nunca chegou, a sessão continuava VÁLIDA no servidor.
 *
 * Declarar o tipo de um corpo que não se manda é descrever uma requisição que
 * não é esta. O teste trava as duas pontas.
 */
const respostaVazia = () =>
  ({ ok: true, status: 204, json: async () => ({}) }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

function espiar(): { chamadas: [string, RequestInit][] } {
  const chamadas: [string, RequestInit][] = []
  vi.stubGlobal('fetch', (url: string, opcoes: RequestInit) => {
    chamadas.push([url, opcoes])
    return Promise.resolve(respostaVazia())
  })
  return { chamadas }
}

const cabecalhos = (o: RequestInit): Record<string, string> =>
  (o.headers ?? {}) as Record<string, string>

describe('chamar', () => {
  it('NÃO declara content-type quando não há corpo', async () => {
    const espiao = espiar()
    await chamar('v1/tarefas/abc?serie=false', { method: 'DELETE' })
    expect(cabecalhos(espiao.chamadas[0]![1])['content-type']).toBeUndefined()
  })

  it('NÃO declara content-type no POST sem corpo — era o "Sair" que não saía', async () => {
    const espiao = espiar()
    await chamar('v1/sair', { method: 'POST' })
    expect(cabecalhos(espiao.chamadas[0]![1])['content-type']).toBeUndefined()
  })

  it('declara content-type quando HÁ corpo', async () => {
    const espiao = espiar()
    await chamar('v1/tarefas', { method: 'POST', body: '{"a":1}' })
    expect(cabecalhos(espiao.chamadas[0]![1])['content-type']).toBe('application/json')
  })

  it('o corpo `{}` conta como corpo — cancelar e reabrir mandam exatamente isso', async () => {
    const espiao = espiar()
    await chamar('v1/tarefas/abc/cancelar', { method: 'POST', body: '{}' })
    expect(cabecalhos(espiao.chamadas[0]![1])['content-type']).toBe('application/json')
  })

  it('o cookie de sessão viaja em toda chamada', async () => {
    const espiao = espiar()
    await chamar('v1/hoje')
    expect(espiao.chamadas[0]![1].credentials).toBe('include')
  })

  it('erro da API vira ErroDaApi com a mensagem do servidor', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: false,
        status: 403,
        json: async () => ({ message: 'Sem acesso a esta ação.' }),
      } as unknown as Response),
    )
    await expect(chamar('v1/pacientes')).rejects.toThrow(ErroDaApi)
    await expect(chamar('v1/pacientes')).rejects.toThrow('Sem acesso a esta ação.')
  })
})
