import { janela, somarDias } from '@fir/domain'
import type pg from 'pg'
import { SISTEMA } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../../banco/clinica-id'
import type { Relogio } from '../../comum/relogio'
import { diaDaClinica } from '../../estoque/dia-da-clinica'
import { consultarPrazos, contarConversaoDeOrcamentos, contarTarefasCriadas } from '../../painel-geral/metricas-diarias'
import {
  contarContatosDePacientes,
  contarFaltas,
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
 * **NUNCA escreve em `faltas_recontatadas`.** A definição ("falta ou
 * falta+desmarque", "data da falta ou do reagendamento") tem decisão do dono
 * registrada (plano §9, Q5/Q5b), mas rastrear o reagendamento SUBSEQUENTE a
 * uma falta é trabalho novo de consulta que não foi escopo deste ticket — ver
 * o relatório final. A coluna fica com o `DEFAULT 0` do INSERT e intocada no
 * `UPDATE` (fora do `SET`), exatamente como o comentário dela pede: "0 aqui
 * seria 'zero recontatos', não 'ainda não decidido'" — e por isso este job
 * não escreve nem um `0` explícito nela.
 */

export type FalhaDoJob = { readonly clienteCarteiraId: string; readonly clinicaId: string; readonly erro: string }

export type ResumoDoJob = {
  /** Quantos `Cliente Firmare` ativos tiveram a linha do dia escrita. */
  readonly processados: number
  /** Um cliente com erro não derruba os outros — cada um é a própria transação. */
  readonly falhas: readonly FalhaDoJob[]
}

type ClienteAtivo = { id: string; clinica_id: string; grupo_id: string }

/**
 * Roda para TODOS os `Cliente Firmare` com `status = 'ativo'`.
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
      `SELECT id, clinica_id, grupo_id FROM clientes_carteira
        WHERE status = 'ativo' AND excluido_em IS NULL`,
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
        const [prazos, tarefasCriadas, tarefasConcluidas, vencidasAbertas, contatos, orcamentos, faltas, usuarios, receita] =
          await Promise.all([
            consultarPrazos(c, cliente.clinica_id, { de: dia, ate: dia }, dia, fuso),
            contarTarefasCriadas(c, cliente.clinica_id, { de: dia, ate: dia }, fuso),
            contarTarefasConcluidas(c, cliente.clinica_id, j),
            contarTarefasVencidasAbertas(c, cliente.clinica_id, diaSeguinte),
            contarContatosDePacientes(c, cliente.clinica_id, j),
            contarConversaoDeOrcamentos(c, cliente.clinica_id, j),
            contarFaltas(c, cliente.clinica_id, j),
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
          receitaRegistrada: receita,
        }
      })

      await banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
        c.query(
          `INSERT INTO uso_diario_cliente (
             cliente_carteira_id, grupo_id, dia,
             usuarios_cadastrados, usuarios_ativos, tarefas_criadas, tarefas_concluidas,
             tarefas_no_prazo, tarefas_vencidas_abertas, contatos_pacientes,
             orcamentos_enviados, orcamentos_pagos, faltas, receita_registrada
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
             receita_registrada       = EXCLUDED.receita_registrada`,
          // `faltas_recontatadas` FORA da lista — nem no INSERT (fica no
          // `DEFAULT 0` da coluna) nem no `SET` do UPDATE (fica com o que já
          // estava lá). Rodar este job de novo não apaga um valor lançado à
          // mão por outra via, no dia em que ela existir.
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
          ],
        ),
      )
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
