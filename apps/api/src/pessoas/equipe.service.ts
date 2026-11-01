import type {
  AlertaNaEquipe,
  BancoDeHoras,
  ConfiguracaoDePessoal,
  Equipe,
  FichaCompleta,
  FichaNaLista,
  LinhaDoBancoDeHoras,
  SalvarBancoDeHoras,
  SalvarConfiguracaoDePessoal,
  SalvarDocumento,
  SalvarFerias,
  SalvarFicha,
} from '@fir/contracts'
import {
  CONTRATOS_COM_BANCO_DE_HORAS,
  type Contrato,
  LIMITE_DE_HORAS_PADRAO_EM_MINUTOS,
  type FeriasRegistradas,
  type PessoaParaAlerta,
  alertasDaPessoa,
  diasDeFerias,
  diasEntre,
  feriasSeSobrepoem,
  mesesDeCasa,
  ordenarAlertas,
  periodosAquisitivos,
  somarDias,
  somarMeses,
} from '@fir/domain'
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type pg from 'pg'
import type { PessoaId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import type { ClinicaId } from '../banco/clinica-id'
import { diaDaClinica } from '../estoque/dia-da-clinica'
import { RELOGIO, type Relogio } from '../comum/relogio'

/**
 * **Pessoas › Equipe** — a ficha, os documentos, as férias e o banco de horas.
 *
 * As sete ações da primeira metade do épico 7: `ficha`, `doc`, `excluirDoc`,
 * `ferias`, `excluirFerias`, `horas` e `config`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE SERVIÇO NÃO FAZ
 *
 *  1. **Não calcula férias, alerta nem tempo de casa.** Os três moram em
 *     `packages/domain/pessoal.ts`, puros, com property-based test. Aqui só se
 *     lê o estado e se entrega a eles — e é por isso que a regra "o prazo de
 *     concessão é o fim do período seguinte" existe **uma vez**, e não uma na
 *     lista e outra na ficha.
 *
 *  2. **Não decide quem vê salário.** A rota exige `pessoas.gerir` e o
 *     `RedacaoInterceptor` apaga o campo num ponto único (regra 17). Não há
 *     `if (pode('pessoas.gerir'))` nesta classe, e não deve haver: o endpoint
 *     número quarenta não será revisado com o cuidado do primeiro.
 *
 *  3. **Não usa `new Date()`.** `hoje` é `diaDaClinica(relogio, fuso)` —
 *     servidor, no fuso da clínica (regras 22 e 24). O protótipo usa `today()`
 *     do navegador, e com ele o celular adiantado da recepção antecipa o
 *     vencimento de um ASO e atrasa o prazo legal de férias de outra pessoa.
 * ────────────────────────────────────────────────────────────────────────────
 */

type Contexto = {
  readonly clinicaId: ClinicaId
  readonly ator: PessoaId
  readonly fuso: string
}

type LinhaDeFicha = {
  id: string
  nome: string
  cargo: string
  contrato: Contrato
  admissao: string | null
  aniversario: string | null
  salario: string | null
  pessoa_id: string | null
  pessoa_nome: string | null
  gestor_id: string | null
  gestor_nome: string | null
  ativo: boolean
}

/**
 * `::text` nas datas, e isto não é preguiça.
 *
 * O driver devolve `date` como `Date` em UTC, e `toISOString().slice(0,10)`
 * sobre ela é correto só porque a meia-noite UTC cai no mesmo dia — num fuso
 * a oeste a conversão escorrega um dia. `date` é dia CIVIL, sem instante:
 * `::text` entrega `aaaa-mm-dd` exato, que é o que o contrato declara.
 */
const SELECT_FICHA = `
  SELECT f.id, f.nome, f.cargo, f.contrato,
         f.admissao::text    AS admissao,
         f.aniversario::text AS aniversario,
         f.salario::text     AS salario,
         f.pessoa_id, p.nome AS pessoa_nome,
         f.gestor_id, g.nome AS gestor_nome,
         f.ativo
    FROM fichas_de_pessoa f
    LEFT JOIN pessoas p ON p.id = f.pessoa_id
    LEFT JOIN pessoas g ON g.id = f.gestor_id
   WHERE f.excluida_em IS NULL`

type LinhaDeFerias = { id: string; ficha_id: string; inicio: string; fim: string; situacao: string }
type LinhaDeDocumento = {
  id: string
  ficha_id: string
  nome: string
  validade: string | null
}
type LinhaDeHoras = { ficha_id: string; mes: string; saldo_minutos: number; obs: string }

/** Quantos meses do banco de horas a ficha e a tabela mostram. */
const MESES_NO_HISTORICO = 6

@Injectable()
export class EquipeService {
  // `@Inject` explícito: o esbuild não emite `design:paramtypes`.
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * A **Visão geral**: as fichas, os alertas de toda a equipe, os
   * aniversariantes do mês e quem usa a ferramenta e ainda não tem ficha.
   *
   * Uma ida ao servidor, e não quatro: a tela dela monta as quatro coisas do
   * mesmo estado, e quatro requisições dariam quatro instantes de "hoje"
   * diferentes — o alerta de um documento que vence à meia-noite apareceria
   * em uma e não na outra.
   */
  async equipe(ctx: Contexto): Promise<Equipe> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const limite = await limiteDeHoras(c)
      const fichas = (await c.query<LinhaDeFicha>(`${SELECT_FICHA} ORDER BY f.ativo DESC, f.nome`))
        .rows
      const ferias = await feriasPorFicha(c)
      const documentos = await documentosPorFicha(c)
      const ultimoSaldo = await ultimoSaldoPorFicha(c)

      const alertas: AlertaNaEquipe[] = []
      const saida: FichaNaLista[] = []

      for (const f of fichas) {
        const daFicha = alertasDaPessoa(
          paraAlerta(f, ferias.get(f.id) ?? [], documentos.get(f.id) ?? [], ultimoSaldo.get(f.id)),
          limite,
          hoje,
        )
        for (const a of daFicha) {
          alertas.push({
            fichaId: f.id,
            nome: f.nome,
            ...a,
            // A DESCRIÇÃO DA TAREFA SAI DAQUI, não da tela: ela entra em
            // `tarefas.descricao` e é lida meses depois, quando ninguém
            // lembra de qual alerta era. O formato é o dela.
            descricaoDaTarefa: `${a.tipo}: ${f.nome} · ${a.texto}`,
          })
        }
        saida.push({
          id: f.id,
          nome: f.nome,
          cargo: f.cargo,
          contrato: f.contrato,
          admissao: f.admissao,
          aniversario: f.aniversario,
          pessoaId: f.pessoa_id,
          pessoaNome: f.pessoa_nome,
          gestorId: f.gestor_id,
          gestorNome: f.gestor_nome,
          ativo: f.ativo,
          mesesDeCasa: mesesDeCasa(f.admissao, hoje),
          quantosAlertas: daFicha.length,
        })
      }

      const mes = hoje.slice(5, 7)
      return {
        fichas: saida,
        alertas: [...ordenarAlertas(alertas)],
        aniversariantesDoMes: fichas
          .filter((f) => f.ativo && f.aniversario !== null && f.aniversario.slice(5, 7) === mes)
          .map((f) => ({ fichaId: f.id, nome: f.nome, aniversario: f.aniversario! }))
          .sort((a, b) => a.aniversario.slice(8, 10).localeCompare(b.aniversario.slice(8, 10))),
        semFicha: await usuariosSemFicha(c),
        limiteDeHorasEmMinutos: limite,
      }
    })
  }

  /** A ficha aberta — a ÚNICA resposta do produto que carrega `salario`. */
  async ficha(ctx: Contexto, fichaId: string): Promise<FichaCompleta> {
    const hoje = diaDaClinica(this.relogio, ctx.fuso)
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const f = await umaFicha(c, fichaId)
      const limite = await limiteDeHoras(c)
      const ferias = (await feriasPorFicha(c, fichaId)).get(fichaId) ?? []
      const documentos = (await documentosPorFicha(c, fichaId)).get(fichaId) ?? []
      const horas = (
        await c.query<LinhaDeHoras>(
          `SELECT ficha_id, mes, saldo_minutos, obs FROM banco_de_horas
            WHERE ficha_id = $1 AND excluido_em IS NULL
            ORDER BY mes DESC LIMIT $2`,
          [fichaId, MESES_NO_HISTORICO],
        )
      ).rows

      const periodos = periodosAquisitivos({
        contrato: f.contrato,
        admissao: f.admissao,
        ferias,
        hoje,
      })

      return {
        id: f.id,
        nome: f.nome,
        cargo: f.cargo,
        contrato: f.contrato,
        admissao: f.admissao,
        aniversario: f.aniversario,
        pessoaId: f.pessoa_id,
        pessoaNome: f.pessoa_nome,
        gestorId: f.gestor_id,
        gestorNome: f.gestor_nome,
        ativo: f.ativo,
        mesesDeCasa: mesesDeCasa(f.admissao, hoje),
        // O `RedacaoInterceptor` troca isto por `null` sem `pessoas.gerir`.
        salario: f.salario,
        // Mais recente primeiro — a lista da ficha é histórico, e o último
        // período registrado é o que a gestora acabou de lançar.
        ferias: [...ferias]
          .sort((a, b) => b.inicio.localeCompare(a.inicio))
          .map((v) => ({
            id: v.id,
            inicio: v.inicio,
            fim: v.fim,
            // Dias do DOMÍNIO: 01→01 é um dia, e a tela não conta.
            dias: diasDeFerias(v),
            situacao: v.situacao,
          })),
        periodosAquisitivos: [...periodos],
        documentos: documentos.map((d) => ({
          id: d.id,
          nome: d.nome,
          validade: d.validade,
          diasParaVencer: d.validade === null ? null : diasEntre(hoje, d.validade),
        })),
        horas: horas.map((h) => ({
          mes: h.mes,
          saldoEmMinutos: h.saldo_minutos,
          obs: h.obs,
          acimaDoLimite: Math.abs(h.saldo_minutos) > limite,
        })),
        alertas: alertasDaPessoa(
          // `horas[0]` é o mês MAIS RECENTE (a consulta ordena `mes DESC`), e
          // é dele que o alerta fala — não do pior mês do histórico. Um
          // estouro de março já corrigido em abril não é alerta vivo.
          paraAlerta(
            f,
            ferias,
            documentos,
            horas[0] === undefined
              ? undefined
              : { mes: horas[0].mes, saldoEmMinutos: horas[0].saldo_minutos },
          ),
          limite,
          hoje,
        ).map((a) => ({
          fichaId: f.id,
          nome: f.nome,
          ...a,
          descricaoDaTarefa: `${a.tipo}: ${f.nome} · ${a.texto}`,
        })),
        /**
         * "Primeiro período aquisitivo completa em …" — a frase dela para
         * quem ainda não tem um ano de casa.
         *
         * `null` quando já há período completo ou quando não há admissão: a
         * tela não precisa decidir qual das três situações é, e um cálculo de
         * data no front seria a segunda implementação da regra 25.
         */
        primeiroPeriodoCompletaEm:
          periodos.length > 0 || f.admissao === null || f.contrato !== 'CLT'
            ? null
            : somarDias(somarMeses(f.admissao, 12), -1),
      }
    })
  }

  /**
   * Criar ficha (`POST`) ou substituí-la inteira (`PUT`) — o `ficha` dela.
   *
   * `PUT` com o corpo todo, e não `PATCH`: num `PATCH`, "campo ausente" e
   * "campo apagado" se confundem, e a tela que reenvia o formulário sem o
   * campo que não carregou apagaria o salário de alguém em silêncio.
   */
  async salvarFicha(
    ctx: Contexto,
    fichaId: string | null,
    dados: SalvarFicha,
  ): Promise<FichaCompleta> {
    const id = await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      if (dados.pessoaId !== null) {
        /**
         * O usuário é conferido pela RLS, na mesma transação — o mesmo
         * raciocínio de `inserirPessoa`. A FK composta já impede o usuário de
         * outra clínica; o que ela não alcança é "a pessoa está ativa", e
         * ligar a ficha a um login desativado produziria uma meta automática
         * que nunca mais recebe registro nenhum.
         */
        const p = await c.query('SELECT 1 FROM pessoas WHERE id = $1 AND ativo', [dados.pessoaId])
        if (p.rowCount === 0) {
          throw new UnprocessableEntityException('Esse usuário não existe ou está desativado.')
        }
        // A mensagem é a dela, e a recusa é do índice `ficha_por_usuario` logo
        // abaixo — este `SELECT` só existe para nomear o conflito.
        const ja = await c.query<{ nome: string }>(
          `SELECT nome FROM fichas_de_pessoa
            WHERE pessoa_id = $1 AND excluida_em IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
          [dados.pessoaId, fichaId],
        )
        if (ja.rowCount !== null && ja.rowCount > 0) {
          throw new ConflictException(
            `Esse usuário já está ligado à ficha de ${ja.rows[0]!.nome}.`,
          )
        }
      }
      if (dados.gestorId !== null) {
        const g = await c.query('SELECT 1 FROM pessoas WHERE id = $1 AND ativo', [dados.gestorId])
        if (g.rowCount === 0) {
          throw new UnprocessableEntityException('Esse gestor não existe ou está desativado.')
        }
      }

      const valores = [
        dados.nome,
        dados.cargo,
        dados.contrato,
        dados.admissao,
        dados.aniversario,
        dados.salario === null ? null : dados.salario.toString(),
        dados.pessoaId,
        dados.gestorId,
        dados.ativo,
      ]

      if (fichaId === null) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO fichas_de_pessoa
             (clinica_id, nome, cargo, contrato, admissao, aniversario, salario,
              pessoa_id, gestor_id, ativo, desativada_em, criada_por)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   CASE WHEN $10 THEN NULL ELSE now() END, $11)
           RETURNING id`,
          [ctx.clinicaId, ...valores, ctx.ator],
        )
        return r.rows[0]!.id
      }

      // UM `UPDATE` SÓ: dois (dados e ativação) deixariam a trilha com dois
      // eventos para uma ação da gestora. `desativada_em` segue `ativo` pelo
      // CHECK `ficha_desativada_tem_instante`.
      const r = await c.query<{ id: string }>(
        `UPDATE fichas_de_pessoa
            SET nome = $2, cargo = $3, contrato = $4, admissao = $5, aniversario = $6,
                salario = $7, pessoa_id = $8, gestor_id = $9, ativo = $10,
                desativada_em = CASE WHEN $10 THEN NULL ELSE coalesce(desativada_em, now()) END
          WHERE id = $1 AND excluida_em IS NULL
          RETURNING id`,
        [fichaId, ...valores],
      )
      if (r.rowCount === 0) throw new NotFoundException('Ficha não encontrada.')
      return r.rows[0]!.id
    })

    // Relê pela MESMA porta da tela: gravar e devolver a ficha montada evita
    // que a tela precise de uma segunda chamada só para saber em que estado
    // as férias e os alertas ficaram.
    return this.ficha(ctx, id)
  }

  /** `ferias` — e o servidor RECUSA sobreposição, ao contrário do protótipo. */
  async registrarFerias(
    ctx: Contexto,
    fichaId: string,
    dados: SalvarFerias,
  ): Promise<FichaCompleta> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      // `FOR UPDATE` na ficha: duas abas registrando períodos sobrepostos
      // seriam duas leituras concordando que não há sobreposição. O `EXCLUDE`
      // do banco já fecharia a corrida — o lock existe para que a mensagem
      // seja a de tela, e não um erro de constraint.
      const f = await umaFicha(c, fichaId, true)
      const existentes = (await feriasPorFicha(c, fichaId)).get(fichaId) ?? []
      if (feriasSeSobrepoem(dados, existentes)) {
        throw new ConflictException(
          `Já há férias registradas de ${f.nome} nesse período. Remova o período antigo antes.`,
        )
      }
      await c.query(
        `INSERT INTO ferias_da_pessoa (clinica_id, ficha_id, inicio, fim, situacao, criada_por)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ctx.clinicaId, fichaId, dados.inicio, dados.fim, dados.situacao, ctx.ator],
      )
    })
    return this.ficha(ctx, fichaId)
  }

  /** `excluirFerias` — **soft delete** (regra 20), nunca `DELETE`. */
  async removerFerias(ctx: Contexto, fichaId: string, feriasId: string): Promise<FichaCompleta> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query(
        `UPDATE ferias_da_pessoa SET excluida_em = now()
          WHERE id = $1 AND ficha_id = $2 AND excluida_em IS NULL`,
        [feriasId, fichaId],
      )
      if (r.rowCount === 0) throw new NotFoundException('Esse período de férias não existe mais.')
    })
    return this.ficha(ctx, fichaId)
  }

  /** `doc` — o documento com validade, cujo valor é o alerta. */
  async registrarDocumento(
    ctx: Contexto,
    fichaId: string,
    dados: SalvarDocumento,
  ): Promise<FichaCompleta> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await umaFicha(c, fichaId)
      await c.query(
        `INSERT INTO documentos_da_pessoa (clinica_id, ficha_id, nome, validade, criado_por)
         VALUES ($1, $2, $3, $4, $5)`,
        [ctx.clinicaId, fichaId, dados.nome, dados.validade, ctx.ator],
      )
    })
    return this.ficha(ctx, fichaId)
  }

  /** `excluirDoc` — soft delete. */
  async removerDocumento(ctx: Contexto, fichaId: string, docId: string): Promise<FichaCompleta> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const r = await c.query(
        `UPDATE documentos_da_pessoa SET excluido_em = now()
          WHERE id = $1 AND ficha_id = $2 AND excluido_em IS NULL`,
        [docId, fichaId],
      )
      if (r.rowCount === 0) throw new NotFoundException('Esse documento não existe mais.')
    })
    return this.ficha(ctx, fichaId)
  }

  /**
   * A tabela do banco de horas: o mês pedido e os cinco anteriores.
   *
   * **Só fichas ativas de contrato com jornada** (CLT e Estágio), como na tela
   * dela. Uma linha de PJ na tabela convidaria alguém a preenchê-la, e o
   * alerta de banco de horas nem olharia para ela.
   */
  async bancoDeHoras(ctx: Contexto, mes: string): Promise<BancoDeHoras> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      const limite = await limiteDeHoras(c)
      const meses = janelaDeMeses(mes)
      const fichas = (
        await c.query<{ id: string; nome: string; cargo: string }>(
          `SELECT id, nome, cargo FROM fichas_de_pessoa
            WHERE excluida_em IS NULL AND ativo AND contrato = ANY($1)
            ORDER BY nome`,
          [[...CONTRATOS_COM_BANCO_DE_HORAS]],
        )
      ).rows

      const lancados = (
        await c.query<LinhaDeHoras>(
          `SELECT ficha_id, mes, saldo_minutos, obs FROM banco_de_horas
            WHERE excluido_em IS NULL AND mes = ANY($1)`,
          [meses],
        )
      ).rows
      const porChave = new Map(lancados.map((l) => [`${l.ficha_id}|${l.mes}`, l] as const))

      const linhas: LinhaDoBancoDeHoras[] = fichas.map((f) => {
        const atual = porChave.get(`${f.id}|${mes}`)
        return {
          fichaId: f.id,
          nome: f.nome,
          cargo: f.cargo,
          anteriores: meses
            .filter((m) => m !== mes)
            .map((m) => ({
              mes: m,
              saldoEmMinutos: porChave.get(`${f.id}|${m}`)?.saldo_minutos ?? null,
            })),
          saldoEmMinutos: atual?.saldo_minutos ?? null,
          obs: atual?.obs ?? '',
        }
      })

      return { mes, limiteDeHorasEmMinutos: limite, linhas }
    })
  }

  /**
   * `horas` — salvar a tabela do mês, **idempotente por esquema**.
   *
   * `ON CONFLICT` sobre o índice único parcial `horas_por_ficha_e_mes`: duas
   * abas salvando o mesmo mês produzem uma linha por pessoa, nunca duas. O
   * protótipo faz `filter` e `push` — leitura-antes-de-escrita, que perde a
   * corrida e deixa dois saldos para o mesmo mês, dos quais a tela mostra o
   * primeiro que achar.
   *
   * `saldoEmMinutos: null` LIMPA o mês, por soft delete.
   */
  async salvarBancoDeHoras(
    ctx: Contexto,
    mes: string,
    dados: SalvarBancoDeHoras,
  ): Promise<BancoDeHoras> {
    await this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      for (const linha of dados.linhas) {
        if (linha.saldoEmMinutos === null) {
          await c.query(
            `UPDATE banco_de_horas SET excluido_em = now()
              WHERE ficha_id = $1 AND mes = $2 AND excluido_em IS NULL`,
            [linha.fichaId, mes],
          )
          continue
        }
        const r = await c.query(
          `INSERT INTO banco_de_horas
             (clinica_id, ficha_id, mes, saldo_minutos, obs, lancado_por)
           SELECT $1, $2, $3, $4, $5, $6
             FROM fichas_de_pessoa f
            WHERE f.id = $2 AND f.excluida_em IS NULL AND f.contrato = ANY($7)
           ON CONFLICT (clinica_id, ficha_id, mes) WHERE excluido_em IS NULL
             DO UPDATE SET saldo_minutos = excluded.saldo_minutos,
                           obs           = excluded.obs,
                           lancado_em    = now(),
                           lancado_por   = excluded.lancado_por`,
          [
            ctx.clinicaId,
            linha.fichaId,
            mes,
            linha.saldoEmMinutos,
            linha.obs,
            ctx.ator,
            [...CONTRATOS_COM_BANCO_DE_HORAS],
          ],
        )
        /**
         * `SELECT … FROM fichas_de_pessoa` em vez de `VALUES`, com o filtro de
         * CONTRATO dentro dele.
         *
         * A ficha de outra clínica (ou excluída) não produz linha nenhuma, e a
         * recusa é explícita em vez de um erro de chave estrangeira. O filtro
         * de contrato está aqui pela mesma razão que a tabela o aplica na
         * leitura: um saldo de banco de horas numa ficha PJ é **dado que
         * nenhuma tela sabe mostrar** — a tabela não a lista e o alerta não a
         * olha —, então ele ficaria no banco sem nunca aparecer, e a próxima
         * conferência de totais acharia uma linha que não deveria existir.
         *
         * `ativo` NÃO entra no filtro de propósito: a pessoa desligada no dia
         * 20 ainda tem o saldo do mês para lançar, e a tabela só a esconde dos
         * meses seguintes.
         *
         * A mensagem distingue os dois casos porque eles têm conserto
         * diferente: "não existe" é id errado; "não tem banco de horas" é
         * contrato.
         */
        if (r.rowCount === 0) {
          const f = await c.query<{ nome: string; contrato: string }>(
            'SELECT nome, contrato FROM fichas_de_pessoa WHERE id = $1 AND excluida_em IS NULL',
            [linha.fichaId],
          )
          const dela = f.rows[0]
          if (dela === undefined) throw new NotFoundException('Uma das fichas não existe mais.')
          throw new UnprocessableEntityException(
            `${dela.nome} tem contrato ${dela.contrato} e não tem banco de horas. ` +
              `Ele vale para ${CONTRATOS_COM_BANCO_DE_HORAS.join(' e ')}.`,
          )
        }
      }
    })
    return this.bancoDeHoras(ctx, mes)
  }

  async configuracao(ctx: Contexto): Promise<ConfiguracaoDePessoal> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => ({
      limiteDeHorasEmMinutos: await limiteDeHoras(c),
    }))
  }

  /** `config` — o `limiteHoras`, e **só** ele. Não é configuração da clínica. */
  async salvarConfiguracao(
    ctx: Contexto,
    dados: SalvarConfiguracaoDePessoal,
  ): Promise<ConfiguracaoDePessoal> {
    return this.banco.naClinica(ctx.clinicaId, ctx.ator, async (c) => {
      await c.query(
        `INSERT INTO configuracao_de_pessoal
           (clinica_id, limite_de_horas_minutos, atualizada_por)
         VALUES ($1, $2, $3)
         ON CONFLICT (clinica_id)
           DO UPDATE SET limite_de_horas_minutos = excluded.limite_de_horas_minutos,
                         atualizada_em = now(),
                         atualizada_por = excluded.atualizada_por`,
        [ctx.clinicaId, dados.limiteDeHorasEmMinutos, ctx.ator],
      )
      return { limiteDeHorasEmMinutos: dados.limiteDeHorasEmMinutos }
    })
  }
}

// ---------------------------------------------------------------------------
// LEITURAS DE APOIO — nenhuma delas decide nada
// ---------------------------------------------------------------------------

/**
 * O limite de alerta da clínica, com o padrão quando ela nunca o tocou.
 *
 * `coalesce` sobre um `SELECT` que pode não ter linha, e o padrão vem do
 * DOMÍNIO (`LIMITE_DE_HORAS_PADRAO_EM_MINUTOS`) — não de um `600` escrito aqui
 * e outro na migration. O `DEFAULT` da coluna e esta constante concordam, e é
 * o teste que cobra.
 */
async function limiteDeHoras(c: pg.PoolClient): Promise<number> {
  const r = await c.query<{ limite: number }>(
    'SELECT limite_de_horas_minutos AS limite FROM configuracao_de_pessoal LIMIT 1',
  )
  return r.rows[0]?.limite ?? LIMITE_DE_HORAS_PADRAO_EM_MINUTOS
}

async function umaFicha(
  c: pg.PoolClient,
  id: string,
  travar = false,
): Promise<LinhaDeFicha> {
  // Sem cláusula de clínica: a RLS já a impõe, e a ficha da vizinha
  // simplesmente não existe vista daqui — `undefined` vira 404.
  const r = await c.query<LinhaDeFicha>(
    `${SELECT_FICHA} AND f.id = $1${travar ? ' FOR UPDATE OF f' : ''}`,
    [id],
  )
  const l = r.rows[0]
  if (l === undefined) throw new NotFoundException('Ficha não encontrada.')
  return l
}

type FeriasComId = FeriasRegistradas & { id: string; situacao: 'programada' | 'gozada' }

async function feriasPorFicha(
  c: pg.PoolClient,
  fichaId?: string,
): Promise<Map<string, FeriasComId[]>> {
  const r = await c.query<LinhaDeFerias>(
    `SELECT id, ficha_id, inicio::text AS inicio, fim::text AS fim, situacao
       FROM ferias_da_pessoa
      WHERE excluida_em IS NULL AND ($1::uuid IS NULL OR ficha_id = $1)
      ORDER BY inicio`,
    [fichaId ?? null],
  )
  return agrupar(r.rows, (l) => l.ficha_id, (l) => ({
    id: l.id,
    inicio: l.inicio,
    fim: l.fim,
    situacao: l.situacao === 'gozada' ? 'gozada' : 'programada',
  }))
}

async function documentosPorFicha(
  c: pg.PoolClient,
  fichaId?: string,
): Promise<Map<string, { id: string; nome: string; validade: string | null }[]>> {
  const r = await c.query<LinhaDeDocumento>(
    `SELECT id, ficha_id, nome, validade::text AS validade
       FROM documentos_da_pessoa
      WHERE excluido_em IS NULL AND ($1::uuid IS NULL OR ficha_id = $1)
      -- Sem validade por último: o alerta é o que importa, e documento sem
      -- validade não gera nenhum.
      ORDER BY validade NULLS LAST, nome`,
    [fichaId ?? null],
  )
  return agrupar(r.rows, (l) => l.ficha_id, (l) => ({
    id: l.id,
    nome: l.nome,
    validade: l.validade,
  }))
}

/**
 * O ÚLTIMO mês lançado de cada ficha — é dele que sai o alerta.
 *
 * `DISTINCT ON` com `ORDER BY mes DESC`: o alerta fala do mês mais recente, e
 * não do pior mês do histórico. Um estouro de março já corrigido em abril não
 * pode continuar aparecendo como alerta vivo.
 */
async function ultimoSaldoPorFicha(
  c: pg.PoolClient,
): Promise<Map<string, { mes: string; saldoEmMinutos: number }>> {
  const r = await c.query<{ ficha_id: string; mes: string; saldo_minutos: number }>(
    `SELECT DISTINCT ON (ficha_id) ficha_id, mes, saldo_minutos
       FROM banco_de_horas WHERE excluido_em IS NULL
      ORDER BY ficha_id, mes DESC`,
  )
  return new Map(
    r.rows.map((l) => [l.ficha_id, { mes: l.mes, saldoEmMinutos: l.saldo_minutos }] as const),
  )
}

/** "Usuários da ferramenta ainda sem ficha", a nota da tela dela. */
async function usuariosSemFicha(
  c: pg.PoolClient,
): Promise<{ pessoaId: string; nome: string; funcao: string }[]> {
  const r = await c.query<{ id: string; nome: string; funcao: string }>(
    `SELECT p.id, p.nome, p.funcao FROM pessoas p
      WHERE p.ativo
        AND NOT EXISTS (SELECT 1 FROM fichas_de_pessoa f
                         WHERE f.pessoa_id = p.id AND f.excluida_em IS NULL)
      ORDER BY p.nome`,
  )
  return r.rows.map((l) => ({ pessoaId: l.id, nome: l.nome, funcao: l.funcao }))
}

function agrupar<L, T>(
  linhas: readonly L[],
  chave: (l: L) => string,
  mapear: (l: L) => T,
): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const l of linhas) {
    const k = chave(l)
    const atual = mapa.get(k)
    if (atual) atual.push(mapear(l))
    else mapa.set(k, [mapear(l)])
  }
  return mapa
}

/** A linha do banco na forma que o DOMÍNIO espera — nada de HTTP aqui. */
const paraAlerta = (
  f: LinhaDeFicha,
  ferias: readonly FeriasRegistradas[],
  documentos: readonly { nome: string; validade: string | null }[],
  ultimo: { mes: string; saldoEmMinutos: number } | undefined,
): PessoaParaAlerta => ({
  contrato: f.contrato,
  admissao: f.admissao,
  ativo: f.ativo,
  ferias,
  documentos,
  ultimoSaldoDeHoras: ultimo ?? null,
})

/** O mês pedido e os cinco anteriores, do mais antigo para o mais recente. */
const janelaDeMeses = (mes: string): string[] =>
  Array.from({ length: MESES_NO_HISTORICO }, (_, i) =>
    somarMeses(`${mes}-01`, i - (MESES_NO_HISTORICO - 1)).slice(0, 7),
  )
