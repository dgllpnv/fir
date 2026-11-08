import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ErroDaApi } from './api'
import { comConfirmacao, ConfirmacaoRecusada, perguntasDosAvisos } from './confirmacao'

const precisa = (...avisos: string[]) =>
  new ErroDaApi(409, 'Confirme antes de lançar este recebimento.', 'CONFIRMACAO_NECESSARIA', avisos)

describe('perguntasDosAvisos', () => {
  const ctx = { dia: '2026-11-08', hoje: '2026-11-08', valor: 15000n, podeVerValores: true }

  it('caixa fechado diz o dia e o que vai acontecer, sem valor', () => {
    expect(perguntasDosAvisos(['CAIXA_FECHADO'], ctx)).toEqual([
      'O caixa de 08/11 já foi fechado. Lançar mesmo assim? O dia vai aparecer como alterado depois do fechamento.',
    ])
  })

  it('duplicidade COM `valores`: o valor digitado, pelo formatador central', () => {
    expect(perguntasDosAvisos(['POSSIVEL_DUPLICIDADE'], ctx)).toEqual([
      'Já existe um pagamento de R$ 150,00 para esta paciente hoje. É outro pagamento?',
    ])
  })

  it('duplicidade SEM `valores`: nenhum algarismo', () => {
    const [frase] = perguntasDosAvisos(['POSSIVEL_DUPLICIDADE'], { ...ctx, podeVerValores: false })
    expect(frase).not.toMatch(/\d/)
  })

  it('outro dia que não hoje vira "em 07/11"', () => {
    const [frase] = perguntasDosAvisos(['POSSIVEL_DUPLICIDADE'], { ...ctx, dia: '2026-11-07' })
    expect(frase).toContain('em 07/11')
  })
})

describe('comConfirmacao', () => {
  it('sem aviso, envia uma vez e devolve', async () => {
    const envios: unknown[] = []
    const r = await comConfirmacao(
      async (conf) => {
        envios.push(conf)
        return 'ok'
      },
      async () => true,
    )
    expect(r).toBe('ok')
    expect(envios).toEqual([{}])
  })

  it('confirmado, reenvia com a chave de CADA aviso', async () => {
    const envios: Record<string, true>[] = []
    const r = await comConfirmacao(
      async (conf) => {
        envios.push({ ...conf })
        if (envios.length === 1) throw precisa('CAIXA_FECHADO', 'POSSIVEL_DUPLICIDADE')
        return 'gravou'
      },
      async () => true,
    )
    expect(r).toBe('gravou')
    expect(envios[1]).toEqual({ confirmarCaixaFechado: true, confirmarDuplicidade: true })
  })

  it('as confirmações se acumulam quando surge um segundo aviso', async () => {
    const envios: Record<string, true>[] = []
    await comConfirmacao(
      async (conf) => {
        envios.push({ ...conf })
        if (envios.length === 1) throw precisa('POSSIVEL_DUPLICIDADE')
        if (envios.length === 2) throw precisa('CAIXA_FECHADO')
        return 'ok'
      },
      async () => true,
    )
    expect(envios[2]).toEqual({ confirmarDuplicidade: true, confirmarCaixaFechado: true })
  })

  it('cancelado, não reenvia — e diz que nada foi gravado', async () => {
    let n = 0
    await expect(
      comConfirmacao(
        async () => {
          n++
          throw precisa('CAIXA_FECHADO')
        },
        async () => false,
      ),
    ).rejects.toBeInstanceOf(ConfirmacaoRecusada)
    expect(n).toBe(1)
  })

  it('outro erro, ou aviso desconhecido, passa direto sem perguntar', async () => {
    let perguntou = false
    const pergunta = async () => {
      perguntou = true
      return true
    }
    await expect(
      comConfirmacao(async () => {
        throw new ErroDaApi(409, 'Este recebimento já foi estornado.')
      }, pergunta),
    ).rejects.toThrow('estornado')
    await expect(
      comConfirmacao(async () => {
        throw precisa('AVISO_QUE_NAO_EXISTE')
      }, pergunta),
    ).rejects.toBeInstanceOf(ErroDaApi)
    expect(perguntou).toBe(false)
  })
})

/**
 * Varredura da FONTE: toda porta de recebimento da tela passa pela
 * confirmação. A sétima tela que grava dinheiro com `chamar` direto devolveria
 * à recepcionista um "Confirme antes de lançar" sem pergunta nenhuma.
 */
describe('as portas de recebimento usam `postarComConfirmacao`', () => {
  const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
  const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

  it.each([
    ['components/tela-recebimentos.tsx', "'v1/recebimentos'"],
    ['components/tela-nova-tarefa.tsx', "'v1/tarefas'"],
    ['components/tela-nova-adesao.tsx', "'v1/programas'"],
    ['components/programas/cartao-de-sessao.tsx', '/concluir`'],
    ['lib/acoes-de-tarefa.ts', '/concluir`'],
    ['lib/acoes-de-tarefa.ts', '/jornada`'],
  ])('%s → %s', (arquivo, rota) => {
    const fonte = ler(arquivo)
    const i = fonte.indexOf(rota)
    expect(i, `${rota} sumiu de ${arquivo}`).toBeGreaterThan(-1)
    // A chamada que contém a rota é a de confirmação, não um `chamar` cru:
    // o último `(` antes da rota pertence a `postarComConfirmacao`.
    const antes = fonte.slice(Math.max(0, i - 200), i)
    const ultimaChamada = /(\w+)(?:<[^>]*>)?\(\s*`?[^(]*$/.exec(antes)?.[1]
    expect(ultimaChamada).toBe('postarComConfirmacao')
  })
})
