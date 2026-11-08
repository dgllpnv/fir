import {
  AnexoPorLink,
  type ClienteNoPortal,
  type CobrancaCarteiraNaLista,
  type MaterialNoPortal,
  type MetaNoPortal,
  type UsuarioDeGestaoPublico,
  type UsuarioDoPortalPublico,
} from '@fir/contracts'
import {
  Dinheiro,
  cicloDoContrato,
  diaCivil,
  materiaisParaOCliente,
  mesAnterior,
  nomeDaSaudacao,
  periodoDeCampanhas,
  programaDoCliente,
  resumirCampanhas,
  suprimirCampanhas,
  valorParaExibicao,
  type CelulaDeCampanha,
  type StatusDeCampanhaCarteira,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { usuarioPortalIdDeFonteConfiavel } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../../banco/clinica-id'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { AuditoriaService } from '../../auditoria/auditoria.service'
import { SELECT_META, avaliarMetas, carregarContexto, type LinhaDaMeta } from '../financeiro/metas-avaliacao'
import { FUSO_DA_CARTEIRA } from '../fuso-da-carteira'

/**
 * Quem está lendo — muda UMA coisa na consulta (de onde sai o nome da
 * consultora) e nada no que é mostrado:
 *  - `portal`: a conexão é `fir_portal`, sob `app_portal_pode_ver`; o nome da
 *    consultora sai de `app_portal_nome_da_consultora` (o portal não lê
 *    `usuarios_gestao`, 0059);
 *  - `previa`: a conexão é `fir_carteira`, como o `Usuário de Gestão`, e a
 *    consulta se restringe ao cliente da rota (O9).
 */
type Modo = { readonly tipo: 'portal' } | { readonly tipo: 'previa'; readonly clienteId: string }

type LinhaCliente = {
  id: string
  clinica_id: string | null
  nome: string
  produto: string
  status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado'
  decisor: string | null
  area_foco: string | null
  data_inicio: string | null
  data_fim: string | null
  reuniao_dia_semana: number | null
  reuniao_hora: string | null
  consultora: string | null
  link_painel: string | null
  link_dash_ind: string | null
  link_dash_fin: string | null
  link_rotina: string | null
}

type LinhaCampanha = {
  id: string
  cliente_carteira_id: string
  campanha_origem_id: string | null
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
}

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

type LinhaDocumento = { id: string; cliente_carteira_id: string; titulo: string; categoria: string; link: string; data: string }
type LinhaPersonalizado = {
  id: string
  cliente_carteira_id: string
  titulo: string
  tipo: string
  descricao: string | null
  link: string | null
  texto: string | null
}
type LinhaDaBiblioteca = {
  id: string
  titulo: string
  tipo: string
  programas: string[]
  descricao: string | null
  link: string | null
  texto: string | null
}
type LinhaReuniao = {
  id: string
  cliente_carteira_id: string
  data: string
  resumo: string
  encaminhamentos: string | null
  anexos: unknown
}
type LinhaArquivo = { id: string; dono_id: string; nome_original: string; tipo_mime: string; tamanho: string }

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

const dinheiro = (v: string | null): Dinheiro | null => (v === null ? null : Dinheiro.deCentavos(BigInt(v)))

/** Mesma tradução de `campanhas-carteira.service.ts` (LGPD A24: todo cliente exige contagem até o segmento existir). */
const celula = (l: LinhaCampanha): CelulaDeCampanha => ({
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

/**
 * O anexo por link da ata é `jsonb` escrito pela porta de escrita (contrato
 * `AnexoPorLink`, só `https`). Lido de volta pelo MESMO contrato: o que não
 * casar (linha antiga, escrita à mão) não chega à cliente.
 */
const linksDaAta = (bruto: unknown): AnexoPorLink[] =>
  Array.isArray(bruto) ? bruto.flatMap((x) => { const r = AnexoPorLink.safeParse(x); return r.success ? [r.data] : [] }) : []

/** As 10 últimas semanas lançadas (`barras`, portal:L32–35): altura mínima 6, relativa ao maior módulo. */
function ultimasSemanas(m: LinhaDaMeta, lancamentos: readonly { referencia: string; valor: string }[]): MetaNoPortal['ultimasSemanas'] {
  const l = lancamentos.slice(-10)
  if (l.length === 0) return []
  const modulo = (v: bigint) => (v < 0n ? -v : v)
  const maior = l.reduce<bigint>((mx, x) => (modulo(BigInt(x.valor)) > mx ? modulo(BigInt(x.valor)) : mx), 1n)
  return l.map((x) => {
    const v = BigInt(x.valor)
    const exibido = valorParaExibicao({ num: v, den: 1n }, m.unidade)
    return {
      referencia: x.referencia,
      valor: m.unidade === 'R$' ? exibido.valor.toString() : null,
      numero: m.unidade === 'R$' ? null : exibido.valor.toString(),
      escala: exibido.escala,
      altura: Math.max(6, Math.min(100, Number((modulo(v) * 100n) / maior))),
    }
  })
}

/** A meta encerrada (atingida ou não) vai para o fim, como o protótipo (portal:L120). */
const encerrada = (m: MetaNoPortal): number => (m.status === 'atingida' || m.status === 'nao_atingida' ? 1 : 0)

/**
 * **A LEITURA DO ESPAÇO DA CLIENTE** — o portal (G6, O2–O8) e a prévia "ver
 * como a cliente" (O9), pela MESMA função.
 *
 * Toda consulta seleciona por LISTA de colunas e repete no `WHERE` o que a
 * policy do portal já exige (arquivado, compartilhada, `visivel_portal`,
 * `uso_interno`, `limpo`): a aplicação também filtra (regra 19). É isso que
 * faz a prévia, lida como `fir_carteira`, mostrar o mesmo que a cliente vê.
 *
 * Nada aqui soma dinheiro por conta própria: campanha passa por
 * `suprimirCampanhas`/`resumirCampanhas` (LGPD A20, CE-3), meta por
 * `avaliarMetas` (O4, a mesma avaliação da carteira). A redação de valores é
 * do `RedacaoInterceptor`: no portal, pela conta (`ve_valores`, LGPD A52); na
 * prévia, pela permissão `valores` de quem olha (appsec A-18).
 */
async function lerSecoes(
  c: pg.PoolClient,
  modo: Modo,
  agora: Date,
): Promise<{ clientes: LinhaCliente[]; secoes: ClienteNoPortal[] }> {
  const nomeDaConsultora =
    modo.tipo === 'portal'
      ? 'app_portal_nome_da_consultora(responsavel_usuario_gestao_id)'
      : '(SELECT u.nome FROM usuarios_gestao u WHERE u.id = responsavel_usuario_gestao_id AND u.ativo)'
  const clientes = (
    await c.query<LinhaCliente>(
      `SELECT id, clinica_id, nome, produto, status, decisor, area_foco,
              data_inicio::text AS data_inicio, data_fim::text AS data_fim,
              reuniao_dia_semana, to_char(reuniao_hora, 'HH24:MI') AS reuniao_hora,
              ${nomeDaConsultora} AS consultora,
              link_painel, link_dash_ind, link_dash_fin, link_rotina
         FROM clientes_carteira
        WHERE excluido_em IS NULL AND ($1::uuid IS NULL OR id = $1::uuid)
        ORDER BY nome`,
      [modo.tipo === 'previa' ? modo.clienteId : null],
    )
  ).rows
  const ids = clientes.map((x) => x.id)
  if (ids.length === 0) return { clientes, secoes: [] }

  const campanhas = (
    await c.query<LinhaCampanha>(
      `SELECT id, cliente_carteira_id, campanha_origem_id, nome, categoria, mes_referencia::text AS mes, status,
              metrica, meta::text AS meta, resultado::text AS resultado,
              receita_centavos::text AS receita_centavos, investimento_centavos::text AS investimento_centavos,
              orcamentos_pagos
         FROM campanhas_carteira
        WHERE cliente_carteira_id = ANY($1)
        ORDER BY mes_referencia DESC, nome, id`,
      [ids],
    )
  ).rows

  const metas = (
    await c.query<LinhaDaMeta>(
      `${SELECT_META}
        WHERE m.cliente_carteira_id = ANY($1) AND m.excluido_em IS NULL AND m.status <> 'cancelada'
        ORDER BY m.criado_em, m.id`,
      [ids],
    )
  ).rows
  const contexto = await carregarContexto(c, metas, agora, FUSO_DA_CARTEIRA)
  const avaliadas = avaliarMetas(metas, contexto)

  const cobrancas = (
    await c.query<LinhaCobranca>(
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
  ).rows

  // `arquivado_em IS NULL` repetido aqui (antes só a policy filtrava — 1B).
  const documentos = (
    await c.query<LinhaDocumento>(
      `SELECT id, cliente_carteira_id, titulo, categoria, link, data::text AS data
         FROM documentos_carteira
        WHERE cliente_carteira_id = ANY($1) AND visivel_portal AND arquivado_em IS NULL
        ORDER BY data DESC, id`,
      [ids],
    )
  ).rows

  const personalizados = (
    await c.query<LinhaPersonalizado>(
      `SELECT id, cliente_carteira_id, titulo, tipo, descricao, link, texto
         FROM materiais_carteira
        WHERE cliente_carteira_id = ANY($1) AND visivel_portal AND arquivado_em IS NULL`,
      [ids],
    )
  ).rows

  // A biblioteca geral (O5): a policy do portal já recorta pelo programa dos
  // clientes da sessão (`app_portal_pode_ver_material`, 0059); o recorte POR
  // CLIENTE é o de baixo, com `materiaisParaOCliente`.
  const biblioteca = (
    await c.query<LinhaDaBiblioteca>(
      `SELECT id, titulo, tipo, programas, descricao, link, texto
         FROM materiais_da_biblioteca
        WHERE NOT uso_interno AND arquivado_em IS NULL`,
    )
  ).rows

  // G8 0.1 (D-P1): só a ata compartilhada e não arquivada, colunas da lista branca (LGPD A7).
  const reunioes = (
    await c.query<LinhaReuniao>(
      `SELECT id, cliente_carteira_id, data::text AS data, resumo, encaminhamentos, anexos
         FROM reunioes_comerciais
        WHERE cliente_carteira_id = ANY($1) AND compartilhada AND arquivada_em IS NULL
        ORDER BY data DESC, id`,
      [ids],
    )
  ).rows

  // Anexos de ARQUIVO (4C) só dos donos que passaram pelos filtros acima, e
  // só `limpo` e não removido — o mesmo que a policy `anexos_carteira_portal`.
  const donos = [...documentos.map((d) => d.id), ...reunioes.map((r) => r.id)]
  const arquivos =
    donos.length === 0
      ? []
      : (
          await c.query<LinhaArquivo>(
            `SELECT id, dono_id, nome_original, tipo_mime, tamanho::text AS tamanho
               FROM anexos_carteira
              WHERE cliente_carteira_id = ANY($1) AND dono_id = ANY($2)
                AND situacao_varredura = 'limpo' AND removido_em IS NULL
              ORDER BY criado_em, id`,
            [ids, donos],
          )
        ).rows
  const arquivosDe = (dono: string) =>
    arquivos
      .filter((a) => a.dono_id === dono)
      .map((a) => ({ id: a.id, nome: a.nome_original, tipo: a.tipo_mime, tamanho: Number(a.tamanho) }))

  const hoje = diaCivil(agora, FUSO_DA_CARTEIRA)
  // O período das campanhas no portal: os 12 meses até o atual. O total é o
  // das células EXIBIDAS desse período (`resumirCampanhas`), e as linhas
  // individuais são exatamente essas células — "total − linhas visíveis"
  // nunca isola uma suprimida (CE-3, ajuste 26).
  const periodo = periodoDeCampanhas('12m', hoje)
  if (periodo.tipo === 'erro') throw new Error(`período das campanhas do portal: ${periodo.erro.codigo}`)
  const { de, ate } = periodo.valor
  const mesAtual = `${hoje.slice(0, 7)}-01`

  const secoes: ClienteNoPortal[] = clientes.map((cl) => {
    const programa = programaDoCliente({ areaFoco: cl.area_foco, produto: cl.produto })

    const supressao = suprimirCampanhas(campanhas.filter((x) => x.cliente_carteira_id === cl.id).map(celula))
    const resumo = resumirCampanhas(supressao, { de, ate, mesAtual, mesAnterior: mesAnterior(mesAtual) })
    const noPeriodo = supressao.celulas.filter((x) => x.mes >= de && x.mes <= ate)
    const individuais = noPeriodo.flatMap((x) =>
      x.suprimida || x.receita === null
        ? []
        : [{ tipo: 'individual' as const, id: x.id, nome: x.nome, mes: x.mes, resultadoEmDinheiro: x.receita.centavos.toString() }],
    )
    const campanhasDoCliente: ClienteNoPortal['campanhas'] =
      resumo.outras.quantidade > 0
        ? // "Outras campanhas" nunca leva valor (`suprimirCampanhas`): só a quantidade.
          [...individuais, { tipo: 'outras' as const, quantidade: resumo.outras.quantidade, resultadoEmDinheiro: null }]
        : individuais

    const metasDoCliente: MetaNoPortal[] = avaliadas
      .filter((m) => m.clienteCarteiraId === cl.id)
      .map((m) => {
        const linha = metas.find((x) => x.id === m.id)!
        const fonte = linha.fonte === 'indicador' && linha.fonte_indicador_id ? linha.fonte_indicador_id : linha.indicador_id
        return { ...m, ultimasSemanas: linha.fonte === 'planilha' ? [] : ultimasSemanas(linha, contexto.lancamentos.get(fonte) ?? []) }
      })
      .sort((a, b) => encerrada(a) - encerrada(b))

    const doPrograma = materiaisParaOCliente(
      programa,
      biblioteca.map((m) => ({ ...m, usoInterno: false })),
    ).doPrograma
    const materiais: MaterialNoPortal[] = [
      ...personalizados
        .filter((m) => m.cliente_carteira_id === cl.id)
        .map((m) => ({ id: m.id, titulo: m.titulo, tipo: m.tipo, descricao: m.descricao, link: m.link, texto: m.texto, personalizado: true })),
      ...doPrograma.map((m) => ({ id: m.id, titulo: m.titulo, tipo: m.tipo, descricao: m.descricao, link: m.link, texto: m.texto, personalizado: false })),
    ].sort((a, b) => Number(b.personalizado) - Number(a.personalizado) || a.titulo.localeCompare(b.titulo, 'pt-BR'))

    return {
      id: cl.id,
      nome: cl.nome,
      produto: cl.produto,
      status: cl.status,
      saudacao: nomeDaSaudacao(cl.decisor, cl.nome),
      programa,
      ciclo: cicloDoContrato(cl.data_inicio, cl.data_fim, hoje),
      consultora:
        cl.consultora === null
          ? null
          : {
              nome: cl.consultora,
              reuniao: cl.reuniao_dia_semana === null ? null : { diaDaSemana: cl.reuniao_dia_semana, hora: cl.reuniao_hora },
            },
      linkPainel: cl.link_painel,
      linkDashInd: cl.link_dash_ind,
      linkDashFin: cl.link_dash_fin,
      linkRotina: cl.link_rotina,
      metas: metasDoCliente,
      campanhas: campanhasDoCliente,
      resumoDeCampanhas: { de, ate, receita: resumo.periodo.valorGerado.centavos.toString(), soDasExibidas: resumo.soDasExibidas },
      cobrancas: cobrancas.filter((x) => x.cliente_carteira_id === cl.id).map(cobrancaNaLista),
      materiais,
      documentos: documentos
        .filter((x) => x.cliente_carteira_id === cl.id)
        .map((x) => ({ id: x.id, titulo: x.titulo, categoria: x.categoria, link: x.link, data: x.data, arquivos: arquivosDe(x.id) })),
      reunioes: reunioes
        .filter((x) => x.cliente_carteira_id === cl.id)
        .map((x) => ({
          id: x.id,
          data: x.data,
          resumo: x.resumo,
          encaminhamentos: x.encaminhamentos,
          links: linksDaAta(x.anexos),
          arquivos: arquivosDe(x.id),
        })),
    }
  })

  return { clientes, secoes }
}

export class ClienteDaPreviaNaoEncontrado extends Error {}

@Injectable()
export class LeituraDoPortalService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  /**
   * `GET /v1/portal/clientes`. Uma conexão `fir_portal` (RLS por
   * `app_portal_pode_ver`, nenhum `WHERE` de grupo/cliente no código), e o
   * REGISTRO DE ACESSO depois (regra 18, ADR 0017 §5, ADR 0018 critério 5/10):
   * uma linha por clínica incluída, na trilha DA CLÍNICA. Cliente sem clínica
   * (D-22 item 4) não tem trilha de clínica onde gravar: a linha vai para
   * `auditoria_do_painel`, na mesma transação da leitura — se ela falhar, a
   * leitura cai junto (falha fechada).
   */
  async clientes(usuarioDoPortal: UsuarioDoPortalPublico): Promise<ClienteNoPortal[]> {
    const escopo = {
      escopo: usuarioDoPortal.escopo,
      clienteCarteiraId: usuarioDoPortal.clienteCarteiraId,
      grupoId: usuarioDoPortal.grupoId,
    }
    const agora = this.relogio.agora()
    const { clientes, secoes } = await this.banco.nasTabelasDaCarteiraComoPortal(escopo, async (c) => {
      const lido = await lerSecoes(c, { tipo: 'portal' }, agora)
      for (const cl of lido.clientes.filter((x) => x.clinica_id === null)) {
        await c.query(
          `INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id)
           VALUES ('usuario_portal', $1, 'acessou', 'carteira_comercial', $2)`,
          [usuarioDoPortal.id, cl.id],
        )
      }
      return lido
    })

    // `clinica_id` vem de uma linha que a RLS do portal já filtrou (nunca da
    // requisição) — o mesmo raciocínio que `clinica-id.ts` documenta para
    // `resolver_sessao`.
    const ator = usuarioPortalIdDeFonteConfiavel(usuarioDoPortal.id)
    for (const cl of clientes) {
      if (cl.clinica_id === null) continue
      await this.auditoria.registrarAcesso(clinicaIdDeFonteConfiavel(cl.clinica_id), ator, 'carteira_comercial', cl.id)
    }
    return secoes
  }

  /**
   * "Ver como a cliente" (O9, V7; appsec A-18). Rota de CARTEIRA: lê como o
   * `Usuário de Gestão` (`fir_carteira`, RLS do grupo dele; a "minha
   * carteira" já foi conferida pelo `CarteiraGuard` no `:id`), monta a MESMA
   * seção do portal com os mesmos filtros, e a redação é a da carteira —
   * sem `valores`, a cobrança sai `null` onde a cliente a veria. Nunca
   * autentica como `Usuário do portal`.
   *
   * O acesso fica registrado com `ator_tipo = 'usuario_gestao'`, em
   * `auditoria_do_painel`, como toda leitura de ficha da carteira (LGPD A53).
   */
  async previa(usuarioDeGestao: UsuarioDeGestaoPublico, clienteId: string): Promise<ClienteNoPortal> {
    const agora = this.relogio.agora()
    return this.banco.nasTabelasDaCarteiraComoUsuarioDeGestao(usuarioDeGestao, async (c) => {
      const { secoes } = await lerSecoes(c, { tipo: 'previa', clienteId }, agora)
      const secao = secoes[0]
      if (!secao) throw new ClienteDaPreviaNaoEncontrado()
      await c.query(
        `INSERT INTO auditoria_do_painel (ator_tipo, ator_id, acao, entidade, entidade_id)
         VALUES ('usuario_gestao', $1, 'acessou', 'portal_previa', $2)`,
        [usuarioDeGestao.id, secao.id],
      )
      return secao
    })
  }
}
