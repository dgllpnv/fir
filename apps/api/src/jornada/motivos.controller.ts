import type { ListaDeMotivos } from '@fir/contracts'
import { Controller, Get, Inject, Injectable, Req } from '@nestjs/common'
import { Exige } from '../autorizacao/autorizacao.guard'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import type { Ator } from '../banco/ator'
import type { RequisicaoComContexto } from '../comum/contexto'

/**
 * A lista de motivos de perda da clínica.
 *
 * Existe porque a tela de perda precisa montar a lista suspensa, e ela NÃO
 * pode vir de uma constante no front: o motivo é dado da clínica (decisão
 * D-1), e `MOTIVOS_PERDA` copiado para o navegador seria a quarta cópia da
 * mesma lista — depois do protótipo, do banco e da migration.
 *
 * Só o `GET`. `PATCH`/`POST` para a clínica editar os motivos ficam em
 * `Configurações › Motivos de perda`, que não é deste épico: os cinco
 * semeados bastam, e a dívida está registrada.
 */
@Injectable()
export class MotivosService {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  async listar(clinicaId: ClinicaId, ator: Ator): Promise<ListaDeMotivos> {
    return this.banco.naClinica(clinicaId, ator, async (c) => {
      // A RLS filtra por clínica; `ativo` tira o que foi desativado. O índice
      // `motivos_da_clinica` é parcial sobre `ativo` e cobre esta ordem.
      const r = await c.query<{ id: string; nome: string }>(
        'SELECT id, nome FROM motivos_de_perda WHERE ativo ORDER BY ordem, nome',
      )
      return { itens: r.rows }
    })
  }
}

@Controller('v1/motivos-de-perda')
@Exige('jornada')
export class MotivosController {
  constructor(@Inject(MotivosService) private readonly motivos: MotivosService) {}

  @Get()
  async listar(@Req() req: RequisicaoComContexto): Promise<ListaDeMotivos> {
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.motivos.listar(c.clinicaId, c.ator)
  }
}
