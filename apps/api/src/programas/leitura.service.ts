import type {
  ConsultaDeProgramas,
  FichaDoPrograma,
  ItemNaFicha,
  PainelDeProgramas,
  ProgramaNaLista,
  SessaoNaAgenda,
  SituacaoNaSaida,
  TarefaNaLista,
} from '@fir/contracts'
import {
  diaCivil,
  Dinheiro,
  type Relogio,
  type SessaoExistente,
  situacaoDoPrograma,
  somarDias,
  TIPO_RETORNO,
  TIPO_SESSAO,
} from '@fir/domain'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import type { Transacao } from '../banco/transacao'
import { RELOGIO } from '../comum/relogio'
import { DINHEIRO_QUE_ENTROU } from '../financeiro/dinheiro-que-entrou'
import { saldosDe } from '../financeiro/saldo.repositorio'
import { paraSaida, SELECT_TAREFA, type LinhaDeTarefa } from '../tarefas/leitura'

/**
 * **A LEITURA DE PROGRAMAS — tudo calculado no servidor.**
 *
 * `docs/design.md` proíbe cálculo no front, e aqui a proibição tem um motivo
 * concreto: contar "sessões atrasadas" no cliente exigiria baixar todas as
 * sessões abertas da clínica para desenhar quatro números no topo da tela.
 *
 * **A situação do programa vem do DOMÍNIO**, `situacaoDoPrograma`. Um
 * `CASE WHEN` em SQL seria a segunda implementação da precedência
 * `encerrado > concluido > atrasado > hoje > emdia` — e é a segunda que
 * diverge, porque ninguém escreve property-based test para `CASE WHEN`.
 *
 * O SALDO vem do repositório do épico 4, que agrupa por programa desde que a
 * 0010 criou `recebimentos.programa_id`. Nenhuma segunda regra de saldo mora
 * aqui.
 */

/** O horizonte da agenda e dos retornos, medidos no protótipo. */
const DIAS_DA_AGENDA = 7
const DIAS_DOS_RETORNOS = 30
/** "Mais de 7 dias" é o risco de abandono que a nota da PO nomeia. */
const DIAS_DE_RISCO = 7

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
}

type LinhaDePrograma = {
  id: string
  paciente_id: string
  paciente_nome: string
  paciente_telefone: string
  situacao: string
  motivo_encerramento: string | null
  modo_de_cobranca: 'avulso' | 'saldo'
  unidade_id: string | null
  inicio: string
  tarefa_de_origem_id: string | null
  procedimentos: string
  rotulo_sessao: string
  valor_total: string
  ultimo_pagamento_em: string | null
}

/**
 * `$1` clínica · `$2` fuso. Os nomes dos procedimentos vêm GRAVADOS nos itens
 * (D-2): renomear "Tirzepatida" no catálogo não reescreve a história de quem já
 * está em tratamento.
 *
 * **`ultimo_pagamento_em` é um `LEFT JOIN` agregado, e isso foi MEDIDO.**
 *
 * A primeira versão era uma subconsulta correlacionada que, para cada programa,
 * procurava a tarefa paga: `WHERE t.programa_id = p.id`. Sem `clinica_id`, o
 * índice `tarefas_do_programa` (que é `(clinica_id, programa_id, prazo)`) não
 * se aplica — então era **um `Seq Scan` em `tarefas` por programa**. Com 50 mil
 * tarefas, 2 mil sessões, 200 programas e 20 mil recebimentos:
 *
 *   subconsulta correlacionada ........ 1.164 ms
 *   com `clinica_id` na subconsulta ...... 903 ms  (o planner insistiu no scan)
 *   `LEFT JOIN` agregado em `tarefas` ..... 14 ms
 *   `LEFT JOIN` agregado em `recebimentos`  0,96 ms  ← esta
 *
 * E a última é mais simples, não só mais rápida: `recebimentos.programa_id` já
 * existe e `recebido_em` **é** o instante do pagamento, então `tarefas` não
 * precisa entrar. O filtro da D-9 vem de `DINHEIRO_QUE_ENTROU`: "último
 * pagamento" é uma pergunta de dinheiro que entrou, e a venda a prazo não é um.
 *
 * O escopo da conta é a CLÍNICA e não a lista filtrada — e isso é deliberado:
 * são 200 linhas agregadas de um índice, e passar a lista como parâmetro faria
 * o plano mudar a cada filtro da tela.
 */
const SELECT_PROGRAMA = `
  SELECT p.id, p.paciente_id, pa.nome AS paciente_nome, pa.telefone AS paciente_telefone,
         p.situacao, p.motivo_encerramento, p.modo_de_cobranca, p.unidade_id,
         p.inicio::text AS inicio, p.tarefa_de_origem_id,
         coalesce(i.nomes, '') AS procedimentos,
         coalesce(i.rotulo, 'Sessão') AS rotulo_sessao,
         coalesce(i.valor_total, 0)::text AS valor_total,
         pg.ultimo_pagamento_em
    FROM programas p
    JOIN pacientes pa ON pa.id = p.paciente_id
    LEFT JOIN (
      SELECT programa_id,
             string_agg(DISTINCT procedimento_nome, ' + ') AS nomes,
             min(rotulo_sessao) AS rotulo,
             sum(valor) AS valor_total
        FROM itens_do_programa WHERE clinica_id = $1 GROUP BY programa_id
    ) i ON i.programa_id = p.id
    LEFT JOIN (
      SELECT r.programa_id,
             max((r.recebido_em AT TIME ZONE $2)::date)::text AS ultimo_pagamento_em
        FROM recebimentos r
       WHERE r.clinica_id = $1 AND r.programa_id IS NOT NULL
         AND r.estornado_em IS NULL AND ${DINHEIRO_QUE_ENTROU}
       GROUP BY r.programa_id
    ) pg ON pg.programa_id = p.id
   WHERE p.clinica_id = $1 AND p.excluido_em IS NULL`

@Injectable()
export class LeituraDeProgramasService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async painel(ctx: Contexto, q: ConsultaDeProgramas): Promise<PainelDeProgramas> {
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)
    const limite7 = somarDias(hoje, DIAS_DA_AGENDA)
    const limite30 = somarDias(hoje, DIAS_DOS_RETORNOS)
    // `'eu'` resolvido NO SERVIDOR: aceitar o id do cliente deixaria qualquer
    // um ver a agenda de qualquer um trocando o parâmetro.
    const responsavel = q.responsavelId === 'eu' ? ctx.ator : (q.responsavelId ?? null)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const programas = await this.lerProgramas(c, ctx, hoje, q)

      /**
       * A AGENDA É POR SESSÃO, não por programa — e por isso ela tem a sua
       * própria consulta, com os filtros da tela aplicados nela.
       *
       * Reusar `SELECT_TAREFA` é deliberado: o cartão que a tela desenha é o
       * MESMO da tela Hoje e da ficha da paciente, e a redação de valores já
       * o cobre por ele estar em `ROTAS_COM_DINHEIRO`.
       */
      const sessoes = await c.query<LinhaDeTarefa>(
        `${SELECT_TAREFA}
           AND t.tipo = $3
           AND ($4::uuid IS NULL OR t.responsavel_id = $4)
           AND ($5::uuid IS NULL OR t.unidade_id = $5)
           AND (t.status = 'aberta'
                OR (t.status = 'concluida' AND (t.concluida_em AT TIME ZONE $6)::date = $2::date))
           AND (t.status <> 'aberta' OR t.prazo <= $7::date)
           AND t.programa_id IN (SELECT id FROM programas WHERE excluido_em IS NULL)
         ORDER BY t.prazo, t.hora NULLS LAST, t.item_chave, t.sessao_indice`,
        [ctx.clinicaId, hoje, TIPO_SESSAO, responsavel, q.unidadeId ?? null, ctx.fuso, limite7],
      )

      const retornos = await c.query<LinhaDeTarefa>(
        `${SELECT_TAREFA}
           AND t.tipo = $3 AND t.status = 'aberta' AND t.prazo <= $4::date
           AND ($5::uuid IS NULL OR t.responsavel_id = $5)
           AND ($6::uuid IS NULL OR t.unidade_id = $6)
         ORDER BY t.prazo, t.hora NULLS LAST`,
        [ctx.clinicaId, hoje, TIPO_RETORNO, limite30, responsavel, q.unidadeId ?? null],
      )

      /**
       * O SALDO POR PROGRAMA, de uma consulta só — e do repositório do épico 4.
       *
       * O aviso que a sessão carrega é o do MANUAL cap. 8: *"a próxima sessão
       * mostra um alerta com o valor"*. Ele existe para a cobrança acontecer
       * **no atendimento**, que é o único momento em que a paciente está na
       * frente de alguém.
       */
      const saldos = await saldosDe(
        c,
        ctx.clinicaId,
        [...new Set(programas.map((p) => p.paciente_id))],
      )
      const saldoDoPrograma = new Map<string, Dinheiro>()
      for (const [, s] of saldos) {
        for (const g of s.grupos) {
          if (g.programaId !== null) saldoDoPrograma.set(g.programaId, g.saldo)
        }
      }

      const comAviso = (l: LinhaDeTarefa): SessaoNaAgenda => {
        const saldo = saldoDoPrograma.get(l.programa_id ?? '') ?? Dinheiro.zero()
        return {
          tarefa: paraSaida(l),
          temSaldo: !saldo.ehZero() && !saldo.ehNegativo(),
          saldo: saldo.centavos.toString(),
        }
      }

      const abertas = sessoes.rows.filter((x) => x.status === 'aberta')
      const lista = await this.montarLista(c, ctx, hoje, programas, saldoDoPrograma, q)

      return {
        indicadores: this.indicadores(lista, abertas, hoje, limite7),
        agenda: {
          // Atrasadas PRIMEIRO e da mais antiga: a nota da PO diz que elas
          // "ficam aqui até serem realizadas", porque paciente com sessão
          // atrasada é risco de abandono do programa.
          atrasadas: abertas.filter((x) => x.prazo < hoje).map(comAviso),
          hoje: abertas.filter((x) => x.prazo === hoje).map(comAviso),
          realizadasHoje: sessoes.rows.filter((x) => x.status === 'concluida').map(comAviso),
          proximos7: abertas.filter((x) => x.prazo > hoje && x.prazo <= limite7).map(comAviso),
        },
        retornos: retornos.rows.map(paraSaida),
        lista,
      }
    })
  }

  /**
   * A FICHA DO PROGRAMA — `@DadoSensivel('paciente')` na rota.
   *
   * Ela carrega **dose, insumo e procedimento aplicado**: dado pessoal
   * sensível de saúde (LGPD art. 11, regra 18). A pergunta que a lei faz é
   * *"quem olhou o tratamento da minha paciente"*, e a resposta precisa
   * existir — registro de ACESSO, não só de escrita.
   */
  async ficha(ctx: Contexto, id: string): Promise<FichaDoPrograma> {
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDePrograma>(`${SELECT_PROGRAMA} AND p.id = $3`, [
        ctx.clinicaId,
        ctx.fuso,
        id,
      ])
      const p = r.rows[0]
      // A RLS já filtrou: zero linhas é a mesma resposta de "não existe".
      if (p === undefined) throw new NotFoundException('Programa não encontrado.')

      const tarefas = await c.query<LinhaDeTarefa>(
        `${SELECT_TAREFA} AND t.programa_id = $3
         ORDER BY t.item_chave, t.sessao_indice NULLS LAST, t.prazo`,
        [ctx.clinicaId, hoje, id],
      )
      const sessoes = tarefas.rows.filter((x) => x.tipo === TIPO_SESSAO)
      const situacao = this.situacao(p, sessoes, hoje)

      const itens = await c.query<{
        chave: string
        procedimento_id: string
        procedimento_nome: string
        rotulo_sessao: string
        sessoes: number
        intervalo_dias: number
        inicio: string
        depois_de: string | null
        responsavel_id: string
        responsavel_nome: string
        dose: string
        insumo_id: string | null
        insumo_milesimos: string | null
        insumo_unidade: string | null
        valor: string | null
      }>(
        `SELECT i.chave, i.procedimento_id, i.procedimento_nome, i.rotulo_sessao, i.sessoes,
                i.intervalo_dias, i.inicio::text AS inicio, i.depois_de,
                i.responsavel_id, pr.nome AS responsavel_nome, i.dose,
                i.insumo_id, i.insumo_milesimos::text AS insumo_milesimos, i.insumo_unidade,
                i.valor::text AS valor
           FROM itens_do_programa i
           JOIN pessoas pr ON pr.id = i.responsavel_id
          WHERE i.programa_id = $1 ORDER BY i.ordem`,
        [id],
      )

      const saldo = (await saldosDe(c, ctx.clinicaId, [p.paciente_id])).get(p.paciente_id)!
      const doPrograma =
        saldo.grupos.find((g) => g.programaId === id)?.saldo ?? Dinheiro.zero()

      /**
       * O RECEBIDO do programa — e o filtro da D-9 **não é zelo aqui**.
       *
       * `recebido` é "quanto a paciente já pagou DESTE programa". A linha da
       * venda a prazo tem `valor = 0` e a dívida em `valor_aberto`: somá-la
       * não muda o número hoje, mas o dia em que alguém trocar isto por
       * `count(*)` ("quantos pagamentos") ou por uma média, a promessa entraria
       * na conta.
       *
       * **A varredura `teste/dinheiro-que-entrou.test.ts` encontrou esta
       * consulta sem o filtro** — não foi revisão de código. É exatamente o
       * quinto lugar que a varredura existe para pegar.
       */
      const recebido = await c.query<{ total: string }>(
        `SELECT coalesce(sum(r.valor), 0)::text AS total
           FROM recebimentos r
          WHERE r.programa_id = $1 AND r.estornado_em IS NULL
            AND ${DINHEIRO_QUE_ENTROU}`,
        [id],
      )

      const validas = sessoes.filter((x) => x.status !== 'cancelada')
      const feitas = validas.filter((x) => x.status === 'concluida')
      const atrasadas = validas.filter((x) => x.status === 'aberta' && x.prazo < hoje)
      /**
       * NO PRAZO = `concluida_em` no dia civil da clínica **até** o prazo.
       *
       * Comparar o instante UTC com a `date` do prazo mandaria para "atrasada"
       * toda sessão concluída depois das 21h em Salvador. A borda é a do fuso
       * da clínica, sempre (regra 23).
       */
      const noPrazo = feitas.filter(
        (x) => x.concluida_em !== null && diaCivil(x.concluida_em, ctx.fuso) <= x.prazo,
      ).length

      const porItem = new Map<string, LinhaDeTarefa[]>()
      for (const t of tarefas.rows) {
        if (t.item_chave === null) continue
        porItem.set(t.item_chave, [...(porItem.get(t.item_chave) ?? []), t])
      }

      const naFicha = (l: (typeof itens.rows)[number]): ItemNaFicha => {
        const doItem = porItem.get(l.chave) ?? []
        const retorno = doItem.find((x) => x.tipo === TIPO_RETORNO && x.status !== 'cancelada')
        return {
          chave: l.chave,
          procedimentoId: l.procedimento_id,
          procedimentoNome: l.procedimento_nome,
          rotuloSessao: l.rotulo_sessao,
          sessoes: l.sessoes,
          intervaloDias: l.intervalo_dias,
          inicio: l.inicio,
          depoisDe: l.depois_de,
          responsavelId: l.responsavel_id,
          responsavelNome: l.responsavel_nome,
          dose: l.dose,
          insumo:
            l.insumo_id === null
              ? null
              : {
                  itemId: l.insumo_id,
                  quantidade: l.insumo_milesimos!,
                  unidade: l.insumo_unidade!,
                },
          valor: l.valor,
          agenda: doItem.filter((x) => x.tipo === TIPO_SESSAO).map(paraSaida),
          retorno: retorno === undefined ? null : paraSaida(retorno),
        }
      }

      return {
        id: p.id,
        pacienteId: p.paciente_id,
        pacienteNome: p.paciente_nome,
        pacienteTelefone: p.paciente_telefone,
        inicio: p.inicio,
        modoDeCobranca: p.modo_de_cobranca,
        situacao,
        motivoEncerramento: p.motivo_encerramento,
        unidadeId: p.unidade_id,
        tarefaDeOrigemId: p.tarefa_de_origem_id,
        realizadas: feitas.length,
        total: validas.length,
        percentual: percentual(feitas.length, validas.length),
        percentualNoPrazo: percentual(noPrazo, feitas.length),
        sessoesAtrasadas: atrasadas.length,
        diasDeAtraso: this.atraso(p, sessoes, hoje),
        recebido: recebido.rows[0]!.total,
        saldo: doPrograma.centavos.toString(),
        temSaldo: !doPrograma.ehZero() && !doPrograma.ehNegativo(),
        valorTotal: p.valor_total,
        itens: itens.rows.map(naFicha),
        // As tarefas do programa que não são sessão nem retorno: o pagamento
        // da adesão, o reagendamento, o pós-consulta (MANUAL cap. 8).
        outras: tarefas.rows
          .filter((x) => x.tipo !== TIPO_SESSAO && x.tipo !== TIPO_RETORNO)
          .map(paraSaida),
      }
    })
  }

  /**
   * **O BLOCO "Sessões de programas" DA TELA HOJE.**
   *
   * A nota da PO, copiada: *"Aplicações e sessões da equipe para hoje, com as
   * atrasadas primeiro. Ao concluir, a baixa no estoque é feita sozinha."*
   *
   * Vazio sem a permissão `programas` — e "validar" aqui é **não compor a
   * seção**, não esconder na tela (regra 16). A tela Hoje em si é de todos
   * (`menu.ts`, `perm: null`), então a resposta continua inteira para o resto.
   *
   * O escopo é o da tela: `meu` traz as da pessoa, `equipe` traz todas. A
   * resolução é a mesma dos outros blocos, e por isso o `responsavelId` vem
   * resolvido de fora em vez de ser decidido aqui.
   */
  async sessoesDeHoje(
    ctx: Contexto,
    x: { readonly podePrograma: boolean; readonly responsavelId: string | null },
  ): Promise<readonly SessaoNaAgenda[]> {
    if (!x.podePrograma) return []
    const hoje = diaCivil(this.relogio.agora(), ctx.fuso)

    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query<LinhaDeTarefa>(
        `${SELECT_TAREFA}
           AND t.tipo = $3 AND t.status = 'aberta' AND t.prazo <= $2::date
           AND ($4::uuid IS NULL OR t.responsavel_id = $4)
           AND t.programa_id IN (SELECT id FROM programas WHERE excluido_em IS NULL)
         ORDER BY t.prazo, t.hora NULLS LAST, t.item_chave, t.sessao_indice`,
        [ctx.clinicaId, hoje, TIPO_SESSAO, x.responsavelId],
      )
      if (r.rows.length === 0) return []

      const saldos = await saldosDe(c, ctx.clinicaId, [
        ...new Set(r.rows.map((l) => l.paciente_id!).filter((p) => p !== null)),
      ])
      const porPrograma = new Map<string, Dinheiro>()
      for (const [, s] of saldos) {
        for (const g of s.grupos) {
          if (g.programaId !== null) porPrograma.set(g.programaId, g.saldo)
        }
      }
      return r.rows.map((l) => {
        const saldo = porPrograma.get(l.programa_id ?? '') ?? Dinheiro.zero()
        return {
          tarefa: paraSaida(l),
          temSaldo: !saldo.ehZero() && !saldo.ehNegativo(),
          saldo: saldo.centavos.toString(),
        }
      })
    })
  }

  /* ------------------------------------------------------------- privados */

  private async lerProgramas(
    c: Transacao,
    ctx: Contexto,
    hoje: string,
    q: ConsultaDeProgramas,
  ): Promise<LinhaDePrograma[]> {
    void hoje
    const r = await c.query<LinhaDePrograma>(
      `${SELECT_PROGRAMA}
         AND ($3::uuid IS NULL OR p.unidade_id = $3)
         AND ($4::uuid IS NULL
              OR EXISTS (SELECT 1 FROM itens_do_programa i
                          WHERE i.programa_id = p.id AND i.procedimento_id = $4))
         AND ($5::text IS NULL OR normalizar_nome(pa.nome) LIKE '%' || normalizar_nome($5) || '%')
       ORDER BY pa.nome`,
      [
        ctx.clinicaId,
        ctx.fuso,
        q.unidadeId ?? null,
        q.procedimentoId ?? null,
        q.q === undefined || q.q === '' ? null : q.q,
      ],
    )
    return r.rows
  }

  private async montarLista(
    c: Transacao,
    ctx: Contexto,
    hoje: string,
    programas: readonly LinhaDePrograma[],
    saldos: ReadonlyMap<string, Dinheiro>,
    q: ConsultaDeProgramas,
  ): Promise<ProgramaNaLista[]> {
    if (programas.length === 0) return []

    const todas = await c.query<{
      programa_id: string
      id: string
      item_chave: string
      sessao_indice: number
      prazo: string
      status: SessaoExistente['status']
      tipo: string
    }>(
      `SELECT programa_id, id, item_chave, sessao_indice, prazo::text AS prazo, status, tipo
         FROM tarefas
        WHERE clinica_id = $1 AND excluida_em IS NULL
          AND programa_id = ANY($2::uuid[])
          AND tipo IN ($3, $4)`,
      [ctx.clinicaId, programas.map((p) => p.id), TIPO_SESSAO, TIPO_RETORNO],
    )

    const sessoesPorPrograma = new Map<string, LinhaDeSessaoCrua[]>()
    const retornoPorPrograma = new Map<string, string>()
    for (const t of todas.rows) {
      if (t.tipo === TIPO_RETORNO) {
        if (t.status !== 'cancelada') {
          const atual = retornoPorPrograma.get(t.programa_id)
          if (atual === undefined || t.prazo < atual) retornoPorPrograma.set(t.programa_id, t.prazo)
        }
        continue
      }
      sessoesPorPrograma.set(t.programa_id, [...(sessoesPorPrograma.get(t.programa_id) ?? []), t])
    }

    const fora: ProgramaNaLista[] = []
    for (const p of programas) {
      const sessoes = sessoesPorPrograma.get(p.id) ?? []
      const situacao = this.situacao(p, sessoes, hoje)
      const validas = sessoes.filter((x) => x.status !== 'cancelada')
      const feitas = validas.filter((x) => x.status === 'concluida')
      const abertas = validas
        .filter((x) => x.status === 'aberta')
        .sort((a, b) => a.prazo.localeCompare(b.prazo))
      const saldo = saldos.get(p.id) ?? Dinheiro.zero()
      const temSaldo = !saldo.ehZero() && !saldo.ehNegativo()

      fora.push({
        id: p.id,
        pacienteId: p.paciente_id,
        pacienteNome: p.paciente_nome,
        pacienteTelefone: p.paciente_telefone,
        procedimentos: p.procedimentos,
        rotuloSessao: p.rotulo_sessao,
        modoDeCobranca: p.modo_de_cobranca,
        situacao,
        motivoEncerramento: p.motivo_encerramento,
        diasDeAtraso: this.atraso(p, sessoes, hoje),
        realizadas: feitas.length,
        total: validas.length,
        percentual: percentual(feitas.length, validas.length),
        proximaEm: abertas[0]?.prazo ?? null,
        retornoEm: retornoPorPrograma.get(p.id) ?? null,
        ultimoPagamentoEm: p.ultimo_pagamento_em,
        unidadeId: p.unidade_id,
        temSaldo,
        saldo: saldo.centavos.toString(),
      })
    }

    /**
     * OS FILTROS DE SITUAÇÃO, aplicados **depois** da derivação.
     *
     * Eles não podem virar `WHERE` no SQL: `atrasados`, `concluidos` e
     * `encerrados` são a SITUAÇÃO, e a situação é do domínio. Filtrar no banco
     * exigiria reimplementar a precedência em `CASE WHEN`, e aí a tela e a
     * ficha passariam a discordar sobre o que é "atrasado".
     *
     * `saldo` ordena pelo MAIOR saldo primeiro — é a fila de cobrança, e
     * ordem alfabética ali faria a recepção ligar para quem deve R$ 50 antes
     * de quem deve R$ 3.000.
     */
    const filtrados = fora.filter((x) => {
      switch (q.situacao) {
        case 'todos':
          return true
        case 'saldo':
          return x.temSaldo
        case 'atrasados':
          return x.situacao === 'atrasado'
        case 'concluidos':
          return x.situacao === 'concluido'
        case 'encerrados':
          return x.situacao === 'encerrado'
        default:
          return x.situacao !== 'encerrado' && x.situacao !== 'concluido'
      }
    })
    if (q.situacao === 'saldo') {
      filtrados.sort(
        (a, b) =>
          Number(BigInt(b.saldo ?? '0') - BigInt(a.saldo ?? '0')) ||
          a.pacienteNome.localeCompare(b.pacienteNome),
      )
    }
    return filtrados
  }

  /**
   * Os indicadores saem da LISTA já derivada e das sessões já lidas.
   *
   * Nenhuma consulta nova: os dois conjuntos estão na mão, e uma terceira
   * consulta que contasse o mesmo seria o terceiro número para a mesma
   * pergunta.
   *
   * **A lista é a FILTRADA, e isso é deliberado:** o filtro de unidade é da
   * clínica inteira (a recepção escolhe a unidade no topo), e os indicadores
   * têm de falar da mesma unidade que a lista embaixo. O filtro de SITUAÇÃO,
   * porém, não pode mudar "pacientes em programa" — e é por isso que este
   * método conta sobre `situacao`, não sobre o tamanho da lista.
   */
  private indicadores(
    lista: readonly ProgramaNaLista[],
    abertas: readonly { prazo: string }[],
    hoje: string,
    limite7: string,
  ): PainelDeProgramas['indicadores'] {
    const ativos = lista.filter((x) => x.situacao !== 'encerrado' && x.situacao !== 'concluido')
    const comSaldo = lista.filter((x) => x.temSaldo)
    const total = comSaldo.reduce((s, x) => s + BigInt(x.saldo ?? '0'), 0n)
    return {
      pacientesEmPrograma: new Set(ativos.map((x) => x.pacienteId)).size,
      programasConcluidos: lista.filter((x) => x.situacao === 'concluido').length,
      sessoesHoje: abertas.filter((x) => x.prazo === hoje).length,
      sessoesProximos7: abertas.filter((x) => x.prazo > hoje && x.prazo <= limite7).length,
      sessoesAtrasadas: abertas.filter((x) => x.prazo < hoje).length,
      pacientesEmRisco: new Set(
        ativos.filter((x) => x.diasDeAtraso > DIAS_DE_RISCO).map((x) => x.pacienteId),
      ).size,
      saldoAReceber: total.toString(),
      pacientesQueDevem: new Set(comSaldo.map((x) => x.pacienteId)).size,
    }
  }

  /** A situação vem do DOMÍNIO. Nunca um `CASE WHEN` no SQL. */
  private situacao(
    p: { situacao: string },
    sessoes: readonly LinhaDeSessaoCrua[],
    hoje: string,
  ): SituacaoNaSaida {
    return situacaoDoPrograma({
      encerrado: p.situacao === 'encerrado',
      sessoes: sessoes.map(paraDominio),
      hojeDaClinica: hoje,
    }).situacao
  }

  private atraso(
    p: { situacao: string },
    sessoes: readonly LinhaDeSessaoCrua[],
    hoje: string,
  ): number {
    return situacaoDoPrograma({
      encerrado: p.situacao === 'encerrado',
      sessoes: sessoes.map(paraDominio),
      hojeDaClinica: hoje,
    }).diasDeAtraso
  }
}

/* ============================================================ auxiliares */

/** O mínimo que a derivação da situação precisa de uma sessão. */
type LinhaDeSessaoCrua = {
  readonly id: string
  readonly item_chave: string | null
  readonly sessao_indice: number | null
  readonly prazo: string
  readonly status: string
}

const paraDominio = (l: LinhaDeSessaoCrua): SessaoExistente => ({
  tarefaId: l.id,
  itemChave: l.item_chave ?? 'i1',
  indice: l.sessao_indice ?? 1,
  prazo: l.prazo,
  status: l.status as SessaoExistente['status'],
})

/**
 * `Math.round` e não `toFixed`: percentual é inteiro de 0 a 100, e não dinheiro.
 *
 * Denominador zero devolve zero, nunca `NaN`: um `NaN%` na barra de progresso
 * é o tipo de coisa que a recepção reporta como "a tela quebrou".
 */
const percentual = (parte: number, todo: number): number =>
  todo === 0 ? 0 : Math.round((parte / todo) * 100)

/** Reexportado para o controlador. */
export type { TarefaNaLista }
