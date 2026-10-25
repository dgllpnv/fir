import type { MoverEtapa, TarefasAfetadas } from '@fir/contracts'
import {
  diaCivil,
  ehErro,
  type Etapa,
  type EventoDeJornada,
  type Relogio,
  somarDias,
  type StatusDeTarefa,
  transicao,
} from '@fir/domain'
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type pg from 'pg'
import type { Ator } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { RELOGIO } from '../comum/relogio'
import { ConclusaoService } from '../tarefas/conclusao.service'
import { type AutorDaRequisicao, brAno, lerTarefas } from '../tarefas/leitura'
import {
  type CartaoCarregado,
  carregarCartao,
  centavosNoJsonb,
  type ChaveDeColuna,
  COLUNA_DE_EFEITO,
  type Efeitos,
  type ItemOrcado,
  paraParametro,
  programaParaJsonb,
} from './cartao'
import { FechamentoService } from './fechamento.service'

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

@Injectable()
export class JornadaService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(ConclusaoService) private readonly conclusao: ConclusaoService,
    @Inject(FechamentoService) private readonly fechamento: FechamentoService,
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
      const t = await carregarCartao(c, id)

      const destino = transicao({ etapa: t.etapa, status: t.status, historico: t.historico }, dados.acao)
      if (ehErro(destino)) throw new ConflictException(destino.erro.mensagem)

      // A PROPOSTA É CONFERIDA DENTRO DA TRANSAÇÃO, com a RLS ativa.
      //
      // `programa_orcado` é `jsonb`: nenhuma chave estrangeira o protege. Sem
      // esta conferência, o id de uma pessoa da clínica VIZINHA atravessa e o
      // épico 5 monta doze sessões atribuídas a alguém que não existe aqui —
      // exatamente o furo que a unidade de outra clínica abriu no épico 2
      // (commit d0d4bb0), onde a FK existia e ainda assim atravessou a RLS.
      if (dados.acao === 'registrarOrcamento' && dados.programa !== undefined) {
        await conferirResponsaveis(c, dados.programa)
      }

      /**
       * O MOTIVO DA PERDA É RESOLVIDO AQUI, dentro da mesma transação e com a
       * RLS ativa.
       *
       * `SELECT nome … WHERE id = $1 AND ativo`: a RLS filtra por clínica, e
       * zero linhas significa as três coisas que a recepção não precisa
       * distinguir — não existe, é de outra clínica, está desativado. A
       * mensagem é a mesma nos três, e é a certa: *"Escolha um motivo da
       * lista."*
       *
       * Nada de `IN` montado com o id vindo do corpo. E o NOME gravado é o
       * que a lista dizia NESTE instante (decisão D-2): renomear "Preço" para
       * "Preço acima do esperado" não pode reescrever o relatório do trimestre
       * passado.
       */
      const motivo =
        dados.acao === 'perder' ? await resolverMotivo(c, dados.motivoId) : undefined

      /**
       * `fechar` sai pela PORTA PRÓPRIA, e não pelo `switch` de efeitos.
       *
       * As outras doze ações são puras — a ação vira colunas, e nada mais
       * acontece. O fechamento escreve DINHEIRO e monta PROGRAMA, as duas
       * coisas dentro desta mesma transação. Enfiá-lo no `switch` obrigaria
       * `efeitosDa` a receber o cliente do banco, e aí toda ação teria acesso
       * a ele — que é como a décima terceira passa a escrever por conta
       * própria em vez de declarar o efeito.
       */
      const efeitos =
        dados.acao === 'fechar'
          ? await this.fechamento.fechar(c, {
              clinicaId,
              tarefaId: id,
              cartao: t,
              dados,
              autor,
              agora,
            })
          : efeitosDa(dados, t, hoje, agora, motivo)
      const evento: EventoDeJornada = {
        acao: dados.acao,
        etapa: destino.valor.etapa,
        em: agora.toISOString(),
        porId: autor.id,
        ...(efeitos.nota === undefined || efeitos.nota === '' ? {} : { nota: efeitos.nota }),
        ...(efeitos.valor === undefined ? {} : { valor: efeitos.valor }),
        ...(efeitos.motivoId === undefined ? {} : { motivoId: efeitos.motivoId }),
        ...(efeitos.motivo === undefined ? {} : { motivo: efeitos.motivo }),
      }

      // O HISTÓRICO CRESCE NO BANCO, não em JavaScript. Ler o array, dar push
      // e gravar de volta é ler-depois-escrever: perde a corrida que o
      // `FOR UPDATE` existe para não perder, e torna o próprio `FOR UPDATE`
      // decorativo. `||` concatena no servidor do banco.
      const atribuicoes = [
        'etapa = $2::etapa_de_jornada',
        'status = $3',
        'historico = historico || $4::jsonb',
      ]
      const params: unknown[] = [
        id,
        destino.valor.etapa,
        destino.valor.status,
        JSON.stringify([evento]),
      ]
      for (const chave of Object.keys(COLUNA_DE_EFEITO) as ChaveDeColuna[]) {
        if (!(chave in efeitos)) continue
        const [coluna, tipo] = COLUNA_DE_EFEITO[chave]
        params.push(paraParametro(efeitos[chave]))
        atribuicoes.push(`${coluna} = $${params.length}::${tipo}`)
      }

      await c.query(
        `UPDATE tarefas SET ${atribuicoes.join(', ')}
          WHERE id = $1 AND excluida_em IS NULL`,
        params,
      )

      const todas = await lerTarefas(c, clinicaId, hoje, [id])
      const tarefa = todas[0]
      if (tarefa === undefined) throw new NotFoundException('Agendamento não encontrado.')
      return { tarefa, todas }
    })
  }
}

/** O motivo de perda, resolvido pela lista DA CLÍNICA — ou 400. */
async function resolverMotivo(
  c: pg.PoolClient,
  motivoId: string,
): Promise<{ readonly id: string; readonly nome: string }> {
  const r = await c.query<{ nome: string }>(
    'SELECT nome FROM motivos_de_perda WHERE id = $1 AND ativo',
    [motivoId],
  )
  const linha = r.rows[0]
  if (linha === undefined) throw new BadRequestException('Escolha um motivo da lista.')
  return { id: motivoId, nome: linha.nome }
}

/**
 * Os responsáveis da proposta existem NESTA clínica e estão ATIVOS?
 *
 * Recusa em vez de descartar em silêncio — ao contrário de `unidadeValida`,
 * que é um campo opcional de conveniência. Aqui o responsável é quem vai
 * executar doze aplicações: perder o vínculo em silêncio põe as sessões na
 * agenda de ninguém, e a descoberta é na recepção, com a paciente na sala.
 */
async function conferirResponsaveis(
  c: pg.PoolClient,
  programa: readonly ItemOrcado[],
): Promise<void> {
  const pedidos = [
    ...new Set(
      programa
        .map((i) => i.responsavelId)
        .filter((x): x is string => x !== null && x !== undefined),
    ),
  ]
  if (pedidos.length === 0) return
  // A RLS filtra por clínica: a pessoa da vizinha devolve zero linhas.
  const r = await c.query<{ id: string }>(
    'SELECT id FROM pessoas WHERE id = ANY($1) AND ativo',
    [pedidos],
  )
  if (r.rowCount !== pedidos.length) {
    throw new BadRequestException('Escolha um responsável ativo para cada item do programa.')
  }
}

/**
 * A ação → os efeitos. EXAUSTIVO sobre a união: uma ação nova sem efeito
 * declarado não compila, em vez de cair num `default` silencioso que grava a
 * etapa e esquece a coluna.
 *
 * `reabrir` e `fechar` ficam FORA do tipo porque saem antes, cada um pela sua
 * porta — o primeiro delegado ao épico 2, o segundo ao `FechamentoService`,
 * que escreve dinheiro. Excluí-los aqui é o que mantém a exaustividade
 * honesta: com eles dentro, a função precisaria de dois ramos mortos, e um
 * ramo morto é onde a próxima ação esquecida vai se esconder.
 */
function efeitosDa(
  dados: Exclude<MoverEtapa, { acao: 'reabrir' | 'fechar' }>,
  t: CartaoCarregado,
  hoje: string,
  agora: Date,
  motivo: { readonly id: string; readonly nome: string } | undefined,
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
      return {
        valorOrcamento: dados.valor,
        // A proposta inteira, para o épico 5 consumir no fechamento. Nada se
        // perde enquanto o módulo Programas não existir.
        ...(dados.programa === undefined
          ? {}
          : { programaOrcado: programaParaJsonb(dados.programa) }),
        // `hoje + 2` CALCULADO AQUI, no fuso da clínica. O protótipo calcula na
        // tela e manda a data; com o relógio do cliente adiantado, o orçamento
        // voltaria a pedir ação no dia errado (regra 24).
        proximoPassoEm: dados.retomarEm ?? somarDias(hoje, DIAS_PARA_RETOMAR),
        valor: centavosNoJsonb(dados.valor),
        ...(dados.nota === undefined ? {} : { nota: dados.nota }),
      }

    case 'followUp':
      // NÃO toca em `valor_orcamento`: é ele que mede o tamanho do negócio no
      // funil, e zerá-lo num follow-up apagaria a proposta sem apagar o cartão.
      return {
        proximoPassoEm: dados.retomarEm ?? somarDias(hoje, DIAS_PARA_FOLLOW_UP),
        ...(dados.nota === undefined ? {} : { nota: dados.nota }),
      }

    case 'perder':
      // `motivo` vem resolvido pela lista DA CLÍNICA, nunca do corpo. O
      // `undefined` aqui seria defeito de programação, não entrada do usuário
      // — e falhar fechado é melhor que gravar uma perda sem motivo, que é
      // precisamente o que o protótipo faz.
      if (motivo === undefined) {
        throw new BadRequestException('Escolha um motivo da lista.')
      }
      return {
        motivoPerdaId: motivo.id,
        // O cartão para de pedir ação: a paciente decidiu.
        proximoPassoEm: null,
        // `valor_orcamento` NÃO é tocado: é ele que mede o perdido no funil.
        motivoId: motivo.id,
        // O nome NO INSTANTE do evento (D-2). Com só o id, o relatório do
        // trimestre passado muda sozinho quando alguém arruma a lista; com só
        // o nome, não dá para agrupar.
        motivo: motivo.nome,
        ...(dados.nota === undefined ? {} : { nota: dados.nota }),
      }
  }
}

/**
 * Os dois prazos padrão, do protótipo (`addDays(today(),2)` e `…,3`).
 *
 * Dois dias para retomar um orçamento e três para o próximo follow-up: a
 * primeira cobrança é mais rápida que a segunda, porque a paciente acabou de
 * receber a proposta e ainda lembra dela.
 */
const DIAS_PARA_RETOMAR = 2
const DIAS_PARA_FOLLOW_UP = 3
