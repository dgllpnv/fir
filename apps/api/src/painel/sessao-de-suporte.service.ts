import type { SessaoDeSuporteCriada } from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import { DURACAO_SESSAO_DE_SUPORTE_MS, novoToken } from '../autenticacao/sessao'
import type { OperadorId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaResolvida } from './painel-clinicas.service'
import { registrarNoPainel } from './painel.service'

/**
 * A SESSÃO DE SUPORTE — decisão **D-13**.
 *
 * O operador clica na clínica no painel e já está dentro do sistema dela,
 * logado, com privilégio de administradora. A linha é uma `sessoes` comum, na
 * clínica dela, com `operador_id` no lugar de `pessoa_id`.
 *
 * ## O que este serviço NÃO faz, e é a decisão inteira
 *
 * Ele **não cria pessoa nenhuma**. Nenhum `INSERT INTO pessoas`, nenhum
 * "usuário de suporte", nenhum booleano. O operador não é uma `Pessoa` da
 * clínica (D-5, restrição 1) e por isso não aparece em lista de equipe, em
 * seletor de responsável, em contagem de pessoas, em meta nem em banco de
 * horas — não por um `if` em cada uma dessas telas, mas porque a linha não
 * existe.
 *
 * ## A trilha nasce sozinha, e é a da clínica
 *
 * `comoPainel` fixa `app.pessoa_id = operador:<uuid>`, e a trigger
 * `registrar_auditoria` grava `ator_tipo = 'operador'` na `auditoria` **da
 * clínica** para o `INSERT` em `sessoes`. Nada aqui chama `registrar()` à
 * mão: *o acesso é total; o registro é obrigatório*, e o registro é mecânico.
 *
 * A linha de `auditoria_do_painel` é a OUTRA metade da regra de repartição da
 * D-10: "o operador abriu o sistema da clínica X" é um fato sobre o operador,
 * e fica na trilha do painel também — é por ela que se pergunta "em quantas
 * clínicas ele entrou hoje" sem varrer quatro trilhas.
 */
@Injectable()
export class SessaoDeSuporteService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(@Inject(BancoService) private readonly banco: BancoService) {}

  /**
   * Abre a sessão de suporte e devolve o token do cookie do PRODUTO.
   *
   * `clinica` é `ClinicaResolvida` e não um `string`: ela já passou pelo
   * banco e já foi conferida como ativa (`PainelClinicasService.clinicaPorId`).
   * Um uuid vindo da URL não pode virar `SET LOCAL app.clinica_id`.
   */
  async abrir(
    clinica: ClinicaResolvida,
    ator: OperadorId,
  ): Promise<{ token: string; saida: SessaoDeSuporteCriada }> {
    const { token, hash } = novoToken()

    const expiraEm = await this.banco.comoPainel(clinica.id, ator, async (c) => {
      /**
       * UMA SESSÃO POR CLIQUE, e a anterior na mesma clínica cai.
       *
       * Sem isto, cada clique deixaria mais uma sessão de trinta minutos
       * viva, e o operador que abre a clínica cinco vezes num atendimento
       * acumularia cinco credenciais — quatro delas em abas que ele fechou e
       * não tem como revogar. A revogação é por (operador, clínica): a sessão
       * dele em OUTRA clínica não é tocada, porque trabalhar em duas ao mesmo
       * tempo é legítimo.
       *
       * A RLS já restringe a esta clínica; o `clinica_id` explícito é a
       * segunda camada da regra 19 — a primeira falha em silêncio.
       */
      await c.query(
        `UPDATE sessoes SET revogada_em = now()
          WHERE clinica_id = $1 AND operador_id = $2 AND revogada_em IS NULL`,
        [clinica.id, ator.id],
      )

      const r = await c.query<{ expira_em: Date }>(
        `INSERT INTO sessoes (clinica_id, operador_id, token_hash, expira_em)
         VALUES ($1, $2, $3, now() + ($4 || ' milliseconds')::interval)
         RETURNING expira_em`,
        [clinica.id, ator.id, hash, String(DURACAO_SESSAO_DE_SUPORTE_MS)],
      )

      // "O operador entrou no sistema da clínica X" é um fato SOBRE o
      // operador: vai para a trilha do painel, ao lado de "ele entrou no
      // painel". O que ele FIZER lá dentro vai para a trilha da clínica, pela
      // trigger — nenhuma das duas substitui a outra.
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'entrou',
        entidade: 'clinicas',
        entidadeId: clinica.id,
        para: { clinica: clinica.codigo, sessao: 'de suporte' },
      })

      return r.rows[0]!.expira_em
    })

    return {
      token,
      saida: {
        clinica: {
          id: clinica.id,
          codigo: clinica.codigo,
          nome: clinica.nome,
          fuso: clinica.fuso,
          // `clinicaPorId` recusa a clínica desativada antes de chegar aqui,
          // então `true` é um fato, não um padrão.
          ativa: true,
        },
        expiraEm: expiraEm.toISOString(),
      },
    }
  }
}
