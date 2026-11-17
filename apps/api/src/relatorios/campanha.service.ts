import {
  type CampanhaDaListaCriada,
  CriarCampanhaDaLista,
  MAX_PACIENTES_DA_CAMPANHA_DA_LISTA,
  Uuid,
} from '@fir/contracts'
import { ForbiddenException, Inject, Injectable, UnprocessableEntityException } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { atorEmColunas } from '../banco/ator'
import { CampanhasService } from '../campanhas/campanhas.service'
import { primeiroErro } from '../tarefas/tarefas.controller'
import { type ContextoDoMotor, MotorDeRelatorios } from './motor'

/**
 * **"CRIAR CAMPANHA COM ESTA LISTA"** (spec I-42; ticket T9; appsec C20–C23;
 * LGPD L-IN-13, L-IN-14).
 *
 *  - os pacientes saem SÓ da re-execução do relatório no servidor, com os
 *    filtros do pedido — o corpo `.strict()` recusa `pacienteIds` (C20);
 *  - tudo ou nada: acima de 2.000 pacientes, ou com o motor `truncado`, 422 e
 *    nada nasce (C22) — a consulta, a campanha, as tarefas e o registro de
 *    acesso estão na MESMA transação;
 *  - idempotente: `Idempotency-Key` na campanha nova (0106) e
 *    `tarefa_viva_da_campanha` nas tarefas (C21; H.2);
 *  - nada do relatório é copiado para a campanha, a tarefa ou o paciente: nem
 *    o procedimento do filtro (classe `saude`, L-IN-13), nem os filtros. A
 *    ORIGEM fica só no registro de acesso, com ids e contagens (L-IN-14).
 */
@Injectable()
export class CampanhaDaListaService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(MotorDeRelatorios) private readonly motor: MotorDeRelatorios,
    @Inject(CampanhasService) private readonly campanhas: CampanhasService,
  ) {}

  async criar(
    ctx: ContextoDoMotor,
    chaveCrua: string,
    idempotencia: string | undefined,
    corpo: unknown,
  ): Promise<CampanhaDaListaCriada> {
    // Quem não gere campanha não cria uma por aqui (C23) — antes de ler o corpo.
    if (!ctx.pode('campanhas.gerir')) throw new ForbiddenException('Criar campanha exige gerir campanhas.')
    const pedido = CriarCampanhaDaLista.safeParse(corpo)
    if (!pedido.success) throw new UnprocessableEntityException(primeiroErro(pedido.error))
    const chave = Uuid.safeParse(idempotencia)
    if (!chave.success) throw new UnprocessableEntityException('Envie o cabeçalho Idempotency-Key com um uuid.')
    const { filtros, destino, tarefa } = pedido.data
    const quem = atorEmColunas(ctx.ator)
    const doServico = { clinicaId: ctx.clinicaId, ator: ctx.ator, fuso: ctx.fuso, valores: ctx.pode('valores') }

    return this.motor.comALista(ctx, chaveCrua, filtros, async (c, lista) => {
      if (lista.truncado || lista.pacienteIds.length > MAX_PACIENTES_DA_CAMPANHA_DA_LISTA) {
        throw new UnprocessableEntityException(
          `A lista passa de ${MAX_PACIENTES_DA_CAMPANHA_DA_LISTA} pacientes. Estreite os filtros; nada foi criado.`,
        )
      }
      if (lista.pacienteIds.length === 0) throw new UnprocessableEntityException('A lista está vazia; nada foi criado.')

      const campanhaId =
        'nova' in destino
          ? (
              await this.campanhas.criarNaTransacao(c, doServico, destino.nova, doServico.valores, {
                chave: chave.data,
                // O pedido LIDO (filtros com os padrões aplicados), não o texto cru:
                // o mesmo pedido escrito em outra ordem é o mesmo pedido (appsec M1).
                hash: hashDoPedido({ relatorio: lista.chave, filtros: lista.filtros, destino, tarefa }),
              })
            ).id
          : destino.campanhaId
      const r = await this.campanhas.adicionarPacientesNaTransacao(c, doServico, campanhaId, lista.pacienteIds, tarefa)

      // O registro de acesso da re-execução, na MESMA transação (C14): ids,
      // enums e contagens — nunca nome, nunca texto livre (L-IN-8, L-IN-14).
      await c.query(
        `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id, para)
         VALUES ($1, $2, $3, 'acessou', 'relatorio', $4, $5::jsonb)`,
        [
          ctx.clinicaId,
          quem.tipo,
          quem.id,
          lista.chave,
          JSON.stringify({
            relatorio: lista.chave,
            filtros: lista.filtros,
            classe: lista.classe,
            linhas: lista.linhas,
            campanhaId,
            pacientes: r.pacientes,
            criadas: r.criadas,
          }),
        ],
      )
      return { campanhaId, ...r }
    })
  }
}

/**
 * JSON CANÔNICO: chaves em ordem, `bigint` como texto (a meta em centavos),
 * `undefined` fora. Duas escritas do mesmo pedido dão o mesmo texto.
 */
function canonico(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString()
  if (Array.isArray(v)) return v.map(canonico)
  if (typeof v === 'object' && v !== null) {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, canonico((v as Record<string, unknown>)[k])]),
    )
  }
  return v
}

/** sha-256, hex, do pedido canônico — o que a 0109 guarda ao lado da chave. */
export function hashDoPedido(pedido: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonico(pedido))).digest('hex')
}
