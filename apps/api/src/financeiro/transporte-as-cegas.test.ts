import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparTarefas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'
import { ROTAS_DE_CONFERENCIA } from './rotas-de-conferencia'

/**
 * **A REGRA 6, NO TRANSPORTE.**
 *
 * A conferência às cegas protege contra uma coisa: a pessoa que conta a gaveta
 * olhar o número antes de contar. Isso é invariante de **transporte**, não de
 * tela — quem confere com o esperado à vista confirma o esperado, e a
 * conferência deixa de medir qualquer coisa.
 *
 * Por isso o teste olha o **corpo HTTP cru**, e com o principal mais forte que
 * existe. **Redação não é defesa aqui**: quem fecha o caixa COM `valores`
 * continua precisando conferir às cegas, e um teste feito com usuário fraco
 * provaria a regra 17, não a regra 6.
 *
 * `beatriz` tem `valores`, e é o principal mais forte que importa: a redação
 * decide por `pode('valores')`, e `admin: true` faz `pode` devolver verdadeiro
 * para tudo — ou seja, um admin recebe destas rotas **exatamente o mesmo
 * corpo** que ela. Não há principal que veja mais.
 *
 * **Escopo honesto:** `GET /v1/caixa` ainda não existe (Task 9 do plano). Este
 * arquivo já varre `ROTAS_DE_CONFERENCIA`, e a Task 9 acrescenta a rota do
 * caixa àquela lista — momento em que estas mesmas asserções passam a cobri-la
 * sem uma linha nova aqui. O que ele NÃO cobre hoje é a resposta do caixa
 * antes do fechamento; o que ele cobre é a classe inteira: **nenhuma rota
 * devolve agregado por forma de pagamento de um dia cujo caixa está aberto.**
 */
let c: Cenario

/** Todas as chaves do corpo, em qualquer profundidade. */
function chavesProfundas(x: unknown, saida: Set<string> = new Set()): Set<string> {
  if (x === null || typeof x !== 'object') return saida
  if (Array.isArray(x)) {
    for (const i of x) chavesProfundas(i, saida)
    return saida
  }
  for (const [k, v] of Object.entries(x)) {
    saida.add(k)
    chavesProfundas(v, saida)
  }
  return saida
}

const registrar = (valor: string, forma: string) =>
  postar(
    c,
    '/v1/recebimentos',
    {
      requisicaoId: randomUUID(),
      pacienteId: c.pacientes['ana'],
      valor,
      forma,
      em: HOJE,
      ref: 'consulta',
    },
    'beatriz',
  )

/**
 * O esperado do dia, e as formas em que ele poderia aparecer escrito.
 *
 * 45.000 + 12.000 = **57.000 centavos**. O teste persegue o 57000 — é ele, e
 * não a chave, que pega o campo RENOMEADO.
 */
const PARCELAS = ['45000', '12000']
const A_SOMA = ['57000', '570,00', '570.00', 'R$ 570']

beforeAll(async () => {
  c = await montarCenario('cegas')
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparTarefas(c)
  await registrar('45000', 'Pix')
  await registrar('12000', 'Dinheiro')
})

describe('o esperado não atravessa antes do fechamento', () => {
  it('O AGREGADO POR FORMA NÃO EXISTE EM ROTA NENHUMA — nem para quem pode tudo', async () => {
    for (const rota of ROTAS_DE_CONFERENCIA) {
      const caminho = rota.caminho.replace(':dia', HOJE)
      const [base, consulta] = caminho.split('?')
      const parametros = Object.fromEntries(new URLSearchParams(consulta ?? '').entries())
      const r = await pegar(c, base!, parametros, 'beatriz')
      expect(r.statusCode, caminho).toBe(200)

      // 1. A CHAVE não existe. `null` não serviria: um campo redigido conta
      //    ao cliente que existe um número ali, e o próximo refactor o
      //    "conserta".
      const chaves = chavesProfundas(r.body)
      for (const proibida of ['esperado', 'porForma', 'diferenca', 'conferido', 'contado']) {
        expect([...chaves], `${caminho} devolve a chave \`${proibida}\``).not.toContain(proibida)
      }

      // 2. E o NÚMERO não aparece no corpo, sob nome nenhum. É ESTA asserção
      //    que pega o campo renomeado — `total`, `resumo`, `previsto`,
      //    `_debug`, ou um agregado "por forma" com outra etiqueta.
      for (const n of A_SOMA) {
        expect(r.text, `${caminho} contém a soma do dia (${n})`).not.toContain(n)
      }
    }
  })

  it('A VARREDURA TEM DENTES: a lista individual ESTÁ lá, e é por isso que a soma some', async () => {
    // Sem esta asserção, uma rota que devolvesse `{}` — ou um 500 — passaria
    // no teste acima e a regra 6 estaria "provada" por ausência de resposta.
    // A lista individual é o instrumento de trabalho da recepção e fica; o
    // que o servidor nunca faz é a SOMA por ela.
    const r = await pegar(c, '/v1/recebimentos', { dia: HOJE }, 'beatriz')
    expect(r.body.itens).toHaveLength(2)
    for (const parcela of PARCELAS) {
      expect(r.text, `a parcela ${parcela} deveria estar na lista`).toContain(parcela)
    }
  })

  it('toda rota de conferência tem razão escrita — a lista não cresce por reflexo', () => {
    expect(ROTAS_DE_CONFERENCIA.length).toBeGreaterThan(0)
    for (const rota of ROTAS_DE_CONFERENCIA) {
      expect(rota.razao.length, rota.caminho).toBeGreaterThan(40)
    }
  })
})
