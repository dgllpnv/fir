import { alertaDeUso, janela, saudeDoUso, somarDias } from '@fir/domain'
import type pg from 'pg'
import { SISTEMA } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../../banco/clinica-id'
import type { Relogio } from '../../comum/relogio'
import { diaDaClinica } from '../../estoque/dia-da-clinica'
import { COLUNAS_DE_USO, type LinhaDeUsoDb, linhaDeUso } from '../uso/linha-de-uso'
import { consultarPrazos, contarConversaoDeOrcamentos, contarTarefasCriadas } from '../../painel-geral/metricas-diarias'
import {
  contarContatosDePacientes,
  contarFaltas,
  contarFaltasRecontatadas,
  contarTarefasConcluidas,
  contarTarefasVencidasAbertas,
  contarUsuarios,
  somarReceitaRegistrada,
} from './metricas-do-dia'

/**
 * **G4 — O JOB QUE POPULA `uso_diario_cliente`.**
 *
 * Uma linha por `Cliente Firmare` ativo, por dia — o dia é SEMPRE "ontem" NO
 * FUSO DA PRÓPRIA CLÍNICA (regra 22/23), nunca um UTC fixo: duas clínicas em
 * fusos diferentes têm "ontem" terminando em instantes UTC diferentes, e
 * calcular as duas com a mesma borda UTC fecharia o dia de uma delas cedo ou
 * tarde demais. `diaDaClinica` já resolve isso por clínica; este job só o
 * chama uma vez por cliente, com o fuso DAQUELA clínica.
 *
 * **O agendador (`fila-uso-diario.ts`) dispara uma vez por dia, num horário
 * UTC fixo.** Isso não viola a regra do fuso: o QUE calcular é por clínica
 * (aqui, em `diaDaClinica`); QUANDO disparar é operacional — madrugada
 * adentro é suficiente para que "ontem" já tenha de fato terminado em
 * qualquer fuso do Brasil (UTC-2 a UTC-5) no momento em que o job lê.
 *
 * **IDEMPOTENTE, por UPSERT na chave `(cliente_carteira_id, dia)`** (regra 26
 * / UNIQUE da migration 0028): rodar duas vezes para o mesmo dia escreve a
 * MESMA linha, nunca duplica — e é assim que `uso-diario-cliente.e2e.test.ts`
 * prova.
 *
 * **`faltas_recontatadas` (G8 1D).** Decisão do dono (plano §9, itens 5/5b):
 * reagendamento NO DIA de um cartão cuja etapa anterior era `faltou` ou
 * `desmarcou` — `contarFaltasRecontatadas`. Desde a migration 0046 a coluna é
 * NULL até este job calcular o dia, e a tela oculta o número enquanto houver
 * dia sem cálculo na janela (PP-8).
 *
 * **R13 — o alerta de uso baixo.** Depois de gravar o dia, a saúde do uso
 * (`saudeDoUso`, `@fir/domain` — a MESMA regra da tela FIR Clinic) é avaliada
 * com "hoje" = o dia seguinte ao calculado. Crítico vira uma tarefa interna
 * de prioridade alta, "FIR Clinic sem uso em X: ligar para a recepção", com
 * chave `(cliente_carteira_id, alerta_de_uso_dia)` e `ON CONFLICT DO NOTHING`:
 * rodar três vezes cria uma, e a que a equipe cancelou não renasce (regra 27).
 * Só o nome da clínica e a situação, nunca nome de funcionária (A19). Sem
 * responsável: o "setor comercial" do protótipo (L1576) chega com os perfis
 * do Usuário de Gestão (ticket 0.5).
 */

export type FalhaDoJob = { readonly clienteCarteiraId: string; readonly clinicaId: string; readonly erro: string }

export type ResumoDoJob = {
  /** Quantos `Cliente Firmare` ativos tiveram a linha do dia escrita. */
  readonly processados: number
  /** Um cliente com erro não derruba os outros — cada um é a própria transação. */
  readonly falhas: readonly FalhaDoJob[]
}

type ClienteAtivo = { id: string; nome: string; clinica_id: string; grupo_id: string; status: string }

/**
 * Roda para TODOS os `Cliente Firmare` `ativo` OU em `onboarding` — a MESMA regra da tela
 * FIR Clinic (`uso-carteira.service.ts`). Antes só o `ativo` era medido e a tela listava o
 * onboarding como "aguardando o primeiro resumo" para sempre (2026-11-11: a cliente vinculou
 * a clínica do Dr. Daniel, usou, e nada aparecia). O ALERTA de uso baixo (R13) continua só
 * para `ativo`: quem está em onboarding ainda está aprendendo, e "ligar para a recepção"
 * por uso baixo seria ruído.
 *
 * `diaAlvo`, se informado, SUBSTITUI "ontem no fuso da clínica" pelo dia
 * pedido — existe para reprocessar um dia específico (backfill, correção) e
 * para o teste, que não pode esperar a virada real do relógio para provar a
 * idempotência. Em produção, o agendador NUNCA o informa.
 */
export async function executarUsoDiarioCliente(
  banco: BancoService,
  relogio: Relogio,
  diaAlvo?: string,
): Promise<ResumoDoJob> {
  const clientes = await banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
    c.query<ClienteAtivo>(
      `SELECT id, nome, clinica_id, grupo_id, status FROM clientes_carteira
        WHERE status IN ('ativo', 'onboarding') AND excluido_em IS NULL
          -- Desde a 0047 o cliente pode existir sem clínica na FIR Clinic (D-22
          -- item 4): sem clínica não há uso a medir, e isso não é falha.
          AND clinica_id IS NOT NULL`,
    ),
  )
  if (clientes.rows.length === 0) return { processados: 0, falhas: [] }

  // `clinicas` não é da carteira (0001 já dá `SELECT` a `fir_app`, e é a RAIZ
  // do tenancy, sem RLS — `semIsolamentoDeClinica` é o nome desconfortável de
  // propósito para este uso legítimo, igual ao healthcheck). `fir_carteira`
  // não precisa de um GRANT novo: o fuso é lido pelo pool do PRODUTO, nunca
  // pelo da carteira.
  const idsDasClinicas = clientes.rows.map((c) => c.clinica_id)
  const clinicasResultado = await banco.semIsolamentoDeClinica<{ id: string; fuso: string }>(
    'SELECT id, fuso FROM clinicas WHERE id = ANY($1)',
    [idsDasClinicas],
  )
  const fusoPorClinica = new Map(clinicasResultado.rows.map((r) => [r.id, r.fuso]))

  const falhas: FalhaDoJob[] = []
  let processados = 0

  for (const cliente of clientes.rows) {
    const fuso = fusoPorClinica.get(cliente.clinica_id)
    if (fuso === undefined) {
      falhas.push({
        clienteCarteiraId: cliente.id,
        clinicaId: cliente.clinica_id,
        erro: 'clínica não encontrada (FK deveria impedir isto)',
      })
      continue
    }

    try {
      const dia = diaAlvo ?? somarDias(diaDaClinica(relogio, fuso), -1)
      const diaSeguinte = somarDias(dia, 1)
      const j = janela(dia, dia, fuso)

      // `clinicaIdDeFonteConfiavel`: o valor vem de `clientes_carteira.
      // clinica_id`, lido do próprio banco por uma conexão do SISTEMA — nunca
      // da requisição de um navegador. É o terceiro chamador legítimo ao lado
      // dos dois documentados em `clinica-id.ts`.
      const clinicaId = clinicaIdDeFonteConfiavel(cliente.clinica_id)

      const linha = await banco.naClinica(clinicaId, SISTEMA, async (c: pg.PoolClient) => {
        const [prazos, tarefasCriadas, tarefasConcluidas, vencidasAbertas, contatos, orcamentos, faltas, recontatadas, usuarios, receita] =
          await Promise.all([
            consultarPrazos(c, cliente.clinica_id, { de: dia, ate: dia }, dia, fuso),
            contarTarefasCriadas(c, cliente.clinica_id, { de: dia, ate: dia }, fuso),
            contarTarefasConcluidas(c, cliente.clinica_id, j),
            contarTarefasVencidasAbertas(c, cliente.clinica_id, diaSeguinte),
            contarContatosDePacientes(c, cliente.clinica_id, j),
            contarConversaoDeOrcamentos(c, cliente.clinica_id, j),
            contarFaltas(c, cliente.clinica_id, j),
            contarFaltasRecontatadas(c, cliente.clinica_id, j),
            contarUsuarios(c, cliente.clinica_id, j),
            somarReceitaRegistrada(c, cliente.clinica_id, j),
          ])
        return {
          usuariosCadastrados: usuarios.cadastrados,
          usuariosAtivos: usuarios.ativos,
          tarefasCriadas,
          tarefasConcluidas,
          tarefasNoPrazo: prazos.total.noPrazo,
          tarefasVencidasAbertas: vencidasAbertas,
          contatosPacientes: contatos,
          orcamentosEnviados: orcamentos.enviados,
          orcamentosPagos: orcamentos.fechados,
          faltas,
          faltasRecontatadas: recontatadas,
          receitaRegistrada: receita,
        }
      })

      await banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
        c.query(
          `INSERT INTO uso_diario_cliente (
             cliente_carteira_id, grupo_id, dia,
             usuarios_cadastrados, usuarios_ativos, tarefas_criadas, tarefas_concluidas,
             tarefas_no_prazo, tarefas_vencidas_abertas, contatos_pacientes,
             orcamentos_enviados, orcamentos_pagos, faltas, receita_registrada, faltas_recontatadas
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (cliente_carteira_id, dia) DO UPDATE SET
             usuarios_cadastrados     = EXCLUDED.usuarios_cadastrados,
             usuarios_ativos          = EXCLUDED.usuarios_ativos,
             tarefas_criadas          = EXCLUDED.tarefas_criadas,
             tarefas_concluidas       = EXCLUDED.tarefas_concluidas,
             tarefas_no_prazo         = EXCLUDED.tarefas_no_prazo,
             tarefas_vencidas_abertas = EXCLUDED.tarefas_vencidas_abertas,
             contatos_pacientes       = EXCLUDED.contatos_pacientes,
             orcamentos_enviados      = EXCLUDED.orcamentos_enviados,
             orcamentos_pagos         = EXCLUDED.orcamentos_pagos,
             faltas                   = EXCLUDED.faltas,
             receita_registrada       = EXCLUDED.receita_registrada,
             faltas_recontatadas      = EXCLUDED.faltas_recontatadas`,
          [
            cliente.id,
            cliente.grupo_id,
            dia,
            linha.usuariosCadastrados,
            linha.usuariosAtivos,
            linha.tarefasCriadas,
            linha.tarefasConcluidas,
            linha.tarefasNoPrazo,
            linha.tarefasVencidasAbertas,
            linha.contatosPacientes,
            linha.orcamentosEnviados,
            linha.orcamentosPagos,
            linha.faltas,
            linha.receitaRegistrada.toString(),
            linha.faltasRecontatadas,
          ],
        ),
      )

      if (cliente.status === 'ativo') await alertarUsoBaixo(banco, cliente, somarDias(dia, 1))
      processados += 1
    } catch (erro) {
      falhas.push({
        clienteCarteiraId: cliente.id,
        clinicaId: cliente.clinica_id,
        erro: erro instanceof Error ? erro.message : String(erro),
      })
    }
  }

  return { processados, falhas }
}

/**
 * R13. "Hoje" é o dia seguinte ao recém-calculado: em produção, o dia corrente
 * da clínica; num reprocessamento, o dia em que o alerta teria nascido. A
 * janela da saúde é a semana anterior a ele — 14 dias de linhas bastam.
 */
async function alertarUsoBaixo(banco: BancoService, cliente: ClienteAtivo, hoje: string): Promise<void> {
  await banco.nasTabelasDaCarteiraComEscopo('geral', null, async (c) => {
    const linhas = await c.query<LinhaDeUsoDb>(
      `SELECT ${COLUNAS_DE_USO} FROM uso_diario_cliente
        WHERE cliente_carteira_id = $1 AND dia >= $2::date AND dia < $3::date`,
      [cliente.id, somarDias(hoje, -14), hoje],
    )
    const alerta = alertaDeUso(cliente.nome, saudeDoUso(linhas.rows.map(linhaDeUso), hoje))
    if (alerta === null) return
    await c.query(
      `INSERT INTO tarefas_internas
         (titulo, descricao, grupo_id, cliente_carteira_id, prazo, prioridade, alerta_de_uso_dia)
       VALUES ($1, $2, $3, $4, $5::date, 'alta', $5::date)
       ON CONFLICT (cliente_carteira_id, alerta_de_uso_dia) WHERE alerta_de_uso_dia IS NOT NULL
       DO NOTHING`,
      [alerta.titulo, alerta.descricao, cliente.grupo_id, cliente.id, hoje],
    )
  })
}
