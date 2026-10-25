import { BadRequestException, Controller, Get, Inject, Query, Req } from '@nestjs/common'
import { BuscaDePacientes, type TPacienteEncontrado } from '@fir/contracts'
import type { RequisicaoComContexto } from '../comum/contexto'
import { BancoService } from '../banco/banco.service'

/**
 * Busca estreita de paciente, para o seletor de "Nova tarefa" — **decisão D-7**.
 *
 * **Sem `@Exige`**: criar tarefa é de todos, e quem cria precisa poder vincular.
 * O `SessaoGuard` global continua valendo — isto não é rota pública, é rota
 * autenticada sem permissão adicional.
 *
 * **Caminho próprio, e não `/v1/pacientes/busca`, de propósito.** Aquele
 * controlador tem `@Exige('pacientes')` na classe e um `@Get(':id')`; pendurar
 * aqui dependeria de ordem de registro de rota para não ser capturado pelo
 * `:id` — e ordem de registro é o tipo de coisa que muda sozinha quando alguém
 * reorganiza um módulo, sem nenhum teste reclamar.
 *
 * **Sem `@DadoSensivel`**, pela mesma razão da listagem: uma busca que devolve
 * dezenas de nomes viraria dezenas de linhas de trilha, e o próximo acesso a
 * UMA ficha — que é a pergunta da LGPD — ficaria invisível no meio delas.
 */
@Controller('v1/busca-de-pacientes')
export class BuscaDePacientesController {
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  @Get()
  async buscar(
    @Req() req: RequisicaoComContexto,
    @Query() query: unknown,
  ): Promise<{ itens: TPacienteEncontrado[] }> {
    // `safeParse` e não `parse`: o `parse` lança `ZodError`, que o Nest não
    // sabe traduzir e devolve como **500**. Erro de digitação da usuária
    // virando erro interno é ruído no monitoramento e mentira para o cliente.
    const dados = BuscaDePacientes.safeParse(query)
    if (!dados.success) throw new BadRequestException('Digite ao menos duas letras.')
    const { termo } = dados.data
    const ctx = req.contexto!

    const itens = await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      // Três colunas nomeadas, nunca `SELECT *`: é o que impede um campo novo
      // em `pacientes` de vazar por esta rota sem ninguém decidir isso.
      const r = await c.query<TPacienteEncontrado>(
        `SELECT id, nome, telefone
           FROM pacientes
          WHERE ativo
            AND (nome_chave LIKE '%' || normalizar_nome($1) || '%'
                 -- telefone_chave guarda só dígitos, então quem digita com
                 -- máscara encontra o mesmo número gravado sem ela. Sem isto,
                 -- a busca por telefone só acha quem digitou exatamente igual.
                 OR (nullif(regexp_replace($1, '\D', '', 'g'), '') IS NOT NULL
                     AND telefone_chave LIKE '%' || regexp_replace($1, '\D', '', 'g') || '%'))
          ORDER BY nome
          LIMIT 20`,
        [termo],
      )
      return r.rows
    })

    return { itens }
  }
}
