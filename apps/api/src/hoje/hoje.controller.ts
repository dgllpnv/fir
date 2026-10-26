import { ConsultaDeHoje, type HojeComProgramas } from '@fir/contracts'
import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import type { RequisicaoComContexto } from '../comum/contexto'
import { HojeFinanceiroService } from '../financeiro/hoje-financeiro.service'
import { LeituraDeProgramasService } from '../programas/leitura.service'
import { ConsultaDeTarefasService } from '../tarefas/consulta.service'
import { autorDe, exigirEscopo } from '../tarefas/leitura'

/**
 * `GET /v1/hoje` — a tela que a clínica deixa aberta o dia inteiro.
 *
 * Controlador próprio, serviço compartilhado com `GET /v1/tarefas`: as duas
 * telas leem a mesma coisa com recortes diferentes, e a janela de período
 * precisa ser a mesma escrita nas duas.
 *
 * Sem `@Exige`: Hoje é de todos (`menu.ts`, `perm: null`). O que é controlado
 * por permissão é o ESCOPO — `equipe` exige `tarefas.equipe`.
 */
@Controller('v1/hoje')
export class HojeController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(ConsultaDeTarefasService) private readonly consulta: ConsultaDeTarefasService,
    @Inject(HojeFinanceiroService) private readonly financeiro: HojeFinanceiroService,
    @Inject(LeituraDeProgramasService) private readonly programas: LeituraDeProgramasService,
  ) {}

  @Get()
  async abrir(
    @Req() req: RequisicaoComContexto,
    @Query() consulta: unknown,
  ): Promise<HojeComProgramas> {
    const dados = ConsultaDeHoje.safeParse(consulta)
    if (!dados.success) throw new BadRequestException('Confira os filtros da tela.')
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    exigirEscopo(c, dados.data.escopo)
    // As TRÊS em paralelo: são leituras independentes, e a tela Hoje é a que a
    // recepção recarrega o dia inteiro.
    const [tarefas, financeiro, sessoes] = await Promise.all([
      this.consulta.hoje(c.clinicaId, c.ator, c.clinicaFuso, autorDe(c), dados.data),
      this.financeiro.bloco({
        clinicaId: c.clinicaId,
        ator: c.ator,
        fuso: c.clinicaFuso,
        // As quatro decisões de permissão saem de `temPerm`, a mesma função da
        // tela. Nenhum `if` as reimplementa aqui.
        podeCaixa: c.pode('caixa'),
        podeContas: c.pode('contas'),
        podeGerirContas: c.pode('contas.gerir'),
        podeFinmes: c.pode('finmes'),
      }),
      /**
       * AS SESSÕES DE PROGRAMAS, em bloco próprio.
       *
       * O escopo é o da tela: `equipe` traz todas, `meu` e `solicitei` traz as
       * de quem está olhando. Resolvido AQUI, com o id da SESSÃO — nunca com um
       * id do cliente (é a mesma razão do `'eu'` em `GET /v1/programas`).
       *
       * Vazio sem a permissão `programas`, e "validar" é não compor a seção.
       */
      this.programas.sessoesDeHoje(
        { clinicaId: c.clinicaId, ator: c.ator, fuso: c.clinicaFuso },
        {
          podePrograma: c.pode('programas'),
          responsavelId: dados.data.escopo === 'equipe' ? null : c.ator,
        },
      ),
    ])
    return { ...tarefas, financeiro, sessoes: [...sessoes] }
  }
}

