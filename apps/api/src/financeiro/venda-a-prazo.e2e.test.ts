import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import {
  type Cenario,
  desmontarCenario,
  HOJE,
  limparFinanceiro,
  limparProgramas,
  montarCenario,
  pegar,
  postar,
} from '../tarefas/__tests__/cenario'

/**
 * **D-9 — A VENDA A PRAZO, E OS TRÊS LUGARES ONDE ELA NÃO PODE APARECER.**
 *
 * A clínica fecha um programa de R$ 3.600, a paciente não paga nada hoje e
 * fica devendo tudo. O protótipo aceita — *"fechou, paga depois"* — e
 * representa isso com `valor: ""` e `valorAberto: 3600` numa tarefa
 * `Pagamento de orçamento` concluída. **Medido no protótipo rodando:**
 * `criarAdesao` com `valorEntrada: ""` e `valorTotal: 3600` grava
 * `{valor: "", valorAberto: 3600, formaPagamento: "", modo: "saldo"}`.
 *
 * O `CHECK (valor > 0)` da 0006 impedia a linha; a 0011 a aceita quando ela
 * registra **alguma coisa** — dinheiro recebido **ou** dinheiro devido.
 *
 * **A condição sem a qual a decisão não vale:** a linha de valor zero não
 * aparece no **caixa do dia**, na **lista de recebimentos do dia** nem no
 * **LTV da paciente**. Venda a prazo não é dinheiro que entrou na gaveta — se
 * qualquer um dos três vazar, a conferência do caixa passa a acusar uma
 * diferença que não existe, e a recepcionista procura por uma hora o erro que
 * ela não cometeu.
 *
 * ONDE O PROTÓTIPO CONCORDA, E ONDE ELE VAZA (medido, 2026-10-26):
 *
 * | Lugar | Protótipo | Aqui |
 * |---|---|---|
 * | caixa do dia | `Number(t.valor) > 0 && t.formaPagamento` — **exclui** | exclui |
 * | lista do dia | `ehReceb` dá `true` por `ehPagamento(tipo)` — **VAZA** | exclui |
 * | LTV | `soma(rec)` não muda; `pagamentos` conta só `valor > 0` | exclui |
 *
 * A linha do meio é **divergência consciente** (ADR 0005): no protótipo a
 * seção "Recebimentos de hoje" ganha uma linha de `R$ 0,00` com forma vazia, e
 * o contador do cabeçalho a soma. É exatamente o ruído que D-9 proíbe.
 */
let c: Cenario
let tirze: string

const APRAZO = { valorTotal: '360000', valorEntrada: '0' } as const

/** O programa fechado sem entrada: a paciente deve tudo. */
const montarAPrazo = (quem = 'beatriz') =>
  request(c.app.getHttpServer())
    .post('/v1/programas')
    .set('Cookie', c.cookies[quem]!)
    .send({
      pacienteId: c.pacientes['ana'],
      inicio: '2026-11-02',
      itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
      pagamento: APRAZO,
    })

/** A linha crua que a montagem gravou, para provar que ela EXISTE. */
const linhaDaAdesao = async () => {
  const r = await c.migrate.query<{
    valor: string
    valor_aberto: string
    forma: string
    programa_id: string | null
  }>(
    `SELECT valor::text AS valor, valor_aberto::text AS valor_aberto, forma, programa_id
       FROM recebimentos WHERE clinica_id = $1 AND estornado_em IS NULL`,
    [c.clinica],
  )
  return r.rows
}

beforeAll(async () => {
  c = await montarCenario('aprazo')
  const p = await c.migrate.query<{ id: string }>(
    `SELECT id FROM procedimentos WHERE clinica_id = $1 AND nome_chave = 'tirzepatida'`,
    [c.clinica],
  )
  tirze = p.rows[0]!.id
}, 60_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparFinanceiro(c)
  await limparProgramas(c)
})

describe('D-9 — a linha existe', () => {
  it('programa sem entrada MONTA, e a dívida fica registrada', async () => {
    const r = await montarAPrazo()
    expect(r.statusCode).toBe(201)
    // `saldo`, e não `avulso`: a adesão abriu valor em aberto.
    expect(r.body.modoDeCobranca).toBe('saldo')

    const linhas = await linhaDaAdesao()
    expect(linhas).toHaveLength(1)
    expect(linhas[0]!.valor).toBe('0')
    expect(linhas[0]!.valor_aberto).toBe('360000')
    // A FORMA É VAZIA, e isso é o banco cobrando: não existe forma de
    // pagamento para dinheiro que não se moveu. O protótipo grava
    // `formaPagamento: ""` pela mesma razão.
    expect(linhas[0]!.forma).toBe('')
    expect(linhas[0]!.programa_id).toBe(r.body.id)
  })

  it('a linha COMPLETAMENTE vazia continua recusada pelo banco', async () => {
    // `valor >= 0` teria aceitado isto, e é por isso que a decisão escreveu
    // `valor > 0 OR valor_aberto > 0`: a linha é aceita quando registra
    // ALGUMA coisa, nunca quando registra nada.
    await expect(
      c.migrate.query(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
         VALUES ($1,$2,'Pagamento de orçamento',0,'',0, now(), $3)`,
        [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
      ),
    ).rejects.toThrow(/recebimento_registra_algo/)
  })

  it('valor NEGATIVO continua recusado — a troca do CHECK não abriu essa porta', async () => {
    // `valor > 0 OR valor_aberto > 0` sozinho aceitaria `(-500, 1000)`. A
    // não-negatividade que o `valor > 0` original carregava de graça virou
    // uma constraint própria, porque ela não era o que a decisão queria mudar.
    //
    // A forma é VAZIA de propósito: com "Pix" a bicondicional
    // `recebimento_forma_so_com_dinheiro` mordia primeiro, e o teste provaria
    // a constraint errada. Assim a linha passa pelas outras duas e morre
    // exatamente onde se quer.
    await expect(
      c.migrate.query(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
         VALUES ($1,$2,'Pagamento de orçamento',-500,'',100000, now(), $3)`,
        [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
      ),
    ).rejects.toThrow(/recebimento_valor_nao_negativo/)
  })

  it('forma preenchida com valor ZERO é recusada, e forma vazia com valor é também', async () => {
    // A bicondicional. Sem ela, "Pix" num recebimento de zero faria o caixa
    // (se algum dia parasse de filtrar) mostrar um Pix que ninguém fez.
    const inserir = (valor: string, forma: string) =>
      c.migrate.query(
        `INSERT INTO recebimentos
           (clinica_id, paciente_id, tipo, valor, forma, valor_aberto, recebido_em, registrado_por)
         VALUES ($1,$2,'Pagamento de orçamento',$4,$5,360000, now(), $3)`,
        [c.clinica, c.pacientes['ana'], c.pessoas['beatriz'], valor, forma],
      )
    await expect(inserir('0', 'Pix')).rejects.toThrow(/recebimento_forma_so_com_dinheiro/)
    await expect(inserir('120000', '')).rejects.toThrow(/recebimento_forma_so_com_dinheiro/)
  })
})

/* =========================================================================
 * OS TRÊS FILTROS
 * ========================================================================= */

describe('D-9 · filtro 1 — o CAIXA DO DIA', () => {
  it('a venda a prazo NÃO entra no esperado, e o caixa fecha conferido com a gaveta vazia', async () => {
    await montarAPrazo()

    // Ninguém contou nada, porque nada entrou. Se a linha de zero vazasse
    // para o esperado, ela traria um grupo de forma vazia — e a diferença
    // passaria a existir num dia em que a gaveta está certa.
    const r = await postar(c, '/v1/caixa', { dia: HOJE, obs: '', contado: [] }, 'beatriz')
    expect(r.statusCode).toBe(201)
    expect(r.body.conferido).toBe(true)
    expect(r.body.diferenca).toBe('0')
    expect(r.body.porForma.every((x: { esperado: string }) => x.esperado === '0')).toBe(true)
    // Nenhuma linha de forma vazia, de nenhum lado.
    expect(r.body.porForma.map((x: { forma: string }) => x.forma)).not.toContain('')
    expect(r.text).not.toContain('360000')
  })

  it('e o dinheiro de VERDADE do mesmo dia continua no esperado, intacto', async () => {
    // A prova de que o filtro recorta a linha certa, e não o dia inteiro.
    await montarAPrazo()
    // O instante é explícito porque o relógio da aplicação está FIXO em
    // 2026-10-25T02:00Z (= 23:00 de 24/10 em America/Bahia), e `now()` do
    // banco cairia fora da janela do dia que o teste fecha.
    await c.migrate.query(
      `INSERT INTO recebimentos
         (clinica_id, paciente_id, tipo, valor, forma, recebido_em, registrado_por)
       VALUES ($1,$2,'Pagamento de consulta',45000,'Pix','2026-10-24T18:00:00-03:00'::timestamptz,$3)`,
      [c.clinica, c.pacientes['ana'], c.pessoas['beatriz']],
    )
    const r = await postar(
      c,
      '/v1/caixa',
      { dia: HOJE, obs: '', contado: [{ forma: 'Pix', valor: '45000' }] },
      'beatriz',
    )
    expect(r.body.porForma.find((x: { forma: string }) => x.forma === 'Pix').esperado).toBe('45000')
    expect(r.body.diferenca).toBe('0')
  })

  it('a promissória de ZERO não é contada como promissória', async () => {
    // `promissoriasDoDia` devolve uma QUANTIDADE, e aí o zero é visível: uma
    // nota promissória de R$ 0,00 apareceria no bloco informativo do caixa.
    await montarAPrazo()
    const r = await postar(c, '/v1/caixa', { dia: HOJE, obs: '', contado: [] }, 'beatriz')
    expect(r.body.promissorias.quantidade).toBe(0)
    expect(r.body.promissorias.valor).toBe('0')
  })
})

describe('D-9 · filtro 2 — a LISTA DE RECEBIMENTOS DO DIA', () => {
  it('a venda a prazo não aparece na lista do dia — aqui divergimos do protótipo', async () => {
    const p = await montarAPrazo()
    const r = await pegar(c, '/v1/recebimentos', { dia: HOJE }, 'beatriz')
    expect(r.statusCode).toBe(200)
    expect(r.body.itens).toEqual([])
    // E nem pela janela aberta, nem pelo filtro da paciente: a linha não é
    // recebimento em janela nenhuma.
    expect((await pegar(c, '/v1/recebimentos', { ultimosDias: '7' }, 'beatriz')).body.itens)
      .toEqual([])
    expect(
      (
        await pegar(
          c,
          '/v1/recebimentos',
          { pacienteId: c.pacientes['ana']!, ultimosDias: '7' },
          'beatriz',
        )
      ).body.itens,
    ).toEqual([])
    // Mas ela EXISTE: é o saldo da paciente que a representa.
    const saldo = await pegar(c, `/v1/pacientes/${c.pacientes['ana']}/saldo`, {}, 'beatriz')
    expect(saldo.body.grupos.find((g: { programaId: string }) => g.programaId === p.body.id).saldo)
      .toBe('360000')
  })

  it('o pagamento que ENTRA depois aparece, e abate o saldo do programa', async () => {
    const p = await montarAPrazo()
    await postar(
      c,
      '/v1/recebimentos',
      {
        requisicaoId: '5bd4e0c6-5bd4-4e0c-8bd4-e0c65bd4e0c6',
        pacienteId: c.pacientes['ana'],
        valor: '120000',
        forma: 'Pix',
        em: HOJE,
        ref: 'programa',
        programaId: p.body.id,
      },
      'beatriz',
    )
    const r = await pegar(c, '/v1/recebimentos', { dia: HOJE }, 'beatriz')
    expect(r.body.itens).toHaveLength(1)
    expect(r.body.itens[0]!.valor).toBe('120000')
  })
})

describe('D-9 · filtro 3 — o LTV DA PACIENTE', () => {
  it('a venda a prazo NÃO é LTV: a paciente deve R$ 3.600 e já deixou R$ 0', async () => {
    await montarAPrazo()
    const r = await pegar(c, '/v1/pacientes', { q: 'Ana' }, 'beatriz')
    const ana = r.body.pacientes.find((x: { id: string }) => x.id === c.pacientes['ana'])
    // LTV é "o total que ela já deixou na clínica". Orçamento não é receita
    // (regra 4), e nota promissória não entra no caixa: uma venda a prazo é
    // uma promessa, não um pagamento.
    expect(ana.ltv).toBe('0')
    // E a dívida aparece — no lugar dela.
    expect(ana.saldo).toBe('360000')

    // E para quem não vê valores, o AVISO sobrevive à redação (regra 17): a
    // recepcionista precisa saber que há saldo antes da sessão, e não precisa
    // do número para saber.
    const semValores = await pegar(c, '/v1/pacientes', { q: 'Ana' }, 'juliana')
    const anaRedigida = semValores.body.pacientes.find(
      (x: { id: string }) => x.id === c.pacientes['ana'],
    )
    expect(anaRedigida.ltv).toBeNull()
    expect(anaRedigida.saldo).toBeNull()
    expect(anaRedigida.temSaldo).toBe(true)
  })

  it('o LTV conta só o que ENTROU, mesmo quando a dívida é maior', async () => {
    // A mutação que isto pega: somar `valor_aberto` no LTV, que é o erro
    // plausível de quem lê "lifetime value" como "quanto ela vale". A paciente
    // que deve R$ 2.400 não deixou R$ 3.600 na clínica — ela deixou R$ 1.200.
    await request(c.app.getHttpServer())
      .post('/v1/programas')
      .set('Cookie', c.cookies['beatriz']!)
      .send({
        pacienteId: c.pacientes['ana'],
        inicio: '2026-11-02',
        itens: [{ chave: 'i1', procedimentoId: tirze, sessoes: 4, intervaloDias: 7 }],
        pagamento: { valorTotal: '360000', valorEntrada: '120000', forma: 'Pix' },
      })
    const r = await pegar(c, '/v1/pacientes', { q: 'Ana' }, 'beatriz')
    const ana = r.body.pacientes.find((x: { id: string }) => x.id === c.pacientes['ana'])
    expect(ana.ltv).toBe('120000')
    expect(ana.saldo).toBe('240000')
  })
})
