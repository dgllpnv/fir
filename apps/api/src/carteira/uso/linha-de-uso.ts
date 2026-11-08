import { Dinheiro, type LinhaDeUsoDiario } from '@fir/domain'

/**
 * A linha de `uso_diario_cliente` como sai do banco, e a tradução para o
 * domínio. Num arquivo próprio porque tem dois leitores: a tela
 * (`UsoCarteiraService`) e o alerta R13 do job (`jobs/uso-diario-cliente.ts`).
 */
export type LinhaDeUsoDb = {
  cliente_carteira_id: string
  dia: string
  usuarios_cadastrados: number
  usuarios_ativos: number
  tarefas_criadas: number
  tarefas_concluidas: number
  tarefas_no_prazo: number
  tarefas_vencidas_abertas: number
  contatos_pacientes: number
  orcamentos_enviados: number
  orcamentos_pagos: number
  faltas: number
  faltas_recontatadas: number | null
  receita_registrada: string
}

/** `dia::text` e `receita_registrada::text`: nem `Date` do driver, nem `numeric` virando float. */
export const COLUNAS_DE_USO = `cliente_carteira_id, dia::text AS dia,
  usuarios_cadastrados, usuarios_ativos, tarefas_criadas, tarefas_concluidas,
  tarefas_no_prazo, tarefas_vencidas_abertas, contatos_pacientes,
  orcamentos_enviados, orcamentos_pagos, faltas, faltas_recontatadas,
  receita_registrada::text AS receita_registrada`

export const linhaDeUso = (l: LinhaDeUsoDb): LinhaDeUsoDiario => ({
  dia: l.dia,
  usuariosCadastrados: l.usuarios_cadastrados,
  usuariosAtivos: l.usuarios_ativos,
  tarefasCriadas: l.tarefas_criadas,
  tarefasConcluidas: l.tarefas_concluidas,
  tarefasNoPrazo: l.tarefas_no_prazo,
  tarefasVencidasAbertas: l.tarefas_vencidas_abertas,
  contatosPacientes: l.contatos_pacientes,
  orcamentosEnviados: l.orcamentos_enviados,
  orcamentosPagos: l.orcamentos_pagos,
  faltas: l.faltas,
  faltasRecontatadas: l.faltas_recontatadas,
  receitaRegistrada: Dinheiro.deCentavos(BigInt(l.receita_registrada)),
})

