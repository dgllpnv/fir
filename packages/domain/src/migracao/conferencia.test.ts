import { describe, expect, it } from 'vitest'
import { Dinheiro } from '../dinheiro'
import { ehErro, exigir } from '../resultado'
import {
  compararMapas,
  conferirOrigem,
  cunharUsuario,
  cunharUsuarios,
  escolhaAutomatica,
  homonimosDeCampanha,
  homonimosDeProcedimento,
  lerDadosDaV20,
  lerSessao,
  colisoesDeId,
  pendenciasDeDecisao,
  type Celula,
  type PlanilhaCrua,
  COLUNAS,
  ABA_DE_BACKUP,
} from '../index'

/**
 * **A CONFERÊNCIA DA ORIGEM, E AS INVARIANTES QUE A REGRA 28 PROTEGE.**
 *
 * **Todo dado deste arquivo é INVENTADO.** Nenhum nome, telefone, valor ou id
 * vem das planilhas das clínicas (regra 21, e a instrução do épico). Onde um
 * problema do dado real precisa ser ilustrado, o que se reproduz é a **forma**
 * dele — "data como serial", "forma de pagamento vazia" —, nunca o conteúdo.
 *
 * Cada `it` marcado com **MUTAÇÃO** diz qual mudança no código ele mata.
 */

const txt = (bruto: string): Celula => ({ bruto, tipo: 's' })
const num = (bruto: string): Celula => ({ bruto, tipo: 'n' })

type Aba = keyof typeof COLUNAS

/** Monta uma `PlanilhaCrua` a partir de objetos — o leitor não entra aqui. */
function planilha(abas: Partial<Record<Aba, Record<string, Celula>[]>>, extras: string[] = []): PlanilhaCrua {
  const nomes = Object.keys(COLUNAS) as Aba[]
  return {
    abas: [
      ...nomes.map((nome) => ({
        nome,
        cabecalho: [...COLUNAS[nome]],
        linhas: (abas[nome] ?? []).map((o, i) => ({
          numero: i + 2,
          celulas: COLUNAS[nome].map((c) => o[c] ?? txt('')),
        })),
      })),
      ...extras.map((nome) => ({ nome, cabecalho: [...COLUNAS.Tarefas], linhas: [] })),
    ],
  }
}

const EQUIPE = [
  { id: txt('u1'), nome: txt('Ana Beatriz'), funcao: txt('Gestão'), admin: txt('SIM'), ativo: txt('SIM') },
  { id: txt('u2'), nome: txt('Carla Dias'), funcao: txt('Recepção'), admin: txt('NÃO'), ativo: txt('SIM') },
]
const PACIENTES = [
  { id: txt('p1'), nome: txt('Paciente Um'), telefone: txt('71900000001') },
  { id: txt('p2'), nome: txt('Paciente Dois'), telefone: txt('71900000002') },
]
const PLANOS = [
  { id: txt('pl1'), nome: txt('Procedimento Alfa'), sessoes: num('4.0'), intervaloDias: num('7.0'), rotuloSessao: txt('Aplicação'), ativo: txt('SIM') },
]

const tarefa = (o: Record<string, Celula>): Record<string, Celula> => ({
  criadaEm: txt('2026-01-02 08:00'),
  solicitanteId: txt('u1'),
  responsavelId: txt('u1'),
  descricao: txt('Linha de teste'),
  prazo: txt('2026-01-02'),
  prioridade: txt('normal'),
  status: txt('concluida'),
  concluidaEm: txt('2026-01-02T09:00'),
  ...o,
})

describe('receita total e LTV — a regra 4 e a regra 3', () => {
  /**
   * **MUTAÇÃO:** fazer `ehReceita` aceitar `orcamento: true`.
   *
   * "Orçamento enviado" guarda o valor na MESMA coluna `valor` que o
   * pagamento (`temValor` do protótipo é `receita || orcamento`). Se ele
   * entrasse, a receita do mês incluiria propostas que ninguém pagou — e
   * `valorOrcamento` nunca entra em receita, LTV nem meta (regra 4).
   */
  it('MUTAÇÃO · orçamento NÃO é receita, mesmo com valor na coluna `valor`', () => {
    const p = planilha({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Tarefas: [
        tarefa({ id: txt('t1'), pacienteId: txt('p1'), tipo: txt('Pagamento de consulta'), valor: num('300.0'), formaPagamento: txt('Pix') }),
        tarefa({ id: txt('t2'), pacienteId: txt('p1'), tipo: txt('Orçamento enviado'), valor: num('5000.0') }),
      ],
    })
    const c = conferirOrigem(exigir(lerDadosDaV20(p)))
    expect(c.receitaTotal.centavos).toBe(30_000n)
    expect(c.ltvPorPaciente.get('p1')!.centavos).toBe(30_000n)
  })

  /**
   * **MUTAÇÃO:** largar o `status === 'concluida'` do filtro de receita.
   *
   * A v20 só conta o concluído, e o dado real tem tarefa **cancelada** com
   * valor lançado. Sem o filtro, a receita da clínica cresce por um pagamento
   * que foi desfeito.
   */
  it('MUTAÇÃO · tarefa aberta ou cancelada com valor NÃO entra em receita', () => {
    const p = planilha({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Tarefas: [
        tarefa({ id: txt('t1'), pacienteId: txt('p1'), tipo: txt('Pagamento de consulta'), valor: num('300.0'), formaPagamento: txt('Pix') }),
        tarefa({ id: txt('t2'), pacienteId: txt('p1'), tipo: txt('Pagamento de consulta'), valor: num('900.0'), status: txt('cancelada'), concluidaEm: txt('') }),
        tarefa({ id: txt('t3'), pacienteId: txt('p1'), tipo: txt('Pagamento de consulta'), valor: num('700.0'), status: txt('aberta'), concluidaEm: txt('') }),
      ],
    })
    const c = conferirOrigem(exigir(lerDadosDaV20(p)))
    expect(c.receitaTotal.centavos).toBe(30_000n)
  })

  /**
   * **MUTAÇÃO:** migrar a aba `Tarefas (cópia v15)`.
   *
   * Ela é o BACKUP que `migrarPagamentos()` cria, com o MESMO cabeçalho e os
   * valores de ANTES da conversão. Está nas três planilhas reais. Migrá-la
   * dobra a receita de meses inteiros — a regra 3 virada do avesso, e o erro
   * clássico da categoria.
   */
  it('MUTAÇÃO · a aba de backup da v15 NÃO é migrada, e é RELATADA', () => {
    const p = planilha(
      {
        Equipe: EQUIPE,
        Pacientes: PACIENTES,
        Tarefas: [tarefa({ id: txt('t1'), pacienteId: txt('p1'), tipo: txt('Pagamento de consulta'), valor: num('300.0'), formaPagamento: txt('Pix') })],
      },
      [ABA_DE_BACKUP],
    )
    const d = exigir(lerDadosDaV20(p))
    expect(d.tarefas).toHaveLength(1)
    expect(conferirOrigem(d).receitaTotal.centavos).toBe(30_000n)
    expect(d.achados.map((a) => a.codigo)).toContain('AbaDeBackupIgnorada')
  })

  it('o atendimento com pagamento embutido É receita; sem valor, não é', () => {
    const p = planilha({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Tarefas: [
        tarefa({ id: txt('t1'), pacienteId: txt('p1'), tipo: txt('Consulta realizada'), valor: num('250.0'), formaPagamento: txt('Dinheiro') }),
        tarefa({ id: txt('t2'), pacienteId: txt('p2'), tipo: txt('Consulta realizada') }),
      ],
    })
    const c = conferirOrigem(exigir(lerDadosDaV20(p)))
    expect(c.receitaTotal.centavos).toBe(25_000n)
    expect(c.ltvPorPaciente.get('p2')!.centavos).toBe(0n)
  })

  it('tipo ANTIGO é traduzido na leitura, e conta como o tipo atual', () => {
    const p = planilha({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Tarefas: [
        tarefa({ id: txt('t1'), pacienteId: txt('p1'), tipo: txt('Orçamento pago'), valor: num('1000.0') }),
        tarefa({ id: txt('t2'), pacienteId: txt('p1'), tipo: txt('Recebimento de saldo'), valor: num('100.0') }),
      ],
    })
    const d = exigir(lerDadosDaV20(p))
    expect(d.tarefas.map((t) => t.tipo)).toEqual([
      'Pagamento de orçamento',
      'Pagamento de saldo em aberto',
    ])
    expect(conferirOrigem(d).receitaTotal.centavos).toBe(110_000n)
  })

  it('Σ LTV é SEMPRE a receita total — a invariante que pega o paciente perdido', () => {
    const p = planilha({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Tarefas: [
        tarefa({ id: txt('t1'), pacienteId: txt('p1'), tipo: txt('Pagamento de consulta'), valor: num('300.0'), formaPagamento: txt('Pix') }),
        tarefa({ id: txt('t2'), pacienteId: txt('p2'), tipo: txt('Pagamento de consulta'), valor: num('450.5'), formaPagamento: txt('Pix') }),
      ],
    })
    const c = conferirOrigem(exigir(lerDadosDaV20(p)))
    const soma = [...c.ltvPorPaciente.values()].reduce((a, x) => a.mais(x), Dinheiro.zero())
    expect(soma.centavos).toBe(c.receitaTotal.centavos)
    expect(c.receitaTotal.centavos).toBe(75_050n)
  })
})

describe('saldo em aberto — agrupado por adesão, clampado POR GRUPO', () => {
  const comAdesoes = planilha({
    Equipe: EQUIPE,
    Pacientes: PACIENTES,
    Planos: PLANOS,
    Adesoes: [
      { id: txt('a1'), pacienteId: txt('p1'), planoId: txt('pl1'), inicio: txt('2026-01-01'), sessoes: num('4.0'), intervaloDias: num('7.0'), rotuloSessao: txt('Aplicação'), responsavelId: txt('u1'), modo: txt('saldo'), status: txt('ativo') },
      { id: txt('a2'), pacienteId: txt('p1'), planoId: txt('pl1'), inicio: txt('2026-01-01'), sessoes: num('4.0'), intervaloDias: num('7.0'), rotuloSessao: txt('Aplicação'), responsavelId: txt('u1'), modo: txt('avulso'), status: txt('ativo') },
    ],
    Tarefas: [
      // a1 abre 1.000 e abate 300 por sessão (modo saldo): sobra 400.
      tarefa({ id: txt('t1'), pacienteId: txt('p1'), tipo: txt('Pagamento de orçamento'), valor: num('0.0'), valorAberto: num('1000.0'), adesaoId: txt('a1') }),
      tarefa({ id: txt('t2'), pacienteId: txt('p1'), tipo: txt('Sessão de plano'), valor: num('300.0'), adesaoId: txt('a1'), sessao: txt('1/4'), formaPagamento: txt('Pix') }),
      tarefa({ id: txt('t3'), pacienteId: txt('p1'), tipo: txt('Sessão de plano'), valor: num('300.0'), adesaoId: txt('a1'), sessao: txt('2/4'), formaPagamento: txt('Pix') }),
      // a2 é avulso: a sessão paga NÃO abate nada, e não há aberto.
      tarefa({ id: txt('t4'), pacienteId: txt('p1'), tipo: txt('Sessão de plano'), valor: num('200.0'), adesaoId: txt('a2'), sessao: txt('1/4'), formaPagamento: txt('Pix') }),
      // grupo GERAL (sem adesão): abre 500, abate 600 → crédito de 100.
      tarefa({ id: txt('t5'), pacienteId: txt('p1'), tipo: txt('Pagamento de consulta'), valor: num('0.0'), valorAberto: num('500.0') }),
      tarefa({ id: txt('t6'), pacienteId: txt('p1'), tipo: txt('Pagamento de saldo em aberto'), valor: num('600.0'), formaPagamento: txt('Pix') }),
    ],
  })

  it('o saldo é por grupo, e o grupo geral é separado da adesão', () => {
    const c = conferirOrigem(exigir(lerDadosDaV20(comAdesoes)))
    expect(c.saldoPorAdesao.get('a1')!.centavos).toBe(40_000n)
    expect(c.saldoPorAdesao.get('a2')!.centavos).toBe(0n)
    // 400 da a1 + 0 do grupo geral (clampado) = 400.
    expect(c.saldoPorPaciente.get('p1')!.centavos).toBe(40_000n)
  })

  /**
   * **MUTAÇÃO:** clampar o TOTAL em vez de clampar por grupo.
   *
   * Com o clamp no total, o crédito de R$ 100 do grupo geral abateria a dívida
   * de R$ 400 da adesão, e o saldo viraria R$ 300 — a clínica pararia de
   * cobrar R$ 100 que lhe é devido. O clamp é POR GRUPO porque "R$ 400 do
   * programa" e "R$ 100 soltos" exigem conversas diferentes.
   */
  it('MUTAÇÃO · o crédito de um grupo NÃO abate a dívida de outro', () => {
    const c = conferirOrigem(exigir(lerDadosDaV20(comAdesoes)))
    expect(c.saldoPorPaciente.get('p1')!.centavos).toBe(40_000n)
    expect(c.creditoPorPaciente.get('p1')!.centavos).toBe(10_000n)
  })

  /**
   * **MUTAÇÃO:** fazer a sessão abater em qualquer modo.
   *
   * No modo `avulso` não há saldo para abater: cada sessão registra o que foi
   * pago no dia. Abater ali criaria crédito do nada — e o relatório passaria a
   * mostrar crédito para uma paciente que não pagou nada a mais.
   */
  it('MUTAÇÃO · a sessão só abate quando o programa está em modo `saldo`', () => {
    const c = conferirOrigem(exigir(lerDadosDaV20(comAdesoes)))
    expect(c.saldoPorAdesao.get('a2')!.centavos).toBe(0n)
    // E o crédito da a2 é zero: nada foi abatido ali.
    const total = [...c.creditoPorPaciente.values()].reduce((a, x) => a.mais(x), Dinheiro.zero())
    expect(total.centavos).toBe(10_000n)
  })

  it('a venda a prazo (valor zero, aberto > 0) não é receita e É saldo', () => {
    const c = conferirOrigem(exigir(lerDadosDaV20(comAdesoes)))
    // As três sessões/recebimentos pagos somam 1.100; o aberto não entra.
    expect(c.receitaTotal.centavos).toBe(140_000n)
  })

  it('toda adesão aparece no mapa, inclusive a de saldo zero', () => {
    const c = conferirOrigem(exigir(lerDadosDaV20(comAdesoes)))
    expect([...c.saldoPorAdesao.keys()].sort()).toEqual(['a1', 'a2'])
  })
})

describe('receita por campanha', () => {
  it('soma só o concluído e com paciente, e toda campanha aparece', () => {
    const p = planilha({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Campanhas: [
        { id: txt('c1'), nome: txt('Campanha Um'), inicio: txt('2026-01-01'), fim: txt('2026-01-31'), metrica: txt('receita'), meta: num('1000.0') },
        { id: txt('c2'), nome: txt('Campanha Dois'), inicio: txt('2026-01-01'), fim: txt('2026-01-31'), metrica: txt('contatos'), meta: num('20.0') },
      ],
      Tarefas: [
        tarefa({ id: txt('t1'), pacienteId: txt('p1'), tipo: txt('Pagamento de consulta'), valor: num('300.0'), formaPagamento: txt('Pix'), campanhaId: txt('c1') }),
        tarefa({ id: txt('t2'), pacienteId: txt('p1'), tipo: txt('Pagamento de consulta'), valor: num('900.0'), status: txt('cancelada'), concluidaEm: txt(''), campanhaId: txt('c1') }),
      ],
    })
    const c = conferirOrigem(exigir(lerDadosDaV20(p)))
    expect(c.receitaPorCampanha.get('c1')!.centavos).toBe(30_000n)
    expect(c.receitaPorCampanha.get('c2')!.centavos).toBe(0n)
  })
})

describe('compararMapas — NOS DOIS SENTIDOS', () => {
  /**
   * **MUTAÇÃO:** iterar só as chaves da ORIGEM.
   *
   * Um paciente que o destino inventou (ou que ganhou receita de outro)
   * passaria sem ninguém ver. É a metade que custa mais caro, porque a soma
   * total continua certa.
   */
  it('MUTAÇÃO · chave que existe SÓ no destino também diverge', () => {
    const origem = new Map([['p1', Dinheiro.deCentavos(100n)]])
    const destino = new Map([
      ['p1', Dinheiro.deCentavos(100n)],
      ['p2', Dinheiro.deCentavos(50n)],
    ])
    const l = compararMapas('LTV', origem, destino)
    expect(l.bate).toBe(false)
    expect(l.divergencias.map((d) => d.chave)).toEqual(['p2'])
  })

  it('chave que existe SÓ na origem também diverge — o paciente perdido', () => {
    const origem = new Map([
      ['p1', Dinheiro.deCentavos(100n)],
      ['p2', Dinheiro.deCentavos(50n)],
    ])
    const destino = new Map([['p1', Dinheiro.deCentavos(100n)]])
    const l = compararMapas('LTV', origem, destino)
    expect(l.bate).toBe(false)
    expect(l.divergencias.map((d) => d.chave)).toEqual(['p2'])
  })

  /**
   * **MUTAÇÃO:** comparar as SOMAS em vez de chave a chave.
   *
   * É o teste que faz "um único paciente com LTV divergente reprova a clínica
   * inteira" ser verdade: dois pacientes com os valores TROCADOS têm a mesma
   * soma, e uma conferência de total passaria verde.
   */
  it('MUTAÇÃO · dois pacientes com os valores TROCADOS reprovam, mesmo com a soma igual', () => {
    const origem = new Map([
      ['p1', Dinheiro.deCentavos(100n)],
      ['p2', Dinheiro.deCentavos(50n)],
    ])
    const destino = new Map([
      ['p1', Dinheiro.deCentavos(50n)],
      ['p2', Dinheiro.deCentavos(100n)],
    ])
    const l = compararMapas('LTV', origem, destino)
    expect(l.bate).toBe(false)
    expect(l.divergencias).toHaveLength(2)
  })

  it('não há tolerância: um centavo de diferença reprova', () => {
    const l = compararMapas(
      'LTV',
      new Map([['p1', Dinheiro.deCentavos(100n)]]),
      new Map([['p1', Dinheiro.deCentavos(101n)]]),
    )
    expect(l.bate).toBe(false)
  })

  it('a chave do relatório é o id, e o relatório NÃO carrega nome nenhum', () => {
    const l = compararMapas(
      'LTV',
      new Map([['p1', Dinheiro.deCentavos(100n)]]),
      new Map([['p1', Dinheiro.deCentavos(0n)]]),
    )
    expect(l.divergencias[0]).toEqual({
      conferencia: 'LTV',
      chave: 'p1',
      origem: '100',
      destino: '0',
    })
  })
})

describe('colisão de `novoId()` — detecta e REPROVA, nunca resolve', () => {
  /**
   * **MUTAÇÃO:** deduplicar por `Map` e seguir em frente.
   *
   * `novoId()` é um UUID truncado em 8 hex: 32 bits. Em dezenas de milhares de
   * linhas a colisão é plausível, e duas tarefas com o mesmo id já estão
   * ambíguas **na origem** — o `atualizarTarefa` da v20 mexia na primeira que
   * achava. Nenhuma escolha do migrador é correta.
   */
  it('MUTAÇÃO · id repetido na mesma aba é ACHADO, com a posição das duas linhas', () => {
    const p = planilha({
      Equipe: EQUIPE,
      Pacientes: [
        { id: txt('p1'), nome: txt('Paciente Um') },
        { id: txt('p1'), nome: txt('Outra Paciente') },
      ],
    })
    const d = exigir(lerDadosDaV20(p))
    const colisoes = colisoesDeId(d)
    expect(colisoes).toHaveLength(1)
    expect(colisoes[0]!.aba).toBe('Pacientes')
    expect(colisoes[0]!.codigo).toBe('IdRepetido')
  })

  it('o mesmo id em abas DIFERENTES não é colisão — a chave inclui a entidade', () => {
    const p = planilha({
      Equipe: [{ id: txt('x1'), nome: txt('Ana Beatriz'), admin: txt('SIM'), ativo: txt('SIM') }],
      Pacientes: [{ id: txt('x1'), nome: txt('Paciente Um') }],
    })
    expect(colisoesDeId(exigir(lerDadosDaV20(p)))).toHaveLength(0)
  })
})

describe('`usuario` cunhado (D-10) — colisão é decisão humana', () => {
  it('as duas primeiras palavras, na forma canônica', () => {
    expect(cunharUsuario('Ana Paula Silva')).toBe('ana.paula')
    expect(cunharUsuario('José')).toBe('jose')
    expect(cunharUsuario('  Maria   Souza  ')).toBe('maria.souza')
  })

  /**
   * **MUTAÇÃO:** acrescentar sufixo (`ana.paula2`) na colisão.
   *
   * É o que a migration 0012 já recusou por escrito: um usuário que ninguém
   * sabe que tem e que a pessoa não consegue adivinhar no balcão. O usuário
   * precisa ser DITÁVEL por telefone.
   */
  it('MUTAÇÃO · colisão RECUSA a pessoa e vira problema, nunca sufixo', () => {
    const r = cunharUsuarios([
      { id: 'u1', nome: 'Ana Paula Silva', funcao: '', admin: true, ativo: true },
      { id: 'u2', nome: 'Ana Paula Costa', funcao: '', admin: false, ativo: true },
    ])
    expect(r.porPessoa.get('u1')).toBe('ana.paula')
    expect(r.porPessoa.has('u2')).toBe(false)
    expect(r.problemas.map((p) => p.codigo)).toEqual(['UsuarioColide'])
  })

  it('nome que não produz usuário válido é problema, não um nome inventado', () => {
    const r = cunharUsuarios([{ id: 'u1', nome: 'Jô', funcao: '', admin: true, ativo: true }])
    expect(r.porPessoa.has('u1')).toBe(false)
    expect(r.problemas[0]!.codigo).toBe('UsuarioInvalido:CURTO')
  })
})

describe('as decisões que o migrador NÃO toma', () => {
  const comNaoAdmin = planilha({
    Equipe: [
      ...EQUIPE,
      { id: txt('u3'), nome: txt('Diana Reis'), funcao: txt('Fisioterapeuta'), admin: txt('NÃO'), ativo: txt('SIM') },
    ],
  })

  /**
   * **MUTAÇÃO:** usar `'pf_rec'` como padrão para `admin = false`.
   *
   * É o roteiro ("equipe com admin = false → Recepção"), e é por isso que ele
   * vem com "revisar com cada clínica, uma a uma". Recepção carrega `receber`,
   * `caixa`, `contas` e `cobrancas`: aplicá-lo em silêncio dá o caixa da
   * clínica a quem nunca o fechou. O migrador tem **veto** sobre atribuição de
   * perfil por chute.
   */
  it('MUTAÇÃO · não há perfil por omissão: cada não-admin sem decisão é PENDÊNCIA', () => {
    const d = exigir(lerDadosDaV20(comNaoAdmin))
    const p = pendenciasDeDecisao(d, {})
    expect(p.map((x) => x.codigo)).toEqual(['PerfilNaoRevisado', 'PerfilNaoRevisado'])
    expect(p.every((x) => x.aba === 'Equipe')).toBe(true)
  })

  it('com a decisão da clínica para todos, não há pendência de perfil', () => {
    const d = exigir(lerDadosDaV20(comNaoAdmin))
    const p = pendenciasDeDecisao(d, {
      perfilPorPessoa: new Map([
        ['u2', 'pf_rec'],
        ['u3', 'pf_enf'],
      ]),
    })
    expect(p).toHaveLength(0)
  })

  it('a administradora NÃO entra no mapa de perfis', () => {
    const d = exigir(lerDadosDaV20(comNaoAdmin))
    const p = pendenciasDeDecisao(d, {
      perfilPorPessoa: new Map([
        ['u2', 'pf_rec'],
        ['u3', 'pf_enf'],
      ]),
    })
    expect(p.some((x) => x.mensagem.includes('u1'))).toBe(false)
  })
})

describe('homônimos de nome — um fica vivo, nenhum é fundido', () => {
  const dois = (usos: readonly [number, number]) =>
    planilha({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Planos: [
        { id: txt('pl1'), nome: txt('Procedimento Alfa'), sessoes: num('12.0'), intervaloDias: num('7.0'), rotuloSessao: txt('Aplicação'), ativo: txt('SIM') },
        { id: txt('pl2'), nome: txt('procedimento alfa'), sessoes: num('4.0'), intervaloDias: num('7.0'), rotuloSessao: txt('Aplicação'), ativo: txt('SIM') },
      ],
      Adesoes: [
        ...Array.from({ length: usos[0] }, (_, i) => ({ id: txt(`a1${i}`), pacienteId: txt('p1'), planoId: txt('pl1'), inicio: txt('2026-01-01'), sessoes: num('12.0'), intervaloDias: num('7.0'), rotuloSessao: txt('Aplicação'), responsavelId: txt('u1'), modo: txt('avulso'), status: txt('ativo') })),
        ...Array.from({ length: usos[1] }, (_, i) => ({ id: txt(`a2${i}`), pacienteId: txt('p2'), planoId: txt('pl2'), inicio: txt('2026-01-01'), sessoes: num('4.0'), intervaloDias: num('7.0'), rotuloSessao: txt('Aplicação'), responsavelId: txt('u1'), modo: txt('avulso'), status: txt('ativo') })),
      ],
    })

  it('o nome normalizado é o que agrupa: caixa e acento não criam dois', () => {
    const g = homonimosDeProcedimento(exigir(lerDadosDaV20(dois([1, 0]))))
    expect(g).toHaveLength(1)
    expect(g[0]!.ids).toEqual(['pl1', 'pl2'])
    expect(g[0]!.usosPorId).toEqual([1, 0])
  })

  it('UM em uso: a escolha é determinada — fica o usado', () => {
    const g = homonimosDeProcedimento(exigir(lerDadosDaV20(dois([0, 2]))))
    expect(escolhaAutomatica(g[0]!)).toBe('pl2')
  })

  it('NENHUM em uso: fica o primeiro da aba', () => {
    const g = homonimosDeProcedimento(exigir(lerDadosDaV20(dois([0, 0]))))
    expect(escolhaAutomatica(g[0]!)).toBe('pl1')
  })

  /**
   * **MUTAÇÃO:** escolher "o mais usado" quando dois estão em uso.
   *
   * Os dois estão vivos, com `sessoes` diferentes, e desativar um muda o que a
   * clínica oferece **hoje**. Com a escolha automática, o migrador decidiria
   * em silêncio por quem atende no balcão — e é a clínica que sabe qual deles
   * ela ainda usa. Fundir os dois não está em discussão: `sessoes` difere.
   */
  it('MUTAÇÃO · DOIS em uso: `null`, e a clínica reprova até decidir', () => {
    const d = exigir(lerDadosDaV20(dois([1, 2])))
    expect(escolhaAutomatica(homonimosDeProcedimento(d)[0]!)).toBeNull()
    expect(pendenciasDeDecisao(d, {}).map((x) => x.codigo)).toContain('HomonimosEmUso')
  })

  it('com a decisão da clínica, o grupo deixa de ser pendência', () => {
    const d = exigir(lerDadosDaV20(dois([1, 2])))
    const p = pendenciasDeDecisao(d, {
      perfilPorPessoa: new Map([['u2', 'pf_rec']]),
      ativoPorNome: new Map([['procedimento alfa', 'pl2']]),
    })
    expect(p).toHaveLength(0)
  })

  it('escolha fora do grupo é recusada', () => {
    const d = exigir(lerDadosDaV20(dois([1, 2])))
    const p = pendenciasDeDecisao(d, {
      perfilPorPessoa: new Map([['u2', 'pf_rec']]),
      ativoPorNome: new Map([['procedimento alfa', 'pl9']]),
    })
    expect(p.map((x) => x.codigo)).toEqual(['EscolhaForaDoGrupo'])
  })

  it('CAMPANHA homônima segue a mesma regra, contada por tarefa', () => {
    const p = planilha({
      Equipe: EQUIPE,
      Pacientes: PACIENTES,
      Campanhas: [
        { id: txt('c1'), nome: txt('Campanha Um'), inicio: txt('2026-01-01'), fim: txt('2026-01-31'), metrica: txt('contatos'), meta: num('10.0') },
        { id: txt('c2'), nome: txt('CAMPANHA UM'), inicio: txt('2026-02-01'), fim: txt('2026-02-28'), metrica: txt('contatos'), meta: num('10.0') },
      ],
      Tarefas: [
        tarefa({ id: txt('t1'), pacienteId: txt('p1'), tipo: txt('Follow-up'), campanhaId: txt('c1') }),
        tarefa({ id: txt('t2'), pacienteId: txt('p1'), tipo: txt('Follow-up'), campanhaId: txt('c2') }),
      ],
    })
    const d = exigir(lerDadosDaV20(p))
    const g = homonimosDeCampanha(d)
    expect(g).toHaveLength(1)
    expect(g[0]!.aba).toBe('Campanhas')
    expect(escolhaAutomatica(g[0]!)).toBeNull()
  })
})

describe('`sessao` = "k/n" — as duas metades, ou nenhuma', () => {
  /**
   * **MUTAÇÃO:** usar `parseInt(split('/')[0])` como o `sessaoNum` do
   * `Code.gs`.
   *
   * Ele lê só a primeira metade e devolve `0` quando não dá. `sessao_e_do_
   * programa` (migration 0010) exige as DUAS e exige `indice BETWEEN 1 AND
   * total` — um `"3/2"` ou um `"0/4"` morreria no `INSERT`, no meio da
   * clínica, em vez de virar um achado com o número da linha.
   */
  it('MUTAÇÃO · "3/2", "0/4" e "3/" são nulos, não 3 e 0', () => {
    expect(lerSessao('5/12')).toEqual({ indice: 5, total: 12 })
    expect(lerSessao(' 1 / 4 ')).toEqual({ indice: 1, total: 4 })
    expect(lerSessao('3/2')).toBeNull()
    expect(lerSessao('0/4')).toBeNull()
    expect(lerSessao('3/')).toBeNull()
    expect(lerSessao('')).toBeNull()
  })
})

describe('contagem de linhas NÃO VAZIAS — o critério do `Code.gs`', () => {
  /**
   * **MUTAÇÃO:** contar "linha com alguma célula preenchida".
   *
   * O critério da v20 é `filter(l => l[0])` — a coluna `id`. As planilhas
   * reais têm quase mil linhas de grade formatada por aba, e uma delas tem
   * 1.000 linhas de `Unidades` com zero unidades. Outro critério faria a
   * contagem da origem discordar do que a própria v20 mostra na tela.
   */
  it('MUTAÇÃO · a linha sem `id` não conta, mesmo com outras células cheias', () => {
    const p: PlanilhaCrua = {
      abas: [
        ...(Object.keys(COLUNAS) as Aba[]).map((nome) => ({
          nome,
          cabecalho: [...COLUNAS[nome]],
          linhas:
            nome === 'Pacientes'
              ? [
                  { numero: 2, celulas: [txt('p1'), txt('Paciente Um')] },
                  { numero: 3, celulas: [txt(''), txt('Linha de grade')] },
                  { numero: 4, celulas: [txt('   '), txt('Só espaço')] },
                ]
              : [],
        })),
      ],
    }
    const d = exigir(lerDadosDaV20(p))
    expect(d.pacientes).toHaveLength(1)
    expect(conferirOrigem(d).contagens.Pacientes).toBe(1)
  })
})

describe('aba faltando RECUSA a planilha inteira', () => {
  it('o leitor de dados não adivinha uma aba que não existe', () => {
    const r = lerDadosDaV20({
      abas: [{ nome: 'Tarefas', cabecalho: [...COLUNAS.Tarefas], linhas: [] }],
    })
    expect(ehErro(r)).toBe(true)
    if (ehErro(r)) expect(r.erro.codigo).toBe('AbaFaltando')
  })
})
