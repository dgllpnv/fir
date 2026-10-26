import type { SaldoDoPaciente as SaldoNoContrato } from '@fir/contracts'
import { Dinheiro, type EventoDeSaldo, type SaldoDoPaciente, saldoEmAberto, TIPOS } from '@fir/domain'
import type pg from 'pg'

/**
 * **A ÚNICA leitura de saldo em aberto do sistema.**
 *
 * Funções soltas, sem `@Injectable`, pelo mesmo motivo que `unidadeValida`:
 * quem precisa delas é a lista de pacientes (`PacientesService`), a ficha, a
 * tela Cobranças e a Visão do mês — quatro consumidores em três módulos. Um
 * provider obrigaria `PacientesModule` a importar `FinanceiroModule` só para
 * alcançar um `SELECT`, e a alternativa real seria a que o épico 2 tomou:
 * **escrever a regra uma segunda vez em SQL.**
 *
 * E é exatamente o que tinha acontecido. Até o épico 4, `pacientes.service.ts`
 * calculava o saldo com
 *
 * ```sql
 * greatest(0, Σ valor_aberto − Σ valor dos tipos que abatem)
 * ```
 *
 * — colapsado num total só e com o excedente **sumindo sem deixar rastro**.
 * Era a regra 5 escrita duas vezes na mesma árvore, já divergindo da
 * `saldoEmAberto` pura. O SQL foi apagado: enquanto ele existir, alguém volta
 * a chamá-lo.
 *
 * **O que este arquivo pode fazer, e o que não pode.** Ele lê fatos e nada
 * decide: a soma por grupo é só associatividade (`saldoEmAberto` soma dentro
 * do grupo antes de qualquer outra coisa), e por isso agregar **dentro** de um
 * grupo em SQL não move regra nenhuma. O que ele nunca pode fazer é somar
 * ATRAVÉS de grupos, clampar, ou decidir o que é crédito — isso é
 * `packages/domain`, e é a diferença entre as duas implementações que havia
 * aqui.
 */

/**
 * Os tipos cujo `valor` ABATE saldo — hoje, só "Pagamento de saldo em aberto".
 *
 * Derivado de `TIPOS`, nunca escrito à mão no SQL: a classificação mora numa
 * tabela só.
 */
const TIPOS_QUE_ABATEM = TIPOS.filter((t) => t.recebimento === true).map((t) => t.nome)

type LinhaDeGrupo = {
  paciente_id: string
  programa_id: string | null
  aberto: string
  abatido: string
}

/**
 * Um grupo por (paciente, programa), com os dois brutos.
 *
 * **O ÉPICO 5 TROCOU UMA LINHA.** Era `NULL::uuid AS programa_id`, e virou
 * `r.programa_id` quando a 0010 criou a coluna — nem o contrato, nem
 * `saldoEmAberto`, nem nada abaixo mudou. Foi para isso que o contrato nasceu
 * como lista de grupos com um grupo só, em vez de um total que "se agrupa
 * depois": o dia em que o agrupamento passou a existir, ele não pediu nova
 * forma de resposta nem nova regra de clamp.
 *
 * `$1` clínica · `$2` tipos que abatem · `$3` ids de paciente.
 */
const GRUPOS = `
  SELECT paciente_id, programa_id,
         coalesce(sum(valor_aberto), 0)::text AS aberto,
         coalesce(sum(valor) FILTER (WHERE tipo = ANY($2)), 0)::text AS abatido
    FROM (SELECT r.paciente_id,
                 r.programa_id,
                 r.valor, r.valor_aberto, r.tipo
            FROM recebimentos r
           WHERE r.clinica_id = $1 AND r.estornado_em IS NULL
             AND r.paciente_id = ANY($3::uuid[])) e
   GROUP BY paciente_id, programa_id`

const VAZIO: SaldoDoPaciente = saldoEmAberto([])

/** `string` de centavos → `Dinheiro`, sem passar por `Number` (regra 1). */
const dinheiro = (texto: string): Dinheiro => Dinheiro.deCentavos(BigInt(texto))

/**
 * O saldo de vários pacientes de uma vez — uma consulta, não uma por linha.
 *
 * Paciente sem recebimento nenhum **não volta do `SELECT`** e não some da
 * resposta: ele recebe `VAZIO`, que é `saldoEmAberto([])` — grupos vazios,
 * saldo zero, `temSaldo: false`. Deixá-lo de fora do mapa faria a lista de
 * pacientes perder a coluna em vez de mostrar zero.
 */
export async function saldosDe(
  c: pg.PoolClient,
  clinicaId: string,
  pacienteIds: readonly string[],
): Promise<Map<string, SaldoDoPaciente>> {
  const saldos = new Map<string, SaldoDoPaciente>()
  for (const id of pacienteIds) saldos.set(id, VAZIO)
  if (pacienteIds.length === 0) return saldos

  const r = await c.query<LinhaDeGrupo>(GRUPOS, [clinicaId, TIPOS_QUE_ABATEM, [...pacienteIds]])

  const porPaciente = new Map<string, EventoDeSaldo[]>()
  for (const linha of r.rows) {
    const eventos = porPaciente.get(linha.paciente_id) ?? []
    eventos.push({
      programaId: linha.programa_id,
      // Centavos como TEXTO no `SELECT`, `BigInt` aqui: o driver devolveria
      // `bigint` do Postgres como `string` de qualquer jeito, e `Number()`
      // mentiria acima de 2^53 (regra 1).
      aberto: dinheiro(linha.aberto),
      abatido: dinheiro(linha.abatido),
    })
    porPaciente.set(linha.paciente_id, eventos)
  }

  for (const [pacienteId, eventos] of porPaciente) {
    // Aqui, e só aqui, a regra acontece — no domínio puro.
    saldos.set(pacienteId, saldoEmAberto(eventos))
  }
  return saldos
}

export async function saldoDe(
  c: pg.PoolClient,
  clinicaId: string,
  pacienteId: string,
): Promise<SaldoDoPaciente> {
  return (await saldosDe(c, clinicaId, [pacienteId])).get(pacienteId) ?? VAZIO
}

/**
 * Os pacientes ATIVOS que podem ter saldo — o pré-filtro da tela Cobranças.
 *
 * Quem nunca teve um recebimento com `valor_aberto > 0` não tem como ter
 * saldo positivo, então ele não precisa atravessar o domínio. É pré-filtro, e
 * não a decisão: quem decide se há saldo continua sendo `saldoEmAberto`, e um
 * paciente que abriu e quitou volta daqui e sai de lá com `temSaldo: false`.
 */
export async function pacientesQuePodemTerSaldo(
  c: pg.PoolClient,
  clinicaId: string,
): Promise<readonly string[]> {
  const r = await c.query<{ id: string }>(
    `SELECT p.id FROM pacientes p
      WHERE p.clinica_id = $1 AND p.ativo
        AND EXISTS (SELECT 1 FROM recebimentos r
                     WHERE r.paciente_id = p.id AND r.estornado_em IS NULL AND r.valor_aberto > 0)`,
    [clinicaId],
  )
  return r.rows.map((x) => x.id)
}

/** O saldo do domínio na forma que o JSON fala: centavos em texto. */
export function saldoNoContrato(s: SaldoDoPaciente): SaldoNoContrato {
  return {
    grupos: s.grupos.map((g) => ({
      programaId: g.programaId,
      // O NOME do programa chega no épico 5, junto com a coluna.
      programa: null,
      aberto: g.aberto.centavos.toString(),
      abatido: g.abatido.centavos.toString(),
      saldo: g.saldo.centavos.toString(),
      credito: g.credito.centavos.toString(),
    })),
    saldo: s.saldo.centavos.toString(),
    credito: s.credito.centavos.toString(),
    temSaldo: s.temSaldo,
  }
}
