import type { CampanhaSugerida } from '@fir/contracts'
import { type Relogio, sugestaoDeCampanha } from '@fir/domain'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { type Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { lerCampanhasDeVinculo } from '../campanhas/vinculo'
import { RELOGIO } from '../comum/relogio'

/**
 * A SUGESTÃO DE CAMPANHA da Nova tarefa e do Recebimento (L-A3-8 a L-A3-10).
 *
 * Lê a campanha de ORIGEM da paciente (`pacientes.campanha_id`), que até aqui
 * só saía na ficha, sob trilha. Por isso a rota é `/v1/pacientes/:id/...` com
 * `@DadoSensivel('pacientes')`: o id da trilha é o da paciente.
 *
 * **Só paciente ativa (L-A3-10).** Inexistente, de outra clínica (a RLS a
 * esconde, e o filtro `clinica_id` é a segunda camada) e desativada caem no
 * MESMO 404 — e resposta de erro não grava acesso. Anonimizar ainda não é um
 * estado próprio da tabela (o procedimento de `retencao.md` §3 está pendente);
 * quando for, ele tem de entrar neste `WHERE`, ou desativar junto.
 */
@Injectable()
export class CampanhaSugeridaService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async sugerir(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    pacienteId: string,
  ): Promise<CampanhaSugerida> {
    const agora = this.relogio.agora()
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const origem = await c.query<{ campanha_id: string | null }>(
        `SELECT campanha_id::text AS campanha_id FROM pacientes
          WHERE id = $1 AND clinica_id = $2 AND ativo`,
        [pacienteId, clinicaId],
      )
      const paciente = origem.rows[0]
      if (paciente === undefined) throw new NotFoundException('Paciente não encontrado.')

      const tarefas = await c.query<{ campanhaId: string; criadaEm: string }>(
        `SELECT campanha_id::text AS "campanhaId",
                to_char(criada_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "criadaEm"
           FROM tarefas
          WHERE paciente_id = $1 AND clinica_id = $2
            AND campanha_id IS NOT NULL AND excluida_em IS NULL`,
        [pacienteId, clinicaId],
      )
      const campanhas = await lerCampanhasDeVinculo(c, clinicaId)
      // Objeto literal com as duas chaves, e não o retorno do domínio
      // espalhado: a resposta é exatamente L-A3-9, mesmo que o domínio cresça.
      const s = sugestaoDeCampanha(paciente.campanha_id, tarefas.rows, campanhas, agora, fuso)
      return { sugerida: s.sugerida, motivo: s.motivo }
    })
  }
}
