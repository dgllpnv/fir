import type {
  CriarIndicadorDoClienteEntrada,
  IndicadorDoCliente,
  IndicadoresDoClienteSaida,
  LancarSemanaDosIndicadoresEntrada,
  PontoDoIndicador,
  SemanaDosIndicadoresLancadaSaida,
  UnidadeDeIndicadorCarteira,
} from '@fir/contracts'
import { arredondarRacionalDaPlanilha, diaCivil, segundaDaSemana, somarDias } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import { gravarAuditoriaDaCarteira } from './auditoria-da-carteira'
import {
  EntradaInvalidaNaMeta,
  NaoEncontradoNaMeta,
  type Sessao,
  clienteDaMeta,
  exigirSegunda,
  exigirValores,
  valorDaUnidade,
} from './metas-comum'
import { upsertLancamento } from './metas-do-cliente.service'
import { podeVerValoresDaCarteira } from '../prospeccao/leads.permissoes'

type LinhaIndicador = {
  id: string
  nome: string
  unidade: UnidadeDeIndicadorCarteira
  sentido: 'maior_melhor' | 'menor_melhor'
  meta_centavos: string | null
  meta_inteiro: string | null
}
type LinhaLancamento = { indicador_id: string; referencia: string; valor_centavos: string | null; valor_inteiro: string | null }

const ponto = (l: LinhaLancamento): PontoDoIndicador => ({
  referencia: l.referencia,
  valor: l.valor_centavos,
  valorInteiro: l.valor_inteiro,
})

/**
 * O cartão de um indicador (`cIndicadoresManual`, L1520-1528), calculado no
 * servidor. A tela só formata.
 *
 * - "Na meta"/"Abaixo" só com meta cadastrada E lançamento (ajuste 22: o
 *   protótipo compara com `undefined` e mostra "Abaixo").
 * - Variação contra a segunda IMEDIATAMENTE anterior (`referência − 7`),
 *   nunca o penúltimo lançamento, que pula lacunas (ajuste 22). Em décimos de
 *   ponto, `(u − p)·1000/p`, meio para longe do zero — o mesmo arredondamento
 *   da planilha (`arredondarRacionalDaPlanilha`), exato até o fim.
 */
export function cartaoDoIndicador(i: LinhaIndicador, lancamentos: readonly LinhaLancamento[]): IndicadorDoCliente {
  const ordenados = [...lancamentos].sort((a, b) => (a.referencia < b.referencia ? -1 : a.referencia > b.referencia ? 1 : 0))
  const ultimo = ordenados.at(-1) ?? null
  const valorDe = (l: LinhaLancamento): bigint => BigInt(l.valor_centavos ?? l.valor_inteiro ?? '0')
  const metaTexto = i.meta_centavos ?? i.meta_inteiro
  let naMeta: boolean | null = null
  if (ultimo !== null && metaTexto !== null) {
    const u = valorDe(ultimo)
    const meta = BigInt(metaTexto)
    naMeta = i.sentido === 'menor_melhor' ? u <= meta : u >= meta
  }
  let variacaoEmDecimos: number | null = null
  let semVariacao: IndicadorDoCliente['semVariacao'] = null
  if (ultimo !== null) {
    const anterior = ordenados.find((l) => l.referencia === somarDias(ultimo.referencia, -7))
    if (anterior === undefined) semVariacao = 'sem_semana_anterior'
    else if (valorDe(anterior) === 0n) semVariacao = 'anterior_zero'
    else {
      const u = valorDe(ultimo)
      const p = valorDe(anterior)
      variacaoEmDecimos = Number(arredondarRacionalDaPlanilha({ num: (u - p) * 1000n, den: p }))
    }
  }
  return {
    id: i.id,
    nome: i.nome,
    unidade: i.unidade,
    sentido: i.sentido,
    valorMeta: i.meta_centavos,
    valorMetaInteiro: i.meta_inteiro,
    serie: ordenados.slice(-8).map(ponto),
    ultimo: ultimo === null ? null : ponto(ultimo),
    naMeta,
    variacaoEmDecimos,
    semVariacao,
  }
}

/**
 * Num indicador em R$, "Na meta" e a variação semanal são derivados do valor:
 * "+2,6% de receita na semana" revela a receita a quem não tem `valores`. A
 * redação por nome de campo apaga só os números; estes dois saem aqui (regra 17:
 * o percentual atravessa só na meta do mês).
 */
export function semDerivadosDeDinheiro(cartao: IndicadorDoCliente, veValores: boolean): IndicadorDoCliente {
  if (veValores || cartao.unidade !== 'R$') return cartao
  return { ...cartao, naMeta: null, variacaoEmDecimos: null, semVariacao: null }
}

/**
 * **V10 — Indicadores manuais da cliente** (`cIndicadoresManual`,
 * `novoIndicador`, `lancar`, L1520-1530, L2970-2973).
 */
@Injectable()
export class IndicadoresDoClienteService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async listar(sessao: Sessao, clienteId: string): Promise<IndicadoresDoClienteSaida> {
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDaMeta(c, clienteId)
      const ind = await c.query<LinhaIndicador>(
        `SELECT id, nome, unidade, sentido, meta_centavos::text AS meta_centavos, meta_inteiro::text AS meta_inteiro
           FROM indicadores_carteira
          WHERE cliente_carteira_id = $1 AND excluido_em IS NULL AND ativo
          ORDER BY criado_em`,
        [cliente.id],
      )
      const ids = ind.rows.map((i) => i.id)
      const lanc =
        ids.length === 0
          ? []
          : (
              await c.query<LinhaLancamento>(
                `SELECT indicador_id, referencia::text AS referencia,
                        valor_centavos::text AS valor_centavos, valor_inteiro::text AS valor_inteiro
                   FROM lancamentos_de_indicador WHERE indicador_id = ANY($1)`,
                [ids],
              )
            ).rows
      const hoje = diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
      return {
        hoje,
        semanaAtual: segundaDaSemana(hoje),
        indicadores: ind.rows.map((i) =>
          semDerivadosDeDinheiro(cartaoDoIndicador(i, lanc.filter((l) => l.indicador_id === i.id)), podeVerValoresDaCarteira(sessao)),
        ),
      }
    })
  }

  async criar(sessao: Sessao, clienteId: string, dto: CriarIndicadorDoClienteEntrada): Promise<IndicadorDoCliente> {
    exigirValores(sessao, dto.valorMeta != null)
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDaMeta(c, clienteId)
      const meta =
        dto.valorMeta == null && dto.valorMetaInteiro == null
          ? { centavos: null, inteiro: null }
          : valorDaUnidade(dto.unidade, dto.valorMeta, dto.valorMetaInteiro)
      const r = await c.query<LinhaIndicador & Record<string, unknown>>(
        `INSERT INTO indicadores_carteira (cliente_carteira_id, grupo_id, nome, unidade, sentido, meta_centavos, meta_inteiro)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, nome, unidade, sentido, meta_centavos::text AS meta_centavos, meta_inteiro::text AS meta_inteiro`,
        [cliente.id, cliente.grupo_id, dto.nome, dto.unidade, dto.sentido, meta.centavos, meta.inteiro],
      )
      const linha = r.rows[0]!
      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: sessao.id,
        grupoId: cliente.grupo_id,
        tabela: 'indicadores_carteira',
        registroId: linha.id,
        acao: 'criar',
        de: null,
        para: linha,
      })
      return cartaoDoIndicador(linha, [])
    })
  }

  /** "Lançar semana": todos de uma vez, upsert por `(indicador, segunda)` — três envios, uma linha cada. */
  async lancarSemana(sessao: Sessao, clienteId: string, dto: LancarSemanaDosIndicadoresEntrada): Promise<SemanaDosIndicadoresLancadaSaida> {
    exigirSegunda(dto.referencia)
    exigirValores(sessao, dto.valores.some((v) => v.valor != null))
    const ids = dto.valores.map((v) => v.indicadorId)
    if (new Set(ids).size !== ids.length) throw new EntradaInvalidaNaMeta('INDICADOR_REPETIDO', 'Cada indicador aparece uma vez.')
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(sessao, async (c) => {
      const cliente = await clienteDaMeta(c, clienteId)
      const ind = await c.query<{ id: string; unidade: string }>(
        `SELECT id, unidade FROM indicadores_carteira
          WHERE id = ANY($1) AND cliente_carteira_id = $2 AND excluido_em IS NULL`,
        [ids, cliente.id],
      )
      if (ind.rows.length !== ids.length) throw new NaoEncontradoNaMeta()
      for (const v of dto.valores) {
        const i = ind.rows.find((x) => x.id === v.indicadorId)!
        await upsertLancamento(c, sessao.id, cliente.grupo_id, i.id, dto.referencia, valorDaUnidade(i.unidade, v.valor, v.valorInteiro))
      }
      return { lancados: dto.valores.length }
    })
  }
}
