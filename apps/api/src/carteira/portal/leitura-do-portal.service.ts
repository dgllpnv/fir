import type { ClienteNoPortal, CobrancaCarteiraNaLista, MetaComercialNaLista, UsuarioDoPortalPublico } from '@fir/contracts'
import { Dinheiro, agruparCampanhasComSupressao, mesesJuntos } from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import { usuarioPortalIdDeFonteConfiavel } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../../banco/clinica-id'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { AuditoriaService } from '../../auditoria/auditoria.service'
import { lancamentoNaLista } from '../financeiro/indicadores.service'

type LinhaCliente = {
  id: string
  clinica_id: string
  nome: string
  produto: string
  status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado'
  criado_em: Date
}

type LinhaCampanha = {
  id: string
  cliente_carteira_id: string
  nome: string
  resultado: string | null
  orcamentos_pagos: number | null
}

type LinhaMeta = {
  id: string
  cliente_carteira_id: string
  indicador_id: string
  titulo: string
  sentido: 'maior_melhor' | 'menor_melhor'
  valor_meta_centavos: string | null
  valor_meta_inteiro: string | null
  valor_inicial_centavos: string | null
  valor_inicial_inteiro: string | null
  inicio: string
  prazo: string
  status: 'em_andamento' | 'concluida'
  ultimo_id: string | null
  ultimo_indicador_id: string | null
  ultimo_referencia: string | null
  ultimo_valor_centavos: string | null
  ultimo_valor_inteiro: string | null
  ultimo_observacao: string | null
  ultimo_lancado_por: string | null
}

const metaNaLista = (l: LinhaMeta): MetaComercialNaLista => ({
  id: l.id,
  clienteCarteiraId: l.cliente_carteira_id,
  indicadorId: l.indicador_id,
  titulo: l.titulo,
  sentido: l.sentido,
  valorMeta: l.valor_meta_centavos,
  valorMetaInteiro: l.valor_meta_inteiro,
  valorInicial: l.valor_inicial_centavos,
  valorInicialInteiro: l.valor_inicial_inteiro,
  inicio: l.inicio,
  prazo: l.prazo,
  status: l.status,
  ultimoLancamento:
    l.ultimo_id === null
      ? null
      : lancamentoNaLista({
          id: l.ultimo_id,
          indicador_id: l.ultimo_indicador_id!,
          referencia: l.ultimo_referencia!,
          valor_centavos: l.ultimo_valor_centavos,
          valor_inteiro: l.ultimo_valor_inteiro,
          observacao: l.ultimo_observacao,
          lancado_por: l.ultimo_lancado_por!,
        }),
})

type LinhaCobranca = {
  id: string
  cliente_carteira_id: string
  competencia: string
  mensalidade_centavos: string
  desconto_centavos: string
  valor_centavos: string
  vencimento: string
  status: 'aberto' | 'pago' | 'cancelado'
  pago_em: Date | null
}

const cobrancaNaLista = (l: LinhaCobranca): CobrancaCarteiraNaLista => ({
  id: l.id,
  clienteCarteiraId: l.cliente_carteira_id,
  competencia: l.competencia,
  mensalidade: l.mensalidade_centavos,
  desconto: l.desconto_centavos,
  valor: l.valor_centavos,
  vencimento: l.vencimento,
  status: l.status,
  pagoEm: l.pago_em ? l.pago_em.toISOString() : null,
})

type LinhaDocumento = { id: string; cliente_carteira_id: string; titulo: string; categoria: string; link: string; data: string }
type LinhaMaterial = { id: string; cliente_carteira_id: string; titulo: string; tipo: string; descricao: string | null; link: string | null }
type LinhaReuniao = { id: string; cliente_carteira_id: string; data: string; resumo: string; encaminhamentos: string | null }

/**
 * A LEITURA agregada do Portal do Grupo (spec §3.1, G6 núcleo).
 *
 * Tudo numa ÚNICA conexão `fir_portal` (RLS filtra por `app_portal_pode_ver`,
 * nenhum `WHERE grupo_id`/`cliente_carteira_id` no código — mesmo desenho de
 * `CarteiraService.clientes`), e DEPOIS uma linha de ACESSO por `Clinica`
 * incluída na resposta, na conexão `fir_app` de CADA clínica (ADR 0017 §5,
 * ADR 0018 critério 5 e 10): é a clínica, individualmente, que tem o direito
 * de saber quem do seu lado comercial olhou o quê.
 */
@Injectable()
export class LeituraDoPortalService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async clientes(usuarioDoPortal: UsuarioDoPortalPublico): Promise<ClienteNoPortal[]> {
    const escopo = {
      escopo: usuarioDoPortal.escopo,
      clienteCarteiraId: usuarioDoPortal.clienteCarteiraId,
      grupoId: usuarioDoPortal.grupoId,
    }

    const dados = await this.banco.nasTabelasDaCarteiraComoPortal(escopo, async (c) => {
      const clientes = await c.query<LinhaCliente>(
        `SELECT id, clinica_id, nome, produto, status, criado_em
           FROM clientes_carteira
          WHERE excluido_em IS NULL
          ORDER BY nome`,
      )
      const ids = clientes.rows.map((x) => x.id)
      if (ids.length === 0) return { clientes: clientes.rows, campanhas: [], metas: [], cobrancas: [], documentos: [], materiais: [], reunioes: [] }

      // `metrica = 'receita'` apenas: é o único caso coberto pela base legal
      // descrita (ADR 0013 §3, "receita agregada por campanha") — as demais
      // métricas (contatos/convertidos/tipo) não são dinheiro, e misturá-las
      // ao somatório de "Outras campanhas" confundiria conta com contagem.
      const campanhas = await c.query<LinhaCampanha>(
        `SELECT id, cliente_carteira_id, nome, resultado::text AS resultado, orcamentos_pagos
           FROM campanhas_carteira
          WHERE cliente_carteira_id = ANY($1) AND metrica = 'receita'
          ORDER BY periodo_inicio DESC`,
        [ids],
      )

      const metas = await c.query<LinhaMeta>(
        `SELECT m.*,
                l.id AS ultimo_id,
                l.indicador_id AS ultimo_indicador_id,
                l.referencia::text AS ultimo_referencia,
                l.valor_centavos::text AS ultimo_valor_centavos,
                l.valor_inteiro::text AS ultimo_valor_inteiro,
                l.observacao AS ultimo_observacao,
                l.lancado_por AS ultimo_lancado_por
           FROM metas_comerciais m
           LEFT JOIN LATERAL (
             SELECT * FROM lancamentos_de_indicador
              WHERE indicador_id = m.indicador_id
              ORDER BY referencia DESC
              LIMIT 1
           ) l ON true
          WHERE m.cliente_carteira_id = ANY($1) AND m.excluido_em IS NULL
          ORDER BY m.criado_em DESC`,
        [ids],
      )

      const cobrancas = await c.query<LinhaCobranca>(
        `SELECT id, cliente_carteira_id, competencia::text AS competencia,
                mensalidade_centavos::text AS mensalidade_centavos,
                desconto_centavos::text AS desconto_centavos,
                valor_centavos::text AS valor_centavos,
                vencimento::text AS vencimento, status, pago_em
           FROM cobrancas_do_cliente_firmare
          WHERE cliente_carteira_id = ANY($1)
          ORDER BY competencia DESC`,
        [ids],
      )

      const documentos = await c.query<LinhaDocumento>(
        `SELECT id, cliente_carteira_id, titulo, categoria, link, data::text AS data
           FROM documentos_carteira
          WHERE cliente_carteira_id = ANY($1) AND visivel_portal
          ORDER BY data DESC`,
        [ids],
      )

      const materiais = await c.query<LinhaMaterial>(
        `SELECT id, cliente_carteira_id, titulo, tipo, descricao, link
           FROM materiais_carteira
          WHERE cliente_carteira_id = ANY($1) AND visivel_portal
          ORDER BY criado_em DESC`,
        [ids],
      )

      const reunioes = await c.query<LinhaReuniao>(
        `SELECT id, cliente_carteira_id, data::text AS data, resumo, encaminhamentos
           FROM reunioes_comerciais
          WHERE cliente_carteira_id = ANY($1)
          ORDER BY data DESC`,
        [ids],
      )

      return {
        clientes: clientes.rows,
        campanhas: campanhas.rows,
        metas: metas.rows,
        cobrancas: cobrancas.rows,
        documentos: documentos.rows,
        materiais: materiais.rows,
        reunioes: reunioes.rows,
      }
    })

    const agora = this.relogio.agora()
    const saida: ClienteNoPortal[] = dados.clientes.map((cl) => {
      const campanhasDoCliente = dados.campanhas
        .filter((x) => x.cliente_carteira_id === cl.id)
        .map((x) => ({
          id: x.id,
          nome: x.nome,
          resultado: Dinheiro.deCentavos(BigInt(x.resultado ?? '0')),
          orcamentosPagos: x.orcamentos_pagos,
        }))

      return {
        id: cl.id,
        nome: cl.nome,
        produto: cl.produto,
        status: cl.status,
        ciclo: { mes: mesesJuntos(cl.criado_em, agora) },
        metas: dados.metas.filter((m) => m.cliente_carteira_id === cl.id).map(metaNaLista),
        campanhas: agruparCampanhasComSupressao(campanhasDoCliente).map((c) =>
          c.tipo === 'individual'
            ? { tipo: 'individual' as const, id: c.id, nome: c.nome, resultadoEmDinheiro: c.resultado.centavos.toString() }
            : { tipo: 'outras' as const, quantidade: c.quantidade, resultadoEmDinheiro: c.resultado.centavos.toString() },
        ),
        cobrancas: dados.cobrancas.filter((x) => x.cliente_carteira_id === cl.id).map(cobrancaNaLista),
        materiais: dados.materiais
          .filter((x) => x.cliente_carteira_id === cl.id)
          .map((x) => ({ id: x.id, titulo: x.titulo, tipo: x.tipo, descricao: x.descricao, link: x.link })),
        documentos: dados.documentos
          .filter((x) => x.cliente_carteira_id === cl.id)
          .map((x) => ({ id: x.id, titulo: x.titulo, categoria: x.categoria, link: x.link, data: x.data })),
        reunioes: dados.reunioes
          .filter((x) => x.cliente_carteira_id === cl.id)
          .map((x) => ({ id: x.id, data: x.data, resumo: x.resumo, encaminhamentos: x.encaminhamentos })),
      }
    })

    // O REGISTRO DE ACESSO (regra 18, ADR 0017 §5, ADR 0018 critério 5/10):
    // UMA linha por CLÍNICA incluída, nunca uma linha "grupo" solta — mesmo
    // quando a resposta é só comercial (ADR 0017 §5 item 3). `clinica_id` vem
    // de uma linha que a RLS do portal já filtrou (nunca da requisição), e é
    // por isso que `clinicaIdDeFonteConfiavel` é legítimo aqui — mesmo
    // raciocínio do terceiro chamador que `clinica-id.ts` já documenta para
    // `resolver_sessao`.
    const ator = usuarioPortalIdDeFonteConfiavel(usuarioDoPortal.id)
    for (const cl of dados.clientes) {
      await this.auditoria.registrarAcesso(
        clinicaIdDeFonteConfiavel(cl.clinica_id),
        ator,
        'carteira_comercial',
        cl.id,
      )
    }

    return saida
  }
}
