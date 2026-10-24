import { Inject, Injectable } from '@nestjs/common'
import { type Ator, atorEmColunas } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import type { EntidadeSensivel } from './acesso.decorator'

@Injectable()
export class AuditoriaService {
  // `@Inject` explícito: ver o comentário em autenticacao.service.ts.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  /**
   * Grava o ACESSO — regra 18. A escrita é da trigger; isto é a metade que
   * trigger nenhuma vê.
   *
   * `de` e `para` ficam NULOS de propósito, e isto é minimização, não
   * economia. Copiar o corpo entregue para dentro da trilha duplicaria dose,
   * lote e salário numa tabela append-only de onde nada sai — a trilha
   * passaria a ser a maior concentração de dado sensível do banco, criada
   * pelo mecanismo que existe para protegê-lo. O que a LGPD pergunta é "quem
   * olhou o prontuário da minha paciente", e isso se responde com quem,
   * quando e qual ficha.
   *
   * Escrita em `auditoria` dentro de `naClinica`: a RLS da tabela tem
   * `WITH CHECK (clinica_id = app_clinica_id())`, então a linha nasce
   * amarrada à clínica da sessão e não ao que alguém passou por parâmetro.
   */
  async registrarAcesso(
    clinicaId: ClinicaId,
    ator: Ator,
    entidade: EntidadeSensivel,
    entidadeId: string,
  ): Promise<void> {
    const quem = atorEmColunas(ator)
    await this.banco.naClinica(clinicaId, ator, async (c) => {
      await c.query(
        `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id)
         VALUES ($1, $2, $3, 'acessou', $4, $5)`,
        [clinicaId, quem.tipo, quem.id, entidade, entidadeId],
      )
    })
  }
}
