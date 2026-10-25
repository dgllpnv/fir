import type { ClinicaAtual, ListaDaEquipe, ListaDeUnidades } from '@fir/contracts'
import { diaCivil } from '@fir/domain'
import { Controller, Get, Inject, Req } from '@nestjs/common'
import type { RequisicaoComContexto } from '../comum/contexto'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { BancoService } from '../banco/banco.service'

/**
 * A clínica aberta e as duas listas de apoio das telas de rotina: a equipe e
 * as unidades.
 *
 * Sem `@Exige`, e isso é deliberado: escolher o responsável de uma tarefa é
 * parte de criar uma tarefa, que é de todos (`menu.ts`, `perm: null`). Exigir
 * permissão aqui exigiria permissão para trabalhar.
 *
 * O que sai é MAGRO de propósito — nome, função, estado. E-mail, perfil e
 * qualquer dado de RH são da tela de Usuários (épico 1) e do épico 7, com
 * permissão própria. A RLS faz o filtro por clínica.
 */
@Controller('v1')
export class ClinicaController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * A clínica aberta, com o DIA DE NEGÓCIO dela já resolvido.
   *
   * Sem ida ao banco: o `SessaoGuard` já leu a clínica inteira para montar o
   * contexto, e `hoje` é o relógio do SERVIDOR no fuso dela (regra 24). Quem
   * precisa disto é "Nova tarefa", que nasce com a data preenchida antes de
   * carregar lista nenhuma.
   */
  @Get('clinica')
  async clinica(@Req() req: RequisicaoComContexto): Promise<ClinicaAtual> {
    const c = req.contexto!
    return {
      id: c.clinicaId,
      codigo: c.clinicaCodigo,
      nome: c.clinicaNome,
      fuso: c.clinicaFuso,
      hoje: diaCivil(this.relogio.agora(), c.clinicaFuso),
    }
  }

  @Get('equipe')
  async equipe(@Req() req: RequisicaoComContexto): Promise<ListaDaEquipe> {
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.banco.naClinica(c.clinicaId, c.ator, async (cx) => {
      const r = await cx.query<{ id: string; nome: string; funcao: string; ativo: boolean }>(
        // Ativas primeiro: a lista de responsável oferece quem está na
        // clínica, e quem saiu só aparece quando alguém procura de propósito.
        'SELECT id, nome, funcao, ativo FROM pessoas ORDER BY ativo DESC, nome',
      )
      return { equipe: r.rows }
    })
  }

  @Get('unidades')
  async unidades(@Req() req: RequisicaoComContexto): Promise<ListaDeUnidades> {
    const c = req.contexto!
    return this.banco.naClinica(c.clinicaId, c.ator, async (cx) => {
      const r = await cx.query<{ id: string; nome: string; endereco: string; ativa: boolean }>(
        'SELECT id, nome, endereco, ativa FROM unidades ORDER BY ativa DESC, nome',
      )
      return { unidades: r.rows }
    })
  }
}
