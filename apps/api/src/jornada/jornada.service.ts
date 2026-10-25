import type { MoverEtapa, TarefasAfetadas } from '@fir/contracts'
import {
  diaCivil,
  ehErro,
  type Etapa,
  type EventoDeJornada,
  type Relogio,
  type StatusDeTarefa,
  transicao,
} from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { ConclusaoService } from '../tarefas/conclusao.service'
import { type AutorDaRequisicao, brAno, lerTarefas } from '../tarefas/leitura'

/**
 * A rota única de transição da jornada.
 *
 * **Uma rota, não dez.** O corpo discrimina a ação, e o SERVIDOR decide o
 * destino — pela tabela de `packages/domain/src/jornada.ts`, que é a única
 * verdade sobre o que é permitido. Nenhum `if (acao === … && etapa === …)`
 * aparece neste arquivo: ele traduz a ação em EFEITOS (quais colunas mudam,
 * que nota vai para o histórico), nunca em PERMISSÃO.
 *
 * A ordem do serviço não é negociável:
 *
 *   1. `SELECT … FOR UPDATE`   (dentro de `naClinica` — a RLS filtra)
 *   2. `etapa IS NULL` → 404   ("esta tarefa não é um agendamento")
 *   3. `transicao(estado, acao)` → 409 quando a tabela recusa
 *   4. validações DA AÇÃO      (prazo >= hoje DO SERVIDOR)
 *   5. `UPDATE … historico = historico || $evento`
 *   6. devolve a tarefa
 *
 * O `FOR UPDATE` não é zelo: duas recepcionistas tocando "Confirmou" e
 * "No-show" no mesmo cartão ao mesmo tempo, sem ele, produzem duas leituras do
 * mesmo estado e dois `UPDATE` que se sobrescrevem — e o histórico perde um
 * evento. A trilha (regra 20) é prova, e prova com buraco não é prova.
 */

/** O que a transição precisa saber da tarefa. Nada de dinheiro aqui. */
type CartaoCarregado = {
  readonly etapa: Etapa
  readonly status: StatusDeTarefa
  readonly prazo: string
  readonly hora: string | null
  readonly historico: EventoDeJornada[]
}

/**
 * Os efeitos de uma ação: as colunas que ela toca, e a nota do evento.
 *
 * Separado da PERMISSÃO de propósito. Quem decide se a ação é possível é
 * `transicao()`; aqui só se descreve o que acontece depois do sim.
 */
type Efeitos = {
  /** `undefined` = não mexe na coluna. `null` = grava NULL. */
  readonly prazo?: string
  readonly hora?: string | null
  readonly proximoPassoEm?: string | null
  readonly confirmacaoEnviadaEm?: Date | null
  readonly nota?: string
}

@Injectable()
export class JornadaService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(ConclusaoService) private readonly conclusao: ConclusaoService,
  ) {}

  async mover(
    clinicaId: ClinicaId,
    ator: Ator,
    fuso: string,
    autor: AutorDaRequisicao,
    id: string,
    dados: MoverEtapa,
  ): Promise<TarefasAfetadas> {
    /**
     * `reabrir` DELEGA para a rota do épico 2 — uma implementação, duas portas.
     *
     * Reabrir estorna o recebimento embutido, e essa lógica já existe em
     * `ConclusaoService.reabrir`. Reescrevê-la aqui seria a segunda cópia da
     * regra que mexe em dinheiro, e a segunda cópia é a que esquece o estorno.
     *
     * Efeito colateral desejado: por esta porta, reabrir exige `jornada`
     * (decorador da rota) **e** a autorização de editar a tarefa, que é a de
     * lá. Mais estrito, nunca menos.
     */
    if (dados.acao === 'reabrir') {
      return this.conclusao.reabrir(clinicaId, ator, fuso, autor, id)
    }

    const agora = this.relogio.agora()
    const hoje = diaCivil(agora, fuso)

    return this.banco.naClinica(clinicaId, ator, async (c) => {
      const t = await carregar(c, id)

      const destino = transicao({ etapa: t.etapa, status: t.status, historico: t.historico }, dados.acao)
      if (ehErro(destino)) throw new ConflictException(destino.erro.mensagem)

      const efeitos = efeitosDa(dados, t, hoje, agora)
      const evento: EventoDeJornada = {
        acao: dados.acao,
        etapa: destino.valor.etapa,
        em: agora.toISOString(),
        porId: autor.id,
        ...(efeitos.nota === undefined || efeitos.nota === '' ? {} : { nota: efeitos.nota }),
      }

      await c.query(
        `UPDATE tarefas
            SET etapa  = $2::etapa_de_jornada,
                status = $3,
                -- O HISTÓRICO CRESCE NO BANCO, não em JavaScript. Ler o array,
                -- dar push e gravar de volta é ler-depois-escrever: perde a
                -- corrida que o FOR UPDATE existe para não perder, e torna o
                -- próprio FOR UPDATE decorativo.
                historico = historico || $4::jsonb,
                prazo = coalesce($5::date, prazo),
                hora = CASE WHEN $6 THEN $7::time ELSE hora END,
                proximo_passo_em = CASE WHEN $8 THEN $9::date ELSE proximo_passo_em END,
                confirmacao_enviada_em =
                  CASE WHEN $10 THEN $11::timestamptz ELSE confirmacao_enviada_em END
          WHERE id = $1 AND excluida_em IS NULL`,
        [
          id,
          destino.valor.etapa,
          destino.valor.status,
          JSON.stringify([evento]),
          efeitos.prazo ?? null,
          'hora' in efeitos,
          efeitos.hora ?? null,
          'proximoPassoEm' in efeitos,
          efeitos.proximoPassoEm ?? null,
          'confirmacaoEnviadaEm' in efeitos,
          efeitos.confirmacaoEnviadaEm ?? null,
        ],
      )

      const todas = await lerTarefas(c, clinicaId, hoje, [id])
      const tarefa = todas[0]
      if (tarefa === undefined) throw new NotFoundException('Agendamento não encontrado.')
      return { tarefa, todas }
    })
  }
}

/**
 * Carrega o cartão com `FOR UPDATE`.
 *
 * `etapa IS NULL` é **404, não 409**. 409 diria "a tarefa existe e a ação está
 * errada"; a verdade é que ela não é um agendamento — é uma tarefa interna, ou
 * um Follow-up. A RLS já filtra por clínica, então o cartão da vizinha devolve
 * zero linhas, e zero é a mesma resposta de "não existe".
 */
async function carregar(c: pg.PoolClient, id: string): Promise<CartaoCarregado> {
  const r = await c.query<{
    etapa: Etapa | null
    status: StatusDeTarefa
    prazo: string
    hora: string | null
    historico: EventoDeJornada[]
  }>(
    `SELECT etapa::text AS etapa, status, prazo::text AS prazo, hora::text AS hora, historico
       FROM tarefas WHERE id = $1 AND excluida_em IS NULL FOR UPDATE`,
    [id],
  )
  const l = r.rows[0]
  if (l === undefined || l.etapa === null) {
    throw new NotFoundException('Agendamento não encontrado.')
  }
  return { etapa: l.etapa, status: l.status, prazo: l.prazo, hora: l.hora, historico: l.historico }
}

/**
 * A ação → os efeitos. EXAUSTIVO sobre a união: uma ação nova sem efeito
 * declarado não compila, em vez de cair num `default` silencioso que grava a
 * etapa e esquece a coluna.
 *
 * `reabrir` fica FORA do tipo porque ele sai antes, delegado ao épico 2 — e
 * excluí-lo aqui é o que mantém a exaustividade honesta: com ele dentro, a
 * função precisaria de um ramo morto, e um ramo morto é onde a próxima ação
 * esquecida vai se esconder.
 */
function efeitosDa(
  dados: Exclude<MoverEtapa, { acao: 'reabrir' }>,
  t: CartaoCarregado,
  hoje: string,
  agora: Date,
): Efeitos {
  switch (dados.acao) {
    case 'enviarConfirmacao':
      // O épico 10 manda a mensagem. Aqui fica o registro de que foi mandada,
      // e a etapa NÃO muda: a paciente ainda não respondeu.
      return { confirmacaoEnviadaEm: agora, nota: 'mensagem pelo WhatsApp' }

    case 'confirmar':
      return {}

    case 'noshow':
      // `proximo_passo_em = hoje` é o que faz o cartão aparecer em Recontatar
      // a partir de agora. A nota usa o PRAZO, que é uma coluna `date` — um
      // dia no calendário da clínica, sem fuso a converter.
      return { proximoPassoEm: hoje, nota: `não compareceu em ${brAno(t.prazo)}` }

    case 'desmarcar':
      return { proximoPassoEm: hoje, ...(dados.nota === undefined ? {} : { nota: dados.nota }) }

    case 'reagendar': {
      // "A partir de hoje" é contra o dia civil DO SERVIDOR no fuso da clínica
      // (regra 24) — nunca contra o relógio do cliente. Comparação
      // lexicográfica: para `aaaa-mm-dd` é a mesma ordem da cronológica.
      if (dados.prazo < hoje) {
        throw new BadRequestException('Escolha uma data a partir de hoje.')
      }
      const quando = `${brAno(dados.prazo)}${dados.hora === undefined ? '' : ` ${dados.hora}`}`
      return {
        prazo: dados.prazo,
        // A hora é SUBSTITUÍDA, inclusive por nada: remarcar sem informar
        // horário não deve herdar o horário da consulta que não aconteceu.
        hora: dados.hora ?? null,
        proximoPassoEm: null,
        confirmacaoEnviadaEm: null,
        nota: `de ${brAno(t.prazo)} para ${quando}`,
      }
    }

    case 'encerrar':
      return { proximoPassoEm: null, ...(dados.nota === undefined ? {} : { nota: dados.nota }) }

    case 'registrarOrcamento':
    case 'followUp':
    case 'perder':
    case 'fechar':
      // Tasks 5, 6 e 7 deste épico. Enquanto não existirem, 501 — e NÃO um
      // 200 que grava a etapa sem gravar o valor, que é a forma de um
      // orçamento virar um cartão "orçado" de R$ 0,00.
      throw new NotImplementedException(MENSAGEM_ACAO_SEM_IMPLEMENTACAO)
  }
}

export const MENSAGEM_ACAO_SEM_IMPLEMENTACAO =
  'Esta ação ainda não está disponível. Registre pela tela Recebimentos.'
