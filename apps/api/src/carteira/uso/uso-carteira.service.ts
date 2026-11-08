import type {
  MetricasDeUsoSaida,
  UsoDoClienteSaida,
  UsoNaVisaoGeralSaida,
  UsuarioDeGestaoPublico,
  VisaoDeUsoSaida,
} from '@fir/contracts'
import {
  type LinhaDeUsoDiario,
  type MetricasDeUso,
  diaCivil,
  resumoDasSituacoes,
  somarDias,
  textoDoRelatorioDeUso,
  usoDoCliente,
  usoNaVisaoGeral,
} from '@fir/domain'
import { Inject, Injectable } from '@nestjs/common'
import type pg from 'pg'
import { SISTEMA } from '../../banco/ator'
import { BancoService } from '../../banco/banco.service'
import { clinicaIdDeFonteConfiavel } from '../../banco/clinica-id'
import { RELOGIO, type Relogio } from '../../comum/relogio'
import { diaDaClinica } from '../../estoque/dia-da-clinica'
import { COLUNAS_DE_USO, type LinhaDeUsoDb, linhaDeUso } from './linha-de-uso'

export class ClienteSemUsoVisivel extends Error {}

type ClienteDb = { id: string; nome: string; clinica_id: string | null }

const metricasNaSaida = (m: MetricasDeUso): MetricasDeUsoSaida => ({
  comDados: m.comDados,
  diasUteis: m.diasUteis,
  diasComUso: m.diasComUso,
  diasSemDado: m.diasSemDado,
  pessoasAtivas: m.pessoasAtivas,
  pessoasCadastradas: m.pessoasCadastradas,
  tarefasCriadas: m.tarefasCriadas,
  tarefasConcluidas: m.tarefasConcluidas,
  percentualNoPrazo: m.percentualNoPrazo,
  tarefasVencidasAbertas: m.tarefasVencidasAbertas,
  contatos: m.contatos,
  orcamentosEnviados: m.orcamentosEnviados,
  orcamentosPagos: m.orcamentosPagos,
  percentualConversao: m.percentualConversao,
  // `receita` está em CAMPOS_MONETARIOS: o RedacaoInterceptor o apaga de quem
  // não tem `valores`. Nenhum `if` aqui (regra 17).
  receita: m.receita.centavos.toString(),
  faltas: m.faltas,
  faltasRecontatadas: m.faltasRecontatadas,
})

const ORDEM_DA_SITUACAO = { critico: 0, atencao: 1, bom: 2 } as const

/**
 * **A leitura do uso diário da FIR Clinic pela carteira** (G8 1D — F1, V12).
 *
 * Duas camadas de isolamento (regra 19, A-3): a RLS de `clientes_carteira` e
 * `uso_diario_cliente` por grupo (`app_pode_ver_grupo`, fixada pelo MESMO
 * `Usuário de Gestão` que o `CarteiraGuard` resolveu) e o filtro explícito de
 * grupo no `WHERE`. A primeira falha em silêncio; a segunda torna a intenção
 * legível.
 *
 * "Hoje" é o dia civil NO FUSO DE CADA CLÍNICA (regra 22) — duas clínicas em
 * fusos diferentes fecham a semana em instantes diferentes. O fuso vem de
 * `clinicas`, a raiz do tenancy, pelo pool do produto (mesma leitura que o job
 * G4 faz); `fir_carteira` não tem grant ali, e não precisa.
 *
 * Registro de acesso (ADR 0013 §7, regra 18): UMA linha por clínica incluída
 * na resposta, na `auditoria` daquela clínica, `ator_tipo = 'usuario_gestao'`.
 * Gravada ANTES de a resposta sair, e um erro nela derruba a requisição —
 * mesma escolha de `AcessoInterceptor` (falha fechado). Não usa
 * `@DadoSensivel`: o mecanismo genérico grava UM id por resposta, e o
 * agregado pode cobrir várias clínicas (mesma razão do portal).
 */
@Injectable()
export class UsoCarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async visao(usuario: UsuarioDeGestaoPublico): Promise<VisaoDeUsoSaida> {
    // 30 dias de série + folga de fuso: o "hoje" de cada clínica fica a no
    // máximo um dia do UTC; o domínio corta a janela exata depois.
    const desde = somarDias(diaCivil(this.relogio.agora(), 'UTC'), -32)
    const { clientes, linhas } = await this.banco.nasTabelasDaCarteiraComEscopo(
      usuario.escopo,
      usuario.grupoId,
      async (c) => {
        const clientes = await this.clientesVisiveis(c, usuario, null)
        const ids = clientes.map((x) => x.id)
        const linhas =
          ids.length === 0
            ? []
            : (
                await c.query<LinhaDeUsoDb>(
                  `SELECT ${COLUNAS_DE_USO} FROM uso_diario_cliente
                    WHERE cliente_carteira_id = ANY($1) AND dia >= $2::date AND ${this.filtroDeGrupo(3)}`,
                  [ids, desde, this.grupoDoFiltro(usuario)],
                )
              ).rows
        return { clientes, linhas }
      },
    )

    const fusos = await this.fusos(clientes)
    const porCliente = new Map<string, LinhaDeUsoDiario[]>()
    for (const l of linhas) {
      const lista = porCliente.get(l.cliente_carteira_id) ?? []
      lista.push(linhaDeUso(l))
      porCliente.set(l.cliente_carteira_id, lista)
    }

    const itens: UsoNaVisaoGeralSaida[] = clientes.map((cl) => {
      const hoje = diaDaClinica(this.relogio, fusos.get(cl.clinica_id!)!)
      const v = usoNaVisaoGeral(porCliente.get(cl.id) ?? [], hoje)
      return {
        clienteCarteiraId: cl.id,
        nome: cl.nome,
        saude: v.saude,
        semana: v.semana === null ? null : metricasNaSaida(v.semana),
        deltaNoPrazo: v.deltaNoPrazo,
        deltaContatos: v.deltaContatos,
        serie: v.serie,
      }
    })
    itens.sort((a, b) => {
      const oa = a.saude.situacao === null ? 3 : ORDEM_DA_SITUACAO[a.saude.situacao]
      const ob = b.saude.situacao === null ? 3 : ORDEM_DA_SITUACAO[b.saude.situacao]
      return oa - ob || a.nome.localeCompare(b.nome, 'pt-BR')
    })

    await this.registrarAcesso(usuario, clientes)

    const resumo = resumoDasSituacoes(itens.map((i) => i.saude))
    return {
      totais: { ...resumo, comDados: itens.filter((i) => i.semana !== null).length },
      clientes: itens,
    }
  }

  async doCliente(usuario: UsuarioDeGestaoPublico, clienteId: string): Promise<UsoDoClienteSaida> {
    const { cliente, linhas } = await this.banco.nasTabelasDaCarteiraComEscopo(
      usuario.escopo,
      usuario.grupoId,
      async (c) => {
        const [cliente] = await this.clientesVisiveis(c, usuario, clienteId)
        if (cliente === undefined) return { cliente: undefined, linhas: [] }
        const linhas = (
          await c.query<LinhaDeUsoDb>(
            `SELECT ${COLUNAS_DE_USO} FROM uso_diario_cliente
              WHERE cliente_carteira_id = $1 AND ${this.filtroDeGrupo(2)}
              ORDER BY dia`,
            [cliente.id, this.grupoDoFiltro(usuario)],
          )
        ).rows
        return { cliente, linhas }
      },
    )
    // Mesma resposta para "não existe" e "é de outro grupo" (A-3).
    if (cliente === undefined) throw new ClienteSemUsoVisivel()
    if (cliente.clinica_id === null) {
      return { clienteCarteiraId: cliente.id, nome: cliente.nome, comClinica: false, uso: null }
    }

    const fusos = await this.fusos([cliente])
    const hoje = diaDaClinica(this.relogio, fusos.get(cliente.clinica_id)!)
    const uso = usoDoCliente(linhas.map(linhaDeUso), hoje)

    await this.registrarAcesso(usuario, [cliente])

    return {
      clienteCarteiraId: cliente.id,
      nome: cliente.nome,
      comClinica: true,
      uso:
        uso === null
          ? null
          : {
              saude: uso.saude,
              semana: metricasNaSaida(uso.semana),
              semanaAnterior: metricasNaSaida(uso.semanaAnterior),
              deltaContatos: uso.deltaContatos,
              serie: uso.serie,
              relatorio: {
                emUsoDesde: uso.relatorio.emUsoDesde,
                diasDesde: uso.relatorio.diasDesde,
                marcos: [...uso.relatorio.marcos],
                indicadores: [...uso.relatorio.indicadores],
                texto: textoDoRelatorioDeUso(cliente.nome, uso),
              },
            },
    }
  }

  /**
   * Os clientes da tela FIR Clinic: ligados a uma clínica, ativos ou em
   * onboarding (`ativos()` do protótipo, L1120). Com `clienteId`, a ficha de
   * um só — inclusive sem clínica, para a tela dizer "sem FIR Clinic".
   */
  private async clientesVisiveis(
    c: pg.PoolClient,
    usuario: UsuarioDeGestaoPublico,
    clienteId: string | null,
  ): Promise<ClienteDb[]> {
    const r =
      clienteId === null
        ? await c.query<ClienteDb>(
            `SELECT id, nome, clinica_id FROM clientes_carteira
              WHERE excluido_em IS NULL AND clinica_id IS NOT NULL
                AND status IN ('ativo', 'onboarding') AND ${this.filtroDeGrupo(1)}
              ORDER BY nome`,
            [this.grupoDoFiltro(usuario)],
          )
        : await c.query<ClienteDb>(
            `SELECT id, nome, clinica_id FROM clientes_carteira
              WHERE id = $2 AND excluido_em IS NULL AND ${this.filtroDeGrupo(1)}`,
            [this.grupoDoFiltro(usuario), clienteId],
          )
    return r.rows
  }

  /** A segunda camada (regra 19): `escopo = 'geral'` passa `NULL` e vê tudo, como a RLS. */
  private filtroDeGrupo(posicao: number): string {
    return `($${posicao}::uuid IS NULL OR grupo_id = $${posicao}::uuid)`
  }

  private grupoDoFiltro(usuario: UsuarioDeGestaoPublico): string | null {
    return usuario.escopo === 'geral' ? null : usuario.grupoId
  }

  private async fusos(clientes: readonly ClienteDb[]): Promise<Map<string, string>> {
    const ids = clientes.flatMap((c) => (c.clinica_id === null ? [] : [c.clinica_id]))
    if (ids.length === 0) return new Map()
    const r = await this.banco.semIsolamentoDeClinica<{ id: string; fuso: string }>(
      'SELECT id, fuso FROM clinicas WHERE id = ANY($1)',
      [ids],
    )
    return new Map(r.rows.map((x) => [x.id, x.fuso]))
  }

  private async registrarAcesso(usuario: UsuarioDeGestaoPublico, clientes: readonly ClienteDb[]): Promise<void> {
    for (const cl of clientes) {
      if (cl.clinica_id === null) continue
      // `clinicaIdDeFonteConfiavel`: o id vem de `clientes_carteira`, lido
      // pelo banco sob a RLS do próprio usuário — nunca da requisição.
      const clinicaId = clinicaIdDeFonteConfiavel(cl.clinica_id)
      await this.banco.naClinica(clinicaId, SISTEMA, (c) =>
        c.query(
          `INSERT INTO auditoria (clinica_id, ator_tipo, ator_id, acao, entidade, entidade_id)
           VALUES ($1, 'usuario_gestao', $2, 'acessou', 'uso_diario_cliente', $3)`,
          [clinicaId, usuario.id, cl.id],
        ),
      )
    }
  }
}
