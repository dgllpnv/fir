import { CriarTarefa, type TarefasAfetadas } from '@fir/contracts'
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common'
import type { RequisicaoComContexto } from '../comum/contexto'
import { TarefasService } from './tarefas.service'

/**
 * Tarefas — SEM `@Exige`.
 *
 * Hoje, Tarefas e Nova tarefa são de todos (`menu.ts`, `perm: null`): numa
 * clínica de quatro pessoas, exigir permissão para criar a própria tarefa
 * seria exigir permissão para trabalhar. O que é controlado por permissão é o
 * ALCANCE — `escopo=equipe`, cancelar o que outra pessoa pediu — e isso é
 * decidido por tarefa, em `packages/domain/src/tarefa.ts`, não por rota.
 *
 * `@Publico()` NÃO aparece aqui: o `SessaoGuard` global já protege, e é
 * justamente por ele ser global que esquecer um decorador significa rota
 * protegida.
 */
@Controller('v1/tarefas')
export class TarefasController {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(TarefasService) private readonly tarefas: TarefasService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Req() req: RequisicaoComContexto,
    @Body() corpo: unknown,
  ): Promise<TarefasAfetadas> {
    const dados = CriarTarefa.safeParse(corpo)
    if (!dados.success) throw new BadRequestException(primeiroErro(dados.error))
    // `!` seguro: `SessaoGuard` é global e esta rota não é `@Publico()`.
    const c = req.contexto!
    return this.tarefas.criar(c.clinicaId, c.ator, c.clinicaFuso, c.ator, dados.data)
  }
}

/**
 * A primeira mensagem do Zod, SEM o valor que a causou.
 *
 * `JSON.stringify(error)` traria o corpo inteiro para a resposta — e daí para
 * o log do cliente, do proxy e do navegador. Nome de paciente, descrição de
 * atendimento e valor não atravessam (regra 21).
 */
export const primeiroErro = (erro: { issues: readonly { message: string }[] }): string =>
  erro.issues[0]?.message ?? 'Confira os campos da tarefa.'
