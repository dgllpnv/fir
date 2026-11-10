import { type CartaoDaColuna, FichaDoPaciente, RespostaDaJornada, type TarefaNaLista } from '@fir/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * **SEM `pacientes`, O NOME NÃO É LINK** (appsec S-1).
 *
 * `GET /v1/pacientes/:id` exige `pacientes`; Enfermagem não a tem. Um link
 * para a ficha na mão dela é um toque que dá 403. A tela resolve
 * `temPerm(…, 'pacientes')` e o cartão desenha o nome como TEXTO.
 *
 * Renderização de verdade (`renderToStaticMarkup`), e não varredura de fonte:
 * o que se cobra é o HTML que sai, com e sem a permissão.
 */

// A Jornada busca os dados por `useDados`; aqui eles chegam prontos.
const resposta: { atual: RespostaDaJornada | FichaDoPaciente | null } = { atual: null }
vi.mock('@/lib/dados', () => ({
  useDados: () => ({ dados: resposta.atual, carregando: false, erro: null, recarregar: () => {} }),
  consultaEmTexto: () => '',
}))

const { CartaoDeTarefa } = await import('./cartao-de-tarefa')
const { TelaJornada } = await import('./tela-jornada')
const { FichaDoPaciente: Ficha } = await import('./ficha-do-paciente')

const PACIENTE = '11111111-1111-4111-8111-111111111111'
const TAREFA = '22222222-2222-4222-8222-222222222222'

const tarefa: TarefaNaLista = {
  id: TAREFA,
  solicitanteId: 'p1',
  solicitanteNome: 'Beatriz',
  responsavelId: 'p1',
  responsavelNome: 'Beatriz',
  contatoId: null,
  contatoNome: null,
  descricao: 'Retorno',
  prazo: '2026-10-24',
  hora: null,
  prioridade: 'normal',
  status: 'aberta',
  concluidaEm: null,
  criadaEm: '2026-10-24T12:00:00.000Z',
  pacienteId: PACIENTE,
  pacienteNome: 'Ana Lúcia Souza',
  pacienteTelefone: null,
  pacienteConferirCadastro: false,
  tipo: 'Retorno',
  etapa: null,
  historico: [],
  valorOrcamento: null,
  programaOrcado: null,
  motivoPerdaId: null,
  proximoPassoEm: null,
  confirmacaoEnviadaEm: null,
  resultado: '',
  obs: '',
  serieId: null,
  recorrencia: '',
  unidadeId: null,
  campanhaId: null,
  atrasada: false,
  sessao: null,
  pagamento: null,
}

const acoes = {
  concluir: async () => {},
  cancelar: async () => {},
  reabrir: async () => {},
  editar: () => {},
}

const cartao = (podePacientes: boolean) =>
  renderToStaticMarkup(
    createElement(CartaoDeTarefa, {
      tarefa,
      hoje: '2026-10-24',
      eu: 'p1',
      podeEquipe: false,
      podePacientes,
      acoes,
    }),
  )

describe('o cartão de tarefa (Hoje, Tarefas)', () => {
  it('COM `pacientes`: o nome leva à ficha', () => {
    const html = cartao(true)
    expect(html).toContain(`href="/pacientes/${PACIENTE}"`)
    expect(html).toContain('Ana Lúcia Souza')
  })

  it('SEM `pacientes`: o nome é texto, e nenhum link aponta para a ficha', () => {
    const html = cartao(false)
    expect(html).not.toContain('/pacientes/')
    expect(html).toContain('Ana Lúcia Souza')
  })
})

const mini: CartaoDaColuna = {
  id: TAREFA,
  pacienteId: PACIENTE,
  pacienteNome: 'Ana Lúcia Souza',
  tipo: 'Consulta agendada',
  etapa: 'agendado',
  prazo: '2026-10-25',
  hora: null,
  proximoPassoEm: null,
  ultimoEventoEm: null,
  valorOrcamento: null,
}

const jornada = (podePacientes: boolean) => {
  // `parse`: a resposta de mentira tem a forma do contrato, ou o teste cai aqui.
  resposta.atual = RespostaDaJornada.parse({
    de: '2026-09-25',
    ate: '2026-10-24',
    rotuloDoPeriodo: 'Últimos 30 dias',
    hoje: '2026-10-24',
    funil: [],
    noShow: { n: 0, taxa: null },
    desmarcados: { n: 0 },
    perdidos: { n: 0, valor: null },
    colunas: [
      { chave: 'agendadas', rotulo: 'Agendadas', n: 1, valor: null, itens: [mini], restantes: 0 },
    ],
  })
  return renderToStaticMarkup(createElement(TelaJornada, { podePacientes }))
}

describe('o mini-cartão da Jornada', () => {
  it('COM `pacientes`: leva à tarefa dentro da ficha', () => {
    expect(jornada(true)).toContain(`href="/pacientes/${PACIENTE}?tarefa=${TAREFA}"`)
  })

  it('SEM `pacientes`: o mini-cartão é texto', () => {
    const html = jornada(false)
    expect(html).not.toContain('/pacientes/')
    expect(html).toContain('Ana Lúcia Souza')
  })
})

/**
 * A FICHA sem `jornada` (appsec S-5): a faixa da jornada — "Fechou",
 * "Perdeu", follow-up — não é desenhada. O servidor já devolve o histórico
 * vazio e responde 403 às ações; a tela só não oferece o botão.
 */
const PESSOA = '33333333-3333-4333-8333-333333333333'
const ficha = (podeJornada: boolean) => {
  resposta.atual = FichaDoPaciente.parse({
    id: PACIENTE,
    nome: 'Ana Lúcia Souza',
    telefone: '',
    aniversario: null,
    origem: '',
    indicadoPor: '',
    unidadeId: null,
    ultimaConsulta: null,
    obs: '',
    conferirCadastro: false,
    ativo: true,
    criadoEm: '2026-10-01T12:00:00.000Z',
    ultimoAtendimento: '2026-10-24',
    tarefasAbertas: 1,
    ltv: null,
    saldo: null,
    credito: null,
    temSaldo: false,
    tarefas: [
      {
        ...tarefa,
        solicitanteId: PESSOA,
        responsavelId: PESSOA,
        tipo: 'Consulta realizada',
        status: 'concluida',
        concluidaEm: '2026-10-24T12:00:00.000Z',
        etapa: 'orcamento',
      },
    ],
    hoje: '2026-10-24',
    indicadora: null,
    indicadaPorPaciente: false,
    campanhaId: null,
  })
  return renderToStaticMarkup(
    createElement(Ficha, {
      id: PACIENTE,
      podeGerir: false,
      eu: PESSOA,
      podeEquipe: false,
      podeReceber: true,
      podeValores: false,
      podePacientes: true,
      podeJornada,
      tarefaEmFoco: null,
    }),
  )
}

describe('a ficha da paciente', () => {
  it('COM `jornada`: o cartão em orçamento traz a faixa da jornada', () => {
    expect(ficha(true)).toContain('class="jornada"')
  })

  it('SEM `jornada`: a faixa não aparece — nenhuma ação da jornada é oferecida', () => {
    const html = ficha(false)
    expect(html).toContain('Ana Lúcia Souza')
    expect(html).not.toContain('class="jornada"')
    expect(html).not.toContain('jbtn')
  })
})
