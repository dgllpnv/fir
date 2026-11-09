import type { CampanhaNaLista } from '@fir/contracts'
import { mesesEntre, type StatusDeCampanhaCarteira } from '@fir/domain'
import type pg from 'pg'
import { SISTEMA } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { clinicaIdDeFonteConfiavel, type ClinicaId } from '../../banco/clinica-id'
import { CampanhasService } from '../../campanhas/campanhas.service'
import { RECEITA_DA_CAMPANHA } from '../../campanhas/receita-da-campanha'
import type { Relogio } from '../../comum/relogio'
import { diaDaClinica } from '../../estoque/dia-da-clinica'
import { DINHEIRO_QUE_ENTROU } from '../../financeiro/dinheiro-que-entrou'

/**
 * **K4 — A SINCRONIZAÇÃO DAS CAMPANHAS DA FIR CLINIC PARA A CARTEIRA.**
 *
 * Pela primeira vez de verdade: no protótipo ela é `Math.random`
 * (`index.html` L2946-2951), e a versão publicada declara a leitura desligada
 * (L1453, L2000).
 *
 * Para cada `Cliente Firmare` com clínica ligada, uma clínica por vez, DENTRO
 * da clínica (`banco.naClinica`, papel `fir_app`, RLS dela — ADR 0012 §3):
 *
 *  1. **O total de cada campanha vem do `CampanhasService`** (`listar`), a
 *     regra que já existe — receita, resultado, meta, categoria, situação. Não
 *     é recalculado aqui (ADR 0013 §5).
 *  2. **A quebra por MÊS** (ajuste 24 do gate de números) é a mesma soma, do
 *     mesmo predicado — tarefa concluída, com paciente, tipo de receita ou
 *     pagável com valor, recebimento não estornado e `DINHEIRO_QUE_ENTROU` —
 *     agrupada pelo mês do RECEBIMENTO **no fuso da clínica** (regras 22 e
 *     23). O ajuste 24 pede essa quebra dentro do `CampanhasService`; este
 *     ticket não é dono daquele arquivo, então a consulta mora aqui e é
 *     AMARRADA ao total dele a cada execução: se `Σ meses ≠ receita do
 *     CampanhasService` para qualquer campanha, o cliente inteiro falha e
 *     nada dele é gravado. Uma divergência entre as duas regras vira falha
 *     visível no log do worker na primeira rodada, nunca um número errado na
 *     tela.
 *  3. Grava em `campanhas_carteira` (papel `fir_carteira`), uma linha por
 *     campanha × mês, por UPSERT na chave `(campanha_origem_id,
 *     mes_referencia)` — regra 26: rodar três vezes dá as mesmas linhas.
 *
 * **O que esta função NUNCA escreve:** `investimento_centavos` e
 * `observacoes` (lançados à mão pela equipe — D-22 item 9, ajuste 27), e
 * nenhuma linha `origem = 'manual'`. Nunca apaga linha: campanha excluída na
 * clínica deixa as linhas da carteira como estavam (regra 27 — a carteira
 * sugere, não some com o que a equipe lançou em cima delas).
 *
 * **Payload e log sem dado de paciente** (LGPD A25): a consulta devolve só
 * campanha, mês, soma e contagem; nenhum id de paciente ou de tarefa sai da
 * transação da clínica. O resumo devolvido ao worker tem só identificadores
 * de cliente e de clínica e a mensagem de erro — nunca valor (regra 21).
 *
 * **Clientes encerrados não são lidos**: acabou o contrato, acabou a
 * finalidade (ADR 0013 §3, "monitorar a performance contratada").
 */

export type FalhaDaSincronizacao = { readonly clienteCarteiraId: string; readonly clinicaId: string; readonly erro: string }

export type ResumoDaSincronizacao = {
  readonly processados: number
  readonly linhasGravadas: number
  readonly falhas: readonly FalhaDaSincronizacao[]
}

type ClienteLigado = { id: string; clinica_id: string; grupo_id: string }
type LinhaMensal = { campanha_id: string; mes: string; receita: string; pagantes: number }

/** A célula pronta para gravar — tudo o que a sincronização é dona. */
type CelulaSincronizada = {
  readonly campanhaOrigemId: string
  readonly mes: string
  readonly nome: string
  readonly categoria: string
  readonly inicio: string
  readonly fim: string
  readonly metrica: CampanhaNaLista['metrica']
  readonly meta: bigint | null
  readonly resultado: bigint | null
  readonly receita: bigint
  readonly orcamentosPagos: number
  readonly status: StatusDeCampanhaCarteira
  readonly rotuloDaMetrica: string
}

export class SomaMensalDivergente extends Error {
  constructor(readonly campanhaId: string) {
    super(`a soma mensal da campanha ${campanhaId} não bate com a receita do CampanhasService`)
  }
}

export class CampanhaDeOutroCliente extends Error {
  constructor(readonly campanhaId: string) {
    super(`a campanha ${campanhaId} já está ligada a outro Cliente Firmare`)
  }
}

const STATUS_DA_SITUACAO: Record<CampanhaNaLista['situacao'], StatusDeCampanhaCarteira> = {
  futura: 'planejada',
  andamento: 'ativa',
  encerrada: 'encerrada',
}

const primeiroDoMes = (dia: string): string => `${dia.slice(0, 7)}-01`

/**
 * Roda para todos os clientes ligados, ou só para `clienteIds` — o recorte
 * existe para reprocessar um cliente (correção, backfill) e para o teste, que
 * não pode gravar nas fixtures de outros arquivos rodando em paralelo. O
 * agendador nunca o informa.
 */
export async function executarSincronizacaoDeCampanhas(
  banco: BancoService,
  relogio: Relogio,
  opcoes: { readonly clienteIds?: readonly string[] } = {},
): Promise<ResumoDaSincronizacao> {
  const recorte = opcoes.clienteIds
  const clientes = await banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
    c.query<ClienteLigado>(
      `SELECT id, clinica_id, grupo_id FROM clientes_carteira
        WHERE clinica_id IS NOT NULL AND excluido_em IS NULL AND status <> 'encerrado'
          ${recorte === undefined ? '' : 'AND id = ANY($1)'}
        ORDER BY id`,
      recorte === undefined ? [] : [[...recorte]],
    ),
  )
  if (clientes.rows.length === 0) return { processados: 0, linhasGravadas: 0, falhas: [] }

  // `clinicas` é a raiz do tenancy, sem RLS — mesmo uso legítimo do job de
  // uso diário (`uso-diario-cliente.ts`).
  const fusos = await banco.semIsolamentoDeClinica<{ id: string; fuso: string }>(
    'SELECT id, fuso FROM clinicas WHERE id = ANY($1)',
    [clientes.rows.map((c) => c.clinica_id)],
  )
  const fusoPorClinica = new Map(fusos.rows.map((r) => [r.id, r.fuso]))
  const campanhas = new CampanhasService(banco, relogio)

  const falhas: FalhaDaSincronizacao[] = []
  let processados = 0
  let linhasGravadas = 0

  for (const cliente of clientes.rows) {
    const fuso = fusoPorClinica.get(cliente.clinica_id)
    if (fuso === undefined) {
      falhas.push({ clienteCarteiraId: cliente.id, clinicaId: cliente.clinica_id, erro: 'clínica não encontrada' })
      continue
    }
    try {
      // `clinicaIdDeFonteConfiavel`: vem de `clientes_carteira.clinica_id`,
      // lido pelo próprio sistema — nunca de uma requisição.
      const clinicaId = clinicaIdDeFonteConfiavel(cliente.clinica_id)
      const celulas = await lerCelulasComRetentativa(banco, relogio, campanhas, clinicaId, fuso, cliente.id)
      linhasGravadas += await gravar(banco, relogio, cliente, celulas)
      processados += 1
    } catch (e) {
      falhas.push({
        clienteCarteiraId: cliente.id,
        clinicaId: cliente.clinica_id,
        erro: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return { processados, linhasGravadas, falhas }
}

/**
 * O total (`CampanhasService.listar`) e a quebra mensal são duas transações
 * — o `CampanhasService` abre a dele. Um pagamento lançado entre as duas faz
 * a soma divergir por um instante; uma segunda leitura resolve. Se divergir
 * de novo, é defeito de regra, e o cliente falha.
 */
async function lerCelulasComRetentativa(
  banco: BancoService,
  relogio: Relogio,
  campanhas: CampanhasService,
  clinicaId: ClinicaId,
  fuso: string,
  clienteCarteiraId: string,
): Promise<CelulaSincronizada[]> {
  try {
    return await lerCelulas(banco, relogio, campanhas, clinicaId, fuso, clienteCarteiraId)
  } catch (e) {
    if (!(e instanceof SomaMensalDivergente)) throw e
    return lerCelulas(banco, relogio, campanhas, clinicaId, fuso, clienteCarteiraId)
  }
}

async function lerCelulas(
  banco: BancoService,
  relogio: Relogio,
  campanhas: CampanhasService,
  clinicaId: ClinicaId,
  fuso: string,
  clienteCarteiraId: string,
): Promise<CelulaSincronizada[]> {
  const lista = await campanhas.listar({ clinicaId, ator: SISTEMA, fuso })
  const mensal = await banco.naClinica(clinicaId, SISTEMA, (c: pg.PoolClient) =>
    c.query<LinhaMensal>(
      `SELECT t.campanha_id::text AS campanha_id,
              to_char(date_trunc('month', r.recebido_em AT TIME ZONE $2), 'YYYY-MM-DD') AS mes,
              sum(r.valor)::text AS receita,
              count(DISTINCT t.paciente_id)::int AS pagantes
         FROM tarefas t
         JOIN recebimentos r
           ON r.tarefa_id = t.id
          AND r.estornado_em IS NULL
          AND ${DINHEIRO_QUE_ENTROU}
        WHERE t.clinica_id = $1
          AND t.campanha_id IS NOT NULL
          AND t.excluida_em IS NULL
          -- O predicado ÚNICO da receita da campanha (correções da PO, N-2).
          AND ${RECEITA_DA_CAMPANHA}
        GROUP BY 1, 2`,
      [clinicaId, fuso],
    ),
  )
  // Os meses que JÁ existem na carteira para estas campanhas entram de novo
  // no cálculo: um estorno que zerou um mês tem de zerar a linha daquele
  // mês, nunca deixá-la com a receita antiga.
  const existentes = await banco.nasTabelasDaCarteiraComEscopo('geral', null, (c) =>
    c.query<{ campanha_origem_id: string; mes: string }>(
      `SELECT campanha_origem_id::text AS campanha_origem_id, mes_referencia::text AS mes
         FROM campanhas_carteira
        WHERE cliente_carteira_id = $1 AND origem = 'sincronizada'`,
      [clienteCarteiraId],
    ),
  )

  const mesAtualDaClinica = primeiroDoMes(diaDaClinica(relogio, fuso))
  const celulas: CelulaSincronizada[] = []
  for (const camp of lista.campanhas) {
    const porMes = new Map<string, { receita: bigint; pagantes: number }>()
    for (const l of mensal.rows) {
      if (l.campanha_id === camp.id) porMes.set(l.mes, { receita: BigInt(l.receita), pagantes: l.pagantes })
    }
    const soma = [...porMes.values()].reduce((s, x) => s + x.receita, 0n)
    // `receita` é `centavosNaSaida` (nullable por causa da redação HTTP); o
    // serviço chamado direto, sem interceptor, sempre a preenche. `null` aqui
    // seria defeito — tratado como divergência, nunca como zero.
    if (camp.receita === null || soma !== BigInt(camp.receita)) throw new SomaMensalDivergente(camp.id)

    // Os meses da campanha que já aconteceram (até o mês corrente da
    // clínica) — e, para a campanha futura, o mês de início, para ela
    // aparecer como "planejada" (L1446). Mais os meses com receita e os que
    // já existem na carteira.
    const inicio = primeiroDoMes(camp.inicio)
    const fimDoPeriodo = primeiroDoMes(camp.fim) < mesAtualDaClinica ? primeiroDoMes(camp.fim) : mesAtualDaClinica
    const meses = new Set<string>(inicio > mesAtualDaClinica ? [inicio] : mesesEntre(inicio, fimDoPeriodo))
    for (const m of porMes.keys()) meses.add(m)
    for (const e of existentes.rows) if (e.campanha_origem_id === camp.id) meses.add(e.mes)

    const ehReceita = camp.metrica === 'receita'
    for (const mes of [...meses].sort()) {
      const doMes = porMes.get(mes) ?? { receita: 0n, pagantes: 0 }
      celulas.push({
        campanhaOrigemId: camp.id,
        mes,
        nome: camp.nome.slice(0, 80),
        categoria: (camp.categoria.trim() === '' ? 'Outra' : camp.categoria).slice(0, 60),
        inicio: camp.inicio,
        fim: camp.fim,
        metrica: camp.metrica,
        meta: ehReceita ? BigInt(camp.metaEmDinheiro ?? '0') : camp.metaEmNumero === null ? null : BigInt(camp.metaEmNumero),
        // Métrica de receita: o resultado da CÉLULA é a receita do mês, e a
        // soma das células é o resultado da campanha. Gravar o total da
        // campanha em cada mês deixaria "resultado − meses visíveis" isolar
        // um mês suprimido. As outras métricas são contagens da campanha
        // inteira (o `CampanhasService` não as quebra por mês) e não são
        // dinheiro.
        resultado: ehReceita ? doMes.receita : camp.resultadoEmNumero === null ? null : BigInt(camp.resultadoEmNumero),
        receita: doMes.receita,
        orcamentosPagos: doMes.pagantes,
        status: STATUS_DA_SITUACAO[camp.situacao],
        rotuloDaMetrica: camp.rotuloDaMeta.slice(0, 60),
      })
    }
  }
  return celulas
}

/**
 * Uma transação por cliente: as células e a marca de "sincronizado em" entram
 * juntas ou não entram.
 *
 * O `DO UPDATE` só reescreve o que a sincronização é dona — e só quando algo
 * mudou (`IS DISTINCT FROM`), para que `atualizado_em` também seja
 * idempotente. `investimento_centavos` e `observacoes` não aparecem em lugar
 * nenhum deste SQL, nem no INSERT.
 *
 * O `WHERE` de dono (`cliente_carteira_id` igual) impede que uma campanha já
 * ligada a outro cliente seja "roubada" se a ligação clínica→cliente mudar: o
 * upsert não devolve linha, e o cliente falha com `CampanhaDeOutroCliente`.
 */
async function gravar(
  banco: BancoService,
  relogio: Relogio,
  cliente: ClienteLigado,
  celulas: readonly CelulaSincronizada[],
): Promise<number> {
  return banco.nasTabelasDaCarteiraComEscopo('geral', null, async (c) => {
    let gravadas = 0
    for (const x of celulas) {
      const r = await c.query(
        `INSERT INTO campanhas_carteira (
           cliente_carteira_id, grupo_id, campanha_origem_id, origem,
           nome, periodo_inicio, periodo_fim, metrica, meta, resultado,
           mes_referencia, receita_centavos, orcamentos_pagos, categoria, status, rotulo_da_metrica
         ) VALUES ($1, $2, $3, 'sincronizada', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (campanha_origem_id, mes_referencia) WHERE campanha_origem_id IS NOT NULL
         DO UPDATE SET
           nome              = EXCLUDED.nome,
           periodo_inicio    = EXCLUDED.periodo_inicio,
           periodo_fim       = EXCLUDED.periodo_fim,
           metrica           = EXCLUDED.metrica,
           meta              = EXCLUDED.meta,
           resultado         = EXCLUDED.resultado,
           receita_centavos  = EXCLUDED.receita_centavos,
           orcamentos_pagos  = EXCLUDED.orcamentos_pagos,
           categoria         = EXCLUDED.categoria,
           status            = EXCLUDED.status,
           rotulo_da_metrica = EXCLUDED.rotulo_da_metrica,
           atualizado_em     = now()
         WHERE campanhas_carteira.cliente_carteira_id = EXCLUDED.cliente_carteira_id
           AND (campanhas_carteira.nome, campanhas_carteira.periodo_inicio, campanhas_carteira.periodo_fim,
                campanhas_carteira.metrica, campanhas_carteira.meta, campanhas_carteira.resultado,
                campanhas_carteira.receita_centavos, campanhas_carteira.orcamentos_pagos,
                campanhas_carteira.categoria, campanhas_carteira.status, campanhas_carteira.rotulo_da_metrica)
               IS DISTINCT FROM
               (EXCLUDED.nome, EXCLUDED.periodo_inicio, EXCLUDED.periodo_fim,
                EXCLUDED.metrica, EXCLUDED.meta, EXCLUDED.resultado,
                EXCLUDED.receita_centavos, EXCLUDED.orcamentos_pagos,
                EXCLUDED.categoria, EXCLUDED.status, EXCLUDED.rotulo_da_metrica)
         RETURNING id`,
        [
          cliente.id,
          cliente.grupo_id,
          x.campanhaOrigemId,
          x.nome,
          x.inicio,
          x.fim,
          x.metrica,
          x.meta === null || x.meta <= 0n ? null : x.meta.toString(),
          x.resultado === null ? null : x.resultado.toString(),
          x.mes,
          x.receita.toString(),
          x.orcamentosPagos,
          x.categoria,
          x.status,
          x.rotuloDaMetrica,
        ],
      )
      if (r.rowCount === 0) {
        // Nada gravado: ou não mudou nada (idempotência), ou a linha é de
        // outro cliente. Só o segundo é falha.
        const dono = await c.query<{ cliente_carteira_id: string }>(
          `SELECT cliente_carteira_id::text AS cliente_carteira_id FROM campanhas_carteira
            WHERE campanha_origem_id = $1 AND mes_referencia = $2`,
          [x.campanhaOrigemId, x.mes],
        )
        if (dono.rows[0]?.cliente_carteira_id !== cliente.id) throw new CampanhaDeOutroCliente(x.campanhaOrigemId)
      } else {
        gravadas += 1
      }
    }
    await c.query(
      `INSERT INTO sincronizacao_campanhas_carteira (cliente_carteira_id, grupo_id, sincronizado_em)
       VALUES ($1, $2, $3)
       ON CONFLICT (cliente_carteira_id) DO UPDATE SET sincronizado_em = EXCLUDED.sincronizado_em`,
      [cliente.id, cliente.grupo_id, relogio.agora()],
    )
    return gravadas
  })
}
