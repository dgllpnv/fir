import type {
  AtualizarCampanhaCarteiraEntrada,
  CampanhaCarteiraNaLista,
  CampanhasDoClienteSaida,
  ComparativoDeCampanhasSaida,
  ConsultaDePeriodoDeCampanhas,
  CriarCampanhaCarteiraEntrada,
  PeriodoDeCampanhasSaida,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import {
  Dinheiro,
  diaCivil,
  ehErro,
  formatarRetorno,
  mesAnterior,
  periodoDeCampanhas,
  resumirCampanhas,
  suprimirCampanhas,
  type CelulaDeCampanha,
  type CelulaExibida,
  type CelulaSuprimida,
  type ErroDeDominio,
  type StatusDeCampanhaCarteira,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { BancoService } from '../../banco/banco.service'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { gravarAuditoriaDaCarteira } from '../financeiro/auditoria-da-carteira'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'
import { umPorClinica, umaPorCampanhaEMes } from '../um-por-clinica'

export class ClienteDaCampanhaNaoEncontrado extends Error {}
export class CampanhaCarteiraNaoEncontrada extends Error {}
/** K3: campanha à mão só para cliente SEM clínica ligada — "uma tela, duas fontes" (ADR 0011). */
export class ClienteComCampanhasDaClinica extends Error {}
/** Linha sincronizada: o resto vem da clínica e a próxima sincronização sobrescreveria. */
export class CampoDaCampanhaSincronizada extends Error {}
export class PeriodoInvalido extends Error {
  constructor(readonly erro: ErroDeDominio) {
    super(erro.mensagem)
  }
}

type Linha = {
  id: string
  cliente_carteira_id: string
  campanha_origem_id: string | null
  origem: 'sincronizada' | 'manual'
  nome: string
  categoria: string
  mes: string
  status: StatusDeCampanhaCarteira
  metrica: string
  meta: string | null
  resultado: string | null
  receita_centavos: string | null
  investimento_centavos: string | null
  orcamentos_pagos: number | null
  rotulo_da_metrica: string
  observacoes: string
}

type ClienteVisivel = {
  id: string
  nome: string
  status: string
  clinica_id: string | null
  conta_na_receita: boolean
  sincronizado_em: Date | null
}

const COLUNAS = `cc.id, cc.cliente_carteira_id, cc.campanha_origem_id, cc.origem, cc.nome, cc.categoria,
  cc.mes_referencia::text AS mes, cc.status, cc.metrica, cc.meta::text AS meta, cc.resultado::text AS resultado,
  cc.receita_centavos::text AS receita_centavos, cc.investimento_centavos::text AS investimento_centavos,
  cc.orcamentos_pagos, cc.rotulo_da_metrica, cc.observacoes`

/**
 * O filtro de grupo da APLICAÇÃO — a segunda camada (regra 19). A primeira é a
 * RLS de `app_pode_ver_grupo`, fixada por `nasTabelasDaCarteiraComEscopo` a
 * partir da sessão. `$1` é o escopo, `$2` o grupo.
 */
const DO_GRUPO = `($1::text = 'geral' OR cl.grupo_id = $2::uuid)`

const dinheiro = (v: string | null): Dinheiro | null => (v === null ? null : Dinheiro.deCentavos(BigInt(v)))
const texto = (d: Dinheiro | null): string | null => (d === null ? null : d.centavos.toString())
const retornoEmTexto = (d: bigint | null): string | null => (d === null ? null : formatarRetorno(d))

/**
 * Hoje o cadastro do cliente não tem segmento (inventário C3 traz o campo),
 * então todo cliente é tratado como de saúde: a campanha sem contagem de
 * pagamentos é suprimida (LGPD A24, a leitura segura). Quando o segmento
 * existir, é aqui — e só aqui — que "indústria" e "imobiliária" passam a
 * dispensar a contagem.
 */
const celula = (l: Linha): CelulaDeCampanha => ({
  id: l.id,
  clienteId: l.cliente_carteira_id,
  campanhaChave: l.campanha_origem_id ?? l.id,
  nome: l.nome,
  tipo: l.categoria,
  mes: l.mes,
  status: l.status,
  receita: dinheiro(l.receita_centavos),
  investimento: dinheiro(l.investimento_centavos),
  orcamentosPagos: l.orcamentos_pagos,
  exigeContagem: true,
  resultado: l.resultado === null ? null : BigInt(l.resultado),
  meta: l.meta === null ? null : BigInt(l.meta),
  resultadoEmDinheiro: l.metrica === 'receita',
})

function naLista(c: CelulaExibida | CelulaSuprimida, l: Linha): CampanhaCarteiraNaLista {
  const meta = c.meta
  const exibida = c.suprimida ? null : c
  return {
    id: c.id,
    clienteCarteiraId: c.clienteId,
    origem: l.origem,
    nome: c.nome,
    tipo: c.tipo,
    mes: c.mes,
    status: c.status,
    rotuloDaMetrica: l.rotulo_da_metrica,
    suprimida: c.suprimida,
    receita: exibida === null ? null : texto(exibida.receita),
    investimento: texto(c.investimento),
    retornoSobreInvestimento: exibida === null ? null : retornoEmTexto(exibida.retornoEmDecimos),
    resultadoEmNumero:
      exibida === null || exibida.resultadoEmDinheiro || exibida.resultado === null ? null : Number(exibida.resultado),
    resultadoEmDinheiro:
      exibida === null || !exibida.resultadoEmDinheiro || exibida.resultado === null ? null : exibida.resultado.toString(),
    metaEmNumero: meta === null || c.resultadoEmDinheiro ? null : Number(meta),
    metaEmDinheiro: meta === null || !c.resultadoEmDinheiro ? null : meta.toString(),
    percentualDaMeta: exibida === null ? null : exibida.percentualDaMeta,
    orcamentosPagos: exibida === null ? null : exibida.orcamentosPagos,
    observacoes: l.observacoes,
    editavel: l.origem === 'manual' ? 'tudo' : 'investimento_e_observacoes',
  }
}

/** A fotografia que vai para `auditoria_da_carteira` — com os NOMES da API, para a redação reconhecer os monetários se um dia a trilha for lida por rota. */
const fotografia = (l: Linha) => ({
  nome: l.nome,
  tipo: l.categoria,
  mes: l.mes,
  status: l.status,
  rotuloDaMetrica: l.rotulo_da_metrica,
  meta: l.meta,
  resultado: l.resultado,
  receita: l.receita_centavos,
  investimento: l.investimento_centavos,
  orcamentosPagos: l.orcamentos_pagos,
  observacoes: l.observacoes,
})

/**
 * **Campanhas da carteira** — leitura (K1, V9) e lançamento à mão (K3).
 *
 * Toda leitura passa por `suprimirCampanhas` antes de virar resposta, e todo
 * número agregado sai de `resumirCampanhas` (LGPD A20): este serviço não soma
 * receita nenhuma por conta própria. A redação de valores (`valores`) é do
 * `RedacaoInterceptor`, num ponto único — os nomes monetários estão em
 * `CAMPOS_MONETARIOS`.
 */
@Injectable()
export class CampanhasCarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  private noEscopo<T>(usuario: UsuarioDeGestaoPublico, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    return this.banco.nasTabelasDaCarteiraComEscopo(usuario.escopo, usuario.grupoId, fn)
  }

  private periodo(consulta: ConsultaDePeriodoDeCampanhas): PeriodoDeCampanhasSaida {
    const hoje = diaCivil(this.relogio.agora(), FUSO_DA_CARTEIRA)
    // "Ciclo do contrato" precisa de início e fim cadastrados; o cadastro do
    // cliente ainda não os tem (C3), então o domínio cai em 3 meses — como o
    // protótipo faz quando falta `data_inicio` (L1445, L1964).
    const r = periodoDeCampanhas(consulta.periodo, hoje, { de: consulta.de, ate: consulta.ate })
    if (ehErro(r)) throw new PeriodoInvalido(r.erro)
    const chave = consulta.periodo === 'ciclo' ? '3m' : consulta.periodo
    return { chave, de: r.valor.de, ate: r.valor.ate, meses: [...r.valor.meses], mesAtual: `${hoje.slice(0, 7)}-01`, hoje, fuso: FUSO_DA_CARTEIRA }
  }

  private clientesVisiveis(c: pg.PoolClient, usuario: UsuarioDeGestaoPublico): Promise<pg.QueryResult<ClienteVisivel>> {
    return c.query<ClienteVisivel>(
      `SELECT cl.id::text AS id, cl.nome, cl.status, cl.clinica_id::text AS clinica_id, cl.conta_na_receita, s.sincronizado_em
         FROM clientes_carteira cl
         LEFT JOIN sincronizacao_campanhas_carteira s ON s.cliente_carteira_id = cl.id
        WHERE cl.excluido_em IS NULL AND ${DO_GRUPO}
        ORDER BY cl.nome`,
      [usuario.escopo, usuario.grupoId],
    )
  }

  /** K1 — a tela comparativa de todas as clientes visíveis (`vCampanhas`). */
  async comparativo(
    usuario: UsuarioDeGestaoPublico,
    consulta: ConsultaDePeriodoDeCampanhas,
  ): Promise<ComparativoDeCampanhasSaida> {
    const periodo = this.periodo(consulta)
    const anterior = mesAnterior(periodo.mesAtual)
    const { linhas: todasAsLinhas, clientes: todosOsClientes } = await this.noEscopo(usuario, async (c) => {
      const linhas = await c.query<Linha & { dono_conta_na_receita: boolean }>(
        `SELECT ${COLUNAS}, cl.conta_na_receita AS dono_conta_na_receita
           FROM campanhas_carteira cc
           JOIN clientes_carteira cl ON cl.id = cc.cliente_carteira_id
          WHERE cl.excluido_em IS NULL AND ${DO_GRUPO}
            AND (cc.mes_referencia BETWEEN $3::date AND $4::date OR cc.mes_referencia IN ($5::date, $6::date)
                 OR cc.status = 'ativa')`,
        [usuario.escopo, usuario.grupoId, periodo.de, periodo.ate, periodo.mesAtual, anterior],
      )
      return { linhas: linhas.rows, clientes: (await this.clientesVisiveis(c, usuario)).rows }
    })
    // A clínica em 2+ grupos tem um Cliente Firmare por grupo, e a MESMA
    // campanha real pode estar nos dois (0068): no `geral` ela entra uma vez
    // por (campanha, mês), preferindo a cópia do cliente que conta na receita —
    // senão valor gerado, investimento e ROI saem em dobro. As contagens de
    // clientes são por clínica.
    const linhas = umaPorCampanhaEMes(todasAsLinhas)
    const clientes = umPorClinica(todosOsClientes)
    const supressao = suprimirCampanhas(linhas.map(celula))
    const r = resumirCampanhas(supressao, { de: periodo.de, ate: periodo.ate, mesAtual: periodo.mesAtual, mesAnterior: anterior })
    const porId = new Map(todosOsClientes.map((x) => [x.id, x]))
    const rotuloPorId = new Map(linhas.map((l) => [l.id, l.rotulo_da_metrica]))
    const ligados = clientes.filter((x) => x.status === 'ativo' || x.status === 'onboarding')

    return {
      periodo,
      kpis: {
        mesAtual: { valorGerado: texto(r.mesAtual.valorGerado) },
        mesAnterior: r.mesAnterior === null ? null : { valorGerado: texto(r.mesAnterior.valorGerado) },
        periodo: {
          valorGerado: texto(r.periodo.valorGerado),
          investimento: texto(r.periodo.investimento),
          retornoSobreInvestimento: retornoEmTexto(r.periodo.retornoEmDecimos),
        },
        ativas: r.ativas,
        clientesAtualizandoSozinhos: ligados.filter((x) => x.clinica_id !== null).length,
      },
      porCliente: r.porCliente.map((x) => ({
        clienteCarteiraId: x.clienteId,
        nome: porId.get(x.clienteId)?.nome ?? '',
        ligadoAClinica: (porId.get(x.clienteId)?.clinica_id ?? null) !== null,
        meses: x.meses.map((m) => ({ mes: m.mes, valorGerado: texto(m.valorGerado) })),
        valorGerado: texto(x.valorGerado),
        retornoSobreInvestimento: retornoEmTexto(x.retornoEmDecimos),
        melhor: x.melhor === null ? null : { nome: x.melhor.nome, mes: x.melhor.mes, valorGerado: texto(x.melhor.valorGerado) },
      })),
      maisGeraram: r.maisGeraram.map((x) => ({
        id: x.id,
        clienteCarteiraId: x.clienteId,
        nomeDoCliente: porId.get(x.clienteId)?.nome ?? '',
        nome: x.nome,
        mes: x.mes,
        valorGerado: texto(x.valorGerado),
        resultadoEmNumero: x.resultadoEmDinheiro || x.resultado === null ? null : Number(x.resultado),
        resultadoEmDinheiro: !x.resultadoEmDinheiro || x.resultado === null ? null : x.resultado.toString(),
        rotuloDaMetrica: rotuloPorId.get(x.id) ?? '',
        retornoSobreInvestimento: retornoEmTexto(x.retornoEmDecimos),
      })),
      porTipo: r.porTipo.map((t) => ({
        tipo: t.tipo,
        clientes: t.clientes,
        meses: t.meses.map((m) => ({ mes: m.mes, valorGerado: texto(m.valorGerado) })),
      })),
      atualizacao: ligados.map((x) => ({
        clienteCarteiraId: x.id,
        nome: x.nome,
        ligadoAClinica: x.clinica_id !== null,
        sincronizadoEm: x.sincronizado_em === null ? null : x.sincronizado_em.toISOString(),
      })),
      outras: r.outras,
      soDasExibidas: r.soDasExibidas,
    }
  }

  /** V9 — a aba Campanhas da ficha do cliente (`cCampanhas`). */
  async doCliente(
    usuario: UsuarioDeGestaoPublico,
    clienteId: string,
    consulta: ConsultaDePeriodoDeCampanhas,
  ): Promise<CampanhasDoClienteSaida> {
    const periodo = this.periodo(consulta)
    const { cliente, linhas } = await this.noEscopo(usuario, async (c) => {
      const cliente = (await this.clientesVisiveis(c, usuario)).rows.find((x) => x.id === clienteId)
      if (cliente === undefined) throw new ClienteDaCampanhaNaoEncontrado()
      // As do período, e as PLANEJADAS depois dele quando o período termina
      // no mês corrente (L1446): o que vem por aí aparece junto.
      const linhas = await c.query<Linha>(
        `SELECT ${COLUNAS}
           FROM campanhas_carteira cc
           JOIN clientes_carteira cl ON cl.id = cc.cliente_carteira_id
          WHERE cl.excluido_em IS NULL AND ${DO_GRUPO} AND cc.cliente_carteira_id = $3
            AND (cc.mes_referencia BETWEEN $4::date AND $5::date
                 OR cc.mes_referencia = $6::date
                 OR (cc.status = 'planejada' AND cc.mes_referencia > $5::date AND $5::date = $6::date))`,
        [usuario.escopo, usuario.grupoId, clienteId, periodo.de, periodo.ate, periodo.mesAtual],
      )
      return { cliente, linhas: linhas.rows }
    })

    const supressao = suprimirCampanhas(linhas.map(celula))
    const r = resumirCampanhas(supressao, {
      de: periodo.de,
      ate: periodo.ate,
      mesAtual: periodo.mesAtual,
      mesAnterior: mesAnterior(periodo.mesAtual),
    })
    const linhaPorId = new Map(linhas.map((l) => [l.id, l]))
    const visiveis = supressao.celulas
      .filter((c) => (c.mes >= periodo.de && c.mes <= periodo.ate) || (c.status === 'planejada' && c.mes > periodo.ate))
      .sort((a, b) => b.mes.localeCompare(a.mes) || a.nome.localeCompare(b.nome, 'pt-BR'))

    return {
      periodo,
      cliente: {
        id: cliente.id,
        nome: cliente.nome,
        ligadoAClinica: cliente.clinica_id !== null,
        sincronizadoEm: cliente.sincronizado_em === null ? null : cliente.sincronizado_em.toISOString(),
      },
      campanhas: visiveis.map((c) => naLista(c, linhaPorId.get(c.id)!)),
      kpis: {
        periodo: {
          valorGerado: texto(r.periodo.valorGerado),
          investimento: texto(r.periodo.investimento),
          retornoSobreInvestimento: retornoEmTexto(r.periodo.retornoEmDecimos),
        },
        mesAtual: { valorGerado: texto(r.mesAtual.valorGerado) },
      },
      outras: r.outras,
      soDasExibidas: r.soDasExibidas,
    }
  }

  /** K3 — campanha lançada à mão, só para cliente sem clínica ligada. */
  async criar(usuario: UsuarioDeGestaoPublico, dados: CriarCampanhaCarteiraEntrada): Promise<CampanhaCarteiraNaLista> {
    return this.noEscopo(usuario, async (c) => {
      const cliente = (
        await c.query<{ id: string; grupo_id: string; clinica_id: string | null }>(
          `SELECT cl.id, cl.grupo_id::text AS grupo_id, cl.clinica_id::text AS clinica_id
             FROM clientes_carteira cl
            WHERE cl.id = $3 AND cl.excluido_em IS NULL AND ${DO_GRUPO}`,
          [usuario.escopo, usuario.grupoId, dados.clienteCarteiraId],
        )
      ).rows[0]
      if (cliente === undefined) throw new ClienteDaCampanhaNaoEncontrado()
      if (cliente.clinica_id !== null) throw new ClienteComCampanhasDaClinica()

      const mes = `${dados.mes}-01`
      const r = await c.query<Linha>(
        `WITH nova AS (
           INSERT INTO campanhas_carteira (
             cliente_carteira_id, grupo_id, origem, nome, periodo_inicio, periodo_fim, metrica, meta, resultado,
             mes_referencia, receita_centavos, investimento_centavos, orcamentos_pagos, categoria, status,
             rotulo_da_metrica, observacoes
           ) VALUES ($1, $2, 'manual', $3, $4::date, ($4::date + interval '1 month - 1 day')::date, 'tipo', $5, $6,
                     $4::date, $7, $8, $9, $10, $11, $12, $13)
           RETURNING *
         )
         SELECT ${COLUNAS} FROM nova cc`,
        [
          cliente.id,
          cliente.grupo_id,
          dados.nome,
          mes,
          dados.metaEmNumero,
          dados.resultadoEmNumero,
          dados.receita === null ? null : dados.receita.toString(),
          dados.investimento === null ? null : dados.investimento.toString(),
          dados.orcamentosPagos,
          dados.tipo,
          dados.status,
          dados.rotuloDaMetrica,
          dados.observacoes,
        ],
      )
      const linha = r.rows[0]!
      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: usuario.id,
        grupoId: cliente.grupo_id,
        tabela: 'campanhas_carteira',
        registroId: linha.id,
        acao: 'criar',
        de: null,
        para: fotografia(linha),
      })
      return this.umaNaLista(linha)
    })
  }

  /**
   * K3 e o investimento (D-22 item 9). Campo ausente não muda; nos dois
   * monetários, `null` também não muda (gate de segurança A-6: a tela sem
   * `valores` recebe `null` e pode reenviá-lo).
   */
  async atualizar(
    usuario: UsuarioDeGestaoPublico,
    id: string,
    dados: AtualizarCampanhaCarteiraEntrada,
  ): Promise<CampanhaCarteiraNaLista> {
    return this.noEscopo(usuario, async (c) => {
      const atual = (
        await c.query<Linha & { grupo_id: string }>(
          `SELECT ${COLUNAS}, cc.grupo_id::text AS grupo_id
             FROM campanhas_carteira cc
             JOIN clientes_carteira cl ON cl.id = cc.cliente_carteira_id
            WHERE cc.id = $3 AND cl.excluido_em IS NULL AND ${DO_GRUPO}
            FOR UPDATE OF cc`,
          [usuario.escopo, usuario.grupoId, id],
        )
      ).rows[0]
      if (atual === undefined) throw new CampanhaCarteiraNaoEncontrada()

      const sets: string[] = []
      const valores: unknown[] = []
      const definir = (coluna: string, valor: unknown, molde = '') => {
        valores.push(valor)
        sets.push(`${coluna} = $${valores.length}${molde}`)
      }

      const soDaEquipe = new Set(['investimento', 'observacoes'])
      if (atual.origem === 'sincronizada') {
        const proibidos = Object.entries(dados).filter(([k, v]) => v !== undefined && !soDaEquipe.has(k))
        if (proibidos.length > 0) throw new CampoDaCampanhaSincronizada()
      }

      if (dados.investimento !== undefined && dados.investimento !== null) {
        definir('investimento_centavos', dados.investimento.toString())
      }
      if (dados.observacoes !== undefined) definir('observacoes', dados.observacoes)
      if (dados.receita !== undefined && dados.receita !== null) definir('receita_centavos', dados.receita.toString())
      if (dados.nome !== undefined) definir('nome', dados.nome)
      if (dados.tipo !== undefined) definir('categoria', dados.tipo)
      if (dados.rotuloDaMetrica !== undefined) definir('rotulo_da_metrica', dados.rotuloDaMetrica)
      if (dados.metaEmNumero !== undefined) definir('meta', dados.metaEmNumero)
      if (dados.resultadoEmNumero !== undefined) definir('resultado', dados.resultadoEmNumero)
      if (dados.orcamentosPagos !== undefined) definir('orcamentos_pagos', dados.orcamentosPagos)
      if (dados.status !== undefined) definir('status', dados.status)
      if (dados.mes !== undefined) {
        definir('mes_referencia', `${dados.mes}-01`, '::date')
        sets.push(`periodo_inicio = $${valores.length}::date`)
        sets.push(`periodo_fim = ($${valores.length}::date + interval '1 month - 1 day')::date`)
      }
      if (sets.length === 0) return this.umaNaLista(atual)

      valores.push(id)
      const r = await c.query<Linha>(
        `WITH alterada AS (
           UPDATE campanhas_carteira SET ${sets.join(', ')}, atualizado_em = now()
            WHERE id = $${valores.length}
           RETURNING *
         )
         SELECT ${COLUNAS} FROM alterada cc`,
        valores,
      )
      const linha = r.rows[0]!
      await gravarAuditoriaDaCarteira(c, {
        usuarioGestaoId: usuario.id,
        grupoId: atual.grupo_id,
        tabela: 'campanhas_carteira',
        registroId: id,
        acao: 'atualizar',
        de: fotografia(atual),
        para: fotografia(linha),
      })
      return this.umaNaLista(linha)
    })
  }

  /** A linha escrita volta pela MESMA supressão da leitura — escrever não é atalho para ver. */
  private umaNaLista(l: Linha): CampanhaCarteiraNaLista {
    const s = suprimirCampanhas([celula(l)])
    return naLista(s.celulas[0]!, l)
  }
}
