import type { TarefaNaLista } from '@fir/contracts'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CartaoDeTarefa } from './cartao-de-tarefa'

/**
 * **AS TAREFAS DE KPI EM HOJE** (1.9 E e H).
 *
 * - "Lançar [KPI]": o cartão oferece "Lançar valor" e o círculo abre a janela
 *   D.4 — a tarefa se conclui LANÇANDO (o servidor recusa concluí-la sem o
 *   lançamento, e recusa cancelar e excluir). A responsável pode não ter
 *   `indicadores`: o que a janela precisa vem na própria tarefa.
 * - Plano de ação: o selo do KPI, só com o nome (appsec C27).
 */

const KPI = '33333333-3333-4333-8333-333333333333'
const base: TarefaNaLista = {
  id: '22222222-2222-4222-8222-222222222222',
  solicitanteId: 'p9',
  solicitanteNome: 'Helena',
  responsavelId: 'p1',
  responsavelNome: 'Juliana',
  grupoId: null,
  grupoNome: null,
  destino: { tipo: 'pessoa', id: 'p1', nome: 'Juliana' },
  tarefaOrigemId: null,
  fluxo: [],
  contatoId: null,
  contatoNome: null,
  descricao: 'Lançar NPS',
  prazo: '2026-11-17',
  hora: null,
  prioridade: 'normal',
  status: 'aberta',
  concluidaEm: null,
  criadaEm: '2026-11-10T12:00:00.000Z',
  pacienteId: null,
  pacienteNome: null,
  pacienteTelefone: null,
  pacienteConferirCadastro: false,
  tipo: '',
  etapa: null,
  historico: [],
  valorOrcamento: null,
  valorFechado: null,
  valorDeReferencia: null,
  orcamentoParcial: false,
  programaOrcado: null,
  itensOrcamento: null,
  motivoPerdaId: null,
  proximoPassoEm: null,
  confirmacaoEnviadaEm: null,
  resultado: '',
  obs: '',
  serieId: null,
  recorrencia: '',
  unidadeId: null,
  campanhaId: null,
  kpi: { id: KPI, nome: 'NPS' },
  lancamentoDeKpi: {
    kpiId: KPI,
    nome: 'NPS',
    unidade: 'nota',
    comoMedir: 'Nota média do Google no domingo',
    referencia: '2026-11-16',
    prazo: '2026-11-17',
  },
  atrasada: false,
  sessao: null,
  pagamento: null,
}

const acoes = {
  concluir: async () => {},
  cancelar: async () => {},
  reabrir: async () => {},
  editar: () => {},
  excluir: async () => {},
}

const html = (t: TarefaNaLista, extra: Partial<{ lancarKpi: (t: TarefaNaLista) => void }> = { lancarKpi: () => {} }) =>
  renderToStaticMarkup(
    createElement(CartaoDeTarefa, {
      tarefa: t,
      hoje: '2026-11-17',
      eu: 'p1',
      podeEquipe: true,
      podePacientes: false,
      acoes: { ...acoes, ...extra },
    }),
  )

describe('a tarefa "Lançar [KPI]"', () => {
  it('oferece "Lançar valor", e o círculo diz que lança', () => {
    const h = html(base)
    expect(h).toContain('>Lançar valor<')
    expect(h).toContain('aria-label="Lançar o valor: Lançar NPS"')
  })

  it('não oferece cancelar nem excluir, que o servidor recusa', () => {
    expect(html(base)).not.toContain('Cancelar tarefa')
    expect(html({ ...base, status: 'concluida' })).not.toContain('>Excluir<')
  })

  it('não repete o selo do KPI, que já está na descrição', () => {
    expect(html(base)).not.toContain('Indicador: NPS')
  })

  it('concluída, não pede para lançar de novo', () => {
    expect(html({ ...base, status: 'concluida' })).not.toContain('>Lançar valor<')
  })

  it('numa tela sem a janela, o botão não aparece', () => {
    expect(html(base, {})).not.toContain('>Lançar valor<')
  })
})

describe('o plano de ação ligado a um KPI', () => {
  const plano: TarefaNaLista = { ...base, descricao: 'Ligar para quem deu nota baixa', lancamentoDeKpi: null }

  it('leva o selo do KPI, e conclui como qualquer tarefa', () => {
    const h = html(plano)
    expect(h).toContain('Indicador: NPS')
    expect(h).not.toContain('>Lançar valor<')
    expect(h).toContain('aria-label="Concluir: Ligar para quem deu nota baixa"')
    expect(h).toContain('Cancelar tarefa')
  })

  it('tarefa sem KPI não tem selo', () => {
    expect(html({ ...plano, kpi: null })).not.toContain('Indicador:')
  })
})
