import type {
  ClienteCarteiraNaLista,
  ClienteCarteiraNoPainel,
  CriarClienteCarteiraEntrada,
  CriarGrupoEntrada,
  CriarUsuarioDeGestaoEntrada,
  EditarClienteCarteiraNoPainelEntrada,
  EditarGrupoEntrada,
  EditarUsuarioDeGestaoEntrada,
  GrupoNaLista,
  SenhaDoUsuarioDeGestaoRedefinida,
  UsuarioDeGestaoNaLista,
  UsuarioDeGestaoPublico,
} from '@fir/contracts'
import { Inject, Injectable } from '@nestjs/common'
import type { PoolClient } from 'pg'
import { SISTEMA, type OperadorId } from '../banco/ator'
import { BancoService } from '../banco/banco.service'
import {
  gravarCampos,
  moverClienteDeGrupo,
  registrarGrupoDaClinica,
  reprogramarCobrancasAbertas,
  responsavelServeAoCliente,
} from '../carteira/cadastro-do-cliente'
import { competenciaDoMes } from '../carteira/financeiro/gerar-cobrancas'
import { type LinhaDoPerfil, colunasDoPerfil, perfilDaLinha } from '../carteira/perfil-do-usuario-de-gestao'
import { RELOGIO, type Relogio } from '../comum/relogio'
import { type Provisoria, gerarProvisoria, provisoriaEscolhida } from '../pessoas/escrita-de-pessoa'
import { registrarNoPainel } from './painel.service'

const UNICIDADE_VIOLADA = '23505'
const FK_VIOLADA = '23503'

export class ClinicaJaTemClienteFirmare extends Error {}
export class ClinicaOuGrupoNaoExiste extends Error {}
export class UsuarioDeGestaoJaExiste extends Error {}
export class GrupoNaoExiste extends Error {}
export class UsuarioDeGestaoNaoExiste extends Error {}
export class ClienteCarteiraNaoExiste extends Error {}
/** O Cliente que paga (conta_na_receita) não sai do grupo enquanto não houver troca de pagador. */
export class PagadorNaoSaiDoGrupo extends Error {}
export class ClinicaJaEstaNoGrupo extends Error {}
export class ClinicaNaoEstaNoGrupo extends Error {}
export class ClienteComClinicaNaoMudaDeGrupo extends Error {}
export class ClienteJaTemClinica extends Error {}
export class GrupoDesativado extends Error {}
/**
 * A `Conta de gestão do operador` (ADR 0024) não tem senha: ela entra pelo
 * login do painel. O gatilho da 0061 recusa a escrita de senha nela
 * (`conta_de_gestao_do_operador_fixa`); isto é a tradução para 409.
 */
export class ContaDeGestaoDoOperadorSemSenha extends Error {}
const VIOLACAO_DE_CHECK = '23514'
/**
 * A mesma conta, na EDIÇÃO: perfil, escopo e estado acompanham o operador e
 * não se editam (o mesmo gatilho da 0061). 409, nunca 500.
 */
export class ContaDeGestaoDoOperadorFixa extends Error {}
const ehContaFixa = (e: unknown): boolean => {
  const x = e as { code?: string; constraint?: string }
  return x.code === VIOLACAO_DE_CHECK && x.constraint === 'conta_de_gestao_do_operador_fixa'
}

/**
 * O grupo Firmare (migration 0067) é o padrão: não se desativa, e nenhum
 * Usuário de Gestão de escopo `grupo` aponta para ele (seria um segundo
 * `geral`, sem a trilha da conta do operador). O banco é quem recusa; isto é
 * a tradução para 409, nunca 500.
 */
export class UsuarioNaoPodeSerDoGrupoPadrao extends Error {}
export class GrupoPadraoNaoMuda extends Error {}
const traduzTravaDoGrupoPadrao = (e: unknown): void => {
  const x = e as { code?: string; constraint?: string }
  if (x.code !== VIOLACAO_DE_CHECK) return
  if (x.constraint === 'usuario_de_gestao_do_grupo_padrao') throw new UsuarioNaoPodeSerDoGrupoPadrao()
  if (x.constraint === 'grupo_padrao_fixo') throw new GrupoPadraoNaoMuda()
}

type LinhaClienteNoPainel = {
  id: string
  grupo_id: string
  clinica_id: string | null
  nome: string
  produto: string
  status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado'
  mensalidade_centavos: string
}

const COLUNAS_NO_PAINEL = 'id, grupo_id, clinica_id, nome, produto, status, mensalidade_centavos::text AS mensalidade_centavos'

const clienteNoPainel = (l: LinhaClienteNoPainel): ClienteCarteiraNoPainel => ({
  id: l.id,
  grupoId: l.grupo_id,
  clinicaId: l.clinica_id,
  nome: l.nome,
  produto: l.produto,
  status: l.status,
  // Sempre preenchido aqui; quem apaga é o `RedacaoInterceptor` (regra 17).
  mensalidade: l.mensalidade_centavos,
})

/**
 * As escritas da carteira que só o `Operador` faz (ADR 0011: nunca convite
 * interno).
 *
 * Identidade (`grupos`, `usuarios_gestao`) vai pela conexão do PAINEL
 * (`banco.nasTabelasDeIdentidadeDaCarteiraComoPainel`, `fir_painel`) — nunca
 * pela `fir_carteira`, que é o papel da sessão do `Usuário de Gestão` e, desde
 * a 0041, não escreve `escopo`/`grupo_id`/`ativo` nem cria grupo (gate G8,
 * F-1/A-1: privilégio não é gravável pelo papel da sessão que ele protege).
 * As listas também vão pelo painel: o Operador lê pela conexão dele.
 *
 * `Cliente Firmare` (`clientes_carteira`) continua em `fir_carteira`
 * (`nasTabelasDaCarteiraComoOperador`): a tabela tem RLS por grupo com policy
 * `TO fir_carteira` (0035), e nada nela eleva o acesso de uma sessão.
 */
/**
 * Os sete campos do perfil (G8 0.5), na ordem dos parâmetros do INSERT e do
 * UPDATE. `administrar` só sobrevive em escopo geral (A-5): o contrato já
 * recusa o par, e isto garante que trocar o escopo para "grupo" nunca deixe a
 * chave gravada (o CHECK da 0050 recusaria a linha).
 */
const valoresDoPerfil = (d: CriarUsuarioDeGestaoEntrada | EditarUsuarioDeGestaoEntrada) =>
  [
    d.valores,
    d.carteira,
    d.modulos,
    d.administrar && d.escopo === 'geral',
    d.setor,
    d.funcao,
    d.telefone,
  ] as const

@Injectable()
export class PainelCarteiraService {
  constructor(
    @Inject(BancoService) private readonly banco: BancoService,
    @Inject(RELOGIO) private readonly relogio: Relogio,
  ) {}

  async listarGrupos(): Promise<GrupoNaLista[]> {
    const r = await this.banco.nasTabelasDeIdentidadeDaCarteiraComoPainel(SISTEMA, (c) =>
      c.query<{ id: string; nome: string; ativo: boolean }>(
        'SELECT id, nome, ativo FROM grupos WHERE NOT arquivo ORDER BY nome',
      ),
    )
    return r.rows
  }

  /**
   * A lista do painel do superadmin. Mesma forma de `PessoaNaLista`:
   * `aguardandoPrimeiroAcesso` em vez de `senhaProvisoria` — este booleano é
   * sobre OUTRA conta, nunca sobre a sessão de quem está lendo.
   */
  async listarUsuariosDeGestao(): Promise<UsuarioDeGestaoNaLista[]> {
    const r = await this.banco.nasTabelasDeIdentidadeDaCarteiraComoPainel(SISTEMA, (c) =>
      c.query<{
        id: string
        usuario: string
        nome: string
        escopo: 'geral' | 'grupo'
        grupo_id: string | null
        ativo: boolean
        senha_provisoria: boolean
        conta_do_operador: boolean
      } & LinhaDoPerfil>(
        `SELECT id, usuario, nome, escopo, grupo_id, ativo, senha_provisoria, ${colunasDoPerfil()},
                EXISTS (SELECT 1 FROM contas_de_gestao_do_operador v WHERE v.usuario_gestao_id = usuarios_gestao.id)
                  AS conta_do_operador
           FROM usuarios_gestao
          ORDER BY nome`,
      ),
    )
    return r.rows.map((u) => ({
      id: u.id,
      usuario: u.usuario,
      nome: u.nome,
      escopo: u.escopo,
      grupoId: u.grupo_id,
      ativo: u.ativo,
      aguardandoPrimeiroAcesso: u.senha_provisoria,
      contaDoOperador: u.conta_do_operador,
      ...perfilDaLinha(u),
    }))
  }

  /**
   * **EDITAR um grupo** — nome e estado, por completo (`EditarGrupoEntrada`
   * não é parcial). Desativar aqui é o mesmo estado que a lista já mostra
   * (`ativo`), nunca uma exclusão — regra 20.
   */
  async editarGrupo(
    ator: OperadorId,
    id: string,
    dados: EditarGrupoEntrada,
  ): Promise<GrupoNaLista> {
    return this.banco.nasTabelasDeIdentidadeDaCarteiraComoPainel(ator, async (c) => {
      const antes = await c.query<{ nome: string; ativo: boolean }>(
        'SELECT nome, ativo FROM grupos WHERE id = $1',
        [id],
      )
      const de = antes.rows[0]
      if (de === undefined) throw new GrupoNaoExiste()

      const r = await c.query<{ id: string; nome: string; ativo: boolean }>(
        'UPDATE grupos SET nome = $2, ativo = $3 WHERE id = $1 RETURNING id, nome, ativo',
        [id, dados.nome, dados.ativo],
      ).catch((e: unknown) => {
        traduzTravaDoGrupoPadrao(e)
        throw e
      })
      const grupo = r.rows[0]!
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'alterou',
        entidade: 'grupos',
        entidadeId: grupo.id,
        de: { nome: de.nome, ativo: de.ativo },
        para: { nome: grupo.nome, ativo: grupo.ativo },
      })
      return grupo
    })
  }

  async criarGrupo(ator: OperadorId, dados: CriarGrupoEntrada): Promise<GrupoNaLista> {
    return this.banco.nasTabelasDeIdentidadeDaCarteiraComoPainel(ator, async (c) => {
      const r = await c.query<{ id: string; nome: string; ativo: boolean }>(
        'INSERT INTO grupos (nome) VALUES ($1) RETURNING id, nome, ativo',
        [dados.nome],
      )
      const grupo = r.rows[0]!
      // "Grupo criado" é SOBRE a carteira, não sobre clínica nenhuma — vai
      // para a trilha do painel, mesma razão de "clínica criada".
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'criou',
        entidade: 'grupos',
        entidadeId: grupo.id,
        para: { nome: grupo.nome },
      })
      return grupo
    })
  }

  /**
   * Vincula uma `Clinica` já existente a um `Grupo`, criando o
   * `Cliente Firmare`. A trilha desta escrita vai para a `auditoria` DA
   * CLÍNICA ligada (o trigger já faz isso, porque `clientes_carteira` tem
   * `clinica_id` — ver migration 0026) — a clínica tem o direito de ver que
   * a Firmare a registrou comercialmente.
   */
  async criarClienteCarteira(
    ator: OperadorId,
    dados: CriarClienteCarteiraEntrada,
  ): Promise<ClienteCarteiraNaLista> {
    return this.banco.nasTabelasDaCarteiraComoOperador(ator, async (c) => {
      // A-8 (0047): a clínica fica no grupo dela. Se a trilha de tenancy já
      // a pôs em outro grupo, recusa; se não há trilha ou ela muda agora,
      // grava a linha do histórico ANTES do cliente (o trigger confere).
      await this.prenderClinicaAoGrupo(c, ator, dados.clinicaId, dados.grupoId, null)
      let linha: {
        id: string
        grupo_id: string
        clinica_id: string
        nome: string
        produto: string
        status: 'onboarding' | 'ativo' | 'pausado' | 'encerrado'
      }
      try {
        const r = await c.query<typeof linha>(
          `INSERT INTO clientes_carteira (grupo_id, clinica_id, nome, produto, conta_na_receita)
           VALUES ($1, $2, $3, $4,
                   NOT EXISTS (SELECT 1 FROM clientes_carteira o
                                WHERE o.clinica_id = $2 AND o.excluido_em IS NULL AND o.conta_na_receita))
           RETURNING id, grupo_id, clinica_id, nome, produto, status`,
          [dados.grupoId, dados.clinicaId, dados.nome, dados.produto],
        )
        linha = r.rows[0]!
      } catch (e) {
        const codigo = (e as { code?: string }).code
        if (codigo === UNICIDADE_VIOLADA) throw new ClinicaJaTemClienteFirmare()
        if (codigo === FK_VIOLADA) throw new ClinicaOuGrupoNaoExiste()
        throw e
      }
      return {
        id: linha.id,
        grupoId: linha.grupo_id,
        clinicaId: linha.clinica_id,
        nome: linha.nome,
        produto: linha.produto,
        status: linha.status,
        // Nenhum link de acesso no momento da criação (migration 0036) — o
        // `Usuário de Gestão` os cadastra depois, na ficha do cliente.
        linkPainel: null,
        linkDashInd: null,
        linkDashFin: null,
        linkRotina: null,
      }
    })
  }

  /**
   * 0068: a clínica `clinicaId` PARTICIPA do grupo `grupoId` (uma clínica pode
   * estar em vários). Já participa: não faz nada. Senão grava a participação
   * e a linha de histórico (append-only). O gatilho do banco só aceita o
   * Operador como autor.
   */
  private async prenderClinicaAoGrupo(
    c: PoolClient,
    ator: OperadorId,
    clinicaId: string,
    grupoId: string,
    motivo: string | null,
  ): Promise<void> {
    try {
      const ja = await c.query(
        `SELECT 1 FROM participacao_clinica_grupo WHERE clinica_id = $1 AND grupo_id = $2 AND ate IS NULL`,
        [clinicaId, grupoId],
      )
      if ((ja.rowCount ?? 0) > 0) return
      await registrarGrupoDaClinica(c, { clinicaId, anterior: null, novo: grupoId, operadorId: ator.id, motivo })
      await c.query(
        `INSERT INTO participacao_clinica_grupo (clinica_id, grupo_id, adicionado_por, motivo)
         VALUES ($1, $2, $3, $4)`,
        [clinicaId, grupoId, ator.id, motivo ?? 'cliente ligado à clínica'],
      )
    } catch (e) {
      if ((e as { code?: string }).code === FK_VIOLADA) throw new ClinicaOuGrupoNaoExiste()
      throw e
    }
  }

  /**
   * 0068: adiciona a clínica a um grupo. A função do banco cria a
   * participação, o histórico e um Cliente Firmare VAZIO no grupo
   * (mensalidade 0, não conta na receita).
   */
  async adicionarGrupoDaClinica(
    ator: OperadorId,
    clinicaId: string,
    grupoId: string,
    motivo: string,
  ): Promise<{ clienteId: string }> {
    return this.banco.nasTabelasDaCarteiraComoOperador(ator, async (c) => {
      const g = await c.query<{ ativo: boolean; arquivo: boolean }>('SELECT ativo, arquivo FROM grupos WHERE id = $1', [grupoId])
      if (!g.rows[0] || g.rows[0].arquivo) throw new GrupoNaoExiste()
      if (!g.rows[0].ativo) throw new GrupoDesativado()
      try {
        const r = await c.query<{ id: string }>('SELECT adicionar_clinica_ao_grupo($1, $2, $3) AS id', [clinicaId, grupoId, motivo])
        return { clienteId: r.rows[0]!.id }
      } catch (e) {
        const x = e as { code?: string; constraint?: string }
        if (x.code === FK_VIOLADA || x.code === '23503') throw new ClinicaOuGrupoNaoExiste()
        if (x.code === UNICIDADE_VIOLADA) throw new ClinicaJaEstaNoGrupo()
        throw e
      }
    })
  }

  /**
   * 0068: remove a clínica de um grupo. Encerra a participação, encerra o
   * Cliente Firmare daquele grupo e o leva, com todas as filhas, ao grupo de
   * ARQUIVO: o grupo perde a leitura na hora (RLS por `grupo_id`) e o dado
   * fica retido só para a Firmare (retencao.md). O grupo Firmare não sai.
   */
  async removerGrupoDaClinica(ator: OperadorId, clinicaId: string, grupoId: string, motivo: string): Promise<void> {
    await this.banco.nasTabelasDaCarteiraComoOperador(ator, async (c) => {
      const arquivo = (await c.query<{ id: string }>('SELECT id FROM grupos WHERE arquivo')).rows[0]?.id
      if (!arquivo) throw new Error('grupo de arquivo ausente')
      // Quem paga não sai: sem troca de pagador, o MRR e as cobranças da clínica sumiriam em silêncio.
      const paga = await c.query(
        `SELECT 1 FROM clientes_carteira
          WHERE clinica_id = $1 AND grupo_id = $2 AND excluido_em IS NULL AND conta_na_receita
            AND NOT EXISTS (SELECT 1 FROM grupos g WHERE g.id = $2 AND g.padrao)`,
        [clinicaId, grupoId],
      )
      if ((paga.rowCount ?? 0) > 0) throw new PagadorNaoSaiDoGrupo()
      try {
        await c.query('SELECT encerrar_participacao_da_clinica($1, $2, $3)', [clinicaId, grupoId, motivo])
      } catch (e) {
        const x = e as { code?: string; constraint?: string }
        if (x.constraint === 'grupo_padrao_fixo') throw new GrupoPadraoNaoMuda()
        if (x.constraint === 'participacao_inexistente') throw new ClinicaNaoEstaNoGrupo()
        throw e
      }
      const cli = await c.query<{ id: string }>(
        `SELECT id FROM clientes_carteira
          WHERE clinica_id = $1 AND grupo_id = $2 AND excluido_em IS NULL FOR UPDATE`,
        [clinicaId, grupoId],
      )
      const clienteId = cli.rows[0]?.id
      if (clienteId === undefined) return
      // O responsável do grupo antigo não serve ao arquivo: solto, nunca deixado inválido.
      await c.query(
        `UPDATE clientes_carteira
            SET excluido_em = now(), conta_na_receita = false, responsavel_usuario_gestao_id = NULL
          WHERE id = $1`,
        [clienteId],
      )
      const movidas = await moverClienteDeGrupo(c, clienteId, arquivo)
      // O portal do cliente decide por cliente, não por grupo: sem desativar o usuário, ele refaria o login e leria o arquivo.
      await c.query('UPDATE usuarios_do_portal SET ativo = false WHERE cliente_carteira_id = $1 AND ativo', [clienteId])
      const revogadas = await c.query(
        `UPDATE sessoes_do_portal SET revogada_em = now()
          WHERE revogada_em IS NULL
            AND usuario_portal_id IN (SELECT id FROM usuarios_do_portal WHERE cliente_carteira_id = $1)`,
        [clienteId],
      )
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'alterou',
        entidade: 'clientes_carteira',
        entidadeId: clienteId,
        de: { grupo_id: grupoId },
        para: { encerrado: true, linhas_movidas: movidas, sessoes_do_portal_revogadas: revogadas.rowCount ?? 0 },
        motivo,
      })
    })
  }

  /** Os grupos em que a clínica está agora (só o Operador lê; vê todos). */
  async gruposDaClinica(ator: OperadorId, clinicaId: string): Promise<Array<{ grupoId: string; nome: string; desde: string; padrao: boolean }>> {
    return this.banco.nasTabelasDaCarteiraComoOperador(ator, async (c) => {
      const r = await c.query<{ grupo_id: string; nome: string; desde: Date; padrao: boolean }>(
        `SELECT p.grupo_id, g.nome, p.desde, g.padrao FROM participacao_clinica_grupo p
           JOIN grupos g ON g.id = p.grupo_id
          WHERE p.clinica_id = $1 AND p.ate IS NULL ORDER BY p.desde, g.nome`,
        [clinicaId],
      )
      return r.rows.map((x) => ({ grupoId: x.grupo_id, nome: x.nome, desde: x.desde.toISOString(), padrao: x.padrao }))
    })
  }

  /**
   * Os `Cliente Firmare` de todos os grupos, para a tela de grupos do
   * superadmin: quem pertence a qual grupo, e se tem clínica. A mensalidade
   * atravessa a redação de toda saída como qualquer outro campo de valor.
   */
  async listarClientesCarteira(ator: OperadorId): Promise<ClienteCarteiraNoPainel[]> {
    return this.banco.nasTabelasDaCarteiraComoOperador(ator, async (c) => {
      const r = await c.query<LinhaClienteNoPainel>(
        `SELECT ${COLUNAS_NO_PAINEL} FROM clientes_carteira WHERE excluido_em IS NULL ORDER BY nome`,
      )
      return r.rows.map(clienteNoPainel)
    })
  }

  /**
   * **EDITAR um `Cliente Firmare` pelo Operador** — status, mensalidade e
   * pagamento, GRUPO e o vínculo com uma clínica, numa transação.
   *
   * Mudar de grupo (A-11 item 6): grava `historico_grupo_da_clinica` quando
   * há clínica; solta o Responsável Firmare se ele não serve ao grupo novo;
   * reescreve o `grupo_id` do cliente e de TODA filha numa instrução só
   * (`moverClienteDeGrupo`); revoga as sessões do portal dos usuários de
   * escopo `cliente` deste cliente; e deixa a contagem na trilha do painel.
   */
  async editarClienteCarteira(
    ator: OperadorId,
    id: string,
    dados: EditarClienteCarteiraNoPainelEntrada,
  ): Promise<ClienteCarteiraNoPainel> {
    return this.banco.nasTabelasDaCarteiraComoOperador(ator, async (c) => {
      const antes = await c.query<
        LinhaClienteNoPainel & { responsavel_usuario_gestao_id: string | null; dia_vencimento: number | null }
      >(
        `SELECT ${COLUNAS_NO_PAINEL}, responsavel_usuario_gestao_id, dia_vencimento
           FROM clientes_carteira WHERE id = $1 AND excluido_em IS NULL FOR UPDATE`,
        [id],
      )
      const cliente = antes.rows[0]
      if (!cliente) throw new ClienteCarteiraNaoExiste()

      const motivo = dados.motivo ?? null
      const grupoFinal = dados.grupoId ?? cliente.grupo_id

      if (dados.clinicaId !== undefined && dados.clinicaId !== cliente.clinica_id) {
        if (cliente.clinica_id !== null) throw new ClienteJaTemClinica()
      }

      if (grupoFinal !== cliente.grupo_id && cliente.clinica_id !== null) {
        throw new ClienteComClinicaNaoMudaDeGrupo()
      }
      if (grupoFinal !== cliente.grupo_id) {
        const g = await c.query<{ ativo: boolean }>('SELECT ativo FROM grupos WHERE id = $1', [grupoFinal])
        if (!g.rows[0]) throw new GrupoNaoExiste()
        if (!g.rows[0].ativo) throw new GrupoDesativado()

        if (cliente.clinica_id !== null) {
          await this.prenderClinicaAoGrupo(c, ator, cliente.clinica_id, grupoFinal, motivo)
        }
        if (
          cliente.responsavel_usuario_gestao_id !== null &&
          !(await responsavelServeAoCliente(c, cliente.responsavel_usuario_gestao_id, grupoFinal))
        ) {
          await c.query('UPDATE clientes_carteira SET responsavel_usuario_gestao_id = NULL WHERE id = $1', [id])
        }

        const movidas = await moverClienteDeGrupo(c, id, grupoFinal)
        const revogadas = await c.query(
          `UPDATE sessoes_do_portal SET revogada_em = now()
            WHERE revogada_em IS NULL
              AND usuario_portal_id IN (SELECT id FROM usuarios_do_portal WHERE cliente_carteira_id = $1)`,
          [id],
        )
        await registrarNoPainel(c, {
          atorTipo: 'operador',
          atorId: ator.id,
          acao: 'alterou',
          entidade: 'clientes_carteira',
          entidadeId: id,
          de: { grupo_id: cliente.grupo_id },
          para: { grupo_id: grupoFinal, linhas_movidas: movidas, sessoes_do_portal_revogadas: revogadas.rowCount ?? 0 },
          ...(motivo === null ? {} : { motivo }),
        })
      }

      if (dados.clinicaId !== undefined && dados.clinicaId !== cliente.clinica_id) {
        await this.prenderClinicaAoGrupo(c, ator, dados.clinicaId, grupoFinal, motivo)
        try {
          await c.query('UPDATE clientes_carteira SET clinica_id = $2 WHERE id = $1', [id, dados.clinicaId])
        } catch (e) {
          const codigo = (e as { code?: string }).code
          if (codigo === UNICIDADE_VIOLADA) throw new ClinicaJaTemClienteFirmare()
          if (codigo === FK_VIOLADA) throw new ClinicaOuGrupoNaoExiste()
          throw e
        }
      }

      // Os campos simples — a trilha deles é o trigger de `clientes_carteira`
      // (de → para, com o Operador como ator).
      await gravarCampos(c, id, {
        ...(dados.status === undefined ? {} : { status: dados.status }),
        ...(dados.mensalidade === undefined ? {} : { mensalidade: dados.mensalidade }),
        ...(dados.pagamentoDaMensalidade === undefined ? {} : { pagamentoDaMensalidade: dados.pagamentoDaMensalidade }),
      })

      // Gate de números, ajuste 6: o dia novo vale para as cobranças em
      // aberto da competência corrente e das futuras, nesta transação.
      const diaNovo = dados.pagamentoDaMensalidade?.diaVencimento ?? null
      if (diaNovo !== null && diaNovo !== cliente.dia_vencimento) {
        const mudadas = await reprogramarCobrancasAbertas(c, id, diaNovo, competenciaDoMes(this.relogio.agora()))
        for (const m of mudadas) {
          await registrarNoPainel(c, {
            atorTipo: 'operador',
            atorId: ator.id,
            acao: 'alterou',
            entidade: 'cobrancas_do_cliente_firmare',
            entidadeId: m.id,
            de: { vencimento: m.de },
            para: { vencimento: m.para, motivo: 'dia de vencimento do cliente alterado' },
          })
        }
      }

      const depois = await c.query<LinhaClienteNoPainel>(
        `SELECT ${COLUNAS_NO_PAINEL} FROM clientes_carteira WHERE id = $1`,
        [id],
      )
      return clienteNoPainel(depois.rows[0]!)
    })
  }

  /**
   * Cria o `Usuário de Gestão`, com provisória — mesma forma de
   * `PainelClinicasService.criar` para a administradora.
   */
  /**
   * **EDITAR um `Usuário de Gestão`** — nome, escopo, grupo e estado, por
   * completo. `usuario` (login) não muda por aqui — ver o comentário do
   * contrato (`EditarUsuarioDeGestaoEntrada`, `packages/contracts/carteira.ts`).
   */
  async editarUsuarioDeGestao(
    ator: OperadorId,
    id: string,
    dados: EditarUsuarioDeGestaoEntrada,
  ): Promise<UsuarioDeGestaoNaLista> {
    return this.banco.nasTabelasDeIdentidadeDaCarteiraComoPainel(ator, async (c) => {
      const antes = await c.query<{
        nome: string
        escopo: 'geral' | 'grupo'
        grupo_id: string | null
        ativo: boolean
      } & LinhaDoPerfil>(`SELECT nome, escopo, grupo_id, ativo, ${colunasDoPerfil()} FROM usuarios_gestao WHERE id = $1 FOR UPDATE`, [id])
      const linhaAntes = antes.rows[0]
      if (linhaAntes === undefined) throw new UsuarioDeGestaoNaoExiste()
      const de = {
        nome: linhaAntes.nome,
        escopo: linhaAntes.escopo,
        grupoId: linhaAntes.grupo_id,
        ativo: linhaAntes.ativo,
        ...perfilDaLinha(linhaAntes),
      }

      const r = await c.query<{
        id: string
        usuario: string
        nome: string
        escopo: 'geral' | 'grupo'
        grupo_id: string | null
        ativo: boolean
        senha_provisoria: boolean
      } & LinhaDoPerfil>(
        `UPDATE usuarios_gestao SET nome = $2, escopo = $3, grupo_id = $4, ativo = $5,
                valores = $6, carteira = $7, modulos = $8::text[], administrar = $9,
                setor = $10, funcao = $11, telefone = $12
          WHERE id = $1
        RETURNING id, usuario, nome, escopo, grupo_id, ativo, senha_provisoria, ${colunasDoPerfil()}`,
        [id, dados.nome, dados.escopo, dados.grupoId, dados.ativo, ...valoresDoPerfil(dados)],
      ).catch((e: unknown) => {
        if (ehContaFixa(e)) throw new ContaDeGestaoDoOperadorFixa()
        traduzTravaDoGrupoPadrao(e)
        throw e
      })
      const linha = r.rows[0]!
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'alterou',
        entidade: 'usuarios_gestao',
        entidadeId: linha.id,
        de,
        para: {
          nome: linha.nome,
          escopo: linha.escopo,
          grupoId: linha.grupo_id,
          ativo: linha.ativo,
          ...perfilDaLinha(linha),
        },
      })
      return {
        id: linha.id,
        usuario: linha.usuario,
        nome: linha.nome,
        escopo: linha.escopo,
        grupoId: linha.grupo_id,
        ativo: linha.ativo,
        aguardandoPrimeiroAcesso: linha.senha_provisoria,
        contaDoOperador:
          (await c.query('SELECT 1 FROM contas_de_gestao_do_operador WHERE usuario_gestao_id = $1', [linha.id])).rows
            .length > 0,
        ...perfilDaLinha(linha),
      }
    })
  }

  /**
   * **REDEFINIR a senha de um `Usuário de Gestão`** (D-23 item 3) — o mesmo
   * padrão da clínica (D-18, `PainelPessoasService.redefinirSenha`):
   * gerada quando `escolhida` não vem, escolhida pelo Operador quando vem.
   * As duas PROVISÓRIAS, com as mesmas 72 h: o `CarteiraGuard` já força a
   * troca no primeiro acesso.
   *
   * Três transações curtas, na ordem de `trocarAPropriaSenha`: a leitura do
   * alvo (404 antes de qualquer Argon2, e o contexto da regra de força), o
   * hash FORA de transação, e a escrita. A regra de força vem antes do hash.
   *
   * Na escrita: a senha, TODAS as sessões e desafios da pessoa revogados, e
   * a trilha em `auditoria_do_painel` — com a ORIGEM da senha, nunca ela.
   */
  async redefinirSenhaDoUsuarioDeGestao(
    ator: OperadorId,
    id: string,
    escolhida: string | undefined,
  ): Promise<SenhaDoUsuarioDeGestaoRedefinida> {
    const alvo = await this.banco.nasTabelasDeIdentidadeDaCarteiraComoPainel(ator, async (c) => {
      const r = await c.query<{ usuario: string; nome: string }>(
        'SELECT usuario, nome FROM usuarios_gestao WHERE id = $1',
        [id],
      )
      return r.rows[0] ?? null
    })
    if (!alvo) throw new UsuarioDeGestaoNaoExiste()

    const agora = this.relogio.agora()
    const provisoria: Provisoria =
      escolhida === undefined
        ? await gerarProvisoria(agora)
        : await provisoriaEscolhida(agora, escolhida, [alvo.usuario, alvo.nome])

    await this.banco.nasTabelasDeIdentidadeDaCarteiraComoPainel(ator, async (c) => {
      const antes = await c.query<{ senha_provisoria: boolean }>(
        'SELECT senha_provisoria FROM usuarios_gestao WHERE id = $1 FOR UPDATE',
        [id],
      )
      const linha = antes.rows[0]
      if (!linha) throw new UsuarioDeGestaoNaoExiste()
      try {
        await c.query(
          `UPDATE usuarios_gestao
              SET senha_hash = $2, senha_provisoria = true, senha_provisoria_expira_em = $3
            WHERE id = $1`,
          [id, provisoria.hash, provisoria.expiraEm],
        )
      } catch (e) {
        const pgErro = e as { code?: string; constraint?: string }
        if (pgErro.code === VIOLACAO_DE_CHECK && pgErro.constraint === 'conta_de_gestao_do_operador_fixa') {
          throw new ContaDeGestaoDoOperadorSemSenha()
        }
        throw e
      }
      await c.query(
        'UPDATE sessoes_de_carteira SET revogada_em = now() WHERE usuario_gestao_id = $1 AND revogada_em IS NULL',
        [id],
      )
      // Um desafio do segundo fator em curso nasceu da senha ANTIGA.
      await c.query(
        `UPDATE desafios_de_carteira SET revogado_em = now()
          WHERE usuario_gestao_id = $1 AND revogado_em IS NULL AND concluido_em IS NULL`,
        [id],
      )
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'alterou',
        entidade: 'usuarios_gestao',
        entidadeId: id,
        de: { senhaProvisoria: linha.senha_provisoria },
        para: {
          senhaProvisoria: true,
          senhaRedefinida: escolhida === undefined ? 'gerada pelo servidor' : 'escolhida pelo operador',
        },
      })
    })

    return {
      id,
      senhaProvisoria: provisoria.senha,
      senhaProvisoriaExpiraEm: provisoria.expiraEm.toISOString(),
    }
  }

  async criarUsuarioDeGestao(
    ator: OperadorId,
    dados: CriarUsuarioDeGestaoEntrada,
  ): Promise<{ usuarioDeGestao: UsuarioDeGestaoPublico; senhaProvisoria: string }> {
    const provisoria = await gerarProvisoria(this.relogio.agora())

    return this.banco.nasTabelasDeIdentidadeDaCarteiraComoPainel(ator, async (c) => {
      let linha: {
        id: string
        usuario: string
        nome: string
        escopo: 'geral' | 'grupo'
        grupo_id: string | null
      } & LinhaDoPerfil
      try {
        const r = await c.query<typeof linha>(
          `INSERT INTO usuarios_gestao
             (usuario, nome, senha_hash, escopo, grupo_id, senha_provisoria, senha_provisoria_expira_em,
              valores, carteira, modulos, administrar, setor, funcao, telefone)
           VALUES ($1, $2, $3, $4, $5, true, $6, $7, $8, $9::text[], $10, $11, $12, $13)
           RETURNING id, usuario, nome, escopo, grupo_id, ${colunasDoPerfil()}`,
          [
            dados.usuario,
            dados.nome,
            provisoria.hash,
            dados.escopo,
            dados.grupoId,
            provisoria.expiraEm,
            ...valoresDoPerfil(dados),
          ],
        )
        linha = r.rows[0]!
      } catch (e) {
        if ((e as { code?: string }).code === UNICIDADE_VIOLADA) throw new UsuarioDeGestaoJaExiste()
        traduzTravaDoGrupoPadrao(e)
        throw e
      }
      await registrarNoPainel(c, {
        atorTipo: 'operador',
        atorId: ator.id,
        acao: 'criou',
        entidade: 'usuarios_gestao',
        entidadeId: linha.id,
        para: { usuario: linha.usuario, nome: linha.nome, escopo: linha.escopo, ...perfilDaLinha(linha) },
      })
      return {
        usuarioDeGestao: {
          id: linha.id,
          usuario: linha.usuario,
          nome: linha.nome,
          escopo: linha.escopo,
          grupoId: linha.grupo_id,
          senhaProvisoria: true,
          ...perfilDaLinha(linha),
        },
        senhaProvisoria: provisoria.senha,
      }
    })
  }
}
