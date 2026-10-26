import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  desmontarCenario,
  limparProgramas,
  montarCenario,
  type Cenario,
} from '../tarefas/__tests__/cenario'
import request from 'supertest'

/**
 * O CATÁLOGO DE PROCEDIMENTOS — ler com `programas`, escrever com `config`.
 *
 * As duas recusas da exclusão, e a segunda é o buraco que o épico 3 deixou:
 * o protótipo e o `Code.gs` conferem só as adesões, e uma PROPOSTA VIVA
 * também aponta para o procedimento.
 */
let c: Cenario

const pedir = (caminho: string, quem = 'beatriz') =>
  request(c.app.getHttpServer()).get(caminho).set('Cookie', c.cookies[quem]!)

const criar = (corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer()).post('/v1/procedimentos').set('Cookie', c.cookies[quem]!).send(corpo)

const editar = (id: string, corpo: Record<string, unknown>, quem = 'beatriz') =>
  request(c.app.getHttpServer())
    .patch(`/v1/procedimentos/${id}`)
    .set('Cookie', c.cookies[quem]!)
    .send(corpo)

const excluir = (id: string, quem = 'beatriz') =>
  request(c.app.getHttpServer()).delete(`/v1/procedimentos/${id}`).set('Cookie', c.cookies[quem]!)

type Proc = {
  id: string
  nome: string
  ativo: boolean
  sessoesSugeridas: number
  valorPorSessao: string | null
  pacientesAtivos: number
  rotuloSessao: string
  descartaveis: unknown[]
}

const listar = async (quem = 'beatriz'): Promise<Proc[]> =>
  ((await pedir('/v1/procedimentos', quem).expect(200)).body as { itens: Proc[] }).itens

const porNome = async (nome: string, quem = 'beatriz'): Promise<Proc> =>
  (await listar(quem)).find((p) => p.nome === nome)!

const BASE = { nome: 'Peeling', sessoesSugeridas: 4, intervaloSugeridoDias: 30 }

let tirzeId: string
/** Os cinco modelos semeados, por ID. Ver o `beforeEach`. */
let semeados: string[]

beforeAll(async () => {
  c = await montarCenario('cat')
  const r = await c.migrate.query<{ id: string; nome: string }>(
    `SELECT id, nome FROM procedimentos WHERE clinica_id = $1`,
    [c.clinica],
  )
  semeados = r.rows.map((x) => x.id)
  tirzeId = r.rows.find((x) => x.nome === 'Tirzepatida')!.id
}, 120_000)

afterAll(async () => {
  await desmontarCenario(c)
})

beforeEach(async () => {
  await limparProgramas(c)
  /**
   * TUDO POR ID, nunca por nome.
   *
   * Um dos testes RENOMEIA a Tirzepatida para "Tirzepatida 5 mg". Com um
   * `WHERE nome_chave NOT IN (os cinco padrões)`, o `DELETE` de limpeza
   * APAGAVA a Tirzepatida renomeada — e o `it` seguinte falhava por resíduo,
   * acusando um defeito que não existe. Medido: dois vermelhos com
   * "Cannot read properties of undefined".
   */
  await c.migrate.query('DELETE FROM insumos_do_procedimento WHERE clinica_id = $1', [c.clinica])
  await c.migrate.query(
    'DELETE FROM procedimentos WHERE clinica_id = $1 AND id <> ALL($2::uuid[])',
    [c.clinica, semeados],
  )
  await c.migrate.query(
    `UPDATE procedimentos SET excluido_em = NULL, ativo = true, desativado_em = NULL,
            nome = 'Tirzepatida', valor_por_sessao = NULL, rotulo_sessao = 'Aplicação',
            sessoes_sugeridas = 12, intervalo_sugerido_dias = 7
      WHERE id = $1`,
    [tirzeId],
  )
})

describe('a lista', () => {
  it('traz os CINCO MODELOS que a clínica recebeu ao nascer', async () => {
    expect((await listar()).map((p) => p.nome)).toEqual([
      'Bioestimulador de colágeno',
      'Implante hormonal',
      'Semaglutida',
      'Tirzepatida',
      'Toxina botulínica',
    ])
  })

  it('traz só os NÃO EXCLUÍDOS, com os inativos marcados', async () => {
    const novo = (await criar(BASE).expect(201)).body as Proc
    const outro = (await criar({ ...BASE, nome: 'Microagulhamento' }).expect(201)).body as Proc
    await editar(outro.id, { ativo: false }).expect(200)
    await excluir(novo.id).expect(204)

    const r = await listar()
    expect(r.find((p) => p.id === novo.id)).toBeUndefined()
    expect(r.find((p) => p.id === outro.id)!.ativo).toBe(false)
  })

  it('o PACIENTES ATIVOS é calculado no SERVIDOR', async () => {
    // "1 paciente ativo" é o que a tela mostra (medido no protótipo). Contar
    // no front exigiria baixar todos os programas da clínica para desenhar
    // uma lista de sete linhas.
    const tirze = await porNome('Tirzepatida')
    expect(tirze.pacientesAtivos).toBe(0)

    await montarPrograma(tirze.id)
    expect((await porNome('Tirzepatida')).pacientesAtivos).toBe(1)
  })

  it('programa ENCERRADO não conta como paciente ativo', async () => {
    const tirze = await porNome('Tirzepatida')
    const p = await montarPrograma(tirze.id)
    await c.migrate.query(
      `UPDATE programas SET situacao = 'encerrado', encerrado_em = now() WHERE id = $1`,
      [p],
    )
    expect((await porNome('Tirzepatida')).pacientesAtivos).toBe(0)
  })
})

describe('as permissões, e elas divergem por verbo', () => {
  it('sem `config`, criar é 403 — mas LISTAR com `programas` é 200', async () => {
    expect((await criar({ ...BASE }, 'nara')).statusCode).toBe(403)
    expect((await pedir('/v1/procedimentos', 'nara')).statusCode).toBe(200)
  })

  it('sem `programas` nem `config`, nem listar', async () => {
    // `camila` é Comercial: `pacientes` e `valores`, e nada de programas.
    expect((await pedir('/v1/procedimentos', 'camila')).statusCode).toBe(403)
  })

  it('sem `config`, editar e excluir também são 403', async () => {
    const tirze = await porNome('Tirzepatida')
    expect((await editar(tirze.id, { ativo: false }, 'nara')).statusCode).toBe(403)
    expect((await excluir(tirze.id, 'nara')).statusCode).toBe(403)
  })

  it('sem `valores`, o valor por sessão vem null e o resto fica', async () => {
    const tirze = await porNome('Tirzepatida')
    await editar(tirze.id, { valorPorSessao: '30000' }).expect(200)

    const comValores = await porNome('Tirzepatida', 'beatriz')
    expect(comValores.valorPorSessao).toBe('30000')

    const sem = await porNome('Tirzepatida', 'nara')
    expect(sem.valorPorSessao).toBeNull()
    expect(sem.sessoesSugeridas).toBe(12)
    expect(sem.rotuloSessao).toBe('Aplicação')
  })
})

describe('o nome, único por clínica', () => {
  it('nome repetido, só acento e caixa diferentes, é 409 com a mensagem dela', async () => {
    const r = await criar({ ...BASE, nome: 'tirzepatida' })
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('tirzepatida')
  })

  it('a recusa vem DO BANCO, não de um SELECT antes', async () => {
    // Ler-depois-escrever perde a corrida entre duas pessoas cadastrando o
    // mesmo procedimento. O teste não prova a corrida — prova que o caminho
    // é o do índice: o nome colide ignorando acento, que é exatamente o que
    // `normalizar_nome` faz e um `WHERE nome = $1` não faria.
    expect((await criar({ ...BASE, nome: 'TOXINA BOTULINICA' })).statusCode).toBe(409)
  })

  it('o nome do EXCLUÍDO fica livre', async () => {
    const novo = (await criar(BASE).expect(201)).body as Proc
    await excluir(novo.id).expect(204)
    expect((await criar(BASE)).statusCode).toBe(201)
  })
})

describe('excluir — soft delete, com DUAS recusas', () => {
  it('excluir é SOFT DELETE: some da lista, e a linha continua no banco', async () => {
    const novo = (await criar(BASE).expect(201)).body as Proc
    await excluir(novo.id).expect(204)
    const r = await c.migrate.query('SELECT excluido_em FROM procedimentos WHERE id = $1', [novo.id])
    expect(r.rowCount).toBe(1)
    expect(r.rows[0]!.excluido_em).not.toBeNull()
  })

  it('procedimento COM PROGRAMA é 409, com a contagem na mensagem', async () => {
    const tirze = await porNome('Tirzepatida')
    await montarPrograma(tirze.id)
    const r = await excluir(tirze.id)
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('1 programa')
    expect(r.body.message).toContain('Ativo') // a saída que ela já conhece
  })

  it('procedimento COM PROPOSTA VIVA é 409 — o buraco que o épico 3 deixou', async () => {
    // `tarefas.programa_orcado` aponta para o procedimento, e o cartão está
    // em `orcamento`. Excluir aqui faria o `fechar` daquele cartão falhar com
    // o motivo escondido num `jsonb`.
    const novo = (await criar(BASE).expect(201)).body as Proc
    await propostaViva(novo.id, 'orcamento')
    const r = await excluir(novo.id)
    expect(r.statusCode).toBe(409)
    expect(r.body.message).toContain('orçamento')
  })

  it('proposta de cartão PERDIDO ou FECHADO não impede a exclusão', async () => {
    // Só a proposta VIVA (etapa `orcamento`) importa: ela ainda pode fechar.
    const novo = (await criar(BASE).expect(201)).body as Proc
    await propostaViva(novo.id, 'perdido')
    expect((await excluir(novo.id)).statusCode).toBe(204)
  })

  it('proposta de cartão EXCLUÍDO também não impede', async () => {
    const novo = (await criar(BASE).expect(201)).body as Proc
    const t = await propostaViva(novo.id, 'orcamento')
    await c.migrate.query('UPDATE tarefas SET excluida_em = now() WHERE id = $1', [t])
    expect((await excluir(novo.id)).statusCode).toBe(204)
  })

  it('excluir duas vezes é 404 na segunda', async () => {
    const novo = (await criar(BASE).expect(201)).body as Proc
    await excluir(novo.id).expect(204)
    expect((await excluir(novo.id)).statusCode).toBe(404)
  })
})

describe('editar — e o que ela NÃO toca', () => {
  it('DESATIVAR um procedimento em uso é permitido — é a saída que o MANUAL dá', async () => {
    const tirze = await porNome('Tirzepatida')
    await montarPrograma(tirze.id)
    expect((await editar(tirze.id, { ativo: false })).statusCode).toBe(200)
  })

  it('editar sessões e intervalo NÃO TOCA em quem já está em tratamento', async () => {
    // MANUAL cap. 11, e é a frase que a materialização (P-1) torna verdadeira
    // sem nenhum código a defendendo.
    const tirze = await porNome('Tirzepatida')
    const p = await montarPrograma(tirze.id)
    const antes = await prazosDe(p)
    expect(antes).toHaveLength(4)

    await editar(tirze.id, { sessoesSugeridas: 2, intervaloSugeridoDias: 60 }).expect(200)
    expect(await prazosDe(p)).toEqual(antes)
  })

  it('renomear NÃO reescreve o nome no programa de quem já começou', async () => {
    const tirze = await porNome('Tirzepatida')
    const p = await montarPrograma(tirze.id)
    await editar(tirze.id, { nome: 'Tirzepatida 5 mg' }).expect(200)

    const r = await c.migrate.query<{ procedimento_nome: string }>(
      'SELECT procedimento_nome FROM itens_do_programa WHERE programa_id = $1',
      [p],
    )
    expect(r.rows[0]!.procedimento_nome).toBe('Tirzepatida')
  })

  it('A EDIÇÃO É PARCIAL: `{ ativo: false }` não apaga rótulo nem descartáveis', async () => {
    // Com `SalvarProcedimento` (que tem `.default()`), este PATCH reescreveria
    // `rotuloSessao` para "Sessão" e esvaziaria `descartaveis` — sem erro
    // nenhum, e a clínica descobriria na próxima sessão.
    const tirze = await porNome('Tirzepatida')
    await editar(tirze.id, {
      descartaveis: [{ itemId: c.pacientes['ana']!, quantidade: '1000', unidade: 'un' }],
    }).expect(200)

    await editar(tirze.id, { ativo: false }).expect(200)
    const depois = await porNome('Tirzepatida')
    expect(depois.rotuloSessao).toBe('Aplicação')
    expect(depois.descartaveis).toHaveLength(1)
  })

  it('desativar e reativar mantêm `desativado_em` coerente com `ativo`', async () => {
    const tirze = await porNome('Tirzepatida')
    await editar(tirze.id, { ativo: false }).expect(200)
    await editar(tirze.id, { ativo: true }).expect(200)
    expect((await porNome('Tirzepatida')).ativo).toBe(true)
  })

  it('editar procedimento de OUTRA clínica é 404 — a RLS não o enxerga', async () => {
    const r = await c.migrate.query<{ id: string }>(
      `SELECT id FROM procedimentos WHERE clinica_id = $1 LIMIT 1`,
      [c.outraClinica],
    )
    expect((await editar(r.rows[0]!.id, { ativo: false })).statusCode).toBe(404)
  })
})

/* ------------------------------------------------------------- utilidades */

/** Um programa de 4 sessões semanais, montado pela rota. */
async function montarPrograma(procedimentoId: string): Promise<string> {
  const r = await request(c.app.getHttpServer())
    .post('/v1/programas')
    .set('Cookie', c.cookies['beatriz']!)
    .send({
      pacienteId: c.pacientes['ana'],
      inicio: '2026-11-02',
      itens: [{ chave: 'i1', procedimentoId, sessoes: 4, intervaloDias: 7 }],
    })
    .expect(201)
  return (r.body as { id: string }).id
}

/** Um cartão de orçamento com proposta de programa, na etapa pedida. */
async function propostaViva(procedimentoId: string, etapa: string): Promise<string> {
  const r = await c.migrate.query<{ id: string }>(
    `INSERT INTO tarefas
       (clinica_id, solicitante_id, responsavel_id, descricao, prazo, paciente_id, tipo,
        etapa, status, concluida_em, programa_orcado)
     VALUES ($1,$2,$2,'Orçamento','2026-10-24',$3,'Orçamento enviado',$4::etapa_de_jornada,
             'concluida', now(), $5::jsonb)
     RETURNING id`,
    [
      c.clinica,
      c.pessoas['juliana'],
      c.pacientes['ana'],
      etapa,
      JSON.stringify([{ procedimentoId, sessoes: 4, intervaloDias: 7, chave: 'i1' }]),
    ],
  )
  return r.rows[0]!.id
}

async function prazosDe(programaId: string): Promise<string[]> {
  const r = await c.migrate.query<{ prazo: string }>(
    `SELECT prazo::text AS prazo FROM tarefas
      WHERE programa_id = $1 AND tipo = 'Sessão de plano' AND excluida_em IS NULL
      ORDER BY item_chave, sessao_indice`,
    [programaId],
  )
  return r.rows.map((x) => x.prazo)
}
