import type { GruposDaClinica } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'

type Linha = { grupo: string; desde: Date; motivo: string }

@Injectable()
export class ClinicaGruposService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  /**
   * Lê pela função SECURITY DEFINER `grupos_que_recebem_a_clinica()`: `fir_app`
   * não tem privilégio na tabela de participação, e a função filtra por
   * `app_clinica_id()` (a sessão), nunca por parâmetro. Ela já exclui grupo de
   * arquivo e grupo desativado.
   */
  async listar(clinicaId: ClinicaId, ator: Ator): Promise<GruposDaClinica> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const r = await c.query<Linha>('SELECT grupo, desde, motivo FROM grupos_que_recebem_a_clinica()')
      return {
        grupos: r.rows.map((l) => ({ grupo: l.grupo, desde: l.desde.toISOString(), motivo: l.motivo })),
      }
    })
  }
}
